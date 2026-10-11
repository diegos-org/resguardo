/**
 * Contestação do pagamento no site (M8.2e) — abertura e leitura: o registro pela equipe ("Registrar disputa vista no
 * painel do Mercado Pago"), a rotina que relê as disputas abertas (`conferirContestacoes`), a busca semanal das disputas
 * tardias (`buscarContestacoesTardias`) e os e-mails à equipe (abertura e prazo dos documentos). A leitura sob a trava
 * (casamento, transições, valor em risco, retido, substituição das devoluções, avisos) mora em `contestacao-leitura.ts`,
 * que `aplicarLeitura` também usa.
 *
 * E as ações da equipe no quadro da disputa: "Confirmar o débito do Mercado Pago", "Registrar quem arca" / "Mudar quem
 * arca" / "Atualizar o valor segurado" (com a prévia: versão e assinatura, como no M8.2c), "Confirmar que é outra
 * disputa", "Documentos enviados", o prazo dos documentos, "Confirmar o resultado" (fase 0 de releitura sem trava, fase 1
 * numa transação), "Encerrar sem efeito" e "Conferir o aviso" (que pode reabrir a rodada seguinte). O livro de cada momento
 * mora em `contestacao-acerto.ts` (`lancarContestacao`). As permissões ficam nas ações do painel; aqui, o id resolvido com
 * o filtro da organização antes de qualquer trava (`contestacaoDaOrganizacao`) e o autor.
 *
 * Toda chamada ao provedor acontece fora de transação; toda gravação em `contestacoes_pagamento` e `eventos_contestacao`
 * acontece dentro de `travarCotacao` (a ordem única das travas). Ler usa o provedor de conferência; o registro pela equipe
 * segue sem ele (com "sem leitura do Mercado Pago" na nota). Nada de dado pessoal: só ids do Mercado Pago, códigos, valores
 * e datas; as notas passam por `textoSemDadosPessoais`.
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { reservaCalculadaPeloMotor } from "@/financeiro/motor";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { violouUnicidade } from "@/db/erros";
import { contestacoesPagamento, eventosContestacao, imoveis, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { avisarEquipePorEmail } from "@/email/aviso-equipe";
import type { Correio } from "@/email/correio";
import { ERRO_DADOS_PESSOAIS, textoSemDadosPessoais } from "@/lib/dados-pessoais";
import { hojeISO, instanteLocal } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { dataValida } from "@/reservas/regras";
import { inicioDoPrazoDeReleitura } from "./andamento";
import { conferirTentativa } from "./conferencia";
import {
  lancarContestacao,
  livroDaDisputa,
  type PartesEfetivas,
  partesEfetivasDaReserva,
  RecusaDaContestacao,
  retidoDaAssinatura,
  retidoRealizado,
  TEXTO_DEBITO_JA_CONFIRMADO,
} from "./contestacao-acerto";
import {
  aplicarLeiturasDaDisputa,
  contextoDaNova,
  criarLinha,
  lancarRetidoRealizado,
  leituraDaSituacao,
  leituraDoCaso,
  recalcularDisputas,
  registrarEventoDaContestacao,
  sincronizarAvisosDaDisputa,
  substituirDevolucoes,
  trocarAvisosDaContestacao,
} from "./contestacao-leitura";
import {
  acertoDaPerda,
  assinaturaDaDecisao,
  assinaturaDoResultado,
  casarContestacao,
  casoDestePagamento,
  chavesDaContestacao,
  CODIGOS_CAUSA_CONTESTACAO,
  type CodigoCausaContestacao,
  confirmadoPelasSubstituidas,
  contestacaoNaoFinal,
  DESFECHO_CONTESTACAO,
  divisaoDaDecisao,
  esperaDaLeituraDaContestacao,
  FALHAS_PARA_SEM_FONTE,
  type FonteEventoContestacao,
  JANELA_CONTESTACAO_TARDIA,
  LEITURAS_DE_CONTESTACAO_POR_VOLTA,
  type LeituraDeContestacao,
  leituraEmDisputa,
  LIMITE_NOTA_CONTESTACAO,
  liquidoNaoEntrouProposto,
  naJanelaTardia,
  NOMES_TIPO_CONTESTACAO,
  NOTA_SEM_CONFERIR_AGORA,
  NOTA_SEM_LEITURA,
  novaContestacao,
  ORCAMENTO_VOLTA_CONTESTACAO_MS,
  perdaADividir,
  PRAZO_LEITURA_CONTESTACAO_DIAS,
  QUEM_ARCA_CONTESTACAO,
  type QuemArcaContestacao,
  RELER_CONTESTACAO_A_CADA_MS,
  resultadoSugeridoPelaLeitura,
  TEXTO_CASO_DE_OUTRO_PAGAMENTO,
  TEXTO_CONTESTACAO_PREVIA_MUDOU,
  TEXTO_DECISAO_MUDOU,
  TEXTO_DISPUTA_JA_NO_QUADRO,
  TEXTO_DISPUTA_JA_TERMINOU,
  TEXTO_NADA_A_DIVIDIR,
  TEXTO_NAO_E_DUPLICATA,
  TEXTO_NOTA_REFORCADA,
  TEXTO_PAGAMENTO_SEM_RESERVA,
  TEXTO_SEM_AVISO_A_CONFERIR,
  TEXTO_SEM_PARTES_PARA_DIVIDIR,
  TEXTO_SEM_PROPRIETARIO_NA_RESERVA,
  TIPOS_CONTESTACAO,
  type TipoContestacao,
  transicaoDaContestacao,
  valorSeguradoDesatualizado,
} from "./contestacao-regras";
import { confirmarDevolucaoPelaDisputa, devolucaoDevidaDepoisDaDisputa } from "./devolucao";
import { liquidoQueAindaPodeEntrar, recebimentosDoPagamento, registrarLiberacaoManual } from "./liberacao";
import { ErroProvedor, ID_NUMERICO_PROVEDOR, type ProvedorPagamento, semAcessoContestacao } from "./provedor";
import { comDinheiro } from "./situacoes";
import {
  type Contestacao,
  contestacaoDaOrganizacao,
  contestacoesDoPagamento,
  devolucaoInexplicada,
  devolucoesDoPagamento,
  devolvidoPelaDisputa,
  dinheiroDaReserva,
  lerCotacaoSemTravar,
  type Pagamento,
  pagamentoDaOrganizacao,
  travaOcupada,
  type Travado,
  travarCotacao,
  valorPagoAprovado,
} from "./travas";

export * from "./contestacao-leitura";
export { contestacaoDaOrganizacao, pagamentoDaOrganizacao } from "./travas";

const FUSO = "America/Sao_Paulo";
const DIA_MS = 86_400_000;
const dataBr = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
const diaMes = (d: Date) => dataBr(hojeISO(FUSO, d));

/**
 * O resultado de uma ação da disputa. `codigo` (M8.2e, as ações da equipe): `contestacao_previa_mudou` (a assinatura da
 * prévia mudou), `decisao_mudou` (a versão da decisão mudou), `nao_encontrada`, `ocupado`, `dados` e os da transição.
 */
export type ResultadoContestacao = { ok: true; contestacaoId: string; mensagem?: string } | { ok: false; erro: string; codigo?: string };

/** Muitas mudanças no mesmo pagamento ao mesmo tempo (trava ocupada): nada foi gravado. */
export const TEXTO_OCUPADO_CONTESTACAO = "Muitas mudanças neste pagamento agora: tente de novo em instantes.";

// ---------------------------------------------------------------- as fontes, fora de transação

/** O que as fontes deram numa volta (sem trava), para aplicar sob a trava. */
type LidoDasFontes = {
  /** As leituras da Chargebacks API (só casos deste pagamento) e da Payments API. */
  leituras: LeituraDeContestacao[];
  /** A Chargebacks API respondeu 403 (a conta ou a chave não lê contestações). */
  semAcesso: boolean;
  /** Alguma chamada falhou (transporte, limite, resposta ilegível). */
  falhou: boolean;
  /** A Chargebacks API ou a Payments API deram uma resposta útil (um caso deste pagamento, ou a situação dele). */
  util: boolean;
  /** Os casos que a Chargebacks API mostra de outro pagamento (nada deles é usado). */
  casosDeOutro: string[];
  /** A order foi relida e aplicada nesta volta (`conferirTentativa` sem falha). */
  orderLida: boolean;
  /** A Chargebacks API respondeu nesta volta sem 403 (um caso, a lista, ou "não achado"): a conta lê as contestações. */
  chargebacksRespondeu: boolean;
};

type PagamentoLido = Pick<Pagamento, "id" | "organizacaoId" | "cotacaoId" | "idProvedor" | "idPagamentoProvedor" | "criadoEm" | "consultadoEm" | "situacao">;

/**
 * Lê as fontes de uma disputa fora de transação: a order (`conferirTentativa`, que aplica sob a trava o que ela mostra),
 * enquanto ela está nos 85 dias e se não foi lida no último dia (`o.order`); a Chargebacks API pelo número de cada caso
 * conhecido ou, sem caso, pela busca do número do pagamento (`o.buscar`); depois dos 85 dias, a Payments API pelo número
 * (só para disputas no cartão: o MED e a reclamação não aparecem nela). Cada caso só vale se for deste pagamento
 * (`casoDestePagamento`); um sem o número do pagamento fica só como referência (não é lido).
 */
async function lerFontes(
  db: Db,
  provedor: ProvedorPagamento,
  p: PagamentoLido,
  linhas: readonly Pick<Contestacao, "idCaso" | "tipo" | "situacao">[],
  agora: Date,
  o: { order: boolean; buscar: boolean },
): Promise<LidoDasFontes> {
  const lido: LidoDasFontes = { leituras: [], semAcesso: false, falhou: false, util: false, casosDeOutro: [], orderLida: false, chargebacksRespondeu: false };
  const naOrder = !!p.idProvedor && p.criadoEm.getTime() >= inicioDoPrazoDeReleitura(agora).getTime();
  if (o.order && naOrder) {
    // Melhor esforço: a trava da cotação ocupada (outra leitura, uma ação na outra aba) é uma leitura que não deu agora.
    try {
      const r = await conferirTentativa(db, p.organizacaoId, p.id, provedor, agora, { forcar: true, origem: "rotina" });
      if (!r.ok) lido.falhou = true;
      else lido.orderLida = true;
    } catch (e) {
      if (!travaOcupada(e)) throw e;
      lido.falhou = true;
    }
  }
  const casos = [...new Set(linhas.map((l) => l.idCaso).filter((x): x is string => !!x && ID_NUMERICO_PROVEDOR.test(x)))];
  try {
    for (const idCaso of casos) {
      const caso = await provedor.consultarContestacao(idCaso);
      if (semAcessoContestacao(caso)) lido.semAcesso = true;
      else lido.chargebacksRespondeu = true;
      if (caso && !semAcessoContestacao(caso)) {
        const deste = casoDestePagamento(caso, p.idPagamentoProvedor);
        if (deste === "sim") {
          lido.leituras.push(leituraDoCaso(caso, agora));
          lido.util = true;
        } else if (deste === "outro") lido.casosDeOutro.push(caso.idCaso);
      }
    }
    if (!casos.length && o.buscar && p.idPagamentoProvedor) {
      const lista = await provedor.buscarContestacoes(p.idPagamentoProvedor);
      if (semAcessoContestacao(lista)) lido.semAcesso = true;
      else {
        lido.chargebacksRespondeu = true;
        // Útil só um caso deste pagamento: a lista vazia não diz nada da disputa que o sistema conhece.
        for (const caso of lista) if (casoDestePagamento(caso, p.idPagamentoProvedor) === "sim") lido.leituras.push(leituraDoCaso(caso, agora));
        lido.util ||= lido.leituras.length > 0;
      }
    }
  } catch (e) {
    if (!(e instanceof ErroProvedor)) throw e;
    lido.falhou = true;
  }
  // A terceira fonte: depois dos 85 dias (a order não é mais lida), a situação do pagamento pelo número. Só para disputas no
  // cartão (o "voltou a aprovado" de um MED registrado num Pix aprovado não diria nada).
  if (!naOrder && p.idPagamentoProvedor && linhas.every((l) => l.tipo === "chargeback")) {
    try {
      const s = await provedor.situacaoDoPagamento(p.idPagamentoProvedor);
      const l = s ? leituraDaSituacao(s, agora, p.situacao === "contestado") : null;
      if (l) {
        lido.leituras.push(l);
        lido.util = true;
      }
    } catch (e) {
      if (!(e instanceof ErroProvedor)) throw e;
      lido.falhou = true;
    }
  }
  return lido;
}

/**
 * Aplica, sob a trava, o que as fontes deram e anda a fila das disputas lidas nesta volta: `consultada_em`,
 * `falhas_leitura` (zera numa volta sem falha) e `proxima_leitura_em` (um dia; com falhas, 1, 2, 4 e até 7 dias); os avisos
 * de uma vez: sem acesso à Chargebacks API, caso de outro pagamento e, depois dos 85 dias sem resposta útil, sem fonte.
 */
async function aplicarFontes(db: Db, p: PagamentoLido, lidas: readonly string[], lido: LidoDasFontes, agora: Date): Promise<{ mudou: boolean; novas: number }> {
  return db.transaction(async (tx) => {
    const t = await travarCotacao(tx, p.organizacaoId, p.cotacaoId);
    const pt = t?.tentativas.find((x) => x.id === p.id);
    if (!t || !pt) return { mudou: false, novas: 0 };
    const fonte: FonteEventoContestacao = lido.leituras.some((l) => l.fonte === "chargebacks") ? "chargebacks" : "payments";
    const ef = await aplicarLeiturasDaDisputa(tx, p.organizacaoId, t, pt, lido.leituras, agora, { fonte, sincronizar: false });
    const foraDaOrder = pt.criadoEm.getTime() < inicioDoPrazoDeReleitura(agora).getTime() || !pt.idProvedor;
    let mudou = ef.mudou;
    for (const l of contestacoesDoPagamento(t, pt.id)) {
      if (!lidas.includes(l.id) || !contestacaoNaoFinal(l.situacao)) continue;
      const falhas = lido.falhou ? l.falhasLeitura + 1 : 0;
      const mudanca = { consultadaEm: agora, falhasLeitura: falhas, proximaLeituraEm: new Date(agora.getTime() + esperaDaLeituraDaContestacao(falhas)), atualizadoEm: agora };
      await tx.update(contestacoesPagamento).set(mudanca).where(eq(contestacoesPagamento.id, l.id));
      Object.assign(l, mudanca);
      const ligar: string[] = [];
      const desligar: string[] = [];
      // Sem acesso à Chargebacks API (403): liga; ela voltou a responder (a conta lê as contestações): sai.
      if (lido.semAcesso) ligar.push("contestacao_sem_leitura");
      else if (lido.chargebacksRespondeu) desligar.push("contestacao_sem_leitura");
      if (l.idCaso && lido.casosDeOutro.includes(l.idCaso)) ligar.push("contestacao_caso_de_outro_pagamento");
      else if (l.idCaso && lido.leituras.some((x) => x.idCaso === l.idCaso)) desligar.push("contestacao_caso_de_outro_pagamento");
      // Dia 85 sem fonte: a order não é mais lida e nem a Chargebacks API nem a Payments API disseram algo útil (ou não há
      // caso nem número do pagamento), inclusive quando elas falham seguidas vezes: a equipe confere o resultado no painel
      // do Mercado Pago. Uma resposta útil depois desliga o aviso.
      if (lido.util) desligar.push("contestacao_sem_fonte");
      else if (foraDaOrder && (!lido.falhou || falhas >= FALHAS_PARA_SEM_FONTE)) ligar.push("contestacao_sem_fonte");
      if (await trocarAvisosDaContestacao(tx, l, { ligar, desligar }, agora)) mudou = true;
    }
    if (ef.aoVivo && !pt.avisos.includes("ao_vivo")) pt.avisos = [...pt.avisos, "ao_vivo"];
    // A Chargebacks API e a Payments API só ligam a ambígua; quem a desliga é a releitura da order (`aplicarLeitura`) ou o
    // registro pela equipe (o aviso que a order deu nunca some pela leitura de outra fonte).
    await sincronizarAvisosDaDisputa(tx, t, pt, agora, { ambigua: ef.ambigua === true ? true : null });
    return { mudou, novas: ef.novas.length };
  });
}

