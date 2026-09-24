import type { Sessao } from "./politica";

/** Papéis que usam o painel interno. Proprietários terão o portal próprio (M5). */
export const PAPEIS_PAINEL = ["admin", "operacao"] as const;

export type DestinoPainel = { ok: true } | { ok: false; redirecionar: string };

export function destinoPainel(sessao: Sessao | null): DestinoPainel {
  if (!sessao) return { ok: false, redirecionar: "/entrar" };
  if (sessao.papel === "proprietario") return { ok: false, redirecionar: "/portal" };
  if (!(PAPEIS_PAINEL as readonly string[]).includes(sessao.papel)) return { ok: false, redirecionar: "/entrar?erro=sem-acesso" };
  return { ok: true };
}
