/**
 * M8.2e — a disputa do pagamento (contestação) no lado do proprietário e do dinheiro com a empresa: a reserva em
 * conferência por disputa (a parte presa fora do fechamento, com o motivo próprio), as linhas da disputa que seguem a
 * parte (segurado, definitivo, devolvido), o repasse, o e-mail, as despesas, o dinheiro com a empresa na perdida, o
 * portal e o relatório. As linhas de `contestacoes_pagamento` e os lançamentos são montados à mão, com as chaves e a
 * origem do desenho (`chavesDaContestacao`, origem "contestacao_pagamento"), sem depender do domínio do pagamento.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarContrato } from "@/contratos/repositorio";
import { contestacoesPagamento, devolucoesPagamento, imoveis, lancamentos, organizacoes, proprietarioImoveis, proprietarios, repasses } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { estornarDespesa, listarDespesas, marcarDespesaPaga, obterDespesa, textoDaDespesaDaDisputa, totaisDespesas, ERRO_DESPESA_DA_CONTESTACAO } from "@/despesas/despesas";
import { lancar, LancamentoInvalido, saldoAcerto } from "@/financeiro/ledger";
import {
  chavesDaContestacao,
  descricaoSeguradoDoProprietario,
  MOTIVO_PARTE_EM_CONFERENCIA,
  ORIGEM_LANCAMENTO_CONTESTACAO,
  type QuemArcaContestacao,
  textoRepasseComDisputa,
} from "@/pagamentos/contestacao-regras";
import { reservasDoPortal } from "@/portal/reservas";
import { resumoDoProprietario } from "@/portal/resumo";
import { divisaoDoDeve, nomeDoDescontoQueNaoSeTransfere, rodapeDoPortal, textoForaPorDisputa } from "@/portal/rodape";
import { conciliacao, conciliacaoFecha } from "@/relatorios/dinheiro";
import { partesDoRelatorio } from "@/relatorios/dados";
import { dadosDoRelatorio, textosDoRelatorio } from "@/relatorios/relatorio";
import type { DadosReserva } from "@/reservas/regras";
import { criarReserva } from "@/reservas/repositorio";
import { avisosDeContestacaoNosRepasses } from "./avisos-contestacao";
import { lancarAcertoDoProprietario, lancarDescontoDoProprietario, mesDoDesconto } from "./descontos";
import { textoDoEmailDoRepasse } from "./email";
import { classificarParte, type ParteBruta, partesDoProprietario, textoDaLinhaDaDisputa } from "./extrato";
import { dinheiroComAEmpresa, ERRO_RECEBIMENTO_DA_CONTESTACAO, estornarRecebimento, recebidoPorReserva } from "./recebimentos";
import {
  avisosDeDisputaNoRepasse,
  descricaoDoItem,
  ERRO_DESCONTO_NAO_COBERTO,
  estornarRepasse,
  fecharMes,
  foraPorDisputaDoFechamento,
  gerarAntecipado,
  itensDoRepasse,
  marcarRepassePago,
  obterRepasse,
  preverRepasses,
  separarAntecipado,
} from "./repasses";
import { pagamentoDoSiteDeTeste } from "./testes-cancelamento";
import { receberTudo } from "./testes";

let db: Db, close: () => Promise<void>, org: string, a: string, dono: string;

const sp = (dia: string, hora = "12:00") => new Date(`${dia}T${hora}:00-03:00`);
// Booking (a empresa recebe): bruto 1.000, taxa 150 → líquido 850; comissão 15% = 127,50 → parte 722,50 (D = 72.250, C = 12.750: 85%).
const reserva = (checkin: string, checkout: string, over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId: a, origem: "booking", estado: "confirmada", checkin, checkout, hospedes: 2, hospedeNome: "Hóspede Fictício", hospedeEmail: "", hospedeTelefone: "", hospedeOrigem: "", moeda: "BRL",
  valorBruto: 100000, taxaCanal: 15000, valorLiquido: null, codigoCanal: "", observacoes: "", ...over,
});
const criar = async (dados: DadosReserva, receberEm?: string) => {
  const r = await criarReserva(db, org, dados, null);
  if (!r.ok) throw new Error(JSON.stringify(r.erros));
  if (receberEm) await receberTudo(db, org, r.reserva.id, receberEm);
  return r.reserva;
};
type Reserva = Awaited<ReturnType<typeof criar>>;
const partes = (hoje: string) => partesDoProprietario(db, org, dono, sp(hoje));
const id = (r: { ok: boolean } & ({ id: string } | { erro: string })) => {
  if (!r.ok || !("id" in r)) throw new Error("erro" in r ? r.erro : "falhou");
  return r.id;
};

/** A reserva paga pelo site (o pagamento com o dinheiro dela) e uma disputa aberta de R$ 1.000,00 nele, montada à mão. */
async function disputa(r: Reserva, over: Partial<typeof contestacoesPagamento.$inferInsert> = {}) {
  const pagamentoId = await pagamentoDoSiteDeTeste(db, org, r);
  const [c] = await db
    .insert(contestacoesPagamento)
    .values({ organizacaoId: org, pagamentoId, reservaId: r.id, imovelId: a, tipo: "chargeback", origem: "leitura", idCaso: "7000000001", situacao: "aberta", situacaoPagamentoAntes: "aprovado", valor: 100000, valorOrigem: "leitura", valorEmRisco: 100000, abertaEm: sp("2026-10-15"), ...over })
    .returning();
  return c;
}
type Disputa = Awaited<ReturnType<typeof disputa>>;

/** A decisão de quem arca (versão 1) e o valor segurado do proprietário (`…:proprietario:v1`), no mês corrente de `agora`. */
async function decidir(c: Disputa, r: Reserva, agora: Date, o: { x?: number; quemArca?: QuemArcaContestacao; explicacao?: string } = {}) {
  const x = o.x ?? 85000;
  await db
    .update(contestacoesPagamento)
    .set({ decisaoVersao: 1, causa: "imovel", quemArca: o.quemArca ?? "proporcional", decisaoNota: "Nota interna da equipe sobre o caso 7000000001", explicacaoProprietario: o.explicacao ?? "", decisaoEm: agora, baseParteProprietario: 72250, baseComissao: 12750, exposicao: c.valorEmRisco, parteProprietario: x, parteScl: c.valorEmRisco - x })
    .where(eq(contestacoesPagamento.id, c.id));
  const l = await lancarAcertoDoProprietario(
    db,
    org,
    ORIGEM_LANCAMENTO_CONTESTACAO,
    { chave: chavesDaContestacao(c.pagamentoId, c.id).proprietario(1), proprietarioId: dono, imovelId: a, reservaId: r.id, valor: -x, competencia: mesDoDesconto(agora), descricao: descricaoSeguradoDoProprietario(r.codigo, x) },
    null,
    agora,
  );
  // O relógio do banco é o de verdade: a data de criação acompanha o `agora` do teste (aviso de 7 dias e estorno do repasse).
  await db.update(lancamentos).set({ criadoEm: agora }).where(eq(lancamentos.id, l.id));
  return l;
}

