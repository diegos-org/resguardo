/**
 * Calendário do proprietário no portal (M5.5): bloqueio de uso próprio e liberação das datas,
 * conforme a permissão do contrato em vigor. A mudança entra no SCL na hora (como um bloqueio
 * manual da equipe, com fonte "proprietario") e segue para o Beds24/OTAs pelo envio de
 * calendário (M3.7). Toda decisão é tomada no servidor, a partir da sessão autenticada.
 */
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { exigir, type Sessao } from "@/acesso/politica";
import { contratoVigente } from "@/contratos/regras";
import { contratos, bloqueios, imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { criarBloqueio, excluirBloqueio, type ResultadoBloqueio, type ResultadoRemocao, validarBloqueio } from "@/reservas/bloqueios";

export type EntradaBloqueioPortal = { imovelId: string; inicio: string; fim: string; motivo: string };
export type BloqueioDoProprietario = { id: string; imovelId: string; codigo: string; inicio: string; fim: string; motivo: string; fonte: string; liberavel: boolean };

const SEM_PERMISSAO = "Seu contrato não prevê bloqueio de datas pelo portal. Fale com a empresa.";
const SEM_CONTRATO = "Não há contrato em vigor para essas datas. Fale com a empresa.";

/**
 * Permissão do contrato em vigor em `dia` para cada imóvel: `true` (pode bloquear), `false` (contrato
 * em vigor sem a permissão) ou `null` (sem contrato em vigor). Uma regra, um lugar: o portal mostra e o
 * servidor decide com a mesma função.
 */
export async function permissoesDeBloqueio(db: Db, organizacaoId: string, imovelIds: readonly string[], dia: string): Promise<Map<string, boolean | null>> {
  const ids = imovelIds.filter(uuidValido);
  const mapa = new Map<string, boolean | null>(ids.map((id) => [id, null]));
  if (!ids.length) return mapa;
  const lista = await db
    .select({ imovelId: contratos.imovelId, tipo: contratos.tipo, comissaoBp: contratos.comissaoBp, inicio: contratos.inicio, fim: contratos.fim, proprietarioBloqueia: contratos.proprietarioBloqueia })
    .from(contratos)
    .where(and(eq(contratos.organizacaoId, organizacaoId), inArray(contratos.imovelId, ids)));
  for (const id of ids) {
    const vigente = contratoVigente(lista.filter((c) => c.imovelId === id), dia);
    mapa.set(id, vigente ? vigente.proprietarioBloqueia : null);
  }
  return mapa;
}

/** Bloqueia datas de uso próprio num imóvel do proprietário da sessão. Exige `bloqueio:proprio` no imóvel. */
export async function bloquearPeloProprietario(db: Db, sessao: Sessao, e: EntradaBloqueioPortal, agora = new Date()): Promise<ResultadoBloqueio> {
  const v = validarBloqueio(e);
  if (!v.ok) return v;
  exigir(sessao, "bloqueio:proprio", { organizacaoId: sessao.organizacaoId, imovelId: v.dados.imovelId });
  const [im] = await db.select({ id: imoveis.id, fuso: imoveis.fuso }).from(imoveis).where(and(eq(imoveis.id, v.dados.imovelId), eq(imoveis.organizacaoId, sessao.organizacaoId)));
  if (!im) return { ok: false, erro: "Imóvel não encontrado." };
  // Nunca no passado: o passado não é recalculado nem enviado (data no fuso do imóvel).
  if (v.dados.inicio < hojeISO(im.fuso, agora)) return { ok: false, erro: "Só é possível bloquear a partir de hoje." };
  // Permissão do contrato em vigor na primeira noite bloqueada (e ainda em vigor na última).
  const ultimaNoite = new Date(Date.parse(`${v.dados.fim}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const [noInicio, noFim] = await Promise.all([permissoesDeBloqueio(db, sessao.organizacaoId, [im.id], v.dados.inicio), permissoesDeBloqueio(db, sessao.organizacaoId, [im.id], ultimaNoite)]);
  if (noInicio.get(im.id) === null || noFim.get(im.id) === null) return { ok: false, erro: SEM_CONTRATO };
  if (!noInicio.get(im.id) || !noFim.get(im.id)) return { ok: false, erro: SEM_PERMISSAO };
  return criarBloqueio(db, sessao.organizacaoId, { ...v.dados, motivo: v.dados.motivo || "Uso próprio" }, sessao.usuarioId, { fonte: "proprietario", semReserva: true });
}

/** Libera datas que o próprio proprietário bloqueou (bloqueio da empresa ou do Beds24 não é dele para liberar). */
export async function liberarPeloProprietario(db: Db, sessao: Sessao, bloqueioId: string, agora = new Date()): Promise<ResultadoRemocao> {
  if (!uuidValido(bloqueioId)) return { ok: false, erro: "Bloqueio não encontrado." };
  const [b] = await db
    .select({ id: bloqueios.id, imovelId: bloqueios.imovelId, fim: bloqueios.fim, fonte: bloqueios.fonte, fuso: imoveis.fuso })
    .from(bloqueios)
    .innerJoin(imoveis, eq(imoveis.id, bloqueios.imovelId))
    .where(and(eq(bloqueios.id, bloqueioId), eq(bloqueios.organizacaoId, sessao.organizacaoId)));
  if (!b) return { ok: false, erro: "Bloqueio não encontrado." };
  exigir(sessao, "bloqueio:proprio", { organizacaoId: sessao.organizacaoId, imovelId: b.imovelId });
  if (b.fim <= hojeISO(b.fuso, agora)) return { ok: false, erro: "Esse bloqueio já passou; não há datas a liberar." };
  return excluirBloqueio(db, sessao.organizacaoId, bloqueioId, sessao.usuarioId, { somenteFonte: "proprietario", imovelIds: sessao.imovelIds });
}

/** Bloqueios atuais e futuros dos imóveis do proprietário, com quem fez cada um; só os dele são liberáveis. */
export async function bloqueiosDoProprietario(db: Db, sessao: Sessao, agora = new Date()): Promise<BloqueioDoProprietario[]> {
  const ids = sessao.imovelIds.filter(uuidValido);
  if (!ids.length) return [];
  const hoje = hojeISO("America/Sao_Paulo", agora);
  const linhas = await db
    .select({ id: bloqueios.id, imovelId: bloqueios.imovelId, codigo: imoveis.codigo, inicio: bloqueios.inicio, fim: bloqueios.fim, motivo: bloqueios.motivo, fonte: bloqueios.fonte })
    .from(bloqueios)
    .innerJoin(imoveis, eq(imoveis.id, bloqueios.imovelId))
    .where(and(eq(bloqueios.organizacaoId, sessao.organizacaoId), inArray(bloqueios.imovelId, ids), gte(bloqueios.fim, hoje)))
    .orderBy(asc(bloqueios.inicio), asc(imoveis.codigo));
  return linhas.map((b) => ({ ...b, liberavel: b.fonte === "proprietario" && b.fim > hoje }));
}
