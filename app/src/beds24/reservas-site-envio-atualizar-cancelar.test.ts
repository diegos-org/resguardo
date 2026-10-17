/**
 * Reserva paga do site no Beds24 (M8.3c) — a atualização, o cancelamento e as marcas (desenho 3.3, 3.6, 4.2 a 4.4 e 6.3;
 * plano, testes 21 (o "Reenviar" no domínio), 27, 28, 29, 30 e 36, e a ordem das travas da fase 3): a releitura por id antes
 * de escrever, só as noites novas, as duplicadas, o bloqueio que sobrou, as datas atualizadas e reabertas nas OTAs pelo
 * sistema e a cancelada antes de ser criada. PGlite, os cenários do pagamento, o Beds24 falso, `CorreioMemoria` e um espião de
 * `fetch` que nunca é chamado: nada vai ao Beds24. O `env` é sempre explícito (`PRONTO`), e o cliente é o falso injetado.
 */
import type { PGlite } from "@electric-sql/pglite";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { gravarConfig } from "@/configuracoes/armazem";
import * as schema from "@/db/schema";
import { alteracoesReserva, auditoria, beds24ReservasOperacoes, beds24ReservasSite, cancelamentosReserva } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { cancelarReservaContestada, marcarOtaLiberada, previaDoCancelamentoContestado } from "@/pagamentos/cancelamento";
import { conferirTentativa } from "@/pagamentos/conferencia";
import { alterar, type Cenario, cancelar, EMAIL_HOSPEDE, entradaPadrao, env, minutos, montarCenario, NOME_HOSPEDE, pagarEConfirmar, semDadosPessoais, TELEFONE_HOSPEDE, usuarioDeTeste } from "@/pagamentos/testes";
import { Beds24Falso, ESCOPOS_ESPERADOS_FALSO } from "./falso";
import { impressaoCredencialBeds24 } from "./http";
import { INFO_MARCA_SCL } from "./normalizar";
import { avisarEquipeDasReservasNoBeds24 } from "./reservas-site-avisos";
import { abrirIntencao, cancelarAntesDeCriar, ERRO_CANCELAMENTO_SEM_MARCA, ERRO_SEM_ACESSO_A_RESERVA, enviarReservasDoSite, type OpcoesDoEnvio, resolverOperacaoEmCurso, resolverOperacoesEmCurso } from "./reservas-site-envio";
import { chaveOperacaoBeds24 } from "./reservas-site-regras";
import { gravarEscoposLidos } from "./reservas-site-rotina";
import { tarefasDasOtas } from "./reservas-site-tarefas";
import { ErroBeds24 } from "./tipos";

/** O deploy de produção com a chave das reservas e o refresh token (fictício): a trava de ambiente aberta. */
const PRONTO = env({ VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" });
const CREDENCIAL = impressaoCredencialBeds24(PRONTO);
const ENSAIO = { credencial: CREDENCIAL, em: "2026-09-01T00:00:00.000Z", operacaoId: "6f1c2a7e-3b4d-4c5e-8f90-123456789abc" };
const EMAIL_EQUIPE = "equipe@example.com";
/** A alteração sem mudar o valor (aplicada na hora, sem cobrança nem devolução): só as datas ou as pessoas mudam. */
const MANTIDO = { origem: "mantido" as const, motivo: "acordo_com_hospede" as const, nota: "Combinado com o hóspede" };
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
  // O endereço da empresa (fictício): o e-mail à equipe vai para ele, e só para ele.
  await gravarConfig(db, c.org, "empresa", { email: EMAIL_EQUIPE }, null);
});
afterEach(() => {
  expect(espiao).not.toHaveBeenCalled();
  espiao.mockRestore();
});

/** Um dia por faixa, de 01/10 a 30/11, com uma unidade livre por noite e `especiais` por dia. */
function calendario(especiais: Record<string, Obj> = {}) {
  const dias: Obj[] = [];
  for (let d = "2026-10-01"; d <= "2026-11-30"; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) dias.push({ from: d, to: d, numAvail: 1, price1: 450, ...especiais[d] });
  return [{ roomId: 20, calendar: dias }];
}
const configurar = (o: { ensaio?: typeof ENSAIO | null; ligado?: boolean } = {}) =>
  gravarConfig(
    db, c.org, "reservas_beds24",
    { pausado: null, retomado: null, imoveis: o.ligado === false ? [] : [{ imovelId: c.imovel, ligadoEm: "2026-09-01T00:00:00.000Z", ligadoPor: null }], ensaio: o.ensaio === undefined ? ENSAIO : o.ensaio },
    null,
  );
/** A leitura dos escopos guardada: por padrão, exatamente os do convite, com a credencial `PRONTO`, lidos em `em`. */
const escopos = (o: { lista?: string[]; credencial?: string; em?: Date } = {}) =>
  gravarEscoposLidos(db, c.org, o.credencial ?? CREDENCIAL, { escopos: o.lista ?? [...ESCOPOS_ESPERADOS_FALSO], ilegiveis: [] }, o.em ?? minutos(0));
const opcoes = (agora: Date, o: Partial<OpcoesDoEnvio> = {}): OpcoesDoEnvio => ({ env: PRONTO, relogio: { agora: () => agora, restanteMs: () => 240_000 }, ...o });
/** Os passos 2 a 4 da volta (cancelar → atualizar → criar). */
const rodar = (agora: Date, o: Partial<OpcoesDoEnvio> = {}, banco: Db = db) => enviarReservasDoSite(banco, c.org, falso, opcoes(agora, o));
const operacoes = (reservaId: string) => db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.reservaId, reservaId)).orderBy(asc(beds24ReservasOperacoes.chave));
const daReserva = async (reservaId: string, tipo: string) => (await operacoes(reservaId)).filter((o) => o.tipo === tipo);
const acompanhamento = async (reservaId: string) => (await db.select().from(beds24ReservasSite).where(eq(beds24ReservasSite.reservaId, reservaId)))[0];
const cancelamento = async (reservaId: string) => (await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, reservaId)))[0];
const alteracao = async (id: string) => (await db.select().from(alteracoesReserva).where(eq(alteracoesReserva.id, id)))[0];
const auditadas = (acao: string) => db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, acao)));
/** Um registro do Beds24 no quarto 20 (formato da API, dados fictícios). */
const registro = (o: Obj) => ({ propertyId: 10, roomId: 20, status: "confirmed", arrival: "2026-10-12", departure: "2026-10-15", numAdult: 4, ...o });
/** O registro que o sistema criou (o id 900001 do falso). */
const noBeds24 = (id = "900001") => falso.bookings.find((b) => String(b.id) === id)!;
const semDados = (correio?: CorreioMemoria) => semDadosPessoais(db, [EMAIL_HOSPEDE, TELEFONE_HOSPEDE], { nomes: [NOME_HOSPEDE], correio });

