/**
 * Motor de comissões (M4.2): transforma uma reserva em lançamentos, de forma pura e testável.
 *
 * Regras (parâmetros ajustáveis em REGRAS_PADRAO, a confirmar com Diego — ver GUIA-DIEGO):
 * - Contrato: o que estiver vigente na data de ENTRADA da reserva.
 * - Base da comissão: valor bruto − taxa do canal ("liquido_canal") ou o bruto ("bruto").
 * - Competência: rateio pelas noites de cada mês (estadia 29/10→02/11 = 3 noites em
 *   outubro, 1 em novembro); a soma dos meses é sempre exatamente o total.
 * - Quem recebe o dinheiro: o que estiver gravado na reserva ("split" = o canal paga a parte
 *   do proprietário direto a ele → não gera dívida da empresa; "empresa" = a empresa recebe
 *   tudo e deve a parte do proprietário → entra no acerto). Sem isso, vale a regra da origem;
 *   no Airbnb não se presume split: fica "a_confirmar" e a parte do proprietário fica pendente.
 * - Acerto pendente também quando o imóvel não tem proprietário ou tem mais de um (as cotas
 *   de cada um ainda não existem no cadastro) — nada é atribuído a um dono arbitrário.
 * - Arredondamento: comissão arredondada ao centavo mais próximo (meio centavo para cima),
 *   calculada sobre o total e depois rateada.
 */
import type { OrigemReserva, RecebimentoReserva, TipoContrato } from "@/db/schema";
import { contratoVigente } from "@/contratos/regras";
import { noites } from "@/reservas/regras";
import type { NovoLancamento } from "./ledger";

export type RegrasMotor = {
  base: "liquido_canal" | "bruto";
  recebimento: Record<OrigemReserva, RecebimentoReserva | "a_confirmar">;
};

export const REGRAS_PADRAO: RegrasMotor = {
  base: "liquido_canal",
  recebimento: { airbnb: "a_confirmar", booking: "empresa", site: "empresa", direta: "empresa", outro: "empresa" },
};

export type ReservaParaMotor = {
  id: string;
  codigo: string;
  imovelId: string;
  origem: OrigemReserva;
  estado: "pendente" | "confirmada" | "cancelada";
  checkin: string;
  checkout: string;
  valorBruto: number | null;
  taxaCanal: number | null;
  recebimento: RecebimentoReserva | null;
};

export type ContratoParaMotor = { tipo: TipoContrato; comissaoBp: number | null; inicio: string; fim: string | null };

export type ResultadoMotor = { lancamentos: NovoLancamento[]; avisos: string[] };

/** Noites por mês ("AAAA-MM" → noites), em ordem. */
export function noitesPorMes(checkin: string, checkout: string): [string, number][] {
  const mapa = new Map<string, number>();
  for (let t = Date.parse(`${checkin}T00:00:00Z`); t < Date.parse(`${checkout}T00:00:00Z`); t += 86_400_000) {
    const mes = new Date(t).toISOString().slice(0, 7);
    mapa.set(mes, (mapa.get(mes) ?? 0) + 1);
  }
  return [...mapa.entries()];
}

