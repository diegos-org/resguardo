// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampoDatas, type PropsCampoDatas } from "./CampoDatas";

// Lugares fictícios: o 403 tem as noites de 14 e 15/10/2026 ocupadas.
const ocupacoes: Record<string, string[]> = { "403": ["2026-10-14", "2026-10-15"], "102": [] };
const buscar = vi.fn(async (url: string): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
  const q = new URL(url, "http://teste.invalid").searchParams;
  const lista = (ocupacoes[q.get("imovel") ?? ""] ?? []).filter((d) => d >= q.get("inicio")! && d < q.get("fim")!);
  return { ok: true, json: async () => ({ ocupadas: lista }) };
});

function Formulario({ lugar = "", ...props }: Partial<PropsCampoDatas> & { lugar?: string }) {
  return (
    <form aria-label="Consulta">
      <label>
        Seu lugar
        <select name="imovel" defaultValue={lugar}>
          <option value="">Escolha</option>
          <option value="403">Studio Exemplo</option>
          <option value="102">Outro Exemplo</option>
        </select>
      </label>
      <CampoDatas hoje="2026-10-07" campoImovel="imovel" {...props} />
      <button type="submit">Consultar</button>
    </form>
  );
}

const escondido = (nome: string) => (document.querySelector(`input[name="${nome}"]`) as HTMLInputElement).value;
const campo = (nome: "Entrada" | "Saída") => screen.getByRole("button", { name: new RegExp(`^${nome}:`) });
const quadro = () => within(screen.getByRole("dialog", { name: "Escolher as datas da estadia" }));
const dia = (rotulo: string) => quadro().getByRole("button", { name: new RegExp(`^${rotulo}`) });

beforeEach(() => vi.stubGlobal("fetch", buscar));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  buscar.mockClear();
});

