/**
 * Consultas das conversas do WhatsApp para as telas (M10.1a, desenho na seção "Vínculo" de
 * `requisitos/product/WHATSAPP.md`): a caixa de entrada, a conversa, o bloco da ficha da reserva, a contagem do Início
 * e o "lida" (estado interno: nada é marcado como lido na Meta). Só leitura, menos `marcarComoLida`.
 *
 * Acesso: todas começam por `exigirVerConversas` (whatsapp/acesso.ts) e filtram pela organização da sessão, menos
 * `contarConversasSemResposta`, que devolve 0 para quem não vê as conversas sem consultar `whatsapp_contatos` (quem
 * reaproveitar o Início, como o `ver_pendencias` do MCP, não tem como mostrar a contagem a quem não pode). O vínculo
 * confirmado sai pelo `vinculosNaTela` (whatsapp/vinculo.ts): quem não lê o alvo vê só o rótulo genérico.
 *
 * Erro de banco sem dado pessoal: toda função que consulta passa por `semDadosNoErro` (a mensagem do erro de consulta
 * da drizzle-orm traz os parâmetros, e o Next a imprime no registro da Vercel).
 */
import { and, asc, count, desc, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import type { Sessao } from "@/acesso/politica";
import { cotacoes, reservas, usuarios, whatsappContatos, whatsappMensagens } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { ehCodigoDeReserva } from "@/reservas/regras";
import { codigoCotacaoValido } from "@/site/codigo-cotacao";
import { exigirVerConversas, podeVerConversas } from "./acesso";
import { type Direcao, type Origem, TIPOS_MENSAGEM, type TipoMensagem } from "./regras";
import { chavesDeTelefone, formatarWaId } from "./telefone";
import { type Alvo, alvoDaConversa, chaveDoAlvo, conversasQueSugeremAReserva, mensagemComCodigo, semDadosNoErro, type VinculoNaTela, vinculosNaTela } from "./vinculo";

export const FILTROS_CONVERSAS = ["todas", "sem_resposta", "sem_vinculo"] as const;
export type FiltroConversas = (typeof FILTROS_CONVERSAS)[number];

/** Conversas por página da caixa de entrada. */
export const CONVERSAS_POR_PAGINA = 50;
/** Mensagens mostradas na conversa (as mais recentes, em ordem de envio). */
export const MENSAGENS_NA_CONVERSA = 200;
/** Na ficha da reserva: conversas confirmadas, mensagens de cada uma e conversas conferidas para a sugestão. */
const CONVERSAS_NA_FICHA = 3;
const MENSAGENS_NA_FICHA = 3;
const SUGERIDAS_CONFERIDAS = 20;
/** Tamanho da prévia na lista. */
export const LIMITE_PREVIA = 80;

/** Uma regra só (T13): a última recebida em tempo real é mais nova que a última enviada em tempo real (o eco conta). */
export const semResposta = (c = whatsappContatos): SQL =>
  sql`${c.ultimaRecebidaEm} is not null and (${c.ultimaEnviadaEm} is null or ${c.ultimaEnviadaEm} < ${c.ultimaRecebidaEm})`;
/** Não lida: recebida em tempo real depois da última leitura e depois da última resposta (responder pelo celular lê). */
export const naoLida = (c = whatsappContatos): SQL =>
  sql`${c.ultimaRecebidaEm} is not null and ${c.ultimaRecebidaEm} > greatest(coalesce(${c.lidaAte}, '-infinity'), coalesce(${c.ultimaEnviadaEm}, '-infinity'))`;

/** O nome da conversa: o da agenda do celular, senão o do perfil do WhatsApp. */
export const nomeDaConversa = (c: { nomeAgenda: string; nomePerfil: string }): string => c.nomeAgenda || c.nomePerfil || "Contato sem nome";

/** Como cada tipo aparece. Anexo, localização e contato compartilhado não são baixados: "ver no celular" (T14). */
export const ROTULO_TIPO: Record<TipoMensagem, string> = {
  texto: "Mensagem de texto",
  imagem: "Foto — ver no celular",
  audio: "Áudio — ver no celular",
  video: "Vídeo — ver no celular",
  documento: "Documento — ver no celular",
  figurinha: "Figurinha — ver no celular",
  localizacao: "Localização — ver no celular",
  contato: "Contato compartilhado — ver no celular",
  nao_suportada: "Mensagem que o sistema não consegue mostrar — ver no celular",
  sistema: "Aviso do WhatsApp: o contato mudou de número ou de identificação",
  outro: "Mensagem de um tipo que o sistema não mostra — ver no celular",
  pendente: "Mensagem ainda não recebida pelo sistema — ver no celular",
  midia_pendente: "Anexo ainda não recebido — ver no celular",
};

type MensagemParaMostrar = { tipo: TipoMensagem; texto: string; apagadaEm: Date | null };

/**
 * O conteúdo inteiro, como a conversa mostra: o texto; nos outros tipos, o rótulo e, depois dele, a legenda (ou o texto
 * guardado); apagada → "Mensagem apagada". Tipo fora da lista (texto torto no banco) vale `outro`.
 */
export function conteudoDaMensagem(m: MensagemParaMostrar): string {
  if (m.apagadaEm) return "Mensagem apagada";
  const tipo: TipoMensagem = (TIPOS_MENSAGEM as readonly string[]).includes(m.tipo) ? m.tipo : "outro";
  if (tipo === "texto") return m.texto || ROTULO_TIPO.texto;
  return m.texto ? `${ROTULO_TIPO[tipo]}: ${m.texto}` : ROTULO_TIPO[tipo];
}

/** A prévia da lista: o conteúdo numa linha só, com até 80 caracteres (sem partir um emoji). */
export function previaDaMensagem(m: MensagemParaMostrar): string {
  const linha = conteudoDaMensagem(m).replace(/\s+/g, " ").trim();
  const letras = Array.from(linha);
  return letras.length <= LIMITE_PREVIA ? linha : `${letras.slice(0, LIMITE_PREVIA - 1).join("").trimEnd()}…`;
}

export type ResumoConversa = {
  id: string;
  nome: string;
  /** `formatarWaId`; null = contato só com nome de usuário (BSUID), sem número. */
  telefone: string | null;
  ultimaMensagemEm: Date | null;
  previa: string;
  naoLida: boolean;
  semResposta: boolean;
  vinculo: VinculoNaTela | null;
  conflitoIdentidade: boolean;
};

export type MensagemNaTela = {
  id: string;
  direcao: Direcao;
  origem: Origem;
  tipo: TipoMensagem;
  /** `conteudoDaMensagem`, sem cortar. */
  conteudo: string;
  enviadaEm: Date;
  editadaEm: Date | null;
  apagadaEm: Date | null;
  reacao: string | null;
};

export type ConversaCompleta = Omit<ResumoConversa, "previa" | "vinculo"> & {
  /** Para o "lida": a tela marca até a última recebida que mostrou. */
  ultimaRecebidaEm: Date | null;
  /** Mais quem confirmou (null = usuário removido) e quando. */
  vinculo: (VinculoNaTela & { confirmadoPor: string | null; confirmadoEm: Date }) | null;
  mensagens: MensagemNaTela[];
  /** Há mensagens mais antigas que as 200 mostradas. */
  maisMensagens: boolean;
};

export type ConversaNaFicha = {
  id: string;
  nome: string;
  ultimaMensagemEm: Date | null;
  /** As últimas mensagens, da mais antiga para a mais nova. */
  mensagens: { id: string; direcao: Direcao; previa: string; enviadaEm: Date }[];
};

const c = whatsappContatos;
const m = whatsappMensagens;

const COLUNAS_DO_RESUMO = {
  id: c.id,
  waId: c.waId,
  nomePerfil: c.nomePerfil,
  nomeAgenda: c.nomeAgenda,
  ultimaMensagemEm: c.ultimaMensagemEm,
  conflitoIdentidade: c.conflitoIdentidade,
  reservaId: c.reservaId,
  cotacaoId: c.cotacaoId,
  pedidoContatoId: c.pedidoContatoId,
  cadastroMarketplaceId: c.cadastroMarketplaceId,
  proprietarioId: c.proprietarioId,
  naoLida: sql<boolean>`(${naoLida(c)})`,
  semResposta: sql<boolean>`(${semResposta(c)})`,
};

/** A ordem da lista: mais recente primeiro, conversa sem mensagem no fim (a mesma do índice `whatsapp_contatos_ultima`). */
const MAIS_RECENTE_PRIMEIRO = [sql`${c.ultimaMensagemEm} desc nulls last`, desc(c.id)];

const telefoneDa = (waId: string | null) => (waId ? formatarWaId(waId) : null);

/**
 * A caixa de entrada: 50 conversas por página, mais recente primeiro. Filtro fora da lista vale "todas"; página fora
 * do intervalo vale a mais próxima. Cada linha com a prévia da última mensagem e o vínculo como a sessão pode ver.
 */
export async function listarConversas(
  db: Db,
  sessao: Sessao,
  o: { filtro: FiltroConversas; pagina: number },
): Promise<{ itens: ResumoConversa[]; total: number; pagina: number; paginas: number }> {
  return semDadosNoErro(async () => {
    await exigirVerConversas(db, sessao);
    const org = sessao.organizacaoId;
    const filtro: FiltroConversas = (FILTROS_CONVERSAS as readonly string[]).includes(o.filtro) ? o.filtro : "todas";
    const onde = and(eq(c.organizacaoId, org), filtro === "sem_resposta" ? semResposta(c) : filtro === "sem_vinculo" ? isNull(c.vinculoConfirmadoEm) : undefined);
    const [{ total }] = await db.select({ total: count() }).from(c).where(onde);
    const paginas = Math.max(1, Math.ceil(total / CONVERSAS_POR_PAGINA));
    const pagina = Math.min(paginas, Math.max(1, Number.isFinite(o.pagina) ? Math.trunc(o.pagina) : 1));
    const linhas = await db
      .select(COLUNAS_DO_RESUMO)
      .from(c)
      .where(onde)
      .orderBy(...MAIS_RECENTE_PRIMEIRO)
      .limit(CONVERSAS_POR_PAGINA)
      .offset((pagina - 1) * CONVERSAS_POR_PAGINA);
    if (!linhas.length) return { itens: [], total, pagina, paginas };

    const ultimas = await db
      .selectDistinctOn([m.contatoId], { contatoId: m.contatoId, tipo: m.tipo, texto: m.texto, apagadaEm: m.apagadaEm })
      .from(m)
      .where(and(eq(m.organizacaoId, org), inArray(m.contatoId, linhas.map((l) => l.id))))
      .orderBy(m.contatoId, desc(m.enviadaEm), desc(m.recebidaEm), desc(m.id));
    const ultimaDe = new Map(ultimas.map((u) => [u.contatoId, u]));
    const alvos = linhas.map(alvoDaConversa).filter((a): a is Alvo => a !== null);
    const vinculos = alvos.length ? await vinculosNaTela(db, sessao, alvos) : new Map<string, VinculoNaTela>();

    const itens = linhas.map((l): ResumoConversa => {
      const alvo = alvoDaConversa(l);
      const ultima = ultimaDe.get(l.id);
      return {
        id: l.id,
        nome: nomeDaConversa(l),
        telefone: telefoneDa(l.waId),
        ultimaMensagemEm: l.ultimaMensagemEm,
        previa: ultima ? previaDaMensagem(ultima) : "",
        naoLida: l.naoLida,
        semResposta: l.semResposta,
        vinculo: alvo ? (vinculos.get(chaveDoAlvo(alvo)) ?? null) : null,
        conflitoIdentidade: l.conflitoIdentidade,
      };
    });
    return { itens, total, pagina, paginas };
  });
}

/** A conversa (até as 200 mensagens mais recentes, em ordem de envio). Outra organização ou id malformado → null. */
export async function obterConversa(db: Db, sessao: Sessao, contatoId: string): Promise<ConversaCompleta | null> {
  return semDadosNoErro(async () => {
    await exigirVerConversas(db, sessao);
    if (!uuidValido(contatoId)) return null;
    const org = sessao.organizacaoId;
    const [l] = await db
      .select({ ...COLUNAS_DO_RESUMO, ultimaRecebidaEm: c.ultimaRecebidaEm, vinculoConfirmadoEm: c.vinculoConfirmadoEm, confirmadoPor: usuarios.nome })
      .from(c)
      .leftJoin(usuarios, and(eq(usuarios.id, c.vinculoConfirmadoPor), eq(usuarios.organizacaoId, org)))
      .where(and(eq(c.id, contatoId), eq(c.organizacaoId, org)));
    if (!l) return null;

    const recentes = await db
      .select({ id: m.id, direcao: m.direcao, origem: m.origem, tipo: m.tipo, texto: m.texto, enviadaEm: m.enviadaEm, editadaEm: m.editadaEm, apagadaEm: m.apagadaEm, reacao: m.reacao })
      .from(m)
      .where(and(eq(m.organizacaoId, org), eq(m.contatoId, l.id)))
      .orderBy(desc(m.enviadaEm), desc(m.recebidaEm), desc(m.id))
      .limit(MENSAGENS_NA_CONVERSA + 1);
    const mensagens = recentes
      .slice(0, MENSAGENS_NA_CONVERSA)
      .reverse()
      .map(({ texto, ...x }): MensagemNaTela => ({ ...x, conteudo: conteudoDaMensagem({ tipo: x.tipo, texto, apagadaEm: x.apagadaEm }) }));

    const alvo = alvoDaConversa(l);
    const visto = alvo ? (await vinculosNaTela(db, sessao, [alvo])).get(chaveDoAlvo(alvo)) : undefined;
    return {
      id: l.id,
      nome: nomeDaConversa(l),
      telefone: telefoneDa(l.waId),
      ultimaMensagemEm: l.ultimaMensagemEm,
      ultimaRecebidaEm: l.ultimaRecebidaEm,
      naoLida: l.naoLida,
      semResposta: l.semResposta,
      conflitoIdentidade: l.conflitoIdentidade,
      vinculo: visto && l.vinculoConfirmadoEm ? { ...visto, confirmadoPor: l.confirmadoPor ?? null, confirmadoEm: l.vinculoConfirmadoEm } : null,
      mensagens,
      maisMensagens: recentes.length > MENSAGENS_NA_CONVERSA,
    };
  });
}

/**
 * O bloco "Conversa no WhatsApp" da ficha da reserva: as conversas confirmadas com a reserva (até 3, com as 3 últimas
 * mensagens) e quantas conversas sem vínculo teriam a reserva como sugestão. Pré-filtro (o código da reserva, ou de
 * uma cotação que virou esta reserva, escrito numa mensagem; o `wa_id` igual a uma chave do telefone do hóspede) e
 * conferência pela mesma regra das sugestões da conversa (`whatsapp/vinculo.ts`), até 20 conversas. Reserva de outra
 * organização: nada.
 */
export async function conversasDaReserva(db: Db, sessao: Sessao, reservaId: string, agora: Date = new Date()): Promise<{ confirmadas: ConversaNaFicha[]; sugeridas: number }> {
  return semDadosNoErro(async () => {
    await exigirVerConversas(db, sessao);
    const vazio = { confirmadas: [], sugeridas: 0 };
    if (!uuidValido(reservaId)) return vazio;
    const org = sessao.organizacaoId;
    const [reserva] = await db.select({ codigo: reservas.codigo, telefone: reservas.hospedeTelefone }).from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, org)));
    if (!reserva) return vazio;

    const ligadas = await db
      .select({ id: c.id, nomePerfil: c.nomePerfil, nomeAgenda: c.nomeAgenda, ultimaMensagemEm: c.ultimaMensagemEm })
      .from(c)
      .where(and(eq(c.organizacaoId, org), eq(c.reservaId, reservaId)))
      .orderBy(...MAIS_RECENTE_PRIMEIRO)
      .limit(CONVERSAS_NA_FICHA);
    const confirmadas: ConversaNaFicha[] = [];
    for (const l of ligadas) {
      const ultimas = await db
        .select({ id: m.id, direcao: m.direcao, tipo: m.tipo, texto: m.texto, apagadaEm: m.apagadaEm, enviadaEm: m.enviadaEm })
        .from(m)
        .where(and(eq(m.organizacaoId, org), eq(m.contatoId, l.id)))
        .orderBy(desc(m.enviadaEm), desc(m.recebidaEm), desc(m.id))
        .limit(MENSAGENS_NA_FICHA);
      confirmadas.push({
        id: l.id,
        nome: nomeDaConversa(l),
        ultimaMensagemEm: l.ultimaMensagemEm,
        mensagens: ultimas.reverse().map((x) => ({ id: x.id, direcao: x.direcao, previa: previaDaMensagem(x), enviadaEm: x.enviadaEm })),
      });
    }

    // Pré-filtro das sugestões: só conversas sem vínculo, e o código só nas mensagens em que a sugestão o procura
    // (`mensagemComCodigo`, a mesma regra de `whatsapp/vinculo.ts`).
    const daCotacao = await db.select({ codigo: cotacoes.codigo }).from(cotacoes).where(and(eq(cotacoes.organizacaoId, org), eq(cotacoes.reservaId, reservaId)));
    const codigos = [reserva.codigo, ...daCotacao.map((x) => x.codigo)].filter((k) => ehCodigoDeReserva(k) || codigoCotacaoValido(k));
    const porCodigo = codigos.length
      ? await db
          .selectDistinct({ id: m.contatoId })
          .from(m)
          .innerJoin(c, eq(c.id, m.contatoId))
          .where(
            and(
              eq(m.organizacaoId, org),
              eq(c.organizacaoId, org),
              isNull(c.vinculoConfirmadoEm),
              mensagemComCodigo(m),
              or(...codigos.map((k) => sql`upper(${m.texto}) like ${`%${k}%`}`)),
            ),
          )
          .orderBy(asc(m.contatoId))
          .limit(SUGERIDAS_CONFERIDAS)
      : [];
    const chaves = chavesDeTelefone(reserva.telefone);
    const porTelefone = chaves.length
      ? await db.select({ id: c.id }).from(c).where(and(eq(c.organizacaoId, org), isNull(c.vinculoConfirmadoEm), inArray(c.waId, chaves))).orderBy(asc(c.id)).limit(SUGERIDAS_CONFERIDAS)
      : [];
    const conferir = [...new Set([...porCodigo, ...porTelefone].map((x) => x.id))].slice(0, SUGERIDAS_CONFERIDAS);
    const sugeridas = conferir.length ? (await conversasQueSugeremAReserva(db, sessao, conferir, reservaId, agora)).length : 0;
    return { confirmadas, sugeridas };
  });
}

