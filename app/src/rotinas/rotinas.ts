/**
 * Rotinas recorrentes (M6.5): tarefas que se repetem — conferência semanal das faxinas, consulta
 * quinzenal de manutenção e mídia, lembrete administrativo mensal, caixinhas no ano. Tudo editável
 * no painel (título, descrição, frequência, próxima data, arquivar).
 *
 * "Feita" registra a execução do vencimento atual e leva a próxima data para o primeiro vencimento
 * depois do dia em que foi feita, no mesmo ritmo (quem atrasou três semanas não deve três
 * conferências). "Pular" faz o mesmo com motivo obrigatório. Nada vira "feito" sozinho: vencida e
 * não registrada, a rotina aparece como atrasada.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { appSettings, FREQUENCIAS_ROTINA, type FrequenciaRotina, rotinaExecucoes, rotinas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";

export type Rotina = typeof rotinas.$inferSelect;
export type Execucao = typeof rotinaExecucoes.$inferSelect;
export type Resultado = { ok: true } | { ok: false; erro: string };

export const NOMES_FREQUENCIA: Record<FrequenciaRotina, string> = { semanal: "Toda semana", quinzenal: "A cada 15 dias", mensal: "Todo mês", anual: "Todo ano" };

// ——— Datas (regra pura) ———

const dia = (d: string) => new Date(`${d}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Soma `n` períodos a partir de `base`. Mês/ano curtos ficam no último dia (31/01 + 1 mês = 28/02). */
export function somarPeriodo(base: string, f: FrequenciaRotina, n = 1): string {
  const d = dia(base);
  if (f === "semanal" || f === "quinzenal") {
    d.setUTCDate(d.getUTCDate() + n * (f === "semanal" ? 7 : 14));
    return iso(d);
  }
  const meses = n * (f === "mensal" ? 1 : 12);
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1, 12));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0, 12)).getUTCDate();
  alvo.setUTCDate(Math.min(d.getUTCDate(), ultimo));
  return iso(alvo);
}

/** Primeiro vencimento depois de `feitaEm`, contando no ritmo a partir de `prevista`. */
export function proximaDepois(prevista: string, f: FrequenciaRotina, feitaEm: string): string {
  let n = 1;
  let proxima = somarPeriodo(prevista, f, n);
  while (proxima <= feitaEm) proxima = somarPeriodo(prevista, f, ++n);
  return proxima;
}

export type SituacaoRotina = "atrasada" | "hoje" | "esta_semana" | "em_dia" | "arquivada";

export function situacaoDa(r: Pick<Rotina, "ativa" | "proximaData">, hoje: string): SituacaoRotina {
  if (!r.ativa) return "arquivada";
  if (r.proximaData < hoje) return "atrasada";
  if (r.proximaData === hoje) return "hoje";
  return r.proximaData <= somarPeriodo(hoje, "semanal") ? "esta_semana" : "em_dia";
}

// ——— Cadastro ———

export type DadosRotina = { titulo: string; descricao: string; frequencia: string; proximaData: string };

function validar(d: DadosRotina): { ok: true; dados: Pick<Rotina, "titulo" | "descricao" | "frequencia" | "proximaData"> } | { ok: false; erro: string } {
  const titulo = d.titulo.trim();
  const descricao = d.descricao.trim();
  if (!titulo) return { ok: false, erro: "Informe o nome da rotina." };
  if (titulo.length > 120) return { ok: false, erro: "Nome com mais de 120 caracteres." };
  if (descricao.length > 1000) return { ok: false, erro: "Descrição com mais de 1000 caracteres." };
  if (!(FREQUENCIAS_ROTINA as readonly string[]).includes(d.frequencia)) return { ok: false, erro: "Escolha a frequência." };
  if (!dataValida(d.proximaData)) return { ok: false, erro: "Informe a próxima data." };
  return { ok: true, dados: { titulo, descricao, frequencia: d.frequencia as FrequenciaRotina, proximaData: d.proximaData } };
}

const auditar = (tx: Db, organizacaoId: string, autorId: string | null, acao: string, id: string, mudancas: Record<string, [unknown, unknown]>) =>
  registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: `rotina.${acao}`, entidade: "rotina", entidadeId: id, mudancas });

