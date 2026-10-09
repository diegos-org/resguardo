/**
 * Pagamento no site (M8.2a) — gerar o Pix de uma cotação segurada, em três fases (como o envio ao Beds24):
 *
 * 1. Transação curta, com a ordem única das travas (imóvel → reserva → cotação → tentativas) e tempo-limite de
 *    espera: confere a oferta, reaproveita um Pix ainda válido (mesmo QR, mesmo prazo), manda cancelar antes o Pix
 *    pendente anterior, respeita o teto de 3 Pix por cotação, grava a tentativa `criando` (referência e chave de
 *    idempotência) e estende provisoriamente o prazo das datas para agora + validade + 2 minutos.
 * 2. A chamada ao provedor, sem transação.
 * 3. Transação curta: aplica o que voltou e estende o prazo das datas até o vencimento do Pix + 2 minutos (só com
 *    o pedido ainda em `pedido` e a cotação `segurada`; senão o Pix é cancelado). Assim o QR nunca vale mais que as
 *    datas. Resposta perdida = `incerta`, resolvida depois pela referência (nunca com uma order nova).
 *
 * O e-mail e o nome do pagador saem da reserva, no servidor (no teste, o adaptador troca o e-mail pelo do
 * sandbox); a página nunca os recebe.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { nomeNaFatura } from "@/configuracoes/pagamento-site";
import { travaOcupada } from "@/db/erros";
import { pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { estenderHold } from "@/site/cotacoes";
import { FOLGA_PRAZO_PIX_MS, MAXIMO_PIX_POR_COTACAO } from "./andamento";
import type { Leitura } from "./aplicar";
import { aplicarLeitura } from "./aplicar";
import { cancelarNoProvedor, chaveCancelamento, conferirTentativa } from "./conferencia";
import { motivoSemPixDaCotacao, TEXTO_SEM_PIX } from "./oferta";
import { ErroProvedor, type PedidoPix, PIX_VALIDADE_MINIMA_MINUTOS, type ProvedorPagamento, type ResultadoCriacao } from "./provedor";
import { comDinheiro } from "./situacoes";
import { travarCotacao } from "./travas";

export { FOLGA_PRAZO_PIX_MS, MAXIMO_PIX_POR_COTACAO };
/** Pix que vence em menos de um minuto não é mostrado de novo: gera-se outro. */
export const MARGEM_PIX_VALIDO_MS = 60_000;

export type CodigoFalhaPix = "nao_encontrada" | "nao_oferecido" | "em_andamento" | "ja_pago" | "limite" | "provedor" | "incerto" | "recusado" | "ocupado";
export type ResultadoPix = { ok: true; pagamentoId: string; reaproveitado: boolean } | { ok: false; erro: string; codigo: CodigoFalhaPix };

export const referenciaDaTentativa = (id: string) => `scl-${id}`;
export const chaveCriacao = (id: string) => `pagamento:${id}:criar`;

const MENSAGENS: Record<CodigoFalhaPix, string> = {
  nao_encontrada: "Cotação não encontrada.",
  nao_oferecido: "O pagamento pelo site não está disponível para esta cotação: fale com a equipe.",
  em_andamento: "Estamos conferindo o Pix gerado há pouco. Atualize a página em instantes.",
  ja_pago: "Já recebemos um pagamento desta cotação.",
  limite: `Esta cotação já gerou ${MAXIMO_PIX_POR_COTACAO} Pix. Para continuar, fale com a equipe.`,
  provedor: "Não deu para falar com o Mercado Pago agora. Tente de novo em instantes ou fale com a equipe.",
  incerto: "Não deu para confirmar se o Pix foi criado. Atualize a página em instantes: nada é cobrado duas vezes.",
  recusado: "O Mercado Pago não aceitou gerar o Pix agora. Tente de novo ou fale com a equipe.",
  ocupado: "Muitos pedidos neste apartamento agora. Tente de novo em instantes.",
};
const falha = (codigo: CodigoFalhaPix, erro = MENSAGENS[codigo]): ResultadoPix => ({ ok: false, codigo, erro });

type Fase1 =
  | { tipo: "erro"; resultado: ResultadoPix }
  | { tipo: "reaproveitar"; id: string }
  | { tipo: "cancelar"; id: string; idProvedor: string }
  | { tipo: "criar"; id: string; pedido: PedidoPix };

