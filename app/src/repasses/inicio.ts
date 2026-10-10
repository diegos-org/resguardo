/**
 * Lado do início do sistema pela data do pagamento (M4.12). Lembrança de Diego (4/10/2026): o Airbnb paga a reserva
 * inteira no dia seguinte ao check-in, direto ao proprietário — uma reserva de 29/9 a 2/10 foi paga (e acertada por
 * fora) em 30/9, inclusive a noite de outubro. Então **a data em que o canal pagou decide**, não o mês de cada noite:
 * - paga antes do início → a reserva inteira é "de antes" (acertada por fora, em qualquer mês);
 * - paga a partir do início → a reserva inteira entra no sistema (mesmo as noites de antes);
 * - sem data conhecida: inteira antes do início fica de antes; inteira depois fica no sistema; a que atravessa fica
 *   **indefinida** — avisar em vez de supor: a equipe registra o recebimento com a data em que o canal pagou (empresa
 *   recebe) ou define o prazo do canal (canal paga direto), e a data decide.
 * A data vem de duas fontes: quem recebe `split` → check-in + prazo do canal (Configurações → Regras financeiras, por
 * canal; Airbnb: 1 dia; reserva antiga sem prazo na versão da época usa o prazo atual); quem recebe `empresa` → a data do
 * recebimento que completou o líquido do canal (M4.10).
 * A contabilidade por noite (competência) não muda: é só o dinheiro que segue a data do pagamento.
 */
import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, type SQL, sql } from "drizzle-orm";
import { lerVersoesRegras, prazoDoCanalNaData, type VersaoRegras } from "@/configuracoes/regras-financeiras";
import { lancamentos, type OrigemReserva, repasses, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { lancamentoEmVigor } from "@/portal/posse";
import { type RecebidoDaReserva, recebidoPorReserva } from "./recebimentos";

export type QuemRecebeReserva = "empresa" | "split" | "a_confirmar";
/** `canal`: pela regra do canal (check-in + prazo), uma previsão; `recebimento`: a data registrada do dinheiro com a empresa. */
export type PagamentoDaReserva = { data: string; fonte: "canal" | "recebimento"; prazo?: number };
export type LadoDoInicio = "antes" | "depois" | "indefinido";

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export const dataBr = (d: string) => d.split("-").reverse().join("/");

/**
 * Data em que o canal pagou a reserva (pura): split pela regra do canal; empresa pela data do recebimento completo. É um
 * fato do passado: o dinheiro que voltou ao hóspede depois (devolução, M8.2c) tira o dinheiro da empresa, não a data em
 * que ele pagou — por isso vale o recebimento completo (`dataCompleto`, pelos recebimentos brutos), não o saldo líquido.
 */
export function dataDoPagamento(r: { quemRecebe: QuemRecebeReserva; checkin: string; recebido: RecebidoDaReserva }, prazo: number | null): PagamentoDaReserva | null {
  if (r.quemRecebe === "split") return prazo === null ? null : { data: somarDias(r.checkin, prazo), fonte: "canal", prazo };
  if (r.quemRecebe === "empresa") return r.recebido.devido > 0 && r.recebido.dataCompleto ? { data: r.recebido.dataCompleto, fonte: "recebimento" } : null;
  return null;
}

/** De que lado do início a reserva inteira fica (pura). null = sem início definido. */
export function ladoDoInicio(r: { checkin: string; checkout: string; pagamento: PagamentoDaReserva | null }, inicio: string | null): LadoDoInicio | null {
  if (!inicio) return null;
  if (r.pagamento) return r.pagamento.data < inicio ? "antes" : "depois";
  if (r.checkout <= inicio) return "antes";
  if (r.checkin >= inicio) return "depois";
  return "indefinido";
}

export function quemRecebeDe(l: { estado: string; efeitoSaldo: number }): QuemRecebeReserva {
  return l.estado === "pendente" ? "a_confirmar" : l.efeitoSaldo === 0 ? "split" : "empresa";
}

export type ReservaDoInicio = { id: string; codigo: string; origem: OrigemReserva; quemRecebe: QuemRecebeReserva; checkin: string; checkout: string; pagamento: PagamentoDaReserva | null; lado: LadoDoInicio };

/**
 * Reservas com a data do pagamento e o lado do início. `ids` vazio = todas as reservas da organização com parte do
 * proprietário em vigor (`proprietarioId` dado) ou da organização inteira (sem proprietário). Quem recebe vem da parte
 * do proprietário no livro (pendente = a confirmar; efeito zero = o canal paga direto), como no extrato.
 */
export async function reservasDoInicio(db: Db, organizacaoId: string, inicio: string, o: { ids?: readonly string[]; proprietarioId?: string } = {}): Promise<Map<string, ReservaDoInicio>> {
  const ids = o.ids?.filter(uuidValido);
  if (ids && !ids.length) return new Map();
  const linhas = await db
    .select({ id: reservas.id, codigo: reservas.codigo, origem: reservas.origem, checkin: reservas.checkin, checkout: reservas.checkout, estado: lancamentos.estado, efeitoSaldo: lancamentos.efeitoSaldo })
    .from(lancamentos)
    .innerJoin(reservas, eq(reservas.id, lancamentos.reservaId))
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.tipo, "direito_proprietario"),
        isNotNull(lancamentos.proprietarioId),
        o.proprietarioId ? eq(lancamentos.proprietarioId, o.proprietarioId) : undefined,
        ids ? inArray(lancamentos.reservaId, ids) : undefined,
        lancamentoEmVigor(db),
      ),
    );
  const base = new Map<string, Omit<ReservaDoInicio, "pagamento" | "lado">>();
  for (const l of linhas) if (!base.has(l.id)) base.set(l.id, { id: l.id, codigo: l.codigo, origem: l.origem, quemRecebe: quemRecebeDe(l), checkin: l.checkin, checkout: l.checkout });
  if (!base.size) return new Map();
  const recebidos = await recebidoPorReserva(db, organizacaoId, [...base.keys()]);
  const versoes = await lerVersoesRegras(db, organizacaoId);
  const saida = new Map<string, ReservaDoInicio>();
  for (const r of base.values()) {
    const pagamento = pagamentoDe(r, recebidos.get(r.id) ?? { recebido: 0, devido: 0 }, versoes);
    saida.set(r.id, { ...r, pagamento, lado: ladoDoInicio({ ...r, pagamento }, inicio)! });
  }
  return saida;
}

