/**
 * O cancelamento pela política na tela do painel (M8.2c; desenho §9.2): a prévia em linhas prontas — o formulário do
 * navegador só mostra texto, nunca calcula nem decide — e os textos de cada resultado. Puro (sem banco).
 */
import { HORA_LIMITE_DO_DIA } from "@/configuracoes/politica-cancelamento";
import type { SituacaoDevolucao } from "@/db/schema";
import { diaMesBr } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { diaHoraBr, type EscolhaDaEquipe, escolhaDaEquipe, NOMES_BASE_CANCELAMENTO, NOMES_CANAL_PEDIDO, type Previa, type RotaDevolucao } from "./cancelamento";

/** A prévia como vai ao navegador: só textos, a assinatura (conferida de novo no servidor) e a pergunta do BotaoConfirmar. */
export type PreviaParaTela = {
  assinatura: string;
  /** O texto do BotaoConfirmar "Cancelar a reserva": o valor, a base, a rota e a perda do proprietário. */
  pergunta: string;
  rota: RotaDevolucao;
  direito: "integral" | "nenhum";
  /** O que a política diz (antes da decisão da equipe). */
  calculado: "integral" | "nenhum" | "sem_politica";
  /** O que a equipe pode escolher (a mesma regra das recusas): a exceção, ou devolver tudo / não devolver sem política. */
  escolha: EscolhaDaEquipe | null;
  /** O momento que a política conta (e por onde o pedido chegou). */
  momento: string;
  /** "Leitura do Mercado Pago de dd/mm às HH:MM: aprovado." */
  leitura: string;
  /** A versão aceita e os prazos dela; null sem política aceita. */
  politica: string | null;
  /** O que a política dá (e a decisão da equipe, na exceção e sem política). */
  resultado: string;
  componentes: string[];
  /** Como a devolução sai; null sem devolução. */
  comoSai: string | null;
  avisos: string[];
};

const ROTAS: Record<Exclude<RotaDevolucao, "nenhuma">, string> = {
  pedida: "pelo Mercado Pago agora",
  fora_do_prazo: "pelo painel do Mercado Pago ou por fora (mais de 78 dias)",
  ja_devolvida: "já devolvida no Mercado Pago",
};
/** A linha da leitura é sempre o último aviso da prévia (o domínio a põe por último): vira a primeira linha do quadro. */
const ehLeitura = (a: string) => a.startsWith("Leitura do Mercado Pago de ") || a.startsWith("Ainda sem leitura do Mercado Pago");

