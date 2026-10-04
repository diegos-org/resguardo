import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { imoveis, lancamentos, organizacoes, proprietarioImoveis, proprietarios, repasseItens, repasses, representantes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria, ErroEnvioIncerto, type Mensagem } from "@/email/correio";
import { aplicarMotor } from "@/financeiro/aplicar";
import { chaveTravaMotor, lerComReservasTravadas, travarMotorDaReserva } from "@/financeiro/trava";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { saldoAcerto } from "@/financeiro/ledger";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { emailsDeRepassesDeTodas, repassesDeTodas, rotinaDeRepasses } from "./cron";
import { enviarEmailDoRepasse, enviarEmailsDeRepasses, textoDoEmailDoRepasse } from "./email";
import { partesDisponiveis, partesDoProprietario, resumirPartes } from "./extrato";

// A trava por reserva é espiada para conferir quem a toma (o estorno do recebimento, além do motor e do repasse) e a
// leitura travada, para conferir quais reservas o fechamento pede para travar.
vi.mock("@/financeiro/trava", async (orig) => {
  const m = await orig<typeof import("@/financeiro/trava")>();
  return { ...m, travarMotorDaReserva: vi.fn(m.travarMotorDaReserva), lerComReservasTravadas: vi.fn(m.lerComReservasTravadas) };
});
// A leitura das partes disponíveis é espiada para simular o motor mudando o livro entre a leitura e a trava.
vi.mock("./extrato", async (orig) => {
  const m = await orig<typeof import("./extrato")>();
  return { ...m, partesDisponiveis: vi.fn(m.partesDisponiveis) };
});
import { escolherPeriodicidade, periodicidadeDoProprietario } from "./proprietario";
import { estornarRecebimento, recebimentosDaReserva, registrarRecebimento } from "./recebimentos";
import { lerRegrasRepasses, salvarRegrasRepasses } from "./regras-config";
import { anexarComprovante, arquivoDoComprovante, estornarRepasse, fecharMes, gerarAntecipado, itensDoRepasse, listarRepasses, listarRepassesDaOrganizacao, marcarRepassePago, obterRepasse, preverRepasses } from "./repasses";
import { receberTudo } from "./testes";

let db: Db, close: () => Promise<void>, org: string, a: string, b: string, dono: string, outro: string, reservaBase: string;

const reserva = (imovelId: string, checkin: string, checkout: string): DadosReserva => ({
  imovelId, origem: "booking", estado: "confirmada", checkin, checkout, hospedes: 2, hospedeNome: "Hóspede Fictício", hospedeEmail: "", hospedeTelefone: "", hospedeOrigem: "", moeda: "BRL",
  valorBruto: 100000, taxaCanal: 15000, valorLiquido: null, codigoCanal: "", observacoes: "",
});
const criar = async (dados: DadosReserva, receberEm?: string) => {
  const r = await criarReserva(db, org, dados, null);
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  if (receberEm) await receberTudo(db, org, r.reserva.id, receberEm);
  return r.reserva;
};
const partes = (hoje: string, quem = dono) => partesDoProprietario(db, org, quem, new Date(`${hoje}T12:00:00-03:00`));
const saldo = (fim: string) => saldoAcerto(db, org, { proprietarioId: dono, fim });
const direitos = (reservaId: string) => db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), eq(lancamentos.tipo, "direito_proprietario"))).orderBy(lancamentos.competencia);
const comprovante = { texto: "E2E-PIX-123", arquivo: { nome: "comprovante.pdf", tipo: "application/pdf", conteudo: Buffer.from("%PDF-1.4 comprovante fictício") } };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: a }, { id: b }] = await db.insert(imoveis).values([{ organizacaoId: org, codigo: "403", nome: "Quatro" }, { organizacaoId: org, codigo: "102", nome: "Um" }]).returning();
  [{ id: dono }, { id: outro }] = await db
    .insert(proprietarios)
    .values([{ organizacaoId: org, nome: "Dona Exemplo", email: "dona@example.com", chavePix: "dona@example.com" }, { organizacaoId: org, nome: "Outro Dono", email: "outro@example.com", chavePix: "" }])
    .returning();
  await db.insert(proprietarioImoveis).values([{ proprietarioId: dono, imovelId: a }, { proprietarioId: outro, imovelId: b }]);
  await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  await criarContrato(db, org, b, { tipo: "marketplace", comissao: "", inicio: "2025-01-01" }, null);
  // Booking: a empresa recebe. Bruto 1.000, taxa 150, comissão 15% de 850 = 127,50 → proprietário 722,50.
  reservaBase = (await criar(reserva(a, "2026-10-10", "2026-10-13"))).id;
});
afterEach(() => close());

describe("recebimento registrado à mão (M4.10)", () => {
  it("valida data, valor e reserva; soma no extrato; estorno desfaz", async () => {
    expect(await registrarRecebimento(db, org, { reservaId: reservaBase, data: "2026-10-20", valor: 85000, nota: "" }, null, "2026-10-12")).toMatchObject({ ok: false, erro: expect.stringContaining("futuro") });
    expect(await registrarRecebimento(db, org, { reservaId: reservaBase, data: "2026-10-10", valor: 0, nota: "" }, null, "2026-10-12")).toMatchObject({ ok: false });
    expect(await registrarRecebimento(db, org, { reservaId: "nada", data: "2026-10-10", valor: 1, nota: "" }, null, "2026-10-12")).toMatchObject({ ok: false });
    const r1 = await registrarRecebimento(db, org, { reservaId: reservaBase, data: "2026-10-10", valor: 50000, nota: "1ª parte" }, null, "2026-10-12");
    expect(r1.ok).toBe(true);
    let [p] = await partes("2026-10-12");
    expect(p).toMatchObject({ situacao: "a_liberar", motivo: "Recebido R$ 500,00 de R$ 850,00: libera quando o restante entrar.", recebido: { recebido: 50000, devido: 85000 } });
    await registrarRecebimento(db, org, { reservaId: reservaBase, data: "2026-10-11", valor: 35000, nota: "" }, null, "2026-10-12");
    [p] = await partes("2026-10-12");
    expect(p.situacao).toBe("disponivel");
    expect(await recebimentosDaReserva(db, org, reservaBase)).toHaveLength(2);
    expect(await estornarRecebimento(db, org, (r1 as { id: string }).id, "", null)).toMatchObject({ ok: false });
    expect(await estornarRecebimento(db, org, (r1 as { id: string }).id, "lançado na reserva errada", null)).toMatchObject({ ok: true });
    expect(await recebimentosDaReserva(db, org, reservaBase)).toHaveLength(1);
    [p] = await partes("2026-10-12");
    expect(p).toMatchObject({ situacao: "a_liberar", recebido: { recebido: 35000 } });
    // O recebimento não mexe no resultado nem no acerto.
    expect(await saldo("2026-11-01")).toBe(72250);
  });
});

