/**
 * Pagamento no site (M8.2b) — disjuntor de recusas do cartão: quem testa cartões roubados manda muitos cartões seguidos;
 * com recusas demais, o cartão desliga na organização inteira (o Pix nunca: `podeCobrar` não olha daqui).
 *
 * - O que conta é decidido uma vez, na transição que encerra a tentativa de cartão (`contaNoDisjuntor`, chamada por
 *   `aplicarLeitura`), e fica gravado em `pagamentos.conta_no_disjuntor`: a contagem e os testes leem a mesma regra.
 * - Duas janelas: 8 recusas em 30 minutos desligam por 60 minutos (na terceira vez em 24 h, até alguém religar); 20 em
 *   24 horas desligam até alguém religar. Recusas de antes de religar nunca disparam de novo.
 * - Trava própria (advisory, por organização), tomada DEPOIS de todas as travas do pagamento (imóvel → reserva → cotação
 *   → tentativas → devoluções → páginas legais → disjuntor); `religarCartao` só toma esta, então não há ciclo.
 *
 * Nada de endereço de internet, e-mail ou dado de cartão aqui: só contagens, horários e o id de quem religou.
 */
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { disjuntoresCartao, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { CODIGOS_FALHA_DO_PROVEDOR, CODIGOS_TOKEN } from "./provedor";
import { motivoDoDetalhe, type SituacaoPagamento } from "./situacoes";
import type { Pagamento } from "./travas";

/** Recusas na janela curta que desligam o cartão. */
export const RECUSAS_PARA_DESLIGAR = 8;
export const JANELA_RECUSAS_MS = 30 * 60_000;
/** Por quanto tempo o cartão fica desligado depois de um disparo na janela curta. */
export const DESLIGADO_POR_MS = 60 * 60_000;
/** Recusas em 24 h que desligam o cartão até alguém religar. */
export const RECUSAS_PARA_DESLIGAR_24H = 20;
export const JANELA_24H_MS = 24 * 3_600_000;
/** Início: a partir de quantas recusas em 24 h aparece o alerta (o cartão continua ligado). */
export const ALERTA_RECUSAS_24H = 10;
/** Na terceira vez em 24 h, o cartão só volta religando à mão. */
export const DISPAROS_ATE_RELIGAR_A_MAO = 3;
/** Início: recusas por dados do cartão inválidos na última hora (quase sempre chave pública e token de contas diferentes). */
export const ALERTA_TOKEN_INVALIDO_1H = 3;

export type JanelaDisjuntor = "30min" | "24h";
export type DisjuntorAberto = { ate: Date | null; recusas: number; abertoEm: Date; janela: JanelaDisjuntor };

const ENCERRADAS: readonly SituacaoPagamento[] = ["recusado", "cancelado", "expirado"];
const emLista = (lista: readonly string[], c: string | null) => c !== null && lista.includes(c);

/**
 * A tentativa de cartão que está sendo encerrada (de `p`, ainda com a etapa e o endereço do desafio de antes desta
 * leitura, para `nova`) conta no disjuntor? Conta:
 * - recusa que chegou ao banco ou à análise de risco: com order (`idProvedor`) ou o 402 sem `data` (recusado sem a
 *   order no corpo), salvo dados do cartão vencidos/inválidos (token) e falha técnica do provedor (`processing_error`);
 * - recusa ou vencimento que encerra um desafio do banco (a tentativa estava no desafio, com endereço);
 * - cancelamento de um desafio com endereço pedido pelo hóspede (trocou por outro cartão ou pelo Pix: chegar ao desafio
 *   já diz a quem testa que o cartão vale).
 * Nunca: dados inválidos (4xx sem order), token, `processing_error`, falha de transporte, criação não feita,
 * aprovações, análises, cancelamentos do sistema ou da equipe, pagamento marcado como real (live_mode).
 */
export function contaNoDisjuntor(
  p: Pick<Pagamento, "forma" | "situacao" | "etapaCartao" | "desafioUrl" | "cancelamentoPor" | "aoVivo">,
  nova: SituacaoPagamento,
  l: { recusadaSemOrder?: "recusado" | "dados_invalidos"; codigo: string | null; idProvedor: string | null; aoVivo?: boolean | null },
): boolean {
  if (p.forma !== "cartao" || !ENCERRADAS.includes(nova) || ENCERRADAS.includes(p.situacao)) return false;
  if (p.aoVivo === true || l.aoVivo === true) return false;
  if (p.cancelamentoPor === "sistema" || p.cancelamentoPor === "equipe") return false;
  if (emLista(CODIGOS_TOKEN, l.codigo) || emLista(CODIGOS_FALHA_DO_PROVEDOR, l.codigo)) return false;
  const desafioComEndereco = p.etapaCartao === "desafio" && !!p.desafioUrl;
  if (nova === "recusado") {
    if (l.recusadaSemOrder === "dados_invalidos") return false;
    return desafioComEndereco || !!l.idProvedor || l.recusadaSemOrder === "recusado";
  }
  if (nova === "expirado") return desafioComEndereco;
  // cancelado
  return desafioComEndereco && p.cancelamentoPor === "hospede";
}

/** O disjuntor está aberto agora (cartão desligado)? Aberto = não religado e sem prazo, ou com prazo ainda no futuro. */
export async function disjuntorAberto(db: Db, organizacaoId: string, agora: Date): Promise<DisjuntorAberto | null> {
  const [d] = await db
    .select()
    .from(disjuntoresCartao)
    .where(and(eq(disjuntoresCartao.organizacaoId, organizacaoId), isNull(disjuntoresCartao.religadoEm), or(isNull(disjuntoresCartao.ate), gt(disjuntoresCartao.ate, agora))))
    .orderBy(desc(disjuntoresCartao.abertoEm))
    .limit(1);
  return d ? { ate: d.ate, recusas: d.recusas, abertoEm: d.abertoEm, janela: d.janela } : null;
}

/** Tentativas de cartão encerradas que contam no disjuntor, de `desde` (exclusive) até agora. */
async function contar(tx: Db, organizacaoId: string, desde: Date, agora: Date): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(pagamentos)
    .where(and(eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.forma, "cartao"), eq(pagamentos.contaNoDisjuntor, true), gt(pagamentos.encerradoEm, desde), lte(pagamentos.encerradoEm, agora)));
  return r?.n ?? 0;
}

