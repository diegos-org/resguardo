/**
 * Recebimento do WhatsApp (M10.1a, desenho em `requisitos/product/WHATSAPP.md`): as listas fechadas e os limites, sem
 * banco, sem rede e sem relógio. As cinco tabelas da migração 0073 guardam estes valores como texto sem CHECK (como as do
 * M8.2 e do M8.3); o `db/schema.ts` importa daqui só os tipos. O parser puro (`whatsapp/aviso.ts`) também lê daqui, por
 * isso nada neste arquivo importa banco ou configuração.
 *
 * Nada disto fala com a Meta: o M10.1a só recebe avisos assinados. Nenhum dado pessoal (telefone, wa_id, BSUID, wamid,
 * texto, nome) entra numa lista ou num contador: eles só ficam em `whatsapp_contatos` e `whatsapp_mensagens`.
 */

// ---------------------------------------------------------------- campos e mensagens

/** Os cinco campos do aviso que o app assina na Meta. */
export const CAMPOS_AVISO = ["messages", "smb_message_echoes", "history", "smb_app_state_sync", "account_update"] as const;
export type CampoAviso = (typeof CAMPOS_AVISO)[number];

/** `enviada_celular`: a resposta pelo WhatsApp Business do celular (coexistência). `enviada_painel` só no M10.2. */
export const DIRECOES = ["recebida", "enviada_celular", "enviada_painel"] as const;
export type Direcao = (typeof DIRECOES)[number];

export const ORIGENS = ["tempo_real", "historico"] as const;
export type Origem = (typeof ORIGENS)[number];

/**
 * Tipo da linha. Mídia, localização e contato compartilhado guardam só o tipo (e o mime): a tela mostra "ver no celular".
 * `pendente`: edição ou apagamento que chegou antes da original. `midia_pendente`: o `media_placeholder` do histórico.
 */
export const TIPOS_MENSAGEM = [
  "texto", "imagem", "audio", "video", "documento", "figurinha", "localizacao", "contato",
  "nao_suportada", "sistema", "outro", "pendente", "midia_pendente",
] as const;
export type TipoMensagem = (typeof TIPOS_MENSAGEM)[number];

/** Tipos que o conteúdo verdadeiro, quando chegar no mesmo wamid, substitui. */
export const TIPOS_PROVISORIOS = ["pendente", "midia_pendente", "nao_suportada"] as const satisfies readonly TipoMensagem[];

/**
 * Precedência do conteúdo no mesmo wamid (gravação, passo 3): `pendente` 0; os outros de `TIPOS_PROVISORIOS` 1;
 * conteúdo 2. Só sobe de posto, nunca desce. A gravação escreve a mesma regra em SQL.
 */
export const POSTO_DO_TIPO = (t: TipoMensagem) => (t === "pendente" ? 0 : (TIPOS_PROVISORIOS as readonly TipoMensagem[]).includes(t) ? 1 : 2);

/** unsupported.type que é um evento sobre outra mensagem (o id é o do evento, não o da mensagem afetada): não vira linha. */
export const UNSUPPORTED_SEM_LINHA = ["edit", "reaction", "pin", "keep_in_chat", "poll_update"] as const;

// ---------------------------------------------------------------- conta (account_update) e sincronização

export const SITUACOES_CONTA = ["nao_conectada", "conectada", "aguardando_reconexao", "desconectada", "suspensa"] as const;
export type SituacaoConta = (typeof SITUACOES_CONTA)[number];

/** Contatos da agenda e histórico do celular. "pedida" só o M10.1b grava. */
export const SINCRONIZACOES = ["nao_pedida", "pedida", "recebendo", "concluida", "recusada"] as const;
export type Sincronizacao = (typeof SINCRONIZACOES)[number];

export const EVENTOS_CONTA = [
  "PARTNER_ADDED", "PARTNER_REMOVED", "ACCOUNT_OFFBOARDED", "ACCOUNT_RECONNECTED", "ACCOUNT_DELETED",
  "PARTNER_APP_UNINSTALLED", "DISABLED_UPDATE", "ACCOUNT_RESTRICTION", "ACCOUNT_VIOLATION",
] as const;
export type EventoConta = (typeof EVENTOS_CONTA)[number];

/** Eventos documentados na referência de account_update (atualizada em 2/10/2026) que não mudam nada aqui: ignorados, não "não reconhecidos". */
export const EVENTOS_CONTA_SEM_EFEITO = [
  "PARTNER_APP_INSTALLED", "AD_ACCOUNT_LINKED", "AUTH_INTL_PRICE_ELIGIBILITY_UPDATE", "BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE",
  "MM_LITE_TERMS_SIGNED", "PARTNER_CLIENT_CERTIFICATION_STATUS_UPDATE", "VOLUME_BASED_PRICING_TIER_UPDATE",
] as const;

