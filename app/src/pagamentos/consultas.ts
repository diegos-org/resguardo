/**
 * Pagamento no site (M8.2a) — consultas para o site e o painel. Nenhuma devolve dado pessoal (não há nenhum
 * guardado aqui); o QR do Pix só sai com a autorização do pedido (cookie).
 *
 * Na página do hóspede, um pagamento aprovado ou pendente sempre vence "expirada" e "cancelada"; enquanto houver
 * dinheiro sem desfecho, a página nunca convida a fazer uma nova consulta.
 */
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import { escritaBeds24Pronta } from "@/beds24/http";
import { cotacoes, devolucoesPagamento, eventosPagamento, imoveis, lancamentos, pagamentos, reservas, type SituacaoDevolucao } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { MAXIMO_PIX_POR_COTACAO } from "./andamento";
import { ambienteMercadoPago, estadoPagamentoDoAmbiente } from "./ambiente";
import { AVISOS_PAGAMENTO, type CodigoAviso, comDinheiro, emAndamento, type SituacaoPagamento, textoMotivoSemReserva, textosDosAvisos } from "./situacoes";
import type { Devolucao, Pagamento } from "./travas";

export { pagamentoEmAndamentoOuAprovado } from "./andamento";

export type EstadoPagamentoHospede =
  | "sem_pagamento"
  | "pagar"
  | "pix_aguardando"
  | "pix_vencido"
  | "pix_esgotado"
  | "verificando"
  | "confirmando"
  | "confirmada"
  | "aprovado_sem_datas"
  | "devolucao_pedida"
  | "devolvido";

export type VistaPagamentoHospede = {
  estado: EstadoPagamentoHospede;
  /** "Ambiente de teste: nenhuma cobrança real" (na parte a, todo pagamento é de teste). */
  ambienteTeste: boolean;
  /** Há pagamento em andamento ou dinheiro sem desfecho: nunca oferecer "faça uma nova consulta". */
  dinheiroSemDesfecho: boolean;
  /** Prazo das datas, quando seguradas. */
  holdAte: Date | null;
  /** Copia e cola, QR e link do Pix aguardando — só com a autorização do pedido. */
  pix: { copiaECola: string; imagemBase64: string | null; link: string | null; expiraEm: Date | null } | null;
  /** Quantos Pix ainda podem ser gerados nesta cotação. */
  pixRestantes: number;
  /** Código SCL da reserva confirmada pelo pagamento. */
  reservaCodigo: string | null;
  /** Reserva confirmada e outro pagamento da mesma cotação será devolvido (pagamento em dobro). */
  pagamentoEmDobro: boolean;
  devolucao: { situacao: "pedida" | "feita"; em: Date | null } | null;
};

/**
 * O que a página da cotação mostra sobre o pagamento (design "O que o hóspede vê"). `oferecido` = resultado de
 * `ofertaDePix` (sem ele, cotação segurada sem tentativa fica "sem_pagamento", o fluxo pela conversa).
 */
