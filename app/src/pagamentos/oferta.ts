/**
 * Pagamento no site (M8.2a) — quem decide se pode cobrar e quando o site oferece o pagamento (Pix e, no M8.2b, cartão).
 *
 * `podeCobrar` é a função única das travas (design "Variáveis e travas"): fora do deploy de produção, ambiente
 * `teste`, as duas chaves presentes, conta conferida como de TESTE no provedor, a chave "Oferecer pagamento no
 * site" ligada no painel e as três páginas legais do site publicadas (M7.4). Cancelar e devolver passam por
 * `provedorDeConferencia` (as mesmas travas, menos a do painel e a das páginas legais: desligar a oferta nunca
 * impede de conferir, cancelar ou devolver o que já foi cobrado).
 *
 * `ofertaDePix`: além das travas, a cotação segurada com o pedido ainda em `pedido`, situação disponível (a
 * confirmar segue pela conversa) e o mesmo cálculo do motor, em seco, na data de entrada, sem pendência.
 *
 * `ofertaDeCartao` (M8.2b): tudo o que vale para o Pix, mais o cartão ligado no painel, o disjuntor de recusas fechado e
 * a chave pública do formulário. O cartão e o disjuntor nunca entram em `podeCobrar`: o Pix continua de qualquer jeito.
 *
 * A diferença de uma alteração da reserva paga (M8.2d, `alteracaoId`): a alteração com as datas seguradas e o prazo
 * valendo, diferença a pagar, a reserva confirmada e sem cancelamento ativo, a cotação das datas novas disponível (ou um
 * valor da equipe: as noites já passaram pela leitura atual ao segurar), o imóvel no site, o motor em seco nas datas novas
 * sem pendência e nenhum recebimento à mão na reserva.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { versoesLegaisAtuais } from "@/configuracoes/paginas-legais";
import { alteracoesReserva, cancelamentosReserva, cotacoes, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { dadosDoMotor } from "@/financeiro/aplicar";
import { type PendenciaDoCalculo, pendenciaDoCalculo } from "@/financeiro/motor";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { esperarNoMaximo } from "@/lib/prazo";
import { valorNovo } from "./alteracao-regras";
import { temRecebimentoManual } from "./andamento";
import { ambienteMercadoPago, contaDeTesteConfirmada, estadoPagamentoDoAmbiente, provedorDoAmbiente } from "./ambiente";
import { disjuntorAberto } from "./disjuntor";
import type { ProvedorPagamento } from "./provedor";

export type MotivoSemCobranca = "desligado" | "configuracao_invalida" | "so_nas_previas" | "producao_travada" | "desligado_no_painel" | "sem_paginas_legais" | "conta_nao_teste" | "conta_nao_conferida";

export const TEXTO_SEM_COBRANCA: Record<MotivoSemCobranca, string> = {
  desligado: "Pagamento no site desligado: faltam as chaves do Mercado Pago na Vercel.",
  configuracao_invalida: "Configuração inválida: MERCADOPAGO_AMBIENTE só aceita teste ou producao.",
  so_nas_previas: "O teste do pagamento roda nas prévias da Vercel, não no deploy de produção.",
  producao_travada: "Ambiente de produção do Mercado Pago: travado nesta fase (só teste).",
  desligado_no_painel: "Oferecer pagamento no site está desligado em Configurações → Pagamento no site.",
  sem_paginas_legais:
    "Faltam publicar as páginas legais do site em Configurações → Páginas legais do site: o pagamento só é oferecido com os termos de uso, a política de privacidade e a política de cancelamento publicados.",
  conta_nao_teste: "A conta das chaves do Mercado Pago não é de teste: nenhuma cobrança é feita.",
  conta_nao_conferida: "Não deu para conferir no Mercado Pago se a conta das chaves é de teste: nenhuma cobrança é feita.",
};

/**
 * `chavePublica` (M8.2b): a chave pública do Mercado Pago que o formulário do cartão usa no navegador; null quando
 * falta ou tem formato estranho (o cartão não é oferecido; o Pix não depende dela).
 */
export type PortaoCobranca = { ok: true; provedor: ProvedorPagamento; ambiente: "teste"; chavePublica: string | null } | { ok: false; motivo: MotivoSemCobranca; texto: string };

