"use server";

/**
 * Disputa do pagamento no site (M8.2e; desenho "Quem pode" e "Painel") — as ações do quadro da disputa: registrar a disputa
 * vista no painel do Mercado Pago, confirmar o débito, registrar e mudar quem arca, atualizar o valor segurado, confirmar
 * que é outra disputa, documentos enviados, o prazo dos documentos, confirmar o resultado, encerrar sem efeito, conferir o
 * aviso (e reabrir) e cancelar a reserva contestada (prévia e cancelar).
 *
 * Sempre nesta ordem, como no M8.2c e no M8.2d: sessão (a empresa vem só dela) → permissão → validação → domínio.
 * - `financeiro:editar` para todas, menos "Documentos enviados" (`reserva:editar` ou `financeiro:editar`) e "Cancelar a
 *   reserva contestada" (`reserva:editar` **e** `financeiro:editar`). O papel proprietário não edita o financeiro: nunca
 *   passa daqui.
 * - O id da disputa e o do pagamento vindos do formulário são resolvidos na empresa da sessão antes de qualquer outra coisa
 *   (`reservaDaContestacao`, `reservaDoPagamento`): de outra empresa, "não encontrada", sem ler o Mercado Pago e sem
 *   gravar nada (o domínio confere de novo, com `contestacaoDaOrganizacao`/`pagamentoDaOrganizacao`).
 * - A leitura do Mercado Pago (fase 0) usa `provedorDeConferencia`; sem ele, o domínio segue com a nota "sem leitura".
 * - As notas passam pelo validador de dados pessoais aqui e de novo no domínio. Numa recusa, o que foi digitado volta em
 *   `valores`; feito, volta para a ficha com a chave fixa do resultado (`?contestacao=`).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AcessoNegado, exigir, podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { ERRO_DADOS_PESSOAIS, textoSemDadosPessoais } from "@/lib/dados-pessoais";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";
import { cancelarReservaContestada, previaDoCancelamentoContestado, TEXTO_PREVIA_MUDOU } from "./cancelamento";
import {
  atualizarValorSegurado,
  conferirAviso,
  confirmarDebito,
  confirmarOutraDisputa,
  confirmarResultado,
  encerrarSemEfeito,
  informarPrazoDocumentos,
  marcarDocumentosEnviados,
  mudarDecisao,
  registrarContestacaoDaEquipe,
  registrarDecisao,
} from "./contestacao";
import { LIMITE_NOTA_CONTESTACAO, TEXTO_CONTESTACAO_PREVIA_MUDOU, TEXTO_DECISAO_MUDOU } from "./contestacao-regras";
import { reservaDaContestacao, reservaDoPagamento, type ResultadoDaContestacao } from "./contestacao-tela";
import { provedorDeConferencia } from "./oferta";
import type { ProvedorPagamento } from "./provedor";

export type EstadoContestacaoPainel = {
  ok?: boolean;
  mensagem?: string;
  /** O código da recusa do domínio. */
  codigo?: string;
  /** "Cancelar a reserva contestada", passo 1: a prévia (o valor retido, os avisos, a pergunta e a assinatura). */
  previa?: { valorPago: number; valorRetido: number; avisos: string[]; assinatura: string; pergunta: string };
  valores?: Record<string, string>;
};

const ASSINATURA = /^[0-9a-f]{16}$/;
const NAO_ENCONTRADA = "Disputa não encontrada.";
const PAGAMENTO_NAO_ENCONTRADO = "Pagamento não encontrado.";
const RESERVA_NAO_ENCONTRADA = "Reserva não encontrada.";

const texto = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v.trim() : "";
};
/** Campos de texto do formulário, sem os internos do Next.js ($ACTION_…), para voltarem à tela numa recusa. */
const campos = (form: FormData) =>
  Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$ACTION")).map(([k, v]) => [k, v.slice(0, 2000)]));
const marcado = (form: FormData, k: string) => ["on", "sim", "1", "true"].includes(texto(form, k));

