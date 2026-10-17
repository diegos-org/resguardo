"use server";

/**
 * Caixa de entrada do WhatsApp (M10.1a, desenho na seção "Telas e acesso" de `requisitos/product/WHATSAPP.md`) — ações do
 * painel. Nenhuma escreve na Meta nem chama a rede: o vínculo da conversa, o "lida" (estado interno) e a configuração.
 *
 * Sempre nesta ordem: sessão (a empresa vem só dela; um `organizacaoId` no formulário é ignorado) → quem vê as conversas
 * (`exigirVerConversas`, o lugar único que decide; lança `AcessoNegado` para a operação com o padrão "só o admin", o
 * proprietário e a limpeza) → validação (id, lista fechada) → domínio, que confere tudo de novo → `revalidatePath` →
 * `redirect` com a chave do resultado (`?feito=` ou `?erro=`, lidas pela página só de uma lista fechada).
 *
 * As duas ações da configuração (Integrações → WhatsApp) pedem `configuracao:editar` aqui mesmo, como
 * `calendario/acoes.ts`: o `sessaoConfig()` de `configuracoes/acoes.ts` é privado, e exportá-lo de um arquivo
 * "use server" o tornaria uma ação pública que devolve a sessão. Nada deste arquivo é auxiliar exportado.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigir } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { uuidValido } from "@/lib/ids";
import { exigirVerConversas } from "./acesso";
import { QUEM_VE_CONVERSAS, type QuemVeConversas, salvarIdsWhatsapp, salvarQuemVeConversas } from "./configuracao";
import { marcarComoLida } from "./conversas";
import { ALVOS_VINCULO, type AlvoVinculo } from "./regras";
import { confirmarVinculo, desfazerVinculo, vincularPorCodigo } from "./vinculo";

/** O retorno dos dois formulários de Integrações → WhatsApp (`useActionState`). */
export type EstadoWhatsapp = { ok?: boolean; mensagem?: string; valores?: Record<string, string> };

const LISTA = "/painel/mensagens";
const daConversa = (id: string) => `${LISTA}/${id}`;
/** O código digitado na busca manual: o maior válido tem 12 caracteres; o resto não chega ao banco. */
const TAMANHO_DO_CODIGO = 40;

/** A caixa de entrada, a conversa e a ficha da reserva (o bloco "Conversa no WhatsApp") mudam com o vínculo. */
const revalidar = () => revalidatePath("/painel", "layout");

const texto = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** A sessão de quem vê as conversas (lança `AcessoNegado` antes de qualquer leitura do formulário). */
async function sessaoDasConversas() {
  const sessao = await exigirSessaoPainel();
  const db = getDb();
  await exigirVerConversas(db, sessao);
  return { sessao, db };
}

/** "Vincular" numa sugestão (ou num alvo escolhido à mão): `contatoId`, `tipo` (lista fechada) e `alvoId`. */
export async function confirmarVinculoAcao(form: FormData): Promise<void> {
  const { sessao, db } = await sessaoDasConversas();
  const contatoId = texto(form, "contatoId");
  if (!uuidValido(contatoId)) return redirect(LISTA);
  const tipo = texto(form, "tipo");
  const alvoId = texto(form, "alvoId");
  if (!(ALVOS_VINCULO as readonly string[]).includes(tipo) || !uuidValido(alvoId)) return redirect(`${daConversa(contatoId)}?erro=alvo_nao_encontrado`);
  const r = await confirmarVinculo(db, sessao, { contatoId, tipo: tipo as AlvoVinculo, alvoId });
  revalidar();
  if (r === "conversa_nao_encontrada") return redirect(LISTA);
  return redirect(r === "vinculada" ? `${daConversa(contatoId)}?feito=vinculada` : `${daConversa(contatoId)}?erro=${r}`);
}

/** "Procurar e vincular": o código da reserva (SCL-…) ou da cotação (COT-…) digitado. */
export async function vincularPorCodigoAcao(form: FormData): Promise<void> {
  const { sessao, db } = await sessaoDasConversas();
  const contatoId = texto(form, "contatoId");
  if (!uuidValido(contatoId)) return redirect(LISTA);
  const codigo = texto(form, "codigo").slice(0, TAMANHO_DO_CODIGO);
  const r = await vincularPorCodigo(db, sessao, { contatoId, codigo });
  revalidar();
  if (r === "conversa_nao_encontrada") return redirect(LISTA);
  return redirect(r === "vinculada" ? `${daConversa(contatoId)}?feito=vinculada` : `${daConversa(contatoId)}?erro=${r}`);
}