const recusa = (motivo: MotivoSemCobranca): PortaoCobranca => ({ ok: false, motivo, texto: TEXTO_SEM_COBRANCA[motivo] });

/** Chave pública com cara de chave (TEST-…/APP_USR-…): só letras, números, hífen e sublinhado. */
export const chavePublicaValida = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(v);

type OpcoesDoPortao = { provedor?: ProvedorPagamento; esperaMs?: number; chavePublica?: string | null };

/**
 * Ambiente e chaves (a primeira metade das travas). Provedor injetado (testes) pula o ambiente, nunca a conta; a chave
 * pública vem então de `o.chavePublica`.
 */
function provedorPeloAmbiente(env: NodeJS.ProcessEnv, o: OpcoesDoPortao): { provedor: ProvedorPagamento; chavePublica: string | null } | { motivo: MotivoSemCobranca } {
  if (o.provedor) return { provedor: o.provedor, chavePublica: chavePublicaValida(o.chavePublica) ? o.chavePublica : null };
  const estado = estadoPagamentoDoAmbiente(env);
  if (estado.situacao === "desligado") return { motivo: ambienteMercadoPago(env.MERCADOPAGO_AMBIENTE) === null ? "configuracao_invalida" : "desligado" };
  if (estado.situacao === "so_nas_previas") return { motivo: "so_nas_previas" };
  if (estado.situacao === "producao_travada") return { motivo: "producao_travada" };
  const provedor = provedorDoAmbiente(env);
  return provedor ? { provedor, chavePublica: chavePublicaValida(estado.chavePublica) ? estado.chavePublica : null } : { motivo: "desligado" };
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
export async function provedorDeConferencia(env: NodeJS.ProcessEnv = process.env, agora: Date = new Date(), o: OpcoesDoPortao = {}): Promise<PortaoCobranca> {
  const p = provedorPeloAmbiente(env, o);
  if ("motivo" in p) return recusa(p.motivo);
  const conta = await contaConfere(p.provedor, agora, o.esperaMs);
  return conta ? recusa(conta) : { ok: true, provedor: p.provedor, ambiente: "teste", chavePublica: p.chavePublica };
}

/**
 * A função única que libera cobrar (criar Pix ou cartão). Todas as travas, inclusive a chave do painel e as páginas
 * legais. O cartão desligado e o disjuntor não entram aqui (ver `ofertaDeCartao`): o Pix nunca para por eles.
 */
export async function podeCobrar(
  db: Db,
  organizacaoId: string,
  env: NodeJS.ProcessEnv = process.env,
  agora: Date = new Date(),
  o: OpcoesDoPortao = {},
): Promise<PortaoCobranca> {
  const p = provedorPeloAmbiente(env, o);
  if ("motivo" in p) return recusa(p.motivo);
  // A chave do painel antes da conferência da conta: com a oferta desligada, nem se pergunta ao provedor.
  if (!(await lerConfigPagamentoSite(db, organizacaoId)).oferecer) return recusa("desligado_no_painel");
  // Sem os termos, a privacidade e o cancelamento publicados, o hóspede não tem o que aceitar antes de pagar (M7.4).
  if (!(await versoesLegaisAtuais(db, organizacaoId))) return recusa("sem_paginas_legais");
  const conta = await contaConfere(p.provedor, agora, o.esperaMs);
  return conta ? recusa(conta) : { ok: true, provedor: p.provedor, ambiente: "teste", chavePublica: p.chavePublica };
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

type AlteracaoParaOferta = Pick<typeof alteracoesReserva.$inferSelect, "situacao" | "holdAte" | "diferenca" | "cotacao" | "origemValor" | "checkinDepois" | "checkoutDepois" | "valorAntes" | "valorDepois" | "direito">;
type ReservaParaOferta = { id: string; imovelId: string; estado: string; cancelamentoAtivo: boolean };

/**
 * As condições da diferença de uma alteração (M8.2d), sem as travas do ambiente. Lida também dentro da fase 1 do Pix e do
 * cartão, sob as travas (a reserva, o cancelamento e a alteração já travados).
 */
export async function motivoSemPixDaAlteracao(db: Db, organizacaoId: string, a: AlteracaoParaOferta, r: ReservaParaOferta, agora: Date): Promise<MotivoSemPix | null> {
  if (a.situacao !== "segurada" || a.diferenca <= 0 || r.estado !== "confirmada" || r.cancelamentoAtivo) return "nao_segurada";
  if (!a.holdAte || a.holdAte.getTime() <= agora.getTime()) return "prazo_vencido";
  if (a.origemValor === "cotacao" && a.cotacao.situacao !== "disponivel") return "a_confirmar";
  if (await temRecebimentoManual(db, organizacaoId, r.id)) return "recebimento_manual";
  const [im] = await db.select({ publico: imoveis.publico, ativo: imoveis.ativo }).from(imoveis).where(and(eq(imoveis.id, r.imovelId), eq(imoveis.organizacaoId, organizacaoId)));
  if (!im?.publico || !im.ativo) return "imovel_fora_do_site";
  return pendenciaDoMotor(db, organizacaoId, r.imovelId, a.checkinDepois, a.checkoutDepois, valorNovo(a));
}

/** A alteração (desta organização e desta cotação) e a reserva dela, para a oferta da diferença; null = não existe. */
async function alteracaoParaOferta(db: Db, organizacaoId: string, cotacaoId: string, alteracaoId: string): Promise<{ a: AlteracaoParaOferta; r: ReservaParaOferta } | null> {
  if (!uuidValido(alteracaoId)) return null;
  const [l] = await db
    .select({ a: alteracoesReserva, r: { id: reservas.id, imovelId: reservas.imovelId, estado: reservas.estado } })
    .from(alteracoesReserva)
    .innerJoin(reservas, eq(reservas.id, alteracoesReserva.reservaId))
    .where(and(eq(alteracoesReserva.id, alteracaoId), eq(alteracoesReserva.organizacaoId, organizacaoId), eq(alteracoesReserva.cotacaoId, cotacaoId)));
  if (!l) return null;
  const [canc] = await db
    .select({ id: cancelamentosReserva.id })
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.reservaId, l.r.id), eq(cancelamentosReserva.organizacaoId, organizacaoId), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])));
  return { a: l.a, r: { ...l.r, cancelamentoAtivo: !!canc } };
}

