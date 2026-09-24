/**
 * Despesas (M4.3), gravadas no livro de lançamentos:
 * - da EMPRESA: custo próprio (equipe, mercado, pequenas manutenções absorvidas). Entra no
 *   resultado da empresa (`valor` negativo) e não mexe no acerto com proprietários.
 * - do PROPRIETÁRIO: gasto de responsabilidade dele (ex.: ar-condicionado do apartamento).
 *   NÃO é custo da empresa (`valor` 0; o valor de face fica em `montante`). Quando a empresa
 *   efetivamente paga, nasce um lançamento de ADIANTAMENTO ligado à despesa, e só então o
 *   proprietário passa a dever (`efeitoSaldo` negativo) até ser compensado/reembolsado
 *   (M4.4). Conta ainda a pagar não vira dívida. Se o próprio proprietário pagou, fica só o
 *   registro.
 * Situação: "a pagar" = previsto; "paga" = realizado, com data de pagamento (caixa).
 */
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { categoriasDespesa, imoveis, lancamentos, proprietarioImoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { estornar, lancar, type Lancamento, mudarEstado } from "@/financeiro/ledger";
import { temQuitacaoAtiva } from "@/adiantamentos/adiantamentos";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";

export const RESPONSAVEIS = ["empresa", "proprietario"] as const;
export type Responsavel = (typeof RESPONSAVEIS)[number];

export type DadosDespesa = {
  responsavel: Responsavel;
  /** Quem tirou o dinheiro do bolso (só importa para despesa do proprietário). */
  pagoPor: Responsavel;
  categoriaId: string;
  descricao: string;
  /** Centavos, positivo. */
  valor: number;
  /** Data da despesa (competência). */
  data: string;
  imovelId: string | null;
  proprietarioId: string | null;
  fornecedor: string;
  comprovante: string;
  /** Já paga? Então `dataPagamento` é obrigatória. */
  paga: boolean;
  dataPagamento: string | null;
};

export type ErrosDespesa = Partial<Record<keyof DadosDespesa | "geral", string>>;

export function validarDespesa(d: DadosDespesa): ErrosDespesa {
  const e: ErrosDespesa = {};
  if (!RESPONSAVEIS.includes(d.responsavel)) e.responsavel = "Escolha de quem é a despesa.";
  if (!RESPONSAVEIS.includes(d.pagoPor)) e.pagoPor = "Escolha quem pagou.";
  if (!uuidValido(d.categoriaId)) e.categoriaId = "Escolha a categoria.";
  if (!d.descricao.trim()) e.descricao = "Descreva a despesa.";
  else if (d.descricao.length > 300) e.descricao = "Descrição com mais de 300 caracteres.";
  if (!Number.isSafeInteger(d.valor) || d.valor <= 0) e.valor = "Valor maior que zero.";
  if (!dataValida(d.data)) e.data = "Data inválida.";
  if (d.imovelId && !uuidValido(d.imovelId)) e.imovelId = "Imóvel inválido.";
  if (d.proprietarioId && !uuidValido(d.proprietarioId)) e.proprietarioId = "Proprietário inválido.";
  if (d.responsavel === "proprietario" && !d.imovelId) e.imovelId = "Despesa do proprietário precisa do imóvel.";
  if (d.fornecedor.length > 200) e.fornecedor = "Até 200 caracteres.";
  if (d.comprovante.length > 500) e.comprovante = "Até 500 caracteres.";
  if (d.paga && (!d.dataPagamento || !dataValida(d.dataPagamento))) e.dataPagamento = "Informe a data do pagamento.";
  return e;
}

export type ResultadoDespesa = { ok: true; lancamento: Lancamento } | { ok: false; erros: ErrosDespesa };

export async function registrarDespesa(db: Db, organizacaoId: string, d: DadosDespesa, autorId: string | null): Promise<ResultadoDespesa> {
  const erros = validarDespesa(d);
  if (Object.keys(erros).length) return { ok: false, erros };
  return db.transaction(async (tx) => {
    const [cat] = await tx
      .select()
      .from(categoriasDespesa)
      .where(and(eq(categoriasDespesa.id, d.categoriaId), eq(categoriasDespesa.organizacaoId, organizacaoId)));
    if (!cat || !cat.ativa) return { ok: false as const, erros: { categoriaId: "Categoria não encontrada ou arquivada." } };
    if (d.imovelId) {
      const [im] = await tx
        .select({ id: imoveis.id })
        .from(imoveis)
        .where(and(eq(imoveis.id, d.imovelId), eq(imoveis.organizacaoId, organizacaoId)));
      if (!im) return { ok: false as const, erros: { imovelId: "Imóvel não encontrado." } };
    }

    let proprietarioId: string | null = null;
    if (d.responsavel === "proprietario") {
      const donos = (await tx.select({ id: proprietarioImoveis.proprietarioId }).from(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, d.imovelId!))).map((x) => x.id);
      if (d.proprietarioId) {
        if (!donos.includes(d.proprietarioId)) return { ok: false as const, erros: { proprietarioId: "Este proprietário não está vinculado ao imóvel." } };
        proprietarioId = d.proprietarioId;
      } else if (donos.length === 1) {
        proprietarioId = donos[0];
      } else {
        return {
          ok: false as const,
          erros: { proprietarioId: donos.length ? "O imóvel tem mais de um proprietário: escolha qual." : "O imóvel não tem proprietário vinculado." },
        };
      }
    }

    const empresa = d.responsavel === "empresa";
    const [lancamento] = await lancar(
      tx,
      organizacaoId,
      [
        {
          tipo: empresa ? "despesa_empresa" : "despesa_proprietario",
          descricao: d.descricao,
          valor: empresa ? -d.valor : 0,
          montante: d.valor,
          efeitoSaldo: 0,
          pagoPor: empresa ? null : d.pagoPor,
          competencia: d.data,
          estado: d.paga ? "realizado" : "previsto",
          dataCaixa: d.paga ? d.dataPagamento : null,
          imovelId: d.imovelId,
          proprietarioId,
          categoriaId: cat.id,
          fornecedor: d.fornecedor,
          comprovante: d.comprovante,
          origem: "manual",
        },
      ],
      autorId,
    );
    if (d.paga) await lancarAdiantamento(tx, organizacaoId, lancamento, d.dataPagamento!, autorId);
    return { ok: true as const, lancamento };
  });
}

