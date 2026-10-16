"use server";

/**
 * Cancelamento de reserva paga pelo site, pela política (M8.2c; desenho §9.1) — ações do painel: calcular a prévia,
 * cancelar (com a assinatura da prévia), registrar e descartar o pedido, marcar as datas reabertas nas OTAs e a mensagem
 * enviada ao hóspede.
 *
 * Sempre nesta ordem, como no M8.2a: sessão (a empresa vem só dela) → permissão → validação → domínio. Calcular e
 * cancelar pedem `reserva:editar` e `financeiro:editar` (mexe em dinheiro); registrar, descartar, OTAs e "mensagem
 * enviada", `reserva:editar` (o descarte do pedido feito pelo hóspede no site também pede o financeiro, e quem confere é
 * o domínio). A leitura do Mercado Pago usa `provedorDeConferencia` (desligar a oferta nunca impede de cancelar). As notas
 * passam pelo validador de dados pessoais aqui e de novo no domínio. Numa recusa, o que foi digitado volta em `valores`.
 * M8.2d (D17): quando o Mercado Pago mostra parte do pagamento devolvida pelo painel dele sem dizer quanto, o valor visto
 * lá (`valorForaInformado`, em reais) vai ao domínio.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir, podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { CANAIS_PEDIDO_CANCELAMENTO, type CanalPedidoCancelamento, MOTIVOS_CANCELAMENTO_EMPRESA, MOTIVOS_EXCECAO, type MotivoCancelamentoEmpresa, type MotivoExcecao, QUEM_CANCELA_RESERVA } from "@/db/schema";
import { ERRO_DADOS_PESSOAIS, textoSemDadosPessoais } from "@/lib/dados-pessoais";
import { instanteLocal, lerHora } from "@/lib/datas";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";
import {
  type CodigoRecusaCancelamento,
  cancelarReservaPaga,
  descartarPedidoDeCancelamento,
  type EntradaCancelamento,
  type EscolhaDaEquipe,
  marcarHospedeAvisado,
  marcarOtaLiberada,
  type PagamentoSemValorFora,
  previaDoCancelamento,
  registrarPedidoDeCancelamento,
  TEXTO_PREVIA_MUDOU,
} from "./cancelamento";
import { CAMPO_VALOR_FORA } from "./campos-cancelamento";
import { type PreviaParaTela, previaParaTela, type ResultadoDoCancelamento, resultadoDoCancelamento } from "./cancelamento-tela";
import { provedorDeConferencia } from "./oferta";
import type { ProvedorPagamento } from "./provedor";

export type EstadoCancelamentoPainel = {
  ok?: boolean;
  mensagem?: string;
  /** O código da recusa do domínio. */
  codigo?: CodigoRecusaCancelamento;
  /**
   * Numa recusa de depois da decisão pela política, o que a equipe pode escolher (a tela oferece a exceção, ou devolver
   * tudo / não devolver sem política, mesmo sem prévia); null = nada a escolher; ausente = a recusa veio antes de decidir.
   */
  escolha?: EscolhaDaEquipe | null;
  previa?: PreviaParaTela;
  valores?: Record<string, string>;
  /** D17: os pagamentos cujo valor devolvido pelo painel do Mercado Pago a equipe precisa informar (um campo por pagamento). */
  foraSemValor?: PagamentoSemValorFora[];
};


const FUSO = "America/Sao_Paulo";
const LIMITE_NOTA = 300;
const ASSINATURA = /^[0-9a-f]{16}$/;
const NAO_ENCONTRADA: EstadoCancelamentoPainel = { mensagem: "Reserva não encontrada." };

const texto = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v.trim() : "";
};
/** Campos de texto do formulário, sem os internos do Next.js ($ACTION_…), para voltarem à tela numa recusa. */
const campos = (form: FormData) =>
  Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$ACTION")).map(([k, v]) => [k, v.slice(0, 2000)]));
const naLista = <T extends string>(lista: readonly T[], v: string): T | null => ((lista as readonly string[]).includes(v) ? (v as T) : null);

