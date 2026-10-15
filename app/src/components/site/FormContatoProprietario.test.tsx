// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { autorizacaoDeOrigem } from "@/proprietarios/autorizacao";
import { FormContatoProprietario } from "./FormContatoProprietario";

const m = vi.hoisted(() => ({ acaoPadrao: vi.fn() }));
// A ação real roda no servidor (banco, e-mail): aqui só a referência.
vi.mock("@/site/acoes-contato", () => ({ pedirContatoProprietarioAcao: m.acaoPadrao }));

beforeEach(() => vi.clearAllMocks());
/** O texto da caixa que a página leu no servidor: aqui, a versão 1 com o nome da empresa fictícia. */
const DA_PAGINA = autorizacaoDeOrigem("contato", "Sua Casa Exemplo");
afterEach(cleanup);

const preencher = () => {
  fireEvent.change(screen.getByLabelText("Seu nome"), { target: { value: "Maria Exemplo" } });
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "maria@exemplo.com" } });
  fireEvent.change(screen.getByLabelText("Telefone (WhatsApp)"), { target: { value: "(21) 90000-0000" } });
  fireEvent.change(screen.getByLabelText("Bairro do imóvel"), { target: { value: "Ipanema" } });
  fireEvent.change(screen.getByLabelText("Quartos"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("Já anuncia em alguma plataforma?"), { target: { value: "sim" } });
  fireEvent.change(screen.getByLabelText("Mensagem (opcional)"), { target: { value: "Apartamento fictício." } });
  fireEvent.click(screen.getByLabelText("Autorizo o uso destes dados só para a Sua Casa Exemplo me responder sobre a gestão do imóvel."));
};

it("mostra os campos, as opções e o campo-isca fora do alcance da pessoa", () => {
  render(<FormContatoProprietario empresa="Sua Casa Exemplo" autorizacao={DA_PAGINA} acao={vi.fn()} />);
  expect(screen.getByRole("form", { name: "Pedir contato para a gestão completa" })).toBeTruthy();
  expect((screen.getByLabelText("Cidade") as HTMLInputElement).value).toBe("Rio de Janeiro");
  const quartos = screen.getByLabelText("Quartos") as HTMLSelectElement;
  expect([...quartos.options].map((o) => [o.value, o.textContent])).toEqual([
    ["", "Não sei agora"],
    ["0", "Studio"],
    ["1", "1 quarto"],
    ["2", "2 quartos"],
    ["3", "3 quartos"],
    ["4", "4 ou mais"],
  ]);
  const anuncia = screen.getByLabelText("Já anuncia em alguma plataforma?") as HTMLSelectElement;
  expect([...anuncia.options].map((o) => o.value)).toEqual(["", "sim", "nao"]);
  const isca = document.querySelector('input[name="site"]') as HTMLInputElement;
  expect(isca.tabIndex).toBe(-1);
  expect(isca.getAttribute("autocomplete")).toBe("off");
  expect(isca.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(screen.getByRole("button", { name: "Pedir contato" })).toBeTruthy();
});

it("envia o que foi digitado e, dando certo, troca o formulário pela confirmação", async () => {
  const acao = vi.fn().mockResolvedValue({ ok: true });
  render(<FormContatoProprietario empresa="Sua Casa Exemplo" autorizacao={DA_PAGINA} acao={acao} />);
  preencher();
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe("Recebemos seu pedido. A equipe da Sua Casa Exemplo vai responder pelo e-mail ou WhatsApp que você informou."),
  );
  expect(screen.queryByRole("form")).toBeNull();
  const f = acao.mock.calls[0][1] as FormData;
  expect(Object.fromEntries(f)).toEqual({
    nome: "Maria Exemplo",
    email: "maria@exemplo.com",
    telefone: "(21) 90000-0000",
    bairro: "Ipanema",
    cidade: "Rio de Janeiro",
    quartos: "0",
    anunciaHoje: "sim",
    mensagem: "Apartamento fictício.",
    site: "",
    consentimento: "on",
    // Só a marca do texto que a página mostrou (M7.14): o texto gravado é o do servidor.
    autorizacao: autorizacaoDeOrigem("contato", "Sua Casa Exemplo").marca,
  });
});

