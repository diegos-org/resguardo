/** Execução agendada do e-mail do fechamento (M5.4), registrada na página "Sistema". */
import { registrarAuditoria } from "@/auditoria/auditoria";
import { organizacoes } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { ErroDeRotina, type FalhasDaRotina, somarFalhas, totalDeFalhas } from "@/observabilidade/erro-de-rotina";
import { registrarExecucao } from "@/sistema/automacoes";
import { enviarFechamentos, enviarFechamentosAutomaticos, envioManualFalhou, type ResultadoFechamentoEmail, resumoDoFechamentoEmail } from "./email";

const ORGS_SIMULTANEAS = 3;

/**
 * Envia o fechamento do mês anterior em cada organização. Falha de envio ou falta de provedor (com o envio ligado) fica
 * como erro: o detalhe em Sistema (com a mensagem de um erro inesperado) e, no aviso ao Sentry, só as contagens (M0.9,
 * `ErroDeRotina`).
 */
export function fechamentoDeTodas(db: Db, correio: Correio | null, agora: Date): Promise<string> {
  return registrarExecucao(db, "fechamento-email", async () => {
    // Algumas organizações ao mesmo tempo (como a agenda): uma lenta não segura as outras.
    const orgs = await db.select({ id: organizacoes.id }).from(organizacoes);
    const partes: string[] = new Array(orgs.length);
    const falhas: FalhasDaRotina = {};
    let proxima = 0;
    const umaOrg = async () => {
      for (let i = proxima++; i < orgs.length; i = proxima++) {
        try {
          const rs = await enviarFechamentosAutomaticos(db, orgs[i].id, correio, agora);
          partes[i] = rs.map(resumoDoFechamentoEmail).join(" / ");
          somarFalhas(falhas, { email_nao_enviado: rs.reduce((t, r) => t + r.falhas.length, 0), sem_provedor: rs.some((r) => r.aviso?.startsWith("sem provedor")) ? 1 : 0 });
        } catch (e) {
          partes[i] = `erro numa organização: ${e instanceof Error ? e.message : String(e)}`;
          somarFalhas(falhas, { erro_na_organizacao: 1 });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ORGS_SIMULTANEAS, orgs.length) }, umaOrg));
    const resumo = partes.join("; ") || "nenhuma organização";
    if (totalDeFalhas(falhas)) throw new ErroDeRotina(resumo, falhas);
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
    mudancas: { envio: [null, `${envioManualFalhou(r, !!o.proprietarioId) ? "falhou" : "ok"}: ${resumoDoFechamentoEmail(r)}`] },
  });
  return r;
}
