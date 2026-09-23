import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { listarContratos } from "@/contratos/repositorio";
import { lancamentos, proprietarioImoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { estornar, lancar, type NovoLancamento } from "./ledger";
import { calcularReserva, REGRAS_PADRAO, type RegrasMotor } from "./motor";

const assinatura = (l: NovoLancamento) =>
  createHash("sha1")
    .update(JSON.stringify([l.valor, l.efeitoSaldo ?? 0, l.proprietarioId ?? null, l.competencia]))
    .digest("hex")
    .slice(0, 10);

export type ResultadoAplicacao = { criados: number; estornados: number; mantidos: number; avisos: string[] };

/**
 * Deixa os lançamentos da reserva iguais ao que o motor calcula agora:
 * mantém os que continuam certos, estorna os que mudaram/sumiram e cria os novos.
 * Seguro para rodar quantas vezes quiser (idempotente) e tudo-ou-nada.
 */
export async function aplicarMotor(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  autorId: string | null,
  regras: RegrasMotor = REGRAS_PADRAO,
): Promise<ResultadoAplicacao | null> {
  if (!uuidValido(reservaId)) return null;
  return db.transaction(async (tx) => {
    // Uma aplicação por reserva de cada vez.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`motor:${organizacaoId}:${reservaId}`}))`);
    const [r] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)));
    if (!r) return null;

    const contratos = await listarContratos(tx, organizacaoId, r.imovelId);
    const donos = await tx.select({ id: proprietarioImoveis.proprietarioId }).from(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, r.imovelId));
    const avisosExtras = donos.length > 1 ? ["Imóvel com mais de um proprietário: acerto atribuído ao primeiro cadastrado."] : [];
    const { lancamentos: desejados, avisos } = calcularReserva(r, contratos, donos[0]?.id ?? null, regras);
    const comChave = desejados.map((l) => ({ ...l, chaveOrigem: `${l.chaveOrigem}:${assinatura(l)}` }));

    const ativos = await tx
      .select({ id: lancamentos.id, chave: lancamentos.chaveOrigem })
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.organizacaoId, organizacaoId),
          eq(lancamentos.reservaId, reservaId),
          eq(lancamentos.origem, "motor"),
          isNull(lancamentos.estornoDe),
          sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
        ),
      );
    const desejadas = new Set(comChave.map((l) => l.chaveOrigem));
    const existentes = new Set(ativos.map((a) => a.chave));

    let estornados = 0;
    for (const a of ativos) {
      if (!desejadas.has(a.chave)) {
        await estornar(tx, organizacaoId, a.id, "Recalculado pelo motor (reserva ou contrato mudou)", autorId);
        estornados++;
      }
    }
    const novos = comChave.filter((l) => !existentes.has(l.chaveOrigem));
    if (novos.length) await lancar(tx, organizacaoId, novos, autorId);
    return { criados: novos.length, estornados, mantidos: ativos.length - estornados, avisos: [...avisosExtras, ...avisos] };
  });
}
