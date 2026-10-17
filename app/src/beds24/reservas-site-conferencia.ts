/**
 * Reserva paga do site no Beds24 (M8.3c, desenho 4.5): a conferência contínua, que não depende da importação (desligada em
 * produção, desenho 2.4). É o passo 5 da volta da rotina (`cron-reservas.ts`) e só lê o Beds24 (nunca POST):
 * - a cada volta, com acompanhamento `conferida` ou `divergente` de reserva com a saída a partir de hoje (São Paulo): um
 *   GET /bookings com `modifiedFrom` = a última leitura que concluiu menos 15 min (na primeira vez, agora menos 24 h), as
 *   propriedades desses acompanhamentos, todas as situações e os info items. Pega a mudança e o cancelamento feitos por fora;
 * - de hora em hora, a releitura por id (`relerPorIds`, a mesma da importação, em lotes de 50) dos que não voltaram nessa
 *   leitura: pega a reserva apagada, que não aparece em `modifiedFrom`. Também quando a última leitura que concluiu tem mais
 *   de 24 h (ou nunca houve): a janela de `modifiedFrom` não volta além disso, e a releitura cobre o resto.
 * Cada registro ligado vai à mesma regra da importação (`conferirNaImportacao`), mais a saída do `divergente` que voltou a
 * bater, que é do M8.3c (`conferirReservaLigada`: a camada dona da situação `conferida`, desenho 5.2). O id que não voltou
 * numa releitura limpa só conclui "apagada no Beds24" com a credencial guardada igual à de agora e o quarto acessível em BRL
 * (`podeConcluirApagada`, a regra do trabalhador); senão (o token trocado para outra conta, o imóvel sem acesso: todos os ids
 * deixam de voltar), `aguardando_equipe`/`sem_permissao`, sem mexer nas datas fechadas. As proteções da importação valem: o
 * id repetido para tudo; o registro ilegível e o sem dono não concluem (nada muda). As marcas de tempo
 * (`beds24_reservas_rotina`) só avançam quando a leitura conclui.
 * Em três tempos (plano 1.15): a lista do SCL; o Beds24 sem transação aberta, com o prazo da operação; e, por reserva, uma
 * transação curta com a trava `beds24:<org>` (ocupada, a conferência para e fica para a volta seguinte) que revalida antes de
 * gravar. As janelas da importação e do envio diários valem antes de cada leitura e de cada gravação (a trava, ali, faria a
 * importação ou o envio encontrar "ocupada"). O e-mail da divergência sai depois, pela rotina (`reservas-site-avisos.ts`).
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { beds24ReservasOperacoes, beds24ReservasSite, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { FUSO_PADRAO, hojeISO } from "@/lib/datas";
import { type ConferenciaNaImportacao, conferirNaImportacao, travarReservaDoSite } from "./reservas-site";
import { MINIMO_PARA_RESOLVER_MS, type OpcoesDoEnvio, PRAZO_DA_FASE_2_MS, paradaPelaRecusa, podeConcluirApagada } from "./reservas-site-envio";
import { dentroDeJanela, SITUACOES_OPERACAO_ATIVAS, type SituacaoAcompanhamentoBeds24 } from "./reservas-site-regras";
import { avancarConferencia, avancarReleitura, lerEstadoRotina } from "./reservas-site-rotina";
import { relerPorIds, semIdsRepetidos } from "./sincronizacao";
import { ErroBeds24, type LeitorBeds24, type QuartoBeds24, type ReservaBeds24 } from "./tipos";
import { tentarTravaBeds24 } from "./trava";

const acomp = beds24ReservasSite;
const op = beds24ReservasOperacoes;

/** A leitura por `modifiedFrom` volta 15 min antes da última que concluiu (o relógio do Beds24 e o nosso não batem ao segundo). */
export const FOLGA_DA_CONFERENCIA_MS = 15 * 60_000;
/** Sem leitura que concluiu (ou com ela mais velha que isto), a janela de `modifiedFrom` é de 24 h, e a releitura por id roda. */
export const JANELA_MAXIMA_DA_CONFERENCIA_MS = 24 * 3_600_000;
/** A releitura por id roda de hora em hora. */
export const INTERVALO_DA_RELEITURA_MS = 3_600_000;

