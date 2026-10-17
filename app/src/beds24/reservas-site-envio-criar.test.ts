/**
 * Reserva paga do site no Beds24 (M8.3c) — o trabalhador da criação (desenho 3.3, 3.6, 3.8, 4.1, 4.4, 6.3 e 9; plano, testes
 * 20, 21, 26, 33, 36 e o extra da fila): as três fases, a fila diante da régua, a conferência antes e depois, as marcas, os
 * limites da volta, a queda antes do POST e o fim do acompanhamento. PGlite, os cenários do pagamento, o Beds24 falso e um
 * espião de `fetch` que nunca é chamado: nada vai ao Beds24. O `env` é sempre explícito (`PRONTO`), e o cliente é o falso
 * injetado: nenhuma fábrica do ambiente é chamada.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { gravarConfig } from "@/configuracoes/armazem";
import { alteracoesReserva, auditoria, beds24CalendarioEnviado, beds24ReservasOperacoes, beds24ReservasRotina, beds24ReservasSite, bloqueios, idsExternos, lancamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { marcarOtaAtualizada } from "@/pagamentos/alteracao";
import { alterar, type Cenario, cancelar, entradaPadrao, env, minutos, montarCenario, pagarDiferenca, pagarEConfirmar, semDadosDoHospede, usuarioDeTeste } from "@/pagamentos/testes";
import { Beds24Falso, ESCOPOS_ESPERADOS_FALSO } from "./falso";
import { impressaoCredencialBeds24 } from "./http";
import { INFO_MARCA_SCL, respostaDaGravacao } from "./normalizar";
import { abrirIntencao, devolverVencidasSemPost, ERRO_ALTERACAO_SEM_MARCA, encerrarTerminadas, enviarReservasDoSite, type OpcoesDoEnvio } from "./reservas-site-envio";
import { chaveOperacaoBeds24 } from "./reservas-site-regras";
import { gravarEscoposLidos } from "./reservas-site-rotina";
import { marcarDatasFechadasNasOtas, tarefasDasOtas } from "./reservas-site-tarefas";
import { ErroBeds24, TEXTOS_DE_ERRO_BEDS24 } from "./tipos";

/** O deploy de produção com a chave das reservas e o refresh token (fictício): a trava de ambiente aberta. */
const VALORES_PRONTO = { VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" };
const PRONTO = env(VALORES_PRONTO);
const CREDENCIAL = impressaoCredencialBeds24(PRONTO);
const ENSAIO = { credencial: CREDENCIAL, em: "2026-09-01T00:00:00.000Z", operacaoId: "6f1c2a7e-3b4d-4c5e-8f90-123456789abc" };
type Obj = Record<string, unknown>;

let db: Db, close: () => Promise<void>, c: Cenario, falso: Beds24Falso, admin: Sessao;
let espiao: ReturnType<typeof vi.spyOn>;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  espiao = vi.spyOn(globalThis, "fetch");
  c = await montarCenario(db);
  admin = { usuarioId: await usuarioDeTeste(c), organizacaoId: c.org, papel: "admin", imovelIds: [] };
  falso = new Beds24Falso(() => minutos(10));
  // O imóvel 403 do cenário está ligado ao quarto 20 da propriedade 10 (ids_externos), em BRL, com uma unidade por noite.
  falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Studio" }] }];
  falso.calendarios = calendario();
  await configurar();
  await escopos();
});
afterEach(() => {
  expect(espiao).not.toHaveBeenCalled();
  espiao.mockRestore();
});

/** Um dia por faixa (as faixas que se sobrepõem voltariam duas vezes na leitura), de 01/10 a 30/11, com `especiais` por dia. */
function calendario(especiais: Record<string, Obj> = {}, ate = "2026-11-30") {
  const dias: Obj[] = [];
  for (let d = "2026-10-01"; d <= ate; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) dias.push({ from: d, to: d, numAvail: 1, price1: 450, ...especiais[d] });
  return [{ roomId: 20, calendar: dias }];
}
/** A configuração das reservas no Beds24 (gravada direto): o imóvel ligado, o ensaio da credencial `PRONTO`, sem pausa. */
const configurar = (o: { ligadoEm?: string; pausado?: boolean; ligado?: boolean; ensaio?: typeof ENSAIO | null } = {}) =>
  gravarConfig(
    db, c.org, "reservas_beds24",
    { pausado: o.pausado ? { em: minutos(0).toISOString(), por: null } : null, retomado: null, imoveis: o.ligado === false ? [] : [{ imovelId: c.imovel, ligadoEm: o.ligadoEm ?? "2026-09-01T00:00:00.000Z", ligadoPor: null }], ensaio: o.ensaio === undefined ? ENSAIO : o.ensaio },
    null,
  );
/** A leitura dos escopos guardada (a rotina lê no começo da volta): por padrão, exatamente os do convite, com a credencial `PRONTO`. */
const escopos = (o: { lista?: string[]; ilegiveis?: string[]; credencial?: string; em?: Date } = {}) =>
  gravarEscoposLidos(db, c.org, o.credencial ?? CREDENCIAL, { escopos: o.lista ?? [...ESCOPOS_ESPERADOS_FALSO], ilegiveis: o.ilegiveis ?? [] }, o.em ?? minutos(0));
const rodar = (agora: Date = minutos(10), o: Partial<OpcoesDoEnvio> = {}) => enviarReservasDoSite(db, c.org, falso, { env: PRONTO, relogio: { agora: () => agora, restanteMs: () => 240_000 }, ...o });
const operacoes = (reservaId: string) => db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.reservaId, reservaId)).orderBy(asc(beds24ReservasOperacoes.chave));
const acompanhamento = async (reservaId: string) => (await db.select().from(beds24ReservasSite).where(eq(beds24ReservasSite.reservaId, reservaId)))[0];
const lancamentosDaOrg = () => db.select().from(lancamentos).where(eq(lancamentos.organizacaoId, c.org)).orderBy(asc(lancamentos.id));
/** O corpo exato da criação (desenho 3.7): quarto, datas, pessoas, situação e a marca; nada do hóspede nem valor. */
const corpoDaCriacao = (codigo: string, o: { chegada?: string; saida?: string; pessoas?: number } = {}) => [
  { roomId: 20, arrival: o.chegada ?? "2026-10-12", departure: o.saida ?? "2026-10-15", status: "confirmed", numAdult: o.pessoas ?? 4, numChild: 0, infoItems: [{ code: INFO_MARCA_SCL, text: codigo }], actions: { checkAvailability: true, notifyGuest: false, notifyHost: false } },
];
/** Um registro do Beds24 no quarto 20 (formato da API, dados fictícios). */
const registro = (o: Obj) => ({ propertyId: 10, roomId: 20, status: "confirmed", arrival: "2026-10-12", departure: "2026-10-15", numAdult: 4, ...o });
/** Os POSTs que chegaram ao falso. */
const postsNoFalso = () => falso.escritasReservas.length;
/** Grava `avisada_em` no acompanhamento (como se o e-mail de antes já tivesse saído): a transição para um caso de e-mail o zera. */
const avisadaAntes = (reservaId: string, em: Date) => db.update(beds24ReservasSite).set({ avisadaEm: em }).where(eq(beds24ReservasSite.reservaId, reservaId));

