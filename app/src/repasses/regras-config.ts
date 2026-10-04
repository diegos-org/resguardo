/**
 * Regras dos repasses por periodicidade gravadas na configuração da organização (chave `repasses_regras`) e o
 * início do sistema para valer (chave `inicio_sistema`, M4.11).
 */
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { gravarConfig, lerConfig, travarConfig } from "@/configuracoes/armazem";
import { repasses } from "@/db/schema";
import type { Db } from "@/db/types";
import { dataValida } from "@/reservas/regras";
import { type RegrasRepasses, regrasDeJson } from "./periodicidade";

export async function lerRegrasRepasses(db: Db, organizacaoId: string): Promise<RegrasRepasses> {
  return regrasDeJson(await lerConfig(db, organizacaoId, "repasses_regras"));
}

/** Grava com auditoria; devolve se algo mudou. Vale dos próximos repasses em diante (nada já gerado muda). */
export async function salvarRegrasRepasses(db: Db, organizacaoId: string, regras: RegrasRepasses, autorId: string | null): Promise<boolean> {
  const mudancas = await db.transaction((tx) => gravarConfig(tx, organizacaoId, "repasses_regras", { diaSemanal: regras.diaSemanal, diasQuinzenal: [...regras.diasQuinzenal], padraoPorContrato: { ...regras.padraoPorContrato } }, autorId));
  return Object.keys(mudancas).length > 0;
}

/** O início do sistema é sempre o dia 1º de um mês: as partes de reserva são por mês, então um corte no meio do mês não existe. */
export const inicioDoSistemaValido = (d: string): boolean => dataValida(d) && d.endsWith("-01");

/** Data a partir da qual o sistema vale (decisão de Diego, 4/10/2026: 1/10/2026); null = não definida. */
export async function lerInicioDoSistema(db: Db, organizacaoId: string): Promise<string | null> {
  const v = await lerConfig(db, organizacaoId, "inicio_sistema");
  const data = typeof v?.data === "string" ? v.data : "";
  return inicioDoSistemaValido(data) ? data : null;
}

/**
 * Grava (ou apaga, com data vazia) o início do sistema, com auditoria. Nunca no futuro: marcaria como acertado o que ainda
 * nem aconteceu. Nunca para antes de um acerto por fora em vigor (nem apagado enquanto houver um): as partes e os
 * lançamentos que ele cobre ficariam "acertados" dentro do período do sistema e nunca entrariam num repasse normal —
 * estorne-os primeiro. A conferência e a gravação ficam sob a mesma trava que a marcação usa.
 */
export async function salvarInicioDoSistema(db: Db, organizacaoId: string, data: string, hoje: string, autorId: string | null): Promise<{ ok: true; mudou: boolean } | { ok: false; erro: string }> {
  const d = data.trim();
  if (d && !dataValida(d)) return { ok: false, erro: "Data inválida." };
  if (d && !d.endsWith("-01")) return { ok: false, erro: "O início do sistema é sempre o dia 1º de um mês: as partes de reserva são por mês." };
  if (d && d > hoje) return { ok: false, erro: "O início do sistema não pode ser no futuro." };
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "inicio_sistema");
    const [emVigor] = await tx
      .select({ n: sql<number>`count(*)::int`, ate: sql<string | null>`max(${repasses.data})` })
      .from(repasses)
      .where(and(eq(repasses.organizacaoId, organizacaoId), eq(repasses.tipo, "por_fora"), isNull(repasses.estornadoEm), d ? gte(repasses.data, d) : undefined));
    if (emVigor?.n) {
      const ate = (emVigor.ate ?? "").split("-").reverse().join("/");
      return { ok: false as const, erro: `Há ${emVigor.n} acerto(s) por fora em vigor até ${ate}: para ${d ? "mudar o início para antes disso" : "apagar o início"}, estorne-os primeiro em Financeiro → Repasses.` };
    }
    const mudancas = await gravarConfig(tx, organizacaoId, "inicio_sistema", { data: d }, autorId);
    return { ok: true as const, mudou: Object.keys(mudancas).length > 0 };
  });
}
