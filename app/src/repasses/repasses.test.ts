import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contestar, desfazerQuitacao, listarAdiantamentos, obterAdiantamento, quitar, resolverContestacao } from "@/adiantamentos/adiantamentos";
import { registrarAjuste } from "@/ajustes/ajustes";
import { criarContrato } from "@/contratos/repositorio";
import { imoveis, lancamentos, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarCategoria } from "@/despesas/categorias";
import { estornarDespesa, registrarDespesa } from "@/despesas/despesas";
import { saldoAcerto } from "@/financeiro/ledger";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { calcularRepasse, estornarRepasse, fecharMes, limitesDoMes, listarRepasses, marcarRepassePago, mesAFechar, preverRepasses, somarMes } from "./repasses";
import { receberTudo } from "./testes";

describe("regras puras", () => {
  it("limites do mês, mês a fechar e navegação", () => {
    expect(limitesDoMes("2026-02")).toEqual({ inicio: "2026-02-01", fim: "2026-03-01", ultimoDia: "2026-02-28" });
    expect(limitesDoMes("2026-12")).toEqual({ inicio: "2026-12-01", fim: "2027-01-01", ultimoDia: "2026-12-31" });
    expect(limitesDoMes("2026-13")).toBeNull();
    expect(mesAFechar("2026-11-01")).toBe("2026-10");
    expect(mesAFechar("2027-01-01")).toBe("2026-12");
    expect(somarMes("2026-12", 1)).toBe("2027-01");
    expect(somarMes("2026-01", -1)).toBe("2025-12");
  });

  it("valor = saldo + contestados; sem saldo positivo, nada a repassar e nada descontado", () => {
    const um = (v: number) => new Map<string | null, number>([["a", v]]);
    expect(calcularRepasse(um(32250), new Map(), 40000)).toMatchObject({ valor: 32250, aDescontar: 40000, deve: 0 });
    expect(calcularRepasse(um(32250), um(40000), 0)).toMatchObject({ valor: 72250, contestado: 40000 });
    expect(calcularRepasse(um(-27750), new Map(), 100000)).toMatchObject({ valor: 0, aDescontar: 0, deve: 27750 });
    const dois = calcularRepasse(new Map<string | null, number>([["a", 50000], ["b", -10000]]), new Map(), 10000);
    expect(dois.valor).toBe(40000);
    expect([...dois.porImovel]).toEqual([["a", 50000], ["b", -10000]]);
  });
});

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;
let a: string;
let b: string;
let dono: string;
let categoria: string;
const MES = "2026-10";
const DEPOIS = "2026-11-01";

const reserva = (imovelId: string, checkin: string, checkout: string): DadosReserva => ({
  imovelId,
  origem: "booking",
  estado: "confirmada",
  checkin,
  checkout,
  hospedes: 2,
  hospedeNome: "Hóspede Fictício",
  hospedeEmail: "",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 100000,
  taxaCanal: 15000,
  valorLiquido: null,
  codigoCanal: "",
  observacoes: "",
});

const reparo = (valor: number, imovelId = a) =>
  registrarDespesa(
    db,
    org,
    { responsavel: "proprietario", pagoPor: "empresa", categoriaId: categoria, descricao: "Reparo", valor, data: "2026-10-05", imovelId, proprietarioId: null, fornecedor: "", comprovante: "", paga: true, dataPagamento: "2026-10-06" },
    null,
  );


/** Cria a reserva e registra o recebimento integral (M4.10: só o dinheiro já com a empresa entra no repasse). */
async function criarRecebida(dados: Parameters<typeof criarReserva>[2]) {
  const r = await criarReserva(db, org, dados, null);
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  await receberTudo(db, org, r.reserva.id, dados.checkin);
  return r.reserva;
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: a }, { id: b }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro" },
      { organizacaoId: org, codigo: "102", nome: "Um" },
    ])
    .returning();
  [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona Exemplo", email: "dona@example.com", chavePix: "dona@example.com" }).returning();
  await db.insert(proprietarioImoveis).values([
    { proprietarioId: dono, imovelId: a },
    { proprietarioId: dono, imovelId: b },
  ]);
  await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  const c = await criarCategoria(db, org, "Manutenção", null);
  if (!c.ok) throw new Error("categoria");
  categoria = c.categoria.id;
  // Booking: a empresa recebe. Bruto 1.000, taxa 150, comissão 15% de 850 = 127,50 → proprietário 722,50.
  await criarRecebida(reserva(a, "2026-10-10", "2026-10-13"));
});
afterEach(() => close());