/** A reserva paga, criada pelo sistema (o id 900001) e conferida na volta de 10 min. */
async function criada(o: Parameters<typeof pagarEConfirmar>[1] = {}) {
  const x = await pagarEConfirmar(c, o);
  expect(await rodar(minutos(10))).toMatchObject({ criadas: 1, conferidas: 1 });
  return x;
}
/** Uma alteração aplicada na hora, sem mudar o valor (as datas ou as pessoas de `over`). */
async function alterada(reservaId: string, over: { checkin?: string; checkout?: string; hospedes?: number }, quando: Date) {
  const { resultado } = await alterar(c, reservaId, { ...over, valor: MANTIDO }, quando, { autorId: admin.usuarioId, aplicar: true });
  if (!resultado.ok || !("alteracaoId" in resultado)) throw new Error(`alteração não aplicada: ${JSON.stringify(resultado)}`);
  return resultado.alteracaoId;
}
const pelaPolitica = (reservaId: string, quando: Date) => cancelar(c, reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), admin.usuarioId, quando);

describe("teste 27: a atualização", () => {
  it("as noites novas conferidas e enviadas: o corpo exato, a auditoria, a releitura e as datas atualizadas nas OTAs pelo sistema", async () => {
    const x = await criada();
    const alteracaoId = await alterada(x.reservaId, { checkout: "2026-10-16" }, minutos(20));
    falso.filtrosLidos = [];
    expect(await rodar(minutos(30))).toMatchObject({ posts: 1, atualizadas: 1, conferidas: 1, avisos: 0 });
    expect(falso.escritasReservas.at(-1)).toEqual({ metodo: "POST", corpo: [{ id: 900001, arrival: "2026-10-12", departure: "2026-10-16", numAdult: 4 }] });
    // A releitura por id antes de escrever e a leitura de quem ocupa só a noite nova (15/10).
    expect(falso.filtrosLidos.slice(0, 2)).toEqual([
      { ids: ["900001"], chegadaDe: "1900-01-01", incluirInfo: true },
      { quarto: "20", chegadaDe: "1900-01-01", chegadaAte: "2026-10-15", saidaDe: "2026-10-16", incluirInfo: true },
    ]);
    const [v2] = await daReserva(x.reservaId, "atualizar");
    expect(v2).toMatchObject({ chave: chaveOperacaoBeds24("atualizar", x.reservaId, 2), situacao: "conferida", resposta: "modificada", beds24Id: "900001", alteracoes: [alteracaoId] });
    expect(v2.antes).toEqual({ quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada" });
    expect(v2.depois).toEqual({ quarto: "20", chegada: "2026-10-12", saida: "2026-10-16", hospedes: 4, situacao: "confirmada" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null, versao: 2, otaFechadaEm: minutos(10) });
    expect(await alteracao(alteracaoId)).toMatchObject({ otaAtualizadaEm: minutos(30), otaAtualizadaPor: null });
    expect(await auditadas("beds24.reserva.atualizar")).toMatchObject([{ entidadeId: x.reservaId, usuarioId: null, mudancas: { saida: ["2026-10-15", "2026-10-16"] } }]);
    // A tarefa da alterada some (o sistema marcou), e a volta seguinte não manda nada.
    expect((await tarefasDasOtas(db, c.org, minutos(35), PRONTO)).tarefas).toEqual([]);
    expect(await rodar(minutos(40))).toMatchObject({ posts: 0 });
    expect(await semDados()).toEqual([]);
  });

  it("a alteração só de pessoas também sai e é marcada", async () => {
    const x = await criada();
    const alteracaoId = await alterada(x.reservaId, { hospedes: 3 }, minutos(20));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 1, atualizadas: 1, conferidas: 1 });
    expect(falso.escritasReservas.at(-1)?.corpo).toEqual([{ id: 900001, arrival: "2026-10-12", departure: "2026-10-15", numAdult: 3 }]);
    expect(await alteracao(alteracaoId)).toMatchObject({ otaAtualizadaEm: minutos(30), otaAtualizadaPor: null });
  });

  it("só os ids lidos na fase 1 são marcados: as alterações gravadas no meio (com um `agora` de antes) ficam sem a marca", async () => {
    const x = await criada();
    const primeira = await alterada(x.reservaId, { checkout: "2026-10-16" }, minutos(20));
    const noMeio: string[] = [];
    // Entre a fase 1 e a fase 2: duas alterações de pessoas (4 → 3 → 4) com o relógio de antes da volta; o SCL volta ao mesmo.
    const ganchos = { antesDaFase2: async () => { if (!noMeio.length) noMeio.push(await alterada(x.reservaId, { hospedes: 3 }, minutos(25)), await alterada(x.reservaId, { hospedes: 4 }, minutos(26))); } };
    expect(await rodar(minutos(30), { ganchos })).toMatchObject({ atualizadas: 1, conferidas: 1 });
    expect((await daReserva(x.reservaId, "atualizar"))[0].alteracoes).toEqual([primeira]);
    expect(await alteracao(primeira)).toMatchObject({ otaAtualizadaEm: minutos(30) });
    for (const id of noMeio) expect(await alteracao(id)).toMatchObject({ otaAtualizadaEm: null });
  });

  it("as noites novas vendidas no meio por uma OTA: conflito, nenhum POST, e o e-mail diz que o sistema não mudou as datas", async () => {
    const x = await criada();
    await alterada(x.reservaId, { checkout: "2026-10-17" }, minutos(20));
    falso.bookings.push(registro({ id: 5550001, arrival: "2026-10-16", departure: "2026-10-18", referer: "Airbnb" }));
    const correio = new CorreioMemoria();
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0, avisos: 1 });
    expect(falso.escritasReservas).toHaveLength(1);
    expect((await daReserva(x.reservaId, "atualizar"))[0]).toMatchObject({ situacao: "conflito", enviadoEm: null, antes: { chegada: "2026-10-12", saida: "2026-10-15" } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conflito", motivo: "noites_ocupadas", otaFechadaEm: minutos(10) });
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(31))).toMatchObject({ enviados: 1 });
    // Só as noites novas estão ocupadas: o texto fala da mudança (12/10 a 17/10), nunca de todas as noites como ocupadas.
    expect(correio.enviadas[0].texto).toContain(`a mudança da reserva ${x.reservaCodigo} (paga pelo site, imóvel 403) para de 12/10 a 17/10 encontrou noites novas ocupadas`);
    expect(correio.enviadas[0].texto).toContain("O sistema não mudou as datas da reserva no Beds24.");
    expect(correio.enviadas[0].texto).not.toContain("não criou nada");
    // A régua suspende a atualização seguinte até a equipe decidir.
    expect(await rodar(minutos(40))).toMatchObject({ posts: 0 });
    expect(await semDados(correio)).toEqual([]);
  });

  it("o overbooking nas noites novas depois do POST: conferida com noites_ocupadas, o e-mail próprio, e a atualização seguinte ainda sai", async () => {
    const x = await criada();
    await alterada(x.reservaId, { checkout: "2026-10-16" }, minutos(20));
    // Logo depois da atualização, o Beds24 passa a informar -1 na noite nova (outra reserva chegou junto pelo canal).
    falso.lento = () => {
      if (falso.escritasReservas.length < 2) return;
      const dia = (falso.calendarios[0].calendar as Obj[]).find((d) => d.from === "2026-10-15");
      if (dia) dia.numAvail = -1;
    };
    const correio = new CorreioMemoria();
    expect(await rodar(minutos(30))).toMatchObject({ atualizadas: 1, conferidas: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: "noites_ocupadas", avisadaEm: null });
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(31))).toMatchObject({ enviados: 1 });
    expect(correio.enviadas[0].assunto).toBe(`Overbooking no Beds24: reserva ${x.reservaCodigo}`);
    falso.lento = null;
    await alterada(x.reservaId, { checkout: "2026-10-17" }, minutos(40));
    expect(await rodar(minutos(50))).toMatchObject({ posts: 1, atualizadas: 1, conferidas: 1 });
    expect(falso.escritasReservas.at(-1)?.corpo).toEqual([{ id: 900001, arrival: "2026-10-12", departure: "2026-10-17", numAdult: 4 }]);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null });
  });

  it.each([
    ["cancelada no Beds24", { status: "cancelled" }, "cancelada_no_beds24", null],
    ["num bloqueio (black)", { status: "black" }, "mudada_no_beds24", null],
    ["noutro quarto", { roomId: 21 }, "mudada_no_beds24", null],
    ["sem a marca (o info item apagado)", { infoItems: [] }, "marca_ilegivel", "fica"],
  ] as const)("o registro relido antes de atualizar está %s: nada é enviado, divergente com o motivo", async (_nome, mudanca, motivo, marca) => {
    const x = await criada();
    await alterada(x.reservaId, { checkout: "2026-10-16" }, minutos(20));
    Object.assign(noBeds24(), mudanca);
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0, avisos: 1 });
    expect(falso.escritasReservas).toHaveLength(1);
    expect((await daReserva(x.reservaId, "atualizar"))[0]).toMatchObject({ situacao: "divergente", enviadoEm: null });
    // A reserva confirmada que o Beds24 desfez reabre a pendência das datas nas OTAs; só a marca, não.
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo, otaFechadaEm: marca ? minutos(10) : null });
  });

  it("a atualização que relê o registro sem a marca para as criações já nesta volta", async () => {
    const x = await criada();
    await alterada(x.reservaId, { checkout: "2026-10-16" }, minutos(20));
    const z = await pagarEConfirmar(c, { entrada: "2026-10-25", saida: "2026-10-27", email: "z@example.com" });
    Object.assign(noBeds24(), { infoItems: [] });
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0, criadas: 0, configuracao: { motivo: "marca_ilegivel", para: "criacoes" } });
    expect(await operacoes(z.reservaId)).toEqual([]);
  });

  it("o registro apagado: divergente/apagada_no_beds24; com a credencial trocada desde a criação, aguardando_equipe/sem_permissao e a marca fica", async () => {
    const x = await criada();
    await alterada(x.reservaId, { checkout: "2026-10-16" }, minutos(20));
    falso.bookings = [];
    await db.update(beds24ReservasSite).set({ credencial: "refresh:outra" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0, avisos: 1 });
    expect((await daReserva(x.reservaId, "atualizar"))[0]).toMatchObject({ situacao: "falhou", enviadoEm: null, erro: ERRO_SEM_ACESSO_A_RESERVA });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_permissao", otaFechadaEm: minutos(10) });
    // A mesma credencial (o acompanhamento de volta, como "Tentar de novo" deixaria): a reserva apagada no Beds24.
    await db.update(beds24ReservasSite).set({ credencial: CREDENCIAL, situacao: "pendente", motivo: null, assinaturaEsperada: null }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    expect(await rodar(minutos(40))).toMatchObject({ posts: 0, avisos: 1 });
    expect((await daReserva(x.reservaId, "atualizar")).at(-1)).toMatchObject({ situacao: "divergente" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "apagada_no_beds24", otaFechadaEm: null });
  });
});

