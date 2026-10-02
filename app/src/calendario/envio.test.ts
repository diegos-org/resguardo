import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { historicoDe } from "@/auditoria/auditoria";
import { executarCronEnvioBeds24 } from "@/beds24/cron-envio";
import { Beds24Falso } from "@/beds24/falso";
import { ErroBeds24, type LeitorBeds24 } from "@/beds24/tipos";
import { gravarConfig } from "@/configuracoes/armazem";
import { beds24Calendario, beds24CalendarioEnviado, beds24EnvioNoites, bloqueios, idsExternos, imoveis, imoveisDetalhes, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { ultimasExecucoes } from "@/sistema/automacoes";
import { enviarCalendarioBeds24, noitesDoEnvio, planejarImovel, ultimosEnvios } from "./envio";
import { REGRAS_CALENDARIO_PADRAO, lerRegrasCalendario, type RegrasCalendario } from "./regras-config";

let db: Db, close: () => Promise<void>, org: string, im: string, beds: Beds24Falso;
// 1/10/2026 (quinta) 09:00 em São Paulo.
const agora = new Date("2026-10-01T12:00:00Z");
const regras = (over: Partial<RegrasCalendario> = {}): RegrasCalendario => ({ ...REGRAS_CALENDARIO_PADRAO, horizonteDias: 10, envio: { imoveis: [im], automatico: false }, ...over });
const salvarRegras = (r: RegrasCalendario) => db.transaction(tx => gravarConfig(tx, org, "calendario_regras", { ...r }, null));
const enviar = (modo: "simulacao" | "envio" = "envio", o: { imovelIds?: string[]; semEscritor?: boolean; leitor?: LeitorBeds24 } = {}) =>
  enviarCalendarioBeds24(db, org, o.leitor ?? beds, o.semEscritor ? null : beds, { modo, imovelIds: o.imovelIds, agora, autorId: null });
const observacoes = () => db.select().from(beds24Calendario).where(and(eq(beds24Calendario.organizacaoId, org), eq(beds24Calendario.imovelId, im))).orderBy(beds24Calendario.data);
const enviados = () => db.select().from(beds24CalendarioEnviado).where(eq(beds24CalendarioEnviado.organizacaoId, org)).orderBy(beds24CalendarioEnviado.data);
const noites = () => db.select().from(beds24EnvioNoites).where(eq(beds24EnvioNoites.organizacaoId, org));
const diaFalso = (data: string) => (beds.calendarios[0].calendar as Record<string, unknown>[]).find(d => d.from === data);

beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Organização de teste" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "103", nome: "Boutique fictício" }).returning();
  await db.insert(imoveisDetalhes).values({ imovelId: im, organizacaoId: org, precoBase: 45000, pisoUltimaHora1: 35000, pisoUltimaHora2: 30000 });
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
  await salvarRegras(regras());
  beds = new Beds24Falso(() => agora);
  beds.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Quarto fictício" }] }];
  beds.calendarios = [{ roomId: 20, calendar: [{ from: "2026-10-01", to: "2026-10-10", numAvail: 1, price1: 400, minStay: 1, maxStay: 27, override: "none" }] }];
});

