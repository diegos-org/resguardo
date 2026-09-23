import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { type DadosDespesa, type ErrosDespesa, RESPONSAVEIS, type Responsavel, validarDespesa } from "./despesas";

type Entrada = Record<string, FormDataEntryValue | undefined>;
const txt = (v: FormDataEntryValue | undefined) => (typeof v === "string" ? v.trim() : "");

/** Formulário do painel → DadosDespesa (reais → centavos) e validação. */
export function lerFormDespesa(e: Entrada): { ok: true; dados: DadosDespesa } | { ok: false; erros: ErrosDespesa } {
  const erros: ErrosDespesa = {};
  const valor = reaisParaCentavos(txt(e.valor));
  if (valor === undefined || valor === null) erros.valor = "Valor inválido (ex.: 1.234,56).";
  const responsavel = txt(e.responsavel) as Responsavel;
  const pagoPor = (txt(e.pagoPor) || "empresa") as Responsavel;
  const paga = txt(e.paga) === "1";
  const dados: DadosDespesa = {
    responsavel: RESPONSAVEIS.includes(responsavel) ? responsavel : ("" as Responsavel),
    pagoPor,
    categoriaId: txt(e.categoriaId),
    descricao: txt(e.descricao),
    valor: valor ?? 0,
    data: txt(e.data),
    imovelId: txt(e.imovelId) || null,
    proprietarioId: txt(e.proprietarioId) || null,
    fornecedor: txt(e.fornecedor),
    comprovante: txt(e.comprovante),
    paga,
    dataPagamento: paga ? txt(e.dataPagamento) || null : null,
  };
  Object.assign(erros, { ...validarDespesa(dados), ...erros });
  if (Object.keys(erros).length) return { ok: false, erros };
  return { ok: true, dados };
}
