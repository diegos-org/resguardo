/**
 * Leitura dos avisos do WhatsApp (M10.1a, desenho na seção "Leitura dos avisos" de `requisitos/product/WHATSAPP.md`):
 * puro, sem banco, sem rede e sem relógio. Recebe o JSON já conferido pela assinatura e já parseado e devolve só o que a
 * gravação usa, com validação estrita de forma e tamanho. O que não serve é descartado e contado: `desconhecidos`
 * (forma que o sistema não reconhece: avisar em vez de supor) ou `ignorados` (forma conhecida que de propósito não se
 * guarda: grupos, status, eventos sem efeito). Quem decide se o bloco é da nossa conta é `whatsapp/receber.ts`.
 *
 * Nunca sai daqui: `url`, id de mídia, `sha256`, `filename`, coordenadas e endereço da localização, os dados de um
 * contato compartilhado, `system.body` (traz nomes e os dois telefones), `referral`, `identity_key_hash`, `username` e
 * os BSUID "pai". Mídia guarda só o tipo, o mime e a legenda.
 *
 * Os nomes de campo seguem as páginas de referência da Meta (webhooks: messages e cada tipo de mensagem,
 * smb_message_echoes, history, smb_app_state_sync, account_update; e a página de BSUID). Os pontos marcados
 * "[não confirmado]" não têm exemplo nessas páginas e são lidos do jeito mais seguro.
 */
import {
  CAMPOS_AVISO,
  type CampoAviso,
  ESTADOS_BANIMENTO,
  type EstadoBanimento,
  EVENTOS_CONTA,
  EVENTOS_CONTA_SEM_EFEITO,
  type EventoConta,
  ID_META,
  INICIADO_POR,
  type IniciadoPor,
  LIMITE_ITENS,
  LIMITE_NOME,
  LIMITE_TEXTO,
  LIMITE_WAMID,
  MOTIVOS_DESCONEXAO,
  type MotivoDesconexao,
  type Origem,
  type TipoMensagem,
  UNSUPPORTED_SEM_LINHA,
} from "./regras";
import { chavesDoWaId, FORMA_WA_ID, temChaveEmComum } from "./telefone";

// ---------------------------------------------------------------- saída

/** Quem é o cliente da conversa: o BSUID (`user_id`) e o `wa_id` (só dígitos, com DDI). Pelo menos um não é nulo. */
export type Identidade = { waId: string | null; bsuid: string | null };
export type Conteudo = { tipo: TipoMensagem; texto: string; anexoMime: string | null; respostaA: string | null };
export type DirecaoLida = "recebida" | "enviada_celular";
export type MensagemLida = { wamid: string; direcao: DirecaoLida; origem: Origem; cliente: Identidade; enviadaEm: Date; conteudo: Conteudo };
export type EdicaoLida = { original: string; direcao: DirecaoLida; origem: Origem; cliente: Identidade; em: Date; conteudo: Conteudo };
export type ApagamentoLido = { original: string; direcao: DirecaoLida; origem: Origem; cliente: Identidade; em: Date };
/** `emoji` null = reação retirada. */
export type ReacaoLida = { alvo: string; emoji: string | null; em: Date };
export type TrocaDeIdentidade = { tipo: "numero" | "usuario"; anterior: Identidade; nova: Identidade; em: Date; wamid: string };
export type PerfilLido = { cliente: Identidade; nome: string };
/** `nome` só no `add` (o `remove` não traz nome). */
export type AgendaLida = { acao: "add" | "remove"; cliente: Identidade; nome: string | null; em: Date };
export type ProgressoLido = { progresso: number; fase: number | null; ordem: number | null };
export type ContaLida = { evento: EventoConta; wabaIds: string[]; em: Date; motivo: MotivoDesconexao | null; iniciadoPor: IniciadoPor | null; banimento: EstadoBanimento | null };
export type BlocoLido = {
  campo: CampoAviso;
  /** `entry.id` e, no account_update, `value.waba_info.waba_id` (sem repetição). Vazio só no histórico recusado sem envelope. */
  wabaIds: string[];
  /** `value.metadata.phone_number_id`; obrigatório nos quatro campos de mensagem (T18). */
  numeroId: string | null;
  perfis: PerfilLido[];
  mensagens: MensagemLida[];
  edicoes: EdicaoLida[];
  apagamentos: ApagamentoLido[];
  reacoes: ReacaoLida[];
  trocas: TrocaDeIdentidade[];
  agenda: AgendaLida[];
  progresso: ProgressoLido | null;
  historicoRecusado: boolean;
  conta: ContaLida | null;
  /** Quantos itens deste bloco foram contados em cada contador (somados se o bloco for da nossa conta). */
  contagem: Partial<Record<"desconhecidos" | "ignorados", number>>;
};
/** `contagem` do aviso: o que não chegou a virar bloco (entrada, campo ou bloco descartado). */
export type AvisoLido = { ilegivel: true } | { ilegivel: false; blocos: BlocoLido[]; contagem: Partial<Record<"desconhecidos", number>> };

