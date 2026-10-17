/**
 * Reserva paga do site no Beds24 (M8.3c, bloco G) — os botões da ficha no domínio (desenho 3.3, 3.6, 3.8, 5, 6.6 e 8; plano
 * 1.15, testes 38 e 40 e o 21 pelo botão "Reenviar"): a permissão de cada botão no domínio (a operação nunca usa os de
 * configuração), as travas comuns (a credencial da organização, o deploy de produção), "Conferir agora" (só lê, a mesma saída
 * da rotina), "Tentar de novo", "Deixar à mão", "Reenviar o que está no SCL", "Não existe, pode criar", "Vincular o id" e
 * "Passar ao sistema". Nenhum botão faz POST nem deixa uma operação `enviando`: os que reabrem o envio só enfileiram, e a
 * volta da rotina (chamada aqui, com o falso) envia. PGlite, os cenários do pagamento, o Beds24 falso e um espião de `fetch`
 * que nunca é chamado: nada vai ao Beds24. O `env` é sempre explícito (o deploy de produção fictício com a credencial desta
 * organização), e o leitor é o falso injetado: nenhuma fábrica do ambiente é chamada.
 *
 * O relógio dos testes é o injetado (`minutos`); o `enviado_em` vem do relógio do banco e é regravado com o do teste nos
 * casos dos 5 minutos (padrão de `trava.test.ts`).
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { gravarConfig } from "@/configuracoes/armazem";
import { auditoria, beds24ReservasOperacoes, beds24ReservasSite, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { type Cenario, env, minutos, montarCenario, pagarEConfirmar, semDadosDoHospede, usuarioDeTeste } from "@/pagamentos/testes";
import { Beds24Falso, ESCOPOS_ESPERADOS_FALSO } from "./falso";
import { impressaoCredencialBeds24 } from "./http";
import { INFO_MARCA_SCL } from "./normalizar";
import {
  botoesDaFichaBeds24, conferirAgoraNoBeds24, deixarAMaoNoBeds24, ERRO_BOTAO_APAGADA, ERRO_BOTAO_CRIAR_COM_ID, ERRO_BOTAO_EM_ENVIO, ERRO_BOTAO_FORA_DA_PRODUCAO, ERRO_BOTAO_ID_INVALIDO, ERRO_BOTAO_ID_NAO_VOLTOU,
  ERRO_BOTAO_MARCADA_A_MAO, ERRO_BOTAO_NADA_A_CONFERIR, ERRO_BOTAO_OUTRA_ORGANIZACAO, ERRO_BOTAO_REATIVACAO, ERRO_BOTAO_SEM_LEITURA, ERRO_BOTAO_SEM_MARCA_COM_ENSAIO, erroAguardeOBeds24, type EstadoDosBotoes,
  motivoSemBotao, naoExisteNoBeds24, passarAoSistemaBeds24, reenviarAoBeds24, tentarDeNovoNoBeds24, vincularIdDoBeds24,
} from "./reservas-site-botoes";
import { enviarReservasDoSite, ERRO_VINCULO_SEM_MARCA, type OpcoesDoEnvio, resolverOperacoesEmCurso } from "./reservas-site-envio";
import { BOTOES_DA_FICHA_BEDS24, chaveOperacaoBeds24 } from "./reservas-site-regras";
import { gravarEscoposLidos } from "./reservas-site-rotina";
import { marcarDatasFechadasNasOtas, tarefasDasOtas } from "./reservas-site-tarefas";
import { ErroBeds24, type LeitorBeds24 } from "./tipos";

/** O deploy de produção com a chave das reservas e o refresh token (fictício); `PRONTO` ganha a credencial desta organização. */
const VALORES_PRONTO = { VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" };
const CREDENCIAL = impressaoCredencialBeds24(env(VALORES_PRONTO));
const ENSAIO = { credencial: CREDENCIAL, em: "2026-09-01T00:00:00.000Z", operacaoId: "6f1c2a7e-3b4d-4c5e-8f90-123456789abc" };
const op = beds24ReservasOperacoes;
const acomp = beds24ReservasSite;
type Obj = Record<string, unknown>;

let db: Db, close: () => Promise<void>, c: Cenario, falso: Beds24Falso, admin: Sessao, operacao: Sessao, PRONTO: NodeJS.ProcessEnv;
let espiao: ReturnType<typeof vi.spyOn>;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  espiao = vi.spyOn(globalThis, "fetch");
  c = await montarCenario(db);
  admin = { usuarioId: await usuarioDeTeste(c), organizacaoId: c.org, papel: "admin", imovelIds: [] };
  operacao = { ...admin, papel: "operacao" };
  PRONTO = env({ ...VALORES_PRONTO, BEDS24_ORGANIZACAO_ID: c.org });
  falso = new Beds24Falso(() => minutos(10));
  // O imóvel 403 do cenário está ligado ao quarto 20 da propriedade 10 (ids_externos), em BRL, com uma unidade por noite.
  falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Studio" }] }];
  falso.calendarios = calendario();
  await configurar();
  await gravarEscoposLidos(db, c.org, CREDENCIAL, { escopos: [...ESCOPOS_ESPERADOS_FALSO], ilegiveis: [] }, minutos(0));
});
afterEach(() => {
  expect(espiao).not.toHaveBeenCalled();
  espiao.mockRestore();
});

