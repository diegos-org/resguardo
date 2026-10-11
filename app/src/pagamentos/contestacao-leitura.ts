/**
 * Contestação do pagamento no site (M8.2e) — a leitura sob a trava: o que a order, a Chargebacks API e a Payments API
 * mostram de uma disputa vira linha de `contestacoes_pagamento` (ou atualiza uma), sempre dentro de `travarCotacao` (a
 * mesma transação de `aplicarLeitura`, ou a da rotina e do registro pela equipe). Nada aqui chama o provedor.
 *
 * - Casamento e transições pelas regras puras (`casarContestacao`, `transicaoDaContestacao`, `novaContestacao`); a ordem
 *   das leituras (`lida_em`, `atualizado_no_provedor_em`) descarta as velhas.
 * - A linha do tempo (`eventos_contestacao`): o que o sistema leu (usuário null) e o que a equipe fez.
 * - O valor em risco de cada disputa não final é recalculado e gravado a cada mudança (`recalcularDisputas`), com o retido
 *   previsto no caixa (lançamento `devolucao`, montante = valor em risco, valor 0, chave `…:retido`, `#N` quando muda).
 * - A disputa que abre substitui as devoluções do pagamento ainda não pedidas ao Mercado Pago (pedida sem aceite, ou
 *   recusada): elas param e ficam ligadas a ela (`devolucoes_pagamento.contestacao_id`), porque o dinheiro volta ao
 *   hóspede pela disputa.
 * - Os avisos de cada disputa ficam nela; o pagamento leva a união deles (`avisosComContestacoes`, o gêmeo de
 *   `avisosComDevolucoes`) e o aviso `contestado` só com uma disputa em curso.
 */
