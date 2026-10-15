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