describe("teste 20: a criação conferida", () => {
  it("cria com o corpo exato, grava o id na reserva, confere e marca sozinho; o aviso some, o financeiro não muda e nada do hóspede sai", async () => {
    const x = await pagarEConfirmar(c);
    const antes = await lancamentosDaOrg();
    expect((await tarefasDasOtas(db, c.org, minutos(5), PRONTO)).tarefas.map((t) => [t.caso, t.estado])).toEqual([["paga", "sendo_enviada"]]);

    // O `avisada_em` de antes fica: a conferida sem overbooking não é um caso de e-mail (o contraste do overbooking, abaixo).
    // Muda junto (bloco D): os números da volta ganharam as atualizações e os cancelamentos aceitos (o resumo da rotina, desenho 9).
    expect(await rodar(minutos(10), { ganchos: { antesDaFase2: () => avisadaAntes(x.reservaId, minutos(5)) } })).toEqual({ posts: 1, criadas: 1, atualizadas: 0, canceladas: 0, conferidas: 1, incertas: 0, avisos: 0, falhas: 0, parada: null, configuracao: null });
    expect(falso.escritasReservas).toEqual([{ metodo: "POST", corpo: corpoDaCriacao(x.reservaCodigo) }]);
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    const [o] = await operacoes(x.reservaId);
    expect(o).toMatchObject({ tipo: "criar", modo: "real", chave: chaveOperacaoBeds24("criar", x.reservaId, 1), situacao: "conferida", resposta: "criada", beds24Id: "900001", erro: "", credencial: CREDENCIAL, tentativas: 1, autorId: null });
    expect(o.pedido).toEqual({ quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada", referencia: x.reservaCodigo });
    expect(o.depois).toEqual({ quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada" });
    expect([o.enviadoEm, o.respondidoEm, o.terminadoEm].every((d) => d instanceof Date)).toBe(true);
    expect(await acompanhamento(x.reservaId)).toMatchObject({
      situacao: "conferida", motivo: null, versao: 1, roomId: "20", propertyId: "10", credencial: CREDENCIAL, otaFechadaEm: minutos(10), otaFechadaPor: null, conferidaEm: minutos(10), tentativas: 0, proximaTentativaEm: null, avisadaEm: minutos(5),
    });
    // A tarefa da paga some (o sistema marcou as datas fechadas), e o financeiro fica igual.
    expect(await tarefasDasOtas(db, c.org, minutos(15), PRONTO)).toEqual({ tarefas: [], atencoes: [], avisos: [] });
    expect(await lancamentosDaOrg()).toEqual(antes);
    const [auditada] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.criar")));
    expect(auditada).toMatchObject({ entidade: "reserva", entidadeId: x.reservaId, usuarioId: null, mudancas: { beds24Id: [null, "900001"] } });
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("o overbooking na releitura do calendário (livres < 0): conferida, com as marcas, e o motivo noites_ocupadas pede a atenção", async () => {
    const x = await pagarEConfirmar(c);
    // O Beds24 passa a informar -1 numa noite logo depois da gravação (outra reserva chegou junto pelo canal).
    falso.lento = () => {
      if (!falso.escritasReservas.length) return;
      const dia = (falso.calendarios[0].calendar as Obj[]).find((d) => d.from === "2026-10-13");
      if (dia) dia.numAvail = -1;
    };
    // A transição para o overbooking zera o `avisada_em` de antes: o e-mail sai depois do commit.
    expect(await rodar(minutos(10), { ganchos: { antesDaFase2: () => avisadaAntes(x.reservaId, minutos(5)) } })).toMatchObject({ posts: 1, conferidas: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: "noites_ocupadas", otaFechadaEm: minutos(10), avisadaEm: null });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("conferida");
  });
});

describe("teste 21: a idempotência da criação", () => {
  it("duas voltas = um POST", async () => {
    const x = await pagarEConfirmar(c);
    await rodar();
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0 });
    expect(postsNoFalso()).toBe(1);
    expect(await operacoes(x.reservaId)).toHaveLength(1);
  });

  it("dois trabalhadores: A preso na fase 2, B para em 'escrita em andamento'; um POST só", async () => {
    await pagarEConfirmar(c);
    let liberar!: () => void;
    let chegou!: () => void;
    const portao = new Promise<void>((r) => (liberar = r));
    const naPorta = new Promise<void>((r) => (chegou = r));
    falso.antesDeGravar = async () => {
      chegou();
      await portao;
    };
    const a = rodar();
    await naPorta;
    expect(await rodar()).toMatchObject({ posts: 0, parada: "em_andamento" });
    liberar();
    expect(await a).toMatchObject({ posts: 1, conferidas: 1 });
    expect(postsNoFalso()).toBe(1);
  });

  it("a alteração aplicada antes do primeiro envio (enviado_em nulo): a mesma chave, o pedido atualizado e a alteração marcada", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    let alteracaoId = "";
    // No gancho antes da fase 2: a equipe muda a saída (aplicada pelo pagamento da diferença) e pausa o envio.
    const ganchos = {
      antesDaFase2: async () => {
        const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(11), { autorId: admin.usuarioId });
        if (!resultado.ok || !("alteracaoId" in resultado)) throw new Error("alteração não segurada");
        expect((await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(12) })).resultado).toBe("aprovado");
        alteracaoId = resultado.alteracaoId;
        await configurar({ pausado: true });
      },
    };
    expect(await rodar(minutos(10), { ganchos })).toMatchObject({ posts: 0, parada: "pausa" });
    const [pausada] = await operacoes(x.reservaId);
    expect(pausada).toMatchObject({ situacao: "pendente", enviadoEm: null });
    expect(pausada.pedido?.saida).toBe("2026-10-15");

    await configurar();
    expect(await rodar(minutos(20))).toMatchObject({ posts: 1, conferidas: 1 });
    const linhas = await operacoes(x.reservaId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ chave: chaveOperacaoBeds24("criar", x.reservaId, 1), situacao: "conferida", alteracoes: [alteracaoId] });
    expect(linhas[0].pedido?.saida).toBe("2026-10-16");
    expect(falso.escritasReservas).toEqual([{ metodo: "POST", corpo: corpoDaCriacao(x.reservaCodigo, { saida: "2026-10-16" }) }]);
    // A alteração lida na fase 1 ganhou a marca das OTAs pelo sistema (`por` nulo): a tarefa dela some.
    const [alt] = await db.select().from(alteracoesReserva).where(eq(alteracoesReserva.id, alteracaoId));
    expect(alt).toMatchObject({ otaAtualizadaEm: minutos(20), otaAtualizadaPor: null });
    expect((await tarefasDasOtas(db, c.org, minutos(25), PRONTO)).tarefas).toEqual([]);
  });

  /** A saída mudada para 16/10 e a diferença paga antes da volta: a alteração aplicada entra em `operacao.alteracoes` na fase 1. */
  async function alteradaAntes() {
    const x = await pagarEConfirmar(c, { liberar: true });
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(5), { autorId: admin.usuarioId });
    if (!resultado.ok || !("alteracaoId" in resultado)) throw new Error("alteração não segurada");
    expect((await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(6) })).resultado).toBe("aprovado");
    return { x, alteracaoId: resultado.alteracaoId };
  }
  const alteracao = async (id: string) => (await db.select().from(alteracoesReserva).where(eq(alteracoesReserva.id, id)))[0];

  it("a alteração marcada à mão entre a fase 1 e a fase 3: 'já marcada' é sucesso, e a marca da equipe não é sobrescrita", async () => {
    const { x, alteracaoId } = await alteradaAntes();
    const ganchos = { antesDaFase3: async () => expect(await marcarOtaAtualizada(db, c.org, alteracaoId, admin.usuarioId, minutos(19))).toEqual({ ok: true }) };
    expect(await rodar(minutos(20), { ganchos })).toMatchObject({ posts: 1, conferidas: 1 });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "conferida", erro: "", alteracoes: [alteracaoId] });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida" });
    expect(await alteracao(alteracaoId)).toMatchObject({ otaAtualizadaPor: admin.usuarioId, otaAtualizadaEm: minutos(19) });
  });

  it("a alteração que não pôde ser marcada (e segue sem a marca): o erro fica na operação, e a criação continua conferida", async () => {
    const { x, alteracaoId } = await alteradaAntes();
    // Fictício: a alteração deixa de estar aplicada entre as fases, e `marcarOtaAtualizada` recusa sem marcar.
    const ganchos = { antesDaFase3: () => db.update(alteracoesReserva).set({ situacao: "desistida" }).where(eq(alteracoesReserva.id, alteracaoId)) };
    expect(await rodar(minutos(20), { ganchos })).toMatchObject({ posts: 1, conferidas: 1 });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "conferida", erro: ERRO_ALTERACAO_SEM_MARCA });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida" });
    expect(await alteracao(alteracaoId)).toMatchObject({ otaAtualizadaEm: null });
  });

  it("A→B→A antes do envio: a mesma linha e a mesma chave, atualizadas no lugar; um POST, com o estado de agora", async () => {
    const x = await pagarEConfirmar(c);
    falso.falharToken = new ErroBeds24("Falha de rede ao pedir o token (fictícia).", "rede");
    expect(await rodar()).toMatchObject({ posts: 0, falhas: 1 });
    falso.falharToken = null;
    const pessoas = (n: number) => db.update(reservas).set({ hospedes: n }).where(eq(reservas.id, x.reservaId));
    await pessoas(3);
    // Ainda no atraso da falha: a fila é atualizada no lugar, e nada sai.
    expect(await rodar(minutos(15))).toMatchObject({ posts: 0 });
    expect((await operacoes(x.reservaId))[0].pedido?.hospedes).toBe(3);
    await pessoas(4);
    expect(await rodar(minutos(21))).toMatchObject({ posts: 1, conferidas: 1 });
    const linhas = await operacoes(x.reservaId);
    expect(linhas.map((l) => [l.chave, l.situacao, l.pedido?.hospedes])).toEqual([[chaveOperacaoBeds24("criar", x.reservaId, 1), "conferida", 4]]);
    expect(falso.escritasReservas).toEqual([{ metodo: "POST", corpo: corpoDaCriacao(x.reservaCodigo) }]);
  });
});