/** A ficha da reserva, a lista, o Início (avisos), os pagamentos do site, os repasses, o portal e a página da reserva no site. */
function revalidar() {
  revalidatePath("/painel", "layout");
  revalidatePath("/portal", "layout");
  revalidatePath("/reservar/[codigo]", "page");
  revalidatePath("/hospede");
}

/** Volta para a ficha com a chave do resultado (o texto é fixo, em `RESULTADOS_DA_CONTESTACAO`). */
const paraFicha = (reservaId: string, resultado: ResultadoDaContestacao) => redirect(`/painel/reservas/${reservaId}?contestacao=${resultado}`);

async function sessaoFinanceira() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

/** "Documentos enviados": quem edita a reserva ou quem edita o financeiro (a operação manda os documentos pelo painel do Mercado Pago). */
async function sessaoDosDocumentos() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "reserva:editar") && !podeFazer(sessao.papel, "financeiro:editar")) throw new AcessoNegado("ACAO_NAO_PERMITIDA");
  // A empresa: a mesma regra de sempre (a sessão é válida e é desta empresa).
  exigir(sessao, podeFazer(sessao.papel, "reserva:editar") ? "reserva:editar" : "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

async function sessaoDoCancelamento() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

/** Nota curta (0..300, ou 1..300 quando obrigatória) sem dado pessoal; o texto do problema, ou null. */
function problemaDaNota(v: string, obrigatoria: string | null): string | null {
  if (obrigatoria && !v) return obrigatoria;
  if (v.length > LIMITE_NOTA_CONTESTACAO) return `Cada nota tem até ${LIMITE_NOTA_CONTESTACAO} caracteres.`;
  if (v && textoSemDadosPessoais(v) === null) return ERRO_DADOS_PESSOAIS;
  return null;
}

/** Reais do formulário → centavos (vazio = null; inválido = "invalido"). */
function centavosDoForm(form: FormData, k: string): number | null | "invalido" {
  const v = texto(form, k);
  if (!v) return null;
  const c = reaisParaCentavos(v);
  return typeof c === "number" && c >= 0 ? c : "invalido";
}

/** Uma data AAAA-MM-DD do formulário (vazia = null; inválida = "invalido"). */
function dataDoForm(form: FormData, k: string): string | null | "invalido" {
  const v = texto(form, k);
  if (!v) return null;
  return dataValida(v) ? v : "invalido";
}

/** O provedor para a releitura (fase 0); sem ele, o domínio segue com a nota "sem leitura do Mercado Pago". */
async function provedorDaLeitura(): Promise<ProvedorPagamento | null> {
  const gate = await provedorDeConferencia();
  return gate.ok ? gate.provedor : null;
}

/** A disputa do formulário na empresa da sessão (antes de qualquer outra coisa): a reserva dela, ou null. */
async function disputaDaSessao(organizacaoId: string, form: FormData) {
  const id = texto(form, "contestacaoId");
  if (!uuidValido(id)) return null;
  const ref = await reservaDaContestacao(getDb(), organizacaoId, id);
  return ref ? { id, ...ref } : null;
}

const recusa = (r: { erro: string; codigo?: string }, valores: Record<string, string>): EstadoContestacaoPainel => ({ mensagem: r.erro, ...(r.codigo ? { codigo: r.codigo } : {}), valores });

/**
 * "Registrar disputa vista no painel do Mercado Pago" (financeiro:editar), no quadro do pagamento: o tipo, o dia em que
 * abriu, o valor, o prazo dos documentos (opcional), o número do caso (opcional) e a nota (obrigatória). O domínio relê a
 * order e as disputas no Mercado Pago (melhor esforço), casa sob a trava e avisa a equipe por e-mail.
 */
export async function registrarDisputaAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoFinanceira();
  const valores = campos(form);
  const pagamentoId = texto(form, "pagamentoId");
  const ref = uuidValido(pagamentoId) ? await reservaDoPagamento(getDb(), sessao.organizacaoId, pagamentoId) : null;
  if (!ref) return { mensagem: PAGAMENTO_NAO_ENCONTRADO, valores };
  const tipo = texto(form, "tipo");
  if (!tipo) return { mensagem: "Escolha o tipo da disputa.", valores };
  const abertaEm = dataDoForm(form, "abertaEm");
  if (!abertaEm || abertaEm === "invalido") return { mensagem: "Informe o dia em que a disputa abriu.", valores };
  const valor = centavosDoForm(form, "valor");
  if (valor === null || valor === "invalido" || valor <= 0) return { mensagem: "Informe o valor em disputa em reais (ex.: 1.824,00).", valores };
  const prazo = dataDoForm(form, "prazo");
  if (prazo === "invalido") return { mensagem: "Prazo dos documentos inválido.", valores };
  const idCaso = texto(form, "idCaso");
  if (idCaso && !/^\d{1,20}$/.test(idCaso)) return { mensagem: "O número do caso tem só algarismos (até 20).", valores };
  const nota = texto(form, "nota");
  const problema = problemaDaNota(nota, "Escreva a nota (o que foi visto no painel do Mercado Pago, sem dados pessoais).");
  if (problema) return { mensagem: problema, valores };
  const r = await registrarContestacaoDaEquipe(getDb(), sessao.organizacaoId, pagamentoId, { tipo, abertaEm, valor, prazo, idCaso: idCaso || null, nota }, sessao.usuarioId, await provedorDaLeitura(), new Date(), {
    correio: correioDoAmbiente(),
  });
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, r.mensagem ? "registrada_duplicata" : "registrada");
}