/** As situações que a conferência contínua acompanha: a reserva já está no Beds24 como o SCL quer, ou diferente por fora. */
const ACOMPANHADAS: readonly SituacaoAcompanhamentoBeds24[] = ["conferida", "divergente"];
/** Um id do Beds24 só com os caracteres esperados (o resto nunca vai num pedido). */
const idSeguro = (s: string) => /^[A-Za-z0-9._:-]{1,64}$/.test(s);

/**
 * O que a conferência de um registro ligado deixou: o resultado da regra da importação, ou a saída do `divergente` que voltou
 * a bater (`voltou`), ou nada (`descartada`: a reserva mudou de id ou perdeu o acompanhamento entre a leitura e a trava).
 */
export type ConferenciaDaReservaLigada = ConferenciaNaImportacao | { resultado: "voltou" } | { resultado: "descartada" };

/**
 * A conferência de uma reserva do site com o registro ligado a ela (`registro` null = não voltou numa releitura limpa:
 * apagada), na transação de quem chama, que já tem a trava `beds24:<org>`. A regra é a da importação (`conferirNaImportacao`,
 * que nunca muda a reserva), depois de revalidar sob a trava que o id ainda é o desta reserva. O M8.3c acrescenta a saída do
 * `divergente` (plano 1.11): com a leitura igual ao `esperado`, a marca desta reserva, nenhuma operação ativa nem `feita` e a
 * assinatura do SCL igual à do `esperado` (o `igual` com `conferida` da importação), a reserva confirmada volta a `conferida`,
 * com o motivo nulo, a auditoria (`beds24.reserva.conferir`, autor nulo: o sistema) e a marca das datas fechadas nas OTAs
 * (`ota_fechada_em` = agora, `por` nulo) quando a divergência a tinha limpado. Sem isso, os consertos do desenho ("No Beds24,
 * volte-a para Confirmado", repor o info code) não levariam a nada: a atualização ficaria suspensa e uma `marca_ilegivel`
 * pararia as criações da empresa para sempre. A mesma função na conferência contínua e em "Conferir agora".
 */
export async function conferirReservaLigada(tx: Db, org: string, reservaId: string, beds24Id: string, registro: ReservaBeds24 | null, agora: Date): Promise<ConferenciaDaReservaLigada> {
  const t = await travarReservaDoSite(tx, org, reservaId, "no key update");
  if (!t?.acompanhamento || t.reserva.beds24Id !== beds24Id || (registro && registro.idExterno !== beds24Id)) return { resultado: "descartada" };
  const antes = t.acompanhamento;
  const c = await conferirNaImportacao(tx, org, reservaId, registro, agora);
  if (c.resultado !== "igual" || !c.conferida || antes.situacao !== "divergente" || t.reserva.estado !== "confirmada") return c;
  // `conferida` já diz que não há operação ativa; a `feita` (a criação adotada que o passo 1 ainda termina) também espera.
  const [emCurso] = await tx
    .select({ id: op.id })
    .from(op)
    .where(and(eq(op.organizacaoId, org), eq(op.reservaId, reservaId), inArray(op.situacao, [...SITUACOES_OPERACAO_ATIVAS, "feita"])))
    .limit(1);
  if (emCurso) return c;
  await tx
    .update(acomp)
    .set({ situacao: "conferida", motivo: null, ...(antes.otaFechadaEm ? {} : { otaFechadaEm: agora, otaFechadaPor: null }), atualizadoEm: agora })
    .where(and(eq(acomp.id, antes.id), eq(acomp.situacao, "divergente")));
  await registrarAuditoria(tx, {
    organizacaoId: org, usuarioId: null, acao: "beds24.reserva.conferir", entidade: "reserva", entidadeId: reservaId,
    mudancas: { situacaoNoBeds24: ["divergente", "conferida"], motivoNoBeds24: [antes.motivo, null], ...(antes.otaFechadaEm ? {} : { otaFechadaPeloSistema: [false, true] }) },
  });
  return { resultado: "voltou" };
}