// ---------------------------------------------------------------- formas aceitas

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (ehObj(v) ? v : {});
const lista = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const naLista = <T extends string>(l: readonly T[], v: unknown): v is T => typeof v === "string" && (l as readonly string[]).includes(v);
const somar = <K extends string>(contagem: Partial<Record<K, number>>, chave: K, n = 1) => {
  if (n > 0) contagem[chave] = (contagem[chave] ?? 0) + n;
};

const ILEGIVEL: AvisoLido = { ilegivel: true };
/** Código do histórico recusado pela empresa no aplicativo (referência de history, "Chat history sharing declined"). */
const HISTORICO_RECUSADO = 2593109;

/** BSUID (página de BSUID): duas letras do país, ponto, "ENT." no BSUID de empresa, e até 128 letras e números. */
const BSUID = /^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9]{1,128}$/;
/** wamid: ASCII imprimível, sem depender do prefixo "wamid.". O CHECK da 0073 usa o mesmo teto. */
const WAMID = new RegExp(`^[\\x21-\\x7e]{1,${LIMITE_WAMID}}$`);
const MIME = /^[a-z]+\/[a-z0-9.+-]{1,100}(; ?codecs=[a-z0-9.,-]{1,50})?$/;
/** Segundos em texto (até 12 dígitos) ou inteiro; entre 2009 e 2100. */
const SEGUNDOS = /^\d{1,12}$/;
const PRIMEIRO_SEGUNDO = 1_230_000_000;
const ULTIMO_SEGUNDO = 4_102_444_800;
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/;
const LIMITE_EMOJI = 32;

/** `wa_id`, `from`, `to`, `phone_number`, `threads[].id`: "+" opcional e a forma do `wa_id` (`FORMA_WA_ID`) → só os dígitos. */
function telefone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const digitos = v.startsWith("+") ? v.slice(1) : v;
  return FORMA_WA_ID.test(digitos) ? digitos : null;
}
const bsuid = (v: unknown): string | null => (typeof v === "string" && BSUID.test(v) ? v : null);
const wamid = (v: unknown): string | null => (typeof v === "string" && WAMID.test(v) ? v : null);
const idMeta = (v: unknown): string | null => (typeof v === "string" && ID_META.test(v) ? v : null);
const mime = (v: unknown): string | null => (typeof v === "string" && MIME.test(v) ? v : null);
const inteiro = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : null;

function instante(v: unknown): Date | null {
  const s = typeof v === "string" && SEGUNDOS.test(v) ? Number(v) : typeof v === "number" && Number.isSafeInteger(v) ? v : null;
  return s !== null && s >= PRIMEIRO_SEGUNDO && s <= ULTIMO_SEGUNDO ? new Date(s * 1000) : null;
}

/** Tamanho em caracteres (pontos de código), com saída cedo para o texto curto ou longo demais. */
function cabe(s: string, limite: number): boolean {
  if (s.length <= limite) return true;
  if (s.length > limite * 2) return false;
  return [...s].length <= limite;
}

const texto = (v: unknown): string | null => (typeof v === "string" && cabe(v, LIMITE_TEXTO) ? v : null);

/** `profile.name`, `full_name`, `first_name`: aparado, até 256 caracteres, sem caractere de controle; senão ignorado. */
function nome(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && cabe(t, LIMITE_NOME) && !CONTROLE.test(t) ? t : null;
}

/** null = retirada (ausente ou ""; a Meta omite o campo); false = fora da forma. */
function emoji(v: unknown): string | null | false {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "string" && cabe(v, LIMITE_EMOJI) && !CONTROLE.test(v) ? v : false;
}

const identidade = (waId: string | null, bsuidDoCliente: string | null): Identidade | null =>
  waId !== null || bsuidDoCliente !== null ? { waId, bsuid: bsuidDoCliente } : null;

function novoBloco(campo: CampoAviso, wabaIds: string[], numeroId: string | null): BlocoLido {
  return {
    campo, wabaIds, numeroId, perfis: [], mensagens: [], edicoes: [], apagamentos: [], reacoes: [], trocas: [], agenda: [],
    progresso: null, historicoRecusado: false, conta: null, contagem: {},
  };
}

/** Itens de uma lista do aviso: ausente = nenhum; presente mas fora da forma de lista = `desconhecidos` +1. */
function itens(v: unknown, b: BlocoLido): unknown[] {
  if (v === undefined || v === null) return [];
  const l = lista(v);
  if (!l) somar(b.contagem, "desconhecidos");
  return l ?? [];
}

// ---------------------------------------------------------------- contatos e identidade

