/**
 * Motor de comissões (M4.2): transforma uma reserva em lançamentos, de forma pura e testável.
 *
 * Regras (parâmetros em REGRAS_PADRAO; confirmadas por Diego em 24/09/2026):
 * - Contrato: o que estiver vigente na data de ENTRADA da reserva.
 * - Base da comissão: o valor que o canal repassa (bruto − taxa do canal, "liquido_canal").
 * - Competência: rateio IGUAL por noite do valor total (diárias + limpeza), sem olhar a
 *   diária de cada dia (estadia 29/10→02/11 = 3 noites em outubro, 1 em novembro); a soma
 *   dos meses é sempre exatamente o total.
 * - Quem recebe o dinheiro ("split" = o canal paga a parte do proprietário direto a ele →
 *   não gera dívida da empresa; "empresa" = a empresa recebe tudo e deve a parte do
 *   proprietário → entra no acerto), nesta ordem: o que estiver gravado na reserva; a
 *   configuração do imóvel para aquele canal; e, sem nada disso, o padrão do sistema:
 *   Airbnb = split (configurado assim nas contas da SCL); Booking, site e direta = empresa
 *   recebe e repassa no fechamento mensal. "a_confirmar" deixa o acerto pendente.
 * - Acerto pendente também quando o imóvel não tem proprietário ou tem mais de um (as cotas
 *   de cada um ainda não existem no cadastro) — nada é atribuído a um dono arbitrário.
 * - Arredondamento: comissão arredondada ao centavo mais próximo (meio centavo para cima),
 *   calculada sobre o total e depois rateada.
 */
import type { EstadoReserva, OrigemReserva, RecebimentoReserva, TipoContrato } from "@/db/schema";
import { contratoVigente } from "@/contratos/regras";
import { comissao, ratear } from "@/lib/rateio";
import { noites } from "@/reservas/regras";
import type { NovoLancamento } from "./ledger";

export type RegrasMotor = {
  base: "liquido_canal" | "bruto";
  recebimento: Record<OrigemReserva, RecebimentoReserva | "a_confirmar">;
  /**
   * Em quantos dias depois do check-in o canal paga o proprietário direto (quando quem recebe é `split`); null = sem
   * regra. Airbnb paga no dia seguinte (Diego, 4/10/2026). Decide a data do pagamento da reserva (M4.12): extrato,
   * relatório e o lado do início do sistema. Opcional só para compatibilidade de literais antigos: `prazoDoCanal` lê
   * o padrão quando falta.
   */
  prazoPagamento?: Record<OrigemReserva, number | null>;
};

export const REGRAS_PADRAO: RegrasMotor = {
  base: "liquido_canal",
  recebimento: { airbnb: "split", booking: "empresa", site: "empresa", direta: "empresa", outro: "empresa" },
  prazoPagamento: { airbnb: 1, booking: null, site: null, direta: null, outro: null },
};

export type ReservaParaMotor = {
  id: string;
  codigo: string;
  imovelId: string;
  origem: OrigemReserva;
  estado: EstadoReserva;
  checkin: string;
  checkout: string;
  valorBruto: number | null;
  taxaCanal: number | null;
  recebimento: RecebimentoReserva | null;
  /** Reserva cancelada pela política sem devolução (M8.2c): o que ficou com a empresa (base do cálculo); null = nada. */
  valorRetido?: number | null;
};

/**
 * A reserva que o motor calcula (uma regra, um lugar; o SQL gêmeo, `reservaCalculadaSql`, está em `portal/posse.ts`):
 * a confirmada e a cancelada com valor retido pela política (M8.2c), que é dividida como uma reserva normal. Vale em
 * todo lugar que testa "confirmada" por causa do dinheiro.
 */
export const reservaCalculadaPeloMotor = (r: { estado: EstadoReserva; valorRetido: number | null }) =>
  r.estado === "confirmada" || (r.estado === "cancelada" && (r.valorRetido ?? 0) > 0);

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

/** `ratear` e `comissao` vivem em `lib/rateio` (também usados pelos preços do marketplace, M12.1). */
export { comissao, ratear };

/** Quem recebe o dinheiro da reserva, nesta ordem: o gravado nela, o do imóvel para o canal, o padrão das regras. */
export function quemRecebeNaReserva(
  r: Pick<ReservaParaMotor, "recebimento" | "origem">,
  regras: RegrasMotor = REGRAS_PADRAO,
  recebimentoDoImovel: Partial<Record<OrigemReserva, RecebimentoReserva>> = {},
): RecebimentoReserva | "a_confirmar" {
  return r.recebimento ?? recebimentoDoImovel[r.origem] ?? regras.recebimento[r.origem];
}

