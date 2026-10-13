/**
 * Contestação do pagamento no site (M8.2e) — as regras puras, testáveis sem banco nem provedor: as listas fechadas, as
 * chaves do livro, o casamento das leituras com as linhas conhecidas, a ordem das leituras, as transições, a situação que
 * vale para o pagamento, o "em curso", a reserva em conferência por disputa, o valor em risco, a divisão da perda e o
 * acerto da perdida, as assinaturas e as frases fixas. "Contestação" aqui é sempre a do pagamento (a dos adiantamentos,
 * M4.4, é outra). Dinheiro em centavos inteiros; datas de caixa AAAA-MM-DD. Nada de dado pessoal: só ids do Mercado Pago,
 * códigos de listas fechadas, valores e datas. Os tipos de entrada são estruturais (o domínio mapeia o que o provedor leu).
 */
import { createHash } from "node:crypto";
import type { DesfechoPagamento, SituacaoPagamento } from "@/db/schema";
import { formatBRL } from "@/lib/money";
import { ESTADOS_LIDOS_CONTESTACAO, type EstadoLidoContestacao, SITUACOES_DOCUMENTACAO, type SituacaoDocumentacao, TEMPO_LIMITE_CONTESTACAO_MS, TEMPO_LIMITE_PADRAO_MS } from "./provedor";

// ---------------------------------------------------------------- listas fechadas

/**
 * Situação da contestação (local). `aberta`: em disputa (leitura `in_process`, aviso ou registro da equipe);
 * `a_confirmar`: o Mercado Pago mostra a disputa encerrada e o resultado espera a equipe; `ganha`, `perdida` e
 * `sem_efeito` são finais e só a equipe os dá (C1: o resultado nunca é aplicado só pela leitura).
 */
export const SITUACOES_CONTESTACAO = ["aberta", "a_confirmar", "ganha", "perdida", "sem_efeito"] as const;
export type SituacaoContestacao = (typeof SITUACOES_CONTESTACAO)[number];
export const SITUACOES_NAO_FINAIS_CONTESTACAO = ["aberta", "a_confirmar"] as const satisfies readonly SituacaoContestacao[];
export const contestacaoNaoFinal = (s: SituacaoContestacao) => s === "aberta" || s === "a_confirmar";

/**
 * A ordem das disputas de um pagamento: pela abertura e, no mesmo instante, pelo id (uma ordem só, sem empate). Uma regra,
 * um lugar: o valor em risco (`recalcularDisputas`), o devolvido que cada MED ou reclamação explica
 * (`devolvidoExplicadoPelaDisputa`), o acerto do retido lido, a primeira não final e o tipo da disputa em curso.
 */
export const ordemDeAbertura = (a: { abertaEm: Date; id: string }, b: { abertaEm: Date; id: string }): number =>
  a.abertaEm.getTime() - b.abertaEm.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * O "voltou a aprovada" (a order ou a Payments API aprovada de novo, sem disputa listada) fala de uma contestação no cartão
 * do quadro, de qualquer origem: a lida, a registrada pela equipe e a achada pela Chargebacks API (estas duas não mudam a
 * situação do pagamento, que continua `aprovado`). Na ainda não final, leva a disputa a `a_confirmar`; na perdida, contradiz
 * o resultado e liga `contestacao_resultado_mudou` (casamento, item 3). Uma regra, um lugar: a leitura da order e a da
 * Payments API leem daqui.
 */
export const voltouAAprovadaTemDisputa = (linhas: readonly { tipo: TipoContestacao; situacao: SituacaoContestacao }[]): boolean =>
  linhas.some((l) => l.tipo === "chargeback" && (contestacaoNaoFinal(l.situacao) || l.situacao === "perdida"));

/**
 * `chargeback`: contestação no cartão (o caso principal, detectado sozinho; também o `charged_back` lido num Pix);
 * `med`: MED do Pix e `reclamacao`: reclamação no Mercado Pago, que só entram pelo registro da equipe.
 */
export const TIPOS_CONTESTACAO = ["chargeback", "med", "reclamacao"] as const;
export type TipoContestacao = (typeof TIPOS_CONTESTACAO)[number];
export const ORIGENS_CONTESTACAO = ["leitura", "equipe"] as const;
export type OrigemContestacao = (typeof ORIGENS_CONTESTACAO)[number];

/**
 * Estado de uma contestação lido no Mercado Pago (o mesmo de `provedor.ts`). Pela página atual das Orders (11/10/2026):
 * `in_process` = em análise; `settled` = "a transação foi liquidada"; `reimbursed` = "o valor foi devolvido ao pagador
 * depois da contestação". Páginas antigas já disseram o contrário de `reimbursed` (item 61): o sentido está a conferir.
 * Fora da lista = `desconhecido`, que nunca sobrescreve o último conhecido (`estado_lido` guarda só os da lista).
 */
// Uma regra, um lugar: as duas listas vivem no contrato do adaptador (`provedor.ts`), que as lê; aqui só se reexportam.
export { ESTADOS_LIDOS_CONTESTACAO, type EstadoLidoContestacao };
export type EstadoConhecidoContestacao = (typeof ESTADOS_LIDOS_CONTESTACAO)[number];

/** `documentation_status` da Chargebacks API (a lista de `provedor.ts`); fora da lista = `desconhecida`. */
export { SITUACOES_DOCUMENTACAO, type SituacaoDocumentacao };
export type DocumentacaoDaContestacao = SituacaoDocumentacao | "desconhecida";

/** A causa da disputa na decisão de quem arca: códigos fixos; o nome e a frase de cada um são editáveis (Configurações). */
export const CODIGOS_CAUSA_CONTESTACAO = ["imovel", "scl", "cobranca", "fraude", "outro"] as const;
export type CodigoCausaContestacao = (typeof CODIGOS_CAUSA_CONTESTACAO)[number];
export const QUEM_ARCA_CONTESTACAO = ["proprietario", "scl", "proporcional"] as const;
export type QuemArcaContestacao = (typeof QUEM_ARCA_CONTESTACAO)[number];
export const NOMES_QUEM_ARCA: Record<QuemArcaContestacao, string> = {
  proprietario: "O proprietário",
  scl: "A SCL",
  proporcional: "Cada um na proporção da sua parte (sem como separar)",
};

/** De onde veio um evento da linha do tempo (`eventos_contestacao.fonte`): uma leitura, a equipe ou o próprio sistema. */
export const FONTES_EVENTO_CONTESTACAO = ["order", "chargebacks", "payments", "equipe", "sistema"] as const;
export type FonteEventoContestacao = (typeof FONTES_EVENTO_CONTESTACAO)[number];
export const TIPOS_EVENTO_CONTESTACAO = [
  "aberta",
  "estado_lido",
  "documentacao",
  "prazo",
  "valor",
  "cobertura",
  "decisao",
  "documentos_enviados",
  "debito_confirmado",
  "resultado",
  "sem_efeito",
  "aviso_conferido",
  "reaberta",
  "outra_disputa",
  "substituicao",
  "cancelamento",
  "caixa",
  "lancamentos",
  "email_equipe",
] as const;
export type TipoEventoContestacao = (typeof TIPOS_EVENTO_CONTESTACAO)[number];
/** `antes` e `depois` de um evento: jsonb pequeno, só códigos, datas (ISO) e centavos. */
export type DadosDoEvento = Record<string, string | number | boolean | null>;

/** De onde veio `valor`: a leitura, o registro da equipe ou o pago (o valor lido estava ilegível). */
export const ORIGENS_VALOR_CONTESTACAO = ["leitura", "equipe", "pagamento"] as const;
export type OrigemValorContestacao = (typeof ORIGENS_VALOR_CONTESTACAO)[number];
/** Para onde o pagamento volta se a SCL ganhar (`situacao_pagamento_antes`). */
export const SITUACOES_PAGAMENTO_ANTES = ["aprovado", "devolvido_parcial", "devolvido"] as const satisfies readonly SituacaoPagamento[];
export type SituacaoPagamentoAntes = (typeof SITUACOES_PAGAMENTO_ANTES)[number];

/**
 * Os avisos que são de uma contestação (cada linha tem os seus em `contestacoes_pagamento.avisos`; o pagamento leva a
 * união deles, como nas devoluções). Os textos estão em `situacoes.ts` (`AVISOS_PAGAMENTO`). "A divisão da reserva mudou
 * depois da decisão" é calculado na leitura da tela, nunca gravado.
 */
export const AVISOS_DE_CONTESTACAO = [
  "contestacao_pix",
  "contestacao_situacao_desconhecida",
  "contestacao_valor_desconhecido",
  "contestacao_valor_acima",
  "contestacao_valor_mudou",
  "contestacao_com_devolucao",
  "contestacao_liberacao_lida",
  "contestacao_ganha_sem_recebimento",
  "contestacao_resultado_mudou",
  "contestacao_leitura_conflitante",
  "contestacao_ambigua",
  "contestacao_busca_sem_acesso",
  "contestacao_possivel_duplicata",
  "contestacao_caso_de_outro_pagamento",
  "contestacao_sem_leitura",
  "contestacao_sem_fonte",
  "contestacao_fora_do_prazo",
  "contestacao_prazo_desconhecido",
] as const;
export type AvisoDeContestacao = (typeof AVISOS_DE_CONTESTACAO)[number];
export const avisoDeContestacao = (c: string): c is AvisoDeContestacao => (AVISOS_DE_CONTESTACAO as readonly string[]).includes(c);
/**
 * Os avisos de contestação que moram só no pagamento (nunca numa linha): a leitura que não se liga a nenhuma disputa com
 * segurança (`contestacao_ambigua`) e a busca tardia que o Mercado Pago recusou com 403 (`contestacao_busca_sem_acesso`).
 */
export const AVISOS_DE_CONTESTACAO_DO_PAGAMENTO: readonly AvisoDeContestacao[] = ["contestacao_ambigua", "contestacao_busca_sem_acesso"];

/** Origem dos lançamentos de resultado da disputa (proprietário e SCL). Sem tipo novo no `pgEnum` de lançamentos. */
export const ORIGEM_LANCAMENTO_CONTESTACAO = "contestacao_pagamento";
/** Desfecho do pagamento sem reserva perdido numa disputa ("o dinheiro voltou ao pagador pela disputa"). */
export const DESFECHO_CONTESTACAO = "contestacao" as const satisfies DesfechoPagamento;
/** `devolucoes_pagamento.confirmada_por` da devolução substituída confirmada pela disputa perdida. */
export const CONFIRMADA_PELA_CONTESTACAO = "contestacao";
/** Motivo do cancelamento "Cancelar a reserva contestada" (sem devolução pelo sistema). */
export const MOTIVO_CANCELAMENTO_CONTESTACAO = "contestacao";
/** A chave de Textos do site da frase do hóspede ("pagamento em conferência"). */
export const CHAVE_TEXTO_PAGAMENTO_EM_CONFERENCIA = "pagamentoEmConferencia";
/** Os códigos de recusa novos. */
export const CODIGOS_RECUSA_CONTESTACAO = ["contestacao_perdida", "contestacao_previa_mudou"] as const;
export type CodigoRecusaContestacao = (typeof CODIGOS_RECUSA_CONTESTACAO)[number];

// ---------------------------------------------------------------- constantes

const DIA_MS = 86_400_000;
/** Cada contestação `aberta` ou `a_confirmar` é relida uma vez por dia. */
export const RELER_CONTESTACAO_A_CADA_MS = DIA_MS;
/** No máximo 50 leituras de contestação por volta da rotina, em ordem de `proxima_leitura_em`. */
export const LEITURAS_DE_CONTESTACAO_POR_VOLTA = 50;
/** Orçamento de tempo de uma volta das contestações (cada chamada tem 8 s, `TEMPO_LIMITE_CONTESTACAO_MS`). */
export const ORCAMENTO_VOLTA_CONTESTACAO_MS = 60_000;
/**
 * O tempo que a leitura da order (`conferirTentativa`) pode levar na volta das disputas: a order e o financeiro, cada um com
 * o tempo-limite padrão do cliente (`TEMPO_LIMITE_PADRAO_MS`).
 */
