/**
 * O que uma rotina automática (as de `/api/cron`) e o aviso do Mercado Pago mandam ao Sentry (M0.9), num lugar só.
 *
 * O texto que essas partes montam pode levar dado do negócio que a limpeza de `./limpeza.ts` não reconhece: o nome de
 * um proprietário ou de uma empresa, o código de um imóvel, a mensagem crua de outro erro ou o valor que o Postgres
 * repete na mensagem de um erro de conversão. Por isso, delas, o Sentry nunca recebe a mensagem original:
 * - um `ErroDeRotina` leva o detalhe na mensagem (é o que `registrarExecucao` grava na página Sistema, como sempre) e,
 *   à parte, as falhas contadas por motivo, de uma lista fechada (`MOTIVOS_DE_FALHA`), e onde a equipe acha o detalhe,
 *   de outra lista fechada (`ONDE_FICA_O_DETALHE`); o Sentry recebe só essas contagens e esse lugar, com os textos fixos
 *   das listas;
 * - qualquer outro erro chega com um texto fixo no lugar da mensagem, mais o código técnico, quando há um (o do Postgres,
 *   como "22P02", ou o da rede, como "ECONNRESET");
 * - nos dois casos ficam o tipo do erro e a pilha (arquivo, função e linha), e a causa (o erro original) vai pela mesma
 *   regra, sem a mensagem dela.
 * Funções puras, sem o pacote do Sentry: quem envia é `avisarErroDoServidor` (`./aviso-do-servidor.ts`), e o envio ainda
 * passa pela limpeza.
 */

/** Motivos de falha das rotinas, com o texto que vai ao Sentry: uma lista fechada, sem espaço para texto livre. */
export const MOTIVOS_DE_FALHA = {
  antecipado_nao_gerado: "repasse(s) antecipado(s) não gerado(s)",
  email_nao_enviado: "e-mail(s) não enviado(s)",
  email_sem_confirmacao: "e-mail(s) sem confirmação do provedor",
  sem_provedor: "organização(ões) sem provedor de e-mail",
  erro_na_organizacao: "organização(ões) com erro inesperado",
  rotina_interrompida: "rotina interrompida no meio",
  configuracao: "falha de configuração ou de vínculo",
  rede: "falha de rede",
  tempo: "tempo esgotado",
  http: "recusa do serviço externo",
  formato: "resposta em formato inesperado",
  envio_incompleto: "envio incompleto",
  // Os tipos de falha do provedor de pagamento (`ErroProvedor`), no aviso do Mercado Pago.
  indisponivel: "serviço de pagamento fora do alcance",
  incerto: "resposta incerta do serviço de pagamento",
  credencial: "chave de acesso recusada ou inválida",
  limite: "limite de chamadas atingido",
  erro_inesperado: "erro inesperado",
} as const;

export type MotivoDeFalha = keyof typeof MOTIVOS_DE_FALHA;

/** Quantas falhas de cada motivo. */
export type FalhasDaRotina = Partial<Record<MotivoDeFalha, number>>;

/** Soma as contagens (só números inteiros positivos contam). */
export function totalDeFalhas(falhas: FalhasDaRotina): number {
  return Object.values(falhas).reduce<number>((t, n) => t + (Number.isInteger(n) && n! > 0 ? n! : 0), 0);
}

/** Junta as contagens de `mais` em `falhas` (mesmo objeto, para o agregador ir somando organização por organização). */
export function somarFalhas(falhas: FalhasDaRotina, mais: FalhasDaRotina): FalhasDaRotina {
  for (const [motivo, n] of Object.entries(mais) as [MotivoDeFalha, number][]) {
    if (Number.isInteger(n) && n > 0) falhas[motivo] = (falhas[motivo] ?? 0) + n;
  }
  return falhas;
}

/**
 * Onde a equipe acha o detalhe de uma falha, com o texto que fecha o resumo: também uma lista fechada. O padrão é a página
 * Sistema, onde `registrarExecucao` grava a mensagem do `ErroDeRotina`; quando a página Sistema só tem um texto fixo ou as
 * contagens e o detalhe fica em outro registro, o erro diz qual.
 */
export const ONDE_FICA_O_DETALHE = {
  sistema: "detalhe na página Sistema",
  integracoes: "detalhe em Configurações → Integrações, nas últimas importações do Beds24",
  mensagens: "detalhe em Configurações → Modelos de mensagem, na última execução de cada organização",
  sem_registro: "sem detalhe guardado: o aviso fica marcado como erro e a rotina dos pagamentos confere depois",
} as const;

export type OndeFicaODetalhe = keyof typeof ONDE_FICA_O_DETALHE;

/**
 * Erro de uma rotina automática (ou do aviso do Mercado Pago): a mensagem é o detalhe, que fica no registro local (a
 * página Sistema), e `falhas` e `detalheEm` são o que pode sair para o Sentry.
 */
