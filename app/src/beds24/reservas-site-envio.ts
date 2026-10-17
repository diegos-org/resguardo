/**
 * Reserva paga do site no Beds24 (M8.3c, desenho em `requisitos/product/RESERVA-SITE-BEDS24.md`): o trabalhador que
 * escreve. Uma operação passa por três fases (desenho 3.6), sempre na ordem única das travas (`beds24:<org>` → imóvel →
 * reserva → cancelamento → alterações):
 * - fase 1 (`abrirIntencao`), transação curta: a trava, a pausa, a régua ANTES de criar qualquer linha e a fila diante dela
 *   (`passoDaFila`, desenho 3.3); a operação passa a `enviando`;
 * - fase 2, sem transação aberta e com o prazo próprio: a conferência antes (4.1: o quarto em BRL, a busca da marca e quem
 *   ocupa as noites), a pausa relida, o token obtido ANTES do UPDATE de `enviado_em`, um POST e a releitura;
 * - fase 3, transação curta: grava sempre o fato externo (o id na reserva, a leitura, a situação final, a auditoria); as
 *   marcas das OTAs e a situação `conferida` só com a assinatura do SCL igual à da fase 1.
 * A criação, a atualização e o cancelamento passam pelas mesmas fases. Antes de atualizar ou cancelar (4.2 e 4.3), a fase 2
 * relê o registro pelo id (a marca, a situação e o quarto guardado), confere só as noites novas e cancela também as
 * duplicadas nossas, um POST cada. Depois (4.4 e 6.3): as datas atualizadas e as reabertas nas OTAs pelo sistema ("já
 * marcada" é sucesso), e o acompanhamento `encerrada` quando o cancelamento confere. A reserva cancelada antes de ser
 * criada (`cancelarAntesDeCriar`, 6.3) só lê o Beds24 e marca ou chama a equipe.
 * `enviarReservasDoSite` monta a fila da volta (cancelar → atualizar → criar) e aplica os limites (desenho 9: 10 POSTs, 150 s
 * por operação, as janelas, a parada no 429, 401, 403 e no crédito baixo). `devolverVencidasSemPost` (a queda antes do POST), `resolverOperacoesEmCurso`
 * (a saída da `incerta`, da `enviando` vencida que teve POST e da `feita`, desenho 3.8: `resolverOperacaoEmCurso`, a mesma
 * função da rotina e do "Conferir agora") e `encerrarTerminadas` são do passo 1 da rotina. A saída só lê o Beds24 (nunca
 * POST), em três tempos: a leitura do SCL, a do Beds24 sem transação aberta e a fase 3, que revalida a operação (a mesma
 * situação e o mesmo `enviado_em`) e o acompanhamento sob a trava e descarta a conclusão que outra já aplicou. Tudo chega injetado: o cliente e o
 * leitor (obrigatórios, sem fábrica como padrão: o `env` de um teste pode simular a produção inteira), o relógio, o `env` e
 * os ganchos dos testes. O e-mail à equipe nunca sai daqui: a fase 3 só zera `avisada_em` na transição, e a rotina manda
 * depois dos commits (`reservas-site-avisos.ts`).
 *
 * O SCL é o dono da reserva: nada aqui muda valores, hóspede, pagamento ou o motor. Nenhum dado pessoal nem valor vai ao
 * Beds24 nem às tabelas (o `erro` é texto do SCL, fixo por código depois do POST). Nunca DELETE.
 */
import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, ne, notExists, notInArray, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { quartoDoVinculo } from "@/calendario/envio";
import { alteracoesReserva, beds24ReservasOperacoes, beds24ReservasSite, cancelamentosReserva, pagamentos, reservas } from "@/db/schema";
import { travaOcupada } from "@/db/erros";
import type { Db } from "@/db/types";
import { FUSO_PADRAO, hojeISO, somarDias } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { marcarOtaAtualizada } from "@/pagamentos/alteracao";
import { marcarOtaLiberada } from "@/pagamentos/cancelamento";
import { listarMapeamentosBeds24, quartoAcessivelEmBrl } from "./configuracao";
import { escritaReservasBeds24Pronta, impressaoCredencialBeds24 } from "./http";
import { corpoDaGravacaoReserva } from "./normalizar";
import { adotarReservaCriada, type BuscaDaReservaDoSite, passarEnviandoVencidasAIncerta, procurarReservaDoSite, travarReservaDoSite } from "./reservas-site";
import { type ConfigReservasBeds24, ensaioValeParaCredencial, lerConfigReservasBeds24, ligacaoDoImovel } from "./reservas-site-config";
import { lerReservaParaBeds24 } from "./reservas-site-contexto";
import { type LeituraDosOcupantes, lerOcupantes, noitesComOverbooking, noitesDe, noitesNovas, noitesSemLeitura, type OcupacaoDasNoites } from "./reservas-site-ocupacao";
import {
  type AcaoBeds24,
  assinaturaAtualDoScl,
  assinaturaEsperado,
  atrasoDaFalha,
  type BloqueioAchadoBeds24,
  buscaSemConclusaoBeds24,
  casoDeEmailBeds24,
  chaveOperacaoBeds24,
  type ContextoParaBeds24,
  type DecisaoBeds24,
  dentroDeJanela,
  detalheOperacaoBeds24,
  type DetalheOperacaoBeds24,
  diferencaNaMarca,
  diferencaNoBeds24,
  type DiferencaNoBeds24,
  type EsperadoBeds24,
  jaHouveNovaTentativa,
  type LeituraDaIncerteza,
  type LidoBeds24,
  lidoDoRegistro,
  type MotivoAcompanhamentoBeds24,
  type OperacaoAnteriorBeds24,
  operacaoEmCurso,
  type PedidoBeds24,
  passoDaFila,
  podeConcluirIncertezaBeds24,
  regraDeAdocao,
  registroNossoBeds24,
  type ReleituraDaIncerteza,
  reservaDoSiteParaBeds24,
  saidaDaFeitaPorId,
  saidaDaIncertezaDaCriacao,
  saidaDaIncertezaPorId,
  SITUACOES_OPERACAO_ATIVAS,
  type SituacaoAcompanhamentoBeds24,
  type SituacaoOperacaoBeds24,
} from "./reservas-site-regras";
import { type ConfiguracaoQueParaAsReservas, estadoDaConfiguracaoDasReservas, existeMarcaIlegivelQueConta, motivoDeConfiguracaoDasReservas } from "./reservas-site-rotina";
import { ErroBeds24, type EscritorReservasBeds24, type ItemGravacaoReserva, type LeitorBeds24, type QuartoBeds24, type ReservaBeds24, type RespostaBeds24, type RespostaGravacaoReserva, TEXTOS_DE_ERRO_BEDS24 } from "./tipos";
import { chaveTravaBeds24, escritaBeds24EmAndamento, JANELA_RESERVA_EM_ANDAMENTO_MINUTOS, tentarTravaBeds24 } from "./trava";

// ---------------------------------------------------------------- limites da volta (desenho 9)

/** Até 10 POSTs por volta: são 100 créditos a cada 5 min, divididos com a importação e o envio de calendário. */
export const LIMITE_DE_POSTS_POR_VOLTA = 10;
/** Uma operação só começa com o pior caso inteiro pela frente: as três fases, com a fase 2 de até 120 s. */
export const MINIMO_PARA_OPERACAO_MS = 150_000;
/** Logo antes do POST: o tempo do POST (30 s), da releitura e da fase 3. Menos que isso, a operação volta a `pendente`. */
export const MINIMO_PARA_O_POST_MS = 90_000;
/** O prazo próprio da fase 2 de cada operação (desenho 3.6). */
export const PRAZO_DA_FASE_2_MS = 120_000;
/** Com o crédito restante abaixo disto, a volta para depois da operação em curso. */
export const CREDITO_MINIMO_BEDS24 = 20;
/** A fase 3 repete 3 vezes no 55P03 e no 40P01 (o fato já está na operação), se ainda houver tempo. */
const TENTATIVAS_DA_FASE_3 = 3;
const MINIMO_PARA_REPETIR_A_FASE_3_MS = 20_000;

/** O cliente de uma volta: lê e grava reservas (um cliente só por volta, para não renovar o token a cada operação). */
export type ClienteDasReservasBeds24 = LeitorBeds24 & EscritorReservasBeds24;

/** O relógio da volta: `agora()` para as regras e as marcas; `restanteMs()` até o limite interno da rotina. */
export type RelogioDoEnvio = { agora: () => Date; restanteMs: () => number };

/**
 * Só para os testes: antes da fase 2 (o SCL muda entre as fases, a pausa) e antes de cada tentativa da fase 3 (a trava
 * ocupada). `op` null = a leitura da cancelada antes de criar (`cancelarAntesDeCriar`), que não tem operação em curso, ou o
 * ensaio (`reservas-site-ensaio.ts`), que não tem reserva.
 */
export type GanchosDoEnvio = {
  antesDaFase2?: (op: OperacaoEmEnvio | null) => unknown;
  antesDaFase3?: (op: OperacaoEmEnvio | null, tentativa: number) => unknown;
};

export type OpcoesDoEnvio = {
  env: NodeJS.ProcessEnv;
  relogio: RelogioDoEnvio;
  /** A leitura dos escopos do começo desta volta falhou: nada é escrito (desenho 2.4 e 7: não se sabe se há escopo a mais). */
  leituraDosEscoposFalhou?: boolean;
  /**
   * Recebe o prazo da fase 2 de cada operação e `null` ao fim dela. A rotina liga ao `fetch` do cliente
   * (`clienteDeReservasDoAmbiente`, opção `prazo`): `buscarBeds24` fixa o próprio sinal, e só o `fetch` embrulhado o vê.
   */
  prazoDaOperacao?: (sinal: AbortSignal | null) => void;
  ganchos?: GanchosDoEnvio;
};

/**
 * Por que a volta parou antes do fim (o resumo da rotina mostra o código): a chave, a trava ou outra escrita em andamento, a
 * pausa, a janela da importação ou do envio diário, o tempo, os 10 POSTs, o 429, o 401 ou 403 e o crédito baixo.
 */
export type MotivoDaParadaBeds24 = "chave" | "trava" | "em_andamento" | "pausa" | "janela" | "tempo" | "limite_da_volta" | "limite" | "sem_permissao" | "credito";

/** O resultado da volta, só números e códigos (o resumo da rotina nunca leva dado pessoal). */
export type ResultadoDoEnvioBeds24 = {
  /** POSTs feitos nesta volta. */
  posts: number;
  /** Reservas criadas no Beds24 nesta volta (a resposta trouxe o id). */
  criadas: number;
  /** Atualizações e cancelamentos que o Beds24 aceitou nesta volta (a resposta `modificada`; os POSTs das duplicadas não contam aqui). */
  atualizadas: number;
  canceladas: number;
  /** Acompanhamentos que ficaram `conferida` (ou `encerrada`, com o cancelamento conferido e as datas reabertas). */
  conferidas: number;
  incertas: number;
  /** Conflito, divergência, recusa ou aguardando a equipe: pedem atenção. */
  avisos: number;
  /** Falhas que contam na tabela de atrasos: as de antes do POST e o token que caiu depois do primeiro 401 (`nao_enviado`). */
  falhas: number;
  parada: MotivoDaParadaBeds24 | null;
  /** O motivo de configuração que parou tudo ou as criações (desenho 2.4 e 7); null = nenhum. */
  configuracao: ConfiguracaoQueParaAsReservas | null;
};

const op = beds24ReservasOperacoes;
const acomp = beds24ReservasSite;
const agoraDoBanco = sql`now()`;
/** A operação `enviando` vencida: começou há mais de 6 min pelo relógio do banco, o mesmo que grava `iniciado_em`. */
const vencidaNoBanco = sql`${op.iniciadoEm} <= now() - make_interval(mins => ${JANELA_RESERVA_EM_ANDAMENTO_MINUTOS})`;
const ACOES: readonly string[] = ["criar", "atualizar", "cancelar"] satisfies readonly AcaoBeds24[];
const ehAcao = (t: string): t is AcaoBeds24 => ACOES.includes(t);
/** A mensagem segura de uma falha (a do SCL no `ErroBeds24`, nunca a resposta crua do provedor), curta. */
export const textoSeguro = (e: unknown, padrao: string) => (e instanceof ErroBeds24 ? e.message : padrao).slice(0, 300);

// ---------------------------------------------------------------- fase 1 (desenho 3.3 e 3.6)

/** A operação que saiu da fase 1 em `enviando`, com o que as fases 2 e 3 precisam (nada do hóspede nem valor). */
export type OperacaoEmEnvio = {
  id: string;
  reservaId: string;
  acompanhamentoId: string;
  tipo: AcaoBeds24;
  versao: number;
  codigo: string;
  imovelId: string;
  propertyId: string;
  /** O quarto: na criação, o do vínculo; depois, o guardado (nunca troca). */
  quarto: string;
  pedido: PedidoBeds24;
  /** Os ids das alterações aplicadas sem a marca das OTAs, lidos na fase 1: só esses são marcados (6.3). */
  alteracoes: string[];
  /** O id no Beds24 já ligado a ela (atualizar e cancelar nascem com ele); null na criação. */
  beds24Id: string | null;
  /** Os ids do Beds24 já ligados a ela (a reserva ou uma operação): a busca relê por id, sem depender da marca. */
  idsConhecidos: string[];
  /** Uma `criar` desta reserva já teve POST sem o id do Beds24 (desenho 3.8, item 5: o ocupante exato pode valer). */
  comPostAnterior: boolean;
  /**
   * A impressão da credencial guardada no acompanhamento (a da criação): o id que não volta só conclui "apagada no Beds24"
   * com ela igual à de agora (desenho 4.2 e 4.3).
   */
  credencialGuardada: string;
};

export type OpcoesDaIntencao = {
  agora: Date;
  env: NodeJS.ProcessEnv;
  /** As ações que este passo da volta envia; a de outra ação fica para o passo dela, sem mudança nenhuma. */
  tipos: readonly AcaoBeds24[];
  /** O quarto do vínculo, na leitura dos quartos desta volta, não está acessível em BRL: a criação para (`sem_vinculo`, 2.4). */
  quartoSemAcesso?: boolean;
} & (
  | {
      /** Só grava a fila (a operação `pendente`), sem passar a `enviando`: nenhum botão põe uma operação em `enviando` (1.2). */
      soEnfileirar: true;
      /**
       * Os botões que reabrem o envio com uma intenção nova desta ação ("Reenviar o que está no SCL", "Não existe, pode criar",
       * "Tentar de novo" com o SCL mudado; desenho 3.3 e plano 1.2): a régua lê o acompanhamento `divergente`, `conflito` ou
       * `aguardando_equipe` como `pendente` (a equipe autorizou) e sem a intenção guardada, então a mesma assinatura (o estado
       * já enviado, que o Beds24 perdeu) também abre a versão seguinte. Ela continua barrando `manual`, `encerrada`, a
       * cancelada e qualquer outra ação: nesses casos nada muda. O acompanhamento passa a `pendente`, motivo nulo e
       * `proxima_tentativa_em = agora`, na mesma transação da operação. Só junto do modo que enfileira: um botão que forçasse
       * e enviasse poria a operação em `enviando` sem fase 2, e a escrita da empresa ficaria travada por 6 min.
       */
      forcar?: AcaoBeds24;
    }
  | { soEnfileirar?: false; forcar?: never }
);

/** O que os botões que reabrem o envio tiram da frente da régua (`forcar`): a equipe autorizou a intenção nova. */
const REABERTAS_PELA_EQUIPE: readonly SituacaoAcompanhamentoBeds24[] = ["divergente", "conflito", "aguardando_equipe"];

/** O contexto da régua com o acompanhamento reaberto pela equipe (`forcar`): `pendente` e sem a assinatura da última intenção. */
function contextoReaberto(c: ContextoParaBeds24): ContextoParaBeds24 {
  const a = c.acompanhamento;
  if (!a) return c;
  return { ...c, acompanhamento: { ...a, situacao: REABERTAS_PELA_EQUIPE.includes(a.situacao) ? "pendente" : a.situacao, assinaturaEsperada: null } };
}

/**
 * - `enviar`: a operação está `enviando` (a fase 2 segue);
 * - `enfileirada`: a operação da intenção de agora está na fila, `pendente`, e não sai nesta chamada (o modo que só
 *   enfileira, ou o atraso de uma falha): o botão sabe que a volta seguinte envia, sem reler o banco fora da trava;
 * - `nada`: nada sai agora nem fica na fila (a régua, a fila à espera de uma operação em curso, ou outra ação);
 * - `cancelar_antes_de_criar`: a criação ficou `superada` com a reserva cancelada (desenho 6.3: a leitura do Beds24 decide);
 * - `parar_volta`: a trava ocupada, outra escrita no Beds24 em andamento ou a pausa (nada mudou).
 */
export type AberturaDaIntencao =
  | { saida: "enviar"; operacao: OperacaoEmEnvio }
  | { saida: "enfileirada"; operacaoId: string }
  | { saida: "nada" }
  | { saida: "cancelar_antes_de_criar" }
  | { saida: "parar_volta"; motivo: "trava" | "em_andamento" | "pausa" };

const NADA: AberturaDaIntencao = { saida: "nada" };

type Mapas = Awaited<ReturnType<typeof listarMapeamentosBeds24>>;

/** O vínculo único e válido do imóvel (a régua de `quartoVinculado`), com a propriedade do quarto. O ensaio usa o mesmo. */
export function vinculoDoImovel(mapas: Mapas, imovelId: string): { propertyId: string; roomId: string } | null {
  const roomId = quartoDoVinculo(mapas, imovelId);
  const m = roomId ? mapas.find((x) => x.imovelId === imovelId && x.roomId === roomId) : undefined;
  return roomId && m ? { propertyId: m.propertyId, roomId } : null;
}

/** As alterações aplicadas da reserva ainda sem a marca das OTAs (desenho 6.3), em ordem de id (a ordem das travas). */
async function alteracoesSemMarca(tx: Db, org: string, reservaId: string): Promise<string[]> {
  const linhas = await tx
    .select({ id: alteracoesReserva.id })
    .from(alteracoesReserva)
    .where(and(eq(alteracoesReserva.organizacaoId, org), eq(alteracoesReserva.reservaId, reservaId), eq(alteracoesReserva.situacao, "aplicada"), isNull(alteracoesReserva.otaAtualizadaEm)))
    .orderBy(asc(alteracoesReserva.id));
  return linhas.map((x) => x.id);
}

const superar = (tx: Db, id: string) => tx.update(op).set({ situacao: "superada", terminadoEm: agoraDoBanco }).where(and(eq(op.id, id), eq(op.situacao, "pendente"), isNull(op.enviadoEm)));

/**
 * As respostas de um POST que o Beds24 não processou (desenho 3.8): o 429 sem a lista (`limite`), o token que caiu depois do
 * primeiro 401 (`nao_enviado`) e a credencial recusada (`http_401`, `http_403`). O `enviado_em` delas continua a prova da
 * tentativa (nunca se limpa), mas não de um registro deixado no Beds24.
 */
export const RESPOSTAS_NAO_PROCESSADAS: readonly RespostaBeds24[] = ["limite", "nao_enviado", "http_401", "http_403"];

/**
 * Uma `criar` desta reserva já teve um POST que pode ter gravado sem o id chegar ao SCL (desenho 3.8, item 5: só então o
 * ocupante exato pode ser o registro deixado por ele; sem isso, a reserva direta que a equipe criou à mão nas mesmas datas é
 * "possível venda dupla", nunca incerta): `enviado_em` preenchido, sem `beds24_id` e sem uma resposta não processada. A
 * resposta nula (a queda depois de `enviado_em`) conta.
 */
const comPostDeCriacaoSemId = (ops: readonly Pick<LinhaDaOperacao, "tipo" | "enviadoEm" | "beds24Id" | "resposta">[]) =>
  ops.some((x) => x.tipo === "criar" && x.enviadoEm !== null && x.beds24Id === null && !(x.resposta !== null && RESPOSTAS_NAO_PROCESSADAS.includes(x.resposta)));

/**
 * A `criar` superada sem POST (o imóvel desligado, o quarto ou a moeda fora, a reserva cancelada) não deixa a intenção dela
 * no acompanhamento, na mesma transação: com a assinatura guardada, quando a causa sumisse (o imóvel religado, o quarto ou a
 * moeda de volta), a régua responderia `sem_mudanca` e nada reabriria — a reserva paga nunca seria criada, e as OTAs
 * ficariam abertas. Sem ela, a régua abre a versão seguinte, com a conferência antes de novo.
 */
const SEM_INTENCAO_DE_CRIAR = { assinaturaEsperada: null } as const;

