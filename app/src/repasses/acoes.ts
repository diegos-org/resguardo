"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { hojeISO } from "@/lib/datas";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { enviarEmailDoRepasse, type SituacaoEnvioRepasse } from "./email";
import { type ErrosFormRegras, periodicidadeValida, validarFormRegras } from "./periodicidade";
import { escolherPeriodicidade } from "./proprietario";
import { estornarRecebimento, registrarRecebimento } from "./recebimentos";
import { salvarRegrasRepasses } from "./regras-config";
import { anexarComprovante, type ComprovanteRepasse, estornarRepasse, fecharMes, gerarAntecipado, limitesDoMes, marcarRepassePago, TAMANHO_MAXIMO_COMPROVANTE } from "./repasses";

async function sessaoEditora() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

const texto = (form: FormData, k: string) => String(form.get(k) ?? "");

const voltar = (mes: string, r: { ok: boolean; erro?: string }, sucesso: string, info?: string) => {
  revalidatePath("/painel/financeiro/repasses");
  revalidatePath("/painel/despesas", "layout");
  revalidatePath("/portal");
  const m = limitesDoMes(mes) ? mes : "";
  const q = new URLSearchParams();
  if (m) q.set("mes", m);
  if (r.ok) q.set(info ? "info" : "salvo", info ?? sucesso);
  else q.set("erro", r.erro ?? "Não foi possível.");
  redirect(`/painel/financeiro/repasses?${q}`);
};

/** Comprovante vindo do formulário: identificador (texto) e/ou arquivo (PDF, PNG, JPG até 5 MB). */
async function comprovanteDoForm(form: FormData): Promise<{ ok: true; comprovante: ComprovanteRepasse } | { ok: false; erro: string }> {
  const f = form.get("arquivo");
  let arquivo: ComprovanteRepasse["arquivo"] = null;
  if (f && typeof f !== "string" && f.size > 0) {
    if (f.size > TAMANHO_MAXIMO_COMPROVANTE) return { ok: false, erro: "O comprovante tem mais de 5 MB." };
    arquivo = { nome: f.name, tipo: f.type, conteudo: Buffer.from(await f.arrayBuffer()) };
  }
  return { ok: true, comprovante: { texto: texto(form, "comprovante").trim(), arquivo } };
}

export async function fecharMesAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const mes = texto(form, "mes");
  voltar(mes, await fecharMes(getDb(), sessao.organizacaoId, texto(form, "proprietarioId"), mes, hojeISO(), sessao.usuarioId), "fechado");
}

/** Marca pago com o comprovante (opcional na hora; sem ele o repasse fica "pago sem comprovante" e o e-mail espera). */
export async function pagarRepasseAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const mes = texto(form, "mes");
  const c = await comprovanteDoForm(form);
  if (!c.ok) return voltar(mes, c, "pago");
  const r = await marcarRepassePago(getDb(), sessao.organizacaoId, texto(form, "id"), texto(form, "data"), hojeISO(), sessao.usuarioId, c.comprovante);
  // Com comprovante, o e-mail sai já (se houver provedor); sem ele, fica para quando o comprovante for anexado.
  if (r.ok && (c.comprovante.texto || c.comprovante.arquivo)) await enviarEmailDoRepasse(getDb(), sessao.organizacaoId, r.id, correioDoAmbiente(), new Date(), { autorId: sessao.usuarioId });
  voltar(mes, r, "pago");
}

export async function anexarComprovanteAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const mes = texto(form, "mes");
  const c = await comprovanteDoForm(form);
  if (!c.ok) return voltar(mes, c, "comprovante");
  const r = await anexarComprovante(getDb(), sessao.organizacaoId, texto(form, "id"), c.comprovante, sessao.usuarioId);
  if (r.ok) await enviarEmailDoRepasse(getDb(), sessao.organizacaoId, r.id, correioDoAmbiente(), new Date(), { autorId: sessao.usuarioId });
  voltar(mes, r, "comprovante");
}

const TEXTO_ENVIO: Record<SituacaoEnvioRepasse, string> = {
  enviado: "E-mail do repasse enviado.",
  ja_enviado: "Este e-mail já tinha sido enviado.",
  nao_pago: "Marque o repasse como pago antes de enviar o e-mail.",
  sem_comprovante: "Anexe o comprovante antes: o e-mail só sai com ele.",
  sem_email: "O proprietário não tem e-mail cadastrado.",
  sem_provedor: "Sem provedor de e-mail configurado na Vercel (RESEND_API_KEY e EMAIL_REMETENTE): nada enviado.",
  incerto: "O provedor não confirmou o envio: pode ter chegado. Confira com o proprietário antes de enviar de novo.",
  aguardando: "Há uma tentativa sem confirmação do provedor: o sistema repete o mesmo e-mail depois de 15 minutos.",
  falhou: "O provedor recusou o e-mail; o motivo está no histórico do repasse.",
  nao_encontrado: "Repasse não encontrado.",
};