/**
 * Os contatos do bloco, indexados pelo BSUID e por cada chave do `wa_id` (`chavesDoWaId`; o primeiro contato fica com a
 * chave), para casar cada mensagem sem percorrer a lista (um pedaço do histórico pode ter milhares dos dois). `unico`: o
 * contato do par contato e mensagem da Meta (um contato e um item no bloco). `perfis`: os nomes lidos, que só passam ao
 * bloco depois das mensagens (`guardarPerfis`).
 */
type ContatosDoBloco = { porBsuid: Map<string, Identidade>; porChave: Map<string, Identidade>; unico: Identidade | null; perfis: PerfilLido[] };

/** `contacts[]`: `wa_id` (pode faltar), `user_id` e `profile.name`. O resto do contato é ignorado. */
function lerContatos(v: unknown, b: BlocoLido): ContatosDoBloco {
  const contatos: ContatosDoBloco = { porBsuid: new Map(), porChave: new Map(), unico: null, perfis: [] };
  let quantos = 0;
  for (const c of itens(v, b)) {
    const quem = ehObj(c) ? identidade(telefone(c.wa_id), bsuid(c.user_id)) : null;
    if (!quem) {
      somar(b.contagem, "desconhecidos");
      continue;
    }
    quantos += 1;
    contatos.unico = quantos === 1 ? quem : null;
    if (quem.bsuid !== null && !contatos.porBsuid.has(quem.bsuid)) contatos.porBsuid.set(quem.bsuid, quem);
    for (const chave of quem.waId !== null ? chavesDoWaId(quem.waId) : []) if (!contatos.porChave.has(chave)) contatos.porChave.set(chave, quem);
    const n = nome(obj((c as Obj).profile).name);
    if (n) contatos.perfis.push({ cliente: quem, nome: n });
  }
  return contatos;
}

/** O BSUID e as chaves do `wa_id` de uma identidade, num conjunto só (não se confundem: o BSUID tem letras e ponto). */
const chavesDaIdentidade = (c: Identidade): string[] => [...(c.bsuid !== null ? [c.bsuid] : []), ...(c.waId !== null ? chavesDoWaId(c.waId) : [])];

/**
 * Só passa ao bloco o perfil do contato com algum item aceito (mensagem, edição ou apagamento com o mesmo BSUID ou chave
 * em comum): a gravação cria a conversa pelas identidades dos perfis, e o contato de uma mensagem de grupo, de um
 * `unsupported` de evento, de uma reação ou de um item descartado não pode virar conversa nem deixar telefone e nome
 * guardados (T24: "nada guardado"). Por conjunto: linear mesmo com milhares de contatos e mensagens.
 */
function guardarPerfis(perfis: PerfilLido[], b: BlocoLido): void {
  if (!perfis.length) return;
  const usadas = new Set([...b.mensagens, ...b.edicoes, ...b.apagamentos].flatMap((x) => chavesDaIdentidade(x.cliente)));
  for (const p of perfis) if (chavesDaIdentidade(p.cliente).some((k) => usadas.has(k))) b.perfis.push(p);
}

/**
 * Identidade de uma mensagem a partir do telefone (`from` ou `to`) e do BSUID (`from_user_id` ou `to_user_id`), com o
 * `contacts[]` do bloco. O contato casa pelo mesmo `user_id`; senão pelo `wa_id` com chave em comum com o telefone (a Meta
 * avisa nas páginas de text, unsupported e reaction que o ID do usuário e o telefone nem sempre batem: "+16505551234" e
 * "16505551234", ou o celular brasileiro sem o nono dígito); e, no par contato e mensagem da Meta (`unico`: um contato e
 * um item no bloco), por ele, se o BSUID dele não contradiz o da mensagem. Com mais itens e nada casando, fica o
 * telefone e o BSUID da própria mensagem (avisar em vez de supor). O `wa_id` do contato casado vale mais que o telefone
 * da mensagem; o BSUID da mensagem vale mais que o do contato. Sem telefone e sem BSUID na mensagem: null (descartada).
 */
function identidadeDe(contatos: ContatosDoBloco, tel: string | null, usuario: string | null): Identidade | null {
  if (tel === null && usuario === null) return null;
  const { unico } = contatos;
  const casado =
    (usuario !== null ? contatos.porBsuid.get(usuario) : undefined) ??
    (tel !== null ? chavesDoWaId(tel).map((k) => contatos.porChave.get(k)).find((c) => c !== undefined) : undefined) ??
    (unico && !(usuario !== null && unico.bsuid !== null && unico.bsuid !== usuario) ? unico : undefined);
  return identidade(casado?.waId ?? tel, usuario ?? casado?.bsuid ?? null);
}

// ---------------------------------------------------------------- conteúdo