// ---------------------------------------------------------------- a rotina

export type ResumoContestacoes = {
  /** Disputas relidas nesta volta. */
  lidas: number;
  mudaram: number;
  /** Pagamentos (com disputas a reler) em que alguma chamada falhou. */
  falhas: number;
  /** Disputas que passaram dos 240 dias e ganharam o aviso (não são mais lidas). */
  foraDoPrazo: number;
  /** Pagamentos procurados pela busca tardia e disputas novas que ela achou. */
  buscados: number;
  novas: number;
};

const resumoVazio = (): ResumoContestacoes => ({ lidas: 0, mudaram: 0, falhas: 0, foraDoPrazo: 0, buscados: 0, novas: 0 });

/**
 * A rotina das disputas (`rotinaDoSite`, depois de vencer os holds; nas prévias, pelo "Conferir agora"): cada disputa
 * `aberta` ou `a_confirmar` é relida uma vez por dia, em ordem de `proxima_leitura_em`, no máximo 50 por volta e dentro do
 * orçamento de 60 s (cada chamada tem 8 s). A fila anda também na falha (espera crescente). Até 240 dias da abertura; depois,
 * o aviso `contestacao_fora_do_prazo`, uma vez, linha a linha sob a trava, e a disputa sai da fila.
 * `o.pagamentoId`: só as disputas daquele pagamento ("Conferir agora" do quadro de uma reserva); `o.forcar`: sem esperar a
 * vez de cada uma. `o.relogio` (testes): o relógio do orçamento.
 */
export async function conferirContestacoes(
  db: Db,
  organizacaoId: string | null,
  provedor: ProvedorPagamento,
  agora: Date = new Date(),
  o: { pagamentoId?: string; forcar?: boolean; relogio?: () => number } = {},
): Promise<ResumoContestacoes> {
  const resumo = resumoVazio();
  const relogio = o.relogio ?? (() => Date.now());
  const inicio = relogio();
  const corte = new Date(agora.getTime() - PRAZO_LEITURA_CONTESTACAO_DIAS * DIA_MS);
  const filtros = and(
    inArray(contestacoesPagamento.situacao, ["aberta", "a_confirmar"]),
    organizacaoId ? eq(contestacoesPagamento.organizacaoId, organizacaoId) : undefined,
    o.pagamentoId ? eq(contestacoesPagamento.pagamentoId, o.pagamentoId) : undefined,
  );
  // 240 dias: para de ler e avisa, uma vez (linha a linha, sob a trava; nada de UPDATE em massa).
  const velhas = await db
    .select({ id: contestacoesPagamento.id, pagamentoId: contestacoesPagamento.pagamentoId, cotacaoId: pagamentos.cotacaoId, organizacaoId: contestacoesPagamento.organizacaoId })
    .from(contestacoesPagamento)
    .innerJoin(pagamentos, eq(pagamentos.id, contestacoesPagamento.pagamentoId))
    .where(and(filtros, lt(contestacoesPagamento.abertaEm, corte), sql`not (${contestacoesPagamento.avisos} @> '["contestacao_fora_do_prazo"]'::jsonb)`));
  for (const v of velhas) {
    try {
      const marcou = await db.transaction(async (tx) => {
        const t = await travarCotacao(tx, v.organizacaoId, v.cotacaoId);
        const l = t?.contestacoes.find((x) => x.id === v.id);
        const pt = t?.tentativas.find((x) => x.id === v.pagamentoId);
        if (!t || !l || !pt || !contestacaoNaoFinal(l.situacao)) return false;
        await tx.update(contestacoesPagamento).set({ proximaLeituraEm: null, atualizadoEm: agora }).where(eq(contestacoesPagamento.id, l.id));
        l.proximaLeituraEm = null;
        const mudou = await trocarAvisosDaContestacao(tx, l, { ligar: ["contestacao_fora_do_prazo"] }, agora);
        await sincronizarAvisosDaDisputa(tx, t, pt, agora);
        return mudou;
      });
      if (marcou) resumo.foraDoPrazo++;
    } catch (e) {
      if (!travaOcupada(e)) throw e;
      resumo.falhas++;
    }
  }
  const linhas = await db
    .select({ linha: contestacoesPagamento, p: pagamentos })
    .from(contestacoesPagamento)
    .innerJoin(pagamentos, eq(pagamentos.id, contestacoesPagamento.pagamentoId))
    .where(and(filtros, gte(contestacoesPagamento.abertaEm, corte), o.forcar ? undefined : or(isNull(contestacoesPagamento.proximaLeituraEm), lte(contestacoesPagamento.proximaLeituraEm, agora))))
    .orderBy(sql`${contestacoesPagamento.proximaLeituraEm} asc nulls first`, asc(contestacoesPagamento.abertaEm), asc(contestacoesPagamento.id))
    .limit(LEITURAS_DE_CONTESTACAO_POR_VOLTA);
  // Por pagamento, na ordem da fila: a order e a busca uma vez para todas as disputas dele.
  const porPagamento = new Map<string, { p: Pagamento; linhas: Contestacao[] }>();
  for (const x of linhas) {
    const g = porPagamento.get(x.p.id) ?? { p: x.p, linhas: [] };
    g.linhas.push(x.linha);
    porPagamento.set(x.p.id, g);
  }
  for (const { p, linhas: doPagamento } of porPagamento.values()) {
    if (relogio() - inicio >= ORCAMENTO_VOLTA_CONTESTACAO_MS) break;
    // A order lida no último dia (a releitura diária, ou o "Conferir agora" agora mesmo) já aplicou o que ela mostra.
    const orderRecente = !!p.consultadoEm && agora.getTime() - p.consultadoEm.getTime() < RELER_CONTESTACAO_A_CADA_MS;
    try {
      const lido = await lerFontes(db, provedor, p, doPagamento, agora, { order: !orderRecente, buscar: true });
      const r = await aplicarFontes(db, p, doPagamento.map((l) => l.id), lido, agora);
      resumo.lidas += doPagamento.length;
      if (r.mudou) resumo.mudaram++;
      resumo.novas += r.novas;
      if (lido.falhou) resumo.falhas++;
    } catch (e) {
      if (!travaOcupada(e)) throw e;
      resumo.falhas++;
    }
  }
  return resumo;
}

/**
 * A busca tardia (uma vez por semana por pagamento): todo pagamento com o número na Payments API e dinheiro (aprovado,
 * devolvido em parte ou por inteiro, contestado), de qualquer desfecho, na janela de 80 dias da aprovação até 200 dias depois
 * do maior entre a aprovação e a saída da reserva, com teto de 540 dias (`JANELA_CONTESTACAO_TARDIA`), procura as disputas
 * dele na Chargebacks API. A vez é reservada antes da chamada (`pagamentos.contestacoes_buscadas_em`, por `UPDATE …
 * RETURNING`, como a leitura reservada do M8.2a); a falha devolve a marca. Sem o número, nada.
 * `o.pagamentoId` com `o.forcar` ("Conferir agora" de uma reserva): só aquele pagamento, sem esperar a semana.
 */
export async function buscarContestacoesTardias(
  db: Db,
  organizacaoId: string | null,
  provedor: ProvedorPagamento,
  agora: Date = new Date(),
  o: { pagamentoId?: string; forcar?: boolean; relogio?: () => number } = {},
): Promise<Pick<ResumoContestacoes, "buscados" | "novas" | "falhas" | "mudaram">> {
  const resumo = { buscados: 0, novas: 0, falhas: 0, mudaram: 0 };
  const relogio = o.relogio ?? (() => Date.now());
  const inicio = relogio();
  const j = JANELA_CONTESTACAO_TARDIA;
  const semanaAtras = new Date(agora.getTime() - j.aCadaMs);
  const daVez = o.forcar && o.pagamentoId ? undefined : or(isNull(pagamentos.contestacoesBuscadasEm), lt(pagamentos.contestacoesBuscadasEm, semanaAtras));
  const depoisDaSaida = new Date(agora.getTime() - j.depoisDaSaidaDias * DIA_MS);
  const candidatos = await db
    .select({ p: pagamentos, checkout: reservas.checkout })
    .from(pagamentos)
    .leftJoin(reservas, eq(reservas.id, pagamentos.reservaId))
    .where(
      and(
        organizacaoId ? eq(pagamentos.organizacaoId, organizacaoId) : undefined,
        o.pagamentoId ? eq(pagamentos.id, o.pagamentoId) : undefined,
        isNotNull(pagamentos.idPagamentoProvedor),
        isNotNull(pagamentos.aprovadoEm),
        inArray(pagamentos.situacao, ["aprovado", "devolvido_parcial", "devolvido", "contestado"]),
        lte(pagamentos.aprovadoEm, new Date(agora.getTime() - j.desdeDias * DIA_MS)),
        gte(pagamentos.aprovadoEm, new Date(agora.getTime() - j.tetoDias * DIA_MS)),
        // A janela inteira antes do limite (o gêmeo SQL de `naJanelaTardia`): até 200 dias depois do maior entre a aprovação e
        // a saída da reserva (12h, em São Paulo). Um pagamento que já saiu dela nunca ganha marca nova e, sem isto, ficaria na
        // frente da fila para sempre.
        or(gte(pagamentos.aprovadoEm, depoisDaSaida), sql`((${reservas.checkout} + time '12:00') at time zone ${FUSO}) >= ${depoisDaSaida.toISOString()}::timestamptz`),
        daVez,
      ),
    )
    .orderBy(sql`${pagamentos.contestacoesBuscadasEm} asc nulls first`, asc(pagamentos.aprovadoEm))
    .limit(LEITURAS_DE_CONTESTACAO_POR_VOLTA * 4);
  const naJanela = candidatos.filter((x) => naJanelaTardia(x.p.aprovadoEm!, x.checkout ? instanteLocal(x.checkout, "12:00", FUSO) : null, agora)).slice(0, LEITURAS_DE_CONTESTACAO_POR_VOLTA);
  for (const { p } of naJanela) {
    if (relogio() - inicio >= ORCAMENTO_VOLTA_CONTESTACAO_MS) break;
    const antes = p.contestacoesBuscadasEm;
    const [reservada] = await db
      .update(pagamentos)
      .set({ contestacoesBuscadasEm: agora })
      .where(and(eq(pagamentos.id, p.id), daVez))
      .returning({ id: pagamentos.id });
    if (!reservada) continue;
    resumo.buscados++;
    const devolverAVez = () => db.update(pagamentos).set({ contestacoesBuscadasEm: antes }).where(and(eq(pagamentos.id, p.id), eq(pagamentos.contestacoesBuscadasEm, agora)));
    let lista: Awaited<ReturnType<ProvedorPagamento["buscarContestacoes"]>>;
    try {
      lista = await provedor.buscarContestacoes(p.idPagamentoProvedor!);
    } catch (e) {
      // A busca que falhou não conta: a marca volta ao que era (a próxima volta tenta de novo).
      await devolverAVez();
      if (!(e instanceof ErroProvedor)) throw e;
      resumo.falhas++;
      continue;
    }
    if (semAcessoContestacao(lista)) continue;
    const leituras = lista.filter((caso) => casoDestePagamento(caso, p.idPagamentoProvedor) === "sim").map((caso) => leituraDoCaso(caso, agora));
    if (!leituras.length) continue;
    try {
      const r = await db.transaction(async (tx) => {
        const t = await travarCotacao(tx, p.organizacaoId, p.cotacaoId);
        const pt = t?.tentativas.find((x) => x.id === p.id);
        if (!t || !pt) return null;
        const ef = await aplicarLeiturasDaDisputa(tx, p.organizacaoId, t, pt, leituras, agora, { fonte: "chargebacks", sincronizar: false });
        if (ef.aoVivo && !pt.avisos.includes("ao_vivo")) pt.avisos = [...pt.avisos, "ao_vivo"];
        // Só liga a ambígua (como em `aplicarFontes`): a que a order deu fica até a releitura dela ou o registro da equipe.
        await sincronizarAvisosDaDisputa(tx, t, pt, agora, { ambigua: ef.ambigua === true ? true : null });
        return ef;
      });
      if (r?.mudou) resumo.mudaram++;
      resumo.novas += r?.novas.length ?? 0;
    } catch (e) {
      // A aplicação não aconteceu (trava ocupada, ou outro erro): a vez volta, como na falha do provedor, e a próxima volta
      // lê o caso de novo (nunca uma semana sem a disputa achada).
      await devolverAVez();
      if (!travaOcupada(e)) throw e;
      resumo.falhas++;
    }
  }
  return resumo;
}

/**
 * "Conferir agora" do quadro de um pagamento (M8.2e): só as disputas e a busca daquele pagamento, sem esperar a vez. A order
 * dele é lida por quem chama (`conferirTentativa`) antes.
 */
export async function conferirContestacoesDoPagamento(db: Db, organizacaoId: string, pagamentoId: string, provedor: ProvedorPagamento, agora: Date = new Date()): Promise<ResumoContestacoes> {
  const r = await conferirContestacoes(db, organizacaoId, provedor, agora, { pagamentoId, forcar: true });
  const b = await buscarContestacoesTardias(db, organizacaoId, provedor, agora, { pagamentoId, forcar: true });
  return { ...r, buscados: b.buscados, novas: r.novas + b.novas, falhas: r.falhas + b.falhas, mudaram: r.mudaram + b.mudaram };
}

// ---------------------------------------------------------------- registro pela equipe

