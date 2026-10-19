/**
 * Reserva paga do site no Beds24 (M8.3c, desenho 8, D6, D7 e 5.2): o ensaio em Integrações, o primeiro teste real (o Beds24
 * não tem sandbox). Os cinco passos da seção 8 em dois botões, para Diego conferir no Beds24 e nas OTAs entre eles (plano,
 * P25; a D7 não muda):
 * - "Criar o ensaio" (`criarEnsaioReservasBeds24`, passos 1 a 3): uma reserva de teste no quarto do imóvel escolhido (uma
 *   pessoa, confirmada, a marca `SCL-ENSAIO` com o id da operação, `checkAvailability` e nenhuma notificação; nunca nome,
 *   contato nem valor, e nenhuma reserva nem lançamento no SCL), a releitura pelo id (tem de voltar com a marca deste ensaio)
 *   e a busca pelo quarto e pela chegada (a marca e os escopos funcionam). Tudo certo: a operação fica `feita`, com o id e o
 *   que foi observado (`detalhe.observado`, para a pergunta ao suporte: só nomes de chave e de cabeçalho, o canal e a origem).
 * - "Cancelar o ensaio" (`cancelarEnsaioReservasBeds24`, passos 4 e 5): muda a reserva de teste para `cancelled` (nunca
 *   apaga) e relê. Da `feita`, com o cancelamento aceito e relido: `conferida`, e `registrarEnsaioReservasBeds24` grava o ensaio
 *   da credencial, na mesma transação — só aí "Ligar" fica liberado (D6). De um ensaio que não chegou à `feita`, o cancelamento
 *   relido fecha a operação sem a conferência (não libera "Ligar").
 * - "Conferir o ensaio" (`conferirEnsaioReservasBeds24`): a saída do ensaio que parou no meio (a resposta perdida ou sem o
 *   id, a marca que não voltou, a queda entre os botões), só leitura e só 5 min depois do POST. Com o id, relê pelo id; sem
 *   ele, procura pelo quarto e pela chegada e casa o id da operação no info item `SCL-ENSAIO`. Achado e cancelado: fecha sem a
 *   conferência; achado e vivo: "Cancelar o ensaio"; nada achado numa leitura que conclui: fecha como "nada criado".
 * Cada botão nas três fases (desenho 3.6), como o trabalhador: uma transação curta grava a operação `enviando` e faz commit;
 * as leituras e o POST correm sem transação aberta, com a mesma trava de todo POST de reserva (`antesDoPost`: a pausa relida,
 * o token antes, o tempo e o UPDATE de `enviado_em`) e o UPDATE da resposta logo depois (`gravarResposta`); outra transação
 * curta grava o resultado (`naFase3`). Numa transação só, uma queda depois do POST desfaria a operação, e o Beds24 ficaria com
 * uma reserva confirmada fechando as OTAs, sem rastro no SCL e sem o aviso de Integrações.
 * Travas: só quem edita as configurações (no servidor, na ação e aqui), a credencial da organização, o deploy de produção com a
 * escrita pronta (`escritaReservasBeds24Pronta`; "Conferir o ensaio" só lê e vale também com a chave desligada), sem a pausa,
 * os escopos em ordem lidos na hora, o imóvel ativo com o vínculo único e o quarto acessível em BRL, as noites livres no SCL e
 * no Beds24 (`lerOcupantes`), a trava `beds24:<org>`, nenhuma outra escrita em andamento e nenhum ensaio não resolvido
 * (`ensaioNaoResolvidoNoBanco`: o índice `uma_ativa` não cobre a operação sem reserva). A rotina nunca resolve o ensaio (a
 * busca das reservas do site o descarta); só passa a `incerta` o que venceu com o POST tentado (`passarEnviandoVencidasAIncerta`),
 * e a importação pula o registro dele e as noites do ensaio não resolvido (desenho 5.2 a e e).
 * O cliente e o leitor chegam injetados e são obrigatórios (podem ser null): só as ações chamam as fábricas. Os textos de
 * recusa são do SCL e ficam no `erro` da operação; nunca o texto livre do Beds24.
 */
