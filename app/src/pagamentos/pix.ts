/**
 * Pagamento no site (M8.2a) — gerar o Pix de uma cotação segurada, em três fases (como o envio ao Beds24):
 *
 * 1. Transação curta, com a ordem única das travas (imóvel → reserva → cotação → tentativas) e tempo-limite de
 *    espera: confere a oferta, reaproveita um Pix ainda válido (mesmo QR, mesmo prazo), confere o aceite das páginas
 *    legais nas versões publicadas agora (M7.4; o aceite enviado junto é gravado nesta mesma transação), respeita o
 *    teto de 3 Pix por cotação (antes de cancelar qualquer coisa), manda cancelar antes o Pix pendente anterior, grava
 *    a tentativa `criando` (referência, chave de idempotência e o aceite que valia) e estende provisoriamente o prazo
 *    das datas para agora + validade + 2 minutos.
 * 2. A chamada ao provedor, sem transação.
 * 3. Transação curta: aplica o que voltou e estende o prazo das datas até o vencimento do Pix + 2 minutos (só com
 *    o pedido ainda em `pedido` e a cotação `segurada`; senão o Pix é cancelado). Assim o QR nunca vale mais que as
 *    datas. Resposta perdida = `incerta`, resolvida depois pela referência (nunca com uma order nova). Pedido que
 *    não chegou ao provedor apaga a tentativa e desfaz a extensão provisória; Pix marcado como real (live_mode) no
 *    teste é cancelado na hora e a resposta é de falha — e, depois dele, a cotação não gera outro Pix (nem mostra
 *    aquele de novo, mesmo que o cancelamento tenha falhado).
 *
 * Trava não obtida (tempo-limite ou impasse desfeito pelo Postgres) em qualquer transação = "ocupado": nada foi
 * gravado pela metade e o hóspede tenta de novo.
 *
 * Com o cartão (M8.2b): um cartão no desafio do banco é cancelado no provedor antes do Pix (o hóspede desistiu da
 * verificação para pagar por Pix); um cartão em análise impede o Pix (`em_analise`), e um processando, `em_andamento`.
 *
 * O e-mail e o nome do pagador saem da reserva, no servidor (no teste, o adaptador troca o e-mail pelo do
 * sandbox); a página nunca os recebe.
 *
 * A diferença de uma alteração da reserva paga (M8.2d, `o.alteracaoId`): o mesmo caminho, na mesma cotação, com o alvo da
 * cobrança (`alvoDaCobranca`): o valor é a diferença, o prazo é o das datas seguradas da alteração, e "já pago", "em
 * andamento", "em análise", o Pix anterior a cancelar e o teto de 3 Pix contam só as tentativas desta alteração. Um
 * pagamento marcado como real (live_mode) em qualquer tentativa da cotação continua impedindo todo Pix novo. O aceite é o
 * dos Termos e da Privacidade em vigor com a política da reserva (D11).
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { nomeNaFatura } from "@/configuracoes/pagamento-site";
import type { VersoesLegais } from "@/configuracoes/paginas-legais-texto";
import { travaOcupada } from "@/db/erros";
import { pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { aceiteVigenteTravado, versaoDaPoliticaDoPagamento } from "@/site/aceites";
import { type AlvoDaCobranca, alvoDaCobranca, falhaDoAlvo, TEXTO_ALTERACAO_MUDOU } from "./alvo";
import { FOLGA_PRAZO_PIX_MS, MAXIMO_PIX_POR_COTACAO } from "./andamento";
import { aplicarLeitura } from "./aplicar";
import { cancelarNoProvedor, chaveCancelamento } from "./conferencia";
import { chaveCriacao, conferirOuOcupado, leituraDaCriacao, referenciaDaTentativa, relerEncerradasRecentes } from "./criacao";
import { motivoSemPixDaAlteracao, motivoSemPixDaCotacao, TEXTO_SEM_PIX } from "./oferta";
import { ErroProvedor, type PedidoPix, PIX_VALIDADE_MINIMA_MINUTOS, type ProvedorPagamento, type ResultadoCriacao } from "./provedor";
import { comDinheiro, type SituacaoPagamento } from "./situacoes";
import { type Travado, travarCotacao } from "./travas";

export { FOLGA_PRAZO_PIX_MS, MAXIMO_PIX_POR_COTACAO };
// Movidas para `criacao.ts` (o cartão usa as mesmas); reexportadas aqui para quem já importava do Pix.
export { chaveCriacao, conferirOuOcupado, leituraDaCriacao, referenciaDaTentativa };
/** Pix que vence em menos de um minuto não é mostrado de novo: gera-se outro. */
export const MARGEM_PIX_VALIDO_MS = 60_000;

