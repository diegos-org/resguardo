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
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql, sum } from "drizzle-orm";
import { desfazerCompensacoesDoRepasse, listarAdiantamentos, quitar } from "@/adiantamentos/adiantamentos";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { ajustes, contestacoesAdiantamento, imoveis, lancamentos, proprietarioImoveis, proprietarios, repasses, type SituacaoRepasse } from "@/db/schema";
import type { Db } from "@/db/types";
import { estornar, lancar, mudarEstado } from "@/financeiro/ledger";
import { dataValida } from "@/reservas/regras";
import { uuidValido } from "@/lib/ids";

export type Repasse = typeof repasses.$inferSelect;

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

/** Cálculo puro a partir dos saldos por imóvel e dos adiantamentos (ver o topo do arquivo). */
export function calcularRepasse(saldoPorImovel: ReadonlyMap<string | null, number>, contestadoPorImovel: ReadonlyMap<string | null, number>, aDescontar: number) {
  const saldo = [...saldoPorImovel.values()].reduce((s, v) => s + v, 0);
  const contestado = [...contestadoPorImovel.values()].reduce((s, v) => s + v, 0);
  const liquido = saldo + contestado;
  const chaves = new Set([...saldoPorImovel.keys(), ...contestadoPorImovel.keys()]);
  const porImovel = new Map<string | null, number>();
  for (const k of chaves) {
    const v = (saldoPorImovel.get(k) ?? 0) + (contestadoPorImovel.get(k) ?? 0);
    if (v !== 0) porImovel.set(k, v);
  }
  return {
    saldo,
    contestado,
    aDescontar: liquido > 0 ? aDescontar : 0,
    valor: Math.max(0, liquido),
    /** Quanto o proprietário deve quando não há o que repassar (sem os contestados). */
    deve: liquido < 0 ? -liquido : 0,
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
};

type Dono = { id: string; nome: string; email: string; chavePix: string };

async function calcularDono(db: Db, org: string, dono: Dono, mes: string, hoje: string): Promise<PrevisaoRepasse> {
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
        eq(lancamentos.estado, "pendente"),
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
    .where(and(eq(repasses.organizacaoId, org), eq(repasses.proprietarioId, dono.id), eq(repasses.mes, lim.inicio), isNull(repasses.estornadoEm)));
  // Repasses de meses seguintes em vigor, do mais antigo ao mais recente.
  const posteriores = await db
    .select({ mes: repasses.mes, criadoEm: repasses.criadoEm })
    .from(repasses)
    .where(and(eq(repasses.organizacaoId, org), eq(repasses.proprietarioId, dono.id), gt(repasses.mes, lim.inicio), isNull(repasses.estornadoEm)))
    .orderBy(asc(repasses.mes));
  const primeiroPosterior = posteriores[0];
  const posterior = posteriores.at(-1);
  // Só adiantamentos do mês ou anteriores (os de depois ainda não estão no saldo).
  const doMes = adiantamentos.filter((a) => a.data < lim.fim);
  const contestadoPorImovel = new Map<string | null, number>();
  for (const a of doMes.filter((x) => x.situacao === "contestado")) contestadoPorImovel.set(a.imovelId, (contestadoPorImovel.get(a.imovelId) ?? 0) + a.aberto);
  const aDescontar = doMes.filter((a) => a.situacao !== "contestado").reduce((s, a) => s + a.aberto, 0);
  const saldoPorImovel = new Map(saldos.map((x) => [x.imovelId, Number(x.total ?? 0)] as [string | null, number]));
  const calc = calcularRepasse(saldoPorImovel, contestadoPorImovel, aDescontar);

  const bloqueios: string[] = [];
  const avisos: string[] = [];
  if (hoje < lim.fim) bloqueios.push(`O mês ainda não terminou: o fechamento é a partir de ${lim.fim.split("-").reverse().join("/")}.`);
  if (pendentes[0]?.n) bloqueios.push(`${pendentes[0].n} lançamento(s) com acerto pendente até este mês (sem proprietário, quem recebe a confirmar ou ajuste a esclarecer): resolva antes de fechar.`);
  if (ajustesAbertos?.n) bloqueios.push(`${ajustesAbertos.n} ajuste(s) com o proprietário ainda a esclarecer até este mês (com ou sem valor): esclareça antes de fechar.`);
  if (posterior) bloqueios.push(`Já existe repasse de ${nomeMes(posterior.mes.slice(0, 7))}: estorne-o antes de fechar um mês anterior.`);
  if (previstos[0]?.n) avisos.push(`${previstos[0].n} lançamento(s) ainda previsto(s), isto é, dinheiro que pode não ter entrado: confira antes de pagar.`);
  if (calc.valor > 0 && !dono.chavePix.trim()) avisos.push("Sem chave Pix no cadastro do proprietário.");
  if (calc.contestado > 0) avisos.push(`Adiantamentos contestados (${(calc.contestado / 100).toFixed(2).replace(".", ",")}) ficam fora do desconto até a contestação ser resolvida.`);
  let diferenca = 0;
  if (atual && !posterior) {
    // O que vai para o próximo repasse é o saldo com os contestados somados de volta. Logo depois
    // do fechamento isso dá zero; se mudou (lançamento novo, contestação resolvida…), avisa.
    diferenca = calc.saldo + calc.contestado - (atual.saldo + atual.contestado - atual.valor);
    if (diferenca !== 0) avisos.push(`Depois do fechamento, o acerto até este mês mudou em ${(diferenca / 100).toFixed(2).replace(".", ",")}: a diferença entra no próximo repasse.`);
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
    // Inclui os já quitados: "empresa assume" quita o adiantamento e lança a compensação (que
    // entra acima em `depois`); o que estava fora do desconto no repasse sai daqui, e o efeito é zero.
    const deste = (await listarAdiantamentos(db, org, { proprietarioId: dono.id })).filter((a) => a.data < lim.fim);
    if (deste.length) {
      const contestacoes = await db
        .select({ adiantamentoId: contestacoesAdiantamento.adiantamentoId, valor: contestacoesAdiantamento.valor, abertaEm: contestacoesAdiantamento.abertaEm, resolvidaEm: contestacoesAdiantamento.resolvidaEm })
        .from(contestacoesAdiantamento)
        .where(and(eq(contestacoesAdiantamento.organizacaoId, org), inArray(contestacoesAdiantamento.adiantamentoId, deste.map((a) => a.id))));
      const corte = posterior.criadoEm.getTime();
      for (const a of deste) {
        // Contestação aberta no momento do repasse: o valor dela ficou fora do desconto.
        const naquele = contestacoes.find((c) => c.adiantamentoId === a.id && c.abertaEm.getTime() <= corte && (!c.resolvidaEm || c.resolvidaEm.getTime() > corte));
        const agora = a.situacao === "contestado";
        // Contestado fica fora do desconto (volta ao saldo a favor do proprietário).
        if (naquele && !agora) diferenca -= naquele.valor;
        if (!naquele && agora) diferenca += a.aberto;
      }
    }
    if (diferenca !== 0) avisos.push(`Depois do repasse de ${nomeMes(posterior.mes.slice(0, 7))}, o acerto até este mês mudou em ${(diferenca / 100).toFixed(2).replace(".", ",")}: a diferença entra no próximo repasse.`);
  }
  return { ...calc, proprietarioId: dono.id, nome: dono.nome, email: dono.email, chavePix: dono.chavePix, imoveis: vinculos.map((v) => v.codigo), bloqueios, avisos, repasse: atual ?? null,
    emConferencia: Boolean(pendentes[0]?.n || ajustesAbertos?.n),
    repassePosterior: primeiroPosterior ? primeiroPosterior.mes.slice(0, 7) : null,
    diferencaPosFechamento: diferenca,
  };
}

/**
 * Situação do mês para cada proprietário com algo a ver: saldo, adiantamentos em aberto ou
 * repasse já feito. `proprietarioIds` restringe (ex.: um só).
 */
/** `incluirVazios`: devolve também quem não tem saldo nem repasse (ex.: só um ajuste sem valor a esclarecer). */
export async function preverRepasses(db: Db, org: string, mes: string, hoje: string, proprietarioIds?: string[], incluirVazios = false): Promise<PrevisaoRepasse[]> {
  if (!limitesDoMes(mes)) return [];
  const c = [eq(proprietarios.organizacaoId, org)];
  if (proprietarioIds) c.push(inArray(proprietarios.id, proprietarioIds.filter(uuidValido)));
  if (proprietarioIds && !proprietarioIds.some(uuidValido)) return [];
  const donos = await db
    .select({ id: proprietarios.id, nome: proprietarios.nome, email: proprietarios.email, chavePix: proprietarios.chavePix })
    .from(proprietarios)
    .where(and(...c))
    .orderBy(asc(proprietarios.nome));
  const lista = await Promise.all(donos.map((d) => calcularDono(db, org, d, mes, hoje)));
  return incluirVazios ? lista : lista.filter((p) => p.repasse || p.saldo !== 0 || p.contestado !== 0 || p.aDescontar !== 0);
}

type Resultado = { ok: true; id: string } | { ok: false; erro: string };

const chavePrefixo = (repasseId: string) => `repasse:${repasseId}:`;

/** Fecha o mês de um proprietário: grava o repasse, os lançamentos e os descontos. */
export async function fecharMes(db: Db, org: string, proprietarioId: string, mes: string, hoje: string, autorId: string | null): Promise<Resultado> {
  const lim = limitesDoMes(mes);
  if (!lim) return { ok: false, erro: "Mês inválido." };
  if (!uuidValido(proprietarioId)) return { ok: false, erro: "Proprietário não encontrado." };
  try {
    return await fecharNaTransacao(db, org, proprietarioId, mes, lim, hoje, autorId);
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
): Promise<Resultado> {
  return db.transaction(async (tx) => {
    // Trava o proprietário: dois fechamentos ao mesmo tempo não passam daqui juntos.
    const [dono] = await tx
      .select({ id: proprietarios.id, nome: proprietarios.nome, email: proprietarios.email, chavePix: proprietarios.chavePix })
      .from(proprietarios)
      .where(and(eq(proprietarios.id, proprietarioId), eq(proprietarios.organizacaoId, org)))
      .for("update");
    if (!dono) return { ok: false as const, erro: "Proprietário não encontrado." };
    const p = await calcularDono(tx, org, dono, mes, hoje);
    if (p.repasse) return { ok: false as const, erro: "Este mês já foi fechado para este proprietário." };
    if (p.bloqueios.length) return { ok: false as const, erro: p.bloqueios[0] };
    if (p.valor <= 0) return { ok: false as const, erro: "Nada a repassar neste mês." };

    const [r] = await tx
      .insert(repasses)
      .values({ organizacaoId: org, proprietarioId, mes: lim.inicio, saldo: p.saldo, descontado: p.aDescontar, contestado: p.contestado, valor: p.valor, criadoPor: autorId })
      .returning();
    const ids = [...p.porImovel.keys()].filter((k): k is string => k !== null);
    const codigos = new Map(
      ids.length ? (await tx.select({ id: imoveis.id, codigo: imoveis.codigo }).from(imoveis).where(inArray(imoveis.id, ids))).map((i) => [i.id, i.codigo]) : [],
    );
    const nomeDoMes = nomeMes(mes);
    await lancar(
      tx,
      org,
      [...p.porImovel].map(([imovelId, v]) => ({
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
      autorId,
    );
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
      mudancas: { repasse: [null, `${nomeDoMes}: ${p.valor} (saldo ${p.saldo}, descontado ${p.aDescontar}, contestado fora ${p.contestado})`] },
    });
    return { ok: true as const, id: r.id };
  });
}

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

/** Marca o repasse como pago (os lançamentos passam a realizados, com a data do Pix). */
export async function marcarRepassePago(db: Db, org: string, id: string, data: string, hoje: string, autorId: string | null): Promise<Resultado> {
  if (!dataValida(data)) return { ok: false, erro: "Data do pagamento inválida." };
  if (data > hoje) return { ok: false, erro: "A data do pagamento não pode ser no futuro." };
  return db.transaction(async (tx) => {
    const r = await travarRepasse(tx, org, id);
    if (!r || r.estornadoEm) return { ok: false as const, erro: "Repasse não encontrado." };
    if (r.situacao !== "a_pagar") return { ok: false as const, erro: "Este repasse já está pago." };
    // O Pix só pode ter sido feito depois do fim do mês fechado (a partir do dia 1º seguinte).
    const lim = limitesDoMes(r.mes.slice(0, 7))!;
    if (data < lim.fim) return { ok: false as const, erro: `A data do pagamento não pode ser antes de ${lim.fim.split("-").reverse().join("/")}.` };
    for (const l of await lancamentosDoRepasse(tx, org, id)) await mudarEstado(tx, org, l.id, "realizado", autorId, data);
    await tx.update(repasses).set({ situacao: "pago" as SituacaoRepasse, dataPagamento: data }).where(eq(repasses.id, id));
    await registrarAuditoria(tx, { organizacaoId: org, usuarioId: autorId, acao: "repasse.pagar", entidade: "repasse", entidadeId: id, mudancas: { situacao: ["a pagar", `pago em ${data}`] } });
    return { ok: true as const, id };
  });
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
    const [posterior] = await tx
      .select({ id: repasses.id })
      .from(repasses)
      .where(and(eq(repasses.proprietarioId, r.proprietarioId), gt(repasses.mes, r.mes), isNull(repasses.estornadoEm)));
    if (posterior) return { ok: false as const, erro: "Há um repasse de mês posterior: estorne-o primeiro." };
    for (const l of await lancamentosDoRepasse(tx, org, id)) {
      const [ja] = await tx.select({ id: lancamentos.id }).from(lancamentos).where(eq(lancamentos.estornoDe, l.id));
      if (!ja) await estornar(tx, org, l.id, `Repasse estornado: ${m}`, autorId, r.situacao === "pago" ? hoje : undefined);
    }
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
    .orderBy(desc(repasses.mes), desc(repasses.criadoEm));
}
