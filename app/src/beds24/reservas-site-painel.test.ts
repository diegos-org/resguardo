/**
 * O que o painel mostra das reservas do site no Beds24 (M8.3a, desenho 2.4, 7 e 8; seção 10, teste 12): o bloco da ficha
 * (o "desligada" calculado, o acompanhamento, o histórico curto), a seção de Integrações (chave, ambiente, credencial,
 * prontidão sem rede, pausa, imóveis ligados, contadores) e a leitura dos escopos, que só acontece no deploy de produção
 * com a escrita pronta. PGlite e a versão falsa do Beds24; nenhum `fetch`.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { gravarConfig } from "@/configuracoes/armazem";
import { beds24ReservasOperacoes, beds24ReservasSite, cotacoes, idsExternos, imoveis, organizacoes, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { Beds24Falso } from "./falso";
import { ClienteBeds24Http, impressaoCredencialBeds24, leitorDeCredencialDoAmbiente } from "./http";
import { motivosDesligada } from "./reservas-site-config";
import { conferirEscoposReservasBeds24, fichaReservaNoBeds24, OPERACOES_NA_FICHA, painelReservasBeds24 } from "./reservas-site-painel";
import { chaveEnsaioBeds24, chaveSimulacaoBeds24 } from "./reservas-site-regras";
import { ErroBeds24 } from "./tipos";

const env = (o: Record<string, string | undefined> = {}) => o as unknown as NodeJS.ProcessEnv;
const PRONTO = { VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" };
/** Um instante fixo antes das estadias do teste (as tarefas das OTAs cortam pela data de hoje). */
const AGORA = new Date("2026-10-16T15:00:00Z");

let db: Db, close: () => Promise<void>, org: string, im: string, im2: string, reservaId: string, codigo: string, admin: string;
let espiao: ReturnType<typeof vi.spyOn>;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  espiao = vi.spyOn(globalThis, "fetch");
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "T1", nome: "Imóvel fictício" }).returning();
  [{ id: im2 }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "T2", nome: "Outro imóvel fictício" }).returning();
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
  codigo = "SCL-7K2QXM";
  [{ id: reservaId }] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo, origem: "site", fonte: "site", checkin: "2026-12-20", checkout: "2026-12-27", hospedes: 4 }).returning();
  [{ id: admin }] = await db.insert(usuarios).values({ organizacaoId: org, email: `admin.${crypto.randomUUID().slice(0, 8)}@example.com`, nome: "Admin Fictício", papel: "admin" }).returning();
});
afterEach(() => {
  expect(espiao).not.toHaveBeenCalled();
  espiao.mockRestore();
});

describe("o \"desligada\" é calculado (nunca gravado)", () => {
  it("nos testes e nas prévias, sempre desligada pelo ambiente; no deploy de produção pronto, só a pausa, o imóvel e a linha contam", () => {
    expect(motivosDesligada(env(), { pausada: false, imovelLigado: true, comAcompanhamento: true })).toEqual(["ambiente", "chave", "credencial"]);
    expect(motivosDesligada(env({ ...PRONTO, VERCEL_ENV: "preview" }), { pausada: false, imovelLigado: true, comAcompanhamento: true })).toEqual(["ambiente"]);
    expect(motivosDesligada(env(PRONTO), { pausada: false, imovelLigado: true, comAcompanhamento: true })).toEqual([]);
    expect(motivosDesligada(env(PRONTO), { pausada: true, imovelLigado: false, comAcompanhamento: false })).toEqual(["pausa", "imovel", "sem_acompanhamento"]);
  });
});

