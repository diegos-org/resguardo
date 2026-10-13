/**
 * A alteração de reserva paga pelo site na tela do painel (M8.2d; desenho §9.2): a prévia em linhas prontas — o formulário
 * do navegador só mostra texto, nunca calcula nem decide — e os textos de cada resultado. Puro (sem banco). A prévia leva
 * valores: só vai a quem calcula (reserva:editar + financeiro:editar, conferido na ação).
 */
import type { CalculoCancelamento } from "@/db/schema";
import { formatBRL } from "@/lib/money";
import type { MensagemPronta } from "@/mensagens/hospede";
import { noites } from "@/reservas/regras";
import type { Componentes, PreviaAlteracao } from "./alteracao";
import type { Rumo } from "./alteracao-regras";
import type { EscolhaDaEquipe } from "./cancelamento";

/** Uma linha da tabela "Antes / Depois / Diferença" (valores já em reais). */
export type LinhaDoFinanceiro = { rotulo: string; antes: string; depois: string; diferenca: string };

/** Qual texto de resultado a ficha mostra depois de segurar ou aplicar (o domínio já decidiu tudo; isto só escolhe a frase). */
export type RotaDaAlteracao = "aumento" | "pedida" | "liberacao" | "fora_do_prazo" | "sem_devolucao" | "igual";

/** A prévia como vai ao navegador: só textos, a assinatura (conferida de novo no servidor) e as perguntas do BotaoConfirmar. */
export type PreviaAlteracaoParaTela = {
  /** A alteração segurada (só na prévia do "Aplicar"); null na prévia de uma alteração nova. */
  alteracaoId: string | null;
  assinatura: string;
  /** O texto do BotaoConfirmar do botão principal (segurar no aumento; aplicar nas outras). */
  pergunta: string;
  /** O texto do BotaoConfirmar de "Só segurar as datas" (sem aumento, prévia nova); null quando não cabe. */
  perguntaSoSegurar: string | null;
  rumo: Rumo;
  direito: "integral" | "nenhum" | null;
  /** O que a política diz (antes da decisão da equipe); null fora da redução. */
  calculado: CalculoCancelamento | null;
  /** O que a equipe pode escolher na redução (a exceção, ou devolver / não devolver sem política). */
  escolha: EscolhaDaEquipe | null;
  rota: RotaDaAlteracao;
  /** O rótulo do botão principal. */
  botao: string;
  hoje: string;
  depois: string;
  diferenca: string;
  /** A versão aceita e os prazos dela; null sem política aceita. */
  politica: string | null;
  /** Como a devolução sai, uma linha por pagamento (vazio sem devolução). */
  comoSai: string[];
  /** A tabela do financeiro: o total e cada mês. */
  financeiro: LinhaDoFinanceiro[];
  meses: { mes: string; linhas: LinhaDoFinanceiro[] }[];
  noitesNovas: string;
  /** "Leitura do Mercado Pago de dd/mm às HH:MM: aprovado." (uma por pagamento). */
  leitura: string[];
  avisos: string[];
  /** "Copiar a proposta para o hóspede" (o modelo da proposta preenchido com a prévia); null quando não deu para montar. */
  proposta: MensagemPronta | null;
};

const FUSO = "America/Sao_Paulo";
const fmt = (d: Date, o: Intl.DateTimeFormatOptions, fuso = FUSO) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, ...o }).format(d);
const diaBr = (d: Date, fuso = FUSO) => fmt(d, { day: "2-digit", month: "2-digit" }, fuso);
const horaBr = (d: Date, fuso = FUSO) => fmt(d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, fuso);
/** Um prazo: "HH:MM" quando acaba no dia de `agora`, senão "dd/mm às HH:MM" (o prazo das datas vai até 48 horas). */
const prazoBr = (d: Date, agora: Date | undefined, fuso = FUSO) => (!agora || diaBr(d, fuso) === diaBr(agora, fuso) ? horaBr(d, fuso) : `${diaBr(d, fuso)} às ${horaBr(d, fuso)}`);
/** "dd/mm" de uma data AAAA-MM-DD. */
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const nNoites = (n: number) => `${n} ${n === 1 ? "noite" : "noites"}`;
const pessoas = (n: number | null) => (n === null ? "pessoas não informadas" : `${n} ${n === 1 ? "pessoa" : "pessoas"}`);
/** "dd/mm–dd/mm, N noites, P pessoas". */
const estadia = (e: { checkin: string; checkout: string; hospedes: number | null }) => `${dataBr(e.checkin)}–${dataBr(e.checkout)}, ${nNoites(noites(e.checkin, e.checkout))}, ${pessoas(e.hospedes)}`;
/** Diferença com o sinal (+R$ 400,00; -R$ 3,96; R$ 0,00). */
const comSinal = (n: number) => (n > 0 ? `+${formatBRL(n)}` : formatBRL(n));