/** O formulário "Registrar disputa vista no painel do Mercado Pago" (valores em centavos; datas AAAA-MM-DD). */
export type EntradaRegistroDisputa = {
  tipo: string;
  /** O dia em que a disputa abriu (entre a aprovação e hoje). */
  abertaEm: string;
  valor: number;
  /** O prazo dos documentos (opcional; sem ele, o aviso `contestacao_prazo_desconhecido`). */
  prazo: string | null;
  /** O número do caso (só algarismos, até 20), opcional. */
  idCaso: string | null;
  nota: string;
};

export const TEXTO_MED_SO_NO_PIX = "O MED (devolução pedida pelo Pix) só existe num pagamento por Pix.";
export const TEXTO_SEM_DINHEIRO_PARA_DISPUTA = "Só um pagamento com dinheiro (aprovado, devolvido ou contestado) pode ter disputa registrada.";

/** As conferências do formulário, antes de qualquer trava ou chamada; devolve o erro, ou os valores prontos. */
function conferirEntrada(p: Pagamento, e: EntradaRegistroDisputa, agora: Date): { ok: true; tipo: TipoContestacao; nota: string; prazo: Date | null; idCaso: string | null } | { ok: false; erro: string } {
  if (!(TIPOS_CONTESTACAO as readonly string[]).includes(e.tipo)) return { ok: false, erro: "Escolha o tipo da disputa." };
  const tipo = e.tipo as TipoContestacao;
  if (tipo === "med" && p.forma !== "pix") return { ok: false, erro: TEXTO_MED_SO_NO_PIX };
  if (!comDinheiro(p.situacao)) return { ok: false, erro: TEXTO_SEM_DINHEIRO_PARA_DISPUTA };
  const hoje = hojeISO(FUSO, agora);
  const desde = hojeISO(FUSO, p.aprovadoEm ?? p.criadoEm);
  if (!dataValida(e.abertaEm) || e.abertaEm < desde || e.abertaEm > hoje) return { ok: false, erro: `Informe o dia em que a disputa abriu (de ${dataBr(desde)} até hoje).` };
  const pago = valorPagoAprovado(p);
  if (!Number.isSafeInteger(e.valor) || e.valor < 1 || e.valor > pago) return { ok: false, erro: `Informe o valor em disputa (de R$ 0,01 até o pago).` };
  if (e.prazo !== null && !dataValida(e.prazo)) return { ok: false, erro: "Prazo dos documentos inválido." };
  const idCaso = e.idCaso?.trim() || null;
  if (idCaso !== null && !ID_NUMERICO_PROVEDOR.test(idCaso)) return { ok: false, erro: "O número do caso tem só algarismos (até 20)." };
  const nota = e.nota.trim();
  if (!nota) return { ok: false, erro: "Escreva a nota (o que foi visto no painel do Mercado Pago)." };
  if (nota.length > LIMITE_NOTA_CONTESTACAO) return { ok: false, erro: `A nota passa de ${LIMITE_NOTA_CONTESTACAO} caracteres.` };
  if (textoSemDadosPessoais(nota) === null) return { ok: false, erro: ERRO_DADOS_PESSOAIS };
  return { ok: true, tipo, nota, prazo: e.prazo ? instanteLocal(e.prazo, "23:59", FUSO) : null, idCaso };
}

/**
 * "Registrar disputa vista no painel do Mercado Pago" (`financeiro:editar`, conferido por quem chama), no quadro do
 * pagamento. O id do pagamento é resolvido com o filtro da organização antes de qualquer trava.
 * - Fase 0 (sem trava, melhor esforço): relê a order e a Chargebacks API (o caso informado, que precisa ser deste pagamento;
 *   sem ele, a busca pelo número). Falhou, ou sem provedor: segue, com "sem leitura do Mercado Pago" na nota.
 * - Fase 1, sob a trava: aplica o que a fase 0 leu e casa de novo (a rotina pode ter criado a linha no meio): o Mercado
 *   Pago já mostra esta disputa = recusa ("ela está no quadro"); o índice único violado responde o mesmo, nunca o erro cru.
 *   A linha nasce `aberta`, origem `equipe`, com o prazo (ou o aviso de prazo desconhecido) e a nota; outra disputa não
 *   final no pagamento = possível duplicata.
 * - MED (só no Pix) e reclamação que a leitura já mostra como devolução: o retido nasce realizado no dia em que a leitura a
 *   viu, e o D21 passa a contar a disputa como explicação (nunca grava o "devolvido fora" reconhecido).
 * `o.correio`: o e-mail à equipe da abertura, depois da transação.
 */
export async function registrarContestacaoDaEquipe(
  db: Db,
  organizacaoId: string,
  pagamentoId: string,
  e: EntradaRegistroDisputa,
  autorId: string | null,
  provedor: ProvedorPagamento | null,
  agora: Date = new Date(),
  o: { correio?: Correio | null; linkPainel?: string } = {},
): Promise<ResultadoContestacao> {
  const alvo = await pagamentoDaOrganizacao(db, organizacaoId, pagamentoId);
  if (!alvo) return { ok: false, erro: "Pagamento não encontrado." };
  const [p0] = await db.select().from(pagamentos).where(eq(pagamentos.id, alvo.pagamentoId));
  const conferida = conferirEntrada(p0, e, agora);
  if (!conferida.ok) return conferida;
  // Fase 0: a releitura, fora de transação e sem trava.
  let semLeitura = !provedor;
  const leituras: LeituraDeContestacao[] = [];
  if (provedor) {
    try {
      if (p0.idProvedor && p0.criadoEm.getTime() >= inicioDoPrazoDeReleitura(agora).getTime()) {
        const r = await conferirTentativa(db, organizacaoId, p0.id, provedor, agora, { forcar: true, origem: "painel" });
        if (!r.ok) semLeitura = true;
      }
      const [p1] = await db.select().from(pagamentos).where(eq(pagamentos.id, p0.id));
      if (conferida.idCaso) {
        const caso = await provedor.consultarContestacao(conferida.idCaso);
        if (semAcessoContestacao(caso)) semLeitura = true;
        else if (caso) {
          const deste = casoDestePagamento(caso, p1.idPagamentoProvedor);
          if (deste === "outro") return { ok: false, erro: TEXTO_CASO_DE_OUTRO_PAGAMENTO };
          if (deste === "sim") leituras.push(leituraDoCaso(caso, agora));
        }
      } else if (p1.idPagamentoProvedor) {
        const lista = await provedor.buscarContestacoes(p1.idPagamentoProvedor);
        if (semAcessoContestacao(lista)) semLeitura = true;
        else for (const caso of lista) if (casoDestePagamento(caso, p1.idPagamentoProvedor) === "sim") leituras.push(leituraDoCaso(caso, agora));
      } else semLeitura = true;
    } catch (erro) {
      // Melhor esforço: a falha do provedor e a trava da cotação ocupada (a releitura da order não aplicou) seguem sem a leitura.
      if (!(erro instanceof ErroProvedor) && !travaOcupada(erro)) throw erro;
      semLeitura = true;
    }
  }
  const nota = semLeitura ? `${conferida.nota} (${NOTA_SEM_LEITURA})` : conferida.nota;
  let r: ResultadoContestacao;
  try {
    r = await db.transaction(async (tx): Promise<ResultadoContestacao> => {
      const t = await travarCotacao(tx, organizacaoId, alvo.cotacaoId);
      const p = t?.tentativas.find((x) => x.id === alvo.pagamentoId);
      if (!t || !p) return { ok: false, erro: "Pagamento não encontrado." };
      const deNovo = conferirEntrada(p, e, agora);
      if (!deNovo.ok) return deNovo;
      if (leituras.length) await aplicarLeiturasDaDisputa(tx, organizacaoId, t, p, leituras, agora, { fonte: "chargebacks", sincronizar: false });
      const daEquipe: LeituraDeContestacao = { fonte: "equipe", idCaso: conferida.idCaso, idContestacao: null, estadoLido: null, coberturaAplicada: null, valor: e.valor, lidaEm: agora, atualizadoNoProvedorEm: null };
      const casou = casarContestacao([daEquipe], contestacoesDoPagamento(t, p.id));
      if (casou.existentes.length || !casou.novas.length) {
        await sincronizarAvisosDaDisputa(tx, t, p, agora);
        return { ok: false, erro: TEXTO_DISPUTA_JA_NO_QUADRO };
      }
      const n = casou.novas[0];
      const ctx = contextoDaNova(t, p.id);
      const devs = devolucoesDoPagamento(t, p.id);
      const dados = novaContestacao({
        origem: "equipe",
        tipo: conferida.tipo,
        forma: p.forma,
        leituras: [daEquipe],
        identificacao: n.identificacao,
        duplicataPossivel: n.duplicataPossivel,
        pagamento: { situacao: p.situacao, devolvidoLido: p.devolvidoLido, pago: valorPagoAprovado(p), valor: p.valor, tresDSStatus: p.tresDSStatus },
        deOutraNaoFinal: ctx.deOutraNaoFinal,
        outras: ctx.outras,
        comDevolucaoRealizada: p.devolvidoForaReconhecido > 0 || p.situacao === "devolvido" || devs.some((d) => d.situacao === "confirmada" || d.situacao === "por_fora"),
        equipe: { valor: e.valor, prazo: conferida.prazo },
        agora,
      });
      // O MED e a reclamação que a leitura já mostra como devolução (o D21 sem a disputa): o dinheiro já saiu.
      const devolucaoLida = (conferida.tipo === "med" || conferida.tipo === "reclamacao") && devolucaoInexplicada(p, devs);
      let linha: Contestacao;
      try {
        linha = await tx.transaction((sp) =>
          criarLinha(
            sp,
            organizacaoId,
            t,
            p,
            { ...dados, abertaNoProvedorEm: dados.abertaNoProvedorEm ?? instanteLocal(e.abertaEm, "12:00", FUSO), notaRegistro: nota, proximaLeituraEm: agora },
            agora,
            { fonte: "equipe", usuarioId: autorId },
          ),
        );
      } catch (erro) {
        if (violouUnicidade(erro)) return { ok: false, erro: TEXTO_DISPUTA_JA_NO_QUADRO };
        throw erro;
      }
      let retidoLido: number | null = null;
      if (devolucaoLida) {
        await recalcularDisputas(tx, organizacaoId, t, p, agora, { semCaixa: true });
        retidoLido = await lancarRetidoRealizado(tx, organizacaoId, t, p, linha, agora);
      }
      await recalcularDisputas(tx, organizacaoId, t, p, agora);
      // D21: o MED e a reclamação explicam a devolução lida; o aviso `devolvido_por_fora` sai quando nada mais fica sem explicação.
      if (p.avisos.includes("devolvido_por_fora") && !devolucaoInexplicada(p, devs, devolvidoPelaDisputa(t, p.id))) p.avisos = p.avisos.filter((a) => a !== "devolvido_por_fora");
      await sincronizarAvisosDaDisputa(tx, t, p, agora, { ambigua: false });
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autorId,
        acao: "contestacao.registrar",
        entidade: "pagamento",
        entidadeId: p.id,
        mudancas: { contestacao: [null, linha.id], tipo: [null, linha.tipo], valor: [null, e.valor], abertaEm: [null, e.abertaEm], prazo: [null, e.prazo], idCaso: [null, linha.idCaso], duplicataPossivel: [null, linha.duplicataPossivel], semLeitura: [null, semLeitura] },
      });
      // O MED (ou a reclamação) registrado acima do que o Mercado Pago mostra devolvido: o caixa registra só o devolvido lido.
      const mensagem = linha.duplicataPossivel
        ? "Registrada como possível duplicata de outra disputa do pagamento: confirme que é outra disputa no quadro."
        : retidoLido !== null && retidoLido < linha.valorEmRisco
          ? textoRetidoMenorQueOMed(retidoLido, linha.valorEmRisco)
          : null;
      return { ok: true, contestacaoId: linha.id, ...(mensagem ? { mensagem } : {}) };
    });
  } catch (erro) {
    if (travaOcupada(erro)) return { ok: false, erro: TEXTO_OCUPADO_CONTESTACAO };
    throw erro;
  }
  if (r.ok && o.correio !== undefined) await avisarEquipeDasContestacoes(db, organizacaoId, o.correio, agora, { pagamentoId: alvo.pagamentoId, linkPainel: o.linkPainel }).catch(() => 0);
  return r;
}

// ---------------------------------------------------------------- e-mails à equipe

type MomentoDoEmail = "abertura" | "prazo_aviso" | "prazo_dia";