export async function criarRotina(db: Db, organizacaoId: string, d: DadosRotina, autorId: string | null): Promise<Resultado> {
  const v = validar(d);
  if (!v.ok) return v;
  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(rotinas)
      .values({ organizacaoId, ...v.dados })
      .returning();
    await auditar(tx, organizacaoId, autorId, "criar", r.id, calcularMudancas(null, r));
    return { ok: true as const };
  });
}

async function travar(tx: Db, organizacaoId: string, id: string): Promise<Rotina | null> {
  if (!uuidValido(id)) return null;
  const [r] = await tx
    .select()
    .from(rotinas)
    .where(and(eq(rotinas.id, id), eq(rotinas.organizacaoId, organizacaoId)))
    .for("update");
  return r ?? null;
}

/** Edita o cadastro (inclusive a próxima data: vale dali em diante; o histórico fica). */
export async function editarRotina(db: Db, organizacaoId: string, id: string, d: DadosRotina, autorId: string | null): Promise<Resultado> {
  const v = validar(d);
  if (!v.ok) return v;
  return db.transaction(async (tx) => {
    const antes = await travar(tx, organizacaoId, id);
    if (!antes) return { ok: false as const, erro: "Rotina não encontrada." };
    const [depois] = await tx
      .update(rotinas)
      .set({ ...v.dados, atualizadoEm: new Date() })
      .where(eq(rotinas.id, id))
      .returning();
    const mudancas = calcularMudancas(antes, depois);
    if (Object.keys(mudancas).length) await auditar(tx, organizacaoId, autorId, "editar", id, mudancas);
    return { ok: true as const };
  });
}

/** Arquivar (sai das pendências, o histórico fica) ou reativar. Nada é apagado. */
export async function arquivarRotina(db: Db, organizacaoId: string, id: string, ativa: boolean, autorId: string | null): Promise<Resultado> {
  return db.transaction(async (tx) => {
    const antes = await travar(tx, organizacaoId, id);
    if (!antes) return { ok: false as const, erro: "Rotina não encontrada." };
    if (antes.ativa === ativa) return { ok: true as const };
    await tx.update(rotinas).set({ ativa, atualizadoEm: new Date() }).where(eq(rotinas.id, id));
    await auditar(tx, organizacaoId, autorId, ativa ? "reativar" : "arquivar", id, { ativa: [antes.ativa, ativa] });
    return { ok: true as const };
  });
}

// ——— Feita / pulada ———

/**
 * Registra o vencimento atual como feito (ou pulado, com motivo) e leva a próxima data para o
 * primeiro vencimento depois do dia informado. Com trava: dois cliques ao mesmo tempo registram uma vez.
 */
export async function registrarExecucao(
  db: Db,
  organizacaoId: string,
  id: string,
  /** `prevista`: o vencimento que a tela mostrava (um segundo clique não registra o vencimento seguinte). */
  d: { prevista: string; feitaEm: string; observacao: string; pulada: boolean },
  hoje: string,
  autorId: string | null,
): Promise<Resultado> {
  if (!dataValida(d.feitaEm) || d.feitaEm > hoje) return { ok: false, erro: "Data inválida (não pode ser no futuro)." };
  const observacao = d.observacao.trim();
  if (observacao.length > 500) return { ok: false, erro: "Observação com mais de 500 caracteres." };
  if (d.pulada && !observacao) return { ok: false, erro: "Para pular, informe o motivo." };
  return db.transaction(async (tx) => {
    const r = await travar(tx, organizacaoId, id);
    if (!r) return { ok: false as const, erro: "Rotina não encontrada." };
    if (!r.ativa) return { ok: false as const, erro: "Rotina arquivada: reative para registrar." };
    if (r.proximaData !== d.prevista) return { ok: false as const, erro: "Este vencimento já foi registrado (a tela estava desatualizada)." };
    // Próxima data editada de volta para um vencimento já registrado: avisa em vez de duplicar.
    const [ja] = await tx
      .select({ id: rotinaExecucoes.id })
      .from(rotinaExecucoes)
      .where(and(eq(rotinaExecucoes.rotinaId, r.id), eq(rotinaExecucoes.prevista, r.proximaData)));
    if (ja) return { ok: false as const, erro: "O vencimento desta data já foi registrado: ajuste a próxima data da rotina." };
    const proxima = proximaDepois(r.proximaData, r.frequencia, d.feitaEm);
    await tx.insert(rotinaExecucoes).values({ organizacaoId, rotinaId: r.id, prevista: r.proximaData, feitaEm: d.feitaEm, pulada: d.pulada, observacao, usuarioId: autorId });
    await tx.update(rotinas).set({ proximaData: proxima, atualizadoEm: new Date() }).where(eq(rotinas.id, r.id));
    await auditar(tx, organizacaoId, autorId, d.pulada ? "pular" : "feita", r.id, {
      [d.pulada ? "pulada" : "feita"]: [r.proximaData, d.feitaEm],
      proximaData: [r.proximaData, proxima],
    });
    return { ok: true as const };
  });
}