const ORIGEM_DO_VALOR = { cotacao: "cotação do site", mantido: "valor atual mantido", digitado: "valor digitado" } as const;
const MOTIVOS_DO_VALOR = {
  alteracao_pela_scl: "A SCL propôs a alteração",
  cortesia_comercial: "Cortesia comercial",
  erro_da_scl: "Erro da SCL",
  acordo_com_hospede: "Acordo com o hóspede",
  preco_a_confirmar: "Preço a confirmar",
  outro: "Outro",
} as const;
const BASES = {
  prazo: "pedido dentro do prazo de reembolso integral",
  arrependimento: "direito de arrependimento",
  empresa: "a SCL propõe a alteração",
  excecao: "por exceção",
  sem_politica: "decisão da equipe, sem política aceita",
  fora_do_prazo: "pedido depois do prazo de reembolso integral",
  estadia_iniciada: "pedido depois do início da estadia",
  nao_comparecimento: "não comparecimento",
  // M8.2e: a base do "Cancelar a reserva contestada" (a lista é uma só com a do cancelamento); uma alteração nunca a tem.
  contestacao: "disputa do pagamento",
} as const;
/** As bases em que a política decidiu (as outras são decisão da equipe ou da SCL). */
const pelaPolitica = (base: keyof typeof BASES | null) => base === "prazo" || base === "arrependimento" || base === "fora_do_prazo" || base === "estadia_iniciada" || base === "nao_comparecimento";
/** Quem decidiu devolver (ou não) a diferença: "pela política" só quando foi ela. */
function quemDecidiu(base: keyof typeof BASES | null): string {
  if (base === "excecao") return "por exceção (decisão da equipe)";
  if (base === "empresa") return "porque a alteração é proposta pela SCL";
  if (base && pelaPolitica(base)) return `pela política (${BASES[base]})`;
  return base === "sem_politica" ? "por decisão da equipe (pagamento sem política aceita)" : "por decisão da equipe";
}
const COMPONENTES: [keyof Componentes, string][] = [
  ["bruto", "Valor bruto"],
  ["taxa", "Taxa do Mercado Pago"],
  ["comissao", "Comissão da SCL"],
  ["parte", "Parte do proprietário"],
];

/** A linha da leitura do Mercado Pago (o domínio põe as leituras por último nos avisos). */
const ehLeitura = (a: string) => a.startsWith("Leitura do Mercado Pago de ") || a.startsWith("Ainda sem leitura do Mercado Pago");

function linhasDoFinanceiro(antes: Componentes, depois: Componentes): LinhaDoFinanceiro[] {
  return COMPONENTES.map(([k, rotulo]) => ({ rotulo, antes: formatBRL(antes[k]), depois: formatBRL(depois[k]), diferenca: comSinal(depois[k] - antes[k]) }));
}

/** A rota do resultado: aumento, devolução (pedida agora, quando liberar, fora do prazo), retida ou o mesmo valor. */
export function rotaDaPrevia(p: Pick<PreviaAlteracao, "rumo" | "direito" | "partes">): RotaDaAlteracao {
  if (p.rumo === "aumento") return "aumento";
  if (p.rumo === "igual") return "igual";
  if (p.direito !== "integral") return "sem_devolucao";
  if (p.partes.some((x) => x.rota === "fora_do_prazo")) return "fora_do_prazo";
  if (p.partes.some((x) => x.aguardaLiberacao)) return "liberacao";
  return "pedida";
}

