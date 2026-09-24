/** Execução agendada do e-mail do fechamento (M5.4), registrada na página "Sistema". */
import { registrarAuditoria } from "@/auditoria/auditoria";
import { organizacoes } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { registrarExecucao } from "@/sistema/automacoes";
import { enviarFechamentos, type ResultadoFechamentoEmail, resumoDoFechamentoEmail } from "./email";

/** Envia o fechamento do mês anterior em cada organização. Falha de envio ou falta de provedor (com o envio ligado) fica como erro. */
export function fechamentoDeTodas(db: Db, correio: Correio | null, agora: Date): Promise<string> {
  return registrarExecucao(db, "fechamento-email", async () => {
    const partes: string[] = [];
    let erro = false;
    for (const org of await db.select({ id: organizacoes.id }).from(organizacoes)) {
      try {
        const r = await enviarFechamentos(db, org.id, correio, agora);
        partes.push(resumoDoFechamentoEmail(r));
        if (r.falhas.length || r.aviso?.startsWith("sem provedor")) erro = true;
      } catch (e) {
        partes.push(`erro numa organização: ${e instanceof Error ? e.message : String(e)}`);
        erro = true;
      }
    }
    const resumo = partes.join("; ") || "nenhuma organização";
    if (erro) throw new Error(resumo);
    return resumo;
  });
}

/** Botão do painel (um proprietário, ou todos os prontos do mês): fica no histórico da organização. */
export async function fechamentoManual(
  db: Db,
  organizacaoId: string,
  correio: Correio | null,
  agora: Date,
  o: { mes: string; proprietarioId?: string; reenviar?: boolean },
  autorId: string | null,
): Promise<ResultadoFechamentoEmail> {
  const r = await enviarFechamentos(db, organizacaoId, correio, agora, { ...o, manual: true });
  await registrarAuditoria(db, {
    organizacaoId,
    usuarioId: autorId,
    acao: "fechamento.email_manual",
    entidade: "configuracao",
    entidadeId: organizacaoId,
    mudancas: { envio: [null, `${r.falhas.length || r.aviso ? "falhou" : "ok"}: ${resumoDoFechamentoEmail(r)}`] },
  });
  return r;
}
