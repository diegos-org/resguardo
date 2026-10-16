import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERRO_DADOS_PESSOAIS } from "@/lib/dados-pessoais";
import type { PreviaAlteracao } from "./alteracao";

const m = vi.hoisted(() => ({
  sessao: vi.fn(),
  revalidar: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  gate: vi.fn(),
  previa: vi.fn(),
  segurar: vi.fn(),
  previaAplicacao: vi.fn(),
  aplicar: vi.fn(),
  desistir: vi.fn(),
  ota: vi.fn(),
  avisado: vi.fn(),
  daAlteracao: vi.fn(),
  proposta: vi.fn(),
}));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({ banco: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("./oferta", () => ({ provedorDeConferencia: m.gate }));
vi.mock("./travas", () => ({ cotacaoDaAlteracao: m.daAlteracao }));
vi.mock("@/mensagens/hospede", () => ({ propostaDaPrevia: m.proposta }));
vi.mock("./alteracao", async (original) => ({
  ...(await original<typeof import("./alteracao")>()),
  previaDaAlteracao: m.previa,
  segurarAlteracao: m.segurar,
  previaDaAplicacao: m.previaAplicacao,
  aplicarAlteracaoPelaEquipe: m.aplicar,
  desistirDaAlteracao: m.desistir,
  marcarOtaAtualizada: m.ota,
  marcarHospedeAvisadoDaAlteracao: m.avisado,
}));
import {
  aplicarAlteracaoAcao,
  calcularAlteracaoAcao,
  desistirDaAlteracaoAcao,
  marcarHospedeAvisadoAlteracaoAcao,
  marcarOtaAtualizadaAcao,
  previaDaAplicacaoAcao,
  segurarAlteracaoAcao,
} from "./acoes-alteracao";

const RESERVA = "11111111-1111-4111-8111-111111111111";
const ALTERACAO = "33333333-3333-4333-8333-333333333333";
const provedor = { falso: true };
const ASSINATURA = "0123456789abcdef";
const form = (v: Record<string, string>) => {
  const f = new FormData();
  // A empresa nunca vem do formulário: um campo forjado é ignorado.
  f.set("organizacaoId", "outra-org");
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};
const sessao = (papel: string) => m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: [] });
const zero = { bruto: 0, taxa: 0, comissao: 0, parte: 0 };
/** Prévia de um aumento (exemplo A do desenho: 10/11→14/11 para 10/11→15/11, diferença R$ 400,00). */
const previa: PreviaAlteracao = {
  alteracaoId: null,
  reservaId: RESERVA,
  reservaCodigo: "SCL-TESTE1",
  antes: { checkin: "2026-11-10", checkout: "2026-11-14", hospedes: 2, valor: 150000 },
  depois: { checkin: "2026-11-10", checkout: "2026-11-15", hospedes: 2, valor: 190000 },
  cotacao: { diarias: 190000, limpeza: 0, hospedeExtra: 0, valorCheio: 190000, desconto: 0, total: 190000, situacao: "disponivel", leituraEm: "2026-10-01T14:00:00.000Z" },
  origemValor: "cotacao",
  motivoValor: null,
  diferenca: 40000,
  rumo: "aumento",
  valorNovo: 190000,
  quemPede: "hospede",
  noitesNovas: { inicio: "2026-11-14", fim: "2026-11-15" },
  holdMinutos: 60,
  holdAte: null,
  entradaDaPolitica: "2026-11-10",
  decisao: null,
  direito: null,
  base: null,
  escolha: null,
  valorADevolver: 0,
  politica: { versao: 1, data: "2026-09-20", diasReembolsoIntegral: 14, arrependimentoAteEntrada: true },
  partes: [],
  financeiro: { antes: { ...zero, bruto: 150000 }, depois: { ...zero, bruto: 190000 }, porMes: [{ mes: "2026-11", antes: { ...zero, bruto: 150000 }, depois: { ...zero, bruto: 190000 } }], taxaDevolvida: null, taxaDesconhecida: true },
  leitura: [],
  avisos: ["A taxa do pagamento da diferença fica conhecida depois do pagamento.", "Leitura do Mercado Pago de 01/10 às 12:06: aprovado."],
  assinatura: ASSINATURA,
  pergunta: "Segurar as novas datas (10/11 a 15/11, 5 noites, 2 pessoas) até 13:00 e liberar para o hóspede pagar a diferença de R$ 400,00 na página da reserva?",
};
const doHospede = { reservaId: RESERVA, checkin: "2026-11-10", checkout: "2026-11-15", hospedes: "2", quemPede: "hospede", recebidoData: "2026-10-01", recebidoHora: "12:30", canal: "whatsapp", origemValor: "cotacao", nota: "WhatsApp da empresa, 12h30" };

