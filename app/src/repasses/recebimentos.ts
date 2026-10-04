/**
 * Recebimento de uma reserva registrado à mão (M4.10): o dinheiro que a empresa recebeu do canal
 * (Booking, direta, site enquanto o M8.2 não existe). É um lançamento "recebimento" no livro, com
 * `montante` = valor recebido, sem efeito no resultado nem no acerto (a receita e a parte do
 * proprietário já estão lançadas pelo motor). Serve a uma regra só: a parte do proprietário de uma
 * reserva fica **disponível** para repasse quando o recebido alcança o líquido do canal da reserva.
 * O M4.4 (conciliação do extrato) e o M8.2 (liberação do provedor) alimentam a mesma condição.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lancamentos, repasseItens, repasses, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { estornar, lancar, type Lancamento } from "@/financeiro/ledger";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { dataValida } from "@/reservas/regras";

export type Resultado = { ok: true; id: string } | { ok: false; erro: string };

const dataBr = (d: string) => d.split("-").reverse().join("/");

/** Lançamento em vigor: não é estorno e não foi estornado. */
const emVigor = () => and(isNull(lancamentos.estornoDe), sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`);

export async function registrarRecebimento(
  db: Db,
  organizacaoId: string,
  d: { reservaId: string; data: string; valor: number; nota: string },
  autorId: string | null,
  hoje: string,
): Promise<Resultado> {
  if (!uuidValido(d.reservaId)) return { ok: false, erro: "Reserva não encontrada." };
  if (!dataValida(d.data)) return { ok: false, erro: "Data do recebimento inválida." };
  if (d.data > hoje) return { ok: false, erro: "A data do recebimento não pode ser no futuro." };
  if (!Number.isSafeInteger(d.valor) || d.valor <= 0) return { ok: false, erro: "Informe o valor recebido (maior que zero)." };
  const nota = d.nota.trim().slice(0, 200);
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ id: reservas.id, codigo: reservas.codigo, imovelId: reservas.imovelId, estado: reservas.estado })
      .from(reservas)
      .where(and(eq(reservas.id, d.reservaId), eq(reservas.organizacaoId, organizacaoId)));
    if (!r) return { ok: false as const, erro: "Reserva não encontrada." };
    if (r.estado === "cancelada") return { ok: false as const, erro: "Reserva cancelada: registre um ajuste em vez de recebimento." };
    const [l] = await lancar(
      tx,
      organizacaoId,
      [
        {
          tipo: "recebimento",
          descricao: `Reserva ${r.codigo} — recebimento de ${formatBRL(d.valor)} em ${dataBr(d.data)}${nota ? ` (${nota})` : ""}`,
          valor: 0,
          montante: d.valor,
          competencia: d.data,
          dataCaixa: d.data,
          estado: "realizado",
          imovelId: r.imovelId,
          reservaId: r.id,
          origem: "manual",
          comprovante: nota,
        },
      ],
      autorId,
    );
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "recebimento.registrar", entidade: "reserva", entidadeId: r.id, mudancas: { recebimento: [null, `${d.valor} em ${d.data}`] } });
    return { ok: true as const, id: l.id };
  });
}

/** Estorna um recebimento registrado por engano (o lançamento fica no histórico, anulado). */
export async function estornarRecebimento(db: Db, organizacaoId: string, lancamentoId: string, motivo: string, autorId: string | null): Promise<Resultado> {
  const m = motivo.trim();
  if (!m) return { ok: false, erro: "Informe o motivo do estorno." };
  if (!uuidValido(lancamentoId)) return { ok: false, erro: "Recebimento não encontrado." };
  return db.transaction(async (tx) => {
    const [l] = await tx
      .select()
      .from(lancamentos)
      .where(and(eq(lancamentos.id, lancamentoId), eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.tipo, "recebimento"), emVigor()))
      .for("update");
    if (!l) return { ok: false as const, erro: "Recebimento não encontrado ou já estornado." };
    // Mesma trava do motor e do repasse: enquanto esta transação confere o repasse, nenhum antecipado ou
    // fechamento lê o recebimento e vincula a parte (3ª rodada do Codex).
    if (l.reservaId) await travarMotorDaReserva(tx, organizacaoId, l.reservaId);
    // A parte desta reserva já está num repasse a pagar? O dinheiro "com a empresa" sustenta esse repasse:
    // primeiro se estorna o repasse, depois o recebimento (2ª rodada do Codex). Repasse já pago não trava:
    // o dinheiro já saiu e a correção é um ajuste manual.
    const [preso] = l.reservaId
      ? await tx
          .select({ data: repasses.data, tipo: repasses.tipo })
          .from(repasseItens)
          .innerJoin(repasses, eq(repasses.id, repasseItens.repasseId))
          .where(and(eq(repasseItens.organizacaoId, organizacaoId), eq(repasseItens.reservaId, l.reservaId), isNull(repasseItens.liberadoEm), isNull(repasses.estornadoEm), isNull(repasses.dataPagamento)))
          .limit(1)
      : [];
    if (preso) return { ok: false as const, erro: `A parte desta reserva já compõe o repasse ${preso.tipo === "antecipado" ? "antecipado" : "do fechamento"} de ${preso.data.split("-").reverse().join("/")}, ainda não pago: estorne o repasse antes de estornar o recebimento.` };
    await estornar(tx, organizacaoId, l.id, `Recebimento estornado: ${m}`, autorId);
    return { ok: true as const, id: l.id };
  });
}

/** Recebimentos em vigor de uma reserva, do mais antigo ao mais novo. */
export async function recebimentosDaReserva(db: Db, organizacaoId: string, reservaId: string): Promise<Lancamento[]> {
  if (!uuidValido(reservaId)) return [];
  return db
    .select()
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.reservaId, reservaId), eq(lancamentos.tipo, "recebimento"), emVigor()))
    .orderBy(lancamentos.dataCaixa, lancamentos.criadoEm);
}

export type RecebidoDaReserva = {
  /** Soma dos recebimentos realizados/conciliados em vigor. */
  recebido: number;
  /** Líquido do canal (valor bruto − taxa do canal) pelos lançamentos do motor em vigor. */
  devido: number;
};

/**
 * Quanto a empresa já recebeu de cada reserva e quanto era de receber (líquido do canal). Base da
 * condição "o dinheiro está com a empresa": recebido ≥ devido (e devido > 0).
 */
export async function recebidoPorReserva(db: Db, organizacaoId: string, reservaIds: readonly string[]): Promise<Map<string, RecebidoDaReserva>> {
  const ids = [...new Set(reservaIds.filter(uuidValido))];
  const mapa = new Map<string, RecebidoDaReserva>(ids.map((id) => [id, { recebido: 0, devido: 0 }]));
  if (!ids.length) return mapa;
  const linhas = await db
    .select({ reservaId: lancamentos.reservaId, tipo: lancamentos.tipo, estado: lancamentos.estado, valor: lancamentos.valor, montante: lancamentos.montante })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        inArray(lancamentos.reservaId, ids),
        inArray(lancamentos.tipo, ["recebimento", "receita_bruta", "taxa_canal"]),
        emVigor(),
      ),
    );
  for (const l of linhas) {
    const r = mapa.get(l.reservaId!)!;
    if (l.tipo === "recebimento") {
      if (l.estado === "realizado" || l.estado === "conciliado") r.recebido += l.montante ?? 0;
    } else r.devido += l.valor;
  }
  return mapa;
}

export const dinheiroComAEmpresa = (r: RecebidoDaReserva) => r.devido > 0 && r.recebido >= r.devido;