/** Mídia: só o tipo, o mime e (imagem, vídeo, documento) a legenda. Nunca `url`, `id`, `sha256`, `filename`. */
const MIDIA = new Map<string, TipoMensagem>([["image", "imagem"], ["video", "video"], ["document", "documento"], ["audio", "audio"], ["sticker", "figurinha"]]);
const COM_LEGENDA = new Set(["image", "video", "document"]);
/**
 * Tipos guardados sem conteúdo ("ver no celular"): localização (nunca coordenadas, endereço, nome ou url), contato
 * compartilhado (nunca endereços, e-mails, aniversário, telefones, vcard), `unsupported` (131051 e 131060), botões,
 * listas e pedidos, e o `media_placeholder` do histórico.
 */
const SEM_CONTEUDO = new Map<string, TipoMensagem>([
  ["location", "localizacao"], ["contacts", "contato"], ["unsupported", "nao_suportada"],
  ["button", "outro"], ["interactive", "outro"], ["order", "outro"], ["media_placeholder", "midia_pendente"],
]);

/**
 * Conteúdo de uma mensagem pelo `type`. `desconhecido` = tipo que o sistema não conhece, ou texto/legenda fora da forma
 * (acima de 8192 caracteres): a mensagem vira `outro`, sem texto (T25). `comResposta` = ler `context.id` (a edição não lê).
 */
function lerConteudo(m: Obj, comResposta: boolean): { conteudo: Conteudo; desconhecido: boolean } {
  const tipo = typeof m.type === "string" ? m.type : "";
  const respostaA = comResposta ? wamid(obj(m.context).id) : null;
  const sem = (t: TipoMensagem, desconhecido = false) => ({ conteudo: { tipo: t, texto: "", anexoMime: null, respostaA }, desconhecido });
  if (tipo === "text") {
    const t = texto(obj(m.text).body);
    return t === null ? sem("outro", true) : { conteudo: { tipo: "texto", texto: t, anexoMime: null, respostaA }, desconhecido: false };
  }
  const tipoMidia = MIDIA.get(tipo);
  if (tipoMidia) {
    const midia = obj(m[tipo]);
    let legenda = "";
    if (COM_LEGENDA.has(tipo) && midia.caption !== undefined && midia.caption !== null) {
      const t = texto(midia.caption);
      if (t === null) return sem("outro", true);
      legenda = t;
    }
    return { conteudo: { tipo: tipoMidia, texto: legenda, anexoMime: mime(midia.mime_type), respostaA }, desconhecido: false };
  }
  const tipoSem = SEM_CONTEUDO.get(tipo);
  return tipoSem ? sem(tipoSem) : sem("outro", true);
}

// ---------------------------------------------------------------- mensagens (messages, ecos e histórico)

type Leitura = {
  origem: Origem;
  /** null = não dá para dizer quem mandou (só no histórico): descartada. */
  direcao: (m: Obj) => DirecaoLida | null;
  cliente: (m: Obj) => Identidade | null;
};

/**
 * Um item de `messages[]`, `message_echoes[]` ou `threads[].messages[]`. Ordem: grupo e `unsupported` de evento são
 * ignorados; hora; reação (não precisa de direção nem de identidade); direção; mensagem de sistema (identidade própria);
 * identidade; edição, apagamento ou conteúdo.
 */
function lerItem(m: unknown, l: Leitura, b: BlocoLido): void {
  if (!ehObj(m)) return somar(b.contagem, "desconhecidos");
  // T24: grupos não sincronizam na coexistência e não se guardam.
  if (m.group_id !== undefined && m.group_id !== null) return somar(b.contagem, "ignorados");
  // Evento sobre outra mensagem (o exemplo oficial de unsupported é justamente type "edit"): o id é o do evento e não traz
  // a mensagem afetada, então não vira linha.
  if (m.type === "unsupported" && naLista(UNSUPPORTED_SEM_LINHA, obj(m.unsupported).type)) return somar(b.contagem, "ignorados");
  const em = instante(m.timestamp);
  if (!em) return somar(b.contagem, "desconhecidos");
  if (m.type === "reaction") return lerReacao(m, em, b);
  const direcao = l.direcao(m);
  if (!direcao) return somar(b.contagem, "desconhecidos");
  if (m.type === "system") return lerSistema(m, em, direcao, l.origem, b);
  const cliente = l.cliente(m);
  if (!cliente) return somar(b.contagem, "desconhecidos");
  const base = { direcao, origem: l.origem, cliente, em };
  if (m.type === "edit") {
    const e = obj(m.edit);
    const original = wamid(e.original_message_id);
    if (!original || !ehObj(e.message)) return somar(b.contagem, "desconhecidos");
    // `edit.message.context` é ignorado: os exemplos de messages/edit e de smb_message_echoes trazem `context.id: "M0"`,
    // que não é um wamid; a edição nunca muda `resposta_a`. Só há exemplo de edição de imagem: a edição de texto
    // (`edit.message.type: "text"` com `text.body`) é [não confirmado] e lida do mesmo jeito.
    const { conteudo, desconhecido } = lerConteudo(e.message, false);
    // Edição ilegível não se aplica: aplicar apagaria o texto que a mensagem tem (avisar em vez de supor).
    if (desconhecido) return somar(b.contagem, "desconhecidos");
    b.edicoes.push({ original, ...base, conteudo });
    return;
  }
  if (m.type === "revoke") {
    const original = wamid(obj(m.revoke).original_message_id);
    if (!original) return somar(b.contagem, "desconhecidos");
    b.apagamentos.push({ original, ...base });
    return;
  }
  const id = wamid(m.id);
  if (!id) return somar(b.contagem, "desconhecidos");
  const { conteudo, desconhecido } = lerConteudo(m, true);
  if (desconhecido) somar(b.contagem, "desconhecidos");
  b.mensagens.push({ wamid: id, direcao, origem: l.origem, cliente, enviadaEm: em, conteudo });
}

