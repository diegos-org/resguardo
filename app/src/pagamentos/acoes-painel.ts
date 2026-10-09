"use server";

/**
 * Pagamento no site (M8.2a) — ações do painel: conferir agora (uma tentativa ou todas as pendentes da empresa),
 * devolver pelo Mercado Pago, registrar a devolução feita por fora, registrar a taxa que não voltou, registrar e
 * estornar a liberação à mão, e salvar a aba Configurações → Pagamento no site.
 *
 * Sempre nesta ordem: sessão (a empresa vem só dela) → permissão `financeiro:editar` → validação → domínio. Conferir,
 * cancelar, devolver e a devolução por fora (que relê a order antes) usam `provedorDeConferencia` (sem a chave do
 * painel): desligar a oferta nunca impede de cuidar do dinheiro já cobrado. As mensagens do domínio voltam para a
 * tela como vieram.
 */
import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { type ErrosPagamentoSite, salvarConfigPagamentoSite, validarConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";
import { conferirTentativa } from "./conferencia";
import { devolverPeloProvedor, registrarDevolucaoPorFora, registrarTaxaPerdida } from "./devolucao";
import { estornarLiberacaoManual, registrarLiberacaoManual } from "./liberacao";
import { provedorDeConferencia } from "./oferta";
import { ErroProvedor } from "./provedor";
import { conferirPendentes, type ResumoConferencia } from "./rotina";
import { NOMES_SITUACAO_PAGAMENTO } from "./situacoes";

export type EstadoAcaoPagamento = { ok?: boolean; mensagem?: string };
export type EstadoConfigPagamento = { ok?: boolean; mensagem?: string; aviso?: string; erros?: ErrosPagamentoSite; valores?: Record<string, string> };

const FUSO = "America/Sao_Paulo";
const NAO_ENCONTRADO: EstadoAcaoPagamento = { mensagem: "Pagamento não encontrado." };

async function sessaoFinanceira() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

const texto = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** Campos de texto do formulário, sem os internos do Next.js ($ACTION_…). */
const campos = (form: FormData) => Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !e[0].startsWith("$ACTION")));

/** Ficha da reserva, Pagamentos do site, Início (avisos), a aba, repasses e o portal do proprietário. */
function revalidar() {
  revalidatePath("/painel", "layout");
  revalidatePath("/portal", "layout");
}

/** Falha de transporte do provedor vira mensagem (de lista fechada); o resto sobe. */
function falhaDoProvedor(e: unknown): EstadoAcaoPagamento {
  if (e instanceof ErroProvedor) return { mensagem: e.message };
  throw e;
}

function textoDoResumo(r: ResumoConferencia): string {
  const partes = [`${r.conferidas} pagamento(s) conferido(s) com o Mercado Pago, ${r.mudaram} com mudança`];
  if (r.devolucoes) partes.push(`${r.devolucoes} devolução(ões) confirmada(s)`);
  if (r.canceladas) partes.push(`${r.canceladas} Pix que sobrou cancelado(s)`);
  const texto = `${partes.join(", ")}.`;
  return r.falhas ? `${texto} ${r.falhas} não deu para conferir agora: tente de novo em instantes.` : texto;
}

/**
 * "Conferir agora": com `pagamentoId`, lê aquela tentativa no Mercado Pago (sem esperar o intervalo); sem ele,
 * confere tudo o que está pendente da empresa (as tentativas em andamento, as aprovadas sem taxa ou liberação e as
 * devoluções pedidas).
 */
export async function conferirAgoraAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const pagamentoId = texto(form, "pagamentoId");
  if (pagamentoId && !uuidValido(pagamentoId)) return NAO_ENCONTRADO;
  const gate = await provedorDeConferencia();
  if (!gate.ok) return { mensagem: gate.texto };
  const db = getDb();
  try {
    if (pagamentoId) {
      const r = await conferirTentativa(db, sessao.organizacaoId, pagamentoId, gate.provedor, new Date(), { forcar: true, origem: "painel" });
      if (!r.ok) return { mensagem: r.erro };
      revalidar();
      const situacao = NOMES_SITUACAO_PAGAMENTO[r.situacao].toLowerCase();
      return { ok: true, mensagem: r.mudou ? `Conferido com o Mercado Pago: atualizado (${situacao}).` : `Conferido com o Mercado Pago: nada mudou (${situacao}).` };
    }
    const resumo = await conferirPendentes(db, sessao.organizacaoId, gate.provedor);
    revalidar();
    return { ok: true, mensagem: resumo.conferidas || resumo.falhas || resumo.devolucoes || resumo.canceladas ? textoDoResumo(resumo) : "Nada pendente para conferir com o Mercado Pago." };
  } catch (e) {
    return falhaDoProvedor(e);
  }
}

/** Devolver pelo Mercado Pago (integral) o pagamento que ficou sem reserva. */
export async function devolverAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const pagamentoId = texto(form, "pagamentoId");
  if (!uuidValido(pagamentoId)) return NAO_ENCONTRADO;
  const gate = await provedorDeConferencia();
  if (!gate.ok) return { mensagem: `${gate.texto} Se o dinheiro voltou ao hóspede por outro caminho, registre a devolução feita por fora.` };
  try {
    const r = await devolverPeloProvedor(getDb(), sessao.organizacaoId, pagamentoId, sessao.usuarioId, gate.provedor);
    if (!r.ok) return { mensagem: r.erro };
    revalidar();
    return {
      ok: true,
      mensagem: r.situacao === "confirmada" ? "Devolução confirmada pelo Mercado Pago." : "Devolução pedida ao Mercado Pago: a confirmação aparece no quadro do pagamento quando ele concluir (use Conferir agora).",
    };
  } catch (e) {
    return falhaDoProvedor(e);
  }
}