async function fase1(tx: Db, organizacaoId: string, cotacaoId: string, agora: Date): Promise<Fase1> {
  const erro = (codigo: CodigoFalhaPix, texto?: string): Fase1 => ({ tipo: "erro", resultado: falha(codigo, texto) });
  const t = await travarCotacao(tx, organizacaoId, cotacaoId);
  if (!t) return erro("nao_encontrada");
  const motivo = await motivoSemPixDaCotacao(tx, organizacaoId, t.cotacao, t.reserva.estado, agora);
  if (motivo) return erro("nao_oferecido", TEXTO_SEM_PIX[motivo]);
  if (t.tentativas.some((x) => x.situacao === "criando" || x.situacao === "incerta")) return erro("em_andamento");
  if (t.tentativas.some((x) => comDinheiro(x.situacao))) return erro("ja_pago");
  const pendentes = t.tentativas.filter((x) => x.situacao === "pendente");
  if (pendentes.some((x) => x.forma !== "pix")) return erro("em_andamento");
  const valido = pendentes.find((x) => x.pixCopiaECola && x.pixExpiraEm && x.pixExpiraEm.getTime() > agora.getTime() + MARGEM_PIX_VALIDO_MS);
  if (valido) return { tipo: "reaproveitar", id: valido.id };
  // Pix novo só depois de cancelar o anterior no provedor (cancelado, já cancelado ou vencido).
  const anterior = pendentes.find((x) => x.idProvedor);
  if (anterior) return { tipo: "cancelar", id: anterior.id, idProvedor: anterior.idProvedor! };
  if (pendentes.length) return erro("em_andamento");
  if (t.tentativas.filter((x) => x.forma === "pix").length >= MAXIMO_PIX_POR_COTACAO) return erro("limite");

  const id = randomUUID();
  const holdAte = t.cotacao.holdAte!;
  // O Pix vale pelo menos 30 minutos (regra do provedor) e, se as datas ainda valem mais que isso, o mesmo tanto.
  const validade = Math.max(PIX_VALIDADE_MINIMA_MINUTOS, Math.ceil((holdAte.getTime() - agora.getTime()) / 60_000));
  await tx.insert(pagamentos).values({
    id,
    organizacaoId,
    cotacaoId,
    reservaId: t.reserva.id,
    imovelId: t.imovel.id,
    ambiente: "teste",
    forma: "pix",
    referencia: referenciaDaTentativa(id),
    chaveIdempotencia: chaveCriacao(id),
    situacao: "criando",
    valor: t.cotacao.total,
    criadoEm: agora,
    atualizadoEm: agora,
  });
  // Prazo provisório: a rotina não vence o pedido enquanto a chamada está no ar.
  await estenderHold(tx, organizacaoId, cotacaoId, new Date(agora.getTime() + validade * 60_000 + FOLGA_PRAZO_PIX_MS), agora, id);
  const empresa = await nomeDaEmpresa(tx, organizacaoId);
  return {
    tipo: "criar",
    id,
    pedido: {
      referencia: referenciaDaTentativa(id),
      chaveIdempotencia: chaveCriacao(id),
      valor: t.cotacao.total,
      email: t.reserva.hospedeEmail,
      nome: t.reserva.hospedeNome,
      validadeMinutos: validade,
      descricao: `${empresa} — reserva ${t.reserva.codigo} (${t.imovel.nome})`,
      descricaoFatura: await nomeNaFatura(tx, organizacaoId),
    },
  };
}

/** Leitura que a criação devolveu. null = nada chegou ao provedor (a tentativa é apagada). */
function leituraDaCriacao(res: ResultadoCriacao | null, erro: unknown): Leitura | null {
  if (erro) return erro instanceof ErroProvedor && erro.tipo !== "incerto" ? null : { incerta: true };
  if (!res) return { incerta: true };
  if (res.ok) return { cobranca: res.cobranca };
  if (res.motivo === "incerto") return { incerta: true };
  return res.cobranca ? { cobranca: res.cobranca } : { recusadaSemOrder: true };
}

