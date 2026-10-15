import { describe, expect, it } from "vitest";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { baseConfirmada, baseDoSite, descricaoDoSite, enderecoDoSistema, linkDoSite, metadadosDaPagina, notaDoCampoSite } from "./compartilhamento";
import { ICONES_PADRAO } from "./icone";
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
/** O endereço pelo qual a página foi pedida: o mesmo do campo Site dos dados fictícios. */
const HOST = "casa-exemplo.vercel.app";

describe("base dos endereços completos: o campo Site (M7.13)", () => {
  it("só https com um endereço válido, e só o endereço do site", () => {
    expect(baseDoSite("https://casa-exemplo.vercel.app")?.href).toBe("https://casa-exemplo.vercel.app/");
    expect(baseDoSite("  https://casa-exemplo.vercel.app/  ")?.host).toBe("casa-exemplo.vercel.app");
    for (const s of ["", "   ", null, undefined, "http://casa-exemplo.vercel.app", "https://", "casa-exemplo.vercel.app", "ftp://casa-exemplo.vercel.app"]) expect(baseDoSite(s)).toBeNull();
    // Nada de usuário, senha, parâmetros ou âncora na base de todos os links.
    for (const s of ["https://user:senha@casa-exemplo.vercel.app", "https://casa-exemplo.vercel.app/?utm=1", "https://casa-exemplo.vercel.app/#topo"]) expect(baseDoSite(s)).toBeNull();
    // Nem o caminho de uma página (o link de uma casa colado no lugar): iria na frente de todos os links e fotos.
    for (const s of ["https://casa-exemplo.vercel.app/imoveis/403", "https://casa-exemplo.vercel.app/site/", "https://casa-exemplo.vercel.app//"]) expect(baseDoSite(s)).toBeNull();
  });

  it("links das mensagens ao hóspede pela mesma regra: com a base, o endereço completo; sem ela (http, parâmetro, caminho), vazio", () => {
    expect(linkDoSite("https://casa-exemplo.vercel.app", "/reservar/COT-ABCDEFGH")).toBe("https://casa-exemplo.vercel.app/reservar/COT-ABCDEFGH");
    expect(linkDoSite(" https://casa-exemplo.vercel.app/ ", "/reservar/COT-ABCDEFGH")).toBe("https://casa-exemplo.vercel.app/reservar/COT-ABCDEFGH");
    for (const s of ["", "http://casa-exemplo.vercel.app", "https://casa-exemplo.vercel.app/?a=1", "https://casa-exemplo.vercel.app/imoveis/403"]) expect(linkDoSite(s, "/reservar/COT-ABCDEFGH")).toBe("");
  });

  it("base confirmada só pelo endereço que abre o sistema: o mesmo host; outro domínio ou host desconhecido, nenhuma", () => {
    expect(baseConfirmada("https://casa-exemplo.vercel.app", "casa-exemplo.vercel.app")?.href).toBe("https://casa-exemplo.vercel.app/");
    expect(baseConfirmada("https://Casa-Exemplo.vercel.app/", " CASA-EXEMPLO.vercel.app ")?.host).toBe("casa-exemplo.vercel.app");
    expect(baseConfirmada("https://www.exemplo.com.br", "casa-exemplo.vercel.app")).toBeNull();
    for (const h of [null, undefined, ""]) expect(baseConfirmada("https://casa-exemplo.vercel.app", h)).toBeNull();
    expect(baseConfirmada("http://casa-exemplo.vercel.app", "casa-exemplo.vercel.app")).toBeNull();
  });

  it("endereço do sistema: na Vercel, o de produção do projeto; fora dela, o endereço em que o painel foi aberto", () => {
    expect(enderecoDoSistema("casa-exemplo-abc123-time.vercel.app", "casa-exemplo.vercel.app")).toBe("casa-exemplo.vercel.app");
    expect(enderecoDoSistema("localhost:3000", null)).toBe("localhost:3000");
    expect(enderecoDoSistema(null, null)).toBeNull();
  });

  it("nota no painel: sem https, com caminho ou com um endereço diferente do sistema; senão, nenhuma", () => {
    for (const s of ["", "http://casa-exemplo.vercel.app", "https://", "https://casa-exemplo.vercel.app/?a=1"]) expect(notaDoCampoSite(s, HOST, null)).toContain("Sem um endereço válido com https://");
    expect(notaDoCampoSite("", HOST, null)).toContain("Use o endereço em que o site abre hoje: https://casa-exemplo.vercel.app.");
    expect(notaDoCampoSite("", null, null)).toContain("Use o endereço em que o site abre hoje.");
    expect(notaDoCampoSite("https://casa-exemplo.vercel.app", HOST, null)).toBeNull();
    expect(notaDoCampoSite("https://Casa-Exemplo.vercel.app/", HOST, null)).toBeNull();
    // O link de uma página colado no lugar: uma nota própria, com o endereço de hoje.
    const comCaminho = notaDoCampoSite("https://casa-exemplo.vercel.app/imoveis/403", HOST, null);
    expect(comCaminho).toContain("sem o caminho de uma página");
    expect(comCaminho).toContain("(hoje, https://casa-exemplo.vercel.app)");
    // Um domínio que ainda não abre este sistema (o próprio, antes de apontar para cá): a nota diz os dois endereços.
    const nota = notaDoCampoSite("https://www.exemplo.com.br", HOST, null);
    expect(nota).toContain("casa-exemplo.vercel.app");
    expect(nota).toContain("www.exemplo.com.br");
    // Sem saber o endereço do sistema, não supõe nada.
    expect(notaDoCampoSite("https://www.exemplo.com.br", null, null)).toBeNull();
  });

  it("na Vercel, a nota compara com o endereço de produção, nunca com o de uma publicação avulsa ou de uma prévia", () => {
    const producao = "casa-exemplo.vercel.app";
    // Painel aberto pelo endereço de uma publicação: com o campo certo, nenhuma nota.
    expect(notaDoCampoSite("https://casa-exemplo.vercel.app", "casa-exemplo-abc123-time.vercel.app", producao)).toBeNull();
    expect(notaDoCampoSite("https://casa-exemplo.vercel.app", "casa-exemplo-git-branch-time.vercel.app", producao)).toBeNull();
    // Com o endereço da publicação no campo, a nota pede o de produção, não o de agora.
    const nota = notaDoCampoSite("https://casa-exemplo-abc123-time.vercel.app", "casa-exemplo-abc123-time.vercel.app", producao);
    expect(nota).toContain("use https://casa-exemplo.vercel.app.");
  });
});