export const TEMPO_LEITURA_DA_ORDER_MS = 2 * TEMPO_LIMITE_PADRAO_MS;
/**
 * Uma chamada da volta das disputas só começa se o tempo máximo dela cabe no que resta do orçamento (a releitura e a busca
 * tardia dividem o mesmo): a volta nunca passa dos 60 s. `gastoMs`: desde o início da volta; `precisaMs`: o tempo-limite da
 * chamada (8 s para a Chargebacks API e a Payments API, `TEMPO_LEITURA_DA_ORDER_MS` para a order).
 */
export const cabeNoOrcamento = (gastoMs: number, precisaMs: number = TEMPO_LIMITE_CONTESTACAO_MS): boolean => gastoMs + precisaMs <= ORCAMENTO_VOLTA_CONTESTACAO_MS;
/** Até quantos dias da abertura a disputa é lida (os 6 meses da decisão, com folga); depois, `contestacao_fora_do_prazo`. */
export const PRAZO_LEITURA_CONTESTACAO_DIAS = 240;
/**
 * Janela da busca tardia (pagamento com o número na Payments API e dinheiro, de qualquer desfecho): de 80 dias da
 * aprovação até 200 dias depois do maior entre a aprovação e a saída da reserva, com teto de 540 dias da aprovação (nas
 * bandeiras, o prazo de "serviço não prestado" conta do dia previsto do serviço). Uma vez por semana por pagamento.
 */
export const JANELA_CONTESTACAO_TARDIA = { desdeDias: 80, depoisDaSaidaDias: 200, tetoDias: 540, aCadaMs: 7 * DIA_MS } as const;
/** Parte presa há mais de 15 dias por uma disputa sem decisão: o Início sobe de tom. */
export const DIAS_ESCALADA_CONTESTACAO = 15;
/** Débito da disputa disponível e ainda não descontado há mais de 7 dias: aviso do Início. */
export const DIAS_AVISO_DEBITO_CONTESTACAO = 7;
/** Limite das notas e da explicação ao proprietário (sempre passadas por `textoSemDadosPessoais`). */
export const LIMITE_NOTA_CONTESTACAO = 300;
/**
 * C1 (11/10/2026): o formulário do resultado começa sem nada marcado. A sugestão pela leitura existe, desligada, até o
 * item 61 do sandbox (ou o primeiro caso real) conferir o sentido dos códigos.
 */
export const SUGERIR_RESULTADO_PELA_LEITURA = false;

/**
 * Depois dos 85 dias (a order não é mais lida), quantas falhas seguidas da Chargebacks API e da Payments API valem como
 * "sem resposta útil": o aviso `contestacao_sem_fonte` em vez de esperar os 240 dias calado.
 */
export const FALHAS_PARA_SEM_FONTE = 3;

/** Espera da próxima leitura de uma contestação: um dia; depois de falhas, 1, 2, 4 e até 7 dias (a fila anda na falha). */
export function esperaDaLeituraDaContestacao(falhas: number): number {
  if (!Number.isInteger(falhas) || falhas <= 0) return RELER_CONTESTACAO_A_CADA_MS;
  return Math.min(2 ** (falhas - 1), 7) * DIA_MS;
}

/** O pagamento está na janela da busca tardia agora? `saida` = o instante da saída da reserva (null = sem reserva). */
export function naJanelaTardia(aprovadoEm: Date, saida: Date | null, agora: Date): boolean {
  const j = JANELA_CONTESTACAO_TARDIA;
  const inicio = aprovadoEm.getTime() + j.desdeDias * DIA_MS;
  const base = Math.max(aprovadoEm.getTime(), saida?.getTime() ?? aprovadoEm.getTime());
  const fim = Math.min(base + j.depoisDaSaidaDias * DIA_MS, aprovadoEm.getTime() + j.tetoDias * DIA_MS);
  return agora.getTime() >= inicio && agora.getTime() <= fim;
}

// ---------------------------------------------------------------- leituras e linhas

/** De onde veio uma leitura: a order, a Chargebacks API, a Payments API pelo número, ou o registro da equipe. */
export type FonteDaLeitura = "order" | "chargebacks" | "payments" | "equipe";

/**
 * Uma contestação como uma fonte a mostrou, já normalizada (o domínio mapeia `ContestacaoLida`, `CasoDeContestacao` e
 * `SituacaoDoPagamento`). `estadoLido` null = a fonte não diz o estado (a Chargebacks API traz só a cobertura: um caso
 * ainda sem cobertura está em disputa). `lidaEm` = o início da chamada que leu.
 */
export type LeituraDeContestacao = {
  fonte: FonteDaLeitura;
  idCaso: string | null;
  idContestacao: string | null;
  /** O `transaction_id` (PAY…): só pista, nunca casa sozinho. */
  idTransacao?: string | null;
  estadoLido: EstadoLidoContestacao | null;
  /** O código cru curto (também quando desconhecido). */
  codigo?: string | null;
  /** `coverage_applied`: pela página atual, o resultado (true = a favor do vendedor); null = antes da decisão ou ilegível. */
  coberturaAplicada: boolean | null;
  coberturaElegivel?: boolean | null;
  /** Centavos em disputa; null = ausente ou ilegível. */
  valor: number | null;
  /** A transação voltou a processed/accredited: guardado como fato ("a transação voltou a aprovada"), nunca como resultado. */
  voltouAAprovada?: boolean;
  documentacao?: DocumentacaoDaContestacao | null;
  prazoDocumentacao?: Date | null;
  motivoId?: string | null;
  motivoCodigo?: string | null;
  aoVivo?: boolean | null;
  /** `date_created` do caso. */
  abertaNoProvedorEm?: Date | null;
  lidaEm: Date;
  /** `date_last_updated` do caso; null = a fonte não traz. */
  atualizadoNoProvedorEm: Date | null;
  /**
   * A leitura só fala das disputas deste tipo (a Payments API: a contestação no cartão). O casamento a liga só às linhas
   * desse tipo: o MED e a reclamação registrados ao lado não recebem a leitura nem a tornam ambígua.
   */
  soDoTipo?: TipoContestacao | null;
};

/** O que uma linha guarda das leituras (as colunas de leitura de `contestacoes_pagamento`). */
export type FatosDaContestacao = {
  estadoLido: EstadoConhecidoContestacao | null;
  codigo: string | null;
  coberturaAplicada: boolean | null;
  coberturaElegivel: boolean | null;
  motivoId: string | null;
  motivoCodigo: string | null;
  valor: number | null;
  valorOrigem: OrigemValorContestacao;
  documentacao: DocumentacaoDaContestacao | null;
  documentacaoPrazo: Date | null;
  abertaNoProvedorEm: Date | null;
  aoVivo: boolean | null;
  lidaEm: Date | null;
  atualizadoNoProvedorEm: Date | null;
};

/** Uma linha de `contestacoes_pagamento` como as regras a leem (os nomes são os do esquema). */
export type LinhaDeContestacao = FatosDaContestacao & {
  id: string;
  pagamentoId: string;
  tipo: TipoContestacao;
  situacao: SituacaoContestacao;
  idCaso: string | null;
  idContestacao: string | null;
  idTransacao: string | null;
  rodada: number;
  duplicataPossivel: boolean;
  abertaEm: Date;
  avisos: readonly string[];
  avisoConferidoEm: Date | null;
};

const ordemDaFonte: Record<FonteDaLeitura, number> = { chargebacks: 0, order: 1, payments: 2, equipe: 3 };
const temId = (l: { idCaso: string | null; idContestacao: string | null }) => l.idCaso !== null || l.idContestacao !== null;

/**
 * A leitura mostra a disputa em andamento: `in_process` (que tem precedência sobre qualquer outra fonte da volta), o
 * registro da equipe, ou um caso da Chargebacks API sem estado e ainda sem cobertura. `coberturaConhecida`: a linha já
 * tem a cobertura; aí um caso relido com cobertura null não diz nada (null também é "ilegível").
 */
export const leituraEmDisputa = (l: Pick<LeituraDeContestacao, "fonte" | "estadoLido" | "coberturaAplicada">, coberturaConhecida = false) =>
  l.fonte === "equipe" || l.estadoLido === "in_process" || (l.fonte === "chargebacks" && l.estadoLido === null && l.coberturaAplicada === null && !coberturaConhecida);

/** A leitura mostra a disputa encerrada (o resultado a conferir): `settled`, `reimbursed`, a cobertura preenchida ou a transação de volta a aprovada. */
export const leituraEncerrada = (l: Pick<LeituraDeContestacao, "fonte" | "estadoLido" | "coberturaAplicada" | "voltouAAprovada">) =>
  !leituraEmDisputa(l, true) && (l.estadoLido === "settled" || l.estadoLido === "reimbursed" || l.coberturaAplicada !== null || l.voltouAAprovada === true);

/**
 * Os sentidos que uma leitura encerrada sugere, pela página atual do Mercado Pago: a cobertura true e a transação de
 * volta a aprovada, a favor da SCL; a cobertura false e `reimbursed` ("devolvido ao pagador"), contra. `settled` não diz
 * o sentido. Só servem para achar fontes que divergem: o resultado é sempre da equipe (C1).
 */
function sentidos(l: Pick<LeituraDeContestacao, "estadoLido" | "coberturaAplicada" | "voltouAAprovada">): ("a_favor" | "contra")[] {
  const s: ("a_favor" | "contra")[] = [];
  if (l.coberturaAplicada === true || l.voltouAAprovada === true) s.push("a_favor");
  if (l.coberturaAplicada === false || l.estadoLido === "reimbursed") s.push("contra");
  return s;
}

/**
 * O estado combinado das fontes de uma volta: qualquer `in_process` = em disputa; senão, encerrada, ou em conflito quando
 * as fontes divergem no encerramento (`reimbursed` com cobertura true, `settled` numa fonte e `reimbursed` noutra); sem
 * estado quando nenhuma fonte diz (só desconhecido, ou nada).
 */
export function estadoDaVolta(
  leituras: readonly Pick<LeituraDeContestacao, "fonte" | "estadoLido" | "coberturaAplicada" | "voltouAAprovada">[],
  coberturaConhecida = false,
): "em_disputa" | "encerrada" | "conflito" | "sem_estado" {
  if (leituras.some((l) => leituraEmDisputa(l, coberturaConhecida))) return "em_disputa";
  const finais = leituras.filter(leituraEncerrada);
  if (!finais.length) return "sem_estado";
  const s = new Set(finais.flatMap(sentidos));
  const estados = new Set(finais.map((l) => l.estadoLido).filter((e) => e === "settled" || e === "reimbursed"));
  return (s.has("a_favor") && s.has("contra")) || estados.size > 1 ? "conflito" : "encerrada";
}

/**
 * Os fatos guardados de uma linha (o estado lido de uma fonte e a cobertura de outra, cada um o mais novo da sua fonte)
 * divergem no encerramento: `reimbursed` com a cobertura true, por exemplo. As fontes de uma volta podem chegar em
 * transações diferentes (a order na leitura dela, a Chargebacks API na rotina); a divergência é vista nos fatos juntados.
 */
export const fatosEmConflito = (f: Pick<FatosDaContestacao, "estadoLido" | "coberturaAplicada">): boolean => {
  const s = sentidos({ estadoLido: f.estadoLido, coberturaAplicada: f.coberturaAplicada });
  return s.includes("a_favor") && s.includes("contra");
};

/**
 * Ordem das leituras: sob a trava, uma leitura iniciada antes da última aplicada (`lida_em`), ou com `date_last_updated`
 * mais antigo que o guardado, é descartada. As fontes de uma mesma volta são aplicadas juntas (uma chamada só).
 */
export function leituraVelha(linha: Pick<FatosDaContestacao, "lidaEm" | "atualizadoNoProvedorEm">, l: Pick<LeituraDeContestacao, "lidaEm" | "atualizadoNoProvedorEm">): boolean {
  if (linha.lidaEm && l.lidaEm.getTime() < linha.lidaEm.getTime()) return true;
  return !!(linha.atualizadoNoProvedorEm && l.atualizadoNoProvedorEm && l.atualizadoNoProvedorEm.getTime() < linha.atualizadoNoProvedorEm.getTime());
}

