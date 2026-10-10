/**
 * O pedido de cancelamento pelo próprio hóspede, em Minha reserva (M8.2c; desenho §5.5). Só PEDE: quem cancela (e mexe
 * no dinheiro) é a equipe, no painel. O hóspede entrou pelo código enviado ao e-mail da reserva; as duas funções filtram
 * pelo mesmo e-mail e pelas mesmas reservas vigentes de `hospede/portal.ts` (deny-by-default aqui, não só em quem chama).
 *
 * - O momento que vale é o do servidor ao receber o pedido (decreto 7.962, art. 5º §4): capturado antes de qualquer
 *   trava, gravado com o canal "site" e nunca mais mudado. Pedir de novo devolve o mesmo horário.
 * - Só reservas pagas pelo site (pagamento que confirmou a reserva, aprovado), antes do horário de entrada, com o
 *   botão ligado em Configurações → Pagamento no site. M8.2d: todo pagamento da reserva (também a diferença de uma
 *   alteração) aprovado, ou devolvido (em parte ou por inteiro) pelas devoluções do sistema (a mesma regra do painel);
 *   depois de uma alteração, o prazo conta da entrada que conta (`entradaQueConta`) e o horário de entrada é o da entrada
 *   atual.
 * - A equipe recebe um e-mail (sem nome nem e-mail do hóspede) e o pedido aparece no Início e na ficha.
 * - Nunca valores: as datas da política e uma palavra (devolução integral ou sem devolução), como no resto do portal.
 */
import { and, eq, inArray } from "drizzle-orm";
import { normalizarEmail } from "@/acesso/entrada";
import { emailValido } from "@/acesso/codigo-email";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { decidirPelaPolitica, entradaQueConta, horaDeEntrada, pagaSemPrazoIntegral, TEXTO_VALOR_PELA_EQUIPE } from "@/configuracoes/politica-cancelamento";
import { travaOcupada, violouUnicidade } from "@/db/erros";
import { cancelamentosReserva, cotacoes, devolucoesPagamento, imoveis, imoveisDetalhes, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { avisarEquipePorEmail, type ResultadoAviso } from "@/email/aviso-equipe";
import type { Correio } from "@/email/correio";
import { hojeISO, instanteLocal } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { devolucaoInexplicada, devolucoesDoPagamento, devolvidoPeloSistema, type Pagamento, pagamentosDaReserva, travarCotacao } from "@/pagamentos/travas";
import { politicaDoPagamento } from "@/site/aceites";
import { doEmail, vigentes } from "./portal";

export type CancelamentoNoPortal = {
  /** O botão "Pedir o cancelamento" aparece. */
  podePedir: boolean;
  /** Pedido já recebido (e ainda sem decisão): quando chegou. */
  pedidoEm: Date | null;
  /** Último dia do reembolso integral (até 23h59), pela versão aceita; null sem política. */
  integralAte: string | null;
  /** Último dia do arrependimento (até 23h59); null sem política. */
  arrependimentoAte: string | null;
  /** O arrependimento vale só até a entrada (pela versão aceita). */
  arrependimentoAteEntrada: boolean;
  /** O horário de entrada (depois dele, o botão some: saída antecipada não é cancelamento). */
  entradaEm: Date;
  /** O que a política daria para um pedido feito agora; null sem política. */
  direitoAgora: "integral" | "nenhum" | null;
  /** O pagamento foi feito sem o aceite das páginas legais: a equipe confirma o valor por escrito. */
  semPolitica: boolean;
  /** Onde acompanhar: a página da reserva no site. */
  linkCotacao: string;
};

/** A mesma resposta para qualquer recusa que diga respeito a quem é o hóspede (nunca revela se a reserva existe). */
export const NAO_DA = "Não foi possível registrar o pedido por aqui: fale com a equipe.";
/** As outras recusas do pedido (Minha reserva mostra cada uma pelo código do endereço). */
export const PEDIDO_DESLIGADO = "O pedido de cancelamento pelo site está desligado: fale com a equipe.";
export const ESTADIA_COMECOU = "A estadia já começou: para cancelar, fale com a equipe.";
export const JA_CANCELADA = "Esta reserva já foi cancelada.";
export const PEDIDO_OCUPADO = "Não deu para registrar o pedido agora: tente de novo em instantes.";

/** A reserva paga pelo site deste e-mail (vigente), o pagamento que a confirmou e o que a política precisa. */
async function reservaDoHospede(db: Db, organizacaoId: string, email: string, reservaCodigo: string, agora: Date) {
  const e = normalizarEmail(email);
  if (!emailValido(e) || !/^[A-Z0-9-]{1,20}$/i.test(reservaCodigo)) return null;
  const [r] = await db
    .select({
      id: reservas.id,
      codigo: reservas.codigo,
      checkin: reservas.checkin,
      fuso: imoveis.fuso,
      imovelId: imoveis.id,
      imovelNome: imoveis.nome,
      hora: imoveisDetalhes.checkinAPartirDe,
    })
    .from(reservas)
    .innerJoin(imoveis, and(eq(imoveis.id, reservas.imovelId), eq(imoveis.organizacaoId, reservas.organizacaoId)))
    .leftJoin(imoveisDetalhes, eq(imoveisDetalhes.imovelId, imoveis.id))
    .where(and(doEmail(organizacaoId, e), vigentes(hojeISO(undefined, agora)), eq(reservas.codigo, reservaCodigo.toUpperCase())));
  if (!r) return null;
  const [p] = await db
    .select({
      id: pagamentos.id,
      situacao: pagamentos.situacao,
      aprovadoEm: pagamentos.aprovadoEm,
      criadoEm: pagamentos.criadoEm,
      valorPago: pagamentos.valorPago,
      valor: pagamentos.valor,
      cotacaoId: pagamentos.cotacaoId,
      cotacaoCodigo: cotacoes.codigo,
      cotacaoCheckin: cotacoes.checkin,
    })
    .from(pagamentos)
    .innerJoin(cotacoes, eq(cotacoes.id, pagamentos.cotacaoId))
    .where(and(eq(pagamentos.reservaId, r.id), eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.desfecho, "reserva")));
  if (!p) return null;
  // Todos os pagamentos com o dinheiro da reserva (M8.2d: também a diferença de uma alteração) e as devoluções deles.
  const daReserva = await db.select().from(pagamentos).where(and(eq(pagamentos.reservaId, r.id), eq(pagamentos.organizacaoId, organizacaoId), inArray(pagamentos.desfecho, ["reserva", "alteracao"])));
  const devolucoes = daReserva.length ? await db.select().from(devolucoesPagamento).where(inArray(devolucoesPagamento.pagamentoId, daReserva.map((x) => x.id))) : [];
  const fuso = r.fuso || "America/Sao_Paulo";
  const horaEntrada = horaDeEntrada(r.hora);
  return { email: e, r, p, fuso, horaEntrada, entradaEm: instanteLocal(r.checkin, horaEntrada, fuso), aprovados: todosAprovados(daReserva, devolucoes) };
}

