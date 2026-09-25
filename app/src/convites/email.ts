/** Texto do e-mail do convite do portal (M1.4), usado ao convidar e ao aprovar um cadastro marketplace (M12.3). */
import type { Correio } from "@/email/correio";

export async function enviarEmailConvite(correio: Correio, email: string, empresa: string, link: string): Promise<void> {
  await correio.enviar({
    para: email,
    assunto: `Convite para o portal da ${empresa}`,
    texto: `Olá! Você foi convidado para acompanhar seus imóveis no portal da ${empresa}.\n\nAbra o link abaixo e entre com este e-mail (${email}). O convite vale por 7 dias e só pode ser usado uma vez.\n\n${link}\n\nSe você não esperava este convite, ignore este e-mail.`,
  });
}

/** Endereço completo a partir do cabeçalho da requisição (link do convite). */
export function enderecoDaRequisicao(h: Headers, caminho: string): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${caminho}`;
}