beforeEach(() => {
  vi.clearAllMocks();
  sessao("admin");
  m.gate.mockResolvedValue({ ok: true, provedor, ambiente: "teste" });
  m.daAlteracao.mockResolvedValue({ cotacaoId: "c", reservaId: RESERVA });
  m.proposta.mockResolvedValue({ texto: "Olá! Preparamos a alteração da sua reserva SCL-TESTE1: …", falta: [], textoBase: true });
});

describe("permissão (deny-by-default)", () => {
  it.each(["operacao", "proprietario", "limpeza", "hospede"])("%s não calcula, segura, aplica nem desiste (pede reserva:editar e financeiro:editar)", async (papel) => {
    sessao(papel);
    for (const f of [
      () => calcularAlteracaoAcao({}, form(doHospede)),
      () => segurarAlteracaoAcao({}, form({ ...doHospede, assinatura: ASSINATURA })),
      () => previaDaAplicacaoAcao({}, form({ alteracaoId: ALTERACAO })),
      () => aplicarAlteracaoAcao({}, form({ alteracaoId: ALTERACAO, assinatura: ASSINATURA })),
      () => desistirDaAlteracaoAcao({}, form({ alteracaoId: ALTERACAO, motivo: "o hóspede desistiu" })),
    ])
      await expect(f()).rejects.toThrow("Acesso negado");
    for (const fn of [m.gate, m.previa, m.segurar, m.previaAplicacao, m.aplicar, m.desistir, m.daAlteracao]) expect(fn).not.toHaveBeenCalled();
  });

  it.each(["proprietario", "limpeza", "hospede"])("%s também não marca as OTAs nem a mensagem enviada", async (papel) => {
    sessao(papel);
    await expect(marcarOtaAtualizadaAcao(form({ alteracaoId: ALTERACAO }))).rejects.toThrow("Acesso negado");
    await expect(marcarHospedeAvisadoAlteracaoAcao(form({ alteracaoId: ALTERACAO, qual: "proposta" }))).rejects.toThrow("Acesso negado");
    expect(m.ota).not.toHaveBeenCalled();
    expect(m.avisado).not.toHaveBeenCalled();
  });

  it("a operação (reserva:editar) marca o bloqueio mudado nas OTAs e a mensagem enviada (sem valores)", async () => {
    sessao("operacao");
    m.ota.mockResolvedValue({ ok: true });
    await expect(marcarOtaAtualizadaAcao(form({ alteracaoId: ALTERACAO }))).rejects.toThrow(`REDIRECT /painel/reservas/${RESERVA}?alteracao=ota`);
    expect(m.ota).toHaveBeenCalledWith({ banco: true }, "org", ALTERACAO, "u", expect.any(Date));
    m.avisado.mockResolvedValue({ ok: true });
    await expect(marcarHospedeAvisadoAlteracaoAcao(form({ alteracaoId: ALTERACAO, qual: "confirmacao" }))).rejects.toThrow(`REDIRECT /painel/reservas/${RESERVA}?alteracao=avisado`);
    expect(m.avisado).toHaveBeenCalledWith({ banco: true }, "org", ALTERACAO, "confirmacao", "u", expect.any(Date));
  });
});

