/**
 * E-mail da conta do WhatsApp (M10.1a, desenho 4.5; 8-E): um e-mail por evento aplicado que o pede (desconexão, espera
 * de reconexão, suspensão), no endereço da empresa, com a chave do evento; os quatro resultados de
 * `avisarEquipePorEmail` gravados (só o envio confirmado encerra as tentativas); a repetição de hora em hora por 7 dias;
 * os textos exatos, com a data no fuso de São Paulo. PGlite e o correio em memória: nada sai.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerEmpresa, salvarEmpresa } from "@/configuracoes/empresa";
import { whatsappEventos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { type Correio, CorreioMemoria } from "@/email/correio";
import { enviarAvisosDaConta, mensagemDoEvento, reenviarAvisosPendentes, REPETIR_EMAIL_DIAS } from "./avisos";
import { avisoDeConta, CANARIOS, entregarAviso, FICTICIOS, HORA_DO_AVISO, organizacaoComWhatsapp, semDadosPessoaisWhatsapp } from "./testes";

const EMAIL_EMPRESA = "equipe@example.com";
const min = (n: number) => new Date(HORA_DO_AVISO.getTime() + n * 60_000);
const ASSUNTO_DESCONECTADO = "WhatsApp desconectado do sistema";

let db: Db, close: () => Promise<void>, org: string, correio: CorreioMemoria;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  org = await organizacaoComWhatsapp(db);
  await salvarEmpresa(db, org, { ...(await lerEmpresa(db, org)), email: EMAIL_EMPRESA }, null);
  correio = new CorreioMemoria();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

const eventos = () => db.select().from(whatsappEventos).where(eq(whatsappEventos.campo, "account_update"));
/** Entrega um aviso de conta (como a rota, depois da assinatura) e devolve os e-mails que ele pediu. */
const entregarConta = async (o: Parameters<typeof avisoDeConta>[0], agora = min(1)) => (await entregarAviso(db, avisoDeConta(o), agora)).emails;

