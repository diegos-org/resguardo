"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { origemDoPedido } from "@/acesso/senha";
import { getDb } from "@/db/client";
import { type CodigoFalhaCartao, type DadosCartaoDoHospede, pagarComCartao, type SituacaoCartao } from "@/pagamentos/cartao";
import { conferirEmailDoPedido, conferirLimite } from "@/pagamentos/limites";
import { motivoSoDoCartao, ofertaDeCartao, ofertaDePix } from "@/pagamentos/oferta";
import { gerarPix } from "@/pagamentos/pix";
import { versoesDoFormulario } from "./aceites";
import { autorizadoNaCotacao, gravarAutorizacao } from "./checkout";
import { codigoCotacaoValido, obterCotacao } from "./cotacoes";
import { MENSAGEM_INDISPONIVEL, MENSAGEM_SEM_AUTORIZACAO, MENSAGENS_CARTAO_HOSPEDE, MENSAGENS_PIX_HOSPEDE, mensagemSemPix, portaoDoSite } from "./pagamento";
import { organizacaoDoSite } from "./site";

/** Estado das ações do pagamento no site: só o resultado e uma frase (nenhum dado pessoal). */
export type EstadoPix = { ok?: boolean; erro?: string };
export type EstadoContinuar = { ok?: boolean; erro?: string };
/**
 * Resultado do pagamento com cartão (M8.2b): a situação (aprovado, desafio do banco, em análise, conferindo) ou uma frase
 * de lista fechada. `recarregar`: a página recarrega antes de abrir um formulário novo (tetos, parcelas e oferta frescos).
 * Nunca devolve nada do que foi enviado.
 */
export type EstadoCartao = { ok?: boolean; erro?: string; situacao?: SituacaoCartao; recarregar?: boolean };

const EM_CONFIGURACAO = "O site ainda está em configuração.";
const RECARREGAR_PAGINA = "Recarregue a página e tente de novo.";
const lerCodigo = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase().slice(0, 20) : "");

/**
 * "Gerar Pix" na página da cotação (`codigo` vem ligado pela página; o estado anterior que o `useActionState`
 * acrescenta é ignorado). A organização é a do site, nunca do formulário. Sem o cookie do pedido, recusa antes de
 * gastar qualquer tentativa; depois, o freio por endereço, as travas (`podeCobrar`), a oferta e o domínio
 * (`gerarPix`), que reaproveita um Pix ainda válido. Do formulário só se lê a caixa do aceite das páginas legais e as
 * versões que a página mostrou (M7.4); quem confere se são as publicadas é o domínio, na mesma transação do Pix.
 */
export async function gerarPixAcao(codigo: string, _estado?: EstadoPix, form?: FormData): Promise<EstadoPix> {
  const cod = lerCodigo(codigo);
  if (!codigoCotacaoValido(cod)) return { erro: MENSAGENS_PIX_HOSPEDE.nao_encontrada };
  const db = getDb();
  const organizacaoId = await organizacaoDoSite(db);
  if (!organizacaoId) return { erro: EM_CONFIGURACAO };
  const c = await obterCotacao(db, organizacaoId, cod);
  if (!c) return { erro: MENSAGENS_PIX_HOSPEDE.nao_encontrada };
  const agora = new Date();
  if (!(await autorizadoNaCotacao(c.id, agora))) return { erro: MENSAGEM_SEM_AUTORIZACAO };
  const limite = await conferirLimite(db, organizacaoId, "gerar_pix", origemDoPedido(await headers()), agora);
  if (!limite.ok) return { erro: limite.erro };
  const gate = await portaoDoSite(db, organizacaoId, agora);
  if (!gate.ok) return { erro: MENSAGENS_PIX_HOSPEDE.nao_oferecido };
  const oferta = await ofertaDePix(db, organizacaoId, c.id, agora, gate);
  if (!oferta.oferecer) return { erro: mensagemSemPix(oferta.motivo) };
  const marcado = form?.get("aceite") === "sim";
  const aceite = marcado && form ? versoesDoFormulario(form) : null;
  if (marcado && !aceite) return { erro: RECARREGAR_PAGINA };
  let resultado: EstadoPix;
  try {
    const r = await gerarPix(db, organizacaoId, c.id, agora, gate.provedor, { aceite });
    resultado = r.ok ? { ok: true } : { erro: MENSAGENS_PIX_HOSPEDE[r.codigo] };
  } catch (e) {
    // O registro leva só o tipo do erro (nada da cotação nem do hóspede).
    console.error("[site] falha ao gerar o Pix", e instanceof Error ? e.name : "erro");
    resultado = { erro: MENSAGENS_PIX_HOSPEDE.provedor };
  }
  revalidatePath(`/reservar/${cod}`);
  return resultado;
}

/** Falhas do cartão em que a página recarrega antes de um formulário novo (tetos, parcelas e a oferta mudaram). */
const RECARREGAR: ReadonlySet<CodigoFalhaCartao> = new Set(["parcelas", "indisponivel", "limite_geral", "limite", "em_analise"]);

/**
 * Do formulário do cartão, só os campos conhecidos, cada um com tamanho máximo (maior que isso = vazio, e o domínio
 * recusa): token (gerado pelo formulário do Mercado Pago no navegador), bandeira, tipo, parcelas, documento (repassado
 * ao Mercado Pago, nunca guardado) e o id do aparelho (repassado, nunca guardado). E-mail, valor, emissor, BIN, últimos
 * dígitos e titular nunca são lidos, nem que venham.
 */
