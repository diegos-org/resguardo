"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { lerFormReserva } from "./formulario";
import type { ErrosReserva } from "./regras";
import { cancelarReserva, criarReserva } from "./repositorio";

export type EstadoFormReserva = { erros?: ErrosReserva; mensagem?: string };

export async function salvarNovaReserva(_a: EstadoFormReserva, form: FormData): Promise<EstadoFormReserva> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  const lido = lerFormReserva(Object.fromEntries(form));
  if (!lido.ok) return { erros: lido.erros, mensagem: "Confira os campos destacados." };
  const r = await criarReserva(getDb(), sessao.organizacaoId, lido.dados, sessao.usuarioId);
  if (!r.ok) return { erros: r.erros, mensagem: "Confira os campos destacados." };
  revalidatePath("/painel/reservas");
  redirect(`/painel/reservas/${r.reserva.id}?salvo=1`);
}

export async function cancelar(form: FormData): Promise<void> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  const id = String(form.get("id") ?? "");
  await cancelarReserva(getDb(), sessao.organizacaoId, id, sessao.usuarioId);
  revalidatePath(`/painel/reservas/${id}`);
  revalidatePath("/painel/reservas");
}