/** Uma linha de caixa da disputa (retido, volta, caixa final): valor 0, só `montante`, realizada no dia. */
const caixa = (c: Disputa, r: Reserva, tipo: "devolucao" | "recebimento", chave: string, montante: number, dia: string) =>
  lancar(db, org, [{ tipo, descricao: `Disputa do pagamento da reserva ${r.codigo}`, valor: 0, montante, competencia: dia, dataCaixa: dia, estado: "realizado", imovelId: a, reservaId: r.id, origem: ORIGEM_LANCAMENTO_CONTESTACAO, chaveOrigem: chave }], null);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: a }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Quatro" }).returning();
  [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona Exemplo", email: "dona@example.com", chavePix: "dona@example.com" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: a, criadoEm: new Date("2025-01-01T12:00:00Z") });
  await criarContrato(db, org, a, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
});
afterEach(() => close());

describe("reserva em conferência por disputa (M8.2e, teste 8)", () => {
  it("a parte ainda não repassada fica a liberar até a decisão; valor em risco 0 e possível duplicata não seguram; com a decisão, volta às regras de sempre", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const c = await disputa(r);
    const [p] = await partes("2026-10-20");
    expect(p).toMatchObject({ situacao: "a_liberar", motivo: MOTIVO_PARTE_EM_CONFERENCIA, contestacaoSemDecisao: true });
    expect(await gerarAntecipado(db, org, dono, "2026-10-20", null)).toEqual({ ok: false, erro: "Nada disponível para repassar agora." });
    // Valor em risco 0 (a disputa só cobre uma devolução já lançada) e a possível duplicata não seguram nada.
    await db.update(contestacoesPagamento).set({ valorEmRisco: 0 }).where(eq(contestacoesPagamento.id, c.id));
    expect((await partes("2026-10-20"))[0].situacao).toBe("disponivel");
    await db.update(contestacoesPagamento).set({ valorEmRisco: 100000, duplicataPossivel: true }).where(eq(contestacoesPagamento.id, c.id));
    expect((await partes("2026-10-20"))[0].situacao).toBe("disponivel");
    // "Encerrada no Mercado Pago, resultado a conferir" continua segurando.
    await db.update(contestacoesPagamento).set({ duplicataPossivel: false, situacao: "a_confirmar" }).where(eq(contestacoesPagamento.id, c.id));
    expect((await partes("2026-10-20"))[0].situacao).toBe("a_liberar");
    // Com a decisão (C5): a parte volta às regras de sempre e só o valor do proprietário fica segurado (a linha da disputa).
    await decidir(c, r, sp("2026-10-21"));
    const depois = await partes("2026-10-21");
    expect(depois.map((x) => [x.valor, x.situacao, x.origemLancamento])).toEqual([
      [72250, "disponivel", "motor"],
      [-85000, "disponivel", ORIGEM_LANCAMENTO_CONTESTACAO],
    ]);
    // As partes disponíveis não cobrem o valor segurado: o antecipado espera.
    expect(await gerarAntecipado(db, org, dono, "2026-10-21", null)).toEqual({
      ok: false,
      erro: `${ERRO_DESCONTO_NAO_COBERTO} (R$ 722,50) não cobrem o desconto de R$ 850,00 (disputa do pagamento da reserva ${r.codigo}): ficam para o próximo repasse.`,
    });
  });

  it("perdida sem decisão continua em conferência; com a perda inteira coberta pela devolução substituída, nada a dividir, não", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const c = await disputa(r, { situacao: "perdida", valorPerdido: 100000, resultadoEm: "2026-12-10" });
    expect((await partes("2026-12-11"))[0]).toMatchObject({ situacao: "a_liberar", motivo: MOTIVO_PARTE_EM_CONFERENCIA });
    await db.insert(devolucoesPagamento).values({ organizacaoId: org, pagamentoId: c.pagamentoId, motivo: "cancelamento", valor: 100000, situacao: "confirmada", origem: "cancelamento", contestacaoId: c.id });
    expect((await partes("2026-12-11"))[0].situacao).toBe("disponivel");
  });

  it("a parte já repassada não é descontada antes da decisão; o repasse a pagar com parte em disputa ganha o aviso (cartão, Marcar como pago, Início), sem bloquear", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const rep = id(await gerarAntecipado(db, org, dono, "2026-10-14", null));
    const c = await disputa(r);
    expect((await partes("2026-10-16"))[0]).toMatchObject({ situacao: "repassado", valor: 72250 });
    expect(await saldoAcerto(db, org, { proprietarioId: dono, fim: "2026-11-01" })).toBe(0);
    const itens = await itensDoRepasse(db, org, rep);
    expect(itens[0].disputaAbertaEm).toEqual(c.abertaEm);
    const texto = textoRepasseComDisputa(r.codigo, c.abertaEm);
    expect(texto).toBe(`A reserva ${r.codigo} tem uma disputa do pagamento aberta desde 15/10: estorne o repasse antes de pagar, se quiser segurar a parte dela.`);
    expect(avisosDeDisputaNoRepasse(itens)).toEqual([texto]);
    expect(await avisosDeContestacaoNosRepasses(db, org, sp("2026-10-16"))).toEqual([{ nivel: "atencao", texto, link: "/painel/financeiro/repasses" }]);
    // Nada é bloqueado: a equipe pode pagar; pago, o aviso sai do Início.
    id(await marcarRepassePago(db, org, rep, "2026-10-16", "2026-10-16", null));
    expect(await avisosDeContestacaoNosRepasses(db, org, sp("2026-10-16"))).toEqual([]);
  });

  it("o fechamento não trava: a parte presa vai ao seguinte com o motivo próprio (aviso, previsão, rodapé e e-mail); as outras passam; o portal mostra a reserva em conferência", async () => {
    const presa = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const livre = await criar(reserva("2026-10-20", "2026-10-23"), "2026-10-20");
    await disputa(presa);
    const [p] = await preverRepasses(db, org, "2026-10", "2026-11-02", [dono]);
    expect(p.bloqueios).toEqual([]);
    expect(p).toMatchObject({ valor: 72250, fora: 72250, foraPorDisputa: 72250 });
    expect(p.avisos).toContain(`R$ 722,50 da competência ficam fora deste repasse e passam para o seguinte: reserva em conferência: disputa do pagamento (reservas ${presa.codigo}).`);
    expect(p.avisos.join(" ")).not.toContain("dinheiro ainda não registrado");
    // Rodapé do portal (mês terminado, sem repasse ainda): o motivo próprio, sem esconder o credor e o Pix.
    const [rod] = await rodapeDoPortal(db, org, { proprietarios: [{ id: dono, nome: "Dona Exemplo" }], mes: "2026-10", hoje: "2026-11-02", pixEmpresa: "" });
    expect(rod).toMatchObject({ situacao: "empresa_deve", valor: 72250, foraPorDisputa: 72250 });
    expect(textoForaPorDisputa(rod)).toBe("R$ 722,50 da sua parte ficam para o próximo repasse: reserva em conferência: disputa do pagamento.");
    // Portal: a reserva presa "Em conferência (disputa do pagamento)"; a outra, definida.
    const lista = await reservasDoPortal(db, org, { proprietarioIds: [dono], imovelIds: [a], periodo: { inicio: "2026-10-01", fim: "2026-11-01" } });
    expect(lista.map((x) => [x.codigo, x.situacao])).toEqual([
      [presa.codigo, "em_conferencia_disputa"],
      [livre.codigo, "definido"],
    ]);
    // Relatório de outubro: a parte presa "em conferência (disputa do pagamento)", o aviso próprio e o saldo com o motivo.
    const rel = textosDoRelatorio(await dadosDoRelatorio(db, org, { donos: [{ id: dono, nome: "Dona Exemplo" }], imoveis: [{ id: a, codigo: "403", nome: "Quatro" }], todosOsImoveis: true, ano: 2026, mes: 10, hoje: "2026-11-02", agora: sp("2026-11-02") }));
    expect(rel.reservas.find((x) => x.codigo === presa.codigo)).toMatchObject({ situacao: "a liberar: em conferência (disputa do pagamento)", situacaoTipo: "aviso" });
    expect(rel.avisos.find((x) => x.includes(MOTIVO_PARTE_EM_CONFERENCIA))).toContain("Espera a decisão da A sobre a disputa do pagamento; você não precisa fazer nada.");
    expect(rel.saldo).toContain("R$ 722,50 da sua parte ficam para o próximo repasse: reserva em conferência: disputa do pagamento.");
    // Fecha: só a parte livre; o e-mail dá o motivo da presa.
    const fechado = id(await fecharMes(db, org, dono, "2026-10", "2026-11-02", null));
    id(await marcarRepassePago(db, org, fechado, "2026-11-02", "2026-11-02", null, { texto: "E2E-1" }));
    // O relógio do banco é o de verdade: a criação do fechamento acompanha o dia do teste (a disputa abriu antes dele).
    await db.update(repasses).set({ criadoEm: sp("2026-11-02") }).where(eq(repasses.id, fechado));
    const r = (await obterRepasse(db, org, fechado))!;
    expect(r).toMatchObject({ valor: 72250, foraDoFechamento: 72250 });
    const foraPorDisputa = await foraPorDisputaDoFechamento(db, org, r);
    expect(foraPorDisputa).toBe(72250);
    const email = textoDoEmailDoRepasse(r, await itensDoRepasse(db, org, fechado), "Sua Casa", { foraPorDisputa });
    expect(email.texto).toContain("Para o próximo repasse (reserva em conferência: disputa do pagamento)");
    expect(email.texto).not.toContain("dinheiro ainda não recebido pela empresa");
  });
});

