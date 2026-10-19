/**
 * Ações da caixa de entrada do WhatsApp (M10.1a, desenho 6.5; 8-G e seção 12, item 1): deny-by-default, na ordem sessão →
 * quem vê as conversas → validação → domínio. Quem vê é decidido de verdade (`whatsapp/acesso.ts`), com a configuração
 * "Quem vê as conversas" simulada; o domínio (vínculo, "lida", configuração) é simulado e anotado: aqui só a ordem, as
 * recusas e as chaves do resultado. A empresa vem só da sessão.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado } from "@/acesso/politica";

const m = vi.hoisted(() => ({
  sessao: vi.fn(),
  revalidar: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  config: vi.fn(),
  confirmar: vi.fn(),
  porCodigo: vi.fn(),
  desfazer: vi.fn(),
  lida: vi.fn(),
  salvarIds: vi.fn(),
  salvarQuem: vi.fn(),
}));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({ banco: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("./configuracao", async (original) => ({
  ...(await original<typeof import("./configuracao")>()),
  lerConfigWhatsapp: m.config,
  salvarIdsWhatsapp: m.salvarIds,
  salvarQuemVeConversas: m.salvarQuem,
}));
vi.mock("./vinculo", async (original) => ({ ...(await original<typeof import("./vinculo")>()), confirmarVinculo: m.confirmar, vincularPorCodigo: m.porCodigo, desfazerVinculo: m.desfazer }));
vi.mock("./conversas", async (original) => ({ ...(await original<typeof import("./conversas")>()), marcarComoLida: m.lida }));
import {
  confirmarVinculoAcao,
  desfazerVinculoAcao,
  marcarComoLidaAcao,
  salvarIdsWhatsappAcao,
  salvarQuemVeConversasAcao,
  vincularPorCodigoAcao,
} from "./acoes";

const CONVERSA = "11111111-1111-4111-8111-111111111111";
const ALVO = "22222222-2222-4222-8222-222222222222";
const form = (v: Record<string, string>) => {
  const f = new FormData();
  // A empresa nunca vem do formulário: um campo forjado é ignorado.
  f.set("organizacaoId", "outra-org");
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};
const sessao = (papel: string) => m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: papel === "proprietario" ? ["im"] : [] });
const configuracao = (quemVeConversas: string) => m.config.mockResolvedValue({ wabaId: null, numeroId: null, quemVeConversas });
const dominios = () => [m.confirmar, m.porCodigo, m.desfazer, m.lida];

/** As quatro ações das conversas, com um formulário válido. */
const ACOES_DAS_CONVERSAS: [string, () => Promise<unknown>][] = [
  ["confirmarVinculoAcao", () => confirmarVinculoAcao(form({ contatoId: CONVERSA, tipo: "reserva", alvoId: ALVO }))],
  ["vincularPorCodigoAcao", () => vincularPorCodigoAcao(form({ contatoId: CONVERSA, codigo: "SCL-ABC234" }))],
  ["desfazerVinculoAcao", () => desfazerVinculoAcao(form({ contatoId: CONVERSA }))],
  ["marcarComoLidaAcao", () => marcarComoLidaAcao(CONVERSA, "2026-10-17T15:00:00.000Z")],
];

beforeEach(() => {
  vi.clearAllMocks();
  sessao("admin");
  configuracao("so_admin");
  m.confirmar.mockResolvedValue("vinculada");
  m.porCodigo.mockResolvedValue("vinculada");
  m.desfazer.mockResolvedValue("desfeito");
  m.lida.mockResolvedValue(true);
  m.salvarIds.mockResolvedValue("salvo");
  m.salvarQuem.mockResolvedValue("salvo");
});

describe("quem chama as ações das conversas (seção 12, item 1)", () => {
  it.each(ACOES_DAS_CONVERSAS)("operação com o padrão só o admin: %s dá AcessoNegado, sem domínio, sem revalidar, sem redirecionar", async (_nome, chamar) => {
    sessao("operacao");
    await expect(chamar()).rejects.toBeInstanceOf(AcessoNegado);
    expect(m.config).toHaveBeenCalledWith({ banco: true }, "org");
    for (const f of dominios()) expect(f).not.toHaveBeenCalled();
    expect(m.revalidar).not.toHaveBeenCalled();
    expect(m.redirect).not.toHaveBeenCalled();
  });

  it.each(ACOES_DAS_CONVERSAS.flatMap(([nome, chamar]) => ["proprietario", "limpeza"].flatMap((papel) => ["so_admin", "admin_e_operacao"].map((quem) => [nome, papel, quem, chamar] as const))))(
    "%s: %s com %s → AcessoNegado, domínio não chamado",
    async (_nome, papel, quem, chamar) => {
      sessao(papel);
      configuracao(quem);
      await expect(chamar()).rejects.toBeInstanceOf(AcessoNegado);
      for (const f of dominios()) expect(f).not.toHaveBeenCalled();
    },
  );

  it("com a configuração liberada (admin e operação), a operação passa e o domínio recebe a sessão (a empresa vem dela, nunca do formulário)", async () => {
    sessao("operacao");
    configuracao("admin_e_operacao");
    await expect(confirmarVinculoAcao(form({ contatoId: CONVERSA, tipo: "reserva", alvoId: ALVO }))).rejects.toThrow(`REDIRECT /painel/mensagens/${CONVERSA}?feito=vinculada`);
    expect(m.confirmar).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org", papel: "operacao" }), { contatoId: CONVERSA, tipo: "reserva", alvoId: ALVO });
    expect(m.revalidar).toHaveBeenCalledWith("/painel", "layout");
  });
});

