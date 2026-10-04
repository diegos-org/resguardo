/**
 * Aceites do "Como funciona" (M5.6): o usuário do portal aceita a versão publicada em nome de cada proprietário que
 * ele representa, e fica registrado quem, quando e qual versão. Versão nova pede aceite novo; os antigos ficam.
 * Deny-by-default: só sessão de proprietário, só os proprietários ligados a ela no servidor; o número da versão
 * aceita tem de ser o da versão publicada agora (o texto pode ter mudado enquanto a página estava aberta).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Sessao } from "@/acesso/politica";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { travarConfig } from "@/configuracoes/armazem";
import { DOCUMENTO_COMO_FUNCIONA, lerComoFunciona, type VersaoComoFunciona, versaoAtual } from "@/configuracoes/como-funciona";
import { aceitesDocumento, proprietarios, proprietarioUsuarios, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { proprietariosDoUsuario } from "./resumo";

export type Aceite = { versao: number; aceitoEm: Date; usuarioId: string; email: string };

async function aceitesDe(db: Db, organizacaoId: string, proprietarioIds: readonly string[]): Promise<Map<string, Aceite[]>> {
  const mapa = new Map<string, Aceite[]>(proprietarioIds.map((id) => [id, []]));
  if (!proprietarioIds.length) return mapa;
  const linhas = await db
    .select({ proprietarioId: aceitesDocumento.proprietarioId, versao: aceitesDocumento.versao, aceitoEm: aceitesDocumento.aceitoEm, usuarioId: aceitesDocumento.usuarioId, email: usuarios.email })
    .from(aceitesDocumento)
    .innerJoin(usuarios, eq(usuarios.id, aceitesDocumento.usuarioId))
    .where(and(eq(aceitesDocumento.organizacaoId, organizacaoId), eq(aceitesDocumento.documento, DOCUMENTO_COMO_FUNCIONA), inArray(aceitesDocumento.proprietarioId, [...proprietarioIds])))
    .orderBy(desc(aceitesDocumento.versao), desc(aceitesDocumento.aceitoEm));
  for (const l of linhas) mapa.get(l.proprietarioId)?.push({ versao: l.versao, aceitoEm: l.aceitoEm, usuarioId: l.usuarioId, email: l.email });
  return mapa;
}

export type SituacaoNoPortal = {
  atual: VersaoComoFunciona | null;
  /** Cada proprietário do usuário: o aceite da versão atual (de qualquer usuário dele) e o último aceite de qualquer versão. */
  donos: { id: string; nome: string; aceiteAtual: Aceite | null; ultimo: Aceite | null }[];
  /** Há versão publicada e algum proprietário do usuário ainda não a aceitou. */
  pendente: boolean;
};

/** O que o portal mostra ao usuário: versão publicada e, por proprietário dele, se já aceitou. */
export async function situacaoNoPortal(db: Db, organizacaoId: string, usuarioId: string): Promise<SituacaoNoPortal> {
  const [atual, donos] = await Promise.all([lerComoFunciona(db, organizacaoId).then(versaoAtual), proprietariosDoUsuario(db, organizacaoId, usuarioId)]);
  const aceites = await aceitesDe(db, organizacaoId, donos.map((d) => d.id));
  const lista = [...donos]
    .sort((a, b) => a.nome.localeCompare(b.nome) || a.id.localeCompare(b.id))
    .map((d) => {
      const dele = aceites.get(d.id) ?? [];
      return { id: d.id, nome: d.nome, aceiteAtual: atual ? (dele.find((a) => a.versao === atual.numero) ?? null) : null, ultimo: dele[0] ?? null };
    });
  return { atual, donos: lista, pendente: Boolean(atual) && lista.some((d) => !d.aceiteAtual) };
}

/**
 * Registra o aceite da versão `versao` para todos os proprietários do usuário da sessão. Recusa sessão que não é de
 * proprietário, usuário sem proprietário ligado, documento sem versão publicada e versão diferente da atual. A
 * conferência da versão e a gravação ficam na mesma transação, sob a trava da configuração que a publicação usa: uma
 * versão publicada no meio não deixa passar um aceite da versão velha.
 */
export async function registrarAceite(db: Db, sessao: Sessao, versao: number, agora = new Date()): Promise<{ ok: true; proprietarios: number } | { ok: false; erro: string }> {
  if (sessao.papel !== "proprietario" || !uuidValido(sessao.usuarioId)) return { ok: false, erro: "Só o proprietário, pelo portal, aceita o documento." };
  const donos = await proprietariosDoUsuario(db, sessao.organizacaoId, sessao.usuarioId);
  if (!donos.length) return { ok: false, erro: "Nenhum proprietário ligado ao seu acesso: fale com a empresa." };
  return db.transaction(async (tx) => {
    const atual = await versaoPublicadaTravada(tx, sessao.organizacaoId);
    if (!atual) return { ok: false as const, erro: "O documento ainda não foi publicado." };
    if (!Number.isInteger(versao) || versao !== atual.numero) return { ok: false as const, erro: `O documento mudou (versão ${atual.numero}, de ${dataBr(atual.data)}): leia a versão atual e aceite de novo.` };
    let n = 0;
    for (const d of donos) {
      if (await gravarAceite(tx, { organizacaoId: sessao.organizacaoId, proprietarioId: d.id, usuarioId: sessao.usuarioId, versao }, agora)) n++;
    }
    return { ok: true as const, proprietarios: n };
  });
}

