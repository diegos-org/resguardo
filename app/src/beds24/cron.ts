import type { Db } from "@/db/types";
import { naoRodou, registrarExecucao } from "@/sistema/automacoes";
import { organizacaoBeds24, lerConfigBeds24 } from "./configuracao";
import { leitorParaSincronizacao } from "./http";
import { mensagemSeguraBeds24, sincronizarBeds24 } from "./sincronizacao";
import { ErroBeds24, type LeitorBeds24 } from "./tipos";

/**
 * Importação diária. Terminou "ocupada" (outra importação, um envio de calendário ou de reserva do site em andamento):
 * registrada como "não rodou: <causa>", nunca como sucesso. `o.leitor`: a versão falsa nos testes (nunca a rede).
 */
export function executarCronBeds24(db: Db, env: NodeJS.ProcessEnv = process.env, o: { leitor?: LeitorBeds24 } = {}) {
  return registrarExecucao(db, "sync-beds24", async () => {
    try {
      const org = await organizacaoBeds24(db, env);
      if (!(await lerConfigBeds24(db, org)).automatica) return "Sincronização automática desligada no painel.";
      const leitor = o.leitor ?? leitorParaSincronizacao(env);
      if (!leitor) throw new ErroBeds24("Credencial Beds24 não configurada.", "configuracao");
      const r = await sincronizarBeds24(db, org, leitor, { automatica: true });
      if (r.situacao === "ocupada") return naoRodou(r.causa ?? r.mensagem);
      if (!r.ok) throw new ErroBeds24("Sincronização falhou; consulte Integrações.", "configuracao");
      return r.mensagem;
    } catch (e) {
      // registrarExecucao grava error.message: entregar somente texto sanitizado.
      throw new Error(mensagemSeguraBeds24(e));
    }
  });
}