/** O valor que todas as fontes dão (as que dão algum); null quando nenhuma dá ou quando divergem (aí fica o guardado). */
function unico<T>(valores: readonly (T | null | undefined)[], igual: (a: T, b: T) => boolean = (a, b) => a === b): { valor: T | null; divergem: boolean } {
  const dados = valores.filter((v): v is T => v !== null && v !== undefined);
  if (!dados.length) return { valor: null, divergem: false };
  return dados.every((v) => igual(v, dados[0])) ? { valor: dados[0], divergem: false } : { valor: null, divergem: true };
}
const mesmaData = (a: Date, b: Date) => a.getTime() === b.getTime();
const maisNova = (...ds: (Date | null | undefined)[]): Date | null => ds.reduce<Date | null>((m, d) => (d && (!m || d.getTime() > m.getTime()) ? d : m), null);

/** Os fatos de uma linha ainda sem leitura (registro da equipe, ou a linha nova antes de juntar as leituras). */
export const fatosSemLeitura = (): FatosDaContestacao => ({
  estadoLido: null,
  codigo: null,
  coberturaAplicada: null,
  coberturaElegivel: null,
  motivoId: null,
  motivoCodigo: null,
  valor: null,
  valorOrigem: "pagamento",
  documentacao: null,
  documentacaoPrazo: null,
  abertaNoProvedorEm: null,
  aoVivo: null,
  lidaEm: null,
  atualizadoNoProvedorEm: null,
});

/** Só os fatos de uma linha (sem os outros campos dela). */
export const fatosDe = (l: FatosDaContestacao): FatosDaContestacao => ({
  estadoLido: l.estadoLido,
  codigo: l.codigo,
  coberturaAplicada: l.coberturaAplicada,
  coberturaElegivel: l.coberturaElegivel,
  motivoId: l.motivoId,
  motivoCodigo: l.motivoCodigo,
  valor: l.valor,
  valorOrigem: l.valorOrigem,
  documentacao: l.documentacao,
  documentacaoPrazo: l.documentacaoPrazo,
  abertaNoProvedorEm: l.abertaNoProvedorEm,
  aoVivo: l.aoVivo,
  lidaEm: l.lidaEm,
  atualizadoNoProvedorEm: l.atualizadoNoProvedorEm,
});

type Juntado = { fatos: FatosDaContestacao; eventos: EventoDaTransicao[]; desconhecida: boolean; conhecida: boolean };

/**
 * Junta nos fatos guardados as fontes válidas de uma volta, campo a campo: o estado só das fontes que o trazem (o
 * `in_process` primeiro; o desconhecido nunca sobrescreve: vai só no código), a cobertura, a documentação, o prazo e o
 * motivo da Chargebacks API, o valor da Chargebacks API e depois da order. Null (ausente ou ilegível) nunca apaga o que
 * se conhecia; duas fontes que divergem no mesmo campo deixam o guardado. Um evento por fato que mudou.
 */
function juntarLeituras(antes: FatosDaContestacao, leituras: readonly LeituraDeContestacao[]): Juntado {
  // O registro da equipe nunca é fato do Mercado Pago.
  const ls = leituras.filter((l) => l.fonte !== "equipe").sort((a, b) => ordemDaFonte[a.fonte] - ordemDaFonte[b.fonte]);
  const f = fatosDe(antes);
  const eventos: EventoDaTransicao[] = [];
  const desconhecidas = ls.filter((l) => l.estadoLido === "desconhecido");
  const conhecidas = ls.filter((l) => l.estadoLido !== null && l.estadoLido !== "desconhecido");

  // Estado e código.
  if (conhecidas.some((l) => l.estadoLido === "in_process")) f.estadoLido = "in_process";
  else {
    const e = unico(conhecidas.map((l) => l.estadoLido as EstadoConhecidoContestacao));
    if (e.valor) f.estadoLido = e.valor;
  }
  if (desconhecidas.length) f.codigo = desconhecidas[0].codigo ?? f.codigo;
  else if (conhecidas.length) f.codigo = conhecidas.find((l) => l.estadoLido === f.estadoLido)?.codigo ?? f.estadoLido;

  // Da Chargebacks API (e de quem mais trouxer): cobertura, documentação, prazo, motivo, ao vivo, abertura no provedor.
  const cobertura = unico(ls.map((l) => l.coberturaAplicada));
  if (cobertura.valor !== null) f.coberturaAplicada = cobertura.valor;
  const elegivel = unico(ls.map((l) => l.coberturaElegivel));
  if (elegivel.valor !== null) f.coberturaElegivel = elegivel.valor;
  const documentacao = unico(ls.map((l) => l.documentacao));
  if (documentacao.valor !== null) f.documentacao = documentacao.valor;
  const prazo = unico(ls.map((l) => l.prazoDocumentacao), mesmaData);
  if (prazo.valor !== null) f.documentacaoPrazo = prazo.valor;
  const motivoId = unico(ls.map((l) => l.motivoId));
  if (motivoId.valor !== null) f.motivoId = motivoId.valor;
  const motivoCodigo = unico(ls.map((l) => l.motivoCodigo));
  if (motivoCodigo.valor !== null) f.motivoCodigo = motivoCodigo.valor;
  if (ls.some((l) => l.aoVivo === true)) f.aoVivo = true;
  else if (f.aoVivo === null && ls.some((l) => l.aoVivo === false)) f.aoVivo = false;
  f.abertaNoProvedorEm ??= ls.map((l) => l.abertaNoProvedorEm ?? null).find((d) => d !== null) ?? null;

  // Valor: a Chargebacks API primeiro (o caso é quem diz o valor em disputa), depois a order e a Payments API.
  const valor = ls.map((l) => l.valor).find((v) => v !== null && Number.isSafeInteger(v) && v >= 0) ?? null;
  if (valor !== null) {
    f.valor = valor;
    f.valorOrigem = "leitura";
  }

  f.lidaEm = maisNova(f.lidaEm, ...ls.map((l) => l.lidaEm));
  f.atualizadoNoProvedorEm = maisNova(f.atualizadoNoProvedorEm, ...ls.map((l) => l.atualizadoNoProvedorEm));

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  if (f.estadoLido !== antes.estadoLido) eventos.push({ tipo: "estado_lido", antes: { estadoLido: antes.estadoLido }, depois: { estadoLido: f.estadoLido } });
  if (f.coberturaAplicada !== antes.coberturaAplicada) eventos.push({ tipo: "cobertura", antes: { coberturaAplicada: antes.coberturaAplicada }, depois: { coberturaAplicada: f.coberturaAplicada } });
  if (f.valor !== antes.valor) eventos.push({ tipo: "valor", antes: { valor: antes.valor }, depois: { valor: f.valor } });
  if (f.documentacao !== antes.documentacao) eventos.push({ tipo: "documentacao", antes: { documentacao: antes.documentacao }, depois: { documentacao: f.documentacao } });
  if (iso(f.documentacaoPrazo) !== iso(antes.documentacaoPrazo)) eventos.push({ tipo: "prazo", antes: { prazo: iso(antes.documentacaoPrazo) }, depois: { prazo: iso(f.documentacaoPrazo) } });
  return { fatos: f, eventos, desconhecida: desconhecidas.length > 0, conhecida: conhecidas.length > 0 };
}

const camposQueMudam: (keyof FatosDaContestacao)[] = [
  "estadoLido",
  "codigo",
  "coberturaAplicada",
  "coberturaElegivel",
  "motivoId",
  "motivoCodigo",
  "valor",
  "valorOrigem",
  "documentacao",
  "documentacaoPrazo",
  "abertaNoProvedorEm",
  "aoVivo",
];
const valorDoCampo = (v: unknown) => (v instanceof Date ? v.getTime() : v);
const fatosMudaram = (a: FatosDaContestacao, b: FatosDaContestacao) => camposQueMudam.some((k) => valorDoCampo(a[k]) !== valorDoCampo(b[k]));

/** Liga ou desliga um aviso de contestação, mantendo a ordem (e os códigos de uma versão mais nova, que esta não conhece). */
function comAviso(avisos: readonly string[], codigo: AvisoDeContestacao, ligado: boolean): string[] {
  if (ligado) return avisos.includes(codigo) ? [...avisos] : [...avisos, codigo];
  return avisos.filter((a) => a !== codigo);
}

/**
 * Os avisos do valor: `contestacao_valor_desconhecido` sem valor legível (o valor em risco usa o pago e o diz) e
 * `contestacao_valor_acima` quando o contestado passa do valor da reserva (pode incluir os juros do parcelamento).
 */
export function avisosDoValor(avisos: readonly string[], valor: number | null, valorDaReserva: number | null): string[] {
  let a = comAviso(avisos, "contestacao_valor_desconhecido", valor === null);
  if (valorDaReserva !== null) a = comAviso(a, "contestacao_valor_acima", valor !== null && valor > valorDaReserva);
  return a;
}

// ---------------------------------------------------------------- casamento e idempotência

/** A identificação de uma disputa no Mercado Pago (os três ids; o da transação é só pista). */
export type IdentificacaoDaContestacao = { idCaso: string | null; idContestacao: string | null; idTransacao: string | null };
export type LinhaParaCasar = Pick<LinhaDeContestacao, "id" | "tipo" | "situacao" | "idCaso" | "idContestacao" | "idTransacao" | "rodada" | "abertaEm">;
export type CasamentoDeContestacoes = {
  /**
   * Linhas existentes que receberam leituras (na rodada mais nova), com os ids a completar (`completarIdentificacao`):
   * só os que a linha não tinha. Do registro da equipe, quer dizer "O Mercado Pago já mostra esta disputa".
   */
  existentes: { linhaId: string; leituras: LeituraDeContestacao[]; completar: Partial<IdentificacaoDaContestacao> }[];
  /** Linhas a criar (só com `in_process`, ou o registro da equipe), cada uma com as leituras que a mostram. */
  novas: { leituras: LeituraDeContestacao[]; identificacao: IdentificacaoDaContestacao; duplicataPossivel: boolean }[];
  /** Leituras sem identificação de uma disputa encerrada, explicadas pelas linhas finais: nada a gravar. */
  explicadas: LeituraDeContestacao[];
  /** Leituras que não se ligam a nada com segurança: o aviso `contestacao_ambigua` no pagamento, sem criar nada. */
  ambiguas: LeituraDeContestacao[];
};

type Alvo = {
  chave: number;
  linhaId: string | null;
  tipo: TipoContestacao;
  situacao: SituacaoContestacao;
  idCaso: string | null;
  idContestacao: string | null;
  idTransacao: string | null;
  rodada: number;
  abertaEm: number;
  leituras: LeituraDeContestacao[];
  completar: Partial<IdentificacaoDaContestacao>;
  duplicataPossivel: boolean;
};
const maisNovaRodada = (as: Alvo[]) => [...as].sort((a, b) => b.rodada - a.rodada || b.abertaEm - a.abertaEm || b.chave - a.chave)[0];
/**
 * A disputa final mais nova com resultado (a sem efeito não conta), quando é uma perdida: é dela que fala o "voltou a
 * aprovada" sem identificação num pagamento sem disputa não final (ele contradiz a perda). A ganha mais nova o explica.
 */
const perdidaMaisNova = (finais: Alvo[]): Alvo | undefined => {
  const comResultado = finais.filter((a) => a.situacao !== "sem_efeito");
  const a = comResultado.length ? maisNovaRodada(comResultado) : undefined;
  return a?.situacao === "perdida" ? a : undefined;
};
/** A leitura não contradiz a identificação da linha: em cada id, um dos lados é vazio ou os dois são iguais. */
const compativel = (a: Alvo, l: LeituraDeContestacao) =>
  (a.idCaso === null || l.idCaso === null || a.idCaso === l.idCaso) && (a.idContestacao === null || l.idContestacao === null || a.idContestacao === l.idContestacao);

