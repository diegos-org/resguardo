/**
 * Autorização dos proprietários nos formulários de "Anuncie seu imóvel" (M7.14, 15/10/2026).
 *
 * Os dois formulários públicos para proprietários — o pedido de contato para a gestão completa (M7.7) e o cadastro do
 * marketplace (M12.3) — têm uma caixa obrigatória de autorização do uso dos dados. Pela LGPD, quem prova o
 * consentimento é a empresa: cada envio guarda, na mesma linha e na mesma gravação, a data e a hora, a versão do texto e
 * o texto exato da caixa, montado pelo servidor a partir desta definição (nunca o que vem do navegador).
 *
 * O texto de cada caixa vive só aqui: o formulário mostra e o servidor grava a partir da mesma definição. Texto novo é
 * versão nova (o teste guarda o texto de cada versão já usada); os envios antigos continuam com o texto que valia,
 * porque o registro leva o texto inteiro. No pedido de contato o texto tem o nome da empresa (Configurações → Empresa),
 * lido de novo no envio. O formulário manda só a marca do texto que mostrou (campo escondido): se o nome ou a versão
 * mudou depois que a página abriu, o servidor recusa e devolve o texto novo, para a pessoa ler e marcar de novo — o
 * registro é sempre do texto que ela viu.
 *
 * Não guarda IP nem navegador (pergunta para o advogado, no GUIA-DIEGO). Envios anteriores a este item ficam sem registro,
 * e o painel diz isso em vez de preencher com um palpite.
 *
 * Módulo puro (sem banco): o formulário do site, que roda no navegador, também o importa.
 */

export const FORMULARIOS_PROPRIETARIO = ["contato", "cadastro"] as const;
export type FormularioProprietario = (typeof FORMULARIOS_PROPRIETARIO)[number];

/** Campo escondido do formulário com a marca do texto que a pessoa viu ao lado da caixa. */
export const CAMPO_AUTORIZACAO = "autorizacao";

export type DefinicaoAutorizacao = { versao: number; modelo: string };

/**
 * O texto atual de cada caixa; `{empresa}` vira o nome da empresa. Mudou o texto? Suba a versão e acrescente o texto
 * novo na lista de versões do teste (`autorizacao.test.ts`), sem tirar as anteriores.
 */
export const TEXTOS_AUTORIZACAO: Record<FormularioProprietario, DefinicaoAutorizacao> = {
  contato: { versao: 1, modelo: "Autorizo o uso destes dados só para a {empresa} me responder sobre a gestão do imóvel." },
  cadastro: { versao: 1, modelo: "Autorizo a equipe a usar estes dados para analisar o cadastro e entrar em contato comigo." },
};

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

/** O texto atual da caixa do formulário, com o nome da empresa. */
export function textoDaAutorizacao(formulario: FormularioProprietario, empresa: string): TextoAutorizacao {
  const { versao, modelo } = TEXTOS_AUTORIZACAO[formulario];
  const texto = modelo.replaceAll("{empresa}", empresa.trim() || "empresa");
  return { versao, texto, marca: `v${versao}.${impressao(texto)}` };
}

/**
 * Confere, no servidor, se a marca enviada é a do texto atual. Sempre devolve o texto atual: é o que se grava (quando
 * confere) ou o que o formulário passa a mostrar (quando não confere).
 */
export function conferirAutorizacao(formulario: FormularioProprietario, empresa: string, marcaEnviada: string): { ok: boolean; autorizacao: TextoAutorizacao } {
  const autorizacao = textoDaAutorizacao(formulario, empresa);
  return { ok: marcaEnviada === autorizacao.marca, autorizacao };
}

/** A marca que o formulário mandou (campo escondido), limpa e com tamanho limitado; ausente vira vazio (não confere). */
export function marcaDoFormulario(e: Record<string, unknown>): string {
  const v = e[CAMPO_AUTORIZACAO];
  return typeof v === "string" ? v.trim().slice(0, 64) : "";
}

export const ERRO_AUTORIZACAO_MUDOU = "O texto da autorização mudou depois que a página abriu. Leia o texto ao lado da caixa e marque de novo.";

/** Colunas do registro em cada envio (pedido de contato e cadastro do marketplace). */
export type RegistroAutorizacao = { autorizadoEm: Date | null; autorizacaoVersao: number | null; autorizacaoTexto: string | null };

/** O que o painel mostra para envio sem registro: só os anteriores a este item (o banco exige os três juntos). */
export const SEM_REGISTRO_AUTORIZACAO = "Sem registro: enviado antes de o sistema guardar a autorização (mudança de 15/10/2026). A caixa já era obrigatória.";

/** O registro de um envio, ou null quando não há (nunca completado com um palpite). */
export function lerRegistroAutorizacao(r: RegistroAutorizacao): { em: Date; versao: number; texto: string } | null {
  if (!r.autorizadoEm || !r.autorizacaoVersao || !r.autorizacaoTexto) return null;
  return { em: r.autorizadoEm, versao: r.autorizacaoVersao, texto: r.autorizacaoTexto };
}
