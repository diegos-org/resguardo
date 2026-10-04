import "server-only";
import { cookies } from "next/headers";
import type { Db } from "@/db/types";
import { aceitarConvite } from "./convites";

/** Cookie curto que lembra de qual link de convite a pessoa veio (só o token, httpOnly). */
export const COOKIE_CONVITE = "scl_convite";
/** Versão do "Como funciona" marcada como lida e aceita na página do convite (M5.6); gravada no login, com o convite. */
export const COOKIE_CONVITE_ACEITE = "scl_convite_aceite";

const opcoes = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 30 * 60 });

export async function guardarTokenConvite(token: string, aceiteComoFunciona: number | null = null) {
  const jar = await cookies();
  jar.set(COOKIE_CONVITE, token, opcoes());
  if (aceiteComoFunciona !== null) jar.set(COOKIE_CONVITE_ACEITE, String(aceiteComoFunciona), opcoes());
  else jar.delete(COOKIE_CONVITE_ACEITE);
}

/** No login: se a pessoa veio de um convite para este e-mail verificado, aceita. */
export async function aceitarConviteDoCookie(db: Db, emailVerificado: string): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_CONVITE)?.value;
  if (!token) return null;
  const aceite = jar.get(COOKIE_CONVITE_ACEITE)?.value;
  const id = await aceitarConvite(db, token, emailVerificado, new Date(), aceite && /^\d{1,6}$/.test(aceite) ? Number(aceite) : null);
  if (id) {
    try {
      jar.delete(COOKIE_CONVITE);
      jar.delete(COOKIE_CONVITE_ACEITE);
    } catch {
      // fora de action/rota o cookie não pode ser alterado; ele expira sozinho
    }
  }
  return id;
}