/** A prévia do domínio em linhas para a tela (§9.2). `agora` dá o prazo das datas da prévia nova. */
export function previaAlteracaoParaTela(p: PreviaAlteracao, agora: Date, proposta: MensagemPronta | null = null): PreviaAlteracaoParaTela {
  const origem = p.origemValor === "cotacao" ? ORIGEM_DO_VALOR.cotacao : `${ORIGEM_DO_VALOR[p.origemValor]}${p.motivoValor ? `: ${MOTIVOS_DO_VALOR[p.motivoValor]}` : ""}`;
  const retida = p.rumo === "reducao" && p.direito === "nenhum";
  const diferenca =
    p.rumo === "aumento"
      ? `Diferença: o hóspede paga ${formatBRL(p.diferenca)} na página da reserva.`
      : p.rumo === "igual"
        ? "Diferença: o valor não muda."
        : p.direito === "integral"
          ? `Diferença: devolução de ${formatBRL(p.valorADevolver)} ${quemDecidiu(p.base)}.`
          : `Diferença: sem devolução ${quemDecidiu(p.base)}: o valor da reserva continua ${formatBRL(p.antes.valor)}.`;
  const politica = p.politica
    ? p.rumo === "reducao" && p.decisao
      ? [
          `Política aceita: versão ${p.politica.versao}`,
          p.decisao.integralAte ? ` — reembolso integral para pedidos até ${dataBr(p.decisao.integralAte)} (23h59), contando da entrada de ${dataBr(p.entradaDaPolitica)}` : "",
          p.decisao.arrependimentoAte ? `; arrependimento até ${dataBr(p.decisao.arrependimentoAte)}` : "",
          ".",
        ].join("")
      : `Política aceita: versão ${p.politica.versao} (continua valendo para a reserva; prazos contados da entrada de ${dataBr(p.entradaDaPolitica)}).`
    : null;
  const comoSai = p.partes.map((x) => {
    const forma = x.forma === "cartao" ? "Cartão" : "Pix";
    const como =
      x.rota === "fora_do_prazo"
        ? "pelo painel do Mercado Pago ou por fora (mais de 78 dias)"
        : x.aguardaLiberacao
          ? `pelo Mercado Pago, quando ele liberar o pagamento${x.liberacaoPrevista ? ` (previsto para ${diaBr(x.liberacaoPrevista)})` : ""}`
          : "pelo Mercado Pago agora";
    return `${forma} de ${diaBr(x.pagoEm)}: ${formatBRL(x.valor)} — ${como}.`;
  });
  const novo = new Date(agora.getTime() + p.holdMinutos * 60_000);
  const ate = p.holdAte ?? (p.limiteDoPrazo && p.limiteDoPrazo.getTime() < novo.getTime() ? p.limiteDoPrazo : novo);
  const noitesNovas = p.noitesNovas
    ? p.holdAte
      ? `Novas noites seguradas: ${dataBr(p.noitesNovas.inicio)}–${dataBr(p.noitesNovas.fim)} até ${prazoBr(p.holdAte, agora)}.`
      : `Novas noites seguradas: ${dataBr(p.noitesNovas.inicio)}–${dataBr(p.noitesNovas.fim)} por ${p.holdMinutos} minutos.`
    : "Nenhuma noite nova: as novas datas cabem nas de agora.";
  const rota = rotaDaPrevia(p);
  const soSegurar =
    p.alteracaoId === null && p.rumo !== "aumento"
      ? `Segurar as novas datas (${dataBr(p.depois.checkin)} a ${dataBr(p.depois.checkout)}, ${pessoas(p.depois.hospedes)}) até ${prazoBr(ate, agora)}, sem aplicar? A reserva continua como está (${dataBr(p.antes.checkin)} a ${dataBr(p.antes.checkout)}); depois que o hóspede aceitar por escrito, use "Aplicar a alteração", ou desista.`
      : null;
  return {
    alteracaoId: p.alteracaoId,
    assinatura: p.assinatura,
    pergunta: p.pergunta,
    perguntaSoSegurar: soSegurar,
    rumo: p.rumo,
    direito: p.direito,
    calculado: p.decisao?.calculado ?? null,
    escolha: p.escolha,
    rota,
    botao: p.rumo === "aumento" ? "Segurar as novas datas e liberar o pagamento da diferença" : "Aplicar a alteração",
    hoje: `Hoje: ${estadia(p.antes)}, ${formatBRL(p.antes.valor)}.`,
    depois: `Depois: ${estadia(p.depois)}, ${formatBRL(p.depois.valor)} (${origem})${retida ? `; ${pelaPolitica(p.base) ? "pela política, " : ""}a reserva continua valendo ${formatBRL(p.antes.valor)}` : ""}.`,
    diferenca,
    politica,
    comoSai,
    financeiro: linhasDoFinanceiro(p.financeiro.antes, p.financeiro.depois),
    meses: p.financeiro.porMes.map((m) => ({ mes: `${m.mes.slice(5, 7)}/${m.mes.slice(0, 4)}`, linhas: linhasDoFinanceiro(m.antes, m.depois) })),
    noitesNovas,
    leitura: p.avisos.filter(ehLeitura),
    avisos: p.avisos.filter((a) => !ehLeitura(a)),
    proposta,
  };
}

