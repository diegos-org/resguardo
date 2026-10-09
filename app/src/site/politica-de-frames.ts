/**
 * Política de conteúdo da página da cotação (onde o hóspede paga), lida pelo `next.config.ts`. Nenhum outro site pode
 * enquadrar a página (contra clique disfarçado, M8.2a), e a página só enquadra o próprio site e os domínios do Mercado
 * Pago (M8.2b: o formulário do cartão e o desafio do banco) — os mesmos `DOMINIOS_DESAFIO` que conferem o endereço do
 * desafio, então o navegador também barra qualquer outro. Import relativo: o `next.config.ts` não passa pelo "@/".
 */
import { DOMINIOS_DESAFIO } from "../pagamentos/provedor";

/** `frame-src` do domínio e dos subdomínios de cada um dos domínios do Mercado Pago aceitos. */
export function politicaDaPaginaDePagamento(): string {
  const hosts = DOMINIOS_DESAFIO.flatMap((d) => [`https://${d}`, `https://*.${d}`]);
  return `frame-ancestors 'none'; frame-src 'self' ${hosts.join(" ")}`;
}
