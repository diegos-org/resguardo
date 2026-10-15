import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

/** Links antigos `/property/<código>` (M7.9): a casa que está no site, a página dela; a que não está, a consulta com o aviso. */
const m = vi.hoisted(() => ({ site: vi.fn(), imovel: vi.fn() }));
vi.mock("@/site/pagina", () => ({ carregarSite: m.site }));
vi.mock("@/site/site", async (orig) => ({ ...(await orig<typeof import("@/site/site")>()), imovelDoSite: m.imovel }));

const pedir = (codigo: string, busca = "") => GET(new Request(`https://site.exemplo/property/${codigo}${busca}`), { params: Promise.resolve({ codigo }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.site.mockResolvedValue({ db: {}, conteudo: { organizacaoId: "org" } });
});

it("casa que está no site: 308 para a página dela", async () => {
  m.imovel.mockResolvedValue({ codigo: "403", fuso: "America/Sao_Paulo", capacidade: 4 });
  const r = await pedir("403");
  expect([r.status, r.headers.get("Location")]).toEqual([308, "/imoveis/403"]);
  expect(m.imovel).toHaveBeenCalledWith({}, "org", "403");
});

it("casa que não está (mais) no site: 307 para a consulta, que avisa e oferece as outras casas, com as datas do link", async () => {
  m.imovel.mockResolvedValue(null);
  const r = await pedir("303", "?checkin=2099-10-12&checkout=2099-10-15&guests=2");
  expect([r.status, r.headers.get("Location")]).toEqual([307, "/consulta?imovel=303&entrada=2099-10-12&saida=2099-10-15&hospedes=2"]);
  // Sem site configurado, também não supõe uma casa: vai para a consulta, que mostra o site em configuração.
  m.site.mockResolvedValue({ db: {}, conteudo: null });
  const semSite = await pedir("303");
  expect([semSite.status, semSite.headers.get("Location")]).toEqual([307, "/consulta?imovel=303"]);
});

it("critério inválido de uma casa que está no site: avisa em texto (400), sem supor", async () => {
  m.imovel.mockResolvedValue({ codigo: "403", fuso: "America/Sao_Paulo", capacidade: 4 });
  const r = await pedir("403", "?checkin=2099-10-12&checkout=2099-10-15&guests=9");
  expect(r.status).toBe(400);
  expect(await r.text()).toContain("Confira os dados da estadia");
});
