import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_PAGAMENTO_SITE_PADRAO, salvarConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { aceitesSite, pagamentos, tentativasLogin } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { autorizacaoValida, CAMINHO_COOKIE_CHECKOUT, emitirAutorizacao, validadeDaAutorizacao } from "@/pagamentos/autorizacao";
import { ERRO_EMAIL_DO_PEDIDO, ERROS_LIMITE, LIMITES_PAGAMENTO } from "@/pagamentos/limites";
import { ErroProvedor } from "@/pagamentos/provedor";
import { AGORA, alterar, type Cenario, DISPOSITIVO_FICTICIO, DOCUMENTO_FICTICIO, EMAIL_HOSPEDE, minutos, montarCenario, pagarEConfirmar, semDadosPessoais, TOKEN_FICTICIO, TOTAL, usuarioDeTeste } from "@/pagamentos/testes";
import { nomeDoCookieDoPedido } from "./checkout";
import { criarCotacao } from "./cotacoes";
import { MENSAGEM_SEM_AUTORIZACAO, MENSAGENS_CARTAO_HOSPEDE, MENSAGENS_PIX_HOSPEDE } from "./pagamento";

type Gravado = { value: string; opcoes: Record<string, unknown> };
const m = vi.hoisted(() => ({
  db: null as unknown as Db,
  org: "",
  ip: "203.0.113.10",
  jarra: new Map<string, Gravado>(),
  revalidar: vi.fn(),
  portao: vi.fn(),
}));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": m.ip }),
  cookies: async () => ({
    get: (nome: string) => (m.jarra.has(nome) ? { name: nome, value: m.jarra.get(nome)!.value } : undefined),
    set: (nome: string, value: string, opcoes: Record<string, unknown>) => m.jarra.set(nome, { value, opcoes }),
  }),
}));
vi.mock("./site", async (orig) => ({
  ...(await orig<typeof import("./site")>()),
  organizacaoDoSite: async () => m.org,
  conteudoDoSite: async () => ({ organizacaoId: m.org }),
}));
// As travas reais leem as variáveis do processo (sem chaves = desligado): aqui, o portão do cenário (provedor falso).
vi.mock("./pagamento", async (orig) => ({ ...(await orig<typeof import("./pagamento")>()), portaoDoSite: m.portao }));

const { continuarPagamentoAcao, gerarPixAcao, pagarComCartaoAcao } = await import("./acoes-pagamento");
const { segurarDatasAcao } = await import("./acoes");

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
  vi.stubEnv("AUTH_SECRET", "segredo-de-teste-ficticio");
  c = await montarCenario(db);
  m.db = db;
  m.org = c.org;
  m.ip = "203.0.113.10";
  m.jarra.clear();
  m.revalidar.mockReset();
  m.portao.mockReset().mockResolvedValue(c.gate);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const comCookie = (cotacaoId: string) => m.jarra.set(nomeDoCookieDoPedido(cotacaoId), { value: emitirAutorizacao(cotacaoId, validadeDaAutorizacao(minutos(30), AGORA)), opcoes: {} });
const tentativasDa = (cotacaoId: string) => db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId));
const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

