/**
 * Páginas legais do site (M7.4): Termos de uso, Política de privacidade e Política de cancelamento. Cada uma é um
 * documento versionado (`documentos-versionados.ts`) com o texto editável no painel; esta parte é só regra pura —
 * sem banco —, para o painel, o site e os componentes do navegador usarem as mesmas funções.
 *
 * O texto é um campo longo: `## ` no começo da linha abre um título, linha em branco separa parágrafos e `- ` / `1. `
 * abrem itens de lista. `{{campo}}` vira um dado da empresa (Configurações → Empresa) ou, na Política de
 * cancelamento, o prazo do reembolso integral, que é um campo próprio da política (o texto e a devolução leem o mesmo
 * número). Os valores usados ficam congelados em cada versão: o que o hóspede leu e aceitou nunca muda.
 */
import type { ChaveConfig } from "./armazem";
import type { DefinicaoSecao } from "./documentos-versionados";
import type { DadosEmpresa } from "./empresa";

/** Os três documentos, nesta ordem — que é também a ordem das travas no pagamento. */
export const DOCUMENTOS_LEGAIS = ["termos", "privacidade", "cancelamento"] as const;
export type DocumentoLegal = (typeof DOCUMENTOS_LEGAIS)[number];
export type VersoesLegais = Record<DocumentoLegal, number>;
export type SecaoLegal = "resumo" | "texto";

const SECAO_TEXTO: DefinicaoSecao<SecaoLegal> = {
  chave: "texto",
  titulo: "Texto",
  limite: 30_000,
  dica: "Use ## no começo da linha para um título, linha em branco para um parágrafo, - ou 1. para listas e {{campo}} para os dados da empresa.",
};
const SECAO_RESUMO: DefinicaoSecao<SecaoLegal> = {
  chave: "resumo",
  titulo: "Resumo",
  limite: 2_000,
  dica: "Aparece junto da caixa de aceite, antes do pagamento, e no topo da página. Destaque o que limita direitos.",
};

/** Títulos fixos, rota pública, chave da configuração e seções de cada documento (só o cancelamento tem resumo). */
export const PAGINAS_LEGAIS: Record<DocumentoLegal, { titulo: string; curto: string; rota: string; chave: ChaveConfig; acaoAuditoria: string; secoes: readonly DefinicaoSecao<SecaoLegal>[] }> = {
  termos: { titulo: "Termos de uso", curto: "Termos", rota: "/termos", chave: "termos_uso", acaoAuditoria: "configuracao.termos_uso", secoes: [SECAO_TEXTO] },
  privacidade: { titulo: "Política de privacidade", curto: "Privacidade", rota: "/privacidade", chave: "politica_privacidade", acaoAuditoria: "configuracao.politica_privacidade", secoes: [SECAO_TEXTO] },
  cancelamento: { titulo: "Política de cancelamento", curto: "Cancelamento", rota: "/cancelamento", chave: "politica_cancelamento", acaoAuditoria: "configuracao.politica_cancelamento", secoes: [SECAO_RESUMO, SECAO_TEXTO] },
};

/** Campos `{{chave}}` que o texto pode usar. `so`: o campo só existe naquele documento. */
export const CAMPOS_LEGAIS = [
  { chave: "nome_empresa", rotulo: "Nome da empresa" },
  { chave: "razao_social", rotulo: "Razão social" },
  { chave: "cnpj", rotulo: "CNPJ" },
  { chave: "endereco", rotulo: "Endereço" },
  { chave: "email_contato", rotulo: "E-mail de contato" },
  { chave: "telefone_contato", rotulo: "Telefone / WhatsApp" },
  { chave: "encarregado", rotulo: "Encarregado pela proteção de dados" },
  { chave: "dias_reembolso_integral", rotulo: "Dias para o reembolso integral", so: "cancelamento" },
] as const;
export type CampoLegal = (typeof CAMPOS_LEGAIS)[number]["chave"];
export type RegrasCancelamento = { diasReembolsoIntegral: number };
export const DIAS_REEMBOLSO_MIN = 1;
export const DIAS_REEMBOLSO_MAX = 365;

