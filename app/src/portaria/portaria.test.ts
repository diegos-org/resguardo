import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { type EstadoPortaria, imoveisComPortaria, listarPortaria, proximoPasso, registrarPortaria, salvarImoveisComPortaria } from "./portaria";

const base: EstadoPortaria = {
  checkin: "2026-10-20",
  reservadaEm: "2026-10-01",
  hospedes: 2,
  documentosRecebidos: 0,
  avisoInicialEm: null,
  segundoPedidoEm: null,
  pedidoFinalEm: null,
  encaminhadoEm: null,
  entregaConfirmadaEm: null,
};
const passo = (e: Partial<EstadoPortaria>, hoje: string) => proximoPasso({ ...base, ...e }, hoje).passo;

describe("próximo passo (regra dos pedidos)", () => {
  it("aviso inicial → segundo pedido entre 5 e 7 dias antes → pedido final na véspera", () => {
    expect(passo({}, "2026-10-02")).toBe("aviso_inicial");
    const avisado = { avisoInicialEm: "2026-10-02" };
    expect(passo(avisado, "2026-10-10")).toBe("aguardar");
    expect(proximoPasso({ ...base, ...avisado }, "2026-10-10").texto).toContain("Segundo pedido entre 13/10/2026 e 15/10/2026");
    expect(passo(avisado, "2026-10-13")).toBe("segundo_pedido");
    expect(passo(avisado, "2026-10-15")).toBe("segundo_pedido");
    const segundo = { ...avisado, segundoPedidoEm: "2026-10-14" };
    expect(passo(segundo, "2026-10-16")).toBe("aguardar");
    expect(passo(segundo, "2026-10-19")).toBe("pedido_final");
    expect(passo({ ...segundo, pedidoFinalEm: "2026-10-19" }, "2026-10-19")).toBe("aguardar");
  });

  it("reserva de última hora não recebe os três pedidos comprimidos", () => {
    const ultima = { reservadaEm: "2026-10-16", avisoInicialEm: "2026-10-16" };
    expect(passo(ultima, "2026-10-16")).toBe("aguardar"); // sem segundo pedido: a janela já tinha passado
    expect(passo(ultima, "2026-10-19")).toBe("pedido_final");
    // Reservada na véspera: o aviso inicial do mesmo dia basta.
    expect(passo({ reservadaEm: "2026-10-19", avisoInicialEm: "2026-10-19" }, "2026-10-19")).toBe("aguardar");
  });

  it("documentos completos → encaminhar → confirmar entrega → concluído; entrada passou sem cobrança", () => {
    expect(passo({ documentosRecebidos: 2 }, "2026-10-10")).toBe("encaminhar");
    expect(passo({ documentosRecebidos: 2, encaminhadoEm: "2026-10-11" }, "2026-10-12")).toBe("confirmar_entrega");
    expect(passo({ documentosRecebidos: 2, encaminhadoEm: "2026-10-11", entregaConfirmadaEm: "2026-10-11" }, "2026-10-12")).toBe("concluido");
    const r = proximoPasso({ ...base, documentosRecebidos: 1, avisoInicialEm: "2026-10-02" }, "2026-10-21");
    expect(r).toMatchObject({ passo: "entrada_passou" });
    expect(r.texto).toContain("Faltam 1 documento(s)");
    // Sem número de hóspedes: avisa em vez de supor que está completo.
    expect(proximoPasso({ ...base, hospedes: null, documentosRecebidos: 3 }, "2026-10-05").texto).toContain("Número de hóspedes não informado");
  });
});

let db: Db;
let close: () => Promise<void>;
let org: string;
let a: string;
let b: string;

const reserva = (imovelId: string, over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId,
  origem: "booking",
  estado: "confirmada",
  checkin: "2026-10-20",
  checkout: "2026-10-23",
  hospedes: 2,
  hospedeNome: "Hóspede Fictício",
  hospedeEmail: "",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 100000,
  taxaCanal: 15000,
  valorLiquido: null,
  codigoCanal: "",
  observacoes: "",
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: a }, { id: b }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro" },
      { organizacaoId: org, codigo: "102", nome: "Um" },
    ])
    .returning();
});
afterEach(() => close());

