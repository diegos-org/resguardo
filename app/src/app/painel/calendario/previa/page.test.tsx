import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DETALHES_VAZIOS, regrasDeVenda } from "@/imoveis/detalhes";
import { planejarCalendario } from "@/calendario/motor";
import { REGRAS_CALENDARIO_PADRAO } from "@/calendario/regras-config";
import Page from "./page";
const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), imoveis: vi.fn(), planejar: vi.fn(), regras: vi.fn(), mapas: vi.fn(), envios: vi.fn(), noites: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/imoveis/repositorio", () => ({ listarImoveis: m.imoveis }));
vi.mock("@/beds24/configuracao", () => ({ listarMapeamentosBeds24: m.mapas }));
vi.mock("@/calendario/regras-config", async (orig) => ({ ...(await orig<typeof import("@/calendario/regras-config")>()), lerRegrasCalendario: m.regras }));
vi.mock("@/calendario/envio", async (orig) => ({ ...(await orig<typeof import("@/calendario/envio")>()), planejarImovel: m.planejar, ultimosEnvios: m.envios, noitesDoEnvio: m.noites }));
vi.mock("@/marketplace/precos-config", async () => ({ lerPrecosMarketplace: async () => (await import("@/marketplace/precos")).PRECOS_MARKETPLACE_PADRAO }));
vi.mock("@/components/calendario/EnvioBeds24", () => ({ EnvioBeds24: (p: { envioLigado: boolean; escritaLigada: boolean }) => <div data-envio={`${p.escritaLigada}/${p.envioLigado}`}>Envio ao Beds24</div> }));
const imovel = { id: "i103", codigo: "103", nome: "Fictício", ativo: true, fuso: "America/Sao_Paulo" };
const regras = regrasDeVenda({ ...DETALHES_VAZIOS, precoBase: 45000, estadiaMinima: 2 });
const linhas = planejarCalendario({ imovel: { id: "i103", regras, periodos: [], pisos: [35000, 30000], fontePrecos: "scl" }, regras: REGRAS_CALENDARIO_PADRAO, hoje: "2026-10-02", inicio: "2026-10-02", fim: "2026-10-03", reservas: [], bloqueios: [], enviados: [], observacoes: [{ data: "2026-10-02", preco: 45000, minimoNoites: null, maximoNoites: null, livres: null, bloqueio: null, observadoEm: new Date("2026-10-02T15:00:00Z") }] });
beforeEach(() => {
  vi.clearAllMocks();
  m.db.mockReturnValue({});
  m.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  m.sessao.mockResolvedValue({ papel: "operacao", usuarioId: "u", organizacaoId: "org" });
  m.imoveis.mockResolvedValue([{ ...imovel, id: "i403", codigo: "403" }, imovel]);
  m.regras.mockResolvedValue({ ...REGRAS_CALENDARIO_PADRAO, envio: { imoveis: ["i103"], automatico: false } });
  m.mapas.mockResolvedValue([{ id: "m", imovelId: "i103", codigo: "103", ativo: true, propertyId: "10", roomId: "20" }]);
  m.envios.mockResolvedValue([{ id: "e1", iniciadoEm: new Date("2026-10-02T12:00:00Z"), situacao: "ok", modo: "envio", automatica: false, resumo: "10 noite(s) enviada(s)", avisos: ["aviso de teste"], noitesEnviadas: 10, noites: 10 }]);
  m.noites.mockResolvedValue([]);
  m.planejar.mockResolvedValue({ hoje: "2026-10-02", inicio: "2026-10-02", fim: "2026-10-03", linhas, regras, pisos: [35000, 30000], fontePrecos: "scl" });
});
afterEach(() => vi.unstubAllEnvs());
const html = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(params) }));

