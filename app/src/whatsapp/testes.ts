/**
 * Apoio aos testes do recebimento do WhatsApp (M10.1a). Só testes importam daqui; nada usa rede nem credenciais.
 * `CANARIOS`: valores fictícios de dado pessoal (telefone em várias formas, BSUID, wamid, texto e nomes), plantados nos
 * avisos de teste e procurados depois em tudo o que não pode guardá-los (eventos, contadores, situação da conta,
 * auditoria, execuções das rotinas e as tabelas do pagamento): o esperado é nunca achar nenhum.
 * Avisos: `assinar` (o cabeçalho `x-hub-signature-256` com o segredo de teste) e os construtores dos envelopes de cada
 * campo, no formato das páginas de referência da Meta, com a WABA, o número e o telefone da empresa fictícios dessas
 * páginas (`FICTICIOS`). Nenhum id real da Meta e nenhum telefone real entram aqui.
 */
import { createHmac } from "node:crypto";
import type { Db } from "@/db/types";
import { semDadosPessoais } from "@/pagamentos/testes";

/** Fictícios; nada parecido com o número real da empresa. Só podem existir em `whatsapp_contatos` e `whatsapp_mensagens`. */
export const CANARIOS = {
  waIdBr: "5521999990000",
  waIdBrSem9: "552199990000",
  telefoneFormatado: "(21) 99999-0000",
  comMais: "+5521999990000",
  waIdEstrangeiro: "16505550199",
  bsuid: "BR.Ficticio0000000000000001",
  wamid: "wamid.CANARIOFICTICIO0000000001",
  texto: "Texto canário fictício da conversa",
  nomePerfil: "Perfil Canário Fictício",
  nomeAgenda: "Agenda Canário Fictício",
} as const;

/** `semDadosPessoais` com todos os `CANARIOS`: devolve os que apareceram (o esperado é `[]`). */
export function semDadosPessoaisWhatsapp(db: Db): Promise<string[]> {
  return semDadosPessoais(db, Object.values(CANARIOS));
}

/**
 * Ids e telefones fictícios das páginas da Meta (os mesmos do desenho): a WABA e o número que a configuração de teste
 * usa, o telefone de exibição da empresa e um cliente. `outraWaba` é o id de exemplo das páginas (serve de "outra
 * conta" e de id do parceiro no account_update).
 */
export const FICTICIOS = {
  waba: "200000000000002",
  numero: "100000000000001",
  telefoneEmpresa: "15550783881",
  cliente: "16505551234",
  outraWaba: "102290129340398",
  outroNumero: "106540352242922",
} as const;

/** Segredo do app só de teste (o vetor da fixture `fixtures/corpo-assinado.json` usa este). */
export const SEGREDO_TESTE = "segredo-de-teste-ficticio";

