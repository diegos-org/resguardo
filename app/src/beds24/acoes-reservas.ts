"use server";

/**
 * Reserva paga do site no Beds24 (M8.3a) — ações do painel. Nenhuma escreve no Beds24 e nenhuma chama a rede, salvo a
 * leitura dos escopos no deploy de produção com a escrita pronta (`conferirEscoposReservasBeds24`).
 *
 * Sempre nesta ordem: sessão (a empresa vem só dela) → permissão (deny-by-default) → validação → domínio, que confere a
 * permissão de novo.
 * - Ficha: "Simular" (`reserva:editar`) grava só uma operação simulada e volta à ficha com a chave do resultado.
 * - Integrações (`configuracao:editar`, com `BotaoConfirmar` na tela e auditoria no domínio): pausar e retomar, ligar e
 *   desligar um imóvel (D6; ligar exige um ensaio conferido com a credencial atual, e o ensaio é do M8.3c) e conferir os
 *   escopos da credencial (só leitura).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir, podeFazer, type Sessao } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { uuidValido } from "@/lib/ids";
import { conferirEscoposReservasBeds24, type EscoposDaCredencial } from "./reservas-site-painel";
import { desligarImovelReservasBeds24, ligarImovelReservasBeds24, pausarReservasBeds24, type ResultadoConfigReservasBeds24, retomarReservasBeds24 } from "./reservas-site-config";
import { chaveDoResultadoDaSimulacao, simularReservaNoBeds24 } from "./reservas-site-simulacao";

export type EstadoReservasBeds24 = { ok?: boolean; mensagem?: string };
export type EstadoEscoposReservasBeds24 = { mensagem?: string; resultado?: EscoposDaCredencial };

const texto = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** A ficha, Integrações e o Início (a pausa e o imóvel ligado mudam o "desligada" da ficha). */
function revalidar() {
  revalidatePath("/painel", "layout");
}

/** "Simular" (ficha): monta o pedido só com o banco e grava a operação simulada; nunca usa a rede. */
export async function simularReservaBeds24Acao(form: FormData): Promise<void> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return redirect("/painel/reservas");
  const r = await simularReservaNoBeds24(getDb(), sessao, reservaId, process.env, new Date());
  revalidatePath(`/painel/reservas/${reservaId}`);
  return redirect(`/painel/reservas/${reservaId}?beds24=${chaveDoResultadoDaSimulacao(r)}`);
}

const SEM_PERMISSAO: EstadoReservasBeds24 = { ok: false, mensagem: "Somente quem edita as configurações muda o envio das reservas do site ao Beds24." };

/** A sessão de quem edita as configurações; null = sem a permissão (nada muda). */
async function sessaoDaConfiguracao(): Promise<Sessao | null> {
  const sessao = await exigirSessaoPainel();
  return podeFazer(sessao.papel, "configuracao:editar") ? sessao : null;
}

function resposta(r: ResultadoConfigReservasBeds24, ok: string): EstadoReservasBeds24 {
  revalidar();
  return r.ok ? { ok: true, mensagem: ok } : { ok: false, mensagem: r.erro };
}

/** Pausa geral das reservas do site: vale na hora e para todo o envio delas, inclusive o cancelamento (o calendário e os preços não). */
export async function pausarReservasBeds24Acao(_anterior: EstadoReservasBeds24, _form: FormData): Promise<EstadoReservasBeds24> {
  void _anterior;
  void _form;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return SEM_PERMISSAO;
  return resposta(await pausarReservasBeds24(getDb(), sessao, new Date()), "Pausado: nenhuma reserva do site é escrita no Beds24 até você retomar. O calendário e os preços não param com esta pausa.");
}

export async function retomarReservasBeds24Acao(_anterior: EstadoReservasBeds24, _form: FormData): Promise<EstadoReservasBeds24> {
  void _anterior;
  void _form;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return SEM_PERMISSAO;
  return resposta(await retomarReservasBeds24(getDb(), sessao), "Pausa retirada. O envio continua dependendo da chave, da credencial e dos imóveis ligados.");
}

/** Liga um imóvel (D6): o domínio recusa sem um ensaio conferido com a credencial atual. */
export async function ligarImovelReservasBeds24Acao(_anterior: EstadoReservasBeds24, form: FormData): Promise<EstadoReservasBeds24> {
  void _anterior;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return SEM_PERMISSAO;
  const imovelId = texto(form, "imovelId");
  return resposta(await ligarImovelReservasBeds24(getDb(), sessao, imovelId, process.env, new Date()), "Imóvel ligado: as reservas pagas pelo site confirmadas a partir de agora vão ao Beds24.");
}

/** Desliga um imóvel: só a criação para; a atualização e o cancelamento do que o sistema já criou seguem. */
export async function desligarImovelReservasBeds24Acao(_anterior: EstadoReservasBeds24, form: FormData): Promise<EstadoReservasBeds24> {
  void _anterior;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return SEM_PERMISSAO;
  const imovelId = texto(form, "imovelId");
  return resposta(await desligarImovelReservasBeds24(getDb(), sessao, imovelId), "Imóvel desligado: nenhuma reserva nova dele vai ao Beds24; as já criadas continuam sendo atualizadas e canceladas.");
}

/** Prontidão: os escopos da credencial, só leitura (nas prévias e no computador, a resposta é que não lê). */
export async function conferirEscoposReservasBeds24Acao(_anterior: EstadoEscoposReservasBeds24, _form: FormData): Promise<EstadoEscoposReservasBeds24> {
  void _anterior;
  void _form;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return { mensagem: SEM_PERMISSAO.mensagem };
  return { resultado: await conferirEscoposReservasBeds24(process.env) };
}
