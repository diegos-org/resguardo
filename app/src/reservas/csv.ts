/**
 * Importação de reservas por planilha CSV (M3.6), parte pura: ler o arquivo e converter cada
 * linha em DadosReserva. Aceita o CSV do Excel brasileiro (";" e vírgula decimal) e o
 * internacional (","), com ou sem aspas, com BOM e CRLF. Datas DD/MM/AAAA ou AAAA-MM-DD.
 * Dado faltando ou estranho vira erro da linha — nunca um palpite.
 */
import type { EstadoReserva, OrigemReserva } from "@/db/schema";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { type DadosReserva, dataValida, validarReserva } from "./regras";

export { LIMITE_BYTES, LIMITE_LINHAS, MODELO_CSV } from "./csv-modelo";

/** Arquivo que não dá para ler com segurança (ex.: aspas abertas sem fechar). */
export class CsvInvalido extends Error {}

/** Separa o texto em linhas e colunas (RFC 4180, com o separador detectado no cabeçalho). */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primeira = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ";" : primeira.includes("\t") && !primeira.includes(",") ? "\t" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"' && campo === "") aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  // Aspas sem fechar engoliriam o resto do arquivo calado: melhor recusar.
  if (aspas) throw new CsvInvalido("Há um campo com aspas (\") aberto e não fechado. Confira a planilha.");
  if (campo !== "" || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.filter((l) => l.some((c) => c.trim() !== ""));
}

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** Nome da coluna → campo. Vários nomes aceitos para cada campo. */
const COLUNAS: Record<string, string[]> = {
  imovel: ["imovel", "codigo_imovel", "codigo_do_imovel", "apartamento", "unidade", "propriedade"],
  origem: ["origem", "canal", "fonte"],
  codigoCanal: ["codigo_canal", "codigo_no_canal", "codigo_reserva", "codigo_da_reserva", "numero_reserva", "numero_da_reserva", "id_da_reserva", "codigo", "id_reserva", "reserva", "confirmacao", "id"],
  estado: ["situacao", "estado", "status"],
  checkin: ["entrada", "checkin", "check_in", "chegada"],
  checkout: ["saida", "checkout", "check_out", "partida"],
  hospedes: ["hospedes", "numero_hospedes", "pessoas"],
  hospedeNome: ["nome", "hospede", "nome_hospede", "nome_do_hospede"],
  hospedeEmail: ["email", "e_mail", "email_hospede"],
  hospedeTelefone: ["telefone", "celular", "whatsapp"],
  hospedeOrigem: ["cidade", "pais", "origem_hospede", "cidade_pais"],
  valorBruto: ["valor_bruto", "valor_total", "total", "bruto"],
  taxaCanal: ["taxa_canal", "taxa_do_canal", "taxa", "comissao_canal", "taxa_plataforma"],
  valorLiquido: ["valor_liquido", "liquido", "repasse_canal"],
  observacoes: ["observacoes", "obs", "notas"],
};
export const COLUNAS_OBRIGATORIAS = ["imovel", "origem", "codigoCanal", "checkin", "checkout"] as const;



const ORIGENS: Record<string, OrigemReserva> = {
  airbnb: "airbnb",
  booking: "booking",
  booking_com: "booking",
  site: "site",
  direta: "direta",
  direto: "direta",
  whatsapp: "direta",
  indicacao: "direta",
  outro: "outro",
  outra: "outro",
};
const ESTADOS: Record<string, EstadoReserva> = {
  confirmada: "confirmada",
  confirmado: "confirmada",
  confirmed: "confirmada",
  ok: "confirmada",
  pendente: "pendente",
  pending: "pendente",
  cancelada: "cancelada",
  cancelado: "cancelada",
  cancelled: "cancelada",
  canceled: "cancelada",
};

function data(v: string): string | null {
  const t = v.trim();
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = br ? `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}` : t;
  return dataValida(iso) ? iso : null;
}

export type Cabecalho = { mapa: Partial<Record<string, number>>; faltando: string[]; ignoradas: string[] };

