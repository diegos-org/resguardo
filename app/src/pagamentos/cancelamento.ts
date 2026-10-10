/**
 * Cancelamento de reserva paga pelo site, pela política (M8.2c; desenho §5.4).
 *
 * Quem decide é a Política de cancelamento na versão aceita pelo hóspede ao pagar (`decidirPelaPolitica`), no momento em
 * que a SCL recebeu o pedido: devolução integral ou nada (a devolução de parte do valor é do M8.2d). A equipe só escolhe
 * onde a política não decide: a exceção (integral quando a política não dá nada, com motivo da lista e nota) e o caso sem
 * política (pagamento sem o aceite). Um direito integral nunca vira "nada": o não comparecimento é recusado com um pedido
 * ativo, e o pedido do hóspede que chega depois do início da estadia sem direito a devolução é saída antecipada, não
 * cancelamento.
 *
 * Três fases:
 * - **Fase 0** (sem trava): releitura forçada do pagamento no Mercado Pago, quando dá. Uma decisão integral de um pagamento
 *   ainda dentro do prazo de leitura exige que essa leitura tenha sido aplicada (`sem_leitura` sem ela).
 * - **Fase 1** (uma transação): trava a cotação (imóvel → reserva → cotação → tentativas → devoluções → cancelamento), depois
 *   o motor da reserva, e só então decide (`montarDecisao`, a mesma da prévia) e confere a assinatura da prévia. Grava o
 *   cancelamento, a reserva e a cotação canceladas, o resultado no livro (`acertarResultado`) e a devolução (pedida, fora do
 *   prazo, já devolvida ou nenhuma). Trava ocupada (55P03, 40P01) responde "ocupado": nada foi pedido ao provedor.
 * - **Fase 2** (fora da transação): o pedido da devolução ao Mercado Pago (`tentarDevolucao`); a rotina e o "Conferir
 *   agora" o retomam se falhar aqui.
 *
 * O pedido (do hóspede em Minha reserva, com o horário do servidor travado; ou registrado pela equipe), o descarte, a
 * marca das OTAs e a de "mensagem enviada ao hóspede" também moram aqui. Nenhuma nota guarda dado pessoal
 * (`textoSemDadosPessoais`); a auditoria nunca copia notas nem nomes.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lerConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { DIAS_ARREPENDIMENTO, type DecisaoPolitica, decidirPelaPolitica, HORA_ENTRADA_PADRAO, horaDeEntrada, type QuemCancela, regrasComPadrao } from "@/configuracoes/politica-cancelamento";
import { travaOcupada, violouUnicidade } from "@/db/erros";
import {
  type BaseCancelamento,
  CANAIS_PEDIDO_CANCELAMENTO,
  cancelamentosReserva,
  type CanalPedidoCancelamento,
  cotacoes,
  devolucoesPagamento,
  imoveisDetalhes,
  lancamentos,
  MOTIVOS_CANCELAMENTO_EMPRESA,
  MOTIVOS_EXCECAO,
  type MotivoCancelamentoEmpresa,
  type MotivoExcecao,
  pagamentos,
  QUEM_CANCELA_RESERVA,
  reservas,
  type SituacaoDevolucao,
  type SituacaoPagamento,
  usuarios,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { travarMotorDaReserva } from "@/financeiro/trava";
import { ERRO_DADOS_PESSOAIS, textoSemDadosPessoais } from "@/lib/dados-pessoais";
import { hojeISO, instanteLocal } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { formatBRL } from "@/lib/money";
import { repasseAPagarDaReservaDados } from "@/repasses/recebimentos";
import { avisoDoPagamento } from "@/reservas/repositorio";
import { politicaDoPagamento } from "@/site/aceites";
import { acertarCaixa, acertarResultado, auditoriaDoDevolvido, fatoDoDevolvidoNoPainel, lancamentosDoMotor } from "./acerto-cancelamento";
import { inicioDoPrazoDePedirDevolucao, inicioDoPrazoDeReleitura } from "./andamento";
import { conferirTentativa } from "./conferencia";
import { PRAZO_DEVOLUCAO_CARTAO_DIAS, tentarDevolucao } from "./devolucao";
import { FUSO_PAGAMENTO } from "./liberacao";
import { type ProvedorPagamento, valorPagoNaOrder } from "./provedor";
import { type CodigoAviso, emAndamento, NOMES_SITUACAO_PAGAMENTO } from "./situacoes";
import { type Cancelamento, type Devolucao, lerCotacaoSemTravar, type Pagamento, type Travado, travarCotacao } from "./travas";

export type EntradaCancelamento = {
  /** Sem pedido registrado: obrigatório. Pedido da equipe: o registrado, ou um novo com `motivoMomento`. Pedido pelo site: ignorado (travado). */
  recebidoEm: Date | null;
  /** Obrigatório (1..300) quando muda o momento registrado pela equipe. */
  motivoMomento: string;
  canal: CanalPedidoCancelamento | null;
  quemCancela: QuemCancela;
  motivoEmpresa: MotivoCancelamentoEmpresa | null;
  /** "politica" = o calculado; "excecao" = integral quando a política dá nenhum; "integral"/"nenhum" só sem política. */
  decisao: "politica" | "excecao" | "integral" | "nenhum";
  /** Obrigatório na exceção. */
  motivoExcecao: MotivoExcecao | null;
  /** Obrigatório na exceção e sem política (1..300). */
  motivoDecisao: string;
  /** 0..300 */
  nota: string;
};

export type CodigoRecusaCancelamento =
  | "nao_encontrada"
  | "nao_paga_pelo_site"
  | "ja_cancelada"
  | "em_andamento"
  | "devolvido_em_parte"
  | "contestado"
  | "sem_leitura"
  | "repasse_a_pagar"
  | "estadia_encerrada"
  | "estadia_iniciada"
  | "ha_pedido"
  | "dados"
  | "decisao_obrigatoria"
  | "integral_nao_se_nega"
  | "cedo_para_nao_comparecimento"
  | "previa_mudou"
  | "ocupado";

/** Como a devolução sai: pedida ao Mercado Pago agora; pelo painel dele ou por fora (pagamento com mais de 78 dias); já devolvida; nenhuma. */
export type RotaDevolucao = "pedida" | "fora_do_prazo" | "ja_devolvida" | "nenhuma";

export type Previa = {
  decisao: DecisaoPolitica;
  direito: "integral" | "nenhum";
  base: BaseCancelamento;
  rota: RotaDevolucao;
  valorPago: number;
  valorADevolver: number;
  valorRetido: number;
  /** O momento que a política conta, o canal e a política aceita (versão e data da publicação). */
  recebidoEm: Date;
  canal: CanalPedidoCancelamento | null;
  politica: { versao: number; data: string; diasReembolsoIntegral: number; arrependimentoAteEntrada: boolean } | null;
  componentes: {
    comissao: number;
    parteProprietario: number;
    taxa: number | null;
    /** Partes já pagas (repasse pago, ou realizada à mão): entram como desconto no próximo repasse. */
    jaRepassada: { lancamentoId: string; valor: number; repasseId: string; repasse: string; pagoEm: string }[];
    /** O que o proprietário teria pela política (retenção) e deixa de receber (exceção / SCL cancela). */
    perdaDoProprietario: number;
    /** Ajustes (M4.5) ligados à reserva: não são mexidos. */
    ajustes: { id: string; descricao: string; valor: number }[];
  };
  leitura: { em: Date | null; situacao: SituacaoPagamento; devolvidoLido: number; emAndamento: boolean };
  descartados: { em: Date; canal: CanalPedidoCancelamento | null; por: string | null; motivo: string }[];
  avisos: string[];
  assinatura: string;
  /** O texto do BotaoConfirmar. */
  pergunta: string;
};

/**
 * O que a equipe pode escolher onde a política não decide: a exceção (devolver tudo quando a política não dá nada) ou,
 * sem política aceita, devolver tudo ou não devolver; null = nada a escolher (a política dá o integral).
 */
export type EscolhaDaEquipe = "excecao" | "sem_politica";
export const escolhaDaEquipe = (calculado: DecisaoPolitica["calculado"]): EscolhaDaEquipe | null =>
  calculado === "sem_politica" ? "sem_politica" : calculado === "nenhum" ? "excecao" : null;

