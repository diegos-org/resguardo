/**
 * Reserva paga do site no Beds24 (M8.3c) — as quedas, a incerteza, a adoção e o e-mail (desenho 3.5, 3.6, 3.8, 4.1 a 4.4 e
 * 6.5; plano, testes 22 a 25 e a variante da adoção do "Vincular"): a saída da operação em curso (`resolverOperacoesEmCurso`
 * e `resolverOperacaoEmCurso`, o passo 1 da rotina e o "Conferir agora"), nos dois esquemas (a criação pela busca e pelos
 * ocupantes; a atualização e o cancelamento pela releitura por id), a revalidação sob a trava e o e-mail depois dos commits.
 * PGlite, os cenários do pagamento, o Beds24 falso, `CorreioMemoria` e um espião de `fetch` que nunca é chamado: nada vai ao
 * Beds24. O `env` é sempre explícito (`PRONTO`), e o cliente é o falso injetado.
 *
 * O relógio dos testes é o injetado (`minutos`), e o `enviado_em` vem do relógio do banco: os testes dos 5 minutos regravam
 * o `enviado_em` com o relógio deles (padrão de `trava.test.ts`), e os da `enviando` vencida, o `iniciado_em` de 7 min atrás.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { gravarConfig } from "@/configuracoes/armazem";
import { auditoria, beds24ReservasOperacoes, beds24ReservasSite, cancelamentosReserva, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { type Cenario, cancelar, EMAIL_HOSPEDE, entradaPadrao, env, minutos, montarCenario, NOME_HOSPEDE, pagarEConfirmar, semDadosPessoais, TELEFONE_HOSPEDE, usuarioDeTeste } from "@/pagamentos/testes";
import { Beds24Falso, ESCOPOS_ESPERADOS_FALSO } from "./falso";
import { impressaoCredencialBeds24 } from "./http";
import { INFO_MARCA_SCL, respostaDaGravacao } from "./normalizar";
import { vincularRegistro } from "./reservas-site";
import { avisarEquipeDasReservasNoBeds24, avisosDeReservasNoBeds24, chaveDoEmailBeds24 } from "./reservas-site-avisos";
import { abrirIntencao, enviarReservasDoSite, type OpcoesDoEnvio, resolverOperacaoEmCurso, resolverOperacoesEmCurso } from "./reservas-site-envio";
import { assinaturaEsperado, chaveOperacaoBeds24, type EsperadoBeds24 } from "./reservas-site-regras";
import { gravarEscoposLidos } from "./reservas-site-rotina";
import { tarefasDasOtas } from "./reservas-site-tarefas";
import { ErroBeds24, type ReservaBeds24 } from "./tipos";

/** O deploy de produção com a chave das reservas e o refresh token (fictício): a trava de ambiente aberta. */
const PRONTO = env({ VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" });
const CREDENCIAL = impressaoCredencialBeds24(PRONTO);
const ENSAIO = { credencial: CREDENCIAL, em: "2026-09-01T00:00:00.000Z", operacaoId: "6f1c2a7e-3b4d-4c5e-8f90-123456789abc" };
const EMAIL_EQUIPE = "equipe@example.com";
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
  await gravarEscoposLidos(db, c.org, CREDENCIAL, { escopos: [...ESCOPOS_ESPERADOS_FALSO], ilegiveis: [] }, minutos(0));
  // O endereço da empresa (fictício): o e-mail à equipe vai para ele, e só para ele.
  await gravarConfig(db, c.org, "empresa", { email: EMAIL_EQUIPE }, null);
});
afterEach(() => {
  expect(espiao).not.toHaveBeenCalled();
  espiao.mockRestore();
});

/** Um dia por faixa, de 01/10 a 30/11, com uma unidade livre por noite. */
function calendario(especiais: Record<string, Obj> = {}) {
  const dias: Obj[] = [];
  for (let d = "2026-10-01"; d <= "2026-11-30"; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) dias.push({ from: d, to: d, numAvail: 1, price1: 450, ...especiais[d] });
  return [{ roomId: 20, calendar: dias }];
}
const configurar = (o: { ensaio?: typeof ENSAIO | null } = {}) =>
  gravarConfig(db, c.org, "reservas_beds24", { pausado: null, retomado: null, imoveis: [{ imovelId: c.imovel, ligadoEm: "2026-09-01T00:00:00.000Z", ligadoPor: null }], ensaio: o.ensaio === undefined ? ENSAIO : o.ensaio }, null);
const opcoes = (agora: Date, o: Partial<OpcoesDoEnvio> = {}): OpcoesDoEnvio => ({ env: PRONTO, relogio: { agora: () => agora, restanteMs: () => 240_000 }, ...o });
/** O passo 4 (as criações) da volta. */
const rodar = (agora: Date, o: Partial<OpcoesDoEnvio> = {}) => enviarReservasDoSite(db, c.org, falso, opcoes(agora, o));
/** O passo 1 (a saída das operações em curso) da volta. */
const resolver = (agora: Date, o: Partial<OpcoesDoEnvio> = {}) => resolverOperacoesEmCurso(db, c.org, falso, opcoes(agora, o));
/** A volta como a rotina monta: o passo 1, as criações e, depois dos commits, o e-mail à equipe. */
async function volta(agora: Date, correio: CorreioMemoria | null = null) {
  const passo1 = await resolver(agora);
  const envio = await rodar(agora);
  const avisos = await avisarEquipeDasReservasNoBeds24(db, c.org, correio, agora);
  return { passo1, envio, avisos };
}
const operacoes = (reservaId: string) => db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.reservaId, reservaId)).orderBy(asc(beds24ReservasOperacoes.chave));
const acompanhamento = async (reservaId: string) => (await db.select().from(beds24ReservasSite).where(eq(beds24ReservasSite.reservaId, reservaId)))[0];
/** Regrava o `enviado_em` da operação em curso da reserva com o relógio do teste (o do banco é o de agora). */
const enviadoEm = (reservaId: string, em: Date) =>
  db.update(beds24ReservasOperacoes).set({ enviadoEm: em }).where(and(eq(beds24ReservasOperacoes.reservaId, reservaId), inArray(beds24ReservasOperacoes.situacao, ["incerta", "enviando", "feita"])));
/** A `enviando` da reserva começou há 7 min pelo relógio do banco: vencida. */
const vencer = (reservaId: string) => db.update(beds24ReservasOperacoes).set({ iniciadoEm: sql`now() - interval '7 minutes'` }).where(and(eq(beds24ReservasOperacoes.reservaId, reservaId), eq(beds24ReservasOperacoes.situacao, "enviando")));
/** Um registro do Beds24 no quarto 20 (formato da API, dados fictícios). */
const registro = (o: Obj) => ({ propertyId: 10, roomId: 20, status: "confirmed", arrival: "2026-10-12", departure: "2026-10-15", numAdult: 4, ...o });
const semDados = (correio?: CorreioMemoria) => semDadosPessoais(db, [EMAIL_HOSPEDE, TELEFONE_HOSPEDE], { nomes: [NOME_HOSPEDE], correio });

