/**
 * Pagamento no site (M8.2a) — conferência de uma tentativa com o provedor: uma função, vários gatilhos (aviso,
 * página do hóspede, rotina, "Conferir agora" do painel). Lê a order FORA de transação (pelo id ou, quando a
 * tentativa está `criando`/`incerta`, pela referência — nunca cria nada aqui), lê taxa/líquido/liberação só
 * quando faltam e no máximo a cada alguns minutos, e aplica numa transação curta com a ordem única das travas.
 * Depois da transação, cancela no provedor o que sobrou (Pix pendente de uma cotação já confirmada), sem
 * bloquear: se falhar, a rotina tenta de novo.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { eventosPagamento, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { aplicarLeitura, type Efeitos, type Leitura } from "./aplicar";
import { type Cobranca, ErroProvedor, type ProvedorPagamento } from "./provedor";
import { emAndamento, type SituacaoPagamento } from "./situacoes";
import { type Pagamento, travarCotacao } from "./travas";

/** A página e os outros gatilhos não leem o provedor mais de uma vez a cada 15 s por tentativa (salvo `forcar`). */
export const INTERVALO_CONSULTA_MS = 15_000;
/** Taxa, líquido e liberação (Payments API): no máximo a cada 5 minutos por tentativa. */
export const INTERVALO_FINANCEIRO_MS = 5 * 60_000;
/** Tentativa sem order, procurada pela referência e não achada por este tempo: a criação não aconteceu. */
export const DESISTIR_SEM_ORDER_MS = 15 * 60_000;

export type OrigemConferencia = "aviso" | "pagina" | "rotina" | "painel";
export type ResultadoConferencia = { ok: true; situacao: SituacaoPagamento; consultou: boolean; mudou: boolean } | { ok: false; erro: string };

/**
 * Chave do cancelamento: nova a cada pedido (o provedor recusa repetir uma chave já usada, e cancelar o que já
 * está cancelado responde "já cancelado" — cancelar é idempotente por natureza).
 */
export const chaveCancelamento = (pagamentoId: string) => `pagamento:${pagamentoId}:cancelar:${randomUUID().slice(0, 8)}`;

const mensagemDoErro = (e: unknown) => (e instanceof ErroProvedor ? e.message : "Não deu para falar com o Mercado Pago agora; tente de novo em instantes.");

function precisaFinanceiro(p: Pagamento, c: Cobranca, agora: Date, forcar: boolean): boolean {
  if (c.situacao !== "aprovado" && c.situacao !== "devolvido" && c.situacao !== "devolvido_parcial") return false;
  const primeira = p.situacao !== "aprovado" && c.situacao === "aprovado";
  // Depois do primeiro dia da aprovação, a Payments API é lida a cada 6 h (o sinal de liberação pode demorar semanas).
  const intervalo = p.aprovadoEm && agora.getTime() - p.aprovadoEm.getTime() > 24 * 3_600_000 ? 6 * 3_600_000 : INTERVALO_FINANCEIRO_MS;
  if (!primeira && !forcar && p.financeiroConsultadoEm && agora.getTime() - p.financeiroConsultadoEm.getTime() < intervalo) return false;
  if (p.taxa === null && c.situacao === "aprovado") return true;
  if (p.desfecho === "reserva" && !p.liberacaoConfirmadaEm && c.situacao === "aprovado") return true;
  // Liberação registrada à mão: o sinal do provedor ainda concilia (ou acusa a diferença) — conferido uma vez por dia.
  if (p.desfecho === "reserva" && p.liberacaoOrigem === "manual" && c.situacao === "aprovado") {
    return forcar || !p.financeiroConsultadoEm || agora.getTime() - p.financeiroConsultadoEm.getTime() >= 24 * 3_600_000;
  }
  // Devolução: a taxa que o provedor ficou só se sabe depois dela.
  if (c.situacao === "devolvido" && p.desfecho === null) return true;
  return p.avisos.includes("taxa_perdida_desconhecida");
}