describe("calcular a alteração", () => {
  it("lê o formulário (datas, pessoas, quem pede, o momento em Brasília, o canal, o valor), relê com o provedor de conferência e devolve a prévia em linhas com a proposta", async () => {
    m.previa.mockResolvedValue({ ok: true, previa });
    const r = await calcularAlteracaoAcao({}, form(doHospede));
    expect(m.previa).toHaveBeenCalledWith({ banco: true }, "org", RESERVA, expect.anything(), provedor, expect.any(Date));
    const e = m.previa.mock.calls[0][3];
    expect(e).toMatchObject({ checkin: "2026-11-10", checkout: "2026-11-15", hospedes: 2, quemPede: "hospede", canal: "whatsapp", valor: { origem: "cotacao" }, decisao: "politica", motivoEmpresa: null, nota: "WhatsApp da empresa, 12h30" });
    // 12:30 em Brasília = 15:30 UTC.
    expect(e.recebidoEm.toISOString()).toBe("2026-10-01T15:30:00.000Z");
    // A hora digitada como "9:30" ou "9h30" é lida "09:30" (M7.22).
    for (const recebidoHora of ["9:30", "9h30"]) {
      m.previa.mockClear();
      await calcularAlteracaoAcao({}, form({ ...doHospede, recebidoHora }));
      expect(m.previa.mock.calls[0][3].recebidoEm.toISOString(), recebidoHora).toBe("2026-10-01T12:30:00.000Z");
    }
    expect(r.ok).toBe(true);
    expect(r.previa?.assinatura).toBe(ASSINATURA);
    expect(r.previa?.rumo).toBe("aumento");
    expect(r.previa?.botao).toBe("Segurar as novas datas e liberar o pagamento da diferença");
    expect(r.previa?.perguntaSoSegurar).toBeNull();
    expect(r.previa?.diferenca).toBe("Diferença: o hóspede paga R$ 400,00 na página da reserva.");
    expect(r.previa?.leitura).toEqual(["Leitura do Mercado Pago de 01/10 às 12:06: aprovado."]);
    expect(r.previa?.proposta?.texto).toContain("Preparamos a alteração");
    expect(r.valores?.nota).toBe("WhatsApp da empresa, 12h30");
    expect(m.revalidar).toHaveBeenCalledWith("/painel", "layout");
  });

  it("a SCL propõe: o momento é o de agora (sem data no formulário) e o motivo da SCL é obrigatório; valor mantido ou digitado com o motivo e a nota", async () => {
    m.previa.mockResolvedValue({ ok: true, previa });
    const base = { reservaId: RESERVA, checkin: "2026-11-10", checkout: "2026-11-15", hospedes: "2", quemPede: "empresa" };
    expect(await calcularAlteracaoAcao({}, form({ ...base, origemValor: "mantido", motivoValor: "alteracao_pela_scl", motivoValorNota: "vazamento" }))).toEqual({
      mensagem: "Escolha o motivo da SCL.",
      valores: expect.any(Object),
    });
    expect(m.previa).not.toHaveBeenCalled();
    await calcularAlteracaoAcao({}, form({ ...base, motivoEmpresa: "imovel_sem_condicoes", origemValor: "mantido", motivoValor: "alteracao_pela_scl", motivoValorNota: "vazamento no banheiro" }));
    const e = m.previa.mock.calls[0][3];
    expect(e).toMatchObject({ quemPede: "empresa", motivoEmpresa: "imovel_sem_condicoes", canal: null, valor: { origem: "mantido", motivo: "alteracao_pela_scl", nota: "vazamento no banheiro" } });
    expect(Math.abs(e.recebidoEm.getTime() - Date.now())).toBeLessThan(60_000);
    m.previa.mockClear();
    await calcularAlteracaoAcao({}, form({ ...doHospede, origemValor: "digitado", valor: "1.900,00", motivoValor: "acordo_com_hospede", motivoValorNota: "combinado por WhatsApp" }));
    expect(m.previa.mock.calls[0][3].valor).toEqual({ origem: "digitado", valor: 190000, motivo: "acordo_com_hospede", nota: "combinado por WhatsApp" });
  });

  it("valida antes do domínio: datas, pessoas, momento, canal, motivo e nota do valor, valor digitado e dados pessoais nas notas", async () => {
    const casos: [Record<string, string>, string][] = [
      [{ ...doHospede, reservaId: "x" }, "Reserva não encontrada."],
      [{ ...doHospede, checkout: "2026-11-10" }, "Informe a nova entrada e a nova saída (a saída depois da entrada)."],
      [{ ...doHospede, hospedes: "0" }, "Informe quantas pessoas."],
      [{ ...doHospede, recebidoHora: "" }, "Informe a data e a hora em que o pedido chegou."],
      [{ ...doHospede, recebidoHora: "25:00" }, "Use o formato 15:00 (24 horas)."],
      [{ ...doHospede, recebidoHora: "15" }, "Use o formato 15:00 (24 horas)."],
      [{ ...doHospede, canal: "site" }, "Escolha como o pedido chegou."],
      [{ ...doHospede, origemValor: "mantido" }, "Escolha o motivo do valor."],
      [{ ...doHospede, origemValor: "mantido", motivoValor: "outro" }, "Escreva a nota do motivo do valor (obrigatória, sem dados pessoais)."],
      [{ ...doHospede, origemValor: "digitado", motivoValor: "outro", motivoValorNota: "x", valor: "zero" }, "Digite o valor novo em reais (ex.: 1.900,00)."],
      [{ ...doHospede, nota: "CPF 123.456.789-09" }, ERRO_DADOS_PESSOAIS],
      [{ ...doHospede, decisao: "excecao", motivoExcecao: "erro_da_scl", motivoDecisao: "fulano@exemplo.com" }, ERRO_DADOS_PESSOAIS],
    ];
    for (const [v, mensagem] of casos) expect((await calcularAlteracaoAcao({}, form(v))).mensagem).toBe(mensagem);
    expect(m.previa).not.toHaveBeenCalled();
    expect(m.gate).not.toHaveBeenCalled();
  });

  it("a recusa do domínio volta com o código, a escolha da equipe (na redução) e o que foi digitado", async () => {
    m.previa.mockResolvedValue({ ok: false, codigo: "decisao_obrigatoria", erro: "Escolha o que fazer e escreva o motivo.", escolha: "sem_politica" });
    const r = await calcularAlteracaoAcao({}, form(doHospede));
    expect(r).toEqual({ mensagem: "Escolha o que fazer e escreva o motivo.", codigo: "decisao_obrigatoria", escolha: "sem_politica", valores: expect.objectContaining({ checkin: "2026-11-10", canal: "whatsapp" }) });
    expect(r.valores?.organizacaoId).toBe("outra-org");
    m.previa.mockResolvedValue({ ok: false, codigo: "estadia_iniciada", erro: "A estadia já começou." });
    expect((await calcularAlteracaoAcao({}, form(doHospede))).escolha).toBeUndefined();
  });

  it("a proposta para copiar é montada da prévia (quem calcula lê o financeiro: ela leva valores)", async () => {
    m.previa.mockResolvedValue({ ok: true, previa });
    await calcularAlteracaoAcao({}, form(doHospede));
    expect(m.proposta).toHaveBeenCalledWith({ banco: true }, "org", RESERVA, expect.objectContaining({ rumo: "aumento", diferenca: 40000, entradaDosPrazos: "2026-11-10" }));
  });

  it("na redução, o fim do arrependimento da proposta conta da entrada alterada (a que vale daqui em diante)", async () => {
    const reducao = {
      ...previa,
      depois: { checkin: "2026-10-03", checkout: "2026-10-05", hospedes: 2, valor: 110000 },
      diferenca: -40000,
      rumo: "reducao" as const,
      valorNovo: 110000,
      direito: "integral" as const,
      base: "arrependimento" as const,
      decisao: { calculado: "integral", base: "arrependimento", valorADevolver: 40000, integralAte: "2026-10-27", arrependimentoAte: "2026-10-08", entradaEm: new Date("2026-11-10T17:00:00Z"), comecou: false },
    };
    m.previa.mockResolvedValue({ ok: true, previa: reducao });
    await calcularAlteracaoAcao({}, form({ ...doHospede, checkin: "2026-10-03", checkout: "2026-10-05" }));
    expect(m.proposta).toHaveBeenCalledWith(
      { banco: true },
      "org",
      RESERVA,
      expect.objectContaining({ reducao: { direito: "integral", base: "arrependimento", integralAte: "2026-10-27", arrependimentoAte: "2026-10-08", arrependimentoAteEntrada: true, entradaDaEstadia: "2026-10-03" } }),
    );
  });

  it("o prazo da proposta para copiar é o mesmo das datas seguradas: nunca depois do limite (a entrada), mesmo com o prazo da configuração maior", async () => {
    const limite = new Date(Date.now() + 10 * 60_000);
    m.previa.mockResolvedValue({ ok: true, previa: { ...previa, holdAte: null, holdMinutos: 60, limiteDoPrazo: limite } });
    await calcularAlteracaoAcao({}, form(doHospede));
    expect(m.proposta).toHaveBeenCalledWith({ banco: true }, "org", RESERVA, expect.objectContaining({ holdAte: limite }));
  });
});

