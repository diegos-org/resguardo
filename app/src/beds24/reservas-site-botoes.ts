/**
 * Reserva paga do site no Beds24 (M8.3c, bloco G; desenho 3.6, 3.8, 5, 6.6 e 8; plano 1.15): o domínio dos botões da ficha.
 * - "Conferir agora" (`reserva:editar`): só lê. Resolve a operação em curso pela mesma função do passo 1 da rotina
 *   (`resolverOperacaoEmCurso`: a `incerta`, a `feita` e a `enviando` vencida, respeitando os 5 minutos), repete a leitura da
 *   cancelada antes de criar (`cancelarAntesDeCriar`, a duplicada depois de a equipe cancelar no Beds24) ou relê pelo id a
 *   reserva ligada (`conferirReservaLigada`, a mesma da conferência contínua: grava a leitura, `conferida_em` ou a divergência,
 *   e passa a divergência que voltou a bater a `conferida`) com a releitura do calendário do overbooking.
 * - "Tentar de novo" (`reserva:editar`, sem confirmação): depois de uma falha, de uma recusa ou de noites ocupadas. Sem POST e
 *   com o SCL igual, reabre a mesma linha; com POST, ou com o SCL mudado, nasce a versão nova com o `esperado` de agora
 *   (`abrirIntencao` com `forcar`). Nunca zera `buscas_sem_conclusao`, nunca abre `criar` para uma reserva com id no Beds24.
 * - "Deixar à mão" (`reserva:editar`): `manual`/`deixada_a_mao`; a operação sem POST vira `superada`.
 * - "Reenviar o que está no SCL" (`reserva:editar`): na reserva mudada no Beds24 por fora, a atualização com a versão nova.
 * - "Não existe, pode criar" (e `configuracao:editar`): a criação sem confirmação, 5 minutos depois do POST, vira `falhou`
 *   (encerrada pela equipe) e nasce a criação seguinte.
 * - "Já existe, vincular o id" (e `configuracao:editar`): relê o id e vincula pelas regras de adoção (`vincularRegistro`), com
 *   a conferência de depois do POST (`concluirVinculo`); sem a marca, só quando a credencial não lê a marca.
 * - "Passar ao sistema" (e `configuracao:editar`): a reserva confirmada antes de o imóvel ser ligado, sem a marca manual das
 *   datas fechadas, com as noites livres no Beds24, passa à fila da criação.
 * Ordem em todos (plano 1.15): a sessão e a permissão (na ação), a permissão de novo aqui (deny-by-default), a credencial da
 * organização da sessão (`organizacaoBeds24`, como o envio de calendário) e o deploy de produção (`ambienteDeEscritaDeReservas`):
 * nas prévias, nenhum botão lê nem escreve no Beds24. Os que reabrem o envio pedem também a escrita pronta e sem a pausa (sem
 * ela, a operação ficaria na fila sem sair e barraria a marca manual). Os que leem o Beds24 fazem os três tempos: a leitura do
 * SCL; o Beds24 sem transação aberta; e uma transação curta com a trava `beds24:<org>` (ocupada = recusa, sem esperar, como a
 * marca manual) que trava a reserva, revalida e grava — nunca uma trava aberta durante a rede. Nenhum botão faz POST nem põe
 * uma operação em `enviando`: os que reabrem o envio só enfileiram, e a rotina envia em até 10 minutos.
 * Quais botões valem para cada reserva é uma regra só (`motivoSemBotao`, pura): a ficha mostra por ela, e cada botão confere
 * por ela antes de ler e de novo sob a trava. Os textos de recusa são do SCL (nunca do Beds24); nenhum dado do hóspede nem valor.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { exigir, type Sessao } from "@/acesso/politica";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { beds24ReservasOperacoes, beds24ReservasSite, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { diaMesBr, FUSO_PADRAO, hojeISO, horaNoFuso } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { listarMapeamentosBeds24, organizacaoBeds24, quartoAcessivelEmBrl } from "./configuracao";
import { ambienteDeEscritaDeReservas, escritaReservasBeds24Pronta, impressaoCredencialBeds24 } from "./http";
import { procurarReservaDoSite, travarReservaDoSite, vincularRegistro } from "./reservas-site";
import { conferirReservaLigada, semAcessoNaConferencia } from "./reservas-site-conferencia";
import { type ConfigReservasBeds24, ensaioValeParaCredencial, lerConfigReservasBeds24, ligacaoDoImovel } from "./reservas-site-config";
import {
  abrirIntencao, cancelarAntesDeCriar, concluirVinculo, type Fechamento, type GanchosDoEnvio, lerOverbooking, type OpcoesDoEnvio, PRAZO_DA_FASE_2_MS, podeConcluirApagada, relerPorIdDaOperacao, type RelogioDoEnvio,
  resolverOperacaoEmCurso, vinculoDoImovel,
} from "./reservas-site-envio";
import { lerOcupantes, noitesDe } from "./reservas-site-ocupacao";
import {
  type AcaoBeds24, assinaturaAtualDoScl, assinaturaEsperado, type BotaoBeds24, BOTOES_DA_FICHA_BEDS24, BOTOES_DE_CONFIGURACAO_BEDS24, type BotaoDaFichaBeds24, detalheOperacaoBeds24, MINUTOS_ANTES_DE_CONCLUIR_BEDS24,
  operacaoEmCurso, podeConcluirIncertezaBeds24, SITUACOES_OPERACAO_ATIVAS,
} from "./reservas-site-regras";
import { existeMarcaIlegivelQueConta } from "./reservas-site-rotina";
import { ERRO_MARCA_TRAVA_OCUPADA, type TarefaOta, tarefasDasOtas } from "./reservas-site-tarefas";
import type { LeitorBeds24 } from "./tipos";
import { JANELA_RESERVA_EM_ANDAMENTO_MINUTOS, tentarTravaBeds24 } from "./trava";

const op = beds24ReservasOperacoes;
const acomp = beds24ReservasSite;
type LinhaDaOperacao = typeof op.$inferSelect;
type Acompanhamento = typeof acomp.$inferSelect;
type Reserva = typeof reservas.$inferSelect;
/** A operação `enviando` vencida: começou há mais de 6 min pelo relógio do banco, o mesmo que grava `iniciado_em`. */
const vencidaNoBanco = sql<boolean>`(${op.iniciadoEm} <= now() - make_interval(mins => ${JANELA_RESERVA_EM_ANDAMENTO_MINUTOS}))`;
/** Um id do Beds24 só com os caracteres esperados (o mesmo critério dos avisos e do `detalhe`). */
const ID_DO_BEDS24 = /^[A-Za-z0-9._:-]{1,64}$/;

/** O limite interno de cada botão da ficha (a página tem `maxDuration = 300`), o mesmo da volta da rotina e do ensaio. */
export const LIMITE_DO_BOTAO_MS = 240_000;
/** O relógio de um botão da ficha: o limite interno conta do clique. */
export const relogioDoBotaoBeds24 = (inicio: number = Date.now()): RelogioDoEnvio => ({ agora: () => new Date(), restanteMs: () => LIMITE_DO_BOTAO_MS - (Date.now() - inicio) });

/** Os botões que só mexem no SCL (nenhuma leitura do Beds24). */
export type OpcoesDosBotoes = { relogio: RelogioDoEnvio };
/** Os botões que leem o Beds24: o leitor injetado, obrigatório (null fora do deploy de produção ou sem credencial: nada é lido). */
export type OpcoesDosBotoesQueLeem = OpcoesDosBotoes & { leitor: LeitorBeds24 | null; prazoDaOperacao?: OpcoesDoEnvio["prazoDaOperacao"]; ganchos?: GanchosDoEnvio };

/**
 * O resultado de um botão que deu certo, para a ficha (`?beds24=`; os textos ficam no componente): `conferido` (o Beds24
 * está como o SCL), `diferente`, `equipe` (a reserva espera a equipe), `overbooking` (o Beds24 ainda informa), `lido` (a
 * leitura ficou gravada, a situação não mudou), `sem_conclusao`, `aguarde` (antes dos 5 minutos), `nova_tentativa` (o
 * sistema envia de novo na volta seguinte), `descartado` (mudou no meio), `na_fila`, `a_mao` e os três do vínculo.
 */
