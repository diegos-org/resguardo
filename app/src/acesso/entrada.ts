import { eq, sql } from "drizzle-orm";
import { organizacoes, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";

export type ConfigEntrada = {
  /**
   * E-mails que viram administradores no primeiro login, se ainda não existirem.
   * Vem da variável de ambiente ADMIN_EMAILS (nunca fica no Git).
   */
  adminEmails: readonly string[];
  /** Nome da organização criada no primeiro login de admin, se não houver nenhuma. */
  nomeOrganizacao: string;
};

/** Id da organização criada no primeiro acesso (quando o banco está vazio). */
export const ORGANIZACAO_INICIAL_ID = "00000000-0000-4000-8000-000000000001";

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function lerAdminEmails(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(",")
    .map(normalizarEmail)
    .filter((e) => e.includes("@"));
}

/**
 * Decide se um e-mail (já verificado pelo provedor) pode entrar. Retorna o id do
 * usuário ou null. Só entra quem já está cadastrado e ativo, ou quem está em
 * ADMIN_EMAILS e ainda não existe (é criado como admin — resolve o "primeiro acesso").
 */
export async function decidirEntrada(db: Db, emailBruto: string, config: ConfigEntrada): Promise<string | null> {
  const email = normalizarEmail(emailBruto);
  if (!email.includes("@")) return null;

  const [existente] = await db.select().from(usuarios).where(eq(sql`lower(${usuarios.email})`, email));
  if (existente) return existente.ativo ? existente.id : null;

  if (!config.adminEmails.map(normalizarEmail).includes(email)) return null;

  let [org] = await db.select().from(organizacoes).orderBy(organizacoes.criadoEm, organizacoes.id).limit(1);
  if (!org) {
    // Id fixo + ON CONFLICT: dois primeiros logins simultâneos criam a mesma organização.
    await db
      .insert(organizacoes)
      .values({ id: ORGANIZACAO_INICIAL_ID, nome: config.nomeOrganizacao })
      .onConflictDoNothing();
    [org] = await db.select().from(organizacoes).orderBy(organizacoes.criadoEm, organizacoes.id).limit(1);
  }
  const [novo] = await db
    .insert(usuarios)
    .values({ organizacaoId: org.id, email, nome: email.split("@")[0], papel: "admin" })
    .onConflictDoNothing()
    .returning();
  if (novo) return novo.id;
  // Corrida: outro login criou o mesmo usuário ao mesmo tempo.
  const [criado] = await db.select().from(usuarios).where(eq(sql`lower(${usuarios.email})`, email));
  return criado?.ativo ? criado.id : null;
}
