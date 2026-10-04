/**
 * Extrato do proprietário (M4.10): a parte dele em cada reserva, por mês de competência (o
 * lançamento "direito_proprietario" do motor, M4.2), e a situação de cada parte — uma regra, um
 * lugar: o portal, o painel, o repasse antecipado e o fechamento do mês leem daqui.
 *
 * - **informação**: o canal pagou o proprietário direto (`split`, padrão do Airbnb): não entra em
 *   repasse nenhum.
 * - **a liberar**: a empresa recebe, mas ainda falta algo — quem recebe a confirmar, reserva em
 *   conferência, check-in ainda não aconteceu ou o dinheiro ainda não está registrado com a
 *   empresa (recebimento da reserva, M4.4/M8.2 ou à mão). Cada caso com o motivo escrito.
 * - **disponível**: check-in já passou (entrada ≤ ontem, no fuso do imóvel) e o dinheiro está com a
 *   empresa; entra no próximo repasse e ainda não compôs nenhum.
 * - **repassado**: já saiu num repasse (fechamento ou antecipado) que está em vigor. Se a parte foi
 *   recalculada depois de um fechamento antigo (migração 0049), o repasse incluiu o valor de então
 *   (`repasse.valor`) e a `diferenca` é acertada, ou descontada, pelo fechamento mensal (pelo acerto).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type EstadoLancamento, imoveis, lancamentos, repasseItens, repasses, reservas, type SituacaoRepasse, type TipoRepasse } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { lancamentoEmConferencia, lancamentoEmVigor } from "@/portal/posse";
import { dinheiroComAEmpresa, type RecebidoDaReserva, recebidoPorReserva } from "./recebimentos";

export type QuemRecebeParte = "empresa" | "split" | "a_confirmar";
export type SituacaoParte = "informacao" | "a_liberar" | "disponivel" | "repassado";
export const NOMES_SITUACAO_PARTE: Record<SituacaoParte, string> = { informacao: "Paga pelo canal", a_liberar: "A liberar", disponivel: "Disponível", repassado: "Repassada" };

export type RepasseDaParte = {
  id: string;
  tipo: TipoRepasse;
  data: string;
  situacao: SituacaoRepasse;
  dataPagamento: string | null;
  /** O que este repasse incluiu desta parte (o item). Igual ao valor da parte, salvo recálculo depois de fechamento antigo. */
  valor: number;
};

export type ParteBruta = {
  lancamentoId: string;
  proprietarioId: string;
  reservaId: string;
  codigoReserva: string;
  imovelId: string;
  codigoImovel: string;
  /** Mês de competência ("AAAA-MM-01"). */
  competencia: string;
  /** Parte do proprietário neste mês (valor do lançamento). */
  valor: number;
  /** Efeito no acerto: 0 quando o canal paga direto (split) ou quando está pendente. */
  efeitoSaldo: number;
  estado: EstadoLancamento;
  checkin: string;
  checkout: string;
  hospede: string;
  /** Hoje, no fuso do imóvel. */
  hoje: string;
  recebido: RecebidoDaReserva;
  emConferencia: boolean;
  repasse: RepasseDaParte | null;
};

export type Parte = ParteBruta & {
  quemRecebe: QuemRecebeParte;
  situacao: SituacaoParte;
  motivo: string;
  /** Repassada: valor atual menos o que o repasse incluiu (recálculo depois do repasse). Positiva é acertada, negativa descontada, pelo fechamento mensal. */
  diferenca: number;
};

const dataBr = (d: string) => d.split("-").reverse().join("/");