it("texto da autorização mudou depois que a página abriu: mostra o texto devolvido pelo servidor, com a caixa desmarcada e a marca nova (M7.14)", async () => {
  const novo = autorizacaoDeOrigem("contato", "Casa Nova Exemplo");
  const acao = vi.fn().mockResolvedValue({
    mensagem: "Confira os campos destacados.",
    erros: { consentimento: "O texto da autorização mudou depois que a página abriu. Leia o texto ao lado da caixa e marque de novo." },
    valores: { nome: "Maria Exemplo", consentimento: "" },
    autorizacao: novo,
  });
  render(<FormContatoProprietario empresa="Sua Casa Exemplo" autorizacao={DA_PAGINA} acao={acao} />);
  expect((document.querySelector('input[name="autorizacao"]') as HTMLInputElement).value).toBe(autorizacaoDeOrigem("contato", "Sua Casa Exemplo").marca);
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Confira os campos destacados."));
  const caixa = screen.getByRole("checkbox") as HTMLInputElement;
  expect(caixa.checked).toBe(false);
  expect(caixa.closest("label")?.textContent).toContain("Autorizo o uso destes dados só para a Casa Nova Exemplo me responder sobre a gestão do imóvel.");
  expect(document.getElementById(caixa.getAttribute("aria-describedby")!)?.textContent).toContain("O texto da autorização mudou");
  expect((document.querySelector('input[name="autorizacao"]') as HTMLInputElement).value).toBe(novo.marca);
  expect(document.body.textContent).not.toContain("para a Sua Casa Exemplo me responder");
  // Um erro seguinte (sem o texto) não volta ao texto antigo da página.
  acao.mockResolvedValueOnce({ mensagem: "Confira os campos destacados.", erros: { telefone: "Telefone com DDD." }, valores: { nome: "Maria Exemplo", telefone: "9", consentimento: "on" } });
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(screen.getByLabelText(/^Telefone \(WhatsApp\)/).getAttribute("aria-invalid")).toBe("true"));
  expect(screen.getByRole("checkbox").closest("label")?.textContent).toContain("para a Casa Nova Exemplo me responder");
  expect((document.querySelector('input[name="autorizacao"]') as HTMLInputElement).value).toBe(novo.marca);
});

it("erro do servidor: marca os campos, liga a mensagem ao campo e devolve o que foi digitado", async () => {
  const acao = vi.fn().mockResolvedValue({
    mensagem: "Confira os campos destacados.",
    erros: { telefone: "Telefone com DDD.", consentimento: "É preciso autorizar o uso dos dados para a gente responder." },
    valores: { nome: "Maria Exemplo", email: "maria@exemplo.com", telefone: "9999", bairro: "Ipanema", cidade: "Niterói", quartos: "2", anunciaHoje: "nao", mensagem: "Oi" },
  });
  render(<FormContatoProprietario empresa="Sua Casa Exemplo" autorizacao={DA_PAGINA} acao={acao} />);
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Confira os campos destacados."));
  expect(screen.queryByRole("status")).toBeNull();
  // A mensagem de erro fica dentro do rótulo (como nos outros formulários do site): busca pelo começo.
  const telefone = screen.getByLabelText(/^Telefone \(WhatsApp\)/) as HTMLInputElement;
  expect(telefone.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(telefone.getAttribute("aria-describedby")!)?.textContent).toBe("Telefone com DDD.");
  expect(telefone.value).toBe("9999");
  const consentimento = screen.getByRole("checkbox");
  expect(consentimento.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(consentimento.getAttribute("aria-describedby")!)?.textContent).toContain("autorizar o uso dos dados");
  expect(screen.getByLabelText("Seu nome").getAttribute("aria-invalid")).toBeNull();
  expect((screen.getByLabelText("Cidade") as HTMLInputElement).value).toBe("Niterói");
  expect((screen.getByLabelText("Quartos") as HTMLSelectElement).value).toBe("2");
  expect((screen.getByLabelText("Já anuncia em alguma plataforma?") as HTMLSelectElement).value).toBe("nao");
  expect((screen.getByLabelText("Mensagem (opcional)") as HTMLTextAreaElement).value).toBe("Oi");
  expect((document.querySelector('input[name="site"]') as HTMLInputElement).value).toBe("");
});

it("sem ação injetada, usa a ação do servidor", async () => {
  m.acaoPadrao.mockResolvedValue({ ok: true });
  render(<FormContatoProprietario empresa="Sua Casa Exemplo" autorizacao={DA_PAGINA} />);
  preencher();
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
  expect(m.acaoPadrao).toHaveBeenCalledTimes(1);
});

it("versão publicada no painel (M7.15): a caixa mostra o texto que a página leu e o envio leva a marca dele", async () => {
  const v2 = { versao: 2, texto: "Autorizo a Sua Casa Exemplo a usar estes dados só para me responder (texto fictício da versão 2).", marca: "v2.fict" };
  const acao = vi.fn().mockResolvedValue({ ok: true });
  render(<FormContatoProprietario empresa="Sua Casa Exemplo" autorizacao={v2} acao={acao} />);
  const caixa = screen.getByRole("checkbox") as HTMLInputElement;
  expect(caixa.closest("label")?.textContent?.trim()).toBe(v2.texto);
  expect(document.body.textContent).not.toContain("me responder sobre a gestão do imóvel");
  fireEvent.click(caixa);
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(acao).toHaveBeenCalledTimes(1));
  expect((acao.mock.calls[0][1] as FormData).get("autorizacao")).toBe("v2.fict");
});