export const RESULTADOS_DOS_BOTOES_BEDS24 = [
  "conferido", "diferente", "equipe", "overbooking", "lido", "sem_conclusao", "aguarde", "nova_tentativa", "descartado", "na_fila", "a_mao", "vinculado", "vinculado_diferente", "vinculado_sem_marca",
] as const;
export type ResultadoDoBotaoBeds24 = (typeof RESULTADOS_DOS_BOTOES_BEDS24)[number];
export type ResultadoDoBotao = { ok: true; resultado: ResultadoDoBotaoBeds24 } | { ok: false; erro: string };

const feito = (resultado: ResultadoDoBotaoBeds24): ResultadoDoBotao => ({ ok: true, resultado });
const recusado = (erro: string): ResultadoDoBotao => ({ ok: false, erro });

// ---------------------------------------------------------------- textos de recusa (do SCL, nunca do Beds24)

export const ERRO_BOTAO_NAO_ENCONTRADA = "Reserva do site não encontrada.";
export const ERRO_BOTAO_OUTRA_ORGANIZACAO = "Esta credencial do Beds24 não está vinculada à sua organização: nada foi feito.";
export const ERRO_BOTAO_FORA_DA_PRODUCAO = "Os botões do Beds24 só valem no deploy de produção: nas prévias e no computador, nada é lido nem escrito lá.";
export const ERRO_BOTAO_SEM_LEITURA = "Sem uma credencial do Beds24 neste ambiente, nada pode ser lido lá.";
export const ERRO_BOTAO_ENVIO_DESLIGADO = "O envio de reservas ao Beds24 não está pronto (a chave BEDS24_ESCRITA_RESERVAS ou o refresh token): nada entraria na fila.";
export const ERRO_BOTAO_PAUSA = "A pausa geral está ligada em Integrações: nada entra na fila até retomar.";
export const ERRO_BOTAO_EM_ENVIO = "O sistema está enviando esta reserva ao Beds24 agora (ou há um envio dela sem conclusão): use Conferir agora, ou espere alguns minutos.";
export const ERRO_BOTAO_JA_NA_FILA = "Já há um envio desta reserva na fila: o sistema envia em até 10 minutos.";
export const ERRO_BOTAO_NADA_A_CONFERIR = "Nada a conferir no Beds24 para esta reserva agora.";
export const ERRO_BOTAO_NADA_A_TENTAR = "Não há envio parado desta reserva para tentar de novo (só depois de uma falha, de uma recusa ou de noites ocupadas).";
export const ERRO_BOTAO_CRIAR_COM_ID = "A reserva já está ligada a um registro do Beds24: o sistema nunca cria outra por cima.";
export const ERRO_BOTAO_NADA_A_DEIXAR = "Esta reserva não tem envio parado ou atrasado a deixar à mão agora.";
export const ERRO_BOTAO_JA_A_MAO = "A equipe já cuida desta reserva à mão.";
export const ERRO_BOTAO_ENCERRADA = "O acompanhamento desta reserva já foi encerrado.";
export const ERRO_BOTAO_NADA_A_REENVIAR = "Reenviar só vale quando a reserva confirmada foi mudada no Beds24 por fora (datas ou pessoas).";
export const ERRO_BOTAO_REATIVACAO = "A reserva foi cancelada no Beds24: o sistema ainda não volta a confirmá-la lá. No Beds24, volte-a para Confirmado, ou cancele pelo SCL, pela política.";
export const ERRO_BOTAO_APAGADA = "A reserva não está mais no Beds24 (apagada?): uma reserva apagada não pode ser atualizada. Confira no Beds24 e use Deixar à mão.";
export const ERRO_BOTAO_NADA_INCERTO = "Não há criação desta reserva sem confirmação no Beds24: Não existe, pode criar só vale nesse caso.";
export const ERRO_BOTAO_NADA_A_VINCULAR = "Vincular só vale para a reserva confirmada, sem id no Beds24, com a criação sem confirmação ou à espera da equipe.";
export const ERRO_BOTAO_ID_INVALIDO = "Informe o id da reserva no Beds24 (só números e letras).";
export const ERRO_BOTAO_SEM_MARCA_COM_ENSAIO = "Com a credencial que lê a marca, um registro sem a marca desta reserva não é dela: confira o id. Vincular sem a marca só vale quando a credencial não lê a marca.";
export const ERRO_BOTAO_ID_NAO_VOLTOU = "O id não voltou na leitura do Beds24: confira o número e tente de novo.";
export const ERRO_BOTAO_LEITURA_SEM_CONCLUSAO = "A leitura do Beds24 não concluiu (falhou, ou trouxe registro ilegível, repetido ou com a marca ambígua): nada mudou. Tente de novo em alguns minutos.";
export const ERRO_BOTAO_NADA_A_PASSAR = "Passar ao sistema só vale para a reserva confirmada antes de o imóvel ser ligado, que a equipe cuida à mão.";
export const ERRO_BOTAO_MARCADA_A_MAO = "A equipe marcou as datas fechadas à mão: o sistema nunca cria esta reserva por cima.";
export const ERRO_BOTAO_IMOVEL_DESLIGADO = "O imóvel não está ligado em Integrações: ligue-o antes de passar a reserva ao sistema.";
export const ERRO_BOTAO_SEM_VINCULO = "O imóvel não tem um vínculo único e válido com um quarto do Beds24 acessível em BRL: nada foi feito.";
export const ERRO_BOTAO_MUDOU = "A reserva mudou no meio (outra ação ou a rotina): nada foi feito. Atualize a página e confira.";
export const ERRO_BOTAO_NADA_A_ENFILEIRAR = "Nada entrou na fila: a reserva mudou no SCL e este envio não vale mais (o sistema decide na próxima volta). Atualize a página.";
/** A falha inesperada no meio de um botão (a ação mostra este texto; o que ficou em curso, a rotina resolve). */
export const ERRO_BOTAO_INTERROMPIDO = "O botão parou no meio, sem gravar o resultado: confira a ficha daqui a alguns minutos (o que ficou em curso, a rotina resolve).";
/** Antes dos 5 minutos desde o último POST (desenho 3.8: o Beds24 ainda pode gravar depois do nosso tempo-limite). */
export const erroAguardeOBeds24 = (ate: Date) => `Espere ${MINUTOS_ANTES_DE_CONCLUIR_BEDS24} minutos desde o último envio (até ${horaNoFuso(ate)}): o Beds24 ainda pode gravar.`;

// ---------------------------------------------------------------- quais botões valem (uma regra, um lugar)

/** Uma operação real da reserva (criar, atualizar ou cancelar), como os botões a leem, com `vencida` pelo relógio do banco. */
export type OperacaoDosBotoes = Pick<LinhaDaOperacao, "id" | "tipo" | "situacao" | "enviadoEm" | "beds24Id" | "pedido" | "alteracoes" | "detalhe"> & { vencida: boolean };

/** O que a regra dos botões lê: o ambiente, a reserva, o acompanhamento, as operações (da mais nova para a mais velha) e a tarefa. */
export type EstadoDosBotoes = {
  /** O deploy de produção (`ambienteDeEscritaDeReservas`): fora dele, nenhum botão. */
  ambiente: boolean;
  /** A escrita de reservas pronta (`escritaReservasBeds24Pronta`): os botões que reabrem o envio pedem. */
  pronta: boolean;
  pausada: boolean;
  imovelLigado: boolean;
  reserva: Pick<Reserva, "estado" | "beds24Id">;
  acompanhamento: Pick<Acompanhamento, "situacao" | "motivo" | "otaFechadaEm" | "otaFechadaPor"> | null;
  operacoes: readonly OperacaoDosBotoes[];
  /** A tarefa das OTAs desta reserva está atrasada (`tarefasDasOtas`: o envio passou dos 30 minutos). */
  atrasada: boolean;
  agora: Date;
};