/**
 * Uma recusa. `escolha` vem nas recusas de depois da decisão pela política (a tela oferece a exceção, ou a escolha sem
 * política, também quando a recusa chega antes de uma prévia: saída antecipada, pagamento já devolvido no painel do
 * Mercado Pago); sem ela, a recusa veio antes de decidir.
 */
type Recusa = { ok: false; codigo: CodigoRecusaCancelamento; erro: string; escolha?: EscolhaDaEquipe | null };
const recusa = (codigo: CodigoRecusaCancelamento, erro: string): Recusa => ({ ok: false, codigo, erro });

export const TEXTO_PREVIA_MUDOU = "O cálculo mudou desde a prévia (pagamento, pedido, repasse ou leitura do Mercado Pago mudaram): calcule de novo antes de cancelar.";
export const TEXTO_OCUPADO = "Muitas mudanças nesta reserva agora: tente de novo em instantes.";
export const TEXTO_SEM_LEITURA = "Não deu para conferir o pagamento no Mercado Pago agora: tente de novo em instantes. O horário do pedido já está registrado e não muda.";
export const TEXTO_SEM_POLITICA = "Este pagamento foi feito sem o aceite das páginas legais (antes de 9/10): o sistema não calcula a devolução. Escolha o que fazer e escreva o motivo.";
export const TEXTO_INTEGRAL_NAO_SE_NEGA = "Pela política aceita, o hóspede tem direito ao valor integral: a equipe não decide outra coisa.";
export const TEXTO_DEVOLVIDO_EM_PARTE =
  "O Mercado Pago mostra parte deste pagamento devolvida, uma devolução em andamento ou uma situação que o sistema não reconhece: o cancelamento pela política espera isso se resolver. Confira no painel do Mercado Pago e use Conferir agora; a devolução de parte do valor chega com o M8.2d.";
export const TEXTO_CONTESTADO = "Pagamento contestado no Mercado Pago: o cancelamento espera a contestação (M8.2e).";
export const TEXTO_MOMENTO = "Informe quando o pedido chegou (não pode ser no futuro nem antes do pagamento).";

/** A base da decisão, em palavras (painel; nunca vai ao hóspede assim). */
export const NOMES_BASE_CANCELAMENTO: Record<BaseCancelamento, string> = {
  prazo: "pedido dentro do prazo de reembolso integral",
  arrependimento: `direito de arrependimento (${DIAS_ARREPENDIMENTO} dias)`,
  empresa: "a SCL cancela",
  excecao: "exceção",
  sem_politica: "pagamento sem a política aceita",
  fora_do_prazo: "pedido depois do prazo de reembolso integral",
  estadia_iniciada: "pedido depois do início da estadia",
  nao_comparecimento: "não comparecimento",
};
export const NOMES_CANAL_PEDIDO: Record<CanalPedidoCancelamento, string> = { site: "pelo hóspede, no site", whatsapp: "WhatsApp", email: "E-mail", telefone: "Telefone", presencial: "Pessoalmente", outro: "Outro" };
export const NOMES_MOTIVO_EXCECAO: Record<MotivoExcecao, string> = { erro_da_scl: "Erro da SCL", forca_maior: "Força maior", cortesia_comercial: "Cortesia comercial", saude_ou_familia: "Saúde ou família", outro: "Outro" };
export const NOMES_MOTIVO_EMPRESA: Record<MotivoCancelamentoEmpresa, string> = { imovel_sem_condicoes: "o apartamento ficou sem condições de receber o hóspede", forca_maior: "força maior", outro: "outro motivo" };

const LIMITE_NOTA = 300;
/** Folga do relógio para o momento do pedido informado à mão (o formulário manda só a hora e o minuto). */
const FOLGA_MOMENTO_MS = 59_000;
/** Um pedido registrado mais de 48 h depois de chegar pede conferência. */
const REGISTRO_TARDIO_MS = 48 * 3_600_000;

const fmt = (d: Date, fuso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, ...o }).format(d);
/** "dd/mm" no fuso. */
export const diaBr = (d: Date, fuso = FUSO_PAGAMENTO) => fmt(d, fuso, { day: "2-digit", month: "2-digit" });
/** "dd/mm às HH:MM" no fuso. */
export const diaHoraBr = (d: Date, fuso = FUSO_PAGAMENTO) => `${diaBr(d, fuso)} às ${fmt(d, fuso, { hour: "2-digit", minute: "2-digit" })}`;
const dataIsoBr = (d: string) => d.slice(0, 10).split("-").reverse().slice(0, 2).join("/");
const minuto = (d: Date) => Math.floor(d.getTime() / 60_000);
const emVigor = () => and(isNull(lancamentos.estornoDe), sql`not exists (select 1 from ${lancamentos} e where e.estorno_de = ${lancamentos.id})`);

/** O pagamento que confirmou a reserva (desfecho "reserva") e a cotação dele: uma leitura, sem trava. */
async function localizar(db: Db, organizacaoId: string, reservaId: string) {
  if (!uuidValido(reservaId)) return null;
  const [r] = await db.select({ id: reservas.id, estado: reservas.estado }).from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, organizacaoId)));
  if (!r) return null;
  const [p] = await db
    .select({ id: pagamentos.id, cotacaoId: pagamentos.cotacaoId, idProvedor: pagamentos.idProvedor, criadoEm: pagamentos.criadoEm })
    .from(pagamentos)
    .where(and(eq(pagamentos.reservaId, r.id), eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.desfecho, "reserva")));
  return { reserva: r, pagamento: p ?? null };
}

const NAO_PAGA = 'Esta reserva não foi paga pelo site: cancele pelo botão "Cancelar reserva" de sempre.';

/**
 * Fase 0 (e a releitura da prévia): lê o pagamento de novo no Mercado Pago, forçado, quando ainda dá (dentro do prazo de
 * leitura). true = uma leitura que bateu com a tentativa foi aplicada agora.
 */
async function releitura(db: Db, organizacaoId: string, p: { id: string; idProvedor: string | null; criadoEm: Date }, provedor: ProvedorPagamento | null, agora: Date): Promise<boolean> {
  if (!provedor || !p.idProvedor || p.criadoEm.getTime() < inicioDoPrazoDeReleitura(agora).getTime()) return false;
  try {
    const r = await conferirTentativa(db, organizacaoId, p.id, provedor, agora, { forcar: true, origem: "painel" });
    return r.ok && r.aplicada === true;
  } catch {
    return false;
  }
}

/** Nomes dos usuários (para os textos do painel: quem registrou, quem descartou). */
async function nomesDe(db: Db, organizacaoId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const validos = [...new Set(ids.filter((x): x is string => !!x && uuidValido(x)))];
  if (!validos.length) return new Map();
  const linhas = await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(and(eq(usuarios.organizacaoId, organizacaoId), inArray(usuarios.id, validos)));
  return new Map(linhas.map((l) => [l.id, l.nome]));
}

/**
 * O instante da entrada da reserva (o horário de entrada do imóvel no dia da entrada, no fuso do imóvel; sem cadastro,
 * 15:00) e a partir de quando o não comparecimento vale (a tolerância de Configurações → Pagamento no site). Uma regra
 * só: a decisão (`montarDecisao`) confere por ela e o formulário da ficha mostra o horário dela. `cadastrado` = o imóvel
 * tem a linha dos detalhes (sem ela, a prévia avisa que vale o padrão).
 */
export async function momentosDaEntrada(
  db: Db,
  organizacaoId: string,
  d: { imovelId: string; checkin: string; fuso: string },
): Promise<{ horaEntrada: string; cadastrado: boolean; entradaEm: Date; naoComparecimentoApos: Date }> {
  const [detalhe] = await db.select({ hora: imoveisDetalhes.checkinAPartirDe }).from(imoveisDetalhes).where(eq(imoveisDetalhes.imovelId, d.imovelId));
  const horaEntrada = horaDeEntrada(detalhe?.hora);
  const entradaEm = instanteLocal(d.checkin, horaEntrada, d.fuso);
  const horas = (await lerConfigPagamentoSite(db, organizacaoId)).naoComparecimentoHoras;
  return { horaEntrada, cadastrado: !!detalhe, entradaEm, naoComparecimentoApos: new Date(entradaEm.getTime() + horas * 3_600_000) };
}

