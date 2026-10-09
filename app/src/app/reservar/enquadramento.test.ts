import { expect, it } from "vitest";
import { DOMINIOS_DESAFIO } from "@/pagamentos/provedor";
import { politicaDaPaginaDePagamento } from "@/site/politica-de-frames";
import nextConfig from "../../../next.config";

it("a página da cotação (onde o hóspede paga) não pode ser enquadrada por outro site (M8.2a) e só enquadra o Mercado Pago (M8.2b); o resto da configuração continua", async () => {
  const regras = await nextConfig.headers!();
  const reservar = regras.find((r) => r.source === "/reservar/:path*");
  expect(reservar?.headers).toEqual([
    { key: "Content-Security-Policy", value: politicaDaPaginaDePagamento() },
    { key: "X-Frame-Options", value: "DENY" },
  ]);
  expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe("6mb");
});

it("frame-src montado dos mesmos domínios que conferem o endereço do desafio do banco, com frame-ancestors 'none' mantido", () => {
  const politica = politicaDaPaginaDePagamento();
  expect(politica).toBe(
    "frame-ancestors 'none'; frame-src 'self' https://mercadopago.com https://*.mercadopago.com https://mercadopago.com.br https://*.mercadopago.com.br https://mercadolibre.com https://*.mercadolibre.com https://mercadolivre.com.br https://*.mercadolivre.com.br",
  );
  for (const d of DOMINIOS_DESAFIO) expect(politica).toContain(`https://*.${d}`);
  // Nenhum curinga solto nem http.
  expect(politica).not.toMatch(/\shttps?:\/\/\*\s|\shttp:|\s\*\s/);
});
