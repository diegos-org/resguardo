import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { cabecalhoPng, pngFicticio } from "@/site/icone.testing";
import { definirImagemSite } from "@/site/imagens-site";
import { ImagensSitePainel } from "./ImagensSitePainel";

/**
 * Configurações → Site (M7.18): a nota da marca enviada que não serve de ícone da aba, pela mesma conferência do site
 * (o começo do arquivo gravado). Banco de teste com imagens fictícias; só a tela de cliente tem o roteador simulado.
 */
const m = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/site/acoes-imagens-site", () => ({ enviarImagemSiteAcao: vi.fn(), tirarImagemSiteAcao: vi.fn() }));

let close: () => Promise<void>, org: string;
beforeEach(async () => {
  ({ db: m.db, close } = await createTestDb());
  [{ id: org }] = await m.db.insert(organizacoes).values({ nome: "Casa Exemplo" }).returning();
});
afterEach(() => close());

const tela = async () => renderToStaticMarkup(await ImagensSitePainel({ organizacaoId: org }));
const enviarMarca = async (conteudo: Uint8Array) => expect(await definirImagemSite(m.db, org, "marca", { nome: "marca", conteudo }, null)).toEqual({ ok: true });
const AVISO = "A aba do navegador e o atalho na tela do celular mostram a marca do estudo, e não esta";
const AVISO_ATALHO = "Nas páginas do site, a aba do navegador mostra esta marca, mas o atalho na tela do celular mostra a marca do estudo";

describe("Configurações → Site: a marca como ícone da aba (M7.18)", () => {
  it("sem marca enviada, sem nota; marca em JPG: a nota diz que a aba usa a marca do estudo porque o ícone só usa PNG quadrado", async () => {
    const antes = await tela();
    expect(antes).toContain("Marca do estudo visual (padrão).");
    expect(antes).not.toContain(AVISO);
    await enviarMarca(Uint8Array.from({ length: 32 }, (_, i) => [0xff, 0xd8, 0xff, 0xe0][i] ?? 1));
    const h = await tela();
    expect(h).toContain("Marca enviada por você.");
    expect(h).toContain(`${AVISO}: o ícone só usa a marca enviada quando ela é um PNG quadrado, e esta não é PNG.`);
  });

  it("marca em PNG retangular: a nota traz as medidas dela; trocada por um PNG quadrado sem transparência, serve de ícone e a nota some", async () => {
    await enviarMarca(cabecalhoPng(400, 200));
    expect(await tela()).toContain(`${AVISO}: o ícone só usa a marca enviada quando ela é um PNG quadrado, e esta tem 400 × 200 px.`);
    await enviarMarca(pngFicticio(300, 300));
    const h = await tela();
    expect(h).toContain("Marca enviada por você.");
    expect(h).not.toContain(AVISO);
    expect(h).not.toContain(AVISO_ATALHO);
  });

  it("PNG quadrado com transparência: a aba usa a marca, e a nota diz que o atalho do celular fica com a do estudo e por quê", async () => {
    await enviarMarca(pngFicticio(300, 300, { tipoDeCor: 6 }));
    const h = await tela();
    expect(h).toContain(`${AVISO_ATALHO}: no iPhone, o fundo transparente do atalho fica preto, e esta foi salva com transparência.`);
    expect(h).not.toContain(AVISO);
    // Paleta com transparência (tRNS antes da imagem): a mesma nota.
    await enviarMarca(pngFicticio(300, 300, { tipoDeCor: 3, antes: [{ nome: "PLTE", tamanho: 6 }, { nome: "tRNS", tamanho: 2 }] }));
    expect(await tela()).toContain(`${AVISO_ATALHO}: no iPhone, o fundo transparente do atalho fica preto, e esta foi salva com transparência.`);
  });
});
