/**
 * Repasse mensal ao proprietário (M4.9). No dia 1º do mês seguinte, cada proprietário tem o
 * mês fechado:
 *
 * - saldo S: acerto acumulado até o fim do mês (soma de efeitoSaldo; positivo = empresa deve);
 * - adiantamentos em aberto de até o fim do mês já estão em S (efeito negativo). Os não
 *   contestados são descontados no repasse; os contestados (C) ficam de fora — "enquanto
 *   contestado, não é cobrado nem descontado";
 * - valor a transferir = S + C, se positivo. Se não, nada a repassar: o proprietário deve
 *   e os adiantamentos continuam em aberto (cobrança ou próximo repasse).
 *
 * Fechar grava o repasse, lança no livro um "repasse" por imóvel (efeito −(Sᵢ + Cᵢ), o que
 * deixa cada imóvel com saldo −Cᵢ) e registra a compensação de cada adiantamento descontado.
 * Estornar desfaz tudo isso de uma vez.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or, sql, sum } from "drizzle-orm";
import { desfazerCompensacoesDoRepasse, listarAdiantamentos, quitar } from "@/adiantamentos/adiantamentos";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { violouUnicidade } from "@/db/erros";
import { ajustes, arquivos, contestacoesAdiantamento, imoveis, lancamentos, quitacoesAdiantamento, proprietarioImoveis, proprietarios, repasseItens, repasses, type SituacaoRepasse, type TipoRepasse } from "@/db/schema";
import type { Db } from "@/db/types";
import { estornar, lancar, mudarEstado } from "@/financeiro/ledger";
import { lerComReservasTravadas } from "@/financeiro/trava";
import { dataValida } from "@/reservas/regras";
import { uuidValido } from "@/lib/ids";
import { lancamentoEmConferencia } from "@/portal/posse";
import { reservas as reservasRef } from "@/db/schema";
import { type Parte, partesDisponiveis, partesDoProprietario } from "./extrato";

export type Repasse = typeof repasses.$inferSelect;
export type RepasseItem = typeof repasseItens.$inferSelect;

/** Meio-dia em São Paulo do dia `hoje`: "agora" quando quem chama só tem a data. */
export const meioDiaDe = (hoje: string) => new Date(`${hoje}T12:00:00-03:00`);

const MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "AAAA-MM" → { inicio: "AAAA-MM-01", fim: 1º do mês seguinte, ultimoDia }. */
export function limitesDoMes(mes: string): { inicio: string; fim: string; ultimoDia: string } | null {
  const m = MES.exec(mes);
  if (!m) return null;
  const ano = Number(m[1]);
  const n = Number(m[2]);
  const fim = n === 12 ? `${ano + 1}-01-01` : `${ano}-${String(n + 1).padStart(2, "0")}-01`;
  const dias = new Date(Date.UTC(ano, n, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim, ultimoDia: `${mes}-${String(dias).padStart(2, "0")}` };
}

/** Mês anterior ao de `hoje` ("AAAA-MM"): o que se fecha no dia 1º. */
export function mesAFechar(hoje: string): string {
  const [a, m] = hoje.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

export function somarMes(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function nomeMes(mes: string): string {
  const nomes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const [a, m] = mes.split("-").map(Number);
  return `${nomes[m - 1]} de ${a}`;
}

/**
 * Cálculo puro a partir dos saldos por imóvel e dos adiantamentos (ver o topo do arquivo). M4.10:
 * `foraPorImovel` é a parte da competência cujo dinheiro ainda não está com a empresa (sai do
 * repasse e vai para o seguinte); `antecipado` são as partes já disponíveis com noites fora do mês
 * fechado, pagas neste repasse como adiantamento vinculado (lançadas na competência delas).
 */
export function calcularRepasse(
  saldoPorImovel: ReadonlyMap<string | null, number>,
  contestadoPorImovel: ReadonlyMap<string | null, number>,
  aDescontar: number,
  extras: { foraPorImovel?: ReadonlyMap<string | null, number>; antecipado?: number } = {},
) {
  const foraPorImovel = extras.foraPorImovel ?? new Map<string | null, number>();
  const antecipado = extras.antecipado ?? 0;
  const saldo = [...saldoPorImovel.values()].reduce((s, v) => s + v, 0);
  const contestado = [...contestadoPorImovel.values()].reduce((s, v) => s + v, 0);
  const fora = [...foraPorImovel.values()].reduce((s, v) => s + v, 0);
  const liquido = saldo - fora + contestado + antecipado;
  const chaves = new Set([...saldoPorImovel.keys(), ...contestadoPorImovel.keys(), ...foraPorImovel.keys()]);
  const porImovel = new Map<string | null, number>();
  for (const k of chaves) {
    const v = (saldoPorImovel.get(k) ?? 0) + (contestadoPorImovel.get(k) ?? 0) - (foraPorImovel.get(k) ?? 0);
    if (v !== 0) porImovel.set(k, v);
  }
  return {
    saldo,
    contestado,
    fora,
    antecipado,
    aDescontar: liquido > 0 ? aDescontar : 0,
    valor: Math.max(0, liquido),
    /** Quanto o proprietário deve quando não há o que repassar (sem os contestados). */
    deve: liquido < 0 ? -liquido : 0,
    /** Efeito do repasse na competência do mês, por imóvel (sem as partes antecipadas, que vão na competência delas). */
    porImovel,
  };
}

export type PrevisaoRepasse = ReturnType<typeof calcularRepasse> & {
  proprietarioId: string;
  nome: string;
  email: string;
  chavePix: string;
  imoveis: string[];
  /** Impedem o fechamento (ex.: acerto pendente, mês não terminou). */
  bloqueios: string[];
  /** Não impedem, mas precisam ser vistos. */
  avisos: string[];
  /** Há acerto pendente ou ajuste a esclarecer até este mês (o valor ainda não é definitivo). */
  emConferencia: boolean;
  /** Mês ("AAAA-MM") do primeiro repasse posterior em vigor, que levou o saldo deste mês; null = nenhum. */
  repassePosterior: string | null;
  /**
   * Mudança no acerto depois do fechamento deste mês — ou, sem repasse próprio, depois do último
   * repasse posterior (lançamento retroativo) — que vai para o próximo repasse; 0 = nenhuma.
   */
  diferencaPosFechamento: number;
  repasse: Repasse | null;
  /** M4.10: partes de reserva que este fechamento paga (disponíveis da competência e as antecipadas de meses seguintes). */
  itens: Parte[];
  /** M4.10: partes da competência que ficam fora (dinheiro ainda não com a empresa, conferência): vão para o repasse seguinte. */
  foraDoFechamento: Parte[];
  /**
   * M4.10 (6ª rodada do Codex): toda reserva de que este cálculo depende — as das partes (pagas, fora,
   * só informação) e as de qualquer lançamento do proprietário até o mês. O fechamento trava todas antes
   * de reler, não só as que paga: o saldo e as partes têm de vir da mesma foto, sem o motor no meio.
   */
  reservasDoCalculo: string[];
};

type Dono = { id: string; nome: string; email: string; chavePix: string };

async function calcularDono(db: Db, org: string, dono: Dono, mes: string, hoje: string, agora: Date): Promise<PrevisaoRepasse> {
  const lim = limitesDoMes(mes)!;
  // Em sequência (não Promise.all): no fechamento isto roda dentro de uma transação, numa conexão só.
  const vinculos = await db
    .select({ id: imoveis.id, codigo: imoveis.codigo })
    .from(proprietarioImoveis)
    .innerJoin(imoveis, eq(imoveis.id, proprietarioImoveis.imovelId))
    .where(eq(proprietarioImoveis.proprietarioId, dono.id))
    .orderBy(asc(imoveis.codigo));
  const saldos = await db
    .select({ imovelId: lancamentos.imovelId, total: sum(lancamentos.efeitoSaldo) })
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, org), eq(lancamentos.proprietarioId, dono.id), lt(lancamentos.competencia, lim.fim)))
    .groupBy(lancamentos.imovelId);
  const adiantamentos = await listarAdiantamentos(db, org, { proprietarioId: dono.id, somenteAbertos: true });
  const pendentes = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, org),
        lancamentoEmConferencia(),
        lt(lancamentos.competencia, lim.fim),
        or(
          eq(lancamentos.proprietarioId, dono.id),
          sql`${lancamentos.imovelId} in (select ${proprietarioImoveis.imovelId} from ${proprietarioImoveis} where ${proprietarioImoveis.proprietarioId} = ${dono.id})`,
        ),
        isNull(lancamentos.estornoDe),
        sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
      ),
    );
  // Ajuste com o proprietário ainda não esclarecido — inclusive sem valor (que não tem lançamento).
  const [ajustesAbertos] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ajustes)
    .where(
      and(
        eq(ajustes.organizacaoId, org),
        eq(ajustes.afeta, "proprietario"),
        isNull(ajustes.esclarecidoEm),
        lt(ajustes.data, lim.fim),
        or(
          eq(ajustes.proprietarioId, dono.id),
          sql`${ajustes.imovelId} in (select ${proprietarioImoveis.imovelId} from ${proprietarioImoveis} where ${proprietarioImoveis.proprietarioId} = ${dono.id})`,
        ),
      ),
    );
  // Para o portal ("em conferência"): o que não tem dono só conta se é do período em que o imóvel é
  // dele (data do vínculo em diante). O bloqueio do fechamento continua olhando tudo acima.
  const noPeriodoDele = (imovel: typeof lancamentos.imovelId | typeof ajustes.imovelId, data: typeof lancamentos.competencia | typeof ajustes.data) =>
    sql`exists (select 1 from ${proprietarioImoveis} where ${proprietarioImoveis.imovelId} = ${imovel} and ${proprietarioImoveis.proprietarioId} = ${dono.id} and ${data} >= (${proprietarioImoveis.criadoEm} at time zone 'America/Sao_Paulo')::date)`;
  const [pendentesDele] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, org),
        lancamentoEmConferencia(),
        lt(lancamentos.competencia, lim.fim),
        or(eq(lancamentos.proprietarioId, dono.id), and(isNull(lancamentos.proprietarioId), noPeriodoDele(lancamentos.imovelId, lancamentos.competencia))),
        isNull(lancamentos.estornoDe),
        sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
      ),
    );
  const [ajustesDele] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ajustes)
    .where(
      and(
        eq(ajustes.organizacaoId, org),
        eq(ajustes.afeta, "proprietario"),
        isNull(ajustes.esclarecidoEm),
        lt(ajustes.data, lim.fim),
        or(eq(ajustes.proprietarioId, dono.id), and(isNull(ajustes.proprietarioId), noPeriodoDele(ajustes.imovelId, ajustes.data))),
      ),
    );
  const previstos = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, org),
        eq(lancamentos.proprietarioId, dono.id),
        eq(lancamentos.estado, "previsto"),
        ne(lancamentos.tipo, "repasse"),
        ne(lancamentos.efeitoSaldo, 0),
        lt(lancamentos.competencia, lim.fim),
        isNull(lancamentos.estornoDe),
        sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
      ),
    );
  const [atual] = await db
    .select()
    .from(repasses)
    .where(and(eq(repasses.organizacaoId, org), eq(repasses.proprietarioId, dono.id), eq(repasses.tipo, "fechamento"), eq(repasses.mes, lim.inicio), isNull(repasses.estornadoEm)));
  // Fechamentos de meses seguintes em vigor, do mais antigo ao mais recente (os antecipados não contam aqui:
  // entram no acerto como lançamentos "repasse" e o fechamento os desconta naturalmente).
  const posteriores = await db
    .select({ mes: repasses.mes, criadoEm: repasses.criadoEm })
    .from(repasses)
    .where(and(eq(repasses.organizacaoId, org), eq(repasses.proprietarioId, dono.id), eq(repasses.tipo, "fechamento"), gt(repasses.mes, lim.inicio), isNull(repasses.estornadoEm)))
    .orderBy(asc(repasses.mes));
  const primeiroPosterior = posteriores[0];
  const posterior = posteriores.at(-1);
  // Só adiantamentos do mês ou anteriores (os de depois ainda não estão no saldo).
  const doMes = adiantamentos.filter((a) => a.data < lim.fim);
  const contestadoPorImovel = new Map<string | null, number>();
  for (const a of doMes.filter((x) => x.situacao === "contestado")) contestadoPorImovel.set(a.imovelId, (contestadoPorImovel.get(a.imovelId) ?? 0) + a.aberto);
  const aDescontar = doMes.filter((a) => a.situacao !== "contestado").reduce((s, a) => s + a.aberto, 0);
  const saldoPorImovel = new Map(saldos.map((x) => [x.imovelId, Number(x.total ?? 0)] as [string | null, number]));
  // M4.10: a condição de disponível vale também para o fechamento. Da competência, só entra o que já
  // está disponível (check-in passado e dinheiro com a empresa); o resto fica fora, com aviso, e passa
  // para o repasse seguinte. Partes já disponíveis com noites em meses seguintes entram como adiantamento
  // vinculado, para a reserva ser paga inteira. Sem repasse próprio, a lista vale só para avisar.
  const partes = atualOuNada(await partesDoProprietario(db, org, dono.id, agora));
  const comReserva = await db
    .selectDistinct({ reservaId: lancamentos.reservaId })
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, org), eq(lancamentos.proprietarioId, dono.id), lt(lancamentos.competencia, lim.fim), isNotNull(lancamentos.reservaId)));
  const reservasDoCalculo = [...new Set([...comReserva.map((l) => l.reservaId!), ...partes.map((x) => x.reservaId)])].sort();
  const daCompetencia = (x: Parte) => x.competencia < lim.fim;
  const foraDoFechamento = partes.filter((x) => daCompetencia(x) && x.quemRecebe === "empresa" && x.situacao === "a_liberar");
  const antecipadas = partes.filter((x) => !daCompetencia(x) && x.situacao === "disponivel");
  const itens = [...partes.filter((x) => daCompetencia(x) && x.situacao === "disponivel"), ...antecipadas];
  const foraPorImovel = new Map<string | null, number>();
  for (const x of foraDoFechamento) foraPorImovel.set(x.imovelId, (foraPorImovel.get(x.imovelId) ?? 0) + x.efeitoSaldo);
  const calc = calcularRepasse(saldoPorImovel, contestadoPorImovel, aDescontar, { foraPorImovel, antecipado: antecipadas.reduce((t, x) => t + x.valor, 0) });

  const bloqueios: string[] = [];
  const avisos: string[] = [];
  if (hoje < lim.fim) bloqueios.push(`O mês ainda não terminou: o fechamento é a partir de ${lim.fim.split("-").reverse().join("/")}.`);
  if (pendentes[0]?.n) bloqueios.push(`${pendentes[0].n} lançamento(s) com acerto pendente até este mês (sem proprietário, quem recebe a confirmar, ajuste a esclarecer ou reserva que deixou de estar confirmada com dinheiro já movimentado): resolva antes de fechar.`);
  if (ajustesAbertos?.n) bloqueios.push(`${ajustesAbertos.n} ajuste(s) com o proprietário ainda a esclarecer até este mês (com ou sem valor): esclareça antes de fechar.`);
  if (posterior) bloqueios.push(`Já existe repasse de ${nomeMes(posterior.mes.slice(0, 7))}: estorne-o antes de fechar um mês anterior.`);
  if (previstos[0]?.n) avisos.push(`${previstos[0].n} lançamento(s) ainda previsto(s), isto é, dinheiro que pode não ter entrado: confira antes de pagar.`);
  if (!atual && calc.fora > 0) avisos.push(`${brl(calc.fora)} da competência ficam fora deste repasse e passam para o seguinte: dinheiro ainda não registrado com a empresa (reservas ${codigosDe(foraDoFechamento)}). Registre o recebimento na reserva quando o canal pagar.`);
  if (!atual && calc.antecipado > 0) avisos.push(`${brl(calc.antecipado)} de noites de ${mesesDe(antecipadas)} entram neste repasse como adiantamento (reservas ${codigosDe(antecipadas)}): já disponíveis, a reserva é paga inteira.`);
  if (calc.valor > 0 && !dono.chavePix.trim()) avisos.push("Sem chave Pix no cadastro do proprietário.");
  if (calc.contestado > 0) avisos.push(`Adiantamentos contestados (${(calc.contestado / 100).toFixed(2).replace(".", ",")}) ficam fora do desconto até a contestação ser resolvida.`);
  let diferenca = 0;
  if (atual && !posterior) {
    // O que vai para o próximo repasse é o saldo com os contestados somados de volta. Logo depois
    // do fechamento isso dá o que ficou fora dele (M4.10: dinheiro ainda não com a empresa); se mudou
    // além disso (lançamento novo, contestação resolvida…), avisa.
    diferenca = calc.saldo + calc.contestado - atual.foraDoFechamento;
    if (diferenca !== 0) avisos.push(`Depois do fechamento, o acerto até este mês mudou em ${(diferenca / 100).toFixed(2).replace(".", ",")}: a diferença entra no próximo repasse.`);
    if (atual.foraDoFechamento > 0) avisos.push(`${brl(atual.foraDoFechamento)} da competência ficaram fora deste repasse (dinheiro ainda não registrado com a empresa) e vão para o repasse seguinte.`);
  }
  if (posterior) {
    // Há repasse de mês seguinte: o saldo até este mês (e o que mudou depois do fechamento dele)
    // já foi levado por ele. O que foi lançado com data até este mês depois do último repasse
    // seguinte ainda não foi levado por nenhum.
    const [depois] = await db
      .select({ total: sum(lancamentos.efeitoSaldo) })
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.organizacaoId, org),
          eq(lancamentos.proprietarioId, dono.id),
          lt(lancamentos.competencia, lim.fim),
          gt(lancamentos.criadoEm, posterior.criadoEm),
        ),
      );
    diferenca = Number(depois?.total ?? 0);
    // Mudança só de situação (sem lançamento): adiantamento deste mês ou antes que estava
    // contestado no último repasse (ficou fora do desconto) e deixou de estar — ou o contrário.
    // Contestações dos adiantamentos dele com data até este mês — inclusive os já quitados ("empresa
    // assume" quita e lança a compensação, que entra acima em `depois`) e os estornados (a despesa
    // de origem estornada encerra a contestação e estorna o adiantamento): o que estava fora do
    // desconto no repasse sai daqui, e o efeito líquido é zero.
    const contestacoes = await db
      .select({ id: contestacoesAdiantamento.id, adiantamentoId: contestacoesAdiantamento.adiantamentoId, valor: contestacoesAdiantamento.valor, abertaEm: contestacoesAdiantamento.abertaEm, resolvidaEm: contestacoesAdiantamento.resolvidaEm })
      .from(contestacoesAdiantamento)
      .innerJoin(lancamentos, eq(lancamentos.id, contestacoesAdiantamento.adiantamentoId))
      .where(and(eq(contestacoesAdiantamento.organizacaoId, org), eq(lancamentos.proprietarioId, dono.id), lt(lancamentos.competencia, lim.fim)));
    if (contestacoes.length) {
      const corte = posterior.criadoEm.getTime();
      // "Empresa assume" desfeito reabre a contestação (e apaga `resolvidaEm`): o período em que
      // ela esteve resolvida vem da quitação dela (criada → desfeita).
      const assumidas = await db
        .select({ contestacaoId: quitacoesAdiantamento.contestacaoId, criadoEm: quitacoesAdiantamento.criadoEm, desfeitaEm: quitacoesAdiantamento.desfeitaEm })
        .from(quitacoesAdiantamento)
        .where(and(eq(quitacoesAdiantamento.organizacaoId, org), inArray(quitacoesAdiantamento.contestacaoId, contestacoes.map((c) => c.id))));
      const abertaNoCorte = (c: (typeof contestacoes)[number]) =>
        c.abertaEm.getTime() <= corte &&
        !(c.resolvidaEm && c.resolvidaEm.getTime() <= corte) &&
        !assumidas.some((q) => q.contestacaoId === c.id && q.criadoEm.getTime() <= corte && (!q.desfeitaEm || q.desfeitaEm.getTime() > corte));
      const emAberto = new Map(doMes.map((a) => [a.id, a.aberto]));
      for (const id of new Set(contestacoes.map((c) => c.adiantamentoId))) {
        const dele = contestacoes.filter((c) => c.adiantamentoId === id);
        // Contestação aberta no momento do repasse: o valor dela ficou fora do desconto.
        const naquele = dele.find(abertaNoCorte);
        const agora = dele.find((c) => !c.resolvidaEm);
        // Contestado fica fora do desconto (volta ao saldo a favor do proprietário): a diferença é
        // o que fica fora agora menos o que ficou fora no repasse (vale também para uma nova
        // contestação de valor diferente, depois de um reembolso parcial).
        const foraNoCorte = naquele ? naquele.valor : 0;
        const foraAgora = agora ? (emAberto.get(id) ?? agora.valor) : 0;
        diferenca += foraAgora - foraNoCorte;
      }
    }
    if (diferenca !== 0) avisos.push(`Depois do repasse de ${nomeMes(posterior.mes.slice(0, 7))}, o acerto até este mês mudou em ${(diferenca / 100).toFixed(2).replace(".", ",")}: a diferença entra no próximo repasse.`);
  }
  return { ...calc, proprietarioId: dono.id, nome: dono.nome, email: dono.email, chavePix: dono.chavePix, imoveis: vinculos.map((v) => v.codigo), bloqueios, avisos, repasse: atual ?? null,
    emConferencia: Boolean(pendentesDele?.n || ajustesDele?.n),
    repassePosterior: primeiroPosterior ? primeiroPosterior.mes.slice(0, 7) : null,
    diferencaPosFechamento: diferenca,
    itens,
    foraDoFechamento,
    reservasDoCalculo,
  };
}

