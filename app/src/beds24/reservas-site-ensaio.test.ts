/**
 * Reserva paga do site no Beds24 (M8.3c) — o ensaio em Integrações (desenho 8, D6, D7 e 5.2; plano, teste 37 e os extras do
 * bloco F): "Criar o ensaio" cria com `SCL-ENSAIO` e o id da operação, relê e procura (`feita`); "Cancelar o ensaio" cancela e
 * relê (`conferida`, o ensaio registrado e "Ligar" liberado); "Conferir o ensaio" resolve o que parou no meio. Um ensaio por
 * vez, só com tudo pronto, a importação pula o registro dele e as noites do ensaio não resolvido, e a rotina nunca o resolve.
 * PGlite, o Beds24 falso e um espião de `fetch` que nunca é chamado: nada vai ao Beds24. O `env` é sempre explícito (o deploy
 * de produção fictício), e o cliente é o falso injetado: nenhuma fábrica do ambiente é chamada.
 */
import { and, asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { gravarConfig } from "@/configuracoes/armazem";
import { auditoria, beds24ReservasOperacoes, beds24ReservasRotina, bloqueios, idsExternos, imoveis, lancamentos, organizacoes, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { semDadosPessoais } from "@/pagamentos/testes";
import { Beds24Falso, MENSAGEM_SEM_DISPONIBILIDADE_FALSO } from "./falso";
import { impressaoCredencialBeds24 } from "./http";
import { INFO_ENSAIO_SCL } from "./normalizar";
import { ERRO_LIGAR_SEM_ENSAIO, ligarImovelReservasBeds24, lerConfigReservasBeds24 } from "./reservas-site-config";
import {
  cancelarEnsaioReservasBeds24, conferirEnsaioReservasBeds24, criarEnsaioReservasBeds24, ensaioNoPainel, ERRO_ENSAIO_AGUARDE, faseDoEnsaioBeds24, ERRO_ENSAIO_CREDENCIAL_TROCADA, ERRO_ENSAIO_DATAS,
  ERRO_ENSAIO_EM_ANDAMENTO, ERRO_ENSAIO_ESCOPO_EXCESSIVO, ERRO_ENSAIO_ESCOPOS, ERRO_ENSAIO_FORA_DA_PRODUCAO, ERRO_ENSAIO_IMOVEL, ERRO_ENSAIO_LEITURA_SEM_CONCLUSAO, ERRO_ENSAIO_MARCA_NAO_VOLTOU,
  ERRO_ENSAIO_NADA_CRIADO, ERRO_ENSAIO_NAO_RESOLVIDO, ERRO_ENSAIO_NOITES, ERRO_ENSAIO_OCUPADO_NO_SCL, ERRO_ENSAIO_OUTRA_ORGANIZACAO, ERRO_ENSAIO_PARADO_ANTES_DO_ENVIO, ERRO_ENSAIO_PAUSA_ANTES_DO_POST,
  ERRO_ENSAIO_PAUSADO, ERRO_ENSAIO_QUARTO, ERRO_ENSAIO_SEM_CONFERENCIA, ERRO_ENSAIO_SEM_LEITURA, type OpcoesDoEnsaio,
} from "./reservas-site-ensaio";
import { haOperacaoEmCursoASair, resolverOperacoesEmCurso } from "./reservas-site-envio";
import { chaveEnsaioBeds24, ensaioNaoResolvidoBeds24, SITUACOES_ENSAIO_FECHADO, type SituacaoOperacaoBeds24 } from "./reservas-site-regras";
import { ultimaRecusaDeReservas } from "./reservas-site-rotina";
import { sincronizarBeds24 } from "./sincronizacao";
import { ErroBeds24, TEXTOS_DE_ERRO_BEDS24 } from "./tipos";

type Obj = Record<string, unknown>;
const env = (v: Record<string, string | undefined>) => v as unknown as NodeJS.ProcessEnv;
/** Um instante fixo, antes das datas do ensaio (o relógio do app; o do banco é o de verdade). */
const AGORA = new Date("2026-10-16T15:00:00Z");
const minutosAntesDe = (n: number, de: Date = AGORA) => new Date(de.getTime() - n * 60_000);
const ENTRADA = { chegada: "2026-11-03", saida: "2026-11-04" };
const op = beds24ReservasOperacoes;

let db: Db, close: () => Promise<void>, org: string, im: string, admin: Sessao, falso: Beds24Falso, PRONTO: NodeJS.ProcessEnv;
let espiao: ReturnType<typeof vi.spyOn>;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  espiao = vi.spyOn(globalThis, "fetch");
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "103", nome: "Studio Exemplo" }).returning();
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
  const [{ id: usuarioId }] = await db.insert(usuarios).values({ organizacaoId: org, email: `admin.${crypto.randomUUID().slice(0, 8)}@example.com`, nome: "Admin Fictício", papel: "admin" }).returning();
  admin = { usuarioId, organizacaoId: org, papel: "admin", imovelIds: [] };
  // O deploy de produção com a chave das reservas e o refresh token (fictício), e a credencial desta organização.
  PRONTO = env({ VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio", BEDS24_ORGANIZACAO_ID: org });
  falso = new Beds24Falso(() => AGORA);
  falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Studio" }] }];
  falso.calendarios = calendario();
  await db.transaction((tx) => gravarConfig(tx, org, "beds24", { automatica: false, desde: "2026-09-01", diasCalendario: 2 }, null));
});
afterEach(() => {
  expect(espiao).not.toHaveBeenCalled();
  espiao.mockRestore();
});

