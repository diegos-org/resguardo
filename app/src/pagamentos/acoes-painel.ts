"use server";

/**
 * Pagamento no site (M8.2a) — ações do painel: conferir agora (uma tentativa ou todas as pendentes da empresa),
 * devolver pelo Mercado Pago, registrar a devolução feita por fora, registrar a taxa que não voltou, registrar e
 * estornar a liberação à mão, salvar a aba Configurações → Pagamento no site e religar o cartão desligado pelo
 * disjuntor de recusas (M8.2b). M8.2c: as mesmas devoluções servem à do cancelamento pela política (quem decide é o
 * domínio), mais confirmar a devolução vista no painel do Mercado Pago, registrar a recusa de lá, parar a devolução
 * pedida depois do prazo de leitura e corrigir a taxa que não voltou. M8.2d: várias devoluções por pagamento — cada ação de
 * devolução leva o id da devolução (`devolucaoId`, procurado na empresa da sessão pelo domínio); o pagamento (`pagamentoId`)
 * fica para o pagamento sem reserva ("Devolver ao hóspede" ou o restante dele, com o valor que o painel do Mercado Pago
 * mostra quando a leitura não diz, `valorForaInformado`). Mais "Pedir o restante ao Mercado Pago" e o restante por fora
 * (`restanteDe`) de uma devolução que ele fez a menos, e o valor visto no painel ao confirmar uma devolução.
 *
 * Sempre nesta ordem: sessão (a empresa vem só dela) → permissão `financeiro:editar` → validação → domínio. Conferir,
 * cancelar, devolver e a devolução por fora (que relê a order antes) usam `provedorDeConferencia` (sem a chave do
 * painel): desligar a oferta nunca impede de cuidar do dinheiro já cobrado. As mensagens do domínio voltam para a
 * tela como vieram.
 */
import { revalidatePath } from "next/cache";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { type ErrosPagamentoSite, lerConfigPagamentoSite, salvarConfigPagamentoSite, validarConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";
import { conferirTentativa } from "./conferencia";
import { conferirContestacoesDoPagamento } from "./contestacao";
import {
  type AlvoDaDevolucao,
  confirmarDevolucaoVistaNoProvedor,
  corrigirTaxaPerdida,
  devolverPeloProvedor,
  pararDevolucaoPedida,
  pedirRestanteDaDevolucao,
  registrarDevolucaoPorFora,
  registrarRecusaNoPainel,
  registrarTaxaPerdida,
} from "./devolucao";
import { religarCartao } from "./disjuntor";
import { estornarLiberacaoManual, registrarLiberacaoManual } from "./liberacao";
import { provedorDeConferencia } from "./oferta";
import { ErroProvedor } from "./provedor";
import { conferirPendentes, type ResumoConferencia } from "./rotina";
import { NOMES_SITUACAO_PAGAMENTO } from "./situacoes";

export type EstadoAcaoPagamento = { ok?: boolean; mensagem?: string };
export type EstadoConfigPagamento = { ok?: boolean; mensagem?: string; aviso?: string; erros?: ErrosPagamentoSite; valores?: Record<string, string> };

const FUSO = "America/Sao_Paulo";
const NAO_ENCONTRADO: EstadoAcaoPagamento = { mensagem: "Pagamento não encontrado." };
const DEVOLUCAO_NAO_ENCONTRADA: EstadoAcaoPagamento = { mensagem: "Devolução não encontrada." };

async function sessaoFinanceira() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "financeiro:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

const texto = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/**
 * A devolução que a ação alcança: pelo id (o quadro do pagamento, M8.2d) ou, sem ele, pelo pagamento (o pagamento sem
 * reserva). null = nenhum id válido (nada chega ao domínio).
 */
function alvoDoForm(form: FormData): AlvoDaDevolucao | null {
  const devolucaoId = texto(form, "devolucaoId");
  if (devolucaoId) return uuidValido(devolucaoId) ? { devolucaoId } : null;
  const pagamentoId = texto(form, "pagamentoId");
  return uuidValido(pagamentoId) ? { pagamentoId } : null;
}
const naoEncontrado = (form: FormData) => (texto(form, "devolucaoId") ? DEVOLUCAO_NAO_ENCONTRADA : NAO_ENCONTRADO);

/**
 * O valor que o painel do Mercado Pago mostra devolvido fora do sistema (D17), em reais, quando a leitura não diz quanto:
 * vazio = não informado; inválido = o texto do problema.
 */
function valorForaDoForm(form: FormData): { ok: true; valor: number | undefined } | { ok: false; mensagem: string } {
  const bruto = texto(form, "valorForaInformado");
  if (!bruto) return { ok: true, valor: undefined };
  const v = reaisParaCentavos(bruto);
  if (typeof v !== "number" || v <= 0) return { ok: false, mensagem: "Informe o valor que o painel do Mercado Pago mostra devolvido, em reais (ex.: 300,00)." };
  return { ok: true, valor: v };
}

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
      // M8.2e: o "Conferir agora" de um pagamento relê também as disputas dele (e a busca das tardias), só daquele pagamento.
      const disputas = await conferirContestacoesDoPagamento(db, sessao.organizacaoId, pagamentoId, gate.provedor, new Date());
      revalidar();
      const situacao = NOMES_SITUACAO_PAGAMENTO[r.situacao].toLowerCase();
      const daDisputa = disputas.novas ? ` ${disputas.novas} disputa(s) nova(s) no quadro.` : disputas.mudaram ? " As disputas do pagamento foram atualizadas." : "";
      return { ok: true, mensagem: `${r.mudou ? `Conferido com o Mercado Pago: atualizado (${situacao}).` : `Conferido com o Mercado Pago: nada mudou (${situacao}).`}${daDisputa}` };
    }
    // Do painel, lê agora (sem os intervalos da rotina): o botão promete conferir tudo o que está pendente.
    const resumo = await conferirPendentes(db, sessao.organizacaoId, gate.provedor, new Date(), { forcar: true });
    revalidar();
    return { ok: true, mensagem: resumo.conferidas || resumo.falhas || resumo.devolucoes || resumo.canceladas ? textoDoResumo(resumo) : "Nada pendente para conferir com o Mercado Pago." };
  } catch (e) {
    return falhaDoProvedor(e);
  }
}

