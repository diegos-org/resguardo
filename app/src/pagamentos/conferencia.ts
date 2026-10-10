/**
 * Pagamento no site (M8.2a) — conferência de uma tentativa com o provedor: uma função, vários gatilhos (aviso,
 * página do hóspede, rotina, "Conferir agora" do painel). Lê a order FORA de transação (pelo id ou, quando a
 * tentativa está `criando`/`incerta`, pela referência — nunca cria nada aqui), lê taxa/líquido/liberação só
 * quando faltam e no máximo a cada alguns minutos, e aplica numa transação curta com a ordem única das travas.
 * Depois da transação, cancela no provedor o que sobrou (Pix pendente de uma cotação já confirmada), sem
 * bloquear: se falhar, fica o aviso e a próxima conferência (rotina ou "Conferir agora") tenta de novo.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { eventosPagamento, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { aplicarLeitura, type Efeitos, type Leitura } from "./aplicar";
import { DESISTIR_SEM_ORDER_CARTAO_MS, paginaAindaLe } from "./andamento";
import { type Cobranca, ErroProvedor, type ProvedorPagamento } from "./provedor";
import type { SituacaoPagamento } from "./situacoes";
import { dinheiroDaReserva, type Pagamento, travarCotacao } from "./travas";

/** A página e os outros gatilhos não leem o provedor mais de uma vez a cada 15 s por tentativa (salvo `forcar`). */
export const INTERVALO_CONSULTA_MS = 15_000;
/**
 * Cartão em análise ou processando (M8.2b): no máximo uma leitura por minuto (a análise pode levar dias e a página
 * fica consultando por horas). Leituras forçadas (aviso, "Conferir agora", releitura antes de criar) não esperam.
 */
export const INTERVALO_ANALISE_MS = 60_000;
/** Taxa, líquido e liberação (Payments API): no máximo a cada 5 minutos por tentativa. */
export const INTERVALO_FINANCEIRO_MS = 5 * 60_000;
/** Pix sem order, procurado pela referência e não achado por este tempo: a criação não aconteceu (cartão: ver `lerProvedor`). */
export const DESISTIR_SEM_ORDER_MS = 15 * 60_000;

export type OrigemConferencia = "aviso" | "pagina" | "rotina" | "painel";
/**
 * `canceladas`: Pix que sobraram cancelados no provedor por causa desta leitura (dinheiro chegou nesta tentativa).
 * `aplicada`: a order lida bateu com a tentativa e foi aplicada (M8.2c: o cancelamento integral exige uma leitura aplicada).
 */
export type ResultadoConferencia = { ok: true; situacao: SituacaoPagamento; consultou: boolean; mudou: boolean; canceladas?: number; aplicada?: boolean } | { ok: false; erro: string };

/**
 * Chave do cancelamento: nova a cada pedido (o provedor recusa repetir uma chave já usada, e cancelar o que já
 * está cancelado responde "já cancelado" — cancelar é idempotente por natureza).
 */
export const chaveCancelamento = (pagamentoId: string) => `pagamento:${pagamentoId}:cancelar:${randomUUID().slice(0, 8)}`;

const mensagemDoErro = (e: unknown) => (e instanceof ErroProvedor ? e.message : "Não deu para falar com o Mercado Pago agora; tente de novo em instantes.");
/** Falha de leitura que chegou ao provedor (limite de chamadas ou sem resposta): na página, a marca dos 15 s fica. */
const falhaQueSegura = (e: unknown) => e instanceof ErroProvedor && (e.tipo === "limite" || e.tipo === "incerto");