/** Divide `total` centavos em partes proporcionais aos pesos, sem perder nem criar centavo. */
export function ratear(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (soma === 0) return pesos.map(() => 0);
  const exatos = pesos.map((p) => (total * p) / soma);
  const partes = exatos.map((x) => Math.trunc(x));
  let resto = total - partes.reduce((a, b) => a + b, 0);
  const ordem = exatos.map((x, i) => [Math.abs(x - Math.trunc(x)), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of ordem) {
    if (resto === 0) break;
    const passo = Math.sign(resto);
    partes[i] += passo;
    resto -= passo;
  }
  return partes;
}

/** Comissão em centavos: base × pontos-base / 10000, meio centavo para cima (em módulo). */
export function comissao(base: number, bp: number): number {
  const bruto = base * bp;
  return Math.sign(bruto) * Math.floor((Math.abs(bruto) + 5000) / 10000);
}

export function calcularReserva(
  r: ReservaParaMotor,
  contratos: readonly ContratoParaMotor[],
  /** Proprietários vinculados ao imóvel. */
  donos: readonly string[],
  regras: RegrasMotor = REGRAS_PADRAO,
): ResultadoMotor {
  const avisos: string[] = [];
  if (r.estado === "cancelada") return { lancamentos: [], avisos: ["Reserva cancelada: sem lançamentos."] };
  if (r.valorBruto === null) return { lancamentos: [], avisos: ["Valor bruto não informado: cálculo pendente."] };
  const contrato = contratoVigente(contratos, r.checkin);
  if (!contrato) return { lancamentos: [], avisos: [`Sem contrato vigente em ${r.checkin} para este imóvel.`] };
  if (contrato.comissaoBp === null) return { lancamentos: [], avisos: ["Contrato de marketplace com fórmula ainda não definida."] };

  const taxa = r.taxaCanal ?? 0;
  if (r.taxaCanal === null) avisos.push("Taxa do canal não informada: considerada zero.");
  const base = regras.base === "bruto" ? r.valorBruto : r.valorBruto - taxa;
  const bp = contrato.comissaoBp;
  const comissaoTotal = comissao(base, bp);
  const direitoTotal = base - comissaoTotal;
  const quemRecebe = r.recebimento ?? regras.recebimento[r.origem];
  const proprietarioId = donos.length === 1 ? donos[0] : null;
  if (donos.length === 0) avisos.push("Imóvel sem proprietário vinculado: acerto pendente.");
  if (donos.length > 1) avisos.push("Imóvel com mais de um proprietário: acerto pendente até definir a cota de cada um.");
  if (quemRecebe === "a_confirmar") avisos.push("Confirmar se o canal paga o proprietário direto (split) ou se a empresa recebe tudo: acerto pendente.");
  const acertoPendente = !proprietarioId || quemRecebe === "a_confirmar";

  const meses = noitesPorMes(r.checkin, r.checkout);
  const pesos = meses.map(([, n]) => n);
  const partes = {
    bruto: ratear(r.valorBruto, pesos),
    taxa: ratear(taxa, pesos),
    comissao: ratear(comissaoTotal, pesos),
    direito: ratear(direitoTotal, pesos),
  };
  const totalNoites = noites(r.checkin, r.checkout);
  const lancamentos: NovoLancamento[] = [];
  meses.forEach(([mes, n], i) => {
    const comum = {
      competencia: `${mes}-01`,
      imovelId: r.imovelId,
      reservaId: r.id,
      origem: "motor",
      estado: "previsto" as const,
    };
    const sufixo = meses.length > 1 ? ` (${n} de ${totalNoites} noites em ${mes})` : "";
    const chave = (tipo: string) => `reserva:${r.id}:${tipo}:${mes}`;
    lancamentos.push({ ...comum, tipo: "receita_bruta", descricao: `Reserva ${r.codigo} — valor bruto${sufixo}`, valor: partes.bruto[i], chaveOrigem: chave("bruto") });
    if (partes.taxa[i] !== 0) {
      lancamentos.push({ ...comum, tipo: "taxa_canal", descricao: `Reserva ${r.codigo} — taxa do canal${sufixo}`, valor: -partes.taxa[i], chaveOrigem: chave("taxa") });
    }
    lancamentos.push({
      ...comum,
      tipo: "comissao",
      descricao: `Reserva ${r.codigo} — comissão ${bp / 100}%${sufixo}`,
      valor: partes.comissao[i],
      chaveOrigem: chave("comissao"),
    });
    lancamentos.push({
      ...comum,
      tipo: "direito_proprietario",
      descricao: `Reserva ${r.codigo} — parte do proprietário${quemRecebe === "split" ? " (paga direto pelo canal)" : ""}${acertoPendente ? " (acerto pendente)" : ""}${sufixo}`,
      valor: partes.direito[i],
      proprietarioId,
      efeitoSaldo: quemRecebe === "empresa" && proprietarioId ? partes.direito[i] : 0,
      ...(acertoPendente ? { estado: "pendente" as const } : {}),
      chaveOrigem: chave("direito"),
    });
  });
  return { lancamentos, avisos };
}
