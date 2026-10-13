// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoAlteracaoPainel } from "@/pagamentos/acoes-alteracao";
import type { PreviaAlteracaoParaTela } from "@/pagamentos/alteracao-tela";
import { FormAlteracaoSite, FormAplicarAlteracao, FormDesistirAlteracao } from "./FormAlteracaoSite";

const RESERVA = "22222222-2222-4222-8222-222222222222";
const ALTERACAO = "33333333-3333-4333-8333-333333333333";
const PERGUNTA_AUMENTO =
  "Segurar as novas datas (10/11 a 15/11, 5 noites, 2 pessoas) até 13:00 e liberar para o hóspede pagar a diferença de R$ 400,00 na página da reserva? A alteração é proposta pela SCL: confirme que o hóspede paga a diferença. Até o pagamento, a reserva continua como está (10/11 a 14/11). Quando ele pagar, a alteração vale sozinha; depois, mude o bloqueio nas OTAs (no Beds24).";
const linha = { rotulo: "Valor bruto", antes: "R$ 1.500,00", depois: "R$ 1.900,00", diferenca: "+R$ 400,00" };
const previa = (over: Partial<PreviaAlteracaoParaTela> = {}): PreviaAlteracaoParaTela => ({
  alteracaoId: null,
  assinatura: "0123456789abcdef",
  pergunta: PERGUNTA_AUMENTO,
  perguntaSoSegurar: null,
  rumo: "aumento",
  direito: null,
  calculado: null,
  escolha: null,
  rota: "aumento",
  botao: "Segurar as novas datas e liberar o pagamento da diferença",
  hoje: "Hoje: 10/11–14/11, 4 noites, 2 pessoas, R$ 1.500,00.",
  depois: "Depois: 10/11–15/11, 5 noites, 2 pessoas, R$ 1.900,00 (cotação do site).",
  diferenca: "Diferença: o hóspede paga R$ 400,00 na página da reserva.",
  politica: "Política aceita: versão 1 (continua valendo para a reserva; prazos contados da entrada de 10/11).",
  comoSai: [],
  financeiro: [linha],
  meses: [{ mes: "11/2026", linhas: [linha] }],
  noitesNovas: "Novas noites seguradas: 14/11–15/11 por 60 minutos.",
  leitura: ["Leitura do Mercado Pago de 01/10 às 11:58: aprovado."],
  avisos: ["A alteração é proposta pela SCL: cobrar R$ 400,00 do hóspede?"],
  proposta: { texto: "Olá! Preparamos a alteração da sua reserva SCL-TESTE1: …", falta: [], textoBase: true },
  ...over,
});
const reducao = () =>
  previa({
    rumo: "reducao",
    direito: "integral",
    calculado: "integral",
    rota: "pedida",
    botao: "Aplicar a alteração",
    pergunta: "Confirme que o hóspede aceitou por escrito: novas datas 05/12 a 09/12, 2 pessoas, novo valor R$ 1.200,00 (antes R$ 1.500,00). Aplicar agora? A alteração não se desfaz por aqui.",
    perguntaSoSegurar: "Segurar as novas datas (05/12 a 09/12, 2 pessoas) até 13:00, sem aplicar?",
    diferenca: "Diferença: devolução de R$ 300,00 pela política (pedido dentro do prazo de reembolso integral).",
    comoSai: ["Pix de 01/10: R$ 300,00 — pelo Mercado Pago agora."],
  });
const opcoes = (...v: string[]) => v.map((x) => ({ valor: x, texto: x }));
const calcular = vi.fn<(e: EstadoAlteracaoPainel, f: FormData) => Promise<EstadoAlteracaoPainel>>();
const segurar = vi.fn<(e: EstadoAlteracaoPainel, f: FormData) => Promise<EstadoAlteracaoPainel>>();
const mostrar = () =>
  render(
    <FormAlteracaoSite
      reservaId={RESERVA}
      calcular={calcular}
      segurar={segurar}
      atual={{ checkin: "2026-11-10", checkout: "2026-11-14", hospedes: 2, valor: "R$ 1.500,00" }}
      capacidade={4}
      agora={{ data: "2026-10-01", hora: "12:00" }}
      canais={opcoes("whatsapp", "email")}
      motivosEmpresa={opcoes("imovel_sem_condicoes", "forca_maior")}
      motivosValor={opcoes("alteracao_pela_scl", "cortesia_comercial", "outro")}
      motivosExcecao={opcoes("cortesia_comercial", "erro_da_scl")}
    />,
  );
const confirmar = vi.fn(() => true);