function dadosDoFormulario(form: FormData): DadosCartaoDoHospede {
  const campo = (k: string, max: number) => {
    const v = form.get(k);
    return typeof v === "string" && v.length <= max ? v.trim() : "";
  };
  const parcelas = campo("parcelas", 2);
  const documentoTipo = campo("documentoTipo", 10);
  const documentoNumero = campo("documentoNumero", 30);
  return {
    token: campo("token", 128),
    bandeira: campo("bandeira", 40),
    tipo: campo("tipo", 20),
    parcelas: /^\d{1,2}$/.test(parcelas) ? Number(parcelas) : Number.NaN,
    documento: documentoTipo && documentoNumero ? { tipo: documentoTipo, numero: documentoNumero } : null,
    dispositivo: campo("dispositivo", 256) || null,
  };
}

/**
 * "Pagar" no formulário do cartão (M8.2b), na mesma ordem do "Gerar Pix": código → organização do site → cotação →
 * cookie do pedido (sem ele, nada é gasto) → freio por endereço de internet (só a origem: o teto geral é o das
 * tentativas que chegaram ao Mercado Pago, na fase 1 do domínio) → travas (`podeCobrar`) → oferta do cartão → os campos
 * conhecidos do formulário e o aceite das páginas legais → domínio (`pagarComCartao`). O estado devolvido é só a
 * situação ou uma frase da lista fechada (nunca o motivo da recusa nem algo do que foi enviado); o registro de erro leva
 * só o tipo do erro.
 */
export async function pagarComCartaoAcao(codigo: string, form: FormData): Promise<EstadoCartao> {
  const cod = lerCodigo(codigo);
  if (!codigoCotacaoValido(cod)) return { erro: MENSAGENS_CARTAO_HOSPEDE.nao_encontrada };
  const db = getDb();
  const organizacaoId = await organizacaoDoSite(db);
  if (!organizacaoId) return { erro: EM_CONFIGURACAO };
  const c = await obterCotacao(db, organizacaoId, cod);
  if (!c) return { erro: MENSAGENS_CARTAO_HOSPEDE.nao_encontrada };
  const agora = new Date();
  if (!(await autorizadoNaCotacao(c.id, agora))) return { erro: MENSAGEM_SEM_AUTORIZACAO };
  const limite = await conferirLimite(db, organizacaoId, "cartao", origemDoPedido(await headers()), agora, { semGeral: true });
  if (!limite.ok) return { erro: limite.erro };
  const gate = await portaoDoSite(db, organizacaoId, agora);
  if (!gate.ok) return { erro: MENSAGENS_CARTAO_HOSPEDE.nao_oferecido, recarregar: true };
  const oferta = await ofertaDeCartao(db, organizacaoId, c.id, agora, gate);
  if (!oferta.oferecer) return { erro: motivoSoDoCartao(oferta.motivo) ? MENSAGENS_CARTAO_HOSPEDE.indisponivel : mensagemSemPix(oferta.motivo), recarregar: true };
  const marcado = form.get("aceite") === "sim";
  const aceite = marcado ? versoesDoFormulario(form) : null;
  if (marcado && !aceite) return { erro: RECARREGAR_PAGINA, recarregar: true };
  let resultado: EstadoCartao;
  try {
    const r = await pagarComCartao(db, organizacaoId, c.id, agora, gate.provedor, dadosDoFormulario(form), { aceite });
    resultado = r.ok ? { ok: true, situacao: r.situacao } : { erro: MENSAGENS_CARTAO_HOSPEDE[r.codigo], ...(RECARREGAR.has(r.codigo) ? { recarregar: true } : {}) };
  } catch (e) {
    // O registro leva só o tipo do erro (nada da cotação, do hóspede nem do cartão).
    console.error("[site] falha no pagamento com cartão", e instanceof Error ? e.name : "erro");
    resultado = { erro: MENSAGENS_CARTAO_HOSPEDE.provedor };
  }
  revalidatePath(`/reservar/${cod}`);
  return resultado;
}

/**
 * "Continuar o pagamento" noutro aparelho: o e-mail usado ao segurar as datas, conferido no servidor (com os
 * freios do domínio). Confere: emite o cookie de novo. Não confere, ou a cotação não existe: a mesma resposta
 * (nada se descobre pelo código nem pelo e-mail), e o e-mail digitado não volta no estado.
 */
export async function continuarPagamentoAcao(_estado: EstadoContinuar, form: FormData): Promise<EstadoContinuar> {
  const cod = lerCodigo(form.get("codigo"));
  const email = String(form.get("email") ?? "").slice(0, 254);
  const db = getDb();
  const organizacaoId = await organizacaoDoSite(db);
  if (!organizacaoId) return { erro: EM_CONFIGURACAO };
  const c = codigoCotacaoValido(cod) ? await obterCotacao(db, organizacaoId, cod) : null;
  const agora = new Date();
  const r = await conferirEmailDoPedido(db, organizacaoId, c?.id ?? "", email, origemDoPedido(await headers()), agora);
  if (!r.ok) return { erro: r.erro };
  if (!c) return { erro: MENSAGEM_INDISPONIVEL };
  try {
    await gravarAutorizacao(c.id, r.ate);
  } catch {
    console.error("[site] autorização do pagamento não emitida (AUTH_SECRET)");
    return { erro: MENSAGEM_INDISPONIVEL };
  }
  revalidatePath(`/reservar/${cod}`);
  return { ok: true };
}
