/**
 * E-mail da conta do WhatsApp (M10.1a, desenho na seção "Idempotência e ordem" de `requisitos/product/WHATSAPP.md`):
 * quando um aviso da Meta desconecta a conta, a deixa aguardando reconexão ou a suspende (`efeitoDoEvento`, só o evento
 * aplicado), a equipe recebe um e-mail no endereço da empresa (Configurações → Empresa), pelo padrão dos avisos internos
 * (`avisarEquipePorEmail`, decisão T21: não a cada usuário admin). A rota manda depois da resposta (`after()`); a rotina
 * de hora em hora repete o que ficou pendente por até 7 dias, com a mesma chave (o provedor não manda duas vezes).
 *
 * O texto sai só do evento (o código, o motivo e a hora da Meta) e, quando a conta mostra que este foi o último evento
 * aplicado, de quem iniciou a desconexão: nunca id da Meta, número, nome, telefone ou trecho de conversa. O resultado de
 * cada tentativa fica em `whatsapp_eventos.email_resultado` (Integrações mostra a causa certa, sem supor); só o envio
 * confirmado grava `email_aviso_em` e encerra as tentativas.
 */
import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { whatsappConta, whatsappEventos } from "@/db/schema";
import type { Db } from "@/db/types";
import { avisarEquipePorEmail } from "@/email/aviso-equipe";
import type { Correio } from "@/email/correio";
import { dataHoraNoFuso } from "@/lib/datas";
import type { EmailDeConta } from "./receber";
import type { EventoConta, IniciadoPor, MotivoDesconexao, ResultadoEmail } from "./regras";
import { rotuloDoMotivo } from "./situacao";

/** Quantos e-mails de cada resultado saíram numa chamada (o resumo da rotina, sem dado nenhum). */
export type ResumoEmails = { enviados: number; falhou: number; semEmail: number; semCorreio: number };

/** Por quanto tempo a rotina repete o e-mail não enviado (depois disso, o aviso fica só no Início e em Integrações). */
export const REPETIR_EMAIL_DIAS = 7;
/** O evento recebido antes deste instante não tem mais tentativa de e-mail (a rotina e Integrações leem daqui). */
export const inicioDasTentativas = (agora: Date) => new Date(agora.getTime() - REPETIR_EMAIL_DIAS * 86_400_000);
/** Quantos e-mails pendentes a rotina tenta numa volta (os mais antigos primeiro). */
export const EMAILS_POR_VOLTA = 50;

const ONDE_VER = "Veja em Configurações → Integrações → WhatsApp.";

/** Quem iniciou a desconexão, como fim da frase do motivo (só quando se sabe: sem palpite). */
const QUEM_INICIOU: Record<IniciadoPor, string> = { USER: ", pelo próprio aplicativo", SYSTEM: ", pela Meta" };

/**
 * Assunto e corpo do e-mail de um evento de conta (textos exatos do desenho). null = evento que não manda e-mail (só a
 * desconexão, a espera de reconexão e a suspensão mandam; quem decide é `efeitoDoEvento`, aqui só o texto).
 */
export function mensagemDoEvento(e: { tipo: EventoConta; motivo: MotivoDesconexao | null; ocorridoEm: Date; iniciadoPor: IniciadoPor | null }): { assunto: string; texto: string } | null {
  const quando = `A Meta avisou em ${dataHoraNoFuso(e.ocorridoEm)} (horário de Brasília)`;
  switch (e.tipo) {
    case "PARTNER_REMOVED":
    case "ACCOUNT_DELETED":
    case "PARTNER_APP_UNINSTALLED":
      return {
        assunto: "WhatsApp desconectado do sistema",
        texto: [
          `${quando} que o WhatsApp da empresa foi desconectado do sistema.`,
          `Motivo informado: ${rotuloDoMotivo(e.motivo)}${e.iniciadoPor ? QUEM_INICIOU[e.iniciadoPor] : ""}.`,
          "As mensagens novas não chegam ao painel até a conexão ser refeita. O WhatsApp no celular continua funcionando.",
          ONDE_VER,
        ].join("\n") + "\n",
      };
    case "ACCOUNT_OFFBOARDED":
      return {
        assunto: "WhatsApp aguardando reconexão",
        texto: `${quando} que o WhatsApp da empresa foi registrado em outro aparelho ou reinstalado. A reconexão costuma ser automática em alguns minutos. Se não voltar, veja em Configurações → Integrações → WhatsApp.\n`,
      };
    case "DISABLED_UPDATE":
      return { assunto: "Conta do WhatsApp suspensa pela Meta", texto: `${quando} que a conta do WhatsApp da empresa foi suspensa ou está programada para suspensão. ${ONDE_VER}\n` };
    default:
      return null;
  }
}

const resumoVazio = (): ResumoEmails => ({ enviados: 0, falhou: 0, semEmail: 0, semCorreio: 0 });
const CAMPO_DO_RESULTADO: Record<ResultadoEmail, keyof ResumoEmails> = { enviado: "enviados", falhou: "falhou", "sem-email": "semEmail", "sem-correio": "semCorreio" };

