/**
 * Regras dos repasses por periodicidade gravadas na configuração da organização (chave `repasses_regras`) e o
 * início do sistema para valer (chave `inicio_sistema`, M4.11).
 */
import { and, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { gravarConfig, lerConfig, travarConfig } from "@/configuracoes/armazem";
import { lancamentos, repasseItens, repasses } from "@/db/schema";
import type { Db } from "@/db/types";
import { dataValida } from "@/reservas/regras";
import { livroDeAntes, reservasDoInicio } from "./inicio";
import { comDiaDeFechamento, type RegrasRepasses, regrasDeJson } from "./periodicidade";

export async function lerRegrasRepasses(db: Db, organizacaoId: string): Promise<RegrasRepasses> {
  return regrasDeJson(await lerConfig(db, organizacaoId, "repasses_regras"));
}

/**
 * Grava com auditoria; devolve se algo mudou. Vale dos próximos repasses em diante (nada já gerado muda).
 * `diaFechamento` (M4.13): o dia pedido no formulário vira uma versão a partir do mês de `hoje` (`comDiaDeFechamento`),
 * por cima das versões já gravadas; sem ele, as versões de `regras.fechamento` são gravadas como vieram.
 */
export async function salvarRegrasRepasses(db: Db, organizacaoId: string, regras: RegrasRepasses, autorId: string | null, o: { diaFechamento?: number; hoje?: string } = {}): Promise<boolean> {
  const mudancas = await db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "repasses_regras");
    const atuais = regrasDeJson(await lerConfig(tx, organizacaoId, "repasses_regras"));
    const fechamento = o.diaFechamento !== undefined && o.hoje ? comDiaDeFechamento(atuais.fechamento, o.diaFechamento, o.hoje.slice(0, 7)) : regras.fechamento;
    return gravarConfig(tx, organizacaoId, "repasses_regras", { diaSemanal: regras.diaSemanal, diasQuinzenal: [...regras.diasQuinzenal], padraoPorContrato: { ...regras.padraoPorContrato }, fechamento: fechamento.map((v) => ({ ...v })) }, autorId);
  });
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
 * Nem para depois de uma parte que um repasse normal em vigor (fechamento ou antecipado) já pagou e que a nova data
 * daria como "de antes", de um mês já fechado, ou de saldo de antes que um fechamento posterior em vigor já quitou (o
 * fechamento paga o acerto acumulado, então o de outubro leva um ajuste de setembro sem item de reserva; parte não paga,
 * que ficou fora do fechamento, e lançamento criado depois dele não contam): a data diria que aquilo foi acertado por
 * fora enquanto o sistema o paga, e a marcação zeraria de novo o mês. Em todos os casos, estorne primeiro.
 * "De antes" segue a data em que o canal pagou a reserva (M4.12, `./inicio`): reserva paga antes da data é de antes
 * inteira, mesmo as noites a partir dela; paga a partir da data fica inteira no sistema; sem data e atravessando, só o
 * que é de competência anterior conta (em dúvida, a trava recusa).
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
      const lados = await reservasDoInicio(tx, organizacaoId, d);
      // Parte de reserva que um repasse normal em vigor pagou e que a data daria como de antes: reserva paga antes da data
      // (qualquer mês) ou, sem lado definido (sem data de pagamento, ou sem parte em vigor), noite de mês anterior à data.
      const itens = await tx
        .select({ reservaId: lancamentos.reservaId, competencia: lancamentos.competencia })
        .from(repasseItens)
        .innerJoin(repasses, eq(repasses.id, repasseItens.repasseId))
        .innerJoin(lancamentos, eq(lancamentos.id, repasseItens.lancamentoId))
        .where(and(eq(repasses.organizacaoId, organizacaoId), ne(repasses.tipo, "por_fora"), isNull(repasses.estornadoEm), isNull(repasseItens.liberadoEm)));
      const normais = itens.filter((i) => {
        const lado = i.reservaId ? lados.get(i.reservaId)?.lado : undefined;
        return lado === "antes" || (lado !== "depois" && i.competencia < d);
      }).length;
      const [fechados] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(repasses)
        .where(and(eq(repasses.organizacaoId, organizacaoId), eq(repasses.tipo, "fechamento"), isNull(repasses.estornadoEm), lt(repasses.mes, d)));
      // Fechamento de mês a partir da data: pagou o acerto acumulado do proprietário, inclusive o que é de antes dela
      // (ajuste de setembro sem item de reserva entra no fechamento de outubro), e a marcação por fora zeraria de novo o
      // imóvel/mês daquele lançamento — acertado duas vezes. Conta só o que esse fechamento de fato quitou do livro "de
      // antes" (`livroDeAntes`): lançamento em vigor que já existia quando ele foi gerado e que não é parte de reserva
      // (parte paga por repasse normal é a conferência anterior; parte não paga ficou "fora do fechamento" e segue em
      // aberto). Lançamento criado depois do fechamento, mesmo com data de antes, também ficou fora dele. Parte de reserva
      // entra só quando um repasse em vigor gerado até esse fechamento já a tinha pago ou acertado por fora (com o
      // lançamento de acerto que a zera, somam zero); parte sem repasse na hora do fechamento ficou fora dele. E conta a
      // soma: o fechamento paga o acerto acumulado do proprietário, então crédito de agosto e débito de setembro que se
      // anulam não lhe custaram nada.
      const [posteriores] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(repasses)
        .where(
          and(
            eq(repasses.organizacaoId, organizacaoId),
            eq(repasses.tipo, "fechamento"),
            isNull(repasses.estornadoEm),
            gte(repasses.mes, d),
            sql`exists (
              select 1 from ${lancamentos}
              where ${lancamentos.organizacaoId} = ${repasses.organizacaoId} and ${lancamentos.proprietarioId} = ${repasses.proprietarioId}
                and ${livroDeAntes(d, lados)}
                and ${lancamentos.estornoDe} is null and not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})
                and ${lancamentos.criadoEm} <= ${repasses.criadoEm}
                and (${lancamentos.tipo} <> 'direito_proprietario' or exists (
                  select 1 from ${repasseItens} i join ${repasses} r2 on r2.id = i.repasse_id
                  where i.lancamento_id = ${lancamentos.id} and i.liberado_em is null and r2.estornado_em is null and r2.criado_em <= ${repasses.criadoEm}))
              having sum(${lancamentos.efeitoSaldo}) <> 0)`,
          ),
        );
      if (normais || fechados?.n || posteriores?.n) {
        const dia = d.split("-").reverse().join("/");
        const o = [
          normais ? `${normais} parte(s) de reserva anterior(es) a ${dia} já em repasse normal (fechamento ou antecipado)` : "",
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
