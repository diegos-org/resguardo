/**
 * Pagamento no site (M8.2a) — o lado do site: o que a página da cotação mostra do pagamento, se o Pix seria
 * oferecido numa consulta, as mensagens curtas para o hóspede e a rota que a página consulta enquanto espera.
 * Nada daqui devolve dado pessoal; o QR só sai com a autorização do pedido (o cookie, lido por quem chama).
 * As regras ficam no domínio (`@/pagamentos`): aqui só se escolhe o que mostrar.
 *
 * Cartão (M8.2b): a oferta do cartão ao lado da do Pix, o formulário (chave pública, valor, parcelas) só com o cookie, e
 * uma lista fechada de mensagens: toda recusa do banco ou da análise de risco tem o mesmo texto (quem testa cartões
 * roubados usa textos diferentes como oráculo).
 *
 * Alteração da reserva paga (M8.2d): a vista da alteração vem junto (`alteracao`); no aumento com as datas seguradas, o
 * pagamento da diferença tem a própria oferta (Pix e cartão, conferidas para a alteração) e o mesmo formato do da cotação.
 */
import { and, eq } from "drizzle-orm";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { cotacoes, imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { autorizacaoValida } from "@/pagamentos/autorizacao";
import { type CodigoFalhaCartao, MAXIMO_CARTAO_POR_COTACAO } from "@/pagamentos/cartao";
import { conferirCotacaoParaPagina } from "@/pagamentos/conferencia";
import { vistaDaCotacaoParaHospede } from "@/pagamentos/consultas";
import { disjuntorAberto } from "@/pagamentos/disjuntor";
import { ESPERA_TELA_MS } from "@/lib/prazo";
import { conferirLimite, ERROS_LIMITE } from "@/pagamentos/limites";
import { EMAIL_PAGADOR_SANDBOX } from "@/pagamentos/mercadopago";
import { chavePublicaValida, type MotivoSemPix, ofertaDeCartao, ofertaDePix, type PortaoCobranca, pendenciaDoMotor, podeCobrar, provedorDeConferencia, TEXTO_SEM_COBRANCA } from "@/pagamentos/oferta";
import { type CodigoFalhaPix, MAXIMO_PIX_POR_COTACAO } from "@/pagamentos/pix";
import type { ProvedorPagamento } from "@/pagamentos/provedor";
import { codigoCotacaoValido, obterCotacao } from "./cotacoes";
import {
  MENSAGEM_ACEITE_PENDENTE_CARTAO,
  MENSAGEM_CARTAO_INCERTO,
  MENSAGEM_CARTAO_RECUSADO,
  MENSAGEM_PROVEDOR_CARTAO,
  MENSAGEM_SO_CREDITO,
  MENSAGEM_VERIFICACAO_NAO_CONCLUIDA,
} from "./mensagens-cartao";
import { type CartaoNaPagina, estadoQuePaga, type PagamentoDoHospede, paraOHospede } from "./pagamento-vista";

/** Mensagens para o hóspede de cada falha ao gerar o Pix (nunca o texto do provedor nem o motivo interno). */
export const MENSAGENS_PIX_HOSPEDE: Record<CodigoFalhaPix, string> = {
  nao_encontrada: "Cotação não encontrada.",
  nao_oferecido: "O pagamento pelo site não está disponível para esta cotação agora. Fale com a equipe pelo WhatsApp.",
  em_andamento: "Estamos conferindo o Pix gerado há pouco. A página atualiza sozinha em instantes.",
  em_analise: "Há um pagamento com cartão desta cotação em análise no Mercado Pago. Enquanto a análise não termina, não dá para pagar de outro jeito: fale com a equipe pelo WhatsApp se precisar.",
  ja_pago: "Já recebemos um pagamento desta cotação.",
  limite: `Esta cotação já gerou ${MAXIMO_PIX_POR_COTACAO} Pix. Para continuar, fale com a equipe pelo WhatsApp.`,
  provedor: "Não deu para gerar o Pix agora. Tente de novo em instantes ou fale com a equipe pelo WhatsApp.",
  incerto: "Não deu para confirmar se o Pix foi gerado. Atualize a página em instantes: nada é cobrado duas vezes.",
  recusado: "O Mercado Pago não aceitou gerar o Pix agora. Tente de novo ou fale com a equipe pelo WhatsApp.",
  ocupado: "Muitos pedidos neste apartamento agora. Tente de novo em instantes.",
  ao_vivo: "O pagamento pelo site não está disponível agora. Fale com a equipe pelo WhatsApp.",
  aceite_pendente: "Para gerar o Pix, marque que leu e aceita os Termos de uso e a Política de cancelamento.",
  aceite_mudou: "Os termos ou as políticas do site mudaram enquanto a página estava aberta. Leia a versão atual e marque de novo.",
  alteracao_mudou: "A alteração da sua reserva mudou enquanto a página estava aberta: atualize a página.",
};

/** Sem o cookie do pedido (outro aparelho, link repassado): nada é gerado. */
export const MENSAGEM_SEM_AUTORIZACAO = "Para pagar neste aparelho, use \"Continuar o pagamento\" com o e-mail informado ao segurar as datas.";
export const MENSAGEM_INDISPONIVEL = "O pagamento pelo site não está disponível agora. Fale com a equipe pelo WhatsApp.";

/**
 * Mensagens para o hóspede de cada falha do cartão (M8.2b). Toda recusa do banco ou da análise de risco tem o mesmo
 * texto, qualquer que seja o motivo; nunca um limite em números, nunca quando o disjuntor religa, nunca o texto do
 * provedor. Não são editáveis no painel (precisam continuar genéricas).
 */
export const MENSAGENS_CARTAO_HOSPEDE: Record<CodigoFalhaCartao, string> = {
  nao_encontrada: "Cotação não encontrada.",
  nao_oferecido: "O pagamento pelo site não está disponível para esta cotação agora. Fale com a equipe pelo WhatsApp.",
  indisponivel: "O pagamento com cartão não está disponível agora. Pague com Pix ou fale com a equipe pelo WhatsApp.",
  em_andamento: "Estamos conferindo um pagamento desta cotação. A página atualiza sozinha.",
  em_analise: "Há um pagamento com cartão desta cotação em análise no Mercado Pago. Enquanto a análise não termina, não dá para pagar de outro jeito: fale com a equipe pelo WhatsApp se precisar.",
  ja_pago: "Já recebemos um pagamento desta cotação.",
  limite: `Esta cotação já teve ${MAXIMO_CARTAO_POR_COTACAO} tentativas com cartão. Pague com Pix ou fale com a equipe pelo WhatsApp.`,
  limite_geral: ERROS_LIMITE.cartao,
  parcelas: "Confira o número de parcelas e tente de novo.",
  so_credito: MENSAGEM_SO_CREDITO,
  dados_cartao: "Os dados do cartão expiraram. Preencha de novo.",
  recusado: MENSAGEM_CARTAO_RECUSADO,
  verificacao: MENSAGEM_VERIFICACAO_NAO_CONCLUIDA,
  provedor: MENSAGEM_PROVEDOR_CARTAO,
  incerto: MENSAGEM_CARTAO_INCERTO,
  // Só antes de o cartão chegar ao Mercado Pago (depois, uma trava ocupada é "incerto").
  ocupado: "Muitos pedidos neste apartamento agora. Tente de novo em instantes.",
  ao_vivo: MENSAGEM_INDISPONIVEL,
  aceite_pendente: MENSAGEM_ACEITE_PENDENTE_CARTAO,
  aceite_mudou: "Os termos ou as políticas do site mudaram enquanto a página estava aberta. Leia a versão atual e marque de novo.",
  prazo: "O prazo das datas desta cotação acabou durante o pagamento: nada foi cobrado.",
  alteracao_mudou: "A alteração da sua reserva mudou enquanto a página estava aberta: atualize a página.",
};

/** Por que o Pix não é oferecido, em linguagem do hóspede (o motivo interno fica no painel). */
export function mensagemSemPix(m: MotivoSemPix): string {
  if (m === "cotacao_nao_encontrada") return MENSAGENS_PIX_HOSPEDE.nao_encontrada;
  if (m === "prazo_vencido") return "O prazo das datas desta cotação acabou.";
  if (m === "nao_segurada") return "As datas desta cotação não estão seguradas.";
  return MENSAGENS_PIX_HOSPEDE.nao_oferecido;
}

/**
 * M8.2d: por que o pagamento da diferença de uma alteração não é oferecido, em linguagem do hóspede. A alteração que não
 * existe mais nesta cotação ou não está mais segurada (aplicada, desistida, outra): a página mudou; o prazo das novas
 * datas acabou: a reserva continua como estava.
 */
export function mensagemSemPixDaAlteracao(m: MotivoSemPix): string {
  if (m === "cotacao_nao_encontrada" || m === "nao_segurada") return MENSAGENS_PIX_HOSPEDE.alteracao_mudou;
  if (m === "prazo_vencido") return "O prazo das novas datas acabou: a sua reserva continua como estava.";
  return MENSAGENS_PIX_HOSPEDE.nao_oferecido;
}

/**
 * As travas do pagamento para as telas do site; qualquer falha inesperada = não cobra (deny-by-default). A conferência
 * da conta no Mercado Pago espera no máximo `esperaMs` (padrão `ESPERA_TELA_MS`, 2 s): passou disso, não cobra e a
 * página segue (a consulta, a ficha e a cotação nunca ficam presas a um Mercado Pago lento).
 */
export async function portaoDoSite(
  db: Db,
  organizacaoId: string,
  agora: Date = new Date(),
  o: { env?: NodeJS.ProcessEnv; provedor?: ProvedorPagamento; esperaMs?: number; chavePublica?: string | null } = {},
): Promise<PortaoCobranca> {
  try {
    return await podeCobrar(db, organizacaoId, o.env ?? process.env, agora, { provedor: o.provedor, esperaMs: o.esperaMs ?? ESPERA_TELA_MS, chavePublica: o.chavePublica });
  } catch {
    return { ok: false, motivo: "conta_nao_conferida", texto: TEXTO_SEM_COBRANCA.conta_nao_conferida };
  }
}

/**
 * O site ofereceria o Pix para esta estadia (consulta e cotação ainda aberta)? As travas, a situação disponível com
 * valor, o imóvel no site e o mesmo cálculo do motor em seco que a oferta usa. Só decide textos: quem cobra de fato
 * confere tudo de novo na cotação segurada (`ofertaDePix`).
 */
export async function pixPossivel(
  db: Db,
  organizacaoId: string,
  e: { imovel: { id: string } | { codigo: string }; checkin: string; checkout: string; situacao: string; total: number | null },
  gate: PortaoCobranca,
): Promise<boolean> {
  if (!gate.ok || e.situacao !== "disponivel" || e.total === null) return false;
  const filtro = "id" in e.imovel ? eq(imoveis.id, e.imovel.id) : eq(imoveis.codigo, e.imovel.codigo);
  const [im] = await db.select({ id: imoveis.id }).from(imoveis).where(and(eq(imoveis.organizacaoId, organizacaoId), filtro, eq(imoveis.publico, true), eq(imoveis.ativo, true)));
  if (!im) return false;
  return (await pendenciaDoMotor(db, organizacaoId, im.id, e.checkin, e.checkout, e.total)) === null;
}

/**
 * O que a página da cotação mostra do pagamento (a mesma resposta na página e na rota). "pagar", "Gerar outro Pix" e o
 * cartão só quando o site oferece aquela forma nesta cotação — a oferta (travas, motor em seco e, no cartão, a chave do
 * painel, o disjuntor e as tentativas que sobram) só é conferida nas situações que podem pagar (`ESTADOS_QUE_PAGAM`) —
 * e nunca depois de um pagamento marcado como real (live_mode) no teste. O formulário do cartão (chave pública, valor e
 * parcelas) só vai com a autorização do pedido. Dinheiro ou pagamento sem desfecho nunca aparece como "sem pagamento"
 * nem como "Pix esgotado": a página mostra "conferindo" e continua consultando (um Pix pago no último instante ainda
 * confirma).
 */
export async function vistaDoPagamento(
  db: Db,
  organizacaoId: string,
  cotacaoId: string,
  agora: Date,
  o: { comAutorizacao: boolean; gate: () => Promise<PortaoCobranca> },
): Promise<PagamentoDoHospede | null> {
  let vista = await vistaDaCotacaoParaHospede(db, organizacaoId, cotacaoId, agora, { comAutorizacao: o.comAutorizacao });
  let podeGerar = false;
  let cartao: CartaoNaPagina | null = null;
  // Pagamento marcado como real (live_mode) no teste: nenhum outro é oferecido nesta cotação (o domínio também recusa).
  if (vista && !vista.aoVivo && estadoQuePaga(vista.estado) && vista.holdAte) {
    const gate = await o.gate();
    const oferta = await ofertaDePix(db, organizacaoId, cotacaoId, agora, gate);
    // Com um Pix aguardando, não há "Gerar Pix" (o domínio reaproveitaria o mesmo): só o cartão é outra forma.
    podeGerar = oferta.oferecer && vista.pixRestantes > 0 && vista.estado !== "pix_aguardando";
    // O cartão tem todas as condições do Pix e mais as dele: sem o Pix oferecido, nem se confere o cartão.
    if (oferta.oferecer && vista.cartaoRestantes > 0) {
      const doCartao = await ofertaDeCartao(db, organizacaoId, cotacaoId, agora, gate);
      if (doCartao.oferecer) {
        const [c] = await db.select({ total: cotacoes.total }).from(cotacoes).where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
        if (c) cartao = { chavePublica: doCartao.chavePublica, valor: c.total, parcelasMaximas: doCartao.parcelasMaximas, emailTeste: gate.ok && gate.ambiente === "teste" ? EMAIL_PAGADOR_SANDBOX : null };
      }
    }
    if (oferta.oferecer && vista.estado === "sem_pagamento") vista = await vistaDaCotacaoParaHospede(db, organizacaoId, cotacaoId, agora, { comAutorizacao: o.comAutorizacao, oferecido: true });
  }
  if (!vista) return null;
  // M8.2d: a diferença de uma alteração segurada (aumento) se paga na mesma página, com a oferta conferida para ela.
  let diferenca: { podeGerar: boolean; cartao: CartaoNaPagina | null } | null = null;
  const alt = vista.alteracao;
  if (alt?.situacao === "segurada" && alt.rumo === "aumento" && alt.pagamento && !alt.pagamento.aoVivo && estadoQuePaga(alt.pagamento.estado) && alt.holdAte) {
    const gate = await o.gate();
    const oferta = await ofertaDePix(db, organizacaoId, cotacaoId, agora, gate, { alteracaoId: alt.id });
    let cartaoDaDiferenca: CartaoNaPagina | null = null;
    if (oferta.oferecer && alt.pagamento.cartaoRestantes > 0) {
      const doCartao = await ofertaDeCartao(db, organizacaoId, cotacaoId, agora, gate, { alteracaoId: alt.id });
      if (doCartao.oferecer) cartaoDaDiferenca = { chavePublica: doCartao.chavePublica, valor: alt.diferenca, parcelasMaximas: doCartao.parcelasMaximas, emailTeste: gate.ok && gate.ambiente === "teste" ? EMAIL_PAGADOR_SANDBOX : null };
    }
    diferenca = { podeGerar: oferta.oferecer && alt.pagamento.pixRestantes > 0 && alt.pagamento.estado !== "pix_aguardando", cartao: cartaoDaDiferenca };
    if (oferta.oferecer && alt.pagamento.estado === "sem_pagamento") vista = (await vistaDaCotacaoParaHospede(db, organizacaoId, cotacaoId, agora, { comAutorizacao: o.comAutorizacao, oferecido: false, oferecidoAlteracao: true })) ?? vista;
  }
  const r: PagamentoDoHospede = { ...paraOHospede(vista), podeGerar, podePagarCartao: cartao !== null, cartao: o.comAutorizacao ? cartao : null };
  if (r.alteracao?.pagamento && diferenca)
    r.alteracao = { ...r.alteracao, pagamento: { ...r.alteracao.pagamento, podeGerar: diferenca.podeGerar, podePagarCartao: diferenca.cartao !== null, cartao: o.comAutorizacao ? diferenca.cartao : null } };
  const semOferta = { podeGerar: false, podePagarCartao: false, cartao: null };
  if ((r.estado === "sem_pagamento" || r.estado === "pix_esgotado") && r.dinheiroSemDesfecho) return { ...r, ...semOferta, estado: "verificando" };
  // Sem pagamento a mostrar, mas um Pix recusado, cancelado ou vencido há pouco ainda pode virar dinheiro (mesmo com o
  // prazo das datas acabado): "conferindo", para a página continuar acompanhando até o fim da leitura (`acompanhar`).
  if (r.estado === "sem_pagamento" && r.acompanhar) return { ...r, ...semOferta, estado: "verificando" };
  return r;
}

/**
 * O cartão está ligado no site agora (as travas com a chave pública, "Oferecer cartão de crédito" no painel e o
 * disjuntor fechado)? Só para os textos da cotação ("por Pix ou cartão"): quem oferece de fato é `ofertaDeCartao`.
 */
export async function cartaoNoSite(db: Db, organizacaoId: string, gate: PortaoCobranca, agora: Date = new Date()): Promise<boolean> {
  if (!gate.ok || !chavePublicaValida(gate.chavePublica)) return false;
  try {
    if (!(await lerConfigPagamentoSite(db, organizacaoId)).cartao) return false;
    return !(await disjuntorAberto(db, organizacaoId, agora));
  } catch {
    return false;
  }
}

export const CACHE_PAGAMENTO = "no-store";
const resposta = (status: number, corpo: object, extra: Record<string, string> = {}) =>
  Response.json(corpo, { status, headers: { "Cache-Control": CACHE_PAGAMENTO, "X-Content-Type-Options": "nosniff", ...extra } });

/**
 * Rota que a página da cotação consulta enquanto espera o pagamento (`GET /reservar/<código>/pagamento`). Freio por
 * endereço de internet (e geral) antes de qualquer leitura; confere a tentativa em andamento com o provedor (no
 * máximo uma leitura a cada 15 s por tentativa, regra do domínio); devolve a vista, com o QR só para quem tem o
 * cookie do pedido. Sem cache. A conferência roda para qualquer um (só lê o provedor e aplica o que ele diz); o
 * cookie protege o QR e a geração do Pix.
 */
export async function responderPagamento(
  db: Db,
  codigoBruto: string,
  o: {
    organizacao: () => Promise<string | null>;
    token: (cotacaoId: string) => string | undefined;
    origem: string | null;
    agora?: Date;
    env?: NodeJS.ProcessEnv;
    provedor?: ProvedorPagamento;
    /** Com o provedor injetado (testes): a chave pública do formulário do cartão. */
    chavePublica?: string | null;
    /** Espera máxima pela conferência da conta no Mercado Pago (padrão `ESPERA_TELA_MS`). */
    esperaMs?: number;
  },
): Promise<Response> {
  const agora = o.agora ?? new Date();
  const codigo = codigoBruto.trim().toUpperCase();
  if (!codigoCotacaoValido(codigo)) return resposta(400, { erro: "Código inválido." });
  const organizacaoId = await o.organizacao();
  if (!organizacaoId) return resposta(404, { erro: "Não encontrado." });
  const limite = await conferirLimite(db, organizacaoId, "consulta", o.origem, agora);
  if (!limite.ok) return resposta(429, { erro: limite.erro }, { "Retry-After": "60" });
  const c = await obterCotacao(db, organizacaoId, codigo);
  if (!c) return resposta(404, { erro: "Não encontrado." });
  const env = o.env ?? process.env;
  try {
    const esperaMs = o.esperaMs ?? ESPERA_TELA_MS;
    const conferir = await provedorDeConferencia(env, agora, { provedor: o.provedor, esperaMs });
    if (conferir.ok) await conferirCotacaoParaPagina(db, organizacaoId, c.id, conferir.provedor, agora);
  } catch {
    // Falha ao conferir não derruba a consulta: a página mostra o que o banco já sabe e tenta de novo depois.
    console.warn("[site] conferência do pagamento falhou na consulta da página");
  }
  const vista = await vistaDoPagamento(db, organizacaoId, c.id, agora, {
    comAutorizacao: autorizacaoValida(o.token(c.id), c.id, agora),
    gate: () => portaoDoSite(db, organizacaoId, agora, { env, provedor: o.provedor, esperaMs: o.esperaMs, chavePublica: o.chavePublica }),
  });
  return vista ? resposta(200, vista) : resposta(404, { erro: "Não encontrado." });
}
