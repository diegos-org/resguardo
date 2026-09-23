/** Validação do formulário de imóvel. Pura: recebe texto do formulário, devolve dados ou erros. */

export type DadosImovel = {
  codigo: string;
  nome: string;
  publico: boolean;
  ativo: boolean;
  bairro: string;
  cidade: string;
  endereco: string;
  fuso: string;
  capacidade: number | null;
  quartos: number | null;
  banheiros: number | null;
  descricao: string;
};

export type ErrosImovel = Partial<Record<keyof DadosImovel, string>>;
export type ResultadoValidacao = { ok: true; dados: DadosImovel } | { ok: false; erros: ErrosImovel };

type Entrada = Record<string, FormDataEntryValue | undefined>;

const texto = (v: FormDataEntryValue | undefined) => (typeof v === "string" ? v.trim() : "");
const marcado = (v: FormDataEntryValue | undefined) => v === "on" || v === "true";

export function fusoValido(fuso: string): boolean {
  if (!fuso) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

function inteiroOpcional(v: string, min: number, max: number): number | null | undefined {
  if (v === "") return null;
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n >= min && n <= max ? n : undefined;
}

export function validarImovel(entrada: Entrada): ResultadoValidacao {
  const erros: ErrosImovel = {};
  const codigo = texto(entrada.codigo).toLowerCase();
  const nome = texto(entrada.nome);
  const fuso = texto(entrada.fuso) || "America/Sao_Paulo";

  if (!/^[a-z0-9][a-z0-9-]{0,19}$/.test(codigo)) {
    erros.codigo = "Use de 1 a 20 letras minúsculas, números ou hífen (ex.: 403, buzios).";
  }
  if (!nome) erros.nome = "Informe o nome do imóvel.";
  else if (nome.length > 100) erros.nome = "Máximo de 100 caracteres.";
  if (!fusoValido(fuso)) erros.fuso = "Fuso horário inválido (ex.: America/Sao_Paulo).";

  const numeros = { capacidade: [1, 50], quartos: [0, 20], banheiros: [0, 20] } as const;
  const valores: Record<string, number | null> = {};
  for (const [campo, [min, max]] of Object.entries(numeros)) {
    const n = inteiroOpcional(texto(entrada[campo]), min, max);
    if (n === undefined) erros[campo as keyof DadosImovel] = `Número inteiro entre ${min} e ${max}.`;
    else valores[campo] = n;
  }

  const descricao = texto(entrada.descricao);
  if (descricao.length > 5000) erros.descricao = "Máximo de 5000 caracteres.";

  if (Object.keys(erros).length > 0) return { ok: false, erros };
  return {
    ok: true,
    dados: {
      codigo,
      nome,
      publico: marcado(entrada.publico),
      ativo: marcado(entrada.ativo),
      bairro: texto(entrada.bairro),
      cidade: texto(entrada.cidade) || "Rio de Janeiro",
      endereco: texto(entrada.endereco),
      fuso,
      capacidade: valores.capacidade,
      quartos: valores.quartos,
      banheiros: valores.banheiros,
      descricao,
    },
  };
}
