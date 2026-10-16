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
import { assinaturaEsperado, chaveOperacaoBeds24, type EsperadoBeds24 } from "./reservas-site-regras";
import { sincronizarBeds24 } from "./sincronizacao";

let db: Db, close: () => Promise<void>, org: string, im: string, leitor: Beds24Falso;
const agora = new Date("2026-09-28T12:00:00Z");
const CODIGO = "SCL-7K2QXM";
const ESPERADO: EsperadoBeds24 = { quarto: "20", chegada: "2030-10-10", saida: "2030-10-13", hospedes: 2, situacao: "confirmada" };
/** Registro do Beds24 no formato da API (dados fictícios). */
const booking = (o: Record<string, unknown> = {}) => ({ id: 555, propertyId: 10, roomId: 20, status: "confirmed", arrival: "2030-10-10", departure: "2030-10-13", numAdult: 2, price: 1500, commission: 0, firstName: "Outra Pessoa Fictícia", email: "outra@example.com", channel: "Direct", ...o });
const comMarca = (codigo = CODIGO) => ({ infoItems: [{ code: INFO_MARCA_SCL, text: codigo }] });
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
    leitor.bookings = [booking({ departure: "2030-10-14", price: 9999, numAdult: 5, email: "trocado@example.com" })];
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
    leitor.bookings = [booking()];
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
    leitor.bookings = [booking()];
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
    leitor.bookings = [booking({ departure: "2030-10-12" })];
    const res = await rodar();
    expect(res.divergencias.join(" ")).not.toContain(CODIGO);
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "pendente", motivo: null, lido: { saida: "2030-10-12" } });
  });

  it("black não cancela a reserva paga nem vira bloqueio; cancelada e apagada no Beds24 viram divergente com o motivo certo", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    await acompanhar(r.id);
    leitor.bookings = [booking({ status: "black" })];
    expect(await rodar()).toMatchObject({ ok: true, bloqueios: 0, criadas: 0, atualizadas: 0 });
    expect(await reserva(r.id)).toEqual(r);
    expect(await db.select().from(bloqueios).where(eq(bloqueios.organizacaoId, org))).toEqual([]);
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "divergente", motivo: "mudada_no_beds24", lido: { situacao: "bloqueio" } });

    leitor.bookings = [booking({ status: "cancelled" })];
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

  it("só as pessoas mudadas: divergente, mas a marca das datas fechadas fica", async () => {
    const r = await reservaDoSite({ beds24Id: "555" });
    await acompanhar(r.id);
    leitor.bookings = [booking({ numAdult: 3 })];
    await rodar();
    expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao: "divergente", motivo: "mudada_no_beds24", otaFechadaEm: new Date("2026-09-20T12:10:00Z") });
  });

  it("acompanhamento manual ou encerrado: só a leitura (a equipe cuida à mão); nunca sincroniza a reserva", async () => {
    for (const situacao of ["manual", "encerrada"] as const) {
      await db.delete(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, org));
      await db.delete(reservas).where(eq(reservas.organizacaoId, org));
      const r = await reservaDoSite({ beds24Id: "555" });
      await acompanhar(r.id, { situacao, motivo: situacao === "manual" ? "deixada_a_mao" : null });
      leitor.bookings = [booking({ status: "cancelled" })];
      await rodar();
      expect(await reserva(r.id)).toEqual(r);
      expect(await acompanhamentoDe(r.id)).toMatchObject({ situacao, lido: { situacao: "cancelada" } });
    }
  });

  it("operação com o beds24_id (antes da fase 3) é reconhecida: nada é criado nem sincronizado", async () => {
    const r = await reservaDoSite();
    const a = await acompanhar(r.id, { situacao: "em_envio", otaFechadaEm: null });
    await operacao(r.id, a.id, { situacao: "enviando", iniciadoEm: minutosAtras(11), enviadoEm: minutosAtras(11), beds24Id: "555" });
    leitor.bookings = [booking()];
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

  it("planilha (csv) com a mesma identidade da reserva do site não a altera", async () => {
    const r = await reservaDoSite({ beds24Id: "555", codigoCanal: "HMFICT" });
    await sincronizarReserva(db, org, "csv", r.idFonte, dados({ departure: "2030-10-20", channel: "Airbnb", apiReference: "HMFICT" }));
    expect(await reserva(r.id)).toEqual(r);
  });

  it("a confirmação do próprio site (fonte site) continua passando", async () => {
    const r = await reservaDoSite({ estado: "pedido", confirmadaEm: null });
    const s = await sincronizarReserva(db, org, "site", r.idFonte, { ...r, estado: "confirmada" });
    expect(s).toMatchObject({ ok: true, alterada: true });
    expect((await db.select({ estado: reservas.estado }).from(reservas).where(and(eq(reservas.id, r.id))))[0].estado).toBe("confirmada");
  });
});