const saldo = (fim = DEPOIS) => saldoAcerto(db, org, { proprietarioId: dono, fim });
const prever = async (hoje = DEPOIS) => (await preverRepasses(db, org, MES, hoje))[0];

describe("fechamento do mês", () => {
  it("desconta o adiantamento, grava o repasse e zera o saldo; o adiantamento fica quitado por compensação", async () => {
    await reparo(40000);
    const p = await prever();
    expect(p).toMatchObject({ nome: "Dona Exemplo", saldo: 32250, aDescontar: 40000, contestado: 0, valor: 32250, chavePix: "dona@example.com", imoveis: ["102", "403"], bloqueios: [] });

    const r = await fecharMes(db, org, dono, MES, DEPOIS, null);
    expect(r.ok).toBe(true);
    expect(await saldo()).toBe(0);
    const [adiant] = await listarAdiantamentos(db, org, { proprietarioId: dono });
    expect(adiant).toMatchObject({ situacao: "quitado", aberto: 0 });
    expect(adiant.quitacoes[0]).toMatchObject({ forma: "compensacao", valor: 40000 });
    // Compensação só se desfaz estornando o repasse.
    expect(await desfazerQuitacao(db, org, adiant.quitacoes[0].id, "x", null)).toMatchObject({ ok: false });

    const depois = await prever();
    expect(depois.repasse).toMatchObject({ valor: 32250, descontado: 40000, situacao: "a_pagar" });
    expect(await fecharMes(db, org, dono, MES, DEPOIS, null)).toMatchObject({ ok: false, erro: expect.stringContaining("já foi fechado") });
  });

  it("antes do dia 1º, com acerto pendente ou sem saldo positivo, não fecha", async () => {
    expect((await prever("2026-10-31")).bloqueios[0]).toContain("não terminou");
    expect(await fecharMes(db, org, dono, MES, "2026-10-31", null)).toMatchObject({ ok: false, erro: expect.stringContaining("não terminou") });

    await reparo(100000);
    expect(await prever()).toMatchObject({ valor: 0, deve: 27750 });
    expect(await fecharMes(db, org, dono, MES, DEPOIS, null)).toMatchObject({ ok: false, erro: "Nada a repassar neste mês." });
  });

  it("ajuste com o proprietário ainda pendente bloqueia o fechamento", async () => {
    await registrarAjuste(
      db,
      org,
      { data: "2026-10-15", imovelId: a, reservaId: null, proprietarioId: null, motivo: "", origem: "desconhecida", origemComprovada: false, evidencia: "Extrato", comprovante: "", valor: 5000, direcao: "proprietario_credito" },
      null,
    );
    expect((await prever()).bloqueios.join(" ")).toContain("acerto pendente");
    expect(await fecharMes(db, org, dono, MES, DEPOIS, null)).toMatchObject({ ok: false });
  });

  it("ajuste com o proprietário sem valor (ainda sem lançamento) também bloqueia", async () => {
    await registrarAjuste(
      db,
      org,
      { data: "2026-10-15", imovelId: a, reservaId: null, proprietarioId: null, motivo: "", origem: "desconhecida", origemComprovada: false, evidencia: "Extrato", comprovante: "", valor: null, direcao: "proprietario_debito" },
      null,
    );
    expect((await prever()).bloqueios.join(" ")).toContain("ajuste(s) com o proprietário ainda a esclarecer");
    expect(await fecharMes(db, org, dono, MES, DEPOIS, null)).toMatchObject({ ok: false });
  });

  it("contestação durante o fechamento: o que foi descontado bate sempre com as compensações", async () => {
    await reparo(40000);
    const [adiant] = await listarAdiantamentos(db, org, { proprietarioId: dono });
    const [fech] = await Promise.all([fecharMes(db, org, dono, MES, DEPOIS, null), contestar(db, org, adiant.id, "Não autorizei", null)]);
    const [r] = await listarRepasses(db, org, dono);
    const depois = await obterAdiantamento(db, org, adiant.id);
    if (fech.ok) {
      const compensado = depois!.quitacoes.filter((q) => q.forma === "compensacao" && !q.desfeitaEm).reduce((t, q) => t + q.valor, 0);
      expect(compensado).toBe(r.descontado);
    } else {
      expect(r).toBeUndefined();
    }
  });

  it("adiantamento contestado não é descontado e continua devido depois do repasse", async () => {
    await reparo(40000);
    const [adiant] = await listarAdiantamentos(db, org, { proprietarioId: dono });
    await contestar(db, org, adiant.id, "Não autorizei", null);
    const p = await prever();
    expect(p).toMatchObject({ valor: 72250, contestado: 40000, aDescontar: 0 });
    expect(p.avisos.join(" ")).toContain("contestados");
    expect((await fecharMes(db, org, dono, MES, DEPOIS, null)).ok).toBe(true);
    expect(await saldo()).toBe(-40000);
    expect(await obterAdiantamento(db, org, adiant.id)).toMatchObject({ situacao: "contestado", aberto: 40000 });
    expect((await prever()).avisos.join(" ")).not.toContain("próximo repasse");
    // Contestação mantida depois do fechamento: a dívida passa a ser descontada no próximo repasse — avisa.
    await resolverContestacao(db, org, adiant.id, { resolucao: "mantida", nota: "", data: "2026-11-02" }, null);
    expect((await prever()).avisos.join(" ")).toContain("mudou em -400,00: a diferença entra no próximo repasse");
  });

  it("mês sem repasse próprio: contestação resolvida depois do repasse seguinte aparece como diferença", async () => {
    await reparo(40000);
    const [adiant] = await listarAdiantamentos(db, org, { proprietarioId: dono });
    await contestar(db, org, adiant.id, "Não autorizei", null);
    await criarRecebida(reserva(a, "2026-11-10", "2026-11-13"));
    expect((await fecharMes(db, org, dono, "2026-11", "2026-12-01", null)).ok).toBe(true);
    const outubro = async () => (await preverRepasses(db, org, MES, "2026-12-02"))[0];
    expect(await outubro()).toMatchObject({ repasse: null, repassePosterior: "2026-11", diferencaPosFechamento: 0 });
    // Mantida depois do repasse de novembro: a dívida de outubro não foi descontada nele.
    await resolverContestacao(db, org, adiant.id, { resolucao: "mantida", nota: "", data: "2026-12-02" }, null);
    expect(await outubro()).toMatchObject({ diferencaPosFechamento: -40000 });
    // Contestada de novo: volta a ficar fora do desconto, como no repasse.
    await contestar(db, org, adiant.id, "Revisar de novo", null);
    expect(await outubro()).toMatchObject({ diferencaPosFechamento: 0 });
  });

  it("mês sem repasse próprio: 'empresa assume' depois do repasse seguinte não inventa diferença", async () => {
    await reparo(40000);
    const [adiant] = await listarAdiantamentos(db, org, { proprietarioId: dono });
    await contestar(db, org, adiant.id, "Não autorizei", null);
    await criarRecebida(reserva(a, "2026-11-10", "2026-11-13"));
    expect((await fecharMes(db, org, dono, "2026-11", "2026-12-01", null)).ok).toBe(true);
    // A empresa assume com data de outubro: o adiantamento sai quitado e a compensação entra no livro.
    expect((await resolverContestacao(db, org, adiant.id, { resolucao: "empresa_assume", nota: "", data: "2026-10-20" }, null)).ok).toBe(true);
    expect((await preverRepasses(db, org, MES, "2026-12-02"))[0]).toMatchObject({ repassePosterior: "2026-11", diferencaPosFechamento: 0 });
  });

  it("mês sem repasse próprio: 'empresa assume' feito antes do repasse seguinte e desfeito depois não inventa diferença", async () => {
    await reparo(40000);
    const [adiant] = await listarAdiantamentos(db, org, { proprietarioId: dono });
    await contestar(db, org, adiant.id, "Não autorizei", null);
    expect((await resolverContestacao(db, org, adiant.id, { resolucao: "empresa_assume", nota: "", data: "2026-10-20" }, null)).ok).toBe(true);
    await criarRecebida(reserva(a, "2026-11-10", "2026-11-13"));
    expect((await fecharMes(db, org, dono, "2026-11", "2026-12-01", null)).ok).toBe(true);
    // Desfeito depois do repasse de novembro: a contestação reabre e o valor volta a ficar fora do desconto.
    const q = (await obterAdiantamento(db, org, adiant.id))!.quitacoes.find((x) => x.forma === "empresa_assume")!;
    expect((await desfazerQuitacao(db, org, q.id, "lançado errado", null)).ok).toBe(true);
    expect(await obterAdiantamento(db, org, adiant.id)).toMatchObject({ situacao: "contestado" });
    expect((await preverRepasses(db, org, MES, "2026-12-02"))[0]).toMatchObject({ repassePosterior: "2026-11", diferencaPosFechamento: 0 });
  });

  it("mês sem repasse próprio: despesa de adiantamento contestado estornada depois do repasse seguinte não inventa diferença", async () => {
    await reparo(40000);
    const [adiant] = await listarAdiantamentos(db, org, { proprietarioId: dono });
    await contestar(db, org, adiant.id, "Não autorizei", null);
    await criarRecebida(reserva(a, "2026-11-10", "2026-11-13"));
    expect((await fecharMes(db, org, dono, "2026-11", "2026-12-01", null)).ok).toBe(true);
    // A despesa de origem é estornada: a contestação é encerrada e o adiantamento, estornado.
    expect(await estornarDespesa(db, org, adiant.despesaId!, "lançada errado", null)).toBe(true);
    expect(await listarAdiantamentos(db, org, { proprietarioId: dono })).toEqual([]);
    expect((await preverRepasses(db, org, MES, "2026-12-02"))[0]).toMatchObject({ repassePosterior: "2026-11", diferencaPosFechamento: 0 });
  });

  it("mês sem repasse próprio: reembolso parcial e nova contestação do restante não inventam diferença", async () => {
    await reparo(40000);
    const [adiant] = await listarAdiantamentos(db, org, { proprietarioId: dono });
    await contestar(db, org, adiant.id, "Não autorizei", null);
    await criarRecebida(reserva(a, "2026-11-10", "2026-11-13"));
    expect((await fecharMes(db, org, dono, "2026-11", "2026-12-01", null)).ok).toBe(true);
    // Mantida, reembolso parcial com data de outubro e nova contestação dos 300 restantes.
    await resolverContestacao(db, org, adiant.id, { resolucao: "mantida", nota: "", data: "2026-12-02" }, null);
    expect(await quitar(db, org, adiant.id, { forma: "reembolso", valor: 10000, data: "2026-10-25" }, null)).toEqual({ ok: true });
    await contestar(db, org, adiant.id, "Restante também não", null);
    // O que ficou fora do desconto caiu de 400 para 300, e o reembolso de 100 entrou: nada muda.
    expect((await preverRepasses(db, org, MES, "2026-12-02"))[0]).toMatchObject({ repassePosterior: "2026-11", diferencaPosFechamento: 0 });
  });

  it("imóvel devedor é compensado com o outro do mesmo proprietário; cada imóvel fica zerado", async () => {
    await reparo(10000, b); // o 102 não tem receita: só a dívida
    const p = await prever();
    expect(p.valor).toBe(62250);
    expect((await fecharMes(db, org, dono, MES, DEPOIS, null)).ok).toBe(true);
    expect(await saldoAcerto(db, org, { imovelIds: [a], fim: DEPOIS })).toBe(0);
    expect(await saldoAcerto(db, org, { imovelIds: [b], fim: DEPOIS })).toBe(0);
    const repasseLanc = await db.select().from(lancamentos).where(eq(lancamentos.tipo, "repasse"));
    expect(repasseLanc.map((l) => [l.montante, l.estado, l.competencia]).sort()).toEqual([
      [-10000, "previsto", "2026-10-31"],
      [72250, "previsto", "2026-10-31"],
    ]);
  });
});

