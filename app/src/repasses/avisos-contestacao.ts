/**
 * Avisos do Início sobre a disputa do pagamento nos repasses (M8.2e; financeiro, da empresa toda). Ficam à parte de
 * `avisosDeDescontos` (`descontos.ts`), que continua só para o desconto de cancelamento:
 * - o repasse a pagar que leva parte de reserva com disputa do pagamento em curso: "estorne o repasse antes de pagar, se
 *   quiser segurar a parte dela" (o mesmo texto do cartão do repasse e do "Marcar como pago"; nada é bloqueado);
 * - o valor segurado pela disputa já disponível e ainda não descontado há mais de `DIAS_AVISO_DEBITO_CONTESTACAO` dias: as
 *   partes disponíveis não cobriram. A linha que espera junto com a parte da reserva não é aviso (`classificarParte`).
 * Os outros avisos da disputa (decisão, documentos, resultado, escalada) são do domínio do pagamento.
 */
import { and, asc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { lancamentos, proprietarios, repasseItens, repasses, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { DIAS_AVISO_DEBITO_CONTESTACAO, ORIGEM_LANCAMENTO_CONTESTACAO, textoRepasseComDisputa } from "@/pagamentos/contestacao-regras";
import { lancamentoEmVigor } from "@/portal/posse";
import { partesDoProprietario } from "./extrato";
import { disputasEmCursoDasReservas } from "./repasses";

export type AvisoDoInicio = { nivel: "atencao" | "info"; texto: string; link: string };

const LINK = "/painel/financeiro/repasses";
const dataBr = (d: string) => d.split("-").reverse().join("/");

export async function avisosDeContestacaoNosRepasses(db: Db, organizacaoId: string, agora: Date): Promise<AvisoDoInicio[]> {
  return [...(await repassesAPagarComDisputa(db, organizacaoId)), ...(await seguradosNaoDescontados(db, organizacaoId, agora))];
}

/** Um aviso por reserva com disputa em curso cuja parte (não a linha da disputa) está num repasse em vigor ainda a pagar. */
async function repassesAPagarComDisputa(db: Db, organizacaoId: string): Promise<AvisoDoInicio[]> {
  const itens = await db
    .selectDistinct({ reservaId: repasseItens.reservaId, codigo: reservas.codigo })
    .from(repasseItens)
    .innerJoin(repasses, eq(repasses.id, repasseItens.repasseId))
    .innerJoin(reservas, eq(reservas.id, repasseItens.reservaId))
    .innerJoin(lancamentos, eq(lancamentos.id, repasseItens.lancamentoId))
    .where(
      and(
        eq(repasseItens.organizacaoId, organizacaoId),
        isNull(repasseItens.liberadoEm),
        isNull(repasses.estornadoEm),
        eq(repasses.situacao, "a_pagar"),
        ne(lancamentos.origem, ORIGEM_LANCAMENTO_CONTESTACAO),
      ),
    );
  if (!itens.length) return [];
  const emCurso = await disputasEmCursoDasReservas(db, organizacaoId, itens.map((i) => i.reservaId));
  return itens
    .filter((i) => emCurso.has(i.reservaId))
    .sort((a, b) => emCurso.get(a.reservaId)!.getTime() - emCurso.get(b.reservaId)!.getTime() || a.codigo.localeCompare(b.codigo))
    .map((i) => ({ nivel: "atencao" as const, texto: textoRepasseComDisputa(i.codigo, emCurso.get(i.reservaId)!), link: LINK }));
}

/**
 * Um aviso por proprietário com valor segurado pela disputa (débito, origem "contestacao_pagamento") lançado há mais de
 * `DIAS_AVISO_DEBITO_CONTESTACAO` dias, disponível e ainda fora de repasse — líquido das linhas da disputa disponíveis das
 * mesmas reservas (a reversão de uma disputa ganha que entra junto não deixa nada a descontar).
 */
async function seguradosNaoDescontados(db: Db, organizacaoId: string, agora: Date): Promise<AvisoDoInicio[]> {
  const limite = new Date(agora.getTime() - DIAS_AVISO_DEBITO_CONTESTACAO * 86_400_000);
  const antigos = await db
    .select({ id: lancamentos.id, proprietarioId: lancamentos.proprietarioId, reservaId: lancamentos.reservaId, criadoEm: lancamentos.criadoEm, nome: proprietarios.nome })
    .from(lancamentos)
    .innerJoin(proprietarios, eq(proprietarios.id, lancamentos.proprietarioId))
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.tipo, "direito_proprietario"),
        eq(lancamentos.origem, ORIGEM_LANCAMENTO_CONTESTACAO),
        lt(lancamentos.valor, 0),
        lt(lancamentos.criadoEm, limite),
        lancamentoEmVigor(db),
        sql`not exists (select 1 from ${repasseItens} i join ${repasses} r on r.id = i.repasse_id where i.lancamento_id = ${lancamentos.id} and i.liberado_em is null and r.estornado_em is null)`,
      ),
    )
    .orderBy(asc(proprietarios.nome), asc(lancamentos.criadoEm));
  const porDono = new Map<string, { nome: string; antigos: typeof antigos }>();
  for (const l of antigos) {
    const x = porDono.get(l.proprietarioId!) ?? { nome: l.nome, antigos: [] };
    x.antigos.push(l);
    porDono.set(l.proprietarioId!, x);
  }
  const avisos: AvisoDoInicio[] = [];
  for (const [donoId, x] of porDono) {
    // A classificação é a regra única (`classificarParte`): só conta o que está disponível agora.
    const partes = await partesDoProprietario(db, organizacaoId, donoId, agora, { reservaIds: [...new Set(x.antigos.map((l) => l.reservaId!))] });
    const disponiveis = partes.filter((p) => p.origemLancamento === ORIGEM_LANCAMENTO_CONTESTACAO && p.situacao === "disponivel");
    const antigosDisponiveis = x.antigos.filter((l) => disponiveis.some((p) => p.lancamentoId === l.id));
    const total = -disponiveis.reduce((t, p) => t + p.valor, 0);
    if (!antigosDisponiveis.length || total <= 0) continue;
    const desde = hojeISO("America/Sao_Paulo", antigosDisponiveis[0].criadoEm);
    avisos.push({
      nivel: "atencao",
      texto: `Proprietário ${x.nome} tem ${formatBRL(total)} de valor segurado pela disputa do pagamento a descontar desde ${dataBr(desde)} (as partes disponíveis não cobriram).`,
      link: LINK,
    });
  }
  return avisos;
}