/** Um dia por faixa, de 01/10 a 30/11, com uma unidade livre por noite. */
function calendario() {
  const dias: Obj[] = [];
  for (let d = "2026-10-01"; d <= "2026-11-30"; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) dias.push({ from: d, to: d, numAvail: 1, price1: 450 });
  return [{ roomId: 20, calendar: dias }];
}
const dia = (d: string) => (falso.calendarios[0].calendar as Obj[]).find((x) => x.from === d)!;
const configurar = (o: { ligadoEm?: string; ensaio?: typeof ENSAIO | null } = {}) =>
  gravarConfig(db, c.org, "reservas_beds24", { pausado: null, retomado: null, imoveis: [{ imovelId: c.imovel, ligadoEm: o.ligadoEm ?? "2026-09-01T00:00:00.000Z", ligadoPor: null }], ensaio: o.ensaio === undefined ? ENSAIO : o.ensaio }, null);
const relogio = (agora: Date) => ({ agora: () => agora, restanteMs: () => 240_000 });
const opcoes = (agora: Date): OpcoesDoEnvio => ({ env: PRONTO, relogio: relogio(agora) });
/** A volta da rotina (o passo 1, depois os envios), com o falso: é ela que envia o que os botões enfileiram. */
const resolver = (agora: Date) => resolverOperacoesEmCurso(db, c.org, falso, opcoes(agora));
const rodar = (agora: Date) => enviarReservasDoSite(db, c.org, falso, opcoes(agora));
const operacoes = (reservaId: string) => db.select().from(op).where(eq(op.reservaId, reservaId)).orderBy(asc(op.chave));
const acompanhamento = async (reservaId: string) => (await db.select().from(acomp).where(eq(acomp.reservaId, reservaId)))[0];
/** Regrava o `enviado_em` das operações da reserva com o relógio do teste (o do banco é o de agora). */
const enviadoEm = (reservaId: string, em: Date) => db.update(op).set({ enviadoEm: em }).where(and(eq(op.reservaId, reservaId), inArray(op.situacao, ["incerta", "feita", "recusada"])));
/** Nenhum botão põe uma operação em `enviando` (plano 1.2): a escrita da empresa ficaria travada por 6 min sem fase 2. */
const nenhumaEnviando = async () => expect(await db.select({ id: op.id }).from(op).where(and(eq(op.organizacaoId, c.org), eq(op.situacao, "enviando")))).toEqual([]);

const conferir = (reservaId: string, agora: Date, s: Sessao = admin, e: NodeJS.ProcessEnv = PRONTO, leitor: LeitorBeds24 | null = falso) => conferirAgoraNoBeds24(db, s, reservaId, e, { leitor, relogio: relogio(agora) });
const tentar = (reservaId: string, agora: Date, s: Sessao = admin, e: NodeJS.ProcessEnv = PRONTO) => tentarDeNovoNoBeds24(db, s, reservaId, e, { relogio: relogio(agora) });
const deixar = (reservaId: string, agora: Date, s: Sessao = admin, e: NodeJS.ProcessEnv = PRONTO) => deixarAMaoNoBeds24(db, s, reservaId, e, { relogio: relogio(agora) });
const reenviar = (reservaId: string, agora: Date, s: Sessao = admin, e: NodeJS.ProcessEnv = PRONTO) => reenviarAoBeds24(db, s, reservaId, e, { relogio: relogio(agora) });
const naoExiste = (reservaId: string, agora: Date, s: Sessao = admin, e: NodeJS.ProcessEnv = PRONTO) => naoExisteNoBeds24(db, s, reservaId, e, { relogio: relogio(agora) });
const vincular = (reservaId: string, entrada: { beds24Id: string; semMarca: boolean }, agora: Date, s: Sessao = admin, e: NodeJS.ProcessEnv = PRONTO) => vincularIdDoBeds24(db, s, reservaId, entrada, e, { leitor: falso, relogio: relogio(agora) });
const passar = (reservaId: string, agora: Date, s: Sessao = admin, e: NodeJS.ProcessEnv = PRONTO) => passarAoSistemaBeds24(db, s, reservaId, e, { leitor: falso, relogio: relogio(agora) });
/** Todos os botões, com o mesmo id e o mesmo relógio. */
const todos = (reservaId: string, agora: Date, s: Sessao, e: NodeJS.ProcessEnv) => [
  conferir(reservaId, agora, s, e), tentar(reservaId, agora, s, e), deixar(reservaId, agora, s, e), reenviar(reservaId, agora, s, e), naoExiste(reservaId, agora, s, e),
  vincular(reservaId, { beds24Id: "900001", semMarca: false }, agora, s, e), passar(reservaId, agora, s, e),
];
/** Um registro do Beds24 no quarto 20 com a marca desta reserva no info item e a origem pela API (dados fictícios). */
const comMarca = (codigo: string, o: Obj) => ({ propertyId: 10, roomId: 20, status: "confirmed", arrival: "2026-10-12", departure: "2026-10-15", numAdult: 4, apiSource: "API", infoItems: [{ code: INFO_MARCA_SCL, text: codigo }], ...o });

