/**
 * Pagamento no site (M8.2b) — pagar com cartão de crédito uma cotação segurada, em três fases (como o Pix):
 *
 * 0. Sem trava: conferências locais (só crédito, formato do token e da bandeira, parcelas de 1 a 36) e a releitura das
 *    tentativas encerradas há pouco (se uma virou dinheiro, nenhum cartão sai).
 * 1. Transação curta, com a ordem única das travas (imóvel → reserva → cotação → tentativas → páginas legais): a oferta
 *    do cartão (painel, disjuntor), uma tentativa por vez (criando/incerta/processando = espera; em análise = nada de
 *    outro jeito), o aceite das páginas legais, os tetos ANTES de cancelar qualquer coisa (3 cartões por cotação, 30 por
 *    hora na organização contados pelas linhas que chegaram ao Mercado Pago), as parcelas do painel, o cancelamento de um
 *    Pix pendente ou de um cartão no desafio do banco (o hóspede escolheu outro jeito), e a tentativa `criando` gravada
 *    com a referência, a chave de idempotência, o aceite, as parcelas, a bandeira e a verificação do banco pedida.
 *    Nenhuma extensão provisória do prazo das datas: a carência já protege uma tentativa `criando`.
 * 2. A chamada ao provedor, sem transação nem trava. O token do cartão, o documento e o id do aparelho só existem na
 *    memória desta chamada (nunca no banco nem no registro).
 * 3. Transação curta: aplica o que voltou (`aplicarLeitura`: confirma na hora quando aprovado; etapa do desafio, prazo
 *    das datas, análise, disjuntor). Nada chegou ao provedor = a tentativa é apagada. Trava não obtida com a order na
 *    resposta: o id dela é gravado num comando só e a fase 3 é tentada mais uma vez; depois da chamada nunca é
 *    "ocupado" (o cartão pode ter sido cobrado): é "incerto", resolvido só pela leitura (nunca por uma order nova).
 *
 * O e-mail do pagador sai da reserva, no servidor (no teste, o adaptador troca pelo do sandbox); a página nunca o
 * recebe. O motivo de uma recusa nunca vai ao hóspede: os códigos daqui viram textos genéricos no site.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { lerConfigPagamentoSite, nomeNaFatura } from "@/configuracoes/pagamento-site";
import type { VersoesLegais } from "@/configuracoes/paginas-legais-texto";
import { travaOcupada } from "@/db/erros";
import { type EtapaCartao, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { aceiteVigenteTravado } from "@/site/aceites";
import { CARTOES_POR_HORA_NA_ORGANIZACAO, MAXIMO_CARTAO_POR_COTACAO } from "./andamento";
import { aplicarLeitura, type Leitura } from "./aplicar";
import { cancelarNoProvedor, chaveCancelamento } from "./conferencia";
import { chaveCriacao, conferirOuOcupado, guardarIdDaOrder, leituraDaCriacao, referenciaDaTentativa, relerEncerradasRecentes } from "./criacao";
import { motivoSemCartaoDaCotacao, motivoSoDoCartao, TEXTO_SEM_CARTAO } from "./oferta";
import { CODIGOS_FALHA_DO_PROVEDOR, CODIGOS_TOKEN, type PedidoCartao, PARCELAS_MAXIMAS, type ProvedorPagamento, type ResultadoCriacao, type StatusTresDS } from "./provedor";
import { comDinheiro, motivoDoDetalhe, type SituacaoPagamento } from "./situacoes";
import { travarCotacao } from "./travas";

export { CARTOES_POR_HORA_NA_ORGANIZACAO, MAXIMO_CARTAO_POR_COTACAO };

/** O que o formulário do cartão manda (o número do cartão nunca: só o token gerado no navegador). */
export type DadosCartaoDoHospede = {
  token: string;
  /** payment_method_id do formulário (visa, master…). */
  bandeira: string;
  /** payment_type_id do formulário: só `credit_card` é aceito. */
  tipo: string;
  parcelas: number;
  /** Repassado ao provedor, nunca guardado. */
  documento: { tipo: string; numero: string } | null;
  /** Id do aparelho do SDK do Mercado Pago: repassado, nunca guardado (só se veio, em `com_dispositivo`). */
  dispositivo: string | null;
};

