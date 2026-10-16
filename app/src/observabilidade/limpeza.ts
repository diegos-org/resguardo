/**
 * Limpeza dos avisos de erro antes de saírem para o Sentry (M0.9). Diego autorizou ligar o Sentry em 16/10/2026 com a
 * condição de não mandar nome, e-mail nem dado de pagamento: tudo o que sai passa por aqui, no navegador e no servidor
 * (`beforeSend` e `beforeBreadcrumb`, em `./sentry.ts`). Funções puras, sem rede e sem o pacote do Sentry.
 *
 * O que fica: a mensagem técnica, o tipo do erro, a pilha (arquivo, função, linha) e o navegador (User-Agent).
 * O que sai: a pessoa (`user`, onde o Sentry poria o IP), cookies, cabeçalhos (menos o User-Agent), corpo e consulta
 * das requisições, os parâmetros de busca dos endereços e os rastros do console. O que é trocado por marcador, em
 * qualquer texto: e-mail, CPF, CNPJ, telefone, cartão, endereço IP, UUID (pode ser chave Pix aleatória; os ids do
 * sistema também são UUID e viram "[id]" do mesmo jeito: não dá para distinguir um do outro), código da cotação, código
 * do Pix copia e cola, segredos ("Bearer …", "access_token=…", tokens), credenciais dentro de endereços e os valores das
 * consultas ao banco. Nos endereços, o código da cotação em /reservar/<código>, o token do convite em
 * /convite/<token> e qualquer pedaço longo com cara de token.
 *
 * Números soltos, sem pontuação, só viram marcador quando têm a forma de um dado pessoal (ver `marcarNumeroSolto`). Um
 * nome não tem forma reconhecível: a proteção contra ele é não deixá-lo entrar (a pessoa, os corpos das requisições,
 * os valores das consultas e as variáveis locais saem antes; campos chamados "nome…", "email…" etc. saem inteiros).
 */
import type { Breadcrumb, ErrorEvent, StackFrame } from "@sentry/nextjs";

export const MARCADORES = {
  email: "[e-mail]",
  cpf: "[CPF]",
  cnpj: "[CNPJ]",
  telefone: "[telefone]",
  cartao: "[cartão]",
  id: "[id]",
  codigoCotacao: "[código]",
  convite: "[convite]",
  token: "[token]",
  segredo: "[segredo]",
  credenciais: "[credenciais]",
  pix: "[código Pix]",
  ip: "[IP]",
  valor: "[valor]",
  omitido: "[omitido]",
} as const;

// Limites de "palavra" que valem para letras acentuadas e dígitos: um número só é trocado quando está solto (não faz
// parte de um hash como "a1234567890b", nem de um id de rastreio do próprio Sentry).
const ANTES = "(?<![\\p{L}\\p{N}_])";
const DEPOIS = "(?![\\p{L}\\p{N}_])";
const solto = (miolo: string, flags = "gu") => new RegExp(`${ANTES}(?:${miolo})${DEPOIS}`, flags);

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const RE_UUID = new RegExp(`(?<![\\p{L}\\p{N}_-])${UUID}(?![\\p{L}\\p{N}_-])`, "gu");
const RE_UUID_INTEIRO = new RegExp(`^${UUID}$`);
const RE_EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const RE_COTACAO = solto("COT-[A-Z0-9]{8}");
// CNPJ com pontuação, numérico ou no formato alfanumérico novo (AA.AAA.AAA/AAAA-DD).
const RE_CNPJ_FORMATADO = solto("[A-Za-z0-9]{2}\\.[A-Za-z0-9]{3}\\.[A-Za-z0-9]{3}/[A-Za-z0-9]{4}-\\d{2}");
const RE_CPF_FORMATADO = solto("\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}");
const RE_TELEFONE_FORMATADO = solto(
  [
    "(?:\\+\\s?55[\\s.-]?)?\\(\\d{2}\\)\\s?9?\\d{4}[\\s.-]?\\d{4}", // (21) 99999-9999, +55 (21) 2222-3333
    "\\+\\s?55[\\s.-]?\\d{2}[\\s.-]?9?\\d{4}[\\s.-]?\\d{4}", // +55 21 99999-9999
    "\\d{2}[\\s.]9?\\d{4}-\\d{4}", // 21 99999-9999
    "9\\d{4}-\\d{4}", // 99999-9999
    "[2-5]\\d{3}-\\d{4}", // 2222-3333
  ].join("|"),
);
const RE_CARTAO_FORMATADO = solto("\\d{4}([ -])\\d{4}\\1\\d{4}\\1\\d{1,7}|\\d{4}[ -]\\d{6}[ -]\\d{5}");
const RE_DIGITOS = solto("\\d{10,19}");
// Endereço IP (v4, e v6 completo ou abreviado com "::"; um horário como 12:00:00 não tem a forma de nenhum dos dois).
const OCTETO = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const RE_IPV4 = new RegExp(`(?<![\\p{N}.])(?:${OCTETO}\\.){3}${OCTETO}(?![\\p{N}.])`, "gu");
const RE_IPV6 = /(?<![\p{L}\p{N}_:.])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?)(?![\p{L}\p{N}_:])/giu;
// Código do Pix copia e cola (BR Code): começa em 000201 e termina no CRC (6304 + 4 caracteres).
const RE_PIX_COPIA_E_COLA = /000201[\s\S]{20,600}?6304[0-9A-Fa-f]{4}/g;

