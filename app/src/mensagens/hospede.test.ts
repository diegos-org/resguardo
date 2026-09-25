import { eq as eq_ } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { salvarEmpresa } from "@/configuracoes/empresa";
import { atualizarModelo, garantirModelosIniciais, listarModelos } from "@/configuracoes/modelos";
import { imoveis, mensagensHospede, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { type Correio, CorreioMemoria, ErroEnvioIncerto } from "@/email/correio";
import { DETALHES_VAZIOS, salvarDetalhes } from "@/imoveis/detalhes";
import { cancelarReserva, confirmarReserva, criarReserva, sincronizarReserva } from "@/reservas/repositorio";
import type { DadosReserva } from "@/reservas/regras";
import { enviarMensagensHospede, lerConfigMensagens, MAX_TENTATIVAS, prazoDaMensagem, resumoMensagens, salvarConfigMensagens, ultimosEnvios } from "./hospede";

let db: Db;
let close: () => Promise<void>;
let org: string;
let imovel: string;
let correio: CorreioMemoria;
let modelo: Record<string, string>;

// Horários em São Paulo (UTC-3).
const sp = (data: string, hora: string) => new Date(`${data}T${hora}:00-03:00`);
const ligadoEm = sp("2026-09-01", "08:00");

const reserva = (over: Partial<typeof reservas.$inferInsert> = {}) => ({
  organizacaoId: org,
  imovelId: imovel,
  codigo: "SCL-0001",
  origem: "direta" as const,
  checkin: "2026-10-10",
  checkout: "2026-10-13",
  hospedes: 2,
  hospedeNome: "Ana Exemplo",
  hospedeEmail: "ana@example.com",
  confirmadaEm: sp("2026-09-20", "12:00"),
  ...over,
});

async function ligar(over: Partial<Parameters<typeof salvarConfigMensagens>[2]> = {}) {
  const r = await salvarConfigMensagens(db, org, { ativo: true, origens: ["site", "direta"], modelos: modelo, ...over }, null, ligadoEm);
  expect(r).toEqual({ ok: true });
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: imovel }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio Exemplo", endereco: "Rua Fictícia, 403" }).returning();
  await salvarDetalhes(db, org, imovel, { ...DETALHES_VAZIOS, complemento: "apto 101", checkinAPartirDe: "15:00", checkoutAte: "11:00" }, null);
  await garantirModelosIniciais(db, org);
  const ms = await listarModelos(db, org);
  const id = (nome: string) => ms.find((m) => m.nome === nome)!.id;
  modelo = { confirmacao: id("Confirmação da reserva"), checkin: id("Instruções de check-in"), checkout: id("Lembrete de check-out"), agradecimento: id("Agradecimento") };
  correio = new CorreioMemoria();
});
afterEach(() => close());

describe("prazos das mensagens (M9.2)", () => {
  const r = { checkin: "2026-10-10", checkout: "2026-10-13", confirmadaEm: sp("2026-09-20", "12:00"), fuso: "America/Sao_Paulo", entradaAPartirDe: "15:00", saidaAte: "11:00" };
  it("confirmação ao confirmar; check-in D-2 10h; check-out D-1 14h; agradecimento D+3 10h — no fuso do imóvel", () => {
    expect(prazoDaMensagem("confirmacao", r)).toEqual({ inicio: sp("2026-09-20", "12:00"), fim: sp("2026-10-10", "15:00"), referencia: "2026-10-10/2026-10-13" });
    expect(prazoDaMensagem("checkin", r)).toEqual({ inicio: sp("2026-10-08", "10:00"), fim: sp("2026-10-10", "15:00"), referencia: "2026-10-10" });
    expect(prazoDaMensagem("checkout", r)).toEqual({ inicio: sp("2026-10-12", "14:00"), fim: sp("2026-10-13", "11:00"), referencia: "2026-10-13" });
    expect(prazoDaMensagem("agradecimento", r)).toMatchObject({ inicio: sp("2026-10-16", "10:00"), referencia: "2026-10-13" });
    expect(prazoDaMensagem("confirmacao", { ...r, confirmadaEm: null })).toBeNull();
  });
});