describe("as travas do POST: a pausa relida, o token antes de enviado_em e o UPDATE de enviado_em", () => {
  it("teste 33: a pausa gravada antes da fase 2 — nenhum POST, a operação volta a pendente sem enviado_em e sem contar falha", async () => {
    const x = await pagarEConfirmar(c);
    expect(await rodar(minutos(10), { ganchos: { antesDaFase2: () => configurar({ pausado: true }) } })).toMatchObject({ posts: 0, parada: "pausa", falhas: 0 });
    expect(postsNoFalso()).toBe(0);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "pendente", enviadoEm: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", tentativas: 0, proximaTentativaEm: null });
    // Com a pausa, a fase 1 também para (o passo 0 da rotina só lê).
    expect(await rodar(minutos(11))).toMatchObject({ posts: 0, parada: "pausa" });
  });

  it("o token que não vem é falha antes do POST: nenhum POST, enviado_em nulo, o atraso da tabela; depois do atraso, sai", async () => {
    const x = await pagarEConfirmar(c);
    falso.falharToken = new ErroBeds24("Falha de rede ao pedir o token (fictícia).", "rede");
    expect(await rodar()).toMatchObject({ posts: 0, falhas: 1 });
    expect(postsNoFalso()).toBe(0);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "pendente", enviadoEm: null, resposta: null, erro: "Falha de rede ao pedir o token (fictícia)." });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", tentativas: 1, proximaTentativaEm: minutos(20) });
    falso.falharToken = null;
    expect(await rodar(minutos(15))).toMatchObject({ posts: 0 });
    expect(await rodar(minutos(21))).toMatchObject({ posts: 1, conferidas: 1 });
    expect((await operacoes(x.reservaId)).map((o) => [o.chave, o.situacao])).toEqual([[chaveOperacaoBeds24("criar", x.reservaId, 1), "conferida"]]);
  });

  it("na 5ª falha antes do POST: a operação falhou e a equipe é chamada (aguardando_equipe/falhas)", async () => {
    const x = await pagarEConfirmar(c);
    falso.falharToken = new ErroBeds24("Falha de rede ao pedir o token (fictícia).", "rede");
    for (const t of [10, 21, 42, 83]) {
      expect(await rodar(minutos(t))).toMatchObject({ posts: 0, falhas: 1 });
      expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente" });
    }
    await avisadaAntes(x.reservaId, minutos(100));
    expect(await rodar(minutos(164))).toMatchObject({ posts: 0, falhas: 1 });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "falhou", enviadoEm: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "falhas", tentativas: 5, avisadaEm: null });
    expect(postsNoFalso()).toBe(0);
  });

  it("o UPDATE de enviado_em que não pega a linha não deixa sair nada", async () => {
    const x = await pagarEConfirmar(c);
    const ganchos = { antesDaFase2: async () => void (await db.update(beds24ReservasOperacoes).set({ situacao: "superada" }).where(eq(beds24ReservasOperacoes.reservaId, x.reservaId))) };
    expect(await rodar(minutos(10), { ganchos })).toMatchObject({ posts: 0 });
    expect(postsNoFalso()).toBe(0);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "superada", enviadoEm: null });
  });

  it("o imóvel desligado entre as fases: nenhum POST, a operação superada; religado, a volta seguinte cria na versão 2", async () => {
    const x = await pagarEConfirmar(c);
    expect(await rodar(minutos(10), { ganchos: { antesDaFase2: () => configurar({ ligado: false }) } })).toMatchObject({ posts: 0 });
    expect(postsNoFalso()).toBe(0);
    expect((await operacoes(x.reservaId))[0].situacao).toBe("superada");
    // A intenção da `criar` superada sai do acompanhamento: senão a régua responderia `sem_mudanca` para sempre.
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", motivo: null, assinaturaEsperada: null });
    await configurar();
    expect(await rodar(minutos(20))).toMatchObject({ posts: 1, criadas: 1, conferidas: 1 });
    expect((await operacoes(x.reservaId)).map((o) => [o.chave, o.situacao])).toEqual([[chaveOperacaoBeds24("criar", x.reservaId, 1), "superada"], [chaveOperacaoBeds24("criar", x.reservaId, 2), "conferida"]]);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", versao: 2 });
  });

  it("o SCL mudou entre a fase 1 e a fase 3: o fato é gravado (o id na reserva), sem marca nem conferida, e a próxima vai para a fila agora", async () => {
    const x = await pagarEConfirmar(c);
    const ganchos = { antesDaFase3: async () => void (await db.update(reservas).set({ hospedes: 3 }).where(eq(reservas.id, x.reservaId))) };
    expect(await rodar(minutos(10), { ganchos })).toMatchObject({ posts: 1, criadas: 1, conferidas: 0 });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "conferida", beds24Id: "900001" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", motivo: null, otaFechadaEm: null, proximaTentativaEm: minutos(10) });
  });

  it("a fase 3 repete no 55P03 e no 40P01 e grava o fato", async () => {
    const x = await pagarEConfirmar(c);
    const travada = (code: string) => Object.assign(new Error("trava fictícia"), { code });
    const ganchos = { antesDaFase3: (_: unknown, tentativa: number) => { if (tentativa === 1) throw travada("55P03"); if (tentativa === 2) throw travada("40P01"); } };
    expect(await rodar(minutos(10), { ganchos })).toMatchObject({ posts: 1, conferidas: 1 });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
  });
});