export type CodigoFalhaCartao =
  | "nao_encontrada"
  | "nao_oferecido"
  | "indisponivel"
  | "em_andamento"
  | "em_analise"
  | "ja_pago"
  | "limite"
  | "limite_geral"
  | "parcelas"
  | "so_credito"
  | "dados_cartao"
  | "recusado"
  | "verificacao"
  | "provedor"
  | "incerto"
  | "ocupado"
  | "ao_vivo"
  | "aceite_pendente"
  | "aceite_mudou"
  | "prazo";

/** `desafio` = o banco pediu a verificação (a página mostra o desafio); `conferindo` = processando no Mercado Pago. */
export type SituacaoCartao = "aprovado" | "desafio" | "analise" | "conferindo";
/** `erro`: texto do domínio para o painel e o desenvolvimento; o hóspede vê o texto genérico do código (site). */
export type ResultadoCartao = { ok: true; pagamentoId: string; situacao: SituacaoCartao } | { ok: false; codigo: CodigoFalhaCartao; erro: string };

const TEXTOS: Record<CodigoFalhaCartao, string> = {
  nao_encontrada: "Cotação não encontrada.",
  nao_oferecido: "O pagamento pelo site não está disponível para esta cotação.",
  indisponivel: "O pagamento com cartão não está disponível agora.",
  em_andamento: "Há um pagamento desta cotação em andamento.",
  em_analise: "Há um pagamento com cartão desta cotação em análise no Mercado Pago.",
  ja_pago: "Já recebemos um pagamento desta cotação.",
  limite: `Esta cotação já teve ${MAXIMO_CARTAO_POR_COTACAO} tentativas com cartão.`,
  limite_geral: `A organização já teve ${CARTOES_POR_HORA_NA_ORGANIZACAO} tentativas com cartão na última hora.`,
  parcelas: "Número de parcelas fora do permitido.",
  so_credito: "Só cartão de crédito é aceito.",
  dados_cartao: "Os dados do cartão expiraram ou são inválidos.",
  recusado: "Pagamento recusado pelo Mercado Pago.",
  verificacao: "A verificação do banco não foi concluída.",
  provedor: "Não deu para falar com o Mercado Pago agora.",
  incerto: "Não deu para saber se o cartão foi cobrado: a leitura resolve (nunca uma order nova).",
  ocupado: "Muitos pedidos neste apartamento agora.",
  ao_vivo: "O Mercado Pago marcou um pagamento desta cotação como real no ambiente de teste.",
  aceite_pendente: "Falta o aceite das páginas legais.",
  aceite_mudou: "As páginas legais mudaram desde que a página foi aberta.",
  prazo: "O prazo das datas acabou durante o pagamento: o desafio do banco foi cancelado.",
};
const falha = (codigo: CodigoFalhaCartao, erro = TEXTOS[codigo]): ResultadoCartao => ({ ok: false, codigo, erro });

const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
const BANDEIRA = /^[a-z0-9_-]{1,40}$/;
const DISPOSITIVO = /^[\x21-\x7E]{1,256}$/;
const emLista = (lista: readonly string[], c: string | null) => c !== null && lista.includes(c);

/** Resultados da verificação do banco que mostram que ela não passou (ou que o hóspede esteve no desafio). */
const TRES_DS_SEM_SUCESSO: readonly StatusTresDS[] = ["CHALLENGE", "NOT_AUTHENTICATED", "REJECTED"];
const CODIGOS_DESAFIO = ["cc_rejected_3ds_challenge", "3ds_challenge_expired"];

