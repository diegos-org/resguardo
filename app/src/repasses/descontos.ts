/**
 * Desconto do proprietário (M8.2c; o M8.2e reaproveita pela regra geral, `lancarAcertoDoProprietario`): dinheiro do site que voltou ao hóspede depois de a parte do
 * proprietário naquela reserva já ter sido repassada. "Desconto no repasse seguinte" ao pé da letra: é uma **parte
 * negativa** (lançamento "direito_proprietario" com valor e efeito no acerto negativos, origem "cancelamento") na
 * competência do mês corrente — nunca no passado: o mês já fechado e o relatório já enviado não mudam. Ela fica
 * disponível na hora (`classificarParte`), e o próximo repasse, de qualquer tipo (antecipado ou fechamento), a vincula
 * como item negativo e a desconta. Se as partes disponíveis não cobrem o desconto, o antecipado espera e o fechamento
 * mostra o que o proprietário deve. Uma regra, um lugar: o painel, o portal e o Início leem `descontosDoProprietario`.
 *
 * O espelho da parte de um mês que movimentou dinheiro sem a parte ter sido paga ao proprietário (só uma receita dada
 * como realizada, por exemplo) não é desconto: ele **anula** a parte original, que nunca saiu (`espelhoAnulaAParte`). As
 * duas ficam disponíveis juntas e entram juntas no próximo repasse, somando zero — o proprietário nunca perde o que não
 * recebeu, nem recebe o que voltou ao hóspede.
 */