describe("linhas da disputa no livro (teste 10)", () => {
  it("chave da disputa, previsto, competência no mês corrente em São Paulo (virada do mês e do ano); repetir = a mesma linha; nunca um mês passado", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const c = await disputa(r);
    const chaves = chavesDaContestacao(c.pagamentoId, c.id);
    // 31/12 às 23:30 em São Paulo (já 1º/1 em UTC): ainda dezembro.
    const virada = new Date("2026-12-31T23:30:00-03:00");
    expect(mesDoDesconto(virada)).toBe("2026-12-01");
    const d = { chave: chaves.proprietario(1), proprietarioId: dono, imovelId: a, reservaId: r.id, valor: -85000, competencia: "2026-12-01", descricao: descricaoSeguradoDoProprietario(r.codigo, 85000) };
    const l = await lancarAcertoDoProprietario(db, org, ORIGEM_LANCAMENTO_CONTESTACAO, d, null, virada);
    expect(l).toMatchObject({ tipo: "direito_proprietario", origem: ORIGEM_LANCAMENTO_CONTESTACAO, estado: "previsto", valor: -85000, efeitoSaldo: -85000, competencia: "2026-12-01", proprietarioId: dono });
    expect(l.chaveOrigem.startsWith(`mercadopago:${c.pagamentoId}:contestacao:${c.id}:`)).toBe(true);
    expect(l.chaveOrigem).not.toContain("recebimento");
    // Repetir não duplica.
    expect((await lancarAcertoDoProprietario(db, org, ORIGEM_LANCAMENTO_CONTESTACAO, d, null, virada)).id).toBe(l.id);
    expect(await db.select().from(lancamentos).where(eq(lancamentos.origem, ORIGEM_LANCAMENTO_CONTESTACAO))).toHaveLength(1);
    // Meia hora depois já é janeiro: dezembro (que pode estar fechado) é recusado; janeiro, aceito.
    const janeiro = new Date("2027-01-01T00:30:00-03:00");
    await expect(lancarAcertoDoProprietario(db, org, ORIGEM_LANCAMENTO_CONTESTACAO, { ...d, chave: chaves.proprietario(2) }, null, janeiro)).rejects.toThrow("mês corrente (01/01/2027)");
    expect((await lancarAcertoDoProprietario(db, org, ORIGEM_LANCAMENTO_CONTESTACAO, { ...d, chave: chaves.proprietarioReverte(), valor: 85000, competencia: "2027-01-01" }, null, janeiro)).competencia).toBe("2027-01-01");
    // Sem a chave da disputa, com valor 0 ou outra origem: recusado.
    await expect(lancarAcertoDoProprietario(db, org, ORIGEM_LANCAMENTO_CONTESTACAO, { ...d, chave: "outra:chave", competencia: "2027-01-01" }, null, janeiro)).rejects.toBeInstanceOf(LancamentoInvalido);
    await expect(lancarAcertoDoProprietario(db, org, ORIGEM_LANCAMENTO_CONTESTACAO, { ...d, chave: chaves.proprietario(3), valor: 0, competencia: "2027-01-01" }, null, janeiro)).rejects.toBeInstanceOf(LancamentoInvalido);
    await expect(lancarAcertoDoProprietario(db, org, "manual" as never, { ...d, chave: chaves.proprietario(3), competencia: "2027-01-01" }, null, janeiro)).rejects.toBeInstanceOf(LancamentoInvalido);
    // O desconto do cancelamento (M8.2c) continua igual: origem "cancelamento", valor positivo recebido e negativo lançado.
    const desc = await lancarDescontoDoProprietario(db, org, { ...d, chave: "cancelamento:x:espelho:y", valor: 1000, competencia: "2027-01-01" }, null, janeiro);
    expect(desc).toMatchObject({ origem: "cancelamento", valor: -1000, efeitoSaldo: -1000 });
    await expect(lancarDescontoDoProprietario(db, org, { ...d, chave: "cancelamento:x:espelho:z", valor: -1000, competencia: "2027-01-01" }, null, janeiro)).rejects.toThrow("O desconto precisa ser um valor positivo em centavos.");
  });
});

