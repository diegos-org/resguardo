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
    expect(await reg({ tipo: "entrega_confirmada", data: "2026-10-04" })).toMatchObject({ ok: false, erro: expect.stringContaining("antes do encaminhamento") });
    expect(await reg({ tipo: "entrega_confirmada", data: hoje })).toEqual({ ok: true });
    expect(await reg({ tipo: "encaminhado", data: "2026-10-06" })).toMatchObject({ ok: false }); // futuro
    expect(await reg({ tipo: "segundo_pedido", data: "2026-10-04" })).toMatchObject({ ok: false, erro: expect.stringContaining("antes do aviso inicial") });
    expect(await reg({ tipo: "pendencia", texto: "  Portaria pediu foto legível  " })).toEqual({ ok: true });
    const [l] = await listarPortaria(db, org, { hoje, ate: "2026-11-05" });
    expect(l).toMatchObject({ passo: "concluido", pendencia: "Portaria pediu foto legível", destinatarioConferido: true });
    expect((await historicoDe(db, org, "reserva", id)).filter((h) => h.acao.startsWith("portaria.")).length).toBeGreaterThanOrEqual(6);
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
