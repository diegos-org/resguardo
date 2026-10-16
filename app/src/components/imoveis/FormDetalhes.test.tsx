// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EstadoDetalhes } from "@/imoveis/acoes";
import { DETALHES_VAZIOS } from "@/imoveis/detalhes";
import { FormDetalhes } from "./FormDetalhes";

afterEach(cleanup);

const IMOVEL = "11111111-1111-4111-8111-111111111111";
/** Pelo começo do rótulo: depois de um erro, a mensagem fica dentro do rótulo. */
const campo = (rotulo: string) => screen.getByLabelText(new RegExp(`^${rotulo}`)) as HTMLInputElement;

describe("cadastro completo: horários da casa no formato 15:00 (M7.22)", () => {
  it("entrada e saída são campos de texto com a hora guardada, sem obrigar (em branco vale o padrão da casa)", () => {
    render(<FormDetalhes imovelId={IMOVEL} inicial={{ ...DETALHES_VAZIOS, checkinAPartirDe: "14:30", checkoutAte: "10:00" }} salvar={vi.fn()} />);
    for (const [rotulo, valor] of [["Entrada a partir de", "14:30"], ["Saída até", "10:00"]]) {
      const c = campo(rotulo);
      expect([c.type, c.value, c.placeholder, c.required], rotulo).toEqual(["text", valor, "15:00", false]);
    }
  });

  it("depois da recusa do servidor, o campo volta com o que foi digitado, marcado como inválido e com a mensagem", async () => {
    const salvar = vi.fn(async (_e: EstadoDetalhes, f: FormData): Promise<EstadoDetalhes> => ({
      mensagem: "Confira os campos destacados.",
      erros: { checkoutAte: "Use o formato 15:00 (24 horas)." },
      valores: { checkinAPartirDe: String(f.get("checkinAPartirDe")), checkoutAte: String(f.get("checkoutAte")) },
    }));
    render(<FormDetalhes imovelId={IMOVEL} inicial={{ ...DETALHES_VAZIOS, checkinAPartirDe: "15:00", checkoutAte: "11:00" }} salvar={salvar} />);
    fireEvent.change(campo("Saída até"), { target: { value: "25:00" } });
    // O navegador já recusaria "25:00" (pattern); aqui o envio é direto, para conferir a resposta do servidor.
    fireEvent.submit(screen.getByRole("form", { name: "Cadastro completo do imóvel" }));
    expect(await screen.findByText("Use o formato 15:00 (24 horas).")).toBeTruthy();
    expect(Object.fromEntries(salvar.mock.calls[0][1])).toMatchObject({ checkinAPartirDe: "15:00", checkoutAte: "25:00" });
    expect([campo("Saída até").value, campo("Saída até").getAttribute("aria-invalid")]).toEqual(["25:00", "true"]);
    expect(campo("Entrada a partir de").getAttribute("aria-invalid")).toBeNull();
  });
});
