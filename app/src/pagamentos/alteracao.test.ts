import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_PAGAMENTO_SITE_PADRAO, salvarConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { alteracoesReserva, auditoria, beds24Calendario, bloqueios, contratos, devolucoesPagamento, imoveisDetalhes, lancamentos, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { aplicarMotor } from "@/financeiro/aplicar";
import { avisosDeAlteracao } from "@/painel/dashboard";
import { recebidoPorReserva } from "@/repasses/recebimentos";
import { criarCotacao, segurarDatas } from "@/site/cotacoes";
import { consultarDisponibilidade } from "@/site/disponibilidade";
import { confirmarReserva, tentarCancelarReserva } from "@/reservas/repositorio";
import {
  aplicarAlteracaoPelaEquipe,
  desistirDaAlteracao,
  expirarAlteracoesVencidas,
  marcarOtaAtualizada,
  previaDaAlteracao,
  previaDaAplicacao,
  segurarAlteracao,
  TEXTO_DEVOLUCAO_EM_ANDAMENTO,
  TEXTO_DUAS_PONTAS,
  TEXTO_EM_CONFERENCIA,
  TEXTO_FINANCEIRO_MOVIMENTADO,
  TEXTO_HA_CANCELAMENTO,
  TEXTO_PREVIA_MUDOU_ALTERACAO,
  TEXTO_RESERVA_MUDOU,
  TEXTO_SEM_EFEITO,
  TEXTO_SEM_LEITURA_ALTERACAO,
  TEXTO_SEM_MUDANCA,
} from "./alteracao";
import { conferirTentativa } from "./conferencia";
import { TEXTO_SEM_COBRANCA } from "./oferta";
import { registrarTaxaPerdida, tentarDevolucao } from "./devolucao";
import { conferirPendentes } from "./rotina";
import {
  alteracaoGravada,
  alterar,
  type Cenario,
  cancelar,
  entradaAlteracao,
  entradaPadrao,
  env,
  envelhecer,
  liberar,
  minutos,
  montarCenario,
  pagarDiferenca,
  pagarEConfirmar,
  pedir,
  semDadosDoHospede,
  TOTAL,
  usuarioDeTeste,
} from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});

/** Um instante no horário de São Paulo ("AAAA-MM-DD HH:MM"). */
const sp = (dataHora: string) => new Date(`${dataHora.replace(" ", "T")}:00-03:00`);
/** A leitura do Beds24 renovada pouco antes de `quando` (a agenda das noites continua livre). */
const lerAgenda = (quando: Date) => db.update(beds24Calendario).set({ observadoEm: new Date(quando.getTime() - 3_600_000) }).where(eq(beds24Calendario.organizacaoId, c.org));
/** Os lançamentos do motor ainda em vigor (sem estorno). */
const motorEmVigor = async (reservaId: string) => {
  const todos = await db.select().from(lancamentos).where(eq(lancamentos.reservaId, reservaId)).orderBy(asc(lancamentos.competencia), asc(lancamentos.id));
  const estornados = new Set(todos.filter((l) => l.estornoDe).map((l) => l.estornoDe));
  return todos.filter((l) => l.origem === "motor" && !estornados.has(l.id));
};
const estornosDe = (reservaId: string) => db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), isNotNull(lancamentos.estornoDe)));
const portadores = () => db.select().from(reservas).where(and(eq(reservas.organizacaoId, c.org), eq(reservas.fonte, "alteracao")));
const devolucoesDa = (alteracaoId: string) => db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.alteracaoId, alteracaoId));
const total = (ls: { tipo: string; valor: number }[], tipo: string) => ls.filter((l) => l.tipo === tipo).reduce((s, l) => s + l.valor, 0);
const COMPONENTES = { receita_bruta: "bruto", taxa_canal: "taxa", comissao: "comissao", direito_proprietario: "parte" } as const;

/** Os ids dos lançamentos da reserva agora (para separar o que a alteração lançou). */
const idsDoLivro = async (reservaId: string) => new Set((await db.select({ id: lancamentos.id }).from(lancamentos).where(eq(lancamentos.reservaId, reservaId))).map((l) => l.id));
/** Por mês e componente: o novo menos o estornado (os lançamentos do motor e os estornos que não estavam em `antes`). */
async function liquidoPorMes(reservaId: string, antes: Set<string>) {
  const todos = await db.select().from(lancamentos).where(eq(lancamentos.reservaId, reservaId));
  const m = new Map<string, Record<string, number>>();
  for (const l of todos) {
    if (antes.has(l.id) || !(l.tipo in COMPONENTES)) continue;
    if (l.origem !== "motor" && l.origem !== "estorno") continue;
    const mes = l.competencia.slice(0, 7);
    const x = m.get(mes) ?? { bruto: 0, taxa: 0, comissao: 0, parte: 0 };
    x[COMPONENTES[l.tipo as keyof typeof COMPONENTES]] += l.valor;
    m.set(mes, x);
  }
  return m;
}

/** Uma alteração aplicada guardou, por mês, o antes e o depois; a diferença tem de ser o que o livro mudou. */
function deltaDoResultado(a: Awaited<ReturnType<typeof alteracaoGravada>>) {
  const m = new Map<string, Record<string, number>>();
  for (const x of a.resultado?.meses ?? []) {
    const d = { bruto: x.depois.bruto - x.antes.bruto, taxa: x.depois.taxa - x.antes.taxa, comissao: x.depois.comissao - x.antes.comissao, parte: x.depois.parte - x.antes.parte };
    // Mês sem diferença: o motor não lança nada nele (mesma chave e assinatura).
    if (Object.values(d).some((v) => v !== 0)) m.set(x.mes, d);
  }
  return m;
}

/**
 * O livro protegido no meio da aplicação (gatilho só de teste): quando a reserva-pedido é cancelada (depois das
 * conferências do motor), um lançamento do motor da reserva vira realizado; a sincronização então volta com o financeiro
 * não atualizado e a alteração lança `ErroAlteracaoProtegida`. Sob D1 nunca acontece: aqui a defesa (a transação ou o
 * savepoint desfeitos) é exercitada de verdade. Devolve a limpeza.
 */
async function protegerNoMeio(reservaId: string): Promise<() => Promise<void>> {
  if (!/^[0-9a-f-]{36}$/.test(reservaId)) throw new Error("id inválido");
  await db.execute(
    sql.raw(
      `create or replace function teste_proteger_livro() returns trigger language plpgsql as $$ begin update lancamentos set estado = 'realizado', data_caixa = '2026-10-01' where id = (select id from lancamentos where reserva_id = '${reservaId}' and origem = 'motor' order by id limit 1); return new; end $$`,
    ),
  );
  await db.execute(sql.raw(`create trigger teste_proteger_livro after update on reservas for each row when (new.fonte = 'alteracao' and new.estado = 'cancelada' and old.estado <> 'cancelada') execute function teste_proteger_livro()`));
  return async () => {
    await db.execute(sql.raw("drop trigger if exists teste_proteger_livro on reservas"));
    await db.execute(sql.raw("drop function if exists teste_proteger_livro()"));
  };
}
/** Nenhum lançamento do motor da reserva realizado e a reserva fora da conferência (nada ficou do meio da aplicação). */
const livroIntacto = async (reservaId: string) => {
  expect((await motorEmVigor(reservaId)).every((l) => l.estado === "previsto")).toBe(true);
  expect((await c.reserva(reservaId)).divergenciaEm).toBeNull();
};

