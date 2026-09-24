import { describe, expect, it } from "vitest";
import { ACOES, type Acao, AcessoNegado, autorizar, exigir, podeFazer, type Sessao } from "./politica";

const org = "org-scl";
const dono: Sessao = { usuarioId: "u-dono", organizacaoId: org, papel: "proprietario", imovelIds: ["im-403"] };
const admin: Sessao = { ...dono, usuarioId: "u-admin", papel: "admin", imovelIds: [] };
const operacao: Sessao = { ...dono, usuarioId: "u-op", papel: "operacao", imovelIds: [] };
const hospede: Sessao = { ...dono, usuarioId: "u-hosp", papel: "hospede", imovelIds: [] };

const ok = (s: Sessao | null, acao: Acao, imovelId?: string, organizacaoId = org) =>
  autorizar(s, acao, { organizacaoId, imovelId }).permitido;

describe("proprietário", () => {
  it("lê o próprio imóvel e seu financeiro", () => {
    expect(ok(dono, "imovel:ler", "im-403")).toBe(true);
    expect(ok(dono, "financeiro:ler", "im-403")).toBe(true);
    expect(ok(dono, "reserva:ler", "im-403")).toBe(true);
  });

  it("não vê imóvel de outro dono, nem recurso sem imóvel", () => {
    expect(autorizar(dono, "financeiro:ler", { organizacaoId: org, imovelId: "im-102" })).toEqual({
      permitido: false,
      motivo: "IMOVEL_NAO_VINCULADO",
    });
    expect(ok(dono, "financeiro:ler")).toBe(false);
    expect(ok({ ...dono, imovelIds: ["*"] }, "financeiro:ler", "im-102")).toBe(false);
  });

  it("não edita nada", () => {
    for (const acao of ACOES.filter((a) => !a.endsWith(":ler"))) {
      expect(ok(dono, acao, "im-403")).toBe(false);
    }
  });
});

describe("operação", () => {
  it("cuida de reservas e limpezas, mas não vê financeiro", () => {
    expect(ok(operacao, "reserva:editar", "im-102")).toBe(true);
    expect(ok(operacao, "limpeza:editar", "im-102")).toBe(true);
    expect(ok(operacao, "financeiro:ler", "im-102")).toBe(false);
    expect(ok(operacao, "manutencao:editar", "im-102")).toBe(true);
    expect(ok(operacao, "manutencao:aprovar", "im-102")).toBe(false);
    expect(ok(operacao, "usuario:gerenciar")).toBe(false);
  });
});

describe("admin", () => {
  it("pode tudo, mas só dentro da própria organização", () => {
    for (const acao of ACOES) expect(ok(admin, acao, "im-102")).toBe(true);
    expect(autorizar(admin, "imovel:ler", { organizacaoId: "outra" })).toEqual({ permitido: false, motivo: "OUTRA_ORGANIZACAO" });
  });
});

describe("hóspede", () => {
  it("ainda não tem acesso a nada (portal do hóspede é o M9)", () => {
    for (const acao of ACOES) expect(ok(hospede, acao, "im-403")).toBe(false);
  });
});

describe("sessões inválidas", () => {
  it("nega sessão ausente, incompleta ou com papel desconhecido", () => {
    expect(ok(null, "imovel:ler", "im-403")).toBe(false);
    expect(ok({ ...admin, usuarioId: " " }, "imovel:ler")).toBe(false);
    expect(ok({ ...admin, organizacaoId: "" }, "imovel:ler", undefined, "")).toBe(false);
    for (const papel of ["root", "__proto__", "toString", ["admin"], { toString: () => "admin" }, new String("admin")]) {
      expect(ok({ ...admin, papel: papel as never }, "imovel:ler")).toBe(false);
    }
  });

  it("nega ação desconhecida", () => {
    expect(ok(admin, "tudo:apagar" as Acao)).toBe(false);
  });
});

describe("exigir / podeFazer", () => {
  it("lança AcessoNegado com o motivo", () => {
    expect(() => exigir(dono, "imovel:editar", { organizacaoId: org, imovelId: "im-403" })).toThrow(AcessoNegado);
    expect(() => exigir(admin, "imovel:editar", { organizacaoId: org })).not.toThrow();
  });

  it("responde permissões por papel", () => {
    expect(podeFazer("operacao", "financeiro:ler")).toBe(false);
    expect(podeFazer("admin", "financeiro:editar")).toBe(true);
  });
});