const chaveAdiantamento = (despesaId: string) => `despesa:${despesaId}:pagamento`;

/** Despesa do proprietário paga pela empresa: registra o adiantamento (idempotente). */
async function lancarAdiantamento(tx: Db, organizacaoId: string, d: Lancamento, dataPagamento: string, autorId: string | null) {
  if (d.tipo !== "despesa_proprietario" || d.pagoPor !== "empresa" || !d.proprietarioId || !d.montante) return;
  await lancar(
    tx,
    organizacaoId,
    [
      {
        tipo: "adiantamento",
        descricao: `Pago pela empresa: ${d.descricao}`,
        valor: 0,
        montante: d.montante,
        efeitoSaldo: -d.montante,
        competencia: d.competencia,
        estado: "realizado",
        dataCaixa: dataPagamento,
        imovelId: d.imovelId,
        proprietarioId: d.proprietarioId,
        categoriaId: d.categoriaId,
        fornecedor: d.fornecedor,
        origem: "despesa",
        chaveOrigem: chaveAdiantamento(d.id),
      },
    ],
    autorId,
  );
}

async function adiantamentoAtivo(tx: Db, organizacaoId: string, despesaId: string): Promise<Lancamento | null> {
  const [a] = await tx
    .select()
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.chaveOrigem, chaveAdiantamento(despesaId)),
        sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
      ),
    );
  return a ?? null;
}

/** Marca a despesa como paga; se era do proprietário e a empresa pagou, nasce a dívida dele. */
export async function marcarDespesaPaga(db: Db, organizacaoId: string, id: string, dataPagamento: string, autorId: string | null): Promise<boolean> {
  if (!dataValida(dataPagamento)) return false;
  return db.transaction(async (tx) => {
    const d = await obterDespesa(tx, organizacaoId, id);
    if (!d || d.estornada) return false;
    const pago = await mudarEstado(tx, organizacaoId, id, "realizado", autorId, dataPagamento);
    if (!pago) return false;
    await lancarAdiantamento(tx, organizacaoId, pago, dataPagamento, autorId);
    return true;
  });
}

/**
 * Estorna a despesa e, junto, o adiantamento que ela gerou (se houver). Se o adiantamento já
 * teve quitação (reembolso, compensação…), recusa: desfazer primeiro, senão o proprietário
 * ficaria com crédito indevido. Retorna "quitado" nesse caso.
 */
