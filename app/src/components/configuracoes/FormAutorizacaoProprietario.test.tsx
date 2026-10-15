// @vitest-environment jsdom
import Link from "next/link";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ERROS_TEXTO_AUTORIZACAO, LIMITE_TEXTO_AUTORIZACAO, TEXTOS_ORIGEM_AUTORIZACAO } from "@/proprietarios/autorizacao";
import { FormAutorizacaoProprietario } from "./FormAutorizacaoProprietario";
import { PERGUNTA_SAIR_SEM_PUBLICAR } from "./useSairSemPublicar";

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

const V2 = "Autorizo a {empresa} a me responder (texto fictício da versão 2).";
const props = (o: Partial<Parameters<typeof FormAutorizacaoProprietario>[0]> = {}) => ({
  formulario: "contato" as const,
  titulo: "Pedido de contato para a gestão completa",
  atual: ORIGEM,
  valor: TEXTOS_ORIGEM_AUTORIZACAO.contato,
  empresa: "Casa Exemplo",
  salvar: vi.fn().mockResolvedValue({}),
  ...o,
});
const sair = () => {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
};

it("versão nova em vigor sem texto mudado aqui (a página volta do servidor): o campo passa a mostrar o texto dela e oferece a seguinte", () => {
  const { rerender } = render(<FormAutorizacaoProprietario {...props()} />);
  rerender(<FormAutorizacaoProprietario {...props({ atual: { numero: 2, data: "2026-10-15" }, valor: V2 })} />);
  expect(campo().value).toBe(V2);
  expect(screen.getByText(/Versão 2, publicada em 15\/10\/2026\./)).toBeTruthy();
  expect(oculto("versaoBase")).toBe("2");
  expect(screen.queryByRole("alert", { name: "Versão publicada enquanto você editava" })).toBeNull();
  expect((screen.getByRole("button", { name: "Publicar a versão 3" }) as HTMLButtonElement).disabled).toBe(false);
});

