// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRECOS_MARKETPLACE_PADRAO } from "@/marketplace/precos";
import { type ImovelOperavel, OperacaoMarketplace, textoDaSimulacao, textoDoEnvio } from "./OperacaoMarketplace";

const imovel: ImovelOperavel = {
  id: "11111111-1111-4111-8111-111111111111",
  codigo: "403",
  nome: "Studio Exemplo",
  hoje: "2026-10-03",
  fontePrecos: "scl",
  regras: { precoBase: 30000, taxaLimpeza: 15000, hospedeExtraValor: null, hospedeExtraAPartirDe: null, estadiaMinima: 2, estadiaMaxima: null, antecedenciaMinima: null, janelaMaxima: null, diasChegada: [1, 5], diasSaida: [], checkinAPartirDe: "15:00", checkoutAte: "11:00" },
  periodos: [{ id: "p1", nome: "Réveillon", inicio: "2026-12-28", fim: "2027-01-02", precoNoite: 90000, estadiaMinima: 5 }],
  envio: { naLista: true, automatico: true, ultimo: { em: new Date("2026-10-01T10:00:00Z"), situacao: "ok" } },
};
const acao = vi.fn(async () => ({}));
const render_ = (over: Partial<Parameters<typeof OperacaoMarketplace>[0]> = {}) =>
  render(
    <OperacaoMarketplace
      imoveis={[imovel]}
      precos={PRECOS_MARKETPLACE_PADRAO}
      limpezas={[
        { id: "l1", data: "2026-10-02", estado: "pedida", imovelId: imovel.id, imovelCodigo: "403", imovelNome: "Studio Exemplo", reservaCodigo: "SCL-AAA", entraNoDia: false, atrasada: true, podeMarcar: true },
        { id: "l2", data: "2026-10-05", estado: "confirmada", imovelId: imovel.id, imovelCodigo: "403", imovelNome: "Studio Exemplo", reservaCodigo: null, entraNoDia: true, atrasada: false, podeMarcar: false },
        { id: "l3", data: "2026-10-01", estado: "realizada", imovelId: imovel.id, imovelCodigo: "403", imovelNome: "Studio Exemplo", reservaCodigo: "SCL-BBB", entraNoDia: false, atrasada: false, podeMarcar: false },
      ]}
      manutencoes={[{ id: "m1", imovelCodigo: "403", titulo: "Troca do chuveiro", descricao: "", estado: "realizada", dataRealizada: "2026-10-01", porContaPropria: true }]}
      empresa="Sua Casa Exemplo"
      salvarPrecos={acao}
      novoPeriodo={acao}
      excluirPeriodo={async () => {}}
      marcarLimpeza={acao}
      registrarManutencao={acao}
      {...over}
    />,
  );
afterEach(cleanup);

describe("portal marketplace (M12.4): seção do proprietário", () => {
  it("mostra o imóvel com preços, regras, simulação do modelo B ao vivo, períodos, limpezas e manutenção", () => {
    render_();
    expect(screen.getByRole("heading", { name: "Seu imóvel no marketplace" })).toBeTruthy();
    const form = screen.getByRole("form", { name: "Preços e regras de venda do 403" });
    expect((within(form).getByLabelText(/Preço da noite/) as HTMLInputElement).value).toBe("300,00");
    expect((within(form).getByLabelText(/Estadia mínima/) as HTMLInputElement).value).toBe("2");
    // Dois grupos de dias (entrada e saída): só a segunda da entrada está marcada.
    const segundas = within(form).getAllByLabelText("segunda") as HTMLInputElement[];
    expect(segundas.map((c) => c.checked)).toEqual([true, false]);
    // Simulação com o preço cadastrado: no site o hóspede paga menos e o proprietário recebe mais que no Airbnb.
    expect(form.textContent).toContain(textoDaSimulacao(30000, PRECOS_MARKETPLACE_PADRAO, "Sua Casa Exemplo"));
    expect(form.textContent).toContain("no Airbnb você receberia R$ 252,00");
    // Digitou outro preço: a simulação acompanha.
    fireEvent.change(within(form).getByLabelText(/Preço da noite/), { target: { value: "500,00" } });
    expect(form.textContent).toContain(textoDaSimulacao(50000, PRECOS_MARKETPLACE_PADRAO, "Sua Casa Exemplo"));
    // Períodos reaproveitam o componente do painel.
    expect(screen.getByText("Réveillon")).toBeTruthy();
    // Limpezas: a atrasada e a futura com entrada no dia têm situação clara; só a que já chegou tem o botão.
    const limpezas = screen.getByRole("region", { name: "Limpezas" });
    expect(limpezas.textContent).toContain("A fazer · atrasada");
    expect(limpezas.textContent).toContain("entra hóspede no mesmo dia");
    expect(within(limpezas).getAllByRole("button", { name: "Marcar como feita" })).toHaveLength(1);
    // Manutenção: histórico e formulário com a data limitada a hoje.
    const manutencao = screen.getByRole("region", { name: "Manutenção" });
    expect(manutencao.textContent).toContain("Troca do chuveiro");
    expect((within(manutencao).getByLabelText("Data do serviço") as HTMLInputElement).getAttribute("max")).toBe("2026-10-03");
  });

  it("sem imóvel marketplace, não aparece; com preços no Beds24, o preço da noite fica só de leitura", () => {
    const { container } = render_({ imoveis: [] });
    expect(container.textContent).toBe("");
    cleanup();
    render_({ imoveis: [{ ...imovel, fontePrecos: "beds24" }] });
    const form = screen.getByRole("form", { name: "Preços e regras de venda do 403" });
    const campo = within(form).getByLabelText(/Preço da noite/) as HTMLInputElement;
    expect(campo.readOnly).toBe(true);
    expect(screen.getByText(/definidos no Beds24/)).toBeTruthy();
  });

  it("explica o envio ao Beds24 sem supor: fora da lista, manual e automático", () => {
    expect(textoDoEnvio({ naLista: false, automatico: true, ultimo: null }, "SCL")).toContain("ainda não está na lista de envio");
    expect(textoDoEnvio({ naLista: true, automatico: false, ultimo: null }, "SCL")).toContain("Ainda não houve envio");
    expect(textoDoEnvio({ naLista: true, automatico: true, ultimo: { em: new Date("2026-10-01T10:00:00Z"), situacao: "ok" } }, "SCL")).toMatch(/roda todo dia.*Último envio: 01\/10\/2026, 07:00 \(concluído\)/);
  });
});
