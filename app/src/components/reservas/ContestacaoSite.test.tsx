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
  mudar: vi.fn<Acao>(async () => ({})),
  semEfeito: vi.fn<Acao>(async () => ({})),
  previaCancelar: vi.fn<Acao>(async () => ({})),
}));
vi.mock("@/pagamentos/acoes-contestacao", () => ({
  atualizarValorSeguradoAcao: vi.fn(),
  cancelarReservaContestadaAcao: vi.fn(),
  conferirAvisoAcao: vi.fn(),
  confirmarDebitoAcao: vi.fn(),
  confirmarOutraDisputaAcao: vi.fn(),
  confirmarResultadoAcao: m.resultado,
  encerrarSemEfeitoAcao: m.semEfeito,
  informarPrazoAcao: vi.fn(),
  marcarDocumentosEnviadosAcao: m.documentos,
  mudarDecisaoAcao: m.mudar,
  previaDoCancelamentoContestadoAcao: m.previaCancelar,
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
    {
      quemArca: "proprietario",
      nome: "O proprietário",
      proprietario: "R$ 1.200,00",
      scl: "R$ 0,00",
      fica: { perdida: { proprietario: "-R$ 392,33", scl: "R$ 142,53" }, ganha: { proprietario: "R$ 807,67", scl: "R$ 142,53" } },
      assinatura: "aaaaaaaaaaaaaaaa",
      perguntas: perguntas("o proprietário"),
    },
    {
      quemArca: "scl",
      nome: "A SCL",
      proprietario: "R$ 0,00",
      scl: "R$ 1.824,00",
      fica: { perdida: { proprietario: "R$ 807,67", scl: "-R$ 1.681,47" }, ganha: { proprietario: "R$ 807,67", scl: "R$ 142,53" } },
      assinatura: "bbbbbbbbbbbbbbbb",
      perguntas: perguntas("a SCL"),
    },
  ],
  semOpcao: [],
  fatos: ["Aberta em 05/10, antes da entrada (12/10)."],
  atualizacao: null,
  explicacao: "",
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
  liberacaoAntes: null,
  contaDoPerdido: "o valor em disputa",
  desde: "2026-10-01",
  perguntas: { ganha: "Confirmar que a SCL ganhou a disputa em {data}? (teste)", perdida: "Confirmar que a SCL perdeu {valor} em {data}? (teste)" },
};
const equipe = (o: Partial<ContestacaoDaEquipe> = {}, acoes: Partial<ContestacaoDaEquipe["acoes"]> = {}): ContestacaoDaEquipe => ({
  ...base,
  origem: "leitura",
  registradaAMao: false,
  origemTexto: "Lida no Mercado Pago como contestação: pode ser uma reclamação no Mercado Pago (mediação); o sistema não tem como separar, confira no painel dele.",
  notaDebito: "",
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

  it("ganhou sem recebimento: a data e o líquido da liberação começam em branco (o líquido lido só como referência), e o Ganhou sem a liberação segue (Codex, 11/10)", () => {
    const confirmar = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmar);
    render(
      <ContestacaoSite
        reservaId="r1"
        pagamento={pagamento}
        equipe={[equipe({ situacao: "a_confirmar", situacaoTexto: "Encerrada no Mercado Pago (a confirmar)" }, { resultado: { ...resultado, semRecebimento: true } })]}
        operacao={[]}
        editarFinanceiro={false}
        defesa={false}
        hoje={HOJE}
      />,
    );
    const form = screen.getByRole("form", { name: "Confirmar o resultado" });
    fireEvent.click(within(form).getByLabelText(/Ganhou/));
    const data = within(form).getByLabelText(/Data em que a liberação caiu/) as HTMLInputElement;
    const liquido = within(form).getByLabelText(/Líquido que caiu/) as HTMLInputElement;
    expect([data.value, liquido.value]).toEqual(["", ""]);
    expect(within(form).getByText(/o Mercado Pago mostra R\$ 1\.733,71/)).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar o resultado" }));
    expect(m.resultado).toHaveBeenCalledTimes(1);
    const enviado = m.resultado.mock.calls[0][1] as FormData;
    expect([enviado.get("liberacaoData"), enviado.get("liberacaoLiquido")]).toEqual(["", ""]);
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
            decisao: { linhas: [["Causa", "Fraude"], ["Quem arca", "O proprietário"]], nota: "nota da equipe", notaMudanca: "", explicacao: "", textoParaProprietario: "Texto fictício para o proprietário." },
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

describe("revisão das telas (11/10/2026)", () => {
  it("mudar quem arca: a explicação ao proprietário em vigor vem no campo (enviar sem mexer a mantém)", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const mudar: DecisaoNaTela = { ...decidir, versao: 1, modo: "mudar", explicacao: "O ar-condicionado do quarto parou." };
    render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={[equipe({}, { decidir: mudar })]} operacao={[]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    const form = screen.getByRole("form", { name: "Mudar quem arca" });
    const campo = within(form).getByLabelText(/Explicação ao proprietário/) as HTMLTextAreaElement;
    expect(campo.value).toBe("O ar-condicionado do quarto parou.");
    fireEvent.click(within(form).getByLabelText(/Problema no imóvel/));
    fireEvent.click(within(form).getByLabelText(/O proprietário/));
    fireEvent.change(within(form).getByLabelText(/Por que mudar/), { target: { value: "nota fictícia" } });
    fireEvent.click(within(form).getByRole("button", { name: "Mudar quem arca" }));
    await vi.waitFor(() => expect(m.mudar).toHaveBeenCalled());
    expect(m.mudar.mock.calls[0]![1].get("explicacao")).toBe("O ar-condicionado do quarto parou.");
  });

  it("a prévia de cada opção: o débito de cada lado e o que cada um fica da reserva, perdida e ganha", () => {
    render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={[equipe({}, { decidir })]} operacao={[]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    const form = screen.getByRole("form", { name: "Registrar quem arca" });
    const opcao = within(form).getByLabelText(/O proprietário/).closest("label")!;
    expect(opcao.textContent).toContain("proprietário R$ 1.200,00; SCL R$ 0,00");
    expect(opcao.textContent).toContain("perdida: proprietário -R$ 392,33, SCL R$ 142,53");
    expect(opcao.textContent).toContain("ganha: proprietário R$ 807,67, SCL R$ 142,53");
  });

  it("confirmar o resultado: a recusa 'nota reforçada' mostra a caixa (a leitura não mostrava em andamento); o 'nunca entrou' é obrigatório e vai na pergunta", async () => {
    const confirmar = vi.fn<(pergunta: string) => boolean>(() => true);
    vi.stubGlobal("confirm", confirmar);
    m.resultado.mockResolvedValueOnce({ ok: false, mensagem: "O Mercado Pago ainda mostra esta disputa em andamento.", codigo: "nota_reforcada" } as never);
    const r: ResultadoNaTela = { ...resultado, perguntas: { ...resultado.perguntas, perdida: "Perdeu {valor} em {data}; nunca entrou: {naoEntrou}? (teste)" } };
    render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={[equipe({}, { resultado: r })]} operacao={[]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    const form = screen.getByRole("form", { name: "Confirmar o resultado" });
    expect(form.querySelector('input[name="notaReforcada"]')).toBeNull();
    fireEvent.click(within(form).getByLabelText(/Perdeu/));
    const naoEntrou = within(form).getByLabelText(/nunca entrou na conta/) as HTMLInputElement;
    expect(naoEntrou.required).toBe(true);
    fireEvent.change(naoEntrou, { target: { value: "39,80" } });
    fireEvent.change(within(form).getByLabelText(/Data do resultado/), { target: { value: "2026-10-10" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar o resultado" }));
    expect(confirmar).toHaveBeenCalledWith("Perdeu R$ 1.824,00 em 10/10/2026; nunca entrou: R$ 39,80? (teste)");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(within(form).getByLabelText(/O painel do Mercado Pago já mostra o resultado/)).toBeTruthy();
  });

  it("confirmar o resultado: o líquido desconhecido (proposta vazia) e o pedido de registrar a liberação antes aparecem em palavras", () => {
    const r: ResultadoNaTela = { ...resultado, proposta: { ...resultado.proposta, liquidoNaoEntrou: null }, liberacaoAntes: "Registre a liberação à mão antes (teste)." };
    render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={[equipe({}, { resultado: r })]} operacao={[]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    const form = screen.getByRole("form", { name: "Confirmar o resultado" });
    fireEvent.click(within(form).getByLabelText(/Perdeu/));
    expect((within(form).getByLabelText(/nunca entrou na conta/) as HTMLInputElement).value).toBe("");
    expect(within(form).getByText("Registre a liberação à mão antes (teste).")).toBeTruthy();
  });

  it("encerrar sem efeito: a recusa 'nota reforçada' mostra a caixa", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    m.semEfeito.mockResolvedValueOnce({ ok: false, mensagem: "O Mercado Pago ainda mostra esta disputa em andamento.", codigo: "nota_reforcada" } as never);
    render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={[equipe({}, { semEfeito: { pedeVolta: false, emAndamento: false } })]} operacao={[]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    const form = screen.getByRole("form", { name: "Encerrar sem efeito" });
    expect(form.querySelector('input[name="notaReforcada"]')).toBeNull();
    fireEvent.change(within(form).getByLabelText(/Por que fica sem efeito/), { target: { value: "Registrada por engano." } });
    fireEvent.click(within(form).getByRole("button", { name: "Encerrar sem efeito" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(within(form).getByLabelText(/O painel do Mercado Pago já mostra a disputa encerrada/)).toBeTruthy();
  });

  it("cancelar a reserva contestada: a prévia não exige a nota (o botão não valida o formulário) e o texto não fala em cartão", () => {
    render(<CancelarContestada reservaId="r1" mostrar />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar a reserva contestada" }));
    const form = screen.getByRole("form", { name: "Cancelar a reserva contestada" });
    expect((within(form).getByRole("button", { name: "Ver o cancelamento" }) as HTMLButtonElement).formNoValidate).toBe(true);
    expect((within(form).getByLabelText(/Nota/) as HTMLTextAreaElement).required).toBe(true);
    expect(form.textContent).not.toMatch(/cartão/);
  });
});

describe("aceite (11/10/2026): o que um corretor deixou para as telas", () => {
  it("o quadro da equipe mostra a origem da disputa, a nota do débito e o 'por que mudar' ao lado da nota da decisão", () => {
    render(
      <ContestacaoSite
        reservaId="r1"
        pagamento={pagamento}
        equipe={[
          equipe({
            notaDebito: "Painel do Mercado Pago mostra o débito menor (teste).",
            decisao: { linhas: [["Causa", "Fraude"]], nota: "nota da decisão (teste)", notaMudanca: "por que mudou (teste)", explicacao: "", textoParaProprietario: null },
          }),
        ]}
        operacao={[]}
        editarFinanceiro={false}
        defesa={false}
        hoje={HOJE}
      />,
    );
    const bloco = screen.getByRole("region", { name: /Disputa: Contestação no cartão/ });
    expect(within(bloco).getByText(/pode ser uma reclamação no Mercado Pago \(mediação\)/)).toBeTruthy();
    expect(within(bloco).getByText("Nota do débito (só a equipe)")).toBeTruthy();
    expect(within(bloco).getByText("Painel do Mercado Pago mostra o débito menor (teste).")).toBeTruthy();
    expect(within(bloco).getByText("nota da decisão (teste)")).toBeTruthy();
    expect(within(bloco).getByText("Por que a decisão mudou (só a equipe)")).toBeTruthy();
    expect(within(bloco).getByText("por que mudou (teste)")).toBeTruthy();
    // Registrada à mão: o texto da origem é o dela, uma vez só.
    cleanup();
    render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={[equipe({ origem: "equipe", registradaAMao: true, origemTexto: "Registrada à mão: o sistema confere pela leitura quando puder." })]} operacao={[]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    expect(screen.getAllByText("Registrada à mão: o sistema confere pela leitura quando puder.")).toHaveLength(1);
  });

  it("'Perdeu' que pede a liberação antes: o atalho leva a 'Registrar liberação' do pagamento, quando ela cabe", () => {
    const r: ResultadoNaTela = { ...resultado, proposta: { ...resultado.proposta, liquidoNaoEntrou: null }, liberacaoAntes: "Registre a liberação à mão antes (teste)." };
    const comLiberacao = { ...pagamento, acoes: { ...sem, registrarLiberacao: true } } as PagamentoDoPainel;
    render(<ContestacaoSite reservaId="r1" pagamento={comLiberacao} equipe={[equipe({}, { resultado: r })]} operacao={[]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    const form = screen.getByRole("form", { name: "Confirmar o resultado" });
    fireEvent.click(within(form).getByLabelText(/Perdeu/));
    expect(within(form).getByRole("link", { name: /Registrar liberação/ }).getAttribute("href")).toBe(`#registrar-liberacao-${pagamento.id}`);
    // Sem a ação no pagamento (o domínio não a aceitaria), o texto fica e o atalho não aparece.
    cleanup();
    render(<ContestacaoSite reservaId="r1" pagamento={pagamento} equipe={[equipe({}, { resultado: r })]} operacao={[]} editarFinanceiro={false} defesa={false} hoje={HOJE} />);
    const sem2 = screen.getByRole("form", { name: "Confirmar o resultado" });
    fireEvent.click(within(sem2).getByLabelText(/Perdeu/));
    expect(within(sem2).getByText("Registre a liberação à mão antes (teste).")).toBeTruthy();
    expect(within(sem2).queryByRole("link", { name: /Registrar liberação/ })).toBeNull();
  });
});