describe("Gerar Pix (M8.2a)", () => {
  it("sem o cookie do pedido: recusa sem criar nada nem gastar tentativa do freio", async () => {
    const s = await c.segurar();
    for (let i = 0; i < LIMITES_PAGAMENTO.gerar_pix.origem.tentativas + 2; i++) expect(await gerarPixAcao(s.codigo)).toEqual({ erro: MENSAGEM_SEM_AUTORIZACAO });
    expect(await tentativasDa(s.cotacaoId)).toEqual([]);
    expect(await db.select().from(tentativasLogin).where(like(tentativasLogin.chave, `pagamento-gerar_pix:%${c.org}%`))).toEqual([]);
    // Cookie de outra cotação também não serve.
    const outra = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "outra@example.com" });
    comCookie(outra.cotacaoId);
    expect(await gerarPixAcao(s.codigo)).toEqual({ erro: MENSAGEM_SEM_AUTORIZACAO });
    expect(await gerarPixAcao("COT-INEXIST")).toEqual({ erro: MENSAGENS_PIX_HOSPEDE.nao_encontrada });
  });

  it("com o cookie: gera o Pix (o mesmo, se pedir de novo) e recarrega a página; o estado não leva nada pessoal", async () => {
    const s = await c.segurar();
    comCookie(s.cotacaoId);
    const r = await gerarPixAcao(s.codigo.toLowerCase());
    expect(r).toEqual({ ok: true });
    expect(m.revalidar).toHaveBeenCalledWith(`/reservar/${s.codigo}`);
    expect(await gerarPixAcao(s.codigo)).toEqual({ ok: true });
    const lista = await tentativasDa(s.cotacaoId);
    expect(lista).toHaveLength(1);
    expect(lista[0].situacao).toBe("pendente");
    // A organização vem do site, nunca de um campo.
    expect(m.portao).toHaveBeenCalledWith(db, c.org, AGORA);
  });

  it("freio por endereço de internet: a mensagem do domínio; outro endereço segue", async () => {
    const s = await c.segurar();
    comCookie(s.cotacaoId);
    await db.insert(tentativasLogin).values({ chave: `pagamento-gerar_pix:origem:${c.org}:${m.ip}`, erros: LIMITES_PAGAMENTO.gerar_pix.origem.tentativas, atualizadoEm: AGORA });
    expect(await gerarPixAcao(s.codigo)).toEqual({ erro: ERROS_LIMITE.gerar_pix });
    expect(await tentativasDa(s.cotacaoId)).toEqual([]);
    m.ip = "203.0.113.11";
    expect(await gerarPixAcao(s.codigo)).toEqual({ ok: true });
  });

  it("travas fechadas ou Pix não oferecido: mensagem curta, sem o motivo interno", async () => {
    const s = await c.segurar();
    comCookie(s.cotacaoId);
    m.portao.mockResolvedValue({ ok: false, motivo: "desligado_no_painel", texto: "Oferecer pagamento no site está desligado em Configurações → Pagamento no site." });
    expect(await gerarPixAcao(s.codigo)).toEqual({ erro: MENSAGENS_PIX_HOSPEDE.nao_oferecido });
    m.portao.mockResolvedValue(c.gate);
    vi.setSystemTime(minutos(31));
    expect(await gerarPixAcao(s.codigo)).toEqual({ erro: "O prazo das datas desta cotação acabou." });
    expect(await tentativasDa(s.cotacaoId)).toEqual([]);
  });

  it("falha do provedor vira a mensagem curta do site, nunca o texto do provedor", async () => {
    const s = await c.segurar();
    comCookie(s.cotacaoId);
    c.provedor.falhas.criarPix = new ErroProvedor("indisponivel", "TEXTO-DO-PROVEDOR detalhes internos");
    const r = await gerarPixAcao(s.codigo);
    expect(r).toEqual({ erro: MENSAGENS_PIX_HOSPEDE.provedor });
    expect(JSON.stringify(r)).not.toContain("TEXTO-DO-PROVEDOR");
    c.provedor.falhas.criarPix = new ErroProvedor("incerto", "tempo");
    expect(await gerarPixAcao(s.codigo)).toEqual({ erro: MENSAGENS_PIX_HOSPEDE.incerto });
  });
});

