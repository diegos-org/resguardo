import { enviarCalendarioBeds24 } from "@/calendario/envio";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import type { Db } from "@/db/types";
import { registrarExecucao } from "@/sistema/automacoes";
import { organizacaoBeds24 } from "./configuracao";
import { escritaBeds24Ligada, escritorDoAmbiente, impressaoCredencialBeds24, leitorParaSincronizacao } from "./http";
import { mensagemSeguraBeds24 } from "./sincronizacao";
import { ErroBeds24 } from "./tipos";

/** Envio diário (M3.7): só roda com o envio automático ligado no painel E `BEDS24_ESCRITA=ligada`. */
export function executarCronEnvioBeds24(db: Db, env: NodeJS.ProcessEnv = process.env) {
  return registrarExecucao(db, "envio-beds24", async () => {
    try {
      const org = await organizacaoBeds24(db, env);
      if (!(await lerRegrasCalendario(db, org)).envio.automatico) return "Envio automático desligado no painel (Configurações → Calendário e preços).";
      if (!escritaBeds24Ligada(env)) return "BEDS24_ESCRITA não está ligada na Vercel: nada foi enviado.";
      const leitor = leitorParaSincronizacao(env);
      const escritor = escritorDoAmbiente(env);
      if (!leitor || !escritor) throw new ErroBeds24("Credencial Beds24 não configurada.", "configuracao");
      const r = await enviarCalendarioBeds24(db, org, leitor, escritor, { modo: "envio", automatica: true, credencial: impressaoCredencialBeds24(env) });
      if (!r.ok && r.situacao !== "ocupada") throw new ErroBeds24(`Envio ${r.situacao}: ${r.mensagem}`, "configuracao");
      return r.mensagem;
    } catch (e) {
      throw new Error(mensagemSeguraBeds24(e));
    }
  });
}