/**
 * Devolver pelo Mercado Pago: o pagamento que ficou sem reserva (o integral, ou o restante de um já devolvido em parte, D17,
 * com o valor que o painel do Mercado Pago mostra quando a leitura não diz) ou, pelo id, pedir de novo uma devolução recusada.
 */
export async function devolverAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const alvo = alvoDoForm(form);
  if (!alvo) return naoEncontrado(form);
  const fora = valorForaDoForm(form);
  if (!fora.ok) return { mensagem: fora.mensagem };
  const gate = await provedorDeConferencia();
  if (!gate.ok) return { mensagem: `${gate.texto} Se o dinheiro voltou ao hóspede por outro caminho, registre a devolução feita por fora.` };
  try {
    const r = await devolverPeloProvedor(getDb(), sessao.organizacaoId, alvo, sessao.usuarioId, gate.provedor, new Date(), fora.valor === undefined ? {} : { valorForaInformado: fora.valor });
    if (!r.ok) return { mensagem: r.erro };
    revalidar();
    // Parada logo na releitura (em parte, contestada, fora de "aprovado"...): nada foi pedido, e a equipe resolve.
    if (r.situacao === "recusada")
      return { mensagem: "A devolução não foi pedida: o Mercado Pago não mostra este pagamento aprovado e inteiro. Veja o aviso no quadro do pagamento e confira no painel do Mercado Pago." };
    return {
      ok: true,
      mensagem: r.situacao === "confirmada" ? "Devolução confirmada pelo Mercado Pago." : "Devolução pedida ao Mercado Pago: a confirmação aparece no quadro do pagamento quando ele concluir (use Conferir agora).",
    };
  } catch (e) {
    return falhaDoProvedor(e);
  }
}

/**
 * "Pedir o restante ao Mercado Pago" (M8.2d, D15): a devolução que o Mercado Pago fez a menos ganha a do restante, com chave
 * nova e o valor explícito; o domínio confere o teto sob a trava e pede.
 */
export async function pedirRestanteAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const devolucaoId = texto(form, "devolucaoId");
  if (!uuidValido(devolucaoId)) return DEVOLUCAO_NAO_ENCONTRADA;
  const gate = await provedorDeConferencia();
  if (!gate.ok) return { mensagem: `${gate.texto} Se o restante voltou ao hóspede por outro caminho, registre o restante devolvido por fora.` };
  try {
    const r = await pedirRestanteDaDevolucao(getDb(), sessao.organizacaoId, devolucaoId, sessao.usuarioId, gate.provedor);
    if (!r.ok) return { mensagem: r.erro };
    revalidar();
    if (r.situacao === "recusada") return { mensagem: "O restante foi registrado, mas o Mercado Pago não aceitou o pedido agora: veja o aviso no quadro do pagamento e confira no painel do Mercado Pago." };
    return {
      ok: true,
      mensagem: r.situacao === "confirmada" ? "Restante confirmado pelo Mercado Pago." : "Restante pedido ao Mercado Pago: a confirmação aparece no quadro do pagamento quando ele concluir (use Conferir agora).",
    };
  } catch (e) {
    return falhaDoProvedor(e);
  }
}

