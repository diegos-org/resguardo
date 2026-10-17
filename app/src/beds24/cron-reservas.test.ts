/**
 * Reserva paga do site no Beds24 (M8.3c) — a rotina (desenho 2.4, 7 e 9; plano 1.9, 1.10, testes 32 e 34 e os extras de
 * prévia e de zero `fetch`): o deploy de produção como única porta, as janelas registradas como sucesso, o passo 0 só de
 * leitura com a chave desligada ou a pausa, a leitura dos escopos no começo da volta, os atrasos e a 5ª falha com o e-mail, as
 * paradas, o resumo só de números e o horário em `vercel.json`. PGlite, os cenários do pagamento, o Beds24 falso,
 * `CorreioMemoria` e um espião de `fetch` que nunca é chamado: nada vai ao Beds24. O `env` é sempre explícito, e o cliente e
 * o leitor são o falso injetado (as fábricas do ambiente nunca são chamadas aqui).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { gravarConfig } from "@/configuracoes/armazem";
import { beds24ReservasOperacoes, beds24ReservasRotina, beds24ReservasSite, execucoesAutomacao } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { type Cenario, EMAIL_HOSPEDE, env, minutos, montarCenario, NOME_HOSPEDE, pagarEConfirmar, semDadosPessoais, TELEFONE_HOSPEDE } from "@/pagamentos/testes";
import { ultimasExecucoes } from "@/sistema/automacoes";
import { executarCronReservasBeds24, HORARIO_CRON_RESERVAS, type OpcoesDaRotinaBeds24, TEXTO_FORA_DA_PRODUCAO } from "./cron-reservas";
import { Beds24Falso, ESCOPOS_ESPERADOS_FALSO } from "./falso";
import { impressaoCredencialBeds24 } from "./http";
import { dentroDeJanela, JANELAS_SEM_OPERACAO_NOVA_UTC } from "./reservas-site-regras";
import { gravarEscoposLidos, lerEstadoRotina } from "./reservas-site-rotina";
import { tarefasDasOtas } from "./reservas-site-tarefas";
import { ErroBeds24 } from "./tipos";
import { JANELA_RESERVA_EM_ANDAMENTO_MINUTOS } from "./trava";

const VALORES_PRONTO = { VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-ficticio" };
const CREDENCIAL = impressaoCredencialBeds24(env(VALORES_PRONTO));
const ENSAIO = { credencial: CREDENCIAL, em: "2026-09-01T00:00:00.000Z", operacaoId: "6f1c2a7e-3b4d-4c5e-8f90-123456789abc" };
const EMAIL_EQUIPE = "equipe@example.com";
type Obj = Record<string, unknown>;

let db: Db, close: () => Promise<void>, c: Cenario, falso: Beds24Falso, correio: CorreioMemoria;
/** O deploy de produção com a chave das reservas e o refresh token (fictício), e a organização deste cenário. */
let PRONTO: NodeJS.ProcessEnv;
/** O mesmo deploy com a chave das reservas desligada (o refresh token continua: só lê). */
let DESLIGADO: NodeJS.ProcessEnv;
let espiao: ReturnType<typeof vi.spyOn>;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  espiao = vi.spyOn(globalThis, "fetch");
  c = await montarCenario(db);
  // O banco dos testes tem uma organização por cenário: a rotina atende a deste.
  PRONTO = env({ ...VALORES_PRONTO, BEDS24_ORGANIZACAO_ID: c.org });
  DESLIGADO = env({ ...VALORES_PRONTO, BEDS24_ESCRITA_RESERVAS: "", BEDS24_ORGANIZACAO_ID: c.org });
  falso = new Beds24Falso(() => minutos(10));
  falso.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Studio" }] }];
  falso.calendarios = [{ roomId: 20, calendar: dias() }];
  correio = new CorreioMemoria();
  await configurar();
  await gravarEscoposLidos(db, c.org, CREDENCIAL, { escopos: [...ESCOPOS_ESPERADOS_FALSO], ilegiveis: [] }, minutos(0));
  await gravarConfig(db, c.org, "empresa", { email: EMAIL_EQUIPE }, null);
});
afterEach(() => {
  // Nenhuma volta chega à rede: o cliente e o leitor são o falso.
  expect(espiao).not.toHaveBeenCalled();
  espiao.mockRestore();
});

