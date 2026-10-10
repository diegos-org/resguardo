/**
 * Desconto do proprietário (M8.2c; o M8.2e reaproveita): dinheiro do site que voltou ao hóspede depois de a parte do
 * proprietário naquela reserva já ter sido repassada. "Desconto no repasse seguinte" ao pé da letra: é uma **parte
 * negativa** (lançamento "direito_proprietario" com valor e efeito no acerto negativos, origem "cancelamento") na
 * competência do mês corrente — nunca no passado: o mês já fechado e o relatório já enviado não mudam. Ela fica
 * disponível na hora (`classificarParte`), e o próximo repasse, de qualquer tipo (antecipado ou fechamento), a vincula
 * como item negativo e a desconta. Se as partes disponíveis não cobrem o desconto, o antecipado espera e o fechamento
 * mostra o que o proprietário deve. Uma regra, um lugar: o painel, o portal e o Início leem `descontosDoProprietario`.
 */
import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { lancamentos, proprietarios, repasseItens, repasses, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { type Lancamento, lancar, LancamentoInvalido } from "@/financeiro/ledger";
import { lancamentoEmVigor } from "@/portal/posse";

/** Origem dos lançamentos do acerto de um cancelamento pela política (espelhos e o desconto do proprietário). */
export const ORIGEM_CANCELAMENTO = "cancelamento";

/**
 * Chave do espelho, no mês do cancelamento, de um lançamento do motor de um mês que já movimentou dinheiro (§6.1):
 * uma por cancelamento e por lançamento original. O desconto do proprietário é o espelho da parte dele.
 */
export const chaveEspelhoDoCancelamento = (cancelamentoId: string, lancamentoOriginalId: string) => `cancelamento:${cancelamentoId}:espelho:${lancamentoOriginalId}`;
/** O mesmo formato, para achar em SQL o espelho de um lançamento qualquer (`like` + o id do original). */
export const PREFIXO_ESPELHO_LIKE = "cancelamento:%:espelho:";

const MES_DO_DESCONTO = /^\d{4}-(0[1-9]|1[0-2])-01$/;

/**
 * Lança o desconto (a parte negativa) de `valor` centavos (> 0; o sinal é posto aqui) para o proprietário que recebeu a
 * parte. `competencia`: o 1º dia do mês corrente (quem chama passa o mês do cancelamento, que ainda não pode estar
 * fechado). `chave`: idempotência (ex.: `cancelamento:<id>:espelho:<lançamento original>`). Roda dentro da transação de
 * quem chama, com a trava do motor da reserva já tomada.
 */
export async function lancarDescontoDoProprietario(
  tx: Db,
  organizacaoId: string,
  d: { chave: string; proprietarioId: string; imovelId: string; reservaId: string; valor: number; competencia: string; descricao: string },
  autorId: string | null,
): Promise<Lancamento> {
  if (!Number.isSafeInteger(d.valor) || d.valor <= 0) throw new LancamentoInvalido("O desconto precisa ser um valor positivo em centavos.");
  if (!MES_DO_DESCONTO.test(d.competencia)) throw new LancamentoInvalido("A competência do desconto é o primeiro dia de um mês.");
  if (!d.chave.trim()) throw new LancamentoInvalido("O desconto precisa de chave de origem.");
  const [l] = await lancar(
    tx,
    organizacaoId,
    [
      {
        tipo: "direito_proprietario",
        descricao: d.descricao,
        valor: -d.valor,
        efeitoSaldo: -d.valor,
        competencia: d.competencia,
        estado: "previsto",
        imovelId: d.imovelId,
        reservaId: d.reservaId,
        proprietarioId: d.proprietarioId,
        origem: ORIGEM_CANCELAMENTO,
        chaveOrigem: d.chave,
      },
    ],
    autorId,
  );
  return l;
}

export type DescontoDoProprietario = {
  lancamentoId: string;
  /** Mês de competência ("AAAA-MM-01"): o mês do cancelamento. */
  competencia: string;
  reservaCodigo: string;
  /** Centavos a descontar (positivo). */
  valor: number;
  criadoEm: Date;
  situacao: { tipo: "a_descontar" } | { tipo: "descontado"; repasse: string; data: string };
};

/** Condição: o desconto de cancelamento (parte negativa de origem "cancelamento") em vigor. */
const descontoEmVigor = (db: Db, organizacaoId: string) =>
  and(
    eq(lancamentos.organizacaoId, organizacaoId),
    eq(lancamentos.tipo, "direito_proprietario"),
    eq(lancamentos.origem, ORIGEM_CANCELAMENTO),
    lt(lancamentos.valor, 0),
    lancamentoEmVigor(db),
  );

/**
 * Descontos de cancelamento do proprietário em vigor, do mais antigo ao mais novo, com a situação: vinculado a um
 * repasse em vigor = descontado (o repasse e a data dele); senão, a descontar. `periodo`: só os de competência nele.
 */
export async function descontosDoProprietario(db: Db, organizacaoId: string, proprietarioId: string, o: { periodo?: { inicio: string; fim: string } } = {}): Promise<DescontoDoProprietario[]> {
  if (!uuidValido(proprietarioId)) return [];
  const linhas = await db
    .select({ lancamentoId: lancamentos.id, competencia: lancamentos.competencia, valor: lancamentos.valor, criadoEm: lancamentos.criadoEm, reservaCodigo: reservas.codigo })
    .from(lancamentos)
    .innerJoin(reservas, eq(reservas.id, lancamentos.reservaId))
    .where(
      and(
        descontoEmVigor(db, organizacaoId),
        eq(lancamentos.proprietarioId, proprietarioId),
        o.periodo ? and(gte(lancamentos.competencia, o.periodo.inicio), lt(lancamentos.competencia, o.periodo.fim)) : undefined,
      ),
    )
    .orderBy(asc(lancamentos.competencia), asc(lancamentos.criadoEm));
  if (!linhas.length) return [];
  const itens = await db
    .select({ lancamentoId: repasseItens.lancamentoId, repasseId: repasses.id, data: repasses.data })
    .from(repasseItens)
    .innerJoin(repasses, eq(repasses.id, repasseItens.repasseId))
    .where(and(eq(repasseItens.organizacaoId, organizacaoId), inArray(repasseItens.lancamentoId, linhas.map((l) => l.lancamentoId)), isNull(repasseItens.liberadoEm), isNull(repasses.estornadoEm)));
  const porLancamento = new Map(itens.map((i) => [i.lancamentoId, i]));
  return linhas.map((l) => {
    const i = porLancamento.get(l.lancamentoId);
    return {
      lancamentoId: l.lancamentoId,
      competencia: l.competencia,
      reservaCodigo: l.reservaCodigo,
      valor: -l.valor,
      criadoEm: l.criadoEm,
      situacao: i ? { tipo: "descontado" as const, repasse: i.repasseId, data: i.data } : { tipo: "a_descontar" as const },
    };
  });
}

/** Desconto a descontar há mais que isto vira aviso no Início (as partes disponíveis não o cobriram). */
export const DIAS_AVISO_DESCONTO = 7;

const dataBr = (d: string) => d.split("-").reverse().join("/");

/**
 * Avisos do Início (financeiro, da empresa toda): um por proprietário com desconto de cancelamento ainda a descontar há
 * mais de `DIAS_AVISO_DESCONTO` dias — o antecipado espera enquanto as partes disponíveis não cobrem o desconto, e o
 * fechamento mostra o que ele deve.
 */
export async function avisosDeDescontos(db: Db, organizacaoId: string, agora: Date): Promise<{ nivel: "atencao" | "info"; texto: string; link: string }[]> {
  const limite = new Date(agora.getTime() - DIAS_AVISO_DESCONTO * 86_400_000);
  const linhas = await db
    .select({ proprietarioId: lancamentos.proprietarioId, nome: proprietarios.nome, valor: lancamentos.valor, criadoEm: lancamentos.criadoEm })
    .from(lancamentos)
    .innerJoin(proprietarios, eq(proprietarios.id, lancamentos.proprietarioId))
    .where(
      and(
        descontoEmVigor(db, organizacaoId),
        lt(lancamentos.criadoEm, limite),
        sql`not exists (select 1 from ${repasseItens} i join ${repasses} r on r.id = i.repasse_id where i.lancamento_id = ${lancamentos.id} and i.liberado_em is null and r.estornado_em is null)`,
      ),
    )
    .orderBy(asc(proprietarios.nome), asc(lancamentos.criadoEm));
  const porDono = new Map<string, { nome: string; total: number; desde: Date }>();
  for (const l of linhas) {
    const x = porDono.get(l.proprietarioId!) ?? { nome: l.nome, total: 0, desde: l.criadoEm };
    x.total += -l.valor;
    porDono.set(l.proprietarioId!, x);
  }
  return [...porDono.values()].map((x) => ({
    nivel: "atencao" as const,
    texto: `Proprietário ${x.nome} tem ${formatBRL(x.total)} de desconto de cancelamento a descontar desde ${dataBr(hojeISO("America/Sao_Paulo", x.desde))} (as partes disponíveis não cobriram).`,
    link: "/painel/financeiro/repasses",
  }));
}
