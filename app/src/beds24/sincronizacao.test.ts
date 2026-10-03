import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { historicoDe } from "@/auditoria/auditoria";
import { gravarConfig } from "@/configuracoes/armazem";
import { criarContrato } from "@/contratos/repositorio";
import { auditoria, beds24Calendario, beds24Envios, beds24Execucoes, beds24ExecucaoReservas, bloqueios, idsExternos, imoveis, organizacoes, proprietarioImoveis, proprietarios, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { listarLancamentos, mudarEstado } from "@/financeiro/ledger";
import { salvarEmailHospede, sincronizarReserva } from "@/reservas/repositorio";
import { lerConfigBeds24, organizacaoBeds24 } from "./configuracao";
import { paraDadosReserva } from "./converter";
import { Beds24Falso } from "./falso";
import { normalizarReserva } from "./normalizar";
import { sincronizarBeds24, ultimasSincronizacoes } from "./sincronizacao";

let db: Db, close: () => Promise<void>, org: string, im: string, leitor: Beds24Falso;
const agora = new Date("2026-09-28T12:00:00Z");
const booking = (over: Record<string, unknown> = {}) => ({ id: 123, propertyId: 10, roomId: 20, status: "confirmed", arrival: "2030-10-10", departure: "2030-10-13", price: 1500, commission: 225, numAdult: 2, firstName: "Pessoa Fictícia", email: "fake@example.com", channel: "Airbnb", apiReference: "HMFAKE", ...over });
const rodar = () => sincronizarBeds24(db, org, leitor, { agora });
const linhas = () => db.select().from(reservas).where(eq(reservas.organizacaoId, org));
const calendario = () => db.select().from(beds24Calendario).where(eq(beds24Calendario.organizacaoId, org));
const listaBloqueios = () => db.select().from(bloqueios).where(eq(bloqueios.organizacaoId, org));
const csv = (over: Record<string, unknown> = {}) => {
  const n = normalizarReserva(booking(over));
  if (!n.ok) throw new Error("fixture inválida");
  return sincronizarReserva(db, org, "csv", "airbnb:HMFAKE", { ...paraDadosReserva(n.r, im)!, observacoes: "Conferido no painel", valorLiquido: 127500 });
};

beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(async () => { await close(); });
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Organização de teste" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "T1", nome: "Imóvel fictício" }).returning();
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
  await db.transaction(tx => gravarConfig(tx, org, "beds24", { automatica: false, desde: "2026-09-01", diasCalendario: 2 }, null));
  leitor = new Beds24Falso(() => agora);
  leitor.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Quarto fictício" }] }];
  leitor.bookings = [booking()];
  leitor.calendarios = [{ roomId: 20, calendar: [{ from: "2026-09-28", to: "2026-09-29", numAvail: 1, price1: 100, minStay: 2 }] }];
});