/** "Confirmar o débito do Mercado Pago" (financeiro:editar): o dia e o valor que ele debitou (nota quando o valor difere do valor em risco). */
export async function confirmarDebitoAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoFinanceira();
  const valores = campos(form);
  const ref = await disputaDaSessao(sessao.organizacaoId, form);
  if (!ref) return { mensagem: NAO_ENCONTRADA, valores };
  const data = dataDoForm(form, "data");
  if (!data || data === "invalido") return { mensagem: "Informe o dia em que o Mercado Pago debitou.", valores };
  const valor = centavosDoForm(form, "valor");
  if (valor === null || valor === "invalido" || valor <= 0) return { mensagem: "Informe o valor debitado em reais (ex.: 1.000,00).", valores };
  const nota = texto(form, "nota");
  const problema = problemaDaNota(nota, null);
  if (problema) return { mensagem: problema, valores };
  const r = await confirmarDebito(getDb(), sessao.organizacaoId, ref.id, { data, valor, nota }, sessao.usuarioId, new Date());
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, "debito");
}

/** A entrada da decisão (registrar ou mudar): a causa, quem arca, a nota, a explicação, a versão e a assinatura da opção. */
function entradaDaDecisao(form: FormData): { ok: true; e: { causa: string; quemArca: string; nota: string; explicacao: string; versao: number; assinatura: string } } | { ok: false; mensagem: string; codigo?: string } {
  const causa = texto(form, "causa");
  if (!causa) return { ok: false, mensagem: "Escolha a causa da disputa." };
  const quemArca = texto(form, "quemArca");
  if (!quemArca) return { ok: false, mensagem: "Escolha quem arca." };
  const versaoTexto = texto(form, "versao");
  if (!/^\d{1,6}$/.test(versaoTexto)) return { ok: false, mensagem: TEXTO_DECISAO_MUDOU, codigo: "decisao_mudou" };
  const assinatura = texto(form, "assinatura");
  if (!ASSINATURA.test(assinatura)) return { ok: false, mensagem: TEXTO_CONTESTACAO_PREVIA_MUDOU, codigo: "contestacao_previa_mudou" };
  const nota = texto(form, "nota");
  const explicacao = texto(form, "explicacao");
  for (const [v, obrigatoria] of [
    [nota, "Escreva a nota da decisão (sem dados pessoais)."],
    [explicacao, null],
  ] as const) {
    const problema = problemaDaNota(v, obrigatoria);
    if (problema) return { ok: false, mensagem: problema };
  }
  return { ok: true, e: { causa, quemArca, nota, explicacao, versao: Number(versaoTexto), assinatura } };
}

