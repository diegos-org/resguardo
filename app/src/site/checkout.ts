import { cookies } from "next/headers";
import { autorizacaoValida, CAMINHO_COOKIE_CHECKOUT, COOKIE_CHECKOUT, emitirAutorizacao } from "@/pagamentos/autorizacao";

/**
 * Cookie da autorização do pagamento (M8.2a): assinado, httpOnly, só para `/reservar`, até o fim do pedido, um por
 * cotação (segurar outra cotação no mesmo navegador não tira a autorização da primeira). Quem segura as datas (ou
 * confirma o e-mail em "Continuar o pagamento") recebe; gerar o Pix e ver o QR exigem. Gravar só funciona numa ação
 * do servidor ou numa rota; ler funciona também na página (só no servidor: `next/headers`).
 */
export const nomeDoCookieDoPedido = (cotacaoId: string) => `${COOKIE_CHECKOUT}-${cotacaoId}`;

export async function autorizadoNaCotacao(cotacaoId: string, agora: Date = new Date()): Promise<boolean> {
  return autorizacaoValida((await cookies()).get(nomeDoCookieDoPedido(cotacaoId))?.value, cotacaoId, agora);
}

/** Emite a autorização da cotação até `ate`. Sem AUTH_SECRET, lança (ninguém paga sem ela). */
export async function gravarAutorizacao(cotacaoId: string, ate: Date): Promise<void> {
  const token = emitirAutorizacao(cotacaoId, ate);
  (await cookies()).set(nomeDoCookieDoPedido(cotacaoId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: CAMINHO_COOKIE_CHECKOUT,
    expires: ate,
  });
}
