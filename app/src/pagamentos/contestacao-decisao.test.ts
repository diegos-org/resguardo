/**
 * Contestação do pagamento no site (M8.2e) — a decisão de quem arca, as linhas pendentes, mudar e atualizar a decisão e o
 * débito do Mercado Pago, em PGlite com o Mercado Pago falso (sem rede): a disputa nasce pela leitura da order e a equipe
 * decide pelo domínio (`previaDaDecisao` → `registrarDecisao`), como o quadro faria.
 * Itens 9 (menos as permissões de tela), 10, 12 e 13 (o débito confirmado) de "Testes a escrever" (PAGAMENTO-SITE.md,
 * "Contestação (M8.2e)").
 */
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditoria, categoriasDespesa, contestacoesPagamento, contratos, cotacoes, eventosContestacao, lancamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { aplicarMotor, recalcularReservas } from "@/financeiro/aplicar";
import { ERRO_DADOS_PESSOAIS } from "@/lib/dados-pessoais";
import { partesDoProprietario } from "@/repasses/extrato";
import { dinheiroComAEmpresa, recebidoPorReserva } from "@/repasses/recebimentos";
import { conferirTentativa } from "./conferencia";
import {
  aplicarLeiturasDaDisputa,
  atualizarValorSegurado,
  confirmarDebito,
  confirmarOutraDisputa,
  confirmarResultado,
  informarPrazoDocumentos,
  marcarDocumentosEnviados,
  mudarDecisao,
  previaDaDecisao,
  previaDoResultado,
  registrarContestacaoDaEquipe,
  registrarDecisao,
  TEXTO_DISPUTA_NAO_ENCONTRADA,
  TEXTO_DUPLICATA_SEM_DECIDIR,
  TEXTO_NOTA_DO_DEBITO,
  TEXTO_VALOR_SEGURADO_EM_DIA,
} from "./contestacao";
import { lancarContestacao, partesEfetivasDaReserva, TEXTO_DEBITO_JA_CONFIRMADO } from "./contestacao-acerto";
import {
  chavesDaContestacao,
  dividirPerda,
  type LeituraDeContestacao,
  ORIGEM_LANCAMENTO_CONTESTACAO,
  prefixoDaContestacao,
  type QuemArcaContestacao,
  TEXTO_CONTESTACAO_PREVIA_MUDOU,
  TEXTO_DECISAO_MUDOU,
  TEXTO_DISPUTA_JA_TERMINOU,
  TEXTO_PAGAMENTO_SEM_RESERVA,
  TEXTO_SEM_PARTES_PARA_DIVIDIR,
  TEXTO_SEM_PROPRIETARIO_NA_RESERVA,
} from "./contestacao-regras";
import { type Contestacao, travarCotacao } from "./travas";
import { AGORA, type Cenario, cancelar, entradaPadrao, minutos, montarCenario, pagarEConfirmar, semDadosDoHospede, TOTAL, usuarioDeTeste } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});
// Dados pessoais: nada do hóspede nas tabelas do pagamento, no livro e na auditoria.
afterEach(async () => {
  expect(await semDadosDoHospede(db)).toEqual([]);
});

const TAXA = 1824;
const LIQUIDO = TOTAL - TAXA;
const sp = (dataHora: string) => new Date(`${dataHora.replace(" ", "T")}:00-03:00`);
const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const linhas = (pagamentoId: string) => db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.pagamentoId, pagamentoId)).orderBy(asc(contestacoesPagamento.abertaEm), asc(contestacoesPagamento.id));
const linha = async (id: string) => (await db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.id, id)))[0];
const daDisputa = (l: Pick<Contestacao, "pagamentoId" | "id">) =>
  db.select().from(lancamentos).where(like(lancamentos.chaveOrigem, `${prefixoDaContestacao(l.pagamentoId, l.id)}%`)).orderBy(asc(lancamentos.criadoEm), asc(lancamentos.chaveOrigem));
const naChave = async (l: Pick<Contestacao, "pagamentoId" | "id">, chave: string) => (await daDisputa(l)).filter((x) => x.chaveOrigem === chave);
const eventos = (id: string) => db.select().from(eventosContestacao).where(eq(eventosContestacao.contestacaoId, id)).orderBy(asc(eventosContestacao.em), asc(eventosContestacao.id));
const auditoriaDe = (acao: string) => db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, acao))).orderBy(asc(auditoria.criadoEm), asc(auditoria.id));

/** Reserva paga por Pix (taxa de R$ 18,24), liberada salvo `liberar: false`; a disputa do valor (padrão: o pago) aberta pela leitura em 20/10. */
async function disputada(o: { liberar?: boolean; valor?: number; quando?: Date } = {}) {
  const x = await pagarEConfirmar(c, { liberar: o.liberar ?? true });
  const ids = c.provedor.contestar(x.idProvedor, "order", o.valor ? { valor: o.valor } : {});
  await conferir(x.pagamentoId, o.quando ?? sp("2026-10-20 10:00"));
  const [l] = await linhas(x.pagamentoId);
  expect(l).toMatchObject({ situacao: "aberta", origem: "leitura" });
  return { ...x, ...ids, l };
}

