/**
 * Acerto por fora (M4.11). Decisão de Diego (4/10/2026): o sistema vale a partir de 1/10/2026, e tudo o que é de
 * antes — parte de reserva, comissão, despesa, ajuste — já foi acertado fora dele. Para o livro não pagar nem
 * cobrar isso de novo, cada proprietário recebe um repasse do tipo "por_fora", já pago (sem Pix nem e-mail pelo
 * sistema), com:
 * - um item para cada parte de reserva anterior ao início que a empresa receberia (vínculo único: a parte nunca
 *   entra em antecipado nem em fechamento, e o recebimento de uma reserva que atravessa o início libera só a parte
 *   de depois);
 * - um lançamento "repasse" por imóvel e mês que zera o acerto daquele mês (o acerto até a véspera fica em zero).
 * Reexecutável: só o que ainda não foi coberto entra. Estornável como qualquer repasse (o mais recente primeiro).
 * A data vive em Configurações → Repasses (chave `inicio_sistema`, sempre dia 1º de um mês: as partes de reserva
 * são por mês); quem marca é a equipe, em Financeiro → Repasses.
 * M4.12: o que é "de antes" segue a data em que o canal pagou a reserva (`./inicio`): reserva paga antes do início é
 * marcada inteira (as partes de meses a partir do início também, com um lançamento de acerto naquele mês que compensa
 * só elas); reserva paga a partir do início fica inteira no sistema; a que atravessa sem data bloqueia o proprietário
 * até a equipe registrar o recebimento com a data certa.
 */
import { and, asc, eq, isNotNull, isNull, lt, or, sql, sum } from "drizzle-orm";
import { listarAdiantamentos } from "@/adiantamentos/adiantamentos";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { travarConfig } from "@/configuracoes/armazem";
import { ajustes, imoveis, lancamentos, proprietarioImoveis, proprietarios, repasses } from "@/db/schema";
import type { Db } from "@/db/types";
import { lancar, mudarEstado } from "@/financeiro/ledger";
import { lerComReservasTravadas } from "@/financeiro/trava";
import { formatBRL } from "@/lib/money";
import { lancamentoEmConferencia } from "@/portal/posse";
import { type Parte, partesDoProprietario, type QuemRecebeParte } from "./extrato";
import { avisoIndefinidas, ladoDoInicio, type LadoDoInicio, livroDeAntes } from "./inicio";
import { inicioDoSistemaValido, lerInicioDoSistema } from "./regras-config";
import { chavePrefixo, codigosDe, limitesDoMes, nomeMes, travarDono, vincularItens } from "./repasses";

export type SituacaoAntesDoInicio = {
  proprietarioId: string;
  nome: string;
  /** Partes de reserva anteriores ao início ainda fora de qualquer repasse (as que seriam marcadas). */
  partes: number;
  valorPartes: number;
  /** Acerto até a véspera ainda em aberto: soma do livro por imóvel e mês. Pode dar zero com grupos que se anulam — por isso `gruposAbertos`. */
  saldoAberto: number;
  /** Quantos pares imóvel/mês ainda têm acerto diferente de zero (cada um vira um lançamento de acerto). Zero = nada a zerar. */
  gruposAbertos: number;
  /** O que impede marcar este proprietário; resolver antes. */
  bloqueios: string[];
};

export type ResultadoAcertoPorFora =
  | { ok: true; marcados: { proprietarioId: string; nome: string; repasseId: string; valor: number; partes: number }[]; semNada: string[]; recusados: { nome: string; motivo: string }[] }
  | { ok: false; erro: string };