/** O cabeçalho `x-hub-signature-256`: "sha256=" + HMAC-SHA256 dos bytes do corpo, em hex. */
export function assinar(corpo: string | Buffer, segredo: string = SEGREDO_TESTE): string {
  return `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;
}

/** Hora padrão dos avisos de teste. */
export const HORA_DO_AVISO = new Date("2026-10-17T15:00:00Z");
/** O `timestamp` da Meta: segundos, em texto. */
export const emSegundos = (d: Date): string => String(Math.floor(d.getTime() / 1000));

type Json = Record<string, unknown>;
/** Acrescenta só os campos definidos (o aviso da Meta omite o que não tem). */
const definidos = (o: Json): Json => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export type ContaDoAviso = {
  waba?: string;
  /** null = bloco sem `metadata` (o parser descarta: T18). */
  numero?: string | null;
  telefoneEmpresa?: string;
};

const metadata = (o: ContaDoAviso) =>
  o.numero === null ? {} : { metadata: { display_phone_number: o.telefoneEmpresa ?? FICTICIOS.telefoneEmpresa, phone_number_id: o.numero ?? FICTICIOS.numero } };

/** Um corpo com uma entrada e um bloco (`change`). */
export function corpoComBloco(campo: string, value: Json, o: { waba?: string; time?: number | string } = {}): Json {
  return { object: "whatsapp_business_account", entry: [definidos({ id: o.waba ?? FICTICIOS.waba, time: o.time, changes: [{ value, field: campo }] })] };
}

/** Junta as entradas de vários corpos num corpo só (a Meta agrupa até 1.000 atualizações por POST). */
export function juntarCorpos(...corpos: Json[]): Json {
  return { object: "whatsapp_business_account", entry: corpos.flatMap((c) => (Array.isArray(c.entry) ? c.entry : [])) };
}

/** Um item de `contacts[]`. Padrão: o `wa_id` canário e o nome de perfil canário. */
export function contatoDoAviso(o: { waId?: string | null; bsuid?: string; nome?: string | null } = {}): Json {
  const nome = o.nome === undefined ? CANARIOS.nomePerfil : o.nome;
  return definidos({ profile: nome === null ? undefined : { name: nome }, wa_id: o.waId === undefined ? CANARIOS.waIdBr : (o.waId ?? undefined), user_id: o.bsuid });
}

export type ItemDoAviso = {
  id?: string;
  de?: string | null;
  deUsuario?: string;
  para?: string;
  paraUsuario?: string;
  em?: Date | string | number;
  tipo?: string;
  /** O objeto do tipo (`text`, `image`, `edit`…). Padrão do `text`: o texto canário. */
  conteudo?: unknown;
  respostaA?: string;
  extra?: Json;
};

/**
 * Um item de `messages[]`, `message_echoes[]` ou `threads[].messages[]`. Padrão: texto canário, wamid canário, do `wa_id`
 * canário, na hora padrão. `de: null` omite o `from`.
 */
export function itemDoAviso(o: ItemDoAviso = {}): Json {
  const tipo = o.tipo ?? "text";
  const em = o.em ?? HORA_DO_AVISO;
  return definidos({
    from: o.de === undefined ? CANARIOS.waIdBr : (o.de ?? undefined),
    from_user_id: o.deUsuario,
    to: o.para,
    to_user_id: o.paraUsuario,
    id: o.id ?? CANARIOS.wamid,
    timestamp: em instanceof Date ? emSegundos(em) : em,
    type: tipo,
    context: o.respostaA ? { id: o.respostaA } : undefined,
    [tipo]: o.conteudo ?? (tipo === "text" ? { body: CANARIOS.texto } : undefined),
    ...o.extra,
  });
}

/** Um eco (mensagem mandada pelo celular): `from` = o telefone da empresa; `to` = o `wa_id` canário. */
export const ecoDoAviso = (o: ItemDoAviso = {}): Json => itemDoAviso({ de: FICTICIOS.telefoneEmpresa, para: CANARIOS.waIdBr, ...o });

/** Campo `messages`: `contacts[]` (padrão: o contato canário), `messages[]`, `statuses[]` e `errors[]`. */
export function avisoDeMensagens(o: ContaDoAviso & { mensagens?: unknown[]; contatos?: unknown[]; statuses?: unknown[]; erros?: unknown[] } = {}): Json {
  return corpoComBloco(
    "messages",
    definidos({ messaging_product: "whatsapp", ...metadata(o), contacts: o.contatos ?? [contatoDoAviso()], messages: o.mensagens ?? [itemDoAviso()], statuses: o.statuses, errors: o.erros }),
    o,
  );
}

/** Campo `smb_message_echoes`: `message_echoes[]` (padrão: um eco de texto) e, só se dado, `contacts[]`. */
export function avisoDeEcos(o: ContaDoAviso & { ecos?: unknown[]; contatos?: unknown[] } = {}): Json {
  return corpoComBloco("smb_message_echoes", definidos({ messaging_product: "whatsapp", ...metadata(o), contacts: o.contatos, message_echoes: o.ecos ?? [ecoDoAviso()] }), o);
}

/** Uma conversa do histórico (`threads[]`): `id` (padrão: o `wa_id` canário), `context` e as mensagens. */
export function conversaDoHistorico(o: { id?: string | null; waId?: string; bsuid?: string; mensagens?: unknown[] } = {}): Json {
  const contexto = definidos({ wa_id: o.waId, user_id: o.bsuid });
  return definidos({
    id: o.id === undefined ? CANARIOS.waIdBr : (o.id ?? undefined),
    context: Object.keys(contexto).length ? contexto : undefined,
    messages: o.mensagens ?? [itemDoAviso({ extra: { history_context: { status: "READ" } } })],
  });
}

/** Um pedaço do histórico (`history[]`): `metadata` (fase, ordem, progresso) e as conversas. */
export function pedacoDoHistorico(o: { fase?: number; ordem?: number; progresso?: number; conversas?: unknown[] } = {}): Json {
  return { metadata: { phase: o.fase ?? 0, chunk_order: o.ordem ?? 1, progress: o.progresso ?? 55 }, threads: o.conversas ?? [conversaDoHistorico()] };
}

/** Campo `history`: os pedaços (formato a) e, para a mídia que chega depois (formato b), `messages[]`/`message_echoes[]`. */
export function avisoDeHistorico(o: ContaDoAviso & { pedacos?: unknown[]; mensagens?: unknown[]; ecos?: unknown[]; contatos?: unknown[] } = {}): Json {
  const tardia = o.mensagens !== undefined || o.ecos !== undefined;
  return corpoComBloco(
    "history",
    definidos({ messaging_product: "whatsapp", ...metadata(o), contacts: o.contatos, messages: o.mensagens, message_echoes: o.ecos, history: o.pedacos ?? (tardia ? undefined : [pedacoDoHistorico()]) }),
    o,
  );
}

/** O erro 2593109 (a empresa recusou o histórico no aplicativo), como na referência de history. */
export const ERRO_HISTORICO_RECUSADO = {
  code: 2593109,
  title: "History sync is turned off by the business from the WhatsApp Business App",
  message: "History sync is turned off by the business from the WhatsApp Business App",
  error_data: { details: "History sharing is turned off by the business" },
} as const;

/** Histórico recusado: sem envelope (como o exemplo da referência) ou com o envelope completo ([não confirmado]). */
export function avisoDeHistoricoRecusado(o: ContaDoAviso & { comEnvelope?: boolean } = {}): Json {
  const value = { messaging_product: "whatsapp", ...metadata(o), history: [{ errors: [ERRO_HISTORICO_RECUSADO] }] };
  return o.comEnvelope ? corpoComBloco("history", value, o) : value;
}

/** Um item da agenda (`state_sync[]`). `remove` sai sem nome, como na referência. */
export function itemDaAgenda(o: { acao?: "add" | "remove"; telefone?: string | null; bsuid?: string; nome?: string; primeiroNome?: string; em?: Date | string | number } = {}): Json {
  const acao = o.acao ?? "add";
  const em = o.em ?? HORA_DO_AVISO;
  const contato = definidos({
    full_name: acao === "add" ? (o.nome ?? CANARIOS.nomeAgenda) : undefined,
    first_name: acao === "add" ? o.primeiroNome : undefined,
    phone_number: o.telefone === undefined ? CANARIOS.waIdBr : (o.telefone ?? undefined),
    user_id: o.bsuid,
  });
  return { type: "contact", contact: contato, action: acao, metadata: { timestamp: em instanceof Date ? emSegundos(em) : em } };
}

/** Campo `smb_app_state_sync` (a agenda do celular). */
export function avisoDeAgenda(o: ContaDoAviso & { itens?: unknown[] } = {}): Json {
  return corpoComBloco("smb_app_state_sync", { messaging_product: "whatsapp", ...metadata(o), state_sync: o.itens ?? [itemDaAgenda()] }, o);
}

/**
 * Campo `account_update`. Padrão no formato da referência: `entry.id` = o id do parceiro (`FICTICIOS.outraWaba`) e
 * `waba_info.waba_id` = a WABA. `wabaInfo: null` omite o `waba_info` (formato da página de coexistência, com `entry.id`
 * = a WABA e `phone_number`).
 */
export function avisoDeConta(o: {
  evento: string;
  em?: Date | number | string | null;
  entrada?: string;
  wabaInfo?: string | null;
  motivo?: string;
  iniciadoPor?: string;
  banimento?: string;
  telefone?: string;
} = { evento: "PARTNER_ADDED" }): Json {
  const em = o.em === undefined ? HORA_DO_AVISO : o.em;
  const desconexao = definidos({ reason: o.motivo, initiated_by: o.iniciadoPor });
  const value = definidos({
    phone_number: o.telefone,
    event: o.evento,
    waba_info: o.wabaInfo === null ? undefined : { waba_id: o.wabaInfo ?? FICTICIOS.waba },
    disconnection_info: Object.keys(desconexao).length ? desconexao : undefined,
    ban_info: o.banimento ? { waba_ban_state: o.banimento } : undefined,
  });
  return corpoComBloco("account_update", value, {
    waba: o.entrada ?? (o.wabaInfo === null ? FICTICIOS.waba : FICTICIOS.outraWaba),
    time: em === null ? undefined : em instanceof Date ? Math.floor(em.getTime() / 1000) : em,
  });
}