/** A ficha da reserva, a lista, o Início (avisos), os pagamentos do site, os repasses e o portal do proprietário. */
function revalidar() {
  revalidatePath("/painel", "layout");
  revalidatePath("/portal", "layout");
}

/** Volta para a ficha com a chave do resultado (o texto é fixo, em `RESULTADOS_DO_CANCELAMENTO`). */
const paraFicha = (reservaId: string, resultado: ResultadoDoCancelamento) => redirect(`/painel/reservas/${reservaId}?cancelamento=${resultado}`);
const comErro = (reservaId: string, erro: string) => redirect(`/painel/reservas/${reservaId}?erro=${encodeURIComponent(erro)}`);

async function sessaoDoCancelamento() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

async function sessaoDaReserva() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

/** Nota curta (0..300, ou 1..300 quando obrigatória) sem dado pessoal; o texto do problema, ou null. */
function problemaDaNota(v: string, obrigatoria: string | null): string | null {
  if (obrigatoria && !v) return obrigatoria;
  if (v.length > LIMITE_NOTA) return `Cada nota tem até ${LIMITE_NOTA} caracteres.`;
  if (textoSemDadosPessoais(v) === null) return ERRO_DADOS_PESSOAIS;
  return null;
}

/** Data (AAAA-MM-DD) e hora ("15:00"; "9:00" e "15h" também, lidas por `lerHora`) de Brasília → instante; vazias = null;
 * uma só ou inválida = "invalido". */
function momentoDoForm(form: FormData, data: string, hora: string): Date | null | "invalido" {
  const d = texto(form, data);
  const h = texto(form, hora);
  if (!d && !h) return null;
  const lida = lerHora(h);
  if (!dataValida(d) || !lida) return "invalido";
  return instanteLocal(d, lida, FUSO);
}

/** O formulário do cancelamento → a entrada do domínio (listas fechadas, notas validadas). */
function entradaDoForm(form: FormData): { ok: true; reservaId: string; e: EntradaCancelamento } | { ok: false; mensagem: string } {
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return { ok: false, mensagem: NAO_ENCONTRADA.mensagem! };
  const recebidoEm = momentoDoForm(form, "recebidoData", "recebidoHora");
  if (recebidoEm === "invalido") return { ok: false, mensagem: "Informe a data e a hora em que o pedido chegou." };
  const quemCancela = naLista(QUEM_CANCELA_RESERVA, texto(form, "quemCancela") || "hospede");
  if (!quemCancela) return { ok: false, mensagem: "Escolha quem cancela." };
  const decisao = naLista(["politica", "excecao", "integral", "nenhum"] as const, texto(form, "decisao") || "politica");
  if (!decisao) return { ok: false, mensagem: "Escolha a decisão." };
  // O canal "site" nunca vem do formulário: o pedido feito pelo hóspede em Minha reserva já está gravado (e travado).
  const canal = naLista(CANAIS_PEDIDO_CANCELAMENTO.filter((c) => c !== "site"), texto(form, "canal"));
  const motivoEmpresa = quemCancela === "empresa" ? naLista<MotivoCancelamentoEmpresa>(MOTIVOS_CANCELAMENTO_EMPRESA, texto(form, "motivoEmpresa")) : null;
  const motivoExcecao = decisao === "excecao" ? naLista<MotivoExcecao>(MOTIVOS_EXCECAO, texto(form, "motivoExcecao")) : null;
  const nota = texto(form, "nota");
  const motivoDecisao = decisao === "politica" ? "" : texto(form, "motivoDecisao");
  const motivoMomento = texto(form, "motivoMomento");
  for (const n of [nota, motivoDecisao, motivoMomento]) {
    const problema = problemaDaNota(n, null);
    if (problema) return { ok: false, mensagem: problema };
  }
  // D17: o valor que o painel do Mercado Pago mostra devolvido fora do sistema, de cada pagamento (só quando a leitura não diz quanto).
  const valoresForaInformados: Record<string, number> = {};
  for (const [campo, bruto] of form.entries()) {
    if (typeof bruto !== "string" || !campo.startsWith(CAMPO_VALOR_FORA) || !bruto.trim()) continue;
    const pagamentoId = campo.slice(CAMPO_VALOR_FORA.length);
    if (!uuidValido(pagamentoId)) continue;
    const valor = reaisParaCentavos(bruto.trim());
    if (typeof valor !== "number" || valor <= 0) return { ok: false, mensagem: "Informe o valor que o painel do Mercado Pago mostra devolvido, em reais (ex.: 300,00)." };
    valoresForaInformados[pagamentoId] = valor;
  }
  return {
    ok: true,
    reservaId,
    e: { recebidoEm, motivoMomento, canal, quemCancela, motivoEmpresa, decisao, motivoExcecao, motivoDecisao, nota, ...(Object.keys(valoresForaInformados).length ? { valoresForaInformados } : {}) },
  };
}