const CAMPOS = new Map<string, (typeof CAMPOS_LEGAIS)[number]>(CAMPOS_LEGAIS.map((c) => [c.chave, c]));
const soDe = (c: (typeof CAMPOS_LEGAIS)[number]): DocumentoLegal | undefined => ("so" in c ? c.so : undefined);
const cabeNo = (c: (typeof CAMPOS_LEGAIS)[number], doc: DocumentoLegal) => !soDe(c) || soDe(c) === doc;
/** Marcador `{{campo}}` (numa linha só); o nome é lido sem os espaços das pontas. */
const MARCADOR = /\{\{(.*?)\}\}/g;

/** Rótulo de um campo para o painel (o nome cru se o campo não existe). */
export const rotuloDoCampo = (chave: string): string => CAMPOS.get(chave)?.rotulo ?? chave;

/** Valores disponíveis agora: os dados da empresa e, na Política de cancelamento, o prazo do formulário. Vazio fica de fora. */
export function valoresDisponiveis(
  empresa: Pick<DadosEmpresa, "nome" | "razaoSocial" | "cnpj" | "endereco" | "email" | "telefone" | "encarregado">,
  regras: RegrasCancelamento | null,
): Partial<Record<CampoLegal, string>> {
  const pares: [CampoLegal, string | undefined][] = [
    ["nome_empresa", empresa.nome],
    ["razao_social", empresa.razaoSocial],
    ["cnpj", empresa.cnpj],
    ["endereco", empresa.endereco],
    ["email_contato", empresa.email],
    ["telefone_contato", empresa.telefone],
    ["encarregado", empresa.encarregado],
    ["dias_reembolso_integral", regras ? String(regras.diasReembolsoIntegral) : undefined],
  ];
  return Object.fromEntries(pares.filter((p): p is [CampoLegal, string] => Boolean(p[1]?.trim())).map(([k, v]) => [k, v.trim()]));
}

export type ConferenciaCampos = {
  /** Campos que o texto usa e que valem neste documento, na ordem de `CAMPOS_LEGAIS`. */
  usados: CampoLegal[];
  /** `{{x}}` que não existe. */
  desconhecidos: string[];
  /** Campo de outro documento (o prazo do reembolso fora da Política de cancelamento). */
  foraDoLugar: CampoLegal[];
  /** Usados sem valor agora. */
  vazios: CampoLegal[];
  /** Só os valores dos campos usados — o que a versão congela. */
  valoresUsados: Partial<Record<CampoLegal, string>>;
  /** Campos que este documento pode usar (para a mensagem). */
  possiveis: CampoLegal[];
};

/** Confere os `{{campos}}` de todas as seções do documento contra os valores disponíveis. */
export function conferirCampos(doc: DocumentoLegal, secoes: Record<string, string>, valores: Partial<Record<CampoLegal, string>>): ConferenciaCampos {
  const usados = new Set<CampoLegal>();
  const desconhecidos = new Set<string>();
  const foraDoLugar = new Set<CampoLegal>();
  for (const s of PAGINAS_LEGAIS[doc].secoes) {
    for (const m of (secoes[s.chave] ?? "").matchAll(MARCADOR)) {
      const nome = m[1].trim();
      const campo = CAMPOS.get(nome);
      if (!campo) desconhecidos.add(nome);
      else if (!cabeNo(campo, doc)) foraDoLugar.add(campo.chave);
      else usados.add(campo.chave);
    }
  }
  const ordem = (lista: Set<CampoLegal>) => CAMPOS_LEGAIS.map((c) => c.chave).filter((k) => lista.has(k));
  const usadosEmOrdem = ordem(usados);
  const valor = (k: CampoLegal) => valores[k]?.trim() ?? "";
  return {
    usados: usadosEmOrdem,
    desconhecidos: [...desconhecidos],
    foraDoLugar: ordem(foraDoLugar),
    vazios: usadosEmOrdem.filter((k) => !valor(k)),
    valoresUsados: Object.fromEntries(usadosEmOrdem.filter((k) => valor(k)).map((k) => [k, valor(k)])),
    possiveis: CAMPOS_LEGAIS.filter((c) => cabeNo(c, doc)).map((c) => c.chave),
  };
}