import { and, eq, like, or } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { contestacoesPagamento, type DesfechoPagamento, devolucoesPagamento, eventosContestacao, lancamentos, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { estornar, type Lancamento, lancar } from "@/financeiro/ledger";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { hojeISO } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { avisosComDevolucoes, trocarAvisosDaDevolucao } from "./avisos-devolucao";
import {
  AVISOS_DE_CONTESTACAO,
  chavesDaContestacao,
  contestacaoNaoFinal,
  casarContestacao,
  type DadosDoEvento,
  DESCRICAO_RETIDO_PREVISTO,
  disputaDoPagamento,
  esperaDaLeituraDaContestacao,
  type FonteEventoContestacao,
  type LeituraDeContestacao,
  leituraEmDisputa,
  NOMES_TIPO_CONTESTACAO,
  novaContestacao,
  ORIGEM_LANCAMENTO_CONTESTACAO,
  type SituacaoPagamentoAntes,
  type TipoEventoContestacao,
  transicaoDaContestacao,
  valorEmRisco,
  valorSeguradoDesatualizado,
} from "./contestacao-regras";
import { type CasoDeContestacao, type Cobranca, estadoLidoDaContestacao, type SituacaoDoPagamento, type StatusTresDS } from "./provedor";
import { origemDeDevolucaoConhecida } from "./situacoes";
import { type Contestacao, contestacoesDoPagamento, type Devolucao, devolucoesDoPagamento, devolvidoProprio, dinheiroDaReserva, type Pagamento, type Travado, valorPagoAprovado } from "./travas";

const FUSO = "America/Sao_Paulo";
const dataBr = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
const iguais = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------- avisos: a união no pagamento

/**
 * Os avisos de contestação que moram em cada linha. `contestacao_ambigua` é do pagamento (a leitura que não se liga a
 * nenhuma linha com segurança não tem onde ficar): liga e desliga só nele.
 */
const DA_LINHA: readonly string[] = AVISOS_DE_CONTESTACAO.filter((a) => a !== "contestacao_ambigua");

/**
 * Os avisos do pagamento com a união dos avisos das disputas dele (puro; o gêmeo de `avisosComDevolucoes`). O aviso
 * `contestado` é o retrato do "em curso" (`disputaDoPagamento` em curso: alguma disputa aberta ou a confirmar, ou uma ganha
 * que o Mercado Pago voltou a mostrar em andamento), recalculado em toda gravação; sem nenhuma linha (lido antes do M8.2e,
 * ou uma leitura ambígua), fica o que a leitura deu.
 */
export function avisosComContestacoes(
  avisosDoPagamento: readonly string[],
  contestacoes: readonly Pick<Contestacao, "pagamentoId" | "situacao" | "avisos" | "estadoLido">[],
  pagamentoId: string,
): string[] {
  const linhas = contestacoes.filter((c) => c.pagamentoId === pagamentoId);
  const proprios = avisosDoPagamento.filter((a) => !DA_LINHA.includes(a) && (a !== "contestado" || !linhas.length));
  const emCurso = linhas.length > 0 && disputaDoPagamento({ contestacoes: linhas }, pagamentoId) === "em_curso";
  return [...new Set([...proprios, ...(emCurso ? ["contestado"] : []), ...linhas.flatMap((c) => c.avisos)])];
}

/** Recalcula e grava os avisos do pagamento (os dele, a união dos das devoluções e a das disputas), numa escrita só. */
export async function sincronizarAvisosDaDisputa(tx: Db, t: Pick<Travado, "devolucoes" | "contestacoes">, p: Pagamento, agora: Date, o: { ambigua?: boolean | null } = {}): Promise<void> {
  let lista = avisosComContestacoes(avisosComDevolucoes(p.avisos, t.devolucoes, p.id), t.contestacoes, p.id);
  if (o.ambigua === true && !lista.includes("contestacao_ambigua")) lista = [...lista, "contestacao_ambigua"];
  if (o.ambigua === false) lista = lista.filter((a) => a !== "contestacao_ambigua");
  if (iguais(lista, p.avisos)) return;
  await tx.update(pagamentos).set({ avisos: lista, atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
  p.avisos = lista;
}

/** Liga ou desliga avisos de uma disputa (sob a trava; o retrato muda junto). Devolve se mudou. */
export async function trocarAvisosDaContestacao(tx: Db, l: Contestacao, o: { ligar?: readonly string[]; desligar?: readonly string[] }, agora: Date): Promise<boolean> {
  const avisos = new Set(l.avisos);
  for (const a of o.desligar ?? []) avisos.delete(a);
  for (const a of o.ligar ?? []) avisos.add(a);
  const lista = [...avisos];
  if (iguais(lista, l.avisos)) return false;
  await tx.update(contestacoesPagamento).set({ avisos: lista, atualizadoEm: agora }).where(eq(contestacoesPagamento.id, l.id));
  l.avisos = lista;
  return true;
}

// ---------------------------------------------------------------- a linha do tempo

/** Um evento da disputa (`eventos_contestacao`): só códigos, datas e centavos; `usuarioId` null = o sistema. Nunca notas. */
export async function registrarEventoDaContestacao(
  tx: Db,
  contestacaoId: string,
  e: { fonte: FonteEventoContestacao; tipo: TipoEventoContestacao; antes?: DadosDoEvento | null; depois?: DadosDoEvento | null; usuarioId?: string | null },
  em: Date,
): Promise<void> {
  await tx.insert(eventosContestacao).values({ contestacaoId, fonte: e.fonte, tipo: e.tipo, antes: e.antes ?? null, depois: e.depois ?? null, usuarioId: e.usuarioId ?? null, em });
}

// ---------------------------------------------------------------- de cada fonte para uma leitura

/**
 * As contestações que a order mostra, como leituras (`lidaEm` = o início da chamada que leu). A transação de volta a
 * processed/accredited com uma contestação conhecida é guardada como fato (`voltouAAprovada`), nunca como resultado. Sem
 * nenhum item e com a order já aprovada de novo, `comDisputaLida` (o pagamento foi contestado por uma leitura e tem
 * disputa no cartão não final) dá uma leitura sem identificação com esse fato, para a disputa ir a "resultado a conferir".
 */
export function leiturasDaOrder(c: Pick<Cobranca, "contestacoes" | "transacaoAprovada" | "aoVivo" | "situacao">, lidaEm: Date, o: { comDisputaLida?: boolean } = {}): LeituraDeContestacao[] {
  if (!c.contestacoes.length) {
    if (o.comDisputaLida && c.transacaoAprovada && c.situacao === "aprovado")
      return [{ fonte: "order", idCaso: null, idContestacao: null, estadoLido: null, coberturaAplicada: null, valor: null, voltouAAprovada: true, aoVivo: c.aoVivo, lidaEm, atualizadoNoProvedorEm: null }];
    // Contestada sem nada que diga qual nem em que estado (a mesma leitura de `contestacaoDaLeitura`): nunca cria linha nem
    // muda uma; sem linha que a explique, vira o aviso `contestacao_ambigua`.
    if (c.situacao === "contestado") return [{ fonte: "order", idCaso: null, idContestacao: null, estadoLido: "desconhecido", coberturaAplicada: null, valor: null, aoVivo: c.aoVivo, lidaEm, atualizadoNoProvedorEm: null }];
    return [];
  }
  return c.contestacoes.map((x) => ({
    fonte: "order" as const,
    idCaso: x.idCaso,
    idContestacao: x.idContestacao,
    idTransacao: x.idTransacao,
    estadoLido: x.estadoLido,
    codigo: x.codigo,
    coberturaAplicada: null,
    valor: x.valor,
    voltouAAprovada: c.transacaoAprovada,
    aoVivo: c.aoVivo,
    lidaEm,
    atualizadoNoProvedorEm: null,
  }));
}

/** Um caso da Chargebacks API como leitura (já conferido como deste pagamento): sem estado, com a cobertura, a documentação e o prazo. */
export const leituraDoCaso = (caso: CasoDeContestacao, lidaEm: Date): LeituraDeContestacao => ({
  fonte: "chargebacks",
  idCaso: caso.idCaso,
  idContestacao: null,
  estadoLido: null,
  coberturaAplicada: caso.coberturaAplicada,
  coberturaElegivel: caso.coberturaElegivel,
  valor: caso.valor,
  documentacao: caso.documentacao,
  prazoDocumentacao: caso.prazoDocumentacao,
  motivoId: caso.motivoId,
  motivoCodigo: caso.motivoCodigo,
  aoVivo: caso.aoVivo,
  abertaNoProvedorEm: caso.criadoEm,
  lidaEm,
  atualizadoNoProvedorEm: caso.atualizadoEm,
});

/**
 * A Payments API pelo número como leitura (a terceira fonte, depois dos 85 dias): `charged_back/<estado>` dá o estado;
 * `approved` de um pagamento que uma leitura contestou (`contestado`) é o fato "a transação voltou a aprovada". Outra
 * situação não diz nada da disputa (null). Fala só da contestação no cartão (`soDoTipo`): o MED e a reclamação
 * registrados no mesmo pagamento não recebem a leitura.
 */
export function leituraDaSituacao(s: SituacaoDoPagamento, lidaEm: Date, contestado: boolean): LeituraDeContestacao | null {
  const base = { fonte: "payments" as const, idCaso: null, idContestacao: null, coberturaAplicada: null, valor: null, lidaEm, atualizadoNoProvedorEm: null, soDoTipo: "chargeback" as const };
  if (s.status === "charged_back") return { ...base, estadoLido: estadoLidoDaContestacao(s.statusDetail), codigo: s.statusDetail };
  if (s.status === "approved" && contestado) return { ...base, estadoLido: null, voltouAAprovada: true };
  return null;
}

// ---------------------------------------------------------------- o retido no caixa

/** As chaves `…:retido` já usadas por esta disputa (para a próxima `#N`). */
async function proximaChaveDoRetido(tx: Db, organizacaoId: string, pagamentoId: string, contestacaoId: string): Promise<string> {
  const chaves = chavesDaContestacao(pagamentoId, contestacaoId);
  const base = chaves.retido();
  const usadas = new Set(
    (await tx.select({ chave: lancamentos.chaveOrigem }).from(lancamentos).where(and(eq(lancamentos.organizacaoId, organizacaoId), or(eq(lancamentos.chaveOrigem, base), like(lancamentos.chaveOrigem, `${base}#%`))))).map((l) => l.chave),
  );
  let n = 1;
  while (usadas.has(chaves.retido(n))) n++;
  return chaves.retido(n);
}

/** O retido em vigor da disputa (o lançamento dela, se ainda não foi estornado), ou null. */
async function lancamentoDoRetido(tx: Db, organizacaoId: string, l: Pick<Contestacao, "retidoLancamentoId">): Promise<Lancamento | null> {
  if (!l.retidoLancamentoId) return null;
  const [x] = await tx.select().from(lancamentos).where(and(eq(lancamentos.id, l.retidoLancamentoId), eq(lancamentos.organizacaoId, organizacaoId)));
  if (!x) return null;
  const [estorno] = await tx.select({ id: lancamentos.id }).from(lancamentos).where(eq(lancamentos.estornoDe, x.id)).limit(1);
  return estorno ? null : x;
}

/**
 * O retido previsto da disputa (só a do dinheiro da reserva: o de um pagamento sem reserva nunca entrou no livro): linha
 * `devolucao`, `montante` = valor em risco, valor 0, `previsto`, sem data de caixa, competência do dia da abertura, chave
 * `…:retido`. Quando o valor em risco muda antes de a equipe confirmar o débito, a prevista é estornada e nasce a `#N`
 * (valor em risco 0: só o estorno). O retido realizado (confirmado pela equipe, ou o do MED lido como devolução) nunca muda
 * aqui. Sob as travas de quem chama (a do motor da reserva é tomada antes do livro).
 */
export async function acertarRetidoPrevisto(tx: Db, organizacaoId: string, t: Travado, p: Pick<Pagamento, "id" | "desfecho">, l: Contestacao, agora: Date): Promise<void> {
  if (!dinheiroDaReserva(p) || !contestacaoNaoFinal(l.situacao) || l.retidoConfirmadoEm) return;
  const atual = await lancamentoDoRetido(tx, organizacaoId, l);
  if (atual && atual.estado !== "previsto") return;
  const alvo = l.valorEmRisco;
  if (atual ? atual.montante === alvo : alvo <= 0) return;
  await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
  if (atual) await estornar(tx, organizacaoId, atual.id, `valor em disputa mudou para ${formatBRL(alvo)}`, null);
  let id: string | null = null;
  if (alvo > 0) {
    const [novo] = await lancar(
      tx,
      organizacaoId,
      [
        {
          tipo: "devolucao",
          descricao: `Reserva ${t.reserva.codigo} — ${DESCRICAO_RETIDO_PREVISTO}`,
          valor: 0,
          efeitoSaldo: 0,
          montante: alvo,
          competencia: hojeISO(FUSO, l.abertaEm),
          dataCaixa: null,
          estado: "previsto",
          imovelId: t.reserva.imovelId,
          reservaId: t.reserva.id,
          origem: ORIGEM_LANCAMENTO_CONTESTACAO,
          chaveOrigem: await proximaChaveDoRetido(tx, organizacaoId, p.id, l.id),
        },
      ],
      null,
    );
    id = novo.id;
  }
  await tx.update(contestacoesPagamento).set({ retidoLancamentoId: id, atualizadoEm: agora }).where(eq(contestacoesPagamento.id, l.id));
  l.retidoLancamentoId = id;
  await registrarEventoDaContestacao(tx, l.id, { fonte: "sistema", tipo: "caixa", antes: { retidoPrevisto: atual?.montante ?? null }, depois: { retidoPrevisto: alvo > 0 ? alvo : null } }, agora);
}

/**
 * Quanto da devolução que a leitura mostra este MED (ou reclamação) explica: o devolvido lido menos o reconhecido devolvido
 * fora, as devoluções do próprio sistema e o valor das outras disputas MED/reclamação do pagamento (as mais antigas
 * primeiro), nunca mais que o valor em risco dela. É o fato lido: o que de fato saiu do caixa.
 */
export function devolvidoExplicadoPelaDisputa(
  t: Pick<Travado, "contestacoes" | "devolucoes">,
  p: Pick<Pagamento, "id" | "devolvidoLido" | "devolvidoForaReconhecido">,
  l: Pick<Contestacao, "id" | "valorEmRisco" | "abertaEm">,
): number {
  const outras = t.contestacoes
    .filter((c) => c.pagamentoId === p.id && c.id !== l.id && (c.tipo === "med" || c.tipo === "reclamacao") && c.situacao !== "sem_efeito" && c.abertaEm.getTime() <= l.abertaEm.getTime())
    .reduce((s, c) => s + Math.max(0, c.valor ?? 0), 0);
  const lido = p.devolvidoLido - p.devolvidoForaReconhecido - devolvidoProprio(devolucoesDoPagamento(t, p.id)) - outras;
  return Math.max(0, Math.min(l.valorEmRisco, lido));
}

/**
 * O retido realizado do MED (ou da reclamação) que a leitura mostra como devolução: a saída de caixa já aconteceu, no dia em
 * que a leitura viu a devolução (`devolvido_visto_em`; sem ele, hoje), pelo que o Mercado Pago mostra devolvido e esta
 * disputa explica (`devolvidoExplicadoPelaDisputa`, até o valor em risco): um registro acima do devolvido lido não vira
 * saída de caixa que não existiu (o resto entra no caixa final, se o Mercado Pago debitar). O retido previsto (registrado
 * antes de a leitura ver a devolução) é estornado. Só no dinheiro da reserva e uma vez (a disputa sem retido realizado).
 * Devolve o montante lançado (null = nada lançado).
 */
export async function lancarRetidoRealizado(
  tx: Db,
  organizacaoId: string,
  t: Travado,
  p: Pick<Pagamento, "id" | "desfecho" | "devolvidoVistoEm" | "devolvidoLido" | "devolvidoForaReconhecido">,
  l: Contestacao,
  agora: Date,
): Promise<number | null> {
  if (!dinheiroDaReserva(p) || l.retidoConfirmadoEm || l.valorEmRisco <= 0) return null;
  const atual = await lancamentoDoRetido(tx, organizacaoId, l);
  if (atual && atual.estado !== "previsto") return null;
  const montante = devolvidoExplicadoPelaDisputa(t, p, l);
  if (montante <= 0) return null;
  const dia = hojeISO(FUSO, p.devolvidoVistoEm ?? agora);
  await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
  if (atual) await estornar(tx, organizacaoId, atual.id, `a leitura do Mercado Pago mostrou a devolução em ${dataBr(dia)}`, null);
  const [novo] = await lancar(
    tx,
    organizacaoId,
    [
      {
        tipo: "devolucao",
        descricao: `Reserva ${t.reserva.codigo} — valor em disputa (${NOMES_TIPO_CONTESTACAO[l.tipo].toLowerCase()}) que o Mercado Pago devolveu ao pagador, visto em ${dataBr(dia)}`,
        valor: 0,
        efeitoSaldo: 0,
        montante,
        competencia: dia,
        dataCaixa: dia,
        estado: "realizado",
        imovelId: t.reserva.imovelId,
        reservaId: t.reserva.id,
        origem: ORIGEM_LANCAMENTO_CONTESTACAO,
        chaveOrigem: await proximaChaveDoRetido(tx, organizacaoId, p.id, l.id),
      },
    ],
    null,
  );
  await tx.update(contestacoesPagamento).set({ retidoLancamentoId: novo.id, atualizadoEm: agora }).where(eq(contestacoesPagamento.id, l.id));
  l.retidoLancamentoId = novo.id;
  await registrarEventoDaContestacao(tx, l.id, { fonte: "sistema", tipo: "caixa", antes: { retidoRealizado: null, retidoPrevisto: atual?.montante ?? null }, depois: { retidoRealizado: montante, dia } }, agora);
  return montante;
}

/**
 * Depois da leitura da order (sob a trava de `aplicarLeitura`): o MED ou a reclamação registrados antes de a leitura mostrar a
 * devolução ganham agora o retido realizado, no dia em que a leitura a viu (o mesmo fato dá o mesmo caixa, qualquer que seja
 * a ordem do registro e da leitura). `p` com o devolvido lido e o dia visto desta leitura.
 */
export async function acertarRetidoDasDevolucoesLidas(
  tx: Db,
  organizacaoId: string,
  t: Travado,
  p: Pick<Pagamento, "id" | "desfecho" | "devolvidoVistoEm" | "devolvidoLido" | "devolvidoForaReconhecido">,
  agora: Date,
): Promise<boolean> {
  if (!dinheiroDaReserva(p) || p.devolvidoLido <= 0) return false;
  let mudou = false;
  const linhas = contestacoesDoPagamento(t, p.id)
    .filter((l) => (l.tipo === "med" || l.tipo === "reclamacao") && contestacaoNaoFinal(l.situacao) && !l.duplicataPossivel && !l.retidoConfirmadoEm)
    .sort((a, b) => a.abertaEm.getTime() - b.abertaEm.getTime());
  for (const l of linhas) {
    const antes = l.retidoLancamentoId;
    await lancarRetidoRealizado(tx, organizacaoId, t, p, l, agora);
    if (l.retidoLancamentoId !== antes) mudou = true;
  }
  return mudou;
}

// ---------------------------------------------------------------- o valor em risco

/** Há devolução realizada neste pagamento (confirmada, por fora, ou o reconhecido devolvido fora): a disputa pode pagar o hóspede duas vezes. */
const comDevolucaoRealizada = (t: Pick<Travado, "devolucoes">, p: Pick<Pagamento, "id" | "devolvidoForaReconhecido" | "situacao">) =>
  p.devolvidoForaReconhecido > 0 || p.situacao === "devolvido" || devolucoesDoPagamento(t, p.id).some((d) => d.situacao === "confirmada" || d.situacao === "por_fora");

/** O que as devoluções substituídas por esta disputa tiram do valor em risco (o cancelamento ou a alteração já o tirou do resultado). */
export const substituidoPelaDisputa = (t: Pick<Travado, "devolucoes">, contestacaoId: string) =>
  t.devolucoes.filter((d) => d.contestacaoId === contestacaoId && d.situacao !== "substituida").reduce((s, d) => s + d.valor, 0);

/**
 * Recalcula, sob a trava, o valor em risco de cada disputa não final do pagamento (`valorEmRisco`; a mais antiga primeiro:
 * a soma das não duplicadas nunca passa do pago), os avisos que dependem dele (`contestacao_valor_mudou` com decisão,
 * `contestacao_com_devolucao` com devolução realizada) e o retido previsto (`o.semCaixa`: ainda não; quem chama lança o
 * retido realizado do MED antes). Grava só o que mudou.
 */
export async function recalcularDisputas(tx: Db, organizacaoId: string, t: Travado, p: Pagamento, agora: Date, o: { desfecho?: DesfechoPagamento | null; semCaixa?: boolean } = {}): Promise<void> {
  const pDoCaixa = { id: p.id, desfecho: o.desfecho === undefined ? p.desfecho : o.desfecho };
  const linhas = contestacoesDoPagamento(t, p.id)
    .filter((l) => contestacaoNaoFinal(l.situacao))
    .sort((a, b) => a.abertaEm.getTime() - b.abertaEm.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pago = valorPagoAprovado(p);
  const realizada = comDevolucaoRealizada(t, p);
  let outras = 0;
  for (const l of linhas) {
    const v = valorEmRisco({ valor: l.valor, pago, outras, substituido: substituidoPelaDisputa(t, l.id), duplicataPossivel: l.duplicataPossivel, situacao: l.situacao });
    if (!l.duplicataPossivel) outras += v;
    let avisos = [...l.avisos];
    const ligar = (a: string, sim: boolean) => {
      if (sim && !avisos.includes(a)) avisos.push(a);
      if (!sim) avisos = avisos.filter((x) => x !== a);
    };
    ligar("contestacao_valor_mudou", valorSeguradoDesatualizado({ decisaoVersao: l.decisaoVersao, exposicao: l.exposicao, valorEmRisco: v, situacao: l.situacao }));
    if (realizada) ligar("contestacao_com_devolucao", true);
    if (v !== l.valorEmRisco || !iguais(avisos, l.avisos)) {
      await tx.update(contestacoesPagamento).set({ valorEmRisco: v, avisos, atualizadoEm: agora }).where(eq(contestacoesPagamento.id, l.id));
      Object.assign(l, { valorEmRisco: v, avisos });
    }
    if (!o.semCaixa) await acertarRetidoPrevisto(tx, organizacaoId, t, pDoCaixa, l, agora);
  }
}

// ---------------------------------------------------------------- a disputa que abre

/**
 * As devoluções do pagamento que a disputa substitui quando abre: de origem conhecida (cancelamento, alteração, sem
 * reserva), ainda não ligadas a outra disputa em aberto, pedidas sem aceite e sem a chave em dúvida (nada delas está no
 * Mercado Pago), ou recusadas (salvo a parada com a chave em dúvida: aquele pedido pode estar lá). A aceita, ou com a chave
 * em dúvida, continua esperando a leitura.
 */
function substituiveis(t: Travado, p: Pick<Pagamento, "id">): Devolucao[] {
  const abertas = new Set(t.contestacoes.filter((c) => contestacaoNaoFinal(c.situacao)).map((c) => c.id));
  return devolucoesDoPagamento(t, p.id).filter((d) => {
    if (!origemDeDevolucaoConhecida(d.origem) || (d.contestacaoId && abertas.has(d.contestacaoId))) return false;
    if (d.situacao === "pedida") return !d.chaveAceita && !d.chaveEmDuvida;
    return d.situacao === "recusada" && !d.chaveAceita && !(d.chaveEmDuvida && d.avisos.includes("devolucao_parada"));
  });
}

/**
 * A disputa abriu: as devoluções substituíveis param como hoje (recusada, aviso `devolucao_parada`, motivo "o pagamento
 * está em disputa") e ficam substituídas pela disputa (`contestacao_id`, evento `substituicao`, auditoria
 * `pagamento.devolucao_substituida`). Uma possível duplicata não substitui nada. Sob as travas de quem chama.
 */
export async function substituirDevolucoes(tx: Db, organizacaoId: string, t: Travado, p: Pagamento, l: Contestacao, agora: Date, usuarioId: string | null = null): Promise<number> {
  if (l.duplicataPossivel || !contestacaoNaoFinal(l.situacao)) return 0;
  let n = 0;
  for (const d of substituiveis(t, p)) {
    const antes = d.situacao;
    const mudanca = { situacao: "recusada" as const, proximaTentativaEm: null, contestacaoId: l.id, atualizadoEm: agora };
    await tx.update(devolucoesPagamento).set(mudanca).where(eq(devolucoesPagamento.id, d.id));
    Object.assign(d, mudanca);
    if (antes === "pedida") {
      await trocarAvisosDaDevolucao(tx, d, { ligar: ["devolucao_parada"] }, agora);
      await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "pagamento.devolucao_parada", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: ["pedida", "recusada"], motivo: [null, "o pagamento está em disputa"] } });
    }
    await registrarEventoDaContestacao(tx, l.id, { fonte: "sistema", tipo: "substituicao", antes: { devolucao: antes, valor: d.valor }, depois: { devolucao: "substituida_pela_disputa", valor: d.valor }, usuarioId }, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId, acao: "pagamento.devolucao_substituida", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: [antes, "substituida pela disputa"], valor: [null, d.valor] } });
    n++;
  }
  return n;
}

