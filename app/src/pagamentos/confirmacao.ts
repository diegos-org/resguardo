/**
 * Pagamento no site (M8.2a) — o que fazer com uma aprovação (design "Confirmação"), dentro da transação que leu a
 * aprovação, com as travas imóvel → reserva → cotação → tentativas tomadas. A decisão é gravada na mesma
 * transação; depois disso só a equipe muda o desfecho.
 *
 * "Datas seguradas" = reserva ainda `pedido` e cotação ainda `segurada`, conferidas sob trava (as noites nunca
 * foram liberadas), seja qual for o relógio.
 * 1. Aprovado com as datas seguradas e sem conflito: a reserva vira `confirmada` (quem recebe = empresa), a
 *    cotação `convertida`, o motor roda. Desfecho `reserva`.
 * 2. Aprovado depois que o pedido venceu (cotação `expirada`): noites livres no SCL e na leitura atual do Beds24 →
 *    a mesma reserva volta a `confirmada` ("confirmação tardia").
 * 3. Qualquer outro caso: aprovado sem reserva, com o motivo (noites ocupadas ou sem leitura, cancelado pela
 *    equipe, valor diferente, outra tentativa já com a reserva, reserva confirmada à mão com recebimento manual).
 * 4. Reserva confirmada à mão (sem recebimento manual e sem outra tentativa com a reserva): o pagamento vira o
 *    desfecho `reserva` dela.
 *
 * Confirmação tardia com outra reserva do site do mesmo e-mail confirmada depois que esta tentativa foi criada (M8.2b):
 * a regra de reviver não muda, mas o pagamento ganha o aviso `outra_reserva_mesmo_email` (o hóspede pode ter pago duas
 * vezes, por exemplo um cartão em análise e depois um Pix noutro aparelho).
 */
