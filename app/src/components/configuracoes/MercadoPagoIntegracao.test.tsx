import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { SituacaoMercadoPago } from "@/pagamentos/integracao";
import { chavesDesencontradas, MercadoPagoIntegracao, textoAmbiente } from "./MercadoPagoIntegracao";

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
/** Contam como produção sem ser o deploy de produção (`motivoDaProducao`). */
const SO_CONTAM_COMO_PRODUCAO: Record<string, string>[] = [{ VERCEL_ENV: "staging" }, { NODE_ENV: "production" }];

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

it("cartão (M8.2b): a chave pública é do formulário do cartão; chave pública e token de contas ou ambientes diferentes viram aviso (só pelo prefixo, nunca a chave)", () => {
  const trocadas = env({ VERCEL_ENV: "preview", MERCADOPAGO_PUBLIC_KEY: "TEST-chave-publica-ficticia", MERCADOPAGO_ACCESS_TOKEN: "APP_USR-token-ficticio" });
  expect(chavesDesencontradas(trocadas)).toBe(true);
  const h = renderToStaticMarkup(<MercadoPagoIntegracao mp={mp()} env={trocadas} />);
  expect(h).toContain("Usa a chave pública (MERCADOPAGO_PUBLIC_KEY)");
  expect(h).toContain("A chave pública e o token do Mercado Pago parecem ser de contas ou ambientes diferentes: o cartão vai recusar todos os pagamentos.");
  expect(h).not.toContain("chave-publica-ficticia");
  expect(h).not.toContain("token-ficticio");
  expect(chavesDesencontradas(env({ MERCADOPAGO_PUBLIC_KEY: "APP_USR-a", MERCADOPAGO_ACCESS_TOKEN: "APP_USR-b" }))).toBe(false);
  expect(chavesDesencontradas(env({ MERCADOPAGO_PUBLIC_KEY: "TEST-a", MERCADOPAGO_ACCESS_TOKEN: "TEST-b" }))).toBe(false);
  expect(chavesDesencontradas(env({ MERCADOPAGO_ACCESS_TOKEN: "APP_USR-b" }))).toBe(false);
  const semChave = renderToStaticMarkup(<MercadoPagoIntegracao mp={mp()} env={env({ VERCEL_ENV: "preview" })} />);
  expect(semChave).toContain("Falta MERCADOPAGO_PUBLIC_KEY: o cartão não é oferecido (o Pix não depende dela)");
  expect(semChave).not.toContain("contas ou ambientes diferentes");
});

it("M7.12: onde roda pela mesma regra do pagamento (ambienteDoSistema): VERCEL_ENV inesperado ou NODE_ENV=production fora da Vercel contam como produção", () => {
  expect(textoAmbiente(env({ VERCEL_ENV: "preview" }))).toBe("teste · prévia da Vercel");
  expect(textoAmbiente(env({ VERCEL_ENV: "development" }))).toBe("teste · computador de desenvolvimento");
  expect(textoAmbiente(env({ NODE_ENV: "development" }))).toBe("teste · computador de desenvolvimento");
  expect(textoAmbiente(env({ VERCEL_ENV: "production" }))).toBe("teste · deploy de produção");
  // Antes, estes dois diziam "computador de desenvolvimento" enquanto o pagamento já os tratava como produção. Agora dizem
  // que contam como produção, e por quê, sem chamar de deploy de produção o que não é.
  expect(textoAmbiente(env({ VERCEL_ENV: "staging" }))).toBe("teste · conta como produção (VERCEL_ENV inesperado, nem preview nem development)");
  expect(textoAmbiente(env({ NODE_ENV: "production" }))).toBe("teste · conta como produção (fora da Vercel, com NODE_ENV=production)");
  for (const e of SO_CONTAM_COMO_PRODUCAO) expect(textoAmbiente(env(e))).not.toContain("deploy de produção");
  // A nota do "Conferir agora" só fora da produção, pela mesma regra.
  const nota = "aqui use Conferir agora";
  expect(renderToStaticMarkup(<MercadoPagoIntegracao mp={mp()} env={env({ VERCEL_ENV: "development" })} />)).toContain(nota);
  expect(renderToStaticMarkup(<MercadoPagoIntegracao mp={mp()} env={env({ VERCEL_ENV: "staging" })} />)).not.toContain(nota);
  expect(renderToStaticMarkup(<MercadoPagoIntegracao mp={mp()} env={env({ NODE_ENV: "production" })} />)).not.toContain(nota);
});

it("revisão do M7.12: onde só conta como produção, a linha Conexão também não afirma o deploy de produção", () => {
  const linhas = (o: Partial<SituacaoMercadoPago>, e: Record<string, string>) => renderToStaticMarkup(<MercadoPagoIntegracao mp={mp({ contaDeTeste: null, ...o })} env={env(e)} />);
  // Chaves de teste configuradas fora do ambiente de teste.
  expect(linhas({ situacao: "so_nas_previas" }, { VERCEL_ENV: "production" })).toContain("Chaves configuradas, mas aqui é o deploy de produção: o teste do pagamento roda nas prévias");
  for (const e of SO_CONTAM_COMO_PRODUCAO) {
    const h = linhas({ situacao: "so_nas_previas" }, e);
    expect(h).toContain("Chaves configuradas, mas aqui conta como produção: o teste do pagamento roda nas prévias");
    expect(h).not.toContain("deploy de produção");
  }
  // Sem as chaves: o aviso "Deploy de produção: ..." só no deploy de verdade; onde só conta como produção, segue desligado.
  const semChaves = { situacao: "desligado" as const, motivo: "Falta configurar MERCADOPAGO_ACCESS_TOKEN." };
  expect(linhas(semChaves, { VERCEL_ENV: "production", MERCADOPAGO_AMBIENTE: "teste" })).toContain("Deploy de produção: o teste do pagamento roda nas prévias");
  for (const e of SO_CONTAM_COMO_PRODUCAO) {
    const h = linhas(semChaves, { ...e, MERCADOPAGO_AMBIENTE: "teste" });
    expect(h).toContain("Desligado: Falta configurar MERCADOPAGO_ACCESS_TOKEN.");
    expect(h).not.toContain("deploy de produção");
  }
});