export type CodigoFalhaPix =
  | "nao_encontrada"
  | "nao_oferecido"
  | "em_andamento"
  | "em_analise"
  | "ja_pago"
  | "limite"
  | "provedor"
  | "incerto"
  | "recusado"
  | "ocupado"
  | "ao_vivo"
  | "aceite_pendente"
  | "aceite_mudou"
  | "alteracao_mudou";
export type ResultadoPix = { ok: true; pagamentoId: string; reaproveitado: boolean } | { ok: false; erro: string; codigo: CodigoFalhaPix };

const MENSAGENS: Record<CodigoFalhaPix, string> = {
  nao_encontrada: "Cotação não encontrada.",
  nao_oferecido: "O pagamento pelo site não está disponível para esta cotação: fale com a equipe.",
  em_andamento: "Estamos conferindo o Pix gerado há pouco. Atualize a página em instantes.",
  em_analise: "Há um pagamento com cartão desta cotação em análise no Mercado Pago. Enquanto a análise não termina, não dá para pagar de outro jeito: fale com a equipe pelo WhatsApp se precisar.",
  ja_pago: "Já recebemos um pagamento desta cotação.",
  limite: `Esta cotação já gerou ${MAXIMO_PIX_POR_COTACAO} Pix. Para continuar, fale com a equipe.`,
  provedor: "Não deu para falar com o Mercado Pago agora. Tente de novo em instantes ou fale com a equipe.",
  incerto: "Não deu para confirmar se o Pix foi criado. Atualize a página em instantes: nada é cobrado duas vezes.",
  recusado: "O Mercado Pago não aceitou gerar o Pix agora. Tente de novo ou fale com a equipe.",
  ocupado: "Muitos pedidos neste apartamento agora. Tente de novo em instantes.",
  ao_vivo: "O Mercado Pago marcou este Pix como pagamento real no ambiente de teste: ele foi cancelado na hora. Fale com a equipe.",
  aceite_pendente: "Para gerar o Pix, marque que leu e aceita os termos e a política de cancelamento.",
  aceite_mudou: "Os termos ou as políticas mudaram enquanto a página estava aberta: leia a versão atual e marque de novo.",
  alteracao_mudou: TEXTO_ALTERACAO_MUDOU,
};
const falha = (codigo: CodigoFalhaPix, erro = MENSAGENS[codigo]): ResultadoPix => ({ ok: false, codigo, erro });

type Fase1 =
  | { tipo: "erro"; resultado: ResultadoPix }
  | { tipo: "reaproveitar"; id: string }
  | { tipo: "cancelar"; id: string; idProvedor: string }
  | { tipo: "criar"; id: string; pedido: PedidoPix; holdAnterior: Date; holdProvisorio: Date | null };

/**
 * O alvo da cobrança sob as travas e se o site o oferece agora (a cotação segurada, ou a diferença da alteração segurada).
 * Uma regra para o Pix e o cartão (`cartao.ts`): `motivo` é o motivo de não oferecer (texto do painel).
 */
