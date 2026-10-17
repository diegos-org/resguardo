/**
 * Reserva paga do site no Beds24 (M8.3a) — a importação reconhece a reserva do site sem duplicar nem sobrescrever
 * (desenho 5.1 a 5.3; seção 10, testes 6 e 7). PGlite e a versão falsa do Beds24, sem rede.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { historicoDe } from "@/auditoria/auditoria";
import { gravarConfig } from "@/configuracoes/armazem";
import { criarContrato } from "@/contratos/repositorio";
import { beds24ReservasOperacoes, beds24ReservasSite, bloqueios, idsExternos, imoveis, organizacoes, proprietarioImoveis, proprietarios, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { listarLancamentos } from "@/financeiro/ledger";
import { RECUSA_RESERVA_DO_SITE, sincronizarReserva } from "@/reservas/repositorio";
import { paraDadosReserva } from "./converter";
import { Beds24Falso } from "./falso";
import { INFO_ENSAIO_SCL, INFO_MARCA_SCL, normalizarReserva } from "./normalizar";
import { painelReservasBeds24 } from "./reservas-site-painel";
import { assinaturaEsperado, chaveOperacaoBeds24, type EsperadoBeds24 } from "./reservas-site-regras";
import { sincronizarBeds24 } from "./sincronizacao";

let db: Db, close: () => Promise<void>, org: string, im: string, leitor: Beds24Falso;
const agora = new Date("2026-09-28T12:00:00Z");
const CODIGO = "SCL-7K2QXM";
const ESPERADO: EsperadoBeds24 = { quarto: "20", chegada: "2030-10-10", saida: "2030-10-13", hospedes: 2, situacao: "confirmada" };
/** Registro do Beds24 no formato da API (dados fictícios). */
const booking = (o: Record<string, unknown> = {}) => ({ id: 555, propertyId: 10, roomId: 20, status: "confirmed", arrival: "2030-10-10", departure: "2030-10-13", numAdult: 2, price: 1500, commission: 0, firstName: "Outra Pessoa Fictícia", email: "outra@example.com", channel: "Direct", ...o });
const comMarca = (codigo = CODIGO) => ({ infoItems: [{ code: INFO_MARCA_SCL, text: codigo }] });
/** O registro que o SCL criou para a reserva do site: com a marca dela. */
const nosso = (o: Record<string, unknown> = {}) => booking({ ...comMarca(), ...o });
const rodar = () => sincronizarBeds24(db, org, leitor, { agora });
const linhas = () => db.select().from(reservas).where(eq(reservas.organizacaoId, org));
const reserva = async (id: string) => (await db.select().from(reservas).where(eq(reservas.id, id)))[0];
const acompanhamentoDe = async (reservaId: string) => (await db.select().from(beds24ReservasSite).where(eq(beds24ReservasSite.reservaId, reservaId)))[0];
const operacoesDe = (reservaId: string) => db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.reservaId, reservaId));
const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000);

/** Reserva paga do site, com contato, valores e datas de confirmação (o que a importação nunca pode mexer). */
async function reservaDoSite(o: Partial<typeof reservas.$inferInsert> = {}) {
  const [r] = await db
    .insert(reservas)
    .values({
      organizacaoId: org, imovelId: im, codigo: CODIGO, origem: "site", fonte: "site", idFonte: "cotacao-ficticia", estado: "confirmada",
      checkin: ESPERADO.chegada, checkout: ESPERADO.saida, hospedes: 2, hospedeNome: "Hóspede Fictício", hospedeEmail: "hospede@example.com",
      valorBruto: 200000, taxaCanal: 8000, valorLiquido: 192000, confirmadaEm: new Date("2026-09-20T12:00:00Z"), reservadaEm: new Date("2026-09-20T11:00:00Z"),
      ...o,
    })
    .returning();
  return r;
}
async function acompanhar(reservaId: string, o: Partial<typeof beds24ReservasSite.$inferInsert> = {}) {
  const [a] = await db
    .insert(beds24ReservasSite)
    .values({ organizacaoId: org, reservaId, imovelId: im, propertyId: "10", roomId: "20", referencia: CODIGO, situacao: "conferida", versao: 1, esperado: ESPERADO, assinaturaEsperada: assinaturaEsperado(ESPERADO), otaFechadaEm: new Date("2026-09-20T12:10:00Z"), ...o })
    .returning();
  return a;
}
const operacao = (reservaId: string, acompanhamentoId: string | null, o: Partial<typeof beds24ReservasOperacoes.$inferInsert> = {}) =>
  db.insert(beds24ReservasOperacoes).values({ organizacaoId: org, reservaId, acompanhamentoId, tipo: "criar", chave: chaveOperacaoBeds24("criar", reservaId, 1), modo: "real", pedido: { ...ESPERADO, referencia: CODIGO }, ...o }).returning();

beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(async () => { await close(); });
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Organização de teste" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "T1", nome: "Imóvel fictício" }).returning();
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
  await db.transaction(tx => gravarConfig(tx, org, "beds24", { automatica: false, desde: "2026-09-01", diasCalendario: 2 }, null));
  // Com contrato, o motor geraria lançamentos se a importação chegasse a ela por `sincronizarReserva`.
  const [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dono fictício" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im });
  await criarContrato(db, org, im, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  leitor = new Beds24Falso(() => agora);
  leitor.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Quarto fictício" }] }];
  leitor.calendarios = [{ roomId: 20, calendar: [{ from: "2026-09-28", to: "2026-09-29", numAvail: 1, price1: 100 }] }];
});