export async function vistaDaCotacaoParaHospede(db: Db, organizacaoId: string, cotacaoId: string, agora: Date, o: { comAutorizacao: boolean; oferecido?: boolean }): Promise<VistaPagamentoHospede | null> {
  if (!uuidValido(cotacaoId)) return null;
  const [c] = await db
    .select({ estado: cotacoes.estado, holdAte: cotacoes.holdAte, reservaEstado: reservas.estado, reservaCodigo: reservas.codigo })
    .from(cotacoes)
    .leftJoin(reservas, eq(reservas.id, cotacoes.reservaId))
    .where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  if (!c) return null;
  const tentativas = await db.select().from(pagamentos).where(and(eq(pagamentos.cotacaoId, cotacaoId), eq(pagamentos.organizacaoId, organizacaoId))).orderBy(desc(pagamentos.criadoEm), desc(pagamentos.id));
  const devolucoes = tentativas.length ? await db.select().from(devolucoesPagamento).where(inArray(devolucoesPagamento.pagamentoId, tentativas.map((t) => t.id))) : [];
  const devDe = (p: Pagamento) => devolucoes.find((d) => d.pagamentoId === p.id);
  const segurada = c.estado === "segurada" && c.reservaEstado === "pedido" && !!c.holdAte && c.holdAte.getTime() > agora.getTime();
  const pixRestantes = Math.max(0, MAXIMO_PIX_POR_COTACAO - tentativas.filter((t) => t.forma === "pix").length);
  const dinheiroSemDesfecho = tentativas.some((t) => emAndamento(t.situacao) || (comDinheiro(t.situacao) && t.desfecho === null));
  const base: VistaPagamentoHospede = {
    estado: "sem_pagamento",
    ambienteTeste: tentativas.some((t) => t.ambiente === "teste") || tentativas.length === 0,
    dinheiroSemDesfecho,
    holdAte: segurada ? c.holdAte : null,
    pix: null,
    pixRestantes,
    reservaCodigo: null,
    pagamentoEmDobro: false,
    devolucao: null,
  };
  const comReserva = tentativas.find((t) => t.desfecho === "reserva");
  if (comReserva) {
    return { ...base, estado: "confirmada", reservaCodigo: c.reservaCodigo, pagamentoEmDobro: tentativas.some((t) => t.id !== comReserva.id && comDinheiro(t.situacao)) };
  }
  // Dinheiro sem a reserva: confirmando, aprovado sem as datas, devolução pedida ou feita.
  const comDinheiroSemReserva = tentativas.find((t) => comDinheiro(t.situacao));
  if (comDinheiroSemReserva) {
    const p = comDinheiroSemReserva;
    const dev = devDe(p);
    if (p.desfecho === "devolucao" || p.desfecho === "por_fora" || dev?.situacao === "confirmada" || dev?.situacao === "por_fora" || p.situacao === "devolvido") {
      return { ...base, estado: "devolvido", devolucao: { situacao: "feita", em: dev?.confirmadaEm ?? (dev?.porForaData ? new Date(`${dev.porForaData}T12:00:00-03:00`) : p.desfechoEm) } };
    }
    if (dev?.situacao === "pedida" || dev?.situacao === "recusada") return { ...base, estado: "devolucao_pedida", devolucao: { situacao: "pedida", em: dev.criadoEm } };
    if (p.motivoSemReserva) return { ...base, estado: "aprovado_sem_datas" };
    return { ...base, estado: "confirmando" };
  }
  const ultima = tentativas[0];
  if (ultima && (ultima.situacao === "criando" || ultima.situacao === "incerta")) return { ...base, estado: "verificando" };
  if (ultima && ultima.situacao === "pendente") {
    if (ultima.pixExpiraEm && ultima.pixExpiraEm.getTime() > agora.getTime()) {
      const pix = o.comAutorizacao && ultima.pixCopiaECola ? { copiaECola: ultima.pixCopiaECola, imagemBase64: ultima.pixImagem, link: ultima.pixLink, expiraEm: ultima.pixExpiraEm } : null;
      return { ...base, estado: "pix_aguardando", pix };
    }
    // QR vencido pelo relógio e o provedor ainda sem resposta, com o prazo das datas já passado (carência): conferindo.
    if (!segurada) return { ...base, estado: "verificando" };
  }
  if (!segurada) return base;
  if (ultima) return { ...base, estado: pixRestantes > 0 ? "pix_vencido" : "pix_esgotado" };
  return o.oferecido ? { ...base, estado: "pagar" } : base;
}

export type AcoesDoPagamento = { conferir: boolean; devolver: boolean; devolucaoPorFora: boolean; registrarLiberacao: boolean; estornarLiberacao: boolean };