/**
 * Casa as leituras de uma volta com as linhas conhecidas do pagamento (`casarContestacao`, a mesma regra sob a trava e no
 * registro da equipe):
 * 1. pelo `id_caso` e depois pelo `id_contestacao`, na rodada mais nova; o `id_transacao` nunca casa sozinho; ids que se
 *    contradizem (o caso de uma linha e o CBK de outra) = ambígua;
 * 2. leitura sem identificação, ou com um id nunca visto, num pagamento com exatamente uma linha não final (que não tenha
 *    outro id do mesmo tipo): é essa linha, completada, nunca duplicada;
 * 3. leitura encerrada, ou que só casa com linhas finais, nunca cria linha: sem id e encerrada, é explicada por qualquer
 *    linha final; `in_process` sem id com só linhas finais vai para a final mais nova (que liga
 *    `contestacao_resultado_mudou`), e o "voltou a aprovada" sem id, para a perdida mais nova (`perdidaMaisNova`, o mesmo
 *    aviso); num pagamento sem linha, ou com um id desconhecido, é ambígua;
 * 4. linha nova só com `in_process` e nenhuma linha não final;
 * 5. qualquer outro caso (duas não finais e uma leitura sem id, por exemplo) é ambíguo;
 * 6. segunda disputa com outra ainda não final (pela equipe, ou um caso com id novo e outro aberto): nasce como possível
 *    duplicata (valor em risco 0, sem retido). O registro da equipe sem id com uma linha não final sem id já existente é
 *    essa linha (o índice `contestacoes_pagamento_sem_id` não deixaria duas).
 * Duas fontes da mesma volta que mostram a mesma disputa nova dão uma linha só (as com id primeiro).
 */
export function casarContestacao(lidas: readonly LeituraDeContestacao[], linhas: readonly LinhaParaCasar[]): CasamentoDeContestacoes {
  const alvos: Alvo[] = linhas.map((x, i) => ({
    chave: i,
    linhaId: x.id,
    tipo: x.tipo,
    situacao: x.situacao,
    idCaso: x.idCaso,
    idContestacao: x.idContestacao,
    idTransacao: x.idTransacao,
    rodada: x.rodada,
    abertaEm: x.abertaEm.getTime(),
    leituras: [],
    completar: {},
    duplicataPossivel: false,
  }));
  const explicadas: LeituraDeContestacao[] = [];
  const ambiguas: LeituraDeContestacao[] = [];
  const ordem = lidas.map((l, i) => ({ l, i })).sort((a, b) => Number(temId(b.l)) - Number(temId(a.l)) || a.i - b.i);

  const naLinha = (a: Alvo, l: LeituraDeContestacao) => {
    a.leituras.push(l);
    for (const k of ["idCaso", "idContestacao", "idTransacao"] as const) {
      const v = l[k] ?? null;
      if (v !== null && a[k] === null) {
        a[k] = v;
        if (a.linhaId !== null) a.completar[k] = v;
      }
    }
  };
  const nova = (l: LeituraDeContestacao, duplicataPossivel: boolean) =>
    alvos.push({
      chave: alvos.length,
      linhaId: null,
      // A linha nova pela leitura é uma contestação no cartão; o registro da equipe dá o tipo ao gravar.
      tipo: l.soDoTipo ?? "chargeback",
      situacao: "aberta",
      idCaso: l.idCaso,
      idContestacao: l.idContestacao,
      idTransacao: l.idTransacao ?? null,
      rodada: 1,
      abertaEm: l.lidaEm.getTime(),
      leituras: [l],
      completar: {},
      duplicataPossivel,
    });

  for (const { l } of ordem) {
    // A leitura de um tipo só (a Payments API) só enxerga as linhas desse tipo.
    const doTipo = l.soDoTipo ? alvos.filter((a) => a.tipo === l.soDoTipo) : alvos;
    // 1. Pelos ids, na rodada mais nova.
    const peloCaso = l.idCaso !== null ? maisNovaRodada(doTipo.filter((a) => a.idCaso === l.idCaso)) : undefined;
    const peloCbk = !peloCaso && l.idContestacao !== null ? maisNovaRodada(doTipo.filter((a) => a.idContestacao === l.idContestacao)) : undefined;
    const porId = peloCaso ?? peloCbk;
    if (porId) {
      if (!compativel(porId, l)) ambiguas.push(l);
      else naLinha(porId, l);
      continue;
    }
    const naoFinais = doTipo.filter((a) => contestacaoNaoFinal(a.situacao));
    const finais = doTipo.filter((a) => !contestacaoNaoFinal(a.situacao));
    // 6. O registro da equipe: outra disputa (possível duplicata se há outra não final), ou a mesma linha sem id.
    if (l.fonte === "equipe") {
      const semIdNaoFinal = !temId(l) ? naoFinais.find((a) => !temId(a)) : undefined;
      if (semIdNaoFinal) naLinha(semIdNaoFinal, l);
      else nova(l, naoFinais.length > 0);
      continue;
    }
    const emDisputa = leituraEmDisputa(l);
    if (!temId(l)) {
      // 2. Sem identificação.
      if (naoFinais.length === 1) naLinha(naoFinais[0], l);
      else if (naoFinais.length > 1) ambiguas.push(l);
      else if (emDisputa) {
        // Uma disputa encerrada sem efeito (registrada por engano, duplicata) não absorve a disputa nova: só a ganha ou a
        // perdida recebem a leitura em andamento (`contestacao_resultado_mudou`).
        const comResultado = finais.filter((a) => a.situacao !== "sem_efeito");
        if (comResultado.length) naLinha(maisNovaRodada(comResultado), l);
        else nova(l, false);
      } else if (l.voltouAAprovada === true && perdidaMaisNova(finais)) naLinha(perdidaMaisNova(finais)!, l);
      else if (leituraEncerrada(l) && finais.length) explicadas.push(l);
      else ambiguas.push(l);
      continue;
    }
    // Com um id nunca visto.
    const compativeis = naoFinais.filter((a) => compativel(a, l));
    if (naoFinais.length === 1 && compativeis.length === 1) naLinha(compativeis[0], l);
    else if (emDisputa && naoFinais.length === 0) nova(l, false);
    else if (emDisputa && compativeis.length === 0) nova(l, true);
    else ambiguas.push(l);
  }

  return {
    existentes: alvos.filter((a) => a.linhaId !== null && a.leituras.length).map((a) => ({ linhaId: a.linhaId!, leituras: a.leituras, completar: a.completar })),
    novas: alvos
      .filter((a) => a.linhaId === null)
      .map((a) => ({ leituras: a.leituras, identificacao: { idCaso: a.idCaso, idContestacao: a.idContestacao, idTransacao: a.idTransacao }, duplicataPossivel: a.duplicataPossivel })),
    explicadas,
    ambiguas,
  };
}

/**
 * O caso da Chargebacks API é deste pagamento? Só vale um caso cujo `payments[]` contém o número do pagamento
 * (`pagamentos.id_pagamento_provedor`). `sem_numero`: o pagamento não tem o número; o caso fica só como referência e os
 * valores dele não são usados. `outro`: nada do caso é usado (`contestacao_caso_de_outro_pagamento`).
 */
export function casoDestePagamento(caso: { pagamentos: readonly string[] }, idPagamentoProvedor: string | null): "sim" | "outro" | "sem_numero" {
  if (!idPagamentoProvedor) return "sem_numero";
  return caso.pagamentos.includes(idPagamentoProvedor) ? "sim" : "outro";
}

// ---------------------------------------------------------------- situações e transições

/**
 * As mudanças de situação possíveis. Pela leitura: `aberta` → `a_confirmar` e, com uma leitura mais nova que mostra
 * `in_process` do mesmo caso, `a_confirmar` → `aberta`. Pela equipe: `aberta`/`a_confirmar` → `ganha`/`perdida`/
 * `sem_efeito`. As finais nunca mudam (a disputa ganha reaberta é uma linha nova, a rodada seguinte).
 */
export function situacaoPodeMudar(de: SituacaoContestacao, para: SituacaoContestacao, por: "leitura" | "equipe"): boolean {
  if (de === para || !contestacaoNaoFinal(de)) return false;
  if (por === "leitura") return (de === "aberta" && para === "a_confirmar") || (de === "a_confirmar" && para === "aberta");
  return para === "ganha" || para === "perdida" || para === "sem_efeito";
}

export type EventoDaTransicao = { tipo: TipoEventoContestacao; antes: DadosDoEvento; depois: DadosDoEvento };

/**
 * O que acontece com uma linha (`transicaoDaContestacao`):
 * - `leitura`: as fontes de uma volta que casaram com a linha (aplicadas juntas). `valorDaReserva` liga o aviso do valor
 *   acima da reserva;
 * - `resultado` e `sem_efeito`: a equipe confirma (`emDisputaNaLeitura`: a fase 0 leu `in_process` do mesmo caso; aí só com
 *   a nota reforçada, "o painel do Mercado Pago já mostra o resultado");
 * - `outra_disputa`: "Confirmar que é outra disputa" numa possível duplicata;
 * - `conferir_aviso`: numa linha final com `contestacao_resultado_mudou`: a disputa continua encerrada, ou (só numa ganha
 *   relida `in_process`) foi reaberta: nasce a rodada seguinte (`novaRodada`), que segue o fluxo inteiro.
 * `em`: o horário da ação da equipe; vira o `lida_em` da linha, para que uma leitura iniciada antes nunca a desfaça.
 */
export type FatoDaContestacao =
  | { tipo: "leitura"; leituras: readonly LeituraDeContestacao[]; valorDaReserva?: number | null }
  | { tipo: "resultado"; resultado: "ganha" | "perdida"; em: Date; emDisputaNaLeitura: boolean; notaReforcada: boolean }
  | { tipo: "sem_efeito"; em: Date; emDisputaNaLeitura: boolean; notaReforcada: boolean }
  | { tipo: "outra_disputa"; em: Date }
  | { tipo: "conferir_aviso"; como: "continua_encerrada" | "reaberta"; em: Date };

export type TransicaoDaContestacao =
  | { ok: true; descartada: true }
  | {
      ok: true;
      descartada: false;
      situacao: SituacaoContestacao;
      fatos: FatosDaContestacao;
      /** A lista inteira de avisos da linha depois da mudança (os de uma versão mais nova ficam). */
      avisos: string[];
      duplicataPossivel: boolean;
      avisoConferidoEm: Date | null;
      eventos: EventoDaTransicao[];
      /** Algo além de `consultada_em`/`lida_em` mudou (fatos, situação, avisos ou marcas): grava e registra os eventos. */
      mudou: boolean;
      /** "A disputa foi reaberta": criar a rodada seguinte (mesma identificação, origem `equipe`, `aberta`, sem decisão). */
      novaRodada: boolean;
    }
  | { ok: false; codigo: "nao_permitida" | "nota_reforcada" | "duplicata" | "sem_aviso" | "nao_reabre"; erro: string };

/** Os avisos de leitura que a confirmação da equipe resolve (a disputa terminou aqui). */
const AVISOS_RESOLVIDOS_PELA_EQUIPE: readonly AvisoDeContestacao[] = [
  "contestacao_situacao_desconhecida",
  "contestacao_valor_desconhecido",
  "contestacao_valor_mudou",
  "contestacao_resultado_mudou",
  "contestacao_leitura_conflitante",
  "contestacao_sem_leitura",
  "contestacao_sem_fonte",
  "contestacao_fora_do_prazo",
  "contestacao_prazo_desconhecido",
];

/**
 * A recusa `nota_reforcada` (a leitura de agora mostra a disputa em andamento) diz a caixa a marcar, com o rótulo do
 * formulário: "Confirmar o resultado" (`TEXTO_NOTA_REFORCADA`) e "Encerrar sem efeito" (`TEXTO_NOTA_REFORCADA_SEM_EFEITO`).
 */
export const TEXTO_NOTA_REFORCADA =
  'O Mercado Pago ainda mostra esta disputa em andamento: se o painel dele já mostra o resultado, marque a caixa "O painel do Mercado Pago já mostra o resultado" e diga na nota o que ele mostra.';
