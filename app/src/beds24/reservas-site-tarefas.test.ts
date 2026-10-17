/**
 * Tarefas das OTAs num lugar só (M8.3b, desenho 6; seção 10, testes 14 a 18): os avisos da paga, da D3, da cancelada e da
 * alterada com os cortes de data de antes; os textos por reserva (bloqueio feito à mão ou reserva criada pelo sistema, sempre
 * "não apague"); a marca manual "Datas fechadas nas OTAs" (D8) e a "Datas reabertas nas OTAs" da D3 cancelada; a D3 que
 * nunca vai ao envio; a carência do envio automático (informativo, atrasadas e atenção). PGlite, os cenários do pagamento e
 * um espião de `fetch` que nunca é chamado: nada vai ao Beds24.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { gravarConfig } from "@/configuracoes/armazem";
import { auditoria, beds24ReservasOperacoes, beds24ReservasSite, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { marcarOtaAtualizada } from "@/pagamentos/alteracao";
import { marcarOtaLiberada } from "@/pagamentos/cancelamento";
import { cancelarReserva, confirmarReserva } from "@/reservas/repositorio";
import { alterar, type Cenario, cancelar, entradaPadrao, env, minutos, montarCenario, pagarDiferenca, pagarEConfirmar, semDadosDoHospede, usuarioDeTeste } from "@/pagamentos/testes";
import { conferirNaImportacao } from "./reservas-site";
import { chaveDoResultadoDaSimulacao, simularReservaNoBeds24 } from "./reservas-site-simulacao";
import {
  avisosDasTarefas,
  CARENCIA_ENVIO_RESERVA_MINUTOS,
  classificarTarefa,
  type EntradaDaTarefaOta,
  ERRO_MARCA_EM_ENVIO,
  ERRO_MARCA_TRAVA_OCUPADA,
  ERRO_NADA_A_FECHAR,
  ERRO_NADA_A_REABRIR,
  marcarDatasFechadasNasOtas,
  marcarDatasReabertasNasOtas,
  type TarefaOta,
  tarefasDasOtas,
  textoDaTarefa,
} from "./reservas-site-tarefas";

// A trava `beds24:<org>` ocupada por outra sessão (o PGlite dos testes tem uma conexão só: a trava é reentrante nele).
const trava = vi.hoisted(() => ({ ocupada: false }));
vi.mock("./trava", async (original) => {
  const o = await original<typeof import("./trava")>();
  return { ...o, tentarTravaBeds24: async (tx: Db, org: string) => (trava.ocupada ? false : o.tentarTravaBeds24(tx, org)) };
});

/** O deploy de produção com a chave das reservas e o refresh token (fictício): a trava de ambiente aberta. */
const PRONTO = env({ VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" });

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string, admin: Sessao;
let espiao: ReturnType<typeof vi.spyOn>;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  trava.ocupada = false;
  espiao = vi.spyOn(globalThis, "fetch");
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
  admin = { usuarioId: equipe, organizacaoId: c.org, papel: "admin", imovelIds: [] };
});
afterEach(() => {
  expect(espiao).not.toHaveBeenCalled();
  espiao.mockRestore();
});

const tarefas = (agora: Date = minutos(90), e: NodeJS.ProcessEnv = env(), reservaIds?: string[]) => tarefasDasOtas(db, c.org, agora, e, reservaIds ? { reservaIds } : {});
const textos = async (agora?: Date, e?: NodeJS.ProcessEnv) => (await tarefas(agora, e)).avisos.map((a) => a.texto);
const daReserva = async (reservaId: string, agora?: Date, e?: NodeJS.ProcessEnv) => (await tarefas(agora, e)).tarefas.filter((t) => t.reservaId === reservaId);
const acompanhamento = async (reservaId: string) => (await db.select().from(beds24ReservasSite).where(eq(beds24ReservasSite.reservaId, reservaId)))[0];
const novaLinha = (x: { reservaId: string; reservaCodigo: string }, o: Partial<typeof beds24ReservasSite.$inferInsert> = {}) =>
  db.insert(beds24ReservasSite).values({ organizacaoId: c.org, reservaId: x.reservaId, imovelId: c.imovel, referencia: x.reservaCodigo, ...o });
/** O imóvel ligado na configuração (D6), escrito direto (ligar pelo painel exige o ensaio do M8.3c). */
const ligarImovel = (ligadoEm = "2026-09-01T00:00:00.000Z", pausado: { em: string; por: string | null } | null = null) =>
  gravarConfig(db, c.org, "reservas_beds24", { pausado, imoveis: [{ imovelId: c.imovel, ligadoEm, ligadoPor: null }], ensaio: null }, null);
/** A SCL cancela pela política (força maior): sem pedido do hóspede, devolução integral. */
const empresa = () => entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" });
const codigos = (...xs: { reservaCodigo: string }[]) => xs.map((x) => x.reservaCodigo).sort((a, b) => a.localeCompare(b)).join(", ");
/** A D3: o pedido do site confirmado à mão pela equipe, sem pagamento pelo site. */
async function d3(entrada = "2026-10-12", saida = "2026-10-15") {
  const h = await c.segurar({ entrada, saida, email: `d3.${entrada}@example.com` }, minutos(1));
  expect((await confirmarReserva(db, c.org, h.reservaId, equipe, minutos(2))).ok).toBe(true);
  return { reservaId: h.reservaId, reservaCodigo: (await c.reserva(h.reservaId)).codigo };
}
/** Uma alteração que aumenta a saída, aplicada pelo pagamento da diferença (M8.2d) 5 minutos depois de `quando`. */
async function alterarSaida(x: { reservaId: string; cotacaoId: string }, saida: string, quando = minutos(20)) {
  const { resultado } = await alterar(c, x.reservaId, { checkout: saida }, quando, { autorId: equipe });
  if (!resultado.ok || !("alteracaoId" in resultado)) throw new Error("alteração não segurada");
  expect((await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(5, quando) })).resultado).toBe("aprovado");
  return resultado.alteracaoId;
}