describe("configuração (M9.2)", () => {
  it("começa desligada; ligar vale dali em diante; religar recomeça a contar", async () => {
    expect(await lerConfigMensagens(db, org)).toMatchObject({ ativo: false, salva: false, origens: ["site", "direta"] });
    await ligar();
    expect(await lerConfigMensagens(db, org)).toMatchObject({ ativo: true, ativoDesde: ligadoEm.toISOString() });
    // Salvar de novo ligado mantém a data; desligar e religar recomeça.
    await salvarConfigMensagens(db, org, { ativo: true, origens: ["direta"], modelos: modelo }, null, sp("2026-09-05", "08:00"));
    expect((await lerConfigMensagens(db, org)).ativoDesde).toBe(ligadoEm.toISOString());
    await salvarConfigMensagens(db, org, { ativo: false, origens: ["direta"], modelos: modelo }, null);
    await salvarConfigMensagens(db, org, { ativo: true, origens: ["direta"], modelos: modelo }, null, sp("2026-09-06", "08:00"));
    expect((await lerConfigMensagens(db, org)).ativoDesde).toBe(sp("2026-09-06", "08:00").toISOString());
  });

  it("recusa: confirmação com {endereco}, modelo arquivado, ligar sem modelo ou sem origem", async () => {
    expect(await salvarConfigMensagens(db, org, { ativo: false, origens: ["direta"], modelos: { confirmacao: modelo.checkin } }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("{endereco}") });
    await atualizarModelo(db, org, modelo.checkout, { ativo: false }, null);
    expect(await salvarConfigMensagens(db, org, { ativo: false, origens: ["direta"], modelos: { checkout: modelo.checkout } }, null)).toMatchObject({ ok: false });
    expect(await salvarConfigMensagens(db, org, { ativo: true, origens: ["direta"], modelos: {} }, null)).toMatchObject({ ok: false });
    expect(await salvarConfigMensagens(db, org, { ativo: true, origens: [], modelos: { confirmacao: modelo.confirmacao } }, null)).toMatchObject({ ok: false });
    expect(await salvarConfigMensagens(db, org, { ativo: false, origens: ["direta"], modelos: { confirmacao: "nao-e-id" } }, null)).toMatchObject({ ok: false });
  });
});