const ehAcao = (t: string): t is AcaoBeds24 => t === "criar" || t === "atualizar" || t === "cancelar";
/** Na fila ou em curso: a operação ativa (`pendente`, `enviando`, `incerta`) ou a que ainda não terminou (`feita`, a pendente com POST). */
const naFilaOuEmCurso = (ops: readonly OperacaoDosBotoes[]) => ops.some((x) => (SITUACOES_OPERACAO_ATIVAS as readonly string[]).includes(x.situacao) || operacaoEmCurso(x));
/** O sistema está enviando agora: a `enviando` que ainda não venceu (os 6 minutos da fase 2 e da fase 3). */
const enviandoAgora = (ops: readonly OperacaoDosBotoes[]) => ops.some((x) => x.situacao === "enviando" && !x.vencida);
/** A operação em curso que "Conferir agora" resolve: a `incerta`, a `feita` e a `enviando` vencida (`resolverOperacaoEmCurso`). */
const aResolver = (x: OperacaoDosBotoes) => x.situacao === "incerta" || x.situacao === "feita" || (x.situacao === "enviando" && x.vencida);
/** A criação sem confirmação: a `incerta` sem o id do Beds24, com o POST tentado. */
const criacaoIncerta = (ops: readonly OperacaoDosBotoes[]) => ops.find((x) => x.tipo === "criar" && x.situacao === "incerta" && !x.beds24Id && x.enviadoEm !== null) ?? null;
/** O último POST tentado da reserva (`enviado_em`, nunca limpo). */
const ultimoEnvio = (ops: readonly OperacaoDosBotoes[]) => ops.reduce<Date | null>((m, x) => (x.enviadoEm && (!m || x.enviadoEm.getTime() > m.getTime()) ? x.enviadoEm : m), null);
const aguardeAte = (enviadoEm: Date) => new Date(enviadoEm.getTime() + MINUTOS_ANTES_DE_CONCLUIR_BEDS24 * 60_000);

/**
 * Por que o botão não vale agora para esta reserva (o texto da recusa), ou null = vale. Uma regra, um lugar: a ficha mostra
 * os botões por ela (`botoesDaFichaBeds24`), e cada botão confere por ela antes de ler e de novo sob a trava. As permissões
 * são de quem chama (a ficha esconde; a ação e o domínio recusam: `exigirBotao`).
 */
export function motivoSemBotao(b: BotaoDaFichaBeds24, e: EstadoDosBotoes): string | null {
  if (!e.ambiente) return ERRO_BOTAO_FORA_DA_PRODUCAO;
  const a = e.acompanhamento;
  const ops = e.operacoes;
  const reabre = b === "tentar_de_novo" || b === "reenviar" || b === "nao_existe" || b === "passar_ao_sistema";
  if (reabre && !e.pronta) return ERRO_BOTAO_ENVIO_DESLIGADO;
  if (reabre && e.pausada) return ERRO_BOTAO_PAUSA;
  if (a?.situacao === "encerrada") return ERRO_BOTAO_ENCERRADA;
  switch (b) {
    case "conferir_agora": {
      if (enviandoAgora(ops)) return ERRO_BOTAO_EM_ENVIO;
      if (ops.some(aResolver)) return null;
      if (a && e.reserva.beds24Id && (a.situacao === "conferida" || a.situacao === "divergente" || a.situacao === "aguardando_equipe")) return null;
      // A cancelada antes de ser criada que foi à equipe (a duplicada, a marca em registro inesperado, o candidato): a leitura de 6.3.
      if (a && e.reserva.estado === "cancelada" && !e.reserva.beds24Id && a.situacao === "aguardando_equipe") return null;
      return ERRO_BOTAO_NADA_A_CONFERIR;
    }
    case "tentar_de_novo": {
      const ultima = ops[0];
      if (!ultima || !["falhou", "recusada", "conflito"].includes(ultima.situacao)) return ERRO_BOTAO_NADA_A_TENTAR;
      if (naFilaOuEmCurso(ops)) return ERRO_BOTAO_JA_NA_FILA;
      if (!a || (a.situacao !== "conflito" && a.situacao !== "aguardando_equipe")) return ERRO_BOTAO_NADA_A_TENTAR;
      if (ultima.tipo === "criar" && (e.reserva.beds24Id || ops.some((x) => x.tipo === "criar" && x.situacao === "conferida"))) return ERRO_BOTAO_CRIAR_COM_ID;
      const ultimo = ultimoEnvio(ops);
      if (ultimo && !podeConcluirIncertezaBeds24(ultimo, e.agora)) return erroAguardeOBeds24(aguardeAte(ultimo));
      return null;
    }
    case "deixar_a_mao": {
      if (ops.some(operacaoEmCurso)) return ERRO_BOTAO_EM_ENVIO;
      if (a?.situacao === "manual") return ERRO_BOTAO_JA_A_MAO;
      if (a && (a.situacao === "conflito" || a.situacao === "divergente" || a.situacao === "aguardando_equipe")) return null;
      // Sem acompanhamento, `pendente` ou `em_envio`: só o envio atrasado (desenho 6.1: "a ficha oferece Deixar à mão").
      return (!a || a.situacao === "pendente" || a.situacao === "em_envio") && e.atrasada ? null : ERRO_BOTAO_NADA_A_DEIXAR;
    }
    case "reenviar": {
      if (a?.situacao !== "divergente") return ERRO_BOTAO_NADA_A_REENVIAR;
      if (a.motivo === "cancelada_no_beds24") return ERRO_BOTAO_REATIVACAO;
      if (a.motivo === "apagada_no_beds24") return ERRO_BOTAO_APAGADA;
      if (a.motivo !== "mudada_no_beds24" || e.reserva.estado !== "confirmada" || !e.reserva.beds24Id) return ERRO_BOTAO_NADA_A_REENVIAR;
      return naFilaOuEmCurso(ops) ? ERRO_BOTAO_JA_NA_FILA : null;
    }
    case "nao_existe": {
      const incerta = criacaoIncerta(ops);
      if (!incerta || e.reserva.beds24Id || a?.situacao === "manual") return ERRO_BOTAO_NADA_INCERTO;
      return podeConcluirIncertezaBeds24(incerta.enviadoEm!, e.agora) ? null : erroAguardeOBeds24(aguardeAte(incerta.enviadoEm!));
    }
    case "vincular": {
      if (e.reserva.estado !== "confirmada" || e.reserva.beds24Id || !a || a.situacao === "manual") return ERRO_BOTAO_NADA_A_VINCULAR;
      if (enviandoAgora(ops)) return ERRO_BOTAO_EM_ENVIO;
      if (criacaoIncerta(ops)) return null;
      return a.situacao === "aguardando_equipe" && (a.motivo === "incerta" || a.motivo === "duplicada" || a.motivo === "marca_em_registro_inesperado") && ops.some((x) => x.tipo === "criar") ? null : ERRO_BOTAO_NADA_A_VINCULAR;
    }
    case "passar_ao_sistema": {
      if (a?.situacao !== "manual" || a.motivo !== "anterior_a_ligar") return ERRO_BOTAO_NADA_A_PASSAR;
      // A marca manual guarda o motivo da linha que já era `manual` (6.4): com ela, a equipe fechou à mão (o M8.3 nunca cria por cima).
      if (a.otaFechadaPor) return ERRO_BOTAO_MARCADA_A_MAO;
      if (a.otaFechadaEm || e.reserva.estado !== "confirmada" || e.reserva.beds24Id) return ERRO_BOTAO_NADA_A_PASSAR;
      if (naFilaOuEmCurso(ops)) return ERRO_BOTAO_JA_NA_FILA;
      return e.imovelLigado ? null : ERRO_BOTAO_IMOVEL_DESLIGADO;
    }
  }
}

