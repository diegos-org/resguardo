// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRECOS_MARKETPLACE_PADRAO } from "@/marketplace/precos";
import type { SituacaoEnvio } from "@/portal/marketplace";
import { type ImovelOperavel, OperacaoMarketplace, textoDaSimulacao, textoDoEnvio, textoSalvo } from "./OperacaoMarketplace";

const imovel: ImovelOperavel = {
  id: "11111111-1111-4111-8111-111111111111",
  codigo: "403",
  nome: "Studio Exemplo",
  hoje: "2026-10-03",
  desde: "2025-01-01",
  fontePrecos: "scl",
  regras: { precoBase: 30000, taxaLimpeza: 15000, hospedeExtraValor: null, hospedeExtraAPartirDe: null, estadiaMinima: 2, estadiaMaxima: null, antecedenciaMinima: null, janelaMaxima: null, diasChegada: [1, 5], diasSaida: [], checkinAPartirDe: "15:00", checkoutAte: "11:00" },
  periodos: [{ id: "p1", nome: "Réveillon", inicio: "2026-12-28", fim: "2027-01-02", precoNoite: 90000, estadiaMinima: 5 }],
  envio: { naLista: true, vinculado: true, escritaPronta: true, automatico: true, ultimo: { em: new Date("2026-10-01T10:00:00Z"), situacao: "ok", falha: "" } },
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
    // Períodos reaproveitam o componente do painel (com preço, porque os preços são do SCL).
    expect(screen.getByText("Réveillon")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Períodos especiais" })).getByLabelText(/Preço da noite/)).toBeTruthy();
    // Limpezas: a atrasada e a futura com entrada no dia têm situação clara; só a que já chegou tem o botão.
    const limpezas = screen.getByRole("region", { name: "Limpezas" });
    expect(limpezas.textContent).toContain("A fazer · atrasada");
    expect(limpezas.textContent).toContain("entra hóspede no mesmo dia");
    expect(within(limpezas).getAllByRole("button", { name: "Marcar como feita" })).toHaveLength(1);
    // Manutenção: histórico e formulário com a data limitada a hoje.
    const manutencao = screen.getByRole("region", { name: "Manutenção" });
    expect(manutencao.textContent).toContain("Troca do chuveiro");
    expect((within(manutencao).getByLabelText("Data do serviço") as HTMLInputElement).getAttribute("max")).toBe("2026-10-03");
    expect((within(manutencao).getByLabelText("Data do serviço") as HTMLInputElement).getAttribute("min")).toBe("2025-01-01");
  });

  it("sem imóvel marketplace, não aparece; com preços no Beds24, o preço da noite fica só de leitura", () => {
    const { container } = render_({ imoveis: [] });
    expect(container.textContent).toBe("");
    cleanup();
    render_({ imoveis: [{ ...imovel, fontePrecos: "beds24" }] });
    const form = screen.getByRole("form", { name: "Preços e regras de venda do 403" });
    // Sem simulação com o preço base antigo (o site lê o preço de cada noite do Beds24), e o aviso do envio não promete preço.
    expect(form.textContent).not.toContain("no Airbnb você receberia");
    expect(form.textContent).toContain("não dá para simular aqui");
    expect(screen.getByRole("note").textContent).not.toContain("preço da noite e estadias");
    expect(screen.getByRole("note").textContent).toContain("preço da noite é definido no Beds24");
    // Período especial sem campo de preço: só estadia mínima (o servidor recusaria qualquer preço).
    const periodos = screen.getByRole("region", { name: "Períodos especiais" });
    expect(within(periodos).queryByLabelText(/Preço da noite/)).toBeNull();
    expect((within(periodos).getByLabelText(/Estadia mínima/) as HTMLInputElement).required).toBe(true);
    expect(periodos.textContent).toContain("O preço da noite é definido no Beds24");
    const campo = within(form).getByLabelText(/Preço da noite/) as HTMLInputElement;
    expect(campo.readOnly).toBe(true);
    expect(screen.getByText(/definidos no Beds24/)).toBeTruthy();
  });

  it("explica o envio ao Beds24 sem supor: fora da lista, manual e automático", () => {
    const feito = { em: new Date("2026-10-01T10:00:00Z"), situacao: "ok", falha: "" };
    const envio = (over: Partial<SituacaoEnvio> = {}): SituacaoEnvio => ({ naLista: true, vinculado: true, escritaPronta: true, automatico: true, ultimo: feito, ...over });
    expect(textoDoEnvio(envio({ naLista: false }), "SCL")).toContain("até a SCL incluir este imóvel no envio de calendário");
    expect(textoDoEnvio(envio({ automatico: false }), "SCL")).toContain("O envio ao Beds24 é feito pela SCL");
    expect(textoDoEnvio(envio(), "SCL")).toMatch(/roda todo dia.*Último envio: 01\/10\/2026, 07:00 \(concluído\)/);
    // Sem nenhum envio real que tenha incluído o imóvel, ou com o imóvel deixado de fora no último (quarto inacessível, moeda), nada é prometido.
    expect(textoDoEnvio(envio({ ultimo: null }), "SCL")).toContain("até o primeiro envio ao Beds24 confirmar o quarto deste imóvel");
    expect(textoDoEnvio(envio({ ultimo: null }), "SCL")).not.toContain("roda todo dia");
    expect(textoDoEnvio(envio({ ultimo: { ...feito, falha: "O quarto vinculado ao imóvel 403 não está acessível nesta credencial." } }), "SCL")).toContain("ele ficou de fora: O quarto vinculado ao imóvel 403 não está acessível nesta credencial.");
    expect(textoSalvo(envio({ ultimo: { ...feito, falha: "moeda" } }), "SCL")).not.toContain("próximo envio");
    // Na lista, mas sem vínculo com o Beds24 ou com a escrita desligada: nada chega às OTAs, e o texto diz o que falta.
    expect(textoDoEnvio(envio({ vinculado: false }), "SCL")).toContain("vincular este imóvel ao Beds24");
    expect(textoDoEnvio(envio({ vinculado: false }), "SCL")).not.toContain("roda todo dia");
    expect(textoDoEnvio(envio({ escritaPronta: false }), "SCL")).toContain("ligar a escrita no Beds24");
    expect(textoSalvo(envio({ vinculado: false }), "SCL")).toContain("continuam com o preço e as estadias anteriores até a SCL vincular este imóvel ao Beds24");
    expect(textoSalvo(envio({ escritaPronta: false }), "SCL")).not.toContain("próximo envio");
  });

  it("depois de salvar, só promete Airbnb e Booking quando o imóvel está na lista de envio", () => {
    // E só para o que o envio de calendário carrega (preço e estadias); o resto é só do site.
    const pronto: SituacaoEnvio = { naLista: true, vinculado: true, escritaPronta: true, automatico: true, ultimo: { em: new Date("2026-10-01T10:00:00Z"), situacao: "ok", falha: "" } };
    const fora: SituacaoEnvio = { ...pronto, naLista: false };
    expect(textoSalvo(pronto, "SCL")).toContain("Preço da noite e estadias mínima e máxima chegam ao Airbnb e ao Booking no próximo envio");
    expect(textoSalvo(pronto, "SCL")).toContain("taxa de limpeza, hóspede extra, antecedência, janela de reservas, dias e horários de entrada e saída valem só no site");
    expect(textoSalvo(fora, "SCL")).toContain("continuam com o preço e as estadias anteriores até a SCL incluir este imóvel no envio");
    expect(textoSalvo(fora, "SCL")).toContain("valem só no site");
    expect(textoSalvo(fora, "SCL")).not.toContain("próximo envio");
    expect(textoDoEnvio(pronto, "SCL")).toContain("leva preço da noite e estadias mínima e máxima ao Airbnb e ao Booking; taxa de limpeza");
    // Preços no Beds24: o envio não leva preço (só lê de lá), então nem o texto do envio nem o de "salvo" prometem preço às OTAs.
    expect(textoDoEnvio(pronto, "SCL", "beds24")).toContain("leva estadias mínima e máxima ao Airbnb e ao Booking");
    expect(textoDoEnvio(pronto, "SCL", "beds24")).not.toContain("preço da noite e estadias");
    expect(textoDoEnvio(fora, "SCL", "beds24")).toContain("continuam com o calendário e as estadias anteriores");
    expect(textoSalvo(pronto, "SCL", "beds24")).toContain("Estadias mínima e máxima chegam ao Airbnb e ao Booking");
    expect(textoSalvo(pronto, "SCL", "beds24")).toContain("o preço da noite é definido no Beds24");
    expect(textoSalvo(fora, "SCL", "beds24")).toContain("continuam com as estadias anteriores");
  });
});
