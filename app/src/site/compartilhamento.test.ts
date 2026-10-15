import { describe, expect, it } from "vitest";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { baseDoSite, descricaoDoSite, metadadosDaPagina, notaDoCampoSite } from "./compartilhamento";
import type { ConteudoSite } from "./site";

// Dados fictícios.
const conteudo = (resto: Partial<ConteudoSite> = {}): ConteudoSite => ({
  organizacaoId: "org",
  nomeEmpresa: "Casa Exemplo",
  textos: { ...TEXTOS_SITE_INICIAIS },
  whatsapp: null,
  email: "",
  imagens: { capa: "/imagens-site/capa", marca: "/marca.png", previa: "/imagens-site/capa-pequena" },
  site: "https://casa-exemplo.vercel.app",
  ...resto,
});
const semCapa = { capa: null, marca: "/marca.png", previa: null };
const FOTO = { url: "/fotos/f1/pequena", alt: "Sala com vista" };

describe("base dos endereços completos: o campo Site (M7.13)", () => {
  it("só https com um endereço válido", () => {
    expect(baseDoSite("https://casa-exemplo.vercel.app")?.href).toBe("https://casa-exemplo.vercel.app/");
    expect(baseDoSite("  https://casa-exemplo.vercel.app/  ")?.host).toBe("casa-exemplo.vercel.app");
    for (const s of ["", "   ", null, undefined, "http://casa-exemplo.vercel.app", "https://", "casa-exemplo.vercel.app", "ftp://casa-exemplo.vercel.app"]) expect(baseDoSite(s)).toBeNull();
    // Nada de usuário, senha, parâmetros ou âncora na base de todos os links.
    for (const s of ["https://user:senha@casa-exemplo.vercel.app", "https://casa-exemplo.vercel.app/?utm=1", "https://casa-exemplo.vercel.app/#topo"]) expect(baseDoSite(s)).toBeNull();
  });

  it("nota no painel: sem https, ou com um endereço diferente do que está aberto agora; senão, nenhuma", () => {
    for (const s of ["", "http://casa-exemplo.vercel.app", "https://"]) expect(notaDoCampoSite(s, "casa-exemplo.vercel.app")).toContain("Sem um endereço com https://");
    expect(notaDoCampoSite("https://casa-exemplo.vercel.app", "casa-exemplo.vercel.app")).toBeNull();
    expect(notaDoCampoSite("https://Casa-Exemplo.vercel.app/", "casa-exemplo.vercel.app")).toBeNull();
    // Um domínio que ainda não abre este sistema (o próprio, antes de apontar para cá): a nota diz os dois endereços.
    const nota = notaDoCampoSite("https://www.exemplo.com.br", "casa-exemplo.vercel.app");
    expect(nota).toContain("casa-exemplo.vercel.app");
    expect(nota).toContain("www.exemplo.com.br");
    // Sem saber o endereço de agora, não supõe nada.
    expect(notaDoCampoSite("https://www.exemplo.com.br", null)).toBeNull();
  });
});