/** Um dia por faixa, com uma unidade por noite, de 16/10 a 31/12. */
function calendario() {
  const dias: Obj[] = [];
  for (let d = "2026-10-16"; d <= "2026-12-31"; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) dias.push({ from: d, to: d, numAvail: 1, price1: 450 });
  return [{ roomId: 20, calendar: dias }];
}
const relogio = { agora: () => AGORA, restanteMs: () => 240_000 };
const criar = (o: Partial<OpcoesDoEnsaio> = {}, e: Partial<typeof ENTRADA> & { imovelId?: string } = {}, s: Sessao = admin, ambiente: NodeJS.ProcessEnv = PRONTO) =>
  criarEnsaioReservasBeds24(db, s, { imovelId: im, ...ENTRADA, ...e }, ambiente, { cliente: falso, relogio, ...o });
const cancelar = (id: string, o: Partial<OpcoesDoEnsaio> = {}, ambiente: NodeJS.ProcessEnv = PRONTO) => cancelarEnsaioReservasBeds24(db, admin, id, ambiente, { cliente: falso, relogio, ...o });
const conferir = (id: string, ambiente: NodeJS.ProcessEnv = PRONTO, agora: Date = AGORA) => conferirEnsaioReservasBeds24(db, admin, id, ambiente, { leitor: falso, relogio: { ...relogio, agora: () => agora } });
const ensaios = () => db.select().from(op).where(and(eq(op.organizacaoId, org), eq(op.tipo, "ensaio"))).orderBy(asc(op.iniciadoEm));
const umEnsaio = async () => {
  const [e] = await ensaios();
  return e;
};
/** O `enviado_em` de agora fica para trás (o relógio do app é fixo; o banco grava o de verdade). */
const envelhecerEnvio = (id: string, minutos = 6) => db.update(op).set({ enviadoEm: minutosAntesDe(minutos) }).where(eq(op.id, id));
/** O `iniciado_em` fica 7 min para trás pelo relógio de verdade (o banco confere a janela de 6 min com o `now()` dele). */
const vencer = (id: string) => db.update(op).set({ iniciadoEm: new Date(Date.now() - 7 * 60_000) }).where(eq(op.id, id));
const reservasDaOrg = () => db.select().from(reservas).where(eq(reservas.organizacaoId, org));
const importar = () => sincronizarBeds24(db, org, falso, { agora: AGORA });
/** O corpo exato da criação do ensaio (desenho 3.7 e 8): uma pessoa, a marca do ensaio, nada do hóspede nem valor. */
const corpoDoEnsaio = (operacaoId: string) => [
  { roomId: 20, arrival: "2026-11-03", departure: "2026-11-04", status: "confirmed", numAdult: 1, numChild: 0, infoItems: [{ code: INFO_ENSAIO_SCL, text: operacaoId }], actions: { checkAvailability: true, notifyGuest: false, notifyHost: false } },
];

