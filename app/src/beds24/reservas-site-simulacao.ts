/**
 * "Simular" da ficha (M8.3a, desenho 2.4, 3.3 e 8): monta, só com o banco, o pedido que a rotina mandaria ao Beds24 para
 * esta reserva (quarto, datas, pessoas, situação e referência; nunca nome, e-mail, telefone nem valor) e grava uma operação
 * `simulacao`/`simulada`. Nunca usa a rede, nunca cria nem muda o acompanhamento e nunca grava as marcas das OTAs (`ota_*`).
 * Só vale fora do deploy de produção ou com a chave das reservas desligada (`simulacaoReservasBeds24Permitida`): nas
 * prévias o cron não roda, e o "Simular" faz o papel dele (desenho 9).
 */
import { and, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { exigir, type Sessao } from "@/acesso/politica";
import { beds24ReservasOperacoes } from "@/db/schema";
import type { Db } from "@/db/types";
import { simulacaoReservasBeds24Permitida } from "./http";
import { lerReservaParaBeds24 } from "./reservas-site-contexto";
import { type AcaoBeds24, assinaturaEsperado, chaveSimulacaoBeds24, type MotivoForaBeds24, type PedidoBeds24, reservaDoSiteParaBeds24, SITUACOES_OPERACAO_ATIVAS } from "./reservas-site-regras";

/**
 * Por que nada foi simulado: o motivo da régua, o ambiente, a reserva fora da organização, ou `envio_em_curso` (um envio
 * real desta reserva ainda sem conclusão: a simulação não diz o que sairia enquanto não se sabe o que o Beds24 gravou).
 */
export type MotivoSemSimulacao = MotivoForaBeds24 | "anterior_a_ligar" | "sem_vinculo" | "fora_do_ambiente" | "nao_encontrada" | "envio_em_curso";

export type AvisoDoImovelNaSimulacao = "espera_ligar" | "anterior_a_ligar";

export type ResultadoSimulacao =
  | {
      ok: true;
      operacaoId: string;
      /** A última simulação desta reserva já era a mesma intenção (o tipo e a assinatura): a linha dela é a resposta. */
      repetida: boolean;
      /**
       * O imóvel desligado na configuração (D6), quando importa para o pedido. Desligado, a simulação vale como se ele
       * estivesse ligado antes da confirmação (nas prévias nenhum imóvel liga: ligar exige um ensaio), e a tela diz o que a
       * régua faria com uma ligação feita agora:
       * - `espera_ligar`: a criação sairia depois de ligar (o acompanhamento já existe);
       * - `anterior_a_ligar`: ligar agora não vale para ela (confirmada antes da ligação: fica com a equipe, à mão).
       * null = o imóvel está ligado, ou o pedido é de atualizar ou cancelar (o desligamento só para a criação).
       */
      imovelDesligado: AvisoDoImovelNaSimulacao | null;
      tipo: AcaoBeds24;
      pedido: PedidoBeds24;
    }
  | { ok: false; motivo: MotivoSemSimulacao };

/** Desde sempre: o imóvel desligado vale, só na simulação, como ligado antes de qualquer confirmação. */
const LIGACAO_DA_SIMULACAO = { ligadoEm: new Date(0).toISOString() };

/**
 * Aplica a régua (`reservaDoSiteParaBeds24`) ao estado de agora e grava a operação simulada com a chave
 * `simulacao:<reservaId>:<tipo>:<assinatura>:<simulação anterior>`: a última simulação com a mesma intenção é a resposta
 * (`repetida`); senão, inserir com `on conflict do nothing` e reler (dois cliques ao mesmo tempo dão uma linha só). Com um
 * envio real sem conclusão (`enviando`, `incerta`, ou o POST tentado sem o id do Beds24; ou o acompanhamento `em_envio`),
 * nada é simulado. Exige `reserva:editar` (deny-by-default, como a ação). `env` vem de quem chama.
 */
export async function simularReservaNoBeds24(db: Db, sessao: Sessao, reservaId: string, env: NodeJS.ProcessEnv, agora: Date = new Date()): Promise<ResultadoSimulacao> {
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  if (!simulacaoReservasBeds24Permitida(env)) return { ok: false, motivo: "fora_do_ambiente" };
  const org = sessao.organizacaoId;
  const l = await lerReservaParaBeds24(db, org, reservaId, { agora });
  if (!l) return { ok: false, motivo: "nao_encontrada" };
  const op = beds24ReservasOperacoes;
  const [emCurso] = await db
    .select({ id: op.id })
    .from(op)
    .where(and(eq(op.organizacaoId, org), eq(op.reservaId, l.reserva.id), eq(op.modo, "real"), or(inArray(op.situacao, ["enviando", "incerta"]), and(inArray(op.situacao, [...SITUACOES_OPERACAO_ATIVAS]), isNotNull(op.enviadoEm), isNull(op.beds24Id)))))
    .limit(1);
  if (emCurso || l.acompanhamento?.situacao === "em_envio") return { ok: false, motivo: "envio_em_curso" };
  const imovelLigado = l.contexto.ligacao !== null;
  const d = reservaDoSiteParaBeds24(l.reserva, imovelLigado ? l.contexto : { ...l.contexto, ligacao: LIGACAO_DA_SIMULACAO });
  if (d.decisao !== "enviar") return { ok: false, motivo: d.motivo };
  // Imóvel desligado: só a criação para. A régua com uma ligação feita agora diz se ligar faria esta reserva sair.
  let imovelDesligado: AvisoDoImovelNaSimulacao | null = null;
  if (!imovelLigado && d.acao === "criar") {
    const ligandoAgora = reservaDoSiteParaBeds24(l.reserva, { ...l.contexto, ligacao: { ligadoEm: agora.toISOString() } });
    imovelDesligado = ligandoAgora.decisao === "manual" && ligandoAgora.motivo === "anterior_a_ligar" ? "anterior_a_ligar" : "espera_ligar";
  }
  const pedido: PedidoBeds24 = { ...d.esperado, referencia: l.reserva.codigo };
  // A última simulação desta reserva, na ordem do histórico da ficha.
  const [ultima] = await db
    .select({ id: op.id, tipo: op.tipo, pedido: op.pedido })
    .from(op)
    .where(and(eq(op.organizacaoId, org), eq(op.reservaId, l.reserva.id), eq(op.modo, "simulacao")))
    .orderBy(desc(op.iniciadoEm), desc(op.id))
    .limit(1);
  if (ultima && ultima.tipo === d.acao && ultima.pedido && assinaturaEsperado(ultima.pedido) === d.assinatura) {
    return { ok: true, operacaoId: ultima.id, repetida: true, imovelDesligado, tipo: d.acao, pedido: ultima.pedido };
  }
  const chave = chaveSimulacaoBeds24(l.reserva.id, d.acao, d.assinatura, ultima?.id ?? null);
  const [nova] = await db
    .insert(op)
    // Sem acompanhamento (a simulação nunca cria nem muda o acompanhamento) e sem credencial (nada vai à rede).
    .values({ organizacaoId: org, reservaId: l.reserva.id, acompanhamentoId: null, tipo: d.acao, chave, modo: "simulacao", situacao: "simulada", pedido, autorId: sessao.usuarioId, terminadoEm: agora })
    .onConflictDoNothing({ target: [op.organizacaoId, op.chave] })
    .returning({ id: op.id });
  const [linha] = await db.select({ id: op.id, tipo: op.tipo, pedido: op.pedido }).from(op).where(and(eq(op.organizacaoId, org), eq(op.chave, chave)));
  return { ok: true, operacaoId: linha.id, repetida: !nova, imovelDesligado, tipo: linha.tipo as AcaoBeds24, pedido: linha.pedido ?? pedido };
}

/** O resultado em uma chave curta para a ficha (`?beds24=`); os textos ficam no componente. */
export function chaveDoResultadoDaSimulacao(r: ResultadoSimulacao): string {
  if (!r.ok) return `nada_${r.motivo}`;
  const imovel = r.imovelDesligado === "espera_ligar" ? "_imovel_desligado" : r.imovelDesligado === "anterior_a_ligar" ? "_imovel_desligado_anterior" : "";
  return `${r.repetida ? "repetida" : "simulada"}${imovel}`;
}