describe("enviarAvisosDaConta (M10.1a)", () => {
  it("um e-mail por evento, no endereço da empresa, com a chave do evento; o mesmo aviso entregue duas vezes não manda de novo", async () => {
    const aviso = { evento: "PARTNER_REMOVED", em: min(0), motivo: "PRIMARY_INACTIVITY", iniciadoPor: "SYSTEM" };
    const primeiro = await entregarConta(aviso);
    const segundo = await entregarConta(aviso, min(2));
    expect(primeiro).toHaveLength(1);
    expect(segundo).toEqual([]);
    expect(await enviarAvisosDaConta(db, [...primeiro, ...segundo], correio, min(3))).toEqual({ enviados: 1, falhou: 0, semEmail: 0, semCorreio: 0 });
    // A mesma lista de novo (o after() repetido, ou a rotina depois): o envio já confirmado não sai outra vez.
    expect(await enviarAvisosDaConta(db, primeiro, correio, min(4))).toEqual({ enviados: 0, falhou: 0, semEmail: 0, semCorreio: 0 });
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]).toMatchObject({ para: EMAIL_EMPRESA, assunto: ASSUNTO_DESCONECTADO, conteudoRestrito: true, chave: `whatsapp-conta:${primeiro[0].eventoId}` });
    const [ev] = await eventos();
    expect(ev).toMatchObject({ emailResultado: "enviado", emailAvisoEm: min(3) });
  });

  it("textos exatos da desconexão, com a data no fuso de São Paulo e quem iniciou (quando a conta mostra este evento)", async () => {
    // 15:00 UTC = 12:00 em São Paulo.
    const emails = await entregarConta({ evento: "PARTNER_REMOVED", em: min(0), motivo: "PRIMARY_INACTIVITY", iniciadoPor: "SYSTEM" });
    await enviarAvisosDaConta(db, emails, correio, min(1));
    expect(correio.enviadas[0].assunto).toBe(ASSUNTO_DESCONECTADO);
    expect(correio.enviadas[0].texto).toBe(
      [
        "A Meta avisou em 17/10/2026 às 12:00 (horário de Brasília) que o WhatsApp da empresa foi desconectado do sistema.",
        "Motivo informado: o celular principal ficou cerca de 14 dias sem abrir o WhatsApp Business, pela Meta.",
        "As mensagens novas não chegam ao painel até a conexão ser refeita. O WhatsApp no celular continua funcionando.",
        "Veja em Configurações → Integrações → WhatsApp.",
        "",
      ].join("\n"),
    );
  });

  it("23:30 de São Paulo é o dia anterior em UTC; sem motivo, \"motivo não informado pela Meta\"; pelo próprio aplicativo", async () => {
    const tarde = new Date("2026-10-18T02:30:00Z");
    await enviarAvisosDaConta(db, await entregarConta({ evento: "ACCOUNT_DELETED", em: tarde, iniciadoPor: "USER" }, tarde), correio, tarde);
    expect(correio.enviadas[0].texto).toContain("A Meta avisou em 17/10/2026 às 23:30 (horário de Brasília) que o WhatsApp da empresa foi desconectado do sistema.\n");
    expect(correio.enviadas[0].texto).toContain("Motivo informado: motivo não informado pela Meta, pelo próprio aplicativo.\n");
  });

  it("quem iniciou só aparece quando a conta mostra este evento como o último aplicado (sem palpite)", async () => {
    const emails = await entregarConta({ evento: "PARTNER_APP_UNINSTALLED", em: min(0), motivo: "ACCOUNT_DISCONNECTED", iniciadoPor: "USER" });
    // Um evento mais novo já mudou a conta: o e-mail do primeiro diz só o motivo.
    await entregarConta({ evento: "ACCOUNT_RECONNECTED", em: min(5) }, min(6));
    await enviarAvisosDaConta(db, emails, correio, min(7));
    expect(correio.enviadas[0].texto).toContain("Motivo informado: a conta foi desconectada do sistema.\n");
  });

  it("espera de reconexão e suspensão: assunto e corpo exatos", async () => {
    await enviarAvisosDaConta(db, await entregarConta({ evento: "ACCOUNT_OFFBOARDED", em: min(0) }), correio, min(1));
    await enviarAvisosDaConta(db, await entregarConta({ evento: "DISABLED_UPDATE", em: min(2), banimento: "SCHEDULE_FOR_DISABLE" }, min(3)), correio, min(3));
    expect(correio.enviadas.map((e) => [e.assunto, e.texto])).toEqual([
      [
        "WhatsApp aguardando reconexão",
        "A Meta avisou em 17/10/2026 às 12:00 (horário de Brasília) que o WhatsApp da empresa foi registrado em outro aparelho ou reinstalado. A reconexão costuma ser automática em alguns minutos. Se não voltar, veja em Configurações → Integrações → WhatsApp.\n",
      ],
      [
        "Conta do WhatsApp suspensa pela Meta",
        "A Meta avisou em 17/10/2026 às 12:02 (horário de Brasília) que a conta do WhatsApp da empresa foi suspensa ou está programada para suspensão. Veja em Configurações → Integrações → WhatsApp.\n",
      ],
    ]);
  });

  it("os quatro resultados ficam gravados: só o envio confirmado grava a hora; sem e-mail, sem correio e falha deixam pendente", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const falha: Correio = {
      nome: "falha",
      enviar: async () => {
        throw new Error("provedor fora do ar");
      },
    };
    const [a] = await entregarConta({ evento: "PARTNER_REMOVED", em: min(0) });
    expect(await enviarAvisosDaConta(db, [a], null, min(1))).toEqual({ enviados: 0, falhou: 0, semEmail: 0, semCorreio: 1 });
    expect((await eventos())[0]).toMatchObject({ emailResultado: "sem-correio", emailAvisoEm: null });
    expect(await enviarAvisosDaConta(db, [a], falha, min(2))).toEqual({ enviados: 0, falhou: 1, semEmail: 0, semCorreio: 0 });
    expect((await eventos())[0]).toMatchObject({ emailResultado: "falhou", emailAvisoEm: null });
    await salvarEmpresa(db, org, { ...(await lerEmpresa(db, org)), email: "" }, null);
    expect(await enviarAvisosDaConta(db, [a], correio, min(3))).toEqual({ enviados: 0, falhou: 0, semEmail: 1, semCorreio: 0 });
    expect((await eventos())[0]).toMatchObject({ emailResultado: "sem-email", emailAvisoEm: null });
    await salvarEmpresa(db, org, { ...(await lerEmpresa(db, org)), email: EMAIL_EMPRESA }, null);
    expect(await enviarAvisosDaConta(db, [a], correio, min(4))).toEqual({ enviados: 1, falhou: 0, semEmail: 0, semCorreio: 0 });
    expect((await eventos())[0]).toMatchObject({ emailResultado: "enviado", emailAvisoEm: min(4) });
  });

  it("a recusa de uma tentativa simultânea (mesma chave) não apaga o envio que a outra já confirmou nem conta falha", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const [a] = await entregarConta({ evento: "PARTNER_REMOVED", em: min(0) });
    // O after() da rota e a rotina das :17 no mesmo evento: a outra tentativa confirma o envio enquanto esta espera o
    // provedor, que recusa esta (pedido simultâneo com a mesma chave).
    const concorrente: Correio = {
      nome: "concorrente",
      enviar: async () => {
        await db.update(whatsappEventos).set({ emailResultado: "enviado", emailAvisoEm: min(1) }).where(eq(whatsappEventos.id, a.eventoId));
        throw new Error("pedido simultâneo com a mesma chave");
      },
    };
    expect(await enviarAvisosDaConta(db, [a], concorrente, min(2))).toEqual({ enviados: 0, falhou: 0, semEmail: 0, semCorreio: 0 });
    expect((await eventos())[0]).toMatchObject({ emailResultado: "enviado", emailAvisoEm: min(1) });
  });

  it("evento que não pede e-mail (PARTNER_APP_INSTALLED, conexão, reconexão, restrição) não manda nada", async () => {
    expect(await entregarConta({ evento: "PARTNER_APP_INSTALLED", em: min(0) })).toEqual([]);
    expect(await entregarConta({ evento: "PARTNER_ADDED", em: min(1) }, min(2))).toEqual([]);
    expect(await entregarConta({ evento: "ACCOUNT_RESTRICTION", em: min(2) }, min(3))).toEqual([]);
    expect(await entregarConta({ evento: "DISABLED_UPDATE", em: min(3), banimento: "REINSTATE" }, min(4))).toEqual([]);
    expect(await reenviarAvisosPendentes(db, correio, min(5))).toEqual({ enviados: 0, falhou: 0, semEmail: 0, semCorreio: 0 });
    expect(correio.enviadas).toEqual([]);
    expect(mensagemDoEvento({ tipo: "PARTNER_ADDED", motivo: null, ocorridoEm: min(0), iniciadoPor: null })).toBeNull();
  });

  it("evento de outra organização (id forjado) não sai", async () => {
    const [a] = await entregarConta({ evento: "PARTNER_REMOVED", em: min(0) });
    const outra = await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba }, { manterOutras: true });
    expect(await enviarAvisosDaConta(db, [{ organizacaoId: outra, eventoId: a.eventoId }], correio, min(1))).toEqual({ enviados: 0, falhou: 0, semEmail: 0, semCorreio: 0 });
    expect(correio.enviadas).toEqual([]);
  });

  it("o e-mail não leva telefone, nome, trecho de conversa nem id da Meta", async () => {
    // O formato da página de coexistência traz o telefone da empresa no aviso: ele não entra no e-mail.
    const emails = await entregarConta({ evento: "PARTNER_REMOVED", em: min(0), wabaInfo: null, telefone: CANARIOS.waIdBr, motivo: "CHANGE_NUMBER" });
    await enviarAvisosDaConta(db, emails, correio, min(1));
    const texto = JSON.stringify(correio.enviadas);
    expect(correio.enviadas).toHaveLength(1);
    for (const v of [...Object.values(CANARIOS), ...Object.values(FICTICIOS)]) expect(texto, v).not.toContain(v);
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([]);
  });
});