export function calcularReserva(
  reserva: ReservaParaMotor,
  contratos: readonly ContratoParaMotor[],
  /** Proprietários vinculados ao imóvel. */
  donos: readonly string[],
  regras: RegrasMotor = REGRAS_PADRAO,
  /** Configuração do imóvel: quem recebe, por canal (sobrepõe o padrão). */
  recebimentoDoImovel: Partial<Record<OrigemReserva, RecebimentoReserva>> = {},
): ResultadoMotor {
  const avisos: string[] = [];
  let r = reserva;
  if (r.estado === "cancelada") {
    if (!r.valorRetido || r.valorRetido <= 0) return { lancamentos: [], avisos: ["Reserva cancelada: sem lançamentos."] };
    // M8.2c: cancelada sem devolução pela política — o valor retido segue o cálculo de uma confirmada.
    avisos.push("Reserva cancelada com valor retido pela política: dividido como uma reserva normal.");
    r = { ...r, valorBruto: r.valorRetido };
  }
  // Pendente ainda não é receita (nem dívida com o proprietário): assim o painel, o portal e o
  // PDF contam a mesma coisa (M4.8). Ao confirmar, a reserva é calculada.
  if (r.estado === "consulta" || r.estado === "pedido") return { lancamentos: [], avisos: [] };
  if (r.estado === "pendente") return { lancamentos: [], avisos: ["Reserva pendente: os valores entram quando ela for confirmada."] };
  if (r.valorBruto === null) return { lancamentos: [], avisos: ["Valor bruto não informado: cálculo pendente."] };
  const contrato = contratoVigente(contratos, r.checkin);
  if (!contrato) return { lancamentos: [], avisos: [`Sem contrato vigente em ${r.checkin} para este imóvel.`] };
  if (contrato.comissaoBp === null) return { lancamentos: [], avisos: ["Contrato de marketplace: a divisão do modelo B (Configurações → Marketplace) entra no financeiro com o M12.2; nada lançado por enquanto."] };

  const taxa = r.taxaCanal ?? 0;
  if (r.taxaCanal === null) avisos.push("Taxa do canal não informada: considerada zero.");
  const base = regras.base === "bruto" ? r.valorBruto : r.valorBruto - taxa;
  const bp = contrato.comissaoBp;
  const comissaoTotal = comissao(base, bp);
  const direitoTotal = base - comissaoTotal;
  const quemRecebe = quemRecebeNaReserva(r, regras, recebimentoDoImovel);
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


/** Por que o motor, em seco, não fecharia o cálculo de uma reserva (o pagamento no site só é oferecido sem nenhum destes). */
export type PendenciaDoCalculo = "sem_valor" | "sem_contrato" | "marketplace" | "sem_proprietario" | "varios_proprietarios" | "recebimento_nao_empresa" | "calculo_pendente";

/**
 * O mesmo cálculo do motor, em seco, para a reserva como se já estivesse confirmada (M8.2a): só oferece o
 * pagamento no site se saem receita e parte do proprietário sem pendência — contrato de gestão vigente na data
 * de ENTRADA, um proprietário só e quem recebe do canal = a empresa (o dinheiro entra na conta da SCL). Fora
 * disso o dinheiro do hóspede ficaria sem receita no livro (avisar em vez de supor).
 */
export function pendenciaDoCalculo(
  r: ReservaParaMotor,
  contratos: readonly ContratoParaMotor[],
  donos: readonly string[],
  regras: RegrasMotor = REGRAS_PADRAO,
  recebimentoDoImovel: Partial<Record<OrigemReserva, RecebimentoReserva>> = {},
): PendenciaDoCalculo | null {
  if (r.valorBruto === null) return "sem_valor";
  const contrato = contratoVigente(contratos, r.checkin);
  if (!contrato) return "sem_contrato";
  if (contrato.tipo === "marketplace" || contrato.comissaoBp === null) return "marketplace";
  if (donos.length === 0) return "sem_proprietario";
  if (donos.length > 1) return "varios_proprietarios";
  if (quemRecebeNaReserva(r, regras, recebimentoDoImovel) !== "empresa") return "recebimento_nao_empresa";
  const { lancamentos } = calcularReserva({ ...r, estado: "confirmada" }, contratos, donos, regras, recebimentoDoImovel);
  const receita = lancamentos.some((l) => l.tipo === "receita_bruta");
  const direito = lancamentos.filter((l) => l.tipo === "direito_proprietario");
  if (!receita || !direito.length || lancamentos.some((l) => l.estado === "pendente") || direito.some((l) => !l.proprietarioId)) return "calculo_pendente";
  return null;
}
