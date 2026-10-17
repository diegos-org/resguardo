/**
 * Recebimento do WhatsApp (M10.1a) — a situação para Integrações (e Sistema, pela mesma função): as três variáveis da
 * Vercel (só se existem, nunca o valor), os ids configurados, a situação da conta que os avisos escreveram, os
 * contadores de hoje com o último aviso válido, os últimos avisos da conta com o resultado do e-mail e o endereço fixo
 * para colar no app da Meta. Só leitura: nada aqui fala com a Meta. Nada devolvido leva telefone, nome ou trecho de
 * conversa (essas tabelas não são lidas aqui), nem o segredo do app ou a senha de verificação.
 */
import { and, desc, eq } from "drizzle-orm";
import { whatsappConta, whatsappEventos } from "@/db/schema";
import type { Db } from "@/db/types";
import { ENDERECO_PRODUCAO } from "@/sistema/ambiente";
import { recebimentoLigado, segredoDoApp, situacaoDoToken } from "./ambiente";
import { inicioDasTentativas } from "./avisos";
import { type ConfigWhatsapp, lerConfigWhatsapp } from "./configuracao";
import { situacaoDosAvisosWhatsapp } from "./contadores";
import type { ContadorDia, EventoConta, IniciadoPor, MotivoDesconexao, ResultadoEmail, SituacaoConta, Sincronizacao } from "./regras";
import { prazoDas24h } from "./situacao";

/** Endereço do aviso assinado para colar no app da Meta (o deploy de produção, fixo; nas prévias o aviso não chega). */
export const ENDERECO_WEBHOOK_WHATSAPP = `${ENDERECO_PRODUCAO}/api/whatsapp`;

/** Quantos avisos da conta Integrações mostra (os mais recentes). */
export const EVENTOS_DA_CONTA_NA_TELA = 10;

/**
 * E-mail de um aviso da conta: o último resultado, "pendente" (ainda sem tentativa), "nao_se_aplica" (evento sem e-mail)
 * ou "sem_nova_tentativa" (não saiu e a rotina já parou de tentar: passou o prazo de `REPETIR_EMAIL_DIAS`).
 */
export type EmailDoEvento = ResultadoEmail | "pendente" | "nao_se_aplica" | "sem_nova_tentativa";

export type SituacaoWhatsapp = {
  recebimentoLigado: boolean;
  token: "falta" | "curto" | "ok";
  segredoConfigurado: boolean;
  config: ConfigWhatsapp;
  conta: {
    situacao: SituacaoConta;
    ultimoEvento: EventoConta | null;
    motivo: MotivoDesconexao | null;
    iniciadoPor: IniciadoPor | null;
    situacaoEm: Date | null;
    conectadoEm: Date | null;
    /** Fim do prazo de 24 h para pedir os contatos e o histórico, se ainda está correndo. */
    prazo24h: Date | null;
    sincronizacaoContatos: Sincronizacao;
    contatosRecebidosEm: Date | null;
    sincronizacaoHistorico: Sincronizacao;
    progressoHistorico: number | null;
  };
  avisos: { hoje: Record<ContadorDia, number>; ultimoValidoEm: Date | null };
  /** Os últimos avisos da conta (account_update), do mais novo para o mais velho. */
  eventosDaConta: { tipo: EventoConta; motivo: MotivoDesconexao | null; ocorridoEm: Date | null; email: EmailDoEvento }[];
  enderecoWebhook: string;
};

/** A conta antes do primeiro aviso (a linha de `whatsapp_conta` só é criada quando um aviso chega). */
const CONTA_SEM_AVISO = {
  situacao: "nao_conectada",
  ultimoEvento: null,
  motivo: null,
  iniciadoPor: null,
  situacaoEm: null,
  conectadoEm: null,
  sincronizacaoContatos: "nao_pedida",
  contatosRecebidosEm: null,
  sincronizacaoHistorico: "nao_pedida",
  progressoHistorico: null,
} as const satisfies Omit<SituacaoWhatsapp["conta"], "prazo24h">;