/** O e-mail à equipe de uma disputa (puro): só o código da reserva (ou "pagamento sem reserva") e o imóvel; nunca o hóspede. */
export function mensagemDaDisputa(
  d: { tipo: TipoContestacao; abertaEm: Date; reservaCodigo: string | null; imovel: string; prazo: Date | null },
  momento: MomentoDoEmail,
  agora: Date,
  linkPainel?: string,
): { assunto: string; texto: string } {
  const qual = d.reservaCodigo ? `reserva ${d.reservaCodigo}` : "pagamento do site sem reserva";
  const onde = `${qual} (${d.imovel})`;
  const veja = linkPainel ? ` Veja no painel: ${linkPainel}.` : ' Veja no quadro "Pagamento no site" da reserva.';
  if (momento === "abertura")
    return {
      assunto: `Disputa do pagamento: ${qual}`,
      texto: `${NOMES_TIPO_CONTESTACAO[d.tipo]} no pagamento da ${onde}, aberta em ${diaMes(d.abertaEm)}.${veja}\n`,
    };
  const prazo = d.prazo ? hojeISO(FUSO, d.prazo) : hojeISO(FUSO, agora);
  const hoje = hojeISO(FUSO, agora);
  const faltam = Math.round((Date.parse(`${prazo}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / DIA_MS);
  const quando = faltam > 0 ? `documentos até ${dataBr(prazo)} (faltam ${faltam} dia${faltam === 1 ? "" : "s"})` : faltam === 0 ? `o prazo dos documentos é hoje (${dataBr(prazo)})` : `o prazo dos documentos passou em ${dataBr(prazo)}`;
  return {
    assunto: `Disputa do pagamento: ${qual} — documentos`,
    texto: `Disputa do pagamento da ${onde}: ${quando}. Envie os documentos pelo painel do Mercado Pago e marque "Documentos enviados" no quadro da disputa.${veja}\n`,
  };
}

/**
 * Os e-mails à equipe (`avisarEquipePorEmail`, o mesmo do pedido de cancelamento): na abertura da disputa (leitura ou
 * registro), ao entrar nos dias de aviso do prazo dos documentos (Configurações → Pagamento no site) e no dia do prazo sem a
 * marca "Documentos enviados". Uma vez cada: o envio usa uma chave fixa por momento e o evento `email_equipe` é gravado sob
 * a trava depois de enviado. Sem correio, nada. Devolve quantos foram enviados.
 */
export async function avisarEquipeDasContestacoes(
  db: Db,
  organizacaoId: string | null,
  correio: Correio | null,
  agora: Date = new Date(),
  o: { pagamentoId?: string; linkPainel?: string } = {},
): Promise<number> {
  if (!correio) return 0;
  const linhas = await db
    .select({ l: contestacoesPagamento, cotacaoId: pagamentos.cotacaoId, reservaCodigo: reservas.codigo, imovel: imoveis.nome })
    .from(contestacoesPagamento)
    .innerJoin(pagamentos, eq(pagamentos.id, contestacoesPagamento.pagamentoId))
    .innerJoin(imoveis, eq(imoveis.id, contestacoesPagamento.imovelId))
    .leftJoin(reservas, eq(reservas.id, contestacoesPagamento.reservaId))
    .where(
      and(
        inArray(contestacoesPagamento.situacao, ["aberta", "a_confirmar"]),
        organizacaoId ? eq(contestacoesPagamento.organizacaoId, organizacaoId) : undefined,
        o.pagamentoId ? eq(contestacoesPagamento.pagamentoId, o.pagamentoId) : undefined,
      ),
    );
  if (!linhas.length) return 0;
  const enviados = await db
    .select({ contestacaoId: eventosContestacao.contestacaoId, depois: eventosContestacao.depois })
    .from(eventosContestacao)
    .where(and(eq(eventosContestacao.tipo, "email_equipe"), inArray(eventosContestacao.contestacaoId, linhas.map((x) => x.l.id))));
  const jaFoi = (id: string, m: MomentoDoEmail) => enviados.some((x) => x.contestacaoId === id && x.depois?.momento === m);
  const diasDeAviso = new Map<string, number>();
  const hoje = hojeISO(FUSO, agora);
  let n = 0;
  for (const { l, cotacaoId, reservaCodigo, imovel } of linhas) {
    if (!diasDeAviso.has(l.organizacaoId)) diasDeAviso.set(l.organizacaoId, (await lerConfigPagamentoSite(db, l.organizacaoId)).diasAvisoDocumentacao);
    const momentos: MomentoDoEmail[] = [];
    if (!jaFoi(l.id, "abertura")) momentos.push("abertura");
    if (l.documentacaoPrazo && !l.documentosEnviadosEm) {
      const prazo = hojeISO(FUSO, l.documentacaoPrazo);
      const faltam = Math.round((Date.parse(`${prazo}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / DIA_MS);
      if (faltam <= 0 && !jaFoi(l.id, "prazo_dia")) momentos.push("prazo_dia");
      else if (faltam > 0 && faltam <= diasDeAviso.get(l.organizacaoId)! && !jaFoi(l.id, "prazo_aviso")) momentos.push("prazo_aviso");
    }
    for (const momento of momentos) {
      const m = mensagemDaDisputa({ tipo: l.tipo, abertaEm: l.abertaEm, reservaCodigo, imovel, prazo: l.documentacaoPrazo }, momento, agora, o.linkPainel);
      const res = await avisarEquipePorEmail(db, l.organizacaoId, correio, { ...m, chave: `contestacao:${l.id}:email:${momento}`, rotulo: "disputa do pagamento" });
      if (res !== "enviado") continue;
      n++;
      try {
        await db.transaction(async (tx) => {
          const t = await travarCotacao(tx, l.organizacaoId, cotacaoId);
          if (!t?.contestacoes.some((x) => x.id === l.id)) return;
          const [ja] = await tx
            .select({ id: eventosContestacao.id })
            .from(eventosContestacao)
            .where(and(eq(eventosContestacao.contestacaoId, l.id), eq(eventosContestacao.tipo, "email_equipe"), sql`${eventosContestacao.depois} ->> 'momento' = ${momento}`))
            .limit(1);
          if (!ja) await registrarEventoDaContestacao(tx, l.id, { fonte: "sistema", tipo: "email_equipe", depois: { momento } }, agora);
        });
      } catch (e) {
        // O e-mail saiu (a chave evita repetir no provedor); o registro fica para a próxima volta.
        if (!travaOcupada(e)) throw e;
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------- as ações da equipe: o comum

export const TEXTO_DISPUTA_NAO_ENCONTRADA = "Disputa não encontrada.";
export const TEXTO_DUPLICATA_SEM_DECIDIR = "Esta disputa pode ser a mesma de outra do quadro: confirme que é outra disputa (ou encerre sem efeito) antes de decidir ou de confirmar o débito.";
export const TEXTO_SEM_DECISAO_PARA_MUDAR = "Esta disputa ainda não tem decisão de quem arca: registre quem arca.";
export const TEXTO_VALOR_SEGURADO_EM_DIA = "O valor segurado já é o valor em disputa de agora: nada a atualizar.";
export const TEXTO_DEBITO_DEPOIS_DO_RESULTADO = "A disputa já terminou: o dia e o valor do débito entram na confirmação do resultado.";
export const TEXTO_NOTA_DO_DEBITO = "O valor debitado é diferente do valor em risco: escreva a nota (o que o painel do Mercado Pago mostra).";
/** O MED (ou a reclamação) registrado acima do devolvido que o Mercado Pago mostra: o caixa fica no que de fato saiu. */
export const textoRetidoMenorQueOMed = (lido: number, registrado: number) =>
  `O Mercado Pago mostra ${formatBRL(lido)} devolvidos ao pagador, menos que o valor registrado (${formatBRL(registrado)}): o caixa registra ${formatBRL(lido)}; o resto entra no caixa final da disputa, se o Mercado Pago debitar.`;
/** "Perdeu" sem recebimento em vigor e com o sinal de liberação do Mercado Pago: a liberação se registra antes. */
export const TEXTO_LIBERACAO_ANTES_DA_PERDA =
  "O Mercado Pago mostra a liberação deste pagamento: registre a liberação à mão (o líquido que caiu na conta) antes de confirmar a perdida.";
/** "Perdeu" numa disputa de parte do valor sem recebimento em vigor: o resto do pagamento entra pela liberação, que se registra antes. */
export const TEXTO_LIBERACAO_ANTES_DA_PERDA_PARCIAL =
  "A disputa é de parte do valor e a liberação deste pagamento ainda não está registrada: registre a liberação à mão (o líquido que caiu na conta) antes de confirmar a perdida.";
/** Pagamento sem reserva: o valor perdido acima da taxa do pagamento. */
export const textoPerdaSemReservaAcimaDaTaxa = (v: number, teto: number) =>
  `Pagamento sem reserva: o dinheiro dele nunca entrou no livro e o que a SCL perde é a taxa do pagamento (até ${formatBRL(teto)}). ${formatBRL(v)} passa disso: confira o valor (quase sempre é digitação).`;
export const TEXTO_NOTA_DA_TAXA_SEM_RESERVA =
  "Pagamento sem reserva com a taxa do pagamento desconhecida: escreva na nota a taxa que o painel do Mercado Pago mostra (é o que a SCL perde).";
/** "Conferir o aviso → reaberta" com outra disputa sem número aberta no pagamento. */
export const textoOutraDisputaSemNumero = (abertaEm: Date) =>
  `Há outra disputa sem número aberta neste pagamento (aberta em ${diaMes(abertaEm)}): se ela é esta reabertura, siga por ela; senão, encerre-a sem efeito antes de reabrir.`;
export const TEXTO_RODADA_JA_NO_QUADRO = "A rodada seguinte desta disputa já está no quadro.";
export const TEXTO_NOTA_DO_RESULTADO = "Escreva a nota: o resultado ou o valor diferem do que o Mercado Pago mostra, ou ele não mostra o resultado (confirme pelo painel dele).";

type Recusa = { ok: false; erro: string; codigo: string };
const recusada = (erro: string, codigo = "dados"): Recusa => ({ ok: false, erro, codigo });
const diaDe = (d: Date) => hojeISO(FUSO, d);
/** dd/mm/aaaa de uma data AAAA-MM-DD. */
const dataCompleta = (d: string) => d.split("-").reverse().join("/");

/**
 * O primeiro dia possível do débito da disputa: o da abertura no Mercado Pago (o caso, ou o dia que a equipe registrou),
 * nunca antes da aprovação. Sem a abertura no provedor (a leitura só da order), a aprovação: o dia em que o sistema viu a
 * disputa pode vir depois do débito.
 */
function desdeAberturaDaDisputa(p: Pick<Pagamento, "aprovadoEm" | "criadoEm">, l: Pick<Contestacao, "abertaNoProvedorEm">): string {
  const aprovacao = diaDe(p.aprovadoEm ?? p.criadoEm);
  const abertura = l.abertaNoProvedorEm ? diaDe(l.abertaNoProvedorEm) : null;
  return abertura && abertura > aprovacao ? abertura : aprovacao;
}

/** O primeiro dia possível da volta do dinheiro debitado: o do débito (o do retido realizado), nunca antes da abertura. */
function desdeODebito(p: Pick<Pagamento, "aprovadoEm" | "criadoEm">, l: Pick<Contestacao, "abertaNoProvedorEm" | "debitoEm">, dataDoRetido: string | null): string {
  const desde = desdeAberturaDaDisputa(p, l);
  const debito = l.debitoEm ?? dataDoRetido;
  return debito && debito > desde ? debito : desde;
}

/** Nota de uma ação da disputa (até 300, sem dado pessoal; obrigatória quando pedida). */
function conferirNota(nota: string | undefined, obrigatoria: boolean, faltando = "Escreva a nota (sem dados pessoais)."): { ok: true; nota: string } | Recusa {
  const n = (nota ?? "").trim();
  if (obrigatoria && !n) return recusada(faltando);
  if (n.length > LIMITE_NOTA_CONTESTACAO) return recusada(`A nota passa de ${LIMITE_NOTA_CONTESTACAO} caracteres.`);
  if (n && textoSemDadosPessoais(n) === null) return recusada(ERRO_DADOS_PESSOAIS);
  return { ok: true, nota: n };
}

/** Uma data AAAA-MM-DD entre `desde` e hoje (em São Paulo), ou o erro com o texto dado. */
function conferirData(d: string | null | undefined, desde: string, agora: Date, oQue: string): { ok: true; data: string } | Recusa {
  if (!d || !dataValida(d)) return recusada(`Informe ${oQue}.`);
  const hoje = diaDe(agora);
  if (d > hoje) return recusada(`${oQue[0].toUpperCase()}${oQue.slice(1)} não pode ser no futuro.`);
  if (d < desde) return recusada(`${oQue[0].toUpperCase()}${oQue.slice(1)} não pode ser antes de ${dataCompleta(desde)}.`);
  return { ok: true, data: d };
}

/**
 * Uma ação da equipe numa disputa, sob a trava da cotação (a ordem única), com o retrato (a linha e o pagamento) e, no fim,
 * a união dos avisos no pagamento. O id já foi resolvido com o filtro da organização antes de qualquer trava
 * (`contestacaoDaOrganizacao`). Uma recusa no meio (`RecusaDaContestacao`) desfaz tudo; trava ocupada = "ocupado".
 */
async function naDisputa(
  db: Db,
  organizacaoId: string,
  alvo: { cotacaoId: string; pagamentoId: string; contestacaoId: string },
  agora: Date,
  f: (tx: Db, t: Travado, p: Pagamento, l: Contestacao) => Promise<ResultadoContestacao>,
): Promise<ResultadoContestacao> {
  try {
    return await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, alvo.cotacaoId);
      const p = t?.tentativas.find((x) => x.id === alvo.pagamentoId);
      const l = t?.contestacoes.find((x) => x.id === alvo.contestacaoId);
      if (!t || !p || !l) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
      const r = await f(tx, t, p, l);
      if (r.ok) await sincronizarAvisosDaDisputa(tx, t, p, agora);
      return r;
    });
  } catch (e) {
    if (e instanceof RecusaDaContestacao) return recusada(e.erro, e.codigo ?? "dados");
    if (travaOcupada(e)) return recusada(TEXTO_OCUPADO_CONTESTACAO, "ocupado");
    throw e;
  }
}

/** Grava campos da linha (sob a trava) e o retrato junto. */
async function gravarLinha(tx: Db, l: Contestacao, mudanca: Partial<typeof contestacoesPagamento.$inferInsert>, agora: Date): Promise<void> {
  const m = { ...mudanca, atualizadoEm: agora };
  await tx.update(contestacoesPagamento).set(m).where(eq(contestacoesPagamento.id, l.id));
  Object.assign(l, m);
}

/** As devoluções do pagamento substituídas por esta disputa (o vínculo `contestacao_id`), em ordem de id. */
const substituidasPor = (t: Pick<Travado, "devolucoes">, p: Pick<Pagamento, "id">, l: Pick<Contestacao, "id">) => devolucoesDoPagamento(t, p.id).filter((d) => d.contestacaoId === l.id);

/**
 * A disputa terminou sem o dinheiro voltar ao hóspede por ela (ganha, ou encerrada sem efeito): com todas as disputas do
 * pagamento `ganha` ou `sem_efeito`, o pagamento volta a `situacao_pagamento_antes` — só se ainda estiver `contestado` (uma
 * devolução aceita que se confirmou no meio já o levou a `devolvido`). Auditado (`pagamento.situacao`).
 */
async function voltarASituacaoDeAntes(tx: Db, organizacaoId: string, t: Travado, p: Pagamento, l: Contestacao, motivo: "contestacao_ganha" | "contestacao_sem_efeito", autorId: string | null, agora: Date): Promise<void> {
  if (p.situacao !== "contestado" || !contestacoesDoPagamento(t, p.id).every((x) => x.situacao === "ganha" || x.situacao === "sem_efeito")) return;
  const situacao = l.situacaoPagamentoAntes;
  await tx.update(pagamentos).set({ situacao, atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
  await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.situacao", entidade: "pagamento", entidadeId: p.id, mudancas: { situacao: [p.situacao, situacao], motivo: [null, motivo] } });
  p.situacao = situacao;
}

/**
 * Fase 0 das ações de resultado (sem trava, melhor esforço): relê a disputa como a rotina (a order nos 85 dias, a Chargebacks
 * API pelo caso ou pela busca do pagamento, a Payments API depois dos 85 dias) e aplica sob a trava. `lida`: alguma fonte
 * respondeu sem falha; `emDisputa`: uma leitura de agora mostra esta disputa em andamento (`in_process` do mesmo caso, ou o
 * caso ainda sem cobertura) — o resultado e o "sem efeito" pedem então a nota reforçada. Sem provedor (trava fechada):
 * nada lido.
 */
async function releituraDaDisputa(db: Db, alvo: { pagamentoId: string; contestacaoId: string }, provedor: ProvedorPagamento | null, agora: Date): Promise<{ lida: boolean; emDisputa: boolean }> {
  if (!provedor) return { lida: false, emDisputa: false };
  const [x] = await db.select({ l: contestacoesPagamento, p: pagamentos }).from(contestacoesPagamento).innerJoin(pagamentos, eq(pagamentos.id, contestacoesPagamento.pagamentoId)).where(eq(contestacoesPagamento.id, alvo.contestacaoId));
  if (!x || !contestacaoNaoFinal(x.l.situacao)) return { lida: false, emDisputa: false };
  const lido = await lerFontes(db, provedor, x.p, [x.l], agora, { order: true, buscar: !x.l.idCaso });
  try {
    await aplicarFontes(db, x.p, [x.l.id], lido, agora);
  } catch (e) {
    if (!travaOcupada(e)) throw e;
    return { lida: false, emDisputa: false };
  }
  const [depois] = await db.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.id, x.l.id));
  const pelaOrder = lido.orderLida && depois?.lidaEm?.getTime() === agora.getTime() && depois.estadoLido === "in_process";
  // O caso ainda sem cobertura só conta com a linha ainda aberta: depois de outra fonte mostrar a disputa encerrada (a linha
  // a confirmar), ele não diz que ela continua em andamento.
  const peloCaso =
    depois?.situacao === "aberta" && lido.leituras.some((y) => y.fonte === "chargebacks" && (x.l.idCaso === null || y.idCaso === x.l.idCaso) && leituraEmDisputa(y, x.l.coberturaAplicada !== null));
  const pelaSituacao = lido.leituras.some((y) => y.fonte === "payments" && y.estadoLido === "in_process");
  return { lida: !lido.falhou && (lido.orderLida || lido.util), emDisputa: pelaOrder || peloCaso || pelaSituacao };
}

// ---------------------------------------------------------------- confirmar o débito, documentos, prazo, outra disputa

/** "Confirmar o débito do Mercado Pago": o dia e o valor que ele debitou (nota quando o valor difere do valor em risco). */
export type EntradaDebito = { data: string; valor: number; nota: string };

/**
 * "Confirmar o débito do Mercado Pago" (`financeiro:editar`, conferido por quem chama), com a disputa `aberta` ou
 * `a_confirmar`: o retido vira realizado na data e no valor confirmados (a prevista é estornada e nasce a realizada `#N`,
 * com competência = data de caixa = o dia do débito; `lancarContestacao`, momento `debito`). Data entre a aprovação e hoje;
 * valor até o pago. Uma vez (o MED lido como devolução já nasce realizado). No pagamento sem reserva (o dinheiro dele nunca
 * entrou no livro), só a data e a marca. A nota é conferida (sem dado pessoal) e gravada na linha (`debito_nota`); a
 * auditoria fica com os valores.
 */
export async function confirmarDebito(db: Db, organizacaoId: string, contestacaoId: string, e: EntradaDebito, autorId: string | null, agora: Date = new Date()): Promise<ResultadoContestacao> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  return naDisputa(db, organizacaoId, alvo, agora, async (tx, t, p, l) => {
    if (!contestacaoNaoFinal(l.situacao)) return recusada(TEXTO_DEBITO_DEPOIS_DO_RESULTADO, "nao_permitida");
    if (l.duplicataPossivel) return recusada(TEXTO_DUPLICATA_SEM_DECIDIR, "duplicata");
    if (l.retidoConfirmadoEm) return recusada(TEXTO_DEBITO_JA_CONFIRMADO, "nao_permitida");
    const data = conferirData(e.data, desdeAberturaDaDisputa(p, l), agora, "o dia em que o Mercado Pago debitou");
    if (!data.ok) return data;
    const pago = valorPagoAprovado(p);
    if (!Number.isSafeInteger(e.valor) || e.valor < 1 || e.valor > pago) return recusada(`Informe o valor debitado (de R$ 0,01 até o pago, ${formatBRL(pago)}).`);
    const nota = conferirNota(e.nota, e.valor !== l.valorEmRisco, TEXTO_NOTA_DO_DEBITO);
    if (!nota.ok) return nota;
    const antes = { retidoConfirmadoEm: null, valorEmRisco: l.valorEmRisco };
    await lancarContestacao(tx, organizacaoId, t, p, l, { tipo: "debito", data: data.data, valor: e.valor }, autorId, agora);
    // A nota fica na linha (o quadro a mostra a quem lê o financeiro); o evento e a auditoria levam só o dia e o valor.
    if (nota.nota) await gravarLinha(tx, l, { debitoNota: nota.nota }, agora);
    await registrarEventoDaContestacao(tx, l.id, { fonte: "equipe", tipo: "debito_confirmado", antes, depois: { valor: e.valor, data: data.data }, usuarioId: autorId }, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "contestacao.debito", entidade: "pagamento", entidadeId: p.id, mudancas: { contestacao: [null, l.id], valor: [l.valorEmRisco, e.valor], data: [null, data.data] } });
    return { ok: true, contestacaoId: l.id };
  });
}