/** A decisão pelo domínio, como o quadro: a prévia dá a versão e a assinatura da opção escolhida. */
async function decidir(l: Pick<Contestacao, "id">, quemArca: QuemArcaContestacao, quando: Date, o: { causa?: string; nota?: string; explicacao?: string; mudar?: boolean } = {}) {
  const pv = await previaDaDecisao(db, c.org, l.id);
  if (!pv.ok) throw new Error(pv.erro);
  const opcao = pv.fatos.opcoes[quemArca];
  const e = { causa: o.causa ?? "imovel", quemArca, nota: o.nota ?? "Hóspede relatou problema no ar-condicionado.", explicacao: o.explicacao ?? "", versao: pv.fatos.versao, assinatura: opcao?.assinatura ?? "" };
  return (o.mudar ? mudarDecisao : registrarDecisao)(db, c.org, l.id, e, equipe, quando);
}

/** A divisão da reserva (D e C) pelas linhas do motor. */
const partes = async (reservaId: string) => partesEfetivasDaReserva(db, c.org, reservaId);

describe("decisão de quem arca (item 9)", () => {
  it("sem decisão, nada lançado para ninguém além do retido; a prévia traz as partes efetivas, a proporção e a assinatura de cada opção", async () => {
    const x = await disputada();
    expect((await daDisputa(x.l)).map((l) => [l.tipo, l.estado, l.valor, l.montante, l.chaveOrigem])).toEqual([["devolucao", "previsto", 0, TOTAL, chavesDaContestacao(x.pagamentoId, x.l.id).retido()]]);
    const pv = await previaDaDecisao(db, c.org, x.l.id);
    if (!pv.ok) throw new Error(pv.erro);
    const { parteProprietario: D, comissao: C, proprietarioId } = await partes(x.reservaId);
    expect(D + C).toBe(LIQUIDO);
    expect(proprietarioId).toBe(c.dono);
    expect(pv.fatos).toMatchObject({ versao: 0, valor: TOTAL, perdida: false, semReserva: false, recusa: null, base: null, divisaoMudou: false, lancado: { proprietario: 0, scl: 0 } });
    expect(pv.fatos.opcoes.proprietario).toMatchObject({ proprietario: TOTAL, scl: 0 });
    expect(pv.fatos.opcoes.scl).toMatchObject({ proprietario: 0, scl: TOTAL });
    expect(pv.fatos.opcoes.proporcional).toMatchObject(dividirPerda(TOTAL, D, C)!);
    expect(new Set(Object.values(pv.fatos.opcoes).map((x) => x!.assinatura)).size).toBe(3);
    // A reserva está em conferência por disputa: a parte (ainda não repassada) espera a decisão.
    const [parte] = (await partesDoProprietario(db, c.org, c.dono, sp("2026-10-21 10:00"))).filter((p) => p.reservaId === x.reservaId);
    expect(parte).toMatchObject({ situacao: "a_liberar", contestacaoSemDecisao: true });
  });

  it("registrar: a versão 1 lança o segurado do proprietário e a perda prevista da SCL, previstos, no mês corrente, com as chaves da disputa; a reserva sai da conferência; auditoria e eventos sem a nota", async () => {
    const x = await disputada();
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    const { proprietario: px, scl: py } = dividirPerda(TOTAL, D, C)!;
    const nota = "Hóspede relatou problema no ar-condicionado.";
    const r = await decidir(x.l, "proporcional", sp("2026-10-22 10:00"), { nota, explicacao: "O ar-condicionado do quarto parou." });
    expect(r).toEqual({ ok: true, contestacaoId: x.l.id });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    const [prop] = await naChave(x.l, ch.proprietario(1));
    const [scl] = await naChave(x.l, ch.scl(1));
    expect(prop).toMatchObject({ tipo: "direito_proprietario", valor: -px, efeitoSaldo: -px, proprietarioId: c.dono, estado: "previsto", competencia: "2026-10-01", origem: ORIGEM_LANCAMENTO_CONTESTACAO, reservaId: x.reservaId });
    expect(prop.descricao).toContain(`Disputa do pagamento da reserva ${x.reservaCodigo}`);
    expect(scl).toMatchObject({ tipo: "despesa_empresa", valor: -py, montante: py, estado: "previsto", dataCaixa: null, competencia: "2026-10-01", origem: ORIGEM_LANCAMENTO_CONTESTACAO });
    const [categoria] = await db.select().from(categoriasDespesa).where(eq(categoriasDespesa.id, scl.categoriaId!));
    expect(categoria.nome).toBe("Perda por disputa do pagamento");
    for (const l of await daDisputa(x.l)) expect(l.chaveOrigem.startsWith(`mercadopago:${x.pagamentoId}:contestacao:${x.l.id}:`)).toBe(true);
    expect(await linha(x.l.id)).toMatchObject({
      decisaoVersao: 1,
      causa: "imovel",
      quemArca: "proporcional",
      decisaoNota: nota,
      explicacaoProprietario: "O ar-condicionado do quarto parou.",
      decisaoPor: equipe,
      baseParteProprietario: D,
      baseComissao: C,
      exposicao: TOTAL,
      parteProprietario: px,
      parteScl: py,
    });
    // Com a decisão, a parte da reserva volta às regras de sempre (C5): não espera mais pela disputa.
    const [parte] = (await partesDoProprietario(db, c.org, c.dono, sp("2026-10-23 10:00"))).filter((p) => p.reservaId === x.reservaId && p.origemLancamento === "motor");
    expect(parte.contestacaoSemDecisao).toBeFalsy();
    // Auditoria [antes, depois] e linha do tempo: códigos e valores, nunca a nota nem a explicação.
    const [a] = await auditoriaDe("contestacao.decisao");
    expect(a.mudancas).toMatchObject({ versao: [0, 1], causa: [null, "imovel"], quemArca: [null, "proporcional"], valor: [null, TOTAL], proprietario: [null, px], scl: [null, py] });
    const tipos = (await eventos(x.l.id)).map((e) => e.tipo);
    expect(tipos).toEqual(expect.arrayContaining(["decisao", "lancamentos"]));
    const tudo = JSON.stringify([await db.select().from(auditoria), await db.select().from(eventosContestacao)]);
    expect(tudo).not.toContain("ar-condicionado");
    // Repetir (a mesma prévia de antes): a versão mudou; nada novo no livro.
    const antes = (await daDisputa(x.l)).length;
    expect(await registrarDecisao(db, c.org, x.l.id, { causa: "imovel", quemArca: "proporcional", nota, explicacao: "", versao: 0, assinatura: "x" }, equipe, sp("2026-10-22 11:00"))).toMatchObject({
      ok: false,
      erro: TEXTO_DECISAO_MUDOU,
      codigo: "decisao_mudou",
    });
    expect((await daDisputa(x.l)).length).toBe(antes);
  });

  it("id de outra organização ou inexistente = não encontrada, sem gravar; nota com dado pessoal, sem nota e explicação com dado pessoal recusadas; listas fechadas", async () => {
    const x = await disputada();
    const pv = await previaDaDecisao(db, c.org, x.l.id);
    if (!pv.ok) throw new Error(pv.erro);
    const e = { causa: "imovel", quemArca: "scl", nota: "Falha da equipe.", explicacao: "", versao: 0, assinatura: pv.fatos.opcoes.scl!.assinatura };
    const outra = await montarCenario(db);
    for (const [org, id] of [
      [outra.org, x.l.id],
      [c.org, "nao-e-um-id"],
      [c.org, crypto.randomUUID()],
    ])
      expect(await registrarDecisao(db, org, id, e, equipe, sp("2026-10-22 10:00"))).toEqual({ ok: false, erro: TEXTO_DISPUTA_NAO_ENCONTRADA, codigo: "nao_encontrada" });
    expect(await previaDaDecisao(db, outra.org, x.l.id)).toMatchObject({ ok: false, codigo: "nao_encontrada" });
    expect(await registrarDecisao(db, c.org, x.l.id, { ...e, nota: "Hóspede visitante@example.com reclamou." }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: false, erro: ERRO_DADOS_PESSOAIS });
    expect(await registrarDecisao(db, c.org, x.l.id, { ...e, nota: "  " }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: false });
    expect(await registrarDecisao(db, c.org, x.l.id, { ...e, explicacao: "Ligue para (21) 99999-0000." }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: false, erro: expect.stringContaining("explicação ao proprietário") });
    expect(await registrarDecisao(db, c.org, x.l.id, { ...e, causa: "inventada" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: false, erro: "Escolha a causa da disputa." });
    expect(await registrarDecisao(db, c.org, x.l.id, { ...e, quemArca: "hospede" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: false, erro: "Escolha quem arca." });
    expect((await linha(x.l.id)).decisaoVersao).toBe(0);
    expect(await auditoriaDe("contestacao.decisao")).toEqual([]);
  });

  it("sem proprietário nas linhas do motor: o proprietário e o proporcional são recusados; a SCL é aceita", async () => {
    const x = await disputada();
    await db.update(lancamentos).set({ proprietarioId: null }).where(and(eq(lancamentos.reservaId, x.reservaId), eq(lancamentos.origem, "motor"), eq(lancamentos.tipo, "direito_proprietario")));
    const pv = await previaDaDecisao(db, c.org, x.l.id);
    if (!pv.ok) throw new Error(pv.erro);
    expect(pv.fatos.opcoes).toMatchObject({ proprietario: null, proporcional: null, scl: { proprietario: 0, scl: TOTAL } });
    for (const q of ["proprietario", "proporcional"] as const)
      expect(await registrarDecisao(db, c.org, x.l.id, { causa: "imovel", quemArca: q, nota: "Problema do imóvel.", explicacao: "", versao: 0, assinatura: "qualquer" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({
        ok: false,
        erro: TEXTO_SEM_PROPRIETARIO_NA_RESERVA,
      });
    expect(await decidir(x.l, "scl", sp("2026-10-22 10:00"), { causa: "cobranca" })).toMatchObject({ ok: true });
    expect((await daDisputa(x.l)).map((l) => l.tipo).sort()).toEqual(["despesa_empresa", "devolucao"]);
  });

  it("reserva cancelada com devolução integral (D + C = 0) e devolução já feita: o proporcional é recusado; o proprietário (o das linhas do motor de antes) e a SCL valem", async () => {
    const x = await pagarEConfirmar(c);
    const canc = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "imovel_sem_condicoes" }), equipe, minutos(30));
    expect(canc.resultado).toMatchObject({ ok: true, direito: "integral", devolucao: "confirmada" });
    const reg = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "chargeback", abertaEm: "2026-10-05", valor: TOTAL, prazo: "2026-10-20", idCaso: null, nota: "Vista no painel do Mercado Pago." }, equipe, null, sp("2026-10-05 10:00"));
    if (!reg.ok) throw new Error(reg.erro);
    const l = await linha(reg.contestacaoId);
    expect(l).toMatchObject({ valorEmRisco: TOTAL, avisos: expect.arrayContaining(["contestacao_com_devolucao"]) });
    expect(await partes(x.reservaId)).toEqual({ parteProprietario: 0, comissao: 0, proprietarioId: c.dono });
    const pv = await previaDaDecisao(db, c.org, l.id);
    if (!pv.ok) throw new Error(pv.erro);
    expect(pv.fatos.opcoes).toMatchObject({ proporcional: null, proprietario: { proprietario: TOTAL, scl: 0 }, scl: { proprietario: 0, scl: TOTAL } });
    expect(await registrarDecisao(db, c.org, l.id, { causa: "outro", quemArca: "proporcional", nota: "Sem como separar.", explicacao: "", versao: 0, assinatura: "x" }, equipe, sp("2026-10-06 10:00"))).toMatchObject({
      ok: false,
      erro: TEXTO_SEM_PARTES_PARA_DIVIDIR,
    });
    expect(await decidir(l, "proprietario", sp("2026-10-06 10:00"))).toMatchObject({ ok: true });
    const [prop] = await naChave(l, chavesDaContestacao(x.pagamentoId, l.id).proprietario(1));
    expect(prop).toMatchObject({ valor: -TOTAL, proprietarioId: c.dono });
  });

  it("possível duplicata e pagamento sem reserva não decidem; a assinatura velha (recálculo entre a prévia e o clique) é contestacao_previa_mudou", async () => {
    const x = await disputada();
    const dup = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "chargeback", abertaEm: "2026-10-21", valor: 50_000, prazo: null, idCaso: "123456", nota: "Outro caso no painel." }, equipe, null, sp("2026-10-21 10:00"));
    if (!dup.ok) throw new Error(dup.erro);
    const pvDup = await previaDaDecisao(db, c.org, dup.contestacaoId);
    expect(pvDup.ok && pvDup.fatos.recusa).toBe(TEXTO_DUPLICATA_SEM_DECIDIR);
    expect(await decidir({ id: dup.contestacaoId }, "scl", sp("2026-10-22 10:00"))).toMatchObject({ ok: false, erro: TEXTO_DUPLICATA_SEM_DECIDIR });
    // A prévia, depois um recálculo da reserva (a comissão mudou) e o clique com a assinatura de antes.
    const pv = await previaDaDecisao(db, c.org, x.l.id);
    if (!pv.ok) throw new Error(pv.erro);
    await db.update(contratos).set({ comissaoBp: 2000 }).where(eq(contratos.imovelId, c.imovel));
    await aplicarMotor(db, c.org, x.reservaId, null);
    const r = await registrarDecisao(db, c.org, x.l.id, { causa: "imovel", quemArca: "proporcional", nota: "Problema do imóvel.", explicacao: "", versao: 0, assinatura: pv.fatos.opcoes.proporcional!.assinatura }, equipe, sp("2026-10-22 10:00"));
    expect(r).toMatchObject({ ok: false, erro: TEXTO_CONTESTACAO_PREVIA_MUDOU, codigo: "contestacao_previa_mudou" });
    expect(await decidir(x.l, "proporcional", sp("2026-10-22 10:01"))).toMatchObject({ ok: true });
    // Pagamento sem reserva: não há proprietário; o formulário não aparece.
    const s = await c.segurar({ entrada: "2026-11-20", saida: "2026-11-23", email: "sem@example.com" });
    const pix = await c.pix(s.cotacaoId);
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, s.cotacaoId));
    c.provedor.aprovar(pix.idProvedor, { taxa: TAXA });
    await conferir(pix.pagamentoId, minutos(3));
    c.provedor.contestar(pix.idProvedor);
    await conferir(pix.pagamentoId, sp("2026-10-20 10:00"));
    const [semReserva] = await linhas(pix.pagamentoId);
    expect(semReserva.reservaId).toBeNull();
    const pvSem = await previaDaDecisao(db, c.org, semReserva.id);
    expect(pvSem.ok && pvSem.fatos).toMatchObject({ semReserva: true, recusa: TEXTO_PAGAMENTO_SEM_RESERVA, opcoes: { proprietario: null, scl: null, proporcional: null } });
  });

  it("a divisão mudou depois da decisão é calculada na leitura (o motor não grava na disputa); recálculo ao mesmo tempo que a decisão, sem impasse", async () => {
    const x = await disputada();
    // O recálculo só alcança entradas de hoje em diante (relógio real): com o relógio no dia do cenário (1/10), a reserva
    // de 12/10 entra nele em qualquer data em que o teste rodar.
    vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
    let gravada: Awaited<ReturnType<typeof linha>>;
    try {
      const [r1, rec1] = await Promise.all([decidir(x.l, "proporcional", sp("2026-10-22 10:00")), recalcularReservas(db, c.org, { imovelId: c.imovel }, null)]);
      expect(r1).toMatchObject({ ok: true });
      expect(rec1.reservas).toBeGreaterThan(0);
      gravada = await linha(x.l.id);
      await db.update(contratos).set({ comissaoBp: 2000 }).where(eq(contratos.imovelId, c.imovel));
      expect((await recalcularReservas(db, c.org, { imovelId: c.imovel }, null)).reservas).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
    expect(await linha(x.l.id)).toEqual(gravada);
    const pv = await previaDaDecisao(db, c.org, x.l.id);
    expect(pv.ok && pv.fatos).toMatchObject({ divisaoMudou: true, base: { parteProprietario: gravada.baseParteProprietario, comissao: gravada.baseComissao } });
  });

  it("duas abas: duas decisões ao mesmo tempo, uma versão só", async () => {
    const x = await disputada();
    const pv = await previaDaDecisao(db, c.org, x.l.id);
    if (!pv.ok) throw new Error(pv.erro);
    const e = (q: "scl" | "proprietario") => ({ causa: "imovel", quemArca: q, nota: "Decisão.", explicacao: "", versao: 0, assinatura: pv.fatos.opcoes[q]!.assinatura });
    const rs = await Promise.all([registrarDecisao(db, c.org, x.l.id, e("scl"), equipe, sp("2026-10-22 10:00")), registrarDecisao(db, c.org, x.l.id, e("proprietario"), equipe, sp("2026-10-22 10:00"))]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toMatchObject({ erro: TEXTO_DECISAO_MUDOU });
    expect((await linha(x.l.id)).decisaoVersao).toBe(1);
    expect((await daDisputa(x.l)).filter((l) => l.chaveOrigem.includes(":v"))).toHaveLength(1);
  });
});