describe("teste 22: a incerteza da criação", () => {
  it("a resposta perdida: incerta; antes de 5 min nada é lido nem concluído; depois, adota (um registro só no Beds24) e confere", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    expect(await rodar(minutos(10))).toMatchObject({ posts: 1, incertas: 1 });
    falso.perderRespostaReserva = false;
    await enviadoEm(x.reservaId, minutos(10));
    const lidas = falso.filtrosLidos.length;
    expect(await resolver(minutos(14))).toMatchObject({ resolvidas: 0, parada: null });
    expect(falso.filtrosLidos).toHaveLength(lidas);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "incerta", resposta: "tempo", beds24Id: null });

    expect(await resolver(minutos(15))).toMatchObject({ resolvidas: 1, conferidas: 1 });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "conferida", beds24Id: "900001" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null, otaFechadaEm: minutos(15), otaFechadaPor: null, buscasSemConclusao: 0 });
    expect(falso.bookings).toHaveLength(1);
    // A volta seguinte não cria de novo, e a saída não tem mais nada a resolver.
    expect(await volta(minutos(20))).toMatchObject({ passo1: { resolvidas: 0 }, envio: { posts: 0 } });
    expect(falso.escritasReservas).toHaveLength(1);
    expect(await semDados()).toEqual([]);
  });

  it("tempo e depois rede na mesma intenção: uma nova tentativa só (com o atraso), depois aguardando_equipe/incerta, sem terceiro POST", async () => {
    const x = await pagarEConfirmar(c);
    // As duas respostas se perdem sem gravar nada no Beds24.
    const gravar = vi.spyOn(falso, "gravarReservas").mockResolvedValueOnce(respostaDaGravacao("tempo")).mockResolvedValueOnce(respostaDaGravacao("rede"));
    expect(await rodar(minutos(10))).toMatchObject({ posts: 1, incertas: 1 });
    await enviadoEm(x.reservaId, minutos(10));
    expect(await resolver(minutos(16))).toMatchObject({ resolvidas: 1, novasVersoes: 1 });
    const [v1, v2] = await operacoes(x.reservaId);
    expect(v1).toMatchObject({ chave: chaveOperacaoBeds24("criar", x.reservaId, 1), situacao: "falhou", resposta: "tempo" });
    expect(v1.enviadoEm).toEqual(minutos(10));
    expect(v2).toMatchObject({ chave: chaveOperacaoBeds24("criar", x.reservaId, 2), situacao: "pendente", enviadoEm: null, pedido: v1.pedido });
    // A incerteza não conta como falha: o atraso é o da primeira (10 min), sem somar a tentativa.
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", motivo: null, versao: 2, tentativas: 0, proximaTentativaEm: minutos(26) });

    expect(await rodar(minutos(20))).toMatchObject({ posts: 0 });
    expect(await rodar(minutos(27))).toMatchObject({ posts: 1, incertas: 1 });
    await enviadoEm(x.reservaId, minutos(27));
    expect(await resolver(minutos(33))).toMatchObject({ resolvidas: 1, avisos: 1, novasVersoes: 0 });
    expect((await operacoes(x.reservaId)).map((o) => [o.situacao, o.resposta])).toEqual([["falhou", "tempo"], ["incerta", "rede"]]);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "incerta" });
    // A equipe decide: a volta seguinte nem relê (o "Conferir agora" relê na hora) nem envia.
    const lidas = falso.filtrosLidos.length;
    expect(await volta(minutos(45))).toMatchObject({ passo1: { resolvidas: 0 }, envio: { posts: 0 } });
    expect(falso.filtrosLidos).toHaveLength(lidas);
    expect(gravar).toHaveBeenCalledTimes(2);
  });

  it("success sem o id e o registro não achado: aguardando_equipe/incerta, sem segundo POST (o Beds24 disse que gravou)", async () => {
    const x = await pagarEConfirmar(c);
    falso.respostaSemId = true;
    expect(await rodar(minutos(10))).toMatchObject({ posts: 1, incertas: 1 });
    falso.respostaSemId = false;
    // O registro não aparece na leitura (fictício: o Beds24 não o guardou).
    falso.bookings = [];
    falso.calendarios = calendario();
    await enviadoEm(x.reservaId, minutos(10));
    expect(await resolver(minutos(16))).toMatchObject({ resolvidas: 1, avisos: 1, novasVersoes: 0 });
    expect((await operacoes(x.reservaId)).map((o) => [o.situacao, o.resposta])).toEqual([["incerta", "sem_id"]]);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "incerta" });
    expect(await volta(minutos(30))).toMatchObject({ envio: { posts: 0 } });
    expect(falso.escritasReservas).toHaveLength(1);
  });

  it("sem o ensaio válido para a credencial, o 'não achou' não conclui: buscas_sem_conclusao + 1; na terceira, a equipe", async () => {
    const x = await pagarEConfirmar(c);
    vi.spyOn(falso, "gravarReservas").mockResolvedValueOnce(respostaDaGravacao("tempo"));
    await rodar(minutos(10));
    await enviadoEm(x.reservaId, minutos(10));
    await configurar({ ensaio: null });
    expect(await resolver(minutos(16))).toMatchObject({ resolvidas: 1, incertas: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "em_envio", buscasSemConclusao: 1 });
    expect(await resolver(minutos(17))).toMatchObject({ incertas: 1 });
    expect(await resolver(minutos(18))).toMatchObject({ avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "incerta", buscasSemConclusao: 3 });
    expect((await operacoes(x.reservaId)).map((o) => o.situacao)).toEqual(["incerta"]);
  });

  it("a busca que não funciona (o Beds24 fora do ar) não conclui; a recusa 429 na leitura para a volta", async () => {
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    vi.spyOn(falso, "gravarReservas").mockResolvedValueOnce(respostaDaGravacao("tempo")).mockResolvedValueOnce(respostaDaGravacao("tempo"));
    expect(await rodar(minutos(10))).toMatchObject({ posts: 2, incertas: 2 });
    await enviadoEm(x.reservaId, minutos(10));
    await enviadoEm(y.reservaId, minutos(10));
    falso.falhar = new ErroBeds24("Beds24 respondeu HTTP 429.", "http", 429);
    expect(await resolver(minutos(16))).toMatchObject({ resolvidas: 1, incertas: 1, parada: "limite" });
    expect((await acompanhamento(x.reservaId)).buscasSemConclusao + (await acompanhamento(y.reservaId)).buscasSemConclusao).toBe(1);
  });

  it("o passo 1 para pelo tempo e pela janela antes de ler, e no 401 ou 403 da leitura depois da primeira operação", async () => {
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    vi.spyOn(falso, "gravarReservas").mockResolvedValueOnce(respostaDaGravacao("tempo")).mockResolvedValueOnce(respostaDaGravacao("tempo"));
    await rodar(minutos(10));
    await enviadoEm(x.reservaId, minutos(10));
    await enviadoEm(y.reservaId, minutos(10));
    const lidas = falso.filtrosLidos.length;
    // As duas prontas para concluir, mas sem tempo para as leituras e a fase 3: nada é lido.
    expect(await resolver(minutos(16), { relogio: { agora: () => minutos(16), restanteMs: () => 89_000 } })).toMatchObject({ resolvidas: 0, parada: "tempo" });
    expect(falso.filtrosLidos).toHaveLength(lidas);
    // Dentro da janela da importação diária (9:05 a 9:30 UTC), conferida antes de cada saída: nada é lido.
    expect(await resolver(new Date("2026-10-02T09:10:00Z"))).toMatchObject({ resolvidas: 0, parada: "janela" });
    expect(falso.filtrosLidos).toHaveLength(lidas);
    const buscas = async () => (await acompanhamento(x.reservaId)).buscasSemConclusao + (await acompanhamento(y.reservaId)).buscasSemConclusao;
    // O 403 e o 401 na leitura param a volta depois da primeira: a segunda nem é lida.
    falso.falhar = new ErroBeds24("Beds24 respondeu HTTP 403.", "http", 403);
    expect(await resolver(minutos(16))).toMatchObject({ resolvidas: 1, incertas: 1, parada: "sem_permissao" });
    expect(await buscas()).toBe(1);
    falso.falhar = new ErroBeds24("Beds24 respondeu HTTP 401.", "http", 401);
    expect(await resolver(minutos(17))).toMatchObject({ resolvidas: 1, parada: "sem_permissao" });
    expect(await buscas()).toBe(2);
  });

  it("o contador de buscas é da incerteza: a adoção depois de uma busca que falhou o zera", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await rodar(minutos(10));
    falso.perderRespostaReserva = false;
    await enviadoEm(x.reservaId, minutos(10));
    falso.falhar = new ErroBeds24("Beds24 não respondeu a tempo.", "tempo");
    expect(await resolver(minutos(16))).toMatchObject({ incertas: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ buscasSemConclusao: 1 });
    falso.falhar = null;
    expect(await resolver(minutos(17))).toMatchObject({ conferidas: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", buscasSemConclusao: 0 });
  });

  it("a nova tentativa também zera o contador: a incerteza da versão seguinte conta do zero", async () => {
    const x = await pagarEConfirmar(c);
    vi.spyOn(falso, "gravarReservas").mockResolvedValueOnce(respostaDaGravacao("tempo"));
    await rodar(minutos(10));
    await enviadoEm(x.reservaId, minutos(10));
    falso.falhar = new ErroBeds24("Beds24 não respondeu a tempo.", "tempo");
    await resolver(minutos(16));
    expect(await acompanhamento(x.reservaId)).toMatchObject({ buscasSemConclusao: 1 });
    falso.falhar = null;
    expect(await resolver(minutos(17))).toMatchObject({ novasVersoes: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", versao: 2, buscasSemConclusao: 0 });
  });

  it("a marca ambígua na leitura (dois códigos no info item) não conclui a busca: nenhuma adoção, nenhuma nova tentativa", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await rodar(minutos(10));
    falso.perderRespostaReserva = false;
    falso.bookings[0].infoItems = [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }, { code: INFO_MARCA_SCL, text: "SCL-ABCDEF" }];
    await enviadoEm(x.reservaId, minutos(10));
    expect(await resolver(minutos(16))).toMatchObject({ incertas: 1, novasVersoes: 0 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "em_envio", buscasSemConclusao: 1 });
    expect((await c.reserva(x.reservaId)).beds24Id).toBeNull();
  });
});

