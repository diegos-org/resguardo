/**
 * Rodapé do portal (M5.2): saldo do acerto com o proprietário no fim do mês, quem deve a quem e o
 * Pix de quem recebe. Usa a mesma previsão do repasse mensal (`preverRepasses`), com os
 * adiantamentos já descontados — uma regra, um lugar. Credor/devedor e Pix só aparecem com o mês
 * terminado e sem nada em conferência; antes disso o saldo é mostrado como parcial.
 */
import type { Db } from "@/db/types";
import { formatBRL } from "@/lib/money";
import { MOTIVO_FECHAMENTO_DISPUTA } from "@/pagamentos/contestacao-regras";
import { ehDescontoDeCancelamento, ehLinhaDeContestacao } from "@/repasses/extrato";
import { limitesDoMes, preverRepasses } from "@/repasses/repasses";

export type SituacaoRodape =
  /** Repasse já feito. */
  | "pago"
  /** Mês fechado, repasse a transferir pela empresa. */
  | "fechado"
  /** Mês terminado, sem pendências: a empresa deve (Pix do proprietário). */
  | "empresa_deve"
  /** Mês terminado, sem pendências: o proprietário deve (Pix da empresa). */
  | "proprietario_deve"
  | "zerado"
  /** O mês ainda não terminou: saldo parcial, sem credor/Pix. */
  | "parcial"
  /** Há acerto pendente ou ajuste a esclarecer: sem credor/Pix até resolver. */
  | "em_conferencia"
  /** Sem repasse neste mês, mas um repasse posterior já levou o saldo acumulado. */
  | "no_repasse_posterior";

export type Rodape = {
  proprietarioId: string;
  nome: string;
  situacao: SituacaoRodape;
  /** Saldo do acerto no fim do mês (positivo: a empresa deve), como no repasse. */
  saldo: number;
  /** Adiantamentos da empresa a descontar (ou descontados no repasse). */
  descontado: number;
  /** Valor a transferir (quem deve a quem conforme a situação). */
  valor: number;
  /** A favor de quem está o valor (pelo líquido, já sem os contestados); null = zerado. */
  aFavor: "proprietario" | "empresa" | null;
  /** Chave Pix de quem recebe; vazio = não cadastrada. */
  chavePix: string;
  dataPagamento: string | null;
  /** Mudança no acerto depois do fechamento deste mês (vai para o próximo repasse). */
  diferenca: number;
  /** Mês fechado, mas com algo em conferência lançado depois. */
  emConferencia: boolean;
  /** Mês ("AAAA-MM") do repasse posterior que levou o saldo deste mês. */
  repassePosterior: string | null;
  /**
   * M8.2c: desconto de reserva cancelada com devolução ao hóspede (a parte já repassada) que o fechamento leva, em
   * centavos positivos; 0 = nenhum. Quando o proprietário fica devendo, essa parte não se transfere: o desconto continua a
   * descontar e sai do próximo repasse (`divisaoDoDeve`).
   */
  descontoCancelamento?: number;
  /**
   * M8.2e: o valor segurado pela disputa do pagamento que o fechamento leva (o líquido das linhas da disputa disponíveis,
   * em centavos positivos; 0 = nenhum). Como o desconto de cancelamento, não se transfere quando o proprietário fica
   * devendo: sai do próximo repasse (`divisaoDoDeve`).
   */
  descontoDisputa?: number;
  /**
   * M8.2e (C2): do que fica fora deste fechamento, a parte de reserva em conferência por disputa do pagamento (vai para o
   * repasse seguinte; nunca trava o fechamento). 0 = nenhuma.
   */
  foraPorDisputa?: number;
};

/**
 * O nome do desconto que não se transfere (o de reserva cancelada com devolução ao hóspede, M8.2c, e o da disputa do
 * pagamento, M8.2e), no singular: "o desconto de …" (ou "O desconto de …" com `maiuscula`). Uma regra, um lugar: o portal,
 * o PDF e o "como chega até você" leem daqui.
 */
export function nomeDoDescontoQueNaoSeTransfere(r: Pick<Rodape, "descontoCancelamento" | "descontoDisputa">, maiuscula = false): string {
  const cancelamento = (r.descontoCancelamento ?? 0) > 0;
  const disputa = (r.descontoDisputa ?? 0) > 0;
  const nome = disputa && !cancelamento ? "desconto da disputa do pagamento (valor segurado)" : disputa ? "desconto de reserva cancelada com devolução ao hóspede e da disputa do pagamento" : "desconto de reserva cancelada com devolução ao hóspede";
  return `${maiuscula ? "D" : "o d"}${nome.slice(1)}`;
}