/** Os valores de uma linha nova (`novaContestacao`) mais os vínculos e os carimbos do domínio. */
export type NovaLinha = ReturnType<typeof novaContestacao> & { notaRegistro?: string; proximaLeituraEm?: Date | null };

/** A primeira disputa não final do pagamento (a situação de antes dela vale para a nova) e a soma das não finais não duplicadas. */
export function contextoDaNova(t: Pick<Travado, "contestacoes">, pagamentoId: string): { deOutraNaoFinal: SituacaoPagamentoAntes | null; outras: number } {
  const naoFinais = contestacoesDoPagamento(t, pagamentoId)
    .filter((l) => contestacaoNaoFinal(l.situacao))
    .sort((a, b) => a.abertaEm.getTime() - b.abertaEm.getTime());
  return { deOutraNaoFinal: naoFinais[0]?.situacaoPagamentoAntes ?? null, outras: naoFinais.filter((l) => !l.duplicataPossivel).reduce((s, l) => s + l.valorEmRisco, 0) };
}

/**
 * Grava a linha nova (sob a trava), o evento `aberta` e a substituição das devoluções; a linha entra no retrato. A reserva
 * da linha é a do dinheiro da reserva (null no pagamento sem reserva). Quem chama recalcula o valor em risco e o retido.
 */
