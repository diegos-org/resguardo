/**
 * Bloqueios manuais (M3.7): datas fechadas pelo SCL (uso próprio, manutenção). Vão ao
 * Beds24 como "blackout" pelo envio de calendário; os importados do Beds24 (fonte "beds24")
 * não são editados aqui — mudam na origem.
 */
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { esperarEnvioBeds24 } from "@/beds24/trava";
import { bloqueios, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { expirarAlteracoesVencidas } from "@/pagamentos/alteracao-prazo";
import { dataValida, ESTADOS_OCUPANTES } from "./regras";

export type EntradaBloqueio = { imovelId: string; inicio: string; fim: string; motivo: string };
export type ResultadoBloqueio = { ok: true; id: string } | { ok: false; erro: string };
export type ResultadoRemocao = { ok: true } | { ok: false; erro: string };
/** Quem fez o bloqueio no SCL: a equipe ("manual") ou o proprietário pelo portal (M5.5). Importados têm fonte "beds24". */
export type FonteBloqueioScl = "manual" | "proprietario";
export const NOMES_FONTE_BLOQUEIO: Record<string, string> = { manual: "SCL", proprietario: "Proprietário (portal)", beds24: "Beds24 (mude lá)" };
export type OpcoesBloqueio = {
  fonte?: FonteBloqueioScl;
  /** Recusa o bloqueio se houver reserva que ocupa inventário nas datas: o proprietário não bloqueia por cima de hóspede. */
  semReserva?: boolean;
  /** Titular (proprietário) que fez o bloqueio pelo portal; só ele libera depois. */
  proprietarioId?: string;
};
export type OpcoesRemocao = {
  /** Só remove bloqueio desta fonte (o proprietário só libera o que ele mesmo bloqueou). */
  somenteFonte?: FonteBloqueioScl;
  /** Só remove bloqueio destes imóveis (os do proprietário). */
  imovelIds?: readonly string[];
  /** Só remove bloqueio feito por um destes titulares (os da conta do proprietário): o do titular anterior fica para a empresa. */
  proprietarioIds?: readonly string[];
};

// Criar ou remover bloqueio espera o envio de calendário (mesma trava do Beds24) e recusa enquanto um
// envio está entre a escrita externa e o registro final: o que o envio planejou não pode mudar por baixo.
const esperarEnvio = esperarEnvioBeds24;

/** Texto do histórico ("início a fim (motivo)"). `periodoDoBloqueio` lê de volta: a agenda usa o período de
 * bloqueios já removidos para não dar como livre um imóvel que foi usado. */
export const descricaoDoBloqueio = (b: { inicio: string; fim: string; motivo: string | null }) => `${b.inicio} a ${b.fim}${b.motivo ? ` (${b.motivo})` : ""}`;
export function periodoDoBloqueio(texto: unknown): { inicio: string; fim: string } | null {
  const m = typeof texto === "string" ? /^(\d{4}-\d{2}-\d{2}) a (\d{4}-\d{2}-\d{2})/.exec(texto) : null;
  return m ? { inicio: m[1], fim: m[2] } : null;
}
/** Toda remoção de bloqueio (painel, portal do proprietário, Beds24) passa por aqui: um só registro no histórico. */
export function registrarRemocaoDeBloqueio(tx: Db, organizacaoId: string, b: { imovelId: string; inicio: string; fim: string; motivo: string | null }, autorId: string | null) {
  return registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "bloqueio.remover", entidade: "imovel", entidadeId: b.imovelId, mudancas: { bloqueio: [descricaoDoBloqueio(b), null] } });
}

export function validarBloqueio(e: EntradaBloqueio): { ok: true; dados: EntradaBloqueio } | { ok: false; erro: string } {
  if (!uuidValido(e.imovelId)) return { ok: false, erro: "Escolha o imóvel." };
  if (!dataValida(e.inicio) || !dataValida(e.fim)) return { ok: false, erro: "Datas inválidas." };
  if (e.fim <= e.inicio) return { ok: false, erro: "A data de liberação precisa ser depois da primeira noite bloqueada." };
  if (e.inicio < "2000-01-01" || e.fim > "2100-12-31") return { ok: false, erro: "Use datas entre 2000 e 2100." };
  const motivo = e.motivo.trim().slice(0, 120);
  return { ok: true, dados: { imovelId: e.imovelId, inicio: e.inicio, fim: e.fim, motivo } };
}