export async function alvoOferecido(
  tx: Db,
  organizacaoId: string,
  t: Travado,
  alteracaoId: string | null,
  agora: Date,
  motivoDaAlteracao: typeof motivoSemPixDaAlteracao = motivoSemPixDaAlteracao,
): Promise<{ alvo: AlvoDaCobranca; motivo: string | null } | { erro: "nao_oferecido" | "alteracao_mudou" }> {
  const achado = alvoDaCobranca(tx, organizacaoId, t, alteracaoId, agora);
  if (falhaDoAlvo(achado)) return achado;
  if (achado.tipo === "reserva") {
    const m = await motivoSemPixDaCotacao(tx, organizacaoId, t.cotacao, t.reserva.estado, agora);
    return { alvo: achado, motivo: m ? TEXTO_SEM_PIX[m] : null };
  }
  const m = await motivoDaAlteracao(tx, organizacaoId, achado.alteracao!, { id: t.reserva.id, imovelId: t.reserva.imovelId, estado: t.reserva.estado, cancelamentoAtivo: !!t.cancelamento }, agora);
  return { alvo: achado, motivo: m ? TEXTO_SEM_PIX[m] : null };
}

/** As versões do aceite que valem para o alvo: na diferença de uma alteração, a política da reserva (a do pagamento que a confirmou). */
export async function politicaDoAlvo(tx: Db, organizacaoId: string, t: Travado, alvo: AlvoDaCobranca): Promise<{ cancelamentoDaReserva?: number | null }> {
  if (alvo.tipo === "reserva") return {};
  const p0 = t.tentativas.find((x) => x.desfecho === "reserva");
  return { cancelamentoDaReserva: p0 ? await versaoDaPoliticaDoPagamento(tx, organizacaoId, p0.id) : null };
}