describe("confirmar, vincular pelo código e desfazer: validação e chaves do resultado", () => {
  it("id da conversa inválido: volta à lista sem chamar o domínio", async () => {
    await expect(confirmarVinculoAcao(form({ contatoId: "nao-e-uuid", tipo: "reserva", alvoId: ALVO }))).rejects.toThrow("REDIRECT /painel/mensagens");
    await expect(vincularPorCodigoAcao(form({ contatoId: "x", codigo: "SCL-ABC234" }))).rejects.toThrow("REDIRECT /painel/mensagens");
    await expect(desfazerVinculoAcao(form({}))).rejects.toThrow("REDIRECT /painel/mensagens");
    for (const f of dominios()) expect(f).not.toHaveBeenCalled();
  });

  it("tipo fora da lista ou alvo inválido: não chama o domínio e volta à conversa com \"alvo não encontrado\"", async () => {
    for (const v of [{ tipo: "usuario", alvoId: ALVO }, { tipo: "__proto__", alvoId: ALVO }, { tipo: "reserva", alvoId: "1" }]) {
      await expect(confirmarVinculoAcao(form({ contatoId: CONVERSA, ...v }))).rejects.toThrow(`REDIRECT /painel/mensagens/${CONVERSA}?erro=alvo_nao_encontrado`);
    }
    expect(m.confirmar).not.toHaveBeenCalled();
  });

  it.each([
    ["vinculada", `?feito=vinculada`],
    ["ja_vinculada", `?erro=ja_vinculada`],
    ["alvo_nao_encontrado", `?erro=alvo_nao_encontrado`],
  ])("confirmar → %s: volta à conversa com %s", async (resultado, chave) => {
    m.confirmar.mockResolvedValue(resultado);
    await expect(confirmarVinculoAcao(form({ contatoId: CONVERSA, tipo: "cotacao", alvoId: ALVO }))).rejects.toThrow(`REDIRECT /painel/mensagens/${CONVERSA}${chave}`);
  });

  it.each([
    ["vinculada", `?feito=vinculada`],
    ["ja_vinculada", `?erro=ja_vinculada`],
    ["codigo_invalido", `?erro=codigo_invalido`],
    ["codigo_nao_encontrado", `?erro=codigo_nao_encontrado`],
  ])("vincular pelo código → %s: volta à conversa com %s; o código vai como digitado (o domínio o confere)", async (resultado, chave) => {
    m.porCodigo.mockResolvedValue(resultado);
    await expect(vincularPorCodigoAcao(form({ contatoId: CONVERSA, codigo: "  scl-abc234 " }))).rejects.toThrow(`REDIRECT /painel/mensagens/${CONVERSA}${chave}`);
    expect(m.porCodigo).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org" }), { contatoId: CONVERSA, codigo: "scl-abc234" });
  });

  it("o código digitado é cortado antes do domínio (nada grande vai para a consulta)", async () => {
    await expect(vincularPorCodigoAcao(form({ contatoId: CONVERSA, codigo: "X".repeat(500) }))).rejects.toThrow("REDIRECT");
    expect(m.porCodigo.mock.lastCall![2].codigo).toHaveLength(40);
  });

  it("desfazer: desfeito → \"Vínculo desfeito.\"; sem vínculo → a conversa, sem chave; conversa que não é da empresa → a lista", async () => {
    await expect(desfazerVinculoAcao(form({ contatoId: CONVERSA }))).rejects.toThrow(`REDIRECT /painel/mensagens/${CONVERSA}?feito=desfeito`);
    expect(m.desfazer).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org" }), CONVERSA);
    m.desfazer.mockResolvedValue("sem_vinculo");
    await expect(desfazerVinculoAcao(form({ contatoId: CONVERSA }))).rejects.toThrow(new RegExp(`REDIRECT /painel/mensagens/${CONVERSA}$`));
    m.desfazer.mockResolvedValue("conversa_nao_encontrada");
    await expect(desfazerVinculoAcao(form({ contatoId: CONVERSA }))).rejects.toThrow(/REDIRECT \/painel\/mensagens$/);
    m.confirmar.mockResolvedValue("conversa_nao_encontrada");
    await expect(confirmarVinculoAcao(form({ contatoId: CONVERSA, tipo: "reserva", alvoId: ALVO }))).rejects.toThrow(/REDIRECT \/painel\/mensagens$/);
  });
});

