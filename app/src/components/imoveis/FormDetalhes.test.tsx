// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EstadoDetalhes } from "@/imoveis/acoes";
import { DETALHES_VAZIOS } from "@/imoveis/detalhes";
import { FormDetalhes } from "./FormDetalhes";

afterEach(cleanup);

const IMOVEL = "11111111-1111-4111-8111-111111111111";
/** Pelo começo do rótulo: depois de um erro, a mensagem fica dentro do rótulo. */
const campo = (rotulo: string) => screen.getByLabelText(new RegExp(`^${rotulo}`)) as HTMLInputElement;

describe("cadastro completo: horários da casa no formato 15:00 (M7.22)", () => {
  it("entrada e saída são campos de texto com a hora guardada, sem obrigar (em branco vale o padrão da casa)", () => {
    render(<FormDetalhes imovelId={IMOVEL} inicial={{ ...DETALHES_VAZIOS, checkinAPartirDe: "14:30", checkoutAte: "10:00" }} salvar={vi.fn()} />);
    for (const [rotulo, valor] of [["Entrada a partir de", "14:30"], ["Saída até", "10:00"]]) {
      const c = campo(rotulo);
      expect([c.type, c.value, c.placeholder, c.required], rotulo).toEqual(["text", valor, "15:00", false]);
    }
  });

  it("depois da recusa do servidor, o campo volta com o que foi digitado, marcado como inválido e com a mensagem", async () => {
    const salvar = vi.fn(async (_e: EstadoDetalhes, f: FormData): Promise<EstadoDetalhes> => ({
      mensagem: "Confira os campos destacados.",
      erros: { checkoutAte: "Use o formato 15:00 (24 horas)." },
      valores: { checkinAPartirDe: String(f.get("checkinAPartirDe")), checkoutAte: String(f.get("checkoutAte")) },
    }));
    render(<FormDetalhes imovelId={IMOVEL} inicial={{ ...DETALHES_VAZIOS, checkinAPartirDe: "15:00", checkoutAte: "11:00" }} salvar={salvar} />);
    fireEvent.change(campo("Saída até"), { target: { value: "25:00" } });
    // O navegador já recusaria "25:00" (pattern); aqui o envio é direto, para conferir a resposta do servidor.
    fireEvent.submit(screen.getByRole("form", { name: "Cadastro completo do imóvel" }));
    expect(await screen.findByText("Use o formato 15:00 (24 horas).")).toBeTruthy();
    expect(Object.fromEntries(salvar.mock.calls[0][1])).toMatchObject({ checkinAPartirDe: "15:00", checkoutAte: "25:00" });
    expect([campo("Saída até").value, campo("Saída até").getAttribute("aria-invalid")]).toEqual(["25:00", "true"]);
    expect(campo("Entrada a partir de").getAttribute("aria-invalid")).toBeNull();
  });
});

describe("cadastro completo: dias de entrada e de saída de segunda a domingo (M7.22)", () => {
  it("cada caixa mostra o dia e guarda o número de sempre (0 = domingo); só os dias gravados vêm marcados", () => {
    render(<FormDetalhes imovelId={IMOVEL} inicial={{ ...DETALHES_VAZIOS, diasChegada: [5], diasSaida: [0] }} salvar={vi.fn()} />);
    const ordem = [["segunda", "1"], ["terça", "2"], ["quarta", "3"], ["quinta", "4"], ["sexta", "5"], ["sábado", "6"], ["domingo", "0"]];
    for (const [grupo, marcado] of [["diasChegada", "5"], ["diasSaida", "0"]]) {
      const caixas = [...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${grupo}"]`)];
      expect(caixas.map((c) => [c.parentElement?.textContent?.trim(), c.value]), grupo).toEqual(ordem);
      expect(caixas.filter((c) => c.checked).map((c) => c.value), grupo).toEqual([marcado]);
    }
  });
});

describe("cadastro completo: os preços importados do Beds24 na ficha (M3.11a)", () => {
  it("com noites importadas de hoje em diante, uma linha em Preço e taxas, com o link para a revisão; sem elas, nada", () => {
    const { unmount } = render(<FormDetalhes imovelId={IMOVEL} inicial={DETALHES_VAZIOS} salvar={vi.fn()} importados={{ noites: 30, fim: "2026-11-20" }} />);
    const linha = screen.getByText(/^Preços importados do Beds24:/);
    expect(linha.textContent).toBe("Preços importados do Beds24: 30 noites, até 20/11/2026. Eventos, feriadões e períodos valem por cima. Revisar a importação");
    expect(screen.getByRole("link", { name: "Revisar a importação" }).getAttribute("href")).toBe(`/painel/configuracoes/calendario/importar/${IMOVEL}`);
    expect(linha.closest("fieldset")?.querySelector("legend")?.textContent).toBe("Preço e taxas (R$)");
    unmount();
    // Com outra fonte, a camada não vale: a linha diz isso.
    const outra = render(<FormDetalhes imovelId={IMOVEL} inicial={{ ...DETALHES_VAZIOS, fontePrecos: "beds24" }} salvar={vi.fn()} importados={{ noites: 2, fim: "2026-10-23" }} />);
    expect(screen.getByText(/^Preços importados do Beds24:/).textContent).toContain("Só valem com preços automáticos do SCL.");
    outra.unmount();
    render(<FormDetalhes imovelId={IMOVEL} inicial={DETALHES_VAZIOS} salvar={vi.fn()} />);
    expect(screen.queryByText(/Preços importados do Beds24/)).toBeNull();
  });
});
