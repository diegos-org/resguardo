// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { autorizacaoDeOrigem } from "@/proprietarios/autorizacao";
import { FormCadastro } from "./FormCadastro";

afterEach(cleanup);

const TEXTO = "Autorizo a equipe a usar estes dados para analisar o cadastro e entrar em contato comigo.";
const marcaEnviada = () => (document.querySelector('input[name="autorizacao"]') as HTMLInputElement).value;

it("a caixa de autorização mostra o texto que a página leu (a versão em vigor) e o envio leva só a marca dele (M7.14, M7.15)", async () => {
  const enviar = vi.fn().mockResolvedValue({ mensagem: "Confira os campos destacados." });
  render(<FormCadastro enviar={enviar} autorizacao={autorizacaoDeOrigem("cadastro", "Sua Casa Exemplo")} />);
  const caixa = screen.getByRole("checkbox") as HTMLInputElement;
  expect(caixa.closest("label")?.textContent?.trim()).toBe(TEXTO);
  expect(marcaEnviada()).toBe(autorizacaoDeOrigem("cadastro", "Sua Casa Exemplo").marca);
  fireEvent.click(caixa);
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(enviar).toHaveBeenCalledTimes(1));
  const f = enviar.mock.calls[0][1] as FormData;
  expect(f.get("consentimento")).toBe("on");
  expect(f.get("autorizacao")).toBe(autorizacaoDeOrigem("cadastro", "Sua Casa Exemplo").marca);
  // Nenhum campo leva o texto: quem grava o texto é o servidor.
  expect([...f.values()].some((v) => typeof v === "string" && v.includes("Autorizo"))).toBe(false);
});

it("texto mudou depois que a página abriu: mostra o texto devolvido pelo servidor, com a caixa desmarcada e a marca nova", async () => {
  const novo = { versao: 2, texto: "Texto fictício da versão 2.", marca: "v2.abc" };
  const enviar = vi.fn().mockResolvedValue({
    mensagem: "Confira os campos destacados.",
    erros: { consentimento: "O texto da autorização mudou depois que a página abriu. Leia o texto ao lado da caixa e marque de novo." },
    valores: { nome: "Maria Exemplo", consentimento: "" },
    autorizacao: novo,
  });
  render(<FormCadastro enviar={enviar} autorizacao={autorizacaoDeOrigem("cadastro", "Sua Casa Exemplo")} />);
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Confira os campos destacados."));
  const caixa = screen.getByRole("checkbox") as HTMLInputElement;
  expect(caixa.checked).toBe(false);
  expect(caixa.closest("label")?.textContent).toContain("Texto fictício da versão 2.");
  expect(caixa.closest("label")?.textContent).toContain("O texto da autorização mudou");
  expect(marcaEnviada()).toBe("v2.abc");
  // Um erro seguinte (sem o texto) não volta ao texto antigo da página.
  enviar.mockResolvedValueOnce({ mensagem: "Confira os campos destacados.", erros: { telefone: "Telefone com DDD." }, valores: { nome: "Maria Exemplo", telefone: "9", consentimento: "on" } });
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(screen.getByText("Telefone com DDD.")).toBeTruthy());
  expect(screen.getByRole("checkbox").closest("label")?.textContent).toContain("Texto fictício da versão 2.");
  expect(marcaEnviada()).toBe("v2.abc");
});

it("versão publicada no painel (M7.15): a caixa mostra o texto dessa versão e o envio leva a marca dela", async () => {
  const v2 = { versao: 2, texto: "Autorizo a Sua Casa Exemplo a analisar o cadastro (texto fictício da versão 2).", marca: "v2.fict" };
  const enviar = vi.fn().mockResolvedValue({ mensagem: "Confira os campos destacados." });
  render(<FormCadastro enviar={enviar} autorizacao={v2} />);
  expect(screen.getByRole("checkbox").closest("label")?.textContent?.trim()).toBe(v2.texto);
  expect(marcaEnviada()).toBe("v2.fict");
  expect(document.body.textContent).not.toContain(TEXTO);
});