export async function estornarDespesa(db: Db, organizacaoId: string, id: string, motivo: string, autorId: string | null): Promise<boolean | "quitado"> {
  if (!uuidValido(id)) return false;
  return db.transaction(async (tx) => {
    // Trava a despesa primeiro: um "marcar como paga" ao mesmo tempo (que também trava esta
    // linha e cria o adiantamento) termina antes, e o adiantamento aparece na busca abaixo.
    await tx.select({ id: lancamentos.id }).from(lancamentos).where(and(eq(lancamentos.id, id), eq(lancamentos.organizacaoId, organizacaoId))).for("update");
    const d = await obterDespesa(tx, organizacaoId, id);
    if (!d || d.estornada || !motivo.trim()) return false;
    const a = await adiantamentoAtivo(tx, organizacaoId, id);
    if (a) {
      // Trava o adiantamento: uma quitação ao mesmo tempo espera ou aparece aqui.
      await tx.select({ id: lancamentos.id }).from(lancamentos).where(eq(lancamentos.id, a.id)).for("update");
      if (await temQuitacaoAtiva(tx, organizacaoId, a)) return "quitado" as const;
      await estornar(tx, organizacaoId, a.id, motivo, autorId);
    }
    await estornar(tx, organizacaoId, id, motivo, autorId);
    return true;
  });
}

export type LinhaDespesa = Lancamento & { categoria: string | null; estornada: boolean };

/** Despesas (originais, não os espelhos de estorno), mais recentes primeiro. */
export async function listarDespesas(
  db: Db,
  organizacaoId: string,
  f: { inicio?: string; fim?: string; imovelIds?: string[]; incluirEstornadas?: boolean } = {},
): Promise<LinhaDespesa[]> {
  const c = [
    eq(lancamentos.organizacaoId, organizacaoId),
    inArray(lancamentos.tipo, ["despesa_empresa", "despesa_proprietario"]),
    sql`${lancamentos.estornoDe} is null`,
  ];
  if (f.inicio) c.push(gte(lancamentos.competencia, f.inicio));
  if (f.fim) c.push(lt(lancamentos.competencia, f.fim));
  if (f.imovelIds) c.push(inArray(lancamentos.imovelId, f.imovelIds.filter(uuidValido)));
  const linhas = await db
    .select({
      l: lancamentos,
      categoria: categoriasDespesa.nome,
      estornada: sql<boolean>`exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
    })
    .from(lancamentos)
    .leftJoin(categoriasDespesa, eq(categoriasDespesa.id, lancamentos.categoriaId))
    .where(and(...c))
    .orderBy(desc(lancamentos.competencia), desc(lancamentos.criadoEm));
  return linhas.map((x) => ({ ...x.l, categoria: x.categoria, estornada: Boolean(x.estornada) })).filter((x) => f.incluirEstornadas || !x.estornada);
}

export async function obterDespesa(db: Db, organizacaoId: string, id: string): Promise<LinhaDespesa | null> {
  if (!uuidValido(id)) return null;
  const [x] = await db
    .select({
      l: lancamentos,
      categoria: categoriasDespesa.nome,
      estornada: sql<boolean>`exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
    })
    .from(lancamentos)
    .leftJoin(categoriasDespesa, eq(categoriasDespesa.id, lancamentos.categoriaId))
    .where(
      and(
        eq(lancamentos.id, id),
        eq(lancamentos.organizacaoId, organizacaoId),
        inArray(lancamentos.tipo, ["despesa_empresa", "despesa_proprietario"]),
        sql`${lancamentos.estornoDe} is null`,
      ),
    );
  return x ? { ...x.l, categoria: x.categoria, estornada: Boolean(x.estornada) } : null;
}

/**
 * Totais das despesas ativas: da empresa, dos proprietários e o que ainda falta pagar. O que os
 * proprietários devem sai dos adiantamentos em aberto (M4.4: `totalACobrar`), não daqui.
 */
export function totaisDespesas(linhas: readonly LinhaDespesa[]) {
  const ativas = linhas.filter((l) => !l.estornada);
  const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    empresa: soma(ativas.filter((l) => l.tipo === "despesa_empresa").map((l) => l.montante ?? -l.valor)),
    proprietarios: soma(ativas.filter((l) => l.tipo === "despesa_proprietario").map((l) => l.montante ?? 0)),
    aPagar: soma(ativas.filter((l) => l.estado === "previsto").map((l) => l.montante ?? 0)),
  };
}
