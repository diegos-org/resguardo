/**
 * Rotina diária dos repasses (M4.10), chamada pelo agendador às 8h de São Paulo: gera o repasse
 * antecipado de quem tem periodicidade quinzenal, semanal ou "assim que disponível" quando a data
 * bate (nunca no dia 1º: o fechamento é o único repasse do dia) e manda os e-mails dos repasses
 * pagos com comprovante que ainda não saíram. Registrada na página "Sistema".
 */
import { and, eq } from "drizzle-orm";
import { organizacoes, proprietarios } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { hojeISO } from "@/lib/datas";
import { registrarExecucao } from "@/sistema/automacoes";
import { enviarEmailsDeRepasses } from "./email";
import { geraAntecipadoEm } from "./periodicidade";
import { periodicidadeDoProprietario } from "./proprietario";
import { lerRegrasRepasses } from "./regras-config";
import { gerarAntecipado } from "./repasses";

export type ResultadoRotinaRepasses = { gerados: number; semDisponivel: number; falhas: string[]; emails: Awaited<ReturnType<typeof enviarEmailsDeRepasses>> };

export async function rotinaDeRepasses(db: Db, organizacaoId: string, correio: Correio | null, agora: Date): Promise<ResultadoRotinaRepasses> {
  const hoje = hojeISO("America/Sao_Paulo", agora);
  const regras = await lerRegrasRepasses(db, organizacaoId);
  const r: ResultadoRotinaRepasses = { gerados: 0, semDisponivel: 0, falhas: [], emails: { enviados: 0, semComprovante: 0, semEmail: 0, incertos: 0, falhas: 0, semProvedor: false } };
  const donos = await db.select({ id: proprietarios.id, nome: proprietarios.nome }).from(proprietarios).where(and(eq(proprietarios.organizacaoId, organizacaoId), eq(proprietarios.ativo, true)));
  for (const d of donos) {
    const p = await periodicidadeDoProprietario(db, organizacaoId, d.id, hoje, regras);
    if (!p || !geraAntecipadoEm(hoje, p.efetiva, regras)) continue;
    const g = await gerarAntecipado(db, organizacaoId, d.id, hoje, null, { agora });
    if (g.ok) r.gerados++;
    else if (g.erro.startsWith("Nada disponível") || g.erro.startsWith("Já existe")) r.semDisponivel++;
    else r.falhas.push(`${d.nome}: ${g.erro}`);
  }
  r.emails = await enviarEmailsDeRepasses(db, organizacaoId, correio, agora);
  return r;
}

export function resumoDaRotina(r: ResultadoRotinaRepasses): string {
  const e = r.emails;
  return [
    `${r.gerados} repasse(s) antecipado(s) gerado(s)`,
    r.semDisponivel ? `${r.semDisponivel} proprietário(s) sem valor disponível` : "",
    e.enviados ? `${e.enviados} e-mail(s) enviado(s)` : "",
    e.semComprovante ? `${e.semComprovante} repasse(s) pago(s) sem comprovante (e-mail espera)` : "",
    e.semEmail ? `${e.semEmail} sem e-mail cadastrado` : "",
    e.incertos ? `${e.incertos} e-mail(s) sem confirmação` : "",
    e.falhas ? `${e.falhas} e-mail(s) recusado(s)` : "",
    e.semProvedor ? "sem provedor de e-mail configurado" : "",
    ...r.falhas,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Todas as organizações; uma falha não impede as outras. Falha ou e-mail recusado fica como erro na execução. */
export function repassesDeTodas(db: Db, correio: Correio | null, agora: Date): Promise<string> {
  return registrarExecucao(db, "repasses-periodicos", async () => {
    const orgs = await db.select({ id: organizacoes.id }).from(organizacoes);
    const partes: string[] = [];
    let erro = false;
    for (const o of orgs) {
      try {
        const r = await rotinaDeRepasses(db, o.id, correio, agora);
        partes.push(resumoDaRotina(r));
        if (r.falhas.length || r.emails.falhas) erro = true;
      } catch {
        partes.push("erro ao gerar repasses ou enviar e-mails de uma organização");
        erro = true;
      }
    }
    const resumo = partes.join("; ") || "nenhuma organização";
    if (erro) throw new Error(resumo);
    return resumo;
  });
}
