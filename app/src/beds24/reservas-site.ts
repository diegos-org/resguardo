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
import { assinaturaAtualDoScl, type DecisaoAdocao, diferencaNaMarca, diferencaNoBeds24, type DiferencaNoBeds24, type EsperadoBeds24, lidoDoRegistro, regraDeAdocao, SITUACOES_OPERACAO_ATIVAS } from "./reservas-site-regras";
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
 * `funcionou` = todas as leituras responderam, nenhuma trouxe registro em formato inválido (um registro ilegível pode ser
 * o nosso: a busca não conclui) nem o mesmo id duas vezes, e o registro que voltou em mais de uma leitura voltou igual (senão,
 * qual cópia vale?). `comMarca` = os registros com a marca desta reserva, em todas as situações; o ensaio nunca entra.
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
      const nestaLeitura = new Set<string>();
      for (const b of l.itens) {
        if (nestaLeitura.has(b.idExterno)) return { funcionou: false, erro: "A leitura do Beds24 trouxe o mesmo registro duas vezes: a busca não conclui." };
        nestaLeitura.add(b.idExterno);
        const antes = porId.get(b.idExterno);
        if (antes && !mesmoRegistro(antes, b)) return { funcionou: false, erro: "O mesmo registro do Beds24 voltou diferente em duas leituras: a busca não conclui." };
        if (!antes) porId.set(b.idExterno, b);
      }
      lidoEm = l.lidoEm;
    }
  } catch (e) {
    return { funcionou: false, erro: e instanceof ErroBeds24 ? e.message : "Não foi possível ler o Beds24." };
  }
  return { funcionou: true, comMarca: [...porId.values()].filter((b) => !b.ensaio && b.referenciaScl === alvo.referencia), lidoEm };
}

/** O mesmo registro nos campos que a busca e a adoção olham: situação, quarto, datas, pessoas e marca. */
const mesmoRegistro = (a: ReservaBeds24, b: ReservaBeds24) =>
  a.estado === b.estado && a.propertyId === b.propertyId && a.roomId === b.roomId && a.checkin === b.checkin && a.checkout === b.checkout && a.hospedes === b.hospedes && a.referenciaScl === b.referenciaScl && a.ensaio === b.ensaio;

// ---------------------------------------------------------------- travas (ordem única: beds24:<org> → imóvel → reserva)

/**
 * A reserva do site e o acompanhamento dela, travados na ordem única (desenho 3.6): quem chama já tem `beds24:<org>`; aqui
 * o imóvel (`no key update`), a reserva (`nivel`: `update` quando o `beds24_id`, chave única, vai mudar) e o acompanhamento.
 * A adoção, a conferência da importação e as marcas manuais das OTAs (M8.3b, `reservas-site-tarefas.ts`) travam por aqui.
 * Sem acompanhamento, a trava da reserva serializa quem vai criá-lo.
 */