export async function criarLinha(
  tx: Db,
  organizacaoId: string,
  t: Travado,
  p: Pagamento,
  dados: NovaLinha,
  agora: Date,
  o: { fonte: FonteEventoContestacao; usuarioId?: string | null; desfecho?: DesfechoPagamento | null },
): Promise<Contestacao> {
  const desfecho = o.desfecho === undefined ? p.desfecho : o.desfecho;
  const [linha] = await tx
    .insert(contestacoesPagamento)
    .values({
      ...dados,
      tresDSStatus: dados.tresDSStatus as StatusTresDS | null,
      organizacaoId,
      pagamentoId: p.id,
      reservaId: dinheiroDaReserva({ desfecho }) ? t.reserva.id : null,
      imovelId: t.imovel.id,
      notaRegistro: dados.notaRegistro ?? "",
      consultadaEm: dados.origem === "leitura" ? agora : null,
      proximaLeituraEm: dados.proximaLeituraEm === undefined ? new Date(agora.getTime() + esperaDaLeituraDaContestacao(0)) : dados.proximaLeituraEm,
      criadoEm: agora,
      atualizadoEm: agora,
    })
    .returning();
  t.contestacoes.push(linha);
  await registrarEventoDaContestacao(
    tx,
    linha.id,
    {
      fonte: o.fonte,
      tipo: "aberta",
      depois: { situacao: linha.situacao, tipo: linha.tipo, origem: linha.origem, valor: linha.valor, valorEmRisco: linha.valorEmRisco, duplicataPossivel: linha.duplicataPossivel, rodada: linha.rodada },
      usuarioId: o.usuarioId ?? null,
    },
    agora,
  );
  await substituirDevolucoes(tx, organizacaoId, t, p, linha, agora, o.usuarioId ?? null);
  return linha;
}

