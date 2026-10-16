// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MENSAGEM_HORA, PADRAO_DO_CAMPO_HORA } from "@/lib/datas";
import { CampoHora, DICA_DO_CAMPO_HORA } from "./CampoHora";

afterEach(cleanup);

// Pelo nome acessível: o exemplo "Ex.: 15:00" fica fora do nome (é a descrição do campo).
const campo = (rotulo = "Hora") => screen.getByRole("textbox", { name: rotulo }) as HTMLInputElement;

describe("CampoHora (M7.22): a hora como 15:00 em qualquer aparelho", () => {
  it("campo de texto com o padrão 15:00 (24 horas), nunca o nativo de hora, que mostra AM/PM em inglês", () => {
    render(
      <label>
        Hora
        <CampoHora name="checkinAPartirDe" defaultValue="15:00" />
      </label>,
    );
    const c = campo();
    expect([c.type, c.name, c.value, c.pattern, c.maxLength, c.placeholder, c.autocomplete, c.required]).toEqual(["text", "checkinAPartirDe", "15:00", PADRAO_DO_CAMPO_HORA, 5, "15:00", "off", false]);
    // O aviso que o navegador mostra ao recusar é o mesmo dos servidores, num lugar só (M7.22).
    expect([c.title, MENSAGEM_HORA]).toEqual(["Use o formato 15:00 (24 horas).", "Use o formato 15:00 (24 horas)."]);
    // Sem teclado só de números: o do celular não tem os dois-pontos.
    expect(c.getAttribute("inputmode")).toBeNull();
  });

  it("o exemplo fica visível embaixo do campo, como a descrição dele, fora do nome (o rótulo continua só \"Hora\")", () => {
    render(
      <label>
        Hora
        <CampoHora name="hora" defaultValue="15:00" />
      </label>,
    );
    const c = campo();
    const dica = document.getElementById(c.getAttribute("aria-describedby") ?? "");
    expect([DICA_DO_CAMPO_HORA, dica?.textContent]).toEqual(["Ex.: 15:00", "Ex.: 15:00"]);
    expect(screen.getByRole("textbox", { description: "Ex.: 15:00" })).toBe(c);
  });

  it("a hora guardada aparece no formato 15:00: \"15h\" vira \"15:00\" e \"9:00\" vira \"09:00\"; o que não é hora fica como está", () => {
    for (const [guardada, mostrada] of [["15h", "15:00"], ["15h30", "15:30"], ["9:00", "09:00"], ["25:00", "25:00"], ["", ""]]) {
      render(
        <label>
          Hora
          <CampoHora name="hora" defaultValue={guardada} />
        </label>,
      );
      expect(campo().value, guardada).toBe(mostrada);
      cleanup();
    }
  });

  it("o navegador recusa o que não é hora (15h, 25:00, 15:7) e aceita 15:00 e 9:00", () => {
    render(
      <label>
        Hora
        <CampoHora name="hora" required />
      </label>,
    );
    const c = campo();
    expect(c.validity.valueMissing).toBe(true);
    for (const [valor, recusa] of [["15:00", false], ["9:00", false], ["23:59", false], ["15h", true], ["25:00", true], ["15:7", true], ["3 da tarde", true]] as const) {
      fireEvent.change(c, { target: { value: valor } });
      expect(c.validity.patternMismatch, valor).toBe(recusa);
    }
  });

  it("controlado: mostra o valor de quem controla e avisa cada mudança; o que se digita fica como está (\"15h30\" não trava em \"15:00\")", () => {
    const mudou = vi.fn();
    function Controlado() {
      const [hora, setHora] = useState("12:30");
      return (
        <label>
          Hora
          <CampoHora
            name="recebidoHora"
            value={hora}
            onChange={(e) => {
              setHora(e.target.value);
              mudou(e.target.value);
            }}
            required
          />
        </label>
      );
    }
    render(<Controlado />);
    expect(campo().value).toBe("12:30");
    for (const v of ["15h", "15h30", "11:10"]) {
      fireEvent.change(campo(), { target: { value: v } });
      expect(campo().value).toBe(v);
    }
    expect(mudou.mock.calls.map((c) => c[0])).toEqual(["15h", "15h30", "11:10"]);
    expect(campo().required).toBe(true);
  });

  it("não controlado: a pessoa digita e o formulário envia o que está no campo", () => {
    render(
      <form aria-label="f">
        <label>
          Hora
          <CampoHora name="hora" defaultValue="11:00" />
        </label>
      </form>,
    );
    fireEvent.change(campo(), { target: { value: "10:30" } });
    expect(Object.fromEntries(new FormData(screen.getByRole("form", { name: "f" }) as HTMLFormElement))).toEqual({ hora: "10:30" });
  });

  it("repassa id, aria-invalid e aria-describedby (o espalhar de invalido(...) dos formulários)", () => {
    const invalido = { "aria-invalid": true as const };
    render(
      <>
        <label htmlFor="saida">Hora</label>
        <CampoHora id="saida" name="checkoutAte" defaultValue="25:00" aria-describedby="erro-saida" {...invalido} />
        <span id="erro-saida">Use o formato 15:00 (24 horas).</span>
      </>,
    );
    const c = campo();
    // O aviso de erro de quem chama vem primeiro; o exemplo do campo, depois.
    const [erro, dica] = (c.getAttribute("aria-describedby") ?? "").split(" ");
    expect([c.id, c.getAttribute("aria-invalid"), erro, document.getElementById(dica)?.textContent, c.value]).toEqual(["saida", "true", "erro-saida", "Ex.: 15:00", "25:00"]);
    expect(screen.getByRole("textbox", { description: "Use o formato 15:00 (24 horas). Ex.: 15:00" })).toBe(c);
  });

  it("também desenha numa tela de servidor (o único hook é useId)", () => {
    const h = renderToStaticMarkup(<CampoHora name="hora" required />);
    expect(h).toMatch(/^<input [^>]*\/><span id="[^"]+-dica" aria-hidden="true"[^>]*>Ex\.: 15:00<\/span>$/);
    for (const a of ['type="text"', 'placeholder="15:00"', 'name="hora"', 'required=""', 'aria-describedby="']) expect(h, a).toContain(a);
    expect(h).not.toContain("time");
  });
});