// O valor precisa ter maiúscula, dígito ou sinal (não é uma palavra comum, como em "Basic authentication").
const RE_ESQUEMA_AUTORIZACAO = /\b(Bearer|Basic)\s+(?!\[)(?=[A-Za-z0-9._~+/=-]*[A-Z0-9._~+/=-])[A-Za-z0-9._~+/=-]{8,}/g;
const RE_CHAVE_VALOR_SECRETA =
  /\b(access_token|refresh_token|id_token|client_secret|api[_-]?key|apikey|token|secret|senha|password|passwd|signature|assinatura)(["']?\s*[:=]\s*["']?)(?!\[)[^\s&"',;)}\]]+/gi;
// JWT e os tokens assinados do sistema (base64url de um JSON: começam por "eyJ").
const RE_TOKEN_JSON = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)*/g;
// Chaves do Mercado Pago (APP_USR-… e TEST-…).
const RE_CHAVE_MERCADO_PAGO = /\b(?:APP_USR|TEST)-[A-Za-z0-9-]{20,}/g;
// Valores de uma consulta ao banco: o Drizzle põe os parâmetros na mensagem ("Failed query: … params: …"), e o
// Postgres, no detalhe ("Key (email)=(…)").
const RE_PARAMETROS_DA_CONSULTA = /\bparams:[\s\S]*$/;
const RE_VALOR_DA_CHAVE = /\(([^()]*)\)=\((?!\[valor\]\))[^()]*\)/g;