import { and, desc, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { exigir, type Sessao } from "@/acesso/politica";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { beds24ReservasOperacoes, bloqueios, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { FUSO_PADRAO, hojeISO, somarDias } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";
import { listarMapeamentosBeds24, organizacaoBeds24, quartoAcessivelEmBrl } from "./configuracao";
import { ambienteDeEscritaDeReservas, escritaReservasBeds24Pronta, impressaoCredencialBeds24 } from "./http";
import { INFO_ENSAIO_SCL } from "./normalizar";
import { ensaioNaoResolvidoNoBanco } from "./reservas-site";
import { lerConfigReservasBeds24, registrarEnsaioReservasBeds24 } from "./reservas-site-config";
import {
  antesDoPost, type ClienteDasReservasBeds24, type DesfechoAntesDoPost, type GanchosDoEnvio, gravarResposta, MINIMO_PARA_OPERACAO_MS, naFase3, type OpcoesDoEnvio, PRAZO_DA_FASE_2_MS,
  podeConcluirApagada, relerPorIdDaOperacao, type RelogioDoEnvio, RESPOSTAS_NAO_PROCESSADAS, textoSeguro, vinculoDoImovel,
} from "./reservas-site-envio";
import { lerOcupantes, noitesDe } from "./reservas-site-ocupacao";
import {
  type BotaoBeds24, chaveEnsaioBeds24, detalheOperacaoBeds24, ensaioNaoResolvidoBeds24, type LidoBeds24, lidoDoRegistro, MINUTOS_ANTES_DE_CONCLUIR_BEDS24, type ObservadoNoEnsaioBeds24,
  type PedidoBeds24, podeConcluirIncertezaBeds24, type SituacaoOperacaoBeds24,
} from "./reservas-site-regras";
import { gravarEscoposLidos } from "./reservas-site-rotina";
import { type ItemGravacaoReserva, type LeitorBeds24, type LeitorCredencialBeds24, type ReservaBeds24, type RespostaBeds24, type RespostaGravacaoReserva, TEXTOS_DE_ERRO_BEDS24 } from "./tipos";
import { escritaBeds24EmAndamento, JANELA_RESERVA_EM_ANDAMENTO_MINUTOS, tentarTravaBeds24 } from "./trava";

const op = beds24ReservasOperacoes;
const agoraDoBanco = sql`now()`;
/** A operação `enviando` vencida: começou há mais de 6 min pelo relógio do banco, o mesmo que grava `iniciado_em`. */
const vencidaNoBanco = sql`${op.iniciadoEm} <= now() - make_interval(mins => ${JANELA_RESERVA_EM_ANDAMENTO_MINUTOS})`;

/** O ensaio fecha as datas nas OTAs enquanto existir: uma noite basta, e mais de 7 nunca. */
export const MAXIMO_DE_NOITES_DO_ENSAIO = 7;
/** O limite interno de cada botão do ensaio (Integrações tem 300 s), o mesmo da volta da rotina: a fase 3 precisa caber. */
export const LIMITE_DO_ENSAIO_MS = 240_000;
/** O relógio de um botão do ensaio: o limite interno conta do clique. */
export const relogioDoEnsaio = (inicio: number = Date.now()): RelogioDoEnvio => ({ agora: () => new Date(), restanteMs: () => LIMITE_DO_ENSAIO_MS - (Date.now() - inicio) });

/** As situações em que "Cancelar o ensaio" vale (com o id da reserva de teste e ela não relida como cancelada). */
const SITUACOES_A_CANCELAR: readonly SituacaoOperacaoBeds24[] = ["feita", "incerta", "divergente"];
/**
 * As situações em que "Conferir o ensaio" vale (a `enviando` só vencida). A `feita` também: com a pausa, ou com a credencial
 * trocada, "Cancelar o ensaio" não escreve, e a saída é mudar para Cancelado no Beds24 e conferir (sem isso, a `feita` ficaria
 * não resolvida para sempre, e a guarda de um ensaio por vez impediria o "Ligar"). O plano listava só as três primeiras.
 */
const SITUACOES_A_CONFERIR: readonly SituacaoOperacaoBeds24[] = ["enviando", "incerta", "divergente", "feita"];

/** O cliente dos botões que escrevem: lê, confere os escopos da credencial e grava (`clienteDeReservasDoAmbiente` na ação). */
export type ClienteDoEnsaioBeds24 = ClienteDasReservasBeds24 & LeitorCredencialBeds24;

export type OpcoesDoEnsaio = {
  /** null sem a escrita de reservas pronta: nada é lido nem escrito. */
  cliente: ClienteDoEnsaioBeds24 | null;
  relogio: RelogioDoEnvio;
  /** Liga o prazo da fase 2 ao `fetch` do cliente (a opção `prazo` das fábricas). */
  prazoDaOperacao?: OpcoesDoEnvio["prazoDaOperacao"];
  ganchos?: GanchosDoEnvio;
};

export type OpcoesDaConferenciaDoEnsaio = Omit<OpcoesDoEnsaio, "cliente"> & {
  /** Só lê: o cliente com a escrita pronta, ou `leitorDeReservasDoAmbiente` com a chave desligada; null sem credencial. */
  leitor: LeitorBeds24 | null;
};

// ---------------------------------------------------------------- textos de recusa (do SCL, nunca do Beds24)

export const ERRO_ENSAIO_FORA_DA_PRODUCAO = "O ensaio só roda no deploy de produção, com a escrita de reservas pronta (a chave BEDS24_ESCRITA_RESERVAS ligada e o refresh token).";
export const ERRO_ENSAIO_SEM_LEITURA = "O ensaio só é conferido no deploy de produção, com uma credencial do Beds24.";
export const ERRO_ENSAIO_OUTRA_ORGANIZACAO = "Esta credencial do Beds24 não está vinculada à sua organização.";
export const ERRO_ENSAIO_PAUSADO = "Com a pausa geral, o ensaio não escreve no Beds24: retire a pausa antes (para cancelar sem retirar, mude a reserva de teste para Cancelado no Beds24, sem apagar, e use Conferir o ensaio).";
export const ERRO_ENSAIO_IMOVEL = "Escolha um imóvel ativo com um vínculo único e válido com um quarto do Beds24.";
export const ERRO_ENSAIO_DATAS = `Escolha a entrada a partir de hoje e a saída depois dela, com até ${MAXIMO_DE_NOITES_DO_ENSAIO} noites.`;
export const ERRO_ENSAIO_OCUPADO_NO_SCL = "Há reserva ou bloqueio no SCL nessas datas desse imóvel: escolha datas livres e sem procura.";
export const ERRO_ENSAIO_EM_ANDAMENTO = "Há outra escrita no Beds24 em andamento (uma importação, um envio de calendário ou de reserva, ou outro ensaio): aguarde alguns minutos e tente de novo.";
export const ERRO_ENSAIO_NAO_RESOLVIDO = "Há um ensaio criado e não resolvido: cancele ou confira esse ensaio antes de criar outro.";
export const ERRO_ENSAIO_SEM_TEMPO = "Faltou tempo para o ensaio: nada foi enviado ao Beds24. Tente de novo.";
export const ERRO_ENSAIO_ESCOPOS = "Os escopos da credencial não estão em ordem (veja a prontidão): nada foi enviado ao Beds24.";
export const ERRO_ENSAIO_QUARTO = "O quarto do imóvel não está acessível à credencial do Beds24, ou a moeda dele não é BRL: nada foi enviado.";
export const ERRO_ENSAIO_NOITES = "As noites do ensaio não estão livres no Beds24 (outra reserva, um bloqueio ou sem unidade livre): nada foi enviado. Escolha outras datas.";
export const ERRO_ENSAIO_PAUSA_ANTES_DO_POST = "A pausa geral foi ligada antes do envio: nada foi enviado ao Beds24.";
export const ERRO_ENSAIO_PARADO_ANTES_DO_ENVIO = "O ensaio parou antes do envio: nada foi enviado ao Beds24.";
export const ERRO_ENSAIO_MARCA_NAO_VOLTOU = "A reserva de teste foi criada, mas não voltou do Beds24 com a marca do ensaio (na releitura pelo id ou na busca pelo quarto): o ensaio não vale. Cancele o ensaio.";
export const ERRO_ENSAIO_SEM_RELEITURA = "A reserva de teste foi criada, mas a releitura no Beds24 não concluiu: confira o ensaio.";
export const ERRO_ENSAIO_SEM_CONFERENCIA = "O ensaio foi cancelado no Beds24 sem a conferência completa: faça um ensaio novo antes de ligar um imóvel.";
export const ERRO_ENSAIO_NADA_CRIADO = "Conferido no Beds24: nada do ensaio ficou lá. Faça um ensaio novo antes de ligar um imóvel.";
export const ERRO_ENSAIO_CANCELAMENTO_SEM_CONFIRMACAO = "O Beds24 não confirmou o cancelamento: a reserva de teste pode continuar confirmada. Confira o ensaio daqui a 5 minutos.";
export const ERRO_ENSAIO_NAO_CANCELAVEL = "Este ensaio não tem uma reserva de teste a cancelar pelo sistema.";
export const ERRO_ENSAIO_CREDENCIAL_TROCADA = "A credencial mudou desde a criação do ensaio: mude a reserva de teste para Cancelado no Beds24 (não apague) e use Conferir o ensaio.";
export const ERRO_ENSAIO_ESCOPO_EXCESSIVO = "A credencial tem permissões além das do convite: nada é escrito. Mude a reserva de teste para Cancelado no Beds24 (não apague) e use Conferir o ensaio.";
export const ERRO_ENSAIO_NADA_A_CONFERIR = "Não há ensaio a conferir.";
export const ERRO_ENSAIO_AGUARDE = `Espere ${MINUTOS_ANTES_DE_CONCLUIR_BEDS24} minutos desde o envio para conferir o ensaio (o Beds24 ainda pode gravar).`;
export const ERRO_ENSAIO_LEITURA_SEM_CONCLUSAO =
  "A leitura do Beds24 não concluiu (falhou, trouxe registro ilegível ou repetido, um registro sem marca nas datas do ensaio, ou a credencial não é a do ensaio): nada mudou. Confira no Beds24 e tente de novo.";
export const ERRO_ENSAIO_DESCARTADO = "O ensaio mudou no meio (outra ação já o encerrou ou conferiu): nada mais foi gravado. Atualize a página.";
export const ERRO_ENSAIO_NAO_REGISTRADO = "O ensaio foi conferido e cancelado, mas não foi registrado na configuração: atualize a página e confira o último ensaio.";
/** A falha inesperada no meio de um botão (a ação mostra este texto; o ensaio aparece em Integrações e "Conferir o ensaio" resolve). */
export const ERRO_ENSAIO_INTERROMPIDO = "O ensaio parou no meio, sem gravar o resultado: ele aparece em Integrações e, depois de 6 minutos, é resolvido por Conferir o ensaio. Não crie outro antes disso.";

/**
 * O que cada botão deixou (os textos ficam na ação): `criado` (a `feita`: confira as OTAs e cancele), `sem_confirmacao` (a
 * `incerta`), `marca_nao_voltou` (a `divergente`: criada sem a prova da marca), `cancelado` (a `conferida`, registrada),
 * `cancelado_sem_conferencia`, `nada_criado`, `achado_vivo` (a reserva de teste está lá, confirmada) e `encerrado_sem_envio`
 * (o ensaio que parou antes do POST).
 */
export type DesfechoDoEnsaio = "criado" | "sem_confirmacao" | "marca_nao_voltou" | "cancelado" | "cancelado_sem_conferencia" | "nada_criado" | "achado_vivo" | "encerrado_sem_envio";
export type ResultadoDoEnsaio = { ok: true; desfecho: DesfechoDoEnsaio; operacaoId: string } | { ok: false; erro: string };

const recusado = (erro: string): ResultadoDoEnsaio => ({ ok: false, erro });

// ---------------------------------------------------------------- as travas comuns (desenho 8: "as mesmas travas da seção 2")

/**
 * A permissão no domínio (a ação já conferiu), o deploy de produção (com a escrita pronta, quando o botão escreve) e a
 * credencial da organização da sessão (como o envio de calendário: a credencial é global e atende uma organização só).
 * null = segue.
 */
async function travasDoEnsaio(db: Db, sessao: Sessao, env: NodeJS.ProcessEnv, escreve: boolean): Promise<string | null> {
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  if (!ambienteDeEscritaDeReservas(env)) return escreve ? ERRO_ENSAIO_FORA_DA_PRODUCAO : ERRO_ENSAIO_SEM_LEITURA;
  if (escreve && !escritaReservasBeds24Pronta(env)) return ERRO_ENSAIO_FORA_DA_PRODUCAO;
  try {
    if ((await organizacaoBeds24(db, env)) !== sessao.organizacaoId) return ERRO_ENSAIO_OUTRA_ORGANIZACAO;
  } catch {
    return ERRO_ENSAIO_OUTRA_ORGANIZACAO;
  }
  return null;
}

/** A entrada a partir de hoje (São Paulo), a saída depois dela e no máximo 7 noites. */
function datasDoEnsaio(chegada: string, saida: string, agora: Date): boolean {
  if (!dataValida(chegada) || !dataValida(saida) || chegada < hojeISO(FUSO_PADRAO, agora) || saida <= chegada) return false;
  return saida <= somarDias(chegada, MAXIMO_DE_NOITES_DO_ENSAIO);
}

/** Há no SCL uma reserva (fora a cancelada) ou um bloqueio do imóvel nas noites `[chegada, saida)`: o ensaio não entra por cima. */
async function ocupadoNoScl(db: Db, org: string, imovelId: string, chegada: string, saida: string): Promise<boolean> {
  const [r] = await db.select({ id: reservas.id }).from(reservas).where(and(eq(reservas.organizacaoId, org), eq(reservas.imovelId, imovelId), ne(reservas.estado, "cancelada"), lt(reservas.checkin, saida), gt(reservas.checkout, chegada))).limit(1);
  if (r) return true;
  const [b] = await db.select({ id: bloqueios.id }).from(bloqueios).where(and(eq(bloqueios.organizacaoId, org), eq(bloqueios.imovelId, imovelId), lt(bloqueios.inicio, saida), gt(bloqueios.fim, chegada))).limit(1);
  return Boolean(b);
}

/** O que o ensaio viu (desenho 12, itens 1, 9, 11 e 15): os nomes da resposta e, com a releitura, o canal, a origem e a hora. */
function observadoNoEnsaio(resposta: RespostaGravacaoReserva, registro: ReservaBeds24 | null): ObservadoNoEnsaioBeds24 | undefined {
  if (!resposta.observado) return undefined;
  return { ...resposta.observado, canal: registro?.canal ?? null, origemApi: registro?.origemApi ?? null, horaDaReservaLegivel: registro ? Boolean(registro.reservadaEm) : null };
}

/** O `detalhe` de agora com o botão desta vez (e, se houver, o observado), pela forma fechada. */
const detalheDoBotao = (atual: unknown, porBotao: BotaoBeds24, observado?: ObservadoNoEnsaioBeds24) =>
  detalheOperacaoBeds24({ ...detalheOperacaoBeds24(atual), porBotao, ...(observado ? { observado } : {}) });

/** A auditoria de um passo do ensaio, com o autor: só a situação e o id do Beds24 (nada do hóspede nem valor: não há). */
const auditarEnsaio = (tx: Db, org: string, autorId: string, acao: "criar" | "cancelar" | "conferir", operacaoId: string, mudancas: Record<string, [unknown, unknown]>) =>
  registrarAuditoria(tx, { organizacaoId: org, usuarioId: autorId, acao: `beds24.ensaio.${acao}`, entidade: "integracao", entidadeId: operacaoId, mudancas });

// ---------------------------------------------------------------- as leituras (só leitura do Beds24)

/** O que a fase 2 lê de volta: o registro, a busca e por que não segue (falha, ou a recusa antes do POST). */
type BuscaDoEnsaio = { funcionou: true; registro: ReservaBeds24 | null; semMarcaNasDatas: boolean } | { funcionou: false };

/**
 * A busca do ensaio (passo 3, e "Conferir o ensaio" sem o id), uma leitura própria: a busca das reservas do site descarta o
 * ensaio. As reservas do quarto com a chegada exata, com os info items; casa pelo id da operação no info item `SCL-ENSAIO`.
 * Não conclui com registro ilegível, id repetido ou dois registros com este id. `semMarcaNasDatas`: há um registro confirmado
 * nas mesmas datas sem marca legível (nem a de uma reserva, nem um id de ensaio), que pode ser o do ensaio lido por uma
 * credencial que não lê os info items: "nada achado" não conclui.
 */
async function procurarOEnsaio(leitor: LeitorBeds24, operacaoId: string, pedido: PedidoBeds24): Promise<BuscaDoEnsaio> {
  try {
    const l = await leitor.reservas({ quarto: pedido.quarto, chegadaExata: pedido.chegada, incluirInfo: true });
    if (l.divergencias.length || new Set(l.itens.map((b) => b.idExterno)).size !== l.itens.length) return { funcionou: false };
    const deste = l.itens.filter((b) => b.ensaioOperacaoId === operacaoId);
    if (deste.length > 1) return { funcionou: false };
    const semMarcaNasDatas = l.itens.some((b) => b.estado === "confirmada" && b.checkout === pedido.saida && b.referenciaScl === null && (!b.ensaio || b.ensaioOperacaoId === null));
    return { funcionou: true, registro: deste[0] ?? null, semMarcaNasDatas };
  } catch {
    return { funcionou: false };
  }
}

// ---------------------------------------------------------------- "Criar o ensaio" (passos 1 a 3)

/** A operação do ensaio que saiu da fase 1 em `enviando`, com o que as fases 2 e 3 precisam. */
type EnsaioAberto = { id: string; imovelId: string; propertyId: string; pedido: PedidoBeds24; credencial: string };

/**
 * O que a fase 2 apurou para a fase 3: `antes` (nada saiu: a recusa sem POST, que fecha a operação), `perdida` (o UPDATE de
 * `enviado_em` não pegou a linha) e `respondida` (a resposta classificada, o registro relido pelo id, a busca e, no
 * cancelamento, se a releitura concluiu).
 */
type FaseDoEnvioDoEnsaio =
  | { desfecho: "antes"; situacao: "falhou" | "conflito"; erro: string }
  | { desfecho: "perdida" }
  | { desfecho: "respondida"; resposta: RespostaGravacaoReserva; registro: ReservaBeds24 | null; releu: boolean; busca: "achou" | "nao_achou" | "falhou" | null };

const antes = (erro: string, situacao: "falhou" | "conflito" = "falhou"): FaseDoEnvioDoEnsaio => ({ desfecho: "antes", situacao, erro });

/** As travas de todo POST (`antesDoPost`) no ensaio: nada saiu, e a operação fecha com o motivo (o ensaio nunca repete sozinho). */
function semEnvio(d: DesfechoAntesDoPost): FaseDoEnvioDoEnsaio {
  if (d.desfecho === "perdida") return { desfecho: "perdida" };
  if (d.desfecho === "falha_antes") return antes(d.erro);
  return antes(d.desfecho === "pausa" ? ERRO_ENSAIO_PAUSA_ANTES_DO_POST : d.desfecho === "sem_tempo" ? ERRO_ENSAIO_SEM_TEMPO : ERRO_ENSAIO_IMOVEL);
}

/**
 * "Criar o ensaio" (passos 1 a 3 da seção 8), nas três fases. Antes, só o banco (sem trava): o imóvel ativo com o vínculo
 * único, as datas e as noites livres no SCL. A fase 1 grava a operação `ensaio` (sem reserva e sem acompanhamento, com o
 * pedido de uma pessoa e a referência `SCL-ENSAIO`, a credencial e o autor) já `enviando`, depois de encerrar o ensaio que
 * parou antes do POST e de conferir que não há outro não resolvido. A fase 2 lê os escopos (em ordem, gravados como pelo
 * botão da prontidão), os quartos (o do vínculo acessível em BRL) e quem ocupa as noites (só livre segue), passa pela trava de
 * todo POST e faz o POST, relê pelo id e procura. A fase 3 grava o resultado com a auditoria.
 */
export async function criarEnsaioReservasBeds24(db: Db, sessao: Sessao, entrada: { imovelId: string; chegada: string; saida: string }, env: NodeJS.ProcessEnv, o: OpcoesDoEnsaio): Promise<ResultadoDoEnsaio> {
  const recusa = await travasDoEnsaio(db, sessao, env, true);
  if (recusa) return recusado(recusa);
  const { cliente } = o;
  if (!cliente) return recusado(ERRO_ENSAIO_FORA_DA_PRODUCAO);
  const org = sessao.organizacaoId;
  const agora = o.relogio.agora();
  const { chegada, saida } = entrada;
  if (!datasDoEnsaio(chegada, saida, agora)) return recusado(ERRO_ENSAIO_DATAS);
  if (!uuidValido(entrada.imovelId)) return recusado(ERRO_ENSAIO_IMOVEL);
  const [im] = await db.select({ id: imoveis.id, ativo: imoveis.ativo }).from(imoveis).where(and(eq(imoveis.id, entrada.imovelId), eq(imoveis.organizacaoId, org)));
  const vinculo = im?.ativo ? vinculoDoImovel(await listarMapeamentosBeds24(db, org), im.id) : null;
  if (!im || !vinculo) return recusado(ERRO_ENSAIO_IMOVEL);
  if (await ocupadoNoScl(db, org, im.id, chegada, saida)) return recusado(ERRO_ENSAIO_OCUPADO_NO_SCL);
  if (o.relogio.restanteMs() < MINIMO_PARA_OPERACAO_MS) return recusado(ERRO_ENSAIO_SEM_TEMPO);

  const pedido: PedidoBeds24 = { quarto: vinculo.roomId, chegada, saida, hospedes: 1, situacao: "confirmada", referencia: INFO_ENSAIO_SCL };
  const aberto = await abrirOEnsaio(db, org, sessao, { imovelId: im.id, propertyId: vinculo.propertyId, pedido, credencial: impressaoCredencialBeds24(env) }, agora);
  if (!aberto.ok) return aberto;
  o.prazoDaOperacao?.(AbortSignal.timeout(PRAZO_DA_FASE_2_MS));
  let d: FaseDoEnvioDoEnsaio;
  try {
    d = await enviarOEnsaio(db, org, aberto.ensaio, cliente, o);
  } finally {
    o.prazoDaOperacao?.(null);
  }
  return fecharACriacao(db, org, sessao, aberto.ensaio, d, o);
}

/**
 * Fase 1 da criação, uma transação curta com `lock_timeout` de 15 s: a trava `beds24:<org>` (ocupada = recusa), nenhuma
 * escrita no Beds24 em andamento, a pausa relida, o ensaio que parou antes do POST encerrado (nada saiu: sem isso, ele ficaria
 * `enviando` para sempre), nenhum ensaio não resolvido, e a operação nasce `enviando`, com o id gerado aqui (a chave
 * `ensaio:<id>` e o texto do info item).
 */
async function abrirOEnsaio(db: Db, org: string, sessao: Sessao, e: Omit<EnsaioAberto, "id">, agora: Date): Promise<{ ok: true; ensaio: EnsaioAberto } | { ok: false; erro: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '15s'`);
    if (!(await tentarTravaBeds24(tx, org)) || (await escritaBeds24EmAndamento(tx, org, { agora }))) return { ok: false as const, erro: ERRO_ENSAIO_EM_ANDAMENTO };
    if ((await lerConfigReservasBeds24(tx, org)).pausado) return { ok: false as const, erro: ERRO_ENSAIO_PAUSADO };
    await encerrarEnsaiosParadosAntesDoEnvio(tx, org);
    const [aberto] = await tx.select({ id: op.id }).from(op).where(and(eq(op.organizacaoId, org), ensaioNaoResolvidoNoBanco)).limit(1);
    if (aberto) return { ok: false as const, erro: ERRO_ENSAIO_NAO_RESOLVIDO };
    const id = crypto.randomUUID();
    await tx.insert(op).values({
      id, organizacaoId: org, tipo: "ensaio", chave: chaveEnsaioBeds24(id), modo: "real", situacao: "enviando", pedido: e.pedido, credencial: e.credencial, autorId: sessao.usuarioId,
      tentativas: 1, iniciadoEm: agoraDoBanco, detalhe: detalheDoBotao({}, "criar_ensaio"),
    });
    return { ok: true as const, ensaio: { ...e, id } };
  });
}

/** O ensaio que venceu `enviando` sem POST (a queda antes de `enviado_em`): nada saiu, e ele fecha (`falhou`). Quem chama tem a trava. */
async function encerrarEnsaiosParadosAntesDoEnvio(tx: Db, org: string) {
  await tx
    .update(op)
    .set({ situacao: "falhou", erro: ERRO_ENSAIO_PARADO_ANTES_DO_ENVIO, terminadoEm: agoraDoBanco })
    .where(and(eq(op.organizacaoId, org), eq(op.tipo, "ensaio"), eq(op.modo, "real"), eq(op.situacao, "enviando"), isNull(op.enviadoEm), vencidaNoBanco));
}

/** Fase 2 da criação, sem transação aberta (desenho 3.6 e 8): os escopos, o quarto, as noites, a trava do POST, o POST, a releitura e a busca. */
async function enviarOEnsaio(db: Db, org: string, e: EnsaioAberto, cliente: ClienteDoEnsaioBeds24, o: OpcoesDoEnsaio): Promise<FaseDoEnvioDoEnsaio> {
  await o.ganchos?.antesDaFase2?.(null);
  const { pedido } = e;
  // Os escopos lidos na hora, gravados como pelo botão da prontidão: só em ordem (nada a mais, nada a menos) o ensaio sai.
  let lida: Awaited<ReturnType<LeitorCredencialBeds24["credencial"]>>;
  try {
    lida = await cliente.credencial();
  } catch (x) {
    return antes(textoSeguro(x, "Não foi possível ler os escopos da credencial no Beds24: nada foi enviado."));
  }
  if ((await gravarEscoposLidos(db, org, e.credencial, lida, o.relogio.agora())).situacao !== "em_ordem") return antes(ERRO_ENSAIO_ESCOPOS);
  let quartos: Awaited<ReturnType<LeitorBeds24["quartos"]>>["itens"];
  try {
    quartos = (await cliente.quartos()).itens;
  } catch (x) {
    return antes(textoSeguro(x, "Não foi possível ler os quartos do Beds24: nada foi enviado."));
  }
  if (quartoAcessivelEmBrl(quartos, e.propertyId, pedido.quarto) !== "ok") return antes(ERRO_ENSAIO_QUARTO);
  const ocupantes = await lerOcupantes(cliente, db, org, { imovelId: e.imovelId, alvo: { quarto: pedido.quarto, chegada: pedido.chegada, saida: pedido.saida }, noites: noitesDe(pedido.chegada, pedido.saida), idProprio: null, comPostAnterior: false });
  if (!ocupantes.funcionou) return antes(ocupantes.erro);
  if (ocupantes.ocupacao.resultado !== "livre") return antes(ERRO_ENSAIO_NOITES, "conflito");

  const item: ItemGravacaoReserva = { tipo: "criar", quarto: pedido.quarto, chegada: pedido.chegada, saida: pedido.saida, hospedes: 1, marca: { tipo: "ensaio", operacaoId: e.id } };
  const parado = await antesDoPost(db, org, e, item, cliente, o);
  if (parado) return semEnvio(parado);
  const resposta = await cliente.gravarReservas(item);
  const criada = resposta.resposta === "criada" && resposta.beds24Id ? resposta.beds24Id : null;
  await gravarResposta(db, e, resposta, criada);
  if (!criada) return { desfecho: "respondida", resposta, registro: null, releu: false, busca: null };
  // Passo 2: a releitura pelo id, com os info items (tem de voltar com a marca deste ensaio). Passo 3: a busca pelo quarto e
  // pela chegada, que casa o id da operação no info item.
  const lido = await relerPorIdDaOperacao(cliente, criada);
  const registro = lido.funcionou ? lido.registro : null;
  if (!registro || registro.ensaioOperacaoId !== e.id) return { desfecho: "respondida", resposta, registro, releu: lido.funcionou, busca: null };
  const busca = await procurarOEnsaio(cliente, e.id, pedido);
  return { desfecho: "respondida", resposta, registro, releu: true, busca: !busca.funcionou ? "falhou" : busca.registro?.idExterno === criada ? "achou" : "nao_achou" };
}

/** A situação final da criação e o que ela grava, pela resposta e pela prova (a releitura com a marca e a busca). */
function fimDaCriacao(e: EnsaioAberto, d: Extract<FaseDoEnvioDoEnsaio, { desfecho: "respondida" }>): { situacao: SituacaoOperacaoBeds24; erro?: string; fechada: boolean; resultado: ResultadoDoEnsaio } {
  const r: RespostaBeds24 = d.resposta.resposta;
  const ok = (desfecho: DesfechoDoEnsaio): ResultadoDoEnsaio => ({ ok: true, desfecho, operacaoId: e.id });
  // Não processado (o 401, o 403, o 429 sem a lista, o token que caiu): nada foi criado, e o ensaio fecha.
  if (RESPOSTAS_NAO_PROCESSADAS.includes(r)) return { situacao: r === "http_401" || r === "http_403" ? "recusada" : "falhou", fechada: true, resultado: recusado(TEXTOS_DE_ERRO_BEDS24[r]) };
  // Qualquer outra resposta sem o id (sem id, a recusa, o tempo, a rede, o 5xx, o formato): a reserva de teste pode ter ficado.
  if (r !== "criada" || !d.resposta.beds24Id) return { situacao: "incerta", fechada: false, resultado: ok("sem_confirmacao") };
  // Criada, mas sem a prova: a releitura pelo id (ou a busca) não concluiu, ou o id ainda não voltou logo depois de criado.
  if (!d.releu || !d.registro || d.busca === "falhou") return { situacao: "incerta", erro: ERRO_ENSAIO_SEM_RELEITURA, fechada: false, resultado: ok("sem_confirmacao") };
  // Relida, mas sem a marca deste ensaio (a credencial não lê os info items, ou uma regra os apagou), não confirmada, ou a busca
  // pelo quarto não a achou: o ensaio não vale (e a reserva de teste continua lá).
  if (d.registro.ensaioOperacaoId !== e.id || d.registro.estado !== "confirmada" || d.busca !== "achou") return { situacao: "divergente", erro: ERRO_ENSAIO_MARCA_NAO_VOLTOU, fechada: false, resultado: ok("marca_nao_voltou") };
  return { situacao: "feita", fechada: false, resultado: ok("criado") };
}

/**
 * Fase 3 da criação (`naFase3`: a trava `beds24:<org>` que espera e as repetições no 55P03 e no 40P01): só conclui a operação
 * que continua `enviando`, com ou sem `enviado_em` como a fase 2 a deixou. Sem POST, fecha com o motivo; com POST, a situação
 * de `fimDaCriacao`, o registro relido em `depois`, o observado e a auditoria `beds24.ensaio.criar`.
 */
function fecharACriacao(db: Db, org: string, sessao: Sessao, e: EnsaioAberto, d: FaseDoEnvioDoEnsaio, o: OpcoesDoEnsaio): Promise<ResultadoDoEnsaio> {
  if (d.desfecho === "perdida") return Promise.resolve(recusado(ERRO_ENSAIO_DESCARTADO));
  return naFase3(db, org, o, null, async (tx): Promise<ResultadoDoEnsaio> => {
    const [linha] = await tx.select().from(op).where(and(eq(op.id, e.id), eq(op.organizacaoId, org))).for("update");
    if (!linha || linha.situacao !== "enviando" || (linha.enviadoEm !== null) !== (d.desfecho === "respondida")) return recusado(ERRO_ENSAIO_DESCARTADO);
    if (d.desfecho === "antes") {
      await tx.update(op).set({ situacao: d.situacao, erro: d.erro, terminadoEm: agoraDoBanco }).where(eq(op.id, e.id));
      return recusado(d.erro);
    }
    const fim = fimDaCriacao(e, d);
    const depois: LidoBeds24 | null = d.registro ? lidoDoRegistro(d.registro) : null;
    await tx
      .update(op)
      .set({ situacao: fim.situacao, ...(fim.erro ? { erro: fim.erro } : {}), ...(depois ? { depois } : {}), detalhe: detalheDoBotao(linha.detalhe, "criar_ensaio", observadoNoEnsaio(d.resposta, d.registro)), ...(fim.fechada ? { terminadoEm: agoraDoBanco } : {}) })
      .where(eq(op.id, e.id));
    await auditarEnsaio(tx, org, sessao.usuarioId, "criar", e.id, { situacao: ["enviando", fim.situacao], beds24Id: [null, linha.beds24Id] });
    return fim.resultado;
  });
}

// ---------------------------------------------------------------- "Cancelar o ensaio" (passos 4 e 5)

/** O cancelamento que saiu da fase 1: a operação já `enviando`, a tentativa que a identifica e a situação a que ela volta. */
type CancelamentoAberto = { id: string; beds24Id: string; anterior: SituacaoOperacaoBeds24; tentativa: number; credencial: string };

/**
 * "Cancelar o ensaio" (passos 4 e 5 da seção 8), nas três fases, na mesma operação: a fase 1 a passa a `enviando` (o começo
 * passa a ser o do cancelamento: a criação fica na auditoria) e soma a tentativa, que identifica este POST (a operação já tem
 * o `enviado_em` da criação). A fase 2 lê os escopos (só o escopo a mais para: o cancelamento segue com escopo faltando, como
 * no envio, desenho 2.4), passa pela trava de todo POST e muda a reserva de teste para `cancelled` (nunca DELETE), e relê pelo
 * id. A fase 3: da `feita`, aceito e relido cancelado, `conferida` e o ensaio registrado na configuração (a mesma transação);
 * relido cancelado de outro jeito, fecha sem a conferência; não processado ou sem POST, a operação volta à situação de antes;
 * o resto fica `incerta` ("Conferir o ensaio" daqui a 5 min).
 */
export async function cancelarEnsaioReservasBeds24(db: Db, sessao: Sessao, operacaoId: string, env: NodeJS.ProcessEnv, o: OpcoesDoEnsaio): Promise<ResultadoDoEnsaio> {
  const recusa = await travasDoEnsaio(db, sessao, env, true);
  if (recusa) return recusado(recusa);
  const { cliente } = o;
  if (!cliente) return recusado(ERRO_ENSAIO_FORA_DA_PRODUCAO);
  if (!uuidValido(operacaoId)) return recusado(ERRO_ENSAIO_NAO_CANCELAVEL);
  const org = sessao.organizacaoId;
  if (o.relogio.restanteMs() < MINIMO_PARA_OPERACAO_MS) return recusado(ERRO_ENSAIO_SEM_TEMPO);
  const aberto = await abrirOCancelamento(db, org, operacaoId, env, o.relogio.agora());
  if (!aberto.ok) return aberto;
  o.prazoDaOperacao?.(AbortSignal.timeout(PRAZO_DA_FASE_2_MS));
  let d: FaseDoEnvioDoEnsaio;
  try {
    d = await enviarOCancelamento(db, org, aberto.cancelamento, cliente, o);
  } finally {
    o.prazoDaOperacao?.(null);
  }
  return fecharOCancelamento(db, org, sessao, aberto.cancelamento, d, o);
}

/** Fase 1 do cancelamento: a trava, nenhuma escrita em andamento, a pausa, o ensaio que dá para cancelar e a mesma credencial. */
async function abrirOCancelamento(db: Db, org: string, operacaoId: string, env: NodeJS.ProcessEnv, agora: Date): Promise<{ ok: true; cancelamento: CancelamentoAberto } | { ok: false; erro: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '15s'`);
    if (!(await tentarTravaBeds24(tx, org)) || (await escritaBeds24EmAndamento(tx, org, { agora }))) return { ok: false as const, erro: ERRO_ENSAIO_EM_ANDAMENTO };
    if ((await lerConfigReservasBeds24(tx, org)).pausado) return { ok: false as const, erro: ERRO_ENSAIO_PAUSADO };
    const [linha] = await tx.select().from(op).where(and(eq(op.id, operacaoId), eq(op.organizacaoId, org), eq(op.tipo, "ensaio"), eq(op.modo, "real"))).for("update");
    if (!linha?.beds24Id || !SITUACOES_A_CANCELAR.includes(linha.situacao) || !ensaioNaoResolvidoBeds24(linha)) return { ok: false as const, erro: ERRO_ENSAIO_NAO_CANCELAVEL };
    // Outra credencial pode ser de outra conta: o cancelamento com ela não é o do ensaio (e a leitura não o acharia).
    if (!linha.credencial || linha.credencial !== impressaoCredencialBeds24(env)) return { ok: false as const, erro: ERRO_ENSAIO_CREDENCIAL_TROCADA };
    const [marcada] = await tx
      .update(op)
      .set({ situacao: "enviando", iniciadoEm: agoraDoBanco, tentativas: sql`${op.tentativas} + 1`, detalhe: detalheDoBotao(linha.detalhe, "cancelar_ensaio") })
      .where(eq(op.id, linha.id))
      .returning({ tentativas: op.tentativas });
    return { ok: true as const, cancelamento: { id: linha.id, beds24Id: linha.beds24Id, anterior: linha.situacao, tentativa: marcada.tentativas, credencial: linha.credencial } };
  });
}