function dias() {
  const l: Obj[] = [];
  for (let d = "2026-10-01"; d <= "2026-11-30"; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) l.push({ from: d, to: d, numAvail: 1, price1: 450 });
  return l;
}
const configurar = (o: { pausado?: boolean } = {}) =>
  gravarConfig(db, c.org, "reservas_beds24", { pausado: o.pausado ? { em: minutos(0).toISOString(), por: null } : null, retomado: null, imoveis: [{ imovelId: c.imovel, ligadoEm: "2026-09-01T00:00:00.000Z", ligadoPor: null }], ensaio: ENSAIO }, null);
/** Uma volta da rotina no instante `agora`, com o falso como cliente e leitor (salvo `o`). */
const volta = (agora: Date, e: NodeJS.ProcessEnv = PRONTO, o: Partial<OpcoesDaRotinaBeds24> & { restanteMs?: number } = {}) =>
  executarCronReservasBeds24(db, e, { cliente: falso, leitor: falso, correio, relogio: { agora: () => agora, restanteMs: () => o.restanteMs ?? 240_000 }, ...o });
const operacoes = (reservaId: string) => db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.reservaId, reservaId)).orderBy(asc(beds24ReservasOperacoes.chave));
const acompanhamento = async (reservaId: string) => (await db.select().from(beds24ReservasSite).where(eq(beds24ReservasSite.reservaId, reservaId)))[0];
const ultima = async () => (await ultimasExecucoes(db)).get("reservas-beds24");
/** As linhas das tabelas do M8.3 desta organização (o acompanhamento, as operações e o estado da rotina). */
async function linhasDoM83() {
  const a = await db.select({ id: beds24ReservasSite.id }).from(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, c.org));
  const o = await db.select({ id: beds24ReservasOperacoes.id }).from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.organizacaoId, c.org));
  const r = await db.select().from(beds24ReservasRotina).where(eq(beds24ReservasRotina.organizacaoId, c.org));
  return { acompanhamentos: a.length, operacoes: o.length, rotina: r };
}
const semDados = () => semDadosPessoais(db, [EMAIL_HOSPEDE, TELEFONE_HOSPEDE], { nomes: [NOME_HOSPEDE], correio });

describe("extra: nunca nas prévias, nunca na rede", () => {
  it("fora do deploy de produção (a prévia, o vercel dev, o computador), com a chave e o refresh token: zero leituras, zero POSTs, zero linhas novas", async () => {
    const x = await pagarEConfirmar(c);
    const antes = await linhasDoM83();
    const execucoes = (await db.select({ id: execucoesAutomacao.id }).from(execucoesAutomacao).where(eq(execucoesAutomacao.nome, "reservas-beds24"))).length;
    for (const e of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, { NODE_ENV: "development" }, { VERCEL_ENV: "" }]) {
      expect(await volta(minutos(10), env({ ...VALORES_PRONTO, BEDS24_ORGANIZACAO_ID: c.org, ...e }))).toBe(TEXTO_FORA_DA_PRODUCAO);
    }
    expect(falso.chamadas).toBe(0);
    expect(falso.escritasReservas).toEqual([]);
    expect(await linhasDoM83()).toEqual(antes);
    expect(await acompanhamento(x.reservaId)).toBeUndefined();
    // Nem o registro da execução: nada roda ali.
    expect((await db.select({ id: execucoesAutomacao.id }).from(execucoesAutomacao).where(eq(execucoesAutomacao.nome, "reservas-beds24"))).length).toBe(execucoes);
  });
});

