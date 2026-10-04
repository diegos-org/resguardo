"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { limitesDoMes } from "@/repasses/repasses";
import { guardarExtrato, removerExtrato } from "./extratos";
import { LIMITE_EXTRATO } from "./pdf";

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

function voltar(mes: string, r: { ok: true; info: string } | { ok: false; erro: string }): never {
  revalidatePath("/painel/financeiro/repasses");
  const q = new URLSearchParams();
  if (limitesDoMes(mes)) q.set("mes", mes);
  if (r.ok) q.set("info", r.info);
  else q.set("erro", r.erro);
  redirect(`/painel/financeiro/repasses?${q}`);
}

const texto = (form: FormData, k: string) => String(form.get(k) ?? "");

/** Guarda o extrato oficial de um canal para um imóvel e mês (M5.7): vai no fim do relatório do e-mail do fechamento. */
export async function guardarExtratoAcao(form: FormData): Promise<void> {
  const s = await sessaoEditora();
  const mes = texto(form, "mes");
  const f = form.get("arquivo");
  if (!f || typeof f === "string" || f.size === 0) voltar(mes, { ok: false, erro: "Escolha o arquivo PDF do extrato." });
  if (f.size > LIMITE_EXTRATO) voltar(mes, { ok: false, erro: "O extrato passa de 2 MB: exporte só o período do mês." });
  const r = await guardarExtrato(
    getDb(),
    s.organizacaoId,
    { imovelId: texto(form, "imovelId"), mes, canal: texto(form, "canal"), paginas: texto(form, "paginas"), arquivo: { nome: f.name, tipo: f.type, conteudo: new Uint8Array(await f.arrayBuffer()) } },
    s.usuarioId,
  );
  if (!r.ok) voltar(mes, r);
  voltar(mes, { ok: true, info: `Extrato guardado${r.substituiu ? " (substituiu o anterior)" : ""}: ${r.paginasTotal} página(s) no arquivo. Ele vai no fim do relatório do e-mail do fechamento.` });
}

export async function removerExtratoAcao(form: FormData): Promise<void> {
  const s = await sessaoEditora();
  const mes = texto(form, "mes");
  const r = await removerExtrato(getDb(), s.organizacaoId, texto(form, "id"), s.usuarioId);
  voltar(mes, r.ok ? { ok: true, info: "Extrato removido." } : r);
}