/**
 * A devolução foi feita fora do sistema (Pix da conta da empresa, por exemplo): data, valor e nota. Antes, o domínio
 * relê a order no Mercado Pago (pelo provedor de conferência): sem conseguir conferir, nada é registrado. M8.2d: pelo id
 * da devolução (o valor dela), pelo restante de uma devolvida a menos (`restanteDe`) ou pelo pagamento sem reserva.
 */
export async function devolucaoPorForaAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const restanteDe = texto(form, "restanteDe");
  if (restanteDe && !uuidValido(restanteDe)) return DEVOLUCAO_NAO_ENCONTRADA;
  const alvo: AlvoDaDevolucao | { restanteDe: string } | null = restanteDe ? { restanteDe } : alvoDoForm(form);
  if (!alvo) return naoEncontrado(form);
  const fora = valorForaDoForm(form);
  if (!fora.ok) return { mensagem: fora.mensagem };
  const data = texto(form, "data");
  if (!dataValida(data)) return { mensagem: "Informe a data da devolução." };
  if (data > hojeISO(FUSO)) return { mensagem: "A data da devolução não pode ser no futuro." };
  const valor = reaisParaCentavos(texto(form, "valor"));
  if (typeof valor !== "number" || valor <= 0) return { mensagem: "Informe o valor devolvido em reais (ex.: 850,00)." };
  const gate = await provedorDeConferencia();
  if (!gate.ok) return { mensagem: `Não deu para conferir no Mercado Pago se a devolução já foi feita por lá (${gate.texto.replace(/\.$/, "")}). Sem essa conferência, a devolução feita por fora não é registrada.` };
  const r = await registrarDevolucaoPorFora(
    getDb(),
    sessao.organizacaoId,
    alvo,
    { data, valor, nota: texto(form, "nota"), ...(fora.valor === undefined ? {} : { valorForaInformado: fora.valor }) },
    sessao.usuarioId,
    gate.provedor,
  );
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
  const alvo = alvoDoForm(form);
  if (!alvo) return naoEncontrado(form);
  const valor = reaisParaCentavos(texto(form, "valor"));
  if (typeof valor !== "number" || valor < 0) return { mensagem: "Informe a taxa que não voltou em reais (ex.: 18,06; zero se voltou toda)." };
  const r = await registrarTaxaPerdida(getDb(), sessao.organizacaoId, alvo, valor, sessao.usuarioId);
  if (!r.ok) return { mensagem: r.erro };
  revalidar();
  return { ok: true, mensagem: valor > 0 ? "Taxa registrada: a despesa entrou no financeiro da empresa." : "Registrado: a taxa voltou toda, nenhuma despesa lançada." };
}

/** A data de um registro da equipe (até hoje, em São Paulo) e a nota obrigatória; o texto do problema, ou null. */
function problemaDoRegistro(data: string, nota: string): string | null {
  if (!dataValida(data)) return "Informe a data.";
  if (data > hojeISO(FUSO)) return "A data não pode ser no futuro.";
  if (!nota) return "Escreva a nota (sem dados pessoais).";
  return null;
}

/**
 * "Confirmar devolução feita no painel do Mercado Pago" (M8.2c): a equipe viu lá a devolução concluída e o sistema não tem
 * como ver. O domínio relê a order antes (pelo provedor de conferência; sem ele, só quando a order com certeza não existe
 * mais) e lança o caixa da devolução com a data informada. M8.2d: com o valor que o painel mostra (menos que o pedido =
 * confirmada por esse valor, com o aviso de a menor); vazio = o valor da devolução.
 */
export async function confirmarDevolucaoVistaAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const alvo = alvoDoForm(form);
  if (!alvo) return naoEncontrado(form);
  const brutoValor = texto(form, "valor");
  const valor = brutoValor ? reaisParaCentavos(brutoValor) : null;
  if (brutoValor && (typeof valor !== "number" || valor <= 0)) return { mensagem: "Informe o valor que o painel do Mercado Pago mostra devolvido, em reais (ex.: 300,00)." };
  const d = { data: texto(form, "data"), nota: texto(form, "nota"), ...(typeof valor === "number" ? { valor } : {}) };
  const problema = problemaDoRegistro(d.data, d.nota);
  if (problema) return { mensagem: problema };
  const gate = await provedorDeConferencia();
  const r = await confirmarDevolucaoVistaNoProvedor(getDb(), sessao.organizacaoId, alvo, d, sessao.usuarioId, gate.ok ? gate.provedor : null);
  if (!r.ok) return { mensagem: r.erro };
  revalidar();
  return { ok: true, mensagem: r.mensagem ?? "Devolução confirmada: o financeiro da devolução foi lançado com a data informada. Informe a taxa que não voltou." };
}

