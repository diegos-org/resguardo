/**
 * Pagamento no site (M8.2a) — a ordem única das travas, num lugar só (a ordem real de todo caminho): imóvel (FOR NO KEY
 * UPDATE) → reserva (FOR NO KEY UPDATE) → cotação → tentativas da cotação (todas, por id) → devoluções → cancelamento
 * ativo da reserva (M8.2c) → alterações da reserva (todas, por id; M8.2d) → motor da reserva (`travarMotorDaReserva`) →
 * linha da reserva-pedido de uma alteração (FOR NO KEY UPDATE) → motor dela → (documentos legais, disjuntor, livro). Toda
 * transação que aplica um pagamento (aviso, página, rotina, painel) entra por aqui, com tempo-limite de espera, e chamada
 * ao provedor nunca acontece com trava aberta (55P03 / 40P01 = "ocupado").
 *
 * O retrato travado (`Travado`) é o que as funções seguintes da mesma transação leem: quem grava uma linha que está
 * nele atualiza o retrato junto (`Object.assign`, ou troca o campo; uma devolução nova entra em `devolucoes`), como
 * `aplicarLeitura` faz com a tentativa.
 *
 * O imóvel e a reserva são travados com NO KEY UPDATE (não FOR UPDATE): serializam os caminhos do pagamento e do hold
 * entre si e com quem trava a mesma linha para mudá-la (bloqueios, contratos, confirmar ou cancelar à mão), mas não
 * bloqueiam o FOR KEY SHARE que o Postgres toma na linha ao conferir as chaves estrangeiras de quem grava lançamentos,
 * itens de repasse, limpezas ou pagamentos dela. Com FOR UPDATE, uma transação daqui que depois espera a trava do
 * motor (taxa tardia, estorno da liberação) e outra que tem essa trava e grava lançamentos ou itens de repasse da
 * reserva (recálculo, repasse) entravam em impasse 40P01. Os UPDATEs de reserva feitos nessas transações só mudam
 * colunas fora das chaves únicas (id, organização + código, organização + id do Beds24), então ficam em NO KEY UPDATE;
 * e as releituras da reserva na mesma transação (gravar a taxa, confirmar o pedido pago) usam o mesmo modo — uma
 * releitura FOR UPDATE subiria a trava e traria o impasse de volta.
 *
 * Várias devoluções por pagamento (M8.2d): as regras de quanto cada devolução compromete, do que o Mercado Pago pode
 * mostrar como devolvido por nós e do que ainda se pode devolver moram aqui (puras, sobre o retrato), e todo caminho que
 * cria, pede, registra ou confirma dinheiro confere o teto sob a trava da cotação.
 */
import { type AnyColumn, and, asc, eq, inArray, sql } from "drizzle-orm";
import { alteracoesReserva, cancelamentosReserva, cotacoes, devolucoesPagamento, imoveis, pagamentos, reservas, type SituacaoPagamento } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { principalEJuros, situacaoEfetiva, taxaAtribuida } from "./alteracao-regras";
import { CARENCIA_PAGAMENTO_MS } from "./andamento";
import type { Cobranca } from "./provedor";
import { situacaoLocal } from "./situacoes";

/** 55P03 (lock_timeout) ou 40P01 (impasse): a ação responde "ocupado" e nada foi pedido ao provedor. */
export { travaOcupada } from "@/db/erros";

export type Pagamento = typeof pagamentos.$inferSelect;
export type Devolucao = typeof devolucoesPagamento.$inferSelect;
export type CotacaoTravada = typeof cotacoes.$inferSelect;
export type ReservaTravada = typeof reservas.$inferSelect;
export type Cancelamento = typeof cancelamentosReserva.$inferSelect;
export type Alteracao = typeof alteracoesReserva.$inferSelect;

export type Travado = {
  imovel: { id: string; codigo: string; nome: string; fuso: string };
  reserva: ReservaTravada;
  cotacao: CotacaoTravada;
  /** Todas as tentativas da cotação, travadas, em ordem de id. */
  tentativas: Pagamento[];
  /** Devoluções dessas tentativas, travadas, em ordem de id. */
  devolucoes: Devolucao[];
  /** Cancelamento ativo (pedido ou cancelada) da reserva, travado depois das devoluções. Quem grava atualiza este campo. */
  cancelamento: Cancelamento | null;
  /** TODAS as alterações da reserva (poucas), travadas depois do cancelamento, em ordem de id (M8.2d). */
  alteracoes: Alteracao[];
};

