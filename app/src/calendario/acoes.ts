"use server";

import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { organizacaoBeds24 } from "@/beds24/configuracao";
import { escritorDoAmbiente, leitorParaSincronizacao } from "@/beds24/http";
import { mensagemSeguraBeds24 } from "@/beds24/sincronizacao";
import { ErroBeds24 } from "@/beds24/tipos";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { criarBloqueio, excluirBloqueio } from "@/reservas/bloqueios";
import { enviarCalendarioBeds24, type ResultadoEnvio } from "./envio";
import { adicionarEvento, type ErrosRegrasCalendario, lerRegrasCalendario, removerEvento, salvarRegrasCalendario, validarEvento, validarFormRegras } from "./regras-config";

export type EstadoRegrasCalendario = { ok?: boolean; mensagem?: string; aviso?: string; erros?: ErrosRegrasCalendario; valores?: Record<string, string | string[]> };
export type EstadoEvento = { ok?: boolean; erro?: string; valores?: Record<string, string | string[]> };
export type EstadoEnvio = { resultado?: ResultadoEnvio; erro?: string };
export type EstadoBloqueio = { ok?: boolean; erro?: string; valores?: Record<string, string> };

const ABA = "/painel/configuracoes/calendario";
const LISTAS = ["feriadoImoveis", "envioImoveis", "imoveis"];

/** Formulário → objeto; campos repetidos (imóveis) viram lista. */
function lerForm(form: FormData): Record<string, string | string[]> {
  const saida: Record<string, string | string[]> = {};
  for (const k of new Set(form.keys())) {
    if (k.startsWith("$ACTION")) continue;
    const vs = form.getAll(k).filter((v): v is string => typeof v === "string");
    saida[k] = LISTAS.includes(k) ? vs : (vs[0] ?? "");
  }
  return saida;
}

async function sessaoConfig() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}
const idsDaOrg = async (org: string) => (await listarImoveis(getDb(), org, { incluirInativos: true })).map((i) => i.id);

export async function salvarRegrasCalendarioAcao(_a: EstadoRegrasCalendario, form: FormData): Promise<EstadoRegrasCalendario> {
  const sessao = await sessaoConfig();
  const db = getDb();
  const valores = lerForm(form);
  const atual = await lerRegrasCalendario(db, sessao.organizacaoId);
  const v = validarFormRegras(valores, atual, await idsDaOrg(sessao.organizacaoId));
  if (!v.ok) return { erros: v.erros, mensagem: "Confira os campos destacados.", valores };
  const mudou = await salvarRegrasCalendario(db, sessao.organizacaoId, v.regras, sessao.usuarioId);
  revalidatePath(ABA);
  revalidatePath("/painel/calendario/previa");
  return { ok: true, aviso: mudou ? "Salvo. Vale para o próximo envio (nada foi enviado agora)." : "Nada mudou." };
}

export async function novoEventoAcao(_a: EstadoEvento, form: FormData): Promise<EstadoEvento> {
  const sessao = await sessaoConfig();
  const valores = lerForm(form);
  const v = validarEvento(valores, await idsDaOrg(sessao.organizacaoId));
  if (!v.ok) return { erro: v.erro, valores };
  const r = await adicionarEvento(getDb(), sessao.organizacaoId, v.evento, sessao.usuarioId);
  revalidatePath(ABA);
  return r.ok ? { ok: true } : { erro: r.erro, valores };
}

export async function removerEventoAcao(form: FormData): Promise<void> {
  const sessao = await sessaoConfig();
  await removerEvento(getDb(), sessao.organizacaoId, String(form.get("id") ?? ""), sessao.usuarioId);
  revalidatePath(ABA);
}

/** Simula ou envia um imóvel (ou todos os ligados) ao Beds24. Só o administrador; envio real exige confirmação explícita. */
export async function enviarCalendarioAcao(_a: EstadoEnvio, form: FormData): Promise<EstadoEnvio> {
  try {
    const sessao = await exigirSessaoPainel();
    if (sessao.papel !== "admin") throw new ErroBeds24("Somente o administrador pode simular ou enviar ao Beds24.", "configuracao");
    const db = getDb();
    if ((await organizacaoBeds24(db)) !== sessao.organizacaoId) throw new ErroBeds24("Esta credencial Beds24 não está vinculada à sua organização.", "configuracao");
    const modo = form.get("modo") === "envio" ? "envio" : "simulacao";
    if (modo === "envio" && form.get("confirmo") !== "on") throw new ErroBeds24("Confirme que conferiu a prévia e quer enviar ao Beds24.", "configuracao");
    const imovelId = String(form.get("imovelId") ?? "");
    const leitor = leitorParaSincronizacao();
    if (!leitor) throw new ErroBeds24("Credencial Beds24 não configurada.", "configuracao");
    const resultado = await enviarCalendarioBeds24(db, sessao.organizacaoId, leitor, modo === "envio" ? escritorDoAmbiente() : null, { modo, imovelIds: imovelId ? [imovelId] : undefined, autorId: sessao.usuarioId });
    revalidatePath("/painel/calendario/previa");
    return { resultado };
  } catch (e) {
    return { erro: mensagemSeguraBeds24(e) };
  }
}

export async function novoBloqueioAcao(_a: EstadoBloqueio, form: FormData): Promise<EstadoBloqueio> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  const valores = { imovelId: String(form.get("imovelId") ?? ""), inicio: String(form.get("inicio") ?? ""), fim: String(form.get("fim") ?? ""), motivo: String(form.get("motivo") ?? "") };
  const r = await criarBloqueio(getDb(), sessao.organizacaoId, valores, sessao.usuarioId);
  revalidatePath("/painel/calendario");
  revalidatePath("/painel/calendario/previa");
  return r.ok ? { ok: true } : { erro: r.erro, valores };
}

export async function removerBloqueioAcao(_a: EstadoBloqueio, form: FormData): Promise<EstadoBloqueio> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  const r = await excluirBloqueio(getDb(), sessao.organizacaoId, String(form.get("id") ?? ""), sessao.usuarioId);
  revalidatePath("/painel/calendario");
  revalidatePath("/painel/calendario/previa");
  return r.ok ? { ok: true } : { erro: r.erro };
}