/** Reação a uma mensagem (`reaction.message_id`); `emoji` ausente ou "" = retirada. Não vira linha. */
function lerReacao(m: Obj, em: Date, b: BlocoLido): void {
  const r = obj(m.reaction);
  const alvo = wamid(r.message_id);
  const e = emoji(r.emoji);
  if (!alvo || e === false) return somar(b.contagem, "desconhecidos");
  b.reacoes.push({ alvo, emoji: e, em });
}

/**
 * Mensagem de sistema (referência messages/system, atualizada em 11/8/2026): troca de número ou de BSUID. Não traz
 * `contacts` nem `from_user_id`; o `user_changed_user_id` também não traz `from` e, em geral, nem `system.wa_id`. O
 * BSUID antigo vem em `system.previous_user_id` ("omitted when unavailable"), e é por ele que a conversa é achada. A
 * linha `sistema` fica na conversa da identidade anterior. `system.body`, `parent_user_id` e `previous_parent_user_id`
 * nunca são lidos.
 */
function lerSistema(m: Obj, em: Date, direcao: DirecaoLida, origem: Origem, b: BlocoLido): void {
  const s = obj(m.system);
  const id = wamid(m.id);
  const de = telefone(m.from);
  const bsuidAnterior = bsuid(s.previous_user_id);
  let troca: Pick<TrocaDeIdentidade, "tipo" | "anterior"> & { nova: Identidade | null };
  if (s.type === "user_changed_number") {
    const anterior = identidade(de, bsuidAnterior);
    if (!anterior) return somar(b.contagem, "desconhecidos");
    troca = { tipo: "numero", anterior, nova: identidade(telefone(s.wa_id), bsuid(s.user_id)) };
  } else if (s.type === "user_changed_user_id") {
    const waId = telefone(s.wa_id) ?? de;
    const anterior = identidade(waId, bsuidAnterior);
    if (!anterior) return somar(b.contagem, "desconhecidos");
    troca = { tipo: "usuario", anterior, nova: identidade(waId, bsuid(s.user_id)) };
  } else {
    return somar(b.contagem, "desconhecidos");
  }
  if (!id) return somar(b.contagem, "desconhecidos");
  if (troca.nova) b.trocas.push({ tipo: troca.tipo, anterior: troca.anterior, nova: troca.nova, em, wamid: id });
  b.mensagens.push({ wamid: id, direcao, origem, cliente: troca.anterior, enviadaEm: em, conteudo: { tipo: "sistema", texto: "", anexoMime: null, respostaA: null } });
}

/**
 * `messages[]` (recebidas: identidade = `from` + `from_user_id`) e `message_echoes[]` (enviadas pelo celular: identidade
 * = `to` + `to_user_id`; `from` é o número da empresa e é ignorado), com o `contacts[]` do bloco. Serve ao campo
 * `messages`, ao `smb_message_echoes` e à mídia que chega depois pelo `history`. Tipos no eco além de text, image, video,
 * document, revoke e edit são [não confirmado] (referência de smb_message_echoes) e lidos de forma genérica.
 * Uma "recebida" com `from` da empresa (`chavesEmpresa`, de `metadata.display_phone_number`) é descartada e conta em
 * `desconhecidos`: no tempo real não acontece, e no histórico seria a mídia mandada pelo celular da empresa chegando
 * depois sem dizer para quem foi (a referência de history marca essa mídia como `media_placeholder` com `from` da
 * empresa; o exemplo da mídia tardia só mostra o `from` do cliente, então esse formato é [não confirmado]). A linha
 * `midia_pendente` da conversa continua "ver no celular". `statuses[]` (só existem para envio pela API, M10.2) e
 * `value.errors[]` são ignorados e contados.
 */