describe("teste 14: os três avisos das OTAs, com os cortes de data de antes", () => {
  it("paga, cancelada e alterada, da empresa toda e sem valores; a saída hoje tira a paga e a cancelada; a alterada vale até a maior saída", async () => {
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    const z = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "z@example.com", liberar: true });
    expect((await cancelar(c, y.reservaId, empresa(), equipe, minutos(60))).resultado.ok).toBe(true);
    const alteracaoId = await alterarSaida(z, "2026-10-24");
    const t = await tarefas();
    expect(t.avisos).toEqual([
      { nivel: "info", texto: `2 reserva(s) do site paga(s) (${codigos(x, z)}): feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.`, link: "/painel/reservas" },
      { nivel: "info", texto: `Reserva ${y.reservaCodigo}, cancelada: mude o bloqueio de 02/11 a 05/11 para Cancelado (não apague).`, link: `/painel/reservas/${y.reservaId}` },
      { nivel: "info", texto: `Reserva ${z.reservaCodigo}, alterada: mude as datas do bloqueio para 20/10 a 24/10 (não apague nem crie outro).`, link: `/painel/reservas/${z.reservaId}` },
    ]);
    expect(t.tarefas.find((k) => k.caso === "alterada_bloqueio")).toMatchObject({ reservaId: z.reservaId, estado: "manual", alteracaoIds: [alteracaoId], marca: null });
    expect(t.tarefas.find((k) => k.caso === "cancelada_bloqueio")).toMatchObject({ reservaId: y.reservaId, estado: "manual", desde: minutos(60), marca: null });
    expect(t.atencoes).toEqual([]);
    for (const a of t.avisos) expect(a.texto).not.toContain("R$");
    // Os cortes: a paga e a cancelada com a saída depois de hoje; a alterada com a maior saída (de antes ou de agora) a partir de hoje.
    expect(await textos(new Date("2026-10-14T15:00:00Z"))).toEqual(expect.arrayContaining([expect.stringContaining(x.reservaCodigo)]));
    expect((await textos(new Date("2026-10-15T15:00:00Z"))).join("\n")).not.toContain(x.reservaCodigo);
    expect((await textos(new Date("2026-11-04T15:00:00Z"))).join("\n")).toContain(`Reserva ${y.reservaCodigo}, cancelada`);
    expect((await textos(new Date("2026-11-05T15:00:00Z"))).join("\n")).not.toContain(y.reservaCodigo);
    expect(await textos(new Date("2026-10-24T15:00:00Z"))).toEqual([
      `Reserva ${y.reservaCodigo}, cancelada: mude o bloqueio de 02/11 a 05/11 para Cancelado (não apague).`,
      `Reserva ${z.reservaCodigo}, alterada: mude as datas do bloqueio para 20/10 a 24/10 (não apague nem crie outro).`,
    ]);
    expect(await textos(new Date("2026-10-25T15:00:00Z"))).toEqual([`Reserva ${y.reservaCodigo}, cancelada: mude o bloqueio de 02/11 a 05/11 para Cancelado (não apague).`]);
    // Outra empresa não vê nada disso.
    const outra = await montarCenario(db);
    expect(await tarefasDasOtas(db, outra.org, minutos(90), env())).toEqual({ tarefas: [], atencoes: [], avisos: [] });
  });

  it("só as marcas tiram a cancelada e a alterada (a da equipe agora; a do sistema no M8.3c), mesmo com a escrita do calendário ligada", async () => {
    const y = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    const z = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "z@example.com", liberar: true });
    await cancelar(c, y.reservaId, empresa(), equipe, minutos(60));
    const alteracaoId = await alterarSaida(z, "2026-10-24");
    // A escrita do calendário (M3.7) ligada não muda nada aqui: as reservas têm a chave própria. Credencial fictícia.
    const calendario = env({ BEDS24_ESCRITA: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" });
    expect((await textos(minutos(90), calendario)).join("\n")).toContain(`Reserva ${y.reservaCodigo}, cancelada`);
    expect(await marcarOtaLiberada(db, c.org, y.reservaId, equipe, minutos(91))).toEqual({ ok: true });
    expect(await marcarOtaAtualizada(db, c.org, alteracaoId, equipe, minutos(91))).toEqual({ ok: true });
    const depois = (await textos(minutos(92), calendario)).join("\n");
    expect(depois).not.toContain(y.reservaCodigo);
    expect(depois).not.toContain("alterada");
  });

  it("várias reservas: até cinco códigos e o resto em número, com o link para a lista", () => {
    const t = (n: number): TarefaOta => ({ reservaId: `r${n}`, codigo: `SCL-T0000${n}`, caso: "paga", estado: "manual", checkin: "2026-10-12", checkout: "2026-10-15", desde: minutos(0), alteracaoIds: [], texto: "", marca: "datas_fechadas" });
    expect(avisosDasTarefas([1, 2, 3, 4, 5, 6, 7].map(t), [])).toEqual([
      { nivel: "info", texto: "7 reserva(s) do site paga(s) (SCL-T00001, SCL-T00002, SCL-T00003, SCL-T00004, SCL-T00005 e mais 2): feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.", link: "/painel/reservas" },
    ]);
    expect(avisosDasTarefas([t(1)], [])[0].link).toBe("/painel/reservas/r1");
  });
});

