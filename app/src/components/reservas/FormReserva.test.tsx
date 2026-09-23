// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormReserva } from "./FormReserva";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
afterEach(cleanup);

describe("FormReserva", () => {
  it("sem permissão financeira não mostra os campos de valores", () => {
    render(<FormReserva acao={async () => ({})} imoveis={[]} comValores={false} />);
    expect(screen.queryByLabelText("Valor bruto (R$)")).toBeNull();
    expect(document.querySelector('input[name="valorBruto"]')).toBeNull();
  });

  it("com permissão mostra os campos de valores", () => {
    render(<FormReserva acao={async () => ({})} imoveis={[]} />);
    expect(screen.getByLabelText("Valor bruto (R$)")).toBeTruthy();
  });
});
