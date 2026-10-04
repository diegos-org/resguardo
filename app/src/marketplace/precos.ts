/**
 * Preços do marketplace e desconto único do site (M12.1). Decisão de Diego em 4/10/2026
 * (`requisitos/product/MARKETPLACE-PRECIFICACAO.md`): **modelo B em partes iguais**.
 *
 * A conta, em centavos inteiros, a partir do preço cheio P (o que o proprietário pediria na OTA):
 * - margem de referência = P × taxa da OTA − P × taxa do pagamento (zero se a taxa do pagamento
 *   for maior: não há o que dividir e o site vende pelo preço cheio);
 * - a margem é rateada pelos três pesos (padrão 1/1/1, editáveis no painel): a parte do hóspede
 *   vira desconto, a da SCL vira receita da SCL, a do proprietário vira ganho dele acima da OTA;
 * - o hóspede paga P − desconto; a taxa do pagamento real incide sobre o que ele paga (menor que
 *   a de referência), e essa sobra fica com o proprietário — por isso ele recebe um pouco mais
 *   que o peso dele. Nada é perdido nem criado: hóspede paga = taxa + SCL + proprietário.
 *
 * O **desconto** é regra única do site: vale para qualquer contrato, gestão total inclusive
 * (um modelo por contrato; o que muda entre contratos é a divisão do que entra, não o preço
 * ao hóspede). Este módulo é puro e roda também no navegador (tela de simulação).
 */
import { percentualParaBp } from "@/lib/percentual";
import { comissao as porcentagem, ratear } from "@/lib/rateio";

export type PesosMarketplace = { hospede: number; proprietario: number; scl: number };
export type PrecosMarketplace = {
  /** Taxa de referência da OTA principal (Airbnb, modalidade "só do anfitrião"), em pontos-base. */
  taxaOtaBp: number;
  /** Comissão de referência do Booking, só para a coluna de comparação. */
  taxaBookingBp: number;
  /** Taxa de referência do pagamento no site (cartão pelo Mercado Pago), em pontos-base. */
  taxaPagamentoBp: number;
  /** Pesos inteiros do rateio da margem (1/1/1 = partes iguais). */
  pesos: PesosMarketplace;
};

export const PRECOS_MARKETPLACE_PADRAO: PrecosMarketplace = {
  taxaOtaBp: 1600,
  taxaBookingBp: 1500,
  taxaPagamentoBp: 400,
  pesos: { hospede: 1, proprietario: 1, scl: 1 },
};

export const LIMITES_PRECOS = { taxaBp: [0, 5000], peso: [0, 100] } as const;

export type Coluna = { hospedePaga: number; taxa: number; proprietarioRecebe: number };
export type SimulacaoMarketplace = {
  precoCheio: number;
  /** P × (taxa da OTA − taxa do pagamento), nunca negativa. */
  margemReferencia: number;
  partes: PesosMarketplace;
  airbnb: Coluna;
  booking: Coluna;
  site: Coluna & { desconto: number; scl: number };
  comparacao: { hospedeEconomiza: number; proprietarioGanhaMais: number };
  avisos: string[];
};

const inteiroEntre = (v: unknown, [min, max]: readonly [number, number]) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Lê o JSON gravado tolerando campos ausentes/inválidos (voltam ao padrão). */
export function precosDeJson(valor: unknown): PrecosMarketplace {
  const c = (valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {}) as Record<string, unknown>;
  const P = PRECOS_MARKETPLACE_PADRAO;
  const pesos = (c.pesos && typeof c.pesos === "object" ? c.pesos : {}) as Record<string, unknown>;
  const peso = (k: keyof PesosMarketplace) => (inteiroEntre(pesos[k], LIMITES_PRECOS.peso) ? (pesos[k] as number) : P.pesos[k]);
  const lidos = { hospede: peso("hospede"), proprietario: peso("proprietario"), scl: peso("scl") };
  return {
    taxaOtaBp: inteiroEntre(c.taxaOtaBp, LIMITES_PRECOS.taxaBp) ? (c.taxaOtaBp as number) : P.taxaOtaBp,
    taxaBookingBp: inteiroEntre(c.taxaBookingBp, LIMITES_PRECOS.taxaBp) ? (c.taxaBookingBp as number) : P.taxaBookingBp,
    taxaPagamentoBp: inteiroEntre(c.taxaPagamentoBp, LIMITES_PRECOS.taxaBp) ? (c.taxaPagamentoBp as number) : P.taxaPagamentoBp,
    // Pesos todos zero não dividem nada: volta ao padrão em vez de inventar.
    pesos: lidos.hospede + lidos.proprietario + lidos.scl > 0 ? lidos : { ...P.pesos },
  };
}