/** Fase 2 do cancelamento, sem transação aberta: os escopos, a trava do POST (pela tentativa), o POST e a releitura pelo id. */
async function enviarOCancelamento(db: Db, org: string, c: CancelamentoAberto, cliente: ClienteDoEnsaioBeds24, o: OpcoesDoEnsaio): Promise<FaseDoEnvioDoEnsaio> {
  await o.ganchos?.antesDaFase2?.(null);
  let lida: Awaited<ReturnType<LeitorCredencialBeds24["credencial"]>>;
  try {
    lida = await cliente.credencial();
  } catch (x) {
    return antes(textoSeguro(x, "Não foi possível ler os escopos da credencial no Beds24: nada foi enviado."));
  }
  if ((await gravarEscoposLidos(db, org, c.credencial, lida, o.relogio.agora())).situacao === "escopo_excessivo") return antes(ERRO_ENSAIO_ESCOPO_EXCESSIVO);
  const item: ItemGravacaoReserva = { tipo: "cancelar", id: c.beds24Id };
  const parado = await antesDoPost(db, org, c, item, cliente, o, { daTentativa: c.tentativa });
  if (parado) return semEnvio(parado);
  const resposta = await cliente.gravarReservas(item);
  await gravarResposta(db, c, resposta, null);
  if (RESPOSTAS_NAO_PROCESSADAS.includes(resposta.resposta)) return { desfecho: "respondida", resposta, registro: null, releu: false, busca: null };
  const lido = await relerPorIdDaOperacao(cliente, c.beds24Id);
  return { desfecho: "respondida", resposta, registro: lido.funcionou ? lido.registro : null, releu: lido.funcionou, busca: null };
}

