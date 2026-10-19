/**
 * Reserva paga do site no Beds24 (M8.3c, desenho 6.5): o e-mail à equipe. Os casos e a transição que pede e-mail são de
 * `casoDeEmailBeds24` (`reservas-site-regras.ts`, uma regra, um lugar): o conflito ("Possível venda dupla"), o overbooking
 * informado depois de uma escrita certa, a divergência (apagada, mudada ou cancelada no Beds24), a recusa do POST, as 5
 * falhas e a marca ilegível.
 * - Quando sai: SEMPRE depois do commit da fase 3, nunca de dentro de uma transação (o e-mail é rede). A fase 3 só zera
 *   `avisada_em` na transição; a rotina (e o botão, depois do commit dele) manda e grava `avisada_em` com
 *   `where avisada_em is null`. `falhou` deixa vazio, e a volta seguinte tenta de novo com a mesma chave
 *   (`beds24-reserva:<reservaId>:<motivo>:<assinatura>`, a idempotência do provedor); `sem-email` e `sem-correio` gravam:
 *   o Início continua mostrando a atenção.
 * - O texto leva só o código SCL, o código do imóvel e as datas: nunca nome, e-mail, telefone, documento nem valor. Vai só ao
 *   endereço da empresa (Configurações → Empresa); o hóspede e o proprietário nunca o recebem.
 * O Início e o filtro (bloco G; desenho 6.5, plano 1.14): `avisosDeReservasNoBeds24` põe numa ordem só as linhas de atenção
 * (lidas direto do acompanhamento, e das tarefas das OTAs), a linha única de configuração e as tarefas à mão e informativas de
 * `tarefasDasOtas`, uma linha por reserva; `reservasComAtencaoNoBeds24` sai da mesma leitura (o filtro `?beds24=atencao` da
 * lista de reservas mostra as mesmas reservas do aviso).
 */
