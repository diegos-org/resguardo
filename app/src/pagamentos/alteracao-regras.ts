/**
 * Alteração de reserva paga pelo site (M8.2d) — as regras puras, testáveis sem banco: as noites novas que precisam ser
 * seguradas, o rumo da diferença, a situação que vale agora (o prazo vencido sem carência vale como vencido, antes de a
 * rotina gravar), o valor que fica com a reserva, a taxa do Mercado Pago atribuída à parte devolvida e como uma
 * devolução se divide entre os pagamentos da reserva. Dinheiro em centavos inteiros; datas AAAA-MM-DD (noites
 * [entrada, saída), no fuso do imóvel).
 */
import type { DireitoCancelamento, SituacaoAlteracao } from "@/db/schema";

export type Estadia = { checkin: string; checkout: string };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (d: string) => DATA.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const estadiaValida = (e: Estadia) => dataValida(e.checkin) && dataValida(e.checkout) && e.checkout > e.checkin;

/**
 * As noites novas (as de depois que não estavam na estadia de antes), que a alteração precisa segurar: um intervalo
 * [início, fim), nenhum (null: a estadia nova cabe na de antes), ou "duas_pontas" quando acrescenta noites antes e depois
 * ao mesmo tempo (são duas alterações). Estadias que não se tocam: a nova inteira. Estadia inválida é erro de quem chama.
 */
export function noitesNovas(antes: Estadia, depois: Estadia): { inicio: string; fim: string } | null | "duas_pontas" {
  if (!estadiaValida(antes) || !estadiaValida(depois)) throw new Error("Estadia inválida.");
  if (depois.checkout <= antes.checkin || depois.checkin >= antes.checkout) return { inicio: depois.checkin, fim: depois.checkout };
  const antesDaEntrada = depois.checkin < antes.checkin;
  const depoisDaSaida = depois.checkout > antes.checkout;
  if (antesDaEntrada && depoisDaSaida) return "duas_pontas";
  if (antesDaEntrada) return { inicio: depois.checkin, fim: antes.checkin };
  if (depoisDaSaida) return { inicio: antes.checkout, fim: depois.checkout };
  return null;
}

export type Rumo = "aumento" | "reducao" | "igual";
/** O rumo da diferença (valor novo − valor de agora): o hóspede paga, a política decide a devolução, ou nada muda no dinheiro. */
export const rumoDa = (diferenca: number): Rumo => (diferenca > 0 ? "aumento" : diferenca < 0 ? "reducao" : "igual");

/**
 * A situação que vale agora: uma alteração `segurada` cujo prazo das datas passou, fora da carência (um pagamento da
 * diferença em andamento segura as datas por mais 15 minutos), vale como `expirada` em toda guarda e tela, mesmo antes de
 * a próxima ação gravar isso. Sem prazo gravado, nada a segura.
 */
export function situacaoEfetiva(a: { situacao: SituacaoAlteracao; holdAte: Date | null }, agora: Date, emCarencia: boolean): SituacaoAlteracao {
  if (a.situacao !== "segurada") return a.situacao;
  const vencida = !a.holdAte || a.holdAte.getTime() <= agora.getTime();
  return vencida && !emCarencia ? "expirada" : "segurada";
}

/**
 * O dinheiro que a reserva guarda depois da alteração (o valor bruto do motor): no aumento, o de antes mais a diferença
 * paga; na redução com devolução, o novo; na redução sem devolução (a política retém a diferença) e sem diferença, o de
 * antes.
 */
export function valorNovo(a: { valorAntes: number; valorDepois: number; diferenca: number; direito: DireitoCancelamento | null }): number {
  const rumo = rumoDa(a.diferenca);
  if (rumo === "aumento") return a.valorAntes + a.diferenca;
  if (rumo === "reducao" && a.direito === "integral") return a.valorDepois;
  return a.valorAntes;
}

const inteiro = (v: number) => Number.isSafeInteger(v);

/**
 * Taxa do Mercado Pago atribuída a `v` centavos de PRINCIPAL do pagamento (o valor da reserva, sem juros do parcelamento):
 * a proporção de `p.taxa` sobre `p.valor`, com meio centavo para cima. `v` acima de `p.valor` conta como `p.valor` (os
 * juros não têm taxa atribuída): nunca passa de `p.taxa`. null = a taxa do pagamento ainda não é conhecida.
 * A taxa de UMA devolução é a diferença entre a atribuída ao principal acumulado depois dela e antes dela: várias
 * devoluções de parte do valor nunca escorregam um centavo.
 */
export function taxaAtribuida(p: { taxa: number | null; valor: number }, v: number): number | null {
  if (!inteiro(p.valor) || p.valor <= 0 || !inteiro(v) || (p.taxa !== null && (!inteiro(p.taxa) || p.taxa < 0))) throw new Error("Valor inválido.");
  if (p.taxa === null) return null;
  // Em BigInt: taxa × principal pode passar do inteiro seguro do JavaScript num valor alto.
  const dois = BigInt(2);
  const principal = BigInt(Math.min(Math.max(v, 0), p.valor));
  const valor = BigInt(p.valor);
  return Number((dois * BigInt(p.taxa) * principal + valor) / (dois * valor));
}

/**
 * A parte principal e os juros de uma devolução de `valor` centavos pagos, na ordem acumulada das devoluções do pagamento
 * (`antes` = o que as anteriores já devolveram). Só a devolução que cruza `p.valor` leva juros (o pago com juros passa do
 * valor da reserva). Conta inteira, sem arredondar.
 */
export function principalEJuros(p: { valor: number }, antes: number, valor: number): { principal: number; juros: number } {
  if (!inteiro(p.valor) || p.valor <= 0 || !inteiro(antes) || antes < 0 || !inteiro(valor) || valor < 0) throw new Error("Valor inválido.");
  const principal = Math.min(antes + valor, p.valor) - Math.min(antes, p.valor);
  return { principal, juros: valor - principal };
}

export type PagamentoParaDividir = {
  id: string;
  criadoEm: Date;
  /** O principal que ainda dá para devolver deste pagamento (o teto da parte dele). */
  saldoPrincipal: number;
  /** A devolução sai agora pelo Mercado Pago: dentro da janela de 78 dias, liberado e com a taxa conhecida. */
  podeSairAgora: boolean;
};

/**
 * Divide a devolução entre os pagamentos que contam, cada um até o saldo principal dele: primeiro os que podem sair agora
 * (para não esperar a liberação de outro), depois os outros; dentro de cada grupo, o mais novo primeiro (empate pelo id).
 * null = os saldos não cobrem o total (nunca devolve a mais nem inventa de onde sai).
 */
export function dividirDevolucao(total: number, pagamentos: readonly PagamentoParaDividir[]): { pagamentoId: string; valor: number }[] | null {
  if (!inteiro(total) || total < 0 || pagamentos.some((p) => !inteiro(p.saldoPrincipal) || p.saldoPrincipal < 0)) throw new Error("Valor inválido.");
  const ordem = [...pagamentos].sort(
    (a, b) => Number(b.podeSairAgora) - Number(a.podeSairAgora) || b.criadoEm.getTime() - a.criadoEm.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const partes: { pagamentoId: string; valor: number }[] = [];
  let falta = total;
  for (const p of ordem) {
    if (falta === 0) break;
    const valor = Math.min(falta, p.saldoPrincipal);
    if (valor <= 0) continue;
    partes.push({ pagamentoId: p.id, valor });
    falta -= valor;
  }
  return falta === 0 ? partes : null;
}
