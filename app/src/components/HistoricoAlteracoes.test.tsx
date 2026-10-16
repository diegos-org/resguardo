// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LinhaHistorico } from "@/auditoria/auditoria";
import { validarImovel } from "@/imoveis/validacao";
import { HistoricoAlteracoes } from "./HistoricoAlteracoes";

afterEach(cleanup);

const linha = (mudancas: LinhaHistorico["mudancas"]): LinhaHistorico => ({
  id: "h-1",
  acao: "imovel.editar",
  mudancas,
  criadoEm: new Date("2026-10-15T15:00:00Z"),
  autor: "Pessoa Fictícia",
});

describe("histórico da ficha do imóvel", () => {
  it("a mudança da frase de abertura (M7.17) aparece com o nome do campo da ficha, não com o nome da coluna", () => {
    render(<HistoricoAlteracoes linhas={[linha({ frase: ["", "Dias leves fictícios entre a praia e os restaurantes."] })]} />);
    expect(screen.getByText("Frase de abertura (site): — → Dias leves fictícios entre a praia e os restaurantes.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("frase:");
  });

  it("todo campo do cadastro do imóvel tem nome em português no histórico", () => {
    const r = validarImovel({ codigo: "t1", nome: "Studio fictício" });
    if (!r.ok) throw new Error("dados de teste inválidos");
    const campos = Object.keys(r.dados);
    render(<HistoricoAlteracoes linhas={[linha(Object.fromEntries(campos.map((c) => [c, ["a", "b"]])))]} />);
    const itens = [...document.querySelectorAll("li li")].map((li) => li.textContent ?? "");
    expect(itens).toHaveLength(campos.length);
    for (const c of campos) expect(itens.some((t) => t.startsWith(`${c}:`)), `campo sem nome: ${c}`).toBe(false);
  });
});
