import { and, eq } from "drizzle-orm";
import { profissionaisLimpeza, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";

export const ACESSO_INCONSISTENTE = "O acesso vinculado não é uma conta da equipe desta empresa. Confira o cadastro antes de alterar o acesso; a conta foi preservada.";

/** Toda leitura e escrita de acesso da equipe exige o mesmo perfil e a mesma empresa. */
export const contaDaEquipe = (organizacaoId: string, usuarioId: string | typeof profissionaisLimpeza.usuarioId) =>
  and(eq(usuarios.id, usuarioId), eq(usuarios.organizacaoId, organizacaoId), eq(usuarios.papel, "limpeza"));

/** Sem trava de usuário aqui: a senha toma a trava da entrada antes de atualizar a conta. */
export async function usuarioDaEquipe(db: Db, organizacaoId: string, usuarioId: string) {
  const [u] = await db.select().from(usuarios).where(contaDaEquipe(organizacaoId, usuarioId));
  return u ?? null;
}
