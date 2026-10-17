/**
 * Reserva paga do site no Beds24 (M8.3c): o estado da rotina (`beds24_reservas_rotina`, migração 0074) e o motivo de
 * configuração que para a escrita (desenho 2.4 e 7; seção 10, teste 36). PGlite, sem rede: o `env` é sempre
 * explícito e nenhum leitor do Beds24 é criado.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { gravarConfig } from "@/configuracoes/armazem";
import { beds24ReservasOperacoes, beds24ReservasRotina, beds24ReservasSite, imoveis, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { semDadosPessoais } from "@/pagamentos/testes";
import { impressaoCredencialBeds24 } from "./http";
import { chaveEnsaioBeds24, chaveOperacaoBeds24, type EscoposLidosBeds24 } from "./reservas-site-regras";
import {
  avancarConferencia,
  avancarReleitura,
  ESTADO_ROTINA_RESERVAS_PADRAO,
  type EstadoDaConfiguracaoDasReservas,
  estadoDaConfiguracaoDasReservas,
  existeMarcaIlegivelQueConta,
  gravarEscoposLidos,
  leituraDosEscoposValida,
  lerEstadoRotina,
  motivoDeConfiguracaoDasReservas,
  precisaLerEscopos,
  ultimaRecusaDeReservas,
} from "./reservas-site-rotina";
import { ESCOPOS_ESPERADOS_FALSO } from "./falso";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const CREDENCIAL = env({ BEDS24_REFRESH_TOKEN: "refresh-ficticio-1" });
const OUTRA = env({ BEDS24_REFRESH_TOKEN: "refresh-ficticio-2" });
const IMPRESSAO = impressaoCredencialBeds24(CREDENCIAL);
const AGORA = new Date("2026-10-17T15:00:00Z");
const horas = (h: number, de = AGORA) => new Date(de.getTime() + h * 3_600_000);
const EM_ORDEM: EscoposLidosBeds24 = { situacao: "em_ordem", excessivos: [], faltando: [], ilegiveis: [] };

describe("o motivo de configuração das reservas (desenho 2.4 e 7), na ordem", () => {
  const estado = (o: Partial<EstadoDaConfiguracaoDasReservas> = {}): EstadoDaConfiguracaoDasReservas => ({
    refreshToken: true, credencial: IMPRESSAO, rotina: { escopos: EM_ORDEM, escoposCredencial: IMPRESSAO, escoposLidosEm: horas(-1) }, leituraFalhou: false, agora: AGORA, ensaioValido: true, marcaIlegivel: false, ...o,
  });
  const lido = (escopos: EscoposLidosBeds24, o: { credencial?: string; em?: Date } = {}) => ({ rotina: { escopos, escoposCredencial: o.credencial ?? IMPRESSAO, escoposLidosEm: o.em ?? horas(-1) } });

  it("tudo pronto: nenhum motivo", () => {
    expect(motivoDeConfiguracaoDasReservas(estado())).toBeNull();
  });

  it("sem refresh token: sem_credencial, para tudo (vence qualquer outro)", () => {
    expect(motivoDeConfiguracaoDasReservas(estado({ refreshToken: false, ensaioValido: false, marcaIlegivel: true }))).toEqual({ motivo: "sem_credencial", para: "tudo" });
    expect(motivoDeConfiguracaoDasReservas(estado({ credencial: "" }))).toEqual({ motivo: "sem_credencial", para: "tudo" });
  });

  it("escopo a mais lido com a credencial de agora: nada é escrito, nem cancelar nem atualizar", () => {
    expect(motivoDeConfiguracaoDasReservas(estado(lido({ situacao: "escopo_excessivo", excessivos: ["all:bookings"], faltando: [], ilegiveis: [] })))).toEqual({ motivo: "escopo_excessivo", para: "tudo" });
  });

  it("sem leitura válida com a credencial de agora (nunca lida, de outra credencial, com 26 h ou mais, ou a leitura desta volta falhou): nada é escrito", () => {
    expect(motivoDeConfiguracaoDasReservas(estado({ rotina: { ...ESTADO_ROTINA_RESERVAS_PADRAO } }))).toEqual({ motivo: "escopo_fora_de_ordem", para: "tudo" });
    expect(motivoDeConfiguracaoDasReservas(estado(lido(EM_ORDEM, { credencial: impressaoCredencialBeds24(OUTRA) })))).toEqual({ motivo: "escopo_fora_de_ordem", para: "tudo" });
    expect(motivoDeConfiguracaoDasReservas(estado(lido(EM_ORDEM, { em: horas(-26) })))).toEqual({ motivo: "escopo_fora_de_ordem", para: "tudo" });
    expect(motivoDeConfiguracaoDasReservas(estado({ leituraFalhou: true }))).toEqual({ motivo: "escopo_fora_de_ordem", para: "tudo" });
    // O escopo a mais de OUTRA credencial não vale para a de agora: a de agora é que não foi lida.
    expect(motivoDeConfiguracaoDasReservas(estado(lido({ situacao: "escopo_excessivo", excessivos: ["all:bookings"], faltando: [], ilegiveis: [] }, { credencial: "refresh:outra" })))).toEqual({ motivo: "escopo_fora_de_ordem", para: "tudo" });
    // Com 25 h ainda vale.
    expect(motivoDeConfiguracaoDasReservas(estado(lido(EM_ORDEM, { em: horas(-25) })))).toBeNull();
  });

  it("escopo faltando ou ilegível, lido com a credencial de agora: só as criações param", () => {
    expect(motivoDeConfiguracaoDasReservas(estado(lido({ situacao: "incompleto", excessivos: [], faltando: ["write:bookings"], ilegiveis: [] })))).toEqual({ motivo: "escopo_fora_de_ordem", para: "criacoes" });
    expect(motivoDeConfiguracaoDasReservas(estado(lido({ situacao: "ilegivel", excessivos: [], faltando: [], ilegiveis: ["bookings.write"] })))).toEqual({ motivo: "escopo_fora_de_ordem", para: "criacoes" });
  });

  it("sem ensaio para a credencial de agora, e a marca ilegível: só as criações, nessa ordem", () => {
    expect(motivoDeConfiguracaoDasReservas(estado({ ensaioValido: false, marcaIlegivel: true }))).toEqual({ motivo: "sem_ensaio", para: "criacoes" });
    expect(motivoDeConfiguracaoDasReservas(estado({ marcaIlegivel: true }))).toEqual({ motivo: "marca_ilegivel", para: "criacoes" });
  });

  it("a leitura vale até 26 h; a rotina lê de novo a partir de 23 h, ou com outra credencial, ou nunca lida", () => {
    const e = { escopos: EM_ORDEM, escoposCredencial: IMPRESSAO, escoposLidosEm: horas(-22.9) };
    expect(precisaLerEscopos(e, IMPRESSAO, AGORA)).toBe(false);
    expect(precisaLerEscopos({ ...e, escoposLidosEm: horas(-23) }, IMPRESSAO, AGORA)).toBe(true);
    expect(precisaLerEscopos(e, impressaoCredencialBeds24(OUTRA), AGORA)).toBe(true);
    expect(precisaLerEscopos(ESTADO_ROTINA_RESERVAS_PADRAO, IMPRESSAO, AGORA)).toBe(true);
    expect(leituraDosEscoposValida({ ...e, escoposLidosEm: horas(-25.9) }, IMPRESSAO, AGORA)).toBe(true);
    expect(leituraDosEscoposValida({ ...e, escopos: null }, IMPRESSAO, AGORA)).toBe(false);
    expect(leituraDosEscoposValida(e, "", AGORA)).toBe(false);
  });
});

describe("o estado da rotina no banco (beds24_reservas_rotina)", () => {
  let db: Db, close: () => Promise<void>, org: string, im: string;
  beforeAll(async () => { ({ db, close } = await createTestDb()); });
  afterAll(() => close());
  beforeEach(async () => {
    [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
    [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "T1", nome: "Imóvel fictício" }).returning();
  });
  const reservaComAcompanhamento = async (o: { checkout: string; situacao: "divergente" | "manual" | "encerrada" | "aguardando_equipe"; motivo: "marca_ilegivel" | "falhas" }) => {
    const [r] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: `SCL-${crypto.randomUUID().slice(0, 6)}`, origem: "site", fonte: "site", checkin: "2026-10-10", checkout: o.checkout, hospedes: 2 }).returning();
    await db.insert(beds24ReservasSite).values({ organizacaoId: org, reservaId: r.id, imovelId: im, referencia: r.codigo, situacao: o.situacao, motivo: o.motivo });
    return r;
  };

  it("sem linha, o padrão; os escopos gravados pela mesma avaliação da prontidão, com a impressão (nunca a credencial)", async () => {
    expect(await lerEstadoRotina(db, org)).toEqual(ESTADO_ROTINA_RESERVAS_PADRAO);
    const gravado = await gravarEscoposLidos(db, org, IMPRESSAO, { escopos: [...ESCOPOS_ESPERADOS_FALSO, "all:bookings"], ilegiveis: ["???"] }, AGORA);
    expect(gravado).toEqual({ situacao: "escopo_excessivo", excessivos: ["all:bookings"], faltando: [], ilegiveis: ["???"] });
    expect(await lerEstadoRotina(db, org)).toEqual({ ...ESTADO_ROTINA_RESERVAS_PADRAO, escopos: gravado, escoposCredencial: IMPRESSAO, escoposLidosEm: AGORA });
    // Gravar de novo (a leitura de amanhã) substitui na mesma linha.
    await gravarEscoposLidos(db, org, IMPRESSAO, { escopos: ESCOPOS_ESPERADOS_FALSO, ilegiveis: [] }, horas(24));
    expect(await lerEstadoRotina(db, org)).toMatchObject({ escopos: EM_ORDEM, escoposLidosEm: horas(24) });
    expect(await db.select().from(beds24ReservasRotina).where(eq(beds24ReservasRotina.organizacaoId, org))).toHaveLength(1);
    expect(JSON.stringify(await db.select().from(beds24ReservasRotina))).not.toContain("refresh-ficticio-1");
  });

  it("a conferência e a releitura só avançam (duas voltas fora de ordem nunca as fazem voltar) e não mexem nos escopos", async () => {
    await gravarEscoposLidos(db, org, IMPRESSAO, { escopos: ESCOPOS_ESPERADOS_FALSO, ilegiveis: [] }, AGORA);
    await avancarConferencia(db, org, horas(1));
    await avancarConferencia(db, org, horas(0.5));
    await avancarReleitura(db, org, horas(2));
    expect(await lerEstadoRotina(db, org)).toMatchObject({ escopos: EM_ORDEM, conferenciaEm: horas(1), releituraEm: horas(2) });
    // Sem linha ainda, avançar cria a linha só com a marca.
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra" }).returning();
    await avancarReleitura(db, outra, AGORA);
    expect(await lerEstadoRotina(db, outra)).toEqual({ ...ESTADO_ROTINA_RESERVAS_PADRAO, releituraEm: AGORA });
  });

  it("o valor guardado torto conta como sem leitura (nada é escrito)", async () => {
    await db.insert(beds24ReservasRotina).values({ organizacaoId: org, escopos: { situacao: "em_ordem" } as unknown as EscoposLidosBeds24, escoposCredencial: IMPRESSAO, escoposLidosEm: AGORA });
    expect((await lerEstadoRotina(db, org)).escopos).toBeNull();
    const e = await estadoDaConfiguracaoDasReservas(db, org, CREDENCIAL, AGORA);
    expect(motivoDeConfiguracaoDasReservas(e)).toEqual({ motivo: "escopo_fora_de_ordem", para: "tudo" });
  });

  it("a marca ilegível só conta fora de manual e encerrada e com a saída a partir de hoje (São Paulo)", async () => {
    await reservaComAcompanhamento({ checkout: "2026-10-16", situacao: "divergente", motivo: "marca_ilegivel" });
    await reservaComAcompanhamento({ checkout: "2026-12-20", situacao: "manual", motivo: "marca_ilegivel" });
    await reservaComAcompanhamento({ checkout: "2026-12-20", situacao: "encerrada", motivo: "marca_ilegivel" });
    await reservaComAcompanhamento({ checkout: "2026-12-20", situacao: "aguardando_equipe", motivo: "falhas" });
    expect(await existeMarcaIlegivelQueConta(db, org, AGORA)).toBe(false);
    // A saída hoje ainda conta (17/10 em São Paulo; às 2h UTC de 18/10 ainda é 17/10 lá).
    await reservaComAcompanhamento({ checkout: "2026-10-17", situacao: "divergente", motivo: "marca_ilegivel" });
    expect(await existeMarcaIlegivelQueConta(db, org, new Date("2026-10-18T02:00:00Z"))).toBe(true);
    expect(await existeMarcaIlegivelQueConta(db, org, new Date("2026-10-18T04:00:00Z"))).toBe(false);
  });

  it("o estado lido do banco e do env: o ensaio da credencial de agora; trocar o token tira a leitura e o ensaio", async () => {
    const ensaio = crypto.randomUUID();
    await db.insert(beds24ReservasOperacoes).values({ id: ensaio, organizacaoId: org, tipo: "ensaio", chave: chaveEnsaioBeds24(ensaio), modo: "real", situacao: "conferida", credencial: IMPRESSAO });
    await gravarConfig(db, org, "reservas_beds24", { pausado: null, imoveis: [], ensaio: { credencial: IMPRESSAO, em: AGORA.toISOString(), operacaoId: ensaio } }, null);
    await gravarEscoposLidos(db, org, IMPRESSAO, { escopos: ESCOPOS_ESPERADOS_FALSO, ilegiveis: [] }, horas(-1));
    expect(motivoDeConfiguracaoDasReservas(await estadoDaConfiguracaoDasReservas(db, org, CREDENCIAL, AGORA))).toBeNull();
    expect(motivoDeConfiguracaoDasReservas(await estadoDaConfiguracaoDasReservas(db, org, CREDENCIAL, AGORA, { leituraFalhou: true }))).toEqual({ motivo: "escopo_fora_de_ordem", para: "tudo" });
    expect(motivoDeConfiguracaoDasReservas(await estadoDaConfiguracaoDasReservas(db, org, OUTRA, AGORA))).toEqual({ motivo: "escopo_fora_de_ordem", para: "tudo" });
    // A credencial nova lida e em ordem: falta o ensaio dela.
    await gravarEscoposLidos(db, org, impressaoCredencialBeds24(OUTRA), { escopos: ESCOPOS_ESPERADOS_FALSO, ilegiveis: [] }, horas(-1));
    expect(motivoDeConfiguracaoDasReservas(await estadoDaConfiguracaoDasReservas(db, org, OUTRA, AGORA))).toEqual({ motivo: "sem_ensaio", para: "criacoes" });
    // Só o token direto (BEDS24_API_KEY) não escreve reservas.
    expect(motivoDeConfiguracaoDasReservas(await estadoDaConfiguracaoDasReservas(db, org, env({ BEDS24_API_KEY: "token-ficticio" }), AGORA))).toEqual({ motivo: "sem_credencial", para: "tudo" });
  });

  it("o último 403 ou 401 de reservas, também o do ensaio (sem reserva), e se foi com a credencial de agora", async () => {
    expect(await ultimaRecusaDeReservas(db, org, CREDENCIAL)).toBeNull();
    const [r] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-7K2QXM", origem: "site", fonte: "site", checkin: "2026-12-20", checkout: "2026-12-27", hospedes: 2 }).returning();
    await db.insert(beds24ReservasOperacoes).values([
      { organizacaoId: org, reservaId: r.id, tipo: "criar", chave: chaveOperacaoBeds24("criar", r.id, 1), modo: "real", situacao: "recusada", resposta: "http_403", respondidoEm: horas(-3), credencial: impressaoCredencialBeds24(OUTRA) },
      { organizacaoId: org, reservaId: r.id, tipo: "criar", chave: chaveOperacaoBeds24("criar", r.id, 2), modo: "real", situacao: "falhou", resposta: "tempo", respondidoEm: horas(-1), credencial: IMPRESSAO },
    ]);
    expect(await ultimaRecusaDeReservas(db, org, CREDENCIAL)).toEqual({ resposta: "http_403", em: horas(-3), tipo: "criar", comCredencialAtual: false });
    // Um 401 sem resposta de POST (o pedido do token recusado), mais antigo: vale o instante dele, nunca o fim da fila.
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: org, reservaId: r.id, tipo: "criar", chave: chaveOperacaoBeds24("criar", r.id, 3), modo: "real", situacao: "recusada", resposta: "http_401", iniciadoEm: horas(-10), credencial: IMPRESSAO });
    expect(await ultimaRecusaDeReservas(db, org, CREDENCIAL)).toMatchObject({ resposta: "http_403", em: horas(-3) });
    const ensaio = crypto.randomUUID();
    await db.insert(beds24ReservasOperacoes).values({ id: ensaio, organizacaoId: org, tipo: "ensaio", chave: chaveEnsaioBeds24(ensaio), modo: "real", situacao: "recusada", resposta: "http_401", respondidoEm: horas(-2), credencial: IMPRESSAO });
    expect(await ultimaRecusaDeReservas(db, org, CREDENCIAL)).toEqual({ resposta: "http_401", em: horas(-2), tipo: "ensaio", comCredencialAtual: true });
    // O 401 sem resposta de POST mais novo que as outras: é o último.
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: org, reservaId: r.id, tipo: "criar", chave: chaveOperacaoBeds24("criar", r.id, 4), modo: "real", situacao: "recusada", resposta: "http_401", iniciadoEm: horas(-0.5), credencial: IMPRESSAO });
    expect(await ultimaRecusaDeReservas(db, org, CREDENCIAL)).toEqual({ resposta: "http_401", em: horas(-0.5), tipo: "criar", comCredencialAtual: true });
    // De outra organização não aparece.
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra" }).returning();
    expect(await ultimaRecusaDeReservas(db, outra, CREDENCIAL)).toBeNull();
  });

  it("a varredura de dados pessoais cobre o estado da rotina (o canário aparece; sem ele, nada)", async () => {
    await gravarEscoposLidos(db, org, IMPRESSAO, { escopos: ESCOPOS_ESPERADOS_FALSO, ilegiveis: [] }, AGORA);
    expect(await semDadosPessoais(db, ["canario.rotina@example.com"])).toEqual([]);
    await db.update(beds24ReservasRotina).set({ escoposCredencial: "canario.rotina@example.com" }).where(eq(beds24ReservasRotina.organizacaoId, org));
    expect(await semDadosPessoais(db, ["canario.rotina@example.com"])).toEqual(["canario.rotina@example.com"]);
  });
});