/**
 * Eventos de conta que podem mandar e-mail (superconjunto). Quem decide é `efeitoDoEvento` (whatsapp/situacao.ts), e só
 * para o evento aplicado: DISABLED_UPDATE só com DISABLE ou SCHEDULE_FOR_DISABLE, nunca com REINSTATE nem sem estado.
 */
export const EVENTOS_COM_EMAIL = ["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED", "ACCOUNT_DELETED", "PARTNER_APP_UNINSTALLED", "DISABLED_UPDATE"] as const satisfies readonly EventoConta[];

/** `disconnection_info.reason`; fora da lista = null (o e-mail diz "motivo não informado pela Meta"). */
export const MOTIVOS_DESCONEXAO = [
  "ACCOUNT_DISCONNECTED", "BUSINESS_DOWNGRADE", "CHANGE_NUMBER", "COMPANION_INACTIVITY", "PRIMARY_INACTIVITY", "USER_RE_REGISTERED",
] as const;
export type MotivoDesconexao = (typeof MOTIVOS_DESCONEXAO)[number];

/** `disconnection_info.initiated_by`: o próprio aplicativo (USER) ou a Meta (SYSTEM). */
export const INICIADO_POR = ["USER", "SYSTEM"] as const;
export type IniciadoPor = (typeof INICIADO_POR)[number];

/** `ban_info.waba_ban_state`. */
export const ESTADOS_BANIMENTO = ["SCHEDULE_FOR_DISABLE", "DISABLE", "REINSTATE"] as const;
export type EstadoBanimento = (typeof ESTADOS_BANIMENTO)[number];

/** Ids numéricos da Meta (WABA, número). Aqui, e não em configuracao.ts, para o parser puro não importar banco. */
export const ID_META = /^\d{1,25}$/;

// ---------------------------------------------------------------- eventos, contadores e e-mail

/** Resultado de um bloco (`change`) processado: `repetido` = nada mudou; `ignorado` = nada aproveitável. */
export const RESULTADOS_EVENTO = ["gravado", "repetido", "ignorado"] as const;
export type ResultadoEvento = (typeof RESULTADOS_EVENTO)[number];

/** Resultado do último envio do e-mail de um evento de conta (o mesmo vocabulário de avisarEquipePorEmail). */
export const RESULTADOS_EMAIL = ["enviado", "sem-email", "sem-correio", "falhou"] as const;
export type ResultadoEmail = (typeof RESULTADOS_EMAIL)[number];

/**
 * Contadores do dia (São Paulo), sem organização: a assinatura inválida chega antes de saber de quem é. Sem contador de
 * corpo grande: o 413 responde antes de autenticar e não toca o banco (desenho, T4).
 */
export const CONTADORES_DIA = ["assinaturas_recusadas", "ilegiveis", "outra_conta", "desconhecidos", "ignorados"] as const;
export type ContadorDia = (typeof CONTADORES_DIA)[number];

// ---------------------------------------------------------------- vínculo

/** O que uma conversa pode ter como vínculo confirmado (no máximo um; o CHECK da 0073 garante). */
export const ALVOS_VINCULO = ["reserva", "cotacao", "pedido_contato", "cadastro_marketplace", "proprietario"] as const;
export type AlvoVinculo = (typeof ALVOS_VINCULO)[number];

// ---------------------------------------------------------------- limites (parser e CHECKs)

/** Corpo do POST: o teto documentado pela Meta é 3 MB, e a Vercel recusa acima de 4,5 MB antes de chamar a função. */
export const LIMITE_CORPO = 4 * 1024 * 1024;
/** `text.body` e `caption`: acima disso a mensagem vira `outro`, sem texto. */
export const LIMITE_TEXTO = 8192;
/** Nome do perfil e da agenda. */
export const LIMITE_NOME = 256;
/** wamid (o CHECK `whatsapp_mensagens_wamid_tamanho` da 0073 usa o mesmo número). */
export const LIMITE_WAMID = 256;
/** Itens de um corpo (mensagens, contatos, eventos…): acima disso o corpo inteiro é ilegível, nunca cortado em parte. */
export const LIMITE_ITENS = 50_000;
/** Linhas por insert na gravação em lote. */
export const LOTE_INSERCAO = 500;