describe("o valor segurado no repasse (teste 11)", () => {
  it("com a parte a liberar, a linha espera junto; liberadas juntas, saem no próximo repasse; o e-mail e os itens mostram a disputa só com o código da reserva", async () => {
    const r = await criar(reserva("2026-11-10", "2026-11-13"), "2026-10-20");
    const c = await disputa(r, { abertaEm: sp("2026-10-22") });
    await decidir(c, r, sp("2026-10-25"));
    const antes = await partes("2026-10-25");
    // A linha (competência de outubro, o mês da decisão) vem antes da parte (novembro, o mês da estadia).
    expect(antes.map((x) => [x.competencia, x.valor, x.situacao])).toEqual([
      ["2026-10-01", -85000, "a_liberar"],
      ["2026-11-01", 72250, "a_liberar"],
    ]);
    expect(antes[0].motivo).toContain("Segurado junto com a sua parte desta reserva, até o resultado.");
    expect(antes[0].hospede).toBe("");
    expect(await gerarAntecipado(db, org, dono, "2026-10-26", null)).toEqual({ ok: false, erro: "Nada disponível para repassar agora." });
    // Depois do check-in, as duas ficam disponíveis juntas; com outra reserva disponível, o antecipado leva tudo.
    const outra = await criar(reserva("2026-11-01", "2026-11-04", { valorBruto: 200000, taxaCanal: 30000 }), "2026-11-01");
    const rep = id(await gerarAntecipado(db, org, dono, "2026-11-14", null));
    expect(await obterRepasse(db, org, rep)).toMatchObject({ valor: 72250 + 144500 - 85000 });
    const itens = await itensDoRepasse(db, org, rep);
    const daDisputa = itens.find((i) => i.valor < 0)!;
    expect(daDisputa).toMatchObject({ reservaId: r.id, parcial: false, hospede: "", disputa: { variante: "segurado", situacao: "aberta" } });
    expect(descricaoDoItem(daDisputa)).toBe("valor segurado pela disputa do pagamento (até o resultado)");
    // A parte verdadeira da reserva não vira "parcial" por causa da linha da disputa.
    expect(itens.find((i) => i.reservaId === r.id && i.valor > 0)).toMatchObject({ parcial: false });
    expect(itens.find((i) => i.reservaId === outra.id)).toMatchObject({ parcial: false });
    // E-mail do antecipado: a linha da disputa com o código da reserva, nunca o nome do hóspede.
    id(await marcarRepassePago(db, org, rep, "2026-11-14", "2026-11-14", null, { texto: "E2E-2" }));
    const email = textoDoEmailDoRepasse((await obterRepasse(db, org, rep))!, itens, "Sua Casa");
    const linha = email.texto.split("\n").find((x) => x.includes("valor segurado pela disputa"))!;
    expect(linha).toContain(r.codigo);
    expect(linha).not.toContain("Hóspede");
  });

  it("parte repassada antes da decisão: a linha sai do próximo repasse de qualquer tipo; partes que não cobrem: o antecipado espera e o fechamento mostra a dívida que não se transfere; o aviso de 7 dias; estornos", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const rep1 = id(await gerarAntecipado(db, org, dono, "2026-10-14", null));
    id(await marcarRepassePago(db, org, rep1, "2026-10-14", "2026-10-14", null));
    await db.update(repasses).set({ criadoEm: sp("2026-10-14") }).where(eq(repasses.id, rep1));
    const c = await disputa(r);
    await decidir(c, r, sp("2026-10-20"), { explicacao: "O ar-condicionado parou na estadia" });
    const linha = (await partes("2026-10-20")).find((x) => x.valor < 0)!;
    expect(linha).toMatchObject({ situacao: "disponivel", codigoReserva: r.codigo, hospede: "" });
    expect(linha.motivo).toBe(
      `Disputa do pagamento da reserva ${r.codigo}: R$ 850,00 segurados dos seus próximos repasses até o resultado — 85% do valor em disputa (R$ 1.000,00), a proporção da sua parte. Se a SCL ganhar a disputa, o valor volta no repasse seguinte. Causa registrada: Problema do imóvel (estrutura, equipamento ou obra do proprietário). O ar-condicionado parou na estadia. Sai do próximo repasse.`,
    );
    // Nunca a nota interna nem o número do caso.
    expect(linha.motivo).not.toContain("Nota interna");
    expect(linha.motivo).not.toContain("7000000001");
    expect(await gerarAntecipado(db, org, dono, "2026-10-21", null)).toMatchObject({ ok: false, erro: expect.stringContaining("não cobrem o desconto de R$ 850,00 (disputa do pagamento da reserva") });
    // Aviso do Início: disponível e não descontado há mais de 7 dias (a que espera junto com a parte nunca é aviso).
    expect(await avisosDeContestacaoNosRepasses(db, org, sp("2026-10-26"))).toEqual([]);
    expect(await avisosDeContestacaoNosRepasses(db, org, sp("2026-10-28"))).toEqual([
      { nivel: "atencao", texto: "Proprietário Dona Exemplo tem R$ 850,00 de valor segurado pela disputa do pagamento a descontar desde 20/10/2026 (as partes disponíveis não cobriram).", link: "/painel/financeiro/repasses" },
    ]);
    // Fechamento de outubro: nada a repassar; o proprietário fica devendo, e o valor segurado não se transfere.
    const [p] = await preverRepasses(db, org, "2026-10", "2026-11-02", [dono]);
    expect(p).toMatchObject({ valor: 0, deve: 85000 });
    expect(p.avisos).toContain(`As partes disponíveis não cobrem o valor segurado de R$ 850,00 pela disputa do pagamento (reservas ${r.codigo}): nada a repassar; o proprietário fica devendo e o valor passa para o próximo repasse.`);
    const [rod] = await rodapeDoPortal(db, org, { proprietarios: [{ id: dono, nome: "Dona Exemplo" }], mes: "2026-10", hoje: "2026-11-02", pixEmpresa: "scl@example.com" });
    expect(rod).toMatchObject({ situacao: "proprietario_deve", valor: 85000, descontoDisputa: 85000 });
    expect(divisaoDoDeve(rod)).toEqual({ proximoRepasse: 85000, transferir: 0 });
    expect(nomeDoDescontoQueNaoSeTransfere(rod)).toBe("o desconto da disputa do pagamento (valor segurado)");
    // O repasse que levou a parte não se estorna (o desconto ficaria sem o pagamento).
    expect(await estornarRepasse(db, org, rep1, "refazer", "2026-11-03", null)).toEqual({
      ok: false,
      erro: `A parte da reserva ${r.codigo} deste repasse já tem desconto pela disputa do pagamento: estornar o repasse deixaria o desconto sem o pagamento. Corrija com um ajuste.`,
    });
    // Outra reserva cobre: o próximo antecipado leva a linha; esse repasse (só a linha desta reserva) pode ser estornado.
    await criar(reserva("2026-11-01", "2026-11-04", { valorBruto: 200000, taxaCanal: 30000 }), "2026-11-01");
    const rep2 = id(await gerarAntecipado(db, org, dono, "2026-11-05", null));
    expect(await obterRepasse(db, org, rep2)).toMatchObject({ valor: 144500 - 85000 });
    expect((await partes("2026-11-05")).find((x) => x.valor < 0)).toMatchObject({ situacao: "repassado" });
    expect((await partes("2026-11-05")).find((x) => x.valor < 0)!.motivo).toContain("Descontado no repasse de 05/11/2026 (a pagar).");
    id(await estornarRepasse(db, org, rep2, "lançado por engano", "2026-11-05", null));
    expect((await partes("2026-11-05")).find((x) => x.valor < 0)?.situacao).toBe("disponivel");
  });

  it("ganha: a reversão no mês corrente volta no próximo repasse; débito nunca descontado + reversão somam zero; o mês da decisão não muda", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    id(await marcarRepassePago(db, org, id(await gerarAntecipado(db, org, dono, "2026-10-14", null)), "2026-10-14", "2026-10-14", null));
    const c = await disputa(r);
    await decidir(c, r, sp("2026-10-20"));
    const outubro = await saldoAcerto(db, org, { proprietarioId: dono, fim: "2026-11-01" });
    // Ganha em dezembro: a reversão +Σx no mês corrente (o débito nunca foi descontado: as partes não cobriam).
    await db.update(contestacoesPagamento).set({ situacao: "ganha", resultadoEm: "2026-12-10" }).where(eq(contestacoesPagamento.id, c.id));
    const dezembro = sp("2026-12-10");
    await lancarAcertoDoProprietario(db, org, ORIGEM_LANCAMENTO_CONTESTACAO, { chave: chavesDaContestacao(c.pagamentoId, c.id).proprietarioReverte(), proprietarioId: dono, imovelId: a, reservaId: r.id, valor: 85000, competencia: mesDoDesconto(dezembro), descricao: `Disputa do pagamento da reserva ${r.codigo}: valor segurado devolvido` }, null, dezembro);
    expect(await saldoAcerto(db, org, { proprietarioId: dono, fim: "2026-11-01" })).toBe(outubro);
    const linhas = (await partes("2026-12-10")).filter((x) => x.origemLancamento === ORIGEM_LANCAMENTO_CONTESTACAO);
    expect(linhas.map((x) => [x.competencia, x.valor, x.situacao])).toEqual([
      ["2026-10-01", -85000, "disponivel"],
      ["2026-12-01", 85000, "disponivel"],
    ]);
    expect(linhas[1].motivo).toBe(`Disputa do pagamento da reserva ${r.codigo}: valor segurado devolvido (a SCL ganhou a disputa em 10/12). Volta no próximo repasse.`);
    expect(linhas[0].motivo).toContain("R$ 850,00 segurados, devolvidos depois (a SCL ganhou a disputa em 10/12).");
    // As duas somam zero: nada a repassar (e nenhum "desconto não coberto").
    expect(await gerarAntecipado(db, org, dono, "2026-12-11", null)).toEqual({ ok: false, erro: "Nada disponível para repassar agora." });
    // Com outra parte, as duas entram juntas e somam zero no valor.
    await criar(reserva("2026-12-01", "2026-12-04", { valorBruto: 200000, taxaCanal: 30000 }), "2026-12-01");
    const rep = id(await gerarAntecipado(db, org, dono, "2026-12-11", null));
    expect(await obterRepasse(db, org, rep)).toMatchObject({ valor: 144500 });
    const itens = await itensDoRepasse(db, org, rep);
    expect(itens.filter((i) => i.disputa).map((i) => [i.valor, descricaoDoItem(i)]).sort()).toEqual(
      [
        [-85000, "valor segurado pela disputa do pagamento (devolvido depois: a SCL ganhou a disputa)"],
        [85000, "valor segurado devolvido (a SCL ganhou a disputa)"],
      ].sort(),
    );
  });
});