describe("linhas pendentes (item 10)", () => {
  it("competência no mês corrente em São Paulo, na virada do mês e do ano; repetir o mesmo momento não lança de novo", async () => {
    const x = await disputada();
    // 31/12 às 23h30 em São Paulo (já 1º/1 em UTC): dezembro.
    expect(await decidir(x.l, "proprietario", sp("2026-12-31 23:30"))).toMatchObject({ ok: true });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    expect((await naChave(x.l, ch.proprietario(1)))[0]).toMatchObject({ competencia: "2026-12-01", valor: -TOTAL, estado: "previsto" });
    // 1º/1 às 0h10: janeiro (a mudança lança só a diferença).
    expect(await decidir(x.l, "scl", sp("2027-01-01 00:10"), { causa: "cobranca", nota: "Era cobrança em dobro.", mudar: true })).toMatchObject({ ok: true });
    expect((await naChave(x.l, ch.proprietario(2)))[0]).toMatchObject({ competencia: "2027-01-01", valor: TOTAL });
    expect((await naChave(x.l, ch.scl(2)))[0]).toMatchObject({ competencia: "2027-01-01", valor: -TOTAL, montante: TOTAL });
    // O mesmo momento de novo (uma falha depois da gravação, repetida): nada novo.
    const antes = await daDisputa(x.l);
    const lancadas = await db.transaction(async (tx) => {
      const t = (await travarCotacao(tx, c.org, x.cotacaoId))!;
      const p = t.tentativas.find((y) => y.id === x.pagamentoId)!;
      const l = t.contestacoes.find((y) => y.id === x.l.id)!;
      return lancarContestacao(tx, c.org, t, p, l, { tipo: "decisao", versao: 2, proprietario: 0, scl: TOTAL, proprietarioId: c.dono }, equipe, sp("2027-01-01 00:20"));
    });
    expect(lancadas).toEqual([]);
    expect((await daDisputa(x.l)).map((l) => l.id)).toEqual(antes.map((l) => l.id));
  });
});

