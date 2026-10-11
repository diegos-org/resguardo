// @vitest-environment jsdom
/**
 * M8.2e — o bloco **Disputa** na ficha da reserva (desenho "Painel"; itens 9, 25 e 26): a equipe do financeiro vê os valores
 * e as ações que o domínio permite; quem só lê a reserva vê a frase, a situação e o prazo (sem R$); "Registrar quem arca" e
 * "Confirmar o resultado" começam sem nada marcado e pedem confirmação com a pergunta montada no servidor.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PagamentoDoPainel } from "@/pagamentos/consultas";
import type { ContestacaoDaEquipe, ContestacaoNaTela, DecisaoNaTela, ResultadoNaTela } from "@/pagamentos/contestacao-tela";

type Acao = (estado: unknown, form: FormData) => Promise<{ ok?: boolean; mensagem?: string }>;
const m = vi.hoisted(() => ({
  decidir: vi.fn<Acao>(async () => ({ ok: false, mensagem: "Recusada pelo domínio (teste)." })),
  resultado: vi.fn<Acao>(async () => ({})),
  documentos: vi.fn<Acao>(async () => ({})),
  registrar: vi.fn<Acao>(async () => ({})),
}));
vi.mock("@/pagamentos/acoes-contestacao", () => ({
  atualizarValorSeguradoAcao: vi.fn(),
  cancelarReservaContestadaAcao: vi.fn(),
  conferirAvisoAcao: vi.fn(),
  confirmarDebitoAcao: vi.fn(),
  confirmarOutraDisputaAcao: vi.fn(),
  confirmarResultadoAcao: m.resultado,
  encerrarSemEfeitoAcao: vi.fn(),
  informarPrazoAcao: vi.fn(),
  marcarDocumentosEnviadosAcao: m.documentos,
  mudarDecisaoAcao: vi.fn(),
  previaDoCancelamentoContestadoAcao: vi.fn(),
  registrarDecisaoAcao: m.decidir,
  registrarDisputaAcao: m.registrar,
}));
import { CancelarContestada, ContestacaoSite } from "./ContestacaoSite";

const HOJE = "2026-10-11";
const sem = { conferir: false, devolver: false, devolucaoPorFora: false, registrarLiberacao: false, estornarLiberacao: false, registrarTaxaPerdida: false };
const pagamento = {
  id: "11111111-1111-4111-8111-111111111111",
  cotacaoId: "c",
  reservaId: "r1",
  forma: "cartao",
  situacao: "contestado",
  ambiente: "teste",
  aoVivo: false,
  valor: 182400,
  valorPago: 182400,
  taxa: 9029,
  liquido: 173371,
  liberacaoPrevistaEm: null,
  liberacaoConfirmadaEm: null,
  liberacaoOrigem: null,
  pixExpiraEm: null,
  aprovadoEm: new Date("2026-10-01T15:05:00Z"),
  consultadoEm: new Date("2026-10-01T15:06:00Z"),
  criadoEm: new Date("2026-10-01T15:00:00Z"),
  desfecho: "reserva",
  desfechoEm: new Date("2026-10-01T15:05:00Z"),
  motivoSemReserva: null,
  motivoSemReservaTexto: null,
  avisos: [],
  devolucao: null,
  pedeAtencao: true,
  acoes: sem,
  aceite: null,
} as unknown as PagamentoDoPainel;

const base: ContestacaoNaTela = {
  id: "22222222-2222-4222-8222-222222222222",
  pagamentoId: pagamento.id,
  tipo: "chargeback",
  situacao: "aberta",
  rodada: 1,
  cabecalho: "Contestação no cartão — aberta em 05/10 (rodada 1)",
  frase: "O pagamento desta reserva está em disputa (contestação no cartão): quem cuida do financeiro acompanha.",
  situacaoTexto: "Em disputa (o Mercado Pago analisa)",
  idCaso: "CASO-FICTICIO-1",
  abertaEm: new Date("2026-10-05T13:00:00Z"),
  prazo: { texto: "prazo dos documentos: 20/10 (faltam 9 dias)", nivel: "info", vencido: false },
  documentosEnviadosEm: null,
  podeMarcarDocumentos: true,
  desde: "2026-10-01",
  seguraValor: true,
};

const perguntas = (quem: string) => ({
  imovel: `Registrar a causa "Imóvel" e que ${quem} arca? (teste)`,
  scl: `Registrar a causa "SCL" e que ${quem} arca? (teste)`,
  cobranca: `Registrar a causa "Cobrança" e que ${quem} arca? (teste)`,
  fraude: `Registrar a causa "Fraude" e que ${quem} arca? Confirmação reforçada (teste)`,
  outro: `Registrar a causa "Outro" e que ${quem} arca? (teste)`,
});
const decidir: DecisaoNaTela = {
  versao: 0,
  modo: "registrar",
  causas: [
    { codigo: "imovel", nome: "Problema no imóvel", frase: "o hóspede reclamou do imóvel" },
    { codigo: "fraude", nome: "Fraude", frase: "o titular do cartão não reconhece a compra" },
  ],
  opcoes: [
    { quemArca: "proprietario", nome: "O proprietário", proprietario: "R$ 1.200,00", scl: "R$ 0,00", assinatura: "aaaaaaaaaaaaaaaa", perguntas: perguntas("o proprietário") },
    { quemArca: "scl", nome: "A SCL", proprietario: "R$ 0,00", scl: "R$ 1.824,00", assinatura: "bbbbbbbbbbbbbbbb", perguntas: perguntas("a SCL") },
  ],
  semOpcao: [],
  fatos: ["Aberta em 05/10, antes da entrada (12/10)."],
  atualizacao: null,
};
const resultado: ResultadoNaTela = {
  versao: 1,
  assinatura: "cccccccccccccccc",
  fatos: ["O Mercado Pago mostra a disputa encerrada: o valor foi devolvido ao pagador."],
  emAndamento: false,
  semReserva: false,
  retidoRealizado: false,
  semRecebimento: false,
  proposta: { valorPerdido: 182400, liquidoNaoEntrou: 173371, debitoEm: "2026-10-09", liquido: 173371 },
  contaDoPerdido: "o valor em disputa",
  desde: "2026-10-01",
  perguntas: { ganha: "Confirmar que a SCL ganhou a disputa em {data}? (teste)", perdida: "Confirmar que a SCL perdeu {valor} em {data}? (teste)" },
};
const equipe = (o: Partial<ContestacaoDaEquipe> = {}, acoes: Partial<ContestacaoDaEquipe["acoes"]> = {}): ContestacaoDaEquipe => ({
  ...base,
  origem: "leitura",
  registradaAMao: false,
  duplicataPossivel: false,
  idContestacao: "CBK-FICTICIO-1",
  idTransacao: null,
  valor: "R$ 1.824,00",
  valorEmRisco: "R$ 1.824,00",
  contaDoValorEmRisco: "o valor em disputa (o líquido ainda não entrou)",
  mercadoPago: ["Em análise"],
  verificacao: "Verificação do banco: não informada",
  notaRegistro: "",
  eventos: [{ em: new Date("2026-10-05T13:00:00Z"), texto: "Disputa aberta pela leitura", quem: "sistema" }],
  decisao: null,
  divisaoMudou: false,
  semDecisao: null,
  lancamentos: { proprietario: [], scl: [], caixa: [] },
  substituidas: [],
  avisos: ["Falta decidir quem arca."],
  resultado: null,
  ...o,
  acoes: { debito: null, decidir: null, outraDisputa: false, prazo: null, resultado: null, semEfeito: null, conferirAviso: null, ...acoes },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("bloco Disputa na ficha da reserva (M8.2e)", () => {
  it("sem financeiro:ler: a frase, a situação e o prazo, sem valores; as ações de documentos ficam", () => {
    render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={null} operacao={[base]} editarFinanceiro={false} defesa hoje={HOJE} />);
    const bloco = screen.getByRole("region", { name: /Disputa: Contestação no cartão/ });
    expect(within(bloco).getByText(/quem cuida do financeiro acompanha/)).toBeTruthy();
    expect(within(bloco).getByText("Em disputa (o Mercado Pago analisa)")).toBeTruthy();
    expect(within(bloco).getByText(/faltam 9 dias/)).toBeTruthy();
    expect(bloco.textContent).not.toMatch(/R\$/);
    expect(within(bloco).getByRole("link", { name: /Documentos para a defesa/ }).getAttribute("href")).toBe("/painel/reservas/r1/defesa");
    expect(within(bloco).getByRole("form", { name: "Documentos enviados no painel do Mercado Pago" })).toBeTruthy();
    // Nada de decidir, resultado ou registrar sem o financeiro.
    expect(screen.queryByRole("form", { name: "Registrar quem arca" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar disputa/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Beds24/);
  });

  it("sem disputa e sem o registro: nada aparece", () => {
    const { container } = render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={null} operacao={[]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    expect(container.innerHTML).toBe("");
  });

  it("a equipe do financeiro: os valores, os números e só as ações que o domínio permite", () => {
    render(
      <ContestacaoSite
        reservaId="r1"
        pagamento={pagamento}
        equipe={[equipe({}, { decidir, prazo: { desde: "2026-10-01" } })]}
        operacao={[]}
        editarFinanceiro
        defesa
        hoje={HOJE}
      />,
    );
    const bloco = screen.getByRole("region", { name: /Disputa: Contestação no cartão/ });
    expect(within(bloco).getByText("CASO-FICTICIO-1")).toBeTruthy();
    expect(within(bloco).getByText("CBK-FICTICIO-1")).toBeTruthy();
    expect(within(bloco).getAllByText(/R\$ 1\.824,00/).length).toBeGreaterThan(0);
    expect(within(bloco).getByText("Falta decidir quem arca.")).toBeTruthy();
    expect(within(bloco).getByRole("form", { name: "Registrar quem arca" })).toBeTruthy();
    expect(within(bloco).getByRole("form", { name: "Informar o prazo dos documentos" })).toBeTruthy();
    expect(within(bloco).queryByRole("form", { name: "Confirmar o resultado" })).toBeNull();
    expect(within(bloco).queryByRole("form", { name: "Encerrar sem efeito" })).toBeNull();
    expect(within(bloco).queryByRole("form", { name: "Confirmar o débito do Mercado Pago" })).toBeNull();
    // "Registrar disputa vista no painel do Mercado Pago" fica no quadro do pagamento (financeiro:editar).
    expect(screen.getByRole("button", { name: /Registrar disputa vista no painel do Mercado Pago/ })).toBeTruthy();
  });

  it("registrar quem arca: começa sem nada marcado e só envia depois de escolher a causa e quem arca, com a pergunta do servidor", async () => {
    const confirmar = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmar);
    render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={[equipe({}, { decidir })]} operacao={[]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    const form = screen.getByRole("form", { name: "Registrar quem arca" });
    for (const r of within(form).getAllByRole("radio")) expect((r as HTMLInputElement).checked).toBe(false);
    const botao = within(form).getByRole("button", { name: "Registrar quem arca" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(within(form).getByText(/o sistema nunca escolhe/)).toBeTruthy();
    fireEvent.click(within(form).getByLabelText(/Fraude/));
    expect(botao.disabled).toBe(true);
    fireEvent.click(within(form).getByLabelText(/O proprietário/));
    expect(botao.disabled).toBe(false);
    expect((form.querySelector('input[name="assinatura"]') as HTMLInputElement).value).toBe("aaaaaaaaaaaaaaaa");
    fireEvent.change(within(form).getByLabelText(/Nota da decisão/), { target: { value: "nota fictícia" } });
    fireEvent.click(botao);
    expect(confirmar).toHaveBeenCalledWith('Registrar a causa "Fraude" e que o proprietário arca? Confirmação reforçada (teste)');
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Recusada pelo domínio (teste).");
    const dados = m.decidir.mock.calls[0]![1];
    expect(dados.get("causa")).toBe("fraude");
    expect(dados.get("quemArca")).toBe("proprietario");
    expect(dados.get("versao")).toBe("0");
    expect(dados.get("contestacaoId")).toBe(base.id);
  });

  it("registrar quem arca: recusada a confirmação, nada é enviado", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={[equipe({}, { decidir })]} operacao={[]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    const form = screen.getByRole("form", { name: "Registrar quem arca" });
    fireEvent.click(within(form).getByLabelText(/Problema no imóvel/));
    fireEvent.click(within(form).getByLabelText(/A SCL/));
    fireEvent.change(within(form).getByLabelText(/Nota da decisão/), { target: { value: "nota fictícia" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar quem arca" }));
    expect(m.decidir).not.toHaveBeenCalled();
  });

  it("confirmar o resultado: começa sem Ganhou nem Perdeu; a pergunta leva a data e o valor digitados", () => {
    const confirmar = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmar);
    render(
      <ContestacaoSite
        reservaId="r1"
        pagamento={pagamento}
        equipe={[equipe({ situacao: "a_confirmar", situacaoTexto: "Encerrada no Mercado Pago (a confirmar)" }, { resultado })]}
        operacao={[]}
        editarFinanceiro={false}
        defesa={false}
        hoje={HOJE}
      />,
    );
    const form = screen.getByRole("form", { name: "Confirmar o resultado" });
    const radios = within(form).getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([false, false]);
    const botao = within(form).getByRole("button", { name: "Confirmar o resultado" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(within(form).getByText(/devolvido ao pagador/)).toBeTruthy();
    fireEvent.click(within(form).getByLabelText(/Perdeu/));
    expect((within(form).getByLabelText(/Valor que a SCL perdeu/) as HTMLInputElement).value).toBe("1824,00");
    fireEvent.change(within(form).getByLabelText(/Data do resultado/), { target: { value: "2026-10-10" } });
    fireEvent.click(botao);
    expect(confirmar).toHaveBeenCalledWith("Confirmar que a SCL perdeu R$ 1.824,00 em 10/10/2026? (teste)");
    expect(m.resultado).toHaveBeenCalledTimes(1);
  });

  it("documentos enviados: pede confirmação com a data, como toda ação da disputa", () => {
    const confirmar = vi.fn<(pergunta: string) => boolean>(() => false);
    vi.stubGlobal("confirm", confirmar);
    render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={null} operacao={[base]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    const form = screen.getByRole("form", { name: "Documentos enviados no painel do Mercado Pago" });
    fireEvent.click(within(form).getByRole("button", { name: "Documentos enviados no painel do Mercado Pago" }));
    expect(confirmar.mock.calls[0]?.[0]).toMatch(/11\/10\/2026/);
    expect(m.documentos).not.toHaveBeenCalled();
  });

  it("decisão registrada: as linhas e o texto pronto para o proprietário (nada é enviado sozinho)", () => {
    render(
      <ContestacaoSite
        reservaId="r1"
        pagamento={pagamento}
        equipe={[
          equipe({
            decisao: { linhas: [["Causa", "Fraude"], ["Quem arca", "O proprietário"]], nota: "nota da equipe", explicacao: "", textoParaProprietario: "Texto fictício para o proprietário." },
            avisos: [],
          }),
        ]}
        operacao={[]}
        editarFinanceiro={false}
        defesa={false}
        hoje={HOJE}
      />,
    );
    expect(screen.getByText("O proprietário")).toBeTruthy();
    expect(screen.getByText("nota da equipe")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copiar texto para o proprietário" })).toBeTruthy();
    expect(screen.getByText(/nada é enviado sozinho/)).toBeTruthy();
  });
});

describe("Cancelar a reserva contestada (M8.2e)", () => {
  it("só aparece quando a ficha manda mostrar", () => {
    const { container } = render(<CancelarContestada reservaId="r1" mostrar={false} />);
    expect(container.innerHTML).toBe("");
    render(<CancelarContestada reservaId="r1" mostrar />);
    expect(screen.getByRole("button", { name: "Cancelar a reserva contestada" })).toBeTruthy();
  });
});
