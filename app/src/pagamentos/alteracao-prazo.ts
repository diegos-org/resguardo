/**
 * Alteração de reserva paga pelo site (M8.2d) — o vencimento das datas seguradas, preguiçoso e pela rotina (desenho D2,
 * §5.4.5). A rotina só roda no deploy de produção (onde o pagamento fica desligado); nas prévias nada venceria sozinho.
 * Por isso toda ação da alteração, o cancelamento pela política, a aprovação da diferença, o "Conferir agora" do painel, o
 * "segurar as datas" do site e o bloqueio manual vencem antes a alteração cujo prazo (e a carência de um pagamento da
 * diferença em andamento) já passou; e quem só lê usa a situação que vale agora (`situacaoEfetiva`).
 *
 * Nada aqui chama o provedor: o Pix da diferença ainda pendente de uma alteração vencida é cancelado no Mercado Pago pela
 * varredura da rotina (`conferirPendentes`), fora de qualquer transação.
 */
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { travaOcupada } from "@/db/erros";
import { alteracoesReserva, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { cancelarPortador } from "@/reservas/repositorio";
import { type Alteracao, carenciaNoTravado, type Travado, travarCotacao } from "./travas";

export type ResumoAlteracoesVencidas = { expiradas: number; falhas: number; puladas: number };

/**
 * Sob as travas já tomadas (`t`): vence a alteração da reserva cujo prazo das datas passou e que não está na carência de um
 * pagamento da diferença. Grava `expirada`, cancela a reserva-pedido que segurava as noites novas (o motor da reserva
 * primeiro, na ordem única) e audita. Nenhuma chamada ao provedor. Devolve as que venceram agora.
 */
export async function expirarSeVencida(tx: Db, organizacaoId: string, t: Travado, agora: Date, autorId: string | null = null): Promise<Alteracao[]> {
  const carencia = carenciaNoTravado(t, agora);
  const vencidas = t.alteracoes.filter((a) => a.situacao === "segurada" && (!a.holdAte || a.holdAte.getTime() <= agora.getTime()) && !carencia(a));
  for (const a of vencidas) {
    const mudanca = { situacao: "expirada" as const, expiradaEm: agora, atualizadoEm: agora };
    await tx.update(alteracoesReserva).set(mudanca).where(eq(alteracoesReserva.id, a.id));
    Object.assign(a, mudanca);
    await cancelarPortador(tx, organizacaoId, a, autorId, agora, "as datas seguradas da alteração venceram");
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "alteracao.expirar", entidade: "alteracao", entidadeId: a.id, mudancas: { situacao: ["segurada", "expirada"] } });
  }
  return vencidas;
}

/**
 * Vence as alterações seguradas cujo prazo passou. Sem `imovelId` (rotina): cada uma numa transação curta própria, pela
 * cadeia de travas da cotação (`travarCotacao`), e o erro de uma não para as outras (`falhas`). Com `imovelId` (dentro de
 * `segurarDatas` ou `criarBloqueio`, que já travaram o imóvel): cada uma num savepoint da transação de quem chama; uma
 * cadeia ocupada (55P03/40P01) é pulada (`puladas`) sem derrubar o pedido de quem chama, e o tempo-limite de espera de 15 s
 * volta a valer para ele no fim. `organizacaoId` null = todas as empresas (rotina). Nenhuma chamada ao provedor.
 */
export async function expirarAlteracoesVencidas(db: Db, organizacaoId: string | null, agora: Date, o: { imovelId?: string } = {}): Promise<ResumoAlteracoesVencidas> {
  const resumo: ResumoAlteracoesVencidas = { expiradas: 0, falhas: 0, puladas: 0 };
  const candidatas = await db
    .select({ id: alteracoesReserva.id, organizacaoId: alteracoesReserva.organizacaoId, cotacaoId: alteracoesReserva.cotacaoId })
    .from(alteracoesReserva)
    .innerJoin(reservas, eq(reservas.id, alteracoesReserva.reservaId))
    .where(
      and(
        eq(alteracoesReserva.situacao, "segurada"),
        lte(alteracoesReserva.holdAte, agora),
        organizacaoId ? eq(alteracoesReserva.organizacaoId, organizacaoId) : undefined,
        o.imovelId ? eq(reservas.imovelId, o.imovelId) : undefined,
      ),
    )
    .orderBy(asc(alteracoesReserva.id));
  // Uma vez por cotação (há no máximo uma segurada por reserva).
  const cotacoes = [...new Map(candidatas.map((c) => [c.cotacaoId, c])).values()];
  const vencer = async (tx: Db, c: (typeof candidatas)[number]) => {
    const t = await travarCotacao(tx, c.organizacaoId, c.cotacaoId);
    return t ? (await expirarSeVencida(tx, c.organizacaoId, t, agora)).length : 0;
  };
  if (o.imovelId) {
    for (const c of cotacoes) {
      try {
        resumo.expiradas += await db.transaction((sp) => vencer(sp, c));
      } catch (e) {
        if (!travaOcupada(e)) throw e;
        resumo.puladas++;
      }
    }
    if (cotacoes.length) await db.execute(sql`set local lock_timeout = '15s'`);
    return resumo;
  }
  for (const c of cotacoes) {
    try {
      resumo.expiradas += await db.transaction((tx) => vencer(tx, c));
    } catch (e) {
      // Cadeia ocupada além do tempo-limite, impasse ou outro erro: esta fica para a próxima volta. Só o tipo vai ao registro.
      if (!travaOcupada(e)) console.error("[site] alteração vencida não fechada pela rotina", e instanceof Error ? e.name : "erro");
      resumo.falhas++;
    }
  }
  return resumo;
}