describe("teste 38: a permissão de cada botão no domínio (deny-by-default, antes de ler)", () => {
  it("a operação não usa os botões de configuração; quem não edita reservas não usa nenhum; nada é lido nem gravado", async () => {
    const x = await pagarEConfirmar(c);
    await expect(naoExiste(x.reservaId, minutos(10), operacao)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(vincular(x.reservaId, { beds24Id: "900001", semMarca: false }, minutos(10), operacao)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(passar(x.reservaId, minutos(10), operacao)).rejects.toBeInstanceOf(AcessoNegado);
    for (const papel of ["proprietario", "limpeza", "hospede"] as const) {
      for (const p of todos(x.reservaId, minutos(10), { ...admin, papel, imovelIds: [c.imovel] }, PRONTO)) await expect(p).rejects.toBeInstanceOf(AcessoNegado);
    }
    // Os de `reserva:editar` passam da permissão para a operação (e recusam aqui pela situação, não pelo papel).
    expect(await conferir(x.reservaId, minutos(10), operacao)).toEqual({ ok: false, erro: ERRO_BOTAO_NADA_A_CONFERIR });
    expect(falso.chamadas).toBe(0);
    expect(await operacoes(x.reservaId)).toEqual([]);
    expect(await acompanhamento(x.reservaId)).toBeUndefined();
  });

  it("as travas comuns: fora do deploy de produção nenhum botão lê nem grava; a credencial de outra organização; sem leitor, nada é lido", async () => {
    const x = await pagarEConfirmar(c);
    expect(await rodar(minutos(10))).toMatchObject({ posts: 1, conferidas: 1 });
    const lidas = falso.chamadas;
    for (const e of [env({ ...VALORES_PRONTO, VERCEL_ENV: "preview", BEDS24_ORGANIZACAO_ID: c.org }), env({ ...VALORES_PRONTO, NODE_ENV: "development", BEDS24_ORGANIZACAO_ID: c.org })]) {
      for (const p of todos(x.reservaId, minutos(20), admin, e)) expect(await p).toEqual({ ok: false, erro: ERRO_BOTAO_FORA_DA_PRODUCAO });
    }
    // A credencial é global e atende uma organização só: sem ela identificada como a desta, nada.
    for (const p of todos(x.reservaId, minutos(20), admin, env({ ...VALORES_PRONTO, BEDS24_ORGANIZACAO_ID: crypto.randomUUID() }))) expect(await p).toEqual({ ok: false, erro: ERRO_BOTAO_OUTRA_ORGANIZACAO });
    expect(await conferir(x.reservaId, minutos(20), admin, PRONTO, null)).toEqual({ ok: false, erro: ERRO_BOTAO_SEM_LEITURA });
    expect(falso.chamadas).toBe(lidas);
    expect(falso.escritasReservas).toHaveLength(1);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida" });
  });

  it("a regra pura: quais botões valem, pela situação (a ficha mostra por ela; cada botão confere por ela de novo)", () => {
    const base: EstadoDosBotoes = { ambiente: true, pronta: true, pausada: false, imovelLigado: true, reserva: { estado: "confirmada", beds24Id: null }, acompanhamento: null, operacoes: [], atrasada: false, agora: minutos(60) };
    const linha = (situacao: NonNullable<EstadoDosBotoes["acompanhamento"]>["situacao"], motivo: NonNullable<EstadoDosBotoes["acompanhamento"]>["motivo"] = null) => ({ situacao, motivo, otaFechadaEm: null, otaFechadaPor: null });
    const operacaoDe = (o: Partial<EstadoDosBotoes["operacoes"][number]>): EstadoDosBotoes["operacoes"][number] => ({ id: "o1", tipo: "criar", situacao: "falhou", enviadoEm: null, beds24Id: null, pedido: null, alteracoes: [], detalhe: {}, vencida: false, ...o });
    expect(botoesDaFichaBeds24(base)).toEqual([]);
    expect(botoesDaFichaBeds24({ ...base, ambiente: false, acompanhamento: linha("conflito", "noites_ocupadas") })).toEqual([]);
    expect(botoesDaFichaBeds24({ ...base, acompanhamento: linha("conflito", "noites_ocupadas"), operacoes: [operacaoDe({ situacao: "conflito" })] })).toEqual(["tentar_de_novo", "deixar_a_mao"]);
    // A criação sem confirmação: só conferir, "Não existe" (5 min depois do POST) e vincular; nunca deixar à mão nem tentar de novo.
    const incerta = { ...base, acompanhamento: linha("aguardando_equipe", "incerta"), operacoes: [operacaoDe({ situacao: "incerta", enviadoEm: minutos(50) })] };
    expect(botoesDaFichaBeds24(incerta)).toEqual(["conferir_agora", "nao_existe", "vincular"]);
    expect(motivoSemBotao("nao_existe", { ...incerta, agora: minutos(53) })).toBe(erroAguardeOBeds24(minutos(55)));
    expect(motivoSemBotao("deixar_a_mao", incerta)).toBe(ERRO_BOTAO_EM_ENVIO);
    // O sistema enviando agora: nenhum botão que mexe (nem conferir: a fase 3 dele vem).
    expect(botoesDaFichaBeds24({ ...incerta, operacoes: [operacaoDe({ situacao: "enviando", enviadoEm: minutos(59) })] })).toEqual([]);
    // Os que reabrem o envio pedem a escrita pronta e sem a pausa.
    expect(botoesDaFichaBeds24({ ...incerta, pronta: false })).toEqual(["conferir_agora", "vincular"]);
    expect(botoesDaFichaBeds24({ ...base, pausada: true, acompanhamento: linha("divergente", "mudada_no_beds24"), reserva: { estado: "confirmada", beds24Id: "900001" } })).toEqual(["conferir_agora", "deixar_a_mao"]);
    expect(botoesDaFichaBeds24({ ...base, acompanhamento: linha("divergente", "mudada_no_beds24"), reserva: { estado: "confirmada", beds24Id: "900001" } })).toEqual(["conferir_agora", "deixar_a_mao", "reenviar"]);
    expect(motivoSemBotao("reenviar", { ...base, acompanhamento: linha("divergente", "cancelada_no_beds24"), reserva: { estado: "confirmada", beds24Id: "900001" } })).toBe(ERRO_BOTAO_REATIVACAO);
    expect(motivoSemBotao("reenviar", { ...base, acompanhamento: linha("divergente", "apagada_no_beds24"), reserva: { estado: "confirmada", beds24Id: "900001" } })).toBe(ERRO_BOTAO_APAGADA);
    // A confirmada antes de ligar: só passar ao sistema (com o imóvel ligado e sem a marca manual).
    expect(botoesDaFichaBeds24({ ...base, acompanhamento: linha("manual", "anterior_a_ligar") })).toEqual(["passar_ao_sistema"]);
    expect(motivoSemBotao("passar_ao_sistema", { ...base, acompanhamento: { ...linha("manual", "anterior_a_ligar"), otaFechadaEm: minutos(1), otaFechadaPor: admin.usuarioId } })).toBe(ERRO_BOTAO_MARCADA_A_MAO);
    // O envio atrasado (sem acompanhamento ou pendente): deixar à mão; no prazo, nada.
    expect(botoesDaFichaBeds24({ ...base, atrasada: true })).toEqual(["deixar_a_mao"]);
    expect(botoesDaFichaBeds24({ ...base, acompanhamento: linha("pendente") })).toEqual([]);
    expect(BOTOES_DA_FICHA_BEDS24).toHaveLength(7);
  });
});

describe("teste 40: Não existe, pode criar", () => {
  it("recusado antes de 5 min do POST; depois, a incerta vira falhou (encerrada pela equipe), nasce a criação seguinte na fila, as buscas zeram, e a volta envia", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    expect(await rodar(minutos(10))).toMatchObject({ posts: 1, incertas: 1 });
    falso.perderRespostaReserva = false;
    await enviadoEm(x.reservaId, minutos(10));
    await db.update(acomp).set({ buscasSemConclusao: 2 }).where(eq(acomp.reservaId, x.reservaId));
    expect(await naoExiste(x.reservaId, minutos(13))).toEqual({ ok: false, erro: erroAguardeOBeds24(minutos(15)) });
    expect((await operacoes(x.reservaId)).map((o) => o.situacao)).toEqual(["incerta"]);
    // O registro que o POST perdido deixou sai do Beds24 (a equipe confere lá e confirma que não ficou nada): as noites voltam livres.
    falso.bookings = [];
    falso.calendarios = calendario();
    expect(await naoExiste(x.reservaId, minutos(16))).toEqual({ ok: true, resultado: "na_fila" });
    await nenhumaEnviando();
    const [v1, v2] = await operacoes(x.reservaId);
    expect(v1).toMatchObject({ chave: chaveOperacaoBeds24("criar", x.reservaId, 1), situacao: "falhou", resposta: "tempo", detalhe: { encerradaPelaEquipe: true, porBotao: "nao_existe" } });
    expect(v1.enviadoEm).toEqual(minutos(10));
    expect(v2).toMatchObject({ chave: chaveOperacaoBeds24("criar", x.reservaId, 2), situacao: "pendente", enviadoEm: null, beds24Id: null, detalhe: { porBotao: "nao_existe" }, pedido: v1.pedido });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", motivo: null, versao: 2, buscasSemConclusao: 0, proximaTentativaEm: minutos(16) });
    expect(falso.escritasReservas).toHaveLength(1);
    // A volta envia a criação seguinte; a encerrada pela equipe não conta como a nova tentativa automática.
    expect(await rodar(minutos(17))).toMatchObject({ posts: 1, conferidas: 1 });
    // O falso numera pelo maior id que tem (o perdido saiu): o novo registro reusa o número, e só ele está no Beds24.
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect(falso.bookings).toHaveLength(1);
    const [registro] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.nao_existe")));
    expect(registro).toMatchObject({ usuarioId: admin.usuarioId, entidade: "reserva", entidadeId: x.reservaId, mudancas: { operacao: ["incerta", "falhou"] } });
    // Sem a criação incerta, nada.
    expect(await naoExiste(x.reservaId, minutos(30))).toMatchObject({ ok: false });
    expect(await semDadosDoHospede(db)).toEqual([]);
  });
});

describe("teste 40: Tentar de novo", () => {
  it("depois das 5 falhas: a MESMA linha volta à fila (sem POST, o SCL igual), as buscas ficam, e a volta seguinte envia; nunca criar com o id no Beds24", async () => {
    const x = await pagarEConfirmar(c);
    falso.falharToken = new ErroBeds24("Falha de rede ao pedir o token (fictícia).", "rede");
    // As falhas antes do POST, com os atrasos de 10, 20, 40 e 80 min; na 5ª, a equipe.
    for (const t of [10, 21, 42, 83, 164]) await rodar(minutos(t));
    const [falhou] = await operacoes(x.reservaId);
    expect(falhou).toMatchObject({ situacao: "falhou", enviadoEm: null });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "falhas", tentativas: 5 });
    await db.update(acomp).set({ buscasSemConclusao: 2 }).where(eq(acomp.reservaId, x.reservaId));
    // Com o id no Beds24 ligado à reserva, nunca abre `criar` (só a busca pela marca evitaria a duplicata).
    await db.update(reservas).set({ beds24Id: "900777" }).where(eq(reservas.id, x.reservaId));
    expect(await tentar(x.reservaId, minutos(170))).toEqual({ ok: false, erro: ERRO_BOTAO_CRIAR_COM_ID });
    await db.update(reservas).set({ beds24Id: null }).where(eq(reservas.id, x.reservaId));

    expect(await tentar(x.reservaId, minutos(170), operacao)).toEqual({ ok: true, resultado: "na_fila" });
    await nenhumaEnviando();
    const linhas = await operacoes(x.reservaId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ id: falhou.id, situacao: "pendente", enviadoEm: null, terminadoEm: null, detalhe: { porBotao: "tentar_de_novo" } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", motivo: null, proximaTentativaEm: minutos(170), buscasSemConclusao: 2, tentativas: 5 });
    falso.falharToken = null;
    expect(await rodar(minutos(171))).toMatchObject({ posts: 1, conferidas: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", tentativas: 0 });
    // Já conferida: nada a tentar.
    expect(await tentar(x.reservaId, minutos(180))).toMatchObject({ ok: false });
  });

  it("depois do conflito: com o SCL igual, a mesma linha; com o SCL mudado (a equipe mudou as datas), a versão nova com o esperado de agora", async () => {
    const x = await pagarEConfirmar(c);
    // Uma reserva de canal nas mesmas noites (fictícia): possível venda dupla, nada é criado.
    falso.bookings.push({ id: 700001, propertyId: 10, roomId: 20, status: "confirmed", arrival: "2026-10-12", departure: "2026-10-15", numAdult: 2, channel: "airbnb" });
    for (const d of ["2026-10-12", "2026-10-13", "2026-10-14"]) dia(d).numAvail = 0;
    expect(await rodar(minutos(10))).toMatchObject({ posts: 0, avisos: 1 });
    const [v1] = await operacoes(x.reservaId);
    expect(v1.situacao).toBe("conflito");
    expect(await tentar(x.reservaId, minutos(11))).toEqual({ ok: true, resultado: "na_fila" });
    expect((await operacoes(x.reservaId)).map((o) => [o.id, o.situacao])).toEqual([[v1.id, "pendente"]]);
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", motivo: null });
    // A volta confere de novo e acha a mesma reserva de canal: conflito outra vez, sem POST.
    expect(await rodar(minutos(12))).toMatchObject({ posts: 0 });
    expect((await operacoes(x.reservaId)).map((o) => o.situacao)).toEqual(["conflito"]);
    // A equipe muda as datas da reserva no SCL para noites livres: a versão nova, com o esperado de agora; a v1 fica como estava.
    await db.update(reservas).set({ checkin: "2026-10-20", checkout: "2026-10-23" }).where(eq(reservas.id, x.reservaId));
    expect(await tentar(x.reservaId, minutos(13))).toEqual({ ok: true, resultado: "na_fila" });
    await nenhumaEnviando();
    const [velha, nova] = await operacoes(x.reservaId);
    expect(velha).toMatchObject({ id: v1.id, situacao: "conflito" });
    expect(nova).toMatchObject({ chave: chaveOperacaoBeds24("criar", x.reservaId, 2), situacao: "pendente", detalhe: { porBotao: "tentar_de_novo" } });
    expect(nova.pedido).toMatchObject({ chegada: "2026-10-20", saida: "2026-10-23" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", motivo: null, versao: 2, esperado: { chegada: "2026-10-20", saida: "2026-10-23" } });
    expect(await rodar(minutos(14))).toMatchObject({ posts: 1, conferidas: 1 });
    expect(falso.escritasReservas[0].corpo[0]).toMatchObject({ arrival: "2026-10-20", departure: "2026-10-23" });
  });

  it("depois de uma recusa do Beds24 (com POST): antes de 5 min do POST, recusa; depois, a versão nova (a recusada fica como estava)", async () => {
    const x = await pagarEConfirmar(c);
    falso.recusarDisponibilidade = true;
    expect(await rodar(minutos(10))).toMatchObject({ posts: 1, incertas: 1 });
    await enviadoEm(x.reservaId, minutos(10));
    expect(await resolver(minutos(16))).toMatchObject({ avisos: 1 });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_disponibilidade" });
    expect(await tentar(x.reservaId, minutos(14))).toEqual({ ok: false, erro: erroAguardeOBeds24(minutos(15)) });
    expect(await tentar(x.reservaId, minutos(17))).toEqual({ ok: true, resultado: "na_fila" });
    const [recusada, nova] = await operacoes(x.reservaId);
    expect(recusada).toMatchObject({ situacao: "recusada", resposta: "recusada_disponibilidade" });
    expect(recusada.enviadoEm).toEqual(minutos(10));
    expect(nova).toMatchObject({ chave: chaveOperacaoBeds24("criar", x.reservaId, 2), situacao: "pendente", enviadoEm: null, pedido: recusada.pedido });
    // Uma intenção na fila: o segundo clique não abre outra.
    expect(await tentar(x.reservaId, minutos(18))).toMatchObject({ ok: false });
    falso.recusarDisponibilidade = false;
    expect(await rodar(minutos(19))).toMatchObject({ posts: 1, conferidas: 1 });
  });
});

describe("Deixar à mão", () => {
  it("no conflito: a equipe cuida à mão, e a tarefa de fechar as datas (com a marca) volta; recusa com a criação sem confirmação", async () => {
    const x = await pagarEConfirmar(c);
    falso.bookings.push({ id: 700001, propertyId: 10, roomId: 20, status: "confirmed", arrival: "2026-10-12", departure: "2026-10-15", numAdult: 2, channel: "airbnb" });
    for (const d of ["2026-10-12", "2026-10-13", "2026-10-14"]) dia(d).numAvail = 0;
    await rodar(minutos(10));
    expect(await deixar(x.reservaId, minutos(11), operacao)).toEqual({ ok: true, resultado: "a_mao" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "manual", motivo: "deixada_a_mao" });
    expect((await tarefasDasOtas(db, c.org, minutos(12), PRONTO, { reservaIds: [x.reservaId] })).tarefas).toMatchObject([{ caso: "paga", estado: "manual", marca: "datas_fechadas" }]);
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0 });
    expect(await deixar(x.reservaId, minutos(21))).toMatchObject({ ok: false });
    const [registro] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.deixar_a_mao")));
    expect(registro).toMatchObject({ usuarioId: admin.usuarioId, entidadeId: x.reservaId, mudancas: { situacaoNoBeds24: ["conflito", "manual"], motivoNoBeds24: ["noites_ocupadas", "deixada_a_mao"] } });

    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    falso.perderRespostaReserva = true;
    await rodar(minutos(30));
    expect(await deixar(y.reservaId, minutos(31))).toEqual({ ok: false, erro: ERRO_BOTAO_EM_ENVIO });
    expect(await acompanhamento(y.reservaId)).not.toMatchObject({ situacao: "manual" });
  });

  it("o envio atrasado com a operação na fila sem POST: a operação vira superada e nunca sai", async () => {
    const x = await pagarEConfirmar(c);
    falso.falharToken = new ErroBeds24("Falha de rede ao pedir o token (fictícia).", "rede");
    await rodar(minutos(10));
    expect((await operacoes(x.reservaId)).map((o) => [o.situacao, o.enviadoEm])).toEqual([["pendente", null]]);
    // Antes dos 30 min do fato, o sistema ainda está no prazo: nada a deixar.
    expect(await deixar(x.reservaId, minutos(15))).toMatchObject({ ok: false });
    expect(await deixar(x.reservaId, minutos(45))).toEqual({ ok: true, resultado: "a_mao" });
    expect(await operacoes(x.reservaId)).toMatchObject([{ situacao: "superada", detalhe: { porBotao: "deixar_a_mao" } }]);
    falso.falharToken = null;
    expect(await rodar(minutos(60))).toMatchObject({ posts: 0 });
    expect(falso.escritasReservas).toEqual([]);
  });
});

describe("teste 21 pelo botão: Reenviar o que está no SCL", () => {
  it("depois da mudança no Beds24 por fora, para um estado já enviado: a versão nova da atualização, a linha da criação intacta; a volta reenvia", async () => {
    const x = await pagarEConfirmar(c);
    expect(await rodar(minutos(10))).toMatchObject({ posts: 1, conferidas: 1 });
    // Alguém muda a saída no Beds24: "Conferir agora" lê a divergência.
    falso.bookings[0].departure = "2026-10-16";
    expect(await conferir(x.reservaId, minutos(20))).toEqual({ ok: true, resultado: "diferente" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "mudada_no_beds24" });
    expect(await reenviar(x.reservaId, minutos(21), operacao)).toEqual({ ok: true, resultado: "na_fila" });
    await nenhumaEnviando();
    const [criar, atualizar] = await operacoes(x.reservaId).then((l) => [l.find((o) => o.tipo === "criar")!, l.find((o) => o.tipo === "atualizar")!]);
    expect(criar).toMatchObject({ situacao: "conferida", beds24Id: "900001" });
    expect(atualizar).toMatchObject({ chave: chaveOperacaoBeds24("atualizar", x.reservaId, 2), situacao: "pendente", enviadoEm: null, beds24Id: "900001", detalhe: { porBotao: "reenviar" } });
    expect(atualizar.pedido).toMatchObject({ chegada: "2026-10-12", saida: "2026-10-15" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "pendente", motivo: null, versao: 2 });
    expect(await rodar(minutos(22))).toMatchObject({ posts: 1, atualizadas: 1, conferidas: 1 });
    expect(falso.bookings[0]).toMatchObject({ departure: "2026-10-15" });
    // Cancelada no Beds24 (reativação, fica para depois) e apagada (não pode ser atualizada): recusa.
    await db.update(acomp).set({ situacao: "divergente", motivo: "cancelada_no_beds24" }).where(eq(acomp.reservaId, x.reservaId));
    expect(await reenviar(x.reservaId, minutos(30))).toEqual({ ok: false, erro: ERRO_BOTAO_REATIVACAO });
    await db.update(acomp).set({ motivo: "apagada_no_beds24" }).where(eq(acomp.reservaId, x.reservaId));
    expect(await reenviar(x.reservaId, minutos(30))).toEqual({ ok: false, erro: ERRO_BOTAO_APAGADA });
    expect(falso.escritasReservas).toHaveLength(2);
  });
});

describe("Passar ao sistema (desenho 6.6)", () => {
  it("recusa com a marca manual das datas fechadas e com o bloqueio feito à mão sobre as noites; sem eles, a criação na fila, e a volta cria", async () => {
    // O imóvel foi ligado depois das confirmações: as duas nascem `manual`/`anterior_a_ligar`.
    await configurar({ ligadoEm: "2026-10-05T00:00:00.000Z" });
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    expect(await rodar(minutos(10))).toMatchObject({ posts: 0 });
    for (const r of [x, y]) expect(await acompanhamento(r.reservaId)).toMatchObject({ situacao: "manual", motivo: "anterior_a_ligar", roomId: null });
    // A equipe fechou à mão (6.4): a linha guarda o motivo, e o sistema nunca cria por cima.
    expect(await marcarDatasFechadasNasOtas(db, admin, x.reservaId, PRONTO, minutos(15))).toEqual({ ok: true });
    expect(await passar(x.reservaId, minutos(16))).toEqual({ ok: false, erro: ERRO_BOTAO_MARCADA_A_MAO });
    // Um bloqueio feito à mão (black) sobre as noites de y: recusa com as noites achadas.
    falso.bookings.push({ id: 700010, propertyId: 10, roomId: 20, status: "black", arrival: "2026-10-20", departure: "2026-10-23", numAdult: 1 });
    const comBloqueio = await passar(y.reservaId, minutos(17));
    expect(comBloqueio).toMatchObject({ ok: false });
    expect(!comBloqueio.ok && comBloqueio.erro).toContain("Há um bloqueio feito à mão de 20/10 a 23/10 sobre as noites no Beds24");
    expect(await acompanhamento(y.reservaId)).toMatchObject({ situacao: "manual", motivo: "anterior_a_ligar" });
    falso.bookings = [];
    expect(await passar(y.reservaId, minutos(18))).toEqual({ ok: true, resultado: "na_fila" });
    await nenhumaEnviando();
    expect(await acompanhamento(y.reservaId)).toMatchObject({ situacao: "pendente", motivo: null });
    expect(await operacoes(y.reservaId)).toMatchObject([{ tipo: "criar", situacao: "pendente", enviadoEm: null, detalhe: { porBotao: "passar_ao_sistema" } }]);
    expect(falso.escritasReservas).toEqual([]);
    expect(await rodar(minutos(19))).toMatchObject({ posts: 1, conferidas: 1 });
    expect(await acompanhamento(y.reservaId)).toMatchObject({ situacao: "conferida" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "manual" });
  });
});

describe("teste 40: Vincular o id", () => {
  it("a criação sem confirmação: sem a marca, recusa com o ensaio válido; o id inválido ou que não volta, recusa; com a marca, vincula e confere sem POST", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await rodar(minutos(10));
    falso.perderRespostaReserva = false;
    await enviadoEm(x.reservaId, minutos(10));
    expect(await vincular(x.reservaId, { beds24Id: "900001", semMarca: true }, minutos(12))).toEqual({ ok: false, erro: ERRO_BOTAO_SEM_MARCA_COM_ENSAIO });
    expect(await vincular(x.reservaId, { beds24Id: "900 001", semMarca: false }, minutos(12))).toEqual({ ok: false, erro: ERRO_BOTAO_ID_INVALIDO });
    expect(await vincular(x.reservaId, { beds24Id: "999999", semMarca: false }, minutos(12))).toEqual({ ok: false, erro: ERRO_BOTAO_ID_NAO_VOLTOU });
    expect(await vincular(x.reservaId, { beds24Id: "900001", semMarca: false }, minutos(12))).toEqual({ ok: true, resultado: "vinculado" });
    await nenhumaEnviando();
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    const linhas = await operacoes(x.reservaId);
    expect(linhas.map((o) => [o.tipo, o.situacao, o.beds24Id])).toEqual([["criar", "conferida", "900001"], ["vincular", "conferida", "900001"]]);
    expect(linhas[1]).toMatchObject({ chave: chaveOperacaoBeds24("vincular", x.reservaId, 2), autorId: admin.usuarioId, detalhe: { porBotao: "vincular" }, erro: "" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null, versao: 2, buscasSemConclusao: 0, otaFechadaEm: minutos(12), otaFechadaPor: null });
    const [adocao] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.adotar")));
    expect(adocao).toMatchObject({ usuarioId: admin.usuarioId, entidadeId: x.reservaId });
    // A volta não tem mais nada a resolver nem a criar: o mesmo POST de antes.
    expect(await resolver(minutos(20))).toMatchObject({ resolvidas: 0 });
    expect(await rodar(minutos(20))).toMatchObject({ posts: 0 });
    expect(falso.escritasReservas).toHaveLength(1);
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("na duplicada: recusa com a lista a cancelar no Beds24; com os outros cancelados lá, aceita um dos ids", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await rodar(minutos(10));
    falso.perderRespostaReserva = false;
    // Um segundo registro nosso com a marca desta reserva (o reenvio de um canal, fictício).
    falso.bookings.push({ id: 900002, ...comMarca(x.reservaCodigo, {}) });
    await enviadoEm(x.reservaId, minutos(10));
    await resolver(minutos(16));
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "duplicada" });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "divergente", detalhe: { duplicadas: ["900001", "900002"] } });
    expect(await vincular(x.reservaId, { beds24Id: "900001", semMarca: false }, minutos(20))).toEqual({ ok: false, erro: "Há outros registros com a marca desta reserva ainda vivos no Beds24: cancele no Beds24 (não apague): 900002." });
    falso.bookings.find((b) => b.id === 900002)!.status = "cancelled";
    expect(await vincular(x.reservaId, { beds24Id: "900001", semMarca: false }, minutos(21))).toEqual({ ok: true, resultado: "vinculado" });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null });
    // A criação que tinha terminado (divergente) fica como estava: a conclusão é da operação `vincular`.
    expect((await operacoes(x.reservaId)).map((o) => [o.tipo, o.situacao])).toEqual([["criar", "divergente"], ["vincular", "conferida"]]);
  });

  it("sem a marca, só quando a credencial não lê a marca e com a segunda confirmação: divergente/marca_ilegivel, sem as marcas das OTAs", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await rodar(minutos(10));
    falso.perderRespostaReserva = false;
    // A credencial trocada não lê os info items (sem ensaio válido para ela).
    await configurar({ ensaio: null });
    falso.semMarcaNaLeitura = true;
    const semConfirmar = await vincular(x.reservaId, { beds24Id: "900001", semMarca: false }, minutos(12));
    expect(!semConfirmar.ok && semConfirmar.erro).toContain('não voltou com a marca desta reserva: nada foi vinculado. Se a credencial não lê a marca, marque "sem a marca"');
    expect(await vincular(x.reservaId, { beds24Id: "900001", semMarca: true }, minutos(13))).toEqual({ ok: true, resultado: "vinculado_sem_marca" });
    const linhas = await operacoes(x.reservaId);
    expect(linhas.map((o) => [o.tipo, o.situacao])).toEqual([["criar", "divergente"], ["vincular", "divergente"]]);
    expect(linhas[1]).toMatchObject({ erro: ERRO_VINCULO_SEM_MARCA, detalhe: { porBotao: "vincular", marcaNaoLida: true } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "divergente", motivo: "marca_ilegivel", otaFechadaEm: null });
  });
});

