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
 * O Início (`avisosDeReservasNoBeds24`), o filtro `?beds24=atencao` e a frase "o sistema faz isso sozinho" chegam aqui no
 * bloco G do M8.3c.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { beds24ReservasOperacoes, beds24ReservasSite, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { avisarEquipePorEmail, type ResultadoAviso } from "@/email/aviso-equipe";
import type { Correio } from "@/email/correio";
import { diaMesBr, FUSO_PADRAO, hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { type CasoDeEmailBeds24, casoDeEmailBeds24, MOTIVOS_DE_EMAIL_BEDS24, type MotivoAcompanhamentoBeds24, SITUACOES_DE_EMAIL_BEDS24, type TipoOperacaoBeds24 } from "./reservas-site-regras";

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