/** Fase 3 do cancelamento: só conclui a operação desta tentativa, ainda `enviando` (senão, outra ação já a concluiu). */
function fecharOCancelamento(db: Db, org: string, sessao: Sessao, c: CancelamentoAberto, d: FaseDoEnvioDoEnsaio, o: OpcoesDoEnsaio): Promise<ResultadoDoEnsaio> {
  if (d.desfecho === "perdida") return Promise.resolve(recusado(ERRO_ENSAIO_DESCARTADO));
  const agora = o.relogio.agora();
  return naFase3(db, org, o, null, async (tx): Promise<ResultadoDoEnsaio> => {
    const [linha] = await tx.select().from(op).where(and(eq(op.id, c.id), eq(op.organizacaoId, org))).for("update");
    if (!linha || linha.situacao !== "enviando" || linha.tentativas !== c.tentativa) return recusado(ERRO_ENSAIO_DESCARTADO);
    const gravar = (campos: PgUpdateSetSource<typeof op>) => tx.update(op).set(campos).where(eq(op.id, c.id));
    if (d.desfecho === "antes") {
      // Nada saiu: a reserva de teste continua como estava, e a operação volta à situação de antes, com o motivo.
      await gravar({ situacao: c.anterior, erro: d.erro });
      return recusado(d.erro);
    }
    const r = d.resposta.resposta;
    const auditar = (situacao: SituacaoOperacaoBeds24) => auditarEnsaio(tx, org, sessao.usuarioId, "cancelar", c.id, { situacao: [c.anterior, situacao], beds24Id: [c.beds24Id, c.beds24Id] });
    if (RESPOSTAS_NAO_PROCESSADAS.includes(r)) {
      // O Beds24 não processou (o `erro` fixo da resposta já está na operação): nada mudou lá.
      await gravar({ situacao: c.anterior });
      await auditar(c.anterior);
      return recusado(TEXTOS_DE_ERRO_BEDS24[r]);
    }
    const depois: LidoBeds24 | null = d.registro ? lidoDoRegistro(d.registro) : null;
    if (d.registro?.estado === "cancelada" && r === "modificada" && c.anterior === "feita") {
      await gravar({ situacao: "conferida", depois, terminadoEm: agoraDoBanco });
      await auditar("conferida");
      const registrado = await registrarEnsaioReservasBeds24(tx, sessao, c.id, agora);
      return registrado.ok ? { ok: true, desfecho: "cancelado", operacaoId: c.id } : recusado(ERRO_ENSAIO_NAO_REGISTRADO);
    }
    if (d.registro?.estado === "cancelada") {
      await gravar({ situacao: "falhou", depois, erro: ERRO_ENSAIO_SEM_CONFERENCIA, terminadoEm: agoraDoBanco });
      await auditar("falhou");
      return { ok: true, desfecho: "cancelado_sem_conferencia", operacaoId: c.id };
    }
    await gravar({ situacao: "incerta", erro: ERRO_ENSAIO_CANCELAMENTO_SEM_CONFIRMACAO, ...(depois ? { depois } : {}) });
    await auditar("incerta");
    return { ok: true, desfecho: "sem_confirmacao", operacaoId: c.id };
  });
}