describe("teste 34: as janelas da importação e do envio diários", () => {
  it("9:05, 9:29 e 9:50 não fazem nada e ficam registradas como sucesso (nunca 'não rodou'); 9:04 faz", async () => {
    await pagarEConfirmar(c);
    for (const [hora, texto] of [["09:05", "da importação diária"], ["09:29", "da importação diária"], ["09:50", "do envio diário"], ["10:14", "do envio diário"]] as const) {
      expect(await volta(new Date(`2026-10-02T${hora}:00Z`))).toBe(`Nada feito: janela ${texto} do Beds24.`);
      expect(await ultima()).toMatchObject({ ok: true, resumo: `Nada feito: janela ${texto} do Beds24.` });
    }
    expect(falso.chamadas).toBe(0);
    expect(await volta(new Date("2026-10-02T09:04:00Z"))).toContain("1 criada(s)");
    expect(falso.escritasReservas).toHaveLength(1);
  });

  it("o horário em vercel.json: a rota de 10 em 10 minutos, fora dos minutos de qualquer outra rotina, e as janelas cobrem a importação (9:15) e o envio (10:00)", async () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
    const nossa = vercel.crons.filter((x) => x.path === "/api/cron/beds24-reservas");
    expect(nossa).toEqual([{ path: "/api/cron/beds24-reservas", schedule: HORARIO_CRON_RESERVAS }]);
    expect(HORARIO_CRON_RESERVAS).toBe("2,12,22,32,42,52 * * * *");
    /** Os minutos de um campo de cron (`*`, `*\/n`, `a,b`, `a-b` e números). */
    const minutosDe = (campo: string): number[] =>
      campo.split(",").flatMap((p) => {
        const [faixa, passo] = p.split("/");
        const [de, ate] = faixa === "*" ? [0, 59] : faixa.includes("-") ? faixa.split("-").map(Number) : [Number(faixa), passo ? 59 : Number(faixa)];
        return Array.from({ length: ate - de + 1 }, (_, i) => de + i).filter((m) => (m - de) % Number(passo ?? 1) === 0);
      });
    const nossos = minutosDe(HORARIO_CRON_RESERVAS.split(" ")[0]);
    expect(nossos).toEqual([2, 12, 22, 32, 42, 52]);
    for (const outra of vercel.crons.filter((x) => x.path !== "/api/cron/beds24-reservas")) {
      expect(minutosDe(outra.schedule.split(" ")[0]).filter((m) => nossos.includes(m)), outra.path).toEqual([]);
    }
    // As duas rotinas diárias do Beds24 caem dentro de uma janela, com folga antes (a operação de 6 min termina antes) e depois
    // (a rotina diária tem até 5 min).
    const minutoDoDia = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    for (const [caminho, de] of [["/api/cron/beds24", "importacao"], ["/api/cron/beds24-envio", "envio"]] as const) {
      const [m, h] = vercel.crons.find((x) => x.path === caminho)!.schedule.split(" ").map(Number);
      expect(dentroDeJanela(new Date(Date.UTC(2026, 9, 2, h, m)))).toBe(de);
      const j = JANELAS_SEM_OPERACAO_NOVA_UTC.find((x) => x.de === de)!;
      expect(minutoDoDia(j.inicio) + JANELA_RESERVA_EM_ANDAMENTO_MINUTOS).toBeLessThanOrEqual(h * 60 + m);
      expect(minutoDoDia(j.fim)).toBeGreaterThanOrEqual(h * 60 + m + 5);
    }
    // A rota tem os 300 s da função e nunca é guardada em cache.
    const rota = await import("@/app/api/cron/beds24-reservas/route");
    expect(rota.maxDuration).toBe(300);
    expect(rota.dynamic).toBe("force-dynamic");
  });
});

