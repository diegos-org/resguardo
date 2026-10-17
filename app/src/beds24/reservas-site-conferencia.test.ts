/**
 * Reserva paga do site no Beds24 (M8.3c) — a conferência contínua (desenho 4.5; plano 1.11 e teste 31): a leitura por
 * `modifiedFrom` a cada volta e a releitura por id de hora em hora, com a importação desligada; a mesma regra da importação
 * (`conferirNaImportacao`), a saída do `divergente` que volta a bater, a credencial trocada, o registro sem dono, o id
 * repetido, a trava e a janela, e as marcas de tempo que só avançam quando a leitura conclui. PGlite, os cenários do pagamento,
 * o Beds24 falso, `CorreioMemoria` e um espião de `fetch` que nunca é chamado: nada vai ao Beds24. O `env` é sempre explícito.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { gravarConfig } from "@/configuracoes/armazem";
import { auditoria, beds24ReservasSite } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { type Cenario, EMAIL_HOSPEDE, env, minutos, montarCenario, NOME_HOSPEDE, pagarEConfirmar, semDadosPessoais, TELEFONE_HOSPEDE } from "@/pagamentos/testes";
import { lerConfigBeds24 } from "./configuracao";
import { Beds24Falso, ESCOPOS_ESPERADOS_FALSO } from "./falso";
import { impressaoCredencialBeds24 } from "./http";
import { INFO_MARCA_SCL, normalizarReserva } from "./normalizar";
import { avisarEquipeDasReservasNoBeds24, chaveDoEmailBeds24 } from "./reservas-site-avisos";
import { conferirContinuamente, FOLGA_DA_CONFERENCIA_MS } from "./reservas-site-conferencia";
import { enviarReservasDoSite, type OpcoesDoEnvio } from "./reservas-site-envio";
import { gravarEscoposLidos, lerEstadoRotina } from "./reservas-site-rotina";
import { tarefasDasOtas } from "./reservas-site-tarefas";
import { ErroBeds24 } from "./tipos";
import { tentarTravaBeds24 } from "./trava";

// A trava `beds24:<org>` espiada (por padrão, a de verdade): o teste da trava ocupada recusa uma vez.
vi.mock("./trava", async (orig) => {
  const o = await orig<typeof import("./trava")>();
  return { ...o, tentarTravaBeds24: vi.fn(o.tentarTravaBeds24) };
});

/** O deploy de produção com a chave das reservas e o refresh token (fictício): a trava de ambiente aberta. */
const PRONTO = env({ VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" });
/** O mesmo deploy com outro refresh token (fictício): a credencial trocada desde a criação. */
const OUTRA = env({ VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "outro-refresh-ficticio" });
const CREDENCIAL = impressaoCredencialBeds24(PRONTO);
const ENSAIO = { credencial: CREDENCIAL, em: "2026-09-01T00:00:00.000Z", operacaoId: "6f1c2a7e-3b4d-4c5e-8f90-123456789abc" };
const EMAIL_EQUIPE = "equipe@example.com";
type Obj = Record<string, unknown>;

let db: Db, close: () => Promise<void>, c: Cenario, falso: Beds24Falso, relogio: Date;
let espiao: ReturnType<typeof vi.spyOn>;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  espiao = vi.spyOn(globalThis, "fetch");
  c = await montarCenario(db);
  relogio = minutos(10);
  // O relógio do falso é o do teste: a criação e cada mudança gravam `modifiedTime` nele.
  falso = new Beds24Falso(() => relogio);
  falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Studio" }] }];
  falso.calendarios = [{ roomId: 20, calendar: dias() }];
  await gravarConfig(db, c.org, "reservas_beds24", { pausado: null, retomado: null, imoveis: [{ imovelId: c.imovel, ligadoEm: "2026-09-01T00:00:00.000Z", ligadoPor: null }], ensaio: ENSAIO }, null);
  await gravarEscoposLidos(db, c.org, CREDENCIAL, { escopos: [...ESCOPOS_ESPERADOS_FALSO], ilegiveis: [] }, minutos(0));
  await gravarConfig(db, c.org, "empresa", { email: EMAIL_EQUIPE }, null);
});
afterEach(() => {
  expect(espiao).not.toHaveBeenCalled();
  espiao.mockRestore();
  vi.mocked(tentarTravaBeds24).mockClear();
});