/**
 * Fase 1 (desenho 3.6), uma transação curta com `lock_timeout` de 15 s: a trava `beds24:<org>` (ocupada = a volta para),
 * nenhuma escrita no Beds24 em andamento, a pausa relida, a reserva travada e lida, e a régua SEMPRE antes de criar qualquer
 * linha (`anterior_a_ligar` só vale sem acompanhamento: um `pendente` criado antes dela mandaria ao Beds24 uma reserva
 * confirmada antes de o imóvel ser ligado). O que a fila faz com a resposta é de `passoDaFila`:
 * - `parar`: a da fila vira `superada` e nunca sai; o acompanhamento nasce `manual`/`anterior_a_ligar` (sem quarto e sem
 *   operação), fica `pendente`/`sem_vinculo` (sem tentativa) ou sai de `em_envio` para `pendente`; a `criar` superada leva
 *   junto a assinatura dela (`SEM_INTENCAO_DE_CRIAR`);
 * - `atualizar_no_lugar`: a da fila (sem POST) recebe o pedido, as alterações e o `esperado` de agora, com a mesma chave;
 * - `abrir`: a da fila (outra ação) vira `superada` ANTES; a versão sobe e nasce a operação com `on conflict do nothing`;
 * - `seguir`: a da fila sai como está.
 * Então, salvo `soEnfileirar` ou o atraso de uma falha (`proxima_tentativa_em`; a saída é `enfileirada`, com a operação da
 * fila), o acompanhamento passa a `em_envio` com o quarto, a propriedade e a credencial da criação (o quarto entra aqui: sem
 * ele, o id na operação viraria uma atenção falsa) e a operação a `enviando`, com `iniciado_em` do relógio do banco e
 * `tentativas + 1`. Com `forcar` (os botões que reabrem o envio, só no modo que enfileira), só a intenção nova daquela ação
 * nasce, na fila; qualquer outra resposta da régua não muda nada.
 */