function lerRecebidasEEcos(value: Obj, origem: Origem, chavesEmpresa: string[], b: BlocoLido): void {
  const contatos = lerContatos(value.contacts, b);
  // O contato "único" vale só para o par contato e mensagem da Meta: com mais itens, outra mensagem sem BSUID nem telefone
  // em comum ficaria com a identidade de outra pessoa.
  if ((lista(value.messages)?.length ?? 0) + (lista(value.message_echoes)?.length ?? 0) !== 1) contatos.unico = null;
  const recebida: Leitura = {
    origem,
    direcao: (m) => {
      const de = telefone(m.from);
      return de !== null && temChaveEmComum(chavesDoWaId(de), chavesEmpresa) ? null : "recebida";
    },
    cliente: (m) => identidadeDe(contatos, telefone(m.from), bsuid(m.from_user_id)),
  };
  const eco: Leitura = { origem, direcao: () => "enviada_celular", cliente: (m) => identidadeDe(contatos, telefone(m.to), bsuid(m.to_user_id)) };
  for (const m of itens(value.messages, b)) lerItem(m, recebida, b);
  for (const m of itens(value.message_echoes, b)) lerItem(m, eco, b);
  somar(b.contagem, "ignorados", itens(value.statuses, b).length + itens(value.errors, b).length);
  guardarPerfis(contatos.perfis, b);
}

// ---------------------------------------------------------------- histórico

/**
 * Uma conversa do histórico (`threads[]`). Identidade = `threads[].id` (telefone; na forma de BSUID é [não confirmado]: a
 * página de BSUID diz que o id é o telefone ou some) + `context.wa_id` + `context.user_id`. Direção, nesta ordem (nunca
 * pela presença de `to` e nunca "recebida" por exclusão):
 * 1. `from` com chave em comum com a conversa (`threads[].id` ou `context.wa_id`) → recebida;
 * 2. `from` com chave em comum com o número da empresa (`metadata.display_phone_number`) → enviada pelo celular. A
 *    chave em comum é tolerância: a documentação não diz que o número da empresa venha em outra forma, mas o celular
 *    brasileiro sem o nono dígito não pode virar "cliente";
 * 3. `from_user_id` igual ao BSUID da conversa → recebida (inclusive sem `from`). Fica depois do `from`: a página de BSUID
 *    diz só que `from_user_id` "será o BSUID do usuário", sem dizer se aparece também na mensagem da empresa
 *    ([não confirmado]); um `from` da empresa nunca vira "recebida" por causa dele;
 * 4. nada casa → descartada, `desconhecidos` +1 (avisar em vez de supor).
 * `history_context.status` é ignorado.
 */
function lerConversaDoHistorico(t: unknown, chavesEmpresa: string[], b: BlocoLido): void {
  const mensagens = ehObj(t) ? lista(t.messages) : null;
  if (!ehObj(t) || !mensagens) return somar(b.contagem, "desconhecidos");
  const ctx = obj(t.context);
  const cliente = identidade(telefone(ctx.wa_id) ?? telefone(t.id), bsuid(ctx.user_id) ?? bsuid(t.id));
  const chavesConversa = [telefone(t.id), telefone(ctx.wa_id)].flatMap((tel) => (tel !== null ? chavesDoWaId(tel) : []));
  const direcao = (m: Obj): DirecaoLida | null => {
    const de = telefone(m.from);
    if (de !== null) {
      const chaves = chavesDoWaId(de);
      if (temChaveEmComum(chaves, chavesConversa)) return "recebida";
      if (temChaveEmComum(chaves, chavesEmpresa)) return "enviada_celular";
    }
    const usuario = bsuid(m.from_user_id);
    return usuario !== null && cliente?.bsuid === usuario ? "recebida" : null;
  };
  for (const m of mensagens) lerItem(m, { origem: "historico", direcao, cliente: () => cliente }, b);
}

/**
 * Um pedaço do histórico (`value.history[]`): `metadata` (`phase` 0 a 2, `chunk_order`, `progress` 0 a 100; fica o maior
 * `progress` do bloco, e só ele decide o fim, em 100), as conversas e os erros (2593109 = a empresa recusou o
 * histórico no aplicativo; outro código conta em `desconhecidos`).
 */
function lerPedacoDoHistorico(h: unknown, chavesEmpresa: string[], b: BlocoLido): void {
  if (!ehObj(h)) return somar(b.contagem, "desconhecidos");
  for (const e of itens(h.errors, b)) {
    if (ehObj(e) && e.code === HISTORICO_RECUSADO) b.historicoRecusado = true;
    else somar(b.contagem, "desconhecidos");
  }
  const meta = obj(h.metadata);
  const progresso = inteiro(meta.progress, 0, 100);
  if (progresso !== null && (b.progresso === null || progresso > b.progresso.progresso)) {
    b.progresso = { progresso, fase: inteiro(meta.phase, 0, 2), ordem: inteiro(meta.chunk_order, 0, Number.MAX_SAFE_INTEGER) };
  }
  for (const t of itens(h.threads, b)) lerConversaDoHistorico(t, chavesEmpresa, b);
}