describe("as respostas do POST da criação (desenho 3.8)", () => {
  it.each([
    ["tempo esgotado (resposta perdida)", (f: Beds24Falso): void => void (f.perderRespostaReserva = true), "tempo"],
    ["success sem id", (f: Beds24Falso): void => void (f.respostaSemId = true), "sem_id"],
    ["success: false que gravou", (f: Beds24Falso): void => void (f.gravarComSuccessFalse = true), "recusada"],
    ["recusa de disponibilidade", (f: Beds24Falso): void => void (f.recusarDisponibilidade = true), "recusada_disponibilidade"],
  ] as const)("%s: a operação fica incerta (a busca decide na volta seguinte), o acompanhamento em_envio, sem o id na reserva", async (_nome, preparar, resposta) => {
    const x = await pagarEConfirmar(c);
    preparar(falso);
    expect(await rodar()).toMatchObject({ posts: 1, incertas: 1, conferidas: 0 });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "incerta", resposta, erro: TEXTOS_DE_ERRO_BEDS24[resposta] });
    expect((await operacoes(x.reservaId))[0].enviadoEm).toBeInstanceOf(Date);
    // A fase 3 da incerta não mexe no acompanhamento: o quarto, a propriedade e a credencial vêm da fase 1 (sem o quarto, o id
    // que entrar na operação viraria uma atenção falsa, `criadaPeloM83`).
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "em_envio", roomId: "20", propertyId: "10", credencial: CREDENCIAL, otaFechadaEm: null });
    expect((await c.reserva(x.reservaId)).beds24Id).toBeNull();
    // Nunca repete na mesma volta, nem na seguinte antes da saída da incerteza.
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0 });
    expect(JSON.stringify(await operacoes(x.reservaId))).not.toContain("Fictício");
  });

  it.each([
    ["403", (f: Beds24Falso): void => void (f.responder403 = true), "http_403"],
    ["401 repetido", (f: Beds24Falso): void => void (f.responder401Repetido = true), "http_401"],
  ] as const)("%s: recusada, aguardando_equipe/sem_permissao e a volta para", async (_nome, preparar, resposta) => {
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    preparar(falso);
    expect(await rodar(minutos(10), { ganchos: { antesDaFase2: () => avisadaAntes(x.reservaId, minutos(5)) } })).toMatchObject({ posts: 1, avisos: 1, parada: "sem_permissao" });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "recusada", resposta });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_permissao", avisadaEm: null });
    expect(await operacoes(y.reservaId)).toEqual([]);
  });

  it("429 sem a lista: a linha fica falhou (com enviado_em), nasce a versão seguinte pendente sem atraso, e a volta para", async () => {
    const x = await pagarEConfirmar(c);
    falso.responder429 = true;
    expect(await rodar()).toMatchObject({ posts: 1, falhas: 0, parada: "limite" });
    const [v1, v2] = await operacoes(x.reservaId);
    expect(v1).toMatchObject({ chave: chaveOperacaoBeds24("criar", x.reservaId, 1), situacao: "falhou", resposta: "limite" });
    expect(v1.enviadoEm).toBeInstanceOf(Date);
    expect(v2).toMatchObject({ chave: chaveOperacaoBeds24("criar", x.reservaId, 2), situacao: "pendente", enviadoEm: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", versao: 2, tentativas: 0, proximaTentativaEm: null });
    falso.responder429 = false;
    expect(await rodar(minutos(11))).toMatchObject({ posts: 1, conferidas: 1 });
  });

  it("o crédito restante abaixo de 20: a operação termina e a volta para", async () => {
    await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    falso.creditoRestante = 19;
    expect(await rodar()).toMatchObject({ posts: 1, conferidas: 1, parada: "credito" });
    expect(await operacoes(y.reservaId)).toEqual([]);
  });

  it("criada sem a releitura: o id vai para a reserva (com a auditoria), a operação fica feita e nenhum segundo POST sai", async () => {
    const x = await pagarEConfirmar(c);
    // O POST responde com o id; a releitura logo depois cai (o Beds24 para de responder).
    falso.lento = () => {
      if (falso.escritasReservas.length) falso.falhar = new ErroBeds24("Beds24 não respondeu a tempo.", "tempo");
    };
    expect(await rodar()).toMatchObject({ posts: 1, criadas: 1, conferidas: 0 });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "feita", resposta: "criada", beds24Id: "900001" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "em_envio", otaFechadaEm: null });
    const auditadas = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.criar")));
    expect(auditadas).toMatchObject([{ entidadeId: x.reservaId, mudancas: { beds24Id: [null, "900001"] } }]);
    falso.lento = null;
    falso.falhar = null;
    // A `feita` está em curso (o passo 1 confere): nenhuma intenção nova, e o id já ligado tira a reserva das criações.
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0 });
    expect(falso.escritasReservas).toHaveLength(1);
  });

  it("nao_enviado (o token caiu depois do primeiro 401): a linha fica falhou com enviado_em, nasce a versão 2 com o atraso, e ela sai depois dele", async () => {
    const x = await pagarEConfirmar(c);
    vi.spyOn(falso, "gravarReservas").mockResolvedValueOnce(respostaDaGravacao("nao_enviado", { http: 401 }));
    expect(await rodar()).toMatchObject({ posts: 1, falhas: 1, parada: null });
    const [v1, v2] = await operacoes(x.reservaId);
    expect(v1).toMatchObject({ chave: chaveOperacaoBeds24("criar", x.reservaId, 1), situacao: "falhou", resposta: "nao_enviado" });
    expect(v1.enviadoEm).toBeInstanceOf(Date);
    expect(v2).toMatchObject({ chave: chaveOperacaoBeds24("criar", x.reservaId, 2), situacao: "pendente", enviadoEm: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", versao: 2, tentativas: 1, proximaTentativaEm: minutos(20) });
    expect(await rodar(minutos(15))).toMatchObject({ posts: 0 });
    expect(await rodar(minutos(21))).toMatchObject({ posts: 1, conferidas: 1 });
    expect((await operacoes(x.reservaId)).map((o) => o.situacao)).toEqual(["falhou", "conferida"]);
  });
});

describe("a parada no 429, 401 ou 403 antes do POST (desenho 9)", () => {
  it.each([
    ["o token recusado por limite (429)", (): void => void (falso.falharToken = new ErroBeds24("Beds24 recusou a renovação (HTTP 429).", "http", 429)), "limite"],
    ["o token recusado pela credencial (400)", (): void => void (falso.falharToken = new ErroBeds24("Beds24 recusou a renovação (HTTP 400).", "http", 400)), "sem_permissao"],
    ["a leitura dos quartos no limite (429)", (): void => void (falso.falhar = new ErroBeds24("Beds24 respondeu HTTP 429.", "http", 429)), "limite"],
    ["a leitura dos quartos sem permissão (403)", (): void => void (falso.falhar = new ErroBeds24("Beds24 respondeu HTTP 403.", "http", 403)), "sem_permissao"],
    // O token é pedido dentro da primeira leitura da volta: a renovação recusada chega por ela, com o status da renovação.
    ["a renovação recusada na primeira leitura (400)", (): void => void (falso.falhar = new ErroBeds24("Beds24 recusou a renovação (HTTP 400).", "http", 400)), "sem_permissao"],
    ["a busca da marca no limite (429)", (): void => void vi.spyOn(falso, "reservas").mockRejectedValueOnce(new ErroBeds24("Beds24 respondeu HTTP 429.", "http", 429)), "limite"],
    ["o calendário das noites sem permissão (401)", (): void => void vi.spyOn(falso, "calendario").mockRejectedValueOnce(new ErroBeds24("Beds24 respondeu HTTP 401.", "http", 401)), "sem_permissao"],
  ] as const)("%s: falha antes do POST na primeira, e a volta para sem tocar a seguinte", async (_nome, preparar, parada) => {
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    preparar();
    expect(await rodar()).toMatchObject({ posts: 0, falhas: 1, parada });
    expect(falso.escritasReservas).toEqual([]);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "pendente", enviadoEm: null });
    expect(await operacoes(y.reservaId)).toEqual([]);
  });

  it("uma falha sem resposta (rede) não para a volta: a seguinte ainda é tentada", async () => {
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    vi.spyOn(falso, "prepararToken").mockRejectedValueOnce(new ErroBeds24("Falha de rede ao pedir o token (fictícia).", "rede"));
    expect(await rodar()).toMatchObject({ posts: 1, falhas: 1, conferidas: 1, parada: null });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "pendente", enviadoEm: null });
    expect((await operacoes(y.reservaId))[0]).toMatchObject({ situacao: "conferida" });
  });
});