/** Um dia por faixa, de 01/10 a 30/11, com uma unidade livre por noite. */
function dias() {
  const l: Obj[] = [];
  for (let d = "2026-10-01"; d <= "2026-11-30"; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) l.push({ from: d, to: d, numAvail: 1, price1: 450 });
  return l;
}
const opcoes = (agora: Date, e: NodeJS.ProcessEnv = PRONTO): OpcoesDoEnvio => ({ env: e, relogio: { agora: () => agora, restanteMs: () => 240_000 } });
/** A conferência contínua no instante `agora` (o relógio do falso vai junto). */
const conferir = (agora: Date, e: NodeJS.ProcessEnv = PRONTO) => {
  relogio = agora;
  return conferirContinuamente(db, c.org, falso, opcoes(agora, e));
};
const acompanhamento = async (reservaId: string) => (await db.select().from(beds24ReservasSite).where(eq(beds24ReservasSite.reservaId, reservaId)))[0];
/** O registro guardado no falso para o id (o formato da API). */
const noFalso = (id: string) => falso.bookings.find((b) => String(b.id) === id)!;
/** Muda o registro no Beds24 falso por fora, como a equipe ou o canal, com a hora de modificação de agora. */
const mudarNoFalso = (id: string, mudancas: Obj, em: Date) => Object.assign(noFalso(id), mudancas, { modifiedTime: em.toISOString() });
const semDados = (correio?: CorreioMemoria) => semDadosPessoais(db, [EMAIL_HOSPEDE, TELEFONE_HOSPEDE], { nomes: [NOME_HOSPEDE], correio });

/** Uma reserva paga, criada pelo sistema no Beds24 às 10 min e conferida (a primeira conferência contínua às 12 min). */
async function criadaEConferida() {
  const x = await pagarEConfirmar(c);
  relogio = minutos(10);
  expect(await enviarReservasDoSite(db, c.org, falso, opcoes(minutos(10)))).toMatchObject({ criadas: 1, conferidas: 1 });
  const id = (await c.reserva(x.reservaId)).beds24Id!;
  expect(await conferir(minutos(12))).toMatchObject({ conferidos: 1, voltaram: 0, avisos: 0, releitura: true, parada: null });
  expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", otaFechadaEm: minutos(10) });
  return { ...x, id };
}