/**
 * O id ligado não voltou numa releitura limpa, mas a credencial de agora não é a da criação (ou o quarto não está acessível
 * em BRL): não dá para concluir "apagada" (todos os ids sumiriam com a troca do token para outra conta). A equipe confere a
 * credencial: `aguardando_equipe`/`sem_permissao`, sem mexer nas datas fechadas nem na leitura guardada. Revalida sob a trava
 * (o id, a situação acompanhada, nenhuma operação em curso e nenhuma leitura mais nova); false = nada mudou.
 */
async function semAcessoNaConferencia(tx: Db, org: string, reservaId: string, beds24Id: string, agora: Date): Promise<boolean> {
  const t = await travarReservaDoSite(tx, org, reservaId, "no key update");
  const a = t?.acompanhamento;
  if (!t || !a || t.reserva.beds24Id !== beds24Id || !ACOMPANHADAS.includes(a.situacao) || (a.lidoEm && a.lidoEm.getTime() > agora.getTime())) return false;
  const [emCurso] = await tx
    .select({ id: op.id })
    .from(op)
    .where(and(eq(op.organizacaoId, org), eq(op.reservaId, reservaId), inArray(op.situacao, [...SITUACOES_OPERACAO_ATIVAS, "feita"])))
    .limit(1);
  if (emCurso) return false;
  await tx.update(acomp).set({ situacao: "aguardando_equipe", motivo: "sem_permissao", atualizadoEm: agora }).where(eq(acomp.id, a.id));
  return true;
}

/** Por que a conferência não terminou: a recusa do Beds24 (429, 401, 403), a leitura que falhou, a trava ocupada, o tempo ou a janela. */
export type ParadaDaConferenciaBeds24 = "limite" | "sem_permissao" | "falhou" | "trava" | "tempo" | "janela";

/** Os números da conferência contínua (o resumo da rotina, só números e códigos). */
export type ResultadoDaConferenciaBeds24 = {
  /** Registros do Beds24 conferidos com a reserva ligada (pela leitura por `modifiedFrom` e pela releitura por id). */
  conferidos: number;
  /** O `divergente` que voltou a bater: `conferida` de novo. */
  voltaram: number;
  /** As transições para `divergente` (mudada, cancelada ou apagada no Beds24, a marca ilegível) e para a equipe (sem acesso). */
  avisos: number;
  /** As reservas que a leitura não deixou concluir (o registro ilegível, a releitura com registro sem dono): nada mudou. */
  semConclusao: number;
  /** A releitura por id rodou nesta volta e concluiu. */
  releitura: boolean;
  parada: ParadaDaConferenciaBeds24 | null;
  /** Na parada `falhou`: o tipo da falha da leitura (para o aviso da rotina ao Sentry, só o tipo). */
  falha?: ErroBeds24["tipo"] | "erro_inesperado";
};

/** Uma reserva acompanhada: o id ligado e o que o acompanhamento guardou da criação (o quarto e a credencial). */
type Alvo = { reservaId: string; beds24Id: string; situacao: SituacaoAcompanhamentoBeds24; propertyId: string | null; roomId: string | null; credencial: string };

/** As reservas do site acompanhadas (`conferida` ou `divergente`, com o id no Beds24 e a saída a partir de hoje): só leitura do SCL. */
async function alvosDaConferencia(db: Db, org: string, agora: Date): Promise<Alvo[]> {
  const hoje = hojeISO(FUSO_PADRAO, agora);
  const linhas = await db
    .select({ reservaId: reservas.id, beds24Id: reservas.beds24Id, situacao: acomp.situacao, propertyId: acomp.propertyId, roomId: acomp.roomId, credencial: acomp.credencial })
    .from(acomp)
    .innerJoin(reservas, and(eq(reservas.id, acomp.reservaId), eq(reservas.organizacaoId, org)))
    .where(and(eq(acomp.organizacaoId, org), eq(reservas.fonte, "site"), inArray(acomp.situacao, [...ACOMPANHADAS]), isNotNull(reservas.beds24Id), sql`${reservas.checkout} >= ${hoje}`))
    .orderBy(reservas.checkin, reservas.codigo);
  return linhas.filter((l): l is Alvo => l.beds24Id !== null && idSeguro(l.beds24Id));
}

