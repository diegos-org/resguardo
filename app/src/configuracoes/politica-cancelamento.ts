/**
 * A regra da Política de cancelamento do site (M8.2c), pura e testável: dada a versão aceita no pagamento, a data de
 * entrada, o momento em que a SCL recebeu o pedido e quem cancela, diz se a política dá a devolução integral ou nada
 * (a devolução de parte do valor é do M8.2d). Uma regra, um lugar: a prévia e o cancelamento no painel, Minha reserva
 * e a página da reserva leem daqui. O que a equipe pode escolher (exceção, sem política, não comparecimento com pedido,
 * saída antecipada) não mora aqui: é a decisão final do cancelamento (`pagamentos/cancelamento.ts`).
 *
 * - Os dias são datas do calendário no fuso do imóvel; o reembolso integral vale até 23h59 do último dia
 *   (`prazoDoReembolso`, o mesmo cálculo da página da cotação).
 * - Arrependimento (CDC art. 49, lei, não regra editável): até 23h59 do 7º dia depois do dia da aprovação do pagamento,
 *   integral mesmo dentro dos N dias; pela versão aceita, só até o horário de entrada (`arrependimentoAteEntrada`,
 *   ausente = sim, como no texto-base publicado).
 * - A SCL cancela: integral a qualquer momento. Não comparecimento: nada.
 */
import type { BaseCancelamento, QuemCancelaReserva } from "@/db/schema";
import { hojeISO, instanteLocal, somarDias } from "@/lib/datas";
import { prazoDoReembolso, type RegrasCancelamento, regrasComPadrao } from "./paginas-legais-texto";

/** CDC art. 49: sete dias corridos — lei, não regra editável. */
export const DIAS_ARREPENDIMENTO = 7;

export type QuemCancela = QuemCancelaReserva;

export type EntradaPolitica = {
  /** Da versão aceita no pagamento; null = sem política (pagamento sem aceite das páginas legais). */
  regras: RegrasCancelamento | null;
  /** AAAA-MM-DD: a entrada ORIGINAL (o M8.2d passa a original numa alteração). */
  checkin: string;
  /** "HH:MM" (imoveis_detalhes.checkin_a_partir_de). */
  horaEntrada: string;
  /** imoveis.fuso */
  fuso: string;
  /** pagamentos.aprovado_em (sempre preenchido num pagamento aprovado). */
  aprovadoEm: Date;
  pedidoRecebidoEm: Date;
  quemCancela: QuemCancela;
  /** Centavos sujeitos à política: o pago (M8.2c) ou a diferença de uma alteração (M8.2d). */
  valorBase: number;
};

export type DecisaoPolitica = {
  calculado: "integral" | "nenhum" | "sem_politica";
  base: Exclude<BaseCancelamento, "excecao">;
  /** 0 ou `valorBase`; 0 em sem_politica (nada calculado). */
  valorADevolver: number;
  /** Último dia do reembolso integral (até 23h59); null sem política. */
  integralAte: string | null;
  /** Último dia do arrependimento (até 23h59); null sem política. */
  arrependimentoAte: string | null;
  /** Instante da entrada (limite do arrependimento, começo da estadia). */
  entradaEm: Date;
  /** O pedido chegou no instante da entrada ou depois. */
  comecou: boolean;
};

/** `arrependimentoAteEntrada` ausente = true (o texto-base publicado tem o limite). Também dá o valor inicial do formulário. */
export { regrasComPadrao };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const instanteValido = (d: Date) => d instanceof Date && !Number.isNaN(d.getTime());
function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

export function decidirPelaPolitica(e: EntradaPolitica): DecisaoPolitica {
  // Entrada inválida é erro de quem chama (como em `prazoDoReembolso`): nunca uma decisão por palpite.
  if (!DATA.test(e.checkin) || Number.isNaN(Date.parse(`${e.checkin}T00:00:00Z`))) throw new Error("Data de entrada inválida.");
  if (!HORA.test(e.horaEntrada)) throw new Error("Horário de entrada inválido.");
  if (!fusoValido(e.fuso)) throw new Error("Fuso inválido.");
  if (!instanteValido(e.aprovadoEm) || !instanteValido(e.pedidoRecebidoEm)) throw new Error("Instante inválido.");
  if (!Number.isSafeInteger(e.valorBase) || e.valorBase < 0) throw new Error("Valor inválido.");

  const entradaEm = instanteLocal(e.checkin, e.horaEntrada, e.fuso);
  const hojeDoPedido = hojeISO(e.fuso, e.pedidoRecebidoEm);
  const comecou = e.pedidoRecebidoEm.getTime() >= entradaEm.getTime();
  if (e.regras === null) return { calculado: "sem_politica", base: "sem_politica", valorADevolver: 0, integralAte: null, arrependimentoAte: null, entradaEm, comecou };

  const regras = regrasComPadrao(e.regras);
  // Com "hoje" no começo dos tempos, `prazoDoReembolso` sempre devolve a data (o último dia do integral).
  const prazo = prazoDoReembolso(e.checkin, regras.diasReembolsoIntegral, "0000-01-01");
  const integralAte = prazo.tipo === "integral_ate" ? prazo.data : e.checkin;
  const noPrazo = hojeDoPedido <= integralAte;
  const arrependimentoAte = somarDias(hojeISO(e.fuso, e.aprovadoEm), DIAS_ARREPENDIMENTO);
  const noArrependimento = hojeDoPedido <= arrependimentoAte && (!regras.arrependimentoAteEntrada || !comecou);

  const [calculado, base]: [DecisaoPolitica["calculado"], DecisaoPolitica["base"]] =
    e.quemCancela === "empresa"
      ? ["integral", "empresa"]
      : e.quemCancela === "nao_comparecimento"
        ? ["nenhum", "nao_comparecimento"]
        : noPrazo
          ? ["integral", "prazo"]
          : noArrependimento
            ? ["integral", "arrependimento"]
            : comecou
              ? ["nenhum", "estadia_iniciada"]
              : ["nenhum", "fora_do_prazo"];
  return { calculado, base, valorADevolver: calculado === "integral" ? e.valorBase : 0, integralAte, arrependimentoAte, entradaEm, comecou };
}
