import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { COOKIE_HOSPEDE, lerSessaoHospede } from "./sessao";

/** E-mail do hóspede logado no portal (conferido pela assinatura), ou null. */
export async function emailDoHospede(): Promise<string | null> {
  await connection();
  return lerSessaoHospede((await cookies()).get(COOKIE_HOSPEDE)?.value, process.env.AUTH_SECRET, new Date());
}