async function fase1(tx: Db, organizacaoId: string, cotacaoId: string, agora: Date, aceite: VersoesLegais | null, alteracaoId: string | null): Promise<Fase1> {
  const erro = (codigo: CodigoFalhaPix, texto?: string): Fase1 => ({ tipo: "erro", resultado: falha(codigo, texto) });
  const t = await travarCotacao(tx, organizacaoId, cotacaoId);
  if (!t) return erro("nao_encontrada");
  const oferecido = await alvoOferecido(tx, organizacaoId, t, alteracaoId, agora);
  if ("erro" in oferecido) return erro(oferecido.erro);
  const { alvo } = oferecido;
  if (oferecido.motivo) return erro("nao_oferecido", oferecido.motivo);
  // As tentativas do alvo: as da reserva, ou as da diferença desta alteração (M8.2d).
  const doAlvo = alvo.tentativas;
  if (doAlvo.some((x) => x.situacao === "criando" || x.situacao === "incerta")) return erro("em_andamento");
  if (doAlvo.some((x) => comDinheiro(x.situacao))) return erro("ja_pago");
  // Um pagamento desta cotação (Pix ou cartão) já veio marcado como real (live_mode) no teste: nenhum Pix (nem o mesmo,
  // se o cancelamento ainda não pegou) — as tentativas da cotação não se gastam à toa. A equipe confere no painel do
  // Mercado Pago.
  if (t.tentativas.some((x) => x.aoVivo === true)) return erro("ao_vivo", "O Mercado Pago marcou um pagamento desta cotação como pagamento real no ambiente de teste: nenhum Pix é gerado. Fale com a equipe.");
  const pendentes = doAlvo.filter((x) => x.situacao === "pendente");
  // Cartão pendente (M8.2b): em análise, nada de outro jeito (o Mercado Pago não cancela e pode aprovar); processando
  // (ou sem etapa), espera; no desafio do banco com a order conhecida, é cancelado mais abaixo (como um Pix anterior).
  const cartoes = pendentes.filter((x) => x.forma === "cartao");
  if (cartoes.some((x) => x.etapaCartao === "analise")) return erro("em_analise");
  if (cartoes.some((x) => x.etapaCartao !== "desafio" || !x.idProvedor)) return erro("em_andamento");
  const valido = pendentes.find((x) => x.pixCopiaECola && x.pixExpiraEm && x.pixExpiraEm.getTime() > agora.getTime() + MARGEM_PIX_VALIDO_MS);
  // Um Pix ainda válido continua com o aceite com que foi criado, mesmo que uma versão nova tenha sido publicada depois.
  if (valido) return { tipo: "reaproveitar", id: valido.id };
  // M7.4: páginas legais aceitas nas versões publicadas agora (o aceite enviado junto é gravado nesta mesma transação,
  // e fica gravado mesmo que o teto ou o cancelamento abaixo impeçam o Pix desta vez). Recusado: nada é criado.
  const a = await aceiteVigenteTravado(tx, organizacaoId, { cotacaoId, reservaId: t.reserva.id }, aceite, "pix", agora, await politicaDoAlvo(tx, organizacaoId, t, alvo));
  if (!a.ok) return a.motivo === "nao_publicadas" ? erro("nao_oferecido", TEXTO_SEM_PIX.sem_paginas_legais) : erro(a.motivo === "mudou" ? "aceite_mudou" : "aceite_pendente");
  // Teto antes de cancelar: com 3 Pix já gerados, o último (ainda pagável) não é cancelado à toa.
  if (doAlvo.filter((x) => x.forma === "pix").length >= MAXIMO_PIX_POR_COTACAO) return erro("limite");
  // Pix novo só depois de cancelar o anterior no provedor (cancelado, já cancelado ou vencido), ou o cartão no desafio do
  // banco: quem pediu o cancelamento foi o hóspede (conta no disjuntor do cartão, se o desafio tinha endereço).
  const anterior = pendentes.find((x) => x.idProvedor);
  if (anterior) {
    if (!anterior.cancelamentoPor) await tx.update(pagamentos).set({ cancelamentoPor: "hospede", atualizadoEm: agora }).where(and(eq(pagamentos.id, anterior.id), isNull(pagamentos.cancelamentoPor)));
    return { tipo: "cancelar", id: anterior.id, idProvedor: anterior.idProvedor! };
  }
  if (pendentes.length) return erro("em_andamento");

  const id = randomUUID();
  const holdAte = alvo.holdAte!;
  // O Pix vale pelo menos 30 minutos (regra do provedor) e, se as datas ainda valem mais que isso, o mesmo tanto.
  const validade = Math.max(PIX_VALIDADE_MINIMA_MINUTOS, Math.ceil((holdAte.getTime() - agora.getTime()) / 60_000));
  await tx.insert(pagamentos).values({
    id,
    organizacaoId,
    cotacaoId,
    reservaId: t.reserva.id,
    imovelId: t.imovel.id,
    ambiente: "teste",
    forma: "pix",
    referencia: referenciaDaTentativa(id),
    chaveIdempotencia: chaveCriacao(id),
    situacao: "criando",
    valor: alvo.valor,
    aceiteId: a.aceite.id,
    alteracaoId: alvo.alteracaoId,
    criadoEm: agora,
    atualizadoEm: agora,
  });
  // Prazo provisório: a rotina não vence o pedido enquanto a chamada está no ar (desfeito se nada for criado).
  const provisorio = new Date(agora.getTime() + validade * 60_000 + FOLGA_PRAZO_PIX_MS);
  const estendeu = await alvo.estender(provisorio, id);
  const empresa = await nomeDaEmpresa(tx, organizacaoId);
  return {
    tipo: "criar",
    id,
    holdAnterior: holdAte,
    holdProvisorio: estendeu ? provisorio : null,
    pedido: {
      referencia: referenciaDaTentativa(id),
      chaveIdempotencia: chaveCriacao(id),
      valor: alvo.valor,
      email: t.reserva.hospedeEmail,
      nome: t.reserva.hospedeNome,
      validadeMinutos: validade,
      descricao: alvo.descricao(empresa),
      descricaoFatura: await nomeNaFatura(tx, organizacaoId),
    },
  };
}