describe("mudar e atualizar a decisão (item 12)", () => {
  it("mudar: a diferença de cada lado no mês corrente; auditoria [antes, depois] sem a nota; versão velha e depois do resultado recusados", async () => {
    const x = await disputada();
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    const { proprietario: px, scl: py } = dividirPerda(TOTAL, D, C)!;
    expect(await decidir(x.l, "proporcional", sp("2026-10-22 10:00"))).toMatchObject({ ok: true });
    expect(await decidir(x.l, "proprietario", sp("2026-11-03 10:00"), { nota: "Laudo do técnico confirmou o defeito.", mudar: true })).toMatchObject({ ok: true });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    expect((await naChave(x.l, ch.proprietario(2)))[0]).toMatchObject({ valor: -(TOTAL - px), competencia: "2026-11-01", estado: "previsto" });
    expect((await naChave(x.l, ch.scl(2)))[0]).toMatchObject({ valor: py, montante: -py, competencia: "2026-11-01" });
    // Outubro não muda.
    expect((await naChave(x.l, ch.proprietario(1)))[0]).toMatchObject({ valor: -px, competencia: "2026-10-01" });
    // Aceite (11/10): o "por que mudar" fica à parte; a nota da decisão (a do registro) não é apagada.
    expect(await linha(x.l.id)).toMatchObject({
      decisaoVersao: 2,
      quemArca: "proprietario",
      parteProprietario: TOTAL,
      parteScl: 0,
      decisaoNota: "Hóspede relatou problema no ar-condicionado.",
      decisaoMudancaNota: "Laudo do técnico confirmou o defeito.",
    });
    const [, a2] = await auditoriaDe("contestacao.decisao");
    expect(a2.mudancas).toMatchObject({ versao: [1, 2], quemArca: ["proporcional", "proprietario"], proprietario: [px, TOTAL], scl: [py, 0] });
    expect(JSON.stringify(a2.mudancas)).not.toContain("Laudo");
    // A prévia velha (versão 1): a decisão mudou.
    expect(await mudarDecisao(db, c.org, x.l.id, { causa: "scl", quemArca: "scl", nota: "Mudar.", explicacao: "", versao: 1, assinatura: "x" }, equipe, sp("2026-11-04 10:00"))).toMatchObject({ ok: false, erro: TEXTO_DECISAO_MUDOU });
    expect(await mudarDecisao(db, c.org, x.l.id, { causa: "scl", quemArca: "scl", nota: "", explicacao: "", versao: 2, assinatura: "x" }, equipe, sp("2026-11-04 10:00"))).toMatchObject({ ok: false });
    // Depois do resultado, a decisão não muda pelo sistema.
    const pr = await previaDoResultado(db, c.org, x.l.id);
    if (!pr.ok) throw new Error(pr.erro);
    const r = await confirmarResultado(
      db,
      c.org,
      x.l.id,
      { resultado: "perdida", data: "2026-12-10", nota: "Perdida no painel.", notaReforcada: false, versao: 2, assinatura: pr.fatos.assinatura, tarifa: null, valorPerdido: TOTAL, liquidoNaoEntrou: 0, debitoEm: "2026-12-09" },
      equipe,
      null,
      sp("2026-12-10 10:00"),
    );
    expect(r).toMatchObject({ ok: true });
    expect(await decidir(x.l, "scl", sp("2026-12-11 10:00"), { mudar: true })).toMatchObject({ ok: false, erro: TEXTO_DISPUTA_JA_TERMINOU });
  });

  it("o valor em disputa mudou depois da decisão: aviso contestacao_valor_mudou e 'Atualizar o valor segurado' (mesma causa e quem arca, base congelada, a diferença de cada lado)", async () => {
    const x = await disputada();
    const { parteProprietario: D, comissao: C } = await partes(x.reservaId);
    expect(await decidir(x.l, "proporcional", sp("2026-10-22 10:00"))).toMatchObject({ ok: true });
    const antes = dividirPerda(TOTAL, D, C)!;
    // A Chargebacks API traz o valor do caso: R$ 1.000,00.
    const caso: LeituraDeContestacao = { fonte: "chargebacks", idCaso: x.idCaso, idContestacao: null, estadoLido: null, coberturaAplicada: null, valor: 100_000, lidaEm: sp("2026-10-25 10:00"), atualizadoNoProvedorEm: sp("2026-10-25 09:00") };
    await db.transaction(async (tx) => {
      const t = (await travarCotacao(tx, c.org, x.cotacaoId))!;
      const p = t.tentativas.find((y) => y.id === x.pagamentoId)!;
      return aplicarLeiturasDaDisputa(tx, c.org, t, p, [caso], sp("2026-10-25 10:00"), { fonte: "chargebacks" });
    });
    expect(await linha(x.l.id)).toMatchObject({ valorEmRisco: 100_000, exposicao: TOTAL, avisos: expect.arrayContaining(["contestacao_valor_mudou"]) });
    // O sistema nunca muda o segurado sozinho.
    expect((await daDisputa(x.l)).filter((l) => l.chaveOrigem.includes(":v"))).toHaveLength(2);
    const pv = await previaDaDecisao(db, c.org, x.l.id);
    if (!pv.ok) throw new Error(pv.erro);
    const depois = dividirPerda(100_000, D, C)!;
    expect(pv.fatos.atualizacao).toMatchObject(depois);
    expect(await atualizarValorSegurado(db, c.org, x.l.id, { versao: 1, assinatura: pv.fatos.atualizacao!.assinatura }, equipe, sp("2026-11-02 10:00"))).toMatchObject({ ok: true });
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    expect((await naChave(x.l, ch.proprietario(2)))[0]).toMatchObject({ valor: antes.proprietario - depois.proprietario, competencia: "2026-11-01" });
    expect((await naChave(x.l, ch.scl(2)))[0]).toMatchObject({ valor: antes.scl - depois.scl, competencia: "2026-11-01" });
    const l = await linha(x.l.id);
    expect(l).toMatchObject({ decisaoVersao: 2, causa: "imovel", quemArca: "proporcional", exposicao: 100_000, parteProprietario: depois.proprietario, parteScl: depois.scl });
    expect(l.avisos).not.toContain("contestacao_valor_mudou");
    expect((await auditoriaDe("contestacao.decisao"))[1].mudancas).toMatchObject({ versao: [1, 2], valor: [TOTAL, 100_000], atualizacao: [null, true] });
    expect(await atualizarValorSegurado(db, c.org, x.l.id, { versao: 2, assinatura: pv.fatos.atualizacao!.assinatura }, equipe, sp("2026-11-02 11:00"))).toMatchObject({ ok: false, erro: TEXTO_VALOR_SEGURADO_EM_DIA });
  });
});

