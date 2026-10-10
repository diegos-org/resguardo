// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CotacaoVista } from "@/site/cotacoes";
import { Cotacao } from "./Cotacao";
import { Disponibilidade } from "./Disponibilidade";
import { FormConsulta } from "./FormConsulta";
import { FormSegurar } from "./FormSegurar";
import { SegurarDatas } from "./SegurarDatas";

const base: CotacaoVista = {
  cotacao: {
    id: "c1", organizacaoId: "o1", imovelId: "i1", codigo: "COT-ABCDEFGH", estado: "aberta", checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, noites: 3, situacao: "disponivel",
    diarias: 135000, limpeza: 25000, hospedeExtra: 30000, valorCheio: 190000, desconto: 7600, total: 182400, leituraEm: null, reservaId: null, holdAte: null, criadaEm: new Date(), atualizadaEm: new Date(),
    imovelCodigo: "403", imovelNome: "Studio Exemplo", fuso: "America/Sao_Paulo",
  },
  estado: "aberta",
  atual: null,
  mudou: false,
  reserva: null,
};
const vista = (over: Partial<CotacaoVista>, cot: Partial<CotacaoVista["cotacao"]> = {}): CotacaoVista => ({ ...base, ...over, cotacao: { ...base.cotacao, ...cot } });
afterEach(cleanup);

it("cotação aberta: resumo com valor por partes, valor cheio e desconto do site, e o formulário de contato; sem pagamento", () => {
  render(<Cotacao vista={base} whatsapp="5521999990000" email="" formulario={<p>FORMULARIO</p>} />);
  expect(screen.getByRole("heading", { name: "Sua cotação" })).toBeTruthy();
  expect(screen.getByText("COT-ABCDEFGH")).toBeTruthy();
  expect(screen.getByText("R$ 1.350,00")).toBeTruthy();
  expect(screen.getByText("Valor cheio").nextElementSibling?.textContent).toBe("R$ 1.900,00");
  expect(screen.getByText("Desconto do site").nextElementSibling?.textContent).toBe("− R$ 76,00");
  expect(screen.getByText("R$ 1.824,00")).toBeTruthy();
  expect(screen.getByText("FORMULARIO")).toBeTruthy();
  expect(screen.getByText(/Nenhum pagamento é feito no site/)).toBeTruthy();
  cleanup();
  // Sem desconto (regra sem margem): só o total, sem as linhas de valor cheio e desconto.
  render(<Cotacao vista={vista({}, { desconto: 0, total: 190000 })} whatsapp={null} email="" />);
  expect(screen.queryByText("Valor cheio")).toBeNull();
  expect(screen.queryByText("Desconto do site")).toBeNull();
  expect(screen.getByText("R$ 1.900,00")).toBeTruthy();
});