describe("importação com a reserva paga do site (M8.3a, teste 6)", () => {
  it("as leituras pedem os info items (onde mora a marca)", async () => {
    await reservaDoSite({ beds24Id: "555" });
    leitor.bookings = [];
    await rodar();
    expect(leitor.filtrosLidos.length).toBeGreaterThanOrEqual(2);
    expect(leitor.filtrosLidos.every(f => f.incluirInfo === true)).toBe(true);
  });

  it("reserva do site com beds24_id não muda (origem, situação, datas de confirmação, valores, hóspede, e-mail; o motor não roda); a diferença vira divergente com aviso", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    await acompanhar(r.id);
    leitor.bookings = [nosso({ departure: "2030-10-14", price: 9999, numAdult: 5, email: "trocado@example.com" })];
    const res = await rodar();
    expect(res).toMatchObject({ ok: true, criadas: 0, atualizadas: 0, situacao: "parcial" });
    expect(res.divergencias.join(" ")).toContain(`Reserva ${CODIGO} (paga pelo site) está diferente no Beds24 (registro 555)`);
    expect(await reserva(r.id)).toEqual(r);
    expect(await linhas()).toHaveLength(1);
    expect(await listarLancamentos(db, org, { reservaId: r.id })).toEqual([]);
    expect(await acompanhamentoDe(r.id)).toMatchObject({
      situacao: "divergente", motivo: "mudada_no_beds24", otaFechadaEm: null, otaFechadaPor: null, lidoEm: agora,
      lido: { quarto: "20", chegada: "2030-10-10", saida: "2030-10-14", hospedes: 5, situacao: "confirmada" },
    });
    expect(JSON.stringify(res)).not.toMatch(/Outra Pessoa|outra@example|trocado@example/);
  });

  it("vale mesmo com o vínculo do imóvel trocado depois da criação: confere e não leva a reserva para o outro imóvel", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    await acompanhar(r.id, { conferidaEm: null });
    const [{ id: outro }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "T2", nome: "Outro imóvel fictício" }).returning();
    await db.update(idsExternos).set({ imovelId: outro }).where(eq(idsExternos.organizacaoId, org));
    leitor.bookings = [nosso()];
    const res = await rodar();
    expect(res).toMatchObject({ ok: true, criadas: 0, atualizadas: 0 });
    expect(await reserva(r.id)).toEqual(r);
    expect(await linhas()).toHaveLength(1);
    // Igual ao esperado, sem operação ativa e com o SCL igual ao esperado: a conferência bateu.
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "conferida", conferidaEm: agora, lido: { ...ESPERADO } });
  });

  it("igual ao esperado com o SCL mudado depois (outra intenção a enviar) ou com operação ativa: só a leitura, sem conferida_em", async () => {
    const r = await reservaDoSite({ beds24Id: "555", checkout: "2030-10-15" });
    const a = await acompanhar(r.id, { conferidaEm: null });
    leitor.bookings = [nosso()];
    await rodar();
    expect(await acompanhamentoDe(r.id)).toMatchObject({ conferidaEm: null, lidoEm: agora, situacao: "conferida" });
    await db.update(reservas).set({ checkout: ESPERADO.saida }).where(eq(reservas.id, r.id));
    await operacao(r.id, a.id, { tipo: "atualizar", chave: chaveOperacaoBeds24("atualizar", r.id, 2), situacao: "pendente" });
    await rodar();
    expect((await acompanhamentoDe(r.id)).conferidaEm).toBeNull();
  });

  it("com um envio a fazer, a diferença é esperada: só a leitura, sem divergente", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    const a = await acompanhar(r.id, { situacao: "pendente" });
    await operacao(r.id, a.id, { tipo: "atualizar", chave: chaveOperacaoBeds24("atualizar", r.id, 2), situacao: "pendente" });
    leitor.bookings = [nosso({ departure: "2030-10-12" })];
    const res = await rodar();
    expect(res.divergencias.join(" ")).not.toContain(CODIGO);
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "pendente", motivo: null, lido: { saida: "2030-10-12" } });
  });

  it("black não cancela a reserva paga nem vira bloqueio; cancelada e apagada no Beds24 viram divergente com o motivo certo", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    await acompanhar(r.id);
    leitor.bookings = [nosso({ status: "black" })];
    expect(await rodar()).toMatchObject({ ok: true, bloqueios: 0, criadas: 0, atualizadas: 0 });
    expect(await reserva(r.id)).toEqual(r);
    expect(await db.select().from(bloqueios).where(eq(bloqueios.organizacaoId, org))).toEqual([]);
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "divergente", motivo: "mudada_no_beds24", lido: { situacao: "bloqueio" } });

    leitor.bookings = [nosso({ status: "cancelled" })];
    const cancelada = await rodar();
    expect(cancelada.divergencias.join(" ")).toContain(`Reserva ${CODIGO} (paga pelo site) foi cancelada no Beds24 (registro 555), mas continua confirmada no SCL`);
    expect(await reserva(r.id)).toEqual(r);
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "divergente", motivo: "cancelada_no_beds24" });

    // O id não volta nem na releitura por id: apagado no Beds24. A reserva do SCL continua como estava.
    leitor.bookings = [];
    const apagada = await rodar();
    expect(apagada.divergencias.join(" ")).toContain(`Reserva ${CODIGO} (paga pelo site): o registro 555 não voltou na leitura do Beds24`);
    expect(await reserva(r.id)).toEqual(r);
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "divergente", motivo: "apagada_no_beds24", lido: null });
  });

  describe("o SCL mudou depois do esperado e o envio ainda não nasceu (chave desligada, pausa, antes da próxima volta)", () => {
    const FECHADA = new Date("2026-09-20T12:10:00Z");
    it("cancelada no SCL e a equipe cancelou no Beds24 (texto 6.2): só a leitura, sem divergente nem aviso; a marca das OTAs fica", async () => {
      const r = await reservaDoSite({ beds24Id: "555", estado: "cancelada" });
      await acompanhar(r.id);
      leitor.bookings = [nosso({ status: "cancelled" })];
      const res = await rodar();
      expect(res.divergencias.join(" ")).not.toContain(CODIGO);
      expect(await reserva(r.id)).toEqual(r);
      expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "conferida", motivo: null, otaFechadaEm: FECHADA, conferidaEm: null, lido: { situacao: "cancelada" } });
    });

    it("saída mudada no SCL e a mesma saída no Beds24: só a leitura", async () => {
      const r = await reservaDoSite({ beds24Id: "555", checkout: "2030-10-14" });
      await acompanhar(r.id);
      leitor.bookings = [nosso({ departure: "2030-10-14" })];
      const res = await rodar();
      expect(res.divergencias.join(" ")).not.toContain(CODIGO);
      expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "conferida", motivo: null, otaFechadaEm: FECHADA, conferidaEm: null, lido: { saida: "2030-10-14" } });
    });

    it("o Beds24 diferente também do que o SCL quer agora (cancelado, apagado ou outra saída): o alarme continua", async () => {
      const casos = [
        { bookings: [nosso({ status: "cancelled" })], motivo: "cancelada_no_beds24", texto: "foi cancelada no Beds24" },
        { bookings: [], motivo: "apagada_no_beds24", texto: "não voltou na leitura do Beds24" },
        { bookings: [nosso({ departure: "2030-10-16" })], motivo: "mudada_no_beds24", texto: "está diferente no Beds24" },
      ];
      for (const caso of casos) {
        await db.delete(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, org));
        await db.delete(reservas).where(eq(reservas.organizacaoId, org));
        const r = await reservaDoSite({ beds24Id: "555", checkout: "2030-10-14" });
        await acompanhar(r.id);
        leitor.bookings = caso.bookings;
        const res = await rodar();
        expect(res.divergencias.join(" ")).toContain(caso.texto);
        expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "divergente", motivo: caso.motivo, otaFechadaEm: null });
      }
    });
  });

  it("o registro ligado que volta em formato inválido não é \"apagado\": a conferência não conclui e nada muda no acompanhamento", async () => {
    // Situação desconhecida, saída igual à entrada, valor com vírgula: a normalização recusa (nas duas leituras).
    for (const ilegivel of [{ status: "weird" }, { departure: "2030-10-10" }, { price: "1,500.00" }]) {
      await db.delete(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, org));
      await db.delete(reservas).where(eq(reservas.organizacaoId, org));
      const r = await reservaDoSite({ beds24Id: "555" });
      const a = await acompanhar(r.id);
      leitor.bookings = [nosso(ilegivel)];
      const res = await rodar();
      expect(res.divergencias).toContain("Reserva 555: formato inválido; confira o registro no Beds24.");
      expect(res.divergencias).toContain(`Reserva ${CODIGO} (paga pelo site): o registro 555 voltou do Beds24 em formato inválido; a conferência não concluiu e nada mudou. Confira o registro no Beds24.`);
      expect(res.divergencias.join(" ")).not.toMatch(/apagado\?|não retornou na consulta/);
      expect(await acompanhamentoDe(r.id)).toEqual(a);
      expect(await reserva(r.id)).toEqual(r);
    }
    // Legível de novo e igual ao esperado: a conferência bate (nada ficou gravado como divergente).
    leitor.bookings = [nosso()];
    await rodar();
    const [r] = await linhas();
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "conferida", motivo: null, conferidaEm: agora, otaFechadaEm: new Date("2026-09-20T12:10:00Z") });
  });

  it("registro ilegível sem id na releitura por id: o lote fica sem conclusão, e o ligado não vira \"apagado\"", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    const a = await acompanhar(r.id);
    // A leitura do período não traz o 555; a releitura por id devolve um registro sem id legível.
    leitor.bookings = [];
    const original = leitor.reservas.bind(leitor);
    leitor.reservas = async (f) => (f.ids?.length ? { itens: [], divergencias: [{ origem: "reserva", id: "?", motivo: "sem id" }], lidoEm: agora.toISOString() } : original(f));
    try {
      const res = await rodar();
      expect(res.divergencias.join(" ")).toContain("Releitura por id: 1 registro(s) voltaram com um id que não foi pedido ou que não deu para ler");
      expect(res.divergencias).toContain(`Reserva ${CODIGO} (paga pelo site): o registro 555 não voltou na releitura do Beds24, e a resposta trouxe registro que não foi pedido ou que não deu para ler; a conferência não concluiu e nada mudou. Confira o registro no Beds24.`);
      expect(res.divergencias.join(" ")).not.toMatch(/não voltou na leitura do Beds24|não retornou na consulta/);
      expect(await acompanhamentoDe(r.id)).toEqual(a);
      expect(await reserva(r.id)).toEqual(r);
    } finally {
      leitor.reservas = original;
    }
    // Um registro legível de um id que não foi pedido (fora do período lido, então só a releitura o traz): a resposta também
    // não conclui nada sobre o 555.
    leitor.reservas = async (f) => (f.ids?.length ? original({ ...f, ids: ["777"] }) : original(f));
    leitor.bookings = [booking({ id: 777, arrival: "2026-08-01", departure: "2026-08-03", infoItems: [] })];
    try {
      const res = await rodar();
      expect(res.divergencias.join(" ")).toContain("Releitura por id: 1 registro(s) voltaram com um id que não foi pedido ou que não deu para ler");
      expect(res.divergencias).toContain(`Reserva ${CODIGO} (paga pelo site): o registro 555 não voltou na releitura do Beds24, e a resposta trouxe registro que não foi pedido ou que não deu para ler; a conferência não concluiu e nada mudou. Confira o registro no Beds24.`);
      expect(await acompanhamentoDe(r.id)).toEqual(a);
    } finally {
      leitor.reservas = original;
      leitor.bookings = [];
    }
    // Sem o registro ilegível, o mesmo 555 que não volta é conferido como apagado, como antes.
    await rodar();
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "divergente", motivo: "apagada_no_beds24", otaFechadaEm: null });
  });

  it("o registro de um id pedido num lote que volta noutro lote, legível ou não: a releitura toda fica sem conclusão, e o ligado não vira \"apagado\"", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    const a = await acompanhar(r.id);
    // 55 bloqueios conhecidos: a releitura vai em dois lotes, o 555 no primeiro.
    await db.insert(bloqueios).values(Array.from({ length: 55 }, (_, i) => ({ organizacaoId: org, imovelId: im, inicio: "2026-01-01", fim: "2026-01-02", fonte: "beds24", idFonte: `b${i}` })));
    leitor.bookings = [];
    const n = normalizarReserva(booking(comMarca()));
    if (!n.ok) throw new Error("registro de teste ilegível");
    const original = leitor.reservas.bind(leitor);
    for (const outroLote of [{ itens: [n.r], divergencias: [] }, { itens: [], divergencias: [{ origem: "reserva" as const, id: "555", motivo: "datas inválidas" }] }]) {
      leitor.reservas = async (f) => (!f.ids?.length ? original(f) : f.ids.includes("555") ? { itens: [], divergencias: [], lidoEm: agora.toISOString() } : { ...outroLote, lidoEm: agora.toISOString() });
      try {
        const res = await rodar();
        expect(leitor.filtrosLidos.length).toBeGreaterThan(0);
        expect(res.divergencias.join(" ")).toContain("Releitura por id: 1 registro(s) voltaram com um id que não foi pedido ou que não deu para ler; os registros que não voltaram legíveis ficam como estavam.");
        expect(res.divergencias).toContain(`Reserva ${CODIGO} (paga pelo site): o registro 555 não voltou na releitura do Beds24, e a resposta trouxe registro que não foi pedido ou que não deu para ler; a conferência não concluiu e nada mudou. Confira o registro no Beds24.`);
        expect(res.divergencias.join(" ")).not.toMatch(/não voltou na leitura do Beds24|não retornou na consulta/);
        expect(await acompanhamentoDe(r.id)).toEqual(a);
        expect(await reserva(r.id)).toEqual(r);
      } finally {
        leitor.reservas = original;
      }
    }
  });

  it("id repetido na leitura ou na releitura (legível duas vezes, legível e ilegível, ou em dois lotes): a importação para e nada muda", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    const a = await acompanhar(r.id, { conferidaEm: null });
    const lido = (b: Record<string, unknown>) => {
      const n = normalizarReserva(booking(b));
      if (!n.ok) throw new Error("registro de teste ilegível");
      return n.r;
    };
    const ilegivel = { origem: "reserva" as const, id: "555", motivo: "situação desconhecida: weird" };
    const original = leitor.reservas.bind(leitor);
    // Na releitura por id (a leitura do período não traz o 555): as duas ordens dariam conclusões opostas.
    for (const resposta of [
      { itens: [lido({ status: "cancelled", ...comMarca() }), lido(comMarca())], divergencias: [] },
      { itens: [lido(comMarca())], divergencias: [ilegivel] },
      { itens: [], divergencias: [ilegivel, ilegivel] },
    ]) {
      leitor.bookings = [];
      leitor.reservas = async (f) => (f.ids?.length ? { ...resposta, lidoEm: agora.toISOString() } : original(f));
      try {
        expect(await rodar()).toMatchObject({ ok: false, situacao: "erro", mensagem: expect.stringContaining("IDs de reserva repetidos") });
      } finally {
        leitor.reservas = original;
      }
      expect(await acompanhamentoDe(r.id)).toEqual(a);
      expect(await reserva(r.id)).toEqual(r);
    }
    // Em dois lotes da releitura (com 55 bloqueios conhecidos, o 555 vai no primeiro).
    await db.insert(bloqueios).values(Array.from({ length: 55 }, (_, i) => ({ organizacaoId: org, imovelId: im, inicio: "2026-01-01", fim: "2026-01-02", fonte: "beds24", idFonte: `b${i}` })));
    leitor.reservas = async (f) => (f.ids?.length ? { itens: [lido(comMarca())], divergencias: [], lidoEm: agora.toISOString() } : original(f));
    try {
      expect(await rodar()).toMatchObject({ ok: false, situacao: "erro", mensagem: expect.stringContaining("IDs de reserva repetidos") });
    } finally {
      leitor.reservas = original;
    }
    expect(await acompanhamentoDe(r.id)).toEqual(a);
    // Na leitura do período: o mesmo id legível e em formato inválido.
    leitor.bookings = [booking(comMarca()), booking({ status: "weird" })];
    expect(await rodar()).toMatchObject({ ok: false, situacao: "erro", mensagem: expect.stringContaining("IDs de reserva repetidos") });
    expect(await acompanhamentoDe(r.id)).toEqual(a);
    // Vários registros sem id legível não são o mesmo id: a importação segue.
    await db.delete(bloqueios).where(eq(bloqueios.organizacaoId, org));
    leitor.bookings = [booking({ id: "" }), booking({ id: "" })];
    const res = await rodar();
    expect(res.ok).toBe(true);
    expect(res.divergencias.filter(d => d === "Reserva não identificado: formato inválido; confira o registro no Beds24.")).toHaveLength(2);
  });

  it("o registro ligado sem a marca do SCL, ou com o código de outra reserva, nunca é conferido: divergente (marca ilegível ou mudada), e a marca das datas fechadas fica", async () => {
    const FECHADA = new Date("2026-09-20T12:10:00Z");
    const casos = [
      { registro: booking(), motivo: "marca_ilegivel", texto: `Reserva ${CODIGO} (paga pelo site): o registro 555 voltou do Beds24 sem a marca do SCL` },
      { registro: booking({ infoItems: [{ code: INFO_MARCA_SCL, text: "" }] }), motivo: "marca_ilegivel", texto: "voltou do Beds24 sem a marca do SCL" },
      { registro: booking({ notes: "Cópia de SCL-7K2QXM e SCL-ABCDEF" }), motivo: "marca_ilegivel", texto: "voltou do Beds24 sem a marca do SCL" },
      { registro: booking(comMarca("SCL-ABCDEF")), motivo: "mudada_no_beds24", texto: `Reserva ${CODIGO} (paga pelo site) está diferente no Beds24 (registro 555)` },
    ];
    for (const caso of casos) {
      await db.delete(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, org));
      await db.delete(reservas).where(eq(reservas.organizacaoId, org));
      const r = await reservaDoSite({ beds24Id: "555" });
      await acompanhar(r.id, { conferidaEm: null });
      leitor.bookings = [caso.registro];
      const res = await rodar();
      expect(res.divergencias.join(" ")).toContain(caso.texto);
      expect(await reserva(r.id)).toEqual(r);
      expect(await linhas()).toHaveLength(1);
      expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "divergente", motivo: caso.motivo, conferidaEm: null, otaFechadaEm: FECHADA, lido: { ...ESPERADO } });
      // Sem marca legível, o painel passa a mostrar a marca como não legível (as criações param, desenho 4.4).
      expect((await painelReservasBeds24(db, org, {} as NodeJS.ProcessEnv)).marca).toBe(caso.motivo === "marca_ilegivel" ? "ilegivel" : "nao_conferida");
    }
    await db.delete(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, org));
    await db.delete(reservas).where(eq(reservas.organizacaoId, org));
    const r = await reservaDoSite({ beds24Id: "555" });
    // Com um envio a fazer, a marca que falta não conclui nada (o trabalhador confere): só a leitura, sem conferida_em.
    const a = await acompanhar(r.id, { situacao: "pendente", conferidaEm: null });
    await operacao(r.id, a.id, { tipo: "atualizar", chave: chaveOperacaoBeds24("atualizar", r.id, 2), situacao: "pendente" });
    leitor.bookings = [booking()];
    await rodar();
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "pendente", motivo: null, conferidaEm: null, lido: { ...ESPERADO } });
    // Com a marca nas notas (o reforço), a marca é lida e a conferência bate.
    await db.delete(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.organizacaoId, org));
    await db.update(beds24ReservasSite).set({ situacao: "conferida" }).where(eq(beds24ReservasSite.id, a.id));
    leitor.bookings = [booking({ notes: `Reserva paga pelo site ${CODIGO}: não altere aqui, mude pelo SCL` })];
    await rodar();
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "conferida", conferidaEm: agora });
  });

  it("só as pessoas mudadas: divergente, mas a marca das datas fechadas fica", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    await acompanhar(r.id);
    leitor.bookings = [nosso({ numAdult: 3 })];
    await rodar();
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "divergente", motivo: "mudada_no_beds24", otaFechadaEm: new Date("2026-09-20T12:10:00Z") });
  });

  it("acompanhamento manual ou encerrado: só a leitura (a equipe cuida à mão); nunca sincroniza a reserva", async () => {
    for (const situacao of ["manual", "encerrada"] as const) {
      await db.delete(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, org));
      await db.delete(reservas).where(eq(reservas.organizacaoId, org));
      const r = await reservaDoSite({ beds24Id: "555" });
      await acompanhar(r.id, { situacao, motivo: situacao === "manual" ? "deixada_a_mao" : null });
      leitor.bookings = [nosso({ status: "cancelled" })];
      await rodar();
      expect(await reserva(r.id)).toEqual(r);
      expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao, lido: { situacao: "cancelada" } });
    }
  });

  it("operação com o beds24_id (antes da fase 3) é reconhecida: nada é criado nem sincronizado", async () => {
    const r = await reservaDoSite();
    const a = await acompanhar(r.id, { situacao: "em_envio", otaFechadaEm: null });
    await operacao(r.id, a.id, { situacao: "enviando", iniciadoEm: minutosAtras(11), enviadoEm: minutosAtras(11), beds24Id: "555" });
    leitor.bookings = [nosso()];
    expect(await rodar()).toMatchObject({ ok: true, criadas: 0, atualizadas: 0 });
    expect(await linhas()).toHaveLength(1);
    expect(await reserva(r.id)).toEqual(r);
    // Com o id gravado, a operação vencida não vira incerta (a releitura por id resolve, M8.3c); a leitura fica no acompanhamento.
    expect((await operacoesDe(r.id))[0]).toMatchObject({ situacao: "enviando", beds24Id: "555" });
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "em_envio", lido: { ...ESPERADO } });
  });

  it("marca casada pelas regras de adoção é adotada: o id vai para a reserva e para a operação (feita), sem segunda reserva", async () => {
    const r = await reservaDoSite();
    const a = await acompanhar(r.id, { situacao: "em_envio", otaFechadaEm: null });
    await operacao(r.id, a.id, { situacao: "incerta", enviadoEm: minutosAtras(20), iniciadoEm: minutosAtras(20) });
    leitor.bookings = [booking(comMarca())];
    const res = await rodar();
    expect(res).toMatchObject({ ok: true, criadas: 0, atualizadas: 0 });
    expect(await linhas()).toHaveLength(1);
    expect(await reserva(r.id)).toEqual({ ...r, beds24Id: "555" });
    expect((await operacoesDe(r.id))[0]).toMatchObject({ situacao: "feita", beds24Id: "555" });
    expect((await historicoDe(db, org, "reserva", r.id)).map(h => [h.acao, h.mudancas])).toEqual([["beds24.reserva.adotar", { beds24Id: [null, "555"] }]]);
    // Sem operação ativa e igual ao esperado: a conferência bateu. A situação e as marcas das OTAs ficam para o trabalhador (M8.3c).
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "em_envio", conferidaEm: agora, otaFechadaEm: null, lido: { ...ESPERADO } });
    // Na importação seguinte, o id já está na reserva: só confere.
    expect(await rodar()).toMatchObject({ criadas: 0, atualizadas: 0 });
    expect(await linhas()).toHaveLength(1);
  });

  it("com um registro ilegível na leitura (pode ser outra cópia com a marca), a adoção não conclui: aviso, e nada muda na reserva nem na operação", async () => {
    const r = await reservaDoSite();
    const a = await acompanhar(r.id, { situacao: "em_envio", otaFechadaEm: null });
    const [o] = await operacao(r.id, a.id, { situacao: "incerta", enviadoEm: minutosAtras(20), iniciadoEm: minutosAtras(20) });
    // O 556, com a mesma marca, volta com a saída igual à entrada: a normalização recusa.
    leitor.bookings = [booking(comMarca()), booking({ id: 556, departure: "2030-10-10", ...comMarca() })];
    const res = await rodar();
    expect(res).toMatchObject({ ok: true, criadas: 0, atualizadas: 0 });
    expect(res.divergencias).toContain(`Registro 555: marcado com ${CODIGO}, mas a leitura do Beds24 trouxe registro que não deu para ler ou que não foi pedido (pode ser outra cópia): a adoção não concluiu. Nada foi importado; confira no Beds24.`);
    expect(await linhas()).toHaveLength(1);
    expect(await reserva(r.id)).toEqual(r);
    expect(await operacoesDe(r.id)).toEqual([o]);
    expect(await acompanhamentoDe(r.id)).toEqual(a);
    expect(await historicoDe(db, org, "reserva", r.id)).toEqual([]);
    // Com a leitura limpa, a mesma marca é adotada.
    leitor.bookings = [booking(comMarca())];
    await rodar();
    expect(await reserva(r.id)).toEqual({ ...r, beds24Id: "555" });
  });

  it("um registro sem dono na releitura também barra a adoção, mesmo com todos os ids pedidos de volta (ilegível, ou outra cópia com a marca)", async () => {
    const r = await reservaDoSite();
    const a = await acompanhar(r.id, { situacao: "em_envio", otaFechadaEm: null });
    const [o] = await operacao(r.id, a.id, { situacao: "incerta", enviadoEm: minutosAtras(20), iniciadoEm: minutosAtras(20) });
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: im, inicio: "2026-01-01", fim: "2026-01-02", fonte: "beds24", idFonte: "900" });
    const lido = (b: Record<string, unknown>) => {
      const n = normalizarReserva(booking(b));
      if (!n.ok) throw new Error("registro de teste ilegível");
      return n.r;
    };
    leitor.bookings = [booking(comMarca())];
    const original = leitor.reservas.bind(leitor);
    for (const sobra of [{ itens: [], divergencias: [{ origem: "reserva" as const, id: "?", motivo: "sem id" }] }, { itens: [lido({ id: 556, ...comMarca() })], divergencias: [] }]) {
      leitor.reservas = async (f) => (f.ids?.length ? { itens: [lido({ id: 900, status: "black", arrival: "2026-01-01", departure: "2026-01-02" }), ...sobra.itens], divergencias: sobra.divergencias, lidoEm: agora.toISOString() } : original(f));
      try {
        const res = await rodar();
        expect(res.divergencias).toContain(`Registro 555: marcado com ${CODIGO}, mas a leitura do Beds24 trouxe registro que não deu para ler ou que não foi pedido (pode ser outra cópia): a adoção não concluiu. Nada foi importado; confira no Beds24.`);
      } finally {
        leitor.reservas = original;
      }
      expect(await reserva(r.id)).toEqual(r);
      expect(await operacoesDe(r.id)).toEqual([o]);
      expect(await acompanhamentoDe(r.id)).toEqual(a);
    }
  });

  it("um registro ilegível que não tem nada a ver não esconde os avisos mais certos: sem acompanhamento e duplicada continuam com o texto deles", async () => {
    const r = await reservaDoSite();
    leitor.bookings = [booking({ notes: `Reserva ${CODIGO}` }), booking({ id: 777, status: "weird" })];
    const sem = await rodar();
    expect(sem.divergencias).toContain(`Registro 555: marcado com ${CODIGO}, reserva do site que o sistema não enviou ao Beds24. Nada foi importado; confira no Beds24.`);
    expect(sem.divergencias.join(" ")).not.toContain("a adoção não concluiu");
    // Já ligada ao 555, outra cópia com a marca é duplicada, com ou sem registro ilegível na leitura.
    await db.update(reservas).set({ beds24Id: "555" }).where(eq(reservas.id, r.id));
    await acompanhar(r.id);
    leitor.bookings = [nosso(), booking({ id: 556, ...comMarca() }), booking({ id: 777, status: "weird" })];
    const dup = await rodar();
    expect(dup.divergencias).toContain(`Registro 556: reserva duplicada no Beds24 para ${CODIGO}. Nada foi importado; confira no Beds24.`);
    expect(dup.divergencias.join(" ")).not.toContain("a adoção não concluiu");
  });

  it("o ligado ilegível na leitura do período e legível na releitura não é conferido (qual cópia vale?); o mesmo id legível nas duas leituras para a importação", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    const a = await acompanhar(r.id, { conferidaEm: null });
    const lido = (b: Record<string, unknown>) => {
      const n = normalizarReserva(booking(b));
      if (!n.ok) throw new Error("registro de teste ilegível");
      return n.r;
    };
    const original = leitor.reservas.bind(leitor);
    // Ilegível no período; na releitura, legível (cancelado ou igual ao esperado): nada muda.
    for (const copia of [{ status: "cancelled" }, {}]) {
      leitor.bookings = [booking({ status: "weird" })];
      leitor.reservas = async (f) => (f.ids?.length ? { itens: [lido({ ...comMarca(), ...copia })], divergencias: [], lidoEm: agora.toISOString() } : original(f));
      try {
        const res = await rodar();
        expect(res.divergencias).toContain(`Reserva ${CODIGO} (paga pelo site): o registro 555 voltou do Beds24 em formato inválido; a conferência não concluiu e nada mudou. Confira o registro no Beds24.`);
      } finally {
        leitor.reservas = original;
      }
      expect(await acompanhamentoDe(r.id)).toEqual(a);
      expect(await reserva(r.id)).toEqual(r);
    }
    // Legível no período e de novo, sem ser pedido, na releitura (por causa de outro id conhecido): as duas ordens dariam
    // conclusões opostas; a importação para.
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: im, inicio: "2026-01-01", fim: "2026-01-02", fonte: "beds24", idFonte: "900" });
    for (const [doPeriodo, daReleitura] of [[{}, { status: "cancelled" }], [{ status: "cancelled" }, {}]]) {
      leitor.bookings = [nosso(doPeriodo)];
      leitor.reservas = async (f) => (f.ids?.length ? { itens: [lido({ ...comMarca(), ...daReleitura })], divergencias: [], lidoEm: agora.toISOString() } : original(f));
      try {
        expect(await rodar()).toMatchObject({ ok: false, situacao: "erro", mensagem: expect.stringContaining("IDs de reserva repetidos") });
      } finally {
        leitor.reservas = original;
      }
      expect(await acompanhamentoDe(r.id)).toEqual(a);
    }
  });

  it("marca sem correspondência, duplicada ou num registro que não bate vira aviso; nada é criado", async () => {
    leitor.bookings = [booking(comMarca("SCL-ABCDEF"))];
    const sem = await rodar();
    expect(sem.divergencias).toContain("Registro 555: marcado pelo SCL (SCL-ABCDEF) sem reserva correspondente. Nada foi importado.");
    expect(await linhas()).toHaveLength(0);

    const r = await reservaDoSite();
    const a = await acompanhar(r.id, { situacao: "em_envio", otaFechadaEm: null });
    await operacao(r.id, a.id, { situacao: "incerta", enviadoEm: minutosAtras(20) });
    leitor.bookings = [booking(comMarca()), booking({ id: 556, ...comMarca() })];
    const duplicada = await rodar();
    expect(duplicada.divergencias.filter(d => d.includes("duplicada"))).toEqual([`Registro 555: reserva duplicada no Beds24 para ${CODIGO}. Nada foi importado; confira no Beds24.`]);
    expect(await linhas()).toHaveLength(1);
    expect((await reserva(r.id)).beds24Id).toBeNull();
    expect((await operacoesDe(r.id))[0]).toMatchObject({ situacao: "incerta", beds24Id: null });

    // Um registro só com a marca, mas em outras datas (ou cancelado): não bate com a reserva do site.
    for (const outro of [booking({ ...comMarca(), departure: "2030-10-15" }), booking({ ...comMarca(), status: "cancelled" })]) {
      leitor.bookings = [outro];
      const inesperada = await rodar();
      expect(inesperada.divergencias).toContain(`Registro 555: a marca ${CODIGO} está num registro que não bate com a reserva do site (quarto, datas ou situação). Nada foi importado; confira no Beds24.`);
      expect(await linhas()).toHaveLength(1);
    }
  });

  it("a marca de uma reserva do site que o sistema não enviou (sem acompanhamento) não cria nada; um bloqueio com o código no nome (a equipe fechando as datas à mão) continua virando bloqueio", async () => {
    await reservaDoSite();
    leitor.bookings = [booking({ lastName: `Site ${CODIGO}` })];
    const r = await rodar();
    expect(r.divergencias).toContain(`Registro 555: marcado com ${CODIGO}, reserva do site que o sistema não enviou ao Beds24. Nada foi importado; confira no Beds24.`);
    expect(await linhas()).toHaveLength(1);
    leitor.bookings = [booking({ status: "black", lastName: `Fechado ${CODIGO}` })];
    expect(await rodar()).toMatchObject({ bloqueios: 1, criadas: 0 });
    expect(await db.select().from(bloqueios).where(eq(bloqueios.organizacaoId, org))).toHaveLength(1);
  });

  describe("o registro com o código que o SCL já conhece segue o caminho normal (c e d não o prendem)", () => {
    const bloqueiosDaOrg = () => db.select().from(bloqueios).where(eq(bloqueios.organizacaoId, org));
    const remocoes = async () => (await historicoDe(db, org, "imovel", im)).filter(h => h.acao === "bloqueio.remover");

    it("o bloqueio com o código, cancelado no Beds24 (texto 6.2), sai do SCL com a remoção no histórico: sem acompanhamento e com acompanhamento noutro id", async () => {
      for (const comAcompanhamento of [false, true]) {
        await db.delete(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, org));
        await db.delete(reservas).where(eq(reservas.organizacaoId, org));
        const r = await reservaDoSite(comAcompanhamento ? { beds24Id: "777" } : {});
        if (comAcompanhamento) await acompanhar(r.id);
        const daReserva = comAcompanhamento ? [booking({ id: 777, ...comMarca() })] : [];
        leitor.bookings = [booking({ status: "black", lastName: `Fechado ${CODIGO}` }), ...daReserva];
        expect(await rodar()).toMatchObject({ bloqueios: 1, criadas: 0 });
        expect(await bloqueiosDaOrg()).toHaveLength(1);
        const antes = (await remocoes()).length;
        leitor.bookings = [booking({ status: "cancelled", lastName: `Fechado ${CODIGO}` }), ...daReserva];
        const res = await rodar();
        expect(res).toMatchObject({ ok: true, criadas: 0 });
        expect(res.divergencias.join(" ")).not.toMatch(/marcado com|não bate|sem reserva correspondente/);
        expect(await bloqueiosDaOrg()).toEqual([]);
        expect((await remocoes()).length).toBe(antes + 1);
        expect(await linhas()).toHaveLength(1);
        expect(await reserva(r.id)).toEqual(r);
      }
    });

    it("a reserva de OTA já importada que ganha um código na nota e é cancelada fica cancelada no SCL (sem reserva do site, e com uma sem acompanhamento)", async () => {
      await reservaDoSite();
      for (const [id, codigo] of [[601, "SCL-AAAAAA"], [602, CODIGO]] as const) {
        const ota = { id, channel: "Airbnb", apiReference: `HMFICT${id}`, arrival: "2030-11-10", departure: "2030-11-12" };
        leitor.bookings = [booking(ota)];
        expect(await rodar()).toMatchObject({ criadas: 1 });
        leitor.bookings = [booking({ ...ota, status: "cancelled", notes: `ver ${codigo}` })];
        const res = await rodar();
        expect(res).toMatchObject({ ok: true, criadas: 0, atualizadas: 1 });
        expect(res.divergencias.join(" ")).not.toMatch(/marcado|sem reserva correspondente/);
        expect((await linhas()).find(l => l.beds24Id === String(id))).toMatchObject({ fonte: "beds24", estado: "cancelada" });
      }
    });

    it("o bloqueio importado que volta como reserva com o código continua desviado: nada é criado e o bloqueio fica (avisar em vez de duplicar no financeiro)", async () => {
      await reservaDoSite();
      leitor.bookings = [booking({ status: "black", lastName: `Fechado ${CODIGO}` })];
      expect(await rodar()).toMatchObject({ bloqueios: 1 });
      leitor.bookings = [booking({ status: "confirmed", lastName: `Fechado ${CODIGO}` })];
      const res = await rodar();
      expect(res).toMatchObject({ criadas: 0, atualizadas: 0 });
      expect(res.divergencias).toContain(`Registro 555: marcado com ${CODIGO}, reserva do site que o sistema não enviou ao Beds24. Nada foi importado; confira no Beds24.`);
      expect(await linhas()).toHaveLength(1);
      expect(await bloqueiosDaOrg()).toHaveLength(1);
    });
  });

  it("o ensaio é pulado: pela marca SCL-ENSAIO ou pelo id gravado na operação do ensaio (sem a marca legível)", async () => {
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: org, tipo: "ensaio", chave: "ensaio:a", modo: "real", situacao: "conferida", beds24Id: "556" });
    leitor.bookings = [booking({ infoItems: [{ code: INFO_ENSAIO_SCL, text: "00000000-0000-4000-8000-000000000000" }] }), booking({ id: 556 })];
    const r = await rodar();
    expect(r).toMatchObject({ criadas: 0, bloqueios: 0 });
    expect(r.divergencias).toEqual(expect.arrayContaining(["Registro 555: ensaio do SCL; não importado.", "Registro 556: ensaio do SCL; não importado."]));
    expect(await linhas()).toHaveLength(0);
  });

  describe("registro sem marca sobre uma criação não resolvida é pulado (nunca cria)", () => {
    const prepara = async (o: { situacao?: "em_envio" | "aguardando_equipe"; motivo?: "incerta"; operacao?: Partial<typeof beds24ReservasOperacoes.$inferInsert> | null }) => {
      const r = await reservaDoSite();
      const a = await acompanhar(r.id, { situacao: o.situacao ?? "em_envio", motivo: o.motivo ?? null, otaFechadaEm: null });
      if (o.operacao) await operacao(r.id, a.id, o.operacao);
      // O registro de outra fonte (sem a marca legível) no mesmo quarto, com noites sobrepostas.
      leitor.bookings = [booking({ arrival: "2030-10-11", departure: "2030-10-14", channel: "Airbnb", apiReference: "HMFICT" })];
      return r;
    };
    const aviso = `Registro 555: aguardando a conferência de um envio de reserva do site (${CODIGO}); não importado.`;

    it("criar em enviando há 11 min, sem o POST: pula e a operação fica como está", async () => {
      const r = await prepara({ operacao: { situacao: "enviando", iniciadoEm: minutosAtras(11) } });
      const res = await rodar();
      expect(res).toMatchObject({ ok: true, criadas: 0 });
      expect(res.divergencias).toContain(aviso);
      expect(await linhas()).toHaveLength(1);
      expect((await operacoesDe(r.id))[0]).toMatchObject({ situacao: "enviando" });
    });

    it("criar em enviando há 11 min, com o POST tentado e sem id: vira incerta (já com a trava) e pula", async () => {
      const r = await prepara({ operacao: { situacao: "enviando", iniciadoEm: minutosAtras(11), enviadoEm: minutosAtras(11) } });
      expect((await rodar()).divergencias).toContain(aviso);
      expect(await linhas()).toHaveLength(1);
      expect((await operacoesDe(r.id))[0]).toMatchObject({ situacao: "incerta", beds24Id: null });
    });

    it("operação incerta: pula", async () => {
      await prepara({ operacao: { situacao: "incerta", iniciadoEm: minutosAtras(30), enviadoEm: minutosAtras(30) } });
      expect((await rodar()).divergencias).toContain(aviso);
      expect(await linhas()).toHaveLength(1);
    });

    it("acompanhamento aguardando_equipe com motivo incerta (sem operação ativa): pula", async () => {
      await prepara({ situacao: "aguardando_equipe", motivo: "incerta", operacao: null });
      expect((await rodar()).divergencias).toContain(aviso);
      expect(await linhas()).toHaveLength(1);
    });

    it("noites que não se sobrepõem e o registro que o SCL já conhece seguem a importação normal", async () => {
      await prepara({ operacao: { situacao: "incerta", enviadoEm: minutosAtras(30) } });
      leitor.bookings = [booking({ arrival: "2030-10-13", departure: "2030-10-15", channel: "Airbnb", apiReference: "HMFICT" })];
      expect(await rodar()).toMatchObject({ criadas: 1 });
      // Já importado: a mudança nele (agora sobre as noites da criação) atualiza, sem criar nada.
      leitor.bookings = [booking({ arrival: "2030-10-12", departure: "2030-10-15", channel: "Airbnb", apiReference: "HMFICT" })];
      expect(await rodar()).toMatchObject({ criadas: 0, atualizadas: 1 });
      expect(await linhas()).toHaveLength(2);
    });
  });

  it("operação de reserva do site enviando na janela (6 min, relógio do banco): ocupada, com a causa certa e sem ler o Beds24", async () => {
    const r = await reservaDoSite();
    const a = await acompanhar(r.id, { situacao: "em_envio", otaFechadaEm: null });
    const [op] = await operacao(r.id, a.id, { situacao: "enviando" });
    leitor.bookings = [booking({ id: 777, arrival: "2030-11-10", departure: "2030-11-12" })];
    const ocupada = await rodar();
    expect(ocupada).toMatchObject({ ok: false, situacao: "ocupada", mensagem: "Há um envio de reserva do site ao Beds24 em andamento. Aguarde alguns minutos e tente de novo.", causa: "envio de reserva do site ao Beds24 em andamento" });
    expect(leitor.chamadas).toBe(0);
    await db.update(beds24ReservasOperacoes).set({ iniciadoEm: minutosAtras(7) }).where(eq(beds24ReservasOperacoes.id, op.id));
    expect(await rodar()).toMatchObject({ ok: true, criadas: 1 });
  });
});

