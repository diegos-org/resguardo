/**
 * Aceite das páginas legais do site pelo hóspede (M7.4): antes de gerar o pagamento, o hóspede marca que leu e aceita
 * os Termos de uso e a Política de cancelamento e que leu a Política de privacidade. Fica gravado qual versão de cada
 * um e quando (`aceites_site`), ligado à cotação e à reserva — sem nome, e-mail nem IP: a pessoa é a da reserva, e a
 * autorização é o cookie assinado do pedido, que só quem tem o e-mail obtém.
 *
 * O aceite é da cotação (outro aparelho herda) e vale para as versões aceitas: versão nova publicada pede aceite novo
 * no próximo Pix; um Pix ainda válido continua com o aceite com que foi criado, e a aprovação de um pagamento nunca
 * confere aceite (o dinheiro que chegou não vira "aprovado sem reserva" por isso). A conferência que vale é a da
 * fase 1 do Pix, sob as travas da cotação e, depois delas, as travas compartilhadas dos três documentos.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lerPaginaLegal, versoesLegaisAtuais, versoesLegaisTravadas } from "@/configuracoes/paginas-legais";
import { type Bloco, blocosDoDocumento, DOCUMENTOS_LEGAIS, type DocumentoLegal, prazoDoReembolso, preencherCampos, type RegrasCancelamento, type VersoesLegais } from "@/configuracoes/paginas-legais-texto";
import { travaOcupada } from "@/db/erros";
import { aceitesSite, pagamentos } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { travarCotacao } from "@/pagamentos/travas";

export type OrigemAceite = "pix" | "cartao";
export type AceiteSite = { id: string; versoes: VersoesLegais; aceitoEm: Date; origem: OrigemAceite };

/** Campos escondidos do formulário com a versão de cada documento que a página mostrou. */
export const CAMPOS_VERSAO: Record<DocumentoLegal, string> = { termos: "versaoTermos", privacidade: "versaoPrivacidade", cancelamento: "versaoCancelamento" };

const numeroDeVersao = (v: unknown): number | null => (typeof v === "string" && /^\d{1,6}$/.test(v) && Number(v) > 0 ? Number(v) : null);

/** As versões que o formulário mandou; null se faltar alguma ou vier fora do formato. */
export function versoesDoFormulario(form: FormData): VersoesLegais | null {
  const versoes = {} as VersoesLegais;
  for (const doc of DOCUMENTOS_LEGAIS) {
    const n = numeroDeVersao(form.get(CAMPOS_VERSAO[doc]));
    if (n === null) return null;
    versoes[doc] = n;
  }
  return versoes;
}

const mesmasVersoes = (a: VersoesLegais, b: VersoesLegais) => DOCUMENTOS_LEGAIS.every((doc) => a[doc] === b[doc]);

/** "termos v1, privacidade v1, cancelamento v2 (pix)": o que a auditoria guarda (nada da pessoa). */
const resumoDoAceite = (v: VersoesLegais, origem: OrigemAceite) => `${DOCUMENTOS_LEGAIS.map((doc) => `${doc} v${v[doc]}`).join(", ")} (${origem})`;

type LinhaAceite = typeof aceitesSite.$inferSelect;
const paraAceite = (l: LinhaAceite): AceiteSite => ({
  id: l.id,
  versoes: { termos: l.versaoTermos, privacidade: l.versaoPrivacidade, cancelamento: l.versaoCancelamento },
  aceitoEm: l.aceitoEm,
  origem: l.origem,
});

/** O aceite destas versões nesta cotação, se houver. */
async function aceiteDasVersoes(db: Db, organizacaoId: string, cotacaoId: string, v: VersoesLegais): Promise<AceiteSite | null> {
  const [l] = await db
    .select()
    .from(aceitesSite)
    .where(
      and(
        eq(aceitesSite.organizacaoId, organizacaoId),
        eq(aceitesSite.cotacaoId, cotacaoId),
        eq(aceitesSite.versaoTermos, v.termos),
        eq(aceitesSite.versaoPrivacidade, v.privacidade),
        eq(aceitesSite.versaoCancelamento, v.cancelamento),
      ),
    );
  return l ? paraAceite(l) : null;
}

export type ResultadoAceiteVigente = { ok: true; aceite: AceiteSite } | { ok: false; motivo: "nao_publicadas" | "pendente" | "mudou"; publicadas: VersoesLegais | null };

/**
 * O aceite das versões publicadas agora. Só dentro de uma transação que JÁ travou a cotação (`travarCotacao`): toma as
 * travas compartilhadas dos três documentos (`versoesLegaisTravadas`), na ordem, depois das travas de linha — ninguém
 * publica no meio, e os hóspedes não esperam uns pelos outros. Com `novo` (a caixa marcada): as versões têm de ser as
 * publicadas, senão "mudou"; a gravação é idempotente e só uma linha nova ganha registro na auditoria. Sem `novo`, vale
 * o aceite já gravado das versões publicadas, ou "pendente".
 */