describe("Conferir agora (só lê)", () => {
  it("a incerta (os 5 min e a adoção), a divergência que volta a bater, o overbooking que sai, a credencial trocada e o que não há a conferir", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await rodar(minutos(10));
    falso.perderRespostaReserva = false;
    await enviadoEm(x.reservaId, minutos(10));
    expect(await conferir(x.reservaId, minutos(12), operacao)).toEqual({ ok: true, resultado: "aguarde" });
    expect(await conferir(x.reservaId, minutos(16), operacao)).toEqual({ ok: true, resultado: "conferido" });
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida" });
    // Mudada no Beds24, e de volta como o SCL: a divergência volta a `conferida` (a regra da conferência contínua).
    falso.bookings[0].departure = "2026-10-16";
    expect(await conferir(x.reservaId, minutos(20))).toEqual({ ok: true, resultado: "diferente" });
    falso.bookings[0].departure = "2026-10-15";
    expect(await conferir(x.reservaId, minutos(21))).toEqual({ ok: true, resultado: "conferido" });
    // As datas mudadas reabriram a marca das OTAs; de volta, o sistema marca de novo (às 15:21).
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null, otaFechadaEm: minutos(21) });
    // O overbooking informado depois da escrita: continua enquanto o calendário mostra −1; sai com `livres >= 0`.
    await db.update(acomp).set({ motivo: "noites_ocupadas" }).where(eq(acomp.reservaId, x.reservaId));
    dia("2026-10-13").numAvail = -1;
    expect(await conferir(x.reservaId, minutos(22))).toEqual({ ok: true, resultado: "overbooking" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: "noites_ocupadas" });
    dia("2026-10-13").numAvail = 0;
    expect(await conferir(x.reservaId, minutos(23))).toEqual({ ok: true, resultado: "conferido" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null });
    // A credencial trocada (outra conta): o id que não volta nunca conclui "apagada"; a equipe confere. Voltando, `conferida`.
    await db.update(acomp).set({ credencial: "refresh:outra-conta-ficticia" }).where(eq(acomp.reservaId, x.reservaId));
    const guardado = falso.bookings.splice(0, 1)[0];
    expect(await conferir(x.reservaId, minutos(24))).toEqual({ ok: true, resultado: "equipe" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_permissao", otaFechadaEm: minutos(21) });
    falso.bookings.push(guardado);
    expect(await conferir(x.reservaId, minutos(25))).toEqual({ ok: true, resultado: "conferido" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida", motivo: null, otaFechadaEm: minutos(21) });
    // Nunca POST: só o da criação.
    expect(falso.escritasReservas).toHaveLength(1);
    await nenhumaEnviando();
    const outra = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05", email: "outra@example.com" });
    await db.update(reservas).set({ estado: "cancelada" }).where(eq(reservas.id, outra.reservaId));
    expect(await conferir(outra.reservaId, minutos(30))).toEqual({ ok: false, erro: ERRO_BOTAO_NADA_A_CONFERIR });
  });
});
