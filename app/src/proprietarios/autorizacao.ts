/**
 * Autorização dos proprietários nos formulários de "Anuncie seu imóvel" (M7.14, 15/10/2026; texto editável no M7.15).
 *
 * Os dois formulários públicos para proprietários — o pedido de contato para a gestão completa (M7.7) e o cadastro do
 * marketplace (M12.3) — têm uma caixa obrigatória de autorização do uso dos dados. Pela LGPD, quem prova o
 * consentimento é a empresa: cada envio guarda, na mesma linha e na mesma gravação, a data e a hora em que o envio com a
 * caixa marcada chegou ao servidor (relógio do servidor, igual à do envio; a hora do clique na caixa, no navegador, não é
 * registrada), a versão do texto e o texto exato da caixa, montado pelo servidor (nunca o que vem do navegador).
 *
 * Mudou em 15/10/2026 (M7.15). Antes: o texto de cada caixa era fixo aqui, com a versão controlada por um teste (texto
 * novo pedia versão nova no código). Depois: o texto é editado no painel (Configurações → Autorização dos proprietários)
 * e cada publicação vira uma versão numerada e datada, pelo motor de `configuracoes/documentos-versionados.ts` (o do
 * "Como funciona" e das páginas legais); a leitura e a publicação ficam em `configuracoes/autorizacao-proprietarios.ts`.
 * A versão 1 de cada caixa continua sendo o texto daqui (`TEXTOS_ORIGEM_AUTORIZACAO`), o mesmo que o M7.14 mostrou e
 * gravou como "versão 1": vale enquanto nada for publicado no painel, sem migração nem data inventada, e a primeira
 * publicação é a versão 2 — nunca há duas "versão 1" diferentes. Motivo: "Tudo editável pelo painel" (Diego, 24/09), e
 * é dos textos que Diego deve querer mudar depois da conversa com o advogado. Objetivo: a prova do consentimento
 * continuar exata (versão e texto que a pessoa viu) com o texto nas mãos de Diego.
 *
 * O formulário mostra e o servidor grava a versão em vigor, lida de um lugar só; os envios antigos continuam com o texto
 * que valia, porque o registro leva o texto inteiro (nunca é reescrito). `{empresa}` no texto vira o nome da empresa de
 * Configurações → Empresa, lido de novo a cada página e a cada envio (como no M7.14: o nome não é congelado na versão, e
 * trocar o nome não cria versão; o texto gravado leva o nome daquele momento). O formulário manda só a marca do texto
 * que mostrou (campo escondido): se a versão em vigor ou o nome mudou depois que a página abriu, o servidor recusa e
 * devolve o texto novo, para a pessoa ler e marcar de novo — o registro é sempre do texto que ela viu.
 *
 * Não guarda IP nem navegador (pergunta para o advogado, no GUIA-DIEGO). Envios anteriores ao M7.14 ficam sem registro,
 * e o painel diz isso em vez de preencher com um palpite. O aviso não traz data: o registro começa quando a mudança
 * entra no ar, não no dia em que foi escrita (a primeira data real sai do banco, `min(autorizado_em)`).
 *
 * Módulo puro (sem banco): o formulário do site e o do painel, que rodam no navegador, também o importam.
 */

export const FORMULARIOS_PROPRIETARIO = ["contato", "cadastro"] as const;
export type FormularioProprietario = (typeof FORMULARIOS_PROPRIETARIO)[number];

/** Campo escondido do formulário com a marca do texto que a pessoa viu ao lado da caixa. */
export const CAMPO_AUTORIZACAO = "autorizacao";

/** Número da versão de origem: o texto do M7.14, que vale enquanto nada for publicado no painel. */
export const VERSAO_ORIGEM_AUTORIZACAO = 1;

/**
 * A versão 1 de cada caixa: o texto que o M7.14 mostrou e gravou como "versão 1". Fixo para sempre (o teste guarda):
 * mudá-lo aqui criaria duas "versão 1" diferentes. Texto novo se publica no painel, como versão nova.
 */
export const TEXTOS_ORIGEM_AUTORIZACAO: Readonly<Record<FormularioProprietario, string>> = Object.freeze({
  contato: "Autorizo o uso destes dados só para a {empresa} me responder sobre a gestão do imóvel.",
  cadastro: "Autorizo a equipe a usar estes dados para analisar o cadastro e entrar em contato comigo.",
});

/** Único marcador do texto: vira o nome da empresa. */
export const MARCADOR_EMPRESA = "{empresa}";
/** Tamanho máximo do texto de uma caixa (com o marcador, antes de virar o nome). */
export const LIMITE_TEXTO_AUTORIZACAO = 500;

/** O texto como aparece ao lado da caixa, a versão dele e a marca que o formulário devolve no envio. */
export type TextoAutorizacao = { versao: number; texto: string; marca: string };

