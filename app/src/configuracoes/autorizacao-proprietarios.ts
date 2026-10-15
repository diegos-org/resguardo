/**
 * Texto das caixas de autorização dos proprietários (M7.15, 15/10/2026), no banco: cada caixa de "Anuncie seu imóvel"
 * (o pedido de contato para a gestão completa e o cadastro do marketplace) é um documento do motor de versões
 * (`documentos-versionados.ts`, o do "Como funciona" e das páginas legais), numa chave de configuração própria, com
 * numeração e trava próprias: publicar uma caixa nunca mexe na outra. A versão 1 de cada uma é a de origem, o texto do
 * M7.14 (`TEXTOS_ORIGEM_AUTORIZACAO`), que vale enquanto nada for publicado; a primeira publicação no painel é a 2.
 *
 * Daqui leem a página (o texto ao lado da caixa e a marca do campo escondido) e o servidor no envio (conferência da
 * marca e o texto gravado), sempre a versão em vigor com o nome da empresa de agora. As regras do texto (vazio, tamanho,
 * texto puro) ficam no módulo puro `proprietarios/autorizacao.ts`, usadas no painel e conferidas de novo aqui.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { cadastrosMarketplace, pedidosContatoProprietario } from "@/db/schema";
import type { Db } from "@/db/types";
import {
  type FormularioProprietario,
  LIMITE_TEXTO_AUTORIZACAO,
  montarAutorizacao,
  type TextoAutorizacao,
  TEXTOS_ORIGEM_AUTORIZACAO,
  VERSAO_ORIGEM_AUTORIZACAO,
  validarTextoAutorizacao,
} from "@/proprietarios/autorizacao";
import { type ChaveConfig, travarConfigCompartilhada } from "./armazem";
import { type DefinicaoDocumento, lerVersoes, publicarVersao, type ResultadoPublicacao, type VersaoDocumento, versaoEmVigor, versoesComOrigem } from "./documentos-versionados";
import { lerEmpresa } from "./empresa";

type Secao = "texto";
type SemExtra = Record<never, never>;
/** Versão do texto de uma caixa; `data` vazia = a versão de origem (1), que nunca foi publicada no banco. */
export type VersaoAutorizacao = VersaoDocumento<Secao, SemExtra>;

/** Cada caixa: o nome no painel, onde aparece no site, a chave da configuração e a ação do histórico. */
export const CAIXAS_AUTORIZACAO: Record<FormularioProprietario, { titulo: string; onde: string; chave: ChaveConfig; acaoAuditoria: string }> = {
  contato: {
    titulo: "Pedido de contato para a gestão completa",
    onde: "Anuncie seu imóvel, no formulário “Pedir contato”",
    chave: "autorizacao_contato",
    acaoAuditoria: "configuracao.autorizacao_contato",
  },
  cadastro: {
    titulo: "Cadastro do marketplace",
    onde: "Anuncie seu imóvel, no passo dos dados do imóvel (depois de confirmar o e-mail)",
    chave: "autorizacao_cadastro",
    acaoAuditoria: "configuracao.autorizacao_cadastro",
  },
};

function definicao(f: FormularioProprietario): DefinicaoDocumento<Secao, SemExtra> {
  return {
    chave: CAIXAS_AUTORIZACAO[f].chave,
    acaoAuditoria: CAIXAS_AUTORIZACAO[f].acaoAuditoria,
    secoes: [{ chave: "texto", titulo: "Texto da caixa", dica: "", limite: LIMITE_TEXTO_AUTORIZACAO }],
    // Nada além do texto: o nome da empresa entra na hora de mostrar e de gravar (como no M7.14), não na versão.
    lerExtra: () => ({}),
    mudancasDoExtra: () => ({}),
    origem: { numero: VERSAO_ORIGEM_AUTORIZACAO, secoes: { texto: TEXTOS_ORIGEM_AUTORIZACAO[f] } },
  };
}

export const DEFINICOES_AUTORIZACAO: Record<FormularioProprietario, DefinicaoDocumento<Secao, SemExtra>> = { contato: definicao("contato"), cadastro: definicao("cadastro") };

/** Versões publicadas no painel (sem a de origem), da mais antiga para a mais nova. */
export const lerVersoesAutorizacao = (db: Db, organizacaoId: string, f: FormularioProprietario): Promise<VersaoAutorizacao[]> => lerVersoes(db, DEFINICOES_AUTORIZACAO[f], organizacaoId);