beforeEach(() => {
  vi.resetAllMocks();
  confirmar.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmar);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("formulário da alteração da reserva paga pelo site (M8.2d)", () => {
  it("a SCL propõe: o valor começa em 'Manter o valor atual' / 'A SCL propôs a alteração'; sem pedido do hóspede, sem data nem canal", () => {
    mostrar();
    expect((screen.getByLabelText(/Pela cotação do site/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Como chegou")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/A SCL propõe/));
    expect((screen.getByLabelText(/Manter o valor atual \(R\$ 1\.500,00\)/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Motivo do valor") as HTMLSelectElement).value).toBe("alteracao_pela_scl");
    expect(screen.queryByLabelText("Como chegou")).toBeNull();
    expect(screen.queryByLabelText("Pedido recebido em (data)")).toBeNull();
    expect(screen.getByLabelText("Motivo da SCL")).toBeTruthy();
    expect(screen.getByText("Este apartamento recebe até 4 pessoas.")).toBeTruthy();
  });

  it("aumento: a prévia em linhas e a proposta para copiar; o botão segura com a pergunta da prévia (a frase da SCL) e manda a assinatura; nunca 'Só segurar'", async () => {
    calcular.mockResolvedValue({ ok: true, previa: previa() });
    segurar.mockResolvedValue({ mensagem: "O cálculo mudou desde a prévia.", codigo: "previa_mudou" });
    mostrar();
    fireEvent.click(screen.getByLabelText(/A SCL propõe/));
    fireEvent.change(screen.getByLabelText("Motivo da SCL"), { target: { value: "imovel_sem_condicoes" } });
    fireEvent.click(screen.getByLabelText(/Pela cotação do site/));
    fireEvent.click(screen.getByRole("button", { name: "Calcular a alteração" }));
    await screen.findByRole("region", { name: "Prévia da alteração" });
    const enviado = Object.fromEntries(calcular.mock.calls[0][1]);
    expect(enviado).toMatchObject({ reservaId: RESERVA, checkin: "2026-11-10", checkout: "2026-11-14", hospedes: "2", quemPede: "empresa", motivoEmpresa: "imovel_sem_condicoes", origemValor: "cotacao" });
    expect(enviado).not.toHaveProperty("assinatura");
    expect(screen.getByText("Diferença: o hóspede paga R$ 400,00 na página da reserva.")).toBeTruthy();
    expect(screen.getByText("Novas noites seguradas: 14/11–15/11 por 60 minutos.")).toBeTruthy();
    expect(screen.getByText("A alteração é proposta pela SCL: cobrar R$ 400,00 do hóspede?")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Financeiro antes e depois da alteração" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copiar a proposta para o hóspede" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Só segurar/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Segurar as novas datas e liberar o pagamento da diferença" }));
    expect(confirmar).toHaveBeenCalledWith(PERGUNTA_AUMENTO);
    await waitFor(() => expect(segurar).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(segurar.mock.calls[0][1])).toMatchObject({ assinatura: "0123456789abcdef", rota: "aumento", aplicar: "", quemPede: "empresa" });
    expect(await screen.findByText("O cálculo mudou desde a prévia.")).toBeTruthy();
  });

  it("redução: 'Aplicar a alteração' aplica (aplicar=sim) e 'Só segurar as datas' só segura, cada um com a sua pergunta", async () => {
    calcular.mockResolvedValue({ ok: true, previa: reducao() });
    segurar.mockResolvedValue({});
    mostrar();
    fireEvent.change(screen.getByLabelText("Como chegou"), { target: { value: "whatsapp" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular a alteração" }));
    await screen.findByRole("region", { name: "Prévia da alteração" });
    expect(screen.getByText("Pix de 01/10: R$ 300,00 — pelo Mercado Pago agora.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar a alteração" }));
    expect(confirmar).toHaveBeenLastCalledWith(expect.stringContaining("Confirme que o hóspede aceitou por escrito"));
    await waitFor(() => expect(segurar).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(segurar.mock.calls[0][1])).toMatchObject({ aplicar: "sim", rota: "pedida" });
    // Feito o envio, a prévia sai da tela: calcular de novo para o outro botão.
    calcular.mockResolvedValue({ ok: true, previa: reducao() });
    fireEvent.click(await screen.findByRole("button", { name: "Calcular a alteração" }));
    await screen.findByRole("button", { name: /Só segurar as datas/ });
    fireEvent.click(screen.getByRole("button", { name: /Só segurar as datas/ }));
    expect(confirmar).toHaveBeenLastCalledWith("Segurar as novas datas (05/12 a 09/12, 2 pessoas) até 13:00, sem aplicar?");
    await waitFor(() => expect(segurar).toHaveBeenCalledTimes(2));
    expect(Object.fromEntries(segurar.mock.calls[1][1])).toMatchObject({ aplicar: "" });
  });

  it("recusou a pergunta: nada é enviado; mexeu num campo depois da prévia: os botões somem até calcular de novo", async () => {
    calcular.mockResolvedValue({ ok: true, previa: previa() });
    mostrar();
    fireEvent.change(screen.getByLabelText("Como chegou"), { target: { value: "whatsapp" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular a alteração" }));
    await screen.findByRole("button", { name: "Segurar as novas datas e liberar o pagamento da diferença" });
    confirmar.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Segurar as novas datas e liberar o pagamento da diferença" }));
    expect(segurar).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Pessoas"), { target: { value: "3" } });
    expect(screen.queryByRole("button", { name: "Segurar as novas datas e liberar o pagamento da diferença" })).toBeNull();
    expect(screen.getByText("Algo mudou no formulário: calcule de novo antes de seguir.")).toBeTruthy();
  });

  it("a redução que a política não devolve oferece a exceção (motivo e nota); sem política aceita, devolver ou não, com o motivo — sempre pelo que o servidor diz", async () => {
    calcular.mockResolvedValue({ mensagem: "Pela política aceita a diferença não é devolvida.", codigo: "dados", escolha: "excecao" });
    mostrar();
    fireEvent.change(screen.getByLabelText("Como chegou"), { target: { value: "whatsapp" } });
    expect(screen.queryByLabelText(/Devolver a diferença por exceção/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Calcular a alteração" }));
    await screen.findByText("Pela política aceita a diferença não é devolvida.");
    fireEvent.click(screen.getByLabelText(/Devolver a diferença por exceção/));
    expect(screen.getByLabelText("Motivo da exceção")).toBeTruthy();
    expect(screen.getByLabelText("Nota (obrigatória, sem dados pessoais)")).toBeTruthy();
    calcular.mockResolvedValue({ mensagem: "Escolha o que fazer e escreva o motivo.", codigo: "decisao_obrigatoria", escolha: "sem_politica" });
    fireEvent.change(screen.getByLabelText("Motivo da exceção"), { target: { value: "erro_da_scl" } });
    fireEvent.change(screen.getByLabelText("Nota (obrigatória, sem dados pessoais)"), { target: { value: "a SCL errou o preço" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular a alteração" }));
    await screen.findByText("Escolha o que fazer e escreva o motivo.");
    expect(screen.getByLabelText("Devolver a diferença")).toBeTruthy();
    expect(screen.getByLabelText("Não devolver")).toBeTruthy();
  });

  it("valor digitado e valor mantido pedem o motivo e a nota", () => {
    mostrar();
    fireEvent.click(screen.getByLabelText("Outro valor"));
    expect(screen.getByLabelText("Valor novo da reserva (R$)")).toBeTruthy();
    expect(screen.getByLabelText("Motivo do valor")).toBeTruthy();
    expect(screen.getByLabelText("Nota do motivo (obrigatória, sem dados pessoais)")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Pela cotação do site/));
    expect(screen.queryByLabelText("Motivo do valor")).toBeNull();
  });
});

describe("aplicar e desistir de uma alteração segurada", () => {
  it("aplicar: primeiro a prévia da aplicação (o retrato gravado), depois o aplicar com a pergunta e a assinatura dela", async () => {
    const previaDaAplicacao = vi.fn<(e: EstadoAlteracaoPainel, f: FormData) => Promise<EstadoAlteracaoPainel>>().mockResolvedValue({ ok: true, previa: reducao() });
    const aplicar = vi.fn<(e: EstadoAlteracaoPainel, f: FormData) => Promise<EstadoAlteracaoPainel>>().mockResolvedValue({ mensagem: "A reserva mudou depois que as datas foram seguradas." });
    render(<FormAplicarAlteracao alteracaoId={ALTERACAO} previaDaAplicacao={previaDaAplicacao} aplicar={aplicar} />);
    expect(screen.queryByRole("button", { name: "Aplicar a alteração" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Conferir para aplicar (o hóspede aceitou)" }));
    await screen.findByRole("region", { name: "Prévia da aplicação" });
    expect(Object.fromEntries(previaDaAplicacao.mock.calls[0][1])).toEqual({ alteracaoId: ALTERACAO });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar a alteração" }));
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining("Confirme que o hóspede aceitou por escrito"));
    await waitFor(() => expect(aplicar).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(aplicar.mock.calls[0][1])).toMatchObject({ alteracaoId: ALTERACAO, assinatura: "0123456789abcdef", rota: "pedida" });
    expect(await screen.findByText("A reserva mudou depois que as datas foram seguradas.")).toBeTruthy();
  });

  it("desistir: o motivo e a pergunta (com o Pix da diferença cancelado, quando há)", async () => {
    const acao = vi.fn<(e: EstadoAlteracaoPainel, f: FormData) => Promise<EstadoAlteracaoPainel>>().mockResolvedValue({ mensagem: "Há um pagamento da diferença em andamento: espere ele terminar." });
    const pergunta = "Desistir da alteração preparada em 01/10 (novas datas 10/11 a 15/11)? As novas datas voltam à venda e a reserva continua como está. O Pix da diferença ainda não pago é cancelado no Mercado Pago.";
    render(<FormDesistirAlteracao alteracaoId={ALTERACAO} acao={acao} pergunta={pergunta} />);
    fireEvent.change(screen.getByLabelText("Motivo da desistência (obrigatório, sem dados pessoais)"), { target: { value: "o hóspede desistiu" } });
    fireEvent.click(screen.getByRole("button", { name: "Desistir da alteração" }));
    expect(confirmar).toHaveBeenCalledWith(pergunta);
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(acao.mock.calls[0][1])).toEqual({ alteracaoId: ALTERACAO, motivo: "o hóspede desistiu" });
    expect(await screen.findByText("Há um pagamento da diferença em andamento: espere ele terminar.")).toBeTruthy();
  });
});