import { and, asc, desc, eq, exists, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alteracoesReserva, beds24ReservasOperacoes, beds24ReservasSite, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { avisarEquipePorEmail, type ResultadoAviso } from "@/email/aviso-equipe";
import type { Correio } from "@/email/correio";
import { diaMesBr, FUSO_PADRAO, hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { ambienteDeEscritaDeReservas, escritaReservasBeds24Ligada } from "./http";
import { envioAutomaticoLigado, lerConfigReservasBeds24 } from "./reservas-site-config";
import { type CasoDeEmailBeds24, casoDeEmailBeds24, MOTIVOS_DE_EMAIL_BEDS24, type MotivoAcompanhamentoBeds24, SITUACOES_DE_EMAIL_BEDS24, type SituacaoAcompanhamentoBeds24, type TipoOperacaoBeds24 } from "./reservas-site-regras";
import { estadoDaConfiguracaoDasReservas, motivoDeConfiguracaoDasReservas, textoDaConfiguracaoDasReservas } from "./reservas-site-rotina";
import { avisosDasTarefas, type AvisoTarefaOta, codigosDoAviso, fraseDoEnvioAutomatico, type LinhaAtencaoOta, porReserva, type TarefaOta, tarefasDasOtas } from "./reservas-site-tarefas";

const acomp = beds24ReservasSite;
const op = beds24ReservasOperacoes;

/**
 * A chave do e-mail (desenho 6.5): a mesma transição dá a mesma chave, e o provedor ignora o segundo envio. A assinatura é a
 * da intenção guardada (`assinatura_esperada`): o mesmo motivo numa intenção nova é outro aviso.
 */
export const chaveDoEmailBeds24 = (reservaId: string, motivo: MotivoAcompanhamentoBeds24, assinatura: string | null) => `beds24-reserva:${reservaId}:${motivo}:${assinatura ?? "sem-intencao"}`;

type Datas = { chegada: string; saida: string };

/** O que o texto leva: só o código SCL, o código do imóvel e as datas (nada do hóspede nem valor). */
export type DadosDoEmailBeds24 = {
  caso: CasoDeEmailBeds24;
  motivo: MotivoAcompanhamentoBeds24;
  codigo: string;
  imovel: string;
  /** As datas que o SCL quer no Beds24 (o `esperado`; sem ele, as da reserva). */
  scl: Datas;
  /** As datas lidas no Beds24 (a última leitura); null = não lidas, ou o registro não voltou. */
  beds24: Datas | null;
  /**
   * O tipo da última operação (M8.3c, bloco D): no conflito de uma atualização (as noites novas vendidas no meio, desenho 4.2),
   * a reserva já está no Beds24 e o que não saiu foram as datas novas — nunca "o sistema não criou nada". Sem ele, a criação.
   */
  acao?: TipoOperacaoBeds24 | null;
};

const de = (d: Datas) => `de ${diaMesBr(d.chegada)} a ${diaMesBr(d.saida)}`;
const VEJA_A_FICHA = "Veja a ficha da reserva no painel (Reservas).";

/**
 * O texto de cada caso (puro). Os modelos são o da 4.1 ("Possível venda dupla…"), o da seção 5 ("A reserva SCL-XXXXXX
 * (paga pelo site) foi cancelada no Beds24…" e "No Beds24 está de dd/mm a dd/mm; no SCL, de dd/mm a dd/mm") e o do
 * overbooking (plano, P26), que nunca diz "o sistema não criou nada": a reserva que o sistema criou está certa.
 */
export function emailDeReservaNoBeds24(d: DadosDoEmailBeds24): { assunto: string; texto: string } {
  const r = `${d.codigo} (paga pelo site, imóvel ${d.imovel})`;
  const linha = (assunto: string, texto: string) => ({ assunto, texto: `${texto} ${VEJA_A_FICHA}\n` });
  switch (d.caso) {
    case "conflito":
      // Na atualização, só as noites novas estão ocupadas (as outras são da própria reserva): o texto fala da mudança.
      return d.acao === "atualizar"
        ? linha(`Possível venda dupla: reserva ${d.codigo}`, `Possível venda dupla: a mudança da reserva ${r} para ${de(d.scl)} encontrou noites novas ocupadas por outra reserva no Beds24. O sistema não mudou as datas da reserva no Beds24. Resolva com o hóspede ou com o canal.`)
        : linha(`Possível venda dupla: reserva ${d.codigo}`, `Possível venda dupla: as noites ${de(d.scl)} da reserva ${r} estão ocupadas por outra reserva no Beds24. O sistema não criou nada. Resolva com o hóspede ou com o canal.`);
    case "overbooking":
      return linha(`Overbooking no Beds24: reserva ${d.codigo}`, `O Beds24 informa overbooking nas noites ${de(d.scl)} da reserva ${r}, que o sistema criou: resolva com o hóspede ou com o canal.`);
    case "divergencia":
      if (d.motivo === "cancelada_no_beds24") {
        return linha(`Reserva ${d.codigo} cancelada no Beds24`, `A reserva ${r} foi cancelada no Beds24, mas continua confirmada no SCL: as datas podem estar abertas nas OTAs. No Beds24, volte-a para Confirmado ou cancele pelo SCL, pela política.`);
      }
      if (d.motivo === "apagada_no_beds24") {
        return linha(`Reserva ${d.codigo} não está mais no Beds24`, `A reserva ${r} não voltou na leitura do Beds24 (apagada?): as noites ${de(d.scl)} podem estar abertas nas OTAs. O SCL não mudou nada.`);
      }
      return linha(`Reserva ${d.codigo} diferente no Beds24`, `A reserva ${r} está diferente no Beds24${d.beds24 ? `: no Beds24 está ${de(d.beds24)}; no SCL, ${de(d.scl)}` : ""}. O SCL não seguiu a mudança.`);
    case "recusada":
      if (d.motivo === "sem_disponibilidade") return linha(`Beds24 recusou a reserva ${d.codigo}`, `O Beds24 recusou a reserva ${r}, ${de(d.scl)}, por falta de disponibilidade nas datas. O sistema não tenta de novo sozinho.`);
      if (d.motivo === "sem_permissao") return linha(`Beds24 recusou a credencial: reserva ${d.codigo}`, `O Beds24 recusou o envio da reserva ${r}, ${de(d.scl)}: a credencial não tem permissão de escrever reservas. Confira a credencial em Integrações; o sistema não tenta de novo sozinho.`);
      return linha(`Beds24 recusou a reserva ${d.codigo}`, `O Beds24 recusou o envio da reserva ${r}, ${de(d.scl)}. O sistema não tenta de novo sozinho.`);
    case "falhas":
      return linha(`Envio ao Beds24 parado: reserva ${d.codigo}`, `O envio da reserva ${r}, ${de(d.scl)}, ao Beds24 falhou 5 vezes seguidas antes de sair: nada foi gravado lá. Na ficha, "Tentar de novo" envia na volta seguinte.`);
    case "marca_ilegivel":
      return linha(`Reserva ${d.codigo} sem a marca do SCL no Beds24`, `A reserva ${r}, ${de(d.scl)}, voltou do Beds24 sem a marca do SCL (o código da reserva nos info items). As reservas novas do site param de ser criadas no Beds24 até a marca voltar: confira o registro e as regras automáticas (Auto Actions) que apagam info codes.`);
  }
}

/**
 * Manda o e-mail da reserva quando a situação de agora pede (`casoDeEmailBeds24`, com a última operação real dela, para a
 * recusa) e ele ainda não saiu (`avisada_em` vazio). Fora de qualquer transação: quem chama já fez o commit da fase 3. Grava
 * `avisada_em` só se a linha continua na mesma situação e no mesmo motivo (uma transição nova no meio pede o e-mail dela) e
 * não com `falhou`. null = nada a avisar.
 */
export async function avisarEquipeDeReservaNoBeds24(db: Db, org: string, reservaId: string, correio: Correio | null, agora: Date): Promise<ResultadoAviso | null> {
  if (!uuidValido(reservaId)) return null;
  const [l] = await db
    .select({
      id: acomp.id, situacao: acomp.situacao, motivo: acomp.motivo, avisadaEm: acomp.avisadaEm, assinatura: acomp.assinaturaEsperada, esperado: acomp.esperado, lido: acomp.lido,
      codigo: reservas.codigo, checkin: reservas.checkin, checkout: reservas.checkout, imovel: imoveis.codigo,
    })
    .from(acomp)
    .innerJoin(reservas, and(eq(reservas.id, acomp.reservaId), eq(reservas.organizacaoId, org)))
    .innerJoin(imoveis, and(eq(imoveis.id, reservas.imovelId), eq(imoveis.organizacaoId, org)))
    .where(and(eq(acomp.organizacaoId, org), eq(acomp.reservaId, reservaId)));
  if (!l || l.avisadaEm || !l.motivo) return null;
  const [ultima] = await db
    .select({ situacao: op.situacao, tipo: op.tipo })
    .from(op)
    .where(and(eq(op.organizacaoId, org), eq(op.reservaId, reservaId), eq(op.modo, "real")))
    .orderBy(desc(op.iniciadoEm), desc(op.chave))
    .limit(1);
  const caso = casoDeEmailBeds24(l.situacao, l.motivo, ultima?.situacao ?? null);
  if (!caso) return null;
  const m = emailDeReservaNoBeds24({
    caso, motivo: l.motivo, codigo: l.codigo, imovel: l.imovel, acao: ultima?.tipo ?? null,
    scl: l.esperado ? { chegada: l.esperado.chegada, saida: l.esperado.saida } : { chegada: l.checkin, saida: l.checkout },
    beds24: l.lido ? { chegada: l.lido.chegada, saida: l.lido.saida } : null,
  });
  const r = await avisarEquipePorEmail(db, org, correio, { ...m, chave: chaveDoEmailBeds24(reservaId, l.motivo, l.assinatura), rotulo: "reserva do site no Beds24" });
  if (r !== "falhou") {
    await db.update(acomp).set({ avisadaEm: agora }).where(and(eq(acomp.id, l.id), isNull(acomp.avisadaEm), eq(acomp.situacao, l.situacao), eq(acomp.motivo, l.motivo)));
  }
  return r;
}

export type ResultadoDosAvisosBeds24 = { enviados: number; semEnvio: number; falhas: number };

/**
 * A varredura da rotina, depois dos commits da volta: todo acompanhamento com um caso de e-mail ainda não avisado
 * (`avisada_em` vazio), de reserva com a saída a partir de hoje (São Paulo; a estadia que já terminou não pede mais nada).
 * Inclui o que falhou na volta anterior (a mesma chave). Só números no resultado.
 */
export async function avisarEquipeDasReservasNoBeds24(db: Db, org: string, correio: Correio | null, agora: Date): Promise<ResultadoDosAvisosBeds24> {
  const hoje = hojeISO(FUSO_PADRAO, agora);
  const pendentes = await db
    .select({ reservaId: acomp.reservaId })
    .from(acomp)
    .innerJoin(reservas, and(eq(reservas.id, acomp.reservaId), eq(reservas.organizacaoId, org)))
    .where(and(eq(acomp.organizacaoId, org), isNull(acomp.avisadaEm), inArray(acomp.motivo, [...MOTIVOS_DE_EMAIL_BEDS24]), inArray(acomp.situacao, [...SITUACOES_DE_EMAIL_BEDS24]), sql`${reservas.checkout} >= ${hoje}`))
    .orderBy(asc(reservas.checkin), asc(reservas.codigo));
  const r: ResultadoDosAvisosBeds24 = { enviados: 0, semEnvio: 0, falhas: 0 };
  for (const p of pendentes) {
    const x = await avisarEquipeDeReservaNoBeds24(db, org, p.reservaId, correio, agora);
    if (x === "enviado") r.enviados++;
    else if (x === "falhou") r.falhas++;
    else if (x) r.semEnvio++;
  }
  return r;
}

// ---------------------------------------------------------------- o Início e o filtro (desenho 6.5; plano 1.14)

/**
 * O que pede atenção numa reserva (uma por reserva): o conflito (possível venda dupla), o overbooking que o Beds24 informou
 * depois de uma escrita certa (`conferida`/`noites_ocupadas`), a divergência, o aguardando a equipe (com o motivo), a reserva
 * ligada a um registro que o sistema não criou, o bloqueio feito à mão sobre as noites (a transição, 6.6: informativa) e o
 * envio atrasado (mais de 30 minutos).
 */
export type AtencaoNoBeds24 = "conflito" | "overbooking" | "divergente" | "aguardando_equipe" | "ja_no_beds24" | "transicao" | "atrasada";

type LinhaDeAtencao = { reservaId: string; codigo: string; tipo: AtencaoNoBeds24; motivo: MotivoAcompanhamentoBeds24 | null };

/** O que a leitura única do Início e do filtro devolve. */
type LeituraDasAtencoes = {
  atencoes: LinhaDeAtencao[];
  /** As tarefas das OTAs sem as das reservas com atenção (uma linha por reserva). */
  tarefas: TarefaOta[];
  /** Os imóveis com o envio parado por vínculo, quarto ou moeda (`pendente`/`sem_vinculo`), já com a chave ligada no deploy de produção. */
  semVinculo: string[];
  /** A linha única de configuração (`motivoDeConfiguracaoDasReservas`), só com a chave ligada no deploy de produção. */
  configuracao: string | null;
  /** O envio automático vale para todas as reservas atrasadas (a frase da 6.2 na linha delas). */
  atrasadasAutomaticas: boolean;
};

/** A situação do acompanhamento que pede atenção por si (lida direto da tabela), na forma da linha. */
function atencaoDoAcompanhamento(situacao: SituacaoAcompanhamentoBeds24, motivo: MotivoAcompanhamentoBeds24 | null): AtencaoNoBeds24 | null {
  if (situacao === "conflito") return "conflito";
  if (situacao === "conferida") return motivo === "noites_ocupadas" ? "overbooking" : null;
  if (situacao === "divergente") return "divergente";
  if (situacao === "aguardando_equipe") return motivo === "bloqueio_manual" ? "transicao" : "aguardando_equipe";
  return null;
}

/**
 * A leitura única do aviso do Início e do filtro (uma regra, um lugar), só leitura e sem trava:
 * - o acompanhamento DIRETO da tabela — `conflito`, `divergente`, `aguardando_equipe`, o `conferida` com o overbooking e o
 *   `pendente`/`sem_vinculo` (a linha por imóvel) —, de reserva do site com o mesmo corte de data das tarefas das OTAs (a
 *   saída depois de hoje; a confirmada com uma alteração de datas sem a marca, a maior saída a partir de hoje). Sem o corte,
 *   a estadia que já terminou ficaria no Início para sempre. Antes (M8.3b), a atenção só vinha de `tarefasDasOtas`, e a
 *   divergência que mantém as datas fechadas (só as pessoas, ou só a marca) sumia: `classificarTarefa` dá "nada" à paga marcada;
 * - as atenções e as tarefas de `tarefasDasOtas` (a reserva ligada a outro registro e as atrasadas);
 * - uma linha por reserva: uma atenção tira as outras tarefas daquela reserva (nunca uma instrução contrária).
 */
async function lerAtencoesNoBeds24(db: Db, org: string, agora: Date, env: NodeJS.ProcessEnv): Promise<LeituraDasAtencoes> {
  const hoje = hojeISO(FUSO_PADRAO, agora);
  const alt = alteracoesReserva;
  const alteradaPorVir = exists(
    db
      .select({ id: alt.id })
      .from(alt)
      .where(
        and(
          eq(alt.organizacaoId, org),
          eq(alt.reservaId, reservas.id),
          eq(alt.situacao, "aplicada"),
          isNull(alt.otaAtualizadaEm),
          or(ne(alt.checkinAntes, alt.checkinDepois), ne(alt.checkoutAntes, alt.checkoutDepois)),
          sql`greatest(${alt.checkoutAntes}, ${alt.checkoutDepois}) >= ${hoje}::date`,
        ),
      ),
  );
  const linhas = await db
    .select({ reservaId: acomp.reservaId, situacao: acomp.situacao, motivo: acomp.motivo, codigo: reservas.codigo, imovel: imoveis.codigo })
    .from(acomp)
    .innerJoin(reservas, and(eq(reservas.id, acomp.reservaId), eq(reservas.organizacaoId, org)))
    .innerJoin(imoveis, and(eq(imoveis.id, reservas.imovelId), eq(imoveis.organizacaoId, org)))
    .where(
      and(
        eq(acomp.organizacaoId, org),
        eq(reservas.fonte, "site"),
        or(inArray(acomp.situacao, ["conflito", "divergente", "aguardando_equipe"]), and(eq(acomp.situacao, "conferida"), eq(acomp.motivo, "noites_ocupadas")), and(eq(acomp.situacao, "pendente"), eq(acomp.motivo, "sem_vinculo"))),
        or(sql`${reservas.checkout} > ${hoje}`, and(eq(reservas.estado, "confirmada"), alteradaPorVir)),
      ),
    )
    .orderBy(asc(reservas.codigo));
  const { tarefas, atencoes: dasTarefas } = await tarefasDasOtas(db, org, agora, env);
  const porId = new Map<string, LinhaDeAtencao>();
  for (const l of linhas) {
    const tipo = atencaoDoAcompanhamento(l.situacao, l.motivo);
    if (tipo) porId.set(l.reservaId, { reservaId: l.reservaId, codigo: l.codigo, tipo, motivo: l.motivo });
  }
  // As atenções das tarefas (a reserva ligada a outro registro, e qualquer outra que o corte acima não pegou).
  for (const x of dasTarefas) if (!porId.has(x.reservaId)) porId.set(x.reservaId, { reservaId: x.reservaId, codigo: x.codigo, tipo: x.tipo, motivo: null });
  // As atrasadas também são atenção (uma linha agrupada no Início, e entram no filtro).
  const atrasadas = porReserva(tarefas.filter((t) => t.estado === "atrasada" && !porId.has(t.reservaId)));
  const config = await lerConfigReservasBeds24(db, org);
  let atrasadasAutomaticas = atrasadas.length > 0;
  if (atrasadas.length) {
    const imoveisDelas = await db.select({ id: reservas.id, imovelId: reservas.imovelId }).from(reservas).where(and(eq(reservas.organizacaoId, org), inArray(reservas.id, atrasadas.map((t) => t.reservaId))));
    const deCada = new Map(imoveisDelas.map((r) => [r.id, r.imovelId]));
    atrasadasAutomaticas = atrasadas.every((t) => envioAutomaticoLigado(env, config, deCada.get(t.reservaId) ?? ""));
    for (const t of atrasadas) porId.set(t.reservaId, { reservaId: t.reservaId, codigo: t.codigo, tipo: "atrasada", motivo: null });
  }
  // A linha de configuração e a do imóvel parado: só com a chave ligada no deploy de produção (fora dele, ou com a chave
  // desligada, nada é enviado de propósito e as tarefas são à mão).
  const chaveLigada = ambienteDeEscritaDeReservas(env) && escritaReservasBeds24Ligada(env);
  const parada = chaveLigada ? motivoDeConfiguracaoDasReservas(await estadoDaConfiguracaoDasReservas(db, org, env, agora)) : null;
  const semVinculo = chaveLigada ? [...new Set(linhas.filter((l) => l.situacao === "pendente" && l.motivo === "sem_vinculo").map((l) => l.imovel))].sort((a, b) => a.localeCompare(b)) : [];
  const atencoes = [...porId.values()].sort((x, y) => x.codigo.localeCompare(y.codigo));
  return {
    atencoes,
    tarefas: tarefas.filter((t) => !porId.has(t.reservaId)),
    semVinculo,
    configuracao: parada ? textoDaConfiguracaoDasReservas(parada) : null,
    atrasadasAutomaticas,
  };
}

/** A razão do aguardando a equipe no Início, em palavras (o que fazer está na ficha); sem razão própria, nada. */
const RAZAO_NO_INICIO: Partial<Record<MotivoAcompanhamentoBeds24, string>> = {
  falhas: "o envio falhou 5 vezes seguidas",
  incerta: "o envio ficou sem confirmação",
  sem_disponibilidade: "o Beds24 não mostrou as noites livres",
  recusada_pelo_beds24: "o Beds24 recusou o envio",
  sem_permissao: "a credencial não tem permissão de escrever ou ler a reserva",
  duplicada: "há mais de um registro com a marca dela",
  marca_em_registro_inesperado: "a marca dela está num registro que não bate",
  bloqueio_do_scl: "há um bloqueio do próprio SCL sobre as noites",
};
/** A divergência no Início, pelo motivo. */
const DIVERGENCIA_NO_INICIO: Partial<Record<MotivoAcompanhamentoBeds24, string>> = {
  cancelada_no_beds24: "foi cancelada no Beds24 por fora",
  apagada_no_beds24: "não voltou na leitura do Beds24 (apagada?)",
  marca_ilegivel: "voltou do Beds24 sem a marca do SCL",
};

/** O texto de uma linha de atenção por reserva (sem valores: o código SCL e, quando cabe, o motivo em palavras). */
function textoDaAtencao(a: LinhaDeAtencao): string {
  const c = a.codigo;
  switch (a.tipo) {
    case "conflito":
      return `Reserva ${c}: as noites estão ocupadas por outra reserva no Beds24 (possível venda dupla). Veja a ficha.`;
    case "overbooking":
      return `Reserva ${c}: o Beds24 informa overbooking nas noites dela (a reserva que o sistema criou está certa): resolva com o hóspede ou com o canal. Veja a ficha.`;
    case "divergente":
      return `Reserva ${c} ${(a.motivo && DIVERGENCIA_NO_INICIO[a.motivo]) || "está diferente no Beds24"}: veja a ficha.`;
    case "aguardando_equipe": {
      const razao = a.motivo ? RAZAO_NO_INICIO[a.motivo] : undefined;
      return `Reserva ${c} aguarda a equipe no Beds24${razao ? ` (${razao})` : ""}: veja a ficha.`;
    }
    case "ja_no_beds24":
      return `Reserva ${c} está ligada a um registro do Beds24 que o sistema não criou: veja a ficha.`;
    case "transicao":
    case "atrasada":
      return "";
  }
}

const fichaDa = (reservaId: string) => `/painel/reservas/${reservaId}`;
/** A lista das reservas que pedem atenção no Beds24 (o filtro, da mesma leitura). */
export const LINK_DAS_ATENCOES_NO_BEDS24 = "/painel/reservas?beds24=atencao";
const INTEGRACOES = "/painel/configuracoes/integracoes";

/**
 * As linhas do Início das reservas do site no Beds24 (desenho 6.5; plano 1.14), para quem edita reservas, sem valores, nesta
 * ordem:
 * 1. o conflito (possível venda dupla) e o overbooking, um código por linha;
 * 2. a divergência;
 * 3. a linha única "Envio de reservas parado: <motivo>" (`motivoDeConfiguracaoDasReservas`, o mesmo texto de Integrações e do
 *    Sistema) e a do imóvel parado por vínculo, quarto ou moeda — só com a chave ligada no deploy de produção; o link para
 *    Integrações só para quem edita as configurações (`verConfiguracao`; Integrações recusa a operação), e para a operação o
 *    mesmo texto sem link;
 * 4. as falhas, a incerteza, a recusa e o aguardando a equipe (uma por reserva, com o motivo), a reserva ligada a outro
 *    registro e as atrasadas, agrupadas (com a frase da 6.2 quando o envio automático vale para todas elas);
 * 5. as tarefas à mão e 6. os informativos (sendo enviadas e a transição), de `avisosDasTarefas`.
 * Uma linha por reserva. O link da linha de uma reserva leva à ficha (a regra do M8.3b); a linha agrupada de mais de uma, à
 * lista filtrada (`?beds24=atencao`). Todo texto leva um código, uma contagem ou o imóvel (a chave da lista no Início).
 */
export async function avisosDeReservasNoBeds24(db: Db, org: string, agora: Date, env: NodeJS.ProcessEnv, o: { verConfiguracao?: boolean } = {}): Promise<AvisoTarefaOta[]> {
  const l = await lerAtencoesNoBeds24(db, org, agora, env);
  const avisos: AvisoTarefaOta[] = [];
  const porReservaDo = (tipos: readonly AtencaoNoBeds24[]) => {
    for (const tipo of tipos) for (const a of l.atencoes.filter((x) => x.tipo === tipo)) avisos.push({ nivel: "atencao", texto: textoDaAtencao(a), link: fichaDa(a.reservaId) });
  };
  const paraIntegracoes = o.verConfiguracao ? { link: INTEGRACOES } : {};
  porReservaDo(["conflito", "overbooking"]);
  porReservaDo(["divergente"]);
  if (l.configuracao) avisos.push({ nivel: "atencao", texto: `Envio de reservas parado: ${l.configuracao}.`, ...paraIntegracoes });
  for (const imovel of l.semVinculo) {
    avisos.push({ nivel: "atencao", texto: `Envio de reservas parado no imóvel ${imovel}: confira o vínculo com um quarto do Beds24, o acesso da credencial a ele e a moeda (BRL).`, ...paraIntegracoes });
  }
  porReservaDo(["aguardando_equipe", "ja_no_beds24"]);
  const atrasadas = l.atencoes.filter((a) => a.tipo === "atrasada");
  if (atrasadas.length) {
    const frase = fraseDoEnvioAutomatico(l.atrasadasAutomaticas, { estado: "atrasada" });
    avisos.push({
      nivel: "atencao",
      texto: `${atrasadas.length} reserva(s) do site com o envio ao Beds24 atrasado (${codigosDoAviso(atrasadas)}): confira na ficha.${frase ? ` ${frase}` : ""}`,
      link: atrasadas.length === 1 ? fichaDa(atrasadas[0].reservaId) : LINK_DAS_ATENCOES_NO_BEDS24,
    });
  }
  const transicoes: LinhaAtencaoOta[] = l.atencoes.filter((a) => a.tipo === "transicao").map((a) => ({ reservaId: a.reservaId, codigo: a.codigo, tipo: "transicao" }));
  avisos.push(...avisosDasTarefas(l.tarefas, transicoes));
  return avisos;
}

/**
 * As reservas que pedem atenção no Beds24 (o filtro `?beds24=atencao` da lista de reservas; plano 1.14): as mesmas do aviso
 * do Início, da mesma leitura (`lerAtencoesNoBeds24`) — o conflito, o overbooking, a divergência, o aguardando a equipe, a
 * reserva ligada a outro registro, a transição e as atrasadas —, de qualquer situação (a cancelada também). Os ids vão para a
 * lista (`soIds` de `listarReservasPaginadas`): `reservas/` não importa `beds24/`.
 */
export async function reservasComAtencaoNoBeds24(db: Db, org: string, agora: Date, env: NodeJS.ProcessEnv): Promise<string[]> {
  return (await lerAtencoesNoBeds24(db, org, agora, env)).atencoes.map((a) => a.reservaId);
}