// ---------------------------------------------------------------- "Conferir o ensaio"

/** O que a leitura do "Conferir o ensaio" achou: o registro, nada (numa leitura que conclui), ou não conclui. */
type AchadoDoEnsaio = { tipo: "achado"; registro: ReservaBeds24 } | { tipo: "nada" } | { tipo: "sem_conclusao" };

/**
 * A leitura do "Conferir o ensaio", só leitura: com o id, a releitura por ele; sem o id, a busca do ensaio. "Nada" só conclui
 * com a credencial do ensaio e o quarto acessível em BRL pela credencial de agora (`podeConcluirApagada`, a mesma regra do
 * "apagada no Beds24"): a troca de token para outra conta, ou o acesso tirado ao quarto, faz qualquer registro sumir.
 */
async function lerOEnsaio(db: Db, org: string, leitor: LeitorBeds24, linha: { id: string; beds24Id: string | null; pedido: PedidoBeds24; credencial: string }, env: NodeJS.ProcessEnv): Promise<AchadoDoEnsaio> {
  if (linha.beds24Id) {
    const lido = await relerPorIdDaOperacao(leitor, linha.beds24Id);
    if (!lido.funcionou) return { tipo: "sem_conclusao" };
    if (lido.registro) return { tipo: "achado", registro: lido.registro };
  } else {
    const busca = await procurarOEnsaio(leitor, linha.id, linha.pedido);
    if (!busca.funcionou || (!busca.registro && busca.semMarcaNasDatas)) return { tipo: "sem_conclusao" };
    if (busca.registro) return { tipo: "achado", registro: busca.registro };
  }
  const propertyId = (await listarMapeamentosBeds24(db, org)).find((m) => m.roomId === linha.pedido.quarto)?.propertyId;
  if (!propertyId) return { tipo: "sem_conclusao" };
  try {
    const quartos = (await leitor.quartos()).itens;
    return podeConcluirApagada(quartos, { propertyId, quarto: linha.pedido.quarto, credencialGuardada: linha.credencial }, env) ? { tipo: "nada" } : { tipo: "sem_conclusao" };
  } catch {
    return { tipo: "sem_conclusao" };
  }
}