/** O que a ficha mostra depois de cada ação da alteração (o endereço leva só a chave; o texto é este, montado na ficha). */
export const RESULTADOS_DA_ALTERACAO = ["segurada", "aplicada_pedida", "aplicada_liberacao", "aplicada_fora_do_prazo", "aplicada_sem_devolucao", "aplicada", "desistida", "ota", "avisado"] as const;
export type ResultadoDaAlteracao = (typeof RESULTADOS_DA_ALTERACAO)[number];

/** A chave do resultado de segurar ou aplicar: pela situação gravada e pela rota da prévia que a equipe viu. */
export function resultadoDaAlteracao(situacao: "segurada" | "aplicada", rota: string): ResultadoDaAlteracao {
  if (situacao === "segurada") return "segurada";
  if (rota === "pedida") return "aplicada_pedida";
  if (rota === "liberacao") return "aplicada_liberacao";
  if (rota === "fora_do_prazo") return "aplicada_fora_do_prazo";
  if (rota === "sem_devolucao") return "aplicada_sem_devolucao";
  return "aplicada";
}

/**
 * O texto de um resultado vindo do endereço (só as chaves conhecidas; o resto não mostra nada). `ctx` vem da ficha: o prazo
 * da alteração segurada e, da última aplicada, o valor devolvido (null sem `financeiro:ler`) e a liberação prevista.
 */
export function textoDoResultadoDaAlteracao(v: unknown, ctx: { holdAte: Date | null; valorADevolver: number | null; previstaEm: string | null; agora?: Date }): string | null {
  if (typeof v !== "string" || !(RESULTADOS_DA_ALTERACAO as readonly string[]).includes(v)) return null;
  const valor = ctx.valorADevolver !== null && ctx.valorADevolver > 0 ? ` de ${formatBRL(ctx.valorADevolver)}` : " da diferença";
  switch (v as ResultadoDaAlteracao) {
    case "segurada":
      return `Datas seguradas${ctx.holdAte ? ` até ${prazoBr(ctx.holdAte, ctx.agora)}` : ""}: copie a proposta para o hóspede.`;
    case "aplicada_pedida":
      return `Alteração aplicada. Devolução${valor} pedida ao Mercado Pago: a confirmação aparece no quadro do pagamento quando ele concluir.`;
    case "aplicada_liberacao":
      return `Alteração aplicada. Devolução${valor} pedida quando o Mercado Pago liberar o pagamento${ctx.previstaEm ? ` (previsto para ${dataBr(ctx.previstaEm)})` : ""}.`;
    case "aplicada_fora_do_prazo":
      return "Alteração aplicada. O pagamento tem mais de 78 dias: devolva a diferença pelo painel do Mercado Pago (cartão) e confirme aqui, ou por fora (Pix).";
    case "aplicada_sem_devolucao":
      return "Alteração aplicada: pela política, sem devolução da diferença.";
    case "aplicada":
      return "Alteração aplicada.";
    case "desistida":
      return "Alteração desfeita: as novas datas voltaram à venda e a reserva continua como estava.";
    case "ota":
      return "Bloqueio marcado como mudado nas OTAs.";
    case "avisado":
      return "Mensagem marcada como enviada ao hóspede.";
  }
}
