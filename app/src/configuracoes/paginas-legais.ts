/**
 * Páginas legais do site (M7.4) no banco: cada documento é uma chave de configuração com as suas versões (motor de
 * `documentos-versionados.ts`), com numeração e trava próprias — publicar um nunca mexe nos outros. Cada versão
 * congela os valores dos `{{campos}}` que o texto usa (dados da empresa no dia) e, na Política de cancelamento, o
 * prazo do reembolso integral (`regras`), que é o número que o texto mostra e que a devolução (M8.2c) usa.
 * Publicar é recusado quando falta um dado usado, quando o texto usa um campo que não existe ou fora do lugar e quando a
 * Política de cancelamento não mostra o prazo pelo campo — avisar em vez de supor. Não há "despublicar": o pagamento do
 * site só é oferecido com os três publicados, e toda versão continua no site para quem a aceitou.
 */
import type { Db } from "@/db/types";
import { travarConfigCompartilhada } from "./armazem";
import { type DefinicaoDocumento, lerVersoes, publicarVersao, type ResultadoPublicacao, type VersaoDocumento, versaoAtual } from "./documentos-versionados";
import { lerEmpresa } from "./empresa";
import {
  CAMPOS_LEGAIS,
  type CampoLegal,
  conferirCampos,
  DIAS_REEMBOLSO_MAX,
  DIAS_REEMBOLSO_MIN,
  DOCUMENTOS_LEGAIS,
  type DocumentoLegal,
  MENSAGEM_SEM_PRAZO,
  mensagemDosCampos,
  PAGINAS_LEGAIS,
  type RegrasCancelamento,
  type SecaoLegal,
  validarPaginaLegal,
  valoresDisponiveis,
  type VersoesLegais,
} from "./paginas-legais-texto";

/** O que cada versão congela além do texto: os valores dos campos usados e, só no cancelamento, o prazo. */
export type ExtraLegal = { valores: Partial<Record<CampoLegal, string>>; regras: RegrasCancelamento | null };
/** Versão publicada. Só a Política de cancelamento tem `secoes.resumo`; nas outras, só `secoes.texto`. */
export type VersaoPaginaLegal = VersaoDocumento<SecaoLegal, ExtraLegal>;

const diasValidos = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= DIAS_REEMBOLSO_MIN && v <= DIAS_REEMBOLSO_MAX;

function definicao(doc: DocumentoLegal): DefinicaoDocumento<SecaoLegal, ExtraLegal> {
  const p = PAGINAS_LEGAIS[doc];
  return {
    chave: p.chave,
    acaoAuditoria: p.acaoAuditoria,
    secoes: p.secoes,
    lerExtra: (x) => {
      const gravados = x.valores && typeof x.valores === "object" ? (x.valores as Record<string, unknown>) : {};
      const valores: Partial<Record<CampoLegal, string>> = {};
      for (const c of CAMPOS_LEGAIS) {
        const v = gravados[c.chave];
        if (typeof v === "string" && v.trim()) valores[c.chave] = v.trim().slice(0, 300);
      }
      const dias = x.regras && typeof x.regras === "object" ? (x.regras as Record<string, unknown>).diasReembolsoIntegral : undefined;
      return { valores, regras: doc === "cancelamento" && diasValidos(dias) ? { diasReembolsoIntegral: dias } : null };
    },
    mudancasDoExtra: (antes, depois) => {
      const m: Record<string, [unknown, unknown]> = {};
      for (const c of CAMPOS_LEGAIS) {
        const a = antes?.valores[c.chave] ?? null;
        const b = depois.valores[c.chave] ?? null;
        if (a !== b) m[`campo.${c.chave}`] = [a, b];
      }
      const a = antes?.regras?.diasReembolsoIntegral ?? null;
      const b = depois.regras?.diasReembolsoIntegral ?? null;
      if (a !== b) m["regra.diasReembolsoIntegral"] = [a, b];
      return m;
    },
  };
}

export const DEFINICOES_LEGAIS: Record<DocumentoLegal, DefinicaoDocumento<SecaoLegal, ExtraLegal>> = {
  termos: definicao("termos"),
  privacidade: definicao("privacidade"),
  cancelamento: definicao("cancelamento"),
};

export async function lerPaginaLegal(db: Db, organizacaoId: string, doc: DocumentoLegal): Promise<VersaoPaginaLegal[]> {
  return lerVersoes(db, DEFINICOES_LEGAIS[doc], organizacaoId);
}

/** As versões dos três documentos (uma leitura depois da outra: serve também dentro de uma transação). */
export async function lerPaginasLegais(db: Db, organizacaoId: string): Promise<Record<DocumentoLegal, VersaoPaginaLegal[]>> {
  const todas = {} as Record<DocumentoLegal, VersaoPaginaLegal[]>;
  for (const doc of DOCUMENTOS_LEGAIS) todas[doc] = await lerPaginaLegal(db, organizacaoId, doc);
  return todas;
}