/**
 * Todo pagamento com o dinheiro da reserva está aprovado, ou devolvido em parte pelas devoluções do sistema (uma alteração
 * com devolução, M8.2d), ou devolvido por inteiro por elas (a diferença de um aumento devolvida numa redução: quitado) — a
 * mesma regra do painel —, e algum ainda tem o dinheiro. Uma devolução que o sistema não explica (painel do Mercado Pago)
 * esconde o botão: a equipe resolve.
 */
const todosAprovados = (ps: readonly Pagamento[], devolucoes: Parameters<typeof devolucoesDoPagamento>[0]["devolucoes"]) =>
  ps.some((x) => x.situacao !== "devolvido") &&
  ps.every((x) => {
    const devs = devolucoesDoPagamento({ devolucoes }, x.id);
    return x.situacao === "aprovado" || (x.situacao === "devolvido_parcial" && !devolucaoInexplicada(x, devs)) || devolvidoPeloSistema(x, devs);
  });

/**
 * O quadro "Cancelar a reserva" de Minha reserva. null = não é uma reserva paga pelo site deste e-mail (ou não está mais
 * vigente): o quadro não aparece.
 */
export async function cancelamentoNoPortal(db: Db, organizacaoId: string, email: string, reservaCodigo: string, agora: Date): Promise<CancelamentoNoPortal | null> {
  const x = await reservaDoHospede(db, organizacaoId, email, reservaCodigo, agora);
  if (!x) return null;
  const [ativo] = await db
    .select({ situacao: cancelamentosReserva.situacao, pedidoRecebidoEm: cancelamentosReserva.pedidoRecebidoEm })
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.reservaId, x.r.id), eq(cancelamentosReserva.organizacaoId, organizacaoId), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])));
  if (ativo?.situacao === "cancelada") return null;
  const ligado = (await lerConfigPagamentoSite(db, organizacaoId)).pedidoCancelamentoNoPortal;
  const politica = await politicaDoPagamento(db, organizacaoId, x.p.id);
  const decisao = politica
    ? decidirPelaPolitica({
        regras: politica.regras,
        // Depois de uma alteração, os prazos contam da entrada que conta (a menor entre a original e a atual); a estadia
        // começa na atual. A mesma data do painel e da página da reserva.
        checkin: entradaQueConta(x.p.cotacaoCheckin, x.r.checkin),
        entradaAtual: x.r.checkin,
        horaEntrada: x.horaEntrada,
        fuso: x.fuso,
        aprovadoEm: x.p.aprovadoEm ?? x.p.criadoEm,
        pedidoRecebidoEm: agora,
        quemCancela: "hospede",
        valorBase: x.p.valorPago ?? x.p.valor,
      })
    : null;
  const pedidoEm = ativo?.situacao === "pedido" ? ativo.pedidoRecebidoEm : null;
  return {
    podePedir: ligado && !pedidoEm && x.aprovados && agora.getTime() < x.entradaEm.getTime(),
    pedidoEm,
    integralAte: decisao?.integralAte ?? null,
    arrependimentoAte: decisao?.arrependimentoAte ?? null,
    arrependimentoAteEntrada: politica?.regras.arrependimentoAteEntrada !== false,
    entradaEm: x.entradaEm,
    direitoAgora: decisao && decisao.calculado !== "sem_politica" ? decisao.calculado : null,
    semPolitica: !politica,
    linkCotacao: `/reservar/${x.p.cotacaoCodigo}`,
  };
}