describe("teste 15: os textos por reserva (6.2)", () => {
  it("cada caso, com as datas da reserva agora; sempre \"não apague\"", () => {
    const r = { codigo: "SCL-TESTE1", checkin: "2026-10-12", checkout: "2026-10-15" };
    expect(textoDaTarefa({ ...r, caso: "paga" })).toBe("Feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.");
    expect(textoDaTarefa({ ...r, caso: "d3" })).toBe("Confirmada à mão, sem pagamento pelo site: esta reserva nunca vai ao Beds24 pelo sistema. Feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.");
    expect(textoDaTarefa({ ...r, caso: "cancelada_bloqueio" })).toBe("Mude o bloqueio de 12/10 a 15/10 para Cancelado (não apague).");
    expect(textoDaTarefa({ ...r, caso: "d3_cancelada" })).toBe("Mude o bloqueio de 12/10 a 15/10 para Cancelado (não apague).");
    expect(textoDaTarefa({ ...r, caso: "cancelada_criada" })).toBe("No Beds24, mude a reserva SCL-TESTE1 para Cancelado (não apague).");
    expect(textoDaTarefa({ ...r, caso: "alterada_bloqueio" })).toBe("Mude as datas do bloqueio para 12/10 a 15/10 (não apague nem crie outro).");
    expect(textoDaTarefa({ ...r, caso: "alterada_criada" })).toBe("No Beds24, mude as datas da reserva SCL-TESTE1 para 12/10 a 15/10.");
  });

  it("bloqueio feito à mão contra reserva criada pelo sistema (o quarto guardado e o id do Beds24), com a chave desligada; e as perguntas do pagamento", async () => {
    const y = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    const z = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "z@example.com", liberar: true });
    const { previa } = await cancelar(c, y.reservaId, empresa(), equipe, minutos(60));
    if (!previa.ok) throw new Error(previa.erro);
    await alterarSaida(z, "2026-10-24");
    expect((await daReserva(y.reservaId)).map((t) => [t.caso, t.texto])).toEqual([["cancelada_bloqueio", "Mude o bloqueio de 02/11 a 05/11 para Cancelado (não apague)."]]);
    expect((await daReserva(z.reservaId)).map((t) => [t.caso, t.texto])).toEqual([
      ["paga", "Feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs."],
      ["alterada_bloqueio", "Mude as datas do bloqueio para 20/10 a 24/10 (não apague nem crie outro)."],
    ]);
    // Criadas pelo sistema (ids fictícios): o texto fala da reserva no Beds24. A marca da criação conferida tira a paga.
    for (const [x, id] of [[y, "90001"], [z, "90002"]] as const) {
      await db.update(reservas).set({ beds24Id: id }).where(eq(reservas.id, x.reservaId));
      await novaLinha(x, { propertyId: "10", roomId: "20", situacao: "conferida", otaFechadaEm: minutos(10) });
    }
    const t = await tarefas();
    expect(t.tarefas.map((k) => [k.reservaId, k.caso, k.estado, k.texto])).toEqual(
      expect.arrayContaining([
        [y.reservaId, "cancelada_criada", "manual", `No Beds24, mude a reserva ${y.reservaCodigo} para Cancelado (não apague).`],
        [z.reservaId, "alterada_criada", "manual", `No Beds24, mude as datas da reserva ${z.reservaCodigo} para 20/10 a 24/10.`],
      ]),
    );
    expect(t.tarefas).toHaveLength(2);
    expect(t.avisos.map((a) => a.texto)).toEqual(expect.arrayContaining([`No Beds24, mude a reserva ${y.reservaCodigo} para Cancelado (não apague).`, `No Beds24, mude as datas da reserva ${z.reservaCodigo} para 20/10 a 24/10.`]));
    for (const s of [...t.tarefas.map((k) => k.texto), ...t.avisos.map((a) => a.texto)]) expect(s).not.toMatch(/apague o bloqueio|reabra/i);
    // As perguntas do cancelamento e da alteração (o pagamento não importa o M8.3): mudar para Cancelado, nunca apagar.
    expect(previa.previa.pergunta).toContain("nas OTAs, siga o aviso do Início (no Beds24, mude para Cancelado; não apague)");
    const w = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23", email: "w@example.com" });
    const alteracao = await alterar(c, w.reservaId, { checkout: "2026-11-24" }, minutos(30), { autorId: equipe });
    if (!alteracao.previa.ok) throw new Error(alteracao.previa.erro);
    expect(alteracao.previa.previa.pergunta).toContain("depois, mude as datas no Beds24 como o Início mostrar (não apague nem crie outro).");
    expect(alteracao.previa.previa.avisos).toContain("Depois de aplicada, mude as datas no Beds24 como o Início mostrar (no mesmo bloqueio: não apague nem crie outro).");
    for (const s of [previa.previa.pergunta, alteracao.previa.previa.pergunta, ...alteracao.previa.previa.avisos]) expect(s).not.toMatch(/apague o bloqueio|reabra/i);
  });

  it("cancelada depois de uma mudança de datas ainda não marcada nas OTAs: o bloqueio está onde a última marca o pôs", async () => {
    const semMarca = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "a@example.com", liberar: true });
    const marcada = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05", email: "b@example.com", liberar: true });
    const duas = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23", email: "d@example.com", liberar: true });
    await alterarSaida(semMarca, "2026-10-24");
    expect(await marcarOtaAtualizada(db, c.org, await alterarSaida(marcada, "2026-11-06"), equipe, minutos(30))).toEqual({ ok: true });
    // A primeira mudança marcada (o bloqueio foi a 20/11 a 24/11), a segunda ainda não: o bloqueio está nas datas de antes dela.
    expect(await marcarOtaAtualizada(db, c.org, await alterarSaida(duas, "2026-11-24"), equipe, minutos(30))).toEqual({ ok: true });
    await alterarSaida(duas, "2026-11-25", minutos(40));
    for (const x of [semMarca, marcada, duas]) expect((await cancelar(c, x.reservaId, empresa(), equipe, minutos(60))).resultado.ok).toBe(true);
    expect((await tarefas()).avisos.map((a) => a.texto).sort()).toEqual(
      [
        `Reserva ${semMarca.reservaCodigo}, cancelada: mude o bloqueio de 20/10 a 23/10 para Cancelado (não apague).`,
        `Reserva ${marcada.reservaCodigo}, cancelada: mude o bloqueio de 02/11 a 06/11 para Cancelado (não apague).`,
        `Reserva ${duas.reservaCodigo}, cancelada: mude o bloqueio de 20/11 a 24/11 para Cancelado (não apague).`,
      ].sort(),
    );
    expect((await daReserva(semMarca.reservaId))[0]).toMatchObject({ caso: "cancelada_bloqueio", checkin: "2026-10-20", checkout: "2026-10-23", texto: "Mude o bloqueio de 20/10 a 23/10 para Cancelado (não apague)." });
    // A reserva agora tem as datas novas; a ficha e o Início leem o mesmo texto.
    expect(await c.reserva(semMarca.reservaId)).toMatchObject({ checkin: "2026-10-20", checkout: "2026-10-24" });
  });
});

