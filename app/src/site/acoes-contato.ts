"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { origemDoPedido } from "@/acesso/senha";
import { enderecoDaRequisicao } from "@/convites/email";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import {
  avisarEquipe,
  CAMPOS_PEDIDO_CONTATO,
  type ErrosPedidoContato,
  preencheuIsca,
  registrarPedidoContato,
  validarPedidoContato,
} from "@/proprietarios/pedidos-contato";
import { organizacaoDoSite } from "./site";

/** Estado do formulário "Pedir contato" (página Anuncie seu imóvel, M7.7). `valores` refaz o formulário depois de um erro. */
export type EstadoContatoProprietario = { ok?: true; mensagem?: string; erros?: ErrosPedidoContato; valores?: Record<string, string> };

/** Página do painel onde a equipe vê os pedidos (vai no e-mail de aviso). */
const PAGINA_PAINEL = "/painel/proprietarios/contatos";

/** Pedido de contato para a gestão completa: grava como "novo" no painel e avisa a equipe por e-mail. */
export async function pedirContatoProprietarioAcao(_estado: EstadoContatoProprietario, form: FormData): Promise<EstadoContatoProprietario> {
  const entrada = Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$ACTION")));
  // Robô (preencheu o campo que a pessoa não vê): a tela diz "recebido", mas nada é gravado nem enviado.
  if (preencheuIsca(entrada)) return { ok: true };
  // Só os campos do formulário voltam para a tela (nunca o campo-isca), com tamanho limitado.
  const valores = Object.fromEntries(CAMPOS_PEDIDO_CONTATO.filter((k) => k in entrada).map((k) => [k, entrada[k].slice(0, 2000)]));
  const v = validarPedidoContato(entrada);
  if (!v.ok) return { erros: v.erros, mensagem: "Confira os campos destacados.", valores };
  const db = getDb();
  const organizacaoId = await organizacaoDoSite(db);
  if (!organizacaoId) return { mensagem: "O pedido de contato ainda não está disponível por aqui. Fale com a gente pelo WhatsApp ou pelo e-mail do site.", valores };
  const h = await headers();
  const r = await registrarPedidoContato(db, organizacaoId, v.dados, new Date(), origemDoPedido(h));
  if (!r.ok) return { mensagem: r.erro, valores };
  const link = enderecoDaRequisicao(h, PAGINA_PAINEL);
  const correio = correioDoAmbiente();
  // Depois da resposta: o visitante não espera o provedor de e-mail. Se o e-mail falhar, o pedido
  // continua no painel (Proprietários → Pedidos de contato, com aviso no Início).
  after(async () => {
    try {
      const aviso = await avisarEquipe(getDb(), organizacaoId, r.pedido, correio, link);
      // "falhou" já foi registrado por avisarEquipe.
      if (aviso === "sem-email" || aviso === "sem-correio") console.warn(`[pedido de contato] equipe não avisada por e-mail (${aviso}); o pedido está no painel.`);
    } catch (e) {
      console.error("[pedido de contato] falha ao avisar a equipe", e instanceof Error ? e.message : String(e));
    }
  });
  return { ok: true };
}