describe("teste 21: 'Reenviar o que está no SCL' no domínio (forcar, só enfileira)", () => {
  /** A reserva criada e o registro mudado no Beds24 para 20 a 23/10; a conferência deixou o acompanhamento divergente. */
  async function mudadaNoBeds24() {
    const x = await criada();
    // A equipe moveu a reserva no Beds24: as noites de 12 a 14 voltam a ficar livres, e as de 20 a 22 fechadas.
    Object.assign(noBeds24(), { arrival: "2026-10-20", departure: "2026-10-23" });
    falso.calendarios = calendario({ "2026-10-20": { numAvail: 0 }, "2026-10-21": { numAvail: 0 }, "2026-10-22": { numAvail: 0 } });
    await db.update(beds24ReservasSite).set({ situacao: "divergente", motivo: "mudada_no_beds24" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    return x;
  }
  const reenviar = (reservaId: string, agora: Date) => abrirIntencao(db, c.org, reservaId, { agora, env: PRONTO, tipos: ["atualizar"], soEnfileirar: true, forcar: "atualizar" });

  it("o mesmo estado já enviado: versão nova pendente, sem rede, a linha terminal intacta; a volta envia e confere", async () => {
    const x = await mudadaNoBeds24();
    const chamadas = falso.chamadas;
    // O botão sabe que enfileirou (a saída diz qual operação), sem reler o banco fora da trava.
    const aberta = await reenviar(x.reservaId, minutos(20));
    expect(aberta).toEqual({ saida: "enfileirada", operacaoId: expect.any(String) });
    expect(falso.chamadas).toBe(chamadas);
    const linhas = await operacoes(x.reservaId);
    expect(aberta).toMatchObject({ operacaoId: linhas[0].id });
    expect(linhas.map((o) => [o.tipo, o.chave, o.situacao, o.enviadoEm])).toEqual([
      ["atualizar", chaveOperacaoBeds24("atualizar", x.reservaId, 2), "pendente", null],
      ["criar", chaveOperacaoBeds24("criar", x.reservaId, 1), "conferida", expect.any(Date)],
    ]);
    expect(linhas[0].pedido).toMatchObject({ chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", motivo: null, versao: 2, proximaTentativaEm: minutos(20) });
    expect(await rodar(minutos(30))).toMatchObject({ posts: 1, atualizadas: 1, conferidas: 1 });
    expect(falso.escritasReservas.at(-1)?.corpo).toEqual([{ id: 900001, arrival: "2026-10-12", departure: "2026-10-15", numAdult: 4 }]);
    expect(noBeds24()).toMatchObject({ arrival: "2026-10-12", departure: "2026-10-15" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null });
  });

  it("teste 27: as noites que o Beds24 deixou livres vendidas por uma OTA (a base é o registro relido, nunca o esperado): conflito e nenhum POST", async () => {
    const x = await mudadaNoBeds24();
    falso.bookings.push(registro({ id: 5550001, arrival: "2026-10-13", departure: "2026-10-14", referer: "Airbnb" }));
    await reenviar(x.reservaId, minutos(20));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0, avisos: 1 });
    expect(falso.escritasReservas).toHaveLength(1);
    expect((await daReserva(x.reservaId, "atualizar"))[0]).toMatchObject({ situacao: "conflito", antes: { chegada: "2026-10-20", saida: "2026-10-23" } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conflito", motivo: "noites_ocupadas" });
  });

  it("o botão só abre a ação dele: a reserva manual ou a cancelada não ganham nada", async () => {
    const x = await mudadaNoBeds24();
    await db.update(beds24ReservasSite).set({ situacao: "manual", motivo: "deixada_a_mao" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    expect(await reenviar(x.reservaId, minutos(20))).toEqual({ saida: "nada" });
    await db.update(beds24ReservasSite).set({ situacao: "divergente", motivo: "mudada_no_beds24" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    expect((await pelaPolitica(x.reservaId, minutos(21))).resultado.ok).toBe(true);
    expect(await reenviar(x.reservaId, minutos(22))).toEqual({ saida: "nada" });
    expect((await operacoes(x.reservaId)).map((o) => o.tipo)).toEqual(["criar"]);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", versao: 1 });
  });
});

describe("teste 28: o cancelamento (D4: pela política, a contestada e o não comparecimento)", () => {
  /** O cancelamento conferido: um POST, as datas reabertas nas OTAs pelo sistema e o acompanhamento encerrado. */
  async function conferido(x: { reservaId: string }, agora: Date) {
    expect(await rodar(agora)).toMatchObject({ posts: 1, canceladas: 1, conferidas: 1, avisos: 0 });
    expect(falso.escritasReservas.at(-1)).toEqual({ metodo: "POST", corpo: [{ id: 900001, status: "cancelled" }] });
    expect(noBeds24().status).toBe("cancelled");
    const [v2] = await daReserva(x.reservaId, "cancelar");
    expect(v2).toMatchObject({ situacao: "conferida", resposta: "modificada", beds24Id: "900001", depois: { situacao: "cancelada" } });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: agora, otaLiberadaPor: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "encerrada", motivo: null });
    expect(await auditadas("beds24.reserva.cancelar")).toMatchObject([{ entidadeId: x.reservaId, usuarioId: null }]);
    // A tarefa da cancelada some, e nada mais sai.
    expect((await tarefasDasOtas(db, c.org, agora, PRONTO)).tarefas).toEqual([]);
    expect(await rodar(new Date(agora.getTime() + 600_000))).toMatchObject({ posts: 0 });
  }

  it("pela política", async () => {
    const x = await criada();
    expect((await pelaPolitica(x.reservaId, minutos(20))).resultado.ok).toBe(true);
    await conferido(x, minutos(30));
    expect(await semDados()).toEqual([]);
  });

  it("a contestada (Cancelar a reserva contestada)", async () => {
    const x = await criada({ liberar: true, entrada: "2026-11-20", saida: "2026-11-23" });
    c.provedor.contestar(x.idProvedor, "order");
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, new Date("2026-10-20T13:00:00Z"), { origem: "rotina", forcar: true });
    const quando = new Date("2026-10-21T13:00:00Z");
    const pv = await previaDoCancelamentoContestado(db, c.org, x.reservaId, quando);
    if (!pv.ok) throw new Error(pv.erro);
    expect(await cancelarReservaContestada(db, c.org, x.reservaId, { nota: "Possível fraude: o titular não reconhece.", assinatura: pv.previa.assinatura }, admin.usuarioId, c.provedor, quando)).toMatchObject({ ok: true });
    const volta = new Date("2026-10-21T13:10:00Z");
    await escopos({ em: volta });
    await conferido(x, volta);
  });

  it("o não comparecimento", async () => {
    const x = await criada();
    // A entrada era 12/10 às 15h (São Paulo); o não comparecimento vale 21 h depois.
    const quando = new Date("2026-10-13T16:00:00Z");
    expect((await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "nao_comparecimento" }), admin.usuarioId, quando)).resultado.ok).toBe(true);
    const volta = new Date("2026-10-13T16:10:00Z");
    await escopos({ em: volta });
    await conferido(x, volta);
  });

  it("um black que sobrou sobre as noites: nada é marcado, manual/bloqueio_manual, e a tarefa diz o bloqueio achado", async () => {
    const x = await criada();
    falso.bookings.push(registro({ id: 5550002, status: "black", arrival: "2026-10-13", departure: "2026-10-14" }));
    await pelaPolitica(x.reservaId, minutos(20));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 1, canceladas: 1, avisos: 1 });
    expect((await daReserva(x.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "conferida", detalhe: { bloqueio: { inicio: "2026-10-13", fim: "2026-10-14" } } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "manual", motivo: "bloqueio_manual" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: null });
    const t = await tarefasDasOtas(db, c.org, minutos(31), PRONTO);
    expect(t.tarefas.map((y) => [y.caso, y.estado, y.texto])).toEqual([["cancelada_bloqueio", "manual", "Mude o bloqueio de 13/10 a 14/10 para Cancelado (não apague)."]]);
    expect(t.avisos.map((a) => a.texto)).toContain(`Reserva ${x.reservaCodigo}, cancelada: mude o bloqueio de 13/10 a 14/10 para Cancelado (não apague).`);
    // A volta seguinte não mexe na reserva manual.
    expect(await rodar(minutos(40))).toMatchObject({ posts: 0 });
  });

  it("as duplicadas nossas canceladas na mesma operação, um POST cada, com os ids gravados antes do primeiro POST", async () => {
    const x = await criada();
    falso.bookings.push(registro({ id: 777001, apiSource: "API", infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }] }));
    await pelaPolitica(x.reservaId, minutos(20));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 2, canceladas: 1, conferidas: 1 });
    expect(falso.escritasReservas.slice(1).map((e) => e.corpo)).toEqual([[{ id: 900001, status: "cancelled" }], [{ id: 777001, status: "cancelled" }]]);
    expect(noBeds24("777001").status).toBe("cancelled");
    expect((await daReserva(x.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "conferida", detalhe: { duplicadas: ["777001"] } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "encerrada" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: minutos(30) });
    // O fato na auditoria, uma vez: o principal cancelado e os ids das duplicadas que a operação mandou cancelar.
    expect(await auditadas("beds24.reserva.cancelar")).toMatchObject([{ usuarioId: null, mudancas: { situacaoNoBeds24: ["confirmada", "cancelada"], duplicadas: [null, ["777001"]] } }]);
  });

  it("a queda entre o primeiro e o segundo POST das duplicadas: nada é marcado, aguardando_equipe/duplicada; cancelada lá, 'Conferir agora' marca", async () => {
    const x = await criada();
    falso.bookings.push(registro({ id: 777001, apiSource: "API", infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }] }));
    await pelaPolitica(x.reservaId, minutos(20));
    const gravar = falso.gravarReservas.bind(falso);
    let n = 0;
    vi.spyOn(falso, "gravarReservas").mockImplementation((item) => {
      if (++n === 2) throw new Error("queda fictícia");
      return gravar(item);
    });
    await rodar(minutos(30)).catch(() => null);
    const [v2] = await daReserva(x.reservaId, "cancelar");
    expect(v2).toMatchObject({ situacao: "enviando", resposta: "modificada", detalhe: { duplicadas: ["777001"] } });
    expect(v2.enviadoEm).toBeInstanceOf(Date);
    await db.update(beds24ReservasOperacoes).set({ iniciadoEm: sql`now() - interval '7 minutes'` }).where(eq(beds24ReservasOperacoes.id, v2.id));
    vi.mocked(falso.gravarReservas).mockRestore();
    expect(await resolverOperacoesEmCurso(db, c.org, falso, opcoes(minutos(40)))).toMatchObject({ resolvidas: 1, avisos: 1 });
    expect((await daReserva(x.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "feita", detalhe: { duplicadas: ["777001"] } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "duplicada" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: null });
    // A queda antes da fase 3: o fato aceito vai para a auditoria na saída que relê o registro igual ao pedido, uma vez só.
    expect(await auditadas("beds24.reserva.cancelar")).toMatchObject([{ mudancas: { duplicadas: [null, ["777001"]] } }]);
    // A equipe cancela a duplicada no Beds24; a mesma saída ("Conferir agora") confere de novo e marca.
    noBeds24("777001").status = "cancelled";
    expect(await resolverOperacaoEmCurso(db, c.org, v2.id, falso, opcoes(minutos(50)))).toEqual({ fechamento: "encerrada" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: minutos(50) });
    expect(await auditadas("beds24.reserva.cancelar")).toHaveLength(1);
  });

  it("uma reserva de OTA com o código só nas notas, nas mesmas datas, nunca é cancelada: nada é marcado, e a equipe confere", async () => {
    const x = await criada();
    falso.bookings.push(registro({ id: 5550003, referer: "Airbnb", notes: `ver ${x.reservaCodigo}` }));
    await pelaPolitica(x.reservaId, minutos(20));
    // Bloco D (revisão): antes, a conferência antes de liberar só olhava os nossos vivos, deixava passar este registro vivo com
    // a marca e marcava as datas reabertas (`conferidas: 1`). Desenho 4.3: "qualquer outra coisa vira aviso".
    expect(await rodar(minutos(30))).toMatchObject({ posts: 1, canceladas: 1, conferidas: 0, avisos: 1 });
    expect(falso.escritasReservas.slice(1).map((e) => e.corpo)).toEqual([[{ id: 900001, status: "cancelled" }]]);
    expect(noBeds24("5550003").status).toBe("confirmed");
    const [v2] = await daReserva(x.reservaId, "cancelar");
    expect(v2).toMatchObject({ situacao: "feita", detalhe: { duplicadas: ["5550003"] } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "marca_em_registro_inesperado" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: null });
    // O fato do cancelamento aceito fica na auditoria uma vez só, sem duplicadas mandadas cancelar.
    expect(await auditadas("beds24.reserva.cancelar")).toMatchObject([{ mudancas: { situacaoNoBeds24: ["confirmada", "cancelada"], duplicadas: [null, []] } }]);
    // "Conferir agora" repete a conferência e nunca cancela o registro da OTA; sem a marca nele (a equipe corrigiu), marca.
    expect(await resolverOperacaoEmCurso(db, c.org, v2.id, falso, opcoes(minutos(40)))).toEqual({ fechamento: "aguardando_equipe" });
    noBeds24("5550003").notes = "";
    expect(await resolverOperacaoEmCurso(db, c.org, v2.id, falso, opcoes(minutos(50)))).toEqual({ fechamento: "encerrada" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: minutos(50), otaLiberadaPor: null });
    expect(falso.escritasReservas).toHaveLength(2);
    expect(await auditadas("beds24.reserva.cancelar")).toHaveLength(1);
  });

  it("o registro já cancelado no Beds24: nenhum POST, só confere e marca", async () => {
    const x = await criada();
    noBeds24().status = "cancelled";
    await pelaPolitica(x.reservaId, minutos(20));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0, conferidas: 1 });
    expect(falso.escritasReservas).toHaveLength(1);
    expect((await daReserva(x.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "conferida", enviadoEm: null, resposta: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "encerrada" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: minutos(30), otaLiberadaPor: null });
    // Nada foi enviado: nenhuma auditoria de cancelamento que o sistema não fez.
    expect(await auditadas("beds24.reserva.cancelar")).toEqual([]);
  });

  it("o registro já cancelado e outro registro vivo com a marca (um nosso em request): nenhum POST, nada marcado, a equipe confere", async () => {
    const x = await criada();
    noBeds24().status = "cancelled";
    falso.bookings.push(registro({ id: 777003, status: "request", apiSource: "API", infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }] }));
    await pelaPolitica(x.reservaId, minutos(20));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0, conferidas: 0, avisos: 1 });
    expect(falso.escritasReservas).toHaveLength(1);
    expect((await daReserva(x.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "feita", enviadoEm: null, detalhe: { duplicadas: ["777003"] } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "marca_em_registro_inesperado" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: null });
    expect(noBeds24("777003").status).toBe("request");
    expect(await auditadas("beds24.reserva.cancelar")).toEqual([]);
  });

  it("o principal já cancelado e uma duplicada nossa viva: um POST só, o da duplicada, e então confere e marca", async () => {
    const x = await criada();
    noBeds24().status = "cancelled";
    falso.bookings.push(registro({ id: 777001, apiSource: "API", infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }] }));
    await pelaPolitica(x.reservaId, minutos(20));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 1, canceladas: 1, conferidas: 1 });
    expect(falso.escritasReservas.slice(1).map((e) => e.corpo)).toEqual([[{ id: 777001, status: "cancelled" }]]);
    expect((await daReserva(x.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "conferida", detalhe: { duplicadas: ["777001"] } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "encerrada" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: minutos(30) });
  });

  it.each([
    ["num bloqueio (black)", { status: "black" }],
    ["noutro quarto", { roomId: 21 }],
  ] as const)("o registro relido antes de cancelar está %s: nada é enviado, divergente/mudada_no_beds24, nada marcado", async (_nome, mudanca) => {
    const x = await criada();
    Object.assign(noBeds24(), mudanca);
    await pelaPolitica(x.reservaId, minutos(20));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0, avisos: 1 });
    expect(falso.escritasReservas).toHaveLength(1);
    expect((await daReserva(x.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "divergente", enviadoEm: null });
    // O cancelamento nunca mexe na marca das datas fechadas.
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "mudada_no_beds24", otaFechadaEm: minutos(10) });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: null });
  });

  it("o registro com as datas mudadas por fora: cancela (4.3) e a conferência depois fica divergente/mudada_no_beds24, sem as datas reabertas", async () => {
    const x = await criada();
    Object.assign(noBeds24(), { arrival: "2026-10-20", departure: "2026-10-23" });
    await pelaPolitica(x.reservaId, minutos(20));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 1, canceladas: 1, avisos: 1 });
    expect(noBeds24().status).toBe("cancelled");
    expect((await daReserva(x.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "divergente", resposta: "modificada" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "mudada_no_beds24" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: null });
    // O Beds24 aceitou o cancelamento: o fato fica na auditoria, mesmo com a conferência divergente.
    expect(await auditadas("beds24.reserva.cancelar")).toHaveLength(1);
  });

  it("as datas marcadas como reabertas à mão entre a fase 1 e a fase 3: 'já marcada' é sucesso, e a marca da equipe não é sobrescrita", async () => {
    const x = await criada();
    await pelaPolitica(x.reservaId, minutos(20));
    const ganchos = { antesDaFase3: async () => expect(await marcarOtaLiberada(db, c.org, x.reservaId, admin.usuarioId, minutos(29))).toEqual({ ok: true }) };
    expect(await rodar(minutos(30), { ganchos })).toMatchObject({ posts: 1, canceladas: 1, conferidas: 1 });
    expect((await daReserva(x.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "conferida", erro: "" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "encerrada" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: minutos(29), otaLiberadaPor: admin.usuarioId });
  });

  it("o cancelamento que não pôde ser marcado: o erro fica na operação, nada marcado", async () => {
    const x = await criada();
    await pelaPolitica(x.reservaId, minutos(20));
    // Fictício: o cancelamento deixa de estar decidido entre as fases, e marcarOtaLiberada recusa sem marcar.
    const ganchos = { antesDaFase3: () => db.update(cancelamentosReserva).set({ situacao: "descartado" }).where(eq(cancelamentosReserva.reservaId, x.reservaId)) };
    expect(await rodar(minutos(30), { ganchos })).toMatchObject({ posts: 1, canceladas: 1 });
    expect((await daReserva(x.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "conferida", erro: ERRO_CANCELAMENTO_SEM_MARCA });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: null });
  });

  it("a reserva apagada: divergente/apagada_no_beds24, nada marcado; com a credencial trocada, aguardando_equipe/sem_permissao", async () => {
    const x = await criada();
    const y = await criada({ entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    await pelaPolitica(x.reservaId, minutos(20));
    await pelaPolitica(y.reservaId, minutos(21));
    falso.bookings = [];
    await db.update(beds24ReservasSite).set({ credencial: "refresh:outra" }).where(eq(beds24ReservasSite.reservaId, y.reservaId));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0, avisos: 2 });
    expect((await daReserva(x.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "divergente", enviadoEm: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "apagada_no_beds24", lido: null });
    expect((await daReserva(y.reservaId, "cancelar"))[0]).toMatchObject({ situacao: "falhou", erro: ERRO_SEM_ACESSO_A_RESERVA });
    expect(await acompanhamento(y.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_permissao" });
    for (const id of [x.reservaId, y.reservaId]) expect(await cancelamento(id)).toMatchObject({ otaLiberadaEm: null });
    expect(falso.escritasReservas).toHaveLength(2);
  });
});

describe("teste 29: o cancelamento no meio da criação", () => {
  it("cancelada entre a fase 2 e a fase 3 da criação: o id gravado, sem marca nem conferida; a volta seguinte cancela", async () => {
    const x = await pagarEConfirmar(c);
    let feito = false;
    const ganchos = { antesDaFase3: async () => { if (!feito) { feito = true; expect((await pelaPolitica(x.reservaId, minutos(11))).resultado.ok).toBe(true); } } };
    expect(await rodar(minutos(10), { ganchos })).toMatchObject({ posts: 1, criadas: 1, conferidas: 0 });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect((await daReserva(x.reservaId, "criar"))[0]).toMatchObject({ situacao: "conferida" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", otaFechadaEm: null, proximaTentativaEm: minutos(10) });
    expect(await rodar(minutos(20))).toMatchObject({ posts: 1, canceladas: 1, conferidas: 1 });
    expect(noBeds24().status).toBe("cancelled");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "encerrada" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: minutos(20), otaLiberadaPor: null });
  });
});

describe("teste 30: a cancelada antes de ser criada (desenho 6.3)", () => {
  /** Uma `criar` na fila (o token não veio, ela espera o atraso de 10 min) e a reserva cancelada pela política. */
  async function canceladaNaFila() {
    const x = await pagarEConfirmar(c);
    falso.falharToken = new ErroBeds24("Falha de rede ao pedir o token (fictícia).", "rede");
    await rodar(minutos(10));
    falso.falharToken = null;
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "pendente", enviadoEm: null });
    expect((await pelaPolitica(x.reservaId, minutos(15))).resultado.ok).toBe(true);
    return x;
  }

  it("sem marca, sem bloqueio e sem ocupante: a criar superada, as datas reabertas pelo sistema e o acompanhamento encerrado, sem POST", async () => {
    const x = await canceladaNaFila();
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0, conferidas: 1 });
    expect(falso.escritasReservas).toEqual([]);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ tipo: "criar", situacao: "superada" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: minutos(20), otaLiberadaPor: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "encerrada", motivo: null, lidoEm: minutos(20) });
    expect(await auditadas("beds24.reserva.encerrar")).toMatchObject([{ entidadeId: x.reservaId, usuarioId: null }]);
    expect((await tarefasDasOtas(db, c.org, minutos(21), PRONTO)).tarefas).toEqual([]);
  });

  it("com um bloqueio feito à mão: manual/bloqueio_manual, sem marca, e a tarefa diz o bloqueio achado", async () => {
    const x = await canceladaNaFila();
    falso.bookings.push(registro({ id: 5550002, status: "black", arrival: "2026-10-12", departure: "2026-10-14" }));
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0, avisos: 1 });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "superada", detalhe: { bloqueio: { inicio: "2026-10-12", fim: "2026-10-14" } } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "manual", motivo: "bloqueio_manual" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: null });
    expect((await tarefasDasOtas(db, c.org, minutos(21), PRONTO)).tarefas.map((t) => t.texto)).toEqual(["Mude o bloqueio de 12/10 a 14/10 para Cancelado (não apague)."]);
    const lidas = falso.filtrosLidos.length;
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0 });
    expect(falso.filtrosLidos).toHaveLength(lidas);
  });

  it("com uma criar anterior que teve POST e o ocupante exato sem marca: aguardando_equipe/incerta com o id sugerido, sem marca", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await rodar(minutos(10));
    falso.perderRespostaReserva = false;
    // A nova tentativa da saída da incerteza (desenho 3.8, item 3), gravada à mão: a v1 `falhou` com o POST, a v2 na fila.
    const [v1] = await operacoes(x.reservaId);
    await db.update(beds24ReservasOperacoes).set({ situacao: "falhou" }).where(eq(beds24ReservasOperacoes.id, v1.id));
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: c.org, reservaId: x.reservaId, acompanhamentoId: v1.acompanhamentoId, tipo: "criar", chave: chaveOperacaoBeds24("criar", x.reservaId, 2), modo: "real", pedido: v1.pedido, credencial: CREDENCIAL });
    await db.update(beds24ReservasSite).set({ versao: 2, situacao: "pendente" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    // O registro deixado pelo POST perdido, sem a marca (a credencial não leu, ou alguém a apagou), com a origem da API.
    delete noBeds24().infoItems;
    expect((await pelaPolitica(x.reservaId, minutos(15))).resultado.ok).toBe(true);
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0, avisos: 1 });
    const [, v2] = await operacoes(x.reservaId);
    expect(v2).toMatchObject({ situacao: "superada", detalhe: { candidato: "900001" } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "incerta" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: null });
    expect((await c.reserva(x.reservaId)).beds24Id).toBeNull();
    expect(falso.escritasReservas).toHaveLength(1);
  });

  it("com a marca num registro vivo: adota e cancela já nesta volta (o fluxo normal do cancelamento)", async () => {
    const x = await canceladaNaFila();
    // A criação aconteceu (fictício: o registro com a marca, deixado por um POST cujo rastro se perdeu). O acompanhamento sem o
    // quarto (a linha criada sem a fase 1): a adoção o preenche, e o cancelamento sai já nesta volta.
    await db.update(beds24ReservasSite).set({ roomId: null, propertyId: null }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    falso.bookings.push(registro({ id: 777001, apiSource: "API", infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }] }));
    expect(await rodar(minutos(20))).toMatchObject({ posts: 1, canceladas: 1, conferidas: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ roomId: "20", propertyId: "10", situacao: "encerrada" });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("777001");
    expect(noBeds24("777001").status).toBe("cancelled");
    expect(await auditadas("beds24.reserva.adotar")).toHaveLength(1);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "encerrada" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: minutos(20) });
  });

  it("depois de uma duplicada (nada ativo), o cancelamento no SCL chega à leitura de 6.3; a volta não relê, e 'Conferir agora' conclui depois de a equipe cancelar lá", async () => {
    const x = await pagarEConfirmar(c);
    const marca = (id: number) => registro({ id, apiSource: "API", infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }] });
    falso.bookings.push(marca(777001), marca(777002));
    expect(await rodar(minutos(10))).toMatchObject({ posts: 0, avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "duplicada" });
    expect((await pelaPolitica(x.reservaId, minutos(15))).resultado.ok).toBe(true);
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0, avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "duplicada", lidoEm: minutos(20) });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "divergente", detalhe: { duplicadas: ["777001", "777002"] } });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: null });
    const lidas = falso.filtrosLidos.length;
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0 });
    expect(falso.filtrosLidos).toHaveLength(lidas);
    // A equipe cancela as duas no Beds24 (não apaga); "Conferir agora" (a mesma leitura) conclui.
    for (const id of ["777001", "777002"]) noBeds24(id).status = "cancelled";
    expect(await cancelarAntesDeCriar(db, c.org, x.reservaId, falso, opcoes(minutos(40)))).toEqual({ fechamento: "encerrada" });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: minutos(40), otaLiberadaPor: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "encerrada" });
    expect(falso.escritasReservas).toEqual([]);
  });

  it("sem o ensaio válido para a credencial, 'nada lá' não conclui: buscas_sem_conclusao + 1; na terceira, a equipe", async () => {
    const x = await canceladaNaFila();
    await configurar({ ensaio: null });
    for (const [t, buscas] of [[20, 1], [30, 2]] as const) {
      expect(await rodar(minutos(t))).toMatchObject({ posts: 0 });
      expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", buscasSemConclusao: buscas });
    }
    expect(await rodar(minutos(40))).toMatchObject({ posts: 0, avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "incerta", buscasSemConclusao: 3 });
    expect(await cancelamento(x.reservaId)).toMatchObject({ otaLiberadaEm: null });
  });
});