/** A versão em vigor: a última publicada ou, sem nenhuma, a de origem (1). Nunca vazia. */
export const versaoDaAutorizacaoEmVigor = (f: FormularioProprietario, publicadas: readonly VersaoAutorizacao[]): VersaoAutorizacao => versaoEmVigor(DEFINICOES_AUTORIZACAO[f], publicadas)!;

/** Todas as versões da caixa, com a de origem (1) na frente: o histórico que o painel mostra. */
export const historicoDaAutorizacao = (f: FormularioProprietario, publicadas: readonly VersaoAutorizacao[]): VersaoAutorizacao[] => versoesComOrigem(DEFINICOES_AUTORIZACAO[f], publicadas);

/** O texto que aparece agora ao lado da caixa: a versão em vigor com o nome de Configurações → Empresa de agora. */
export async function autorizacaoEmVigor(db: Db, organizacaoId: string, f: FormularioProprietario): Promise<TextoAutorizacao> {
  const v = versaoDaAutorizacaoEmVigor(f, await lerVersoesAutorizacao(db, organizacaoId, f));
  return montarAutorizacao(v.numero, v.secoes.texto, (await lerEmpresa(db, organizacaoId)).nome);
}

/**
 * No envio, dentro da transação que grava: confere se a marca enviada é a do texto em vigor. A trava compartilhada da
 * chave (até o fim da transação) faz o envio esperar uma publicação em andamento, e a publicação esperar os envios: o
 * texto gravado é o que estava em vigor na hora da gravação. Sempre devolve o texto em vigor — o que se grava (quando
 * confere) ou o que o formulário passa a mostrar (quando não confere).
 */
export async function conferirAutorizacao(tx: Db, organizacaoId: string, f: FormularioProprietario, marcaEnviada: string): Promise<{ ok: boolean; autorizacao: TextoAutorizacao }> {
  await travarConfigCompartilhada(tx, organizacaoId, CAIXAS_AUTORIZACAO[f].chave);
  const autorizacao = await autorizacaoEmVigor(tx, organizacaoId, f);
  return { ok: marcaEnviada === autorizacao.marca, autorizacao };
}

/**
 * Publica a versão seguinte do texto de uma caixa (datada de hoje) quando ele mudou; o mesmo texto da versão em vigor
 * (inclusive o da origem) não cria versão. O texto é conferido de novo aqui (deny-by-default): vazio, longo demais ou
 * com o que a caixa não mostra como texto puro é recusado sem gravar. `versaoBase`: ver `publicarVersao`. Vale dali em
 * diante: os envios já gravados continuam com o texto que guardam, e quem estava com a página aberta é recusado e vê o
 * texto novo.
 */
export async function publicarTextoAutorizacao(
  db: Db,
  organizacaoId: string,
  f: FormularioProprietario,
  textoBruto: unknown,
  autorId: string | null,
  hoje: string,
  versaoBase?: number,
): Promise<ResultadoPublicacao<VersaoAutorizacao>> {
  const def = DEFINICOES_AUTORIZACAO[f];
  const v = validarTextoAutorizacao(textoBruto);
  if (!v.ok) return { ok: false, erro: v.erro, erros: { texto: v.erro }, atual: versaoEmVigor(def, await lerVersoes(db, def, organizacaoId)) };
  return publicarVersao(db, def, organizacaoId, { texto: v.texto }, autorId, hoje, versaoBase, async () => ({ ok: true, extra: {} }));
}

/** Por versão do texto: quantos envios a guardaram e quando chegou o primeiro (só contagem e data, sem dado pessoal). */
export type EnviosDaVersao = { envios: number; primeiro: Date | null };

/** Os envios de cada versão da caixa, para o histórico do painel. Os de antes do M7.14 (sem registro) não entram. */
export async function enviosPorVersao(db: Db, organizacaoId: string, f: FormularioProprietario): Promise<Map<number, EnviosDaVersao>> {
  const t = f === "contato" ? pedidosContatoProprietario : cadastrosMarketplace;
  // A data mais antiga sai em texto ISO (UTC) do próprio banco: igual em qualquer driver.
  const linhas = await db
    .select({
      versao: t.autorizacaoVersao,
      envios: sql<number>`count(*)::int`,
      primeiro: sql<string | null>`to_char(min(${t.autorizadoEm}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(t)
    .where(and(eq(t.organizacaoId, organizacaoId), isNotNull(t.autorizacaoVersao)))
    .groupBy(t.autorizacaoVersao);
  return new Map(linhas.filter((l) => l.versao !== null).map((l) => [l.versao as number, { envios: Number(l.envios), primeiro: l.primeiro ? new Date(l.primeiro) : null }]));
}
