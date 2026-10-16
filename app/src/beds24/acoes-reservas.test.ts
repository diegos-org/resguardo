/**
 * Ações do painel das reservas do site no Beds24 (M8.3a, desenho 8; seção 10, teste 12): deny-by-default. "Simular" pede
 * `reserva:editar`; pausar, retomar, ligar e desligar um imóvel e conferir os escopos pedem `configuracao:editar` (hoje, só
 * o admin). A empresa vem só da sessão. Domínio simulado: aqui só a ordem sessão → permissão → validação → domínio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado } from "@/acesso/politica";

const m = vi.hoisted(() => ({
  sessao: vi.fn(),
  revalidar: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  simular: vi.fn(),
  pausar: vi.fn(),
  retomar: vi.fn(),
  ligar: vi.fn(),
  desligar: vi.fn(),
  escopos: vi.fn(),
}));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({ banco: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("./reservas-site-simulacao", async (original) => ({ ...(await original<typeof import("./reservas-site-simulacao")>()), simularReservaNoBeds24: m.simular }));
vi.mock("./reservas-site-config", async (original) => ({
  ...(await original<typeof import("./reservas-site-config")>()),
  pausarReservasBeds24: m.pausar,
  retomarReservasBeds24: m.retomar,
  ligarImovelReservasBeds24: m.ligar,
  desligarImovelReservasBeds24: m.desligar,
}));
vi.mock("./reservas-site-painel", () => ({ conferirEscoposReservasBeds24: m.escopos }));
import {
  conferirEscoposReservasBeds24Acao,
  desligarImovelReservasBeds24Acao,
  ligarImovelReservasBeds24Acao,
  pausarReservasBeds24Acao,
  retomarReservasBeds24Acao,
  simularReservaBeds24Acao,
} from "./acoes-reservas";
import { ERRO_LIGAR_SEM_ENSAIO } from "./reservas-site-config";

const ID = "11111111-1111-4111-8111-111111111111";
const IMOVEL = "22222222-2222-4222-8222-222222222222";
const form = (v: Record<string, string>) => {
  const f = new FormData();
  // A empresa nunca vem do formulário: um campo forjado é ignorado.
  f.set("organizacaoId", "outra-org");
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};
const sessao = (papel: string) => m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: [] });

beforeEach(() => {
  vi.clearAllMocks();
  sessao("admin");
  m.simular.mockResolvedValue({ ok: true, operacaoId: "op", repetida: false, imovelDesligado: "espera_ligar", tipo: "criar", pedido: {} });
  for (const f of [m.pausar, m.retomar, m.ligar, m.desligar]) f.mockResolvedValue({ ok: true });
  m.escopos.mockResolvedValue({ lidos: false, motivo: "fora_da_producao" });
});

describe("Simular (reserva:editar)", () => {
  it.each(["admin", "operacao"])("%s simula e volta à ficha com a chave do resultado", async (papel) => {
    sessao(papel);
    await expect(simularReservaBeds24Acao(form({ reservaId: ID }))).rejects.toThrow(`REDIRECT /painel/reservas/${ID}?beds24=simulada_imovel_desligado`);
    expect(m.simular).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org", papel }), ID, process.env, expect.any(Date));
  });

  it("o motivo de nada simular vai na chave", async () => {
    m.simular.mockResolvedValue({ ok: false, motivo: "sem_pagamento" });
    await expect(simularReservaBeds24Acao(form({ reservaId: ID }))).rejects.toThrow(`REDIRECT /painel/reservas/${ID}?beds24=nada_sem_pagamento`);
  });

  it.each(["proprietario", "limpeza", "hospede"])("%s é recusado antes de ler o formulário", async (papel) => {
    sessao(papel);
    await expect(simularReservaBeds24Acao(form({ reservaId: ID }))).rejects.toBeInstanceOf(AcessoNegado);
    expect(m.simular).not.toHaveBeenCalled();
  });

  it("id inválido volta à lista sem chamar o domínio", async () => {
    await expect(simularReservaBeds24Acao(form({ reservaId: "x" }))).rejects.toThrow("REDIRECT /painel/reservas");
    expect(m.simular).not.toHaveBeenCalled();
  });
});

describe("Integrações (configuracao:editar): pausa, imóveis ligados e escopos", () => {
  const acoes = [
    ["pausar", () => pausarReservasBeds24Acao({}, form({})), m.pausar],
    ["retomar", () => retomarReservasBeds24Acao({}, form({})), m.retomar],
    ["ligar", () => ligarImovelReservasBeds24Acao({}, form({ imovelId: IMOVEL })), m.ligar],
    ["desligar", () => desligarImovelReservasBeds24Acao({}, form({ imovelId: IMOVEL })), m.desligar],
  ] as const;

  it.each(["operacao", "proprietario", "limpeza"])("%s não muda nada (nem lê os escopos)", async (papel) => {
    sessao(papel);
    for (const [, acao, dominio] of acoes) {
      expect(await acao()).toEqual({ ok: false, mensagem: expect.stringContaining("Somente quem edita as configurações") });
      expect(dominio).not.toHaveBeenCalled();
    }
    expect(await conferirEscoposReservasBeds24Acao({}, form({}))).toEqual({ mensagem: expect.stringContaining("Somente quem edita as configurações") });
    expect(m.escopos).not.toHaveBeenCalled();
    expect(m.revalidar).not.toHaveBeenCalled();
  });

  it("o admin muda pela sessão (a empresa do formulário é ignorada) e a tela é revalidada", async () => {
    for (const [, acao, dominio] of acoes) {
      expect(await acao()).toMatchObject({ ok: true });
      expect(dominio).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org", papel: "admin" }), ...(dominio === m.pausar ? [expect.any(Date)] : dominio === m.retomar ? [] : dominio === m.ligar ? [IMOVEL, process.env, expect.any(Date)] : [IMOVEL]));
    }
    expect(m.revalidar).toHaveBeenCalledWith("/painel", "layout");
  });

  it("ligar sem ensaio: a recusa do domínio chega à tela", async () => {
    m.ligar.mockResolvedValue({ ok: false, erro: ERRO_LIGAR_SEM_ENSAIO });
    expect(await ligarImovelReservasBeds24Acao({}, form({ imovelId: IMOVEL }))).toEqual({ ok: false, mensagem: ERRO_LIGAR_SEM_ENSAIO });
  });

  it("escopos: o resultado do domínio, lido com o ambiente do processo", async () => {
    expect(await conferirEscoposReservasBeds24Acao({}, form({}))).toEqual({ resultado: { lidos: false, motivo: "fora_da_producao" } });
    expect(m.escopos).toHaveBeenCalledWith(process.env);
  });
});