/**
 * "Conferir o ensaio" (plano 1.12), em três tempos (desenho 3.6): (a) a operação lida sem trava — a `enviando` vencida, a
 * `incerta`, a `divergente` ou a `feita` (`SITUACOES_A_CONFERIR`), e só 5 min depois do POST (o Beds24 ainda pode gravar
 * depois do nosso tempo-limite); o ensaio que parou antes do POST fecha sem leitura; (b) a leitura sem transação aberta
 * (`lerOEnsaio`); (c) a fase 3, que só conclui a operação como ela foi lida (a situação, o `enviado_em`, o id e a tentativa):
 * achado e cancelado, fecha sem a conferência; achado e vivo, guarda o id e a leitura e oferece "Cancelar o ensaio"; nada,
 * fecha como "nada criado". Nunca faz POST e nunca libera "Ligar".
 */
export async function conferirEnsaioReservasBeds24(db: Db, sessao: Sessao, operacaoId: string, env: NodeJS.ProcessEnv, o: OpcoesDaConferenciaDoEnsaio): Promise<ResultadoDoEnsaio> {
  const recusa = await travasDoEnsaio(db, sessao, env, false);
  if (recusa) return recusado(recusa);
  const { leitor } = o;
  if (!leitor) return recusado(ERRO_ENSAIO_SEM_LEITURA);
  if (!uuidValido(operacaoId)) return recusado(ERRO_ENSAIO_NADA_A_CONFERIR);
  const org = sessao.organizacaoId;
  const agora = o.relogio.agora();
  const [linha] = await db.select({ l: op, vencida: sql<boolean>`(${vencidaNoBanco})` }).from(op).where(and(eq(op.id, operacaoId), eq(op.organizacaoId, org), eq(op.tipo, "ensaio"), eq(op.modo, "real")));
  const lida = linha?.l;
  if (!lida?.pedido || !SITUACOES_A_CONFERIR.includes(lida.situacao) || (lida.situacao === "enviando" && !linha.vencida)) return recusado(ERRO_ENSAIO_NADA_A_CONFERIR);
  if (!lida.enviadoEm) {
    if (lida.situacao !== "enviando") return recusado(ERRO_ENSAIO_NADA_A_CONFERIR);
    // Parou antes do POST: nada saiu, e fecha sem ler o Beds24, sob a trava (o UPDATE só pega a linha ainda vencida e sem POST).
    const fechadas = await naFase3(db, org, o, null, (tx) =>
      tx
        .update(op)
        .set({ situacao: "falhou", erro: ERRO_ENSAIO_PARADO_ANTES_DO_ENVIO, terminadoEm: agoraDoBanco, detalhe: detalheDoBotao(lida.detalhe, "conferir_ensaio") })
        .where(and(eq(op.id, lida.id), eq(op.situacao, "enviando"), isNull(op.enviadoEm), vencidaNoBanco))
        .returning({ id: op.id }),
    );
    return fechadas.length ? { ok: true, desfecho: "encerrado_sem_envio", operacaoId: lida.id } : recusado(ERRO_ENSAIO_DESCARTADO);
  }
  if (!podeConcluirIncertezaBeds24(lida.enviadoEm, agora)) return recusado(ERRO_ENSAIO_AGUARDE);

  o.prazoDaOperacao?.(AbortSignal.timeout(PRAZO_DA_FASE_2_MS));
  let achado: AchadoDoEnsaio;
  try {
    await o.ganchos?.antesDaFase2?.(null);
    achado = await lerOEnsaio(db, org, leitor, { id: lida.id, beds24Id: lida.beds24Id, pedido: lida.pedido, credencial: lida.credencial }, env);
  } finally {
    o.prazoDaOperacao?.(null);
  }
  if (achado.tipo === "sem_conclusao") return recusado(ERRO_ENSAIO_LEITURA_SEM_CONCLUSAO);

  return naFase3(db, org, o, null, async (tx): Promise<ResultadoDoEnsaio> => {
    const [agoraLinha] = await tx.select().from(op).where(and(eq(op.id, lida.id), eq(op.organizacaoId, org))).for("update");
    const mesma = agoraLinha && agoraLinha.situacao === lida.situacao && agoraLinha.enviadoEm?.getTime() === lida.enviadoEm?.getTime() && agoraLinha.beds24Id === lida.beds24Id && agoraLinha.tentativas === lida.tentativas;
    if (!mesma) return recusado(ERRO_ENSAIO_DESCARTADO);
    const gravar = (campos: PgUpdateSetSource<typeof op>) => tx.update(op).set({ ...campos, detalhe: detalheDoBotao(agoraLinha.detalhe, "conferir_ensaio") }).where(eq(op.id, lida.id));
    const auditar = (situacao: SituacaoOperacaoBeds24, beds24Id: string | null) => auditarEnsaio(tx, org, sessao.usuarioId, "conferir", lida.id, { situacao: [lida.situacao, situacao], beds24Id: [lida.beds24Id, beds24Id] });
    if (achado.tipo === "nada") {
      await gravar({ situacao: "falhou", erro: ERRO_ENSAIO_NADA_CRIADO, terminadoEm: agoraDoBanco });
      await auditar("falhou", lida.beds24Id);
      return { ok: true, desfecho: "nada_criado", operacaoId: lida.id };
    }
    const { registro } = achado;
    const depois = lidoDoRegistro(registro);
    if (registro.estado === "cancelada") {
      await gravar({ situacao: "falhou", beds24Id: registro.idExterno, depois, erro: ERRO_ENSAIO_SEM_CONFERENCIA, terminadoEm: agoraDoBanco });
      await auditar("falhou", registro.idExterno);
      return { ok: true, desfecho: "cancelado_sem_conferencia", operacaoId: lida.id };
    }
    // Achado e vivo: a reserva de teste fecha as OTAs. Com o id guardado, "Cancelar o ensaio" vale (a `enviando` vencida passa a `incerta`).
    const situacao: SituacaoOperacaoBeds24 = lida.situacao === "enviando" ? "incerta" : lida.situacao;
    await gravar({ situacao, beds24Id: registro.idExterno, depois });
    await auditar(situacao, registro.idExterno);
    return { ok: true, desfecho: "achado_vivo", operacaoId: lida.id };
  });
}

