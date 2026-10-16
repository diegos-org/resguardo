/**
 * Contestação do pagamento no site (M8.2e) — o livro da disputa (`lancarContestacao`): as linhas de cada momento (o débito
 * confirmado, a decisão de quem arca e as mudanças dela, a ganha, a perdida e a divisão definitiva, o "sem efeito"),
 * sempre sob as travas de quem chama (`travarCotacao` → motor da reserva → livro), dentro da transação da ação.
 *
 * - **Resultado** (proprietário e SCL): origem `contestacao_pagamento`, competência no mês corrente em São Paulo (nunca o
 *   passado: mês fechado e relatório enviado não mudam). O proprietário pela regra única (`lancarAcertoDoProprietario`,
 *   `previsto`, para quem recebeu a parte); a SCL como `despesa_empresa` na categoria da disputa
 *   (`categoriaDaPerdaPorDisputa`, criada no primeiro uso, como a da taxa perdida).
 * - **Caixa** (retido, volta, caixa final; valor 0, só `montante`): competência = data de caixa = o dia do fato, nunca no
 *   futuro. Só no dinheiro da reserva (o de um pagamento sem reserva nunca entrou no livro).
 * - Reversões e ajustes são **espelhos no mês corrente**, nunca `estornar` (o estorno herda a competência do original e
 *   mexeria num mês que pode estar fechado). Só o retido previsto (sem caixa, sem resultado) sai por estorno.
 * - Idempotente pela chave (`chavesDaContestacao`) e por `decisao_versao`: uma chave já lançada não é lançada de novo; nada
 *   com valor 0.
 *
 * As partes efetivas da reserva (D e C da divisão) e o que a disputa já lançou (Σx, Σy, o retido) também moram aqui: a
 * prévia (sem trava) e a ação (com trava) leem daqui.
 */