/**
 * "Pedir o cancelamento" (Minha reserva). O horário é o do servidor agora, travado; pedir de novo devolve o mesmo. A
 * trava ocupada é tentada uma vez de novo, com o MESMO horário (o hóspede pediu agora, não quando a trava soltou).
 */
export async function pedirCancelamentoPeloHospede(
  db: Db,
  organizacaoId: string,
  email: string,
  reservaCodigo: string,
  agora: Date,
): Promise<{ ok: true; recebidoEm: Date; cancelamentoId: string; novo: boolean } | { ok: false; erro: string }> {
  // O momento que vale: o do servidor ao receber, antes de qualquer trava.
  const recebidoEm = agora;
  if (!(await lerConfigPagamentoSite(db, organizacaoId)).pedidoCancelamentoNoPortal) return { ok: false, erro: PEDIDO_DESLIGADO };
  const x = await reservaDoHospede(db, organizacaoId, email, reservaCodigo, agora);
  if (!x || !x.aprovados) return { ok: false, erro: NAO_DA };
  if (recebidoEm.getTime() >= x.entradaEm.getTime()) return { ok: false, erro: ESTADIA_COMECOU };
  const tentar = () =>
    db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, x.p.cotacaoId);
      const p = t?.tentativas.find((y) => y.desfecho === "reserva");
      // Sob a trava: a reserva ainda é deste e-mail e está confirmada, com todo pagamento dela aprovado (ou em parte pelo
      // sistema). A cancelada antes (a devolução já pode ter mudado o pagamento) responde "já cancelada".
      if (!t || !p || p.id !== x.p.id || t.reserva.hospedeEmail.trim().toLowerCase() !== x.email) return { ok: false as const, erro: NAO_DA };
      if (t.cancelamento?.situacao === "cancelada" || t.reserva.estado === "cancelada") return { ok: false as const, erro: JA_CANCELADA };
      if (t.reserva.estado !== "confirmada" || !todosAprovados(pagamentosDaReserva(t), t.devolucoes)) return { ok: false as const, erro: NAO_DA };
      if (t.cancelamento?.situacao === "pedido") return { ok: true as const, recebidoEm: t.cancelamento.pedidoRecebidoEm, cancelamentoId: t.cancelamento.id, novo: false };
      const [linha] = await tx
        .insert(cancelamentosReserva)
        .values({ organizacaoId, reservaId: t.reserva.id, pagamentoId: p.id, situacao: "pedido", pedidoRecebidoEm: recebidoEm, canal: "site", quemCancela: "hospede", pedidoPor: null, criadoEm: recebidoEm, atualizadoEm: recebidoEm })
        .returning();
      t.cancelamento = linha;
      await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "reserva.cancelamento_pedido", entidade: "reserva", entidadeId: t.reserva.id, mudancas: { canal: [null, "site"], recebidoEm: [null, recebidoEm.toISOString()] } });
      return { ok: true as const, recebidoEm, cancelamentoId: linha.id, novo: true };
    });
  for (let vez = 0; ; vez++) {
    try {
      return await tentar();
    } catch (erro) {
      // Trava ocupada (a equipe mexendo na reserva): uma vez de novo, com o mesmo horário.
      if (travaOcupada(erro) && vez === 0) continue;
      if (travaOcupada(erro)) return { ok: false, erro: PEDIDO_OCUPADO };
      if (violouUnicidade(erro, "cancelamentos_reserva_um_ativo")) {
        // Outro pedido (ou o cancelamento da equipe) gravado ao mesmo tempo: responde pelo que ficou.
        const [c] = await db
          .select()
          .from(cancelamentosReserva)
          .where(and(eq(cancelamentosReserva.reservaId, x.r.id), eq(cancelamentosReserva.organizacaoId, organizacaoId), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])));
        if (c?.situacao === "pedido") return { ok: true, recebidoEm: c.pedidoRecebidoEm, cancelamentoId: c.id, novo: false };
        return { ok: false, erro: JA_CANCELADA };
      }
      throw erro;
    }
  }
}