/**
 * "Documentos enviados no painel do Mercado Pago" (`reserva:editar` ou `financeiro:editar`, conferido por quem chama): a
 * data do envio (entre a aprovação e hoje), com a disputa ainda não final. Uma vez; auditado (`contestacao.documentos`).
 */
export async function marcarDocumentosEnviados(db: Db, organizacaoId: string, contestacaoId: string, e: { data: string }, autorId: string | null, agora: Date = new Date()): Promise<ResultadoContestacao> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  return naDisputa(db, organizacaoId, alvo, agora, async (tx, t, p, l) => {
    if (!contestacaoNaoFinal(l.situacao)) return recusada(TEXTO_DISPUTA_JA_TERMINOU, "nao_permitida");
    if (l.documentosEnviadosEm) return recusada(`Os documentos já foram marcados como enviados em ${diaMes(l.documentosEnviadosEm)}.`, "nao_permitida");
    const data = conferirData(e.data, diaDe(p.aprovadoEm ?? p.criadoEm), agora, "o dia em que os documentos foram enviados");
    if (!data.ok) return data;
    await gravarLinha(tx, l, { documentosEnviadosEm: instanteLocal(data.data, "12:00", FUSO), documentosEnviadosPor: autorId }, agora);
    await registrarEventoDaContestacao(tx, l.id, { fonte: "equipe", tipo: "documentos_enviados", depois: { data: data.data }, usuarioId: autorId }, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "contestacao.documentos", entidade: "pagamento", entidadeId: p.id, mudancas: { contestacao: [null, l.id], documentosEnviadosEm: [null, data.data] } });
    return { ok: true, contestacaoId: l.id };
  });
}

/**
 * O prazo dos documentos informado pela equipe (`financeiro:editar`), quando a leitura não o trouxe ou o registro não o
 * tinha: o aviso `contestacao_prazo_desconhecido` sai. A data (a partir da abertura) vale até as 23h59 em São Paulo.
 * Auditado (`contestacao.prazo`).
 */
export async function informarPrazoDocumentos(db: Db, organizacaoId: string, contestacaoId: string, e: { prazo: string }, autorId: string | null, agora: Date = new Date()): Promise<ResultadoContestacao> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  return naDisputa(db, organizacaoId, alvo, agora, async (tx, t, p, l) => {
    if (!contestacaoNaoFinal(l.situacao)) return recusada(TEXTO_DISPUTA_JA_TERMINOU, "nao_permitida");
    const desde = diaDe(l.abertaNoProvedorEm ?? l.abertaEm);
    if (!e.prazo || !dataValida(e.prazo) || e.prazo < desde) return recusada(`Informe o prazo dos documentos (a partir de ${dataCompleta(desde)}).`);
    const antes = l.documentacaoPrazo ? diaDe(l.documentacaoPrazo) : null;
    await gravarLinha(tx, l, { documentacaoPrazo: instanteLocal(e.prazo, "23:59", FUSO) }, agora);
    await trocarAvisosDaContestacao(tx, l, { desligar: ["contestacao_prazo_desconhecido"] }, agora);
    await registrarEventoDaContestacao(tx, l.id, { fonte: "equipe", tipo: "prazo", antes: { prazo: antes }, depois: { prazo: e.prazo }, usuarioId: autorId }, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "contestacao.prazo", entidade: "pagamento", entidadeId: p.id, mudancas: { contestacao: [null, l.id], prazo: [antes, e.prazo] } });
    return { ok: true, contestacaoId: l.id };
  });
}

/**
 * "Confirmar que é outra disputa" (`financeiro:editar`), numa possível duplicata: ela passa a valer (valor em risco, retido
 * previsto, as devoluções que ainda caibam substituídas), sem nunca passar do pago com as outras. Auditado
 * (`contestacao.outra_disputa`).
 */
export async function confirmarOutraDisputa(db: Db, organizacaoId: string, contestacaoId: string, autorId: string | null, agora: Date = new Date()): Promise<ResultadoContestacao> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  return naDisputa(db, organizacaoId, alvo, agora, async (tx, t, p, l) => {
    const tr = transicaoDaContestacao(l, { tipo: "outra_disputa", em: agora });
    if (!tr.ok) return recusada(tr.erro, tr.codigo);
    if (tr.descartada) return recusada(TEXTO_NAO_E_DUPLICATA, "nao_permitida");
    await gravarLinha(tx, l, { duplicataPossivel: tr.duplicataPossivel, avisos: tr.avisos, confirmadaOutraEm: agora, confirmadaOutraPor: autorId }, agora);
    for (const ev of tr.eventos) await registrarEventoDaContestacao(tx, l.id, { fonte: "equipe", tipo: ev.tipo, antes: ev.antes, depois: ev.depois, usuarioId: autorId }, agora);
    await substituirDevolucoes(tx, organizacaoId, t, p, l, agora, autorId);
    await recalcularDisputas(tx, organizacaoId, t, p, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "contestacao.outra_disputa", entidade: "pagamento", entidadeId: p.id, mudancas: { contestacao: [null, l.id], duplicataPossivel: [true, false], valorEmRisco: [0, l.valorEmRisco] } });
    return { ok: true, contestacaoId: l.id };
  });
}

// ---------------------------------------------------------------- quem arca: a decisão da equipe

/** Uma opção de quem arca: os dois valores (`divisaoDaDecisao`) e a assinatura das entradas (`assinaturaDaDecisao`). */
export type OpcaoDaDecisao = { proprietario: number; scl: number; assinatura: string };

/**
 * Os fatos da decisão de uma disputa (a prévia e a ação leem daqui): o valor que se divide (o valor em risco, ou a perda a
 * dividir da perdida), as partes efetivas de agora (D, C, quem recebe a parte), a base congelada da decisão em vigor e se
 * ela difere da de agora ("a divisão da reserva mudou depois da decisão", calculado na leitura, nunca gravado), cada opção
 * de quem arca (null = recusada: sem proprietário nas linhas do motor, ou sem partes para dividir), a do "Atualizar o
 * valor segurado" (a mesma causa e quem arca, sobre a base congelada) e por que a decisão não se registra agora.
 */
export type FatosDaDecisao = {
  versao: number;
  valor: number;
  perdida: boolean;
  semReserva: boolean;
  partes: PartesEfetivas;
  base: { parteProprietario: number; comissao: number } | null;
  divisaoMudou: boolean;
  opcoes: Record<QuemArcaContestacao, OpcaoDaDecisao | null>;
  atualizacao: OpcaoDaDecisao | null;
  /** Σx e Σy já lançados (o segurado em vigor de cada lado). */
  lancado: { proprietario: number; scl: number };
  /** Por que "Registrar quem arca" não vale agora; null = vale. */
  recusa: string | null;
};

async function fatosDaDecisao(tx: Db, organizacaoId: string, t: Travado, p: Pagamento, l: Contestacao): Promise<FatosDaDecisao> {
  const semReserva = !dinheiroDaReserva(p) || !l.reservaId;
  const perdida = l.situacao === "perdida";
  const valor = perdida ? Math.max(0, perdaADividir(l.valorPerdido ?? 0, substituidasPor(t, p, l).map((d) => d.valor))) : l.valorEmRisco;
  const partes: PartesEfetivas = semReserva ? { parteProprietario: 0, comissao: 0, proprietarioId: null } : await partesEfetivasDaReserva(tx, organizacaoId, t.reserva.id);
  const livro = await livroDaDisputa(tx, organizacaoId, l);
  const opcao = (quemArca: QuemArcaContestacao, D: number, C: number): OpcaoDaDecisao | null => {
    if (semReserva || (quemArca !== "scl" && !partes.proprietarioId)) return null;
    const d = divisaoDaDecisao(quemArca, valor, D, C);
    return d ? { ...d, assinatura: assinaturaDaDecisao({ valor, baseParteProprietario: D, baseComissao: C, quemArca }) } : null;
  };
  const base = l.decisaoVersao > 0 && l.baseParteProprietario !== null && l.baseComissao !== null ? { parteProprietario: l.baseParteProprietario, comissao: l.baseComissao } : null;
  let recusa: string | null = null;
  if (semReserva) recusa = TEXTO_PAGAMENTO_SEM_RESERVA;
  else if (l.situacao === "ganha" || l.situacao === "sem_efeito" || (perdida && l.decisaoVersao > 0)) recusa = TEXTO_DISPUTA_JA_TERMINOU;
  else if (l.duplicataPossivel) recusa = TEXTO_DUPLICATA_SEM_DECIDIR;
  else if (valor <= 0) recusa = TEXTO_NADA_A_DIVIDIR;
  return {
    versao: l.decisaoVersao,
    valor,
    perdida,
    semReserva,
    partes,
    base,
    divisaoMudou: !!base && (base.parteProprietario !== partes.parteProprietario || base.comissao !== partes.comissao),
    opcoes: Object.fromEntries(QUEM_ARCA_CONTESTACAO.map((q) => [q, opcao(q, partes.parteProprietario, partes.comissao)])) as Record<QuemArcaContestacao, OpcaoDaDecisao | null>,
    atualizacao: base && l.quemArca ? opcao(l.quemArca, base.parteProprietario, base.comissao) : null,
    lancado: { proprietario: livro.proprietario, scl: livro.scl },
    recusa,
  };
}

/** A prévia da decisão (sem trava): os fatos de `fatosDaDecisao`, para o formulário (a versão e a assinatura de cada opção). */
export async function previaDaDecisao(db: Db, organizacaoId: string, contestacaoId: string): Promise<{ ok: true; fatos: FatosDaDecisao } | Recusa> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  const t = await lerCotacaoSemTravar(db, organizacaoId, alvo.cotacaoId);
  const p = t?.tentativas.find((x) => x.id === alvo.pagamentoId);
  const l = t?.contestacoes.find((x) => x.id === alvo.contestacaoId);
  if (!t || !p || !l) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  return { ok: true, fatos: await fatosDaDecisao(db, organizacaoId, t, p, l) };
}

/** "Registrar quem arca" e "Mudar quem arca": a causa, quem arca, a nota (obrigatória) e a explicação ao proprietário (opcional), com a versão e a assinatura da prévia. */
export type EntradaDecisao = { causa: string; quemArca: string; nota: string; explicacao: string; versao: number; assinatura: string };