describe("metadados e prévia dos links de cada página (M7.13)", () => {
  it("início: a capa do site (versão pequena), o nome da empresa e o subtítulo; a base do campo Site", () => {
    const m = metadadosDaPagina(conteudo(), undefined, {}, HOST);
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
    const m = metadadosDaPagina(conteudo({ imagens: { capa: "/imagens-site/capa", marca: "/marca.png" } }), undefined, {}, HOST);
    expect(m.openGraph?.images).toEqual([{ url: "/imagens-site/capa" }]);
  });

  it("sem foto, a prévia sai sem imagem (nunca uma genérica): o site sem capa e a casa sem foto, mesmo com a capa do site", () => {
    const semFoto = metadadosDaPagina(conteudo({ imagens: semCapa }), undefined, {}, HOST);
    expect(semFoto.openGraph).not.toHaveProperty("images");
    expect(semFoto.twitter).toEqual({ card: "summary", title: "Casa Exemplo", description: TEXTOS_SITE_INICIAIS.subtitulo });
    const casa = metadadosDaPagina(conteudo(), "Studio Exemplo", { descricao: "Um refúgio para dois.", imagem: null, caminho: "/imoveis/403" }, HOST);
    expect(casa.openGraph).not.toHaveProperty("images");
    expect(casa.twitter).toMatchObject({ card: "summary" });
    expect(JSON.stringify(casa)).not.toContain("/imagens-site/");
  });

  it("casa: o nome, a frase dela, a foto pequena da capa e o endereço principal sem as datas", () => {
    const m = metadadosDaPagina(conteudo(), "Studio Exemplo", { descricao: "Um refúgio para dois.", imagem: FOTO, caminho: "/imoveis/403" }, HOST);
    expect(m).toMatchObject({ title: "Studio Exemplo — Casa Exemplo", description: "Um refúgio para dois.", alternates: { canonical: "/imoveis/403" } });
    expect(m.openGraph).toMatchObject({ title: "Studio Exemplo — Casa Exemplo", siteName: "Casa Exemplo", url: "/imoveis/403", images: [FOTO] });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: [FOTO] });
  });

  it("site com http, vazio, inválido ou com caminho: sem base e sem endereço principal (nada de endereço relativo enganoso); a foto continua", () => {
    for (const site of ["http://casa-exemplo.vercel.app", "", "https://", undefined, "https://casa-exemplo.vercel.app/imoveis/403"]) {
      const m = metadadosDaPagina(conteudo({ site }), "Consulta", { caminho: "/consulta" }, HOST);
      expect(m.metadataBase).toBeUndefined();
      expect(m.alternates).toBeUndefined();
      expect(m.openGraph).not.toHaveProperty("url");
      // A foto vai com o caminho; sem base, o Next a completa com o endereço do site na Vercel.
      expect(m.openGraph?.images).toEqual([{ url: "/imagens-site/capa-pequena" }]);
    }
  });

  it("campo Site https de outro domínio (que ainda não abre o sistema) ou endereço do pedido desconhecido: sem base, sem endereço principal, a foto relativa", () => {
    for (const [site, host] of [
      ["https://www.exemplo.com.br", HOST],
      ["https://casa-exemplo.vercel.app", "casa-exemplo-abc123-time.vercel.app"],
      ["https://casa-exemplo.vercel.app", null],
    ] as const) {
      const m = metadadosDaPagina(conteudo({ site }), "Consulta", { caminho: "/consulta" }, host);
      expect(m.metadataBase).toBeUndefined();
      expect(m.alternates).toBeUndefined();
      expect(m.openGraph).not.toHaveProperty("url");
      // Sem base, o Next completa a foto com o endereço do site na Vercel, nunca com o outro domínio.
      expect(m.openGraph?.images).toEqual([{ url: "/imagens-site/capa-pequena" }]);
      expect(JSON.stringify(m)).not.toContain("exemplo.com.br");
    }
  });

  it("consulta: o endereço principal é /consulta, sem as datas nem as pessoas", () => {
    const m = metadadosDaPagina(conteudo(), "Consulta", { descricao: TEXTOS_SITE_INICIAIS.consultaTexto, caminho: "/consulta" }, HOST);
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

  it("ícone da aba (M7.18): a marca enviada que serve de ícone, em toda página do site; sem ela, a do estudo; a prévia do link não muda", () => {
    const icone = { url: "/imagens-site/marca", lado: 256, atalho: true };
    const comMarca = conteudo({ imagens: { capa: "/imagens-site/capa", marca: "/imagens-site/marca", previa: "/imagens-site/capa-pequena", icone } });
    for (const m of [metadadosDaPagina(comMarca, undefined, {}, HOST), metadadosDaPagina(comMarca, "Studio Exemplo", { imagem: FOTO, caminho: "/imoveis/403" }, HOST)])
      expect(m.icons).toEqual({
        icon: [{ url: "/imagens-site/marca", type: "image/png", sizes: "256x256" }],
        apple: [{ url: "/imagens-site/marca", type: "image/png", sizes: "256x256" }],
      });
    // Com transparência: a marca enviada na aba e a do estudo no atalho do celular.
    expect(metadadosDaPagina(conteudo({ imagens: { ...comMarca.imagens, icone: { ...icone, atalho: false } } }), undefined, {}, HOST).icons).toEqual({
      icon: [{ url: "/imagens-site/marca", type: "image/png", sizes: "256x256" }],
      apple: ICONES_PADRAO.apple,
    });
    // Marca enviada que não serve (icone null) ou nenhuma enviada: os ícones da marca do estudo.
    expect(metadadosDaPagina(conteudo({ imagens: { ...comMarca.imagens, icone: null } }), undefined, {}, HOST).icons).toBe(ICONES_PADRAO);
    expect(metadadosDaPagina(conteudo(), "Consulta", {}, HOST).icons).toBe(ICONES_PADRAO);
    // A prévia do link (M7.13) é a mesma com e sem a marca como ícone.
    const semIcone = (meta: ReturnType<typeof metadadosDaPagina>) => ({ ...meta, icons: undefined });
    expect(semIcone(metadadosDaPagina(comMarca, undefined, {}, HOST))).toEqual(semIcone(metadadosDaPagina(conteudo(), undefined, {}, HOST)));
  });

  it("site em configuração: só o título e a descrição-base, sem prévia", () => {
    expect(metadadosDaPagina(null, "Consulta", { caminho: "/consulta", imagem: FOTO })).toEqual({ title: "Consulta", description: "Site em configuração." });
    expect(metadadosDaPagina(null)).toEqual({ title: "Site em configuração", description: "Site em configuração." });
  });
});
