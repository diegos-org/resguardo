/**
 * Pagamento no site (M8.2d) — o alvo da cobrança de uma tentativa: o pedido segurado da cotação (a tentativa da própria
 * reserva) ou as datas seguradas de uma alteração da reserva paga (a tentativa da diferença, que vive na mesma cotação, com
 * `alteracao_id`). Um lugar só para as duas formas (Pix e cartão), em todas as fases e em toda leitura: o valor a cobrar, o
 * prazo das datas, as tentativas que contam nos limites e nos "já pago", "em andamento" e "em análise", se o alvo ainda vale
 * e como estender (ou desfazer a extensão provisória d)o prazo. Sem isto, as regras "das tentativas da cotação" cancelariam
 * o Pix da diferença na próxima leitura do pagamento da reserva, e o contrário.
 *
 * A guarda do pagamento marcado como real (live_mode) no teste NÃO é do alvo: continua sobre todas as tentativas da cotação.
 * Quem chama já tem as travas (`travarCotacao`); o retrato acompanha o que se grava.
 */
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { alteracoesReserva, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { diaHoraNoFuso } from "@/lib/datas";
import { estenderHold, voltarHold } from "@/site/cotacoes";
import { situacaoEfetiva } from "./alteracao-regras";
import { type Alteracao, carenciaNoTravado, limiteDaAlteracao, type Pagamento, type Travado } from "./travas";

export type AlvoDaCobranca = {
  tipo: "reserva" | "alteracao";
  alteracaoId: string | null;
  /** A alteração do alvo (null no da reserva). */
  alteracao: Alteracao | null;
  /** O que se cobra: o total da cotação, ou a diferença da alteração. */
  valor: number;
  /** O prazo das datas do alvo (o da cotação, ou o da alteração); acompanha as extensões. */
  holdAte: Date | null;
  /** As tentativas do alvo: as da cotação sem alteração, ou as desta alteração. */
  tentativas: Pagamento[];
  /** O alvo ainda vale: pedido `pedido` com a cotação segurada; ou a alteração segurada (pela situação que vale agora), a reserva confirmada e sem cancelamento ativo. */
  valido: (agora: Date) => boolean;
  /** Estende o prazo das datas até `ate` (só estende); devolve se estendeu. */
  estender: (ate: Date, pagamentoId: string | null) => Promise<boolean>;
  /** Desfaz a extensão provisória: volta a `ate` só se o prazo ainda é o `provisorio` gravado. */
  voltar: (ate: Date, provisorio: Date, pagamentoId: string | null) => Promise<boolean>;
  /** A descrição da order no Mercado Pago (o hóspede vê na fatura e no comprovante). */
  descricao: (empresa: string) => string;
};

export type FalhaDoAlvo = { erro: "nao_oferecido" | "alteracao_mudou" };

export const TEXTO_ALTERACAO_MUDOU = "A alteração mudou enquanto a página estava aberta: atualize a página.";

const horaBr = (d: Date, fuso: string) => diaHoraNoFuso(d, fuso);
/** A observação da reserva-pedido diz até quando as novas datas estão seguradas (e se um pagamento estendeu). */
const OBSERVACAO_PRAZO_ALTERACAO = /até [^;]+(?: \(estendido pelo pagamento\))?;/;

/**
 * O alvo da cobrança. `alteracaoId` null = a reserva. Do formulário do site (`o.daLeitura` falso): a alteração tem de ser a
 * que está com as datas seguradas agora, com diferença a pagar; senão `alteracao_mudou` (a página ficou aberta de uma
 * alteração que já não vale). De uma leitura (`o.daLeitura`): qualquer alteração da reserva (a tentativa já existe; o alvo
 * só diz se ainda vale).
 */
export function alvoDaCobranca(tx: Db, organizacaoId: string, t: Travado, alteracaoId: string | null, agora: Date, o: { daLeitura?: boolean } = {}): AlvoDaCobranca | FalhaDoAlvo {
  if (!alteracaoId) {
    const daReserva: AlvoDaCobranca = {
      tipo: "reserva",
      alteracaoId: null,
      alteracao: null,
      valor: t.cotacao.total,
      holdAte: t.cotacao.holdAte,
      tentativas: t.tentativas.filter((x) => !x.alteracaoId),
      valido: () => t.reserva.estado === "pedido" && t.cotacao.estado === "segurada",
      async estender(ate, pagamentoId) {
        if (!(await estenderHold(tx, organizacaoId, t.cotacao.id, ate, agora, pagamentoId))) return false;
        t.cotacao.holdAte = ate;
        daReserva.holdAte = ate;
        return true;
      },
      async voltar(ate, provisorio, pagamentoId) {
        if (!(await voltarHold(tx, organizacaoId, t.cotacao.id, ate, provisorio, agora, pagamentoId))) return false;
        t.cotacao.holdAte = ate;
        daReserva.holdAte = ate;
        return true;
      },
      descricao: (empresa) => `${empresa} — reserva ${t.reserva.codigo} (${t.imovel.nome})`,
    };
    return daReserva;
  }
  const a = t.alteracoes.find((x) => x.id === alteracaoId);
  if (!a) return { erro: "nao_oferecido" };
  const carencia = carenciaNoTravado(t, agora);
  if (!o.daLeitura && (situacaoEfetiva(a, agora, carencia(a)) !== "segurada" || a.diferenca <= 0)) return { erro: "alteracao_mudou" };
  // D1: nada da alteração vale da entrada em diante (nem na carência), e nenhuma extensão passa dela.
  const limite = limiteDaAlteracao(t, a);
  const noLimite = (d: Date) => (d.getTime() > limite.getTime() ? limite : d);
  const alvo: AlvoDaCobranca = {
    tipo: "alteracao",
    alteracaoId: a.id,
    alteracao: a,
    valor: a.diferenca,
    holdAte: a.holdAte,
    tentativas: t.tentativas.filter((x) => x.alteracaoId === a.id),
    valido: (quando) =>
      quando.getTime() < limite.getTime() && situacaoEfetiva(a, quando, carenciaNoTravado(t, quando)(a)) === "segurada" && t.reserva.estado === "confirmada" && !t.cancelamento,
    async estender(ate, pagamentoId) {
      if (!(await estenderHoldDaAlteracao(tx, organizacaoId, a, noLimite(ate), agora, pagamentoId, t.imovel.fuso))) return false;
      alvo.holdAte = noLimite(ate);
      return true;
    },
    async voltar(ate, provisorio, pagamentoId) {
      if (!(await voltarHoldDaAlteracao(tx, organizacaoId, a, ate, noLimite(provisorio), agora, pagamentoId, t.imovel.fuso))) return false;
      alvo.holdAte = ate;
      return true;
    },
    descricao: (empresa) => `${empresa} — diferença da alteração da reserva ${t.reserva.codigo} (${t.imovel.nome})`,
  };
  return alvo;
}

/** A observação da reserva-pedido acompanha o prazo das novas datas (campo fora do financeiro; sem valores). */
async function prazoNaObservacao(tx: Db, a: Pick<Alteracao, "holdReservaId">, ate: Date, fuso: string, estendido: boolean): Promise<void> {
  if (!a.holdReservaId) return;
  const [r] = await tx.select({ observacoes: reservas.observacoes }).from(reservas).where(eq(reservas.id, a.holdReservaId));
  const nova = r?.observacoes.replace(OBSERVACAO_PRAZO_ALTERACAO, `até ${horaBr(ate, fuso)}${estendido ? " (estendido pelo pagamento)" : ""};`);
  if (r && nova !== r.observacoes) await tx.update(reservas).set({ observacoes: nova }).where(eq(reservas.id, a.holdReservaId));
}

/**
 * Estende o prazo das datas seguradas de uma alteração (o Pix da diferença, o desafio do banco e a extensão única do cartão
 * em análise, com as mesmas regras da cotação). Só estende, nunca encurta, e só a alteração ainda segurada; o retrato
 * acompanha. Auditoria sem dados pessoais.
 */
export async function estenderHoldDaAlteracao(tx: Db, organizacaoId: string, a: Alteracao, ate: Date, agora: Date, pagamentoId: string | null, fuso = "America/Sao_Paulo"): Promise<boolean> {
  const [feita] = await tx
    .update(alteracoesReserva)
    .set({ holdAte: ate, atualizadoEm: agora })
    .where(and(eq(alteracoesReserva.id, a.id), eq(alteracoesReserva.organizacaoId, organizacaoId), eq(alteracoesReserva.situacao, "segurada"), or(isNull(alteracoesReserva.holdAte), lt(alteracoesReserva.holdAte, ate))))
    .returning({ id: alteracoesReserva.id });
  if (!feita) return false;
  await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "alteracao.estender", entidade: "alteracao", entidadeId: a.id, mudancas: { holdAte: [a.holdAte?.toISOString() ?? null, ate.toISOString()], ...(pagamentoId ? { pagamento: [null, pagamentoId] } : {}) } });
  a.holdAte = ate;
  a.atualizadoEm = agora;
  await prazoNaObservacao(tx, a, ate, fuso, true);
  return true;
}

