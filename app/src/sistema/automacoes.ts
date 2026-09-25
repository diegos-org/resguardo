/**
 * Automações do sistema (M1.6): catálogo do que roda sozinho e registro de cada execução
 * (quando, se deu certo e um resumo), para aparecer na página "Sistema".
 */
import { desc, eq } from "drizzle-orm";
import { execucoesAutomacao } from "@/db/schema";
import type { Db } from "@/db/types";

export type Automacao = {
  id: string;
  nome: string;
  quando: string;
  situacao: "ativa" | "planejada";
  /** Item do ROADMAP que liga/cria a automação. */
  item: string;
};

export const AUTOMACOES: readonly Automacao[] = [
  { id: "recalculo-deploy", nome: "Recálculo do financeiro (reservas de hoje em diante)", quando: "A cada versão publicada", situacao: "ativa", item: "M4.2c" },
  { id: "sync-beds24", nome: "Sincronização de reservas e calendário com o Beds24", quando: "A cada poucos minutos", situacao: "planejada", item: "M3.3" },
  { id: "envio-beds24", nome: "Envio de calendário e preços ao Beds24/OTAs", quando: "A cada mudança no SCL", situacao: "planejada", item: "M3.7" },
  { id: "agenda-diaria", nome: "Agenda diária da equipe (próximos 5 dias)", quando: "Todo dia às 20h", situacao: "ativa", item: "M6.3" },
  { id: "fechamento-email", nome: "E-mail do fechamento mensal aos proprietários (relatório em PDF)", quando: "Todo dia às 9h, do dia 1º até o mês ser fechado e enviado", situacao: "ativa", item: "M5.4" },
  { id: "fechamento-mensal", nome: "Fechamento e repasse automáticos do mês", quando: "Dia 1º de cada mês", situacao: "planejada", item: "M4.9" },
  { id: "mensagens-hospede", nome: "Mensagens programadas ao hóspede (e-mail)", quando: "De hora em hora (confirmação, D-2 10h, D-1 14h, D+3 10h)", situacao: "ativa", item: "M9.2" },
];

export type Execucao = typeof execucoesAutomacao.$inferSelect;

/** Roda `fn` registrando início, fim, sucesso e resumo. Erros são registrados e repassados. */
export async function registrarExecucao(db: Db, nome: string, fn: () => Promise<string>, agora: () => Date = () => new Date()): Promise<string> {
  const [e] = await db.insert(execucoesAutomacao).values({ nome, iniciadoEm: agora() }).returning({ id: execucoesAutomacao.id });
  try {
    const resumo = await fn();
    await db.update(execucoesAutomacao).set({ terminadoEm: agora(), ok: true, resumo: resumo.slice(0, 500) }).where(eq(execucoesAutomacao.id, e.id));
    return resumo;
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    await db.update(execucoesAutomacao).set({ terminadoEm: agora(), ok: false, resumo: `Falhou: ${msg}`.slice(0, 500) }).where(eq(execucoesAutomacao.id, e.id));
    throw erro;
  }
}

/** Última execução de cada automação (por id). */
export async function ultimasExecucoes(db: Db): Promise<Map<string, Execucao>> {
  const linhas = await db.select().from(execucoesAutomacao).orderBy(desc(execucoesAutomacao.iniciadoEm)).limit(500);
  const m = new Map<string, Execucao>();
  for (const l of linhas) if (!m.has(l.nome)) m.set(l.nome, l);
  return m;
}
