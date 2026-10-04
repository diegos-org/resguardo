import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listarAdiantamentos, quitar } from "@/adiantamentos/adiantamentos";
import { travarConfig } from "@/configuracoes/armazem";
import { criarContrato } from "@/contratos/repositorio";
import { ajustes, imoveis, lancamentos, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { lancar, saldoAcerto } from "@/financeiro/ledger";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { enviarEmailDoRepasse, enviarEmailsDeRepasses } from "./email";
import { partesDisponiveis, partesDoProprietario, resumirPartes } from "./extrato";
import { descreverAcertoPorFora, marcarAcertoPorFora, situacaoAntesDoInicio, vesperaDoInicio } from "./por-fora";
import { recebidoPorReserva, registrarRecebimento } from "./recebimentos";
import { lerInicioDoSistema, salvarInicioDoSistema } from "./regras-config";
import { estornarRepasse, fecharMes, gerarAntecipado, itensDoRepasse, listarRepasses, listarRepassesDaOrganizacao, obterRepasse, preverRepasses } from "./repasses";
import { receberTudo } from "./testes";

// A trava da configuração é espiada para conferir que antecipado e fechamento a tomam antes de ler o início do sistema.
vi.mock("@/configuracoes/armazem", async (orig) => {
  const m = await orig<typeof import("@/configuracoes/armazem")>();
  return { ...m, travarConfig: vi.fn(m.travarConfig) };
});
vi.mock("./extrato", async (orig) => {
  const m = await orig<typeof import("./extrato")>();
  // Chamadas internas do módulo não passam pelo espião: o antecipado lê por `partesDisponiveis`, o fechamento por `partesDoProprietario`.
  return { ...m, partesDoProprietario: vi.fn(m.partesDoProprietario), partesDisponiveis: vi.fn(m.partesDisponiveis) };
});

let db: Db, close: () => Promise<void>, org: string, a: string, b: string, dono: string, outro: string;
let setembro: string, atravessa: string, outubro: string;

const INICIO = "2026-10-01";
const agora = new Date("2026-10-04T15:00:00Z");

const reserva = (imovelId: string, checkin: string, checkout: string): DadosReserva => ({
  imovelId, origem: "booking", estado: "confirmada", checkin, checkout, hospedes: 2, hospedeNome: "Hóspede Fictício", hospedeEmail: "", hospedeTelefone: "", hospedeOrigem: "", moeda: "BRL",
  valorBruto: 100000, taxaCanal: 15000, valorLiquido: null, codigoCanal: "", observacoes: "",
});
const criar = async (dados: DadosReserva) => {
  const r = await criarReserva(db, org, dados, null);
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  return r.reserva.id;
};
const partes = (hoje: string, quem = dono) => partesDoProprietario(db, org, quem, new Date(`${hoje}T12:00:00-03:00`));
const saldo = (fim: string, quem = dono) => saldoAcerto(db, org, { proprietarioId: quem, fim });
const direitos = (reservaId: string) => db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), eq(lancamentos.tipo, "direito_proprietario"))).orderBy(lancamentos.competencia);
const acertos = (quem = dono) => db.select().from(lancamentos).where(and(eq(lancamentos.organizacaoId, org), eq(lancamentos.tipo, "repasse"), eq(lancamentos.proprietarioId, quem))).orderBy(lancamentos.competencia);
const marcar = () => marcarAcertoPorFora(db, org, INICIO, null, agora);
const marcadoDe = async (quem = dono) => {
  const r = await marcar();
  if (!r.ok) throw new Error(r.erro);
  return r.marcados.find((m) => m.proprietarioId === quem)!;
};
/** Parte de setembro da reserva que atravessa o início (2 das 3 noites) e a de outubro (1 noite). */
const partesDaQueAtravessa = async () => {
  const [set, out] = await direitos(atravessa);
  return { set: set.valor, out: out.valor };
};

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
  await criarContrato(db, org, b, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  // Booking: bruto 1.000, taxa 150, comissão 15% de 850 → proprietário 722,50 por reserva, dividido pelas noites de cada mês.
  setembro = await criar(reserva(a, "2026-09-10", "2026-09-13"));
  atravessa = await criar(reserva(a, "2026-09-29", "2026-10-02"));
  outubro = await criar(reserva(a, "2026-10-10", "2026-10-13"));
  await criar(reserva(b, "2026-09-05", "2026-09-07"));
  await salvarInicioDoSistema(db, org, INICIO, "2026-10-04", null);
});
afterEach(() => close());