export const TEXTO_NOTA_REFORCADA_SEM_EFEITO =
  'O Mercado Pago ainda mostra esta disputa em andamento: se o painel dele já mostra a disputa encerrada, marque a caixa "O painel do Mercado Pago já mostra a disputa encerrada" e diga na nota o que ele mostra.';
export const TEXTO_DUPLICATA_SEM_CONFIRMAR = "Esta disputa pode ser a mesma de outra do quadro: confirme que é outra disputa (ou encerre sem efeito) antes do resultado.";
export const TEXTO_SEM_AVISO_A_CONFERIR = "Não há aviso a conferir nesta disputa.";
export const TEXTO_SO_GANHA_REABRE = "Só uma disputa ganha que o Mercado Pago voltou a mostrar em andamento pode ser reaberta.";
export const TEXTO_NAO_E_DUPLICATA = "Esta disputa não está marcada como possível duplicata.";
export const TEXTO_DISPUTA_JA_TERMINOU = "A disputa já terminou: corrija com um ajuste, que fica registrado.";

/** A transição de uma linha (ver `FatoDaContestacao`). Pura: quem chama grava, sob `travarCotacao`, o que ela devolve. */
export function transicaoDaContestacao(linha: LinhaDeContestacao, fato: FatoDaContestacao): TransicaoDaContestacao {
  if (fato.tipo === "leitura") return pelaLeitura(linha, fato.leituras, fato.valorDaReserva ?? null);
  const base = { ok: true as const, descartada: false as const, fatos: fatosDe(linha), novaRodada: false, duplicataPossivel: linha.duplicataPossivel, avisoConferidoEm: linha.avisoConferidoEm };
  const evento = (tipo: TipoEventoContestacao, depois: DadosDoEvento, antes: DadosDoEvento = { situacao: linha.situacao }): EventoDaTransicao => ({ tipo, antes, depois });

  if (fato.tipo === "resultado" || fato.tipo === "sem_efeito") {
    const para = fato.tipo === "resultado" ? fato.resultado : "sem_efeito";
    if (!situacaoPodeMudar(linha.situacao, para, "equipe")) return { ok: false, codigo: "nao_permitida", erro: TEXTO_DISPUTA_JA_TERMINOU };
    if (fato.tipo === "resultado" && linha.duplicataPossivel) return { ok: false, codigo: "duplicata", erro: TEXTO_DUPLICATA_SEM_CONFIRMAR };
    if (fato.emDisputaNaLeitura && !fato.notaReforcada) return { ok: false, codigo: "nota_reforcada", erro: fato.tipo === "resultado" ? TEXTO_NOTA_REFORCADA : TEXTO_NOTA_REFORCADA_SEM_EFEITO };
    let avisos = linha.avisos.filter((a) => !(AVISOS_RESOLVIDOS_PELA_EQUIPE as readonly string[]).includes(a));
    if (para === "sem_efeito") avisos = comAviso(avisos, "contestacao_possivel_duplicata", false);
    return {
      ...base,
      situacao: para,
      fatos: { ...base.fatos, lidaEm: maisNova(linha.lidaEm, fato.em) },
      avisos,
      eventos: [evento(fato.tipo === "resultado" ? "resultado" : "sem_efeito", { situacao: para, emDisputaNaLeitura: fato.emDisputaNaLeitura })],
      mudou: true,
    };
  }
  if (fato.tipo === "outra_disputa") {
    if (!contestacaoNaoFinal(linha.situacao)) return { ok: false, codigo: "nao_permitida", erro: TEXTO_DISPUTA_JA_TERMINOU };
    if (!linha.duplicataPossivel) return { ok: false, codigo: "nao_permitida", erro: TEXTO_NAO_E_DUPLICATA };
    return {
      ...base,
      situacao: linha.situacao,
      avisos: comAviso(linha.avisos, "contestacao_possivel_duplicata", false),
      duplicataPossivel: false,
      eventos: [evento("outra_disputa", { duplicataPossivel: false }, { duplicataPossivel: true })],
      mudou: true,
    };
  }
  // Conferir o aviso.
  if (contestacaoNaoFinal(linha.situacao) || !linha.avisos.includes("contestacao_resultado_mudou")) return { ok: false, codigo: "sem_aviso", erro: TEXTO_SEM_AVISO_A_CONFERIR };
  if (fato.como === "reaberta" && !(linha.situacao === "ganha" && linha.estadoLido === "in_process")) return { ok: false, codigo: "nao_reabre", erro: TEXTO_SO_GANHA_REABRE };
  return {
    ...base,
    situacao: linha.situacao,
    avisos: comAviso(linha.avisos, "contestacao_resultado_mudou", false),
    avisoConferidoEm: fato.em,
    eventos: [evento(fato.como === "reaberta" ? "reaberta" : "aviso_conferido", { como: fato.como }, {})],
    mudou: true,
    novaRodada: fato.como === "reaberta",
  };
}

function pelaLeitura(linha: LinhaDeContestacao, leituras: readonly LeituraDeContestacao[], valorDaReserva: number | null): TransicaoDaContestacao {
  const validas = leituras.filter((l) => l.fonte !== "equipe" && !leituraVelha(linha, l));
  if (!validas.length) return { ok: true, descartada: true };
  const j = juntarLeituras(linha, validas);
  const estado = estadoDaVolta(validas, linha.coberturaAplicada !== null);
  let situacao = linha.situacao;
  let avisos: string[] = [...linha.avisos];
  const eventos = [...j.eventos];

  // Desconhecido: o código estranho fica no código e liga o aviso; um estado conhecido de novo o desliga.
  if (j.desconhecida) avisos = comAviso(avisos, "contestacao_situacao_desconhecida", true);
  else if (j.conhecida) avisos = comAviso(avisos, "contestacao_situacao_desconhecida", false);

  if (contestacaoNaoFinal(linha.situacao)) {
    // Fontes que divergem no encerramento, na mesma volta ou entre o que já estava guardado e a fonte nova: o aviso, uma
    // vez, sem transição.
    const conflito = estado === "conflito" || (estado !== "em_disputa" && fatosEmConflito(j.fatos));
    if (conflito) avisos = comAviso(avisos, "contestacao_leitura_conflitante", true);
    else if (estado === "encerrada" && linha.situacao === "aberta") situacao = "a_confirmar";
    else if (estado === "em_disputa" && linha.situacao === "a_confirmar" && validas.some((l) => l.estadoLido === "in_process")) {
      // Só uma leitura que mostra `in_process` do mesmo caso reabre: o caso da Chargebacks API ainda sem cobertura conta como
      // "em disputa" para criar ou manter a linha aberta, nunca para desfazer o encerramento que outra fonte mostrou.
      situacao = "aberta";
      avisos = comAviso(avisos, "contestacao_resultado_mudou", true);
    }
    avisos = avisosDoValor(avisos, j.fatos.valor, valorDaReserva);
    avisos = comAviso(avisos, "contestacao_prazo_desconhecido", j.fatos.documentacaoPrazo === null);
  } else {
    // Linha final: a leitura nunca muda a situação. Uma que contradiz o resultado liga o aviso uma vez: de novo só com
    // um fato novo, ou se ninguém conferiu o aviso ainda (a primeira contradição depois da confirmação).
    const inProcess = validas.some((l) => l.estadoLido === "in_process");
    const contradiz =
      (linha.situacao === "ganha" && (inProcess || j.fatos.coberturaAplicada === false)) ||
      (linha.situacao === "perdida" && (j.fatos.coberturaAplicada === true || validas.some((l) => l.voltouAAprovada === true))) ||
      validas.some((l) => l.estadoLido === "in_process" && !temId(l));
    if (contradiz && !avisos.includes("contestacao_resultado_mudou") && (fatosMudaram(linha, j.fatos) || linha.avisoConferidoEm === null))
      avisos = comAviso(avisos, "contestacao_resultado_mudou", true);
    avisos = comAviso(avisos, "contestacao_prazo_desconhecido", false);
  }

  if (situacao !== linha.situacao) {
    const e = eventos.find((x) => x.tipo === "estado_lido");
    if (e) {
      e.antes.situacao = linha.situacao;
      e.depois.situacao = situacao;
    } else eventos.unshift({ tipo: "estado_lido", antes: { situacao: linha.situacao, estadoLido: linha.estadoLido }, depois: { situacao, estadoLido: j.fatos.estadoLido } });
  }
  const mudou = situacao !== linha.situacao || fatosMudaram(linha, j.fatos) || avisos.join() !== linha.avisos.join();
  return {
    ok: true,
    descartada: false,
    situacao,
    fatos: j.fatos,
    avisos,
    duplicataPossivel: linha.duplicataPossivel,
    avisoConferidoEm: linha.avisoConferidoEm,
    eventos,
    mudou,
    novaRodada: false,
  };
}

/** A situação do pagamento para onde ele volta se a SCL ganhar: a da primeira linha não final, ou a que ele tinha. */
export function situacaoAntesDaContestacao(p: { situacao: SituacaoPagamento; devolvidoLido: number; pago: number }, deOutraNaoFinal: SituacaoPagamentoAntes | null): SituacaoPagamentoAntes {
  if (deOutraNaoFinal) return deOutraNaoFinal;
  if ((SITUACOES_PAGAMENTO_ANTES as readonly string[]).includes(p.situacao)) return p.situacao as SituacaoPagamentoAntes;
  // Contestado sem linha (lido antes do M8.2e): o que a última leitura mostrou das devoluções.
  if (p.devolvidoLido > 0 && p.devolvidoLido >= p.pago) return "devolvido";
  return p.devolvidoLido > 0 ? "devolvido_parcial" : "aprovado";
}

/**
 * Os valores de uma linha nova (pela leitura ou pela equipe), sem os vínculos e os carimbos do domínio: os fatos das
 * leituras que a mostram, a situação de antes, o retrato da verificação do banco, os avisos (Pix contestado, possível
 * duplicata, valor ilegível ou acima, prazo desconhecido, devolução já realizada, situação desconhecida) e o valor em
 * risco (0 na possível duplicata). `equipe`: o valor, o prazo e a nota do registro.
 */
export function novaContestacao(e: {
  origem: OrigemContestacao;
  tipo: TipoContestacao;
  forma: "pix" | "cartao";
  leituras: readonly LeituraDeContestacao[];
  identificacao: IdentificacaoDaContestacao;
  duplicataPossivel: boolean;
  pagamento: { situacao: SituacaoPagamento; devolvidoLido: number; pago: number; valor: number; tresDSStatus: string | null };
  deOutraNaoFinal: SituacaoPagamentoAntes | null;
  /** Σ valores em risco das outras disputas não finais e não duplicadas do pagamento. */
  outras: number;
  /** Há devolução realizada (confirmada, por fora ou o reconhecido devolvido fora) neste pagamento. */
  comDevolucaoRealizada: boolean;
  equipe?: { valor: number | null; prazo: Date | null };
  agora: Date;
}) {
  const j = juntarLeituras(fatosSemLeitura(), e.leituras);
  const fatos = j.fatos;
  if (e.equipe) {
    if (fatos.valor === null && e.equipe.valor !== null) {
      fatos.valor = e.equipe.valor;
      fatos.valorOrigem = "equipe";
    }
    fatos.documentacaoPrazo ??= e.equipe.prazo;
  }
  let avisos: string[] = [];
  avisos = comAviso(avisos, "contestacao_pix", e.forma === "pix" && e.tipo === "chargeback");
  avisos = comAviso(avisos, "contestacao_possivel_duplicata", e.duplicataPossivel);
  avisos = avisosDoValor(avisos, fatos.valor, e.pagamento.valor);
  avisos = comAviso(avisos, "contestacao_prazo_desconhecido", fatos.documentacaoPrazo === null);
  avisos = comAviso(avisos, "contestacao_com_devolucao", e.comDevolucaoRealizada || e.pagamento.situacao === "devolvido");
  avisos = comAviso(avisos, "contestacao_situacao_desconhecida", j.desconhecida);
  // Linha nova só com `in_process` (ou o registro da equipe): nasce aberta.
  const situacao: SituacaoContestacao = "aberta";
  return {
    tipo: e.tipo,
    origem: e.origem,
    ...e.identificacao,
    rodada: 1,
    duplicataPossivel: e.duplicataPossivel,
    situacao,
    situacaoPagamentoAntes: situacaoAntesDaContestacao(e.pagamento, e.deOutraNaoFinal),
    ...fatos,
    valorEmRisco: valorEmRisco({ valor: fatos.valor, pago: e.pagamento.pago, outras: e.outras, substituido: 0, duplicataPossivel: e.duplicataPossivel, situacao }),
    abertaEm: e.agora,
    tresDSStatus: e.pagamento.tresDSStatus,
    avisos,
  };
}