describe("ficha da reserva", () => {
  it("sem acompanhamento: desligada, sem histórico; simular só fora da produção ou com a chave desligada; a tarefa das OTAs dela (M8.3b)", async () => {
    const f = await fichaReservaNoBeds24(db, org, reservaId, env(), AGORA);
    // Confirmada do site sem pagamento pelo site (a D3): fechar as datas à mão, com a marca (a mesma tarefa do Início).
    const tarefa = { reservaId, codigo, caso: "d3", estado: "manual", checkin: "2026-12-20", checkout: "2026-12-27", desde: new Date(0), alteracaoIds: [], texto: expect.stringContaining("Feche as datas no Beds24 como bloqueio"), marca: "datas_fechadas" };
    expect(f).toEqual({ desligada: ["ambiente", "chave", "credencial", "imovel", "sem_acompanhamento"], beds24Id: null, acompanhamento: null, operacoes: [], simular: true, pedido: null, tarefas: [tarefa], atencoes: [] });
    // Outra reserva não entra na ficha desta.
    await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-OUTRA1", origem: "site", fonte: "site", checkin: "2026-12-01", checkout: "2026-12-03", hospedes: 2 });
    expect((await fichaReservaNoBeds24(db, org, reservaId, env(), AGORA))?.tarefas.map((t) => t.codigo)).toEqual([codigo]);
    expect((await fichaReservaNoBeds24(db, org, reservaId, env(PRONTO)))?.simular).toBe(false);
    expect((await fichaReservaNoBeds24(db, org, reservaId, env({ ...PRONTO, BEDS24_ESCRITA_RESERVAS: undefined })))?.simular).toBe(true);
  });

  it("com acompanhamento e operações: os códigos da situação, do motivo e da leitura, e o histórico da mais nova para a mais velha (até 10)", async () => {
    await db.update(reservas).set({ beds24Id: "98765" }).where(eq(reservas.id, reservaId));
    await gravarConfig(db, org, "reservas_beds24", { pausado: { em: "2026-10-16T12:00:00.000Z", por: admin }, imoveis: [{ imovelId: im, ligadoEm: "2026-10-01T00:00:00.000Z", ligadoPor: admin }], ensaio: null }, admin);
    const lido = { quarto: "20", chegada: "2026-12-20", saida: "2026-12-28", hospedes: 4, situacao: "confirmada" as const };
    await db.insert(beds24ReservasSite).values({ organizacaoId: org, reservaId, imovelId: im, propertyId: "10", roomId: "20", referencia: codigo, situacao: "divergente", motivo: "mudada_no_beds24", lido, lidoEm: new Date("2026-10-16T09:00:00Z"), otaFechadaEm: new Date("2026-10-02T12:00:00Z"), otaFechadaPor: admin });
    const pedido = { quarto: "20", chegada: "2026-12-20", saida: "2026-12-27", hospedes: 4, situacao: "confirmada" as const, referencia: codigo };
    for (let i = 0; i < 12; i++) {
      await db.insert(beds24ReservasOperacoes).values({ organizacaoId: org, reservaId, tipo: "criar", chave: chaveSimulacaoBeds24(reservaId, "criar", `a${i}`, null), modo: "simulacao", situacao: "simulada", pedido, iniciadoEm: new Date(Date.UTC(2026, 9, 1 + i)) });
    }
    const f = await fichaReservaNoBeds24(db, org, reservaId, env());
    expect(f?.desligada).toEqual(["ambiente", "chave", "credencial", "pausa"]);
    expect(f?.beds24Id).toBe("98765");
    expect(f?.acompanhamento).toMatchObject({ situacao: "divergente", motivo: "mudada_no_beds24", quarto: "20", conferidaEm: null, lido, otaFechadaAMao: true });
    expect(f?.operacoes).toHaveLength(OPERACOES_NA_FICHA);
    expect(f?.operacoes[0]).toMatchObject({ tipo: "criar", modo: "simulacao", situacao: "simulada", pedido, iniciadoEm: new Date(Date.UTC(2026, 9, 12)) });
  });

  it("o pedido do site (D9): segurado enquanto é pedido; vencido só com a cotação expirada (nunca confirmado); cancelada depois de confirmada, nada", async () => {
    await db.update(reservas).set({ estado: "pedido" }).where(eq(reservas.id, reservaId));
    expect((await fichaReservaNoBeds24(db, org, reservaId, env()))?.pedido).toBe("segurado");
    await db.update(reservas).set({ estado: "cancelada" }).where(eq(reservas.id, reservaId));
    const cotacao = { organizacaoId: org, imovelId: im, codigo: "COT-FICT0001", checkin: "2026-12-20", checkout: "2026-12-27", hospedes: 4, noites: 7, situacao: "disponivel", diarias: 1, limpeza: 0, hospedeExtra: 0, valorCheio: 1, total: 1, reservaId };
    const [cot] = await db.insert(cotacoes).values({ ...cotacao, estado: "cancelada" }).returning();
    expect((await fichaReservaNoBeds24(db, org, reservaId, env()))?.pedido).toBeNull();
    await db.update(cotacoes).set({ estado: "expirada" }).where(eq(cotacoes.id, cot.id));
    expect((await fichaReservaNoBeds24(db, org, reservaId, env()))?.pedido).toBe("vencido");
    await db.update(reservas).set({ estado: "confirmada" }).where(eq(reservas.id, reservaId));
    expect((await fichaReservaNoBeds24(db, org, reservaId, env()))?.pedido).toBeNull();
  });

  it("reserva de outra fonte ou de outra organização: nada (o bloco não aparece)", async () => {
    const [manual] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-MANUA2", origem: "direta", fonte: "manual", checkin: "2026-12-01", checkout: "2026-12-03" }).returning();
    expect(await fichaReservaNoBeds24(db, org, manual.id, env())).toBeNull();
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra empresa" }).returning();
    expect(await fichaReservaNoBeds24(db, outra, reservaId, env())).toBeNull();
    expect(await fichaReservaNoBeds24(db, org, "nao-e-uuid", env())).toBeNull();
  });
});

