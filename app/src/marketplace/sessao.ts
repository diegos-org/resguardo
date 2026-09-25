import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { lerToken } from "@/lib/token-assinado";

export const COOKIE_CADASTRO = "scl_cadastro";
export const INICIO_CADASTRO = "/anunciar";
/** A sessão do cadastro dura o suficiente para preencher o formulário com calma. */
export const VALIDADE_SESSAO_CADASTRO_MS = 2 * 60 * 60 * 1000;

/** E-mail confirmado da sessão do cadastro (cookie assinado), ou null. */
export async function emailDoCadastro(): Promise<string | null> {
  await connection();
  return lerToken("cadastro-marketplace:sessao:v1", (await cookies()).get(COOKIE_CADASTRO)?.value, process.env.AUTH_SECRET, new Date());
}