/** A prévia do domínio em linhas para a tela (§9.2). */
export function previaParaTela(p: Previa): PreviaParaTela {
  const integral = p.direito === "integral";
  const c = p.componentes;
  const momento =
    p.base === "empresa"
      ? `A SCL cancela agora (${diaHoraBr(p.recebidoEm)}).`
      : p.base === "nao_comparecimento"
        ? `Não comparecimento registrado agora (${diaHoraBr(p.recebidoEm)}).`
        : `Pedido recebido em ${diaHoraBr(p.recebidoEm)}${p.canal ? ` (${NOMES_CANAL_PEDIDO[p.canal]})` : ""}.`;
  const politica = p.politica
    ? [
        `Política aceita: versão ${p.politica.versao} de ${diaMesBr(p.politica.data)}`,
        p.decisao.integralAte ? ` — reembolso integral para pedidos até ${diaMesBr(p.decisao.integralAte)} (${HORA_LIMITE_DO_DIA})` : "",
        p.decisao.arrependimentoAte ? `; arrependimento até ${diaMesBr(p.decisao.arrependimentoAte)}${p.politica.arrependimentoAteEntrada ? ", ou até a entrada" : ""}` : "",
        ".",
      ].join("")
    : null;
  const valor = formatBRL(p.valorADevolver);
  const resultado =
    p.decisao.calculado === "sem_politica"
      ? `Sem política aceita: o sistema não calcula. Decisão da equipe: ${integral ? `devolução integral de ${valor}` : "sem devolução"}.`
      : p.base === "excecao"
        ? `Pela política: sem devolução — ${NOMES_BASE_CANCELAMENTO[p.decisao.base]}. Por exceção: devolução integral de ${valor}.`
        : integral
          ? `Pela política: devolução integral de ${valor} — ${NOMES_BASE_CANCELAMENTO[p.base]}.`
          : `Pela política: sem devolução — ${NOMES_BASE_CANCELAMENTO[p.base]}.`;
  const jaRepassado = c.jaRepassada.reduce((s, x) => s + x.valor, 0);
  const componentes = [
    `Parte do proprietário: ${formatBRL(c.parteProprietario)} (${integral ? "sai do financeiro" : "fica, dividida como uma reserva normal"}).`,
    `Comissão da SCL: ${formatBRL(c.comissao)}${integral ? " (sai do financeiro)" : ""}.`,
    `Taxa do Mercado Pago: ${c.taxa === null ? "ainda não informada" : formatBRL(c.taxa)}.`,
    ...(integral && jaRepassado > 0 ? [`Já repassado ao proprietário: ${formatBRL(jaRepassado)} (desconto lançado agora, sai do próximo repasse).`] : []),
    ...(c.perdaDoProprietario > 0 ? [`O proprietário deixa de receber: ${formatBRL(c.perdaDoProprietario)}.`] : []),
    ...(c.ajustes.length ? [`Ajustes desta reserva (não mexidos): ${c.ajustes.map((a) => `${a.descricao} (${formatBRL(a.valor)})`).join("; ")}.`] : []),
    ...(!integral ? [`Valor retido: ${formatBRL(p.valorRetido)} (o que o hóspede pagou).`] : []),
  ];
  return {
    assinatura: p.assinatura,
    pergunta: p.pergunta,
    rota: p.rota,
    direito: p.direito,
    calculado: p.decisao.calculado,
    escolha: escolhaDaEquipe(p.decisao.calculado),
    momento,
    leitura: p.avisos.find(ehLeitura) ?? "Ainda sem leitura do Mercado Pago deste pagamento.",
    politica,
    resultado,
    componentes,
    comoSai: p.rota === "nenhuma" ? null : `Como a devolução sai: ${ROTAS[p.rota]}.`,
    avisos: p.avisos.filter((a) => !ehLeitura(a)),
  };
}

/** O que a ficha mostra depois de cada ação do cancelamento (o endereço leva só a chave; o texto é este, fixo). */
export const RESULTADOS_DO_CANCELAMENTO = {
  pedida: "Reserva cancelada. Devolução pedida ao Mercado Pago: a confirmação aparece aqui quando ele concluir (use Conferir agora).",
  confirmada: "Reserva cancelada e devolução confirmada pelo Mercado Pago.",
  fora_do_prazo: "Reserva cancelada. O pagamento tem mais de 78 dias: devolva pelo painel do Mercado Pago (cartão) e confirme aqui, ou faça a devolução por fora (Pix).",
  recusada: "Reserva cancelada. O Mercado Pago não aceitou a devolução agora: veja o aviso no quadro do pagamento.",
  retida: "Reserva cancelada sem devolução: o valor fica retido e dividido como uma reserva normal.",
  pedido_registrado: "Pedido de cancelamento registrado: a data e a hora em que ele chegou ficam valendo.",
  pedido_descartado: "Pedido de cancelamento descartado: a reserva continua confirmada (o pedido fica no histórico).",
  ota: "Datas marcadas como reabertas nas OTAs.",
  avisado: "Mensagem marcada como enviada ao hóspede.",
} as const;
export type ResultadoDoCancelamento = keyof typeof RESULTADOS_DO_CANCELAMENTO;

/**
 * A chave do resultado de um cancelamento feito: sem devolução, retida; pela situação da devolução depois da fase 2
 * (pedida, incerta ou à espera do Mercado Pago = pedida); recusada pelo prazo (rota da prévia) ou pelo Mercado Pago.
 */
export function resultadoDoCancelamento(r: { direito: "integral" | "nenhum"; devolucao: SituacaoDevolucao | null }, rota: string): ResultadoDoCancelamento {
  if (r.direito === "nenhum") return "retida";
  if (r.devolucao === "confirmada" || r.devolucao === "por_fora") return "confirmada";
  if (r.devolucao === "recusada") return rota === "fora_do_prazo" ? "fora_do_prazo" : "recusada";
  return "pedida";
}

/** O texto de um resultado vindo do endereço (só as chaves conhecidas; o resto não mostra nada). */
export function textoDoResultado(v: unknown): string | null {
  return typeof v === "string" && Object.hasOwn(RESULTADOS_DO_CANCELAMENTO, v) ? RESULTADOS_DO_CANCELAMENTO[v as ResultadoDoCancelamento] : null;
}