describe("teste 32: a chave desligada (o passo 0) só resolve com leitura", () => {
  it("cria com a chave pronta; depois, sem a chave: nenhum POST, a incerta resolvida pelo leitor injetado e a tarefa à mão da outra reserva com o código", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    expect(await volta(minutos(10))).toContain("0 criada(s)");
    falso.perderRespostaReserva = false;
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "incerta", resposta: "tempo" });
    await db.update(beds24ReservasOperacoes).set({ enviadoEm: minutos(10) }).where(eq(beds24ReservasOperacoes.reservaId, x.reservaId));
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "outra@example.com" });

    // Sem a chave: só o leitor (o cliente que a fábrica não cria), e só para o que está em curso.
    const resumo = await volta(minutos(16), DESLIGADO, { cliente: null });
    expect(resumo).toMatch(/^Só leitura \(a escrita de reservas está desligada\): 0 criada\(s\), 0 atualizada\(s\), 0 cancelada\(s\), 1 conferida\(s\), 0 aviso\(s\)\. 0 sem confirmação/);
    expect(falso.escritasReservas).toHaveLength(1);
    expect((await c.reserva(x.reservaId)).beds24Id).toBe("900001");
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "conferida" });
    // A outra reserva não ganha linha nem operação; a tarefa à mão dela leva o código.
    expect(await acompanhamento(y.reservaId)).toBeUndefined();
    expect(await operacoes(y.reservaId)).toEqual([]);
    const { tarefas, avisos } = await tarefasDasOtas(db, c.org, minutos(17), DESLIGADO);
    expect(tarefas.map((t) => [t.codigo, t.caso])).toEqual([[y.reservaCodigo, "paga"]]);
    expect(avisos.map((a) => a.texto)).toEqual([expect.stringContaining(y.reservaCodigo)]);

    // Sem nada em curso: sai sem ler nada (nem a trava, nem linha nova).
    const chamadas = falso.chamadas;
    expect(await volta(minutos(26), DESLIGADO, { cliente: null })).toBe("Nada feito: a escrita de reservas está desligada, e não há envio em curso a conferir.");
    expect(falso.chamadas).toBe(chamadas);
    expect(await semDados()).toEqual([]);
  });

  it("a pausa também: só leitura, nenhum POST, e o resumo diz por quê", async () => {
    const x = await pagarEConfirmar(c);
    await configurar({ pausado: true });
    expect(await volta(minutos(10))).toBe("Nada feito: o envio está pausado em Integrações, e não há envio em curso a conferir.");
    expect(falso.chamadas).toBe(0);
    expect(await acompanhamento(x.reservaId)).toBeUndefined();
  });

  it("com algo em curso e sem leitor (sem credencial): nada é lido, e o resumo diz que falta a credencial", async () => {
    const x = await pagarEConfirmar(c);
    falso.perderRespostaReserva = true;
    await volta(minutos(10));
    await db.update(beds24ReservasOperacoes).set({ enviadoEm: minutos(10) }).where(eq(beds24ReservasOperacoes.reservaId, x.reservaId));
    const chamadas = falso.chamadas;
    expect(await volta(minutos(16), DESLIGADO, { cliente: null, leitor: null })).toBe("Nada feito: a escrita de reservas está desligada; há envio em curso a conferir, mas sem credencial para ler o Beds24.");
    expect(falso.chamadas).toBe(chamadas);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "incerta" });
  });
});

describe("teste 34: os escopos no começo da volta", () => {
  it("lidos antes de qualquer POST quando a leitura guardada é de outra credencial (ou nunca houve), e guardados; dentro de 23 h, não lê de novo", async () => {
    await db.delete(beds24ReservasRotina).where(eq(beds24ReservasRotina.organizacaoId, c.org));
    await pagarEConfirmar(c);
    const ordem: string[] = [];
    const credencial = falso.credencial.bind(falso);
    const gravar = falso.gravarReservas.bind(falso);
    vi.spyOn(falso, "credencial").mockImplementation(async () => (ordem.push("escopos"), credencial()));
    vi.spyOn(falso, "gravarReservas").mockImplementation(async (i) => (ordem.push("POST"), gravar(i)));
    expect(await volta(minutos(10))).toContain("1 criada(s)");
    expect(ordem).toEqual(["escopos", "POST"]);
    expect(await lerEstadoRotina(db, c.org)).toMatchObject({ escopos: { situacao: "em_ordem" }, escoposCredencial: CREDENCIAL, escoposLidosEm: minutos(10) });
    await volta(minutos(20));
    expect(ordem).toEqual(["escopos", "POST"]);
  });

  it("escopo a mais na leitura do começo: nada é escrito nesta volta, e o resumo diz por quê", async () => {
    await db.delete(beds24ReservasRotina).where(eq(beds24ReservasRotina.organizacaoId, c.org));
    await pagarEConfirmar(c);
    falso.detalhesCredencial = { validToken: true, token: { scopes: [...ESCOPOS_ESPERADOS_FALSO, "all:bookings"] } };
    const resumo = await volta(minutos(10));
    expect(falso.escritasReservas).toEqual([]);
    expect(resumo).toContain("Escrita parada: a credencial tem permissões além das do convite; nada é escrito.");
    // O que importa vem primeiro e cabe nos 500 caracteres do registro em Sistema.
    expect((await ultima())?.resumo).toContain("Escrita parada: a credencial tem permissões além das do convite; nada é escrito.");
  });

  it("a leitura dos escopos que falha: nada é escrito, e a volta é registrada como falha (só o tipo vai ao aviso)", async () => {
    await db.delete(beds24ReservasRotina).where(eq(beds24ReservasRotina.organizacaoId, c.org));
    await pagarEConfirmar(c);
    vi.spyOn(falso, "credencial").mockRejectedValueOnce(new ErroBeds24("A conexão com o Beds24 foi interrompida.", "rede"));
    const erro = await volta(minutos(10)).catch((e: unknown) => e);
    expect(erro).toMatchObject({ name: "ErroDeRotina", falhas: { rede: 1 } });
    expect(falso.escritasReservas).toEqual([]);
    expect(await ultima()).toMatchObject({ ok: false, resumo: expect.stringContaining("Escrita parada: as permissões da credencial atual não foram lidas nas últimas 26 horas (ou a leitura falhou); nada é escrito.") });
  });

  it("a credencial recusada (401) na leitura dos escopos para a volta inteira, antes de qualquer leitura de reservas", async () => {
    await db.delete(beds24ReservasRotina).where(eq(beds24ReservasRotina.organizacaoId, c.org));
    await pagarEConfirmar(c);
    vi.spyOn(falso, "credencial").mockRejectedValueOnce(new ErroBeds24("Beds24 respondeu HTTP 401.", "http", 401));
    await expect(volta(minutos(10))).rejects.toMatchObject({ falhas: { http: 1 } });
    expect(falso.filtrosLidos).toEqual([]);
    expect(falso.escritasReservas).toEqual([]);
    expect((await ultima())?.resumo).toContain("Parou: o Beds24 recusou a credencial (401 ou 403).");
  });
});