// ---------------------------------------------------------------- Integrações (o que a tela mostra do ensaio)

/**
 * A fase do ensaio para a tela: `em_andamento` (um botão rodando agora), `criado` (a `feita`: confira as OTAs e cancele),
 * `nao_resolvido` (teve POST e pode ter deixado a reserva de teste confirmada: "mude para Cancelado no Beds24 (não apague)"),
 * `parado_antes_do_envio` (venceu sem POST: nada saiu) e `terminado` (fechado; o resultado fica no `erro`).
 */
export type FaseDoEnsaioBeds24 = "em_andamento" | "criado" | "nao_resolvido" | "parado_antes_do_envio" | "terminado";

export type EnsaioNoPainel = {
  operacaoId: string;
  fase: FaseDoEnsaioBeds24;
  situacao: SituacaoOperacaoBeds24;
  /** O código do imóvel do quarto do ensaio, pelo vínculo de agora (null sem vínculo com esse quarto). */
  imovel: string | null;
  chegada: string;
  saida: string;
  /** O id da reserva de teste no Beds24 (só ids, nada do hóspede: não há). */
  beds24Id: string | null;
  /** Feito com a credencial de agora: com outra, o sistema só cancela e só conclui "nada" com a do ensaio (ou a da mesma conta). */
  comCredencialAtual: boolean;
  iniciadoEm: Date;
  terminadoEm: Date | null;
  /** O texto fixo do SCL (nunca a resposta do Beds24); vazio na `feita` e na `conferida`. */
  erro: string;
  podeCancelar: boolean;
  podeConferir: boolean;
  /** Antes dos 5 min desde o POST: a partir de quando "Conferir o ensaio" vale. */
  conferirAPartirDe: Date | null;
};