/** A causa, quem arca, a nota e a explicação de uma decisão, conferidas (listas fechadas; notas sem dado pessoal). */
function conferirEntradaDaDecisao(e: EntradaDecisao, faltaNota: string): { ok: true; causa: CodigoCausaContestacao; quemArca: QuemArcaContestacao; nota: string; explicacao: string } | Recusa {
  if (!(CODIGOS_CAUSA_CONTESTACAO as readonly string[]).includes(e.causa)) return recusada("Escolha a causa da disputa.");
  if (!(QUEM_ARCA_CONTESTACAO as readonly string[]).includes(e.quemArca)) return recusada("Escolha quem arca.");
  const nota = conferirNota(e.nota, true, faltaNota);
  if (!nota.ok) return nota;
  const explicacao = conferirNota(e.explicacao, false);
  if (!explicacao.ok) return recusada(explicacao.erro === ERRO_DADOS_PESSOAIS ? "Tire dados pessoais da explicação ao proprietário (CPF, e-mail, telefone, chave Pix, cartão)." : explicacao.erro.replace("A nota", "A explicação ao proprietário"));
  return { ok: true, causa: e.causa as CodigoCausaContestacao, quemArca: e.quemArca as QuemArcaContestacao, nota: nota.nota, explicacao: explicacao.nota };
}

/** A opção escolhida, ou a recusa dela (sem proprietário nas linhas do motor; sem partes para dividir; a assinatura mudou). */
function opcaoEscolhida(f: FatosDaDecisao, opcao: OpcaoDaDecisao | null, quemArca: QuemArcaContestacao, assinatura: string): { ok: true; opcao: OpcaoDaDecisao } | Recusa {
  if (!opcao) {
    if (quemArca !== "scl" && !f.partes.proprietarioId) return recusada(TEXTO_SEM_PROPRIETARIO_NA_RESERVA, "sem_proprietario");
    return recusada(TEXTO_SEM_PARTES_PARA_DIVIDIR, "sem_partes");
  }
  if (!assinatura || assinatura !== opcao.assinatura) return recusada(TEXTO_CONTESTACAO_PREVIA_MUDOU, "contestacao_previa_mudou");
  return { ok: true, opcao };
}

/**
 * Grava a versão nova da decisão (sob as travas): as colunas (a base congelada, a exposição e a divisão em vigor) e as
 * linhas do livro — na disputa ainda não final, a diferença de cada lado no mês corrente (`decisao`); na perdida sem
 * decisão, a decisão nasce definitiva (`definitivos`, e `definitivo_em`). O evento `decisao` e a auditoria
 * `contestacao.decisao` [antes, depois] (códigos e valores, nunca a nota nem a explicação).
 */
async function gravarDecisao(
  tx: Db,
  organizacaoId: string,
  t: Travado,
  p: Pagamento,
  l: Contestacao,
  d: {
    causa: CodigoCausaContestacao;
    quemArca: QuemArcaContestacao;
    /** A nota da decisão (só "Registrar quem arca"); null = mantém. */
    nota: string | null;
    /** O "por que mudar" ("Mudar quem arca"; a nota da decisão fica); null = mantém. */
    notaMudanca?: string | null;
    explicacao: string | null;
    base: { parteProprietario: number; comissao: number };
    valor: number;
    opcao: OpcaoDaDecisao;
    proprietarioId: string | null;
    atualizacao: boolean;
  },
  autorId: string | null,
  agora: Date,
): Promise<void> {
  const antes = { versao: l.decisaoVersao, causa: l.causa, quemArca: l.quemArca, valor: l.exposicao, proprietario: l.parteProprietario, scl: l.parteScl };
  const versao = l.decisaoVersao + 1;
  await gravarLinha(
    tx,
    l,
    {
      causa: d.causa,
      quemArca: d.quemArca,
      ...(d.nota !== null ? { decisaoNota: d.nota } : {}),
      ...(d.notaMudanca != null ? { decisaoMudancaNota: d.notaMudanca } : {}),
      ...(d.explicacao !== null ? { explicacaoProprietario: d.explicacao } : {}),
      decisaoPor: autorId,
      decisaoEm: agora,
      decisaoVersao: versao,
      baseParteProprietario: d.base.parteProprietario,
      baseComissao: d.base.comissao,
      exposicao: d.valor,
      parteProprietario: d.opcao.proprietario,
      parteScl: d.opcao.scl,
    },
    agora,
  );
  if (l.situacao === "perdida") {
    await lancarContestacao(tx, organizacaoId, t, p, l, { tipo: "definitivos", resultadoEm: l.resultadoEm ?? diaDe(agora), proprietario: d.opcao.proprietario, scl: d.opcao.scl, proprietarioId: d.proprietarioId }, autorId, agora);
    await gravarLinha(tx, l, { definitivoEm: agora }, agora);
  } else {
    await lancarContestacao(tx, organizacaoId, t, p, l, { tipo: "decisao", versao, proprietario: d.opcao.proprietario, scl: d.opcao.scl, proprietarioId: d.proprietarioId }, autorId, agora);
    await recalcularDisputas(tx, organizacaoId, t, p, agora);
  }
  const depois = { versao, causa: d.causa, quemArca: d.quemArca, valor: d.valor, proprietario: d.opcao.proprietario, scl: d.opcao.scl };
  await registrarEventoDaContestacao(tx, l.id, { fonte: "equipe", tipo: "decisao", antes, depois: { ...depois, atualizacao: d.atualizacao }, usuarioId: autorId }, agora);
  await registrarAuditoria(tx, {
    organizacaoId,
    usuarioId: autorId,
    acao: "contestacao.decisao",
    entidade: "pagamento",
    entidadeId: p.id,
    mudancas: {
      contestacao: [null, l.id],
      versao: [antes.versao, versao],
      causa: [antes.causa, d.causa],
      quemArca: [antes.quemArca, d.quemArca],
      valor: [antes.valor, d.valor],
      proprietario: [antes.proprietario, d.opcao.proprietario],
      scl: [antes.scl, d.opcao.scl],
      ...(d.atualizacao ? { atualizacao: [null, true] } : {}),
    },
  });
}

/**
 * "Registrar quem arca" (`financeiro:editar`): com a disputa `aberta`/`a_confirmar` (valor em risco > 0) ou `perdida` sem
 * decisão (perda a dividir > 0; a decisão nasce definitiva). O sistema nunca escolhe: a causa e quem arca vêm da equipe. Só
 * com a versão 0 ("A decisão mudou…" senão) e a assinatura das entradas da prévia (valor, D, C, quem arca;
 * `contestacao_previa_mudou` senão). Recusa: pagamento sem reserva; sem proprietário (proprietário e proporcional); sem
 * partes para dividir (proporcional); possível duplicata; nota ou explicação com dado pessoal; trava ocupada.
 */
export async function registrarDecisao(db: Db, organizacaoId: string, contestacaoId: string, e: EntradaDecisao, autorId: string | null, agora: Date = new Date()): Promise<ResultadoContestacao> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  const entrada = conferirEntradaDaDecisao(e, "Escreva a nota da decisão (sem dados pessoais).");
  if (!entrada.ok) return entrada;
  return naDisputa(db, organizacaoId, alvo, agora, async (tx, t, p, l) => {
    if (e.versao !== l.decisaoVersao || l.decisaoVersao !== 0) return recusada(TEXTO_DECISAO_MUDOU, "decisao_mudou");
    // A ordem única: o motor da reserva antes de ler as partes efetivas (um recálculo em curso termina antes da leitura).
    await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
    const f = await fatosDaDecisao(tx, organizacaoId, t, p, l);
    if (f.recusa) return recusada(f.recusa, "nao_permitida");
    const escolhida = opcaoEscolhida(f, f.opcoes[entrada.quemArca], entrada.quemArca, e.assinatura);
    if (!escolhida.ok) return escolhida;
    await gravarDecisao(
      tx,
      organizacaoId,
      t,
      p,
      l,
      { causa: entrada.causa, quemArca: entrada.quemArca, nota: entrada.nota, explicacao: entrada.explicacao, base: f.partes, valor: f.valor, opcao: escolhida.opcao, proprietarioId: f.partes.proprietarioId, atualizacao: false },
      autorId,
      agora,
    );
    return { ok: true, contestacaoId: l.id };
  });
}

/**
 * "Mudar quem arca" (`financeiro:editar`, nota obrigatória "por que mudar"): só antes do resultado e com uma decisão em vigor
 * (a versão da prévia); a divisão nova sobre o valor em risco e as partes de agora (a base é congelada de novo), versão
 * n+1, só a diferença de cada lado no mês corrente. Depois do resultado: "A disputa já terminou: corrija com um ajuste".
 * O "por que mudar" vai para `decisao_mudanca_nota` (a da mudança mais recente); a nota da decisão não é apagada.
 */
export async function mudarDecisao(db: Db, organizacaoId: string, contestacaoId: string, e: EntradaDecisao, autorId: string | null, agora: Date = new Date()): Promise<ResultadoContestacao> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  const entrada = conferirEntradaDaDecisao(e, "Escreva por que mudar a decisão (sem dados pessoais).");
  if (!entrada.ok) return entrada;
  return naDisputa(db, organizacaoId, alvo, agora, async (tx, t, p, l) => {
    if (!contestacaoNaoFinal(l.situacao)) return recusada(TEXTO_DISPUTA_JA_TERMINOU, "nao_permitida");
    if (l.decisaoVersao === 0) return recusada(TEXTO_SEM_DECISAO_PARA_MUDAR, "decisao_mudou");
    if (e.versao !== l.decisaoVersao) return recusada(TEXTO_DECISAO_MUDOU, "decisao_mudou");
    await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
    const f = await fatosDaDecisao(tx, organizacaoId, t, p, l);
    if (f.semReserva) return recusada(TEXTO_PAGAMENTO_SEM_RESERVA, "nao_permitida");
    const escolhida = opcaoEscolhida(f, f.opcoes[entrada.quemArca], entrada.quemArca, e.assinatura);
    if (!escolhida.ok) return escolhida;
    await gravarDecisao(
      tx,
      organizacaoId,
      t,
      p,
      l,
      { causa: entrada.causa, quemArca: entrada.quemArca, nota: null, notaMudanca: entrada.nota, explicacao: entrada.explicacao, base: f.partes, valor: f.valor, opcao: escolhida.opcao, proprietarioId: f.partes.proprietarioId, atualizacao: false },
      autorId,
      agora,
    );
    return { ok: true, contestacaoId: l.id };
  });
}

/**
 * "Atualizar o valor segurado" (`financeiro:editar`), a ação pronta do aviso `contestacao_valor_mudou`: a mesma causa e
 * quem arca, sobre a base congelada, com o valor em risco de agora; versão n+1 e a diferença de cada lado no mês corrente.
 * O sistema nunca muda o segurado sozinho. Com a versão e a assinatura da prévia (`FatosDaDecisao.atualizacao`).
 */
export async function atualizarValorSegurado(db: Db, organizacaoId: string, contestacaoId: string, e: { versao: number; assinatura: string }, autorId: string | null, agora: Date = new Date()): Promise<ResultadoContestacao> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  return naDisputa(db, organizacaoId, alvo, agora, async (tx, t, p, l) => {
    if (!contestacaoNaoFinal(l.situacao)) return recusada(TEXTO_DISPUTA_JA_TERMINOU, "nao_permitida");
    if (l.decisaoVersao === 0 || !l.causa || !l.quemArca) return recusada(TEXTO_SEM_DECISAO_PARA_MUDAR, "decisao_mudou");
    if (e.versao !== l.decisaoVersao) return recusada(TEXTO_DECISAO_MUDOU, "decisao_mudou");
    if (!valorSeguradoDesatualizado(l)) return recusada(TEXTO_VALOR_SEGURADO_EM_DIA, "nao_permitida");
    await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
    const f = await fatosDaDecisao(tx, organizacaoId, t, p, l);
    if (!f.base) return recusada(TEXTO_SEM_DECISAO_PARA_MUDAR, "decisao_mudou");
    const escolhida = opcaoEscolhida(f, f.atualizacao, l.quemArca, e.assinatura);
    if (!escolhida.ok) return escolhida;
    await gravarDecisao(
      tx,
      organizacaoId,
      t,
      p,
      l,
      { causa: l.causa, quemArca: l.quemArca, nota: null, explicacao: null, base: f.base, valor: f.valor, opcao: escolhida.opcao, proprietarioId: f.partes.proprietarioId, atualizacao: true },
      autorId,
      agora,
    );
    return { ok: true, contestacaoId: l.id };
  });
}

// ---------------------------------------------------------------- confirmar o resultado e encerrar sem efeito

/**
 * Os fatos do resultado (a prévia e a ação leem daqui): a assinatura (situação, estado combinado, valor em disputa, valor
 * em risco, Σx, Σy, o retido e a versão; nunca `consultada_em`, eventos, avisos ou lançamentos de outras origens), o retido
 * em vigor e os valores propostos ao formulário (nunca o resultado: C1).
 */
export type FatosDoResultado = {
  versao: number;
  assinatura: string;
  semReserva: boolean;
  lancado: { proprietario: number; scl: number };
  retido: { estado: string; montante: number; data: string | null } | null;
  /** O pagamento ainda não tem recebimento em vigor (o "Ganhou" oferece registrar a liberação ali mesmo). */
  semRecebimento: boolean;
  /**
   * O "Perdeu" pede antes a liberação registrada à mão (sem recebimento em vigor e com o sinal de liberação do Mercado Pago,
   * ou numa disputa de parte do valor): o texto da recusa, ou null. Nada de "nunca entrou" suposto.
   */
  liberacaoAntesDaPerda: string | null;
  proposta: {
    /** O valor em disputa (com a conta); no pagamento sem reserva, a taxa do pagamento (o que a SCL perde). */
    valorPerdido: number | null;
    /**
     * O líquido sem recebimento em vigor (o Mercado Pago não liberou), nunca mais que o valor perdido; 0 com recebimento;
     * null quando a liberação precisa ser registrada antes (`liberacaoAntesDaPerda`) ou o líquido não é conhecido.
     */
    liquidoNaoEntrou: number | null;
    /** O dia do débito confirmado, ou o do retido realizado. */
    debitoEm: string | null;
  };
  /** A sugestão pela leitura (desligada: `SUGERIR_RESULTADO_PELA_LEITURA`). */
  sugestao: "ganha" | "perdida" | null;
};