/** "Desfazer vínculo" (a tela pergunta antes, com `BotaoConfirmar`). */
export async function desfazerVinculoAcao(form: FormData): Promise<void> {
  const { sessao, db } = await sessaoDasConversas();
  const contatoId = texto(form, "contatoId");
  if (!uuidValido(contatoId)) return redirect(LISTA);
  const r = await desfazerVinculo(db, sessao, contatoId);
  revalidar();
  if (r === "conversa_nao_encontrada") return redirect(LISTA);
  // Sem vínculo (já desfeito em outra aba): volta à conversa, que mostra o estado de agora.
  return redirect(r === "desfeito" ? `${daConversa(contatoId)}?feito=desfeito` : daConversa(contatoId));
}

/**
 * "Lida" (estado interno; nada vai para a Meta): chamada pela tela da conversa depois de aberta no navegador, nunca no
 * carregamento do servidor (o `Link` pode pré-carregar a página). `ate` = a última recebida que a tela mostrou, em ISO.
 */
export async function marcarComoLidaAcao(contatoId: string, ate: string): Promise<void> {
  const { sessao, db } = await sessaoDasConversas();
  if (!uuidValido(contatoId) || typeof ate !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(ate)) return;
  const quando = new Date(ate);
  if (Number.isNaN(quando.getTime())) return;
  if (await marcarComoLida(db, sessao, contatoId, quando, new Date())) revalidatePath(LISTA);
}

/** A sessão de quem edita as configurações (hoje só o admin); sem a permissão, lança `AcessoNegado`. */
async function sessaoDaConfiguracao() {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  return sessao;
}

const SALVO: EstadoWhatsapp = { ok: true, mensagem: "Salvo." };
const NADA_MUDOU: EstadoWhatsapp = { ok: true, mensagem: "Nada mudou." };

/** "Identificação na Meta": os ids da conta (WABA) e do número. Campo vazio apaga; campo que não veio não apaga. */
export async function salvarIdsWhatsappAcao(_estado: EstadoWhatsapp, form: FormData): Promise<EstadoWhatsapp> {
  const sessao = await sessaoDaConfiguracao();
  const wabaId = form.get("wabaId");
  const numeroId = form.get("numeroId");
  const valores = { wabaId: typeof wabaId === "string" ? wabaId : "", numeroId: typeof numeroId === "string" ? numeroId : "" };
  // Um campo que não veio no envio (formulário torto) não pode virar "apagar": recusa sem gravar.
  if (typeof wabaId !== "string" || typeof numeroId !== "string") return { ok: false, mensagem: "Use só números (até 25 dígitos).", valores };
  const r = await salvarIdsWhatsapp(getDb(), sessao, { wabaId, numeroId });
  if (r === "id_invalido") return { ok: false, mensagem: "Use só números (até 25 dígitos).", valores };
  if (r === "waba_de_outra_empresa") return { ok: false, mensagem: "Esta conta do WhatsApp já está ligada a outra empresa no sistema.", valores };
  revalidatePath("/painel", "layout");
  return r === "salvo" ? SALVO : NADA_MUDOU;
}

/** "Quem vê as conversas": só o admin (padrão) ou admin e operação. O menu, o Início e as telas mudam para a operação. */
export async function salvarQuemVeConversasAcao(_estado: EstadoWhatsapp, form: FormData): Promise<EstadoWhatsapp> {
  const sessao = await sessaoDaConfiguracao();
  const quem = texto(form, "quemVe");
  if (!(QUEM_VE_CONVERSAS as readonly string[]).includes(quem)) return { ok: false, mensagem: "Escolha uma das opções." };
  const r = await salvarQuemVeConversas(getDb(), sessao, quem as QuemVeConversas);
  revalidatePath("/painel", "layout");
  return r === "salvo" ? SALVO : NADA_MUDOU;
}