describe("Gerar Pix com o aceite das páginas legais (M7.4)", () => {
  const aceiteDoFormulario = (versoes: Record<string, string> = { versaoTermos: "1", versaoPrivacidade: "1", versaoCancelamento: "1" }) => form({ aceite: "sim", ...versoes });
  const aceitesDa = (cotacaoId: string) => db.select().from(aceitesSite).where(eq(aceitesSite.cotacaoId, cotacaoId));

  it("caixa marcada com as versões da página: gera o Pix e grava o aceite; sem a caixa, numa cotação ainda sem aceite, pede o aceite", async () => {
    const s = await c.segurar({ semAceite: true });
    comCookie(s.cotacaoId);
    expect(await gerarPixAcao(s.codigo, {}, form({}))).toEqual({ erro: MENSAGENS_PIX_HOSPEDE.aceite_pendente });
    expect(await gerarPixAcao(s.codigo)).toEqual({ erro: MENSAGENS_PIX_HOSPEDE.aceite_pendente });
    expect(await tentativasDa(s.cotacaoId)).toEqual([]);
    // A página recarrega e mostra a caixa de novo.
    expect(m.revalidar).toHaveBeenCalledWith(`/reservar/${s.codigo}`);
    const r = await gerarPixAcao(s.codigo, {}, aceiteDoFormulario());
    expect(r).toEqual({ ok: true });
    const [aceite] = await aceitesDa(s.cotacaoId);
    expect(aceite).toMatchObject({ versaoTermos: 1, versaoPrivacidade: 1, versaoCancelamento: 1, origem: "pix" });
    expect((await tentativasDa(s.cotacaoId))[0].aceiteId).toBe(aceite.id);
    // O estado não leva nada pessoal.
    expect(JSON.stringify(r)).not.toContain(EMAIL_HOSPEDE);
  });

  it("caixa marcada com versão fora do formato: pede para recarregar, sem gerar nada; versões que não são as publicadas: a página mudou", async () => {
    const s = await c.segurar({ semAceite: true });
    comCookie(s.cotacaoId);
    expect(await gerarPixAcao(s.codigo, {}, aceiteDoFormulario({ versaoTermos: "1", versaoPrivacidade: "x", versaoCancelamento: "1" }))).toEqual({ erro: "Recarregue a página e tente de novo." });
    expect(await gerarPixAcao(s.codigo, {}, aceiteDoFormulario({ versaoTermos: "1", versaoCancelamento: "1" }))).toEqual({ erro: "Recarregue a página e tente de novo." });
    expect(await gerarPixAcao(s.codigo, {}, aceiteDoFormulario({ versaoTermos: "2", versaoPrivacidade: "1", versaoCancelamento: "1" }))).toEqual({ erro: MENSAGENS_PIX_HOSPEDE.aceite_mudou });
    expect(await tentativasDa(s.cotacaoId)).toEqual([]);
    expect(await aceitesDa(s.cotacaoId)).toEqual([]);
  });

  it("sem o cookie do pedido: recusa antes de olhar o aceite, e nada é gravado", async () => {
    const s = await c.segurar({ semAceite: true });
    expect(await gerarPixAcao(s.codigo, {}, aceiteDoFormulario())).toEqual({ erro: MENSAGEM_SEM_AUTORIZACAO });
    expect(await aceitesDa(s.cotacaoId)).toEqual([]);
    expect(await tentativasDa(s.cotacaoId)).toEqual([]);
  });
});

