import { beforeEach, expect, it, vi } from "vitest";
import { salvarAnuncioAcao } from "./acoes";
const m = vi.hoisted(() => ({ sessao: vi.fn(), salvar: vi.fn(), revalidar: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("./repositorio", () => ({ salvarAnuncio: m.salvar }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
beforeEach(() => { vi.clearAllMocks(); m.salvar.mockResolvedValue({ ok: true }); });
it.each(["operacao", "proprietario", "hospede", "limpeza"])("%s não grava mesmo chamando a ação diretamente", async papel => {
  m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: ["im"] });
  await expect(salvarAnuncioAcao({}, new FormData())).rejects.toThrow("Acesso negado");
  expect(m.salvar).not.toHaveBeenCalled();
});
it("admin usa a organização da sessão e revalida as telas", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "real", usuarioId: "u", imovelIds: [] });
  const f = new FormData(); f.set("imovelId", "im"); f.set("organizacaoId", "forjada");
  expect(await salvarAnuncioAcao({}, f)).toEqual({ ok: true });
  expect(m.salvar).toHaveBeenCalledWith({}, "real", "im", expect.anything(), "u");
  expect(m.revalidar).toHaveBeenCalledWith("/painel/anuncios");
});
it("erro de validação não é anunciado como sucesso", async () => {
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u" });
  m.salvar.mockResolvedValue({ ok: false, erro: "Link inválido" });
  expect(await salvarAnuncioAcao({}, new FormData())).toEqual({ ok: false, erro: "Link inválido" });
  expect(m.revalidar).not.toHaveBeenCalled();
});