describe("segurar e aplicar", () => {
  it("a assinatura da prévia é obrigatória: sem ela, nada chega ao domínio", async () => {
    expect(await segurarAlteracaoAcao({}, form(doHospede))).toEqual({ mensagem: expect.stringContaining("calcule de novo"), codigo: "previa_mudou", valores: expect.any(Object) });
    expect(await segurarAlteracaoAcao({}, form({ ...doHospede, assinatura: "nao-hex" }))).toMatchObject({ codigo: "previa_mudou" });
    expect(m.segurar).not.toHaveBeenCalled();
  });

  it("segura (aumento) e volta para a ficha com o resultado; sem aumento, `aplicar` aplica, e a rota da prévia escolhe o texto", async () => {
    m.segurar.mockResolvedValue({ ok: true, alteracaoId: ALTERACAO, situacao: "segurada", holdAte: new Date(), devolucoes: [] });
    await expect(segurarAlteracaoAcao({}, form({ ...doHospede, assinatura: ASSINATURA, rota: "aumento" }))).rejects.toThrow(`REDIRECT /painel/reservas/${RESERVA}?alteracao=segurada`);
    expect(m.segurar).toHaveBeenCalledWith({ banco: true }, "org", RESERVA, expect.objectContaining({ checkin: "2026-11-10" }), "u", provedor, expect.any(Date), ASSINATURA, { aplicar: false });
    m.segurar.mockResolvedValue({ ok: true, alteracaoId: ALTERACAO, situacao: "aplicada", holdAte: null, devolucoes: ["pedida"] });
    await expect(segurarAlteracaoAcao({}, form({ ...doHospede, assinatura: ASSINATURA, aplicar: "sim", rota: "liberacao" }))).rejects.toThrow("?alteracao=aplicada_liberacao");
    expect(m.segurar.mock.calls.at(-1)?.[8]).toEqual({ aplicar: true });
    await expect(segurarAlteracaoAcao({}, form({ ...doHospede, assinatura: ASSINATURA, aplicar: "sim", rota: "sem_devolucao" }))).rejects.toThrow("?alteracao=aplicada_sem_devolucao");
    await expect(segurarAlteracaoAcao({}, form({ ...doHospede, assinatura: ASSINATURA, aplicar: "sim", rota: "qualquer" }))).rejects.toThrow("?alteracao=aplicada");
  });

  it("a recusa do segurar volta como veio, com o que foi digitado", async () => {
    m.segurar.mockResolvedValue({ ok: false, codigo: "previa_mudou", erro: "O cálculo mudou desde a prévia." });
    expect(await segurarAlteracaoAcao({}, form({ ...doHospede, assinatura: ASSINATURA }))).toEqual({ mensagem: "O cálculo mudou desde a prévia.", codigo: "previa_mudou", valores: expect.objectContaining({ assinatura: ASSINATURA }) });
    expect(m.redirect).not.toHaveBeenCalled();
  });

  it("aplicar uma segurada: a prévia da aplicação e depois o aplicar, com a assinatura dela", async () => {
    m.previaAplicacao.mockResolvedValue({ ok: true, previa: { ...previa, alteracaoId: ALTERACAO, rumo: "igual", diferenca: 0, holdAte: new Date("2026-10-01T16:00:00Z"), pergunta: "Confirme que o hóspede aceitou por escrito…" } });
    const r = await previaDaAplicacaoAcao({}, form({ alteracaoId: ALTERACAO }));
    expect(m.previaAplicacao).toHaveBeenCalledWith({ banco: true }, "org", ALTERACAO, provedor, expect.any(Date));
    expect(r.previa).toMatchObject({ alteracaoId: ALTERACAO, botao: "Aplicar a alteração", perguntaSoSegurar: null, rota: "igual" });
    expect(await aplicarAlteracaoAcao({}, form({ alteracaoId: ALTERACAO }))).toMatchObject({ codigo: "previa_mudou" });
    expect(m.aplicar).not.toHaveBeenCalled();
    m.aplicar.mockResolvedValue({ ok: true, devolucoes: [] });
    await expect(aplicarAlteracaoAcao({}, form({ alteracaoId: ALTERACAO, assinatura: ASSINATURA, rota: "igual" }))).rejects.toThrow(`REDIRECT /painel/reservas/${RESERVA}?alteracao=aplicada`);
    expect(m.aplicar).toHaveBeenCalledWith({ banco: true }, "org", ALTERACAO, "u", provedor, expect.any(Date), ASSINATURA);
  });
});