// ---------------------------------------------------------------- as leituras aplicadas

export type EfeitosDaDisputa = {
  /** As linhas que esta leitura criou. */
  novas: Contestacao[];
  /** Alguma linha mudou (situação, fatos, avisos, identificação) ou nasceu. */
  mudou: boolean;
  /** true = alguma leitura não se liga a nada com segurança (`contestacao_ambigua` no pagamento); false = todas se ligaram; null = nada lido. */
  ambigua: boolean | null;
  /** Alguma fonte mostrou `live_mode` = true (aviso `ao_vivo`, só alarme). */
  aoVivo: boolean;
};

/**
 * Aplica, sob `travarCotacao`, as leituras de uma volta (uma ou mais fontes) às disputas do pagamento: casa
 * (`casarContestacao`), atualiza as existentes pela transição (`transicaoDaContestacao`: as velhas descartadas, o
 * desconhecido nunca sobrescreve, evento só quando o estado combinado muda), cria a linha nova só com `in_process` (nasce
 * `aberta`, com o retrato da verificação do banco, a situação de antes e as devoluções substituídas) e recalcula o valor em
 * risco e o retido. `o.desfecho`: o desfecho que esta transação já decidiu (a leitura da order grava o pagamento no fim).
 * `o.sincronizar` (padrão true): grava a união dos avisos no pagamento; `aplicarLeitura` faz isso ela mesma.
 */