import { and, eq, gt, ne } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { cotacoes, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { aplicarMotor } from "@/financeiro/aplicar";
import { confirmarPedidoPago } from "@/reservas/repositorio";
import { noitesLivres } from "@/site/disponibilidade";
import { temRecebimentoManual } from "./andamento";
import type { Cobranca } from "./provedor";
import type { CodigoAviso, MotivoSemReserva } from "./situacoes";
import type { Pagamento, Travado } from "./travas";

/** `avisos`: os do motor; `avisosPagamento`: códigos de aviso para a própria tentativa (ligados por `aplicarLeitura`). */
export type Decisao = { desfecho: "reserva" | null; desfechoMotivo: string | null; motivoSemReserva: string | null; confirmou: boolean; avisos: string[]; avisosPagamento?: CodigoAviso[] };

/**
 * O valor aprovado é o total da cotação? O que enviamos (total_amount), o valor da transação de pagamento (precisa vir
 * na order: sem ele, não se confirma) e o total pago quando vier. No cartão parcelado, o pago pode passar do total pelos
 * juros, que são do hóspede (M8.2b): decidido pela tentativa (forma e parcelas que o Mercado Pago validou na criação),
 * não pela leitura (o GET pode vir sem o tipo e as parcelas). No Pix e no cartão à vista, precisa ser igual.
 */
export function valorConfere(c: Cobranca | null, p: Pick<Pagamento, "valor" | "forma" | "parcelas">, total: number): boolean {
  if (p.valor !== total || !c) return false;
  if (c.valor !== total || c.valorTransacao !== total) return false;
  if (c.pago === null || c.pago === total) return true;
  return p.forma === "cartao" && (c.parcelas ?? p.parcelas ?? 1) > 1 && c.pago > total;
}

/**
 * Outra reserva do site com o mesmo e-mail, confirmada depois que a tentativa foi criada? (Só se pergunta na confirmação
 * tardia: enquanto o pedido estava segurado, o mesmo e-mail não segurava outras datas.)
 */
async function outraReservaDoMesmoEmail(tx: Db, organizacaoId: string, r: Travado["reserva"], desde: Date): Promise<boolean> {
  if (!r.hospedeEmail) return false;
  const [outra] = await tx
    .select({ id: reservas.id })
    .from(reservas)
    .where(and(eq(reservas.organizacaoId, organizacaoId), eq(reservas.origem, "site"), eq(reservas.hospedeEmail, r.hospedeEmail), eq(reservas.estado, "confirmada"), ne(reservas.id, r.id), gt(reservas.confirmadaEm, desde)))
    .limit(1);
  return Boolean(outra);
}

const semReserva = (m: MotivoSemReserva, detalhe?: string | null): Decisao => ({ desfecho: null, desfechoMotivo: null, motivoSemReserva: detalhe ? `${m}:${detalhe}` : m, confirmou: false, avisos: [] });

export async function decidirAprovacao(tx: Db, organizacaoId: string, t: Travado, p: Pagamento, c: Cobranca | null, fin: { taxa: number | null; liquido: number | null }, agora: Date): Promise<Decisao> {
  const r = t.reserva;
  const cot = t.cotacao;
  // Dinheiro real no ambiente de teste: nunca confirma uma reserva com ele.
  if (p.aoVivo === true || c?.aoVivo === true) return semReserva("ao_vivo");
  if (!valorConfere(c, p, cot.total)) return semReserva("valor_divergente");
  if (t.tentativas.some((x) => x.id !== p.id && x.desfecho === "reserva")) return semReserva("outra_tentativa");

  const confirmar = async (tardio: boolean): Promise<Decisao> => {
    const res = await confirmarPedidoPago(tx, organizacaoId, r.id, { agora, tardio, pagamentoId: p.id, taxaCanal: fin.taxa, valorLiquido: fin.liquido });
    if (!res.ok) return semReserva("outro");
    await tx.update(cotacoes).set({ estado: "convertida", atualizadaEm: agora }).where(eq(cotacoes.id, cot.id));
    const avisosPagamento: CodigoAviso[] = tardio && (await outraReservaDoMesmoEmail(tx, organizacaoId, r, p.criadoEm)) ? ["outra_reserva_mesmo_email"] : [];
    return { desfecho: "reserva", desfechoMotivo: tardio ? "confirmada_tardia" : "confirmada", motivoSemReserva: null, confirmou: true, avisos: res.avisos, avisosPagamento };
  };

  // Recebimento registrado à mão na reserva (ainda pedido, ou cancelada antes da confirmação tardia): o dinheiro do site
  // não se liga a ela (a liberação lançaria um segundo recebimento).
  if (r.estado !== "confirmada" && (await temRecebimentoManual(tx, organizacaoId, r.id))) return semReserva("recebimento_manual");
  if (r.estado === "pedido" && cot.estado === "segurada") {
    // Nunca liberadas, mas uma reserva de OTA importada no meio pode ter caído nas mesmas noites.
    const livres = await noitesLivres(tx, organizacaoId, r.imovelId, r.checkin, r.checkout, { excetoReservaId: r.id, exigirLeituraAtual: false, agora });
    if (!livres.livres) return semReserva("conflito", livres.conflito);
    return confirmar(false);
  }
  if (cot.estado === "expirada" && r.estado === "cancelada") {
    const livres = await noitesLivres(tx, organizacaoId, r.imovelId, r.checkin, r.checkout, { excetoReservaId: r.id, exigirLeituraAtual: true, agora });
    if (!livres.livres) return livres.motivo === "sem_leitura" ? semReserva("sem_leitura") : semReserva("noites_ocupadas", livres.conflito);
    return confirmar(true);
  }
  // Cancelado pela equipe (cotação cancelada, ou reserva cancelada com a cotação ainda segurada): nunca é revivido.
  if (cot.estado === "cancelada" || r.estado === "cancelada") return semReserva("cancelada_pela_equipe");
  if (r.estado === "confirmada") {
    if (await temRecebimentoManual(tx, organizacaoId, r.id)) return semReserva("recebimento_manual");
    // Confirmada à mão pela equipe: o dinheiro é dela. Quem recebe passa a ser a empresa (é fato) e a taxa entra.
    const muda = r.recebimento !== "empresa" || (fin.taxa !== null && (r.taxaCanal !== fin.taxa || r.valorLiquido !== fin.liquido));
    if (muda) {
      await tx
        .update(reservas)
        .set({ recebimento: "empresa", ...(fin.taxa !== null ? { taxaCanal: fin.taxa, valorLiquido: fin.liquido } : {}), conferenciaResolvidaEm: null, atualizadoEm: agora })
        .where(eq(reservas.id, r.id));
    }
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: null,
      acao: "pagamento.vincular",
      entidade: "reserva",
      entidadeId: r.id,
      mudancas: { pagamento: [null, p.id], ...(r.recebimento !== "empresa" ? { recebimento: [r.recebimento, "empresa"] } : {}), ...(fin.taxa !== null && r.taxaCanal !== fin.taxa ? { taxaCanal: [r.taxaCanal, fin.taxa] } : {}) },
    });
    const m = muda ? await aplicarMotor(tx, organizacaoId, r.id, null) : null;
    if (cot.estado === "segurada") await tx.update(cotacoes).set({ estado: "convertida", atualizadaEm: agora }).where(eq(cotacoes.id, cot.id));
    return { desfecho: "reserva", desfechoMotivo: "confirmada_pela_equipe", motivoSemReserva: null, confirmou: true, avisos: m?.avisos ?? [] };
  }
  return semReserva("outro");
}