// ---------------------------------------------------------------- alterações (M8.2d)

/**
 * A alteração da reserva cujas datas ainda estão seguradas pela situação que vale agora (`situacaoEfetiva`: o prazo
 * vencido sem carência vale como vencido antes de a próxima ação gravar), ou null.
 */
export const alteracaoAtiva = (t: Pick<Travado, "alteracoes">, agora: Date, emCarencia: (a: Alteracao) => boolean): Alteracao | null =>
  t.alteracoes.find((a) => situacaoEfetiva(a, agora, emCarencia(a)) === "segurada") ?? null;

/**
 * A carência da alteração pelo retrato travado (gêmea de `alteracaoEmCarencia`, sem consulta): o prazo das datas venceu há
 * menos de 15 minutos e uma tentativa da diferença ainda segura as datas (em andamento, ou aprovada e sem decisão).
 */
export const carenciaNoTravado =
  (t: Pick<Travado, "tentativas">, agora: Date) =>
  (a: Pick<Alteracao, "id" | "holdAte">): boolean =>
    !!a.holdAte &&
    a.holdAte.getTime() + CARENCIA_PAGAMENTO_MS > agora.getTime() &&
    t.tentativas.some(
      (x) => x.alteracaoId === a.id && (x.situacao === "criando" || x.situacao === "incerta" || x.situacao === "pendente" || (x.situacao === "aprovado" && x.desfecho === null && x.motivoSemReserva === null)),
    );

// ---------------------------------------------------------------- o dinheiro da reserva e as devoluções (M8.2d)

/** Os desfechos de uma tentativa cujo dinheiro é da reserva: a que a confirmou e a diferença aplicada de uma alteração. */
export const DESFECHOS_DA_RESERVA = ["reserva", "alteracao"] as const;
/** O dinheiro desta tentativa é da reserva (a que confirmou ou a diferença aplicada). Gêmeo SQL: `dinheiroDaReservaSql`. */
export const dinheiroDaReserva = (p: Pick<Pagamento, "desfecho">) => p.desfecho === "reserva" || p.desfecho === "alteracao";
/** Gêmeo SQL de `dinheiroDaReserva`, sobre a coluna `desfecho` de quem chama (a tabela ou um apelido). */
export const dinheiroDaReservaSql = (desfecho: AnyColumn) => inArray(desfecho, [...DESFECHOS_DA_RESERVA]);
/** As tentativas da cotação cujo dinheiro é da reserva (as que contam na devolução, na taxa e na política), da mais antiga à mais nova. */
export const pagamentosDaReserva = (t: Pick<Travado, "tentativas">) =>
  t.tentativas.filter(dinheiroDaReserva).sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** As devoluções vivas do pagamento (sem as substituídas pelo cancelamento), em ordem de id. */
export const devolucoesDoPagamento = (t: { devolucoes: readonly Devolucao[] }, pagamentoId: string): Devolucao[] =>
  t.devolucoes.filter((d) => d.pagamentoId === pagamentoId && d.situacao !== "substituida").sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
/** A devolução pedida do pagamento (no máximo uma: índice único), ou undefined. */
export const devolucaoAberta = (t: Pick<Travado, "devolucoes">, pagamentoId: string): Devolucao | undefined => t.devolucoes.find((d) => d.pagamentoId === pagamentoId && d.situacao === "pedida");

/**
 * A devolução cabe neste pagamento agora? Sem reserva: desfecho vazio. Cancelamento: o dinheiro da reserva, com a reserva
 * cancelada com direito integral. Alteração: o dinheiro da reserva, com a alteração aplicada. A substituída, nunca.
 */