describe("repasse antecipado (M4.10)", () => {
  it("sem recebimento nada é antecipado; recebido e com check-in até ontem, o antecipado reúne tudo uma vez só", async () => {
    expect(await gerarAntecipado(db, org, dono, "2026-10-12", null)).toMatchObject({ ok: false, erro: expect.stringContaining("Nada disponível") });
    await receberTudo(db, org, reservaBase, "2026-10-10");
    // Check-in hoje ainda não libera; a partir do dia seguinte, sim.
    expect((await partes("2026-10-10"))[0]).toMatchObject({ situacao: "a_liberar", motivo: expect.stringContaining("depois do check-in") });
    expect((await partes("2026-10-11"))[0].situacao).toBe("disponivel");
    expect(await gerarAntecipado(db, org, dono, "2026-10-10", null)).toMatchObject({ ok: false });
    const g = await gerarAntecipado(db, org, dono, "2026-10-11", null);
    expect(g.ok).toBe(true);
    const r = (await obterRepasse(db, org, (g as { id: string }).id))!;
    expect(r).toMatchObject({ tipo: "antecipado", data: "2026-10-11", mes: "2026-10-01", valor: 72250, saldo: 72250, descontado: 0, situacao: "a_pagar", emailSituacao: "pendente", pedidoEm: null });
    // Um lançamento "repasse" na competência da parte (outubro), que zera o acerto da parte.
    const lancs = await db.select().from(lancamentos).where(and(eq(lancamentos.organizacaoId, org), eq(lancamentos.tipo, "repasse")));
    expect(lancs).toHaveLength(1);
    expect(lancs[0]).toMatchObject({ efeitoSaldo: -72250, competencia: "2026-10-01", imovelId: a, proprietarioId: dono, estado: "previsto" });
    expect(lancs[0].descricao).toContain("Repasse antecipado de 11/10/2026");
    expect(await saldo("2026-11-01")).toBe(0);
    const itens = await itensDoRepasse(db, org, r.id);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ reservaId: reservaBase, valor: 72250, competencia: "2026-10-01", codigoImovel: "403", parcial: false });
    expect((await partes("2026-10-12"))[0]).toMatchObject({ situacao: "repassado", motivo: "Repasse de 11/10/2026 (a pagar)." });
    // Nunca duas vezes: no mesmo dia (índice) e no dia seguinte (nada disponível).
    expect(await gerarAntecipado(db, org, dono, "2026-10-11", null)).toMatchObject({ ok: false, erro: expect.stringContaining("Já existe") });
    expect(await gerarAntecipado(db, org, dono, "2026-10-12", null)).toMatchObject({ ok: false, erro: expect.stringContaining("Nada disponível") });
    expect(resumirPartes(await partes("2026-10-12"))).toMatchObject({ disponivel: 0, repassadoAPagar: 72250 });
    expect(await listarRepasses(db, org, dono)).toHaveLength(1);
    expect(await listarRepassesDaOrganizacao(db, org, { tipo: "antecipado" })).toHaveLength(1);
    // Outra organização não vê nem gera.
    const [{ id: outraOrg }] = await db.insert(organizacoes).values({ nome: "B" }).returning();
    expect(await gerarAntecipado(db, outraOrg, dono, "2026-10-12", null)).toMatchObject({ ok: false, erro: "Proprietário não encontrado." });
    expect(await obterRepasse(db, outraOrg, r.id)).toBeNull();
  });

  it("no dia 1º não há antecipado: o fechamento é o único repasse do dia", async () => {
    await receberTudo(db, org, reservaBase, "2026-10-10");
    expect(await gerarAntecipado(db, org, dono, "2026-11-01", null)).toMatchObject({ ok: false, erro: expect.stringContaining("dia 1º") });
  });

  it("reserva que atravessa o mês é paga inteira, um lançamento por competência, e cada fechamento fecha zerado; o avulso do portal fica marcado", async () => {
    const r2 = await criar(reserva(a, "2026-10-30", "2026-11-02"), "2026-10-30"); // 3 noites: 2 em outubro, 1 em novembro
    const g = await gerarAntecipado(db, org, dono, "2026-10-31", null, { pedidoPeloProprietario: true });
    expect(g.ok).toBe(true);
    const rep = (await obterRepasse(db, org, (g as { id: string }).id))!;
    expect(rep.valor).toBe(72250);
    expect(rep.pedidoEm).not.toBeNull();
    const lancs = (await db.select().from(lancamentos).where(and(eq(lancamentos.organizacaoId, org), eq(lancamentos.tipo, "repasse")))).sort((x, y) => x.competencia.localeCompare(y.competencia));
    expect(lancs.map((l) => [l.competencia, l.efeitoSaldo])).toEqual([["2026-10-01", -48167], ["2026-11-01", -24083]]);
    const itens = await itensDoRepasse(db, org, rep.id);
    expect(itens.map((i) => [i.competencia, i.valor, i.parcial])).toEqual([["2026-10-01", 48167, false], ["2026-11-01", 24083, false]]);
    // Fechamento de outubro: a reserva base (não recebida) fica fora; a atravessada já está paga → nada a repassar.
    const [p] = await preverRepasses(db, org, "2026-10", "2026-11-01");
    expect(p).toMatchObject({ valor: 0, fora: 72250, antecipado: 0 });
    expect(p.avisos.join(" ")).toContain("ficam fora deste repasse");
    expect(await fecharMes(db, org, dono, "2026-10", "2026-11-01", null)).toMatchObject({ ok: false, erro: "Nada a repassar neste mês." });
    // Recebida a base, o fechamento paga só ela e vincula só a parte dela.
    await receberTudo(db, org, reservaBase, "2026-11-01");
    const f = await fecharMes(db, org, dono, "2026-10", "2026-11-01", null);
    expect(f.ok).toBe(true);
    const fech = (await obterRepasse(db, org, (f as { id: string }).id))!;
    expect(fech).toMatchObject({ tipo: "fechamento", data: "2026-11-01", valor: 72250, foraDoFechamento: 0, antecipado: 0 });
    expect((await itensDoRepasse(db, org, fech.id)).map((i) => i.reservaId)).toEqual([reservaBase]);
    expect(await saldo("2026-11-01")).toBe(0);
    // Novembro fecha zerado (a parte de novembro já foi paga pelo antecipado).
    expect((await preverRepasses(db, org, "2026-11", "2026-12-01", undefined, true))[0]).toMatchObject({ valor: 0, deve: 0 });
    expect((await partes("2026-12-01")).map((x) => [x.reservaId === r2.id ? "r2" : "base", x.competencia, x.situacao])).toEqual([
      ["base", "2026-10-01", "repassado"],
      ["r2", "2026-10-01", "repassado"],
      ["r2", "2026-11-01", "repassado"],
    ]);
  });

  it("fechamento: exclui o que não foi recebido (vai para o seguinte) e inclui como adiantamento as noites de meses seguintes já disponíveis", async () => {
    const r2 = await criar(reserva(a, "2026-10-31", "2026-11-03"), "2026-10-31"); // 1 noite em outubro, 2 em novembro; recebida
    const [p] = await preverRepasses(db, org, "2026-10", "2026-11-01");
    // Base (72.250) não recebida fica fora; r2: 24.083 de outubro + 48.167 de novembro antecipados.
    expect(p).toMatchObject({ saldo: 72250 + 24083, fora: 72250, antecipado: 48167, valor: 24083 + 48167 });
    expect(p.itens.map((x) => [x.reservaId === r2.id, x.competencia])).toEqual([[true, "2026-10-01"], [true, "2026-11-01"]]);
    expect(p.foraDoFechamento.map((x) => x.reservaId)).toEqual([reservaBase]);
    expect(p.avisos.join(" ")).toContain("entram neste repasse como adiantamento");
    const f = await fecharMes(db, org, dono, "2026-10", "2026-11-01", null);
    expect(f.ok).toBe(true);
    const fech = (await obterRepasse(db, org, (f as { id: string }).id))!;
    expect(fech).toMatchObject({ valor: 72250, foraDoFechamento: 72250, antecipado: 48167 });
    const lancs = (await db.select().from(lancamentos).where(and(eq(lancamentos.organizacaoId, org), eq(lancamentos.tipo, "repasse")))).sort((x, y) => x.competencia.localeCompare(y.competencia));
    expect(lancs.map((l) => [l.competencia, l.efeitoSaldo])).toEqual([["2026-10-31", -24083], ["2026-11-01", -48167]]);
    expect(lancs[1].descricao).toContain("adiantamento das noites de novembro de 2026");
    // Depois do fechamento, o que ficou fora aparece como aviso (não como "mudança"), e vai para o repasse seguinte.
    const [depois] = await preverRepasses(db, org, "2026-10", "2026-11-02");
    expect(depois.diferencaPosFechamento).toBe(0);
    expect(depois.avisos.join(" ")).toContain("ficaram fora deste repasse");
    // Saldo até outubro: só a base (72.250), que ainda não foi paga.
    expect(await saldo("2026-11-01")).toBe(72250);
    // Recebida a base em novembro, o antecipado seguinte paga ela; novembro fecha com r2 já paga.
    await receberTudo(db, org, reservaBase, "2026-11-05");
    expect(await gerarAntecipado(db, org, dono, "2026-11-06", null)).toMatchObject({ ok: true });
    expect(await saldo("2026-12-01")).toBe(0);
    expect((await preverRepasses(db, org, "2026-11", "2026-12-01", undefined, true))[0]).toMatchObject({ valor: 0 });
  });

  it("pagar com comprovante: partes viram realizadas e o arquivo fica guardado; estornar libera as partes, volta a previsto e só o mais recente", async () => {
    await receberTudo(db, org, reservaBase, "2026-10-10");
    const g = await gerarAntecipado(db, org, dono, "2026-10-11", null);
    const id = (g as { id: string }).id;
    expect(await marcarRepassePago(db, org, id, "2026-10-10", "2026-10-12", null)).toMatchObject({ ok: false, erro: expect.stringContaining("antes de 11/10/2026") });
    expect(await marcarRepassePago(db, org, id, "2026-10-11", "2026-10-12", null, { texto: "", arquivo: { nome: "x.gif", tipo: "image/gif", conteudo: Buffer.from("x") } })).toMatchObject({ ok: false, erro: expect.stringContaining("PDF, PNG ou JPG") });
    expect(await marcarRepassePago(db, org, id, "2026-10-11", "2026-10-12", null, comprovante)).toMatchObject({ ok: true });
    expect((await direitos(reservaBase))[0]).toMatchObject({ estado: "realizado", dataCaixa: "2026-10-11" });
    const r = (await obterRepasse(db, org, id))!;
    expect(r).toMatchObject({ situacao: "pago", dataPagamento: "2026-10-11", comprovante: "E2E-PIX-123" });
    expect(r.comprovanteArquivoId).not.toBeNull();
    const arq = await arquivoDoComprovante(db, org, id);
    expect(arq).toMatchObject({ nome: "comprovante.pdf", tipo: "application/pdf" });
    expect(arq!.conteudo.equals(comprovante.arquivo.conteudo)).toBe(true);
    expect((await partes("2026-10-12"))[0].motivo).toBe("Repasse de 11/10/2026 (pago em 11/10/2026).");
    // Sem comprovante: fica "pago sem comprovante" e dá para anexar depois.
    const r2 = await criar(reserva(a, "2026-10-12", "2026-10-14"), "2026-10-12");
    const g2 = await gerarAntecipado(db, org, dono, "2026-10-13", null);
    const id2 = (g2 as { id: string }).id;
    expect(await marcarRepassePago(db, org, id2, "2026-10-13", "2026-10-13", null)).toMatchObject({ ok: true });
    expect((await obterRepasse(db, org, id2))!).toMatchObject({ comprovante: "", comprovanteArquivoId: null });
    expect(await anexarComprovante(db, org, id2, { texto: "", arquivo: null }, null)).toMatchObject({ ok: false });
    expect(await anexarComprovante(db, org, id2, { texto: "PIX-2", arquivo: null }, null)).toMatchObject({ ok: true });
    expect((await obterRepasse(db, org, id2))!.comprovante).toBe("PIX-2");
    // Estorno: o mais antigo não pode enquanto houver um posterior.
    expect(await estornarRepasse(db, org, id, "engano", "2026-10-14", null)).toMatchObject({ ok: false, erro: expect.stringContaining("antecipado posterior") });
    expect(await estornarRepasse(db, org, id2, "engano", "2026-10-14", null)).toMatchObject({ ok: true });
    expect((await direitos(r2.id))[0].estado).toBe("previsto");
    expect(await db.select().from(repasseItens).where(eq(repasseItens.repasseId, id2))).toMatchObject([{ liberadoEm: expect.any(Date) }]);
    expect((await partes("2026-10-14")).find((x) => x.reservaId === r2.id)).toMatchObject({ situacao: "disponivel" });
    // Liberada, a parte entra no próximo antecipado.
    expect(await gerarAntecipado(db, org, dono, "2026-10-14", null)).toMatchObject({ ok: true });
    expect(await saldo("2026-11-01")).toBe(0);
  });
});