export class ErroDeRotina extends Error {
  readonly falhas: FalhasDaRotina;
  readonly detalheEm: OndeFicaODetalhe;

  constructor(detalhe: string, falhas: FalhasDaRotina, opcoes?: ErrorOptions & { detalheEm?: OndeFicaODetalhe }) {
    super(detalhe, opcoes);
    this.name = "ErroDeRotina";
    this.falhas = { ...falhas };
    this.detalheEm = opcoes?.detalheEm && Object.hasOwn(ONDE_FICA_O_DETALHE, opcoes.detalheEm) ? opcoes.detalheEm : "sistema";
  }

  /** O resumo que vai ao Sentry: só as contagens e onde está o detalhe, com os textos fixos das duas listas. */
  get resumo(): string {
    const partes = (Object.keys(MOTIVOS_DE_FALHA) as MotivoDeFalha[]).flatMap((motivo) => {
      const n = this.falhas[motivo];
      return Number.isInteger(n) && n! > 0 ? [`${n} ${MOTIVOS_DE_FALHA[motivo]}`] : [];
    });
    return `${partes.length ? partes.join(", ") : "falha sem contagem"} (${ONDE_FICA_O_DETALHE[this.detalheEm]})`;
  }
}

/** Uma falha só, de um motivo: o caso das rotinas do Beds24, que param no primeiro erro, e do aviso do Mercado Pago. */
export function umaFalha(motivo: MotivoDeFalha): FalhasDaRotina {
  const falhas: FalhasDaRotina = {};
  falhas[motivo] = 1;
  return falhas;
}

/** O texto que entra no lugar da mensagem de um erro que não é um `ErroDeRotina`. */
export const MENSAGEM_OMITIDA = "mensagem omitida (pode ter dados pessoais)";

/** Até quantas causas encadeadas vão (o mesmo limite do Sentry). */
const CAUSAS_NO_MAXIMO = 5;
const RE_TIPO = /^[A-Za-z_$][\w$]{0,63}$/;
// Código técnico: o SQLSTATE do Postgres ("22P02", "23505") e os códigos da rede ("ECONNRESET", "UND_ERR_SOCKET").
const RE_CODIGO = /^[A-Z0-9_]{2,40}$/;
const RE_QUADRO_DA_PILHA = /^\s+at \S/;

/** O tipo do erro: o `name`, ou o nome da classe quando o `name` é o genérico "Error" (como no erro do Drizzle). */
function tipoDoErro(erro: unknown): string {
  if (!(erro instanceof Error)) return "Error";
  const classe = erro.constructor?.name;
  const nome = erro.name === "Error" && classe && classe !== "Error" ? classe : erro.name;
  return typeof nome === "string" && RE_TIPO.test(nome) ? nome : "Error";
}

function codigoDoErro(erro: unknown): string | null {
  const codigo = erro !== null && typeof erro === "object" ? (erro as { code?: unknown }).code : undefined;
  return typeof codigo === "string" && RE_CODIGO.test(codigo) ? codigo : null;
}

/** Só as linhas de quadro da pilha ("    at função (arquivo:linha:coluna)"), sem a mensagem que vem na primeira. */
function quadrosDaPilha(erro: Error): string[] {
  const pilha = typeof erro.stack === "string" ? erro.stack : "";
  const cabecalho = erro.message ? `${erro.name}: ${erro.message}` : erro.name;
  const resto = pilha.startsWith(cabecalho) ? pilha.slice(cabecalho.length) : pilha;
  return resto.split("\n").filter((linha) => RE_QUADRO_DA_PILHA.test(linha));
}

/**
 * O erro que vai ao Sentry no lugar de `erro`: o tipo, a pilha e, como mensagem, o resumo de um `ErroDeRotina` ou o
 * texto fixo (`MENSAGEM_OMITIDA`, com o código técnico quando há). A causa segue pela mesma regra.
 */
export function erroParaOAviso(erro: unknown, profundidade = 0): Error {
  const codigo = codigoDoErro(erro);
  const mensagem = erro instanceof ErroDeRotina ? erro.resumo : `${MENSAGEM_OMITIDA}${codigo ? `; código ${codigo}` : ""}`;
  const causa = erro instanceof Error && erro.cause !== undefined && erro.cause !== null && profundidade < CAUSAS_NO_MAXIMO ? erroParaOAviso(erro.cause, profundidade + 1) : undefined;
  const seguro = causa ? new Error(mensagem, { cause: causa }) : new Error(mensagem);
  seguro.name = tipoDoErro(erro);
  const quadros = erro instanceof Error ? quadrosDaPilha(erro) : [];
  seguro.stack = [`${seguro.name}: ${mensagem}`, ...quadros].join("\n");
  return seguro;
}
