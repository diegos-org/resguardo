/**
 * Mensagens programadas ao hóspede (M9.2), por e-mail, com os modelos editáveis do painel:
 * - confirmação: assim que a reserva é confirmada;
 * - check-in: 2 dias antes da entrada, às 10h (o mesmo momento em que o endereço aparece em
 *   "Minha reserva");
 * - check-out: 1 dia antes da saída, às 14h;
 * - agradecimento: 3 dias depois da saída, às 10h.
 * Horários no fuso do imóvel; o agendador roda de hora em hora. Cada execução calcula o que está no prazo a partir dos
 * dados atuais: cancelou, a mensagem não sai; mudou a data, vale a nova.
 *
 * Cancelamento de reserva paga pelo site (M8.2c): pedido recebido (até 2 dias depois de recebido), decisão (até 7 dias
 * depois do cancelamento) e devolução feita (até 7 dias depois dela). Os candidatos vêm do cancelamento, não da reserva
 * confirmada; a mesma mensagem é marcada como enviada no cancelamento (`hospedeAvisado…`, pelo sistema) — e não sai se a
 * equipe já marcou que enviou à mão. As frases do caso (`{decisao}`, `{comovolta}`) vêm de `textoDoCancelamento`, o mesmo
 * texto da página da reserva. Os botões "Copiar mensagem" do painel usam o mesmo preenchimento (`mensagensDoCancelamento`).
 *
 * Alteração de reserva paga pelo site (M8.2d): a proposta (enquanto as datas estão seguradas, em qualquer direção), a
 * confirmação (até 7 dias depois de aplicada) e a devolução da diferença feita (até 7 dias depois dela, com o mesmo modelo
 * "Devolução feita"). Os candidatos vêm da alteração; a marca de "mensagem enviada" acende nela (pelo sistema), e a
 * confirmação da reserva não sai de novo só porque as datas mudaram pela alteração. `{alteracao}` vem de
 * `textoDaAlteracao`, o mesmo texto da página da reserva; os botões "Copiar" do painel usam o mesmo preenchimento
 * (`mensagensDaAlteracao`).
 *
 * Regras:
 * - Desligado até Diego ligar em Configurações → Modelos de mensagem. Ligado, vale daquele momento
 *   em diante: nada que estava previsto para antes é mandado atrasado.
 * - Só para as origens escolhidas (Airbnb e Booking têm as mensagens deles).
 * - Faltou um dado usado no modelo (nome, e-mail, endereço…) ou o modelo sumiu: não manda, avisa.
 * - Uma vez por mensagem: o registro é gravado antes de chamar o provedor. Recusa do provedor:
 *   tenta de novo nas próximas execuções (até 3 vezes). Sem resposta do provedor: fica "incerto" e
 *   não é repetida sozinha (melhor conferir do que mandar duas vezes).
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { emailValido } from "@/acesso/codigo-email";
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import { lerEmpresa } from "@/configuracoes/empresa";
import {
  ehMensagemDeAlteracao,
  ehMensagemDeCancelamento,
  NOMES_TIPO,
  ondeVale,
  preencherModelo,
  problemaDoModeloNoTipo,
  TEXTO_BASE_RECEBIDO_SEM_POLITICA,
  textoDaFaltaNoCancelamento,
  TEXTOS_BASE_ALTERACAO,
  TEXTOS_BASE_CANCELAMENTO,
  type TipoMensagemAlteracao,
  type TipoMensagemCancelamento,
  type Variavel,
  VARIAVEIS_DO_CANCELAMENTO,
  variaveisDoTexto,
  variaveisForaDoLugar,
} from "@/configuracoes/modelos-texto";
import { lerTextosSite, type TextosSite } from "@/configuracoes/textos-site";
import {
  alteracoesReserva,
  appSettings,
  cancelamentosReserva,
  cotacoes,
  devolucoesPagamento,
  imoveis,
  imoveisDetalhes,
  mensagensHospede,
  modelosMensagem,
  ORIGENS_RESERVA,
  type OrigemReserva,
  pagamentos,
  reservas,
  type SituacaoCancelamento,
  TIPOS_MENSAGEM_HOSPEDE,
  type TipoMensagemHospede,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { type Correio, ErroEnvioIncerto } from "@/email/correio";
import { instanteLocal, liberacaoDasInstrucoes } from "@/hospede/portal";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { marcarAvisadoDaAlteracao, type MensagemDaAlteracao } from "@/pagamentos/alteracao";
import { canceladaPelaDisputa, marcarAvisado, type MensagemAoHospede } from "@/pagamentos/cancelamento";
import { type AlteracaoParaHospede, alteracaoParaMensagem, vistaDaCotacaoParaHospede } from "@/pagamentos/consultas";
import { textoDaAlteracao, textoDoCancelamento } from "@/site/pagamento-vista";

export { NOMES_TIPO };

/** Recusas seguidas do provedor antes de desistir de uma mensagem. */
export const MAX_TENTATIVAS = 3;
/** Até quando o agradecimento ainda faz sentido, depois do momento previsto. */
const PRAZO_AGRADECIMENTO_MS = 4 * 24 * 3_600_000;
/** Pedido que ficou "enviando" por mais que isso: não se sabe se saiu (o painel mostra como incerto). */
export const ENVIANDO_INCERTO_MS = 15 * 60_000;

export type ConfigMensagensHospede = {
  ativo: boolean;
  /** ISO: quando foi ligado. Só sai o que estava previsto a partir daí. */
  ativoDesde?: string;
  origens: OrigemReserva[];
  /** Modelo de cada mensagem (id), ou null = essa mensagem não é enviada. */
  modelos: Record<TipoMensagemHospede, string | null>;
};

/** Sem configuração: desligado, só site e direta, nenhum modelo escolhido. */
export const ORIGENS_PADRAO: OrigemReserva[] = ["site", "direta"];

export async function lerConfigMensagens(db: Db, organizacaoId: string): Promise<ConfigMensagensHospede & { salva: boolean }> {
  const c = await lerConfig(db, organizacaoId, "mensagens_hospede");
  const modelosBrutos = (c?.modelos ?? {}) as Record<string, unknown>;
  const modelos = Object.fromEntries(TIPOS_MENSAGEM_HOSPEDE.map((t) => [t, typeof modelosBrutos[t] === "string" ? (modelosBrutos[t] as string) : null])) as ConfigMensagensHospede["modelos"];
  const origens = Array.isArray(c?.origens) ? (c.origens as unknown[]).filter((o): o is OrigemReserva => (ORIGENS_RESERVA as readonly unknown[]).includes(o)) : ORIGENS_PADRAO;
  const ativoDesde = typeof c?.ativoDesde === "string" && !Number.isNaN(Date.parse(c.ativoDesde)) ? c.ativoDesde : undefined;
  return { salva: c !== null, ativo: c?.ativo === true && ativoDesde !== undefined, ...(ativoDesde ? { ativoDesde } : {}), origens, modelos };
}