describe("recálculo do motor com parte já em repasse (M4.10)", () => {
  it("parte vinculada a um repasse a pagar fica protegida: o cálculo novo não é aplicado, a reserva vai para conferência e o repasse ainda pode ser pago", async () => {
    await receberTudo(db, org, reservaBase, "2026-10-10");
    const g = await gerarAntecipado(db, org, dono, "2026-10-11", null);
    expect(g.ok).toBe(true);
    const id = (g as { id: string }).id;
    const antes = await direitos(reservaBase);
    // Regra diferente (base bruta em vez de líquida) mudaria a parte do proprietário: com a parte em repasse, nada muda.
    const r = await aplicarMotor(db, org, reservaBase, null, { base: "bruto", recebimento: { airbnb: "split", booking: "empresa", site: "empresa", direta: "empresa", outro: "empresa" } });
    expect(r).toMatchObject({ protegido: true, criados: 0, estornados: 0 });
    expect(r!.avisos.join(" ")).toContain("já compõe um repasse");
    expect(await direitos(reservaBase)).toEqual(antes);
    expect((await partes("2026-10-12"))[0]).toMatchObject({ situacao: "repassado", emConferencia: true });
    // A conferência (M4.8) segura o fechamento, mas o repasse já gerado segue o fluxo normal.
    expect((await preverRepasses(db, org, "2026-10", "2026-11-01", undefined, true))[0].bloqueios.join(" ")).toContain("acerto pendente");
    expect(await marcarRepassePago(db, org, id, "2026-10-11", "2026-10-12", null, comprovante)).toMatchObject({ ok: true });
    expect((await direitos(reservaBase))[0].estado).toBe("realizado");
    // Estornado o repasse, a parte volta a previsto e o recálculo passa a valer.
    expect(await estornarRepasse(db, org, id, "refazer", "2026-10-12", null)).toMatchObject({ ok: true });
    const r2 = await aplicarMotor(db, org, reservaBase, null, { base: "bruto", recebimento: { airbnb: "split", booking: "empresa", site: "empresa", direta: "empresa", outro: "empresa" } });
    expect(r2!.protegido).toBeFalsy();
    expect(r2!.estornados).toBeGreaterThan(0);
    expect(r2!.criados).toBeGreaterThan(0);
  });
});