/** O site oferece o Pix nesta cotação agora? `gate` = resultado de `podeCobrar`. `o.alteracaoId` (M8.2d): a diferença dessa alteração. */
export async function ofertaDePix(db: Db, organizacaoId: string, cotacaoId: string, agora: Date, gate: PortaoCobranca, o: { alteracaoId?: string | null } = {}): Promise<{ oferecer: true } | { oferecer: false; motivo: MotivoSemPix }> {
  if (!gate.ok) return { oferecer: false, motivo: gate.motivo };
  if (!uuidValido(cotacaoId)) return { oferecer: false, motivo: "cotacao_nao_encontrada" };
  if (o.alteracaoId) {
    const x = await alteracaoParaOferta(db, organizacaoId, cotacaoId, o.alteracaoId);
    if (!x) return { oferecer: false, motivo: "cotacao_nao_encontrada" };
    const motivo = await motivoSemPixDaAlteracao(db, organizacaoId, x.a, x.r, agora);
    return motivo ? { oferecer: false, motivo } : { oferecer: true };
  }
  const [c] = await db
    .select({ cotacao: cotacoes, estadoReserva: reservas.estado })
    .from(cotacoes)
    .leftJoin(reservas, eq(reservas.id, cotacoes.reservaId))
    .where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  if (!c) return { oferecer: false, motivo: "cotacao_nao_encontrada" };
  const motivo = await motivoSemPixDaCotacao(db, organizacaoId, c.cotacao, c.estadoReserva, agora);
  return motivo ? { oferecer: false, motivo } : { oferecer: true };
}

export type MotivoSemCartao = MotivoSemPix | "cartao_desligado" | "disjuntor" | "sem_chave_publica";

/** Textos do painel (nunca do hóspede). */
export const TEXTO_SEM_CARTAO: Record<MotivoSemCartao, string> = {
  ...TEXTO_SEM_PIX,
  cartao_desligado: "Cartão desligado em Configurações → Pagamento no site.",
  disjuntor: "Cartão desligado pelo disjuntor de recusas (possível teste de cartões roubados): o Pix continua.",
  sem_chave_publica: "Falta a chave pública do Mercado Pago (MERCADOPAGO_PUBLIC_KEY).",
};