/** A regra única de disponibilidade (pura). */
export function classificarParte(p: ParteBruta): Parte {
  const quemRecebe: QuemRecebeParte = p.estado === "pendente" ? "a_confirmar" : p.efeitoSaldo === 0 ? "split" : "empresa";
  const com = (situacao: SituacaoParte, motivo: string, diferenca = 0): Parte => ({ ...p, quemRecebe, situacao, motivo, diferenca });
  if (p.repasse) {
    const r = p.repasse;
    const pago = r.situacao === "pago" ? ` (pago${r.dataPagamento ? ` em ${dataBr(r.dataPagamento)}` : ""})` : r.situacao === "a_pagar" ? " (a pagar)" : "";
    // Parte recalculada depois do repasse (só por fechamento antigo, migração 0049): o repasse incluiu o valor de
    // então; a diferença não fica escondida — está no acerto do mês e vai para o próximo fechamento mensal.
    const diferenca = p.valor - r.valor;
    const recalculo = diferenca === 0 ? "" : ` Recalculada depois: o repasse incluiu ${formatBRL(r.valor)}; a diferença de ${formatBRL(Math.abs(diferenca))} ${diferenca > 0 ? "a mais é acertada" : "a menos é descontada"} pelo fechamento mensal.`;
    // M4.11: parte de antes do início do sistema, já acertada fora dele — nunca entra em outro repasse.
    if (r.tipo === "por_fora") return com("repassado", `Acertada por fora, antes do início do sistema (até ${dataBr(r.data)}).${recalculo}`, diferenca);
    return com("repassado", `${r.tipo === "fechamento" ? "No fechamento" : "Repasse"} de ${dataBr(r.data)}${pago}.${recalculo}`, diferenca);
  }
  if (quemRecebe === "a_confirmar") return com("a_liberar", "Quem recebe o dinheiro desta reserva ainda está a confirmar pela empresa: fica fora de qualquer repasse até definir.");
  if (quemRecebe === "split") return com("informacao", "O canal paga sua parte direto a você: não entra em repasse.");
  if (p.emConferencia) return com("a_liberar", "Reserva em conferência: a empresa precisa esclarecer os valores antes do repasse.");
  if (p.checkin >= p.hoje) return com("a_liberar", `Libera depois do check-in (${dataBr(p.checkin)}), com o dinheiro já com a empresa.`);
  if (!dinheiroComAEmpresa(p.recebido)) {
    return com(
      "a_liberar",
      p.recebido.recebido <= 0
        ? "A empresa ainda não registrou o recebimento desta reserva: nunca se repassa o que ainda não entrou."
        : `Recebido ${formatBRL(p.recebido.recebido)} de ${formatBRL(p.recebido.devido)}: libera quando o restante entrar.`,
    );
  }
  return com("disponivel", "Disponível para o próximo repasse.");
}

/**
 * `ajusteNoFechamento`: soma das diferenças de recálculo das partes repassadas — acertada (ou descontada) pelo fechamento
 * mensal, que pode já ter acontecido. `acertadoPorFora` (M4.11): partes de antes do início do sistema, pagas fora dele —
 * à parte do "já repassado", que é o que o sistema pagou.
 */
export type ResumoPartes = { aLiberar: number; disponivel: number; repassadoAPagar: number; repassadoPago: number; informacao: number; ajusteNoFechamento: number; acertadoPorFora: number };

export function resumirPartes(partes: readonly Parte[]): ResumoPartes {
  const r: ResumoPartes = { aLiberar: 0, disponivel: 0, repassadoAPagar: 0, repassadoPago: 0, informacao: 0, ajusteNoFechamento: 0, acertadoPorFora: 0 };
  for (const p of partes) {
    if (p.situacao === "a_liberar") r.aLiberar += p.valor;
    else if (p.situacao === "disponivel") r.disponivel += p.valor;
    else if (p.situacao === "informacao") r.informacao += p.valor;
    else {
      // Repassado conta o que o repasse incluiu; a diferença do recálculo vai à parte.
      if (p.repasse?.tipo === "por_fora") r.acertadoPorFora += p.valor - p.diferenca;
      else if (p.repasse?.situacao === "pago") r.repassadoPago += p.valor - p.diferenca;
      else r.repassadoAPagar += p.valor - p.diferenca;
      r.ajusteNoFechamento += p.diferenca;
    }
  }
  return r;
}