describe("Beds24 → banco (M3.3)", () => {
  it("não importa enquanto um envio de calendário está entre a escrita e o registro; envio interrompido há mais de 10 minutos não impede", async () => {
    const [envio] = await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: new Date(agora.getTime() - 60_000), modo: "envio", situacao: "executando" }).returning({ id: beds24Envios.id });
    expect(await rodar()).toMatchObject({ ok: false, situacao: "ocupada", mensagem: expect.stringContaining("envio de calendário") });
    expect(await linhas()).toHaveLength(0);
    await db.update(beds24Envios).set({ iniciadoEm: new Date(agora.getTime() - 11 * 60_000) }).where(eq(beds24Envios.id, envio.id));
    expect(await rodar()).toMatchObject({ ok: true, criadas: 1 });
  });

  it("importa, repete sem duplicar ou alterar a reserva e lê preço/mínimo em centavos", async () => {
    expect(await rodar()).toMatchObject({ ok: true, criadas: 1, diasCalendario: 2 });
    expect((await calendario()).map(c => c.roomId)).toEqual(["20", "20"]);
    const [r] = await linhas();
    expect(r).toMatchObject({ beds24Id: "123", valorBruto: 150000, confirmadaEm: null });
    const h = await historicoDe(db, org, "reserva", r.id);
    expect(await rodar()).toMatchObject({ ok: true, criadas: 0, atualizadas: 0, iguais: 1 });
    expect(await linhas()).toHaveLength(1);
    expect(await historicoDe(db, org, "reserva", r.id)).toHaveLength(h.length);
    expect(await calendario()).toHaveLength(2);
    expect((await calendario())[0]).toMatchObject({ preco: 10000, minimoNoites: 2, livres: 1 });
    expect(JSON.stringify(await ultimasSincronizacoes(db, org))).not.toMatch(/Pessoa Fictícia|fake@example/);
  });

  it("reaproveita a reserva CSV e preserva código, anotações, contato manual e histórico", async () => {
    const c = await csv();
    if (!c.ok) throw new Error("fixture");
    await salvarEmailHospede(db, org, c.reserva.id, "conferido@example.com", null);
    expect(await rodar()).toMatchObject({ criadas: 0, atualizadas: 1 });
    const [r] = await linhas();
    expect(r).toMatchObject({ id: c.reserva.id, codigo: c.reserva.codigo, fonte: "csv", idFonte: "airbnb:HMFAKE", beds24Id: "123", hospedeEmail: "conferido@example.com", observacoes: "Conferido no painel", valorLiquido: 127500 });
    leitor.bookings = [booking({ price: 1700, departure: "2030-10-14" })];
    await rodar();
    expect((await linhas())[0]).toMatchObject({ id: r.id, valorBruto: 170000, valorLiquido: null, checkout: "2030-10-14" });
    expect(await csv()).toMatchObject({ ok: false, erros: { geral: expect.stringContaining("já é atualizada") } });
    expect(await linhas()).toHaveLength(1);
  });

  it("CSV posterior ao Beds24 não cria cópia nem substitui dados", async () => {
    await rodar();
    expect(await csv()).toMatchObject({ ok: false });
    expect(await linhas()).toHaveLength(1);
  });

  it("não adivinha vínculo por código quando a planilha aponta outro imóvel", async () => {
    await csv();
    const [{ id: outro }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "T2", nome: "Outro" }).returning();
    await db.update(idsExternos).set({ imovelId: outro }).where(eq(idsExternos.organizacaoId, org));
    const r = await rodar();
    expect(r).toMatchObject({ situacao: "parcial", criadas: 0 });
    expect(r.divergencias.join()).toContain("outro imóvel");
    expect((await linhas())[0]).toMatchObject({ imovelId: im, beds24Id: null });
  });

  it("mesmo código de canal em dois IDs Beds24 não duplica", async () => {
    leitor.bookings.push(booking({ id: 124 }));
    const r = await rodar();
    expect(r).toMatchObject({ situacao: "parcial", criadas: 1 });
    expect(r.divergencias.join()).toContain("Dois IDs");
    expect(await linhas()).toHaveLength(1);
  });

  it("reconsulta reserva fora do período e só cancela com estado explícito", async () => {
    await rodar();
    leitor.bookings = [];
    expect((await rodar()).divergencias.join()).toContain("preservado");
    expect((await linhas())[0].estado).toBe("confirmada");
    leitor.bookings = [booking({ arrival: "2025-01-01", departure: "2025-01-03", status: "cancelled" })];
    expect(await rodar()).toMatchObject({ atualizadas: 1 });
    expect((await linhas())[0]).toMatchObject({ estado: "cancelada", checkin: "2025-01-01" });
  });

  it("mantém bloco ausente e remove somente o cancelado, sem reserva fictícia", async () => {
    leitor.bookings = [booking({ status: "black" })];
    expect(await rodar()).toMatchObject({ bloqueios: 1, criadas: 0 });
    await rodar();
    expect(await listaBloqueios()).toHaveLength(1);
    leitor.bookings = [];
    await rodar();
    expect(await listaBloqueios()).toHaveLength(1);
    leitor.bookings = [booking({ status: "cancelled" })];
    await rodar();
    expect(await listaBloqueios()).toHaveLength(0);
    expect(await linhas()).toHaveLength(0);
    // A remoção fica no histórico (a agenda consulta o período para não dar o imóvel como livre), sem dados de hóspede.
    const remocoes = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, "bloqueio.remover")));
    expect(remocoes).toHaveLength(1);
    expect(remocoes[0].mudancas).toEqual({ bloqueio: ["2030-10-10 a 2030-10-13 (Bloqueio importado do Beds24)", null] });
  });

  it("converte reserva em bloqueio e de volta mantendo a identidade", async () => {
    await rodar();
    const [r] = await linhas();
    leitor.bookings = [booking({ status: "black" })];
    await rodar();
    expect((await linhas())[0].estado).toBe("cancelada");
    expect(await listaBloqueios()).toHaveLength(1);
    leitor.bookings = [booking()];
    await rodar();
    expect(await listaBloqueios()).toHaveLength(0);
    expect((await linhas())[0]).toMatchObject({ id: r.id, estado: "confirmada", confirmadaEm: null });
  });

  it("falha de leitura desfaz execução; erro desconhecido não vaza conteúdo", async () => {
    leitor.calendario = async () => { throw new Error("TOKEN/PII SECRETO"); };
    const r = await rodar();
    expect(r.ok).toBe(false);
    expect(await linhas()).toHaveLength(0);
    expect(await calendario()).toHaveLength(0);
    expect(JSON.stringify(await ultimasSincronizacoes(db, org))).not.toContain("SECRETO");
  });

  it("erro depois de gravar reserva reverte também reserva, financeiro e auditoria", async () => {
    leitor.calendarios.push(...leitor.calendarios);
    expect(await rodar()).toMatchObject({ ok: false, mensagem: expect.stringContaining("repetidas") });
    expect(await linhas()).toHaveLength(0);
    expect(await listarLancamentos(db, org, {})).toHaveLength(0);
    expect((await ultimasSincronizacoes(db, org))[0].situacao).toBe("erro");
  });

  it("quarto sem vínculo não vira reserva e mensagem de formato não revela payload", async () => {
    leitor.bookings = [booking({ roomId: 999 }), booking({ id: 124, status: "email-segredo@example.com" })];
    const r = await rodar();
    expect(r).toMatchObject({ situacao: "parcial", criadas: 0 });
    expect(r.divergencias.join()).toContain("sem vínculo");
    expect(JSON.stringify(r)).not.toContain("email-segredo");
  });

  it.each([undefined, "USD"])("recusa moeda %s, sem assumir BRL", async moeda => {
    leitor.properties[0].currency = moeda;
    expect(await rodar()).toMatchObject({ ok: false, mensagem: expect.stringContaining("BRL") });
    expect(await linhas()).toHaveLength(0);
  });

  it("vínculo sem roomId impede importar; não usa fallback de propertyId", async () => {
    await db.update(idsExternos).set({ detalhe: "" }).where(eq(idsExternos.organizacaoId, org));
    expect(await rodar()).toMatchObject({ ok: false, mensagem: expect.stringContaining("roomId") });
    expect(leitor.chamadas).toBe(0);
  });

  it("dia omitido fica desconhecido e numAvail zero não cria bloqueio artificial", async () => {
    leitor.bookings = [];
    await rodar();
    leitor.calendarios = [{ roomId: 20, calendar: [{ from: "2026-09-28", numAvail: 0 }] }];
    const r = await rodar();
    expect(r).toMatchObject({ situacao: "parcial", diasCalendario: 1 });
    expect(await calendario()).toHaveLength(1);
    expect((await calendario())[0]).toMatchObject({ livres: 0, preco: null, minimoNoites: null });
    expect(await listaBloqueios()).toHaveLength(0);
  });

  it("dinheiro realizado permanece intacto e a divergência aparece", async () => {
    const [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dono fictício" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im });
    await criarContrato(db, org, im, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await rodar();
    const [r] = await linhas();
    const ls = await listarLancamentos(db, org, { reservaId: r.id });
    expect(ls.length).toBeGreaterThan(0);
    await mudarEstado(db, org, ls[0].id, "realizado", null);
    const antes = await listarLancamentos(db, org, { reservaId: r.id });
    leitor.bookings = [booking({ price: 2000 })];
    expect((await rodar()).divergencias.join()).toContain("dinheiro movimentado");
    expect(await listarLancamentos(db, org, { reservaId: r.id })).toEqual(antes);
    expect((await linhas())[0].divergenciaEm).not.toBeNull();
  });

  it("desligada não chama API; configuração e histórico isolados por organização", async () => {
    expect(await sincronizarBeds24(db, org, leitor, { automatica: true })).toMatchObject({ situacao: "desligada" });
    expect(leitor.chamadas).toBe(0);
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra organização" }).returning();
    await rodar();
    expect(await ultimasSincronizacoes(db, outra)).toEqual([]);
    expect(await lerConfigBeds24(db, outra)).toMatchObject({ automatica: false });
    expect(await organizacaoBeds24(db, { NODE_ENV: "test", BEDS24_ORGANIZACAO_ID: org })).toBe(org);
    await expect(organizacaoBeds24(db, { NODE_ENV: "test" })).rejects.toThrow("mais de uma organização");
    expect(await db.select().from(beds24Execucoes).where(and(eq(beds24Execucoes.organizacaoId, outra)))).toHaveLength(0);
  });

  it("alteração de reserva já iniciada preserva o livro anterior e avisa", async () => {
    await csv({ arrival: "2025-01-01", departure: "2025-01-03" });
    const [r] = await linhas();
    const antes = await listarLancamentos(db, org, { reservaId: r.id });
    await db.transaction(tx => gravarConfig(tx, org, "beds24", { desde: "2025-01-01", diasCalendario: 2 }, null));
    leitor.bookings = [booking({ arrival: "2025-01-01", departure: "2025-01-03", price: 2000 })];
    expect((await rodar()).divergencias.join()).toContain("já iniciada");
    expect(await listarLancamentos(db, org, { reservaId: r.id })).toEqual(antes);
  });

  it("reserva que omite dados mantém os valores e contato anteriores", async () => {
    await rodar();
    leitor.bookings = [booking({ price: null, commission: null, email: "", firstName: "", apiReference: "" })];
    await rodar();
    expect((await linhas())[0]).toMatchObject({ valorBruto: 150000, taxaCanal: 22500, hospedeEmail: "fake@example.com", codigoCanal: "HMFAKE" });
  });

  it("ID repetido na resposta é recusado antes de qualquer gravação", async () => {
    leitor.bookings.push(booking({ price: 2000 }));
    expect(await rodar()).toMatchObject({ ok: false, mensagem: expect.stringContaining("repetidos") });
    expect(await linhas()).toHaveLength(0);
  });
});

