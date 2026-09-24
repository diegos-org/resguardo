import { createHash } from "node:crypto";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { listarContratos } from "@/contratos/repositorio";
import { lancamentos, proprietarioImoveis, recebimentoPorCanal, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { estornar, lancar, type NovoLancamento } from "./ledger";
import { calcularReserva, REGRAS_PADRAO, type RegrasMotor } from "./motor";

/** Tudo o que define o lançamento desejado: se qualquer coisa mudar, ele é refeito. */
const assinatura = (l: NovoLancamento) =>
  createHash("sha1")
    .update(JSON.stringify([l.valor, l.efeitoSaldo ?? 0, l.proprietarioId ?? null, l.imovelId ?? null, l.competencia, l.estado ?? "previsto"]))
    .digest("hex")
    .slice(0, 10);

/** Chave gravada = base ou base#N (N-ésima vez que o mesmo cálculo volta a valer). */
const baseDaChave = (chave: string) => chave.replace(/#\d+$/, "");

export type ResultadoAplicacao = { criados: number; estornados: number; mantidos: number; avisos: string[] };

/**
 * Deixa os lançamentos da reserva iguais ao que o motor calcula agora:
 * mantém os que continuam certos, estorna os que mudaram/sumiram e cria os novos.
 * Seguro para rodar quantas vezes quiser (idempotente) e tudo-ou-nada.
 */
export async function aplicarMotor(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  autorId: string | null,
  regras: RegrasMotor = REGRAS_PADRAO,
): Promise<ResultadoAplicacao | null> {
  if (!uuidValido(reservaId)) return null;
  return db.transaction(async (tx) => {
    // Uma aplicação por reserva de cada vez.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`motor:${organizacaoId}:${reservaId}`}))`);
    const [r] = await tx
      .select()
      .from(reservas)
      .where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)));
    if (!r) return null;

    const contratos = await listarContratos(tx, organizacaoId, r.imovelId);
    const donos = await tx
      .select({ id: proprietarioImoveis.proprietarioId })
      .from(proprietarioImoveis)
      .where(eq(proprietarioImoveis.imovelId, r.imovelId))
      .orderBy(asc(proprietarioImoveis.proprietarioId));
    const config = await tx
      .select({ origem: recebimentoPorCanal.origem, recebimento: recebimentoPorCanal.recebimento })
      .from(recebimentoPorCanal)
      .where(and(eq(recebimentoPorCanal.imovelId, r.imovelId), eq(recebimentoPorCanal.organizacaoId, organizacaoId)));
    const recebimentoDoImovel = Object.fromEntries(config.map((c) => [c.origem, c.recebimento]));
    const { lancamentos: calculados, avisos } = calcularReserva(r, contratos, donos.map((d) => d.id), regras, recebimentoDoImovel);
    const desejados = calculados.map((l) => ({ ...l, chaveOrigem: `${l.chaveOrigem}:${assinatura(l)}` }));

    const doMotor = await tx
      .select({ id: lancamentos.id, chave: lancamentos.chaveOrigem })
      .from(lancamentos)
      .where(and(eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.reservaId, reservaId), eq(lancamentos.origem, "motor")));
    const ativos = await tx
      .select({ id: lancamentos.id, chave: lancamentos.chaveOrigem, estado: lancamentos.estado })
      .from(lancamentos)
      .where(
        and(
          eq(lancamentos.organizacaoId, organizacaoId),
          eq(lancamentos.reservaId, reservaId),
          eq(lancamentos.origem, "motor"),
          isNull(lancamentos.estornoDe),
          sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
        ),
      )
      // Trava os lançamentos enquanto decide: uma baixa ("realizado") feita ao mesmo tempo
      // espera este cálculo terminar, ou já aparece aqui como realizada — nunca é estornada
      // por engano depois da checagem.
      .for("update");
    const desejadas = new Set(desejados.map((l) => l.chaveOrigem));

    // O que já movimentou dinheiro (realizado/conciliado) nunca é mexido automaticamente
    // (Diego, 24/09): se o cálculo novo divergir, a reserva fica como está e avisa — a
    // correção vira um ajuste manual (M4.5).
    const precisaMudar =
      ativos.some((a) => !a.chave || !desejadas.has(baseDaChave(a.chave))) ||
      desejados.some((l) => !ativos.some((a) => a.chave && baseDaChave(a.chave) === l.chaveOrigem));
    if (precisaMudar && ativos.some((a) => a.estado === "realizado" || a.estado === "conciliado")) {
      return {
        criados: 0,
        estornados: 0,
        mantidos: ativos.length,
        avisos: [...avisos, "Esta reserva já teve dinheiro movimentado: o cálculo novo não foi aplicado. Se precisar, faça um ajuste manual."],
      };
    }

    // Mantém um ativo por cálculo desejado; estorna o resto.
    const mantidas = new Set<string>();
    let estornados = 0;
    for (const a of ativos) {
      const base = a.chave ? baseDaChave(a.chave) : "";
      if (desejadas.has(base) && !mantidas.has(base)) {
        mantidas.add(base);
        continue;
      }
      await estornar(tx, organizacaoId, a.id, "Recalculado pelo motor (reserva ou contrato mudou)", autorId);
      estornados++;
    }

    // Cálculo que já valeu, foi estornado e volta a valer ganha chave nova (base#2, #3…),
    // senão a idempotência do livro devolveria o lançamento antigo, já estornado.
    const usadas = new Set(doMotor.map((l) => l.chave).filter((c): c is string => Boolean(c)));
    const novos = desejados
      .filter((l) => !mantidas.has(l.chaveOrigem))
      .map((l) => {
        let chave = l.chaveOrigem;
        for (let n = 2; usadas.has(chave); n++) chave = `${l.chaveOrigem}#${n}`;
        usadas.add(chave);
        return { ...l, chaveOrigem: chave };
      });
    if (novos.length) await lancar(tx, organizacaoId, novos, autorId);
    return { criados: novos.length, estornados, mantidos: mantidas.size, avisos };
  });
}

