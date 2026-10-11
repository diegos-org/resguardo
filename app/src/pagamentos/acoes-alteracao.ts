"use server";

/**
 * Alteração de reserva paga pelo site (M8.2d; desenho §9.1) — ações do painel: calcular a prévia, segurar as novas datas
 * (e, sem aumento, já aplicar), a prévia e o "Aplicar" de uma alteração segurada, desistir, marcar o bloqueio mudado nas
 * OTAs e a mensagem enviada ao hóspede.
 *
 * Sempre nesta ordem, como no M8.2c: sessão (a empresa vem só dela) → permissão → validação → domínio. Calcular, segurar,
 * aplicar e desistir pedem `reserva:editar` e `financeiro:editar` (mexe em dinheiro); OTAs e "mensagem enviada",
 * `reserva:editar`. Uma alteração pelo id é procurada antes na empresa da sessão (`cotacaoDaAlteracao`): de outra empresa,
 * "Alteração não encontrada.", sem ler o Mercado Pago e sem gravar nada. A leitura do Mercado Pago usa
 * `provedorDeConferencia` (desligar a oferta nunca impede de alterar uma redução). As notas passam pelo validador de dados
 * pessoais aqui e de novo no domínio. Numa recusa, o que foi digitado volta em `valores`.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir, podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import {
  CANAIS_PEDIDO_ALTERACAO,
  type CanalPedidoAlteracao,
  MOTIVOS_CANCELAMENTO_EMPRESA,
  MOTIVOS_EXCECAO,
  MOTIVOS_VALOR_ALTERACAO,
  type MotivoCancelamentoEmpresa,
  type MotivoExcecao,
  type MotivoValorAlteracao,
  QUEM_PEDE_ALTERACAO,
} from "@/db/schema";
import { ERRO_DADOS_PESSOAIS, textoSemDadosPessoais } from "@/lib/dados-pessoais";
import { instanteLocal } from "@/lib/datas";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { uuidValido } from "@/lib/ids";
import { propostaDaPrevia } from "@/mensagens/hospede";
import { dataValida } from "@/reservas/regras";
import {
  aplicarAlteracaoPelaEquipe,
  type CodigoRecusaAlteracao,
  desistirDaAlteracao,
  type EntradaAlteracao,
  marcarHospedeAvisadoDaAlteracao,
  marcarOtaAtualizada,
  prazoDasDatas,
  type PreviaAlteracao,
  previaDaAlteracao,
  previaDaAplicacao,
  segurarAlteracao,
  TEXTO_PREVIA_MUDOU_ALTERACAO,
  type ValorDaAlteracao,
} from "./alteracao";
import { type PreviaAlteracaoParaTela, previaAlteracaoParaTela, type ResultadoDaAlteracao, resultadoDaAlteracao } from "./alteracao-tela";
import type { EscolhaDaEquipe } from "./cancelamento";
import { provedorDeConferencia } from "./oferta";
import type { ProvedorPagamento } from "./provedor";
import { cotacaoDaAlteracao } from "./travas";

export type EstadoAlteracaoPainel = {
  ok?: boolean;
  mensagem?: string;
  /** O código da recusa do domínio. */
  codigo?: CodigoRecusaAlteracao;
  /** Numa recusa da redução, o que a equipe pode escolher (a exceção, ou devolver / não devolver sem política); ausente = a recusa veio antes. */
  escolha?: EscolhaDaEquipe | null;
  previa?: PreviaAlteracaoParaTela;
  valores?: Record<string, string>;
};

const FUSO = "America/Sao_Paulo";
const LIMITE_NOTA = 300;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const ASSINATURA = /^[0-9a-f]{16}$/;
const RESERVA_NAO_ENCONTRADA = "Reserva não encontrada.";
const ALTERACAO_NAO_ENCONTRADA = "Alteração não encontrada.";

const texto = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v.trim() : "";
};
/** Campos de texto do formulário, sem os internos do Next.js ($ACTION_…), para voltarem à tela numa recusa. */
const campos = (form: FormData) =>
  Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$ACTION")).map(([k, v]) => [k, v.slice(0, 2000)]));
const naLista = <T extends string>(lista: readonly T[], v: string): T | null => ((lista as readonly string[]).includes(v) ? (v as T) : null);

/** A ficha da reserva, a lista, o Início (avisos), os pagamentos do site, os repasses, o portal e a página da reserva no site. */
function revalidar() {
  revalidatePath("/painel", "layout");
  revalidatePath("/portal", "layout");
  revalidatePath("/reservar/[codigo]", "page");
}

/** Volta para a ficha com a chave do resultado (o texto é fixo, em `textoDoResultadoDaAlteracao`). */
const paraFicha = (reservaId: string, resultado: ResultadoDaAlteracao) => redirect(`/painel/reservas/${reservaId}?alteracao=${resultado}`);
const comErro = (reservaId: string, erro: string) => redirect(`/painel/reservas/${reservaId}?erro=${encodeURIComponent(erro)}`);

