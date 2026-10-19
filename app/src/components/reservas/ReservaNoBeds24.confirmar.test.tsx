// @vitest-environment jsdom
/**
 * M8.3b (seção 10, teste 16): as marcas manuais das OTAs na ficha pedem confirmação antes (`BotaoConfirmar`), com as datas
 * da reserva na pergunta; recusada, nada é enviado. M8.3c (bloco G; plano 1.15 e desenho 8): os botões do envio que mudam o
 * que o sistema faz pedem confirmação com a pergunta de cada um; "Conferir agora" (só lê) e "Tentar de novo" (o mesmo envio
 * de novo) não pedem.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FichaReservaNoBeds24 } from "@/beds24/reservas-site-painel";
import type { TarefaOta } from "@/beds24/reservas-site-tarefas";
vi.mock("@/beds24/acoes-reservas", () => ({
  simularReservaBeds24Acao: vi.fn(), marcarDatasFechadasNasOtasAcao: vi.fn(), marcarDatasReabertasNasOtasAcao: vi.fn(),
  // M8.3c (bloco G): os botões do envio.
  conferirAgoraBeds24Acao: vi.fn(), tentarDeNovoBeds24Acao: vi.fn(), deixarAMaoBeds24Acao: vi.fn(), reenviarAoBeds24Acao: vi.fn(), naoExisteNoBeds24Acao: vi.fn(), vincularIdDoBeds24Acao: vi.fn(), passarAoSistemaBeds24Acao: vi.fn(),
}));
import { ReservaNoBeds24 } from "./ReservaNoBeds24";

const ID = "11111111-1111-4111-8111-111111111111";
const tarefa = (o: Partial<TarefaOta>): TarefaOta => ({ reservaId: ID, codigo: "SCL-7K2QXM", caso: "d3", estado: "manual", checkin: "2026-12-20", checkout: "2026-12-27", desde: new Date(0), alteracaoIds: [], texto: "", marca: null, ...o });
// Muda junto (M8.3c, bloco G): a ficha ganhou `acoes` (os botões do envio que valem agora); aqui, nenhum.
const ficha = (t: TarefaOta): FichaReservaNoBeds24 => ({
  desligada: ["ambiente", "chave", "credencial", "imovel", "sem_acompanhamento"], beds24Id: null, acompanhamento: null, operacoes: [], simular: false, pedido: null, tarefas: [t], atencoes: [],
  acoes: { botoes: [], candidato: null, duplicadas: [], vincularSemMarca: false, automatico: false },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("marcas manuais das OTAs (M8.3b)", () => {
  it.each([
    ["datas_fechadas", "Datas fechadas nas OTAs", "Confirmar que as datas desta reserva (20/12 a 27/12) já foram fechadas nas OTAs (no Beds24, como bloqueio)? Depois disso o sistema nunca cria esta reserva no Beds24."],
    ["datas_reabertas", "Datas reabertas nas OTAs", "Confirmar que as datas desta reserva (20/12 a 27/12) já foram reabertas nas OTAs (no Beds24, o bloqueio mudado para Cancelado, sem apagar)?"],
  ] as const)("%s: pede confirmação com as datas; recusada, nada é enviado", (marca, rotulo, pergunta) => {
    const confirmar = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmar);
    render(<ReservaNoBeds24 reservaId={ID} ficha={ficha(tarefa({ marca, caso: marca === "datas_fechadas" ? "d3" : "d3_cancelada" }))} editar />);
    const botao = screen.getByRole("button", { name: rotulo });
    const enviado = vi.fn((ev: Event) => ev.preventDefault());
    botao.closest("form")!.addEventListener("submit", enviado);
    fireEvent.click(botao);
    expect(confirmar).toHaveBeenCalledWith(pergunta);
    expect(enviado).not.toHaveBeenCalled();
  });
});

describe("os botões do envio (M8.3c, bloco G)", () => {
  const todos: FichaReservaNoBeds24 = {
    ...ficha(tarefa({})),
    desligada: [],
    tarefas: [],
    acoes: { botoes: ["conferir_agora", "tentar_de_novo", "deixar_a_mao", "reenviar", "nao_existe", "vincular", "passar_ao_sistema"], candidato: "900001", duplicadas: [], vincularSemMarca: false, automatico: true },
  };

  it.each([
    ["Reenviar o que está no SCL", "Reenviar ao Beds24 as datas e as pessoas que estão no SCL?"],
    ["Não existe, pode criar", "Confirmar que esta reserva NÃO está no Beds24 (você conferiu lá, pelo quarto e pelas datas)?"],
    ["Passar ao sistema", "Passar esta reserva ao sistema?"],
    ["Deixar à mão", "Deixar esta reserva à mão? Depois disso o sistema nunca mais a escreve no Beds24"],
    ["Vincular o id", "Vincular esta reserva ao registro informado do Beds24?"],
  ])("%s: pede confirmação; recusada, nada é enviado", (rotulo, pergunta) => {
    const confirmar = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmar);
    render(<ReservaNoBeds24 reservaId={ID} ficha={todos} editar configurar />);
    const botao = screen.getByRole("button", { name: rotulo });
    const enviado = vi.fn((ev: Event) => ev.preventDefault());
    botao.closest("form")!.addEventListener("submit", enviado);
    fireEvent.click(botao);
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining(pergunta));
    expect(enviado).not.toHaveBeenCalled();
  });

  it.each([["Conferir agora no Beds24"], ["Tentar de novo o envio ao Beds24"]])("%s: envia sem pedir confirmação", (nome) => {
    const confirmar = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmar);
    render(<ReservaNoBeds24 reservaId={ID} ficha={todos} editar configurar />);
    const botao = screen.getByRole("button", { name: nome });
    const enviado = vi.fn((ev: Event) => ev.preventDefault());
    botao.closest("form")!.addEventListener("submit", enviado);
    fireEvent.click(botao);
    expect(confirmar).not.toHaveBeenCalled();
    expect(enviado).toHaveBeenCalledTimes(1);
  });
});