async function criar(db: Db, organizacaoId: string, cotacaoId: string, f: Extract<Fase1, { tipo: "criar" }>, agora: Date, provedor: ProvedorPagamento): Promise<ResultadoPix> {
  let res: ResultadoCriacao | null = null;
  let erro: unknown = null;
  try {
    res = await provedor.criarPix(f.pedido);
  } catch (e) {
    erro = e;
  }
  const leitura = leituraDaCriacao(res, erro);
  const fim = await db.transaction(async (tx) => {
    const t = await travarCotacao(tx, organizacaoId, cotacaoId);
    const p = t?.tentativas.find((x) => x.id === f.id);
    if (!t || !p) return null;
    if (!leitura) {
      // O pedido não chegou ao provedor (sem conexão, chave recusada, limite de chamadas): nada foi criado.
      await tx.delete(pagamentos).where(eq(pagamentos.id, p.id));
      return { situacao: null, cancelar: [] as { id: string; idProvedor: string }[], pedidoValido: true };
    }
    const ef = await aplicarLeitura(tx, organizacaoId, t, p.id, leitura, agora);
    const pedidoValido = t.reserva.estado === "pedido" && t.cotacao.estado === "segurada";
    const cancelar = [...ef.cancelar];
    if (ef.situacao === "pendente") {
      if (pedidoValido && p.pixExpiraEm) await estenderHold(tx, organizacaoId, cotacaoId, new Date(p.pixExpiraEm.getTime() + FOLGA_PRAZO_PIX_MS), agora, p.id);
      else if (!pedidoValido && p.idProvedor && !cancelar.some((x) => x.id === p.id)) cancelar.push({ id: p.id, idProvedor: p.idProvedor });
    }
    return { situacao: ef.situacao, cancelar, pedidoValido };
  });
  if (!fim) return falha("nao_encontrada");
  if (fim.cancelar.length) await cancelarNoProvedor(db, organizacaoId, fim.cancelar, provedor, agora);
  if (fim.situacao === null) return falha("provedor", erro instanceof ErroProvedor ? erro.message : MENSAGENS.provedor);
  if (fim.situacao === "incerta") return falha("incerto");
  if (fim.situacao === "recusado") return falha("recusado");
  if (fim.situacao === "pendente" && !fim.pedidoValido) return falha("nao_oferecido", "O prazo das datas desta cotação acabou durante a criação do Pix: ele foi cancelado.");
  return { ok: true, pagamentoId: f.id, reaproveitado: false };
}

/** Gera (ou mostra de novo) o Pix da cotação. `provedor` = o liberado por `podeCobrar`. */
export async function gerarPix(db: Db, organizacaoId: string, cotacaoId: string, agora: Date, provedor: ProvedorPagamento): Promise<ResultadoPix> {
  if (!uuidValido(cotacaoId)) return falha("nao_encontrada");
  // Antes de qualquer coisa nova: uma criação que ficou no ar é procurada pela referência.
  const abertas = await db
    .select({ id: pagamentos.id })
    .from(pagamentos)
    .where(and(eq(pagamentos.cotacaoId, cotacaoId), eq(pagamentos.organizacaoId, organizacaoId), inArray(pagamentos.situacao, ["criando", "incerta"])));
  for (const a of abertas) await conferirTentativa(db, organizacaoId, a.id, provedor, agora, { forcar: true, origem: "pagina" });
  for (let volta = 0; volta < 3; volta++) {
    let f: Fase1;
    try {
      f = await db.transaction((tx) => fase1(tx, organizacaoId, cotacaoId, agora));
    } catch (e) {
      if (travaOcupada(e)) return falha("ocupado");
      throw e;
    }
    if (f.tipo === "erro") return f.resultado;
    if (f.tipo === "reaproveitar") return { ok: true, pagamentoId: f.id, reaproveitado: true };
    if (f.tipo === "criar") return criar(db, organizacaoId, cotacaoId, f, agora, provedor);
    // Cancela o Pix anterior e relê: só a leitura muda a situação (o cancelamento pode cruzar com o pagamento).
    const cancelado = await provedor.cancelar(f.idProvedor, chaveCancelamento(f.id));
    const lido = await conferirTentativa(db, organizacaoId, f.id, provedor, agora, { forcar: true, origem: "pagina", semCancelar: true });
    if (!lido.ok) return falha("provedor", lido.erro);
    if (lido.situacao === "pendente") return falha("provedor", cancelado === "erro" ? "Não deu para cancelar o Pix anterior no Mercado Pago. Tente de novo em instantes." : MENSAGENS.provedor);
  }
  return falha("provedor");
}