/** O provedor para a releitura (fase 0); sem ele, o domínio decide (o integral de um pagamento ainda legível espera). */
async function provedorDaLeitura(): Promise<ProvedorPagamento | null> {
  const gate = await provedorDeConferencia();
  return gate.ok ? gate.provedor : null;
}

/**
 * Passo 1: "Calcular o cancelamento pela política" — relê o pagamento no Mercado Pago (quando dá) e devolve a prévia em
 * linhas, com a assinatura que o cancelamento confere.
 */
export async function calcularCancelamentoAcao(_e: EstadoCancelamentoPainel, form: FormData): Promise<EstadoCancelamentoPainel> {
  const sessao = await sessaoDoCancelamento();
  const valores = campos(form);
  const v = entradaDoForm(form);
  if (!v.ok) return { mensagem: v.mensagem, valores };
  const r = await previaDoCancelamento(getDb(), sessao.organizacaoId, v.reservaId, v.e, await provedorDaLeitura(), new Date());
  if (!r.ok) return { mensagem: r.erro, codigo: r.codigo, ...("escolha" in r ? { escolha: r.escolha } : {}), ...(r.foraSemValor ? { foraSemValor: r.foraSemValor } : {}), valores };
  // A releitura pode ter mudado o pagamento (situação, taxa, liberação): a ficha mostra o que vale agora.
  revalidar();
  return { ok: true, previa: previaParaTela(r.previa), valores };
}

/**
 * Passo 2: "Cancelar a reserva" — a assinatura da prévia é obrigatória (sem ela, ou diferente, nada muda: calcule de
 * novo). Feito, volta para a ficha com o resultado.
 */
export async function cancelarReservaPagaAcao(_e: EstadoCancelamentoPainel, form: FormData): Promise<EstadoCancelamentoPainel> {
  const sessao = await sessaoDoCancelamento();
  const valores = campos(form);
  const v = entradaDoForm(form);
  if (!v.ok) return { mensagem: v.mensagem, valores };
  const assinatura = texto(form, "assinatura");
  if (!ASSINATURA.test(assinatura)) return { mensagem: TEXTO_PREVIA_MUDOU, codigo: "previa_mudou", valores };
  const r = await cancelarReservaPaga(getDb(), sessao.organizacaoId, v.reservaId, v.e, sessao.usuarioId, await provedorDaLeitura(), new Date(), assinatura);
  if (!r.ok) return { mensagem: r.erro, codigo: r.codigo, ...("escolha" in r ? { escolha: r.escolha } : {}), ...(r.foraSemValor ? { foraSemValor: r.foraSemValor } : {}), valores };
  revalidar();
  // A rota vem da prévia que a equipe viu (só escolhe o texto do resultado; o domínio já decidiu tudo).
  return paraFicha(v.reservaId, resultadoDoCancelamento(r, texto(form, "rota")));
}