/** Lê o provedor para a tentativa (fora de transação). Falha de transporte lança `ErroProvedor`. */
async function lerProvedor(p: Pagamento, provedor: ProvedorPagamento, agora: Date, forcar: boolean, conhecida?: Cobranca): Promise<Leitura> {
  let cobranca: Cobranca | null;
  if (conhecida) cobranca = conhecida;
  else if (p.idProvedor) cobranca = await provedor.consultar(p.idProvedor);
  else cobranca = await provedor.buscarPorReferencia(p.referencia, p.criadoEm);
  const desistir = !p.idProvedor && cobranca === null && agora.getTime() - p.criadoEm.getTime() >= DESISTIR_SEM_ORDER_MS;
  const financeiro = cobranca && precisaFinanceiro(p, cobranca, agora, forcar) ? await provedor.detalheFinanceiro(cobranca) : null;
  return { cobranca, financeiro, desistir, idLido: p.idProvedor };
}

/** Aplica uma leitura numa transação curta, com as travas na ordem única; devolve os efeitos para depois dela. */
export async function aplicarNaTransacao(db: Db, organizacaoId: string, p: Pick<Pagamento, "id" | "cotacaoId">, leitura: Leitura, agora: Date): Promise<Efeitos | null> {
  return db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, p.cotacaoId);
    if (!t || !t.tentativas.some((x) => x.id === p.id)) return null;
    return aplicarLeitura(tx, organizacaoId, t, p.id, leitura, agora);
  });
}

/** Cancela no provedor as orders que sobraram e relê cada uma (melhor esforço: a rotina repete o que falhar). */
export async function cancelarNoProvedor(db: Db, organizacaoId: string, lista: { id: string; idProvedor: string }[], provedor: ProvedorPagamento, agora: Date): Promise<number> {
  let canceladas = 0;
  for (const x of lista) {
    const r = await provedor.cancelar(x.idProvedor, chaveCancelamento(x.id));
    if (r === "cancelado") canceladas++;
    try {
      // A situação só muda pela leitura (o cancelamento pode ter cruzado com um pagamento).
      const res = await conferirTentativa(db, organizacaoId, x.id, provedor, agora, { forcar: true, origem: "rotina", semCancelar: true });
      if (r === "erro" || (res.ok && res.situacao === "pendente")) await marcarAviso(db, x.id, "cancelamento_pendente", true);
      else await marcarAviso(db, x.id, "cancelamento_pendente", false);
    } catch {
      await marcarAviso(db, x.id, "cancelamento_pendente", true);
    }
  }
  return canceladas;
}

async function marcarAviso(db: Db, pagamentoId: string, aviso: string, ligar: boolean): Promise<void> {
  const [p] = await db.select({ avisos: pagamentos.avisos }).from(pagamentos).where(eq(pagamentos.id, pagamentoId));
  if (!p || p.avisos.includes(aviso) === ligar) return;
  await db.update(pagamentos).set({ avisos: ligar ? [...p.avisos, aviso] : p.avisos.filter((a) => a !== aviso) }).where(eq(pagamentos.id, pagamentoId));
}

/**
 * Confere a tentativa com o provedor e aplica. `forcar` ignora o intervalo de 15 s (aviso assinado, "Conferir
 * agora", depois de cancelar). A página só deve chamar enquanto a tentativa está pendente/criando/incerta (ver
 * `conferirCotacaoParaPagina`).
 */
export async function conferirTentativa(
  db: Db,
  organizacaoId: string,
  pagamentoId: string,
  provedor: ProvedorPagamento,
  agora: Date = new Date(),
  opcoes: { forcar?: boolean; origem: OrigemConferencia; semCancelar?: boolean; cobranca?: Cobranca } = { origem: "rotina" },
): Promise<ResultadoConferencia> {
  if (!uuidValido(pagamentoId)) return { ok: false, erro: "Pagamento não encontrado." };
  const [p] = await db.select().from(pagamentos).where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId)));
  if (!p) return { ok: false, erro: "Pagamento não encontrado." };
  if (!opcoes.forcar && !opcoes.cobranca && p.consultadoEm && agora.getTime() - p.consultadoEm.getTime() < INTERVALO_CONSULTA_MS) {
    return { ok: true, situacao: p.situacao, consultou: false, mudou: false };
  }
  let leitura: Leitura;
  try {
    leitura = await lerProvedor(p, provedor, agora, opcoes.forcar === true, opcoes.cobranca);
  } catch (e) {
    return { ok: false, erro: mensagemDoErro(e) };
  }
  const efeitos = await aplicarNaTransacao(db, organizacaoId, p, leitura, agora);
  if (!efeitos) return { ok: false, erro: "Pagamento não encontrado." };
  if (efeitos.cancelar.length && !opcoes.semCancelar) await cancelarNoProvedor(db, organizacaoId, efeitos.cancelar, provedor, agora);
  return { ok: true, situacao: efeitos.situacao, consultou: true, mudou: efeitos.mudou };
}