export async function aceiteVigenteTravado(
  tx: Db,
  organizacaoId: string,
  t: { cotacaoId: string; reservaId: string },
  novo: VersoesLegais | null,
  origem: OrigemAceite,
  agora: Date,
): Promise<ResultadoAceiteVigente> {
  const publicadas = await versoesLegaisTravadas(tx, organizacaoId);
  if (!publicadas) return { ok: false, motivo: "nao_publicadas", publicadas: null };
  if (novo) {
    if (!mesmasVersoes(novo, publicadas)) return { ok: false, motivo: "mudou", publicadas };
    const [nova] = await tx
      .insert(aceitesSite)
      .values({
        organizacaoId,
        cotacaoId: t.cotacaoId,
        reservaId: t.reservaId,
        versaoTermos: publicadas.termos,
        versaoPrivacidade: publicadas.privacidade,
        versaoCancelamento: publicadas.cancelamento,
        origem,
        aceitoEm: agora,
      })
      .onConflictDoNothing()
      .returning();
    if (nova) {
      await registrarAuditoria(tx, {
        organizacaoId,
        usuarioId: null,
        acao: "cotacao.aceitar_paginas_legais",
        entidade: "reserva",
        entidadeId: t.reservaId,
        mudancas: { paginasLegais: [null, resumoDoAceite(publicadas, origem)] },
      });
      return { ok: true, aceite: paraAceite(nova) };
    }
  }
  const aceite = await aceiteDasVersoes(tx, organizacaoId, t.cotacaoId, publicadas);
  return aceite ? { ok: true, aceite } : { ok: false, motivo: "pendente", publicadas };
}

/** Frases das recusas do aceite avulso, em linguagem do hóspede. */
export const MENSAGENS_ACEITE = {
  nao_encontrada: "Cotação não encontrada.",
  nao_segurada: "As datas desta cotação não estão seguradas.",
  prazo_vencido: "O prazo das datas desta cotação acabou.",
  nao_publicadas: "Os termos e as políticas do site ainda não foram publicados.",
  mudou: "Os termos ou as políticas mudaram enquanto a página estava aberta: leia a versão atual e marque de novo.",
  ocupado: "Muitos pedidos neste apartamento agora. Tente de novo em instantes.",
} as const;

/**
 * Registra o aceite fora da criação do Pix (testes e, no M8.2b, o cartão), na sua própria transação e na ordem única
 * das travas: a cotação primeiro (`travarCotacao`), as páginas legais depois. Deny-by-default: só cotação desta
 * organização, segurada, com o pedido ainda em `pedido` e o prazo das datas valendo, e só as versões publicadas agora.
 */
export async function registrarAceiteDoHospede(
  db: Db,
  organizacaoId: string,
  cotacaoId: string,
  versoes: VersoesLegais,
  origem: OrigemAceite,
  agora = new Date(),
): Promise<{ ok: true; aceite: AceiteSite } | { ok: false; erro: string }> {
  if (!uuidValido(cotacaoId) || !uuidValido(organizacaoId)) return { ok: false, erro: MENSAGENS_ACEITE.nao_encontrada };
  try {
    return await db.transaction(async (tx) => {
      const t = await travarCotacao(tx, organizacaoId, cotacaoId);
      if (!t) return { ok: false, erro: MENSAGENS_ACEITE.nao_encontrada };
      if (t.cotacao.estado !== "segurada" || t.reserva.estado !== "pedido") return { ok: false, erro: MENSAGENS_ACEITE.nao_segurada };
      if (!t.cotacao.holdAte || t.cotacao.holdAte.getTime() <= agora.getTime()) return { ok: false, erro: MENSAGENS_ACEITE.prazo_vencido };
      const a = await aceiteVigenteTravado(tx, organizacaoId, { cotacaoId, reservaId: t.reserva.id }, versoes, origem, agora);
      if (a.ok) return { ok: true, aceite: a.aceite };
      return { ok: false, erro: a.motivo === "nao_publicadas" ? MENSAGENS_ACEITE.nao_publicadas : MENSAGENS_ACEITE.mudou };
    });
  } catch (e) {
    if (travaOcupada(e)) return { ok: false, erro: MENSAGENS_ACEITE.ocupado };
    throw e;
  }
}

export type AceiteNaPagina = {
  /** Versões publicadas agora (campos escondidos e links). */
  versoes: VersoesLegais;
  /** O aceite que vale (ver `aceiteParaPagina`), com a data em ISO; null = o hóspede ainda precisa aceitar. */
  aceito: { em: string; versoes: VersoesLegais } | null;
  /** Resumo da Política de cancelamento em vigor, com os dados preenchidos. */
  resumo: Bloco[];
  /** Prazo do reembolso integral desta reserva, pela política do aceite que vale (ou a em vigor, antes do aceite). */
  prazo: ReturnType<typeof prazoDoReembolso>;
};

/**
 * Para a página da cotação (sem trava, só para mostrar). null quando as três páginas não estão publicadas. `aceito` é o
 * aceite do pagamento que confirmou a reserva, quando o site confirmou; senão, o aceite das versões em vigor, se houver.
 */