describe("teste 16: a marca manual \"Datas fechadas nas OTAs\" (D8)", () => {
  it("sem acompanhamento: cria a linha manual com o usuário e sem o quarto; a tarefa e o aviso somem; auditoria; a segunda vez recusa", async () => {
    const x = await pagarEConfirmar(c);
    expect((await daReserva(x.reservaId))[0]).toMatchObject({ caso: "paga", estado: "manual", marca: "datas_fechadas" });
    const operacao: Sessao = { ...admin, papel: "operacao" };
    expect(await marcarDatasFechadasNasOtas(db, operacao, x.reservaId, env(), minutos(30))).toEqual({ ok: true });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "manual", motivo: null, otaFechadaEm: minutos(30), otaFechadaPor: equipe, roomId: null, propertyId: null, versao: 0, esperado: null, referencia: x.reservaCodigo, imovelId: c.imovel });
    expect(await tarefas()).toEqual({ tarefas: [], atencoes: [], avisos: [] });
    const [registro] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.ota_fechada")));
    expect(registro).toMatchObject({ usuarioId: equipe, entidade: "reserva", entidadeId: x.reservaId, mudancas: { otaFechadaEm: [null, minutos(30).toISOString()], situacaoNoBeds24: [null, "manual"] } });
    expect(await marcarDatasFechadasNasOtas(db, admin, x.reservaId, env(), minutos(31))).toEqual({ ok: false, erro: "As datas já foram marcadas como fechadas em 01/10." });
    // Depois da marca: o "Simular" diz que a equipe cuida à mão; a importação só grava a leitura e a marca fica.
    expect(chaveDoResultadoDaSimulacao(await simularReservaNoBeds24(db, admin, x.reservaId, env(), minutos(32)))).toBe("nada_manual");
    expect(await conferirNaImportacao(db, c.org, x.reservaId, null, minutos(33))).toEqual({ resultado: "lido" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "manual", otaFechadaEm: minutos(30), otaFechadaPor: equipe, lidoEm: minutos(33) });
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("com acompanhamento: o pendente sem operação vira manual (motivo vazio); o manual guarda o motivo dele", async () => {
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    await novaLinha(x, { situacao: "pendente", motivo: "sem_vinculo" });
    await novaLinha(y, { situacao: "manual", motivo: "anterior_a_ligar" });
    expect(await marcarDatasFechadasNasOtas(db, admin, x.reservaId, env(), minutos(30))).toEqual({ ok: true });
    expect(await marcarDatasFechadasNasOtas(db, admin, y.reservaId, env(), minutos(30))).toEqual({ ok: true });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "manual", motivo: null, otaFechadaPor: equipe });
    expect(await acompanhamento(y.reservaId)).toMatchObject({ situacao: "manual", motivo: "anterior_a_ligar", otaFechadaPor: equipe });
    const [registro] = await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, x.reservaId), eq(auditoria.acao, "beds24.reserva.ota_fechada")));
    expect(registro.mudancas).toMatchObject({ situacaoNoBeds24: ["pendente", "manual"] });
  });

  it("recusa: envio em curso ou na fila, conferida, conflito, criada pelo sistema, pedido, cancelada, estadia que passou, outra empresa, a trava ocupada", async () => {
    const x = await pagarEConfirmar(c);
    for (const situacao of ["enviando", "incerta", "pendente"] as const) {
      const [op] = await db.insert(beds24ReservasOperacoes).values({ organizacaoId: c.org, reservaId: x.reservaId, tipo: "criar", chave: `criar:${x.reservaId}:${situacao}`, modo: "real", situacao }).returning();
      expect(await marcarDatasFechadasNasOtas(db, admin, x.reservaId, env(), minutos(30))).toEqual({ ok: false, erro: ERRO_MARCA_EM_ENVIO });
      await db.delete(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.id, op.id));
    }
    await novaLinha(x, { situacao: "conferida" });
    expect(await marcarDatasFechadasNasOtas(db, admin, x.reservaId, env(), minutos(30))).toEqual({ ok: false, erro: ERRO_NADA_A_FECHAR });
    await db.update(beds24ReservasSite).set({ situacao: "conflito", motivo: "noites_ocupadas" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    expect(await marcarDatasFechadasNasOtas(db, admin, x.reservaId, env(), minutos(30))).toEqual({ ok: false, erro: ERRO_NADA_A_FECHAR });
    // Criada pelo sistema (o quarto guardado e o id), ainda sem a marca: o sistema está nela.
    await db.update(beds24ReservasSite).set({ situacao: "pendente", motivo: null, roomId: "20", propertyId: "10" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    await db.update(reservas).set({ beds24Id: "90001" }).where(eq(reservas.id, x.reservaId));
    expect(await marcarDatasFechadasNasOtas(db, admin, x.reservaId, env(), minutos(30))).toEqual({ ok: false, erro: ERRO_MARCA_EM_ENVIO });
    // Nem à mão nem com um motivo de configuração: a reserva já está no Beds24 (nunca "feche como bloqueio" por cima).
    for (const [situacao, motivo] of [["manual", "deixada_a_mao"], ["pendente", "sem_vinculo"]] as const) {
      await db.update(beds24ReservasSite).set({ situacao, motivo }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
      expect(await marcarDatasFechadasNasOtas(db, admin, x.reservaId, env(), minutos(30))).toEqual({ ok: false, erro: ERRO_MARCA_EM_ENVIO });
      expect((await daReserva(x.reservaId, minutos(30))).map((t) => [t.caso, t.marca])).toEqual([["paga", null]]);
    }
    // O pedido com as datas seguradas (D9), a cancelada, a estadia que já passou.
    const hold = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "hold@example.com" });
    expect(await marcarDatasFechadasNasOtas(db, admin, hold.reservaId, env(), minutos(30))).toEqual({ ok: false, erro: ERRO_NADA_A_FECHAR });
    const y = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23", email: "y@example.com" });
    await cancelar(c, y.reservaId, empresa(), equipe, minutos(60));
    expect(await marcarDatasFechadasNasOtas(db, admin, y.reservaId, env(), minutos(70))).toEqual({ ok: false, erro: ERRO_NADA_A_FECHAR });
    const z = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "z@example.com" });
    expect(await marcarDatasFechadasNasOtas(db, admin, z.reservaId, env(), new Date("2026-10-23T15:00:00Z"))).toEqual({ ok: false, erro: ERRO_NADA_A_FECHAR });
    // Outra empresa: a reserva não é dela. A trava ocupada: nada muda.
    expect(await marcarDatasFechadasNasOtas(db, { ...admin, organizacaoId: crypto.randomUUID() }, z.reservaId, env(), minutos(30))).toEqual({ ok: false, erro: "Reserva do site não encontrada." });
    trava.ocupada = true;
    expect(await marcarDatasFechadasNasOtas(db, admin, z.reservaId, env(), minutos(30))).toEqual({ ok: false, erro: ERRO_MARCA_TRAVA_OCUPADA });
    trava.ocupada = false;
    expect(await acompanhamento(z.reservaId)).toBeUndefined();
    expect(await marcarDatasFechadasNasOtas(db, admin, z.reservaId, env(), minutos(30))).toEqual({ ok: true });
    expect(await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.ota_fechada")))).toHaveLength(1);
  });

  it("permissão: reserva:editar (deny-by-default, antes de ler); id inválido", async () => {
    const x = await pagarEConfirmar(c);
    for (const papel of ["proprietario", "limpeza", "hospede"] as const) {
      await expect(marcarDatasFechadasNasOtas(db, { ...admin, papel, imovelIds: [c.imovel] }, x.reservaId, env(), minutos(30))).rejects.toBeInstanceOf(AcessoNegado);
      await expect(marcarDatasReabertasNasOtas(db, { ...admin, papel, imovelIds: [c.imovel] }, x.reservaId, env(), minutos(30))).rejects.toBeInstanceOf(AcessoNegado);
    }
    expect(await marcarDatasFechadasNasOtas(db, admin, "nao-e-uuid", env(), minutos(30))).toEqual({ ok: false, erro: "Reserva do site não encontrada." });
    expect(await acompanhamento(x.reservaId)).toBeUndefined();
  });
});

