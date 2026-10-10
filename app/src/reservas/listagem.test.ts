import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { imoveis, organizacoes, reservas, beds24Execucoes, beds24ExecucaoReservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { lerFiltrosLista, linkLista, listarReservasPaginadas, resumoImportacao } from "./listagem";
import { cancelar, entradaPadrao, minutos, montarCenario, pagarEConfirmar, pedir, usuarioDeTeste } from "@/pagamentos/testes";
import { listarReservas } from "./repositorio";

let db: Db, close: () => Promise<void>, org: string, im: string;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(async () => close());
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Teste" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "FAKE", nome: "Teste" }).returning();
});
const linha = (codigo: string, over: Partial<typeof reservas.$inferInsert> = {}) => ({ organizacaoId: org, imovelId: im, codigo, origem: "airbnb" as const, estado: "confirmada" as const, checkin: "2027-06-01", checkout: "2027-06-04", ...over });
const opcoes = () => ({ imovelIds: [im], periodo: { inicio: "2026-10-01", fim: "2026-11-01" }, agora: new Date("2026-10-02T03:00:00Z") });
const listar = (p: Record<string, string> = {}) => listarReservasPaginadas(db, org, lerFiltrosLista({ escopo: "historico", ...p }), opcoes());

it("histórico passa do mês e da página inicial, sem duplicar; página exagerada termina na última", async () => {
  await db.insert(reservas).values(Array.from({ length: 56 }, (_, i) => linha(`SCL-FAKE${String(i).padStart(3, "0")}`)));
  expect((await listar({ escopo: "periodo" })).total).toBe(0);
  const a = await listar(), b = await listar({ pagina: "2" }), c = await listar({ pagina: "999" });
  expect([a.total, a.itens.length, b.itens.length, c.itens.length, c.pagina]).toEqual([56, 25, 25, 6, 3]);
  expect(new Set([...a.itens, ...b.itens, ...c.itens].map(r => r.id)).size).toBe(56);
});

it("ordena por contratação, não por importação/check-in; desconhecidas no fim e fora dos últimos 7 dias", async () => {
  await db.insert(reservas).values([
    linha("ANTIGA", { reservadaEm: new Date("2026-08-01T10:00:00Z"), criadoEm: new Date("2026-10-02T03:00:00Z") }),
    linha("NOVA", { reservadaEm: new Date("2026-10-01T23:00:00-03:00"), criadoEm: new Date("2026-10-01T02:00:00Z") }),
    linha("SEM-DATA"),
  ]);
  expect((await listar({ ordem: "origem" })).itens.map(r => r.codigo)).toEqual(["NOVA", "ANTIGA", "SEM-DATA"]);
  expect((await listar({ recentes: "7" })).itens.map(r => r.codigo)).toEqual(["NOVA"]);
});

it("busca código de canal/nome/código SCL, trata curinga literalmente, filtra situação e isola organização", async () => {
  await db.insert(reservas).values([linha("SCL-TESTE", { estado: "consulta", hospedeNome: "Pessoa Fictícia", codigoCanal: "HMFICTICIO" }), linha("SCL-OUTRA")]);
  const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra" }).returning();
  await db.insert(reservas).values(linha("SCL-SECRETA", { organizacaoId: outra }));
  for (const busca of ["scl-teste", "hmficticio", "Fictícia"]) expect((await listar({ busca })).total).toBe(1);
  expect((await listar({ busca: "%" })).total).toBe(0);
  expect((await listar({ situacao: "consulta" })).itens[0].codigo).toBe("SCL-TESTE");
  expect((await listar()).total).toBe(2);
  expect((await listarReservasPaginadas(db, org, lerFiltrosLista({}), { ...opcoes(), imovelIds: [] })).total).toBe(0);
});

it("conflito considera reserva fora da busca/página; consulta não ocupa calendário nem cria conflito", async () => {
  await db.insert(reservas).values([linha("A"), linha("B"), linha("C", { estado: "consulta" })]);
  expect((await listar({ busca: "A" })).itens[0].conflito).toBe(true);
  expect((await listar({ situacao: "consulta" })).itens[0].conflito).toBe(false);
  const periodo = { inicio: "2027-06-01", fim: "2027-07-01" };
  expect((await listarReservas(db, org, periodo)).map(r => r.codigo)).toEqual(["A", "B"]);
  expect((await listarReservas(db, org, { ...periodo, incluirConsultas: true })).length).toBe(3);
});

it("histórico da execução inclui canceladas e impede consultar execução de outra organização", async () => {
  const [r] = await db.insert(reservas).values(linha("CANCELADA", { estado: "cancelada" })).returning();
  const [e] = await db.insert(beds24Execucoes).values({ organizacaoId: org, situacao: "ok" }).returning();
  await db.insert(beds24ExecucaoReservas).values({ organizacaoId: org, execucaoId: e.id, reservaId: r.id, tipo: "cancelada" });
  expect((await listar({ execucao: e.id })).itens[0].codigo).toBe("CANCELADA");
  expect((await listar({ execucao: e.id, mudanca: "alterada" })).total).toBe(0);
  const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra" }).returning();
  expect(await resumoImportacao(db, outra, e.id)).toBeNull();
  expect((await listarReservasPaginadas(db, outra, lerFiltrosLista({ escopo: "historico", execucao: e.id }), opcoes())).total).toBe(0);
  expect((await listar({ execucao: "inválido" })).total).toBe(0);
});

it("links mantêm filtros e trocar filtro reinicia página", () => {
  const url = linkLista({ imovel: ["A", "B"], busca: "café", pagina: "8", escopo: "historico", ordem: "origem" }, { pagina: "2" });
  const p = new URL(url, "https://example.com").searchParams;
  expect(p.getAll("imovel")).toEqual(["A", "B"]); expect(p.get("busca")).toBe("café"); expect(p.get("pagina")).toBe("2");
  expect(linkLista({ pagina: "8" }, { situacao: "consulta" })).not.toContain("pagina");
});

it("filtro de pedidos de cancelamento (M8.2c): ?cancelamento=pedido mostra só as reservas com pedido esperando a equipe", async () => {
  const c = await montarCenario(db);
  const equipe = await usuarioDeTeste(c);
  const comPedido = await pagarEConfirmar(c);
  const semPedido = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23", email: "outro@example.com" });
  expect(await pedir(c, comPedido.reservaId, equipe, { recebidoEm: minutos(30), quando: minutos(40) })).toEqual({ ok: true });
  const filtros = (p: Record<string, string>) => lerFiltrosLista({ escopo: "historico", ...p });
  expect(filtros({ cancelamento: "pedido" }).cancelamento).toBe("pedido");
  expect(filtros({ cancelamento: "qualquer" }).cancelamento).toBe("todas");
  const listarDe = (p: Record<string, string>) => listarReservasPaginadas(db, c.org, filtros(p), { imovelIds: [c.imovel], periodo: { inicio: "2026-10-01", fim: "2026-11-01" }, agora: minutos(50) });
  expect((await listarDe({})).itens.map((r) => r.id).sort()).toEqual([comPedido.reservaId, semPedido.reservaId].sort());
  expect((await listarDe({ cancelamento: "pedido" })).itens.map((r) => r.id)).toEqual([comPedido.reservaId]);
  expect(linkLista({ cancelamento: "pedido" })).toBe("/painel/reservas?cancelamento=pedido");
  // Decidido o cancelamento, sai do filtro (não é mais um pedido esperando).
  await cancelar(c, comPedido.reservaId, entradaPadrao(), equipe, minutos(60));
  expect((await listarDe({ cancelamento: "pedido" })).itens).toEqual([]);
});