/** O que o segundo tempo leu do Beds24 para cada alvo. */
type Leitura =
  | { tipo: "registro"; registro: ReservaBeds24 }
  /** Não voltou numa releitura limpa (sem registro sem dono, com os quartos lidos). */
  | { tipo: "nao_voltou"; podeConcluirApagada: boolean }
  /** Voltou ilegível, ou não voltou numa releitura com registro sem dono: nada muda. */
  | { tipo: "sem_conclusao" };

/**
 * O passo 5 da volta (desenho 4.5 e 9): a leitura por `modifiedFrom` a cada volta e a releitura por id de hora em hora, com o
 * leitor injetado (obrigatório) e o prazo da operação no `fetch` (como a fase 2). Para no primeiro 429, 401 ou 403. Sem
 * reserva acompanhada, não lê nada.
 */
export async function conferirContinuamente(db: Db, org: string, leitor: LeitorBeds24, o: Pick<OpcoesDoEnvio, "env" | "relogio" | "prazoDaOperacao">): Promise<ResultadoDaConferenciaBeds24> {
  const r: ResultadoDaConferenciaBeds24 = { conferidos: 0, voltaram: 0, avisos: 0, semConclusao: 0, releitura: false, parada: null };
  const agora = o.relogio.agora();
  const alvos = await alvosDaConferencia(db, org, agora);
  if (!alvos.length) return r;
  if (o.relogio.restanteMs() < MINIMO_PARA_RESOLVER_MS) return { ...r, parada: "tempo" };
  if (dentroDeJanela(agora)) return { ...r, parada: "janela" };
  const estado = await lerEstadoRotina(db, org);
  const recente = estado.conferenciaEm && agora.getTime() - estado.conferenciaEm.getTime() < JANELA_MAXIMA_DA_CONFERENCIA_MS ? estado.conferenciaEm : null;
  const desde = new Date(recente ? recente.getTime() - FOLGA_DA_CONFERENCIA_MS : agora.getTime() - JANELA_MAXIMA_DA_CONFERENCIA_MS);
  const releituraDevida = !recente || !estado.releituraEm || agora.getTime() - estado.releituraEm.getTime() >= INTERVALO_DA_RELEITURA_MS;

  // Segundo tempo: o Beds24, sem transação aberta, com o prazo da operação (as leituras em série não passam dele).
  const leituras = new Map<string, Leitura>();
  o.prazoDaOperacao?.(AbortSignal.timeout(Math.max(1, Math.min(PRAZO_DA_FASE_2_MS, o.relogio.restanteMs()))));
  try {
    // As propriedades guardadas na criação (sem nenhuma, o pedido sem filtro leria a conta inteira: só a releitura por id).
    const propertyIds = [...new Set(alvos.map((a) => a.propertyId).filter((p): p is string => p !== null && idSeguro(p)))];
    const lote = propertyIds.length ? await leitor.reservas({ modificadasDesde: desde.toISOString(), propertyIds, incluirInfo: true }) : { itens: [], divergencias: [], lidoEm: agora.toISOString() };
    semIdsRepetidos(lote);
    const porId = new Map(lote.itens.map((b) => [b.idExterno, b]));
    const ilegiveis = new Set(lote.divergencias.map((d) => d.id));
    for (const a of alvos) {
      const b = porId.get(a.beds24Id);
      if (b) leituras.set(a.beds24Id, { tipo: "registro", registro: b });
      else if (ilegiveis.has(a.beds24Id)) leituras.set(a.beds24Id, { tipo: "sem_conclusao" });
    }
    if (releituraDevida) {
      // Os que não voltaram acima, como a importação (o que já voltou legível não é pedido de novo: se voltar, é o mesmo id
      // duas vezes, e a consulta toda para). O que voltou ilegível fica sem conclusão nesta volta, mesmo que outra leitura o
      // trouxesse legível (qual cópia vale?), e não é pedido de novo.
      const faltantes = [...new Set(alvos.filter((a) => !porId.has(a.beds24Id) && !ilegiveis.has(a.beds24Id)).map((a) => a.beds24Id))];
      const relida = await relerPorIds(leitor, faltantes, new Set(porId.keys()));
      for (const b of relida.legiveis) leituras.set(b.idExterno, { tipo: "registro", registro: b });
      for (const id of relida.ilegiveis) leituras.set(id, { tipo: "sem_conclusao" });
      // O id que não voltou só é lido como "não voltou" sem registro sem dono (ele pode ser o que voltou), e com os quartos
      // lidos nesta volta (a credencial de agora acessa o quarto guardado).
      const naoVoltaram = faltantes.filter((id) => !leituras.has(id));
      let quartos: QuartoBeds24[] | null = null;
      if (naoVoltaram.length && !relida.semDono) quartos = (await leitor.quartos()).itens;
      for (const id of naoVoltaram) {
        const a = alvos.find((x) => x.beds24Id === id)!;
        const guardado = quartos && a.propertyId && a.roomId ? { propertyId: a.propertyId, quarto: a.roomId, credencialGuardada: a.credencial } : null;
        leituras.set(id, guardado ? { tipo: "nao_voltou", podeConcluirApagada: podeConcluirApagada(quartos!, guardado, o.env) } : { tipo: "sem_conclusao" });
      }
      r.releitura = !relida.semDono;
    }
  } catch (e) {
    // O id repetido, a recusa e a falha da leitura: nada é aplicado, e as marcas de tempo não avançam.
    const recusa = paradaPelaRecusa(e instanceof ErroBeds24 ? e.status : undefined);
    return { ...r, releitura: false, ...(recusa ? { parada: recusa } : { parada: "falhou", falha: e instanceof ErroBeds24 ? e.tipo : "erro_inesperado" }) };
  } finally {
    o.prazoDaOperacao?.(null);
  }

  // Terceiro tempo: por reserva, uma transação curta com a trava, que revalida antes de gravar. A parada no meio (a janela, a
  // trava ocupada) deixa as marcas de tempo onde estavam: a volta seguinte lê de novo o mesmo trecho.
  for (const a of alvos) {
    const l = leituras.get(a.beds24Id);
    if (!l) continue;
    if (l.tipo === "sem_conclusao") {
      r.semConclusao++;
      continue;
    }
    if (dentroDeJanela(o.relogio.agora())) return { ...r, releitura: false, parada: "janela" };
    const gravou = await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '15s'`);
      if (!(await tentarTravaBeds24(tx, org))) return null;
      if (l.tipo === "nao_voltou" && !l.podeConcluirApagada) return (await semAcessoNaConferencia(tx, org, a.reservaId, a.beds24Id, agora)) ? "sem_acesso" : "nada";
      return (await conferirReservaLigada(tx, org, a.reservaId, a.beds24Id, l.tipo === "registro" ? l.registro : null, agora)).resultado;
    });
    if (gravou === null) return { ...r, releitura: false, parada: "trava" };
    if (gravou === "descartada" || gravou === "nada") continue;
    r.conferidos++;
    if (gravou === "voltou") r.voltaram++;
    else if (gravou === "sem_acesso" || (gravou === "divergente" && a.situacao !== "divergente")) r.avisos++;
  }

  // A leitura concluiu, e as gravações também: as marcas de tempo avançam até o instante da leitura. A de `modifiedFrom` cobre
  // desde a última que concluiu; sem ela recente, só a releitura por id que concluiu cobre o que veio antes das 24 h.
  if (r.releitura) await avancarReleitura(db, org, agora);
  if (recente || r.releitura) await avancarConferencia(db, org, agora);
  return r;
}
