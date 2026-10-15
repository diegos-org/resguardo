// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ERROS_TEXTO_AUTORIZACAO, TEXTOS_ORIGEM_AUTORIZACAO } from "@/proprietarios/autorizacao";
import { FormAutorizacaoProprietario } from "./FormAutorizacaoProprietario";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ORIGEM = { numero: 1, data: "" };
const mostrar = (o: Partial<Parameters<typeof FormAutorizacaoProprietario>[0]> = {}) =>
  render(
    <FormAutorizacaoProprietario
      formulario="contato"
      titulo="Pedido de contato para a gestão completa"
      atual={ORIGEM}
      valor={TEXTOS_ORIGEM_AUTORIZACAO.contato}
      empresa="Casa Exemplo"
      salvar={vi.fn().mockResolvedValue({})}
      {...o}
    />,
  );
const campo = () => screen.getByRole("textbox", { name: /^Texto da caixa/ }) as HTMLTextAreaElement;
const previa = () => screen.getByLabelText("Prévia da caixa").textContent;
const oculto = (nome: string) => (document.querySelector(`input[name="${nome}"]`) as HTMLInputElement).value;

it("na versão 1 (texto que veio com o sistema): o texto com o marcador, a prévia com o nome da empresa e publicar a versão 2", () => {
  mostrar();
  expect(campo().value).toBe(TEXTOS_ORIGEM_AUTORIZACAO.contato);
  expect(previa()).toContain("Autorizo o uso destes dados só para a Casa Exemplo me responder sobre a gestão do imóvel.");
  expect(screen.getByText(/o texto que veio com o sistema/).textContent).toContain("Nada foi publicado aqui ainda.");
  expect(oculto("formulario")).toBe("contato");
  expect(oculto("versaoBase")).toBe("1");
  expect(screen.getByRole("button", { name: "Publicar a versão 2" })).toBeTruthy();
  expect(screen.queryByRole("note", { name: "O que impede publicar" })).toBeNull();
});

it("a prévia acompanha o que se digita; texto vazio ou com quebra de linha mostra o que impede publicar", () => {
  mostrar();
  fireEvent.change(campo(), { target: { value: "Autorizo a {empresa} a me responder." } });
  expect(previa()).toContain("Autorizo a Casa Exemplo a me responder.");
  fireEvent.change(campo(), { target: { value: "   " } });
  expect(screen.getByRole("note", { name: "O que impede publicar" }).textContent).toContain(ERROS_TEXTO_AUTORIZACAO.vazio);
  fireEvent.change(campo(), { target: { value: "Linha um.\nLinha dois." } });
  expect(screen.getByRole("note", { name: "O que impede publicar" }).textContent).toContain(ERROS_TEXTO_AUTORIZACAO.linhas);
  fireEvent.change(campo(), { target: { value: "Autorizo a {nome}." } });
  expect(screen.getByRole("note", { name: "O que impede publicar" }).textContent).toContain(ERROS_TEXTO_AUTORIZACAO.chaves);
});

it("publicar pede confirmação: sem confirmar, nada é enviado; confirmando, envia o texto, a caixa e a versão base", async () => {
  const salvar = vi.fn().mockResolvedValue({ ok: true, aviso: "Versão 2 publicada em 15/10/2026." });
  const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
  mostrar({ salvar });
  fireEvent.change(campo(), { target: { value: "Autorizo a {empresa} a me responder." } });
  fireEvent.click(screen.getByRole("button", { name: "Publicar a versão 2" }));
  expect(confirmar.mock.calls[0][0]).toContain("Publicar a versão 2 do texto da caixa do pedido de contato para a gestão completa?");
  expect(confirmar.mock.calls[0][0]).toContain("Os envios já recebidos continuam com o texto que guardam.");
  expect(salvar).not.toHaveBeenCalled();
  confirmar.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Publicar a versão 2" }));
  await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
  const f = salvar.mock.calls[0][1] as FormData;
  expect(Object.fromEntries(f)).toEqual({ formulario: "contato", versaoBase: "1", texto: "Autorizo a {empresa} a me responder." });
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Versão 2 publicada em 15/10/2026."));
});

it("recusa do servidor: a mensagem e o erro no campo, o texto digitado fica e a versão base é a que o formulário mostrava", async () => {
  const salvar = vi.fn().mockResolvedValue({ mensagem: "Enquanto você editava, a versão 2 foi publicada por outra pessoa.", valores: { formulario: "contato", versaoBase: "1", texto: "Meu texto." } });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mostrar({ salvar });
  fireEvent.change(campo(), { target: { value: "Meu texto." } });
  fireEvent.click(screen.getByRole("button", { name: "Publicar a versão 2" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("a versão 2 foi publicada por outra pessoa"));
  expect(campo().value).toBe("Meu texto.");
  expect(oculto("versaoBase")).toBe("1");
});

it("versão nova em vigor (a página recarrega): o campo passa a mostrar o texto dela e oferece a seguinte", () => {
  const { rerender } = mostrar();
  fireEvent.change(campo(), { target: { value: "Rascunho que não foi publicado." } });
  const V2 = "Autorizo a {empresa} a me responder (texto fictício da versão 2).";
  rerender(<FormAutorizacaoProprietario formulario="contato" titulo="Pedido de contato para a gestão completa" atual={{ numero: 2, data: "2026-10-15" }} valor={V2} empresa="Casa Exemplo" salvar={vi.fn()} />);
  expect(campo().value).toBe(V2);
  expect(screen.getByText(/Versão 2, publicada em 15\/10\/2026\./)).toBeTruthy();
  expect(oculto("versaoBase")).toBe("2");
  expect(screen.getByRole("button", { name: "Publicar a versão 3" })).toBeTruthy();
});