describe("a marca ilegível depois de uma criação (desenho 4.4)", () => {
  it("para as criações já nesta volta: a seguinte não abre operação", async () => {
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    // A releitura da criada volta sem o info item (uma Auto Action que apaga os info codes, D11).
    falso.semMarcaNaLeitura = true;
    expect(await rodar()).toMatchObject({ posts: 1, criadas: 1, avisos: 1, configuracao: { motivo: "marca_ilegivel", para: "criacoes" } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "marca_ilegivel" });
    expect(await operacoes(y.reservaId)).toEqual([]);
    expect(falso.escritasReservas).toHaveLength(1);
  });

  it("uma divergência que não é da marca não para as criações", async () => {
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    // O Beds24 grava a primeira com outra saída (mudada no Beds24); a segunda sai normalmente.
    falso.lento = () => {
      const criada = falso.bookings.find((b) => String(b.arrival) === "2026-10-12");
      if (criada) criada.departure = "2026-10-16";
    };
    expect(await rodar()).toMatchObject({ posts: 2, criadas: 2, conferidas: 1, avisos: 1, configuracao: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "mudada_no_beds24" });
    expect((await operacoes(y.reservaId))[0]).toMatchObject({ situacao: "conferida" });
  });
});

describe("os limites da volta (desenho 9)", () => {
  // Doze reservas pagas pelo cenário do pagamento: mais lento que os outros testes.
  it("12 reservas = 10 POSTs; as janelas da importação e do envio diários e os 150 s não deixam começar uma operação", async () => {
    const dia = (n: number) => new Date(Date.parse("2026-10-16T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
    for (let i = 0; i < 12; i++) await pagarEConfirmar(c, { entrada: dia(3 * i), saida: dia(3 * i + 2), email: `r${i}@example.com` });
    expect(await rodar(new Date("2026-10-01T09:10:00Z"))).toMatchObject({ posts: 0, parada: "janela" });
    expect(await rodar(new Date("2026-10-01T10:00:00Z"))).toMatchObject({ posts: 0, parada: "janela" });
    expect(await rodar(minutos(10), { relogio: { agora: () => minutos(10), restanteMs: () => 149_999 } })).toMatchObject({ posts: 0, parada: "tempo" });
    expect(await rodar()).toMatchObject({ posts: 10, conferidas: 10, parada: "limite_da_volta" });
    expect(await rodar(minutos(20))).toMatchObject({ posts: 2, conferidas: 2, parada: null });
  }, 60_000);

  it("sem tempo para o POST e a fase 3 (o Beds24 lento): a operação volta a pendente, nada sai", async () => {
    const x = await pagarEConfirmar(c);
    let restante = 240_000;
    falso.lento = () => void (restante -= 40_000);
    expect(await rodar(minutos(10), { relogio: { agora: () => minutos(10), restanteMs: () => restante } })).toMatchObject({ posts: 0, parada: "tempo" });
    expect(postsNoFalso()).toBe(0);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "pendente", enviadoEm: null });
  });

  it("sem a chave pronta no env (por exemplo, a prévia), nada é lido nem escrito", async () => {
    const x = await pagarEConfirmar(c);
    for (const e of [env({ ...VALORES_PRONTO, VERCEL_ENV: "preview" }), env({ ...VALORES_PRONTO, BEDS24_ESCRITA_RESERVAS: "" }), env({ ...VALORES_PRONTO, NODE_ENV: "development" })]) {
      expect(await enviarReservasDoSite(db, c.org, falso, { env: e, relogio: { agora: () => minutos(10), restanteMs: () => 240_000 } })).toMatchObject({ posts: 0, parada: "chave" });
    }
    expect(falso.chamadas).toBe(0);
    expect(await operacoes(x.reservaId)).toEqual([]);
    expect(await acompanhamento(x.reservaId)).toBeUndefined();
  });
});

describe("teste 36 (criação): os escopos e o ensaio", () => {
  it.each([
    ["escopo a mais (escopo_excessivo)", () => escopos({ lista: [...ESCOPOS_ESPERADOS_FALSO, "all:bookings"] }), { motivo: "escopo_excessivo", para: "tudo" }],
    ["escopo faltando (incompleto)", () => escopos({ lista: ESCOPOS_ESPERADOS_FALSO.filter((e) => e !== "write:bookings") }), { motivo: "escopo_fora_de_ordem", para: "criacoes" }],
    ["escopo ilegível", () => escopos({ ilegiveis: ["???"] }), { motivo: "escopo_fora_de_ordem", para: "criacoes" }],
    ["lidos com outra credencial", () => escopos({ credencial: "refresh:outra" }), { motivo: "escopo_fora_de_ordem", para: "tudo" }],
    ["lidos há mais de 26 h", () => escopos({ em: minutos(-27 * 60) }), { motivo: "escopo_fora_de_ordem", para: "tudo" }],
    ["nunca lidos", () => db.delete(beds24ReservasRotina).where(eq(beds24ReservasRotina.organizacaoId, c.org)), { motivo: "escopo_fora_de_ordem", para: "tudo" }],
    ["sem ensaio da credencial de agora", () => configurar({ ensaio: null }), { motivo: "sem_ensaio", para: "criacoes" }],
  ] as const)("%s: nenhum POST, nenhuma operação", async (_nome, preparar, configuracao) => {
    const x = await pagarEConfirmar(c);
    await preparar();
    expect(await rodar()).toMatchObject({ posts: 0, configuracao });
    expect(postsNoFalso()).toBe(0);
    expect(await operacoes(x.reservaId)).toEqual([]);
  });

  it("a leitura dos escopos do começo da volta falhou: nada é escrito", async () => {
    await pagarEConfirmar(c);
    expect(await rodar(minutos(10), { leituraDosEscoposFalhou: true })).toMatchObject({ posts: 0, configuracao: { motivo: "escopo_fora_de_ordem", para: "tudo" } });
    expect(postsNoFalso()).toBe(0);
  });
});

