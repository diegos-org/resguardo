import "server-only";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { auth, loginConfigurado } from "./auth";
import { destinoPainel } from "./painel";
import type { Sessao } from "./politica";
import { carregarSessao } from "./sessao";

/**
 * Sessão de autorização do usuário logado, lida do banco a cada requisição
 * (desativar um usuário corta o acesso na hora).
 */
export async function obterSessao(): Promise<Sessao | null> {
  if (!loginConfigurado) return null;
  const s = await auth();
  const id = s?.user?.id;
  if (!id) return null;
  return carregarSessao(getDb(), id);
}

/** Usar no topo de toda página do painel. */
export async function exigirSessaoPainel(): Promise<Sessao> {
  const sessao = await obterSessao();
  const destino = destinoPainel(sessao);
  if (!destino.ok) redirect(destino.redirecionar);
  return sessao!;
}