async function sessaoDaAlteracao() {
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

/**
 * O formulário da alteração → a entrada do domínio (listas fechadas, notas validadas). A SCL propondo, o momento do pedido é
 * o de agora (o domínio usa o dele); o hóspede pedindo, a data e a hora em que o pedido chegou (padrão: agora).
 */
function entradaDoForm(form: FormData, agora: Date): { ok: true; reservaId: string; e: EntradaAlteracao } | { ok: false; mensagem: string } {
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return { ok: false, mensagem: RESERVA_NAO_ENCONTRADA };
  const checkin = texto(form, "checkin");
  const checkout = texto(form, "checkout");
  if (!dataValida(checkin) || !dataValida(checkout) || checkout <= checkin) return { ok: false, mensagem: "Informe a nova entrada e a nova saída (a saída depois da entrada)." };
  const hospedesTexto = texto(form, "hospedes");
  const hospedes = /^\d{1,3}$/.test(hospedesTexto) ? Number(hospedesTexto) : Number.NaN;
  if (!Number.isInteger(hospedes) || hospedes < 1) return { ok: false, mensagem: "Informe quantas pessoas." };
  const quemPede = naLista(QUEM_PEDE_ALTERACAO, texto(form, "quemPede") || "hospede");
  if (!quemPede) return { ok: false, mensagem: "Escolha quem pede a alteração." };
  const motivoEmpresa = quemPede === "empresa" ? naLista<MotivoCancelamentoEmpresa>(MOTIVOS_CANCELAMENTO_EMPRESA, texto(form, "motivoEmpresa")) : null;
  if (quemPede === "empresa" && !motivoEmpresa) return { ok: false, mensagem: "Escolha o motivo da SCL." };
  let recebidoEm = agora;
  let canal: CanalPedidoAlteracao | null = null;
  if (quemPede === "hospede") {
    const d = texto(form, "recebidoData");
    const h = texto(form, "recebidoHora");
    if (!dataValida(d) || !HORA.test(h)) return { ok: false, mensagem: "Informe a data e a hora em que o pedido chegou." };
    recebidoEm = instanteLocal(d, h, FUSO);
    canal = naLista(CANAIS_PEDIDO_ALTERACAO, texto(form, "canal"));
    if (!canal) return { ok: false, mensagem: "Escolha como o pedido chegou." };
  }
  const origem = naLista(["cotacao", "mantido", "digitado"] as const, texto(form, "origemValor") || "cotacao");
  if (!origem) return { ok: false, mensagem: "Escolha de onde vem o valor novo." };
  let valor: ValorDaAlteracao = { origem: "cotacao" };
  if (origem !== "cotacao") {
    const motivo = naLista<MotivoValorAlteracao>(MOTIVOS_VALOR_ALTERACAO, texto(form, "motivoValor"));
    if (!motivo) return { ok: false, mensagem: "Escolha o motivo do valor." };
    const nota = texto(form, "motivoValorNota");
    const problema = problemaDaNota(nota, "Escreva a nota do motivo do valor (obrigatória, sem dados pessoais).");
    if (problema) return { ok: false, mensagem: problema };
    if (origem === "mantido") valor = { origem, motivo, nota };
    else {
      const centavos = reaisParaCentavos(texto(form, "valor"));
      if (typeof centavos !== "number" || centavos <= 0) return { ok: false, mensagem: "Digite o valor novo em reais (ex.: 1.900,00)." };
      valor = { origem, valor: centavos, motivo, nota };
    }
  }
  const decisao = naLista(["politica", "excecao", "integral", "nenhum"] as const, texto(form, "decisao") || "politica");
  if (!decisao) return { ok: false, mensagem: "Escolha a decisão." };
  const motivoExcecao = decisao === "excecao" ? naLista<MotivoExcecao>(MOTIVOS_EXCECAO, texto(form, "motivoExcecao")) : null;
  const nota = texto(form, "nota");
  const motivoDecisao = decisao === "politica" ? "" : texto(form, "motivoDecisao");
  for (const n of [nota, motivoDecisao]) {
    const problema = problemaDaNota(n, null);
    if (problema) return { ok: false, mensagem: problema };
  }
  return { ok: true, reservaId, e: { checkin, checkout, hospedes, valor, quemPede, motivoEmpresa, recebidoEm, canal, nota, decisao, motivoExcecao, motivoDecisao } };
}

/** O provedor para a releitura (fase 0) e para conferir se o site pode cobrar (aumento); sem ele, o domínio decide. */
async function provedorDaLeitura(): Promise<ProvedorPagamento | null> {
  const gate = await provedorDeConferencia();
  return gate.ok ? gate.provedor : null;
}

/** A proposta pronta para copiar, a partir da prévia (só para quem lê o financeiro: leva valores). */
async function propostaDe(organizacaoId: string, p: PreviaAlteracao, agora: Date) {
  return propostaDaPrevia(getDb(), organizacaoId, p.reservaId, {
    rumo: p.rumo,
    antes: p.antes,
    depois: p.depois,
    diferenca: p.diferenca,
    valorNovo: p.valorNovo,
    holdAte: p.holdAte ?? prazoDasDatas(agora, p.holdMinutos, p.limiteDoPrazo),
    preparadaEm: agora,
    reducao:
      p.rumo === "reducao" && p.direito
        ? {
            direito: p.direito,
            base: p.base,
            integralAte: p.decisao?.integralAte ?? null,
            arrependimentoAte: p.decisao?.arrependimentoAte ?? null,
            arrependimentoAteEntrada: p.politica?.arrependimentoAteEntrada ?? null,
            entradaDaEstadia: p.antes.checkin,
          }
        : null,
    politicaVersao: p.politica?.versao ?? null,
    entradaDaPolitica: p.entradaDaPolitica,
    entradaDosPrazos: p.entradaDaPolitica,
  }).catch(() => null);
}

const recusaParaTela = (r: { erro: string; codigo: CodigoRecusaAlteracao; escolha?: EscolhaDaEquipe | null }, valores: Record<string, string>): EstadoAlteracaoPainel => ({
  mensagem: r.erro,
  codigo: r.codigo,
  ...("escolha" in r ? { escolha: r.escolha } : {}),
  valores,
});

/**
 * Passo 1: "Calcular a alteração" — relê os pagamentos no Mercado Pago (quando dá) e devolve a prévia em linhas, com a
 * assinatura que o "segurar" confere e a proposta para copiar.
 */
export async function calcularAlteracaoAcao(_e: EstadoAlteracaoPainel, form: FormData): Promise<EstadoAlteracaoPainel> {
  const sessao = await sessaoDaAlteracao();
  const valores = campos(form);
  const agora = new Date();
  const v = entradaDoForm(form, agora);
  if (!v.ok) return { mensagem: v.mensagem, valores };
  const r = await previaDaAlteracao(getDb(), sessao.organizacaoId, v.reservaId, v.e, await provedorDaLeitura(), agora);
  if (!r.ok) return recusaParaTela(r, valores);
  // A releitura pode ter mudado o pagamento (situação, taxa, liberação): a ficha mostra o que vale agora.
  revalidar();
  const proposta = podeFazer(sessao.papel, "financeiro:ler") ? await propostaDe(sessao.organizacaoId, r.previa, agora) : null;
  return { ok: true, previa: previaAlteracaoParaTela(r.previa, agora, proposta), valores };
}

/**
 * Passo 2: "Segurar as novas datas e liberar o pagamento da diferença" (aumento), "Só segurar as datas" ou "Aplicar a
 * alteração" (sem aumento, `aplicar` = "sim") — a assinatura da prévia é obrigatória (sem ela, ou diferente, nada muda:
 * calcule de novo). Feito, volta para a ficha com o resultado.
 */
export async function segurarAlteracaoAcao(_e: EstadoAlteracaoPainel, form: FormData): Promise<EstadoAlteracaoPainel> {
  const sessao = await sessaoDaAlteracao();
  const valores = campos(form);
  const agora = new Date();
  const v = entradaDoForm(form, agora);
  if (!v.ok) return { mensagem: v.mensagem, valores };
  const assinatura = texto(form, "assinatura");
  if (!ASSINATURA.test(assinatura)) return { mensagem: TEXTO_PREVIA_MUDOU_ALTERACAO, codigo: "previa_mudou", valores };
  const aplicar = texto(form, "aplicar") === "sim";
  const r = await segurarAlteracao(getDb(), sessao.organizacaoId, v.reservaId, v.e, sessao.usuarioId, await provedorDaLeitura(), agora, assinatura, { aplicar });
  if (!r.ok) return recusaParaTela(r, valores);
  revalidar();
  // A rota vem da prévia que a equipe viu (só escolhe o texto do resultado; o domínio já decidiu tudo).
  return paraFicha(v.reservaId, resultadoDaAlteracao(r.situacao, texto(form, "rota")));
}

/** A alteração pelo id, na empresa da sessão: a reserva dela, ou null (de outra empresa ou inexistente). */
async function alteracaoDaSessao(organizacaoId: string, alteracaoId: string) {
  if (!uuidValido(alteracaoId)) return null;
  return cotacaoDaAlteracao(getDb(), organizacaoId, alteracaoId);
}

/** "Aplicar a alteração" de uma segurada (sem aumento), passo 1: a prévia da aplicação (o retrato gravado e o dinheiro de agora). */
export async function previaDaAplicacaoAcao(_e: EstadoAlteracaoPainel, form: FormData): Promise<EstadoAlteracaoPainel> {
  const sessao = await sessaoDaAlteracao();
  const valores = campos(form);
  const alteracaoId = texto(form, "alteracaoId");
  if (!(await alteracaoDaSessao(sessao.organizacaoId, alteracaoId))) return { mensagem: ALTERACAO_NAO_ENCONTRADA, valores };
  const agora = new Date();
  const r = await previaDaAplicacao(getDb(), sessao.organizacaoId, alteracaoId, await provedorDaLeitura(), agora);
  if (!r.ok) return recusaParaTela(r, valores);
  revalidar();
  return { ok: true, previa: previaAlteracaoParaTela(r.previa, agora), valores };
}

/** "Aplicar a alteração" de uma segurada, passo 2: com a assinatura da prévia da aplicação (obrigatória). */
export async function aplicarAlteracaoAcao(_e: EstadoAlteracaoPainel, form: FormData): Promise<EstadoAlteracaoPainel> {
  const sessao = await sessaoDaAlteracao();
  const valores = campos(form);
  const alteracaoId = texto(form, "alteracaoId");
  const ref = await alteracaoDaSessao(sessao.organizacaoId, alteracaoId);
  if (!ref) return { mensagem: ALTERACAO_NAO_ENCONTRADA, valores };
  const assinatura = texto(form, "assinatura");
  if (!ASSINATURA.test(assinatura)) return { mensagem: TEXTO_PREVIA_MUDOU_ALTERACAO, codigo: "previa_mudou", valores };
  const r = await aplicarAlteracaoPelaEquipe(getDb(), sessao.organizacaoId, alteracaoId, sessao.usuarioId, await provedorDaLeitura(), new Date(), assinatura);
  if (!r.ok) return recusaParaTela(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, resultadoDaAlteracao("aplicada", texto(form, "rota")));
}

/** "Desistir da alteração" (com o motivo, obrigatório): as novas datas voltam à venda; o Pix da diferença pendente é cancelado. */
export async function desistirDaAlteracaoAcao(_e: EstadoAlteracaoPainel, form: FormData): Promise<EstadoAlteracaoPainel> {
  const sessao = await sessaoDaAlteracao();
  const valores = campos(form);
  const alteracaoId = texto(form, "alteracaoId");
  const motivo = texto(form, "motivo");
  const problema = problemaDaNota(motivo, "Escreva o motivo da desistência (sem dados pessoais).");
  if (problema) return { mensagem: problema, valores };
  const ref = await alteracaoDaSessao(sessao.organizacaoId, alteracaoId);
  if (!ref) return { mensagem: ALTERACAO_NAO_ENCONTRADA, valores };
  const r = await desistirDaAlteracao(getDb(), sessao.organizacaoId, alteracaoId, motivo, sessao.usuarioId, await provedorDaLeitura(), new Date());
  if (!r.ok) return recusaParaTela(r, valores);
  revalidar();
  return paraFicha(ref.reservaId, "desistida");
}

/** "Datas atualizadas nas OTAs" (reserva:editar), com confirmação na tela. */
export async function marcarOtaAtualizadaAcao(form: FormData): Promise<void> {
  const sessao = await sessaoDaReserva();
  const alteracaoId = texto(form, "alteracaoId");
  const ref = await alteracaoDaSessao(sessao.organizacaoId, alteracaoId);
  if (!ref) return redirect("/painel/reservas");
  const r = await marcarOtaAtualizada(getDb(), sessao.organizacaoId, alteracaoId, sessao.usuarioId, new Date());
  revalidar();
  if (!r.ok) return comErro(ref.reservaId, r.erro);
  return paraFicha(ref.reservaId, "ota");
}

/** "Mensagem enviada ao hóspede" de uma alteração (reserva:editar): a proposta, a confirmação ou a devolução feita, uma vez cada. */
export async function marcarHospedeAvisadoAlteracaoAcao(form: FormData): Promise<void> {
  const sessao = await sessaoDaReserva();
  const alteracaoId = texto(form, "alteracaoId");
  const ref = await alteracaoDaSessao(sessao.organizacaoId, alteracaoId);
  if (!ref) return redirect("/painel/reservas");
  const qual = naLista(["proposta", "confirmacao", "devolucao"] as const, texto(form, "qual"));
  if (!qual) return comErro(ref.reservaId, "Escolha qual mensagem foi enviada.");
  const r = await marcarHospedeAvisadoDaAlteracao(getDb(), sessao.organizacaoId, alteracaoId, qual, sessao.usuarioId, new Date());
  revalidar();
  if (!r.ok) return comErro(ref.reservaId, r.erro);
  return paraFicha(ref.reservaId, "avisado");
}