/**
 * Como dizer ao hóspede o fim de um cartão sem dinheiro (pelo estado, nunca pelo texto do provedor): dados do cartão
 * vencidos (preencher de novo), falha técnica do Mercado Pago, verificação do banco não concluída (desafio cancelado,
 * vencido ou recusado — o sandbox encerra um desafio recusado como `failed/failed` —, ou a verificação sem desafio
 * recusada) ou recusa (todas as outras, com o mesmo texto). null = não está encerrado sem dinheiro.
 */
export function recusaDoCartao(
  p: { situacao: SituacaoPagamento; detalheProvedor: string; tresDSStatus: StatusTresDS | null },
  o: { estavaNoDesafio?: boolean } = {},
): "dados_cartao" | "provedor" | "verificacao" | "recusado" | null {
  if (p.situacao === "cancelado" || p.situacao === "expirado") return "verificacao";
  if (p.situacao !== "recusado") return null;
  const codigo = motivoDoDetalhe(p.detalheProvedor);
  if (emLista(CODIGOS_TOKEN, codigo)) return "dados_cartao";
  if (emLista(CODIGOS_FALHA_DO_PROVEDOR, codigo)) return "provedor";
  if (o.estavaNoDesafio || (p.tresDSStatus !== null && TRES_DS_SEM_SUCESSO.includes(p.tresDSStatus)) || emLista(CODIGOS_DESAFIO, codigo)) return "verificacao";
  return "recusado";
}

type BaseDoPedido = Omit<PedidoCartao, "token" | "documento" | "sessaoDispositivo">;
type Fase1 =
  | { tipo: "erro"; resultado: ResultadoCartao }
  | { tipo: "cancelar"; id: string; idProvedor: string }
  | { tipo: "criar"; id: string; base: BaseDoPedido };

