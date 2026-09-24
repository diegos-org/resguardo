import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { appSettings, execucoesAutomacao, imoveis, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { type Correio, CorreioMemoria, ErroEnvioIncerto, type Mensagem } from "@/email/correio";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva, sincronizarReserva } from "@/reservas/repositorio";
import { enviarAgenda, lerConfigAgenda, montarAgenda, previaDaAgenda, salvarConfigAgenda, textoDaAgenda, ultimaAgenda, ultimaAgendaDe } from "./agenda";
import { agendaDeTodas, agendaManual } from "./cron";

let db: Db;
let close: () => Promise<void>;
let org: string;
let rio: string;
let buzios: string;

const reserva = (imovelId: string, checkin: string, checkout: string, over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId,
  origem: "airbnb",
  estado: "confirmada",
  checkin,
  checkout,
  hospedes: 2,
  hospedeNome: "Ana Fictícia Souza",
  hospedeEmail: "",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 100000,
  taxaCanal: 15000,
  valorLiquido: null,
  codigoCanal: "",
  observacoes: "",
  ...over,
});

async function nova(imovelId: string, checkin: string, checkout: string, criadoEm: string, over: Partial<DadosReserva> = {}) {
  const r = await criarReserva(db, org, reserva(imovelId, checkin, checkout, over), null);
  if (!r.ok) throw new Error("reserva");
  await db.update(reservas).set({ criadoEm: new Date(criadoEm) }).where(eq(reservas.id, r.reserva.id));
  return r.reserva;
}

// 20h de 01/10/2026 em São Paulo.
const AGORA = new Date("2026-10-01T23:00:00Z");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: rio }, { id: buzios }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro", cidade: "Rio de Janeiro" },
      { organizacaoId: org, codigo: "BZ1", nome: "Búzios", cidade: "Armação dos Búzios" },
    ])
    .returning();
  // Segundo apartamento no Rio (sem reservas): cidade com vários imóveis vai no formato "limpezas".
  await db.insert(imoveis).values({ organizacaoId: org, codigo: "102", nome: "Um", cidade: "Rio de Janeiro" });
  await db.insert(imoveis).values({ organizacaoId: org, codigo: "999", nome: "Inativo", cidade: "Niterói", ativo: false });
});
afterEach(() => close());