/** "Registrar quem arca" (financeiro:editar), com a versão 0 e a assinatura da opção que a equipe viu. */
export async function registrarDecisaoAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoFinanceira();
  const valores = campos(form);
  const ref = await disputaDaSessao(sessao.organizacaoId, form);
  if (!ref) return { mensagem: NAO_ENCONTRADA, valores };
  const v = entradaDaDecisao(form);
  if (!v.ok) return { mensagem: v.mensagem, ...(v.codigo ? { codigo: v.codigo } : {}), valores };
  const r = await registrarDecisao(getDb(), sessao.organizacaoId, ref.id, v.e, sessao.usuarioId, new Date());
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, texto(form, "perdida") === "sim" ? "decisao_definitiva" : "decisao");
}

/** "Mudar quem arca" (financeiro:editar), só antes do resultado: a nota é o "por que mudar". */
export async function mudarDecisaoAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoFinanceira();
  const valores = campos(form);
  const ref = await disputaDaSessao(sessao.organizacaoId, form);
  if (!ref) return { mensagem: NAO_ENCONTRADA, valores };
  const v = entradaDaDecisao(form);
  if (!v.ok) return { mensagem: v.mensagem, ...(v.codigo ? { codigo: v.codigo } : {}), valores };
  const r = await mudarDecisao(getDb(), sessao.organizacaoId, ref.id, v.e, sessao.usuarioId, new Date());
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, "decisao_mudada");
}

/** "Atualizar o valor segurado" (financeiro:editar): a mesma causa e quem arca, com o valor em disputa de agora. */
export async function atualizarValorSeguradoAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoFinanceira();
  const valores = campos(form);
  const ref = await disputaDaSessao(sessao.organizacaoId, form);
  if (!ref) return { mensagem: NAO_ENCONTRADA, valores };
  const versao = texto(form, "versao");
  if (!/^\d{1,6}$/.test(versao)) return { mensagem: TEXTO_DECISAO_MUDOU, codigo: "decisao_mudou", valores };
  const assinatura = texto(form, "assinatura");
  if (!ASSINATURA.test(assinatura)) return { mensagem: TEXTO_CONTESTACAO_PREVIA_MUDOU, codigo: "contestacao_previa_mudou", valores };
  const r = await atualizarValorSegurado(getDb(), sessao.organizacaoId, ref.id, { versao: Number(versao), assinatura }, sessao.usuarioId, new Date());
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, "valor_atualizado");
}

/** "Confirmar que é outra disputa" (financeiro:editar), na possível duplicata. */
export async function confirmarOutraDisputaAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoFinanceira();
  const valores = campos(form);
  const ref = await disputaDaSessao(sessao.organizacaoId, form);
  if (!ref) return { mensagem: NAO_ENCONTRADA, valores };
  const r = await confirmarOutraDisputa(getDb(), sessao.organizacaoId, ref.id, sessao.usuarioId, new Date());
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, "outra_disputa");
}

/** "Documentos enviados no painel do Mercado Pago" (reserva:editar ou financeiro:editar), com a data do envio. */
export async function marcarDocumentosEnviadosAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoDosDocumentos();
  const valores = campos(form);
  const ref = await disputaDaSessao(sessao.organizacaoId, form);
  if (!ref) return { mensagem: NAO_ENCONTRADA, valores };
  const data = dataDoForm(form, "data");
  if (!data || data === "invalido") return { mensagem: "Informe o dia em que os documentos foram enviados.", valores };
  const r = await marcarDocumentosEnviados(getDb(), sessao.organizacaoId, ref.id, { data }, sessao.usuarioId, new Date());
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, "documentos");
}