async function fase1(tx: Db, organizacaoId: string, cotacaoId: string, agora: Date, d: { bandeira: string; parcelas: number; comDispositivo: boolean }, aceite: VersoesLegais | null): Promise<Fase1> {
  const erro = (codigo: CodigoFalhaCartao, texto?: string): Fase1 => ({ tipo: "erro", resultado: falha(codigo, texto) });
  const t = await travarCotacao(tx, organizacaoId, cotacaoId);
  if (!t) return erro("nao_encontrada");
  // Uma tentativa por vez na cotação (Pix ou cartão). Dinheiro vem antes da oferta: um Pix pago no instante em que o
  // hóspede trocou pelo cartão já confirmou a reserva, e a resposta é "já pago" (não "indisponível").
  if (t.tentativas.some((x) => x.situacao === "criando" || x.situacao === "incerta")) return erro("em_andamento");
  if (t.tentativas.some((x) => comDinheiro(x.situacao))) return erro("ja_pago");
  // Um pagamento desta cotação marcado como real (live_mode) no teste: nenhum outro.
  if (t.tentativas.some((x) => x.aoVivo === true)) return erro("ao_vivo");
  const motivo = await motivoSemCartaoDaCotacao(tx, organizacaoId, t.cotacao, t.reserva.estado, agora);
  if (motivo) return erro(motivoSoDoCartao(motivo) ? "indisponivel" : "nao_oferecido", TEXTO_SEM_CARTAO[motivo]);
  const pendentes = t.tentativas.filter((x) => x.situacao === "pendente");
  // Cartão em análise: o Mercado Pago não cancela e pode aprovar (nada de outro jeito); processando: espera.
  if (pendentes.some((x) => x.forma === "cartao" && x.etapaCartao === "analise")) return erro("em_analise");
  if (pendentes.some((x) => x.forma === "cartao" && x.etapaCartao !== "desafio")) return erro("em_andamento");
  // M7.4: páginas legais aceitas nas versões publicadas agora (o aceite enviado junto é gravado nesta mesma transação).
  const a = await aceiteVigenteTravado(tx, organizacaoId, { cotacaoId, reservaId: t.reserva.id }, aceite, "cartao", agora);
  if (!a.ok) return a.motivo === "nao_publicadas" ? erro("nao_oferecido", TEXTO_SEM_CARTAO.sem_paginas_legais) : erro(a.motivo === "mudou" ? "aceite_mudou" : "aceite_pendente");
  // Tetos antes de cancelar qualquer coisa: com o teto atingido, o Pix pendente (ou o desafio) continua valendo.
  if (t.tentativas.filter((x) => x.forma === "cartao").length >= MAXIMO_CARTAO_POR_COTACAO) return erro("limite");
  // Teto geral pelas linhas que chegaram ao provedor (as apagadas por falha de transporte não contam). Não é serializado
  // entre cotações: algumas em paralelo podem passar da linha (é um freio; o disjuntor é a parada de verdade).
  const [hora] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(pagamentos)
    .where(and(eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.forma, "cartao"), gt(pagamentos.criadoEm, new Date(agora.getTime() - 3_600_000))));
  if ((hora?.n ?? 0) >= CARTOES_POR_HORA_NA_ORGANIZACAO) return erro("limite_geral");
  const config = await lerConfigPagamentoSite(tx, organizacaoId);
  if (d.parcelas > Math.min(config.parcelasMaximas ?? PARCELAS_MAXIMAS, PARCELAS_MAXIMAS)) return erro("parcelas");
  // O hóspede escolheu pagar com cartão (ou com outro cartão): o Pix pendente ou o desafio anterior é cancelado no
  // provedor e relido antes (o cancelamento pode cruzar com o pagamento: dinheiro = "já pago", nenhum cartão).
  const anterior = pendentes.find((x) => x.idProvedor);
  if (anterior) {
    if (!anterior.cancelamentoPor) await tx.update(pagamentos).set({ cancelamentoPor: "hospede", atualizadoEm: agora }).where(and(eq(pagamentos.id, anterior.id), isNull(pagamentos.cancelamentoPor)));
    return { tipo: "cancelar", id: anterior.id, idProvedor: anterior.idProvedor! };
  }
  if (pendentes.length) return erro("em_andamento");

  const id = randomUUID();
  await tx.insert(pagamentos).values({
    id,
    organizacaoId,
    cotacaoId,
    reservaId: t.reserva.id,
    imovelId: t.imovel.id,
    ambiente: "teste",
    forma: "cartao",
    referencia: referenciaDaTentativa(id),
    chaveIdempotencia: chaveCriacao(id),
    situacao: "criando",
    valor: t.cotacao.total,
    aceiteId: a.aceite.id,
    parcelas: d.parcelas,
    bandeira: d.bandeira,
    tresDS: config.tresDS,
    comDispositivo: d.comDispositivo,
    criadoEm: agora,
    atualizadoEm: agora,
  });
  const empresa = await nomeDaEmpresa(tx, organizacaoId);
  return {
    tipo: "criar",
    id,
    base: {
      referencia: referenciaDaTentativa(id),
      chaveIdempotencia: chaveCriacao(id),
      valor: t.cotacao.total,
      bandeira: d.bandeira,
      tipo: "credit_card",
      parcelas: d.parcelas,
      tresDS: config.tresDS,
      emissor: null,
      email: t.reserva.hospedeEmail,
      descricao: `${empresa} — reserva ${t.reserva.codigo} (${t.imovel.nome})`,
      descricaoFatura: await nomeNaFatura(tx, organizacaoId),
    },
  };
}

type Fim = {
  situacao: SituacaoPagamento | null;
  etapa: EtapaCartao | null;
  /** Etapa antes desta leitura (um aviso da order pode ter chegado antes da fase 3). */
  etapaAntes: EtapaCartao | null;
  detalhe: string;
  tresDSStatus: StatusTresDS | null;
  cancelar: { id: string; idProvedor: string }[];
  /** Esta tentativa foi mandada cancelar pela própria leitura (desafio sem endereço ou sem o pedido segurado). */
  cancelada: boolean;
  semEndereco: boolean;
  pedidoValido: boolean;
  aoVivo: boolean;
};

