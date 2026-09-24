import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, limpezas, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import type { DadosReserva } from "@/reservas/regras";
import { cancelarReserva, criarReserva, sincronizarReserva } from "@/reservas/repositorio";
import {
  cancelarLimpeza,
  comMotivo,
  itensDoCalendario,
  confirmarLimpeza,
  criarLimpezaAvulsa,
  criarProfissional,
  editarProfissional,
  informarCusto,
  listarLimpezas,
  listarProfissionais,
  realizarLimpeza,
  reabrirLimpeza,
  sincronizarLimpezas,
  validarCusto,
} from "./limpezas";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;
let a: string;
let b: string;
const periodo = { inicio: "2026-10-01", fim: "2026-11-01" };

const reserva = (imovelId: string, checkin: string, checkout: string, over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId,
  origem: "booking",
  estado: "confirmada",
  checkin,
  checkout,
  hospedes: 2,
  hospedeNome: "Hóspede Fictício",
  hospedeEmail: "",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 100000,
  taxaCanal: 15000,
  valorLiquido: null,
  codigoCanal: "X1",
  observacoes: "",
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: a }, { id: b }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro" },
      { organizacaoId: org, codigo: "102", nome: "Um" },
    ])
    .returning();
});
afterEach(() => close());

const lista = (hoje = "2026-10-01") => listarLimpezas(db, org, { ...periodo, hoje });
async function profissional(nome = "Maria Fictícia") {
  await criarProfissional(db, org, { nome, telefone: "", observacoes: "" }, null);
  return (await listarProfissionais(db, org)).find((p) => p.nome === nome)!.id;
}

describe("geração no dia do checkout", () => {
  it("reserva confirmada gera limpeza pedida na saída (inclusive fim de semana); pendente não; idempotente", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-17"), null); // 17/10/2026 é sábado
    await criarReserva(db, org, reserva(b, "2026-10-12", "2026-10-14", { estado: "pendente" }), null);
    expect(await sincronizarLimpezas(db, org, periodo)).toEqual({ criadas: 1, atualizadas: 0, canceladas: 0 });
    expect(await sincronizarLimpezas(db, org, periodo)).toEqual({ criadas: 0, atualizadas: 0, canceladas: 0 });
    const [l] = await lista();
    expect(l).toMatchObject({ imovelCodigo: "403", data: "2026-10-17", estado: "pedida", profissional: null });
    expect(await historicoDe(db, org, "limpeza", l.id)).toHaveLength(1);
  });

  it("saída mudou: acompanha e volta a pedida; cancelada: cancela; já realizada: não mexe e avisa", async () => {
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const maria = await profissional();
    let [l] = await lista();
    expect(await confirmarLimpeza(db, org, l.id, maria, null)).toEqual({ ok: true });

    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-16"), null);
    expect((await sincronizarLimpezas(db, org, periodo)).atualizadas).toBe(1);
    [l] = await lista();
    expect(l).toMatchObject({ data: "2026-10-16", estado: "pedida" });

    expect(await realizarLimpeza(db, org, l.id, { profissionalId: maria, custo: 12000 }, "2026-10-16", null)).toEqual({ ok: true });
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-18"), null);
    await sincronizarLimpezas(db, org, periodo);
    [l] = await lista();
    expect(l).toMatchObject({ data: "2026-10-16", estado: "realizada", custo: 12000 });
    expect(l.avisos.join(" ")).toContain("mudou para 18/10/2026");
  });

  it("reserva cancelada cancela a limpeza aberta; realizada fica e avisa", async () => {
    const r1 = await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-15"), null);
    const r2 = await criarReserva(db, org, reserva(b, "2026-10-10", "2026-10-12"), null);
    if (!r1.ok || !r2.ok) throw new Error("reserva");
    await sincronizarLimpezas(db, org, periodo);
    const maria = await profissional();
    const feita = (await lista()).find((x) => x.imovelCodigo === "102")!;
    await realizarLimpeza(db, org, feita.id, { profissionalId: maria, custo: null }, "2026-10-12", null);
    await cancelarReserva(db, org, r1.reserva.id, null);
    await cancelarReserva(db, org, r2.reserva.id, null);
    expect((await sincronizarLimpezas(db, org, periodo)).canceladas).toBe(1);
    const ls = await lista("2026-10-20");
    expect(ls.find((x) => x.imovelCodigo === "403")?.estado).toBe("cancelada");
    const r = ls.find((x) => x.imovelCodigo === "102")!;
    expect(r.estado).toBe("realizada");
    expect(r.avisos).toEqual(["A reserva foi cancelada depois da limpeza realizada: confira.", "Custo não informado."]);
  });
});