describe("envio (M9.2)", () => {
  it("desligado: nada sai", async () => {
    await db.insert(reservas).values(reserva());
    expect(await enviarMensagensHospede(db, org, correio, sp("2026-10-08", "10:30"))).toMatchObject({ desligado: true, enviadas: 0 });
    expect(correio.enviadas).toHaveLength(0);
  });

  it("confirmação e check-in no prazo, uma vez só; só origens escolhidas e reservas confirmadas", async () => {
    await ligar();
    await db.insert(reservas).values([
      reserva(),
      reserva({ codigo: "SCL-0002", origem: "airbnb", hospedeEmail: "airbnb@example.com" }),
      reserva({ codigo: "SCL-0003", estado: "cancelada", confirmadaEm: null, hospedeEmail: "cancelou@example.com" }),
      reserva({ codigo: "SCL-0004", estado: "pendente", confirmadaEm: null, hospedeEmail: "pendente@example.com" }),
    ]);
    const r1 = await enviarMensagensHospede(db, org, correio, sp("2026-09-20", "14:00"));
    expect(r1).toMatchObject({ enviadas: 1, falhas: 0 });
    expect(correio.enviadas[0]).toMatchObject({ para: "ana@example.com", assunto: "Confirmação da reserva — reserva SCL-0001" });
    expect(correio.enviadas[0].texto).toContain("Olá, Ana Exemplo! Sua reserva SCL-0001 no Studio Exemplo está confirmada: entrada em 10/10/2026 e saída em 13/10/2026 (3 noites).");
    expect(correio.enviadas[0].texto).not.toContain("Rua Fictícia");
    // Outra execução: não repete.
    await enviarMensagensHospede(db, org, correio, sp("2026-09-21", "10:00"));
    expect(correio.enviadas).toHaveLength(1);
    // Check-in: antes das 10h do D-2 não; às 10h sim, com endereço e complemento.
    await enviarMensagensHospede(db, org, correio, sp("2026-10-08", "09:59"));
    expect(correio.enviadas).toHaveLength(1);
    await enviarMensagensHospede(db, org, correio, sp("2026-10-08", "10:05"));
    expect(correio.enviadas).toHaveLength(2);
    expect(correio.enviadas[1].texto).toContain("Rua Fictícia, 403 — apto 101");
    // Check-out D-1 14h e agradecimento D+3 10h.
    await enviarMensagensHospede(db, org, correio, sp("2026-10-12", "14:00"));
    await enviarMensagensHospede(db, org, correio, sp("2026-10-16", "10:00"));
    expect(correio.enviadas.map((m) => m.assunto.split(" — ")[0])).toEqual(["Confirmação da reserva", "Instruções de check-in", "Lembrete de check-out", "Agradecimento"]);
    expect(correio.enviadas.every((m) => m.para === "ana@example.com")).toBe(true);
    expect((await ultimosEnvios(db, org, sp("2026-10-16", "10:00"))).map((e) => e.estado)).toEqual(["enviado", "enviado", "enviado", "enviado"]);
  });

  it("vale de quando foi ligado em diante; fora do prazo não manda atrasado", async () => {
    await db.insert(reservas).values([
      reserva({ confirmadaEm: sp("2026-08-20", "12:00") }),
      reserva({ codigo: "SCL-0002", hospedeEmail: "b@example.com", checkin: "2026-09-01", checkout: "2026-09-04", confirmadaEm: sp("2026-08-20", "12:00") }),
    ]);
    await ligar();
    // Confirmação de antes de ligar: não sai. Check-in previsto (30/08) antes de ligar: não sai.
    await enviarMensagensHospede(db, org, correio, sp("2026-09-01", "10:00"));
    expect(correio.enviadas).toHaveLength(0);
    // Check-out da SCL-0002 (03/09 14h) é depois de ligar: sai.
    await enviarMensagensHospede(db, org, correio, sp("2026-09-03", "14:00"));
    expect(correio.enviadas.map((m) => m.assunto)).toEqual(["Lembrete de check-out — reserva SCL-0002"]);
    // Depois do horário de saída, o lembrete não sai mais (reserva nova vista tarde).
    await db.insert(reservas).values(reserva({ codigo: "SCL-0003", hospedeEmail: "c@example.com", checkin: "2026-09-10", checkout: "2026-09-12", confirmadaEm: null }));
    await enviarMensagensHospede(db, org, correio, sp("2026-09-12", "11:00"));
    expect(correio.enviadas).toHaveLength(1);
  });

  it("reserva feita em cima da hora: confirmação e check-in saem logo, antes da entrada", async () => {
    await ligar();
    await db.insert(reservas).values(reserva({ checkin: "2026-10-09", checkout: "2026-10-11", confirmadaEm: sp("2026-10-08", "13:00") }));
    await enviarMensagensHospede(db, org, correio, sp("2026-10-08", "14:00"));
    expect(correio.enviadas.map((m) => m.assunto.split(" — ")[0])).toEqual(["Confirmação da reserva", "Instruções de check-in"]);
  });

  it("falta dado: não manda e avisa (sem e-mail, sem nome); modelo arquivado também", async () => {
    await ligar();
    await db.insert(reservas).values([reserva({ hospedeEmail: "" }), reserva({ codigo: "SCL-0002", hospedeNome: " ", hospedeEmail: "b@example.com" })]);
    const r = await enviarMensagensHospede(db, org, correio, sp("2026-09-20", "14:00"));
    expect(r.enviadas).toBe(0);
    expect(r.avisos).toEqual(["SCL-0001 (confirmação da reserva): reserva sem e-mail do hóspede", "SCL-0002 (confirmação da reserva): falta {hospede} no cadastro"]);
    expect(resumoMensagens(r)).toContain("2 não enviada(s)");
    expect(await db.select().from(mensagensHospede)).toHaveLength(0);
    await atualizarModelo(db, org, modelo.confirmacao, { ativo: false }, null);
    const r2 = await enviarMensagensHospede(db, org, correio, sp("2026-09-20", "14:00"));
    expect(r2.avisos[0]).toContain("arquivado");
  });

  it("modelo editado para usar {endereco} na confirmação: não manda antes da liberação", async () => {
    await ligar();
    await atualizarModelo(db, org, modelo.confirmacao, { dados: { nome: "Confirmação da reserva", quando: "", texto: "Olá, {hospede}! Endereço: {endereco}." } }, null);
    await db.insert(reservas).values(reserva());
    const r = await enviarMensagensHospede(db, org, correio, sp("2026-09-20", "14:00"));
    expect(r.avisos[0]).toContain("{endereco}");
    expect(correio.enviadas).toHaveLength(0);
  });

  it("recusa do provedor: tenta de novo até 3 vezes; sem resposta: fica incerto e não repete", async () => {
    await ligar();
    await db.insert(reservas).values([reserva(), reserva({ codigo: "SCL-0002", hospedeEmail: "b@example.com" })]);
    let chamadas = 0;
    const recusa: Correio = { nome: "recusa", enviar: async (m) => { chamadas++; if (m.para === "b@example.com") throw new ErroEnvioIncerto("sem resposta"); throw new Error("recusado"); } };
    for (let i = 0; i < MAX_TENTATIVAS + 2; i++) await enviarMensagensHospede(db, org, recusa, sp("2026-09-20", `1${i}:00`));
    // Ana: 3 tentativas; b@: 1 (incerta, não repete).
    expect(chamadas).toBe(MAX_TENTATIVAS + 1);
    const envios = await ultimosEnvios(db, org, sp("2026-09-21", "10:00"));
    expect(envios.map((e) => [e.codigo, e.estado, e.tentativas]).sort()).toEqual([["SCL-0001", "falhou", 3], ["SCL-0002", "incerto", 1]]);
    // Um pedido que ficou "enviando" há muito tempo aparece como incerto.
    await db.update(mensagensHospede).set({ estado: "enviando" }).where(eq_(mensagensHospede.estado, "incerto"));
    expect((await ultimosEnvios(db, org, new Date(Date.now() + 3_600_000))).find((e) => e.codigo === "SCL-0002")?.estado).toBe("incerto");
  });

  it("sem provedor de e-mail com o envio ligado: avisa", async () => {
    await ligar();
    await db.insert(reservas).values(reserva());
    expect(await enviarMensagensHospede(db, org, null, sp("2026-09-20", "14:00"))).toMatchObject({ semProvedor: true });
  });

  it("mudou a data: a mensagem da nova data sai (a antiga já foi)", async () => {
    await ligar();
    const [r] = await db.insert(reservas).values(reserva()).returning();
    await enviarMensagensHospede(db, org, correio, sp("2026-09-20", "14:00"));
    await db.update(reservas).set({ checkin: "2026-10-11", checkout: "2026-10-14" }).where(eq_(reservas.id, r.id));
    await enviarMensagensHospede(db, org, correio, sp("2026-09-22", "10:00"));
    expect(correio.enviadas.map((m) => m.texto.match(/entrada em (\S+)/)?.[1])).toEqual(["10/10/2026", "11/10/2026"]);
  });

  it("contato da empresa no {empresa} vem do cadastro", async () => {
    await salvarEmpresa(db, org, { nome: "Empresa Fictícia", razaoSocial: "", cnpj: "", email: "", telefone: "", endereco: "", site: "", chavePix: "" }, null);
    await ligar();
    await db.insert(reservas).values(reserva());
    await enviarMensagensHospede(db, org, correio, sp("2026-09-20", "14:00"));
    expect(correio.enviadas[0].texto).toContain("Empresa Fictícia");
  });
});