async function criar(db: Db, organizacaoId: string, cotacaoId: string, f: Extract<Fase1, { tipo: "criar" }>, agora: Date, provedor: ProvedorPagamento): Promise<ResultadoPix> {
  let res: ResultadoCriacao | null = null;
  let erro: unknown = null;
  try {
    res = await provedor.criarPix(f.pedido);
  } catch (e) {
    erro = e;
  }
  const leitura = leituraDaCriacao(res, erro);
  type Fim = { situacao: SituacaoPagamento | null; cancelar: { id: string; idProvedor: string }[]; pedidoValido: boolean; aoVivo: boolean };
  let fim: Fim | null;
  try {
    fim = await db.transaction(async (tx): Promise<Fim | null> => {
      const t = await travarCotacao(tx, organizacaoId, cotacaoId);
      const p = t?.tentativas.find((x) => x.id === f.id);
      if (!t || !p) return null;
      // O alvo da tentativa (a reserva, ou a alteração cuja diferença ela cobra): o prazo dele é o que se estende.
      const achado = alvoDaCobranca(tx, organizacaoId, t, p.alteracaoId, agora, { daLeitura: true });
      const alvo = falhaDoAlvo(achado) ? null : achado;
      if (!leitura) {
        // O pedido não chegou ao provedor (sem conexão, chave recusada, limite de chamadas): nada foi criado, e o
        // prazo provisório das datas volta ao que era.
        await tx.delete(pagamentos).where(eq(pagamentos.id, p.id));
        await desfazerProvisorio(alvo, f);
        return { situacao: null, cancelar: [], pedidoValido: true, aoVivo: false };
      }
      // `aplicarLeitura` atualiza este mesmo objeto (`p`, de `t.tentativas`) com o que gravou: daqui em diante ele já
      // tem o id da order e o prazo do Pix que o provedor devolveu.
      const ef = await aplicarLeitura(tx, organizacaoId, t, p.id, leitura, agora);
      const pedidoValido = !!alvo && alvo.valido(agora);
      const cancelar = [...ef.cancelar];
      // Order marcada como real (live_mode) no teste: falha sempre, seja qual for a situação (pendente, já aprovada...);
      // a pendente a leitura já mandou cancelar. As datas não ficam presas a ela.
      const aoVivo = cancelar.some((x) => x.id === p.id) || leitura.cobranca?.aoVivo === true;
      // Criação recusada pelo provedor (order recusada, ou dados inválidos sem order) ou já encerrada: não há Pix para
      // pagar, e o prazo provisório das datas volta ao que era (10ª rodada do Codex).
      const semPixPagavel = ef.situacao === "recusado" || ef.situacao === "cancelado" || ef.situacao === "expirado";
      if (aoVivo || semPixPagavel) await desfazerProvisorio(alvo, f);
      else if (ef.situacao === "pendente") {
        if (pedidoValido && p.pixExpiraEm) await alvo!.estender(new Date(p.pixExpiraEm.getTime() + FOLGA_PRAZO_PIX_MS), p.id);
        else if (!pedidoValido && p.idProvedor) cancelar.push({ id: p.id, idProvedor: p.idProvedor });
      }
      return { situacao: ef.situacao, cancelar, pedidoValido, aoVivo };
    });
  } catch (e) {
    // A tentativa fica `criando` e é resolvida pela referência na próxima conferência (nada é criado de novo).
    if (travaOcupada(e)) return falha("ocupado");
    throw e;
  }
  if (!fim) return falha("nao_encontrada");
  if (fim.cancelar.length) await cancelarNoProvedor(db, organizacaoId, fim.cancelar, provedor, agora);
  if (fim.situacao === null) return falha("provedor", erro instanceof ErroProvedor ? erro.message : MENSAGENS.provedor);
  if (fim.aoVivo) return falha("ao_vivo");
  if (fim.situacao === "incerta") return falha("incerto");
  // Sem Pix para pagar (recusada, ou criada já cancelada ou vencida): falha, nunca "ok".
  if (fim.situacao === "recusado" || fim.situacao === "cancelado" || fim.situacao === "expirado") return falha("recusado");
  if (fim.situacao === "pendente" && !fim.pedidoValido) return falha("nao_oferecido", "O prazo das datas desta cotação acabou durante a criação do Pix: ele foi cancelado.");
  return { ok: true, pagamentoId: f.id, reaproveitado: false };
}

