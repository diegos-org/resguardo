import { enviarCalendarioBeds24 } from "@/calendario/envio";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import type { Db } from "@/db/types";
import { ErroDeRotina, umaFalha } from "@/observabilidade/erro-de-rotina";
import { naoRodou, registrarExecucao } from "@/sistema/automacoes";
import { organizacaoBeds24 } from "./configuracao";
import { escritaBeds24Ligada, escritorDoAmbiente, impressaoCredencialBeds24, leitorParaSincronizacao } from "./http";
import { erroDaRotinaBeds24 } from "./sincronizacao";
import { ErroBeds24, type EscritorBeds24, type LeitorBeds24 } from "./tipos";

/**
 * Envio diário (M3.7): só roda com o envio automático ligado no painel E `BEDS24_ESCRITA=ligada`. Terminou "ocupada"
 * (outra importação ou envio em andamento, inclusive de reserva do site): registrado como "não rodou: <causa>", nunca como
 * sucesso. `o.leitor`/`o.escritor`: a versão falsa nos testes (nunca a rede).
 */
export function executarCronEnvioBeds24(db: Db, env: NodeJS.ProcessEnv = process.env, o: { leitor?: LeitorBeds24; escritor?: EscritorBeds24 } = {}) {
  return registrarExecucao(db, "envio-beds24", async () => {
    let r: Awaited<ReturnType<typeof enviarCalendarioBeds24>>;
    try {
      const org = await organizacaoBeds24(db, env);
      if (!(await lerRegrasCalendario(db, org)).envio.automatico) return "Envio automático desligado no painel (Configurações → Calendário e preços).";
      if (!escritaBeds24Ligada(env)) return "BEDS24_ESCRITA não está ligada na Vercel: nada foi enviado.";
      const leitor = o.leitor ?? leitorParaSincronizacao(env);
      const escritor = o.escritor ?? escritorDoAmbiente(env);
      if (!leitor || !escritor) throw new ErroBeds24("Credencial Beds24 não configurada.", "configuracao");
      r = await enviarCalendarioBeds24(db, org, leitor, escritor, { modo: "envio", automatica: true, credencial: impressaoCredencialBeds24(env) });
    } catch (e) {
      throw erroDaRotinaBeds24(e);
    }
    if (r.situacao === "ocupada") return naoRodou(r.causa ?? r.mensagem);
    // O resumo do envio vai para Sistema como sempre (pode ter o código de um imóvel); ao Sentry, só o motivo (M0.9).
    if (!r.ok) throw new ErroDeRotina(`Envio ${r.situacao}: ${r.mensagem}`, umaFalha("envio_incompleto"));
    return r.mensagem;
  });
}