type Montada = {
  t: Travado;
  p: Pagamento;
  /** O pedido ativo (situação "pedido"), quando há. */
  ativo: Cancelamento | null;
  /** O momento corrigido pelo financeiro (o registrado antes), quando mudou. */
  registradoOriginal: Date | null;
  motivoMomento: string;
  nota: string;
  motivoDecisao: string;
  motivoExcecao: MotivoExcecao | null;
  motivoEmpresa: MotivoCancelamentoEmpresa | null;
  quemCancela: QuemCancela;
  previa: Previa;
};

/**
 * A decisão, com todas as conferências (§5.4.1), a partir do retrato da cotação (travado na fase 1; lido sem trava na
 * prévia). Uma função só para a prévia e o cancelamento: os dois nunca discordam, e a assinatura da prévia é conferida
 * sob as travas.
 */
async function montarDecisao(db: Db, organizacaoId: string, t: Travado, e: EntradaCancelamento, agora: Date, extras: { leituraAplicada: boolean; travar: boolean }): Promise<{ ok: true; m: Montada } | Recusa> {
  const r = t.reserva;
  const fuso = t.imovel.fuso || FUSO_PAGAMENTO;
  // 1. A reserva confirmada (e ainda sem cancelamento decidido).
  if (r.estado === "cancelada" || t.cancelamento?.situacao === "cancelada") {
    const em = t.cancelamento?.canceladaEm ?? r.canceladaEm;
    return recusa("ja_cancelada", `Esta reserva já foi cancelada${em ? ` em ${diaBr(em)}` : ""}.`);
  }
  if (r.estado !== "confirmada") return recusa("nao_encontrada", "Só uma reserva confirmada pode ser cancelada por aqui.");
  // 2. O pagamento que a confirmou.
  const p = t.tentativas.find((x) => x.desfecho === "reserva");
  if (!p) return recusa("nao_paga_pelo_site", NAO_PAGA);
  // 3. Tentativa sem resposta dentro do prazo de leitura: espera. Fora dele, só o aviso da prévia.
  const inicioLeitura = inicioDoPrazoDeReleitura(agora).getTime();
  const andando = t.tentativas.find((x) => emAndamento(x.situacao) && x.criadoEm.getTime() >= inicioLeitura);
  if (andando) return recusa("em_andamento", avisoDoPagamento({ id: andando.id, forma: andando.forma, situacao: andando.situacao, pixExpiraEm: andando.pixExpiraEm, desfecho: andando.desfecho }, fuso, "cancelar"));
  const andandoAntiga = t.tentativas.some((x) => emAndamento(x.situacao) && x.criadoEm.getTime() < inicioLeitura);
  // 4. O que o Mercado Pago mostra do pagamento (pela leitura gravada).
  if (p.situacao === "contestado") return recusa("contestado", TEXTO_CONTESTADO);
  const emParte =
    p.situacao === "devolvido_parcial" ||
    (p.devolvidoLido > 0 && p.situacao !== "devolvido") ||
    p.devolucaoEmAndamentoLida ||
    p.avisos.includes("situacao_desconhecida") ||
    (p.situacao !== "aprovado" && p.situacao !== "devolvido");
  if (emParte) return recusa("devolvido_em_parte", TEXTO_DEVOLVIDO_EM_PARTE);
  // 15 (antes do resto: é dado de entrada). Listas fechadas e notas sem dado pessoal.
  const nota = e.nota.trim();
  const motivoDecisao = e.motivoDecisao.trim();
  const motivoMomento = e.motivoMomento.trim();
  for (const n of [nota, motivoDecisao, motivoMomento]) {
    if (n.length > LIMITE_NOTA) return recusa("dados", `Cada nota tem até ${LIMITE_NOTA} caracteres.`);
    if (textoSemDadosPessoais(n) === null) return recusa("dados", ERRO_DADOS_PESSOAIS);
  }
  if (!(QUEM_CANCELA_RESERVA as readonly string[]).includes(e.quemCancela)) return recusa("dados", "Escolha quem cancela.");
  if (!["politica", "excecao", "integral", "nenhum"].includes(e.decisao)) return recusa("dados", "Escolha a decisão.");
  if (e.canal !== null && !(CANAIS_PEDIDO_CANCELAMENTO as readonly string[]).includes(e.canal)) return recusa("dados", "Escolha como o pedido chegou.");
  if (e.motivoEmpresa !== null && !(MOTIVOS_CANCELAMENTO_EMPRESA as readonly string[]).includes(e.motivoEmpresa)) return recusa("dados", "Escolha o motivo da SCL.");
  if (e.motivoExcecao !== null && !(MOTIVOS_EXCECAO as readonly string[]).includes(e.motivoExcecao)) return recusa("dados", "Escolha o motivo da exceção.");
  // 5. Estadia terminada sem pedido ativo: não se cancela. Com o pedido, vale o momento dele.
  const ativo = t.cancelamento?.situacao === "pedido" ? t.cancelamento : null;
  if (hojeISO(fuso, agora) > r.checkout && !ativo)
    return recusa("estadia_encerrada", "A estadia já terminou e não há pedido de cancelamento registrado: não se cancela; registre um ajuste se precisar.");
  // 6. O momento que a política conta.
  const dentro = (x: Date) => !Number.isNaN(x.getTime()) && x.getTime() >= p.criadoEm.getTime() && x.getTime() <= agora.getTime() + FOLGA_MOMENTO_MS;
  let recebidoEm: Date;
  let canal: CanalPedidoCancelamento | null;
  let registradoOriginal: Date | null = null;
  if (e.quemCancela !== "hospede") {
    // A SCL cancela ou não comparecimento: o momento é agora (o pedido do hóspede, se houver, fica gravado como chegou).
    recebidoEm = agora;
    canal = ativo?.canal ?? null;
  } else if (ativo?.canal === "site") {
    // Pedido feito pelo hóspede em Minha reserva: horário do servidor, travado.
    recebidoEm = ativo.pedidoRecebidoEm;
    canal = "site";
  } else if (ativo) {
    canal = e.canal && e.canal !== "site" ? e.canal : ativo.canal;
    const registrado = ativo.pedidoRecebidoEm;
    if (e.recebidoEm && minuto(e.recebidoEm) !== minuto(registrado)) {
      if (!motivoMomento) return recusa("dados", "Escreva por que o horário do pedido foi corrigido (obrigatório, sem dados pessoais).");
      if (!dentro(e.recebidoEm)) return recusa("dados", TEXTO_MOMENTO);
      recebidoEm = e.recebidoEm;
      registradoOriginal = registrado;
    } else recebidoEm = registrado;
  } else {
    if (!e.recebidoEm || !dentro(e.recebidoEm)) return recusa("dados", TEXTO_MOMENTO);
    if (!e.canal || e.canal === "site") return recusa("dados", "Informe como o pedido chegou (WhatsApp, e-mail, telefone, pessoalmente ou outro).");
    recebidoEm = e.recebidoEm;
    canal = e.canal;
  }
  // O horário de entrada do imóvel (sem cadastro, o padrão), a tolerância do não comparecimento e a política aceita no pagamento.
  const entrada = await momentosDaEntrada(db, organizacaoId, { imovelId: t.imovel.id, checkin: r.checkin, fuso });
  const { horaEntrada, entradaEm } = entrada;
  // 7. Não comparecimento: nunca com um pedido ativo (vale o pedido), e só depois da tolerância editável.
  if (e.quemCancela === "nao_comparecimento") {
    if (ativo) return recusa("ha_pedido", `Há um pedido de cancelamento do hóspede recebido em ${diaHoraBr(ativo.pedidoRecebidoEm)}: não é não comparecimento. Cancele como pedido do hóspede (vale o horário do pedido).`);
    if (agora.getTime() < entrada.naoComparecimentoApos.getTime())
      return recusa("cedo_para_nao_comparecimento", `Não comparecimento só depois de ${diaHoraBr(entrada.naoComparecimentoApos, fuso)} (o hóspede pode chegar atrasado e avisar).`);
  }
  // 8. A SCL cancela: o motivo dela.
  if (e.quemCancela === "empresa" && !e.motivoEmpresa) return recusa("dados", "Escolha o motivo da SCL (apartamento sem condições, força maior ou outro).");
  const politica = await politicaDoPagamento(db, organizacaoId, p.id);
  const valorPago = valorPagoNaOrder({ pago: p.valorPago, valor: p.valor });
  const entradaPolitica = { regras: politica?.regras ?? null, checkin: r.checkin, horaEntrada, fuso, aprovadoEm: p.aprovadoEm ?? p.criadoEm, pedidoRecebidoEm: recebidoEm, valorBase: valorPago };
  const decisao = decidirPelaPolitica({ ...entradaPolitica, quemCancela: e.quemCancela });
  // Daqui em diante, toda recusa diz o que a equipe pode escolher (a tela oferece a exceção mesmo sem prévia).
  const escolha = escolhaDaEquipe(decisao.calculado);
  const recusaDecidida = (codigo: CodigoRecusaCancelamento, erro: string): Recusa => ({ ...recusa(codigo, erro), escolha });
  // 9. A decisão final: só onde a política não decide.
  let direito: "integral" | "nenhum";
  let base: BaseCancelamento;
  if (decisao.calculado === "sem_politica") {
    if ((e.decisao !== "integral" && e.decisao !== "nenhum") || !motivoDecisao) return recusaDecidida("decisao_obrigatoria", TEXTO_SEM_POLITICA);
    direito = e.decisao;
    base = "sem_politica";
  } else if (decisao.calculado === "nenhum") {
    if (e.decisao === "excecao") {
      if (!e.motivoExcecao || !motivoDecisao) return recusaDecidida("dados", "Na exceção, escolha o motivo da lista e escreva a nota (obrigatória, sem dados pessoais).");
      direito = "integral";
      base = "excecao";
    } else if (e.decisao === "politica" || e.decisao === "nenhum") {
      direito = "nenhum";
      base = decisao.base;
    } else return recusaDecidida("dados", "Pela política aceita não há devolução: para devolver tudo, escolha a exceção, com o motivo.");
  } else {
    if (e.decisao !== "politica") return recusaDecidida("integral_nao_se_nega", TEXTO_INTEGRAL_NAO_SE_NEGA);
    direito = "integral";
    base = decisao.base;
  }
  if (p.situacao === "devolvido" && direito === "nenhum")
    return recusaDecidida("decisao_obrigatoria", "O Mercado Pago já mostra este pagamento devolvido por inteiro: registre como devolução integral (pela política ou por exceção, com o motivo).");
  // 10. Saída antecipada não é cancelamento (a exceção, com o motivo, continua possível).
  if (e.quemCancela === "hospede" && decisao.comecou && direito === "nenhum")
    return recusaDecidida(
      "estadia_iniciada",
      `O pedido chegou depois do início da estadia (${diaHoraBr(entradaEm, fuso)}): pela política não há devolução e a reserva continua como está (saída antecipada não é cancelamento). Descarte o pedido com o motivo, se for o caso.`,
    );
  // 11. Integral de um pagamento ainda no prazo de leitura: só com a leitura de agora aplicada.
  if (direito === "integral" && p.criadoEm.getTime() >= inicioLeitura && !extras.leituraAplicada) return recusaDecidida("sem_leitura", TEXTO_SEM_LEITURA);
  // 12. Os componentes (sob a trava do motor na fase 1) e a parte num repasse ainda não pago.
  const motor = await lancamentosDoMotor(db, organizacaoId, r.id, { travar: extras.travar });
  const somar = (tipo: string) => motor.ativos.filter((a) => a.tipo === tipo).reduce((s, a) => s + a.valor, 0);
  const comissao = somar("comissao");
  const parteProprietario = somar("direito_proprietario");
  if (direito === "integral") {
    const preso = await repasseAPagarDaReservaDados(db, organizacaoId, r.id);
    if (preso)
      return recusaDecidida(
        "repasse_a_pagar",
        `A parte desta reserva já compõe o repasse ${preso.tipo === "antecipado" ? "antecipado" : preso.tipo === "fechamento" ? "do fechamento" : "por fora"} de ${dataIsoBr(preso.data)}, ainda não pago: estorne esse repasse (o proprietário recebe o resto no próximo) e então cancele. Se ele já foi pago de fato, marque-o como pago antes — a parte paga é descontada no próximo repasse.`,
      );
  }
  const jaRepassada = motor.ativos
    .filter((a) => a.tipo === "direito_proprietario" && a.valor > 0 && (motor.pagos.has(a.id) || a.estado === "realizado" || a.estado === "conciliado"))
    .map((a) => {
      const pago = motor.pagos.get(a.id);
      return { lancamentoId: a.id, valor: a.valor, repasseId: pago?.repasseId ?? "", repasse: pago?.data ?? "", pagoEm: pago?.dataPagamento ?? "" };
    });
  let perdaDoProprietario = 0;
  if (direito === "integral" && base === "excecao") perdaDoProprietario = parteProprietario;
  else if (direito === "integral" && base === "empresa" && politica) {
    // O que o hóspede teria se o pedido fosse dele agora: sem devolução, o proprietário receberia a parte.
    if (decidirPelaPolitica({ ...entradaPolitica, quemCancela: "hospede" }).calculado === "nenhum") perdaDoProprietario = parteProprietario;
  }
  const ajustes = await db
    .select({ id: lancamentos.id, descricao: lancamentos.descricao, valor: lancamentos.valor })
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.reservaId, r.id), eq(lancamentos.tipo, "ajuste"), emVigor()))
    .orderBy(asc(lancamentos.criadoEm));
  // 13 e 14. Os valores e a rota da devolução.
  const valorADevolver = direito === "integral" ? valorPago : 0;
  const valorRetido = direito === "nenhum" ? p.valor : 0;
  const rota: RotaDevolucao =
    direito === "nenhum" ? "nenhuma" : p.situacao === "devolvido" ? "ja_devolvida" : p.criadoEm.getTime() < inicioDoPrazoDePedirDevolucao(agora).getTime() ? "fora_do_prazo" : "pedida";

  // Pedidos descartados (ficam no histórico) e os nomes de quem registrou e descartou.
  const descartadas = await db
    .select()
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), eq(cancelamentosReserva.reservaId, r.id), eq(cancelamentosReserva.situacao, "descartado")))
    .orderBy(asc(cancelamentosReserva.criadoEm));
  const nomes = await nomesDe(db, organizacaoId, [ativo?.pedidoPor ?? null, ...descartadas.map((x) => x.descartadoPor)]);
  const descartados = descartadas.map((x) => ({ em: x.pedidoRecebidoEm, canal: x.canal, por: x.descartadoPor ? (nomes.get(x.descartadoPor) ?? null) : null, motivo: x.descarteMotivo, descartadoEm: x.descartadoEm }));

  const regras = politica ? regrasComPadrao(politica.regras) : null;
  const componentes: Previa["componentes"] = { comissao, parteProprietario, taxa: p.taxa, jaRepassada, perdaDoProprietario, ajustes };
  const leitura: Previa["leitura"] = { em: p.consultadoEm, situacao: p.situacao, devolvidoLido: p.devolvidoLido, emAndamento: p.devolucaoEmAndamentoLida };
  const descontoJaRepassado = jaRepassada.reduce((s, x) => s + x.valor, 0);

  // Os avisos da prévia (avisar em vez de supor).
  const avisos: string[] = [];
  if (decisao.calculado === "sem_politica") avisos.push(TEXTO_SEM_POLITICA);
  if (fuso !== FUSO_PAGAMENTO) avisos.push("A política conta no horário de Brasília e este imóvel está em outro fuso: confira as datas.");
  if (!entrada.cadastrado) avisos.push(`Este imóvel não tem horário de entrada cadastrado: vale o padrão ${HORA_ENTRADA_PADRAO}.`);
  if (direito === "nenhum" && p.taxa === null) avisos.push("A taxa do Mercado Pago ainda não foi informada: a divisão usa taxa zero até ele informar (aviso no Início).");
  if (direito === "nenhum" && r.valorBruto !== p.valor)
    avisos.push(
      `O valor retido (${formatBRL(p.valor)}, o que o hóspede pagou) é diferente do valor da reserva (${formatBRL(r.valorBruto ?? 0)}): a divisão muda.${motor.movidos.size ? " Como a parte já foi repassada, a reserva fica em conferência para um ajuste manual." : ""}`,
    );
  if (direito === "integral" && perdaDoProprietario > 0)
    avisos.push(
      `O proprietário deixa de receber ${formatBRL(perdaDoProprietario)} que receberia pela política (sem devolução, o valor seria dividido normalmente).${descontoJaRepassado > 0 ? ` ${formatBRL(descontoJaRepassado)} já repassados serão descontados no próximo repasse dele.` : ""}`,
    );
  if (ajustes.length)
    avisos.push(`Esta reserva tem ${ajustes.length} ajuste(s) manual(is) (${formatBRL(ajustes.reduce((s, a) => s + a.valor, 0))}): o cancelamento não mexe neles. Revise depois.`);
  if (rota === "fora_do_prazo")
    avisos.push(
      "O pagamento tem mais de 78 dias: o sistema não pede mais a devolução ao Mercado Pago (não daria tempo de conferir). Depois de cancelar, devolva pelo painel do Mercado Pago (cartão) e confirme aqui, ou faça a devolução por fora (Pix).",
    );
  const idadeMs = agora.getTime() - (p.aprovadoEm ?? p.criadoEm).getTime();
  if (direito === "integral" && p.forma === "pix" && idadeMs > 90 * 86_400_000)
    avisos.push("Pix com mais de 90 dias: pela regra do Banco Central, o Mercado Pago pode não conseguir devolver; a devolução por fora (Pix da conta da empresa) fica liberada.");
  if (direito === "integral" && p.forma === "cartao" && idadeMs > PRAZO_DEVOLUCAO_CARTAO_DIAS * 86_400_000) avisos.push("Cartão com mais de 180 dias: o Mercado Pago não devolve mais; a devolução será por fora.");
  if (direito === "integral" && rota === "pedida" && p.forma === "cartao" && !p.liberacaoConfirmadaEm)
    avisos.push("Cartão ainda não liberado pelo Mercado Pago: a devolução pode precisar de saldo disponível na conta do Mercado Pago.");
  if (direito === "integral")
    for (const x of jaRepassada)
      avisos.push(
        x.repasseId
          ? `${formatBRL(x.valor)} da parte do proprietário já foram repassados (repasse de ${dataIsoBr(x.repasse)}, pago em ${dataIsoBr(x.pagoEm)}): o cancelamento lança agora o desconto, que sai do próximo repasse dele.`
          : `${formatBRL(x.valor)} da parte do proprietário já foram pagos: o cancelamento lança agora o desconto, que sai do próximo repasse dele.`,
      );
  if (ativo && ativo.canal !== "site" && ativo.criadoEm.getTime() - ativo.pedidoRecebidoEm.getTime() > REGISTRO_TARDIO_MS)
    avisos.push("O pedido foi registrado mais de dois dias depois de chegar: confira a data e a hora na mensagem do hóspede.");
  if (registradoOriginal && ativo)
    avisos.push(`Momento do pedido corrigido: registrado ${diaHoraBr(registradoOriginal).replace(" às ", " ")} por ${(ativo.pedidoPor && nomes.get(ativo.pedidoPor)) || "a equipe"}; usado ${diaHoraBr(recebidoEm).replace(" às ", " ")} (${motivoMomento}).`);
  for (const x of descartados)
    avisos.push(`Pedido de ${diaHoraBr(x.em)} (${x.canal ? NOMES_CANAL_PEDIDO[x.canal] : "sem canal"}) descartado por ${x.por ?? "a equipe"}${x.descartadoEm ? ` em ${diaBr(x.descartadoEm)}` : ""}: ${x.motivo}`);
  if (descartados.some((x) => x.canal === "site" && x.em.getTime() < recebidoEm.getTime()))
    avisos.push(`Há um pedido pelo site de ${diaHoraBr(descartados.filter((x) => x.canal === "site").at(-1)!.em)} descartado como desistência: confira antes de usar um horário posterior.`);
  if (andandoAntiga) avisos.push("Há uma tentativa de pagamento sem resposta há mais de 85 dias: confira no painel do Mercado Pago que ela não foi aprovada.");
  avisos.push(leitura.em ? `Leitura do Mercado Pago de ${diaHoraBr(leitura.em)}: ${NOMES_SITUACAO_PAGAMENTO[leitura.situacao].toLowerCase()}.` : "Ainda sem leitura do Mercado Pago deste pagamento.");

  const assinatura = createHash("sha1")
    .update(
      JSON.stringify([
        direito,
        base,
        rota,
        valorPago,
        valorADevolver,
        valorRetido,
        politica?.versao ?? null,
        // A SCL ou o não comparecimento contam "agora": o minuto muda entre a prévia e o clique sem mudar a decisão.
        e.quemCancela === "hospede" ? minuto(recebidoEm) : null,
        e.quemCancela,
        e.decisao,
        e.motivoExcecao,
        comissao,
        parteProprietario,
        p.taxa,
        jaRepassada.map((x) => [x.lancamentoId, x.valor, x.repasseId, x.pagoEm]),
        leitura.situacao,
        leitura.devolvidoLido,
        leitura.emAndamento,
      ]),
    )
    .digest("hex")
    .slice(0, 16);

  const previa: Previa = {
    decisao,
    direito,
    base,
    rota,
    valorPago,
    valorADevolver,
    valorRetido,
    recebidoEm,
    canal,
    politica: politica && regras ? { versao: politica.versao, data: politica.data, diasReembolsoIntegral: regras.diasReembolsoIntegral, arrependimentoAteEntrada: regras.arrependimentoAteEntrada } : null,
    componentes,
    leitura,
    descartados: descartados.map(({ em, canal: c, por, motivo }) => ({ em, canal: c, por, motivo })),
    avisos,
    assinatura,
    pergunta: perguntaDoCancelamento({ codigo: r.codigo, checkin: r.checkin, direito, base, rota, valorADevolver, valorRetido: p.valor, comissao, parteProprietario, perdaDoProprietario, descontoJaRepassado, quemCancela: e.quemCancela }),
  };
  return {
    ok: true,
    m: { t, p, ativo, registradoOriginal, motivoMomento, nota, motivoDecisao, motivoExcecao: base === "excecao" ? e.motivoExcecao : null, motivoEmpresa: e.quemCancela === "empresa" ? e.motivoEmpresa : null, quemCancela: e.quemCancela, previa },
  };
}