export type ErrosPrecos = Record<string, string>;

/** Formulário do painel → preços. Todos os campos são lidos antes de decidir (nenhum volta ao padrão em silêncio). */
export function validarFormPrecos(e: Record<string, unknown>): { ok: true; precos: PrecosMarketplace } | { ok: false; erros: ErrosPrecos } {
  const erros: ErrosPrecos = {};
  const txt = (k: string) => (typeof e[k] === "string" ? (e[k] as string).trim() : "");
  const taxa = (k: string): number => {
    const bp = percentualParaBp(txt(k));
    if (bp === null || bp > LIMITES_PRECOS.taxaBp[1]) {
      erros[k] = "Percentual entre 0 e 50, até duas casas (ex.: 16 ou 3,98).";
      return 0;
    }
    return bp;
  };
  const peso = (k: string): number => {
    const v = txt(k);
    if (!/^\d+$/.test(v) || Number(v) > LIMITES_PRECOS.peso[1]) {
      erros[k] = `Número inteiro entre 0 e ${LIMITES_PRECOS.peso[1]}.`;
      return 0;
    }
    return Number(v);
  };
  const precos: PrecosMarketplace = {
    taxaOtaBp: taxa("taxaOta"),
    taxaBookingBp: taxa("taxaBooking"),
    taxaPagamentoBp: taxa("taxaPagamento"),
    pesos: { hospede: peso("pesoHospede"), proprietario: peso("pesoProprietario"), scl: peso("pesoScl") },
  };
  if (!erros.pesoHospede && !erros.pesoProprietario && !erros.pesoScl && precos.pesos.hospede + precos.pesos.proprietario + precos.pesos.scl === 0) {
    erros.pesoHospede = "Pelo menos um dos pesos precisa ser maior que zero.";
  }
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, precos };
}

/** Simulação completa para um preço cheio (diárias + limpeza + hóspede extra), em centavos. */
export function simular(precoCheio: number, p: PrecosMarketplace): SimulacaoMarketplace {
  if (!Number.isSafeInteger(precoCheio) || precoCheio < 0) throw new TypeError(`Preço cheio inválido: ${precoCheio}`);
  const avisos: string[] = [];
  const taxaOta = porcentagem(precoCheio, p.taxaOtaBp);
  const taxaBooking = porcentagem(precoCheio, p.taxaBookingBp);
  const margemReferencia = Math.max(0, taxaOta - porcentagem(precoCheio, p.taxaPagamentoBp));
  if (precoCheio > 0 && margemReferencia === 0) avisos.push("A taxa do pagamento é igual ou maior que a da OTA: não há margem a dividir e o site vende pelo preço cheio.");
  const [hospede, proprietario, scl] = ratear(margemReferencia, [p.pesos.hospede, p.pesos.proprietario, p.pesos.scl]);
  const hospedePaga = precoCheio - hospede;
  const taxaPagamento = porcentagem(hospedePaga, p.taxaPagamentoBp);
  const proprietarioRecebe = hospedePaga - taxaPagamento - scl;
  const airbnb: Coluna = { hospedePaga: precoCheio, taxa: taxaOta, proprietarioRecebe: precoCheio - taxaOta };
  return {
    precoCheio,
    margemReferencia,
    partes: { hospede, proprietario, scl },
    airbnb,
    booking: { hospedePaga: precoCheio, taxa: taxaBooking, proprietarioRecebe: precoCheio - taxaBooking },
    site: { desconto: hospede, hospedePaga, taxa: taxaPagamento, scl, proprietarioRecebe },
    comparacao: { hospedeEconomiza: hospede, proprietarioGanhaMais: proprietarioRecebe - airbnb.proprietarioRecebe },
    avisos,
  };
}

/** Desconto do site para um valor cheio, em centavos (a parte do hóspede da margem). Zero quando não há margem. */
export function descontoDoSite(valorCheio: number, p: PrecosMarketplace): number {
  return valorCheio > 0 ? simular(valorCheio, p).site.desconto : 0;
}

/** Percentual do desconto do site em pontos-base (aproximado, para explicar: a conta real é em centavos). */
export function descontoBp(p: PrecosMarketplace): number {
  const soma = p.pesos.hospede + p.pesos.proprietario + p.pesos.scl;
  if (soma === 0) return 0;
  return Math.max(0, Math.round(((p.taxaOtaBp - p.taxaPagamentoBp) * p.pesos.hospede) / soma));
}
