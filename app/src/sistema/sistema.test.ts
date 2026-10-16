import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { execucoesAutomacao, imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { salvarRecebimento } from "@/imoveis/recebimento";
import { AUTOMACOES, execucaoNaoRodou, naoRodou, registrarExecucao, ultimasExecucoes } from "./automacoes";
import { regrasEmVigor } from "./regras";
import type { SituacaoMercadoPago } from "@/pagamentos/integracao";
import { NOME_MERCADO_PAGO, NOME_SENTRY, servicoMercadoPago, situacaoServicos } from "./servicos";

describe("serviços", () => {
  it("refresh token configura Beds24 sem afirmar conexão testada nem expor o valor", () => {
    const s = situacaoServicos({ NODE_ENV: "test", BEDS24_REFRESH_TOKEN: "refresh-secreto" }, null);
    expect(s.find((x) => x.nome === "Beds24")).toMatchObject({ situacao: "configurado", detalhe: expect.stringContaining("não testada") });
    expect(JSON.stringify(s)).not.toContain("refresh-secreto");
    expect(situacaoServicos({ NODE_ENV: "test", BEDS24_REFRESH_TOKEN: "  " }, null).find((x) => x.nome === "Beds24")?.situacao).toBe("nao_configurado");
  });
  it("mostra a situação sem nunca expor chaves", () => {
    const env = {
      DATABASE_URL: "postgres://u:senha-secreta@ep-x.neon.tech/db",
      AUTH_SECRET: "s3gr3do",
      AUTH_GOOGLE_ID: "id-google",
      AUTH_GOOGLE_SECRET: "segredo-google",
      BEDS24_API_KEY: "chave-beds24",
    } as unknown as NodeJS.ProcessEnv;
    const s = situacaoServicos(env, true);
    const texto = JSON.stringify(s);
    for (const segredo of ["senha-secreta", "s3gr3do", "segredo-google", "chave-beds24", "id-google"]) expect(texto).not.toContain(segredo);
    const por = Object.fromEntries(s.map((x) => [x.nome, x]));
    expect(por["Banco de dados (Neon)"].situacao).toBe("ok");
    expect(por["Login com Google"].situacao).toBe("configurado"); // chave existe, mas não foi testado
    expect(por["Beds24"].situacao).toBe("configurado");
    expect(por["E-mail do sistema (Resend)"].situacao).toBe("nao_configurado");
    expect(por["Beds24"].detalhe).toContain("desligado");
    expect(por["WhatsApp (Meta)"].situacao).toBe("planejado");
  });

  it("banco fora do ar e escrita no Beds24 ligada aparecem", () => {
    const s = situacaoServicos({ DATABASE_URL: "postgres://x@h.neon.tech/d", BEDS24_API_KEY: "k", BEDS24_ESCRITA: "ligada" } as unknown as NodeJS.ProcessEnv, false);
    expect(s[0].situacao).toBe("falha");
    expect(s.find((x) => x.nome === "Beds24")?.detalhe).toContain("LIGADO");
    expect(situacaoServicos({} as NodeJS.ProcessEnv, null)[0].situacao).toBe("nao_configurado");
  });
});

describe("Beds24 em Serviços (M8.3a): as duas chaves pelas funções, independentes, e o aviso de credencial fora da produção", () => {
  const beds24 = (e: Record<string, string>) => situacaoServicos(e as unknown as NodeJS.ProcessEnv, null).find((x) => x.nome === "Beds24")!.detalhe;
  const PRODUCAO = { VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_REFRESH_TOKEN: "refresh-ficticio" };

  it("só a chave do calendário: o calendário ligado e as reservas desligadas", () => {
    const d = beds24({ ...PRODUCAO, BEDS24_ESCRITA: "ligada" });
    expect(d).toContain("envio para o Beds24 LIGADO");
    expect(d).toContain("reservas do site no Beds24: chave desligada (BEDS24_ESCRITA_RESERVAS)");
  });

  it("só a chave das reservas: as reservas prontas no deploy de produção e o calendário desligado; o valor \"Ligada\" não liga", () => {
    const d = beds24({ ...PRODUCAO, BEDS24_ESCRITA_RESERVAS: "ligada" });
    expect(d).toContain("envio para o Beds24 desligado (BEDS24_ESCRITA)");
    expect(d).toContain("reservas do site no Beds24: chave LIGADA e pronta neste deploy");
    expect(d).not.toContain("Credencial de escrita presente fora da produção");
    expect(beds24({ ...PRODUCAO, BEDS24_ESCRITA_RESERVAS: "Ligada" })).toContain("reservas do site no Beds24: chave desligada");
  });

  it("a chave das reservas numa prévia (ou nos testes) não fica pronta; o refresh token ali dá o aviso, sem mostrar o valor", () => {
    const d = beds24({ ...PRODUCAO, VERCEL_ENV: "preview", BEDS24_ESCRITA_RESERVAS: "ligada" });
    expect(d).toContain("chave ligada, mas a escrita não sai daqui");
    expect(d).toContain("Credencial de escrita presente fora da produção");
    expect(d).not.toContain("refresh-ficticio");
    expect(beds24({ NODE_ENV: "test", BEDS24_API_KEY: "token-direto" })).not.toContain("Credencial de escrita presente fora da produção");
    // Sem credencial nenhuma, as chaves aparecem do mesmo jeito.
    expect(beds24({ BEDS24_ESCRITA_RESERVAS: "ligada" })).toContain("Falta BEDS24_REFRESH_TOKEN");
    expect(beds24({ BEDS24_ESCRITA_RESERVAS: "ligada" })).toContain("reservas do site no Beds24: chave ligada");
  });

  it("a chave do calendário ligada sem credencial: não diz LIGADO (nada é enviado); com o token direto, o calendário envia", () => {
    const d = beds24({ BEDS24_ESCRITA: "ligada" });
    expect(d).toContain("Falta BEDS24_REFRESH_TOKEN");
    expect(d).toContain("envio para o Beds24: chave ligada, mas sem credencial: nada é enviado (BEDS24_ESCRITA)");
    expect(d).not.toContain("LIGADO");
    expect(beds24({ BEDS24_API_KEY: "k", BEDS24_ESCRITA: "ligada" })).toContain("envio para o Beds24 LIGADO");
  });

  it("a rotina das reservas do site aparece como planejada, do M8.3c", () => {
    expect(AUTOMACOES.find((a) => a.id === "reservas-beds24")).toMatchObject({ situacao: "planejada", item: "M8.3c", nome: "Reservas pagas do site no Beds24 (criar, atualizar, cancelar e conferir)", quando: expect.stringContaining("BEDS24_ESCRITA_RESERVAS=ligada") });
  });
});

describe("Sentry em Serviços e Integrações (M0.9): a mesma regra que liga o envio", () => {
  const DSN = "https://chavepublicaficticia@o0.ingest.exemplo.io/0";
  const linha = (env: Record<string, string>) => situacaoServicos({ NODE_ENV: "test", ...env } as NodeJS.ProcessEnv, null).find((x) => x.nome === NOME_SENTRY)!;

  it("ligado no deploy de produção e nas prévias; sem endereço, falta configurar", () => {
    expect(linha({ NEXT_PUBLIC_SENTRY_DSN: DSN, VERCEL_ENV: "production" })).toMatchObject({ situacao: "configurado", detalhe: expect.stringContaining("Ligado no deploy de produção") });
    expect(linha({ NEXT_PUBLIC_SENTRY_DSN: DSN, VERCEL_ENV: "preview" })).toMatchObject({ situacao: "configurado", detalhe: expect.stringContaining("nesta prévia") });
    expect(linha({ VERCEL_ENV: "production" })).toMatchObject({ situacao: "nao_configurado", detalhe: expect.stringContaining("Falta NEXT_PUBLIC_SENTRY_DSN") });
    expect(linha({ NEXT_PUBLIC_SENTRY_DSN: DSN })).toMatchObject({ situacao: "configurado", detalhe: expect.stringContaining("desligado aqui") });
  });

  it("endereço de envio com a forma errada aparece como problema, sem mostrar o valor", () => {
    for (const dsn of ["https://chave@o0.ingest.exemplo.io/projeto", "valor-colado-errado", `"${DSN}"`]) {
      const l = linha({ NEXT_PUBLIC_SENTRY_DSN: dsn, VERCEL_ENV: "production" });
      expect(l.situacao, dsn).toBe("falha");
      expect(l.detalhe).toContain("Confira o valor na Vercel");
      expect(JSON.stringify(l)).not.toMatch(/o0\.ingest|colado-errado|chavepublicaficticia/);
    }
  });
});

describe("Mercado Pago em Serviços e Integrações (M8.2a): a mesma situação de situacaoDoMercadoPago", () => {
  const mp = (o: Partial<SituacaoMercadoPago> = {}): SituacaoMercadoPago => ({
    situacao: "teste",
    motivo: null,
    contaDeTeste: true,
    segredoWebhook: true,
    ultimoAvisoValidoEm: new Date("2026-10-08T13:00:00Z"),
    assinaturasRecusadasHoje: 2,
    enderecoWebhook: "https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago",
    ...o,
  });
  const vazio = {} as NodeJS.ProcessEnv;
  it("ok só com a conta conferida como de teste; não é de teste ou não conferida = com problema", () => {
    expect(servicoMercadoPago(mp(), vazio)).toMatchObject({ nome: NOME_MERCADO_PAGO, situacao: "ok", detalhe: expect.stringContaining("conta conferida como de teste") });
    expect(servicoMercadoPago(mp(), vazio).detalhe).toContain("último aviso válido em 08/10/2026 às 10:00 · 2 assinatura(s) recusada(s) hoje");
    expect(servicoMercadoPago(mp({ contaDeTeste: false }), vazio)).toMatchObject({ situacao: "falha", detalhe: expect.stringContaining("NÃO é de teste") });
    expect(servicoMercadoPago(mp({ contaDeTeste: null }), vazio)).toMatchObject({ situacao: "falha", detalhe: expect.stringContaining("não deu para conferir") });
  });
  it("desligado, configuração inválida, só nas prévias e produção travada", () => {
    expect(servicoMercadoPago(mp({ situacao: "desligado", motivo: "Falta configurar MERCADOPAGO_ACCESS_TOKEN.", contaDeTeste: null, segredoWebhook: false }), vazio)).toMatchObject({
      situacao: "nao_configurado",
      detalhe: expect.stringContaining("sem segredo do webhook"),
    });
    expect(servicoMercadoPago(mp({ situacao: "desligado", motivo: "MERCADOPAGO_AMBIENTE com valor inesperado: use teste ou producao.", contaDeTeste: null }), { MERCADOPAGO_AMBIENTE: "prod" } as unknown as NodeJS.ProcessEnv).situacao).toBe("falha");
    expect(servicoMercadoPago(mp({ situacao: "so_nas_previas", contaDeTeste: null }), vazio).detalhe).toContain("roda nas prévias");
    expect(servicoMercadoPago(mp({ situacao: "producao_travada", contaDeTeste: null }), vazio).detalhe).toContain("travado");
    // No deploy de produção, sem as chaves (que ficam só em Preview): é o esperado, não "falta configurar".
    const producao = { VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv;
    expect(servicoMercadoPago(mp({ situacao: "desligado", motivo: "Falta configurar MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_PUBLIC_KEY.", contaDeTeste: null }), producao)).toMatchObject({
      situacao: "configurado",
      detalhe: expect.stringContaining("o teste do pagamento roda nas prévias"),
    });
    expect(servicoMercadoPago(mp({ situacao: "desligado", motivo: "x", contaDeTeste: null }), { VERCEL_ENV: "production", MERCADOPAGO_AMBIENTE: "prod" } as unknown as NodeJS.ProcessEnv).situacao).toBe("falha");
  });
  it("situacaoServicos usa a situação lida; sem ela, diz que não foi conferida (nunca 'planejado')", () => {
    expect(situacaoServicos(vazio, null, mp()).find((x) => x.nome === NOME_MERCADO_PAGO)?.situacao).toBe("ok");
    expect(situacaoServicos(vazio, null).find((x) => x.nome === NOME_MERCADO_PAGO)).toMatchObject({ situacao: "nao_configurado", detalhe: "Situação não conferida nesta abertura" });
  });
});

describe("automações e regras (com banco)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let org: string;
  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  });
  afterEach(() => close());

  it("registra execuções com sucesso e com falha; mostra a última de cada uma", async () => {
    let t = Date.parse("2026-09-24T10:00:00Z");
    const agora = () => new Date((t += 1000));
    expect(await registrarExecucao(db, "recalculo-deploy", async () => "3 reservas", agora)).toBe("3 reservas");
    await expect(registrarExecucao(db, "recalculo-deploy", async () => Promise.reject(new Error("banco caiu")), agora)).rejects.toThrow("banco caiu");
    const u = await ultimasExecucoes(db);
    expect(u.get("recalculo-deploy")).toMatchObject({ ok: false, resumo: "Falhou: banco caiu" });
    expect(AUTOMACOES.find((a) => a.id === "recalculo-deploy")?.situacao).toBe("ativa");
  });

  it("'não rodou' (M8.3a): fica com ok falso e o resumo 'Não rodou: <causa>', sem lançar erro; nunca como sucesso", async () => {
    const agora = () => new Date("2026-10-16T09:15:00Z");
    expect(await registrarExecucao(db, "sync-beds24", async () => naoRodou("envio de reserva do site ao Beds24 em andamento"), agora)).toBe("Não rodou: envio de reserva do site ao Beds24 em andamento");
    const e = (await ultimasExecucoes(db)).get("sync-beds24");
    expect(e).toMatchObject({ ok: false, resumo: "Não rodou: envio de reserva do site ao Beds24 em andamento", terminadoEm: agora() });
    expect(execucaoNaoRodou(e!)).toBe(true);
    expect(execucaoNaoRodou({ ok: false, resumo: "Falhou: banco caiu" })).toBe(false);
    expect(execucaoNaoRodou({ ok: true, resumo: "Não rodou: texto" })).toBe(false);
  });

  it("a rotina de 10 em 10 minutos não esconde a última execução das que rodam raramente (M8.2a)", async () => {
    let t = Date.parse("2026-09-01T12:00:00Z");
    const agora = () => new Date((t += 1000));
    await registrarExecucao(db, "fechamento-email", async () => "mês fechado", agora);
    for (let i = 0; i < 520; i++) await db.insert(execucoesAutomacao).values({ nome: "pedidos-site", iniciadoEm: agora(), terminadoEm: agora(), ok: true, resumo: `volta ${i}` });
    const u = await ultimasExecucoes(db);
    expect(u.get("fechamento-email")).toMatchObject({ ok: true, resumo: "mês fechado" });
    expect(u.get("pedidos-site")?.resumo).toBe("volta 519");
    expect(AUTOMACOES.find((a) => a.id === "pedidos-site")).toMatchObject({ situacao: "ativa", item: "M8.2a", nome: expect.stringContaining("Pedidos e pagamentos do site") });
  });

  it("regras em vigor: contrato de hoje, próximo contrato, dono e quem recebe (imóvel × padrão)", async () => {
    const [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "102", nome: "Studio" }).returning();
    const [{ id: sem }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "103", nome: "Outro" }).returning();
    const [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona Fictícia", email: "d@example.com" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im });
    await criarContrato(db, org, im, { tipo: "gestao_completa", comissao: "20", inicio: "2025-01-01", fim: "2026-12-31" }, null);
    await criarContrato(db, org, im, { tipo: "gestao_completa", comissao: "15", inicio: "2027-01-01" }, null);
    await salvarRecebimento(db, org, im, { booking: "split" }, null);
    const r = await regrasEmVigor(db, org, "2026-09-24");
    const a = r.find((x) => x.imovelId === im)!;
    expect(a).toMatchObject({ proprietario: "Dona Fictícia", contrato: "Gestão completa · 20%" });
    expect(a.proximoContrato).toContain("15% a partir de 01/01/2027");
    expect(a.recebimento.find((x) => x.origem === "booking")).toEqual({ origem: "booking", valor: "split", fonte: "imovel" });
    expect(a.recebimento.find((x) => x.origem === "airbnb")).toEqual({ origem: "airbnb", valor: "split", fonte: "padrao" });
    expect(r.find((x) => x.imovelId === sem)).toMatchObject({ proprietario: null, contrato: null });
  });
});