/** M8.2e: a frase da parte presa por disputa do pagamento que fica para o próximo repasse (null = nenhuma). */
export const textoForaPorDisputa = (r: Pick<Rodape, "foraPorDisputa">): string | null =>
  (r.foraPorDisputa ?? 0) > 0 ? `${formatBRL(r.foraPorDisputa!)} da sua parte ficam para o próximo repasse: ${MOTIVO_FECHAMENTO_DISPUTA}.` : null;

/**
 * M8.2c: do que o proprietário deve no fechamento, quanto é desconto de reserva cancelada com devolução ao hóspede (e,
 * M8.2e, o valor segurado pela disputa do pagamento) — não se transfere: sai do próximo repasse, como diz o painel — e
 * quanto ele transfere (as despesas que passaram da parte dele). Uma regra, um lugar: o portal, o PDF e o "como chega até você" leem daqui; nunca um Pix para pagar o que o
 * próximo repasse já desconta (o desconto seria cobrado duas vezes).
 */
export function divisaoDoDeve(r: Pick<Rodape, "valor" | "descontoCancelamento" | "descontoDisputa">): { proximoRepasse: number; transferir: number } {
  const proximoRepasse = Math.min(r.valor, Math.max(0, r.descontoCancelamento ?? 0) + Math.max(0, r.descontoDisputa ?? 0));
  return { proximoRepasse, transferir: r.valor - proximoRepasse };
}

export async function rodapeDoPortal(
  db: Db,
  organizacaoId: string,
  o: { proprietarios: readonly { id: string; nome: string }[]; mes: string; hoje: string; pixEmpresa: string },
): Promise<Rodape[]> {
  const lim = limitesDoMes(o.mes);
  if (!lim || !o.proprietarios.length) return [];
  const previsoes = await preverRepasses(
    db,
    organizacaoId,
    o.mes,
    o.hoje,
    o.proprietarios.map((p) => p.id),
    // Todos, mesmo sem saldo: um ajuste sem valor a esclarecer precisa deixar o mês em conferência.
    true,
  );
  return o.proprietarios.map((dono) => {
    const p = previsoes.find((x) => x.proprietarioId === dono.id);
    const base = { proprietarioId: dono.id, nome: dono.nome, saldo: 0, descontado: 0, valor: 0, aFavor: null, chavePix: "", dataPagamento: null, diferenca: 0, emConferencia: false, repassePosterior: null, descontoCancelamento: 0, descontoDisputa: 0, foraPorDisputa: 0 };
    if (!p) return { ...base, situacao: "zerado" };
    const r = p.repasse;
    if (r) {
      // Fechado/pago, com o que mudou depois (lançamento novo, ajuste…) à parte: vai para o próximo repasse.
      return {
        ...base,
        saldo: r.saldo,
        descontado: r.descontado,
        valor: r.valor,
        aFavor: "proprietario",
        chavePix: p.chavePix,
        situacao: r.situacao === "pago" ? "pago" : "fechado",
        dataPagamento: r.dataPagamento,
        diferenca: p.diferencaPosFechamento,
        emConferencia: p.emConferencia,
      };
    }
    const aFavor = p.valor > 0 ? ("proprietario" as const) : p.deve > 0 ? ("empresa" as const) : null;
    const descontoCancelamento = -p.itens.filter(ehDescontoDeCancelamento).reduce((t, x) => t + x.valor, 0);
    const descontoDisputa = Math.max(0, -p.itens.filter(ehLinhaDeContestacao).reduce((t, x) => t + x.valor, 0));
    const comum = { ...base, saldo: p.saldo, descontado: p.aDescontar, aFavor, descontoCancelamento, descontoDisputa, foraPorDisputa: Math.max(0, p.foraPorDisputa) };
    if (o.hoje < lim.fim) return { ...comum, situacao: "parcial", valor: p.valor || p.deve };
    // Só o que é conferência de verdade (pendente, ajuste a esclarecer) segura o credor e o Pix.
    if (p.emConferencia) return { ...comum, situacao: "em_conferencia", valor: p.valor || p.deve };
    // "Já entrou no repasse de…" só com algo a levar (saldo, adiantamento ou mudança); mês vazio fica zerado.
    const houveAlgo = p.saldo !== 0 || p.aDescontar !== 0 || p.contestado !== 0 || p.diferencaPosFechamento !== 0;
    if (p.repassePosterior && houveAlgo) return { ...comum, situacao: "no_repasse_posterior", valor: 0, aFavor: null, repassePosterior: p.repassePosterior, diferenca: p.diferencaPosFechamento };
    if (p.valor > 0) return { ...comum, situacao: "empresa_deve", valor: p.valor, chavePix: p.chavePix };
    if (p.deve > 0) return { ...comum, situacao: "proprietario_deve", valor: p.deve, chavePix: o.pixEmpresa };
    return { ...comum, situacao: "zerado" };
  });
}