describe("aumento: o hóspede paga a diferença na página da reserva", () => {
  it("Pix: prévia, datas seguradas pela reserva-pedido, a aprovação aplica; estornos com o id da alteração; Δ guardado = novo − estornado; aviso das OTAs; sem dado pessoal", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    const antes = await motorEmVigor(x.reservaId);
    expect(antes).toHaveLength(4);
    const { previa, resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!previa.ok) throw new Error(previa.erro);
    expect(previa.previa).toMatchObject({
      rumo: "aumento",
      diferenca: 52800,
      valorNovo: 235200,
      antes: { checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, valor: TOTAL },
      depois: { checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, valor: 235200 },
      noitesNovas: { inicio: "2026-10-15", fim: "2026-10-16" },
      holdMinutos: 60,
      origemValor: "cotacao",
      direito: null,
      partes: [],
      valorADevolver: 0,
    });
    expect(previa.previa.pergunta).toBe(
      "Segurar as novas datas (12/10 a 16/10, 4 noites, 4 pessoas) até 13:20 e liberar para o hóspede pagar a diferença de R$ 528,00 na página da reserva? Até o pagamento, a reserva continua como está (12/10 a 15/10). Quando ele pagar, a alteração vale sozinha; depois, mude o bloqueio nas OTAs (no Beds24).",
    );
    expect(previa.previa.avisos).toEqual(
      expect.arrayContaining([
        `As novas datas ficam seguradas por 60 minutos (Configurações → Calendário e preços, "alteração de reserva paga pelo site"); o Pix da diferença estende esse prazo.`,
        "A taxa do pagamento da diferença fica conhecida depois do pagamento.",
        "Depois de aplicada, mude o bloqueio no Beds24: feche as novas datas e reabra as antigas.",
      ]),
    );
    expect(resultado).toMatchObject({ ok: true, situacao: "segurada", holdAte: minutos(80), devolucoes: [] });
    if (!resultado.ok) throw new Error();
    // A reserva continua como estava; a reserva-pedido segura só a noite nova, sem contato nem valores.
    expect(await c.reserva(x.reservaId)).toMatchObject({ checkin: "2026-10-12", checkout: "2026-10-15", valorBruto: TOTAL });
    const [portador] = await portadores();
    expect(portador).toMatchObject({ estado: "pedido", checkin: "2026-10-15", checkout: "2026-10-16", idFonte: resultado.alteracaoId, hospedeNome: `Alteração ${x.reservaCodigo}`, hospedeEmail: "", hospedeTelefone: "", valorBruto: null, taxaCanal: null });
    expect(portador.observacoes).toContain("até 01/10, 13:20");
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ situacao: "segurada", holdReservaId: portador.id, diferenca: 52800, valorAntes: TOTAL, valorDepois: 235200, criadaPor: equipe });

    // O hóspede paga a diferença por Pix (taxa 1%): o prazo das datas acompanha o Pix e a aprovação aplica.
    const inicio = await idsDoLivro(x.reservaId);
    const pag = await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25) });
    expect(pag.resultado).toBe("aprovado");
    expect(await c.tentativa(pag.pagamentoId)).toMatchObject({ valor: 52800, alteracaoId: resultado.alteracaoId, desfecho: "alteracao", desfechoMotivo: "alteracao", motivoSemReserva: null, taxa: 528 });
    const a = await alteracaoGravada(c, resultado.alteracaoId);
    expect(a).toMatchObject({ situacao: "aplicada", aplicadaPor: null, aplicadaTardia: false, taxaDepois: 2352 });
    expect(a.holdAte!.getTime()).toBeGreaterThan(minutos(80).getTime());
    const r = await c.reserva(x.reservaId);
    expect(r).toMatchObject({ estado: "confirmada", checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, valorBruto: 235200, taxaCanal: 2352, valorLiquido: 235200 - 2352, fonte: "site" });
    expect(r.observacoes).toContain("Alterada em 01/10: de 12/10–15/10 (3 noites, 4 pessoas) para 12/10–16/10 (4 noites, 4 pessoas).");
    // A linha da alteração não leva valor (a equipe de operação lê as observações).
    expect(r.observacoes.split("\n").at(-1)).not.toContain("R$");
    expect((await portadores())[0].estado).toBe("cancelada");
    // O motor: os 4 lançamentos antigos estornados no próprio mês com o id da alteração no motivo; os novos no total novo.
    const estornos = await estornosDe(x.reservaId);
    expect(estornos).toHaveLength(4);
    for (const e of estornos) expect(e.descricao).toBe(`Estorno: Alteração ${a.id} da reserva ${x.reservaCodigo}: recalculado`);
    const depois = await motorEmVigor(x.reservaId);
    expect(total(depois, "receita_bruta")).toBe(235200);
    expect(total(depois, "taxa_canal")).toBe(-2352);
    expect(total(depois, "comissao") + total(depois, "direito_proprietario")).toBe(235200 - 2352);
    expect(deltaDoResultado(a)).toEqual(await liquidoPorMes(x.reservaId, inicio));
    expect(deltaDoResultado(a).get("2026-10")).toMatchObject({ bruto: 52800, taxa: -528 });
    // Auditoria: a reserva alterada (com o id da alteração) e a alteração aplicada.
    const acoes = (await db.select({ acao: auditoria.acao }).from(auditoria).where(eq(auditoria.organizacaoId, c.org))).map((y) => y.acao);
    expect(acoes).toEqual(expect.arrayContaining(["alteracao.preparar", "alteracao.segurar", "alteracao.estender", "reserva.alterar", "alteracao.aplicar", "pagamento.alteracao"]));

    // Início (operação): mudar o bloqueio nas OTAs enquanto o envio ao Beds24 está desligado, até a equipe marcar.
    const ota = (await avisosDeAlteracao(db, c.org, minutos(40), { env: env() })).find((y) => y.texto.includes("mude o bloqueio nas OTAs"));
    expect(ota).toEqual({
      nivel: "info",
      texto: `1 reserva(s) do site alterada(s) (${x.reservaCodigo}): mude o bloqueio nas OTAs (no Beds24, feche as novas datas e reabra as antigas) enquanto o envio ao Beds24 estiver desligado.`,
      link: `/painel/reservas/${x.reservaId}`,
    });
    expect(ota!.texto).not.toContain("R$");
    expect(await marcarOtaAtualizada(db, c.org, a.id, equipe, minutos(41))).toEqual({ ok: true });
    expect(await marcarOtaAtualizada(db, c.org, a.id, equipe, minutos(42))).toMatchObject({ ok: false });
    expect((await avisosDeAlteracao(db, c.org, minutos(43), { env: env() })).some((y) => y.texto.includes("mude o bloqueio nas OTAs"))).toBe(false);
    // Repetir a aplicação não muda nada: a alteração aplicada recusa de novo (e a outra tentativa não aplica duas vezes).
    expect(await previaDaAplicacao(db, c.org, a.id, c.provedor, minutos(44))).toMatchObject({ ok: false, codigo: "nao_segurada" });
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("cartão da diferença em análise: o prazo estende uma vez, a carência segura o vencimento e a aprovação depois aplica", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    c.provedor.respostaCartao = "em_analise";
    const cartao = await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { forma: "cartao", quando: minutos(25) });
    expect(await c.tentativa(cartao.pagamentoId)).toMatchObject({ valor: 52800, situacao: "pendente", etapaCartao: "analise", alteracaoId: resultado.alteracaoId });
    // A extensão da análise (60 minutos) vale para a alteração, não para a cotação.
    expect((await alteracaoGravada(c, resultado.alteracaoId)).holdAte).toEqual(minutos(85));
    // Prazo passou há 10 minutos, mas a carência do cartão em análise segura as datas: nem a rotina vence nem outra alteração entra.
    expect(await expirarAlteracoesVencidas(db, c.org, minutos(95))).toEqual({ expiradas: 0, falhas: 0, puladas: 0 });
    expect((await alterar(c, x.reservaId, { checkout: "2026-10-17" }, minutos(95), { autorId: equipe })).previa).toMatchObject({ ok: false, codigo: "ha_alteracao" });
    c.provedor.concluirAnalise(cartao.idProvedor, "aprovado");
    c.provedor.atualizarFinanceiro(cartao.idProvedor, { taxa: 528, liquido: 52800 - 528 });
    await conferirTentativa(db, c.org, cartao.pagamentoId, c.provedor, minutos(96), { origem: "rotina", forcar: true });
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ situacao: "aplicada", aplicadaTardia: false });
    expect(await c.reserva(x.reservaId)).toMatchObject({ checkout: "2026-10-16", valorBruto: 235200 });
    expect(await c.tentativa(cartao.pagamentoId)).toMatchObject({ desfecho: "alteracao" });
  });

  it("a SCL propõe: o valor é mantido por padrão; pela cotação, o aviso de cobrar e a frase na pergunta", async () => {
    const x = await pagarEConfirmar(c);
    const empresa = { quemPede: "empresa" as const, motivoEmpresa: "imovel_sem_condicoes" as const, canal: null };
    const mantido = await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, recebidoEm: minutos(20), ...empresa, valor: { origem: "mantido", motivo: "alteracao_pela_scl", nota: "A SCL ofereceu uma noite a mais" } }), c.provedor, minutos(20));
    expect(mantido).toMatchObject({ ok: true, previa: { rumo: "igual", diferenca: 0, depois: { valor: TOTAL } } });
    const cotada = await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, recebidoEm: minutos(20), ...empresa }), c.provedor, minutos(20));
    if (!cotada.ok) throw new Error(cotada.erro);
    expect(cotada.previa.avisos).toContain("A alteração é proposta pela SCL: cobrar R$ 528,00 do hóspede?");
    expect(cotada.previa.pergunta).toContain("A alteração é proposta pela SCL: confirme que o hóspede paga a diferença.");
  });
});

describe("prazo das datas seguradas e desistência", () => {
  it("vencimento preguiçoso: sem a rotina, o prazo passado não impede outra alteração nem segura as noites; a próxima ação grava 'expirada' e cancela a reserva-pedido", async () => {
    const x = await pagarEConfirmar(c);
    // Outro hóspede cotou 15/10–17/10 antes da alteração (a cotação aberta não ocupa nada).
    const cotacao = await criarCotacao(db, c.org, { imovel: "403", entrada: "2026-10-15", saida: "2026-10-17", hospedes: "2" }, minutos(10));
    if (!cotacao.ok) throw new Error(cotacao.erro);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    // Depois do prazo, sem a rotina: segurar as datas no site vence antes a alteração do mesmo imóvel e segura.
    const outro = await segurarDatas(db, c.org, cotacao.cotacao.codigo, { nome: "Outra Pessoa Fictícia", email: "outro@example.com", telefone: "(21) 98888-0000" }, minutos(81));
    expect(outro).toMatchObject({ ok: true });
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ situacao: "expirada", expiradaEm: minutos(81) });
    expect((await portadores())[0].estado).toBe("cancelada");
    // Uma alteração nova na mesma reserva já não esbarra na vencida (as noites agora são do outro hóspede).
    expect((await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(82), { autorId: equipe })).previa).toMatchObject({ ok: false, codigo: "indisponivel" });
    expect((await alterar(c, x.reservaId, { checkout: "2026-10-14" }, minutos(82), { autorId: equipe })).previa).toMatchObject({ ok: true });
  });

  it("a rotina cancela no Mercado Pago o Pix da diferença de uma alteração vencida (prazo e carência passados), fora da transação", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const pix = await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25), aprovar: false });
    const holdAte = (await alteracaoGravada(c, resultado.alteracaoId)).holdAte!;
    // Antes do fim da carência, nada é cancelado (a rotina do teste confere as leituras e não chama "cancelar").
    await conferirPendentes(db, c.org, c.provedor, new Date(holdAte.getTime() + 5 * 60_000), { forcar: true });
    expect(c.provedor.chamadas.some((y) => y.metodo === "cancelar")).toBe(false);
    const depois = new Date(holdAte.getTime() + 16 * 60_000);
    await conferirPendentes(db, c.org, c.provedor, depois, { forcar: true });
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ situacao: "expirada" });
    expect(c.provedor.chamadas.filter((y) => y.metodo === "cancelar")).toHaveLength(1);
    expect(await c.tentativa(pix.pagamentoId)).toMatchObject({ cancelamentoPor: "sistema" });
  });

  it("desistir: o Pix pendente é cancelado depois da transação; pago na corrida, fica sem reserva ('alteracao_desistida') e vai para a devolução", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const pix = await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25), aprovar: false });
    expect(await desistirDaAlteracao(db, c.org, resultado.alteracaoId, "", equipe, c.provedor, minutos(30))).toMatchObject({ ok: false, codigo: "dados" });
    expect(await desistirDaAlteracao(db, c.org, resultado.alteracaoId, "CPF 123.456.789-09", equipe, c.provedor, minutos(30))).toMatchObject({ ok: false, codigo: "dados" });
    // O hóspede paga no meio (o Mercado Pago aprova antes de o cancelamento chegar).
    c.provedor.aprovar(pix.idProvedor, { taxa: 528 });
    expect(await desistirDaAlteracao(db, c.org, resultado.alteracaoId, "O hóspede desistiu pelo WhatsApp", equipe, c.provedor, minutos(30))).toEqual({ ok: true });
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ situacao: "desistida", desistidaPor: equipe, desistenciaMotivo: "O hóspede desistiu pelo WhatsApp" });
    expect((await portadores())[0].estado).toBe("cancelada");
    expect(c.provedor.chamadas.filter((y) => y.metodo === "cancelar")).toHaveLength(1);
    await conferirTentativa(db, c.org, pix.pagamentoId, c.provedor, minutos(31), { origem: "rotina", forcar: true });
    expect(await c.tentativa(pix.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "alteracao_desistida" });
    expect(await c.reserva(x.reservaId)).toMatchObject({ checkout: "2026-10-15", valorBruto: TOTAL });
    // Desistir de novo: já não está segurada.
    expect(await desistirDaAlteracao(db, c.org, resultado.alteracaoId, "De novo", equipe, c.provedor, minutos(32))).toMatchObject({ ok: false, codigo: "nao_segurada" });
  });
});