const maior = (a: Date, b: Date | null | undefined) => (b && b.getTime() > a.getTime() ? b : a);

/** Trava do disjuntor da organização (a última da ordem única; dura até o fim da transação). */
async function travarDisjuntor(tx: Db, organizacaoId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`disjuntor-cartao:${organizacaoId}`}))`);
}

/**
 * Confere as duas janelas depois de uma tentativa que conta (dentro da transação de `aplicarLeitura`, por último) e,
 * passado o limite, abre o disjuntor (uma linha, auditada). Já aberto: nada. Duas recusas ao mesmo tempo no limite
 * abrem uma linha só (a segunda espera a trava e o encontra aberto). Devolve se abriu agora.
 */
export async function avaliarDisjuntor(tx: Db, organizacaoId: string, agora: Date): Promise<boolean> {
  await travarDisjuntor(tx, organizacaoId);
  if (await disjuntorAberto(tx, organizacaoId, agora)) return false;
  const anteriores = await tx
    .select({ abertoEm: disjuntoresCartao.abertoEm, ate: disjuntoresCartao.ate, religadoEm: disjuntoresCartao.religadoEm })
    .from(disjuntoresCartao)
    .where(eq(disjuntoresCartao.organizacaoId, organizacaoId))
    .orderBy(desc(disjuntoresCartao.abertoEm))
    .limit(50);
  const ultimo = anteriores[0];
  // Janela curta: desde o fim do último disparo (religado ou vencido), nunca antes; a de 24 h só recomeça ao religar
  // (um disparo de 30 minutos que venceu sozinho não zera o dia).
  const desde30 = maior(new Date(agora.getTime() - JANELA_RECUSAS_MS), ultimo ? (ultimo.religadoEm ?? ultimo.ate) : null);
  const ultimoReligado = anteriores.reduce<Date | null>((m, d) => (d.religadoEm && (!m || d.religadoEm.getTime() > m.getTime()) ? d.religadoEm : m), null);
  const desde24 = maior(new Date(agora.getTime() - JANELA_24H_MS), ultimoReligado);
  const n24 = await contar(tx, organizacaoId, desde24, agora);
  const n30 = await contar(tx, organizacaoId, desde30, agora);
  let linha: { janela: JanelaDisjuntor; recusas: number; ate: Date | null; reincidente: boolean } | null = null;
  // A de 24 h é a mais dura (só religando à mão): vale ela quando as duas passam do limite juntas.
  if (n24 >= RECUSAS_PARA_DESLIGAR_24H) linha = { janela: "24h", recusas: n24, ate: null, reincidente: true };
  else if (n30 >= RECUSAS_PARA_DESLIGAR) {
    const noDia = anteriores.filter((d) => d.abertoEm.getTime() > agora.getTime() - JANELA_24H_MS).length;
    const reincidente = noDia >= DISPAROS_ATE_RELIGAR_A_MAO - 1;
    linha = { janela: "30min", recusas: n30, ate: reincidente ? null : new Date(agora.getTime() + DESLIGADO_POR_MS), reincidente };
  }
  if (!linha) return false;
  const [d] = await tx.insert(disjuntoresCartao).values({ organizacaoId, abertoEm: agora, ate: linha.ate, recusas: linha.recusas, janela: linha.janela, reincidente: linha.reincidente }).returning({ id: disjuntoresCartao.id });
  await registrarAuditoria(tx, {
    organizacaoId,
    usuarioId: null,
    acao: "pagamento.disjuntor_aberto",
    entidade: "disjuntor_cartao",
    entidadeId: d.id,
    mudancas: { recusas: [null, linha.recusas], janela: [null, linha.janela], ate: [null, linha.ate ? linha.ate.toISOString() : null] },
  });
  return true;
}

/**
 * "Religar o cartão" (painel, `financeiro:editar` conferido por quem chama, com confirmação na tela): fecha o disjuntor
 * aberto, auditado. As recusas de antes não disparam de novo (as duas janelas recomeçam aqui).
 */
export async function religarCartao(db: Db, organizacaoId: string, autorId: string, agora: Date = new Date()): Promise<{ ok: true } | { ok: false; erro: string }> {
  return db.transaction(async (tx) => {
    await travarDisjuntor(tx, organizacaoId);
    const abertos = await tx
      .update(disjuntoresCartao)
      .set({ religadoEm: agora, religadoPor: autorId })
      .where(and(eq(disjuntoresCartao.organizacaoId, organizacaoId), isNull(disjuntoresCartao.religadoEm), or(isNull(disjuntoresCartao.ate), gt(disjuntoresCartao.ate, agora))))
      .returning({ id: disjuntoresCartao.id, recusas: disjuntoresCartao.recusas });
    if (!abertos.length) return { ok: false as const, erro: "O cartão não está desligado pelo disjuntor." };
    for (const d of abertos) {
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.disjuntor_religado", entidade: "disjuntor_cartao", entidadeId: d.id, mudancas: { religadoEm: [null, agora.toISOString()] } });
    }
    return { ok: true as const };
  });
}

export type DisparoDisjuntor = typeof disjuntoresCartao.$inferSelect;

/** Últimos disparos (painel), do mais novo ao mais antigo. */
export async function ultimosDisparos(db: Db, organizacaoId: string, n = 5): Promise<DisparoDisjuntor[]> {
  return db.select().from(disjuntoresCartao).where(eq(disjuntoresCartao.organizacaoId, organizacaoId)).orderBy(desc(disjuntoresCartao.abertoEm)).limit(Math.max(1, Math.min(50, n)));
}

/** Tentativas de cartão que contaram no disjuntor nas últimas 24 h (painel e alerta do Início). */
export async function recusasNasUltimas24h(db: Db, organizacaoId: string, agora: Date = new Date()): Promise<number> {
  return contar(db, organizacaoId, new Date(agora.getTime() - JANELA_24H_MS), agora);
}

/**
 * Tentativas de cartão criadas na última hora e recusadas por dados do cartão vencidos ou inválidos (token): várias
 * seguidas quase sempre são a chave pública e o token do Mercado Pago de contas diferentes (alerta do Início).
 */
export async function recusasPorTokenNaUltimaHora(db: Db, organizacaoId: string, agora: Date = new Date()): Promise<number> {
  const linhas = await db
    .select({ detalhe: pagamentos.detalheProvedor })
    .from(pagamentos)
    .where(and(eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.forma, "cartao"), eq(pagamentos.situacao, "recusado"), gt(pagamentos.criadoEm, new Date(agora.getTime() - 3_600_000))));
  return linhas.filter((l) => emLista(CODIGOS_TOKEN, motivoDoDetalhe(l.detalhe))).length;
}
