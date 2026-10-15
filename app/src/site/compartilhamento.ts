/**
 * Prévia dos links do site (M7.13): o que o WhatsApp, as redes e o navegador mostram quando alguém manda o link de uma
 * página — título, frase, nome da empresa e foto — e o endereço principal das páginas que mudam com o que vem no link.
 *
 * Tudo vem do que já se edita no painel: o nome da empresa e o campo "Site" (Configurações → Empresa), os textos do site
 * e as fotos (a capa do site e as das casas). Nada é inventado: sem foto, a prévia sai sem imagem (nunca uma genérica);
 * sem frase própria, vale a descrição do site (o subtítulo da capa).
 *
 * O campo "Site" é a base dos endereços completos (a foto e o endereço principal), num lugar só — o mesmo que já monta os
 * links das mensagens ao hóspede. Só vale com https e um endereço válido; sem ele, o Next usa o endereço em que o site
 * está publicado na Vercel para a foto, e as páginas não indicam o endereço principal (um endereço relativo ali não diria
 * nada a quem lê a prévia).
 */
import type { Metadata } from "next";
import { type ConteudoSite, tituloDoSite } from "./site";

/** O campo "Site" como base dos endereços completos: só https, sem usuário, senha, parâmetros ou âncora; senão, nenhuma. */
export function baseDoSite(site: string | null | undefined): URL | null {
  const s = (site ?? "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password || u.search || u.hash) return null;
  return u;
}

/**
 * Nota do campo "Site" em Configurações → Empresa (M7.13): só quando o campo não serve de base (vazio, http ou inválido)
 * ou quando aponta para outro endereço que não o deste sistema agora (`hostAtual`, o endereço pelo qual o painel foi
 * aberto). É uma nota, não uma pendência: o domínio próprio depende de outro item (M11.2).
 */
export function notaDoCampoSite(site: string, hostAtual: string | null): string | null {
  const base = baseDoSite(site);
  if (!base)
    return "Sem um endereço com https:// aqui, a prévia dos links do site (WhatsApp e redes) sai pelo endereço da Vercel. Use o endereço em que o site abre hoje.";
  const atual = (hostAtual ?? "").trim().toLowerCase();
  if (atual && base.host.toLowerCase() !== atual)
    return `Este sistema está aberto agora em ${atual}, e este campo diz ${base.host}. Os links das mensagens ao hóspede e a prévia dos links do site usam este campo: enquanto ${base.host} não abrir este sistema, use o endereço de agora.`;
  return null;
}

/** Descrição do site, para as páginas sem frase própria: o subtítulo da capa (editável em Configurações → Textos do site). */
export function descricaoDoSite(conteudo: Pick<ConteudoSite, "nomeEmpresa" | "textos"> | null): string {
  return conteudo ? conteudo.textos.subtitulo.trim() || tituloDoSite(conteudo) : "Site em configuração.";
}

export type ImagemDaPrevia = { url: string; alt?: string };

/** O que cada página diz da própria prévia. */
export type PreviaDaPagina = {
  /** Frase da página (de um texto editável ou da descrição da casa); vazia = a descrição do site. */
  descricao?: string | null;
  /** Foto da prévia: omitida = a capa do site (a versão pequena); null = nenhuma (a casa sem foto). */
  imagem?: ImagemDaPrevia | null;
  /** Endereço principal da página, sem parâmetros (`/imoveis/403`, `/consulta`); só sai com a base do campo "Site". */
  caminho?: string;
};

type ConteudoDaPrevia = Pick<ConteudoSite, "nomeEmpresa" | "textos" | "imagens" | "site">;

/**
 * Metadados de uma página do site: título "Página — Nome da empresa", a frase da página, a prévia dos links (Open Graph,
 * lido também pelo WhatsApp, e a do X) e, com a base do campo "Site", o endereço principal (canonical e og:url).
 */
export function metadadosDaPagina(conteudo: ConteudoDaPrevia | null, pagina?: string, previa: PreviaDaPagina = {}): Metadata {
  const title = tituloDoSite(conteudo, pagina) || "Site em configuração";
  if (!conteudo) return { title, description: descricaoDoSite(null) };
  const description = previa.descricao?.trim() || descricaoDoSite(conteudo);
  const capa = conteudo.imagens.previa ?? conteudo.imagens.capa;
  const imagem = previa.imagem === undefined ? (capa ? { url: capa } : null) : previa.imagem;
  const base = baseDoSite(conteudo.site);
  const caminho = base ? previa.caminho : undefined;
  const siteName = conteudo.nomeEmpresa.trim();
  return {
    title,
    description,
    ...(base && { metadataBase: base }),
    ...(caminho && { alternates: { canonical: caminho } }),
    openGraph: {
      type: "website",
      locale: "pt_BR",
      title,
      description,
      ...(siteName && { siteName }),
      ...(caminho && { url: caminho }),
      ...(imagem && { images: [imagem] }),
    },
    twitter: { card: imagem ? "summary_large_image" : "summary", title, description, ...(imagem && { images: [imagem] }) },
  };
}