/** O prazo dos documentos informado pela equipe (financeiro:editar), quando a leitura não o trouxe. */
export async function informarPrazoAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoFinanceira();
  const valores = campos(form);
  const ref = await disputaDaSessao(sessao.organizacaoId, form);
  if (!ref) return { mensagem: NAO_ENCONTRADA, valores };
  const prazo = dataDoForm(form, "prazo");
  if (!prazo || prazo === "invalido") return { mensagem: "Informe o prazo dos documentos.", valores };
  const r = await informarPrazoDocumentos(getDb(), sessao.organizacaoId, ref.id, { prazo }, sessao.usuarioId, new Date());
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, "prazo");
}

/**
 * "Confirmar o resultado" (financeiro:editar): Ganhou ou Perdeu (o formulário começa sem nada marcado), a data, a nota, a
 * nota reforçada, a versão e a assinatura da prévia, a tarifa e os campos de cada resultado. O domínio relê no Mercado Pago
 * (melhor esforço) e confere tudo de novo sob a trava.
 */
export async function confirmarResultadoAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoFinanceira();
  const valores = campos(form);
  const ref = await disputaDaSessao(sessao.organizacaoId, form);
  if (!ref) return { mensagem: NAO_ENCONTRADA, valores };
  const resultado = texto(form, "resultado");
  if (resultado !== "ganha" && resultado !== "perdida") return { mensagem: "Escolha o resultado: Ganhou ou Perdeu.", valores };
  const data = dataDoForm(form, "data");
  if (!data || data === "invalido") return { mensagem: "Informe a data do resultado.", valores };
  const versao = texto(form, "versao");
  if (!/^\d{1,6}$/.test(versao)) return { mensagem: TEXTO_DECISAO_MUDOU, codigo: "decisao_mudou", valores };
  const assinatura = texto(form, "assinatura");
  if (!ASSINATURA.test(assinatura)) return { mensagem: TEXTO_CONTESTACAO_PREVIA_MUDOU, codigo: "contestacao_previa_mudou", valores };
  const nota = texto(form, "nota");
  const problema = problemaDaNota(nota, null);
  if (problema) return { mensagem: problema, valores };
  const tarifa = centavosDoForm(form, "tarifa");
  if (tarifa === "invalido") return { mensagem: "Informe a tarifa do Mercado Pago pela disputa em reais (zero ou mais), ou deixe em branco.", valores };
  const e: Parameters<typeof confirmarResultado>[3] = { resultado, data, nota, notaReforcada: marcado(form, "notaReforcada"), versao: Number(versao), assinatura, tarifa };
  if (resultado === "ganha") {
    const voltaEm = dataDoForm(form, "voltaEm");
    if (voltaEm === "invalido") return { mensagem: "Informe o dia em que o dinheiro voltou.", valores };
    e.voltaEm = voltaEm;
    const libData = dataDoForm(form, "liberacaoData");
    const libLiquido = centavosDoForm(form, "liberacaoLiquido");
    if (libData === "invalido" || libLiquido === "invalido") return { mensagem: "Informe a data e o líquido da liberação (ou deixe os dois em branco).", valores };
    if ((libData === null) !== (libLiquido === null)) return { mensagem: "Informe a data e o líquido da liberação (ou deixe os dois em branco).", valores };
    if (libData && libLiquido !== null) e.liberacao = { data: libData, liquido: libLiquido };
  } else {
    const valorPerdido = centavosDoForm(form, "valorPerdido");
    const liquidoNaoEntrou = centavosDoForm(form, "liquidoNaoEntrou");
    const debitoEm = dataDoForm(form, "debitoEm");
    if (valorPerdido === null || valorPerdido === "invalido") return { mensagem: "Informe o valor que a SCL perdeu, em reais.", valores };
    if (liquidoNaoEntrou === "invalido") return { mensagem: "Informe quanto deste pagamento nunca entrou na conta, em reais (zero se entrou tudo).", valores };
    if (debitoEm === "invalido") return { mensagem: "Informe o dia em que o Mercado Pago debitou.", valores };
    e.valorPerdido = valorPerdido;
    e.liquidoNaoEntrou = liquidoNaoEntrou ?? 0;
    e.debitoEm = debitoEm;
  }
  const r = await confirmarResultado(getDb(), sessao.organizacaoId, ref.id, e, sessao.usuarioId, await provedorDaLeitura(), new Date());
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, resultado);
}