/** Primeira letra minúscula, menos em sigla ("CNPJ" fica, "Razão social" vira "razão social"). */
export const noMeioDaFrase = (r: string) => (/^\p{Lu}[\p{Ll}-]/u.test(r) ? r[0].toLowerCase() + r.slice(1) : r);

/** O que impede publicar, em linguagem simples; null = os campos estão em ordem. */
export function mensagemDosCampos(c: ConferenciaCampos): string | null {
  const partes: string[] = [];
  if (c.desconhecidos.length) {
    const varios = c.desconhecidos.length > 1;
    partes.push(`O texto usa ${c.desconhecidos.map((x) => `{{${x}}}`).join(", ")}, que não existe${varios ? "m" : ""}. Campos possíveis: ${c.possiveis.map((k) => `{{${k}}}`).join(", ")}.`);
  }
  for (const k of c.foraDoLugar) {
    const doc = soDe(CAMPOS.get(k)!);
    partes.push(`{{${k}}} só pode ser usado na ${doc ? PAGINAS_LEGAIS[doc].titulo : "outro documento"}.`);
  }
  const daEmpresa = c.vazios.filter((k) => k !== "dias_reembolso_integral");
  if (daEmpresa.length) partes.push(`Preencha em Configurações → Empresa antes de publicar: ${daEmpresa.map((k) => noMeioDaFrase(rotuloDoCampo(k))).join(", ")}.`);
  if (c.vazios.includes("dias_reembolso_integral")) partes.push("Informe em quantos dias antes da entrada vale o reembolso integral.");
  return partes.length ? partes.join(" ") : null;
}

/** Recusa da Política de cancelamento que não mostra o prazo pelo campo (publicação e aviso do painel usam a mesma frase). */
export const MENSAGEM_SEM_PRAZO = "A política precisa mostrar o prazo do reembolso pelo campo {{dias_reembolso_integral}}, para o texto e a devolução nunca discordarem.";

/** `{{campo}}` → valor. `faltando` decide o que mostra um valor ausente (site: nada; prévia do painel: "[falta: CNPJ]"). */
export function preencherCampos(texto: string, valores: Partial<Record<CampoLegal, string>>, faltando?: (campo: string) => string): string {
  return texto.replace(MARCADOR, (_, nome: string) => {
    const k = nome.trim();
    const v = CAMPOS.has(k) ? valores[k as CampoLegal]?.trim() : undefined;
    return v || (faltando ? faltando(k) : "");
  });
}

export type Bloco = { tipo: "titulo"; texto: string } | { tipo: "paragrafo"; texto: string } | { tipo: "lista"; ordenada: boolean; inicio: number; itens: string[] };

/**
 * Blocos do texto para mostrar. Linha em branco separa trechos. Dentro de um trecho: linha com "## " é título; linhas
 * seguidas com "- " (ou "• ") formam uma lista; linhas seguidas com "1. " (ou "1) ") formam uma lista numerada, que
 * começa no primeiro número; as demais linhas seguidas formam um parágrafo (as quebras de linha ficam). Um título ou
 * uma troca de tipo fecha o bloco aberto.
 */