describe("periodicidade do proprietário e rotina diária (M4.10)", () => {
  it("escolha do proprietário, padrão por contrato (mais frequente) e próxima data; a escolha fica no histórico", async () => {
    expect(await periodicidadeDoProprietario(db, org, dono, "2026-10-10")).toMatchObject({ escolha: null, efetiva: "mensal", tiposContrato: ["gestao_completa"], proximaData: "2026-11-01" });
    await salvarRegrasRepasses(db, org, { ...(await lerRegrasRepasses(db, org)), padraoPorContrato: { gestao_completa: "mensal", gestao_online: "mensal", marketplace: "semanal" } }, null);
    expect(await periodicidadeDoProprietario(db, org, outro, "2026-10-10")).toMatchObject({ efetiva: "semanal", proximaData: "2026-10-12" });
    expect(await escolherPeriodicidade(db, org, dono, "quinzenal" as never, null, { peloProprietario: true })).toMatchObject({ ok: true });
    expect(await escolherPeriodicidade(db, org, dono, "diaria" as never, null)).toMatchObject({ ok: false });
    expect(await periodicidadeDoProprietario(db, org, dono, "2026-10-10")).toMatchObject({ escolha: "quinzenal", efetiva: "quinzenal", proximaData: "2026-10-16" });
    expect(await escolherPeriodicidade(db, org, dono, null, null)).toMatchObject({ ok: true });
    expect((await periodicidadeDoProprietario(db, org, dono, "2026-10-10"))!.efetiva).toBe("mensal");
    expect(await periodicidadeDoProprietario(db, org, "x", "2026-10-10")).toBeNull();
  });

  it("rotina: gera para quem está no dia (semanal na segunda, 'assim que disponível' todo dia), não para o mensal nem no dia 1º; e-mails saem só de repasse pago com comprovante", async () => {
    await receberTudo(db, org, reservaBase, "2026-10-10");
    const correio = new CorreioMemoria();
    // Terça 13/10: dono mensal → nada; dono "assim que disponível" → gera.
    let r = await rotinaDeRepasses(db, org, correio, new Date("2026-10-13T11:00:00Z"));
    expect(r).toMatchObject({ gerados: 0, semDisponivel: 0 });
    await escolherPeriodicidade(db, org, dono, "disponivel", null);
    r = await rotinaDeRepasses(db, org, correio, new Date("2026-10-13T11:00:00Z"));
    expect(r).toMatchObject({ gerados: 1 });
    const [rep] = await listarRepasses(db, org, dono);
    expect(rep).toMatchObject({ tipo: "antecipado", data: "2026-10-13", valor: 72250 });
    // Mesmo dia de novo (rotina e botão): nada gerado, nada duplicado.
    r = await rotinaDeRepasses(db, org, correio, new Date("2026-10-13T11:30:00Z"));
    expect(r).toMatchObject({ gerados: 0, semDisponivel: 1 });
    // Semanal: só na segunda (19/10), e no dia 1º nunca.
    await escolherPeriodicidade(db, org, dono, "semanal", null);
    await criar(reserva(a, "2026-10-14", "2026-10-16"), "2026-10-14");
    expect(await rotinaDeRepasses(db, org, correio, new Date("2026-10-15T11:00:00Z"))).toMatchObject({ gerados: 0 });
    expect(await rotinaDeRepasses(db, org, correio, new Date("2026-10-19T11:00:00Z"))).toMatchObject({ gerados: 1 });
    expect(await rotinaDeRepasses(db, org, correio, new Date("2026-11-01T11:00:00Z"))).toMatchObject({ gerados: 0 });
    // E-mail: pago sem comprovante espera; com comprovante sai uma vez, com as reservas e o anexo; representante em cópia.
    await db.insert(representantes).values({ proprietarioId: dono, nome: "Rep", email: "rep@example.com", recebeRelatorios: true });
    await marcarRepassePago(db, org, rep.id, "2026-10-13", "2026-10-13", null);
    r = await rotinaDeRepasses(db, org, correio, new Date("2026-10-20T11:00:00Z"));
    expect(r.emails).toMatchObject({ enviados: 0, semComprovante: 1 });
    await anexarComprovante(db, org, rep.id, comprovante, null);
    r = await rotinaDeRepasses(db, org, correio, new Date("2026-10-20T11:00:00Z"));
    expect(r.emails).toMatchObject({ enviados: 1, semComprovante: 0 });
    expect(correio.enviadas).toHaveLength(1);
    const m = correio.enviadas[0];
    expect(m).toMatchObject({ para: "dona@example.com", copias: ["rep@example.com"], chave: `repasse:${rep.id}:email`, conteudoRestrito: true });
    expect(m.assunto).toBe("Repasse de 13/10/2026 — A");
    expect(m.texto).toContain("R$ 722,50 em 13/10/2026");
    expect(m.texto).toContain("Identificador do Pix: E2E-PIX-123");
    expect(m.texto).toContain("403 · Hóspede Fictício · 10/10/2026 a 13/10/2026 · R$ 722,50 (integral)");
    expect(m.anexos?.[0]).toMatchObject({ nome: "comprovante.pdf" });
    expect((await obterRepasse(db, org, rep.id))!).toMatchObject({ emailSituacao: "enviado", emailPara: "dona@example.com, rep@example.com" });
    // Não repete; reenvio pedido por pessoa usa chave nova.
    expect(await enviarEmailsDeRepasses(db, org, correio, new Date("2026-10-21T11:00:00Z"))).toMatchObject({ enviados: 0 });
    expect(await enviarEmailDoRepasse(db, org, rep.id, correio, new Date("2026-10-21T12:00:00Z"), { reenviar: true })).toBe("enviado");
    expect(correio.enviadas).toHaveLength(2);
    expect(correio.enviadas[1].chave).not.toBe(m.chave);
    // Execução de todas as organizações registra o resumo.
    const resumo = await repassesDeTodas(db, correio, new Date("2026-10-26T11:00:00Z"));
    expect(resumo).toContain("repasse(s) antecipado(s) gerado(s)");
  });

  it("e-mail incerto: repete com a mesma chave dentro da janela; fora dela fica incerto e espera uma pessoa; recusa certa volta a pendente", async () => {
    await receberTudo(db, org, reservaBase, "2026-10-10");
    const g = await gerarAntecipado(db, org, dono, "2026-10-11", null);
    const id = (g as { id: string }).id;
    await marcarRepassePago(db, org, id, "2026-10-11", "2026-10-12", null, comprovante);
    let falhar: "incerto" | "recusa" | null = "incerto";
    const enviadas: Mensagem[] = [];
    const correio = {
      nome: "teste",
      async enviar(m: Mensagem) {
        if (falhar === "incerto") throw new ErroEnvioIncerto("caiu");
        if (falhar === "recusa") throw new Error("HTTP 422");
        enviadas.push(m);
      },
    };
    const t0 = new Date("2026-10-12T12:00:00Z");
    expect(await enviarEmailDoRepasse(db, org, id, correio, t0)).toBe("incerto");
    expect((await obterRepasse(db, org, id))!).toMatchObject({ emailSituacao: "incerto", emailEm: t0 });
    // Logo depois: aguarda; 20 minutos depois, dentro da janela, repete com a mesma chave — e o MESMO pedido da
    // tentativa incerta (destinatários, texto, anexo), mesmo que cadastro e comprovante tenham mudado no meio.
    expect(await enviarEmailDoRepasse(db, org, id, correio, new Date(t0.getTime() + 60_000))).toBe("aguardando");
    await db.update(proprietarios).set({ email: "novo@example.com", nome: "Dona Nova" }).where(eq(proprietarios.id, dono));
    expect(await anexarComprovante(db, org, id, { texto: "", arquivo: { nome: "novo.pdf", tipo: "application/pdf", conteudo: Buffer.from("%PDF-1.4 novo") } }, null)).toMatchObject({ ok: true });
    falhar = null;
    // É a rotina de hora em hora (só e-mails, registrada na página Sistema) que faz essa retomada dentro da janela da chave.
    expect(await emailsDeRepassesDeTodas(db, correio, new Date(t0.getTime() + 20 * 60_000))).toBe("1 e-mail(s) enviado(s)");
    expect(await enviarEmailDoRepasse(db, org, id, correio, new Date(t0.getTime() + 20 * 60_000))).toBe("ja_enviado");
    expect(enviadas[0]).toMatchObject({ chave: `repasse:${id}:email`, para: "dona@example.com" });
    expect(enviadas[0].texto).toContain("Olá, Dona Exemplo.");
    expect(enviadas[0].anexos?.[0]?.nome).toBe("comprovante.pdf");
    expect((await obterRepasse(db, org, id))!.emailPara).toBe("dona@example.com");
    // Fora da janela: fica incerto até alguém reenviar; o reenvio (tentativa nova) já vai para o endereço atual.
    await db.update((await import("@/db/schema")).repasses).set({ emailSituacao: "incerto", emailEm: new Date(t0.getTime() - 30 * 3_600_000), emailTentativaEm: new Date(t0.getTime() - 30 * 3_600_000) }).where(eq((await import("@/db/schema")).repasses.id, id));
    expect(await enviarEmailDoRepasse(db, org, id, correio, t0)).toBe("incerto");
    expect(await enviarEmailDoRepasse(db, org, id, correio, t0, { reenviar: true })).toBe("enviado");
    expect(enviadas[1]).toMatchObject({ para: "novo@example.com" });
    expect(enviadas[1].texto).toContain("Olá, Dona Nova.");
    expect(enviadas[1].anexos?.[0]?.nome).toBe("novo.pdf");
    // Recusa certa: volta a pendente.
    await db.update((await import("@/db/schema")).repasses).set({ emailSituacao: "pendente" }).where(eq((await import("@/db/schema")).repasses.id, id));
    falhar = "recusa";
    expect(await enviarEmailDoRepasse(db, org, id, correio, t0)).toBe("falhou");
    expect((await obterRepasse(db, org, id))!.emailSituacao).toBe("pendente");
    expect(await enviarEmailDoRepasse(db, org, id, null, t0)).toBe("sem_provedor");
    // Texto puro do e-mail do fechamento menciona o que ficou fora e o antecipado.
    const texto = textoDoEmailDoRepasse({ ...(await obterRepasse(db, org, id))!, tipo: "fechamento", mes: "2026-10-01", saldo: 1000, descontado: 200, contestado: 0, foraDoFechamento: 300, antecipado: 400, valor: 900 }, [], "SCL");
    expect(texto.assunto).toBe("Repasse do fechamento de outubro de 2026 — SCL");
    expect(texto.texto).toContain("R$ 3,00 ficaram para o próximo repasse");
    expect(texto.texto).toContain("R$ 4,00 de noites de meses seguintes já pagos");
  });
});