/** Impressão curta do texto (FNV-1a de 32 bits): igual no navegador e no servidor, sem biblioteca. */
function impressao(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** `{empresa}` vira o nome da empresa; sem nome cadastrado, a frase continua legível ("para a empresa me responder"). */
export const preencherEmpresaNaAutorizacao = (modelo: string, empresa: string): string => modelo.replaceAll(MARCADOR_EMPRESA, empresa.trim() || "empresa");

/** O texto de uma versão como aparece ao lado da caixa, com o nome da empresa, e a marca dele. */
export function montarAutorizacao(versao: number, modelo: string, empresa: string): TextoAutorizacao {
  const texto = preencherEmpresaNaAutorizacao(modelo, empresa);
  return { versao, texto, marca: `v${versao}.${impressao(texto)}` };
}

/** O texto da versão de origem (1) da caixa, com o nome da empresa: o que vale enquanto nada for publicado no painel. */
export const autorizacaoDeOrigem = (formulario: FormularioProprietario, empresa: string): TextoAutorizacao =>
  montarAutorizacao(VERSAO_ORIGEM_AUTORIZACAO, TEXTOS_ORIGEM_AUTORIZACAO[formulario], empresa);

/** Caracteres de controle e invisíveis (inclusive os que invertem a direção do texto): o que se vê seria outro texto. */
const INVISIVEIS = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;

export const ERROS_TEXTO_AUTORIZACAO = {
  vazio: "Escreva o texto da caixa: ela é obrigatória (é a autorização que a LGPD pede) e não pode ficar vazia.",
  linhas: "Escreva o texto numa linha só: ao lado da caixa ele aparece corrido, sem quebra de linha.",
  invisivel: "O texto tem um caractere invisível ou de controle (comum ao colar de outro programa). Apague o trecho colado e digite de novo.",
  marcacao: "O texto é puro: sem os sinais < e > (marcação de página não funciona aqui e apareceria como está).",
  chaves: "Use chaves só no marcador {empresa}, que vira o nome da empresa. Não há outros marcadores neste texto.",
} as const;

/**
 * Confere o texto de uma caixa antes de publicar (no painel, enquanto se digita, e de novo no servidor). As pontas sem
 * espaço e espaços seguidos viram um só (é como a página mostra); vazio, quebra de linha, caractere invisível, `<`/`>`,
 * chave fora do `{empresa}` e mais de `LIMITE_TEXTO_AUTORIZACAO` caracteres são recusados com o motivo.
 */
export function validarTextoAutorizacao(bruto: unknown): { ok: true; texto: string } | { ok: false; erro: string } {
  const t = (typeof bruto === "string" ? bruto : "").replace(/\r\n?/g, "\n").trim().replace(/[ \t]+/g, " ");
  if (!t) return { ok: false, erro: ERROS_TEXTO_AUTORIZACAO.vazio };
  if (t.length > LIMITE_TEXTO_AUTORIZACAO) return { ok: false, erro: `Máximo de ${LIMITE_TEXTO_AUTORIZACAO} caracteres (o texto tem ${t.length}).` };
  if (t.includes("\n")) return { ok: false, erro: ERROS_TEXTO_AUTORIZACAO.linhas };
  if (INVISIVEIS.test(t)) return { ok: false, erro: ERROS_TEXTO_AUTORIZACAO.invisivel };
  if (/[<>]/.test(t)) return { ok: false, erro: ERROS_TEXTO_AUTORIZACAO.marcacao };
  if (/[{}]/.test(t.replaceAll(MARCADOR_EMPRESA, ""))) return { ok: false, erro: ERROS_TEXTO_AUTORIZACAO.chaves };
  return { ok: true, texto: t };
}

/** A marca que o formulário mandou (campo escondido), limpa e com tamanho limitado; ausente vira vazio (não confere). */
export function marcaDoFormulario(e: Record<string, unknown>): string {
  const v = e[CAMPO_AUTORIZACAO];
  return typeof v === "string" ? v.trim().slice(0, 64) : "";
}

export const ERRO_AUTORIZACAO_MUDOU = "O texto da autorização mudou depois que a página abriu. Leia o texto ao lado da caixa e marque de novo.";

/** Colunas do registro em cada envio (pedido de contato e cadastro do marketplace). */
export type RegistroAutorizacao = { autorizadoEm: Date | null; autorizacaoVersao: number | null; autorizacaoTexto: string | null };

/** O que o painel mostra para envio sem registro: só os anteriores ao M7.14 (o banco exige os três juntos). Sem data fixa. */
export const SEM_REGISTRO_AUTORIZACAO = "Sem registro: enviado antes de o sistema passar a guardar a autorização. A caixa já era obrigatória.";

/** O registro de um envio, ou null quando não há (nunca completado com um palpite). */
export function lerRegistroAutorizacao(r: RegistroAutorizacao): { em: Date; versao: number; texto: string } | null {
  if (!r.autorizadoEm || !r.autorizacaoVersao || !r.autorizacaoTexto) return null;
  return { em: r.autorizadoEm, versao: r.autorizacaoVersao, texto: r.autorizacaoTexto };
}
