/**
 * Aviso assinado (webhook) do WhatsApp (M10.1a, desenho na seção "Rota" de `requisitos/product/WHATSAPP.md`). Só recebe:
 * nada aqui fala com a Meta.
 *
 * GET — verificação do endereço (a Meta chama ao salvar o endereço no app, antes de o recebimento ser ligado; não
 * depende de WHATSAPP_RECEBIMENTO e nunca toca o banco): sem senha de verificação (ou curta demais), modo diferente de
 * "subscribe" ou senha que não confere → 403; `hub.challenge` fora do formato → 400; senão 200 com o challenge.
 *
 * POST — os avisos, nesta ordem:
 * 1. WHATSAPP_RECEBIMENTO desligada → 503, sem ler o corpo e sem banco (a Meta reenvia por até 7 dias).
 * 2. Sem segredo do app ou cabeçalho `x-hub-signature-256` malformado → 401, sem ler o corpo, sem banco e sem contar.
 * 3. Corpo acima de 4 MB → 413, sem banco e sem contar (antes de autenticar, nada vai para o quadro); leitura que lança → 400.
 * 4. Assinatura que não confere sobre os bytes crus → 401 e só a conta do dia ("recusados pela assinatura").
 * 5. Válido: corpo ilegível (UTF-8 inválido, JSON quebrado, forma fora do esperado) → 200 e a conta "ilegíveis" (não
 *    adianta a Meta reenviar o que nunca vai ser lido); legível → grava tudo numa transação antes do 200
 *    (`receberAviso`): falhou, 500, e a Meta reenvia. O e-mail da conta desconectada sai depois da resposta (`after`).
 *
 * Da leitura do corpo em diante, tudo o que pode lançar (a decodificação, a leitura do aviso, a gravação e a conta do
 * ilegível) fica num `try` só: nenhuma exceção sai daqui para o Next, que imprimiria a mensagem no registro da Vercel e
 * a mandaria ao Sentry com o contexto do pedido. O erro vai ao Sentry por `avisarErroDoServidor`, sem a mensagem (que
 * pode repetir um telefone ou um texto da conversa). Nada do corpo, dos cabeçalhos, do segredo ou da senha é
 * registrado em lugar nenhum, e não há `console` aqui.
 */
import { after } from "next/server";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { lerCorpoLimitado, respostaVazia } from "@/lib/corpo-limitado";
import { avisarErroDoServidor } from "@/observabilidade/aviso-do-servidor";
import { recebimentoLigado, segredoDoApp, tokenDeVerificacao } from "@/whatsapp/ambiente";
import { assinaturaConfere, CHALLENGE_VALIDO, lerCabecalhoAssinatura, tokenConfere } from "@/whatsapp/assinatura";
import { lerAviso } from "@/whatsapp/aviso";
import { enviarAvisosDaConta } from "@/whatsapp/avisos";
import { somarNoDia } from "@/whatsapp/contadores";
import { receberAviso } from "@/whatsapp/receber";
import { LIMITE_CORPO } from "@/whatsapp/regras";

export const dynamic = "force-dynamic";
/** A gravação é síncrona (antes do 200): um lote grande do histórico precisa de tempo. */
export const maxDuration = 60;

/** Nome da rotina nos avisos ao Sentry. */
const ROTINA = "aviso-whatsapp";

/** Decodificação estrita (UTF-8 inválido não vira U+FFFD) e JSON: null = ilegível, sem lançar. */
function lerJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

export async function GET(req: Request): Promise<Response> {
  const token = tokenDeVerificacao();
  if (!token) return respostaVazia(403);
  const consulta = new URL(req.url).searchParams;
  if (consulta.get("hub.mode") !== "subscribe") return respostaVazia(403);
  if (!tokenConfere(consulta.get("hub.verify_token"), token)) return respostaVazia(403);
  const challenge = consulta.get("hub.challenge");
  if (challenge === null || !CHALLENGE_VALIDO.test(challenge)) return respostaVazia(400);
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  if (!recebimentoLigado()) return respostaVazia(503);
  const segredo = segredoDoApp();
  const assinatura = lerCabecalhoAssinatura(req.headers.get("x-hub-signature-256"));
  if (!segredo || !assinatura) return respostaVazia(401);

  const corpo = await lerCorpoLimitado(req, LIMITE_CORPO);
  if (!corpo.ok) return respostaVazia(corpo.status);

  const db = getDb();
  const agora = new Date();
  if (!assinaturaConfere(corpo.bytes, assinatura, segredo)) {
    await somarNoDia(db, { assinaturas_recusadas: 1 }, agora).catch(() => undefined);
    return respostaVazia(401);
  }

  try {
    const json = lerJson(corpo.bytes);
    const aviso = json === null ? ({ ilegivel: true } as const) : lerAviso(json);
    if (aviso.ilegivel) {
      await somarNoDia(db, { ilegiveis: 1 }, agora, { valido: true });
      return respostaVazia(200);
    }
    const { emails } = await receberAviso(db, aviso, agora);
    if (emails.length) after(() => enviarAvisosDaConta(db, emails, correioDoAmbiente(), new Date()).catch((erro) => avisarErroDoServidor(erro, ROTINA)));
  } catch (erro) {
    await avisarErroDoServidor(erro, ROTINA);
    // A Meta reenvia: a gravação é idempotente.
    return respostaVazia(500);
  }
  return respostaVazia(200);
}
