import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { auditoria, bloqueios, configuracoes, imoveis, imoveisDetalhes, limpezas, organizacoes, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { alterarHorario, horarioEfetivo, lerHorariosReservas } from "@/reservas/horarios";
import type { DadosReserva } from "@/reservas/regras";
import { sincronizarReserva } from "@/reservas/repositorio";
import { CorreioMemoria } from "@/email/correio";
import { enviarAgenda, montarAgenda, salvarConfigAgenda, textoDaAgenda } from "./agenda";

let db: Db;
let close: () => Promise<void>;
let org: string;
let rio: string;
let bz: string;
let sessao: Sessao;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Teste" }).returning();
  const [u] = await db.insert(usuarios).values({ organizacaoId: org, email: "operacao@example.com", nome: "Equipe Fictícia", papel: "operacao" }).returning();
  sessao = { organizacaoId: org, usuarioId: u.id, papel: "operacao", imovelIds: [] };
  [{ id: rio }, { id: bz }] = await db.insert(imoveis).values([
    { organizacaoId: org, codigo: "103", nome: "Rio", cidade: "Rio de Janeiro" },
    { organizacaoId: org, codigo: "BZ", nome: "Casa", cidade: "Armação dos Búzios" },
  ]).returning();
});
afterEach(() => close());
async function reserva(imovelId = rio, checkin = "2026-10-02", checkout = "2026-10-04", nome = "Ana Fictícia") {
  const [r] = await db.insert(reservas).values({ organizacaoId: org, imovelId, codigo: randomUUID(), origem: "airbnb", checkin, checkout,
    hospedeNome: nome, hospedes: 3, hospedeTelefone: "+55 00 00000-0000" }).returning();
  return r;
}
const texto = async (hoje = "2026-10-01", cidades: string[] = []) => textoDaAgenda(await montarAgenda(db, org, hoje, null), cidades);
async function pedido(id: string, tipo = "entrada", versao = 0) {
  return alterarHorario(db, sessao, { reservaId: id, tipo, versao, acao: "pedir", hora: "13:30", canal: "Airbnb", referencia: "Mensagem fictícia de 01/10 às 09h: pedido de antecipação." });
}
async function confirmar(id: string, tipo = "entrada", versao = 1) {
  return alterarHorario(db, sessao, { reservaId: id, tipo, versao, acao: "confirmar", aceiteExplicito: true, canal: "WhatsApp", referencia: "Mensagem fictícia de 01/10 às 10h: ambas as partes aceitaram." });
}

it("Búzios cobre D+1 até D+30 inclusive, mais de cinco reservas e estadias em andamento; Rio só cinco dias", async () => {
  await reserva(bz, "2026-09-20", "2026-10-02", "EmAndamento");
  for (let n = 3; n <= 8; n++) await reserva(bz, `2026-10-0${n}`, `2026-10-0${n + 1}`, `Hospede${n}`);
  await reserva(bz, "2026-10-31", "2026-11-02", "UltimoDia");
  await reserva(bz, "2026-11-01", "2026-11-03", "ForaDepois");
  await reserva(bz, "2026-09-20", "2026-10-01", "ForaAntes");
  await reserva(rio, "2026-10-07", "2026-10-09", "RioFora");
  const a = await montarAgenda(db, org, "2026-10-01", null);
  expect(a.secoes.find((s) => s.cidade.includes("Búzios"))?.reservas).toHaveLength(8);
  const t = textoDaAgenda(a, ["Armação dos Búzios"]);
  expect(t).toContain("próximos 30 dias");
  expect(t).not.toContain("próximos 5 dias");
  for (const nome of ["EmAndamento", "Hospede8", "UltimoDia"]) expect(t).toContain(nome);
  for (const nome of ["ForaDepois", "ForaAntes", "RioFora"]) expect(textoDaAgenda(a)).not.toContain(nome);
});