function precisaFinanceiro(p: Pagamento, c: Cobranca, agora: Date, forcar: boolean): boolean {
  // Taxa, líquido e liberação só servem enquanto aprovado (a taxa que não volta numa devolução a equipe informa). M8.2d: o
  // dinheiro da reserva devolvido em parte pelas nossas devoluções ainda espera a liberação (`aplicarLeitura` confere).
  if (c.situacao !== "aprovado" && !(c.situacao === "devolvido_parcial" && dinheiroDaReserva(p) && !p.liberacaoConfirmadaEm)) return false;
  const primeira = p.situacao !== "aprovado" && c.situacao === "aprovado";
  // Depois do primeiro dia da aprovação, a Payments API é lida a cada 6 h (o sinal de liberação pode demorar semanas).
  const intervalo = p.aprovadoEm && agora.getTime() - p.aprovadoEm.getTime() > 24 * 3_600_000 ? 6 * 3_600_000 : INTERVALO_FINANCEIRO_MS;
  if (!primeira && !forcar && p.financeiroConsultadoEm && agora.getTime() - p.financeiroConsultadoEm.getTime() < intervalo) return false;
  if (p.taxa === null) return true;
  // A liberação: do dinheiro da reserva (o que a confirmou e a diferença aplicada de uma alteração, M8.2d).
  if (dinheiroDaReserva(p) && !p.liberacaoConfirmadaEm) return true;
  // Liberação registrada à mão: o sinal do provedor ainda concilia (ou acusa a diferença) — conferido uma vez por dia.
  if (dinheiroDaReserva(p) && p.liberacaoOrigem === "manual") {
    return forcar || !p.financeiroConsultadoEm || agora.getTime() - p.financeiroConsultadoEm.getTime() >= 24 * 3_600_000;
  }
  return false;
}

/**
 * Lê o provedor para a tentativa (fora de transação). Falha de transporte lança `ErroProvedor`. Sem order achada pela
 * referência, a criação é dada por não feita: no Pix, depois de 15 minutos; no cartão (que pode ter sido cobrado durante
 * a criação), só depois de 24 h e com a Payments API também sem nenhum pagamento da referência (a chamada a mais só
 * acontece nesse caso; se ela falha, nada se decide).
 */
