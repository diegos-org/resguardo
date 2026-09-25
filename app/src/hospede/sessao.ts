/**
 * Sessão do portal do hóspede (M9.1): separada do login da equipe e dos proprietários. É um
 * cookie assinado (HMAC com o segredo do ambiente) com o e-mail verificado pelo código e o
 * vencimento. O cookie só diz QUEM é; o que ele pode ver é decidido a cada acesso, no servidor,
 * pelas reservas que têm esse e-mail agora.
 */
import { criarToken, lerToken } from "@/lib/token-assinado";

export const COOKIE_HOSPEDE = "scl_hospede";
export const VALIDADE_SESSAO_HOSPEDE_MS = 7 * 24 * 60 * 60 * 1000;

export const criarSessaoHospede = (email: string, segredo: string, agora: Date): string =>
  criarToken("portal-hospede:sessao:v1", email, segredo, agora, VALIDADE_SESSAO_HOSPEDE_MS);

/** E-mail da sessão, ou null se o cookie é inválido, adulterado ou venceu. */
export const lerSessaoHospede = (token: string | undefined, segredo: string | undefined, agora: Date): string | null =>
  lerToken("portal-hospede:sessao:v1", token, segredo, agora);