/** Os botões que valem para a reserva agora (códigos; a permissão de cada um é de quem mostra), na ordem da ficha. */
export const botoesDaFichaBeds24 = (e: EstadoDosBotoes): BotaoDaFichaBeds24[] => BOTOES_DA_FICHA_BEDS24.filter((b) => motivoSemBotao(b, e) === null);

/** A reserva do site, o acompanhamento, as operações e o estado dos botões, só leitura (na transação de quem chama, se houver). */
export type LidoDosBotoes = { reserva: Reserva; acompanhamento: Acompanhamento | null; operacoes: OperacaoDosBotoes[]; config: ConfigReservasBeds24; estado: EstadoDosBotoes };

/**
 * Lê o que a regra dos botões precisa (a tarefa das OTAs desta reserva, pela mesma função do Início; a ficha passa as que já
 * leu). null = não é do site, ou de outra empresa.
 */
export async function lerEstadoDosBotoes(db: Db, org: string, reservaId: string, env: NodeJS.ProcessEnv, agora: Date, o: { tarefas?: readonly TarefaOta[] } = {}): Promise<LidoDosBotoes | null> {
  if (!uuidValido(reservaId)) return null;
  const [reserva] = await db.select().from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, org), eq(reservas.fonte, "site")));
  if (!reserva) return null;
  const [a] = await db.select().from(acomp).where(and(eq(acomp.organizacaoId, org), eq(acomp.reservaId, reservaId)));
  const linhas = await db
    .select({ o: op, vencida: vencidaNoBanco })
    .from(op)
    .where(and(eq(op.organizacaoId, org), eq(op.reservaId, reservaId), eq(op.modo, "real"), inArray(op.tipo, ["criar", "atualizar", "cancelar"])))
    .orderBy(desc(op.iniciadoEm), desc(op.chave));
  const operacoes = linhas.map((x) => ({ ...x.o, vencida: Boolean(x.vencida) }));
  const config = await lerConfigReservasBeds24(db, org);
  const tarefas = o.tarefas ?? (await tarefasDasOtas(db, org, agora, env, { reservaIds: [reservaId] })).tarefas;
  const acompanhamento = a ?? null;
  return {
    reserva, acompanhamento, operacoes, config,
    estado: {
      ambiente: ambienteDeEscritaDeReservas(env), pronta: escritaReservasBeds24Pronta(env), pausada: config.pausado !== null, imovelLigado: ligacaoDoImovel(config, reserva.imovelId) !== null,
      reserva, acompanhamento, operacoes, atrasada: tarefas.some((t) => t.estado === "atrasada"), agora,
    },
  };
}

// ---------------------------------------------------------------- as travas comuns

/** A permissão do botão no domínio (a ação já conferiu): `reserva:editar`, e `configuracao:editar` nos de configuração. */
function exigirBotao(sessao: Sessao, b: BotaoDaFichaBeds24) {
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  if ((BOTOES_DE_CONFIGURACAO_BEDS24 as readonly string[]).includes(b)) exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
}

/**
 * As travas de todo botão (plano 1.15, passos 3 a 5): a permissão de novo (deny-by-default), a credencial da organização da
 * sessão (a credencial é global e atende uma organização só) e o deploy de produção. Depois, a leitura do SCL e a regra do
 * botão (`motivoSemBotao`). Devolve a leitura, ou a recusa.
 */
async function antesDoBotao(db: Db, sessao: Sessao, b: BotaoDaFichaBeds24, reservaId: string, env: NodeJS.ProcessEnv, agora: Date): Promise<{ ok: true; l: LidoDosBotoes } | { ok: false; erro: string }> {
  exigirBotao(sessao, b);
  if (!uuidValido(reservaId)) return { ok: false, erro: ERRO_BOTAO_NAO_ENCONTRADA };
  try {
    if ((await organizacaoBeds24(db, env)) !== sessao.organizacaoId) return { ok: false, erro: ERRO_BOTAO_OUTRA_ORGANIZACAO };
  } catch {
    return { ok: false, erro: ERRO_BOTAO_OUTRA_ORGANIZACAO };
  }
  if (!ambienteDeEscritaDeReservas(env)) return { ok: false, erro: ERRO_BOTAO_FORA_DA_PRODUCAO };
  const l = await lerEstadoDosBotoes(db, sessao.organizacaoId, reservaId, env, agora);
  if (!l) return { ok: false, erro: ERRO_BOTAO_NAO_ENCONTRADA };
  const sem = motivoSemBotao(b, l.estado);
  return sem ? { ok: false, erro: sem } : { ok: true, l };
}

/** Desfaz a transação do botão sem gravar nada (a fila não aceitou a intenção, ou a revalidação recusou), com o texto da recusa. */
class Desfeito extends Error {
  constructor(readonly erro: string) {
    super(erro);
  }
}

/**
 * O terceiro tempo (desenho 3.6), uma transação curta: `lock_timeout` de 15 s, a trava `beds24:<org>` sem esperar (ocupada =
 * recusa, como a marca manual: a recusa é por reserva), a reserva travada (imóvel `no key update`, reserva, acompanhamento) e
 * a leitura de novo, com a regra do botão conferida outra vez (`motivoSemBotao`). `Desfeito`, lançado dentro, desfaz tudo e
 * vira a recusa.
 */