describe("metadados e prévia dos links de cada página (M7.13)", () => {
  it("início: a capa do site (versão pequena), o nome da empresa e o subtítulo; a base do campo Site", () => {
    const m = metadadosDaPagina(conteudo());
    expect(m).toMatchObject({ title: "Casa Exemplo", description: TEXTOS_SITE_INICIAIS.subtitulo });
    expect(String(m.metadataBase)).toBe("https://casa-exemplo.vercel.app/");
    expect(m.openGraph).toEqual({
      type: "website",
      locale: "pt_BR",
      title: "Casa Exemplo",
      description: TEXTOS_SITE_INICIAIS.subtitulo,
      siteName: "Casa Exemplo",
      images: [{ url: "/imagens-site/capa-pequena" }],
    });
    expect(m.twitter).toEqual({ card: "summary_large_image", title: "Casa Exemplo", description: TEXTOS_SITE_INICIAIS.subtitulo, images: [{ url: "/imagens-site/capa-pequena" }] });
    // Sem `caminho`, nenhuma página indica endereço principal.
    expect(m.alternates).toBeUndefined();
    expect(m.openGraph).not.toHaveProperty("url");
  });

  it("capa enviada antes da versão pequena: a prévia usa a grande", () => {
    const m = metadadosDaPagina(conteudo({ imagens: { capa: "/imagens-site/capa", marca: "/marca.png" } }));
    expect(m.openGraph?.images).toEqual([{ url: "/imagens-site/capa" }]);
  });

  it("sem foto, a prévia sai sem imagem (nunca uma genérica): o site sem capa e a casa sem foto, mesmo com a capa do site", () => {
    const semFoto = metadadosDaPagina(conteudo({ imagens: semCapa }));
    expect(semFoto.openGraph).not.toHaveProperty("images");
    expect(semFoto.twitter).toEqual({ card: "summary", title: "Casa Exemplo", description: TEXTOS_SITE_INICIAIS.subtitulo });
    const casa = metadadosDaPagina(conteudo(), "Studio Exemplo", { descricao: "Um refúgio para dois.", imagem: null, caminho: "/imoveis/403" });
    expect(casa.openGraph).not.toHaveProperty("images");
    expect(casa.twitter).toMatchObject({ card: "summary" });
    expect(JSON.stringify(casa)).not.toContain("/imagens-site/");
  });

  it("casa: o nome, a frase dela, a foto pequena da capa e o endereço principal sem as datas", () => {
    const m = metadadosDaPagina(conteudo(), "Studio Exemplo", { descricao: "Um refúgio para dois.", imagem: FOTO, caminho: "/imoveis/403" });
    expect(m).toMatchObject({ title: "Studio Exemplo — Casa Exemplo", description: "Um refúgio para dois.", alternates: { canonical: "/imoveis/403" } });
    expect(m.openGraph).toMatchObject({ title: "Studio Exemplo — Casa Exemplo", siteName: "Casa Exemplo", url: "/imoveis/403", images: [FOTO] });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: [FOTO] });
  });

  it("site com http, vazio ou inválido: sem base e sem endereço principal (nada de endereço relativo enganoso); a foto continua", () => {
    for (const site of ["http://casa-exemplo.vercel.app", "", "https://", undefined]) {
      const m = metadadosDaPagina(conteudo({ site }), "Consulta", { caminho: "/consulta" });
      expect(m.metadataBase).toBeUndefined();
      expect(m.alternates).toBeUndefined();
      expect(m.openGraph).not.toHaveProperty("url");
      // A foto vai com o caminho; sem base, o Next a completa com o endereço do site na Vercel.
      expect(m.openGraph?.images).toEqual([{ url: "/imagens-site/capa-pequena" }]);
    }
  });

  it("consulta: o endereço principal é /consulta, sem as datas nem as pessoas", () => {
    const m = metadadosDaPagina(conteudo(), "Consulta", { descricao: TEXTOS_SITE_INICIAIS.consultaTexto, caminho: "/consulta" });
    expect(m).toMatchObject({ description: TEXTOS_SITE_INICIAIS.consultaTexto, alternates: { canonical: "/consulta" }, openGraph: { url: "/consulta" } });
  });

  it("descrição: a da página; vazia, a do site (o subtítulo; sem ele, o nome da empresa); nunca um texto inventado", () => {
    expect(metadadosDaPagina(conteudo(), "Nossas casas", { descricao: "Seu jeito de se sentir em casa no Rio." }).description).toBe("Seu jeito de se sentir em casa no Rio.");
    for (const descricao of ["", "   ", null, undefined]) expect(metadadosDaPagina(conteudo(), "Nossas casas", { descricao }).description).toBe(TEXTOS_SITE_INICIAIS.subtitulo);
    const semSubtitulo = conteudo({ textos: { ...TEXTOS_SITE_INICIAIS, subtitulo: " " } });
    expect(descricaoDoSite(semSubtitulo)).toBe("Casa Exemplo");
    expect(metadadosDaPagina(semSubtitulo).description).toBe("Casa Exemplo");
  });

  it("sem empresa no nome, a prévia não inventa um nome de site", () => {
    const m = metadadosDaPagina(conteudo({ nomeEmpresa: "  " }), "Consulta");
    expect(m.title).toBe("Consulta");
    expect(m.openGraph).not.toHaveProperty("siteName");
  });

  it("site em configuração: só o título e a descrição-base, sem prévia", () => {
    expect(metadadosDaPagina(null, "Consulta", { caminho: "/consulta", imagem: FOTO })).toEqual({ title: "Consulta", description: "Site em configuração." });
    expect(metadadosDaPagina(null)).toEqual({ title: "Site em configuração", description: "Site em configuração." });
  });
});
