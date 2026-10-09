/**
 * Pagamento no site (M8.2a) — quem decide se pode cobrar e quando o site oferece o Pix.
 *
 * `podeCobrar` é a função única das travas (design "Variáveis e travas"): fora do deploy de produção, ambiente
 * `teste`, as duas chaves presentes, conta conferida como de TESTE no provedor e a chave "Oferecer pagamento no
 * site" ligada no painel. Cancelar e devolver passam por `provedorDeConferencia` (as mesmas travas, menos a do
 * painel: desligar a oferta nunca impede de conferir, cancelar ou devolver o que já foi cobrado).
 *
 * `ofertaDePix`: além das travas, a cotação segurada com o pedido ainda em `pedido`, situação disponível (a
 * confirmar segue pela conversa) e o mesmo cálculo do motor, em seco, na data de entrada, sem pendência.
 */
import { and, asc, eq } from "drizzle-orm";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { cotacoes, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { dadosDoMotor } from "@/financeiro/aplicar";
import { type PendenciaDoCalculo, pendenciaDoCalculo } from "@/financeiro/motor";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { esperarNoMaximo } from "@/lib/prazo";
import { temRecebimentoManual } from "./andamento";
import { ambienteMercadoPago, contaDeTesteConfirmada, estadoPagamentoDoAmbiente, provedorDoAmbiente } from "./ambiente";
import type { ProvedorPagamento } from "./provedor";

export type MotivoSemCobranca = "desligado" | "configuracao_invalida" | "so_nas_previas" | "producao_travada" | "desligado_no_painel" | "conta_nao_teste" | "conta_nao_conferida";

export const TEXTO_SEM_COBRANCA: Record<MotivoSemCobranca, string> = {
  desligado: "Pagamento no site desligado: faltam as chaves do Mercado Pago na Vercel.",
  configuracao_invalida: "Configuração inválida: MERCADOPAGO_AMBIENTE só aceita teste ou producao.",
  so_nas_previas: "O teste do pagamento roda nas prévias da Vercel, não no deploy de produção.",
  producao_travada: "Ambiente de produção do Mercado Pago: travado nesta fase (só teste).",
  desligado_no_painel: "Oferecer pagamento no site está desligado em Configurações → Pagamento no site.",
  conta_nao_teste: "A conta das chaves do Mercado Pago não é de teste: nenhuma cobrança é feita.",
  conta_nao_conferida: "Não deu para conferir no Mercado Pago se a conta das chaves é de teste: nenhuma cobrança é feita.",
};

export type PortaoCobranca = { ok: true; provedor: ProvedorPagamento; ambiente: "teste" } | { ok: false; motivo: MotivoSemCobranca; texto: string };

const recusa = (motivo: MotivoSemCobranca): PortaoCobranca => ({ ok: false, motivo, texto: TEXTO_SEM_COBRANCA[motivo] });

/** Ambiente e chaves (a primeira metade das travas). Provedor injetado (testes) pula o ambiente, nunca a conta. */
function provedorPeloAmbiente(env: NodeJS.ProcessEnv, injetado: ProvedorPagamento | undefined): { provedor: ProvedorPagamento } | { motivo: MotivoSemCobranca } {
  if (injetado) return { provedor: injetado };
  const estado = estadoPagamentoDoAmbiente(env);
  if (estado.situacao === "desligado") return { motivo: ambienteMercadoPago(env.MERCADOPAGO_AMBIENTE) === null ? "configuracao_invalida" : "desligado" };
  if (estado.situacao === "so_nas_previas") return { motivo: "so_nas_previas" };
  if (estado.situacao === "producao_travada") return { motivo: "producao_travada" };
  const provedor = provedorDoAmbiente(env);
  return provedor ? { provedor } : { motivo: "desligado" };
}

/**
 * A conta das chaves é de teste? `esperaMs` (telas do site): espera a conferência no máximo esse tanto; passou disso,
 * "não conferida" (não cobra) e a conferência continua no fundo, lembrada para a próxima vez. Sem ele (aviso, rotina,
 * ações do painel), espera a resposta do provedor.
 */
async function contaConfere(provedor: ProvedorPagamento, agora: Date, esperaMs?: number): Promise<MotivoSemCobranca | null> {
  const conferencia = contaDeTesteConfirmada(provedor, () => agora);
  const conta = esperaMs === undefined ? await conferencia : await esperarNoMaximo(conferencia, esperaMs, null);
  return conta === true ? null : conta === false ? "conta_nao_teste" : "conta_nao_conferida";
}

/**
 * Provedor para conferir, cancelar e devolver: ambiente de teste fora da produção, chaves e conta de TESTE
 * comprovada. Não olha a chave do painel.
 */
export async function provedorDeConferencia(env: NodeJS.ProcessEnv = process.env, agora: Date = new Date(), o: { provedor?: ProvedorPagamento; esperaMs?: number } = {}): Promise<PortaoCobranca> {
  const p = provedorPeloAmbiente(env, o.provedor);
  if ("motivo" in p) return recusa(p.motivo);
  const conta = await contaConfere(p.provedor, agora, o.esperaMs);
  return conta ? recusa(conta) : { ok: true, provedor: p.provedor, ambiente: "teste" };
}

/** A função única que libera cobrar (criar Pix). Todas as travas, inclusive a chave do painel. */
export async function podeCobrar(
  db: Db,
  organizacaoId: string,
  env: NodeJS.ProcessEnv = process.env,
  agora: Date = new Date(),
  o: { provedor?: ProvedorPagamento; esperaMs?: number } = {},
): Promise<PortaoCobranca> {
  const p = provedorPeloAmbiente(env, o.provedor);
  if ("motivo" in p) return recusa(p.motivo);
  // A chave do painel antes da conferência da conta: com a oferta desligada, nem se pergunta ao provedor.
  if (!(await lerConfigPagamentoSite(db, organizacaoId)).oferecer) return recusa("desligado_no_painel");
  const conta = await contaConfere(p.provedor, agora, o.esperaMs);
  return conta ? recusa(conta) : { ok: true, provedor: p.provedor, ambiente: "teste" };
}

export type MotivoSemPix =
  | MotivoSemCobranca
  | PendenciaDoCalculo
  | "cotacao_nao_encontrada"
  | "nao_segurada"
  | "prazo_vencido"
  | "a_confirmar"
  | "imovel_fora_do_site"
  | "recebimento_manual";

export const TEXTO_SEM_PIX: Record<MotivoSemPix, string> = {
  ...TEXTO_SEM_COBRANCA,
  sem_valor: "Sem valor da estadia: segue pela conversa.",
  sem_contrato: "Sem contrato de gestão vigente na data de entrada: segue pela conversa.",
  marketplace: "Imóvel do marketplace: o pagamento no site chega com o M12.2; segue pela conversa.",
  sem_proprietario: "Imóvel sem proprietário cadastrado: segue pela conversa.",
  varios_proprietarios: "Imóvel com mais de um proprietário: segue pela conversa até definir a cota de cada um.",
  recebimento_nao_empresa: "Quem recebe as reservas do site neste imóvel não é a empresa (Configurações → Regras financeiras ou o imóvel): segue pela conversa.",
  calculo_pendente: "O financeiro desta reserva ficaria com acerto pendente: segue pela conversa.",
  cotacao_nao_encontrada: "Cotação não encontrada.",
  nao_segurada: "As datas desta cotação não estão seguradas.",
  prazo_vencido: "O prazo das datas desta cotação acabou.",
  a_confirmar: "Disponibilidade ou valor ainda a confirmar pela equipe: segue pela conversa.",
  imovel_fora_do_site: "Imóvel fora do site público.",
  recebimento_manual: "Esta reserva já tem recebimento registrado à mão: segue pela conversa.",
};

/** O cálculo do motor em seco, na data de entrada, para o valor da cotação. null = sem pendência. */
export async function pendenciaDoMotor(db: Db, organizacaoId: string, imovelId: string, checkin: string, checkout: string, valor: number | null): Promise<PendenciaDoCalculo | null> {
  const d = await dadosDoMotor(db, organizacaoId, imovelId, checkin);
  return pendenciaDoCalculo(
    { id: "00000000-0000-0000-0000-000000000000", codigo: "", imovelId, origem: "site", estado: "confirmada", checkin, checkout, valorBruto: valor, taxaCanal: null, recebimento: null },
    d.contratos,
    d.donos,
    d.regras,
    d.recebimentoDoImovel,
  );
}

type CotacaoParaOferta = Pick<typeof cotacoes.$inferSelect, "estado" | "situacao" | "holdAte" | "imovelId" | "checkin" | "checkout" | "total" | "reservaId">;

/**
 * As condições da cotação e do motor (sem as travas do ambiente). Lida também dentro da transação que cria o
 * Pix, com a cotação e o pedido já travados.
 */
export async function motivoSemPixDaCotacao(db: Db, organizacaoId: string, c: CotacaoParaOferta, estadoReserva: string | null, agora: Date): Promise<MotivoSemPix | null> {
  if (c.estado !== "segurada" || !c.reservaId || estadoReserva !== "pedido") return "nao_segurada";
  if (!c.holdAte || c.holdAte.getTime() <= agora.getTime()) return "prazo_vencido";
  if (c.situacao !== "disponivel") return "a_confirmar";
  // Recebimento à mão já registrado na reserva: nenhum Pix (a fase 1 confere isso sob a trava da reserva).
  if (await temRecebimentoManual(db, organizacaoId, c.reservaId)) return "recebimento_manual";
  const [im] = await db.select({ publico: imoveis.publico, ativo: imoveis.ativo }).from(imoveis).where(and(eq(imoveis.id, c.imovelId), eq(imoveis.organizacaoId, organizacaoId)));
  if (!im?.publico || !im.ativo) return "imovel_fora_do_site";
  return pendenciaDoMotor(db, organizacaoId, c.imovelId, c.checkin, c.checkout, c.total);
}

/** O site oferece o Pix nesta cotação agora? `gate` = resultado de `podeCobrar`. */
export async function ofertaDePix(db: Db, organizacaoId: string, cotacaoId: string, agora: Date, gate: PortaoCobranca): Promise<{ oferecer: true } | { oferecer: false; motivo: MotivoSemPix }> {
  if (!gate.ok) return { oferecer: false, motivo: gate.motivo };
  if (!uuidValido(cotacaoId)) return { oferecer: false, motivo: "cotacao_nao_encontrada" };
  const [c] = await db
    .select({ cotacao: cotacoes, estadoReserva: reservas.estado })
    .from(cotacoes)
    .leftJoin(reservas, eq(reservas.id, cotacoes.reservaId))
    .where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  if (!c) return { oferecer: false, motivo: "cotacao_nao_encontrada" };
  const motivo = await motivoSemPixDaCotacao(db, organizacaoId, c.cotacao, c.estadoReserva, agora);
  return motivo ? { oferecer: false, motivo } : { oferecer: true };
}

export type OfertaDoImovel = { imovelId: string; codigo: string; nome: string; oferece: boolean; motivo: MotivoSemPix | null; texto: string | null };

/**
 * Para a aba do painel: cada imóvel do site público com ✓ ou o motivo de não oferecer o Pix. O motor é calculado
 * em seco para uma entrada hoje (as reservas reais são conferidas na data de entrada de cada uma).
 */
export async function motivosPorImovel(db: Db, organizacaoId: string, agora: Date = new Date()): Promise<OfertaDoImovel[]> {
  const lista = await db
    .select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome, fuso: imoveis.fuso })
    .from(imoveis)
    .where(and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.publico, true), eq(imoveis.ativo, true)))
    .orderBy(asc(imoveis.codigo));
  const r: OfertaDoImovel[] = [];
  for (const im of lista) {
    const hoje = hojeISO(im.fuso, agora);
    const amanha = new Date(Date.parse(`${hoje}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    // Valor simbólico: o que importa aqui é se o cálculo fecha, não quanto dá.
    const motivo = await pendenciaDoMotor(db, organizacaoId, im.id, hoje, amanha, 100_00);
    r.push({ imovelId: im.id, codigo: im.codigo, nome: im.nome, oferece: !motivo, motivo, texto: motivo ? TEXTO_SEM_PIX[motivo] : null });
  }
  return r;
}