/** Grava a configuração da tela. Ligar agora = vale de agora em diante (religar também recomeça daqui). */
export async function salvarConfigMensagens(
  db: Db,
  organizacaoId: string,
  c: { ativo: boolean; origens: string[]; modelos: Partial<Record<string, string>> },
  autorId: string | null,
  agora: Date = new Date(),
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const origens = [...new Set(c.origens)].filter((o): o is OrigemReserva => (ORIGENS_RESERVA as readonly string[]).includes(o));
  if (c.ativo && !origens.length) return { ok: false, erro: "Escolha ao menos uma origem de reserva." };
  const ids = TIPOS_MENSAGEM_HOSPEDE.map((t) => c.modelos[t] || null).filter((x): x is string => !!x);
  const validos = ids.filter((i) => uuidValido(i));
  const encontrados = validos.length ? await db.select().from(modelosMensagem).where(and(eq(modelosMensagem.organizacaoId, organizacaoId), inArray(modelosMensagem.id, validos))) : [];
  const porId = new Map(encontrados.map((m) => [m.id, m]));
  const modelos = {} as ConfigMensagensHospede["modelos"];
  for (const t of TIPOS_MENSAGEM_HOSPEDE) {
    const id = c.modelos[t] || null;
    if (id && !porId.get(id)?.ativo) return { ok: false, erro: `Modelo escolhido para "${NOMES_TIPO[t]}" não existe ou está arquivado.` };
    // Variável fora do lugar, endereço onde ele não vai (a confirmação sai antes da liberação dele) ou variável que falta.
    const problema = id ? problemaDoModeloNoTipo(t, porId.get(id)!.texto) : null;
    if (problema) return { ok: false, erro: problema };
    modelos[t] = id;
  }
  if (c.ativo && !Object.values(modelos).some(Boolean)) return { ok: false, erro: "Escolha o modelo de ao menos uma mensagem para ligar o envio." };
  const anterior = await lerConfigMensagens(db, organizacaoId);
  const ativoDesde = c.ativo ? (anterior.ativo && anterior.ativoDesde ? anterior.ativoDesde : agora.toISOString()) : undefined;
  await db.transaction((tx) => gravarConfig(tx, organizacaoId, "mensagens_hospede", { ativo: c.ativo, ...(ativoDesde ? { ativoDesde } : {}), origens, modelos }, autorId));
  return { ok: true };
}