describe("cancelada à mão e mudança de imóvel", () => {
  it("limpeza cancelada à mão com a reserva confirmada não é reaberta pela sincronização e fica com aviso", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const [l] = await lista();
    expect(await cancelarLimpeza(db, org, l.id, "Proprietário vai ficar no imóvel", null)).toEqual({ ok: true });
    expect(await sincronizarLimpezas(db, org, periodo)).toEqual({ criadas: 0, atualizadas: 0, canceladas: 0 });
    const [depois] = await lista();
    expect(depois).toMatchObject({ estado: "cancelada", canceladaManual: true });
    expect(depois.avisos.join(" ")).toContain("Cancelada à mão");
  });

  it("cancelada à mão acompanha a nova saída/imóvel da reserva sem ser reaberta", async () => {
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const [l] = await lista();
    await cancelarLimpeza(db, org, l.id, "Proprietário vai ficar", null);
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(b, "2026-10-10", "2026-10-18"), null);
    expect((await sincronizarLimpezas(db, org, periodo)).atualizadas).toBe(1);
    expect((await lista())[0]).toMatchObject({ data: "2026-10-18", imovelCodigo: "102", estado: "cancelada", canceladaManual: true });
    expect(await sincronizarLimpezas(db, org, periodo)).toEqual({ criadas: 0, atualizadas: 0, canceladas: 0 });
  });

  it("o motivo do cancelamento nunca é cortado, mesmo com a observação cheia", async () => {
    expect(comMotivo("", "Cancelada: x")).toBe("Cancelada: x");
    const r = comMotivo("a".repeat(500), "Cancelada: dono desistiu");
    expect(r).toHaveLength(500);
    expect(r.endsWith(" · Cancelada: dono desistiu")).toBe(true);
    await criarLimpezaAvulsa(db, org, { imovelId: a, data: "2026-10-20", observacao: "b".repeat(500) }, null);
    await cancelarLimpeza(db, org, (await lista())[0].id, "Obra no prédio", null);
    expect((await lista())[0].observacao.endsWith("Cancelada: Obra no prédio")).toBe(true);
  });

  it("calendário: uma limpeza ocupa o dia dela; cancelada não aparece", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-15"), null);
    await criarReserva(db, org, reserva(b, "2026-10-10", "2026-10-12", { codigoCanal: "X2" }), null);
    await sincronizarLimpezas(db, org, periodo);
    const ls = await lista();
    await cancelarLimpeza(db, org, ls.find((x) => x.imovelCodigo === "102")!.id, "sem necessidade", null);
    const itens = itensDoCalendario(await lista());
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ imovelId: a, inicio: "2026-10-15", fim: "2026-10-16", tipo: "limpeza", categoria: "limpeza" });
  });

  it("reserva de volta a pendente: limpeza aberta sai; confirmada de novo, volta", async () => {
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15", { estado: "pendente" }), null);
    expect((await sincronizarLimpezas(db, org, periodo)).canceladas).toBe(1);
    expect((await lista())[0]).toMatchObject({ estado: "cancelada", canceladaManual: false });
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    expect((await lista())[0]).toMatchObject({ estado: "pedida" });
  });

  it("realizada e a reserva volta a pendente: não mexe e avisa", async () => {
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const maria = await profissional();
    await realizarLimpeza(db, org, (await lista())[0].id, { profissionalId: maria, custo: 10000 }, "2026-10-15", null);
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15", { estado: "pendente" }), null);
    expect(await sincronizarLimpezas(db, org, periodo)).toEqual({ criadas: 0, atualizadas: 0, canceladas: 0 });
    expect((await lista())[0]).toMatchObject({ estado: "realizada", avisos: ["A reserva voltou a pendente depois da limpeza realizada: confira."] });
  });

  it("realizada cuja reserva mudou de mês aparece também no mês novo, com o aviso", async () => {
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-25", "2026-10-30"), null);
    await sincronizarLimpezas(db, org, periodo);
    const maria = await profissional();
    await realizarLimpeza(db, org, (await lista())[0].id, { profissionalId: maria, custo: null }, "2026-10-30", null);
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(b, "2026-10-28", "2026-11-03"), null);
    const novembro = { inicio: "2026-11-01", fim: "2026-12-01" };
    await sincronizarLimpezas(db, org, novembro);
    const [l] = await listarLimpezas(db, org, { ...novembro, hoje: "2026-11-05" });
    expect(l).toMatchObject({ data: "2026-10-30", estado: "realizada", imovelCodigo: "403", movida: true });
    expect((await lista("2026-11-05"))[0]).toMatchObject({ data: "2026-10-30", movida: false });
    expect(l.avisos.join(" ")).toContain("mudou para 03/11/2026");
    expect(await listarLimpezas(db, org, { ...novembro, imovelIds: [b], hoje: "2026-11-05" })).toHaveLength(1);
    // Data e imóvel sempre do mesmo par: novembro/403 e outubro/102 não mostram a limpeza.
    expect(await listarLimpezas(db, org, { ...novembro, imovelIds: [a], hoje: "2026-11-05" })).toHaveLength(0);
    expect(await listarLimpezas(db, org, { ...periodo, imovelIds: [b], hoje: "2026-11-05" })).toHaveLength(0);
    expect(await listarLimpezas(db, org, { ...periodo, imovelIds: [a], hoje: "2026-11-05" })).toHaveLength(1);
  });

  it("profissional arquivada depois de escolhida ainda pode ser registrada como quem fez", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const maria = await profissional();
    const joana = await profissional("Joana Fictícia");
    const [l] = await lista();
    await confirmarLimpeza(db, org, l.id, maria, null);
    await editarProfissional(db, org, maria, { nome: "Maria Fictícia", telefone: "", observacoes: "", ativo: false }, null);
    await editarProfissional(db, org, joana, { nome: "Joana Fictícia", telefone: "", observacoes: "", ativo: false }, null);
    expect(await realizarLimpeza(db, org, l.id, { profissionalId: joana, custo: null }, "2026-10-15", null)).toMatchObject({ ok: false });
    expect(await realizarLimpeza(db, org, l.id, { profissionalId: maria, custo: null }, "2026-10-15", null)).toEqual({ ok: true });
  });

  it("cancelada pela reserva volta a pedida quando a reserva é reativada", async () => {
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15", { estado: "cancelada" }), null);
    expect((await sincronizarLimpezas(db, org, periodo)).canceladas).toBe(1);
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15"), null);
    expect((await sincronizarLimpezas(db, org, periodo)).atualizadas).toBe(1);
    expect((await lista())[0]).toMatchObject({ estado: "pedida", canceladaManual: false });
  });

  it("reserva mudou de imóvel depois da limpeza realizada (mesma saída): avisa", async () => {
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const maria = await profissional();
    const [l] = await lista();
    await realizarLimpeza(db, org, l.id, { profissionalId: maria, custo: 12000 }, "2026-10-15", null);
    await sincronizarReserva(db, org, "csv", "booking:X1", reserva(b, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const [depois] = await lista();
    expect(depois).toMatchObject({ imovelCodigo: "403", estado: "realizada" });
    expect(depois.avisos).toContain("A reserva mudou de imóvel depois da limpeza realizada: confira.");
  });
});