it("janela cruza ano e inclui estadia que atravessa a janela inteira", async () => {
  await reserva(bz, "2026-12-01", "2027-03-01", "Longa");
  await reserva(bz, "2027-01-29", "2027-01-30", "Limite");
  await reserva(bz, "2027-01-30", "2027-02-01", "Fora");
  const t = await texto("2026-12-30", ["Armação dos Búzios"]);
  expect(t).toContain("29/01 (próximos 30 dias)");
  expect(t).toContain("Longa");
  expect(t).toContain("Limite");
  expect(t).not.toContain("Fora");
});

it("realizada não vira tarefa, entrada não cria limpeza e evidência sem uso posterior orienta só chaves", async () => {
  await db.insert(limpezas).values({ organizacaoId: org, imovelId: rio, data: "2026-09-30", estado: "realizada", realizadaEm: new Date("2026-09-30T16:00:00Z") });
  await reserva(rio, "2026-10-02", "2026-10-10");
  const t = await texto();
  expect(t).toContain("🧹 Sex 02/10: nenhuma limpeza");
  expect(t).toContain("sem uso posterior registrado — conferir chaves");
  expect(t).toContain("Entrada/chaves 103: Ana, 3 hóspedes");
  expect(t).toContain("telefone: +55 00 00000-0000");
  expect(t).not.toContain("Fictícia");
  expect(await db.select().from(limpezas)).toHaveLength(1);
});

it("uso posterior ou bloqueio impedem afirmar preparação confirmada", async () => {
  await db.insert(limpezas).values({ organizacaoId: org, imovelId: rio, data: "2026-09-28", estado: "realizada", realizadaEm: new Date("2026-09-28T16:00:00Z") });
  await reserva(rio, "2026-09-29", "2026-10-01", "Anterior");
  await reserva();
  expect(await texto()).toContain("preparação sem confirmação suficiente");
  await db.delete(reservas).where(eq(reservas.hospedeNome, "Anterior"));
  await db.insert(bloqueios).values({ organizacaoId: org, imovelId: rio, inicio: "2026-09-29", fim: "2026-10-01", motivo: "uso próprio" });
  expect(await texto()).toContain("preparação sem confirmação suficiente");
});

it("pedido não altera padrão do imóvel; aceite explícito muda só o tipo confirmado e limite da troca", async () => {
  await reserva(rio, "2026-09-28", "2026-10-02", "Saindo");
  const r = await reserva();
  await db.insert(imoveisDetalhes).values({ organizacaoId: org, imovelId: rio, checkinAPartirDe: "16:00", checkoutAte: "10:00" });
  expect(await pedido(r.id)).toEqual({ ok: true });
  expect(await texto()).toContain("16:00 (padrão)");
  expect(await texto()).not.toContain("13:30");
  expect(await alterarHorario(db, sessao, { reservaId: r.id, tipo: "entrada", acao: "confirmar", versao: 1, referencia: "Só pedido" })).toMatchObject({ ok: false });
  expect(await confirmar(r.id)).toEqual({ ok: true });
  const t = await texto();
  expect(t).toContain("pronto até 13:30 (confirmado com hóspede)");
  expect(t).toContain("saída dom 04/10 às 10:00 (padrão)");
  expect(t).not.toContain("ambas as partes"); // evidência fica na ficha restrita, fora do e-mail
});

it("mudança de datas invalida acordo e impede aceitar pedido antigo; concorrência não sobrescreve", async () => {
  const r = await reserva();
  await pedido(r.id);
  expect(await pedido(r.id)).toMatchObject({ ok: false });
  await confirmar(r.id);
  await pedido(r.id, "saida", 2);
  await db.update(reservas).set({ checkout: "2026-10-05" }).where(eq(reservas.id, r.id));
  expect(await confirmar(r.id, "saida", 3)).toMatchObject({ ok: false });
  expect(await texto()).toContain("acordo anterior precisa reconfirmação");
  expect(await texto()).not.toContain("13:30 (confirmado");
});