export type ResultadoRecalculo = { reservas: number; criados: number; estornados: number };

/**
 * Passa o motor de novo nas reservas para que uma regra alterada — padrão de recebimento,
 * contrato, configuração do imóvel — valha **daquela data para frente** (Diego, 24/09): só
 * reservas com entrada a partir de `aPartirDe` (padrão: hoje). O passado não é recalculado,
 * e o que já movimentou dinheiro fica protegido em `aplicarMotor`. Idempotente.
 */
export async function recalcularReservas(
  db: Db,
  organizacaoId: string,
  f: { imovelId?: string; aPartirDe?: string } = {},
  autorId: string | null = null,
  regras: RegrasMotor = REGRAS_PADRAO,
): Promise<ResultadoRecalculo> {
  if (f.imovelId && !uuidValido(f.imovelId)) return { reservas: 0, criados: 0, estornados: 0 };
  // Nunca antes de hoje: mesmo uma regra com data no passado só vale daqui para frente.
  const hoje = hojeISO();
  const aPartirDe = f.aPartirDe && f.aPartirDe > hoje ? f.aPartirDe : hoje;
  const ids = await db
    .select({ id: reservas.id })
    .from(reservas)
    .where(
      and(
        eq(reservas.organizacaoId, organizacaoId),
        f.imovelId ? eq(reservas.imovelId, f.imovelId) : undefined,
        gte(reservas.checkin, aPartirDe),
      ),
    )
    .orderBy(asc(reservas.checkin), asc(reservas.id));
  const total: ResultadoRecalculo = { reservas: ids.length, criados: 0, estornados: 0 };
  for (const { id } of ids) {
    const r = await aplicarMotor(db, organizacaoId, id, autorId, regras);
    total.criados += r?.criados ?? 0;
    total.estornados += r?.estornados ?? 0;
  }
  return total;
}