describe("redução: a diferença segue a política aceita no pagamento", () => {
  it("integral (exemplo B): segurar e aplicar num passo; a devolução nasce depois de a reserva mudar, espera a liberação e sai com o valor depois dela", async () => {
    const x = await pagarEConfirmar(c);
    const inicio = await idsDoLivro(x.reservaId);
    const { previa, resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-14" }, minutos(20), { autorId: equipe, aplicar: true });
    if (!previa.ok) throw new Error(previa.erro);
    expect(previa.previa).toMatchObject({ rumo: "reducao", direito: "integral", base: "arrependimento", noitesNovas: null });
    const diferenca = previa.previa.diferenca;
    expect(diferenca).toBeLessThan(0);
    expect(previa.previa.valorADevolver).toBe(-diferenca);
    expect(previa.previa.partes).toEqual([expect.objectContaining({ pagamentoId: x.pagamentoId, valor: -diferenca, rota: "pedida", aguardaLiberacao: true })]);
    expect(previa.previa.pergunta).toContain(`a diferença de R$`);
    expect(previa.previa.pergunta).toContain("quando ele liberar o pagamento");
    expect(resultado).toMatchObject({ ok: true, situacao: "aplicada", devolucoes: ["pedida"] });
    if (!resultado.ok) throw new Error();
    // Sem reserva-pedido (nenhuma noite nova).
    expect(await portadores()).toEqual([]);
    const r = await c.reserva(x.reservaId);
    expect(r).toMatchObject({ checkout: "2026-10-14", valorBruto: TOTAL + diferenca });
    const a = await alteracaoGravada(c, resultado.alteracaoId);
    expect(a).toMatchObject({ situacao: "aplicada", aplicadaPor: equipe, direito: "integral", valorADevolver: -diferenca });
    expect(deltaDoResultado(a)).toEqual(await liquidoPorMes(x.reservaId, inicio));
    // A devolução: depois da reserva mudar (auditoria em ordem), esperando o Mercado Pago liberar o pagamento.
    const [d] = await devolucoesDa(a.id);
    expect(d).toMatchObject({ origem: "alteracao", valor: -diferenca, situacao: "pedida", ultimoCodigo: "aguardando_liberacao", idProvedor: null });
    const ordem = (await db.select({ acao: auditoria.acao, entidadeId: auditoria.entidadeId }).from(auditoria).where(eq(auditoria.organizacaoId, c.org)).orderBy(asc(auditoria.criadoEm), asc(auditoria.id))).map((y) => y.acao);
    expect(ordem.indexOf("reserva.alterar")).toBeGreaterThan(-1);
    expect(c.provedor.chamadas.some((y) => y.metodo === "devolver")).toBe(false);
    // A equipe registra a liberação (teste): a devolução sai com o valor (parte do pagamento).
    await liberar(c, x.pagamentoId, { quando: minutos(40) });
    expect(await tentarDevolucao(db, c.org, d.id, c.provedor, minutos(41))).toBe("confirmada");
    const chamada = c.provedor.chamadas.find((y) => y.metodo === "devolver");
    expect(chamada).toBeTruthy();
    const [depois] = await devolucoesDa(a.id);
    expect(depois).toMatchObject({ situacao: "confirmada", valorConfirmado: -diferenca });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido_parcial" });
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("exemplo B (mudando de mês): o resultado guardado por mês é o que o livro mudou, o mês desocupado zerado; a saída é o devolvido menos a taxa atribuída, a taxa perdida é despesa da reserva e o recebido fecha com o devido", async () => {
    // 29/10–03/11 (3 noites em outubro, 2 em novembro), paga e liberada; muda para 05/11–09/11 (4 noites) pela cotação.
    const x = await pagarEConfirmar(c, { entrada: "2026-10-29", saida: "2026-11-03", liberar: true });
    const r0 = await c.reserva(x.reservaId);
    const B1 = r0.valorBruto!;
    const F1 = 1824;
    expect(new Set((await motorEmVigor(x.reservaId)).map((l) => l.competencia.slice(0, 7)))).toEqual(new Set(["2026-10", "2026-11"]));
    const inicio = await idsDoLivro(x.reservaId);
    const { previa, resultado } = await alterar(c, x.reservaId, { checkin: "2026-11-05", checkout: "2026-11-09" }, minutos(20), { autorId: equipe, aplicar: true });
    if (!previa.ok) throw new Error(previa.erro);
    if (!resultado.ok) throw new Error(resultado.erro);
    const A = -previa.previa.diferenca;
    expect(A).toBeGreaterThan(0);
    expect(previa.previa).toMatchObject({ rumo: "reducao", direito: "integral", noitesNovas: { inicio: "2026-11-05", fim: "2026-11-09" }, partes: [{ pagamentoId: x.pagamentoId, valor: A, rota: "pedida", aguardaLiberacao: false }] });
    // A taxa do Mercado Pago atribuída ao principal devolvido (meio centavo para cima) sai da reserva.
    const Fr = Math.floor((2 * F1 * A + B1) / (2 * B1));
    expect(previa.previa.financeiro.taxaDevolvida).toBe(Fr);
    expect(resultado).toMatchObject({ situacao: "aplicada", devolucoes: ["confirmada"] });
    const r = await c.reserva(x.reservaId);
    expect(r).toMatchObject({ checkin: "2026-11-05", checkout: "2026-11-09", valorBruto: B1 - A, taxaCanal: F1 - Fr, valorLiquido: B1 - A - (F1 - Fr) });
    // O resultado por mês e componente = o novo menos o estornado no livro; outubro ficou vazio (tudo estornado no próprio mês).
    const a = await alteracaoGravada(c, resultado.alteracaoId);
    expect(deltaDoResultado(a)).toEqual(await liquidoPorMes(x.reservaId, inicio));
    const outubro = a.resultado!.meses.find((m) => m.mes === "2026-10")!;
    expect(outubro.depois).toEqual({ bruto: 0, taxa: 0, comissao: 0, parte: 0 });
    expect(outubro.antes.bruto).toBeGreaterThan(0);
    expect((await motorEmVigor(x.reservaId)).every((l) => l.competencia.startsWith("2026-11"))).toBe(true);
    for (const e of await estornosDe(x.reservaId)) expect(e.descricao).toBe(`Estorno: Alteração ${a.id} da reserva ${x.reservaCodigo}: recalculado`);
    const totalDepois = a.resultado!.meses.reduce((t, m) => t + m.depois.bruto, 0);
    expect(totalDepois).toBe(B1 - A);
    // Rodar o motor de novo não muda nada (mesma chave e assinatura).
    const antesDeRodar = await idsDoLivro(x.reservaId);
    await aplicarMotor(db, c.org, x.reservaId, null);
    expect(await idsDoLivro(x.reservaId)).toEqual(antesDeRodar);
    // O caixa: a saída X = A − F_r, conciliada; o Mercado Pago não devolveu a taxa: a equipe informa F_r (despesa da reserva).
    const livro = async (tipo: string) => (await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, x.reservaId), eq(lancamentos.tipo, tipo as "recebimento"))));
    expect((await livro("devolucao")).map((l) => [l.montante, l.estado])).toEqual([[A - Fr, "conciliado"]]);
    const [d] = await devolucoesDa(a.id);
    expect(await registrarTaxaPerdida(db, c.org, { devolucaoId: d.id }, Fr, equipe, minutos(30))).toMatchObject({ ok: true });
    expect((await livro("despesa_empresa")).map((l) => [l.montante, l.reservaId])).toEqual([[Fr, x.reservaId]]);
    // §6.3: recebido = devido (L1 − (A − F_r) = B2 − T) e o dinheiro real (L1 − A) = o livro (recebido − taxa perdida).
    const recebimento = (await livro("recebimento")).reduce((t, l) => t + (l.montante ?? 0), 0);
    expect(recebimento).toBe(B1 - F1);
    const doRecebido = (await recebidoPorReserva(db, c.org, [x.reservaId])).get(x.reservaId)!;
    expect(doRecebido.recebido).toBe(doRecebido.devido);
    expect(doRecebido.devido).toBe(r.valorBruto! - r.taxaCanal!);
    expect(doRecebido.recebido - Fr).toBe(B1 - F1 - A);
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("segurada e depois aplicada: mais noites com valor menor; o 'Aplicar' exclui a própria reserva-pedido; agenda e preço novos não impedem; a leitura do pagamento mudada, sim", async () => {
    const x = await pagarEConfirmar(c);
    // Uma noite a mais pelo valor de antes menos um desconto combinado (digitado, com motivo).
    const valor = { origem: "digitado" as const, valor: TOTAL - 10_000, motivo: "cortesia_comercial" as const, nota: "Cortesia pela mudança" };
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16", valor }, minutos(20), { autorId: equipe });
    expect(resultado).toMatchObject({ ok: true, situacao: "segurada" });
    if (!resultado.ok) throw new Error();
    expect((await portadores())[0]).toMatchObject({ estado: "pedido", checkin: "2026-10-15", checkout: "2026-10-16" });
    const p0 = await previaDaAplicacao(db, c.org, resultado.alteracaoId, c.provedor, minutos(25));
    if (!p0.ok) throw new Error(p0.erro);
    // Durante o prazo: a leitura do Beds24 renovada e o preço da diária mudado (no SCL e na agenda do Beds24) não impedem o
    // "Aplicar" (nunca cota de novo): a prévia da aplicação é a mesma, com a mesma assinatura e o retrato da cotação gravado.
    const cotadas = async () => (await consultarDisponibilidade(db, c.org, { imovel: "403", entrada: "2026-10-20", saida: "2026-10-23", hospedes: "4" }, minutos(30))).cotacao?.total;
    const antesDoPreco = await cotadas();
    await lerAgenda(minutos(30));
    await db.update(imoveisDetalhes).set({ precoBase: 60_000 }).where(eq(imoveisDetalhes.imovelId, c.imovel));
    await db.update(beds24Calendario).set({ preco: 60_000 }).where(eq(beds24Calendario.organizacaoId, c.org));
    expect(antesDoPreco).toBeGreaterThan(0);
    expect(await cotadas()).toBeGreaterThan(antesDoPreco!);
    const p1 = await previaDaAplicacao(db, c.org, resultado.alteracaoId, c.provedor, minutos(30));
    if (!p1.ok) throw new Error(p1.erro);
    expect(p1.previa).toMatchObject({ alteracaoId: resultado.alteracaoId, rumo: "reducao", diferenca: -10_000, direito: "integral", cotacao: p0.previa.cotacao, depois: p0.previa.depois });
    expect(p1.previa.assinatura).toBe(p0.previa.assinatura);
    // A leitura do pagamento mudou depois da prévia (liberação registrada): a assinatura não confere mais.
    await liberar(c, x.pagamentoId, { quando: minutos(31) });
    expect(await aplicarAlteracaoPelaEquipe(db, c.org, resultado.alteracaoId, equipe, c.provedor, minutos(32), p1.previa.assinatura)).toMatchObject({ ok: false, codigo: "previa_mudou", erro: TEXTO_PREVIA_MUDOU_ALTERACAO });
    const p2 = await previaDaAplicacao(db, c.org, resultado.alteracaoId, c.provedor, minutos(33));
    if (!p2.ok) throw new Error(p2.erro);
    expect(await aplicarAlteracaoPelaEquipe(db, c.org, resultado.alteracaoId, equipe, c.provedor, minutos(33), p2.previa.assinatura)).toEqual({ ok: true, devolucoes: ["confirmada"] });
    expect(await c.reserva(x.reservaId)).toMatchObject({ checkout: "2026-10-16", valorBruto: TOTAL - 10_000 });
    expect((await portadores())[0].estado).toBe("cancelada");
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ situacao: "aplicada", aplicadaPor: equipe });
  });

  it("o livro protegido no meio do 'Aplicar' (gatilho de teste): a transação toda é desfeita; a reserva, a reserva-pedido e a alteração ficam como estavam; depois, aplica", async () => {
    const x = await pagarEConfirmar(c);
    const valor = { origem: "digitado" as const, valor: TOTAL - 10_000, motivo: "cortesia_comercial" as const, nota: "Cortesia pela mudança" };
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16", valor }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const p = await previaDaAplicacao(db, c.org, resultado.alteracaoId, c.provedor, minutos(25));
    if (!p.ok) throw new Error(p.erro);
    const limpar = await protegerNoMeio(x.reservaId);
    try {
      expect(await aplicarAlteracaoPelaEquipe(db, c.org, resultado.alteracaoId, equipe, c.provedor, minutos(25), p.previa.assinatura)).toEqual({ ok: false, codigo: "financeiro_movimentado", erro: TEXTO_FINANCEIRO_MOVIMENTADO });
    } finally {
      await limpar();
    }
    expect(await c.reserva(x.reservaId)).toMatchObject({ checkout: "2026-10-15", valorBruto: TOTAL, observacoes: expect.not.stringContaining("Alterada em") });
    expect((await portadores())[0].estado).toBe("pedido");
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ situacao: "segurada", aplicadaEm: null, resultado: null });
    expect(await devolucoesDa(resultado.alteracaoId)).toEqual([]);
    expect(await estornosDe(x.reservaId)).toEqual([]);
    await livroIntacto(x.reservaId);
    // Sem o gatilho, a mesma prévia aplica (nada ficou pela metade).
    expect(await aplicarAlteracaoPelaEquipe(db, c.org, resultado.alteracaoId, equipe, c.provedor, minutos(26), p.previa.assinatura)).toMatchObject({ ok: true });
    expect(await c.reserva(x.reservaId)).toMatchObject({ checkout: "2026-10-16", valorBruto: TOTAL - 10_000 });
  });

  it("retida (exemplo C): datas mudadas, valor mantido, sem devolução; os textos da prévia; só o valor retido não muda nada (sem_efeito)", async () => {
    const x = await pagarEConfirmar(c);
    // Pedido em 10/10: depois do arrependimento e do prazo integral (14 dias antes de 12/10).
    const quando = sp("2026-10-10 11:00");
    const recebidoEm = sp("2026-10-10 10:00");
    const valor = { origem: "digitado" as const, valor: TOTAL - 20_000, motivo: "acordo_com_hospede" as const, nota: "Saída um dia antes" };
    const { previa, resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-14", recebidoEm, valor }, quando, { autorId: equipe, aplicar: true });
    if (!previa.ok) throw new Error(previa.erro);
    expect(previa.previa).toMatchObject({ rumo: "reducao", direito: "nenhum", base: "fora_do_prazo", valorNovo: TOTAL, valorADevolver: 0, partes: [] });
    expect(previa.previa.avisos).toEqual(
      expect.arrayContaining([
        "Pela política (versão 1, contando da entrada de 12/10), o hóspede não recebe a diferença de R$ 200,00: o valor da reserva continua R$ 1.824,00, dividido como uma reserva normal.",
        "As noites liberadas voltam à venda; pela política o hóspede não recebe a diferença de R$ 200,00.",
      ]),
    );
    expect(previa.previa.pergunta).toContain("a diferença de R$ 200,00 não é devolvida: o valor da reserva continua R$ 1.824,00");
    expect(resultado).toMatchObject({ ok: true, situacao: "aplicada", devolucoes: [] });
    expect(await c.reserva(x.reservaId)).toMatchObject({ checkout: "2026-10-14", valorBruto: TOTAL });
    expect(total(await motorEmVigor(x.reservaId), "receita_bruta")).toBe(TOTAL);
    if (resultado.ok) expect(await devolucoesDa(resultado.alteracaoId)).toEqual([]);
    // Só o valor, retido: nada mudaria — a equipe usa a exceção para dar o desconto.
    const soValor = await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, recebidoEm, valor: { ...valor, valor: TOTAL - 30_000 } }), c.provedor, quando);
    expect(soValor).toMatchObject({ ok: false, codigo: "sem_efeito", erro: TEXTO_SEM_EFEITO });
  });

  it("exceção, SCL e sem política: a exceção pede motivo e nota; quando a SCL propõe, integral; sem política, a equipe escolhe; integral nunca se nega", async () => {
    const x = await pagarEConfirmar(c);
    const quando = sp("2026-10-10 11:00");
    const recebidoEm = sp("2026-10-10 10:00");
    const valor = { origem: "digitado" as const, valor: TOTAL - 20_000, motivo: "acordo_com_hospede" as const, nota: "Desconto combinado" };
    const base = { checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, recebidoEm, valor };
    expect(await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ ...base, decisao: "excecao" }), c.provedor, quando)).toMatchObject({ ok: false, codigo: "dados" });
    expect(await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ ...base, decisao: "integral", motivoDecisao: "x" }), c.provedor, quando)).toMatchObject({ ok: false, codigo: "dados" });
    const excecao = await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ ...base, decisao: "excecao", motivoExcecao: "saude_ou_familia", motivoDecisao: "Problema de saúde na família" }), c.provedor, quando);
    expect(excecao).toMatchObject({ ok: true, previa: { direito: "integral", base: "excecao", valorADevolver: 20_000 } });
    if (excecao.ok) expect(excecao.previa.avisos).toContain("A SCL arca com a taxa que não voltar da parte devolvida.");
    // A SCL propõe: sempre devolve.
    const empresa = await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ ...base, quemPede: "empresa", motivoEmpresa: "forca_maior", canal: null, valor: { ...valor, motivo: "alteracao_pela_scl" } }), c.provedor, quando);
    expect(empresa).toMatchObject({ ok: true, previa: { direito: "integral", base: "empresa" } });
    // Dentro do prazo integral (arrependimento), negar recusa.
    const negar = await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ ...base, recebidoEm: minutos(20), decisao: "nenhum", motivoDecisao: "teste" }), c.provedor, minutos(20));
    expect(negar).toMatchObject({ ok: false, codigo: "integral_nao_se_nega" });
    // Sem política (pagamento de antes do aceite): a equipe escolhe, com motivo.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23", email: "y@example.com", semAceite: true });
    const semPolitica = { checkin: "2026-11-20", checkout: "2026-11-22", hospedes: 4, recebidoEm: minutos(20), valor };
    expect(await previaDaAlteracao(db, c.org, y.reservaId, entradaAlteracao(semPolitica), c.provedor, minutos(20))).toMatchObject({ ok: false, codigo: "decisao_obrigatoria", escolha: expect.anything() });
    expect(await previaDaAlteracao(db, c.org, y.reservaId, entradaAlteracao({ ...semPolitica, decisao: "nenhum", motivoDecisao: "Combinado com o hóspede" }), c.provedor, minutos(20))).toMatchObject({ ok: true, previa: { direito: "nenhum", base: "sem_politica", politica: null } });
  });

  it("adiantar a estadia (exemplo C′): o prazo passa a contar da entrada nova, que é anterior à original", async () => {
    const x = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23" });
    // Em 01/10, a mesma estadia em outubro pelo mesmo valor (o motor sai de novembro e vai para outubro).
    const mantido = { origem: "mantido" as const, motivo: "acordo_com_hospede" as const, nota: "Adiantou a viagem" };
    const adiantada = await alterar(c, x.reservaId, { checkin: "2026-10-12", checkout: "2026-10-15", valor: mantido }, minutos(20), { autorId: equipe, aplicar: true });
    expect(adiantada.resultado).toMatchObject({ ok: true, situacao: "aplicada" });
    expect((await motorEmVigor(x.reservaId)).every((l) => l.competencia.startsWith("2026-10"))).toBe(true);
    // Em 09/10 o hóspede pede para sair um dia antes: pela entrada original (20/11) seria integral; pela nova (12/10), não.
    const quando = sp("2026-10-09 11:00");
    const valor = { origem: "digitado" as const, valor: TOTAL - 20_000, motivo: "acordo_com_hospede" as const, nota: "Saída um dia antes" };
    const previa = await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, recebidoEm: sp("2026-10-09 10:00"), valor }), c.provedor, quando);
    expect(previa).toMatchObject({ ok: true, previa: { entradaDaPolitica: "2026-10-12", direito: "nenhum", base: "fora_do_prazo" } });
    if (previa.ok) expect(previa.previa.avisos).toContain("A política conta da entrada de 12/10 (a atual, que é anterior à original).");
  });

  it("pagamento com mais de 78 dias: a devolução sai pelo painel do Mercado Pago ou por fora, com o aviso", async () => {
    const x = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23" });
    await envelhecer(c, x.pagamentoId, 80);
    const valor = { origem: "digitado" as const, valor: TOTAL - 20_000, motivo: "acordo_com_hospede" as const, nota: "Desconto combinado" };
    const { previa, resultado } = await alterar(c, x.reservaId, { checkout: "2026-11-22", valor }, minutos(20), { autorId: equipe, aplicar: true });
    if (!previa.ok) throw new Error(previa.erro);
    expect(previa.previa.partes).toEqual([expect.objectContaining({ rota: "fora_do_prazo", valor: 20_000 })]);
    expect(previa.previa.avisos.some((y) => y.includes("com mais de 78 dias: a devolução de R$ 200,00 sai pelo painel do Mercado Pago"))).toBe(true);
    expect(resultado).toMatchObject({ ok: true, devolucoes: ["recusada"] });
    if (resultado.ok) expect((await devolucoesDa(resultado.alteracaoId))[0]).toMatchObject({ situacao: "recusada", avisos: ["devolucao_fora_do_prazo"] });
    expect(c.provedor.chamadas.some((y) => y.metodo === "devolver")).toBe(false);
  });
});