/** O texto do BotaoConfirmar do cancelamento (§9.2): o valor, a base, a rota e a perda do proprietário. */
export function perguntaDoCancelamento(x: {
  codigo: string;
  checkin: string;
  direito: "integral" | "nenhum";
  base: BaseCancelamento;
  rota: RotaDevolucao;
  valorADevolver: number;
  valorRetido: number;
  comissao: number;
  parteProprietario: number;
  perdaDoProprietario: number;
  descontoJaRepassado: number;
  quemCancela: QuemCancela;
}): string {
  const prefixo = x.quemCancela === "nao_comparecimento" ? "Confirme que o hóspede não chegou e não avisou de atraso. " : "";
  const base = NOMES_BASE_CANCELAMENTO[x.base];
  if (x.direito === "nenhum")
    return `${prefixo}Cancelar a reserva ${x.codigo} sem devolução? Base: ${base}. O valor pago (${formatBRL(x.valorRetido)}) fica retido e é dividido como uma reserva normal: a parte do proprietário fica disponível depois da data de entrada original (${dataIsoBr(x.checkin)}) e da liberação do Mercado Pago. As datas voltam à venda no site; reabra-as nas OTAs. O cancelamento não pode ser desfeito.`;
  const como = x.rota === "pedida" ? " pelo Mercado Pago" : x.rota === "fora_do_prazo" ? " — a devolução sai pelo painel do Mercado Pago ou por fora" : x.rota === "ja_devolvida" ? " — o Mercado Pago já devolveu" : "";
  return [
    `${prefixo}Cancelar a reserva ${x.codigo} e devolver ao hóspede ${formatBRL(x.valorADevolver)} (o valor integral pago)${como}?`,
    `Base: ${base}.`,
    `A parte do proprietário (${formatBRL(x.parteProprietario)}) e a comissão (${formatBRL(x.comissao)}) saem do financeiro; a taxa do Mercado Pago que não voltar fica com a SCL.`,
    ...(x.perdaDoProprietario > 0 ? [`O proprietário deixa de receber ${formatBRL(x.perdaDoProprietario)} que receberia pela política.`] : []),
    ...(x.descontoJaRepassado > 0 ? [`${formatBRL(x.descontoJaRepassado)} já repassados ao proprietário são descontados no próximo repasse dele.`] : []),
    "As datas voltam à venda no site; reabra-as nas OTAs (no Beds24, apague o bloqueio). O cancelamento não pode ser desfeito.",
  ].join(" ");
}

