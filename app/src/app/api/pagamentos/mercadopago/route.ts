/**
 * Aviso assinado (webhook) do Mercado Pago (M8.2a, design "Aviso assinado").
 *
 * - Sem `x-signature` ou sem segredo configurado: 401 sem ler o corpo nem tocar no banco.
 * - Corpo até 64 KB (pelo Content-Length e pela leitura, que para no limite): acima disso, 413.
 * - Só o `data.id` da URL vale (é o assinado); nada é decidido pelo corpo nem pelo `type`. Do corpo só saem a ação e o
 *   `live_mode` (não assinado: serve de alarme), já filtrados por `registrarEventoDeAviso`.
 * - Assinatura inválida: só a conta do dia ("assinaturas recusadas") e 401.
 * - Válida: grava o evento (repetição = 200 sem processar); id que não é de order fica "ignorado"; order é
 *   processada DEPOIS da resposta (`after`), lendo o provedor pelas mesmas travas da conferência. Sem provedor (o
 *   deploy de produção, onde o teste não roda) o evento fica "ignorado"; falha fica "erro" e a rotina confere depois.
 *
 * Nada aqui vai para o registro do servidor: nem corpo, nem cabeçalhos, nem segredo. As falhas ao gravar o evento e ao
 * processar a order vão para o Sentry (M0.9, `avisarErroDoServidor`): só o tipo do erro, o código técnico e a pilha, sem
 * a mensagem (que pode repetir um valor gravado), sem o corpo nem os cabeçalhos do aviso. Da falha do provedor
 * (`ErroProvedor`), vai também o tipo dela, de uma lista fechada (provedor fora do alcance, resposta incerta, chave
 * recusada, limite de chamadas), para a equipe saber o que conferir.
 */
import { after } from "next/server";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { conferirAssinatura, lerCabecalhoAssinatura } from "@/pagamentos/assinatura";
import { idDeOrder, processarAvisoDeOrder } from "@/pagamentos/conferencia";
import { marcarResultadoDoEvento, registrarAssinaturaRecusada, registrarEventoDeAviso } from "@/pagamentos/eventos";
import { segredoDoWebhook } from "@/pagamentos/integracao";
import { provedorDeConferencia } from "@/pagamentos/oferta";
import { avisarErroDoServidor } from "@/observabilidade/aviso-do-servidor";
import { ErroDeRotina, type MotivoDeFalha, umaFalha } from "@/observabilidade/erro-de-rotina";
import { ErroProvedor } from "@/pagamentos/provedor";

export const dynamic = "force-dynamic";
/** O processamento depois da resposta lê o provedor (cada chamada com tempo-limite de 15 s). */
export const maxDuration = 60;

const LIMITE_CORPO = 64 * 1024;

const resposta = (status: number) => new Response(null, { status, headers: { "cache-control": "no-store" } });

/** Lê o corpo até `limite` bytes; null = passou do limite (a leitura para ali, sem guardar o resto). */
async function lerCorpoLimitado(req: Request, limite: number): Promise<string | null> {
  if (!req.body) return "";
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(partes));
}

/** Do corpo, só a ação e o live_mode (o resto é descartado sem ser guardado). */
function camposDoCorpo(texto: string): { acao: unknown; aoVivo: unknown } {
  try {
    const j: unknown = JSON.parse(texto);
    if (j && typeof j === "object" && !Array.isArray(j)) {
      const o = j as Record<string, unknown>;
      return { acao: o.action, aoVivo: o.live_mode };
    }
  } catch {
    // Corpo que não é JSON: o aviso vale pela assinatura da URL; ação e live_mode ficam vazios.
  }
  return { acao: undefined, aoVivo: undefined };
}

/**
 * O que vai ao Sentry de uma falha ao processar a order (M0.9): de um `ErroProvedor`, o tipo dele, que é um motivo da
 * lista fechada do aviso (a anotação confere isso na compilação), sem a mensagem; de qualquer outro erro, o texto fixo de
 * `erroParaOAviso`. Aqui nada fica guardado além do evento marcado como "erro", e o aviso diz isso.
 */
function erroDoProcessamento(erro: unknown): unknown {
  if (!(erro instanceof ErroProvedor)) return erro;
  const motivo: MotivoDeFalha = erro.tipo;
  return new ErroDeRotina(erro.message, umaFalha(motivo), { cause: erro, detalheEm: "sem_registro" });
}

/** Depois da resposta: aplica a order pelo provedor de conferência (as mesmas travas do resto). */
async function processarDepois(db: Db, dataId: string, eventoId: string): Promise<void> {
  try {
    const gate = await provedorDeConferencia();
    if (!gate.ok) {
      // Deploy de produção (ou chaves ausentes): o aviso só confere a assinatura e fica registrado.
      await marcarResultadoDoEvento(db, eventoId, "ignorado");
      return;
    }
    await processarAvisoDeOrder(db, gate.provedor, dataId, new Date(), { eventoId });
  } catch (erro) {
    // processarAvisoDeOrder já marca "erro"; aqui só garante a marca se a falha veio antes. A rotina confere depois.
    await marcarResultadoDoEvento(db, eventoId, "erro").catch(() => undefined);
    await avisarErroDoServidor(erroDoProcessamento(erro), "aviso-mercadopago");
  }
}

export async function POST(req: Request): Promise<Response> {
  const xSignature = req.headers.get("x-signature");
  const segredo = segredoDoWebhook();
  if (!xSignature || !segredo) return resposta(401);

  const declarado = req.headers.get("content-length");
  if (declarado !== null && /^\d+$/.test(declarado.trim()) && Number(declarado) > LIMITE_CORPO) return resposta(413);
  let texto: string | null;
  try {
    texto = await lerCorpoLimitado(req, LIMITE_CORPO);
  } catch {
    return resposta(400);
  }
  if (texto === null) return resposta(413);

  const url = new URL(req.url);
  const dataId = url.searchParams.get("data.id");
  const tipo = url.searchParams.get("type");
  const xRequestId = req.headers.get("x-request-id");
  const db = getDb();

  if (!conferirAssinatura({ xSignature, xRequestId, dataId, segredo })) {
    await registrarAssinaturaRecusada(db).catch(() => undefined);
    return resposta(401);
  }

  const corpo = camposDoCorpo(texto);
  let evento: { id: string; novo: boolean } | null;
  try {
    evento = dataId ? await registrarEventoDeAviso(db, { tipo, acao: corpo.acao, dataId, requestId: xRequestId, ts: lerCabecalhoAssinatura(xSignature)?.ts ?? null, aoVivo: corpo.aoVivo }) : null;
  } catch (erro) {
    // Sem gravar o evento não há como saber depois o que chegou: o provedor tenta de novo.
    await avisarErroDoServidor(erro, "aviso-mercadopago");
    return resposta(500);
  }
  // Id fora do formato aceito, ou repetição (mesmo request-id, ts e id): nada a processar.
  if (!evento || !evento.novo || !dataId) return resposta(200);
  if (!idDeOrder(dataId)) {
    // Pagamento, contestação ou alerta de fraude (id numérico): fora da parte (a).
    await marcarResultadoDoEvento(db, evento.id, "ignorado").catch(() => undefined);
    return resposta(200);
  }
  const eventoId = evento.id;
  after(() => processarDepois(db, dataId, eventoId));
  return resposta(200);
}
