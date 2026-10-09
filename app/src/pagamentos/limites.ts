/**
 * Pagamento no site (M8.2a) — freios das ações públicas: gerar Pix, "Continuar o pagamento" (conferir o e-mail
 * do pedido), a consulta da página que espera o Pix e segurar as datas. Para cada uma, um teto por endereço de
 * internet (IPv6 agrupado pela rede /64) e um teto geral por organização. A origem é contada PRIMEIRO, e só o pedido
 * que ainda cabe no teto dela conta no geral (como na entrada com senha): uma origem só não tira a vez de todo
 * mundo. Origem desconhecida conta numa chave compartilhada, com teto baixo (nunca "sem teto"). Mesmas contas de
 * `contarNaJanela` do login.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { apagarContasVelhas, contarNaJanela, type Limite } from "@/acesso/senha";
import { cotacoes, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { validadeDaAutorizacao } from "./autorizacao";

export type AcaoLimitada = "gerar_pix" | "continuar" | "consulta" | "segurar";
export type LimitesDaAcao = { geral: Limite; origem: Limite; semOrigem: Limite };

const HORA = 60 * 60_000;
const QUINZE_MIN = 15 * 60_000;

/** Tetos por ação (constantes, como os freios do M8.1). */
export const LIMITES_PAGAMENTO: Record<AcaoLimitada, LimitesDaAcao> = {
  gerar_pix: { geral: { tentativas: 200, janelaMs: HORA }, origem: { tentativas: 10, janelaMs: HORA }, semOrigem: { tentativas: 20, janelaMs: HORA } },
  continuar: { geral: { tentativas: 100, janelaMs: QUINZE_MIN }, origem: { tentativas: 5, janelaMs: QUINZE_MIN }, semOrigem: { tentativas: 10, janelaMs: QUINZE_MIN } },
  // A página do Pix consulta a cada poucos segundos enquanto espera.
  consulta: { geral: { tentativas: 6000, janelaMs: QUINZE_MIN }, origem: { tentativas: 300, janelaMs: QUINZE_MIN }, semOrigem: { tentativas: 600, janelaMs: QUINZE_MIN } },
  segurar: { geral: { tentativas: 300, janelaMs: HORA }, origem: { tentativas: 10, janelaMs: HORA }, semOrigem: { tentativas: 30, janelaMs: HORA } },
};
/** "Continuar o pagamento": tentativas de e-mail por cotação (além dos tetos acima). */
export const LIMITE_EMAIL_POR_COTACAO: Limite = { tentativas: 5, janelaMs: HORA };

export const ERROS_LIMITE: Record<AcaoLimitada, string> = {
  gerar_pix: "Muitos pedidos de Pix agora há pouco. Tente de novo mais tarde ou fale com a equipe pelo WhatsApp.",
  continuar: "Muitas tentativas agora há pouco. Espere alguns minutos ou fale com a equipe pelo WhatsApp.",
  consulta: "Muitas consultas agora há pouco. Atualize a página daqui a alguns minutos.",
  segurar: "Muitos pedidos agora há pouco. Tente de novo mais tarde ou fale com a equipe pelo WhatsApp.",
};

/**
 * Chave da origem para os tetos: IPv4 inteiro; IPv6 pela rede /64 (quem tem uma /64 troca de endereço à vontade);
 * IPv4 dentro de IPv6 (::ffff:a.b.c.d) como IPv4. Só aqui: a origem do login continua a de `origemDoPedido`.
 */
export function chaveDaOrigem(origem: string): string {
  const o = origem.trim().toLowerCase();
  if (!o.includes(":")) return o;
  const mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(o);
  if (mapeado) return mapeado[1];
  // Grupos de 16 bits; um IPv4 no fim (ex.: 64:ff9b::1.2.3.4) ocupa dois.
  const grupos = (lado: string) => (lado ? lado.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g])) : []);
  const [cabeca, cauda] = o.includes("::") ? o.split("::", 2) : [o, null];
  const inicio = grupos(cabeca);
  const fim = cauda === null ? [] : grupos(cauda);
  const todos = cauda === null ? inicio : [...inicio, ...Array<string>(Math.max(0, 8 - inicio.length - fim.length)).fill("0"), ...fim];
  const rede = todos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "") || "0");
  while (rede.length < 4) rede.push("0");
  return `${rede.join(":")}::/64`;
}

/** Conta a tentativa nos tetos da ação: a origem (ou a chave sem origem) primeiro; só dentro dela, o geral da organização. */
export async function conferirLimite(db: Db, organizacaoId: string, acao: AcaoLimitada, origem: string | null, agora: Date = new Date()): Promise<{ ok: true } | { ok: false; erro: string }> {
  const l = LIMITES_PAGAMENTO[acao];
  const [chave, teto] = origem ? [`pagamento-${acao}:origem:${organizacaoId}:${chaveDaOrigem(origem)}`, l.origem] : [`pagamento-${acao}:sem-origem:${organizacaoId}`, l.semOrigem];
  // A origem que passou do teto não gasta a conta geral.
  if ((await contarNaJanela(db, chave, teto, agora)) > teto.tentativas) return { ok: false, erro: ERROS_LIMITE[acao] };
  const geral = await contarNaJanela(db, `pagamento-${acao}:geral:${organizacaoId}`, l.geral, agora);
  if (geral === 1) await apagarContasVelhas(db, agora);
  if (geral > l.geral.tentativas) return { ok: false, erro: ERROS_LIMITE[acao] };
  return { ok: true };
}

const resumo = (s: string) => createHash("sha256").update(s).digest();
export const ERRO_EMAIL_DO_PEDIDO = "Não encontramos um pedido com esse e-mail nesta cotação. Confira o e-mail usado ao segurar as datas.";

/**
 * "Continuar o pagamento" noutro aparelho: o e-mail usado ao segurar as datas confere com o do pedido? Com
 * tetos de tentativas; a resposta nunca diz nada do pedido (nem se existe). `ate` = validade da autorização a
 * emitir de novo (o cookie).
 */
export async function conferirEmailDoPedido(db: Db, organizacaoId: string, cotacaoId: string, email: string, origem: string | null, agora: Date = new Date()): Promise<{ ok: true; ate: Date } | { ok: false; erro: string }> {
  const limite = await conferirLimite(db, organizacaoId, "continuar", origem, agora);
  if (!limite.ok) return limite;
  if (!uuidValido(cotacaoId)) return { ok: false, erro: ERRO_EMAIL_DO_PEDIDO };
  if ((await contarNaJanela(db, `pagamento-continuar:cotacao:${cotacaoId}`, LIMITE_EMAIL_POR_COTACAO, agora)) > LIMITE_EMAIL_POR_COTACAO.tentativas) return { ok: false, erro: ERROS_LIMITE.continuar };
  const digitado = typeof email === "string" ? email.trim().toLowerCase().slice(0, 254) : "";
  const [c] = await db
    .select({ email: reservas.hospedeEmail, holdAte: cotacoes.holdAte })
    .from(cotacoes)
    .innerJoin(reservas, eq(reservas.id, cotacoes.reservaId))
    .where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  // Comparação em tempo constante (resumos de mesmo tamanho), também quando não há pedido.
  const confere = timingSafeEqual(resumo(digitado), resumo(c?.email?.toLowerCase() ?? `\u0000sem-pedido:${cotacaoId}`));
  if (!c || !digitado || !confere) return { ok: false, erro: ERRO_EMAIL_DO_PEDIDO };
  return { ok: true, ate: validadeDaAutorizacao(c.holdAte, agora) };
}