describe("Integrações: a seção das reservas do site", () => {
  it("começo: chave desligada, fora do deploy de produção, sem credencial, sem pausa, nenhum imóvel ligado, nada acompanhado", async () => {
    const p = await painelReservasBeds24(db, org, env());
    expect(p).toEqual({
      chave: { ligada: false, ambienteDeProducao: false, pronta: false },
      credencial: { refreshToken: false, soTokenDireto: false, foraDaProducao: false },
      pausa: null,
      ensaio: null,
      marca: "nao_conferida",
      importacaoAutomatica: false,
      semLigar: "sem_credencial",
      imoveis: [
        { id: im, codigo: "T1", ativo: true, ligadoEm: null, ligadoPor: null, quartoDoVinculo: "20" },
        { id: im2, codigo: "T2", ativo: true, ligadoEm: null, ligadoPor: null, quartoDoVinculo: null },
      ],
      contadores: { pendente: 0, em_envio: 0, conferida: 0, divergente: 0, conflito: 0, aguardando_equipe: 0, manual: 0, encerrada: 0 },
    });
  });

  it("o refresh token numa prévia: o aviso de credencial de escrita fora da produção, e ligar continua recusado sem ensaio", async () => {
    const p = await painelReservasBeds24(db, org, env({ VERCEL_ENV: "preview", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" }));
    expect(p.chave).toEqual({ ligada: true, ambienteDeProducao: false, pronta: false });
    expect(p.credencial).toEqual({ refreshToken: true, soTokenDireto: false, foraDaProducao: true });
    expect(p.semLigar).toBe("sem_ensaio");
    expect((await painelReservasBeds24(db, org, env({ BEDS24_API_KEY: "token-direto-ficticio" }))).credencial).toEqual({ refreshToken: false, soTokenDireto: true, foraDaProducao: false });
    expect((await painelReservasBeds24(db, org, env(PRONTO))).chave).toEqual({ ligada: true, ambienteDeProducao: true, pronta: true });
  });

  it("pausa com quem pausou, imóvel ligado com a data, ensaio com a credencial atual, marca, importação automática e contadores", async () => {
    const ensaioId = crypto.randomUUID();
    await db.insert(beds24ReservasOperacoes).values({ id: ensaioId, organizacaoId: org, tipo: "ensaio", chave: chaveEnsaioBeds24(ensaioId), modo: "real", situacao: "conferida", credencial: impressaoCredencialBeds24(env(PRONTO)) });
    await gravarConfig(db, org, "reservas_beds24", { pausado: { em: "2026-10-16T12:00:00.000Z", por: admin }, imoveis: [{ imovelId: im, ligadoEm: "2026-10-10T12:00:00.000Z", ligadoPor: admin }], ensaio: { credencial: impressaoCredencialBeds24(env(PRONTO)), em: "2026-10-09T12:00:00.000Z", operacaoId: ensaioId } }, admin);
    await gravarConfig(db, org, "beds24", { automatica: true, desde: "2026-09-28", diasCalendario: 180 }, admin);
    await db.insert(beds24ReservasSite).values({ organizacaoId: org, reservaId, imovelId: im, referencia: codigo, situacao: "conferida" });
    const p = await painelReservasBeds24(db, org, env(PRONTO));
    expect(p.pausa).toEqual({ em: "2026-10-16T12:00:00.000Z", por: "Admin Fictício" });
    expect(p.ensaio).toEqual({ em: "2026-10-09T12:00:00.000Z", valeParaCredencialAtual: true });
    expect(p.marca).toBe("provada_no_ensaio");
    expect(p.semLigar).toBeNull();
    expect(p.importacaoAutomatica).toBe(true);
    expect(p.imoveis[0]).toEqual({ id: im, codigo: "T1", ativo: true, ligadoEm: "2026-10-10T12:00:00.000Z", ligadoPor: "Admin Fictício", quartoDoVinculo: "20" });
    expect(p.contadores.conferida).toBe(1);
    // Trocar a credencial invalida o ensaio; uma reserva que voltou sem a marca derruba a marca legível.
    const outra = await painelReservasBeds24(db, org, env({ ...PRONTO, BEDS24_REFRESH_TOKEN: "outro-refresh-ficticio" }));
    expect(outra).toMatchObject({ ensaio: { valeParaCredencialAtual: false }, marca: "nao_conferida", semLigar: "sem_ensaio" });
    await db.update(beds24ReservasSite).set({ motivo: "marca_ilegivel", situacao: "divergente" }).where(and(eq(beds24ReservasSite.organizacaoId, org), eq(beds24ReservasSite.reservaId, reservaId)));
    expect((await painelReservasBeds24(db, org, env(PRONTO))).marca).toBe("ilegivel");
  });
});

describe("Integrações: imóvel ligado que foi desativado no cadastro", () => {
  it("continua na lista, marcado como inativo e com a ligação (para poder desligar); o inativo não ligado fica fora", async () => {
    await gravarConfig(db, org, "reservas_beds24", { pausado: null, imoveis: [{ imovelId: im, ligadoEm: "2026-10-10T12:00:00.000Z", ligadoPor: admin }], ensaio: null }, admin);
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.organizacaoId, org));
    const p = await painelReservasBeds24(db, org, env());
    // O vínculo de um imóvel inativo não vale (nem para a importação nem para o envio).
    expect(p.imoveis).toEqual([{ id: im, codigo: "T1", ativo: false, ligadoEm: "2026-10-10T12:00:00.000Z", ligadoPor: "Admin Fictício", quartoDoVinculo: null }]);
  });
});

describe("prontidão: os escopos da credencial (GET /authentication/details)", () => {
  it.each([
    ["nos testes", env(), "fora_da_producao"],
    ["na prévia, mesmo com a chave e o refresh token", env({ ...PRONTO, VERCEL_ENV: "preview" }), "fora_da_producao"],
    ["com NODE_ENV de desenvolvimento", env({ ...PRONTO, NODE_ENV: "development" }), "fora_da_producao"],
    ["no deploy de produção com a chave desligada", env({ ...PRONTO, BEDS24_ESCRITA_RESERVAS: undefined }), "chave_desligada"],
    ["no deploy de produção só com o token direto", env({ ...PRONTO, BEDS24_REFRESH_TOKEN: undefined, BEDS24_API_KEY: "token-direto-ficticio" }), "sem_refresh_token"],
  ])("não lê %s (nenhum leitor é pedido)", async (_nome, e, motivo) => {
    const leitorDe = vi.fn();
    expect(await conferirEscoposReservasBeds24(e, leitorDe)).toEqual({ lidos: false, motivo });
    expect(leitorDe).not.toHaveBeenCalled();
  });

  it("o leitor real só existe com a escrita pronta (e não chama nada ao ser criado)", () => {
    expect(leitorDeCredencialDoAmbiente(env())).toBeNull();
    expect(leitorDeCredencialDoAmbiente(env({ ...PRONTO, VERCEL_ENV: "preview" }))).toBeNull();
    expect(leitorDeCredencialDoAmbiente(env({ ...PRONTO, BEDS24_ESCRITA_RESERVAS: "Ligada" }))).toBeNull();
    expect(leitorDeCredencialDoAmbiente(env(PRONTO))).toBeInstanceOf(ClienteBeds24Http);
  });

  it("pronta, com a versão falsa: em ordem, com escopos demais, ilegível, e a falha da leitura com a mensagem segura", async () => {
    const falso = new Beds24Falso();
    const ler = () => conferirEscoposReservasBeds24(env(PRONTO), () => falso);
    expect(await ler()).toMatchObject({ lidos: true, avaliacao: { situacao: "em_ordem", excessivos: [] }, escopos: expect.arrayContaining(["write:bookings"]) });
    falso.detalhesCredencial = { validToken: true, token: { scopes: ["write:bookings", "all:bookings", "write:bookings-personal"] } };
    expect(await ler()).toMatchObject({ lidos: true, avaliacao: { situacao: "escopo_excessivo", excessivos: ["all:bookings", "write:bookings-personal"] } });
    falso.detalhesCredencial = { validToken: true };
    expect(await ler()).toMatchObject({ lidos: true, avaliacao: { situacao: "ilegivel" }, escopos: [] });
    falso.falhar = new ErroBeds24("Beds24 respondeu HTTP 401.", "http");
    expect(await ler()).toEqual({ lidos: false, motivo: "falhou", erro: "Beds24 respondeu HTTP 401." });
    falso.falhar = new Error("detalhe interno que não vai para a tela");
    expect(await ler()).toEqual({ lidos: false, motivo: "falhou", erro: "Não foi possível ler a credencial no Beds24." });
  });
});