type EventoPendente = { id: string; organizacaoId: string; tipo: EventoConta | ""; motivo: MotivoDesconexao | null; ocorridoEm: Date | null; recebidoEm: Date };

/** Os eventos de conta que pedem e-mail e ainda não o tiveram confirmado. */
const pendentes = and(eq(whatsappEventos.campo, "account_update"), eq(whatsappEventos.avisarPorEmail, true), isNull(whatsappEventos.emailAvisoEm));
const COLUNAS = {
  id: whatsappEventos.id,
  organizacaoId: whatsappEventos.organizacaoId,
  tipo: whatsappEventos.tipo,
  motivo: whatsappEventos.motivo,
  ocorridoEm: whatsappEventos.ocorridoEm,
  recebidoEm: whatsappEventos.recebidoEm,
};

/**
 * Quem iniciou a desconexão sai da conta, e só quando a conta mostra este evento como o último aplicado (mesmo código e
 * mesma hora da Meta): um evento mais novo já mudou a conta, e então o e-mail diz só o motivo.
 */
async function iniciadoPorDoEvento(db: Db, e: EventoPendente): Promise<IniciadoPor | null> {
  if (!e.ocorridoEm || !e.tipo) return null;
  const [conta] = await db
    .select({ ultimoEvento: whatsappConta.ultimoEvento, situacaoEm: whatsappConta.situacaoEm, iniciadoPor: whatsappConta.iniciadoPor })
    .from(whatsappConta)
    .where(eq(whatsappConta.organizacaoId, e.organizacaoId));
  return conta && conta.ultimoEvento === e.tipo && conta.situacaoEm?.getTime() === e.ocorridoEm.getTime() ? conta.iniciadoPor : null;
}

/**
 * Uma tentativa: manda, grava o resultado (e, só com o envio confirmado, a hora) e soma no resumo. A gravação só vale
 * enquanto o evento não tem envio confirmado: o `after()` da rota e a rotina podem tentar o mesmo evento ao mesmo tempo,
 * e o provedor recusa a segunda chamada com a mesma chave; essa recusa, gravada depois do envio da outra, apagaria um
 * e-mail que saiu (e a rotina contaria uma falha falsa). Só entra no resumo o que foi gravado.
 */
async function tentar(db: Db, e: EventoPendente, correio: Correio | null, agora: Date, resumo: ResumoEmails): Promise<void> {
  if (!e.tipo) return;
  const m = mensagemDoEvento({ tipo: e.tipo, motivo: e.motivo, ocorridoEm: e.ocorridoEm ?? e.recebidoEm, iniciadoPor: await iniciadoPorDoEvento(db, e) });
  if (!m) return;
  const r = await avisarEquipePorEmail(db, e.organizacaoId, correio, { ...m, chave: `whatsapp-conta:${e.id}`, rotulo: "conta do WhatsApp" });
  const [gravado] = await db
    .update(whatsappEventos)
    .set({ emailResultado: r, ...(r === "enviado" ? { emailAvisoEm: agora } : {}) })
    .where(and(eq(whatsappEventos.id, e.id), isNull(whatsappEventos.emailAvisoEm)))
    .returning({ id: whatsappEventos.id });
  if (gravado) resumo[CAMPO_DO_RESULTADO[r]] += 1;
}

/**
 * Depois da resposta da rota: os e-mails dos eventos novos que o aviso pediu. Evento já enviado (outra tentativa chegou
 * antes) ou de outra organização não sai de novo.
 */
export async function enviarAvisosDaConta(db: Db, emails: EmailDeConta[], correio: Correio | null, agora: Date): Promise<ResumoEmails> {
  const resumo = resumoVazio();
  for (const { organizacaoId, eventoId } of emails) {
    const [e] = await db
      .select(COLUNAS)
      .from(whatsappEventos)
      .where(and(pendentes, eq(whatsappEventos.id, eventoId), eq(whatsappEventos.organizacaoId, organizacaoId)));
    if (e) await tentar(db, e, correio, agora, resumo);
  }
  return resumo;
}

/**
 * A rotina de hora em hora: os e-mails pendentes (sem envio confirmado) dos eventos recebidos nos últimos 7 dias, os
 * mais antigos primeiro, de todas as organizações. A chave é a mesma da primeira tentativa: o provedor não manda duas
 * vezes. Depois de 7 dias o aviso fica só no Início e em Integrações.
 */
export async function reenviarAvisosPendentes(db: Db, correio: Correio | null, agora: Date): Promise<ResumoEmails> {
  const resumo = resumoVazio();
  const lista = await db
    .select(COLUNAS)
    .from(whatsappEventos)
    .where(and(pendentes, gte(whatsappEventos.recebidoEm, inicioDasTentativas(agora))))
    .orderBy(asc(whatsappEventos.recebidoEm), asc(whatsappEventos.id))
    .limit(EMAILS_POR_VOLTA);
  for (const e of lista) await tentar(db, e, correio, agora, resumo);
  return resumo;
}