/** O que as regras da devolução precisam do cancelamento ativo e das alterações da reserva (o retrato travado, ou o lido). */
export type ContextoDaDevolucao = { cancelamento: Pick<Cancelamento, "situacao" | "direito"> | null; alteracoes: readonly Pick<Alteracao, "id" | "situacao">[] };
export function cabeNoPagamento(dev: Pick<Devolucao, "origem" | "situacao" | "alteracaoId" | "cancelamentoId">, p: Pick<Pagamento, "desfecho">, t: ContextoDaDevolucao): boolean {
  if (dev.situacao === "substituida") return false;
  if (dev.origem === "sem_reserva") return p.desfecho === null;
  if (!dinheiroDaReserva(p)) return false;
  if (dev.origem === "cancelamento") return t.cancelamento?.situacao === "cancelada" && t.cancelamento.direito === "integral";
  if (dev.origem === "alteracao") return t.alteracoes.some((a) => a.id === dev.alteracaoId && a.situacao === "aplicada");
  return false;
}

/** O pedido desta devolução pode já estar no Mercado Pago (enviado, com a chave em dúvida ou aceita). */
export const possivelmenteNoProvedor = (d: Pick<Devolucao, "situacao" | "tentativas" | "chaveEmDuvida" | "chaveAceita">) => d.situacao === "pedida" && d.tentativas > 0 && (d.chaveEmDuvida || d.chaveAceita);
/** Chave em voo: enviada e ainda sem desfecho (bloqueia cancelamento e alteração). */
export const chaveEmVoo = (d: Pick<Devolucao, "situacao" | "tentativas">) => d.situacao === "pedida" && d.tentativas > 0;

/**
 * O que a devolução já tirou ou ainda deve tirar do pagamento (centavos pagos): a confirmada pelo que voltou, a por fora
 * pelo registrado, a pedida e a recusada pelo valor dela (podem sair ainda), a substituída por nada. Situação que esta
 * versão não conhece conta pelo valor (defesa: nunca devolve a mais).
 */
export function comprometido(d: Pick<Devolucao, "situacao" | "valor" | "valorConfirmado" | "porForaValor">): number {
  if (d.situacao === "substituida") return 0;
  if (d.situacao === "confirmada") return d.valorConfirmado ?? d.valor;
  if (d.situacao === "por_fora") return d.porForaValor ?? d.valor;
  return d.valor;
}
export const comprometidoNoPagamento = (devs: readonly Pick<Devolucao, "situacao" | "valor" | "valorConfirmado" | "porForaValor">[]) => devs.reduce((s, d) => s + comprometido(d), 0);

type DevolucaoPropria = Pick<Devolucao, "situacao" | "valor" | "valorConfirmado" | "tentativas" | "chaveEmDuvida" | "chaveAceita">;
/**
 * O que o Mercado Pago pode mostrar como devolvido por nós: as confirmadas (pela leitura ou pela equipe) e as pedidas
 * possivelmente no provedor (enviadas, com a chave em dúvida ou aceita), cada uma até o valor dela. A por fora saiu do
 * banco da empresa, nunca aparece no Mercado Pago.
 */
export function devolvidoProprio(devs: readonly DevolucaoPropria[]): number {
  let soma = 0;
  for (const d of devs) {
    if (d.situacao === "confirmada") soma += Math.min(d.valorConfirmado ?? d.valor, d.valor);
    else if (possivelmenteNoProvedor(d)) soma += d.valor;
  }
  return soma;
}

/** O pago, congelado na aprovação (D28): o teto de toda devolução. */
export const valorPagoAprovado = (p: Pick<Pagamento, "valorPago" | "valor">) => p.valorPago ?? p.valor;

type PagamentoLido = Pick<Pagamento, "situacao" | "devolvidoLido" | "devolvidoForaReconhecido">;
/**
 * D21: o Mercado Pago mostra mais devolvido do que as nossas devoluções e o reconhecido explicam, ou devolvido sem nada
 * nosso nem reconhecido (a leitura sem os valores). O aviso `devolvido_por_fora` é saída disto, nunca entrada.
 */
