/**
 * Disputa do pagamento no site (M8.2e) — as ações do quadro da disputa: sessão → permissão → validação → domínio (o domínio
 * é falso aqui; o de verdade tem os testes dele em PGlite). Item 9 de "Testes a escrever" (as permissões: só
 * `financeiro:editar`; o proprietário, que tem `financeiro:ler`, nunca passa; id de outra empresa = não encontrada, sem ler o
 * Mercado Pago e sem gravar nada) e o resultado pela chave fixa `?contestacao=`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERRO_DADOS_PESSOAIS } from "@/lib/dados-pessoais";
import { TEXTO_CONTESTACAO_PREVIA_MUDOU } from "./contestacao-regras";

const m = vi.hoisted(() => ({
  sessao: vi.fn(),
  revalidar: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  gate: vi.fn(),
  correio: vi.fn(() => null),
  reservaDaContestacao: vi.fn(),
  reservaDoPagamento: vi.fn(),
  reservaDaOrganizacao: vi.fn(),
  registrar: vi.fn(),
  debito: vi.fn(),
  decidir: vi.fn(),
  mudar: vi.fn(),
  atualizar: vi.fn(),
  outra: vi.fn(),
  documentos: vi.fn(),
  prazo: vi.fn(),
  resultado: vi.fn(),
  semEfeito: vi.fn(),
  aviso: vi.fn(),
  previaCancelar: vi.fn(),
  cancelar: vi.fn(),
}));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({ banco: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/email/correio", () => ({ correioDoAmbiente: m.correio }));
vi.mock("./oferta", () => ({ provedorDeConferencia: m.gate }));
vi.mock("./contestacao-tela", () => ({ reservaDaContestacao: m.reservaDaContestacao, reservaDoPagamento: m.reservaDoPagamento, reservaDaOrganizacao: m.reservaDaOrganizacao }));
vi.mock("./contestacao", () => ({
  registrarContestacaoDaEquipe: m.registrar,
  confirmarDebito: m.debito,
  registrarDecisao: m.decidir,
  mudarDecisao: m.mudar,
  atualizarValorSegurado: m.atualizar,
  confirmarOutraDisputa: m.outra,
  marcarDocumentosEnviados: m.documentos,
  informarPrazoDocumentos: m.prazo,
  confirmarResultado: m.resultado,
  encerrarSemEfeito: m.semEfeito,
  conferirAviso: m.aviso,
}));
vi.mock("./cancelamento", async (original) => ({
  ...(await original<typeof import("./cancelamento")>()),
  previaDoCancelamentoContestado: m.previaCancelar,
  cancelarReservaContestada: m.cancelar,
}));
import {
  atualizarValorSeguradoAcao,
  cancelarReservaContestadaAcao,
  conferirAvisoAcao,
  confirmarDebitoAcao,
  confirmarOutraDisputaAcao,
  confirmarResultadoAcao,
  encerrarSemEfeitoAcao,
  informarPrazoAcao,
  marcarDocumentosEnviadosAcao,
  mudarDecisaoAcao,
  previaDoCancelamentoContestadoAcao,
  registrarDecisaoAcao,
  registrarDisputaAcao,
} from "./acoes-contestacao";

const CONTESTACAO = "33333333-3333-4333-8333-333333333333";
const PAGAMENTO = "11111111-1111-4111-8111-111111111111";
const RESERVA = "22222222-2222-4222-8222-222222222222";
const ASSINATURA = "0123456789abcdef";
const provedor = { falso: true };
const form = (v: Record<string, string>) => {
  const f = new FormData();
  // A empresa nunca vem do formulário: um campo forjado é ignorado.
  f.set("organizacaoId", "outra-org");
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};
const sessao = (papel: string) => m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: [] });
const decisao = { contestacaoId: CONTESTACAO, causa: "imovel", quemArca: "proporcional", nota: "Hóspede relatou o ar-condicionado parado.", explicacao: "", versao: "0", assinatura: ASSINATURA };
const dominio = [m.registrar, m.debito, m.decidir, m.mudar, m.atualizar, m.outra, m.documentos, m.prazo, m.resultado, m.semEfeito, m.aviso, m.previaCancelar, m.cancelar];

/** Todas as ações que pedem `financeiro:editar`, com um formulário válido. */
const financeiras: [string, () => Promise<unknown>][] = [
  ["registrar a disputa", () => registrarDisputaAcao({}, form({ pagamentoId: PAGAMENTO, tipo: "chargeback", abertaEm: "2026-10-05", valor: "1.824,00", nota: "Vista no painel do Mercado Pago." }))],
  ["confirmar o débito", () => confirmarDebitoAcao({}, form({ contestacaoId: CONTESTACAO, data: "2026-10-06", valor: "1.824,00" }))],
  ["registrar quem arca", () => registrarDecisaoAcao({}, form(decisao))],
  ["mudar quem arca", () => mudarDecisaoAcao({}, form({ ...decisao, versao: "1" }))],
  ["atualizar o valor segurado", () => atualizarValorSeguradoAcao({}, form({ contestacaoId: CONTESTACAO, versao: "1", assinatura: ASSINATURA }))],
  ["confirmar que é outra disputa", () => confirmarOutraDisputaAcao({}, form({ contestacaoId: CONTESTACAO }))],
  ["informar o prazo", () => informarPrazoAcao({}, form({ contestacaoId: CONTESTACAO, prazo: "2026-10-20" }))],
  ["confirmar o resultado", () => confirmarResultadoAcao({}, form({ contestacaoId: CONTESTACAO, resultado: "ganha", data: "2026-10-10", versao: "0", assinatura: ASSINATURA }))],
  ["encerrar sem efeito", () => encerrarSemEfeitoAcao({}, form({ contestacaoId: CONTESTACAO, nota: "Registrada por engano." }))],
  ["conferir o aviso", () => conferirAvisoAcao({}, form({ contestacaoId: CONTESTACAO, como: "continua_encerrada", nota: "Painel mostra encerrada." }))],
];

