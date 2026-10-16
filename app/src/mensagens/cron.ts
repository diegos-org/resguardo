/** Execução agendada das mensagens ao hóspede (M9.2), registrada na página "Sistema". */
import { organizacoes } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { ErroDeRotina, type FalhasDaRotina, somarFalhas, totalDeFalhas } from "@/observabilidade/erro-de-rotina";
import { registrarExecucao } from "@/sistema/automacoes";
import { enviarMensagensHospede, registrarUltimaExecucao, resumoMensagens } from "./hospede";

/**
 * Todas as organizações; recusa/incerteza do provedor ou falta de provedor (com o envio ligado) fica como erro: o resumo
 * em Sistema e, no aviso ao Sentry, só as contagens (M0.9, `ErroDeRotina`).
 */
export function mensagensDeTodas(db: Db, correio: Correio | null, agora: Date): Promise<string> {
  return registrarExecucao(db, "mensagens-hospede", async () => {
    const orgs = await db.select({ id: organizacoes.id }).from(organizacoes);
    const partes: string[] = [];
    const falhas: FalhasDaRotina = {};
    for (const o of orgs) {
      try {
        const r = await enviarMensagensHospede(db, o.id, correio, agora);
        const problema = !!(r.falhas || r.incertas || r.semProvedor);
        // Geral (Sistema) só com contagens; o detalhe (códigos de reserva) fica na organização.
        partes.push(resumoMensagens(r, false));
        await registrarUltimaExecucao(db, o.id, agora, resumoMensagens(r), !problema);
        somarFalhas(falhas, { email_nao_enviado: r.falhas, email_sem_confirmacao: r.incertas, sem_provedor: r.semProvedor ? 1 : 0 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        partes.push("erro numa organização (detalhe em Configurações → Modelos de mensagem)");
        await registrarUltimaExecucao(db, o.id, agora, `erro: ${msg}`, false).catch(() => undefined);
        somarFalhas(falhas, { erro_na_organizacao: 1 });
      }
    }
    const resumo = partes.join("; ") || "nenhuma organização";
    // Sistema fica só com as contagens; o detalhe (códigos de reserva, mensagem do erro) fica na última execução de cada
    // organização, e o aviso ao Sentry diz isso (M0.9).
    if (totalDeFalhas(falhas)) throw new ErroDeRotina(resumo, falhas, { detalheEm: "mensagens" });
    return resumo;
  });
}