describe("Continuar o pagamento noutro aparelho (M8.2a)", () => {
  it("e-mail do pedido: emite o cookie (httpOnly, só /reservar, lax); errado ou cotação inexistente: a mesma resposta, sem cookie e sem eco", async () => {
    const s = await c.segurar();
    const errado = await continuarPagamentoAcao({}, form({ codigo: s.codigo, email: "outro@example.com" }));
    expect(errado).toEqual({ erro: ERRO_EMAIL_DO_PEDIDO });
    expect(await continuarPagamentoAcao({}, form({ codigo: "COT-ZZZZZZZZ", email: EMAIL_HOSPEDE }))).toEqual({ erro: ERRO_EMAIL_DO_PEDIDO });
    expect(await continuarPagamentoAcao({}, form({ codigo: "lixo", email: EMAIL_HOSPEDE }))).toEqual({ erro: ERRO_EMAIL_DO_PEDIDO });
    expect(m.jarra.size).toBe(0);
    const ok = await continuarPagamentoAcao({}, form({ codigo: s.codigo, email: ` ${EMAIL_HOSPEDE.toUpperCase()} ` }));
    expect(ok).toEqual({ ok: true });
    const g = m.jarra.get(nomeDoCookieDoPedido(s.cotacaoId))!;
    expect(g.opcoes).toMatchObject({ httpOnly: true, sameSite: "lax", path: CAMINHO_COOKIE_CHECKOUT, secure: false });
    expect(autorizacaoValida(g.value, s.cotacaoId, minutos(1))).toBe(true);
    expect(m.revalidar).toHaveBeenCalledWith(`/reservar/${s.codigo}`);
    expect(JSON.stringify([errado, ok])).not.toContain("example.com");
  });

  it("tentativas limitadas por endereço: depois do teto, nem o e-mail certo passa", async () => {
    const s = await c.segurar();
    for (let i = 0; i < LIMITES_PAGAMENTO.continuar.origem.tentativas; i++) await continuarPagamentoAcao({}, form({ codigo: s.codigo, email: `x${i}@example.com` }));
    expect(await continuarPagamentoAcao({}, form({ codigo: s.codigo, email: EMAIL_HOSPEDE }))).toEqual({ erro: ERROS_LIMITE.continuar });
    expect(m.jarra.size).toBe(0);
  });

  it("sem AUTH_SECRET: não autoriza (mensagem curta)", async () => {
    const s = await c.segurar();
    vi.stubEnv("AUTH_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await continuarPagamentoAcao({}, form({ codigo: s.codigo, email: EMAIL_HOSPEDE }))).toMatchObject({ erro: expect.stringContaining("não está disponível") });
    expect(m.jarra.size).toBe(0);
  });
});

describe("Segurar as datas (M8.1 + M8.2a)", () => {
  const contato = { nome: "Visitante Fictício", email: "segura@example.com", telefone: "(21) 99999-0000" };
  const novaCotacao = async () => {
    const r = await criarCotacao(db, c.org, { imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "4" }, AGORA);
    if (!r.ok) throw new Error(r.erro);
    return r.cotacao;
  };

  it("segurou: o navegador recebe a autorização do pagamento até o fim do pedido; o estado não traz os dados digitados", async () => {
    const cot = await novaCotacao();
    const r = await segurarDatasAcao({}, form({ codigo: cot.codigo, ...contato }));
    expect(r).toEqual({});
    const g = m.jarra.get(nomeDoCookieDoPedido(cot.id))!;
    expect(g.opcoes).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/reservar", expires: validadeDaAutorizacao(minutos(30), AGORA) });
    expect(autorizacaoValida(g.value, cot.id, minutos(29))).toBe(true);
  });

  it("segurar uma segunda cotação no mesmo navegador não tira a autorização da primeira (um cookie por cotação)", async () => {
    const s = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "outra@example.com" });
    comCookie(s.cotacaoId);
    const cot = await novaCotacao();
    expect(await segurarDatasAcao({}, form({ codigo: cot.codigo, ...contato }))).toEqual({});
    expect(autorizacaoValida(m.jarra.get(nomeDoCookieDoPedido(s.cotacaoId))!.value, s.cotacaoId, minutos(1))).toBe(true);
    expect(autorizacaoValida(m.jarra.get(nomeDoCookieDoPedido(cot.id))!.value, cot.id, minutos(1))).toBe(true);
  });

  it("dados inválidos voltam com os erros, sem gastar o freio; o estado nunca traz os dados de volta", async () => {
    const cot = await novaCotacao();
    const r = await segurarDatasAcao({}, form({ codigo: cot.codigo, ...contato, email: "nada" }));
    expect(r).toEqual({ erro: "Confira seus dados.", erros: { email: "Informe um e-mail válido." } });
    expect(JSON.stringify(r)).not.toContain("Visitante");
    expect(await db.select().from(tentativasLogin).where(like(tentativasLogin.chave, `pagamento-segurar:%${c.org}%`))).toEqual([]);
    expect(m.jarra.size).toBe(0);
  });

  it("código fora do formato: recusa antes do freio (não gasta a conta de ninguém)", async () => {
    expect(await segurarDatasAcao({}, form({ codigo: "lixo", ...contato }))).toEqual({ erro: "Cotação não encontrada." });
    expect(await db.select().from(tentativasLogin).where(like(tentativasLogin.chave, `pagamento-segurar:%${c.org}%`))).toEqual([]);
  });

  it("freio por endereço de internet antes de segurar: a mensagem do domínio, nada segurado", async () => {
    const cot = await novaCotacao();
    await db.insert(tentativasLogin).values({ chave: `pagamento-segurar:origem:${c.org}:${m.ip}`, erros: LIMITES_PAGAMENTO.segurar.origem.tentativas, atualizadoEm: AGORA });
    expect(await segurarDatasAcao({}, form({ codigo: cot.codigo, ...contato }))).toEqual({ erro: ERROS_LIMITE.segurar });
    expect((await c.cotacao(cot.id)).estado).toBe("aberta");
    expect(m.jarra.size).toBe(0);
  });

  it("sem AUTH_SECRET, segura as datas mesmo assim (o pedido segue pela conversa), sem cookie", async () => {
    const cot = await novaCotacao();
    vi.stubEnv("AUTH_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await segurarDatasAcao({}, form({ codigo: cot.codigo, ...contato }))).toEqual({});
    expect((await c.cotacao(cot.id)).estado).toBe("segurada");
    expect(m.jarra.size).toBe(0);
  });
});