describe("teste 23: as quedas e a revalidação sob a trava", () => {
  it("a queda antes do POST (enviado_em nulo, iniciado_em de 7 min) volta a pendente sem leitura nenhuma", async () => {
    const x = await pagarEConfirmar(c);
    await rodar(minutos(10), { ganchos: { antesDaFase2: () => { throw new Error("queda fictícia"); } } }).catch(() => null);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "enviando", enviadoEm: null });
    await vencer(x.reservaId);
    falso.filtrosLidos = [];
    expect(await resolver(minutos(17))).toMatchObject({ voltaram: 1, resolvidas: 0 });
    expect(falso.filtrosLidos).toEqual([]);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "pendente", enviadoEm: null });
    expect(await rodar(minutos(18))).toMatchObject({ posts: 1, conferidas: 1 });
  });

  it("a queda depois da resposta, com o id: nada antes de vencer; vencida, relê por id e faz a fase 3 que faltou (o id na reserva, a auditoria e as marcas)", async () => {
    const x = await pagarEConfirmar(c);
    await rodar(minutos(10), { ganchos: { antesDaFase3: () => { throw new Error("queda fictícia"); } } }).catch(() => null);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "enviando", beds24Id: "900001", resposta: "criada" });
    expect((await c.reserva(x.reservaId)).beds24Id).toBeNull();
    // Ainda dentro dos 6 min: em andamento, nada é tocado.
    expect(await resolver(minutos(12))).toMatchObject({ resolvidas: 0 });
    await vencer(x.reservaId);
    falso.filtrosLidos = [];
    expect(await resolver(minutos(17))).toMatchObject({ resolvidas: 1, conferidas: 1 });
    expect(falso.filtrosLidos).toEqual([{ ids: ["900001"], chegadaDe: "1900-01-01", incluirInfo: true }]);
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "conferida" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", otaFechadaEm: minutos(17) });
    const auditadas = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.criar")));
    expect(auditadas).toHaveLength(1);
    expect(falso.escritasReservas).toHaveLength(1);
  });

  it("a criação feita (a releitura caiu depois do POST): a volta seguinte relê pelo id e confere, sem segundo POST", async () => {
    const x = await pagarEConfirmar(c);
    falso.lento = () => {
      if (falso.escritasReservas.length) falso.falhar = new ErroBeds24("Beds24 não respondeu a tempo.", "tempo");
    };
    await rodar(minutos(10));
    falso.lento = null;
    falso.falhar = null;
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "feita", beds24Id: "900001" });
    expect(await resolver(minutos(11))).toMatchObject({ resolvidas: 1, conferidas: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", otaFechadaEm: minutos(11) });
    expect(falso.escritasReservas).toHaveLength(1);
  });

  it("a criação feita com o registro apagado no Beds24: divergente/apagada_no_beds24 (terminal), o e-mail, e nada fica em curso", async () => {
    const x = await pagarEConfirmar(c);
    falso.lento = () => {
      if (falso.escritasReservas.length) falso.falhar = new ErroBeds24("Beds24 não respondeu a tempo.", "tempo");
    };
    await rodar(minutos(10));
    falso.lento = null;
    falso.falhar = null;
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "feita", beds24Id: "900001" });
    // Alguém apagou o registro no Beds24 antes da releitura (a credencial e o quarto são os de agora).
    falso.bookings = [];
    const correio = new CorreioMemoria();
    expect((await volta(minutos(11), correio)).passo1).toMatchObject({ resolvidas: 1, avisos: 1 });
    expect((await operacoes(x.reservaId)).map((o) => o.situacao)).toEqual(["divergente"]);
    const a = await acompanhamento(x.reservaId);
    expect(a).toMatchObject({ situacao: "divergente", motivo: "apagada_no_beds24", lido: null, otaFechadaEm: null, buscasSemConclusao: 0 });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect(correio.enviadas.map((m) => m.chave)).toEqual([chaveDoEmailBeds24(x.reservaId, "apagada_no_beds24", a.assinaturaEsperada)]);
    // A operação terminou: a volta seguinte não tem o que resolver nem relê.
    const lidas = falso.filtrosLidos.length;
    expect((await volta(minutos(20), correio)).passo1).toMatchObject({ resolvidas: 0 });
    expect(falso.filtrosLidos).toHaveLength(lidas);
  });

  it("a queda depois da resposta com o registro apagado e a credencial trocada: o fato gravado, feita e a equipe; com a credencial de volta, o 'Conferir agora' conclui apagada", async () => {
    const x = await pagarEConfirmar(c);
    await rodar(minutos(10), { ganchos: { antesDaFase3: () => { throw new Error("queda fictícia"); } } }).catch(() => null);
    await vencer(x.reservaId);
    falso.bookings = [];
    await db.update(beds24ReservasSite).set({ credencial: "refresh:outra" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    expect(await resolver(minutos(17))).toMatchObject({ resolvidas: 1, avisos: 1 });
    const [criacao] = await operacoes(x.reservaId);
    expect(criacao).toMatchObject({ situacao: "feita", beds24Id: "900001" });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect(await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.criar")))).toHaveLength(1);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_permissao" });
    await db.update(beds24ReservasSite).set({ credencial: CREDENCIAL }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    expect(await resolverOperacaoEmCurso(db, c.org, criacao.id, falso, opcoes(minutos(30)))).toEqual({ fechamento: "divergente" });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("divergente");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "apagada_no_beds24" });
  });

  it("a fase 3 da saída repete no 55P03 e no 40P01 e grava o fato", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await rodar(minutos(10));
    falso.perderRespostaReserva = false;
    await enviadoEm(x.reservaId, minutos(10));
    const travada = (code: string) => Object.assign(new Error("trava fictícia"), { code });
    const ganchos = { antesDaFase3: (_: unknown, tentativa: number) => { if (tentativa === 1) throw travada("55P03"); if (tentativa === 2) throw travada("40P01"); } };
    expect(await resolver(minutos(16), { ganchos })).toMatchObject({ conferidas: 1 });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
  });

  it("a mesma conclusão aplicada por duas saídas ao mesmo tempo grava uma vez só (a revalidação da situação e do enviado_em)", async () => {
    const x = await pagarEConfirmar(c);
    vi.spyOn(falso, "gravarReservas").mockResolvedValueOnce(respostaDaGravacao("tempo"));
    await rodar(minutos(10));
    await enviadoEm(x.reservaId, minutos(10));
    // Entre a leitura e a fase 3 da primeira saída, outra (o mesmo disparo entregue duas vezes) roda inteira.
    let outra: Awaited<ReturnType<typeof resolver>> | null = null;
    const ganchos = { antesDaFase3: async () => { outra ??= await resolver(minutos(16)); } };
    expect(await resolver(minutos(16), { ganchos })).toMatchObject({ resolvidas: 0, novasVersoes: 0 });
    expect(outra).toMatchObject({ resolvidas: 1, novasVersoes: 1 });
    expect((await operacoes(x.reservaId)).map((o) => [o.chave, o.situacao])).toEqual([[chaveOperacaoBeds24("criar", x.reservaId, 1), "falhou"], [chaveOperacaoBeds24("criar", x.reservaId, 2), "pendente"]]);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ versao: 2 });
  });

  it("a leitura sem conclusão aplicada por duas saídas ao mesmo tempo conta uma busca só (a revalidação do acompanhamento)", async () => {
    const x = await pagarEConfirmar(c);
    vi.spyOn(falso, "gravarReservas").mockResolvedValueOnce(respostaDaGravacao("tempo"));
    await rodar(minutos(10));
    await enviadoEm(x.reservaId, minutos(10));
    // Sem o ensaio válido para a credencial, o "não achou" não conclui: a operação continua incerta e só o contador muda.
    await configurar({ ensaio: null });
    let outra: Awaited<ReturnType<typeof resolver>> | null = null;
    const ganchos = { antesDaFase3: async () => { outra ??= await resolver(minutos(16)); } };
    expect(await resolver(minutos(16), { ganchos })).toMatchObject({ resolvidas: 0 });
    expect(outra).toMatchObject({ resolvidas: 1, incertas: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "em_envio", buscasSemConclusao: 1 });
    expect((await operacoes(x.reservaId)).map((o) => o.situacao)).toEqual(["incerta"]);
  });

  it("o ensaio em curso nunca é tocado pela saída", async () => {
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: c.org, tipo: "ensaio", chave: "ensaio:em-curso-ficticio", modo: "real", situacao: "incerta", enviadoEm: minutos(0), credencial: CREDENCIAL });
    expect(await resolver(minutos(30))).toMatchObject({ resolvidas: 0 });
    expect(falso.chamadas).toBe(0);
    const [ensaio] = await db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.tipo, "ensaio"));
    expect(ensaio.situacao).toBe("incerta");
  });
});