/**
 * Histórico recusado sem o envelope: a referência de history mostra esse aviso só com `messaging_product`, `metadata` e
 * `history[].errors` (sem `object`, `entry` e `field`); o envelope completo com `field: "history"` é [não confirmado] e
 * também é aceito (pelo caminho normal). Tolerância estreita: `messaging_product` "whatsapp", `phone_number_id` válido,
 * cada pedaço só com erros e pelo menos um 2593109. Qualquer outra coisa sem envelope continua ilegível. O pedido de
 * histórico só pode ser feito uma vez: perder a recusa deixaria "Histórico: pedido" para sempre.
 */
function historicoRecusadoSemEnvelope(json: Obj): BlocoLido | null {
  if (json.messaging_product !== "whatsapp") return null;
  const numeroId = idMeta(obj(json.metadata).phone_number_id);
  const pedacos = lista(json.history);
  if (!numeroId || !pedacos || !pedacos.length || pedacos.length > LIMITE_ITENS) return null;
  const b = novoBloco("history", [], numeroId);
  let erros = 0;
  for (const h of pedacos) {
    const lidos = ehObj(h) && h.threads === undefined ? lista(h.errors) : null;
    if (!lidos || (erros += lidos.length) > LIMITE_ITENS) return null;
    for (const e of lidos) {
      if (ehObj(e) && e.code === HISTORICO_RECUSADO) b.historicoRecusado = true;
      else somar(b.contagem, "desconhecidos");
    }
  }
  return b.historicoRecusado ? b : null;
}

// ---------------------------------------------------------------- agenda e conta

/**
 * Agenda do celular (`state_sync[]` com `type: "contact"`): `contact.full_name` ou `contact.first_name` (nunca
 * `contact.name`), `contact.phone_number` (pode faltar) e `contact.user_id`; `action` `add` (inclui edição) ou `remove`
 * (sem nome); `metadata.timestamp` em texto ou número. Outro `type`, item sem identidade e `add` sem nome servem para
 * nada (a agenda só dá o nome): `ignorados` +1.
 */
function lerAgenda(s: unknown, b: BlocoLido): void {
  if (!ehObj(s)) return somar(b.contagem, "desconhecidos");
  if (s.type !== "contact") return somar(b.contagem, "ignorados");
  const acao = s.action;
  if (acao !== "add" && acao !== "remove") return somar(b.contagem, "desconhecidos");
  const em = instante(obj(s.metadata).timestamp);
  if (!em) return somar(b.contagem, "desconhecidos");
  const c = obj(s.contact);
  const cliente = identidade(telefone(c.phone_number), bsuid(c.user_id));
  if (!cliente) return somar(b.contagem, "ignorados");
  const n = acao === "add" ? (nome(c.full_name) ?? nome(c.first_name)) : null;
  if (acao === "add" && !n) return somar(b.contagem, "ignorados");
  b.agenda.push({ acao, cliente, nome: n, em });
}

/**
 * `account_update` (referência atualizada em 2/10/2026, e o exemplo de PARTNER_REMOVED da página de coexistência).
 * `em` = `entry.time` (número ou texto). Evento sem efeito aqui (por exemplo PARTNER_APP_INSTALLED, esperado já na
 * conexão) é ignorado; evento fora das duas listas, ou sem `entry.time` válido, é desconhecido. Não lê
 * `waba_info.owner_business_id`, `phone_number`, `restriction_info` nem `violation_info`.
 */
function lerConta(value: Obj, tempo: unknown, b: BlocoLido): void {
  const evento = value.event;
  if (naLista(EVENTOS_CONTA_SEM_EFEITO, evento)) return somar(b.contagem, "ignorados");
  if (!naLista(EVENTOS_CONTA, evento)) return somar(b.contagem, "desconhecidos");
  const em = instante(tempo);
  if (!em) return somar(b.contagem, "desconhecidos");
  const desconexao = obj(value.disconnection_info);
  const banimento = obj(value.ban_info).waba_ban_state;
  b.conta = {
    evento,
    wabaIds: [...b.wabaIds],
    em,
    motivo: naLista(MOTIVOS_DESCONEXAO, desconexao.reason) ? desconexao.reason : null,
    iniciadoPor: naLista(INICIADO_POR, desconexao.initiated_by) ? desconexao.initiated_by : null,
    banimento: naLista(ESTADOS_BANIMENTO, banimento) ? banimento : null,
  };
}

// ---------------------------------------------------------------- aviso

/**
 * Um bloco (`change`). Os quatro campos de mensagem exigem `metadata.phone_number_id` válido (T18): sem ele o bloco é
 * descartado (null) e nunca aceito. Só `account_update` dispensa o número; ali `wabaIds` = `entry.id` +
 * `value.waba_info.waba_id` (T17: o `entry.id` pode ser o id do parceiro, na referência, ou a própria WABA, na página
 * de coexistência).
 */
