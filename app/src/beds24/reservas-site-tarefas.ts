/**
 * Tarefas das OTAs num lugar só (M8.3b, desenho 6 em `requisitos/product/RESERVA-SITE-BEDS24.md`): o que a equipe faz à mão
 * no Beds24 para cada reserva do site, o que o sistema está enviando e o que pede atenção. `tarefasDasOtas` é a única fonte
 * dos avisos das OTAs no Início (paga, D3, cancelada, alterada) e do bloco "No Beds24" da ficha; as marcas manuais "Datas
 * fechadas nas OTAs" (D8, 6.4) e "Datas reabertas nas OTAs" (a D3 cancelada pelo "Cancelar reserva" comum) ficam aqui.
 *
 * Nada aqui escreve no Beds24 nem usa a rede: o envio é o M8.3c, atrás de `escritaReservasBeds24Pronta`. Nenhum valor nem
 * dado do hóspede: só o código SCL e as datas. Os funis do pagamento (`pagamentos/*`) nunca importam daqui (desenho 3.1);
 * os textos genéricos deles mandam seguir o aviso do Início.
 */
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { exigir, type Sessao } from "@/acesso/politica";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { alteracoesReserva, beds24ReservasOperacoes, beds24ReservasSite, cancelamentosReserva, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { diaMesBr, diaMesNoFuso, FUSO_PADRAO, hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { travarReservaDoSite } from "./reservas-site";
import { lerConfigReservasBeds24, ligacaoDoImovel, type MotivoDesligadaBeds24, motivosDesligada } from "./reservas-site-config";
import { lerReservaParaBeds24 } from "./reservas-site-contexto";
import { criadaPeloM83, MOTIVOS_CONFIGURACAO_BEDS24, type MotivoAcompanhamentoBeds24, reservaDoSiteParaBeds24, type SituacaoAcompanhamentoBeds24, SITUACOES_OPERACAO_ATIVAS } from "./reservas-site-regras";
import { tentarTravaBeds24 } from "./trava";

/**
 * Depois disto, contado desde o fato (o pagamento que confirmou, o cancelamento ou a última alteração aplicada), o envio
 * automático conta como atrasado (desenho 6.1). Não há coluna da intenção: o relógio é o do fato, sem migração.
 */
export const CARENCIA_ENVIO_RESERVA_MINUTOS = 30;

/**
 * O caso de cada tarefa (desenho 6.2): a paga sem reserva no Beds24, a D3 (confirmada à mão sem pagamento pelo site), a D3
 * cancelada pelo "Cancelar reserva" comum depois de marcada, e a cancelada e a alterada, com o texto do bloqueio feito à mão
 * ou o da reserva criada pelo sistema.
 */
export type CasoTarefaOta = "paga" | "d3" | "d3_cancelada" | "cancelada_bloqueio" | "cancelada_criada" | "alterada_bloqueio" | "alterada_criada";
/** `manual`: a equipe faz no Beds24; `sendo_enviada`: o sistema está enviando (há menos de 30 min); `atrasada`: há mais. */
export type EstadoTarefaOta = "manual" | "sendo_enviada" | "atrasada";
/**
 * O que pede atenção em vez de uma tarefa (nunca "feche como bloqueio" sobre noites já ocupadas, desenho 6.1): conflito,
 * diferença no Beds24, aguardando a equipe, o bloqueio feito à mão sobre as noites (transição, 6.6) e a reserva ligada a um
 * registro do Beds24 que o sistema não criou.
 */
export type AtencaoOta = "conflito" | "divergente" | "aguardando_equipe" | "transicao" | "ja_no_beds24";
/** O botão da ficha: "Datas fechadas nas OTAs" (paga e D3) ou "Datas reabertas nas OTAs" (a D3 cancelada). */
export type MarcaDaTarefaOta = "datas_fechadas" | "datas_reabertas";

export type TarefaOta = {
  reservaId: string;
  codigo: string;
  caso: CasoTarefaOta;
  estado: EstadoTarefaOta;
  /** As datas da reserva agora (o texto e a pergunta do botão). */
  checkin: string;
  checkout: string;
  /** O fato que conta a carência. */
  desde: Date;
  /** Na alterada: as alterações aplicadas sem a marca das OTAs. */
  alteracaoIds: string[];
  /** O texto manual (6.2), igual na ficha e no Início. */
  texto: string;
  /** O botão da ficha, só na tarefa manual e sem operação ativa da reserva; null = nenhum. */
  marca: MarcaDaTarefaOta | null;
};
export type LinhaAtencaoOta = { reservaId: string; codigo: string; tipo: AtencaoOta };
/** O mesmo formato dos alertas do Início (sem importar o painel, que importa daqui). */
export type AvisoTarefaOta = { nivel: "atencao" | "info"; texto: string; link?: string };
export type TarefasDasOtas = { tarefas: TarefaOta[]; atencoes: LinhaAtencaoOta[]; avisos: AvisoTarefaOta[] };

// ---------------------------------------------------------------- a classificação (pura, desenho 6.1)

/** O fato que pede a tarefa; o caso sai dele e de a reserva ter sido criada pelo sistema. */
export type FatoDaTarefaOta = "paga" | "d3" | "d3_cancelada" | "cancelada" | "alterada";

export type EntradaDaTarefaOta = {
  fato: FatoDaTarefaOta;
  /** Criada pelo M8.3 no Beds24 (`criadaPeloM83`). */
  criada: boolean;
  acompanhamento: { situacao: SituacaoAcompanhamentoBeds24; motivo: MotivoAcompanhamentoBeds24 | null; otaFechadaEm: Date | null } | null;
  /** Um envio real desta reserva sem conclusão (`enviando`, `incerta`, o POST tentado sem o id) ou o acompanhamento `em_envio`. */
  emCurso: boolean;
  /** Por que o envio automático está desligado para ela (`motivosDesligada`, sem `sem_acompanhamento`). */
  desligada: readonly MotivoDesligadaBeds24[];
  /**
   * A régua, só na paga e só quando todo o resto deixa o envio automático: `criar` = a criação sairia (ou a mesma intenção já
   * espera o envio); `ja_no_beds24` = ligada a um registro que o sistema não criou; `outra` = fica à mão. null = não lida.
   */
  regua: "criar" | "ja_no_beds24" | "outra" | null;
  desde: Date;
  agora: Date;
};

export type ClassificacaoTarefaOta =
  | { tipo: "nada" }
  | { tipo: "atencao"; atencao: AtencaoOta }
  | { tipo: "tarefa"; caso: CasoTarefaOta; estado: EstadoTarefaOta }
  /** Falta a régua (`regua` null): quem chama lê a reserva e classifica de novo. */
  | { tipo: "regua" };

const NADA: ClassificacaoTarefaOta = { tipo: "nada" };
const ehMotivoDeConfiguracao = (m: MotivoAcompanhamentoBeds24 | null) => m !== null && (MOTIVOS_CONFIGURACAO_BEDS24 as readonly string[]).includes(m);

/** O acompanhamento que só pede atenção (fora de configuração): conflito, divergente ou aguardando a equipe. */
function atencaoDoAcompanhamento(a: EntradaDaTarefaOta["acompanhamento"]): AtencaoOta | null {
  if (!a || ehMotivoDeConfiguracao(a.motivo)) return null;
  if (a.situacao === "conflito") return "conflito";
  if (a.situacao === "divergente") return "divergente";
  if (a.situacao === "aguardando_equipe") return a.motivo === "bloqueio_manual" ? "transicao" : "aguardando_equipe";
  return null;
}

function casoDaTarefa(fato: FatoDaTarefaOta, criada: boolean): CasoTarefaOta {
  if (fato === "cancelada") return criada ? "cancelada_criada" : "cancelada_bloqueio";
  if (fato === "alterada") return criada ? "alterada_criada" : "alterada_bloqueio";
  return fato;
}

/**
 * A regra da seção 6.1, uma função, um lugar, na ordem:
 * 1. paga e D3 marcadas (`ota_fechada_em`, pela equipe ou pelo sistema) ou com o acompanhamento `conferida`/`encerrada`: nada;
 * 2. a paga criada pelo sistema, ainda sem a marca: nunca "feche como bloqueio" o que já está lá. Conflito, divergente ou
 *    aguardando a equipe (com qualquer motivo, inclusive o de configuração, como a marca ilegível): a atenção; senão, o
 *    sistema está nela (sendo enviada ou atrasada);
 * 3. conflito, divergente ou aguardando a equipe (fora de configuração): só a atenção, nunca a tarefa manual;
 * 4. D3 (com ou sem o cancelamento comum): sempre à mão, nunca vai ao envio (a régua responde `sem_pagamento`);
 * 5. um envio desta reserva sem conclusão: o sistema está nele (sendo enviada ou atrasada, pelo relógio do fato);
 * 6. motivo de configuração, acompanhamento `manual` ou `encerrada`: à mão;
 * 7. o envio desligado (ambiente, chave, credencial ou pausa): à mão; o imóvel desligado só para a criação;
 * 8. a paga: a régua diz (`criar` = automática; `ja_no_beds24` = atenção; o resto, à mão);
 * 9. a cancelada e a alterada: o sistema escreve na reserva que ele criou e é dono da criação que ainda espera o envio
 *    (acompanhamento `pendente`, o imóvel ligado); o bloqueio feito à mão é sempre da equipe.
 * Automática: sendo enviada até 30 minutos depois do fato; depois, atrasada.
 */
export function classificarTarefa(e: EntradaDaTarefaOta): ClassificacaoTarefaOta {
  const a = e.acompanhamento;
  if ((e.fato === "paga" || e.fato === "d3") && (a?.otaFechadaEm || a?.situacao === "conferida" || a?.situacao === "encerrada")) return NADA;
  const tempo = e.agora.getTime() - e.desde.getTime() < CARENCIA_ENVIO_RESERVA_MINUTOS * 60_000 ? "sendo_enviada" : "atrasada";
  if (e.fato === "paga" && e.criada) {
    const atencaoDaCriada = a?.situacao === "conflito" ? "conflito" : a?.situacao === "divergente" ? "divergente" : a?.situacao === "aguardando_equipe" ? (a.motivo === "bloqueio_manual" ? "transicao" : "aguardando_equipe") : null;
    return atencaoDaCriada ? { tipo: "atencao", atencao: atencaoDaCriada } : { tipo: "tarefa", caso: "paga", estado: tempo };
  }
  const atencao = atencaoDoAcompanhamento(a);
  if (atencao) return { tipo: "atencao", atencao };
  const caso = casoDaTarefa(e.fato, e.criada);
  const manual: ClassificacaoTarefaOta = { tipo: "tarefa", caso, estado: "manual" };
  const automatica: ClassificacaoTarefaOta = { tipo: "tarefa", caso, estado: tempo };
  if (e.fato === "d3" || e.fato === "d3_cancelada") return manual;
  if (e.emCurso) return automatica;
  if (a && (ehMotivoDeConfiguracao(a.motivo) || a.situacao === "manual" || a.situacao === "encerrada")) return manual;
  if (e.desligada.some((m) => m !== "imovel" && m !== "sem_acompanhamento")) return manual;
  if (e.fato === "paga") {
    if (e.desligada.includes("imovel")) return manual;
    if (e.regua === null) return { tipo: "regua" };
    if (e.regua === "ja_no_beds24") return { tipo: "atencao", atencao: "ja_no_beds24" };
    return e.regua === "criar" ? automatica : manual;
  }
  // A criação que espera o envio (acompanhamento `pendente`, o imóvel ligado) leva as datas de agora e, cancelada antes,
  // nunca sai: o sistema é dono dela, e não há bloqueio feito à mão a mudar. Com o imóvel desligado, a paga ficou à mão.
  return e.criada || (a?.situacao === "pendente" && !e.desligada.includes("imovel")) ? automatica : manual;
}

// ---------------------------------------------------------------- os textos (desenho 6.2) e os avisos do Início

const FECHE = "Feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.";

/**
 * O texto manual de cada caso (6.2), por reserva: as datas são as da reserva agora, de `diaMesBr(checkin)` a
 * `diaMesBr(checkout)` (o mesmo [início, fim) que a importação guarda para os bloqueios). Sempre "não apague": um bloqueio
 * apagado no Beds24 nunca sai do SCL; o que volta como `cancelled`, sai.
 */
export function textoDaTarefa(t: Pick<TarefaOta, "caso" | "codigo" | "checkin" | "checkout">): string {
  const datas = `${diaMesBr(t.checkin)} a ${diaMesBr(t.checkout)}`;
  switch (t.caso) {
    case "paga":
      return FECHE;
    case "d3":
      return `Confirmada à mão, sem pagamento pelo site: esta reserva nunca vai ao Beds24 pelo sistema. ${FECHE}`;
    case "d3_cancelada":
    case "cancelada_bloqueio":
      return `Mude o bloqueio de ${datas} para Cancelado (não apague).`;
    case "cancelada_criada":
      return `No Beds24, mude a reserva ${t.codigo} para Cancelado (não apague).`;
    case "alterada_bloqueio":
      return `Mude as datas do bloqueio para ${datas} (não apague nem crie outro).`;
    case "alterada_criada":
      return `No Beds24, mude as datas da reserva ${t.codigo} para ${datas}.`;
  }
}

/** Os códigos das reservas do aviso (até 5; o resto em número): quem lê sabe qual abrir. */
const codigos = (xs: readonly { codigo: string }[]) => (xs.length <= 5 ? xs.map((x) => x.codigo).join(", ") : `${xs.slice(0, 5).map((x) => x.codigo).join(", ")} e mais ${xs.length - 5}`);
/** Uma reserva: a ficha dela. Mais de uma: a lista das reservas. */
const link = (xs: readonly { reservaId: string }[]) => (xs.length === 1 ? `/painel/reservas/${xs[0].reservaId}` : "/painel/reservas");
/** Uma linha por reserva (a mesma reserva pode ter duas tarefas automáticas). */
const porReserva = <T extends { reservaId: string }>(xs: readonly T[]) => [...new Map(xs.map((x) => [x.reservaId, x])).values()];

/** O texto de atenção de cada reserva no Início (o que fazer está na ficha). */
const ATENCAO_NO_INICIO: Record<Exclude<AtencaoOta, "transicao">, (codigo: string) => string> = {
  conflito: (c) => `Reserva ${c}: as noites estão ocupadas por outra reserva no Beds24 (possível venda dupla). Veja a ficha.`,
  divergente: (c) => `Reserva ${c} está diferente no Beds24: veja a ficha.`,
  aguardando_equipe: (c) => `Reserva ${c} aguarda a equipe no Beds24: veja a ficha.`,
  ja_no_beds24: (c) => `Reserva ${c} está ligada a um registro do Beds24 que o sistema não criou: veja a ficha.`,
};

/**
 * As linhas do Início (desenho 6.1), sem valores, nesta ordem: atenção (conflito, divergente, aguardando a equipe e a
 * reserva ligada a outro registro, as atrasadas), depois o que a equipe faz à mão (a paga e a D3 agrupadas com os códigos;
 * cancelada e alterada uma por reserva, porque o texto leva as datas dela) e por fim o informativo (sendo enviadas pelo
 * sistema e o bloqueio feito à mão sobre as noites). Todo texto leva um código ou uma contagem (a chave da lista no Início).
 */
export function avisosDasTarefas(tarefas: readonly TarefaOta[], atencoes: readonly LinhaAtencaoOta[]): AvisoTarefaOta[] {
  const avisos: AvisoTarefaOta[] = [];
  for (const tipo of ["conflito", "divergente", "aguardando_equipe", "ja_no_beds24"] as const) {
    for (const x of atencoes.filter((y) => y.tipo === tipo)) avisos.push({ nivel: "atencao", texto: ATENCAO_NO_INICIO[tipo](x.codigo), link: link([x]) });
  }
  const atrasadas = porReserva(tarefas.filter((t) => t.estado === "atrasada"));
  if (atrasadas.length) avisos.push({ nivel: "atencao", texto: `${atrasadas.length} reserva(s) do site com o envio ao Beds24 atrasado (${codigos(atrasadas)}): confira na ficha.`, link: link(atrasadas) });
  const manuais = tarefas.filter((t) => t.estado === "manual");
  const pagas = manuais.filter((t) => t.caso === "paga");
  if (pagas.length) avisos.push({ nivel: "info", texto: `${pagas.length} reserva(s) do site paga(s) (${codigos(pagas)}): feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.`, link: link(pagas) });
  const d3 = manuais.filter((t) => t.caso === "d3");
  if (d3.length)
    avisos.push({ nivel: "info", texto: `${d3.length} reserva(s) do site confirmada(s) à mão, sem pagamento pelo site (${codigos(d3)}): feche as datas no Beds24 como bloqueio e marque Datas fechadas nas OTAs.`, link: link(d3) });
  const datas = (t: TarefaOta) => `${diaMesBr(t.checkin)} a ${diaMesBr(t.checkout)}`;
  for (const t of manuais) {
    if (t.caso === "cancelada_bloqueio" || t.caso === "d3_cancelada") avisos.push({ nivel: "info", texto: `Reserva ${t.codigo}, cancelada: mude o bloqueio de ${datas(t)} para Cancelado (não apague).`, link: link([t]) });
    else if (t.caso === "cancelada_criada") avisos.push({ nivel: "info", texto: t.texto, link: link([t]) });
  }
  for (const t of manuais) {
    if (t.caso === "alterada_bloqueio") avisos.push({ nivel: "info", texto: `Reserva ${t.codigo}, alterada: mude as datas do bloqueio para ${datas(t)} (não apague nem crie outro).`, link: link([t]) });
    else if (t.caso === "alterada_criada") avisos.push({ nivel: "info", texto: t.texto, link: link([t]) });
  }
  const enviando = porReserva(tarefas.filter((t) => t.estado === "sendo_enviada"));
  if (enviando.length) avisos.push({ nivel: "info", texto: `${enviando.length} reserva(s) do site sendo enviadas pelo sistema: não feche à mão.`, link: link(enviando) });
  for (const x of atencoes.filter((y) => y.tipo === "transicao"))
    avisos.push({ nivel: "info", texto: `Reserva ${x.codigo}: há um bloqueio feito à mão sobre as noites no Beds24, e o sistema não cria por cima: veja a ficha.`, link: link([x]) });
  return avisos;
}

// ---------------------------------------------------------------- a leitura (desenho 6.1)

type Candidata = { fato: FatoDaTarefaOta; id: string; codigo: string; imovelId: string; checkin: string; checkout: string; beds24Id: string | null; desde: Date; alteracaoIds: string[] };

const ORDEM_DOS_CASOS: readonly CasoTarefaOta[] = ["paga", "d3", "d3_cancelada", "cancelada_bloqueio", "cancelada_criada", "alterada_bloqueio", "alterada_criada"];
/** Sem a hora do fato, a carência conta como passada (avisar em vez de supor). */
const SEM_HORA = new Date(0);

/**
 * As tarefas das OTAs da organização (ou só de `reservaIds`, para a ficha), só leitura e sem trava. Os cortes de data são
 * os de antes (hoje em São Paulo): a paga, a D3 e a cancelada com a saída depois de hoje; a alterada com a saída (de antes
 * ou de agora) hoje ou depois. A régua só é lida para a paga quando o envio automático está ligado para ela (no
 * M8.3b, só nos testes: ligar um imóvel exige o ensaio do M8.3c). `env` vem de quem chama; `{}` deixa tudo à mão.
 * Desvio do desenho (`tarefasDasOtas(db, org, agora)`): `env` explícito (regra do M8.3) e `reservaIds` (a ficha).
 */
export async function tarefasDasOtas(db: Db, org: string, agora: Date, env: NodeJS.ProcessEnv, o: { reservaIds?: readonly string[] } = {}): Promise<TarefasDasOtas> {
  const ids = o.reservaIds?.filter((id) => uuidValido(id));
  if (ids && !ids.length) return { tarefas: [], atencoes: [], avisos: [] };
  const soEstas = ids ? inArray(reservas.id, ids) : undefined;
  const hoje = hojeISO(FUSO_PADRAO, agora);
  const config = await lerConfigReservasBeds24(db, org);
  const daReserva = { id: reservas.id, codigo: reservas.codigo, imovelId: reservas.imovelId, checkin: reservas.checkin, checkout: reservas.checkout, beds24Id: reservas.beds24Id };

  // Paga e D3: as confirmadas do site com a saída depois de hoje; a paga tem um pagamento com desfecho `reserva`.
  const confirmadas = await db
    .select({ ...daReserva, confirmadaEm: reservas.confirmadaEm })
    .from(reservas)
    .where(and(eq(reservas.organizacaoId, org), eq(reservas.fonte, "site"), eq(reservas.estado, "confirmada"), sql`${reservas.checkout} > ${hoje}`, soEstas))
    .orderBy(asc(reservas.codigo));
  const pagos = confirmadas.length
    ? await db
        .select({ reservaId: pagamentos.reservaId, desfechoEm: pagamentos.desfechoEm })
        .from(pagamentos)
        .where(and(eq(pagamentos.organizacaoId, org), inArray(pagamentos.reservaId, confirmadas.map((r) => r.id)), eq(pagamentos.desfecho, "reserva")))
    : [];
  const candidatas: Candidata[] = confirmadas.map(({ confirmadaEm, ...r }) => {
    const doPagamento = pagos.filter((p) => p.reservaId === r.id);
    const desfecho = doPagamento.map((p) => p.desfechoEm).filter((d): d is Date => d !== null).sort((x, y) => x.getTime() - y.getTime())[0];
    return { fato: doPagamento.length ? "paga" : "d3", ...r, desde: desfecho ?? confirmadaEm ?? SEM_HORA, alteracaoIds: [] };
  });

  // A D3 cancelada pelo "Cancelar reserva" comum (sem cancelamento pela política) depois de a equipe marcar as datas fechadas.
  const d3Canceladas = await db
    .select({ ...daReserva, canceladaEm: reservas.canceladaEm })
    .from(reservas)
    .innerJoin(beds24ReservasSite, and(eq(beds24ReservasSite.reservaId, reservas.id), eq(beds24ReservasSite.organizacaoId, org)))
    .where(
      and(
        eq(reservas.organizacaoId, org),
        eq(reservas.fonte, "site"),
        eq(reservas.estado, "cancelada"),
        sql`${reservas.checkout} > ${hoje}`,
        eq(beds24ReservasSite.situacao, "manual"),
        isNotNull(beds24ReservasSite.otaFechadaEm),
        sql`not exists (select 1 from ${cancelamentosReserva} c where c.reserva_id = ${reservas.id} and c.situacao = 'cancelada')`,
        soEstas,
      ),
    )
    .orderBy(asc(reservas.codigo));
  for (const { canceladaEm, ...r } of d3Canceladas) candidatas.push({ fato: "d3_cancelada", ...r, desde: canceladaEm ?? SEM_HORA, alteracaoIds: [] });

  // Cancelada pela política, com as datas ainda não marcadas como reabertas e a saída depois de hoje.
  const canceladas = await db
    .select({ ...daReserva, canceladaEm: cancelamentosReserva.canceladaEm })
    .from(cancelamentosReserva)
    .innerJoin(reservas, eq(reservas.id, cancelamentosReserva.reservaId))
    .where(and(eq(cancelamentosReserva.organizacaoId, org), eq(cancelamentosReserva.situacao, "cancelada"), isNull(cancelamentosReserva.otaLiberadaEm), sql`${reservas.checkout} > ${hoje}`, soEstas))
    .orderBy(asc(reservas.codigo));
  for (const { canceladaEm, ...r } of new Map(canceladas.map((x) => [x.id, x])).values()) candidatas.push({ fato: "cancelada", ...r, desde: canceladaEm ?? SEM_HORA, alteracaoIds: [] });

  // Cancelada depois de uma mudança de datas que a equipe ainda não marcou nas OTAs: o bloqueio feito à mão ficou onde a
  // última marca o pôs. "Datas fechadas nas OTAs" fecha as datas da reserva naquela hora, e a marca de uma alteração segue o
  // texto da tarefa, também com as datas daquela hora: depois da última marca (das duas), o bloqueio está nas datas de antes
  // da primeira mudança aplicada depois dela (sem marca nenhuma, da primeira mudança). O texto leva essas datas; sem mudança
  // depois da última marca, as da reserva agora.
  const canceladasIds = candidatas.filter((c) => c.fato === "cancelada" || c.fato === "d3_cancelada").map((c) => c.id);
  if (canceladasIds.length) {
    const mudancas = await db
      .select({
        reservaId: alteracoesReserva.reservaId,
        checkinAntes: alteracoesReserva.checkinAntes,
        checkoutAntes: alteracoesReserva.checkoutAntes,
        aplicadaEm: alteracoesReserva.aplicadaEm,
        otaAtualizadaEm: alteracoesReserva.otaAtualizadaEm,
      })
      .from(alteracoesReserva)
      .where(
        and(
          eq(alteracoesReserva.organizacaoId, org),
          inArray(alteracoesReserva.reservaId, canceladasIds),
          eq(alteracoesReserva.situacao, "aplicada"),
          or(ne(alteracoesReserva.checkinAntes, alteracoesReserva.checkinDepois), ne(alteracoesReserva.checkoutAntes, alteracoesReserva.checkoutDepois)),
        ),
      )
      .orderBy(asc(alteracoesReserva.aplicadaEm), asc(alteracoesReserva.id));
    const fechadas = mudancas.length
      ? await db
          .select({ reservaId: beds24ReservasSite.reservaId, otaFechadaEm: beds24ReservasSite.otaFechadaEm })
          .from(beds24ReservasSite)
          .where(and(eq(beds24ReservasSite.organizacaoId, org), inArray(beds24ReservasSite.reservaId, canceladasIds), isNotNull(beds24ReservasSite.otaFechadaEm)))
      : [];
    for (const c of candidatas) {
      if (c.fato !== "cancelada" && c.fato !== "d3_cancelada") continue;
      const dela = mudancas.filter((x) => x.reservaId === c.id);
      const fechadaEm = fechadas.find((x) => x.reservaId === c.id)?.otaFechadaEm?.getTime() ?? -Infinity;
      const ultimaMarca = Math.max(fechadaEm, ...dela.map((x) => x.otaAtualizadaEm?.getTime() ?? -Infinity));
      const primeira = dela.find((x) => x.otaAtualizadaEm === null && (x.aplicadaEm ?? SEM_HORA).getTime() > ultimaMarca);
      if (primeira) Object.assign(c, { checkin: primeira.checkinAntes, checkout: primeira.checkoutAntes });
    }
  }

  // Alterada: aplicada com as datas mudadas e o bloqueio ainda não marcado, a reserva confirmada e a saída (de antes ou de
  // agora) hoje ou depois. A reserva-pedido das datas seguradas nunca vai às OTAs; só as pessoas ou o valor não mexem
  // no bloqueio. Uma linha por reserva, com as alterações e a última aplicada.
  const alteradas = await db
    .select({ ...daReserva, alteracaoId: alteracoesReserva.id, aplicadaEm: alteracoesReserva.aplicadaEm })
    .from(alteracoesReserva)
    .innerJoin(reservas, eq(reservas.id, alteracoesReserva.reservaId))
    .where(
      and(
        eq(alteracoesReserva.organizacaoId, org),
        eq(alteracoesReserva.situacao, "aplicada"),
        isNull(alteracoesReserva.otaAtualizadaEm),
        or(ne(alteracoesReserva.checkinAntes, alteracoesReserva.checkinDepois), ne(alteracoesReserva.checkoutAntes, alteracoesReserva.checkoutDepois)),
        eq(reservas.estado, "confirmada"),
        sql`greatest(${alteracoesReserva.checkoutAntes}, ${alteracoesReserva.checkoutDepois}) >= ${hoje}::date`,
        soEstas,
      ),
    )
    .orderBy(asc(reservas.codigo), asc(alteracoesReserva.aplicadaEm));
  const porAlterada = new Map<string, Candidata>();
  for (const { alteracaoId, aplicadaEm, ...r } of alteradas) {
    const c = porAlterada.get(r.id) ?? { fato: "alterada" as const, ...r, desde: SEM_HORA, alteracaoIds: [] };
    c.alteracaoIds.push(alteracaoId);
    if (aplicadaEm && aplicadaEm.getTime() > c.desde.getTime()) c.desde = aplicadaEm;
    porAlterada.set(r.id, c);
  }
  candidatas.push(...porAlterada.values());
  if (!candidatas.length) return { tarefas: [], atencoes: [], avisos: [] };

  // O acompanhamento, o id do Beds24 de uma operação real (antes da fase 3 ele ainda não está na reserva) e as operações
  // ativas ou sem conclusão.
  const todas = [...new Set(candidatas.map((c) => c.id))];
  const acompanhamentos = new Map((await db.select().from(beds24ReservasSite).where(and(eq(beds24ReservasSite.organizacaoId, org), inArray(beds24ReservasSite.reservaId, todas)))).map((a) => [a.reservaId, a]));
  const op = beds24ReservasOperacoes;
  const ativas: readonly string[] = SITUACOES_OPERACAO_ATIVAS;
  const operacoes = await db
    .select({ reservaId: op.reservaId, situacao: op.situacao, enviadoEm: op.enviadoEm, beds24Id: op.beds24Id })
    .from(op)
    .where(and(eq(op.organizacaoId, org), inArray(op.reservaId, todas), eq(op.modo, "real"), or(isNotNull(op.beds24Id), inArray(op.situacao, [...SITUACOES_OPERACAO_ATIVAS]))));

  const tarefas: TarefaOta[] = [];
  const atencoes = new Map<string, LinhaAtencaoOta>();
  const reguas = new Map<string, EntradaDaTarefaOta["regua"]>();
  for (const c of candidatas) {
    const a = acompanhamentos.get(c.id) ?? null;
    const ops = operacoes.filter((x) => x.reservaId === c.id);
    const beds24Id = c.beds24Id ?? ops.find((x) => x.beds24Id)?.beds24Id ?? null;
    const ativa = ops.some((x) => ativas.includes(x.situacao));
    const emCurso = a?.situacao === "em_envio" || ops.some((x) => x.situacao === "enviando" || x.situacao === "incerta" || (ativas.includes(x.situacao) && x.enviadoEm !== null && x.beds24Id === null));
    const entrada: EntradaDaTarefaOta = {
      fato: c.fato,
      criada: criadaPeloM83(a ? { quarto: a.roomId } : null, beds24Id),
      acompanhamento: a ? { situacao: a.situacao, motivo: a.motivo, otaFechadaEm: a.otaFechadaEm } : null,
      emCurso,
      desligada: motivosDesligada(env, { pausada: config.pausado !== null, imovelLigado: ligacaoDoImovel(config, c.imovelId) !== null, comAcompanhamento: true }),
      regua: reguas.get(c.id) ?? null,
      desde: c.desde,
      agora,
    };
    let k = classificarTarefa(entrada);
    if (k.tipo === "regua") {
      const l = await lerReservaParaBeds24(db, org, c.id, { agora, config });
      const d = l ? reservaDoSiteParaBeds24(l.reserva, l.contexto) : null;
      const regua = d && ((d.decisao === "enviar" && d.acao === "criar") || (d.decisao === "fora" && d.motivo === "sem_mudanca")) ? "criar" : d?.decisao === "fora" && d.motivo === "ja_no_beds24" ? "ja_no_beds24" : "outra";
      reguas.set(c.id, regua);
      k = classificarTarefa({ ...entrada, regua });
    }
    if (k.tipo === "atencao") {
      if (!atencoes.has(c.id)) atencoes.set(c.id, { reservaId: c.id, codigo: c.codigo, tipo: k.atencao });
      continue;
    }
    if (k.tipo !== "tarefa") continue;
    const marca = k.estado === "manual" && !ativa ? (k.caso === "paga" || k.caso === "d3" ? "datas_fechadas" : k.caso === "d3_cancelada" ? "datas_reabertas" : null) : null;
    const base = { reservaId: c.id, codigo: c.codigo, caso: k.caso, checkin: c.checkin, checkout: c.checkout };
    tarefas.push({ ...base, estado: k.estado, desde: c.desde, alteracaoIds: c.alteracaoIds, texto: textoDaTarefa(base), marca });
  }
  // A atenção de uma reserva tira todas as tarefas dela (nunca uma instrução contrária para a mesma reserva). A criação que o
  // sistema está enviando leva as datas de agora: a alteração dela não é outra tarefa.
  const criandoAgora = new Set(tarefas.filter((t) => t.caso === "paga" && t.estado !== "manual").map((t) => t.reservaId));
  const lista = tarefas
    .filter((t) => !atencoes.has(t.reservaId) && !((t.caso === "alterada_bloqueio" || t.caso === "alterada_criada") && criandoAgora.has(t.reservaId)))
    .sort((x, y) => x.codigo.localeCompare(y.codigo) || ORDEM_DOS_CASOS.indexOf(x.caso) - ORDEM_DOS_CASOS.indexOf(y.caso));
  const linhas = [...atencoes.values()].sort((x, y) => x.codigo.localeCompare(y.codigo));
  return { tarefas: lista, atencoes: linhas, avisos: avisosDasTarefas(lista, linhas) };
}

// ---------------------------------------------------------------- as marcas manuais (D8, desenho 6.4; D3 cancelada)

export type ResultadoMarcaOta = { ok: true } | { ok: false; erro: string };

export const ERRO_MARCA_TRAVA_OCUPADA = "Há uma importação ou um envio do Beds24 em andamento. Aguarde alguns minutos e tente de novo.";
export const ERRO_MARCA_EM_ENVIO = "O sistema está enviando esta reserva ao Beds24 (ou há um envio dela sem conclusão): espere a conferência e tente de novo.";
export const ERRO_NADA_A_FECHAR = "Esta reserva não tem datas a fechar à mão nas OTAs agora.";
export const ERRO_NADA_A_REABRIR = "Esta reserva não tem datas a reabrir à mão nas OTAs agora.";
const ERRO_NAO_ENCONTRADA = "Reserva do site não encontrada.";
const ERRO_JA_FECHADAS = "As datas já foram marcadas como fechadas.";
const ERRO_JA_REABERTAS = "As datas já foram marcadas como reabertas nas OTAs.";

/**
 * Trava e confere a reserva para uma marca manual (desenho 3.6): `reserva:editar` (deny-by-default), a trava `beds24:<org>`
 * (ocupada = recusa, sem esperar), depois o imóvel, a reserva e o acompanhamento, e a tarefa dela relida já com as travas.
 */
async function comAReservaTravada(
  db: Db,
  sessao: Sessao,
  reservaId: string,
  env: NodeJS.ProcessEnv,
  agora: Date,
  f: (tx: Db, t: NonNullable<Awaited<ReturnType<typeof travarReservaDoSite>>>, tarefas: TarefaOta[]) => Promise<ResultadoMarcaOta>,
): Promise<ResultadoMarcaOta> {
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  if (!uuidValido(reservaId)) return { ok: false, erro: ERRO_NAO_ENCONTRADA };
  const org = sessao.organizacaoId;
  return db.transaction(async (tx) => {
    if (!(await tentarTravaBeds24(tx, org))) return { ok: false, erro: ERRO_MARCA_TRAVA_OCUPADA };
    const t = await travarReservaDoSite(tx, org, reservaId, "no key update");
    if (!t) return { ok: false, erro: ERRO_NAO_ENCONTRADA };
    return f(tx, t, (await tarefasDasOtas(tx, org, agora, env, { reservaIds: [reservaId] })).tarefas);
  });
}

/**
 * "Datas fechadas nas OTAs" (D8, desenho 6.4), na ficha: a equipe fechou à mão no Beds24, como bloqueio, as datas da reserva
 * paga sem criação pelo sistema ou da D3. Só quando a tarefa dela é a manual de fechar as datas, sem operação ativa: recusa
 * o pedido, a cancelada, a estadia que já passou, a criada pelo sistema, o acompanhamento `conferida`, o conflito, a
 * divergência, o aguardando a equipe, a carência do envio automático e qualquer envio dela em curso. Grava `ota_fechada_em/por`
 * e põe o acompanhamento em `manual` (sem acompanhamento, cria a linha, sem o quarto: o quarto guardado é o sinal de "criada
 * pelo sistema"). Depois disso a régua nunca cria esta reserva no Beds24 (6.6) e a importação não apaga a marca (a linha
 * manual não tem `esperado`). O motivo fica vazio (`ota_fechada_por` diz que foi à mão), ou o da linha que já era `manual`.
 */
export async function marcarDatasFechadasNasOtas(db: Db, sessao: Sessao, reservaId: string, env: NodeJS.ProcessEnv, agora: Date = new Date()): Promise<ResultadoMarcaOta> {
  return comAReservaTravada(db, sessao, reservaId, env, agora, async (tx, { reserva, acompanhamento: a }, tarefas) => {
    if (a?.otaFechadaEm) return { ok: false, erro: `As datas já foram marcadas como fechadas em ${diaMesNoFuso(a.otaFechadaEm)}.` };
    const tarefa = tarefas.find((x) => x.caso === "paga" || x.caso === "d3");
    if (!tarefa || tarefa.marca !== "datas_fechadas") return { ok: false, erro: tarefa ? ERRO_MARCA_EM_ENVIO : ERRO_NADA_A_FECHAR };
    const marca = { situacao: "manual" as const, otaFechadaEm: agora, otaFechadaPor: sessao.usuarioId, atualizadoEm: agora };
    const [feito] = a
      ? await tx
          .update(beds24ReservasSite)
          .set({ ...marca, motivo: a.situacao === "manual" ? a.motivo : null })
          .where(and(eq(beds24ReservasSite.id, a.id), isNull(beds24ReservasSite.otaFechadaEm)))
          .returning({ id: beds24ReservasSite.id })
      : await tx
          .insert(beds24ReservasSite)
          .values({ organizacaoId: sessao.organizacaoId, reservaId, imovelId: reserva.imovelId, referencia: reserva.codigo, motivo: null, ...marca })
          .onConflictDoNothing({ target: [beds24ReservasSite.organizacaoId, beds24ReservasSite.reservaId] })
          .returning({ id: beds24ReservasSite.id });
    if (!feito) return { ok: false, erro: ERRO_JA_FECHADAS };
    await registrarAuditoria(tx, {
      organizacaoId: sessao.organizacaoId,
      usuarioId: sessao.usuarioId,
      acao: "beds24.reserva.ota_fechada",
      entidade: "reserva",
      entidadeId: reservaId,
      mudancas: { otaFechadaEm: [null, agora.toISOString()], situacaoNoBeds24: [a?.situacao ?? null, "manual"] },
    });
    return { ok: true };
  });
}

/**
 * "Datas reabertas nas OTAs" da D3 cancelada (M8.3b): a reserva do site marcada como fechada à mão e cancelada pelo
 * "Cancelar reserva" comum (sem o cancelamento pela política, que tem a marca própria). A equipe mudou o bloqueio para
 * Cancelado no Beds24; o acompanhamento vai a `encerrada` (motivo vazio) e a tarefa some do Início. As datas do texto são as
 * da reserva agora (as marcadas não são guardadas).
 */
export async function marcarDatasReabertasNasOtas(db: Db, sessao: Sessao, reservaId: string, env: NodeJS.ProcessEnv, agora: Date = new Date()): Promise<ResultadoMarcaOta> {
  return comAReservaTravada(db, sessao, reservaId, env, agora, async (tx, { reserva, acompanhamento: a }, tarefas) => {
    if (a?.situacao === "encerrada" && reserva.estado === "cancelada") return { ok: false, erro: ERRO_JA_REABERTAS };
    const tarefa = tarefas.find((x) => x.caso === "d3_cancelada");
    if (!a || !tarefa || tarefa.marca !== "datas_reabertas") return { ok: false, erro: ERRO_NADA_A_REABRIR };
    const [feito] = await tx
      .update(beds24ReservasSite)
      .set({ situacao: "encerrada", motivo: null, atualizadoEm: agora })
      .where(and(eq(beds24ReservasSite.id, a.id), eq(beds24ReservasSite.situacao, "manual")))
      .returning({ id: beds24ReservasSite.id });
    if (!feito) return { ok: false, erro: ERRO_JA_REABERTAS };
    await registrarAuditoria(tx, {
      organizacaoId: sessao.organizacaoId,
      usuarioId: sessao.usuarioId,
      acao: "beds24.reserva.ota_reaberta",
      entidade: "reserva",
      entidadeId: reservaId,
      mudancas: { situacaoNoBeds24: [a.situacao, "encerrada"] },
    });
    return { ok: true };
  });
}