describe("teste 23: a saída do atualizar e do cancelar pela releitura por id", () => {
  /** A reserva criada e conferida (o id 900001 no Beds24), e o acompanhamento na versão 1. */
  async function criada() {
    const x = await pagarEConfirmar(c);
    expect(await rodar(minutos(10))).toMatchObject({ conferidas: 1 });
    return x;
  }
  const PEDIDO_ANTES: EsperadoBeds24 = { quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada" };
  /**
   * A operação que a fase 1 do bloco D gravaria, com o POST tentado e a resposta perdida: `atualizar` (a saída mudada para
   * 16/10) ou `cancelar`, já com o id e o `antes` (o registro relido na fase 2). Fictício: a fase 2 desses tipos é do bloco D.
   */
  async function emCurso(x: { reservaId: string; reservaCodigo: string }, tipo: "atualizar" | "cancelar", o: { situacao: "incerta" | "enviando"; resposta: "tempo" | "recusada" | null; enviadoEm: Date }) {
    const a = await acompanhamento(x.reservaId);
    const esperado: EsperadoBeds24 = tipo === "atualizar" ? { ...PEDIDO_ANTES, saida: "2026-10-16" } : { ...PEDIDO_ANTES, situacao: "cancelada" };
    if (tipo === "atualizar") await db.update(reservas).set({ checkout: "2026-10-16" }).where(eq(reservas.id, x.reservaId));
    await db.update(beds24ReservasSite).set({ versao: 2, situacao: "em_envio", esperado, assinaturaEsperada: assinaturaEsperado(esperado) }).where(eq(beds24ReservasSite.id, a.id));
    await db.insert(beds24ReservasOperacoes).values({
      organizacaoId: c.org, reservaId: x.reservaId, acompanhamentoId: a.id, tipo, chave: chaveOperacaoBeds24(tipo, x.reservaId, 2), modo: "real", situacao: o.situacao,
      pedido: { ...esperado, referencia: x.reservaCodigo }, antes: PEDIDO_ANTES, beds24Id: "900001", credencial: CREDENCIAL, enviadoEm: o.enviadoEm, resposta: o.resposta,
      ...(o.situacao === "enviando" ? { iniciadoEm: sql`now() - interval '7 minutes'` } : {}),
    });
  }
  const noBeds24 = (o: Obj) => Object.assign(falso.bookings.find((b) => String(b.id) === "900001")!, o);

  it("atualizar vencido (enviando, com o id) e o Beds24 igual ao pedido: conferida, com a auditoria e as marcas; nunca outro POST", async () => {
    const x = await criada();
    await emCurso(x, "atualizar", { situacao: "enviando", resposta: null, enviadoEm: minutos(20) });
    noBeds24({ departure: "2026-10-16" });
    falso.filtrosLidos = [];
    expect(await resolver(minutos(21))).toMatchObject({ resolvidas: 1, conferidas: 1 });
    expect(falso.filtrosLidos).toEqual([{ ids: ["900001"], chegadaDe: "1900-01-01", incluirInfo: true }]);
    const [v2] = await operacoes(x.reservaId);
    expect(v2).toMatchObject({ tipo: "atualizar", situacao: "conferida", depois: { ...PEDIDO_ANTES, saida: "2026-10-16" } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null, lido: { ...PEDIDO_ANTES, saida: "2026-10-16" } });
    const [auditada] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.atualizar")));
    expect(auditada).toMatchObject({ entidadeId: x.reservaId, usuarioId: null, mudancas: { saida: ["2026-10-15", "2026-10-16"] } });
    expect(falso.escritasReservas).toHaveLength(1);
  });

  it("atualizar incerto igual ao antes: nada antes de 5 min; depois, a nova tentativa (a versão seguinte, com o mesmo pedido e o id)", async () => {
    const x = await criada();
    await emCurso(x, "atualizar", { situacao: "incerta", resposta: "tempo", enviadoEm: minutos(20) });
    expect(await resolver(minutos(23))).toMatchObject({ resolvidas: 0 });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("incerta");
    expect(await resolver(minutos(25))).toMatchObject({ resolvidas: 1, novasVersoes: 1 });
    const [v2, v3] = await operacoes(x.reservaId);
    expect(v2.situacao).toBe("falhou");
    expect(v3).toMatchObject({ tipo: "atualizar", chave: chaveOperacaoBeds24("atualizar", x.reservaId, 3), situacao: "pendente", beds24Id: "900001", pedido: v2.pedido });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", versao: 3, proximaTentativaEm: minutos(35) });
  });

  it("atualizar incerto igual ao antes depois de uma recusa: recusada, aguardando_equipe e o e-mail (nunca repete sozinho)", async () => {
    const x = await criada();
    await emCurso(x, "atualizar", { situacao: "incerta", resposta: "recusada", enviadoEm: minutos(20) });
    const correio = new CorreioMemoria();
    expect((await volta(minutos(26), correio)).passo1).toMatchObject({ avisos: 1 });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("recusada");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "recusada_pelo_beds24", avisadaEm: minutos(26) });
    expect(correio.enviadas.map((m) => m.chave)).toEqual([chaveDoEmailBeds24(x.reservaId, "recusada_pelo_beds24", (await acompanhamento(x.reservaId)).assinaturaEsperada)]);
  });

  it("o registro apagado: divergente/apagada_no_beds24 com a credencial de agora; com a credencial trocada, aguardando_equipe/sem_permissao e a marca fica", async () => {
    const x = await criada();
    await emCurso(x, "atualizar", { situacao: "incerta", resposta: "tempo", enviadoEm: minutos(20) });
    falso.bookings = [];
    await db.update(beds24ReservasSite).set({ credencial: "refresh:outra" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    expect(await resolver(minutos(21))).toMatchObject({ avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_permissao", otaFechadaEm: minutos(10) });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("incerta");
    // A mesma credencial: a reserva apagada no Beds24, e a pendência das datas nas OTAs volta.
    await db.update(beds24ReservasSite).set({ credencial: CREDENCIAL, situacao: "em_envio", motivo: null }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    expect(await resolver(minutos(22))).toMatchObject({ avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "apagada_no_beds24", otaFechadaEm: null });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("divergente");
  });

  it("o registro apagado com a mesma credencial, mas o quarto sem acesso em BRL: aguardando_equipe/sem_permissao, a marca fica e a operação continua incerta", async () => {
    const x = await criada();
    await emCurso(x, "atualizar", { situacao: "incerta", resposta: "tempo", enviadoEm: minutos(20) });
    falso.bookings = [];
    // A moeda trocada no Beds24.
    falso.properties = [{ id: 10, currency: "USD", roomTypes: [{ id: 20, name: "Studio" }] }];
    expect(await resolver(minutos(21))).toMatchObject({ avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_permissao", credencial: CREDENCIAL, otaFechadaEm: minutos(10) });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("incerta");
    // O quarto que não volta na leitura (o acesso ao imóvel tirado): o mesmo.
    await db.update(beds24ReservasSite).set({ situacao: "em_envio", motivo: null }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 21, name: "Outro" }] }];
    expect(await resolver(minutos(22))).toMatchObject({ avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_permissao", otaFechadaEm: minutos(10) });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("incerta");
  });

  it("atualizar incerto e o Beds24 diferente do pedido e do antes nas datas: divergente/mudada_no_beds24, o e-mail, e a pendência das datas nas OTAs volta", async () => {
    const x = await criada();
    await emCurso(x, "atualizar", { situacao: "incerta", resposta: "tempo", enviadoEm: minutos(20) });
    noBeds24({ departure: "2026-10-18" });
    const correio = new CorreioMemoria();
    expect((await volta(minutos(21), correio)).passo1).toMatchObject({ resolvidas: 1, avisos: 1 });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "divergente", depois: { ...PEDIDO_ANTES, saida: "2026-10-18" } });
    const a = await acompanhamento(x.reservaId);
    expect(a).toMatchObject({ situacao: "divergente", motivo: "mudada_no_beds24", lido: { ...PEDIDO_ANTES, saida: "2026-10-18" }, otaFechadaEm: null, otaFechadaPor: null });
    expect(correio.enviadas.map((m) => m.chave)).toEqual([chaveDoEmailBeds24(x.reservaId, "mudada_no_beds24", a.assinaturaEsperada)]);
  });

  it("atualizar incerto e só as pessoas mudadas por fora: divergente/mudada_no_beds24, e a marca das datas fechadas fica", async () => {
    const x = await criada();
    await emCurso(x, "atualizar", { situacao: "incerta", resposta: "tempo", enviadoEm: minutos(20) });
    noBeds24({ numAdult: 2, departure: "2026-10-16" });
    expect(await resolver(minutos(21))).toMatchObject({ resolvidas: 1, avisos: 1 });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("divergente");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "mudada_no_beds24", otaFechadaEm: minutos(10) });
  });

  it("um cancelamento no SCL depois de uma atualização incerta espera a saída dela e então vai para a fila do cancelamento", async () => {
    const x = await criada();
    await emCurso(x, "atualizar", { situacao: "incerta", resposta: "tempo", enviadoEm: minutos(20) });
    noBeds24({ departure: "2026-10-16" });
    const { resultado } = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), admin.usuarioId, minutos(21));
    expect(resultado.ok).toBe(true);
    // Com a atualização em curso, nenhuma intenção nova nasce (desenho 3.3: a seguinte espera ela terminar).
    expect(await abrirIntencao(db, c.org, x.reservaId, { agora: minutos(22), env: PRONTO, tipos: ["cancelar"], soEnfileirar: true })).toEqual({ saida: "nada" });
    // A saída confere a atualização (o fato), mas o SCL mudou: nenhuma marca, e o acompanhamento fica pendente agora.
    expect(await resolver(minutos(23))).toMatchObject({ resolvidas: 1 });
    expect((await operacoes(x.reservaId))[0].situacao).toBe("conferida");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", proximaTentativaEm: minutos(23) });
    // Bloco D (revisão): o modo que só enfileira diz qual operação ficou na fila (antes, `nada`, igual à recusa da régua).
    const aberta = await abrirIntencao(db, c.org, x.reservaId, { agora: minutos(24), env: PRONTO, tipos: ["cancelar"], soEnfileirar: true });
    expect((await operacoes(x.reservaId)).map((o) => [o.tipo, o.situacao, o.beds24Id])).toEqual([["atualizar", "conferida", "900001"], ["cancelar", "pendente", "900001"], ["criar", "conferida", "900001"]]);
    expect(aberta).toEqual({ saida: "enfileirada", operacaoId: (await operacoes(x.reservaId))[1].id });
  });

  it("cancelar vencido e o registro cancelled no Beds24: conferida, as datas reabertas pelo sistema e o acompanhamento encerrado", async () => {
    const x = await criada();
    const { resultado } = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), admin.usuarioId, minutos(15));
    expect(resultado.ok).toBe(true);
    await emCurso(x, "cancelar", { situacao: "enviando", resposta: null, enviadoEm: minutos(20) });
    noBeds24({ status: "cancelled" });
    expect(await resolver(minutos(21))).toMatchObject({ resolvidas: 1, conferidas: 1 });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ tipo: "cancelar", situacao: "conferida" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "encerrada", motivo: null });
    const [cancelamento] = await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId));
    expect(cancelamento).toMatchObject({ otaLiberadaEm: minutos(21), otaLiberadaPor: null });
    expect(await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.cancelar")))).toHaveLength(1);
  });

  it("cancelar com outro registro nosso com a marca ainda vivo: nada é marcado (feita, aguardando_equipe/duplicada); cancelado lá, o 'Conferir agora' marca", async () => {
    const x = await criada();
    await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), admin.usuarioId, minutos(15));
    await emCurso(x, "cancelar", { situacao: "enviando", resposta: null, enviadoEm: minutos(20) });
    noBeds24({ status: "cancelled" });
    falso.bookings.push(registro({ id: 777001, apiSource: "API", infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }] }));
    expect(await resolver(minutos(21))).toMatchObject({ avisos: 1 });
    const cancelamentoOp = (await operacoes(x.reservaId))[0];
    expect(cancelamentoOp).toMatchObject({ tipo: "cancelar", situacao: "feita", detalhe: { duplicadas: ["777001"] } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "duplicada" });
    expect((await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId)))[0].otaLiberadaEm).toBeNull();
    // A equipe cancela a duplicada no Beds24; o "Conferir agora" (a mesma saída) confere de novo e marca.
    falso.bookings.find((b) => String(b.id) === "777001")!.status = "cancelled";
    expect(await resolverOperacaoEmCurso(db, c.org, cancelamentoOp.id, falso, opcoes(minutos(30)))).toEqual({ fechamento: "encerrada" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "encerrada" });
    expect((await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId)))[0].otaLiberadaEm).toEqual(minutos(30));
  });

  it("cancelar com uma reserva de OTA com o código no info item, viva nas mesmas datas: ela nunca é cancelada nem vai para a lista da duplicada; nada é marcado, e a equipe confere", async () => {
    const x = await criada();
    await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), admin.usuarioId, minutos(15));
    await emCurso(x, "cancelar", { situacao: "enviando", resposta: null, enviadoEm: minutos(20) });
    noBeds24({ status: "cancelled" });
    falso.bookings.push(registro({ id: 777002, channel: "Booking.com", infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }] }));
    // Bloco D (revisão): antes, a conferência antes de liberar deixava passar este registro vivo com a marca (que não é nosso) e
    // marcava as datas reabertas (`conferida`/`encerrada`). Desenho 4.3: "qualquer outra coisa vira aviso". O id vai para os
    // ids da equipe (`detalhe.duplicadas`, com o motivo `marca_em_registro_inesperado`, como na adoção), nunca para a lista da
    // `duplicada` (a que se cancela no Beds24), e nenhum POST sai.
    expect(await resolver(minutos(21))).toMatchObject({ resolvidas: 1, conferidas: 0, avisos: 1 });
    const [cancelamentoOp] = await operacoes(x.reservaId);
    expect(cancelamentoOp).toMatchObject({ tipo: "cancelar", situacao: "feita", detalhe: { duplicadas: ["777002"] } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "marca_em_registro_inesperado" });
    expect((await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId)))[0].otaLiberadaEm).toBeNull();
    expect(falso.escritasReservas).toHaveLength(1);
  });

  it("cancelar com um black que sobrou sobre as noites: nada é marcado, manual/bloqueio_manual com as noites do bloqueio", async () => {
    const x = await criada();
    await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), admin.usuarioId, minutos(15));
    await emCurso(x, "cancelar", { situacao: "enviando", resposta: null, enviadoEm: minutos(20) });
    noBeds24({ status: "cancelled" });
    falso.bookings.push(registro({ id: 5550002, status: "black", arrival: "2026-10-13", departure: "2026-10-14" }));
    expect(await resolver(minutos(21))).toMatchObject({ avisos: 1 });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "conferida", detalhe: { bloqueio: { inicio: "2026-10-13", fim: "2026-10-14" } } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "manual", motivo: "bloqueio_manual" });
    expect((await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId)))[0].otaLiberadaEm).toBeNull();
  });
});