beforeEach(() => {
  vi.clearAllMocks();
  sessao("admin");
  m.gate.mockResolvedValue({ ok: true, provedor, ambiente: "teste" });
  m.reservaDaContestacao.mockResolvedValue({ reservaId: RESERVA, pagamentoId: PAGAMENTO });
  m.reservaDoPagamento.mockResolvedValue({ reservaId: RESERVA });
  m.reservaDaOrganizacao.mockResolvedValue({ reservaId: RESERVA });
  for (const f of dominio) f.mockResolvedValue({ ok: true, contestacaoId: CONTESTACAO });
});

describe("permissão (deny-by-default; item 9)", () => {
  it.each(["operacao", "proprietario", "limpeza", "hospede"])("%s não faz nenhuma ação do financeiro da disputa (pede financeiro:editar)", async (papel) => {
    sessao(papel);
    for (const [, acao] of financeiras) await expect(acao()).rejects.toThrow("Acesso negado");
    for (const f of dominio) expect(f).not.toHaveBeenCalled();
    expect(m.gate).not.toHaveBeenCalled();
    expect(m.reservaDaContestacao).not.toHaveBeenCalled();
  });

  it("o proprietário (que tem financeiro:ler) também não marca documentos nem cancela a reserva contestada", async () => {
    sessao("proprietario");
    await expect(marcarDocumentosEnviadosAcao({}, form({ contestacaoId: CONTESTACAO, data: "2026-10-06" }))).rejects.toThrow("Acesso negado");
    await expect(previaDoCancelamentoContestadoAcao({}, form({ reservaId: RESERVA }))).rejects.toThrow("Acesso negado");
    await expect(cancelarReservaContestadaAcao({}, form({ reservaId: RESERVA, nota: "x", assinatura: ASSINATURA }))).rejects.toThrow("Acesso negado");
    for (const f of dominio) expect(f).not.toHaveBeenCalled();
  });

  it("a operação (reserva:editar) marca os documentos enviados; não cancela a reserva contestada (pede também o financeiro)", async () => {
    sessao("operacao");
    await expect(marcarDocumentosEnviadosAcao({}, form({ contestacaoId: CONTESTACAO, data: "2026-10-06" }))).rejects.toThrow(`REDIRECT /painel/reservas/${RESERVA}?contestacao=documentos`);
    expect(m.documentos).toHaveBeenCalledWith({ banco: true }, "org", CONTESTACAO, { data: "2026-10-06" }, "u", expect.any(Date));
    await expect(previaDoCancelamentoContestadoAcao({}, form({ reservaId: RESERVA }))).rejects.toThrow("Acesso negado");
    expect(m.previaCancelar).not.toHaveBeenCalled();
    for (const papel of ["limpeza", "hospede"]) {
      sessao(papel);
      await expect(marcarDocumentosEnviadosAcao({}, form({ contestacaoId: CONTESTACAO, data: "2026-10-06" }))).rejects.toThrow("Acesso negado");
    }
  });

  it("disputa ou pagamento de outra empresa (ou id malformado): 'não encontrada', sem ler o Mercado Pago e sem chamar o domínio", async () => {
    m.reservaDaContestacao.mockResolvedValue(null);
    m.reservaDoPagamento.mockResolvedValue(null);
    for (const [nome, acao] of financeiras) {
      const r = (await acao()) as { mensagem?: string };
      expect(r.mensagem, nome).toMatch(/não encontrad[ao]\./);
    }
    expect(await marcarDocumentosEnviadosAcao({}, form({ contestacaoId: "x' or 1=1", data: "2026-10-06" }))).toMatchObject({ mensagem: "Disputa não encontrada." });
    for (const f of dominio) expect(f).not.toHaveBeenCalled();
    expect(m.gate).not.toHaveBeenCalled();
    // A empresa vem só da sessão.
    expect(m.reservaDaContestacao).toHaveBeenCalledWith({ banco: true }, "org", CONTESTACAO);
    expect(m.reservaDoPagamento).toHaveBeenCalledWith({ banco: true }, "org", PAGAMENTO);
  });
});