/** Véspera do início: a data do repasse "por fora" (o último dia que ele cobre). */
export function vesperaDoInicio(inicio: string): string {
  const d = new Date(`${inicio}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const dataBr = (d: string) => d.split("-").reverse().join("/");

type Grupo = { imovelId: string | null; mes: string; total: number };
type Levantamento = { partes: Parte[]; grupos: Grupo[]; bloqueios: string[] };

const dosImoveisDele = (coluna: typeof lancamentos.imovelId | typeof ajustes.imovelId, donoId: string) =>
  sql`${coluna} in (select ${proprietarioImoveis.imovelId} from ${proprietarioImoveis} where ${proprietarioImoveis.proprietarioId} = ${donoId})`;

/**
 * O que há antes do início para um proprietário: as partes a marcar (a empresa recebe e ainda não estão em repasse),
 * o acerto em aberto por imóvel e mês (a mesma soma do fechamento, estornos incluídos — por isso reexecutar não repete)
 * e os bloqueios — os mesmos que travam um fechamento, limitados ao período anterior ao início.
 */
async function levantar(db: Db, org: string, donoId: string, inicio: string, agora: Date): Promise<Levantamento> {
  const todas = await partesDoProprietario(db, org, donoId, agora);
  // Lado do início por reserva (M4.12): pela data em que o canal pagou, não pelo mês de cada noite.
  const lados = new Map<string, { lado: LadoDoInicio; codigo: string; quemRecebe: QuemRecebeParte }>();
  for (const p of todas) if (!lados.has(p.reservaId)) lados.set(p.reservaId, { lado: ladoDoInicio(p, inicio)!, codigo: p.codigoReserva, quemRecebe: p.quemRecebe });
  const partes = todas.filter((p) => lados.get(p.reservaId)?.lado === "antes" && p.quemRecebe === "empresa" && p.situacao !== "repassado");
  const mesDe = sql<string>`to_char(${lancamentos.competencia}, 'YYYY-MM')`;
  const grupos: Grupo[] = (
    await db
      .select({ imovelId: lancamentos.imovelId, mes: mesDe, total: sum(lancamentos.efeitoSaldo) })
      .from(lancamentos)
      .where(and(eq(lancamentos.organizacaoId, org), eq(lancamentos.proprietarioId, donoId), livroDeAntes(inicio, lados)))
      .groupBy(lancamentos.imovelId, mesDe)
  )
    .map((g) => ({ imovelId: g.imovelId, mes: g.mes, total: Number(g.total ?? 0) }))
    .filter((g) => g.total !== 0)
    .sort((x, y) => x.mes.localeCompare(y.mes) || (x.imovelId ?? "").localeCompare(y.imovelId ?? ""));
  const bloqueios: string[] = [];
  const aviso = avisoIndefinidas([...lados.values()].filter((r) => r.lado === "indefinido" && r.quemRecebe === "empresa"), inicio);
  if (aviso) bloqueios.push(aviso);
  // Reserva já marcada como acertada por fora cuja data de pagamento mudou (recebimento estornado ou refeito): não se
  // marca por cima — a equipe estorna o acerto por fora e marca de novo.
  const desalinhadas = [...new Map(todas.filter((p) => p.repasse?.tipo === "por_fora" && lados.get(p.reservaId)?.lado !== "antes").map((p) => [p.reservaId, p.codigoReserva])).values()];
  if (desalinhadas.length) bloqueios.push(`${desalinhadas.length} reserva(s) marcada(s) como acertada(s) por fora cuja data de pagamento agora é a partir do início do sistema, ou desconhecida (${desalinhadas.join(", ")}): estorne o acerto por fora dela(s) em Financeiro → Repasses e marque de novo.`);
  // Em conferência no livro de antes (M4.12: inclui a parte de mês a partir do início de reserva paga antes dele — uma
  // reserva cancelada ou divergente depois de paga não pode ser dada como acertada): recusa até resolver.
  const emVigor = [isNull(lancamentos.estornoDe), sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`];
  const [conferencia] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, org), lancamentoEmConferencia(), livroDeAntes(inicio, lados), or(eq(lancamentos.proprietarioId, donoId), dosImoveisDele(lancamentos.imovelId, donoId)), ...emVigor));
  if (conferencia?.n) bloqueios.push(`${conferencia.n} lançamento(s) em conferência antes do início (quem recebe a confirmar, ajuste a esclarecer ou reserva que deixou de estar confirmada): resolva antes.`);
  const [abertos] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ajustes)
    .where(and(eq(ajustes.organizacaoId, org), eq(ajustes.afeta, "proprietario"), isNull(ajustes.esclarecidoEm), lt(ajustes.data, inicio), or(eq(ajustes.proprietarioId, donoId), dosImoveisDele(ajustes.imovelId, donoId))));
  if (abertos?.n) bloqueios.push(`${abertos.n} ajuste(s) com o proprietário a esclarecer antes do início: esclareça antes.`);
  const adiantamentos = (await listarAdiantamentos(db, org, { proprietarioId: donoId, somenteAbertos: true })).filter((a) => a.data < inicio);
  if (adiantamentos.length) bloqueios.push(`${adiantamentos.length} adiantamento(s) em aberto de antes do início (${formatBRL(adiantamentos.reduce((s, a) => s + a.aberto, 0))}): quite-os (foram acertados por fora) ou estorne-os antes.`);
  return { partes, grupos, bloqueios };
}

