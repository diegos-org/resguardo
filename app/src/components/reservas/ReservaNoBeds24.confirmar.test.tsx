// @vitest-environment jsdom
/**
 * M8.3b (seção 10, teste 16): as marcas manuais das OTAs na ficha pedem confirmação antes (`BotaoConfirmar`), com as datas
 * da reserva na pergunta; recusada, nada é enviado.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FichaReservaNoBeds24 } from "@/beds24/reservas-site-painel";
import type { TarefaOta } from "@/beds24/reservas-site-tarefas";
vi.mock("@/beds24/acoes-reservas", () => ({ simularReservaBeds24Acao: vi.fn(), marcarDatasFechadasNasOtasAcao: vi.fn(), marcarDatasReabertasNasOtasAcao: vi.fn() }));
import { ReservaNoBeds24 } from "./ReservaNoBeds24";

const ID = "11111111-1111-4111-8111-111111111111";
const tarefa = (o: Partial<TarefaOta>): TarefaOta => ({ reservaId: ID, codigo: "SCL-7K2QXM", caso: "d3", estado: "manual", checkin: "2026-12-20", checkout: "2026-12-27", desde: new Date(0), alteracaoIds: [], texto: "", marca: null, ...o });
const ficha = (t: TarefaOta): FichaReservaNoBeds24 => ({ desligada: ["ambiente", "chave", "credencial", "imovel", "sem_acompanhamento"], beds24Id: null, acompanhamento: null, operacoes: [], simular: false, pedido: null, tarefas: [t], atencoes: [] });

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
