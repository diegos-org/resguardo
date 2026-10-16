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

describe("datas no histórico (M7.22)", () => {
  const de = (acao: string, mudancas: LinhaHistorico["mudancas"]): LinhaHistorico => ({ ...linha(mudancas), id: acao, acao });

  it("as datas AAAA-MM-DD saem em dd/mm/aaaa, também nos registros antigos; carimbo ISO, UUID e o quando ficam certos", () => {
    render(
      <HistoricoAlteracoes
        linhas={[
          de("reserva.sincronizar", { checkin: ["2026-10-16", "2026-10-18"], checkout: ["2026-10-20", "2026-10-21"] }),
          de("recebimento.registrar", { recebimento: [null, "150000 em 2026-10-16"] }),
          de("bloqueio.remover", { bloqueio: ["2026-10-16 a 2026-10-20", null] }),
          de("contrato.encerrar", { contrato: ["Gestão completa até sem fim", "até 2026-12-31"] }),
          de("imovel.periodo.excluir", { "período Réveillon": ["2026-12-28 a 2027-01-02", null] }),
          de("adiantamento.quitar", { Pix: [null, "150000 em 2026-10-16"] }),
          de("imovel.editar", { carimbo: [null, "2026-10-16T18:05:00.000Z"], id: [null, "00000000-0000-4000-8000-000000002026"] }),
        ]}
      />,
    );
    const itens = [...document.querySelectorAll("li li")].map((li) => li.textContent ?? "");
    expect(itens).toEqual([
      "Entrada: 16/10/2026 → 18/10/2026",
      "Saída: 20/10/2026 → 21/10/2026",
      "Quem recebe do canal: — → 150000 em 16/10/2026",
      "bloqueio: 16/10/2026 a 20/10/2026 → —",
      "Contrato: Gestão completa até sem fim → até 31/12/2026",
      "período Réveillon: 28/12/2026 a 02/01/2027 → —",
      "Pix: — → 150000 em 16/10/2026",
      "carimbo: — → 2026-10-16T18:05:00.000Z",
      "id: — → 00000000-0000-4000-8000-000000002026",
    ]);
    // O quando de cada linha: dia e hora no horário de Brasília, sem vírgula nem segundos.
    expect(document.body.textContent).toContain("Pessoa Fictícia removeu o bloqueio · 15/10/2026 às 12:00");
    expect(document.body.textContent).not.toMatch(/15\/10\/2026, |12:00:00/);
  });
});
