/** Execução agendada da agenda diária (M6.3), registrada na página "Sistema". */
import { organizacoes } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { registrarExecucao } from "@/sistema/automacoes";
import { enviarAgenda, type ResultadoEnvio, resumoDoEnvio } from "./agenda";

/** Envia a agenda de cada organização. Falha de envio ou falta de provedor (com a agenda ligada) fica como erro. */
export function agendaDeTodas(db: Db, correio: Correio | null, agora: Date): Promise<string> {
  return registrarExecucao(db, "agenda-diaria", async () => {
    const partes: string[] = [];
    let erro = false;
    for (const org of await db.select({ id: organizacoes.id }).from(organizacoes)) {
      const r = await enviarAgenda(db, org.id, correio, agora);
      partes.push(resumoDoEnvio(r));
      if (r.falhas.length || r.aviso?.startsWith("sem provedor")) erro = true;
    }
    const resumo = partes.join("; ") || "nenhuma organização";
    if (erro) throw new Error(resumo);
    return resumo;
  });
}

/** "Enviar agora" do painel: registrado em Sistema → Automações como o das 20h. */
export async function agendaManual(db: Db, organizacaoId: string, correio: Correio | null, agora: Date): Promise<ResultadoEnvio> {
  const feito: { r?: ResultadoEnvio } = {};
  try {
    await registrarExecucao(db, "agenda-diaria", async () => {
      const r = (feito.r = await enviarAgenda(db, organizacaoId, correio, agora, { manual: true }));
      const resumo = `envio manual: ${resumoDoEnvio(r)}`;
      if (r.falhas.length || r.aviso) throw new Error(resumo);
      return resumo;
    });
  } catch (e) {
    if (!feito.r) throw e;
  }
  return feito.r!;
}
