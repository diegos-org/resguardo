import { cnpjValido, cpfValido, soDigitos } from "./documento";

export type DadosProprietario = {
  nome: string;
  tipo: "fisica" | "juridica";
  documento: string;
  email: string;
  telefone: string;
  endereco: string;
  chavePix: string;
  observacoes: string;
  ativo: boolean;
};

export type DadosRepresentante = {
  nome: string;
  relacao: string;
  email: string;
  telefone: string;
  recebeRelatorios: boolean;
};

type Entrada = Record<string, FormDataEntryValue | undefined>;
type Resultado<T> = { ok: true; dados: T } | { ok: false; erros: Partial<Record<keyof T, string>> };

const texto = (v: FormDataEntryValue | undefined) => (typeof v === "string" ? v.trim() : "");
const marcado = (v: FormDataEntryValue | undefined) => v === "on" || v === "true";
const emailOk = (e: string) => e === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const telefoneOk = (t: string) => t === "" || (soDigitos(t).length >= 10 && soDigitos(t).length <= 13);

export function validarProprietario(e: Entrada): Resultado<DadosProprietario> {
  const erros: Partial<Record<keyof DadosProprietario, string>> = {};
  const tipo = texto(e.tipo) === "juridica" ? "juridica" : "fisica";
  const nome = texto(e.nome);
  const documento = soDigitos(texto(e.documento));
  const email = texto(e.email).toLowerCase();
  const telefone = texto(e.telefone);
  const chavePix = texto(e.chavePix);

  if (!nome) erros.nome = "Informe o nome completo ou a razão social.";
  else if (nome.length > 150) erros.nome = "Máximo de 150 caracteres.";
  if (documento && tipo === "fisica" && !cpfValido(documento)) erros.documento = "CPF inválido.";
  if (documento && tipo === "juridica" && !cnpjValido(documento)) erros.documento = "CNPJ inválido.";
  if (!emailOk(email)) erros.email = "E-mail inválido.";
  if (!telefoneOk(telefone)) erros.telefone = "Telefone com DDD (10 a 13 dígitos).";
  if (chavePix.length > 140) erros.chavePix = "Máximo de 140 caracteres.";

  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    dados: {
      nome,
      tipo,
      documento,
      email,
      telefone,
      endereco: texto(e.endereco),
      chavePix,
      observacoes: texto(e.observacoes),
      ativo: marcado(e.ativo),
    },
  };
}

export function validarRepresentante(e: Entrada): Resultado<DadosRepresentante> {
  const erros: Partial<Record<keyof DadosRepresentante, string>> = {};
  const nome = texto(e.nome);
  const email = texto(e.email).toLowerCase();
  const telefone = texto(e.telefone);
  if (!nome) erros.nome = "Informe o nome.";
  if (!emailOk(email)) erros.email = "E-mail inválido.";
  if (!telefoneOk(telefone)) erros.telefone = "Telefone com DDD (10 a 13 dígitos).";
  if (Object.keys(erros).length) return { ok: false, erros };
  return { ok: true, dados: { nome, relacao: texto(e.relacao), email, telefone, recebeRelatorios: marcado(e.recebeRelatorios) } };
}