type LinhaDoEnsaio = { situacao: SituacaoOperacaoBeds24; enviadoEm: Date | null; depois: LidoBeds24 | null; vencida: boolean };

/** A fase do ensaio (`FaseDoEnsaioBeds24`), pela situação, pelo POST, pela releitura e pelo relógio do banco (`vencida`). */
export function faseDoEnsaioBeds24(l: LinhaDoEnsaio): FaseDoEnsaioBeds24 {
  if (l.situacao === "enviando" && !l.vencida) return "em_andamento";
  if (l.situacao === "enviando" && !l.enviadoEm) return "parado_antes_do_envio";
  if (!ensaioNaoResolvidoBeds24(l)) return "terminado";
  return l.situacao === "feita" ? "criado" : "nao_resolvido";
}

/**
 * O ensaio que Integrações mostra: o que está em curso ou não resolvido (só pode haver um), ou o último, com o resultado.
 * Só leitura do banco. null = nenhum ensaio ainda.
 */
export async function ensaioNoPainel(db: Db, org: string, agora: Date, env: NodeJS.ProcessEnv): Promise<EnsaioNoPainel | null> {
  const linhas = await db
    .select({ id: op.id, situacao: op.situacao, pedido: op.pedido, beds24Id: op.beds24Id, credencial: op.credencial, iniciadoEm: op.iniciadoEm, enviadoEm: op.enviadoEm, terminadoEm: op.terminadoEm, erro: op.erro, depois: op.depois, vencida: sql<boolean>`(${vencidaNoBanco})` })
    .from(op)
    .where(and(eq(op.organizacaoId, org), eq(op.tipo, "ensaio"), eq(op.modo, "real")))
    .orderBy(desc(op.iniciadoEm), desc(op.id))
    .limit(20);
  const comFase = linhas.filter((l) => l.pedido).map((l) => ({ l, fase: faseDoEnsaioBeds24(l) }));
  const e = comFase.find((x) => x.fase !== "terminado") ?? comFase[0];
  if (!e?.l.pedido) return null;
  const { l, fase } = e;
  const pedido = l.pedido!;
  const imovel = (await listarMapeamentosBeds24(db, org)).find((m) => m.roomId === pedido.quarto)?.codigo ?? null;
  const aberto = fase === "criado" || fase === "nao_resolvido";
  const conferivel = aberto && SITUACOES_A_CONFERIR.includes(l.situacao) && l.enviadoEm !== null;
  const passou = conferivel && podeConcluirIncertezaBeds24(l.enviadoEm!, agora);
  const credencial = impressaoCredencialBeds24(env);
  return {
    operacaoId: l.id, fase, situacao: l.situacao, imovel, chegada: pedido.chegada, saida: pedido.saida, beds24Id: l.beds24Id, comCredencialAtual: Boolean(credencial) && l.credencial === credencial,
    iniciadoEm: l.iniciadoEm, terminadoEm: l.terminadoEm, erro: l.erro,
    podeCancelar: aberto && l.beds24Id !== null && SITUACOES_A_CANCELAR.includes(l.situacao),
    podeConferir: fase === "parado_antes_do_envio" || passou,
    conferirAPartirDe: conferivel && !passou ? new Date(l.enviadoEm!.getTime() + MINUTOS_ANTES_DE_CONCLUIR_BEDS24 * 60_000) : null,
  };
}