/** `fim` é o dia em que o imóvel volta a ficar livre (exclusivo), como o checkout. */
export async function criarBloqueio(db: Db, organizacaoId: string, e: EntradaBloqueio, autorId: string | null, opcoes: OpcoesBloqueio = {}): Promise<ResultadoBloqueio> {
  const v = validarBloqueio(e);
  if (!v.ok) return v;
  const fonte: FonteBloqueioScl = opcoes.fonte ?? "manual";
  return db.transaction(async (tx) => {
    const ocupado = await esperarEnvio(tx, organizacaoId);
    if (ocupado) return { ok: false as const, erro: ocupado };
    const [im] = await tx.select({ id: imoveis.id }).from(imoveis).where(and(eq(imoveis.id, v.dados.imovelId), eq(imoveis.organizacaoId, organizacaoId))).for("update");
    if (!im) return { ok: false as const, erro: "Imóvel não encontrado." };
    // As datas seguradas de uma alteração de reserva paga que já venceram (M8.2d) saem antes de conferir (cada uma num
    // savepoint: uma reserva ocupada agora é pulada, nunca derruba o bloqueio).
    await expirarAlteracoesVencidas(tx, organizacaoId, new Date(), { imovelId: im.id });
    const [choque] = await tx.select({ id: bloqueios.id }).from(bloqueios).where(and(eq(bloqueios.imovelId, im.id), lt(bloqueios.inicio, v.dados.fim), gt(bloqueios.fim, v.dados.inicio)));
    if (choque) return { ok: false as const, erro: "Já existe um bloqueio nessas datas. Remova-o ou ajuste as datas." };
    if (opcoes.semReserva) {
      // Só reservas que ocupam inventário (consulta não ocupa; cancelada também não), a mesma regra do calendário.
      const [reserva] = await tx.select({ id: reservas.id }).from(reservas).where(and(eq(reservas.imovelId, im.id), inArray(reservas.estado, [...ESTADOS_OCUPANTES]), lt(reservas.checkin, v.dados.fim), gt(reservas.checkout, v.dados.inicio))).limit(1);
      if (reserva) return { ok: false as const, erro: "Há reserva nessas datas: não dá para bloquear por cima de um hóspede." };
    }
    const [b] = await tx.insert(bloqueios).values({ organizacaoId, ...v.dados, fonte, proprietarioId: opcoes.proprietarioId ?? null }).returning({ id: bloqueios.id });
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "bloqueio.criar", entidade: "imovel", entidadeId: im.id, mudancas: { bloqueio: [null, `${descricaoDoBloqueio(v.dados)}${fonte === "proprietario" ? " · pelo proprietário" : ""}`] } });
    return { ok: true as const, id: b.id };
  });
}

/** Só bloqueios criados no SCL; os importados do Beds24 ficam como estão. */
export async function excluirBloqueio(db: Db, organizacaoId: string, id: string, autorId: string | null, opcoes: OpcoesRemocao = {}): Promise<ResultadoRemocao> {
  // No portal (somenteFonte), o proprietário não lê o nome do Beds24 (M5.9): o bloqueio importado é "dos canais".
  const naoEncontrado = { ok: false as const, erro: opcoes.somenteFonte ? "Bloqueio não encontrado." : "Bloqueio não encontrado ou importado do Beds24 (mude lá)." };
  if (!uuidValido(id)) return naoEncontrado;
  return db.transaction(async (tx) => {
    const ocupado = await esperarEnvio(tx, organizacaoId);
    if (ocupado) return { ok: false as const, erro: ocupado };
    const [b] = await tx.select().from(bloqueios).where(and(eq(bloqueios.id, id), eq(bloqueios.organizacaoId, organizacaoId), ...(opcoes.imovelIds ? [inArray(bloqueios.imovelId, [...opcoes.imovelIds])] : []))).for("update");
    if (b?.fonte === "beds24" && opcoes.somenteFonte) return { ok: false as const, erro: "Este bloqueio veio dos canais (Airbnb, Booking): fale com a empresa para liberar as datas." };
    if (!b || b.fonte === "beds24") return naoEncontrado;
    if (opcoes.somenteFonte && b.fonte !== opcoes.somenteFonte) return { ok: false as const, erro: "Este bloqueio foi feito pela empresa: fale com ela para liberar as datas." };
    if (opcoes.proprietarioIds && (!b.proprietarioId || !opcoes.proprietarioIds.includes(b.proprietarioId))) {
      return { ok: false as const, erro: "Este bloqueio foi feito por outro proprietário (titular anterior do imóvel): fale com a empresa para liberar as datas." };
    }
    await tx.delete(bloqueios).where(eq(bloqueios.id, id));
    await registrarRemocaoDeBloqueio(tx, organizacaoId, b, autorId);
    return { ok: true as const };
  });
}
