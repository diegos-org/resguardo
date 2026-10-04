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

describe("acerto por fora de antes do início do sistema (M4.11)", () => {
  it("marca o que é de antes do início: um repasse por fora, pago, por proprietário, com as partes de antes e o acerto daqueles meses zerado; nada de depois", async () => {
    const { set, out } = await partesDaQueAtravessa();
    expect(set + out).toBe(72250);
    expect(await saldo(INICIO)).toBe(72250 + set);
    const r = await marcar();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.marcados.map((m) => m.nome).sort()).toEqual(["Dona Exemplo", "Outro Dono"]);
    expect(r.semNada).toEqual([]);
    expect(r.recusados).toEqual([]);
    const deDona = r.marcados.find((m) => m.proprietarioId === dono)!;
    expect(deDona).toMatchObject({ valor: 72250 + set, partes: 2 });
    const rep = (await obterRepasse(db, org, deDona.repasseId))!;
    expect(rep).toMatchObject({ tipo: "por_fora", mes: "2026-09-01", data: "2026-09-30", situacao: "pago", dataPagamento: "2026-09-30", valor: 72250 + set, saldo: 72250 + set, descontado: 0, contestado: 0, comprovante: "", emailSituacao: "pendente" });
    // Um lançamento "repasse" por imóvel e mês, no último dia do mês, realizado na véspera: zera setembro.
    const acertados = await acertos();
    expect(acertados).toHaveLength(1);
    expect(acertados[0]).toMatchObject({ efeitoSaldo: -(72250 + set), montante: 72250 + set, competencia: "2026-09-30", imovelId: a, estado: "realizado", dataCaixa: "2026-09-30", origem: "repasse" });
    expect(acertados[0].descricao).toContain("Acertado por fora, antes do início do sistema (01/10/2026) — 403, setembro de 2026");
    expect(await saldo(INICIO)).toBe(0);
    expect(await saldo(INICIO, outro)).toBe(0);
    // Partes de setembro: repassadas (acertadas por fora), com o lançamento realizado; as de outubro seguem a liberar.
    const ps = await partes("2026-10-06");
    const deSetembro = ps.filter((p) => p.competencia === "2026-09-01");
    expect(deSetembro.map((p) => p.situacao)).toEqual(["repassado", "repassado"]);
    expect(deSetembro[0].motivo).toBe("Acertada por fora, antes do início do sistema (até 30/09/2026).");
    expect(deSetembro.map((p) => p.repasse?.tipo)).toEqual(["por_fora", "por_fora"]);
    expect(ps.filter((p) => p.competencia === "2026-10-01").map((p) => p.situacao)).toEqual(["a_liberar", "a_liberar"]);
    expect((await direitos(setembro))[0].estado).toBe("realizado");
    expect((await direitos(atravessa)).map((l) => l.estado)).toEqual(["realizado", "previsto"]);
    expect(resumirPartes(ps)).toMatchObject({ acertadoPorFora: 72250 + set, repassadoPago: 0, repassadoAPagar: 0, aLiberar: out + 72250, disponivel: 0 });
    // Itens: as duas partes de setembro; a da reserva que atravessa é parcial (a de outubro vem em outro repasse).
    const itens = await itensDoRepasse(db, org, rep.id);
    expect(itens.map((i) => i.competencia)).toEqual(["2026-09-01", "2026-09-01"]);
    expect(itens.find((i) => i.reservaId === atravessa)).toMatchObject({ valor: set, parcial: true });
    expect(itens.find((i) => i.reservaId === setembro)).toMatchObject({ valor: 72250, parcial: false });
    expect(await listarRepassesDaOrganizacao(db, org, { tipo: "por_fora" })).toHaveLength(2);
    expect(descreverAcertoPorFora(r, INICIO)).toContain("Marcado como acertado por fora até 30/09/2026: Dona Exemplo (R$ ");
    expect(descreverAcertoPorFora(r, INICIO)).toContain("2 parte(s) de reserva)");
  });

  it("reexecutar não repete nada; uma parte antiga que surja depois entra num repasse novo só com ela", async () => {
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
    expect(await acertos()).toHaveLength(2);
  });

  it("depois da marcação, o recebimento da reserva que atravessa libera só a parte de outubro; antecipado e fechamento de outubro não pagam setembro de novo", async () => {
    const { out } = await partesDaQueAtravessa();
    await marcar();
    await receberTudo(db, org, atravessa, "2026-10-03");
    const ps = await partes("2026-10-06");
    expect(ps.find((p) => p.reservaId === atravessa && p.competencia === "2026-10-01")).toMatchObject({ situacao: "disponivel" });
    expect(ps.find((p) => p.reservaId === atravessa && p.competencia === "2026-09-01")).toMatchObject({ situacao: "repassado" });
    const g = await gerarAntecipado(db, org, dono, "2026-10-06", null);
    expect(g.ok).toBe(true);
    const antecipado = (await obterRepasse(db, org, (g as { id: string }).id))!;
    expect(antecipado.valor).toBe(out);
    expect(await itensDoRepasse(db, org, antecipado.id)).toHaveLength(1);
    // Fechamento de outubro: só a reserva de outubro (a parte antecipada já descontada); setembro não aparece como "fora".
    await receberTudo(db, org, outubro, "2026-10-12");
    const [previsao] = await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]);
    expect(previsao).toMatchObject({ valor: 72250, fora: 0 });
    expect(previsao.avisos.join(" ")).not.toContain("fora deste repasse");
    expect(previsao.itens.map((i) => i.reservaId)).toEqual([outubro]);
    expect(await fecharMes(db, org, dono, "2026-10", "2026-11-01", null)).toMatchObject({ ok: true });
    expect(await saldo("2026-11-01")).toBe(0);
  });

  it("bloqueios de antes do início (lançamento em conferência, ajuste a esclarecer, adiantamento em aberto) recusam só aquele proprietário, com o motivo", async () => {
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
    const { repasseId } = await marcadoDe();
    expect(await estornarRepasse(db, org, repasseId, "marcação errada", "2026-10-05", null)).toMatchObject({ ok: true });
    expect(await saldo(INICIO)).toBe(72250 + set);
    const ps = await partes("2026-10-06");
    expect(ps.filter((p) => p.competencia === "2026-09-01").map((p) => p.situacao)).toEqual(["a_liberar", "a_liberar"]);
    expect((await direitos(setembro))[0].estado).toBe("previsto");
    expect((await obterRepasse(db, org, repasseId))!.situacao).toBe("estornado");
    const deNovo = await marcadoDe();
    expect(deNovo).toMatchObject({ valor: 72250 + set, partes: 2 });
    expect(await saldo(INICIO)).toBe(0);
    // Com um repasse mais novo (antecipado de outubro) em vigor, o acerto por fora não pode ser estornado antes dele.
    await receberTudo(db, org, atravessa, "2026-10-03");
    const g = await gerarAntecipado(db, org, dono, "2026-10-06", null);
    expect(g.ok).toBe(true);
    expect(await estornarRepasse(db, org, deNovo.repasseId, "teste", "2026-10-07", null)).toMatchObject({ ok: false, erro: expect.stringContaining("antecipado posterior") });
  });

  it("situação antes do início para o painel; início inválido e outra organização não marcam nada", async () => {
    const { set } = await partesDaQueAtravessa();
    const antes = await situacaoAntesDoInicio(db, org, INICIO, agora);
    expect(antes.map((s) => ({ nome: s.nome, partes: s.partes, valorPartes: s.valorPartes, saldoAberto: s.saldoAberto, gruposAbertos: s.gruposAbertos, bloqueios: s.bloqueios }))).toEqual([
      { nome: "Dona Exemplo", partes: 2, valorPartes: 72250 + set, saldoAberto: 72250 + set, gruposAbertos: 1, bloqueios: [] },
      { nome: "Outro Dono", partes: 1, valorPartes: 72250, saldoAberto: 72250, gruposAbertos: 1, bloqueios: [] },
    ]);
    await marcar();
    expect((await situacaoAntesDoInicio(db, org, INICIO, agora)).map((s) => [s.partes, s.saldoAberto, s.gruposAbertos])).toEqual([[0, 0, 0], [0, 0, 0]]);
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
    expect((await situacaoAntesDoInicio(db, org, INICIO, agora)).find((s) => s.proprietarioId === outro)?.gruposAbertos).toBe(0);
    // Início no meio do mês não existe (as partes são por mês): nada é marcado nem listado.
    expect(await marcarAcertoPorFora(db, org, "2026-10-15", null, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("dia 1º") });
    expect(await situacaoAntesDoInicio(db, org, "2026-10-15", agora)).toEqual([]);
    // Início diferente do configurado (tela velha, configuração mudou no meio): nenhum proprietário é marcado com a data errada.
    // Com 1/9 só o Outro Dono tem lançamento de antes (o crédito de agosto); ele é o único candidato, e é recusado.
    await criar(reserva(a, "2026-09-20", "2026-09-22"));
    const velho = await marcarAcertoPorFora(db, org, "2026-09-01", null, agora);
    expect(velho.ok && velho.marcados).toEqual([]);
    expect(velho.ok && velho.recusados).toEqual([{ nome: "Outro Dono", motivo: "O início do sistema configurado é 01/10/2026, não 01/09/2026: recarregue a página e confira." }]);
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

  it("com o início definido, parte de antes nunca fica disponível e o fechamento bloqueia até a marcação — também para reserva antiga que apareça depois", async () => {
    const { out } = await partesDaQueAtravessa();
    // Recebidas, as partes de setembro continuam a liberar (anteriores ao início); a de outubro fica disponível.
    await receberTudo(db, org, setembro, "2026-09-14");
    await receberTudo(db, org, atravessa, "2026-10-03");
    const antes = await partes("2026-10-06");
    expect(antes.filter((p) => p.competencia === "2026-09-01").map((p) => [p.situacao, p.motivo])).toEqual([
      ["a_liberar", "Anterior ao início do sistema (01/10/2026): já acertada por fora; aguarda a marcação em Financeiro → Repasses."],
      ["a_liberar", "Anterior ao início do sistema (01/10/2026): já acertada por fora; aguarda a marcação em Financeiro → Repasses."],
    ]);
    expect(antes.find((p) => p.reservaId === atravessa && p.competencia === "2026-10-01")?.situacao).toBe("disponivel");
    // O antecipado só leva a parte de outubro; o fechamento de outubro trava enquanto setembro não estiver marcado.
    const g = await gerarAntecipado(db, org, dono, "2026-10-06", null);
    expect(g.ok).toBe(true);
    expect((await obterRepasse(db, org, (g as { id: string }).id))!.valor).toBe(out);
    await receberTudo(db, org, outubro, "2026-10-12");
    const [bloqueada] = await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]);
    expect(bloqueada.bloqueios).toEqual([expect.stringContaining("2 parte(s) de reserva e 1 mês(es) com acerto em aberto anterior(es) ao início do sistema (01/10/2026) ainda sem marcar")]);
    expect(await fecharMes(db, org, dono, "2026-10", "2026-11-01", null)).toMatchObject({ ok: false, erro: expect.stringContaining("anterior(es) ao início do sistema") });
    await marcar();
    const [livre] = await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]);
    expect(livre.bloqueios).toEqual([]);
    expect(livre.valor).toBe(72250);
    // Reserva antiga que aparece depois da marcação (importação atrasada), já recebida: não fica disponível, o antecipado a
    // ignora e o fechamento volta a travar até marcar de novo — nunca é paga pelo sistema.
    const tardia = await criar(reserva(a, "2026-09-20", "2026-09-22"));
    await receberTudo(db, org, tardia, "2026-09-25");
    expect((await partes("2026-10-13")).find((p) => p.reservaId === tardia)).toMatchObject({ situacao: "a_liberar", motivo: expect.stringContaining("Anterior ao início do sistema") });
    // O que um antecipado levaria agora é só a reserva de outubro; a tardia nunca.
    expect((await partesDisponiveis(db, org, dono, new Date("2026-10-13T15:00:00Z"))).map((p) => p.reservaId)).toEqual([outubro]);
    expect((await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]))[0].bloqueios).toEqual([expect.stringContaining("1 parte(s) de reserva e 1 mês(es) com acerto em aberto anterior(es)")]);
    const r = await marcar();
    expect(r.ok && r.marcados).toEqual([expect.objectContaining({ proprietarioId: dono, partes: 1, valor: 72250 })]);
    expect((await preverRepasses(db, org, "2026-10", "2026-11-01", [dono]))[0].bloqueios).toEqual([]);
    expect(await fecharMes(db, org, dono, "2026-10", "2026-11-01", null)).toMatchObject({ ok: true });
    expect(await saldo("2026-11-01")).toBe(0);
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
    await marcar();
    await receberTudo(db, org, atravessa, "2026-10-03");
    limpar();
    expect(await gerarAntecipado(db, org, dono, "2026-10-06", null)).toMatchObject({ ok: true });
    ordem("inicio_sistema");
    await receberTudo(db, org, outubro, "2026-10-12");
    limpar();
    expect(await fecharMes(db, org, dono, "2026-10", "2026-11-01", null)).toMatchObject({ ok: true });
    ordem("inicio_sistema");
  });

  it("o repasse por fora não entra na rotina de e-mails nem aceita envio: nada foi pago pelo sistema", async () => {
    const { repasseId } = await marcadoDe();
    const correio = new CorreioMemoria();
    expect(await enviarEmailsDeRepasses(db, org, correio, agora)).toMatchObject({ enviados: 0, semComprovante: 0, incertos: 0, falhas: 0 });
    expect(correio.enviadas).toHaveLength(0);
    expect(await enviarEmailDoRepasse(db, org, repasseId, correio, agora)).toBe("por_fora");
    expect((await obterRepasse(db, org, repasseId))!.emailSituacao).toBe("pendente");
  });
});