const atualOuNada = (partes: Parte[]) => partes;
const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
const codigosDe = (partes: readonly Parte[]) => [...new Set(partes.map((x) => x.codigoReserva))].join(", ");
const mesesDe = (partes: readonly Parte[]) => [...new Set(partes.map((x) => nomeMes(x.competencia.slice(0, 7))))].join(" e ");

/**
 * Situação do mês para cada proprietário com algo a ver: saldo, adiantamentos em aberto ou
 * repasse já feito. `proprietarioIds` restringe (ex.: um só).
 */
/** `incluirVazios`: devolve também quem não tem saldo nem repasse (ex.: só um ajuste sem valor a esclarecer). */
export async function preverRepasses(db: Db, org: string, mes: string, hoje: string, proprietarioIds?: string[], incluirVazios = false, agora: Date = meioDiaDe(hoje)): Promise<PrevisaoRepasse[]> {
  if (!limitesDoMes(mes)) return [];
  const c = [eq(proprietarios.organizacaoId, org)];
  if (proprietarioIds) c.push(inArray(proprietarios.id, proprietarioIds.filter(uuidValido)));
  if (proprietarioIds && !proprietarioIds.some(uuidValido)) return [];
  const donos = await db
    .select({ id: proprietarios.id, nome: proprietarios.nome, email: proprietarios.email, chavePix: proprietarios.chavePix })
    .from(proprietarios)
    .where(and(...c))
    .orderBy(asc(proprietarios.nome));
  const lista = await Promise.all(donos.map((d) => calcularDono(db, org, d, mes, hoje, agora)));
  return incluirVazios ? lista : lista.filter((p) => p.repasse || p.saldo !== 0 || p.contestado !== 0 || p.aDescontar !== 0);
}

