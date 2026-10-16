import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERRO_DADOS_PESSOAIS } from "@/lib/dados-pessoais";
import type { Previa } from "./cancelamento";

const m = vi.hoisted(() => ({
  sessao: vi.fn(),
  revalidar: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  gate: vi.fn(),
  previa: vi.fn(),
  cancelar: vi.fn(),
  registrar: vi.fn(),
  descartar: vi.fn(),
  ota: vi.fn(),
  avisado: vi.fn(),
}));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({ banco: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("./oferta", () => ({ provedorDeConferencia: m.gate }));
vi.mock("./cancelamento", async (original) => ({
  ...(await original<typeof import("./cancelamento")>()),
  previaDoCancelamento: m.previa,
  cancelarReservaPaga: m.cancelar,
  registrarPedidoDeCancelamento: m.registrar,
  descartarPedidoDeCancelamento: m.descartar,
  marcarOtaLiberada: m.ota,
  marcarHospedeAvisado: m.avisado,
}));
import {
  calcularCancelamentoAcao,
  cancelarReservaPagaAcao,
  descartarPedidoCancelamentoAcao,
  marcarHospedeAvisadoAcao,
  marcarOtaLiberadaAcao,
  registrarPedidoCancelamentoAcao,
} from "./acoes-cancelamento";

const ID = "11111111-1111-4111-8111-111111111111";
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
const previa: Previa = {
  decisao: { calculado: "integral", base: "prazo", valorADevolver: 182400, integralAte: "2026-10-26", arrependimentoAte: "2026-10-08", entradaEm: new Date("2026-11-09T18:00:00Z"), comecou: false },
  direito: "integral",
  base: "prazo",
  rota: "pedida",
  valorPago: 182400,
  valorADevolver: 182400,
  valorRetido: 0,
  recebidoEm: new Date("2026-10-01T15:30:00Z"),
  canal: "whatsapp",
  politica: { versao: 1, data: "2026-09-20", diasReembolsoIntegral: 14, arrependimentoAteEntrada: true },
  componentes: { comissao: 27090, parteProprietario: 153504, taxa: 1806, jaRepassada: [], perdaDoProprietario: 0, ajustes: [] },
  leitura: { em: new Date("2026-10-01T15:06:00Z"), situacao: "aprovado", devolvidoLido: 0, emAndamento: false },
  descartados: [],
  avisos: ["Leitura do Mercado Pago de 01/10 às 12:06: aprovado."],
  assinatura: ASSINATURA,
  pergunta: "Cancelar a reserva SCL-TESTE1 e devolver ao hóspede R$ 1.824,00 (o valor integral pago) pelo Mercado Pago?",
};
const doHospede = { reservaId: ID, quemCancela: "hospede", recebidoData: "2026-10-01", recebidoHora: "12:30", canal: "whatsapp", nota: "WhatsApp da empresa, 12h30" };

beforeEach(() => {
  vi.clearAllMocks();
  sessao("admin");
  m.gate.mockResolvedValue({ ok: true, provedor, ambiente: "teste" });
});

describe("permissão (deny-by-default)", () => {
  it.each(["operacao", "proprietario", "limpeza", "hospede"])("%s não calcula nem cancela (pede reserva:editar e financeiro:editar)", async (papel) => {
    sessao(papel);
    await expect(calcularCancelamentoAcao({}, form(doHospede))).rejects.toThrow("Acesso negado");
    await expect(cancelarReservaPagaAcao({}, form({ ...doHospede, assinatura: ASSINATURA }))).rejects.toThrow("Acesso negado");
    expect(m.previa).not.toHaveBeenCalled();
    expect(m.cancelar).not.toHaveBeenCalled();
    expect(m.gate).not.toHaveBeenCalled();
  });

  it.each(["proprietario", "limpeza", "hospede"])("%s não registra, não descarta, não marca OTAs nem mensagem enviada", async (papel) => {
    sessao(papel);
    await expect(registrarPedidoCancelamentoAcao({}, form(doHospede))).rejects.toThrow("Acesso negado");
    await expect(descartarPedidoCancelamentoAcao({}, form({ reservaId: ID, motivo: "o hóspede mudou de ideia" }))).rejects.toThrow("Acesso negado");
    await expect(marcarOtaLiberadaAcao(form({ reservaId: ID }))).rejects.toThrow("Acesso negado");
    await expect(marcarHospedeAvisadoAcao(form({ reservaId: ID, qual: "pedido" }))).rejects.toThrow("Acesso negado");
    for (const fn of [m.registrar, m.descartar, m.ota, m.avisado]) expect(fn).not.toHaveBeenCalled();
  });

  it("operação (reserva:editar) registra e descarta o pedido; o domínio recebe que ela não tem o financeiro (o pedido do site ele recusa)", async () => {
    sessao("operacao");
    m.registrar.mockResolvedValue({ ok: true });
    await expect(registrarPedidoCancelamentoAcao({}, form(doHospede))).rejects.toThrow(`REDIRECT /painel/reservas/${ID}?cancelamento=pedido_registrado`);
    m.descartar.mockResolvedValue({ ok: false, erro: "Pedido feito pelo hóspede no site: só quem cuida do financeiro descarta, como desistência do hóspede." });
    expect(await descartarPedidoCancelamentoAcao({}, form({ reservaId: ID, motivo: "o hóspede mudou de ideia" }))).toMatchObject({
      mensagem: "Pedido feito pelo hóspede no site: só quem cuida do financeiro descarta, como desistência do hóspede.",
    });
    expect(m.descartar).toHaveBeenCalledWith({ banco: true }, "org", ID, { motivo: "o hóspede mudou de ideia", desistencia: undefined }, { id: "u", podeFinanceiro: false }, expect.any(Date));
  });
});

describe("calcular o cancelamento", () => {
  it("lê o formulário (momento em Brasília, listas fechadas, empresa da sessão), relê com o provedor de conferência e devolve a prévia em linhas", async () => {
    m.previa.mockResolvedValue({ ok: true, previa });
    const r = await calcularCancelamentoAcao({}, form(doHospede));
    expect(m.previa).toHaveBeenCalledWith(
      { banco: true },
      "org",
      ID,
      {
        recebidoEm: new Date("2026-10-01T15:30:00Z"),
        motivoMomento: "",
        canal: "whatsapp",
        quemCancela: "hospede",
        motivoEmpresa: null,
        decisao: "politica",
        motivoExcecao: null,
        motivoDecisao: "",
        nota: "WhatsApp da empresa, 12h30",
      },
      provedor,
      expect.any(Date),
    );
    expect(r.ok).toBe(true);
    expect(r.previa).toMatchObject({ assinatura: ASSINATURA, pergunta: previa.pergunta, resultado: "Pela política: devolução integral de R$ 1.824,00 — pedido dentro do prazo de reembolso integral." });
    expect(r.valores).toMatchObject({ recebidoHora: "12:30", canal: "whatsapp" });
    expect(r.valores).not.toHaveProperty("$ACTION_ID");
    expect(m.revalidar).toHaveBeenCalledWith("/painel", "layout");
  });

  it("M8.2d (D17): o valor que o painel do Mercado Pago mostra devolvido fora do sistema vai ao domínio em centavos, um por pagamento; inválido não chega lá", async () => {
    const P1 = "33333333-3333-4333-8333-333333333333";
    const P2 = "44444444-4444-4444-8444-444444444444";
    m.previa.mockResolvedValue({ ok: true, previa });
    await calcularCancelamentoAcao({}, form({ ...doHospede, [`valorFora:${P1}`]: "300,00", [`valorFora:${P2}`]: "5,00", "valorFora:nao-e-id": "1,00" }));
    expect(m.previa.mock.calls[0][3]).toMatchObject({ valoresForaInformados: { [P1]: 30000, [P2]: 500 } });
    expect(Object.keys(m.previa.mock.calls[0][3].valoresForaInformados)).toEqual([P1, P2]);
    m.previa.mockClear();
    await calcularCancelamentoAcao({}, form(doHospede));
    expect(m.previa.mock.calls[0][3]).not.toHaveProperty("valoresForaInformados");
    m.previa.mockClear();
    expect((await calcularCancelamentoAcao({}, form({ ...doHospede, [`valorFora:${P1}`]: "trezentos" }))).mensagem).toBe("Informe o valor que o painel do Mercado Pago mostra devolvido, em reais (ex.: 300,00).");
    expect(m.previa).not.toHaveBeenCalled();
    // A recusa traz os pagamentos que faltam (a tela mostra um campo para cada).
    const faltam = [{ pagamentoId: P2, rotulo: "Pix de 02/10 (R$ 400,00)" }];
    m.previa.mockResolvedValue({ ok: false, codigo: "devolvido_fora_sem_valor", erro: "falta", foraSemValor: faltam });
    expect(await calcularCancelamentoAcao({}, form(doHospede))).toMatchObject({ codigo: "devolvido_fora_sem_valor", foraSemValor: faltam });
  });

  it("sem provedor (oferta ou conta fora): calcula sem a releitura (o domínio decide o que exige a leitura)", async () => {
    m.gate.mockResolvedValue({ ok: false, motivo: "desligado", texto: "desligado" });
    m.previa.mockResolvedValue({ ok: false, codigo: "sem_leitura", erro: "Não deu para conferir o pagamento no Mercado Pago agora: tente de novo em instantes." });
    const r = await calcularCancelamentoAcao({}, form(doHospede));
    expect(m.previa.mock.calls[0][4]).toBeNull();
    expect(r).toMatchObject({ codigo: "sem_leitura", mensagem: expect.stringContaining("tente de novo"), valores: { recebidoData: "2026-10-01" } });
    expect(r.previa).toBeUndefined();
  });

  it("canal 'site' nunca vem do formulário; listas fora do lugar viram null; a exceção leva o motivo da lista e a nota", async () => {
    m.previa.mockResolvedValue({ ok: true, previa });
    await calcularCancelamentoAcao({}, form({ ...doHospede, canal: "site", decisao: "excecao", motivoExcecao: "cortesia_comercial", motivoDecisao: "cliente antigo", motivoEmpresa: "forca_maior" }));
    expect(m.previa.mock.calls[0][3]).toMatchObject({ canal: null, decisao: "excecao", motivoExcecao: "cortesia_comercial", motivoDecisao: "cliente antigo", motivoEmpresa: null });
    m.previa.mockClear();
    await calcularCancelamentoAcao({}, form({ reservaId: ID, quemCancela: "empresa", motivoEmpresa: "inventado", decisao: "politica", motivoDecisao: "fica de fora" }));
    expect(m.previa.mock.calls[0][3]).toMatchObject({ recebidoEm: null, quemCancela: "empresa", motivoEmpresa: null, motivoDecisao: "" });
  });

  it("recusa antes do domínio: reserva inválida, momento pela metade, quem cancela ou decisão fora da lista, nota com dado pessoal ou longa demais", async () => {
    expect(await calcularCancelamentoAcao({}, form({ ...doHospede, reservaId: "x' or 1=1" }))).toMatchObject({ mensagem: "Reserva não encontrada." });
    expect(await calcularCancelamentoAcao({}, form({ ...doHospede, recebidoHora: "" }))).toMatchObject({ mensagem: "Informe a data e a hora em que o pedido chegou." });
    expect(await calcularCancelamentoAcao({}, form({ ...doHospede, recebidoHora: "25:00" }))).toMatchObject({ mensagem: "Informe a data e a hora em que o pedido chegou." });
    for (const recebidoHora of ["15", "15:7", "3 da tarde"]) expect(await calcularCancelamentoAcao({}, form({ ...doHospede, recebidoHora })), recebidoHora).toMatchObject({ mensagem: "Informe a data e a hora em que o pedido chegou." });
    expect(await calcularCancelamentoAcao({}, form({ ...doHospede, quemCancela: "vizinho" }))).toMatchObject({ mensagem: "Escolha quem cancela." });
    expect(await calcularCancelamentoAcao({}, form({ ...doHospede, decisao: "metade" }))).toMatchObject({ mensagem: "Escolha a decisão." });
    expect(await calcularCancelamentoAcao({}, form({ ...doHospede, nota: "CPF 123.456.789-09" }))).toMatchObject({ mensagem: ERRO_DADOS_PESSOAIS, valores: { nota: "CPF 123.456.789-09" } });
    expect(await calcularCancelamentoAcao({}, form({ ...doHospede, motivoMomento: "ana@example.com" }))).toMatchObject({ mensagem: ERRO_DADOS_PESSOAIS });
    expect(await calcularCancelamentoAcao({}, form({ ...doHospede, nota: "x".repeat(301) }))).toMatchObject({ mensagem: "Cada nota tem até 300 caracteres." });
    expect(m.previa).not.toHaveBeenCalled();
  });

  it("a recusa do domínio volta com o código e o que a equipe pode escolher (a tela abre a exceção ou a escolha sem política aceita)", async () => {
    m.previa.mockResolvedValue({ ok: false, codigo: "decisao_obrigatoria", erro: "Este pagamento foi feito sem o aceite das páginas legais", escolha: "sem_politica" });
    expect(await calcularCancelamentoAcao({}, form(doHospede))).toMatchObject({ codigo: "decisao_obrigatoria", mensagem: "Este pagamento foi feito sem o aceite das páginas legais", escolha: "sem_politica" });
    // Saída antecipada (ou pagamento já devolvido no painel do Mercado Pago) sem devolução pela política: a exceção.
    m.previa.mockResolvedValue({ ok: false, codigo: "estadia_iniciada", erro: "O pedido chegou depois do início da estadia", escolha: "excecao" });
    expect(await calcularCancelamentoAcao({}, form(doHospede))).toMatchObject({ codigo: "estadia_iniciada", escolha: "excecao" });
    m.cancelar.mockResolvedValue({ ok: false, codigo: "decisao_obrigatoria", erro: "O Mercado Pago já mostra este pagamento devolvido por inteiro", escolha: "excecao" });
    expect(await cancelarReservaPagaAcao({}, form({ ...doHospede, assinatura: ASSINATURA }))).toMatchObject({ codigo: "decisao_obrigatoria", escolha: "excecao" });
    // Recusa de antes da decisão: sem a chave (a tela mantém a escolha que já mostrava).
    m.previa.mockResolvedValue({ ok: false, codigo: "dados", erro: "Escolha quem cancela." });
    expect(await calcularCancelamentoAcao({}, form(doHospede))).not.toHaveProperty("escolha");
  });
});

describe("cancelar a reserva", () => {
  it("assinatura obrigatória: sem ela (ou fora do formato), 'calcule de novo' e nada chega ao domínio", async () => {
    expect(await cancelarReservaPagaAcao({}, form(doHospede))).toMatchObject({ codigo: "previa_mudou", mensagem: expect.stringContaining("calcule de novo") });
    expect(await cancelarReservaPagaAcao({}, form({ ...doHospede, assinatura: "nao-e-hex" }))).toMatchObject({ codigo: "previa_mudou" });
    expect(m.cancelar).not.toHaveBeenCalled();
  });

  it("com a assinatura: autor e empresa da sessão, provedor de conferência; feito, volta para a ficha com o resultado (pela rota da prévia)", async () => {
    m.cancelar.mockResolvedValue({ ok: true, cancelamentoId: "c1", direito: "integral", devolucao: "pedida" });
    await expect(cancelarReservaPagaAcao({}, form({ ...doHospede, assinatura: ASSINATURA, rota: "pedida" }))).rejects.toThrow(`REDIRECT /painel/reservas/${ID}?cancelamento=pedida`);
    expect(m.cancelar).toHaveBeenCalledWith({ banco: true }, "org", ID, expect.objectContaining({ quemCancela: "hospede", canal: "whatsapp" }), "u", provedor, expect.any(Date), ASSINATURA);
    expect(m.revalidar).toHaveBeenCalledWith("/portal", "layout");
    m.cancelar.mockResolvedValue({ ok: true, cancelamentoId: "c1", direito: "integral", devolucao: "recusada" });
    await expect(cancelarReservaPagaAcao({}, form({ ...doHospede, assinatura: ASSINATURA, rota: "fora_do_prazo" }))).rejects.toThrow("?cancelamento=fora_do_prazo");
    m.cancelar.mockResolvedValue({ ok: true, cancelamentoId: "c1", direito: "nenhum", devolucao: null });
    await expect(cancelarReservaPagaAcao({}, form({ ...doHospede, assinatura: ASSINATURA, rota: "nenhuma" }))).rejects.toThrow("?cancelamento=retida");
  });

  it("recusa do domínio (ocupado, sem leitura, prévia mudou...): a mensagem e o código, e o que foi digitado volta", async () => {
    m.cancelar.mockResolvedValue({ ok: false, codigo: "ocupado", erro: "Muitas mudanças nesta reserva agora: tente de novo em instantes." });
    expect(await cancelarReservaPagaAcao({}, form({ ...doHospede, assinatura: ASSINATURA }))).toEqual({
      mensagem: "Muitas mudanças nesta reserva agora: tente de novo em instantes.",
      codigo: "ocupado",
      valores: expect.objectContaining({ nota: "WhatsApp da empresa, 12h30", assinatura: ASSINATURA }),
    });
    expect(m.redirect).not.toHaveBeenCalled();
  });
});

describe("pedido, descarte, OTAs e mensagem enviada", () => {
  it("registrar: data e hora obrigatórias, canal da lista (nunca o site), nota sem dado pessoal; recusa do domínio volta como veio", async () => {
    expect(await registrarPedidoCancelamentoAcao({}, form({ ...doHospede, recebidoData: "" }))).toMatchObject({ mensagem: "Informe a data e a hora em que o pedido chegou." });
    expect(await registrarPedidoCancelamentoAcao({}, form({ ...doHospede, canal: "site" }))).toMatchObject({ mensagem: "Escolha como o pedido chegou." });
    expect(await registrarPedidoCancelamentoAcao({}, form({ ...doHospede, nota: "ligar para (21) 99999-0000" }))).toMatchObject({ mensagem: ERRO_DADOS_PESSOAIS });
    expect(m.registrar).not.toHaveBeenCalled();
    m.registrar.mockResolvedValue({ ok: false, erro: "Já há um pedido registrado em 01/10 às 12:30." });
    expect(await registrarPedidoCancelamentoAcao({}, form(doHospede))).toMatchObject({ mensagem: "Já há um pedido registrado em 01/10 às 12:30." });
    expect(m.registrar).toHaveBeenCalledWith({ banco: true }, "org", ID, { recebidoEm: new Date("2026-10-01T15:30:00Z"), canal: "whatsapp", nota: "WhatsApp da empresa, 12h30" }, "u", expect.any(Date));
  });

  it("descartar: motivo obrigatório; a desistência (canal e hora) vai ao domínio; quem tem o financeiro pode descartar o do site", async () => {
    expect(await descartarPedidoCancelamentoAcao({}, form({ reservaId: ID, motivo: "" }))).toMatchObject({ mensagem: "Escreva o motivo (sem dados pessoais)." });
    expect(m.descartar).not.toHaveBeenCalled();
    m.descartar.mockResolvedValue({ ok: true });
    await expect(
      descartarPedidoCancelamentoAcao({}, form({ reservaId: ID, motivo: "disse que vem", desistenciaCanal: "whatsapp", desistenciaData: "2026-10-02", desistenciaHora: "09:00" })),
    ).rejects.toThrow(`REDIRECT /painel/reservas/${ID}?cancelamento=pedido_descartado`);
    expect(m.descartar).toHaveBeenCalledWith({ banco: true }, "org", ID, { motivo: "disse que vem", desistencia: { canal: "whatsapp", em: new Date("2026-10-02T12:00:00Z") } }, { id: "u", podeFinanceiro: true }, expect.any(Date));
    // "9:00" e "9h" (sem o zero, ou como se escrevia antes) são lidos "09:00" (M7.22).
    for (const desistenciaHora of ["9:00", "9h"]) {
      m.descartar.mockClear();
      await expect(
        descartarPedidoCancelamentoAcao({}, form({ reservaId: ID, motivo: "disse que vem", desistenciaCanal: "whatsapp", desistenciaData: "2026-10-02", desistenciaHora })),
      ).rejects.toThrow(`REDIRECT /painel/reservas/${ID}?cancelamento=pedido_descartado`);
      expect(m.descartar.mock.calls[0][3], desistenciaHora).toEqual({ motivo: "disse que vem", desistencia: { canal: "whatsapp", em: new Date("2026-10-02T12:00:00Z") } });
    }
  });

  it("OTAs e mensagem enviada: com a empresa e o autor da sessão; recusa volta para a ficha como aviso", async () => {
    m.ota.mockResolvedValue({ ok: true });
    await expect(marcarOtaLiberadaAcao(form({ reservaId: ID }))).rejects.toThrow(`REDIRECT /painel/reservas/${ID}?cancelamento=ota`);
    expect(m.ota).toHaveBeenCalledWith({ banco: true }, "org", ID, "u", expect.any(Date));
    m.ota.mockResolvedValue({ ok: false, erro: "As datas já foram marcadas como reabertas em 01/10." });
    await expect(marcarOtaLiberadaAcao(form({ reservaId: ID }))).rejects.toThrow(`REDIRECT /painel/reservas/${ID}?erro=${encodeURIComponent("As datas já foram marcadas como reabertas em 01/10.")}`);
    m.avisado.mockResolvedValue({ ok: true });
    await expect(marcarHospedeAvisadoAcao(form({ reservaId: ID, qual: "decisao" }))).rejects.toThrow(`REDIRECT /painel/reservas/${ID}?cancelamento=avisado`);
    expect(m.avisado).toHaveBeenCalledWith({ banco: true }, "org", ID, "decisao", "u", expect.any(Date));
    await expect(marcarHospedeAvisadoAcao(form({ reservaId: ID, qual: "outra" }))).rejects.toThrow("?erro=");
    await expect(marcarOtaLiberadaAcao(form({ reservaId: "x" }))).rejects.toThrow("REDIRECT /painel/reservas");
    expect(m.avisado).toHaveBeenCalledTimes(1);
  });
});
