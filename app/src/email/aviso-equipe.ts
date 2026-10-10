/**
 * Um e-mail para a equipe, no endereço da empresa (Configurações → Empresa): o padrão dos avisos internos (pedido de
 * contato de proprietário, M7.7; pedido de cancelamento pelo site, M8.2c). Sem e-mail do sistema ou sem e-mail da
 * empresa, não envia (o que pediu o aviso continua no painel). Falha no envio não derruba quem chamou: volta "falhou".
 * O conteúdo é sempre restrito (nunca no terminal de desenvolvimento) e a chave evita dois e-mails do mesmo aviso.
 */
import { lerEmpresa } from "@/configuracoes/empresa";
import type { Db } from "@/db/types";
import type { Correio } from "./correio";

export type ResultadoAviso = "enviado" | "sem-email" | "sem-correio" | "falhou";

export async function avisarEquipePorEmail(
  db: Db,
  organizacaoId: string,
  correio: Correio | null,
  m: { assunto: string; texto: string; chave: string; rotulo: string },
): Promise<ResultadoAviso> {
  if (!correio) return "sem-correio";
  const para = (await lerEmpresa(db, organizacaoId)).email.trim();
  if (!para) return "sem-email";
  try {
    await correio.enviar({ para, assunto: m.assunto, texto: m.texto, conteudoRestrito: true, chave: m.chave });
    return "enviado";
  } catch (e) {
    console.error(`[${m.rotulo}] falha ao avisar a equipe por e-mail`, e instanceof Error ? e.message : String(e));
    return "falhou";
  }
}