type Resultado = { ok: true; id: string } | { ok: false; erro: string };

const chavePrefixo = (repasseId: string) => `repasse:${repasseId}:`;

/** Fecha o mês de um proprietário: grava o repasse, os lançamentos e os descontos. */
export async function fecharMes(db: Db, org: string, proprietarioId: string, mes: string, hoje: string, autorId: string | null, agora: Date = meioDiaDe(hoje)): Promise<Resultado> {
  const lim = limitesDoMes(mes);
  if (!lim) return { ok: false, erro: "Mês inválido." };
  if (!uuidValido(proprietarioId)) return { ok: false, erro: "Proprietário não encontrado." };
  try {
    return await fecharNaTransacao(db, org, proprietarioId, mes, lim, hoje, autorId, agora);
  } catch (e) {
    if (e instanceof FechamentoMudou) return { ok: false, erro: e.message };
    throw e;
  }
}

/** Algo mudou nos adiantamentos entre o cálculo e o registro: nada é gravado. */
class FechamentoMudou extends Error {
  constructor() {
    super("Os adiantamentos deste proprietário mudaram durante o fechamento. Nada foi gravado: confira e feche de novo.");
    this.name = "FechamentoMudou";
  }
}

async function fecharNaTransacao(
  db: Db,
  org: string,
  proprietarioId: string,
  mes: string,
  lim: NonNullable<ReturnType<typeof limitesDoMes>>,
  hoje: string,
  autorId: string | null,
  agora: Date,
): Promise<Resultado> {
  return db.transaction(async (tx) => {
    // Trava o proprietário: dois fechamentos ao mesmo tempo não passam daqui juntos.
    const dono = await travarDono(tx, org, proprietarioId);
    if (!dono) return { ok: false as const, erro: "Proprietário não encontrado." };
    // Toda reserva de que o cálculo depende (partes pagas, fora, só informação e qualquer lançamento até o mês)
    // fica travada para o motor até o fim: saldo e partes vêm da mesma foto, e o que se paga é o que foi lido com a trava.
    const p = await lerComReservasTravadas(tx, org, () => calcularDono(tx, org, dono, mes, hoje, agora), (x) => x.reservasDoCalculo);
    if (!p) return { ok: false as const, erro: RESERVAS_EM_RECALCULO };
    if (p.repasse) return { ok: false as const, erro: "Este mês já foi fechado para este proprietário." };
    if (p.bloqueios.length) return { ok: false as const, erro: p.bloqueios[0] };
    if (p.valor <= 0) return { ok: false as const, erro: "Nada a repassar neste mês." };

    const [r] = await tx
      .insert(repasses)
      .values({ organizacaoId: org, proprietarioId, tipo: "fechamento", mes: lim.inicio, data: lim.fim, saldo: p.saldo, descontado: p.aDescontar, contestado: p.contestado, valor: p.valor, foraDoFechamento: p.fora, antecipado: p.antecipado, criadoPor: autorId })
      .returning();
    const ids = [...new Set([...[...p.porImovel.keys()].filter((k): k is string => k !== null), ...p.itens.map((x) => x.imovelId)])];
    const codigos = new Map(
      ids.length ? (await tx.select({ id: imoveis.id, codigo: imoveis.codigo }).from(imoveis).where(inArray(imoveis.id, ids))).map((i) => [i.id, i.codigo]) : [],
    );
    const nomeDoMes = nomeMes(mes);
    await lancar(
      tx,
      org,
      [
        ...[...p.porImovel].map(([imovelId, v]) => ({
          tipo: "repasse" as const,
          descricao: `Repasse de ${nomeDoMes}${imovelId ? ` — ${codigos.get(imovelId) ?? ""}` : ""}${v < 0 ? " (compensado com outro imóvel)" : ""}`,
          valor: 0,
          montante: v,
          efeitoSaldo: -v,
          competencia: lim.ultimoDia,
          estado: "previsto" as const,
          imovelId,
          proprietarioId,
          origem: "repasse",
          chaveOrigem: `${chavePrefixo(r.id)}${imovelId ?? "geral"}`,
        })),
        // Partes antecipadas (noites de meses seguintes): na competência delas, para o mês seguinte fechar zerado.
        ...lancamentosAntecipados(r.id, proprietarioId, p.itens.filter((x) => x.competencia >= lim.fim), codigos, `Repasse de ${nomeDoMes}`),
      ],
      autorId,
    );
    await vincularItens(tx, org, r.id, p.itens);
    // Descontos: cada adiantamento em aberto (não contestado) do mês ou antes é quitado por compensação.
    const abertos = (await listarAdiantamentos(tx, org, { proprietarioId, somenteAbertos: true })).filter((a) => a.data < lim.fim && a.situacao !== "contestado");
    // Os adiantamentos precisam ser os mesmos do cálculo: se algo mudou no meio (ex.: uma
    // contestação), o fechamento inteiro é desfeito em vez de misturar duas situações.
    if (abertos.reduce((t, a) => t + a.aberto, 0) !== p.aDescontar) throw new FechamentoMudou();
    for (const a of abertos) {
      const q = await quitar(tx, org, a.id, { forma: "compensacao", valor: a.aberto, data: lim.ultimoDia, nota: `Descontado no repasse de ${nomeDoMes}`, repasseId: r.id }, autorId);
      if (!q.ok) throw new FechamentoMudou();
    }
    await registrarAuditoria(tx, {
      organizacaoId: org,
      usuarioId: autorId,
      acao: "repasse.fechar",
      entidade: "repasse",
      entidadeId: r.id,
      mudancas: { repasse: [null, `${nomeDoMes}: ${p.valor} (saldo ${p.saldo}, descontado ${p.aDescontar}, contestado fora ${p.contestado}, fora do fechamento ${p.fora}, antecipado ${p.antecipado})`] },
    });
    return { ok: true as const, id: r.id };
  });
}