/**
 * A prévia do cancelamento: a mesma releitura da fase 0 (com provedor) e a mesma decisão, sem travar nada. A assinatura
 * dela vai no cancelamento (`cancelarReservaPaga`), que confere tudo de novo sob as travas.
 */
export async function previaDoCancelamento(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  e: EntradaCancelamento,
  provedor: ProvedorPagamento | null,
  agora: Date = new Date(),
): Promise<{ ok: true; previa: Previa } | Recusa> {
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo) return recusa("nao_encontrada", "Reserva não encontrada.");
  if (!alvo.pagamento) return alvo.reserva.estado === "cancelada" ? recusa("ja_cancelada", "Esta reserva já foi cancelada.") : recusa("nao_paga_pelo_site", NAO_PAGA);
  const leituraAplicada = await releitura(db, organizacaoId, alvo.pagamento, provedor, agora);
  const t = await lerCotacaoSemTravar(db, organizacaoId, alvo.pagamento.cotacaoId);
  if (!t) return recusa("nao_encontrada", "Reserva não encontrada.");
  const r = await montarDecisao(db, organizacaoId, t, e, agora, { leituraAplicada, travar: false });
  return r.ok ? { ok: true, previa: r.m.previa } : r;
}

/**
 * Cancela a reserva paga pelo site pela política (as três fases, no topo do arquivo). `assinatura` é obrigatória: a da
 * prévia que a equipe viu; diferente (ou vazia) = `previa_mudou`. Autorização (reserva:editar + financeiro:editar)
 * conferida por quem chama.
 */
