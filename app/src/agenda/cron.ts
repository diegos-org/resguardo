/** Execução agendada da agenda diária (M6.3), registrada na página "Sistema". */
import { organizacoes } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { registrarExecucao } from "@/sistema/automacoes";
import { enviarAgenda, type ResultadoEnvio, resumoDoEnvio } from "./agenda";

const ORGS_SIMULTANEAS = 3;

/** Envia a agenda de cada organização. Falha de envio ou falta de provedor (com a agenda ligada) fica como erro. */
export function agendaDeTodas(db: Db, correio: Correio | null, agora: Date): Promise<string> {
  return registrarExecucao(db, "agenda-diaria", async () => {
    // Algumas organizações ao mesmo tempo: uma lenta (provedor fora do ar) não segura as outras até o
    // fim do tempo da execução. O resumo fica na ordem das organizações.
    const orgs = await db.select({ id: organizacoes.id }).from(organizacoes);
    const partes: string[] = new Array(orgs.length);
    let erro = false;
    let proxima = 0;
    const umaOrg = async () => {
      for (let i = proxima++; i < orgs.length; i = proxima++) {
        // Um erro numa organização não impede as outras de receber a agenda.
        try {
          const r = await enviarAgenda(db, orgs[i].id, correio, agora);
          partes[i] = resumoDoEnvio(r);
          if (r.falhas.length || r.aviso?.startsWith("sem provedor")) erro = true;
        } catch {
          // Falha de banco/adaptador pode conter a carga privada da agenda.
          partes[i] = "erro ao montar ou enviar a agenda de uma organização";
          erro = true;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ORGS_SIMULTANEAS, orgs.length) }, umaOrg));
    const resumo = partes.join("; ") || "nenhuma organização";
    if (erro) throw new Error(resumo);
    return resumo;
  });
}

/**
 * "Enviar agora" do painel. É da organização (não do sistema): fica no histórico dela (auditoria),
 * não em Sistema → Automações, que é a execução agendada comum a todas.
 */
export async function agendaManual(db: Db, organizacaoId: string, correio: Correio | null, agora: Date, autorId: string | null = null): Promise<ResultadoEnvio> {
  const r = await enviarAgenda(db, organizacaoId, correio, agora, { manual: true });
  await registrarAuditoria(db, {
    organizacaoId,
    usuarioId: autorId,
    acao: "agenda.envio_manual",
    entidade: "configuracao",
    entidadeId: organizacaoId,
    mudancas: { envio: [null, `${r.falhas.length || r.aviso ? "falhou" : "ok"}: ${resumoDoEnvio(r)}`] },
  });
  return r;
}
