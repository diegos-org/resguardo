/**
 * Prévia dos links do site (M7.13): o que o WhatsApp, as redes e o navegador mostram quando alguém manda o link de uma
 * página — título, frase, nome da empresa e foto — e o endereço principal das páginas que mudam com o que vem no link.
 *
 * Tudo vem do que já se edita no painel: o nome da empresa e o campo "Site" (Configurações → Empresa), os textos do site
 * e as fotos (a capa do site e as das casas). Nada é inventado: sem foto, a prévia sai sem imagem (nunca uma genérica);
 * sem frase própria, vale a descrição do site (o subtítulo da capa).
 *
 * O campo "Site" é lido aqui, num lugar só: a mesma regra (`baseDoSite`) monta os links das mensagens ao hóspede
 * (`linkDoSite`) e a base dos endereços completos da prévia (a foto e o endereço principal). Na prévia, ele só vale
 * quando é o endereço pelo qual a página foi pedida (`baseConfirmada`): um endereço que ainda não abre o sistema (o
 * domínio próprio antes do M11.2) deixaria a foto quebrada e mandaria o endereço principal para fora. Sem a base, o Next
 * completa a foto com o endereço em que o site está publicado na Vercel, e as páginas não indicam o endereço principal
 * (um endereço relativo ali não diria nada a quem lê a prévia).
 */
import type { Metadata } from "next";
import { iconesDoSite } from "./icone";
import { type ConteudoSite, tituloDoSite } from "./site";

/** O que o campo "Site" tem: a base, ou por que ele não serve (o formato, ou o caminho de uma página depois do endereço). */
type LeituraDoCampoSite = { base: URL; problema: null } | { base: null; problema: "formato" | "caminho" };

function lerCampoSite(site: string | null | undefined): LeituraDoCampoSite {
  const s = (site ?? "").trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { base: null, problema: "formato" };
  }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password || u.search || u.hash) return { base: null, problema: "formato" };
  // Só o endereço do site: com o caminho de uma página (o link de uma casa colado no lugar), ele iria na frente de todos
  // os links e de todas as fotos (`/imoveis/403/reservar/…`), todos quebrados.
  if (u.pathname !== "/") return { base: null, problema: "caminho" };
  return { base: u, problema: null };
}

/** O campo "Site" como base dos endereços completos: só https e só o endereço (sem caminho, usuário, senha, parâmetros ou âncora); senão, nenhuma. */
export function baseDoSite(site: string | null | undefined): URL | null {
  return lerCampoSite(site).base;
}

/**
 * Link completo de uma página do site (`/reservar/<código>`) pelo campo "Site", para as mensagens ao hóspede: a mesma
 * base da prévia. Sem base válida, vazio — a mensagem mostra o link como o que falta, nunca um link quebrado.
 */
export function linkDoSite(site: string | null | undefined, caminho: string): string {
  const base = baseDoSite(site);
  return base ? new URL(caminho, base).href : "";
}

const hostDe = (h: string | null | undefined) => (h ?? "").trim().toLowerCase();

/** A base do campo "Site" só quando o endereço dela é `host` (o endereço que abre o sistema); senão, nenhuma. */
export function baseConfirmada(site: string | null | undefined, host: string | null | undefined): URL | null {
  const base = baseDoSite(site);
  const h = hostDe(host);
  return base && h && base.host === h ? base : null;
}

/**
 * O endereço em que este sistema abre, para a nota do campo "Site": na Vercel, o de produção do projeto
 * (`VERCEL_PROJECT_PRODUCTION_URL`, que passa a ser o domínio próprio quando ele for ligado, M11.2; o mesmo que o Next usa
 * para completar a foto sem a base); fora dela, o endereço em que o painel foi aberto. Nunca o de uma publicação avulsa
 * ou de uma prévia da Vercel, que fica preso àquela versão.
 */
export function enderecoDoSistema(hostAtual: string | null | undefined, producao: string | null | undefined = process.env.VERCEL_PROJECT_PRODUCTION_URL): string | null {
  return hostDe(producao) || hostDe(hostAtual) || null;
}

/**
 * Nota do campo "Site" em Configurações → Empresa (M7.13): só quando o campo não serve de base (vazio, http, inválido ou
 * com o caminho de uma página) ou quando aponta para outro endereço que não o deste sistema (`enderecoDoSistema`). É uma
 * nota, não uma pendência: o domínio próprio depende de outro item (M11.2).
 */
export function notaDoCampoSite(site: string, hostAtual: string | null, producao: string | null | undefined = process.env.VERCEL_PROJECT_PRODUCTION_URL): string | null {
  const { base, problema } = lerCampoSite(site);
  const sistema = enderecoDoSistema(hostAtual, producao);
  const efeito = "os links das mensagens ao hóspede ficam faltando e a prévia dos links do site (WhatsApp e redes) sai pelo endereço da Vercel";
  if (problema === "caminho") return `Use só o endereço do site, sem o caminho de uma página${sistema ? ` (hoje, https://${sistema})` : ""}. Do jeito que está, ${efeito}.`;
  if (!base) return `Sem um endereço válido com https:// aqui, ${efeito}. Use o endereço em que o site abre hoje${sistema ? `: https://${sistema}` : ""}.`;
  if (sistema && !baseConfirmada(site, sistema))
    return `Este sistema abre hoje em ${sistema}, e este campo diz ${base.host}. Os links das mensagens ao hóspede usam este campo e a prévia dos links do site sai pelo endereço da Vercel: enquanto ${base.host} não abrir este sistema, use https://${sistema}.`;
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
  /** Endereço principal da página, sem parâmetros (`/imoveis/403`, `/consulta`); só sai com a base confirmada do campo "Site". */
  caminho?: string;
};

type ConteudoDaPrevia = Pick<ConteudoSite, "nomeEmpresa" | "textos" | "imagens" | "site">;

/**
 * Metadados de uma página do site: título "Página — Nome da empresa", a frase da página, a prévia dos links (Open Graph,
 * lido também pelo WhatsApp, e a do X), o ícone da aba (M7.18: a marca enviada que serve de ícone, ou a do estudo; regra
 * em ./icone) e, com a base do campo "Site" confirmada pelo endereço em que a página foi pedida (`host`), o endereço
 * principal (canonical e og:url). Site em configuração: só o título e a descrição (o ícone é o do layout raiz).
 */
export function metadadosDaPagina(conteudo: ConteudoDaPrevia | null, pagina?: string, previa: PreviaDaPagina = {}, host: string | null = null): Metadata {
  const title = tituloDoSite(conteudo, pagina) || "Site em configuração";
  if (!conteudo) return { title, description: descricaoDoSite(null) };
  const description = previa.descricao?.trim() || descricaoDoSite(conteudo);
  const capa = conteudo.imagens.previa ?? conteudo.imagens.capa;
  const imagem = previa.imagem === undefined ? (capa ? { url: capa } : null) : previa.imagem;
  const base = baseConfirmada(conteudo.site, host);
  const caminho = base ? previa.caminho : undefined;
  const siteName = conteudo.nomeEmpresa.trim();
  return {
    title,
    description,
    icons: iconesDoSite(conteudo.imagens.icone),
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
