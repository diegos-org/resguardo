/**
 * Pagamento no site (M8.2a) — o lado do site: o que a página da cotação mostra do pagamento, se o Pix seria
 * oferecido numa consulta, as mensagens curtas para o hóspede e a rota que a página consulta enquanto espera.
 * Nada daqui devolve dado pessoal; o QR só sai com a autorização do pedido (o cookie, lido por quem chama).
 * As regras ficam no domínio (`@/pagamentos`): aqui só se escolhe o que mostrar.
 */
import { and, eq } from "drizzle-orm";
import { imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { autorizacaoValida } from "@/pagamentos/autorizacao";
import { conferirCotacaoParaPagina } from "@/pagamentos/conferencia";
import { vistaDaCotacaoParaHospede } from "@/pagamentos/consultas";
import { ESPERA_TELA_MS } from "@/lib/prazo";
import { conferirLimite } from "@/pagamentos/limites";
import { type MotivoSemPix, ofertaDePix, type PortaoCobranca, pendenciaDoMotor, podeCobrar, provedorDeConferencia, TEXTO_SEM_COBRANCA } from "@/pagamentos/oferta";
import { type CodigoFalhaPix, MAXIMO_PIX_POR_COTACAO } from "@/pagamentos/pix";
import type { ProvedorPagamento } from "@/pagamentos/provedor";
import { codigoCotacaoValido, obterCotacao } from "./cotacoes";
import { type PagamentoDoHospede, paraOHospede } from "./pagamento-vista";

/** Mensagens para o hóspede de cada falha ao gerar o Pix (nunca o texto do provedor nem o motivo interno). */
export const MENSAGENS_PIX_HOSPEDE: Record<CodigoFalhaPix, string> = {
  nao_encontrada: "Cotação não encontrada.",
  nao_oferecido: "O pagamento pelo site não está disponível para esta cotação agora. Fale com a equipe pelo WhatsApp.",
  em_andamento: "Estamos conferindo o Pix gerado há pouco. A página atualiza sozinha em instantes.",
  ja_pago: "Já recebemos um pagamento desta cotação.",
  limite: `Esta cotação já gerou ${MAXIMO_PIX_POR_COTACAO} Pix. Para continuar, fale com a equipe pelo WhatsApp.`,
  provedor: "Não deu para gerar o Pix agora. Tente de novo em instantes ou fale com a equipe pelo WhatsApp.",
  incerto: "Não deu para confirmar se o Pix foi gerado. Atualize a página em instantes: nada é cobrado duas vezes.",
  recusado: "O Mercado Pago não aceitou gerar o Pix agora. Tente de novo ou fale com a equipe pelo WhatsApp.",
  ocupado: "Muitos pedidos neste apartamento agora. Tente de novo em instantes.",
  ao_vivo: "O pagamento pelo site não está disponível agora. Fale com a equipe pelo WhatsApp.",
  aceite_pendente: "Para gerar o Pix, marque que leu e aceita os Termos de uso e a Política de cancelamento.",
  aceite_mudou: "Os termos ou as políticas do site mudaram enquanto a página estava aberta. Leia a versão atual e marque de novo.",
};

/** Sem o cookie do pedido (outro aparelho, link repassado): nada é gerado. */
export const MENSAGEM_SEM_AUTORIZACAO = "Para pagar neste aparelho, use \"Continuar o pagamento\" com o e-mail informado ao segurar as datas.";
export const MENSAGEM_INDISPONIVEL = "O pagamento pelo site não está disponível agora. Fale com a equipe pelo WhatsApp.";

/** Por que o Pix não é oferecido, em linguagem do hóspede (o motivo interno fica no painel). */
export function mensagemSemPix(m: MotivoSemPix): string {
  if (m === "cotacao_nao_encontrada") return MENSAGENS_PIX_HOSPEDE.nao_encontrada;
  if (m === "prazo_vencido") return "O prazo das datas desta cotação acabou.";
  if (m === "nao_segurada") return "As datas desta cotação não estão seguradas.";
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
  o: { env?: NodeJS.ProcessEnv; provedor?: ProvedorPagamento; esperaMs?: number } = {},
): Promise<PortaoCobranca> {
  try {
    return await podeCobrar(db, organizacaoId, o.env ?? process.env, agora, { provedor: o.provedor, esperaMs: o.esperaMs ?? ESPERA_TELA_MS });
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
 * O que a página da cotação mostra do pagamento (a mesma resposta na página e na rota). "pagar" e "Gerar outro Pix"
 * só quando o site oferece o Pix nesta cotação — a oferta (travas e motor em seco) só é conferida quando é ela que
 * decide — e nunca depois de um Pix marcado como real (live_mode) no teste. Dinheiro ou Pix sem desfecho nunca
 * aparece como "sem pagamento" nem como "Pix esgotado": a página mostra "conferindo" e continua consultando (um Pix
 * pago no último instante ainda confirma).
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
  // Pix marcado como real (live_mode) no teste: nenhum outro é oferecido nesta cotação (o domínio também recusa).
  if (vista && !vista.pixAoVivo && (vista.estado === "sem_pagamento" || vista.estado === "pix_vencido") && vista.holdAte) {
    const oferta = await ofertaDePix(db, organizacaoId, cotacaoId, agora, await o.gate());
    podeGerar = oferta.oferecer;
    if (oferta.oferecer && vista.estado === "sem_pagamento") vista = await vistaDaCotacaoParaHospede(db, organizacaoId, cotacaoId, agora, { comAutorizacao: o.comAutorizacao, oferecido: true });
  }
  if (!vista) return null;
  const r = { ...paraOHospede(vista), podeGerar };
  if ((r.estado === "sem_pagamento" || r.estado === "pix_esgotado") && r.dinheiroSemDesfecho) return { ...r, estado: "verificando", podeGerar: false };
  // Sem pagamento a mostrar, mas um Pix recusado, cancelado ou vencido há pouco ainda pode virar dinheiro (mesmo com o
  // prazo das datas acabado): "conferindo", para a página continuar acompanhando até o fim da leitura (`acompanhar`).
  if (r.estado === "sem_pagamento" && r.acompanhar) return { ...r, estado: "verificando", podeGerar: false };
  return r;
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
    gate: () => portaoDoSite(db, organizacaoId, agora, { env, provedor: o.provedor, esperaMs: o.esperaMs }),
  });
  return vista ? resposta(200, vista) : resposta(404, { erro: "Não encontrado." });
}