describe("teste 37: criar, conferir nas OTAs e cancelar, em dois botões", () => {
  it("Criar o ensaio: cria com SCL-ENSAIO e o id da operação, relê, procura e fica feita, com o observado; nada nasce no SCL", async () => {
    const r = await criar();
    const e = await umEnsaio();
    expect(r).toEqual({ ok: true, desfecho: "criado", operacaoId: e.id });
    expect(falso.escritasReservas).toEqual([{ metodo: "POST", corpo: corpoDoEnsaio(e.id) }]);
    expect(e).toMatchObject({
      tipo: "ensaio", modo: "real", chave: chaveEnsaioBeds24(e.id), situacao: "feita", reservaId: null, acompanhamentoId: null, beds24Id: "900001", resposta: "criada", erro: "",
      credencial: impressaoCredencialBeds24(PRONTO), autorId: admin.usuarioId, tentativas: 1, terminadoEm: null,
      pedido: { quarto: "20", chegada: "2026-11-03", saida: "2026-11-04", hospedes: 1, situacao: "confirmada", referencia: "SCL-ENSAIO" },
      depois: { quarto: "20", chegada: "2026-11-03", saida: "2026-11-04", hospedes: 1, situacao: "confirmada" },
      // Só nomes de chave e de cabeçalho, o canal normalizado e a origem limpa (desenho 12, itens 1, 9, 11 e 15).
      detalhe: { porBotao: "criar_ensaio", observado: { chaveDoId: "id", chavesEmNew: ["id"], cabecalhosDeCredito: [], canal: "outro", origemApi: "API", horaDaReservaLegivel: true } },
    });
    expect(e.enviadoEm).toBeInstanceOf(Date);
    // A releitura pelo id e a busca pelo quarto com a chegada exata, as duas com os info items.
    expect(falso.filtrosLidos).toEqual(expect.arrayContaining([{ ids: ["900001"], chegadaDe: "1900-01-01", incluirInfo: true }, { quarto: "20", chegadaExata: "2026-11-03", incluirInfo: true }]));
    // Os escopos lidos na hora ficam guardados, como pelo botão da prontidão.
    const [rotina] = await db.select().from(beds24ReservasRotina).where(eq(beds24ReservasRotina.organizacaoId, org));
    expect(rotina).toMatchObject({ escopos: { situacao: "em_ordem" }, escoposCredencial: impressaoCredencialBeds24(PRONTO), escoposLidosEm: AGORA });
    const [a] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, "beds24.ensaio.criar")));
    expect(a).toMatchObject({ usuarioId: admin.usuarioId, entidade: "integracao", entidadeId: e.id, mudancas: { situacao: ["enviando", "feita"], beds24Id: [null, "900001"] } });
    expect(await reservasDaOrg()).toEqual([]);
    expect(await db.select().from(lancamentos).where(eq(lancamentos.organizacaoId, org))).toEqual([]);
    // Integrações: o ensaio criado, com "Cancelar o ensaio"; "Ligar" ainda recusa (o ensaio não foi conferido).
    expect(await ensaioNoPainel(db, org, AGORA, PRONTO)).toMatchObject({ operacaoId: e.id, fase: "criado", imovel: "103", beds24Id: "900001", podeCancelar: true, podeConferir: false });
    expect(await ligarImovelReservasBeds24(db, admin, im, PRONTO, AGORA)).toEqual({ ok: false, erro: ERRO_LIGAR_SEM_ENSAIO });
  });

  it("Cancelar o ensaio: cancela (nunca apaga) e relê; a operação fica conferida, o ensaio é registrado com a credencial e Ligar aceita (D6)", async () => {
    await criar();
    const { id } = await umEnsaio();
    expect(await cancelar(id)).toEqual({ ok: true, desfecho: "cancelado", operacaoId: id });
    expect(falso.escritasReservas.map((x) => x.corpo)).toEqual([corpoDoEnsaio(id), [{ id: 900001, status: "cancelled" }]]);
    expect(falso.bookings).toEqual([expect.objectContaining({ id: 900001, status: "cancelled" })]);
    // As datas reabrem no calendário do Beds24 (a unidade volta).
    expect((falso.calendarios[0].calendar as Obj[]).find((d) => d.from === "2026-11-03")).toMatchObject({ numAvail: 1 });
    expect(await umEnsaio()).toMatchObject({ situacao: "conferida", resposta: "modificada", tentativas: 2, depois: { situacao: "cancelada" }, detalhe: { porBotao: "cancelar_ensaio" } });
    expect((await umEnsaio()).terminadoEm).toBeInstanceOf(Date);
    const config = await lerConfigReservasBeds24(db, org);
    expect(config.ensaio).toEqual({ credencial: impressaoCredencialBeds24(PRONTO), em: (await umEnsaio()).terminadoEm!.toISOString(), operacaoId: id });
    expect(await ligarImovelReservasBeds24(db, admin, im, PRONTO, AGORA)).toEqual({ ok: true });
    const acoes = (await db.select().from(auditoria).where(eq(auditoria.organizacaoId, org))).map((a) => a.acao);
    expect(acoes).toEqual(expect.arrayContaining(["beds24.ensaio.criar", "beds24.ensaio.cancelar", "configuracao.reservas_beds24"]));
    // O ensaio terminou: Integrações mostra o resultado, e um ensaio novo vale.
    expect(await ensaioNoPainel(db, org, AGORA, PRONTO)).toMatchObject({ fase: "terminado", situacao: "conferida", podeCancelar: false, podeConferir: false });
    expect(await criar({}, { chegada: "2026-11-10", saida: "2026-11-11" })).toMatchObject({ ok: true, desfecho: "criado" });
  });

  it("a importação pula o registro do ensaio entre os dois botões (pela marca e pelo id), e um segundo ensaio é recusado", async () => {
    await criar();
    const res = await importar();
    expect(res.divergencias).toContain("Registro 900001: ensaio do SCL; não importado.");
    // Mesmo sem a marca legível (a credencial que não lê os info items), o id gravado na operação basta.
    falso.semMarcaNaLeitura = true;
    expect((await importar()).divergencias).toContain("Registro 900001: ensaio do SCL; não importado.");
    expect(await reservasDaOrg()).toEqual([]);
    expect(await criar({}, { chegada: "2026-11-10", saida: "2026-11-11" })).toEqual({ ok: false, erro: ERRO_ENSAIO_NAO_RESOLVIDO });
    expect(falso.escritasReservas).toHaveLength(1);
  });

  it("a marca que não volta: divergente (não vale), um segundo ensaio é recusado, e cancelar fecha sem a conferência (Ligar continua recusado)", async () => {
    falso.semMarcaNaLeitura = true;
    expect(await criar()).toMatchObject({ ok: true, desfecho: "marca_nao_voltou" });
    const { id } = await umEnsaio();
    expect(await umEnsaio()).toMatchObject({ situacao: "divergente", beds24Id: "900001", erro: ERRO_ENSAIO_MARCA_NAO_VOLTOU, terminadoEm: null });
    expect(await ensaioNoPainel(db, org, AGORA, PRONTO)).toMatchObject({ fase: "nao_resolvido", podeCancelar: true });
    expect(await criar({}, { chegada: "2026-11-10", saida: "2026-11-11" })).toEqual({ ok: false, erro: ERRO_ENSAIO_NAO_RESOLVIDO });
    expect((await importar()).divergencias).toContain("Registro 900001: ensaio do SCL; não importado.");
    expect(await cancelar(id)).toEqual({ ok: true, desfecho: "cancelado_sem_conferencia", operacaoId: id });
    expect(await umEnsaio()).toMatchObject({ situacao: "falhou", erro: ERRO_ENSAIO_SEM_CONFERENCIA, depois: { situacao: "cancelada" } });
    expect((await lerConfigReservasBeds24(db, org)).ensaio).toBeNull();
    expect(await ligarImovelReservasBeds24(db, admin, im, PRONTO, AGORA)).toEqual({ ok: false, erro: ERRO_LIGAR_SEM_ENSAIO });
    // Fechado: um ensaio novo vale.
    falso.semMarcaNaLeitura = false;
    expect(await criar({}, { chegada: "2026-11-10", saida: "2026-11-11" })).toMatchObject({ ok: true, desfecho: "criado" });
  });

  it("a resposta perdida (ensaio sem id): incerta; as noites dele ficam no desvio \"e\" da importação; Conferir o ensaio acha pelo texto SCL-ENSAIO", async () => {
    falso.perderRespostaReserva = true;
    expect(await criar()).toMatchObject({ ok: true, desfecho: "sem_confirmacao" });
    falso.perderRespostaReserva = false;
    const { id } = await umEnsaio();
    expect(await umEnsaio()).toMatchObject({ situacao: "incerta", beds24Id: null, resposta: "tempo" });
    // O registro do ensaio sem a marca legível e sem o id conhecido nunca vira reserva (desenho 5.2, "Para o M8.3c").
    falso.semMarcaNaLeitura = true;
    expect((await importar()).divergencias).toContain("Registro 900001: sobre as noites de um ensaio do SCL ainda não resolvido; não importado (confira o ensaio em Integrações).");
    expect(await reservasDaOrg()).toEqual([]);
    falso.semMarcaNaLeitura = false;
    // Antes de 5 min desde o envio, nada conclui (e nada é lido).
    await envelhecerEnvio(id, 1);
    const lidas = falso.filtrosLidos.length;
    expect(await conferir(id)).toEqual({ ok: false, erro: ERRO_ENSAIO_AGUARDE });
    expect(falso.filtrosLidos).toHaveLength(lidas);
    expect(await ensaioNoPainel(db, org, AGORA, PRONTO)).toMatchObject({ fase: "nao_resolvido", podeConferir: false, conferirAPartirDe: new Date(minutosAntesDe(1).getTime() + 5 * 60_000) });
    await envelhecerEnvio(id);
    expect(await conferir(id)).toEqual({ ok: true, desfecho: "achado_vivo", operacaoId: id });
    expect(falso.filtrosLidos.at(-1)).toEqual({ quarto: "20", chegadaExata: "2026-11-03", incluirInfo: true });
    expect(await umEnsaio()).toMatchObject({ situacao: "incerta", beds24Id: "900001", depois: { situacao: "confirmada" }, detalhe: { porBotao: "conferir_ensaio" } });
    // Achado e vivo: Cancelar o ensaio fecha sem a conferência (o ensaio não chegou à feita).
    expect(await ensaioNoPainel(db, org, AGORA, PRONTO)).toMatchObject({ podeCancelar: true });
    expect(await cancelar(id)).toMatchObject({ ok: true, desfecho: "cancelado_sem_conferencia" });
    expect((await lerConfigReservasBeds24(db, org)).ensaio).toBeNull();
  });

  it("o POST que caiu na rede (nada gravado): Conferir o ensaio só conclui \"nada criado\" com a credencial do ensaio; depois, um ensaio novo vale", async () => {
    falso.antesDeGravar = async () => {
      falso.falhar = new ErroBeds24("Falha de rede ao falar com o Beds24.", "rede");
    };
    expect(await criar()).toMatchObject({ ok: true, desfecho: "sem_confirmacao" });
    falso.antesDeGravar = null;
    falso.falhar = null;
    const { id } = await umEnsaio();
    expect(await umEnsaio()).toMatchObject({ situacao: "incerta", resposta: "rede", beds24Id: null });
    expect(falso.bookings).toEqual([]);
    await envelhecerEnvio(id);
    // Com outra credencial (o token trocado), "não achou" não conclui: o registro pode estar numa conta que ela não vê.
    expect(await conferir(id, env({ ...PRONTO, BEDS24_REFRESH_TOKEN: "outro-refresh-ficticio" }))).toEqual({ ok: false, erro: ERRO_ENSAIO_LEITURA_SEM_CONCLUSAO });
    expect((await umEnsaio()).situacao).toBe("incerta");
    // Um registro confirmado nas datas do ensaio sem marca legível pode ser o dele: também não conclui.
    falso.bookings.push({ id: 555, propertyId: 10, roomId: 20, status: "confirmed", arrival: "2026-11-03", departure: "2026-11-04", numAdult: 1 });
    expect(await conferir(id)).toEqual({ ok: false, erro: ERRO_ENSAIO_LEITURA_SEM_CONCLUSAO });
    falso.bookings = [];
    expect(await conferir(id)).toEqual({ ok: true, desfecho: "nada_criado", operacaoId: id });
    expect(await umEnsaio()).toMatchObject({ situacao: "falhou", erro: ERRO_ENSAIO_NADA_CRIADO });
    expect(await ensaioNoPainel(db, org, AGORA, PRONTO)).toMatchObject({ fase: "terminado" });
    expect(await criar({}, { chegada: "2026-11-10", saida: "2026-11-11" })).toMatchObject({ ok: true, desfecho: "criado" });
  });

  it("a queda entre a criação e a fase 3: a operação fica visível, o segundo ensaio é recusado, a rotina só a passa a incerta, e Conferir resolve", async () => {
    await expect(criar({ ganchos: { antesDaFase3: () => { throw new Error("queda fictícia"); } } })).rejects.toThrow("queda fictícia");
    const { id } = await umEnsaio();
    expect(await umEnsaio()).toMatchObject({ situacao: "enviando", beds24Id: "900001", resposta: "criada" });
    expect(await ensaioNoPainel(db, org, AGORA, PRONTO)).toMatchObject({ fase: "em_andamento" });
    expect(await criar({}, { chegada: "2026-11-10", saida: "2026-11-11" })).toEqual({ ok: false, erro: ERRO_ENSAIO_EM_ANDAMENTO });
    await vencer(id);
    expect(await ensaioNoPainel(db, org, AGORA, PRONTO)).toMatchObject({ fase: "nao_resolvido" });
    // Com a chave desligada ou a pausa (o passo 0), a rotina também entra para passá-lo a incerta.
    expect(await haOperacaoEmCursoASair(db, org)).toBe(true);
    expect(await criar({}, { chegada: "2026-11-10", saida: "2026-11-11" })).toEqual({ ok: false, erro: ERRO_ENSAIO_NAO_RESOLVIDO });
    // O passo 1 da volta: o ensaio vencido com o POST passa a incerta, com o id (a fase 3 da reserva nunca o resolveria), e só.
    const lidas = falso.filtrosLidos.length;
    await resolverOperacoesEmCurso(db, org, falso, { env: PRONTO, relogio });
    expect(await umEnsaio()).toMatchObject({ situacao: "incerta", beds24Id: "900001" });
    expect(falso.filtrosLidos).toHaveLength(lidas);
    await resolverOperacoesEmCurso(db, org, falso, { env: PRONTO, relogio });
    expect(await umEnsaio()).toMatchObject({ situacao: "incerta", beds24Id: "900001" });
    await envelhecerEnvio(id);
    expect(await conferir(id)).toMatchObject({ ok: true, desfecho: "achado_vivo" });
    expect(await cancelar(id)).toMatchObject({ ok: true, desfecho: "cancelado_sem_conferencia" });
    expect(falso.bookings).toEqual([expect.objectContaining({ id: 900001, status: "cancelled" })]);
  });

  it("o ensaio que parou antes do POST: Integrações mostra, Conferir o ensaio o encerra sem ler o Beds24, e criar outro também o encerra", async () => {
    const parado = async () => {
      const id = crypto.randomUUID();
      const pedido = { quarto: "20", ...ENTRADA, hospedes: 1, situacao: "confirmada" as const, referencia: INFO_ENSAIO_SCL };
      await db.insert(op).values({ id, organizacaoId: org, tipo: "ensaio", chave: chaveEnsaioBeds24(id), modo: "real", situacao: "enviando", pedido, credencial: impressaoCredencialBeds24(PRONTO), iniciadoEm: new Date(Date.now() - 7 * 60_000) });
      return id;
    };
    const a = await parado();
    expect(await ensaioNoPainel(db, org, AGORA, PRONTO)).toMatchObject({ operacaoId: a, fase: "parado_antes_do_envio", podeConferir: true });
    const chamadas = falso.chamadas;
    expect(await conferir(a)).toEqual({ ok: true, desfecho: "encerrado_sem_envio", operacaoId: a });
    expect(falso.chamadas).toBe(chamadas);
    expect((await db.select().from(op).where(eq(op.id, a)))[0]).toMatchObject({ situacao: "falhou", erro: ERRO_ENSAIO_PARADO_ANTES_DO_ENVIO });
    const b = await parado();
    expect(await criar({}, { chegada: "2026-11-10", saida: "2026-11-11" })).toMatchObject({ ok: true, desfecho: "criado" });
    expect((await db.select().from(op).where(eq(op.id, b)))[0]).toMatchObject({ situacao: "falhou", erro: ERRO_ENSAIO_PARADO_ANTES_DO_ENVIO });
  });
});

