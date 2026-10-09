// @vitest-environment jsdom
import Link from "next/link";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CAMPOS_LEGAIS, type CampoLegal, MENSAGEM_SEM_PRAZO } from "@/configuracoes/paginas-legais-texto";
import { FormPaginaLegal } from "./FormPaginaLegal";

// Dados fictícios da empresa; o CNPJ ficou sem preencher.
const VALORES: Partial<Record<CampoLegal, string>> = { nome_empresa: "Casa Exemplo", razao_social: "Casa Exemplo Temporada Ltda.", email_contato: "contato@example.com" };
const campos = CAMPOS_LEGAIS.filter((c) => !("so" in c)).map((c) => ({ chave: c.chave, rotulo: c.rotulo, valor: VALORES[c.chave] ?? "" }));
const TERMOS = { texto: "## Quem somos\n\n{{nome_empresa}} é a marca de {{razao_social}}, CNPJ {{cnpj}}.\n\n- Um item da lista" };
const CANCELAMENTO = { resumo: "- Cancelamento até {{dias_reembolso_integral}} dias antes: devolução integral.", texto: "## A quem vale\n\nVale para as reservas pagas no site." };

const mostrar = (o: Partial<Parameters<typeof FormPaginaLegal>[0]> = {}) =>
  render(<FormPaginaLegal documento="termos" atual={null} valores={TERMOS} dias={null} campos={campos} salvar={vi.fn()} {...o} />);
const previa = () => within(screen.getByText("Prévia de como fica no site").closest("details") as HTMLElement);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("sem versão publicada: aviso de texto-base, publicar a versão 1 e nenhum campo de prazo fora da Política de cancelamento", () => {
  mostrar();
  expect(screen.getByRole("note", { name: "" }).textContent).toContain("Nenhuma versão publicada: este é o texto-base.");
  expect(screen.getByText(/nada aparece no site/).textContent).toContain("o pagamento pelo site fica desligado");
  expect(screen.getByRole("button", { name: "Publicar a versão 1" })).toBeTruthy();
  expect(screen.queryByLabelText(/Reembolso integral até quantos dias/)).toBeNull();
  expect((screen.getByLabelText(/^Texto/) as HTMLTextAreaElement).value).toBe(TERMOS.texto);
  expect((document.querySelector('input[name="versaoBase"]') as HTMLInputElement).value).toBe("0");
  expect((document.querySelector('input[name="documento"]') as HTMLInputElement).value).toBe("termos");
});

it("prévia com os dados da empresa de agora e marcador no que falta; o que impede publicar aparece e acompanha o que se digita", () => {
  mostrar();
  expect(previa().getByRole("heading", { name: "Quem somos" })).toBeTruthy();
  expect(previa().getByText(/Casa Exemplo é a marca de Casa Exemplo Temporada Ltda\., CNPJ/)).toBeTruthy();
  expect(previa().getByText("[falta: CNPJ]").tagName).toBe("MARK");
  expect(previa().getByText("Um item da lista").tagName).toBe("LI");
  const impede = () => screen.getByRole("note", { name: "O que impede publicar" }).textContent;
  expect(impede()).toContain("Preencha em Configurações → Empresa antes de publicar: CNPJ.");
  // Campos disponíveis: o valor de agora ou onde preencher.
  const disponiveis = within(screen.getByRole("region", { name: "Campos disponíveis" }));
  expect(disponiveis.getByText("{{cnpj}}").closest("li")?.textContent).toContain("falta preencher em Configurações → Empresa");
  expect(disponiveis.getByText("{{razao_social}}").closest("li")?.textContent).toContain("Casa Exemplo Temporada Ltda.");
  expect(disponiveis.queryByText("{{dias_reembolso_integral}}")).toBeNull();
  // Campo inexistente e o prazo fora da Política de cancelamento.
  fireEvent.change(screen.getByLabelText(/^Texto/), { target: { value: "{{nome_empresa}} {{cnpjj}} {{dias_reembolso_integral}}" } });
  expect(impede()).toContain("O texto usa {{cnpjj}}, que não existe.");
  expect(impede()).toContain("{{dias_reembolso_integral}} só pode ser usado na Política de cancelamento.");
  expect(previa().getByText("[não existe: {{cnpjj}}]").tagName).toBe("MARK");
  expect(previa().getByText("[não vale aqui: {{dias_reembolso_integral}}]").tagName).toBe("MARK");
  fireEvent.change(screen.getByLabelText(/^Texto/), { target: { value: "Só {{nome_empresa}}." } });
  expect(screen.queryByRole("note", { name: "O que impede publicar" })).toBeNull();
  expect(previa().getByText("Só Casa Exemplo.")).toBeTruthy();
});