describe("débito do Mercado Pago (item 13)", () => {
  it("confirmar o débito: o retido previsto é estornado e nasce o realizado no dia do débito (valor diferente pede a nota); uma vez; fora do dinheiro com a empresa enquanto a disputa não é perdida", async () => {
    const x = await disputada();
    const ch = chavesDaContestacao(x.pagamentoId, x.l.id);
    const [previsto] = await naChave(x.l, ch.retido());
    expect(previsto).toMatchObject({ estado: "previsto", montante: TOTAL, competencia: "2026-10-20", dataCaixa: null });
    const quando = sp("2026-10-22 10:00");
    expect(await confirmarDebito(db, c.org, x.l.id, { data: "2026-10-23", valor: TOTAL, nota: "" }, equipe, quando)).toMatchObject({ ok: false, erro: expect.stringContaining("não pode ser no futuro") });
    expect(await confirmarDebito(db, c.org, x.l.id, { data: "2026-09-01", valor: TOTAL, nota: "" }, equipe, quando)).toMatchObject({ ok: false });
    expect(await confirmarDebito(db, c.org, x.l.id, { data: "2026-10-21", valor: TOTAL + 1, nota: "" }, equipe, quando)).toMatchObject({ ok: false });
    expect(await confirmarDebito(db, c.org, x.l.id, { data: "2026-10-21", valor: TOTAL - 10_000, nota: "" }, equipe, quando)).toMatchObject({ ok: false, erro: TEXTO_NOTA_DO_DEBITO });
    expect(await confirmarDebito(db, c.org, x.l.id, { data: "2026-10-21", valor: TOTAL - 10_000, nota: "O painel mostra o valor sem os juros." }, equipe, quando)).toEqual({ ok: true, contestacaoId: x.l.id });
    const estornos = await db.select().from(lancamentos).where(eq(lancamentos.estornoDe, previsto.id));
    expect(estornos).toHaveLength(1);
    const [realizado] = await naChave(x.l, ch.retido(2));
    expect(realizado).toMatchObject({ tipo: "devolucao", estado: "realizado", valor: 0, montante: TOTAL - 10_000, competencia: "2026-10-21", dataCaixa: "2026-10-21" });
    expect(await linha(x.l.id)).toMatchObject({ retidoLancamentoId: realizado.id, retidoConfirmadoPor: equipe, retidoConfirmadoEm: quando, debitoEm: "2026-10-21" });
    expect(await confirmarDebito(db, c.org, x.l.id, { data: "2026-10-21", valor: TOTAL, nota: "" }, equipe, sp("2026-10-22 11:00"))).toMatchObject({ ok: false, erro: TEXTO_DEBITO_JA_CONFIRMADO });
    expect((await eventos(x.l.id)).map((e) => e.tipo)).toEqual(expect.arrayContaining(["debito_confirmado", "lancamentos"]));
    const [a] = await auditoriaDe("contestacao.debito");
    expect(a.mudancas).toMatchObject({ valor: [TOTAL, TOTAL - 10_000], data: [null, "2026-10-21"] });
    expect(JSON.stringify(a.mudancas)).not.toContain("juros");
    // O retido realizado não conta no dinheiro com a empresa enquanto a disputa não é perdida com os definitivos.
    const recebido = (await recebidoPorReserva(db, c.org, [x.reservaId])).get(x.reservaId)!;
    expect(recebido).toMatchObject({ recebido: LIQUIDO, devido: LIQUIDO });
    expect(dinheiroComAEmpresa(recebido)).toBe(true);
    // A estorno do retido previsto e o realizado: nunca no livro de outra organização, e a chave é a da disputa.
    expect(await db.select().from(lancamentos).where(inArray(lancamentos.id, [previsto.id, realizado.id]))).toHaveLength(2);
  });

  it("débito numa disputa já terminada ou numa possível duplicata: recusado", async () => {
    const x = await disputada({ liberar: false });
    const dup = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "chargeback", abertaEm: "2026-10-21", valor: 50_000, prazo: null, idCaso: "123456", nota: "Outro caso no painel." }, equipe, null, sp("2026-10-21 10:00"));
    if (!dup.ok) throw new Error(dup.erro);
    expect(await confirmarDebito(db, c.org, dup.contestacaoId, { data: "2026-10-21", valor: 50_000, nota: "" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: false, erro: TEXTO_DUPLICATA_SEM_DECIDIR });
    expect(await confirmarDebito(db, c.org, crypto.randomUUID(), { data: "2026-10-21", valor: 50_000, nota: "" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: false, codigo: "nao_encontrada" });
  });
});

