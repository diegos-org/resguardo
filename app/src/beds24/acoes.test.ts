import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErroBeds24 } from "./tipos";

const mocks = vi.hoisted(() => ({ sessao: vi.fn(), leitor: vi.fn(), quartos: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ obterSessao: mocks.sessao }));
vi.mock("./http", () => ({ leitorDoAmbiente: mocks.leitor }));
import { testarConexaoBeds24 } from "./acoes";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sessao.mockResolvedValue({ papel: "admin" });
  mocks.leitor.mockReturnValue({ quartos: mocks.quartos });
});

describe("teste manual da conexão Beds24", () => {
  it.each([null, "operacao", "proprietario", "hospede", "limpeza"])("recusa acesso %s antes de consultar o provedor", async (papel) => {
    mocks.sessao.mockResolvedValue(papel ? { papel } : null);
    expect(await testarConexaoBeds24(null)).toMatchObject({ ok: false });
    expect(mocks.leitor).not.toHaveBeenCalled();
    expect(mocks.quartos).not.toHaveBeenCalled();
  });
  it("orienta quando falta credencial", async () => {
    mocks.leitor.mockReturnValue(null);
    expect(await testarConexaoBeds24(null)).toMatchObject({ ok: false, mensagem: expect.stringContaining("BEDS24_REFRESH_TOKEN") });
  });
  it("retorna somente contagem, sem identificadores ou nomes", async () => {
    mocks.quartos.mockResolvedValue({ itens: [{ nome: "nome-privado", propertyId: "id-privado", roomId: "quarto-privado" }], divergencias: [] });
    const r = await testarConexaoBeds24(null);
    expect(r).toMatchObject({ ok: true, mensagem: expect.stringContaining("1 quarto(s)") });
    expect(JSON.stringify(r)).not.toContain("privado");
  });
  it("avisa sobre lista vazia e divergências sem expor respostas", async () => {
    mocks.quartos.mockResolvedValue({ itens: [], divergencias: [] });
    expect((await testarConexaoBeds24(null)).mensagem).toContain("nenhum quarto");
    mocks.quartos.mockResolvedValue({ itens: [], divergencias: [{ motivo: "dado-privado" }] });
    const r = await testarConexaoBeds24(null);
    expect(r.ok).toBe(false);
    expect(r.mensagem).not.toContain("dado-privado");
  });
  it("preserva erro sanitizado e esconde erros desconhecidos", async () => {
    mocks.quartos.mockRejectedValue(new ErroBeds24("Beds24 respondeu HTTP 403.", "http"));
    expect(await testarConexaoBeds24(null)).toEqual({ ok: false, mensagem: "Beds24 respondeu HTTP 403." });
    mocks.quartos.mockRejectedValue(new Error("SEGREDO"));
    expect(JSON.stringify(await testarConexaoBeds24(null))).not.toContain("SEGREDO");
  });
});
