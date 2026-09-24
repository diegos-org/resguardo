/**
 * Limpezas (M6.1). Toda reserva confirmada gera uma limpeza "pedida" no dia do checkout
 * (mesmo sem nova entrada, inclusive fim de semana). Confirmar (com a profissional) e realizar
 * são registros separados: agendar não comprova execução, e nada é marcado por suposição.
 *
 * `sincronizarLimpezas` é idempotente: cria as que faltam, acompanha mudança de data/imóvel e
 * cancela as de reserva cancelada — só enquanto a limpeza não foi realizada. Depois de
 * realizada, uma mudança na reserva vira aviso para conferência.
 */
import { and, asc, eq, gte, inArray, isNotNull, lt, or } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { type EstadoLimpeza, imoveis, limpezas, profissionaisLimpeza, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";

export type Limpeza = typeof limpezas.$inferSelect;
export type Profissional = typeof profissionaisLimpeza.$inferSelect;
export type Resultado = { ok: true } | { ok: false; erro: string };

export const NOMES_ESTADO: Record<EstadoLimpeza, string> = { pedida: "Pedida", confirmada: "Confirmada", realizada: "Realizada", cancelada: "Cancelada" };
/** Teto de custo por limpeza (R$ 100 mil): valor acima disso é erro de digitação. */
export const CUSTO_MAXIMO = 10_000_000;

type Periodo = { inicio: string; fim: string };

/** Cria/atualiza as limpezas das reservas com saída no período (ver o topo do arquivo). */
export async function sincronizarLimpezas(db: Db, organizacaoId: string, periodo: Periodo, autorId: string | null = null): Promise<{ criadas: number; atualizadas: number; canceladas: number }> {
  const r = { criadas: 0, atualizadas: 0, canceladas: 0 };
  if (!dataValida(periodo.inicio) || !dataValida(periodo.fim)) return r;
  // Reservas com saída no período, mais as que já têm limpeza no período (a saída pode ter mudado).
  const comLimpeza = db
    .select({ id: limpezas.reservaId })
    .from(limpezas)
    .where(and(eq(limpezas.organizacaoId, organizacaoId), gte(limpezas.data, periodo.inicio), lt(limpezas.data, periodo.fim), isNotNull(limpezas.reservaId)));
  const lista = await db
    .select({ id: reservas.id, imovelId: reservas.imovelId, checkout: reservas.checkout, estado: reservas.estado, codigo: reservas.codigo })
    .from(reservas)
    .where(
      and(
        eq(reservas.organizacaoId, organizacaoId),
        or(and(gte(reservas.checkout, periodo.inicio), lt(reservas.checkout, periodo.fim)), inArray(reservas.id, comLimpeza)),
      ),
    );
  if (!lista.length) return r;
  const existentes = await db
    .select()
    .from(limpezas)
    .where(and(eq(limpezas.organizacaoId, organizacaoId), inArray(limpezas.reservaId, lista.map((x) => x.id))));
  const porReserva = new Map(existentes.map((l) => [l.reservaId, l]));

  for (const res of lista) {
    const l = porReserva.get(res.id);
    const aberta = l && (l.estado === "pedida" || l.estado === "confirmada");
    if (res.estado === "confirmada") {
      if (!l) {
        const [nova] = await db
          .insert(limpezas)
          .values({ organizacaoId, imovelId: res.imovelId, reservaId: res.id, data: res.checkout })
          .onConflictDoNothing()
          .returning();
        if (nova) {
          r.criadas++;
          await registrarAuditoria(db, { organizacaoId, usuarioId: autorId, acao: "limpeza.criar", entidade: "limpeza", entidadeId: nova.id, mudancas: { limpeza: [null, `saída da reserva ${res.codigo} em ${res.checkout}`] } });
        }
      } else if ((l.estado === "cancelada" && !l.canceladaManual) || (aberta && (l.data !== res.checkout || l.imovelId !== res.imovelId))) {
        // Reserva reativada ou com saída/imóvel mudados: volta a "pedida" (a confirmação era para outra data).
        // Cancelada à mão fica cancelada: só a cancelada pela reserva volta.
        const novo = { data: res.checkout, imovelId: res.imovelId, estado: "pedida" as const, confirmadaEm: null };
        const [depois] = await db
          .update(limpezas)
          .set({ ...novo, atualizadoEm: new Date() })
          .where(and(eq(limpezas.id, l.id), inArray(limpezas.estado, ["pedida", "confirmada", "cancelada"]), eq(limpezas.canceladaManual, false)))
          .returning();
        if (depois) {
          r.atualizadas++;
          await registrarAuditoria(db, { organizacaoId, usuarioId: autorId, acao: "limpeza.reserva_mudou", entidade: "limpeza", entidadeId: l.id, mudancas: calcularMudancas(l, depois) });
        }
      }
    } else if (res.estado === "cancelada" && aberta) {
      const [depois] = await db
        .update(limpezas)
        .set({ estado: "cancelada", atualizadoEm: new Date() })
        .where(and(eq(limpezas.id, l!.id), inArray(limpezas.estado, ["pedida", "confirmada"])))
        .returning();
      if (depois) {
        r.canceladas++;
        await registrarAuditoria(db, { organizacaoId, usuarioId: autorId, acao: "limpeza.cancelar", entidade: "limpeza", entidadeId: l!.id, mudancas: { estado: [l!.estado, "cancelada (reserva cancelada)"] } });
      }
    }
  }
  return r;
}

export type LinhaLimpeza = Limpeza & {
  imovelCodigo: string;
  reservaCodigo: string | null;
  profissional: string | null;
  avisos: string[];
};

const dataBr = (d: string) => d.split("-").reverse().join("/");

/** Limpezas do período (por data), com avisos para conferência — nunca preenchidos por suposição. */
export async function listarLimpezas(db: Db, organizacaoId: string, f: Periodo & { imovelIds?: string[]; hoje: string }): Promise<LinhaLimpeza[]> {
  const c = [eq(limpezas.organizacaoId, organizacaoId), gte(limpezas.data, f.inicio), lt(limpezas.data, f.fim)];
  if (f.imovelIds) {
    const ids = f.imovelIds.filter(uuidValido);
    if (!ids.length) return [];
    c.push(inArray(limpezas.imovelId, ids));
  }
  const linhas = await db
    .select({
      l: limpezas,
      imovelCodigo: imoveis.codigo,
      reservaCodigo: reservas.codigo,
      reservaEstado: reservas.estado,
      reservaCheckout: reservas.checkout,
      reservaImovelId: reservas.imovelId,
      profissional: profissionaisLimpeza.nome,
    })
    .from(limpezas)
    .innerJoin(imoveis, eq(imoveis.id, limpezas.imovelId))
    .leftJoin(reservas, eq(reservas.id, limpezas.reservaId))
    .leftJoin(profissionaisLimpeza, eq(profissionaisLimpeza.id, limpezas.profissionalId))
    .where(and(...c))
    .orderBy(asc(limpezas.data), asc(imoveis.codigo));
  return linhas.map((x) => {
    const avisos: string[] = [];
    const l = x.l;
    if (l.estado === "realizada" && x.reservaEstado === "cancelada") avisos.push("A reserva foi cancelada depois da limpeza realizada: confira.");
    if (l.estado === "realizada" && x.reservaCheckout && x.reservaCheckout !== l.data) avisos.push(`A saída da reserva mudou para ${dataBr(x.reservaCheckout)} depois da limpeza: confira.`);
    if (l.estado === "realizada" && x.reservaImovelId && x.reservaImovelId !== l.imovelId) avisos.push("A reserva mudou de imóvel depois da limpeza realizada: confira.");
    if (l.estado === "cancelada" && l.canceladaManual && x.reservaEstado === "confirmada" && x.reservaCheckout && x.reservaCheckout >= f.hoje)
      avisos.push("Cancelada à mão, mas a reserva continua confirmada: confira se a saída não precisa de limpeza.");
    if ((l.estado === "pedida" || l.estado === "confirmada") && l.data < f.hoje) avisos.push("A data já passou e a limpeza não foi registrada como realizada.");
    if (l.estado === "realizada" && l.custo === null) avisos.push("Custo não informado.");
    return { ...l, imovelCodigo: x.imovelCodigo, reservaCodigo: x.reservaCodigo, profissional: x.profissional, avisos };
  });
}

async function travar(tx: Db, organizacaoId: string, id: string): Promise<Limpeza | null> {
  if (!uuidValido(id)) return null;
  const [l] = await tx
    .select()
    .from(limpezas)
    .where(and(eq(limpezas.id, id), eq(limpezas.organizacaoId, organizacaoId)))
    .for("update");
  return l ?? null;
}

async function profissionalAtivo(tx: Db, organizacaoId: string, id: string): Promise<boolean> {
  if (!uuidValido(id)) return false;
  const [p] = await tx
    .select({ id: profissionaisLimpeza.id })
    .from(profissionaisLimpeza)
    .where(and(eq(profissionaisLimpeza.id, id), eq(profissionaisLimpeza.organizacaoId, organizacaoId), eq(profissionaisLimpeza.ativo, true)));
  return Boolean(p);
}

/** Muda o estado com trava e histórico. `de` lista os estados de onde a mudança é permitida. */
async function transicao(
  db: Db,
  organizacaoId: string,
  id: string,
  de: readonly EstadoLimpeza[],
  mudar: (l: Limpeza, tx: Db) => Promise<Partial<Limpeza> | string>,
  acao: string,
  autorId: string | null,
): Promise<Resultado> {
  return db.transaction(async (tx) => {
    const l = await travar(tx, organizacaoId, id);
    if (!l) return { ok: false as const, erro: "Limpeza não encontrada." };
    if (!de.includes(l.estado)) return { ok: false as const, erro: `Não dá a partir de "${NOMES_ESTADO[l.estado]}".` };
    const novo = await mudar(l, tx);
    if (typeof novo === "string") return { ok: false as const, erro: novo };
    const [depois] = await tx
      .update(limpezas)
      .set({ ...novo, atualizadoEm: new Date() })
      .where(eq(limpezas.id, id))
      .returning();
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao, entidade: "limpeza", entidadeId: id, mudancas: calcularMudancas(l, depois) });
    return { ok: true as const };
  });
}