/**
 * Proprietários candidatos: com algum lançamento no livro (ativos ou não). Uma reserva paga antes do início pode ter
 * todas as noites depois dele (paga adiantado), então o mês de competência não serve de filtro; `levantar` decide.
 */
async function donosComPassado(db: Db, org: string): Promise<{ id: string; nome: string }[]> {
  return db
    .selectDistinct({ id: proprietarios.id, nome: proprietarios.nome })
    .from(lancamentos)
    .innerJoin(proprietarios, eq(proprietarios.id, lancamentos.proprietarioId))
    .where(and(eq(lancamentos.organizacaoId, org), isNotNull(lancamentos.proprietarioId)))
    .orderBy(asc(proprietarios.nome), asc(proprietarios.id));
}

/** Para o painel: por proprietário, o que ainda está antes do início fora de repasse e o que impede marcar. */
export async function situacaoAntesDoInicio(db: Db, org: string, inicio: string, agora = new Date()): Promise<SituacaoAntesDoInicio[]> {
  if (!inicioDoSistemaValido(inicio)) return [];
  const saida: SituacaoAntesDoInicio[] = [];
  for (const d of await donosComPassado(db, org)) {
    const l = await levantar(db, org, d.id, inicio, agora);
    if (!l.partes.length && !l.grupos.length && !l.bloqueios.length) continue;
    saida.push({ proprietarioId: d.id, nome: d.nome, partes: l.partes.length, valorPartes: l.partes.reduce((s, p) => s + p.valor, 0), saldoAberto: l.grupos.reduce((s, g) => s + g.total, 0), gruposAbertos: l.grupos.length, bloqueios: l.bloqueios });
  }
  return saida;
}

type Passo = { tipo: "marcado"; repasseId: string; valor: number; partes: number } | { tipo: "nada" } | { tipo: "recusado"; motivo: string };

/**
 * Marca como acertado por fora tudo o que é de antes do início: um repasse "por_fora" (pago na véspera do início) por
 * proprietário com algo a cobrir, numa transação por proprietário — proprietário travado, reservas das partes travadas
 * para o motor (como no antecipado) e o início do sistema reconferido sob a mesma trava que a configuração usa (uma
 * mudança no meio não marca com data velha). Quem tem bloqueio fica de fora, com o motivo; os outros seguem.
 */