describe("teste 24: a recusa e o success:false", () => {
  it("success: false que gravou: a busca acha a marca e adota; nunca vira conflito", async () => {
    const x = await pagarEConfirmar(c);
    falso.gravarComSuccessFalse = true;
    expect(await rodar(minutos(10))).toMatchObject({ posts: 1, incertas: 1 });
    falso.gravarComSuccessFalse = false;
    await enviadoEm(x.reservaId, minutos(10));
    expect(await resolver(minutos(16))).toMatchObject({ conferidas: 1, avisos: 0 });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null });
  });

  it("a recusa de disponibilidade em duas voltas: um POST só, recusada, aguardando_equipe/sem_disponibilidade, a atenção e um e-mail com a chave", async () => {
    const x = await pagarEConfirmar(c);
    const correio = new CorreioMemoria();
    falso.recusarDisponibilidade = true;
    expect((await volta(minutos(10), correio)).envio).toMatchObject({ posts: 1, incertas: 1 });
    expect(correio.enviadas).toEqual([]);
    await enviadoEm(x.reservaId, minutos(10));
    expect(await volta(minutos(16), correio)).toMatchObject({ passo1: { avisos: 1 }, envio: { posts: 0 }, avisos: { enviados: 1 } });
    expect((await operacoes(x.reservaId)).map((o) => [o.situacao, o.resposta])).toEqual([["recusada", "recusada_disponibilidade"]]);
    const a = await acompanhamento(x.reservaId);
    expect(a).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_disponibilidade", avisadaEm: minutos(16) });
    expect((await tarefasDasOtas(db, c.org, minutos(16), PRONTO)).atencoes).toMatchObject([{ reservaId: x.reservaId, tipo: "aguardando_equipe" }]);
    // No Início (bloco G), a linha da reserva com o motivo em palavras (o que fazer está na ficha).
    const ficha = `/painel/reservas/${x.reservaId}`;
    expect((await avisosDeReservasNoBeds24(db, c.org, minutos(16), PRONTO)).filter((l) => l.link === ficha)).toEqual([
      { nivel: "atencao", texto: `Reserva ${x.reservaCodigo} aguarda a equipe no Beds24 (o Beds24 não mostrou as noites livres): veja a ficha.`, link: ficha },
    ]);
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]).toMatchObject({ para: EMAIL_EQUIPE, chave: `beds24-reserva:${x.reservaId}:sem_disponibilidade:${a.assinaturaEsperada}`, conteudoRestrito: true });
    expect(correio.enviadas[0].texto).toContain(x.reservaCodigo);
    expect(correio.enviadas[0].texto).toContain("imóvel 403");
    expect(correio.enviadas[0].texto).toContain("de 12/10 a 15/10");
    // A volta seguinte nem envia de novo ao Beds24 nem repete o e-mail.
    expect(await volta(minutos(30), correio)).toMatchObject({ envio: { posts: 0 }, avisos: { enviados: 0 } });
    expect(falso.escritasReservas).toHaveLength(1);
    expect(correio.enviadas).toHaveLength(1);
    // A mensagem do Beds24 (com um nome fictício de propósito) nunca chega a uma tabela nem ao e-mail.
    expect(JSON.stringify([await operacoes(x.reservaId), correio.enviadas])).not.toContain("Fictício");
    expect(await semDados(correio)).toEqual([]);
  });
});