describe("sincronizarReserva nunca muda reserva do site (M8.3a, teste 7)", () => {
  const dados = (o: Record<string, unknown> = {}) => {
    const n = normalizarReserva(booking(o));
    if (!n.ok) throw new Error("fixture inválida");
    return paraDadosReserva(n.r, im)!;
  };

  it("fonte beds24 pelo id ligado, inclusive o ramo do black (cancelar): recusa com a mensagem certa, nada muda", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    expect(await sincronizarReserva(db, org, "beds24", "555", dados({ departure: "2030-10-20" }))).toEqual({ ok: false, erros: { geral: RECUSA_RESERVA_DO_SITE } });
    expect(await sincronizarReserva(db, org, "beds24", "555", { ...r, estado: "cancelada" })).toEqual({ ok: false, erros: { geral: "Reserva do site: os dados vêm do SCL; a diferença no Beds24 vira aviso." } });
    expect(await reserva(r.id)).toEqual(r);
    expect(await listarLancamentos(db, org, { reservaId: r.id })).toEqual([]);
  });

  it("planilha (csv) nunca encontra a reserva do site: cria a própria linha e não a toca", async () => {
    // A busca da planilha só olha linhas `fonte = 'csv'` com o mesmo id e candidatas csv/beds24 com origem airbnb/booking:
    // a reserva do site (`fonte = 'site'`, origem `site`) nunca é encontrada. Este caso protege essa garantia (ele passaria
    // também antes do M8.3a); a metade csv da recusa em `sincronizarReserva` é defensiva, para o dia em que a busca mudar.
    const r = await reservaDoSite({ beds24Id: "555", codigoCanal: "HMFICT" });
    const s = await sincronizarReserva(db, org, "csv", "airbnb:HMFICT", dados({ departure: "2030-10-20", channel: "Airbnb", apiReference: "HMFICT" }));
    expect(s).toMatchObject({ ok: true, criada: true });
    expect(await reserva(r.id)).toEqual(r);
    expect(await listarLancamentos(db, org, { reservaId: r.id })).toEqual([]);
    const todas = await linhas();
    expect(todas).toHaveLength(2);
    expect(todas.find(l => l.id !== r.id)).toMatchObject({ fonte: "csv", origem: "airbnb", idFonte: "airbnb:HMFICT" });
  });

  it("a confirmação do próprio site (fonte site) continua passando", async () => {
    const r = await reservaDoSite({ estado: "pedido", confirmadaEm: null });
    const s = await sincronizarReserva(db, org, "site", r.idFonte, { ...r, estado: "confirmada" });
    expect(s).toMatchObject({ ok: true, alterada: true });
    expect((await db.select({ estado: reservas.estado }).from(reservas).where(and(eq(reservas.id, r.id))))[0].estado).toBe("confirmada");
  });
});