describe("a alteração pelo id: só a da empresa da sessão", () => {
  it("de outra empresa (ou id inválido): \"Alteração não encontrada.\", sem ler o Mercado Pago e sem gravar", async () => {
    m.daAlteracao.mockResolvedValue(null);
    expect(await previaDaAplicacaoAcao({}, form({ alteracaoId: ALTERACAO }))).toEqual({ mensagem: "Alteração não encontrada.", valores: expect.any(Object) });
    expect(await aplicarAlteracaoAcao({}, form({ alteracaoId: ALTERACAO, assinatura: ASSINATURA }))).toEqual({ mensagem: "Alteração não encontrada.", valores: expect.any(Object) });
    expect(await desistirDaAlteracaoAcao({}, form({ alteracaoId: ALTERACAO, motivo: "o hóspede desistiu" }))).toEqual({ mensagem: "Alteração não encontrada.", valores: expect.any(Object) });
    await expect(marcarOtaAtualizadaAcao(form({ alteracaoId: ALTERACAO }))).rejects.toThrow("REDIRECT /painel/reservas");
    await expect(marcarHospedeAvisadoAlteracaoAcao(form({ alteracaoId: ALTERACAO, qual: "proposta" }))).rejects.toThrow("REDIRECT /painel/reservas");
    expect(m.daAlteracao).toHaveBeenCalledWith({ banco: true }, "org", ALTERACAO);
    m.daAlteracao.mockClear();
    expect((await previaDaAplicacaoAcao({}, form({ alteracaoId: "x' or 1=1" }))).mensagem).toBe("Alteração não encontrada.");
    expect(m.daAlteracao).not.toHaveBeenCalled();
    for (const fn of [m.gate, m.previaAplicacao, m.aplicar, m.desistir, m.ota, m.avisado]) expect(fn).not.toHaveBeenCalled();
  });
});