async function travarDono(tx: Db, org: string, proprietarioId: string): Promise<Dono | null> {
  if (!uuidValido(proprietarioId)) return null;
  const [dono] = await tx
    .select({ id: proprietarios.id, nome: proprietarios.nome, email: proprietarios.email, chavePix: proprietarios.chavePix })
    .from(proprietarios)
    .where(and(eq(proprietarios.id, proprietarioId), eq(proprietarios.organizacaoId, org)))
    .for("update");
  return dono ?? null;
}

/** Um lançamento "repasse" por imóvel e mês de competência das partes, na competência delas. */
function lancamentosAntecipados(repasseId: string, proprietarioId: string, partes: readonly Parte[], codigos: ReadonlyMap<string, string>, prefixoDescricao: string) {
  const grupos = new Map<string, { imovelId: string; competencia: string; valor: number; reservas: Set<string> }>();
  for (const x of partes) {
    const chave = `${x.imovelId}|${x.competencia.slice(0, 7)}`;
    const g = grupos.get(chave) ?? { imovelId: x.imovelId, competencia: x.competencia, valor: 0, reservas: new Set<string>() };
    g.valor += x.valor;
    g.reservas.add(x.codigoReserva);
    grupos.set(chave, g);
  }
  return [...grupos.values()]
    .filter((g) => g.valor !== 0)
    .map((g) => ({
      tipo: "repasse" as const,
      descricao: `${prefixoDescricao} — ${codigos.get(g.imovelId) ?? ""} (adiantamento das noites de ${nomeMes(g.competencia.slice(0, 7))}: reservas ${[...g.reservas].join(", ")})`.slice(0, 300),
      valor: 0,
      montante: g.valor,
      efeitoSaldo: -g.valor,
      competencia: g.competencia,
      estado: "previsto" as const,
      imovelId: g.imovelId,
      proprietarioId,
      origem: "repasse",
      chaveOrigem: `${chavePrefixo(repasseId)}${g.imovelId}:${g.competencia.slice(0, 7)}`,
    }));
}

/** Vínculo único: a mesma parte nunca compõe dois repasses em vigor (índice único por lançamento). */
async function vincularItens(tx: Db, org: string, repasseId: string, partes: readonly Parte[]) {
  if (!partes.length) return;
  await tx.insert(repasseItens).values(partes.map((x) => ({ organizacaoId: org, repasseId, lancamentoId: x.lancamentoId, reservaId: x.reservaId, imovelId: x.imovelId, competencia: x.competencia, valor: x.valor })));
}

/** Itens de um repasse em vigor (as partes de reserva que ele paga), com os códigos para mostrar. */
/** Item de repasse com a reserva e o imóvel (para o painel, o portal e o e-mail). */
export type ItemDoRepasse = RepasseItem & { codigoReserva: string; codigoImovel: string; checkin: string; checkout: string; hospede: string; parcial: boolean };

