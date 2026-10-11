/**
 * M8.2c — cancelamento de reserva paga pelo site, pela política: a decisão (política aceita, momento do pedido, quem
 * cancela, exceção, sem política), as recusas, as três fases e as travas, o acerto no livro (resultado na hora, caixa na
 * devolução), a parte já repassada (espelhos no mês do cancelamento, desconto), o pagamento velho, o já devolvido no
 * painel do Mercado Pago, a idempotência e a varredura de dados pessoais. Dados fictícios; provedor falso.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditoria, cancelamentosReserva, contratos, cotacoes, devolucoesPagamento, imoveis, imoveisDetalhes, lancamentos, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { aplicarMotor } from "@/financeiro/aplicar";
import { lerConfigPagamentoSite, salvarConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { lancar, saldoAcerto } from "@/financeiro/ledger";
import { pedirCancelamentoPeloHospede } from "@/hospede/cancelamento";
import { lancamentoEmConferencia, lancamentoEmVigor } from "@/portal/posse";
import { partesDoProprietario } from "@/repasses/extrato";
import { repasseAPagarDaReservaDados } from "@/repasses/recebimentos";
import { gerarAntecipado, preverRepasses } from "@/repasses/repasses";
import { resolverConferencia, tentarCancelarReserva } from "@/reservas/repositorio";
import { acertarCaixa, acertarResultado, chaveSaidaDevolucao } from "./acerto-cancelamento";
import { cancelamentoDaReserva, momentosDoCancelamento } from "./cancelamento-painel";
import {
  cancelarReservaPaga,
  descartarPedidoDeCancelamento,
  diaHoraBr,
  marcarHospedeAvisado,
  marcarOtaLiberada,
  previaDoCancelamento,
  TEXTO_DEVOLVIDO_EM_PARTE,
  TEXTO_EMPRESA_SEMPRE_INTEGRAL,
  TEXTO_FORA_SEM_VALOR,
  TEXTO_INTEGRAL_NAO_SE_NEGA,
  TEXTO_OCUPADO,
  TEXTO_PREVIA_MUDOU,
  TEXTO_SEM_LEITURA,
  TEXTO_SEM_POLITICA,
} from "./cancelamento";
import { conferirTentativa } from "./conferencia";
import { avisosDePagamento, pagamentosDaReserva } from "./consultas";
import { confirmarDevolucaoVistaNoProvedor, ERRO_POR_FORA_CARTAO, ERRO_POR_FORA_SEM_CONFERIR, registrarDevolucaoPorFora, registrarRecusaNoPainel, registrarTaxaPerdida } from "./devolucao";
import { ErroProvedor } from "./provedor";
import { conferirPendentes } from "./rotina";
import { travarCotacao } from "./travas";
import {
  AGORA,
  type Cenario,
  cancelar,
  EMAIL_HOSPEDE,
  entradaPadrao,
  env,
  envelhecer,
  liberar,
  minutos,
  montarCenario,
  NOME_HOSPEDE,
  pagarEConfirmar,
  pedir,
  repassar,
  semDadosDoHospede,
  TOTAL,
  usuarioDeTeste,
} from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});
// Dados pessoais (§10): depois de cada fluxo, nem o e-mail, nem o telefone, nem o nome do hóspede nas tabelas do
// pagamento, da devolução, do cancelamento, do livro e na auditoria (fora a da reserva criada no M8.1).
afterEach(async () => {
  expect(await semDadosDoHospede(db)).toEqual([]);
});

/** Um instante em São Paulo ("2026-10-10 14:00"). */
const sp = (dataHora: string) => new Date(`${dataHora.replace(" ", "T")}:00-03:00`);
const dia = (n: number) => new Date(AGORA.getTime() + n * 86_400_000);
const cancelamentoDe = async (reservaId: string) => (await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, reservaId)))[0];
const devolucaoDe = async (pagamentoId: string) => (await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, pagamentoId)))[0];
const doLivro = (reservaId: string) => db.select().from(lancamentos).where(eq(lancamentos.reservaId, reservaId));
const motorEmVigor = (reservaId: string) =>
  db
    .select()
    .from(lancamentos)
    .where(and(eq(lancamentos.reservaId, reservaId), eq(lancamentos.origem, "motor"), isNull(lancamentos.estornoDe), sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`));
const pedidosDeDevolucao = () => c.provedor.chamadas.filter((x) => x.metodo === "devolver");
const emConferencia = async (reservaId: string) =>
  (await db.select({ id: lancamentos.id }).from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), lancamentoEmVigor(db), lancamentoEmConferencia()))).length > 0;
/** Pedido do hóspede pela equipe (WhatsApp), recebido em `recebidoEm`, já registrado. */
const comPedido = async (reservaId: string, recebidoEm: Date, quando: Date = recebidoEm) => {
  const r = await pedir(c, reservaId, equipe, { recebidoEm, quando });
  expect(r).toEqual({ ok: true });
};
/** Reserva com entrada em 20/11 (prazo integral até 06/11, com a política de 14 dias). */
const longe = { entrada: "2026-11-20", saida: "2026-11-23" };

describe("cancelamento pela política: devolução integral (M8.2c)", () => {
  it("Pix pela política: reserva e cotação canceladas, motor estornado, devolução pedida e confirmada pela leitura; sem liberação, nada a lançar no caixa; aviso da taxa", async () => {
    const x = await pagarEConfirmar(c, longe);
    expect((await motorEmVigor(x.reservaId)).length).toBe(4);
    const entrada = entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp", nota: "WhatsApp da empresa, 12h30" });
    const p = await previaDoCancelamento(db, c.org, x.reservaId, entrada, c.provedor, minutos(60));
    if (!p.ok) throw new Error(p.erro);
    expect(p.previa).toMatchObject({ direito: "integral", base: "prazo", rota: "pedida", valorPago: TOTAL, valorADevolver: TOTAL, valorRetido: 0, politica: { versao: 1, diasReembolsoIntegral: 14, arrependimentoAteEntrada: true } });
    expect(p.previa.decisao).toMatchObject({ calculado: "integral", integralAte: "2026-11-06", arrependimentoAte: "2026-10-08" });
    expect(p.previa.componentes).toMatchObject({ taxa: 1824, jaRepassada: [], perdaDoProprietario: 0, ajustes: [] });
    expect(p.previa.componentes.comissao + p.previa.componentes.parteProprietario).toBe(TOTAL - 1824);
    expect(p.previa.assinatura).toMatch(/^[0-9a-f]{16}$/);
    expect(p.previa.pergunta).toContain(`devolver ao hóspede R$ 1.824,00 (o valor integral pago) pelo Mercado Pago?`);
    expect(p.previa.pergunta).toContain("Base: pedido dentro do prazo de reembolso integral.");
    expect(p.previa.avisos.at(-1)).toMatch(/^Leitura do Mercado Pago de 01\/10 às 13:00: aprovado\.$/);
    const r = await cancelarReservaPaga(db, c.org, x.reservaId, entrada, equipe, c.provedor, minutos(61), p.previa.assinatura);
    expect(r).toMatchObject({ ok: true, direito: "integral", devolucao: "confirmada" });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "cancelada", valorRetido: null, confirmadaEm: null });
    expect((await c.cotacao(x.cotacaoId)).estado).toBe("cancelada");
    const canc = await cancelamentoDe(x.reservaId);
    expect(canc).toMatchObject({ situacao: "cancelada", canal: "whatsapp", quemCancela: "hospede", direito: "integral", base: "prazo", calculado: "integral", politicaVersao: 1, diasReembolsoIntegral: 14, arrependimentoAteEntrada: true, integralAte: "2026-11-06", valorPago: TOTAL, valorADevolver: TOTAL, espelhado: false, pedidoPor: equipe, canceladaPor: equipe });
    expect(canc.resultadoLancadoEm).not.toBeNull();
    expect(canc.caixaLancadoEm).not.toBeNull();
    // Nada movimentado: o motor estornou os 4 lançamentos (no próprio mês), sem espelhos.
    expect(await motorEmVigor(x.reservaId)).toEqual([]);
    const livro = await doLivro(x.reservaId);
    expect(livro.filter((l) => l.origem === "estorno")).toHaveLength(4);
    expect(livro.filter((l) => l.origem === "cancelamento")).toEqual([]);
    // A devolução do cancelamento: confirmada pela leitura, sem saída de caixa (nada tinha entrado).
    const dev = await devolucaoDe(x.pagamentoId);
    expect(dev).toMatchObject({ origem: "cancelamento", cancelamentoId: canc.id, situacao: "confirmada", confirmadaPor: "leitura", valor: TOTAL, saidaLancamentoId: null, motivo: `Cancelamento da reserva ${x.reservaCodigo} pela política` });
    expect(livro.filter((l) => l.tipo === "devolucao")).toEqual([]);
    const t = await c.tentativa(x.pagamentoId);
    expect(t).toMatchObject({ situacao: "devolvido", desfecho: "reserva" });
    expect(t.avisos).toContain("taxa_perdida_desconhecida");
    expect(t.avisos).not.toContain("devolvido_por_fora");
    expect(t.devolvidoVistoEm).not.toBeNull();
    expect(await saldoAcerto(db, c.org, { proprietarioId: c.dono })).toBe(0);
    expect(await emConferencia(x.reservaId)).toBe(false);
    // Auditoria: a reserva cancelada pela política e a decisão, sem notas.
    const acoes = (await db.select({ acao: auditoria.acao, mudancas: auditoria.mudancas }).from(auditoria).where(eq(auditoria.organizacaoId, c.org))).map((a) => a.acao);
    expect(acoes).toEqual(expect.arrayContaining(["reserva.cancelar", "pagamento.cancelamento", "pagamento.cancelamento_resultado", "pagamento.devolver", "pagamento.cancelamento_caixa", "pagamento.devolucao_confirmada"]));
    expect(JSON.stringify(await db.select().from(auditoria))).not.toContain("12h30");
    // A taxa que não voltou: despesa da empresa com a reserva, chave por devolução.
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 1824, equipe, minutos(70))).toEqual({ ok: true });
    const [despesa] = (await doLivro(x.reservaId)).filter((l) => l.tipo === "despesa_empresa");
    expect(despesa).toMatchObject({ valor: -1824, montante: 1824, reservaId: x.reservaId, chaveOrigem: `mercadopago:${x.pagamentoId}:devolucao:${dev.id}:taxa_perdida` });
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("liberado antes de cancelar: a devolução confirmada lança a saída do líquido que entrou (conciliada, no dia da leitura)", async () => {
    const x = await pagarEConfirmar(c, longe);
    await liberar(c, x.pagamentoId, { data: "2026-10-01", quando: minutos(10) });
    const { resultado } = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "imovel_sem_condicoes" }), equipe, minutos(60));
    expect(resultado).toMatchObject({ ok: true, direito: "integral", devolucao: "confirmada" });
    const dev = await devolucaoDe(x.pagamentoId);
    const [saida] = (await doLivro(x.reservaId)).filter((l) => l.tipo === "devolucao");
    expect(saida).toMatchObject({ id: dev.saidaLancamentoId, valor: 0, efeitoSaldo: 0, montante: TOTAL - 1824, estado: "conciliado", origem: "sincronizacao", dataCaixa: "2026-10-01", chaveOrigem: chaveSaidaDevolucao(x.pagamentoId, dev.id) });
    expect(saida.descricao).toBe(`Reserva ${x.reservaCodigo} — devolução de R$ 1.824,00 ao hóspede (pelo Mercado Pago em 01/10/2026): sai o líquido de R$ 1.805,76 que entrou; a taxa que não voltou é despesa da empresa`);
    // A SCL cancela: a base é a empresa, integral a qualquer momento; o proprietário não perde nada (o hóspede teria o integral).
    expect(await cancelamentoDe(x.reservaId)).toMatchObject({ base: "empresa", quemCancela: "empresa", motivoEmpresa: "imovel_sem_condicoes", canal: null });
  });

  it("cartão parcelado com juros: devolve o pago (com os juros); o teto da taxa que não voltou é a taxa mais os juros", async () => {
    c.provedor.jurosCartao = 9_000;
    const x = await pagarEConfirmar(c, { ...longe, forma: "cartao", parcelas: 3 });
    expect((await c.tentativa(x.pagamentoId)).valorPago).toBe(TOTAL + 9_000);
    const { previa, resultado } = await cancelar(c, x.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "email" }), equipe, minutos(60));
    expect(previa).toMatchObject({ ok: true, previa: { valorADevolver: TOTAL + 9_000, valorPago: TOTAL + 9_000 } });
    expect(resultado).toMatchObject({ ok: true, devolucao: "confirmada" });
    expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ valor: TOTAL + 9_000, situacao: "confirmada" });
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 1824 + 9_001, equipe, minutos(70))).toMatchObject({ ok: false, erro: expect.stringContaining("mais os juros do parcelamento (R$ 108,24)") });
    expect(await registrarTaxaPerdida(db, c.org, x.pagamentoId, 1824 + 9_000, equipe, minutos(70))).toEqual({ ok: true });
  });
});

describe("cancelamento sem devolução: valor retido (M8.2c)", () => {
  /** Reserva de 12/10, pedido em 10/10 (depois do arrependimento e do prazo): sem devolução. */
  async function retida(o: { liberar?: boolean } = {}) {
    const x = await pagarEConfirmar(c);
    if (o.liberar) await liberar(c, x.pagamentoId, { data: "2026-10-01", quando: minutos(10) });
    const antes = (await motorEmVigor(x.reservaId)).map((l) => l.id).sort();
    const { previa, resultado } = await cancelar(c, x.reservaId, entradaPadrao({ recebidoEm: sp("2026-10-10 10:00"), canal: "email" }), equipe, sp("2026-10-10 11:00"));
    return { ...x, antes, previa, resultado };
  }

  it("valor retido = o pago; o motor fica como estava (mesmos lançamentos); fora da conferência; resultado e caixa lançados na hora; sem devolução", async () => {
    const x = await retida();
    expect(x.previa).toMatchObject({ ok: true, previa: { direito: "nenhum", base: "fora_do_prazo", rota: "nenhuma", valorRetido: TOTAL, valorADevolver: 0 } });
    if (!x.previa.ok) throw new Error();
    expect(x.previa.previa.pergunta).toContain(`Cancelar a reserva ${x.reservaCodigo} sem devolução? Base: pedido depois do prazo de reembolso integral. O valor pago (R$ 1.824,00) fica retido`);
    expect(x.previa.previa.pergunta).toContain("depois da data de entrada original (12/10)");
    expect(x.resultado).toMatchObject({ ok: true, direito: "nenhum", devolucao: null });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "cancelada", valorRetido: TOTAL });
    expect((await motorEmVigor(x.reservaId)).map((l) => l.id).sort()).toEqual(x.antes);
    expect(await emConferencia(x.reservaId)).toBe(false);
    const canc = await cancelamentoDe(x.reservaId);
    expect(canc).toMatchObject({ direito: "nenhum", base: "fora_do_prazo", valorADevolver: 0, espelhado: false });
    expect(canc.resultadoLancadoEm).not.toBeNull();
    expect(canc.caixaLancadoEm).not.toBeNull();
    expect(await devolucaoDe(x.pagamentoId)).toBeUndefined();
    expect(pedidosDeDevolucao()).toEqual([]);
    // A parte fica a liberar até a data de entrada original, com o texto da retenção; depois, com o dinheiro liberado.
    const [parte] = await partesDoProprietario(db, c.org, c.dono, sp("2026-10-11 12:00"));
    expect(parte).toMatchObject({ situacao: "a_liberar", motivo: expect.stringContaining("Reserva cancelada sem devolução ao hóspede") });
    // O Início não acusa "sem cálculo".
    expect((await avisosDePagamento(db, c.org, sp("2026-10-11 12:00"), { env: env() })).contagens.semCalculo).toBe(0);
  });

  it("a liberação depois do cancelamento lança o recebimento (pelo Mercado Pago e à mão)", async () => {
    const x = await retida();
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, liquido: TOTAL - 1824 });
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, sp("2026-10-11 12:00"), { origem: "painel", forcar: true });
    const recebimentos = (await doLivro(x.reservaId)).filter((l) => l.tipo === "recebimento");
    expect(recebimentos).toMatchObject([{ montante: TOTAL - 1824, estado: "conciliado" }]);
    const [parte] = await partesDoProprietario(db, c.org, c.dono, sp("2026-10-13 12:00"));
    expect(parte.situacao).toBe("disponivel");
    // À mão (outra reserva retida): a liberação manual também vale para a cancelada com valor retido.
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-22", email: "outro@example.com" });
    await cancelar(c, y.reservaId, entradaPadrao({ recebidoEm: sp("2026-10-18 10:00"), canal: "telefone" }), equipe, sp("2026-10-18 11:00"));
    expect((await c.reserva(y.reservaId)).valorRetido).toBe((await c.tentativa(y.pagamentoId)).valorPago);
    const { registrarLiberacaoManual } = await import("./liberacao");
    expect(await registrarLiberacaoManual(db, c.org, y.pagamentoId, { data: "2026-10-18", liquido: 1000 }, null, sp("2026-10-18 12:00"))).toEqual({ ok: true });
  });

  it("valor da reserva diferente do pago: a prévia avisa que a divisão muda", async () => {
    const x = await pagarEConfirmar(c);
    await db.update(reservas).set({ valorBruto: TOTAL + 5000 }).where(eq(reservas.id, x.reservaId));
    const p = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ recebidoEm: sp("2026-10-10 10:00"), canal: "email" }), c.provedor, sp("2026-10-10 11:00"));
    expect(p.ok && p.previa.avisos).toContainEqual("O valor retido (R$ 1.824,00, o que o hóspede pagou) é diferente do valor da reserva (R$ 1.874,00): a divisão muda.");
  });
});

describe("exceção, sem política e o direito integral que nunca se nega (M8.2c)", () => {
  it("exceção: exige o motivo da lista e a nota; integral por exceção; a prévia mostra o que o proprietário deixa de receber", async () => {
    const x = await pagarEConfirmar(c);
    const base = { recebidoEm: sp("2026-10-10 10:00"), canal: "email" as const };
    const semMotivo = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ ...base, decisao: "excecao", motivoDecisao: "Hóspede com problema de saúde na família" }), c.provedor, sp("2026-10-10 11:00"));
    expect(semMotivo).toMatchObject({ ok: false, codigo: "dados" });
    const semNota = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ ...base, decisao: "excecao", motivoExcecao: "saude_ou_familia" }), c.provedor, sp("2026-10-10 11:00"));
    expect(semNota).toMatchObject({ ok: false, codigo: "dados" });
    const entrada = entradaPadrao({ ...base, decisao: "excecao", motivoExcecao: "saude_ou_familia", motivoDecisao: "Hóspede com problema de saúde na família" });
    const { previa, resultado } = await cancelar(c, x.reservaId, entrada, equipe, sp("2026-10-10 11:00"));
    if (!previa.ok) throw new Error(previa.erro);
    expect(previa.previa).toMatchObject({ direito: "integral", base: "excecao" });
    const parte = previa.previa.componentes.parteProprietario;
    expect(previa.previa.componentes.perdaDoProprietario).toBe(parte);
    expect(previa.previa.avisos).toContainEqual(expect.stringContaining(`O proprietário deixa de receber R$ ${(parte / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} que receberia pela política`));
    expect(previa.previa.pergunta).toContain("O proprietário deixa de receber");
    expect(resultado).toMatchObject({ ok: true, direito: "integral" });
    expect(await cancelamentoDe(x.reservaId)).toMatchObject({ base: "excecao", calculado: "nenhum", direito: "integral", motivoExcecao: "saude_ou_familia", motivoDecisao: "Hóspede com problema de saúde na família" });
  });

  it("sem o aceite das páginas legais: sem decisão, recusa; 'nenhum' com motivo retém; 'integral' com motivo devolve", async () => {
    const a = await pagarEConfirmar(c, { ...longe, semAceite: true });
    const p = await previaDoCancelamento(db, c.org, a.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp" }), c.provedor, minutos(60));
    expect(p).toEqual({ ok: false, codigo: "decisao_obrigatoria", erro: TEXTO_SEM_POLITICA, escolha: "sem_politica" });
    const nenhum = await cancelar(c, a.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp", decisao: "nenhum", motivoDecisao: "Combinado com o hóspede" }), equipe, minutos(60));
    expect(nenhum.resultado).toMatchObject({ ok: true, direito: "nenhum" });
    expect(await cancelamentoDe(a.reservaId)).toMatchObject({ calculado: "sem_politica", base: "sem_politica", politicaVersao: null, integralAte: null });
    expect((await c.reserva(a.reservaId)).valorRetido).toBe(TOTAL);
    const b = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "outro@example.com", semAceite: true });
    const integral = await cancelar(c, b.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp", decisao: "integral", motivoDecisao: "Hóspede desistiu da viagem" }), equipe, minutos(60));
    expect(integral.previa.ok && integral.previa.previa.avisos[0]).toBe(TEXTO_SEM_POLITICA);
    expect(integral.resultado).toMatchObject({ ok: true, direito: "integral", devolucao: "confirmada" });
  });

  it("integral pela política: 'nenhum' é recusado; pedido no prazo e 'não comparecimento' depois da entrada é recusado (há pedido); como pedido do hóspede, integral pelo prazo mesmo depois da saída", async () => {
    const x = await pagarEConfirmar(c, longe);
    const nega = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp", decisao: "nenhum", motivoDecisao: "teste" }), c.provedor, minutos(60));
    expect(nega).toEqual({ ok: false, codigo: "integral_nao_se_nega", erro: TEXTO_INTEGRAL_NAO_SE_NEGA, escolha: null });
    await comPedido(x.reservaId, sp("2026-10-02 09:00"));
    const naoVeio = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ quemCancela: "nao_comparecimento" }), c.provedor, sp("2026-11-21 14:00"));
    expect(naoVeio).toEqual({ ok: false, codigo: "ha_pedido", erro: "Há um pedido de cancelamento do hóspede recebido em 02/10 às 09:00: não é não comparecimento. Cancele como pedido do hóspede (vale o horário do pedido)." });
    // Depois da saída (23/11), com o pedido no prazo: integral pelo prazo (o pedido nunca se perde pela demora).
    const { previa, resultado } = await cancelar(c, x.reservaId, entradaPadrao(), equipe, sp("2026-11-25 10:00"));
    expect(previa).toMatchObject({ ok: true, previa: { direito: "integral", base: "prazo" } });
    expect(resultado).toMatchObject({ ok: true, direito: "integral" });
    expect((await cancelamentoDe(x.reservaId)).pedidoRecebidoEm).toEqual(sp("2026-10-02 09:00"));
  });

  it("depois da saída sem pedido: não se cancela (estadia encerrada)", async () => {
    const x = await pagarEConfirmar(c);
    const r = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), c.provedor, sp("2026-10-16 10:00"));
    expect(r).toEqual({ ok: false, codigo: "estadia_encerrada", erro: "A estadia já terminou e não há pedido de cancelamento registrado: não se cancela; registre um ajuste se precisar." });
    // Recusa de antes da decisão pela política: sem `escolha` (a tela fica com a que mostrava).
    expect(r).not.toHaveProperty("escolha");
  });

  it("a SCL cancela depois da entrada: integral; o proprietário deixa de receber o que a política daria", async () => {
    const x = await pagarEConfirmar(c);
    const { previa, resultado } = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, sp("2026-10-13 10:00"));
    if (!previa.ok) throw new Error(previa.erro);
    expect(previa.previa).toMatchObject({ direito: "integral", base: "empresa" });
    expect(previa.previa.componentes.perdaDoProprietario).toBe(previa.previa.componentes.parteProprietario);
    expect(resultado).toMatchObject({ ok: true, direito: "integral" });
  });

  it("a SCL cancela um pagamento sem o aceite das páginas legais: sempre integral (base: a SCL cancela); 'não devolver' é recusado", async () => {
    const a = await pagarEConfirmar(c, { ...longe, semAceite: true });
    const empresa = { quemCancela: "empresa" as const, motivoEmpresa: "imovel_sem_condicoes" as const };
    const nega = await previaDoCancelamento(db, c.org, a.reservaId, entradaPadrao({ ...empresa, decisao: "nenhum", motivoDecisao: "Apartamento sem condições" }), c.provedor, minutos(60));
    expect(nega).toEqual({ ok: false, codigo: "integral_nao_se_nega", erro: TEXTO_EMPRESA_SEMPRE_INTEGRAL, escolha: null });
    const { previa, resultado } = await cancelar(c, a.reservaId, entradaPadrao(empresa), equipe, minutos(60));
    if (!previa.ok) throw new Error(previa.erro);
    expect(previa.previa).toMatchObject({ direito: "integral", base: "empresa", valorADevolver: TOTAL, politica: null });
    expect(previa.previa.avisos).not.toContain(TEXTO_SEM_POLITICA);
    expect(resultado).toMatchObject({ ok: true, direito: "integral" });
    expect(await cancelamentoDe(a.reservaId)).toMatchObject({ calculado: "integral", base: "empresa", direito: "integral", politicaVersao: null, valorADevolver: TOTAL });
    expect((await c.reserva(a.reservaId)).valorRetido).toBeNull();
  });

  it("a SCL cancela com um pedido do hóspede registrado dentro do prazo: pela política ele já teria o integral, então o proprietário não perde nada a mais", async () => {
    const x = await pagarEConfirmar(c, longe);
    // Pedido por WhatsApp em 1/10 (prazo integral até 6/11); a SCL cancela em 10/11, depois do prazo.
    await comPedido(x.reservaId, minutos(30));
    const empresa = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), c.provedor, sp("2026-11-10 10:00"));
    if (!empresa.ok) throw new Error(empresa.erro);
    expect(empresa.previa).toMatchObject({ direito: "integral", base: "empresa" });
    expect(empresa.previa.componentes.perdaDoProprietario).toBe(0);
    expect(empresa.previa.avisos.join(" ")).not.toContain("deixa de receber");
    expect(empresa.previa.pergunta).not.toContain("deixa de receber");
    // Sem pedido (outra reserva, prazo integral até 9/11), no mesmo instante a política não daria nada: aí sim o proprietário deixa de receber a parte.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-23", saida: "2026-11-24", email: "y@example.com" });
    const semPedido = await previaDoCancelamento(db, c.org, y.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), c.provedor, sp("2026-11-10 10:00"));
    if (!semPedido.ok) throw new Error(semPedido.erro);
    expect(semPedido.previa.componentes.perdaDoProprietario).toBe(semPedido.previa.componentes.parteProprietario);
  });

  it("empresa sem o motivo: dados", async () => {
    const x = await pagarEConfirmar(c);
    expect(await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ quemCancela: "empresa" }), c.provedor, minutos(60))).toMatchObject({ ok: false, codigo: "dados" });
  });
});

describe("não comparecimento, saída antecipada e o momento do pedido (M8.2c)", () => {
  it("não comparecimento: antes da tolerância (21 h depois da entrada), recusado com a hora; depois, sem devolução", async () => {
    const x = await pagarEConfirmar(c);
    const cedo = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ quemCancela: "nao_comparecimento" }), c.provedor, sp("2026-10-12 20:00"));
    expect(cedo).toEqual({ ok: false, codigo: "cedo_para_nao_comparecimento", erro: "Não comparecimento só depois de 13/10 às 12:00 (o hóspede pode chegar atrasado e avisar)." });
    const { previa, resultado } = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "nao_comparecimento" }), equipe, sp("2026-10-13 12:00"));
    expect(previa).toMatchObject({ ok: true, previa: { direito: "nenhum", base: "nao_comparecimento" } });
    expect(previa.ok && previa.previa.pergunta.startsWith("Confirme que o hóspede não chegou e não avisou de atraso. ")).toBe(true);
    expect(resultado).toMatchObject({ ok: true, direito: "nenhum" });
  });

  it("o horário do não comparecimento na ficha (momentosDoCancelamento) é o que a decisão confere: o padrão, o horário do imóvel e a tolerância editados", async () => {
    const x = await pagarEConfirmar(c);
    const confere = async (esperado: { entradaEm: Date; naoComparecimentoApos: Date }) => {
      const m = await momentosDoCancelamento(db, c.org, x.reservaId);
      expect(m).toEqual({ ...esperado, fuso: "America/Sao_Paulo" });
      const libera = m!.naoComparecimentoApos;
      const naoVeio = entradaPadrao({ quemCancela: "nao_comparecimento" });
      expect(await previaDoCancelamento(db, c.org, x.reservaId, naoVeio, c.provedor, new Date(libera.getTime() - 60_000))).toEqual({
        ok: false,
        codigo: "cedo_para_nao_comparecimento",
        erro: `Não comparecimento só depois de ${diaHoraBr(libera)} (o hóspede pode chegar atrasado e avisar).`,
      });
      expect(await previaDoCancelamento(db, c.org, x.reservaId, naoVeio, c.provedor, libera)).toMatchObject({ ok: true, previa: { direito: "nenhum", base: "nao_comparecimento" } });
    };
    // Padrão: entrada às 15:00 do cadastro, 21 horas de tolerância (12:00 do dia seguinte).
    await confere({ entradaEm: sp("2026-10-12 15:00"), naoComparecimentoApos: sp("2026-10-13 12:00") });
    // Horário de entrada do imóvel 14:00 e tolerância de 6 horas (Configurações → Pagamento no site).
    await db.update(imoveisDetalhes).set({ checkinAPartirDe: "14:00" }).where(eq(imoveisDetalhes.imovelId, c.imovel));
    expect(await salvarConfigPagamentoSite(db, c.org, { ...(await lerConfigPagamentoSite(db, c.org)), naoComparecimentoHoras: 6 }, null)).toMatchObject({ ok: true });
    await confere({ entradaEm: sp("2026-10-12 14:00"), naoComparecimentoApos: sp("2026-10-12 20:00") });
    // Imóvel sem os detalhes cadastrados: entrada às 15:00 (o mesmo padrão da decisão).
    await db.delete(imoveisDetalhes).where(eq(imoveisDetalhes.imovelId, c.imovel));
    await confere({ entradaEm: sp("2026-10-12 15:00"), naoComparecimentoApos: sp("2026-10-12 21:00") });
    // De outra empresa ou inexistente: nada.
    const outra = await montarCenario(db);
    expect(await momentosDoCancelamento(db, outra.org, x.reservaId)).toBeNull();
    expect(await momentosDoCancelamento(db, c.org, "nao-e-uuid")).toBeNull();
  });

  it("saída antecipada: pedido do hóspede depois da entrada, sem devolução pela política → recusado, nada muda; com exceção, vale", async () => {
    const x = await pagarEConfirmar(c);
    await comPedido(x.reservaId, sp("2026-10-13 09:00"));
    const r = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao(), c.provedor, sp("2026-10-13 10:00"));
    // A recusa vem sem prévia, mas diz que a exceção vale (a ficha a oferece).
    expect(r).toMatchObject({ ok: false, codigo: "estadia_iniciada", erro: expect.stringContaining("O pedido chegou depois do início da estadia (12/10 às 15:00)"), escolha: "excecao" });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "confirmada" });
    expect((await motorEmVigor(x.reservaId)).length).toBe(4);
    const excecao = await cancelar(c, x.reservaId, entradaPadrao({ decisao: "excecao", motivoExcecao: "cortesia_comercial", motivoDecisao: "Cortesia pela obra no prédio" }), equipe, sp("2026-10-13 10:00"));
    expect(excecao.resultado).toMatchObject({ ok: true, direito: "integral" });
  });

  it("momento: no futuro ou antes do pagamento, recusado; o do pedido pelo site é travado (canal e hora); o da equipe só muda com o motivo, auditado", async () => {
    const x = await pagarEConfirmar(c, longe);
    for (const recebidoEm of [minutos(120), minutos(-60)])
      expect(await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ recebidoEm, canal: "whatsapp" }), c.provedor, minutos(60))).toMatchObject({ ok: false, codigo: "dados", erro: "Informe quando o pedido chegou (não pode ser no futuro nem antes do pagamento)." });
    // Sem canal: dados.
    expect(await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ recebidoEm: minutos(30) }), c.provedor, minutos(60))).toMatchObject({ ok: false, codigo: "dados" });
    // Pedido pelo site: o horário do servidor vale, qualquer que seja o informado.
    const site = await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(40));
    expect(site).toMatchObject({ ok: true, recebidoEm: minutos(40) });
    const p = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ recebidoEm: minutos(10), canal: "telefone" }), c.provedor, minutos(60));
    expect(p).toMatchObject({ ok: true, previa: { recebidoEm: minutos(40), canal: "site" } });
    // Pedido da equipe com o momento corrigido pelo financeiro.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "outro@example.com" });
    await comPedido(y.reservaId, sp("2026-10-01 12:30"), minutos(60));
    const semMotivo = await previaDoCancelamento(db, c.org, y.reservaId, entradaPadrao({ recebidoEm: sp("2026-10-01 12:20") }), c.provedor, minutos(90));
    expect(semMotivo).toMatchObject({ ok: false, codigo: "dados", erro: expect.stringContaining("por que o horário do pedido foi corrigido") });
    const corrigido = await cancelar(c, y.reservaId, entradaPadrao({ recebidoEm: sp("2026-10-01 12:20"), motivoMomento: "A mensagem do WhatsApp mostra 12h20" }), equipe, minutos(90));
    if (!corrigido.previa.ok) throw new Error(corrigido.previa.erro);
    expect(corrigido.previa.previa.avisos).toContainEqual("Momento do pedido corrigido: registrado 01/10 12:30 por Equipe Fictícia; usado 01/10 12:20 (A mensagem do WhatsApp mostra 12h20).");
    expect(corrigido.resultado).toMatchObject({ ok: true });
    expect(await cancelamentoDe(y.reservaId)).toMatchObject({ pedidoRecebidoEm: sp("2026-10-01 12:20"), pedidoRegistradoOriginalEm: sp("2026-10-01 12:30"), motivoMomento: "A mensagem do WhatsApp mostra 12h20" });
    const [a] = await db.select().from(auditoria).where(and(eq(auditoria.acao, "pagamento.cancelamento"), eq(auditoria.entidadeId, y.pagamentoId)));
    expect((a.mudancas as Record<string, unknown[]>).recebidoEm).toEqual([sp("2026-10-01 12:30").toISOString(), sp("2026-10-01 12:20").toISOString()]);
  });

  it("o momento do hóspede vale mesmo quando a equipe cancela dias depois (continua integral)", async () => {
    const x = await pagarEConfirmar(c);
    // Pedido em 05/10 (dentro do arrependimento: aprovado em 01/10, até 08/10 e antes da entrada).
    await comPedido(x.reservaId, sp("2026-10-05 10:00"));
    const { previa } = await cancelar(c, x.reservaId, entradaPadrao(), equipe, sp("2026-10-11 10:00"));
    expect(previa).toMatchObject({ ok: true, previa: { direito: "integral", base: "arrependimento" } });
  });

  it("notas com dado pessoal (CPF, e-mail): recusadas", async () => {
    const x = await pagarEConfirmar(c, longe);
    for (const e of [entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp", nota: "CPF 123.456.789-09" }), entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp", motivoDecisao: "hospede@example.com" })])
      expect(await previaDoCancelamento(db, c.org, x.reservaId, e, c.provedor, minutos(60))).toMatchObject({ ok: false, codigo: "dados", erro: "Tire dados pessoais da nota (CPF, e-mail, telefone, chave Pix, cartão)." });
  });
});

describe("recusas e a assinatura da prévia (M8.2c)", () => {
  const entrada = () => entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" });

  it("outra tentativa sem resposta: dentro do prazo de leitura, espera; fora dele, só o aviso", async () => {
    const x = await pagarEConfirmar(c, longe);
    const p = await c.tentativa(x.pagamentoId);
    const [outra] = await db
      .insert(pagamentos)
      .values({ organizacaoId: c.org, cotacaoId: x.cotacaoId, reservaId: x.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: "scl-outra-tentativa", chaveIdempotencia: "outra", situacao: "pendente", valor: p.valor, criadoEm: minutos(5) })
      .returning();
    expect(await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, minutos(60))).toMatchObject({ ok: false, codigo: "em_andamento", erro: expect.stringContaining("Pix do site em andamento") });
    await db.update(pagamentos).set({ criadoEm: dia(-100) }).where(eq(pagamentos.id, outra.id));
    const r = await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, minutos(60));
    expect(r.ok && r.previa.avisos).toContainEqual("Há uma tentativa de pagamento sem resposta há mais de 85 dias: confira no painel do Mercado Pago que ela não foi aprovada.");
  });

  it("devolvido em parte, devolução em andamento, situação desconhecida ou contestado: o cancelamento espera", async () => {
    const x = await pagarEConfirmar(c, longe);
    // Sem provedor: nada é relido (o estado gravado vale).
    const previa = () => previaDoCancelamento(db, c.org, x.reservaId, entrada(), null, minutos(60));
    const limpar = () => db.update(pagamentos).set({ situacao: "aprovado", devolvidoLido: 0, devolucaoEmAndamentoLida: false, avisos: [] }).where(eq(pagamentos.id, x.pagamentoId));
    // M8.2d (D17): parte devolvida pelo painel do Mercado Pago sem o valor → a equipe informa o valor visto lá; com o valor
    // lido, o cancelamento vale, o devolvido fora fica reconhecido e a integral devolve só o restante.
    await db.update(pagamentos).set({ situacao: "devolvido_parcial" }).where(eq(pagamentos.id, x.pagamentoId));
    expect(await previa()).toEqual({ ok: false, codigo: "devolvido_fora_sem_valor", erro: TEXTO_FORA_SEM_VALOR, foraSemValor: [{ pagamentoId: x.pagamentoId, rotulo: expect.stringMatching(/^Pix de \d{2}\/\d{2} \(R\$ /) }] });
    await limpar();
    for (const mudanca of [{ devolucaoEmAndamentoLida: true }, { avisos: ["situacao_desconhecida"] }]) {
      await db.update(pagamentos).set(mudanca).where(eq(pagamentos.id, x.pagamentoId));
      expect(await previa()).toEqual({ ok: false, codigo: "devolvido_em_parte", erro: TEXTO_DEVOLVIDO_EM_PARTE });
      await limpar();
    }
    // Contestado sem disputa registrada (lido antes do M8.2e): espera, com o texto da disputa em curso (M8.2e).
    await db.update(pagamentos).set({ situacao: "contestado" }).where(eq(pagamentos.id, x.pagamentoId));
    expect(await previa()).toMatchObject({ ok: false, codigo: "contestado", erro: expect.stringContaining("Disputa do pagamento em curso") });
    await limpar();
    // Com o valor lido (a releitura mostra R$ 10,00 devolvidos pelo painel): o cancelamento vale e a integral devolve o restante.
    c.provedor.devolverNoProvedor(x.idProvedor, 1000);
    const comFora = await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, minutos(60));
    expect(comFora.ok && comFora.previa).toMatchObject({ direito: "integral", valorADevolver: TOTAL - 1000, pagamentos: [{ pagamentoId: x.pagamentoId, valor: TOTAL - 1000, foraReconhecido: 1000 }] });
  });

  it("integral dentro do prazo de leitura sem conseguir ler o Mercado Pago agora: recusado, nada gravado", async () => {
    const x = await pagarEConfirmar(c, longe);
    c.provedor.falhas.consultar = new ErroProvedor("incerto", "sem resposta");
    const p = await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, minutos(60));
    expect(p).toEqual({ ok: false, codigo: "sem_leitura", erro: TEXTO_SEM_LEITURA, escolha: null });
    const r = await cancelarReservaPaga(db, c.org, x.reservaId, entrada(), equipe, c.provedor, minutos(60), "0123456789abcdef");
    expect(r).toMatchObject({ ok: false, codigo: "sem_leitura" });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "confirmada" });
    expect(await cancelamentoDe(x.reservaId)).toBeUndefined();
    // Sem provedor também (nada foi lido).
    expect(await previaDoCancelamento(db, c.org, x.reservaId, entrada(), null, minutos(60))).toMatchObject({ ok: false, codigo: "sem_leitura" });
  });

  it("sem leitura: o texto só diz que o horário do pedido está registrado quando há um pedido registrado; digitado no formulário, pede para registrar", async () => {
    const x = await pagarEConfirmar(c, longe);
    c.provedor.falhas.consultar = new ErroProvedor("incerto", "sem resposta");
    const digitado = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp" }), c.provedor, minutos(60));
    expect(digitado).toMatchObject({ ok: false, codigo: "sem_leitura", erro: `${TEXTO_SEM_LEITURA} O horário do pedido ainda não está guardado: registre o pedido ("Registrar pedido de cancelamento") para ele não se perder.` });
    expect(await cancelamentoDe(x.reservaId)).toBeUndefined();
    await comPedido(x.reservaId, minutos(30), minutos(61));
    const registrado = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp" }), c.provedor, minutos(62));
    expect(registrado).toMatchObject({ ok: false, codigo: "sem_leitura", erro: `${TEXTO_SEM_LEITURA} O horário do pedido já está registrado e não muda.` });
  });

  it("assinatura vazia ou velha: previa_mudou; o segundo clique: já cancelada", async () => {
    const x = await pagarEConfirmar(c, longe);
    const p = await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, minutos(60));
    if (!p.ok) throw new Error(p.erro);
    expect(await cancelarReservaPaga(db, c.org, x.reservaId, entrada(), equipe, c.provedor, minutos(61), "")).toEqual({ ok: false, codigo: "previa_mudou", erro: TEXTO_PREVIA_MUDOU });
    // A decisão mudou (o motivo da SCL não entra na assinatura, mas quem cancela, sim).
    expect(await cancelarReservaPaga(db, c.org, x.reservaId, entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp" }), equipe, c.provedor, minutos(61), p.previa.assinatura)).toMatchObject({ ok: false, codigo: "previa_mudou" });
    expect(await cancelarReservaPaga(db, c.org, x.reservaId, entrada(), equipe, c.provedor, minutos(61), p.previa.assinatura)).toMatchObject({ ok: true });
    expect(await cancelarReservaPaga(db, c.org, x.reservaId, entrada(), equipe, c.provedor, minutos(62), p.previa.assinatura)).toMatchObject({ ok: false, codigo: "ja_cancelada", erro: expect.stringContaining("Esta reserva já foi cancelada em 01/10") });
    expect(pedidosDeDevolucao()).toHaveLength(1);
  });

  it("pedido da equipe descartado (ou registrado) entre a prévia e o clique: previa_mudou, e nada é cancelado", async () => {
    const x = await pagarEConfirmar(c, longe);
    expect(await pedir(c, x.reservaId, equipe, { recebidoEm: minutos(30), quando: minutos(31) })).toEqual({ ok: true });
    // O formulário manda a data, a hora e o canal pré-preenchidos do pedido.
    const doPedido = entradaPadrao({ recebidoEm: minutos(30), canal: "whatsapp" });
    const p = await previaDoCancelamento(db, c.org, x.reservaId, doPedido, c.provedor, minutos(60));
    if (!p.ok) throw new Error(p.erro);
    expect(await descartarPedidoDeCancelamento(db, c.org, x.reservaId, { motivo: "O hóspede desistiu" }, { id: equipe, podeFinanceiro: false }, minutos(61))).toEqual({ ok: true });
    expect(await cancelarReservaPaga(db, c.org, x.reservaId, doPedido, equipe, c.provedor, minutos(62), p.previa.assinatura)).toEqual({ ok: false, codigo: "previa_mudou", erro: TEXTO_PREVIA_MUDOU });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "confirmada" });
    expect((await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId))).map((l) => l.situacao)).toEqual(["descartado"]);
    // Sem pedido na prévia e um registrado no mesmo minuto antes do clique: também muda.
    const semPedido = await previaDoCancelamento(db, c.org, x.reservaId, doPedido, c.provedor, minutos(63));
    if (!semPedido.ok) throw new Error(semPedido.erro);
    expect(await pedir(c, x.reservaId, equipe, { recebidoEm: minutos(30), quando: minutos(64) })).toEqual({ ok: true });
    expect(await cancelarReservaPaga(db, c.org, x.reservaId, doPedido, equipe, c.provedor, minutos(65), semPedido.previa.assinatura)).toMatchObject({ ok: false, codigo: "previa_mudou" });
  });

  it("parte num repasse ainda não pago: recusado (estorne o repasse); repasse pago entre a prévia e o clique: previa_mudou", async () => {
    const x = await pagarEConfirmar(c);
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    const quando = sp("2026-10-13 10:00");
    const p = await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, quando);
    if (!p.ok) throw new Error(p.erro);
    expect(p.previa.componentes.jaRepassada).toEqual([]);
    // Entre a prévia e o clique, um antecipado (a pagar) leva a parte: recusado.
    const rep = await gerarAntecipado(db, c.org, c.dono, "2026-10-13", null, { agora: quando });
    if (!rep.ok) throw new Error(rep.erro);
    const r = await cancelarReservaPaga(db, c.org, x.reservaId, entrada(), equipe, c.provedor, quando, p.previa.assinatura);
    expect(r).toEqual({
      ok: false,
      codigo: "repasse_a_pagar",
      erro: "A parte desta reserva já compõe o repasse antecipado de 13/10, ainda não pago: estorne esse repasse (o proprietário recebe o resto no próximo) e então cancele. Se ele já foi pago de fato, marque-o como pago antes — a parte paga é descontada no próximo repasse.",
      escolha: null,
    });
    // Pago: a parte já repassada muda a conta, e a prévia velha não vale mais.
    const { marcarRepassePago } = await import("@/repasses/repasses");
    expect(await marcarRepassePago(db, c.org, rep.id, "2026-10-13", "2026-10-13", null)).toMatchObject({ ok: true });
    expect(await cancelarReservaPaga(db, c.org, x.reservaId, entrada(), equipe, c.provedor, quando, p.previa.assinatura)).toMatchObject({ ok: false, codigo: "previa_mudou" });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "confirmada" });
  });

  it("trava ocupada (55P03 ou impasse 40P01) na fase 1: 'ocupado', nada pedido ao Mercado Pago, nada gravado", async () => {
    const x = await pagarEConfirmar(c);
    const e = entradaPadrao({ recebidoEm: sp("2026-10-10 10:00"), canal: "email" });
    const p = await previaDoCancelamento(db, c.org, x.reservaId, e, null, sp("2026-10-10 11:00"));
    if (!p.ok) throw new Error(p.erro);
    for (const code of ["55P03", "40P01"]) {
      const espiao = vi.spyOn(db, "transaction").mockRejectedValueOnce(Object.assign(new Error("trava"), { code }));
      expect(await cancelarReservaPaga(db, c.org, x.reservaId, e, equipe, null, sp("2026-10-10 11:00"), p.previa.assinatura)).toEqual({ ok: false, codigo: "ocupado", erro: TEXTO_OCUPADO });
      espiao.mockRestore();
    }
    expect(pedidosDeDevolucao()).toEqual([]);
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "confirmada" });
    // A mesma prévia vale depois (nada mudou).
    expect(await cancelarReservaPaga(db, c.org, x.reservaId, e, equipe, null, sp("2026-10-10 11:00"), p.previa.assinatura)).toMatchObject({ ok: true, direito: "nenhum" });
  });

  it("reserva que não foi paga pelo site, de outra empresa ou inexistente", async () => {
    const outra = "00000000-0000-4000-8000-000000000009";
    expect(await previaDoCancelamento(db, c.org, outra, entrada(), null, AGORA)).toMatchObject({ ok: false, codigo: "nao_encontrada" });
    const s = await c.segurar();
    expect(await previaDoCancelamento(db, c.org, s.reservaId, entrada(), null, AGORA)).toMatchObject({ ok: false, codigo: "nao_paga_pelo_site" });
    const x = await pagarEConfirmar(c, { ...longe, email: "outro@example.com" });
    expect(await previaDoCancelamento(db, outra, x.reservaId, entrada(), null, AGORA)).toMatchObject({ ok: false, codigo: "nao_encontrada" });
    // O cancelamento de sempre continua recusado para a reserva paga (texto que aponta para o quadro do pagamento).
    expect(await tentarCancelarReserva(db, c.org, x.reservaId, null)).toEqual({ ok: false, aviso: 'Não cancelada por aqui: esta reserva foi paga pelo site. Use "Cancelar a reserva" no quadro Pagamento no site (devolução pela política aceita pelo hóspede).' });
  });

  it("avisos da prévia: outro fuso, sem horário de entrada cadastrado, pedido registrado mais de dois dias depois de chegar, ajustes da reserva e cartão ainda não liberado", async () => {
    const AVISOS = [
      "A política conta no horário de Brasília e este imóvel está em outro fuso: confira as datas.",
      "Este imóvel não tem horário de entrada cadastrado: vale o padrão 15:00.",
      "O pedido foi registrado mais de dois dias depois de chegar: confira a data e a hora na mensagem do hóspede.",
      "Esta reserva tem 1 ajuste(s) manual(is) (R$ 50,00): o cancelamento não mexe neles. Revise depois.",
      "Cartão ainda não liberado pelo Mercado Pago: a devolução pode precisar de saldo disponível na conta do Mercado Pago.",
    ];
    // Pix liberado, pedido registrado na hora, imóvel em São Paulo com o horário de entrada: nenhum desses avisos.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com" });
    await liberar(c, y.pagamentoId, { quando: minutos(10) });
    await comPedido(y.reservaId, minutos(30), minutos(35));
    const py = await previaDoCancelamento(db, c.org, y.reservaId, entradaPadrao(), c.provedor, minutos(60));
    if (!py.ok) throw new Error(py.erro);
    for (const a of AVISOS) expect(py.previa.avisos).not.toContainEqual(a);
    // Cartão ainda não liberado, pedido de 01/10 12:30 registrado 49 h depois, um ajuste manual na reserva e o imóvel em
    // outro fuso, sem o cadastro do horário de entrada.
    const x = await pagarEConfirmar(c, { ...longe, forma: "cartao" });
    await comPedido(x.reservaId, minutos(30), minutos(30 + 49 * 60));
    await lancar(db, c.org, [{ tipo: "ajuste", descricao: "Ajuste fictício da reserva", valor: 5000, efeitoSaldo: 0, montante: 5000, competencia: "2026-10-01", estado: "realizado", imovelId: c.imovel, reservaId: x.reservaId, origem: "ajuste" }], null);
    await db.update(imoveis).set({ fuso: "America/Manaus" }).where(eq(imoveis.id, c.imovel));
    await db.delete(imoveisDetalhes).where(eq(imoveisDetalhes.imovelId, c.imovel));
    const px = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao(), c.provedor, minutos(30 + 50 * 60));
    if (!px.ok) throw new Error(px.erro);
    expect(px.previa).toMatchObject({ direito: "integral", rota: "pedida", componentes: { ajustes: [{ descricao: "Ajuste fictício da reserva", valor: 5000 }] } });
    expect(px.previa.avisos).toEqual(expect.arrayContaining(AVISOS));
    // Liberado, o aviso do cartão sai.
    await liberar(c, x.pagamentoId, { quando: minutos(30 + 50 * 60) });
    const liberado = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao(), c.provedor, minutos(30 + 51 * 60));
    expect(liberado.ok && liberado.previa.avisos).not.toContainEqual(AVISOS[4]);
  });
});

describe("parte já repassada: espelhos no mês do cancelamento e desconto (M8.2c)", () => {
  /** Reserva de 12/10, liberada, parte repassada num antecipado pago em 13/10, pedido do hóspede no arrependimento (05/10). */
  async function repassada() {
    const x = await pagarEConfirmar(c);
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    await comPedido(x.reservaId, sp("2026-10-05 10:00"));
    const repasseId = await repassar(c, "antecipado", { hoje: "2026-10-13" });
    return { ...x, repasseId };
  }

  it("cancelada em novembro: outubro fica como estava; novembro tem os espelhos (a parte vira o desconto da dona); conferência resolvida pelo sistema; o fechamento não trava", async () => {
    const x = await repassada();
    const outubro = (await motorEmVigor(x.reservaId)).map((l) => [l.id, l.tipo, l.valor] as const);
    const quando = sp("2026-11-02 10:00");
    const { previa, resultado } = await cancelar(c, x.reservaId, entradaPadrao(), equipe, quando);
    if (!previa.ok) throw new Error(previa.erro);
    const parte = outubro.find(([, tipo]) => tipo === "direito_proprietario")![2];
    expect(previa.previa.componentes.jaRepassada).toMatchObject([{ valor: parte, repasseId: x.repasseId, repasse: "2026-10-13", pagoEm: "2026-10-13" }]);
    expect(previa.previa.avisos).toContainEqual(expect.stringContaining("já foram repassados (repasse de 13/10, pago em 13/10): o cancelamento lança agora o desconto"));
    expect(previa.previa.pergunta).toContain("já repassados ao proprietário são descontados no próximo repasse dele.");
    expect(resultado).toMatchObject({ ok: true, direito: "integral", devolucao: "confirmada" });
    // Outubro: os 4 do motor continuam em vigor, iguais.
    expect((await motorEmVigor(x.reservaId)).map((l) => [l.id, l.tipo, l.valor] as const)).toEqual(outubro);
    // Novembro: os espelhos; o da parte é o desconto (previsto, para a dona).
    const espelhos = (await doLivro(x.reservaId)).filter((l) => l.origem === "cancelamento");
    expect(espelhos.map((l) => [l.tipo, l.valor, l.competencia]).sort()).toEqual(outubro.map(([, tipo, valor]) => [tipo, -valor, "2026-11-01"]).sort());
    expect(espelhos.find((l) => l.tipo === "direito_proprietario")).toMatchObject({ proprietarioId: c.dono, estado: "previsto", efeitoSaldo: -parte, descricao: expect.stringContaining("desconto da parte já repassada (repasse de 13/10/2026)") });
    const canc = await cancelamentoDe(x.reservaId);
    expect(canc.espelhado).toBe(true);
    expect((await c.reserva(x.reservaId)).conferenciaResolvidaEm).toEqual(quando);
    const [resolvida] = await db.select().from(auditoria).where(and(eq(auditoria.acao, "reserva.conferencia_resolvida"), eq(auditoria.entidadeId, x.reservaId)));
    expect(JSON.stringify(resolvida.mudancas)).toContain("acerto do cancelamento pelo sistema");
    expect(await emConferencia(x.reservaId)).toBe(false);
    for (const mes of ["2026-10", "2026-11"]) expect((await preverRepasses(db, c.org, mes, "2026-12-02", [c.dono], true))[0].bloqueios.join(" ")).not.toContain("acerto pendente");
    // "Dar por resolvida" não tem nada a fazer.
    expect(await resolverConferencia(db, c.org, x.reservaId, null)).toBe(false);
    // O próximo antecipado desconta: sem outras partes que cubram, espera.
    expect(await gerarAntecipado(db, c.org, c.dono, "2026-11-03", null, { agora: sp("2026-11-03 12:00") })).toMatchObject({ ok: false, erro: expect.stringContaining("não cobrem o desconto") });
    // A saída do caixa (o líquido que entrou em outubro), conciliada no dia da leitura que confirmou.
    expect((await doLivro(x.reservaId)).filter((l) => l.tipo === "devolucao")).toMatchObject([{ montante: TOTAL - 1824, estado: "conciliado", dataCaixa: "2026-11-02" }]);
    // Um contrato novo não mexe na reserva congelada.
    await db.update(contratos).set({ comissaoBp: 2000 }).where(eq(contratos.imovelId, c.imovel));
    const antes = (await doLivro(x.reservaId)).length;
    expect(await aplicarMotor(db, c.org, x.reservaId, null)).toMatchObject({ criados: 0, estornados: 0 });
    expect((await doLivro(x.reservaId)).length).toBe(antes);
  });

  it("estadia em dois meses com só outubro movimentado (a parte de outubro realizada): outubro espelhado em novembro; novembro estornado no próprio mês", async () => {
    const x = await pagarEConfirmar(c, { entrada: "2026-10-30", saida: "2026-11-02" });
    await comPedido(x.reservaId, sp("2026-10-05 10:00"));
    const doMotor = await motorEmVigor(x.reservaId);
    const deOutubro = doMotor.filter((l) => l.competencia === "2026-10-01");
    const deNovembro = doMotor.filter((l) => l.competencia === "2026-11-01");
    expect(deOutubro.length).toBe(4);
    expect(deNovembro.length).toBe(4);
    // A parte de outubro já movimentou dinheiro (paga à mão); novembro, nada.
    const parteOutubro = deOutubro.find((l) => l.tipo === "direito_proprietario")!;
    await db.update(lancamentos).set({ estado: "realizado" }).where(eq(lancamentos.id, parteOutubro.id));
    const { previa, resultado } = await cancelar(c, x.reservaId, entradaPadrao(), equipe, sp("2026-11-03 10:00"));
    expect(previa.ok && previa.previa.componentes.jaRepassada).toMatchObject([{ lancamentoId: parteOutubro.id, valor: parteOutubro.valor }]);
    expect(resultado).toMatchObject({ ok: true, direito: "integral" });
    const livro = await doLivro(x.reservaId);
    // Outubro: em vigor e espelhado em novembro (a parte paga vira o desconto da dona).
    expect((await motorEmVigor(x.reservaId)).map((l) => l.id).sort()).toEqual(deOutubro.map((l) => l.id).sort());
    const espelhos = livro.filter((l) => l.origem === "cancelamento");
    expect(espelhos.length).toBe(4);
    expect(espelhos.every((l) => l.competencia === "2026-11-01")).toBe(true);
    expect(espelhos.find((l) => l.tipo === "direito_proprietario")).toMatchObject({ valor: -parteOutubro.valor, descricao: expect.stringContaining("desconto da parte de 10/2026 já paga") });
    // Novembro: estornado (no próprio mês), sem espelho.
    const estornos = livro.filter((l) => l.origem === "estorno");
    expect(estornos.map((l) => l.estornoDe).sort()).toEqual(deNovembro.map((l) => l.id).sort());
    expect(estornos.every((l) => l.competencia === "2026-11-01")).toBe(true);
    expect(await cancelamentoDe(x.reservaId)).toMatchObject({ espelhado: true });
  });

  it("estadia em dois meses repassada no fechamento de outubro (as duas partes pagas): os dois meses espelhados em novembro", async () => {
    const x = await pagarEConfirmar(c, { entrada: "2026-10-30", saida: "2026-11-02" });
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    await comPedido(x.reservaId, sp("2026-10-05 10:00"));
    await repassar(c, "fechamento", { hoje: "2026-11-02", mes: "2026-10" });
    const doMotor = await motorEmVigor(x.reservaId);
    const { resultado } = await cancelar(c, x.reservaId, entradaPadrao(), equipe, sp("2026-11-03 10:00"));
    expect(resultado).toMatchObject({ ok: true, direito: "integral" });
    expect((await motorEmVigor(x.reservaId)).map((l) => l.id).sort()).toEqual(doMotor.map((l) => l.id).sort());
    const livro = await doLivro(x.reservaId);
    expect(livro.filter((l) => l.origem === "cancelamento").length).toBe(8);
    expect(livro.filter((l) => l.origem === "estorno")).toEqual([]);
    const partes = doMotor.filter((l) => l.tipo === "direito_proprietario").reduce((s, l) => s + l.valor, 0);
    expect(await saldoAcerto(db, c.org, { proprietarioId: c.dono })).toBe(-partes);
  });
});

describe("pagamento velho e o já devolvido no painel do Mercado Pago (M8.2c)", () => {
  const entrada = () => entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" });

  it("Pix com mais de 78 dias: nada é pedido ao Mercado Pago; devolução recusada sem falhas, aviso; a devolução por fora vale (com a taxa derivada) e acerta o caixa", async () => {
    const x = await pagarEConfirmar(c, longe);
    await envelhecer(c, x.pagamentoId, 80);
    const { previa, resultado } = await cancelar(c, x.reservaId, entrada(), equipe, minutos(60));
    expect(previa.ok && previa.previa.rota).toBe("fora_do_prazo");
    expect(previa.ok && previa.previa.avisos).toContainEqual(expect.stringContaining("O pagamento tem mais de 78 dias"));
    expect(resultado).toMatchObject({ ok: true, devolucao: "recusada" });
    expect(pedidosDeDevolucao()).toEqual([]);
    expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ situacao: "recusada", falhas: 0, proximaTentativaEm: null, origem: "cancelamento" });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_fora_do_prazo");
    // O quadro do pagamento sabe que parou pelo prazo (a regra do domínio, não um palpite pelos números).
    expect((await pagamentosDaReserva(db, c.org, x.reservaId)).find((p) => p.id === x.pagamentoId)?.devolucao).toMatchObject({ situacao: "recusada", paradaPeloPrazo: true });
    // Pedir de novo ao Mercado Pago: recusado (mais de 78 dias).
    const { devolverPeloProvedor } = await import("./devolucao");
    expect(await devolverPeloProvedor(db, c.org, x.pagamentoId, equipe, c.provedor, minutos(70))).toMatchObject({ ok: false, erro: expect.stringContaining("mais de 78 dias") });
    expect(await registrarDevolucaoPorFora(db, c.org, x.pagamentoId, { data: "2026-10-01", valor: TOTAL, nota: "Pix da conta da empresa" }, equipe, c.provedor, minutos(70))).toEqual({ ok: true, situacao: "por_fora" });
    const dev = await devolucaoDe(x.pagamentoId);
    expect(dev).toMatchObject({ situacao: "por_fora", taxaPerdida: 1824 });
    expect((await c.tentativa(x.pagamentoId)).desfecho).toBe("reserva");
    expect((await cancelamentoDe(x.reservaId)).caixaLancadoEm).not.toBeNull();
    const despesa = (await doLivro(x.reservaId)).find((l) => l.tipo === "despesa_empresa");
    expect(despesa).toMatchObject({ valor: -1824, reservaId: x.reservaId, dataCaixa: "2026-10-01" });
  });

  it("devolução do cancelamento parada por outro motivo (o Mercado Pago mostra parte devolvida no painel): recusada sem falha nem código, mas não 'parada pelo prazo'", async () => {
    const x = await pagarEConfirmar(c, longe);
    c.provedor.respostaDevolucao = "em_andamento";
    const { resultado } = await cancelar(c, x.reservaId, entrada(), equipe, minutos(60));
    expect(resultado).toMatchObject({ ok: true, devolucao: "pedida" });
    c.provedor.devolverNoProvedor(x.idProvedor, 5000);
    await conferirPendentes(db, c.org, c.provedor, minutos(80));
    expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ situacao: "recusada", falhas: 0, origem: "cancelamento" });
    const avisos = (await c.tentativa(x.pagamentoId)).avisos;
    expect(avisos).toContain("devolucao_parada");
    expect(avisos).not.toContain("devolucao_fora_do_prazo");
    expect((await pagamentosDaReserva(db, c.org, x.reservaId)).find((p) => p.id === x.pagamentoId)?.devolucao).toMatchObject({ situacao: "recusada", paradaPeloPrazo: false });
  });

  it("cartão com mais de 85 dias: por fora recusado; confirmação da equipe só com a order fora da leitura; recusa do painel registrada libera o por fora", async () => {
    const x = await pagarEConfirmar(c, { ...longe, forma: "cartao" });
    await envelhecer(c, x.pagamentoId, 88);
    const { resultado } = await cancelar(c, x.reservaId, entrada(), equipe, minutos(60));
    expect(resultado).toMatchObject({ ok: true, devolucao: "recusada" });
    const porFora = (quando: Date) => registrarDevolucaoPorFora(db, c.org, x.pagamentoId, { data: "2026-10-01", valor: TOTAL, nota: "Transferência da empresa" }, equipe, c.provedor, quando);
    expect(await porFora(minutos(70))).toEqual({ ok: false, erro: ERRO_POR_FORA_CARTAO });
    // Confirmar a devolução vista no painel: com a order ainda legível, recusado (a leitura é aplicada); sem provedor
    // (order com menos de 90 dias), recusado.
    const confirmar = (provedor: typeof c.provedor | null) => confirmarDevolucaoVistaNoProvedor(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "Painel do Mercado Pago mostra o estorno" }, equipe, provedor, minutos(80));
    expect(await confirmar(c.provedor)).toMatchObject({ ok: false, erro: expect.stringContaining("ainda deixa conferir") });
    // A leitura feita para conferir foi aplicada (o pagamento foi relido agora), e nada da devolução mudou.
    expect((await c.tentativa(x.pagamentoId)).consultadoEm).toEqual(minutos(80));
    expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ situacao: "recusada", confirmadaPor: null });
    expect(await confirmar(null)).toEqual({ ok: false, erro: ERRO_POR_FORA_SEM_CONFERIR });
    // O painel do Mercado Pago recusou: registrado, o por fora no cartão passa a valer.
    expect(await registrarRecusaNoPainel(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "Painel do Mercado Pago recusou o estorno" }, equipe, minutos(90))).toEqual({ ok: true, situacao: "recusada" });
    expect((await devolucaoDe(x.pagamentoId)).recusaNoPainelEm).not.toBeNull();
    expect(await porFora(minutos(95))).toEqual({ ok: true, situacao: "por_fora" });
  });

  it("cartão com mais de 85 dias e a order que o Mercado Pago não acha mais: a equipe confirma a devolução feita no painel (caixa realizado)", async () => {
    const x = await pagarEConfirmar(c, { ...longe, forma: "cartao" });
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    await envelhecer(c, x.pagamentoId, 88);
    await cancelar(c, x.reservaId, entrada(), equipe, minutos(60));
    c.provedor.esquecerOrder(x.idProvedor);
    const r = await confirmarDevolucaoVistaNoProvedor(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "Painel do Mercado Pago mostra o estorno do valor integral" }, equipe, c.provedor, minutos(80));
    expect(r).toEqual({ ok: true, situacao: "confirmada" });
    expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ situacao: "confirmada", confirmadaPor: "equipe", confirmadaNota: "Painel do Mercado Pago mostra o estorno do valor integral" });
    expect((await doLivro(x.reservaId)).filter((l) => l.tipo === "devolucao")).toMatchObject([{ estado: "realizado", origem: "manual", dataCaixa: "2026-10-01" }]);
    const t = await c.tentativa(x.pagamentoId);
    expect(t.avisos).toContain("taxa_perdida_desconhecida");
    expect(t.avisos).not.toContain("devolucao_fora_do_prazo");
  });

  it("Pix com mais de 90 dias e cartão com mais de 180 dias: os avisos da prévia; no cartão depois dos 180 dias, a devolução por fora vale", async () => {
    const PIX_90 = "Pix com mais de 90 dias: pela regra do Banco Central, o Mercado Pago pode não conseguir devolver; a devolução por fora (Pix da conta da empresa) fica liberada.";
    const CARTAO_180 = "Cartão com mais de 180 dias: o Mercado Pago não devolve mais; a devolução será por fora.";
    const x = await pagarEConfirmar(c, longe);
    await envelhecer(c, x.pagamentoId, 80);
    const com80 = await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, minutos(60));
    expect(com80.ok && com80.previa.avisos).not.toContainEqual(PIX_90);
    await envelhecer(c, x.pagamentoId, 15);
    const com95 = await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, minutos(60));
    expect(com95.ok && com95.previa).toMatchObject({ rota: "fora_do_prazo", avisos: expect.arrayContaining([PIX_90]) });
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com", forma: "cartao" });
    await envelhecer(c, y.pagamentoId, 185);
    const { previa, resultado } = await cancelar(c, y.reservaId, entrada(), equipe, minutos(60));
    expect(previa.ok && previa.previa).toMatchObject({ rota: "fora_do_prazo", avisos: expect.arrayContaining([CARTAO_180]) });
    expect(previa.ok && previa.previa.avisos).not.toContainEqual(PIX_90);
    expect(resultado).toMatchObject({ ok: true, devolucao: "recusada" });
    expect(pedidosDeDevolucao()).toEqual([]);
    const pago = (await c.tentativa(y.pagamentoId)).valorPago!;
    expect(await registrarDevolucaoPorFora(db, c.org, y.pagamentoId, { data: "2026-10-01", valor: pago, nota: "Transferência da empresa" }, equipe, c.provedor, minutos(70))).toEqual({ ok: true, situacao: "por_fora" });
  });

  it("confirmar a devolução vista no painel: se a leitura já mostra a devolução, vale a leitura; data de antes de a devolução ser registrada, recusada", async () => {
    // Pedido aceito que não aparecia (aviso) e que o Mercado Pago concluiu: a releitura confirma, sem a nota da equipe.
    c.provedor.respostaDevolucao = "pedida";
    const x = await pagarEConfirmar(c, longe);
    await cancelar(c, x.reservaId, entrada(), equipe, minutos(60));
    await db.update(pagamentos).set({ avisos: ["devolucao_sem_confirmacao"] }).where(eq(pagamentos.id, x.pagamentoId));
    c.provedor.confirmarDevolucoes(x.idProvedor);
    const r = await confirmarDevolucaoVistaNoProvedor(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "Painel mostra o estorno" }, equipe, c.provedor, minutos(80));
    expect(r).toEqual({ ok: true, situacao: "confirmada", mensagem: "O Mercado Pago já mostra a devolução: confirmada pela leitura." });
    expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ situacao: "confirmada", confirmadaPor: "leitura", confirmadaNota: "" });
    expect((await doLivro(x.reservaId)).filter((l) => l.tipo === "devolucao")).toEqual([]);
    expect(await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, x.pagamentoId), eq(auditoria.acao, "pagamento.devolucao_confirmada_pela_equipe")))).toEqual([]);
    // Cartão velho com a order que o Mercado Pago não acha mais: a data não pode ser de antes da devolução registrada.
    c.provedor.respostaDevolucao = "confirmada";
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com", forma: "cartao" });
    await envelhecer(c, y.pagamentoId, 88);
    await cancelar(c, y.reservaId, entrada(), equipe, minutos(60));
    c.provedor.esquecerOrder(y.idProvedor);
    const confirmar = (data: string) => confirmarDevolucaoVistaNoProvedor(db, c.org, y.pagamentoId, { data, nota: "Painel mostra o estorno" }, equipe, c.provedor, minutos(80));
    expect(await confirmar("2026-09-30")).toEqual({ ok: false, erro: "A data não pode ser antes de a devolução ser registrada (01/10/2026)." });
    expect(await devolucaoDe(y.pagamentoId)).toMatchObject({ situacao: "recusada" });
    expect(await confirmar("2026-10-01")).toEqual({ ok: true, situacao: "confirmada" });
  });

  it("depois do prazo de leitura com a order ainda legível: sem aviso, a confirmação vem da leitura (recusada aqui); com o aviso de devolução aceita sem aparecer, a equipe confirma o que vê no painel", async () => {
    c.provedor.respostaDevolucao = "pedida";
    const x = await pagarEConfirmar(c, longe);
    await cancelar(c, x.reservaId, entrada(), equipe, minutos(60));
    await envelhecer(c, x.pagamentoId, 87);
    const confirmar = () => confirmarDevolucaoVistaNoProvedor(db, c.org, x.pagamentoId, { data: "2026-10-01", nota: "Painel mostra o estorno do valor integral" }, equipe, c.provedor, minutos(80));
    expect(await confirmar()).toMatchObject({ ok: false, erro: expect.stringContaining("ainda deixa conferir") });
    expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true });
    await db.update(pagamentos).set({ avisos: ["devolucao_sem_confirmacao"] }).where(eq(pagamentos.id, x.pagamentoId));
    expect(await confirmar()).toEqual({ ok: true, situacao: "confirmada" });
    expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ situacao: "confirmada", confirmadaPor: "equipe", chaveAceita: false });
    expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolucao_sem_confirmacao");
  });

  it("recusa do painel numa devolução ainda pedida: só depois do prazo de leitura e sem pedido aceito pelo Mercado Pago", async () => {
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    const x = await pagarEConfirmar(c, { ...longe, forma: "cartao" });
    await cancelar(c, x.reservaId, entrada(), equipe, minutos(60));
    expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: false, chaveEmDuvida: false, ultimoCodigo: "saldo_insuficiente" });
    const registrar = (pagamentoId: string, quando: Date) => registrarRecusaNoPainel(db, c.org, pagamentoId, { data: "2026-10-01", nota: "Painel recusou o estorno" }, equipe, quando);
    // Dentro do prazo de leitura: não (o sistema ainda pede e confere).
    expect(await registrar(x.pagamentoId, minutos(70))).toMatchObject({ ok: false, erro: expect.stringContaining("Só uma devolução recusada") });
    await envelhecer(c, x.pagamentoId, 88);
    expect(await registrar(x.pagamentoId, minutos(80))).toEqual({ ok: true, situacao: "recusada" });
    expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ situacao: "recusada", proximaTentativaEm: null, chaveEmDuvida: false, recusaNoPainelNota: "Painel recusou o estorno", recusaNoPainelPor: equipe });
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_falhou");
    // Com o pedido aceito pelo Mercado Pago (ainda pode sair por lá): não.
    c.provedor.respostaDevolucao = "pedida";
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com", forma: "cartao" });
    await cancelar(c, y.reservaId, entrada(), equipe, minutos(60));
    await envelhecer(c, y.pagamentoId, 88);
    expect(await devolucaoDe(y.pagamentoId)).toMatchObject({ situacao: "pedida", chaveAceita: true });
    expect(await registrar(y.pagamentoId, minutos(80))).toMatchObject({ ok: false, erro: expect.stringContaining("Só uma devolução recusada") });
  });

  it("já devolvido por inteiro no painel do Mercado Pago (D15): só integral; devolução confirmada pela leitura; caixa no dia em que o sistema viu; o aviso de devolvido por fora sai", async () => {
    const x = await pagarEConfirmar(c, longe);
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, sp("2026-10-03 10:00"), { origem: "painel", forcar: true });
    const p = await c.tentativa(x.pagamentoId);
    expect(p).toMatchObject({ situacao: "devolvido", devolvidoLido: TOTAL });
    expect(p.avisos).toContain("devolvido_por_fora");
    expect(p.devolvidoVistoEm).toEqual(sp("2026-10-03 10:00"));
    // D21: em conferência até o cancelamento.
    expect(await emConferencia(x.reservaId)).toBe(true);
    // Só integral: retido é recusado.
    await comPedido(x.reservaId, sp("2026-10-04 09:00"));
    const nenhum = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ decisao: "nenhum", motivoDecisao: "teste" }), c.provedor, sp("2026-10-04 10:00"));
    expect(nenhum).toMatchObject({ ok: false, codigo: "integral_nao_se_nega" });
    const { previa, resultado } = await cancelar(c, x.reservaId, entradaPadrao(), equipe, sp("2026-10-04 10:00"));
    expect(previa.ok && previa.previa.rota).toBe("ja_devolvida");
    expect(previa.ok && previa.previa.pergunta).toContain("— o Mercado Pago já devolveu?");
    expect(resultado).toMatchObject({ ok: true, devolucao: "confirmada" });
    expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ situacao: "confirmada", confirmadaPor: "leitura", valorConfirmado: TOTAL });
    expect((await doLivro(x.reservaId)).filter((l) => l.tipo === "devolucao")).toMatchObject([{ estado: "conciliado", dataCaixa: "2026-10-03" }]);
    const depois = await c.tentativa(x.pagamentoId);
    expect(depois.avisos).not.toContain("devolvido_por_fora");
    expect(depois.avisos).toContain("taxa_perdida_desconhecida");
    expect(await emConferencia(x.reservaId)).toBe(false);
    // Nenhum pedido ao Mercado Pago (já estava devolvido).
    expect(pedidosDeDevolucao()).toEqual([]);
  });

  it("já devolvido no painel do Mercado Pago e a política sem devolução (pedido depois do prazo): recusa que oferece a exceção; com a exceção, integral já devolvido", async () => {
    const x = await pagarEConfirmar(c);
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, sp("2026-10-09 09:00"), { origem: "painel", forcar: true });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido" });
    // Prazo integral até 28/09 e arrependimento até 08/10: um pedido em 09/10 não tem devolução pela política.
    await comPedido(x.reservaId, sp("2026-10-09 10:00"));
    const r = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao(), c.provedor, sp("2026-10-09 11:00"));
    expect(r).toEqual({
      ok: false,
      codigo: "decisao_obrigatoria",
      erro: "O Mercado Pago já mostra este pagamento devolvido por inteiro: registre como devolução integral (pela política ou por exceção, com o motivo).",
      escolha: "excecao",
    });
    // "Devolver tudo" (a escolha de quando não há política) não serve: a exceção, sim.
    expect(await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ decisao: "integral", motivoDecisao: "teste" }), c.provedor, sp("2026-10-09 11:00"))).toMatchObject({ ok: false, codigo: "dados", escolha: "excecao" });
    const entrada = entradaPadrao({ decisao: "excecao", motivoExcecao: "cortesia_comercial", motivoDecisao: "Já devolvido pelo painel do Mercado Pago" });
    const { previa, resultado } = await cancelar(c, x.reservaId, entrada, equipe, sp("2026-10-09 11:00"));
    expect(previa).toMatchObject({ ok: true, previa: { direito: "integral", base: "excecao", rota: "ja_devolvida", decisao: { calculado: "nenhum", base: "fora_do_prazo" } } });
    expect(resultado).toMatchObject({ ok: true, direito: "integral", devolucao: "confirmada" });
    expect(await cancelamentoDe(x.reservaId)).toMatchObject({ situacao: "cancelada", base: "excecao", calculado: "nenhum", motivoExcecao: "cortesia_comercial" });
    expect(pedidosDeDevolucao()).toEqual([]);
  });

  it("já devolvido sem o dia gravado (pagamento de antes da coluna): o dia da auditoria; sem ela, hoje, realizado e o aviso de conferir a data", async () => {
    for (const comAuditoria of [true, false]) {
      const x = await pagarEConfirmar(c, { ...longe, email: `d${comAuditoria}@example.com`, entrada: comAuditoria ? "2026-11-20" : "2026-11-25", saida: comAuditoria ? "2026-11-23" : "2026-11-27" });
      await liberar(c, x.pagamentoId, { quando: minutos(10) });
      c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
      await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, sp("2026-10-03 10:00"), { origem: "painel", forcar: true });
      await db.update(pagamentos).set({ devolvidoVistoEm: null }).where(eq(pagamentos.id, x.pagamentoId));
      const doDevolvido = and(eq(auditoria.acao, "pagamento.situacao"), eq(auditoria.entidadeId, x.pagamentoId), sql`${auditoria.mudancas} -> 'situacao' ->> 1 = 'devolvido'`);
      if (comAuditoria) await db.update(auditoria).set({ criadoEm: sp("2026-10-02 18:00") }).where(doDevolvido);
      else await db.delete(auditoria).where(doDevolvido);
      await cancelar(c, x.reservaId, entrada(), equipe, sp("2026-10-04 10:00"));
      const [saida] = (await doLivro(x.reservaId)).filter((l) => l.tipo === "devolucao");
      if (comAuditoria) expect(saida).toMatchObject({ estado: "conciliado", dataCaixa: "2026-10-02" });
      else {
        expect(saida).toMatchObject({ estado: "realizado", dataCaixa: "2026-10-04" });
        expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolucao_data_a_conferir");
      }
    }
  });
});

describe("pedido, descarte, OTAs, avisado e idempotência (M8.2c)", () => {
  it("pedido da equipe: um por vez; descartar (motivo obrigatório) deixa no histórico; pedido pelo site só se descarta como desistência, por quem cuida do financeiro", async () => {
    const x = await pagarEConfirmar(c, longe);
    await comPedido(x.reservaId, minutos(30), minutos(40));
    expect(await pedir(c, x.reservaId, equipe, { recebidoEm: minutos(35), quando: minutos(41) })).toEqual({ ok: false, erro: "Já há um pedido registrado em 01/10 às 12:30." });
    expect(await pedir(c, x.reservaId, equipe, { recebidoEm: minutos(35), quando: minutos(41), nota: "Telefone 21 99999-0000" })).toMatchObject({ ok: false, erro: expect.stringContaining("dados pessoais") });
    const autor = { id: equipe, podeFinanceiro: false };
    expect(await descartarPedidoDeCancelamento(db, c.org, x.reservaId, { motivo: "" }, autor, minutos(50))).toMatchObject({ ok: false });
    expect(await descartarPedidoDeCancelamento(db, c.org, x.reservaId, { motivo: "O hóspede confirmou que vem" }, autor, minutos(50))).toEqual({ ok: true });
    expect(await cancelamentoDe(x.reservaId)).toMatchObject({ situacao: "descartado", descartadoPor: equipe, descarteMotivo: "O hóspede confirmou que vem" });
    // Pedido pelo site: só como desistência, com o canal e a hora, por quem tem o financeiro.
    const site = await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60));
    expect(site).toMatchObject({ ok: true, recebidoEm: minutos(60) });
    expect(await descartarPedidoDeCancelamento(db, c.org, x.reservaId, { motivo: "Desistiu" }, autor, minutos(70))).toEqual({ ok: false, erro: "Pedido feito pelo hóspede no site: só quem cuida do financeiro descarta, como desistência do hóspede." });
    const fin = { id: equipe, podeFinanceiro: true };
    expect(await descartarPedidoDeCancelamento(db, c.org, x.reservaId, { motivo: "Desistiu por WhatsApp" }, fin, minutos(70))).toMatchObject({ ok: false, erro: expect.stringContaining("Informe por onde e quando") });
    expect(await descartarPedidoDeCancelamento(db, c.org, x.reservaId, { motivo: "Desistiu por WhatsApp", desistencia: { canal: "whatsapp", em: minutos(65) } }, fin, minutos(70))).toEqual({ ok: true });
    const linhas = await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId));
    expect(linhas.map((l) => l.situacao)).toEqual(["descartado", "descartado"]);
    expect(linhas.find((l) => l.canal === "site")).toMatchObject({ descarteMotivo: "O hóspede desistiu do pedido: Desistiu por WhatsApp", desistenciaCanal: "whatsapp", desistenciaEm: minutos(65) });
    // A prévia mostra os descartados (e avisa do pedido pelo site descartado antes do horário usado).
    const p = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ recebidoEm: minutos(80), canal: "telefone" }), c.provedor, minutos(90));
    if (!p.ok) throw new Error(p.erro);
    expect(p.previa.descartados).toHaveLength(2);
    expect(p.previa.avisos).toContainEqual(expect.stringContaining("Há um pedido pelo site de 01/10 às 13:00 descartado como desistência"));
  });

  it("o quadro na ficha (cancelamentoDaReserva): o pedido, os descartados, a decisão, o desconto da dona e as mensagens prontas", async () => {
    const x = await pagarEConfirmar(c);
    expect(await cancelamentoDaReserva(db, c.org, x.reservaId, minutos(5))).toBeNull();
    expect(await cancelamentoDaReserva(db, c.org, "nao-e-uuid", minutos(5))).toBeNull();
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    await comPedido(x.reservaId, minutos(20), minutos(25));
    expect(await descartarPedidoDeCancelamento(db, c.org, x.reservaId, { motivo: "O hóspede confirmou que vem" }, { id: equipe, podeFinanceiro: false }, minutos(30))).toEqual({ ok: true });
    await comPedido(x.reservaId, sp("2026-10-05 10:00"));
    const pedido = await cancelamentoDaReserva(db, c.org, x.reservaId, sp("2026-10-05 11:00"));
    expect(pedido).toMatchObject({ situacao: "pedido", canal: "whatsapp", pedidoPor: "Equipe Fictícia", pedidoRecebidoEm: sp("2026-10-05 10:00"), direito: null, descontos: [], ota: null });
    expect(pedido?.descartados).toMatchObject([{ em: minutos(20), canal: "whatsapp", motivo: "O hóspede confirmou que vem", por: "Equipe Fictícia" }]);
    // Pedido da equipe (não pelo site): a mensagem "pedido recebido" pronta para copiar.
    expect(pedido?.mensagens.recebido?.falta).toEqual(["link"]);
    await repassar(c, "antecipado", { hoje: "2026-10-13" });
    await cancelar(c, x.reservaId, entradaPadrao(), equipe, sp("2026-11-03 10:00"));
    const decidido = await cancelamentoDaReserva(db, c.org, x.reservaId, sp("2026-11-03 11:00"));
    expect(decidido).toMatchObject({ situacao: "cancelada", direito: "integral", base: "arrependimento", canceladaPor: "Equipe Fictícia", espelhado: true, valorPago: TOTAL, valorADevolver: TOTAL });
    expect(decidido?.descontos).toHaveLength(1);
    expect(decidido?.descontos[0]).toMatchObject({ situacao: { tipo: "a_descontar" } });
    expect(decidido?.descontos[0].valor).toBeGreaterThan(0);
    expect(decidido?.mensagens.decidido).not.toBeNull();
    expect(JSON.stringify(decidido)).not.toContain(EMAIL_HOSPEDE);
  });

  it("datas reabertas nas OTAs e mensagem enviada ao hóspede: uma vez, no cancelamento decidido", async () => {
    const x = await pagarEConfirmar(c, longe);
    expect(await marcarOtaLiberada(db, c.org, x.reservaId, equipe, minutos(10))).toMatchObject({ ok: false });
    await comPedido(x.reservaId, minutos(20), minutos(25));
    expect(await marcarHospedeAvisado(db, c.org, x.reservaId, "pedido", equipe, minutos(26))).toEqual({ ok: true });
    expect(await marcarHospedeAvisado(db, c.org, x.reservaId, "pedido", equipe, minutos(27))).toMatchObject({ ok: false });
    expect(await marcarHospedeAvisado(db, c.org, x.reservaId, "decisao", equipe, minutos(27))).toMatchObject({ ok: false, erro: "O cancelamento ainda não foi decidido." });
    await cancelar(c, x.reservaId, entradaPadrao(), equipe, minutos(60));
    expect(await marcarOtaLiberada(db, c.org, x.reservaId, equipe, minutos(70))).toEqual({ ok: true });
    expect(await marcarOtaLiberada(db, c.org, x.reservaId, equipe, minutos(71))).toMatchObject({ ok: false, erro: expect.stringContaining("já foram marcadas") });
    expect(await marcarHospedeAvisado(db, c.org, x.reservaId, "decisao", equipe, minutos(72))).toEqual({ ok: true });
    expect(await marcarHospedeAvisado(db, c.org, x.reservaId, "devolucao", equipe, minutos(72))).toEqual({ ok: true });
    expect(await cancelamentoDe(x.reservaId)).toMatchObject({ otaLiberadaPor: equipe, hospedeAvisadoPedidoPor: equipe, hospedeAvisadoDecisaoPor: equipe, hospedeAvisadoDevolucaoPor: equipe });
  });

  it("acerto idempotente: rodar o resultado e o caixa de novo não lança nada", async () => {
    const x = await pagarEConfirmar(c, longe);
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "outro" }), equipe, minutos(60));
    const antes = (await doLivro(x.reservaId)).length;
    await db.transaction(async (tx) => {
      const t = (await travarCotacao(tx, c.org, x.cotacaoId))!;
      const p = t.tentativas.find((y) => y.id === x.pagamentoId)!;
      expect(await acertarResultado(tx, c.org, t, p, { direito: "integral" }, null, minutos(70))).toEqual({ avisos: [] });
      expect(await acertarCaixa(tx, c.org, t, p, t.devolucoes[0], { data: "2026-10-01", estado: "conciliado", origem: "sincronizacao" }, minutos(70))).toEqual({ avisos: [] });
    });
    expect((await doLivro(x.reservaId)).length).toBe(antes);
    expect(await conferirPendentes(db, c.org, c.provedor, minutos(200), { forcar: true })).toMatchObject({ falhas: 0 });
    expect((await doLivro(x.reservaId)).length).toBe(antes);
  });

  it("aprovação tardia de outra tentativa depois do cancelamento: fica sem reserva ('outra tentativa'), pelo caminho da devolução do M8.2a", async () => {
    const x = await pagarEConfirmar(c, longe);
    await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "outro" }), equipe, minutos(60));
    const p = await c.tentativa(x.pagamentoId);
    const [outra] = await db
      .insert(pagamentos)
      .values({ organizacaoId: c.org, cotacaoId: x.cotacaoId, reservaId: x.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: "scl-tardia", chaveIdempotencia: "tardia", situacao: "pendente", valor: p.valor, criadoEm: minutos(5) })
      .returning();
    const order = c.provedor.todas().find((o) => o.idProvedor === x.idProvedor)!;
    await conferirTentativa(db, c.org, outra.id, c.provedor, minutos(70), { origem: "painel", forcar: true, cobranca: { ...order, idProvedor: "ORDTARDIA01", referencia: "scl-tardia", situacao: "aprovado", devolvido: 0, devolucoes: [] } });
    expect(await c.tentativa(outra.id)).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "outra_tentativa" });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "cancelada" });
  });

  it("dados pessoais: depois dos fluxos, nada do hóspede nas tabelas do pagamento, do cancelamento e do livro", async () => {
    const x = await pagarEConfirmar(c, longe);
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(20));
    await cancelar(c, x.reservaId, entradaPadrao({ nota: "Pedido em Minha reserva" }), equipe, minutos(60));
    await registrarTaxaPerdida(db, c.org, x.pagamentoId, 1000, equipe, minutos(70));
    expect(await semDadosDoHospede(db)).toEqual([]);
    // A varredura acha o nome se ele vazar para uma tabela nova (aqui, posto à mão numa nota e tirado de volta).
    const canc = await cancelamentoDe(x.reservaId);
    await db.update(cancelamentosReserva).set({ nota: `Pedido de ${NOME_HOSPEDE}` }).where(eq(cancelamentosReserva.id, canc.id));
    expect(await semDadosDoHospede(db)).toEqual([NOME_HOSPEDE]);
    await db.update(cancelamentosReserva).set({ nota: canc.nota }).where(eq(cancelamentosReserva.id, canc.id));
  });

  it("a cotação cancelada continua ligada ao pagamento; a reserva cancelada sai das reservas que o motor calcula", async () => {
    const x = await pagarEConfirmar(c, longe);
    await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "outro" }), equipe, minutos(60));
    const [cot] = await db.select().from(cotacoes).where(eq(cotacoes.id, x.cotacaoId));
    expect(cot).toMatchObject({ estado: "cancelada", reservaId: x.reservaId });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: "reserva" });
  });
});

describe("ao mesmo tempo: antecipado, conferência e outro clique (M8.2c)", () => {
  // O PGlite dos testes tem uma conexão só e serializa as transações: quem chega com uma transação aberta espera ela
  // terminar inteira, como quem espera a trava no Postgres. Os dois primeiros casos abrem a corrida de dentro da transação
  // do outro (a ordem fica certa); os outros conferem, nas duas ordens, que o resultado é sempre um dos permitidos. A trava
  // ocupada (55P03/40P01) tem teste próprio em "recusas e a assinatura da prévia".
  const entrada = () => entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" });

  it("o antecipado com a transação aberta (dono e reservas travados) e o cancelamento esperando: depois que ele grava, o cancelamento responde repasse_a_pagar e nada muda", async () => {
    const x = await pagarEConfirmar(c);
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    const quando = sp("2026-10-13 10:00");
    const p = await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, quando);
    if (!p.ok) throw new Error(p.erro);
    const original = db.transaction.bind(db);
    let cancelamento: ReturnType<typeof cancelarReservaPaga> | null = null;
    const espiao = vi.spyOn(db, "transaction").mockImplementationOnce(async (fn) =>
      original(async (tx) => {
        // A transação do antecipado está aberta: o cancelamento começa agora e espera por ela (nada aqui o aguarda).
        cancelamento = cancelarReservaPaga(db, c.org, x.reservaId, entrada(), equipe, c.provedor, quando, p.previa.assinatura);
        return fn(tx);
      }),
    );
    const rep = await gerarAntecipado(db, c.org, c.dono, "2026-10-13", null, { agora: quando });
    espiao.mockRestore();
    expect(rep).toMatchObject({ ok: true });
    expect(await cancelamento).toMatchObject({ ok: false, codigo: "repasse_a_pagar" });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "confirmada" });
    expect(await cancelamentoDe(x.reservaId)).toBeUndefined();
    expect((await motorEmVigor(x.reservaId)).length).toBe(4);
    expect(pedidosDeDevolucao()).toEqual([]);
  });

  it("o cancelamento com a transação aberta e o antecipado esperando: depois que ele grava, o antecipado não acha a parte (nunca cancelada com a parte num repasse a pagar)", async () => {
    // Pagamento fora do prazo de leitura: o cancelamento não relê nada antes, e a primeira transação dele é a da fase 1.
    const x = await pagarEConfirmar(c);
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    await envelhecer(c, x.pagamentoId, 90);
    const quando = sp("2026-10-13 10:00");
    const p = await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, quando);
    if (!p.ok) throw new Error(p.erro);
    const original = db.transaction.bind(db);
    let antecipado: ReturnType<typeof gerarAntecipado> | null = null;
    const espiao = vi.spyOn(db, "transaction").mockImplementationOnce(async (fn) =>
      original(async (tx) => {
        antecipado = gerarAntecipado(db, c.org, c.dono, "2026-10-13", null, { agora: quando });
        return fn(tx);
      }),
    );
    const canc = await cancelarReservaPaga(db, c.org, x.reservaId, entrada(), equipe, c.provedor, quando, p.previa.assinatura);
    espiao.mockRestore();
    expect(canc).toMatchObject({ ok: true, direito: "integral", devolucao: "recusada" });
    expect(await antecipado).toMatchObject({ ok: false });
    expect(await repasseAPagarDaReservaDados(db, c.org, x.reservaId)).toBeNull();
    expect(await motorEmVigor(x.reservaId)).toEqual([]);
  });

  it("a conferência do pagamento e o cancelamento juntos: um pedido de devolução só, confirmada pela leitura, o motor estornado uma vez", async () => {
    for (const primeiro of ["conferencia", "cancelamento"] as const) {
      c = await montarCenario(db);
      equipe = await usuarioDeTeste(c);
      const x = await pagarEConfirmar(c, longe);
      const p = await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, minutos(60));
      if (!p.ok) throw new Error(p.erro);
      const conferencia = () => conferirTentativa(db, c.org, x.pagamentoId, c.provedor, minutos(61), { origem: "rotina", forcar: true });
      const cancelamento = () => cancelarReservaPaga(db, c.org, x.reservaId, entrada(), equipe, c.provedor, minutos(61), p.previa.assinatura);
      const [conf, canc] = primeiro === "conferencia" ? await Promise.all([conferencia(), cancelamento()]) : (await Promise.all([cancelamento(), conferencia()])).reverse() as [Awaited<ReturnType<typeof conferencia>>, Awaited<ReturnType<typeof cancelamento>>];
      expect(conf).toMatchObject({ ok: true });
      expect(canc).toMatchObject({ ok: true, direito: "integral", devolucao: "confirmada" });
      expect(pedidosDeDevolucao()).toHaveLength(1);
      const livro = await doLivro(x.reservaId);
      expect(livro.filter((l) => l.origem === "estorno")).toHaveLength(4);
      expect(livro.filter((l) => l.origem === "cancelamento")).toEqual([]);
      expect(await devolucaoDe(x.pagamentoId)).toMatchObject({ situacao: "confirmada", confirmadaPor: "leitura" });
      expect((await c.tentativa(x.pagamentoId)).avisos).not.toContain("devolvido_por_fora");
    }
  });

  it("dois cliques ao mesmo tempo: um cancela, o outro responde 'já cancelada'; um pedido de devolução só", async () => {
    const x = await pagarEConfirmar(c, longe);
    const p = await previaDoCancelamento(db, c.org, x.reservaId, entrada(), c.provedor, minutos(60));
    if (!p.ok) throw new Error(p.erro);
    const clique = () => cancelarReservaPaga(db, c.org, x.reservaId, entrada(), equipe, c.provedor, minutos(61), p.previa.assinatura);
    const rs = await Promise.all([clique(), clique()]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)).toMatchObject({ ok: false, codigo: "ja_cancelada" });
    expect(pedidosDeDevolucao()).toHaveLength(1);
    expect(await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId))).toHaveLength(1);
    expect((await doLivro(x.reservaId)).filter((l) => l.origem === "estorno")).toHaveLength(4);
  });
});
