"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { enderecoDaRequisicao } from "@/convites/email";
import { getDb } from "@/db/client";
import { correioDoAmbiente } from "@/email/correio";
import { organizacaoDoSite } from "@/site/site";
import { avisarEquipeDoPedido, ESTADIA_COMECOU, JA_CANCELADA, PEDIDO_DESLIGADO, PEDIDO_OCUPADO, pedirCancelamentoPeloHospede } from "./cancelamento";
import { pedirCodigoHospede, verificarCodigoHospede } from "./portal";
import { COOKIE_HOSPEDE, criarSessaoHospede, VALIDADE_SESSAO_HOSPEDE_MS } from "./sessao";
import { emailDoHospede } from "./sessao-atual";

const ENTRAR = "/hospede/entrar";
const paraCodigo = (email: string, erro?: string) => `${ENTRAR}?etapa=codigo&email=${encodeURIComponent(email)}${erro ? `&erro=${erro}` : ""}`;

export async function pedirCodigoHospedeAcao(form: FormData): Promise<void> {
  const correio = correioDoAmbiente();
  if (!process.env.AUTH_SECRET || !correio) redirect(ENTRAR);
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  if (!email) redirect(`${ENTRAR}?erro=email-vazio`);
  // Tudo depois da resposta: a tela é igual para qualquer e-mail, com ou sem reserva.
  after(async () => {
    try {
      const db = getDb();
      // Só reservas da empresa deste site.
      const organizacaoId = await organizacaoDoSite(db);
      if (!organizacaoId) return;
      const r = await pedirCodigoHospede(db, correio, organizacaoId, email, { segredo: process.env.AUTH_SECRET! });
      if (r === "limite") console.warn("[hospede] limite de códigos atingido");
    } catch (e) {
      console.error("[hospede] falha ao enviar código", e);
    }
  });
  redirect(paraCodigo(email));
}

export async function entrarHospede(form: FormData): Promise<void> {
  const segredo = process.env.AUTH_SECRET;
  if (!segredo) redirect(ENTRAR);
  const email = String(form.get("email") ?? "").slice(0, 200);
  const codigo = String(form.get("codigo") ?? "").slice(0, 20);
  const db = getDb();
  const organizacaoId = await organizacaoDoSite(db);
  if (!organizacaoId) redirect(ENTRAR);
  const r = await verificarCodigoHospede(db, organizacaoId, email, codigo, { segredo });
  if (!r.ok) redirect(paraCodigo(email, "codigo"));
  const agora = new Date();
  (await cookies()).set(COOKIE_HOSPEDE, criarSessaoHospede(r.email, segredo, agora), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/hospede",
    maxAge: VALIDADE_SESSAO_HOSPEDE_MS / 1000,
  });
  redirect("/hospede");
}

export async function sairHospede(): Promise<void> {
  (await cookies()).delete({ name: COOKIE_HOSPEDE, path: "/hospede" });
  redirect(ENTRAR);
}

/** Onde a equipe vê os pedidos de cancelamento esperando (vai no e-mail de aviso; sem dado do hóspede). */
const PAGINA_PEDIDOS = "/painel/reservas?cancelamento=pedido";
/** Recusas do pedido de cancelamento → o código do endereço (a página mostra o texto fixo de cada um). */
const ERROS_DO_PEDIDO: Record<string, string> = {
  [PEDIDO_DESLIGADO]: "cancelamento-desligado",
  [ESTADIA_COMECOU]: "cancelamento-estadia",
  [JA_CANCELADA]: "cancelamento-cancelada",
  [PEDIDO_OCUPADO]: "cancelamento-ocupado",
};

/**
 * "Pedir o cancelamento" (Minha reserva, M8.2c): só PEDE — a equipe cancela e devolve no painel. O hóspede é o do código
 * enviado ao e-mail (sessão do portal); a reserva, a do campo, conferida pelo domínio com o mesmo e-mail. O horário que
 * vale é o do servidor agora. Depois da resposta, a equipe recebe um e-mail (sem nome nem e-mail do hóspede).
 */
export async function pedirCancelamentoAcao(form: FormData): Promise<void> {
  const email = await emailDoHospede();
  if (!email) redirect(ENTRAR);
  const codigo = String(form.get("reserva") ?? "").trim();
  if (!/^[A-Z0-9-]{1,20}$/i.test(codigo)) redirect("/hospede?erro=cancelamento");
  const db = getDb();
  const organizacaoId = await organizacaoDoSite(db);
  if (!organizacaoId) redirect("/hospede?erro=cancelamento");
  const r = await pedirCancelamentoPeloHospede(db, organizacaoId, email, codigo, new Date());
  if (!r.ok) redirect(`/hospede?erro=${ERROS_DO_PEDIDO[r.erro] ?? "cancelamento"}`);
  if (r.novo) {
    const link = enderecoDaRequisicao(await headers(), PAGINA_PEDIDOS);
    const correio = correioDoAmbiente();
    const cancelamentoId = r.cancelamentoId;
    // Depois da resposta: o hóspede não espera o provedor de e-mail. Se falhar, o pedido continua no painel (e no Início).
    after(async () => {
      try {
        const aviso = await avisarEquipeDoPedido(getDb(), organizacaoId, cancelamentoId, correio, link);
        if (aviso === "sem-email" || aviso === "sem-correio") console.warn(`[pedido de cancelamento] equipe não avisada por e-mail (${aviso}); o pedido está no painel.`);
      } catch (e) {
        console.error("[pedido de cancelamento] falha ao avisar a equipe", e instanceof Error ? e.message : String(e));
      }
    });
  }
  revalidatePath("/hospede");
  redirect("/hospede?pedido=ok");
}