/**
 * A devolução foi feita fora do sistema (Pix da conta da empresa, por exemplo): data, valor e nota. Antes, o domínio
 * relê a order no Mercado Pago (pelo provedor de conferência): sem conseguir conferir, nada é registrado.
 */
export async function devolucaoPorForaAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const pagamentoId = texto(form, "pagamentoId");
  if (!uuidValido(pagamentoId)) return NAO_ENCONTRADO;
  const data = texto(form, "data");
  if (!dataValida(data)) return { mensagem: "Informe a data da devolução." };
  if (data > hojeISO(FUSO)) return { mensagem: "A data da devolução não pode ser no futuro." };
  const valor = reaisParaCentavos(texto(form, "valor"));
  if (typeof valor !== "number" || valor <= 0) return { mensagem: "Informe o valor devolvido em reais (ex.: 850,00)." };
  const gate = await provedorDeConferencia();
  if (!gate.ok) return { mensagem: `Não deu para conferir no Mercado Pago se a devolução já foi feita por lá (${gate.texto.replace(/\.$/, "")}). Sem essa conferência, a devolução feita por fora não é registrada.` };
  const r = await registrarDevolucaoPorFora(getDb(), sessao.organizacaoId, pagamentoId, { data, valor, nota: texto(form, "nota") }, sessao.usuarioId, gate.provedor);
  if (!r.ok) return { mensagem: r.erro };
  revalidar();
  return { ok: true, mensagem: "Devolução feita por fora registrada." };
}

/**
 * Taxa que o Mercado Pago não devolveu (informada pela equipe depois da devolução confirmada): valor em reais, zero
 * se voltou toda. Vira despesa da empresa e tira o aviso.
 */
export async function registrarTaxaPerdidaAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const pagamentoId = texto(form, "pagamentoId");
  if (!uuidValido(pagamentoId)) return NAO_ENCONTRADO;
  const valor = reaisParaCentavos(texto(form, "valor"));
  if (typeof valor !== "number" || valor < 0) return { mensagem: "Informe a taxa que não voltou em reais (ex.: 18,06; zero se voltou toda)." };
  const r = await registrarTaxaPerdida(getDb(), sessao.organizacaoId, pagamentoId, valor, sessao.usuarioId);
  if (!r.ok) return { mensagem: r.erro };
  revalidar();
  return { ok: true, mensagem: valor > 0 ? "Taxa registrada: a despesa entrou no financeiro da empresa." : "Registrado: a taxa voltou toda, nenhuma despesa lançada." };
}

/** Liberação registrada à mão (sem o sinal do Mercado Pago): a data em que caiu (até hoje) e o líquido. */
export async function registrarLiberacaoAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const pagamentoId = texto(form, "pagamentoId");
  if (!uuidValido(pagamentoId)) return NAO_ENCONTRADO;
  const data = texto(form, "data");
  if (!dataValida(data)) return { mensagem: "Informe a data em que o dinheiro caiu na conta." };
  if (data > hojeISO(FUSO)) return { mensagem: "A data da liberação não pode ser no futuro." };
  const liquido = reaisParaCentavos(texto(form, "liquido"));
  if (typeof liquido !== "number" || liquido <= 0) return { mensagem: "Informe o líquido que caiu na conta, em reais (ex.: 1.750,00)." };
  const r = await registrarLiberacaoManual(getDb(), sessao.organizacaoId, pagamentoId, { data, liquido }, sessao.usuarioId);
  if (!r.ok) return { mensagem: r.erro };
  revalidar();
  return { ok: true, mensagem: "Liberação registrada: o recebimento entrou na reserva e a taxa foi gravada." };
}

/** Estorna a liberação registrada à mão (a confirmada pelo Mercado Pago nunca se estorna pelo painel). */
export async function estornarLiberacaoAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const pagamentoId = texto(form, "pagamentoId");
  if (!uuidValido(pagamentoId)) return NAO_ENCONTRADO;
  const motivo = texto(form, "motivo");
  if (!motivo) return { mensagem: "Informe o motivo do estorno." };
  const r = await estornarLiberacaoManual(getDb(), sessao.organizacaoId, pagamentoId, motivo, sessao.usuarioId);
  if (!r.ok) return { mensagem: r.erro };
  revalidar();
  return { ok: true, mensagem: "Liberação estornada. Registre de novo quando souber a data e o valor certos." };
}

/** Configurações → Pagamento no site (auditado; vale para as tentativas novas). */
export async function salvarConfigPagamentoSiteAcao(_e: EstadoConfigPagamento, form: FormData): Promise<EstadoConfigPagamento> {
  const sessao = await sessaoFinanceira();
  const valores = campos(form);
  const v = validarConfigPagamentoSite(valores);
  if (!v.ok) return { erros: v.erros, mensagem: "Confira os campos destacados.", valores };
  const r = await salvarConfigPagamentoSite(getDb(), sessao.organizacaoId, v.config, sessao.usuarioId);
  if (!r.ok) return { erros: r.erros, mensagem: "Confira os campos destacados.", valores };
  revalidar();
  // A página da cotação lê a chave a cada pedido; revalidar também o que estiver em cache do site.
  revalidatePath("/reservar/[codigo]", "page");
  if (!r.mudou) return { ok: true, aviso: "Nada mudou." };
  return {
    ok: true,
    aviso: v.config.oferecer
      ? "Salvo. Vale para os Pix novos; os já gerados seguem como estavam."
      : "Salvo. O site deixa de oferecer o Pix nos pedidos novos; o que já foi pago continua sendo conferido e pode ser devolvido.",
  };
}