const diaIso = (d: string) => d.split("-").reverse().slice(0, 2).join("/");

/**
 * O que a política aceita diz em Minha reserva, sem valores (M9.1): o prazo do reembolso integral, o arrependimento (só
 * quando vai além do prazo) e o que um pedido feito agora daria. Sem política aceita, a equipe confirma o valor por escrito.
 */
export function textoDaPoliticaNoPortal(c: Pick<CancelamentoNoPortal, "semPolitica" | "integralAte" | "arrependimentoAte" | "arrependimentoAteEntrada" | "direitoAgora">): string {
  if (c.semPolitica || !c.integralAte) return TEXTO_VALOR_PELA_EQUIPE;
  const ateEntrada = c.arrependimentoAteEntrada ? " ou até a entrada, o que vier antes" : "";
  const agora = c.direitoAgora === "integral" ? "devolução integral" : "sem devolução pela política";
  // Paga já depois do prazo do reembolso integral: esse prazo nunca valeu para ela; vale só o arrependimento.
  if (pagaSemPrazoIntegral(c) && c.arrependimentoAte)
    return `Pela Política de cancelamento que você aceitou, esta reserva foi paga quando o prazo de devolução integral já tinha passado: há devolução integral só no arrependimento, até ${diaIso(c.arrependimentoAte)}${ateEntrada}. Pedido feito agora: ${agora}.`;
  const arrependimento = c.arrependimentoAte && c.arrependimentoAte > c.integralAte ? `, salvo o arrependimento até ${diaIso(c.arrependimentoAte)}${ateEntrada}` : "";
  return `Pela Política de cancelamento que você aceitou: pedidos até ${diaIso(c.integralAte)} (23h59) têm devolução integral; depois disso, não há devolução${arrependimento}. Pedido feito agora: ${agora}.`;
}

/** A pergunta do botão "Pedir o cancelamento" (Minha reserva). Sem política aceita, não cita política nenhuma. */
export const perguntaDoPedidoDeCancelamento = (codigo: string, semPolitica: boolean) =>
  `Pedir o cancelamento da reserva ${codigo}? A data e a hora em que recebemos o pedido ficam registradas agora. A equipe confirma com você, por escrito, o valor que será devolvido${semPolitica ? "" : " pela política que você aceitou ao pagar"}.`;

const diaHoraBrasilia = (d: Date) => {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...o }).format(d);
  return `${f({ day: "2-digit", month: "2-digit" })} às ${f({ hour: "2-digit", minute: "2-digit" })}`;
};

/** O e-mail à equipe (puro): o código da reserva, o apartamento e a hora; nunca o nome nem o e-mail do hóspede. */
export function mensagemPedidoDeCancelamento(d: { reservaCodigo: string; imovel: string; recebidoEm: Date }, linkPainel: string): { assunto: string; texto: string } {
  return {
    assunto: `Pedido de cancelamento pelo site: reserva ${d.reservaCodigo}`,
    texto: `Pedido de cancelamento pelo site: reserva ${d.reservaCodigo} (${d.imovel}), recebido em ${diaHoraBrasilia(d.recebidoEm)} (horário de Brasília). Veja no painel: ${linkPainel}.\n`,
  };
}

/** Avisa a equipe do pedido (depois da resposta ao hóspede; falha não desfaz o pedido, que já está no painel). */
export async function avisarEquipeDoPedido(db: Db, organizacaoId: string, cancelamentoId: string, correio: Correio | null, linkPainel: string): Promise<ResultadoAviso> {
  if (!uuidValido(cancelamentoId)) return "falhou";
  const [c] = await db
    .select({ id: cancelamentosReserva.id, recebidoEm: cancelamentosReserva.pedidoRecebidoEm, reservaCodigo: reservas.codigo, imovel: imoveis.nome })
    .from(cancelamentosReserva)
    .innerJoin(reservas, eq(reservas.id, cancelamentosReserva.reservaId))
    .innerJoin(imoveis, eq(imoveis.id, reservas.imovelId))
    .where(and(eq(cancelamentosReserva.id, cancelamentoId), eq(cancelamentosReserva.organizacaoId, organizacaoId)));
  if (!c) return "falhou";
  return avisarEquipePorEmail(db, organizacaoId, correio, { ...mensagemPedidoDeCancelamento(c, linkPainel), chave: `cancelamento:${c.id}:aviso`, rotulo: "pedido de cancelamento" });
}