describe("envio ao Beds24 (M3.7)", () => {
  it("simulação planeja, registra e não grava nada no Beds24; sem BEDS24_ESCRITA o envio fica desligado", async () => {
    const s = await enviar("simulacao");
    expect(s).toMatchObject({ ok: true, situacao: "simulacao", imoveis: [{ codigo: "103", resumo: { noites: 10, enviar: 10, iguais: 0 } }] });
    expect(s.mensagem).toContain("10 noite(s) seriam enviadas");
    expect(beds.escritas).toHaveLength(0);
    expect(await noites()).toHaveLength(0);
    expect((await ultimosEnvios(db, org))[0]).toMatchObject({ modo: "simulacao", situacao: "simulacao" });
    const d = await enviar("envio", { semEscritor: true });
    expect(d).toMatchObject({ ok: false, situacao: "desligada", envioId: null });
    expect(d.mensagem).toContain("BEDS24_ESCRITA");
    expect(await ultimosEnvios(db, org)).toHaveLength(1);
  });

  it("envia só as noites diferentes, relê e confirma, guarda antes/depois e não reenvia o que já está igual", async () => {
    const r = await enviar();
    expect(r).toMatchObject({ ok: true, situacao: "ok", imoveis: [{ codigo: "103", enviadas: 10, confirmadas: 10, divergentes: 0, falha: "" }] });
    expect(beds.escritas).toHaveLength(1);
    expect(beds.escritas[0][0].roomId).toBe("20");
    // Quinta 1/10 (hoje, 25%: piso 300 → 400 enviados), sexta/sábado mínimo 2, domingo em diante (D+3..D+7: 15%).
    expect(diaFalso("2026-10-01")).toMatchObject({ price1: 450, minStay: 1, maxStay: 27 });
    expect(diaFalso("2026-10-02")).toMatchObject({ price1: 450, minStay: 2 });
    expect(diaFalso("2026-10-09")).toMatchObject({ price1: 450, minStay: 2 });
    const obs = await observacoes();
    expect(obs).toHaveLength(10);
    expect(obs[0]).toMatchObject({ data: "2026-10-01", preco: 45000, minimoNoites: 1, maximoNoites: 27, bloqueio: "none", livres: 1 });
    expect(obs[0].observadoEm.getTime()).toBeGreaterThan(agora.getTime());
    const est = await enviados();
    expect(est).toHaveLength(10);
    expect(est[1]).toMatchObject({ data: "2026-10-02", preco: 45000, minimo: 2, maximo: 27, bloqueio: null, confirmado: true });
    const n = await noitesDoEnvio(db, org, r.envioId!);
    expect(n).toHaveLength(10);
    expect(n[0]).toMatchObject({ codigo: "103", data: "2026-10-01", precoAntes: null, precoEnviado: 45000, minimoEnviado: 1, resultado: "confirmado" });
    expect(n[0].regra).toContain("Preço base");
    expect(n[0].regra).toContain("Beds24 aplica 25%");
    expect((await historicoDe(db, org, "integracao", org))[0].acao).toBe("beds24.enviar");

    const de_novo = await enviar();
    expect(de_novo).toMatchObject({ ok: true, situacao: "ok", imoveis: [{ enviadas: 0, resumo: { enviar: 0, iguais: 10 } }] });
    expect(beds.escritas).toHaveLength(1);
    expect(de_novo.mensagem).toContain("0 noite(s) enviada(s)");
    expect(await noites()).toHaveLength(10);

    // Mudou o cadastro: só as noites afetadas vão de novo; a referência nunca acumula desconto.
    await db.update(imoveisDetalhes).set({ precoBase: 39300 }).where(eq(imoveisDetalhes.imovelId, im));
    const mudou = await enviar();
    expect(mudou.imoveis[0]).toMatchObject({ enviadas: 10, confirmadas: 10 });
    // D0 (25%, piso 300): 393 × 0,75 < 300 → envia 400,00; D+3 (15%, piso 350) → 411,77; D+8 → 393.
    expect(diaFalso("2026-10-01")).toMatchObject({ price1: 400 });
    expect(diaFalso("2026-10-04")).toMatchObject({ price1: 411.77 });
    expect(diaFalso("2026-10-09")).toMatchObject({ price1: 393 });
    const terceira = await enviar();
    expect(terceira.imoveis[0].enviadas).toBe(0);
  });

  it("imóvel sem envio ligado, sem vínculo ou pedido fora da lista não é enviado", async () => {
    await salvarRegras(regras({ envio: { imoveis: [], automatico: false } }));
    const r = await enviar();
    expect(r).toMatchObject({ ok: false, situacao: "erro" });
    expect(r.mensagem).toContain("Nenhum imóvel com envio ligado");
    expect(beds.escritas).toHaveLength(0);
    await salvarRegras(regras());
    const [{ id: outro }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Mezanino" }).returning();
    expect((await enviar("envio", { imovelIds: [outro] })).mensagem).toContain("não está com envio ligado");
    await salvarRegras(regras({ envio: { imoveis: [im, outro], automatico: false } }));
    expect((await enviar("envio", { imovelIds: [outro] })).mensagem).toContain("sem vínculo Beds24");
    // Pedir só o 103 ignora o 403 sem vínculo.
    expect((await enviar("envio", { imovelIds: [im] })).imoveis.map(i => i.codigo)).toEqual(["103"]);
    expect((await ultimosEnvios(db, org)).filter(e => e.situacao === "erro")).toHaveLength(3);
  });

  it("vínculo que a credencial não enxerga, ou moeda diferente de BRL, nunca recebe escrita", async () => {
    await db.update(idsExternos).set({ detalhe: "21" }).where(eq(idsExternos.organizacaoId, org));
    const s = await enviar("simulacao");
    expect(s.situacao).toBe("simulacao");
    expect(s.avisos.some(a => a.includes("quarto 21) não está acessível"))).toBe(true);
    const r = await enviar();
    expect(r).toMatchObject({ ok: false, situacao: "erro", imoveis: [{ codigo: "103", enviadas: 0, falha: expect.stringContaining("não está acessível nesta credencial") }] });
    expect(beds.escritas).toHaveLength(0);
    expect(await noites()).toHaveLength(0);
    await db.update(idsExternos).set({ detalhe: "20" }).where(eq(idsExternos.organizacaoId, org));
    beds.properties = [{ id: 10, currency: "USD", roomTypes: [{ id: 20, name: "Quarto fictício" }] }];
    expect(await enviar()).toMatchObject({ situacao: "erro", imoveis: [{ falha: expect.stringContaining("BRL") }] });
    expect(beds.escritas).toHaveLength(0);
    beds.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Quarto fictício" }] }];
    expect((await enviar()).situacao).toBe("ok");
  });

  it("falha na escrita não confirma nada e a próxima execução reenvia; quarto recusado vira falha do imóvel", async () => {
    beds.falharEscrita = new ErroBeds24("Beds24 recusou a escrita (HTTP 403): a credencial não tem permissão de inventário.", "http");
    const r = await enviar();
    expect(r).toMatchObject({ ok: false, situacao: "erro", imoveis: [{ enviadas: 0, falha: expect.stringContaining("HTTP 403") }] });
    expect(r.avisos.some(a => a.includes("envio falhou"))).toBe(true);
    // Mesmo com falha, o quarto é relido: as noites ficam registradas como "falhou" e nada é confirmado.
    const registradas = await noites();
    expect(registradas).toHaveLength(10);
    expect(registradas.every(n => n.resultado === "falhou" && n.detalhe.includes("HTTP 403"))).toBe(true);
    expect((await enviados()).every(e => !e.confirmado)).toBe(true);
    beds.falharEscrita = null;
    beds.recusarQuartos = ["20"];
    expect(await enviar()).toMatchObject({ situacao: "erro", imoveis: [{ falha: "Quarto recusado pelo serviço falso.", confirmadas: 0 }] });
    beds.recusarQuartos = [];
    expect(await enviar()).toMatchObject({ situacao: "ok", imoveis: [{ enviadas: 10, confirmadas: 10 }] });
    expect(beds.escritas).toHaveLength(2);
  });

  it("recusa parcial do Beds24 (success:false com faixas já aplicadas) é relida: o que ficou gravado conta como confirmado", async () => {
    const escritorParcial = { escreverCalendario: async (itens: Parameters<typeof beds.escreverCalendario>[0]) => { await beds.escreverCalendario(itens); return itens.map(i => ({ roomId: i.roomId, ok: false, erro: "Uma faixa foi recusada." })); } };
    const r = await enviarCalendarioBeds24(db, org, beds, escritorParcial, { modo: "envio", agora, autorId: null });
    expect(r).toMatchObject({ situacao: "parcial", imoveis: [{ enviadas: 0, confirmadas: 10, falha: "Uma faixa foi recusada." }] });
    expect((await noites()).every(n => n.resultado === "confirmado")).toBe(true);
    expect((await enviados()).every(e => e.confirmado)).toBe(true);
    // Nada a reenviar: a releitura já mostrou o Beds24 igual ao SCL.
    expect((await enviar()).imoveis[0].resumo.enviar).toBe(0);
  });

  it("releitura que falha deixa as noites sem confirmação (incerto) e a próxima execução confirma sem acumular", async () => {
    const leitorFalho: LeitorBeds24 = { reservas: f => beds.reservas(f), quartos: () => beds.quartos(), calendario: async () => { throw new ErroBeds24("Beds24 não respondeu a tempo.", "tempo"); } };
    const r = await enviar("envio", { leitor: leitorFalho });
    expect(r).toMatchObject({ ok: false, situacao: "incerto", imoveis: [{ enviadas: 10, confirmadas: 0 }] });
    expect((await noites()).every(n => n.resultado === "enviado")).toBe(true);
    expect((await enviados()).every(e => !e.confirmado)).toBe(true);
    expect(await observacoes()).toHaveLength(0);
    const depois = await enviar();
    expect(depois).toMatchObject({ situacao: "ok", imoveis: [{ enviadas: 10, confirmadas: 10 }] });
    expect(diaFalso("2026-10-02")).toMatchObject({ price1: 450, minStay: 2 });
    expect((await enviar()).imoveis[0].enviadas).toBe(0);
  });

  it("valores diferentes na releitura viram divergência com aviso, sem fingir sucesso", async () => {
    const leitorTorto: LeitorBeds24 = { reservas: f => beds.reservas(f), quartos: () => beds.quartos(), calendario: async f => {
      const l = await beds.calendario(f);
      return { ...l, itens: l.itens.map(d => d.data === "2026-10-05" ? { ...d, preco: 99900 } : d) };
    } };
    const r = await enviar("envio", { leitor: leitorTorto });
    expect(r).toMatchObject({ ok: false, situacao: "parcial", imoveis: [{ enviadas: 10, confirmadas: 9, divergentes: 1 }] });
    expect(r.avisos).toContain("Imóvel 103, noite 05/10/2026: o Beds24 devolveu valores diferentes do enviado; conferir no Beds24.");
    const n = (await noitesDoEnvio(db, org, r.envioId!)).find(x => x.data === "2026-10-05");
    expect(n).toMatchObject({ resultado: "divergente", detalhe: expect.stringContaining("preço 99900") });
    expect((await enviados()).find(e => e.data === "2026-10-05")?.confirmado).toBe(false);
  });

  it("bloqueio manual do SCL fecha a noite no Beds24 e, removido, reabre; bloqueio importado e reservas não geram escrita de bloqueio", async () => {
    await db.insert(bloqueios).values([
      { organizacaoId: org, imovelId: im, inicio: "2026-10-03", fim: "2026-10-05", motivo: "Uso próprio" },
      { organizacaoId: org, imovelId: im, inicio: "2026-10-07", fim: "2026-10-08", motivo: "Importado", fonte: "beds24", idFonte: "999" },
    ]);
    await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-TESTE1", origem: "airbnb", estado: "confirmada", checkin: "2026-10-09", checkout: "2026-10-11", hospedeNome: "Hóspede Fictício", fonte: "manual", idFonte: "" });
    const r = await enviar();
    expect(r.situacao).toBe("ok");
    const faixas = beds.escritas[0][0].faixas;
    // Sábado 3/10 (mínimo 2) e domingo 4/10 (mínimo 1) têm cargas diferentes: duas faixas, ambas fechadas.
    expect(faixas.filter(f => f.bloqueio).map(f => [f.from, f.to, f.bloqueio, f.minimo])).toEqual([["2026-10-03", "2026-10-03", "blackout", 2], ["2026-10-04", "2026-10-04", "blackout", 1]]);
    expect(diaFalso("2026-10-03")).toMatchObject({ override: "blackout", numAvail: 0 });
    expect(diaFalso("2026-10-07")).toMatchObject({ override: "none" });
    // Sobras: mínimo 1 em 2/10 (sexta, regra 2) por sobrar 1 noite antes do bloqueio; 5/10 e 6/10 livres até o bloqueio importado.
    expect(diaFalso("2026-10-02")).toMatchObject({ minStay: 1 });
    expect((await enviados()).find(e => e.data === "2026-10-03")).toMatchObject({ bloqueio: "blackout", confirmado: true });
    await db.delete(bloqueios).where(eq(bloqueios.fonte, "manual"));
    const r2 = await enviar();
    expect(r2.imoveis[0]).toMatchObject({ enviadas: 3, confirmadas: 3 });
    expect(beds.escritas[1][0].faixas.map(f => [f.from, f.to, f.bloqueio, f.minimo])).toEqual([["2026-10-02", "2026-10-02", undefined, 2], ["2026-10-03", "2026-10-03", "none", 2], ["2026-10-04", "2026-10-04", "none", 1]]);
    expect(diaFalso("2026-10-03")).toMatchObject({ override: "none", numAvail: 1 });
    expect((await enviados()).find(e => e.data === "2026-10-03")).toMatchObject({ bloqueio: "none" });
    expect((await enviar()).imoveis[0].enviadas).toBe(0);
  });

  it("bloqueio que só existe no Beds24 nunca é reaberto pelo SCL, mesmo sem bloqueio local", async () => {
    beds.calendarios = [{ roomId: 20, calendar: [{ from: "2026-10-01", to: "2026-10-10", numAvail: 1, price1: 450, minStay: 1, maxStay: 27, override: "none" }, { from: "2026-10-06", to: "2026-10-06", numAvail: 0, price1: 450, minStay: 1, maxStay: 27, override: "blackout" }] }];
    await db.insert(beds24Calendario).values({ organizacaoId: org, imovelId: im, data: "2026-10-06", preco: 45000, minimoNoites: 1, maximoNoites: 27, livres: 0, bloqueio: "blackout", observadoEm: new Date("2026-10-01T10:00:00Z") });
    const r = await enviar();
    expect(beds.escritas[0][0].faixas.every(f => f.bloqueio === undefined)).toBe(true);
    expect(r.avisos).toContain("Imóvel 103, noite 06/10/2026: Beds24 tem bloqueio (blackout) sem bloqueio no SCL: o SCL não reabre o que não fechou; confira.");
    expect(diaFalso("2026-10-06")).toMatchObject({ override: "blackout", numAvail: 0 });
  });

  it("planejarImovel usa o horizonte configurado, o fuso do imóvel e um intervalo opcional", async () => {
    const r = await lerRegrasCalendario(db, org);
    const p = await planejarImovel(db, org, r, { id: im, fuso: "America/Sao_Paulo" }, agora);
    expect([p.hoje, p.inicio, p.fim, p.linhas.length]).toEqual(["2026-10-01", "2026-10-01", "2026-10-10", 10]);
    const q = await planejarImovel(db, org, r, { id: im, fuso: "America/Sao_Paulo" }, agora, { inicio: "2026-09-20", fim: "2026-10-03" });
    expect([q.inicio, q.fim, q.linhas.length]).toEqual(["2026-10-01", "2026-10-03", 3]);
  });
});

describe("rotina diária de envio", () => {
  it("fica parada sem o envio automático no painel ou sem BEDS24_ESCRITA; sem credencial registra falha", async () => {
    const env = (o: Record<string, string>) => ({ BEDS24_ORGANIZACAO_ID: org, ...o }) as unknown as NodeJS.ProcessEnv;
    expect(await executarCronEnvioBeds24(db, env({ BEDS24_ESCRITA: "ligada", BEDS24_API_KEY: "k" }))).toContain("Envio automático desligado");
    await salvarRegras(regras({ envio: { imoveis: [im], automatico: true } }));
    expect(await executarCronEnvioBeds24(db, env({ BEDS24_API_KEY: "k" }))).toContain("BEDS24_ESCRITA não está ligada");
    await expect(executarCronEnvioBeds24(db, env({ BEDS24_ESCRITA: "ligada" }))).rejects.toThrow("Credencial Beds24 não configurada.");
    expect((await ultimasExecucoes(db)).get("envio-beds24")).toMatchObject({ ok: false, resumo: expect.stringContaining("Credencial") });
    expect(beds.escritas).toHaveLength(0);
  });
});