/** Motivos do cartão que não são do Pix (a cotação poderia pagar por Pix). */
export const motivoSoDoCartao = (m: MotivoSemCartao): m is "cartao_desligado" | "disjuntor" | "sem_chave_publica" => m === "cartao_desligado" || m === "disjuntor" || m === "sem_chave_publica";

/**
 * As condições da cotação para o cartão: as do Pix, o cartão ligado no painel (só vale com "Oferecer pagamento no site",
 * conferido no portão) e o disjuntor fechado. Lida também dentro da fase 1 do cartão, sob as travas.
 */
export async function motivoSemCartaoDaCotacao(db: Db, organizacaoId: string, c: CotacaoParaOferta, estadoReserva: string | null, agora: Date): Promise<MotivoSemCartao | null> {
  if (!(await lerConfigPagamentoSite(db, organizacaoId)).cartao) return "cartao_desligado";
  const motivo = await motivoSemPixDaCotacao(db, organizacaoId, c, estadoReserva, agora);
  if (motivo) return motivo;
  return (await disjuntorAberto(db, organizacaoId, agora)) ? "disjuntor" : null;
}

/** O gêmeo de `motivoSemCartaoDaCotacao` para a diferença de uma alteração (M8.2d). */
export async function motivoSemCartaoDaAlteracao(db: Db, organizacaoId: string, a: AlteracaoParaOferta, r: ReservaParaOferta, agora: Date): Promise<MotivoSemCartao | null> {
  if (!(await lerConfigPagamentoSite(db, organizacaoId)).cartao) return "cartao_desligado";
  const motivo = await motivoSemPixDaAlteracao(db, organizacaoId, a, r, agora);
  if (motivo) return motivo;
  return (await disjuntorAberto(db, organizacaoId, agora)) ? "disjuntor" : null;
}

/**
 * O site oferece o cartão nesta cotação agora? `gate` = resultado de `podeCobrar` (traz a chave pública). Devolve o que o
 * formulário precisa: a chave pública e o número máximo de parcelas do painel (null = o máximo do Mercado Pago).
 */
export async function ofertaDeCartao(
  db: Db,
  organizacaoId: string,
  cotacaoId: string,
  agora: Date,
  gate: PortaoCobranca,
  o: { alteracaoId?: string | null } = {},
): Promise<{ oferecer: true; chavePublica: string; parcelasMaximas: number | null } | { oferecer: false; motivo: MotivoSemCartao }> {
  if (!gate.ok) return { oferecer: false, motivo: gate.motivo };
  if (!chavePublicaValida(gate.chavePublica)) return { oferecer: false, motivo: "sem_chave_publica" };
  if (!uuidValido(cotacaoId)) return { oferecer: false, motivo: "cotacao_nao_encontrada" };
  if (o.alteracaoId) {
    const x = await alteracaoParaOferta(db, organizacaoId, cotacaoId, o.alteracaoId);
    if (!x) return { oferecer: false, motivo: "cotacao_nao_encontrada" };
    const motivo = await motivoSemCartaoDaAlteracao(db, organizacaoId, x.a, x.r, agora);
    if (motivo) return { oferecer: false, motivo };
    return { oferecer: true, chavePublica: gate.chavePublica, parcelasMaximas: (await lerConfigPagamentoSite(db, organizacaoId)).parcelasMaximas };
  }
  const [c] = await db
    .select({ cotacao: cotacoes, estadoReserva: reservas.estado })
    .from(cotacoes)
    .leftJoin(reservas, eq(reservas.id, cotacoes.reservaId))
    .where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  if (!c) return { oferecer: false, motivo: "cotacao_nao_encontrada" };
  const motivo = await motivoSemCartaoDaCotacao(db, organizacaoId, c.cotacao, c.estadoReserva, agora);
  if (motivo) return { oferecer: false, motivo };
  return { oferecer: true, chavePublica: gate.chavePublica, parcelasMaximas: (await lerConfigPagamentoSite(db, organizacaoId)).parcelasMaximas };
}

export type OfertaDoImovel = { imovelId: string; codigo: string; nome: string; oferece: boolean; motivo: MotivoSemPix | null; texto: string | null };

/**
 * Para a aba do painel: cada imóvel do site público com ✓ ou o motivo de não oferecer o pagamento. O motor é calculado
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
