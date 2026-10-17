/**
 * Ações do painel das reservas do site no Beds24 (M8.3a, desenho 8; seção 10, testes 12 e 16): deny-by-default. "Simular" e
 * as marcas manuais das OTAs (M8.3b) pedem `reserva:editar`; pausar, retomar, ligar e desligar um imóvel, conferir os escopos
 * e o ensaio (M8.3c: criar, cancelar e conferir; plano, teste 38) pedem `configuracao:editar` (hoje, só o admin). A empresa vem
 * só da sessão. Domínio simulado: aqui só a ordem sessão → permissão → validação → domínio, e o cliente das fábricas do
 * ambiente (simuladas: nenhum cliente de verdade nasce aqui) entregue ao domínio.
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
  fechadas: vi.fn(),
  reabertas: vi.fn(),
  criarEnsaio: vi.fn(),
  cancelarEnsaio: vi.fn(),
  conferirEnsaio: vi.fn(),
  cliente: vi.fn(),
  leitor: vi.fn(),
  avisar: vi.fn(),
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
vi.mock("./reservas-site-tarefas", async (original) => ({ ...(await original<typeof import("./reservas-site-tarefas")>()), marcarDatasFechadasNasOtas: m.fechadas, marcarDatasReabertasNasOtas: m.reabertas }));
vi.mock("./reservas-site-ensaio", async (original) => ({
  ...(await original<typeof import("./reservas-site-ensaio")>()),
  criarEnsaioReservasBeds24: m.criarEnsaio,
  cancelarEnsaioReservasBeds24: m.cancelarEnsaio,
  conferirEnsaioReservasBeds24: m.conferirEnsaio,
}));
vi.mock("@/observabilidade/aviso-do-servidor", () => ({ avisarErroDoServidor: m.avisar }));
vi.mock("./http", async (original) => ({ ...(await original<typeof import("./http")>()), clienteDeReservasDoAmbiente: m.cliente, leitorDeReservasDoAmbiente: m.leitor }));
import {
  cancelarEnsaioReservasBeds24Acao,
  conferirEnsaioReservasBeds24Acao,
  conferirEscoposReservasBeds24Acao,
  criarEnsaioReservasBeds24Acao,
  desligarImovelReservasBeds24Acao,
  ligarImovelReservasBeds24Acao,
  marcarDatasFechadasNasOtasAcao,
  marcarDatasReabertasNasOtasAcao,
  pausarReservasBeds24Acao,
  retomarReservasBeds24Acao,
  simularReservaBeds24Acao,
} from "./acoes-reservas";
import { ERRO_LIGAR_SEM_ENSAIO } from "./reservas-site-config";
import { ERRO_ENSAIO_INTERROMPIDO, ERRO_ENSAIO_NAO_RESOLVIDO } from "./reservas-site-ensaio";

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
  m.fechadas.mockResolvedValue({ ok: true });
  m.reabertas.mockResolvedValue({ ok: true });
  m.criarEnsaio.mockResolvedValue({ ok: true, desfecho: "criado", operacaoId: ID });
  m.cancelarEnsaio.mockResolvedValue({ ok: true, desfecho: "cancelado", operacaoId: ID });
  m.conferirEnsaio.mockResolvedValue({ ok: true, desfecho: "nada_criado", operacaoId: ID });
  m.cliente.mockReturnValue(null);
  m.leitor.mockReturnValue(null);
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

describe("as marcas manuais das OTAs na ficha (M8.3b, reserva:editar)", () => {
  const marcas = [
    ["Datas fechadas nas OTAs", marcarDatasFechadasNasOtasAcao, m.fechadas, "ota_fechada"],
    ["Datas reabertas nas OTAs", marcarDatasReabertasNasOtasAcao, m.reabertas, "ota_reaberta"],
  ] as const;

  it.each(["admin", "operacao"])("%s marca e volta à ficha com o resultado; a empresa vem da sessão (a do formulário é ignorada)", async (papel) => {
    sessao(papel);
    for (const [, acao, dominio, chave] of marcas) {
      await expect(acao(form({ reservaId: ID }))).rejects.toThrow(`REDIRECT /painel/reservas/${ID}?beds24=${chave}`);
      expect(dominio).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org", papel }), ID, process.env, expect.any(Date));
    }
    expect(m.revalidar).toHaveBeenCalledWith("/painel", "layout");
  });

  it("a recusa do domínio volta à ficha com o texto em ?erro=", async () => {
    const erro = "Esta reserva não tem datas a fechar à mão nas OTAs agora.";
    for (const [, acao, dominio] of marcas) {
      dominio.mockResolvedValue({ ok: false, erro });
      await expect(acao(form({ reservaId: ID }))).rejects.toThrow(`REDIRECT /painel/reservas/${ID}?erro=${encodeURIComponent(erro)}`);
    }
  });

  it.each(["proprietario", "limpeza", "hospede"])("%s é recusado antes de ler o formulário", async (papel) => {
    sessao(papel);
    for (const [, acao, dominio] of marcas) {
      await expect(acao(form({ reservaId: ID }))).rejects.toBeInstanceOf(AcessoNegado);
      expect(dominio).not.toHaveBeenCalled();
    }
    expect(m.revalidar).not.toHaveBeenCalled();
  });

  it("id inválido volta à lista sem chamar o domínio", async () => {
    for (const [, acao, dominio] of marcas) {
      await expect(acao(form({ reservaId: "x" }))).rejects.toThrow("REDIRECT /painel/reservas");
      expect(dominio).not.toHaveBeenCalled();
    }
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
    // Muda junto (M8.3c, bloco F): a leitura passa a ser guardada, com o banco e a empresa da sessão.
    expect(m.escopos).toHaveBeenCalledWith({ banco: true }, "org", process.env);
  });
});

describe("o ensaio em Integrações (M8.3c, configuracao:editar; plano, teste 38)", () => {
  const acoes = [
    ["criar", () => criarEnsaioReservasBeds24Acao({}, form({ imovelId: IMOVEL, chegada: "2026-11-03", saida: "2026-11-04" })), m.criarEnsaio],
    ["cancelar", () => cancelarEnsaioReservasBeds24Acao({}, form({ operacaoId: ID })), m.cancelarEnsaio],
    ["conferir", () => conferirEnsaioReservasBeds24Acao({}, form({ operacaoId: ID })), m.conferirEnsaio],
  ] as const;

  it.each(["operacao", "proprietario", "limpeza"])("%s é recusado no servidor: nenhum domínio, nenhuma fábrica do cliente", async (papel) => {
    sessao(papel);
    for (const [, acao, dominio] of acoes) {
      expect(await acao()).toEqual({ ok: false, mensagem: expect.stringContaining("Somente quem edita as configurações") });
      expect(dominio).not.toHaveBeenCalled();
    }
    expect(m.cliente).not.toHaveBeenCalled();
    expect(m.leitor).not.toHaveBeenCalled();
  });

  it("o admin: a empresa vem da sessão, o cliente da fábrica do ambiente vai ao domínio (null fora da produção) e o texto do desfecho volta", async () => {
    const cliente = { cliente: true };
    m.cliente.mockReturnValue(cliente);
    expect(await acoes[0][1]()).toEqual({ ok: true, mensagem: expect.stringContaining("Ensaio criado no Beds24") });
    expect(m.criarEnsaio).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org", papel: "admin" }), { imovelId: IMOVEL, chegada: "2026-11-03", saida: "2026-11-04" }, process.env, expect.objectContaining({ cliente, relogio: expect.anything() }));
    expect(m.cliente).toHaveBeenCalledWith(process.env, expect.objectContaining({ prazo: expect.any(Function) }));
    expect(await acoes[1][1]()).toEqual({ ok: true, mensagem: expect.stringContaining("agora dá para ligar um imóvel") });
    expect(m.cancelarEnsaio).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org" }), ID, process.env, expect.objectContaining({ cliente }));
    // "Conferir o ensaio" só lê: com a chave desligada, o leitor de reservas do ambiente.
    m.cliente.mockReturnValue(null);
    const leitor = { leitor: true };
    m.leitor.mockReturnValue(leitor);
    expect(await acoes[2][1]()).toEqual({ ok: true, mensagem: expect.stringContaining("nada do ensaio ficou no Beds24") });
    expect(m.conferirEnsaio).toHaveBeenCalledWith({ banco: true }, expect.objectContaining({ organizacaoId: "org" }), ID, process.env, expect.objectContaining({ leitor }));
    expect(m.revalidar).toHaveBeenCalledWith("/painel", "layout");
  });

  it("a recusa do domínio, o desfecho que pede ação e a falha inesperada chegam à tela com o texto fixo", async () => {
    m.criarEnsaio.mockResolvedValue({ ok: false, erro: ERRO_ENSAIO_NAO_RESOLVIDO });
    expect(await acoes[0][1]()).toEqual({ ok: false, mensagem: ERRO_ENSAIO_NAO_RESOLVIDO });
    m.conferirEnsaio.mockResolvedValue({ ok: true, desfecho: "achado_vivo", operacaoId: ID });
    expect(await acoes[2][1]()).toEqual({ ok: false, mensagem: expect.stringContaining("use Cancelar o ensaio") });
    const queda = new Error("detalhe interno que não vai para a tela");
    m.cancelarEnsaio.mockRejectedValue(queda);
    expect(await acoes[1][1]()).toEqual({ ok: false, mensagem: ERRO_ENSAIO_INTERROMPIDO });
    expect(m.avisar).toHaveBeenCalledWith(queda, "ensaio-beds24");
  });
});