import { and, asc, eq, gte, inArray, isNull, lt, not, type SQL, sql } from "drizzle-orm";
import { lancamentos, proprietarios, repasseItens, repasses, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { type Lancamento, lancar, LancamentoInvalido } from "@/financeiro/ledger";
import { ehChaveDeContestacao, ORIGEM_LANCAMENTO_CONTESTACAO } from "@/pagamentos/contestacao-regras";
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

/**
 * A parte original (`original`, id em SQL) nunca saiu para o proprietário sem o espelho (`espelho`): não compõe repasse
 * em vigor, a não ser o mesmo repasse em que o espelho está, e não está realizada (paga à mão) — salvo pelo pagamento
 * desse mesmo repasse, que realiza os dois juntos. Então os dois se anulam.
 */
const parteNaoPagaSemOEspelho = (original: SQL, espelho: SQL) => {
  const noRepasse = (comOEspelho: boolean) => sql`exists (
    select 1 from ${repasseItens} ri join ${repasses} rr on rr.id = ri.repasse_id
    where ri.lancamento_id = ${original} and ri.liberado_em is null and rr.estornado_em is null
      and ${sql.raw(comOEspelho ? "" : "not ")}exists (select 1 from ${repasseItens} rj where rj.repasse_id = ri.repasse_id and rj.lancamento_id = ${espelho} and rj.liberado_em is null))`;
  return sql`(not ${noRepasse(false)}
  and (not exists (select 1 from ${lancamentos} o where o.id = ${original} and o.estado in ('realizado', 'conciliado')) or ${noRepasse(true)}))`;
};

/**
 * Condição sobre `lancamentos` (a parte negativa de origem "cancelamento"): é o espelho de uma parte em vigor que nunca
 * foi paga ao proprietário — anula a parte, não é desconto (ver o topo do arquivo). Uma regra, um lugar: o extrato
 * (`partesDoProprietario`), a lista de descontos e o aviso do Início leem daqui.
 */
export const espelhoAnulaAParte = () => sql`(${lancamentos.chaveOrigem} like ${`${PREFIXO_ESPELHO_LIKE}%`} and exists (
    select 1 from ${lancamentos} po
    where po.organizacao_id = ${lancamentos.organizacaoId} and po.reserva_id = ${lancamentos.reservaId} and po.tipo = 'direito_proprietario'
      and po.id::text = split_part(${lancamentos.chaveOrigem}, ':', 4)
      and po.estorno_de is null and not exists (select 1 from ${lancamentos} px where px.estorno_de = po.id)
      and ${parteNaoPagaSemOEspelho(sql`po.id`, sql`${lancamentos.id}`)}))`;

/** Condição sobre `lancamentos` (a parte do motor): um espelho em vigor a anula (o gêmeo de `espelhoAnulaAParte`). */
export const parteAnuladaPeloEspelho = () => sql`exists (
    select 1 from ${lancamentos} pe
    where pe.organizacao_id = ${lancamentos.organizacaoId} and pe.reserva_id = ${lancamentos.reservaId} and pe.tipo = 'direito_proprietario'
      and pe.origem = ${ORIGEM_CANCELAMENTO} and pe.valor < 0 and pe.chave_origem like ${PREFIXO_ESPELHO_LIKE} || ${lancamentos.id}::text
      and pe.estorno_de is null and not exists (select 1 from ${lancamentos} px where px.estorno_de = pe.id)
      and ${parteNaoPagaSemOEspelho(sql`${lancamentos.id}`, sql`pe.id`)})`;

const MES_DO_DESCONTO = /^\d{4}-(0[1-9]|1[0-2])-01$/;
/** O 1º dia do mês corrente em São Paulo: a única competência que um desconto pode ter (nunca o passado). */
export const mesDoDesconto = (agora: Date) => `${hojeISO("America/Sao_Paulo", agora).slice(0, 7)}-01`;

/** As origens de um acerto do proprietário no mês corrente: o desconto do cancelamento (M8.2c) e as linhas da disputa do pagamento (M8.2e). */
export type OrigemDoAcerto = typeof ORIGEM_CANCELAMENTO | typeof ORIGEM_LANCAMENTO_CONTESTACAO;

/**
 * Lança um acerto do proprietário (uma parte, `direito_proprietario`, com valor e efeito no acerto iguais): a regra única da
 * competência no mês corrente em São Paulo (`mesDoDesconto(agora)`) — um mês anterior, que já pode ter sido fechado e
 * enviado, é recusado, e um mês seguinte atrasaria o acerto. `valor` com sinal, em centavos, nunca 0: o débito é negativo
 * (o desconto do cancelamento, o valor segurado pela disputa), a reversão é positiva (a disputa ganha ou encerrada sem
 * efeito, o ajuste da perdida). `origem`: "cancelamento" (M8.2c) ou "contestacao_pagamento" (M8.2e, só com uma chave da
 * disputa, `chavesDaContestacao`). `chave`: idempotência (repetir devolve o mesmo lançamento). Nasce `previsto`, para quem
 * recebeu a parte; roda dentro da transação de quem chama, com a trava do motor da reserva já tomada. A linha fica
 * disponível ou espera junto com a parte da reserva pela regra de `classificarParte`.
 */
export async function lancarAcertoDoProprietario(
  tx: Db,
  organizacaoId: string,
  origem: OrigemDoAcerto,
  d: { chave: string; proprietarioId: string; imovelId: string; reservaId: string; valor: number; competencia: string; descricao: string },
  autorId: string | null,
  agora: Date,
): Promise<Lancamento> {
  if (origem !== ORIGEM_CANCELAMENTO && origem !== ORIGEM_LANCAMENTO_CONTESTACAO) throw new LancamentoInvalido("Origem do acerto do proprietário inválida.");
  if (!Number.isSafeInteger(d.valor) || d.valor === 0) throw new LancamentoInvalido("O acerto do proprietário precisa de um valor em centavos diferente de zero.");
  if (!MES_DO_DESCONTO.test(d.competencia)) throw new LancamentoInvalido("A competência do desconto é o primeiro dia de um mês.");
  if (d.competencia !== mesDoDesconto(agora)) throw new LancamentoInvalido(`A competência do desconto é o mês corrente (${mesDoDesconto(agora).split("-").reverse().join("/")}): nunca um mês que já pode ter sido fechado.`);
  if (!d.chave.trim()) throw new LancamentoInvalido("O desconto precisa de chave de origem.");
  if (origem === ORIGEM_LANCAMENTO_CONTESTACAO && !ehChaveDeContestacao(d.chave)) throw new LancamentoInvalido("A linha da disputa do pagamento precisa da chave da disputa.");
  const [l] = await lancar(
    tx,
    organizacaoId,
    [
      {
        tipo: "direito_proprietario",
        descricao: d.descricao,
        valor: d.valor,
        efeitoSaldo: d.valor,
        competencia: d.competencia,
        estado: "previsto",
        imovelId: d.imovelId,
        reservaId: d.reservaId,
        proprietarioId: d.proprietarioId,
        origem,
        chaveOrigem: d.chave,
      },
    ],
    autorId,
  );
  return l;
}

/**
 * Lança o desconto (a parte negativa) de `valor` centavos (> 0; o sinal é posto aqui) para o proprietário que recebeu a
 * parte. `competencia`: o 1º dia do mês corrente em São Paulo (`mesDoDesconto(agora)`) — um mês anterior, que já pode ter
 * sido fechado e enviado, é recusado, e um mês seguinte atrasaria o desconto. `chave`: idempotência (ex.:
 * `cancelamento:<id>:espelho:<lançamento original>`). Roda dentro da transação de quem chama, com a trava do motor da
 * reserva já tomada. O M8.2c; a regra é a de `lancarAcertoDoProprietario`, com a origem "cancelamento".
 */
export async function lancarDescontoDoProprietario(
  tx: Db,
  organizacaoId: string,
  d: { chave: string; proprietarioId: string; imovelId: string; reservaId: string; valor: number; competencia: string; descricao: string },
  autorId: string | null,
  agora: Date,
): Promise<Lancamento> {
  if (!Number.isSafeInteger(d.valor) || d.valor <= 0) throw new LancamentoInvalido("O desconto precisa ser um valor positivo em centavos.");
  return lancarAcertoDoProprietario(tx, organizacaoId, ORIGEM_CANCELAMENTO, { ...d, valor: -d.valor }, autorId, agora);
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

/** Condição: o desconto de cancelamento (parte negativa de origem "cancelamento") em vigor — o espelho que só anula uma parte nunca paga não é desconto. */
const descontoEmVigor = (db: Db, organizacaoId: string) =>
  and(
    eq(lancamentos.organizacaoId, organizacaoId),
    eq(lancamentos.tipo, "direito_proprietario"),
    eq(lancamentos.origem, ORIGEM_CANCELAMENTO),
    lt(lancamentos.valor, 0),
    lancamentoEmVigor(db),
    not(espelhoAnulaAParte()),
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