export async function cancelarReservaPaga(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  e: EntradaCancelamento,
  autorId: string | null,
  provedor: ProvedorPagamento | null,
  agora: Date,
  assinatura: string,
): Promise<{ ok: true; cancelamentoId: string; direito: "integral" | "nenhum"; devolucao: SituacaoDevolucao | null } | Recusa> {
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo) return recusa("nao_encontrada", "Reserva não encontrada.");
  if (!alvo.pagamento) return alvo.reserva.estado === "cancelada" ? recusa("ja_cancelada", "Esta reserva já foi cancelada.") : recusa("nao_paga_pelo_site", NAO_PAGA);
  // Fase 0: a releitura (sem trava; o provedor nunca é chamado com trava aberta).
  const leituraAplicada = await releitura(db, organizacaoId, alvo.pagamento, provedor, agora);
  const cotacaoId = alvo.pagamento.cotacaoId;
  let feito: { ok: true; cancelamentoId: string; direito: "integral" | "nenhum"; devolucaoId: string | null; situacao: SituacaoDevolucao | null } | Recusa;
  try {
    feito = await db.transaction(async (tx) => {
      // Fase 1: travas (cotação → motor) e só então a decisão, sob elas.
      const t = await travarCotacao(tx, organizacaoId, cotacaoId);
      if (!t) return recusa("nao_encontrada", "Reserva não encontrada.");
      await travarMotorDaReserva(tx, organizacaoId, t.reserva.id);
      const montada = await montarDecisao(tx, organizacaoId, t, e, agora, { leituraAplicada, travar: true });
      if (!montada.ok) return montada;
      const { m } = montada;
      if (!assinatura || assinatura !== m.previa.assinatura) return recusa("previa_mudou", TEXTO_PREVIA_MUDOU);
      return gravarCancelamento(tx, organizacaoId, m, autorId, agora);
    });
  } catch (erro) {
    if (travaOcupada(erro)) return recusa("ocupado", TEXTO_OCUPADO);
    // Outro pedido ou cancelamento da mesma reserva gravado ao mesmo tempo (índice único do ativo).
    if (violouUnicidade(erro, "cancelamentos_reserva_um_ativo")) return recusa("ja_cancelada", "Esta reserva acabou de receber outro pedido ou cancelamento: atualize a página.");
    throw erro;
  }
  if (!feito.ok) return feito;
  // Fase 2: o pedido ao Mercado Pago, fora da transação (a rotina e o "Conferir agora" retomam se falhar aqui).
  let situacao = feito.situacao;
  if (situacao === "pedida" && feito.devolucaoId && provedor) {
    try {
      situacao = (await tentarDevolucao(db, organizacaoId, feito.devolucaoId, provedor, agora)) ?? situacao;
    } catch {
      /* fica pedida: a rotina tenta de novo */
    }
  }
  return { ok: true, cancelamentoId: feito.cancelamentoId, direito: feito.direito, devolucao: situacao };
}