describe("perdida: o dinheiro com a empresa e o rótulo definitivo (teste 15, no repasse)", () => {
  const definitiva = (c: Disputa, valorPerdido: number) =>
    db.update(contestacoesPagamento).set({ situacao: "perdida", valorPerdido, resultadoEm: "2027-03-10", definitivoEm: sp("2027-03-10"), decisaoVersao: 1, quemArca: "proporcional" }).where(eq(contestacoesPagamento.id, c.id));
  const recebido = async (r: Reserva) => (await recebidoPorReserva(db, org, [r.id])).get(r.id)!;

  it("liberado: enquanto não é perdida com os definitivos, o caixa da disputa não conta; depois, recebido + perda coberta = devido", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const c = await disputa(r);
    await caixa(c, r, "devolucao", chavesDaContestacao(c.pagamentoId, c.id).retido(), 100000, "2026-10-16");
    expect(await recebido(r)).toMatchObject({ recebido: 85000, devido: 85000 });
    // Perdida, mas os lançamentos definitivos ainda não feitos: continua sem contar.
    await db.update(contestacoesPagamento).set({ situacao: "perdida", valorPerdido: 100000 }).where(eq(contestacoesPagamento.id, c.id));
    expect(await recebido(r)).toMatchObject({ recebido: 85000 });
    await definitiva(c, 100000);
    const x = await recebido(r);
    expect(x).toMatchObject({ recebido: 85000 - 100000, devido: 85000, perdaCoberta: 100000, dataCompleto: "2026-10-10" });
    expect(dinheiroComAEmpresa(x)).toBe(true);
  });

  it("não liberado: o caixa final é a taxa que saiu (0 − 15.000 + 100.000 = 85.000); disputa de parte do valor (85.000 − 30.000 + 30.000)", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"));
    const c = await disputa(r);
    await caixa(c, r, "devolucao", chavesDaContestacao(c.pagamentoId, c.id).caixaFinal(), 15000, "2027-03-10");
    expect(dinheiroComAEmpresa(await recebido(r))).toBe(false);
    await definitiva(c, 100000);
    expect(await recebido(r)).toMatchObject({ recebido: -15000, perdaCoberta: 100000 });
    expect(dinheiroComAEmpresa(await recebido(r))).toBe(true);

    const p = await criar(reserva("2026-10-20", "2026-10-23"), "2026-10-20");
    const cp = await disputa(p, { valor: 30000, valorEmRisco: 30000, idCaso: "7000000002" });
    await caixa(cp, p, "devolucao", chavesDaContestacao(cp.pagamentoId, cp.id).retido(), 30000, "2026-10-25");
    await definitiva(cp, 30000);
    const y = await recebido(p);
    expect(y).toMatchObject({ recebido: 55000, perdaCoberta: 30000 });
    expect(dinheiroComAEmpresa(y)).toBe(true);
  });

  it("ganha: o retido realizado e a volta nunca contam; o rótulo da linha passa a definitivo na perdida, e o ajuste entra no mês corrente", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const c = await disputa(r);
    const k = chavesDaContestacao(c.pagamentoId, c.id);
    await caixa(c, r, "devolucao", k.retido(), 100000, "2026-10-16");
    await caixa(c, r, "recebimento", k.volta(), 100000, "2026-12-10");
    await db.update(contestacoesPagamento).set({ situacao: "ganha", resultadoEm: "2026-12-10" }).where(eq(contestacoesPagamento.id, c.id));
    expect(await recebido(r)).toMatchObject({ recebido: 85000, dataCompleto: "2026-10-10" });

    // Outra reserva, perdida: as linhas do proprietário ficam definitivas; o ajuste (Σx − xF) volta a ele no mês corrente.
    const p = await criar(reserva("2026-10-20", "2026-10-23"), "2026-10-20");
    id(await marcarRepassePago(db, org, id(await gerarAntecipado(db, org, dono, "2026-10-24", null)), "2026-10-24", "2026-10-24", null));
    const cp = await disputa(p, { idCaso: "7000000002" });
    await decidir(cp, p, sp("2026-10-26"));
    await definitiva(cp, 80000);
    const marco = sp("2027-03-10");
    await lancarAcertoDoProprietario(db, org, ORIGEM_LANCAMENTO_CONTESTACAO, { chave: chavesDaContestacao(cp.pagamentoId, cp.id).proprietarioFinal(), proprietarioId: dono, imovelId: a, reservaId: p.id, valor: 17000, competencia: mesDoDesconto(marco), descricao: `Disputa do pagamento da reserva ${p.codigo}: ajuste` }, null, marco);
    const linhas = (await partes("2027-03-10")).filter((x) => x.reservaId === p.id && x.origemLancamento === ORIGEM_LANCAMENTO_CONTESTACAO);
    expect(linhas.map((x) => [x.competencia, x.valor])).toEqual([
      ["2026-10-01", -85000],
      ["2027-03-01", 17000],
    ]);
    expect(linhas[0].motivo).toContain(`Disputa do pagamento da reserva ${p.codigo}: desconto definitivo (a SCL perdeu a disputa em 10/03).`);
    expect(linhas[1].motivo).toContain("ajuste do desconto definitivo (a SCL perdeu a disputa em 10/03; o valor perdido ficou menor que o segurado)");
    // Nenhuma linha de resultado antes do mês da decisão.
    const todas = await db.select().from(lancamentos).where(eq(lancamentos.origem, ORIGEM_LANCAMENTO_CONTESTACAO));
    expect(todas.filter((l) => l.tipo === "direito_proprietario").every((l) => l.competencia >= "2026-10-01")).toBe(true);
  });
});