describe("montagem da agenda", () => {
  it("próximos 5 dias a partir de amanhã, por cidade (Rio e Búzios separados), com limpeza 'a confirmar'", async () => {
    await nova(rio, "2026-09-28", "2026-10-03", "2026-09-01T12:00:00Z");
    await nova(rio, "2026-10-03", "2026-10-05", "2026-09-01T12:00:00Z", { hospedeNome: "Bruno Fictício", hospedes: null });
    await nova(buzios, "2026-10-06", "2026-10-09", "2026-09-01T12:00:00Z");
    // Fora da janela (entrada depois de 06/10): não aparece na lista dos dias.
    await nova(rio, "2026-10-20", "2026-10-22", "2026-09-01T12:00:00Z");
    const a = await montarAgenda(db, org, "2026-10-01", null);
    expect(a.dias).toEqual(["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
    expect(a.secoes.map((s) => s.cidade)).toEqual(["Armação dos Búzios", "Rio de Janeiro"]);
    const [bz, rj] = a.secoes;
    const dia = (s: typeof rj, d: string) => s.dias.find((x) => x.data === d)!.itens.map((i) => [i.tipo, i.imovel]);
    // No mesmo dia: saída, limpeza e entrada, nessa ordem.
    expect(dia(rj, "2026-10-03")).toEqual([["saida", "403"], ["limpeza", "403"], ["entrada", "403"]]);
    expect(dia(rj, "2026-10-05")).toEqual([["saida", "403"], ["limpeza", "403"]]);
    expect(dia(bz, "2026-10-06")).toEqual([["entrada", "BZ1"]]);
    expect(rj.dias.flatMap((d) => d.itens).some((i) => i.tipo === "entrada" && i.imovel === "BZ1")).toBe(false);
    const texto = textoDaAgenda(a);
    expect(texto).toContain("=== Rio de Janeiro ===");
    expect(texto).toContain("=== Armação dos Búzios ===");
    // Rio (modelo de 23/09): um dia por linha, só limpezas; "nenhuma limpeza" nos dias vazios;
    // horário-limite quando alguém entra no mesmo dia; entradas num parágrafo à parte.
    expect(texto).toContain(
      [
        "Limpezas dos próximos dias:",
        "",
        "🧹 Sex 02/10: nenhuma limpeza",
        "🧹 Sáb 03/10: 403 (pronto até 15h, entra Bruno)",
        "🧹 Dom 04/10: nenhuma limpeza",
        "🧹 Seg 05/10: 403",
        "🧹 Ter 06/10: nenhuma limpeza",
        "",
        "Só para referência, as entradas do período: sáb 03 — 403 (Bruno), 15h.",
      ].join("\n"),
    );
    // Búzios: uma linha por reserva, com entrada, saída e hóspedes.
    expect(texto).toContain("Próximas reservas:\n\n• Ana — entrada ter 06/10 a partir das 15h · saída sex 09/10 até 11h · 2 hóspedes");
    expect(texto).toContain("Nos outros dias até ter 06/10 não há entradas nem saídas.");
    expect(texto.trimEnd().endsWith("Essa é a agenda atual e ainda pode mudar com novas reservas ou cancelamentos.")).toBe(true);
    // Só o primeiro nome; sem código de reserva.
    expect(texto).not.toContain("Fictício");
    expect(texto).not.toContain("22/10");
    // Destinatário só de Búzios não recebe o Rio.
    const soBuzios = textoDaAgenda(a, ["Armação dos Búzios"]);
    expect(soBuzios).not.toContain("Rio de Janeiro");
    expect(soBuzios).toContain("• Ana — entrada ter 06/10");
  });

  it("formato e horários escolhidos na tela valem; limpeza entre saída e entrada; sem nº de hóspedes, avisa", async () => {
    await nova(buzios, "2026-10-01", "2026-10-03", "2026-09-01T12:00:00Z", { hospedes: null, hospedeNome: "Caio" });
    await nova(buzios, "2026-10-03", "2026-10-05", "2026-09-01T12:00:00Z", { hospedeNome: "Duda" });
    await nova(rio, "2026-10-02", "2026-10-04", "2026-09-01T12:00:00Z", { hospedeNome: "Eva" });
    const a = await montarAgenda(db, org, "2026-10-01", null);
    const texto = textoDaAgenda(a, [], { formatos: { "Rio de Janeiro": "reservas" }, horaEntrada: "14h", horaSaida: "10h30" });
    expect(texto).toContain("• Caio — entrada qui 01/10 a partir das 14h · saída sáb 03/10 até 10h30 · nº de hóspedes não informado\n  (limpeza no dia 03 entre a saída e a entrada)");
    expect(texto).toContain("• Duda — entrada sáb 03/10");
    // Rio com mais de um imóvel no formato por reserva: o código do imóvel aparece.
    expect(texto).toContain("• 403 · Eva — entrada sex 02/10 a partir das 14h");
    expect(texto).not.toContain("🧹");
    // Estada que começa antes da janela e termina depois dela não aparece (nenhum movimento nos 5 dias).
    await nova(buzios, "2026-09-20", "2026-10-20", "2026-09-01T12:00:00Z", { hospedeNome: "Longa" });
    const b = await montarAgenda(db, org, "2026-10-05", null);
    expect(textoDaAgenda(b)).not.toContain("Longa");
  });

  it("reservas novas desde a última agenda aparecem mesmo fora da janela; pendentes e canceladas não", async () => {
    await nova(rio, "2026-12-20", "2026-12-27", "2026-10-01T15:00:00Z");
    await nova(rio, "2026-11-01", "2026-11-03", "2026-09-30T15:00:00Z");
    await nova(buzios, "2026-12-01", "2026-12-03", "2026-10-01T15:00:00Z", { estado: "pendente" });
    const a = await montarAgenda(db, org, "2026-10-01", new Date("2026-09-30T23:00:00Z"), AGORA);
    const rj = a.secoes.find((s) => s.cidade === "Rio de Janeiro")!;
    expect(rj.novas.map((n) => n.checkin)).toEqual(["2026-12-20"]);
    expect(a.secoes.find((s) => s.cidade === "Armação dos Búzios")!.novas).toEqual([]);
    expect(textoDaAgenda(a)).toContain("Reservas novas desde a última agenda:\n• 403: entrada dom 20/12, saída dom 27/12 — Ana, 2 hóspedes");
  });
});

describe("configuração e envio", () => {
  it("valida e-mails e cidades; ligar exige destinatário", async () => {
    expect(await lerConfigAgenda(db, org)).toEqual({ ativa: false, destinatarios: [], formatos: {}, horaEntrada: "15h", horaSaida: "11h" });
    expect(await salvarConfigAgenda(db, org, { ativa: false, destinatarios: [], horaEntrada: "3 da tarde" }, null)).toMatchObject({ ok: false, erro: expect.stringContaining("15h") });
    expect(await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [] }, null)).toMatchObject({ ok: false });
    expect(await salvarConfigAgenda(db, org, { ativa: false, destinatarios: [{ email: "nao-e-email", cidades: [] }] }, null)).toMatchObject({ ok: false });
    expect(await salvarConfigAgenda(db, org, { ativa: false, destinatarios: [{ email: "a@example.com", cidades: ["Niterói"] }] }, null)).toMatchObject({ ok: false });
    expect(
      await salvarConfigAgenda(db, org, { ativa: false, destinatarios: [{ email: "A@example.com", cidades: [] }, { email: "a@example.com", cidades: [] }] }, null),
    ).toMatchObject({ ok: false, erro: expect.stringContaining("repetido") });
    expect(
      await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: " Equipe@Example.com ", cidades: [] }, { email: "", cidades: [] }] }, null),
    ).toEqual({ ok: true });
    expect(await lerConfigAgenda(db, org)).toMatchObject({ ativa: true, destinatarios: [{ email: "equipe@example.com", cidades: [] }] });
    // Formato e horários: gravados; salvar sem eles mantém o que estava.
    expect(await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "equipe@example.com", cidades: [] }], formatos: { "Rio de Janeiro": "reservas" }, horaEntrada: "14H" }, null)).toEqual({ ok: true });
    expect(await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "equipe@example.com", cidades: [] }] }, null)).toEqual({ ok: true });
    expect(await lerConfigAgenda(db, org)).toMatchObject({ formatos: { "Rio de Janeiro": "reservas" }, horaEntrada: "14h", horaSaida: "11h" });
  });

  it("cidade já escolhida continua valendo mesmo sem imóvel ativo (não vira 'todas')", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "buzios@example.com", cidades: ["Armação dos Búzios"] }] }, null);
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, buzios));
    // A tela reenvia a cidade já configurada: continua aceita e o destinatário não passa a receber o Rio.
    expect(await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "buzios@example.com", cidades: ["Armação dos Búzios"] }] }, null)).toEqual({ ok: true });
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, AGORA);
    expect(correio.enviadas[0].texto).not.toContain("Rio de Janeiro");
    expect(correio.enviadas[0].texto).toContain("Nenhum imóvel ativo nas cidades deste destinatário.");
  });

  it("cada destinatário tem o seu marco: quem falhou recebe as mesmas novas; reserva criada entre tentativas chega a todos", async () => {
    await nova(rio, "2026-12-20", "2026-12-27", "2026-10-01T15:00:00Z");
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }, { email: "b@example.com", cidades: [] }] }, null);
    const meioQuebrado: Correio = {
      nome: "meio",
      enviar: async (m) => {
        if (m.para === "b@example.com") throw new Error("HTTP 500");
      },
    };
    expect(await enviarAgenda(db, org, meioQuebrado, AGORA)).toMatchObject({ enviados: 1, falhas: [expect.stringContaining("b@example.com")] });
    expect(await ultimaAgendaDe(db, org, "a@example.com")).toEqual(AGORA);
    expect(await ultimaAgendaDe(db, org, "b@example.com")).toBeNull();
    // Entre as tentativas entra outra reserva distante.
    await nova(rio, "2027-01-10", "2027-01-12", "2026-10-01T23:05:00Z");
    const correio = new CorreioMemoria();
    const retry = new Date(AGORA.getTime() + 600_000);
    expect(await enviarAgenda(db, org, correio, retry)).toMatchObject({ enviados: 1, jaEnviados: 1 });
    // Quem falhou recebe as duas.
    expect(correio.enviadas[0]).toMatchObject({ para: "b@example.com" });
    expect(correio.enviadas[0].texto).toContain("entrada dom 20/12");
    expect(correio.enviadas[0].texto).toContain("entrada dom 10/01");
    // No dia seguinte, quem já tinha recebido ganha a reserva que entrou depois do envio dele.
    const amanha = new CorreioMemoria();
    await enviarAgenda(db, org, amanha, new Date("2026-10-02T23:00:00Z"));
    const paraA = amanha.enviadas.find((m) => m.para === "a@example.com")!.texto;
    expect(paraA).toContain("entrada dom 10/01");
    expect(paraA).not.toContain("entrada dom 20/12");
    expect(amanha.enviadas.find((m) => m.para === "b@example.com")!.texto).not.toContain("Reservas novas");
    expect(await ultimaAgenda(db, org)).toEqual(new Date("2026-10-02T23:00:00Z"));
  });

  it("tentativa que caiu no meio (marca 'enviando' antiga) é refeita; em andamento recente, não", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const chave = `agenda-diaria:${org}:2026-10-01:a@example.com`;
    await db.insert(appSettings).values({ key: chave, value: { em: new Date(AGORA.getTime() - 5 * 60_000).toISOString(), estado: "enviando" } });
    const correio = new CorreioMemoria();
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 0, jaEnviados: 0, falhas: [expect.stringContaining("ainda não foi confirmado")] });
    await db.update(appSettings).set({ value: { em: new Date(AGORA.getTime() - 20 * 60_000).toISOString(), estado: "enviando" } }).where(eq(appSettings.key, chave));
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 1 });
    expect(await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 60 * 60_000))).toMatchObject({ enviados: 0, jaEnviados: 1 });
  });

  it("e-mail aceito pelo provedor não é reenviado se o registro do envio falhar; o provedor recebe a chave do dia", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    // O banco cai logo depois de o provedor aceitar o e-mail (na gravação da marca e do marco).
    let aceito = false;
    const enviadas: Mensagem[] = [];
    const correio: Correio = {
      nome: "teste",
      enviar: async (m) => {
        enviadas.push(m);
        aceito = true;
      },
    };
    const original = db.transaction.bind(db);
    const espiao = vi.spyOn(db, "transaction").mockImplementation(((fn: Parameters<Db["transaction"]>[0]) => {
      if (aceito) throw new Error("banco fora");
      return original(fn);
    }) as Db["transaction"]);
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 1, falhas: [expect.stringContaining("enviada, mas não foi possível registrar")] });
    espiao.mockRestore();
    // Nem a marca virou "enviado" nem o marco andou (os dois juntos): a marca "enviando" segura o dia.
    expect(await ultimaAgendaDe(db, org, "a@example.com")).toBeNull();
    expect(enviadas[0].chave).toBe(`agenda-diaria:${org}:2026-10-01:a@example.com`);
    // Nova execução no mesmo dia: a marca continua, nada é reenviado.
    expect(await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 60_000))).toMatchObject({ enviados: 0, jaEnviados: 0, falhas: [expect.stringContaining("ainda não foi confirmado")] });
    expect(enviadas).toHaveLength(1);
  });

  it("retomada manda exatamente o pedido guardado na tentativa original (mesmo com reservas novas no meio)", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const original = new Date(AGORA.getTime() - 20 * 60_000);
    const carga = { assunto: "Agenda SCL — original", texto: "texto original\n", eventos: ["ev-1"], imoveis: [] };
    await db.insert(appSettings).values({ key: `agenda-diaria:${org}:2026-10-01:a@example.com`, value: { em: original.toISOString(), estado: "enviando", corte: original.toISOString(), carga } });
    await nova(rio, "2027-01-10", "2027-01-12", new Date(AGORA.getTime() - 10 * 60_000).toISOString());
    const correio = new CorreioMemoria();
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 1 });
    expect(correio.enviadas[0]).toMatchObject({ assunto: "Agenda SCL — original", texto: "texto original\n" });
    // As avisadas são as do pedido original.
    const [av] = await db.select().from(appSettings).where(eq(appSettings.key, `agenda-diaria:avisadas:${org}:a@example.com`));
    expect((av.value as { avisadas: { id: string }[] }).avisadas.map((x) => x.id)).toEqual(["ev-1"]);
  });

  it("primeira agenda retomada: as 24h contam do corte original, não da retomada", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const original = new Date(AGORA.getTime() - 20 * 60_000);
    await db.insert(appSettings).values({ key: `agenda-diaria:${org}:2026-10-01:a@example.com`, value: { em: original.toISOString(), estado: "enviando", corte: original.toISOString() } });
    // Criada 24h − 5 min antes do corte original (entre corte−24h e agora−24h).
    await nova(rio, "2027-02-15", "2027-02-17", new Date(original.getTime() - 86_400_000 + 5 * 60_000).toISOString());
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, AGORA);
    expect(correio.enviadas[0].texto).toContain("entrada seg 15/02");
  });

  it("retomada de tentativa interrompida usa o corte da tentativa original (reserva entre as duas vai na próxima)", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const original = new Date(AGORA.getTime() - 20 * 60_000);
    // A primeira tentativa (20 min atrás) caiu depois de o provedor aceitar: a marca ficou "enviando".
    await db.insert(appSettings).values({ key: `agenda-diaria:${org}:2026-10-01:a@example.com`, value: { em: original.toISOString(), estado: "enviando", corte: original.toISOString() } });
    // Reserva distante criada entre as tentativas.
    await nova(rio, "2027-01-10", "2027-01-12", new Date(AGORA.getTime() - 10 * 60_000).toISOString());
    const correio = new CorreioMemoria();
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 1 });
    // O marco é o corte original: a reserva nova não é dada como avisada…
    expect(await ultimaAgendaDe(db, org, "a@example.com")).toEqual(original);
    expect(correio.enviadas[0].texto).not.toContain("10/01");
    // …e chega na agenda seguinte.
    const amanha = new CorreioMemoria();
    await enviarAgenda(db, org, amanha, new Date("2026-10-02T23:00:00Z"));
    expect(amanha.enviadas[0].texto).toContain("entrada dom 10/01");
  });

  it("reserva gravada com horário antes do corte mas que só apareceu depois ainda chega; a já avisada não repete", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    // Avisada no envio de hoje (criada 5 min antes do corte).
    await nova(rio, "2026-12-01", "2026-12-03", new Date(AGORA.getTime() - 5 * 60_000).toISOString());
    const hoje = new CorreioMemoria();
    await enviarAgenda(db, org, hoje, AGORA);
    expect(hoje.enviadas[0].texto).toContain("entrada ter 01/12");
    // Outra, com horário 3 min antes do corte, só ficou visível depois do envio (gravação concorrente).
    await nova(rio, "2027-02-01", "2027-02-03", new Date(AGORA.getTime() - 3 * 60_000).toISOString());
    const amanha = new CorreioMemoria();
    await enviarAgenda(db, org, amanha, new Date("2026-10-02T23:00:00Z"));
    expect(amanha.enviadas[0].texto).toContain("entrada seg 01/02");
    expect(amanha.enviadas[0].texto).not.toContain("entrada ter 01/12");
  });

  it("'enviar agora' pouco antes das 20h: a reserva avisada nele não se repete às 20h nem no dia seguinte", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2027-03-01", "2027-03-03", new Date(AGORA.getTime() - 6 * 60_000).toISOString());
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, new Date(AGORA.getTime() - 5 * 60_000), { manual: true });
    await enviarAgenda(db, org, correio, AGORA);
    await enviarAgenda(db, org, correio, new Date("2026-10-02T23:00:00Z"));
    expect(correio.enviadas.map((m) => m.texto.includes("entrada seg 01/03"))).toEqual([true, false, false]);
  });

  it("'enviar agora' que termina depois das 20h não volta o marco nem apaga as avisadas das 20h", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    // Criada entre o corte do manual (19:59) e o das 20h.
    await nova(rio, "2027-04-01", "2027-04-03", new Date(AGORA.getTime() - 30_000).toISOString());
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, AGORA);
    // O manual (corte 19:59) termina depois.
    await enviarAgenda(db, org, correio, new Date(AGORA.getTime() - 60_000), { manual: true });
    expect(await ultimaAgendaDe(db, org, "a@example.com")).toEqual(AGORA);
    const amanha = new CorreioMemoria();
    await enviarAgenda(db, org, amanha, new Date("2026-10-02T23:00:00Z"));
    expect(amanha.enviadas[0].texto).not.toContain("entrada qui 01/04");
  });

  it("envio de um dia anterior sem registro confirmado: as reservas saem de novo com aviso", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2027-05-03", "2027-05-05", new Date(AGORA.getTime() - 60 * 60_000).toISOString());
    // Anteontem o envio foi registrado (marco de 30/09); ontem (01/10) o provedor pode ter aceitado,
    // mas o registro ficou "enviando" e o marco não andou.
    await db.insert(appSettings).values([
      { key: `agenda-diaria:ultima:${org}:a@example.com`, value: { em: "2026-09-30T23:00:00.000Z" } },
      { key: `agenda-diaria:${org}:2026-10-01:a@example.com`, value: { em: AGORA.toISOString(), estado: "enviando", corte: AGORA.toISOString() } },
    ]);
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, new Date("2026-10-02T23:00:00Z"));
    expect(correio.enviadas[0].texto).toContain("entrada seg 03/05");
    expect(correio.enviadas[0].texto).toContain("pode já ter vindo numa agenda anterior");
    const [marca] = await db.select().from(appSettings).where(eq(appSettings.key, `agenda-diaria:${org}:2026-10-01:a@example.com`));
    // Coberto por este envio (com o aviso): resolvido.
    expect((marca.value as { estado: string }).estado).toBe("resolvido");
  });

  it("avisadas: só as das cidades da pessoa; ganhar outra cidade traz a reserva recente dela", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: ["Rio de Janeiro"] }] }, null);
    await nova(buzios, "2027-06-01", "2027-06-04", new Date(AGORA.getTime() - 5 * 60_000).toISOString());
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, AGORA);
    expect(correio.enviadas[0].texto).not.toContain("01/06");
    // Passa a receber também Búzios; o "enviar agora" logo depois traz a reserva que ela nunca recebeu.
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 60_000), { manual: true });
    expect(correio.enviadas[1].texto).toContain("entrada ter 01/06");
  });

  it("cidade que a pessoa passou a receber conta como nova para ela: reservas novas das últimas 24h dessa cidade", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: ["Rio de Janeiro"] }] }, null);
    // Criada 2h antes do envio só do Rio (fora da sobreposição de 10 min), longe da janela de 5 dias.
    await nova(buzios, "2027-08-02", "2027-08-05", new Date(AGORA.getTime() - 2 * 3_600_000).toISOString());
    await nova(rio, "2027-08-10", "2027-08-12", new Date(AGORA.getTime() - 2 * 3_600_000).toISOString());
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, AGORA);
    expect(correio.enviadas[0].texto).toContain("entrada ter 10/08");
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 60_000), { manual: true });
    // Búzios chega (nunca foi para ela); o Rio já avisado não se repete.
    expect(correio.enviadas[1].texto).toContain("entrada seg 02/08");
    expect(correio.enviadas[1].texto).not.toContain("entrada ter 10/08");
  });

  it("formato escolhido de cidade sem imóvel ativo continua salvo", async () => {
    await salvarConfigAgenda(db, org, { ativa: false, destinatarios: [], formatos: { "Armação dos Búzios": "limpezas" } }, null);
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, buzios));
    // A tela lista a cidade (formato salvo) e a manda de volta; a escolha continua.
    expect(await salvarConfigAgenda(db, org, { ativa: false, destinatarios: [{ email: "a@example.com", cidades: ["Armação dos Búzios"] }], formatos: { "Armação dos Búzios": "limpezas" } }, null)).toEqual({ ok: true });
    expect((await lerConfigAgenda(db, org)).formatos).toEqual({ "Armação dos Búzios": "limpezas" });
  });

  it("envio incerto (conexão caiu): a marca fica com o pedido e a retomada manda o mesmo e-mail", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2027-09-01", "2027-09-03", new Date(AGORA.getTime() - 60_000).toISOString());
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    const r = await enviarAgenda(db, org, caiu, AGORA);
    expect(r.falhas[0]).toContain("envio incerto");
    const [marca] = await db.select().from(appSettings).where(eq(appSettings.key, `agenda-diaria:${org}:2026-10-01:a@example.com`));
    expect((marca.value as { estado: string }).estado).toBe("enviando");
    // Antes de 15 minutos não tenta de novo; depois, manda exatamente o mesmo texto.
    const correio = new CorreioMemoria();
    // Mesmo tipo de envio antes dos 15 minutos: continua como falha (não conta como "já enviada").
    const cedo = await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 5 * 60_000));
    expect(cedo).toMatchObject({ enviados: 0, jaEnviados: 0 });
    expect(cedo.falhas[0]).toContain("ainda não foi confirmado");
    await nova(rio, "2027-09-10", "2027-09-12", new Date(AGORA.getTime() + 60_000).toISOString());
    expect(await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 20 * 60_000))).toMatchObject({ enviados: 1 });
    expect(correio.enviadas[0].texto).toContain("entrada qua 01/09");
    expect(correio.enviadas[0].texto).not.toContain("10/09");
  });

  it("cidade que saiu da lista e voltou conta como nova para a pessoa", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, AGORA);
    // Passa a receber só o Rio; nesse tempo entra uma reserva distante em Búzios.
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: ["Rio de Janeiro"] }] }, null);
    const dia2 = new Date("2026-10-02T23:00:00Z");
    await nova(buzios, "2027-10-05", "2027-10-08", new Date(dia2.getTime() - 3_600_000).toISOString());
    await enviarAgenda(db, org, correio, dia2);
    expect(correio.enviadas[1].texto).not.toContain("entrada ter 05/10");
    // Búzios volta: a reserva de 1h atrás chega (cidade não coberta pelo marco do Rio).
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await enviarAgenda(db, org, correio, new Date(dia2.getTime() + 60_000), { manual: true });
    expect(correio.enviadas[2].texto).toContain("entrada ter 05/10");
  });

  it("'enviar agora' ao mesmo tempo que o das 20h: um envio por vez para a pessoa (sem repetir a reserva)", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2027-11-01", "2027-11-03", new Date(AGORA.getTime() - 60_000).toISOString());
    const saiu: Mensagem[] = [];
    let libera!: () => void;
    const espera = new Promise<void>((ok) => (libera = ok));
    const lento: Correio = { nome: "lento", enviar: async (m) => { saiu.push(m); await espera; } };
    const agendado = enviarAgenda(db, org, lento, AGORA);
    await vi.waitFor(() => expect(saiu).toHaveLength(1));
    const manual = await enviarAgenda(db, org, lento, new Date(AGORA.getTime() + 1_000), { manual: true });
    expect(manual.falhas[0]).toContain("em andamento");
    libera();
    expect(await agendado).toMatchObject({ enviados: 1 });
    expect(saiu).toHaveLength(1);
    // A trava sai no fim; uma trava esquecida (execução que caiu) vence em 15 minutos.
    await db.insert(appSettings).values({ key: `agenda-diaria:trava:${org}:a@example.com`, value: { em: new Date(AGORA.getTime() - 20 * 60_000).toISOString() } });
    const correio = new CorreioMemoria();
    expect(await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 2_000), { manual: true })).toMatchObject({ enviados: 1 });
    expect(await db.select().from(appSettings).where(eq(appSettings.key, `agenda-diaria:trava:${org}:a@example.com`))).toEqual([]);
  });

  it("trava tomada de uma execução atrasada não é solta por ela", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const chaveTrava = `agenda-diaria:trava:${org}:a@example.com`;
    let libera1!: () => void;
    let libera2!: () => void;
    const espera1 = new Promise<void>((ok) => (libera1 = ok));
    const espera2 = new Promise<void>((ok) => (libera2 = ok));
    const saiu: string[] = [];
    const primeiro: Correio = { nome: "1", enviar: async () => { saiu.push("1"); await espera1; } };
    const segundo: Correio = { nome: "2", enviar: async () => { saiu.push("2"); await espera2; } };
    // A primeira execução trava e fica presa no provedor; 20 min depois, outra toma a trava vencida.
    const p1 = enviarAgenda(db, org, primeiro, AGORA);
    await vi.waitFor(() => expect(saiu).toEqual(["1"]));
    const p2 = enviarAgenda(db, org, segundo, new Date(AGORA.getTime() + 20 * 60_000), { manual: true });
    await vi.waitFor(() => expect(saiu).toEqual(["1", "2"]));
    const [dela] = await db.select().from(appSettings).where(eq(appSettings.key, chaveTrava));
    // A primeira termina: a trava da segunda continua lá.
    libera1();
    await p1;
    const [depois] = await db.select().from(appSettings).where(eq(appSettings.key, chaveTrava));
    expect(depois.value).toEqual(dela.value);
    libera2();
    await p2;
    expect(await db.select().from(appSettings).where(eq(appSettings.key, chaveTrava))).toEqual([]);
  });

  it("tentativa atrasada não apaga a marca de quem a retomou (sem reenvio no mesmo dia)", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    let libera!: () => void;
    const espera = new Promise<void>((ok) => (libera = ok));
    const saiu: string[] = [];
    const atrasado: Correio = { nome: "atrasado", enviar: async () => { saiu.push("1"); await espera; throw new Error("Falha ao enviar e-mail (HTTP 422)."); } };
    const p1 = enviarAgenda(db, org, atrasado, AGORA);
    await vi.waitFor(() => expect(saiu).toEqual(["1"]));
    // 20 minutos depois, outra execução retoma a marca e envia (o mesmo pedido).
    const bom = new CorreioMemoria();
    expect(await enviarAgenda(db, org, bom, new Date(AGORA.getTime() + 20 * 60_000))).toMatchObject({ enviados: 1 });
    // A primeira recebe a recusa só agora: não apaga a marca "enviado" da outra.
    libera();
    await p1;
    const [marca] = await db.select().from(appSettings).where(eq(appSettings.key, `agenda-diaria:${org}:2026-10-01:a@example.com`));
    expect((marca.value as { estado: string }).estado).toBe("enviado");
    expect(await enviarAgenda(db, org, bom, new Date(AGORA.getTime() + 21 * 60_000))).toMatchObject({ enviados: 0, jaEnviados: 1 });
  });

  it("cidade sem imóvel ativo não fica coberta: ao reativar, a reserva feita nesse meio-tempo chega", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, buzios));
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, AGORA);
    expect(correio.enviadas[0].texto).not.toContain("Búzios");
    const dia2 = new Date("2026-10-02T23:00:00Z");
    await nova(buzios, "2028-01-10", "2028-01-12", new Date(dia2.getTime() - 3_600_000).toISOString());
    await enviarAgenda(db, org, correio, dia2);
    // Reativada logo depois: a reserva de 1h atrás chega (a cidade não estava coberta).
    await db.update(imoveis).set({ ativo: true }).where(eq(imoveis.id, buzios));
    await enviarAgenda(db, org, correio, new Date(dia2.getTime() + 60_000), { manual: true });
    expect(correio.enviadas[2].texto).toContain("entrada seg 10/01");
  });

  it("marcas diárias concluídas de mais de 3 dias saem; pendentes e recentes ficam", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const k = (data: string, manual = false) => `agenda-diaria${manual ? "-manual" : ""}:${org}:${data}:a@example.com`;
    await db.insert(appSettings).values([
      { key: k("2026-09-20"), value: { em: "x", estado: "enviado" } },
      { key: k("2026-09-21", true), value: { em: "x", estado: "resolvido" } },
      { key: k("2026-09-22"), value: { em: "2026-09-22T23:00:00.000Z", estado: "incerto", corte: "2026-09-22T23:00:00.000Z" } },
      { key: k("2026-09-29"), value: { em: "x", estado: "enviado" } },
    ]);
    await enviarAgenda(db, org, new CorreioMemoria(), AGORA);
    const chaves = (await db.select({ key: appSettings.key }).from(appSettings)).map((x) => x.key);
    expect(chaves).not.toContain(k("2026-09-20"));
    expect(chaves).not.toContain(k("2026-09-21", true));
    expect(chaves).toContain(k("2026-09-29"));
    // O incerto não some sozinho: foi coberto por este envio e ficou "resolvido" (sai numa limpeza futura).
    const [inc] = await db.select().from(appSettings).where(eq(appSettings.key, k("2026-09-22")));
    expect((inc.value as { estado: string }).estado).toBe("resolvido");
  });

  it("provedor que não responde no prazo: envio incerto, a marca fica para a retomada", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const preso: Correio = { nome: "preso", enviar: () => new Promise(() => {}) };
    const r = await enviarAgenda(db, org, preso, AGORA, { prazoProvedorMs: 50 });
    expect(r.falhas[0]).toContain("não respondeu");
    const [marca] = await db.select().from(appSettings).where(eq(appSettings.key, `agenda-diaria:${org}:2026-10-01:a@example.com`));
    expect((marca.value as { estado: string }).estado).toBe("enviando");
  });

  it("primeira agenda incerta de ontem: a de hoje cobre desde 24h antes do corte de ontem", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    // Ontem (sem marco nenhum) o envio ficou "enviando"; a reserva é de 23h antes daquele corte.
    await db.insert(appSettings).values({ key: `agenda-diaria:${org}:2026-10-01:a@example.com`, value: { em: AGORA.toISOString(), estado: "enviando", corte: AGORA.toISOString() } });
    await nova(rio, "2028-04-03", "2028-04-05", new Date(AGORA.getTime() - 23 * 3_600_000).toISOString());
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, new Date("2026-10-02T23:00:00Z"));
    expect(correio.enviadas[0].texto).toContain("entrada seg 03/04");
    expect(correio.enviadas[0].texto).toContain("pode já ter vindo");
  });

  it("imóvel inativo numa cidade que continua na agenda: ao reativar, a reserva feita nesse meio-tempo chega", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const [um] = await db.select().from(imoveis).where(eq(imoveis.codigo, "102"));
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, um.id));
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, AGORA);
    const dia2 = new Date("2026-10-02T23:00:00Z");
    await nova(um.id, "2028-05-02", "2028-05-04", new Date(dia2.getTime() - 3_600_000).toISOString());
    await enviarAgenda(db, org, correio, dia2);
    expect(correio.enviadas[1].texto).not.toContain("entrada ter 02/05");
    // Reativado: o Rio continuou coberto, mas o 102 não; a reserva de 1h atrás chega.
    await db.update(imoveis).set({ ativo: true }).where(eq(imoveis.id, um.id));
    await enviarAgenda(db, org, correio, new Date(dia2.getTime() + 60_000), { manual: true });
    expect(correio.enviadas[2].texto).toContain("entrada ter 02/05");
  });

  it("prévia da tela: parte do marco mais antigo entre os destinatários (quem falhou ainda vê a reserva)", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }, { email: "b@example.com", cidades: [] }] }, null);
    await nova(rio, "2028-08-01", "2028-08-03", new Date(AGORA.getTime() - 60_000).toISOString());
    // "a" recebe; "b" falha. O marco global anda, o de "b" não.
    const soA: Correio = { nome: "soA", enviar: async (m) => { if (m.para === "b@example.com") throw new Error("Falha ao enviar e-mail (HTTP 422)."); } };
    await enviarAgenda(db, org, soA, AGORA);
    const { agenda } = await previaDaAgenda(db, org, new Date(AGORA.getTime() + 3_600_000));
    expect(agenda.secoes.flatMap((x) => x.novas).map((n) => n.checkin)).toContain("2028-08-01");
  });

  it("prévia da tela: reserva que todos já receberam não aparece de novo", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2028-08-07", "2028-08-09", new Date(AGORA.getTime() - 60_000).toISOString());
    await enviarAgenda(db, org, new CorreioMemoria(), AGORA);
    const { agenda } = await previaDaAgenda(db, org, new Date(AGORA.getTime() + 60_000));
    expect(agenda.secoes.flatMap((x) => x.novas).map((n) => n.checkin)).not.toContain("2028-08-07");
  });

  it("prévia da tela: quem não recebe a cidade não segura a reserva que os outros já receberam", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: ["Rio de Janeiro"] }, { email: "b@example.com", cidades: ["Armação dos Búzios"] }] }, null);
    await nova(rio, "2028-08-14", "2028-08-16", new Date(AGORA.getTime() - 60_000).toISOString());
    await enviarAgenda(db, org, new CorreioMemoria(), AGORA);
    const { agenda } = await previaDaAgenda(db, org, new Date(AGORA.getTime() + 60_000));
    expect(agenda.secoes.flatMap((x) => x.novas).map((n) => n.checkin)).not.toContain("2028-08-14");
  });

  it("'enviar agora' que fechou o agendado pendente conta como o manual do dia", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2028-09-11", "2028-09-13", new Date(AGORA.getTime() - 60_000).toISOString());
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    await enviarAgenda(db, org, caiu, AGORA);
    const correio = new CorreioMemoria();
    expect(await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 20 * 60_000), { manual: true })).toMatchObject({ enviados: 1 });
    // Outro clique no mesmo dia: já enviado, não manda de novo.
    expect(await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 25 * 60_000), { manual: true })).toMatchObject({ enviados: 0, jaEnviados: 1 });
    expect(correio.enviadas).toHaveLength(1);
  });

  it("prévia da tela: cada cidade usa a janela de quem a recebe (marcos diferentes por pessoa)", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: ["Rio de Janeiro"] }, { email: "b@example.com", cidades: ["Armação dos Búzios"] }] }, null);
    await db.insert(appSettings).values([
      { key: `agenda-diaria:ultima:${org}:a@example.com`, value: { em: new Date(AGORA.getTime() - 3_600_000).toISOString() } },
      { key: `agenda-diaria:ultima:${org}:b@example.com`, value: { em: new Date(AGORA.getTime() - 3 * 86_400_000).toISOString() } },
    ]);
    // Reserva do Rio de 2 dias atrás: antes do marco de quem recebe o Rio; ninguém vai recebê-la.
    await nova(rio, "2028-10-09", "2028-10-11", new Date(AGORA.getTime() - 2 * 86_400_000).toISOString());
    const { agenda } = await previaDaAgenda(db, org, AGORA);
    expect(agenda.secoes.flatMap((x) => x.novas).map((n) => n.checkin)).not.toContain("2028-10-09");
  });

  it("prévia da tela: imóvel reativado mostra as reservas das últimas 24h, como no envio", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, buzios));
    await nova(buzios, "2028-09-04", "2028-09-06", new Date(AGORA.getTime() - 12 * 3_600_000).toISOString());
    await enviarAgenda(db, org, new CorreioMemoria(), AGORA);
    await db.update(imoveis).set({ ativo: true }).where(eq(imoveis.id, buzios));
    const agora = new Date(AGORA.getTime() + 60_000);
    const { agenda } = await previaDaAgenda(db, org, agora);
    expect(agenda.secoes.flatMap((x) => x.novas).map((n) => n.checkin)).toContain("2028-09-04");
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, agora, { manual: true });
    expect(correio.enviadas[0].texto).toContain("04/09");
  });

  it("envio agendado incerto: o 'enviar agora' do mesmo dia repete o mesmo pedido, sem segundo e-mail", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2028-06-05", "2028-06-07", new Date(AGORA.getTime() - 60_000).toISOString());
    const pedidos: Mensagem[] = [];
    const caiu: Correio = { nome: "caiu", enviar: async (m) => { pedidos.push(m); throw new ErroEnvioIncerto("Sem resposta do provedor de e-mail"); } };
    await enviarAgenda(db, org, caiu, AGORA);
    const correio = new CorreioMemoria();
    // Logo depois: não manda com outra chave; espera a retomada.
    const cedo = await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 60_000), { manual: true });
    expect(cedo.enviados).toBe(0);
    expect(cedo.falhas[0]).toContain("ainda não foi confirmado");
    expect(correio.enviadas).toHaveLength(0);
    // Depois de 15 minutos: o manual retoma o pedido do agendado, com a mesma chave e o mesmo texto.
    expect(await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 20 * 60_000), { manual: true })).toMatchObject({ enviados: 1 });
    expect(correio.enviadas[0]).toMatchObject({ chave: pedidos[0].chave, texto: pedidos[0].texto });
    const [marca] = await db.select().from(appSettings).where(eq(appSettings.key, `agenda-diaria:${org}:2026-10-01:a@example.com`));
    expect((marca.value as { estado: string }).estado).toBe("enviado");
  });

  it("envio incerto só fica resolvido quando outro e-mail cobre todos os imóveis dele", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, AGORA);
    // Dia 2: reserva nova em Búzios e o envio fica incerto (pode não ter chegado).
    const dia2 = new Date("2026-10-02T23:00:00Z");
    await nova(buzios, "2028-07-03", "2028-07-05", new Date(dia2.getTime() - 3_600_000).toISOString());
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    await enviarAgenda(db, org, caiu, dia2);
    // Dia 3: Búzios inativo; o e-mail sai sem Búzios e o incerto continua aberto.
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, buzios));
    await enviarAgenda(db, org, correio, new Date("2026-10-03T23:00:00Z"));
    expect(correio.enviadas[1].texto).not.toContain("entrada seg 03/07");
    const chaveDia2 = `agenda-diaria:${org}:2026-10-02:a@example.com`;
    const estado = async () => ((await db.select().from(appSettings).where(eq(appSettings.key, chaveDia2)))[0].value as { estado: string }).estado;
    expect(await estado()).toBe("incerto");
    // Dias depois (fora das 24h), Búzios volta: a reserva do envio incerto chega, e aí ele é resolvido.
    await db.update(imoveis).set({ ativo: true }).where(eq(imoveis.id, buzios));
    await enviarAgenda(db, org, correio, new Date("2026-10-05T23:00:00Z"));
    expect(correio.enviadas[2].texto).toContain("entrada seg 03/07");
    expect(correio.enviadas[2].texto).toContain("pode já ter vindo");
    expect(await estado()).toBe("resolvido");
  });

  it("'enviar agora' incerto antes das 20h: o agendado fecha o manual (mesmo pedido) e manda a agenda do dia", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2028-12-04", "2028-12-06", new Date(AGORA.getTime() - 60 * 60_000).toISOString());
    const pedidos: Mensagem[] = [];
    const caiu: Correio = { nome: "caiu", enviar: async (m) => { pedidos.push(m); throw new ErroEnvioIncerto("Sem resposta do provedor de e-mail"); } };
    await enviarAgenda(db, org, caiu, new Date(AGORA.getTime() - 40 * 60_000), { manual: true });
    // Depois do manual, uma reserva nova: tem de ir no e-mail das 20h.
    await nova(rio, "2028-12-11", "2028-12-13", new Date(AGORA.getTime() - 10 * 60_000).toISOString());
    const correio = new CorreioMemoria();
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 2 });
    expect(correio.enviadas[0]).toMatchObject({ chave: pedidos[0].chave, texto: pedidos[0].texto });
    expect(correio.enviadas[1].chave).not.toBe(pedidos[0].chave);
    expect(correio.enviadas[1].texto).toContain("entrada seg 11/12");
    // A reserva do manual não se repete no das 20h.
    expect(correio.enviadas[1].texto).not.toContain("entrada seg 04/12");
  });

  it("'enviar agora' ainda sem confirmação (menos de 15 min): o das 20h sai sem as reservas dele", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2028-12-04", "2028-12-06", new Date(AGORA.getTime() - 60 * 60_000).toISOString());
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    await enviarAgenda(db, org, caiu, new Date(AGORA.getTime() - 5 * 60_000), { manual: true });
    await nova(rio, "2028-12-11", "2028-12-13", new Date(AGORA.getTime() - 2 * 60_000).toISOString());
    const correio = new CorreioMemoria();
    const r = await enviarAgenda(db, org, correio, AGORA);
    expect(r.enviados).toBe(1);
    expect(r.falhas[0]).toContain("ainda não foi confirmado");
    expect(correio.enviadas[0].texto).toContain("entrada seg 11/12");
    expect(correio.enviadas[0].texto).not.toContain("entrada seg 04/12");
    // No dia seguinte, o manual vira "incerto" e a reserva dele vai com o aviso.
    await enviarAgenda(db, org, correio, new Date("2026-10-02T23:00:00Z"));
    expect(correio.enviadas[1].texto).toContain("entrada seg 04/12");
    expect(correio.enviadas[1].texto).toContain("pode já ter vindo");
  });

  it("tentativa velha de verdade é retomada mesmo quando a execução começou antes (relógio que anda)", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    // Marca "enviando" de 10 minutos antes do início da execução; a execução já rodou 20 minutos.
    await db.insert(appSettings).values({ key: `agenda-diaria:${org}:2026-10-01:a@example.com`, value: { em: new Date(AGORA.getTime() - 10 * 60_000).toISOString(), estado: "enviando", corte: AGORA.toISOString() } });
    const correio = new CorreioMemoria();
    const r = await enviarAgenda(db, org, correio, AGORA, { relogio: () => new Date(AGORA.getTime() + 20 * 60_000) });
    expect(r).toMatchObject({ enviados: 1 });
  });

  it("'enviar agora' com o próprio pedido pendente retoma o dele, não o do agendado", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2028-12-18", "2028-12-20", new Date(AGORA.getTime() - 60 * 60_000).toISOString());
    const pedidos: Mensagem[] = [];
    const caiu: Correio = { nome: "caiu", enviar: async (m) => { pedidos.push(m); throw new ErroEnvioIncerto("Sem resposta do provedor de e-mail"); } };
    // Manual incerto; depois o agendado também incerto (o manual ainda recente: não fechou).
    await enviarAgenda(db, org, caiu, new Date(AGORA.getTime() - 5 * 60_000), { manual: true });
    await enviarAgenda(db, org, caiu, AGORA);
    const manual = pedidos[0];
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 30 * 60_000), { manual: true });
    expect(correio.enviadas[0]).toMatchObject({ chave: manual.chave, texto: manual.texto });
  });

  it("aviso 'pode já ter vindo' só para reserva que estava no envio incerto", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    // Marco de 1h atrás cobrindo só o Rio; Búzios ficou de fora (volta a olhar 24h).
    await db.insert(appSettings).values([
      { key: `agenda-diaria:ultima:${org}:a@example.com`, value: { em: new Date(AGORA.getTime() - 3_600_000).toISOString(), imoveis: [rio] } },
      {
        key: `agenda-diaria:${org}:2026-09-30:a@example.com`,
        value: { em: new Date(AGORA.getTime() - 3_600_000).toISOString(), estado: "incerto", corte: new Date(AGORA.getTime() - 3_600_000).toISOString(), carga: { assunto: "x", texto: "x", eventos: [], imoveis: [rio] } },
      },
    ]);
    await nova(buzios, "2029-01-08", "2029-01-10", new Date(AGORA.getTime() - 2 * 3_600_000).toISOString());
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, AGORA);
    expect(correio.enviadas[0].texto).toContain("entrada seg 08/01");
    expect(correio.enviadas[0].texto).not.toContain("pode já ter vindo");
  });

  it("prévia da tela mostra o mesmo aviso 'pode já ter vindo' do e-mail", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2029-01-15", "2029-01-17", new Date(AGORA.getTime() - 60_000).toISOString());
    const caiu: Correio = { nome: "caiu", enviar: async () => Promise.reject(new ErroEnvioIncerto("Sem resposta do provedor de e-mail")) };
    await enviarAgenda(db, org, caiu, AGORA);
    const { agenda, talvezJaVeio } = await previaDaAgenda(db, org, new Date("2026-10-02T23:00:00Z"));
    const n = agenda.secoes.flatMap((x) => x.novas).find((x) => x.checkin === "2029-01-15");
    expect(n && talvezJaVeio?.(n)).toBe(true);
  });

  it("prévia: aviso 'pode já ter vindo' só de quem recebe a cidade", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }, { email: "b@example.com", cidades: [] }] }, null);
    await nova(rio, "2029-02-05", "2029-02-07", new Date(AGORA.getTime() - 60_000).toISOString());
    // "b" recebeu por último há 2h (a reserva está na janela dele).
    await db.insert(appSettings).values({ key: `agenda-diaria:ultima:${org}:b@example.com`, value: { em: new Date(AGORA.getTime() - 2 * 3_600_000).toISOString() } });
    // "a" fica com o envio incerto; "b" falha de vez.
    const correio: Correio = {
      nome: "misto",
      enviar: async (m) => {
        if (m.para === "a@example.com") throw new ErroEnvioIncerto("Sem resposta do provedor de e-mail");
        throw new Error("Falha ao enviar e-mail (HTTP 422).");
      },
    };
    await enviarAgenda(db, org, correio, AGORA);
    // Agora "a" só recebe Búzios; "b" (Rio) ainda precisa da reserva, sem aviso para ele.
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: ["Armação dos Búzios"] }, { email: "b@example.com", cidades: [] }] }, null);
    const { agenda, talvezJaVeio } = await previaDaAgenda(db, org, new Date("2026-10-02T23:00:00Z"));
    const n = agenda.secoes.flatMap((x) => x.novas).find((x) => x.checkin === "2029-02-05");
    expect(n).toBeTruthy();
    expect(talvezJaVeio?.(n!)).toBe(false);
  });

  it("um endereço cujo provedor demora não segura os outros (envio em paralelo)", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }, { email: "b@example.com", cidades: [] }] }, null);
    let liberaA!: () => void;
    const bSaiu = new Promise<void>((ok) => (liberaA = ok));
    const saiu: string[] = [];
    // "a" só termina depois que "b" saiu: um por vez, "a" estouraria o prazo.
    const correio: Correio = {
      nome: "lento",
      enviar: async (m) => {
        if (m.para === "a@example.com") await bSaiu;
        else liberaA();
        saiu.push(m.para);
      },
    };
    expect(await enviarAgenda(db, org, correio, AGORA, { prazoProvedorMs: 2_000 })).toMatchObject({ enviados: 2, falhas: [] });
    expect(saiu.sort()).toEqual(["a@example.com", "b@example.com"]);
  });

  it("evento substituído por uma nova confirmação não segura o envio incerto", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const dados = reserva(rio, "2028-10-02", "2028-10-04", { codigoCanal: "HMSUB" });
    const r = await sincronizarReserva(db, org, "beds24", "B-SUB", dados);
    if (!r.ok) throw new Error("reserva");
    const antigo = `${r.reserva.id}@${new Date(Date.now() - 3 * 86_400_000).toISOString()}`;
    // Cancelada e confirmada de novo: a confirmação nova é outro evento.
    await sincronizarReserva(db, org, "beds24", "B-SUB", { ...dados, estado: "cancelada" });
    await sincronizarReserva(db, org, "beds24", "B-SUB", dados);
    const ontem = new Date(Date.now() - 2 * 86_400_000);
    const k = `agenda-diaria:${org}:${ontem.toISOString().slice(0, 10)}:a@example.com`;
    await db.insert(appSettings).values({ key: k, value: { em: ontem.toISOString(), estado: "incerto", corte: ontem.toISOString(), carga: { assunto: "x", texto: "x", eventos: [antigo], imoveis: [] } } });
    await enviarAgenda(db, org, new CorreioMemoria(), new Date());
    const [marca] = await db.select().from(appSettings).where(eq(appSettings.key, k));
    expect((marca.value as { estado: string }).estado).toBe("resolvido");
  });

  it("envio incerto só é resolvido quando as reservas dele foram entregues ou não precisam mais de aviso", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const futura = await nova(rio, "2028-10-02", "2028-10-04", new Date(AGORA.getTime() - 3_600_000).toISOString());
    const passada = await nova(rio, "2026-09-20", "2026-09-22", new Date(AGORA.getTime() - 3_600_000).toISOString());
    const k = (data: string) => `agenda-diaria:${org}:${data}:a@example.com`;
    const carga = (id: string) => ({ assunto: "x", texto: "x", eventos: [`${id}@outro-registro`], imoveis: [] });
    await db.insert(appSettings).values([
      { key: k("2026-09-29"), value: { em: "2026-09-29T23:00:00.000Z", estado: "incerto", corte: "2026-09-29T23:00:00.000Z", carga: carga(futura.id) } },
      { key: k("2026-09-30"), value: { em: "2026-09-30T23:00:00.000Z", estado: "incerto", corte: "2026-09-30T23:00:00.000Z", carga: carga(passada.id) } },
    ]);
    await enviarAgenda(db, org, new CorreioMemoria(), AGORA);
    const estado = async (data: string) => ((await db.select().from(appSettings).where(eq(appSettings.key, k(data))))[0].value as { estado: string }).estado;
    // A reserva futura daquele envio não saiu neste (é outro evento): o incerto fica aberto.
    expect(await estado("2026-09-29")).toBe("incerto");
    // A que já terminou não precisa mais de aviso: resolvido.
    expect(await estado("2026-09-30")).toBe("resolvido");
  });

  it("envio incerto aberto por um imóvel de fora não reenvia a cada dia o que já foi entregue", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    // Marco antigo e um incerto de ontem com Rio e Búzios; hoje Búzios está inativo.
    const reservaRio = await nova(rio, "2028-11-06", "2028-11-08", new Date(AGORA.getTime() - 25 * 3_600_000).toISOString());
    await db.insert(appSettings).values([
      { key: `agenda-diaria:ultima:${org}:a@example.com`, value: { em: new Date(AGORA.getTime() - 26 * 3_600_000).toISOString() } },
      {
        key: `agenda-diaria:${org}:2026-09-30:a@example.com`,
        value: { em: "2026-09-30T23:00:00.000Z", estado: "incerto", corte: "2026-09-30T23:00:00.000Z", carga: { assunto: "x", texto: "x", eventos: [], imoveis: [rio, buzios].sort() } },
      },
    ]);
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, buzios));
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, AGORA);
    expect(correio.enviadas[0].texto).toContain("entrada seg 06/11");
    // O incerto continua aberto (Búzios de fora), mas agora só com Búzios.
    const [marca] = await db.select().from(appSettings).where(eq(appSettings.key, `agenda-diaria:${org}:2026-09-30:a@example.com`));
    expect(marca.value).toMatchObject({ estado: "incerto", carga: { imoveis: [buzios] } });
    // Dias seguintes: a reserva do Rio já entregue não volta.
    await enviarAgenda(db, org, correio, new Date("2026-10-02T23:00:00Z"));
    await enviarAgenda(db, org, correio, new Date("2026-10-03T23:00:00Z"));
    expect(correio.enviadas[1].texto).not.toContain("06/11");
    expect(correio.enviadas[2].texto).not.toContain("06/11");
    expect(reservaRio.id).toBeTruthy();
  });

  it("envio incerto de outro dia continua avisado até um envio dar certo", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await nova(rio, "2027-12-06", "2027-12-08", new Date(AGORA.getTime() - 60 * 60_000).toISOString());
    await db.insert(appSettings).values([
      { key: `agenda-diaria:ultima:${org}:a@example.com`, value: { em: "2026-09-30T23:00:00.000Z" } },
      { key: `agenda-diaria:${org}:2026-10-01:a@example.com`, value: { em: AGORA.toISOString(), estado: "enviando", corte: AGORA.toISOString() } },
    ]);
    const dia2 = new Date("2026-10-02T23:00:00Z");
    const recusa: Correio = { nome: "recusa", enviar: async () => Promise.reject(new Error("Falha ao enviar e-mail (HTTP 422).")) };
    expect((await enviarAgenda(db, org, recusa, dia2)).falhas).toHaveLength(1);
    // Nova tentativa no mesmo dia: o aviso continua.
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, new Date(dia2.getTime() + 60_000));
    expect(correio.enviadas[0].texto).toContain("pode já ter vindo numa agenda anterior");
    const [ontem] = await db.select().from(appSettings).where(eq(appSettings.key, `agenda-diaria:${org}:2026-10-01:a@example.com`));
    expect((ontem.value as { estado: string }).estado).toBe("resolvido");
    // Resolvido: no dia seguinte, sem aviso.
    const dia3 = new CorreioMemoria();
    await nova(rio, "2027-12-20", "2027-12-22", new Date(dia2.getTime() + 3_600_000).toISOString());
    await enviarAgenda(db, org, dia3, new Date("2026-10-03T23:00:00Z"));
    expect(dia3.enviadas[0].texto).not.toContain("pode já ter vindo");
  });

  it("reserva avisada, cancelada e confirmada de novo depois é avisada outra vez (é outro evento)", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    const dados = reserva(rio, "2027-07-01", "2027-07-05", { codigoCanal: "HMVOLTA" });
    const r = await sincronizarReserva(db, org, "beds24", "B-2", dados);
    if (!r.ok) throw new Error("reserva");
    await db.update(reservas).set({ criadoEm: new Date(Date.now() - 5 * 60_000) }).where(eq(reservas.id, r.reserva.id));
    const correio = new CorreioMemoria();
    await enviarAgenda(db, org, correio, new Date());
    expect(correio.enviadas[0].texto).toContain("entrada qui 01/07");
    expect((await sincronizarReserva(db, org, "beds24", "B-2", { ...dados, estado: "cancelada" })).ok).toBe(true);
    expect((await sincronizarReserva(db, org, "beds24", "B-2", dados)).ok).toBe(true);
    await enviarAgenda(db, org, correio, new Date(Date.now() + 60_000), { manual: true });
    expect(correio.enviadas[1].texto).toContain("entrada qui 01/07");
  });

  it("criada pendente dentro da faixa e confirmada depois do corte: só a agenda seguinte avisa (uma vez)", async () => {
    const dados = reserva(rio, "2028-02-01", "2028-02-03", { estado: "pendente", codigoCanal: "HMPEND" });
    const r = await sincronizarReserva(db, org, "beds24", "B-3", dados);
    if (!r.ok) throw new Error("reserva");
    const criada = new Date(Date.now() - 60_000);
    await db.update(reservas).set({ criadoEm: criada }).where(eq(reservas.id, r.reserva.id));
    const corte = new Date();
    // Confirmada depois do corte, antes da consulta.
    await new Promise((ok) => setTimeout(ok, 5));
    expect((await sincronizarReserva(db, org, "beds24", "B-3", { ...dados, estado: "confirmada" })).ok).toBe(true);
    const antes = await montarAgenda(db, org, "2026-10-01", new Date(criada.getTime() - 60_000), corte);
    expect(antes.secoes.flatMap((x) => x.novas)).toEqual([]);
    const depois = await montarAgenda(db, org, "2026-10-01", corte, new Date(Date.now() + 60_000));
    expect(depois.secoes.flatMap((x) => x.novas).map((n) => n.checkin)).toEqual(["2028-02-01"]);
  });

  it("cancelada antes do corte e reconfirmada depois: vale o estado no corte (avisa uma vez, na seguinte)", async () => {
    const dados = reserva(rio, "2028-03-01", "2028-03-03", { codigoCanal: "HMVAIVEM" });
    const r = await sincronizarReserva(db, org, "beds24", "B-4", dados);
    if (!r.ok) throw new Error("reserva");
    const desde = new Date(Date.now() - 60_000);
    expect((await sincronizarReserva(db, org, "beds24", "B-4", { ...dados, estado: "cancelada" })).ok).toBe(true);
    await new Promise((ok) => setTimeout(ok, 5));
    const corte = new Date();
    await new Promise((ok) => setTimeout(ok, 5));
    expect((await sincronizarReserva(db, org, "beds24", "B-4", dados)).ok).toBe(true);
    expect((await montarAgenda(db, org, "2026-10-01", desde, corte)).secoes.flatMap((x) => x.novas)).toEqual([]);
    const depois = await montarAgenda(db, org, "2026-10-01", corte, new Date(Date.now() + 60_000));
    expect(depois.secoes.flatMap((x) => x.novas).map((n) => n.checkin)).toEqual(["2028-03-01"]);
  });

  it("horário da última agenda nunca volta (execução antiga que termina depois)", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }] }, null);
    await enviarAgenda(db, org, new CorreioMemoria(), AGORA);
    await enviarAgenda(db, org, new CorreioMemoria(), new Date(AGORA.getTime() - 60_000), { manual: true });
    expect(await ultimaAgenda(db, org)).toEqual(AGORA);
  });

  it("reserva criada depois do corte fica para a próxima agenda (sem repetir)", async () => {
    await nova(rio, "2026-12-20", "2026-12-27", "2026-10-01T23:00:30Z");
    const antes = await montarAgenda(db, org, "2026-10-01", new Date("2026-10-01T22:00:00Z"), AGORA);
    expect(antes.secoes.flatMap((x) => x.novas)).toEqual([]);
    const depois = await montarAgenda(db, org, "2026-10-02", AGORA, new Date("2026-10-02T23:00:00Z"));
    expect(depois.secoes.flatMap((x) => x.novas).map((n) => n.checkin)).toEqual(["2026-12-20"]);
  });

  it("reserva que passou a confirmada depois da última agenda conta como nova", async () => {
    const dados = reserva(rio, "2026-12-01", "2026-12-05", { estado: "pendente", codigoCanal: "HMNOVA" });
    const r = await sincronizarReserva(db, org, "beds24", "B-1", dados);
    if (!r.ok) throw new Error("reserva");
    await db.update(reservas).set({ criadoEm: new Date("2026-09-01T12:00:00Z") }).where(eq(reservas.id, r.reserva.id));
    const desde = new Date(Date.now() - 60_000);
    expect((await montarAgenda(db, org, "2026-10-01", desde)).secoes.flatMap((s) => s.novas)).toEqual([]);
    expect((await sincronizarReserva(db, org, "beds24", "B-1", { ...dados, estado: "confirmada" })).ok).toBe(true);
    const novas = (await montarAgenda(db, org, "2026-10-01", desde)).secoes.flatMap((s) => s.novas);
    expect(novas.map((n) => n.checkin)).toEqual(["2026-12-01"]);
  });


  it("envia uma vez por dia a cada destinatário, com as cidades dele; manual não bloqueia o das 20h", async () => {
    await nova(buzios, "2026-10-03", "2026-10-05", "2026-09-01T12:00:00Z");
    await salvarConfigAgenda(
      db,
      org,
      { ativa: true, destinatarios: [{ email: "rio@example.com", cidades: ["Rio de Janeiro"] }, { email: "buzios@example.com", cidades: ["Armação dos Búzios"] }] },
      null,
    );
    const correio = new CorreioMemoria();
    expect(await enviarAgenda(db, org, correio, AGORA, { manual: true })).toMatchObject({ enviados: 2 });
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 2, jaEnviados: 0 });
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 0, jaEnviados: 2 });
    expect(correio.enviadas).toHaveLength(4);
    const paraRio = correio.enviadas.find((m) => m.para === "rio@example.com")!;
    expect(paraRio.assunto).toBe("Agenda SCL — sex 02/10 a ter 06/10");
    expect(paraRio.texto).not.toContain("Búzios");
    expect(correio.enviadas.find((m) => m.para === "buzios@example.com")!.texto).toContain("• Ana — entrada sáb 03/10 a partir das 15h");
    // Dia seguinte: envia de novo.
    expect(await enviarAgenda(db, org, correio, new Date("2026-10-02T23:00:00Z"))).toMatchObject({ enviados: 2 });
  });

  it("desligada, sem destinatário ou sem provedor: não envia e diz por quê; falha de envio deixa tentar de novo", async () => {
    const correio = new CorreioMemoria();
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 0, aviso: "agenda desligada" });
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "equipe@example.com", cidades: [] }] }, null);
    expect(await enviarAgenda(db, org, null, AGORA)).toMatchObject({ enviados: 0, aviso: expect.stringContaining("sem provedor") });
    const quebrado: Correio = {
      nome: "quebrado",
      enviar: async () => {
        throw new Error("HTTP 500");
      },
    };
    expect(await enviarAgenda(db, org, quebrado, AGORA)).toMatchObject({ enviados: 0, falhas: ["equipe@example.com: HTTP 500"] });
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 1 });
  });

  it("'enviar agora' fica no histórico da organização (não no Sistema) e, repetido no dia, só tenta quem falhou", async () => {
    await salvarConfigAgenda(db, org, { ativa: false, destinatarios: [{ email: "a@example.com", cidades: [] }, { email: "b@example.com", cidades: [] }] }, null);
    const para: string[] = [];
    const meioQuebrado: Correio = {
      nome: "meio",
      enviar: async (m) => {
        if (m.para === "b@example.com") throw new Error("HTTP 500");
        para.push(m.para);
      },
    };
    expect(await agendaManual(db, org, meioQuebrado, AGORA)).toMatchObject({ enviados: 1, falhas: [expect.stringContaining("b@example.com")] });
    const correio = new CorreioMemoria();
    expect(await agendaManual(db, org, correio, new Date(AGORA.getTime() + 60_000))).toMatchObject({ enviados: 1, jaEnviados: 1, falhas: [] });
    expect(correio.enviadas.map((m) => m.para)).toEqual(["b@example.com"]);
    // Nada no histórico comum de automações (é da organização, não do sistema)…
    expect(await db.select().from(execucoesAutomacao).where(eq(execucoesAutomacao.nome, "agenda-diaria"))).toEqual([]);
    // …e sim no histórico dela, sem e-mails.
    const h = (await historicoDe(db, org, "configuracao", org)).filter((x) => x.acao === "agenda.envio_manual");
    expect(h.map((x) => (x.mudancas as Record<string, [unknown, unknown]>).envio[1]).sort()).toEqual(["falhou: 1 enviada(s), 1 falha(s)", "ok: 1 enviada(s), 1 já enviada(s) hoje"]);
    expect(JSON.stringify(h)).not.toContain("@example.com");
    // O das 20h continua valendo para os dois (com a agenda ligada).
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "a@example.com", cidades: [] }, { email: "b@example.com", cidades: [] }] }, null);
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 2 });
  });

  it("execução agendada fica registrada na página Sistema; sem provedor com a agenda ligada é falha", async () => {
    await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: "equipe@example.com", cidades: [] }] }, null);
    expect(await agendaDeTodas(db, new CorreioMemoria(), AGORA)).toBe("1 enviada(s)");
    await expect(agendaDeTodas(db, null, new Date("2026-10-02T23:00:00Z"))).rejects.toThrow("sem provedor");
    const execucoes = await db.select().from(execucoesAutomacao).where(eq(execucoesAutomacao.nome, "agenda-diaria"));
    expect(execucoes.map((e) => e.ok).sort()).toEqual([false, true]);
    expect(execucoes.every((e) => !e.resumo.includes("@"))).toBe(true);
  });
});