describe("teste 26 (integração): quem ocupa as noites antes de criar", () => {
  it.each([
    ["uma reserva de OTA", () => falso.bookings.push(registro({ id: 5550001, arrival: "2026-10-13", departure: "2026-10-16", referer: "Airbnb" })), "conflito", "noites_ocupadas", "conflito", undefined],
    ["a estadia em curso (chegou antes)", () => falso.bookings.push(registro({ id: 5550001, arrival: "2026-10-10", departure: "2026-10-13", channel: "Direct" })), "conflito", "noites_ocupadas", "conflito", undefined],
    ["um black", () => falso.bookings.push(registro({ id: 5550001, status: "black", arrival: "2026-10-13", departure: "2026-10-14" })), "aguardando_equipe", "bloqueio_manual", "conflito", { inicio: "2026-10-13", fim: "2026-10-14" }],
    ["um blackout feito à mão", () => (falso.calendarios = calendario({ "2026-10-13": { numAvail: 0, override: "blackout" } })), "aguardando_equipe", "bloqueio_manual", "conflito", { inicio: "2026-10-13", fim: "2026-10-14" }],
    [
      "o blackout do próprio M3.7",
      async () => {
        falso.calendarios = calendario({ "2026-10-13": { numAvail: 0, override: "blackout" }, "2026-10-14": { numAvail: 0, override: "blackout" } });
        await db.insert(beds24CalendarioEnviado).values(["2026-10-13", "2026-10-14"].map((data) => ({ organizacaoId: c.org, imovelId: c.imovel, data, roomId: "20", bloqueio: "blackout", enviadoEm: minutos(0), confirmado: true })));
      },
      "aguardando_equipe", "bloqueio_do_scl", "conflito", { inicio: "2026-10-13", fim: "2026-10-15" },
    ],
    ["um bloqueio do Beds24 importado no SCL", () => db.insert(bloqueios).values({ organizacaoId: c.org, imovelId: c.imovel, inicio: "2026-10-14", fim: "2026-10-16", fonte: "beds24", idFonte: "5550002" }), "aguardando_equipe", "bloqueio_manual", "conflito", { inicio: "2026-10-14", fim: "2026-10-15" }],
    ["sem unidade livre e sem ocupante", () => (falso.calendarios = calendario({ "2026-10-14": { numAvail: 0 } })), "aguardando_equipe", "sem_disponibilidade", "conflito", undefined],
  ] as const)("%s: nada é criado, a operação fica terminal e o acompanhamento pede a equipe", async (_nome, preparar, situacao, motivo, operacao, bloqueio) => {
    const x = await pagarEConfirmar(c);
    await preparar();
    expect(await rodar()).toMatchObject({ posts: 0, avisos: 1 });
    expect(falso.escritasReservas).toEqual([]);
    // A leitura de quem ocupa as noites 12, 13 e 14 pede a chegada explícita desde 1900: sem ela, o Beds24 só devolve as
    // reservas futuras, e a estadia em curso (chegada antes de hoje) sumiria.
    expect(falso.filtrosLidos).toContainEqual({ quarto: "20", chegadaDe: "1900-01-01", chegadaAte: "2026-10-14", saidaDe: "2026-10-13", incluirInfo: true });
    const [o] = await operacoes(x.reservaId);
    expect(o).toMatchObject({ situacao: operacao, enviadoEm: null });
    expect(o.terminadoEm).toBeInstanceOf(Date);
    expect(o.detalhe).toEqual(bloqueio ? { bloqueio } : {});
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao, motivo, otaFechadaEm: null });
    // Nada fica ativo, e a volta seguinte não tenta de novo sozinha.
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0 });
    expect(await operacoes(x.reservaId)).toHaveLength(1);
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("a consulta e a cancelada não ocupam: a criação sai", async () => {
    const x = await pagarEConfirmar(c);
    falso.bookings.push(registro({ id: 5550001, status: "inquiry" }), registro({ id: 5550002, status: "cancelled", arrival: "2026-10-13" }));
    expect(await rodar()).toMatchObject({ posts: 1, conferidas: 1 });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("5550003");
  });

  it.each([
    ["uma reserva do quarto em formato inválido", () => falso.bookings.push(registro({ id: 5550001, status: "estranha", arrival: "2026-10-13" }))],
    ["o calendário sem uma das noites", () => (falso.calendarios = calendario({}, "2026-10-13"))],
    ["o calendário em formato inválido", () => (falso.calendarios = calendario({ "2026-10-13": { numAvail: "muitas" } }))],
    [
      // A chegada (13/10) deixa a busca da marca de fora (ela lê a chegada exata, 12/10, e tem a guarda própria): só a leitura
      // de quem ocupa vê o id repetido. `cancelled` não ocupa: sem a guarda, a conclusão seria `livre` e sairia um POST.
      "o mesmo registro duas vezes",
      () => falso.bookings.push(registro({ id: 5550001, status: "cancelled", arrival: "2026-10-13", departure: "2026-10-14" }), registro({ id: 5550001, status: "cancelled", arrival: "2026-10-13", departure: "2026-10-14" })),
    ],
    ["os quartos do Beds24 não vêm", () => (falso.falhar = new ErroBeds24("Beds24 respondeu HTTP 503.", "http"))],
  ] as const)("a leitura que não conclui (%s) é falha antes do POST, nunca 'livre'", async (_nome, preparar) => {
    const x = await pagarEConfirmar(c);
    preparar();
    expect(await rodar()).toMatchObject({ posts: 0, falhas: 1 });
    expect(falso.escritasReservas).toEqual([]);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "pendente", enviadoEm: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", tentativas: 1, proximaTentativaEm: minutos(20) });
  });

  it("o calendário que cai no meio da leitura de quem ocupa: falha antes do POST (a volta não cai nem deixa a operação enviando)", async () => {
    const x = await pagarEConfirmar(c);
    vi.spyOn(falso, "calendario").mockRejectedValueOnce(new ErroBeds24("Beds24 respondeu HTTP 503.", "http", 503));
    expect(await rodar()).toMatchObject({ posts: 0, falhas: 1, parada: null });
    expect(falso.escritasReservas).toEqual([]);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "pendente", enviadoEm: null, erro: "Beds24 respondeu HTTP 503." });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", tentativas: 1, proximaTentativaEm: minutos(20) });
  });

  it.each([
    ["o quarto inacessível à credencial", () => (falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 21, name: "Outro" }] }])],
    ["a moeda diferente de BRL", () => (falso.properties = [{ id: 10, currency: "USD", roomTypes: [{ id: 20, name: "Studio" }] }])],
    ["sem vínculo no SCL", () => db.delete(idsExternos).where(eq(idsExternos.imovelId, c.imovel))],
  ] as const)("%s: pendente/sem_vinculo, sem tentativa, sem e-mail e sem operação (nem uma por volta)", async (_nome, preparar) => {
    const x = await pagarEConfirmar(c);
    await preparar();
    expect(await rodar()).toMatchObject({ posts: 0, falhas: 0 });
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0, falhas: 0 });
    expect(falso.escritasReservas).toEqual([]);
    expect(await operacoes(x.reservaId)).toEqual([]);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", motivo: "sem_vinculo", tentativas: 0, versao: 0 });
  });
});

describe("a marca já no Beds24 antes de criar (desenho 3.5 e 4.1)", () => {
  it("um registro nosso com a marca: adota sem POST, grava o id e confere", async () => {
    const x = await pagarEConfirmar(c);
    falso.bookings.push(registro({ id: 777001, infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }], apiSource: "API" }));
    expect(await rodar()).toMatchObject({ posts: 0, conferidas: 1 });
    expect(falso.escritasReservas).toEqual([]);
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("777001");
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "conferida", beds24Id: "777001", enviadoEm: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", otaFechadaEm: minutos(10) });
  });

  it.each([
    ["duas cópias com a marca", (codigo: string) => [registro({ id: 777001, infoItems: [{ code: INFO_MARCA_SCL, text: codigo }], apiSource: "API" }), registro({ id: 777002, infoItems: [{ code: INFO_MARCA_SCL, text: codigo }], apiSource: "API" })], "duplicada", ["777001", "777002"]],
    ["o código só nas notas de uma reserva de OTA", (codigo: string) => [registro({ id: 777003, notes: `ver ${codigo}`, referer: "Airbnb" })], "marca_em_registro_inesperado", ["777003"]],
  ] as const)("%s: nenhum POST, a equipe decide com os ids", async (_nome, registros, motivo, ids) => {
    const x = await pagarEConfirmar(c);
    falso.bookings.push(...registros(x.reservaCodigo));
    expect(await rodar()).toMatchObject({ posts: 0, avisos: 1 });
    expect(falso.escritasReservas).toEqual([]);
    expect((await c.reserva(x.reservaId)).beds24Id).toBeNull();
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "divergente", detalhe: { duplicadas: ids } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo });
  });
});

