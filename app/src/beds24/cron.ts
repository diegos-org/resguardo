import type { Db } from "@/db/types";
import { ErroDeRotina, umaFalha } from "@/observabilidade/erro-de-rotina";
import { registrarExecucao } from "@/sistema/automacoes";
import { organizacaoBeds24, lerConfigBeds24 } from "./configuracao";
import { leitorParaSincronizacao } from "./http";
import { erroDaRotinaBeds24, type ResultadoSync, sincronizarBeds24 } from "./sincronizacao";
import { ErroBeds24 } from "./tipos";

export function executarCronBeds24(db: Db, env: NodeJS.ProcessEnv = process.env) {
  return registrarExecucao(db, "sync-beds24", async () => {
    let r: ResultadoSync;
    try {
      const org = await organizacaoBeds24(db, env);
      if (!(await lerConfigBeds24(db, org)).automatica) return "Sincronização automática desligada no painel.";
      const leitor = leitorParaSincronizacao(env);
      if (!leitor) throw new ErroBeds24("Credencial Beds24 não configurada.", "configuracao");
      r = await sincronizarBeds24(db, org, leitor, { automatica: true });
    } catch (e) {
      // registrarExecucao grava error.message: entregar somente texto sanitizado (e, ao Sentry, só o motivo; M0.9).
      throw erroDaRotinaBeds24(e);
    }
    // A importação não concluída já ficou no histórico de Integrações, com o motivo e às vezes o código de um imóvel. Em
    // Sistema, o texto fixo de sempre; ao Sentry, o tipo da falha (rede, tempo, configuração...) e onde está o detalhe (M0.9).
    if (!r.ok && r.situacao !== "ocupada") throw new ErroDeRotina("Sincronização falhou; consulte Integrações.", umaFalha(r.falha ?? "erro_inesperado"), { detalheEm: "integracoes" });
    return r.mensagem;
  });
}