export type PagamentoDoPainel = {
  id: string;
  cotacaoId: string;
  reservaId: string;
  forma: "pix" | "cartao";
  situacao: SituacaoPagamento;
  ambiente: "teste" | "producao";
  aoVivo: boolean | null;
  valor: number;
  valorPago: number | null;
  taxa: number | null;
  liquido: number | null;
  liberacaoPrevistaEm: Date | null;
  liberacaoConfirmadaEm: Date | null;
  liberacaoOrigem: "provedor" | "manual" | null;
  pixExpiraEm: Date | null;
  aprovadoEm: Date | null;
  consultadoEm: Date | null;
  criadoEm: Date;
  desfecho: Pagamento["desfecho"];
  desfechoEm: Date | null;
  motivoSemReserva: string | null;
  motivoSemReservaTexto: string | null;
  avisos: string[];
  devolucao: { situacao: SituacaoDevolucao; valor: number; tentativas: number; falhas: number; confirmadaEm: Date | null; porForaData: string | null; porForaValor: number | null; porForaNota: string; taxaPerdida: number | null } | null;
  /** Pede atenção da equipe (lista "pede atenção" e Início). */
  pedeAtencao: boolean;
  /** O que a ficha pode oferecer (quem chama ainda confere a permissão financeiro:editar). */
  acoes: AcoesDoPagamento;
};

const liberacaoVencida = (p: Pagamento, agora: Date) => p.desfecho === "reserva" && p.situacao === "aprovado" && !p.liberacaoConfirmadaEm && !!p.liberacaoPrevistaEm && p.liberacaoPrevistaEm.getTime() < agora.getTime();

function paraPainel(p: Pagamento, dev: Devolucao | undefined, temRecebimentoManual: boolean, agora: Date): PagamentoDoPainel {
  const semDecisao = p.situacao === "aprovado" && p.desfecho === null;
  const devolucaoAberta = dev?.situacao === "pedida" || dev?.situacao === "recusada";
  const podeDecidir = semDecisao && p.motivoSemReserva !== null && dev?.situacao !== "pedida" && (!dev || dev.situacao === "recusada");
  return {
    id: p.id,
    cotacaoId: p.cotacaoId,
    reservaId: p.reservaId,
    forma: p.forma,
    situacao: p.situacao,
    ambiente: p.ambiente,
    aoVivo: p.aoVivo,
    valor: p.valor,
    valorPago: p.valorPago,
    taxa: p.taxa,
    liquido: p.liquido,
    liberacaoPrevistaEm: p.liberacaoPrevistaEm,
    liberacaoConfirmadaEm: p.liberacaoConfirmadaEm,
    liberacaoOrigem: p.liberacaoOrigem,
    pixExpiraEm: p.pixExpiraEm,
    aprovadoEm: p.aprovadoEm,
    consultadoEm: p.consultadoEm,
    criadoEm: p.criadoEm,
    desfecho: p.desfecho,
    desfechoEm: p.desfechoEm,
    motivoSemReserva: p.motivoSemReserva,
    motivoSemReservaTexto: textoMotivoSemReserva(p.motivoSemReserva),
    avisos: textosDosAvisos(p.avisos),
    devolucao: dev
      ? { situacao: dev.situacao, valor: dev.valor, tentativas: dev.tentativas, falhas: dev.falhas, confirmadaEm: dev.confirmadaEm, porForaData: dev.porForaData, porForaValor: dev.porForaValor, porForaNota: dev.porForaNota, taxaPerdida: dev.taxaPerdida }
      : null,
    pedeAtencao: semDecisao || devolucaoAberta || p.avisos.length > 0 || p.situacao === "incerta" || liberacaoVencida(p, agora),
    acoes: {
      conferir: p.idProvedor !== null || emAndamento(p.situacao) || !!dev,
      devolver: podeDecidir,
      devolucaoPorFora: podeDecidir,
      registrarLiberacao: p.desfecho === "reserva" && p.situacao === "aprovado" && !p.liberacaoConfirmadaEm,
      estornarLiberacao: p.liberacaoOrigem === "manual" && temRecebimentoManual,
    },
  };
}

