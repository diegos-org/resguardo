import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AVISO_CAPA_SEM_PREVIA, ImagensSite } from "./ImagensSite";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/site/acoes-imagens-site", () => ({ enviarImagemSiteAcao: vi.fn(), tirarImagemSiteAcao: vi.fn() }));

const html = (props: Partial<Parameters<typeof ImagensSite>[0]> = {}) =>
  renderToStaticMarkup(<ImagensSite capa="/imagens-site/c1" marca={null} marcaPadrao="/marca.png" {...props} />);

describe("imagens do site no painel: capa enviada antes da versão leve da prévia dos links (M7.13)", () => {
  it("avisa e pede para enviar a foto de novo, sem supor nada", () => {
    const h = html({ capaSemPrevia: true });
    expect(h).toContain(AVISO_CAPA_SEM_PREVIA);
    expect(h).toContain('role="note"');
  });

  it("capa com a versão leve, ou sem capa: nenhum aviso", () => {
    expect(html()).not.toContain(AVISO_CAPA_SEM_PREVIA);
    expect(html({ capaSemPrevia: false })).not.toContain(AVISO_CAPA_SEM_PREVIA);
    expect(html({ capa: null, capaSemPrevia: true })).not.toContain(AVISO_CAPA_SEM_PREVIA);
  });

  it("o texto da tela diz que a capa aparece na prévia dos links e que, sem foto, a prévia sai sem imagem", () => {
    const h = html({ capa: null });
    expect(h).toContain("aparece na prévia quando alguém manda o link do site pelo WhatsApp ou pelas redes");
    expect(h).toContain("a prévia sai sem imagem (nunca uma imagem genérica)");
  });
});

describe("marca enviada que não serve de ícone da aba (M7.18)", () => {
  const NOTA = "A aba do navegador e o atalho na tela do celular mostram a marca do estudo, e não esta: o ícone só usa a marca enviada quando ela é um PNG quadrado, e esta não é PNG.";

  it("mostra a nota junto da marca enviada; sem nota (a marca serve) ou sem marca enviada (vale a do estudo), nenhuma", () => {
    const h = html({ marca: "/imagens-site/m1", notaIcone: NOTA });
    expect(h).toContain(NOTA);
    expect(h.indexOf(NOTA)).toBeGreaterThan(h.indexOf("Marca enviada por você."));
    expect(h.indexOf(NOTA)).toBeLessThan(h.indexOf("Trocar a marca"));
    expect(html({ marca: "/imagens-site/m1" })).not.toContain("A aba do navegador");
    expect(html({ marca: null, notaIcone: NOTA })).not.toContain(NOTA);
  });

  it("o texto da tela diz onde a marca é o ícone (só nas páginas do site) e quando (PNG quadrado; no atalho, sem transparência)", () => {
    const h = html();
    expect(h).toContain(
      "Nas páginas do site, ela também é o ícone da aba do navegador, quando é um PNG quadrado, e do atalho na tela do celular, quando é um PNG quadrado sem transparência; o painel e os portais ficam sempre com a marca do estudo.",
    );
  });

  it("o rótulo do envio sugere o PNG quadrado e o tamanho (o mesmo texto do erro de quem passa de 512 KB) e diz que JPG não vira ícone da aba", () => {
    expect(html()).toContain("Trocar a marca (PNG quadrado, de 200 a 400 px de lado, até 512 KB; em JPG, ela aparece no topo e no rodapé, mas não na aba)");
    expect(html()).not.toContain("PNG ou JPG quadrado");
  });
});
