// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERIODO_SO_DISPONIBILIDADE_PORTAL } from "@/imoveis/fonte-precos";
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
  envio: { naLista: true, vinculado: true, escritaPronta: true, automatico: true, ultimo: { em: new Date("2026-10-01T10:00:00Z"), situacao: "ok", falhou: false, mesmoVinculo: true, mesmaCredencial: true } },
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
    // Horários no formato 15:00 em qualquer aparelho (M7.22): campo de texto, nunca o nativo, que mostra AM/PM em inglês.
    for (const [rotulo, valor] of [["Entrada a partir das", "15:00"], ["Saída até as", "11:00"]]) {
      const campo = within(form).getByRole("textbox", { name: rotulo }) as HTMLInputElement;
      expect([campo.type, campo.value, campo.placeholder, campo.required], rotulo).toEqual(["text", valor, "15:00", false]);
    }
    // Dois grupos de dias (entrada e saída): só a segunda da entrada está marcada.
    const segundas = within(form).getAllByLabelText("segunda") as HTMLInputElement[];
    expect(segundas.map((c) => c.checked)).toEqual([true, false]);
    // Os dias aparecem de segunda a domingo (M7.22), cada um com o número guardado (0 = domingo).
    const entrada = within(form).getByRole("group", { name: /Entrada só nestes dias/ });
    expect(within(entrada).getAllByRole("checkbox").map((c) => [c.parentElement?.textContent?.trim(), (c as HTMLInputElement).value])).toEqual([
      ["segunda", "1"], ["terça", "2"], ["quarta", "3"], ["quinta", "4"], ["sexta", "5"], ["sábado", "6"], ["domingo", "0"],
    ]);
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

  it("sem imóvel marketplace, não aparece; com preços da ferramenta do proprietário, o preço da noite fica só de leitura e o Beds24 não aparece", () => {
    const { container } = render_({ imoveis: [] });
    expect(container.textContent).toBe("");
    cleanup();
    render_({ imoveis: [{ ...imovel, fontePrecos: "ferramenta" }] });
    const form = screen.getByRole("form", { name: "Preços e regras de venda do 403" });
    // Sem simulação com o preço base antigo (o site lê o preço de cada noite do Beds24), e o aviso do envio não promete preço.
    expect(form.textContent).not.toContain("no Airbnb você receberia");
    expect(form.textContent).toContain("não dá para simular aqui");
    expect(screen.getByRole("note").textContent).not.toContain("preço da noite e estadias");
    expect(screen.getByRole("note").textContent).toContain("preço da noite é definido por você ou pela sua ferramenta de preços");
    // Período especial sem campo de preço: só estadia mínima (o servidor recusaria qualquer preço).
    const periodos = screen.getByRole("region", { name: "Períodos especiais" });
    expect(within(periodos).queryByLabelText(/Preço da noite/)).toBeNull();
    expect((within(periodos).getByLabelText(/Estadia mínima/) as HTMLInputElement).required).toBe(true);
    expect(periodos.textContent).toContain("O preço da noite é definido por você ou pela sua ferramenta de preços");
    const campo = within(form).getByLabelText(/Preço da noite/) as HTMLInputElement;
    expect(campo.readOnly).toBe(true);
    expect(screen.getByText(/Preços definidos por você ou pela sua ferramenta de preços/)).toBeTruthy();
    // Nem todo proprietário usa ferramenta: toda menção à ferramenta vem junto de "você" (preço digitado por ele mesmo).
    const tudo = document.body.textContent ?? "";
    const mencoes = tudo.match(/sua ferramenta de preços/g) ?? [];
    expect(mencoes.length).toBeGreaterThan(3);
    expect((tudo.match(/você ou (pela|a) sua ferramenta de preços/g) ?? []).length).toBe(mencoes.length);
    // M5.9: o Beds24 fica nos bastidores — nada na seção do proprietário o cita.
    expect(document.body.textContent).not.toMatch(/beds24/i);
  });

  it("com só disponibilidade (M3.11b): preço só de leitura e sem simulação, nenhum período novo (com a frase), e os textos prometem aos canais só as datas fechadas e reabertas; nada cita o Beds24", () => {
    render_({ imoveis: [{ ...imovel, fontePrecos: "so_disponibilidade" }] });
    const form = screen.getByRole("form", { name: "Preços e regras de venda do 403" });
    expect(form.textContent).toContain("Só a disponibilidade pelo nosso sistema. Nosso sistema só fecha e reabre datas nos canais.");
    expect(form.textContent).not.toContain("no Airbnb você receberia");
    expect(form.textContent).toContain("não dá para simular aqui");
    expect((within(form).getByLabelText(/Preço da noite/) as HTMLInputElement).readOnly).toBe(true);
    // Estadia mínima e máxima também ficam com o proprietário ou com a ferramenta dele (desenho §6, registro de 26/10): só de leitura, com a nota.
    for (const rotulo of [/Estadia mínima/, /Estadia máxima/]) expect((within(form).getByLabelText(rotulo) as HTMLInputElement).readOnly).toBe(true);
    expect(form.textContent).toContain("Estadia mínima (noites) — definida por você ou pela sua ferramenta de preços");
    expect(form.textContent).toContain("Estadia máxima (noites) — definida por você ou pela sua ferramenta de preços");
    const nota = screen.getByRole("note").textContent ?? "";
    expect(nota).toContain("leva ao Airbnb e ao Booking só as datas fechadas e reabertas");
    expect(nota).not.toContain("estadias mínima e máxima ao Airbnb");
    const periodos = screen.getByRole("region", { name: "Períodos especiais" });
    expect(periodos.textContent).toContain(PERIODO_SO_DISPONIBILIDADE_PORTAL);
    expect(within(periodos).queryByRole("form", { name: "Novo período especial" })).toBeNull();
    // O período já gravado continua listado (e pode ser excluído).
    expect(within(periodos).getByText("Réveillon")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/beds24/i);
  });

  it("explica o envio aos canais sem supor e sem citar o Beds24: fora da lista, manual e automático", () => {
    const feito = { em: new Date("2026-10-01T10:00:00Z"), situacao: "ok", falhou: false, mesmoVinculo: true, mesmaCredencial: true };
    const envio = (over: Partial<SituacaoEnvio> = {}): SituacaoEnvio => ({ naLista: true, vinculado: true, escritaPronta: true, automatico: true, ultimo: feito, ...over });
    expect(textoDoEnvio(envio({ naLista: false }), "SCL")).toContain("até a SCL incluir este imóvel no envio de calendário");
    expect(textoDoEnvio(envio({ automatico: false }), "SCL")).toContain("O envio aos canais é feito pela SCL");
    expect(textoDoEnvio(envio(), "SCL")).toMatch(/roda todo dia.*Último envio: 01\/10\/2026 às 07:00 \(concluído\)/);
    // Sem nenhum envio real que tenha incluído o imóvel, ou com o imóvel deixado de fora no último (quarto inacessível, moeda), nada é prometido.
    expect(textoDoEnvio(envio({ ultimo: null }), "SCL")).toContain("até o primeiro envio aos canais confirmar este imóvel");
    expect(textoDoEnvio(envio({ ultimo: null }), "SCL")).not.toContain("roda todo dia");
    // O motivo técnico da falha (com nomes internos) fica no painel e nem chega ao portal; o proprietário vê que falhou e quando.
    const comFalha = textoDoEnvio(envio({ ultimo: { ...feito, falhou: true } }), "SCL");
    expect(comFalha).toContain("a última (01/10/2026 às 07:00) não conseguiu, e a SCL vê o motivo no painel");
    expect(comFalha).not.toContain("credencial");
    expect(textoSalvo(envio({ ultimo: { ...feito, falhou: true } }), "SCL")).not.toContain("próximo envio");
    // Vínculo trocado depois do último envio: o veredito antigo não vale para o quarto novo.
    expect(textoDoEnvio(envio({ ultimo: { ...feito, mesmoVinculo: false } }), "SCL")).toContain("a ligação dele com os canais mudou depois do último envio");
    // Credencial Beds24 trocada depois do último envio: o veredito foi de outra credencial; nada é prometido até um envio com a atual.
    expect(textoDoEnvio(envio({ ultimo: { ...feito, mesmaCredencial: false } }), "SCL")).toContain("o acesso da SCL aos canais mudou depois do último envio");
    expect(textoSalvo(envio({ ultimo: { ...feito, mesmaCredencial: false } }), "SCL")).not.toContain("próximo envio de calendário");
    // Na lista, mas sem vínculo com o Beds24 ou com a escrita desligada: nada chega às OTAs, e o texto diz o que falta.
    expect(textoDoEnvio(envio({ vinculado: false }), "SCL")).toContain("ligar este imóvel aos canais no nosso sistema");
    expect(textoDoEnvio(envio({ vinculado: false }), "SCL")).not.toContain("roda todo dia");
    expect(textoDoEnvio(envio({ escritaPronta: false }), "SCL")).toContain("ligar o envio aos canais");
    expect(textoSalvo(envio({ vinculado: false }), "SCL")).toContain("continuam com o preço e as estadias anteriores até a SCL ligar este imóvel aos canais no nosso sistema");
    expect(textoSalvo(envio({ escritaPronta: false }), "SCL")).not.toContain("próximo envio");
    // M5.9: em nenhum estado, e em nenhuma fonte de preços, o texto para o proprietário cita o Beds24.
    const estados = [envio(), envio({ naLista: false }), envio({ vinculado: false }), envio({ escritaPronta: false }), envio({ automatico: false }), envio({ ultimo: null }), envio({ ultimo: { ...feito, falhou: true } }), envio({ ultimo: { ...feito, mesmoVinculo: false } }), envio({ ultimo: { ...feito, mesmaCredencial: false } })];
    for (const e of estados) for (const f of ["scl", "ferramenta", "manual", "so_disponibilidade"] as const) {
      expect(textoDoEnvio(e, "SCL", f)).not.toMatch(/beds24/i);
      expect(textoSalvo(e, "SCL", f)).not.toMatch(/beds24/i);
    }
  });

  it("depois de salvar, só promete Airbnb e Booking quando o imóvel está na lista de envio", () => {
    // E só para o que o envio de calendário carrega (preço e estadias); o resto é só do site.
    const pronto: SituacaoEnvio = { naLista: true, vinculado: true, escritaPronta: true, automatico: true, ultimo: { em: new Date("2026-10-01T10:00:00Z"), situacao: "ok", falhou: false, mesmoVinculo: true, mesmaCredencial: true } };
    const fora: SituacaoEnvio = { ...pronto, naLista: false };
    expect(textoSalvo(pronto, "SCL")).toContain("Preço da noite e estadias mínima e máxima chegam ao Airbnb e ao Booking no próximo envio");
    expect(textoSalvo(pronto, "SCL")).toContain("taxa de limpeza, hóspede extra, antecedência, janela de reservas, dias e horários de entrada e saída valem só no site");
    expect(textoSalvo(fora, "SCL")).toContain("continuam com o preço e as estadias anteriores até a SCL incluir este imóvel no envio");
    expect(textoSalvo(fora, "SCL")).toContain("valem só no site");
    expect(textoSalvo(fora, "SCL")).not.toContain("próximo envio");
    expect(textoDoEnvio(pronto, "SCL")).toContain("leva preço da noite e estadias mínima e máxima ao Airbnb e ao Booking; taxa de limpeza");
    // Preços da ferramenta do proprietário: o envio não leva preço (só lê de lá), então nem o texto do envio nem o de "salvo" prometem preço às OTAs.
    expect(textoDoEnvio(pronto, "SCL", "ferramenta")).toContain("leva estadias mínima e máxima ao Airbnb e ao Booking");
    expect(textoDoEnvio(pronto, "SCL", "ferramenta")).not.toContain("preço da noite e estadias");
    expect(textoDoEnvio(fora, "SCL", "ferramenta")).toContain("continuam com o calendário e as estadias anteriores");
    expect(textoSalvo(pronto, "SCL", "ferramenta")).toContain("Estadias mínima e máxima chegam ao Airbnb e ao Booking");
    expect(textoSalvo(pronto, "SCL", "ferramenta")).toContain("o preço da noite é definido por você ou pela sua ferramenta de preços");
    expect(textoSalvo(fora, "SCL", "ferramenta")).toContain("continuam com as estadias anteriores");
    // Só disponibilidade (M3.11b): nada deste formulário vai aos canais (só as datas fechadas e reabertas vão), então nenhuma promessa, pronto ou não.
    expect(textoSalvo(pronto, "SCL", "so_disponibilidade")).not.toContain("chegam ao Airbnb");
    expect(textoSalvo(pronto, "SCL", "so_disponibilidade")).toContain("nosso sistema leva aos canais só as datas que você fecha e reabre aqui");
    expect(textoSalvo(fora, "SCL", "so_disponibilidade")).toBe(textoSalvo(pronto, "SCL", "so_disponibilidade"));
    expect(textoDoEnvio(pronto, "SCL", "so_disponibilidade")).toContain("leva ao Airbnb e ao Booking só as datas fechadas e reabertas");
    expect(textoDoEnvio(fora, "SCL", "so_disponibilidade")).toContain("chegam ao Airbnb e ao Booking só depois de a SCL incluir este imóvel no envio de calendário");
    expect(textoDoEnvio(fora, "SCL", "so_disponibilidade")).not.toContain("roda todo dia");
  });
});