describe("teste 25: o ocupante exato e a marca ilegível", () => {
  it("a resposta perdida e o registro sem marca (a credencial não lê o info item): aguardando_equipe/incerta com o id sugerido; nunca venda dupla nem segundo POST", async () => {
    const x = await pagarEConfirmar(c);
    const correio = new CorreioMemoria();
    falso.perderRespostaReserva = true;
    falso.semMarcaNaLeitura = true;
    await volta(minutos(10), correio);
    falso.perderRespostaReserva = false;
    await enviadoEm(x.reservaId, minutos(10));
    expect((await volta(minutos(16), correio)).passo1).toMatchObject({ avisos: 1 });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "incerta", detalhe: { candidato: "900001" }, beds24Id: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "incerta" });
    expect((await c.reserva(x.reservaId)).beds24Id).toBeNull();
    expect(JSON.stringify(await tarefasDasOtas(db, c.org, minutos(16), PRONTO))).not.toContain("venda dupla");
    expect(await volta(minutos(40), correio)).toMatchObject({ envio: { posts: 0 } });
    expect(falso.escritasReservas).toHaveLength(1);
    // A incerteza não é caso de e-mail: o Início mostra a atenção (bloco G: a linha da reserva, com o motivo, nunca "venda dupla").
    expect(correio.enviadas).toEqual([]);
    const ficha = `/painel/reservas/${x.reservaId}`;
    expect((await avisosDeReservasNoBeds24(db, c.org, minutos(40), PRONTO)).filter((l) => l.link === ficha)).toEqual([
      { nivel: "atencao", texto: `Reserva ${x.reservaCodigo} aguarda a equipe no Beds24 (o envio ficou sem confirmação): veja a ficha.`, link: ficha },
    ]);
  });

  it("um canal desconhecido sem a origem da API nas mesmas datas nunca é o ocupante exato: a nova tentativa vira conflito, com o e-mail da venda dupla", async () => {
    const x = await pagarEConfirmar(c);
    const correio = new CorreioMemoria();
    vi.spyOn(falso, "gravarReservas").mockResolvedValueOnce(respostaDaGravacao("tempo"));
    await volta(minutos(10), correio);
    falso.bookings.push(registro({ id: 5550001, channel: "Expedia" }));
    await enviadoEm(x.reservaId, minutos(10));
    expect((await volta(minutos(16), correio)).passo1).toMatchObject({ novasVersoes: 1 });
    expect((await volta(minutos(27), correio)).envio).toMatchObject({ posts: 0, avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conflito", motivo: "noites_ocupadas", avisadaEm: minutos(27) });
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0].assunto).toBe(`Possível venda dupla: reserva ${x.reservaCodigo}`);
    expect(correio.enviadas[0].texto).toContain("O sistema não criou nada.");
    expect(await semDados(correio)).toEqual([]);
  });

  it("a criação feita relida sem a marca: divergente/marca_ilegivel, o e-mail, e a criação seguinte da empresa para", async () => {
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    const correio = new CorreioMemoria();
    // Só a primeira sai nesta volta: o crédito baixo para a volta depois dela, e a releitura dela cai.
    falso.creditoRestante = 10;
    falso.lento = () => {
      if (falso.escritasReservas.length) falso.falhar = new ErroBeds24("Beds24 não respondeu a tempo.", "tempo");
    };
    expect(await rodar(minutos(10))).toMatchObject({ posts: 1, parada: "credito" });
    falso.lento = null;
    falso.falhar = null;
    falso.creditoRestante = null;
    expect((await operacoes(x.reservaId))[0].situacao).toBe("feita");
    falso.semMarcaNaLeitura = true;
    expect(await volta(minutos(12), correio)).toMatchObject({ passo1: { avisos: 1 }, envio: { posts: 0, configuracao: { motivo: "marca_ilegivel", para: "criacoes" } }, avisos: { enviados: 1 } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "marca_ilegivel" });
    expect(await operacoes(y.reservaId)).toEqual([]);
    expect(correio.enviadas[0].assunto).toBe(`Reserva ${x.reservaCodigo} sem a marca do SCL no Beds24`);
  });
});

