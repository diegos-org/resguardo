"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { type Registro, registrarPortaria, type Resultado, salvarImoveisComPortaria } from "./portaria";

/** Volta para a lista mantendo a seleção de imóveis que estava na tela. */
function voltar(form: FormData, r: Resultado): never {
  revalidatePath("/painel/portaria");
  const q = new URLSearchParams(String(form.get("voltar") ?? ""));
  q.delete("salvo");
  q.delete("erro");
  if (r.ok) q.set("salvo", "1");
  else q.set("erro", r.erro);
  redirect(`/painel/portaria?${q}`);
}

const DATAS = ["aviso_inicial", "segundo_pedido", "pedido_final", "encaminhado", "entrega_confirmada"] as const;

export async function registrarAcao(form: FormData) {
  const s = await exigirSessaoPainel();
  exigir(s, "reserva:editar", { organizacaoId: s.organizacaoId });
  const tipo = String(form.get("tipo") ?? "");
  const hoje = hojeISO();
  let reg: Registro;
  if ((DATAS as readonly string[]).includes(tipo)) reg = { tipo: tipo as (typeof DATAS)[number], data: String(form.get("data") || hoje) };
  else if (tipo === "documentos") reg = { tipo, recebidos: Number(form.get("recebidos") ?? -1) };
  else if (tipo === "destinatario") reg = { tipo, conferido: form.get("conferido") === "sim" };
  else if (tipo === "pendencia") reg = { tipo, texto: String(form.get("texto") ?? "") };
  else voltar(form, { ok: false, erro: "Ação inválida." });
  voltar(form, await registrarPortaria(getDb(), s.organizacaoId, String(form.get("reservaId") ?? ""), reg, hoje, s.usuarioId));
}

export async function imoveisAcao(form: FormData) {
  const s = await exigirSessaoPainel();
  exigir(s, "configuracao:editar", { organizacaoId: s.organizacaoId });
  voltar(form, await salvarImoveisComPortaria(getDb(), s.organizacaoId, form.getAll("imovelId").map(String), s.usuarioId));
}
