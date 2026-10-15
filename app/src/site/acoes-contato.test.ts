/**
 * Ação pública do pedido de contato (M7.7) com o registro da autorização (M7.14): a caixa é obrigatória, o texto
 * gravado é o do servidor e, se o texto mudou depois que a página abriu, a pessoa vê o texto novo e marca de novo.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { autorizacaoEmVigor, publicarTextoAutorizacao } from "@/configuracoes/autorizacao-proprietarios";
import { salvarEmpresa } from "@/configuracoes/empresa";
import { organizacoes, pedidosContatoProprietario } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { autorizacaoDeOrigem, ERRO_AUTORIZACAO_MUDOU } from "@/proprietarios/autorizacao";

const m = vi.hoisted(() => ({ db: null as unknown as Db, org: "", depois: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.10", host: "exemplo.test" }) }));
// O aviso por e-mail roda depois da resposta: aqui não roda (o pedido já está gravado quando a ação responde).
vi.mock("next/server", () => ({ after: m.depois }));
vi.mock("@/email/correio", () => ({ correioDoAmbiente: () => null }));
vi.mock("./site", () => ({ organizacaoDoSite: async () => m.org }));

const { pedirContatoProprietarioAcao } = await import("./acoes-contato");

let close: () => Promise<void>;
beforeAll(async () => {
  let db: Db;
  ({ db, close } = await createTestDb());
  m.db = db;
});
afterAll(() => close());
beforeEach(async () => {
  // Uma organização nova por teste (os tetos e os pedidos são por organização).
  [{ id: m.org }] = await m.db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  m.depois.mockReset();
});

const formulario = (over: Record<string, string> = {}) => {
  const f = new FormData();
  const campos = {
    nome: "Maria Exemplo",
    email: "maria@example.com",
    telefone: "(21) 90000-0000",
    bairro: "Ipanema",
    cidade: "Rio de Janeiro",
    quartos: "2",
    anunciaHoje: "sim",
    mensagem: "",
    site: "",
    consentimento: "on",
    autorizacao: autorizacaoDeOrigem("contato", "Sua Casa Exemplo").marca,
    ...over,
  };
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const linhas = () => m.db.select().from(pedidosContatoProprietario).where(eq(pedidosContatoProprietario.organizacaoId, m.org));

it("sem a caixa marcada: volta com o erro na caixa e nada é gravado", async () => {
  const f = formulario();
  f.delete("consentimento");
  expect(await pedirContatoProprietarioAcao({}, f)).toMatchObject({ erros: { consentimento: "É preciso autorizar o uso dos dados para a gente responder." }, mensagem: "Confira os campos destacados." });
  expect(await linhas()).toEqual([]);
});

it("com a caixa marcada: grava quando e o texto do servidor; texto mandado pelo navegador é ignorado", async () => {
  const antes = Date.now();
  expect(await pedirContatoProprietarioAcao({}, formulario({ autorizacaoTexto: "Autorizo tudo (texto forjado)" }))).toEqual({ ok: true });
  const [p] = await linhas();
  expect(p).toMatchObject({ autorizacaoVersao: 1, autorizacaoTexto: "Autorizo o uso destes dados só para a Sua Casa Exemplo me responder sobre a gestão do imóvel." });
  expect(p.autorizadoEm!.getTime()).toBeGreaterThanOrEqual(antes - 1000);
  expect(p.autorizadoEm).toEqual(p.criadoEm);
  expect(JSON.stringify(p)).not.toContain("forjado");
  expect(m.depois).toHaveBeenCalledTimes(1);
});

it("nome da empresa mudou depois que a página abriu: mostra o texto novo com a caixa desmarcada, sem gravar; marcando de novo, grava o texto novo", async () => {
  await salvarEmpresa(m.db, m.org, { nome: "Casa Nova Exemplo", razaoSocial: "", cnpj: "", email: "", telefone: "", endereco: "", encarregado: "", site: "", chavePix: "" }, null);
  const novo = autorizacaoDeOrigem("contato", "Casa Nova Exemplo");
  const r = await pedirContatoProprietarioAcao({}, formulario());
  expect(r).toEqual({
    erros: { consentimento: ERRO_AUTORIZACAO_MUDOU },
    mensagem: "Confira os campos destacados.",
    valores: expect.objectContaining({ nome: "Maria Exemplo", consentimento: "" }),
    autorizacao: novo,
  });
  // O campo escondido não volta nos valores do formulário.
  expect(r.valores).not.toHaveProperty("autorizacao");
  expect(await linhas()).toEqual([]);
  expect(m.depois).not.toHaveBeenCalled();
  expect(await pedirContatoProprietarioAcao(r, formulario({ autorizacao: novo.marca }))).toEqual({ ok: true });
  expect(await linhas()).toEqual([expect.objectContaining({ autorizacaoTexto: novo.texto })]);
});

it("versão nova publicada no painel (M7.15): a página aberta antes é recusada com o texto novo; a marca que a página lê agora grava a versão nova", async () => {
  const daPaginaAntiga = await autorizacaoEmVigor(m.db, m.org, "contato");
  expect(daPaginaAntiga).toEqual(autorizacaoDeOrigem("contato", "Sua Casa Exemplo"));
  expect(await publicarTextoAutorizacao(m.db, m.org, "contato", "Autorizo a {empresa} a me responder (texto fictício da versão 2).", null, "2026-10-15", 1)).toMatchObject({ ok: true });
  const daPagina = await autorizacaoEmVigor(m.db, m.org, "contato");
  expect(daPagina).toMatchObject({ versao: 2, texto: "Autorizo a Sua Casa Exemplo a me responder (texto fictício da versão 2)." });
  const r = await pedirContatoProprietarioAcao({}, formulario({ autorizacao: daPaginaAntiga.marca }));
  expect(r).toMatchObject({ erros: { consentimento: ERRO_AUTORIZACAO_MUDOU }, autorizacao: daPagina });
  expect(await linhas()).toEqual([]);
  expect(await pedirContatoProprietarioAcao(r, formulario({ autorizacao: daPagina.marca }))).toEqual({ ok: true });
  expect(await linhas()).toEqual([expect.objectContaining({ autorizacaoVersao: 2, autorizacaoTexto: daPagina.texto })]);
});