/**
 * O resultado do e-mail de um evento, sem supor: evento que não pede e-mail = "nao_se_aplica"; envio confirmado =
 * "enviado"; não saiu e foi recebido antes do prazo da rotina (a mesma regra de `reenviarAvisosPendentes`) =
 * "sem_nova_tentativa", para a tela não prometer uma tentativa que não vem; pede e ainda não houve tentativa =
 * "pendente"; senão o último resultado gravado (`email_resultado`).
 */
const emailDoEvento = (e: { avisarPorEmail: boolean; emailResultado: ResultadoEmail | null; emailAvisoEm: Date | null; recebidoEm: Date }, agora: Date): EmailDoEvento =>
  !e.avisarPorEmail
    ? "nao_se_aplica"
    : e.emailAvisoEm
      ? "enviado"
      : e.recebidoEm.getTime() < inicioDasTentativas(agora).getTime()
        ? "sem_nova_tentativa"
        : (e.emailResultado ?? "pendente");

/**
 * Só a organização da sessão (quem chama já conferiu `configuracao:editar`). `env` é o ambiente do servidor: daqui só
 * sai se cada variável existe (e se a senha de verificação é longa o bastante), nunca o valor.
 */
export async function situacaoDoWhatsapp(db: Db, organizacaoId: string, env: NodeJS.ProcessEnv, agora: Date): Promise<SituacaoWhatsapp> {
  const [config, linhaDaConta, avisos, eventos] = await Promise.all([
    lerConfigWhatsapp(db, organizacaoId),
    db.select().from(whatsappConta).where(eq(whatsappConta.organizacaoId, organizacaoId)).then((r) => r[0] ?? null),
    situacaoDosAvisosWhatsapp(db, agora),
    db
      .select({
        tipo: whatsappEventos.tipo,
        motivo: whatsappEventos.motivo,
        ocorridoEm: whatsappEventos.ocorridoEm,
        recebidoEm: whatsappEventos.recebidoEm,
        avisarPorEmail: whatsappEventos.avisarPorEmail,
        emailResultado: whatsappEventos.emailResultado,
        emailAvisoEm: whatsappEventos.emailAvisoEm,
      })
      .from(whatsappEventos)
      .where(and(eq(whatsappEventos.organizacaoId, organizacaoId), eq(whatsappEventos.campo, "account_update")))
      .orderBy(desc(whatsappEventos.ocorridoEm), desc(whatsappEventos.recebidoEm))
      .limit(EVENTOS_DA_CONTA_NA_TELA),
  ]);
  const conta = linhaDaConta
    ? {
        situacao: linhaDaConta.situacao,
        ultimoEvento: linhaDaConta.ultimoEvento,
        motivo: linhaDaConta.motivo,
        iniciadoPor: linhaDaConta.iniciadoPor,
        situacaoEm: linhaDaConta.situacaoEm,
        conectadoEm: linhaDaConta.conectadoEm,
        sincronizacaoContatos: linhaDaConta.sincronizacaoContatos,
        contatosRecebidosEm: linhaDaConta.contatosRecebidosEm,
        sincronizacaoHistorico: linhaDaConta.sincronizacaoHistorico,
        progressoHistorico: linhaDaConta.progressoHistorico,
      }
    : CONTA_SEM_AVISO;
  return {
    recebimentoLigado: recebimentoLigado(env),
    token: situacaoDoToken(env),
    segredoConfigurado: segredoDoApp(env) !== null,
    config,
    conta: { ...conta, prazo24h: prazoDas24h(conta, agora) },
    avisos,
    // O account_update só grava evento da lista fechada (o parser descarta o resto): o tipo vazio não chega aqui.
    eventosDaConta: eventos.flatMap((e) => (e.tipo ? [{ tipo: e.tipo, motivo: e.motivo, ocorridoEm: e.ocorridoEm, email: emailDoEvento(e, agora) }] : [])),
    enderecoWebhook: ENDERECO_WEBHOOK_WHATSAPP,
  };
}