// ——— Lista ———

export type LinhaRotina = Rotina & { situacao: SituacaoRotina; ultimas: Execucao[] };

export async function listarRotinas(db: Db, organizacaoId: string, hoje: string, f: { incluirArquivadas?: boolean } = {}): Promise<LinhaRotina[]> {
  const lista = await db
    .select()
    .from(rotinas)
    .where(and(eq(rotinas.organizacaoId, organizacaoId), f.incluirArquivadas ? undefined : eq(rotinas.ativa, true)))
    .orderBy(asc(rotinas.proximaData), asc(rotinas.titulo));
  if (!lista.length) return [];
  const execucoes = await db
    .select()
    .from(rotinaExecucoes)
    .where(inArray(rotinaExecucoes.rotinaId, lista.map((r) => r.id)))
    .orderBy(desc(rotinaExecucoes.prevista));
  const ordem: Record<SituacaoRotina, number> = { atrasada: 0, hoje: 1, esta_semana: 2, em_dia: 3, arquivada: 4 };
  return lista
    .map((r) => ({ ...r, situacao: situacaoDa(r, hoje), ultimas: execucoes.filter((e) => e.rotinaId === r.id).slice(0, 3) }))
    .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || a.proximaData.localeCompare(b.proximaData) || a.titulo.localeCompare(b.titulo));
}

/** Quantas rotinas estão atrasadas ou vencem hoje (para o aviso no Início). */
export async function rotinasPendentes(db: Db, organizacaoId: string, hoje: string): Promise<number> {
  return (await listarRotinas(db, organizacaoId, hoje)).filter((r) => r.situacao === "atrasada" || r.situacao === "hoje").length;
}

// ——— Rotinas iniciais ———

/** As rotinas que já existiam na operação (CONSOLIDACAO, 21/09): sugestões editáveis. */
export const ROTINAS_INICIAIS: { titulo: string; descricao: string; frequencia: FrequenciaRotina }[] = [
  { titulo: "Conferência das faxinas", descricao: "Conferir as limpezas da semana: feitas, custos e pendências.", frequencia: "semanal" },
  { titulo: "Consulta de manutenção e mídia", descricao: "Perguntar aos imóveis o que precisa de manutenção e se há fotos/vídeos a atualizar.", frequencia: "quinzenal" },
  { titulo: "Lembrete administrativo", descricao: "Conferir contas, documentos e pendências administrativas do mês.", frequencia: "mensal" },
  { titulo: "Caixinhas", descricao: "Conferir e acertar as caixinhas do ano.", frequencia: "anual" },
];

/**
 * Cria as rotinas iniciais uma única vez por organização, vencendo hoje (a equipe ajusta as datas).
 * Se o administrador depois arquivar ou mudar, elas não voltam sozinhas.
 */
export async function garantirRotinasIniciais(db: Db, organizacaoId: string, hoje: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [marca] = await tx
      .insert(appSettings)
      .values({ key: `rotinas-iniciais:${organizacaoId}`, value: { criadasEm: new Date().toISOString() } })
      .onConflictDoNothing()
      .returning();
    if (!marca) return;
    const [existente] = await tx.select({ id: rotinas.id }).from(rotinas).where(eq(rotinas.organizacaoId, organizacaoId)).limit(1);
    if (existente) return;
    for (const r of ROTINAS_INICIAIS) await criarRotina(tx, organizacaoId, { ...r, proximaData: hoje }, null);
  });
}