/** Confirma com a profissional (também serve para trocar a profissional de uma já confirmada). */
export function confirmarLimpeza(db: Db, organizacaoId: string, id: string, profissionalId: string, autorId: string | null): Promise<Resultado> {
  return transicao(
    db,
    organizacaoId,
    id,
    ["pedida", "confirmada"],
    async (_l, tx) => ((await profissionalAtivo(tx, organizacaoId, profissionalId)) ? { estado: "confirmada", profissionalId, confirmadaEm: new Date() } : "Escolha uma profissional ativa."),
    "limpeza.confirmar",
    autorId,
  );
}

/** Custo em centavos ou null (não informado). Recusa negativo e valor absurdo. */
export function validarCusto(custo: number | null): string | null {
  if (custo === null) return null;
  if (!Number.isSafeInteger(custo) || custo < 0 || custo > CUSTO_MAXIMO) return "Custo inválido.";
  return null;
}

/** Registra que a limpeza foi feita (quem fez é obrigatório; o custo pode ficar para depois). */
export function realizarLimpeza(
  db: Db,
  organizacaoId: string,
  id: string,
  d: { profissionalId: string; custo: number | null; observacao?: string },
  hoje: string,
  autorId: string | null,
): Promise<Resultado> {
  const erroCusto = validarCusto(d.custo);
  if (erroCusto) return Promise.resolve({ ok: false, erro: erroCusto });
  return transicao(
    db,
    organizacaoId,
    id,
    ["pedida", "confirmada"],
    async (l, tx) => {
      if (l.data > hoje) return "A limpeza ainda não chegou: só dá para registrar como realizada a partir do dia dela.";
      if (!(await profissionalAtivo(tx, organizacaoId, d.profissionalId))) return "Diga quem fez a limpeza.";
      // Sem custo no formulário, mantém o que já estava (ex.: reaberta e realizada de novo).
      return { estado: "realizada", profissionalId: d.profissionalId, custo: d.custo ?? l.custo, observacao: (d.observacao ?? l.observacao).trim().slice(0, 500), realizadaEm: new Date() };
    },
    "limpeza.realizar",
    autorId,
  );
}

