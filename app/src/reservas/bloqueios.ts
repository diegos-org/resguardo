/**
 * Bloqueios manuais (M3.7): datas fechadas pelo SCL (uso próprio, manutenção). Vão ao
 * Beds24 como "blackout" pelo envio de calendário; os importados do Beds24 (fonte "beds24")
 * não são editados aqui — mudam na origem.
 */
import { and, eq, gt, lt } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { esperarEnvioBeds24 } from "@/beds24/trava";
import { bloqueios, imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "./regras";

export type EntradaBloqueio = { imovelId: string; inicio: string; fim: string; motivo: string };
export type ResultadoBloqueio = { ok: true; id: string } | { ok: false; erro: string };
export type ResultadoRemocao = { ok: true } | { ok: false; erro: string };

// Criar ou remover bloqueio espera o envio de calendário (mesma trava do Beds24) e recusa enquanto um
// envio está entre a escrita externa e o registro final: o que o envio planejou não pode mudar por baixo.
const esperarEnvio = esperarEnvioBeds24;

export function validarBloqueio(e: EntradaBloqueio): { ok: true; dados: EntradaBloqueio } | { ok: false; erro: string } {
  if (!uuidValido(e.imovelId)) return { ok: false, erro: "Escolha o imóvel." };
  if (!dataValida(e.inicio) || !dataValida(e.fim)) return { ok: false, erro: "Datas inválidas." };
  if (e.fim <= e.inicio) return { ok: false, erro: "A data de liberação precisa ser depois da primeira noite bloqueada." };
  if (e.inicio < "2000-01-01" || e.fim > "2100-12-31") return { ok: false, erro: "Use datas entre 2000 e 2100." };
  const motivo = e.motivo.trim().slice(0, 120);
  return { ok: true, dados: { imovelId: e.imovelId, inicio: e.inicio, fim: e.fim, motivo } };
}

/** `fim` é o dia em que o imóvel volta a ficar livre (exclusivo), como o checkout. */
export async function criarBloqueio(db: Db, organizacaoId: string, e: EntradaBloqueio, autorId: string | null): Promise<ResultadoBloqueio> {
  const v = validarBloqueio(e);
  if (!v.ok) return v;
  return db.transaction(async (tx) => {
    const ocupado = await esperarEnvio(tx, organizacaoId);
    if (ocupado) return { ok: false as const, erro: ocupado };
    const [im] = await tx.select({ id: imoveis.id }).from(imoveis).where(and(eq(imoveis.id, v.dados.imovelId), eq(imoveis.organizacaoId, organizacaoId))).for("update");
    if (!im) return { ok: false as const, erro: "Imóvel não encontrado." };
    const [choque] = await tx.select({ id: bloqueios.id }).from(bloqueios).where(and(eq(bloqueios.imovelId, im.id), lt(bloqueios.inicio, v.dados.fim), gt(bloqueios.fim, v.dados.inicio)));
    if (choque) return { ok: false as const, erro: "Já existe um bloqueio nessas datas. Remova-o ou ajuste as datas." };
    const [b] = await tx.insert(bloqueios).values({ organizacaoId, ...v.dados, fonte: "manual" }).returning({ id: bloqueios.id });
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "bloqueio.criar", entidade: "imovel", entidadeId: im.id, mudancas: { bloqueio: [null, `${v.dados.inicio} a ${v.dados.fim}${v.dados.motivo ? ` (${v.dados.motivo})` : ""}`] } });
    return { ok: true as const, id: b.id };
  });
}

/** Só bloqueios criados no SCL; os importados do Beds24 ficam como estão. */
export async function excluirBloqueio(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<ResultadoRemocao> {
  const naoEncontrado = { ok: false as const, erro: "Bloqueio não encontrado ou importado do Beds24 (mude lá)." };
  if (!uuidValido(id)) return naoEncontrado;
  return db.transaction(async (tx) => {
    const ocupado = await esperarEnvio(tx, organizacaoId);
    if (ocupado) return { ok: false as const, erro: ocupado };
    const [b] = await tx.select().from(bloqueios).where(and(eq(bloqueios.id, id), eq(bloqueios.organizacaoId, organizacaoId))).for("update");
    if (!b || b.fonte === "beds24") return naoEncontrado;
    await tx.delete(bloqueios).where(eq(bloqueios.id, id));
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "bloqueio.remover", entidade: "imovel", entidadeId: b.imovelId, mudancas: { bloqueio: [`${b.inicio} a ${b.fim}${b.motivo ? ` (${b.motivo})` : ""}`, null] } });
    return { ok: true as const };
  });
}