/**
 * Quantas conversas da organização estão sem resposta (o Início). Deny-by-default como as outras, mas sem lançar: quem
 * não vê as conversas recebe 0, sem nenhuma consulta a `whatsapp_contatos`.
 */
export async function contarConversasSemResposta(db: Db, sessao: Sessao): Promise<number> {
  return semDadosNoErro(async () => {
    if (!(await podeVerConversas(db, sessao))) return 0;
    const [{ n }] = await db.select({ n: count() }).from(c).where(and(eq(c.organizacaoId, sessao.organizacaoId), semResposta(c)));
    return n;
  });
}

/**
 * Marca a conversa como lida até `ate` (a última recebida que a tela mostrou), nunca depois de `agora` e nunca para
 * trás: `lida_ate = greatest(lida_ate, least(ate, agora))`. Estado interno; nada vai para a Meta. Devolve se a conversa
 * existe na organização.
 */
export async function marcarComoLida(db: Db, sessao: Sessao, contatoId: string, ate: Date, agora: Date): Promise<boolean> {
  return semDadosNoErro(async () => {
    await exigirVerConversas(db, sessao);
    const valida = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());
    if (!uuidValido(contatoId) || !valida(ate) || !valida(agora)) return false;
    const r = await db
      .update(c)
      .set({ lidaAte: sql`greatest(${c.lidaAte}, least(${ate.toISOString()}::timestamptz, ${agora.toISOString()}::timestamptz))` })
      .where(and(eq(c.id, contatoId), eq(c.organizacaoId, sessao.organizacaoId)))
      .returning({ id: c.id });
    return r.length > 0;
  });
}