describe("as travas do ensaio (desenho 8: as mesmas da seção 2)", () => {
  it("fora do deploy de produção, sem a chave, com a pausa ou com a credencial de outra organização: recusa sem ler, sem escrever e sem linha", async () => {
    for (const ambiente of [env({ ...PRONTO, VERCEL_ENV: "preview" }), env({ ...PRONTO, NODE_ENV: "development" }), env({ ...PRONTO, VERCEL_ENV: undefined }), env({ ...PRONTO, BEDS24_ESCRITA_RESERVAS: undefined })]) {
      expect(await criar({}, {}, admin, ambiente)).toEqual({ ok: false, erro: ERRO_ENSAIO_FORA_DA_PRODUCAO });
    }
    expect(await criar({ cliente: null })).toEqual({ ok: false, erro: ERRO_ENSAIO_FORA_DA_PRODUCAO });
    expect(await conferir(crypto.randomUUID(), env({ ...PRONTO, VERCEL_ENV: "preview" }))).toEqual({ ok: false, erro: ERRO_ENSAIO_SEM_LEITURA });
    expect(await criar({}, {}, admin, env({ ...PRONTO, BEDS24_ORGANIZACAO_ID: crypto.randomUUID() }))).toEqual({ ok: false, erro: ERRO_ENSAIO_OUTRA_ORGANIZACAO });
    await gravarConfig(db, org, "reservas_beds24", { pausado: { em: AGORA.toISOString(), por: null }, imoveis: [], ensaio: null }, null);
    expect(await criar()).toEqual({ ok: false, erro: ERRO_ENSAIO_PAUSADO });
    expect(falso.chamadas).toBe(0);
    expect(await ensaios()).toEqual([]);
  });

  it("o papel operacao é recusado no domínio (criar, cancelar e conferir)", async () => {
    const operacao: Sessao = { ...admin, papel: "operacao" };
    await expect(criar({}, {}, operacao)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(cancelarEnsaioReservasBeds24(db, operacao, crypto.randomUUID(), PRONTO, { cliente: falso, relogio })).rejects.toBeInstanceOf(AcessoNegado);
    await expect(conferirEnsaioReservasBeds24(db, operacao, crypto.randomUUID(), PRONTO, { leitor: falso, relogio })).rejects.toBeInstanceOf(AcessoNegado);
    expect(falso.chamadas).toBe(0);
  });

  it("as datas, o imóvel sem vínculo e as noites ocupadas no SCL: recusa antes de qualquer leitura ou linha", async () => {
    expect(await criar({}, { chegada: "2026-10-15", saida: "2026-10-16" })).toEqual({ ok: false, erro: ERRO_ENSAIO_DATAS });
    expect(await criar({}, { chegada: "2026-11-03", saida: "2026-11-03" })).toEqual({ ok: false, erro: ERRO_ENSAIO_DATAS });
    expect(await criar({}, { chegada: "2026-11-03", saida: "2026-11-11" })).toEqual({ ok: false, erro: ERRO_ENSAIO_DATAS });
    const [{ id: semVinculo }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "204", nome: "Outro imóvel fictício" }).returning();
    expect(await criar({}, { imovelId: semVinculo })).toEqual({ ok: false, erro: ERRO_ENSAIO_IMOVEL });
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, im));
    expect(await criar()).toEqual({ ok: false, erro: ERRO_ENSAIO_IMOVEL });
    await db.update(imoveis).set({ ativo: true }).where(eq(imoveis.id, im));
    await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-7K2QXM", origem: "direta", fonte: "manual", checkin: "2026-11-02", checkout: "2026-11-04" });
    expect(await criar()).toEqual({ ok: false, erro: ERRO_ENSAIO_OCUPADO_NO_SCL });
    await db.update(reservas).set({ estado: "cancelada" }).where(eq(reservas.organizacaoId, org));
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: im, inicio: "2026-11-03", fim: "2026-11-05", motivo: "Uso próprio" });
    expect(await criar()).toEqual({ ok: false, erro: ERRO_ENSAIO_OCUPADO_NO_SCL });
    expect(falso.chamadas).toBe(0);
    expect(await ensaios()).toEqual([]);
  });

  it("antes do POST: os escopos fora de ordem, o quarto em outra moeda, as noites ocupadas no Beds24, a pausa e o token — nada sai, e o ensaio fecha", async () => {
    const casos: [string, () => void, string, "falhou" | "conflito"][] = [
      ["escopos", () => { falso.detalhesCredencial = { validToken: true, token: { scopes: ["read:bookings", "write:bookings", "all:bookings"] } }; }, ERRO_ENSAIO_ESCOPOS, "falhou"],
      ["moeda", () => { falso.properties = [{ id: 10, currency: "USD", roomTypes: [{ id: 20, name: "Studio" }] }]; }, ERRO_ENSAIO_QUARTO, "falhou"],
      ["ocupadas", () => { falso.bookings = [{ id: 777, propertyId: 10, roomId: 20, status: "confirmed", arrival: "2026-11-02", departure: "2026-11-05", numAdult: 2, channel: "Airbnb" }]; }, ERRO_ENSAIO_NOITES, "conflito"],
      ["token", () => { falso.falharToken = new ErroBeds24("O token do Beds24 não veio.", "rede"); }, "O token do Beds24 não veio.", "falhou"],
    ];
    for (const [nome, preparar, erro, situacao] of casos) {
      const anterior = { detalhes: falso.detalhesCredencial, properties: falso.properties };
      preparar();
      expect(await criar(), nome).toEqual({ ok: false, erro });
      const ultimo = (await ensaios()).at(-1)!;
      expect(ultimo, nome).toMatchObject({ situacao, erro, enviadoEm: null });
      expect(ultimo.terminadoEm, nome).toBeInstanceOf(Date);
      falso.detalhesCredencial = anterior.detalhes;
      falso.properties = anterior.properties;
      falso.bookings = [];
      falso.falharToken = null;
    }
    // A pausa ligada entre as fases (relida logo antes do POST).
    expect(await criar({ ganchos: { antesDaFase2: () => gravarConfig(db, org, "reservas_beds24", { pausado: { em: AGORA.toISOString(), por: null }, imoveis: [], ensaio: null }, null) } })).toEqual({ ok: false, erro: ERRO_ENSAIO_PAUSA_ANTES_DO_POST });
    expect(falso.escritasReservas).toEqual([]);
    // Nada saiu em nenhum caso: nenhum deles fica "não resolvido" (a guarda deixa criar o próximo).
    await gravarConfig(db, org, "reservas_beds24", { pausado: null, imoveis: [], ensaio: null }, null);
    expect(await criar()).toMatchObject({ ok: true, desfecho: "criado" });
  });

  it("o POST recusado (403): o ensaio fecha, o último 403 aparece em Integrações; a recusa de disponibilidade fica incerta, sem o texto do Beds24 em tabela nenhuma", async () => {
    falso.responder403 = true;
    expect(await criar()).toEqual({ ok: false, erro: TEXTOS_DE_ERRO_BEDS24.http_403 });
    expect(await umEnsaio()).toMatchObject({ situacao: "recusada", resposta: "http_403" });
    expect(await ultimaRecusaDeReservas(db, org, PRONTO)).toMatchObject({ resposta: "http_403", tipo: "ensaio", comCredencialAtual: true });
    falso.responder403 = false;
    falso.recusarDisponibilidade = true;
    expect(await criar()).toMatchObject({ ok: true, desfecho: "sem_confirmacao" });
    expect((await ensaios()).at(-1)).toMatchObject({ situacao: "incerta", resposta: "recusada_disponibilidade", erro: TEXTOS_DE_ERRO_BEDS24.recusada_disponibilidade });
    expect(MENSAGEM_SEM_DISPONIBILIDADE_FALSO).toContain("Hóspede Fictício");
    expect(await semDadosPessoais(db, [MENSAGEM_SEM_DISPONIBILIDADE_FALSO], { nomes: ["Hóspede Fictício"] })).toEqual([]);
  });

  it("um ensaio por vez: com o primeiro preso no POST, o segundo é recusado pela escrita em andamento; um POST só", async () => {
    let liberar!: () => void;
    let chegou!: () => void;
    const portao = new Promise<void>((r) => (liberar = r));
    const naPorta = new Promise<void>((r) => (chegou = r));
    falso.antesDeGravar = async () => {
      chegou();
      await portao;
    };
    const a = criar();
    await naPorta;
    expect(await criar({}, { chegada: "2026-11-10", saida: "2026-11-11" })).toEqual({ ok: false, erro: ERRO_ENSAIO_EM_ANDAMENTO });
    liberar();
    expect(await a).toMatchObject({ ok: true, desfecho: "criado" });
    expect(falso.escritasReservas).toHaveLength(1);
    expect(await ensaios()).toHaveLength(1);
  });

  it("a feita com a pausa: Cancelar o ensaio recusa; mudada para Cancelado à mão no Beds24, Conferir o ensaio a fecha (sem liberar Ligar)", async () => {
    await criar();
    const { id } = await umEnsaio();
    await gravarConfig(db, org, "reservas_beds24", { pausado: { em: AGORA.toISOString(), por: null }, imoveis: [], ensaio: null }, null);
    expect(await cancelar(id)).toEqual({ ok: false, erro: ERRO_ENSAIO_PAUSADO });
    expect(falso.escritasReservas).toHaveLength(1);
    await envelhecerEnvio(id);
    // Ainda confirmada no Beds24: achada e viva, continua feita (e Cancelar o ensaio continua valendo depois da pausa).
    expect(await conferir(id)).toMatchObject({ ok: true, desfecho: "achado_vivo" });
    expect(await umEnsaio()).toMatchObject({ situacao: "feita" });
    falso.bookings[0].status = "cancelled";
    expect(await conferir(id)).toMatchObject({ ok: true, desfecho: "cancelado_sem_conferencia" });
    expect(await umEnsaio()).toMatchObject({ situacao: "falhou", depois: { situacao: "cancelada" } });
    expect((await lerConfigReservasBeds24(db, org)).ensaio).toBeNull();
    expect(await ensaioNoPainel(db, org, AGORA, PRONTO)).toMatchObject({ fase: "terminado", comCredencialAtual: true });
    expect(await ensaioNoPainel(db, org, AGORA, env({ ...PRONTO, BEDS24_REFRESH_TOKEN: "outro-refresh-ficticio" }))).toMatchObject({ comCredencialAtual: false });
  });

  it("Cancelar o ensaio: com outra credencial recusa sem nada; com escopo a mais, sem POST; com o 403, a operação volta a feita; depois, cancela", async () => {
    await criar();
    const { id } = await umEnsaio();
    expect(await cancelar(id, {}, env({ ...PRONTO, BEDS24_REFRESH_TOKEN: "outro-refresh-ficticio" }))).toEqual({ ok: false, erro: ERRO_ENSAIO_CREDENCIAL_TROCADA });
    expect(await umEnsaio()).toMatchObject({ situacao: "feita", tentativas: 1 });
    const escopos = falso.detalhesCredencial;
    falso.detalhesCredencial = { validToken: true, token: { scopes: ["read:bookings", "write:bookings", "all:bookings"] } };
    expect(await cancelar(id)).toEqual({ ok: false, erro: ERRO_ENSAIO_ESCOPO_EXCESSIVO });
    expect(await umEnsaio()).toMatchObject({ situacao: "feita", erro: ERRO_ENSAIO_ESCOPO_EXCESSIVO });
    expect(falso.escritasReservas).toHaveLength(1);
    falso.detalhesCredencial = escopos;
    falso.responder403 = true;
    expect(await cancelar(id)).toEqual({ ok: false, erro: TEXTOS_DE_ERRO_BEDS24.http_403 });
    expect(await umEnsaio()).toMatchObject({ situacao: "feita", resposta: "http_403" });
    expect(await ensaioNoPainel(db, org, AGORA, PRONTO)).toMatchObject({ fase: "criado", podeCancelar: true });
    falso.responder403 = false;
    expect(await cancelar(id)).toMatchObject({ ok: true, desfecho: "cancelado" });
    // Já cancelado: nada mais a cancelar, e nada a conferir.
    expect(await cancelar(id)).toMatchObject({ ok: false });
    expect(await conferir(id)).toMatchObject({ ok: false });
  });
});