describe("lista de portaria", () => {
  it("só imóveis marcados no painel (nada fixo); sem marcação, lista vazia", async () => {
    await criarReserva(db, org, reserva(a), null);
    await criarReserva(db, org, reserva(b, { checkin: "2026-10-10", checkout: "2026-10-12" }), null);
    expect(await listarPortaria(db, org, { hoje: "2026-10-05", ate: "2026-11-05" })).toEqual([]);
    expect(await salvarImoveisComPortaria(db, org, [a], null)).toEqual({ ok: true });
    expect(await imoveisComPortaria(db, org)).toEqual([a]);
    const l = await listarPortaria(db, org, { hoje: "2026-10-05", ate: "2026-11-05" });
    expect(l.map((x) => [x.imovelCodigo, x.passo])).toEqual([["403", "aviso_inicial"]]);
    expect(await salvarImoveisComPortaria(db, org, ["00000000-0000-4000-8000-000000000000"], null)).toMatchObject({ ok: false });
  });

  it("registra os passos com trava e histórico; encaminhar exige destinatário conferido e documentos completos", async () => {
    await salvarImoveisComPortaria(db, org, [a], null);
    const r = await criarReserva(db, org, reserva(a), null);
    if (!r.ok) throw new Error("reserva");
    const id = r.reserva.id;
    const hoje = "2026-10-05";
    const reg = (x: Parameters<typeof registrarPortaria>[3]) => registrarPortaria(db, org, id, x, hoje, null);
    expect(await reg({ tipo: "aviso_inicial", data: "2026-10-06" })).toMatchObject({ ok: false }); // futuro
    expect(await reg({ tipo: "aviso_inicial", data: hoje })).toEqual({ ok: true });
    expect(await reg({ tipo: "documentos", recebidos: 3 })).toMatchObject({ ok: false, erro: expect.stringContaining("2 hóspede") });
    expect(await reg({ tipo: "documentos", recebidos: 2 })).toEqual({ ok: true });
    expect(await reg({ tipo: "encaminhado", data: hoje })).toMatchObject({ ok: false, erro: expect.stringContaining("destinatário") });
    expect(await reg({ tipo: "entrega_confirmada", data: hoje })).toMatchObject({ ok: false });
    expect(await reg({ tipo: "destinatario", conferido: true })).toEqual({ ok: true });
    expect(await reg({ tipo: "encaminhado", data: hoje })).toEqual({ ok: true });
    expect((await listarPortaria(db, org, { hoje, ate: "2026-11-05" }))[0].passo).toBe("confirmar_entrega");
    expect(await reg({ tipo: "entrega_confirmada", data: "2026-10-04" })).toMatchObject({ ok: false, erro: expect.stringContaining("no dia ou depois do encaminhamento") });
    expect(await reg({ tipo: "entrega_confirmada", data: hoje })).toEqual({ ok: true });
    expect(await reg({ tipo: "encaminhado", data: "2026-10-06" })).toMatchObject({ ok: false }); // futuro
    expect(await reg({ tipo: "pendencia", texto: "  Portaria pediu foto legível  " })).toEqual({ ok: true });
    // Correção que desfaz um pré-requisito tira o encaminhamento e a entrega (o passo volta).
    expect(await reg({ tipo: "destinatario", conferido: false })).toEqual({ ok: true });
    expect((await listarPortaria(db, org, { hoje, ate: "2026-11-05" }))[0]).toMatchObject({ passo: "encaminhar", encaminhadoEm: null, entregaConfirmadaEm: null });
    expect(await reg({ tipo: "destinatario", conferido: true })).toEqual({ ok: true });
    expect(await reg({ tipo: "encaminhado", data: hoje })).toEqual({ ok: true });
    expect(await reg({ tipo: "documentos", recebidos: 1 })).toEqual({ ok: true });
    expect((await listarPortaria(db, org, { hoje, ate: "2026-11-05" }))[0]).toMatchObject({ encaminhadoEm: null, destinatarioConferido: true });
    expect(await reg({ tipo: "entrega_confirmada", data: hoje })).toMatchObject({ ok: false });
    expect(await reg({ tipo: "documentos", recebidos: 2 })).toEqual({ ok: true });
    expect(await reg({ tipo: "encaminhado", data: hoje })).toEqual({ ok: true });
    expect(await reg({ tipo: "entrega_confirmada", data: hoje })).toEqual({ ok: true });
    const [l] = await listarPortaria(db, org, { hoje, ate: "2026-11-05" });
    expect(l).toMatchObject({ passo: "concluido", pendencia: "Portaria pediu foto legível", destinatarioConferido: true });
    expect((await historicoDe(db, org, "reserva", id)).filter((h) => h.acao.startsWith("portaria.")).length).toBeGreaterThanOrEqual(6);
  });

  it("cada pedido só na sua janela e em ordem: aviso antes da entrada, segundo 5 a 7 dias antes, final na véspera", async () => {
    await salvarImoveisComPortaria(db, org, [a], null);
    const r = await criarReserva(db, org, reserva(a), null);
    if (!r.ok) throw new Error("reserva");
    // Reserva feita bem antes (sem depender do relógio do teste).
    await db.update(reservas).set({ criadoEm: new Date("2026-09-01T15:00:00Z") }).where(eq(reservas.id, r.reserva.id));
    const reg = (x: Parameters<typeof registrarPortaria>[3], hoje = "2026-10-25") => registrarPortaria(db, org, r.reserva.id, x, hoje, null);
    expect(await reg({ tipo: "aviso_inicial", data: "2026-10-20" })).toMatchObject({ ok: false, erro: expect.stringContaining("antes da entrada") });
    expect(await reg({ tipo: "aviso_inicial", data: "2026-10-14" })).toEqual({ ok: true });
    expect(await reg({ tipo: "segundo_pedido", data: "2026-10-12" })).toMatchObject({ ok: false, erro: expect.stringContaining("entre 13/10/2026 e 15/10/2026") });
    expect(await reg({ tipo: "segundo_pedido", data: "2026-10-16" })).toMatchObject({ ok: false, erro: expect.stringContaining("entre 13/10/2026 e 15/10/2026") });
    expect(await reg({ tipo: "segundo_pedido", data: "2026-10-13" })).toMatchObject({ ok: false, erro: expect.stringContaining("depois do aviso inicial") });
    expect(await reg({ tipo: "segundo_pedido", data: "2026-10-14" })).toMatchObject({ ok: false, erro: expect.stringContaining("depois do aviso inicial") }); // mesmo dia
    expect(await reg({ tipo: "segundo_pedido", data: "2026-10-15" })).toEqual({ ok: true });
    expect(await reg({ tipo: "pedido_final", data: "2026-10-18" })).toMatchObject({ ok: false, erro: expect.stringContaining("véspera") });
    expect(await reg({ tipo: "pedido_final", data: "2026-10-20" })).toMatchObject({ ok: false, erro: expect.stringContaining("véspera") });
    expect(await reg({ tipo: "pedido_final", data: "2026-10-19" })).toEqual({ ok: true });
  });

  it("entrada adiada depois dos pedidos: os pedidos da data antiga deixam de valer e o passo volta a pedir", async () => {
    await salvarImoveisComPortaria(db, org, [a], null);
    const r = await criarReserva(db, org, reserva(a), null);
    if (!r.ok) throw new Error("reserva");
    const id = r.reserva.id;
    await db.update(reservas).set({ criadoEm: new Date("2026-09-01T15:00:00Z") }).where(eq(reservas.id, id));
    const reg = (x: Parameters<typeof registrarPortaria>[3], hoje: string) => registrarPortaria(db, org, id, x, hoje, null);
    expect(await reg({ tipo: "aviso_inicial", data: "2026-10-05" }, "2026-10-05")).toEqual({ ok: true });
    expect(await reg({ tipo: "segundo_pedido", data: "2026-10-14" }, "2026-10-14")).toEqual({ ok: true });
    expect(await reg({ tipo: "pedido_final", data: "2026-10-19" }, "2026-10-19")).toEqual({ ok: true });
    // A sincronização adia a entrada de 20/10 para 30/10.
    await db.update(reservas).set({ checkin: "2026-10-30", checkout: "2026-11-02" }).where(eq(reservas.id, id));
    const [l] = await listarPortaria(db, org, { hoje: "2026-10-24", ate: "2026-11-30" });
    expect(l).toMatchObject({ avisoInicialEm: "2026-10-05", segundoPedidoEm: null, pedidoFinalEm: null, passo: "segundo_pedido" });
    // O segundo pedido novo não esbarra no pedido final antigo; o antigo sai da lista (fica no histórico).
    expect(await reg({ tipo: "segundo_pedido", data: "2026-10-24" }, "2026-10-24")).toEqual({ ok: true });
    expect((await listarPortaria(db, org, { hoje: "2026-10-29", ate: "2026-11-30" }))[0]).toMatchObject({ segundoPedidoEm: "2026-10-24", pedidoFinalEm: null, passo: "pedido_final" });
    expect(await reg({ tipo: "pedido_final", data: "2026-10-29" }, "2026-10-29")).toEqual({ ok: true });
  });

  it("reserva que muda de data depois da entrega pede novo encaminhamento; segundo e final exigem o aviso inicial", async () => {
    await salvarImoveisComPortaria(db, org, [a], null);
    const r = await criarReserva(db, org, reserva(a), null);
    if (!r.ok) throw new Error("reserva");
    const id = r.reserva.id;
    await db.update(reservas).set({ criadoEm: new Date("2026-09-01T15:00:00Z") }).where(eq(reservas.id, id));
    const reg = (x: Parameters<typeof registrarPortaria>[3], hoje = "2026-10-14") => registrarPortaria(db, org, id, x, hoje, null);
    expect(await reg({ tipo: "segundo_pedido", data: "2026-10-14" })).toMatchObject({ ok: false, erro: expect.stringContaining("aviso inicial antes") });
    expect(await reg({ tipo: "pedido_final", data: "2026-10-19" }, "2026-10-19")).toMatchObject({ ok: false, erro: expect.stringContaining("aviso inicial antes") });
    await reg({ tipo: "documentos", recebidos: 2 });
    await reg({ tipo: "destinatario", conferido: true });
    await reg({ tipo: "encaminhado", data: "2026-10-14" });
    await reg({ tipo: "entrega_confirmada", data: "2026-10-14" });
    expect((await listarPortaria(db, org, { hoje: "2026-10-14", ate: "2026-11-30" }))[0].passo).toBe("concluido");
    // Mudou só a saída: o que foi encaminhado tinha outras datas.
    await db.update(reservas).set({ checkout: "2026-10-25" }).where(eq(reservas.id, id));
    expect((await listarPortaria(db, org, { hoje: "2026-10-14", ate: "2026-11-30" }))[0]).toMatchObject({ passo: "encaminhar", encaminhadoEm: null, entregaConfirmadaEm: null });
    expect(await reg({ tipo: "entrega_confirmada", data: "2026-10-14" })).toMatchObject({ ok: false, erro: expect.stringContaining("encaminhamento") });
    expect(await reg({ tipo: "encaminhado", data: "2026-10-14" })).toEqual({ ok: true });
    expect(await reg({ tipo: "entrega_confirmada", data: "2026-10-14" })).toEqual({ ok: true });
    expect((await listarPortaria(db, org, { hoje: "2026-10-14", ate: "2026-11-30" }))[0].passo).toBe("concluido");
  });

  it("reserva que muda de imóvel (os dois com portaria): destinatário e envio valem de novo do zero", async () => {
    await salvarImoveisComPortaria(db, org, [a, b], null);
    const r = await criarReserva(db, org, reserva(a), null);
    if (!r.ok) throw new Error("reserva");
    const id = r.reserva.id;
    const reg = (x: Parameters<typeof registrarPortaria>[3]) => registrarPortaria(db, org, id, x, "2026-10-05", null);
    await reg({ tipo: "documentos", recebidos: 2 });
    await reg({ tipo: "destinatario", conferido: true });
    await reg({ tipo: "encaminhado", data: "2026-10-05" });
    await reg({ tipo: "entrega_confirmada", data: "2026-10-05" });
    await db.update(reservas).set({ imovelId: b }).where(eq(reservas.id, id));
    const [l] = await listarPortaria(db, org, { hoje: "2026-10-05", ate: "2026-11-05" });
    expect(l).toMatchObject({ imovelCodigo: "102", passo: "encaminhar", destinatarioConferido: false, encaminhadoEm: null, documentosRecebidos: 2 });
    expect(await reg({ tipo: "encaminhado", data: "2026-10-05" })).toMatchObject({ ok: false, erro: expect.stringContaining("destinatário") });
    expect(await reg({ tipo: "destinatario", conferido: true })).toEqual({ ok: true });
    expect(await reg({ tipo: "encaminhado", data: "2026-10-05" })).toEqual({ ok: true });
  });

  it("mais documentos depois do encaminhamento pedem novo encaminhamento", async () => {
    await salvarImoveisComPortaria(db, org, [a], null);
    const r = await criarReserva(db, org, reserva(a), null);
    if (!r.ok) throw new Error("reserva");
    const id = r.reserva.id;
    const reg = (x: Parameters<typeof registrarPortaria>[3]) => registrarPortaria(db, org, id, x, "2026-10-05", null);
    await reg({ tipo: "documentos", recebidos: 2 });
    await reg({ tipo: "destinatario", conferido: true });
    await reg({ tipo: "encaminhado", data: "2026-10-05" });
    await reg({ tipo: "entrega_confirmada", data: "2026-10-05" });
    // A reserva passa a 3 hóspedes e chega o terceiro documento.
    await db.update(reservas).set({ hospedes: 3 }).where(eq(reservas.id, id));
    expect(await reg({ tipo: "documentos", recebidos: 3 })).toEqual({ ok: true });
    expect((await listarPortaria(db, org, { hoje: "2026-10-05", ate: "2026-11-05" }))[0]).toMatchObject({ passo: "encaminhar", encaminhadoEm: null, entregaConfirmadaEm: null });
  });

  it("reserva de última hora não tem segundo pedido; dia da reserva no fuso de São Paulo", async () => {
    await salvarImoveisComPortaria(db, org, [a], null);
    const r = await criarReserva(db, org, reserva(a, { checkin: "2026-10-02", checkout: "2026-10-04" }), null);
    if (!r.ok) throw new Error("reserva");
    // 24/09 às 22:30 em São Paulo (já 25/09 em UTC): 8 dias de antecedência, tem segundo pedido.
    await db.update(reservas).set({ criadoEm: new Date("2026-09-25T01:30:00Z") }).where(eq(reservas.id, r.reserva.id));
    expect(await registrarPortaria(db, org, r.reserva.id, { tipo: "aviso_inicial", data: "2026-09-25" }, "2026-09-25", null)).toEqual({ ok: true });
    expect((await listarPortaria(db, org, { hoje: "2026-09-26", ate: "2026-11-05" }))[0]).toMatchObject({ reservadaEm: "2026-09-24", passo: "segundo_pedido" });
    expect(await registrarPortaria(db, org, r.reserva.id, { tipo: "segundo_pedido", data: "2026-09-26" }, "2026-09-26", null)).toEqual({ ok: true });
    // Feita às 00:30 de 25/09 em São Paulo: 7 dias, sem segundo pedido.
    const r2 = await criarReserva(db, org, reserva(a, { checkin: "2026-10-02", checkout: "2026-10-04", codigoCanal: "X2" }), null);
    if (!r2.ok) throw new Error("reserva");
    await db.update(reservas).set({ criadoEm: new Date("2026-09-25T03:30:00Z") }).where(eq(reservas.id, r2.reserva.id));
    expect(await registrarPortaria(db, org, r2.reserva.id, { tipo: "segundo_pedido", data: "2026-09-26" }, "2026-09-26", null)).toMatchObject({ ok: false, erro: expect.stringContaining("não tem segundo pedido") });
  });

  it("imóvel sem portaria, reserva de outra organização e reserva cancelada", async () => {
    await salvarImoveisComPortaria(db, org, [a], null);
    const rb = await criarReserva(db, org, reserva(b), null);
    if (!rb.ok) throw new Error("reserva");
    expect(await registrarPortaria(db, org, rb.reserva.id, { tipo: "aviso_inicial", data: "2026-10-05" }, "2026-10-05", null)).toMatchObject({ ok: false, erro: expect.stringContaining("não exige") });
    const [outra] = await db.insert(organizacoes).values({ nome: "B" }).returning();
    const ra = await criarReserva(db, org, reserva(a), null);
    if (!ra.ok) throw new Error("reserva");
    expect(await registrarPortaria(db, outra.id, ra.reserva.id, { tipo: "aviso_inicial", data: "2026-10-05" }, "2026-10-05", null)).toMatchObject({ ok: false });
    await db.update(reservas).set({ estado: "cancelada" }).where(eq(reservas.id, ra.reserva.id));
    expect(await registrarPortaria(db, org, ra.reserva.id, { tipo: "aviso_inicial", data: "2026-10-05" }, "2026-10-05", null)).toMatchObject({ ok: false, erro: expect.stringContaining("não está confirmada") });
    expect(await listarPortaria(db, org, { hoje: "2026-10-05", ate: "2026-11-05" })).toEqual([]);
  });
});