describe("a variante da adoção do 'Já existe, vincular o id' (vincularRegistro)", () => {
  /** A criação incerta (a resposta perdida, o registro 900001 com a marca no Beds24) e a leitura por id dos registros. */
  async function incerta() {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await rodar(minutos(10));
    falso.perderRespostaReserva = false;
    return x;
  }
  const lidos = async (...ids: string[]) => (await falso.reservas({ ids, chegadaDe: "1900-01-01", incluirInfo: true })).itens;
  const vincular = (reservaId: string, r: ReservaBeds24, outros: ReservaBeds24[], o: { semMarca?: boolean } = {}) => db.transaction((tx) => vincularRegistro(tx, c.org, reservaId, r, outros, { ...o, autorId: admin.usuarioId }));

  it("na duplicada de verdade (a saída deixou a criação divergente e o acompanhamento aguardando_equipe/duplicada): recusa com os ids vivos; com os outros cancelados no Beds24, vincula", async () => {
    const x = await incerta();
    falso.bookings.push(registro({ id: 777001, apiSource: "API", infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }] }));
    await enviadoEm(x.reservaId, minutos(10));
    expect(await resolver(minutos(16))).toMatchObject({ avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "duplicada" });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "divergente", detalhe: { duplicadas: ["777001", "900001"] } });
    let [escolhido, outro] = await lidos("900001", "777001");
    expect(await vincular(x.reservaId, escolhido, [escolhido, outro])).toEqual({ vinculado: false, motivo: "duplicada", ids: ["777001"] });
    falso.bookings.find((b) => String(b.id) === "777001")!.status = "cancelled";
    [escolhido, outro] = await lidos("900001", "777001");
    expect(await vincular(x.reservaId, escolhido, [escolhido, outro])).toEqual({ vinculado: true, beds24Id: "900001", semMarca: false });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    const [auditada] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.adotar")));
    expect(auditada).toMatchObject({ usuarioId: admin.usuarioId, mudancas: { beds24Id: [null, "900001"] } });
    // A criação já era terminal e fica como está; a operação `vincular` (conferida ou divergente, com o id) e a conferência
    // são de quem chama (o botão, bloco G).
    expect((await operacoes(x.reservaId)).map((o) => [o.tipo, o.situacao, o.beds24Id])).toEqual([["criar", "divergente", null]]);
  });

  it("na criação ainda incerta: recusa com os ids vivos; com os outros cancelados no Beds24, vincula o escolhido (o id na reserva, a criação feita, a auditoria com o autor)", async () => {
    const x = await incerta();
    falso.bookings.push(registro({ id: 777001, apiSource: "API", infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }] }));
    let [escolhido, outro] = await lidos("900001", "777001");
    expect(await vincular(x.reservaId, escolhido, [escolhido, outro])).toEqual({ vinculado: false, motivo: "duplicada", ids: ["777001"] });
    falso.bookings.find((b) => String(b.id) === "777001")!.status = "cancelled";
    [escolhido, outro] = await lidos("900001", "777001");
    expect(await vincular(x.reservaId, escolhido, [escolhido, outro])).toEqual({ vinculado: true, beds24Id: "900001", semMarca: false });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "feita", beds24Id: "900001" });
    const [auditada] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.adotar")));
    expect(auditada).toMatchObject({ usuarioId: admin.usuarioId, mudancas: { beds24Id: [null, "900001"] } });
  });

  it("sem a marca: recusa sem a segunda confirmação; com ela, só o registro da origem que pode ser a do SCL, no quarto e nas datas", async () => {
    const x = await incerta();
    delete falso.bookings[0].infoItems;
    const [semMarca] = await lidos("900001");
    expect(await vincular(x.reservaId, semMarca, [])).toEqual({ vinculado: false, motivo: "sem_marca", id: "900001" });
    falso.bookings.push(registro({ id: 5550001, referer: "Airbnb" }));
    const [deOta] = await lidos("5550001");
    expect(await vincular(x.reservaId, deOta, [], { semMarca: true })).toEqual({ vinculado: false, motivo: "nao_bate", id: "5550001" });
    expect(await vincular(x.reservaId, semMarca, [], { semMarca: true })).toEqual({ vinculado: true, beds24Id: "900001", semMarca: true });
  });
});

describe("o e-mail nunca sai de dentro de uma transação (critério do bloco C2)", () => {
  it("o trabalhador não importa o e-mail nem os avisos: a rotina manda depois dos commits", () => {
    const fonte = readFileSync(join(__dirname, "reservas-site-envio.ts"), "utf8");
    expect(fonte).not.toMatch(/from ["']@\/email\//);
    expect(fonte).not.toMatch(/import\(\s*["']@\/email\//);
    expect(fonte).not.toMatch(/["']\.\/reservas-site-avisos["']/);
  });
});
