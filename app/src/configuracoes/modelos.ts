/**
 * Modelos de mensagem (M1.7). Texto com variáveis entre chaves ({hospede}, {checkin}…),
 * preenchidas na hora do envio (M9.2/M10). Variável desconhecida é recusada ao salvar, para
 * não sair "{hopede}" para um hóspede.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { violouUnicidade } from "@/db/erros";
import { appSettings, modelosMensagem } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { type DadosModelo, type ErrosModelo, validarModelo } from "./modelos-texto";

export * from "./modelos-texto";

/** Modelos sugeridos na primeira vez (Diego edita, arquiva ou exclui). */
export const MODELOS_INICIAIS = [
  { nome: "Confirmação da reserva", quando: "Logo após a confirmação", texto: "Olá, {hospede}! Sua reserva {codigo} no {imovel} está confirmada: entrada em {checkin} e saída em {checkout} ({noites} noites). Qualquer dúvida, é só responder esta mensagem. {empresa}" },
  { nome: "Instruções de check-in", quando: "2 dias antes da entrada, 10h", texto: "Olá, {hospede}! Sua chegada ao {imovel} é em {checkin}. O endereço é {endereco}. Em breve enviamos as instruções de acesso." },
  { nome: "Lembrete de check-out", quando: "1 dia antes da saída, 14h", texto: "Olá, {hospede}! Lembrete: sua saída do {imovel} é amanhã, {checkout}. Obrigado pela estadia!" },
  { nome: "Agradecimento", quando: "3 dias depois da saída, 10h", texto: "Olá, {hospede}! Obrigado por ficar no {imovel}. Esperamos receber você de novo. {empresa}" },
];

export type Modelo = typeof modelosMensagem.$inferSelect;
export type ResultadoModelo = { ok: true; modelo?: Modelo } | { ok: false; erros: ErrosModelo };

export async function listarModelos(db: Db, organizacaoId: string): Promise<Modelo[]> {
  return db.select().from(modelosMensagem).where(eq(modelosMensagem.organizacaoId, organizacaoId)).orderBy(asc(modelosMensagem.criadoEm), asc(modelosMensagem.nome));
}

const NOME_REPETIDO = { ok: false as const, erros: { nome: "Já existe um modelo com esse nome." } };

export async function criarModelo(
  db: Db,
  organizacaoId: string,
  bruto: Record<string, unknown>,
  autorId: string | null,
  criadoEm?: Date,
): Promise<ResultadoModelo> {
  const v = validarModelo(bruto);
  if (!v.ok) return v;
  try {
    return await db.transaction(async (tx) => {
      const [modelo] = await tx.insert(modelosMensagem).values({ organizacaoId, ...v.dados, ...(criadoEm ? { criadoEm } : {}) }).returning();
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "modelo_mensagem.criar", entidade: "modelo_mensagem", entidadeId: modelo.id, mudancas: calcularMudancas(null, v.dados) });
      return { ok: true as const, modelo };
    });
  } catch (e) {
    if (violouUnicidade(e, "modelos_mensagem_nome")) return NOME_REPETIDO;
    throw e;
  }
}

export async function atualizarModelo(
  db: Db,
  organizacaoId: string,
  id: string,
  mudanca: { dados?: Record<string, unknown>; ativo?: boolean },
  autorId: string | null,
): Promise<ResultadoModelo> {
  if (!uuidValido(id)) return { ok: false, erros: { nome: "Modelo não encontrado." } };
  let dados: DadosModelo | undefined;
  if (mudanca.dados) {
    const v = validarModelo(mudanca.dados);
    if (!v.ok) return v;
    dados = v.dados;
  }
  try {
    return await db.transaction(async (tx) => {
      const [antes] = await tx
        .select()
        .from(modelosMensagem)
        .where(and(eq(modelosMensagem.id, id), eq(modelosMensagem.organizacaoId, organizacaoId)))
        .for("update");
      if (!antes) return { ok: false as const, erros: { nome: "Modelo não encontrado." } };
      const novo = { ...(dados ?? {}), ...(mudanca.ativo !== undefined ? { ativo: mudanca.ativo } : {}) };
      const mudancas = calcularMudancas(antes, { ...antes, ...novo });
      if (!Object.keys(mudancas).length) return { ok: true as const, modelo: antes };
      const [modelo] = await tx.update(modelosMensagem).set({ ...novo, atualizadoEm: new Date() }).where(eq(modelosMensagem.id, id)).returning();
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "modelo_mensagem.editar", entidade: "modelo_mensagem", entidadeId: id, mudancas });
      return { ok: true as const, modelo };
    });
  } catch (e) {
    if (violouUnicidade(e, "modelos_mensagem_nome")) return NOME_REPETIDO;
    throw e;
  }
}

/** Exclui de vez (com confirmação na tela). Quando houver envios registrados (M9), arquivar. */
export async function excluirModelo(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<boolean> {
  if (!uuidValido(id)) return false;
  return db.transaction(async (tx) => {
    const [m] = await tx.delete(modelosMensagem).where(and(eq(modelosMensagem.id, id), eq(modelosMensagem.organizacaoId, organizacaoId))).returning();
    if (!m) return false;
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "modelo_mensagem.excluir", entidade: "modelo_mensagem", entidadeId: id, mudancas: { nome: [m.nome, null] } });
    return true;
  });
}

/** Cria os modelos sugeridos uma única vez por organização (se apagar, não voltam). */
export async function garantirModelosIniciais(db: Db, organizacaoId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [marca] = await tx
      .insert(appSettings)
      .values({ key: `modelos-iniciais:${organizacaoId}`, value: { criadosEm: new Date().toISOString() } })
      .onConflictDoNothing()
      .returning();
    if (!marca) return;
    const [existe] = await tx.select({ n: sql<number>`count(*)::int` }).from(modelosMensagem).where(eq(modelosMensagem.organizacaoId, organizacaoId));
    if (existe.n) return;
    // Horários em sequência para a lista seguir a ordem da estadia.
    const agora = Date.now();
    for (const [i, m] of MODELOS_INICIAIS.entries()) await criarModelo(tx, organizacaoId, m, null, new Date(agora + i));
  });
}