describe("teste 17: D3, o pedido confirmado à mão sem pagamento", () => {
  it("aparece em \"feche as datas\", nunca vai ao envio (nem com a chave, o imóvel ligado e uma linha pendente), e a marca vale", async () => {
    const h = await d3();
    expect(await tarefas()).toMatchObject({
      tarefas: [{ reservaId: h.reservaId, caso: "d3", estado: "manual", marca: "datas_fechadas", texto: textoDaTarefa({ caso: "d3", codigo: h.reservaCodigo, checkin: "2026-10-12", checkout: "2026-10-15" }) }],
      avisos: [{ nivel: "info", texto: `1 reserva(s) do site confirmada(s) à mão, sem pagamento pelo site (${h.reservaCodigo}): feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.`, link: `/painel/reservas/${h.reservaId}` }],
    });
    await ligarImovel();
    await novaLinha(h, { situacao: "pendente" });
    for (const agora of [minutos(10), minutos(100)]) expect((await daReserva(h.reservaId, agora, PRONTO)).map((t) => t.estado)).toEqual(["manual"]);
    expect((await textos(minutos(10), PRONTO)).join("\n")).not.toContain("sendo enviadas");
    expect(await marcarDatasFechadasNasOtas(db, admin, h.reservaId, PRONTO, minutos(30))).toEqual({ ok: true });
    expect(await tarefas(minutos(31), PRONTO)).toEqual({ tarefas: [], atencoes: [], avisos: [] });
    // A régua continua a mesma: sem pagamento pelo site, nada a enviar (antes do "manual" da marca).
    expect(await simularReservaNoBeds24(db, admin, h.reservaId, env(), minutos(32))).toEqual({ ok: false, motivo: "sem_pagamento" });
    expect(await db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.organizacaoId, c.org))).toEqual([]);
  });

  it("a reserva do site cujo único pagamento tem outro desfecho (a diferença de uma alteração) também é D3", async () => {
    const x = await pagarEConfirmar(c);
    await db.update(pagamentos).set({ desfecho: "alteracao" }).where(eq(pagamentos.reservaId, x.reservaId));
    expect((await daReserva(x.reservaId)).map((t) => t.caso)).toEqual(["d3"]);
  });

  it("D3 marcada e cancelada pelo \"Cancelar reserva\" comum: \"mude o bloqueio para Cancelado\" até \"Datas reabertas nas OTAs\"; sem a marca, nada", async () => {
    const h = await d3();
    const semMarca = await d3("2026-11-02", "2026-11-05");
    expect(await marcarDatasReabertasNasOtas(db, admin, h.reservaId, env(), minutos(20))).toEqual({ ok: false, erro: ERRO_NADA_A_REABRIR });
    expect(await marcarDatasFechadasNasOtas(db, admin, h.reservaId, env(), minutos(20))).toEqual({ ok: true });
    expect(await cancelarReserva(db, c.org, h.reservaId, equipe, { agora: minutos(40) })).toBe(true);
    expect(await cancelarReserva(db, c.org, semMarca.reservaId, equipe, { agora: minutos(40) })).toBe(true);
    const t = await tarefas(minutos(50));
    expect(t.tarefas).toEqual([
      { reservaId: h.reservaId, codigo: h.reservaCodigo, caso: "d3_cancelada", estado: "manual", checkin: "2026-10-12", checkout: "2026-10-15", desde: minutos(40), alteracaoIds: [], texto: "Mude o bloqueio de 12/10 a 15/10 para Cancelado (não apague).", marca: "datas_reabertas" },
    ]);
    expect(t.avisos).toEqual([{ nivel: "info", texto: `Reserva ${h.reservaCodigo}, cancelada: mude o bloqueio de 12/10 a 15/10 para Cancelado (não apague).`, link: `/painel/reservas/${h.reservaId}` }]);
    expect(await marcarDatasFechadasNasOtas(db, admin, h.reservaId, env(), minutos(55))).toMatchObject({ ok: false });
    expect(await marcarDatasReabertasNasOtas(db, { ...admin, papel: "operacao" }, h.reservaId, env(), minutos(60))).toEqual({ ok: true });
    expect(await acompanhamento(h.reservaId)).toMatchObject({ situacao: "encerrada", motivo: null, otaFechadaEm: minutos(20) });
    expect(await tarefas(minutos(61))).toEqual({ tarefas: [], atencoes: [], avisos: [] });
    const [registro] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "beds24.reserva.ota_reaberta")));
    expect(registro).toMatchObject({ usuarioId: equipe, entidade: "reserva", entidadeId: h.reservaId, mudancas: { situacaoNoBeds24: ["manual", "encerrada"] } });
    expect(await marcarDatasReabertasNasOtas(db, admin, h.reservaId, env(), minutos(62))).toEqual({ ok: false, erro: "As datas já foram marcadas como reabertas nas OTAs." });
    // Cancelada à mão sem a marca das datas fechadas: nada a reabrir nem aviso (o limite registrado no desenho e no guia).
    expect(await marcarDatasReabertasNasOtas(db, admin, semMarca.reservaId, env(), minutos(62))).toEqual({ ok: false, erro: ERRO_NADA_A_REABRIR });
    expect(await semDadosDoHospede(db)).toEqual([]);
  });
});