/** Volta o prazo das datas do alvo ao de antes da extensão provisória da fase 1 (só se ninguém mexeu nele desde então). */
async function desfazerProvisorio(alvo: AlvoDaCobranca | null, f: Extract<Fase1, { tipo: "criar" }>): Promise<void> {
  if (alvo && f.holdProvisorio) await alvo.voltar(f.holdAnterior, f.holdProvisorio, f.id);
}

/**
 * Gera (ou mostra de novo) o Pix da cotação. `provedor` = o liberado por `podeCobrar`. `o.aceite`: as versões das
 * páginas legais que o hóspede acabou de aceitar (a caixa marcada); sem ele, vale o aceite já gravado na cotação.
 * `o.alteracaoId` (M8.2d): o Pix da diferença dessa alteração (a que está com as datas seguradas agora).
 */
export async function gerarPix(
  db: Db,
  organizacaoId: string,
  cotacaoId: string,
  agora: Date,
  provedor: ProvedorPagamento,
  o: { aceite?: VersoesLegais | null; alteracaoId?: string | null } = {},
): Promise<ResultadoPix> {
  if (!uuidValido(cotacaoId)) return falha("nao_encontrada");
  const alteracaoId = o.alteracaoId || null;
  if (alteracaoId && !uuidValido(alteracaoId)) return falha("alteracao_mudou");
  // Antes de qualquer coisa nova: uma criação que ficou no ar é procurada pela referência, e uma tentativa encerrada há
  // pouco (que ainda pode ter sido paga: `paginaAindaLe`) é relida; se virou dinheiro, nenhum outro Pix sai. A pendente
  // fica com a fase 1 (mostrada de novo, ou cancelada e relida antes do novo). Os cliques já passam pelo freio por
  // endereço ("gerar_pix").
  const relida = await relerEncerradasRecentes(db, organizacaoId, cotacaoId, provedor, agora, { alteracaoId });
  if (relida.tipo === "ocupado") return falha("ocupado");
  if (relida.tipo === "provedor") return falha("provedor", relida.erro);
  for (let volta = 0; volta < 3; volta++) {
    let f: Fase1;
    try {
      f = await db.transaction((tx) => fase1(tx, organizacaoId, cotacaoId, agora, o.aceite ?? null, alteracaoId));
    } catch (e) {
      if (travaOcupada(e)) return falha("ocupado");
      throw e;
    }
    if (f.tipo === "erro") return f.resultado;
    if (f.tipo === "reaproveitar") return { ok: true, pagamentoId: f.id, reaproveitado: true };
    if (f.tipo === "criar") return criar(db, organizacaoId, cotacaoId, f, agora, provedor);
    // Cancela o Pix anterior (ou o cartão no desafio) e relê: só a leitura muda a situação (o cancelamento pode cruzar
    // com o pagamento).
    const cancelado = await provedor.cancelar(f.idProvedor, chaveCancelamento(f.id));
    const lido = await conferirOuOcupado(db, organizacaoId, f.id, provedor, agora, { forcar: true, origem: "pagina", semCancelar: true });
    if (lido === null) return falha("ocupado");
    if (!lido.ok) return falha("provedor", lido.erro);
    if (lido.situacao === "pendente") return falha("provedor", cancelado === "erro" ? "Não deu para cancelar o pagamento anterior no Mercado Pago. Tente de novo em instantes." : MENSAGENS.provedor);
  }
  return falha("provedor");
}