describe("teste 31: a conferência contínua, com a importação desligada", () => {
  it("cancelada no Beds24: a leitura por modifiedFrom (desde a última menos 15 min) dá divergente/cancelada_no_beds24, limpa as datas fechadas, a atenção e o e-mail", async () => {
    expect((await lerConfigBeds24(db, c.org)).automatica).toBe(false);
    const x = await criadaEConferida();
    // A primeira leitura voltou 24 h; as duas marcas de tempo avançaram para a hora da leitura.
    expect(falso.filtrosLidos[falso.filtrosLidos.length - 1]).toEqual({ modificadasDesde: new Date(minutos(12).getTime() - 24 * 3_600_000).toISOString(), propertyIds: ["10"], incluirInfo: true });
    expect(await lerEstadoRotina(db, c.org)).toMatchObject({ conferenciaEm: minutos(12), releituraEm: minutos(12) });

    // Um e-mail de antes (de outro caso) já marcou `avisada_em`: a transição para a divergência o zera, e o aviso novo sai.
    await db.update(beds24ReservasSite).set({ avisadaEm: minutos(11) }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    mudarNoFalso(x.id, { status: "cancelled" }, minutos(20));
    const lidas = falso.filtrosLidos.length;
    expect(await conferir(minutos(22))).toMatchObject({ conferidos: 1, avisos: 1, releitura: false, parada: null });
    // Só a leitura por modifiedFrom (a releitura por id é de hora em hora), desde 15 min antes da última que concluiu.
    expect(falso.filtrosLidos.slice(lidas)).toEqual([{ modificadasDesde: new Date(minutos(12).getTime() - FOLGA_DA_CONFERENCIA_MS).toISOString(), propertyIds: ["10"], incluirInfo: true }]);
    const a = await acompanhamento(x.reservaId);
    expect(a).toMatchObject({ situacao: "divergente", motivo: "cancelada_no_beds24", otaFechadaEm: null, otaFechadaPor: null, avisadaEm: null, lido: { situacao: "cancelada" } });
    expect((await tarefasDasOtas(db, c.org, minutos(23), PRONTO)).atencoes).toEqual([{ reservaId: x.reservaId, codigo: x.reservaCodigo, tipo: "divergente" }]);
    expect(await lerEstadoRotina(db, c.org)).toMatchObject({ conferenciaEm: minutos(22), releituraEm: minutos(12) });

    // O e-mail sai depois, pela rotina (fora de qualquer transação), uma vez só.
    const correio = new CorreioMemoria();
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(23))).toMatchObject({ enviados: 1 });
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]).toMatchObject({ para: EMAIL_EQUIPE, chave: chaveDoEmailBeds24(x.reservaId, "cancelada_no_beds24", a.assinaturaEsperada), assunto: `Reserva ${x.reservaCodigo} cancelada no Beds24` });
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(24))).toMatchObject({ enviados: 0 });
    expect(await semDados(correio)).toEqual([]);
  });

  it("voltar o registro a confirmado no Beds24 leva o divergente a conferida: o motivo nulo, as datas fechadas de novo pelo sistema e a auditoria", async () => {
    const x = await criadaEConferida();
    mudarNoFalso(x.id, { status: "cancelled" }, minutos(20));
    await conferir(minutos(22));
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", otaFechadaEm: null });
    // A volta seguinte relê o mesmo registro (a folga de 15 min sobre a última leitura) e nada muda: continua divergente.
    expect(await conferir(minutos(32))).toMatchObject({ conferidos: 1, voltaram: 0, avisos: 0 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "cancelada_no_beds24" });

    mudarNoFalso(x.id, { status: "confirmed" }, minutos(40));
    expect(await conferir(minutos(42))).toMatchObject({ conferidos: 1, voltaram: 1, avisos: 0 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null, conferidaEm: minutos(42), otaFechadaEm: minutos(42), otaFechadaPor: null });
    const [auditada] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.conferir")));
    expect(auditada).toMatchObject({ entidade: "reserva", entidadeId: x.reservaId, usuarioId: null, mudancas: { situacaoNoBeds24: ["divergente", "conferida"], motivoNoBeds24: ["cancelada_no_beds24", null], otaFechadaPeloSistema: [false, true] } });
    expect((await tarefasDasOtas(db, c.org, minutos(43), PRONTO)).atencoes).toEqual([]);
  });

  it("apagada no Beds24: só a passada de hora em hora conclui apagada_no_beds24, com as datas fechadas limpas, a atenção e o e-mail com a chave", async () => {
    const x = await criadaEConferida();
    falso.bookings = falso.bookings.filter((b) => String(b.id) !== x.id);
    // Antes de 1 h desde a última releitura, o id que não aparece em modifiedFrom não quer dizer nada.
    expect(await conferir(minutos(22))).toMatchObject({ conferidos: 0, avisos: 0, releitura: false });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", otaFechadaEm: minutos(10) });

    const lidas = falso.filtrosLidos.length;
    expect(await conferir(minutos(72))).toMatchObject({ conferidos: 1, avisos: 1, releitura: true, parada: null });
    // A releitura por id, sem filtro de chegada e com os info items (a mesma da importação).
    expect(falso.filtrosLidos.slice(lidas)).toEqual([
      { modificadasDesde: new Date(minutos(22).getTime() - FOLGA_DA_CONFERENCIA_MS).toISOString(), propertyIds: ["10"], incluirInfo: true },
      { ids: [x.id], chegadaDe: "1900-01-01", incluirInfo: true },
    ]);
    const a = await acompanhamento(x.reservaId);
    expect(a).toMatchObject({ situacao: "divergente", motivo: "apagada_no_beds24", otaFechadaEm: null, lido: null, avisadaEm: null });
    expect((await tarefasDasOtas(db, c.org, minutos(73), PRONTO)).atencoes).toEqual([{ reservaId: x.reservaId, codigo: x.reservaCodigo, tipo: "divergente" }]);
    expect(await lerEstadoRotina(db, c.org)).toMatchObject({ conferenciaEm: minutos(72), releituraEm: minutos(72) });

    const correio = new CorreioMemoria();
    await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(73));
    expect(correio.enviadas.map((m) => m.chave)).toEqual([chaveDoEmailBeds24(x.reservaId, "apagada_no_beds24", a.assinaturaEsperada)]);
    expect(correio.enviadas[0].chave).toContain(":apagada_no_beds24:");
    expect(await semDados(correio)).toEqual([]);
  });

  it("com a credencial trocada (o id some para outra conta): aguardando_equipe/sem_permissao, e as datas fechadas ficam", async () => {
    const x = await criadaEConferida();
    falso.bookings = [];
    expect(await conferir(minutos(72), OUTRA)).toMatchObject({ conferidos: 1, avisos: 1, releitura: true });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_permissao", otaFechadaEm: minutos(10), lido: { situacao: "confirmada" } });
    // Não é um caso de e-mail (nada foi recusado no POST): a atenção do Início fica.
    const correio = new CorreioMemoria();
    expect(await avisarEquipeDasReservasNoBeds24(db, c.org, correio, minutos(73))).toMatchObject({ enviados: 0 });
  });

  it("com o quarto sem acesso em BRL (a mesma credencial): aguardando_equipe/sem_permissao, sem concluir apagada", async () => {
    const x = await criadaEConferida();
    falso.bookings = [];
    falso.properties = [{ id: 10, currency: "USD", roomTypes: [{ id: 20, name: "Studio" }] }];
    await conferir(minutos(72));
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_permissao", otaFechadaEm: minutos(10) });
  });

  it("um registro sem dono na releitura (um id que não foi pedido) não conclui: nada muda, e a releitura não avança", async () => {
    const x = await criadaEConferida();
    falso.bookings = [];
    const original = falso.reservas.bind(falso);
    vi.spyOn(falso, "reservas").mockImplementation(async (f) => {
      const l = await original(f);
      const estranho = normalizarReserva({ id: 5550002, propertyId: 10, roomId: 20, status: "confirmed", arrival: "2026-11-01", departure: "2026-11-03", numAdult: 2 });
      if (f.ids && estranho.ok) l.itens.push(estranho.r);
      return l;
    });
    expect(await conferir(minutos(72))).toMatchObject({ conferidos: 0, avisos: 0, semConclusao: 1, releitura: false });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", otaFechadaEm: minutos(10) });
    expect(await lerEstadoRotina(db, c.org)).toMatchObject({ conferenciaEm: minutos(72), releituraEm: minutos(12) });
  });

  it("o registro em formato inválido não conclui (nunca vira apagada); o id repetido para tudo e não avança as marcas", async () => {
    const x = await criadaEConferida();
    mudarNoFalso(x.id, { status: "status-que-nao-existe" }, minutos(20));
    expect(await conferir(minutos(22))).toMatchObject({ conferidos: 0, semConclusao: 1, parada: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida" });

    mudarNoFalso(x.id, { status: "cancelled" }, minutos(30));
    falso.bookings.push({ ...noFalso(x.id) });
    expect(await conferir(minutos(32))).toMatchObject({ conferidos: 0, parada: "falhou", falha: "formato" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida" });
    expect(await lerEstadoRotina(db, c.org)).toMatchObject({ conferenciaEm: minutos(22) });
  });

  it("a recusa do Beds24 na leitura (429, 401 ou 403) para a conferência; a trava ocupada e a janela também, sem avançar as marcas", async () => {
    const x = await criadaEConferida();
    mudarNoFalso(x.id, { status: "cancelled" }, minutos(20));
    for (const [status, parada] of [[429, "limite"], [401, "sem_permissao"], [403, "sem_permissao"]] as const) {
      falso.falhar = new ErroBeds24(`Beds24 respondeu HTTP ${status}.`, "http", status);
      expect(await conferir(minutos(22))).toMatchObject({ conferidos: 0, parada });
    }
    falso.falhar = null;
    vi.mocked(tentarTravaBeds24).mockResolvedValueOnce(false);
    expect(await conferir(minutos(22))).toMatchObject({ conferidos: 0, parada: "trava" });
    const lidas = falso.filtrosLidos.length;
    expect(await conferir(new Date("2026-10-02T09:10:00Z"))).toMatchObject({ conferidos: 0, parada: "janela" });
    expect(falso.filtrosLidos).toHaveLength(lidas);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida" });
    expect(await lerEstadoRotina(db, c.org)).toMatchObject({ conferenciaEm: minutos(12), releituraEm: minutos(12) });
    // Concluída a leitura, a mudança é vista e as marcas avançam.
    expect(await conferir(minutos(24))).toMatchObject({ conferidos: 1, avisos: 1, parada: null });
    expect(await lerEstadoRotina(db, c.org)).toMatchObject({ conferenciaEm: minutos(24) });
  });

  it("com a marca ilegível (o info code apagado no Beds24), as criações param; repor a marca leva a conferida e libera as criações", async () => {
    const x = await criadaEConferida();
    mudarNoFalso(x.id, { infoItems: [] }, minutos(20));
    await conferir(minutos(22));
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "marca_ilegivel", otaFechadaEm: minutos(10) });
    // Outra reserva paga: as criações estão paradas pela marca ilegível (a mesma regra do começo da volta).
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "outra@example.com" });
    relogio = minutos(25);
    expect(await enviarReservasDoSite(db, c.org, falso, opcoes(minutos(25)))).toMatchObject({ posts: 0, configuracao: { motivo: "marca_ilegivel", para: "criacoes" } });

    mudarNoFalso(x.id, { infoItems: [{ code: INFO_MARCA_SCL, text: x.reservaCodigo }] }, minutos(30));
    expect(await conferir(minutos(32))).toMatchObject({ voltaram: 1 });
    // As datas fechadas ficaram (a divergência só da marca não as limpa): a saída não regrava a marca.
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null, otaFechadaEm: minutos(10) });
    relogio = minutos(35);
    expect(await enviarReservasDoSite(db, c.org, falso, opcoes(minutos(35)))).toMatchObject({ posts: 1, criadas: 1, configuracao: null });
    expect((await c.reserva(y.reservaId)).beds24Id).not.toBeNull();
  });

  it("sem reserva acompanhada, nada é lido; a de estadia já terminada também fica de fora", async () => {
    expect(await conferir(minutos(12))).toEqual({ conferidos: 0, voltaram: 0, avisos: 0, semConclusao: 0, releitura: false, parada: null });
    expect(falso.filtrosLidos).toEqual([]);
    const x = await criadaEConferida();
    const lidas = falso.filtrosLidos.length;
    // Depois da saída (15/10), a reserva não é mais acompanhada.
    expect(await conferir(new Date("2026-10-16T15:00:00Z"))).toMatchObject({ conferidos: 0 });
    expect(falso.filtrosLidos).toHaveLength(lidas);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida" });
  });
});
