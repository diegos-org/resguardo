import "server-only";
import { cookies } from "next/headers";
import type { Db } from "@/db/types";
import { aceitarConvite } from "./convites";

/** Cookie curto que lembra de qual link de convite a pessoa veio (só o token, httpOnly). */
export const COOKIE_CONVITE = "scl_convite";

export async function guardarTokenConvite(token: string) {
  (await cookies()).set(COOKIE_CONVITE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 60,
  });
}

/** No login: se a pessoa veio de um convite para este e-mail verificado, aceita. */
export async function aceitarConviteDoCookie(db: Db, emailVerificado: string): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_CONVITE)?.value;
  if (!token) return null;
  const id = await aceitarConvite(db, token, emailVerificado);
  if (id) {
    try {
      jar.delete(COOKIE_CONVITE);
    } catch {
      // fora de action/rota o cookie não pode ser alterado; ele expira sozinho
    }
  }
  return id;
}