export async function enviarEmailRepasseAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const mes = texto(form, "mes");
  const s = await enviarEmailDoRepasse(getDb(), sessao.organizacaoId, texto(form, "id"), correioDoAmbiente(), new Date(), { reenviar: texto(form, "reenviar") === "sim", autorId: sessao.usuarioId });
  voltar(mes, { ok: true }, "", TEXTO_ENVIO[s]);
}

export async function estornarRepasseAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const mes = texto(form, "mes");
  voltar(mes, await estornarRepasse(getDb(), sessao.organizacaoId, texto(form, "id"), texto(form, "motivo"), hojeISO(), sessao.usuarioId), "estornado");
}

/** Repasse antecipado avulso gerado por Diego no painel (mesma regra do programado). */
export async function gerarAntecipadoAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const mes = texto(form, "mes");
  voltar(mes, await gerarAntecipado(getDb(), sessao.organizacaoId, texto(form, "proprietarioId"), hojeISO(), sessao.usuarioId), "antecipado");
}

export type EstadoRegrasRepasses = { ok?: boolean; mensagem?: string; aviso?: string; erros?: ErrosFormRegras; valores?: Record<string, string> };

const campos = (form: FormData) => Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$ACTION")));

/** Configurações → Repasses: dia do semanal, dias do quinzenal e padrão por tipo de contrato. */
export async function salvarRegrasRepassesAcao(_a: EstadoRegrasRepasses, form: FormData): Promise<EstadoRegrasRepasses> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  const valores = campos(form);
  const v = validarFormRegras(valores);
  if (!v.ok) return { erros: v.erros, mensagem: "Confira os campos destacados.", valores };
  const mudou = await salvarRegrasRepasses(getDb(), sessao.organizacaoId, v.regras, sessao.usuarioId);
  revalidatePath("/painel/configuracoes/repasses");
  revalidatePath("/portal");
  return { ok: true, aviso: mudou ? "Salvo. Vale dos próximos repasses em diante; os já gerados não mudam." : "Nada mudou." };
}

/** Painel → Proprietário: como ele recebe (vazio = padrão do tipo de contrato). */
export async function escolherPeriodicidadeAdminAcao(form: FormData): Promise<void> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "proprietario:editar", { organizacaoId: sessao.organizacaoId });
  const id = texto(form, "proprietarioId");
  const escolha = texto(form, "periodicidade");
  const r = await escolherPeriodicidade(getDb(), sessao.organizacaoId, id, periodicidadeValida(escolha) ? escolha : null, sessao.usuarioId);
  revalidatePath(`/painel/proprietarios/${id}`);
  revalidatePath("/portal");
  redirect(`/painel/proprietarios/${encodeURIComponent(id)}?${r.ok ? "salvo=periodicidade" : `erro=${encodeURIComponent(r.erro)}`}`);
}

const voltarReserva = (id: string, r: { ok: boolean; erro?: string }) => {
  revalidatePath(`/painel/reservas/${id}`);
  revalidatePath("/painel/financeiro/repasses");
  revalidatePath("/portal");
  redirect(`/painel/reservas/${encodeURIComponent(id)}?${r.ok ? "salvo=recebimento" : `erro=${encodeURIComponent(r.erro ?? "Não foi possível.")}`}`);
};

/** Reserva → "Registrar recebimento": o dinheiro do canal entrou na empresa (data e valor). */
export async function registrarRecebimentoAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  const reservaId = texto(form, "reservaId");
  const valor = reaisParaCentavos(texto(form, "valor"));
  if (typeof valor !== "number") return voltarReserva(reservaId, { ok: false, erro: "Informe o valor recebido em reais (ex.: 850,00)." });
  voltarReserva(reservaId, await registrarRecebimento(getDb(), sessao.organizacaoId, { reservaId, data: texto(form, "data"), valor, nota: texto(form, "nota") }, sessao.usuarioId, hojeISO()));
}

export async function estornarRecebimentoAcao(form: FormData): Promise<void> {
  const sessao = await sessaoEditora();
  voltarReserva(texto(form, "reservaId"), await estornarRecebimento(getDb(), sessao.organizacaoId, texto(form, "id"), texto(form, "motivo"), sessao.usuarioId));
}