/** Números das versões em vigor dos três documentos, ou null se algum ainda não foi publicado. Sem trava (telas e portão). */
export async function versoesLegaisAtuais(db: Db, organizacaoId: string): Promise<VersoesLegais | null> {
  const todas = await lerPaginasLegais(db, organizacaoId);
  const numeros = {} as VersoesLegais;
  for (const doc of DOCUMENTOS_LEGAIS) {
    const atual = versaoAtual(todas[doc]);
    if (!atual) return null;
    numeros[doc] = atual.numero;
  }
  return numeros;
}

/**
 * Número da versão em vigor de um só documento, ou null se ainda não foi publicado. Para o aviso da Política de
 * privacidade no formulário de segurar as datas, que vale assim que ela é publicada (o portão do pagamento é que
 * espera os três).
 */
export async function versaoAtualDaPaginaLegal(db: Db, organizacaoId: string, doc: DocumentoLegal): Promise<number | null> {
  return versaoAtual(await lerPaginaLegal(db, organizacaoId, doc))?.numero ?? null;
}

/**
 * O mesmo, sob a trava **compartilhada** de cada documento (na ordem de `DOCUMENTOS_LEGAIS`), até o fim da transação:
 * ninguém publica no meio, e os hóspedes não esperam uns pelos outros. Só dentro de uma transação, e só depois das
 * travas de linha do pagamento (imóvel → reserva → cotação): a publicação não trava linha nenhuma, então não há ciclo.
 */
export async function versoesLegaisTravadas(tx: Db, organizacaoId: string): Promise<VersoesLegais | null> {
  for (const doc of DOCUMENTOS_LEGAIS) await travarConfigCompartilhada(tx, organizacaoId, PAGINAS_LEGAIS[doc].chave);
  return versoesLegaisAtuais(tx, organizacaoId);
}

/**
 * Publica a versão seguinte de um documento (datada de hoje) quando o texto, um valor usado ou o prazo mudou; tudo
 * igual não cria versão. O texto é conferido de novo aqui (deny-by-default); os campos são conferidos com os dados da
 * empresa lidos na mesma transação, e só os valores usados ficam na versão. `versaoBase`: ver `publicarVersao`.
 */
export async function publicarPaginaLegal(
  db: Db,
  organizacaoId: string,
  doc: DocumentoLegal,
  entrada: { secoes: Record<string, string>; diasReembolsoIntegral: number | null },
  autorId: string | null,
  hoje: string,
  versaoBase?: number,
): Promise<ResultadoPublicacao<VersaoPaginaLegal>> {
  const v = validarPaginaLegal(doc, { ...entrada.secoes, diasReembolsoIntegral: entrada.diasReembolsoIntegral ?? "" });
  if (!v.ok) return { ok: false, erro: v.mensagem, erros: v.erros, atual: versaoAtual(await lerPaginaLegal(db, organizacaoId, doc)) };
  const { secoes, diasReembolsoIntegral } = v.entrada;
  return publicarVersao(db, DEFINICOES_LEGAIS[doc], organizacaoId, secoes as Record<SecaoLegal, string>, autorId, hoje, versaoBase, async (tx) => {
    const regras = doc === "cancelamento" && diasReembolsoIntegral !== null ? { diasReembolsoIntegral } : null;
    const c = conferirCampos(doc, secoes, valoresDisponiveis(await lerEmpresa(tx, organizacaoId), regras));
    const problema = mensagemDosCampos(c);
    if (problema) return { ok: false, erro: problema };
    if (doc === "cancelamento" && !c.usados.includes("dias_reembolso_integral")) {
      return { ok: false, erro: MENSAGEM_SEM_PRAZO };
    }
    return { ok: true, extra: { valores: c.valoresUsados, regras } };
  });
}

/** Valores usados que mudaram na empresa depois da versão (o painel pede para publicar de novo). O prazo não entra. */
export function camposDesatualizados(v: VersaoPaginaLegal, agora: Partial<Record<CampoLegal, string>>): CampoLegal[] {
  return CAMPOS_LEGAIS.map((c) => c.chave).filter((k) => k !== "dias_reembolso_integral" && v.valores[k] !== undefined && (agora[k]?.trim() ?? "") !== v.valores[k]);
}

/** Prazo da versão N da Política de cancelamento (para a prova do aceite e para a devolução, M8.2c). */
export async function regraDaPoliticaDeCancelamento(db: Db, organizacaoId: string, versao: number): Promise<RegrasCancelamento | null> {
  return (await lerPaginaLegal(db, organizacaoId, "cancelamento")).find((x) => x.numero === versao)?.regras ?? null;
}