async function montarPainel(db: Db, organizacaoId: string, lista: Pagamento[], agora: Date): Promise<PagamentoDoPainel[]> {
  if (!lista.length) return [];
  const ids = lista.map((p) => p.id);
  const devs = await db.select().from(devolucoesPagamento).where(and(eq(devolucoesPagamento.organizacaoId, organizacaoId), inArray(devolucoesPagamento.pagamentoId, ids)));
  // Liberação registrada à mão ainda em vigor (estornável pelo quadro do pagamento).
  const manuais = await db
    .select({ chave: lancamentos.chaveOrigem })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.organizacaoId, organizacaoId),
        eq(lancamentos.tipo, "recebimento"),
        eq(lancamentos.estado, "realizado"),
        sql`${lancamentos.chaveOrigem} like 'mercadopago:%:recebimento%'`,
        isNull(lancamentos.estornoDe),
        sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`,
      ),
    );
  const comManual = new Set(manuais.map((m) => m.chave.split(":")[1]));
  return lista.map((p) => paraPainel(p, devs.find((d) => d.pagamentoId === p.id), comManual.has(p.id), agora));
}

/** Pagamentos do site de uma reserva (ficha da reserva), do mais antigo ao mais novo. */
export async function pagamentosDaReserva(db: Db, organizacaoId: string, reservaId: string, agora: Date = new Date()): Promise<PagamentoDoPainel[]> {
  if (!uuidValido(reservaId)) return [];
  const lista = await db.select().from(pagamentos).where(and(eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.reservaId, reservaId))).orderBy(asc(pagamentos.criadoEm), asc(pagamentos.id));
  return montarPainel(db, organizacaoId, lista, agora);
}

export type LinhaPagamento = PagamentoDoPainel & { reservaCodigo: string; reservaEstado: string; imovelCodigo: string; checkin: string; checkout: string; cotacaoCodigo: string };

/**
 * Financeiro → Pagamentos do site: por período (dia de criação, em São Paulo, `de` e `ate` inclusive), com o
 * filtro "pede atenção" (que ignora o período: o que pede atenção aparece sempre).
 */
export async function listarPagamentos(db: Db, organizacaoId: string, f: { de?: string; ate?: string; atencao?: boolean } = {}, agora: Date = new Date()): Promise<LinhaPagamento[]> {
  const dia = sql`(${pagamentos.criadoEm} at time zone 'America/Sao_Paulo')::date`;
  const linhas = await db
    .select({ p: pagamentos, reservaCodigo: reservas.codigo, reservaEstado: reservas.estado, imovelCodigo: imoveis.codigo, checkin: reservas.checkin, checkout: reservas.checkout, cotacaoCodigo: cotacoes.codigo })
    .from(pagamentos)
    .innerJoin(reservas, eq(reservas.id, pagamentos.reservaId))
    .innerJoin(imoveis, eq(imoveis.id, pagamentos.imovelId))
    .innerJoin(cotacoes, eq(cotacoes.id, pagamentos.cotacaoId))
    .where(and(eq(pagamentos.organizacaoId, organizacaoId), !f.atencao && f.de ? gte(dia, f.de) : undefined, !f.atencao && f.ate ? sql`${dia} <= ${f.ate}` : undefined))
    .orderBy(desc(pagamentos.criadoEm), desc(pagamentos.id))
    .limit(500);
  const painel = await montarPainel(db, organizacaoId, linhas.map((l) => l.p), agora);
  const r = painel.map((p, i) => ({ ...p, reservaCodigo: linhas[i].reservaCodigo, reservaEstado: linhas[i].reservaEstado, imovelCodigo: linhas[i].imovelCodigo, checkin: linhas[i].checkin, checkout: linhas[i].checkout, cotacaoCodigo: linhas[i].cotacaoCodigo }));
  return f.atencao ? r.filter((x) => x.pedeAtencao) : r;
}

export type AvisoPagamento = { nivel: "atencao" | "info"; texto: string; link?: string };
export type ContagensPagamento = {
  aprovadoSemDesfecho: number;
  devolucaoPedida: number;
  devolucaoRecusada: number;
  liberacaoVencida: number;
  comAviso: number;
  aoVivo: number;
  semCalculo: number;
  pagasAbertas: number;
};

const LINK_PAGAMENTOS = "/painel/financeiro/pagamentos-site";

/**
 * Avisos do pagamento no site para o Início (da empresa toda, sem depender do filtro de imóveis). `contaDeTeste`
 * vem de quem já conferiu a conta (Integrações); sem ela, esse aviso não aparece.
 */
export async function avisosDePagamento(
  db: Db,
  organizacaoId: string,
  agora: Date = new Date(),
  o: { env?: NodeJS.ProcessEnv; contaDeTeste?: boolean | null } = {},
): Promise<{ alertas: AvisoPagamento[]; contagens: ContagensPagamento }> {
  const env = o.env ?? process.env;
  const lista = await db
    .select()
    .from(pagamentos)
    .where(
      and(
        eq(pagamentos.organizacaoId, organizacaoId),
        or(
          and(inArray(pagamentos.situacao, ["aprovado", "devolvido_parcial", "contestado"]), isNull(pagamentos.desfecho)),
          eq(pagamentos.desfecho, "reserva"),
          sql`jsonb_array_length(${pagamentos.avisos}) > 0`,
          eq(pagamentos.situacao, "incerta"),
        ),
      ),
    );
  const devs = lista.length ? await db.select().from(devolucoesPagamento).where(inArray(devolucoesPagamento.pagamentoId, lista.map((p) => p.id))) : [];
  const devDe = (id: string) => devs.find((d) => d.pagamentoId === id);
  const contagens: ContagensPagamento = { aprovadoSemDesfecho: 0, devolucaoPedida: 0, devolucaoRecusada: 0, liberacaoVencida: 0, comAviso: 0, aoVivo: 0, semCalculo: 0, pagasAbertas: 0 };
  for (const p of lista) {
    const dev = devDe(p.id);
    if (comDinheiro(p.situacao) && p.situacao !== "devolvido" && p.desfecho === null) {
      if (dev?.situacao === "pedida") contagens.devolucaoPedida++;
      else if (dev?.situacao === "recusada") contagens.devolucaoRecusada++;
      else contagens.aprovadoSemDesfecho++;
    }
    if (liberacaoVencida(p, agora)) contagens.liberacaoVencida++;
    if (p.avisos.some((a) => a !== "ao_vivo" && a in AVISOS_PAGAMENTO)) contagens.comAviso++;
    if (p.aoVivo === true || p.avisos.includes("ao_vivo")) contagens.aoVivo++;
  }
  // Avisos com live_mode=true (não assinados: só alarme), da organização ou ainda sem organização.
  const [vivos] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(eventosPagamento)
    .where(and(eq(eventosPagamento.aoVivo, true), or(eq(eventosPagamento.organizacaoId, organizacaoId), isNull(eventosPagamento.organizacaoId)), gte(eventosPagamento.recebidoEm, new Date(agora.getTime() - 30 * 86_400_000))));
  contagens.aoVivo += vivos?.n ?? 0;
  // Reserva paga que um recálculo deixou sem lançamento do motor (contrato encerrado, troca para marketplace).
  const pagas = lista.filter((p) => p.desfecho === "reserva");
  if (pagas.length) {
    const ids = pagas.map((p) => p.reservaId);
    const comMotor = await db
      .selectDistinct({ reservaId: lancamentos.reservaId })
      .from(lancamentos)
      .where(and(eq(lancamentos.organizacaoId, organizacaoId), inArray(lancamentos.reservaId, ids), eq(lancamentos.origem, "motor"), isNull(lancamentos.estornoDe), sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`));
    const com = new Set(comMotor.map((l) => l.reservaId));
    contagens.semCalculo = pagas.filter((p) => !com.has(p.reservaId) && p.situacao === "aprovado").length;
    // Pagas pelo site com a estadia ainda por vir ou em curso: as OTAs não sabem delas enquanto o envio não sai.
    const hoje = hojeISO("America/Sao_Paulo", agora);
    const [abertas] = await db
      .select({ n: sql<number>`count(distinct ${reservas.id})::int` })
      .from(reservas)
      .where(and(inArray(reservas.id, ids), eq(reservas.estado, "confirmada"), sql`${reservas.checkout} > ${hoje}`));
    contagens.pagasAbertas = abertas?.n ?? 0;
  }

  const alertas: AvisoPagamento[] = [];
  const ambiente = estadoPagamentoDoAmbiente(env);
  if (ambiente.situacao === "desligado" && ambienteMercadoPago(env.MERCADOPAGO_AMBIENTE) === null) alertas.push({ nivel: "atencao", texto: "Configuração inválida do Mercado Pago: MERCADOPAGO_AMBIENTE só aceita teste ou producao. O pagamento no site está desligado.", link: "/painel/configuracoes/integracoes" });
  if (o.contaDeTeste === false) alertas.push({ nivel: "atencao", texto: "A conta das chaves do Mercado Pago não é de teste: nenhuma cobrança é feita até trocar as chaves.", link: "/painel/configuracoes/integracoes" });
  if (contagens.aoVivo) alertas.push({ nivel: "atencao", texto: `${contagens.aoVivo} aviso(s) do Mercado Pago marcado(s) como pagamento real (live_mode) no ambiente de teste: confira no painel do Mercado Pago.`, link: LINK_PAGAMENTOS });
  if (contagens.aprovadoSemDesfecho) alertas.push({ nivel: "atencao", texto: `${contagens.aprovadoSemDesfecho} pagamento(s) do site aprovado(s) sem reserva: devolva ao hóspede (pelo Mercado Pago ou por fora).`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.devolucaoPedida) alertas.push({ nivel: "info", texto: `${contagens.devolucaoPedida} devolução(ões) pedida(s) ao Mercado Pago aguardando confirmação.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.devolucaoRecusada) alertas.push({ nivel: "atencao", texto: `${contagens.devolucaoRecusada} devolução(ões) que o Mercado Pago não fez: tente de novo ou registre a devolução feita por fora.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.liberacaoVencida) alertas.push({ nivel: "info", texto: `${contagens.liberacaoVencida} pagamento(s) do site com a liberação prevista vencida e sem confirmação do Mercado Pago: confira e, se o dinheiro caiu, registre a liberação na reserva.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.semCalculo) alertas.push({ nivel: "atencao", texto: `${contagens.semCalculo} reserva(s) paga(s) pelo site com dinheiro recebido sem cálculo no financeiro: confira o contrato na data da entrada.`, link: LINK_PAGAMENTOS });
  if (contagens.comAviso) alertas.push({ nivel: "atencao", texto: `${contagens.comAviso} pagamento(s) do site com aviso: confira na lista.`, link: `${LINK_PAGAMENTOS}?atencao=1` });
  if (contagens.pagasAbertas) {
    const envioLigado = escritaBeds24Pronta(env) && (await lerRegrasCalendario(db, organizacaoId)).envio.automatico;
    if (!envioLigado) alertas.push({ nivel: "info", texto: `${contagens.pagasAbertas} reserva(s) do site paga(s): feche as datas nas OTAs (no Beds24, como bloqueio) enquanto o envio ao Beds24 estiver desligado.`, link: "/painel/reservas" });
  }
  return { alertas, contagens };
}

/** Códigos de aviso conhecidos, para quem precisar listar (painel). */
export const CODIGOS_AVISO = Object.keys(AVISOS_PAGAMENTO) as CodigoAviso[];