async function criar(db: Db, organizacaoId: string, cotacaoId: string, f: Extract<Fase1, { tipo: "criar" }>, dados: { token: string; documento: DadosCartaoDoHospede["documento"]; dispositivo: string | null }, agora: Date, provedor: ProvedorPagamento): Promise<ResultadoCartao> {
  let res: ResultadoCriacao | null = null;
  let erro: unknown = null;
  try {
    res = await provedor.criarCartao({ ...f.base, token: dados.token, documento: dados.documento, sessaoDispositivo: dados.dispositivo });
  } catch (e) {
    erro = e;
  }
  const leitura = leituraDaCriacao(res, erro);
  const aplicar = (l: Leitura | null) =>
    db.transaction(async (tx): Promise<Fim | null> => {
      const t = await travarCotacao(tx, organizacaoId, cotacaoId);
      const p = t?.tentativas.find((x) => x.id === f.id);
      if (!t || !p) return null;
      const pedidoValido = t.reserva.estado === "pedido" && t.cotacao.estado === "segurada";
      if (!l) {
        // O pedido não chegou ao provedor (sem conexão, chave recusada, limite de chamadas): nada foi cobrado.
        await tx.delete(pagamentos).where(eq(pagamentos.id, p.id));
        return { situacao: null, etapa: null, etapaAntes: null, detalhe: "", tresDSStatus: null, cancelar: [], cancelada: false, semEndereco: false, pedidoValido, aoVivo: false };
      }
      const etapaAntes = p.etapaCartao;
      // `aplicarLeitura` atualiza este mesmo objeto (`p`, de `t.tentativas`) com o que gravou.
      const ef = await aplicarLeitura(tx, organizacaoId, t, p.id, l, agora);
      const aoVivo = p.aoVivo === true || l.cobranca?.aoVivo === true;
      return {
        situacao: ef.situacao,
        etapa: p.etapaCartao,
        etapaAntes,
        detalhe: p.detalheProvedor,
        tresDSStatus: p.tresDSStatus,
        cancelar: ef.cancelar,
        cancelada: ef.cancelar.some((x) => x.id === p.id),
        semEndereco: p.avisos.includes("desafio_sem_url"),
        pedidoValido,
        aoVivo,
      };
    });
  let fim: Fim | null;
  try {
    fim = await aplicar(leitura);
  } catch (e) {
    if (!travaOcupada(e)) throw e;
    // Trava não obtida depois da chamada: o cartão pode ter sido cobrado. Com a order na resposta, o id dela é gravado
    // num comando só (a leitura seguinte vai por ele) e a fase 3 é tentada mais uma vez com a mesma resposta.
    try {
      const cobranca = res?.cobranca ?? null;
      if (cobranca && cobranca.referencia === f.base.referencia) await guardarIdDaOrder(db, f.id, cobranca, agora);
      fim = await aplicar(leitura);
    } catch (e2) {
      if (travaOcupada(e2)) return falha("incerto");
      throw e2;
    }
  }
  if (!fim) return falha("nao_encontrada");
  if (fim.cancelar.length) await cancelarNoProvedor(db, organizacaoId, fim.cancelar, provedor, agora);
  if (fim.situacao === null) return falha("provedor");
  if (fim.aoVivo) return falha("ao_vivo");
  if (fim.situacao === "criando" || fim.situacao === "incerta") return falha("incerto");
  if (comDinheiro(fim.situacao)) return { ok: true, pagamentoId: f.id, situacao: "aprovado" };
  if (fim.situacao === "pendente") {
    if (fim.cancelada) return fim.semEndereco || fim.pedidoValido ? falha("verificacao") : falha("prazo");
    if (fim.etapa === "desafio") return { ok: true, pagamentoId: f.id, situacao: "desafio" };
    if (fim.etapa === "analise") return { ok: true, pagamentoId: f.id, situacao: "analise" };
    return { ok: true, pagamentoId: f.id, situacao: "conferindo" };
  }
  const recusa = recusaDoCartao({ situacao: fim.situacao, detalheProvedor: fim.detalhe, tresDSStatus: fim.tresDSStatus }, { estavaNoDesafio: fim.etapaAntes === "desafio" });
  return falha(recusa ?? "recusado");
}