describe("o ocupante exato (desenho 3.8, item 5)", () => {
  /**
   * Um POST anterior desta reserva que deixou o registro sem marca: a `criar` dele terminou em `falhou` e nasceu a versão
   * seguinte, `pendente` (a nova tentativa da saída da incerteza, desenho 3.8, item 3, gravada aqui à mão).
   */
  async function comPostAnterior(origem: Obj) {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await rodar();
    falso.perderRespostaReserva = false;
    const [v1] = await operacoes(x.reservaId);
    await db.update(beds24ReservasOperacoes).set({ situacao: "falhou" }).where(eq(beds24ReservasOperacoes.id, v1.id));
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: c.org, reservaId: x.reservaId, acompanhamentoId: v1.acompanhamentoId, tipo: "criar", chave: chaveOperacaoBeds24("criar", x.reservaId, 2), modo: "real", pedido: v1.pedido, credencial: CREDENCIAL });
    await db.update(beds24ReservasSite).set({ versao: 2, situacao: "pendente" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    const b = falso.bookings[0];
    delete b.infoItems;
    delete b.apiSource;
    Object.assign(b, origem);
    return x;
  }

  it("o registro sem marca, com a origem da API, depois de um POST desta reserva: aguardando_equipe/incerta com o id sugerido, sem segundo POST", async () => {
    const x = await comPostAnterior({ apiSource: "API" });
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0, avisos: 1 });
    expect(falso.escritasReservas).toHaveLength(1);
    const [, v2] = await operacoes(x.reservaId);
    expect(v2).toMatchObject({ situacao: "divergente", detalhe: { candidato: "900001" }, beds24Id: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "incerta" });
    expect((await c.reserva(x.reservaId)).beds24Id).toBeNull();
  });

  it("um canal desconhecido sem a origem da API nunca basta: conflito", async () => {
    const x = await comPostAnterior({ channel: "Expedia" });
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0, avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conflito", motivo: "noites_ocupadas" });
  });

  it("um POST que o Beds24 não processou (429 sem a lista) não conta como POST anterior: a reserva direta nas mesmas datas é conflito", async () => {
    const x = await pagarEConfirmar(c);
    falso.responder429 = true;
    expect(await rodar()).toMatchObject({ posts: 1, parada: "limite" });
    falso.responder429 = false;
    // Depois do 429, a equipe criou à mão uma reserva direta nas mesmas datas (o falso não gravou nada com o 429).
    falso.bookings.push(registro({ id: 5550001, apiSource: "API", channel: "Direct" }));
    expect(await rodar(minutos(11))).toMatchObject({ posts: 0, avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conflito", motivo: "noites_ocupadas" });
    expect((await operacoes(x.reservaId)).map((o) => [o.situacao, o.detalhe])).toEqual([["falhou", {}], ["conflito", {}]]);
  });

  it("sem POST anterior, o mesmo registro é conflito/noites_ocupadas (uma reserva direta criada à mão)", async () => {
    const x = await pagarEConfirmar(c);
    falso.bookings.push(registro({ id: 5550001, apiSource: "API", channel: "Direct" }));
    expect(await rodar()).toMatchObject({ posts: 0, avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conflito", motivo: "noites_ocupadas" });
  });
});

describe("extra: a fila diante da régua (desenho 3.3)", () => {
  /** Uma `criar` na fila: o token não veio, e ela espera o atraso de 10 min. */
  async function naFila() {
    const x = await pagarEConfirmar(c);
    falso.falharToken = new ErroBeds24("Falha de rede ao pedir o token (fictícia).", "rede");
    await rodar();
    falso.falharToken = null;
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "pendente" });
    return x;
  }

  it("o imóvel desligado: a criar na fila vira superada, nenhum POST, e a marca manual volta a valer", async () => {
    const x = await naFila();
    await configurar({ ligado: false });
    expect(await rodar(minutos(25))).toMatchObject({ posts: 0 });
    expect(falso.escritasReservas).toEqual([]);
    expect((await operacoes(x.reservaId))[0].situacao).toBe("superada");
    expect(await marcarDatasFechadasNasOtas(db, admin, x.reservaId, PRONTO, minutos(26))).toEqual({ ok: true });
  });

  it.each([
    ["o imóvel desligado e religado", (): unknown => configurar({ ligado: false }), (): unknown => configurar()],
    [
      "o quarto inacessível e de volta",
      (): unknown => void (falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 21, name: "Outro" }] }]),
      (): unknown => void (falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Studio" }] }]),
    ],
  ] as const)("%s: a criar na fila vira superada sem a intenção no acompanhamento, e a volta seguinte à causa sumir cria", async (_nome, causa, desfaz) => {
    const x = await naFila();
    await causa();
    expect(await rodar(minutos(25))).toMatchObject({ posts: 0 });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("superada");
    expect((await acompanhamento(x.reservaId)).assinaturaEsperada).toBeNull();
    await desfaz();
    expect(await rodar(minutos(35))).toMatchObject({ posts: 1, conferidas: 1 });
    expect((await operacoes(x.reservaId)).map((o) => [o.chave, o.situacao])).toEqual([[chaveOperacaoBeds24("criar", x.reservaId, 1), "superada"], [chaveOperacaoBeds24("criar", x.reservaId, 2), "conferida"]]);
  });

  it("o quarto inacessível com o SCL mudado: a fase 1 para (pendente/sem_vinculo) e supera a da fila; o quarto de volta, cria com o estado de agora", async () => {
    const x = await naFila();
    falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 21, name: "Outro" }] }];
    await db.update(reservas).set({ hospedes: 3 }).where(eq(reservas.id, x.reservaId));
    expect(await rodar(minutos(25))).toMatchObject({ posts: 0, falhas: 0 });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "superada", enviadoEm: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", motivo: "sem_vinculo", assinaturaEsperada: null });
    falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Studio" }] }];
    expect(await rodar(minutos(35))).toMatchObject({ posts: 1, conferidas: 1 });
    expect(falso.escritasReservas).toEqual([{ metodo: "POST", corpo: corpoDaCriacao(x.reservaCodigo, { pessoas: 3 }) }]);
  });

  it("depois de 'Deixar à mão' (acompanhamento manual): a criar na fila vira superada e nunca sai", async () => {
    const x = await naFila();
    await db.update(beds24ReservasSite).set({ situacao: "manual", motivo: "deixada_a_mao" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    expect(await rodar(minutos(25))).toMatchObject({ posts: 0 });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("superada");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "manual", motivo: "deixada_a_mao" });
  });

  it("a cancelada antes de criar (o cancelamento decidido pela política): a fase 1 supera a criar na fila e segue para a leitura de 6.3, nenhum POST", async () => {
    const x = await naFila();
    const { resultado } = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), admin.usuarioId, minutos(20));
    expect(resultado.ok).toBe(true);
    expect(await abrirIntencao(db, c.org, x.reservaId, { agora: minutos(25), env: PRONTO, tipos: ["criar"] })).toEqual({ saida: "cancelar_antes_de_criar" });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "superada", enviadoEm: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", assinaturaEsperada: null });
    // A volta também não envia nada (a leitura de 6.3 é do passo dela).
    expect(await rodar(minutos(26))).toMatchObject({ posts: 0 });
    expect(falso.escritasReservas).toEqual([]);
  });

  it("a cancelada sem cancelamento decidido: a criar na fila vira superada, nenhum POST", async () => {
    const x = await naFila();
    await db.update(reservas).set({ estado: "cancelada", canceladaEm: minutos(20) }).where(eq(reservas.id, x.reservaId));
    expect(await abrirIntencao(db, c.org, x.reservaId, { agora: minutos(25), env: PRONTO, tipos: ["criar"] })).toEqual({ saida: "nada" });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("superada");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente" });
    expect(falso.escritasReservas).toEqual([]);
  });

  it("o modo que só enfileira (os botões) não para pela escrita em andamento de outra reserva: grava a fila sem enviar", async () => {
    const x = await pagarEConfirmar(c);
    // Uma operação de outra reserva entre a escrita externa e o registro final (o ensaio, sem reserva), há pouco.
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: c.org, tipo: "ensaio", chave: "ensaio:em-andamento-ficticio", modo: "real", situacao: "enviando", credencial: CREDENCIAL });
    expect(await abrirIntencao(db, c.org, x.reservaId, { agora: minutos(10), env: PRONTO, tipos: ["criar"] })).toEqual({ saida: "parar_volta", motivo: "em_andamento" });
    expect(await operacoes(x.reservaId)).toEqual([]);
    // Bloco D (revisão): o modo que só enfileira diz qual operação ficou na fila (antes, `nada`, igual à recusa da régua).
    const aberta = await abrirIntencao(db, c.org, x.reservaId, { agora: minutos(10), env: PRONTO, tipos: ["criar"], soEnfileirar: true });
    expect(await operacoes(x.reservaId)).toMatchObject([{ chave: chaveOperacaoBeds24("criar", x.reservaId, 1), situacao: "pendente", enviadoEm: null, tentativas: 0 }]);
    expect(aberta).toEqual({ saida: "enfileirada", operacaoId: (await operacoes(x.reservaId))[0].id });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", versao: 1 });
    expect(falso.chamadas).toBe(0);
  });

  it("a confirmada antes da ligação do imóvel: a linha manual/anterior_a_ligar, sem quarto e sem operação; nenhum POST", async () => {
    const x = await pagarEConfirmar(c);
    await configurar({ ligadoEm: minutos(30).toISOString() });
    expect(await rodar(minutos(40))).toMatchObject({ posts: 0 });
    expect(await operacoes(x.reservaId)).toEqual([]);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "manual", motivo: "anterior_a_ligar", roomId: null, versao: 0 });
    expect(await rodar(minutos(50))).toMatchObject({ posts: 0 });
    expect(falso.escritasReservas).toEqual([]);
    expect((await tarefasDasOtas(db, c.org, minutos(50), PRONTO)).tarefas.map((t) => [t.caso, t.estado])).toEqual([["paga", "manual"]]);
  });
});