function lerBloco(campo: CampoAviso, value: Obj, entradaId: string, tempo: unknown): BlocoLido | null {
  const numeroId = idMeta(obj(value.metadata).phone_number_id);
  if (campo !== "account_update" && !numeroId) return null;
  const wabaIds = [entradaId];
  const wabaDoValor = campo === "account_update" ? idMeta(obj(value.waba_info).waba_id) : null;
  if (wabaDoValor && wabaDoValor !== entradaId) wabaIds.push(wabaDoValor);
  const b = novoBloco(campo, wabaIds, numeroId);
  // O número da empresa: dá a direção no histórico e recusa a "recebida" que veio da própria empresa.
  const empresa = telefone(obj(value.metadata).display_phone_number);
  const chavesEmpresa = empresa !== null ? chavesDoWaId(empresa) : [];
  if (campo === "messages" || campo === "smb_message_echoes") lerRecebidasEEcos(value, "tempo_real", chavesEmpresa, b);
  else if (campo === "history") {
    // Três formatos: (a) conversas em `history[].threads`; (b) a mídia que chega depois, em `messages[]` ou
    // `message_echoes[]`; (c) a recusa, em `history[].errors`.
    lerRecebidasEEcos(value, "historico", chavesEmpresa, b);
    for (const h of itens(value.history, b)) lerPedacoDoHistorico(h, chavesEmpresa, b);
  } else if (campo === "smb_app_state_sync") {
    for (const s of itens(value.state_sync, b)) lerAgenda(s, b);
  } else lerConta(value, tempo, b);
  return b;
}

/**
 * Itens do corpo (entradas, blocos, contatos, mensagens, ecos, status, erros, agenda, pedaços, conversas e as mensagens
 * delas). Com o teto de 4 MB do corpo, é o que limita o trabalho; acima de `LIMITE_ITENS` o corpo inteiro é ilegível
 * (nunca cortado em parte).
 */
function contarItens(json: Obj): number {
  let n = 0;
  const contar = (v: unknown): unknown[] => {
    const l = lista(v) ?? [];
    n += l.length;
    return l;
  };
  for (const e of contar(json.entry)) {
    if (n > LIMITE_ITENS) return n;
    for (const c of ehObj(e) ? contar(e.changes) : []) {
      if (n > LIMITE_ITENS) return n;
      const v = ehObj(c) ? c.value : null;
      if (!ehObj(v)) continue;
      for (const k of ["contacts", "messages", "message_echoes", "statuses", "errors", "state_sync"]) contar(v[k]);
      for (const h of contar(v.history)) {
        if (!ehObj(h)) continue;
        contar(h.errors);
        for (const t of contar(h.threads)) if (ehObj(t)) contar(t.messages);
      }
    }
  }
  return n;
}

/**
 * O aviso inteiro. `object` diferente de "whatsapp_business_account" (salvo o histórico recusado sem envelope) ou itens
 * demais = ilegível. Entrada sem `id` da Meta válido ou sem `changes`, bloco fora da forma, campo desconhecido e bloco de
 * mensagem sem número: descartados e contados em `contagem.desconhecidos` do aviso. Sem teto próprio de entradas e
 * blocos: a Meta agrupa até 1.000 atualizações por POST (página "Create a webhook endpoint").
 */
export function lerAviso(json: unknown): AvisoLido {
  if (!ehObj(json)) return ILEGIVEL;
  if (json.object !== "whatsapp_business_account") {
    const recusado = json.object === undefined && json.entry === undefined ? historicoRecusadoSemEnvelope(json) : null;
    return recusado ? { ilegivel: false, blocos: [recusado], contagem: {} } : ILEGIVEL;
  }
  if (contarItens(json) > LIMITE_ITENS) return ILEGIVEL;
  const blocos: BlocoLido[] = [];
  const contagem: Partial<Record<"desconhecidos", number>> = {};
  const entradas = lista(json.entry);
  if (!entradas || !entradas.length) {
    somar(contagem, "desconhecidos");
    return { ilegivel: false, blocos, contagem };
  }
  for (const entrada of entradas) {
    const id = ehObj(entrada) ? idMeta(entrada.id) : null;
    const mudancas = ehObj(entrada) ? lista(entrada.changes) : null;
    if (!id || !mudancas || !mudancas.length) {
      somar(contagem, "desconhecidos");
      continue;
    }
    for (const mudanca of mudancas) {
      const campo = ehObj(mudanca) ? mudanca.field : undefined;
      const value = ehObj(mudanca) ? mudanca.value : undefined;
      const bloco = naLista(CAMPOS_AVISO, campo) && ehObj(value) ? lerBloco(campo, value, id, (entrada as Obj).time) : null;
      if (bloco) blocos.push(bloco);
      else somar(contagem, "desconhecidos");
    }
  }
  return { ilegivel: false, blocos, contagem };
}
