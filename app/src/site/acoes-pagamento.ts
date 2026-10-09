"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { origemDoPedido } from "@/acesso/senha";
import { getDb } from "@/db/client";
import { conferirEmailDoPedido, conferirLimite } from "@/pagamentos/limites";
import { ofertaDePix } from "@/pagamentos/oferta";
import { gerarPix } from "@/pagamentos/pix";
import { versoesDoFormulario } from "./aceites";
import { autorizadoNaCotacao, gravarAutorizacao } from "./checkout";
import { codigoCotacaoValido, obterCotacao } from "./cotacoes";
import { MENSAGEM_INDISPONIVEL, MENSAGEM_SEM_AUTORIZACAO, MENSAGENS_PIX_HOSPEDE, mensagemSemPix, portaoDoSite } from "./pagamento";
import { organizacaoDoSite } from "./site";

/** Estado das ações do pagamento no site: só o resultado e uma frase (nenhum dado pessoal). */
export type EstadoPix = { ok?: boolean; erro?: string };
export type EstadoContinuar = { ok?: boolean; erro?: string };

const EM_CONFIGURACAO = "O site ainda está em configuração.";
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
  if (marcado && !aceite) return { erro: "Recarregue a página e tente de novo." };
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
