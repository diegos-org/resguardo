"use server";

/**
 * Ações da importação dos preços do Beds24 (M3.11a, requisitos/product/FONTE-UNICA-PRECOS.md 3.4 a 3.6), negadas por
 * padrão: sessão do painel e `configuracao:editar`; aprovar e desfazer também `imovel:editar` (mudam o cadastro e o preço do
 * imóvel). O imóvel é conferido na organização da sessão, dentro da transação (aprovacao.ts).
 */
import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { uuidValido } from "@/lib/ids";
import { aprovarImportacao, desfazerImportacao, guardarCopiaAgora, type ResultadoImportacao } from "./aprovacao";

export type EstadoImportacao = { ok?: boolean; mensagem?: string; erro?: string };

const LISTA = "/painel/configuracoes/calendario/importar";

async function sessaoImportacao(editaImovel: boolean) {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  if (editaImovel) exigir(sessao, "imovel:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

/** As telas que mostram a camada importada, a cópia ou o cadastro do imóvel. */
function revalidar(imovelId: string) {
  revalidatePath(LISTA);
  if (!uuidValido(imovelId)) return;
  revalidatePath(`${LISTA}/${imovelId}`);
  revalidatePath(`/painel/imoveis/${imovelId}`);
  revalidatePath("/painel/calendario/previa");
}
const estado = (r: ResultadoImportacao): EstadoImportacao => (r.ok ? { ok: true, mensagem: r.mensagem } : { erro: r.erro });
const imovelDoForm = (form: FormData) => String(form.get("imovelId") ?? "");

/** "Aprovar e importar": a assinatura da leitura revisada e as caixas "Usar como…" vêm da revisão aberta. */
export async function aprovarImportacaoAcao(_a: EstadoImportacao, form: FormData): Promise<EstadoImportacao> {
  const sessao = await sessaoImportacao(true);
  const imovelId = imovelDoForm(form);
  const r = await aprovarImportacao(getDb(), sessao.organizacaoId, imovelId, {
    assinatura: String(form.get("assinatura") ?? ""),
    usar: { precoBase: form.get("usarPrecoBase") === "sim", estadiaMaxima: form.get("usarEstadiaMaxima") === "sim" },
  }, sessao.usuarioId);
  revalidar(imovelId);
  return estado(r);
}

export async function desfazerImportacaoAcao(_a: EstadoImportacao, form: FormData): Promise<EstadoImportacao> {
  const sessao = await sessaoImportacao(true);
  const imovelId = imovelDoForm(form);
  const r = await desfazerImportacao(getDb(), sessao.organizacaoId, imovelId, sessao.usuarioId);
  revalidar(imovelId);
  return estado(r);
}

export async function guardarCopiaAcao(_a: EstadoImportacao, form: FormData): Promise<EstadoImportacao> {
  const sessao = await sessaoImportacao(false);
  const imovelId = imovelDoForm(form);
  const r = await guardarCopiaAgora(getDb(), sessao.organizacaoId, imovelId, sessao.usuarioId);
  revalidar(imovelId);
  return estado(r);
}