export async function marcarAcertoPorFora(db: Db, org: string, inicio: string, autorId: string | null, agora = new Date()): Promise<ResultadoAcertoPorFora> {
  if (!inicioDoSistemaValido(inicio)) return { ok: false, erro: "Defina o início do sistema (dia 1º de um mês) em Configurações → Repasses antes de marcar." };
  const vespera = vesperaDoInicio(inicio);
  const marcados: Extract<ResultadoAcertoPorFora, { ok: true }>["marcados"] = [];
  const semNada: string[] = [];
  const recusados: { nome: string; motivo: string }[] = [];
  for (const d of await donosComPassado(db, org)) {
    const passo = await db.transaction(async (tx): Promise<Passo> => {
      const dono = await travarDono(tx, org, d.id);
      if (!dono) return { tipo: "recusado", motivo: "Proprietário não encontrado." };
      await travarConfig(tx, org, "inicio_sistema");
      const configurado = await lerInicioDoSistema(tx, org);
      if (configurado !== inicio) return { tipo: "recusado", motivo: `O início do sistema configurado é ${configurado ? dataBr(configurado) : "nenhum"}, não ${dataBr(inicio)}: recarregue a página e confira.` };
      const lev = await lerComReservasTravadas(tx, org, () => levantar(tx, org, dono.id, inicio, agora), (l) => l.partes.map((p) => p.reservaId));
      if (!lev) return { tipo: "recusado", motivo: "Reservas deste proprietário estão sendo recalculadas agora: tente de novo em instantes." };
      if (lev.bloqueios.length) return { tipo: "recusado", motivo: lev.bloqueios.join(" ") };
      if (!lev.partes.length && !lev.grupos.length) return { tipo: "nada" };
      const total = lev.grupos.reduce((s, g) => s + g.total, 0);
      const [r] = await tx
        .insert(repasses)
        .values({ organizacaoId: org, proprietarioId: dono.id, tipo: "por_fora", mes: `${vespera.slice(0, 7)}-01`, data: vespera, saldo: total, descontado: 0, contestado: 0, valor: total, situacao: "pago", dataPagamento: vespera, criadoPor: autorId })
        .returning();
      const ids = [...new Set([...lev.grupos.map((g) => g.imovelId).filter((x): x is string => x !== null), ...lev.partes.map((p) => p.imovelId)])];
      const codigos = new Map(ids.length ? (await tx.select({ id: imoveis.id, codigo: imoveis.codigo }).from(imoveis).where(sql`${imoveis.id} in ${ids}`)).map((i) => [i.id, i.codigo]) : []);
      // Um "repasse" por imóvel e mês, no último dia do mês: zera o acerto daquele mês. Mês a partir do início: só as
      // reservas pagas antes dele (M4.12) — o lançamento compensa a parte delas naquele mês, e nada mais.
      const gravados = await lancar(
        tx,
        org,
        lev.grupos.map((g) => ({
          tipo: "repasse" as const,
          descricao: `Acertado por fora, antes do início do sistema (${dataBr(inicio)}) — ${g.imovelId ? (codigos.get(g.imovelId) ?? "") : "geral"}, ${nomeMes(g.mes)}${`${g.mes}-01` >= inicio ? " (reservas pagas antes do início)" : ""}`.slice(0, 300),
          valor: 0,
          montante: g.total,
          efeitoSaldo: -g.total,
          competencia: limitesDoMes(g.mes)!.ultimoDia,
          estado: "previsto" as const,
          imovelId: g.imovelId,
          proprietarioId: dono.id,
          origem: "repasse",
          chaveOrigem: `${chavePrefixo(r.id)}${g.imovelId ?? "geral"}:${g.mes}`,
        })),
        autorId,
      );
      // Dinheiro já movimentado fora do sistema: tudo realizado na véspera, e as partes também (o motor não mexe mais nelas).
      for (const l of gravados) await mudarEstado(tx, org, l.id, "realizado", autorId, vespera);
      await vincularItens(tx, org, r.id, lev.partes);
      for (const p of lev.partes) await mudarEstado(tx, org, p.lancamentoId, "realizado", autorId, vespera);
      await registrarAuditoria(tx, {
        organizacaoId: org,
        usuarioId: autorId,
        acao: "repasse.por_fora",
        entidade: "repasse",
        entidadeId: r.id,
        mudancas: { repasse: [null, `acertado por fora até ${vespera}: ${total} (${lev.partes.length} parte(s)${lev.partes.length ? `, reservas ${codigosDe(lev.partes)}` : ""}, ${lev.grupos.length} lançamento(s) de acerto)`] },
      });
      return { tipo: "marcado", repasseId: r.id, valor: total, partes: lev.partes.length };
    });
    if (passo.tipo === "marcado") marcados.push({ proprietarioId: d.id, nome: d.nome, repasseId: passo.repasseId, valor: passo.valor, partes: passo.partes });
    else if (passo.tipo === "nada") semNada.push(d.nome);
    else recusados.push({ nome: d.nome, motivo: passo.motivo });
  }
  return { ok: true, marcados, semNada, recusados };
}

/** Frase do resultado para o painel (uma linha, sem supor nada). */
export function descreverAcertoPorFora(r: Extract<ResultadoAcertoPorFora, { ok: true }>, inicio: string): string {
  const partes = [
    r.marcados.length ? `Marcado como acertado por fora até ${dataBr(vesperaDoInicio(inicio))}: ${r.marcados.map((m) => `${m.nome} (${formatBRL(m.valor)}, ${m.partes} parte(s) de reserva)`).join("; ")}.` : "Nada novo a marcar antes do início.",
    r.recusados.length ? `Não marcado: ${r.recusados.map((x) => `${x.nome} — ${x.motivo}`).join(" ")}` : "",
  ];
  return partes.filter(Boolean).join(" ");
}
