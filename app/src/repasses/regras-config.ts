/**
 * Regras dos repasses por periodicidade gravadas na configuração da organização (chave `repasses_regras`) e o
 * início do sistema para valer (chave `inicio_sistema`, M4.11).
 */
import { and, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { gravarConfig, lerConfig, travarConfig } from "@/configuracoes/armazem";
import { lancamentos, repasseItens, repasses } from "@/db/schema";
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
 * lançamentos que ele cobre ficariam "acertados" dentro do período do sistema e nunca entrariam num repasse normal.
 * Nem para depois de uma parte que um repasse normal em vigor (fechamento ou antecipado) já pagou, de um mês já
 * fechado, ou de saldo que um fechamento posterior em vigor já quitou (o fechamento paga o acerto acumulado, então o de
 * outubro leva um ajuste de setembro sem item de reserva): a data diria que aquilo foi acertado por fora enquanto o
 * sistema o paga, e a marcação zeraria de novo o mês. Em todos os casos, estorne primeiro.
 * A conferência e a gravação ficam sob a mesma trava que a marcação, o antecipado e o fechamento usam.
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
    if (d) {
      const [normais] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(repasseItens)
        .innerJoin(repasses, eq(repasses.id, repasseItens.repasseId))
        .where(and(eq(repasses.organizacaoId, organizacaoId), ne(repasses.tipo, "por_fora"), isNull(repasses.estornadoEm), isNull(repasseItens.liberadoEm), lt(repasseItens.competencia, d)));
      const [fechados] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(repasses)
        .where(and(eq(repasses.organizacaoId, organizacaoId), eq(repasses.tipo, "fechamento"), isNull(repasses.estornadoEm), lt(repasses.mes, d)));
      // Fechamento de mês a partir da data: pagou o acerto acumulado do proprietário, inclusive o que é de antes dela
      // (ajuste de setembro sem item de reserva entra no fechamento de outubro). Se ainda houver imóvel/mês de antes com
      // acerto diferente de zero, a marcação por fora o zeraria de novo — acertado duas vezes.
      const [posteriores] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(repasses)
        .where(
          and(
            eq(repasses.organizacaoId, organizacaoId),
            eq(repasses.tipo, "fechamento"),
            isNull(repasses.estornadoEm),
            gte(repasses.mes, d),
            sql`exists (select 1 from ${lancamentos} l where l.organizacao_id = ${repasses.organizacaoId} and l.proprietario_id = ${repasses.proprietarioId} and l.competencia < ${d}::date group by l.imovel_id, to_char(l.competencia, 'YYYY-MM') having sum(l.efeito_saldo) <> 0)`,
          ),
        );
      if (normais?.n || fechados?.n || posteriores?.n) {
        const dia = d.split("-").reverse().join("/");
        const o = [
          normais?.n ? `${normais.n} parte(s) de reserva anterior(es) a ${dia} já em repasse normal (fechamento ou antecipado)` : "",
          fechados?.n ? `${fechados.n} fechamento(s) de mês anterior` : "",
          posteriores?.n ? `${posteriores.n} fechamento(s) de mês a partir de ${dia} que já quitou(aram) acerto de antes dessa data` : "",
        ]
          .filter(Boolean)
          .join(", ");
        return { ok: false as const, erro: `Há ${o} em vigor: o sistema já pagou (ou vai pagar) isso, então não pode ser dado como acertado por fora. Estorne esses repasses antes, ou escolha um início que não os alcance.` };
      }
    }
    const mudancas = await gravarConfig(tx, organizacaoId, "inicio_sistema", { data: d }, autorId);
    return { ok: true as const, mudou: Object.keys(mudancas).length > 0 };
  });
}