/**
 * A sugestão do resultado pela leitura (C1): desligada (`SUGERIR_RESULTADO_PELA_LEITURA`), o formulário começa sem nada
 * marcado. Ligada, pela página atual: a cobertura true = ganha, false = perdida; sem cobertura, nenhuma.
 */
export function resultadoSugeridoPelaLeitura(l: Pick<FatosDaContestacao, "coberturaAplicada">, ligada = SUGERIR_RESULTADO_PELA_LEITURA): "ganha" | "perdida" | null {
  if (!ligada || l.coberturaAplicada === null) return null;
  return l.coberturaAplicada ? "ganha" : "perdida";
}

// ---------------------------------------------------------------- a situação que vale para o pagamento

/** Uma contestação como a order a mostra (`Cobranca.contestacoes`; sem fonte = a order). */
export type ContestacaoNaLeitura = Pick<LeituraDeContestacao, "idCaso" | "idContestacao" | "estadoLido"> &
  Partial<Pick<LeituraDeContestacao, "fonte" | "coberturaAplicada" | "voltouAAprovada" | "idTransacao">>;

/**
 * A situação que vale para o pagamento numa leitura (`contestacaoDaLeitura`; uma função só, para `aplicarLeitura` e para
 * todos os testes que hoje olham a situação crua). `contestado`: a leitura `contestado` continua valendo (há disputa não
 * final, ou uma disputa que o sistema não conhece e vai abrir uma linha ou pedir à equipe que a registre); false = a
 * leitura não mostra disputa, ou cada disputa lida é de uma linha final conhecida, sem `in_process` em aberto: vale a
 * situação local. `explicada`: cada contestação lida casa com uma linha conhecida, sem `in_process` contra uma final.
 */
export function contestacaoDaLeitura(
  c: { situacao: string | null; contestacoes: readonly ContestacaoNaLeitura[] },
  linhas: readonly LinhaParaCasar[],
): { explicada: boolean; contestado: boolean } {
  const lidaEm = new Date(0);
  const itens: LeituraDeContestacao[] = (c.contestacoes.length ? c.contestacoes : c.situacao === "contestado" ? [{ idCaso: null, idContestacao: null, estadoLido: "desconhecido" as const }] : []).map((x) => ({
    fonte: x.fonte ?? "order",
    idCaso: x.idCaso,
    idContestacao: x.idContestacao,
    idTransacao: x.idTransacao ?? null,
    estadoLido: x.estadoLido,
    coberturaAplicada: x.coberturaAplicada ?? null,
    voltouAAprovada: x.voltouAAprovada,
    valor: null,
    lidaEm,
    atualizadoNoProvedorEm: null,
  }));
  const r = casarContestacao(itens, linhas);
  const finais = new Set(linhas.filter((x) => !contestacaoNaoFinal(x.situacao)).map((x) => x.id));
  const contraFinal = r.existentes.some((x) => finais.has(x.linhaId) && x.leituras.some((l) => leituraEmDisputa(l)));
  const explicada = !r.novas.length && !r.ambiguas.length && !contraFinal;
  if (c.situacao !== "contestado") return { explicada, contestado: false };
  const naoFinal = linhas.some((x) => contestacaoNaoFinal(x.situacao));
  return { explicada, contestado: naoFinal || r.novas.length > 0 || r.ambiguas.length > 0 };
}

// ---------------------------------------------------------------- em curso e em conferência

export type LinhaEmCurso = Pick<LinhaDeContestacao, "pagamentoId" | "situacao" | "avisos" | "estadoLido">;
/** A linha segura o "em curso" do pagamento: `aberta`/`a_confirmar`, ou `ganha` que o Mercado Pago voltou a mostrar em andamento. */
const linhaEmCurso = (x: LinhaEmCurso): boolean => contestacaoNaoFinal(x.situacao) || (x.situacao === "ganha" && x.estadoLido === "in_process" && x.avisos.includes("contestacao_resultado_mudou"));

/**
 * A disputa de um pagamento sobre o retrato travado: `em_curso` (alguma linha `aberta` ou `a_confirmar`, de qualquer
 * origem, ou uma `ganha` com `contestacao_resultado_mudou` vindo de `in_process` e ainda não conferido), `perdida`, ou
 * null. Uma regra, um lugar: o cancelamento, a alteração, a devolução, o recebimento à mão e o "pedir de novo" leem daqui,
 * além da situação.
 */
export function disputaDoPagamento(t: { contestacoes: readonly LinhaEmCurso[] }, pagamentoId: string): "em_curso" | "perdida" | null {
  const ls = t.contestacoes.filter((x) => x.pagamentoId === pagamentoId);
  if (ls.some(linhaEmCurso)) return "em_curso";
  return ls.some((x) => x.situacao === "perdida") ? "perdida" : null;
}

/**
 * O tipo da disputa em curso mais antiga do pagamento (o aviso `contestado` do quadro diz o tipo: `textoDoAvisoContestado`);
 * null sem disputa em curso.
 */
export function tipoDaDisputaEmCurso(linhas: readonly (LinhaEmCurso & Pick<LinhaDeContestacao, "id" | "tipo" | "abertaEm">)[], pagamentoId: string): TipoContestacao | null {
  const emCurso = linhas.filter((x) => x.pagamentoId === pagamentoId && linhaEmCurso(x)).sort(ordemDeAbertura);
  return emCurso[0]?.tipo ?? null;
}

/** Há contestação em curso no pagamento (`disputaDoPagamento` em curso ou perdida): recusa o cancelamento, a alteração e as devoluções. */
export const contestacaoEmCurso = (t: { contestacoes: readonly LinhaEmCurso[] }, pagamentoId: string): boolean => disputaDoPagamento(t, pagamentoId) !== null;

/** O pagamento está contestado pela situação dele, ou pelo aviso `contestado` (o retrato do "em curso" gravado sob a trava). */
export const pagamentoContestado = (p: { situacao: string; avisos: readonly string[] }): boolean => p.situacao === "contestado" || p.avisos.includes("contestado");

/**
 * A disputa de um pagamento para o que o hóspede vê (Minha reserva, a página da reserva, também a da reserva cancelada):
 * a das linhas (`disputaDoPagamento`) e, com o pagamento contestado, a situação dele. Contestado é `em_curso` quando o quadro
 * não o explica: sem linha nenhuma deste pagamento (contestado antes do M8.2e), só com disputas encerradas sem perda (a
 * disputa nova depois de uma ganha ou de uma sem efeito), ou com a leitura que não casou com segurança
 * (`contestacao_ambigua`, que não cria linha), mesmo ao lado de uma perdida: o hóspede vê "em conferência", nunca o
 * resultado antigo. Uma regra, um lugar: as três telas e o pedido de cancelamento pelo hóspede leem daqui.
 */
export function disputaDoPagamentoOuSituacao(t: { contestacoes: readonly LinhaEmCurso[] }, p: { id: string; situacao: string; avisos: readonly string[] }): "em_curso" | "perdida" | null {
  const pelasLinhas = t.contestacoes.some((x) => x.pagamentoId === p.id) ? disputaDoPagamento(t, p.id) : null;
  if (pelasLinhas === "em_curso" || !pagamentoContestado(p)) return pelasLinhas;
  return pelasLinhas === null || p.avisos.includes("contestacao_ambigua") ? "em_curso" : pelasLinhas;
}

export type LinhaParaConferencia = Pick<LinhaDeContestacao, "situacao" | "duplicataPossivel"> & {
  valorEmRisco: number;
  decisaoVersao: number;
  /** Da perdida: o valor perdido menos o confirmado pela devolução substituída (`perdaADividir`); null fora dela. */
  perdaADividir: number | null;
  /** O desfecho do pagamento da linha: só o dinheiro da reserva (`reserva` ou `alteracao`) segura a reserva. */
  desfecho: DesfechoPagamento | null;
};

/**
 * A linha segura a reserva em conferência por disputa (o gêmeo TS de `contestacaoSemDecisaoSql`): não duplicada, de um
 * pagamento com o dinheiro da reserva, e `aberta`/`a_confirmar` com valor em risco > 0 sem decisão de quem arca, ou
 * `perdida` com perda a dividir > 0 sem a decisão.
 */
export function linhaSemDecisao(l: LinhaParaConferencia): boolean {
  if (l.duplicataPossivel || l.decisaoVersao > 0 || (l.desfecho !== "reserva" && l.desfecho !== "alteracao")) return false;
  if (contestacaoNaoFinal(l.situacao)) return l.valorEmRisco > 0;
  return l.situacao === "perdida" && (l.perdaADividir ?? 0) > 0;
}
/** A reserva está em conferência por disputa (alguma linha dos pagamentos dela sem decisão). */
export const contestacaoSemDecisao = (linhas: readonly LinhaParaConferencia[]): boolean => linhas.some(linhaSemDecisao);

// ---------------------------------------------------------------- dinheiro

const centavos = (v: number, nome: string) => {
  if (!Number.isSafeInteger(v)) throw new Error(`Valor inválido: ${nome}.`);
  return v;
};

/**
 * Valor em risco de uma disputa (gravado em `valor_em_risco` a cada mudança; é o que a decisão usa):
 * `máx(0, mín(contestado, pago − outras) − substituído)`. `valor` null (ilegível) = o pago (com o aviso). `outras` = Σ
 * valores em risco das outras disputas não finais e não duplicadas do pagamento (a soma nunca passa do pago);
 * `substituido` = Σ devoluções do pagamento substituídas por esta disputa. Devolução já realizada não desconta (o Mercado
 * Pago retém o que está em disputa). Possível duplicata e sem efeito: 0.
 */
export function valorEmRisco(e: { valor: number | null; pago: number; outras: number; substituido: number; duplicataPossivel: boolean; situacao: SituacaoContestacao }): number {
  const pago = centavos(e.pago, "pago");
  const outras = centavos(e.outras, "outras");
  const substituido = centavos(e.substituido, "substituído");
  if (e.duplicataPossivel || e.situacao === "sem_efeito") return 0;
  const contestado = e.valor === null ? pago : centavos(e.valor, "contestado");
  return Math.max(0, Math.min(contestado, pago - outras) - substituido);
}

/**
 * A proporção (`dividirPerda`): proprietário = `valor × D / (D + C)` com meio centavo para cima; SCL = o resto (a soma é
 * sempre exata). D e C são as partes efetivas da reserva (direito do proprietário e comissão, motor e espelhos),
 * congeladas na decisão. null = não há partes para dividir (D + C = 0, ou uma parte negativa): a equipe escolhe a SCL ou o
 * proprietário. Com a base líquida a taxa já saiu de D + C (cada um arca com ela na sua proporção); com a bruta, fica com
 * a SCL (`regras.base`, uma regra só).
 */
export function dividirPerda(valor: number, D: number, C: number): { proprietario: number; scl: number } | null {
  centavos(valor, "valor");
  centavos(D, "parte do proprietário");
  centavos(C, "comissão");
  if (valor < 0) throw new Error("Valor inválido: valor.");
  if (D < 0 || C < 0 || D + C === 0) return null;
  // Em BigInt: valor × D pode passar do inteiro seguro do JavaScript.
  const dois = BigInt(2);
  const total = BigInt(D) + BigInt(C);
  const proprietario = Number((dois * BigInt(valor) * BigInt(D) + total) / (dois * total));
  return { proprietario, scl: valor - proprietario };
}