export function devolucaoInexplicada(p: PagamentoLido, devs: readonly DevolucaoPropria[]): boolean {
  const proprio = devolvidoProprio(devs);
  if (p.devolvidoLido > p.devolvidoForaReconhecido + proprio) return true;
  return (p.situacao === "devolvido" || p.situacao === "devolvido_parcial") && proprio === 0 && p.devolvidoForaReconhecido === 0;
}
/** Inexplicada e sem o valor (o Mercado Pago não disse quanto): a equipe informa o valor visto no painel dele. */
export const devolvidoForaSemValor = (p: PagamentoLido, devs: readonly DevolucaoPropria[]) =>
  devolucaoInexplicada(p, devs) && p.devolvidoLido <= p.devolvidoForaReconhecido + devolvidoProprio(devs);

type PagamentoDoSaldo = Pick<Pagamento, "valorPago" | "valor" | "devolvidoForaReconhecido">;
/** O que ainda se pode devolver: o pago menos o comprometido e menos o reconhecido devolvido fora. */
export const saldoDevolvivel = (p: PagamentoDoSaldo, devs: readonly Pick<Devolucao, "situacao" | "valor" | "valorConfirmado" | "porForaValor">[]) =>
  valorPagoAprovado(p) - comprometidoNoPagamento(devs) - p.devolvidoForaReconhecido;
/** O principal (o valor da reserva, sem os juros do parcelamento) ainda devolvível: o teto das devoluções de alteração. */
export const saldoPrincipal = (p: PagamentoDoSaldo, devs: readonly Pick<Devolucao, "situacao" | "valor" | "valorConfirmado" | "porForaValor">[]) =>
  Math.max(0, p.valor - comprometidoNoPagamento(devs) - p.devolvidoForaReconhecido);
/** A devolução integral de um pagamento intocado: nenhuma outra devolução viva, nada lido nem reconhecido como devolvido. */
export const integralIntocada = (p: Pick<Pagamento, "valorPago" | "valor" | "devolvidoLido" | "devolvidoForaReconhecido">, d: Pick<Devolucao, "id" | "valor">, devs: readonly Pick<Devolucao, "id" | "situacao">[]) =>
  devs.every((x) => x.id === d.id || x.situacao === "substituida") && p.devolvidoLido === 0 && p.devolvidoForaReconhecido === 0 && d.valor === valorPagoAprovado(p);

/**
 * D13: a devolução precisa esperar a liberação do pagamento (do dinheiro da reserva, não é a integral de um pagamento
 * intocado, e o pagamento ainda não foi liberado ou a taxa não é conhecida). Só o pedido que pode já estar no Mercado Pago
 * (enviado, com a chave em dúvida ou aceita) nunca espera: a leitura o segue. Um pedido recusado com clareza e pedido de
 * novo pela equipe espera de novo (a liberação pode ter sido estornada entre um e outro).
 */
export function esperaLiberacao(
  p: Pick<Pagamento, "desfecho" | "valorPago" | "valor" | "devolvidoLido" | "devolvidoForaReconhecido" | "liberacaoConfirmadaEm" | "taxa">,
  dev: Pick<Devolucao, "id" | "valor" | "situacao" | "tentativas" | "chaveEmDuvida" | "chaveAceita">,
  devs: readonly Pick<Devolucao, "id" | "situacao">[],
): boolean {
  if (!dinheiroDaReserva(p) || possivelmenteNoProvedor(dev)) return false;
  if (integralIntocada(p, dev, devs)) return false;
  return !p.liberacaoConfirmadaEm || p.taxa === null;
}

/**
 * D27: a situação que a leitura vale para este pagamento. Uma order "processed/refunded" (lida como desconhecida de
 * propósito) depois de uma devolução de parte do valor é explicada quando as nossas devoluções enviadas mais o reconhecido
 * explicam o devolvido (ou, sem os valores, quando há devolução nossa enviada): vira devolvido (alcançaram o pago) ou
 * devolvido em parte. Qualquer outra leitura, como sempre (`situacaoLocal`; null = desconhecida, aviso).
 */