it("publicado daqui: a página volta com a versão nova (o texto do campo), sem aviso, com a mensagem da publicação e a base nova", async () => {
  const salvar = vi.fn().mockResolvedValue({ ok: true, aviso: "Versão 2 publicada em 15/10/2026." });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { rerender } = render(<FormAutorizacaoProprietario {...props({ salvar })} />);
  fireEvent.change(campo(), { target: { value: "  Autorizo a {empresa}   a me responder (texto fictício da versão 2).  " } });
  fireEvent.click(screen.getByRole("button", { name: "Publicar a versão 2" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Versão 2 publicada em 15/10/2026."));
  // O servidor guardou o texto limpo e a página volta com ele em vigor.
  rerender(<FormAutorizacaoProprietario {...props({ salvar, atual: { numero: 2, data: "2026-10-15" }, valor: V2 })} />);
  expect(campo().value).toBe(V2);
  expect(oculto("versaoBase")).toBe("2");
  expect(screen.getByRole("status").textContent).toBe("Versão 2 publicada em 15/10/2026.");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(sair()).toBe(false);
});

it("versão nova em vigor com texto mudado aqui: o texto fica, com aviso; não publica até escolher, e a base acompanha o texto", () => {
  const { rerender } = render(<FormAutorizacaoProprietario {...props()} />);
  fireEvent.change(campo(), { target: { value: "Rascunho que não foi publicado." } });
  rerender(<FormAutorizacaoProprietario {...props({ atual: { numero: 2, data: "2026-10-15" }, valor: V2 })} />);
  expect(campo().value).toBe("Rascunho que não foi publicado.");
  const aviso = screen.getByRole("alert", { name: "Versão publicada enquanto você editava" });
  expect(aviso.textContent).toContain("Enquanto você editava, a versão 2 foi publicada");
  expect(aviso.textContent).toContain("O seu texto não foi publicado e continua no campo.");
  // O texto partiu da versão 1: é ela a base, e publicar fica parado até a escolha.
  expect(oculto("versaoBase")).toBe("1");
  expect((screen.getByRole("button", { name: "Publicar a versão 3" }) as HTMLButtonElement).disabled).toBe(true);
  // Continuar com o meu texto: a base passa a ser a versão 2 (publicar cria a 3 no lugar dela).
  fireEvent.click(screen.getByRole("button", { name: /^Continuar com o meu texto \(publicar cria a versão 3, no lugar da 2\)$/ }));
  expect(campo().value).toBe("Rascunho que não foi publicado.");
  expect(oculto("versaoBase")).toBe("2");
  expect(screen.queryByRole("alert", { name: "Versão publicada enquanto você editava" })).toBeNull();
  expect((screen.getByRole("button", { name: "Publicar a versão 3" }) as HTMLButtonElement).disabled).toBe(false);
});

it("versão nova com texto mudado: usar o texto dela pede confirmação, descarta o rascunho e leva a base junto", () => {
  const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { rerender } = render(<FormAutorizacaoProprietario {...props()} />);
  fireEvent.change(campo(), { target: { value: "Rascunho que não foi publicado." } });
  rerender(<FormAutorizacaoProprietario {...props({ atual: { numero: 2, data: "2026-10-15" }, valor: V2 })} />);
  fireEvent.click(screen.getByRole("button", { name: "Usar o texto da versão 2" }));
  expect(confirmar.mock.calls[0][0]).toBe("Descartar o seu texto e usar o da versão 2? O seu texto não foi publicado e se perde.");
  expect(campo().value).toBe("Rascunho que não foi publicado.");
  confirmar.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Usar o texto da versão 2" }));
  expect(campo().value).toBe(V2);
  expect(oculto("versaoBase")).toBe("2");
  expect(screen.queryByRole("alert", { name: "Versão publicada enquanto você editava" })).toBeNull();
  // Voltar a escrever o texto da versão em vigor também resolve (não há o que escolher).
  rerender(<FormAutorizacaoProprietario {...props({ atual: { numero: 3, data: "2026-10-15" }, valor: "Texto fictício da versão 3." })} />);
  expect(campo().value).toBe("Texto fictício da versão 3.");
  fireEvent.change(campo(), { target: { value: "Outro rascunho." } });
  rerender(<FormAutorizacaoProprietario {...props({ atual: { numero: 4, data: "2026-10-15" }, valor: "Texto fictício da versão 4." })} />);
  expect(oculto("versaoBase")).toBe("3");
  fireEvent.change(campo(), { target: { value: "Texto fictício da versão 4." } });
  expect(oculto("versaoBase")).toBe("4");
  expect(screen.queryByRole("alert", { name: "Versão publicada enquanto você editava" })).toBeNull();
  // Dali em diante o texto parte da versão 4: mudar de novo não traz o aviso de volta.
  fireEvent.change(campo(), { target: { value: "Texto fictício da versão 4, mudado." } });
  expect(oculto("versaoBase")).toBe("4");
  expect(screen.queryByRole("alert", { name: "Versão publicada enquanto você editava" })).toBeNull();
});

it("recusa e depois a página volta com outra versão (publicação da outra caixa): texto e base nunca de versões diferentes", async () => {
  const salvar = vi.fn().mockResolvedValue({ mensagem: "Enquanto você editava, a versão 2 foi publicada por outra pessoa.", valores: { formulario: "contato", versaoBase: "1", texto: "Meu texto." } });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { rerender } = render(<FormAutorizacaoProprietario {...props({ salvar })} />);
  fireEvent.change(campo(), { target: { value: "Meu texto." } });
  fireEvent.click(screen.getByRole("button", { name: "Publicar a versão 2" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("a versão 2 foi publicada por outra pessoa"));
  expect(oculto("versaoBase")).toBe("1");
  rerender(<FormAutorizacaoProprietario {...props({ salvar, atual: { numero: 2, data: "2026-10-15" }, valor: V2 })} />);
  // O texto digitado fica com a base de que partiu (1), e a recusa antiga sai: no lugar, o aviso com a escolha.
  expect(campo().value).toBe("Meu texto.");
  expect(oculto("versaoBase")).toBe("1");
  expect(screen.queryByText(/foi publicada por outra pessoa/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Continuar com o meu texto/ }));
  expect(oculto("versaoBase")).toBe("2");
  // Publicar agora manda a base 2 (e não a 1 que a recusa devolveu).
  salvar.mockResolvedValue({ ok: true, aviso: "Versão 3 publicada em 15/10/2026." });
  fireEvent.click(screen.getByRole("button", { name: "Publicar a versão 3" }));
  await waitFor(() => expect(salvar).toHaveBeenCalledTimes(2));
  expect(Object.fromEntries(salvar.mock.calls[1][1] as FormData)).toEqual({ formulario: "contato", versaoBase: "2", texto: "Meu texto." });
});

it("recusa e a página volta com outra versão, sem texto mudado: o campo e a base passam à versão nova juntos", async () => {
  const salvar = vi.fn().mockResolvedValue({ mensagem: "Enquanto você editava, a versão 2 foi publicada por outra pessoa.", valores: { formulario: "contato", versaoBase: "1", texto: TEXTOS_ORIGEM_AUTORIZACAO.contato } });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { rerender } = render(<FormAutorizacaoProprietario {...props({ salvar })} />);
  fireEvent.click(screen.getByRole("button", { name: "Publicar a versão 2" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("a versão 2 foi publicada por outra pessoa"));
  rerender(<FormAutorizacaoProprietario {...props({ salvar, atual: { numero: 2, data: "2026-10-15" }, valor: V2 })} />);
  expect(campo().value).toBe(V2);
  expect(oculto("versaoBase")).toBe("2");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("o campo não corta o texto colado: acima do limite, o aviso diz quanto tem e o contador mede o texto limpo", () => {
  mostrar();
  expect(campo().hasAttribute("maxlength")).toBe(false);
  fireEvent.change(campo(), { target: { value: "x".repeat(LIMITE_TEXTO_AUTORIZACAO + 1) } });
  expect(campo().value).toHaveLength(LIMITE_TEXTO_AUTORIZACAO + 1);
  expect(screen.getByRole("note", { name: "O que impede publicar" }).textContent).toContain(`Máximo de ${LIMITE_TEXTO_AUTORIZACAO} caracteres (o texto tem ${LIMITE_TEXTO_AUTORIZACAO + 1}).`);
  expect(screen.getByText(/agora são 501/)).toBeTruthy();
  expect(previa()).toContain("(texto inválido: veja abaixo)");
  // Espaços seguidos e nas pontas contam como na publicação.
  fireEvent.change(campo(), { target: { value: "  Autorizo    a {empresa}.  " } });
  expect(screen.getByText(/agora são 21 \(espaços seguidos contam como um\)/)).toBeTruthy();
});

it("sair da tela com o texto mudado pede confirmação (fechar ou recarregar e os links do painel); voltar ao texto publicado tira o aviso", () => {
  const navegar = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
  render(
    <>
      <Link href="/painel/configuracoes/empresa" onClick={navegar}>
        Empresa
      </Link>
      <FormAutorizacaoProprietario {...props()} />
    </>,
  );
  const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
  expect(sair()).toBe(false);
  fireEvent.click(screen.getByRole("link", { name: "Empresa" }));
  expect(confirmar).not.toHaveBeenCalled();
  fireEvent.change(campo(), { target: { value: "Autorizo a {empresa} a me responder (colado do advogado)." } });
  expect(sair()).toBe(true);
  // Desistiu: o link nem chega a trocar de tela, e o texto continua.
  expect(fireEvent.click(screen.getByRole("link", { name: "Empresa" }))).toBe(false);
  expect(confirmar).toHaveBeenCalledWith(PERGUNTA_SAIR_SEM_PUBLICAR);
  expect(navegar).toHaveBeenCalledTimes(1);
  expect(campo().value).toContain("colado do advogado");
  // Só espaços a mais não é mudança (a publicação não criaria versão).
  fireEvent.change(campo(), { target: { value: `  ${TEXTOS_ORIGEM_AUTORIZACAO.contato.replace(" ", "   ")} ` } });
  expect(sair()).toBe(false);
});

it("duas caixas mudadas na mesma tela: o link pergunta uma vez só", () => {
  const navegar = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
  render(
    <>
      <Link href="/painel/configuracoes/empresa" onClick={navegar}>
        Empresa
      </Link>
      <FormAutorizacaoProprietario {...props()} />
      <FormAutorizacaoProprietario {...props({ formulario: "cadastro", titulo: "Cadastro do marketplace", valor: TEXTOS_ORIGEM_AUTORIZACAO.cadastro })} />
    </>,
  );
  const [contato, cadastro] = screen.getAllByRole("textbox", { name: /^Texto da caixa/ });
  fireEvent.change(contato, { target: { value: "Texto novo do contato." } });
  fireEvent.change(cadastro, { target: { value: "Texto novo do cadastro." } });
  const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("link", { name: "Empresa" }));
  expect(confirmar).toHaveBeenCalledTimes(1);
  expect(navegar).toHaveBeenCalledTimes(1);
  // Confirmou: fechar no caminho não pergunta de novo.
  expect(sair()).toBe(false);
});