export async function travarReservaDoSite(tx: Db, org: string, reservaId: string, nivel: "update" | "no key update") {
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
  | { adotada: false; motivo: "id_de_outra_reserva"; id: string }
  /** Tudo casaria, mas a leitura trouxe registro ilegível ou sem dono (pode ser outra cópia com a marca): nada adotado. */
  | { adotada: false; motivo: "leitura_inconclusiva" };

const semAdocao = (d: Exclude<DecisaoAdocao, { adotar: true }>): ResultadoAdocao =>
  d.motivo === "duplicada" ? { adotada: false, motivo: "duplicada", ids: d.ids } : d.motivo === "marca_em_registro_inesperado" ? { adotada: false, motivo: d.motivo, id: d.id } : { adotada: false, motivo: "nenhum" };

/**
 * Adota o registro do Beds24 que a criação deixou sem resposta (resposta perdida, `success: false` que gravou mesmo assim,
 * busca da incerteza), pelas regras de adoção: grava o fato externo — `reservas.beds24_id` e, na operação de criação em
 * curso, o mesmo id com a situação `feita` (a conferência segue sem POST) — e a auditoria. Um id já ligado a ela que não é
 * o do registro (na reserva ou numa operação) faz dos dois uma duplicata. Não mexe na situação do acompanhamento nem nas
 * marcas das OTAs: isso é da conferência. Com `leituraInconclusiva` (a leitura trouxe registro ilegível ou sem dono, que
 * pode ser outra cópia com a marca), nada é adotado, mas os outros motivos vêm antes. Quem chama tem a trava `beds24:<org>`.
 * A mesma função na importação e no trabalhador (M8.3c).
 */
export async function adotarReservaCriada(tx: Db, org: string, reservaId: string, comMarca: readonly ReservaBeds24[], o: { autorId?: string | null; leituraInconclusiva?: boolean } = {}): Promise<ResultadoAdocao> {
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
  }
  // Só aqui, com tudo casando: os avisos mais certos (sem acompanhamento, duplicada, id de outra reserva) vêm antes.
  if (o.leituraInconclusiva) return { adotada: false, motivo: "leitura_inconclusiva" };
  if (r.beds24Id !== id) {
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
  | { resultado: "divergente"; motivo: DiferencaNoBeds24["motivo"] | "marca_ilegivel" };

/**
 * A importação confere a reserva do site com o registro ligado a ela (`registro` null = o id não voltou na leitura: apagado)
 * e nunca a muda: origem, valores, taxa, valor líquido, hóspede, e-mail, situação, `confirmadaEm`, `reservadaEm` e o motor
 * ficam intactos, mesmo com o vínculo do imóvel trocado. Grava `lido` e `lido_em` (só uma leitura mais nova sobrescreve).
 * - Igual ao `esperado` e com a marca desta reserva: `conferida_em` só sem operação ativa e com a assinatura do SCL de agora
 *   igual à do esperado.
 * - Sem a marca, ou com o código de outra reserva (D11; desenho 3.4 e 4.4): nunca `conferida_em`. Quando o Beds24 deveria
 *   estar igual, `divergente` com `marca_ilegivel` (sem marca legível; o painel passa a mostrar a marca como não legível) ou
 *   `mudada_no_beds24` (outro código); com as datas, a situação e o quarto iguais, a marca das datas fechadas fica.
 * - Diferente: `divergente` com o motivo (mudada, cancelada ou apagada no Beds24) quando o Beds24 deveria estar igual — o
 *   acompanhamento `conferida` (ou já `divergente`), sem operação ativa e o Beds24 diferente também do que o SCL quer agora;
 *   com as datas, a situação ou o quarto mudados, a marca "datas fechadas" (`ota_fechada_em`) volta a vazio. Com um envio a
 *   fazer ou em curso, ou com o Beds24 já como o SCL quer agora (o SCL mudou e o envio ainda não nasceu), a diferença é
 *   esperada: só a leitura fica.
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
  const quarto = a.roomId ?? a.esperado.quarto;
  const atual = assinaturaAtualDoScl(r, quarto);
  const dif = diferencaNoBeds24(a.esperado, lido);
  const marca = registro ? diferencaNaMarca(registro, r.codigo) : null;
  if (!dif && !marca) {
    const conferida = !ativa && a.assinaturaEsperada !== null && atual === a.assinaturaEsperada;
    await gravar(conferida ? { conferidaEm: agora } : {});
    return { resultado: "igual", conferida };
  }
  if (ativa || (a.situacao !== "conferida" && a.situacao !== "divergente")) {
    await gravar({});
    return { resultado: "lido" };
  }
  // O SCL mudou depois do `esperado` e a operação ainda não nasceu (chave desligada, pausa, ou antes da próxima volta): o
  // Beds24 difere do `esperado` por definição. Se ele já está como o SCL quer agora (a equipe seguiu o texto da reserva),
  // a diferença das datas não é divergência. Diferente também do que o SCL quer agora, a mudança veio de fora e segue o alarme.
  const comoOSclQuer = atual !== null && atual !== a.assinaturaEsperada && !diferencaNoBeds24({ quarto, chegada: r.checkin, saida: r.checkout, hospedes: r.hospedes, situacao: r.estado === "cancelada" ? "cancelada" : "confirmada" }, lido);
  if (dif && !comoOSclQuer) {
    await gravar({ situacao: "divergente", motivo: dif.motivo, ...(dif.soPessoas ? {} : { otaFechadaEm: null, otaFechadaPor: null }) });
    return { resultado: "divergente", motivo: dif.motivo };
  }
  // Só a marca não bate: as datas, a situação e o quarto estão como o SCL quer, e a marca das datas fechadas fica.
  if (marca) {
    await gravar({ situacao: "divergente", motivo: marca });
    return { resultado: "divergente", motivo: marca };
  }
  await gravar({});
  return { resultado: "lido" };
}

/** O aviso da conferência no resultado da importação (só o código SCL e o id do registro); null = nada a avisar. */
export function avisoDaConferencia(c: ConferenciaNaImportacao, codigo: string, beds24Id: string): string | null {
  const id = idSeguro(beds24Id);
  if (c.resultado === "sem_acompanhamento") return `Reserva ${codigo} (paga pelo site) ligada ao registro ${id} do Beds24 sem acompanhamento do envio: nada foi importado; confira.`;
  if (c.resultado !== "divergente") return null;
  if (c.motivo === "cancelada_no_beds24") return `Reserva ${codigo} (paga pelo site) foi cancelada no Beds24 (registro ${id}), mas continua confirmada no SCL: as datas podem estar abertas nas OTAs. O SCL não seguiu a mudança.`;
  if (c.motivo === "apagada_no_beds24") return `Reserva ${codigo} (paga pelo site): o registro ${id} não voltou na leitura do Beds24 (apagado?). Confira se as datas estão abertas nas OTAs; o SCL não mudou nada.`;
  if (c.motivo === "marca_ilegivel") return `Reserva ${codigo} (paga pelo site): o registro ${id} voltou do Beds24 sem a marca do SCL (o código da reserva nos info items). Confira o registro e as regras automáticas que apagam info codes; o SCL não mudou nada.`;
  return `Reserva ${codigo} (paga pelo site) está diferente no Beds24 (registro ${id}): o SCL não seguiu a mudança; confira a reserva.`;
}

/**
 * O registro ligado a uma reserva do site voltou em formato inválido: existe, mas não deu para ler. A conferência não conclui
 * e nada muda (nunca vira "apagada no Beds24"; avisar em vez de supor).
 */
export function avisoDeRegistroIlegivel(codigo: string, beds24Id: string): string {
  return `Reserva ${codigo} (paga pelo site): o registro ${idSeguro(beds24Id)} voltou do Beds24 em formato inválido; a conferência não concluiu e nada mudou. Confira o registro no Beds24.`;
}

/**
 * O registro ligado a uma reserva do site não voltou numa releitura por id que trouxe registro sem dono (um id que não foi
 * pedido, ou um registro ilegível): ele pode ser o que voltou. A conferência não conclui e nada muda (nunca "apagada").
 */
export function avisoDeReleituraSemConclusao(codigo: string, beds24Id: string): string {
  return `Reserva ${codigo} (paga pelo site): o registro ${idSeguro(beds24Id)} não voltou na releitura do Beds24, e a resposta trouxe registro que não foi pedido ou que não deu para ler; a conferência não concluiu e nada mudou. Confira o registro no Beds24.`;
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
/** O que um id do Beds24 já é no SCL: uma reserva (`fonte = 'beds24'` ou com `beds24_id`) ou um bloqueio importado. */
export type RegistroConhecido = "reserva" | "bloqueio";
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
  /** Ids que o SCL já conhece, com o que eles são no SCL (reserva ou bloqueio importado): a atualização deles não cria nada e segue. */
  conhecidos: ReadonlyMap<string, RegistroConhecido>;
  /** Códigos já avisados como duplicados (um aviso por código). */
  duplicadasAvisadas: Set<string>;
  /**
   * A leitura (o período ou a releitura por id) trouxe registro que não deu para ler ou atribuir: ele pode ser outra cópia
   * com a marca, então a adoção não conclui (como na busca, `procurarReservaDoSite`).
   */
  leituraComIlegivel: boolean;
  /** Ids que voltaram em formato inválido em alguma leitura desta importação: o ligado a uma reserva do site não é conferido. */
  ilegiveis: ReadonlySet<string>;
};

/**
 * Lê, uma vez por importação, o que o desvio consulta: as reservas do site ligadas a um id do Beds24, os ensaios, as
 * reservas dos códigos marcados no lote e as criações não resolvidas — uma operação `criar` em `enviando` (de qualquer
 * idade), uma operação `incerta`, um POST tentado sem o id, ou o acompanhamento `aguardando_equipe` com motivo `incerta`,
 * de reserva ainda sem `beds24_id`.
 */
export async function prepararDesvioNaImportacao(tx: Db, org: string, registros: Iterable<ReservaBeds24>, conhecidos: ReadonlyMap<string, RegistroConhecido>, agora: Date, o: { leituraComIlegivel: boolean; ilegiveis: ReadonlySet<string> }): Promise<ContextoDoDesvio> {
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
  return { agora, marcados, ligadas, ensaios, porCodigo, naoResolvidas, conhecidos, duplicadasAvisadas: new Set(), leituraComIlegivel: o.leituraComIlegivel, ilegiveis: o.ilegiveis };
}

/** `desviado`: o registro não segue para o vínculo, o bloqueio nem `sincronizarReserva`; `aviso` vai ao resultado da importação. */
export type DesvioNaImportacao = { desviado: false } | { desviado: true; aviso: string | null };

const desviado = (aviso: string | null): DesvioNaImportacao => ({ desviado: true, aviso });
const segue: DesvioNaImportacao = { desviado: false };

/**
 * O registro com a marca que o SCL já conhece segue o caminho normal (c e d não valem para ele): a reserva importada
 * (atualiza ou cancela a cópia) e o bloqueio importado que voltou como bloqueio ou cancelado (o cancelado sai do SCL, com a
 * remoção no histórico). Ele não é o registro que o M8.3 criou: esse está em `ligadas` (b) ou ainda é desconhecido. O
 * bloqueio importado que volta como reserva com a marca continua em c e d: virar uma reserva importada duplicaria, no
 * financeiro, a reserva do site daquelas datas.
 */
function conhecidoSegue(b: ReservaBeds24, conhecidos: ReadonlyMap<string, RegistroConhecido>): boolean {
  const t = conhecidos.get(b.idExterno);
  return t === "reserva" || (t === "bloqueio" && (b.estado === "bloqueio" || b.estado === "cancelada"));
}

/**
 * O desvio da importação (desenho 5.2), nesta ordem, antes da conferência de vínculo e do ramo de bloqueio:
 * - a. o ensaio do SCL (pela marca `SCL-ENSAIO` ou pelo id gravado no ensaio) pula, com aviso; nunca cria;
 * - b. o registro ligado a uma reserva do site (`reservas.beds24_id` ou o id numa operação dela) vai a
 *   `conferirNaImportacao`, nunca a `sincronizarReserva` — inclusive um `black` (a reserva paga nunca é cancelada por ele);
 * - c. a marca casada pelas regras de adoção chama `adotarReservaCriada` e depois confere; com um registro ilegível ou sem
 *   dono na leitura, a adoção não conclui (pode ser outra cópia com a marca): pula, com aviso;
 * - d. a marca sem reserva correspondente, duplicada ou num registro que não bate vira aviso; nada é criado;
 * - e. sem marca legível, no mesmo quarto e com noites sobrepostas a uma criação não resolvida: pula, com aviso.
 * O SCL nunca cria um `black`: um bloqueio com o código no nome (a equipe fechando as datas à mão) segue o caminho dos
 * bloqueios em c, d e e. O registro que o SCL já conhece (reserva ou bloqueio importado) também segue em c, d e e: a
 * atualização dele não cria nada, e pular escondia o cancelamento (o bloqueio cancelado ficava fechando as noites no site;
 * a cópia de uma reserva de OTA cancelada continuava confirmada). Em c e d, o bloqueio importado que volta como reserva fica
 * de fora dessa regra (`conhecidoSegue`).
 */
export async function desvioNaImportacao(tx: Db, org: string, b: ReservaBeds24, ctx: ContextoDoDesvio): Promise<DesvioNaImportacao> {
  const id = idSeguro(b.idExterno);
  if (b.ensaio || ctx.ensaios.has(b.idExterno)) return desviado(`Registro ${id}: ensaio do SCL; não importado.`);

  const ligada = ctx.ligadas.get(b.idExterno);
  if (ligada) {
    if (ligada.beds24Id && ligada.beds24Id !== b.idExterno) return desviado(avisoDuplicada(ctx, ligada.codigo, id));
    // Ilegível numa leitura e legível noutra: qual vale? A conferência não conclui.
    if (ctx.ilegiveis.has(b.idExterno)) return desviado(avisoDeRegistroIlegivel(ligada.codigo, b.idExterno));
    return desviado(avisoDaConferencia(await conferirNaImportacao(tx, org, ligada.id, b, ctx.agora), ligada.codigo, b.idExterno));
  }

  const ref = b.referenciaScl;
  if (ref && b.estado !== "bloqueio" && !conhecidoSegue(b, ctx.conhecidos)) {
    const r = ctx.porCodigo.get(ref);
    if (!r) return desviado(`Registro ${id}: marcado pelo SCL (${ref}) sem reserva correspondente. Nada foi importado.`);
    const ad = await adotarReservaCriada(tx, org, r.id, ctx.marcados.get(ref) ?? [b], { leituraInconclusiva: ctx.leituraComIlegivel });
    if (ad.adotada) {
      if (ad.beds24Id !== b.idExterno) return desviado(avisoDuplicada(ctx, ref, id));
      return desviado(avisoDaConferencia(await conferirNaImportacao(tx, org, r.id, b, ctx.agora), ref, b.idExterno));
    }
    if (ad.motivo === "duplicada") return desviado(avisoDuplicada(ctx, ref, id));
    if (ad.motivo === "sem_acompanhamento") return desviado(`Registro ${id}: marcado com ${ref}, reserva do site que o sistema não enviou ao Beds24. Nada foi importado; confira no Beds24.`);
    if (ad.motivo === "id_de_outra_reserva") return desviado(`Registro ${id}: marcado com ${ref}, mas o id já é de outra reserva do SCL. Nada foi importado; confira no Beds24.`);
    if (ad.motivo === "leitura_inconclusiva") return desviado(`Registro ${id}: marcado com ${ref}, mas a leitura do Beds24 trouxe registro que não deu para ler ou que não foi pedido (pode ser outra cópia): a adoção não concluiu. Nada foi importado; confira no Beds24.`);
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
