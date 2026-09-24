"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { reservas } from "@/db/schema";
import { complementarAjuste, type ErrosAjuste, esclarecerAjuste, lerFormAjuste, registrarAjuste } from "./ajustes";

export type EstadoAjuste = { erros?: ErrosAjuste; mensagem?: string; valores?: Record<string, string> };

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

const campos = (form: FormData) => Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$ACTION")));

/** O formulário usa o código da reserva (SCL-…); aqui vira o id, dentro da organização. */
async function comReserva(org: string, v: Record<string, string>): Promise<Record<string, string> | null> {
  const codigo = (v.codigoReserva ?? "").trim().toUpperCase();
  if (!codigo) return { ...v, reservaId: "" };
  const [r] = await getDb()
    .select({ id: reservas.id })
    .from(reservas)
    .where(and(eq(reservas.organizacaoId, org), eq(sql`upper(${reservas.codigo})`, codigo)));
  return r ? { ...v, reservaId: r.id } : null;
}

export async function salvarAjusteAcao(_a: EstadoAjuste, form: FormData): Promise<EstadoAjuste> {
  const sessao = await sessaoEditora();
  const valores = campos(form);
  const v = await comReserva(sessao.organizacaoId, valores);
  if (!v) return { erros: { reservaId: "Reserva não encontrada (use o código, ex.: SCL-AB12)." }, mensagem: "Confira os campos destacados.", valores };
  const lido = lerFormAjuste(v);
  if (!lido.ok) return { erros: lido.erros, mensagem: "Confira os campos destacados.", valores };
  const id = valores.id;
  const r = id
    ? await complementarAjuste(getDb(), sessao.organizacaoId, id, lido.dados, sessao.usuarioId)
    : await registrarAjuste(getDb(), sessao.organizacaoId, lido.dados, sessao.usuarioId);
  if (!r.ok) return { erros: r.erros, mensagem: r.erros.geral ?? "Confira os campos destacados.", valores };
  revalidatePath("/painel/financeiro", "layout");
  redirect(`/painel/financeiro/ajustes/${r.id}?salvo=1`);
}

export async function esclarecerAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const id = String(form.get("id") ?? "");
  const r = await esclarecerAjuste(getDb(), sessao.organizacaoId, id, sessao.usuarioId);
  revalidatePath("/painel/financeiro", "layout");
  redirect(`/painel/financeiro/ajustes/${id}?${r.ok ? "esclarecido=1" : `erro=${encodeURIComponent(r.erro)}`}`);
}
