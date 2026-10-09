/**
 * Pagamento no site (M8.2a) — quem pode pagar. O código da cotação circula no WhatsApp e não é credencial: ao
 * segurar as datas, o navegador recebe um cookie assinado (finalidade própria, `checkout-site:v1`, só para
 * `/reservar`), com o id da cotação e a validade até o fim do pedido. Gerar o Pix e ver o QR exigem o cookie.
 * Puro: quem grava e lê o cookie é o site.
 */
import { uuidValido } from "@/lib/ids";
import { criarToken, lerToken } from "@/lib/token-assinado";
import { CARENCIA_PAGAMENTO_MS, FOLGA_PRAZO_PIX_MS, MAXIMO_PIX_POR_COTACAO } from "./andamento";
import { PIX_VALIDADE_MINIMA_MINUTOS } from "./provedor";

export const COOKIE_CHECKOUT = "scl_checkout";
export const CAMINHO_COOKIE_CHECKOUT = "/reservar";

/**
 * Até quando vale a autorização de um pedido: o prazo das datas mais o que os Pix podem estendê-lo (até 3, de
 * pelo menos 30 minutos cada, mais a folga) e a carência. Nunca menos de 30 minutos a partir de agora.
 */
export function validadeDaAutorizacao(holdAte: Date | null, agora: Date): Date {
  const base = Math.max(holdAte?.getTime() ?? 0, agora.getTime());
  return new Date(base + MAXIMO_PIX_POR_COTACAO * (PIX_VALIDADE_MINIMA_MINUTOS * 60_000 + FOLGA_PRAZO_PIX_MS) + CARENCIA_PAGAMENTO_MS);
}

/** Token da autorização (assinado com AUTH_SECRET). Sem o segredo configurado, lança: ninguém paga sem ele. */
export function emitirAutorizacao(cotacaoId: string, ate: Date, segredo: string | undefined = process.env.AUTH_SECRET): string {
  if (!uuidValido(cotacaoId)) throw new Error("Cotação inválida.");
  if (!segredo) throw new Error("AUTH_SECRET não configurado: não dá para autorizar o pagamento.");
  return criarToken("checkout-site:v1", cotacaoId, segredo, ate, 0);
}

/** O token autoriza pagar ESTA cotação agora? Adulterado, vencido, de outra finalidade ou de outra cotação = não. */
export function autorizacaoValida(token: string | undefined, cotacaoId: string, agora: Date, segredo: string | undefined = process.env.AUTH_SECRET): boolean {
  return uuidValido(cotacaoId) && lerToken("checkout-site:v1", token, segredo, agora) === cotacaoId;
}