/** As escritas da fase 1 (§5.4.2, passos 4 a 9), com o retrato `t` sempre atualizado junto. */
async function gravarCancelamento(tx: Db, organizacaoId: string, m: Montada, autorId: string | null, agora: Date) {
  const { t, p, previa } = m;
  const r = t.reserva;
  const politica = previa.politica;
  // 4. O cancelamento (o pedido ativo vira a linha do cancelamento; sem pedido, uma linha nova), com o retrato.
  const comum = {
    situacao: "cancelada" as const,
    quemCancela: m.quemCancela,
    motivoEmpresa: m.motivoEmpresa,
    motivoExcecao: m.motivoExcecao,
    motivoDecisao: m.motivoDecisao,
    nota: m.nota,
    politicaVersao: politica?.versao ?? null,
    diasReembolsoIntegral: politica?.diasReembolsoIntegral ?? null,
    arrependimentoAteEntrada: politica?.arrependimentoAteEntrada ?? null,
    integralAte: previa.decisao.integralAte,
    arrependimentoAte: previa.decisao.arrependimentoAte,
    entradaEm: previa.decisao.entradaEm,
    calculado: previa.decisao.calculado,
    direito: previa.direito,
    base: previa.base,
    valorPago: previa.valorPago,
    valorADevolver: previa.valorADevolver,
    canceladaEm: agora,
    canceladaPor: autorId,
    atualizadoEm: agora,
  };
  let linha: Cancelamento;
  if (m.ativo) {
    [linha] = await tx
      .update(cancelamentosReserva)
      .set({
        ...comum,
        // Pedido da equipe: o canal pode ter sido corrigido; o horário só com o motivo (auditado). O do site nunca muda.
        ...(m.ativo.canal !== "site" && m.quemCancela === "hospede" ? { canal: previa.canal } : {}),
        ...(m.registradoOriginal ? { pedidoRegistradoOriginalEm: m.registradoOriginal, motivoMomento: m.motivoMomento, pedidoRecebidoEm: previa.recebidoEm } : {}),
      })
      .where(eq(cancelamentosReserva.id, m.ativo.id))
      .returning();
  } else {
    [linha] = await tx
      .insert(cancelamentosReserva)
      .values({ organizacaoId, reservaId: r.id, pagamentoId: p.id, pedidoRecebidoEm: previa.recebidoEm, canal: m.quemCancela === "hospede" ? previa.canal : null, pedidoPor: autorId, criadoEm: agora, ...comum })
      .returning();
  }
  t.cancelamento = linha;
  // 5. A reserva cancelada (colunas fora das chaves: a trava NO KEY UPDATE já tomada basta).
  const mudancaReserva = { estado: "cancelada" as const, canceladaEm: agora, confirmadaEm: null, conferenciaResolvidaEm: null, valorRetido: previa.direito === "nenhum" ? p.valor : null, atualizadoEm: agora };
  await tx.update(reservas).set(mudancaReserva).where(eq(reservas.id, r.id));
  Object.assign(r, mudancaReserva);
  // 6. A cotação (exibição e defesa: uma aprovação tardia de outra tentativa já é "outra tentativa").
  await tx.update(cotacoes).set({ estado: "cancelada", atualizadaEm: agora }).where(eq(cotacoes.id, t.cotacao.id));
  t.cotacao.estado = "cancelada";
  // 7. Auditoria (nunca as notas, nunca nomes).
  await registrarAuditoria(tx, {
    organizacaoId,
    usuarioId: autorId,
    acao: "reserva.cancelar",
    entidade: "reserva",
    entidadeId: r.id,
    mudancas: { estado: ["confirmada", "cancelada"], motivo: [null, "cancelamento pela política (pagamento no site)"], cancelamento: [null, linha.id] },
  });
  await registrarAuditoria(tx, {
    organizacaoId,
    usuarioId: autorId,
    acao: "pagamento.cancelamento",
    entidade: "pagamento",
    entidadeId: p.id,
    mudancas: {
      direito: [null, previa.direito],
      base: [null, previa.base],
      valor: [null, previa.valorADevolver],
      politica: [null, politica ? `v${politica.versao}` : null],
      recebidoEm: [m.registradoOriginal?.toISOString() ?? null, previa.recebidoEm.toISOString()],
    },
  });
  // 8. O resultado, todo agora (o lado do proprietário também).
  await acertarResultado(tx, organizacaoId, t, p, { direito: previa.direito }, autorId, agora);
  // 9. O caixa, pela rota da devolução.
  let devolucao: Devolucao | null = null;
  const motivo = `Cancelamento da reserva ${r.codigo} pela política`;
  const avisos = new Set<string>(p.avisos);
  const novaDevolucao = async (v: Partial<typeof devolucoesPagamento.$inferInsert> & { situacao: SituacaoDevolucao }) => {
    const [d] = await tx
      .insert(devolucoesPagamento)
      .values({ organizacaoId, pagamentoId: p.id, motivo, valor: previa.valorPago, origem: "cancelamento", cancelamentoId: linha.id, autorId, criadoEm: agora, atualizadoEm: agora, ...v })
      .returning();
    t.devolucoes.push(d);
    return d;
  };
  if (previa.rota === "nenhuma") {
    const [c] = await tx.update(cancelamentosReserva).set({ caixaLancadoEm: agora, atualizadoEm: agora }).where(eq(cancelamentosReserva.id, linha.id)).returning();
    Object.assign(linha, c);
  } else if (previa.rota === "ja_devolvida") {
    // D15: o dinheiro já voltou pelo painel do Mercado Pago. O dia do caixa é o da primeira leitura que viu "devolvido".
    const auditoria = p.devolvidoVistoEm ? null : await auditoriaDoDevolvido(tx, organizacaoId, p.id);
    const fato = fatoDoDevolvidoNoPainel(p, auditoria, agora);
    devolucao = await novaDevolucao({ situacao: "confirmada", confirmadaEm: p.devolvidoVistoEm ?? auditoria ?? agora, confirmadaPor: "leitura", valorConfirmado: p.devolvidoLido > 0 ? p.devolvidoLido : null });
    const caixa = await acertarCaixa(tx, organizacaoId, t, p, devolucao, fato, agora, autorId);
    avisos.delete("devolvido_por_fora");
    if (fato.aviso) avisos.add(fato.aviso);
    for (const a of caixa.avisos) avisos.add(a);
  } else if (previa.rota === "fora_do_prazo") {
    // D12: nenhuma chamada ao Mercado Pago (não daria tempo de conferir); a equipe devolve pelo painel dele ou por fora.
    devolucao = await novaDevolucao({ situacao: "recusada", falhas: 0, proximaTentativaEm: null });
    avisos.add("devolucao_fora_do_prazo");
  } else devolucao = await novaDevolucao({ situacao: "pedida", proximaTentativaEm: agora });
  if (devolucao) await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "pagamento.devolver", entidade: "pagamento", entidadeId: p.id, mudancas: { devolucao: [null, devolucao.situacao], valor: [null, previa.valorADevolver] } });
  const lista = [...avisos] as CodigoAviso[];
  if (lista.length !== p.avisos.length || lista.some((a, i) => a !== p.avisos[i])) {
    await tx.update(pagamentos).set({ avisos: lista, atualizadoEm: agora }).where(eq(pagamentos.id, p.id));
    p.avisos = lista;
  }
  return { ok: true as const, cancelamentoId: linha.id, direito: previa.direito, devolucaoId: devolucao?.id ?? null, situacao: devolucao?.situacao ?? null };
}

// ---------------------------------------------------------------- pedido, descarte, OTAs e "avisado" (§5.4.4)

type Resultado = { ok: true } | { ok: false; erro: string };
const JA_HA_PEDIDO = (em: Date) => `Já há um pedido registrado em ${diaHoraBr(em)}.`;

/** Nota curta (0..300) sem dado pessoal; obrigatória quando pedida. */
function problemaDaNota(nota: string, obrigatoria: boolean): string | null {
  if (obrigatoria && !nota) return "Escreva o motivo (sem dados pessoais).";
  if (nota.length > LIMITE_NOTA) return `A nota tem até ${LIMITE_NOTA} caracteres.`;
  if (textoSemDadosPessoais(nota) === null) return ERRO_DADOS_PESSOAIS;
  return null;
}

/**
 * Registrar um pedido de cancelamento que chegou por outro canal (WhatsApp, e-mail, telefone, pessoalmente…) — reserva:editar.
 * O momento (o que a política conta) entre a criação do pagamento e agora; nota opcional, sem dado pessoal.
 */
export async function registrarPedidoDeCancelamento(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  d: { recebidoEm: Date; canal: Exclude<CanalPedidoCancelamento, "site">; nota: string },
  autorId: string,
  agora: Date = new Date(),
): Promise<Resultado> {
  if (!(CANAIS_PEDIDO_CANCELAMENTO as readonly string[]).includes(d.canal) || (d.canal as string) === "site") return { ok: false, erro: "Escolha como o pedido chegou." };
  const nota = d.nota.trim();
  const problema = problemaDaNota(nota, false);
  if (problema) return { ok: false, erro: problema };
  if (!(d.recebidoEm instanceof Date) || Number.isNaN(d.recebidoEm.getTime())) return { ok: false, erro: TEXTO_MOMENTO };
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo) return { ok: false, erro: "Reserva não encontrada." };
  if (!alvo.pagamento) return { ok: false, erro: "Esta reserva não foi paga pelo site." };
  const cotacaoId = alvo.pagamento.cotacaoId;
  try {
    return await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, cotacaoId);
      const p = t?.tentativas.find((x) => x.desfecho === "reserva");
      if (!t || !p) return { ok: false as const, erro: "Reserva não encontrada." };
      if (t.cancelamento?.situacao === "cancelada" || t.reserva.estado === "cancelada") return { ok: false as const, erro: "Esta reserva já foi cancelada." };
      if (t.reserva.estado !== "confirmada") return { ok: false as const, erro: "Só uma reserva confirmada recebe pedido de cancelamento." };
      if (t.cancelamento) return { ok: false as const, erro: JA_HA_PEDIDO(t.cancelamento.pedidoRecebidoEm) };
      if (d.recebidoEm.getTime() < p.criadoEm.getTime() || d.recebidoEm.getTime() > agora.getTime() + FOLGA_MOMENTO_MS) return { ok: false as const, erro: TEXTO_MOMENTO };
      const [linha] = await tx
        .insert(cancelamentosReserva)
        .values({ organizacaoId, reservaId: t.reserva.id, pagamentoId: p.id, situacao: "pedido", pedidoRecebidoEm: d.recebidoEm, canal: d.canal, quemCancela: "hospede", nota, pedidoPor: autorId, criadoEm: agora, atualizadoEm: agora })
        .returning();
      t.cancelamento = linha;
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "reserva.cancelamento_pedido", entidade: "reserva", entidadeId: t.reserva.id, mudancas: { canal: [null, d.canal], recebidoEm: [null, d.recebidoEm.toISOString()] } });
      return { ok: true as const };
    });
  } catch (erro) {
    if (travaOcupada(erro)) return { ok: false, erro: TEXTO_OCUPADO };
    if (violouUnicidade(erro, "cancelamentos_reserva_um_ativo")) {
      const [c] = await db.select().from(cancelamentosReserva).where(and(eq(cancelamentosReserva.reservaId, reservaId), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])));
      return { ok: false, erro: c ? (c.situacao === "cancelada" ? "Esta reserva já foi cancelada." : JA_HA_PEDIDO(c.pedidoRecebidoEm)) : "Já há um pedido registrado." };
    }
    throw erro;
  }
}