describe("acerto por fora de antes do início do sistema (M4.11; M4.12: 'de antes' é pela data em que o canal pagou a reserva)", () => {
  it("marca o que é de antes do início: um repasse por fora, pago, por proprietário, com todas as partes das reservas pagas antes e o acerto daqueles meses zerado; nada de depois", async () => {
    const { set, out } = await partesDaQueAtravessa();
    expect(set + out).toBe(72250);
    // A reserva que atravessa foi paga pelo canal em 30/9: é de antes inteira, com a noite de outubro (M4.12).
    await receberTudo(db, org, atravessa, "2026-09-30");
    expect(await saldo(INICIO)).toBe(72250 + set);
    const r = await marcar();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.marcados.map((m) => m.nome).sort()).toEqual(["Dona Exemplo", "Outro Dono"]);
    expect(r.semNada).toEqual([]);
    expect(r.recusados).toEqual([]);
    const deDona = r.marcados.find((m) => m.proprietarioId === dono)!;
    expect(deDona).toMatchObject({ valor: 144500, partes: 3 });
    const rep = (await obterRepasse(db, org, deDona.repasseId))!;
    expect(rep).toMatchObject({ tipo: "por_fora", mes: "2026-09-01", data: "2026-09-30", situacao: "pago", dataPagamento: "2026-09-30", valor: 144500, saldo: 144500, descontado: 0, contestado: 0, comprovante: "", emailSituacao: "pendente" });
    // Um lançamento "repasse" por imóvel e mês, no último dia do mês, realizado na véspera: zera setembro e, em outubro, só a noite da reserva paga antes.
    const acertados = await acertos();
    expect(acertados).toHaveLength(2);
    expect(acertados[0]).toMatchObject({ efeitoSaldo: -(72250 + set), montante: 72250 + set, competencia: "2026-09-30", imovelId: a, estado: "realizado", dataCaixa: "2026-09-30", origem: "repasse" });
    expect(acertados[0].descricao).toContain("Acertado por fora, antes do início do sistema (01/10/2026) — 403, setembro de 2026");
    expect(acertados[1]).toMatchObject({ efeitoSaldo: -out, montante: out, competencia: "2026-10-31", imovelId: a, estado: "realizado", dataCaixa: "2026-09-30", origem: "repasse" });
    expect(acertados[1].descricao).toContain("403, outubro de 2026 (reservas pagas antes do início)");
    expect(await saldo(INICIO)).toBe(0);
    expect(await saldo(INICIO, outro)).toBe(0);
    // Em outubro sobra só a reserva de outubro (a noite de outubro da que atravessa foi zerada).
    expect(await saldo("2026-11-01")).toBe(72250);
    // Partes das reservas pagas antes: repassadas (acertadas por fora), com o lançamento realizado — a de outubro da que atravessa também; a reserva de outubro segue a liberar.
    const ps = await partes("2026-10-06");
    const deSetembro = ps.filter((p) => p.competencia === "2026-09-01");
    expect(deSetembro.map((p) => p.situacao)).toEqual(["repassado", "repassado"]);
    expect(deSetembro[0].motivo).toBe("Acertada por fora, antes do início do sistema (até 30/09/2026).");
    expect(deSetembro.map((p) => p.repasse?.tipo)).toEqual(["por_fora", "por_fora"]);
    expect(ps.find((p) => p.reservaId === atravessa && p.competencia === "2026-10-01")).toMatchObject({ situacao: "repassado", repasse: expect.objectContaining({ tipo: "por_fora" }), pagamento: { data: "2026-09-30", fonte: "recebimento" } });
    expect(ps.find((p) => p.reservaId === outubro)).toMatchObject({ situacao: "a_liberar", pagamento: null });
    expect((await direitos(setembro))[0].estado).toBe("realizado");
    expect((await direitos(atravessa)).map((l) => l.estado)).toEqual(["realizado", "realizado"]);
    expect(resumirPartes(ps)).toMatchObject({ acertadoPorFora: 144500, repassadoPago: 0, repassadoAPagar: 0, aLiberar: 72250, disponivel: 0 });
    // Itens: as duas partes de setembro e a de outubro da reserva que atravessa — inteira neste repasse, nada parcial.
    const itens = await itensDoRepasse(db, org, rep.id);
    expect(itens.map((i) => i.competencia).sort()).toEqual(["2026-09-01", "2026-09-01", "2026-10-01"]);
    expect(itens.filter((i) => i.reservaId === atravessa).map((i) => [i.competencia, i.valor, i.parcial]).sort()).toEqual([["2026-09-01", set, false], ["2026-10-01", out, false]]);
    expect(itens.find((i) => i.reservaId === setembro)).toMatchObject({ valor: 72250, parcial: false });
    expect(await listarRepassesDaOrganizacao(db, org, { tipo: "por_fora" })).toHaveLength(2);
    expect(descreverAcertoPorFora(r, INICIO)).toContain("Marcado como acertado por fora até 30/09/2026: Dona Exemplo (R$ ");
    expect(descreverAcertoPorFora(r, INICIO)).toContain("3 parte(s) de reserva)");
  });

  it("reexecutar não repete nada; uma parte antiga que surja depois entra num repasse novo só com ela", async () => {
    await receberTudo(db, org, atravessa, "2026-09-30");
    await marcar();
    const r2 = await marcar();
    expect(r2).toMatchObject({ ok: true, marcados: [], recusados: [] });
    expect(r2.ok && r2.semNada.sort()).toEqual(["Dona Exemplo", "Outro Dono"]);
    expect(descreverAcertoPorFora(r2 as Extract<typeof r2, { ok: true }>, INICIO)).toBe("Nada novo a marcar antes do início.");
    expect(await listarRepasses(db, org, dono)).toHaveLength(1);
    // Reserva de setembro registrada depois (ex.: importação atrasada): só ela entra, e o acerto volta a zero.
    await criar(reserva(a, "2026-09-20", "2026-09-22"));
    expect(await saldo(INICIO)).toBe(72250);
    const r3 = await marcar();
    expect(r3.ok && r3.marcados).toEqual([expect.objectContaining({ proprietarioId: dono, partes: 1, valor: 72250 })]);
    expect(r3.ok && r3.semNada).toEqual(["Outro Dono"]);
    expect(await saldo(INICIO)).toBe(0);
    expect(await listarRepasses(db, org, dono)).toHaveLength(2);
    expect(await acertos()).toHaveLength(3);
  });

  it("reserva que atravessa paga em setembro: acertada por fora inteira; antecipado e fechamento de outubro não pagam nada dela", async () => {
    await receberTudo(db, org, atravessa, "2026-09-30");
    await marcar();
    const ps = await partes("2026-10-06");
    expect(ps.filter((p) => p.reservaId === atravessa).map((p) => p.situacao)).toEqual(["repassado", "repassado"]);
    // Nada disponível para um antecipado: a reserva de outubro ainda nem teve check-in.
    expect(await partesDisponiveis(db, org, dono, new Date("2026-10-06T15:00:00Z"))).toEqual([]);
    await receberTudo(db, org, outubro, "2026-10-12");
    const [previsao] = await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]);
    expect(previsao).toMatchObject({ valor: 72250, fora: 0, bloqueios: [] });
    expect(previsao.avisos.join(" ")).not.toContain("fora deste repasse");
    expect(previsao.itens.map((i) => i.reservaId)).toEqual([outubro]);
    expect(await fecharMes(db, org, dono, "2026-10", "2026-11-01", null)).toMatchObject({ ok: true });
    expect(await saldo("2026-11-01")).toBe(0);
  });

  it("reserva que atravessa recebida em outubro: entra inteira no sistema, com a parte de setembro; o antecipado paga as duas e o fechamento não as repete", async () => {
    const { set } = await partesDaQueAtravessa();
    await receberTudo(db, org, atravessa, "2026-10-03");
    const r = await marcar();
    expect(r.ok && r.marcados.find((m) => m.proprietarioId === dono)).toMatchObject({ partes: 1, valor: 72250 });
    const ps = await partes("2026-10-06");
    expect(ps.filter((p) => p.reservaId === atravessa).map((p) => [p.situacao, p.pagamento])).toEqual([
      ["disponivel", { data: "2026-10-03", fonte: "recebimento" }],
      ["disponivel", { data: "2026-10-03", fonte: "recebimento" }],
    ]);
    // A parte de setembro da reserva que atravessa fica no livro (o sistema a paga); só a reserva de setembro foi zerada.
    expect(await saldo(INICIO)).toBe(set);
    const g = await gerarAntecipado(db, org, dono, "2026-10-06", null);
    expect(g.ok).toBe(true);
    const antecipado = (await obterRepasse(db, org, (g as { id: string }).id))!;
    expect(antecipado.valor).toBe(72250);
    expect(await itensDoRepasse(db, org, antecipado.id)).toHaveLength(2);
    await receberTudo(db, org, outubro, "2026-10-12");
    const [previsao] = await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]);
    expect(previsao).toMatchObject({ valor: 72250, fora: 0, bloqueios: [] });
    expect(previsao.itens.map((i) => i.reservaId)).toEqual([outubro]);
    expect(await fecharMes(db, org, dono, "2026-10", "2026-11-01", null)).toMatchObject({ ok: true });
    expect(await saldo("2026-11-01")).toBe(0);
  });

  it("reserva paga antes do início com todas as noites depois dele (paga adiantado) também é de antes: marcada inteira, com o acerto do mês dela zerado", async () => {
    const { set, out } = await partesDaQueAtravessa();
    await receberTudo(db, org, atravessa, "2026-09-30");
    await receberTudo(db, org, outubro, "2026-09-25");
    const [s] = await situacaoAntesDoInicio(db, org, INICIO, agora);
    expect(s).toMatchObject({ nome: "Dona Exemplo", partes: 4, valorPartes: 216750, saldoAberto: 216750, gruposAbertos: 2, bloqueios: [] });
    expect(await marcadoDe()).toMatchObject({ partes: 4, valor: 216750 });
    expect((await acertos()).map((l) => [l.competencia, l.efeitoSaldo])).toEqual([["2026-09-30", -(72250 + set)], ["2026-10-31", -(out + 72250)]]);
    expect((await partes("2026-10-13")).find((p) => p.reservaId === outubro)).toMatchObject({ situacao: "repassado", motivo: "Acertada por fora, antes do início do sistema (até 30/09/2026).", pagamento: { data: "2026-09-25", fonte: "recebimento" } });
    expect(await saldo("2026-11-01")).toBe(0);
    expect(await partesDisponiveis(db, org, dono, new Date("2026-10-13T15:00:00Z"))).toEqual([]);
  });

  it("a data do pagamento por reserva: canal que paga direto pelo prazo do canal (Airbnb: dia seguinte ao check-in); empresa pelo recebimento que completou o valor; sem um nem outro, nenhuma", async () => {
    const airbnb = await criar({ ...reserva(a, "2026-09-29", "2026-10-02"), origem: "airbnb" });
    const ps = await partes("2026-10-06");
    const doAirbnb = ps.filter((p) => p.reservaId === airbnb);
    expect(doAirbnb.map((p) => [p.quemRecebe, p.situacao, p.pagamento])).toEqual([
      ["split", "informacao", { data: "2026-09-30", fonte: "canal", prazo: 1 }],
      ["split", "informacao", { data: "2026-09-30", fonte: "canal", prazo: 1 }],
    ]);
    expect(doAirbnb[0].motivo).toBe("O canal pagou sua parte direto a você (pago em 30/09/2026, 1 dia(s) depois do check-in), antes do início do sistema (01/10/2026): já acertada por fora.");
    expect((await partes("2026-10-06")).find((p) => p.reservaId === outubro && p.reservaId !== airbnb)?.pagamento).toBeNull();
    // Booking (empresa recebe): sem recebimento, sem data; recebida em duas vezes, a data é a do recebimento que completou o líquido do canal.
    expect(ps.find((p) => p.reservaId === atravessa)?.pagamento).toBeNull();
    const devido = (await recebidoPorReserva(db, org, [atravessa])).get(atravessa)!.devido;
    expect(await registrarRecebimento(db, org, { reservaId: atravessa, data: "2026-09-28", valor: devido - 1000, nota: "sinal" }, null, "2026-09-28")).toMatchObject({ ok: true });
    expect((await partes("2026-10-06")).find((p) => p.reservaId === atravessa)?.pagamento).toBeNull();
    expect(await registrarRecebimento(db, org, { reservaId: atravessa, data: "2026-10-02", valor: 1000, nota: "resto" }, null, "2026-10-02")).toMatchObject({ ok: true });
    expect((await partes("2026-10-06")).filter((p) => p.reservaId === atravessa).map((p) => [p.situacao, p.pagamento])).toEqual([
      ["disponivel", { data: "2026-10-02", fonte: "recebimento" }],
      ["disponivel", { data: "2026-10-02", fonte: "recebimento" }],
    ]);
    // A do Airbnb nunca entra na marcação (o canal já pagou direto): a Dona só tem a reserva de setembro a marcar.
    expect((await situacaoAntesDoInicio(db, org, INICIO, agora)).find((s) => s.proprietarioId === dono)).toMatchObject({ partes: 1, valorPartes: 72250, bloqueios: [] });
  });

  it("bloqueios de antes do início (lançamento em conferência, ajuste a esclarecer, adiantamento em aberto) recusam só aquele proprietário, com o motivo", async () => {
    await receberTudo(db, org, atravessa, "2026-09-30");
    // Adiantamento em aberto de setembro: foi acertado por fora, então precisa ser quitado antes — senão o fechamento o descontaria de novo.
    const [adiantamento] = await lancar(db, org, [{ tipo: "adiantamento", descricao: "IPTU adiantado", valor: 30000, montante: 30000, efeitoSaldo: -30000, competencia: "2026-09-20", estado: "realizado", dataCaixa: "2026-09-20", imovelId: a, proprietarioId: dono }], null);
    const r1 = await marcar();
    expect(r1.ok && r1.marcados.map((m) => m.nome)).toEqual(["Outro Dono"]);
    expect(r1.ok && r1.recusados).toEqual([{ nome: "Dona Exemplo", motivo: expect.stringContaining("1 adiantamento(s) em aberto de antes do início (R$ 300,00)") }]);
    expect(descreverAcertoPorFora(r1 as Extract<typeof r1, { ok: true }>, INICIO)).toContain("Não marcado: Dona Exemplo — 1 adiantamento(s)");
    expect((await situacaoAntesDoInicio(db, org, INICIO, agora)).find((s) => s.proprietarioId === dono)?.bloqueios).toHaveLength(1);
    expect(await quitar(db, org, adiantamento.id, { forma: "reembolso", valor: 30000, data: "2026-09-25", nota: "acertado por fora" }, null)).toMatchObject({ ok: true });
    expect(await listarAdiantamentos(db, org, { proprietarioId: dono, somenteAbertos: true })).toEqual([]);
    // Ajuste com o proprietário ainda a esclarecer, datado de antes do início.
    const [ajuste] = await db.insert(ajustes).values({ organizacaoId: org, data: "2026-09-18", imovelId: a, proprietarioId: dono, afeta: "proprietario", motivo: "diferença do canal" }).returning();
    const r2 = await marcar();
    expect(r2.ok && r2.recusados).toEqual([{ nome: "Dona Exemplo", motivo: expect.stringContaining("1 ajuste(s) com o proprietário a esclarecer") }]);
    await db.update(ajustes).set({ esclarecidoEm: new Date() }).where(eq(ajustes.id, ajuste.id));
    // Lançamento pendente (quem recebe a confirmar) de setembro: em conferência.
    const [pendente] = await lancar(db, org, [{ tipo: "ajuste", descricao: "a confirmar", valor: 1000, efeitoSaldo: 0, competencia: "2026-09-15", estado: "pendente", imovelId: a, proprietarioId: dono }], null);
    const r3 = await marcar();
    expect(r3.ok && r3.recusados).toEqual([{ nome: "Dona Exemplo", motivo: expect.stringContaining("1 lançamento(s) em conferência antes do início") }]);
    await db.update(lancamentos).set({ estado: "realizado" }).where(eq(lancamentos.id, pendente.id));
    // Sem bloqueio: marca. O adiantamento quitado e seu reembolso somam zero no acerto; nada deles entra no repasse.
    const r4 = await marcar();
    expect(r4.ok && r4.marcados.map((m) => m.nome)).toEqual(["Dona Exemplo"]);
    expect(await saldo(INICIO)).toBe(0);
    expect(r4.ok && r4.recusados).toEqual([]);
  });

  it("estornar o repasse por fora devolve as partes ao extrato e o acerto de antes volta; marcar de novo refaz", async () => {
    const { set } = await partesDaQueAtravessa();
    await receberTudo(db, org, atravessa, "2026-09-30");
    const { repasseId } = await marcadoDe();
    expect(await estornarRepasse(db, org, repasseId, "marcação errada", "2026-10-05", null)).toMatchObject({ ok: true });
    expect(await saldo(INICIO)).toBe(72250 + set);
    const ps = await partes("2026-10-06");
    expect(ps.filter((p) => p.competencia === "2026-09-01").map((p) => p.situacao)).toEqual(["a_liberar", "a_liberar"]);
    expect(ps.find((p) => p.reservaId === atravessa && p.competencia === "2026-10-01")?.situacao).toBe("a_liberar");
    expect((await direitos(setembro))[0].estado).toBe("previsto");
    expect((await obterRepasse(db, org, repasseId))!.situacao).toBe("estornado");
    const deNovo = await marcadoDe();
    expect(deNovo).toMatchObject({ valor: 144500, partes: 3 });
    expect(await saldo(INICIO)).toBe(0);
    // Com um repasse mais novo (antecipado de outubro) em vigor, o acerto por fora não pode ser estornado antes dele.
    await receberTudo(db, org, outubro, "2026-10-11");
    const g = await gerarAntecipado(db, org, dono, "2026-10-12", null);
    expect(g.ok).toBe(true);
    expect(await estornarRepasse(db, org, deNovo.repasseId, "teste", "2026-10-13", null)).toMatchObject({ ok: false, erro: expect.stringContaining("antecipado posterior") });
  });

  it("situação antes do início para o painel: reserva que atravessa sem data de pagamento bloqueia o proprietário (e avisa no fechamento); início inválido e outra organização não marcam nada", async () => {
    const { set } = await partesDaQueAtravessa();
    const resumo = (s: Awaited<ReturnType<typeof situacaoAntesDoInicio>>[number]) => ({ nome: s.nome, partes: s.partes, valorPartes: s.valorPartes, saldoAberto: s.saldoAberto, gruposAbertos: s.gruposAbertos, bloqueios: s.bloqueios });
    // Sem data de pagamento, a reserva que atravessa é indefinida: fica fora das partes e do acerto de antes, e bloqueia a marcação da Dona até a equipe registrar o recebimento.
    const indefinida = await situacaoAntesDoInicio(db, org, INICIO, agora);
    expect(indefinida.map(resumo)).toEqual([
      { nome: "Dona Exemplo", partes: 1, valorPartes: 72250, saldoAberto: 72250, gruposAbertos: 1, bloqueios: [expect.stringContaining("1 reserva(s) que atravessa(m) o início do sistema (01/10/2026) sem data de pagamento")] },
      { nome: "Outro Dono", partes: 1, valorPartes: 72250, saldoAberto: 72250, gruposAbertos: 1, bloqueios: [] },
    ]);
    expect(indefinida[0].bloqueios[0]).toContain("registre o recebimento na reserva com a data em que o canal pagou");
    expect((await partes("2026-10-06")).filter((p) => p.reservaId === atravessa).map((p) => p.situacao)).toEqual(["a_liberar", "a_liberar"]);
    expect((await partes("2026-10-06")).find((p) => p.reservaId === atravessa)?.motivo).toContain("Reserva que atravessa o início do sistema (01/10/2026) sem data de pagamento");
    const bloqueada = await marcar();
    expect(bloqueada.ok && bloqueada.marcados.map((m) => m.nome)).toEqual(["Outro Dono"]);
    expect(bloqueada.ok && bloqueada.recusados).toEqual([{ nome: "Dona Exemplo", motivo: expect.stringContaining("sem data de pagamento") }]);
    // No fechamento de outubro é aviso (a reserva fica a liberar, fora do repasse), além do bloqueio do que é de antes sem marcar.
    await receberTudo(db, org, outubro, "2026-10-12");
    const [previsao] = await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]);
    expect(previsao.avisos.join(" ")).toContain("1 reserva(s) que atravessa(m) o início do sistema (01/10/2026) sem data de pagamento");
    expect(previsao.bloqueios).toEqual([expect.stringContaining("1 parte(s) de reserva e 1 mês(es) com acerto em aberto anterior(es) ao início do sistema")]);
    // Paga em 30/9: de antes inteira — três partes e dois imóvel/mês a zerar (setembro e a noite de outubro). O Outro Dono, já marcado, não aparece mais.
    await receberTudo(db, org, atravessa, "2026-09-30");
    expect((await situacaoAntesDoInicio(db, org, INICIO, agora)).map(resumo)).toEqual([{ nome: "Dona Exemplo", partes: 3, valorPartes: 144500, saldoAberto: 144500, gruposAbertos: 2, bloqueios: [] }]);
    expect(await marcadoDe()).toMatchObject({ partes: 3, valor: 72250 + set + (72250 - set) });
    expect(await situacaoAntesDoInicio(db, org, INICIO, agora)).toEqual([]);
    // Grupos que se anulam (crédito em agosto, débito em setembro): saldo zero, mas dois lançamentos de acerto a fazer — e a
    // marcação os zera um a um, num repasse de valor zero.
    await lancar(db, org, [
      { tipo: "ajuste", descricao: "crédito antigo", valor: 10000, efeitoSaldo: 10000, competencia: "2026-08-15", estado: "realizado", dataCaixa: "2026-08-15", imovelId: b, proprietarioId: outro },
      { tipo: "ajuste", descricao: "débito antigo", valor: -10000, efeitoSaldo: -10000, competencia: "2026-09-15", estado: "realizado", dataCaixa: "2026-09-15", imovelId: b, proprietarioId: outro },
    ], null);
    const doOutro = (await situacaoAntesDoInicio(db, org, INICIO, agora)).find((s) => s.proprietarioId === outro)!;
    expect(doOutro).toMatchObject({ partes: 0, saldoAberto: 0, gruposAbertos: 2, bloqueios: [] });
    const r = await marcar();
    expect(r.ok && r.marcados).toEqual([expect.objectContaining({ proprietarioId: outro, valor: 0, partes: 0 })]);
    expect((await acertos(outro)).map((l) => [l.competencia, l.efeitoSaldo])).toEqual([["2026-08-31", -10000], ["2026-09-30", -72250], ["2026-09-30", 10000]]);
    expect((await situacaoAntesDoInicio(db, org, INICIO, agora)).find((s) => s.proprietarioId === outro)).toBeUndefined();
    // Início no meio do mês não existe (as partes são por mês): nada é marcado nem listado.
    expect(await marcarAcertoPorFora(db, org, "2026-10-15", null, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("dia 1º") });
    expect(await situacaoAntesDoInicio(db, org, "2026-10-15", agora)).toEqual([]);
    // Início diferente do configurado (tela velha, configuração mudou no meio): nenhum proprietário é marcado com a data errada.
    await criar(reserva(a, "2026-09-20", "2026-09-22"));
    const velho = await marcarAcertoPorFora(db, org, "2026-09-01", null, agora);
    expect(velho.ok && velho.marcados).toEqual([]);
    const motivo = "O início do sistema configurado é 01/10/2026, não 01/09/2026: recarregue a página e confira.";
    expect(velho.ok && velho.recusados).toEqual([{ nome: "Dona Exemplo", motivo }, { nome: "Outro Dono", motivo }]);
    expect(await listarRepasses(db, org, dono)).toHaveLength(1);
    expect(await listarRepasses(db, org, outro)).toHaveLength(2);
    const [{ id: outraOrg }] = await db.insert(organizacoes).values({ nome: "B" }).returning();
    expect(await situacaoAntesDoInicio(db, outraOrg, INICIO, agora)).toEqual([]);
    expect(await marcarAcertoPorFora(db, outraOrg, INICIO, null, agora)).toEqual({ ok: true, marcados: [], semNada: [], recusados: [] });
    expect(await listarRepassesDaOrganizacao(db, outraOrg, { tipo: "por_fora" })).toEqual([]);
  });

  it("início do sistema: sempre dia 1º, nunca no futuro; vazio apaga; a véspera é o último dia coberto", async () => {
    expect(await lerInicioDoSistema(db, org)).toBe(INICIO);
    expect(await salvarInicioDoSistema(db, org, "", "2026-10-04", null)).toEqual({ ok: true, mudou: true });
    expect(await lerInicioDoSistema(db, org)).toBeNull();
    expect(await salvarInicioDoSistema(db, org, "2026-10-15", "2026-10-04", null)).toMatchObject({ ok: false, erro: expect.stringContaining("dia 1º") });
    expect(await salvarInicioDoSistema(db, org, "2026-11-01", "2026-10-04", null)).toMatchObject({ ok: false, erro: expect.stringContaining("futuro") });
    expect(await salvarInicioDoSistema(db, org, "2026-13-01", "2026-10-04", null)).toMatchObject({ ok: false, erro: "Data inválida." });
    expect(await salvarInicioDoSistema(db, org, INICIO, "2026-10-04", null)).toEqual({ ok: true, mudou: true });
    expect(await lerInicioDoSistema(db, org)).toBe(INICIO);
    expect(await salvarInicioDoSistema(db, org, INICIO, "2026-10-04", null)).toEqual({ ok: true, mudou: false });
    expect(await salvarInicioDoSistema(db, org, "", "2026-10-04", null)).toEqual({ ok: true, mudou: true });
    expect(await lerInicioDoSistema(db, org)).toBeNull();
    expect(vesperaDoInicio("2026-10-01")).toBe("2026-09-30");
    expect(vesperaDoInicio("2026-01-01")).toBe("2025-12-31");
  });

  it("com acerto por fora em vigor, o início não volta para antes dele nem é apagado; para depois pode, e depois do estorno tudo pode", async () => {
    await receberTudo(db, org, atravessa, "2026-09-30");
    const { repasseId } = await marcadoDe();
    const recusa = { ok: false, erro: expect.stringContaining("2 acerto(s) por fora em vigor até 30/09/2026") };
    expect(await salvarInicioDoSistema(db, org, "2026-09-01", "2026-10-04", null)).toMatchObject({ ...recusa, erro: expect.stringContaining("mudar o início para antes disso") });
    expect(await salvarInicioDoSistema(db, org, "", "2026-10-04", null)).toMatchObject({ ...recusa, erro: expect.stringContaining("apagar o início") });
    expect(await lerInicioDoSistema(db, org)).toBe(INICIO);
    // Para depois pode: os acertos continuam antes do início novo.
    expect(await salvarInicioDoSistema(db, org, "2026-11-01", "2026-11-02", null)).toEqual({ ok: true, mudou: true });
    expect(await salvarInicioDoSistema(db, org, INICIO, "2026-11-02", null)).toEqual({ ok: true, mudou: true });
    // Estornados os dois acertos, a data volta a ser livre.
    expect(await estornarRepasse(db, org, repasseId, "refazer", "2026-10-05", null)).toMatchObject({ ok: true });
    expect(await salvarInicioDoSistema(db, org, "2026-09-01", "2026-10-04", null)).toMatchObject({ ok: false, erro: expect.stringContaining("1 acerto(s) por fora em vigor") });
    const [doOutro] = await listarRepasses(db, org, outro);
    expect(await estornarRepasse(db, org, doOutro.id, "refazer", "2026-10-05", null)).toMatchObject({ ok: true });
    expect(await salvarInicioDoSistema(db, org, "2026-09-01", "2026-10-04", null)).toEqual({ ok: true, mudou: true });
    expect(await salvarInicioDoSistema(db, org, "", "2026-10-04", null)).toEqual({ ok: true, mudou: true });
  });

  it("com o início definido, reserva paga antes nunca fica disponível e o fechamento bloqueia até a marcação — também para reserva antiga que apareça depois; a recebida a partir do início entra inteira", async () => {
    const { set, out } = await partesDaQueAtravessa();
    // Setembro paga em 14/9: de antes, continua a liberar mesmo recebida. A que atravessa, recebida em 3/10: de depois inteira — a parte de setembro fica disponível.
    await receberTudo(db, org, setembro, "2026-09-14");
    await receberTudo(db, org, atravessa, "2026-10-03");
    const antes = await partes("2026-10-06");
    expect(antes.find((p) => p.reservaId === setembro)).toMatchObject({
      situacao: "a_liberar",
      motivo: "Reserva paga antes do início do sistema (01/10/2026), em 14/09/2026: já acertada por fora; aguarda a marcação em Financeiro → Repasses.",
      pagamento: { data: "2026-09-14", fonte: "recebimento" },
    });
    expect(antes.filter((p) => p.reservaId === atravessa).map((p) => p.situacao)).toEqual(["disponivel", "disponivel"]);
    // O antecipado leva as duas partes da que atravessa; o fechamento de outubro trava enquanto setembro não estiver marcado.
    const g = await gerarAntecipado(db, org, dono, "2026-10-06", null);
    expect(g.ok).toBe(true);
    expect((await obterRepasse(db, org, (g as { id: string }).id))!.valor).toBe(set + out);
    await receberTudo(db, org, outubro, "2026-10-12");
    const [bloqueada] = await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]);
    expect(bloqueada.bloqueios).toEqual([expect.stringContaining("1 parte(s) de reserva e 1 mês(es) com acerto em aberto anterior(es) ao início do sistema (01/10/2026) ainda sem marcar")]);
    expect(await fecharMes(db, org, dono, "2026-10", "2026-11-01", null)).toMatchObject({ ok: false, erro: expect.stringContaining("anterior(es) ao início do sistema") });
    await marcar();
    const [livre] = await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]);
    expect(livre.bloqueios).toEqual([]);
    expect(livre.valor).toBe(72250);
    // Reserva antiga que aparece depois da marcação (importação atrasada), já recebida: não fica disponível, o antecipado a
    // ignora e o fechamento volta a travar até marcar de novo — nunca é paga pelo sistema.
    const tardia = await criar(reserva(a, "2026-09-20", "2026-09-22"));
    await receberTudo(db, org, tardia, "2026-09-25");
    expect((await partes("2026-10-13")).find((p) => p.reservaId === tardia)).toMatchObject({ situacao: "a_liberar", motivo: expect.stringContaining("Reserva paga antes do início do sistema") });
    // O que um antecipado levaria agora é só a reserva de outubro; a tardia nunca.
    expect((await partesDisponiveis(db, org, dono, new Date("2026-10-13T15:00:00Z"))).map((p) => p.reservaId)).toEqual([outubro]);
    expect((await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]))[0].bloqueios).toEqual([expect.stringContaining("1 parte(s) de reserva e 1 mês(es) com acerto em aberto anterior(es)")]);
    const r = await marcar();
    expect(r.ok && r.marcados).toEqual([expect.objectContaining({ proprietarioId: dono, partes: 1, valor: 72250 })]);
    expect((await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]))[0].bloqueios).toEqual([]);
    expect(await fecharMes(db, org, dono, "2026-10", "2026-11-01", null)).toMatchObject({ ok: true });
    expect(await saldo("2026-11-01")).toBe(0);
  });

  it("o início não avança por cima de parte que um repasse normal em vigor já pagou, nem de mês já fechado; estornados, pode", async () => {
    expect(await salvarInicioDoSistema(db, org, "", "2026-10-04", null)).toEqual({ ok: true, mudou: true });
    // Sem início, setembro recebido fica disponível e um antecipado o paga pelo sistema.
    await receberTudo(db, org, setembro, "2026-09-14");
    const g = await gerarAntecipado(db, org, dono, "2026-09-15", null);
    expect(g.ok).toBe(true);
    expect(await salvarInicioDoSistema(db, org, INICIO, "2026-10-04", null)).toMatchObject({ ok: false, erro: expect.stringContaining("1 parte(s) de reserva anterior(es) a 01/10/2026 já em repasse normal") });
    // Início que não alcança a parte (1/9: a reserva foi paga em 14/9, depois dele) pode.
    expect(await salvarInicioDoSistema(db, org, "2026-09-01", "2026-10-04", null)).toEqual({ ok: true, mudou: true });
    expect(await salvarInicioDoSistema(db, org, "", "2026-10-04", null)).toEqual({ ok: true, mudou: true });
    expect(await estornarRepasse(db, org, (g as { id: string }).id, "teste", "2026-09-16", null)).toMatchObject({ ok: true });
    // Fechamento de setembro em vigor também trava o início em 1/10.
    await receberTudo(db, org, atravessa, "2026-10-03");
    expect(await fecharMes(db, org, dono, "2026-09", "2026-10-03", null)).toMatchObject({ ok: true });
    expect(await salvarInicioDoSistema(db, org, INICIO, "2026-10-04", null)).toMatchObject({ ok: false, erro: expect.stringContaining("1 fechamento(s) de mês anterior") });
    const [fechamento] = await listarRepasses(db, org, dono);
    expect(await estornarRepasse(db, org, fechamento.id, "teste", "2026-10-04", null)).toMatchObject({ ok: true });
    expect(await salvarInicioDoSistema(db, org, INICIO, "2026-10-04", null)).toEqual({ ok: true, mudou: true });
  });

  it("a trava da data segue a data do pagamento: reserva paga antes e já em antecipado trava até pela noite de outubro; reserva recebida a partir do início, com noite de setembro em antecipado, não trava", async () => {
    expect(await salvarInicioDoSistema(db, org, "", "2026-10-04", null)).toEqual({ ok: true, mudou: true });
    await receberTudo(db, org, atravessa, "2026-09-30");
    const g = await gerarAntecipado(db, org, dono, "2026-10-02", null);
    expect(g.ok).toBe(true);
    expect(await itensDoRepasse(db, org, (g as { id: string }).id)).toHaveLength(2);
    expect(await salvarInicioDoSistema(db, org, INICIO, "2026-10-04", null)).toMatchObject({ ok: false, erro: expect.stringContaining("2 parte(s) de reserva anterior(es) a 01/10/2026 já em repasse normal") });
    expect(await estornarRepasse(db, org, (g as { id: string }).id, "teste", "2026-10-03", null)).toMatchObject({ ok: true });
    // Reserva do Outro Dono que atravessa, recebida em 3/10 e paga por antecipado (as duas partes): é de depois inteira — não trava 1/10.
    const cruza = await criar(reserva(b, "2026-09-29", "2026-10-02"));
    await receberTudo(db, org, cruza, "2026-10-03");
    const g2 = await gerarAntecipado(db, org, outro, "2026-10-04", null);
    expect(g2.ok).toBe(true);
    expect(await itensDoRepasse(db, org, (g2 as { id: string }).id)).toHaveLength(2);
    expect(await salvarInicioDoSistema(db, org, INICIO, "2026-10-04", null)).toEqual({ ok: true, mudou: true });
    // E a marcação do Outro Dono leva só a reserva de setembro dele; a que atravessa segue no sistema.
    const r = await marcar();
    expect(r.ok && r.marcados.find((m) => m.proprietarioId === outro)).toMatchObject({ partes: 1, valor: 72250 });
    // Setembro do Outro Dono zerado pela marcação; a parte de setembro da que atravessa e o desconto do antecipado se anulam.
    expect(await saldo(INICIO, outro)).toBe(0);
    expect((await situacaoAntesDoInicio(db, org, INICIO, agora)).find((s) => s.proprietarioId === outro)).toBeUndefined();
  });

  it("o início não avança por cima de fechamento posterior que já quitou acerto de antes dele (ajuste de setembro pago no fechamento de outubro); parte fora do fechamento e lançamento feito depois dele não contam; estornado, pode", async () => {
    expect(await salvarInicioDoSistema(db, org, "", "2026-10-04", null)).toEqual({ ok: true, mudou: true });
    // Dona: setembro não recebido fica fora do fechamento de outubro (não foi quitado por ele).
    await receberTudo(db, org, outubro, "2026-10-12");
    expect(await fecharMes(db, org, dono, "2026-10", "2026-11-01", null)).toMatchObject({ ok: true });
    // Pagou só outubro; setembro e a reserva que atravessa (não recebidas) ficaram fora do fechamento.
    expect((await listarRepasses(db, org, dono))[0]).toMatchObject({ tipo: "fechamento", valor: 72250 });
    // Dois proprietários novos, só com reserva de outubro: um tem também um ajuste de setembro sem item de reserva; o outro, nada de antes.
    const [{ id: c }, { id: d }] = await db.insert(imoveis).values([{ organizacaoId: org, codigo: "305", nome: "Três" }, { organizacaoId: org, codigo: "506", nome: "Cinco" }]).returning();
    const [{ id: terceiro }, { id: quarto }] = await db
      .insert(proprietarios)
      .values([{ organizacaoId: org, nome: "Terceiro Dono", email: "terceiro@example.com", chavePix: "" }, { organizacaoId: org, nome: "Quarto Dono", email: "quarto@example.com", chavePix: "" }])
      .returning();
    await db.insert(proprietarioImoveis).values([{ proprietarioId: terceiro, imovelId: c }, { proprietarioId: quarto, imovelId: d }]);
    await criarContrato(db, org, c, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await criarContrato(db, org, d, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    await lancar(db, org, [{ tipo: "ajuste", descricao: "Conserto de setembro", valor: 5000, montante: 5000, efeitoSaldo: -5000, competencia: "2026-09-20", estado: "realizado", dataCaixa: "2026-09-20", imovelId: c, proprietarioId: terceiro }], null);
    // Quarto: crédito de agosto e débito de setembro que se anulam — o fechamento de outubro (acerto acumulado) não quitou nada de antes.
    await lancar(
      db,
      org,
      [
        { tipo: "ajuste", descricao: "Crédito de agosto", valor: 10000, montante: 10000, efeitoSaldo: 10000, competencia: "2026-08-10", estado: "realizado", dataCaixa: "2026-08-10", imovelId: d, proprietarioId: quarto },
        { tipo: "ajuste", descricao: "Débito de setembro", valor: 10000, montante: 10000, efeitoSaldo: -10000, competencia: "2026-09-10", estado: "realizado", dataCaixa: "2026-09-10", imovelId: d, proprietarioId: quarto },
      ],
      null,
    );
    for (const [imovel, quem] of [[c, terceiro], [d, quarto]] as const) {
      await receberTudo(db, org, await criar(reserva(imovel, "2026-10-10", "2026-10-13")), "2026-10-12");
      expect(await fecharMes(db, org, quem, "2026-10", "2026-11-01", null)).toMatchObject({ ok: true });
      // O fechamento paga o acerto acumulado: o do terceiro já desconta o ajuste de setembro.
      expect((await listarRepasses(db, org, quem))[0]).toMatchObject({ tipo: "fechamento", saldo: quem === terceiro ? 72250 - 5000 : 72250 });
    }
    // Ajuste de setembro da Dona lançado depois do fechamento de outubro dela: ficou fora dele, não conta.
    await lancar(db, org, [{ tipo: "ajuste", descricao: "Conserto atrasado de setembro", valor: 3000, montante: 3000, efeitoSaldo: -3000, competencia: "2026-09-25", estado: "realizado", dataCaixa: "2026-09-25", imovelId: a, proprietarioId: dono }], null);
    // Só o fechamento do terceiro conta (o da Dona e o do quarto não quitaram nada de antes — no do quarto, agosto e setembro
    // se anulam na soma, como no acerto acumulado que o fechamento paga): 1/10 deixaria a marcação
    // zerar setembro do terceiro de novo (acertado duas vezes) — recusado até estornar esse fechamento.
    expect(await salvarInicioDoSistema(db, org, INICIO, "2026-11-02", null)).toMatchObject({ ok: false, erro: expect.stringContaining("1 fechamento(s) de mês a partir de 01/10/2026 que já quitou(aram) acerto de antes dessa data") });
    const [fechamento] = await listarRepasses(db, org, terceiro);
    expect(fechamento.tipo).toBe("fechamento");
    expect(await estornarRepasse(db, org, fechamento.id, "teste", "2026-11-02", null)).toMatchObject({ ok: true });
    expect(await salvarInicioDoSistema(db, org, INICIO, "2026-11-02", null)).toEqual({ ok: true, mudou: true });
    expect((await listarRepasses(db, org, dono)).map((r) => r.tipo)).toEqual(["fechamento"]);
    expect(await listarRepasses(db, org, quarto)).toHaveLength(1);
    // A reserva que atravessa, paga em 30/9 (registrado agora): de antes inteira; ficou fora do fechamento de outubro da Dona, então a marcação a leva.
    await receberTudo(db, org, atravessa, "2026-09-30");
    // Marcado por fora (partes zeradas pelo lançamento de acerto) e fechamento de outubro em vigor — o da Dona
    // anterior à marcação, o do terceiro gerado depois dela: regravar a data é aceito, o acerto que o fechamento viu era zero.
    const r = await marcar();
    expect(r.ok && r.marcados.map((m) => m.proprietarioId).sort()).toEqual([dono, outro, quarto, terceiro].sort());
    expect(r.ok && r.marcados.find((m) => m.proprietarioId === dono)).toMatchObject({ partes: 3 });
    expect(await fecharMes(db, org, terceiro, "2026-10", "2026-11-02", null)).toMatchObject({ ok: true });
    expect(await salvarInicioDoSistema(db, org, INICIO, "2026-11-02", null)).toEqual({ ok: true, mudou: false });
  });

  it("antecipado e fechamento tomam a trava do início do sistema antes de ler as partes: a data não muda no meio deles", async () => {
    const trava = vi.mocked(travarConfig);
    const leituras = [vi.mocked(partesDoProprietario), vi.mocked(partesDisponiveis)];
    const limpar = () => {
      trava.mockClear();
      for (const l of leituras) l.mockClear();
    };
    const ordem = (chave: string) => {
      const t = trava.mock.calls.findIndex((c) => c[2] === chave);
      expect(t).toBeGreaterThanOrEqual(0);
      const primeiraLeitura = Math.min(...leituras.flatMap((l) => l.mock.invocationCallOrder));
      expect(Number.isFinite(primeiraLeitura)).toBe(true);
      expect(trava.mock.invocationCallOrder[t]).toBeLessThan(primeiraLeitura);
    };
    await receberTudo(db, org, atravessa, "2026-10-03");
    await marcar();
    limpar();
    expect(await gerarAntecipado(db, org, dono, "2026-10-06", null)).toMatchObject({ ok: true });
    ordem("inicio_sistema");
    await receberTudo(db, org, outubro, "2026-10-12");
    limpar();
    expect(await fecharMes(db, org, dono, "2026-10", "2026-11-01", null)).toMatchObject({ ok: true });
    ordem("inicio_sistema");
  });

  it("o repasse por fora não entra na rotina de e-mails nem aceita envio: nada foi pago pelo sistema", async () => {
    await receberTudo(db, org, atravessa, "2026-09-30");
    const { repasseId } = await marcadoDe();
    const correio = new CorreioMemoria();
    expect(await enviarEmailsDeRepasses(db, org, correio, agora)).toMatchObject({ enviados: 0, semComprovante: 0, incertos: 0, falhas: 0 });
    expect(correio.enviadas).toHaveLength(0);
    expect(await enviarEmailDoRepasse(db, org, repasseId, correio, agora)).toBe("por_fora");
    expect((await obterRepasse(db, org, repasseId))!.emailSituacao).toBe("pendente");
  });
});
