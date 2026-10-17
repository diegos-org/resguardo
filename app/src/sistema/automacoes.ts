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
  { id: "sync-beds24", nome: "Sincronização de reservas e calendário com o Beds24", quando: "Diária, entre 06:15 e 07:15, quando ligada em Integrações; também manual", situacao: "ativa", item: "M3.3" },
  { id: "envio-beds24", nome: "Envio de calendário e preços ao Beds24/OTAs", quando: "Diário às 07:00 (depois da importação), quando ligado em Configurações → Calendário e preços e com BEDS24_ESCRITA=ligada; também manual na prévia", situacao: "ativa", item: "M3.7" },
  // M8.3: a rotina chega no M8.3c (a escrita); até lá, "Simular" na ficha da reserva faz o papel dela, sem rede.
  {
    id: "reservas-beds24",
    nome: "Reservas pagas do site no Beds24 (criar, atualizar, cancelar e conferir)",
    quando: "A cada 10 minutos, fora das janelas da importação e do envio diários, só no deploy de produção; escreve só com BEDS24_ESCRITA_RESERVAS=ligada e a configuração pronta; também na ficha",
    situacao: "planejada",
    item: "M8.3c",
  },
  { id: "agenda-diaria", nome: "Agenda diária da equipe (próximos 5 dias)", quando: "Todo dia às 20:00", situacao: "ativa", item: "M6.3" },
  { id: "fechamento-email", nome: "E-mail do fechamento mensal aos proprietários (relatório em PDF)", quando: "Todo dia às 09:00, do dia do fechamento (dia 2 por padrão; Configurações → Repasses) até o mês ser fechado e enviado", situacao: "ativa", item: "M5.4" },
  { id: "fechamento-mensal", nome: "Fechamento e repasse automáticos do mês", quando: "No dia do fechamento de cada mês (dia 2 por padrão; Configurações → Repasses)", situacao: "planejada", item: "M4.9" },
  { id: "repasses-periodicos", nome: "Repasses antecipados (quinzenal, semanal, assim que disponível) e e-mail dos repasses pagos", quando: "Todo dia às 08:00 (nunca no dia do fechamento: o fechamento é o repasse do dia)", situacao: "ativa", item: "M4.10" },
  { id: "repasses-emails", nome: "E-mail dos repasses pagos: envia o que falta e repete a tentativa sem confirmação do provedor", quando: "De hora em hora, aos 30 minutos (a repetição com a mesma chave vale por 23 h)", situacao: "ativa", item: "M4.10" },
  { id: "mensagens-hospede", nome: "Mensagens programadas ao hóspede (e-mail)", quando: "De hora em hora (confirmação, D-2 10:00, D-1 14:00, D+3 10:00)", situacao: "ativa", item: "M9.2" },
  {
    id: "pedidos-site",
    nome: "Pedidos e pagamentos do site: confere os pagamentos e depois vence os pedidos sem pagamento",
    quando: "A cada 10 minutos (no deploy de produção só vence os pedidos: o teste do pagamento roda nas prévias, com \"Conferir agora\")",
    situacao: "ativa",
    item: "M8.2a",
  },
  {
    id: "whatsapp",
    nome: "WhatsApp: limpeza dos avisos antigos (90 dias) e e-mail da conta desconectada",
    quando: "De hora em hora, aos 17 minutos, só no deploy de produção",
    situacao: "ativa",
    item: "M10.1a",
  },
];

export type Execucao = typeof execucoesAutomacao.$inferSelect;

/**
 * A rotina não rodou por um motivo de fora dela (ex.: outra importação ou envio do Beds24 em andamento): fica registrada
 * como "Não rodou: <causa>", com `ok` falso — nunca como sucesso —, sem virar erro (a rota do cron não falha por isso).
 */
export type NaoRodou = { naoRodou: string };
export const naoRodou = (causa: string): NaoRodou => ({ naoRodou: causa });
export const PREFIXO_NAO_RODOU = "Não rodou: ";
/** A execução registrada como "não rodou" (a página Sistema mostra com o selo de aviso, e não o de falha). */
export const execucaoNaoRodou = (e: Pick<Execucao, "ok" | "resumo">) => e.ok === false && e.resumo.startsWith(PREFIXO_NAO_RODOU);

/** Roda `fn` registrando início, fim, sucesso e resumo. Erros são registrados e repassados; "não rodou" é registrado e devolvido. */
export async function registrarExecucao(db: Db, nome: string, fn: () => Promise<string | NaoRodou>, agora: () => Date = () => new Date()): Promise<string> {
  const [e] = await db.insert(execucoesAutomacao).values({ nome, iniciadoEm: agora() }).returning({ id: execucoesAutomacao.id });
  try {
    const r = await fn();
    if (typeof r !== "string") {
      const resumo = `${PREFIXO_NAO_RODOU}${r.naoRodou}`.slice(0, 500);
      await db.update(execucoesAutomacao).set({ terminadoEm: agora(), ok: false, resumo }).where(eq(execucoesAutomacao.id, e.id));
      return resumo;
    }
    const resumo = r;
    await db.update(execucoesAutomacao).set({ terminadoEm: agora(), ok: true, resumo: resumo.slice(0, 500) }).where(eq(execucoesAutomacao.id, e.id));
    return resumo;
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    await db.update(execucoesAutomacao).set({ terminadoEm: agora(), ok: false, resumo: `Falhou: ${msg}`.slice(0, 500) }).where(eq(execucoesAutomacao.id, e.id));
    throw erro;
  }
}

/**
 * Última execução de cada automação (por id). Uma por nome (índice nome + início): a rotina de 10 em 10 minutos não
 * empurra para fora as que rodam uma vez por mês.
 */
export async function ultimasExecucoes(db: Db): Promise<Map<string, Execucao>> {
  const linhas = await db
    .selectDistinctOn([execucoesAutomacao.nome])
    .from(execucoesAutomacao)
    .orderBy(execucoesAutomacao.nome, desc(execucoesAutomacao.iniciadoEm), desc(execucoesAutomacao.id));
  return new Map(linhas.map((l) => [l.nome, l]));
}