/** "Encerrar sem efeito" (financeiro:editar): a nota (obrigatória), a nota reforçada e, com o retido realizado, o dia em que o dinheiro voltou. */
export async function encerrarSemEfeitoAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoFinanceira();
  const valores = campos(form);
  const ref = await disputaDaSessao(sessao.organizacaoId, form);
  if (!ref) return { mensagem: NAO_ENCONTRADA, valores };
  const nota = texto(form, "nota");
  const problema = problemaDaNota(nota, "Escreva por que a disputa fica sem efeito (sem dados pessoais).");
  if (problema) return { mensagem: problema, valores };
  const voltaEm = dataDoForm(form, "voltaEm");
  if (voltaEm === "invalido") return { mensagem: "Informe o dia em que o dinheiro voltou.", valores };
  const r = await encerrarSemEfeito(getDb(), sessao.organizacaoId, ref.id, { nota, notaReforcada: marcado(form, "notaReforcada"), voltaEm }, sessao.usuarioId, await provedorDaLeitura(), new Date());
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, "sem_efeito");
}

/** "Conferir o aviso" (financeiro:editar): continua encerrada, ou (só numa ganha relida em andamento) foi reaberta. Nota obrigatória. */
export async function conferirAvisoAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoFinanceira();
  const valores = campos(form);
  const ref = await disputaDaSessao(sessao.organizacaoId, form);
  if (!ref) return { mensagem: NAO_ENCONTRADA, valores };
  const como = texto(form, "como");
  if (como !== "continua_encerrada" && como !== "reaberta") return { mensagem: "Escolha o que o painel do Mercado Pago mostra.", valores };
  const nota = texto(form, "nota");
  const problema = problemaDaNota(nota, "Escreva o que o painel do Mercado Pago mostra (sem dados pessoais).");
  if (problema) return { mensagem: problema, valores };
  const r = await conferirAviso(getDb(), sessao.organizacaoId, ref.id, { como, nota }, sessao.usuarioId, new Date());
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, como === "reaberta" ? "reaberta" : "aviso_conferido");
}

/** "Cancelar a reserva contestada", passo 1 (reserva:editar e financeiro:editar): a prévia, com a pergunta e a assinatura. */
export async function previaDoCancelamentoContestadoAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoDoCancelamento();
  const valores = campos(form);
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return { mensagem: RESERVA_NAO_ENCONTRADA, valores };
  const r = await previaDoCancelamentoContestado(getDb(), sessao.organizacaoId, reservaId, new Date());
  if (!r.ok) return recusa(r, valores);
  const { valorPago, valorRetido, avisos, assinatura, pergunta } = r.previa;
  return { ok: true, previa: { valorPago, valorRetido, avisos, assinatura, pergunta }, valores };
}

/** "Cancelar a reserva contestada", passo 2: com a assinatura da prévia (obrigatória) e a nota (obrigatória). */
export async function cancelarReservaContestadaAcao(_e: EstadoContestacaoPainel, form: FormData): Promise<EstadoContestacaoPainel> {
  const sessao = await sessaoDoCancelamento();
  const valores = campos(form);
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return { mensagem: RESERVA_NAO_ENCONTRADA, valores };
  const nota = texto(form, "nota");
  const problema = problemaDaNota(nota, "Escreva por que cancelar a reserva contestada (obrigatória, sem dados pessoais).");
  if (problema) return { mensagem: problema, valores };
  const assinatura = texto(form, "assinatura");
  if (!ASSINATURA.test(assinatura)) return { mensagem: TEXTO_PREVIA_MUDOU, codigo: "previa_mudou", valores };
  const r = await cancelarReservaContestada(getDb(), sessao.organizacaoId, reservaId, { nota, assinatura }, sessao.usuarioId, await provedorDaLeitura(), new Date());
  if (!r.ok) return recusa(r, valores);
  revalidar();
  return paraFicha(reservaId, "cancelada");
}