describe("mesmo valor, só pessoas, só valor", () => {
  it("só as datas pelo mesmo valor: o motor redistribui e nenhum dinheiro se move", async () => {
    const x = await pagarEConfirmar(c);
    const inicio = await idsDoLivro(x.reservaId);
    const valor = { origem: "mantido" as const, motivo: "acordo_com_hospede" as const, nota: "Mesmas noites em outra semana" };
    const { previa, resultado } = await alterar(c, x.reservaId, { checkin: "2026-10-20", checkout: "2026-10-23", valor }, minutos(20), { autorId: equipe, aplicar: true });
    if (!previa.ok) throw new Error(previa.erro);
    expect(previa.previa).toMatchObject({ rumo: "igual", diferenca: 0, noitesNovas: { inicio: "2026-10-20", fim: "2026-10-23" } });
    expect(previa.previa.pergunta).toBe("Confirme que o hóspede aceitou por escrito: novas datas 20/10 a 23/10, 4 pessoas, mesmo valor (R$ 1.824,00). Aplicar agora? A alteração não se desfaz por aqui.");
    expect(resultado).toMatchObject({ ok: true, situacao: "aplicada", devolucoes: [] });
    expect(await c.reserva(x.reservaId)).toMatchObject({ checkin: "2026-10-20", checkout: "2026-10-23", valorBruto: TOTAL, taxaCanal: 1824 });
    expect(await portadores()).toEqual([]);
    if (resultado.ok) {
      const a = await alteracaoGravada(c, resultado.alteracaoId);
      expect(deltaDoResultado(a)).toEqual(await liquidoPorMes(x.reservaId, inicio));
      expect(await devolucoesDa(a.id)).toEqual([]);
    }
    expect(c.provedor.chamadas.some((y) => y.metodo === "devolver")).toBe(false);
  });

  it("só as pessoas: o hóspede extra muda o valor (redução integral, esperando a liberação); acima da capacidade, recusa", async () => {
    const x = await pagarEConfirmar(c);
    const menos = await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 3, recebidoEm: minutos(20) }), c.provedor, minutos(20));
    if (!menos.ok) throw new Error(menos.erro);
    expect(menos.previa).toMatchObject({ rumo: "reducao", direito: "integral", noitesNovas: null, depois: { hospedes: 3 } });
    expect(menos.previa.diferenca).toBeLessThan(0);
    expect(await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 5, recebidoEm: minutos(20) }), c.provedor, minutos(20))).toMatchObject({
      ok: false,
      codigo: "dados",
      erro: "Este apartamento recebe até 4 pessoas.",
    });
  });

  it("só o valor: 'Outro valor' com motivo e nota; 'Manter o valor' sem mudança nenhuma recusa", async () => {
    const x = await pagarEConfirmar(c);
    const base = { checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, recebidoEm: minutos(20) };
    expect(await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ ...base, valor: { origem: "digitado", valor: TOTAL - 5_000, motivo: "erro_da_scl", nota: "" } }), c.provedor, minutos(20))).toMatchObject({ ok: false, codigo: "dados" });
    expect(await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ ...base, valor: { origem: "digitado", valor: TOTAL - 5_000, motivo: "erro_da_scl", nota: "Preço errado no site" } }), c.provedor, minutos(20))).toMatchObject({
      ok: true,
      previa: { rumo: "reducao", diferenca: -5_000, origemValor: "digitado", motivoValor: "erro_da_scl" },
    });
    expect(await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ ...base, valor: { origem: "mantido", motivo: "outro", nota: "Nada" } }), c.provedor, minutos(20))).toMatchObject({ ok: false, codigo: "sem_mudanca", erro: TEXTO_SEM_MUDANCA });
    // A mesma estadia pela cotação de hoje (o mesmo preço): sem mudança.
    expect(await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao(base), c.provedor, minutos(20))).toMatchObject({ ok: false, codigo: "sem_mudanca" });
  });
});

