/**
 * Páginas legais no site (M7.4): `/termos`, `/privacidade` e `/cancelamento`. Mostram a versão publicada em vigor — ou,
 * com `?versao=N`, uma versão anterior, que continua no site para quem a aceitou (nada é despublicado) — com os dados da
 * empresa congelados naquela versão. Sem versão publicada, a página diz que está em preparação: o texto-base do painel
 * nunca aparece para o hóspede.
 */
import type { Metadata } from "next";
import { versaoAtual } from "@/configuracoes/documentos-versionados";
import { lerPaginaLegal } from "@/configuracoes/paginas-legais";
import { type Bloco, blocosDoDocumento, type DocumentoLegal, PAGINAS_LEGAIS, preencherCampos } from "@/configuracoes/paginas-legais-texto";
import type { Db } from "@/db/types";
import { carregarSite, metadadosDoSite } from "./pagina";

export type VistaPaginaLegal =
  | { tipo: "em_preparacao"; titulo: string }
  | {
      tipo: "versao";
      titulo: string;
      numero: number;
      data: string;
      /** Versão em vigor (a mesma de `numero` quando a página mostra a atual). */
      atual: { numero: number; data: string };
      /** Data da versão seguinte, quando a mostrada já foi substituída; null = é a atual. */
      substituidaEm: string | null;
      /** Só na Política de cancelamento: o resumo que aparece também junto da caixa de aceite. */
      resumo: Bloco[] | null;
      blocos: Bloco[];
      /** Todas as versões publicadas, da mais nova para a mais antiga. */
      versoes: { numero: number; data: string }[];
    };

/** `?versao=` aceito: só dígitos (até 6). Repetido, vazio ou com outra coisa não é versão nenhuma. */
const numeroPedido = (v: string | string[] | undefined): number | null => (typeof v === "string" && /^\d{1,6}$/.test(v) ? Number(v) : null);

/**
 * O que a página mostra. `versaoParam` ausente → a versão em vigor (ou "em preparação"); um número de versão publicada
 * → essa versão; qualquer outra coisa → null (a página responde "não encontrada").
 */
export async function vistaDaPaginaLegal(db: Db, organizacaoId: string, doc: DocumentoLegal, versaoParam: string | string[] | undefined): Promise<VistaPaginaLegal | null> {
  const { titulo } = PAGINAS_LEGAIS[doc];
  const versoes = await lerPaginaLegal(db, organizacaoId, doc);
  const atual = versaoAtual(versoes);
  if (versaoParam === undefined && !atual) return { tipo: "em_preparacao", titulo };
  const pedida = versaoParam === undefined ? atual?.numero : numeroPedido(versaoParam);
  const mostrada = versoes.find((v) => v.numero === pedida);
  if (!mostrada || !atual) return null;
  // Sempre os valores congelados na versão: o que o hóspede leu e aceitou não muda quando a empresa muda o cadastro.
  const preencher = (texto: string) => blocosDoDocumento(preencherCampos(texto, mostrada.valores));
  const seguinte = versoes.find((v) => v.numero > mostrada.numero);
  return {
    tipo: "versao",
    titulo,
    numero: mostrada.numero,
    data: mostrada.data,
    atual: { numero: atual.numero, data: atual.data },
    substituidaEm: seguinte?.data ?? null,
    resumo: doc === "cancelamento" && mostrada.secoes.resumo ? preencher(mostrada.secoes.resumo) : null,
    blocos: preencher(mostrada.secoes.texto),
    versoes: [...versoes].reverse().map((v) => ({ numero: v.numero, data: v.data })),
  };
}

/**
 * Metadados da página. Versão anterior (`?versao=`) e "em preparação" ficam fora dos buscadores: só a versão em vigor,
 * no endereço sem parâmetro, é indexada.
 */
export async function metadadosDaPaginaLegal(doc: DocumentoLegal, sp: Record<string, string | string[] | undefined>): Promise<Metadata> {
  const { db, conteudo } = await carregarSite();
  const publicada = conteudo ? versaoAtual(await lerPaginaLegal(db, conteudo.organizacaoId, doc)) !== null : false;
  const meta = await metadadosDoSite(PAGINAS_LEGAIS[doc].titulo);
  return sp.versao !== undefined || !publicada ? { ...meta, robots: { index: false, follow: true } } : meta;
}