export async function aplicarLeiturasDaDisputa(
  tx: Db,
  organizacaoId: string,
  t: Travado,
  p: Pagamento,
  leituras: readonly LeituraDeContestacao[],
  agora: Date,
  o: { fonte: FonteEventoContestacao; desfecho?: DesfechoPagamento | null; sincronizar?: boolean },
): Promise<EfeitosDaDisputa> {
  const efeitos: EfeitosDaDisputa = { novas: [], mudou: false, ambigua: leituras.length ? false : null, aoVivo: leituras.some((l) => l.aoVivo === true) };
  if (!leituras.length) return efeitos;
  const linhas = contestacoesDoPagamento(t, p.id);
  const r = casarContestacao(leituras, linhas);
  for (const e of r.existentes) {
    const l = linhas.find((x) => x.id === e.linhaId)!;
    const completar = Object.fromEntries(Object.entries(e.completar).filter(([, v]) => v !== null && v !== undefined)) as Partial<Pick<Contestacao, "idCaso" | "idContestacao" | "idTransacao">>;
    if (Object.keys(completar).length) {
      await tx.update(contestacoesPagamento).set({ ...completar, atualizadoEm: agora }).where(eq(contestacoesPagamento.id, l.id));
      Object.assign(l, completar);
      efeitos.mudou = true;
    }
    const tr = transicaoDaContestacao(l, { tipo: "leitura", leituras: e.leituras, valorDaReserva: p.valor });
    if (!tr.ok || tr.descartada) continue;
    // Uma leitura que não muda nada só atualiza `consultada_em` e `lida_em` (os fatos trazem o `lida_em` mais novo).
    const mudanca = { ...tr.fatos, situacao: tr.situacao, avisos: tr.avisos, consultadaEm: agora, atualizadoEm: agora };
    await tx.update(contestacoesPagamento).set(mudanca).where(eq(contestacoesPagamento.id, l.id));
    Object.assign(l, mudanca);
    if (!tr.mudou) continue;
    efeitos.mudou = true;
    for (const ev of tr.eventos) await registrarEventoDaContestacao(tx, l.id, { fonte: o.fonte, tipo: ev.tipo, antes: ev.antes, depois: ev.depois }, agora);
  }
  for (const n of r.novas) {
    // Linha nova só com `in_process` (casamento, item 4): defesa, nunca uma leitura encerrada.
    if (!n.leituras.some((l) => leituraEmDisputa(l))) continue;
    const ctx = contextoDaNova(t, p.id);
    const dados = novaContestacao({
      origem: "leitura",
      tipo: "chargeback",
      forma: p.forma,
      leituras: n.leituras,
      identificacao: n.identificacao,
      duplicataPossivel: n.duplicataPossivel,
      pagamento: { situacao: p.situacao, devolvidoLido: p.devolvidoLido, pago: valorPagoAprovado(p), valor: p.valor, tresDSStatus: p.tresDSStatus },
      deOutraNaoFinal: ctx.deOutraNaoFinal,
      outras: ctx.outras,
      comDevolucaoRealizada: comDevolucaoRealizada(t, p),
      agora,
    });
    efeitos.novas.push(await criarLinha(tx, organizacaoId, t, p, dados, agora, { fonte: o.fonte, desfecho: o.desfecho }));
    efeitos.mudou = true;
  }
  if (r.ambiguas.length) efeitos.ambigua = true;
  await recalcularDisputas(tx, organizacaoId, t, p, agora, { desfecho: o.desfecho });
  if (o.sincronizar !== false) await sincronizarAvisosDaDisputa(tx, t, p, agora, { ambigua: efeitos.ambigua });
  return efeitos;
}