import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { categoriaDaPerdaPorDisputa } from "@/configuracoes/pagamento-site";
import { contestacoesPagamento, lancamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { estornar, type Lancamento, lancar, type NovoLancamento } from "@/financeiro/ledger";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { dataBr, diaMesBr } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { lancarAcertoDoProprietario, mesDoDesconto, ORIGEM_CANCELAMENTO } from "@/repasses/descontos";
import { registrarEventoDaContestacao } from "./contestacao-leitura";
import {
  caixaFinalDaPerda,
  chavesDaContestacao,
  descricaoPerdaPrevistaDaScl,
  descricaoSeguradoDoProprietario,
  type FonteEventoContestacao,
  NOMES_TIPO_CONTESTACAO,
  ORIGEM_LANCAMENTO_CONTESTACAO,
  prefixoDaContestacao,
  TEXTO_SEM_PROPRIETARIO_NA_RESERVA,
} from "./contestacao-regras";
import { type Contestacao, dinheiroDaReserva, type Pagamento, type Travado } from "./travas";

const emVigor = () => and(isNull(lancamentos.estornoDe), sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`);

/**
 * Uma recusa no meio da transação de uma ação da disputa (a categoria arquivada, a liberação do formulário recusada, um
 * dado que falta para o caixa): desfaz tudo o que a transação gravou e volta como resposta (`{ ok: false, erro }`).
 */
export class RecusaDaContestacao extends Error {
  constructor(
    readonly erro: string,
    readonly codigo?: string,
  ) {
    super(erro);
    this.name = "RecusaDaContestacao";
  }
}

// ---------------------------------------------------------------- as partes efetivas da reserva

/**
 * As partes efetivas da reserva (a base da proporção, `dividirPerda`): D = a soma em vigor de `direito_proprietario` e C =
 * a de `comissao`, de origem `motor` e `cancelamento` (os espelhos do M8.2c), todos os meses. Com a base líquida de hoje, D
 * + C = valor − taxa (cada um arca com a taxa na sua proporção); com a bruta, a taxa fica com a SCL (`regras.base`, uma
 * regra só, no motor). `proprietarioId`: quem recebe a parte, pelas linhas do motor da reserva (nunca pelo dono atual do
 * imóvel); null quando as linhas não têm proprietário (acerto pendente) ou têm mais de um. Sem nenhuma linha em vigor (a
 * reserva cancelada com tudo estornado), o das linhas do motor de antes.
 */
export type PartesEfetivas = { parteProprietario: number; comissao: number; proprietarioId: string | null };

export async function partesEfetivasDaReserva(tx: Db, organizacaoId: string, reservaId: string): Promise<PartesEfetivas> {
  const linhas = await tx
    .select({ tipo: lancamentos.tipo, valor: lancamentos.valor, proprietarioId: lancamentos.proprietarioId })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.reservaId, reservaId),
        inArray(lancamentos.tipo, ["direito_proprietario", "comissao"]),
        inArray(lancamentos.origem, ["motor", ORIGEM_CANCELAMENTO]),
        emVigor(),
      ),
    );
  const somar = (tipo: string) => linhas.filter((l) => l.tipo === tipo).reduce((s, l) => s + l.valor, 0);
  const unico = (ids: (string | null)[]) => {
    const s = new Set(ids);
    return s.size === 1 && !s.has(null) ? [...s][0] : null;
  };
  const direitos = linhas.filter((l) => l.tipo === "direito_proprietario");
  let proprietarioId = direitos.length ? unico(direitos.map((l) => l.proprietarioId)) : null;
  if (!direitos.length) {
    const antes = await tx
      .select({ proprietarioId: lancamentos.proprietarioId })
      .from(lancamentos)
      .where(and(eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.reservaId, reservaId), eq(lancamentos.tipo, "direito_proprietario"), eq(lancamentos.origem, "motor"), isNull(lancamentos.estornoDe)));
    proprietarioId = antes.length ? unico(antes.map((l) => l.proprietarioId)) : null;
  }
  return { parteProprietario: somar("direito_proprietario"), comissao: somar("comissao"), proprietarioId };
}

// ---------------------------------------------------------------- o que a disputa já lançou

/** Uma linha do livro da disputa, com a marca de estornada. */
export type LinhaDaDisputa = Lancamento & { estornada: boolean };

/**
 * O que a disputa já lançou (todas as linhas com o prefixo dela): Σx (o segurado do proprietário em vigor, as versões da
 * decisão; positivo) e Σy (a perda prevista da SCL em vigor; positiva), as linhas de versão, o retido em vigor (previsto ou
 * realizado) e o proprietário das linhas dele. A comparação da perdida é sempre com o já lançado, nunca com o valor em risco
 * recalculado.
 */
export type LivroDaDisputa = {
  linhas: LinhaDaDisputa[];
  proprietario: number;
  scl: number;
  /** As linhas de versão em vigor (`…:proprietario:vN` e `…:scl:vN`), com o número da versão. */
  versoes: { versao: number; lado: "proprietario" | "scl"; l: LinhaDaDisputa }[];
  retido: LinhaDaDisputa | null;
  proprietarioId: string | null;
};

export async function livroDaDisputa(tx: Db, organizacaoId: string, l: Pick<Contestacao, "id" | "pagamentoId" | "retidoLancamentoId">): Promise<LivroDaDisputa> {
  const prefixo = prefixoDaContestacao(l.pagamentoId, l.id);
  const doLivro = await tx
    .select()
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, organizacaoId), like(lancamentos.chaveOrigem, `${prefixo}%`)));
  const estornados = doLivro.length
    ? new Set(
        (
          await tx
            .select({ de: lancamentos.estornoDe })
            .from(lancamentos)
            .where(and(eq(lancamentos.organizacaoId, organizacaoId), inArray(lancamentos.estornoDe, doLivro.map((x) => x.id))))
        ).map((x) => x.de),
      )
    : new Set<string | null>();
  const linhas: LinhaDaDisputa[] = doLivro.map((x) => ({ ...x, estornada: estornados.has(x.id) }));
  const versao = new RegExp(`^${prefixo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(proprietario|scl):v([1-9]\\d*)$`);
  const versoes = linhas
    .filter((x) => !x.estornada)
    .flatMap((x) => {
      const m = versao.exec(x.chaveOrigem);
      return m ? [{ versao: Number(m[2]), lado: m[1] as "proprietario" | "scl", l: x }] : [];
    })
    .sort((a, b) => a.versao - b.versao);
  const proprietario = versoes.filter((v) => v.lado === "proprietario").reduce((s, v) => s - v.l.valor, 0);
  const scl = versoes.filter((v) => v.lado === "scl").reduce((s, v) => s - v.l.valor, 0);
  const retido = l.retidoLancamentoId ? (linhas.find((x) => x.id === l.retidoLancamentoId && !x.estornada) ?? null) : null;
  const donos = new Set(versoes.filter((v) => v.lado === "proprietario").map((v) => v.l.proprietarioId));
  const proprietarioId = donos.size === 1 && !donos.has(null) ? [...donos][0] : null;
  return { linhas, proprietario, scl, versoes, retido, proprietarioId };
}

/** O retido em vigor como a assinatura do resultado o lê (estado e montante), ou null. */
export const retidoDaAssinatura = (r: Pick<Lancamento, "estado" | "montante"> | null) => (r ? { estado: r.estado, montante: r.montante ?? 0 } : null);
/** O retido em vigor já é saída de caixa realizada (o débito confirmado, ou o MED lido como devolução). */
export const retidoRealizado = (r: Pick<Lancamento, "estado"> | null) => !!r && (r.estado === "realizado" || r.estado === "conciliado");

// ---------------------------------------------------------------- os momentos

/**
 * O momento da disputa que `lancarContestacao` lança (a tabela "Lançamentos por momento" do desenho):
 * - `debito`: "Confirmar o débito do Mercado Pago": o retido vira realizado na data e no valor confirmados (a prevista é
 *   estornada e nasce a realizada `#N`, com competência = data de caixa = o dia do débito);
 * - `decisao`: a versão `versao` da decisão (1 = registrar; as seguintes = mudar ou atualizar o valor segurado), com a
 *   divisão em vigor (x, y): lança só a diferença de cada lado em relação às versões anteriores;
 * - `ganha`: a reversão do proprietário e o espelho da SCL, a volta do retido realizado (no dia em que o dinheiro voltou) ou
 *   o estorno do previsto, e a tarifa;
 * - `perdida`: o caixa (o retido previsto estornado; o caixa final = valor perdido − líquido que não entrou − retido
 *   realizado, na data do débito), a tarifa e, no pagamento sem reserva, a taxa perdida como despesa da SCL;
 * - `definitivos`: a divisão final da perdida (xF, yF) comparada com o já lançado: o ajuste do proprietário, o espelho da
 *   perda prevista e a perda definitiva da SCL (na confirmação da perdida com decisão, ou na decisão depois dela);
 * - `sem_efeito`: os espelhos das linhas previstas (`…:sem_efeito:<lançamento original>`), o retido previsto estornado e o
 *   realizado de volta (no dia em que o dinheiro voltou).
 */
export type MomentoDaDisputa =
  | { tipo: "debito"; data: string; valor: number }
  | { tipo: "decisao"; versao: number; proprietario: number; scl: number; proprietarioId: string | null }
  | { tipo: "ganha"; resultadoEm: string; voltaEm: string | null; tarifa: number }
  | { tipo: "perdida"; resultadoEm: string; debitoEm: string | null; valorPerdido: number; liquidoNaoEntrou: number; tarifa: number }
  | { tipo: "definitivos"; resultadoEm: string; proprietario: number; scl: number; proprietarioId: string | null }
  | { tipo: "sem_efeito"; voltaEm: string | null };

export const TEXTO_DEBITO_JA_CONFIRMADO = "O débito do Mercado Pago já foi confirmado nesta disputa.";
export const TEXTO_INFORME_A_VOLTA = "Informe o dia em que o dinheiro debitado pelo Mercado Pago voltou à conta.";
export const TEXTO_INFORME_O_DEBITO = "Informe o dia em que o Mercado Pago debitou o valor perdido.";

/**
 * Lança as linhas de um momento da disputa (ver `MomentoDaDisputa`), sob as travas de quem chama (a do motor da reserva é
 * tomada aqui, antes do livro), atualiza os vínculos de caixa da linha (`retido_lancamento_id`, `volta_lancamento_id`,
 * `caixa_final_lancamento_id`; o retrato junto) e registra o evento `lancamentos`. Uma chave já lançada fica como está.
 * Recusa (`RecusaDaContestacao`) quando falta um dado do caixa, a reserva não tem proprietário para a linha dele, ou a
 * categoria da disputa está arquivada. Devolve as chaves lançadas agora.
 */
export async function lancarContestacao(
  tx: Db,
  organizacaoId: string,
  t: Travado,
  p: Pagamento,
  l: Contestacao,
  m: MomentoDaDisputa,
  autorId: string | null,
  agora: Date,
  o: { fonte?: FonteEventoContestacao } = {},
): Promise<string[]> {
  const daReserva = dinheiroDaReserva(p);
  await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
  const chaves = chavesDaContestacao(p.id, l.id);
  const livro = await livroDaDisputa(tx, organizacaoId, l);
  const jaLancadas = new Set(livro.linhas.map((x) => x.chaveOrigem));
  const lancadas: string[] = [];
  const competencia = mesDoDesconto(agora);
  const qual = daReserva ? `reserva ${t.reserva.codigo}` : `pagamento sem reserva (cotação ${t.cotacao.codigo})`;
  const disputa = `Disputa do pagamento da ${qual}`;

  let categoriaId: string | null = null;
  const categoria = async () => {
    if (categoriaId) return categoriaId;
    const c = await categoriaDaPerdaPorDisputa(tx, organizacaoId, autorId);
    if (!c.ok) throw new RecusaDaContestacao(c.erro);
    categoriaId = c.id;
    return c.id;
  };
  const novo = async (n: NovoLancamento): Promise<Lancamento | null> => {
    if (jaLancadas.has(n.chaveOrigem!)) return livro.linhas.find((x) => x.chaveOrigem === n.chaveOrigem) ?? null;
    const [x] = await lancar(tx, organizacaoId, [n], autorId);
    jaLancadas.add(n.chaveOrigem!);
    lancadas.push(n.chaveOrigem!);
    return x;
  };
  /** Uma linha do proprietário (valor com sinal; 0 = nada), no mês corrente, para quem recebeu a parte. */
  const doProprietario = async (chave: string, valor: number, descricao: string, proprietarioId: string | null) => {
    if (valor === 0 || jaLancadas.has(chave)) return;
    if (!daReserva || !proprietarioId) throw new RecusaDaContestacao(TEXTO_SEM_PROPRIETARIO_NA_RESERVA, "sem_proprietario");
    await lancarAcertoDoProprietario(tx, organizacaoId, ORIGEM_LANCAMENTO_CONTESTACAO, { chave, proprietarioId, imovelId: t.reserva.imovelId, reservaId: t.reserva.id, valor, competencia, descricao }, autorId, agora);
    jaLancadas.add(chave);
    lancadas.push(chave);
  };
  /** Uma linha da SCL (`despesa_empresa`; `perda` positiva = custo, negativa = reversão; 0 = nada), no mês corrente. */
  const daScl = async (chave: string, perda: number, estado: "previsto" | "realizado", descricao: string) => {
    if (perda === 0 || jaLancadas.has(chave)) return;
    await novo({
      tipo: "despesa_empresa",
      descricao,
      valor: -perda,
      efeitoSaldo: 0,
      montante: perda,
      competencia,
      dataCaixa: null,
      estado,
      imovelId: t.imovel.id,
      reservaId: daReserva ? t.reserva.id : null,
      categoriaId: await categoria(),
      origem: ORIGEM_LANCAMENTO_CONTESTACAO,
      chaveOrigem: chave,
    });
  };
  /** Uma linha de caixa (valor 0, só `montante`), realizada no dia do fato; só no dinheiro da reserva. */
  const deCaixa = async (chave: string, tipo: "devolucao" | "recebimento", montante: number, data: string, descricao: string) =>
    novo({
      tipo,
      descricao,
      valor: 0,
      efeitoSaldo: 0,
      montante,
      competencia: data,
      dataCaixa: data,
      estado: "realizado",
      imovelId: t.reserva.imovelId,
      reservaId: t.reserva.id,
      origem: ORIGEM_LANCAMENTO_CONTESTACAO,
      chaveOrigem: chave,
    });
  /** Uma despesa da SCL já paga (a tarifa, a taxa do pagamento sem reserva), com data de caixa. */
  const despesaPaga = async (chave: string, valor: number, data: string, descricao: string) => {
    if (valor <= 0 || jaLancadas.has(chave)) return;
    await novo({
      tipo: "despesa_empresa",
      descricao,
      valor: -valor,
      efeitoSaldo: 0,
      montante: valor,
      competencia: data,
      dataCaixa: data,
      estado: "realizado",
      imovelId: t.imovel.id,
      reservaId: daReserva ? t.reserva.id : null,
      categoriaId: await categoria(),
      origem: ORIGEM_LANCAMENTO_CONTESTACAO,
      chaveOrigem: chave,
    });
  };
  const gravar = async (mudanca: Partial<Pick<Contestacao, "retidoLancamentoId" | "voltaLancamentoId" | "caixaFinalLancamentoId" | "retidoConfirmadoEm" | "retidoConfirmadoPor" | "debitoEm">>) => {
    await tx.update(contestacoesPagamento).set({ ...mudanca, atualizadoEm: agora }).where(eq(contestacoesPagamento.id, l.id));
    Object.assign(l, mudanca);
  };
  /** O retido previsto sai por estorno (nada se moveu). */
  const estornarPrevisto = async (motivo: string) => {
    if (!livro.retido || livro.retido.estado !== "previsto") return false;
    await estornar(tx, organizacaoId, livro.retido.id, motivo, autorId);
    await gravar({ retidoLancamentoId: null });
    return true;
  };
  /** A volta do retido realizado (`recebimento`), no dia em que o dinheiro voltou. */
  const volta = async (voltaEm: string | null, porque: string) => {
    if (!retidoRealizado(livro.retido)) return;
    if (!voltaEm) throw new RecusaDaContestacao(TEXTO_INFORME_A_VOLTA, "dados");
    const x = await deCaixa(chaves.volta(), "recebimento", livro.retido!.montante ?? 0, voltaEm, `Reserva ${t.reserva.codigo} — valor em disputa debitado pelo Mercado Pago que voltou à conta em ${dataBr(voltaEm)} (${porque})`);
    if (x) await gravar({ voltaLancamentoId: x.id });
  };
  let estornouPrevisto = false;

  switch (m.tipo) {
    case "debito": {
      if (retidoRealizado(livro.retido)) throw new RecusaDaContestacao(TEXTO_DEBITO_JA_CONFIRMADO);
      let retidoId: string | null = null;
      if (daReserva) {
        if (livro.retido) await estornar(tx, organizacaoId, livro.retido.id, `débito do Mercado Pago confirmado em ${dataBr(m.data)}`, autorId);
        const x = await deCaixa(
          proximaChaveDoRetido(livro, chaves),
          "devolucao",
          m.valor,
          m.data,
          `Reserva ${t.reserva.codigo} — valor em disputa (${NOMES_TIPO_CONTESTACAO[l.tipo].toLowerCase()}) debitado pelo Mercado Pago em ${dataBr(m.data)}`,
        );
        retidoId = x?.id ?? null;
      }
      await gravar({ retidoLancamentoId: retidoId, retidoConfirmadoEm: agora, retidoConfirmadoPor: autorId, debitoEm: m.data });
      break;
    }
    case "decisao": {
      // A diferença de cada lado em relação às versões anteriores (nunca à exposição recalculada).
      const antes = livro.versoes.filter((v) => v.versao < m.versao);
      const x = antes.filter((v) => v.lado === "proprietario").reduce((s, v) => s - v.l.valor, 0);
      const y = antes.filter((v) => v.lado === "scl").reduce((s, v) => s - v.l.valor, 0);
      const dono = m.proprietarioId ?? livro.proprietarioId;
      const descricaoProprietario =
        m.versao === 1 || x === 0 ? descricaoSeguradoDoProprietario(t.reserva.codigo, m.proprietario) : `${disputa}: valor segurado dos seus próximos repasses muda de ${formatBRL(x)} para ${formatBRL(m.proprietario)} até o resultado`;
      await doProprietario(chaves.proprietario(m.versao), -(m.proprietario - x), descricaoProprietario, dono);
      await daScl(chaves.scl(m.versao), m.scl - y, "previsto", m.versao === 1 || y === 0 ? descricaoPerdaPrevistaDaScl(t.reserva.codigo) : `${disputa}: perda prevista da SCL muda de ${formatBRL(y)} para ${formatBRL(m.scl)}`);
      break;
    }
    case "ganha": {
      const quando = `a SCL ganhou a disputa em ${diaMesBr(m.resultadoEm)}`;
      await doProprietario(chaves.proprietarioReverte(), livro.proprietario, `${disputa}: valor segurado devolvido (${quando})`, livro.proprietarioId);
      await daScl(chaves.sclReverte(), -livro.scl, "previsto", `${disputa}: perda prevista revertida (${quando})`);
      await volta(m.voltaEm, quando);
      estornouPrevisto = await estornarPrevisto(`disputa ganha em ${dataBr(m.resultadoEm)}: o valor não foi debitado`);
      await despesaPaga(chaves.tarifa(), m.tarifa, m.resultadoEm, `Tarifa do Mercado Pago pela disputa do pagamento da ${qual}`);
      break;
    }
    case "perdida": {
      estornouPrevisto = await estornarPrevisto(`disputa perdida em ${dataBr(m.resultadoEm)}: o débito entra no caixa final`);
      if (daReserva) {
        const debitado = retidoRealizado(livro.retido) ? (livro.retido!.montante ?? 0) : 0;
        const final = caixaFinalDaPerda({ valorPerdido: m.valorPerdido, liquidoNaoEntrou: m.liquidoNaoEntrou, retidoRealizado: debitado });
        if (final !== 0) {
          if (!m.debitoEm) throw new RecusaDaContestacao(TEXTO_INFORME_O_DEBITO, "dados");
          const conta = `valor perdido ${formatBRL(m.valorPerdido)}, menos ${formatBRL(m.liquidoNaoEntrou)} que nunca entrou e ${formatBRL(debitado)} já debitados`;
          const x = await deCaixa(
            chaves.caixaFinal(),
            final > 0 ? "devolucao" : "recebimento",
            Math.abs(final),
            m.debitoEm,
            `Reserva ${t.reserva.codigo} — disputa perdida: ${final > 0 ? "saída" : "entrada"} de ${formatBRL(Math.abs(final))} (${conta})`,
          );
          if (x) await gravar({ caixaFinalLancamentoId: x.id });
        }
      } else {
        // Pagamento sem reserva: o dinheiro dele nunca entrou no livro; o que a SCL perde é a taxa (salvo se o Mercado Pago a devolveu).
        const dia = m.debitoEm ?? m.resultadoEm;
        await despesaPaga(chaves.taxa(), m.valorPerdido, dia, `Taxa do pagamento do site perdida na disputa (${qual})`);
      }
      await despesaPaga(chaves.tarifa(), m.tarifa, m.resultadoEm, `Tarifa do Mercado Pago pela disputa do pagamento da ${qual}`);
      break;
    }
    case "definitivos": {
      // A divisão final (xF, yF) comparada sempre com o já lançado (Σx, Σy): o ajuste do proprietário (positivo devolve), o
      // espelho da perda prevista e a perda definitiva da SCL, no mês corrente (nunca `mudarEstado` num mês anterior).
      const quando = `a SCL perdeu a disputa em ${diaMesBr(m.resultadoEm)}`;
      const ajuste = livro.proprietario - m.proprietario;
      const dono = livro.proprietarioId ?? m.proprietarioId;
      await doProprietario(
        chaves.proprietarioFinal(),
        ajuste,
        ajuste < 0 ? `${disputa}: desconto definitivo de ${formatBRL(m.proprietario)} (${quando})` : `${disputa}: ajuste do desconto definitivo para ${formatBRL(m.proprietario)} (${quando})`,
        dono,
      );
      await daScl(chaves.sclEspelho(), -livro.scl, "previsto", `${disputa}: perda prevista substituída pela definitiva (${quando})`);
      await daScl(chaves.sclFinal(), m.scl, "realizado", `${disputa}: perda definitiva da SCL (${quando})`);
      break;
    }
    case "sem_efeito": {
      // Os espelhos das linhas previstas, no mês corrente (repetir depois de uma falha não duplica: a chave leva o original).
      for (const v of livro.versoes) {
        const chave = chaves.semEfeito(v.l.id);
        if (jaLancadas.has(chave)) continue;
        if (v.lado === "proprietario") await doProprietario(chave, -v.l.valor, `${disputa} encerrada sem efeito: valor segurado devolvido`, v.l.proprietarioId);
        else
          await novo({
            tipo: "despesa_empresa",
            descricao: `${disputa} encerrada sem efeito: perda prevista revertida`,
            valor: -v.l.valor,
            efeitoSaldo: 0,
            montante: v.l.montante === null ? null : -v.l.montante,
            competencia,
            dataCaixa: null,
            estado: "previsto",
            imovelId: v.l.imovelId,
            reservaId: v.l.reservaId,
            categoriaId: v.l.categoriaId,
            origem: ORIGEM_LANCAMENTO_CONTESTACAO,
            chaveOrigem: chave,
          });
      }
      await volta(m.voltaEm, "disputa encerrada sem efeito");
      estornouPrevisto = await estornarPrevisto("disputa encerrada sem efeito");
      break;
    }
  }
  if (lancadas.length || estornouPrevisto)
    await registrarEventoDaContestacao(tx, l.id, { fonte: o.fonte ?? "equipe", tipo: "lancamentos", depois: { momento: m.tipo, linhas: lancadas.length, retidoPrevistoEstornado: estornouPrevisto }, usuarioId: autorId }, agora);
  return lancadas;
}

/** A próxima chave `…:retido` livre desta disputa (`#N`). */
function proximaChaveDoRetido(livro: LivroDaDisputa, chaves: ReturnType<typeof chavesDaContestacao>): string {
  const usadas = new Set(livro.linhas.map((x) => x.chaveOrigem));
  let n = 1;
  while (usadas.has(chaves.retido(n))) n++;
  return chaves.retido(n);
}