async function fatosDoResultado(tx: Db, organizacaoId: string, p: Pagamento, l: Contestacao): Promise<FatosDoResultado> {
  const livro = await livroDaDisputa(tx, organizacaoId, l);
  const semReserva = !dinheiroDaReserva(p) || !l.reservaId;
  const recebidos = semReserva ? [] : (await recebimentosDoPagamento(tx, organizacaoId, p.id)).emVigor.filter((x) => x.estado === "realizado" || x.estado === "conciliado");
  const comRecebimento = recebidos.length > 0;
  const valorPerdido = semReserva ? p.taxa : (l.valor ?? valorPagoAprovado(p));
  // Sem recebimento em vigor, o "nunca entrou" só se propõe quando o Mercado Pago não mostrou a liberação e a disputa é do
  // valor inteiro: com o sinal de liberação, ou numa disputa de parte do valor (o resto entra pela liberação), a liberação
  // se registra antes (o caixa final fica pelo que de fato entrou, e a taxa da reserva fica a do pagamento).
  const liberacaoLida = l.avisos.includes("contestacao_liberacao_lida") || !!p.liberacaoConfirmadaEm;
  const parcial = l.valor !== null && l.valor < valorPagoAprovado(p);
  const liberacaoAntesDaPerda = semReserva || comRecebimento ? null : liberacaoLida ? TEXTO_LIBERACAO_ANTES_DA_PERDA : parcial ? TEXTO_LIBERACAO_ANTES_DA_PERDA_PARCIAL : null;
  return {
    versao: l.decisaoVersao,
    assinatura: assinaturaDoResultado({
      situacao: l.situacao,
      estadoLido: l.estadoLido,
      coberturaAplicada: l.coberturaAplicada,
      valor: l.valor,
      valorEmRisco: l.valorEmRisco,
      lancadoProprietario: livro.proprietario,
      lancadoScl: livro.scl,
      retido: retidoDaAssinatura(livro.retido),
      decisaoVersao: l.decisaoVersao,
    }),
    semReserva,
    lancado: { proprietario: livro.proprietario, scl: livro.scl },
    retido: livro.retido ? { estado: livro.retido.estado, montante: livro.retido.montante ?? 0, data: livro.retido.dataCaixa } : null,
    semRecebimento: !semReserva && !comRecebimento,
    liberacaoAntesDaPerda,
    proposta: {
      valorPerdido,
      liquidoNaoEntrou: semReserva ? 0 : liquidoNaoEntrouProposto({ comRecebimento, liquido: p.liquido, valorPerdido, liberacaoLida: liberacaoAntesDaPerda !== null }),
      debitoEm: l.debitoEm ?? (retidoRealizado(livro.retido) ? livro.retido!.dataCaixa : null),
    },
    sugestao: resultadoSugeridoPelaLeitura(l),
  };
}

/** A prévia do resultado (sem trava): a versão, a assinatura e os valores propostos (`FatosDoResultado`). */
export async function previaDoResultado(db: Db, organizacaoId: string, contestacaoId: string): Promise<{ ok: true; fatos: FatosDoResultado } | Recusa> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  const t = await lerCotacaoSemTravar(db, organizacaoId, alvo.cotacaoId);
  const p = t?.tentativas.find((x) => x.id === alvo.pagamentoId);
  const l = t?.contestacoes.find((x) => x.id === alvo.contestacaoId);
  if (!t || !p || !l) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  return { ok: true, fatos: await fatosDoResultado(db, organizacaoId, p, l) };
}

/**
 * O sentido que o Mercado Pago mostra, pela página atual (só para saber se a nota é obrigatória; o resultado é sempre da
 * equipe, C1): a cobertura true = a favor da SCL; false, ou `reimbursed` ("devolvido ao pagador"), contra; os dois juntos ou
 * nada, null.
 */
function sentidoLido(l: Pick<Contestacao, "coberturaAplicada" | "estadoLido">): "ganha" | "perdida" | null {
  const aFavor = l.coberturaAplicada === true;
  const contra = l.coberturaAplicada === false || l.estadoLido === "reimbursed";
  return aFavor === contra ? null : aFavor ? "ganha" : "perdida";
}

/** "Confirmar o resultado": Ganhou ou Perdeu (sem nada marcado de início, C1), a data, a nota e os campos de cada um. */
export type EntradaResultado = {
  resultado: string;
  /** A data do resultado (entre a abertura e hoje). */
  data: string;
  nota: string;
  /** "O painel do Mercado Pago já mostra o resultado" (pedida quando a leitura de agora mostra a disputa em andamento). */
  notaReforcada: boolean;
  versao: number;
  assinatura: string;
  /** Tarifa do Mercado Pago pela disputa (opcional; despesa da SCL, ganhe ou perca). */
  tarifa: number | null;
  /** Ganhou: o dia em que o dinheiro debitado voltou (padrão: a data do resultado). */
  voltaEm?: string | null;
  /** Ganhou, sem recebimento do pagamento: a liberação ali mesmo (as regras de `registrarLiberacaoManual`). */
  liberacao?: { data: string; liquido: number } | null;
  /** Perdeu: o valor que a SCL perdeu, quanto deste pagamento nunca entrou na conta e o dia em que o Mercado Pago debitou. */
  valorPerdido?: number | null;
  liquidoNaoEntrou?: number | null;
  debitoEm?: string | null;
};

const centavosOuNull = (v: number | null | undefined) => (v === null || v === undefined ? null : v);
const centavosValidos = (v: number | null, max: number) => v === null || (Number.isSafeInteger(v) && v >= 0 && v <= max);

/**
 * "Confirmar o resultado" (`financeiro:editar`), com a disputa `aberta` ou `a_confirmar`.
 * - Fase 0 (sem trava, melhor esforço): a releitura (`releituraDaDisputa`). Falhou ou trava do provedor fechada: segue com
 *   a nota "não deu para conferir no Mercado Pago agora". A leitura de agora mostra a disputa em andamento: não recusa, pede
 *   a nota reforçada.
 * - Fase 1, numa transação: a versão e a assinatura da prévia; a transição (`transicaoDaContestacao`); a nota obrigatória
 *   quando o resultado ou o valor diferem do que o Mercado Pago mostra, quando ele não mostra o resultado, ou quando a
 *   leitura não deu; as linhas da tabela "Lançamentos por momento" (`lancarContestacao`); a devolução substituída
 *   (confirmada pela disputa na perdida, pelo menor entre o valor dela e o perdido; de volta a devida na ganha); o
 *   pagamento (de volta à situação de antes na ganha, se ainda `contestado`; o desfecho `contestacao` do pagamento sem
 *   reserva perdido); a perdida sem decisão continua em conferência (a decisão depois nasce definitiva); o evento e a
 *   auditoria `contestacao.resultado`.
 * - Ganhou sem recebimento: a liberação do formulário, sob a mesma trava; sem ela, o aviso `contestacao_ganha_sem_recebimento`.
 */
export async function confirmarResultado(
  db: Db,
  organizacaoId: string,
  contestacaoId: string,
  e: EntradaResultado,
  autorId: string | null,
  provedor: ProvedorPagamento | null,
  agora: Date = new Date(),
): Promise<ResultadoContestacao> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  if (e.resultado !== "ganha" && e.resultado !== "perdida") return recusada("Escolha o resultado: Ganhou ou Perdeu.");
  const resultado = e.resultado;
  const tarifa = centavosOuNull(e.tarifa) ?? 0;
  if (!Number.isSafeInteger(tarifa) || tarifa < 0) return recusada("Informe a tarifa do Mercado Pago pela disputa (zero ou mais), ou deixe em branco.");
  // Fase 0: a releitura, sem trava.
  const leitura = await releituraDaDisputa(db, alvo, provedor, agora);
  return naDisputa(db, organizacaoId, alvo, agora, async (tx, t, p, l) => {
    if (!contestacaoNaoFinal(l.situacao)) return recusada(TEXTO_DISPUTA_JA_TERMINOU, "nao_permitida");
    if (e.versao !== l.decisaoVersao) return recusada(TEXTO_DECISAO_MUDOU, "decisao_mudou");
    const fatos = await fatosDoResultado(tx, organizacaoId, p, l);
    if (!e.assinatura || e.assinatura !== fatos.assinatura) return recusada(TEXTO_CONTESTACAO_PREVIA_MUDOU, "contestacao_previa_mudou");
    const tr = transicaoDaContestacao(l, { tipo: "resultado", resultado, em: agora, emDisputaNaLeitura: leitura.emDisputa, notaReforcada: e.notaReforcada });
    if (!tr.ok) return recusada(tr.erro, tr.codigo);
    if (tr.descartada) return recusada(TEXTO_DISPUTA_JA_TERMINOU, "nao_permitida");
    const data = conferirData(e.data, diaDe(l.abertaEm), agora, "a data do resultado");
    if (!data.ok) return data;
    const daReserva = !fatos.semReserva;
    const pago = valorPagoAprovado(p);
    // Os campos de cada resultado.
    let valorPerdido = 0;
    let liquidoNaoEntrou = 0;
    let debitoEm: string | null = null;
    let voltaEm: string | null = null;
    // As datas de caixa: o débito nunca antes da abertura da disputa; a volta nunca antes do débito que ela desfaz.
    const desdeAbertura = desdeAberturaDaDisputa(p, l);
    if (resultado === "perdida") {
      const v = centavosOuNull(e.valorPerdido);
      const n = daReserva ? centavosOuNull(e.liquidoNaoEntrou) : 0;
      if (v === null || !centavosValidos(v, pago)) return recusada(`Informe o valor que a SCL perdeu (até o pago, ${formatBRL(pago)}).`);
      // Pagamento sem reserva: o dinheiro dele nunca entrou no livro; o que a SCL perde é a taxa (com o custo do parcelamento
      // que ela pagou). Um valor acima é quase sempre digitação; sem a taxa conhecida, a nota diz a que o painel mostra.
      if (!daReserva) {
        const teto = p.taxa === null ? null : p.taxa + Math.max(0, p.custoParcelasVendedor ?? 0);
        if (teto !== null && v > teto) return recusada(textoPerdaSemReservaAcimaDaTaxa(v, teto));
        if (teto === null && !(e.nota ?? "").trim()) return recusada(TEXTO_NOTA_DA_TAXA_SEM_RESERVA);
      }
      if (n === null || !centavosValidos(n, pago)) return recusada(`Informe quanto deste pagamento nunca entrou na conta (zero se entrou tudo; até ${formatBRL(pago)}).`);
      if (n > v) return recusada(`O que deste pagamento nunca entrou na conta (${formatBRL(n)}) não passa do valor que a SCL perdeu (${formatBRL(v)}): o resto entra pela liberação.`);
      if (daReserva && fatos.liberacaoAntesDaPerda) return recusada(fatos.liberacaoAntesDaPerda, "liberacao_antes");
      valorPerdido = v;
      liquidoNaoEntrou = n;
      const dia = e.debitoEm || l.debitoEm || fatos.proposta.debitoEm;
      if (dia) {
        const d = conferirData(dia, desdeAbertura, agora, "o dia em que o Mercado Pago debitou");
        if (!d.ok) return d;
        debitoEm = d.data;
      }
    } else if (fatos.retido && (fatos.retido.estado === "realizado" || fatos.retido.estado === "conciliado")) {
      const d = conferirData(e.voltaEm || data.data, desdeODebito(p, l, fatos.retido.data), agora, "o dia em que o dinheiro voltou");
      if (!d.ok) return d;
      voltaEm = d.data;
    }
    // A nota: obrigatória quando o resultado ou o valor diferem do que o Mercado Pago mostra, quando ele não mostra o
    // resultado, ou quando a leitura não deu (aí ganha a observação, como no registro pela equipe).
    const difere = l.situacao !== "a_confirmar" || sentidoLido(l) !== resultado || (resultado === "perdida" && daReserva && l.valor !== null && valorPerdido !== l.valor);
    const obrigatoria = !leitura.lida || leitura.emDisputa || difere;
    const nota = conferirNota(e.nota, obrigatoria, leitura.emDisputa ? TEXTO_NOTA_REFORCADA : TEXTO_NOTA_DO_RESULTADO);
    if (!nota.ok) return nota;
    const notaGravada = leitura.lida ? nota.nota : nota.nota ? `${nota.nota} (${NOTA_SEM_CONFERIR_AGORA})` : NOTA_SEM_CONFERIR_AGORA;
    if (resultado === "ganha" && e.liberacao && !fatos.semRecebimento) return recusada("O pagamento já tem a liberação registrada: deixe a liberação em branco.");
    // A situação, os fatos e os avisos da transição; o resultado.
    const situacaoAntes = l.situacao;
    await gravarLinha(
      tx,
      l,
      {
        situacao: tr.situacao,
        avisos: tr.avisos,
        lidaEm: tr.fatos.lidaEm,
        resultadoEm: data.data,
        resultadoPor: autorId,
        resultadoNota: notaGravada,
        tarifa: tarifa > 0 ? tarifa : null,
        ...(resultado === "perdida" ? { valorPerdido, liquidoNaoEntrou, debitoEm } : {}),
      },
      agora,
    );
    for (const ev of tr.eventos) await registrarEventoDaContestacao(tx, l.id, { fonte: "equipe", tipo: ev.tipo, antes: ev.antes, depois: ev.depois, usuarioId: autorId }, agora);
    // Ganhou sem recebimento: a liberação do formulário, sob a mesma trava (as regras de `registrarLiberacaoManual`; o
    // pagamento ainda está contestado, explicado pela disputa). Recusada, desfaz tudo.
    if (resultado === "ganha" && e.liberacao) {
      const lib = await registrarLiberacaoManual(tx, organizacaoId, p.id, e.liberacao, autorId, agora);
      if (!lib.ok) throw new RecusaDaContestacao(lib.erro);
      await recarregar(tx, t, p);
    }
    const substituidas = substituidasPor(t, p, l);
    if (resultado === "ganha") {
      await lancarContestacao(tx, organizacaoId, t, p, l, { tipo: "ganha", resultadoEm: data.data, voltaEm, tarifa }, autorId, agora);
      for (const d of substituidas) await devolucaoDevidaDepoisDaDisputa(tx, organizacaoId, p, d, autorId, agora);
      await voltarASituacaoDeAntes(tx, organizacaoId, t, p, l, "contestacao_ganha", autorId, agora);
      const semRecebimento = daReserva && reservaCalculadaPeloMotor(t.reserva) && !(await recebimentosDoPagamento(tx, organizacaoId, p.id)).emVigor.some((x) => x.estado === "realizado" || x.estado === "conciliado");
      // Depois da ganha a leitura volta a lançar a liberação sozinha: o aviso da liberação lida sob disputa sai; fica o da
      // ganha sem recebimento, até a liberação entrar no livro.
      await trocarAvisosDaContestacao(tx, l, semRecebimento ? { ligar: ["contestacao_ganha_sem_recebimento"], desligar: ["contestacao_liberacao_lida"] } : { desligar: ["contestacao_ganha_sem_recebimento", "contestacao_liberacao_lida"] }, agora);
      await gravarLinha(tx, l, { definitivoEm: agora }, agora);
    } else {
      await lancarContestacao(tx, organizacaoId, t, p, l, { tipo: "perdida", resultadoEm: data.data, debitoEm, valorPerdido, liquidoNaoEntrou, tarifa }, autorId, agora);
      // A liberação lida só se pede enquanto ainda cabe: com o recebimento no livro, ou com o líquido inteiro contado como
      // "nunca entrou" pelo caixa final, o aviso sai (e a leitura não o religa).
      const cabe = liquidoQueAindaPodeEntrar(t, p);
      if (!fatos.semRecebimento || (cabe !== null && cabe <= 0)) await trocarAvisosDaContestacao(tx, l, { desligar: ["contestacao_liberacao_lida"] }, agora);
      // A devolução substituída: confirmada pela disputa pelo menor entre o valor dela e o que sobra do perdido (no pagamento
      // sem reserva, do valor em disputa: o perdido ali é só a taxa).
      const confirmados = confirmadoPelasSubstituidas(
        substituidas.map((d) => d.valor),
        daReserva ? valorPerdido : (l.valor ?? pago),
      );
      const taxaDaDisputa = daReserva ? null : (await livroDaDisputa(tx, organizacaoId, l)).linhas.find((x) => x.chaveOrigem === chavesDaContestacao(p.id, l.id).taxa() && !x.estornada);
      let primeira = true;
      for (const [i, d] of substituidas.entries()) {
        if (confirmados[i] > 0) {
          await confirmarDevolucaoPelaDisputa(tx, organizacaoId, t, p, d, { valor: confirmados[i], data: debitoEm ?? data.data, taxa: daReserva ? null : primeira ? { valor: valorPerdido, lancamentoId: taxaDaDisputa?.id ?? null } : { valor: 0, lancamentoId: null } }, autorId, agora);
          primeira = false;
        } else await devolucaoDevidaDepoisDaDisputa(tx, organizacaoId, p, d, autorId, agora);
      }
      if (daReserva) {
        // A divisão definitiva: com decisão, agora (comparada com o já lançado); sem decisão e com perda a dividir, a reserva
        // continua em conferência e a decisão depois nasce definitiva; nada a dividir, nada a lançar.
        const perda = perdaADividir(valorPerdido, substituidas.map((d) => d.valor));
        if (l.decisaoVersao > 0 && l.quemArca) {
          const acerto = acertoDaPerda({
            valorPerdido,
            substituidas: substituidas.map((d) => d.valor),
            quemArca: l.quemArca,
            baseParteProprietario: l.baseParteProprietario ?? 0,
            baseComissao: l.baseComissao ?? 0,
            lancadoProprietario: fatos.lancado.proprietario,
            lancadoScl: fatos.lancado.scl,
          });
          if (!acerto) throw new RecusaDaContestacao(TEXTO_SEM_PARTES_PARA_DIVIDIR, "sem_partes");
          await lancarContestacao(tx, organizacaoId, t, p, l, { tipo: "definitivos", resultadoEm: data.data, proprietario: acerto.proprietario, scl: acerto.scl, proprietarioId: null }, autorId, agora);
          await gravarLinha(tx, l, { exposicao: acerto.perdaADividir, parteProprietario: acerto.proprietario, parteScl: acerto.scl, definitivoEm: agora }, agora);
        } else if (perda <= 0) await gravarLinha(tx, l, { definitivoEm: agora }, agora);
      } else {
        // Pagamento sem reserva: o desfecho "o dinheiro voltou ao pagador pela disputa"; as ações de devolução dele param.
        if (p.desfecho === null) {
          const desfecho = { desfecho: DESFECHO_CONTESTACAO, desfechoMotivo: "o dinheiro voltou ao pagador pela disputa do pagamento", desfechoPor: autorId, desfechoEm: agora, atualizadoEm: agora };
          await tx.update(pagamentos).set(desfecho).where(eq(pagamentos.id, p.id));
          Object.assign(p, desfecho);
          await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.situacao", entidade: "pagamento", entidadeId: p.id, mudancas: { desfecho: [null, DESFECHO_CONTESTACAO], motivo: [null, "contestacao_perdida"] } });
        }
        await gravarLinha(tx, l, { definitivoEm: agora }, agora);
      }
    }
    // As outras disputas do pagamento: esta não segura mais nada do pago.
    await recalcularDisputas(tx, organizacaoId, t, p, agora);
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "contestacao.resultado",
      entidade: "pagamento",
      entidadeId: p.id,
      mudancas: {
        contestacao: [null, l.id],
        situacao: [situacaoAntes, tr.situacao],
        data: [null, data.data],
        ...(resultado === "perdida" ? { valorPerdido: [l.valor, valorPerdido], liquidoNaoEntrou: [null, liquidoNaoEntrou], debitoEm: [null, debitoEm] } : { voltaEm: [null, voltaEm] }),
        tarifa: [null, tarifa],
        semLeitura: [null, !leitura.lida],
      },
    });
    return { ok: true, contestacaoId: l.id };
  });
}