describe("recusas", () => {
  it("datas: depois da entrada (D1), entrada antes de hoje, as duas pontas, noites ocupadas (reserva, bloqueio), leitura velha, cotação a confirmar", async () => {
    const x = await pagarEConfirmar(c);
    const e = (over: Partial<Parameters<typeof entradaAlteracao>[0]>, quando = minutos(20)) =>
      previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, recebidoEm: quando, ...over }), c.provedor, quando);
    expect(await e({ checkin: "2026-09-30" })).toMatchObject({ ok: false, codigo: "dados", erro: "A nova entrada não pode ser antes de hoje." });
    expect(await e({ checkin: "2026-10-11", checkout: "2026-10-16" })).toMatchObject({ ok: false, codigo: "duas_pontas", erro: TEXTO_DUAS_PONTAS });
    // A noite nova sem leitura atual do Beds24 (com o valor digitado, a cotação não decide): não dá para conferir.
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-09-20T12:00:00Z") }).where(eq(beds24Calendario.organizacaoId, c.org));
    expect(await e({ checkout: "2026-10-16", valor: { origem: "digitado", valor: TOTAL + 10_000, motivo: "outro", nota: "teste" } })).toMatchObject({ ok: false, codigo: "sem_leitura", erro: TEXTO_SEM_LEITURA_ALTERACAO });
    await lerAgenda(minutos(20));
    // Outra reserva nas noites novas; um bloqueio manual nelas.
    await pagarEConfirmar(c, { entrada: "2026-10-15", saida: "2026-10-17", email: "outro@example.com" });
    expect(await e({ checkout: "2026-10-16" })).toMatchObject({ ok: false, codigo: "indisponivel", erro: "Há noites já reservadas nessas datas (15/10/2026)." });
    await db.insert(bloqueios).values({ organizacaoId: c.org, imovelId: c.imovel, inicio: "2026-10-10", fim: "2026-10-12", motivo: "Manutenção", fonte: "manual" });
    expect(await e({ checkin: "2026-10-11" })).toMatchObject({ ok: false, codigo: "indisponivel", erro: "Há noites já reservadas nessas datas (11/10/2026)." });
    // Leitura velha (uma noite nova antes): sem leitura atual; com o preço pela cotação, a confirmar.
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-09-20T12:00:00Z") }).where(eq(beds24Calendario.organizacaoId, c.org));
    const velha = await e({ checkout: "2026-10-14", valor: { origem: "mantido", motivo: "outro", nota: "teste" } });
    expect(velha).toMatchObject({ ok: true });
    expect(await e({ checkout: "2026-10-14" })).toMatchObject({ ok: false, codigo: "a_confirmar" });
    // Depois do instante da entrada: a estadia já começou.
    expect(await e({ checkout: "2026-10-14", valor: { origem: "digitado", valor: TOTAL - 1000, motivo: "outro", nota: "teste" } }, sp("2026-10-12 16:00"))).toMatchObject({ ok: false, codigo: "estadia_iniciada" });
  });

  it("estado: cancelamento pedido, outra alteração segurada, pagamento da diferença em andamento, contestação; nota com CPF; assinatura velha; reserva mudada entre segurar e aplicar", async () => {
    const x = await pagarEConfirmar(c);
    const e = (over: Partial<Parameters<typeof entradaAlteracao>[0]> = {}, quando = minutos(20)) => entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, recebidoEm: quando, ...over });
    expect(await previaDaAlteracao(db, c.org, x.reservaId, e({ nota: "CPF 123.456.789-09" }), c.provedor, minutos(20))).toMatchObject({ ok: false, codigo: "dados" });
    // Assinatura velha: recusa sem gravar nada.
    expect(await segurarAlteracao(db, c.org, x.reservaId, e(), equipe, c.provedor, minutos(20), "assinatura-velha", { aplicar: false })).toMatchObject({ ok: false, codigo: "previa_mudou" });
    expect(await db.select().from(alteracoesReserva).where(eq(alteracoesReserva.organizacaoId, c.org))).toEqual([]);
    // Segurada (sem aplicar): outra alteração recusa; o cancelamento pedido também.
    const valor = { origem: "digitado" as const, valor: TOTAL - 10_000, motivo: "cortesia_comercial" as const, nota: "Cortesia" };
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16", valor }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    expect(await previaDaAlteracao(db, c.org, x.reservaId, e(), c.provedor, minutos(21))).toMatchObject({ ok: false, codigo: "ha_alteracao" });
    // A reserva mudou por fora do fluxo (a equipe editou o valor): o "Aplicar" recusa.
    await db.update(reservas).set({ valorBruto: TOTAL + 1 }).where(eq(reservas.id, x.reservaId));
    expect(await previaDaAplicacao(db, c.org, resultado.alteracaoId, c.provedor, minutos(22))).toMatchObject({ ok: false, codigo: "reserva_mudou", erro: TEXTO_RESERVA_MUDOU });
    await db.update(reservas).set({ valorBruto: TOTAL }).where(eq(reservas.id, x.reservaId));
    expect(await desistirDaAlteracao(db, c.org, resultado.alteracaoId, "Teste", equipe, c.provedor, minutos(23))).toEqual({ ok: true });
    expect(await pedir(c, x.reservaId, equipe, { recebidoEm: minutos(24), quando: minutos(24) })).toEqual({ ok: true });
    expect(await previaDaAlteracao(db, c.org, x.reservaId, e({}, minutos(25)), c.provedor, minutos(25))).toMatchObject({ ok: false, codigo: "ha_cancelamento", erro: TEXTO_HA_CANCELAMENTO });
  });

  it("dinheiro: pagamento contestado; devolução do painel do Mercado Pago sem explicação; pagamento em andamento dentro do prazo de leitura", async () => {
    const x = await pagarEConfirmar(c);
    const e = entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, recebidoEm: minutos(20) });
    await db.update(pagamentos).set({ situacao: "contestado" }).where(eq(pagamentos.id, x.pagamentoId));
    expect(await previaDaAlteracao(db, c.org, x.reservaId, e, null, minutos(20))).toMatchObject({ ok: false, codigo: "contestado" });
    await db.update(pagamentos).set({ situacao: "aprovado", devolvidoLido: 5_000 }).where(eq(pagamentos.id, x.pagamentoId));
    expect(await previaDaAlteracao(db, c.org, x.reservaId, e, null, minutos(20))).toMatchObject({ ok: false, codigo: "devolvido_fora" });
    await db.update(pagamentos).set({ devolvidoLido: 0 }).where(eq(pagamentos.id, x.pagamentoId));
    // Um Pix da diferença ainda em criação desta reserva (dentro do prazo de leitura): espera.
    await db.insert(pagamentos).values({ organizacaoId: c.org, cotacaoId: x.cotacaoId, reservaId: x.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: "scl-teste-andamento", chaveIdempotencia: "chave-teste-andamento", situacao: "criando", valor: 100, criadoEm: minutos(15), atualizadoEm: minutos(15) });
    expect(await previaDaAlteracao(db, c.org, x.reservaId, e, null, minutos(20))).toMatchObject({ ok: false, codigo: "em_andamento" });
  });

  it("o livro já movimentado (guarda): 'financeiro_movimentado'", async () => {
    const x = await pagarEConfirmar(c);
    const e = entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, recebidoEm: minutos(20) });
    // Um lançamento do motor realizado (só por fixture: antes da entrada nunca acontece).
    const [l] = await motorEmVigor(x.reservaId);
    await db.update(lancamentos).set({ estado: "realizado", dataCaixa: "2026-10-01" }).where(eq(lancamentos.id, l.id));
    expect(await previaDaAlteracao(db, c.org, x.reservaId, e, c.provedor, minutos(20))).toMatchObject({ ok: false, codigo: "financeiro_movimentado" });
  });

  it("de outra empresa: não encontrada e nada gravado", async () => {
    const x = await pagarEConfirmar(c);
    const outra = await montarCenario(db);
    const e = entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, recebidoEm: minutos(20) });
    expect(await previaDaAlteracao(db, outra.org, x.reservaId, e, outra.provedor, minutos(20))).toMatchObject({ ok: false, codigo: "nao_encontrada" });
    expect(await segurarAlteracao(db, outra.org, x.reservaId, e, null, outra.provedor, minutos(20), "x", { aplicar: true })).toMatchObject({ ok: false, codigo: "nao_encontrada" });
    expect(await db.select().from(alteracoesReserva).where(eq(alteracoesReserva.reservaId, x.reservaId))).toEqual([]);
  });
});

