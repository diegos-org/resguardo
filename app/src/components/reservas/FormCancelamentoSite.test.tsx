// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoCancelamentoPainel } from "@/pagamentos/acoes-cancelamento";
import type { PreviaParaTela } from "@/pagamentos/cancelamento-tela";
import { FormCancelamentoSite, FormDescartarPedido, FormRegistrarPedido } from "./FormCancelamentoSite";

const RESERVA = "22222222-2222-4222-8222-222222222222";
const PERGUNTA =
  "Cancelar a reserva SCL-TESTE1 e devolver ao hóspede R$ 1.824,00 (o valor integral pago) pelo Mercado Pago? Base: a SCL cancela. A parte do proprietário (R$ 1.535,04) e a comissão (R$ 270,90) saem do financeiro; a taxa do Mercado Pago que não voltar fica com a SCL. O proprietário deixa de receber R$ 1.535,04 que receberia pela política.";
const previa = (over: Partial<PreviaParaTela> = {}): PreviaParaTela => ({
  assinatura: "0123456789abcdef",
  pergunta: PERGUNTA,
  rota: "pedida",
  direito: "integral",
  calculado: "integral",
  escolha: null,
  momento: "A SCL cancela agora (01/10 às 12:00).",
  leitura: "Leitura do Mercado Pago de 01/10 às 11:58: aprovado.",
  politica: "Política aceita: versão 1 de 20/09 — reembolso integral para pedidos até 26/10 (23:59).",
  resultado: "Pela política: devolução integral de R$ 1.824,00 — a SCL cancela.",
  componentes: ["Parte do proprietário: R$ 1.535,04 (sai do financeiro).", "O proprietário deixa de receber: R$ 1.535,04."],
  comoSai: "Como a devolução sai: pelo Mercado Pago agora.",
  avisos: ["Este imóvel não tem horário de entrada cadastrado: vale o padrão 15:00."],
  ...over,
});
const opcoes = [
  { valor: "whatsapp", texto: "WhatsApp" },
  { valor: "email", texto: "E-mail" },
];
const calcular = vi.fn<(e: EstadoCancelamentoPainel, f: FormData) => Promise<EstadoCancelamentoPainel>>();
const cancelar = vi.fn<(e: EstadoCancelamentoPainel, f: FormData) => Promise<EstadoCancelamentoPainel>>();
const mostrar = (o: { pedido?: Parameters<typeof FormCancelamentoSite>[0]["pedido"]; semPolitica?: boolean } = {}) =>
  render(
    <FormCancelamentoSite
      reservaId={RESERVA}
      calcular={calcular}
      cancelar={cancelar}
      pedido={o.pedido ?? null}
      agora={{ data: "2026-10-01", hora: "12:00" }}
      naoComparecimentoApos="10/11 às 12:00"
      semPolitica={o.semPolitica ?? false}
      canais={opcoes}
      motivosEmpresa={[{ valor: "forca_maior", texto: "Força maior" }]}
      motivosExcecao={[{ valor: "cortesia_comercial", texto: "Cortesia comercial" }]}
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

describe("formulário do cancelamento pela política (M8.2c)", () => {
  it("calcular mostra a prévia em linhas; 'Cancelar a reserva' pergunta com o valor, a base, a rota e a perda do proprietário e manda a assinatura", async () => {
    calcular.mockResolvedValue({ ok: true, previa: previa() });
    cancelar.mockResolvedValue({ mensagem: "Muitas mudanças nesta reserva agora: tente de novo em instantes.", codigo: "ocupado" });
    mostrar();
    expect(screen.queryByRole("button", { name: "Cancelar a reserva" })).toBeNull();
    fireEvent.click(screen.getByLabelText(/A SCL cancela/));
    fireEvent.change(screen.getByLabelText("Motivo da SCL"), { target: { value: "forca_maior" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular o cancelamento pela política" }));
    await screen.findByRole("region", { name: "Prévia do cancelamento" });
    const enviado = calcular.mock.calls[0][1];
    expect(Object.fromEntries(enviado)).toMatchObject({ reservaId: RESERVA, quemCancela: "empresa", motivoEmpresa: "forca_maior" });
    expect(enviado.has("assinatura")).toBe(false);
    expect(screen.getByText("Pela política: devolução integral de R$ 1.824,00 — a SCL cancela.")).toBeTruthy();
    expect(screen.getByText("O proprietário deixa de receber: R$ 1.535,04.")).toBeTruthy();
    expect(screen.getByText("Como a devolução sai: pelo Mercado Pago agora.")).toBeTruthy();
    expect(screen.getByText("Leitura do Mercado Pago de 01/10 às 11:58: aprovado.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar a reserva" }));
    expect(confirmar).toHaveBeenCalledWith(PERGUNTA);
    await waitFor(() => expect(cancelar).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(cancelar.mock.calls[0][1])).toMatchObject({ assinatura: "0123456789abcdef", rota: "pedida", quemCancela: "empresa" });
    expect(cancelar.mock.calls[0][0]).toEqual({});
    expect(await screen.findByText("Muitas mudanças nesta reserva agora: tente de novo em instantes.")).toBeTruthy();
  });

  it("recusou a pergunta: nada é enviado; mexeu num campo depois da prévia: o botão de cancelar some até calcular de novo", async () => {
    calcular.mockResolvedValue({ ok: true, previa: previa() });
    mostrar();
    fireEvent.change(screen.getByLabelText("Como chegou"), { target: { value: "whatsapp" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular o cancelamento pela política" }));
    await screen.findByRole("button", { name: "Cancelar a reserva" });
    confirmar.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar a reserva" }));
    expect(cancelar).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Onde está o pedido/), { target: { value: "WhatsApp da empresa" } });
    expect(screen.queryByRole("button", { name: "Cancelar a reserva" })).toBeNull();
    expect(screen.getByText("Algo mudou no formulário: calcule de novo antes de cancelar.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Calcular de novo" }));
    await screen.findByRole("button", { name: "Cancelar a reserva" });
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it("a política não dá devolução: a exceção aparece, com o motivo da lista e a nota obrigatória", async () => {
    calcular.mockResolvedValue({ ok: true, previa: previa({ direito: "nenhum", calculado: "nenhum", escolha: "excecao", rota: "nenhuma", resultado: "Pela política: sem devolução — pedido depois do prazo de reembolso integral." }) });
    mostrar();
    expect(screen.queryByLabelText(/Devolver tudo por exceção/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Como chegou"), { target: { value: "email" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular o cancelamento pela política" }));
    await screen.findByLabelText(/Devolver tudo por exceção/);
    expect(screen.queryByLabelText("Motivo da exceção")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Devolver tudo por exceção/));
    expect(screen.getByLabelText("Motivo da exceção")).toBeTruthy();
    expect((screen.getByLabelText(/Nota \(obrigatória/) as HTMLTextAreaElement).required).toBe(true);
    // Mexeu (marcou a exceção): calcule de novo para ver o integral e a perda do proprietário.
    expect(screen.queryByRole("button", { name: "Cancelar a reserva" })).toBeNull();
  });

  it("sem política aceita (pelo pagamento ou pela recusa do servidor): devolver tudo ou não devolver, com o motivo", async () => {
    mostrar({ semPolitica: true });
    expect(screen.getByLabelText("Devolver tudo")).toBeTruthy();
    expect(screen.getByLabelText("Não devolver")).toBeTruthy();
    cleanup();
    calcular.mockResolvedValue({ codigo: "decisao_obrigatoria", escolha: "sem_politica", mensagem: "Este pagamento foi feito sem o aceite das páginas legais (antes de 9/10): o sistema não calcula a devolução." });
    mostrar();
    expect(screen.queryByLabelText("Devolver tudo")).toBeNull();
    fireEvent.change(screen.getByLabelText("Como chegou"), { target: { value: "email" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular o cancelamento pela política" }));
    await screen.findByLabelText("Devolver tudo");
    expect(screen.getByRole("alert").textContent).toContain("o sistema não calcula a devolução");
    expect(screen.getByLabelText(/Motivo \(obrigatório/)).toBeTruthy();
  });

  it("sem política aceita, mas a SCL cancela: nada de 'Devolver tudo / Não devolver' (a devolução é sempre integral)", () => {
    mostrar({ semPolitica: true });
    fireEvent.click(screen.getByLabelText(/A SCL cancela/));
    expect(screen.queryByLabelText("Devolver tudo")).toBeNull();
    expect(screen.queryByLabelText("Não devolver")).toBeNull();
    // Volta para o pedido do hóspede: a escolha sem política reaparece.
    fireEvent.click(screen.getByLabelText("O hóspede pediu"));
    expect(screen.getByLabelText("Não devolver")).toBeTruthy();
  });

  it("saída antecipada recusada sem prévia: a exceção aparece mesmo assim e vai no cálculo seguinte, com o motivo da lista e a nota", async () => {
    calcular.mockResolvedValueOnce({
      codigo: "estadia_iniciada",
      escolha: "excecao",
      mensagem: "O pedido chegou depois do início da estadia (12/10 às 15:00): pela política não há devolução e a reserva continua como está (saída antecipada não é cancelamento). Descarte o pedido com o motivo, se for o caso.",
    });
    calcular.mockResolvedValueOnce({ ok: true, previa: previa({ calculado: "nenhum", escolha: "excecao", resultado: "Pela política: sem devolução — pedido depois do início da estadia. Por exceção: devolução integral de R$ 1.824,00." }) });
    mostrar({ pedido: { site: false, data: "2026-10-01", hora: "09:00", canal: "whatsapp", descricao: "Registrado por Equipe Fictícia" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular o cancelamento pela política" }));
    await screen.findByLabelText(/Devolver tudo por exceção/);
    expect(screen.getByRole("alert").textContent).toContain("saída antecipada não é cancelamento");
    // Não é o caso sem política: nada de "Devolver tudo / Não devolver".
    expect(screen.queryByLabelText("Devolver tudo")).toBeNull();
    expect(screen.queryByLabelText("Não devolver")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Devolver tudo por exceção/));
    fireEvent.change(screen.getByLabelText("Motivo da exceção"), { target: { value: "cortesia_comercial" } });
    fireEvent.change(screen.getByLabelText(/Nota \(obrigatória/), { target: { value: "Cortesia pela obra no prédio" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular o cancelamento pela política" }));
    await screen.findByRole("button", { name: "Cancelar a reserva" });
    expect(Object.fromEntries(calcular.mock.calls[1][1])).toMatchObject({ decisao: "excecao", motivoExcecao: "cortesia_comercial", motivoDecisao: "Cortesia pela obra no prédio" });
    expect(screen.getByText("Pela política: sem devolução — pedido depois do início da estadia. Por exceção: devolução integral de R$ 1.824,00.")).toBeTruthy();
  });

  it("pagamento já devolvido no painel do Mercado Pago e a política sem devolução: a recusa abre a exceção, não a escolha sem política", async () => {
    calcular.mockResolvedValue({
      codigo: "decisao_obrigatoria",
      escolha: "excecao",
      mensagem: "O Mercado Pago já mostra este pagamento devolvido por inteiro: registre como devolução integral (pela política ou por exceção, com o motivo).",
    });
    mostrar();
    fireEvent.change(screen.getByLabelText("Como chegou"), { target: { value: "email" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular o cancelamento pela política" }));
    await screen.findByLabelText(/Devolver tudo por exceção/);
    expect(screen.queryByLabelText("Devolver tudo")).toBeNull();
    expect(screen.queryByText(/Pagamento sem a política aceita/)).toBeNull();
  });

  it("M8.2d (D17): o Mercado Pago mostra parte devolvida pelo painel sem dizer quanto — a recusa pede o valor visto lá de cada pagamento, e eles vão no cálculo seguinte", async () => {
    const P1 = "33333333-3333-4333-8333-333333333333";
    const P2 = "44444444-4444-4444-8444-444444444444";
    const foraSemValor = [
      { pagamentoId: P1, rotulo: "Pix de 01/10 (R$ 1.824,00)" },
      { pagamentoId: P2, rotulo: "Cartão de 02/10 (R$ 400,00)" },
    ];
    calcular.mockResolvedValueOnce({ codigo: "devolvido_fora_sem_valor", mensagem: "O Mercado Pago mostra parte deste pagamento devolvida pelo painel, sem informar quanto.", foraSemValor });
    calcular.mockResolvedValueOnce({
      ok: true,
      previa: previa(),
      valores: { [`valorFora:${P1}`]: "300,00", [`valorForaRotulo:${P1}`]: foraSemValor[0].rotulo, [`valorFora:${P2}`]: "5,00", [`valorForaRotulo:${P2}`]: foraSemValor[1].rotulo },
    });
    mostrar();
    expect(screen.queryByLabelText(/Valor que o painel do Mercado Pago mostra devolvido/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Como chegou"), { target: { value: "email" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular o cancelamento pela política" }));
    fireEvent.change(await screen.findByLabelText(/devolvido fora do sistema, Pix de 01\/10/), { target: { value: "300,00" } });
    fireEvent.change(screen.getByLabelText(/devolvido fora do sistema, Cartão de 02\/10/), { target: { value: "5,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular o cancelamento pela política" }));
    await screen.findByRole("button", { name: "Cancelar a reserva" });
    expect(Object.fromEntries(calcular.mock.calls[1][1])).toMatchObject({ [`valorFora:${P1}`]: "300,00", [`valorFora:${P2}`]: "5,00", [`valorForaRotulo:${P2}`]: foraSemValor[1].rotulo });
    // Com a prévia (os valores vieram no formulário), os dois campos continuam na tela para o cancelamento.
    expect(screen.getAllByLabelText(/Valor que o painel do Mercado Pago mostra devolvido/)).toHaveLength(2);
  });

  it("recusa de antes da decisão (nota com dado pessoal): a exceção que estava na tela continua, com o que foi digitado; a política dando o integral, ela some", async () => {
    calcular.mockResolvedValueOnce({ ok: true, previa: previa({ direito: "nenhum", calculado: "nenhum", escolha: "excecao", rota: "nenhuma" }) });
    calcular.mockResolvedValueOnce({ codigo: "dados", mensagem: "Tire dados pessoais da nota (CPF, e-mail, telefone, chave Pix, cartão)." });
    calcular.mockResolvedValueOnce({ codigo: "integral_nao_se_nega", escolha: null, mensagem: "Pela política aceita, o hóspede tem direito ao valor integral: a equipe não decide outra coisa." });
    mostrar();
    fireEvent.change(screen.getByLabelText("Como chegou"), { target: { value: "email" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular o cancelamento pela política" }));
    fireEvent.click(await screen.findByLabelText(/Devolver tudo por exceção/));
    fireEvent.change(screen.getByLabelText("Motivo da exceção"), { target: { value: "cortesia_comercial" } });
    fireEvent.change(screen.getByLabelText(/Nota \(obrigatória/), { target: { value: "CPF 123.456.789-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular de novo" }));
    await screen.findByText("Tire dados pessoais da nota (CPF, e-mail, telefone, chave Pix, cartão).");
    expect((screen.getByLabelText(/Devolver tudo por exceção/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Nota \(obrigatória/) as HTMLTextAreaElement).value).toBe("CPF 123.456.789-09");
    fireEvent.change(screen.getByLabelText(/Nota \(obrigatória/), { target: { value: "Cortesia" } });
    fireEvent.click(screen.getByRole("button", { name: "Calcular o cancelamento pela política" }));
    await screen.findByText(/a equipe não decide outra coisa/);
    expect(screen.queryByLabelText(/Devolver tudo por exceção/)).toBeNull();
  });

  it("pedido registrado pela equipe: o momento vem preenchido; corrigir a hora pede o motivo. Pedido feito no site: o momento é travado", () => {
    mostrar({ pedido: { site: false, data: "2026-10-01", hora: "12:30", canal: "whatsapp", descricao: "Registrado por Equipe Fictícia" } });
    expect((screen.getByRole("textbox", { name: "Hora (Brasília)" }) as HTMLInputElement).value).toBe("12:30");
    // Campo de texto no formato 15:00 (M7.22), controlado: o que a pessoa digita fica como está.
    expect((screen.getByRole("textbox", { name: "Hora (Brasília)" }) as HTMLInputElement).type).toBe("text");
    expect(screen.queryByLabelText(/Por que corrigir o horário/)).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Hora (Brasília)" }), { target: { value: "11:10" } });
    expect(screen.getByLabelText(/Por que corrigir o horário/)).toBeTruthy();
    expect((screen.getByLabelText(/Não comparecimento/) as HTMLInputElement).disabled).toBe(true);
    cleanup();
    // A mesma hora digitada sem o zero ("9:30" para 09:30) é o mesmo momento, como no servidor: não pede o motivo.
    mostrar({ pedido: { site: false, data: "2026-10-01", hora: "09:30", canal: "whatsapp", descricao: "Registrado por Equipe Fictícia" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Hora (Brasília)" }), { target: { value: "9:30" } });
    expect(screen.queryByLabelText(/Por que corrigir o horário/)).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Hora (Brasília)" }), { target: { value: "9:31" } });
    expect(screen.getByLabelText(/Por que corrigir o horário/)).toBeTruthy();
    cleanup();
    mostrar({ pedido: { site: true, data: "2026-10-01", hora: "12:30", canal: null, descricao: "01/10 às 12:30" } });
    expect(screen.queryByRole("textbox", { name: "Hora (Brasília)" })).toBeNull();
    expect(screen.getByText(/pedido feito pelo hóspede em Minha reserva/)).toBeTruthy();
  });
});

describe("registrar e descartar o pedido", () => {
  it("registrar manda a data, a hora, o canal e a nota; a recusa do servidor aparece e o que foi digitado fica", async () => {
    const acao = vi.fn<(e: EstadoCancelamentoPainel, f: FormData) => Promise<EstadoCancelamentoPainel>>().mockResolvedValue({ mensagem: "Já há um pedido registrado em 01/10 às 12:30." });
    render(<FormRegistrarPedido reservaId={RESERVA} acao={acao} agora={{ data: "2026-10-01", hora: "12:00" }} canais={opcoes} />);
    fireEvent.change(screen.getByLabelText("Como chegou"), { target: { value: "email" } });
    fireEvent.change(screen.getByLabelText(/Onde está o pedido/), { target: { value: "E-mail da empresa" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pedido" }));
    expect(await screen.findByText("Já há um pedido registrado em 01/10 às 12:30.")).toBeTruthy();
    expect(Object.fromEntries(acao.mock.calls[0][1])).toMatchObject({ reservaId: RESERVA, recebidoData: "2026-10-01", recebidoHora: "12:00", canal: "email", nota: "E-mail da empresa" });
    expect([(screen.getByRole("textbox", { name: "Hora (Brasília)" }) as HTMLInputElement).type, (screen.getByRole("textbox", { name: "Hora (Brasília)" }) as HTMLInputElement).placeholder]).toEqual(["text", "15:00"]);
    expect((screen.getByLabelText(/Onde está o pedido/) as HTMLInputElement).value).toBe("E-mail da empresa");
  });

  it("descartar pede confirmação; o do site pede por onde e quando o hóspede desistiu", async () => {
    const acao = vi.fn<(e: EstadoCancelamentoPainel, f: FormData) => Promise<EstadoCancelamentoPainel>>().mockResolvedValue({});
    render(<FormDescartarPedido reservaId={RESERVA} acao={acao} pergunta="Descartar o pedido?" site agora={{ data: "2026-10-01", hora: "12:00" }} canais={opcoes} />);
    expect(screen.getByLabelText("Por onde o hóspede desistiu")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Por onde o hóspede desistiu"), { target: { value: "whatsapp" } });
    fireEvent.change(screen.getByLabelText(/O que o hóspede disse/), { target: { value: "vem mesmo" } });
    confirmar.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Descartar pedido (o hóspede desistiu)" }));
    expect(acao).not.toHaveBeenCalled();
    confirmar.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Descartar pedido (o hóspede desistiu)" }));
    expect(confirmar).toHaveBeenLastCalledWith("Descartar o pedido?");
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1));
    expect(Object.fromEntries(acao.mock.calls[0][1])).toMatchObject({ desistenciaCanal: "whatsapp", desistenciaData: "2026-10-01", desistenciaHora: "12:00", motivo: "vem mesmo" });
    expect((screen.getByRole("textbox", { name: "Hora (Brasília)" }) as HTMLInputElement).type).toBe("text");
  });
});