/** "Registrar que o Mercado Pago recusou a devolução no painel" (M8.2c): libera a devolução por fora no cartão. */
export async function registrarRecusaNoPainelAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const alvo = alvoDoForm(form);
  if (!alvo) return naoEncontrado(form);
  const d = { data: texto(form, "data"), nota: texto(form, "nota") };
  const problema = problemaDoRegistro(d.data, d.nota);
  if (problema) return { mensagem: problema };
  const r = await registrarRecusaNoPainel(getDb(), sessao.organizacaoId, alvo, d, sessao.usuarioId);
  if (!r.ok) return { mensagem: r.erro };
  revalidar();
  return { ok: true, mensagem: "Recusa do painel do Mercado Pago registrada: a devolução por fora fica liberada (no cartão também)." };
}

/**
 * "Parar a devolução pedida" (M8.2c): a devolução ainda pedida de um pagamento que já saiu do prazo de leitura. Com um
 * pedido que o Mercado Pago pode ter aceito, o domínio confere antes que a order não aparece mais e exige a nota.
 */
export async function pararDevolucaoPedidaAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const alvo = alvoDoForm(form);
  if (!alvo) return naoEncontrado(form);
  const gate = await provedorDeConferencia();
  const r = await pararDevolucaoPedida(getDb(), sessao.organizacaoId, alvo, { nota: texto(form, "nota") }, sessao.usuarioId, gate.ok ? gate.provedor : null);
  if (!r.ok) return { mensagem: r.erro };
  revalidar();
  return { ok: true, mensagem: "Devolução pedida parada: a devolução por fora fica liberada." };
}

/**
 * "Corrigir taxa que não voltou" (M8.2c): a despesa atual é estornada (com o motivo) e a nova é lançada; o mesmo teto da
 * taxa. Valor em reais, zero se voltou toda.
 */
export async function corrigirTaxaPerdidaAcao(_e: EstadoAcaoPagamento, form: FormData): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const alvo = alvoDoForm(form);
  if (!alvo) return naoEncontrado(form);
  const valor = reaisParaCentavos(texto(form, "valor"));
  if (typeof valor !== "number" || valor < 0) return { mensagem: "Informe a taxa que não voltou em reais (ex.: 18,06; zero se voltou toda)." };
  const motivo = texto(form, "motivo");
  if (!motivo) return { mensagem: "Informe o motivo da correção." };
  const r = await corrigirTaxaPerdida(getDb(), sessao.organizacaoId, alvo, valor, motivo, sessao.usuarioId);
  if (!r.ok) return { mensagem: r.erro };
  revalidar();
  return { ok: true, mensagem: valor > 0 ? "Taxa corrigida: a despesa anterior foi estornada e a nova entrou no financeiro da empresa." : "Taxa corrigida para zero: a despesa anterior foi estornada." };
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
  // M8.2e: um formulário sem os campos da disputa (aba antiga aberta) mantém os valores salvos deles.
  const v = validarConfigPagamentoSite(valores, await lerConfigPagamentoSite(getDb(), sessao.organizacaoId));
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
      ? "Salvo. Vale para os pagamentos novos; os já criados seguem como estavam."
      : "Salvo. O site deixa de oferecer o pagamento nos pedidos novos; o que já foi pago continua sendo conferido e pode ser devolvido.",
  };
}

/**
 * "Religar o cartão" (M8.2b): fecha o disjuntor de recusas aberto (auditado, com confirmação na tela). Nada do formulário
 * é lido. As recusas de antes não desligam de novo; as próximas contam do zero.
 */
export async function religarCartaoAcao(): Promise<EstadoAcaoPagamento> {
  const sessao = await sessaoFinanceira();
  const r = await religarCartao(getDb(), sessao.organizacaoId, sessao.usuarioId, new Date());
  if (!r.ok) return { mensagem: r.erro };
  revalidar();
  revalidatePath("/reservar/[codigo]", "page");
  return { ok: true, mensagem: "Cartão religado: o site volta a oferecer o cartão de crédito nos pedidos novos." };
}
