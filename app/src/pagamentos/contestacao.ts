/**
 * Contestação do pagamento no site (M8.2e) — abertura e leitura: o registro pela equipe ("Registrar disputa vista no
 * painel do Mercado Pago"), a rotina que relê as disputas abertas (`conferirContestacoes`), a busca semanal das disputas
 * tardias (`buscarContestacoesTardias`) e os e-mails à equipe (abertura e prazo dos documentos). A leitura sob a trava
 * (casamento, transições, valor em risco, retido, substituição das devoluções, avisos) mora em `contestacao-leitura.ts`,
 * que `aplicarLeitura` também usa.
 *
 * Toda chamada ao provedor acontece fora de transação; toda gravação em `contestacoes_pagamento` e `eventos_contestacao`
 * acontece dentro de `travarCotacao` (a ordem única das travas). Ler usa o provedor de conferência; o registro pela equipe
 * segue sem ele (com "sem leitura do Mercado Pago" na nota). Nada de dado pessoal: só ids do Mercado Pago, códigos, valores
 * e datas; as notas passam por `textoSemDadosPessoais`.
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { violouUnicidade } from "@/db/erros";
import { contestacoesPagamento, eventosContestacao, imoveis, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { avisarEquipePorEmail } from "@/email/aviso-equipe";
import type { Correio } from "@/email/correio";
import { ERRO_DADOS_PESSOAIS, textoSemDadosPessoais } from "@/lib/dados-pessoais";
import { hojeISO, instanteLocal } from "@/lib/datas";
import { dataValida } from "@/reservas/regras";
import { inicioDoPrazoDeReleitura } from "./andamento";
import { conferirTentativa } from "./conferencia";
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
  trocarAvisosDaContestacao,
} from "./contestacao-leitura";
import {
  casarContestacao,
  casoDestePagamento,
  contestacaoNaoFinal,
  esperaDaLeituraDaContestacao,
  type FonteEventoContestacao,
  JANELA_CONTESTACAO_TARDIA,
  LEITURAS_DE_CONTESTACAO_POR_VOLTA,
  type LeituraDeContestacao,
  LIMITE_NOTA_CONTESTACAO,
  naJanelaTardia,
  NOMES_TIPO_CONTESTACAO,
  NOTA_SEM_LEITURA,
  novaContestacao,
  ORCAMENTO_VOLTA_CONTESTACAO_MS,
  PRAZO_LEITURA_CONTESTACAO_DIAS,
  RELER_CONTESTACAO_A_CADA_MS,
  TEXTO_CASO_DE_OUTRO_PAGAMENTO,
  TEXTO_DISPUTA_JA_NO_QUADRO,
  TIPOS_CONTESTACAO,
  type TipoContestacao,
} from "./contestacao-regras";
import { ErroProvedor, ID_NUMERICO_PROVEDOR, type ProvedorPagamento, semAcessoContestacao } from "./provedor";
import { comDinheiro } from "./situacoes";
import {
  type Contestacao,
  contestacoesDoPagamento,
  devolucaoInexplicada,
  devolucoesDoPagamento,
  devolvidoPelaDisputa,
  type Pagamento,
  pagamentoDaOrganizacao,
  travaOcupada,
  travarCotacao,
  valorPagoAprovado,
} from "./travas";

export * from "./contestacao-leitura";
export { contestacaoDaOrganizacao, pagamentoDaOrganizacao } from "./travas";

const FUSO = "America/Sao_Paulo";
const DIA_MS = 86_400_000;
const dataBr = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
const diaMes = (d: Date) => dataBr(hojeISO(FUSO, d));

export type ResultadoContestacao = { ok: true; contestacaoId: string; mensagem?: string } | { ok: false; erro: string };

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
  const lido: LidoDasFontes = { leituras: [], semAcesso: false, falhou: false, util: false, casosDeOutro: [] };
  const naOrder = !!p.idProvedor && p.criadoEm.getTime() >= inicioDoPrazoDeReleitura(agora).getTime();
  if (o.order && naOrder) {
    const r = await conferirTentativa(db, p.organizacaoId, p.id, provedor, agora, { forcar: true, origem: "rotina" });
    if (!r.ok) lido.falhou = true;
  }
  const casos = [...new Set(linhas.map((l) => l.idCaso).filter((x): x is string => !!x && ID_NUMERICO_PROVEDOR.test(x)))];
  try {
    for (const idCaso of casos) {
      const caso = await provedor.consultarContestacao(idCaso);
      if (semAcessoContestacao(caso)) lido.semAcesso = true;
      else if (caso) {
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
      if (lido.semAcesso) ligar.push("contestacao_sem_leitura");
      if (l.idCaso && lido.casosDeOutro.includes(l.idCaso)) ligar.push("contestacao_caso_de_outro_pagamento");
      else if (l.idCaso && lido.leituras.some((x) => x.idCaso === l.idCaso)) desligar.push("contestacao_caso_de_outro_pagamento");
      // Dia 85 sem fonte: a order não é mais lida e nem a Chargebacks API nem a Payments API disseram algo útil (ou não há
      // caso nem número do pagamento): a equipe confere o resultado no painel do Mercado Pago.
      if (foraDaOrder && !lido.util && !lido.falhou) ligar.push("contestacao_sem_fonte");
      if (await trocarAvisosDaContestacao(tx, l, { ligar, desligar }, agora)) mudou = true;
    }
    if (ef.aoVivo && !pt.avisos.includes("ao_vivo")) pt.avisos = [...pt.avisos, "ao_vivo"];
    await sincronizarAvisosDaDisputa(tx, t, pt, agora, { ambigua: ef.ambigua });
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
    let lista: Awaited<ReturnType<ProvedorPagamento["buscarContestacoes"]>>;
    try {
      lista = await provedor.buscarContestacoes(p.idPagamentoProvedor!);
    } catch (e) {
      if (!(e instanceof ErroProvedor)) throw e;
      // A busca que falhou não conta: a marca volta ao que era (a próxima volta tenta de novo).
      await db.update(pagamentos).set({ contestacoesBuscadasEm: antes }).where(and(eq(pagamentos.id, p.id), eq(pagamentos.contestacoesBuscadasEm, agora)));
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
        await sincronizarAvisosDaDisputa(tx, t, pt, agora, { ambigua: ef.ambigua });
        return ef;
      });
      if (r?.mudou) resumo.mudaram++;
      resumo.novas += r?.novas.length ?? 0;
    } catch (e) {
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
      if (!(erro instanceof ErroProvedor)) throw erro;
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
      if (devolucaoLida) {
        await recalcularDisputas(tx, organizacaoId, t, p, agora, { semCaixa: true });
        await lancarRetidoRealizado(tx, organizacaoId, t, p, linha, agora);
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
      return { ok: true, contestacaoId: linha.id, ...(linha.duplicataPossivel ? { mensagem: "Registrada como possível duplicata de outra disputa do pagamento: confirme que é outra disputa no quadro." } : {}) };
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
