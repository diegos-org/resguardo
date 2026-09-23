import { ESTADOS_RESERVA, type EstadoReserva, ORIGENS_RESERVA, type OrigemReserva } from "@/db/schema";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { type DadosReserva, type ErrosReserva, validarReserva } from "./regras";

type Entrada = Record<string, FormDataEntryValue | undefined>;
const txt = (v: FormDataEntryValue | undefined) => (typeof v === "string" ? v.trim() : "");

/** Converte o formulário do painel em DadosReserva (valores em reais → centavos) e valida. */
export function lerFormReserva(e: Entrada): { ok: true; dados: DadosReserva } | { ok: false; erros: ErrosReserva } {
  const erros: ErrosReserva = {};
  const valores: Record<"valorBruto" | "taxaCanal" | "valorLiquido", number | null> = { valorBruto: null, taxaCanal: null, valorLiquido: null };
  for (const campo of ["valorBruto", "taxaCanal", "valorLiquido"] as const) {
    const v = reaisParaCentavos(txt(e[campo]));
    if (v === undefined) erros[campo] = "Valor inválido (ex.: 1.234,56).";
    else valores[campo] = v;
  }
  const hospedesTxt = txt(e.hospedes);
  const hospedes = hospedesTxt === "" ? null : /^\d+$/.test(hospedesTxt) ? Number(hospedesTxt) : NaN;

  const origem = txt(e.origem) as OrigemReserva;
  const estado = (txt(e.estado) || "confirmada") as EstadoReserva;
  if (!ORIGENS_RESERVA.includes(origem)) erros.origem = "Escolha a origem.";
  if (!ESTADOS_RESERVA.includes(estado)) erros.estado = "Situação inválida.";

  const dados: DadosReserva = {
    imovelId: txt(e.imovelId),
    origem,
    estado,
    checkin: txt(e.checkin),
    checkout: txt(e.checkout),
    hospedes,
    hospedeNome: txt(e.hospedeNome),
    hospedeEmail: txt(e.hospedeEmail).toLowerCase(),
    hospedeTelefone: txt(e.hospedeTelefone),
    hospedeOrigem: txt(e.hospedeOrigem),
    moeda: "BRL",
    ...valores,
    codigoCanal: txt(e.codigoCanal),
    observacoes: txt(e.observacoes),
  };
  if (!dados.imovelId) erros.imovelId = "Escolha o imóvel.";
  Object.assign(erros, validarReserva(dados), erros);
  if (Number.isNaN(hospedes)) erros.hospedes = "Número inteiro de hóspedes.";
  if (Object.keys(erros).length) return { ok: false, erros };
  return { ok: true, dados };
}