const somarDias = (dataISO: string, dias: number) => {
  const d = new Date(`${dataISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

export type DadosPrazo = { checkin: string; checkout: string; confirmadaEm: Date | null; fuso: string; entradaAPartirDe: string; saidaAte: string };

/**
 * Quando cada mensagem pode sair: do momento previsto até o fim do prazo (reserva feita em cima
 * da hora recebe a de check-in logo, mas não depois da entrada). `referencia`: as datas a que a
 * mensagem se refere (outra data = outra mensagem).
 */
export function prazoDaMensagem(tipo: TipoMensagemHospede, r: DadosPrazo): { inicio: Date; fim: Date; referencia: string } | null {
  const entrada = instanteLocal(r.checkin, r.entradaAPartirDe, r.fuso);
  const saida = instanteLocal(r.checkout, r.saidaAte, r.fuso);
  switch (tipo) {
    case "confirmacao":
      return r.confirmadaEm ? { inicio: r.confirmadaEm, fim: entrada, referencia: `${r.checkin}/${r.checkout}` } : null;
    case "checkin":
      return { inicio: liberacaoDasInstrucoes(r.checkin, r.fuso), fim: entrada, referencia: r.checkin };
    case "checkout":
      return { inicio: instanteLocal(somarDias(r.checkout, -1), "14:00", r.fuso), fim: saida, referencia: r.checkout };
    case "agradecimento": {
      const inicio = instanteLocal(somarDias(r.checkout, 3), "10:00", r.fuso);
      return { inicio, fim: new Date(inicio.getTime() + PRAZO_AGRADECIMENTO_MS), referencia: r.checkout };
    }
    // Mensagens do cancelamento (M8.2c): não saem de uma reserva confirmada (os prazos contam do pedido, da decisão e da
    // devolução, que vêm do cancelamento: `prazoDaMensagemDoCancelamento`). As da alteração (M8.2d) também não: os
    // prazos vêm da própria alteração.
    case "cancelamento_recebido":
    case "cancelamento_decidido":
    case "devolucao_concluida":
    case "alteracao_proposta":
    case "alteracao_confirmada":
      return null;
  }
}

const dataBr = (d: string) => d.split("-").reverse().join("/");

/** Até quando cada mensagem do cancelamento ainda faz sentido, depois do momento dela. */
const PRAZO_PEDIDO_RECEBIDO_MS = 2 * 24 * 3_600_000;
const PRAZO_DECISAO_MS = 7 * 24 * 3_600_000;

export type DadosPrazoCancelamento = {
  cancelamentoId: string;
  situacao: SituacaoCancelamento;
  /**
   * O hóspede fez um pedido (por qualquer canal): só ele tem "pedido recebido". Vale mesmo quando a SCL cancelou depois, por
   * motivo dela: o pedido existiu e o recibo por escrito é dele. A SCL cancelando sem pedido, ou o não comparecimento, não.
   */
  doHospede: boolean;
  pedidoRecebidoEm: Date;
  canceladaEm: Date | null;
  /** A devolução feita (confirmada, ou por fora ao meio-dia do dia informado); null enquanto não foi. */
  devolucao: { id: string; em: Date } | null;
  /**
   * M8.2e: "Cancelar a reserva contestada" (sem decisão pela política). Não tem a mensagem da decisão: numa disputa do
   * pagamento a equipe fala com o hóspede caso a caso (PAGAMENTO-SITE.md, "Contestação (M8.2e)", "O que o hóspede vê").
   */
  pelaDisputa?: boolean;
};

/**
 * Quando cada mensagem do cancelamento pode sair (M8.2c): pedido recebido, do pedido até 2 dias depois; decisão, do
 * cancelamento até 7 dias depois; devolução feita, dela até 7 dias depois. `referencia`: o cancelamento (pedido e
 * decisão) ou a devolução.
 */
export function prazoDaMensagemDoCancelamento(tipo: TipoMensagemCancelamento, c: DadosPrazoCancelamento): { inicio: Date; fim: Date; referencia: string } | null {
  const ativo = c.situacao === "pedido" || c.situacao === "cancelada";
  switch (tipo) {
    case "cancelamento_recebido":
      return ativo && c.doHospede ? { inicio: c.pedidoRecebidoEm, fim: new Date(c.pedidoRecebidoEm.getTime() + PRAZO_PEDIDO_RECEBIDO_MS), referencia: c.cancelamentoId } : null;
    case "cancelamento_decidido":
      return c.situacao === "cancelada" && c.canceladaEm && !c.pelaDisputa ? { inicio: c.canceladaEm, fim: new Date(c.canceladaEm.getTime() + PRAZO_DECISAO_MS), referencia: c.cancelamentoId } : null;
    case "devolucao_concluida":
      return c.situacao === "cancelada" && c.devolucao ? { inicio: c.devolucao.em, fim: new Date(c.devolucao.em.getTime() + PRAZO_DECISAO_MS), referencia: c.devolucao.id } : null;
  }
}

/** Qual marca de "mensagem enviada ao hóspede" cada mensagem do cancelamento acende. */
const AVISADO_DO_TIPO: Record<TipoMensagemCancelamento, MensagemAoHospede> = { cancelamento_recebido: "pedido", cancelamento_decidido: "decisao", devolucao_concluida: "devolucao" };

/** Um cancelamento com o que as mensagens dele precisam (nunca gravado: o nome e o e-mail são lidos da reserva agora). */
type AlvoCancelamento = DadosPrazoCancelamento & {
  reservaId: string;
  codigo: string;
  checkin: string;
  checkout: string;
  origem: OrigemReserva;
  nome: string;
  email: string;
  imovel: string;
  fuso: string;
  cotacaoId: string;
  cotacaoCodigo: string;
  avisados: Record<MensagemAoHospede, Date | null>;
};

async function alvosDeCancelamento(db: Db, organizacaoId: string, f: { reservaId?: string; desde?: Date }): Promise<AlvoCancelamento[]> {
  const linhas = await db
    .select({
      c: cancelamentosReserva,
      codigo: reservas.codigo,
      checkin: reservas.checkin,
      checkout: reservas.checkout,
      origem: reservas.origem,
      nome: reservas.hospedeNome,
      email: reservas.hospedeEmail,
      imovel: imoveis.nome,
      fuso: imoveis.fuso,
      cotacaoId: pagamentos.cotacaoId,
      cotacaoCodigo: cotacoes.codigo,
    })
    .from(cancelamentosReserva)
    .innerJoin(reservas, and(eq(reservas.id, cancelamentosReserva.reservaId), eq(reservas.organizacaoId, cancelamentosReserva.organizacaoId)))
    .innerJoin(imoveis, eq(imoveis.id, reservas.imovelId))
    .innerJoin(pagamentos, eq(pagamentos.id, cancelamentosReserva.pagamentoId))
    .innerJoin(cotacoes, eq(cotacoes.id, pagamentos.cotacaoId))
    .where(
      and(
        eq(cancelamentosReserva.organizacaoId, organizacaoId),
        inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"]),
        f.reservaId ? eq(cancelamentosReserva.reservaId, f.reservaId) : undefined,
        f.desde ? gte(cancelamentosReserva.atualizadoEm, f.desde) : undefined,
      ),
    );
  if (!linhas.length) return [];
  const devs = await db
    .select({ id: devolucoesPagamento.id, cancelamentoId: devolucoesPagamento.cancelamentoId, situacao: devolucoesPagamento.situacao, confirmadaEm: devolucoesPagamento.confirmadaEm, porForaData: devolucoesPagamento.porForaData })
    .from(devolucoesPagamento)
    .where(inArray(devolucoesPagamento.cancelamentoId, linhas.map((l) => l.c.id)));
  return linhas.map((l) => {
    // M8.2d: uma devolução por pagamento da reserva. A mensagem da devolução feita sai uma vez, quando TODAS as devoluções
    // do cancelamento se realizaram (a referência e o dia são os da última); a substituída não conta.
    const doCancelamento = devs.filter((x) => x.cancelamentoId === l.c.id && x.situacao !== "substituida");
    const quando = (d: (typeof devs)[number]) => (d.situacao === "confirmada" ? d.confirmadaEm : d.situacao === "por_fora" && d.porForaData ? instanteLocal(d.porForaData, "12:00", "America/Sao_Paulo") : null);
    const feitas = doCancelamento.map((d) => ({ d, em: quando(d) }));
    const ultima = feitas.length && feitas.every((x) => x.em) ? feitas.sort((a, b) => a.em!.getTime() - b.em!.getTime()).at(-1)! : null;
    const d = ultima?.d;
    const em = ultima?.em ?? null;
    return {
      cancelamentoId: l.c.id,
      situacao: l.c.situacao,
      // O canal fica gravado quando houve pedido do hóspede (a SCL cancelando por cima dele não o apaga); sem pedido, null.
      doHospede: l.c.quemCancela === "hospede" || l.c.canal !== null,
      pedidoRecebidoEm: l.c.pedidoRecebidoEm,
      canceladaEm: l.c.canceladaEm,
      devolucao: d && em && l.c.direito === "integral" ? { id: d.id, em } : null,
      pelaDisputa: canceladaPelaDisputa(l.c),
      reservaId: l.c.reservaId,
      codigo: l.codigo,
      checkin: l.checkin,
      checkout: l.checkout,
      origem: l.origem,
      nome: l.nome,
      email: l.email,
      imovel: l.imovel,
      fuso: l.fuso || "America/Sao_Paulo",
      cotacaoId: l.cotacaoId,
      cotacaoCodigo: l.cotacaoCodigo,
      avisados: { pedido: l.c.hospedeAvisadoPedidoEm, decisao: l.c.hospedeAvisadoDecisaoEm, devolucao: l.c.hospedeAvisadoDevolucaoEm },
    };
  });
}

/** "10/10/2026 às 14:10" no horário de Brasília (o que a política conta). */
const dataHoraBrasilia = (d: Date) => {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...o }).format(d);
  return `${f({ day: "2-digit", month: "2-digit", year: "numeric" })} às ${f({ hour: "2-digit", minute: "2-digit" })}`;
};
const dataNoFuso = (d: Date, fuso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

/**
 * Os valores das variáveis para um cancelamento: as da reserva e as do cancelamento (o momento do pedido, a decisão e a
 * devolução pelo mesmo texto da página da reserva, o valor, o dia e o endereço da página no site). Vazio = falta.
 */
async function valoresDoCancelamento(db: Db, organizacaoId: string, a: AlvoCancelamento, empresa: { nome: string; site: string }, textos: TextosSite, agora: Date): Promise<Record<Variavel, string>> {
  return (await dadosDoCancelamento(db, organizacaoId, a, empresa, textos, agora)).valores;
}

/** Os valores das variáveis e se o pagamento foi feito sem a política aceita (o texto-base do pedido recebido muda). */
async function dadosDoCancelamento(db: Db, organizacaoId: string, a: AlvoCancelamento, empresa: { nome: string; site: string }, textos: TextosSite, agora: Date): Promise<{ valores: Record<Variavel, string>; semPolitica: boolean }> {
  const vista = await vistaDaCotacaoParaHospede(db, organizacaoId, a.cotacaoId, agora, { comAutorizacao: false });
  const semPolitica = vista?.cancelamento ? vista.cancelamento.politicaVersao === null : vista?.pedidoCancelamentoSemPolitica === true;
  const texto = vista ? textoDoCancelamento(vista, textos, a.fuso) : null;
  const c = vista?.cancelamento ?? null;
  const devolvido = c?.direito === "integral" ? (c.valorConfirmado ?? c.valor) : null;
  const site = empresa.site.trim().replace(/\/+$/, "");
  const noites = Math.round((Date.parse(a.checkout) - Date.parse(a.checkin)) / 86_400_000);
  const valores: Record<Variavel, string> = {
    hospede: a.nome.trim(),
    imovel: a.imovel.trim(),
    // Uma reserva cancelada nunca recebe o endereço (o modelo é recusado ao ser escolhido).
    endereco: "",
    checkin: dataBr(a.checkin),
    checkout: dataBr(a.checkout),
    noites: String(noites),
    codigo: a.codigo,
    empresa: empresa.nome.trim(),
    recebido: dataHoraBrasilia(a.pedidoRecebidoEm),
    decisao: texto?.decisao ?? "",
    valor: devolvido !== null && devolvido !== undefined ? formatBRL(devolvido) : "",
    data: c?.devolucaoEm ? dataNoFuso(c.devolucaoEm, a.fuso) : "",
    comovolta: texto?.comoVolta ?? "",
    link: site ? `${site}/reservar/${a.cotacaoCodigo}` : "",
    // Só nas mensagens da alteração (recusada nas do cancelamento ao escolher o modelo).
    alteracao: "",
  };
  return { valores, semPolitica };
}

/**
 * A mensagem pronta para copiar: o texto (null quando falta dado), o que falta e se veio do texto-base (sem modelo
 * escolhido, ou com um modelo que não serve para a mensagem: `modeloRecusado` diz por quê).
 */
export type MensagemPronta = { texto: string | null; falta: Variavel[]; textoBase: boolean; modeloRecusado?: string };

/**
 * As mensagens do cancelamento prontas para copiar no painel (M8.2c, botões "Copiar mensagem"): do modelo escolhido para
 * cada mensagem em Configurações → Mensagens ao hóspede ou, sem ele, do texto-base. Montadas na hora (nunca gravadas). null
 * = a mensagem não cabe agora (sem pedido do hóspede, sem decisão, devolução ainda não feita).
 */
export async function mensagensDoCancelamento(db: Db, organizacaoId: string, reservaId: string, agora: Date): Promise<{ recebido: MensagemPronta | null; decidido: MensagemPronta | null; devolvida: MensagemPronta | null }> {
  const vazio = { recebido: null, decidido: null, devolvida: null };
  if (!uuidValido(reservaId)) return vazio;
  const [a] = await alvosDeCancelamento(db, organizacaoId, { reservaId });
  if (!a) return vazio;
  const cfg = await lerConfigMensagens(db, organizacaoId);
  const ids = (["cancelamento_recebido", "cancelamento_decidido", "devolucao_concluida"] as const).map((t) => cfg.modelos[t]).filter((x): x is string => !!x && uuidValido(x));
  const modelos = ids.length ? await db.select().from(modelosMensagem).where(and(eq(modelosMensagem.organizacaoId, organizacaoId), inArray(modelosMensagem.id, ids))) : [];
  const { valores, semPolitica } = await dadosDoCancelamento(db, organizacaoId, a, await lerEmpresa(db, organizacaoId), await lerTextosSite(db, organizacaoId), agora);
  const montar = (tipo: TipoMensagemCancelamento): MensagemPronta => {
    const escolhido = modelos.find((m) => m.id === cfg.modelos[tipo] && m.ativo);
    // A regra de cada mensagem vale também aqui, como no envio automático: um modelo editado depois de escolhido (ex.:
    // {valor} no pedido recebido, que a operação copia sem ver valores) não chega ao botão — fica o texto-base.
    const recusado = escolhido ? problemaDoModeloNoTipo(tipo, escolhido.texto) : null;
    const modelo = recusado ? undefined : escolhido;
    const base = tipo === "cancelamento_recebido" && semPolitica ? TEXTO_BASE_RECEBIDO_SEM_POLITICA : TEXTOS_BASE_CANCELAMENTO[tipo];
    const texto = modelo?.texto ?? base;
    const falta = (variaveisDoTexto(texto) as Variavel[]).filter((v) => Object.hasOwn(valores, v) && !valores[v]);
    return { texto: falta.length ? null : preencherModelo(texto, valores), falta, textoBase: !modelo, ...(recusado ? { modeloRecusado: recusado } : {}) };
  };
  return {
    recebido: prazoDaMensagemDoCancelamento("cancelamento_recebido", a) ? montar("cancelamento_recebido") : null,
    decidido: prazoDaMensagemDoCancelamento("cancelamento_decidido", a) ? montar("cancelamento_decidido") : null,
    devolvida: prazoDaMensagemDoCancelamento("devolucao_concluida", a) ? montar("devolucao_concluida") : null,
  };
}

export type ResultadoMensagens = {
  enviadas: number;
  falhas: number;
  incertas: number;
  /** Mensagens no prazo que não saíram por falta de dado (e o motivo, sem dado pessoal). */
  avisos: string[];
  semProvedor: boolean;
  desligado: boolean;
};

const vazio = (): ResultadoMensagens => ({ enviadas: 0, falhas: 0, incertas: 0, avisos: [], semProvedor: false, desligado: false });

/** Envia as mensagens que estão no prazo (uma organização). */
export async function enviarMensagensHospede(db: Db, organizacaoId: string, correio: Correio | null, agora: Date): Promise<ResultadoMensagens> {
  const res = vazio();
  const cfg = await lerConfigMensagens(db, organizacaoId);
  if (!cfg.ativo || !cfg.ativoDesde) return { ...res, desligado: true };
  const ativoDesde = new Date(cfg.ativoDesde);
  const tipos = TIPOS_MENSAGEM_HOSPEDE.filter((t) => cfg.modelos[t]);
  if (!tipos.length || !cfg.origens.length) return res;
  if (!correio) return { ...res, semProvedor: true };

  const tiposDaReserva = tipos.filter((t) => !ehMensagemDeCancelamento(t) && !ehMensagemDeAlteracao(t));
  const tiposDoCancelamento = tipos.filter(ehMensagemDeCancelamento);
  const tiposDaAlteracao = tipos.filter(ehMensagemDeAlteracao);
  const idsModelos = tipos.map((t) => cfg.modelos[t]!).filter((i) => uuidValido(i));
  const modelos = new Map(
    (idsModelos.length ? await db.select().from(modelosMensagem).where(and(eq(modelosMensagem.organizacaoId, organizacaoId), inArray(modelosMensagem.id, idsModelos))) : []).map((m) => [m.id, m]),
  );
  const hoje = hojeISO(undefined, agora);
  // Candidatas: confirmadas, das origens escolhidas, com alguma mensagem possivelmente no prazo.
  const linhas = await db
    .select({
      id: reservas.id,
      codigo: reservas.codigo,
      checkin: reservas.checkin,
      checkout: reservas.checkout,
      confirmadaEm: reservas.confirmadaEm,
      nome: reservas.hospedeNome,
      email: reservas.hospedeEmail,
      imovel: imoveis.nome,
      fuso: imoveis.fuso,
      endereco: imoveis.endereco,
      complemento: imoveisDetalhes.complemento,
      entradaAPartirDe: imoveisDetalhes.checkinAPartirDe,
      saidaAte: imoveisDetalhes.checkoutAte,
    })
    .from(reservas)
    .innerJoin(imoveis, and(eq(imoveis.id, reservas.imovelId), eq(imoveis.organizacaoId, reservas.organizacaoId)))
    .leftJoin(imoveisDetalhes, eq(imoveisDetalhes.imovelId, imoveis.id))
    .where(
      and(
        eq(reservas.organizacaoId, organizacaoId),
        eq(reservas.estado, "confirmada"),
        inArray(reservas.origem, cfg.origens),
        gte(reservas.checkout, somarDias(hoje, -10)),
        or(lte(reservas.checkin, somarDias(hoje, 3)), and(isNotNull(reservas.confirmadaEm), gte(reservas.confirmadaEm, ativoDesde))),
      ),
    );
  const empresa = linhas.length || tiposDoCancelamento.length || tiposDaAlteracao.length ? await lerEmpresa(db, organizacaoId) : null;
  // M8.2d: a reserva cujas datas de agora são as de uma alteração aplicada já recebeu a confirmação (das datas de antes) e
  // recebe a da alteração: a confirmação da reserva não sai de novo.
  const alteradas = tiposDaReserva.includes("confirmacao") && linhas.length
    ? await db
        .select({ reservaId: alteracoesReserva.reservaId, checkin: alteracoesReserva.checkinDepois, checkout: alteracoesReserva.checkoutDepois })
        .from(alteracoesReserva)
        .where(and(eq(alteracoesReserva.organizacaoId, organizacaoId), eq(alteracoesReserva.situacao, "aplicada"), inArray(alteracoesReserva.reservaId, linhas.map((l) => l.id))))
    : [];

  for (const l of tiposDaReserva.length ? linhas : []) {
    const fuso = l.fuso || "America/Sao_Paulo";
    const prazoDados: DadosPrazo = { checkin: l.checkin, checkout: l.checkout, confirmadaEm: l.confirmadaEm, fuso, entradaAPartirDe: l.entradaAPartirDe ?? "15:00", saidaAte: l.saidaAte ?? "11:00" };
    for (const tipo of tiposDaReserva) {
      const prazo = prazoDaMensagem(tipo, prazoDados);
      // Vale de quando foi ligado em diante; fora do prazo, não manda.
      if (!prazo || prazo.inicio < ativoDesde || agora < prazo.inicio || agora >= prazo.fim) continue;
      if (tipo === "confirmacao" && alteradas.some((x) => x.reservaId === l.id && x.checkin === l.checkin && x.checkout === l.checkout)) continue;
      const [ja] = await db
        .select({ estado: mensagensHospede.estado, tentativas: mensagensHospede.tentativas })
        .from(mensagensHospede)
        .where(and(eq(mensagensHospede.reservaId, l.id), eq(mensagensHospede.tipo, tipo), eq(mensagensHospede.referencia, prazo.referencia)));
      if (ja && !(ja.estado === "falhou" && ja.tentativas < MAX_TENTATIVAS)) continue;

      const aviso = (motivo: string) => res.avisos.push(`${l.codigo} (${NOMES_TIPO[tipo].split(" (")[0].toLowerCase()}): ${motivo}`);
      const modelo = modelos.get(cfg.modelos[tipo]!);
      if (!modelo?.ativo) {
        aviso("o modelo escolhido não existe mais ou está arquivado");
        continue;
      }
      const para = l.email.trim().toLowerCase();
      if (!emailValido(para)) {
        aviso("reserva sem e-mail do hóspede");
        continue;
      }
      const usadas = variaveisDoTexto(modelo.texto) as Variavel[];
      // Modelo editado depois de escolhido para usar uma variável do cancelamento ou da alteração: não manda, avisa (com as
      // mensagens em que ela vale, a mesma frase da escolha do modelo).
      const fora = variaveisForaDoLugar(tipo, modelo.texto);
      if (fora.length) {
        aviso(`o modelo usa {${fora[0]}}, que só vale em ${ondeVale(fora[0])}`);
        continue;
      }
      const liberado = agora >= liberacaoDasInstrucoes(l.checkin, fuso);
      if (usadas.includes("endereco") && !liberado) {
        aviso("o modelo usa {endereco}, que só é enviado 2 dias antes da entrada");
        continue;
      }
      const endereco = [l.endereco.trim(), (l.complemento ?? "").trim()].filter(Boolean).join(" — ");
      const noites = Math.round((Date.parse(l.checkout) - Date.parse(l.checkin)) / 86_400_000);
      const valores: Record<Variavel, string> = {
        hospede: l.nome.trim(),
        imovel: l.imovel.trim(),
        endereco,
        checkin: dataBr(l.checkin),
        checkout: dataBr(l.checkout),
        noites: String(noites),
        codigo: l.codigo,
        empresa: empresa!.nome.trim(),
        // Só nas mensagens do cancelamento e da alteração (recusadas acima nas outras).
        recebido: "",
        decisao: "",
        valor: "",
        data: "",
        comovolta: "",
        link: "",
        alteracao: "",
      };
      const faltando = usadas.filter((v) => !valores[v]);
      if (faltando.length) {
        aviso(`falta ${faltando.map((v) => `{${v}}`).join(", ")} no cadastro`);
        continue;
      }
      await enviarUma(db, organizacaoId, correio, res, { reservaId: l.id, tipo, referencia: prazo.referencia, para, modeloNome: modelo.nome, assunto: `${modelo.nome} — reserva ${l.codigo}`, texto: preencherModelo(modelo.texto, valores) }, agora);
    }
  }

  // Cancelamento de reserva paga pelo site (M8.2c): os candidatos vêm do cancelamento (pedido ou decidido) mexido nos
  // últimos dias, das origens escolhidas.
  if (tiposDoCancelamento.length) {
    const alvos = (await alvosDeCancelamento(db, organizacaoId, { desde: new Date(agora.getTime() - 10 * 24 * 3_600_000) })).filter((a) => cfg.origens.includes(a.origem));
    const textos = alvos.length ? await lerTextosSite(db, organizacaoId) : null;
    for (const a of alvos) {
      let valores: Record<Variavel, string> | null = null;
      for (const tipo of tiposDoCancelamento) {
        const prazo = prazoDaMensagemDoCancelamento(tipo, a);
        if (!prazo || prazo.inicio < ativoDesde || agora < prazo.inicio || agora >= prazo.fim) continue;
        // A equipe já mandou à mão (marcou "mensagem enviada"): não manda de novo.
        if (a.avisados[AVISADO_DO_TIPO[tipo]]) continue;
        const [ja] = await db
          .select({ estado: mensagensHospede.estado, tentativas: mensagensHospede.tentativas })
          .from(mensagensHospede)
          .where(and(eq(mensagensHospede.reservaId, a.reservaId), eq(mensagensHospede.tipo, tipo), eq(mensagensHospede.referencia, prazo.referencia)));
        if (ja && !(ja.estado === "falhou" && ja.tentativas < MAX_TENTATIVAS)) continue;
        const aviso = (motivo: string) => res.avisos.push(`${a.codigo} (${NOMES_TIPO[tipo].toLowerCase()}): ${motivo}`);
        const modelo = modelos.get(cfg.modelos[tipo]!);
        if (!modelo?.ativo) {
          aviso("o modelo escolhido não existe mais ou está arquivado");
          continue;
        }
        const para = a.email.trim().toLowerCase();
        if (!emailValido(para)) {
          aviso("reserva sem e-mail do hóspede");
          continue;
        }
        const problema = problemaDoModeloNoTipo(tipo, modelo.texto);
        if (problema) {
          aviso(problema);
          continue;
        }
        valores ??= await valoresDoCancelamento(db, organizacaoId, a, empresa!, textos!, agora);
        const usadas = variaveisDoTexto(modelo.texto) as Variavel[];
        const faltando = usadas.filter((v) => !valores![v]);
        if (faltando.length) {
          // O que é do cancelamento (o valor, o dia…) não se completa no cadastro: o dado ainda não existe neste caso.
          const doCancelamento = faltando.filter((v) => VARIAVEIS_DO_CANCELAMENTO.includes(v));
          const doCadastro = faltando.filter((v) => !VARIAVEIS_DO_CANCELAMENTO.includes(v));
          aviso([doCadastro.length ? `falta ${doCadastro.map((v) => `{${v}}`).join(", ")} no cadastro` : "", doCancelamento.length ? textoDaFaltaNoCancelamento(doCancelamento) : ""].filter(Boolean).join("; "));
          continue;
        }
        const enviada = await enviarUma(db, organizacaoId, correio, res, { reservaId: a.reservaId, tipo, referencia: prazo.referencia, para, modeloNome: modelo.nome, assunto: `${modelo.nome} — reserva ${a.codigo}`, texto: preencherModelo(modelo.texto, valores) }, agora);
        // Enviada: a marca do cancelamento acende, pelo sistema (o painel para de pedir "avise o hóspede").
        if (enviada) await marcarAvisado(db, organizacaoId, a.cancelamentoId, AVISADO_DO_TIPO[tipo], null, agora);
      }
    }
  }

  // Alteração de reserva paga pelo site (M8.2d): a proposta, a confirmação e a devolução da diferença feita.
  const tiposDeAlteracao: TipoDaAlteracao[] = [...tiposDaAlteracao, ...(tipos.includes("devolucao_concluida") ? (["devolucao_concluida"] as const) : [])];
  if (tiposDeAlteracao.length) {
    const alvos = (await alvosDeAlteracao(db, organizacaoId, { desde: new Date(agora.getTime() - 10 * 24 * 3_600_000) })).filter((a) => cfg.origens.includes(a.origem));
    const textos = alvos.length ? await lerTextosSite(db, organizacaoId) : null;
    for (const a of alvos) {
      const vista = await alteracaoParaMensagem(db, organizacaoId, a.alteracaoId, agora);
      if (!vista) continue;
      for (const tipo of tiposDeAlteracao) {
        const prazo = prazoDaMensagemDaAlteracao(tipo, a, vista);
        if (!prazo || prazo.inicio < ativoDesde || agora < prazo.inicio || agora >= prazo.fim) continue;
        if (a.avisados[AVISADO_DA_ALTERACAO[tipo]]) continue;
        const [ja] = await db
          .select({ estado: mensagensHospede.estado, tentativas: mensagensHospede.tentativas })
          .from(mensagensHospede)
          .where(and(eq(mensagensHospede.reservaId, a.reservaId), eq(mensagensHospede.tipo, tipo), eq(mensagensHospede.referencia, prazo.referencia)));
        if (ja && !(ja.estado === "falhou" && ja.tentativas < MAX_TENTATIVAS)) continue;
        const aviso = (motivo: string) => res.avisos.push(`${a.codigo} (${NOMES_TIPO[tipo].toLowerCase()}): ${motivo}`);
        const modelo = modelos.get(cfg.modelos[tipo]!);
        if (!modelo?.ativo) {
          aviso("o modelo escolhido não existe mais ou está arquivado");
          continue;
        }
        const para = a.email.trim().toLowerCase();
        if (!emailValido(para)) {
          aviso("reserva sem e-mail do hóspede");
          continue;
        }
        const problema = problemaDoModeloNoTipo(tipo, modelo.texto);
        if (problema) {
          aviso(problema);
          continue;
        }
        const valores = valoresDaAlteracao(a, vista, empresa!, textos!);
        const faltando = (variaveisDoTexto(modelo.texto) as Variavel[]).filter((v) => !valores[v]);
        if (faltando.length) {
          aviso(`falta ${faltando.map((v) => `{${v}}`).join(", ")} neste caso`);
          continue;
        }
        const enviada = await enviarUma(db, organizacaoId, correio, res, { reservaId: a.reservaId, tipo, referencia: prazo.referencia, para, modeloNome: modelo.nome, assunto: `${modelo.nome} — reserva ${a.codigo}`, texto: preencherModelo(modelo.texto, valores) }, agora);
        if (enviada) await marcarAvisadoDaAlteracao(db, organizacaoId, a.alteracaoId, AVISADO_DA_ALTERACAO[tipo], null, agora);
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------- alteração de reserva paga pelo site (M8.2d)

/** As mensagens de uma alteração: a proposta, a confirmação e a devolução da diferença feita (com o modelo "Devolução feita"). */
type TipoDaAlteracao = TipoMensagemAlteracao | "devolucao_concluida";
const AVISADO_DA_ALTERACAO: Record<TipoDaAlteracao, MensagemDaAlteracao> = { alteracao_proposta: "proposta", alteracao_confirmada: "confirmacao", devolucao_concluida: "devolucao" };
/** Até quando a confirmação e a devolução feita da alteração ainda fazem sentido. */
const PRAZO_ALTERACAO_MS = 7 * 24 * 3_600_000;

/** Uma alteração com o que as mensagens dela precisam (nunca gravado: o nome e o e-mail são lidos da reserva agora). */
type AlvoAlteracao = {
  alteracaoId: string;
  reservaId: string;
  codigo: string;
  checkin: string;
  checkout: string;
  origem: OrigemReserva;
  nome: string;
  email: string;
  imovel: string;
  fuso: string;
  cotacaoCodigo: string;
  /** Quando o pedido da alteração chegou (a variável `{recebido}`, como no cancelamento); null na prévia, antes de gravar. */
  pedidoRecebidoEm: Date | null;
  /** A devolução da diferença feita mais recente (a referência da mensagem), quando todas estão feitas. */
  ultimaDevolucaoId: string | null;
  /**
   * A reserva foi cancelada depois da alteração: só a devolução da diferença que continuou (o cancelamento sem devolução
   * não a absorve) ainda tem mensagem; a proposta e a confirmação, não.
   */
  reservaCancelada: boolean;
  avisados: Record<MensagemDaAlteracao, Date | null>;
};

async function alvosDeAlteracao(db: Db, organizacaoId: string, f: { alteracaoId?: string; desde?: Date }): Promise<AlvoAlteracao[]> {
  const linhas = await db
    .select({
      a: alteracoesReserva,
      codigo: reservas.codigo,
      estado: reservas.estado,
      checkin: reservas.checkin,
      checkout: reservas.checkout,
      origem: reservas.origem,
      nome: reservas.hospedeNome,
      email: reservas.hospedeEmail,
      imovel: imoveis.nome,
      fuso: imoveis.fuso,
      cotacaoCodigo: cotacoes.codigo,
    })
    .from(alteracoesReserva)
    .innerJoin(reservas, and(eq(reservas.id, alteracoesReserva.reservaId), eq(reservas.organizacaoId, alteracoesReserva.organizacaoId)))
    .innerJoin(imoveis, eq(imoveis.id, reservas.imovelId))
    .innerJoin(cotacoes, eq(cotacoes.id, alteracoesReserva.cotacaoId))
    .where(
      and(
        eq(alteracoesReserva.organizacaoId, organizacaoId),
        or(
          eq(reservas.estado, "confirmada"),
          // Cancelada depois de uma redução aplicada: a devolução da diferença que continuou ainda é avisada quando sair.
          and(
            eq(reservas.estado, "cancelada"),
            eq(alteracoesReserva.situacao, "aplicada"),
            sql`exists (select 1 from ${devolucoesPagamento} d where d.alteracao_id = ${alteracoesReserva.id} and d.situacao <> 'substituida')`,
          ),
        ),
        f.alteracaoId ? eq(alteracoesReserva.id, f.alteracaoId) : undefined,
        // A recente: segurada, mexida ou aplicada desde então, ou com uma devolução da diferença feita desde então (a
        // devolução que esperou a liberação do Mercado Pago sai dias depois da aplicação).
        f.desde
          ? or(
              eq(alteracoesReserva.situacao, "segurada"),
              gte(alteracoesReserva.atualizadoEm, f.desde),
              gte(alteracoesReserva.aplicadaEm, f.desde),
              sql`exists (select 1 from ${devolucoesPagamento} d where d.alteracao_id = ${alteracoesReserva.id} and (d.confirmada_em >= ${f.desde.toISOString()}::timestamptz or d.por_fora_data >= ${hojeISO("America/Sao_Paulo", f.desde)}::date))`,
            )
          : undefined,
      ),
    );
  if (!linhas.length) return [];
  const devs = await db
    .select({ id: devolucoesPagamento.id, alteracaoId: devolucoesPagamento.alteracaoId, situacao: devolucoesPagamento.situacao, confirmadaEm: devolucoesPagamento.confirmadaEm, porForaData: devolucoesPagamento.porForaData })
    .from(devolucoesPagamento)
    .where(inArray(devolucoesPagamento.alteracaoId, linhas.map((l) => l.a.id)));
  return linhas.map((l) => {
    const daAlteracao = devs.filter((d) => d.alteracaoId === l.a.id && d.situacao !== "substituida");
    const quando = (d: (typeof devs)[number]) => (d.situacao === "confirmada" ? d.confirmadaEm : d.situacao === "por_fora" && d.porForaData ? instanteLocal(d.porForaData, "12:00", "America/Sao_Paulo") : null);
    const feitas = daAlteracao.map((d) => ({ d, em: quando(d) }));
    const ultima = feitas.length && feitas.every((x) => x.em) ? feitas.sort((x, y) => x.em!.getTime() - y.em!.getTime()).at(-1)! : null;
    return {
      alteracaoId: l.a.id,
      reservaId: l.a.reservaId,
      codigo: l.codigo,
      checkin: l.checkin,
      checkout: l.checkout,
      origem: l.origem,
      nome: l.nome,
      email: l.email,
      imovel: l.imovel,
      fuso: l.fuso || "America/Sao_Paulo",
      cotacaoCodigo: l.cotacaoCodigo,
      pedidoRecebidoEm: l.a.pedidoRecebidoEm,
      ultimaDevolucaoId: ultima?.d.id ?? null,
      reservaCancelada: l.estado === "cancelada",
      avisados: { proposta: l.a.hospedeAvisadoPropostaEm, confirmacao: l.a.hospedeAvisadoConfirmacaoEm, devolucao: l.a.hospedeAvisadoDevolucaoEm },
    };
  });
}

/**
 * As alterações com mensagem ao hóspede pendente (para o aviso do Início): a proposta enquanto as datas estão seguradas, a
 * confirmação e a devolução da diferença feita nos prazos delas (os mesmos do envio automático), sem a marca de "mensagem
 * enviada". `desde`: o começo do prazo da mais antiga pendente (o aviso fica em atenção depois de um tempo).
 */
export async function alteracoesComMensagemPendente(db: Db, organizacaoId: string, agora: Date): Promise<{ alteracaoId: string; reservaId: string; codigo: string; desde: Date }[]> {
  const alvos = await alvosDeAlteracao(db, organizacaoId, { desde: new Date(agora.getTime() - 10 * 24 * 3_600_000) });
  const pendentes: { alteracaoId: string; reservaId: string; codigo: string; desde: Date }[] = [];
  for (const a of alvos) {
    const vista = await alteracaoParaMensagem(db, organizacaoId, a.alteracaoId, agora);
    if (!vista) continue;
    const desde = (Object.keys(AVISADO_DA_ALTERACAO) as TipoDaAlteracao[])
      .map((tipo) => (a.avisados[AVISADO_DA_ALTERACAO[tipo]] ? null : prazoDaMensagemDaAlteracao(tipo, a, vista)))
      .filter((p): p is NonNullable<typeof p> => !!p && p.inicio.getTime() <= agora.getTime() && agora.getTime() < p.fim.getTime())
      .map((p) => p.inicio.getTime());
    if (desde.length) pendentes.push({ alteracaoId: a.alteracaoId, reservaId: a.reservaId, codigo: a.codigo, desde: new Date(Math.min(...desde)) });
  }
  return pendentes.sort((x, y) => (x.codigo < y.codigo ? -1 : x.codigo > y.codigo ? 1 : 0));
}

/**
 * Quando cada mensagem da alteração pode sair: a proposta enquanto as datas estão seguradas (da preparação até o prazo); a
 * confirmação da aplicação até 7 dias depois; a devolução da diferença feita, dela até 7 dias depois. `referencia`: a
 * alteração (proposta e confirmação) ou a última devolução dela.
 */
export function prazoDaMensagemDaAlteracao(
  tipo: TipoDaAlteracao,
  a: Pick<AlvoAlteracao, "alteracaoId" | "ultimaDevolucaoId"> & Partial<Pick<AlvoAlteracao, "reservaCancelada">>,
  v: AlteracaoParaHospede,
): { inicio: Date; fim: Date; referencia: string } | null {
  switch (tipo) {
    case "alteracao_proposta":
      return v.situacao === "segurada" && v.holdAte && !a.reservaCancelada ? { inicio: v.preparadaEm, fim: v.holdAte, referencia: a.alteracaoId } : null;
    case "alteracao_confirmada":
      return v.situacao === "aplicada" && v.aplicadaEm && !a.reservaCancelada ? { inicio: v.aplicadaEm, fim: new Date(v.aplicadaEm.getTime() + PRAZO_ALTERACAO_MS), referencia: a.alteracaoId } : null;
    case "devolucao_concluida":
      return v.situacao === "aplicada" && v.devolucao?.estado === "feita" && v.devolucao.em && a.ultimaDevolucaoId
        ? { inicio: v.devolucao.em, fim: new Date(v.devolucao.em.getTime() + PRAZO_ALTERACAO_MS), referencia: a.ultimaDevolucaoId }
        : null;
  }
}

/** Os valores das variáveis para uma alteração: as da reserva e as da alteração (`{alteracao}` e, na devolução feita, o valor, o dia e como volta). */
function valoresDaAlteracao(a: AlvoAlteracao, v: AlteracaoParaHospede, empresa: { nome: string; site: string }, textos: TextosSite): Record<Variavel, string> {
  const texto = textoDaAlteracao(v, textos, a.codigo, a.fuso);
  const site = empresa.site.trim().replace(/\/+$/, "");
  const noites = Math.round((Date.parse(a.checkout) - Date.parse(a.checkin)) / 86_400_000);
  const d = v.devolucao?.estado === "feita" ? v.devolucao : null;
  return {
    hospede: a.nome.trim(),
    imovel: a.imovel.trim(),
    // A alteração é preparada antes da entrada, quase sempre antes da liberação do endereço (o modelo é recusado ao ser escolhido).
    endereco: "",
    checkin: dataBr(a.checkin),
    checkout: dataBr(a.checkout),
    noites: String(noites),
    codigo: a.codigo,
    empresa: empresa.nome.trim(),
    // O momento do pedido da alteração: o modelo "Devolução feita" serve ao cancelamento e à alteração, e o {recebido} vale nos dois.
    recebido: a.pedidoRecebidoEm ? dataHoraBrasilia(a.pedidoRecebidoEm) : "",
    decisao: "",
    valor: d ? formatBRL(d.valorConfirmado ?? d.valor) : "",
    data: d?.em ? dataNoFuso(d.em, a.fuso) : "",
    comovolta: d ? (texto.comoVolta ?? "") : "",
    link: site ? `${site}/reservar/${a.cotacaoCodigo}` : "",
    alteracao: texto.resumo,
  };
}

/**
 * As mensagens de uma alteração prontas para copiar no painel (M8.2d, botões "Copiar a proposta", "Copiar mensagem:
 * alteração confirmada" e "Copiar mensagem: devolução feita"): do modelo escolhido para cada mensagem ou, sem ele, do
 * texto-base. Montadas na hora (nunca gravadas). null = a mensagem não cabe agora.
 */
export async function mensagensDaAlteracao(db: Db, organizacaoId: string, alteracaoId: string, agora: Date): Promise<{ proposta: MensagemPronta | null; confirmada: MensagemPronta | null; devolvida: MensagemPronta | null }> {
  const vazio = { proposta: null, confirmada: null, devolvida: null };
  if (!uuidValido(alteracaoId)) return vazio;
  const [a] = await alvosDeAlteracao(db, organizacaoId, { alteracaoId });
  const v = a ? await alteracaoParaMensagem(db, organizacaoId, alteracaoId, agora) : null;
  if (!a || !v) return vazio;
  const cfg = await lerConfigMensagens(db, organizacaoId);
  const ids = (["alteracao_proposta", "alteracao_confirmada", "devolucao_concluida"] as const).map((t) => cfg.modelos[t]).filter((x): x is string => !!x && uuidValido(x));
  const modelos = ids.length ? await db.select().from(modelosMensagem).where(and(eq(modelosMensagem.organizacaoId, organizacaoId), inArray(modelosMensagem.id, ids))) : [];
  const valores = valoresDaAlteracao(a, v, await lerEmpresa(db, organizacaoId), await lerTextosSite(db, organizacaoId));
  const montar = (tipo: TipoDaAlteracao): MensagemPronta => {
    const escolhido = modelos.find((m) => m.id === cfg.modelos[tipo] && m.ativo);
    const recusado = escolhido ? problemaDoModeloNoTipo(tipo, escolhido.texto) : null;
    const modelo = recusado ? undefined : escolhido;
    const texto = modelo?.texto ?? (tipo === "devolucao_concluida" ? TEXTOS_BASE_CANCELAMENTO.devolucao_concluida : TEXTOS_BASE_ALTERACAO[tipo]);
    const falta = (variaveisDoTexto(texto) as Variavel[]).filter((x) => Object.hasOwn(valores, x) && !valores[x]);
    return { texto: falta.length ? null : preencherModelo(texto, valores), falta, textoBase: !modelo, ...(recusado ? { modeloRecusado: recusado } : {}) };
  };
  return {
    // A proposta pode ser copiada de novo enquanto a alteração vale (segurada); a confirmação e a devolução, nos prazos delas.
    // Na reserva cancelada depois, só a devolução da diferença (a proposta e a confirmação não valem mais).
    proposta: v.situacao === "segurada" && !a.reservaCancelada ? montar("alteracao_proposta") : null,
    confirmada: v.situacao === "aplicada" && !a.reservaCancelada ? montar("alteracao_confirmada") : null,
    devolvida: prazoDaMensagemDaAlteracao("devolucao_concluida", a, v) || (v.situacao === "aplicada" && v.devolucao?.estado === "feita") ? montar("devolucao_concluida") : null,
  };
}

/**
 * A proposta pronta para copiar a partir da prévia (o cartão da prévia no painel, antes de a alteração existir): o texto
 * da alteração como ficaria segurada agora, pelo modelo escolhido ou pelo texto-base.
 */
export async function propostaDaPrevia(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  v: Omit<AlteracaoParaHospede, "id" | "situacao" | "devolucao" | "pagoSemAlteracao" | "pagamento" | "aplicadaEm"> & { holdAte: Date },
): Promise<MensagemPronta | null> {
  if (!uuidValido(reservaId)) return null;
  const [r] = await db
    .select({ codigo: reservas.codigo, checkin: reservas.checkin, checkout: reservas.checkout, origem: reservas.origem, nome: reservas.hospedeNome, email: reservas.hospedeEmail, imovel: imoveis.nome, fuso: imoveis.fuso, cotacaoCodigo: cotacoes.codigo })
    .from(reservas)
    .innerJoin(imoveis, eq(imoveis.id, reservas.imovelId))
    .innerJoin(cotacoes, eq(cotacoes.reservaId, reservas.id))
    .where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)));
  if (!r) return null;
  const alvo: AlvoAlteracao = { ...r, alteracaoId: "", reservaId, fuso: r.fuso || "America/Sao_Paulo", pedidoRecebidoEm: null, ultimaDevolucaoId: null, reservaCancelada: false, avisados: { proposta: null, confirmacao: null, devolucao: null } };
  const vista: AlteracaoParaHospede = { ...v, id: "", situacao: "segurada", aplicadaEm: null, devolucao: null, pagoSemAlteracao: null, pagamento: null };
  const cfg = await lerConfigMensagens(db, organizacaoId);
  const id = cfg.modelos.alteracao_proposta;
  const [escolhido] = id && uuidValido(id) ? await db.select().from(modelosMensagem).where(and(eq(modelosMensagem.organizacaoId, organizacaoId), eq(modelosMensagem.id, id))) : [];
  const recusado = escolhido?.ativo ? problemaDoModeloNoTipo("alteracao_proposta", escolhido.texto) : null;
  const modelo = escolhido?.ativo && !recusado ? escolhido : undefined;
  const texto = modelo?.texto ?? TEXTOS_BASE_ALTERACAO.alteracao_proposta;
  const valores = valoresDaAlteracao(alvo, vista, await lerEmpresa(db, organizacaoId), await lerTextosSite(db, organizacaoId));
  const falta = (variaveisDoTexto(texto) as Variavel[]).filter((x) => Object.hasOwn(valores, x) && !valores[x]);
  return { texto: falta.length ? null : preencherModelo(texto, valores), falta, textoBase: !modelo, ...(recusado ? { modeloRecusado: recusado } : {}) };
}

/**
 * Uma mensagem: marca antes de chamar o provedor (outra execução ao mesmo tempo não manda de novo), envia e registra o
 * resultado. true = o provedor aceitou.
 */
async function enviarUma(
  db: Db,
  organizacaoId: string,
  correio: Correio,
  res: ResultadoMensagens,
  m: { reservaId: string; tipo: TipoMensagemHospede; referencia: string; para: string; modeloNome: string; assunto: string; texto: string },
  agora: Date,
): Promise<boolean> {
  const [marca] = await db
    .insert(mensagensHospede)
    .values({ organizacaoId, reservaId: m.reservaId, tipo: m.tipo, referencia: m.referencia, estado: "enviando", para: m.para, modeloNome: m.modeloNome, criadoEm: agora, atualizadoEm: agora })
    .onConflictDoUpdate({
      target: [mensagensHospede.reservaId, mensagensHospede.tipo, mensagensHospede.referencia],
      set: { estado: "enviando", tentativas: sql`${mensagensHospede.tentativas} + 1`, para: m.para, modeloNome: m.modeloNome, erro: "", atualizadoEm: agora },
      setWhere: and(eq(mensagensHospede.estado, "falhou"), sql`${mensagensHospede.tentativas} < ${MAX_TENTATIVAS}`),
    })
    .returning({ id: mensagensHospede.id, tentativas: mensagensHospede.tentativas });
  if (!marca) return false;
  let falha: unknown = null;
  try {
    await correio.enviar({ para: m.para, assunto: m.assunto, texto: m.texto, chave: `mensagem-hospede:${marca.id}:${marca.tentativas}` });
  } catch (e) {
    falha = e ?? new Error("falha no envio");
  }
  if (falha === null) {
    // Se gravar o sucesso falhar, o registro fica "enviando" (aparece como incerto) e nunca é
    // tentado de novo: o provedor já aceitou.
    await db.update(mensagensHospede).set({ estado: "enviado", enviadoEm: new Date(), atualizadoEm: new Date() }).where(eq(mensagensHospede.id, marca.id));
    res.enviadas++;
    return true;
  }
  const incerto = falha instanceof ErroEnvioIncerto;
  const erro = (falha instanceof Error ? falha.message : String(falha)).slice(0, 300);
  await db.update(mensagensHospede).set({ estado: incerto ? "incerto" : "falhou", erro, atualizadoEm: new Date() }).where(eq(mensagensHospede.id, marca.id));
  if (incerto) res.incertas++;
  else res.falhas++;
  return false;
}

/**
 * Resumo de uma execução. `detalhes`: com os códigos das reservas não enviadas — só para a tela da
 * própria organização; o registro geral (página Sistema) leva só as contagens.
 */
export function resumoMensagens(r: ResultadoMensagens, detalhes = true): string {
  if (r.desligado) return "desligado";
  if (r.semProvedor) return "sem provedor de e-mail configurado";
  const partes = [`${r.enviadas} enviada(s)`];
  if (r.falhas) partes.push(`${r.falhas} recusada(s) pelo provedor`);
  if (r.incertas) partes.push(`${r.incertas} sem confirmação do provedor`);
  if (r.avisos.length)
    partes.push(
      detalhes
        ? `${r.avisos.length} não enviada(s): ${r.avisos.slice(0, 5).join("; ")}${r.avisos.length > 5 ? "…" : ""}`
        : `${r.avisos.length} não enviada(s) por falta de dado (detalhes em Configurações → Modelos de mensagem)`,
    );
  return partes.join(", ");
}

const chaveUltima = (organizacaoId: string) => `mensagens-hospede:ultima:${organizacaoId}`;

/** Guarda o resultado da última execução desta organização (com os detalhes dela). */
export async function registrarUltimaExecucao(db: Db, organizacaoId: string, agora: Date, resumo: string, ok: boolean): Promise<void> {
  const value = { quando: agora.toISOString(), resumo: resumo.slice(0, 2000), ok };
  await db.insert(appSettings).values({ key: chaveUltima(organizacaoId), value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function ultimaExecucaoDaOrganizacao(db: Db, organizacaoId: string): Promise<{ quando: Date; resumo: string; ok: boolean } | null> {
  const [l] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, chaveUltima(organizacaoId)));
  const v = l?.value as { quando?: unknown; resumo?: unknown; ok?: unknown } | undefined;
  if (!v || typeof v.quando !== "string" || typeof v.resumo !== "string") return null;
  return { quando: new Date(v.quando), resumo: v.resumo, ok: v.ok === true };
}

export type EnvioListado = {
  id: string;
  codigo: string;
  reservaId: string;
  tipo: TipoMensagemHospede;
  estado: "enviado" | "falhou" | "incerto" | "enviando";
  tentativas: number;
  modeloNome: string;
  erro: string;
  quando: Date;
};

/** Últimos envios para a tela (o "enviando" antigo aparece como incerto). */
export async function ultimosEnvios(db: Db, organizacaoId: string, agora: Date, limite = 30): Promise<EnvioListado[]> {
  const linhas = await db
    .select({
      id: mensagensHospede.id,
      codigo: reservas.codigo,
      reservaId: mensagensHospede.reservaId,
      tipo: mensagensHospede.tipo,
      estado: mensagensHospede.estado,
      tentativas: mensagensHospede.tentativas,
      modeloNome: mensagensHospede.modeloNome,
      erro: mensagensHospede.erro,
      quando: mensagensHospede.atualizadoEm,
    })
    .from(mensagensHospede)
    .innerJoin(reservas, eq(reservas.id, mensagensHospede.reservaId))
    .where(eq(mensagensHospede.organizacaoId, organizacaoId))
    .orderBy(desc(mensagensHospede.atualizadoEm))
    .limit(limite);
  return linhas.map((l) => ({ ...l, estado: l.estado === "enviando" && agora.getTime() - l.quando.getTime() > ENVIANDO_INCERTO_MS ? "incerto" : l.estado }));
}