describe("validação antes do domínio e o resultado pela chave fixa", () => {
  it("registrar: reais em centavos, o provedor de conferência e o correio vão ao domínio; feito, volta com ?contestacao=registrada (ou _duplicata)", async () => {
    await expect(registrarDisputaAcao({}, form({ pagamentoId: PAGAMENTO, tipo: "med", abertaEm: "2026-10-05", valor: "1.824,00", prazo: "2026-10-20", idCaso: "123", nota: "Vista no painel." }))).rejects.toThrow(
      `REDIRECT /painel/reservas/${RESERVA}?contestacao=registrada`,
    );
    expect(m.registrar).toHaveBeenCalledWith({ banco: true }, "org", PAGAMENTO, { tipo: "med", abertaEm: "2026-10-05", valor: 182400, prazo: "2026-10-20", idCaso: "123", nota: "Vista no painel." }, "u", provedor, expect.any(Date), { correio: null });
    m.registrar.mockResolvedValue({ ok: true, contestacaoId: CONTESTACAO, mensagem: "Registrada como possível duplicata…" });
    await expect(registrarDisputaAcao({}, form({ pagamentoId: PAGAMENTO, tipo: "chargeback", abertaEm: "2026-10-05", valor: "100", nota: "Vista." }))).rejects.toThrow("?contestacao=registrada_duplicata");
    expect(m.revalidar).toHaveBeenCalled();
  });

  it("registrar: sem o provedor (trava fechada) o domínio segue sem leitura; a recusa volta com o que foi digitado", async () => {
    m.gate.mockResolvedValue({ ok: false, texto: "fechado" });
    m.registrar.mockResolvedValue({ ok: false, erro: "O Mercado Pago já mostra esta disputa: ela está no quadro." });
    const r = await registrarDisputaAcao({}, form({ pagamentoId: PAGAMENTO, tipo: "chargeback", abertaEm: "2026-10-05", valor: "100", nota: "Vista." }));
    expect(r).toMatchObject({ mensagem: "O Mercado Pago já mostra esta disputa: ela está no quadro.", valores: { tipo: "chargeback", valor: "100" } });
    expect(m.registrar.mock.calls[0][5]).toBeNull();
  });

  it("notas com dado pessoal, número do caso com letras, valor ilegível e data inválida param antes do domínio", async () => {
    const casos: [() => Promise<{ mensagem?: string }>, string][] = [
      [() => registrarDisputaAcao({}, form({ pagamentoId: PAGAMENTO, tipo: "chargeback", abertaEm: "2026-10-05", valor: "100", nota: "ligar para visitante@example.com" })), ERRO_DADOS_PESSOAIS],
      [() => registrarDisputaAcao({}, form({ pagamentoId: PAGAMENTO, tipo: "chargeback", abertaEm: "2026-10-05", valor: "100", idCaso: "CBK123", nota: "x" })), "O número do caso tem só algarismos (até 20)."],
      [() => registrarDisputaAcao({}, form({ pagamentoId: PAGAMENTO, tipo: "chargeback", abertaEm: "2026-10-05", valor: "abc", nota: "x" })), "Informe o valor em disputa em reais (ex.: 1.824,00)."],
      [() => confirmarDebitoAcao({}, form({ contestacaoId: CONTESTACAO, data: "2026-02-31", valor: "10" })), "Informe o dia em que o Mercado Pago debitou."],
      [() => registrarDecisaoAcao({}, form({ ...decisao, nota: "CPF 123.456.789-09" })), ERRO_DADOS_PESSOAIS],
      [() => registrarDecisaoAcao({}, form({ ...decisao, explicacao: "fale no (21) 99999-0000" })), ERRO_DADOS_PESSOAIS],
      [() => registrarDecisaoAcao({}, form({ ...decisao, causa: "" })), "Escolha a causa da disputa."],
      [() => registrarDecisaoAcao({}, form({ ...decisao, quemArca: "" })), "Escolha quem arca."],
      [() => registrarDecisaoAcao({}, form({ ...decisao, nota: "" })), "Escreva a nota da decisão (sem dados pessoais)."],
      [() => confirmarResultadoAcao({}, form({ contestacaoId: CONTESTACAO, resultado: "", data: "2026-10-10", versao: "0", assinatura: ASSINATURA })), "Escolha o resultado: Ganhou ou Perdeu."],
      [() => confirmarResultadoAcao({}, form({ contestacaoId: CONTESTACAO, resultado: "perdida", data: "2026-10-10", versao: "0", assinatura: ASSINATURA })), "Informe o valor que a SCL perdeu, em reais."],
      [() => encerrarSemEfeitoAcao({}, form({ contestacaoId: CONTESTACAO, nota: "" })), "Escreva por que a disputa fica sem efeito (sem dados pessoais)."],
      [() => conferirAvisoAcao({}, form({ contestacaoId: CONTESTACAO, como: "outro", nota: "x" })), "Escolha o que o painel do Mercado Pago mostra."],
    ];
    for (const [acao, mensagem] of casos) expect((await acao()).mensagem).toBe(mensagem);
    for (const f of dominio) expect(f).not.toHaveBeenCalled();
  });

  it("assinatura malformada da prévia = 'os valores mudaram' (contestacao_previa_mudou), sem chamar o domínio", async () => {
    expect(await registrarDecisaoAcao({}, form({ ...decisao, assinatura: "x" }))).toMatchObject({ mensagem: TEXTO_CONTESTACAO_PREVIA_MUDOU, codigo: "contestacao_previa_mudou" });
    expect(await confirmarResultadoAcao({}, form({ contestacaoId: CONTESTACAO, resultado: "ganha", data: "2026-10-10", versao: "0", assinatura: "" }))).toMatchObject({ codigo: "contestacao_previa_mudou" });
    expect(await atualizarValorSeguradoAcao({}, form({ contestacaoId: CONTESTACAO, versao: "1", assinatura: "zz" }))).toMatchObject({ codigo: "contestacao_previa_mudou" });
    expect(m.decidir).not.toHaveBeenCalled();
    expect(m.resultado).not.toHaveBeenCalled();
    expect(m.atualizar).not.toHaveBeenCalled();
  });

  it("decisão: a entrada vai inteira ao domínio; feita, ?contestacao=decisao (na perdida, decisao_definitiva); mudar = decisao_mudada", async () => {
    await expect(registrarDecisaoAcao({}, form(decisao))).rejects.toThrow("?contestacao=decisao");
    expect(m.decidir).toHaveBeenCalledWith({ banco: true }, "org", CONTESTACAO, { causa: "imovel", quemArca: "proporcional", nota: decisao.nota, explicacao: "", versao: 0, assinatura: ASSINATURA }, "u", expect.any(Date));
    await expect(registrarDecisaoAcao({}, form({ ...decisao, perdida: "sim" }))).rejects.toThrow("?contestacao=decisao_definitiva");
    await expect(mudarDecisaoAcao({}, form({ ...decisao, versao: "1" }))).rejects.toThrow("?contestacao=decisao_mudada");
    // A recusa do domínio volta com o código e o que foi digitado.
    m.decidir.mockResolvedValue({ ok: false, erro: "A decisão mudou desde que você abriu a tela: confira de novo.", codigo: "decisao_mudou" });
    expect(await registrarDecisaoAcao({}, form(decisao))).toMatchObject({ codigo: "decisao_mudou", valores: { causa: "imovel" } });
  });

  it("resultado: Ganhou com a liberação ali mesmo; Perdeu com o valor perdido, o que não entrou e o dia do débito; a nota reforçada", async () => {
    await expect(
      confirmarResultadoAcao({}, form({ contestacaoId: CONTESTACAO, resultado: "ganha", data: "2026-10-10", versao: "1", assinatura: ASSINATURA, liberacaoData: "2026-10-09", liberacaoLiquido: "1.805,76", tarifa: "15,00", notaReforcada: "sim", nota: "Painel mostra ganha." })),
    ).rejects.toThrow("?contestacao=ganha");
    expect(m.resultado.mock.calls[0][3]).toEqual({ resultado: "ganha", data: "2026-10-10", nota: "Painel mostra ganha.", notaReforcada: true, versao: 1, assinatura: ASSINATURA, tarifa: 1500, voltaEm: null, liberacao: { data: "2026-10-09", liquido: 180576 } });
    expect(m.resultado.mock.calls[0][5]).toBe(provedor);
    await expect(confirmarResultadoAcao({}, form({ contestacaoId: CONTESTACAO, resultado: "perdida", data: "2026-10-10", versao: "1", assinatura: ASSINATURA, valorPerdido: "1.000,00", debitoEm: "2026-10-08" }))).rejects.toThrow(
      "?contestacao=perdida",
    );
    // O "nunca entrou na conta" em branco vai como null: o domínio recusa (avisar em vez de supor que entrou tudo).
    expect(m.resultado.mock.calls[1][3]).toEqual({ resultado: "perdida", data: "2026-10-10", nota: "", notaReforcada: false, versao: 1, assinatura: ASSINATURA, tarifa: null, valorPerdido: 100000, liquidoNaoEntrou: null, debitoEm: "2026-10-08" });
    // Só uma das duas da liberação: recusa.
    expect((await confirmarResultadoAcao({}, form({ contestacaoId: CONTESTACAO, resultado: "ganha", data: "2026-10-10", versao: "1", assinatura: ASSINATURA, liberacaoData: "2026-10-09" }))).mensagem).toContain("liberação");
  });

  it("as outras ações: cada uma com a sua chave (débito, outra disputa, prazo, sem efeito, conferir o aviso e reabrir)", async () => {
    await expect(confirmarDebitoAcao({}, form({ contestacaoId: CONTESTACAO, data: "2026-10-06", valor: "1.000,00", nota: "" }))).rejects.toThrow("?contestacao=debito");
    expect(m.debito).toHaveBeenCalledWith({ banco: true }, "org", CONTESTACAO, { data: "2026-10-06", valor: 100000, nota: "" }, "u", expect.any(Date));
    await expect(confirmarOutraDisputaAcao({}, form({ contestacaoId: CONTESTACAO }))).rejects.toThrow("?contestacao=outra_disputa");
    await expect(informarPrazoAcao({}, form({ contestacaoId: CONTESTACAO, prazo: "2026-10-20" }))).rejects.toThrow("?contestacao=prazo");
    await expect(encerrarSemEfeitoAcao({}, form({ contestacaoId: CONTESTACAO, nota: "Engano.", voltaEm: "2026-10-09" }))).rejects.toThrow("?contestacao=sem_efeito");
    expect(m.semEfeito).toHaveBeenCalledWith({ banco: true }, "org", CONTESTACAO, { nota: "Engano.", notaReforcada: false, voltaEm: "2026-10-09" }, "u", provedor, expect.any(Date));
    await expect(conferirAvisoAcao({}, form({ contestacaoId: CONTESTACAO, como: "continua_encerrada", nota: "Encerrada." }))).rejects.toThrow("?contestacao=aviso_conferido");
    await expect(conferirAvisoAcao({}, form({ contestacaoId: CONTESTACAO, como: "reaberta", nota: "Reapresentação." }))).rejects.toThrow("?contestacao=reaberta");
  });

  it("cancelar a reserva contestada: a prévia (sem gravar) e o cancelar com a assinatura e a nota; feito, ?contestacao=cancelada", async () => {
    m.previaCancelar.mockResolvedValue({ ok: true, previa: { valorPago: 182400, valorRetido: 182400, disputas: [], avisos: [], assinatura: ASSINATURA, pergunta: "Cancelar a reserva SCL-TESTE1 sem devolução pelo sistema?" } });
    expect(await previaDoCancelamentoContestadoAcao({}, form({ reservaId: RESERVA }))).toMatchObject({ ok: true, previa: { valorRetido: 182400, assinatura: ASSINATURA } });
    expect(await cancelarReservaContestadaAcao({}, form({ reservaId: RESERVA, nota: "", assinatura: ASSINATURA }))).toMatchObject({ mensagem: "Escreva por que cancelar a reserva contestada (obrigatória, sem dados pessoais)." });
    expect(await cancelarReservaContestadaAcao({}, form({ reservaId: RESERVA, nota: "Titular não reconhece.", assinatura: "x" }))).toMatchObject({ codigo: "previa_mudou" });
    expect(m.cancelar).not.toHaveBeenCalled();
    m.cancelar.mockResolvedValue({ ok: true, cancelamentoId: "c1", valorRetido: 182400 });
    await expect(cancelarReservaContestadaAcao({}, form({ reservaId: RESERVA, nota: "Titular não reconhece.", assinatura: ASSINATURA }))).rejects.toThrow(`REDIRECT /painel/reservas/${RESERVA}?contestacao=cancelada`);
    expect(m.cancelar).toHaveBeenCalledWith({ banco: true }, "org", RESERVA, { nota: "Titular não reconhece.", assinatura: ASSINATURA }, "u", provedor, expect.any(Date));
  });
});