it("aviso do Beds24 só quando o texto cita o nome (não impede publicar)", () => {
  mostrar();
  expect(screen.queryByText(/O texto cita o Beds24/)).toBeNull();
  fireEvent.change(screen.getByLabelText(/^Texto/), { target: { value: `${TERMOS.texto}\n\nUsamos o Beds24 para o calendário.` } });
  expect(screen.getByText(/O texto cita o Beds24/).textContent).toContain("É só um aviso");
});

it("Política de cancelamento: prazo do reembolso no formulário, no resumo da prévia e nos campos; sem o campo do prazo no texto, não publica", () => {
  mostrar({ documento: "cancelamento", valores: CANCELAMENTO, dias: 14 });
  const prazo = screen.getByLabelText(/Reembolso integral até quantos dias antes da entrada/) as HTMLInputElement;
  expect(prazo.value).toBe("14");
  expect([prazo.min, prazo.max]).toEqual(["1", "365"]);
  expect(within(screen.getByRole("region", { name: "Prévia do resumo" })).getByText("Cancelamento até 14 dias antes: devolução integral.")).toBeTruthy();
  fireEvent.change(prazo, { target: { value: "30" } });
  expect(within(screen.getByRole("region", { name: "Prévia do resumo" })).getByText("Cancelamento até 30 dias antes: devolução integral.")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Campos disponíveis" })).getByText("{{dias_reembolso_integral}}").closest("li")?.textContent).toContain(": 30 (do campo acima");
  // O texto não usa o CNPJ (que falta): nada impede publicar.
  expect(screen.queryByRole("note", { name: "O que impede publicar" })).toBeNull();
  fireEvent.change(screen.getByLabelText(/^Resumo/), { target: { value: "Sem o prazo." } });
  expect(screen.getByRole("note", { name: "O que impede publicar" }).textContent).toContain(MENSAGEM_SEM_PRAZO);
  fireEvent.change(prazo, { target: { value: "0" } });
  expect(screen.getByRole("note", { name: "O que impede publicar" }).textContent).toContain("Informe um número de dias entre 1 e 365 para o reembolso integral.");
  // Com o prazo de volta no resumo e o número inválido, o aviso aparece uma vez só.
  fireEvent.change(screen.getByLabelText(/^Resumo/), { target: { value: CANCELAMENTO.resumo } });
  expect(screen.getByRole("note", { name: "O que impede publicar" }).querySelectorAll("li")).toHaveLength(1);
  expect(previa().getByText("[falta: Dias para o reembolso integral]").tagName).toBe("MARK");
});

it("publicar pede confirmação com o número da versão seguinte; sem confirmar, nada é enviado", () => {
  const salvar = vi.fn();
  const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
  mostrar({ documento: "cancelamento", valores: CANCELAMENTO, dias: 14, atual: { numero: 1, data: "2026-10-01" }, salvar });
  expect(screen.getByText(/Versão 1, publicada em 01\/10\/2026/)).toBeTruthy();
  expect(screen.queryByText(/Nenhuma versão publicada/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Publicar a versão 2" }));
  expect(confirmar).toHaveBeenCalledWith(expect.stringContaining("Publicar a versão 2 da Política de cancelamento? Ela passa a valer no site a partir de hoje"));
  expect(confirmar.mock.calls[0][0]).toContain("quem já aceitou a anterior continua com a anterior");
  expect(salvar).not.toHaveBeenCalled();
  cleanup();
  mostrar({ salvar });
  fireEvent.click(screen.getByRole("button", { name: "Publicar a versão 1" }));
  expect(confirmar).toHaveBeenLastCalledWith(expect.stringContaining("Publicar a versão 1 dos Termos de uso?"));
});

it("publicação recusada: alerta, erro no campo e o texto digitado continua; aceita: o aviso da versão publicada", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const salvar = vi
    .fn()
    .mockResolvedValueOnce({ mensagem: "Confira os campos destacados.", erros: { diasReembolsoIntegral: "Informe um número de dias entre 1 e 365." }, valores: { versaoBase: "1" } })
    .mockResolvedValueOnce({ ok: true, aviso: "Versão 2 publicada em 10/10/2026." });
  mostrar({ documento: "cancelamento", valores: CANCELAMENTO, dias: 14, atual: { numero: 1, data: "2026-10-01" }, salvar });
  fireEvent.change(screen.getByLabelText(/^Texto/), { target: { value: "## A quem vale\n\nTexto novo." } });
  fireEvent.click(screen.getByRole("button", { name: "Publicar a versão 2" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Confira os campos destacados."));
  expect(screen.getByText("Informe um número de dias entre 1 e 365.")).toBeTruthy();
  expect((screen.getByLabelText(/^Texto/) as HTMLTextAreaElement).value).toBe("## A quem vale\n\nTexto novo.");
  const [, dados] = salvar.mock.calls[0] as [unknown, FormData];
  expect(Object.fromEntries(dados.entries())).toMatchObject({ documento: "cancelamento", versaoBase: "1", diasReembolsoIntegral: "14", resumo: CANCELAMENTO.resumo, texto: "## A quem vale\n\nTexto novo." });
  fireEvent.click(screen.getByRole("button", { name: "Publicar a versão 2" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Versão 2 publicada em 10/10/2026."));
});

it("sair da página com o texto mudado pede confirmação (nada é guardado antes de publicar)", () => {
  mostrar();
  const sair = () => {
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  expect(sair()).toBe(false);
  fireEvent.change(screen.getByLabelText(/^Texto/), { target: { value: `${TERMOS.texto}\n\nMais um parágrafo.` } });
  expect(sair()).toBe(true);
  // Voltar ao texto carregado tira o aviso.
  fireEvent.change(screen.getByLabelText(/^Texto/), { target: { value: TERMOS.texto } });
  expect(sair()).toBe(false);
  // O link para Configurações → Empresa (sem recarregar a página) também pergunta.
  fireEvent.change(screen.getByLabelText(/^Texto/), { target: { value: "{{cnpj}} mudado" } });
  const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
  const link = screen.getAllByRole("link", { name: /Configurações → Empresa/ })[0];
  expect(fireEvent.click(link)).toBe(false);
  expect(confirmar).toHaveBeenCalledWith("Sair sem publicar? O texto mudado aqui se perde.");
});

it("links de fora do formulário (abas de Configurações, menu do painel) também perguntam; desistir fica na tela, confirmar sai sem perguntar de novo", () => {
  // No lugar da troca de tela do <Link> do Next (sem recarregar, e por isso sem o aviso do navegador).
  const navegar = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
  render(
    <>
      <nav aria-label="Abas de configurações">
        <Link href="/painel/configuracoes/empresa" onClick={navegar}>
          Empresa
        </Link>
        <a href="/termos?versao=1" target="_blank" rel="noreferrer" onClick={navegar}>
          Ver a versão 1
        </a>
        <a href="#versoes" onClick={navegar}>
          Versões publicadas
        </a>
      </nav>
      <FormPaginaLegal documento="termos" atual={null} valores={TERMOS} dias={null} campos={campos} salvar={vi.fn()} />
    </>,
  );
  const sair = () => {
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
  const empresa = screen.getByRole("link", { name: "Empresa" });
  // Sem mudança, o link anda sem perguntar.
  fireEvent.click(empresa);
  expect(confirmar).not.toHaveBeenCalled();
  expect(navegar).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText(/^Texto/), { target: { value: `${TERMOS.texto}\n\nColado do advogado.` } });
  // Desistiu: a tela fica, e o link nem chega a trocar de tela.
  expect(fireEvent.click(empresa)).toBe(false);
  expect(confirmar).toHaveBeenCalledWith("Sair sem publicar? O texto mudado aqui se perde.");
  expect(navegar).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText(/^Texto/) as HTMLTextAreaElement).value).toContain("Colado do advogado.");
  // Outra aba, Ctrl+clique e o link que só rola esta página não tiram daqui: não perguntam.
  fireEvent.click(screen.getByRole("link", { name: "Ver a versão 1" }));
  fireEvent.click(empresa, { ctrlKey: true });
  fireEvent.click(screen.getByRole("link", { name: "Versões publicadas" }));
  expect(confirmar).toHaveBeenCalledTimes(1);
  expect(navegar).toHaveBeenCalledTimes(4);
  // Confirmou: sai, e o aviso do navegador não pergunta de novo no caminho.
  confirmar.mockReturnValue(true);
  fireEvent.click(empresa);
  expect(navegar).toHaveBeenCalledTimes(5);
  expect(sair()).toBe(false);
  // Se a tela ficou e ele voltou a editar, a proteção volta.
  fireEvent.change(screen.getByLabelText(/^Texto/), { target: { value: `${TERMOS.texto}\n\nMais uma mudança.` } });
  expect(sair()).toBe(true);
});

it("Voltar do navegador com o texto mudado pergunta; desistir devolve esta tela ao histórico antes de o roteador agir", () => {
  const tela = "/painel/configuracoes/paginas-legais?doc=termos";
  window.history.replaceState({ __NA: true, tela: "paginas-legais" }, "", tela);
  // Como o roteador do Next: ouve o popstate na janela, sem captura, e troca de tela.
  const roteador = vi.fn();
  window.addEventListener("popstate", roteador);
  const voltar = (url: string) => {
    window.history.replaceState({ __NA: true, tela: "anterior" }, "", url);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  };
  try {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    mostrar();
    // Sem mudança, o Voltar anda sem perguntar.
    voltar("/painel/configuracoes/empresa");
    expect(confirmar).not.toHaveBeenCalled();
    expect(roteador).toHaveBeenCalledTimes(1);
    window.history.replaceState({ __NA: true, tela: "paginas-legais" }, "", tela);
    fireEvent.change(screen.getByLabelText(/^Texto/), { target: { value: `${TERMOS.texto}\n\nColado do advogado.` } });
    // Desistiu: o roteador não fica sabendo e o endereço volta a ser esta tela, com o estado dela.
    voltar("/painel/configuracoes/empresa");
    expect(confirmar).toHaveBeenCalledWith("Sair sem publicar? O texto mudado aqui se perde.");
    expect(roteador).toHaveBeenCalledTimes(1);
    expect(window.location.pathname + window.location.search).toBe(tela);
    expect(window.history.state).toMatchObject({ __NA: true, tela: "paginas-legais" });
    // Voltar só de âncora (#) nesta mesma tela não pergunta.
    voltar(`${tela}#versoes`);
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(roteador).toHaveBeenCalledTimes(2);
    // Confirmou: o roteador troca de tela.
    confirmar.mockReturnValue(true);
    voltar("/painel/configuracoes/empresa");
    expect(confirmar).toHaveBeenCalledTimes(2);
    expect(roteador).toHaveBeenCalledTimes(3);
  } finally {
    window.removeEventListener("popstate", roteador);
    window.history.replaceState(null, "", "/");
  }
});