/** Desfaz uma extensão provisória do prazo da alteração (o Pix que ela cobria não chegou a existir, ou foi cancelado na hora). */
export async function voltarHoldDaAlteracao(tx: Db, organizacaoId: string, a: Alteracao, ate: Date, provisorio: Date, agora: Date, pagamentoId: string | null, fuso = "America/Sao_Paulo"): Promise<boolean> {
  if (ate.getTime() >= provisorio.getTime()) return false;
  const [feita] = await tx
    .update(alteracoesReserva)
    .set({ holdAte: ate, atualizadoEm: agora })
    .where(and(eq(alteracoesReserva.id, a.id), eq(alteracoesReserva.organizacaoId, organizacaoId), eq(alteracoesReserva.situacao, "segurada"), eq(alteracoesReserva.holdAte, provisorio)))
    .returning({ id: alteracoesReserva.id });
  if (!feita) return false;
  await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "alteracao.voltar_prazo", entidade: "alteracao", entidadeId: a.id, mudancas: { holdAte: [provisorio.toISOString(), ate.toISOString()], ...(pagamentoId ? { pagamento: [null, pagamentoId] } : {}) } });
  a.holdAte = ate;
  a.atualizadoEm = agora;
  await prazoNaObservacao(tx, a, ate, fuso, false);
  return true;
}

/** É falha (o alvo não vale para cobrar agora)? */
export const falhaDoAlvo = (x: AlvoDaCobranca | FalhaDoAlvo): x is FalhaDoAlvo => "erro" in x;