/** Relê o pagamento e as disputas dele dentro da transação (depois de uma ação que grava pelo próprio caminho) e atualiza o retrato. */
async function recarregar(tx: Db, t: Travado, p: Pagamento): Promise<void> {
  const [novo] = await tx.select().from(pagamentos).where(eq(pagamentos.id, p.id));
  if (novo) Object.assign(p, novo);
  const linhas = await tx.select().from(contestacoesPagamento).where(eq(contestacoesPagamento.pagamentoId, p.id));
  for (const x of linhas) {
    const l = t.contestacoes.find((y) => y.id === x.id);
    if (l) Object.assign(l, x);
  }
}

/**
 * "Encerrar sem efeito" (`financeiro:editar`, nota obrigatória; numa leitura `in_process` do mesmo caso, a nota reforçada):
 * registrada por engano, duplicata, ou reclamação resolvida sem dinheiro. Só sem lançamentos definitivos (a disputa não
 * final). Espelha no mês corrente os lançamentos previstos do proprietário e da SCL (`…:sem_efeito:<lançamento original>`);
 * o retido previsto é estornado e o realizado volta no dia informado (`voltaEm`, obrigatório com ele); a devolução
 * substituída volta a ser devida; o pagamento volta à situação de antes quando é a última disputa dele (e ele ainda está
 * `contestado`). Auditado (`contestacao.sem_efeito`).
 */
export async function encerrarSemEfeito(
  db: Db,
  organizacaoId: string,
  contestacaoId: string,
  e: { nota: string; notaReforcada: boolean; voltaEm?: string | null },
  autorId: string | null,
  provedor: ProvedorPagamento | null,
  agora: Date = new Date(),
): Promise<ResultadoContestacao> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  const nota = conferirNota(e.nota, true, "Escreva por que a disputa fica sem efeito (sem dados pessoais).");
  if (!nota.ok) return nota;
  const leitura = await releituraDaDisputa(db, alvo, provedor, agora);
  return naDisputa(db, organizacaoId, alvo, agora, async (tx, t, p, l) => {
    const tr = transicaoDaContestacao(l, { tipo: "sem_efeito", em: agora, emDisputaNaLeitura: leitura.emDisputa, notaReforcada: e.notaReforcada });
    if (!tr.ok) return recusada(tr.erro, tr.codigo);
    if (tr.descartada) return recusada(TEXTO_DISPUTA_JA_TERMINOU, "nao_permitida");
    let voltaEm: string | null = null;
    if (e.voltaEm) {
      const livro = await livroDaDisputa(tx, organizacaoId, l);
      const d = conferirData(e.voltaEm, desdeODebito(p, l, retidoRealizado(livro.retido) ? livro.retido!.dataCaixa : null), agora, "o dia em que o dinheiro voltou");
      if (!d.ok) return d;
      voltaEm = d.data;
    }
    const antes = { situacao: l.situacao, valorEmRisco: l.valorEmRisco };
    await gravarLinha(tx, l, { situacao: tr.situacao, avisos: tr.avisos, lidaEm: tr.fatos.lidaEm, duplicataPossivel: tr.duplicataPossivel, valorEmRisco: 0, encerradaNota: leitura.lida ? nota.nota : `${nota.nota} (${NOTA_SEM_CONFERIR_AGORA})` }, agora);
    for (const ev of tr.eventos) await registrarEventoDaContestacao(tx, l.id, { fonte: "equipe", tipo: ev.tipo, antes: ev.antes, depois: ev.depois, usuarioId: autorId }, agora);
    await lancarContestacao(tx, organizacaoId, t, p, l, { tipo: "sem_efeito", voltaEm }, autorId, agora);
    for (const d of substituidasPor(t, p, l)) await devolucaoDevidaDepoisDaDisputa(tx, organizacaoId, p, d, autorId, agora);
    await voltarASituacaoDeAntes(tx, organizacaoId, t, p, l, "contestacao_sem_efeito", autorId, agora);
    await recalcularDisputas(tx, organizacaoId, t, p, agora);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "contestacao.sem_efeito", entidade: "pagamento", entidadeId: p.id, mudancas: { contestacao: [null, l.id], situacao: [antes.situacao, "sem_efeito"], valorEmRisco: [antes.valorEmRisco, 0], semLeitura: [null, !leitura.lida] } });
    return { ok: true, contestacaoId: l.id };
  });
}

/**
 * "Conferir o aviso" (`financeiro:editar`, nota obrigatória), numa disputa final com `contestacao_resultado_mudou`:
 * - `continua_encerrada` ("A disputa continua encerrada no painel do Mercado Pago"): o aviso sai;
 * - `reaberta` (só numa ganha relida `in_process`: "A disputa foi reaberta (reapresentação ou arbitragem)"): nasce a rodada
 *   seguinte (linha nova, mesma identificação, origem `equipe`, `aberta`, sem decisão), que segue o fluxo inteiro (valor em
 *   risco, retido previsto, devoluções substituídas). A rodada ganha fica como está, com os lançamentos dela.
 * Auditado (`contestacao.conferir_aviso` ou `contestacao.reabrir`).
 */
export async function conferirAviso(db: Db, organizacaoId: string, contestacaoId: string, e: { como: string; nota: string }, autorId: string | null, agora: Date = new Date()): Promise<ResultadoContestacao> {
  const alvo = await contestacaoDaOrganizacao(db, organizacaoId, contestacaoId);
  if (!alvo) return recusada(TEXTO_DISPUTA_NAO_ENCONTRADA, "nao_encontrada");
  if (e.como !== "continua_encerrada" && e.como !== "reaberta") return recusada("Escolha o que o painel do Mercado Pago mostra.");
  const como = e.como;
  const nota = conferirNota(e.nota, true, "Escreva o que o painel do Mercado Pago mostra (sem dados pessoais).");
  if (!nota.ok) return nota;
  return naDisputa(db, organizacaoId, alvo, agora, async (tx, t, p, l) => {
    const tr = transicaoDaContestacao(l, { tipo: "conferir_aviso", como, em: agora });
    if (!tr.ok) return recusada(tr.erro, tr.codigo);
    if (tr.descartada) return recusada(TEXTO_SEM_AVISO_A_CONFERIR, "sem_aviso");
    // A rodada seguinte sem número com outra disputa sem número aberta no pagamento: pode ser a mesma (a equipe a registrou
    // antes), e o índice `contestacoes_pagamento_sem_id` não deixaria duas. A equipe decide por qual seguir.
    const semId = (x: Pick<Contestacao, "idCaso" | "idContestacao">) => x.idCaso === null && x.idContestacao === null;
    const outraSemId = tr.novaRodada && semId(l) ? contestacoesDoPagamento(t, p.id).find((x) => x.id !== l.id && contestacaoNaoFinal(x.situacao) && semId(x)) : undefined;
    if (outraSemId) return recusada(textoOutraDisputaSemNumero(outraSemId.abertaEm), "nao_permitida");
    await gravarLinha(tx, l, { avisos: tr.avisos, avisoConferidoEm: agora, avisoConferidoPor: autorId, avisoConferidoNota: nota.nota }, agora);
    for (const ev of tr.eventos) await registrarEventoDaContestacao(tx, l.id, { fonte: "equipe", tipo: ev.tipo, antes: ev.antes, depois: ev.depois, usuarioId: autorId }, agora);
    let novaId: string | null = null;
    if (tr.novaRodada) {
      const ctx = contextoDaNova(t, p.id);
      const dados = novaContestacao({
        origem: "equipe",
        tipo: l.tipo,
        forma: p.forma,
        leituras: [],
        identificacao: { idCaso: l.idCaso, idContestacao: l.idContestacao, idTransacao: l.idTransacao },
        duplicataPossivel: false,
        pagamento: { situacao: p.situacao, devolvidoLido: p.devolvidoLido, pago: valorPagoAprovado(p), valor: p.valor, tresDSStatus: p.tresDSStatus },
        deOutraNaoFinal: ctx.deOutraNaoFinal,
        outras: ctx.outras,
        comDevolucaoRealizada: p.devolvidoForaReconhecido > 0 || p.situacao === "devolvido" || devolucoesDoPagamento(t, p.id).some((d) => d.situacao === "confirmada" || d.situacao === "por_fora"),
        equipe: { valor: l.valor, prazo: null },
        agora,
      });
      // A rodada seguinte leva os fatos que a leitura já mostrou (o caso relido em andamento): uma leitura iniciada antes desta
      // ação é descartada nela. Num ponto de salvamento: o índice único violado (outra rodada criada ao mesmo tempo) responde
      // com texto, nunca o erro cru.
      const criar = (sp: Db) =>
        criarLinha(
          sp,
          organizacaoId,
          t,
          p,
          {
            ...dados,
            rodada: l.rodada + 1,
            estadoLido: l.estadoLido,
            codigo: l.codigo,
            coberturaElegivel: l.coberturaElegivel,
            motivoId: l.motivoId,
            motivoCodigo: l.motivoCodigo,
            valorOrigem: l.valorOrigem,
            abertaNoProvedorEm: l.abertaNoProvedorEm,
            aoVivo: l.aoVivo,
            lidaEm: agora,
            atualizadoNoProvedorEm: l.atualizadoNoProvedorEm,
            notaRegistro: nota.nota,
            proximaLeituraEm: agora,
          },
          agora,
          { fonte: "equipe", usuarioId: autorId },
        );
      let nova: Contestacao;
      try {
        nova = await tx.transaction((sp) => criar(sp));
      } catch (erro) {
        if (violouUnicidade(erro)) throw new RecusaDaContestacao(TEXTO_RODADA_JA_NO_QUADRO, "nao_permitida");
        throw erro;
      }
      novaId = nova.id;
      await recalcularDisputas(tx, organizacaoId, t, p, agora);
    }
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: tr.novaRodada ? "contestacao.reabrir" : "contestacao.conferir_aviso",
      entidade: "pagamento",
      entidadeId: p.id,
      mudancas: { contestacao: [null, l.id], como: [null, como], ...(novaId ? { rodada: [l.rodada, l.rodada + 1], novaContestacao: [null, novaId] } : {}) },
    });
    return { ok: true, contestacaoId: novaId ?? l.id, ...(novaId ? { mensagem: `A disputa foi reaberta: rodada ${l.rodada + 1} no quadro.` } : {}) };
  });
}