/**
 * Descartar um pedido de cancelamento (nunca apagado: fica no histórico da ficha e da prévia). Pedido feito pelo hóspede
 * no site: só quem tem `financeiro:editar`, e só como desistência do hóspede (por onde e quando ele desistiu). Os outros:
 * reserva:editar (conferido por quem chama).
 */
export async function descartarPedidoDeCancelamento(
  db: Db,
  organizacaoId: string,
  reservaId: string,
  d: { motivo: string; desistencia?: { canal: CanalPedidoCancelamento; em: Date } },
  autor: { id: string; podeFinanceiro: boolean },
  agora: Date = new Date(),
): Promise<Resultado> {
  const motivo = d.motivo.trim();
  const problema = problemaDaNota(motivo, true);
  if (problema) return { ok: false, erro: problema };
  const alvo = await localizar(db, organizacaoId, reservaId);
  if (!alvo?.pagamento) return { ok: false, erro: "Não há pedido de cancelamento aberto nesta reserva." };
  const cotacaoId = alvo.pagamento.cotacaoId;
  try {
    return await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, cotacaoId);
      const c = t?.cancelamento;
      if (!t || !c || c.situacao !== "pedido") return { ok: false as const, erro: "Não há pedido de cancelamento aberto nesta reserva." };
      let descarteMotivo = motivo;
      let desistencia: { canal: CanalPedidoCancelamento; em: Date } | null = null;
      if (c.canal === "site") {
        if (!autor.podeFinanceiro) return { ok: false as const, erro: "Pedido feito pelo hóspede no site: só quem cuida do financeiro descarta, como desistência do hóspede." };
        const x = d.desistencia;
        const valida =
          !!x &&
          (CANAIS_PEDIDO_CANCELAMENTO as readonly string[]).includes(x.canal) &&
          x.em instanceof Date &&
          !Number.isNaN(x.em.getTime()) &&
          x.em.getTime() >= c.pedidoRecebidoEm.getTime() &&
          x.em.getTime() <= agora.getTime() + FOLGA_MOMENTO_MS;
        if (!valida) return { ok: false as const, erro: "Informe por onde e quando o hóspede desistiu do pedido (depois do pedido e não no futuro)." };
        desistencia = x!;
        descarteMotivo = `O hóspede desistiu do pedido: ${motivo}`.slice(0, LIMITE_NOTA);
      }
      await tx
        .update(cancelamentosReserva)
        .set({ situacao: "descartado", descartadoEm: agora, descartadoPor: autor.id, descarteMotivo, desistenciaCanal: desistencia?.canal ?? null, desistenciaEm: desistencia?.em ?? null, atualizadoEm: agora })
        .where(eq(cancelamentosReserva.id, c.id));
      t.cancelamento = null;
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: autor.id,
        acao: "reserva.cancelamento_descartado",
        entidade: "reserva",
        entidadeId: t.reserva.id,
        mudancas: { situacao: ["pedido", "descartado"], ...(desistencia ? { desistencia: [null, `${desistencia.canal} em ${desistencia.em.toISOString()}`] } : {}) },
      });
      return { ok: true as const };
    });
  } catch (erro) {
    if (travaOcupada(erro)) return { ok: false, erro: TEXTO_OCUPADO };
    throw erro;
  }
}

/** "Datas reabertas nas OTAs" (reserva:editar): uma vez, no cancelamento decidido. O M8.3 grava sozinho quando chegar. */
export async function marcarOtaLiberada(db: Db, organizacaoId: string, reservaId: string, autorId: string | null, agora: Date = new Date()): Promise<Resultado> {
  if (!uuidValido(reservaId)) return { ok: false, erro: "Reserva não encontrada." };
  const [c] = await db
    .select()
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), eq(cancelamentosReserva.reservaId, reservaId), eq(cancelamentosReserva.situacao, "cancelada")));
  if (!c) return { ok: false, erro: "Esta reserva não tem cancelamento pela política." };
  if (c.otaLiberadaEm) return { ok: false, erro: `As datas já foram marcadas como reabertas em ${diaBr(c.otaLiberadaEm)}.` };
  const [feito] = await db
    .update(cancelamentosReserva)
    .set({ otaLiberadaEm: agora, otaLiberadaPor: autorId, atualizadoEm: agora })
    .where(and(eq(cancelamentosReserva.id, c.id), isNull(cancelamentosReserva.otaLiberadaEm)))
    .returning({ id: cancelamentosReserva.id });
  if (!feito) return { ok: false, erro: "As datas já foram marcadas como reabertas." };
  await registrarAuditoria(db, { organizacaoId, usuarioId: autorId, acao: "reserva.ota_liberada", entidade: "reserva", entidadeId: reservaId, mudancas: { otaLiberadaEm: [null, agora.toISOString()] } });
  return { ok: true };
}

export type MensagemAoHospede = "pedido" | "decisao" | "devolucao";

/** A coluna "quando" de cada mensagem e o que gravar ao marcar (quando e quem). */
const COLUNAS_AVISADO = {
  pedido: { em: cancelamentosReserva.hospedeAvisadoPedidoEm, marca: (em: Date, por: string | null) => ({ hospedeAvisadoPedidoEm: em, hospedeAvisadoPedidoPor: por }) },
  decisao: { em: cancelamentosReserva.hospedeAvisadoDecisaoEm, marca: (em: Date, por: string | null) => ({ hospedeAvisadoDecisaoEm: em, hospedeAvisadoDecisaoPor: por }) },
  devolucao: { em: cancelamentosReserva.hospedeAvisadoDevolucaoEm, marca: (em: Date, por: string | null) => ({ hospedeAvisadoDevolucaoEm: em, hospedeAvisadoDevolucaoPor: por }) },
} as const;

/**
 * Marca uma mensagem ao hóspede como enviada, uma vez (`por` null = o sistema, pelo envio automático do M9.2). Devolve se
 * marcou agora. Usado pelo botão "Mensagem enviada ao hóspede" e pelo envio automático.
 */
export async function marcarAvisado(db: Db, organizacaoId: string, cancelamentoId: string, qual: MensagemAoHospede, por: string | null, agora: Date): Promise<boolean> {
  const col = COLUNAS_AVISADO[qual];
  const [feito] = await db
    .update(cancelamentosReserva)
    .set({ ...col.marca(agora, por), atualizadoEm: agora })
    .where(and(eq(cancelamentosReserva.id, cancelamentoId), eq(cancelamentosReserva.organizacaoId, organizacaoId), isNull(col.em)))
    .returning({ id: cancelamentosReserva.id, reservaId: cancelamentosReserva.reservaId });
  if (feito) await registrarAuditoria(db, { organizacaoId, usuarioId: por, acao: "reserva.hospede_avisado", entidade: "reserva", entidadeId: feito.reservaId, mudancas: { qual: [null, qual] } });
  return Boolean(feito);
}

/**
 * "Mensagem enviada ao hóspede" (reserva:editar): o pedido recebido (pedido ou cancelamento ativo), a decisão (cancelada)
 * ou a devolução feita (confirmada ou por fora). Uma vez por mensagem.
 */
export async function marcarHospedeAvisado(db: Db, organizacaoId: string, reservaId: string, qual: MensagemAoHospede, autorId: string, agora: Date = new Date()): Promise<Resultado> {
  if (!uuidValido(reservaId) || !(qual in COLUNAS_AVISADO)) return { ok: false, erro: "Reserva não encontrada." };
  const [c] = await db
    .select()
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.organizacaoId, organizacaoId), eq(cancelamentosReserva.reservaId, reservaId), inArray(cancelamentosReserva.situacao, ["pedido", "cancelada"])));
  if (!c) return { ok: false, erro: "Esta reserva não tem pedido nem cancelamento pela política." };
  if (qual !== "pedido" && c.situacao !== "cancelada") return { ok: false, erro: "O cancelamento ainda não foi decidido." };
  if (qual === "devolucao") {
    const [dev] = await db.select({ situacao: devolucoesPagamento.situacao }).from(devolucoesPagamento).where(eq(devolucoesPagamento.cancelamentoId, c.id));
    if (dev?.situacao !== "confirmada" && dev?.situacao !== "por_fora") return { ok: false, erro: "A devolução ainda não foi feita." };
  }
  if (!(await marcarAvisado(db, organizacaoId, c.id, qual, autorId, agora))) return { ok: false, erro: "Esta mensagem já foi marcada como enviada." };
  return { ok: true };
}
