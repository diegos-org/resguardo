import type { Db } from "@/db/types";
import { registrarExecucao } from "@/sistema/automacoes";
import { organizacaoBeds24, lerConfigBeds24 } from "./configuracao";
import { leitorParaSincronizacao } from "./http";
import { erroDaRotinaBeds24, sincronizarBeds24 } from "./sincronizacao";
import { ErroBeds24 } from "./tipos";

export function executarCronBeds24(db: Db, env: NodeJS.ProcessEnv = process.env) {
  return registrarExecucao(db, "sync-beds24", async () => {
    try {
      const org = await organizacaoBeds24(db, env);
      if (!(await lerConfigBeds24(db, org)).automatica) return "Sincronização automática desligada no painel.";
      const leitor = leitorParaSincronizacao(env);
      if (!leitor) throw new ErroBeds24("Credencial Beds24 não configurada.", "configuracao");
      const r = await sincronizarBeds24(db, org, leitor, { automatica: true });
      if (!r.ok && r.situacao !== "ocupada") throw new ErroBeds24("Sincronização falhou; consulte Integrações.", "configuracao");
      return r.mensagem;
    } catch (e) {
      // registrarExecucao grava error.message: entregar somente texto sanitizado (e, ao Sentry, só o motivo; M0.9).
      throw erroDaRotinaBeds24(e);
    }
  });
}