it("novo pedido não apaga acordo; descartar preserva acordo, revogar volta ao padrão", async () => {
  const r = await reserva();
  await pedido(r.id); await confirmar(r.id); await pedido(r.id, "entrada", 2);
  expect(await texto()).toContain("13:30 (confirmado com hóspede)");
  expect(await alterarHorario(db, sessao, { reservaId: r.id, tipo: "entrada", acao: "descartar", versao: 3 })).toEqual({ ok: true });
  expect(await texto()).toContain("13:30 (confirmado com hóspede)");
  expect(await alterarHorario(db, sessao, { reservaId: r.id, tipo: "entrada", acao: "revogar", versao: 4 })).toEqual({ ok: true });
  expect(await texto()).not.toContain("13:30 (confirmado");
});

it("recusa outra organização, papel sem edição, hora inválida e confirmação sem evidência", async () => {
  const r = await reserva();
  const [outra] = await db.insert(organizacoes).values({ nome: "Outra" }).returning();
  expect(await alterarHorario(db, { ...sessao, organizacaoId: outra.id }, { reservaId: r.id, tipo: "entrada", acao: "pedir", versao: 0 })).toMatchObject({ ok: false });
  await expect(alterarHorario(db, { ...sessao, papel: "limpeza" }, { reservaId: r.id, tipo: "entrada", acao: "pedir", versao: 0 })).rejects.toThrow();
  expect(await alterarHorario(db, sessao, { reservaId: r.id, tipo: "entrada", acao: "pedir", versao: 0, hora: "25:00", canal: "WhatsApp", referencia: "Teste" })).toMatchObject({ ok: false });
  await pedido(r.id);
  expect(await alterarHorario(db, sessao, { reservaId: r.id, tipo: "entrada", acao: "confirmar", versao: 1, aceiteExplicito: true })).toMatchObject({ ok: false });
  expect((await lerHorariosReservas(db, outra.id, [r.id])).size).toBe(0);
});

it("telefone ausente/inválido não é inventado; logs e outra cidade não recebem contato", async () => {
  const r = await reserva();
  await pedido(r.id); await confirmar(r.id);
  expect(JSON.stringify(await db.select().from(auditoria))).not.toContain("00000-0000");
  expect(await texto("2026-10-01", ["Armação dos Búzios"])).not.toContain("00000-0000");
  await db.update(reservas).set({ hospedeTelefone: "ver mensagem; +55..." }).where(eq(reservas.id, r.id));
  expect(await texto()).not.toContain("telefone:");
  await db.update(reservas).set({ hospedeTelefone: "", observacoes: "telefone +55 00 00000-0000, pedido de check-in 08:00" }).where(eq(reservas.id, r.id));
  expect(await texto()).not.toContain("telefone:");
  expect(await texto()).not.toContain("08:00");
});

it("JSON sem prova de confirmação nunca é tratado como acordo", async () => {
  const r = await reserva();
  await db.insert(configuracoes).values({ organizacaoId: org, chave: `horarios_reserva:${r.id}`, valor: { versao: 1, entrada: { acordo: { hora: "08:00" } }, saida: {} } });
  const h = (await lerHorariosReservas(db, org, [r.id])).get(r.id);
  expect(horarioEfetivo(h, "entrada", r, "15h")).toBe("15h (padrão)");
});

