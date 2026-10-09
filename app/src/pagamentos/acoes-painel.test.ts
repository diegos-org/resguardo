import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErroProvedor } from "./provedor";

const m = vi.hoisted(() => ({
  sessao: vi.fn(),
  revalidar: vi.fn(),
  gate: vi.fn(),
  conferir: vi.fn(),
  pendentes: vi.fn(),
  devolver: vi.fn(),
  porFora: vi.fn(),
  taxa: vi.fn(),
  liberar: vi.fn(),
  estornar: vi.fn(),
  salvar: vi.fn(),
}));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({ banco: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("./oferta", () => ({ provedorDeConferencia: m.gate }));
vi.mock("./conferencia", () => ({ conferirTentativa: m.conferir }));
vi.mock("./rotina", () => ({ conferirPendentes: m.pendentes }));
vi.mock("./devolucao", () => ({ devolverPeloProvedor: m.devolver, registrarDevolucaoPorFora: m.porFora, registrarTaxaPerdida: m.taxa }));
vi.mock("./liberacao", () => ({ registrarLiberacaoManual: m.liberar, estornarLiberacaoManual: m.estornar }));
vi.mock("@/configuracoes/pagamento-site", async (original) => ({ ...(await original<typeof import("@/configuracoes/pagamento-site")>()), salvarConfigPagamentoSite: m.salvar }));
import { conferirAgoraAcao, devolucaoPorForaAcao, devolverAcao, estornarLiberacaoAcao, registrarLiberacaoAcao, registrarTaxaPerdidaAcao, salvarConfigPagamentoSiteAcao } from "./acoes-painel";

const ID = "11111111-1111-4111-8111-111111111111";
const provedor = { falso: true };
const form = (v: Record<string, string>) => {
  const f = new FormData();
  // A empresa nunca vem do formulário: um campo forjado é ignorado.
  f.set("organizacaoId", "outra-org");
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const amanha = () => new Date(Date.parse(`${hoje()}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  vi.resetAllMocks();
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.gate.mockResolvedValue({ ok: true, provedor, ambiente: "teste" });
});

describe("permissão (deny-by-default)", () => {
  const todas = [
    () => conferirAgoraAcao({}, form({ pagamentoId: ID })),
    () => conferirAgoraAcao({}, form({})),
    () => devolverAcao({}, form({ pagamentoId: ID })),
    () => devolucaoPorForaAcao({}, form({ pagamentoId: ID, data: hoje(), valor: "10,00" })),
    () => registrarLiberacaoAcao({}, form({ pagamentoId: ID, data: hoje(), liquido: "10,00" })),
    () => estornarLiberacaoAcao({}, form({ pagamentoId: ID, motivo: "erro" })),
    () => registrarTaxaPerdidaAcao({}, form({ pagamentoId: ID, valor: "18,06" })),
    () => salvarConfigPagamentoSiteAcao({}, form({ oferecer: "on" })),
  ];
  it.each(["operacao", "proprietario", "limpeza", "hospede"])("%s não executa nenhuma ação de dinheiro", async (papel) => {
    m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: [] });
    for (const f of todas) await expect(f()).rejects.toThrow("Acesso negado");
    for (const fn of [m.gate, m.conferir, m.pendentes, m.devolver, m.porFora, m.taxa, m.liberar, m.estornar, m.salvar]) expect(fn).not.toHaveBeenCalled();
  });
});

describe("conferir agora", () => {
  it("uma tentativa: força a leitura, com a empresa da sessão, e mostra o resultado", async () => {
    m.conferir.mockResolvedValue({ ok: true, situacao: "aprovado", consultou: true, mudou: true });
    expect(await conferirAgoraAcao({}, form({ pagamentoId: ID }))).toEqual({ ok: true, mensagem: "Conferido com o Mercado Pago: atualizado (aprovado)." });
    expect(m.conferir).toHaveBeenCalledWith({ banco: true }, "org", ID, provedor, expect.any(Date), { forcar: true, origem: "painel" });
    expect(m.revalidar).toHaveBeenCalledWith("/painel", "layout");
    m.conferir.mockResolvedValue({ ok: true, situacao: "pendente", consultou: true, mudou: false });
    expect((await conferirAgoraAcao({}, form({ pagamentoId: ID }))).mensagem).toBe("Conferido com o Mercado Pago: nada mudou (aguardando pagamento).");
    m.conferir.mockResolvedValue({ ok: false, erro: "Pagamento não encontrado." });
    expect(await conferirAgoraAcao({}, form({ pagamentoId: ID }))).toEqual({ mensagem: "Pagamento não encontrado." });
  });

  it("id inválido não chega ao provedor; travas do ambiente voltam como mensagem", async () => {
    expect(await conferirAgoraAcao({}, form({ pagamentoId: "x' or 1=1" }))).toEqual({ mensagem: "Pagamento não encontrado." });
    expect(m.gate).not.toHaveBeenCalled();
    m.gate.mockResolvedValue({ ok: false, motivo: "so_nas_previas", texto: "O teste do pagamento roda nas prévias da Vercel, não no deploy de produção." });
    expect(await conferirAgoraAcao({}, form({ pagamentoId: ID }))).toEqual({ mensagem: "O teste do pagamento roda nas prévias da Vercel, não no deploy de produção." });
    expect(m.conferir).not.toHaveBeenCalled();
  });

  it("todas as pendentes da empresa (nunca de todas as empresas)", async () => {
    m.pendentes.mockResolvedValue({ conferidas: 3, mudaram: 1, devolucoes: 1, canceladas: 0, falhas: 1 });
    const r = await conferirAgoraAcao({}, form({}));
    expect(m.pendentes).toHaveBeenCalledWith({ banco: true }, "org", provedor);
    expect(r).toEqual({ ok: true, mensagem: "3 pagamento(s) conferido(s) com o Mercado Pago, 1 com mudança, 1 devolução(ões) confirmada(s). 1 não deu para conferir agora: tente de novo em instantes." });
    m.pendentes.mockResolvedValue({ conferidas: 0, mudaram: 0, devolucoes: 0, canceladas: 0, falhas: 0 });
    expect((await conferirAgoraAcao({}, form({}))).mensagem).toBe("Nada pendente para conferir com o Mercado Pago.");
  });

  it("falha de transporte do provedor vira mensagem; outros erros sobem", async () => {
    m.conferir.mockRejectedValue(new ErroProvedor("incerto", "O Mercado Pago não respondeu a tempo."));
    expect(await conferirAgoraAcao({}, form({ pagamentoId: ID }))).toEqual({ mensagem: "O Mercado Pago não respondeu a tempo." });
    m.conferir.mockRejectedValue(new Error("banco"));
    await expect(conferirAgoraAcao({}, form({ pagamentoId: ID }))).rejects.toThrow("banco");
  });
});

describe("devoluções", () => {
  it("devolver pelo Mercado Pago: autor e empresa da sessão; pedida ou confirmada; recusa do domínio volta como veio", async () => {
    m.devolver.mockResolvedValue({ ok: true, situacao: "pedida" });
    expect((await devolverAcao({}, form({ pagamentoId: ID }))).mensagem).toContain("Devolução pedida ao Mercado Pago");
    expect(m.devolver).toHaveBeenCalledWith({ banco: true }, "org", ID, "u", provedor);
    m.devolver.mockResolvedValue({ ok: true, situacao: "confirmada" });
    expect(await devolverAcao({}, form({ pagamentoId: ID }))).toEqual({ ok: true, mensagem: "Devolução confirmada pelo Mercado Pago." });
    m.devolver.mockResolvedValue({ ok: false, erro: "Este pagamento já tem desfecho." });
    expect(await devolverAcao({}, form({ pagamentoId: ID }))).toEqual({ mensagem: "Este pagamento já tem desfecho." });
    m.gate.mockResolvedValue({ ok: false, motivo: "conta_nao_teste", texto: "A conta das chaves do Mercado Pago não é de teste: nenhuma cobrança é feita." });
    expect((await devolverAcao({}, form({ pagamentoId: ID }))).mensagem).toContain("registre a devolução feita por fora");
  });

  it("devolução por fora: valida data (até hoje), valor em reais e passa a nota; o domínio relê a order com o provedor de conferência", async () => {
    expect((await devolucaoPorForaAcao({}, form({ pagamentoId: ID, data: "", valor: "10,00" }))).mensagem).toBe("Informe a data da devolução.");
    expect((await devolucaoPorForaAcao({}, form({ pagamentoId: ID, data: amanha(), valor: "10,00" }))).mensagem).toBe("A data da devolução não pode ser no futuro.");
    expect((await devolucaoPorForaAcao({}, form({ pagamentoId: ID, data: hoje(), valor: "dez" }))).mensagem).toBe("Informe o valor devolvido em reais (ex.: 850,00).");
    expect((await devolucaoPorForaAcao({}, form({ pagamentoId: ID, data: hoje(), valor: "0" }))).mensagem).toBe("Informe o valor devolvido em reais (ex.: 850,00).");
    expect(m.porFora).not.toHaveBeenCalled();
    m.porFora.mockResolvedValue({ ok: true, situacao: "por_fora" });
    expect(await devolucaoPorForaAcao({}, form({ pagamentoId: ID, data: hoje(), valor: "1.824,00", nota: " Pix da conta da empresa " }))).toEqual({ ok: true, mensagem: "Devolução feita por fora registrada." });
    expect(m.porFora).toHaveBeenCalledWith({ banco: true }, "org", ID, { data: hoje(), valor: 182400, nota: "Pix da conta da empresa" }, "u", provedor);
    // Sem provedor para conferir (deploy de produção, conta não conferida): nada é registrado.
    m.porFora.mockClear();
    m.gate.mockResolvedValue({ ok: false, motivo: "so_nas_previas", texto: "O teste do pagamento roda nas prévias da Vercel, não no deploy de produção." });
    expect((await devolucaoPorForaAcao({}, form({ pagamentoId: ID, data: hoje(), valor: "1.824,00" }))).mensagem).toBe(
      "Não deu para conferir no Mercado Pago se a devolução já foi feita por lá (O teste do pagamento roda nas prévias da Vercel, não no deploy de produção). Sem essa conferência, a devolução feita por fora não é registrada.",
    );
    expect(m.porFora).not.toHaveBeenCalled();
    m.gate.mockResolvedValue({ ok: true, provedor, ambiente: "teste" });
    m.porFora.mockResolvedValue({ ok: false, erro: "O valor devolvido não pode passar do valor pago (R$ 1.824,00)." });
    expect(await devolucaoPorForaAcao({}, form({ pagamentoId: ID, data: hoje(), valor: "9.999,00" }))).toEqual({ mensagem: "O valor devolvido não pode passar do valor pago (R$ 1.824,00)." });
  });
});

describe("taxa que não voltou", () => {
  it("valor em reais (zero vale), autor e empresa da sessão; recusa do domínio volta como veio", async () => {
    expect((await registrarTaxaPerdidaAcao({}, form({ pagamentoId: ID, valor: "" }))).mensagem).toContain("Informe a taxa que não voltou");
    expect((await registrarTaxaPerdidaAcao({}, form({ pagamentoId: ID, valor: "dez" }))).mensagem).toContain("Informe a taxa que não voltou");
    expect(await registrarTaxaPerdidaAcao({}, form({ pagamentoId: "x" }))).toEqual({ mensagem: "Pagamento não encontrado." });
    expect(m.taxa).not.toHaveBeenCalled();
    m.taxa.mockResolvedValue({ ok: true });
    expect(await registrarTaxaPerdidaAcao({}, form({ pagamentoId: ID, valor: "18,06" }))).toEqual({ ok: true, mensagem: "Taxa registrada: a despesa entrou no financeiro da empresa." });
    expect(m.taxa).toHaveBeenCalledWith({ banco: true }, "org", ID, 1806, "u");
    expect((await registrarTaxaPerdidaAcao({}, form({ pagamentoId: ID, valor: "0" }))).mensagem).toContain("nenhuma despesa lançada");
    expect(m.taxa).toHaveBeenLastCalledWith({ banco: true }, "org", ID, 0, "u");
    m.taxa.mockResolvedValue({ ok: false, erro: "A taxa que não voltou já foi registrada (R$ 18,06)." });
    expect(await registrarTaxaPerdidaAcao({}, form({ pagamentoId: ID, valor: "18,06" }))).toEqual({ mensagem: "A taxa que não voltou já foi registrada (R$ 18,06)." });
  });
});

describe("liberação à mão", () => {
  it("registrar: data até hoje (São Paulo) e o líquido em reais", async () => {
    expect((await registrarLiberacaoAcao({}, form({ pagamentoId: ID, data: amanha(), liquido: "10,00" }))).mensagem).toBe("A data da liberação não pode ser no futuro.");
    expect((await registrarLiberacaoAcao({}, form({ pagamentoId: ID, data: "2026-02-30", liquido: "10,00" }))).mensagem).toBe("Informe a data em que o dinheiro caiu na conta.");
    expect((await registrarLiberacaoAcao({}, form({ pagamentoId: ID, data: hoje(), liquido: "" }))).mensagem).toContain("Informe o líquido");
    expect(m.liberar).not.toHaveBeenCalled();
    m.liberar.mockResolvedValue({ ok: true });
    expect((await registrarLiberacaoAcao({}, form({ pagamentoId: ID, data: hoje(), liquido: "1.750,00" }))).ok).toBe(true);
    expect(m.liberar).toHaveBeenCalledWith({ banco: true }, "org", ID, { data: hoje(), liquido: 175000 }, "u");
    m.liberar.mockResolvedValue({ ok: false, erro: "A liberação já foi confirmada pelo Mercado Pago." });
    expect(await registrarLiberacaoAcao({}, form({ pagamentoId: ID, data: hoje(), liquido: "1.750,00" }))).toEqual({ mensagem: "A liberação já foi confirmada pelo Mercado Pago." });
  });

  it("estornar: exige o motivo; recusa do domínio volta como veio", async () => {
    expect(await estornarLiberacaoAcao({}, form({ pagamentoId: ID, motivo: "  " }))).toEqual({ mensagem: "Informe o motivo do estorno." });
    expect(m.estornar).not.toHaveBeenCalled();
    m.estornar.mockResolvedValue({ ok: true });
    expect((await estornarLiberacaoAcao({}, form({ pagamentoId: ID, motivo: "valor digitado errado" }))).ok).toBe(true);
    expect(m.estornar).toHaveBeenCalledWith({ banco: true }, "org", ID, "valor digitado errado", "u");
    m.estornar.mockResolvedValue({ ok: false, erro: "A liberação foi confirmada pelo Mercado Pago: não se estorna pelo painel." });
    expect((await estornarLiberacaoAcao({}, form({ pagamentoId: ID, motivo: "x" }))).mensagem).toBe("A liberação foi confirmada pelo Mercado Pago: não se estorna pelo painel.");
  });
});

describe("salvar a aba Pagamento no site", () => {
  it("valida, grava auditado com a empresa da sessão e revalida", async () => {
    m.salvar.mockResolvedValue({ ok: true, mudou: true });
    const r = await salvarConfigPagamentoSiteAcao({}, form({ oferecer: "on", nomeFatura: " SCL  Leblon ", categoriaTaxaId: "" }));
    expect(r).toEqual({ ok: true, aviso: "Salvo. Vale para os Pix novos; os já gerados seguem como estavam." });
    expect(m.salvar).toHaveBeenCalledWith({ banco: true }, "org", { oferecer: true, nomeFatura: "SCL Leblon", categoriaTaxaId: null }, "u");
    expect(m.revalidar).toHaveBeenCalledWith("/painel", "layout");
    // Desligar: a caixa desmarcada não vem no formulário.
    expect((await salvarConfigPagamentoSiteAcao({}, form({ nomeFatura: "" }))).aviso).toContain("deixa de oferecer o Pix");
    m.salvar.mockResolvedValue({ ok: true, mudou: false });
    expect((await salvarConfigPagamentoSiteAcao({}, form({ oferecer: "on" }))).aviso).toBe("Nada mudou.");
  });

  it("erros de validação e de categoria voltam por campo, com o que foi digitado", async () => {
    const r = await salvarConfigPagamentoSiteAcao({}, form({ oferecer: "on", nomeFatura: "Nome comprido demais para a fatura" }));
    expect(r.erros?.nomeFatura).toContain("Máximo de 22");
    expect(r.valores?.nomeFatura).toBe("Nome comprido demais para a fatura");
    expect(m.salvar).not.toHaveBeenCalled();
    m.salvar.mockResolvedValue({ ok: false, erros: { categoriaTaxaId: "Categoria não encontrada ou arquivada." } });
    expect((await salvarConfigPagamentoSiteAcao({}, form({ oferecer: "on", categoriaTaxaId: ID }))).erros).toEqual({ categoriaTaxaId: "Categoria não encontrada ou arquivada." });
  });
});