describe("teste 36 (atualização e cancelamento): os escopos e o ensaio", () => {
  it.each([
    ["escopo faltando (incompleto)", () => escopos({ lista: ESCOPOS_ESPERADOS_FALSO.filter((e) => e !== "read:properties") }), { motivo: "escopo_fora_de_ordem", para: "criacoes" }],
    ["sem ensaio da credencial de agora", () => configurar({ ensaio: null }), { motivo: "sem_ensaio", para: "criacoes" }],
  ] as const)("%s: a criação para; a atualização e o cancelamento do que o sistema criou seguem", async (_nome, preparar, configuracao) => {
    const x = await criada();
    const y = await criada({ entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    const z = await pagarEConfirmar(c, { entrada: "2026-10-25", saida: "2026-10-27", email: "z@example.com" });
    await preparar();
    await alterada(x.reservaId, { checkout: "2026-10-16" }, minutos(20));
    await pelaPolitica(y.reservaId, minutos(21));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 2, atualizadas: 1, canceladas: 1, criadas: 0, configuracao });
    expect(await operacoes(z.reservaId)).toEqual([]);
  });

  it.each([
    ["escopo a mais", () => escopos({ lista: [...ESCOPOS_ESPERADOS_FALSO, "all:bookings"] })],
    ["lidos com outra credencial (sem leitura válida)", () => escopos({ credencial: "refresh:outra" })],
  ] as const)("%s: nenhum POST de nenhum tipo, nem cancelar nem atualizar", async (_nome, preparar) => {
    const x = await criada();
    const y = await criada({ entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    await preparar();
    await alterada(x.reservaId, { checkout: "2026-10-16" }, minutos(20));
    await pelaPolitica(y.reservaId, minutos(21));
    expect(await rodar(minutos(30))).toMatchObject({ posts: 0, configuracao: { para: "tudo" } });
    expect(falso.escritasReservas).toHaveLength(2);
    expect(await daReserva(x.reservaId, "atualizar")).toEqual([]);
    expect(await daReserva(y.reservaId, "cancelar")).toEqual([]);
  });
});

describe("a ordem das travas na fase 3: imóvel → reserva → acompanhamento → cancelamento → alterações → operação", () => {
  /** O mesmo banco, anotando cada comando SQL (o padrão de `pagamentos/travas.test.ts`). */
  function espiarComandos(): { db: Db; comandos: string[] } {
    const comandos: string[] = [];
    const cliente = (db as unknown as { $client: PGlite }).$client;
    const espiado = drizzle(cliente, { schema, logger: { logQuery: (q) => comandos.push(q) } }) as unknown as Db;
    return { db: espiado, comandos };
  }
  /** Os comandos da última fase 3 (depois do último `pg_advisory_xact_lock`, a trava que espera). */
  const ultimaFase3 = (comandos: string[]) => comandos.slice(comandos.map((q) => q.includes("pg_advisory_xact_lock(")).lastIndexOf(true));
  const primeiro = (comandos: string[], tabela: string, trava: RegExp) => comandos.findIndex((q) => q.includes(`from "${tabela}"`) && trava.test(q));

  it.each([
    ["a atualização (com a alteração lida na fase 1)", async (reservaId: string): Promise<void> => void (await alterada(reservaId, { checkout: "2026-10-16" }, minutos(20)))],
    ["o cancelamento", async (reservaId: string): Promise<void> => void (await pelaPolitica(reservaId, minutos(20)))],
  ] as const)("%s", async (nome, preparar) => {
    const x = await criada();
    await preparar(x.reservaId);
    const e = espiarComandos();
    expect(await rodar(minutos(30), {}, e.db)).toMatchObject({ posts: 1 });
    const f3 = ultimaFase3(e.comandos);
    const ordem = [
      primeiro(f3, "imoveis", /\bfor no key update\b/),
      primeiro(f3, "reservas", /\bfor no key update\b/),
      primeiro(f3, "beds24_reservas_site", /\bfor update\b/),
      primeiro(f3, "cancelamentos_reserva", /\bfor update\b/),
      ...(f3.some((q) => q.includes('from "alteracoes_reserva"') && /\bfor update\b/.test(q)) ? [primeiro(f3, "alteracoes_reserva", /\bfor update\b/)] : []),
      primeiro(f3, "beds24_reservas_operacoes", /\bfor update\b/),
    ];
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    // A reserva nunca `FOR UPDATE` quando o `beds24_id` não muda (não bloqueia o `FOR KEY SHARE` dos lançamentos).
    expect(f3.filter((q) => q.includes('from "reservas"') && /\bfor update\b/.test(q))).toEqual([]);
    if (nome.startsWith("a atualização")) expect(ordem).toHaveLength(6);
  });
});