export async function abrirIntencao(db: Db, org: string, reservaId: string, o: OpcoesDaIntencao): Promise<AberturaDaIntencao> {
  const { agora } = o;
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '15s'`);
    if (!(await tentarTravaBeds24(tx, org))) return { saida: "parar_volta", motivo: "trava" };
    // Só quando a operação vai sair: o modo que só enfileira (os botões) nunca põe uma operação em `enviando` nem escreve no
    // Beds24, e a recusa dele é por reserva (`operacaoEmCurso`, desenho 3.6), nunca pela empresa toda.
    if (!o.soEnfileirar && (await escritaBeds24EmAndamento(tx, org, { agora }))) return { saida: "parar_volta", motivo: "em_andamento" };
    const config = await lerConfigReservasBeds24(tx, org);
    if (config.pausado) return { saida: "parar_volta", motivo: "pausa" };
    if (!(await travarReservaDoSite(tx, org, reservaId, "no key update"))) return NADA;
    const l = await lerReservaParaBeds24(tx, org, reservaId, { agora, config });
    if (!l) return NADA;
    const regua = reservaDoSiteParaBeds24(l.reserva, o.forcar ? contextoReaberto(l.contexto) : l.contexto);
    // O botão abre exatamente a ação dele, ou nada muda (a recusa é de quem chama, com a situação de agora).
    if (o.forcar && !(regua.decisao === "enviar" && regua.acao === o.forcar)) return NADA;
    const d: DecisaoBeds24 = o.quartoSemAcesso && regua.decisao === "enviar" && regua.acao === "criar" ? { decisao: "parada", motivo: "sem_vinculo" } : regua;
    const ops = await tx.select().from(op).where(and(eq(op.organizacaoId, org), eq(op.reservaId, reservaId), eq(op.modo, "real")));
    const daFila = ops.find((x) => x.situacao === "pendente" && x.enviadoEm === null && ehAcao(x.tipo)) ?? null;
    const a = l.acompanhamento;
    const passo = passoDaFila(d, daFila ? { tipo: daFila.tipo as AcaoBeds24, enviadoEm: null } : null, a ? { situacao: a.situacao, motivo: a.motivo } : null, ops.some(operacaoEmCurso));
    const gravarAcompanhamento = async (campos: Partial<typeof acomp.$inferInsert>) => {
      const [linha] = a
        ? await tx.update(acomp).set({ ...campos, atualizadoEm: agora }).where(eq(acomp.id, a.id)).returning()
        : await tx
            .insert(acomp)
            .values({ organizacaoId: org, reservaId, imovelId: l.reserva.imovelId, referencia: l.reserva.codigo, ...campos, atualizadoEm: agora })
            .onConflictDoNothing({ target: [acomp.organizacaoId, acomp.reservaId] })
            .returning();
      return linha ?? null;
    };

    if (passo.passo === "esperar") return NADA;
    if (passo.passo === "parar") {
      if (passo.superar && daFila) await superar(tx, daFila.id);
      const limpar = passo.superar && daFila?.tipo === "criar" ? SEM_INTENCAO_DE_CRIAR : {};
      if (passo.acompanhamento === "manual_anterior_a_ligar") await gravarAcompanhamento({ situacao: "manual", motivo: "anterior_a_ligar", ...limpar });
      else if (passo.acompanhamento === "sem_vinculo") await gravarAcompanhamento({ situacao: "pendente", motivo: "sem_vinculo", ...limpar });
      else if (a && (passo.acompanhamento === "pendente" || (passo.acompanhamento === "cancelar_antes_de_criar" && a.situacao === "em_envio"))) await gravarAcompanhamento({ situacao: "pendente", motivo: null, ...limpar });
      else if (a && limpar === SEM_INTENCAO_DE_CRIAR) await gravarAcompanhamento(limpar);
      return passo.acompanhamento === "cancelar_antes_de_criar" ? { saida: "cancelar_antes_de_criar" } : NADA;
    }

    const acao: AcaoBeds24 = passo.passo === "abrir" ? passo.acao : (daFila!.tipo as AcaoBeds24);
    if (!o.tipos.includes(acao)) return NADA;
    if (passo.passo === "seguir" && !a) return NADA;
    const esperado: EsperadoBeds24 = passo.passo === "seguir" ? (a!.esperado ?? daFila!.pedido!) : passo.esperado;
    const assinatura = passo.passo === "seguir" ? (a!.assinaturaEsperada ?? assinaturaEsperado(esperado)) : passo.assinatura;
    // O quarto e a propriedade: na criação, os do vínculo de agora; depois, os guardados (nunca troca de quarto).
    const vinculo = acao === "criar" ? vinculoDoImovel(await listarMapeamentosBeds24(tx, org), l.reserva.imovelId) : a?.roomId && a.propertyId ? { propertyId: a.propertyId, roomId: a.roomId } : null;
    if (!vinculo || (acao === "criar" && vinculo.roomId !== esperado.quarto)) {
      if (daFila) await superar(tx, daFila.id);
      await gravarAcompanhamento({ situacao: "pendente", motivo: "sem_vinculo", ...(acao === "criar" ? SEM_INTENCAO_DE_CRIAR : {}) });
      return NADA;
    }
    const alteracoes = await alteracoesSemMarca(tx, org, reservaId);
    const pedido: PedidoBeds24 = { ...esperado, referencia: l.reserva.codigo };
    const credencial = impressaoCredencialBeds24(o.env);
    // O botão que reabre o envio tira o atraso de uma falha anterior: a volta seguinte envia (`proxima_tentativa_em = agora`).
    const atrasada = !o.forcar && Boolean(a?.proximaTentativaEm && a.proximaTentativaEm.getTime() > agora.getTime());
    const enviarAgora = !o.soEnfileirar && !atrasada;

    let linha = daFila;
    let versao = a?.versao ?? 0;
    if (passo.passo === "atualizar_no_lugar") {
      [linha] = await tx.update(op).set({ pedido, alteracoes }).where(and(eq(op.id, daFila!.id), eq(op.situacao, "pendente"), isNull(op.enviadoEm))).returning();
      if (!linha) return NADA;
    }
    if (passo.passo === "abrir") {
      if (passo.superar && daFila) await superar(tx, daFila.id);
      versao += 1;
    }
    const comum = { esperado, assinaturaEsperada: assinatura, motivo: null, ...(passo.passo === "abrir" ? { versao } : {}) };
    const acompanhamento =
      passo.passo === "seguir" && !enviarAgora
        ? a!
        : await gravarAcompanhamento(
            enviarAgora
              ? { ...comum, situacao: "em_envio", roomId: vinculo.roomId, propertyId: vinculo.propertyId, ...(acao === "criar" ? { credencial } : {}) }
              : { ...comum, situacao: "pendente", ...(o.forcar ? { proximaTentativaEm: agora } : {}) },
          );
    if (!acompanhamento) return NADA;
    if (passo.passo === "abrir") {
      [linha] = await tx
        .insert(op)
        .values({ organizacaoId: org, reservaId, acompanhamentoId: acompanhamento.id, tipo: acao, chave: chaveOperacaoBeds24(acao, reservaId, versao), modo: "real", situacao: "pendente", pedido, alteracoes, beds24Id: acao === "criar" ? null : l.contexto.beds24Id, credencial })
        .onConflictDoNothing({ target: [op.organizacaoId, op.chave] })
        .returning();
      // A chave já existia: uma linha antiga nunca é retomada para uma intenção nova; a volta seguinte abre a versão seguinte.
      if (!linha) return NADA;
    }
    if (!linha) return NADA;
    if (!enviarAgora) return { saida: "enfileirada", operacaoId: linha.id };
    const [enviando] = await tx
      .update(op)
      .set({ situacao: "enviando", iniciadoEm: agoraDoBanco, tentativas: sql`${op.tentativas} + 1`, credencial, erro: "" })
      .where(and(eq(op.id, linha.id), eq(op.situacao, "pendente"), isNull(op.enviadoEm)))
      .returning();
    if (!enviando) return NADA;
    const conhecidos = [l.reserva.beds24Id, ...ops.map((x) => x.beds24Id)].filter((x): x is string => Boolean(x));
    return {
      saida: "enviar",
      operacao: {
        id: enviando.id, reservaId, acompanhamentoId: acompanhamento.id, tipo: acao, versao: acompanhamento.versao, codigo: l.reserva.codigo, imovelId: l.reserva.imovelId,
        propertyId: vinculo.propertyId, quarto: vinculo.roomId, pedido: enviando.pedido ?? pedido, alteracoes: enviando.alteracoes, beds24Id: enviando.beds24Id,
        idsConhecidos: [...new Set(conhecidos)], comPostAnterior: comPostDeCriacaoSemId(ops), credencialGuardada: acompanhamento.credencial,
      },
    };
  });
}

// ---------------------------------------------------------------- fase 2 da criação (desenho 3.6, 4.1 e 3.8)

/** A recusa do Beds24 que para a volta inteira: o limite de uso (429) ou a credencial sem permissão (401, 403). */
export type ParadaPelaRecusa = Extract<MotivoDaParadaBeds24, "limite" | "sem_permissao">;

/**
 * A parada que uma recusa do Beds24 antes do POST pede, no token ou numa leitura (desenho 9: a volta para no primeiro 429,
 * 401 ou 403; os créditos são divididos com a importação e o envio, e cada operação seguinte pediria de novo e contaria uma
 * falha): o 429 é o limite de uso; o 401, o 403 e as outras recusas 4xx, a credencial — como no POST (`gravarReservas`:
 * `http_401`), a renovação recusada vem com o status dela, e chega também pela primeira leitura da volta (o token é pedido
 * dentro dela). Sem status (rede, tempo) ou com 5xx, não houve recusa: nada para. A mesma regra na rotina (a leitura dos
 * escopos do começo da volta e a conferência contínua, `cron-reservas.ts`).
 */
export function paradaPelaRecusa(status: number | undefined): ParadaPelaRecusa | undefined {
  if (status === 429) return "limite";
  if (status !== undefined && status >= 400 && status < 500) return "sem_permissao";
  return undefined;
}

export const statusDoErro = (e: unknown) => (e instanceof ErroBeds24 ? e.status : undefined);

/** A leitura dos quartos desta volta, uma vez só (como a importação faz antes do laço); a falha leva o status HTTP, se houve. */
type QuartosDaVolta = () => Promise<{ ok: true; itens: QuartoBeds24[] } | { ok: false; erro: string; status?: number }>;

function quartosDaVolta(leitor: LeitorBeds24): QuartosDaVolta {
  let lidos: ReturnType<QuartosDaVolta> | null = null;
  return () =>
    (lidos ??= leitor.quartos().then(
      (l) => ({ ok: true as const, itens: l.itens }),
      (e: unknown) => ({ ok: false as const, erro: textoSeguro(e, "Não foi possível ler os quartos do Beds24."), status: statusDoErro(e) }),
    ));
}

/**
 * A conferência antes de marcar as datas reabertas do cancelamento (desenho 4.3 e 4.4, `lerAntesDeLiberar`): os registros
 * nossos com a marca ainda vivos (`vivos`, a lista que se cancela no Beds24), os outros registros vivos com a marca desta
 * reserva (`estranhos`, `estranhosComAMarca`: nunca cancelados pelo sistema) e o bloqueio feito à mão que sobrou sobre as
 * noites. Com qualquer um deles, nada é marcado.
 */
type AntesDeLiberar = { vivos: string[]; estranhos: string[]; bloqueio: BloqueioAchadoBeds24 | null };

/** A atualização não libera noites: nada a conferir antes de liberar. */
const NADA_A_LIBERAR: AntesDeLiberar = { vivos: [], estranhos: [], bloqueio: null };

/**
 * A releitura depois da escrita (desenho 4.4), uma forma por tipo: na criação e na atualização, o registro pelo id e as
 * noites escritas com overbooking (`livres < 0`, `relerDepoisDaEscrita`); no cancelamento, o registro e a conferência antes de
 * liberar (`relerDepoisDoCancelamento`). O cancelamento só conclui com a forma dele (`depoisDaResposta`): sem a conferência
 * antes de liberar, nada é marcado.
 */
type ReleituraDepois = { tipo: "confirmada"; registro: ReservaBeds24; overbooking: string[] } | ({ tipo: "cancelada"; registro: ReservaBeds24 } & AntesDeLiberar);

/** O que o registro relido por id mostra antes de atualizar ou cancelar e que não deixa escrever (desenho 4.2 e 4.3). */
type MotivoAntesDaEscrita = "mudada_no_beds24" | "cancelada_no_beds24" | "apagada_no_beds24" | "marca_ilegivel";

/**
 * O que a fase 2 apurou, para a fase 3 gravar:
 * - antes do POST: `falha_antes` (leitura, token ou item: volta a `pendente` com o atraso; com o 429, o 401 ou o 403, a
 *   volta para em `parada`), `sem_vinculo` (o quarto
 *   inacessível ou a moeda diferente de BRL), `pausa` e `sem_tempo` (volta a `pendente`, sem contar falha), `desligado` (o
 *   imóvel desligado entre as fases), `perdida` (o UPDATE de `enviado_em` não pegou a linha: nada saiu), `adotar` (a busca
 *   achou a marca: não cria), `marca` (duplicada ou marca em registro inesperado) e `ocupada` (quem ocupa as noites; na
 *   atualização, as noites novas, com o registro relido em `antes`);
 * - antes do POST da atualização e do cancelamento (4.2 e 4.3), pela releitura por id: `divergente_antes` (o registro
 *   apagado, cancelado, num bloqueio ou noutro quarto, ou sem a marca desta reserva: nada é enviado), `sem_acesso` (o id não
 *   voltou, e a credencial trocada desde a criação ou o quarto sem acesso não deixam concluir "apagada") e `ja_cancelada` (o
 *   cancelamento já está no Beds24 e não há duplicada viva: só confere e marca, salvo outro registro vivo com a marca,
 *   `estranhos`, que vai à equipe);
 * - depois do POST: `respondida`, com a resposta classificada do primeiro POST, a do último quando o cancelamento levou as
 *   duplicadas (`ultima`: a parada e o crédito saem dela também) e a releitura (null = não deu para reler, ou a resposta não
 *   pede).
 */
type DesfechoDaFase2 =
  | { desfecho: "falha_antes"; erro: string; parada?: ParadaPelaRecusa }
  | { desfecho: "sem_vinculo" | "pausa" | "sem_tempo" | "desligado" | "perdida" | "sem_acesso" }
  | { desfecho: "adotar"; comMarca: ReservaBeds24[]; registro: ReservaBeds24 }
  | { desfecho: "marca"; motivo: "duplicada" | "marca_em_registro_inesperado"; ids: string[] }
  | { desfecho: "ocupada"; ocupacao: Exclude<OcupacaoDasNoites, { resultado: "livre" | "leitura_incompleta" }>; antes?: LidoBeds24 }
  | { desfecho: "divergente_antes"; motivo: MotivoAntesDaEscrita; antes: LidoBeds24 | null; soMarca: boolean }
  | { desfecho: "ja_cancelada"; registro: ReservaBeds24; antes: LidoBeds24; estranhos: string[]; bloqueio: BloqueioAchadoBeds24 | null }
  | { desfecho: "respondida"; resposta: RespostaGravacaoReserva; releitura: ReleituraDepois | null; ultima?: RespostaGravacaoReserva };

/**
 * O que as travas de todo POST de reserva (`antesDoPost`) deixam: a falha antes do POST, a pausa, o tempo, o imóvel desligado
 * entre as fases e o UPDATE de `enviado_em` que não pegou a linha (`perdida`). Uma parte de `DesfechoDaFase2`.
 */
export type DesfechoAntesDoPost = Extract<DesfechoDaFase2, { desfecho: "falha_antes" }> | { desfecho: "pausa" | "sem_tempo" | "desligado" | "perdida" };

/** A falha antes do POST, com a parada da volta quando o Beds24 recusou com 429, 401 ou 403 (`paradaPelaRecusa`). */
function falhaAntes(erro: string, status?: number): Extract<DesfechoDaFase2, { desfecho: "falha_antes" }> {
  const parada = paradaPelaRecusa(status);
  return { desfecho: "falha_antes", erro, ...(parada ? { parada } : {}) };
}

/** A releitura por id: o registro (null = o id não voltou numa leitura limpa), ou não conclui (com o HTTP da recusa, se houve). */
type RegistroPorId = { funcionou: true; registro: ReservaBeds24 | null } | { funcionou: false; status?: number };

/** Relê um id do Beds24 (desenho 4.4), só leitura, com os info items. O ensaio relê pelo mesmo. */
export async function relerPorIdDaOperacao(leitor: LeitorBeds24, id: string): Promise<RegistroPorId> {
  try {
    const l = await leitor.reservas({ ids: [id], chegadaDe: "1900-01-01", incluirInfo: true });
    // Um registro em formato inválido, sem dono (um id que não foi pedido) ou repetido pode ser o nosso: nada conclui.
    if (l.divergencias.length || l.itens.length > 1 || l.itens.some((b) => b.idExterno !== id)) return { funcionou: false };
    return { funcionou: true, registro: l.itens[0] ?? null };
  } catch (e) {
    return { funcionou: false, status: statusDoErro(e) };
  }
}

/** O calendário das noites escritas (desenho 4.4): as noites com overbooking, ou não conclui (com o HTTP da recusa, se houve). */
type OverbookingLido = { funcionou: true; noites: string[] } | { funcionou: false; status?: number };

/**
 * Lê o calendário das noites escritas e devolve as que estão com overbooking (`livres < 0`), só leitura. Não conclui com a
 * leitura falhando, com valores inválidos ou sem alguma das noites (uma noite sem leitura nunca é "sem overbooking").
 */
async function lerOverbooking(leitor: LeitorBeds24, quarto: string, noites: readonly string[]): Promise<OverbookingLido> {
  if (!noites.length) return { funcionou: true, noites: [] };
  try {
    // O fim do calendário é exclusivo: a noite seguinte à última.
    const c = await leitor.calendario({ roomIds: [quarto], inicio: noites[0], fim: somarDias(noites[noites.length - 1], 1) });
    if (c.divergencias.length || noitesSemLeitura(c.itens, quarto, noites).length) return { funcionou: false };
    return { funcionou: true, noites: noitesComOverbooking(c.itens, quarto, noites) };
  } catch (e) {
    return { funcionou: false, status: statusDoErro(e) };
  }
}

/**
 * Relê o registro criado pelo id e o calendário das noites (desenho 4.4), só leitura. null = não deu para concluir: a
 * leitura falhou, voltou em formato inválido, sem o registro ou com outro registro, ou o calendário não trouxe todas as
 * noites (a operação fica `feita`, e o passo 1 da volta seguinte confere).
 */
async function relerDepoisDaEscrita(leitor: LeitorBeds24, id: string, quarto: string, noites: readonly string[]): Promise<ReleituraDepois | null> {
  const lido = await relerPorIdDaOperacao(leitor, id);
  if (!lido.funcionou || !lido.registro) return null;
  const c = await lerOverbooking(leitor, quarto, noites);
  return c.funcionou ? { tipo: "confirmada", registro: lido.registro, overbooking: c.noites } : null;
}

/**
 * A fase 2 da criação, sem transação aberta (desenho 3.6 e 4.1): o quarto acessível em BRL, a busca da marca (achou: não
 * cria; a adoção é da fase 3, com a trava), quem ocupa as noites (só `livre` segue), o item conferido, a pausa e o imóvel
 * relidos logo antes do POST, o token obtido ANTES do UPDATE de `enviado_em` (a renovação que cai aqui é falha antes do POST,
 * nunca um tempo esgotado do POST), o tempo para o POST e a fase 3 (o Beds24 lento não deixa um POST sem tempo de gravar o
 * fato), o UPDATE de `enviado_em` (sem pegar a linha, nada sai), um POST com `checkAvailability`,
 * o UPDATE do id, da resposta e de `respondido_em` logo depois, e a releitura do registro e do calendário das noites.
 */
async function enviarCriacao(db: Db, org: string, operacao: OperacaoEmEnvio, cliente: ClienteDasReservasBeds24, quartos: QuartosDaVolta, o: OpcoesDoEnvio, volta: ResultadoDoEnvioBeds24): Promise<DesfechoDaFase2> {
  await o.ganchos?.antesDaFase2?.(operacao);
  const { pedido, quarto } = operacao;
  const lidos = await quartos();
  if (!lidos.ok) return falhaAntes(lidos.erro, lidos.status);
  if (quartoAcessivelEmBrl(lidos.itens, operacao.propertyId, quarto) !== "ok") return { desfecho: "sem_vinculo" };

  const busca = await procurarReservaDoSite(cliente, { referencia: operacao.codigo, quarto, chegada: pedido.chegada, idsConhecidos: operacao.idsConhecidos });
  if (!busca.funcionou) return falhaAntes(busca.erro, busca.status);
  if (busca.comMarca.length) {
    const ad = regraDeAdocao(busca.comMarca, { quarto, chegada: pedido.chegada, saida: pedido.saida });
    if (ad.adotar) return { desfecho: "adotar", comMarca: busca.comMarca, registro: ad.registro };
    if (ad.motivo === "duplicada") return { desfecho: "marca", motivo: "duplicada", ids: ad.ids };
    if (ad.motivo === "marca_em_registro_inesperado") return { desfecho: "marca", motivo: "marca_em_registro_inesperado", ids: [ad.id] };
  }

  const noites = noitesDe(pedido.chegada, pedido.saida);
  const ocupantes = await lerOcupantes(cliente, db, org, { imovelId: operacao.imovelId, alvo: { quarto, chegada: pedido.chegada, saida: pedido.saida }, noites, idProprio: null, comPostAnterior: operacao.comPostAnterior });
  if (!ocupantes.funcionou) return falhaAntes(ocupantes.erro, ocupantes.status);
  if (ocupantes.ocupacao.resultado !== "livre") return { desfecho: "ocupada", ocupacao: ocupantes.ocupacao };

  const item: ItemGravacaoReserva = { tipo: "criar", quarto, chegada: pedido.chegada, saida: pedido.saida, hospedes: pedido.hospedes ?? 0, marca: { tipo: "reserva", codigo: operacao.codigo } };
  const parado = await antesDoPost(db, org, operacao, item, cliente, o, { exigirImovelLigado: operacao.imovelId });
  if (parado) return parado;

  volta.posts++;
  const resposta = await cliente.gravarReservas(item);
  const criada = resposta.resposta === "criada" && resposta.beds24Id ? resposta.beds24Id : null;
  await gravarResposta(db, operacao, resposta, criada);
  return { desfecho: "respondida", resposta, releitura: criada ? await relerDepoisDaEscrita(cliente, criada, quarto, noites) : null };
}

/**
 * As travas de todo POST de reserva (desenho 3.6), na ordem: o item conferido (o corpo que sairia), a pausa relida logo
 * antes (e, na criação, o imóvel ainda ligado, `exigirImovelLigado`: a atualização e o cancelamento seguem com o imóvel
 * desligado, desenho 2.1), o token obtido ANTES do UPDATE de `enviado_em` (a renovação que cai aqui é falha antes do POST,
 * nunca um tempo esgotado do POST), o tempo para o POST e a fase 3 (o Beds24 lento não deixa um POST sem tempo de gravar o
 * fato) e o UPDATE simples de `enviado_em`, com o que mais a operação grava junto (o registro relido em `antes`, as
 * duplicadas), sem transação. A mesma trava para o ensaio (`reservas-site-ensaio.ts`): o cancelamento dele é o segundo POST da
 * mesma operação, que já tem `enviado_em`, e é identificado pela tentativa gravada na fase 1 (`daTentativa`) em vez do
 * `enviado_em` vazio. null = pode enviar; senão, o desfecho de antes do POST.
 */
export async function antesDoPost(
  db: Db, org: string, operacao: Pick<OperacaoEmEnvio, "id">, item: ItemGravacaoReserva, cliente: Pick<ClienteDasReservasBeds24, "prepararToken">, o: Pick<OpcoesDoEnvio, "relogio">,
  x: { exigirImovelLigado?: string; junto?: PgUpdateSetSource<typeof op>; daTentativa?: number } = {},
): Promise<DesfechoAntesDoPost | null> {
  try {
    corpoDaGravacaoReserva(item);
  } catch (e) {
    return falhaAntes(textoSeguro(e, "Pedido de reserva ao Beds24 inválido: nada foi enviado."));
  }
  const config = await lerConfigReservasBeds24(db, org);
  if (config.pausado) return { desfecho: "pausa" };
  if (x.exigirImovelLigado !== undefined && !ligacaoDoImovel(config, x.exigirImovelLigado)) return { desfecho: "desligado" };
  try {
    await cliente.prepararToken();
  } catch (e) {
    return falhaAntes(textoSeguro(e, "O token do Beds24 não veio: nada foi enviado."), statusDoErro(e));
  }
  if (o.relogio.restanteMs() < MINIMO_PARA_O_POST_MS) return { desfecho: "sem_tempo" };
  const desta = x.daTentativa === undefined ? isNull(op.enviadoEm) : eq(op.tentativas, x.daTentativa);
  const [marcada] = await db.update(op).set({ ...x.junto, enviadoEm: agoraDoBanco }).where(and(eq(op.id, operacao.id), eq(op.situacao, "enviando"), desta)).returning({ id: op.id });
  return marcada ? null : { desfecho: "perdida" };
}

/** Logo depois da resposta, antes de qualquer trava (desenho 3.6): o id (se veio), a classificação, `respondido_em` e o `erro` fixo dela. */
export const gravarResposta = (db: Db, operacao: Pick<OperacaoEmEnvio, "id">, resposta: RespostaGravacaoReserva, beds24Id: string | null) =>
  db
    .update(op)
    .set({ ...(beds24Id ? { beds24Id } : {}), resposta: resposta.resposta, respondidoEm: agoraDoBanco, erro: TEXTOS_DE_ERRO_BEDS24[resposta.resposta] })
    .where(eq(op.id, operacao.id));

// ---------------------------------------------------------------- fase 2 da atualização e do cancelamento (desenho 4.2, 4.3 e 4.4)

/**
 * O id que não voltou numa leitura limpa só conclui "apagada no Beds24" com a credencial guardada no acompanhamento igual à
 * de agora e o quarto acessível em BRL (lido na hora, como a importação faz antes do laço): a troca de token para outra conta,
 * ou o acesso tirado ao imóvel, faz todos os ids sumirem, e "apagada" mandaria a equipe conferir datas de reservas que
 * existem. Uma regra para a fase 2, para a saída da operação em curso (`releituraPorId`) e para a conferência contínua
 * (`reservas-site-conferencia.ts`, com o quarto e a credencial guardados no acompanhamento).
 */
export const podeConcluirApagada = (quartos: readonly QuartoBeds24[], operacao: Pick<OperacaoEmEnvio, "propertyId" | "quarto" | "credencialGuardada">, env: NodeJS.ProcessEnv) =>
  quartoAcessivelEmBrl(quartos, operacao.propertyId, operacao.quarto) === "ok" && operacao.credencialGuardada === impressaoCredencialBeds24(env);

/**
 * O registro relido por id que não deixa escrever (desenho 4.2 e 4.3): na atualização, a reserva tem de estar `confirmed`
 * ou `new` (cancelada no Beds24 é `cancelada_no_beds24`); no cancelamento, também a já `cancelled` serve (só confere e
 * marca); um `black`, outra situação ou outro quarto é `mudada_no_beds24`; e, por último, a marca desta reserva (sem marca
 * legível, `marca_ilegivel`; o código de outra reserva ou o do ensaio, `mudada_no_beds24`: `soMarca`). null = pode escrever.
 */
function registroQueNaoDeixaEscrever(r: ReservaBeds24, operacao: Pick<OperacaoEmEnvio, "tipo" | "quarto" | "codigo">): { motivo: MotivoAntesDaEscrita; soMarca: boolean } | null {
  if (operacao.tipo === "atualizar" && r.estado === "cancelada") return { motivo: "cancelada_no_beds24", soMarca: false };
  const serve = r.estado === "confirmada" || (operacao.tipo === "cancelar" && r.estado === "cancelada");
  if (!serve || r.roomId !== operacao.quarto) return { motivo: "mudada_no_beds24", soMarca: false };
  const marca = diferencaNaMarca(r, operacao.codigo);
  return marca ? { motivo: marca, soMarca: true } : null;
}

/**
 * A releitura por id antes de atualizar ou cancelar (desenho 4.2 e 4.3), só leitura e sem transação: o registro em formato
 * inválido, sem dono ou repetido não conclui (falha antes do POST); o que não voltou é "apagada" ou `sem_acesso`
 * (`podeConcluirApagada`, com a leitura dos quartos desta volta); o que voltou e não deixa escrever é `divergente_antes`.
 */
async function relerAntesDeEscrever(leitor: LeitorBeds24, operacao: OperacaoEmEnvio, quartos: QuartosDaVolta, env: NodeJS.ProcessEnv): Promise<{ ok: true; registro: ReservaBeds24 } | { ok: false; desfecho: DesfechoDaFase2 }> {
  // A atualização e o cancelamento nascem com o id (fase 1): sem ele, não há o que reler (avisar em vez de supor).
  if (!operacao.beds24Id) return { ok: false, desfecho: falhaAntes("A operação está sem o id da reserva no Beds24: nada foi enviado.") };
  const lido = await relerPorIdDaOperacao(leitor, operacao.beds24Id);
  if (!lido.funcionou) return { ok: false, desfecho: falhaAntes("A releitura da reserva no Beds24 não concluiu (a leitura falhou, ou trouxe registro ilegível, sem dono ou repetido): nada foi enviado.", lido.status) };
  if (!lido.registro) {
    const q = await quartos();
    if (!q.ok) return { ok: false, desfecho: falhaAntes(q.erro, q.status) };
    return { ok: false, desfecho: podeConcluirApagada(q.itens, operacao, env) ? { desfecho: "divergente_antes", motivo: "apagada_no_beds24", antes: null, soMarca: false } : { desfecho: "sem_acesso" } };
  }
  const impede = registroQueNaoDeixaEscrever(lido.registro, operacao);
  return impede ? { ok: false, desfecho: { desfecho: "divergente_antes", ...impede, antes: lidoDoRegistro(lido.registro) } } : { ok: true, registro: lido.registro };
}

/**
 * A fase 2 da atualização, sem transação aberta (desenho 4.2): a releitura por id (a marca, `confirmed` ou `new` e o quarto
 * guardado), quem ocupa só as noites NOVAS — contadas a partir do registro relido agora (`noitesNovas`), nunca do `esperado`:
 * depois de uma `mudada_no_beds24`, as noites que o Beds24 deixou livres podem ter sido vendidas numa OTA, e na alteração o
 * Beds24 não confere a disponibilidade —, as travas de todo POST (com o registro relido em `antes`), um POST com as datas e as
 * pessoas (nunca troca o quarto) e, aceito, a releitura do registro e do calendário das noites novas (o overbooking).
 */
async function enviarAtualizacao(db: Db, org: string, operacao: OperacaoEmEnvio, cliente: ClienteDasReservasBeds24, quartos: QuartosDaVolta, o: OpcoesDoEnvio, volta: ResultadoDoEnvioBeds24): Promise<DesfechoDaFase2> {
  await o.ganchos?.antesDaFase2?.(operacao);
  const relido = await relerAntesDeEscrever(cliente, operacao, quartos, o.env);
  if (!relido.ok) return relido.desfecho;
  const { pedido, quarto } = operacao;
  const id = relido.registro.idExterno;
  const antes = lidoDoRegistro(relido.registro);
  const novas = noitesNovas(antes, pedido);
  const ocupantes = await lerOcupantes(cliente, db, org, { imovelId: operacao.imovelId, alvo: { quarto, chegada: pedido.chegada, saida: pedido.saida }, noites: novas, idProprio: id, comPostAnterior: false });
  if (!ocupantes.funcionou) return falhaAntes(ocupantes.erro, ocupantes.status);
  if (ocupantes.ocupacao.resultado !== "livre") return { desfecho: "ocupada", ocupacao: ocupantes.ocupacao, antes };

  const item: ItemGravacaoReserva = { tipo: "atualizar", id, chegada: pedido.chegada, saida: pedido.saida, hospedes: pedido.hospedes ?? 0 };
  const parado = await antesDoPost(db, org, operacao, item, cliente, o, { junto: { antes } });
  if (parado) return parado;
  volta.posts++;
  const resposta = await cliente.gravarReservas(item);
  await gravarResposta(db, operacao, resposta, null);
  return { desfecho: "respondida", resposta, releitura: resposta.resposta === "modificada" ? await relerDepoisDaEscrita(cliente, id, quarto, novas) : null };
}

/**
 * Os registros nossos com a marca desta reserva ainda vivos (desenho 4.3): `confirmed` ou `new`, no quarto guardado, com a
 * marca do info item e a origem que pode ser a do SCL (`registroNossoBeds24`). Uma regra para as duplicadas canceladas junto
 * e para a conferência antes de marcar as datas reabertas (`lerAntesDeLiberar`): uma reserva de OTA com o código no info item
 * ou nas notas nunca entra (cancelá-la no Beds24 liberaria o estoque sem cancelar na OTA: venda dupla).
 */
const vivosComAMarca = (comMarca: readonly ReservaBeds24[], quarto: string) =>
  [...new Set(comMarca.filter((b) => b.estado === "confirmada" && b.roomId === quarto && registroNossoBeds24(b)).map((b) => b.idExterno))].sort();

/**
 * Os outros registros vivos com a marca desta reserva (desenho 4.3: "qualquer outra coisa vira aviso"): fora de `cancelled` e
 * de `inquiry` (a consulta não ocupa), que não são o principal nem um dos nossos que se cancelam (`vivos`) — um nosso em
 * `request` (ocupa o estoque) ou noutro quarto, uma reserva de OTA com o código no info item ou nas notas, um `black` com o
 * código. O sistema nunca os cancela; com algum, as datas não são marcadas como reabertas e a equipe confere
 * (`aguardando_equipe`/`marca_em_registro_inesperado`), como na leitura antes de criar (`lerAntesDeCriar`: qualquer registro
 * vivo com a marca vai à adoção).
 */
const estranhosComAMarca = (comMarca: readonly ReservaBeds24[], principal: string | null, vivos: readonly string[]) =>
  [...new Set(comMarca.filter((b) => b.estado !== "cancelada" && b.estado !== "consulta" && b.idExterno !== principal && !vivos.includes(b.idExterno)).map((b) => b.idExterno))].sort();

/** As respostas que param os POSTs seguintes do mesmo cancelamento: o Beds24 não processou e não vai processar o próximo. */
const paraOsProximosPosts = (r: RespostaBeds24) => RESPOSTAS_NAO_PROCESSADAS.includes(r);

/**
 * A fase 2 do cancelamento, sem transação aberta (desenho 4.3): a releitura por id (`confirmed` ou `new`, ou já
 * `cancelled`, no quarto guardado e com a marca) e a busca nova pela marca. As duplicadas (os outros registros nossos vivos,
 * `vivosComAMarca`) vão para `detalhe.duplicadas` no mesmo UPDATE de `enviado_em`, antes do primeiro POST; então um POST por
 * registro vivo (o principal, se ainda não está cancelado, e cada duplicada), cada um contado no limite da volta, e os
 * seguintes param no que o Beds24 não processou (429, 401, 403, o token) ou sem tempo para mais um POST e a fase 3 — a
 * conferência final mostra o que ficou vivo. Sem nada vivo, nenhum POST: só confere (os outros registros vivos com a marca,
 * `estranhosComAMarca`, e o bloqueio que sobrou) e marca. Com o primeiro POST aceito, a releitura de todos os ids, a busca
 * nova e o bloqueio que sobrou (`lerAntesDeLiberar`).
 */
async function enviarCancelamento(db: Db, org: string, operacao: OperacaoEmEnvio, cliente: ClienteDasReservasBeds24, quartos: QuartosDaVolta, o: OpcoesDoEnvio, volta: ResultadoDoEnvioBeds24): Promise<DesfechoDaFase2> {
  await o.ganchos?.antesDaFase2?.(operacao);
  const relido = await relerAntesDeEscrever(cliente, operacao, quartos, o.env);
  if (!relido.ok) return relido.desfecho;
  const { pedido, quarto } = operacao;
  const principal = relido.registro;
  const antes = lidoDoRegistro(principal);
  const busca = await procurarReservaDoSite(cliente, { referencia: operacao.codigo, quarto, chegada: pedido.chegada, idsConhecidos: operacao.idsConhecidos });
  if (!busca.funcionou) return falhaAntes(busca.erro, busca.status);
  const duplicadas = vivosComAMarca(busca.comMarca, quarto).filter((id) => id !== principal.idExterno);
  const ids = [...(principal.estado === "confirmada" ? [principal.idExterno] : []), ...duplicadas];
  if (!ids.length) {
    const sobrou = await bloqueioQueSobrou(cliente, db, org, operacao, o.relogio.agora());
    if (!sobrou.funcionou) return falhaAntes(sobrou.erro, sobrou.status);
    return { desfecho: "ja_cancelada", registro: principal, antes, estranhos: estranhosComAMarca(busca.comMarca, principal.idExterno, duplicadas), bloqueio: sobrou.bloqueio };
  }

  const comDuplicadas = sql`(${op.detalhe} - 'duplicadas') || ${JSON.stringify(detalheOperacaoBeds24({ duplicadas }))}::jsonb`;
  const parado = await antesDoPost(db, org, operacao, { tipo: "cancelar", id: ids[0] }, cliente, o, { junto: { antes, detalhe: comDuplicadas } });
  if (parado) return parado;
  let primeira: RespostaGravacaoReserva | null = null;
  let ultima: RespostaGravacaoReserva | null = null;
  for (const id of ids) {
    if (primeira && o.relogio.restanteMs() < MINIMO_PARA_O_POST_MS) break;
    volta.posts++;
    ultima = await cliente.gravarReservas({ tipo: "cancelar", id });
    if (!primeira) {
      primeira = ultima;
      await gravarResposta(db, operacao, primeira, null);
    }
    if (paraOsProximosPosts(ultima.resposta)) break;
  }
  const resposta = primeira!;
  const releitura = resposta.resposta === "modificada" ? await relerDepoisDoCancelamento(cliente, db, org, operacao, duplicadas, o.relogio.agora()) : null;
  return { desfecho: "respondida", resposta, releitura, ...(ultima !== primeira ? { ultima: ultima! } : {}) };
}

/** A releitura depois do cancelamento (desenho 4.3 e 4.4): o registro principal pelo id e a conferência antes de liberar; null = não concluiu. */
async function relerDepoisDoCancelamento(leitor: LeitorBeds24, db: Db, org: string, operacao: OperacaoEmEnvio, duplicadas: readonly string[], agora: Date): Promise<ReleituraDepois | null> {
  const lido = await relerPorIdDaOperacao(leitor, operacao.beds24Id!);
  if (!lido.funcionou || !lido.registro) return null;
  const depois = await lerAntesDeLiberar(leitor, db, org, operacao, duplicadas, agora);
  return depois.funcionou ? { tipo: "cancelada", registro: lido.registro, vivos: depois.vivos, estranhos: depois.estranhos, bloqueio: depois.bloqueio } : null;
}

// ---------------------------------------------------------------- fase 3 (desenho 3.6, 4.4 e 6.3)

/**
 * O que a fase 3 deixou, para os números da volta. Na saída da operação em curso, também: `aguardar` (antes dos 5 min, nada
 * concluiu), `manual` (o cancelamento conferido com um bloqueio feito à mão sobrando) e `encerrada` (o cancelamento conferido
 * e marcado).
 */
export type Fechamento =
  | "conferida" | "divergente" | "feita" | "incerta" | "conflito" | "aguardando_equipe" | "recusada" | "falha" | "pendente" | "superada" | "nova_versao" | "descartada"
  | "aguardar" | "manual" | "encerrada"
  /** A cancelada antes de criar achou a criação com a marca e a adotou: o cancelamento dela segue o fluxo normal. */
  | "adotada";

type Acompanhamento = typeof acomp.$inferSelect;
type LinhaDaOperacao = typeof op.$inferSelect;

/**
 * A fase 3 numa transação curta (desenho 3.6): `lock_timeout` de 15 s e `pg_advisory_xact_lock` de `beds24:<org>`, que
 * espera (nunca `esperarEnvioBeds24`: ele veria a própria operação `enviando` e recusaria). No 55P03 e no 40P01 repete até 3
 * vezes, dentro do tempo restante: o fato já está na operação (o id, a resposta e `enviado_em`).
 */
export async function naFase3<T>(db: Db, org: string, o: Pick<OpcoesDoEnvio, "relogio" | "ganchos">, operacao: OperacaoEmEnvio | null, f: (tx: Db) => Promise<T>): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await o.ganchos?.antesDaFase3?.(operacao, tentativa);
      return await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '15s'`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chaveTravaBeds24(org)}))`);
        return f(tx);
      });
    } catch (e) {
      if (!travaOcupada(e) || tentativa >= TENTATIVAS_DA_FASE_3 || o.relogio.restanteMs() < MINIMO_PARA_REPETIR_A_FASE_3_MS) throw e;
    }
  }
}

/** Depois do imóvel e da reserva: o cancelamento e as alterações desta operação, em ordem de id (a ordem única das travas). */
async function travarCancelamentoEAlteracoes(tx: Db, org: string, reservaId: string, alteracoes: readonly string[]) {
  await tx
    .select({ id: cancelamentosReserva.id })
    .from(cancelamentosReserva)
    .where(and(eq(cancelamentosReserva.organizacaoId, org), eq(cancelamentosReserva.reservaId, reservaId)))
    .orderBy(asc(cancelamentosReserva.id))
    .for("update");
  const ids = [...new Set(alteracoes.filter((id) => uuidValido(id)))];
  if (ids.length) await tx.select({ id: alteracoesReserva.id }).from(alteracoesReserva).where(and(eq(alteracoesReserva.organizacaoId, org), inArray(alteracoesReserva.id, ids))).orderBy(asc(alteracoesReserva.id)).for("update");
}

export const ERRO_ALTERACAO_SEM_MARCA = "Uma alteração aplicada não pôde ser marcada como atualizada nas OTAs: confira na ficha.";

const alteracaoJaMarcada = async (tx: Db, org: string, id: string) =>
  Boolean((await tx.select({ em: alteracoesReserva.otaAtualizadaEm }).from(alteracoesReserva).where(and(eq(alteracoesReserva.organizacaoId, org), eq(alteracoesReserva.id, id))))[0]?.em);

/**
 * "Datas atualizadas nas OTAs" das alterações lidas na fase 1 (desenho 6.3), com `por` nulo: o sistema. "Já marcada" conta
 * como sucesso, e a decisão sai do estado da linha, nunca do texto de `marcarOtaAtualizada` (que devolve `ok: false` também
 * nesse caso): relida antes e depois. false = alguma ficou sem a marca, um erro de verdade (fica no `erro` da operação).
 */
export async function marcarAlteracoesNasOtas(tx: Db, org: string, ids: readonly string[], agora: Date): Promise<boolean> {
  let todas = true;
  for (const id of ids) {
    if (await alteracaoJaMarcada(tx, org, id)) continue;
    const r = await marcarOtaAtualizada(tx, org, id, null, agora);
    if (!r.ok && !(await alteracaoJaMarcada(tx, org, id))) todas = false;
  }
  return todas;
}

/** As gravações da fase 3 sobre a operação e o acompanhamento desta reserva, já travados. */
function gravacoes(tx: Db, operacao: Pick<OperacaoEmEnvio, "id">, linha: LinhaDaOperacao, a: Acompanhamento, agora: Date) {
  return {
    operacao: (campos: PgUpdateSetSource<typeof op>) => tx.update(op).set(campos).where(eq(op.id, operacao.id)),
    /** O `detalhe` de agora mais o novo, pela forma fechada (o que não passa na validação some). */
    detalhe: (mais: DetalheOperacaoBeds24) => detalheOperacaoBeds24({ ...detalheOperacaoBeds24(linha.detalhe), ...mais }),
    acompanhamento: (campos: Partial<typeof acomp.$inferInsert>, situacaoDaOperacao: SituacaoOperacaoBeds24) => gravarAcompanhamentoNaFase3(tx, a, campos, situacaoDaOperacao, agora),
  };
}
type Gravacoes = ReturnType<typeof gravacoes>;

/**
 * Grava o acompanhamento já travado na fase 3. A transição para um caso de e-mail à equipe (desenho 6.5,
 * `casoDeEmailBeds24`) zera `avisada_em`: o aviso sai depois do commit, nunca de dentro da transação.
 */
async function gravarAcompanhamentoNaFase3(tx: Db, a: Acompanhamento, campos: Partial<typeof acomp.$inferInsert>, situacaoDaOperacao: SituacaoOperacaoBeds24, agora: Date) {
  const situacao: SituacaoAcompanhamentoBeds24 = campos.situacao ?? a.situacao;
  const motivo: MotivoAcompanhamentoBeds24 | null = campos.motivo === undefined ? a.motivo : campos.motivo;
  const transicao = (situacao !== a.situacao || motivo !== a.motivo) && casoDeEmailBeds24(situacao, motivo, situacaoDaOperacao) !== null;
  await tx.update(acomp).set({ ...campos, ...(transicao ? { avisadaEm: null } : {}), atualizadoEm: agora }).where(eq(acomp.id, a.id));
}

const terminada = { terminadoEm: agoraDoBanco };

/**
 * A incerteza terminou — a conclusão (conferida, divergente, a marca que não bate, a recusa) ou a versão seguinte, que é
 * outra intenção: o contador de buscas é dela (desenho 3.4) e volta a zero; senão, a próxima incerteza da reserva iria à
 * equipe antes da terceira busca. "Tentar de novo" não zera (é a mesma incerteza, nas mãos da equipe).
 */
const FIM_DA_INCERTEZA = { buscasSemConclusao: 0 } as const;

/**
 * Falha antes do POST (desenho 9: a leitura falhou, o token não veio): a operação volta a `pendente`, sem `enviado_em`, e o
 * acompanhamento espera o atraso da tabela (10, 20, 40, 80 e 160 min). Na 5ª, a operação fica `falhou` e o acompanhamento
 * `aguardando_equipe`/`falhas`, com e-mail ("Tentar de novo" envia na volta seguinte).
 */
async function falhaAntesDoPost(g: Gravacoes, a: Acompanhamento, erro: string, agora: Date): Promise<Fechamento> {
  const tentativas = a.tentativas + 1;
  const { minutos, equipe } = atrasoDaFalha(tentativas);
  if (equipe) {
    await g.operacao({ situacao: "falhou", erro, ...terminada });
    await g.acompanhamento({ situacao: "aguardando_equipe", motivo: "falhas", tentativas, proximaTentativaEm: null }, "falhou");
  } else {
    await g.operacao({ situacao: "pendente", erro });
    await g.acompanhamento({ situacao: "pendente", motivo: null, tentativas, proximaTentativaEm: new Date(agora.getTime() + minutos * 60_000) }, "pendente");
  }
  return "falha";
}

/** A marca em mais de um registro, ou num registro que não bate (desenho 3.5): nada fica ativo, e a equipe decide com os ids. */
async function marcaQueNaoBate(g: Gravacoes, motivo: "duplicada" | "marca_em_registro_inesperado", ids: string[]): Promise<Fechamento> {
  await g.operacao({ situacao: "divergente", detalhe: g.detalhe({ duplicadas: ids }), ...terminada });
  await g.acompanhamento({ situacao: "aguardando_equipe", motivo, ...FIM_DA_INCERTEZA }, "divergente");
  return "aguardando_equipe";
}

/**
 * Quem ocupa as noites (desenho 4.1; nada é criado, e a operação fica terminal): outra reserva é `conflito`/`noites_ocupadas`
 * ("possível venda dupla", com e-mail); o bloqueio feito à mão, o bloqueio do próprio SCL e a falta de unidade livre vão à
 * equipe, com as noites do bloqueio em `detalhe.bloqueio`. O ocupante exato (com um POST anterior desta reserva, a origem que
 * pode ser a do SCL e sem marca legível) nunca vira venda dupla: `aguardando_equipe`/`incerta`, com o id sugerido em
 * `detalhe.candidato` (o "Vincular" já preenchido) e nunca em `beds24_id`.
 */
async function noitesOcupadas(g: Gravacoes, ocupacao: Extract<DesfechoDaFase2, { desfecho: "ocupada" }>["ocupacao"]): Promise<Fechamento> {
  if (ocupacao.resultado === "noites_ocupadas") {
    await g.operacao({ situacao: "conflito", ...terminada });
    await g.acompanhamento({ situacao: "conflito", motivo: "noites_ocupadas" }, "conflito");
    return "conflito";
  }
  if (ocupacao.resultado === "ocupante_exato") {
    await g.operacao({ situacao: "divergente", detalhe: g.detalhe({ candidato: ocupacao.id }), ...terminada });
    await g.acompanhamento({ situacao: "aguardando_equipe", motivo: "incerta" }, "divergente");
    return "aguardando_equipe";
  }
  const bloqueio = ocupacao.resultado === "sem_disponibilidade" ? {} : { detalhe: g.detalhe({ bloqueio: ocupacao.bloqueio }) };
  await g.operacao({ situacao: "conflito", ...bloqueio, ...terminada });
  await g.acompanhamento({ situacao: "aguardando_equipe", motivo: ocupacao.resultado }, "conflito");
  return "aguardando_equipe";
}

/**
 * A operação com POST tentado nunca volta (desenho 3.3): fica `falhou`, com a resposta e o `enviado_em` (a prova do POST,
 * nunca limpa), e a mesma intenção nasce na versão seguinte, `pendente` — sem atraso no 429 (o pedido não foi processado) e
 * com o da tabela quando o token caiu depois do primeiro 401 (`atraso`).
 */
async function novaVersao(tx: Db, org: string, g: Gravacoes, operacao: OperacaoEmEnvio, linha: LinhaDaOperacao, a: Acompanhamento, atraso: { tentativas: number; proximaTentativaEm: Date } | null): Promise<Fechamento> {
  await g.operacao({ situacao: "falhou", ...terminada });
  const versao = a.versao + 1;
  const [nova] = await tx
    .insert(op)
    .values({
      organizacaoId: org, reservaId: operacao.reservaId, acompanhamentoId: a.id, tipo: operacao.tipo, chave: chaveOperacaoBeds24(operacao.tipo, operacao.reservaId, versao), modo: "real",
      situacao: "pendente", pedido: linha.pedido ?? operacao.pedido, alteracoes: linha.alteracoes, beds24Id: operacao.tipo === "criar" ? null : operacao.beds24Id, credencial: linha.credencial,
    })
    .onConflictDoNothing({ target: [op.organizacaoId, op.chave] })
    .returning({ id: op.id });
  await g.acompanhamento({ situacao: "pendente", motivo: null, ...FIM_DA_INCERTEZA, ...(nova ? { versao } : {}), ...(atraso ?? {}) }, "pendente");
  return atraso ? "falha" : "nova_versao";
}

/**
 * A conferência depois da criação ou da atualização (desenho 4.4: as duas deixam a reserva confirmada no Beds24 como o
 * pedido), com o registro relido (ou o achado pela busca, na adoção): igual ao pedido e com a marca desta reserva =
 * `conferida`; diferente = `divergente` com o motivo; sem marca legível = `divergente`/`marca_ilegivel` (que também para as
 * criações novas, desenho 4.4). Conferida, a operação termina e, só com a assinatura do SCL igual à da fase 1, o
 * acompanhamento fica `conferida` com as marcas (desenho 6.3: `ota_fechada_em` agora, com `por` nulo, se estiver vazia; as
 * alterações lidas na fase 1). O overbooking (`livres < 0` nas noites escritas) não muda isso: a nossa reserva está certa, e
 * o motivo `noites_ocupadas` pede a atenção e o e-mail. Com o SCL mudado, nenhuma marca: o acompanhamento fica `pendente` e a
 * próxima operação vai para a fila agora.
 */
async function conferirAConfirmada(tx: Db, org: string, g: Gravacoes, operacao: OperacaoEmEnvio, reserva: typeof reservas.$inferSelect, a: Acompanhamento, registro: ReservaBeds24, overbooking: readonly string[], agora: Date): Promise<Fechamento> {
  const lido = lidoDoRegistro(registro);
  const leitura = { lido, lidoEm: agora, ...FIM_DA_INCERTEZA };
  const motivo = diferencaNoBeds24(operacao.pedido, lido)?.motivo ?? diferencaNaMarca(registro, operacao.codigo);
  if (motivo) {
    await g.operacao({ situacao: "divergente", depois: lido, ...terminada });
    await g.acompanhamento({ ...leitura, situacao: "divergente", motivo }, "divergente");
    return "divergente";
  }
  await g.operacao({ situacao: "conferida", depois: lido, ...terminada });
  if (assinaturaAtualDoScl(reserva, operacao.quarto) !== assinaturaEsperado(operacao.pedido)) {
    await g.acompanhamento({ ...leitura, situacao: "pendente", motivo: null, conferidaEm: agora, tentativas: 0, proximaTentativaEm: agora }, "conferida");
    return "pendente";
  }
  if (!(await marcarAlteracoesNasOtas(tx, org, operacao.alteracoes, agora))) await g.operacao({ erro: ERRO_ALTERACAO_SEM_MARCA });
  await g.acompanhamento(
    { ...leitura, situacao: "conferida", motivo: overbooking.length ? "noites_ocupadas" : null, conferidaEm: agora, tentativas: 0, proximaTentativaEm: null, ...(a.otaFechadaEm ? {} : { otaFechadaEm: agora, otaFechadaPor: null }) },
    "conferida",
  );
  return "conferida";
}

/**
 * O fato da criação (desenho 3.6: a fase 3 sempre grava o fato externo): o id na reserva (`reservas.beds24_id`), com a
 * auditoria `beds24.reserva.criar`, sem contato. Outro id já ligado a ela, ou o id já de outra reserva do SCL, é a marca que
 * não bate (nada fica ativo; a equipe decide com os ids). null = gravado; senão, o fechamento da marca que não bate.
 */
async function gravarACriacao(tx: Db, org: string, g: Gravacoes, operacao: OperacaoEmEnvio, reserva: typeof reservas.$inferSelect, id: string): Promise<Fechamento | null> {
  const ligado = reserva.beds24Id;
  if (ligado && ligado !== id) return marcaQueNaoBate(g, "duplicada", [ligado, id].sort());
  const [outra] = await tx.select({ id: reservas.id }).from(reservas).where(and(eq(reservas.organizacaoId, org), eq(reservas.beds24Id, id), ne(reservas.id, operacao.reservaId))).limit(1);
  if (outra) return marcaQueNaoBate(g, "marca_em_registro_inesperado", [id]);
  if (ligado !== id) await tx.update(reservas).set({ beds24Id: id }).where(eq(reservas.id, operacao.reservaId));
  await registrarAuditoria(tx, { organizacaoId: org, usuarioId: null, acao: "beds24.reserva.criar", entidade: "reserva", entidadeId: operacao.reservaId, mudancas: { beds24Id: [ligado, id] } });
  return null;
}

/**
 * O fato da atualização e do cancelamento que o Beds24 aceitou (desenho 3.6: a fase 3 sempre grava o fato externo), com a
 * auditoria `beds24.reserva.atualizar` ou `.cancelar`, sem contato, uma vez só e logo que se sabe que a escrita valeu, qualquer
 * que seja a conferência depois: na fase 3 de depois do POST (a resposta `modificada`) ou na saída da operação em curso que
 * relê o registro igual ao pedido (`sairPorId`, a `incerta` e a `enviando` vencida; a `feita` já gravou). Leva as datas e as
 * pessoas de antes (o registro relido na fase 2, `antes`) e as do pedido; no cancelamento, a situação e os ids das duplicadas
 * que a operação mandou cancelar (`detalhe.duplicadas`, gravados antes do primeiro POST). Nunca sem POST: o registro já
 * cancelado no Beds24 (`ja_cancelada`) não grava nada aqui.
 */
async function auditarEscritaAceita(tx: Db, org: string, operacao: Pick<OperacaoEmEnvio, "tipo" | "reservaId" | "pedido">, linha: Pick<LinhaDaOperacao, "antes" | "detalhe">) {
  const { antes } = linha;
  const { pedido } = operacao;
  await registrarAuditoria(tx, {
    organizacaoId: org, usuarioId: null, acao: `beds24.reserva.${operacao.tipo}`, entidade: "reserva", entidadeId: operacao.reservaId,
    mudancas:
      operacao.tipo === "cancelar"
        ? { situacaoNoBeds24: [antes?.situacao ?? null, "cancelada"], duplicadas: [null, detalheOperacaoBeds24(linha.detalhe).duplicadas ?? []] }
        : { chegada: [antes?.chegada ?? null, pedido.chegada], saida: [antes?.saida ?? null, pedido.saida], hospedes: [antes?.hospedes ?? null, pedido.hospedes ?? null] },
  });
}

/**
 * Depois do POST (desenho 3.8):
 * - `criada` (na criação): o fato vai para a reserva (`gravarACriacao`) e segue a conferência; sem a releitura, a operação
 *   fica `feita` (o passo 1 da volta seguinte confere);
 * - `modificada` (na atualização e no cancelamento): o fato vai para a auditoria (`auditarEscritaAceita`) e segue a
 *   conferência por id (`conferirDepoisPorId`); sem a releitura do tipo (o cancelamento só conclui com a conferência antes de
 *   liberar), `feita`;
 * - `limite` (o 429 sem a lista) e `nao_enviado` (o token caiu depois do primeiro 401): nada foi processado, e nasce a versão
 *   seguinte (no `nao_enviado`, com o atraso; na 5ª falha, a equipe);
 * - `http_401` e `http_403`: `recusada`, e o acompanhamento `aguardando_equipe`/`sem_permissao`, sem busca;
 * - o resto (sem id, recusa, outro 4xx, tempo, rede, 5xx, formato, ou o sucesso que não é o deste tipo): `incerta` — a saída
 *   decide na volta seguinte, nunca nesta, e o acompanhamento continua `em_envio`.
 */
async function depoisDaResposta(c: NaFase3DaSaida, org: string, operacao: OperacaoEmEnvio, d: Extract<DesfechoDaFase2, { desfecho: "respondida" }>): Promise<Fechamento> {
  const { tx, t, linha, a, g, agora } = c;
  const aceito = operacao.tipo === "criar" ? d.resposta.resposta === "criada" : d.resposta.resposta === "modificada";
  if (aceito) {
    if (operacao.tipo === "criar") {
      const naoBate = await gravarACriacao(tx, org, g, operacao, t.reserva, d.resposta.beds24Id!);
      if (naoBate) return naoBate;
    } else await auditarEscritaAceita(tx, org, operacao, linha);
    // A releitura tem de ser a do tipo: o cancelamento só marca as datas reabertas depois da conferência antes de liberar (as
    // duplicadas e os outros registros vivos com a marca, o bloqueio que sobrou). Sem ela, nada é marcado: a operação fica
    // `feita`, e o passo 1 da volta seguinte confere.
    const r = d.releitura;
    if (!r || (r.tipo === "cancelada") !== (operacao.tipo === "cancelar")) {
      await g.operacao({ situacao: "feita" });
      return "feita";
    }
    if (r.tipo === "cancelada") {
      const { registro, vivos, estranhos, bloqueio } = r;
      return conferirDepoisPorId(c, org, operacao, registro, { funcionou: true, overbooking: [], vivos, estranhos, bloqueio });
    }
    if (operacao.tipo === "criar") return conferirAConfirmada(tx, org, g, operacao, t.reserva, a, r.registro, r.overbooking, agora);
    return conferirDepoisPorId(c, org, operacao, r.registro, { funcionou: true, overbooking: r.overbooking, ...NADA_A_LIBERAR });
  }
  switch (d.resposta.resposta) {
    case "limite":
      return novaVersao(tx, org, g, operacao, linha, a, null);
    case "nao_enviado": {
      const tentativas = a.tentativas + 1;
      const { minutos, equipe } = atrasoDaFalha(tentativas);
      if (!equipe) return novaVersao(tx, org, g, operacao, linha, a, { tentativas, proximaTentativaEm: new Date(agora.getTime() + minutos * 60_000) });
      await g.operacao({ situacao: "falhou", ...terminada });
      await g.acompanhamento({ situacao: "aguardando_equipe", motivo: "falhas", tentativas, proximaTentativaEm: null }, "falhou");
      return "falha";
    }
    case "http_401":
    case "http_403":
      await g.operacao({ situacao: "recusada", ...terminada });
      await g.acompanhamento({ situacao: "aguardando_equipe", motivo: "sem_permissao" }, "recusada");
      return "recusada";
    default:
      await g.operacao({ situacao: "incerta" });
      return "incerta";
  }
}

/**
 * A fase 3 de uma operação (a criação, a atualização ou o cancelamento): trava, na ordem única, o imóvel e a reserva
 * (`update` quando o `beds24_id` muda: a criação e a adoção; senão `no key update`, que não bloqueia o `FOR KEY SHARE` dos
 * lançamentos) e o acompanhamento (`travarReservaDoSite`), o cancelamento e as alterações, e relê a operação: só conclui a que
 * ainda está `enviando` com o `enviado_em` do momento (nulo antes do POST, preenchido depois). Senão, outra conclusão já foi
 * aplicada e esta é descartada (a Vercel pode entregar o mesmo disparo duas vezes; a `enviando` vencida tem saída própria).
 */
async function fecharOperacao(db: Db, org: string, operacao: OperacaoEmEnvio, d: DesfechoDaFase2, o: OpcoesDoEnvio): Promise<Fechamento> {
  if (d.desfecho === "perdida") return "descartada";
  const agora = o.relogio.agora();
  const depoisDoPost = d.desfecho === "respondida";
  const mudaOId = operacao.tipo === "criar" && (d.desfecho === "adotar" || (d.desfecho === "respondida" && d.resposta.resposta === "criada"));
  return naFase3(db, org, o, operacao, async (tx) => {
    const t = await travarReservaDoSite(tx, org, operacao.reservaId, mudaOId ? "update" : "no key update");
    if (!t?.acompanhamento) return "descartada";
    await travarCancelamentoEAlteracoes(tx, org, operacao.reservaId, operacao.alteracoes);
    const [linha] = await tx.select().from(op).where(and(eq(op.id, operacao.id), eq(op.organizacaoId, org))).for("update");
    if (!linha || linha.situacao !== "enviando" || (linha.enviadoEm !== null) !== depoisDoPost) return "descartada";
    const a = t.acompanhamento;
    const g = gravacoes(tx, operacao, linha, a, agora);
    const c: NaFase3DaSaida = { tx, t: { reserva: t.reserva, acompanhamento: a }, linha, a, g, agora };
    switch (d.desfecho) {
      case "falha_antes":
        return falhaAntesDoPost(g, a, d.erro, agora);
      case "pausa":
      case "sem_tempo":
        await g.operacao({ situacao: "pendente" });
        await g.acompanhamento({ situacao: "pendente", motivo: null }, "pendente");
        return "pendente";
      case "desligado":
      case "sem_vinculo":
        await g.operacao({ situacao: "superada", ...terminada });
        await g.acompanhamento({ situacao: "pendente", motivo: d.desfecho === "sem_vinculo" ? "sem_vinculo" : null, ...SEM_INTENCAO_DE_CRIAR }, "superada");
        return "superada";
      case "marca":
        return marcaQueNaoBate(g, d.motivo, d.ids);
      case "ocupada":
        // Na atualização, o registro relido antes (a base das noites novas) fica na operação.
        if (d.antes) await g.operacao({ antes: d.antes });
        return noitesOcupadas(g, d.ocupacao);
      case "divergente_antes":
        return divergenteAntesDaEscrita(g, operacao, d, agora);
      case "sem_acesso":
        // O id não voltou, e a credencial trocada desde a criação (ou o quarto sem acesso) não deixa concluir "apagada": nada
        // foi enviado, nada é marcado, e a equipe confere a credencial ("Tentar de novo" depois).
        await g.operacao({ situacao: "falhou", erro: ERRO_SEM_ACESSO_A_RESERVA, ...terminada });
        await g.acompanhamento({ situacao: "aguardando_equipe", motivo: "sem_permissao" }, "falhou");
        return "aguardando_equipe";
      case "ja_cancelada":
        // Nada foi enviado: só a conferência e as marcas (nunca a auditoria de um cancelamento que o sistema não fez).
        await g.operacao({ antes: d.antes });
        return conferirOCancelamento(c, org, operacao, d.registro, { funcionou: true, overbooking: [], vivos: [], estranhos: d.estranhos, bloqueio: d.bloqueio });
      case "adotar": {
        // A busca achou a marca antes de criar: adota pelas regras (a mesma função da importação), sem POST, e confere.
        const ad = await adotarReservaCriada(tx, org, operacao.reservaId, d.comMarca);
        if (ad.adotada) return conferirAConfirmada(tx, org, g, operacao, t.reserva, a, d.registro, [], agora);
        if (ad.motivo === "duplicada") return marcaQueNaoBate(g, "duplicada", ad.ids);
        if (ad.motivo === "marca_em_registro_inesperado" || ad.motivo === "id_de_outra_reserva") return marcaQueNaoBate(g, "marca_em_registro_inesperado", [ad.id]);
        if (ad.motivo === "sem_acompanhamento") {
          await g.operacao({ situacao: "superada", ...terminada });
          return "superada";
        }
        return falhaAntesDoPost(g, a, "A busca achou a marca da reserva, mas a adoção não concluiu: nada foi enviado.", agora);
      }
      case "respondida":
        return depoisDaResposta(c, org, operacao, d);
    }
    return "descartada";
  });
}

export const ERRO_SEM_ACESSO_A_RESERVA = "A reserva não voltou na leitura do Beds24 com a credencial de agora (trocada desde a criação, ou sem acesso ao imóvel): nada foi enviado.";

/**
 * O registro relido antes de atualizar ou cancelar não deixa escrever (desenho 4.2 e 4.3): nada é enviado, a operação fica
 * `divergente` (terminal), com o registro em `antes`, e o acompanhamento `divergente` com o motivo (o e-mail da divergência ou
 * da marca ilegível). Na atualização (a reserva confirmada), as datas, a situação ou o quarto mudados por fora, ou o registro
 * apagado, reabrem a pendência das datas nas OTAs, como na importação; só a marca, não. O cancelamento nunca mexe nela.
 */
async function divergenteAntesDaEscrita(g: Gravacoes, operacao: OperacaoEmEnvio, d: Extract<DesfechoDaFase2, { desfecho: "divergente_antes" }>, agora: Date): Promise<Fechamento> {
  await g.operacao({ situacao: "divergente", ...(d.antes ? { antes: d.antes } : {}), ...terminada });
  const reabre = operacao.tipo === "atualizar" && !d.soMarca;
  await g.acompanhamento({ lido: d.antes, lidoEm: agora, situacao: "divergente", motivo: d.motivo, ...FIM_DA_INCERTEZA, ...(reabre ? { otaFechadaEm: null, otaFechadaPor: null } : {}) }, "divergente");
  return "divergente";
}

// ---------------------------------------------------------------- a volta (desenho 9)

/** As reservas que podem pedir uma criação agora (a régua decide na fase 1): só leitura, sem trava. */
async function candidatasACriar(db: Db, org: string, agora: Date, config: ConfigReservasBeds24): Promise<{ id: string; imovelId: string }[]> {
  const hoje = hojeISO(FUSO_PADRAO, agora);
  const ligados = config.imoveis.map((i) => i.imovelId);
  // Uma `criar` na fila (de qualquer situação da reserva): a fila decide, e ela pode virar `superada` (desligado, cancelada).
  const naFila = exists(db.select({ id: op.id }).from(op).where(and(eq(op.organizacaoId, org), eq(op.reservaId, reservas.id), eq(op.modo, "real"), eq(op.tipo, "criar"), eq(op.situacao, "pendente"))));
  const paga = exists(db.select({ id: pagamentos.id }).from(pagamentos).where(and(eq(pagamentos.organizacaoId, org), eq(pagamentos.reservaId, reservas.id), eq(pagamentos.desfecho, "reserva"))));
  // A confirmada e paga pelo site no imóvel ligado, sem id no Beds24, com a saída depois de hoje e sem acompanhamento (ou com
  // ele à espera de um envio): inclusive a confirmada antes da ligação, que ganha a linha `manual`.
  const aCriar = ligados.length
    ? and(eq(reservas.estado, "confirmada"), isNull(reservas.beds24Id), sql`${reservas.checkout} > ${hoje}`, inArray(reservas.imovelId, ligados), or(isNull(acomp.id), inArray(acomp.situacao, ["pendente", "em_envio"])), paga)
    : undefined;
  return db
    .select({ id: reservas.id, imovelId: reservas.imovelId })
    .from(reservas)
    .leftJoin(acomp, and(eq(acomp.reservaId, reservas.id), eq(acomp.organizacaoId, org)))
    .where(and(eq(reservas.organizacaoId, org), eq(reservas.fonte, "site"), or(naFila, aCriar)))
    .orderBy(asc(reservas.checkin), asc(reservas.codigo));
}

/** O limite que vale antes de cada operação nova: os 10 POSTs, os 150 s e as janelas da importação e do envio diários. */
function paradaAntesDaOperacao(o: OpcoesDoEnvio, r: ResultadoDoEnvioBeds24): MotivoDaParadaBeds24 | null {
  if (r.posts >= LIMITE_DE_POSTS_POR_VOLTA) return "limite_da_volta";
  if (o.relogio.restanteMs() < MINIMO_PARA_OPERACAO_MS) return "tempo";
  if (dentroDeJanela(o.relogio.agora())) return "janela";
  return null;
}

/**
 * A parada que o fim da operação pede: a pausa e o tempo; o 429, o 401 ou o 403, antes do POST (o token e as leituras) ou na
 * resposta de qualquer POST dela (o cancelamento leva as duplicadas: a primeira e a última resposta); e o crédito restante
 * abaixo de 20 na última resposta (nomes dos dois cabeçalhos).
 */
function paradaDepoisDaOperacao(d: DesfechoDaFase2): MotivoDaParadaBeds24 | null {
  if (d.desfecho === "pausa") return "pausa";
  if (d.desfecho === "sem_tempo") return "tempo";
  if (d.desfecho === "falha_antes") return d.parada ?? null;
  if (d.desfecho !== "respondida") return null;
  const respostas = [d.resposta.resposta, ...(d.ultima ? [d.ultima.resposta] : [])];
  if (respostas.includes("limite")) return "limite";
  if (respostas.includes("http_401") || respostas.includes("http_403")) return "sem_permissao";
  const { creditoRestante } = d.ultima ?? d.resposta;
  return creditoRestante !== null && creditoRestante < CREDITO_MINIMO_BEDS24 ? "credito" : null;
}

/** Os números da volta: o que o Beds24 aceitou, por tipo, e como cada operação terminou. */
function contar(r: ResultadoDoEnvioBeds24, tipo: AcaoBeds24, d: DesfechoDaFase2 | null, f: Fechamento) {
  if (d?.desfecho === "respondida" && f !== "descartada") {
    if (tipo === "criar" && d.resposta.resposta === "criada") r.criadas++;
    if (tipo !== "criar" && d.resposta.resposta === "modificada") r[tipo === "cancelar" ? "canceladas" : "atualizadas"]++;
  }
  if (f === "conferida" || f === "encerrada") r.conferidas++;
  else if (f === "incerta") r.incertas++;
  else if (f === "falha") r.falhas++;
  else if (f === "divergente" || f === "conflito" || f === "aguardando_equipe" || f === "recusada" || f === "manual") r.avisos++;
}

/** O motivo de configuração que para a escrita agora (desenho 2.4 e 7), pela função única, com a leitura dos escopos desta volta. */
const configuracaoDeAgora = async (db: Db, org: string, o: OpcoesDoEnvio) =>
  motivoDeConfiguracaoDasReservas(await estadoDaConfiguracaoDasReservas(db, org, o.env, o.relogio.agora(), { leituraFalhou: o.leituraDosEscoposFalhou }));

/**
 * O passo das criações (desenho 9, passo 4): as reservas candidatas, uma a uma, cada uma nas três fases. Antes da fase 1, o
 * quarto do vínculo é conferido na leitura dos quartos desta volta (uma vez só): inacessível ou com outra moeda, a régua
 * responde `parada`/`sem_vinculo` e nenhuma operação nasce (sem isso, cada volta abriria e superaria uma versão nova).
 */
async function criarAsReservas(db: Db, org: string, cliente: ClienteDasReservasBeds24, quartos: QuartosDaVolta, o: OpcoesDoEnvio, r: ResultadoDoEnvioBeds24) {
  const candidatas = await candidatasACriar(db, org, o.relogio.agora(), await lerConfigReservasBeds24(db, org));
  if (!candidatas.length) return;
  const mapas = await listarMapeamentosBeds24(db, org);
  for (const c of candidatas) {
    r.parada = paradaAntesDaOperacao(o, r);
    if (r.parada) return;
    const vinculo = vinculoDoImovel(mapas, c.imovelId);
    const lidos = vinculo ? await quartos() : null;
    const quartoSemAcesso = Boolean(vinculo && lidos?.ok && quartoAcessivelEmBrl(lidos.itens, vinculo.propertyId, vinculo.roomId) !== "ok");
    const aberta = await abrirIntencao(db, org, c.id, { agora: o.relogio.agora(), env: o.env, tipos: ["criar"], quartoSemAcesso });
    if (aberta.saida === "parar_volta") {
      r.parada = aberta.motivo;
      return;
    }
    if (aberta.saida !== "enviar") continue;
    let d: DesfechoDaFase2;
    o.prazoDaOperacao?.(AbortSignal.timeout(PRAZO_DA_FASE_2_MS));
    try {
      d = await enviarCriacao(db, org, aberta.operacao, cliente, quartos, o, r);
    } finally {
      o.prazoDaOperacao?.(null);
    }
    const f = await fecharOperacao(db, org, aberta.operacao, d, o);
    contar(r, "criar", d, f);
    r.parada = paradaDepoisDaOperacao(d);
    if (r.parada) return;
    // A conferência desta criação deu divergente: se foi a marca ilegível (desenho 4.4), as criações param já nesta volta —
    // sem a marca, a busca não protege da duplicata. A regra é a mesma do começo da volta (`motivoDeConfiguracaoDasReservas`).
    if (f === "divergente") {
      r.configuracao = await configuracaoDeAgora(db, org, o);
      if (r.configuracao) return;
    }
  }
}

/**
 * As reservas que podem pedir uma atualização ou um cancelamento agora (a régua decide na fase 1), só leitura e sem trava,
 * em ordem de entrada. Sempre a que tem uma operação desse tipo na fila (a fila decide; ela pode virar `superada`). Fora dela:
 * - atualizar: a confirmada criada pelo M8.3 (o id na reserva e o quarto guardado), com a saída a partir de hoje, o
 *   acompanhamento `pendente`, `em_envio` ou `conferida` (os outros, a régua suspende) e o SCL diferente da última intenção;
 * - cancelar: a cancelada com o cancelamento decidido, a saída depois de hoje (há noites a reabrir) e o acompanhamento fora
 *   de `manual` e `encerrada`. A criada pelo M8.3, com o SCL diferente da última intenção. A que não foi criada (a leitura de
 *   6.3, `cancelarAntesDeCriar`), com as datas ainda não marcadas como reabertas e sem ter ido à equipe depois do
 *   cancelamento (a leitura de depois dele já respondeu; "Conferir agora" relê na hora, e reler a cada volta só gastaria
 *   créditos).
 */
async function candidatasPorId(db: Db, org: string, agora: Date, tipo: "atualizar" | "cancelar"): Promise<string[]> {
  const hoje = hojeISO(FUSO_PADRAO, agora);
  const naFila = await db
    .selectDistinct({ id: op.reservaId })
    .from(op)
    .where(and(eq(op.organizacaoId, org), eq(op.modo, "real"), eq(op.tipo, tipo), eq(op.situacao, "pendente"), isNull(op.enviadoEm)));
  const daFila = new Set(naFila.map((x) => x.id).filter((x): x is string => x !== null));
  const base = { id: reservas.id, estado: reservas.estado, checkin: reservas.checkin, checkout: reservas.checkout, hospedes: reservas.hospedes, beds24Id: reservas.beds24Id, roomId: acomp.roomId, assinatura: acomp.assinaturaEsperada, situacao: acomp.situacao, lidoEm: acomp.lidoEm };
  const naOrg = and(eq(reservas.organizacaoId, org), eq(reservas.fonte, "site"));
  const mudou = (l: { estado: typeof reservas.$inferSelect.estado; checkin: string; checkout: string; hospedes: number | null; roomId: string | null; assinatura: string | null }) => assinaturaAtualDoScl(l, l.roomId!) !== l.assinatura;
  let ids: string[];
  if (tipo === "atualizar") {
    const linhas = await db
      .select(base)
      .from(reservas)
      .innerJoin(acomp, and(eq(acomp.reservaId, reservas.id), eq(acomp.organizacaoId, org)))
      .where(and(naOrg, eq(reservas.estado, "confirmada"), isNotNull(reservas.beds24Id), isNotNull(acomp.roomId), sql`${reservas.checkout} >= ${hoje}`, inArray(acomp.situacao, ["pendente", "em_envio", "conferida"])))
      .orderBy(asc(reservas.checkin), asc(reservas.codigo));
    ids = linhas.filter(mudou).map((l) => l.id);
  } else {
    const linhas = await db
      .select({ ...base, canceladaEm: cancelamentosReserva.canceladaEm, liberadaEm: cancelamentosReserva.otaLiberadaEm })
      .from(reservas)
      .innerJoin(acomp, and(eq(acomp.reservaId, reservas.id), eq(acomp.organizacaoId, org)))
      .innerJoin(cancelamentosReserva, and(eq(cancelamentosReserva.reservaId, reservas.id), eq(cancelamentosReserva.organizacaoId, org), eq(cancelamentosReserva.situacao, "cancelada")))
      .where(and(naOrg, eq(reservas.estado, "cancelada"), sql`${reservas.checkout} > ${hoje}`, notInArray(acomp.situacao, ["manual", "encerrada"])))
      .orderBy(asc(reservas.checkin), asc(reservas.codigo));
    const jaFoiAEquipe = (l: (typeof linhas)[number]) => l.situacao === "aguardando_equipe" && l.lidoEm !== null && (!l.canceladaEm || l.lidoEm.getTime() >= l.canceladaEm.getTime());
    ids = linhas.filter((l) => (l.beds24Id && l.roomId ? mudou(l) : !l.liberadaEm && !jaFoiAEquipe(l))).map((l) => l.id);
  }
  const fora = [...daFila].filter((id) => !ids.includes(id));
  return [...ids, ...fora];
}

/**
 * Uma reserva no passo dela (a atualização ou o cancelamento): a fase 1 (`abrirIntencao`, só com esta ação), a fase 2 do
 * tipo, com o prazo próprio, e a fase 3. No cancelamento, a cancelada antes de ser criada segue para a leitura de 6.3
 * (`cancelarAntesDeCriar`); se a leitura achou e adotou a criação, a reserva passa a ser criada pelo M8.3 e o cancelamento
 * dela sai já nesta volta (a fase 1 de novo, uma vez). Devolve o fechamento (null = nada saiu).
 */
async function escreverUma(db: Db, org: string, reservaId: string, tipo: "atualizar" | "cancelar", cliente: ClienteDasReservasBeds24, quartos: QuartosDaVolta, o: OpcoesDoEnvio, r: ResultadoDoEnvioBeds24): Promise<Fechamento | null> {
  for (let vez = 0; vez < 2; vez++) {
    const aberta = await abrirIntencao(db, org, reservaId, { agora: o.relogio.agora(), env: o.env, tipos: [tipo] });
    if (aberta.saida === "parar_volta") {
      r.parada = aberta.motivo;
      return null;
    }
    if (aberta.saida === "cancelar_antes_de_criar" && tipo === "cancelar") {
      const s = await cancelarAntesDeCriarNaVolta(db, org, reservaId, cliente, quartos, o);
      contar(r, tipo, null, s.fechamento);
      if (s.parada) r.parada = s.parada;
      if (s.fechamento === "adotada" && !r.parada && !paradaAntesDaOperacao(o, r)) continue;
      return s.fechamento;
    }
    if (aberta.saida !== "enviar") return null;
    let d: DesfechoDaFase2;
    o.prazoDaOperacao?.(AbortSignal.timeout(PRAZO_DA_FASE_2_MS));
    try {
      d = tipo === "atualizar" ? await enviarAtualizacao(db, org, aberta.operacao, cliente, quartos, o, r) : await enviarCancelamento(db, org, aberta.operacao, cliente, quartos, o, r);
    } finally {
      o.prazoDaOperacao?.(null);
    }
    const f = await fecharOperacao(db, org, aberta.operacao, d, o);
    contar(r, tipo, d, f);
    r.parada = paradaDepoisDaOperacao(d);
    return f;
  }
  return null;
}

/**
 * Os passos 2 e 3 da volta (desenho 9): os cancelamentos e as atualizações do que o M8.3 criou, uma reserva por vez, com os
 * limites conferidos antes de cada operação nova. Devolve se alguma terminou `divergente` (a marca ilegível para as criações).
 */
async function escreverPorId(db: Db, org: string, tipo: "atualizar" | "cancelar", cliente: ClienteDasReservasBeds24, quartos: QuartosDaVolta, o: OpcoesDoEnvio, r: ResultadoDoEnvioBeds24): Promise<boolean> {
  let divergiu = false;
  for (const id of await candidatasPorId(db, org, o.relogio.agora(), tipo)) {
    r.parada = paradaAntesDaOperacao(o, r);
    if (r.parada) break;
    if ((await escreverUma(db, org, id, tipo, cliente, quartos, o, r)) === "divergente") divergiu = true;
    if (r.parada) break;
  }
  return divergiu;
}

/**
 * A volta das reservas do site no Beds24 (desenho 9, depois do passo 1): os cancelamentos, as atualizações e as criações,
 * nesta ordem, com os limites conferidos ANTES de cada operação nova (10 POSTs, 150 s restantes, as janelas da importação e
 * do envio diários) e a parada no primeiro 429, 401 ou 403 e com o crédito abaixo de 20. Só com a escrita de reservas pronta
 * (`escritaReservasBeds24Pronta`, conferida de novo aqui: a chave, o deploy de produção e o refresh token) e sem motivo de
 * configuração que pare tudo (sem credencial, escopo a mais, ou sem leitura válida dos escopos com a credencial de agora);
 * os motivos que só param as criações (escopo faltando ou ilegível, sem ensaio, marca ilegível) deixam seguir o cancelamento
 * e a atualização do que o M8.3 já criou (desenho 2.4). O cliente é obrigatório: lê e grava, um só por volta, e a leitura
 * dos quartos também é uma só.
 */
export async function enviarReservasDoSite(db: Db, org: string, cliente: ClienteDasReservasBeds24, o: OpcoesDoEnvio): Promise<ResultadoDoEnvioBeds24> {
  const r: ResultadoDoEnvioBeds24 = { posts: 0, criadas: 0, atualizadas: 0, canceladas: 0, conferidas: 0, incertas: 0, avisos: 0, falhas: 0, parada: null, configuracao: null };
  if (!escritaReservasBeds24Pronta(o.env)) return { ...r, parada: "chave" };
  r.configuracao = await configuracaoDeAgora(db, org, o);
  if (r.configuracao?.para === "tudo") return r;
  const quartos = quartosDaVolta(cliente);
  for (const tipo of ["cancelar", "atualizar"] as const) {
    const divergiu = await escreverPorId(db, org, tipo, cliente, quartos, o, r);
    if (r.parada) return r;
    // Uma conferência deu divergente: com a marca ilegível (desenho 4.4), as criações param já nesta volta.
    if (divergiu && !r.configuracao) r.configuracao = await configuracaoDeAgora(db, org, o);
  }
  if (!r.configuracao) await criarAsReservas(db, org, cliente, quartos, o, r);
  return r;
}

// ---------------------------------------------------------------- a cancelada antes de ser criada (desenho 6.3)

/** O que a leitura do Beds24 achou para a reserva cancelada antes de ser criada (nada é enviado em nenhum caso). */
type AchadoAntesDeCriar =
  | { achado: "sem_leitura"; status?: number }
  | { achado: "marca"; comMarca: ReservaBeds24[] }
  | { achado: "bloqueio"; bloqueio: BloqueioAchadoBeds24 }
  | { achado: "candidato"; id: string }
  | { achado: "nada" };

/**
 * A reserva cancelada antes de ser criada no Beds24 (desenho 6.3; plano 1.7): a `criar` ficou `superada` na fase 1 (a régua
 * deu `cancelada_sem_beds24`) e falta saber se o Beds24 ficou com alguma coisa — o registro de um POST anterior sem resposta,
 * ou o bloqueio que a equipe fez à mão. Só lê o Beds24 (nunca POST), em três tempos: a leitura do SCL; a do Beds24 sem
 * transação aberta e com o prazo próprio da operação (`PRAZO_DA_FASE_2_MS`: a busca da marca e quem ocupa as noites que ainda
 * não passaram); e a fase 3, que revalida o acompanhamento e a reserva sob a trava (`mesmoAcompanhamento`; ainda cancelada,
 * sem id e sem operação em curso) e grava:
 * - um registro com a marca desta reserva ainda vivo (fora de `cancelled`): a criação aconteceu. Pelas regras de adoção
 *   (`adotarReservaCriada`, a mesma da importação) o id vai para a reserva e o cancelamento segue o fluxo normal (`adotada`);
 *   duplicada ou marca em registro inesperado vão à equipe com os ids (`detalhe.duplicadas`), sem marca e sem POST. Com todos
 *   os registros com a marca em `cancelled`, a criação já foi desfeita: "Conferir agora", depois de a equipe cancelar no
 *   Beds24, conclui;
 * - o bloqueio feito à mão sobre as noites: `manual`/`bloqueio_manual`, com as noites em `detalhe.bloqueio` (a tarefa diz
 *   "Mude o bloqueio de dd/mm a dd/mm para Cancelado (não apague)");
 * - o ocupante exato (só com um POST anterior desta reserva, 1.5): uma reserva confirmada, nunca um bloqueio —
 *   `aguardando_equipe`/`incerta`, com `detalhe.candidato`, e nenhuma marca;
 * - nada disso, com a busca que funcionou (o ensaio válido para a credencial e nenhuma marca ilegível que conte) e o quarto
 *   acessível em BRL: as datas reabertas nas OTAs pelo sistema (`marcarOtaLiberada`, `por` nulo; "já marcada" é sucesso) e o
 *   acompanhamento `encerrada`, com a auditoria;
 * - a leitura que não concluiu: `buscas_sem_conclusao + 1`; na terceira, `aguardando_equipe`/`incerta`.
 * Os detalhes vão para a última `criar` da reserva (sem ela, só o acompanhamento muda). Toda conclusão grava `lido_em`: a
 * volta não relê o que ela já mandou à equipe. O acompanhamento `manual` nunca chega aqui (a régua responde `manual` antes).
 */
export function cancelarAntesDeCriar(db: Db, org: string, reservaId: string, leitor: LeitorBeds24, o: OpcoesDoEnvio): Promise<SaidaDaOperacaoEmCurso> {
  return cancelarAntesDeCriarNaVolta(db, org, reservaId, leitor, quartosDaVolta(leitor), o);
}

/** `cancelarAntesDeCriar` com a leitura dos quartos da volta (uma só por volta). */
async function cancelarAntesDeCriarNaVolta(db: Db, org: string, reservaId: string, leitor: LeitorBeds24, quartos: QuartosDaVolta, o: OpcoesDoEnvio): Promise<SaidaDaOperacaoEmCurso> {
  const descartada: SaidaDaOperacaoEmCurso = { fechamento: "descartada" };
  if (!uuidValido(reservaId)) return descartada;
  const agora = o.relogio.agora();
  // Primeiro tempo, só leitura do SCL.
  const [r] = await db
    .select({ codigo: reservas.codigo, imovelId: reservas.imovelId, estado: reservas.estado, checkin: reservas.checkin, checkout: reservas.checkout, beds24Id: reservas.beds24Id })
    .from(reservas)
    .where(and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, org), eq(reservas.fonte, "site")));
  const [a] = await db.select().from(acomp).where(and(eq(acomp.organizacaoId, org), eq(acomp.reservaId, reservaId)));
  if (!r || !a || r.estado !== "cancelada" || r.beds24Id || a.situacao === "manual" || a.situacao === "encerrada") return descartada;
  const opsDaReserva = (x: Db) => x.select().from(op).where(and(eq(op.organizacaoId, org), eq(op.reservaId, reservaId), eq(op.modo, "real"))).orderBy(desc(op.iniciadoEm), desc(op.chave));
  const ops = await opsDaReserva(db);
  // Com uma operação em curso, a saída dela vem antes; com um id do Beds24 numa operação, a reserva foi criada.
  if (ops.some(operacaoEmCurso) || ops.some((x) => x.beds24Id)) return descartada;
  const vinculo = a.roomId && a.propertyId ? { roomId: a.roomId, propertyId: a.propertyId } : vinculoDoImovel(await listarMapeamentosBeds24(db, org), r.imovelId);
  // Sem quarto não há o que ler: a tarefa da cancelada continua no Início (avisar em vez de supor).
  if (!vinculo) return descartada;
  await o.ganchos?.antesDaFase2?.(null);

  // Segundo tempo, o Beds24 sem transação aberta, com o prazo próprio da operação (como a fase 2): as leituras em série (os
  // quartos, a busca, as reservas e o calendário) não passam dele, só dos 15 s de cada uma.
  o.prazoDaOperacao?.(AbortSignal.timeout(PRAZO_DA_FASE_2_MS));
  const achado = await lerAntesDeCriar(db, org, leitor, quartos, o, { ...r, ops, vinculo }).finally(() => o.prazoDaOperacao?.(null));
  const status = achado.achado === "sem_leitura" ? achado.status : undefined;

  // Terceiro tempo, a fase 3 (a adoção muda o `beds24_id`: a reserva `for update`).
  const fechamento = await naFase3(db, org, o, null, async (tx): Promise<Fechamento> => {
    const t = await travarReservaDoSite(tx, org, reservaId, achado.achado === "marca" ? "update" : "no key update");
    if (!t?.acompanhamento || !mesmoAcompanhamento(t.acompanhamento, a) || t.reserva.estado !== "cancelada" || t.reserva.beds24Id) return "descartada";
    await travarCancelamentoEAlteracoes(tx, org, reservaId, []);
    const agoraOps = await opsDaReserva(tx);
    if (agoraOps.some(operacaoEmCurso) || agoraOps.some((x) => x.beds24Id)) return "descartada";
    const criar = agoraOps.find((x) => x.tipo === "criar") ?? null;
    const situacaoDaCriar: SituacaoOperacaoBeds24 = criar?.situacao ?? "superada";
    const acompanhar = (campos: Partial<typeof acomp.$inferInsert>) => gravarAcompanhamentoNaFase3(tx, t.acompanhamento!, campos, situacaoDaCriar, agora);
    const detalhar = async (mais: DetalheOperacaoBeds24) => {
      if (criar) await tx.update(op).set({ detalhe: detalheOperacaoBeds24({ ...detalheOperacaoBeds24(criar.detalhe), ...mais }) }).where(eq(op.id, criar.id));
    };
    const leitura = { lidoEm: agora, ...FIM_DA_INCERTEZA };
    const naoConcluiu = async () => {
      const s = buscaSemConclusaoBeds24(t.acompanhamento!.buscasSemConclusao);
      await acompanhar({ buscasSemConclusao: s.buscas, ...(s.equipe ? { situacao: "aguardando_equipe", motivo: "incerta", lidoEm: agora } : {}) });
      return s.equipe ? "aguardando_equipe" : "incerta";
    };
    switch (achado.achado) {
      case "sem_leitura":
        return naoConcluiu();
      case "marca": {
        const ad = await adotarReservaCriada(tx, org, reservaId, achado.comMarca);
        if (ad.adotada) {
          // O quarto em que ela está fica no acompanhamento (o sinal de "criada pelo M8.3", desenho 6.2), se ainda faltava.
          await acompanhar({ ...leitura, ...(a.roomId ? {} : { roomId: vinculo.roomId, propertyId: vinculo.propertyId }) });
          return "adotada";
        }
        if (ad.motivo === "sem_acompanhamento") return "descartada";
        if (ad.motivo === "duplicada" || ad.motivo === "marca_em_registro_inesperado" || ad.motivo === "id_de_outra_reserva") {
          await detalhar({ duplicadas: ad.motivo === "duplicada" ? ad.ids : [ad.id] });
          await acompanhar({ ...leitura, situacao: "aguardando_equipe", motivo: ad.motivo === "duplicada" ? "duplicada" : "marca_em_registro_inesperado" });
          return "aguardando_equipe";
        }
        return naoConcluiu();
      }
      case "bloqueio":
        await detalhar({ bloqueio: achado.bloqueio });
        await acompanhar({ ...leitura, situacao: "manual", motivo: "bloqueio_manual" });
        return "manual";
      case "candidato":
        await detalhar({ candidato: achado.id });
        await acompanhar({ ...leitura, situacao: "aguardando_equipe", motivo: "incerta" });
        return "aguardando_equipe";
      case "nada":
        if (!(await marcarCancelamentoNasOtas(tx, org, reservaId, agora)) && criar) await tx.update(op).set({ erro: ERRO_CANCELAMENTO_SEM_MARCA }).where(eq(op.id, criar.id));
        await acompanhar({ ...leitura, situacao: "encerrada", motivo: null, proximaTentativaEm: null });
        await registrarAuditoria(tx, { organizacaoId: org, usuarioId: null, acao: "beds24.reserva.encerrar", entidade: "reserva", entidadeId: reservaId, mudancas: { situacaoNoBeds24: [a.situacao, "encerrada"], motivoNoBeds24: [a.motivo, null] } });
        return "encerrada";
    }
  });
  return { fechamento, ...comParada(status) };
}

/**
 * Segundo tempo de `cancelarAntesDeCriar`, só leitura: o quarto acessível em BRL, a busca da marca (um registro vivo com ela
 * decide antes de tudo), quem ocupa as noites que ainda não passaram (o bloqueio feito à mão; o ocupante exato, com um POST
 * anterior desta reserva) e, para concluir "nada lá", a credencial que lê a marca. Qualquer leitura que não concluiu (com o
 * HTTP da recusa, para a parada da volta) é `sem_leitura`.
 */
async function lerAntesDeCriar(
  db: Db,
  org: string,
  leitor: LeitorBeds24,
  quartos: QuartosDaVolta,
  o: OpcoesDoEnvio,
  r: { codigo: string; imovelId: string; checkin: string; checkout: string; ops: LinhaDaOperacao[]; vinculo: { roomId: string; propertyId: string } },
): Promise<AchadoAntesDeCriar> {
  const quarto = r.vinculo.roomId;
  const q = await quartos();
  if (!q.ok) return { achado: "sem_leitura", status: q.status };
  if (quartoAcessivelEmBrl(q.itens, r.vinculo.propertyId, quarto) !== "ok") return { achado: "sem_leitura" };
  const busca = await procurarReservaDoSite(leitor, { referencia: r.codigo, quarto, chegada: r.checkin });
  if (!busca.funcionou) return { achado: "sem_leitura", status: busca.status };
  if (busca.comMarca.some((b) => b.estado !== "cancelada")) return { achado: "marca", comMarca: busca.comMarca };
  const agora = o.relogio.agora();
  const hoje = hojeISO(FUSO_PADRAO, agora);
  const noites = noitesDe(r.checkin, r.checkout).filter((n) => n >= hoje);
  const ocupantes = await lerOcupantes(leitor, db, org, { imovelId: r.imovelId, alvo: { quarto, chegada: r.checkin, saida: r.checkout }, noites, idProprio: null, comPostAnterior: comPostDeCriacaoSemId(r.ops) });
  if (!ocupantes.funcionou) return { achado: "sem_leitura", status: ocupantes.status };
  if (ocupantes.ocupacao.resultado === "bloqueio_manual") return { achado: "bloqueio", bloqueio: ocupantes.ocupacao.bloqueio };
  if (ocupantes.ocupacao.resultado === "ocupante_exato") return { achado: "candidato", id: ocupantes.ocupacao.id };
  const leMarca = ensaioValeParaCredencial(await lerConfigReservasBeds24(db, org), impressaoCredencialBeds24(o.env)) && !(await existeMarcaIlegivelQueConta(db, org, agora));
  return leMarca ? { achado: "nada" } : { achado: "sem_leitura" };
}

// ---------------------------------------------------------------- o passo 1 da volta: a queda antes do POST e o fim (desenho 3.6 e 9)

/**
 * A queda antes do POST (desenho 3.6): a operação `enviando` vencida (mais de 6 min pelo relógio do banco, o mesmo que grava
 * `iniciado_em`) sem `enviado_em` volta a `pendente`, sem busca e sem contar falha a mais (nada saiu), e o acompanhamento sai
 * de `em_envio` (a marca dele vem de `agora`, como nas outras gravações do acompanhamento). Nunca a que teve POST, nem o
 * ensaio: eles têm a saída própria. Só com a trava `beds24:<org>` livre; ocupada, fica para a volta seguinte. `operacaoId`
 * restringe a uma operação (a saída de uma só, `resolverOperacaoEmCurso`). Devolve quantas voltaram.
 */
export async function devolverVencidasSemPost(db: Db, org: string, agora: Date, o: { operacaoId?: string } = {}): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '15s'`);
    if (!(await tentarTravaBeds24(tx, org))) return 0;
    const voltaram = await tx
      .update(op)
      .set({ situacao: "pendente" })
      .where(and(eq(op.organizacaoId, org), o.operacaoId ? eq(op.id, o.operacaoId) : undefined, eq(op.modo, "real"), inArray(op.tipo, [...ACOES] as AcaoBeds24[]), eq(op.situacao, "enviando"), isNull(op.enviadoEm), vencidaNoBanco))
      .returning({ acompanhamentoId: op.acompanhamentoId });
    const ids = voltaram.map((x) => x.acompanhamentoId).filter((x): x is string => x !== null);
    if (ids.length) await tx.update(acomp).set({ situacao: "pendente", atualizadoEm: agora }).where(and(eq(acomp.organizacaoId, org), inArray(acomp.id, ids), eq(acomp.situacao, "em_envio")));
    return voltaram.length;
  });
}