describe("estados e profissional", () => {
  it("confirmar exige profissional ativa; realizar exige quem fez e só a partir do dia", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const [l] = await lista();
    expect(await confirmarLimpeza(db, org, l.id, "nao-uuid", null)).toMatchObject({ ok: false });
    const maria = await profissional();
    await editarProfissional(db, org, maria, { nome: "Maria Fictícia", telefone: "", observacoes: "", ativo: false }, null);
    expect(await confirmarLimpeza(db, org, l.id, maria, null)).toMatchObject({ ok: false, erro: expect.stringContaining("ativa") });
    await editarProfissional(db, org, maria, { nome: "Maria Fictícia", telefone: "", observacoes: "", ativo: true }, null);
    expect(await realizarLimpeza(db, org, l.id, { profissionalId: maria, custo: null }, "2026-10-14", null)).toMatchObject({ ok: false, erro: expect.stringContaining("ainda não chegou") });
    expect(await realizarLimpeza(db, org, l.id, { profissionalId: maria, custo: -1 }, "2026-10-15", null)).toMatchObject({ ok: false });
    expect(await realizarLimpeza(db, org, l.id, { profissionalId: maria, custo: 15000 }, "2026-10-15", null)).toEqual({ ok: true });
    expect(await cancelarLimpeza(db, org, l.id, "engano", null)).toMatchObject({ ok: false });
    expect(await informarCusto(db, org, l.id, 16000, null)).toEqual({ ok: true });
    expect(await reabrirLimpeza(db, org, l.id, null)).toEqual({ ok: true });
    expect((await lista())[0]).toMatchObject({ estado: "confirmada", custo: 16000 });
    // Realizada de novo sem custo no formulário: mantém o custo já informado.
    expect(await realizarLimpeza(db, org, l.id, { profissionalId: maria, custo: null }, "2026-10-15", null)).toEqual({ ok: true });
    expect((await lista())[0]).toMatchObject({ estado: "realizada", custo: 16000 });
  });

  it("data passou sem registro vira aviso (não é marcada como feita)", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    expect((await lista("2026-10-20"))[0]).toMatchObject({ estado: "pedida", avisos: ["A data já passou e a limpeza não foi registrada como realizada."] });
  });

  it("avulsa, cancelar com motivo, custo validado e nome de profissional único", async () => {
    expect(await criarLimpezaAvulsa(db, org, { imovelId: a, data: "2026-10-20", observacao: "Antes do uso do dono" }, null)).toEqual({ ok: true });
    const [l] = await lista();
    expect(l).toMatchObject({ reservaId: null, estado: "pedida", observacao: "Antes do uso do dono" });
    expect(await cancelarLimpeza(db, org, l.id, "", null)).toMatchObject({ ok: false });
    expect(await cancelarLimpeza(db, org, l.id, "Dono desistiu", null)).toEqual({ ok: true });
    expect((await lista())[0].observacao).toContain("Cancelada: Dono desistiu");
    expect(validarCusto(null)).toBeNull();
    expect(validarCusto(10_000_001)).not.toBeNull();
    await profissional("Ana");
    expect(await criarProfissional(db, org, { nome: "ana", telefone: "", observacoes: "" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("Já existe") });
  });

  it("outra organização não vê nem mexe", async () => {
    await criarReserva(db, org, reserva(a, "2026-10-10", "2026-10-15"), null);
    await sincronizarLimpezas(db, org, periodo);
    const [l] = await lista();
    expect(await listarLimpezas(db, outraOrg, { ...periodo, hoje: "2026-10-01" })).toEqual([]);
    expect(await cancelarLimpeza(db, outraOrg, l.id, "x", null)).toMatchObject({ ok: false });
    expect(await criarLimpezaAvulsa(db, outraOrg, { imovelId: a, data: "2026-10-20", observacao: "" }, null)).toMatchObject({ ok: false });
    expect(await listarLimpezas(db, org, { ...periodo, hoje: "2026-10-01", imovelIds: [] })).toEqual([]);
    const [x] = await db.select().from(limpezas).where(eq(limpezas.id, l.id));
    expect(x.estado).toBe("pedida");
  });
});