describe("recusas: o dinheiro de antes, o cálculo, a cobrança e a agenda (regras 4, 9, 11, 12 e 13)", () => {
  /** Uma redução (saída um dia antes por R$ 200,00 a menos) aplicada num passo: dentro do arrependimento, devolvida. */
  const reduzir = (reservaId: string, quando = minutos(20), o: { provedor?: null } = {}) =>
    alterar(c, reservaId, { checkout: "2026-10-14", valor: { origem: "digitado", valor: TOTAL - 20_000, motivo: "acordo_com_hospede", nota: "Saída um dia antes" } }, quando, { autorId: equipe, aplicar: true, ...o });
  /** Outra alteração da mesma reserva, depois (uma noite a menos e mais R$ 100,00 de desconto). */
  const outra = (reservaId: string, quando = minutos(30), provedor: typeof c.provedor | null = c.provedor) =>
    previaDaAlteracao(db, c.org, reservaId, entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-13", hospedes: 4, recebidoEm: quando, valor: { origem: "digitado", valor: TOTAL - 30_000, motivo: "acordo_com_hospede", nota: "Mais um dia antes" } }), provedor, quando);

  it("regra 4: a devolução da redução anterior esperando a liberação do pagamento recusa outra, com o valor e a previsão", async () => {
    const x = await pagarEConfirmar(c, { financeiro: { taxa: 1824, liberacaoPrevista: new Date("2026-11-06T15:00:00Z") } });
    expect((await reduzir(x.reservaId)).resultado).toMatchObject({ ok: true, situacao: "aplicada", devolucoes: ["pedida"] });
    expect(await outra(x.reservaId)).toMatchObject({
      ok: false,
      codigo: "devolucao_em_andamento",
      erro: "A devolução de R$ 200,00 espera o Mercado Pago liberar o pagamento (previsto para 06/11): depois disso a reserva pode ser alterada de novo.",
    });
  });

  it("regra 4: a devolução com a chave em voo (enviada, sem resposta final) recusa outra alteração", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    c.provedor.respostaDevolucao = "pedida";
    const { resultado } = await reduzir(x.reservaId);
    expect(resultado).toMatchObject({ ok: true, devolucoes: ["pedida"] });
    if (!resultado.ok) throw new Error();
    expect((await devolucoesDa(resultado.alteracaoId))[0]).toMatchObject({ situacao: "pedida", tentativas: 1 });
    expect(await outra(x.reservaId)).toMatchObject({ ok: false, codigo: "devolucao_em_andamento", erro: TEXTO_DEVOLUCAO_EM_ANDAMENTO });
  });

  it("regra 4: a devolução que o Mercado Pago fez a menor, sem o restante pedido nem registrado, recusa outra alteração", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    c.provedor.devolverAMenos(15_000);
    const { resultado } = await reduzir(x.reservaId);
    if (!resultado.ok) throw new Error(resultado.erro);
    expect((await devolucoesDa(resultado.alteracaoId))[0]).toMatchObject({ situacao: "confirmada", valorConfirmado: 15_000, avisos: expect.arrayContaining(["devolucao_a_menor"]) });
    expect(await outra(x.reservaId)).toMatchObject({ ok: false, codigo: "devolucao_em_andamento", erro: TEXTO_DEVOLUCAO_EM_ANDAMENTO });
  });

  it("regra 4 (D12): a devolução pedida e ainda não enviada (a fase 2 não chegou ao Mercado Pago) recusa a segunda redução, sem erro do banco", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    // Sem provedor na fase 2: a devolução fica pedida, nunca enviada (tentativas 0, sem código).
    const { resultado } = await reduzir(x.reservaId, minutos(20), { provedor: null });
    expect(resultado).toMatchObject({ ok: true, situacao: "aplicada", devolucoes: ["pedida"] });
    if (!resultado.ok) throw new Error();
    expect((await devolucoesDa(resultado.alteracaoId))[0]).toMatchObject({ situacao: "pedida", tentativas: 0, ultimoCodigo: null });
    expect(await outra(x.reservaId, minutos(30), null)).toMatchObject({ ok: false, codigo: "devolucao_em_andamento", erro: TEXTO_DEVOLUCAO_EM_ANDAMENTO });
    // O "segurar e aplicar" recusa do mesmo jeito (nunca o índice de uma pedida por pagamento estourando).
    const e = entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-13", hospedes: 4, recebidoEm: minutos(30), valor: { origem: "digitado", valor: TOTAL - 30_000, motivo: "acordo_com_hospede", nota: "Mais um dia antes" } });
    expect(await segurarAlteracao(db, c.org, x.reservaId, e, equipe, null, minutos(30), "0123456789abcdef", { aplicar: true })).toMatchObject({ ok: false, codigo: "devolucao_em_andamento" });
    expect(await db.select().from(alteracoesReserva).where(eq(alteracoesReserva.reservaId, x.reservaId))).toHaveLength(1);
    // Pedida pela rotina (o Mercado Pago confirma), a reserva pode ser alterada de novo.
    expect(await tentarDevolucao(db, c.org, (await devolucoesDa(resultado.alteracaoId))[0].id, c.provedor, minutos(31))).toBe("confirmada");
    expect(await outra(x.reservaId, minutos(32))).toMatchObject({ ok: true, previa: { rumo: "reducao", diferenca: -10_000 } });
  });

  it("regra 11: sem contrato de gestão vigente na nova entrada, 'sem_calculo' com o motivo", async () => {
    const x = await pagarEConfirmar(c);
    // O contrato termina no fim de outubro: a estadia mudada para novembro não teria quem dividir.
    await db.update(contratos).set({ fim: "2026-10-31" }).where(eq(contratos.imovelId, c.imovel));
    const mantido = { origem: "mantido" as const, motivo: "acordo_com_hospede" as const, nota: "Mesma estadia em novembro" };
    const r = await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ checkin: "2026-11-20", checkout: "2026-11-23", hospedes: 4, recebidoEm: minutos(20), valor: mantido }), c.provedor, minutos(20));
    expect(r).toMatchObject({ ok: false, codigo: "sem_calculo", erro: "Nas novas datas o financeiro não calcula a reserva (sem contrato de gestão vigente na nova entrada): resolva antes de alterar." });
    // Em outubro (com o contrato), a mesma mudança passa.
    expect(await previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ checkin: "2026-10-20", checkout: "2026-10-23", hospedes: 4, recebidoEm: minutos(20), valor: mantido }), c.provedor, minutos(20))).toMatchObject({ ok: true });
  });

  it("regra 12: a reserva em conferência recusa ('em_conferencia'); dada por resolvida, passa", async () => {
    const x = await pagarEConfirmar(c);
    const e = entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, recebidoEm: minutos(20) });
    await db.update(reservas).set({ divergenciaEm: minutos(10), divergenciaCalculo: "teste" }).where(eq(reservas.id, x.reservaId));
    expect(await previaDaAlteracao(db, c.org, x.reservaId, e, c.provedor, minutos(20))).toMatchObject({ ok: false, codigo: "em_conferencia", erro: TEXTO_EM_CONFERENCIA });
    await db.update(reservas).set({ conferenciaResolvidaEm: minutos(15) }).where(eq(reservas.id, x.reservaId));
    expect(await previaDaAlteracao(db, c.org, x.reservaId, e, c.provedor, minutos(20))).toMatchObject({ ok: true });
  });

  it("regra 13: no aumento, sem o pagamento pelo site poder cobrar, 'sem_cobranca' com o motivo; a redução não precisa cobrar", async () => {
    const x = await pagarEConfirmar(c);
    const aumento = entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, recebidoEm: minutos(20) });
    expect(await previaDaAlteracao(db, c.org, x.reservaId, aumento, null, minutos(20))).toMatchObject({
      ok: false,
      codigo: "sem_cobranca",
      erro: "O pagamento pelo site não pode cobrar agora (o pagamento no site está desligado): a diferença não pode ser paga pelo site.",
    });
    const config = await salvarConfigPagamentoSite(db, c.org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: false, cartao: true }, null);
    if (!config.ok) throw new Error();
    expect(await previaDaAlteracao(db, c.org, x.reservaId, aumento, c.provedor, minutos(20))).toMatchObject({
      ok: false,
      codigo: "sem_cobranca",
      erro: `O pagamento pelo site não pode cobrar agora (${TEXTO_SEM_COBRANCA.desligado_no_painel}): a diferença não pode ser paga pelo site.`,
    });
    const reducao = entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-14", hospedes: 4, recebidoEm: minutos(20) });
    expect(await previaDaAlteracao(db, c.org, x.reservaId, reducao, c.provedor, minutos(20))).toMatchObject({ ok: true, previa: { rumo: "reducao" } });
  });

  it("regra 9: as novas noites ocupadas (agenda do Beds24, outra reserva, bloqueio) recusam pela cotação, com a noite", async () => {
    const x = await pagarEConfirmar(c);
    const e = (over: Partial<Parameters<typeof entradaAlteracao>[0]>) =>
      previaDaAlteracao(db, c.org, x.reservaId, entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, recebidoEm: minutos(20), ...over }), c.provedor, minutos(20));
    // A agenda do Beds24 fechada na noite nova (leitura atual).
    await db.update(beds24Calendario).set({ livres: 0 }).where(and(eq(beds24Calendario.organizacaoId, c.org), eq(beds24Calendario.data, "2026-10-15")));
    const beds24 = await e({ checkout: "2026-10-16" });
    expect(beds24).toMatchObject({ ok: false, codigo: "indisponivel" });
    await db.update(beds24Calendario).set({ livres: 1 }).where(and(eq(beds24Calendario.organizacaoId, c.org), eq(beds24Calendario.data, "2026-10-15")));
    // Outra reserva do site nas noites novas.
    await pagarEConfirmar(c, { entrada: "2026-10-15", saida: "2026-10-17", email: "outro@example.com" });
    const reserva = await e({ checkout: "2026-10-16" });
    expect(reserva).toMatchObject({ ok: false, codigo: "indisponivel" });
    // Um bloqueio manual na noite nova de antes.
    await db.insert(bloqueios).values({ organizacaoId: c.org, imovelId: c.imovel, inicio: "2026-10-11", fim: "2026-10-12", motivo: "Manutenção", fonte: "manual" });
    const bloqueio = await e({ checkin: "2026-10-11" });
    expect(bloqueio).toMatchObject({ ok: false, codigo: "indisponivel" });
    // A cotação das datas novas (regra 9) já confere a ocupação: recusa antes da conferência das noites acrescentadas.
    expect([beds24, reserva, bloqueio].map((r) => (r.ok ? null : r.erro))).toEqual([
      "Há noites já reservadas nessas datas (15/10/2026).",
      "Há noites já reservadas nessas datas (15/10/2026).",
      "Há noites já reservadas nessas datas (11/10/2026).",
    ]);
    expect(await semDadosDoHospede(db)).toEqual([]);
  });
});