describe("\"lida\" (estado interno)", () => {
  it("marca até a hora dada, sem redirecionar; revalida a lista quando a conversa existe", async () => {
    await expect(marcarComoLidaAcao(CONVERSA, "2026-10-17T15:00:00.000Z")).resolves.toBeUndefined();
    expect(m.lida).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org" }), CONVERSA, new Date("2026-10-17T15:00:00.000Z"), expect.any(Date));
    expect(m.revalidar).toHaveBeenCalledWith("/painel/mensagens");
    expect(m.redirect).not.toHaveBeenCalled();
    vi.clearAllMocks();
    m.lida.mockResolvedValue(false);
    await marcarComoLidaAcao(CONVERSA, "2026-10-17T15:00:00Z");
    expect(m.revalidar).not.toHaveBeenCalled();
  });

  it.each(["", "ontem", "2026-10-17", "2026-13-40T99:99:99Z", "1e30", "2026-10-17T15:00:00.000Z; drop"])("data inválida (%s) não chama o domínio", async (ate) => {
    await marcarComoLidaAcao(CONVERSA, ate);
    expect(m.lida).not.toHaveBeenCalled();
  });

  it("id inválido não chama o domínio", async () => {
    await marcarComoLidaAcao("nao-e-uuid", "2026-10-17T15:00:00Z");
    expect(m.lida).not.toHaveBeenCalled();
  });
});

describe("configuração (Integrações → WhatsApp): só quem edita as configurações", () => {
  const ids = (v: Record<string, string>) => {
    const f = new FormData();
    for (const [k, x] of Object.entries(v)) f.set(k, x);
    return f;
  };

  it.each(["operacao", "proprietario", "limpeza"])("%s → AcessoNegado nas duas, sem gravar (mesmo com a configuração liberada)", async (papel) => {
    sessao(papel);
    configuracao("admin_e_operacao");
    await expect(salvarIdsWhatsappAcao({}, ids({ wabaId: "200000000000002", numeroId: "100000000000001" }))).rejects.toBeInstanceOf(AcessoNegado);
    await expect(salvarQuemVeConversasAcao({}, ids({ quemVe: "admin_e_operacao" }))).rejects.toBeInstanceOf(AcessoNegado);
    expect(m.salvarIds).not.toHaveBeenCalled();
    expect(m.salvarQuem).not.toHaveBeenCalled();
  });

  it("os ids: salvo, nada mudou, id inválido e WABA de outra empresa, cada um com a sua mensagem; revalida o layout ao salvar e quando nada muda (como configuracoes/acoes.ts), nunca nos erros", async () => {
    const f = ids({ wabaId: " 200000000000002 ", numeroId: "100000000000001", organizacaoId: "outra-org" });
    expect(await salvarIdsWhatsappAcao({}, f)).toEqual({ ok: true, mensagem: "Salvo." });
    expect(m.salvarIds).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org", papel: "admin" }), { wabaId: " 200000000000002 ", numeroId: "100000000000001" });
    expect(m.revalidar).toHaveBeenCalledWith("/painel", "layout");
    m.salvarIds.mockResolvedValue("sem_mudanca");
    expect(await salvarIdsWhatsappAcao({}, f)).toEqual({ ok: true, mensagem: "Nada mudou." });
    expect(m.revalidar).toHaveBeenCalledTimes(2);
    vi.clearAllMocks();
    m.salvarIds.mockResolvedValue("id_invalido");
    expect(await salvarIdsWhatsappAcao({}, ids({ wabaId: "12a", numeroId: "" }))).toEqual({ ok: false, mensagem: "Use só números (até 25 dígitos).", valores: { wabaId: "12a", numeroId: "" } });
    m.salvarIds.mockResolvedValue("waba_de_outra_empresa");
    expect(await salvarIdsWhatsappAcao({}, f)).toMatchObject({ ok: false, mensagem: "Esta conta do WhatsApp já está ligada a outra empresa no sistema." });
    expect(m.revalidar).not.toHaveBeenCalled();
  });

  it("um campo que não veio no envio não vira \"apagar\": recusa sem chamar o domínio", async () => {
    expect(await salvarIdsWhatsappAcao({}, ids({ wabaId: "200000000000002" }))).toMatchObject({ ok: false, mensagem: "Use só números (até 25 dígitos)." });
    expect(m.salvarIds).not.toHaveBeenCalled();
  });

  it("quem vê: só os dois valores da lista chegam ao domínio; revalida o layout (o menu e o Início mudam para a operação)", async () => {
    expect(await salvarQuemVeConversasAcao({}, ids({ quemVe: "admin_e_operacao" }))).toEqual({ ok: true, mensagem: "Salvo." });
    expect(m.salvarQuem).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org" }), "admin_e_operacao");
    expect(m.revalidar).toHaveBeenCalledWith("/painel", "layout");
    m.salvarQuem.mockResolvedValue("sem_mudanca");
    expect(await salvarQuemVeConversasAcao({}, ids({ quemVe: "so_admin" }))).toEqual({ ok: true, mensagem: "Nada mudou." });
    vi.clearAllMocks();
    for (const v of ["todos", "", "operacao"]) expect(await salvarQuemVeConversasAcao({}, ids({ quemVe: v }))).toEqual({ ok: false, mensagem: "Escolha uma das opções." });
    expect(m.salvarQuem).not.toHaveBeenCalled();
  });
});