export function lerCabecalho(colunas: string[]): Cabecalho {
  const mapa: Partial<Record<string, number>> = {};
  const ignoradas: string[] = [];
  colunas.forEach((c, i) => {
    const n = semAcento(c);
    const campo = Object.entries(COLUNAS).find(([, nomes]) => nomes.includes(n))?.[0];
    if (campo && mapa[campo] === undefined) mapa[campo] = i;
    else if (c.trim()) ignoradas.push(c.trim());
  });
  return { mapa, faltando: COLUNAS_OBRIGATORIAS.filter((c) => mapa[c] === undefined), ignoradas };
}

export type LinhaLida =
  | { ok: true; numero: number; imovel: string; dados: Omit<DadosReserva, "imovelId">; idFonte: string }
  | { ok: false; numero: number; erros: string[] };

/** Converte uma linha (já com o cabeçalho mapeado). `numero` = linha na planilha (cabeçalho = 1). */
export function lerLinha(celulas: string[], cab: Cabecalho, numero: number): LinhaLida {
  const v = (campo: string) => {
    const i = cab.mapa[campo];
    return i === undefined ? "" : (celulas[i] ?? "").trim();
  };
  const erros: string[] = [];
  const imovel = v("imovel").toLowerCase();
  if (!imovel) erros.push("Falta o imóvel.");
  const origem = ORIGENS[semAcento(v("origem"))];
  if (!origem) erros.push(`Origem "${v("origem")}" não reconhecida (use airbnb, booking, site, direta ou outro).`);
  const codigoCanal = v("codigoCanal");
  if (!codigoCanal) erros.push("Falta o código da reserva no canal (é ele que evita importar a mesma reserva duas vezes).");
  const estadoTxt = semAcento(v("estado"));
  const estado = estadoTxt ? ESTADOS[estadoTxt] : "confirmada";
  if (!estado) erros.push(`Situação "${v("estado")}" não reconhecida (use confirmada, pendente ou cancelada).`);
  const checkin = data(v("checkin"));
  const checkout = data(v("checkout"));
  if (!checkin) erros.push(`Data de entrada inválida: "${v("checkin")}".`);
  if (!checkout) erros.push(`Data de saída inválida: "${v("checkout")}".`);
  const hTxt = v("hospedes");
  const hospedes = hTxt === "" ? null : /^\d+$/.test(hTxt) ? Number(hTxt) : NaN;
  if (Number.isNaN(hospedes)) erros.push(`Número de hóspedes inválido: "${hTxt}".`);
  const valores: Record<"valorBruto" | "taxaCanal" | "valorLiquido", number | null> = { valorBruto: null, taxaCanal: null, valorLiquido: null };
  for (const campo of ["valorBruto", "taxaCanal", "valorLiquido"] as const) {
    const c = reaisParaCentavos(v(campo));
    if (c === undefined) erros.push(`Valor inválido em ${campo === "valorBruto" ? "valor bruto" : campo === "taxaCanal" ? "taxa do canal" : "valor líquido"}: "${v(campo)}".`);
    else valores[campo] = c;
  }
  // Texto longo demais é erro da linha — nunca cortado calado.
  const limites: [string, string, number][] = [
    ["hospedeNome", "nome", 120],
    ["hospedeEmail", "e-mail", 200],
    ["hospedeTelefone", "telefone", 40],
    ["hospedeOrigem", "cidade/país", 120],
    ["codigoCanal", "código da reserva", 80],
    ["observacoes", "observações", 2000],
  ];
  for (const [campo, nome, max] of limites) if (v(campo).length > max) erros.push(`Texto longo demais em ${nome} (máximo ${max} caracteres).`);
  if (erros.length) return { ok: false, numero, erros };
  const dados: Omit<DadosReserva, "imovelId"> = {
    origem: origem!,
    estado: estado!,
    checkin: checkin!,
    checkout: checkout!,
    hospedes: hospedes as number | null,
    hospedeNome: v("hospedeNome"),
    hospedeEmail: v("hospedeEmail").toLowerCase(),
    hospedeTelefone: v("hospedeTelefone"),
    hospedeOrigem: v("hospedeOrigem"),
    moeda: "BRL",
    ...valores,
    codigoCanal: codigoCanal,
    observacoes: v("observacoes"),
  };
  const regras = validarReserva({ ...dados, imovelId: "x" });
  if (Object.keys(regras).length) return { ok: false, numero, erros: Object.values(regras).filter((m): m is string => Boolean(m)) };
  return { ok: true, numero, imovel, dados, idFonte: `${origem}:${codigoCanal}` };
}