describe("revisão das telas (11/10/2026)", () => {
  it("Perdeu: 'quanto nunca entrou na conta' em branco não vira zero; digitado, vai em centavos", async () => {
    await expect(confirmarResultadoAcao({}, form({ contestacaoId: CONTESTACAO, resultado: "perdida", data: "2026-10-10", versao: "1", assinatura: ASSINATURA, valorPerdido: "1.000,00", liquidoNaoEntrou: "" }))).rejects.toThrow("?contestacao=perdida");
    expect(m.resultado.mock.calls[0][3]).toMatchObject({ valorPerdido: 100000, liquidoNaoEntrou: null });
    await expect(confirmarResultadoAcao({}, form({ contestacaoId: CONTESTACAO, resultado: "perdida", data: "2026-10-10", versao: "1", assinatura: ASSINATURA, valorPerdido: "1.000,00", liquidoNaoEntrou: "39,80" }))).rejects.toThrow("?contestacao=perdida");
    expect(m.resultado.mock.calls[1][3]).toMatchObject({ liquidoNaoEntrou: 3980 });
    // A recusa do domínio volta com o código (o formulário mostra a caixa da nota reforçada por ele).
    m.resultado.mockResolvedValue({ ok: false, erro: "O Mercado Pago ainda mostra esta disputa em andamento.", codigo: "nota_reforcada" });
    expect(await confirmarResultadoAcao({}, form({ contestacaoId: CONTESTACAO, resultado: "ganha", data: "2026-10-10", versao: "1", assinatura: ASSINATURA }))).toMatchObject({ codigo: "nota_reforcada" });
    m.semEfeito.mockResolvedValue({ ok: false, erro: "O Mercado Pago ainda mostra esta disputa em andamento.", codigo: "nota_reforcada" });
    expect(await encerrarSemEfeitoAcao({}, form({ contestacaoId: CONTESTACAO, nota: "Engano." }))).toMatchObject({ codigo: "nota_reforcada" });
  });

  it("cancelar a reserva contestada: a reserva é resolvida na empresa da sessão antes de ler o Mercado Pago (de outra empresa: 'não encontrada', sem chamada)", async () => {
    m.reservaDaOrganizacao.mockResolvedValue(null);
    expect(await cancelarReservaContestadaAcao({}, form({ reservaId: RESERVA, nota: "Titular não reconhece.", assinatura: ASSINATURA }))).toMatchObject({ mensagem: "Reserva não encontrada." });
    expect(m.reservaDaOrganizacao).toHaveBeenCalledWith({ banco: true }, "org", RESERVA);
    expect(m.gate).not.toHaveBeenCalled();
    expect(m.cancelar).not.toHaveBeenCalled();
    expect(await previaDoCancelamentoContestadoAcao({}, form({ reservaId: RESERVA }))).toMatchObject({ mensagem: "Reserva não encontrada." });
    expect(m.previaCancelar).not.toHaveBeenCalled();
  });
});