export function blocosDoDocumento(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  for (const trecho of texto.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    // Último bloco deste trecho, que ainda pode crescer com a linha seguinte do mesmo tipo.
    let aberto: Bloco | undefined;
    for (const bruta of trecho.split("\n")) {
      const linha = bruta.trim();
      if (!linha) continue;
      const titulo = /^##\s+(.+)$/.exec(linha);
      const item = /^[-•]\s+(.+)$/.exec(linha);
      const numerado = /^(\d{1,4})[.)]\s+(.+)$/.exec(linha);
      if (titulo) {
        blocos.push({ tipo: "titulo", texto: titulo[1].trim() });
        aberto = undefined;
      } else if (item) {
        if (aberto?.tipo === "lista" && !aberto.ordenada) aberto.itens.push(item[1]);
        else blocos.push((aberto = { tipo: "lista", ordenada: false, inicio: 1, itens: [item[1]] }));
      } else if (numerado) {
        if (aberto?.tipo === "lista" && aberto.ordenada) aberto.itens.push(numerado[2]);
        else blocos.push((aberto = { tipo: "lista", ordenada: true, inicio: Number(numerado[1]), itens: [numerado[2]] }));
      } else if (aberto?.tipo === "paragrafo") aberto.texto += `\n${linha}`;
      else blocos.push((aberto = { tipo: "paragrafo", texto: linha }));
    }
  }
  return blocos;
}

/**
 * Prazo do reembolso integral de uma reserva: o último dia é a data de entrada menos `dias` (datas do calendário, no
 * fuso do imóvel), até 23h59 desse dia. `hoje` depois dele = já não há reembolso integral pela política.
 */
export function prazoDoReembolso(checkin: string, dias: number, hoje: string): { tipo: "integral_ate"; data: string } | { tipo: "sem_reembolso"; dias: number } {
  const entrada = /^\d{4}-\d{2}-\d{2}$/.test(checkin) ? Date.parse(`${checkin}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(entrada) || !Number.isInteger(dias) || dias < 0) throw new Error("Data ou prazo inválido.");
  const data = new Date(entrada - dias * 86_400_000).toISOString().slice(0, 10);
  return hoje <= data ? { tipo: "integral_ate", data } : { tipo: "sem_reembolso", dias };
}

/** Texto de um campo do formulário: quebras do Windows viram `\n`, sem espaço nas pontas. */
const limpo = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");

/**
 * Lê o formulário do painel: todas as seções do documento escritas e dentro do limite; na Política de cancelamento,
 * o prazo do reembolso integral em dias inteiros, de 1 a 365.
 */
export function validarPaginaLegal(
  doc: DocumentoLegal,
  bruto: Record<string, unknown>,
): { ok: true; entrada: { secoes: Record<string, string>; diasReembolsoIntegral: number | null } } | { ok: false; erros: Record<string, string>; mensagem: string } {
  const secoes: Record<string, string> = {};
  const erros: Record<string, string> = {};
  for (const s of PAGINAS_LEGAIS[doc].secoes) {
    const v = limpo(bruto[s.chave]);
    if (!v) erros[s.chave] = "Escreva esta parte antes de publicar.";
    else if (v.length > s.limite) erros[s.chave] = `Máximo de ${s.limite} caracteres.`;
    secoes[s.chave] = v;
  }
  let dias: number | null = null;
  if (doc === "cancelamento") {
    const t = typeof bruto.diasReembolsoIntegral === "number" ? String(bruto.diasReembolsoIntegral) : limpo(bruto.diasReembolsoIntegral);
    const n = /^\d{1,3}$/.test(t) ? Number(t) : Number.NaN;
    if (n >= DIAS_REEMBOLSO_MIN && n <= DIAS_REEMBOLSO_MAX) dias = n;
    else erros.diasReembolsoIntegral = `Informe um número de dias entre ${DIAS_REEMBOLSO_MIN} e ${DIAS_REEMBOLSO_MAX}.`;
  }
  if (Object.keys(erros).length) return { ok: false, erros, mensagem: "Confira os campos destacados." };
  return { ok: true, entrada: { secoes, diasReembolsoIntegral: dias } };
}

/** O texto cita o Beds24? Só um aviso no painel (decisão de 7/10, M5.9: o hóspede não vê esse nome). */
export const citaBeds24 = (texto: string): boolean => /(?<![A-Za-z0-9_])beds24(?![A-Za-z0-9_])/i.test(texto);