describe("pagamento e estorno", () => {
  it("marcar pago: data válida e não futura; lançamentos viram realizados", async () => {
    const r = await fecharMes(db, org, dono, MES, DEPOIS, null);
    if (!r.ok) throw new Error(r.erro);
    expect(await marcarRepassePago(db, org, r.id, "2026-11-05", DEPOIS, null)).toMatchObject({ ok: false, erro: expect.stringContaining("futuro") });
    expect(await marcarRepassePago(db, org, r.id, "2026-10-31", DEPOIS, null)).toMatchObject({ ok: false, erro: expect.stringContaining("antes de 01/11/2026") });
    expect((await marcarRepassePago(db, org, r.id, DEPOIS, DEPOIS, null)).ok).toBe(true);
    const [l] = await db.select().from(lancamentos).where(eq(lancamentos.tipo, "repasse"));
    expect(l).toMatchObject({ estado: "realizado", dataCaixa: DEPOIS });
    expect(await marcarRepassePago(db, org, r.id, DEPOIS, DEPOIS, null)).toMatchObject({ ok: false, erro: expect.stringContaining("já está pago") });
  });

  it("estornar desfaz lançamentos e descontos e libera o mês; só o mais recente", async () => {
    await reparo(40000);
    const r = await fecharMes(db, org, dono, MES, DEPOIS, null);
    if (!r.ok) throw new Error(r.erro);
    // Novembro: mais uma reserva, fecha depois de outubro.
    await criarRecebida(reserva(a, "2026-11-10", "2026-11-13"));
    const nov = await fecharMes(db, org, dono, "2026-11", "2026-12-01", null);
    if (!nov.ok) throw new Error(nov.erro);
    expect(await estornarRepasse(db, org, r.id, "Valor errado", DEPOIS, null)).toMatchObject({ ok: false, erro: expect.stringContaining("posterior") });
    expect((await preverRepasses(db, org, MES, "2026-12-01"))[0].bloqueios.join(" ")).toContain("novembro de 2026");

    expect(await estornarRepasse(db, org, nov.id, "", "2026-12-01", null)).toMatchObject({ ok: false });
    expect((await estornarRepasse(db, org, nov.id, "Refazer", "2026-12-01", null)).ok).toBe(true);
    expect((await estornarRepasse(db, org, r.id, "Refazer", "2026-12-01", null)).ok).toBe(true);
    expect(await saldo()).toBe(32250);
    const [adiant] = await listarAdiantamentos(db, org, { proprietarioId: dono });
    expect(adiant).toMatchObject({ situacao: "a_cobrar", aberto: 40000 });
    expect((await listarRepasses(db, org, dono)).map((x) => x.situacao)).toEqual(["estornado", "estornado"]);
    expect((await fecharMes(db, org, dono, MES, "2026-12-01", null)).ok).toBe(true);
  });

  it("estornar outubro e fechar novembro ao mesmo tempo nunca deixam novembro ativo com outubro estornado", async () => {
    const out = await fecharMes(db, org, dono, MES, DEPOIS, null);
    if (!out.ok) throw new Error(out.erro);
    await criarRecebida(reserva(a, "2026-11-10", "2026-11-13"));
    const [est, nov] = await Promise.all([estornarRepasse(db, org, out.id, "Refazer", "2026-12-01", null), fecharMes(db, org, dono, "2026-11", "2026-12-01", null)]);
    const ativos = (await listarRepasses(db, org, dono)).filter((x) => !x.estornadoEm).map((x) => x.mes);
    // Ou o estorno venceu (e novembro fecha sobre outubro reaberto), ou novembro venceu (e o estorno foi recusado).
    if (est.ok) expect(ativos).toEqual(nov.ok ? ["2026-11-01"] : []);
    else expect(ativos).toEqual(["2026-11-01", "2026-10-01"]);
    if (est.ok && nov.ok) expect((await listarRepasses(db, org, dono)).find((x) => x.mes === "2026-11-01")?.valor).toBe(72250 * 2);
  });

  it("dois fechamentos ao mesmo tempo gravam um só; outra organização não vê nem fecha", async () => {
    const rs = await Promise.all([fecharMes(db, org, dono, MES, DEPOIS, null), fecharMes(db, org, dono, MES, DEPOIS, null)]);
    expect(rs.filter((x) => x.ok)).toHaveLength(1);
    expect(await preverRepasses(db, outraOrg, MES, DEPOIS)).toEqual([]);
    expect(await fecharMes(db, outraOrg, dono, MES, DEPOIS, null)).toMatchObject({ ok: false });
    const id = rs.find((x) => x.ok) as { id: string };
    expect(await marcarRepassePago(db, outraOrg, id.id, DEPOIS, DEPOIS, null)).toMatchObject({ ok: false });
  });

  it("entrada depois do fechamento vira aviso e vai para o próximo repasse", async () => {
    expect((await fecharMes(db, org, dono, MES, DEPOIS, null)).ok).toBe(true);
    await criarRecebida(reserva(a, "2026-10-20", "2026-10-22")); // reserva de outubro lançada tarde
    const p = await prever();
    expect(p.avisos.join(" ")).toContain("entra no próximo repasse");
    const nov = (await preverRepasses(db, org, "2026-11", "2026-12-01"))[0];
    expect(nov.valor).toBe(72250);
  });
});