/** Corrige o custo de uma limpeza realizada. */
export function informarCusto(db: Db, organizacaoId: string, id: string, custo: number | null, autorId: string | null): Promise<Resultado> {
  const erroCusto = validarCusto(custo);
  if (erroCusto) return Promise.resolve({ ok: false, erro: erroCusto });
  return transicao(db, organizacaoId, id, ["realizada"], async () => ({ custo }), "limpeza.custo", autorId);
}

/** Desfaz um "realizada" marcado por engano: volta a confirmada (ou pedida, sem profissional). */
export function reabrirLimpeza(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<Resultado> {
  return transicao(db, organizacaoId, id, ["realizada"], async (l) => ({ estado: l.profissionalId ? "confirmada" : "pedida", realizadaEm: null }), "limpeza.reabrir", autorId);
}

export function cancelarLimpeza(db: Db, organizacaoId: string, id: string, motivo: string, autorId: string | null): Promise<Resultado> {
  const m = motivo.trim();
  if (!m) return Promise.resolve({ ok: false, erro: "Informe o motivo." });
  return transicao(db, organizacaoId, id, ["pedida", "confirmada"], async (l) => ({ estado: "cancelada", canceladaManual: true, observacao: `${l.observacao ? `${l.observacao} · ` : ""}Cancelada: ${m}`.slice(0, 500) }), "limpeza.cancelar", autorId);
}

/** Limpeza fora de checkout (ex.: faxina extra, antes de uso do proprietário). */
export async function criarLimpezaAvulsa(db: Db, organizacaoId: string, d: { imovelId: string; data: string; observacao: string }, autorId: string | null): Promise<Resultado> {
  if (!uuidValido(d.imovelId)) return { ok: false, erro: "Escolha o imóvel." };
  if (!dataValida(d.data)) return { ok: false, erro: "Data inválida." };
  const [im] = await db
    .select({ id: imoveis.id })
    .from(imoveis)
    .where(and(eq(imoveis.id, d.imovelId), eq(imoveis.organizacaoId, organizacaoId)));
  if (!im) return { ok: false, erro: "Imóvel não encontrado." };
  const [l] = await db
    .insert(limpezas)
    .values({ organizacaoId, imovelId: d.imovelId, data: d.data, observacao: d.observacao.trim().slice(0, 500) })
    .returning();
  await registrarAuditoria(db, { organizacaoId, usuarioId: autorId, acao: "limpeza.criar", entidade: "limpeza", entidadeId: l.id, mudancas: { limpeza: [null, `avulsa em ${d.data}`] } });
  return { ok: true };
}

// ——— Profissionais ———

export async function listarProfissionais(db: Db, organizacaoId: string, f: { incluirArquivados?: boolean } = {}): Promise<Profissional[]> {
  const c = [eq(profissionaisLimpeza.organizacaoId, organizacaoId)];
  if (!f.incluirArquivados) c.push(eq(profissionaisLimpeza.ativo, true));
  return db
    .select()
    .from(profissionaisLimpeza)
    .where(and(...c))
    .orderBy(asc(profissionaisLimpeza.nome));
}

export type DadosProfissional = { nome: string; telefone: string; observacoes: string };

function validarProfissional(d: DadosProfissional): string | null {
  if (!d.nome.trim() || d.nome.trim().length > 120) return "Informe o nome (até 120 caracteres).";
  if (d.telefone.length > 40 || d.observacoes.length > 500) return "Telefone ou observações longos demais.";
  return null;
}

const nomeRepetido = (e: unknown) => e instanceof Error && /profissionais_limpeza_nome|duplicate key/.test(`${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);

export async function criarProfissional(db: Db, organizacaoId: string, d: DadosProfissional, autorId: string | null): Promise<Resultado> {
  const erro = validarProfissional(d);
  if (erro) return { ok: false, erro };
  try {
    const [p] = await db
      .insert(profissionaisLimpeza)
      .values({ organizacaoId, nome: d.nome.trim(), telefone: d.telefone.trim(), observacoes: d.observacoes.trim() })
      .returning();
    await registrarAuditoria(db, { organizacaoId, usuarioId: autorId, acao: "profissional_limpeza.criar", entidade: "profissional_limpeza", entidadeId: p.id, mudancas: { nome: [null, p.nome] } });
    return { ok: true };
  } catch (e) {
    if (nomeRepetido(e)) return { ok: false, erro: "Já existe uma profissional com esse nome." };
    throw e;
  }
}

export async function editarProfissional(db: Db, organizacaoId: string, id: string, d: DadosProfissional & { ativo: boolean }, autorId: string | null): Promise<Resultado> {
  const erro = validarProfissional(d);
  if (erro) return { ok: false, erro };
  if (!uuidValido(id)) return { ok: false, erro: "Profissional não encontrada." };
  try {
    return await db.transaction(async (tx) => {
      const [antes] = await tx
        .select()
        .from(profissionaisLimpeza)
        .where(and(eq(profissionaisLimpeza.id, id), eq(profissionaisLimpeza.organizacaoId, organizacaoId)))
        .for("update");
      if (!antes) return { ok: false as const, erro: "Profissional não encontrada." };
      const [depois] = await tx
        .update(profissionaisLimpeza)
        .set({ nome: d.nome.trim(), telefone: d.telefone.trim(), observacoes: d.observacoes.trim(), ativo: d.ativo })
        .where(eq(profissionaisLimpeza.id, id))
        .returning();
      const mudancas = calcularMudancas(antes, depois);
      if (Object.keys(mudancas).length)
        await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "profissional_limpeza.editar", entidade: "profissional_limpeza", entidadeId: id, mudancas });
      return { ok: true as const };
    });
  } catch (e) {
    if (nomeRepetido(e)) return { ok: false, erro: "Já existe uma profissional com esse nome." };
    throw e;
  }
}