export function situacaoExplicada(c: Pick<Cobranca, "situacao" | "detalhe" | "devolvido">, p: PagamentoDoSaldo, devs: readonly DevolucaoPropria[]): SituacaoPagamento | null {
  const nova = situacaoLocal(c.situacao);
  if (nova !== null || c.situacao !== "desconhecido" || c.detalhe !== "processed/refunded") return nova;
  const proprio = devolvidoProprio(devs);
  const devolvido = Number.isSafeInteger(c.devolvido) && c.devolvido > 0 ? c.devolvido : 0;
  const explica = devolvido > 0 ? devolvido <= proprio + p.devolvidoForaReconhecido : proprio > 0;
  if (!explica) return null;
  return (devolvido > 0 ? devolvido : proprio + p.devolvidoForaReconhecido) >= valorPagoAprovado(p) ? "devolvido" : "devolvido_parcial";
}

/** Espera máxima por uma trava (como no envio ao Beds24): passou disso, a transação desiste com erro 55P03. */
export async function limitarEspera(tx: Db): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '15s'`);
}

/**
 * Trava a cotação (com o pedido dela) para aplicar um pagamento, na ordem única. null = cotação desta organização
 * não existe ou nunca foi segurada (sem pedido). Quem chama já está numa transação.
 */
export async function travarCotacao(tx: Db, organizacaoId: string, cotacaoId: string): Promise<Travado | null> {
  return lerCotacao(tx, organizacaoId, cotacaoId, true);
}

/**
 * O mesmo retrato de `travarCotacao`, sem trava nenhuma (a prévia do cancelamento, M8.2c: calcula com o que está gravado
 * agora; o cancelamento confere tudo de novo sob as travas, pela assinatura da prévia).
 */
export async function lerCotacaoSemTravar(db: Db, organizacaoId: string, cotacaoId: string): Promise<Travado | null> {
  return lerCotacao(db, organizacaoId, cotacaoId, false);
}

async function lerCotacao(tx: Db, organizacaoId: string, cotacaoId: string, travar: boolean): Promise<Travado | null> {
  if (!uuidValido(cotacaoId)) return null;
  if (travar) await limitarEspera(tx);
  const [antes] = await tx.select({ imovelId: cotacoes.imovelId, reservaId: cotacoes.reservaId }).from(cotacoes).where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  if (!antes?.reservaId) return null;
  const qImovel = tx.select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome, fuso: imoveis.fuso }).from(imoveis).where(eq(imoveis.id, antes.imovelId));
  const [imovel] = travar ? await qImovel.for("no key update") : await qImovel;
  const qReserva = tx.select().from(reservas).where(and(eq(reservas.id, antes.reservaId), eq(reservas.organizacaoId, organizacaoId)));
  const [reserva] = travar ? await qReserva.for("no key update") : await qReserva;
  const qCotacao = tx.select().from(cotacoes).where(eq(cotacoes.id, cotacaoId));
  const [cotacao] = travar ? await qCotacao.for("update") : await qCotacao;
  // O pedido de uma cotação nunca muda depois de segurada; se mudou entre a leitura e a trava, nada é aplicado.
  if (!imovel || !reserva || !cotacao || cotacao.reservaId !== reserva.id) return null;
  const qTentativas = tx.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId)).orderBy(asc(pagamentos.id));
  const tentativas = travar ? await qTentativas.for("update") : await qTentativas;
  let devolucoes: Devolucao[] = [];
  if (tentativas.length) {
    const q = tx
      .select()
      .from(devolucoesPagamento)
      .where(inArray(devolucoesPagamento.pagamentoId, tentativas.map((t) => t.id)))
      .orderBy(asc(devolucoesPagamento.id));
    devolucoes = travar ? await q.for("update") : await q;
  }
  // M8.2c: o cancelamento ativo da reserva (no máximo um, pelo índice único), depois das devoluções.
  const qCancelamento = tx
    .select()
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.reservaId, reserva.id), eq(cancelamentosReserva.organizacaoId, organizacaoId), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])));
  const [cancelamento] = travar ? await qCancelamento.for("update") : await qCancelamento;
  // M8.2d: TODAS as alterações da reserva (a segurada e as aplicadas: a aprovação tardia confere que nenhuma veio depois).
  const qAlteracoes = tx
    .select()
    .from(alteracoesReserva)
    .where(and(eq(alteracoesReserva.reservaId, reserva.id), eq(alteracoesReserva.organizacaoId, organizacaoId)))
    .orderBy(asc(alteracoesReserva.id));
  const alteracoes = travar ? await qAlteracoes.for("update") : await qAlteracoes;
  return { imovel, reserva, cotacao, tentativas, devolucoes, cancelamento: cancelamento ?? null, alteracoes };
}

/**
 * A cotação de uma devolução desta organização (o id vem do formulário do painel): para travar pela ordem única antes de
 * mexer nela. null = não existe nesta organização (ou o id não é um uuid).
 */
export async function cotacaoDaDevolucao(db: Db, organizacaoId: string, devolucaoId: string): Promise<{ cotacaoId: string; pagamentoId: string } | null> {
  if (!uuidValido(devolucaoId)) return null;
  const [d] = await db
    .select({ cotacaoId: pagamentos.cotacaoId, pagamentoId: pagamentos.id })
    .from(devolucoesPagamento)
    .innerJoin(pagamentos, eq(pagamentos.id, devolucoesPagamento.pagamentoId))
    .where(and(eq(devolucoesPagamento.id, devolucaoId), eq(devolucoesPagamento.organizacaoId, organizacaoId), eq(pagamentos.organizacaoId, organizacaoId)));
  return d ?? null;
}

/** A cotação (original) de uma alteração desta organização; null = não existe nesta organização (ou o id não é um uuid). */
export async function cotacaoDaAlteracao(db: Db, organizacaoId: string, alteracaoId: string): Promise<{ cotacaoId: string; reservaId: string } | null> {
  if (!uuidValido(alteracaoId)) return null;
  const [a] = await db
    .select({ cotacaoId: alteracoesReserva.cotacaoId, reservaId: alteracoesReserva.reservaId })
    .from(alteracoesReserva)
    .where(and(eq(alteracoesReserva.id, alteracaoId), eq(alteracoesReserva.organizacaoId, organizacaoId)));
  return a ?? null;
}

/**
 * D19: a taxa do Mercado Pago atribuída ao principal desta devolução, pela ordem acumulada do pagamento: antes dela, o
 * reconhecido devolvido fora e as outras devoluções vivas com a taxa já congelada (na ordem em que congelaram). Só o
 * principal (até `p.valor`) leva taxa; os juros do parcelamento, nunca. null = a taxa do pagamento ainda não é conhecida.
 * `valor`: o devolvido que conta (padrão: o comprometido da devolução; na realização a menor, o que voltou).
 */
export function taxaAtribuidaDaDevolucao(
  p: Pick<Pagamento, "taxa" | "valor" | "devolvidoForaReconhecido">,
  dev: Pick<Devolucao, "id" | "situacao" | "valor" | "valorConfirmado" | "porForaValor">,
  devs: readonly Pick<Devolucao, "id" | "situacao" | "valor" | "valorConfirmado" | "porForaValor" | "taxaAtribuida">[],
  valor: number = comprometido(dev),
): number | null {
  if (p.taxa === null) return null;
  const antes = acumuladoAntes(p, dev, devs);
  return taxaAtribuida(p, antes + valor)! - taxaAtribuida(p, antes)!;
}

/** Os juros do parcelamento que esta devolução leva (só a que cruza o valor da reserva, na ordem acumulada). */
export function jurosDaDevolucao(
  p: Pick<Pagamento, "valor" | "devolvidoForaReconhecido">,
  dev: Pick<Devolucao, "id" | "situacao" | "valor" | "valorConfirmado" | "porForaValor">,
  devs: readonly Pick<Devolucao, "id" | "situacao" | "valor" | "valorConfirmado" | "porForaValor" | "taxaAtribuida">[],
  valor: number = comprometido(dev),
): number {
  return principalEJuros(p, acumuladoAntes(p, dev, devs), valor).juros;
}

const acumuladoAntes = (
  p: Pick<Pagamento, "devolvidoForaReconhecido">,
  dev: Pick<Devolucao, "id">,
  devs: readonly Pick<Devolucao, "id" | "situacao" | "valor" | "valorConfirmado" | "porForaValor" | "taxaAtribuida">[],
) => p.devolvidoForaReconhecido + devs.filter((x) => x.id !== dev.id && x.situacao !== "substituida" && x.taxaAtribuida !== null).reduce((s, x) => s + comprometido(x), 0);