/**
 * Página do hóspede esperando o Pix: confere a tentativa mais recente da cotação só enquanto ela está
 * pendente/criando/incerta, com o intervalo de 15 s. Quem chama aplica antes o freio por endereço de internet.
 */
export async function conferirCotacaoParaPagina(db: Db, organizacaoId: string, cotacaoId: string, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<ResultadoConferencia | null> {
  if (!uuidValido(cotacaoId)) return null;
  const [ultima] = await db
    .select({ id: pagamentos.id, situacao: pagamentos.situacao })
    .from(pagamentos)
    .where(and(eq(pagamentos.cotacaoId, cotacaoId), eq(pagamentos.organizacaoId, organizacaoId)))
    .orderBy(desc(pagamentos.criadoEm), desc(pagamentos.id))
    .limit(1);
  if (!ultima || !emAndamento(ultima.situacao)) return null;
  return conferirTentativa(db, organizacaoId, ultima.id, provedor, agora, { origem: "pagina" });
}

/** Formato de id de order (ORD…): ids numéricos (pagamento, contestação, alerta de fraude) são ignorados na parte (a). */
export const idDeOrder = (id: unknown): id is string => typeof id === "string" && /^ORD[A-Za-z0-9_-]{1,61}$/.test(id);

/**
 * Aviso assinado de uma order (o `data.id` da URL, o único assinado). Lê a order no provedor e acha a tentativa
 * pela referência (scl-<id>, única), em qualquer organização — assim também o aviso que chega antes de a criação
 * gravar o id da order é aplicado (e o id é gravado). Order que o provedor ou este banco não conhecem =
 * "desconhecido" (sem aviso: prévia, outra aplicação da conta). Com `eventoId`, grava o resultado e a organização
 * no evento. Falha do provedor lança (o evento fica "erro" e a rotina confere depois).
 */
export async function processarAvisoDeOrder(db: Db, provedor: ProvedorPagamento, dataId: string, agora: Date = new Date(), o: { eventoId?: string } = {}): Promise<"aplicado" | "ignorado" | "desconhecido"> {
  const marcar = async (resultado: "aplicado" | "ignorado" | "desconhecido" | "erro", organizacaoId: string | null) => {
    if (!o.eventoId || !uuidValido(o.eventoId)) return;
    await db.update(eventosPagamento).set({ resultado, processadoEm: agora, ...(organizacaoId ? { organizacaoId } : {}) }).where(eq(eventosPagamento.id, o.eventoId));
  };
  if (!idDeOrder(dataId)) {
    await marcar("ignorado", null);
    return "ignorado";
  }
  try {
    const cobranca = await provedor.consultar(dataId);
    const [p] = cobranca?.referencia ? await db.select({ id: pagamentos.id, organizacaoId: pagamentos.organizacaoId }).from(pagamentos).where(eq(pagamentos.referencia, cobranca.referencia)).limit(1) : [];
    if (!cobranca || !p) {
      await marcar("desconhecido", null);
      return "desconhecido";
    }
    const r = await conferirTentativa(db, p.organizacaoId, p.id, provedor, agora, { forcar: true, origem: "aviso", cobranca });
    if (!r.ok) throw new ErroProvedor("incerto", r.erro);
    await marcar("aplicado", p.organizacaoId);
    return "aplicado";
  } catch (e) {
    await marcar("erro", null);
    throw e;
  }
}