describe("teste 34: as falhas, as recusas e os limites pela rotina", () => {
  it("o token que não vem: os atrasos de 10, 20, 40 e 80 min; na 5ª falha, aguardando_equipe/falhas e o e-mail; cada volta com falha fica registrada", async () => {
    const x = await pagarEConfirmar(c);
    falso.falharToken = new ErroBeds24("Falha de rede ao pedir o token (fictícia).", "rede");
    const proximas: (Date | null)[] = [];
    let agora = minutos(10);
    for (let i = 0; i < 4; i++) {
      await expect(volta(agora)).rejects.toMatchObject({ name: "ErroDeRotina", falhas: { envio_incompleto: 1 } });
      const a = await acompanhamento(x.reservaId);
      proximas.push(a.proximaTentativaEm);
      // Antes do atraso, a volta nem tenta (nenhuma falha a mais).
      expect(await volta(new Date(agora.getTime() + 60_000))).toContain("0 falha(s) antes do envio");
      agora = a.proximaTentativaEm!;
    }
    expect(proximas).toEqual([minutos(20), minutos(40), minutos(80), minutos(160)]);
    await expect(volta(agora)).rejects.toMatchObject({ falhas: { envio_incompleto: 1 } });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "falhas", tentativas: 5, proximaTentativaEm: null });
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "falhou", enviadoEm: null });
    expect(falso.escritasReservas).toEqual([]);
    // O e-mail saiu na mesma volta, depois dos commits, só para a empresa.
    expect(correio.enviadas.map((m) => [m.para, m.assunto])).toEqual([[EMAIL_EQUIPE, `Envio ao Beds24 parado: reserva ${x.reservaCodigo}`]]);
    expect((await ultima())?.resumo).toMatch(/^Falhou: Reservas do site no Beds24: 0 criada\(s\)/);
    expect(await semDados()).toEqual([]);
  });

  it("o 401 repetido no POST: a operação recusada, a equipe com sem_permissao e o e-mail, a volta parada e registrada como falha; a seguinte nem lê", async () => {
    const x = await pagarEConfirmar(c);
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "outra@example.com" });
    falso.responder401Repetido = true;
    await expect(volta(minutos(10))).rejects.toMatchObject({ falhas: { http: 1 } });
    expect(falso.escritasReservas).toHaveLength(1);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "recusada", resposta: "http_401" });
    expect(await acompanhamento(x.reservaId)).toMatchObject({ situacao: "aguardando_equipe", motivo: "sem_permissao" });
    expect(await operacoes(y.reservaId)).toEqual([]);
    expect(correio.enviadas.map((m) => m.assunto)).toEqual([`Beds24 recusou a credencial: reserva ${x.reservaCodigo}`]);
    expect((await ultima())?.resumo).toContain("Parou: o Beds24 recusou a credencial (401 ou 403).");
    // A operação recusada é terminal: a volta seguinte não busca nada dela (nem a incerteza, nem a conferência).
    falso.responder401Repetido = false;
    const lidas = falso.filtrosLidos.length;
    await volta(minutos(20));
    expect(falso.filtrosLidos.slice(lidas).filter((f) => f.chegadaExata === "2026-10-12")).toEqual([]);
    expect((await operacoes(x.reservaId))[0]).toMatchObject({ situacao: "recusada" });
  });

  it("o 429 sem a lista e o crédito abaixo de 20 param a volta (a conferência contínua fica para a próxima), sem registrar falha", async () => {
    const x = await pagarEConfirmar(c);
    falso.responder429 = true;
    expect(await volta(minutos(10))).toContain("Parou: o Beds24 respondeu 429 (limite de uso).");
    expect((await operacoes(x.reservaId)).map((o) => o.situacao)).toEqual(["falhou", "pendente"]);
    expect(await ultima()).toMatchObject({ ok: true });
    falso.responder429 = false;
    falso.creditoRestante = 19;
    const resumo = await volta(minutos(20));
    expect(resumo).toContain("1 criada(s)");
    expect(resumo).toContain("Parou: o crédito do Beds24 ficou abaixo de 20.");
    expect(resumo).not.toContain("conferência contínua");
  });

  it("com 149 s restantes nenhuma operação começa; depois dos 10 envios, a conferência contínua ainda roda", async () => {
    const x = await pagarEConfirmar(c);
    const resumo = await volta(minutos(10), PRONTO, { restanteMs: 149_000 });
    expect(resumo).toContain("0 criada(s)");
    expect(resumo).toContain("Parou: acabou o tempo da volta (o resto fica para a próxima).");
    expect(await operacoes(x.reservaId)).toEqual([]);
    expect(falso.escritasReservas).toEqual([]);
    // Uma volta inteira: cria, e a conferência contínua relê o que acabou de ser criado.
    const inteira = await volta(minutos(20));
    expect(inteira).toContain("1 criada(s)");
    expect(inteira).toContain("conferência contínua: 1 registro(s) conferido(s)");
  });

  it("'não rodou' só com a trava ocupada ou outra escrita no Beds24 em andamento", async () => {
    const x = await pagarEConfirmar(c);
    // Outra operação de reserva enviando agora (outro disparo da rotina no meio da fase 2).
    await db.insert(beds24ReservasOperacoes).values({ organizacaoId: c.org, tipo: "ensaio", chave: "ensaio:em-andamento", modo: "real", situacao: "enviando" });
    expect(await volta(minutos(10))).toMatch(/^Não rodou: outra escrita no Beds24 em andamento \(calendário ou reserva do site\)\. Reservas do site no Beds24: 0 criada\(s\)/);
    expect(await ultima()).toMatchObject({ ok: false, resumo: expect.stringMatching(/^Não rodou: /) });
    expect(await operacoes(x.reservaId)).toEqual([]);
  });

  it("o resumo é só de números e códigos fixos: nenhum código de reserva, nome, e-mail ou telefone", async () => {
    const x = await pagarEConfirmar(c);
    const resumo = await volta(minutos(10));
    expect(resumo).toBe("Reservas do site no Beds24: 1 criada(s), 0 atualizada(s), 0 cancelada(s), 1 conferida(s), 0 aviso(s). 0 sem confirmação, 0 falha(s) antes do envio, 0 em curso resolvida(s), 0 encerrada(s); conferência contínua: 1 registro(s) conferido(s); e-mails à equipe: 0 enviado(s).");
    expect(resumo).not.toContain(x.reservaCodigo);
    expect(await ultima()).toMatchObject({ ok: true, resumo });
    expect(await semDados()).toEqual([]);
  });
});