describe("quando a reserva foi confirmada (M9.2)", () => {
  const dados = (over: Partial<DadosReserva> = {}): DadosReserva => ({
    imovelId: imovel,
    origem: "direta",
    estado: "confirmada",
    checkin: "2026-10-10",
    checkout: "2026-10-13",
    hospedes: 2,
    hospedeNome: "Ana",
    hospedeEmail: "ana@example.com",
    hospedeTelefone: "",
    hospedeOrigem: "",
    moeda: "BRL",
    valorBruto: null,
    taxaCanal: null,
    valorLiquido: null,
    codigoCanal: "",
    observacoes: "",
    ...over,
  });
  it("criada confirmada, confirmada depois, cancelada e sincronizada", async () => {
    const a = await criarReserva(db, org, dados(), null);
    expect(a.ok && a.reserva.confirmadaEm).toBeInstanceOf(Date);
    const b = await criarReserva(db, org, dados({ estado: "pendente" }), null);
    const idB = b.ok ? b.reserva.id : "";
    expect(b.ok && b.reserva.confirmadaEm).toBeNull();
    await confirmarReserva(db, org, idB, null);
    const [rb] = await db.select().from(reservas).where(eq_(reservas.id, idB));
    expect(rb.confirmadaEm).toBeInstanceOf(Date);
    await cancelarReserva(db, org, idB, null);
    const [rc] = await db.select().from(reservas).where(eq_(reservas.id, idB));
    expect(rc.confirmadaEm).toBeNull();

    const s1 = await sincronizarReserva(db, org, "csv", "1", dados({ estado: "pendente" }));
    expect(s1.ok && s1.reserva.confirmadaEm).toBeNull();
    const s2 = await sincronizarReserva(db, org, "csv", "1", dados());
    const quando = s2.ok ? s2.reserva.confirmadaEm : null;
    expect(quando).toBeInstanceOf(Date);
    // Continua confirmada (outra mudança): mantém a data.
    const s3 = await sincronizarReserva(db, org, "csv", "1", dados({ hospedes: 3 }));
    expect(s3.ok && s3.reserva.confirmadaEm).toEqual(quando);
  });
});