/** A divisão pela decisão: o valor inteiro com o proprietário ou com a SCL, ou a proporção (null = não há partes). */
export function divisaoDaDecisao(quemArca: QuemArcaContestacao, valor: number, D: number, C: number): { proprietario: number; scl: number } | null {
  centavos(valor, "valor");
  if (quemArca === "proprietario") return { proprietario: valor, scl: 0 };
  if (quemArca === "scl") return { proprietario: 0, scl: valor };
  return dividirPerda(valor, D, C);
}

/**
 * Quanto do valor perdido confirma cada devolução substituída pela disputa (pelo menor entre o valor dela e o que ainda
 * sobra do perdido, na ordem dada): a devolução é "confirmada pela disputa", sem saída de caixa própria.
 */
export function confirmadoPelasSubstituidas(substituidas: readonly number[], valorPerdido: number): number[] {
  let resta = Math.max(0, centavos(valorPerdido, "valor perdido"));
  return substituidas.map((v) => {
    const c = Math.min(Math.max(0, centavos(v, "devolução")), resta);
    resta -= c;
    return c;
  });
}

/** A perda a dividir de uma disputa perdida: o valor perdido menos o que confirmou as devoluções substituídas. */
export const perdaADividir = (valorPerdido: number, substituidas: readonly number[]): number =>
  centavos(valorPerdido, "valor perdido") - confirmadoPelasSubstituidas(substituidas, valorPerdido).reduce((s, v) => s + v, 0);

/**
 * O caixa final da perdida: `valor perdido − líquido que não entrou − retido realizado`. Positivo = saída na data do
 * débito; negativo = entrada; 0 = nada a lançar. Ex.: disputa do valor inteiro antes da liberação, perdidos 100.000, não
 * entraram 96.020 e nada retido → saída de 3.980 (a taxa).
 */
export function caixaFinalDaPerda(e: { valorPerdido: number; liquidoNaoEntrou: number; retidoRealizado: number }): number {
  return centavos(e.valorPerdido, "valor perdido") - centavos(e.liquidoNaoEntrou, "líquido que não entrou") - centavos(e.retidoRealizado, "retido realizado");
}

/**
 * O "Quanto deste pagamento nunca entrou na conta" proposto: 0 com recebimento em vigor; sem ele e sem sinal de liberação
 * (o Mercado Pago não liberou), o líquido, nunca mais que o valor perdido (numa disputa de parte do valor, o resto ainda
 * pode entrar pela liberação). Com o sinal de liberação e sem o recebimento, null: a liberação se registra antes (nada de
 * valor suposto). Sem o líquido conhecido, null.
 */
export const liquidoNaoEntrouProposto = (e: { comRecebimento: boolean; liquido: number | null; valorPerdido?: number | null; liberacaoLida?: boolean }): number | null => {
  if (e.comRecebimento) return 0;
  if (e.liberacaoLida || e.liquido === null) return null;
  return e.valorPerdido === null || e.valorPerdido === undefined ? e.liquido : Math.min(e.liquido, Math.max(0, e.valorPerdido));
};

/**
 * O acerto da perdida (`acertoDaPerda`): a perda a dividir (valor perdido − o confirmado pelas substituídas), a divisão
 * final pela decisão (xF, yF, sobre as bases congeladas) e os lançamentos, comparados sempre com o já lançado (Σx, Σy),
 * nunca com o valor em risco recalculado. `ajusteProprietario` é o valor com sinal da linha `…:proprietario:final`
 * (Σx − xF: positivo devolve ao proprietário); `espelhoScl` = +Σy (`…:scl:espelho`) e `perdaDefinitivaScl` = −yF
 * (`…:scl:final`); 0 = nada a lançar. Ex.: exposição 100.000 (85.000 + 15.000), perdidos 80.000 → xF 68.000, ajuste
 * +17.000, yF 12.000. null = proporcional sem partes para dividir.
 */
export function acertoDaPerda(e: {
  valorPerdido: number;
  substituidas: readonly number[];
  quemArca: QuemArcaContestacao;
  baseParteProprietario: number;
  baseComissao: number;
  lancadoProprietario: number;
  lancadoScl: number;
}): { perdaADividir: number; proprietario: number; scl: number; ajusteProprietario: number; espelhoScl: number; perdaDefinitivaScl: number } | null {
  const perda = perdaADividir(e.valorPerdido, e.substituidas);
  const d = divisaoDaDecisao(e.quemArca, perda, e.baseParteProprietario, e.baseComissao);
  if (!d) return null;
  const x = centavos(e.lancadoProprietario, "lançado do proprietário");
  const y = centavos(e.lancadoScl, "lançado da SCL");
  return { perdaADividir: perda, proprietario: d.proprietario, scl: d.scl, ajusteProprietario: x - d.proprietario, espelhoScl: y, perdaDefinitivaScl: -d.scl };
}

/** O valor segurado ficou para trás: com decisão, o valor em risco de agora difere da exposição em vigor (`contestacao_valor_mudou`). */
export const valorSeguradoDesatualizado = (l: { decisaoVersao: number; exposicao: number | null; valorEmRisco: number; situacao: SituacaoContestacao }) =>
  l.decisaoVersao > 0 && contestacaoNaoFinal(l.situacao) && l.exposicao !== null && l.exposicao !== l.valorEmRisco;

// ---------------------------------------------------------------- chaves do livro

/**
 * As chaves dos lançamentos de uma disputa: todas começam com `mercadopago:<pagamento>:contestacao:<contestação>:` (e
 * nunca contêm `recebimento`), e por isso herdam os bloqueios do dinheiro do site (estornar recebimento, recebimento
 * manual, estornar e marcar despesa). Idempotência pela chave e por `decisao_versao`.
 */
export const prefixoDaContestacao = (pagamentoId: string, contestacaoId: string) => `mercadopago:${pagamentoId}:contestacao:${contestacaoId}:`;

export function chavesDaContestacao(pagamentoId: string, contestacaoId: string) {
  const p = prefixoDaContestacao(pagamentoId, contestacaoId);
  const versao = (n: number) => {
    if (!Number.isInteger(n) || n < 1) throw new Error("Versão inválida.");
    return n;
  };
  return {
    /** O retido (linha `devolucao`, valor 0, `montante` = valor em risco); `#N` quando o valor muda ou a prevista vira realizada com outro valor. */
    retido: (n = 1) => `${p}retido${versao(n) > 1 ? `#${n}` : ""}`,
    /** O débito do proprietário da versão n da decisão (a diferença nas seguintes). */
    proprietario: (n: number) => `${p}proprietario:v${versao(n)}`,
    /** A perda prevista da SCL da versão n (a diferença nas seguintes). */
    scl: (n: number) => `${p}scl:v${versao(n)}`,
    proprietarioReverte: () => `${p}proprietario:reverte`,
    sclReverte: () => `${p}scl:reverte`,
    /** Ganha: o retido realizado que voltou (`recebimento`). */
    volta: () => `${p}volta`,
    proprietarioFinal: () => `${p}proprietario:final`,
    sclEspelho: () => `${p}scl:espelho`,
    sclFinal: () => `${p}scl:final`,
    caixaFinal: () => `${p}caixa_final`,
    tarifa: () => `${p}tarifa`,
    /** Pagamento sem reserva perdido: a taxa que a SCL perde. */
    taxa: () => `${p}taxa`,
    /** "Encerrar sem efeito": o espelho de um lançamento previsto (repetir depois de uma falha não duplica). */
    semEfeito: (lancamentoId: string) => `${p}sem_efeito:${lancamentoId}`,
  };
}