async function lerProvedor(p: Pagamento, provedor: ProvedorPagamento, agora: Date, forcar: boolean, conhecida?: Cobranca): Promise<Leitura> {
  let cobranca: Cobranca | null;
  if (conhecida) cobranca = conhecida;
  else if (p.idProvedor) cobranca = await provedor.consultar(p.idProvedor);
  else cobranca = await provedor.buscarPorReferencia(p.referencia, p.criadoEm);
  const idade = agora.getTime() - p.criadoEm.getTime();
  let desistir = false;
  if (!p.idProvedor && cobranca === null) {
    if (p.forma !== "cartao") desistir = idade >= DESISTIR_SEM_ORDER_MS;
    else if (idade >= DESISTIR_SEM_ORDER_CARTAO_MS) desistir = !(await provedor.existePagamentoPorReferencia(p.referencia, p.criadoEm));
  }
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

/** Cancela no provedor as orders que sobraram (ou um desafio do cartão sem como seguir) e relê cada uma (melhor esforço: o que falhar fica com o aviso `cancelamento_pendente` e a próxima conferência — rotina ou "Conferir agora" — tenta de novo). */
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

/**
 * Liga ou desliga um aviso num comando só (sem ler antes): nunca apaga o que uma conferência gravou ao mesmo tempo.
 * Exportada para os testes.
 */
export async function marcarAviso(db: Db, pagamentoId: string, aviso: string, ligar: boolean): Promise<void> {
  const item = sql`jsonb_build_array(${aviso}::text)`;
  if (ligar) await db.update(pagamentos).set({ avisos: sql`${pagamentos.avisos} || ${item}` }).where(and(eq(pagamentos.id, pagamentoId), sql`not (${pagamentos.avisos} @> ${item})`));
  else await db.update(pagamentos).set({ avisos: sql`${pagamentos.avisos} - ${aviso}::text` }).where(and(eq(pagamentos.id, pagamentoId), sql`${pagamentos.avisos} @> ${item}`));
}

/**
 * Confere a tentativa com o provedor e aplica. Sem `forcar`, a leitura é reservada antes, num comando só
 * (`consultadoEm` passa a agora só se a última leitura tem 15 s ou mais): pedidos simultâneos da página ou da rotina
 * leem o provedor uma vez só. Leitura que falha devolve a marca, salvo na página quando o provedor limitou as chamadas
 * ou não respondeu (então a página continua lendo no máximo a cada 15 s). `forcar` ignora o intervalo (aviso
 * assinado, "Conferir agora", depois de cancelar). A página só deve chamar enquanto a tentativa está
 * pendente/criando/incerta (ver `conferirCotacaoParaPagina`).
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
  const reservar = !opcoes.forcar && !opcoes.cobranca;
  if (reservar) {
    const intervalo = p.forma === "cartao" && (p.etapaCartao === "analise" || p.etapaCartao === "processando") ? INTERVALO_ANALISE_MS : INTERVALO_CONSULTA_MS;
    const [reservada] = await db
      .update(pagamentos)
      .set({ consultadoEm: agora })
      .where(and(eq(pagamentos.id, p.id), or(isNull(pagamentos.consultadoEm), lt(pagamentos.consultadoEm, new Date(agora.getTime() - intervalo + 1)))))
      .returning({ id: pagamentos.id });
    if (!reservada) return { ok: true, situacao: p.situacao, consultou: false, mudou: false };
  }
  // Leitura que falhou não conta: a marca volta ao que era (a rotina e a página tentam de novo no tempo delas).
  const desfazerReserva = async () => {
    if (reservar) await db.update(pagamentos).set({ consultadoEm: p.consultadoEm }).where(and(eq(pagamentos.id, p.id), eq(pagamentos.consultadoEm, agora)));
  };
  let leitura: Leitura;
  try {
    leitura = await lerProvedor(p, provedor, agora, opcoes.forcar === true, opcoes.cobranca);
  } catch (e) {
    // Salvo na página com o Mercado Pago limitando as chamadas (429) ou sem responder (tempo esgotado, 5xx): aí a
    // marca fica, e a página lê no máximo uma vez a cada 15 s mesmo enquanto ele falha (o freio vale justamente
    // quando a conta já está no limite). O pedido que nem saiu (`indisponivel`) e a rotina continuam desfazendo.
    if (!(opcoes.origem === "pagina" && falhaQueSegura(e))) await desfazerReserva();
    return { ok: false, erro: mensagemDoErro(e) };
  }
  let efeitos: Efeitos | null;
  try {
    efeitos = await aplicarNaTransacao(db, organizacaoId, p, leitura, agora);
  } catch (e) {
    await desfazerReserva();
    throw e;
  }
  if (!efeitos) return { ok: false, erro: "Pagamento não encontrado." };
  const canceladas = efeitos.cancelar.length && !opcoes.semCancelar ? await cancelarNoProvedor(db, organizacaoId, efeitos.cancelar, provedor, agora) : 0;
  return { ok: true, situacao: efeitos.situacao, consultou: true, mudou: efeitos.mudou, ...(canceladas ? { canceladas } : {}), ...(efeitos.aplicada ? { aplicada: true } : {}) };
}

export { FOLGA_LEITURA_PIX_ENCERRADO_MS } from "./andamento";

/**
 * Página do hóspede esperando o Pix: confere, com o intervalo de 15 s por tentativa, toda tentativa da cotação que
 * ainda pode virar dinheiro: as em andamento (criando, incerta, pendente) e as recusadas, canceladas ou vencidas há
 * pouco (até o prazo do Pix mais a folga): o cancelamento de um Pix pode cruzar com o pagamento dele, o provedor pode
 * corrigir uma recusa, e na prévia nem o aviso do Mercado Pago nem a rotina conferem por ela. Quem chama aplica antes o freio por endereço de internet. Devolve o
 * resultado da mais recente conferida.
 */
export async function conferirCotacaoParaPagina(db: Db, organizacaoId: string, cotacaoId: string, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<ResultadoConferencia | null> {
  if (!uuidValido(cotacaoId)) return null;
  const tentativas = await db
    .select({ id: pagamentos.id, forma: pagamentos.forma, situacao: pagamentos.situacao, idProvedor: pagamentos.idProvedor, pixExpiraEm: pagamentos.pixExpiraEm, criadoEm: pagamentos.criadoEm, encerradoEm: pagamentos.encerradoEm })
    .from(pagamentos)
    .where(and(eq(pagamentos.cotacaoId, cotacaoId), eq(pagamentos.organizacaoId, organizacaoId)))
    .orderBy(desc(pagamentos.criadoEm), desc(pagamentos.id));
  const alvos = tentativas.filter((t) => paginaAindaLe(t, agora));
  let resultado: ResultadoConferencia | null = null;
  for (const t of alvos) {
    const r = await conferirTentativa(db, organizacaoId, t.id, provedor, agora, { origem: "pagina" });
    resultado ??= r;
  }
  return resultado;
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