describe("reenviarAvisosPendentes (M10.1a, rotina de hora em hora)", () => {
  it("manda o pendente com a mesma chave da primeira tentativa; o enviado não sai de novo", async () => {
    const [a] = await entregarConta({ evento: "PARTNER_REMOVED", em: min(0) });
    await enviarAvisosDaConta(db, [a], null, min(1));
    expect(await reenviarAvisosPendentes(db, correio, min(60))).toEqual({ enviados: 1, falhou: 0, semEmail: 0, semCorreio: 0 });
    expect(correio.enviadas.map((e) => e.chave)).toEqual([`whatsapp-conta:${a.eventoId}`]);
    expect(await reenviarAvisosPendentes(db, correio, min(120))).toEqual({ enviados: 0, falhou: 0, semEmail: 0, semCorreio: 0 });
    expect(correio.enviadas).toHaveLength(1);
  });

  it(`ignora o evento recebido há mais de ${REPETIR_EMAIL_DIAS} dias (fica só no Início e em Integrações)`, async () => {
    const [velho] = await entregarConta({ evento: "PARTNER_REMOVED", em: min(0) });
    const [novo] = await entregarConta({ evento: "ACCOUNT_OFFBOARDED", em: min(1) }, min(2));
    const agora = new Date(min(2).getTime() + REPETIR_EMAIL_DIAS * 86_400_000);
    await db.update(whatsappEventos).set({ recebidoEm: new Date(agora.getTime() - REPETIR_EMAIL_DIAS * 86_400_000 - 1000) }).where(eq(whatsappEventos.id, velho.eventoId));
    expect(await reenviarAvisosPendentes(db, correio, agora)).toEqual({ enviados: 1, falhou: 0, semEmail: 0, semCorreio: 0 });
    expect(correio.enviadas.map((e) => e.chave)).toEqual([`whatsapp-conta:${novo.eventoId}`]);
  });

  it("todas as organizações, cada uma no próprio e-mail", async () => {
    const outra = await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba, numeroId: FICTICIOS.outroNumero }, { manterOutras: true });
    await salvarEmpresa(db, outra, { ...(await lerEmpresa(db, outra)), email: "outra@example.com" }, null);
    // Cada aviso só com a WABA da própria organização (no formato padrão, o id do parceiro é a WABA da outra).
    await entregarConta({ evento: "PARTNER_REMOVED", em: min(0), wabaInfo: null });
    await entregarAviso(db, avisoDeConta({ evento: "ACCOUNT_DELETED", em: min(1), entrada: FICTICIOS.outraWaba, wabaInfo: null }), min(1));
    expect(await reenviarAvisosPendentes(db, correio, min(10))).toEqual({ enviados: 2, falhou: 0, semEmail: 0, semCorreio: 0 });
    expect(correio.enviadas.map((e) => e.para).sort()).toEqual([EMAIL_EMPRESA, "outra@example.com"]);
  });
});