it("releitura corrige consulta legada, preserva identidade/data original e registra mudanças uma vez", async () => {
  const legado = await csv({ status: "request" });
  if (!legado.ok) throw new Error("fixture");
  await db.update(reservas).set({ estado: "pendente" }).where(eq(reservas.id, legado.reserva.id));
  leitor.bookings = [booking({ status: "inquiry", bookingTime: "2026-08-10T10:00:00Z" })];
  expect(await rodar()).toMatchObject({ criadas: 0, atualizadas: 1 });
  const [r] = await linhas();
  expect(r).toMatchObject({ id: legado.reserva.id, codigo: legado.reserva.codigo, estado: "consulta", reservadaEm: new Date("2026-08-10T10:00:00Z") });
  expect(await listarLancamentos(db, org, { reservaId: r.id })).toEqual([]);
  const eventos = () => db.select().from(beds24ExecucaoReservas).where(eq(beds24ExecucaoReservas.organizacaoId, org));
  expect(await eventos()).toHaveLength(1);
  expect(await rodar()).toMatchObject({ iguais: 1, atualizadas: 0 });
  expect(await eventos()).toHaveLength(1);
  leitor.bookings = [booking({ status: "inquiry" })];
  expect(await rodar()).toMatchObject({ iguais: 1 });
  expect((await linhas())[0].reservadaEm).toEqual(r.reservadaEm);
  leitor.bookings = [booking({ status: "confirmed" })];
  expect(await rodar()).toMatchObject({ atualizadas: 1 });
  expect((await linhas())[0]).toMatchObject({ estado: "confirmada", confirmadaEm: null });
  leitor.bookings = [booking({ status: "cancelled" })];
  await rodar();
  expect((await eventos()).map(e => e.tipo).sort()).toEqual(["alterada", "alterada", "cancelada"]);
});