export async function itensDoRepasse(db: Db, org: string, repasseId: string): Promise<ItemDoRepasse[]> {
  if (!uuidValido(repasseId)) return [];
  const linhas = await db
    .select({ item: repasseItens, codigoReserva: reservasRef.codigo, codigoImovel: imoveis.codigo, checkin: reservasRef.checkin, checkout: reservasRef.checkout, hospede: reservasRef.hospedeNome })
    .from(repasseItens)
    .innerJoin(reservasRef, eq(reservasRef.id, repasseItens.reservaId))
    .innerJoin(imoveis, eq(imoveis.id, repasseItens.imovelId))
    .where(and(eq(repasseItens.organizacaoId, org), eq(repasseItens.repasseId, repasseId)))
    .orderBy(asc(reservasRef.checkin), asc(repasseItens.competencia));
  if (!linhas.length) return [];
  // Parcial: a reserva tem outra parte (outro mês) em vigor que não está neste repasse.
  const outras = await db
    .select({ reservaId: lancamentos.reservaId, n: sql<number>`count(*)::int` })
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, org), eq(lancamentos.tipo, "direito_proprietario"), inArray(lancamentos.reservaId, [...new Set(linhas.map((l) => l.item.reservaId))]), isNull(lancamentos.estornoDe), sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`))
    .groupBy(lancamentos.reservaId);
  const totalPartes = new Map(outras.map((o) => [o.reservaId!, o.n]));
  const nesteRepasse = new Map<string, number>();
  for (const l of linhas) nesteRepasse.set(l.item.reservaId, (nesteRepasse.get(l.item.reservaId) ?? 0) + 1);
  return linhas.map((l) => ({ ...l.item, codigoReserva: l.codigoReserva, codigoImovel: l.codigoImovel, checkin: l.checkin, checkout: l.checkout, hospede: l.hospede, parcial: (totalPartes.get(l.item.reservaId) ?? 1) > (nesteRepasse.get(l.item.reservaId) ?? 0) }));
}

/**
 * Repasse antecipado (M4.10): reúne tudo o que está disponível (check-in até ontem, dinheiro com a
 * empresa) e ainda não compôs repasse. Programado pela rotina diária ou avulso (pedido do
 * proprietário no portal, ou gerado por Diego no painel). Nunca no dia 1º: nesse dia o fechamento
 * é o único repasse. Um antecipado por proprietário por dia; a mesma parte nunca entra duas vezes.
 */
export async function gerarAntecipado(db: Db, org: string, proprietarioId: string, hoje: string, autorId: string | null, o: { pedidoPeloProprietario?: boolean; agora?: Date } = {}): Promise<Resultado> {
  if (!dataValida(hoje)) return { ok: false, erro: "Data inválida." };
  if (hoje.endsWith("-01")) return { ok: false, erro: "No dia 1º o repasse é o fechamento do mês: feche o mês em vez de antecipar." };
  const agora = o.agora ?? meioDiaDe(hoje);
  try {
    return await db.transaction(async (tx) => {
      const dono = await travarDono(tx, org, proprietarioId);
      if (!dono) return { ok: false as const, erro: "Proprietário não encontrado." };
      const [jaHoje] = await tx
        .select({ id: repasses.id })
        .from(repasses)
        .where(and(eq(repasses.proprietarioId, dono.id), eq(repasses.tipo, "antecipado"), eq(repasses.data, hoje), isNull(repasses.estornadoEm)));
      if (jaHoje) return { ok: false as const, erro: "Já existe um repasse antecipado de hoje para este proprietário." };
      // Um fechamento mais novo que a data de hoje (mês fechado com atraso, data no futuro) não acontece; mas um
      // antecipado nunca passa na frente do fechamento do dia.
      // As reservas das partes ficam travadas para o motor até o fim da transação: nenhuma parte lida aqui
      // é estornada/recriada antes de o vínculo existir (2ª rodada do Codex).
      const partes = await lerComReservasTravadas(tx, org, () => partesDisponiveis(tx, org, dono.id, agora), (ps) => ps.map((x) => x.reservaId));
      if (!partes) return { ok: false as const, erro: RESERVAS_EM_RECALCULO };
      if (!partes.length) return { ok: false as const, erro: "Nada disponível para repassar agora." };
      const valor = partes.reduce((t, x) => t + x.valor, 0);
      if (valor <= 0) return { ok: false as const, erro: "Nada disponível para repassar agora." };
      const [r] = await tx
        .insert(repasses)
        .values({ organizacaoId: org, proprietarioId: dono.id, tipo: "antecipado", mes: `${hoje.slice(0, 7)}-01`, data: hoje, saldo: valor, descontado: 0, contestado: 0, valor, antecipado: valor, criadoPor: autorId, pedidoEm: o.pedidoPeloProprietario ? agora : null })
        .returning();
      const codigos = new Map((await tx.select({ id: imoveis.id, codigo: imoveis.codigo }).from(imoveis).where(inArray(imoveis.id, [...new Set(partes.map((x) => x.imovelId))]))).map((i) => [i.id, i.codigo]));
      await lancar(tx, org, lancamentosAntecipados(r.id, dono.id, partes, codigos, `Repasse antecipado de ${dataBr(hoje)}`), autorId);
      await vincularItens(tx, org, r.id, partes);
      await registrarAuditoria(tx, {
        organizacaoId: org,
        usuarioId: autorId,
        acao: "repasse.antecipar",
        entidade: "repasse",
        entidadeId: r.id,
        mudancas: { repasse: [null, `antecipado de ${hoje}: ${valor} (${partes.length} parte(s), reservas ${codigosDe(partes)})${o.pedidoPeloProprietario ? ", pedido pelo proprietário" : ""}`] },
      });
      return { ok: true as const, id: r.id };
    });
  } catch (e) {
    // Duas execuções no mesmo instante (rotina e botão): o índice único por dia e por parte decide.
    if (violouUnicidade(e)) return { ok: false, erro: "Já existe um repasse antecipado de hoje para este proprietário (ou uma das partes já entrou em outro repasse)." };
    throw e;
  }
}

const dataBr = (d: string) => d.split("-").reverse().join("/");
const RESERVAS_EM_RECALCULO = "Reservas deste proprietário estão sendo recalculadas agora: tente de novo em instantes.";

async function travarRepasse(tx: Db, org: string, id: string): Promise<Repasse | null> {
  if (!uuidValido(id)) return null;
  const [r] = await tx
    .select()
    .from(repasses)
    .where(and(eq(repasses.id, id), eq(repasses.organizacaoId, org)))
    .for("update");
  return r ?? null;
}

async function lancamentosDoRepasse(tx: Db, org: string, id: string) {
  return tx
    .select()
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, org), sql`${lancamentos.chaveOrigem} like ${`${chavePrefixo(id)}%`}`, isNull(lancamentos.estornoDe)));
}

export type ComprovanteRepasse = {
  /** Identificador da transação Pix ou nota curta. */
  texto: string;
  /** Arquivo do banco (PDF, PNG ou JPG, até 5 MB), guardado no banco de dados. */
  arquivo?: { nome: string; tipo: string; conteudo: Buffer } | null;
};

export const TIPOS_COMPROVANTE = ["application/pdf", "image/png", "image/jpeg"] as const;
export const TAMANHO_MAXIMO_COMPROVANTE = 5 * 1024 * 1024;

export function validarComprovante(c: ComprovanteRepasse | undefined): string | null {
  if (!c) return null;
  if (c.texto.length > 200) return "O identificador do comprovante tem no máximo 200 caracteres.";
  const a = c.arquivo;
  if (!a) return null;
  if (!(TIPOS_COMPROVANTE as readonly string[]).includes(a.tipo)) return "O comprovante precisa ser PDF, PNG ou JPG.";
  if (!a.conteudo.length) return "O arquivo do comprovante está vazio.";
  if (a.conteudo.length > TAMANHO_MAXIMO_COMPROVANTE) return "O comprovante tem mais de 5 MB.";
  if (!a.nome.trim()) return "O arquivo do comprovante precisa de nome.";
  return null;
}

/**
 * Marca o repasse como pago (os lançamentos passam a realizados, com a data do Pix; as partes de
 * reserva pagas também, para o recálculo do motor não mexer nelas). M4.10: com o comprovante
 * (identificador e/ou arquivo) o e-mail ao proprietário fica liberado; sem ele, o repasse fica
 * "pago sem comprovante", com aviso, e o comprovante pode ser anexado depois.
 */
/**
 * Marca o repasse como pago. `chavePixUsada`: a chave mostrada na tela quando a pessoa fez o Pix — é ela
 * que fica gravada (e vai no e-mail), não a do cadastro no instante do envio do formulário, que pode ter
 * mudado no meio; sem ela (chamada sem tela), vale a do cadastro agora.
 */
export async function marcarRepassePago(db: Db, org: string, id: string, data: string, hoje: string, autorId: string | null, comprovante?: ComprovanteRepasse, o: { chavePixUsada?: string } = {}): Promise<Resultado> {
  if (!dataValida(data)) return { ok: false, erro: "Data do pagamento inválida." };
  if (data > hoje) return { ok: false, erro: "A data do pagamento não pode ser no futuro." };
  const invalido = validarComprovante(comprovante);
  if (invalido) return { ok: false, erro: invalido };
  return db.transaction(async (tx) => {
    const r = await travarRepasse(tx, org, id);
    if (!r || r.estornadoEm) return { ok: false as const, erro: "Repasse não encontrado." };
    if (r.situacao !== "a_pagar") return { ok: false as const, erro: "Este repasse já está pago." };
    // O Pix só pode ter sido feito a partir da data do repasse (fechamento: o dia 1º seguinte ao mês).
    if (data < r.data) return { ok: false as const, erro: `A data do pagamento não pode ser antes de ${dataBr(r.data)}.` };
    for (const l of await lancamentosDoRepasse(tx, org, id)) await mudarEstado(tx, org, l.id, "realizado", autorId, data);
    for (const i of await itensEmVigor(tx, org, id)) await mudarEstado(tx, org, i.lancamentoId, "realizado", autorId, data);
    const arquivoId = comprovante?.arquivo ? await guardarArquivo(tx, org, comprovante.arquivo, autorId) : null;
    // A chave Pix usada fica gravada no repasse (a mostrada na tela; sem tela, a do cadastro agora): o e-mail e o
    // histórico citam a do pagamento, mesmo que o cadastro mude antes do envio do formulário ou depois.
    const [dono] = await tx.select({ chavePix: proprietarios.chavePix }).from(proprietarios).where(eq(proprietarios.id, r.proprietarioId));
    const atual = dono?.chavePix.trim() ?? "";
    const chavePixPaga = o.chavePixUsada?.trim() || atual;
    await tx.update(repasses).set({ situacao: "pago" as SituacaoRepasse, dataPagamento: data, comprovante: comprovante?.texto.trim() ?? "", comprovanteArquivoId: arquivoId, chavePixPaga }).where(eq(repasses.id, id));
    await registrarAuditoria(tx, {
      organizacaoId: org,
      usuarioId: autorId,
      acao: "repasse.pagar",
      entidade: "repasse",
      entidadeId: id,
      mudancas: { situacao: ["a pagar", `pago em ${data}${temComprovante(comprovante) ? ", com comprovante" : ", sem comprovante"}`], ...(chavePixPaga !== atual ? { chavePix: [chavePixPaga, `cadastro mudou para ${atual || "(vazia)"} antes de marcar pago`] } : {}) },
    });
    return { ok: true as const, id };
  });
}

const temComprovante = (c: ComprovanteRepasse | undefined | null) => Boolean(c && (c.texto.trim() || c.arquivo));

/** Anexa (ou troca) o comprovante de um repasse já pago. */
export async function anexarComprovante(db: Db, org: string, id: string, comprovante: ComprovanteRepasse, autorId: string | null): Promise<Resultado> {
  const invalido = validarComprovante(comprovante);
  if (invalido) return { ok: false, erro: invalido };
  if (!temComprovante(comprovante)) return { ok: false, erro: "Informe o identificador do Pix ou anexe o arquivo do comprovante." };
  return db.transaction(async (tx) => {
    const r = await travarRepasse(tx, org, id);
    if (!r || r.estornadoEm) return { ok: false as const, erro: "Repasse não encontrado." };
    if (r.situacao !== "pago") return { ok: false as const, erro: "Marque o repasse como pago antes de anexar o comprovante." };
    const arquivoId = comprovante.arquivo ? await guardarArquivo(tx, org, comprovante.arquivo, autorId) : r.comprovanteArquivoId;
    await tx.update(repasses).set({ comprovante: comprovante.texto.trim() || r.comprovante, comprovanteArquivoId: arquivoId }).where(eq(repasses.id, id));
    await registrarAuditoria(tx, { organizacaoId: org, usuarioId: autorId, acao: "repasse.comprovante", entidade: "repasse", entidadeId: id, mudancas: { comprovante: [r.comprovante || (r.comprovanteArquivoId ? "arquivo" : null), comprovante.texto.trim() || "arquivo"] } });
    return { ok: true as const, id };
  });
}

async function guardarArquivo(tx: Db, org: string, a: NonNullable<ComprovanteRepasse["arquivo"]>, autorId: string | null): Promise<string> {
  const [f] = await tx.insert(arquivos).values({ organizacaoId: org, nome: a.nome.trim().slice(0, 200), tipo: a.tipo, tamanho: a.conteudo.length, conteudo: a.conteudo, criadoPor: autorId }).returning({ id: arquivos.id });
  return f.id;
}

/** Um arquivo pelo id (o anexo guardado no pedido de e-mail de um repasse; quem chama já conferiu o acesso). */
export async function arquivoPorId(db: Db, org: string, arquivoId: string): Promise<{ nome: string; tipo: string; conteudo: Buffer } | null> {
  if (!uuidValido(arquivoId)) return null;
  const [a] = await db.select({ nome: arquivos.nome, tipo: arquivos.tipo, conteudo: arquivos.conteudo }).from(arquivos).where(and(eq(arquivos.id, arquivoId), eq(arquivos.organizacaoId, org)));
  return a ? { nome: a.nome, tipo: a.tipo, conteudo: Buffer.from(a.conteudo) } : null;
}

/** Arquivo do comprovante de um repasse (quem chama já conferiu o acesso ao repasse). */
export async function arquivoDoComprovante(db: Db, org: string, repasseId: string): Promise<{ nome: string; tipo: string; conteudo: Buffer } | null> {
  if (!uuidValido(repasseId)) return null;
  const [l] = await db
    .select({ nome: arquivos.nome, tipo: arquivos.tipo, conteudo: arquivos.conteudo })
    .from(repasses)
    .innerJoin(arquivos, eq(arquivos.id, repasses.comprovanteArquivoId))
    .where(and(eq(repasses.id, repasseId), eq(repasses.organizacaoId, org)));
  return l ? { nome: l.nome, tipo: l.tipo, conteudo: Buffer.from(l.conteudo) } : null;
}

async function itensEmVigor(tx: Db, org: string, repasseId: string) {
  return tx.select().from(repasseItens).where(and(eq(repasseItens.organizacaoId, org), eq(repasseItens.repasseId, repasseId), isNull(repasseItens.liberadoEm)));
}

/**
 * Estorna o repasse: estorna os lançamentos, desfaz os descontos (os adiantamentos voltam a
 * ficar em aberto) e libera o mês para ser fechado de novo. Só o repasse mais recente do
 * proprietário, para a sequência dos meses continuar certa.
 */
export async function estornarRepasse(db: Db, org: string, id: string, motivo: string, hoje: string, autorId: string | null): Promise<Resultado> {
  const m = motivo.trim();
  if (!m) return { ok: false, erro: "Informe o motivo do estorno." };
  return db.transaction(async (tx) => {
    if (!uuidValido(id)) return { ok: false as const, erro: "Repasse não encontrado." };
    // Mesma ordem de trava do fechamento (primeiro o proprietário): um estorno e um fechamento de
    // mês seguinte ao mesmo tempo não se cruzam.
    const [dono] = await tx.select({ proprietarioId: repasses.proprietarioId }).from(repasses).where(and(eq(repasses.id, id), eq(repasses.organizacaoId, org)));
    if (!dono) return { ok: false as const, erro: "Repasse não encontrado." };
    await tx.select({ id: proprietarios.id }).from(proprietarios).where(eq(proprietarios.id, dono.proprietarioId)).for("update");
    const r = await travarRepasse(tx, org, id);
    if (!r || r.estornadoEm) return { ok: false as const, erro: "Repasse não encontrado." };
    // Só o repasse mais recente do proprietário (fechamento ou antecipado), para a sequência continuar certa.
    const [posterior] = await tx
      .select({ id: repasses.id, tipo: repasses.tipo })
      .from(repasses)
      .where(and(eq(repasses.proprietarioId, r.proprietarioId), or(gt(repasses.data, r.data), and(eq(repasses.data, r.data), gt(repasses.criadoEm, r.criadoEm))), isNull(repasses.estornadoEm)));
    if (posterior) return { ok: false as const, erro: posterior.tipo === "fechamento" ? "Há um repasse de mês posterior: estorne-o primeiro." : "Há um repasse antecipado posterior: estorne-o primeiro." };
    for (const l of await lancamentosDoRepasse(tx, org, id)) {
      const [ja] = await tx.select({ id: lancamentos.id }).from(lancamentos).where(eq(lancamentos.estornoDe, l.id));
      if (!ja) await estornar(tx, org, l.id, `Repasse estornado: ${m}`, autorId, r.situacao === "pago" ? hoje : undefined);
    }
    // As partes de reserva voltam a ficar disponíveis (e a "previsto", se o pagamento as tinha realizado).
    for (const i of await itensEmVigor(tx, org, id)) {
      const [l] = await tx.select({ estado: lancamentos.estado }).from(lancamentos).where(eq(lancamentos.id, i.lancamentoId));
      if (l?.estado === "realizado") await mudarEstado(tx, org, i.lancamentoId, "previsto", autorId);
    }
    await tx.update(repasseItens).set({ liberadoEm: new Date() }).where(and(eq(repasseItens.repasseId, id), isNull(repasseItens.liberadoEm)));
    await desfazerCompensacoesDoRepasse(tx, org, id, m, autorId);
    await tx.update(repasses).set({ situacao: "estornado" as SituacaoRepasse, estornadoEm: new Date(), motivoEstorno: m.slice(0, 300) }).where(eq(repasses.id, id));
    await registrarAuditoria(tx, { organizacaoId: org, usuarioId: autorId, acao: "repasse.estornar", entidade: "repasse", entidadeId: id, mudancas: { situacao: [r.situacao, `estornado: ${m}`] } });
    return { ok: true as const, id };
  });
}

/** Repasses (inclusive estornados) de um proprietário, do mais recente para o mais antigo. */
export async function listarRepasses(db: Db, org: string, proprietarioId: string): Promise<Repasse[]> {
  if (!uuidValido(proprietarioId)) return [];
  return db
    .select()
    .from(repasses)
    .where(and(eq(repasses.organizacaoId, org), eq(repasses.proprietarioId, proprietarioId)))
    .orderBy(desc(repasses.data), desc(repasses.criadoEm));
}

export type RepasseListado = Repasse & { nome: string; email: string; chavePix: string };

/**
 * Repasses da organização (painel): por padrão os antecipados em vigor ou pagos num intervalo de datas,
 * mais os que ainda estão a pagar de qualquer data, do mais recente para o mais antigo.
 */
export async function listarRepassesDaOrganizacao(db: Db, org: string, o: { tipo?: TipoRepasse; de?: string; ate?: string; proprietarioId?: string; incluirEstornados?: boolean } = {}): Promise<RepasseListado[]> {
  const c = [eq(repasses.organizacaoId, org)];
  if (o.tipo) c.push(eq(repasses.tipo, o.tipo));
  if (o.proprietarioId && uuidValido(o.proprietarioId)) c.push(eq(repasses.proprietarioId, o.proprietarioId));
  if (!o.incluirEstornados) c.push(isNull(repasses.estornadoEm));
  const periodo = [o.de ? gte(repasses.data, o.de) : undefined, o.ate ? lt(repasses.data, o.ate) : undefined].filter(Boolean);
  if (periodo.length) c.push(or(and(...periodo), eq(repasses.situacao, "a_pagar"))!);
  const linhas = await db
    .select({ r: repasses, nome: proprietarios.nome, email: proprietarios.email, chavePix: proprietarios.chavePix })
    .from(repasses)
    .innerJoin(proprietarios, eq(proprietarios.id, repasses.proprietarioId))
    .where(and(...c))
    .orderBy(desc(repasses.data), desc(repasses.criadoEm));
  return linhas.map((l) => ({ ...l.r, nome: l.nome, email: l.email, chavePix: l.chavePix }));
}

export async function obterRepasse(db: Db, org: string, id: string): Promise<RepasseListado | null> {
  if (!uuidValido(id)) return null;
  const [l] = await db
    .select({ r: repasses, nome: proprietarios.nome, email: proprietarios.email, chavePix: proprietarios.chavePix })
    .from(repasses)
    .innerJoin(proprietarios, eq(proprietarios.id, repasses.proprietarioId))
    .where(and(eq(repasses.id, id), eq(repasses.organizacaoId, org)));
  return l ? { ...l.r, nome: l.nome, email: l.email, chavePix: l.chavePix } : null;
}