describe("despesas e recebimentos da disputa (teste 17)", () => {
  it("a perda prevista da SCL fica fora do 'a pagar' e não se marca como paga nem se estorna; a lista diz em que pé a disputa está; a volta não se estorna pela reserva", async () => {
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    const c = await disputa(r);
    const k = chavesDaContestacao(c.pagamentoId, c.id);
    const [perda] = await lancar(db, org, [{ tipo: "despesa_empresa", descricao: `Disputa do pagamento da reserva ${r.codigo}: perda prevista da SCL`, valor: -15000, montante: 15000, competencia: "2026-10-01", estado: "previsto", imovelId: a, reservaId: r.id, origem: ORIGEM_LANCAMENTO_CONTESTACAO, chaveOrigem: k.scl(1) }], null);
    const [comum] = await lancar(db, org, [{ tipo: "despesa_empresa", descricao: "Mercado", valor: -2000, montante: 2000, competencia: "2026-10-05", estado: "previsto", imovelId: a }], null);
    const lista = await listarDespesas(db, org);
    expect(totaisDespesas(lista)).toMatchObject({ aPagar: 2000, empresa: 17000 });
    const d = lista.find((x) => x.id === perda.id)!;
    expect(d.disputa).toMatchObject({ situacao: "aberta", codigoReserva: r.codigo });
    expect(textoDaDespesaDaDisputa(d.disputa!)).toBe("Perda por disputa do pagamento (prevista até o resultado): acompanhe no quadro da disputa");
    expect(await marcarDespesaPaga(db, org, perda.id, "2026-10-20", null)).toBe("da_contestacao");
    expect(await estornarDespesa(db, org, perda.id, "engano", null)).toBe("da_contestacao");
    expect(ERRO_DESPESA_DA_CONTESTACAO(d)).toBe(`Esta despesa é da disputa do pagamento da reserva ${r.codigo}: corrija pelo quadro da disputa.`);
    expect((await obterDespesa(db, org, perda.id))!.estado).toBe("previsto");
    // A despesa comum continua normal.
    expect(await marcarDespesaPaga(db, org, comum.id, "2026-10-20", null)).toBe(true);
    // Depois do resultado: definitiva ou revertida, com a data.
    await db.update(contestacoesPagamento).set({ situacao: "perdida", resultadoEm: "2027-03-10" }).where(eq(contestacoesPagamento.id, c.id));
    expect(textoDaDespesaDaDisputa((await obterDespesa(db, org, perda.id))!.disputa!)).toBe("Perda por disputa do pagamento definitiva (disputa perdida em 10/03)");
    await db.update(contestacoesPagamento).set({ situacao: "ganha" }).where(eq(contestacoesPagamento.id, c.id));
    expect(textoDaDespesaDaDisputa((await obterDespesa(db, org, perda.id))!.disputa!)).toBe("Perda por disputa do pagamento revertida (disputa ganha em 10/03)");
    // A volta (recebimento da disputa) não se estorna pela reserva.
    const [volta] = await caixa(c, r, "recebimento", k.volta(), 100000, "2027-03-10");
    expect(await estornarRecebimento(db, org, volta.id, "engano", null)).toEqual({ ok: false, erro: ERRO_RECEBIMENTO_DA_CONTESTACAO });
  });
});