it("eventos de uma execução que falha são desfeitos junto com as reservas", async () => {
  leitor.bookings = [booking({ status: "inquiry" })];
  leitor.calendarios = [{ roomId: 20, calendar: [
    { from: "2026-09-28", to: "2026-09-29", numAvail: 1 },
    { from: "2026-09-28", numAvail: 1 },
  ] }];
  expect(await rodar()).toMatchObject({ situacao: "erro" });
  expect(await linhas()).toHaveLength(0);
  expect(await db.select().from(beds24ExecucaoReservas).where(eq(beds24ExecucaoReservas.organizacaoId, org))).toHaveLength(0);
});

it("atualizar dados de uma reserva já cancelada registra alteração, sem novo cancelamento", async () => {
  const eventos = () => db.select().from(beds24ExecucaoReservas).where(eq(beds24ExecucaoReservas.organizacaoId, org));
  leitor.bookings = [booking({ status: "cancelled" })];
  expect(await rodar()).toMatchObject({ criadas: 1 });
  const [antes] = await linhas();
  expect((await eventos()).map(e => e.tipo)).toEqual(["adicionada"]);
  leitor.bookings = [booking({ status: "cancelled", bookingTime: "2026-08-10T10:00:00Z", firstName: "Nome atualizado fictício" })];
  expect(await rodar()).toMatchObject({ atualizadas: 1 });
  expect((await linhas())[0]).toMatchObject({ estado: "cancelada", canceladaEm: antes.canceladaEm, reservadaEm: new Date("2026-08-10T10:00:00Z") });
  expect((await eventos()).map(e => e.tipo).sort()).toEqual(["adicionada", "alterada"]);
  expect(await rodar()).toMatchObject({ iguais: 1 });
  expect(await eventos()).toHaveLength(2);
});

it("vincular uma reserva CSV já cancelada ao Beds24 conta como alteração", async () => {
  const legado = await csv({ status: "cancelled" });
  if (!legado.ok) throw new Error("fixture");
  leitor.bookings = [booking({ status: "cancelled" })];
  expect(await rodar()).toMatchObject({ atualizadas: 1, criadas: 0 });
  expect((await linhas())[0]).toMatchObject({ id: legado.reserva.id, estado: "cancelada", beds24Id: "123" });
  const eventos = await db.select().from(beds24ExecucaoReservas).where(eq(beds24ExecucaoReservas.organizacaoId, org));
  expect(eventos.map(e => e.tipo)).toEqual(["alterada"]);
});