export function pagamentoDe(r: { quemRecebe: QuemRecebeReserva; origem: OrigemReserva; checkin: string }, recebido: RecebidoDaReserva, versoes: readonly VersaoRegras[]): PagamentoDaReserva | null {
  return dataDoPagamento({ quemRecebe: r.quemRecebe, checkin: r.checkin, recebido }, prazoDoCanalNaData(versoes, r.checkin, r.origem));
}

/**
 * O livro "de antes do início": lançamentos de competência anterior ao início, menos os das reservas que entram no
 * sistema (pagas a partir do início) e os das indefinidas; mais os lançamentos, de qualquer mês, das reservas pagas
 * antes do início. É o que a marcação zera, o que trava o fechamento e o que a data de início não pode passar por cima.
 * Dos lançamentos "repasse", só o acerto por fora (e o estorno dele) entra: antecipado e fechamento que pagaram a parte
 * de uma reserva que entra no sistema ficam de fora com ela (o lançamento deles não traz a reserva; vem pelo repasse).
 */
export function livroDeAntes(inicio: string, lados: ReadonlyMap<string, { lado: LadoDoInicio }>): SQL {
  const antes: string[] = [];
  const fora: string[] = [];
  for (const [id, r] of lados) (r.lado === "antes" ? antes : fora).push(id);
  const acertoPorFora = sql`exists (
    select 1 from ${repasses} pf join ${lancamentos} o on o.id = coalesce(${lancamentos.estornoDe}, ${lancamentos.id})
    where pf.tipo = 'por_fora' and pf.organizacao_id = ${lancamentos.organizacaoId} and o.chave_origem like 'repasse:' || pf.id::text || ':%')`;
  const deAntes = and(lt(lancamentos.competencia, inicio), or(ne(lancamentos.tipo, "repasse"), acertoPorFora), fora.length ? or(isNull(lancamentos.reservaId), notInArray(lancamentos.reservaId, fora)) : undefined)!;
  const deDepois = and(gte(lancamentos.competencia, inicio), or(antes.length ? inArray(lancamentos.reservaId, antes) : sql`false`, and(eq(lancamentos.tipo, "repasse"), acertoPorFora)))!;
  return or(deAntes, deDepois)!;
}

/** Texto do bloqueio para reservas indefinidas (atravessam o início sem data de pagamento). */
export function avisoIndefinidas(indefinidas: readonly Pick<ReservaDoInicio, "codigo" | "quemRecebe">[], inicio: string): string | null {
  if (!indefinidas.length) return null;
  const empresa = indefinidas.filter((r) => r.quemRecebe === "empresa");
  const canal = indefinidas.filter((r) => r.quemRecebe === "split");
  const partes = [
    empresa.length ? `${empresa.length} reserva(s) que atravessa(m) o início do sistema (${dataBr(inicio)}) sem data de pagamento (${empresa.map((r) => r.codigo).join(", ")}): registre o recebimento na reserva com a data em que o canal pagou — antes do início, a reserva inteira é acertada por fora; a partir dele, entra inteira no sistema.` : "",
    canal.length ? `${canal.length} reserva(s) que atravessa(m) o início do sistema (${dataBr(inicio)}) de canal que paga direto sem prazo definido (${canal.map((r) => r.codigo).join(", ")}): informe em Configurações → Regras financeiras em quantos dias o canal paga.` : "",
  ].filter(Boolean);
  return partes.join(" ") || null;
}