describe("Pagar com cartão (M8.2b)", () => {
  /** O que o formulário do cartão manda (token gerado no navegador, nunca o número), mais campos que nunca são lidos. */
  const formCartao = (over: Record<string, string> = {}) =>
    form({
      token: TOKEN_FICTICIO,
      bandeira: "master",
      tipo: "credit_card",
      parcelas: "1",
      documentoTipo: "CPF",
      documentoNumero: DOCUMENTO_FICTICIO,
      dispositivo: DISPOSITIVO_FICTICIO,
      // Nada disto é lido pela ação (nem que o navegador mande).
      email: "forjado@example.com",
      transaction_amount: "1.00",
      issuer_id: "999",
      bin: "548083",
      lastFourDigits: "3311",
      cardholderName: "APRO",
      organizacaoId: "outra-org",
      ...over,
    });
  const cartoesDa = async (cotacaoId: string) => (await tentativasDa(cotacaoId)).filter((t) => t.forma === "cartao");

  it("ordem: sem o cookie do pedido, recusa antes do freio (nada gasto); depois o freio por endereço, só a origem (o teto geral nunca é tocado)", async () => {
    const s = await c.segurar();
    for (let i = 0; i < LIMITES_PAGAMENTO.cartao.origem.tentativas + 2; i++) expect(await pagarComCartaoAcao(s.codigo, formCartao())).toEqual({ erro: MENSAGEM_SEM_AUTORIZACAO });
    expect(await db.select().from(tentativasLogin).where(like(tentativasLogin.chave, `pagamento-cartao:%`))).toEqual([]);
    expect(c.provedor.chamadas.filter((x) => x.metodo === "criarCartao")).toEqual([]);
    comCookie(s.cotacaoId);
    await db.insert(tentativasLogin).values({ chave: `pagamento-cartao:origem:${c.org}:${m.ip}`, erros: LIMITES_PAGAMENTO.cartao.origem.tentativas, atualizadoEm: AGORA });
    expect(await pagarComCartaoAcao(s.codigo, formCartao())).toEqual({ erro: ERROS_LIMITE.cartao });
    expect(await cartoesDa(s.cotacaoId)).toEqual([]);
    m.ip = "203.0.113.11";
    expect(await pagarComCartaoAcao(s.codigo, formCartao())).toEqual({ ok: true, situacao: "aprovado" });
    expect(await db.select().from(tentativasLogin).where(like(tentativasLogin.chave, `pagamento-cartao:geral:%`))).toEqual([]);
    expect(await pagarComCartaoAcao("COT-INEXIST", formCartao())).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.nao_encontrada });
  });

  it("aprovado: confirma a reserva, recarrega a página; do formulário só os campos conhecidos chegam ao provedor; o estado não devolve nada do que foi enviado", async () => {
    const s = await c.segurar();
    comCookie(s.cotacaoId);
    const r = await pagarComCartaoAcao(s.codigo.toLowerCase(), formCartao({ parcelas: "3" }));
    expect(r).toEqual({ ok: true, situacao: "aprovado" });
    expect(m.revalidar).toHaveBeenCalledWith(`/reservar/${s.codigo}`);
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
    const pedido = c.provedor.ultimoPedidoCartao!;
    // E-mail da reserva (no servidor), valor da cotação, nunca o que o formulário dizia.
    expect(pedido).toMatchObject({ email: EMAIL_HOSPEDE, valor: TOTAL, bandeira: "master", tipo: "credit_card", parcelas: 3, emissor: null, comToken: true, documento: { tipo: "CPF", numero: DOCUMENTO_FICTICIO }, sessaoDispositivo: DISPOSITIVO_FICTICIO });
    // Nenhum valor forjado chegou ao provedor (comparação campo a campo: ids aleatórios nunca dão falso alarme).
    const valores = Object.values(pedido).flatMap((v) => (v && typeof v === "object" ? Object.values(v) : [v])).map(String);
    for (const forjado of ["forjado@example.com", "1.00", "999", "548083", "3311", "APRO", "outra-org"]) expect(valores).not.toContain(forjado);
    expect(JSON.stringify(r)).not.toMatch(new RegExp([TOKEN_FICTICIO, DOCUMENTO_FICTICIO, DISPOSITIVO_FICTICIO, EMAIL_HOSPEDE].join("|")));
    expect(await semDadosPessoais(db, [TOKEN_FICTICIO, DOCUMENTO_FICTICIO, DISPOSITIVO_FICTICIO, "548083", "APRO"])).toEqual([]);
  });

  it("recusado: o mesmo texto para todo motivo (o do banco, o da análise de risco), nunca o código", async () => {
    const s = await c.segurar();
    comCookie(s.cotacaoId);
    c.provedor.respostaCartao = "recusado";
    const respostas = [];
    for (const motivo of ["rejected_by_issuer", "high_risk"]) {
      c.provedor.motivoRecusaCartao = motivo;
      respostas.push(await pagarComCartaoAcao(s.codigo, formCartao()));
    }
    expect(respostas).toEqual([{ erro: MENSAGENS_CARTAO_HOSPEDE.recusado }, { erro: MENSAGENS_CARTAO_HOSPEDE.recusado }]);
    expect(JSON.stringify(respostas)).not.toMatch(/rejected|risk/);
    // Só crédito: recusado antes de chegar ao provedor.
    c.provedor.chamadas.length = 0;
    expect(await pagarComCartaoAcao(s.codigo, formCartao({ tipo: "debit_card" }))).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.so_credito });
    expect(c.provedor.chamadas.filter((x) => x.metodo === "criarCartao")).toEqual([]);
  });

  it("parcelas acima do painel ou cartão indisponível: a mensagem curta e a página recarrega antes do formulário novo", async () => {
    const s = await c.segurar();
    comCookie(s.cotacaoId);
    await salvarConfigPagamentoSite(db, c.org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, cartao: true, parcelasMaximas: 3 }, null);
    expect(await pagarComCartaoAcao(s.codigo, formCartao({ parcelas: "6" }))).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.parcelas, recarregar: true });
    // Campo fora do formato (ou maior que o tamanho máximo): o domínio recusa sem chamar o provedor.
    expect(await pagarComCartaoAcao(s.codigo, formCartao({ parcelas: "x" }))).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.parcelas, recarregar: true });
    expect(await pagarComCartaoAcao(s.codigo, formCartao({ token: "t".repeat(129) }))).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.dados_cartao });
    await salvarConfigPagamentoSite(db, c.org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, cartao: false }, null);
    expect(await pagarComCartaoAcao(s.codigo, formCartao())).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.indisponivel, recarregar: true });
    m.portao.mockResolvedValue({ ok: false, motivo: "desligado_no_painel", texto: "Oferecer pagamento no site está desligado em Configurações → Pagamento no site." });
    expect(await pagarComCartaoAcao(s.codigo, formCartao())).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.nao_oferecido, recarregar: true });
    // O sexto envio na hora pelo mesmo endereço já para no freio (5 por hora); de outro endereço, segue.
    expect(await pagarComCartaoAcao(s.codigo, formCartao())).toEqual({ erro: ERROS_LIMITE.cartao });
    m.ip = "203.0.113.12";
    // Prazo das datas acabado: o texto do prazo (não "cartão indisponível").
    m.portao.mockResolvedValue(c.gate);
    await salvarConfigPagamentoSite(db, c.org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, cartao: true }, null);
    vi.setSystemTime(minutos(31));
    expect(await pagarComCartaoAcao(s.codigo, formCartao())).toEqual({ erro: "O prazo das datas desta cotação acabou.", recarregar: true });
    expect(await cartoesDa(s.cotacaoId)).toEqual([]);
    expect(c.provedor.chamadas.filter((x) => x.metodo === "criarCartao")).toEqual([]);
  });

  it("aceite das páginas legais: sem a caixa numa cotação sem aceite, pede o aceite; marcada, grava o aceite do cartão na mesma transação", async () => {
    const s = await c.segurar({ semAceite: true });
    comCookie(s.cotacaoId);
    expect(await pagarComCartaoAcao(s.codigo, formCartao())).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.aceite_pendente });
    expect(await pagarComCartaoAcao(s.codigo, formCartao({ aceite: "sim", versaoTermos: "1", versaoPrivacidade: "x", versaoCancelamento: "1" }))).toEqual({ erro: "Recarregue a página e tente de novo.", recarregar: true });
    expect(await pagarComCartaoAcao(s.codigo, formCartao({ aceite: "sim", versaoTermos: "2", versaoPrivacidade: "1", versaoCancelamento: "1" }))).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.aceite_mudou });
    expect(await cartoesDa(s.cotacaoId)).toEqual([]);
    expect(await pagarComCartaoAcao(s.codigo, formCartao({ aceite: "sim", versaoTermos: "1", versaoPrivacidade: "1", versaoCancelamento: "1" }))).toEqual({ ok: true, situacao: "aprovado" });
    const [aceite] = await db.select().from(aceitesSite).where(eq(aceitesSite.cotacaoId, s.cotacaoId));
    expect(aceite).toMatchObject({ origem: "cartao", versaoTermos: 1 });
    expect((await cartoesDa(s.cotacaoId))[0].aceiteId).toBe(aceite.id);
  });

  it("desafio do banco e análise voltam como situação (a página mostra); falha inesperada vira a mensagem curta e o registro leva só o tipo do erro", async () => {
    const s = await c.segurar();
    comCookie(s.cotacaoId);
    c.provedor.respostaCartao = "desafio";
    expect(await pagarComCartaoAcao(s.codigo, formCartao())).toEqual({ ok: true, situacao: "desafio" });
    const outra = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "outra@example.com" });
    comCookie(outra.cotacaoId);
    c.provedor.respostaCartao = "em_analise";
    expect(await pagarComCartaoAcao(outra.codigo, formCartao())).toEqual({ ok: true, situacao: "analise" });
    expect(await pagarComCartaoAcao(outra.codigo, formCartao())).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.em_analise, recarregar: true });
    const terceira = await c.segurar({ entrada: "2026-11-20", saida: "2026-11-23", email: "terceira@example.com" });
    comCookie(terceira.cotacaoId);
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "transaction").mockImplementationOnce(() => {
      throw new TypeError(`falha com ${TOKEN_FICTICIO}`);
    });
    expect(await pagarComCartaoAcao(terceira.codigo, formCartao())).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.provedor });
    expect(erro).toHaveBeenCalledWith("[site] falha no pagamento com cartão", "TypeError");
    expect(JSON.stringify(erro.mock.calls)).not.toContain(TOKEN_FICTICIO);
  });
});