/** "Registrar pedido de cancelamento" que chegou por outro canal (reserva:editar): data, hora, como chegou e onde está. */
export async function registrarPedidoCancelamentoAcao(_e: EstadoCancelamentoPainel, form: FormData): Promise<EstadoCancelamentoPainel> {
  const sessao = await sessaoDaReserva();
  const valores = campos(form);
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return { ...NAO_ENCONTRADA, valores };
  const recebidoEm = momentoDoForm(form, "recebidoData", "recebidoHora");
  if (!recebidoEm || recebidoEm === "invalido") return { mensagem: "Informe a data e a hora em que o pedido chegou.", valores };
  const canal = naLista(CANAIS_PEDIDO_CANCELAMENTO.filter((c): c is Exclude<CanalPedidoCancelamento, "site"> => c !== "site"), texto(form, "canal"));
  if (!canal) return { mensagem: "Escolha como o pedido chegou.", valores };
  const nota = texto(form, "nota");
  const problema = problemaDaNota(nota, null);
  if (problema) return { mensagem: problema, valores };
  const r = await registrarPedidoDeCancelamento(getDb(), sessao.organizacaoId, reservaId, { recebidoEm, canal, nota }, sessao.usuarioId, new Date());
  if (!r.ok) return { mensagem: r.erro, valores };
  revalidar();
  return paraFicha(reservaId, "pedido_registrado");
}

/**
 * "Descartar pedido" (reserva:editar; o pedido feito pelo hóspede no site só com o financeiro, como desistência dele, com
 * o canal e a hora da desistência — conferido pelo domínio). O motivo é obrigatório; o pedido fica no histórico.
 */
export async function descartarPedidoCancelamentoAcao(_e: EstadoCancelamentoPainel, form: FormData): Promise<EstadoCancelamentoPainel> {
  const sessao = await sessaoDaReserva();
  const valores = campos(form);
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return { ...NAO_ENCONTRADA, valores };
  const motivo = texto(form, "motivo");
  const problema = problemaDaNota(motivo, "Escreva o motivo (sem dados pessoais).");
  if (problema) return { mensagem: problema, valores };
  const canal = naLista(CANAIS_PEDIDO_CANCELAMENTO, texto(form, "desistenciaCanal"));
  const em = momentoDoForm(form, "desistenciaData", "desistenciaHora");
  if (em === "invalido") return { mensagem: "Informe a data e a hora em que o hóspede desistiu.", valores };
  const desistencia = canal && em ? { canal, em } : undefined;
  const r = await descartarPedidoDeCancelamento(getDb(), sessao.organizacaoId, reservaId, { motivo, desistencia }, { id: sessao.usuarioId, podeFinanceiro: podeFazer(sessao.papel, "financeiro:editar") }, new Date());
  if (!r.ok) return { mensagem: r.erro, valores };
  revalidar();
  return paraFicha(reservaId, "pedido_descartado");
}

/** "Datas reabertas nas OTAs" (reserva:editar), com confirmação na tela. */
export async function marcarOtaLiberadaAcao(form: FormData): Promise<void> {
  const sessao = await sessaoDaReserva();
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return redirect("/painel/reservas");
  const r = await marcarOtaLiberada(getDb(), sessao.organizacaoId, reservaId, sessao.usuarioId, new Date());
  revalidar();
  if (!r.ok) return comErro(reservaId, r.erro);
  return paraFicha(reservaId, "ota");
}

/** "Mensagem enviada ao hóspede" (reserva:editar): o pedido recebido, a decisão ou a devolução feita, uma vez cada. */
export async function marcarHospedeAvisadoAcao(form: FormData): Promise<void> {
  const sessao = await sessaoDaReserva();
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return redirect("/painel/reservas");
  const qual = naLista(["pedido", "decisao", "devolucao"] as const, texto(form, "qual"));
  if (!qual) return comErro(reservaId, "Escolha qual mensagem foi enviada.");
  const r = await marcarHospedeAvisado(getDb(), sessao.organizacaoId, reservaId, qual, sessao.usuarioId, new Date());
  revalidar();
  if (!r.ok) return comErro(reservaId, r.erro);
  return paraFicha(reservaId, "avisado");
}
