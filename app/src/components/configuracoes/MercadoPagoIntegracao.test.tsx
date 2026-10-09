import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { SituacaoMercadoPago } from "@/pagamentos/integracao";
import { MercadoPagoIntegracao, textoAmbiente } from "./MercadoPagoIntegracao";

const ENDERECO = "https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago";
const mp = (o: Partial<SituacaoMercadoPago> = {}): SituacaoMercadoPago => ({
  situacao: "teste",
  motivo: null,
  contaDeTeste: true,
  segredoWebhook: true,
  ultimoAvisoValidoEm: new Date("2026-10-08T13:00:00Z"),
  assinaturasRecusadasHoje: 3,
  enderecoWebhook: ENDERECO,
  ...o,
});
const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

it("na prévia: conexão, conta de teste conferida, ambiente, segredo, último aviso, recusadas, endereço com copiar e a nota do Conferir agora", () => {
  const h = renderToStaticMarkup(<MercadoPagoIntegracao mp={mp()} env={env({ VERCEL_ENV: "preview", MERCADOPAGO_AMBIENTE: "teste" })} />);
  expect(h).toContain("Ligado em teste (nenhuma cobrança real)");
  expect(h).toContain("Conferida no Mercado Pago: é uma conta de teste.");
  expect(h).toContain("teste · prévia da Vercel");
  expect(h).toContain("Configurado (MERCADOPAGO_WEBHOOK_SECRET)");
  expect(h).toContain("08/10/2026, 10:00");
  expect(h).toContain("<dd style=\"margin:0\">3</dd>");
  expect(h).toContain(`<code>${ENDERECO}</code>`);
  expect(h).toContain("Copiar endereço");
  expect(h).toContain("o aviso só chega no endereço de produção; aqui use Conferir agora".replace("o aviso", "O aviso"));
  expect(h).toContain("Order (Mercado Pago)");
});

it("no deploy de produção: sem a nota da prévia; o teste roda nas prévias; segredo ausente e conta não conferida", () => {
  const h = renderToStaticMarkup(<MercadoPagoIntegracao mp={mp({ situacao: "so_nas_previas", contaDeTeste: null, segredoWebhook: false, ultimoAvisoValidoEm: null, assinaturasRecusadasHoje: 0 })} env={env({ VERCEL_ENV: "production" })} />);
  expect(h).not.toContain("aqui use Conferir agora");
  expect(h).toContain("o teste do pagamento roda nas prévias");
  expect(h).toContain("Não conferida: só é conferida no ambiente de teste");
  expect(h).toContain("Falta MERCADOPAGO_WEBHOOK_SECRET");
  expect(h).toContain("Nenhum recebido ainda");
});

it("conta que não é de teste, desligado com o motivo e o ambiente inválido", () => {
  expect(renderToStaticMarkup(<MercadoPagoIntegracao mp={mp({ contaDeTeste: false })} env={env({})} />)).toContain("NÃO é de teste");
  const desligado = renderToStaticMarkup(<MercadoPagoIntegracao mp={mp({ situacao: "desligado", motivo: "Falta configurar MERCADOPAGO_ACCESS_TOKEN.", contaDeTeste: null })} env={env({})} />);
  expect(desligado).toContain("Desligado: Falta configurar MERCADOPAGO_ACCESS_TOKEN.");
  const producao = renderToStaticMarkup(<MercadoPagoIntegracao mp={mp({ situacao: "desligado", motivo: "Falta configurar MERCADOPAGO_ACCESS_TOKEN.", contaDeTeste: null })} env={env({ VERCEL_ENV: "production" })} />);
  expect(producao).toContain("Deploy de produção: o teste do pagamento roda nas prévias");
  expect(producao).not.toContain("Falta configurar");
  expect(textoAmbiente(env({ MERCADOPAGO_AMBIENTE: "prod" }))).toBe("valor inválido em MERCADOPAGO_AMBIENTE (desligado) · computador de desenvolvimento");
  expect(textoAmbiente(env({ MERCADOPAGO_AMBIENTE: "producao", VERCEL_ENV: "production" }))).toBe("produção (travado nesta fase) · deploy de produção");
});
