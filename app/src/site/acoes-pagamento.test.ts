import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { aceitesSite, pagamentos, tentativasLogin } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { autorizacaoValida, CAMINHO_COOKIE_CHECKOUT, emitirAutorizacao, validadeDaAutorizacao } from "@/pagamentos/autorizacao";
import { ERRO_EMAIL_DO_PEDIDO, ERROS_LIMITE, LIMITES_PAGAMENTO } from "@/pagamentos/limites";
import { ErroProvedor } from "@/pagamentos/provedor";
import { AGORA, type Cenario, EMAIL_HOSPEDE, minutos, montarCenario } from "@/pagamentos/testes";
import { nomeDoCookieDoPedido } from "./checkout";
import { criarCotacao } from "./cotacoes";
import { MENSAGEM_SEM_AUTORIZACAO, MENSAGENS_PIX_HOSPEDE } from "./pagamento";

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

const { continuarPagamentoAcao, gerarPixAcao } = await import("./acoes-pagamento");
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