it.each(["proprietario", "limpeza", "hospede"])("%s não lê a prévia mesmo por endereço direto", async papel => {
  m.sessao.mockResolvedValue({ papel, usuarioId: "u", organizacaoId: "org" });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel");
  expect(m.db).not.toHaveBeenCalled();
  expect(m.planejar).not.toHaveBeenCalled();
});
it("prefere 103, mostra plano por noite, leitura parcial e horário local; operação não vê envio nem histórico", async () => {
  const h = await html({ inicio: "2026-10-02", fim: "2026-10-03" });
  expect(m.planejar).toHaveBeenCalledWith({}, "org", expect.anything(), imovel, expect.any(Date), { inicio: "2026-10-02", fim: "2026-10-03" }, { paraOBeds24: true });
  expect(h).toContain("2 noites nesta consulta · 1 com leitura do Beds24 · 2 a enviar");
  expect(h).toContain("12:00");
  expect(h).toContain("R$ 450,00 → R$ 450,00 (R$ 337,50)");
  // Fonte de preços (M3.9) e preço aproximado no site, com o padrão 6/3/3 (M12.5): R$ 337,50 − 3% = R$ 327,38.
  expect(h).toContain("Fonte de preços deste imóvel:</strong> Preços automáticos do SCL");
  expect(h).toContain("R$ 327,38");
  expect(h).toContain("Semana normal");
  expect(h).toContain("Enviar (diferente ou sem leitura)");
  expect(h).not.toContain("Envio ao Beds24");
  expect(h).not.toContain("Últimos envios");
  expect(m.envios).not.toHaveBeenCalled();
  expect(h).not.toContain('method="post"');
});
it("os mínimos por dia saem na ordem da semana, de segunda a domingo, com o rótulo da mesma ordem (M7.22)", async () => {
  // Guardado por número (0 = domingo … 6 = sábado): um mínimo diferente em cada dia mostra a ordem.
  m.regras.mockResolvedValue({ ...REGRAS_CALENDARIO_PADRAO, minimoPorDia: [7, 1, 2, 3, 4, 5, 6], envio: { imoveis: ["i103"], automatico: false } });
  expect(await html()).toContain("mínimo por dia da semana 1/2/3/4/5/6/7 (seg a dom)");
});
it("admin vê o envio com o sinal da Vercel e o histórico, mas imóvel de outra empresa não é planejado", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org" });
  vi.stubEnv("BEDS24_ESCRITA", "ligada");
  const h = await html();
  expect(h).toContain("Editar base, períodos, pisos e regras do imóvel");
  expect(h).toContain('data-envio="true/true"');
  expect(h).toContain("10 noite(s) enviada(s)");
  expect(h).toContain("aviso de teste");
  m.planejar.mockClear();
  expect(await html({ imovel: "outra-empresa" })).toContain("Imóvel não encontrado nesta empresa");
  expect(m.planejar).not.toHaveBeenCalled();
});
it("intervalo inválido ou excessivo não planeja; noites de um envio só com id válido", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org" });
  expect(await html({ inicio: "2026-10-01", fim: "2027-10-01" })).toContain("Confira até 92 noites por vez");
  expect(m.planejar).not.toHaveBeenCalled();
  await html({ execucao: "nao-uuid" });
  expect(m.noites).not.toHaveBeenCalled();
  m.noites.mockResolvedValue([{ codigo: "103", data: "2026-10-02", precoAntes: null, precoEnviado: 45000, minimoAntes: null, minimoEnviado: 2, maximoEnviado: 27, bloqueioAntes: null, bloqueioEnviado: null, regra: "Preço base", resultado: "confirmado", detalhe: "" }]);
  const h = await html({ execucao: "11111111-1111-4111-8111-111111111111" });
  expect(m.noites).toHaveBeenCalledWith({}, "org", "11111111-1111-4111-8111-111111111111");
  expect(h).toContain("Noites do envio escolhido");
  expect(h).toContain("confirmado");
});
it("sem 103 seleciona 403; com lista vazia apresenta cadastro", async () => {
  m.imoveis.mockResolvedValue([{ ...imovel, id: "i403", codigo: "403" }]);
  await html({ inicio: "2026-10-02", fim: "2026-10-03" });
  expect(m.planejar).toHaveBeenCalledWith({}, "org", expect.anything(), { ...imovel, id: "i403", codigo: "403" }, expect.any(Date), { inicio: "2026-10-02", fim: "2026-10-03" }, { paraOBeds24: true });
  m.imoveis.mockResolvedValue([]); m.planejar.mockClear();
  expect(await html()).toContain("Cadastre um imóvel para começar");
  expect(m.planejar).not.toHaveBeenCalled();
});
it("o preço importado do Beds24 (M3.11a) aparece com o motivo dele, no preço e no mínimo, sem mudança de tela", async () => {
  const importados = new Map([["2026-10-02", { preco: 52000, minimo: 3, em: "2026-09-30" }]]);
  const comImportado = planejarCalendario({ imovel: { id: "i103", regras, periodos: [], pisos: [35000, 30000], fontePrecos: "scl", importados }, regras: REGRAS_CALENDARIO_PADRAO, hoje: "2026-10-02", inicio: "2026-10-02", fim: "2026-10-03", reservas: [], bloqueios: [], enviados: [], observacoes: [] });
  m.planejar.mockResolvedValue({ hoje: "2026-10-02", inicio: "2026-10-02", fim: "2026-10-03", linhas: comImportado, regras, pisos: [35000, 30000], fontePrecos: "scl" });
  const h = await html({ inicio: "2026-10-02", fim: "2026-10-03" });
  expect(h).toContain("R$ 520,00 → R$ 520,00");
  expect(h).toContain("Preço importado do Beds24 em 30/09/2026");
  expect(h).toContain("Mínimo importado do Beds24");
  // A noite sem importado continua no preço base.
  expect(h).toContain("Preço base");
});
