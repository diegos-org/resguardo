/** Execução agendada das mensagens ao hóspede (M9.2), registrada na página "Sistema". */
import { organizacoes } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { registrarExecucao } from "@/sistema/automacoes";
import { enviarMensagensHospede, resumoMensagens } from "./hospede";

/** Todas as organizações; recusa/incerteza do provedor ou falta de provedor (com o envio ligado) fica como erro. */
export function mensagensDeTodas(db: Db, correio: Correio | null, agora: Date): Promise<string> {
  return registrarExecucao(db, "mensagens-hospede", async () => {
    const orgs = await db.select({ id: organizacoes.id }).from(organizacoes);
    const partes: string[] = [];
    let erro = false;
    for (const o of orgs) {
      try {
        const r = await enviarMensagensHospede(db, o.id, correio, agora);
        partes.push(resumoMensagens(r));
        if (r.falhas || r.incertas || r.semProvedor) erro = true;
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
