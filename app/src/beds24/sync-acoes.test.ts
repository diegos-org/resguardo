import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), org: vi.fn(), leitor: vi.fn(), quartos: vi.fn(), salvar: vi.fn(), vincular: vi.fn(), sincronizar: vi.fn(), revalidar: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ obterSessao: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("./configuracao", () => ({ organizacaoBeds24: m.org, salvarConfigBeds24: m.salvar }));
vi.mock("./http", () => ({ leitorDoAmbiente: m.leitor, leitorParaSincronizacao: m.leitor }));
vi.mock("@/canais/ids-externos", () => ({ adicionarIdExterno: m.vincular }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("./sincronizacao", async importar => ({ ...await importar<typeof import("./sincronizacao")>(), sincronizarBeds24: m.sincronizar }));
import { conferirQuartosBeds24, configurarSyncBeds24, importarBeds24Agora, vincularQuartoBeds24 } from "./sync-acoes";
const form = (dados: Record<string, string> = {}) => { const f = new FormData(); for (const [k, v] of Object.entries(dados)) f.set(k, v); return f; };

beforeEach(() => {
  vi.resetAllMocks();
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org-A", usuarioId: "user-A" });
  m.org.mockResolvedValue("org-A");
  m.db.mockReturnValue("db-falso");
  m.leitor.mockReturnValue({ quartos: m.quartos });
  m.quartos.mockResolvedValue({ itens: [{ propertyId: "10", roomId: "20", nome: "Quarto" }], divergencias: [] });
  m.vincular.mockResolvedValue({ ok: true });
  m.sincronizar.mockResolvedValue({ ok: true, mensagem: "Importada", divergencias: [] });
});

describe("ações Beds24 autorizadas no servidor", () => {
  it.each([null, "operacao", "limpeza", "proprietario", "hospede"])("recusa %s antes de consultar banco ou API", async papel => {
    m.sessao.mockResolvedValue(papel ? { papel } : null);
    for (const acao of [conferirQuartosBeds24, () => configurarSyncBeds24({}, form()), () => vincularQuartoBeds24({}, form()), () => importarBeds24Agora({}, form({ confirmo: "on" }))]) expect(await acao()).toMatchObject({ ok: false });
    expect(m.db).not.toHaveBeenCalled();
    expect(m.leitor).not.toHaveBeenCalled();
  });
  it("não permite usar a credencial da organização A pela organização B", async () => {
    m.org.mockResolvedValue("org-B");
    expect(await importarBeds24Agora({}, form({ confirmo: "on" }))).toMatchObject({ ok: false });
    expect(m.sincronizar).not.toHaveBeenCalled();
    expect(m.leitor).not.toHaveBeenCalled();
  });
  it("exige confirmação e usa organização/autor da sessão", async () => {
    expect(await importarBeds24Agora({}, form())).toMatchObject({ ok: false });
    expect(m.sincronizar).not.toHaveBeenCalled();
    expect(await importarBeds24Agora({}, form({ confirmo: "on", organizacaoId: "forjada" }))).toMatchObject({ ok: true });
    expect(m.sincronizar).toHaveBeenCalledWith("db-falso", "org-A", expect.anything(), { autorId: "user-A" });
  });
  it("revalida o quarto no servidor antes de salvar o vínculo", async () => {
    expect(await vincularQuartoBeds24({}, form({ imovelId: "im", propertyId: "10", roomId: "99" }))).toMatchObject({ ok: false });
    expect(m.vincular).not.toHaveBeenCalled();
    expect(await vincularQuartoBeds24({}, form({ imovelId: "im", propertyId: "10", roomId: "20" }))).toMatchObject({ ok: true });
    expect(m.vincular).toHaveBeenCalledWith("db-falso", "org-A", "im", { canal: "beds24", idExterno: "10", detalhe: "20" }, "user-A");
  });
  it("salvar configuração não importa; erro inesperado não revela detalhes", async () => {
    expect(await configurarSyncBeds24({}, form({ automatica: "on", desde: "2026-09-01", diasCalendario: "180" }))).toMatchObject({ ok: true });
    expect(m.salvar).toHaveBeenCalledWith("db-falso", "org-A", { automatica: true, desde: "2026-09-01", diasCalendario: 180 }, "user-A");
    expect(m.sincronizar).not.toHaveBeenCalled();
    m.quartos.mockRejectedValue(new Error("SEGREDO"));
    expect(JSON.stringify(await conferirQuartosBeds24())).not.toContain("SEGREDO");
  });
});