/**
 * O fim do acompanhamento (desenho 9): toda linha fora de `manual` e `encerrada`, sem operação ativa nem `feita`, de reserva
 * com a saída antes de hoje (São Paulo) vira `encerrada`, num passo só de banco, com a situação e o motivo de antes na
 * auditoria (`beds24.reserva.encerrar`, autor nulo: a rotina). Vale para qualquer situação, não só a `conferida`: um
 * `divergente`/`marca_ilegivel` antigo pararia as criações para sempre (desenho 4.4). Só com a trava `beds24:<org>` livre.
 * Devolve quantas encerrou.
 */
export async function encerrarTerminadas(db: Db, org: string, agora: Date): Promise<number> {
  const hoje = hojeISO(FUSO_PADRAO, agora);
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '15s'`);
    if (!(await tentarTravaBeds24(tx, org))) return 0;
    // Sem operação ativa nem `feita` (a criação adotada que o passo 1 ainda termina): a mesma lista do índice `uma_ativa`.
    const semOperacaoEmCurso = notExists(tx.select({ id: op.id }).from(op).where(and(eq(op.organizacaoId, org), eq(op.reservaId, acomp.reservaId), inArray(op.situacao, [...SITUACOES_OPERACAO_ATIVAS, "feita"]))));
    const terminadas = await tx
      .select({ id: acomp.id, reservaId: acomp.reservaId, situacao: acomp.situacao, motivo: acomp.motivo })
      .from(acomp)
      .innerJoin(reservas, and(eq(reservas.id, acomp.reservaId), eq(reservas.organizacaoId, org)))
      .where(and(eq(acomp.organizacaoId, org), notInArray(acomp.situacao, ["manual", "encerrada"]), sql`${reservas.checkout} < ${hoje}`, semOperacaoEmCurso))
      .for("update", { of: acomp });
    if (!terminadas.length) return 0;
    await tx.update(acomp).set({ situacao: "encerrada", motivo: null, atualizadoEm: agora }).where(inArray(acomp.id, terminadas.map((x) => x.id)));
    for (const x of terminadas) {
      await registrarAuditoria(tx, { organizacaoId: org, usuarioId: null, acao: "beds24.reserva.encerrar", entidade: "reserva", entidadeId: x.reservaId, mudancas: { situacaoNoBeds24: [x.situacao, "encerrada"], motivoNoBeds24: [x.motivo, null] } });
    }
    return terminadas.length;
  });
}

// ---------------------------------------------------------------- o passo 1 da volta: a saída da operação em curso (desenho 3.6 e 3.8)

/** A saída de uma operação em curso só começa com tempo para as leituras (até cinco, de 15 s cada) e a fase 3. */
export const MINIMO_PARA_RESOLVER_MS = 90_000;

/** O que a saída deixou: o fechamento (para os números) e a parada que uma recusa do Beds24 na leitura pede (429, 401, 403). */
export type SaidaDaOperacaoEmCurso = { fechamento: Fechamento; parada?: ParadaPelaRecusa };

const comParada = (status: number | undefined): { parada?: ParadaPelaRecusa } => {
  const parada = paradaPelaRecusa(status);
  return parada ? { parada } : {};
};

/**
 * A operação em curso como o primeiro tempo a leu, sem trava: a fase 3 revalida a operação (a situação, o `enviado_em` e o
 * id) e o acompanhamento (`mesmoAcompanhamento`).
 */
type EmCurso = { linha: LinhaDaOperacao; operacao: OperacaoEmEnvio; acompanhamento: Acompanhamento; reservaBeds24Id: string | null };

const mesmoInstante = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
/**
 * A conclusão só vale para a operação como ela foi lida (desenho 3.6): a mesma situação, o mesmo `enviado_em` e o mesmo id.
 * A Vercel pode entregar o mesmo disparo duas vezes, e o botão roda junto com a rotina: sem isso, a mesma conclusão seria
 * aplicada duas vezes (a fase 3 duas vezes, ou o 23505 na versão nova).
 */
const mesmaOperacao = (agora: LinhaDaOperacao, lida: LinhaDaOperacao) => agora.situacao === lida.situacao && mesmoInstante(agora.enviadoEm, lida.enviadoEm) && agora.beds24Id === lida.beds24Id;

/**
 * E para o acompanhamento como ele foi lido: a mesma situação, o mesmo motivo, a mesma versão, o mesmo contador de buscas e a
 * mesma marca de tempo. As conclusões que só mudam o acompanhamento numa operação que continua `incerta` (a leitura sem
 * conclusão, o candidato, a equipe) passariam pela revalidação da operação: duas saídas ao mesmo tempo somariam duas buscas
 * numa leitura só, e a reserva iria à equipe antes da terceira. Mudou no meio: a conclusão é descartada (a volta seguinte lê
 * de novo).
 */
const mesmoAcompanhamento = (agora: Acompanhamento, lido: Acompanhamento) =>
  agora.situacao === lido.situacao && agora.motivo === lido.motivo && agora.versao === lido.versao && agora.buscasSemConclusao === lido.buscasSemConclusao && mesmoInstante(agora.atualizadoEm, lido.atualizadoEm);

/**
 * Primeiro tempo, só leitura do SCL: a operação real de reserva em curso — a `incerta`, a `feita` ou a `enviando` vencida que
 * teve POST (a sem POST volta a `pendente` antes, `devolverVencidasSemPost`) —, a reserva do site e o acompanhamento. Nunca
 * o ensaio, que tem a saída própria ("Conferir o ensaio"): a busca genérica o descarta e concluiria "não achou".
 */
async function lerEmCurso(db: Db, org: string, operacaoId: string): Promise<EmCurso | null> {
  if (!uuidValido(operacaoId)) return null;
  const [linha] = await db.select().from(op).where(and(eq(op.id, operacaoId), eq(op.organizacaoId, org), eq(op.modo, "real"), inArray(op.tipo, [...ACOES] as AcaoBeds24[]), inArray(op.situacao, ["incerta", "feita", "enviando"])));
  if (!linha?.reservaId || !linha.pedido || !ehAcao(linha.tipo)) return null;
  if (linha.situacao === "enviando") {
    const [vencida] = await db.select({ id: op.id }).from(op).where(and(eq(op.id, linha.id), vencidaNoBanco));
    if (!vencida || !linha.enviadoEm) return null;
  }
  const [r] = await db.select({ codigo: reservas.codigo, imovelId: reservas.imovelId, beds24Id: reservas.beds24Id }).from(reservas).where(and(eq(reservas.id, linha.reservaId), eq(reservas.organizacaoId, org), eq(reservas.fonte, "site")));
  const [a] = await db.select().from(acomp).where(and(eq(acomp.organizacaoId, org), eq(acomp.reservaId, linha.reservaId)));
  if (!r || !a) return null;
  const ops = await db.select().from(op).where(and(eq(op.organizacaoId, org), eq(op.reservaId, linha.reservaId), eq(op.modo, "real")));
  const conhecidos = [r.beds24Id, ...ops.map((x) => x.beds24Id)].filter((x): x is string => Boolean(x));
  return {
    linha, acompanhamento: a, reservaBeds24Id: r.beds24Id,
    operacao: {
      id: linha.id, reservaId: linha.reservaId, acompanhamentoId: a.id, tipo: linha.tipo, versao: a.versao, codigo: r.codigo, imovelId: r.imovelId,
      propertyId: a.propertyId ?? "", quarto: a.roomId ?? linha.pedido.quarto, pedido: linha.pedido, alteracoes: linha.alteracoes, beds24Id: linha.beds24Id,
      idsConhecidos: [...new Set(conhecidos)], comPostAnterior: comPostDeCriacaoSemId(ops), credencialGuardada: a.credencial,
    },
  };
}

/** As operações anteriores da reserva, no que a regra da nova tentativa olha (lidas sob a trava, na fase 3). */
async function operacoesAnteriores(tx: Db, org: string, reservaId: string): Promise<OperacaoAnteriorBeds24[]> {
  const ops = await tx.select({ tipo: op.tipo, situacao: op.situacao, enviadoEm: op.enviadoEm, resposta: op.resposta, pedido: op.pedido, detalhe: op.detalhe }).from(op).where(and(eq(op.organizacaoId, org), eq(op.reservaId, reservaId), eq(op.modo, "real")));
  return ops.map((x) => ({ ...x, detalhe: detalheOperacaoBeds24(x.detalhe) }));
}

type Travada = { reserva: typeof reservas.$inferSelect; acompanhamento: Acompanhamento };
type NaFase3DaSaida = { tx: Db; t: Travada; linha: LinhaDaOperacao; a: Acompanhamento; g: Gravacoes; agora: Date };

/**
 * Terceiro tempo da saída, a fase 3 (`naFase3`: a trava `beds24:<org>` que espera, e as repetições no 55P03 e no 40P01): o
 * imóvel e a reserva (`update` só quando o `beds24_id` muda), o cancelamento e as alterações, e a operação relida — só
 * conclui a que continua, com o acompanhamento, como o primeiro tempo a leu (`mesmaOperacao` e `mesmoAcompanhamento`);
 * senão, outra conclusão já foi aplicada, e esta é descartada.
 */
function naFase3DaSaida(db: Db, org: string, o: OpcoesDoEnvio, e: EmCurso, nivel: "update" | "no key update", f: (c: NaFase3DaSaida) => Promise<Fechamento>): Promise<Fechamento> {
  const agora = o.relogio.agora();
  return naFase3(db, org, o, e.operacao, async (tx) => {
    const travada = await travarReservaDoSite(tx, org, e.operacao.reservaId, nivel);
    if (!travada?.acompanhamento) return "descartada";
    await travarCancelamentoEAlteracoes(tx, org, e.operacao.reservaId, e.operacao.alteracoes);
    const [linha] = await tx.select().from(op).where(and(eq(op.id, e.operacao.id), eq(op.organizacaoId, org))).for("update");
    if (!linha || !mesmaOperacao(linha, e.linha) || !mesmoAcompanhamento(travada.acompanhamento, e.acompanhamento)) return "descartada";
    const a = travada.acompanhamento;
    return f({ tx, t: { reserva: travada.reserva, acompanhamento: a }, linha, a, g: gravacoes(tx, e.operacao, linha, a, agora), agora });
  });
}

/**
 * A situação em que a operação continua em curso (e a do caso do e-mail): a `feita` fica `feita`; a `enviando` vencida que
 * teve POST passa a `incerta` (ela já não está sendo enviada) — ou a `feita`, na criação com o id do Beds24, cujo fato a fase
 * 3 da saída já gravou (`gravarACriacao`): falta só a conferência.
 */
const situacaoQueFica = (linha: LinhaDaOperacao): "feita" | "incerta" => (linha.situacao === "feita" || (linha.tipo === "criar" && linha.beds24Id !== null) ? "feita" : "incerta");

/** A operação continua em curso, na situação de `situacaoQueFica`. */
async function continuaEmCurso(g: Gravacoes, linha: LinhaDaOperacao) {
  const fica = situacaoQueFica(linha);
  if (linha.situacao !== fica) await g.operacao({ situacao: fica });
}

/** A leitura não concluiu (`buscaSemConclusaoBeds24`): `buscas_sem_conclusao + 1`; na terceira, `aguardando_equipe`/`incerta`. */
async function semConclusao(g: Gravacoes, linha: LinhaDaOperacao, s: { buscas: number; equipe: boolean }): Promise<Fechamento> {
  await continuaEmCurso(g, linha);
  await g.acompanhamento({ buscasSemConclusao: s.buscas, ...(s.equipe ? { situacao: "aguardando_equipe", motivo: "incerta" } : {}) }, situacaoQueFica(linha));
  return s.equipe ? "aguardando_equipe" : situacaoQueFica(linha);
}

/** A equipe decide (desenho 3.8): a operação continua em curso, sem nova tentativa; "Conferir agora" lê de novo. */
async function aEquipe(g: Gravacoes, linha: LinhaDaOperacao, motivo: "incerta" | "sem_permissao"): Promise<Fechamento> {
  await continuaEmCurso(g, linha);
  await g.acompanhamento({ situacao: "aguardando_equipe", motivo }, situacaoQueFica(linha));
  return "aguardando_equipe";
}

/** Não achou depois de uma recusa do Beds24 (desenho 3.8, item 3): `recusada`, nunca repete sozinha; o e-mail à equipe. */
async function recusadaPeloBeds24(g: Gravacoes, motivo: "sem_disponibilidade" | "recusada_pelo_beds24"): Promise<Fechamento> {
  await g.operacao({ situacao: "recusada", ...terminada });
  await g.acompanhamento({ situacao: "aguardando_equipe", motivo, ...FIM_DA_INCERTEZA }, "recusada");
  return "recusada";
}

/**
 * A única nova tentativa automática por intenção (desenho 3.8, item 3): a operação fica `falhou` (com a resposta e o
 * `enviado_em`, a prova do POST) e a mesma intenção nasce na versão seguinte, com o atraso da tabela de falhas. A incerteza
 * não conta como falha (desenho 9): o atraso é o da próxima, sem somar a tentativa.
 */
async function novaTentativa(tx: Db, org: string, c: NaFase3DaSaida, e: EmCurso): Promise<Fechamento> {
  const proximaTentativaEm = new Date(c.agora.getTime() + atrasoDaFalha(c.a.tentativas + 1).minutos * 60_000);
  await novaVersao(tx, org, c.g, e.operacao, c.linha, c.a, { tentativas: c.a.tentativas, proximaTentativaEm });
  return "nova_versao";
}

/**
 * A saída da incerteza da CRIAÇÃO (desenho 3.8; plano 1.4): nada conclui antes de 5 min desde `enviado_em` (o Beds24 ainda
 * pode gravar depois do nosso tempo-limite), e nada é lido. Depois, sem transação aberta, a busca da marca e quem ocupa as
 * noites, sempre juntas e antes de qualquer decisão (a busca só "funcionou" com a credencial que lê a marca: o ensaio válido
 * para ela e nenhuma marca ilegível que conte). A decisão é de `saidaDaIncertezaDaCriacao`, sob a trava, com o contador de
 * buscas e as operações anteriores relidos ali: a adoção (com `adotarReservaCriada`, a mesma da importação, e a conferência
 * depois), a marca que não bate, o ocupante exato (`detalhe.candidato`, nunca em `beds24_id`), a recusa, a nova tentativa,
 * a equipe ou a leitura sem conclusão.
 */
async function sairDaIncertezaDaCriacao(db: Db, org: string, e: EmCurso, leitor: LeitorBeds24, o: OpcoesDoEnvio): Promise<SaidaDaOperacaoEmCurso> {
  const { linha, operacao } = e;
  const { pedido, quarto } = operacao;
  const agora = o.relogio.agora();
  if (!linha.enviadoEm || !podeConcluirIncertezaBeds24(linha.enviadoEm, agora)) return { fechamento: "aguardar" };
  const noites = noitesDe(pedido.chegada, pedido.saida);
  const busca: BuscaDaReservaDoSite = await procurarReservaDoSite(leitor, { referencia: operacao.codigo, quarto, chegada: pedido.chegada, idsConhecidos: operacao.idsConhecidos });
  const ocupantes: LeituraDosOcupantes | null = busca.funcionou
    ? await lerOcupantes(leitor, db, org, { imovelId: operacao.imovelId, alvo: { quarto, chegada: pedido.chegada, saida: pedido.saida }, noites, idProprio: null, comPostAnterior: operacao.comPostAnterior })
    : null;
  const credencialLeMarca = ensaioValeParaCredencial(await lerConfigReservasBeds24(db, org), impressaoCredencialBeds24(o.env)) && !(await existeMarcaIlegivelQueConta(db, org, agora));
  const leitura: LeituraDaIncerteza =
    busca.funcionou && ocupantes?.funcionou
      ? { funcionou: true, adocao: regraDeAdocao(busca.comMarca, { quarto, chegada: pedido.chegada, saida: pedido.saida }), ocupanteExato: ocupantes.ocupacao.resultado === "ocupante_exato" ? ocupantes.ocupacao.id : null, credencialLeMarca }
      : { funcionou: false };
  const status = !busca.funcionou ? busca.status : ocupantes && !ocupantes.funcionou ? ocupantes.status : undefined;
  const overbooking = ocupantes?.funcionou ? noitesComOverbooking(ocupantes.dias, quarto, noites) : [];
  const adota = leitura.funcionou && leitura.adocao.adotar;
  const fechamento = await naFase3DaSaida(db, org, o, e, adota ? "update" : "no key update", async (c) => {
    const { tx, t, linha: l, a, g } = c;
    const s = saidaDaIncertezaDaCriacao({
      resposta: l.resposta, enviadoEm: l.enviadoEm!, agora: c.agora, leitura,
      jaHouveNovaTentativa: jaHouveNovaTentativa(await operacoesAnteriores(tx, org, operacao.reservaId), "criar", assinaturaEsperado(pedido)), buscasSemConclusao: a.buscasSemConclusao,
    });
    switch (s.saida) {
      case "aguardar":
        return "aguardar";
      case "adotar": {
        const ad = await adotarReservaCriada(tx, org, operacao.reservaId, busca.funcionou ? busca.comMarca : []);
        if (ad.adotada) return conferirAConfirmada(tx, org, g, operacao, t.reserva, a, s.registro, overbooking, c.agora);
        if (ad.motivo === "duplicada") return marcaQueNaoBate(g, "duplicada", ad.ids);
        if (ad.motivo === "marca_em_registro_inesperado" || ad.motivo === "id_de_outra_reserva") return marcaQueNaoBate(g, "marca_em_registro_inesperado", [ad.id]);
        return ad.motivo === "sem_acompanhamento" ? "descartada" : semConclusao(g, l, buscaSemConclusaoBeds24(a.buscasSemConclusao));
      }
      case "divergente":
        return marcaQueNaoBate(g, s.motivo, s.ids);
      case "candidato":
        await g.operacao({ ...(l.situacao === "enviando" ? { situacao: "incerta" as const } : {}), detalhe: g.detalhe({ candidato: s.id }) });
        await g.acompanhamento({ situacao: "aguardando_equipe", motivo: "incerta" }, "incerta");
        return "aguardando_equipe";
      case "recusada":
        return recusadaPeloBeds24(g, s.motivo);
      case "nova_tentativa":
        return novaTentativa(tx, org, c, e);
      case "equipe":
        return aEquipe(g, l, "incerta");
      case "sem_conclusao":
        return semConclusao(g, l, s);
    }
  });
  return { fechamento, ...comParada(status) };
}

/** A releitura por id da saída, como a decisão a lê (`ReleituraDaIncerteza`), mais o registro lido e o HTTP da recusa. */
type ReleituraPorId = { registro: ReservaBeds24 | null; releitura: ReleituraDaIncerteza; status?: number };

/**
 * A releitura por id da saída (desenho 4.4), só leitura, uma regra para a criação com o id, o `atualizar` e o `cancelar`: um
 * registro em formato inválido, sem dono ou repetido não conclui; o id que não voltou numa leitura limpa só conclui
 * "apagada" com a credencial guardada no acompanhamento igual à de agora e o quarto acessível em BRL (lido na hora, como a
 * importação faz antes do laço) — a troca de token para outra conta, ou o acesso tirado ao imóvel, faz todos os ids sumirem,
 * e "apagada" limparia as marcas das OTAs de reservas que existem.
 */
async function releituraPorId(leitor: LeitorBeds24, e: EmCurso, id: string, o: OpcoesDoEnvio): Promise<ReleituraPorId> {
  const lido = await relerPorIdDaOperacao(leitor, id);
  if (!lido.funcionou) return { registro: null, releitura: { funcionou: false }, status: lido.status };
  if (lido.registro) return { registro: lido.registro, releitura: { funcionou: true, registro: lidoDoRegistro(lido.registro), podeConcluirApagada: false } };
  const q = await quartosDaVolta(leitor)();
  if (!q.ok) return { registro: null, releitura: { funcionou: false }, status: q.status };
  return { registro: null, releitura: { funcionou: true, registro: null, podeConcluirApagada: podeConcluirApagada(q.itens, e.operacao, o.env) } };
}

/**
 * A criação com o id do Beds24 que ainda não terminou (desenho 3.6, "vencida"): a `enviando` vencida com o id (a queda
 * depois da resposta, antes da fase 3) e a `feita` (a resposta sem a releitura, ou a adoção pela importação). Relê pelo id,
 * sem depender da marca (`releituraPorId`), e, com o registro, o calendário das noites (o overbooking: sem ele, a conferência
 * não conclui nesta leitura; o registro que não voltou não precisa dele). Na fase 3, primeiro o fato que faltou — o id na
 * reserva, com a auditoria da criação (`gravarACriacao`) — e então a decisão de `saidaDaFeitaPorId`: a conferência depois
 * (desenho 4.4, a mesma de depois do POST); o registro apagado no Beds24, `divergente`/`apagada_no_beds24` (terminal, com o
 * e-mail: sem isso, a criação ficaria `feita` para sempre e barraria a fila da reserva); a credencial trocada ou o quarto sem
 * acesso, a equipe (`sem_permissao`, sem mexer nas marcas; "Conferir agora" lê de novo); ou a leitura sem conclusão.
 */
async function sairDaCriacaoComId(db: Db, org: string, e: EmCurso, leitor: LeitorBeds24, o: OpcoesDoEnvio): Promise<SaidaDaOperacaoEmCurso> {
  const { linha, operacao } = e;
  const id = linha.beds24Id!;
  const lida = await releituraPorId(leitor, e, id, o);
  let { releitura, status } = lida;
  let overbooking: string[] = [];
  if (lida.registro) {
    const c = await lerOverbooking(leitor, operacao.quarto, noitesDe(operacao.pedido.chegada, operacao.pedido.saida));
    if (c.funcionou) overbooking = c.noites;
    else {
      releitura = { funcionou: false };
      status = c.status;
    }
  }
  const fechamento = await naFase3DaSaida(db, org, o, e, e.reservaBeds24Id !== id ? "update" : "no key update", async (c) => {
    const { tx, t, linha: l, a, g } = c;
    if (l.situacao === "enviando" || t.reserva.beds24Id !== id) {
      const naoBate = await gravarACriacao(tx, org, g, operacao, t.reserva, id);
      if (naoBate) return naoBate;
    }
    const s = saidaDaFeitaPorId(releitura, operacao.pedido, a.buscasSemConclusao);
    if (s.saida === "sem_conclusao") return semConclusao(g, l, s);
    if (s.saida === "equipe") return aEquipe(g, l, s.motivo);
    // Voltou: a conferência depois decide (as datas, a situação e a marca), a mesma de depois do POST. Não voltou, com a
    // credencial e o quarto que permitem concluir: apagada no Beds24.
    if (lida.registro) return conferirAConfirmada(tx, org, g, operacao, t.reserva, a, lida.registro, overbooking, c.agora);
    return divergenteNoBeds24(g, operacao, null, "apagada_no_beds24", c.agora);
  });
  return { fechamento, ...comParada(status) };
}

/**
 * O que a conferência depois do `atualizar` e do `cancelar` lê além do registro (desenho 4.4): na atualização, o overbooking
 * nas noites novas; no cancelamento, a conferência antes de marcar as datas reabertas (`AntesDeLiberar`: os registros nossos
 * com a marca ainda vivos, os outros registros vivos com a marca e o bloqueio feito à mão que sobrou sobre as noites).
 */
type LeituraDepoisPorId = { funcionou: false; status?: number } | ({ funcionou: true; overbooking: string[] } & AntesDeLiberar);

/**
 * O overbooking nas noites novas da atualização (desenho 4.4: "depois de cada escrita"; na alteração, o Beds24 não confere a
 * disponibilidade), contadas a partir do registro relido na fase 2 desta operação (`antes`), nunca do `esperado`.
 */
async function lerDepoisDaAtualizacao(leitor: LeitorBeds24, operacao: OperacaoEmEnvio, antes: LinhaDaOperacao["antes"]): Promise<LeituraDepoisPorId> {
  const c = await lerOverbooking(leitor, operacao.quarto, noitesNovas(antes, operacao.pedido));
  return c.funcionou ? { funcionou: true, overbooking: c.noites, ...NADA_A_LIBERAR } : c;
}

/**
 * Antes de marcar as datas reabertas e de encerrar (desenho 4.3 e 4.4): a releitura de todos os ids (o principal e os de
 * `detalhe.duplicadas`) e uma busca nova pela marca no quarto não podem mostrar um registro nosso desta reserva vivo
 * (`registroNossoBeds24`: a marca do info item e a origem do SCL; `confirmed` ou `new`; no quarto guardado) — esses ids vão
 * para `detalhe.duplicadas`, a lista que se cancela no Beds24, e uma reserva de OTA com o código no info item nunca entra
 * nela (cancelá-la liberaria o estoque sem cancelar na OTA: venda dupla) —, nem outro registro vivo com a marca desta
 * reserva (`estranhosComAMarca`: o aviso, nunca a lista que se cancela); e a leitura das noites que ainda não passaram não
 * pode mostrar `black` nem blackout de fora (`bloqueio_manual` de `lerOcupantes`; o blackout do próprio SCL e uma reserva
 * nova nas noites não impedem).
 */
async function lerAntesDeLiberar(leitor: LeitorBeds24, db: Db, org: string, operacao: OperacaoEmEnvio, duplicadas: readonly string[], agora: Date): Promise<LeituraDepoisPorId> {
  const { pedido, quarto } = operacao;
  const busca = await procurarReservaDoSite(leitor, { referencia: operacao.codigo, quarto, chegada: pedido.chegada, idsConhecidos: [...(operacao.beds24Id ? [operacao.beds24Id] : []), ...duplicadas] });
  if (!busca.funcionou) return { funcionou: false, status: busca.status };
  const sobrou = await bloqueioQueSobrou(leitor, db, org, operacao, agora);
  if (!sobrou.funcionou) return { funcionou: false, status: sobrou.status };
  const vivos = vivosComAMarca(busca.comMarca, quarto);
  return { funcionou: true, overbooking: [], vivos, estranhos: estranhosComAMarca(busca.comMarca, operacao.beds24Id, vivos), bloqueio: sobrou.bloqueio };
}

/**
 * O bloqueio feito à mão que sobrou sobre as noites do cancelamento que ainda não passaram (desenho 4.4, antes de gravar
 * `ota_liberada_em`): `black` ou blackout de fora (`bloqueio_manual` de `lerOcupantes`); o blackout do próprio SCL e uma
 * reserva nova nas noites não impedem. Só leitura.
 */
async function bloqueioQueSobrou(leitor: LeitorBeds24, db: Db, org: string, operacao: Pick<OperacaoEmEnvio, "pedido" | "quarto" | "imovelId" | "beds24Id">, agora: Date): Promise<{ funcionou: true; bloqueio: BloqueioAchadoBeds24 | null } | { funcionou: false; erro: string; status?: number }> {
  const { pedido, quarto } = operacao;
  const hoje = hojeISO(FUSO_PADRAO, agora);
  const noites = noitesDe(pedido.chegada, pedido.saida).filter((n) => n >= hoje);
  const ocupantes = await lerOcupantes(leitor, db, org, { imovelId: operacao.imovelId, alvo: { quarto, chegada: pedido.chegada, saida: pedido.saida }, noites, idProprio: operacao.beds24Id, comPostAnterior: false });
  if (!ocupantes.funcionou) return ocupantes;
  return { funcionou: true, bloqueio: ocupantes.ocupacao.resultado === "bloqueio_manual" ? ocupantes.ocupacao.bloqueio : null };
}

/**
 * Diferente no Beds24 (desenho 4.2 e 4.3): a operação fica `divergente` (terminal), e o acompanhamento `divergente` com o
 * motivo (o e-mail da divergência). Na criação e na atualização (a reserva confirmada), as datas, a situação ou o quarto
 * mudados por fora, ou o registro apagado, reabrem a pendência das datas nas OTAs, como na importação; só as pessoas, não.
 */
async function divergenteNoBeds24(g: Gravacoes, operacao: OperacaoEmEnvio, lido: LidoBeds24 | null, motivo: DiferencaNoBeds24["motivo"], agora: Date): Promise<Fechamento> {
  const soPessoas = diferencaNoBeds24(operacao.pedido, lido)?.soPessoas ?? false;
  await g.operacao({ situacao: "divergente", ...(lido ? { depois: lido } : {}), ...terminada });
  await g.acompanhamento({ lido, lidoEm: agora, situacao: "divergente", motivo, ...FIM_DA_INCERTEZA, ...(operacao.tipo !== "cancelar" && !soPessoas ? { otaFechadaEm: null, otaFechadaPor: null } : {}) }, "divergente");
  return "divergente";
}

export const ERRO_CANCELAMENTO_SEM_MARCA = "O cancelamento conferido não pôde ser marcado como reaberto nas OTAs: confira na ficha.";

const cancelamentoJaMarcado = async (tx: Db, org: string, reservaId: string) =>
  Boolean((await tx.select({ em: cancelamentosReserva.otaLiberadaEm }).from(cancelamentosReserva).where(and(eq(cancelamentosReserva.organizacaoId, org), eq(cancelamentosReserva.reservaId, reservaId), eq(cancelamentosReserva.situacao, "cancelada"))))[0]?.em);

/**
 * "Datas reabertas nas OTAs" do cancelamento conferido (desenho 6.3), com `por` nulo: o sistema. Como nas alterações, "já
 * marcada" conta como sucesso, e a decisão sai do estado da linha, nunca do texto de `marcarOtaLiberada`. false = ficou sem
 * a marca, um erro de verdade (fica no `erro` da operação).
 */
export async function marcarCancelamentoNasOtas(tx: Db, org: string, reservaId: string, agora: Date): Promise<boolean> {
  if (await cancelamentoJaMarcado(tx, org, reservaId)) return true;
  const r = await marcarOtaLiberada(tx, org, reservaId, null, agora);
  return r.ok || (await cancelamentoJaMarcado(tx, org, reservaId));
}

/**
 * A conferência depois do cancelamento (desenho 4.3, 4.4 e 6.3), com o registro relido `cancelled` como o pedido: sem a marca
 * desta reserva, `divergente` (a marca ilegível também para as criações). Com um registro com a marca desta reserva ainda
 * vivo, nada é marcado: a operação fica `feita` (falta a conferência final; "Conferir agora" a repete) e o acompanhamento
 * `aguardando_equipe`, com os ids em `detalhe.duplicadas` — `duplicada` com os nossos vivos (a lista que a equipe cancela no
 * Beds24), ou `marca_em_registro_inesperado` com os outros (`estranhosComAMarca`, desenho 4.3: "qualquer outra coisa vira
 * aviso"; o sistema nunca os cancela). Senão a operação termina `conferida` e, com a assinatura do SCL igual à do pedido: o
 * bloqueio feito à mão que sobrou leva a `manual`/`bloqueio_manual`, com as noites em `detalhe.bloqueio`, sem marca; sem ele,
 * as datas reabertas nas OTAs pelo sistema e o acompanhamento `encerrada`. A auditoria do cancelamento é do fato aceito pelo
 * Beds24 (`auditarEscritaAceita`), não daqui.
 */
async function conferirOCancelamento(c: NaFase3DaSaida, org: string, operacao: OperacaoEmEnvio, registro: ReservaBeds24, depois: Extract<LeituraDepoisPorId, { funcionou: true }>): Promise<Fechamento> {
  const { tx, t, g, agora } = c;
  const lido = lidoDoRegistro(registro);
  const leitura = { lido, lidoEm: agora, ...FIM_DA_INCERTEZA };
  const marca = diferencaNaMarca(registro, operacao.codigo);
  if (marca) {
    await g.operacao({ situacao: "divergente", depois: lido, ...terminada });
    await g.acompanhamento({ ...leitura, situacao: "divergente", motivo: marca }, "divergente");
    return "divergente";
  }
  // Os nossos vivos vêm antes: a equipe os cancela no Beds24, e a conferência seguinte mostra os outros, se houver. As duas
  // listas nunca se misturam (a de `duplicada` é a que se cancela; uma reserva de OTA cancelada lá seria venda dupla).
  const vivosComAMarcaDela = depois.vivos.length ? depois.vivos : depois.estranhos;
  if (vivosComAMarcaDela.length) {
    await g.operacao({ situacao: "feita", depois: lido, detalhe: g.detalhe({ duplicadas: vivosComAMarcaDela }) });
    await g.acompanhamento({ ...leitura, situacao: "aguardando_equipe", motivo: depois.vivos.length ? "duplicada" : "marca_em_registro_inesperado" }, "feita");
    return "aguardando_equipe";
  }
  await g.operacao({ situacao: "conferida", depois: lido, ...(depois.bloqueio ? { detalhe: g.detalhe({ bloqueio: depois.bloqueio }) } : {}), ...terminada });
  const fim = { ...leitura, conferidaEm: agora, tentativas: 0 };
  if (assinaturaAtualDoScl(t.reserva, operacao.quarto) !== assinaturaEsperado(operacao.pedido)) {
    await g.acompanhamento({ ...fim, situacao: "pendente", motivo: null, proximaTentativaEm: agora }, "conferida");
    return "pendente";
  }
  if (depois.bloqueio) {
    await g.acompanhamento({ ...fim, situacao: "manual", motivo: "bloqueio_manual", proximaTentativaEm: null }, "conferida");
    return "manual";
  }
  if (!(await marcarCancelamentoNasOtas(tx, org, operacao.reservaId, agora))) await g.operacao({ erro: ERRO_CANCELAMENTO_SEM_MARCA });
  await g.acompanhamento({ ...fim, situacao: "encerrada", motivo: null, proximaTentativaEm: null }, "conferida");
  return "encerrada";
}

/**
 * A conferência depois da atualização e do cancelamento aceitos (desenho 4.4), com o registro relido pelo id, uma regra para
 * a fase 3 de depois do POST e para a saída da operação em curso:
 * - cancelamento: diferente do pedido (não ficou `cancelled`, ou mudou de quarto ou de datas por fora), `divergente`; igual,
 *   a conferência dele (`conferirOCancelamento`: os registros vivos com a marca, o bloqueio que sobrou, as datas reabertas);
 * - atualização: a mesma conferência da criação (`conferirAConfirmada`: as datas atualizadas nas OTAs das alterações lidas
 *   na fase 1 e o overbooking nas noites novas).
 * A auditoria do fato (`auditarEscritaAceita`) vem antes, de quem sabe que a escrita valeu: a conferência pode não concluir.
 */
async function conferirDepoisPorId(c: NaFase3DaSaida, org: string, operacao: OperacaoEmEnvio, registro: ReservaBeds24, depois: Extract<LeituraDepoisPorId, { funcionou: true }>): Promise<Fechamento> {
  if (operacao.tipo === "cancelar") {
    const lido = lidoDoRegistro(registro);
    const dif = diferencaNoBeds24(operacao.pedido, lido);
    return dif ? divergenteNoBeds24(c.g, operacao, lido, dif.motivo, c.agora) : conferirOCancelamento(c, org, operacao, registro, depois);
  }
  return conferirAConfirmada(c.tx, org, c.g, operacao, c.t.reserva, c.a, registro, depois.overbooking, c.agora);
}

/**
 * A saída do `atualizar` e do `cancelar` (a `incerta`, a `enviando` vencida que teve POST e a `feita`; plano 1.4): eles têm
 * o `beds24_id` desde a fase 1 e nunca usam a busca nem a adoção (só valem na criação). Só a releitura por id, sem transação
 * aberta (`releituraPorId`: o id que não voltou só conclui "apagada" com a credencial e o quarto que permitem concluir);
 * igual ao pedido, a leitura do depois (o overbooking das noites novas; antes de liberar o cancelamento, os registros vivos
 * com a marca e o bloqueio que sobrou). A decisão é de `saidaDaIncertezaPorId` (ou de `saidaDaFeitaPorId`), sob a trava: a
 * conferência (a auditoria do fato aceito, na primeira vez, e as marcas), a nova tentativa, a recusa, a equipe, a divergência
 * ou a leitura sem conclusão.
 */
async function sairPorId(db: Db, org: string, e: EmCurso, leitor: LeitorBeds24, o: OpcoesDoEnvio): Promise<SaidaDaOperacaoEmCurso> {
  const { linha, operacao } = e;
  const id = linha.beds24Id;
  // A atualização e o cancelamento nascem com o id (fase 1): sem ele, não há o que reler (avisar em vez de supor).
  if (!id) return { fechamento: "descartada" };
  const agora = o.relogio.agora();
  const lida = await releituraPorId(leitor, e, id, o);
  const { releitura } = lida;
  let status = lida.status;
  const igualAoPedido = releitura.funcionou && releitura.registro !== null && !diferencaNoBeds24(operacao.pedido, releitura.registro);
  const duplicadas = detalheOperacaoBeds24(linha.detalhe).duplicadas ?? [];
  const depois = igualAoPedido ? (operacao.tipo === "atualizar" ? await lerDepoisDaAtualizacao(leitor, operacao, linha.antes) : await lerAntesDeLiberar(leitor, db, org, operacao, duplicadas, agora)) : null;
  if (depois && !depois.funcionou) status ??= depois.status;
  const fechamento = await naFase3DaSaida(db, org, o, e, "no key update", async (c) => {
    const { tx, linha: l, a, g } = c;
    const s =
      l.situacao === "feita"
        ? saidaDaFeitaPorId(releitura, operacao.pedido, a.buscasSemConclusao)
        : saidaDaIncertezaPorId({
            pedido: operacao.pedido, antes: l.antes, resposta: l.resposta, enviadoEm: l.enviadoEm!, agora: c.agora, releitura,
            jaHouveNovaTentativa: jaHouveNovaTentativa(await operacoesAnteriores(tx, org, operacao.reservaId), operacao.tipo, assinaturaEsperado(operacao.pedido)), buscasSemConclusao: a.buscasSemConclusao,
          });
    switch (s.saida) {
      case "aguardar":
        await continuaEmCurso(g, l);
        return "aguardar";
      case "conferir": {
        // O registro relido igual ao pedido: o Beds24 aceitou a escrita. Na `incerta` e na `enviando` vencida, o fato vai para
        // a auditoria agora, uma vez só (a `feita` já o gravou, na fase 3 de depois do POST ou numa saída anterior), e a
        // operação passa a `feita`: falta só a conferência. A leitura do depois não concluiu: nada é marcado nesta volta.
        const feita = l.situacao === "feita" ? l : { ...l, situacao: "feita" as const };
        if (l.situacao !== "feita") {
          await auditarEscritaAceita(tx, org, operacao, l);
          await g.operacao({ situacao: "feita" });
        }
        if (!depois?.funcionou || !lida.registro) return semConclusao(g, feita, buscaSemConclusaoBeds24(a.buscasSemConclusao));
        return conferirDepoisPorId(c, org, operacao, lida.registro, depois);
      }
      case "nova_tentativa":
        return novaTentativa(tx, org, c, e);
      case "recusada":
        return recusadaPeloBeds24(g, s.motivo);
      case "equipe":
        return aEquipe(g, l, s.motivo);
      case "divergente":
        return divergenteNoBeds24(g, operacao, releitura.funcionou ? releitura.registro : null, s.motivo, c.agora);
      case "sem_conclusao":
        return semConclusao(g, l, s);
    }
  });
  return { fechamento, ...comParada(status) };
}

/**
 * A saída de UMA operação em curso (desenho 3.6 e 3.8; plano 1.4 e 1.15): a mesma função no passo 1 da rotina e em "Conferir
 * agora". Só lê o Beds24 (pelo leitor injetado, obrigatório) e nunca faz POST nem toca o ensaio. Em três tempos: a operação e
 * a reserva lidas do SCL; o Beds24 lido sem transação aberta, com o prazo da operação; e a fase 3, que revalida a operação
 * sob a trava. A `enviando` vencida sem POST volta a `pendente`, sem leitura. A criação sem o id do Beds24 segue a saída da
 * incerteza; a criação com o id, a releitura e a fase 3 que faltou; a atualização e o cancelamento, a releitura por id.
 */
export async function resolverOperacaoEmCurso(db: Db, org: string, operacaoId: string, leitor: LeitorBeds24, o: OpcoesDoEnvio): Promise<SaidaDaOperacaoEmCurso> {
  if (!uuidValido(operacaoId)) return { fechamento: "descartada" };
  if (await devolverVencidasSemPost(db, org, o.relogio.agora(), { operacaoId })) return { fechamento: "pendente" };
  const e = await lerEmCurso(db, org, operacaoId);
  if (!e) return { fechamento: "descartada" };
  await o.ganchos?.antesDaFase2?.(e.operacao);
  o.prazoDaOperacao?.(AbortSignal.timeout(PRAZO_DA_FASE_2_MS));
  try {
    if (e.operacao.tipo !== "criar") return await sairPorId(db, org, e, leitor, o);
    return e.linha.beds24Id ? await sairDaCriacaoComId(db, org, e, leitor, o) : await sairDaIncertezaDaCriacao(db, org, e, leitor, o);
  } finally {
    o.prazoDaOperacao?.(null);
  }
}

/** Os números da saída das operações em curso (o resumo da rotina, só números e códigos). */
export type ResultadoDaSaidaBeds24 = {
  /** As `enviando` vencidas sem POST que voltaram a `pendente`. */
  voltaram: number;
  /** As que tiveram uma conclusão nesta volta (fora as de antes dos 5 min e as descartadas). */
  resolvidas: number;
  /** Conferidas (inclusive o cancelamento encerrado). */
  conferidas: number;
  /** Continuam em curso, sem conclusão (a leitura não concluiu, ou a criação `feita` sem a releitura). */
  incertas: number;
  /** Divergência, conflito, recusa, a equipe ou o bloqueio que sobrou: pedem atenção. */
  avisos: number;
  /** A única nova tentativa automática da intenção (a versão seguinte, `pendente`). */
  novasVersoes: number;
  parada: MotivoDaParadaBeds24 | null;
};

function contarSaida(r: ResultadoDaSaidaBeds24, f: Fechamento) {
  if (f === "aguardar" || f === "descartada") return;
  r.resolvidas++;
  if (f === "conferida" || f === "encerrada") r.conferidas++;
  else if (f === "incerta" || f === "feita") r.incertas++;
  else if (f === "nova_versao") r.novasVersoes++;
  else if (f === "divergente" || f === "conflito" || f === "aguardando_equipe" || f === "recusada" || f === "manual") r.avisos++;
}

/**
 * As operações reais de reserva em curso a resolver nesta volta: `incerta`, `feita` e `enviando` vencida que teve POST, nunca
 * o ensaio, em ordem de início. Fica de fora a reserva já à espera da equipe (`aguardando_equipe`): a equipe decide, e "Conferir
 * agora" relê na hora (relê-la a cada volta só gastaria créditos, sem nova tentativa).
 */
function operacoesASair(db: Db, org: string) {
  return db
    .select({ id: op.id })
    .from(op)
    .innerJoin(acomp, and(eq(acomp.organizacaoId, org), eq(acomp.reservaId, op.reservaId)))
    .where(and(eq(op.organizacaoId, org), eq(op.modo, "real"), inArray(op.tipo, [...ACOES] as AcaoBeds24[]), or(inArray(op.situacao, ["incerta", "feita"]), and(eq(op.situacao, "enviando"), isNotNull(op.enviadoEm), vencidaNoBanco)), ne(acomp.situacao, "aguardando_equipe")))
    .orderBy(asc(op.iniciadoEm), asc(op.id));
}

/**
 * Há o que o passo 1 resolve (`resolverOperacoesEmCurso`)? Com a chave desligada ou a pausa (o passo 0 da rotina, desenho 2.4
 * e 9), a rotina só entra para isso, e sem nada a resolver sai sem trava, sem leitura do Beds24 e sem linha nova. As mesmas
 * condições do passo 1: a `enviando` vencida sem POST (`devolverVencidasSemPost`), a vencida com POST e sem o id (ou o
 * ensaio vencido com POST, com ou sem o id; `passarEnviandoVencidasAIncerta`) e as que a saída lê (`operacoesASair`). Só
 * leitura do SCL, sem trava.
 */
export async function haOperacaoEmCursoASair(db: Db, org: string): Promise<boolean> {
  const [vencida] = await db
    .select({ id: op.id })
    .from(op)
    .where(and(eq(op.organizacaoId, org), eq(op.situacao, "enviando"), vencidaNoBanco, or(and(eq(op.modo, "real"), inArray(op.tipo, [...ACOES] as AcaoBeds24[]), isNull(op.enviadoEm)), and(isNotNull(op.enviadoEm), or(isNull(op.beds24Id), eq(op.tipo, "ensaio"))))))
    .limit(1);
  return Boolean(vencida) || (await operacoesASair(db, org).limit(1)).length > 0;
}

/**
 * O passo 1 da volta (desenho 9), depois da leitura dos escopos: a queda antes do POST volta a `pendente`; com a trava livre,
 * a criação vencida que teve POST sem o id passa a `incerta` (`passarEnviandoVencidasAIncerta`, a mesma da importação); e
 * cada operação em curso tem a saída dela (`resolverOperacaoEmCurso`), com o tempo e as janelas conferidos antes de cada uma
 * e a parada no primeiro 429, 401 ou 403. Só lê o Beds24: vale também com a chave desligada ou a pausa (o passo 0 da rotina).
 * O fim do acompanhamento (`encerrarTerminadas`) e o e-mail à equipe vêm depois, pela rotina.
 */
export async function resolverOperacoesEmCurso(db: Db, org: string, leitor: LeitorBeds24, o: OpcoesDoEnvio): Promise<ResultadoDaSaidaBeds24> {
  const r: ResultadoDaSaidaBeds24 = { voltaram: 0, resolvidas: 0, conferidas: 0, incertas: 0, avisos: 0, novasVersoes: 0, parada: null };
  r.voltaram = await devolverVencidasSemPost(db, org, o.relogio.agora());
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '15s'`);
    if (await tentarTravaBeds24(tx, org)) await passarEnviandoVencidasAIncerta(tx, org);
  });
  for (const { id } of await operacoesASair(db, org)) {
    if (o.relogio.restanteMs() < MINIMO_PARA_RESOLVER_MS) r.parada = "tempo";
    else if (dentroDeJanela(o.relogio.agora())) r.parada = "janela";
    if (r.parada) break;
    const s = await resolverOperacaoEmCurso(db, org, id, leitor, o);
    contarSaida(r, s.fechamento);
    if (s.parada) {
      r.parada = s.parada;
      break;
    }
  }
  return r;
}