describe("2ª rodada do Codex: trava das reservas no repasse, estorno do recebimento e candidatos ao antecipado", () => {
  it("quem repassa trava a mesma chave que o motor usa para recalcular a reserva", () => {
    expect(chaveTravaMotor("org-1", "res-1")).toBe("motor:org-1:res-1");
  });

  it("o antecipado vale pelo que foi lido com as reservas travadas: parte que a releitura não confirma fica de fora", async () => {
    await receberTudo(db, org, reservaBase, "2026-10-10");
    // Outra reserva do mesmo dono, sem recebimento: na leitura certa ela não está disponível.
    await criar(reserva(a, "2026-10-01", "2026-10-03"));
    // 1ª leitura (antes da trava) devolve até a parte não disponível, como se o motor a tivesse mudado no meio;
    // a releitura, já com as reservas travadas, é a que decide.
    vi.mocked(partesDisponiveis).mockImplementationOnce(async (d, o, p, agora) => partesDoProprietario(d, o, p, agora));
    const g = await gerarAntecipado(db, org, dono, "2026-10-12", null);
    expect(g.ok).toBe(true);
    const itens = await itensDoRepasse(db, org, (g as { id: string }).id);
    expect(itens.map((i) => i.reservaId)).toEqual([reservaBase]);
    expect((await obterRepasse(db, org, (g as { id: string }).id))!.valor).toBe(72250);
    expect(vi.mocked(partesDisponiveis).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("se a cada releitura aparece reserva nova, recusa com aviso e não grava nada", async () => {
    await receberTudo(db, org, reservaBase, "2026-10-10");
    let n = 0;
    for (let i = 0; i < 8; i++) {
      vi.mocked(partesDisponiveis).mockImplementationOnce(async (d, o, p, agora) => (await partesDoProprietario(d, o, p, agora)).map((x) => ({ ...x, reservaId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` })));
    }
    expect(await gerarAntecipado(db, org, dono, "2026-10-12", null)).toMatchObject({ ok: false, erro: expect.stringContaining("recalculadas") });
    vi.mocked(partesDisponiveis).mockReset();
    expect(await listarRepassesDaOrganizacao(db, org, { tipo: "antecipado" })).toHaveLength(0);
    expect(await db.select().from(repasseItens)).toHaveLength(0);
  });

  it("recebimento não é estornado enquanto a parte compõe um repasse a pagar; estornado o repasse (ou pago), pode", async () => {
    const rec = await registrarRecebimento(db, org, { reservaId: reservaBase, data: "2026-10-10", valor: 85000, nota: "" }, null, "2026-10-12");
    expect(rec.ok).toBe(true);
    const idRec = (rec as { id: string }).id;
    const g = await gerarAntecipado(db, org, dono, "2026-10-12", null);
    expect(g.ok).toBe(true);
    expect(await estornarRecebimento(db, org, idRec, "lançado errado", null)).toMatchObject({ ok: false, erro: expect.stringContaining("repasse antecipado de 12/10/2026, ainda não pago: estorne o repasse") });
    expect(await recebimentosDaReserva(db, org, reservaBase)).toHaveLength(1);
    expect(await estornarRepasse(db, org, (g as { id: string }).id, "refazer", "2026-10-12", null)).toMatchObject({ ok: true });
    expect(await estornarRecebimento(db, org, idRec, "lançado errado", null)).toMatchObject({ ok: true });
    expect(await recebimentosDaReserva(db, org, reservaBase)).toHaveLength(0);
    // Repasse já pago: o dinheiro saiu; a correção do recebimento é permitida (ajuste manual depois).
    const rec2 = await registrarRecebimento(db, org, { reservaId: reservaBase, data: "2026-10-10", valor: 85000, nota: "" }, null, "2026-10-13");
    const g2 = await gerarAntecipado(db, org, dono, "2026-10-13", null);
    expect(g2.ok).toBe(true);
    expect(await marcarRepassePago(db, org, (g2 as { id: string }).id, "2026-10-13", "2026-10-13", null, comprovante)).toMatchObject({ ok: true });
    expect(await estornarRecebimento(db, org, (rec2 as { id: string }).id, "conferido com o banco", null)).toMatchObject({ ok: true });
  });

  it("o fechamento trava toda reserva de que o cálculo depende (não só as partes que paga) e relê com a trava", async () => {
    await receberTudo(db, org, reservaBase, "2026-10-10");
    // Outra reserva do mesmo dono sem recebimento: fica fora do fechamento, mas entra no saldo — também precisa estar travada,
    // senão o motor pode trocá-la entre a leitura do saldo e a das partes (6ª rodada do Codex).
    const fora = (await criar(reserva(a, "2026-10-01", "2026-10-03"))).id;
    vi.mocked(lerComReservasTravadas).mockClear();
    const f = await fecharMes(db, org, dono, "2026-10", "2026-11-01", null);
    expect(f.ok).toBe(true);
    const itens = await itensDoRepasse(db, org, (f as { id: string }).id);
    expect(itens.map((i) => i.reservaId)).toEqual([reservaBase]);
    // As reservas que o fechamento pediu para travar são as do cálculo lido: a paga e a que ficou fora.
    const leitura = vi.mocked(lerComReservasTravadas).mock;
    const reservasDe = leitura.calls.at(-1)![3] as (r: unknown) => string[];
    expect([...new Set(reservasDe(await leitura.results.at(-1)!.value))].sort()).toEqual([fora, reservaBase].sort());
  });
});

describe("3ª rodada do Codex: fechamentos antigos sem itens, trava no estorno do recebimento", () => {
  it("o estorno do recebimento toma a trava da reserva antes de conferir o repasse", async () => {
    const rec = await registrarRecebimento(db, org, { reservaId: reservaBase, data: "2026-10-10", valor: 85000, nota: "" }, null, "2026-10-12");
    vi.mocked(travarMotorDaReserva).mockClear();
    expect(await estornarRecebimento(db, org, (rec as { id: string }).id, "erro", null)).toMatchObject({ ok: true });
    expect(vi.mocked(travarMotorDaReserva).mock.calls.map((c) => [c[1], c[2]])).toEqual([[org, reservaBase]]);
  });

  it("migração 0045: fechamento antigo (sem itens) ganha os itens das partes que pagou; depois disso a parte não fica disponível de novo", async () => {
    // Fechamento "antigo" de outubro, gravado direto (sem itens), como os feitos antes do M4.10; um estornado não conta.
    const base = { organizacaoId: org, proprietarioId: dono, tipo: "fechamento" as const, saldo: 72250, descontado: 0, contestado: 0, valor: 72250 };
    const [estornado] = await db.insert(repasses).values({ ...base, mes: "2026-10-01", data: "2026-11-01", estornadoEm: new Date("2026-11-02T12:00:00Z") }).returning();
    const [outubro] = await db.insert(repasses).values({ ...base, mes: "2026-10-01", data: "2026-11-01" }).returning();
    const [novembro] = await db.insert(repasses).values({ ...base, mes: "2026-11-01", data: "2026-12-01", valor: 0, saldo: 0 }).returning();
    // Reserva de novembro de outro dono: competência depois de outubro, só o fechamento de novembro dele (não há) alcançaria.
    const deOutro = await criar(reserva(b, "2026-11-10", "2026-11-12"));
    // Lançamento criado depois do fechamento (reserva lançada com atraso): o valor do fechamento não o incluiu, então não ganha item.
    const atrasada = await criar(reserva(a, "2026-10-20", "2026-10-22"));
    const sqlDaMigracao = readFileSync(join(process.cwd(), "drizzle", "0045_repasse_itens_antigos.sql"), "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("--"))
      .join("\n");
    await db.execute(sql.raw(sqlDaMigracao));
    const itens = await db.select().from(repasseItens);
    // Uma parte (outubro da reserva base) → um item, no fechamento de outubro (o mais antigo que a alcança), não no estornado nem no de novembro.
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ repasseId: outubro.id, reservaId: reservaBase, competencia: "2026-10-01", valor: 72250, liberadoEm: null });
    expect(itens[0].repasseId).not.toBe(estornado.id);
    expect(itens[0].repasseId).not.toBe(novembro.id);
    expect(itens.some((i) => i.reservaId === atrasada.id)).toBe(false);
    // A 0046 limpa o que uma 0045 antiga tivesse ligado por engano (item de lançamento criado depois do fechamento).
    const [dAtrasada] = await direitos(atrasada.id);
    await db.insert(repasseItens).values({ organizacaoId: org, repasseId: outubro.id, lancamentoId: dAtrasada.id, reservaId: atrasada.id, imovelId: a, competencia: dAtrasada.competencia, valor: dAtrasada.valor });
    const sql0046 = readFileSync(join(process.cwd(), "drizzle", "0046_repasses_email_chave_pix_paga.sql"), "utf8")
      .split("--> statement-breakpoint")
      .find((t) => t.includes("DELETE FROM"))!
      .split("\n")
      .filter((l) => !l.startsWith("--"))
      .join("\n");
    await db.execute(sql.raw(sql0046));
    expect((await db.select().from(repasseItens)).map((i) => i.reservaId)).toEqual([reservaBase]);
    expect((await partes("2026-10-12", outro)).find((p) => p.reservaId === deOutro.id)?.situacao).not.toBe("repassado");
    // Rodar de novo não duplica.
    await db.execute(sql.raw(sqlDaMigracao));
    expect(await db.select().from(repasseItens)).toHaveLength(1);
    // Com o item, registrar o recebimento não torna a parte disponível: o extrato a mostra como repassada e nada é antecipado.
    await receberTudo(db, org, reservaBase, "2026-10-10");
    const [p] = await partes("2026-10-12");
    expect(p).toMatchObject({ situacao: "repassado", repasse: { id: outubro.id, tipo: "fechamento" } });
    expect(await gerarAntecipado(db, org, dono, "2026-10-12", null)).toMatchObject({ ok: false, erro: expect.stringContaining("Nada disponível") });
  });

  it("reenvio incerto é retomado com a chave do reenvio (não a do primeiro e-mail); o e-mail cita a chave Pix usada no pagamento, não a atual", async () => {
    await receberTudo(db, org, reservaBase, "2026-10-10");
    const g = await gerarAntecipado(db, org, dono, "2026-10-11", null);
    const id = (g as { id: string }).id;
    expect(await marcarRepassePago(db, org, id, "2026-10-11", "2026-10-12", null, comprovante)).toMatchObject({ ok: true });
    // A chave Pix muda depois do pagamento: o repasse guarda a usada, e é ela que o e-mail cita.
    await db.update(proprietarios).set({ chavePix: "nova@example.com" }).where(eq(proprietarios.id, dono));
    expect((await obterRepasse(db, org, id))!).toMatchObject({ chavePixPaga: "dona@example.com", chavePix: "nova@example.com" });
    // Outro repasse: a chave mudou ANTES de marcar pago, mas a pessoa fez o Pix com a chave que a tela mostrava — é essa que fica.
    await db.update(proprietarios).set({ chavePix: "antiga@example.com" }).where(eq(proprietarios.id, dono));
    await criar(reserva(a, "2026-10-14", "2026-10-16"), "2026-10-14");
    const g2 = await gerarAntecipado(db, org, dono, "2026-10-17", null);
    await db.update(proprietarios).set({ chavePix: "mudou-no-meio@example.com" }).where(eq(proprietarios.id, dono));
    expect(await marcarRepassePago(db, org, (g2 as { id: string }).id, "2026-10-17", "2026-10-17", null, comprovante, { chavePixUsada: "antiga@example.com" })).toMatchObject({ ok: true });
    expect((await obterRepasse(db, org, (g2 as { id: string }).id))!).toMatchObject({ chavePixPaga: "antiga@example.com", chavePix: "mudou-no-meio@example.com" });
    let falhar = false;
    const enviadas: Mensagem[] = [];
    const correio = {
      nome: "teste",
      async enviar(m: Mensagem) {
        if (falhar) throw new ErroEnvioIncerto("caiu");
        enviadas.push(m);
      },
    };
    const t0 = new Date("2026-10-12T12:00:00Z");
    expect(await enviarEmailDoRepasse(db, org, id, correio, t0)).toBe("enviado");
    expect(enviadas[0].texto).toContain("para a chave Pix dona@example.com");
    expect(enviadas[0].texto).not.toContain("nova@example.com");
    expect((await obterRepasse(db, org, id))!).toMatchObject({ emailChave: `repasse:${id}:email` });
    // Reenvio pedido por pessoa cai em "incerto": a chave nova fica guardada, e a retomada da rotina repete essa chave
    // (a do primeiro e-mail o provedor já consumiu: repeti-la seria "enviado" sem e-mail nenhum).
    falhar = true;
    const t1 = new Date("2026-10-13T12:00:00Z");
    expect(await enviarEmailDoRepasse(db, org, id, correio, t1, { reenviar: true })).toBe("incerto");
    const chaveReenvio = `repasse:${id}:email:${t1.getTime()}`;
    expect((await obterRepasse(db, org, id))!).toMatchObject({ emailSituacao: "incerto", emailChave: chaveReenvio });
    falhar = false;
    expect(await enviarEmailDoRepasse(db, org, id, correio, new Date(t1.getTime() + 20 * 60_000))).toBe("enviado");
    expect(enviadas[1].chave).toBe(chaveReenvio);
    expect(enviadas).toHaveLength(2);
  });
  it("reenvio recusado não volta à chave do primeiro e-mail; reenvios ao mesmo tempo (ou durante uma tentativa) disparam um e-mail só", async () => {
    await receberTudo(db, org, reservaBase, "2026-10-10");
    const g = await gerarAntecipado(db, org, dono, "2026-10-11", null);
    const id = (g as { id: string }).id;
    expect(await marcarRepassePago(db, org, id, "2026-10-11", "2026-10-12", null, comprovante)).toMatchObject({ ok: true });
    let recusar = false;
    const enviadas: Mensagem[] = [];
    const correio = {
      nome: "teste",
      async enviar(m: Mensagem) {
        if (recusar) throw new Error("HTTP 422");
        enviadas.push(m);
      },
    };
    const base = `repasse:${id}:email`;
    expect(await enviarEmailDoRepasse(db, org, id, correio, new Date("2026-10-12T12:00:00Z"))).toBe("enviado");
    expect(enviadas[0].chave).toBe(base);
    // Reenvio pedido por pessoa recusado de vez: volta a pendente, e a chave do reenvio fica guardada...
    recusar = true;
    const t1 = new Date("2026-10-13T12:00:00Z");
    expect(await enviarEmailDoRepasse(db, org, id, correio, t1, { reenviar: true })).toBe("falhou");
    expect((await obterRepasse(db, org, id))!).toMatchObject({ emailSituacao: "pendente", emailChave: `${base}:${t1.getTime()}` });
    // ...e a tentativa seguinte da rotina (sem `reenviar`) usa chave nova — nunca a do primeiro e-mail, que o provedor já
    // consumiu (repeti-la seria "enviado" sem e-mail nenhum).
    recusar = false;
    const t2 = new Date("2026-10-14T11:00:00Z");
    expect(await enviarEmailsDeRepasses(db, org, correio, t2)).toMatchObject({ enviados: 1 });
    expect(enviadas).toHaveLength(2);
    expect(enviadas[1].chave).toBe(`${base}:${t2.getTime()}`);
    // Dois "enviar de novo" ao mesmo tempo: um reivindica a tentativa, o outro é avisado; um e-mail só.
    const t3 = new Date("2026-10-15T12:00:00Z");
    const juntos = await Promise.all([enviarEmailDoRepasse(db, org, id, correio, t3, { reenviar: true }), enviarEmailDoRepasse(db, org, id, correio, t3, { reenviar: true })]);
    expect([...juntos].sort()).toEqual(["em_andamento", "enviado"]);
    expect(enviadas).toHaveLength(3);
    // Reenvio pedido enquanto uma tentativa incerta acabou de começar: não abre outra (a rotina retoma a atual).
    await db.update(repasses).set({ emailSituacao: "incerto", emailEm: t3, emailTentativaEm: t3 }).where(eq(repasses.id, id));
    expect(await enviarEmailDoRepasse(db, org, id, correio, new Date(t3.getTime() + 60_000), { reenviar: true })).toBe("em_andamento");
    expect(enviadas).toHaveLength(3);
    // Retomada (rotina) e reenvio (pessoa) ao mesmo tempo sobre uma tentativa incerta antiga: a retomada repete situação e
    // chave, mas muda o carimbo da tentativa, então o reenvio que leu a mesma linha não passa; um e-mail só, com a chave antiga.
    const t4 = new Date("2026-10-16T12:00:00Z");
    const antiga = new Date(t4.getTime() - 20 * 60_000);
    const chaveAntiga = (await obterRepasse(db, org, id))!.emailChave;
    await db.update(repasses).set({ emailSituacao: "incerto", emailEm: antiga, emailTentativaEm: antiga }).where(eq(repasses.id, id));
    const corrida = await Promise.all([enviarEmailDoRepasse(db, org, id, correio, t4), enviarEmailDoRepasse(db, org, id, correio, t4, { reenviar: true })]);
    expect(corrida).toEqual(["enviado", "em_andamento"]);
    expect(enviadas).toHaveLength(4);
    expect(enviadas[3].chave).toBe(chaveAntiga);
    // Logo depois da retomada começar, um reenvio ainda é "em andamento" (a primeira tentativa é antiga, mas a última não).
    await db.update(repasses).set({ emailSituacao: "incerto", emailEm: antiga, emailTentativaEm: t4 }).where(eq(repasses.id, id));
    expect(await enviarEmailDoRepasse(db, org, id, correio, new Date(t4.getTime() + 60_000), { reenviar: true })).toBe("em_andamento");
    expect(enviadas).toHaveLength(4);
  });
});
