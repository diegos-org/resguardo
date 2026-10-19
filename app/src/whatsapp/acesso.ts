/**
 * Quem vê as conversas do WhatsApp (M10.1a, desenho na seção "Telas e acesso" de `requisitos/product/WHATSAPP.md`): a
 * checagem num lugar só.
 * As páginas de mensagens, as consultas das conversas e do vínculo, as ações, o menu, o Início e a ficha da reserva
 * passam por aqui; nenhum outro lugar decide. `acesso/politica.ts` não muda: `mensagem:ler` continua sendo da operação,
 * e a configuração "Quem vê as conversas" (decisão de Diego em 17/10, padrão "só o admin") restringe por cima dela.
 * - admin: vê sempre, qualquer que seja a configuração;
 * - operação: só com "admin e operação";
 * - proprietário, limpeza e hóspede: nunca (não têm `mensagem:ler`), qualquer que seja a configuração.
 * Sessão inválida, papel desconhecido ou valor torto da configuração: não vê (o valor torto vale "só o admin").
 */
import { AcessoNegado, autorizar, type Sessao } from "@/acesso/politica";
import type { Db } from "@/db/types";
import { lerConfigWhatsapp } from "./configuracao";

/** Pura: `mensagem:ler` na política + a configuração. Admin sempre; operação só com "admin_e_operacao"; o resto nunca. */
export function podeVerConversasCom(sessao: Sessao | null | undefined, quemVe: unknown): boolean {
  if (!sessao || !autorizar(sessao, "mensagem:ler", { organizacaoId: sessao.organizacaoId }).permitido) return false;
  if (sessao.papel === "admin") return true;
  return sessao.papel === "operacao" && quemVe === "admin_e_operacao";
}

/**
 * Lê a configuração da organização da sessão (nunca de outra) só quando ela decide: quem não teria acesso nem com a
 * configuração liberada é negado sem consulta, e o admin vê sem consulta.
 */
export async function podeVerConversas(db: Db, sessao: Sessao): Promise<boolean> {
  // "admin_e_operacao" é o valor mais aberto: se nem com ele a sessão vê, a configuração não muda nada.
  if (!podeVerConversasCom(sessao, "admin_e_operacao")) return false;
  if (sessao.papel === "admin") return true;
  return podeVerConversasCom(sessao, (await lerConfigWhatsapp(db, sessao.organizacaoId)).quemVeConversas);
}

/** Para o início das consultas e das ações: lança `AcessoNegado("ACAO_NAO_PERMITIDA")` para quem não vê as conversas. */
export async function exigirVerConversas(db: Db, sessao: Sessao): Promise<void> {
  if (!(await podeVerConversas(db, sessao))) throw new AcessoNegado("ACAO_NAO_PERMITIDA");
}