describe("aprovação da diferença: tardia, sem reserva e a outra tentativa", () => {
  async function seguradaComPix(o: { entrada?: string; saida?: string; checkout?: string; email?: string } = {}) {
    const x = await pagarEConfirmar(c, { liberar: true, entrada: o.entrada, saida: o.saida, email: o.email });
    const { resultado } = await alterar(c, x.reservaId, { checkout: o.checkout ?? "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const pix = await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25), aprovar: false });
    const holdAte = (await alteracaoGravada(c, resultado.alteracaoId)).holdAte!;
    return { x, alteracaoId: resultado.alteracaoId, pix, holdAte };
  }
  /** Depois do prazo e da carência: a rotina vence a alteração e cancela o Pix dela no Mercado Pago. */
  const vencerECancelar = async (s: { pix: { pagamentoId: string }; holdAte: Date }) => {
    const depois = new Date(s.holdAte.getTime() + 20 * 60_000);
    await conferirPendentes(db, c.org, c.provedor, depois, { forcar: true });
    expect((await c.tentativa(s.pix.pagamentoId)).situacao).toBe("cancelado");
    return depois;
  };
  const aprovarEm = async (pix: { pagamentoId: string; idProvedor: string }, quando: Date) => {
    c.provedor.aprovar(pix.idProvedor, { taxa: 528 });
    return conferirTentativa(db, c.org, pix.pagamentoId, c.provedor, quando, { origem: "rotina", forcar: true });
  };

  it("depois do prazo e da carência, com as noites livres e a leitura atual do Beds24: aplica (tardia)", async () => {
    const s = await seguradaComPix();
    const depois = new Date(s.holdAte.getTime() + 20 * 60_000);
    await lerAgenda(depois);
    await aprovarEm(s.pix, depois);
    expect(await c.tentativa(s.pix.pagamentoId)).toMatchObject({ desfecho: "alteracao", desfechoMotivo: "alteracao_tardia" });
    expect(await alteracaoGravada(c, s.alteracaoId)).toMatchObject({ situacao: "aplicada", aplicadaTardia: true });
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ checkout: "2026-10-16", valorBruto: 235200 });
  });

  it("tardia sem leitura atual: sem reserva ('alteracao_sem_leitura'); noites tomadas: 'alteracao_noites_ocupadas'", async () => {
    const s = await seguradaComPix();
    const depois = new Date(s.holdAte.getTime() + 37 * 3_600_000);
    await aprovarEm(s.pix, depois);
    expect(await c.tentativa(s.pix.pagamentoId)).toMatchObject({ desfecho: null, motivoSemReserva: "alteracao_sem_leitura" });
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ checkout: "2026-10-15", valorBruto: TOTAL });
    expect(await alteracaoGravada(c, s.alteracaoId)).toMatchObject({ situacao: "expirada" });
  });

  it("tardia com as noites novas de outro hóspede: sem reserva, a reserva fica como estava", async () => {
    const s = await seguradaComPix();
    const depois = new Date(s.holdAte.getTime() + 20 * 60_000);
    await lerAgenda(depois);
    // A rotina venceu a alteração (sem chamar o provedor para o Pix ainda pendente) e as noites foram vendidas.
    await expirarAlteracoesVencidas(db, c.org, depois);
    await pagarEConfirmar(c, { entrada: "2026-10-15", saida: "2026-10-17", email: "outro@example.com", quando: depois });
    await aprovarEm(s.pix, new Date(depois.getTime() + 10 * 60_000));
    expect((await c.tentativa(s.pix.pagamentoId)).motivoSemReserva).toMatch(/^alteracao_noites_ocupadas/);
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ checkout: "2026-10-15", valorBruto: TOTAL });
  });

  it("com um pedido de cancelamento aberto: 'alteracao_reserva_mudou'; reserva cancelada depois do vencimento: 'cancelada_pela_equipe'", async () => {
    const s = await seguradaComPix();
    expect(await pedir(c, s.x.reservaId, equipe, { recebidoEm: minutos(26), quando: minutos(26) })).toEqual({ ok: true });
    await aprovarEm(s.pix, minutos(27));
    expect(await c.tentativa(s.pix.pagamentoId)).toMatchObject({ desfecho: null, motivoSemReserva: "alteracao_reserva_mudou" });
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ checkout: "2026-10-15", valorBruto: TOTAL });

    const t = await seguradaComPix({ entrada: "2026-10-20", saida: "2026-10-23", checkout: "2026-10-24", email: "t@example.com" });
    const tarde = await vencerECancelar(t);
    const canc = await cancelar(c, t.x.reservaId, entradaPadrao({ recebidoEm: tarde, canal: "whatsapp" }), equipe, tarde);
    expect(canc.resultado).toMatchObject({ ok: true });
    // O Mercado Pago aprova o Pix cancelado (corrida): sem reserva, pela equipe.
    await aprovarEm(t.pix, new Date(tarde.getTime() + 60_000));
    expect(await c.tentativa(t.pix.pagamentoId)).toMatchObject({ desfecho: null, motivoSemReserva: "cancelada_pela_equipe" });
  });

  it("outra alteração criada depois (A → B): a aprovação tardia da A não aplica", async () => {
    const s = await seguradaComPix();
    const depois = await vencerECancelar(s);
    await lerAgenda(depois);
    const valor = { origem: "digitado" as const, valor: TOTAL - 1_000, motivo: "cortesia_comercial" as const, nota: "Cortesia" };
    const b = await alterar(c, s.x.reservaId, { checkout: "2026-10-14", valor }, depois, { autorId: equipe });
    expect(b.resultado).toMatchObject({ ok: true, situacao: "segurada" });
    if (b.resultado.ok) expect(await desistirDaAlteracao(db, c.org, b.resultado.alteracaoId, "Teste", equipe, c.provedor, depois)).toEqual({ ok: true });
    await aprovarEm(s.pix, new Date(depois.getTime() + 60_000));
    expect(await c.tentativa(s.pix.pagamentoId)).toMatchObject({ desfecho: null, motivoSemReserva: "alteracao_reserva_mudou" });
  });

  it("o livro já movimentado na aprovação (a guarda antes de escrever): sem reserva com o motivo; o pagamento fica decidido, a reserva e a reserva-pedido intactas", async () => {
    const s = await seguradaComPix();
    const [l] = await motorEmVigor(s.x.reservaId);
    await db.update(lancamentos).set({ estado: "realizado", dataCaixa: "2026-10-01" }).where(eq(lancamentos.id, l.id));
    await aprovarEm(s.pix, minutos(30));
    expect(await c.tentativa(s.pix.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "alteracao_nao_aplicada:financeiro_movimentado" });
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ checkout: "2026-10-15", valorBruto: TOTAL });
    expect(await alteracaoGravada(c, s.alteracaoId)).toMatchObject({ situacao: "segurada" });
    expect((await portadores())[0].estado).toBe("pedido");
  });

  it("o livro protegido no meio da aplicação pela aprovação (gatilho de teste): o savepoint desfaz só a aplicação; o pagamento fica aprovado e decidido, sem reserva", async () => {
    const s = await seguradaComPix();
    const limpar = await protegerNoMeio(s.x.reservaId);
    try {
      await aprovarEm(s.pix, minutos(30));
    } finally {
      await limpar();
    }
    // A leitura da aprovação ficou (nunca "pendente" com o dinheiro aprovado); a aplicação, não.
    expect(await c.tentativa(s.pix.pagamentoId)).toMatchObject({ situacao: "aprovado", taxa: 528, desfecho: null, motivoSemReserva: "alteracao_nao_aplicada:financeiro_movimentado" });
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ checkout: "2026-10-15", valorBruto: TOTAL, taxaCanal: 1824 });
    expect(await alteracaoGravada(c, s.alteracaoId)).toMatchObject({ situacao: "segurada", aplicadaEm: null });
    expect((await portadores())[0].estado).toBe("pedido");
    expect(await estornosDe(s.x.reservaId)).toEqual([]);
    await livroIntacto(s.x.reservaId);
  });

  it("valor diferente da diferença: 'valor_divergente'", async () => {
    const s = await seguradaComPix();
    await db.update(alteracoesReserva).set({ diferenca: 52_801 }).where(eq(alteracoesReserva.id, s.alteracaoId));
    await aprovarEm(s.pix, minutos(30));
    expect(await c.tentativa(s.pix.pagamentoId)).toMatchObject({ desfecho: null, motivoSemReserva: "valor_divergente" });
  });
});