/** Versão publicada lida sob a trava da configuração `como_funciona` (até o fim da transação): ninguém publica no meio. */
async function versaoPublicadaTravada(tx: Db, organizacaoId: string): Promise<VersaoComoFunciona | null> {
  await travarConfig(tx, organizacaoId, "como_funciona");
  return versaoAtual(await lerComoFunciona(tx, organizacaoId));
}

/** Insere (uma vez) e registra na auditoria do proprietário. Devolve false se já havia o mesmo aceite. */
async function gravarAceite(tx: Db, a: { organizacaoId: string; proprietarioId: string; usuarioId: string; versao: number }, agora: Date): Promise<boolean> {
  const [novo] = await tx
    .insert(aceitesDocumento)
    .values({ organizacaoId: a.organizacaoId, documento: DOCUMENTO_COMO_FUNCIONA, versao: a.versao, proprietarioId: a.proprietarioId, usuarioId: a.usuarioId, aceitoEm: agora })
    .onConflictDoNothing()
    .returning({ id: aceitesDocumento.id });
  if (!novo) return false;
  await registrarAuditoria(tx, {
    organizacaoId: a.organizacaoId,
    usuarioId: a.usuarioId,
    acao: "como_funciona.aceitar",
    entidade: "proprietario",
    entidadeId: a.proprietarioId,
    mudancas: { comoFunciona: [null, `versão ${a.versao} aceita`] },
  });
  return true;
}

/**
 * Aceite feito no convite (M5.6): a pessoa marcou "li e aceito" na página do link e o aceite é gravado quando o
 * convite é aceito no login, dentro da mesma transação (sob a mesma trava da publicação). Só vale se a versão marcada
 * ainda é a publicada; senão o portal pede o aceite da versão nova.
 */
export async function registrarAceiteDoConvite(tx: Db, a: { organizacaoId: string; proprietarioId: string; usuarioId: string; versao: number }, agora = new Date()): Promise<boolean> {
  const atual = await versaoPublicadaTravada(tx, a.organizacaoId);
  if (!atual || atual.numero !== a.versao) return false;
  return gravarAceite(tx, a, agora);
}

/** Último aceite (qualquer versão, qualquer usuário) de um proprietário — para a página dele no painel. */
export async function ultimoAceite(db: Db, organizacaoId: string, proprietarioId: string): Promise<Aceite | null> {
  if (!uuidValido(proprietarioId)) return null;
  return (await aceitesDe(db, organizacaoId, [proprietarioId])).get(proprietarioId)?.[0] ?? null;
}

export type SituacaoDoProprietario = { proprietarioId: string; nome: string; ativo: boolean; temAcesso: boolean; aceite: Aceite | null; aceitouAtual: boolean };

/** Para o painel: cada proprietário da organização, se tem acesso ao portal e o último aceite (qualquer versão). */
export async function situacaoDosProprietarios(db: Db, organizacaoId: string, atual: VersaoComoFunciona | null): Promise<SituacaoDoProprietario[]> {
  const donos = await db.select({ id: proprietarios.id, nome: proprietarios.nome, ativo: proprietarios.ativo }).from(proprietarios).where(eq(proprietarios.organizacaoId, organizacaoId)).orderBy(proprietarios.nome, proprietarios.id);
  if (!donos.length) return [];
  const ids = donos.map((d) => d.id);
  const [acessos, aceites] = await Promise.all([
    db
      .select({ proprietarioId: proprietarioUsuarios.proprietarioId })
      .from(proprietarioUsuarios)
      .innerJoin(usuarios, and(eq(usuarios.id, proprietarioUsuarios.usuarioId), eq(usuarios.ativo, true)))
      .where(inArray(proprietarioUsuarios.proprietarioId, ids)),
    aceitesDe(db, organizacaoId, ids),
  ]);
  const comAcesso = new Set(acessos.map((a) => a.proprietarioId));
  return donos.map((d) => {
    const aceite = aceites.get(d.id)?.[0] ?? null;
    return { proprietarioId: d.id, nome: d.nome, ativo: d.ativo, temAcesso: comAcesso.has(d.id), aceite, aceitouAtual: Boolean(atual && aceite && aceite.versao === atual.numero) };
  });
}

export const dataBr = (d: string) => d.split("-").reverse().join("/");
