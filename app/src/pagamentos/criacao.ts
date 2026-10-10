/**
 * Pagamento no site (M8.2a/M8.2b) — o que a criação do Pix e a do cartão têm em comum: a referência e a chave da
 * tentativa (gravadas antes da chamada), a leitura que a resposta da criação vira, a conferência com trava que pode dar
 * "ocupado", a releitura das tentativas encerradas há pouco antes de criar outra (se uma virou dinheiro, nenhuma nova
 * sai) e a gravação, num comando só, do id da order que a criação devolveu quando a transação da fase 3 não conseguiu
 * as travas (o cartão pode já ter sido cobrado: a leitura seguinte vai pelo id, nunca por uma order nova).
 */
import { and, eq, isNull } from "drizzle-orm";
import { travaOcupada, violouUnicidade } from "@/db/erros";
import { pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { paginaAindaLe } from "./andamento";
import type { Leitura } from "./aplicar";
import { conferirTentativa } from "./conferencia";
import { type Cobranca, ErroProvedor, idProvedorValido, type ProvedorPagamento, type ResultadoCriacao } from "./provedor";
import { limitarEspera } from "./travas";

export const referenciaDaTentativa = (id: string) => `scl-${id}`;
export const chaveCriacao = (id: string) => `pagamento:${id}:criar`;

/**
 * Leitura que a criação devolveu. null = nada chegou ao provedor (sem conexão, chave recusada, limite de chamadas): a
 * tentativa é apagada. Recusa sem order no corpo guarda o motivo (pelo provedor — o 402 sem `data`, que conta no
 * disjuntor do cartão — ou dados inválidos) e o código. Toda leitura daqui leva `daCriacao` (só a resposta da criação
 * traz o endereço do desafio do banco).
 */
export function leituraDaCriacao(res: ResultadoCriacao | null, erro: unknown): Leitura | null {
  if (erro) return erro instanceof ErroProvedor && erro.tipo !== "incerto" ? null : { incerta: true, daCriacao: true };
  if (!res) return { incerta: true, daCriacao: true };
  if (res.ok) return { cobranca: res.cobranca, daCriacao: true };
  if (res.motivo === "incerto") return { incerta: true, daCriacao: true };
  if (res.cobranca) return { cobranca: res.cobranca, codigoRecusa: res.codigo, daCriacao: true };
  return { recusadaSemOrder: res.motivo === "recusado" ? "recusado" : "dados_invalidos", codigoRecusa: res.codigo, daCriacao: true };
}

/** Leitura com trava (conferência): trava não obtida vira null ("ocupado"); o resto sobe. */
export async function conferirOuOcupado(...args: Parameters<typeof conferirTentativa>): Promise<Awaited<ReturnType<typeof conferirTentativa>> | null> {
  try {
    return await conferirTentativa(...args);
  } catch (e) {
    if (travaOcupada(e)) return null;
    throw e;
  }
}

export type ResultadoReleitura = { tipo: "ok" } | { tipo: "ocupado" } | { tipo: "provedor"; erro: string };

/**
 * Antes de criar qualquer coisa nova (Pix ou cartão): uma criação que ficou no ar é procurada pela referência, e uma
 * tentativa encerrada há pouco que ainda pode ter virado dinheiro (`paginaAindaLe`) é relida. Leitura NOVA, sem o
 * intervalo de 15 s: a última (da página, segundos antes) pode ser de antes de o pagamento entrar, e é esta leitura que
 * decide se outra tentativa pode sair. As pendentes ficam com a fase 1 (mostradas de novo, ou canceladas e relidas).
 * Sem leitura (o provedor falhou), nenhuma outra sai.
 */
export async function relerEncerradasRecentes(db: Db, organizacaoId: string, cotacaoId: string, provedor: ProvedorPagamento, agora: Date, o: { alteracaoId?: string | null } = {}): Promise<ResultadoReleitura> {
  // Só as tentativas do mesmo alvo (M8.2d): a reserva, ou a diferença desta alteração.
  const tentativas = await db
    .select({ id: pagamentos.id, forma: pagamentos.forma, situacao: pagamentos.situacao, idProvedor: pagamentos.idProvedor, pixExpiraEm: pagamentos.pixExpiraEm, criadoEm: pagamentos.criadoEm, encerradoEm: pagamentos.encerradoEm })
    .from(pagamentos)
    .where(and(eq(pagamentos.cotacaoId, cotacaoId), eq(pagamentos.organizacaoId, organizacaoId), o.alteracaoId ? eq(pagamentos.alteracaoId, o.alteracaoId) : isNull(pagamentos.alteracaoId)));
  const reler = tentativas.filter((t) => t.situacao !== "pendente" && paginaAindaLe(t, agora));
  for (const a of reler) {
    const lida = await conferirOuOcupado(db, organizacaoId, a.id, provedor, agora, { forcar: true, origem: "pagina" });
    if (lida === null) return { tipo: "ocupado" };
    if (!lida.ok) return { tipo: "provedor", erro: lida.erro };
  }
  return { tipo: "ok" };
}

/**
 * A transação da fase 3 não conseguiu as travas, mas a criação devolveu a order: grava só o id dela na tentativa, num
 * comando só (espera apenas a linha da tentativa, com o mesmo tempo-limite, e não segura nenhuma outra trava: não há
 * ordem de travas a respeitar). Só se a tentativa ainda não tem id. Outra tentativa com o mesmo id (índice único) fica
 * para o caminho normal (`referencia_divergente`). Devolve se gravou; trava não obtida sobe.
 */
export async function guardarIdDaOrder(db: Db, pagamentoId: string, cobranca: Cobranca, agora: Date): Promise<boolean> {
  if (!idProvedorValido(cobranca.idProvedor)) return false;
  try {
    return await db.transaction(async (tx) => {
      await limitarEspera(tx);
      const linhas = await tx
        .update(pagamentos)
        .set({ idProvedor: cobranca.idProvedor, atualizadoEm: agora })
        .where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.referencia, cobranca.referencia), isNull(pagamentos.idProvedor)))
        .returning({ id: pagamentos.id });
      return linhas.length > 0;
    });
  } catch (e) {
    if (violouUnicidade(e)) return false;
    throw e;
  }
}