it("cotação que mudou: aviso com o valor atual e nova consulta com os mesmos dados; sem formulário", () => {
  const atual = { situacao: "disponivel" as const, motivos: [], noites: 3, cotacao: { diarias: 150000, limpeza: 25000, hospedeExtra: 30000, valorCheio: 205000, desconto: 8200, total: 196800 }, leituraEm: null };
  render(<Cotacao vista={vista({ mudou: true, atual })} whatsapp={null} email="" formulario={<p>FORMULARIO</p>} />);
  expect(screen.getByRole("heading", { name: "Esta cotação mudou" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("O valor mudou desde esta cotação");
  expect(screen.getByRole("alert").textContent).toContain("Valor atual: R$ 1.968,00");
  expect(screen.queryByText("FORMULARIO")).toBeNull();
  expect(screen.getByRole("link", { name: "Fazer uma nova consulta" }).getAttribute("href")).toBe("/consulta?imovel=403&entrada=2026-10-12&saida=2026-10-15&hospedes=4");
  cleanup();
  // Só a situação mudou (mesmo valor): o aviso fala da disponibilidade, não do valor.
  render(<Cotacao vista={vista({ mudou: true, atual: { ...atual, situacao: "a_confirmar", cotacao: { ...atual.cotacao, diarias: 135000, valorCheio: 190000, desconto: 7600, total: 182400 }, motivos: ["Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa."] } })} whatsapp={null} email="" />);
  expect(screen.getByRole("alert").textContent).toContain("precisa ser confirmada pela equipe");
  expect(screen.getByRole("alert").textContent).not.toContain("Valor atual");
});

it("datas seguradas: prazo no fuso do imóvel, pedido e botão do WhatsApp com a mensagem; expirada e convertida", () => {
  const holdAte = new Date("2026-10-01T15:30:00Z"); // 12:30 em São Paulo
  render(<Cotacao vista={vista({ estado: "segurada", reserva: { codigo: "SCL-TESTE1", estado: "pedido" } }, { estado: "segurada", holdAte })} whatsapp="5521999990000" email="" />);
  expect(screen.getByRole("heading", { name: "Datas seguradas" })).toBeTruthy();
  expect(screen.getByText(/pedido SCL-TESTE1/).textContent).toContain("12:30");
  const link = screen.getByRole("link", { name: "Falar com a equipe pelo WhatsApp" }).getAttribute("href") ?? "";
  expect(link.startsWith("https://wa.me/5521999990000?text=")).toBe(true);
  expect(decodeURIComponent(link)).toContain("COT-ABCDEFGH");
  expect(decodeURIComponent(link)).toContain("seguradas para mim até 01/10, 12:30");
  cleanup();
  render(<Cotacao vista={vista({ estado: "expirada" }, { estado: "expirada", holdAte })} whatsapp={null} email="contato@example.com" />);
  expect(screen.getByRole("heading", { name: "O tempo desta cotação acabou" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Fazer uma nova consulta" })).toBeTruthy();
  cleanup();
  render(<Cotacao vista={vista({ estado: "convertida", reserva: { codigo: "SCL-TESTE1", estado: "confirmada" } }, { estado: "segurada", holdAte })} whatsapp={null} email="" />);
  expect(screen.getByRole("heading", { name: "Reserva confirmada" })).toBeTruthy();
  expect(screen.getByText(/código SCL-TESTE1/)).toBeTruthy();
});

const acao = vi.fn();
beforeEach(() => vi.resetAllMocks());

it("formulário de contato envia código e dados; mostra o erro do servidor por campo e geral; o digitado fica no navegador", async () => {
  // O servidor nunca devolve os dados digitados (M8.2a): os campos voltam com o que foi enviado.
  acao.mockResolvedValue({ erro: "Confira seus dados.", erros: { email: "Informe um e-mail válido." } });
  render(<FormSegurar codigo="COT-ABCDEFGH" minutos={30} acao={acao} />);
  expect(screen.getByText("Segurar as datas por 30 minutos")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "x@example.com" } });
  fireEvent.change(screen.getByLabelText("WhatsApp (com DDD)"), { target: { value: "21999990000" } });
  fireEvent.click(screen.getByRole("button", { name: "Segurar as datas" }));
  await waitFor(() => expect(acao).toHaveBeenCalled());
  const form = acao.mock.calls[0][1] as FormData;
  expect(form.get("codigo")).toBe("COT-ABCDEFGH");
  expect(form.get("nome")).toBe("Ana");
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Confira seus dados."));
  expect(screen.getByText("Informe um e-mail válido.")).toBeTruthy();
  expect(acao.mock.calls[0][0]).toEqual({});
  expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Ana");
  expect((screen.getByLabelText(/^E-mail/) as HTMLInputElement).value).toBe("x@example.com");
  expect(screen.getByText(/Nenhum pagamento é feito aqui/)).toBeTruthy();
  cleanup();
  render(<FormSegurar codigo="COT-ABCDEFGH" minutos={30} acao={acao} comPagamento />);
  expect(screen.queryByText(/Nenhum pagamento é feito aqui/)).toBeNull();
  expect(screen.getByText(/Nada é cobrado ao segurar: o Pix aparece logo depois/)).toBeTruthy();
});

it("aviso de como os dados são usados (M7.4): com a Política de privacidade publicada, o link para a versão em vigor numa aba nova; sem ela, o aviso sem link", () => {
  const { container } = render(<FormSegurar codigo="COT-ABCDEFGH" minutos={30} acao={acao} comPagamento privacidade={2} />);
  expect(container.textContent).toContain("Usamos seus dados só para a sua reserva, como explica a Política de privacidade. Nada é cobrado ao segurar: o Pix aparece logo depois, nesta página.");
  const link = screen.getByRole("link", { name: "Política de privacidade" });
  expect(link.getAttribute("href")).toBe("/privacidade?versao=2");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(container.textContent).not.toContain("Seus dados vão só para a equipe");
  cleanup();
  const sem = render(<FormSegurar codigo="COT-ABCDEFGH" minutos={30} acao={acao} />);
  expect(sem.container.textContent).toContain("Usamos seus dados só para confirmar a reserva com você. Nenhum pagamento é feito aqui.");
  expect(screen.queryByRole("link", { name: "Política de privacidade" })).toBeNull();
  cleanup();
  render(<FormSegurar codigo="COT-ABCDEFGH" minutos={30} acao={acao} privacidade={1} />);
  expect(screen.getByRole("link", { name: "Política de privacidade" }).getAttribute("href")).toBe("/privacidade?versao=1");
});

it("chamada 'segurar estas datas' leva o pedido da consulta escondido e avisa quando é 'a confirmar'", () => {
  const pedido = { imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "4" };
  const { container } = render(<SegurarDatas pedido={pedido} aConfirmar acao={acao} />);
  expect(screen.getByRole("button", { name: "Segurar estas datas" })).toBeTruthy();
  expect(screen.getByRole("note").textContent).toContain("não garante a reserva");
  const escondidos = Object.fromEntries([...container.querySelectorAll("input[type=hidden]")].map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]));
  expect(escondidos).toEqual(pedido);
  cleanup();
  render(<SegurarDatas pedido={pedido} aConfirmar={false} acao={acao} />);
  expect(screen.queryByRole("note")).toBeNull();
});

it("com o Pix oferecido (M8.2a), os textos 'nenhum pagamento é feito no site' mudam; sem ele, ficam como hoje", () => {
  const pedido = { imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "4" };
  const resultado = { situacao: "disponivel" as const, motivos: [], noites: 3, cotacao: { diarias: 135000, limpeza: 25000, hospedeExtra: 0, valorCheio: 160000, desconto: 6400, total: 153600 }, leituraEm: null };
  const { container: hoje } = render(
    <>
      <SegurarDatas pedido={pedido} aConfirmar={false} acao={acao} />
      <Disponibilidade resultado={resultado} entrada="2026-10-12" saida="2026-10-15" fuso="America/Sao_Paulo" />
      <FormConsulta imoveis={[]} valores={{}} hoje="2026-10-01" canal="whatsapp" />
      <Cotacao vista={base} whatsapp={null} email="" />
    </>,
  );
  expect(hoje.textContent).toContain("Nenhum pagamento é feito aqui.");
  expect(hoje.textContent).toContain("sem reserva ou pagamento por aqui: a reserva é confirmada na conversa.");
  expect(hoje.textContent).toContain("Nenhum pagamento é feito no site por enquanto.");
  cleanup();
  const { container: comPix } = render(
    <>
      <SegurarDatas pedido={pedido} aConfirmar={false} acao={acao} comPagamento />
      <Disponibilidade resultado={resultado} entrada="2026-10-12" saida="2026-10-15" fuso="America/Sao_Paulo" comPagamento />
      <FormConsulta imoveis={[]} valores={{}} hoje="2026-10-01" canal="whatsapp" comPagamento />
      <Cotacao vista={base} whatsapp={null} email="" pagamentoNoSite />
    </>,
  );
  expect(comPix.textContent).not.toMatch(/Nenhum pagamento|sem reserva ou pagamento/);
  expect(comPix.textContent).toContain("pode pagar por Pix ali mesmo");
  expect(comPix.textContent).toContain("segure as datas para pagar por Pix aqui no site");
  expect(comPix.textContent).toContain("Nada é cobrado na consulta.");
  expect(comPix.textContent).toContain("Nada é cobrado ao segurar as datas: o pagamento é por Pix");
});

it("com um pagamento (M8.2a): o título e o quadro dele vêm antes do resumo e substituem o estado da cotação", () => {
  const expirada = vista({ estado: "expirada" }, { estado: "segurada", holdAte: new Date("2026-10-01T15:30:00Z") });
  const { container } = render(<Cotacao vista={expirada} whatsapp="5521999990000" email="" pagamento={{ titulo: "Pagamento recebido", conteudo: <p>QUADRO DO PAGAMENTO</p> }} />);
  expect(screen.getByRole("heading", { name: "Pagamento recebido" })).toBeTruthy();
  expect(container.textContent!.indexOf("QUADRO DO PAGAMENTO")).toBeLessThan(container.textContent!.indexOf("Diárias"));
  expect(screen.queryByText("Fazer uma nova consulta")).toBeNull();
  expect(screen.queryByText(/O prazo passou sem confirmação/)).toBeNull();
  expect(screen.queryByText(/Nenhum pagamento é feito no site/)).toBeNull();
});
