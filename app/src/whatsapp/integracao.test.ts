/**
 * A situação do WhatsApp para Integrações e Sistema (M10.1a, desenho 6.8): as variáveis só como "existe" (nunca o valor),
 * os ids configurados, a conta escrita pelos avisos, os contadores de hoje, os últimos avisos da conta com o resultado
 * do e-mail (um por causa, sem supor) e o endereço fixo. PGlite, sem rede; só valores fictícios; o ambiente é um objeto
 * montado aqui (nunca o `process.env` da sessão).
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { whatsappAvisosDia, whatsappEventos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { ENDERECO_WEBHOOK } from "@/pagamentos/integracao";
import { ENDERECO_PRODUCAO } from "@/sistema/ambiente";
import { REPETIR_EMAIL_DIAS } from "./avisos";
import { somarNoDia } from "./contadores";
import { ENDERECO_WEBHOOK_WHATSAPP, EVENTOS_DA_CONTA_NA_TELA, situacaoDoWhatsapp } from "./integracao";
import { avisoDeConta, CANARIOS, entregarAviso, FICTICIOS, HORA_DO_AVISO, organizacaoComWhatsapp } from "./testes";

const AGORA = new Date("2026-10-17T18:00:00Z");
const TOKEN = "senha-de-verificacao-ficticia-com-40-letras";
const SEGREDO = "segredo-do-app-ficticio";
const AMBIENTE = { WHATSAPP_RECEBIMENTO: "ligada", WHATSAPP_VERIFY_TOKEN: TOKEN, WHATSAPP_APP_SECRET: SEGREDO } as unknown as NodeJS.ProcessEnv;
const min = (n: number) => new Date(HORA_DO_AVISO.getTime() + n * 60_000);

let db: Db, close: () => Promise<void>, org: string;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  org = await organizacaoComWhatsapp(db);
});
afterEach(() => close());

describe("situacaoDoWhatsapp (M10.1a)", () => {
  it("o endereço do aviso sai do endereço de produção, num lugar só (o do Mercado Pago continua o mesmo)", () => {
    expect(ENDERECO_WEBHOOK_WHATSAPP).toBe(`${ENDERECO_PRODUCAO}/api/whatsapp`);
    expect(ENDERECO_WEBHOOK).toBe(`${ENDERECO_PRODUCAO}/api/pagamentos/mercadopago`);
    expect(ENDERECO_PRODUCAO).toBe("https://scl-reconstrucao.vercel.app");
  });

  it("antes de qualquer aviso: conta não conectada, nada sincronizado, contadores zerados, nenhum evento", async () => {
    const s = await situacaoDoWhatsapp(db, org, {} as NodeJS.ProcessEnv, AGORA);
    expect(s).toEqual({
      recebimentoLigado: false,
      token: "falta",
      segredoConfigurado: false,
      config: { wabaId: FICTICIOS.waba, numeroId: FICTICIOS.numero, quemVeConversas: "so_admin" },
      conta: {
        situacao: "nao_conectada",
        ultimoEvento: null,
        motivo: null,
        iniciadoPor: null,
        situacaoEm: null,
        conectadoEm: null,
        prazo24h: null,
        sincronizacaoContatos: "nao_pedida",
        contatosRecebidosEm: null,
        sincronizacaoHistorico: "nao_pedida",
        progressoHistorico: null,
      },
      avisos: { hoje: { assinaturas_recusadas: 0, ilegiveis: 0, outra_conta: 0, desconhecidos: 0, ignorados: 0 }, ultimoValidoEm: null },
      eventosDaConta: [],
      enderecoWebhook: ENDERECO_WEBHOOK_WHATSAPP,
    });
  });

  it("as variáveis aparecem só como situação (ligado, senha ok ou curta, segredo existe), nunca o valor", async () => {
    const s = await situacaoDoWhatsapp(db, org, AMBIENTE, AGORA);
    expect(s).toMatchObject({ recebimentoLigado: true, token: "ok", segredoConfigurado: true });
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    expect(JSON.stringify(s)).not.toContain(SEGREDO);
    const curto = await situacaoDoWhatsapp(db, org, { ...AMBIENTE, WHATSAPP_VERIFY_TOKEN: "x".repeat(31), WHATSAPP_RECEBIMENTO: "sim" }, AGORA);
    expect(curto).toMatchObject({ recebimentoLigado: false, token: "curto" });
  });

  it("sem o id do número configurado, a configuração mostra null (a tela avisa)", async () => {
    const outra = await organizacaoComWhatsapp(db, { numeroId: null });
    expect((await situacaoDoWhatsapp(db, outra, AMBIENTE, AGORA)).config).toEqual({ wabaId: FICTICIOS.waba, numeroId: null, quemVeConversas: "so_admin" });
  });

  it("depois da conexão: conectada, com o prazo de 24 h correndo; contadores de hoje e o último aviso válido", async () => {
    await entregarAviso(db, avisoDeConta({ evento: "PARTNER_ADDED", em: min(0) }), min(1));
    await somarNoDia(db, { assinaturas_recusadas: 2, ignorados: 1 }, AGORA);
    const s = await situacaoDoWhatsapp(db, org, AMBIENTE, AGORA);
    expect(s.conta).toMatchObject({ situacao: "conectada", ultimoEvento: "PARTNER_ADDED", conectadoEm: min(0), prazo24h: new Date(min(0).getTime() + 24 * 3_600_000) });
    expect(s.avisos.hoje).toMatchObject({ assinaturas_recusadas: 2, ignorados: 1 });
    expect(s.avisos.ultimoValidoEm).toEqual(min(1));
    expect(s.eventosDaConta).toEqual([{ tipo: "PARTNER_ADDED", motivo: null, ocorridoEm: min(0), email: "nao_se_aplica" }]);
    // Passado o prazo, não aparece mais.
    expect((await situacaoDoWhatsapp(db, org, AMBIENTE, new Date(min(0).getTime() + 25 * 3_600_000))).conta.prazo24h).toBeNull();
  });

  it("últimos avisos da conta, do mais novo para o mais velho, com o resultado do e-mail por causa (pendente sem tentativa)", async () => {
    await entregarAviso(db, avisoDeConta({ evento: "PARTNER_ADDED", em: min(0) }), min(0));
    await entregarAviso(db, avisoDeConta({ evento: "PARTNER_REMOVED", em: min(1), motivo: "PRIMARY_INACTIVITY", iniciadoPor: "SYSTEM" }), min(1));
    await entregarAviso(db, avisoDeConta({ evento: "ACCOUNT_RECONNECTED", em: min(2) }), min(2));
    await entregarAviso(db, avisoDeConta({ evento: "ACCOUNT_OFFBOARDED", em: min(3) }), min(3));
    await entregarAviso(db, avisoDeConta({ evento: "ACCOUNT_DELETED", em: min(4) }), min(4));
    await entregarAviso(db, avisoDeConta({ evento: "DISABLED_UPDATE", em: min(5), banimento: "DISABLE" }), min(5));
    // Os resultados gravados pelo e-mail (avisos.ts): um texto por causa na tela.
    const ev = async (tipo: string) => (await db.select().from(whatsappEventos).where(eq(whatsappEventos.tipo, tipo as "PARTNER_REMOVED")))[0].id;
    await db.update(whatsappEventos).set({ emailResultado: "enviado", emailAvisoEm: min(1) }).where(eq(whatsappEventos.id, await ev("PARTNER_REMOVED")));
    await db.update(whatsappEventos).set({ emailResultado: "sem-email" }).where(eq(whatsappEventos.id, await ev("ACCOUNT_OFFBOARDED")));
    await db.update(whatsappEventos).set({ emailResultado: "falhou" }).where(eq(whatsappEventos.id, await ev("ACCOUNT_DELETED")));
    const s = await situacaoDoWhatsapp(db, org, AMBIENTE, AGORA);
    expect(s.eventosDaConta).toEqual([
      { tipo: "DISABLED_UPDATE", motivo: null, ocorridoEm: min(5), email: "pendente" },
      { tipo: "ACCOUNT_DELETED", motivo: null, ocorridoEm: min(4), email: "falhou" },
      { tipo: "ACCOUNT_OFFBOARDED", motivo: null, ocorridoEm: min(3), email: "sem-email" },
      { tipo: "ACCOUNT_RECONNECTED", motivo: null, ocorridoEm: min(2), email: "nao_se_aplica" },
      { tipo: "PARTNER_REMOVED", motivo: "PRIMARY_INACTIVITY", ocorridoEm: min(1), email: "enviado" },
      { tipo: "PARTNER_ADDED", motivo: null, ocorridoEm: min(0), email: "nao_se_aplica" },
    ]);
    expect(s.conta).toMatchObject({ situacao: "suspensa", ultimoEvento: "DISABLED_UPDATE" });
  });

  it(`passados ${REPETIR_EMAIL_DIAS} dias sem envio, o e-mail sai como "sem_nova_tentativa" (a rotina parou: a tela não promete outra)`, async () => {
    await entregarAviso(db, avisoDeConta({ evento: "PARTNER_ADDED", em: min(0) }), min(0));
    await entregarAviso(db, avisoDeConta({ evento: "PARTNER_REMOVED", em: min(1) }), min(1));
    await entregarAviso(db, avisoDeConta({ evento: "ACCOUNT_OFFBOARDED", em: min(2) }), min(2));
    await entregarAviso(db, avisoDeConta({ evento: "ACCOUNT_DELETED", em: min(3) }), min(3));
    const ev = async (tipo: string) => (await db.select().from(whatsappEventos).where(eq(whatsappEventos.tipo, tipo as "PARTNER_REMOVED")))[0].id;
    await db.update(whatsappEventos).set({ emailResultado: "falhou" }).where(eq(whatsappEventos.id, await ev("PARTNER_REMOVED")));
    await db.update(whatsappEventos).set({ emailResultado: "enviado", emailAvisoEm: min(3) }).where(eq(whatsappEventos.id, await ev("ACCOUNT_OFFBOARDED")));
    // ACCOUNT_DELETED sem tentativa nenhuma (o after() e a rotina não chegaram a rodar).
    const oitoDias = new Date(min(3).getTime() + 8 * 86_400_000);
    expect((await situacaoDoWhatsapp(db, org, AMBIENTE, oitoDias)).eventosDaConta.map((e) => [e.tipo, e.email])).toEqual([
      ["ACCOUNT_DELETED", "sem_nova_tentativa"],
      ["ACCOUNT_OFFBOARDED", "enviado"],
      ["PARTNER_REMOVED", "sem_nova_tentativa"],
      ["PARTNER_ADDED", "nao_se_aplica"],
    ]);
    // Ainda dentro do prazo (a mesma regra da rotina), cada um mostra a própria causa.
    const seisDias = new Date(min(3).getTime() + 6 * 86_400_000);
    expect((await situacaoDoWhatsapp(db, org, AMBIENTE, seisDias)).eventosDaConta.map((e) => e.email)).toEqual(["pendente", "enviado", "falhou", "nao_se_aplica"]);
  });

  it(`só os ${EVENTOS_DA_CONTA_NA_TELA} mais recentes, só da organização, e sem os blocos de mensagem`, async () => {
    for (let i = 0; i < EVENTOS_DA_CONTA_NA_TELA + 2; i++) await entregarAviso(db, avisoDeConta({ evento: "ACCOUNT_RESTRICTION", em: min(i) }), min(i));
    const outra = await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba, numeroId: FICTICIOS.outroNumero }, { manterOutras: true });
    await db.insert(whatsappEventos).values([
      { organizacaoId: outra, campo: "account_update", tipo: "PARTNER_REMOVED", chave: "account_update:outra", ocorridoEm: min(99), resultado: "gravado" },
      { organizacaoId: org, campo: "messages", resultado: "gravado", itens: 3 },
    ]);
    const s = await situacaoDoWhatsapp(db, org, AMBIENTE, AGORA);
    expect(s.eventosDaConta).toHaveLength(EVENTOS_DA_CONTA_NA_TELA);
    expect(s.eventosDaConta[0].ocorridoEm).toEqual(min(EVENTOS_DA_CONTA_NA_TELA + 1));
    expect(s.eventosDaConta.every((e) => e.tipo === "ACCOUNT_RESTRICTION")).toBe(true);
  });

  it("nada devolvido leva dado pessoal nem id da Meta além dos ids configurados", async () => {
    await entregarAviso(db, avisoDeConta({ evento: "PARTNER_REMOVED", em: min(1), wabaInfo: null, telefone: CANARIOS.waIdBr, motivo: "ACCOUNT_DISCONNECTED" }), min(1));
    await db.delete(whatsappAvisosDia);
    const texto = JSON.stringify(await situacaoDoWhatsapp(db, org, AMBIENTE, AGORA));
    for (const v of Object.values(CANARIOS)) expect(texto, v).not.toContain(v);
    expect(texto).not.toContain(FICTICIOS.outraWaba);
  });
});
