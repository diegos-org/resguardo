/**
 * Rotina de hora em hora do WhatsApp (M10.1a, `/api/cron/whatsapp`): apaga os eventos e os contadores do dia com mais de
 * 90 dias (guardando o último dia com aviso válido) e repete o e-mail da conta que ainda não saiu. O resumo, gravado em
 * Sistema, só tem números.
 *
 * Só o e-mail que falhou no envio vira falha da rotina (e aviso no Sentry). Sem o e-mail da empresa ou sem o e-mail do
 * sistema é configuração que falta: fica no resumo e em Integrações, com a causa certa; virar erro faria um aviso no
 * Sentry a cada hora, por 7 dias.
 */
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { ErroDeRotina } from "@/observabilidade/erro-de-rotina";
import { reenviarAvisosPendentes } from "./avisos";
import { apagarAvisosWhatsappAntigos } from "./contadores";

export async function rotinaWhatsapp(db: Db, correio: Correio | null, agora: Date): Promise<string> {
  const apagados = await apagarAvisosWhatsappAntigos(db, agora);
  const e = await reenviarAvisosPendentes(db, correio, agora);
  const resumo = `${apagados.eventos} aviso(s) antigo(s) apagado(s); ${e.enviados} e-mail(s) da conta enviado(s); ${e.falhou} falhou(aram); ${e.semEmail} sem e-mail da empresa; ${e.semCorreio} sem o e-mail do sistema`;
  if (e.falhou) throw new ErroDeRotina(resumo, { email_nao_enviado: e.falhou });
  return resumo;
}