describe("a reserva-pedido (datas seguradas de uma alteração)", () => {
  it("não se confirma nem se cancela pela ficha; o bloqueio manual vence antes as alterações do imóvel", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const [portador] = await portadores();
    const conf = await confirmarReserva(db, c.org, portador.id, equipe, minutos(21));
    expect(conf).toMatchObject({ ok: false });
    expect(JSON.stringify(conf)).toContain("elas não se confirmam por aqui");
    const canc = await tentarCancelarReserva(db, c.org, portador.id, equipe, { agora: minutos(21) });
    expect(canc).toMatchObject({ ok: false });
    expect(JSON.stringify(canc)).toContain("elas somem sozinhas");
    expect((await portadores())[0].estado).toBe("pedido");
  });
});

describe("concorrência", () => {
  it("duas alterações seguradas ao mesmo tempo na mesma reserva: uma passa, a outra recusa", async () => {
    const x = await pagarEConfirmar(c);
    const valor = { origem: "digitado" as const, valor: TOTAL - 10_000, motivo: "cortesia_comercial" as const, nota: "Cortesia" };
    const e1 = entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, recebidoEm: minutos(20), valor });
    const e2 = entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 3, recebidoEm: minutos(20), valor });
    const [p1, p2] = await Promise.all([previaDaAlteracao(db, c.org, x.reservaId, e1, c.provedor, minutos(20)), previaDaAlteracao(db, c.org, x.reservaId, e2, c.provedor, minutos(20))]);
    if (!p1.ok || !p2.ok) throw new Error("prévia");
    const rs = await Promise.all([
      segurarAlteracao(db, c.org, x.reservaId, e1, equipe, c.provedor, minutos(21), p1.previa.assinatura),
      segurarAlteracao(db, c.org, x.reservaId, e2, equipe, c.provedor, minutos(21), p2.previa.assinatura),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toMatchObject({ ok: false, codigo: expect.stringMatching(/^(ha_alteracao|ocupado|previa_mudou)$/) });
    expect(await db.select().from(alteracoesReserva).where(and(eq(alteracoesReserva.reservaId, x.reservaId), eq(alteracoesReserva.situacao, "segurada")))).toHaveLength(1);
    expect(await db.select().from(reservas).where(and(eq(reservas.fonte, "alteracao"), isNull(reservas.canceladaEm), eq(reservas.organizacaoId, c.org)))).toHaveLength(1);
  });

  it("segurar a alteração e um visitante do site segurando a mesma noite ao mesmo tempo: a trava do imóvel põe os dois em fila, um recusa e a noite fica com um só", async () => {
    const x = await pagarEConfirmar(c);
    const cotacao = await criarCotacao(db, c.org, { imovel: "403", entrada: "2026-10-15", saida: "2026-10-17", hospedes: "2" }, minutos(10));
    if (!cotacao.ok) throw new Error(cotacao.erro);
    const e = entradaAlteracao({ checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, recebidoEm: minutos(20) });
    const p = await previaDaAlteracao(db, c.org, x.reservaId, e, c.provedor, minutos(20));
    if (!p.ok) throw new Error(p.erro);
    const [alteracao, site] = await Promise.all([
      segurarAlteracao(db, c.org, x.reservaId, e, equipe, c.provedor, minutos(21), p.previa.assinatura),
      segurarDatas(db, c.org, cotacao.cotacao.codigo, { nome: "Outra Pessoa Fictícia", email: "outro@example.com", telefone: "(21) 98888-0000" }, minutos(21)),
    ]);
    expect([alteracao.ok, site.ok].filter(Boolean)).toHaveLength(1);
    if (!alteracao.ok) expect(alteracao.codigo).toMatch(/^(indisponivel|previa_mudou|ocupado)$/);
    // Na noite de 15/10, um só pedido (a reserva-pedido da alteração ou o do visitante).
    const pedidos = await db
      .select({ fonte: reservas.fonte })
      .from(reservas)
      .where(and(eq(reservas.organizacaoId, c.org), eq(reservas.estado, "pedido"), sql`${reservas.checkin} <= '2026-10-15' and ${reservas.checkout} > '2026-10-15'`));
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].fonte).toBe(alteracao.ok ? "alteracao" : "site");
  });
});
