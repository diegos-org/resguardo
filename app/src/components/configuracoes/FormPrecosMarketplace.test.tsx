// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PESOS_PADRAO_ANTIGO, PRECOS_MARKETPLACE_PADRAO } from "@/marketplace/precos";
import { FormPrecosMarketplace } from "./FormPrecosMarketplace";

afterEach(cleanup);
const salvar = vi.fn();
const celula = (linha: string, coluna: number) => screen.getByText(linha).closest("tr")!.children[coluna].textContent;
// Partes iguais (1/1/1, o modelo de 4/10): os números abaixo são desses pesos.
const IGUAIS = { ...PRECOS_MARKETPLACE_PADRAO, pesos: { ...PESOS_PADRAO_ANTIGO } };

it("padrão 6/3/3 (M12.5): desconto de 3%, SCL com 6% e o proprietário com 3% a mais", () => {
  render(<FormPrecosMarketplace precos={PRECOS_MARKETPLACE_PADRAO} salvar={salvar} />);
  expect(screen.getByText(/desconto do site é de aproximadamente/).textContent).toContain("3%");
  expect((screen.getByLabelText("SCL") as HTMLInputElement).value).toBe("2");
  // R$ 1.650: margem 12% = R$ 198 → hóspede R$ 49,50, proprietário R$ 49,50, SCL R$ 99,00.
  expect(celula("Desconto do site", 3)).toBe("R$ 49,50");
  expect(celula("SCL recebe", 3)).toBe("R$ 99,00");
});

it("simulação de exemplo (R$ 500 × 3 + R$ 150 = R$ 1.650): Airbnb, Booking e site com partes iguais", () => {
  render(<FormPrecosMarketplace precos={IGUAIS} salvar={salvar} />);
  expect(screen.getByText(/desconto do site é de aproximadamente/).textContent).toContain("4%");
  expect(screen.getByText("Valor cheio: R$ 1.650,00")).toBeTruthy();
  expect(celula("Hóspede paga", 1)).toBe("R$ 1.650,00");
  expect(celula("Hóspede paga", 3)).toBe("R$ 1.584,00");
  expect(celula("Desconto do site", 3)).toBe("R$ 66,00");
  expect(celula("Taxa (OTA ou pagamento)", 1)).toBe("R$ 264,00");
  expect(celula("Taxa (OTA ou pagamento)", 2)).toBe("R$ 247,50");
  expect(celula("Taxa (OTA ou pagamento)", 3)).toBe("R$ 63,36");
  expect(celula("SCL recebe", 3)).toBe("R$ 66,00");
  expect(celula("Proprietário recebe", 1)).toBe("R$ 1.386,00");
  expect(celula("Proprietário recebe", 2)).toBe("R$ 1.402,50");
  expect(celula("Proprietário recebe", 3)).toBe("R$ 1.454,64");
  expect(screen.getByText(/o hóspede economiza R\$ 66,00 e o proprietário recebe R\$ 68,64 a mais/)).toBeTruthy();
});

it("a simulação reage aos campos antes de salvar: pesos, taxas e a estadia de exemplo; campo inválido avisa", () => {
  render(<FormPrecosMarketplace precos={IGUAIS} salvar={salvar} />);
  fireEvent.change(screen.getByLabelText("Hóspede"), { target: { value: "2" } });
  expect(screen.getByText(/desconto do site é de aproximadamente/).textContent).toContain("6%");
  expect(celula("Desconto do site", 3)).toBe("R$ 99,00");
  fireEvent.change(screen.getByLabelText("Diária (R$)"), { target: { value: "1.000,00" } });
  fireEvent.change(screen.getByLabelText("Noites"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Limpeza (R$)"), { target: { value: "" } });
  expect(screen.getByText("Valor cheio: R$ 1.000,00")).toBeTruthy();
  expect(celula("Desconto do site", 3)).toBe("R$ 60,00");
  // Taxa do pagamento igual à da OTA: sem margem, aviso e site pelo valor cheio.
  fireEvent.change(screen.getByLabelText("Taxa do pagamento no site (%)"), { target: { value: "16" } });
  expect(celula("Hóspede paga", 3)).toBe("R$ 1.000,00");
  expect(screen.getByRole("note").textContent).toContain("não há margem a dividir");
  // Percentual inválido: sem simulação, com orientação.
  fireEvent.change(screen.getByLabelText("Taxa do pagamento no site (%)"), { target: { value: "abc" } });
  expect(screen.queryByText(/Valor cheio:/)).toBeNull();
  expect(screen.getByText("Corrija os campos acima para ver a simulação.")).toBeTruthy();
  expect(salvar).not.toHaveBeenCalled();
});

it("valores gravados mudam (ex.: \"Usar o padrão novo\"): os campos recomeçam deles; sem mudança, o que foi digitado fica", () => {
  const { rerender } = render(<FormPrecosMarketplace precos={IGUAIS} salvar={salvar} />);
  const scl = () => (screen.getByLabelText("SCL") as HTMLInputElement).value;
  expect(scl()).toBe("1");
  fireEvent.change(screen.getByLabelText("Hóspede"), { target: { value: "3" } });
  // Mesmos valores gravados (outra renderização da página): o que foi digitado continua.
  rerender(<FormPrecosMarketplace precos={{ ...IGUAIS, pesos: { ...IGUAIS.pesos } }} salvar={salvar} />);
  expect((screen.getByLabelText("Hóspede") as HTMLInputElement).value).toBe("3");
  // Gravados mudaram: os campos mostram os novos, e salvar em seguida não regrava os antigos.
  rerender(<FormPrecosMarketplace precos={PRECOS_MARKETPLACE_PADRAO} salvar={salvar} />);
  expect(scl()).toBe("2");
  expect((screen.getByLabelText("Hóspede") as HTMLInputElement).value).toBe("1");
});
