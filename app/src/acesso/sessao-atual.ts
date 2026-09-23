import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { usuarios } from "@/db/schema";
import { auth, loginConfigurado } from "./auth";
import { destinoPainel } from "./painel";
import type { Sessao } from "./politica";
import { carregarSessao } from "./sessao";

/**
 * Sessão de autorização do usuário logado, lida do banco a cada requisição
 * (desativar um usuário corta o acesso na hora).
 */
export async function obterSessao(): Promise<Sessao | null> {
  // Sempre por requisição: nunca pré-renderizar páginas que dependem de login.
  await connection();
  const dev = await sessaoDeDesenvolvimento();
  if (dev !== undefined) return dev;
  if (!loginConfigurado) return null;
  const s = await auth();
  const id = s?.user?.id;
  if (!id) return null;
  return carregarSessao(getDb(), id);
}

/**
 * Atalho SÓ para rodar o sistema no computador (`next dev`): entra direto como o usuário
 * de SCL_DEV_EMAIL, sem Google. Nunca vale em produção/Vercel (NODE_ENV=production).
 * Retorna undefined quando não se aplica.
 */
async function sessaoDeDesenvolvimento(): Promise<Sessao | null | undefined> {
  const email = process.env.SCL_DEV_EMAIL;
  if (!email || process.env.NODE_ENV !== "development") return undefined;
  const db = getDb();
  const [u] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(sql`lower(${usuarios.email})`, email.toLowerCase()));
  return u ? carregarSessao(db, u.id) : null;
}

/** Usar no topo de toda página do painel. */
export async function exigirSessaoPainel(): Promise<Sessao> {
  const sessao = await obterSessao();
  const destino = destinoPainel(sessao);
  if (!destino.ok) redirect(destino.redirecionar);
  return sessao!;
}