async function sobATrava(
  db: Db, org: string, b: BotaoDaFichaBeds24, reservaId: string, env: NodeJS.ProcessEnv, agora: Date, nivel: "update" | "no key update", f: (tx: Db, l: LidoDosBotoes) => Promise<ResultadoDoBotao>,
): Promise<ResultadoDoBotao> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '15s'`);
      if (!(await tentarTravaBeds24(tx, org))) return recusado(ERRO_MARCA_TRAVA_OCUPADA);
      if (!(await travarReservaDoSite(tx, org, reservaId, nivel))) return recusado(ERRO_BOTAO_NAO_ENCONTRADA);
      const l = await lerEstadoDosBotoes(tx, org, reservaId, env, agora);
      if (!l) return recusado(ERRO_BOTAO_NAO_ENCONTRADA);
      const sem = motivoSemBotao(b, l.estado);
      return sem ? recusado(sem) : f(tx, l);
    });
  } catch (e) {
    if (e instanceof Desfeito) return recusado(e.erro);
    throw e;
  }
}

/** A mesma operação que o primeiro tempo leu (a situação, o `enviado_em` e o id): senão, outra ação a mudou no meio. */
const mesmaOperacao = (agora: OperacaoDosBotoes | undefined, lida: OperacaoDosBotoes) =>
  Boolean(agora) && agora!.id === lida.id && agora!.situacao === lida.situacao && (agora!.enviadoEm?.getTime() ?? null) === (lida.enviadoEm?.getTime() ?? null) && agora!.beds24Id === lida.beds24Id;

/** O botão que abriu a operação (`detalhe.porBotao`), pela forma fechada. */
const comOBotao = (tx: Db, operacaoId: string, atual: unknown, porBotao: BotaoBeds24) => tx.update(op).set({ detalhe: detalheOperacaoBeds24({ ...detalheOperacaoBeds24(atual), porBotao }) }).where(eq(op.id, operacaoId));

/** A auditoria de um botão, com o autor: só códigos (a situação e o motivo no Beds24, a operação), nada do hóspede nem valor. */
const auditar = (tx: Db, sessao: Sessao, reservaId: string, acao: string, mudancas: Record<string, [unknown, unknown]>) =>
  registrarAuditoria(tx, { organizacaoId: sessao.organizacaoId, usuarioId: sessao.usuarioId, acao: `beds24.reserva.${acao}`, entidade: "reserva", entidadeId: reservaId, mudancas });

/**
 * Enfileira a intenção pelo trabalhador (`abrirIntencao` no modo que só enfileira, com `forcar`: desenho 3.3 e plano 1.2), na
 * transação de quem chama: só a operação `pendente` da ação pedida, o acompanhamento `pendente`, motivo nulo e
 * `proxima_tentativa_em = agora`. Qualquer outra saída desfaz a transação inteira (`Desfeito`): nada fica pela metade.
 */
async function enfileirar(tx: Db, org: string, reservaId: string, acao: AcaoBeds24, env: NodeJS.ProcessEnv, agora: Date, porBotao: BotaoBeds24): Promise<string> {
  const ab = await abrirIntencao(tx, org, reservaId, { agora, env, tipos: [acao], soEnfileirar: true, forcar: acao });
  if (ab.saida === "parar_volta") throw new Desfeito(ab.motivo === "pausa" ? ERRO_BOTAO_PAUSA : ERRO_MARCA_TRAVA_OCUPADA);
  if (ab.saida !== "enfileirada") throw new Desfeito(ERRO_BOTAO_NADA_A_ENFILEIRAR);
  const [linha] = await tx.select({ detalhe: op.detalhe }).from(op).where(eq(op.id, ab.operacaoId));
  await comOBotao(tx, ab.operacaoId, linha?.detalhe, porBotao);
  return ab.operacaoId;
}

/** O fechamento da saída em curso (`resolverOperacaoEmCurso`, `cancelarAntesDeCriar`) como o resultado do "Conferir agora". */
function resultadoDoFechamento(f: Fechamento): ResultadoDoBotaoBeds24 {
  switch (f) {
    case "conferida":
    case "encerrada":
      return "conferido";
    case "divergente":
      return "diferente";
    case "aguardando_equipe":
    case "recusada":
    case "conflito":
    case "manual":
      return "equipe";
    case "incerta":
    case "feita":
      return "sem_conclusao";
    case "aguardar":
      return "aguarde";
    case "nova_versao":
    case "pendente":
    case "adotada":
    case "falha":
    case "superada":
      return "nova_tentativa";
    case "descartada":
      return "descartado";
  }
}

// ---------------------------------------------------------------- "Conferir agora" (só lê)

/**
 * "Conferir agora" (`reserva:editar`; plano 1.15 e P8): só lê, pelo leitor injetado (o cliente das reservas, ou o leitor com a
 * chave desligada, só no deploy de produção), e nunca faz POST nem toca o ensaio. Na ordem:
 * - a operação em curso (a `incerta`, a `feita`, a `enviando` vencida): a mesma saída do passo 1 da rotina
 *   (`resolverOperacaoEmCurso`), com os 5 minutos e a revalidação dela sob a trava;
 * - a cancelada antes de ser criada que foi à equipe: a leitura de 6.3 de novo (`cancelarAntesDeCriar`: sem registro vivo com
 *   a marca, as datas reabertas e `encerrada`);
 * - a reserva ligada (`conferida`, `divergente` ou à espera da equipe): a releitura por id e, no overbooking, o calendário das
 *   noites, sem transação aberta; depois, sob a trava, a mesma conferência da rotina (`conferirReservaLigada`; o id que não
 *   voltou só conclui "apagada" com a credencial e o quarto que permitem, senão `aguardando_equipe`/`sem_permissao`), e o
 *   motivo do overbooking sai quando as noites voltam a `livres >= 0` (desenho 4.4).
 */
export async function conferirAgoraNoBeds24(db: Db, sessao: Sessao, reservaId: string, env: NodeJS.ProcessEnv, o: OpcoesDosBotoesQueLeem): Promise<ResultadoDoBotao> {
  const agora = o.relogio.agora();
  const antes = await antesDoBotao(db, sessao, "conferir_agora", reservaId, env, agora);
  if (!antes.ok) return recusado(antes.erro);
  const { leitor } = o;
  if (!leitor) return recusado(ERRO_BOTAO_SEM_LEITURA);
  const org = sessao.organizacaoId;
  const { l } = antes;
  const opcoes: OpcoesDoEnvio = { env, relogio: o.relogio, prazoDaOperacao: o.prazoDaOperacao, ganchos: o.ganchos };
  const emCurso = l.operacoes.find(aResolver);
  if (emCurso) return feito(resultadoDoFechamento((await resolverOperacaoEmCurso(db, org, emCurso.id, leitor, opcoes)).fechamento));
  if (l.reserva.estado === "cancelada" && !l.reserva.beds24Id) return feito(resultadoDoFechamento((await cancelarAntesDeCriar(db, org, reservaId, leitor, opcoes)).fechamento));
  return conferirALigada(db, org, l, leitor, env, o, sessao.usuarioId);
}

/**
 * A reserva ligada (o id na reserva): a releitura por id e o calendário do overbooking, e a conferência sob a trava. A
 * auditoria leva quem apertou o botão (`autorId`).
 */
async function conferirALigada(db: Db, org: string, l: LidoDosBotoes, leitor: LeitorBeds24, env: NodeJS.ProcessEnv, o: OpcoesDosBotoesQueLeem, autorId: string): Promise<ResultadoDoBotao> {
  const id = l.reserva.beds24Id!;
  const a = l.acompanhamento!;
  const agora = o.relogio.agora();
  const quarto = a.roomId ?? a.esperado?.quarto ?? null;
  const comOverbooking = a.situacao === "conferida" && a.motivo === "noites_ocupadas";
  const hoje = hojeISO(FUSO_PADRAO, agora);
  // Segundo tempo: o Beds24, sem transação aberta, com o prazo da operação (as leituras em série não passam dele).
  o.prazoDaOperacao?.(AbortSignal.timeout(PRAZO_DA_FASE_2_MS));
  let lido: Awaited<ReturnType<typeof relerPorIdDaOperacao>>;
  let podeApagada = false;
  let overbooking: Awaited<ReturnType<typeof lerOverbooking>> | null = null;
  try {
    await o.ganchos?.antesDaFase2?.(null);
    lido = await relerPorIdDaOperacao(leitor, id);
    if (lido.funcionou && !lido.registro) {
      // O id que não voltou só conclui "apagada" com a credencial guardada igual à de agora e o quarto acessível em BRL.
      const quartos = await leitor.quartos().then((q) => q.itens, () => null);
      if (!quartos) lido = { funcionou: false };
      else podeApagada = Boolean(a.propertyId && a.roomId) && podeConcluirApagada(quartos, { propertyId: a.propertyId!, quarto: a.roomId!, credencialGuardada: a.credencial }, env);
    }
    if (lido.funcionou && lido.registro && comOverbooking && quarto && a.esperado) overbooking = await lerOverbooking(leitor, quarto, noitesDe(a.esperado.chegada, a.esperado.saida).filter((n) => n >= hoje));
  } finally {
    o.prazoDaOperacao?.(null);
  }
  if (!lido.funcionou) return feito("sem_conclusao");
  const registro = lido.registro;
  // Terceiro tempo: a trava, a reserva travada pela conferência e a gravação revalidada (a leitura mais velha que a guardada não grava).
  return db.transaction(async (tx): Promise<ResultadoDoBotao> => {
    await tx.execute(sql`set local lock_timeout = '15s'`);
    if (!(await tentarTravaBeds24(tx, org))) return recusado(ERRO_MARCA_TRAVA_OCUPADA);
    if (!registro && !podeApagada) {
      if (await semAcessoNaConferencia(tx, org, l.reserva.id, id, agora)) return feito("equipe");
      return feito(a.situacao === "aguardando_equipe" ? "equipe" : "descartado");
    }
    const c = await conferirReservaLigada(tx, org, l.reserva.id, id, registro, agora, autorId);
    if (c.resultado === "descartada" || c.resultado === "antiga" || c.resultado === "sem_acompanhamento") return feito("descartado");
    if (c.resultado === "divergente") return feito("diferente");
    if (c.resultado === "lido") return feito("lido");
    if (!comOverbooking) return feito("conferido");
    if (!overbooking?.funcionou) return feito("sem_conclusao");
    if (overbooking.noites.length) return feito("overbooking");
    // As noites voltaram a `livres >= 0`: o motivo do overbooking sai (a reserva continua `conferida`, com as marcas).
    const [saiu] = await tx
      .update(acomp)
      .set({ motivo: null, atualizadoEm: agora })
      .where(and(eq(acomp.id, a.id), eq(acomp.situacao, "conferida"), eq(acomp.motivo, "noites_ocupadas")))
      .returning({ id: acomp.id });
    if (saiu) await registrarAuditoria(tx, { organizacaoId: org, usuarioId: autorId, acao: "beds24.reserva.conferir", entidade: "reserva", entidadeId: l.reserva.id, mudancas: { motivoNoBeds24: ["noites_ocupadas", null] } });
    return feito("conferido");
  });
}

// ---------------------------------------------------------------- "Tentar de novo" (só enfileira)

/**
 * "Tentar de novo" (`reserva:editar`, sem `BotaoConfirmar`; plano 1.15, P2 e P9): só depois de uma falha, de uma recusa ou de
 * noites ocupadas (a última operação `falhou`, `recusada` ou `conflito`), nada na fila e 5 minutos depois do último POST.
 * - Sem POST e com o SCL igual ao pedido dela (a falha antes do POST, o conflito): a MESMA linha volta a `pendente` (desenho
 *   3.3, a exceção da linha terminal), gravada com `where situacao = <lida> and enviado_em is null`.
 * - Com POST, ou com o SCL mudado (a equipe mudou as datas da reserva em conflito): a versão nova, com o `esperado` de agora
 *   (`abrirIntencao` com `forcar`: desenho 3.3, "Se o SCL mudou, nasce uma versão nova").
 * Nos dois, o acompanhamento passa a `pendente`, motivo nulo e `proxima_tentativa_em = agora` (a régua não responde mais
 * "aguardando a equipe"), e a rotina envia em até 10 minutos. Nunca zera `buscas_sem_conclusao` (desenho 8) nem abre `criar`
 * para uma reserva com id no Beds24 (só a busca pela marca evitaria a duplicata).
 */
export async function tentarDeNovoNoBeds24(db: Db, sessao: Sessao, reservaId: string, env: NodeJS.ProcessEnv, o: OpcoesDosBotoes): Promise<ResultadoDoBotao> {
  const agora = o.relogio.agora();
  const antes = await antesDoBotao(db, sessao, "tentar_de_novo", reservaId, env, agora);
  if (!antes.ok) return recusado(antes.erro);
  const org = sessao.organizacaoId;
  const lida = antes.l.operacoes[0];
  return sobATrava(db, org, "tentar_de_novo", reservaId, env, agora, "no key update", async (tx, l) => {
    const ultima = l.operacoes[0];
    if (!mesmaOperacao(ultima, lida) || !ehAcao(ultima.tipo)) return recusado(ERRO_BOTAO_MUDOU);
    const a = l.acompanhamento!;
    const quarto = a.roomId ?? ultima.pedido?.quarto ?? null;
    const mesmoScl = Boolean(quarto && ultima.pedido) && assinaturaAtualDoScl(l.reserva, quarto!) === assinaturaEsperado(ultima.pedido!);
    if (!ultima.enviadoEm && mesmoScl) {
      const [reaberta] = await tx
        .update(op)
        .set({ situacao: "pendente", terminadoEm: null, erro: "", detalhe: detalheOperacaoBeds24({ ...detalheOperacaoBeds24(ultima.detalhe), porBotao: "tentar_de_novo" }) })
        .where(and(eq(op.id, ultima.id), eq(op.situacao, ultima.situacao), isNull(op.enviadoEm)))
        .returning({ id: op.id });
      if (!reaberta) return recusado(ERRO_BOTAO_MUDOU);
      await tx.update(acomp).set({ situacao: "pendente", motivo: null, proximaTentativaEm: agora, atualizadoEm: agora }).where(eq(acomp.id, a.id));
    } else {
      await enfileirar(tx, org, reservaId, ultima.tipo, env, agora, "tentar_de_novo");
    }
    await auditar(tx, sessao, reservaId, "tentar_de_novo", { situacaoNoBeds24: [a.situacao, "pendente"], motivoNoBeds24: [a.motivo, null], operacao: [ultima.situacao, "pendente"] });
    return feito("na_fila");
  });
}

// ---------------------------------------------------------------- "Deixar à mão"

/**
 * "Deixar à mão" (`reserva:editar`, com `BotaoConfirmar`; desenho 6.1 e 6.6, plano 1.15): `manual`/`deixada_a_mao` — o
 * sistema nunca mais escreve esta reserva no Beds24, e as tarefas à mão voltam (com a marca "Datas fechadas nas OTAs"). Vale
 * no conflito, na divergência, no aguardando a equipe (a duplicada, a marca em registro inesperado, os bloqueios e a falta de
 * noites livres, com a operação já terminal) e no envio atrasado; recusa com uma operação em curso (`enviando`, `incerta`,
 * `feita`). A operação sem POST (a da fila) vira `superada`. Sem acompanhamento, cria a linha sem o quarto, como a marca manual
 * da 6.4 (o quarto guardado é o sinal de "criada pelo sistema"). Não lê o Beds24: só o terceiro tempo.
 */
export async function deixarAMaoNoBeds24(db: Db, sessao: Sessao, reservaId: string, env: NodeJS.ProcessEnv, o: OpcoesDosBotoes): Promise<ResultadoDoBotao> {
  const agora = o.relogio.agora();
  const antes = await antesDoBotao(db, sessao, "deixar_a_mao", reservaId, env, agora);
  if (!antes.ok) return recusado(antes.erro);
  const org = sessao.organizacaoId;
  return sobATrava(db, org, "deixar_a_mao", reservaId, env, agora, "no key update", async (tx, l) => {
    const a = l.acompanhamento;
    const superadas = await tx
      .update(op)
      .set({ situacao: "superada", terminadoEm: sql`now()`, detalhe: sql`${op.detalhe} || ${JSON.stringify({ porBotao: "deixar_a_mao" })}::jsonb` })
      .where(and(eq(op.organizacaoId, org), eq(op.reservaId, reservaId), eq(op.modo, "real"), eq(op.situacao, "pendente"), isNull(op.enviadoEm)))
      .returning({ id: op.id });
    const marca = { situacao: "manual" as const, motivo: "deixada_a_mao" as const, proximaTentativaEm: null, atualizadoEm: agora };
    const [gravado] = a
      ? await tx.update(acomp).set(marca).where(and(eq(acomp.id, a.id), eq(acomp.situacao, a.situacao))).returning({ id: acomp.id })
      : await tx
          .insert(acomp)
          .values({ organizacaoId: org, reservaId, imovelId: l.reserva.imovelId, referencia: l.reserva.codigo, ...marca })
          .onConflictDoNothing({ target: [acomp.organizacaoId, acomp.reservaId] })
          .returning({ id: acomp.id });
    if (!gravado) throw new Desfeito(ERRO_BOTAO_MUDOU);
    await auditar(tx, sessao, reservaId, "deixar_a_mao", { situacaoNoBeds24: [a?.situacao ?? null, "manual"], motivoNoBeds24: [a?.motivo ?? null, "deixada_a_mao"], operacoesSuperadas: [null, superadas.length] });
    return feito("a_mao");
  });
}

// ---------------------------------------------------------------- "Reenviar o que está no SCL"

/**
 * "Reenviar o que está no SCL" (`reserva:editar`, com `BotaoConfirmar`; desenho 5, plano 1.15): só na reserva confirmada
 * mudada no Beds24 por fora (`divergente`/`mudada_no_beds24`, datas ou pessoas). A atualização com a versão nova e `pendente`,
 * pela mesma função da fase 1 no modo que só enfileira, com `forcar` (a mesma intenção já enviada, que o Beds24 perdeu, também
 * abre a versão seguinte), sem rede; o acompanhamento passa a `pendente`. A rotina envia com a conferência antes: as noites
 * novas saem da releitura por id da fase 2 (desenho 4.2), nunca do `esperado`. Recusa a cancelada no Beds24 (voltar a
 * confirmar fica para depois, M8.3d) e a apagada (não pode ser atualizada).
 */
export async function reenviarAoBeds24(db: Db, sessao: Sessao, reservaId: string, env: NodeJS.ProcessEnv, o: OpcoesDosBotoes): Promise<ResultadoDoBotao> {
  const agora = o.relogio.agora();
  const antes = await antesDoBotao(db, sessao, "reenviar", reservaId, env, agora);
  if (!antes.ok) return recusado(antes.erro);
  const org = sessao.organizacaoId;
  return sobATrava(db, org, "reenviar", reservaId, env, agora, "no key update", async (tx, l) => {
    const a = l.acompanhamento!;
    await enfileirar(tx, org, reservaId, "atualizar", env, agora, "reenviar");
    await auditar(tx, sessao, reservaId, "reenviar", { situacaoNoBeds24: [a.situacao, "pendente"], motivoNoBeds24: [a.motivo, null] });
    return feito("na_fila");
  });
}

// ---------------------------------------------------------------- "Não existe, pode criar"

/**
 * "Não existe, pode criar" (`reserva:editar` + `configuracao:editar`, com `BotaoConfirmar`; desenho 3.8, plano 1.15 e P10): só
 * na criação sem confirmação (`incerta`, sem o id do Beds24) e 5 minutos depois do POST. Numa transação só, sem rede: a
 * incerta vira `falhou` com `detalhe.encerradaPelaEquipe` (não conta como nova tentativa automática), gravada com
 * `where situacao = 'incerta' and enviado_em = <lido>`; `buscas_sem_conclusao` volta a zero (a equipe resolveu a incerteza);
 * e a criação seguinte nasce na fila (`abrirIntencao`, versão nova, só enfileira), com o acompanhamento `pendente`.
 */
export async function naoExisteNoBeds24(db: Db, sessao: Sessao, reservaId: string, env: NodeJS.ProcessEnv, o: OpcoesDosBotoes): Promise<ResultadoDoBotao> {
  const agora = o.relogio.agora();
  const antes = await antesDoBotao(db, sessao, "nao_existe", reservaId, env, agora);
  if (!antes.ok) return recusado(antes.erro);
  const org = sessao.organizacaoId;
  const lida = criacaoIncerta(antes.l.operacoes)!;
  return sobATrava(db, org, "nao_existe", reservaId, env, agora, "no key update", async (tx, l) => {
    const incerta = criacaoIncerta(l.operacoes);
    if (!incerta || !mesmaOperacao(incerta, lida)) return recusado(ERRO_BOTAO_MUDOU);
    const [encerrada] = await tx
      .update(op)
      .set({ situacao: "falhou", terminadoEm: sql`now()`, detalhe: detalheOperacaoBeds24({ ...detalheOperacaoBeds24(incerta.detalhe), encerradaPelaEquipe: true, porBotao: "nao_existe" }) })
      .where(and(eq(op.id, incerta.id), eq(op.situacao, "incerta"), eq(op.enviadoEm, incerta.enviadoEm!), isNull(op.beds24Id)))
      .returning({ id: op.id });
    if (!encerrada) return recusado(ERRO_BOTAO_MUDOU);
    const a = l.acompanhamento;
    if (a) await tx.update(acomp).set({ buscasSemConclusao: 0, atualizadoEm: agora }).where(eq(acomp.id, a.id));
    await enfileirar(tx, org, reservaId, "criar", env, agora, "nao_existe");
    await auditar(tx, sessao, reservaId, "nao_existe", { operacao: ["incerta", "falhou"], situacaoNoBeds24: [a?.situacao ?? null, "pendente"], motivoNoBeds24: [a?.motivo ?? null, null] });
    return feito("na_fila");
  });
}

// ---------------------------------------------------------------- "Já existe, vincular o id ___"

/**
 * "Já existe, vincular o id ___" (`reserva:editar` + `configuracao:editar`, com `BotaoConfirmar` e o campo do id; desenho 3.8
 * e 3.5, plano 1.15 e P10), em três tempos — a operação `vincular` nunca pode ser ativa (o índice `uma_ativa` já tem a
 * `incerta`):
 * (a) valida no SCL (a reserva confirmada sem id, a criação sem confirmação ou à espera da equipe; a credencial que lê a marca);
 * (b) relê o id e procura a marca no quarto, sem transação aberta;
 * (c) sob a trava, valida de novo (a mesma criação, a mesma credencial) e vincula pelas regras de adoção (`vincularRegistro`:
 *     o id na reserva, a criação em curso em `feita`, a auditoria com o autor), com a conferência de depois do POST
 *     (`concluirVinculo`: `conferida` com as marcas, ou `divergente`).
 * Na `duplicada`, aceita um dos ids quando os outros registros nossos com a marca estão `cancelled` (a equipe os cancelou no
 * Beds24); senão recusa com a lista. Sem a marca, só quando a credencial não lê a marca (o motivo `marca_ilegivel` que conta,
 * ou sem ensaio válido para ela), com a segunda confirmação (`semMarca`): o vínculo fica `divergente`/`marca_ilegivel` e nunca
 * grava as marcas das OTAs. Com a credencial que lê a marca, um registro sem marca não é nosso: recusa.
 */
export async function vincularIdDoBeds24(db: Db, sessao: Sessao, reservaId: string, entrada: { beds24Id: string; semMarca: boolean }, env: NodeJS.ProcessEnv, o: OpcoesDosBotoesQueLeem): Promise<ResultadoDoBotao> {
  const agora = o.relogio.agora();
  const antes = await antesDoBotao(db, sessao, "vincular", reservaId, env, agora);
  if (!antes.ok) return recusado(antes.erro);
  const { leitor } = o;
  if (!leitor) return recusado(ERRO_BOTAO_SEM_LEITURA);
  const id = entrada.beds24Id.trim();
  if (!ID_DO_BEDS24.test(id)) return recusado(ERRO_BOTAO_ID_INVALIDO);
  const org = sessao.organizacaoId;
  const { l } = antes;
  const a = l.acompanhamento!;
  if (!a.esperado) return recusado(ERRO_BOTAO_NADA_A_VINCULAR);
  const leMarca = async (x: Db) => ensaioValeParaCredencial(await lerConfigReservasBeds24(x, org), impressaoCredencialBeds24(env)) && !(await existeMarcaIlegivelQueConta(x, org, agora));
  if (entrada.semMarca && (await leMarca(db))) return recusado(ERRO_BOTAO_SEM_MARCA_COM_ENSAIO);
  const criar = criacaoIncerta(l.operacoes) ?? l.operacoes.find((x) => x.tipo === "criar")!;
  const quarto = a.roomId ?? a.esperado.quarto;

  // Segundo tempo: o id relido e a busca da marca no quarto (os outros registros com ela), sem transação aberta.
  o.prazoDaOperacao?.(AbortSignal.timeout(PRAZO_DA_FASE_2_MS));
  let lido: Awaited<ReturnType<typeof relerPorIdDaOperacao>>;
  let comMarca: Awaited<ReturnType<typeof procurarReservaDoSite>> | null = null;
  try {
    await o.ganchos?.antesDaFase2?.(null);
    lido = await relerPorIdDaOperacao(leitor, id);
    const duplicadas = detalheOperacaoBeds24(criar.detalhe).duplicadas ?? [];
    if (lido.funcionou && lido.registro && !entrada.semMarca) comMarca = await procurarReservaDoSite(leitor, { referencia: l.reserva.codigo, quarto, chegada: a.esperado.chegada, idsConhecidos: [id, ...duplicadas] });
  } finally {
    o.prazoDaOperacao?.(null);
  }
  if (!lido.funcionou || (comMarca && !comMarca.funcionou)) return recusado(ERRO_BOTAO_LEITURA_SEM_CONCLUSAO);
  const registro = lido.registro;
  if (!registro) return recusado(ERRO_BOTAO_ID_NAO_VOLTOU);

  // Terceiro tempo: a reserva `for update` (o `beds24_id` muda), a mesma criação e a mesma credencial, e o vínculo.
  return sobATrava(db, org, "vincular", reservaId, env, agora, "update", async (tx, agoraL) => {
    const criarAgora = agoraL.operacoes.find((x) => x.id === criar.id);
    if (!criarAgora || !mesmaOperacao(criarAgora, criar) || !agoraL.acompanhamento) return recusado(ERRO_BOTAO_MUDOU);
    if (entrada.semMarca && (await leMarca(tx))) return recusado(ERRO_BOTAO_SEM_MARCA_COM_ENSAIO);
    const v = await vincularRegistro(tx, org, reservaId, registro, comMarca?.funcionou ? comMarca.comMarca : [], { semMarca: entrada.semMarca, autorId: sessao.usuarioId });
    if (!v.vinculado) {
      switch (v.motivo) {
        case "sem_acompanhamento":
          return recusado(ERRO_BOTAO_NADA_A_VINCULAR);
        case "duplicada":
          return recusado(`Há outros registros com a marca desta reserva ainda vivos no Beds24: cancele no Beds24 (não apague): ${v.ids.join(", ")}.`);
        case "id_de_outra_reserva":
          return recusado(`O registro ${v.id} do Beds24 já está ligado a outra reserva do SCL: nada foi vinculado.`);
        case "sem_marca":
          return recusado(`O registro ${v.id} não voltou com a marca desta reserva: nada foi vinculado. Se a credencial não lê a marca, marque "sem a marca" e confirme de novo.`);
        case "nao_bate":
          return recusado(`O registro ${v.id} não bate com a reserva (a situação, o quarto, as datas, a marca ou a origem): nada foi vinculado.`);
      }
    }
    const [travada] = await tx.select().from(reservas).where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, org)));
    const [acompanhamento] = await tx.select().from(acomp).where(eq(acomp.id, agoraL.acompanhamento.id));
    const [linhaCriar] = await tx.select().from(op).where(eq(op.id, criar.id));
    const f = await concluirVinculo(tx, org, { reserva: travada, acompanhamento, criar: linhaCriar, registro, semMarca: v.semMarca, autorId: sessao.usuarioId, credencial: impressaoCredencialBeds24(env), agora });
    if (f === "descartada") throw new Desfeito(ERRO_BOTAO_MUDOU);
    return feito(v.semMarca ? "vinculado_sem_marca" : f === "divergente" ? "vinculado_diferente" : "vinculado");
  });
}

// ---------------------------------------------------------------- "Passar ao sistema"

/** A recusa do "Passar ao sistema" pelo que a leitura achou nas noites (nada é feito; a equipe decide). */
function quemOcupa(o: Exclude<Awaited<ReturnType<typeof lerOcupantes>>, { funcionou: false }>["ocupacao"]): string | null {
  switch (o.resultado) {
    case "livre":
      return null;
    case "bloqueio_manual":
      return `Há um bloqueio feito à mão de ${diaMesBr(o.bloqueio.inicio)} a ${diaMesBr(o.bloqueio.fim)} sobre as noites no Beds24: o sistema não cria por cima. Deixe à mão, ou mude o bloqueio para Cancelado no Beds24 (não apague) e tente de novo.`;
    case "bloqueio_do_scl":
      return `Há um bloqueio do próprio SCL de ${diaMesBr(o.bloqueio.inicio)} a ${diaMesBr(o.bloqueio.fim)} sobre as noites no Beds24: nada foi feito.`;
    case "noites_ocupadas":
    case "ocupante_exato":
      return "As noites estão ocupadas por outra reserva no Beds24 (possível venda dupla): nada foi feito. Resolva com o hóspede ou com o canal.";
    case "sem_disponibilidade":
      return "O Beds24 não mostra as noites livres (sem unidade livre, ou sem preço nas datas): nada foi feito.";
  }
}

/**
 * "Passar ao sistema" (`reserva:editar` + `configuracao:editar`, com `BotaoConfirmar`; desenho 6.6, plano 1.15): a reserva
 * confirmada antes de o imóvel ser ligado (`manual`/`anterior_a_ligar`), só sem a marca manual das datas fechadas (com ela, a
 * equipe fechou à mão: o M8.3 nunca cria por cima, 6.4), com o imóvel ligado. Em três tempos: o SCL; o quarto acessível em BRL
 * e quem ocupa as noites que ainda não passaram (`lerOcupantes`, desenho 4.1), sem transação aberta; e, sob a trava, a mesma
 * reserva (as datas) e o mesmo acompanhamento, então o acompanhamento `pendente` (motivo nulo) e a criação na fila
 * (`abrirIntencao`, só enfileira). Com um bloqueio ou um ocupante, recusa com o que achou. A rotina cria com a conferência
 * antes, de novo.
 */
export async function passarAoSistemaBeds24(db: Db, sessao: Sessao, reservaId: string, env: NodeJS.ProcessEnv, o: OpcoesDosBotoesQueLeem): Promise<ResultadoDoBotao> {
  const agora = o.relogio.agora();
  const antes = await antesDoBotao(db, sessao, "passar_ao_sistema", reservaId, env, agora);
  if (!antes.ok) return recusado(antes.erro);
  const { leitor } = o;
  if (!leitor) return recusado(ERRO_BOTAO_SEM_LEITURA);
  const org = sessao.organizacaoId;
  const { l } = antes;
  const vinculo = vinculoDoImovel(await listarMapeamentosBeds24(db, org), l.reserva.imovelId);
  if (!vinculo) return recusado(ERRO_BOTAO_SEM_VINCULO);
  const { checkin, checkout } = l.reserva;
  const noites = noitesDe(checkin, checkout).filter((n) => n >= hojeISO(FUSO_PADRAO, agora));

  // Segundo tempo: o quarto e quem ocupa as noites, sem transação aberta.
  o.prazoDaOperacao?.(AbortSignal.timeout(PRAZO_DA_FASE_2_MS));
  let ocupacao: string | null | undefined;
  try {
    await o.ganchos?.antesDaFase2?.(null);
    const quartos = await leitor.quartos().then((q) => q.itens, () => null);
    if (quartos && quartoAcessivelEmBrl(quartos, vinculo.propertyId, vinculo.roomId) !== "ok") return recusado(ERRO_BOTAO_SEM_VINCULO);
    const lidos = quartos ? await lerOcupantes(leitor, db, org, { imovelId: l.reserva.imovelId, alvo: { quarto: vinculo.roomId, chegada: checkin, saida: checkout }, noites, idProprio: null, comPostAnterior: false }) : null;
    ocupacao = lidos?.funcionou ? quemOcupa(lidos.ocupacao) : undefined;
  } finally {
    o.prazoDaOperacao?.(null);
  }
  if (ocupacao === undefined) return recusado(ERRO_BOTAO_LEITURA_SEM_CONCLUSAO);
  if (ocupacao) return recusado(ocupacao);

  // Terceiro tempo: a mesma reserva e o mesmo acompanhamento (as noites lidas são as de agora), e a fila.
  const lidoA = l.acompanhamento!;
  return sobATrava(db, org, "passar_ao_sistema", reservaId, env, agora, "no key update", async (tx, agoraL) => {
    const a = agoraL.acompanhamento!;
    if (agoraL.reserva.checkin !== checkin || agoraL.reserva.checkout !== checkout || a.id !== lidoA.id || a.atualizadoEm.getTime() !== lidoA.atualizadoEm.getTime()) return recusado(ERRO_BOTAO_MUDOU);
    await tx.update(acomp).set({ situacao: "pendente", motivo: null, atualizadoEm: agora }).where(and(eq(acomp.id, a.id), eq(acomp.situacao, "manual"), eq(acomp.motivo, "anterior_a_ligar"), isNull(acomp.otaFechadaEm)));
    await enfileirar(tx, org, reservaId, "criar", env, agora, "passar_ao_sistema");
    await auditar(tx, sessao, reservaId, "passar_ao_sistema", { situacaoNoBeds24: ["manual", "pendente"], motivoNoBeds24: ["anterior_a_ligar", null] });
    return feito("na_fila");
  });
}
