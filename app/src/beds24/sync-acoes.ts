"use server";

import { revalidatePath } from "next/cache";
import { obterSessao } from "@/acesso/sessao-atual";
import { adicionarIdExterno } from "@/canais/ids-externos";
import { getDb } from "@/db/client";
import { organizacaoBeds24, salvarConfigBeds24 } from "./configuracao";
import { leitorDoAmbiente, leitorParaSincronizacao } from "./http";
import { mensagemSeguraBeds24, sincronizarBeds24 } from "./sincronizacao";
import { ErroBeds24, type QuartoBeds24 } from "./tipos";

export type EstadoSyncBeds24 = { ok?: boolean; mensagem?: string; quartos?: QuartoBeds24[]; divergencias?: string[] };
const caminho = "/painel/configuracoes/integracoes";

async function contexto() {
  const s = await obterSessao();
  if (!s || s.papel !== "admin") throw new ErroBeds24("Somente o administrador pode configurar e importar dados do Beds24.", "configuracao");
  const db = getDb();
  if (await organizacaoBeds24(db) !== s.organizacaoId) throw new ErroBeds24("Esta credencial Beds24 não está vinculada à sua organização.", "configuracao");
  return { s, db };
}

export async function conferirQuartosBeds24(): Promise<EstadoSyncBeds24> {
  try {
    await contexto();
    const leitor = leitorDoAmbiente();
    if (!leitor) throw new ErroBeds24("Configure a credencial Beds24 antes de buscar os quartos.", "configuracao");
    const r = await leitor.quartos();
    return { ok: !r.divergencias.length, quartos: r.itens, mensagem: r.divergencias.length ? "Alguns quartos não puderam ser lidos. Confira no Beds24 antes de vincular." : `${r.itens.length} quarto(s) encontrado(s). Escolha o imóvel correspondente a cada um.` };
  } catch (e) { return { ok: false, mensagem: mensagemSeguraBeds24(e) }; }
}

export async function vincularQuartoBeds24(_anterior: EstadoSyncBeds24, f: FormData): Promise<EstadoSyncBeds24> {
  void _anterior;
  try {
    const { s, db } = await contexto();
    const imovelId = String(f.get("imovelId") ?? "");
    const propertyId = String(f.get("propertyId") ?? "");
    const roomId = String(f.get("roomId") ?? "");
    const leitor = leitorDoAmbiente();
    if (!leitor) throw new ErroBeds24("Credencial Beds24 não configurada.", "configuracao");
    // O navegador fornece somente a seleção: existência e acesso são conferidos de novo.
    const r = await leitor.quartos();
    if (!r.itens.some(q => q.propertyId === propertyId && q.roomId === roomId)) throw new ErroBeds24("Quarto não encontrado nesta conta Beds24.", "configuracao");
    const salvo = await adicionarIdExterno(db, s.organizacaoId, imovelId, { canal: "beds24", idExterno: propertyId, detalhe: roomId }, s.usuarioId);
    if (!salvo.ok) return { ok: false, mensagem: salvo.erro };
    revalidatePath(caminho);
    return { ok: true, mensagem: "Vínculo salvo. Confira a lista antes de importar." };
  } catch (e) { return { ok: false, mensagem: mensagemSeguraBeds24(e) }; }
}

export async function configurarSyncBeds24(_anterior: EstadoSyncBeds24, f: FormData): Promise<EstadoSyncBeds24> {
  void _anterior;
  try {
    const { s, db } = await contexto();
    await salvarConfigBeds24(db, s.organizacaoId, { automatica: f.get("automatica") === "on", desde: String(f.get("desde") ?? ""), diasCalendario: Number(f.get("diasCalendario")) }, s.usuarioId);
    revalidatePath(caminho);
    return { ok: true, mensagem: "Configuração salva. Salvar não inicia uma importação." };
  } catch (e) { return { ok: false, mensagem: mensagemSeguraBeds24(e) }; }
}

export async function importarBeds24Agora(_anterior: EstadoSyncBeds24, f: FormData): Promise<EstadoSyncBeds24> {
  void _anterior;
  try {
    const { s, db } = await contexto();
    if (f.get("confirmo") !== "on") throw new ErroBeds24("Confirme que conferiu os vínculos e deseja importar para o SCL.", "configuracao");
    const leitor = leitorParaSincronizacao();
    if (!leitor) throw new ErroBeds24("Credencial Beds24 não configurada.", "configuracao");
    const r = await sincronizarBeds24(db, s.organizacaoId, leitor, { autorId: s.usuarioId });
    revalidatePath("/painel", "layout");
    return { ok: r.ok, mensagem: r.mensagem, divergencias: r.divergencias };
  } catch (e) { return { ok: false, mensagem: mensagemSeguraBeds24(e) }; }
}
