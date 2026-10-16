/**
 * Reserva paga do site no Beds24 (M8.3, desenho em `requisitos/product/RESERVA-SITE-BEDS24.md`): o que lê o Beds24 e o
 * que a importação faz com a reserva do site. Nada aqui escreve no Beds24 (a escrita é o M8.3c, atrás de
 * `escritaReservasBeds24Pronta`).
 * - `procurarReservaDoSite` (3.5): a busca pela marca do SCL, só leitura.
 * - `adotarReservaCriada` (3.5): a adoção de um registro com a marca, pelas regras de adoção; a mesma função na importação
 *   e no trabalhador do M8.3c.
 * - `conferirNaImportacao` (5.2 b): a importação confere a reserva do site contra o `esperado` e nunca a muda.
 * - `prepararDesvioNaImportacao` e `desvioNaImportacao` (5.2 a–e): o desvio no laço da importação, antes da conferência de
 *   vínculo e do ramo de bloqueio.
 * O SCL é o dono da reserva: origem, valores, taxa, valor líquido, hóspede, e-mail, situação, `confirmadaEm`,
 * `reservadaEm` e o motor nunca mudam por causa do Beds24. Os avisos levam só o código SCL e o id do registro.
 */
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { beds24ReservasOperacoes, beds24ReservasSite, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { assinaturaAtualDoScl, type DecisaoAdocao, diferencaNoBeds24, type DiferencaNoBeds24, type EsperadoBeds24, lidoDoRegistro, regraDeAdocao, SITUACOES_OPERACAO_ATIVAS } from "./reservas-site-regras";
import { ErroBeds24, type FiltroReservas, type LeitorBeds24, type ReservaBeds24 } from "./tipos";
import { JANELA_RESERVA_EM_ANDAMENTO_MINUTOS } from "./trava";

/** Id do Beds24 só com os caracteres esperados, para entrar num aviso (o resto vira "não identificado"). */
const idSeguro = (s: string) => (/^[A-Za-z0-9._:-]{1,64}$/.test(s) ? s : "não identificado");

// ---------------------------------------------------------------- busca pela marca (desenho 3.5)

export type AlvoDaBusca = {
  /** `reservas.codigo` (SCL-XXXXXX), a marca. */
  referencia: string;
  /** O quarto guardado (na criação, o do vínculo). */
  quarto: string;
  /** A chegada do `esperado`. */
  chegada: string;
  /** Ids do Beds24 já ligados a ela (a reserva ou uma operação): relidos por id, sem depender da marca. */
  idsConhecidos?: readonly string[];
  /** A marca também vai no nome (só se o suporte confirmar que gravar o nome não exige escrita pessoal): busca por texto. */
  marcaNoNome?: boolean;
};

/**
 * `funcionou` = todas as leituras responderam e nenhuma trouxe registro em formato inválido (um registro ilegível pode ser
 * o nosso: a busca não conclui). `comMarca` = os registros com a marca desta reserva, em todas as situações; o ensaio
 * nunca entra.
 */
export type BuscaDaReservaDoSite = { funcionou: true; comMarca: ReservaBeds24[]; lidoEm: string } | { funcionou: false; erro: string };

/**
 * Procura no Beds24 a reserva que o SCL criou (só leitura): (1) as reservas do quarto com a chegada explícita (sem ela, o
 * Beds24 só devolve as futuras: o hóspede já na casa sumiria), todas as situações, com os info items; (2) com a marca no
 * nome, a busca por texto desde 1900; (3) os ids já conhecidos, relidos por id. A saída é filtrada aqui, pela marca.
 */
export async function procurarReservaDoSite(leitor: LeitorBeds24, alvo: AlvoDaBusca): Promise<BuscaDaReservaDoSite> {
  const leituras: FiltroReservas[] = [{ quarto: alvo.quarto, chegadaExata: alvo.chegada, incluirInfo: true }];
  if (alvo.marcaNoNome) leituras.push({ pesquisa: alvo.referencia, chegadaDe: "1900-01-01", incluirInfo: true });
  const ids = [...new Set(alvo.idsConhecidos ?? [])].filter((i) => idSeguro(i) === i);
  if (ids.length) leituras.push({ ids, chegadaDe: "1900-01-01", incluirInfo: true });
  const porId = new Map<string, ReservaBeds24>();
  let lidoEm = "";
  try {
    for (const f of leituras) {
      const l = await leitor.reservas(f);
      if (l.divergencias.length) return { funcionou: false, erro: "A leitura do Beds24 trouxe registro em formato inválido: a busca não conclui." };
      for (const b of l.itens) if (!porId.has(b.idExterno)) porId.set(b.idExterno, b);
      lidoEm = l.lidoEm;
    }
  } catch (e) {
    return { funcionou: false, erro: e instanceof ErroBeds24 ? e.message : "Não foi possível ler o Beds24." };
  }
  return { funcionou: true, comMarca: [...porId.values()].filter((b) => !b.ensaio && b.referenciaScl === alvo.referencia), lidoEm };
}

// ---------------------------------------------------------------- travas (ordem única: beds24:<org> → imóvel → reserva)

/**
 * A reserva do site e o acompanhamento dela, travados na ordem única (desenho 3.6): quem chama já tem `beds24:<org>`; aqui
 * o imóvel (`no key update`), a reserva (`nivel`: `update` quando o `beds24_id`, chave única, vai mudar) e o acompanhamento.
 */
async function travarReservaDoSite(tx: Db, org: string, reservaId: string, nivel: "update" | "no key update") {
  const ondeReserva = and(eq(reservas.id, reservaId), eq(reservas.organizacaoId, org), eq(reservas.fonte, "site"));
  const [previa] = await tx.select({ imovelId: reservas.imovelId }).from(reservas).where(ondeReserva);
  if (!previa) return null;
  await tx.select({ id: imoveis.id }).from(imoveis).where(and(eq(imoveis.id, previa.imovelId), eq(imoveis.organizacaoId, org))).for("no key update");
  const [reserva] = await tx.select().from(reservas).where(ondeReserva).for(nivel);
  if (!reserva) return null;
  const [acompanhamento] = await tx.select().from(beds24ReservasSite).where(and(eq(beds24ReservasSite.organizacaoId, org), eq(beds24ReservasSite.reservaId, reservaId))).for("update");
  return { reserva, acompanhamento: acompanhamento ?? null };
}

/** O quarto e as datas que a criação esperava encontrar (o quarto guardado; sem ele, o do esperado). */
const esperadoDaAdocao = (a: { roomId: string | null; esperado: EsperadoBeds24 | null }) => (a.esperado ? { quarto: a.roomId ?? a.esperado.quarto, chegada: a.esperado.chegada, saida: a.esperado.saida } : null);

// ---------------------------------------------------------------- adoção (desenho 3.5)

export type ResultadoAdocao =
  | { adotada: true; beds24Id: string }
  | { adotada: false; motivo: "nenhum" }
  | { adotada: false; motivo: "duplicada"; ids: string[] }
  | { adotada: false; motivo: "marca_em_registro_inesperado"; id: string }
  /** A reserva não é do site, não tem acompanhamento, ou ele está `manual` ou `encerrada`: o SCL não criou nada para adotar. */
  | { adotada: false; motivo: "sem_acompanhamento" }
  /** O id já é de outra reserva do SCL (`reservas.beds24_id` é único por organização). */
  | { adotada: false; motivo: "id_de_outra_reserva"; id: string };

const semAdocao = (d: Exclude<DecisaoAdocao, { adotar: true }>): ResultadoAdocao =>
  d.motivo === "duplicada" ? { adotada: false, motivo: "duplicada", ids: d.ids } : d.motivo === "marca_em_registro_inesperado" ? { adotada: false, motivo: d.motivo, id: d.id } : { adotada: false, motivo: "nenhum" };

/**
 * Adota o registro do Beds24 que a criação deixou sem resposta (resposta perdida, `success: false` que gravou mesmo assim,
 * busca da incerteza), pelas regras de adoção: grava o fato externo — `reservas.beds24_id` e, na operação de criação em
 * curso, o mesmo id com a situação `feita` (a conferência segue sem POST) — e a auditoria. Um id já ligado a ela que não é
 * o do registro (na reserva ou numa operação) faz dos dois uma duplicata. Não mexe na situação do acompanhamento nem nas
 * marcas das OTAs: isso é da conferência. Quem chama tem a trava `beds24:<org>`. A mesma função na importação e no
 * trabalhador (M8.3c).
 */
export async function adotarReservaCriada(tx: Db, org: string, reservaId: string, comMarca: readonly ReservaBeds24[], o: { autorId?: string | null } = {}): Promise<ResultadoAdocao> {
  const t = await travarReservaDoSite(tx, org, reservaId, "update");
  if (!t?.acompanhamento || t.acompanhamento.situacao === "manual" || t.acompanhamento.situacao === "encerrada") return { adotada: false, motivo: "sem_acompanhamento" };
  const { reserva: r, acompanhamento: a } = t;
  const d = regraDeAdocao(comMarca.filter((b) => !b.ensaio && b.referenciaScl === r.codigo), esperadoDaAdocao(a));
  if (!d.adotar) return semAdocao(d);
  const id = d.registro.idExterno;
  const comId = await tx.select({ beds24Id: beds24ReservasOperacoes.beds24Id }).from(beds24ReservasOperacoes).where(and(eq(beds24ReservasOperacoes.organizacaoId, org), eq(beds24ReservasOperacoes.reservaId, r.id), isNotNull(beds24ReservasOperacoes.beds24Id)));
  const ligados = new Set([r.beds24Id, ...comId.map((x) => x.beds24Id)].filter((x): x is string => Boolean(x)));
  if ([...ligados].some((x) => x !== id)) return { adotada: false, motivo: "duplicada", ids: [...new Set([...ligados, id])].sort() };
  if (r.beds24Id !== id) {
    const [outra] = await tx.select({ id: reservas.id }).from(reservas).where(and(eq(reservas.organizacaoId, org), eq(reservas.beds24Id, id), ne(reservas.id, r.id))).limit(1);
    if (outra) return { adotada: false, motivo: "id_de_outra_reserva", id };
    await tx.update(reservas).set({ beds24Id: id }).where(eq(reservas.id, r.id));
    await registrarAuditoria(tx, { organizacaoId: org, usuarioId: o.autorId ?? null, acao: "beds24.reserva.adotar", entidade: "reserva", entidadeId: r.id, mudancas: { beds24Id: [r.beds24Id, id] } });
  }
  await tx
    .update(beds24ReservasOperacoes)
    .set({ beds24Id: id, situacao: "feita" })
    .where(and(eq(beds24ReservasOperacoes.organizacaoId, org), eq(beds24ReservasOperacoes.reservaId, r.id), eq(beds24ReservasOperacoes.tipo, "criar"), inArray(beds24ReservasOperacoes.situacao, [...SITUACOES_OPERACAO_ATIVAS])));
  return { adotada: true, beds24Id: id };
}

// ---------------------------------------------------------------- conferência na importação (desenho 5.2 b)

export type ConferenciaNaImportacao =
  /** A reserva do site não tem acompanhamento: nada a comparar (e nada importado). */
  | { resultado: "sem_acompanhamento" }
  /** A leitura é mais velha que a guardada: nada gravado. */
  | { resultado: "antiga" }
  /** Igual ao esperado. `conferida`: gravou `conferida_em` (sem operação ativa e com o SCL ainda igual ao esperado). */
  | { resultado: "igual"; conferida: boolean }
  /** Diferente, mas o acompanhamento ainda espera um envio (ou a equipe): só a leitura foi gravada. */
  | { resultado: "lido" }
  | { resultado: "divergente"; motivo: DiferencaNoBeds24["motivo"] };

/**
 * A importação confere a reserva do site com o registro ligado a ela (`registro` null = o id não voltou na leitura: apagado)
 * e nunca a muda: origem, valores, taxa, valor líquido, hóspede, e-mail, situação, `confirmadaEm`, `reservadaEm` e o motor
 * ficam intactos, mesmo com o vínculo do imóvel trocado. Grava `lido` e `lido_em` (só uma leitura mais nova sobrescreve).
 * - Igual ao `esperado`: `conferida_em` só sem operação ativa e com a assinatura do SCL de agora igual à do esperado.
 * - Diferente: `divergente` com o motivo (mudada, cancelada ou apagada no Beds24) quando o Beds24 deveria estar igual — o
 *   acompanhamento `conferida` (ou já `divergente`) e sem operação ativa; com as datas, a situação ou o quarto mudados, a
 *   marca "datas fechadas" (`ota_fechada_em`) volta a vazio. Com um envio a fazer ou em curso, a diferença é esperada: só a
 *   leitura fica.
 * A situação `conferida` e as marcas das OTAs são do trabalhador (M8.3c). Quem chama tem a trava `beds24:<org>`.
 */
export async function conferirNaImportacao(tx: Db, org: string, reservaId: string, registro: ReservaBeds24 | null, agora: Date): Promise<ConferenciaNaImportacao> {
  const t = await travarReservaDoSite(tx, org, reservaId, "no key update");
  if (!t?.acompanhamento) return { resultado: "sem_acompanhamento" };
  const { reserva: r, acompanhamento: a } = t;
  if (a.lidoEm && a.lidoEm.getTime() > agora.getTime()) return { resultado: "antiga" };
  const lido = registro ? lidoDoRegistro(registro) : null;
  const leitura = { lido, lidoEm: agora, atualizadoEm: agora };
  const gravar = (campos: Partial<typeof beds24ReservasSite.$inferInsert>) => tx.update(beds24ReservasSite).set({ ...leitura, ...campos }).where(eq(beds24ReservasSite.id, a.id));
  if (!a.esperado) {
    await gravar({});
    return { resultado: "lido" };
  }
  const [ativa] = await tx
    .select({ id: beds24ReservasOperacoes.id })
    .from(beds24ReservasOperacoes)
    .where(and(eq(beds24ReservasOperacoes.organizacaoId, org), eq(beds24ReservasOperacoes.reservaId, r.id), inArray(beds24ReservasOperacoes.situacao, [...SITUACOES_OPERACAO_ATIVAS])))
    .limit(1);
  const dif = diferencaNoBeds24(a.esperado, lido);
  if (!dif) {
    const conferida = !ativa && a.assinaturaEsperada !== null && assinaturaAtualDoScl(r, a.roomId ?? a.esperado.quarto) === a.assinaturaEsperada;
    await gravar(conferida ? { conferidaEm: agora } : {});
    return { resultado: "igual", conferida };
  }
  if (ativa || (a.situacao !== "conferida" && a.situacao !== "divergente")) {
    await gravar({});
    return { resultado: "lido" };
  }
  await gravar({ situacao: "divergente", motivo: dif.motivo, ...(dif.soPessoas ? {} : { otaFechadaEm: null, otaFechadaPor: null }) });
  return { resultado: "divergente", motivo: dif.motivo };
}

/** O aviso da conferência no resultado da importação (só o código SCL e o id do registro); null = nada a avisar. */
export function avisoDaConferencia(c: ConferenciaNaImportacao, codigo: string, beds24Id: string): string | null {
  const id = idSeguro(beds24Id);
  if (c.resultado === "sem_acompanhamento") return `Reserva ${codigo} (paga pelo site) ligada ao registro ${id} do Beds24 sem acompanhamento do envio: nada foi importado; confira.`;
  if (c.resultado !== "divergente") return null;
  if (c.motivo === "cancelada_no_beds24") return `Reserva ${codigo} (paga pelo site) foi cancelada no Beds24 (registro ${id}), mas continua confirmada no SCL: as datas podem estar abertas nas OTAs. O SCL não seguiu a mudança.`;
  if (c.motivo === "apagada_no_beds24") return `Reserva ${codigo} (paga pelo site): o registro ${id} não voltou na leitura do Beds24 (apagado?). Confira se as datas estão abertas nas OTAs; o SCL não mudou nada.`;
  return `Reserva ${codigo} (paga pelo site) está diferente no Beds24 (registro ${id}): o SCL não seguiu a mudança; confira a reserva.`;
}

// ---------------------------------------------------------------- desvio no laço da importação (desenho 5.2)

/**
 * Operação `enviando` vencida (mais de 6 min), com o POST tentado (`enviado_em`) e sem o id do Beds24: vira `incerta`
 * (desenho 3.6), para a busca da incerteza resolver antes de qualquer coisa. Quem chama já tem a trava `beds24:<org>`.
 */
export async function passarEnviandoVencidasAIncerta(tx: Db, org: string): Promise<number> {
  const r = await tx
    .update(beds24ReservasOperacoes)
    .set({ situacao: "incerta" })
    .where(and(eq(beds24ReservasOperacoes.organizacaoId, org), eq(beds24ReservasOperacoes.situacao, "enviando"), isNotNull(beds24ReservasOperacoes.enviadoEm), isNull(beds24ReservasOperacoes.beds24Id), sql`${beds24ReservasOperacoes.iniciadoEm} <= now() - make_interval(mins => ${JANELA_RESERVA_EM_ANDAMENTO_MINUTOS})`))
    .returning({ id: beds24ReservasOperacoes.id });
  return r.length;
}

type ReservaLigada = { id: string; codigo: string; beds24Id: string | null };
type CriacaoNaoResolvida = { referencia: string; quarto: string; chegada: string; saida: string };

/** O que o desvio precisa saber da importação, lido uma vez antes do laço. */
export type ContextoDoDesvio = {
  agora: Date;
  /** Registros lidos com a marca do SCL (sem o ensaio), por código: a adoção conta as duplicatas no lote inteiro. */
  marcados: Map<string, ReservaBeds24[]>;
  /** Id do Beds24 → a reserva do site ligada a ele: `reservas.beds24_id`, ou o id gravado numa operação dela (antes da fase 3). */
  ligadas: Map<string, ReservaLigada>;
  /** Ids do Beds24 gravados numa operação de ensaio (o registro do ensaio, mesmo sem a marca legível). */
  ensaios: Set<string>;
  /** Código → a reserva do site com esse código (só os códigos que apareceram no lote). */
  porCodigo: Map<string, ReservaLigada>;
  /** Criações não resolvidas (5.2 e): o quarto e as noites de cada uma. */
  naoResolvidas: CriacaoNaoResolvida[];
  /** Ids que o SCL já conhece (reservas e bloqueios importados): a atualização deles não cria nada e segue. */
  conhecidos: ReadonlySet<string>;
  /** Códigos já avisados como duplicados (um aviso por código). */
  duplicadasAvisadas: Set<string>;
};

/**
 * Lê, uma vez por importação, o que o desvio consulta: as reservas do site ligadas a um id do Beds24, os ensaios, as
 * reservas dos códigos marcados no lote e as criações não resolvidas — uma operação `criar` em `enviando` (de qualquer
 * idade), uma operação `incerta`, um POST tentado sem o id, ou o acompanhamento `aguardando_equipe` com motivo `incerta`,
 * de reserva ainda sem `beds24_id`.
 */
export async function prepararDesvioNaImportacao(tx: Db, org: string, registros: Iterable<ReservaBeds24>, conhecidos: ReadonlySet<string>, agora: Date): Promise<ContextoDoDesvio> {
  const marcados = new Map<string, ReservaBeds24[]>();
  for (const b of registros) if (b.referenciaScl && !b.ensaio) marcados.set(b.referenciaScl, [...(marcados.get(b.referenciaScl) ?? []), b]);
  const ligadas = new Map<string, ReservaLigada>();
  const doSite = await tx.select({ id: reservas.id, codigo: reservas.codigo, beds24Id: reservas.beds24Id }).from(reservas).where(and(eq(reservas.organizacaoId, org), eq(reservas.fonte, "site"), isNotNull(reservas.beds24Id)));
  for (const r of doSite) ligadas.set(r.beds24Id!, r);
  const ensaios = new Set<string>();
  const comId = await tx
    .select({ beds24Id: beds24ReservasOperacoes.beds24Id, tipo: beds24ReservasOperacoes.tipo, reservaId: reservas.id, codigo: reservas.codigo, reservaBeds24Id: reservas.beds24Id, fonte: reservas.fonte })
    .from(beds24ReservasOperacoes)
    .leftJoin(reservas, eq(reservas.id, beds24ReservasOperacoes.reservaId))
    .where(and(eq(beds24ReservasOperacoes.organizacaoId, org), isNotNull(beds24ReservasOperacoes.beds24Id)));
  for (const o of comId) {
    if (o.tipo === "ensaio") ensaios.add(o.beds24Id!);
    else if (o.reservaId && o.codigo && o.fonte === "site" && !ligadas.has(o.beds24Id!)) ligadas.set(o.beds24Id!, { id: o.reservaId, codigo: o.codigo, beds24Id: o.reservaBeds24Id });
  }
  const porCodigo = new Map<string, ReservaLigada>();
  if (marcados.size) {
    const comCodigo = await tx.select({ id: reservas.id, codigo: reservas.codigo, beds24Id: reservas.beds24Id }).from(reservas).where(and(eq(reservas.organizacaoId, org), eq(reservas.fonte, "site"), inArray(reservas.codigo, [...marcados.keys()])));
    for (const r of comCodigo) porCodigo.set(r.codigo, r);
  }
  const naoResolvidas: CriacaoNaoResolvida[] = [];
  const somar = (referencia: string, quarto: string | null | undefined, datas: ({ chegada: string; saida: string } | null | undefined)[]) => {
    if (!quarto) return;
    for (const d of datas) if (d) naoResolvidas.push({ referencia, quarto, chegada: d.chegada, saida: d.saida });
  };
  const op = beds24ReservasOperacoes;
  const ops = await tx
    .select({ pedido: op.pedido, referencia: reservas.codigo, roomId: beds24ReservasSite.roomId, esperado: beds24ReservasSite.esperado })
    .from(op)
    .innerJoin(reservas, eq(reservas.id, op.reservaId))
    .leftJoin(beds24ReservasSite, eq(beds24ReservasSite.reservaId, op.reservaId))
    .where(and(eq(op.organizacaoId, org), eq(reservas.fonte, "site"), isNull(reservas.beds24Id), or(and(eq(op.tipo, "criar"), eq(op.situacao, "enviando")), eq(op.situacao, "incerta"), and(inArray(op.situacao, [...SITUACOES_OPERACAO_ATIVAS]), isNotNull(op.enviadoEm), isNull(op.beds24Id)))));
  for (const o of ops) somar(o.referencia, o.pedido?.quarto ?? o.roomId ?? o.esperado?.quarto, [o.pedido, o.esperado]);
  const incertas = await tx
    .select({ referencia: reservas.codigo, roomId: beds24ReservasSite.roomId, esperado: beds24ReservasSite.esperado, checkin: reservas.checkin, checkout: reservas.checkout })
    .from(beds24ReservasSite)
    .innerJoin(reservas, eq(reservas.id, beds24ReservasSite.reservaId))
    .where(and(eq(beds24ReservasSite.organizacaoId, org), eq(reservas.fonte, "site"), isNull(reservas.beds24Id), eq(beds24ReservasSite.situacao, "aguardando_equipe"), eq(beds24ReservasSite.motivo, "incerta")));
  for (const a of incertas) somar(a.referencia, a.roomId ?? a.esperado?.quarto, [a.esperado, { chegada: a.checkin, saida: a.checkout }]);
  return { agora, marcados, ligadas, ensaios, porCodigo, naoResolvidas, conhecidos, duplicadasAvisadas: new Set() };
}

/** `desviado`: o registro não segue para o vínculo, o bloqueio nem `sincronizarReserva`; `aviso` vai ao resultado da importação. */
export type DesvioNaImportacao = { desviado: false } | { desviado: true; aviso: string | null };

const desviado = (aviso: string | null): DesvioNaImportacao => ({ desviado: true, aviso });
const segue: DesvioNaImportacao = { desviado: false };

/**
 * O desvio da importação (desenho 5.2), nesta ordem, antes da conferência de vínculo e do ramo de bloqueio:
 * - a. o ensaio do SCL (pela marca `SCL-ENSAIO` ou pelo id gravado no ensaio) pula, com aviso; nunca cria;
 * - b. o registro ligado a uma reserva do site (`reservas.beds24_id` ou o id numa operação dela) vai a
 *   `conferirNaImportacao`, nunca a `sincronizarReserva` — inclusive um `black` (a reserva paga nunca é cancelada por ele);
 * - c. a marca casada pelas regras de adoção chama `adotarReservaCriada` e depois confere;
 * - d. a marca sem reserva correspondente, duplicada ou num registro que não bate vira aviso; nada é criado;
 * - e. sem marca legível, no mesmo quarto e com noites sobrepostas a uma criação não resolvida: pula, com aviso.
 * O SCL nunca cria um `black`: um bloqueio com o código no nome (a equipe fechando as datas à mão) segue o caminho dos
 * bloqueios em c, d e e. Em e, o registro que o SCL já conhece (reserva ou bloqueio importado) também segue: a atualização
 * dele não cria nada.
 */
export async function desvioNaImportacao(tx: Db, org: string, b: ReservaBeds24, ctx: ContextoDoDesvio): Promise<DesvioNaImportacao> {
  const id = idSeguro(b.idExterno);
  if (b.ensaio || ctx.ensaios.has(b.idExterno)) return desviado(`Registro ${id}: ensaio do SCL; não importado.`);

  const ligada = ctx.ligadas.get(b.idExterno);
  if (ligada) {
    if (ligada.beds24Id && ligada.beds24Id !== b.idExterno) return desviado(avisoDuplicada(ctx, ligada.codigo, id));
    return desviado(avisoDaConferencia(await conferirNaImportacao(tx, org, ligada.id, b, ctx.agora), ligada.codigo, b.idExterno));
  }

  const ref = b.referenciaScl;
  if (ref && b.estado !== "bloqueio") {
    const r = ctx.porCodigo.get(ref);
    if (!r) return desviado(`Registro ${id}: marcado pelo SCL (${ref}) sem reserva correspondente. Nada foi importado.`);
    const ad = await adotarReservaCriada(tx, org, r.id, ctx.marcados.get(ref) ?? [b]);
    if (ad.adotada) {
      if (ad.beds24Id !== b.idExterno) return desviado(avisoDuplicada(ctx, ref, id));
      return desviado(avisoDaConferencia(await conferirNaImportacao(tx, org, r.id, b, ctx.agora), ref, b.idExterno));
    }
    if (ad.motivo === "duplicada") return desviado(avisoDuplicada(ctx, ref, id));
    if (ad.motivo === "sem_acompanhamento") return desviado(`Registro ${id}: marcado com ${ref}, reserva do site que o sistema não enviou ao Beds24. Nada foi importado; confira no Beds24.`);
    if (ad.motivo === "id_de_outra_reserva") return desviado(`Registro ${id}: marcado com ${ref}, mas o id já é de outra reserva do SCL. Nada foi importado; confira no Beds24.`);
    return desviado(`Registro ${id}: a marca ${ref} está num registro que não bate com a reserva do site (quarto, datas ou situação). Nada foi importado; confira no Beds24.`);
  }

  if (!ref && b.estado !== "bloqueio" && !ctx.conhecidos.has(b.idExterno)) {
    const n = ctx.naoResolvidas.find((x) => x.quarto === b.roomId && b.checkin < x.saida && x.chegada < b.checkout);
    if (n) return desviado(`Registro ${id}: aguardando a conferência de um envio de reserva do site (${n.referencia}); não importado.`);
  }
  return segue;
}

/** Um aviso de duplicata por código (os registros seguintes do mesmo código pulam calados). */
function avisoDuplicada(ctx: ContextoDoDesvio, codigo: string, id: string): string | null {
  if (ctx.duplicadasAvisadas.has(codigo)) return null;
  ctx.duplicadasAvisadas.add(codigo);
  return `Registro ${id}: reserva duplicada no Beds24 para ${codigo}. Nada foi importado; confira no Beds24.`;
}