/**
 * Partes do proprietário em vigor no livro, classificadas. `agora` define "hoje" no fuso de cada
 * imóvel. Em sequência (não Promise.all): roda também dentro de transação, numa conexão só.
 */
export async function partesDoProprietario(db: Db, organizacaoId: string, proprietarioId: string, agora: Date = new Date(), o: { reservaIds?: readonly string[] } = {}): Promise<Parte[]> {
  if (!uuidValido(proprietarioId)) return [];
  const reservaIds = o.reservaIds?.filter(uuidValido);
  if (reservaIds && !reservaIds.length) return [];
  const linhas = await db
    .select({
      lancamentoId: lancamentos.id,
      reservaId: lancamentos.reservaId,
      imovelId: lancamentos.imovelId,
      competencia: lancamentos.competencia,
      valor: lancamentos.valor,
      efeitoSaldo: lancamentos.efeitoSaldo,
      estado: lancamentos.estado,
      emConferencia: sql<boolean>`coalesce(${lancamentoEmConferencia()}, false)`,
      codigoReserva: reservas.codigo,
      checkin: reservas.checkin,
      checkout: reservas.checkout,
      hospede: reservas.hospedeNome,
      codigoImovel: imoveis.codigo,
      fuso: imoveis.fuso,
    })
    .from(lancamentos)
    .innerJoin(reservas, eq(reservas.id, lancamentos.reservaId))
    .innerJoin(imoveis, eq(imoveis.id, lancamentos.imovelId))
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.tipo, "direito_proprietario"),
        eq(lancamentos.proprietarioId, proprietarioId),
        lancamentoEmVigor(db),
        reservaIds ? inArray(lancamentos.reservaId, reservaIds) : undefined,
      ),
    )
    .orderBy(asc(reservas.checkin), asc(reservas.codigo), asc(lancamentos.competencia));
  if (!linhas.length) return [];
  const itens = await db
    .select({ lancamentoId: repasseItens.lancamentoId, id: repasses.id, tipo: repasses.tipo, data: repasses.data, situacao: repasses.situacao, dataPagamento: repasses.dataPagamento, valor: repasseItens.valor })
    .from(repasseItens)
    .innerJoin(repasses, eq(repasses.id, repasseItens.repasseId))
    .where(and(eq(repasseItens.organizacaoId, organizacaoId), inArray(repasseItens.lancamentoId, linhas.map((l) => l.lancamentoId)), isNull(repasseItens.liberadoEm)));
  const porLancamento = new Map(itens.map((i) => [i.lancamentoId, { id: i.id, tipo: i.tipo, data: i.data, situacao: i.situacao, dataPagamento: i.dataPagamento, valor: i.valor } satisfies RepasseDaParte]));
  const recebidos = await recebidoPorReserva(db, organizacaoId, [...new Set(linhas.map((l) => l.reservaId!))]);
  return linhas.map((l) =>
    classificarParte({
      lancamentoId: l.lancamentoId,
      proprietarioId,
      reservaId: l.reservaId!,
      codigoReserva: l.codigoReserva,
      imovelId: l.imovelId!,
      codigoImovel: l.codigoImovel,
      competencia: l.competencia,
      valor: l.valor,
      efeitoSaldo: l.efeitoSaldo,
      estado: l.estado,
      checkin: l.checkin,
      checkout: l.checkout,
      hospede: l.hospede,
      hoje: hojeISO(l.fuso, agora),
      recebido: recebidos.get(l.reservaId!) ?? { recebido: 0, devido: 0 },
      emConferencia: l.emConferencia === true,
      repasse: porLancamento.get(l.lancamentoId) ?? null,
    }),
  );
}

/** Só as partes disponíveis (as que um repasse antecipado reúne). */
export async function partesDisponiveis(db: Db, organizacaoId: string, proprietarioId: string, agora: Date = new Date()): Promise<Parte[]> {
  return (await partesDoProprietario(db, organizacaoId, proprietarioId, agora)).filter((p) => p.situacao === "disponivel");
}