describe("o que o proprietário vê (teste 27) e os meses fechados (teste 28)", () => {
  it("textos das linhas da disputa: segurado (proporcional e o valor inteiro), definitivo, devolvido e junto com a parte; só o código da reserva", () => {
    const base: ParteBruta = {
      lancamentoId: "l", proprietarioId: dono, reservaId: "r", codigoReserva: "SCL-0001", imovelId: "i", codigoImovel: "403", competencia: "2026-10-01", valor: -100000, efeitoSaldo: -100000, estado: "previsto",
      checkin: "2026-10-10", checkout: "2026-10-13", hospede: "", origem: "site", hoje: "2026-10-20", recebido: { recebido: 0, devido: 0 }, pagamento: null, emConferencia: false, repasse: null, origemLancamento: ORIGEM_LANCAMENTO_CONTESTACAO,
      disputa: { contestacaoId: "c", situacao: "aberta", resultadoEm: null, quemArca: "proprietario", causa: "Problema do imóvel", exposicao: 100000, parteProprietario: 100000, explicacao: "" },
    };
    expect(textoDaLinhaDaDisputa(base)).toBe(
      "Disputa do pagamento da reserva SCL-0001: R$ 1.000,00 segurados dos seus próximos repasses até o resultado — o valor em disputa inteiro, que inclui a comissão e a taxa do pagamento. Se a SCL ganhar a disputa, o valor volta no repasse seguinte. Causa registrada: Problema do imóvel.",
    );
    const perdida = { ...base, disputa: { ...base.disputa!, situacao: "perdida" as const, resultadoEm: "2027-03-10" } };
    expect(textoDaLinhaDaDisputa(perdida)).toBe("Disputa do pagamento da reserva SCL-0001: desconto definitivo (a SCL perdeu a disputa em 10/03). Causa registrada: Problema do imóvel.");
    const semEfeito = { ...base, valor: 100000, disputa: { ...base.disputa!, situacao: "sem_efeito" as const } };
    expect(textoDaLinhaDaDisputa(semEfeito)).toBe("Disputa do pagamento da reserva SCL-0001: valor segurado devolvido (a disputa foi encerrada sem efeito).");
    expect(classificarParte({ ...base, seguradoJunto: true })).toMatchObject({ situacao: "a_liberar", motivo: expect.stringContaining("Segurado junto com a sua parte desta reserva, até o resultado.") });
    expect(classificarParte(base)).toMatchObject({ situacao: "disponivel", motivo: expect.stringMatching(/Sai do próximo repasse\.$/) });
    // Repasse: a linha própria "Disputa do pagamento" no antecipado de um fechamento (o débito e a reversão).
    const itens = [
      { competencia: "2026-11-01", valor: 50000 },
      { competencia: "2026-11-01", valor: -85000, disputa: { variante: "segurado" as const, situacao: "aberta" as const } },
      { competencia: "2026-11-01", valor: -10000 },
    ];
    expect(separarAntecipado(-45000, itens, "2026-10-01")).toEqual({ noites: 50000, desconto: -10000, estorno: 0, disputa: -85000 });
    expect(descricaoDoItem({ parcial: true, diferenca: 0, competencia: "2026-11-01", valor: -85000, disputa: { variante: "definitivo", situacao: "perdida" } })).toBe("desconto definitivo da disputa do pagamento");
    expect(nomeDoDescontoQueNaoSeTransfere({ descontoCancelamento: 1, descontoDisputa: 1 }, true)).toBe("Desconto de reserva cancelada com devolução ao hóspede e da disputa do pagamento");
    // E-mail do fechamento: a linha própria "Disputa do pagamento" e a parte presa com o motivo próprio.
    const fechamento = {
      id: "rep", organizacaoId: "org", proprietarioId: dono, tipo: "fechamento" as const, mes: "2026-10-01", data: "2026-11-02", saldo: 50000, descontado: 0, contestado: 0, valor: 15000, foraDoFechamento: 72250, antecipado: -35000, situacao: "pago" as const,
      dataPagamento: "2026-11-02", comprovante: "E2E-9", comprovanteArquivoId: null, emailSituacao: "pendente" as const, emailEm: null, emailPara: "", emailChave: "", emailTentativaEm: null, emailPedido: null, chavePixPaga: "", pedidoEm: null, motivoEstorno: "",
      criadoPor: null, criadoEm: sp("2026-11-02"), estornadoEm: null, nome: "Dona Exemplo", email: "dona@example.com", chavePix: "dona@example.com",
    };
    const doItem = { organizacaoId: "org", repasseId: "rep", imovelId: "i", criadoEm: sp("2026-11-02"), liberadoEm: null, codigoImovel: "403", checkin: "2026-11-10", checkout: "2026-11-13", parcial: false, diferenca: 0 };
    const email = textoDoEmailDoRepasse(
      fechamento,
      [
        { ...doItem, id: "i1", lancamentoId: "l1", reservaId: "r1", competencia: "2026-11-01", valor: 50000, codigoReserva: "SCL-0001", hospede: "Hóspede Fictício" },
        { ...doItem, id: "i2", lancamentoId: "l2", reservaId: "r2", competencia: "2026-11-01", valor: -85000, codigoReserva: "SCL-0002", hospede: "", disputa: { variante: "segurado", situacao: "aberta" } },
      ],
      "Sua Casa",
      { foraPorDisputa: 72250 },
    );
    expect(email.texto).toContain("Disputa do pagamento: − R$ 850,00");
    expect(email.texto).toContain("Para o próximo repasse (reserva em conferência: disputa do pagamento): R$ 722,50");
    expect(email.texto).not.toContain("dinheiro ainda não recebido");
    expect(email.texto).toContain("403 · SCL-0002 · 10/11/2026 a 13/11/2026 · -R$ 850,00 (valor segurado pela disputa do pagamento (até o resultado))");
    expect(divisaoDoDeve({ valor: 50000, descontoCancelamento: 20000, descontoDisputa: 10000 })).toEqual({ proximoRepasse: 30000, transferir: 20000 });
  });

  it("o dono de outro imóvel não vê; o portal e o relatório: linha própria sem noites nem bruto em dobro, a conciliação fecha, o mês já enviado não muda", async () => {
    // Outubro fechado e pago (o relatório de outubro foi enviado com o fechamento).
    const r = await criar(reserva("2026-10-10", "2026-10-13"), "2026-10-10");
    id(await marcarRepassePago(db, org, id(await fecharMes(db, org, dono, "2026-10", "2026-11-02", null)), "2026-11-02", "2026-11-02", null));
    const [{ id: outroDono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Outro Fictício" }).returning();
    const [{ id: b }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "501", nome: "Cinco" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: outroDono, imovelId: b, criadoEm: new Date("2025-01-01T12:00:00Z") });
    const pedir = (mes: number) =>
      dadosDoRelatorio(db, org, { donos: [{ id: dono, nome: "Dona Exemplo" }], imoveis: [{ id: a, codigo: "403", nome: "Quatro" }], todosOsImoveis: true, ano: 2026, mes, hoje: "2026-12-02", agora: sp("2026-12-02") });
    const outubroAntes = textosDoRelatorio(await pedir(10));
    const c = await disputa(r);
    await decidir(c, r, sp("2026-11-05"));
    // Outro dono, de outro imóvel: nada da disputa.
    expect(await partesDoProprietario(db, org, outroDono, sp("2026-11-06"))).toEqual([]);
    expect(await reservasDoPortal(db, org, { proprietarioIds: [outroDono], imovelIds: [b], periodo: { inicio: "2026-10-01", fim: "2026-12-01" } })).toEqual([]);
    // Portal de novembro: a linha da disputa não traz a reserva para o mês nem muda a parte dela.
    expect(await reservasDoPortal(db, org, { proprietarioIds: [dono], imovelIds: [a], periodo: { inicio: "2026-11-01", fim: "2026-12-01" } })).toEqual([]);
    const outubroPortal = await reservasDoPortal(db, org, { proprietarioIds: [dono], imovelIds: [a], periodo: { inicio: "2026-10-01", fim: "2026-11-01" } });
    expect(outubroPortal.map((x) => [x.situacao, x.suaParte])).toEqual([["definido", 72250]]);
    const resumo = await resumoDoProprietario(db, org, { proprietarioIds: [dono], imovelIds: [a], periodo: { inicio: "2026-11-01", fim: "2026-12-01" } });
    expect(resumo).toMatchObject({ reservas: 0, receitaBruta: 0, suaParte: -85000, disputa: { n: 1, valor: -85000 } });
    // Relatório de novembro: a variante "segurado", sem componentes, sem noites, sem data de pagamento, só o código.
    const partesNov = await partesDoRelatorio(db, org, { donos: [{ id: dono, nome: "Dona Exemplo" }], imovelIds: [a], mes: "2026-11", agora: sp("2026-12-02") });
    const linha = partesNov.find((p) => p.mes === "2026-11")!;
    expect(linha).toMatchObject({ contestacao: "segurado", bruto: 0, taxa: 0, comissao: 0, noitesNoMes: 0, pagamento: null, hospede: "", suaParte: -85000, codigo: r.codigo });
    const conc = conciliacao(partesNov, "2026-11", "2026-12-02", "Sua Casa");
    expect(conc.find((l) => l.rotulo.includes("Disputa do pagamento"))).toMatchObject({ rotulo: `− Disputa do pagamento da reserva ${r.codigo} (segurado)`, suaParte: -85000, bruto: 0, tipo: "ponte" });
    expect(conciliacaoFecha(conc)).toBe(true);
    const nov = textosDoRelatorio(await pedir(11));
    expect(nov.reservas.find((x) => x.codigo === r.codigo)).toMatchObject({ hospede: "Disputa do pagamento", canal: "—", noites: "—", bruto: "—" });
    expect(nov.brutoAoResultado.map((l) => l.texto)).toContain("− Disputa do pagamento (1 reserva: valor segurado, definitivo ou devolvido; veja as reservas do mês)");
    expect(nov.conciliacaoFecha).toBe(true);
    expect(JSON.stringify(nov)).not.toContain("Nota interna");
    expect(JSON.stringify(nov)).not.toContain("7000000001");
    // O mês já enviado (outubro) não muda.
    expect(textosDoRelatorio(await pedir(10))).toEqual(outubroAntes);
    // A soma do livro do proprietário em outubro também não.
    const [{ total }] = await db
      .select({ total: sql<string>`coalesce(sum(${lancamentos.efeitoSaldo}), 0)` })
      .from(lancamentos)
      .where(and(eq(lancamentos.proprietarioId, dono), sql`${lancamentos.competencia} < '2026-11-01'`));
    expect(Number(total)).toBe(0);
  });
});