it("cancelamento e reconfirmação pelo Beds24 não ressuscitam um horário aceito anteriormente", async () => {
  // Pelo Beds24 a reconfirmação deixa `confirmadaEm` vazio de propósito: o que invalida o acordo é o histórico.
  const dados: DadosReserva = { imovelId: rio, origem: "airbnb", estado: "confirmada", checkin: "2026-10-02", checkout: "2026-10-04", hospedes: 3,
    hospedeNome: "Ana Fictícia", hospedeEmail: "", hospedeTelefone: "+55 00 00000-0000", hospedeOrigem: "", moeda: "BRL", valorBruto: 100000, taxaCanal: 15000, valorLiquido: null, codigoCanal: "", observacoes: "" };
  const criada = await sincronizarReserva(db, org, "beds24", "B-1", dados);
  if (!criada.ok) throw new Error("reserva");
  const id = criada.reserva.id;
  await pedido(id); await confirmar(id);
  expect(await texto()).toContain("13:30 (confirmado com hóspede)");
  expect((await sincronizarReserva(db, org, "beds24", "B-1", { ...dados, estado: "cancelada" })).ok).toBe(true);
  expect(await pedido(id, "saida", 2)).toMatchObject({ ok: false });
  expect((await sincronizarReserva(db, org, "beds24", "B-1", dados)).ok).toBe(true);
  const [r] = await db.select().from(reservas).where(eq(reservas.id, id));
  expect(r).toMatchObject({ estado: "confirmada", confirmadaEm: null });
  expect(await texto()).toContain("acordo anterior precisa reconfirmação");
  expect(await texto()).not.toContain("13:30 (confirmado");
  // Novo pedido e novo aceite valem para a reserva reconfirmada.
  expect(await pedido(id, "entrada", 2)).toEqual({ ok: true });
  expect(await confirmar(id, "entrada", 3)).toEqual({ ok: true });
  expect(await texto()).toContain("13:30 (confirmado com hóspede)");
});

it("reconfirmação pelo painel (pendente → confirmada) também exige acordo novo", async () => {
  const r = await reserva();
  await pedido(r.id); await confirmar(r.id);
  await db.update(reservas).set({ estado: "pendente" }).where(eq(reservas.id, r.id));
  await db.insert(auditoria).values({ organizacaoId: org, entidade: "reserva", entidadeId: r.id, acao: "reserva.confirmar", mudancas: { estado: ["pendente", "confirmada"] } });
  await db.update(reservas).set({ estado: "confirmada", confirmadaEm: new Date("2026-10-01T18:00:00Z") }).where(eq(reservas.id, r.id));
  expect(await texto()).toContain("acordo anterior precisa reconfirmação");
  expect(await texto()).not.toContain("13:30 (confirmado");
});

it("limpeza realizada da saída não é repetida na lista de tarefas", async () => {
  const r = await reserva(rio, "2026-09-29", "2026-10-02");
  await db.insert(limpezas).values({ organizacaoId: org, imovelId: rio, reservaId: r.id, data: "2026-10-02", estado: "realizada", realizadaEm: new Date("2026-10-02T17:00:00Z") });
  expect(await texto()).toContain("🧹 Sex 02/10: nenhuma limpeza");
  expect((await db.select().from(limpezas))).toHaveLength(1);
});

it("agenda não imprime contatos nem conteúdo no console de desenvolvimento ou em falhas", async () => {
  await reserva();
  await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "equipe@example.com", cidades: [] }] }, sessao.usuarioId);
  const agora = new Date("2026-10-01T23:00:00Z");
  const erro = await enviarAgenda(db, org, { nome: "falso", enviar: async (m) => { throw new Error(m.texto); } }, agora);
  expect(erro.falhas.join(" ")).not.toContain("00000-0000");
  expect(erro.falhas.join(" ")).not.toContain("Ana");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const correio = new CorreioMemoria(true);
    expect((await enviarAgenda(db, org, correio, agora)).enviados).toBe(1);
    expect(correio.enviadas[0].texto).toContain("00000-0000");
    expect(correio.enviadas[0].conteudoRestrito).toBe(true);
    expect(log).toHaveBeenCalledWith("[e-mail de desenvolvimento] conteúdo restrito omitido");
    expect(JSON.stringify(log.mock.calls)).not.toContain("00000-0000");
  } finally { log.mockRestore(); }
});