describe("outra disputa, documentos e prazo", () => {
  it("'Confirmar que é outra disputa': a possível duplicata passa a valer (valor em risco até o pago, retido previsto); documentos enviados uma vez; o prazo informado desliga o aviso", async () => {
    const x = await disputada({ valor: 100_000 });
    const dup = await registrarContestacaoDaEquipe(db, c.org, x.pagamentoId, { tipo: "chargeback", abertaEm: "2026-10-21", valor: 50_000, prazo: null, idCaso: "123456", nota: "Outro caso no painel." }, equipe, null, sp("2026-10-21 10:00"));
    if (!dup.ok) throw new Error(dup.erro);
    expect(await linha(dup.contestacaoId)).toMatchObject({ duplicataPossivel: true, valorEmRisco: 0, retidoLancamentoId: null });
    expect(await confirmarOutraDisputa(db, c.org, dup.contestacaoId, equipe, sp("2026-10-22 10:00"))).toEqual({ ok: true, contestacaoId: dup.contestacaoId });
    const outra = await linha(dup.contestacaoId);
    expect(outra).toMatchObject({ duplicataPossivel: false, valorEmRisco: 50_000, confirmadaOutraPor: equipe });
    expect(outra.avisos).not.toContain("contestacao_possivel_duplicata");
    expect((await naChave(outra, chavesDaContestacao(x.pagamentoId, outra.id).retido()))[0]).toMatchObject({ estado: "previsto", montante: 50_000 });
    expect(await confirmarOutraDisputa(db, c.org, dup.contestacaoId, equipe, sp("2026-10-22 11:00"))).toMatchObject({ ok: false });
    expect(await auditoriaDe("contestacao.outra_disputa")).toHaveLength(1);
    // Documentos enviados no painel do Mercado Pago: a data (até hoje), uma vez.
    expect(await marcarDocumentosEnviados(db, c.org, x.l.id, { data: "2026-10-23" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: false });
    expect(await marcarDocumentosEnviados(db, c.org, x.l.id, { data: "2026-10-22" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: true });
    expect(await linha(x.l.id)).toMatchObject({ documentosEnviadosEm: sp("2026-10-22 12:00"), documentosEnviadosPor: equipe });
    expect(await marcarDocumentosEnviados(db, c.org, x.l.id, { data: "2026-10-22" }, equipe, sp("2026-10-22 11:00"))).toMatchObject({ ok: false, erro: expect.stringContaining("já foram marcados como enviados em 22/10") });
    // O prazo dos documentos que a leitura da order não traz: informado pela equipe, o aviso sai.
    expect(x.l.avisos).toContain("contestacao_prazo_desconhecido");
    expect(await informarPrazoDocumentos(db, c.org, x.l.id, { prazo: "2026-10-30" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: true });
    const l = await linha(x.l.id);
    expect(l.documentacaoPrazo).toEqual(sp("2026-10-30 23:59"));
    expect(l.avisos).not.toContain("contestacao_prazo_desconhecido");
    expect((await eventos(x.l.id)).map((e) => e.tipo)).toEqual(expect.arrayContaining(["documentos_enviados", "prazo"]));
    expect((await auditoriaDe("contestacao.prazo"))[0].mudancas).toMatchObject({ prazo: [null, "2026-10-30"] });
    expect(await auditoriaDe("contestacao.documentos")).toHaveLength(1);
  });

  it("documentos enviados: nunca antes da abertura da disputa, mesmo com a aprovação dias antes (Codex, 11/10)", async () => {
    // Aprovado em 01/10; a leitura da order viu a disputa em 20/10 (sem a abertura no Mercado Pago).
    const x = await disputada();
    expect(x.l.abertaNoProvedorEm).toBeNull();
    expect(await marcarDocumentosEnviados(db, c.org, x.l.id, { data: "2026-10-10" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: false, erro: expect.stringContaining("não pode ser antes de 20/10/2026") });
    expect(await marcarDocumentosEnviados(db, c.org, x.l.id, { data: "2026-10-19" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: false });
    expect((await linha(x.l.id)).documentosEnviadosEm).toBeNull();
    expect(await marcarDocumentosEnviados(db, c.org, x.l.id, { data: "2026-10-20" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: true });
    // Registrada pela equipe (aberta em 21/10 no painel do Mercado Pago): a partir desse dia.
    const y = await pagarEConfirmar(c, { liberar: true, entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    const r = await registrarContestacaoDaEquipe(db, c.org, y.pagamentoId, { tipo: "chargeback", abertaEm: "2026-10-21", valor: 50_000, prazo: null, idCaso: null, nota: "Aberta no painel." }, equipe, null, sp("2026-10-22 09:00"));
    if (!r.ok) throw new Error(r.erro);
    expect(await marcarDocumentosEnviados(db, c.org, r.contestacaoId, { data: "2026-10-20" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: false, erro: expect.stringContaining("não pode ser antes de 21/10/2026") });
    expect(await marcarDocumentosEnviados(db, c.org, r.contestacaoId, { data: "2026-10-21" }, equipe, sp("2026-10-22 10:00"))).toMatchObject({ ok: true });
  });
});