// Endereços dentro de um texto: com esquema (https://, postgresql://, webpack-internal://) ou um caminho solto que
// começa por "/" (como "GET /reservar/COT-…").
const RE_ENDERECO_NO_TEXTO = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]*|(?<![\p{L}\p{N}_.~/-])\/[^\s"'<>()]*/giu;

const soDigitos = (s: string) => s.replace(/\D/g, "");

/** Dígitos verificadores do CPF (11 dígitos, não todos iguais). */
export function cpfValido(numero: string): boolean {
  const d = soDigitos(numero);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** Dígitos verificadores do CNPJ numérico (14 dígitos, não todos iguais). */
export function cnpjValido(numero: string): boolean {
  const d = soDigitos(numero);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/** Conferência de Luhn, a dos números de cartão. */
export function luhnValido(numero: string): boolean {
  const d = soDigitos(numero);
  let soma = 0;
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    soma += x;
  }
  return d.length > 0 && soma % 10 === 0;
}

const celular = (d: string) => /^[1-9]{2}9\d{8}$/.test(d);
const fixo = (d: string) => /^[1-9]{2}[2-5]\d{7}$/.test(d);

/**
 * Número solto, sem pontuação: só vira marcador quando tem a forma de um dado pessoal (CPF ou CNPJ com os dígitos
 * verificadores certos, celular ou fixo com DDD, cartão pela conta de Luhn). Os outros números (ids de pagamento,
 * valores em centavos) ficam, para a equipe achar o registro.
 */
function marcarNumeroSolto(d: string): string {
  const tamanho = d.length;
  if (tamanho === 11 && cpfValido(d)) return MARCADORES.cpf;
  if (tamanho === 11 && celular(d)) return MARCADORES.telefone;
  if (tamanho === 10 && fixo(d)) return MARCADORES.telefone;
  if ((tamanho === 12 || tamanho === 13) && d.startsWith("55") && (celular(d.slice(2)) || fixo(d.slice(2)))) return MARCADORES.telefone;
  if (tamanho === 14 && cnpjValido(d)) return MARCADORES.cnpj;
  if (tamanho >= 13 && luhnValido(d)) return MARCADORES.cartao;
  return d;
}

/** Troca os dados pessoais e os segredos de um texto, sem mexer nos endereços (ver `limparTexto`). */
function limparDados(texto: string): string {
  return texto
    .replace(RE_ESQUEMA_AUTORIZACAO, (_, esquema: string) => `${esquema} ${MARCADORES.segredo}`)
    .replace(RE_CHAVE_VALOR_SECRETA, (_, chave: string, separador: string) => `${chave}${separador}${MARCADORES.segredo}`)
    .replace(RE_TOKEN_JSON, MARCADORES.segredo)
    .replace(RE_CHAVE_MERCADO_PAGO, MARCADORES.segredo)
    .replace(RE_PARAMETROS_DA_CONSULTA, "params: [omitidos]")
    .replace(RE_VALOR_DA_CHAVE, (_, chave: string) => `(${chave})=(${MARCADORES.valor})`)
    .replace(RE_PIX_COPIA_E_COLA, MARCADORES.pix)
    .replace(RE_EMAIL, MARCADORES.email)
    .replace(RE_UUID, MARCADORES.id)
    .replace(RE_COTACAO, MARCADORES.codigoCotacao)
    .replace(RE_CNPJ_FORMATADO, MARCADORES.cnpj)
    .replace(RE_CPF_FORMATADO, MARCADORES.cpf)
    .replace(RE_IPV6, MARCADORES.ip)
    .replace(RE_IPV4, MARCADORES.ip)
    .replace(RE_CARTAO_FORMATADO, MARCADORES.cartao)
    .replace(RE_TELEFONE_FORMATADO, MARCADORES.telefone)
    .replace(RE_DIGITOS, marcarNumeroSolto);
}

/** Um pedaço do caminho de um endereço. `anterior` é o pedaço logo antes (para /reservar/<código> e /convite/<token>). */
function limparSegmento(segmento: string, anterior: string | undefined): string {
  if (!segmento) return segmento;
  // Marcador de rota do Next ("[codigo]", "%5Bcodigo%5D") ou um marcador nosso: fica (é o caminho no código).
  if (/^(\[|%5B)/i.test(segmento)) return segmento;
  const antes = anterior?.toLowerCase();
  if (antes === "reservar") return MARCADORES.codigoCotacao;
  if (antes === "convite") return MARCADORES.convite;
  if (RE_UUID_INTEIRO.test(segmento)) return MARCADORES.id;
  if (segmento.includes("@") || /%40/i.test(segmento)) return MARCADORES.email;
  if (/^[A-Za-z0-9_-]{20,}$/.test(segmento) && /\d/.test(segmento) && /[A-Za-z]/.test(segmento)) return MARCADORES.token;
  return limparDados(segmento);
}

/**
 * Endereço limpo: sem a consulta (?…) nem o fragmento (#…), sem credenciais (usuário:senha@) e com os pedaços pessoais
 * do caminho trocados por marcadores. Serve para URL completa, caminho solto ou nome de arquivo da pilha.
 */
export function limparEndereco(endereco: string): string {
  const partes = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)?([^?#]*)/i.exec(endereco);
  const origem = (partes?.[1] ?? "").replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, `$1${MARCADORES.credenciais}@`);
  const segmentos = (partes?.[2] ?? "").split("/");
  return origem + segmentos.map((s, i) => limparSegmento(s, segmentos[i - 1])).join("/");
}

/** Texto limpo: endereços pela regra dos endereços e o resto pela regra dos dados pessoais e segredos. */
export function limparTexto(texto: string): string {
  return limparDados(texto.replace(RE_ENDERECO_NO_TEXTO, (endereco) => limparEndereco(endereco)));
}

// Nomes de campo cujo valor nunca sai, seja qual for (em extra, contexts, dados dos rastros).
const RE_CAMPO_PESSOAL = /e-?mail|cpf|cnpj|telefone|celular|whats|phone|nome|senha|password|passwd|token|secret|segredo|cookie|authorization|pix(?!el)|cart[aã]o|card|documento|endere[cç]o|address/i;
const PROFUNDIDADE_MAXIMA = 8;

/** Qualquer valor (texto, lista, objeto): textos limpos e campos pessoais omitidos, por inteiro. */
export function limparValor(valor: unknown, profundidade = 0): unknown {
  if (typeof valor === "string") return limparTexto(valor);
  if (valor === null || typeof valor !== "object") return valor;
  if (profundidade >= PROFUNDIDADE_MAXIMA) return MARCADORES.omitido;
  if (Array.isArray(valor)) return valor.map((v) => limparValor(v, profundidade + 1));
  return Object.fromEntries(
    Object.entries(valor as Record<string, unknown>).map(([chave, v]) => [chave, RE_CAMPO_PESSOAL.test(chave) ? MARCADORES.omitido : limparValor(v, profundidade + 1)]),
  );
}

function limparQuadros(quadros: StackFrame[] | undefined): StackFrame[] | undefined {
  return quadros?.map((q) => {
    const limpo = { ...q };
    delete limpo.vars; // variáveis locais nunca saem
    if (limpo.filename) limpo.filename = limparEndereco(limpo.filename);
    if (limpo.abs_path) limpo.abs_path = limparEndereco(limpo.abs_path);
    if (limpo.context_line) limpo.context_line = limparTexto(limpo.context_line);
    if (limpo.pre_context) limpo.pre_context = limpo.pre_context.map(limparTexto);
    if (limpo.post_context) limpo.post_context = limpo.post_context.map(limparTexto);
    return limpo;
  });
}

const CATEGORIAS_DE_REQUISICAO = new Set(["fetch", "xhr", "http"]);

/**
 * Rastro (o que aconteceu antes do erro) limpo, ou `null` para descartá-lo: os do console nunca saem (podem ter
 * qualquer coisa que o código escreveu), e os de requisição (fetch, xhr, http) com corpo também não; os outros saem
 * só com o método, a situação e o endereço limpo.
 */
export function limparRastro(rastro: Breadcrumb): Breadcrumb | null {
  const categoria = rastro.category ?? "";
  if (categoria === "console") return null;
  const limpo: Breadcrumb = { ...rastro };
  if (typeof limpo.message === "string") {
    // Nos cliques, o Sentry descreve o elemento; os atributos ([title="…"], [aria-label="…"]) podem ter um nome.
    limpo.message = limparTexto(categoria.startsWith("ui.") ? limpo.message.replace(/\[[^\]]*\]/g, "") : limpo.message);
  }
  if (CATEGORIAS_DE_REQUISICAO.has(categoria) || rastro.type === "http") {
    const dados = (rastro.data ?? {}) as Record<string, unknown>;
    if (Object.keys(dados).some((k) => /body|corpo|payload/i.test(k) && !/size/i.test(k))) return null;
    const so: Record<string, unknown> = {};
    if (typeof dados.method === "string") so.method = dados.method;
    if (typeof dados.status_code === "number") so.status_code = dados.status_code;
    if (typeof dados.url === "string") so.url = limparEndereco(dados.url);
    limpo.data = so;
    return limpo;
  }
  if (categoria === "navigation" && rastro.data) {
    const dados = rastro.data as Record<string, unknown>;
    limpo.data = {
      ...(typeof dados.from === "string" ? { from: limparEndereco(dados.from) } : {}),
      ...(typeof dados.to === "string" ? { to: limparEndereco(dados.to) } : {}),
    };
    return limpo;
  }
  if (rastro.data) limpo.data = limparValor(rastro.data) as Breadcrumb["data"];
  return limpo;
}

/** Só o navegador fica dos cabeçalhos (para o Sentry mostrar navegador, sistema e aparelho). */
function soUserAgent(cabecalhos: Record<string, string> | undefined): Record<string, string> | undefined {
  const par = Object.entries(cabecalhos ?? {}).find(([k]) => k.toLowerCase() === "user-agent");
  return par ? { [par[0]]: par[1] } : undefined;
}

/**
 * Aviso de erro limpo, pronto para sair. A mensagem técnica, o tipo e a pilha ficam (o que a equipe precisa para
 * corrigir), sem os dados pessoais; a pessoa, os cookies, os cabeçalhos (menos o navegador) e os dados da requisição
 * saem. O rastreio do próprio Sentry (`contexts.trace`) fica como está: são ids técnicos dele.
 */
export function limparEvento(evento: ErrorEvent): ErrorEvent {
  const limpo: ErrorEvent = { ...evento };
  delete limpo.user;
  if (limpo.request) {
    const { url, method, headers } = limpo.request;
    const userAgent = soUserAgent(headers);
    limpo.request = {
      ...(url ? { url: limparEndereco(url) } : {}),
      ...(method ? { method } : {}),
      ...(userAgent ? { headers: userAgent } : {}),
    };
  }
  if (typeof limpo.message === "string") limpo.message = limparTexto(limpo.message);
  if (limpo.logentry) {
    limpo.logentry = {
      ...limpo.logentry,
      ...(typeof limpo.logentry.message === "string" ? { message: limparTexto(limpo.logentry.message) } : {}),
      ...(limpo.logentry.params ? { params: limparValor(limpo.logentry.params) as unknown[] } : {}),
    };
  }
  if (typeof limpo.transaction === "string") limpo.transaction = limparTexto(limpo.transaction);
  if (limpo.exception?.values) {
    limpo.exception = {
      ...limpo.exception,
      values: limpo.exception.values.map((e) => ({
        ...e,
        ...(typeof e.value === "string" ? { value: limparTexto(e.value) } : {}),
        ...(e.stacktrace ? { stacktrace: { ...e.stacktrace, frames: limparQuadros(e.stacktrace.frames) } } : {}),
        ...(e.mechanism?.data ? { mechanism: { ...e.mechanism, data: limparValor(e.mechanism.data) as Record<string, string | boolean> } } : {}),
      })),
    };
  }
  if (limpo.threads?.values) {
    limpo.threads = {
      ...limpo.threads,
      values: limpo.threads.values.map((t) => (t.stacktrace ? { ...t, stacktrace: { ...t.stacktrace, frames: limparQuadros(t.stacktrace.frames) } } : t)),
    };
  }
  if (limpo.extra) limpo.extra = limparValor(limpo.extra) as ErrorEvent["extra"];
  if (limpo.tags) limpo.tags = limparValor(limpo.tags) as ErrorEvent["tags"];
  if (limpo.contexts) {
    limpo.contexts = Object.fromEntries(
      Object.entries(limpo.contexts).map(([nome, contexto]) => [nome, nome === "trace" ? contexto : limparValor(contexto)]),
    ) as ErrorEvent["contexts"];
  }
  if (limpo.breadcrumbs) limpo.breadcrumbs = limpo.breadcrumbs.map(limparRastro).filter((r): r is Breadcrumb => r !== null);
  return limpo;
}