describe("o pagamento da diferença de uma alteração (M8.2d)", () => {
  /** Reserva paga e confirmada, com uma alteração segurada de 12/10–15/10 para 12/10–16/10 (diferença de R$ 528,00). */
  async function comAlteracao() {
    const x = await pagarEConfirmar(c, { liberar: true });
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: await usuarioDeTeste(c) });
    if (!resultado.ok) throw new Error(resultado.erro);
    vi.setSystemTime(minutos(21));
    comCookie(x.cotacaoId);
    return { ...x, alteracaoId: resultado.alteracaoId };
  }
  const cartaoDaDiferenca = (alteracao: string) =>
    form({ token: TOKEN_FICTICIO, bandeira: "master", tipo: "credit_card", parcelas: "1", documentoTipo: "CPF", documentoNumero: DOCUMENTO_FICTICIO, dispositivo: DISPOSITIVO_FICTICIO, alteracao });

  it("Gerar Pix com a alteração: o Pix da diferença (o valor dela, ligado à alteração); fora do formato ou de outra alteração, a página mudou e nada é criado", async () => {
    const x = await comAlteracao();
    const antes = await tentativasDa(x.cotacaoId);
    expect(await gerarPixAcao(x.codigo, {}, form({ alteracao: "nao-e-um-id" }))).toEqual({ erro: MENSAGENS_PIX_HOSPEDE.alteracao_mudou });
    expect(await gerarPixAcao(x.codigo, {}, form({ alteracao: randomUUID() }))).toEqual({ erro: MENSAGENS_PIX_HOSPEDE.alteracao_mudou });
    expect(await tentativasDa(x.cotacaoId)).toHaveLength(antes.length);
    expect(await gerarPixAcao(x.codigo, {}, form({ alteracao: x.alteracaoId }))).toEqual({ ok: true });
    const novas = (await tentativasDa(x.cotacaoId)).filter((t) => !antes.some((a) => a.id === t.id));
    expect(novas).toHaveLength(1);
    expect(novas[0]).toMatchObject({ forma: "pix", situacao: "pendente", valor: 52800, alteracaoId: x.alteracaoId });
    expect(m.revalidar).toHaveBeenCalledWith(`/reservar/${x.codigo}`);
    // Sem o campo, é o Pix da cotação: a reserva já está paga, nada novo é oferecido.
    expect((await gerarPixAcao(x.codigo, {}, form({}))).erro).toBeTruthy();
    expect((await tentativasDa(x.cotacaoId)).length).toBe(antes.length + 1);
  });

  it("Pagar com cartão com a alteração: o cartão da diferença (o valor dela); id fora do formato: a página recarrega, nada chega ao Mercado Pago", async () => {
    const x = await comAlteracao();
    const criados = () => c.provedor.chamadas.filter((y) => y.metodo === "criarCartao").length;
    const antes = criados();
    expect(await pagarComCartaoAcao(x.codigo, cartaoDaDiferenca("nao-e-um-id"))).toEqual({ erro: MENSAGENS_CARTAO_HOSPEDE.alteracao_mudou, recarregar: true });
    expect(criados()).toBe(antes);
    expect(await pagarComCartaoAcao(x.codigo, cartaoDaDiferenca(x.alteracaoId))).toEqual({ ok: true, situacao: "aprovado" });
    expect(c.provedor.ultimoPedidoCartao).toMatchObject({ valor: 52800 });
    const cartao = (await tentativasDa(x.cotacaoId)).find((t) => t.forma === "cartao");
    expect(cartao).toMatchObject({ valor: 52800, alteracaoId: x.alteracaoId });
  });
});