describe("as regras puras do ensaio (plano 1.12)", () => {
  const lido = (situacao: "confirmada" | "cancelada") => ({ quarto: "20", chegada: "2026-11-03", saida: "2026-11-04", hospedes: 1, situacao });
  it("não resolvido = teve POST, não está fechado e não foi relido como cancelado (inclusive feita, incerta, divergente e enviando)", () => {
    const enviadoEm = AGORA;
    for (const situacao of ["feita", "incerta", "divergente", "enviando"] as SituacaoOperacaoBeds24[]) {
      expect(ensaioNaoResolvidoBeds24({ enviadoEm, situacao, depois: null }), situacao).toBe(true);
      expect(ensaioNaoResolvidoBeds24({ enviadoEm, situacao, depois: lido("confirmada") }), situacao).toBe(true);
      expect(ensaioNaoResolvidoBeds24({ enviadoEm, situacao, depois: lido("cancelada") }), situacao).toBe(false);
      expect(ensaioNaoResolvidoBeds24({ enviadoEm: null, situacao, depois: null }), situacao).toBe(false);
    }
    for (const situacao of SITUACOES_ENSAIO_FECHADO) expect(ensaioNaoResolvidoBeds24({ enviadoEm, situacao, depois: null }), situacao).toBe(false);
  });

  it("a fase na tela: em andamento, parado antes do envio, criado, não resolvido e terminado", () => {
    expect(faseDoEnsaioBeds24({ situacao: "enviando", enviadoEm: null, depois: null, vencida: false })).toBe("em_andamento");
    expect(faseDoEnsaioBeds24({ situacao: "enviando", enviadoEm: AGORA, depois: null, vencida: false })).toBe("em_andamento");
    expect(faseDoEnsaioBeds24({ situacao: "enviando", enviadoEm: null, depois: null, vencida: true })).toBe("parado_antes_do_envio");
    expect(faseDoEnsaioBeds24({ situacao: "enviando", enviadoEm: AGORA, depois: null, vencida: true })).toBe("nao_resolvido");
    expect(faseDoEnsaioBeds24({ situacao: "feita", enviadoEm: AGORA, depois: lido("confirmada"), vencida: true })).toBe("criado");
    expect(faseDoEnsaioBeds24({ situacao: "incerta", enviadoEm: AGORA, depois: null, vencida: true })).toBe("nao_resolvido");
    expect(faseDoEnsaioBeds24({ situacao: "falhou", enviadoEm: AGORA, depois: lido("cancelada"), vencida: true })).toBe("terminado");
    expect(faseDoEnsaioBeds24({ situacao: "conflito", enviadoEm: null, depois: null, vencida: true })).toBe("terminado");
  });
});