const CHAVE_CONTESTACAO =
  /^mercadopago:[^:]+:contestacao:[^:]+:(retido(#[2-9]|#[1-9]\d+)?|proprietario:v[1-9]\d*|scl:v[1-9]\d*|proprietario:reverte|scl:reverte|volta|proprietario:final|scl:espelho|scl:final|caixa_final|tarifa|taxa|sem_efeito:[^:]+)$/;
/** A chave é de um lançamento de disputa do pagamento? */
export const ehChaveDeContestacao = (chave: string) => CHAVE_CONTESTACAO.test(chave);

// ---------------------------------------------------------------- assinaturas

const assinar = (dados: unknown[]) => createHash("sha1").update(JSON.stringify(dados)).digest("hex").slice(0, 16);

/**
 * A assinatura da decisão (como no M8.2c): as entradas de `dividirPerda` (o valor que se divide — valor em risco ou perda
 * a dividir —, D, C e quem arca). A versão (`decisao_versao`) é conferida à parte ("A decisão mudou…").
 */
export const assinaturaDaDecisao = (e: { valor: number; baseParteProprietario: number; baseComissao: number; quemArca: QuemArcaContestacao }) =>
  assinar(["decisao", e.valor, e.baseParteProprietario, e.baseComissao, e.quemArca]);

/**
 * A assinatura do resultado: a situação, o estado combinado, o valor em disputa, o valor em risco, Σx, Σy, o retido e a
 * versão. Nunca `consultada_em`, eventos, avisos ou lançamentos de outras origens da reserva (a própria fase 0 e a rodada
 * do motor não invalidam a confirmação).
 */
export const assinaturaDoResultado = (e: {
  situacao: SituacaoContestacao;
  estadoLido: EstadoConhecidoContestacao | null;
  coberturaAplicada: boolean | null;
  valor: number | null;
  valorEmRisco: number;
  lancadoProprietario: number;
  lancadoScl: number;
  retido: { estado: string; montante: number } | null;
  decisaoVersao: number;
}) =>
  assinar([
    "resultado",
    e.situacao,
    e.estadoLido,
    e.coberturaAplicada,
    e.valor,
    e.valorEmRisco,
    e.lancadoProprietario,
    e.lancadoScl,
    e.retido ? [e.retido.estado, e.retido.montante] : null,
    e.decisaoVersao,
  ]);

// ---------------------------------------------------------------- causas e textos da decisão

export type TextoDaCausa = { nome: string; frase: string };
/** Nome e frase de cada causa (editáveis em Configurações → Pagamento no site). Na fraude, a frase depende da verificação do banco. */
export type TextosDasCausas = { [C in Exclude<CodigoCausaContestacao, "fraude">]: TextoDaCausa } & { fraude: TextoDaCausa & { fraseComVerificacao: string; frasePix: string } };

/** O texto-base das causas (11/10/2026). */
export const TEXTOS_BASE_CAUSAS_CONTESTACAO: TextosDasCausas = {
  imovel: { nome: "Problema do imóvel (estrutura, equipamento ou obra do proprietário)", frase: "pela regra de 7/10, o proprietário" },
  scl: { nome: "Falha da SCL (atendimento, limpeza, entrada, manutenção combinada)", frase: "pela regra de 7/10, a SCL" },
  cobranca: { nome: "Falha na cobrança (valor errado, cobrança em dobro, devolução que não saiu)", frase: "pela regra de 7/10, a SCL" },
  fraude: {
    nome: "Pagamento não reconhecido (cartão de terceiro, golpe ou fraude)",
    frase: "pela regra da verificação do banco (Configurações → Pagamento no site), a SCL",
    fraseComVerificacao: "o hóspede passou pela verificação do banco: a responsabilidade costuma passar à bandeira; espere o resultado antes de decidir",
    frasePix: "decida e registre o motivo",
  },
  outro: { nome: "Outro", frase: "decida e registre o motivo" },
};

type DoPagamento = { forma: "pix" | "cartao"; tresDSStatus: string | null };

/**
 * A frase da regra ao lado de cada causa (o sistema nunca escolhe). Na fraude, pela verificação do banco congelada na
 * abertura: `AUTHENTICATED` → espere o resultado; Pix → decida e registre o motivo; nos outros casos (inclusive
 * `ATTEMPTED`), a SCL.
 */
export function fraseDaCausa(causa: CodigoCausaContestacao, p: DoPagamento, textos: TextosDasCausas = TEXTOS_BASE_CAUSAS_CONTESTACAO): string {
  if (causa !== "fraude") return textos[causa].frase;
  if (p.forma === "pix") return textos.fraude.frasePix;
  return p.tresDSStatus === "AUTHENTICATED" ? textos.fraude.fraseComVerificacao : textos.fraude.frase;
}

/** Quem a frase da regra indica (null = nenhuma: decida, ou espere o resultado). Uma escolha diferente é aceita e repetida na pergunta. */
export function quemArcaPelaRegra(causa: CodigoCausaContestacao, p: DoPagamento): "proprietario" | "scl" | null {
  if (causa === "imovel") return "proprietario";
  if (causa === "scl" || causa === "cobranca") return "scl";
  if (causa === "fraude" && p.forma === "cartao" && p.tresDSStatus !== "AUTHENTICATED") return "scl";
  return null;
}

export const TEXTO_CONFIRMACAO_REFORCADA_FRAUDE = "A regra da verificação do banco, mostrada quando o cartão foi ligado, diz que fica com a SCL. Confirma que o proprietário arca?";
/** "O proprietário" numa causa `fraude` pede a confirmação reforçada. */
export const confirmacaoReforcadaDaDecisao = (causa: CodigoCausaContestacao, quemArca: QuemArcaContestacao) => causa === "fraude" && quemArca === "proprietario";

/**
 * A pergunta do `BotaoConfirmar` da decisão (`perguntaDaDecisao`): causa, quem arca, os dois valores, o que fica segurado
 * e, sem resultado ainda, o que acontece se a SCL ganhar; uma escolha diferente da frase da regra é repetida.
 */
export function perguntaDaDecisao(e: {
  nomeCausa: string;
  quemArca: QuemArcaContestacao;
  proprietario: number;
  scl: number;
  comResultado: boolean;
  /** Quem a frase da regra indica (`quemArcaPelaRegra`). */
  pelaRegra: "proprietario" | "scl" | null;
  reforcada: boolean;
}): string {
  const partes = [`Causa: ${e.nomeCausa}. Quem arca: ${NOMES_QUEM_ARCA[e.quemArca].toLowerCase()}.`, `Proprietário ${formatBRL(e.proprietario)}; SCL ${formatBRL(e.scl)}.`];
  if (e.pelaRegra && e.pelaRegra !== e.quemArca && e.quemArca !== "proporcional")
    partes.push(`A regra indica ${e.pelaRegra === "proprietario" ? "o proprietário" : "a SCL"}: a decisão é diferente.`);
  else if (e.pelaRegra && e.quemArca === "proporcional") partes.push(`A regra indica ${e.pelaRegra === "proprietario" ? "o proprietário" : "a SCL"}: a decisão é dividir.`);
  if (e.reforcada) partes.push(TEXTO_CONFIRMACAO_REFORCADA_FRAUDE);
  if (e.proprietario > 0) partes.push(e.comResultado ? "O valor do proprietário é descontado dos próximos repasses." : "O valor do proprietário fica segurado nos próximos repasses até o resultado; volta no repasse seguinte se a SCL ganhar a disputa.");
  return partes.join(" ");
}

// ---------------------------------------------------------------- nomes e frases fixas

/** Nome nos textos, por tipo (nas contagens e no que vale para os três: "disputa do pagamento"). */
export const NOMES_TIPO_CONTESTACAO: Record<TipoContestacao, string> = {
  chargeback: "Contestação no cartão",
  med: "Devolução pedida pelo Pix (MED)",
  reclamacao: "Reclamação no Mercado Pago",
};
export const NOME_DISPUTA = "disputa do pagamento";
/** O rótulo das linhas da disputa para o proprietário (extrato, PDF, e-mail, relatório). */
export const ROTULO_DISPUTA_PROPRIETARIO = "Disputa do pagamento";
export const NOMES_SITUACAO_CONTESTACAO: Record<SituacaoContestacao, string> = {
  aberta: "aberta",
  a_confirmar: "encerrada no Mercado Pago, resultado a conferir",
  ganha: "ganha",
  perdida: "perdida",
  sem_efeito: "encerrada sem efeito",
};

const FUSO = "America/Sao_Paulo";
/** dd/mm em São Paulo (um instante) ou de uma data AAAA-MM-DD. */
const diaMes = (d: Date | string) =>
  typeof d === "string" ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" }).format(d);

// Registro pela equipe e leitura.
export const TEXTO_DISPUTA_JA_NO_QUADRO = "O Mercado Pago já mostra esta disputa: ela está no quadro.";
export const TEXTO_CASO_DE_OUTRO_PAGAMENTO = "Este caso é de outro pagamento no Mercado Pago.";
export const TEXTO_REGISTRADA_A_MAO = "registrada à mão: o sistema confere pela leitura quando puder";
/**
 * A disputa que a leitura abriu (`charged_back/in_process` na order): pode ser uma reclamação no Mercado Pago (a página de
 * migração mapeia `in_mediation` para isso), e o sistema não tem como separar.
 */
export const TEXTO_LIDA_PODE_SER_RECLAMACAO =
  "lida no Mercado Pago como contestação: pode ser uma reclamação no Mercado Pago (mediação); o sistema não tem como separar, confira no painel dele";
/** O texto da origem de uma disputa no quadro: registrada à mão pela equipe, ou lida (com o aviso de que pode ser uma reclamação). */
export const textoDaOrigemDaContestacao = (l: { origem: OrigemContestacao }): string => (l.origem === "equipe" ? TEXTO_REGISTRADA_A_MAO : TEXTO_LIDA_PODE_SER_RECLAMACAO);
/** Nota acrescentada quando a fase 0 não leu (provedor fechado ou falha). */
export const NOTA_SEM_LEITURA = "sem leitura do Mercado Pago";
export const NOTA_SEM_CONFERIR_AGORA = "não deu para conferir no Mercado Pago agora";
export const TEXTO_RESULTADO_SEM_LEITURA = "o Mercado Pago não informa o resultado: confirme pelo painel dele";
export const TEXTO_PAINEL_JA_MOSTRA_RESULTADO = "o painel do Mercado Pago já mostra o resultado";

// Recusas.
export const TEXTO_DECISAO_MUDOU = "A decisão mudou desde que você abriu a tela: confira de novo.";
/** `contestacao_previa_mudou`: a assinatura das entradas mudou entre a prévia e o clique. */
export const TEXTO_CONTESTACAO_PREVIA_MUDOU = "Os valores da disputa mudaram desde que você abriu a tela (valor em disputa, partes da reserva ou leitura do Mercado Pago): confira de novo.";
/** `contestacao_perdida`, no cancelamento; na alteração e nas devoluções, `textoContestacaoPerdida`. */
export const TEXTO_CONTESTACAO_PERDIDA = "O pagamento desta reserva foi perdido numa disputa: o valor já voltou ao hóspede por ela. Não se cancela pela política; corrija com um ajuste.";
export const textoContestacaoPerdida = (para: "cancelamento" | "alteracao" | "devolucao") =>
  para === "cancelamento"
    ? TEXTO_CONTESTACAO_PERDIDA
    : para === "alteracao"
      ? "O pagamento desta reserva foi perdido numa disputa: o valor já voltou ao hóspede por ela. A alteração não é feita pelo sistema; corrija com um ajuste."
      : "Este pagamento foi perdido numa disputa: o valor já voltou ao hóspede por ela. Não se devolve de novo; corrija com um ajuste.";
/** O `TEXTO_CONTESTADO` do cancelamento com disputa em curso. */
export const TEXTO_DISPUTA_EM_CURSO_CANCELAMENTO =
  "Disputa do pagamento em curso: o cancelamento pela política espera o resultado (o dinheiro pode voltar ao hóspede por ela). O pedido do hóspede pode ser registrado: vale pelo horário em que chegou. Antes da entrada, use 'Cancelar a reserva contestada'.";
/** O `TEXTO_CONTESTADO_ALTERACAO` com disputa em curso. */
export const TEXTO_DISPUTA_EM_CURSO_ALTERACAO = "Disputa do pagamento em curso: a alteração espera o resultado.";
export const TEXTO_SEM_PARTES_PARA_DIVIDIR = "Não há partes para dividir: escolha a SCL ou o proprietário.";
export const TEXTO_SEM_PROPRIETARIO_NA_RESERVA = "A reserva não tem proprietário nas linhas do financeiro: só a SCL pode arcar.";
export const TEXTO_ESTORNO_LIBERACAO_COM_RETIDO = "A disputa do pagamento já tem o débito do Mercado Pago confirmado contra esta liberação: corrija com um ajuste.";
/** `ERRO_DESPESA_DA_CONTESTACAO`: a despesa da disputa não se marca como paga nem se estorna pela lista de despesas. */
export const erroDespesaDaContestacao = (codigoReserva: string | null) =>
  `Esta despesa é da disputa do pagamento${codigoReserva ? ` da reserva ${codigoReserva}` : ""}: corrija pelo quadro da disputa.`;

// Quadro e decisão.
export const TEXTO_PAGAMENTO_SEM_RESERVA = "Pagamento sem reserva: não há proprietário; a perda, se houver, é da SCL";
export const TEXTO_NADA_A_DIVIDIR = "A disputa cobre a devolução que a reserva já devia ao hóspede: nada a dividir.";
export const TEXTO_SEM_COMO_FUNCIONA = "O proprietário ainda não aceitou um 'Como funciona' que fale de disputas do pagamento.";
export const TEXTO_DIVISAO_MUDOU = "A divisão da reserva mudou depois da decisão: mude a decisão se quiser.";
export const TEXTO_VERIFICACAO_TENTADA = "verificação tentada: se passa a responsabilidade é pergunta ao Mercado Pago";
export const TEXTO_COBERTURA_A_CONFERIR = "pela página atual do Mercado Pago, a cobertura aplicada é o resultado; o sentido está a conferir";

// Reserva em conferência, repasse e Início.
export const MOTIVO_PARTE_EM_CONFERENCIA = "Reserva em conferência: disputa do pagamento; a parte espera a decisão de quem arca.";
/** O motivo da parte presa no fechamento e no e-mail do repasse (nunca "dinheiro ainda não recebido pela empresa"). */
export const MOTIVO_FECHAMENTO_DISPUTA = "reserva em conferência: disputa do pagamento";
export const MOTIVO_SEGURADO_JUNTO = "segurado junto com a sua parte desta reserva, até o resultado";
export const textoRepasseComDisputa = (codigoReserva: string, abertaEm: Date) =>
  `A reserva ${codigoReserva} tem uma disputa do pagamento aberta desde ${diaMes(abertaEm)}: estorne o repasse antes de pagar, se quiser segurar a parte dela.`;
export const textoDisputaComEstadiaPorVir = (codigoReserva: string, checkin: string) =>
  `Disputa do pagamento da reserva ${codigoReserva} com entrada em ${diaMes(checkin)}: não libere a entrada antes de falar com quem cuida do financeiro.`;
export const textoEscaladaDaDisputa = (e: { presos: number; dias: number; valorDaDisputa: number; codigoReserva: string }) =>
  `${formatBRL(e.presos)} da parte do proprietário presos há ${e.dias} dias por uma disputa de ${formatBRL(e.valorDaDisputa)} (reserva ${e.codigoReserva}): registre quem arca.`;
export const textoDevolucaoDevidaDepoisDaGanha = (valor: number) => `A SCL ganhou a disputa: a devolução de ${formatBRL(valor)} que a reserva deve ao hóspede continua devida`;
export const TEXTO_PARA_CANCELAR_FALE_COM_A_EQUIPE = "Para cancelar, fale com a equipe.";

// Descrições dos lançamentos (o proprietário vê só o código da reserva, nunca o nome do hóspede).
export const DESCRICAO_RETIDO_PREVISTO = "Valor em disputa bloqueado pelo Mercado Pago (a confirmar)";
export const descricaoSeguradoDoProprietario = (codigoReserva: string, valor: number) =>
  `Disputa do pagamento da reserva ${codigoReserva}: ${formatBRL(valor)} segurado dos seus próximos repasses até o resultado`;
export const descricaoPerdaPrevistaDaScl = (codigoReserva: string) => `Disputa do pagamento da reserva ${codigoReserva}: perda prevista da SCL`;