describe("desistir, OTAs e mensagem enviada", () => {
  it("desistir pede o motivo (sem dados pessoais) e volta para a ficha", async () => {
    expect((await desistirDaAlteracaoAcao({}, form({ alteracaoId: ALTERACAO, motivo: " " }))).mensagem).toBe("Escreva o motivo da desistência (sem dados pessoais).");
    expect((await desistirDaAlteracaoAcao({}, form({ alteracaoId: ALTERACAO, motivo: "ligar 21 99999-0000" }))).mensagem).toBe(ERRO_DADOS_PESSOAIS);
    expect(m.desistir).not.toHaveBeenCalled();
    m.desistir.mockResolvedValue({ ok: true });
    await expect(desistirDaAlteracaoAcao({}, form({ alteracaoId: ALTERACAO, motivo: "o hóspede desistiu" }))).rejects.toThrow(`REDIRECT /painel/reservas/${RESERVA}?alteracao=desistida`);
    expect(m.desistir).toHaveBeenCalledWith({ banco: true }, "org", ALTERACAO, "o hóspede desistiu", "u", provedor, expect.any(Date));
    m.desistir.mockResolvedValue({ ok: false, codigo: "em_andamento", erro: "Há um pagamento da diferença em andamento: espere ele terminar." });
    expect((await desistirDaAlteracaoAcao({}, form({ alteracaoId: ALTERACAO, motivo: "o hóspede desistiu" }))).codigo).toBe("em_andamento");
  });

  it("OTAs e mensagem enviada: a recusa do domínio volta para a ficha como erro; a mensagem só da lista", async () => {
    m.ota.mockResolvedValue({ ok: false, erro: "Só uma alteração aplicada muda o bloqueio nas OTAs." });
    await expect(marcarOtaAtualizadaAcao(form({ alteracaoId: ALTERACAO }))).rejects.toThrow(`?erro=${encodeURIComponent("Só uma alteração aplicada muda o bloqueio nas OTAs.")}`);
    await expect(marcarHospedeAvisadoAlteracaoAcao(form({ alteracaoId: ALTERACAO, qual: "pedido" }))).rejects.toThrow("?erro=");
    expect(m.avisado).not.toHaveBeenCalled();
  });
});