describe("o passo 1 da volta: a queda antes do POST e o fim do acompanhamento", () => {
  it("a enviando vencida sem enviado_em volta a pendente sem leitura; a volta seguinte envia", async () => {
    const x = await pagarEConfirmar(c);
    // A queda: a fase 1 terminou e o processo caiu antes do POST.
    await rodar(minutos(10), { ganchos: { antesDaFase2: () => { throw new Error("queda fictícia"); } } }).catch(() => null);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "enviando", enviadoEm: null });
    expect(await devolverVencidasSemPost(db, c.org, minutos(15))).toBe(0);
    await db.update(beds24ReservasOperacoes).set({ iniciadoEm: sql`now() - interval '7 minutes'` }).where(eq(beds24ReservasOperacoes.reservaId, x.reservaId));
    const lidas = falso.filtrosLidos.length;
    expect(await devolverVencidasSemPost(db, c.org, minutos(17))).toBe(1);
    expect(falso.filtrosLidos).toHaveLength(lidas);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "pendente", enviadoEm: null });
    // A marca do acompanhamento vem do relógio da volta (`agora`), como nas outras gravações dele.
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", tentativas: 0, atualizadoEm: minutos(17) });
    expect(await rodar(minutos(20))).toMatchObject({ posts: 1, conferidas: 1 });
  });

  it("a enviando vencida que teve POST nunca volta a pendente (a volta seguinte mandaria um segundo POST), nem o ensaio", async () => {
    const x = await pagarEConfirmar(c);
    // A queda depois do POST: o id e a resposta gravados, a fase 3 nunca rodou.
    await rodar(minutos(10), { ganchos: { antesDaFase3: () => { throw new Error("queda fictícia"); } } }).catch(() => null);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "enviando", beds24Id: "900001" });
    // O ensaio enviando, sem reserva e sem `enviado_em` (tem a saída própria, "Conferir o ensaio").
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: c.org, tipo: "ensaio", chave: "ensaio:vencido-ficticio", modo: "real", situacao: "enviando", credencial: CREDENCIAL });
    await db.update(beds24ReservasOperacoes).set({ iniciadoEm: sql`now() - interval '7 minutes'` }).where(eq(beds24ReservasOperacoes.organizacaoId, c.org));
    expect(await devolverVencidasSemPost(db, c.org, minutos(20))).toBe(0);
    const linhas = await db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.organizacaoId, c.org)).orderBy(asc(beds24ReservasOperacoes.chave));
    expect(linhas.map((o) => [o.tipo, o.situacao, o.enviadoEm instanceof Date])).toEqual([["criar", "enviando", true], ["ensaio", "enviando", false]]);
    expect(falso.escritasReservas).toHaveLength(1);
  });

  it("divergente/marca_ilegivel com a saída antes de hoje: encerrada (com a auditoria), e a criação de outra reserva volta a sair", async () => {
    const y = await pagarEConfirmar(c);
    const z = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "z@example.com" });
    await db.insert(beds24ReservasSite).values({ organizacaoId: c.org, reservaId: y.reservaId, imovelId: c.imovel, referencia: y.reservaCodigo, roomId: "20", propertyId: "10", situacao: "divergente", motivo: "marca_ilegivel", versao: 1 });
    expect(await rodar()).toMatchObject({ posts: 0, configuracao: { motivo: "marca_ilegivel", para: "criacoes" } });
    const depois = new Date("2026-10-16T12:00:00Z");
    expect(await encerrarTerminadas(db, c.org, minutos(10))).toBe(0);
    // O dia é o de São Paulo: às 23:59 de 15/10 lá (02:59 UTC de 16/10) a saída é hoje e nada encerra; à meia-noite, encerra.
    expect(await encerrarTerminadas(db, c.org, new Date("2026-10-16T02:59:00Z"))).toBe(0);
    expect(await encerrarTerminadas(db, c.org, new Date("2026-10-16T03:00:00Z"))).toBe(1);
    expect(await acompanhamento(y.reservaId)).toMatchObject({ situacao: "encerrada", motivo: null });
    const [auditada] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.encerrar")));
    expect(auditada).toMatchObject({ entidadeId: y.reservaId, usuarioId: null, mudancas: { situacaoNoBeds24: ["divergente", "encerrada"], motivoNoBeds24: ["marca_ilegivel", null] } });
    await escopos({ em: depois });
    expect(await rodar(depois)).toMatchObject({ posts: 1, conferidas: 1, configuracao: null });
    expect((await c.reserva(z.reservaId)).beds24Id).toBe("900001");
  });

  it("não encerra com uma operação em curso nem a linha manual", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await rodar();
    const m = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "m@example.com" });
    await db.insert(beds24ReservasSite).values({ organizacaoId: c.org, reservaId: m.reservaId, imovelId: c.imovel, referencia: m.reservaCodigo, situacao: "manual", motivo: "deixada_a_mao" });
    expect(await encerrarTerminadas(db, c.org, new Date("2026-10-30T12:00:00Z"))).toBe(0);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "em_envio" });
  });

  it("não encerra com a criação feita (fora das ativas: o passo 1 da volta ainda a confere)", async () => {
    const x = await pagarEConfirmar(c);
    falso.lento = () => {
      if (falso.escritasReservas.length) falso.falhar = new ErroBeds24("Beds24 não respondeu a tempo.", "tempo");
    };
    await rodar();
    expect((await operacoes(x.reservaId))[0].situacao).toBe("feita");
    expect(await encerrarTerminadas(db, c.org, new Date("2026-10-30T12:00:00Z"))).toBe(0);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "em_envio" });
  });
});