describe("campo de datas do site (M7.6)", () => {
  it("dois campos com \"Escolha a data\" e campos escondidos para o formulário GET; datas e erros vindos do servidor aparecem", () => {
    render(<Formulario />);
    expect(campo("Entrada").textContent).toBe("Escolha a data");
    expect(campo("Saída").getAttribute("aria-label")).toBe("Saída: escolha a data");
    expect([...document.querySelectorAll("form [name]")].map((e) => e.getAttribute("name"))).toEqual(["imovel", "entrada", "saida"]);
    expect([escondido("entrada"), escondido("saida")]).toEqual(["", ""]);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    render(<Formulario entrada="2026-10-12" saida="2026-10-15" erroSaida="Para entrada em 12/10/2026, o mínimo é de 4 noites." />);
    expect(campo("Entrada").textContent).toBe("12/10/2026");
    expect(campo("Entrada").getAttribute("aria-label")).toBe("Entrada: 12 de outubro de 2026");
    expect([escondido("entrada"), escondido("saida")]).toEqual(["2026-10-12", "2026-10-15"]);
    expect(campo("Saída").getAttribute("aria-describedby")).toBe("erro-saida");
    expect(document.getElementById("erro-saida")?.textContent).toBe("Para entrada em 12/10/2026, o mínimo é de 4 noites.");
    cleanup();
    // Valor que não é data (endereço mexido) não vira data no campo.
    render(<Formulario entrada="ontem" saida="2026-10-15" />);
    expect([escondido("entrada"), escondido("saida")]).toEqual(["", ""]);
  });

  it("calendário com dois meses, semana a partir do domingo, dias passados marcados e mês anterior bloqueado no mês de hoje", () => {
    render(<Formulario />);
    fireEvent.click(campo("Entrada"));
    expect(campo("Entrada").getAttribute("aria-expanded")).toBe("true");
    const grades = quadro().getAllByRole("grid");
    expect(grades.map((g) => g.getAttribute("aria-labelledby") && document.getElementById(g.getAttribute("aria-labelledby")!)?.textContent)).toEqual(["outubro de 2026", "novembro de 2026"]);
    expect(within(grades[0]).getAllByRole("columnheader").map((c) => c.textContent).join(" ")).toBe("dom seg ter qua qui sex sáb");
    expect(dia("6 de outubro de 2026").getAttribute("aria-label")).toBe("6 de outubro de 2026, já passou");
    expect(dia("6 de outubro de 2026").getAttribute("aria-disabled")).toBe("true");
    expect(dia("7 de outubro de 2026").getAttribute("aria-current")).toBe("date");
    expect((quadro().getByRole("button", { name: "Mês anterior" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(quadro().getByRole("button", { name: "Próximo mês" }));
    expect(quadro().getAllByRole("grid").map((g) => document.getElementById(g.getAttribute("aria-labelledby")!)?.textContent)).toEqual(["novembro de 2026", "dezembro de 2026"]);
    // Sem lugar escolhido ("Todas as casas", M7.9): nenhuma marca de ocupação, nenhuma leitura, e o aviso de que as noites
    // ocupadas não aparecem (a situação de cada casa vem na busca), em vez de parecer tudo livre.
    expect(quadro().getByText("Com todas as casas, as noites ocupadas não aparecem aqui: a situação de cada casa vem na próxima tela.")).toBeTruthy();
    expect(quadro().queryByText("Noites ocupadas")).toBeNull();
    expect(quadro().getAllByRole("button").filter((b) => /ocupada/.test(b.getAttribute("aria-label") ?? ""))).toEqual([]);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("primeiro clique é a entrada, o segundo a saída: o quadro fecha, o foco volta ao campo e o formulário leva as datas", () => {
    render(<Formulario />);
    fireEvent.click(campo("Entrada"));
    fireEvent.click(dia("12 de outubro de 2026"));
    expect(quadro().getByText("Entrada em 12/10/2026 · escolha a saída")).toBeTruthy();
    expect(dia("12 de outubro de 2026").getAttribute("aria-pressed")).toBe("true");
    fireEvent.mouseEnter(dia("15 de outubro de 2026"));
    expect(quadro().getByText("3 noites")).toBeTruthy();
    fireEvent.click(dia("15 de outubro de 2026"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(campo("Saída"));
    expect([campo("Entrada").textContent, campo("Saída").textContent]).toEqual(["12/10/2026", "15/10/2026"]);
    expect([escondido("entrada"), escondido("saida")]).toEqual(["2026-10-12", "2026-10-15"]);
    // Reaberto pela saída: o próximo clique troca só a saída; "Limpar" apaga as duas.
    fireEvent.click(campo("Saída"));
    expect(quadro().getByText("Entrada em 12/10/2026 · escolha a saída")).toBeTruthy();
    expect(quadro().getAllByRole("gridcell").filter((c) => c.getAttribute("aria-selected") === "true").map((c) => c.textContent)).toEqual(["12", "13", "14", "15"]);
    fireEvent.click(dia("18 de outubro de 2026"));
    expect([escondido("entrada"), escondido("saida")]).toEqual(["2026-10-12", "2026-10-18"]);
    fireEvent.click(campo("Entrada"));
    fireEvent.click(quadro().getByRole("button", { name: "Limpar" }));
    expect([escondido("entrada"), escondido("saida")]).toEqual(["", ""]);
    expect(quadro().getByText("Escolha o dia de entrada")).toBeTruthy();
  });

  it("noites ocupadas do lugar escolhido: marcadas, recusadas como entrada, e uma saída que passaria por elas é recusada; o dia de saída pode ser ocupado", async () => {
    render(<Formulario lugar="403" />);
    fireEvent.click(campo("Entrada"));
    await waitFor(() => expect(dia("14 de outubro de 2026").getAttribute("aria-label")).toBe("14 de outubro de 2026, ocupada"));
    expect(buscar.mock.calls.map(([u]) => u)).toEqual(["/api/site/ocupacao?imovel=403&inicio=2026-10-07&fim=2026-11-01", "/api/site/ocupacao?imovel=403&inicio=2026-11-01&fim=2026-12-01"]);
    expect(quadro().getByText("Noites ocupadas")).toBeTruthy();
    expect(dia("14 de outubro de 2026").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(dia("14 de outubro de 2026"));
    expect(quadro().getByRole("status").textContent).toBe("Essa noite já está ocupada.");
    expect(escondido("entrada")).toBe("");
    fireEvent.click(dia("10 de outubro de 2026"));
    expect(dia("14 de outubro de 2026").getAttribute("aria-label")).toBe("14 de outubro de 2026, ocupada, pode ser o dia de saída");
    expect(dia("16 de outubro de 2026").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(dia("16 de outubro de 2026"));
    expect(quadro().getByRole("status").textContent).toBe("Há noites ocupadas nesse intervalo.");
    expect([escondido("entrada"), escondido("saida")]).toEqual(["2026-10-10", ""]);
    fireEvent.click(dia("14 de outubro de 2026"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect([escondido("entrada"), escondido("saida")]).toEqual(["2026-10-10", "2026-10-14"]);
    // Os meses já lidos não são pedidos de novo.
    fireEvent.click(campo("Entrada"));
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("acompanha o lugar escolhido no formulário; trocar para um lugar com noite ocupada no meio da estadia desfaz a saída", async () => {
    render(<Formulario lugar="102" entrada="2026-10-12" saida="2026-10-16" />);
    fireEvent.change(screen.getByRole("combobox", { name: /Seu lugar/ }), { target: { value: "403" } });
    await waitFor(() => expect(escondido("saida")).toBe(""));
    expect(escondido("entrada")).toBe("2026-10-12");
    expect(buscar).toHaveBeenCalledWith("/api/site/ocupacao?imovel=403&inicio=2026-10-07&fim=2026-11-01");
    // Sem lugar: o aviso volta e nada é marcado.
    fireEvent.change(screen.getByRole("combobox", { name: /Seu lugar/ }), { target: { value: "" } });
    fireEvent.click(campo("Entrada"));
    expect(quadro().getByText("Com todas as casas, as noites ocupadas não aparecem aqui: a situação de cada casa vem na próxima tela.")).toBeTruthy();
    expect(dia("14 de outubro de 2026").getAttribute("aria-label")).toBe("14 de outubro de 2026");
  });

  it("cartão da página de uma casa (M7.9): trocar para outra casa com noite ocupada no meio não desfaz a estadia; a da própria casa, sim", async () => {
    render(<Formulario lugar="102" entrada="2026-10-12" saida="2026-10-16" casaDaPagina="102" />);
    const lugar = screen.getByRole("combobox", { name: /Seu lugar/ });
    fireEvent.change(lugar, { target: { value: "403" } });
    await new Promise((r) => setTimeout(r, 20));
    // O envio abre a página da 403 com as mesmas datas, que diz se ela está indisponível: nada é desfeito aqui.
    expect([escondido("entrada"), escondido("saida")]).toEqual(["2026-10-12", "2026-10-16"]);
    // Abrir o calendário com a 403 escolhida marca as noites dela, e a estadia continua.
    fireEvent.click(campo("Entrada"));
    await waitFor(() => expect(dia("14 de outubro de 2026").getAttribute("aria-label")).toContain("ocupada"));
    await new Promise((r) => setTimeout(r, 20));
    expect([escondido("entrada"), escondido("saida")]).toEqual(["2026-10-12", "2026-10-16"]);
    expect(fireEvent.submit(document.querySelector("form")!)).toBe(true);
    cleanup();
    // Na página da própria 403, a regra continua: a estadia que passa por noite ocupada dela é desfeita.
    render(<Formulario lugar="403" entrada="2026-10-12" saida="2026-10-16" casaDaPagina="403" />);
    fireEvent.click(campo("Entrada"));
    await waitFor(() => expect(escondido("saida")).toBe(""));
    expect(escondido("entrada")).toBe("2026-10-12");
  });

  it("troca rápida de lugar: a resposta atrasada do lugar anterior não desfaz a estadia do lugar escolhido agora", async () => {
    let liberar: () => void = () => {};
    buscar.mockImplementationOnce(
      (url: string) =>
        new Promise((ok) => {
          liberar = () => ok({ ok: true, json: async () => ({ ocupadas: url.includes("imovel=403") ? ocupacoes["403"] : [] }) });
        }),
    );
    render(<Formulario lugar="102" entrada="2026-10-12" saida="2026-10-16" />);
    const lugar = screen.getByRole("combobox", { name: /Seu lugar/ });
    fireEvent.change(lugar, { target: { value: "403" } });
    fireEvent.change(lugar, { target: { value: "102" } });
    await waitFor(() => expect(buscar).toHaveBeenCalledWith("/api/site/ocupacao?imovel=102&inicio=2026-10-07&fim=2026-11-01"));
    liberar();
    await new Promise((r) => setTimeout(r, 0));
    expect([escondido("entrada"), escondido("saida")]).toEqual(["2026-10-12", "2026-10-16"]);
  });

  it("estadia escolhida antes de chegarem as noites ocupadas: se passa por uma delas, a saída é desfeita", async () => {
    let liberar: () => void = () => {};
    buscar.mockImplementationOnce(
      (url: string) =>
        new Promise((ok) => {
          const q = new URL(url, "http://teste.invalid").searchParams;
          liberar = () => ok({ ok: true, json: async () => ({ ocupadas: ocupacoes["403"].filter((d) => d >= q.get("inicio")! && d < q.get("fim")!) }) });
        }),
    );
    render(<Formulario lugar="403" />);
    fireEvent.click(campo("Entrada"));
    // Outubro ainda não chegou: 14 e 15 aparecem livres e a estadia de 12 a 16 é aceita.
    fireEvent.click(dia("12 de outubro de 2026"));
    fireEvent.click(dia("16 de outubro de 2026"));
    expect([escondido("entrada"), escondido("saida")]).toEqual(["2026-10-12", "2026-10-16"]);
    liberar();
    await waitFor(() => expect(escondido("saida")).toBe(""));
    expect(escondido("entrada")).toBe("2026-10-12");
    cleanup();
    // Noites que não cruzam a estadia não mexem nela.
    render(<Formulario lugar="403" entrada="2026-10-20" saida="2026-10-23" />);
    fireEvent.click(campo("Entrada"));
    await waitFor(() => expect(dia("14 de outubro de 2026").getAttribute("aria-label")).toContain("ocupada"));
    expect([escondido("entrada"), escondido("saida")]).toEqual(["2026-10-20", "2026-10-23"]);
  });

  it("lugar fixo e falha na leitura: nada marcado, nada quebra (o servidor confere depois)", async () => {
    buscar.mockRejectedValueOnce(new Error("rede")).mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    render(<CampoDatas hoje="2026-10-07" imovel="403" />);
    fireEvent.click(campo("Entrada"));
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(2));
    expect(dia("14 de outubro de 2026").getAttribute("aria-label")).toBe("14 de outubro de 2026");
    expect(quadro().getByText("Noites ocupadas")).toBeTruthy();
  });

  it("teclado: setas movem o dia, Enter escolhe, Esc fecha e devolve o foco; Tab não sai do quadro", () => {
    render(<Formulario entrada="2026-10-30" />);
    fireEvent.click(campo("Entrada"));
    expect(document.activeElement).toBe(dia("30 de outubro de 2026"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(dia("31 de outubro de 2026"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(dia("7 de novembro de 2026"));
    // PageDown vai ao mesmo dia do mês seguinte, trazendo o mês para a tela.
    fireEvent.keyDown(document.activeElement!, { key: "PageDown" });
    expect(document.activeElement).toBe(dia("7 de dezembro de 2026"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(dia("6 de dezembro de 2026"));
    // Não volta para antes de hoje.
    fireEvent.keyDown(document.activeElement!, { key: "PageUp" });
    fireEvent.keyDown(document.activeElement!, { key: "PageUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(dia("7 de outubro de 2026"));
    // Só o dia em foco entra no Tab da grade.
    expect(quadro().getAllByRole("button").filter((b) => b.dataset.dia && b.tabIndex === 0)).toHaveLength(1);
    const fechar = quadro().getByRole("button", { name: "Fechar" });
    fechar.focus();
    fireEvent.keyDown(fechar, { key: "Tab" });
    // O mês anterior está bloqueado (mês de hoje): o primeiro botão que recebe o foco é o do próximo mês.
    expect((quadro().getByRole("button", { name: "Mês anterior" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(quadro().getByRole("button", { name: "Próximo mês" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(campo("Entrada"));
  });

  it("fecha com clique fora, mas não com clique dentro; enviar sem data abre o calendário em vez de enviar", () => {
    render(<Formulario />);
    fireEvent.click(campo("Entrada"));
    fireEvent.pointerDown(quadro().getByText("Escolha o dia de entrada"));
    expect(screen.queryByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    const form = screen.getByRole("form", { name: "Consulta" });
    expect(fireEvent.submit(form)).toBe(false);
    expect(quadro().getByText("Escolha o dia de entrada")).toBeTruthy();
    fireEvent.click(dia("12 de outubro de 2026"));
    fireEvent.pointerDown(document.body);
    // Só a saída faltando: abre já na saída.
    expect(fireEvent.submit(form)).toBe(false);
    expect(quadro().getByText("Entrada em 12/10/2026 · escolha a saída")).toBeTruthy();
    fireEvent.click(dia("13 de outubro de 2026"));
    expect(fireEvent.submit(form)).toBe(true);
  });

  it("celular: um mês por vez", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("max-width"), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    render(<Formulario />);
    fireEvent.click(campo("Entrada"));
    expect(quadro().getAllByRole("grid")).toHaveLength(1);
  });
});
