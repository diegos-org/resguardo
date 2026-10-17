/**
 * Situação da conta do WhatsApp (M10.1a, desenho na seção "Idempotência e ordem" de `requisitos/product/WHATSAPP.md`):
 * puro, sem banco, sem rede e sem relógio. O que cada evento do `account_update` faz com a situação, os rótulos que as
 * telas e o e-mail mostram e o prazo de 24 h depois da conexão. Quem grava é `whatsapp/gravar.ts` (o evento mais novo
 * prevalece, a repetição não conta de novo); aqui só a regra, num lugar só.
 *
 * Nenhum rótulo leva id da Meta, número, nome ou trecho de conversa: só o código do evento, o motivo e a situação.
 */
import type { ContaLida } from "./aviso";
import { EVENTOS_COM_EMAIL, type EventoConta, type IniciadoPor, type MotivoDesconexao, type SituacaoConta } from "./regras";

export type EfeitoDoEvento = {
  situacao: SituacaoConta;
  /** Só no PARTNER_ADDED: começa o prazo de 24 h para pedir os contatos e o histórico (M10.1b). */
  conectadoEm?: Date;
  /** O que fica em `whatsapp_conta.motivo` e `iniciado_por`: a conta conectada de novo fica sem motivo. */
  motivo: MotivoDesconexao | null;
  iniciadoPor: IniciadoPor | null;
  /** Manda o e-mail da conta (quando o evento é aplicado): só desconexão, espera de reconexão e suspensão. */
  email: boolean;
};

/**
 * Puro: o que um evento faz com a situação. null = não muda a situação (ACCOUNT_RESTRICTION, ACCOUNT_VIOLATION e o
 * DISABLED_UPDATE sem estado de banimento): o evento fica registrado e aparece em Integrações, sem e-mail.
 * - PARTNER_ADDED → conectada (com `conectadoEm`); ACCOUNT_RECONNECTED → conectada;
 * - PARTNER_REMOVED, ACCOUNT_DELETED, PARTNER_APP_UNINSTALLED → desconectada, com e-mail;
 * - ACCOUNT_OFFBOARDED (registrado em outro aparelho ou reinstalado) → aguardando reconexão, com e-mail;
 * - DISABLED_UPDATE com DISABLE ou SCHEDULE_FOR_DISABLE → suspensa, com e-mail; com REINSTATE → conectada.
 * O e-mail só sai para eventos de `EVENTOS_COM_EMAIL` (regras.ts), e nunca quando a conta volta a ficar conectada.
 */
export function efeitoDoEvento(c: ContaLida): EfeitoDoEvento | null {
  const situacao = situacaoDoEvento(c);
  if (!situacao) return null;
  const conectada = situacao === "conectada";
  return {
    situacao,
    ...(c.evento === "PARTNER_ADDED" ? { conectadoEm: c.em } : {}),
    motivo: conectada ? null : c.motivo,
    iniciadoPor: conectada ? null : c.iniciadoPor,
    email: !conectada && (EVENTOS_COM_EMAIL as readonly EventoConta[]).includes(c.evento),
  };
}

function situacaoDoEvento(c: ContaLida): SituacaoConta | null {
  switch (c.evento) {
    case "PARTNER_ADDED":
    case "ACCOUNT_RECONNECTED":
      return "conectada";
    case "PARTNER_REMOVED":
    case "ACCOUNT_DELETED":
    case "PARTNER_APP_UNINSTALLED":
      return "desconectada";
    case "ACCOUNT_OFFBOARDED":
      return "aguardando_reconexao";
    case "DISABLED_UPDATE":
      if (c.banimento === "DISABLE" || c.banimento === "SCHEDULE_FOR_DISABLE") return "suspensa";
      return c.banimento === "REINSTATE" ? "conectada" : null;
    case "ACCOUNT_RESTRICTION":
    case "ACCOUNT_VIOLATION":
      return null;
  }
}

export const ROTULO_SITUACAO: Record<SituacaoConta, string> = {
  nao_conectada: "Não conectado",
  conectada: "Conectado",
  aguardando_reconexao: "Aguardando reconexão",
  desconectada: "Desconectado",
  suspensa: "Suspenso",
};

/** `disconnection_info.reason`, em palavras. Sem motivo (ou fora da lista): `MOTIVO_NAO_INFORMADO`. */
export const ROTULO_MOTIVO: Record<MotivoDesconexao, string> = {
  ACCOUNT_DISCONNECTED: "a conta foi desconectada do sistema",
  BUSINESS_DOWNGRADE: "a conta deixou de ser WhatsApp Business",
  CHANGE_NUMBER: "o número da empresa foi trocado no aplicativo",
  COMPANION_INACTIVITY: "um aparelho vinculado ficou cerca de 30 dias sem uso",
  PRIMARY_INACTIVITY: "o celular principal ficou cerca de 14 dias sem abrir o WhatsApp Business",
  USER_RE_REGISTERED: "o número foi registrado de novo no aplicativo",
};
export const MOTIVO_NAO_INFORMADO = "motivo não informado pela Meta";
/** O motivo em palavras, ou "motivo não informado pela Meta" (nunca um palpite). */
export const rotuloDoMotivo = (m: MotivoDesconexao | null | undefined): string => (m ? ROTULO_MOTIVO[m] : MOTIVO_NAO_INFORMADO);

export const ROTULO_EVENTO: Record<EventoConta, string> = {
  PARTNER_ADDED: "Conectado ao sistema",
  PARTNER_REMOVED: "Desconectado do sistema",
  ACCOUNT_OFFBOARDED: "Registrado em outro aparelho",
  ACCOUNT_RECONNECTED: "Reconectado",
  ACCOUNT_DELETED: "Conta apagada",
  PARTNER_APP_UNINSTALLED: "App do sistema removido da conta",
  DISABLED_UPDATE: "Mudança de suspensão da conta",
  ACCOUNT_RESTRICTION: "Restrição na conta",
  ACCOUNT_VIOLATION: "Violação de regra registrada pela Meta",
};

/** Prazo para pedir os contatos e o histórico depois da conexão (coexistência: só nas primeiras 24 h). */
export const PRAZO_SINCRONIZACAO_MS = 24 * 60 * 60 * 1000;

/**
 * O fim do prazo de 24 h (conectado em + 24 h), se a conta está conectada e o prazo ainda não passou; senão null. A
 * conta vem de `whatsapp_conta` (`conectado_em` só muda no PARTNER_ADDED). As telas mostram a data pelo `lib/datas.ts`.
 */
export function prazoDas24h(conta: { situacao: SituacaoConta; conectadoEm: Date | null }, agora: Date): Date | null {
  if (conta.situacao !== "conectada" || !conta.conectadoEm) return null;
  const fim = new Date(conta.conectadoEm.getTime() + PRAZO_SINCRONIZACAO_MS);
  return agora.getTime() < fim.getTime() ? fim : null;
}