describe("teste 18: a carência do envio automático", () => {
  it("pendente há 10 min: o informativo, sem a tarefa manual; há 31 min: \"atrasadas\"; com conflito, só a atenção", async () => {
    await ligarImovel();
    const x = await pagarEConfirmar(c);
    await novaLinha(x, { situacao: "pendente" });
    const [p] = await db.select({ desfechoEm: pagamentos.desfechoEm }).from(pagamentos).where(and(eq(pagamentos.reservaId, x.reservaId), eq(pagamentos.desfecho, "reserva")));
    const desde = p.desfechoEm!;
    const aos10 = await tarefas(minutos(10, desde), PRONTO);
    expect(aos10.tarefas).toMatchObject([{ reservaId: x.reservaId, caso: "paga", estado: "sendo_enviada", desde, marca: null }]);
    expect(aos10.avisos).toEqual([{ nivel: "info", texto: "1 reserva(s) do site sendo enviadas pelo sistema: não feche à mão.", link: `/painel/reservas/${x.reservaId}` }]);
    expect(await marcarDatasFechadasNasOtas(db, admin, x.reservaId, PRONTO, minutos(10, desde))).toEqual({ ok: false, erro: ERRO_MARCA_EM_ENVIO });
    const aos31 = await tarefas(minutos(CARENCIA_ENVIO_RESERVA_MINUTOS + 1, desde), PRONTO);
    expect(aos31.tarefas.map((t) => t.estado)).toEqual(["atrasada"]);
    expect(aos31.avisos).toEqual([{ nivel: "atencao", texto: `1 reserva(s) do site com o envio ao Beds24 atrasado (${x.reservaCodigo}): confira na ficha.`, link: `/painel/reservas/${x.reservaId}` }]);
    // Conflito: só a atenção (nunca "feche como bloqueio" sobre noites já ocupadas), nem informativo nem tarefa.
    await db.update(beds24ReservasSite).set({ situacao: "conflito", motivo: "noites_ocupadas" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    for (const e of [PRONTO, env()]) {
      const t = await tarefas(minutos(10, desde), e);
      expect(t.tarefas).toEqual([]);
      expect(t.atencoes).toEqual([{ reservaId: x.reservaId, codigo: x.reservaCodigo, tipo: "conflito" }]);
      expect(t.avisos).toEqual([{ nivel: "atencao", texto: `Reserva ${x.reservaCodigo}: as noites estão ocupadas por outra reserva no Beds24 (possível venda dupla). Veja a ficha.`, link: `/painel/reservas/${x.reservaId}` }]);
    }
    // Divergente, aguardando a equipe e o bloqueio feito à mão sobre as noites (a transição, informativa).
    for (const [situacao, motivo, nivel, texto] of [
      ["divergente", "mudada_no_beds24", "atencao", `Reserva ${x.reservaCodigo} está diferente no Beds24: veja a ficha.`],
      ["aguardando_equipe", "incerta", "atencao", `Reserva ${x.reservaCodigo} aguarda a equipe no Beds24: veja a ficha.`],
      ["aguardando_equipe", "bloqueio_manual", "info", `Reserva ${x.reservaCodigo}: há um bloqueio feito à mão sobre as noites no Beds24, e o sistema não cria por cima: veja a ficha.`],
    ] as const) {
      await db.update(beds24ReservasSite).set({ situacao, motivo }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
      expect((await tarefas(minutos(10, desde), PRONTO)).avisos).toEqual([{ nivel, texto, link: `/painel/reservas/${x.reservaId}` }]);
    }
    // Um motivo de configuração não é atenção por reserva: fica à mão (o aviso único é do M8.3c).
    await db.update(beds24ReservasSite).set({ situacao: "pendente", motivo: "sem_vinculo" }).where(eq(beds24ReservasSite.reservaId, x.reservaId));
    expect((await daReserva(x.reservaId, minutos(10, desde), PRONTO)).map((t) => t.estado)).toEqual(["manual"]);
  });

  it("a pausa ou a chave desligada voltam ao manual; o imóvel desligado só para a criação (a cancelada criada pelo sistema segue automática)", async () => {
    await ligarImovel();
    const x = await pagarEConfirmar(c);
    await novaLinha(x, { situacao: "pendente" });
    expect((await daReserva(x.reservaId, minutos(15), PRONTO)).map((t) => t.estado)).toEqual(["sendo_enviada"]);
    expect((await daReserva(x.reservaId, minutos(15), env())).map((t) => t.estado)).toEqual(["manual"]);
    expect((await daReserva(x.reservaId, minutos(15), env({ ...PRONTO, VERCEL_ENV: "preview" }))).map((t) => t.estado)).toEqual(["manual"]);
    await ligarImovel("2026-09-01T00:00:00.000Z", { em: minutos(14).toISOString(), por: equipe });
    expect((await daReserva(x.reservaId, minutos(15), PRONTO)).map((t) => t.estado)).toEqual(["manual"]);
    // O imóvel desligado: a criação da paga para; o cancelamento da reserva que o sistema criou segue (só a pausa o para).
    await gravarConfig(db, c.org, "reservas_beds24", { pausado: null, imoveis: [], ensaio: null }, null);
    expect((await daReserva(x.reservaId, minutos(15), PRONTO)).map((t) => t.estado)).toEqual(["manual"]);
    const y = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    await db.update(reservas).set({ beds24Id: "90001" }).where(eq(reservas.id, y.reservaId));
    await novaLinha(y, { propertyId: "10", roomId: "20", situacao: "conferida", otaFechadaEm: minutos(10) });
    await cancelar(c, y.reservaId, empresa(), equipe, minutos(60));
    expect(await daReserva(y.reservaId, minutos(70), PRONTO)).toMatchObject([{ caso: "cancelada_criada", estado: "sendo_enviada", desde: minutos(60) }]);
    expect(await daReserva(y.reservaId, minutos(91), PRONTO)).toMatchObject([{ caso: "cancelada_criada", estado: "atrasada" }]);
    expect(await daReserva(y.reservaId, minutos(70), env())).toMatchObject([{ caso: "cancelada_criada", estado: "manual", texto: `No Beds24, mude a reserva ${y.reservaCodigo} para Cancelado (não apague).` }]);
    await gravarConfig(db, c.org, "reservas_beds24", { pausado: { em: minutos(65).toISOString(), por: equipe }, imoveis: [], ensaio: null }, null);
    expect(await daReserva(y.reservaId, minutos(70), PRONTO)).toMatchObject([{ caso: "cancelada_criada", estado: "manual" }]);
  });

  it("sem acompanhamento ainda: a régua diz (criar = sendo enviada; confirmada antes de ligar ou ligada a outro registro, não); envio em curso nunca é manual", async () => {
    await ligarImovel();
    const x = await pagarEConfirmar(c);
    expect(await daReserva(x.reservaId, minutos(15), PRONTO)).toMatchObject([{ caso: "paga", estado: "sendo_enviada", marca: null }]);
    // Confirmada antes da ligação (D6): fica com a equipe, à mão.
    await ligarImovel(minutos(60).toISOString());
    expect(await daReserva(x.reservaId, minutos(70), PRONTO)).toMatchObject([{ caso: "paga", estado: "manual", marca: "datas_fechadas" }]);
    // Ligada a um registro do Beds24 que o sistema não criou: só a atenção, sem a marca.
    await ligarImovel();
    await db.update(reservas).set({ beds24Id: "90009" }).where(eq(reservas.id, x.reservaId));
    const t = await tarefas(minutos(15), PRONTO);
    expect(t.tarefas).toEqual([]);
    expect(t.avisos).toEqual([{ nivel: "atencao", texto: `Reserva ${x.reservaCodigo} está ligada a um registro do Beds24 que o sistema não criou: veja a ficha.`, link: `/painel/reservas/${x.reservaId}` }]);
    expect(await marcarDatasFechadasNasOtas(db, admin, x.reservaId, PRONTO, minutos(15))).toEqual({ ok: false, erro: ERRO_NADA_A_FECHAR });
    // Um envio real sem conclusão: o sistema está nele, mesmo com a chave desligada (nunca "feche como bloqueio" por cima).
    await db.update(reservas).set({ beds24Id: null }).where(eq(reservas.id, x.reservaId));
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: c.org, reservaId: x.reservaId, tipo: "criar", chave: `criar:${x.reservaId}:1`, modo: "real", situacao: "incerta" });
    expect((await daReserva(x.reservaId, minutos(15), env())).map((t) => t.estado)).toEqual(["sendo_enviada"]);
    expect((await daReserva(x.reservaId, minutos(120), env())).map((t) => t.estado)).toEqual(["atrasada"]);
  });

  it("a criação que o sistema está enviando leva as datas de agora: a alteração dela não é outra tarefa (com a chave desligada, as duas à mão)", async () => {
    await ligarImovel();
    const z = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "z@example.com", liberar: true });
    await novaLinha(z, { situacao: "pendente" });
    await alterarSaida(z, "2026-10-24");
    const enviando = await daReserva(z.reservaId, minutos(40), PRONTO);
    expect(enviando.map((t) => t.caso)).toEqual(["paga"]);
    expect(enviando[0].estado).not.toBe("manual");
    expect((await textos(minutos(40), PRONTO)).join("\n")).not.toContain("alterada");
    expect((await daReserva(z.reservaId, minutos(40), env())).map((t) => [t.caso, t.estado])).toEqual([["paga", "manual"], ["alterada_bloqueio", "manual"]]);
    // Cancelada antes de sair (o acompanhamento ainda pendente): o sistema é dono da criação; com o imóvel desligado, à mão.
    await cancelar(c, z.reservaId, empresa(), equipe, minutos(60));
    expect(await daReserva(z.reservaId, minutos(70), PRONTO)).toMatchObject([{ caso: "cancelada_bloqueio", estado: "sendo_enviada" }]);
    await gravarConfig(db, c.org, "reservas_beds24", { pausado: null, imoveis: [], ensaio: null }, null);
    expect(await daReserva(z.reservaId, minutos(70), PRONTO)).toMatchObject([{ caso: "cancelada_bloqueio", estado: "manual" }]);
  });

  it("a classificação, na ordem da seção 6.1 (pura)", () => {
    const e = (o: Partial<EntradaDaTarefaOta> = {}): EntradaDaTarefaOta => ({ fato: "paga", criada: false, acompanhamento: null, emCurso: false, desligada: [], regua: null, desde: minutos(0), agora: minutos(10), ...o });
    const linha = (situacao: NonNullable<EntradaDaTarefaOta["acompanhamento"]>["situacao"], motivo: NonNullable<EntradaDaTarefaOta["acompanhamento"]>["motivo"] = null, otaFechadaEm: Date | null = null) => ({ acompanhamento: { situacao, motivo, otaFechadaEm } });
    expect(classificarTarefa(e(linha("manual", null, minutos(1))))).toEqual({ tipo: "nada" });
    expect(classificarTarefa(e(linha("conferida")))).toEqual({ tipo: "nada" });
    expect(classificarTarefa(e({ fato: "cancelada", criada: true, ...linha("conferida") }))).toEqual({ tipo: "tarefa", caso: "cancelada_criada", estado: "sendo_enviada" });
    expect(classificarTarefa(e(linha("conflito", "noites_ocupadas")))).toEqual({ tipo: "atencao", atencao: "conflito" });
    expect(classificarTarefa(e({ fato: "d3", emCurso: true }))).toEqual({ tipo: "tarefa", caso: "d3", estado: "manual" });
    expect(classificarTarefa(e({ emCurso: true, desligada: ["chave"], agora: minutos(31) }))).toEqual({ tipo: "tarefa", caso: "paga", estado: "atrasada" });
    expect(classificarTarefa(e(linha("pendente", "sem_ensaio")))).toEqual({ tipo: "tarefa", caso: "paga", estado: "manual" });
    expect(classificarTarefa(e({ desligada: ["pausa"] }))).toEqual({ tipo: "tarefa", caso: "paga", estado: "manual" });
    expect(classificarTarefa(e({ desligada: ["imovel"] }))).toEqual({ tipo: "tarefa", caso: "paga", estado: "manual" });
    expect(classificarTarefa(e())).toEqual({ tipo: "regua" });
    expect(classificarTarefa(e({ regua: "criar" }))).toEqual({ tipo: "tarefa", caso: "paga", estado: "sendo_enviada" });
    expect(classificarTarefa(e({ regua: "outra" }))).toEqual({ tipo: "tarefa", caso: "paga", estado: "manual" });
    expect(classificarTarefa(e({ fato: "alterada", desligada: ["imovel"] }))).toEqual({ tipo: "tarefa", caso: "alterada_bloqueio", estado: "manual" });
    expect(classificarTarefa(e({ fato: "alterada", criada: true, desligada: ["imovel"] }))).toEqual({ tipo: "tarefa", caso: "alterada_criada", estado: "sendo_enviada" });
    // A paga criada pelo sistema, ainda sem a marca: nunca a tarefa de fechar como bloqueio; a atenção vale com qualquer motivo.
    expect(classificarTarefa(e({ criada: true, ...linha("divergente", "marca_ilegivel") }))).toEqual({ tipo: "atencao", atencao: "divergente" });
    expect(classificarTarefa(e({ criada: true, ...linha("aguardando_equipe", "sem_vinculo") }))).toEqual({ tipo: "atencao", atencao: "aguardando_equipe" });
    expect(classificarTarefa(e({ criada: true, ...linha("aguardando_equipe", "bloqueio_manual") }))).toEqual({ tipo: "atencao", atencao: "transicao" });
    expect(classificarTarefa(e({ criada: true, ...linha("pendente", "sem_vinculo") }))).toEqual({ tipo: "tarefa", caso: "paga", estado: "sendo_enviada" });
    expect(classificarTarefa(e({ criada: true, ...linha("manual", "deixada_a_mao"), desligada: ["chave"], agora: minutos(31) }))).toEqual({ tipo: "tarefa", caso: "paga", estado: "atrasada" });
    expect(classificarTarefa(e({ criada: true, ...linha("encerrada") }))).toEqual({ tipo: "nada" });
    expect(classificarTarefa(e({ criada: true, ...linha("pendente", null, minutos(1)) }))).toEqual({ tipo: "nada" });
    // A criação que espera o envio, cancelada ou alterada antes de sair: o sistema é dono dela (o imóvel ligado); o bloqueio à mão, não.
    expect(classificarTarefa(e({ fato: "cancelada", ...linha("pendente") }))).toEqual({ tipo: "tarefa", caso: "cancelada_bloqueio", estado: "sendo_enviada" });
    expect(classificarTarefa(e({ fato: "cancelada", ...linha("pendente"), desligada: ["imovel"] }))).toEqual({ tipo: "tarefa", caso: "cancelada_bloqueio", estado: "manual" });
    expect(classificarTarefa(e({ fato: "cancelada", ...linha("pendente"), desligada: ["chave"] }))).toEqual({ tipo: "tarefa", caso: "cancelada_bloqueio", estado: "manual" });
    expect(classificarTarefa(e({ fato: "cancelada", ...linha("manual", null, minutos(1)) }))).toEqual({ tipo: "tarefa", caso: "cancelada_bloqueio", estado: "manual" });
    expect(classificarTarefa(e({ fato: "alterada", ...linha("pendente"), agora: minutos(31) }))).toEqual({ tipo: "tarefa", caso: "alterada_bloqueio", estado: "atrasada" });
    expect(classificarTarefa(e({ fato: "cancelada" }))).toEqual({ tipo: "tarefa", caso: "cancelada_bloqueio", estado: "manual" });
  });
});