export async function aceiteParaPagina(
  db: Db,
  organizacaoId: string,
  c: { id: string; checkin: string; fuso: string; reservaId: string | null },
  agora: Date,
): Promise<AceiteNaPagina | null> {
  const versoes = await versoesLegaisAtuais(db, organizacaoId);
  if (!versoes) return null;
  let aceito: AceiteSite | null;
  const confirmou = c.reservaId
    ? (
        await db
          .select({ aceiteId: pagamentos.aceiteId })
          .from(pagamentos)
          .where(and(eq(pagamentos.organizacaoId, organizacaoId), eq(pagamentos.cotacaoId, c.id), eq(pagamentos.reservaId, c.reservaId), eq(pagamentos.desfecho, "reserva")))
      )[0]
    : undefined;
  if (confirmou) {
    // A reserva foi confirmada por um pagamento do site: vale o aceite com que ele foi criado (nunca o de uma versão posterior).
    const [l] = confirmou.aceiteId ? await db.select().from(aceitesSite).where(and(eq(aceitesSite.id, confirmou.aceiteId), eq(aceitesSite.organizacaoId, organizacaoId))) : [];
    aceito = l ? paraAceite(l) : null;
  } else aceito = await aceiteDasVersoes(db, organizacaoId, c.id, versoes);
  const politicas = await lerPaginaLegal(db, organizacaoId, "cancelamento");
  const emVigor = politicas.find((v) => v.numero === versoes.cancelamento);
  const daRegra = politicas.find((v) => v.numero === (aceito?.versoes.cancelamento ?? versoes.cancelamento));
  // Política sem o prazo gravado não acontece pela publicação; se acontecer, nada é suposto: a página não mostra o aceite.
  if (!emVigor || !daRegra?.regras) return null;
  return {
    versoes,
    aceito: aceito ? { em: aceito.aceitoEm.toISOString(), versoes: aceito.versoes } : null,
    resumo: blocosDoDocumento(preencherCampos(emVigor.secoes.resumo ?? "", emVigor.valores)),
    prazo: prazoDoReembolso(c.checkin, daRegra.regras.diasReembolsoIntegral, hojeISO(c.fuso, agora)),
  };
}

/** Prova no painel: todos os aceites de uma reserva, do mais novo para o mais antigo. */
export async function aceitesDaReserva(db: Db, organizacaoId: string, reservaId: string): Promise<AceiteSite[]> {
  if (!uuidValido(reservaId)) return [];
  const linhas = await db
    .select()
    .from(aceitesSite)
    .where(and(eq(aceitesSite.organizacaoId, organizacaoId), eq(aceitesSite.reservaId, reservaId)))
    .orderBy(desc(aceitesSite.aceitoEm), desc(aceitesSite.id));
  return linhas.map(paraAceite);
}

const COLUNA_VERSAO = { termos: aceitesSite.versaoTermos, privacidade: aceitesSite.versaoPrivacidade, cancelamento: aceitesSite.versaoCancelamento } as const;

/** Histórico do painel: quantos aceites cada versão de cada documento teve. */
export async function contarAceitesPorVersao(db: Db, organizacaoId: string): Promise<Record<DocumentoLegal, Map<number, number>>> {
  const r = {} as Record<DocumentoLegal, Map<number, number>>;
  for (const doc of DOCUMENTOS_LEGAIS) {
    const coluna = COLUNA_VERSAO[doc];
    const linhas = await db
      .select({ versao: coluna, total: sql<number>`count(*)::int` })
      .from(aceitesSite)
      .where(eq(aceitesSite.organizacaoId, organizacaoId))
      .groupBy(coluna);
    r[doc] = new Map(linhas.map((l) => [l.versao, Number(l.total)]));
  }
  return r;
}

/**
 * A Política de cancelamento de um pagamento: a versão do aceite com que a tentativa foi criada e o prazo dela (para o
 * painel e para a devolução do M8.2c, que nunca usa a versão em vigor). null = tentativa sem aceite (antes do M7.4).
 */
export async function politicaDoPagamento(db: Db, organizacaoId: string, pagamentoId: string): Promise<{ versao: number; data: string; regras: RegrasCancelamento } | null> {
  if (!uuidValido(pagamentoId)) return null;
  const [l] = await db
    .select({ versao: aceitesSite.versaoCancelamento })
    .from(pagamentos)
    .innerJoin(aceitesSite, eq(aceitesSite.id, pagamentos.aceiteId))
    .where(and(eq(pagamentos.id, pagamentoId), eq(pagamentos.organizacaoId, organizacaoId), eq(aceitesSite.organizacaoId, organizacaoId)));
  if (!l) return null;
  const versao = (await lerPaginaLegal(db, organizacaoId, "cancelamento")).find((v) => v.numero === l.versao);
  return versao?.regras ? { versao: versao.numero, data: versao.data, regras: versao.regras } : null;
}