/**
 * Paga a cotação com cartão de crédito. `provedor` = o liberado por `podeCobrar` (quem chama confere também o freio por
 * origem e `ofertaDeCartao`). `o.aceite`: as versões das páginas legais que o hóspede acabou de aceitar (a caixa
 * marcada); sem ele, vale o aceite já gravado na cotação.
 */
export async function pagarComCartao(
  db: Db,
  organizacaoId: string,
  cotacaoId: string,
  agora: Date,
  provedor: ProvedorPagamento,
  dados: DadosCartaoDoHospede,
  o: { aceite?: VersoesLegais | null } = {},
): Promise<ResultadoCartao> {
  if (!uuidValido(cotacaoId)) return falha("nao_encontrada");
  // Conferências locais antes de qualquer trava ou chamada (o provedor confere de novo de verdade).
  if (dados.tipo !== "credit_card") return falha("so_credito");
  const bandeira = typeof dados.bandeira === "string" ? dados.bandeira.trim().toLowerCase() : "";
  if (typeof dados.token !== "string" || !TOKEN.test(dados.token) || !BANDEIRA.test(bandeira)) return falha("dados_cartao");
  if (!Number.isInteger(dados.parcelas) || dados.parcelas < 1 || dados.parcelas > PARCELAS_MAXIMAS) return falha("parcelas");
  // O id do aparelho só segue quando tem formato válido (sem ele, o pagamento continua: bloqueadores de anúncio).
  const dispositivo = typeof dados.dispositivo === "string" && DISPOSITIVO.test(dados.dispositivo) ? dados.dispositivo : null;
  const relida = await relerEncerradasRecentes(db, organizacaoId, cotacaoId, provedor, agora);
  if (relida.tipo === "ocupado") return falha("ocupado");
  if (relida.tipo === "provedor") return falha("provedor", relida.erro);
  for (let volta = 0; volta < 3; volta++) {
    let f: Fase1;
    try {
      f = await db.transaction((tx) => fase1(tx, organizacaoId, cotacaoId, agora, { bandeira, parcelas: dados.parcelas, comDispositivo: dispositivo !== null }, o.aceite ?? null));
    } catch (e) {
      if (travaOcupada(e)) return falha("ocupado");
      throw e;
    }
    if (f.tipo === "erro") return f.resultado;
    if (f.tipo === "criar") return criar(db, organizacaoId, cotacaoId, f, { token: dados.token, documento: dados.documento, dispositivo }, agora, provedor);
    // Cancela o Pix pendente (ou o desafio anterior) e relê: só a leitura muda a situação; com dinheiro, a volta seguinte
    // da fase 1 diz "já pago".
    const cancelado = await provedor.cancelar(f.idProvedor, chaveCancelamento(f.id));
    const lido = await conferirOuOcupado(db, organizacaoId, f.id, provedor, agora, { forcar: true, origem: "pagina", semCancelar: true });
    if (lido === null) return falha("ocupado");
    if (!lido.ok) return falha("provedor", lido.erro);
    if (lido.situacao === "pendente") return falha("provedor", cancelado === "erro" ? "Não deu para cancelar o pagamento anterior no Mercado Pago." : TEXTOS.provedor);
  }
  return falha("provedor");
}
