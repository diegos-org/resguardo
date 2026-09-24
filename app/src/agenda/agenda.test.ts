import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { appSettings, execucoesAutomacao, imoveis, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { type Correio, CorreioMemoria, type Mensagem } from "@/email/correio";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva, sincronizarReserva } from "@/reservas/repositorio";
import { enviarAgenda, lerConfigAgenda, montarAgenda, salvarConfigAgenda, textoDaAgenda, ultimaAgenda, ultimaAgendaDe } from "./agenda";
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
    expect(texto).toContain("Limpeza 403 — a confirmar · sem profissional");
    // Só o primeiro nome; sem número de hóspedes, avisa em vez de supor.
    expect(texto).toContain("Entrada 403 — Bruno, nº de hóspedes não informado");
    expect(texto).not.toContain("Fictício");
    expect(texto).not.toContain("22/10");
    // Destinatário só de Búzios não recebe o Rio.
    const soBuzios = textoDaAgenda(a, ["Armação dos Búzios"]);
    expect(soBuzios).not.toContain("Rio de Janeiro");
    expect(soBuzios).toContain("Entrada BZ1");
  });

  it("reservas novas desde a última agenda aparecem mesmo fora da janela; pendentes e canceladas não", async () => {
    await nova(rio, "2026-12-20", "2026-12-27", "2026-10-01T15:00:00Z");
    await nova(rio, "2026-11-01", "2026-11-03", "2026-09-30T15:00:00Z");
    await nova(buzios, "2026-12-01", "2026-12-03", "2026-10-01T15:00:00Z", { estado: "pendente" });
    const a = await montarAgenda(db, org, "2026-10-01", new Date("2026-09-30T23:00:00Z"), AGORA);
    const rj = a.secoes.find((s) => s.cidade === "Rio de Janeiro")!;
    expect(rj.novas.map((n) => n.checkin)).toEqual(["2026-12-20"]);
    expect(a.secoes.find((s) => s.cidade === "Armação dos Búzios")!.novas).toEqual([]);
    expect(textoDaAgenda(a)).toContain("Reservas novas desde a última agenda:\n  - 403: entrada dom 20/12, saída dom 27/12 — Ana, 2 hóspede(s)");
  });
});

describe("configuração e envio", () => {
  it("valida e-mails e cidades; ligar exige destinatário", async () => {
    expect(await lerConfigAgenda(db, org)).toEqual({ ativa: false, destinatarios: [] });
    expect(await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [] }, null)).toMatchObject({ ok: false });
    expect(await salvarConfigAgenda(db, org, { ativa: false, destinatarios: [{ email: "nao-e-email", cidades: [] }] }, null)).toMatchObject({ ok: false });
    expect(await salvarConfigAgenda(db, org, { ativa: false, destinatarios: [{ email: "a@example.com", cidades: ["Niterói"] }] }, null)).toMatchObject({ ok: false });
    expect(
      await salvarConfigAgenda(db, org, { ativa: false, destinatarios: [{ email: "A@example.com", cidades: [] }, { email: "a@example.com", cidades: [] }] }, null),
    ).toMatchObject({ ok: false, erro: expect.stringContaining("repetido") });
    expect(
      await salvarConfigAgenda(db, org, { ativa: true, destinatarios: [{ email: " Equipe@Example.com ", cidades: [] }, { email: "", cidades: [] }] }, null),
    ).toEqual({ ok: true });
    expect(await lerConfigAgenda(db, org)).toEqual({ ativa: true, destinatarios: [{ email: "equipe@example.com", cidades: [] }] });
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
    expect(await enviarAgenda(db, org, correio, AGORA)).toMatchObject({ enviados: 0, jaEnviados: 1 });
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
    expect(await enviarAgenda(db, org, correio, new Date(AGORA.getTime() + 60_000))).toMatchObject({ enviados: 0, jaEnviados: 1 });
    expect(enviadas).toHaveLength(1);
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
    expect((marca.value as { estado: string }).estado).toBe("incerto");
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
    expect(correio.enviadas.find((m) => m.para === "buzios@example.com")!.texto).toContain("Entrada BZ1");
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
