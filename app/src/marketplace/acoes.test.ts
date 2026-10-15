/**
 * Envio do cadastro do marketplace pelo site (M12.3, passo 2) com o registro da autorização (M7.14): a caixa é
 * obrigatória, o texto gravado é o do servidor e, se o texto mudou depois que a página abriu, a pessoa vê o texto novo e
 * marca de novo.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { cadastrosMarketplace, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { publicarTextoAutorizacao } from "@/configuracoes/autorizacao-proprietarios";
import { autorizacaoDeOrigem, ERRO_AUTORIZACAO_MUDOU, montarAutorizacao } from "@/proprietarios/autorizacao";

const m = vi.hoisted(() => ({ db: null as unknown as Db, org: "", apagar: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: m.apagar }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirecionou para ${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// A sessão do cadastro (cookie assinado do e-mail confirmado): aqui, sempre a mesma pessoa fictícia.
vi.mock("./sessao", () => ({ COOKIE_CADASTRO: "scl_cadastro", INICIO_CADASTRO: "/anunciar", VALIDADE_SESSAO_CADASTRO_MS: 60_000, emailDoCadastro: async () => "maria@example.com" }));
vi.mock("@/site/site", () => ({ organizacaoDoSite: async () => m.org }));
// O painel (aprovar/recusar) não entra aqui.
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: vi.fn() }));

const { enviarCadastroAcao } = await import("./acoes");

let close: () => Promise<void>;
beforeAll(async () => {
  let db: Db;
  ({ db, close } = await createTestDb());
  m.db = db;
});
afterAll(() => close());
beforeEach(async () => {
  // Uma organização nova por teste (os limites de pendentes são por organização).
  [{ id: m.org }] = await m.db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  m.apagar.mockReset();
});

const TEXTO = "Autorizo a equipe a usar estes dados para analisar o cadastro e entrar em contato comigo.";
const formulario = (over: Record<string, string> = {}) => {
  const f = new FormData();
  const campos = {
    nome: "Maria Exemplo",
    tipo: "fisica",
    telefone: "(21) 90000-0000",
    imovel_nome: "Apartamento Exemplo",
    imovel_bairro: "Ipanema",
    imovel_cidade: "Rio de Janeiro",
    imovel_endereco: "Rua Fictícia, 100",
    imovel_capacidade: "4",
    imovel_quartos: "2",
    imovel_banheiros: "1",
    imovel_descricao: "",
    anuncio: "novo",
    consentimento: "on",
    autorizacao: autorizacaoDeOrigem("cadastro", "Sua Casa Exemplo").marca,
    ...over,
  };
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const linhas = () => m.db.select().from(cadastrosMarketplace).where(eq(cadastrosMarketplace.organizacaoId, m.org));

it("sem a caixa marcada: volta com o erro na caixa e nada é gravado", async () => {
  const f = formulario();
  f.delete("consentimento");
  expect(await enviarCadastroAcao({}, f)).toMatchObject({ erros: { consentimento: "É preciso autorizar o uso dos dados para a análise." } });
  expect(await linhas()).toEqual([]);
});

it("com a caixa marcada: grava quando e o texto do servidor e segue para a página de enviado; texto do navegador é ignorado", async () => {
  await expect(enviarCadastroAcao({}, formulario({ autorizacaoTexto: "Autorizo tudo (texto forjado)" }))).rejects.toThrow("redirecionou para /anunciar/enviado");
  const [c] = await linhas();
  expect(c).toMatchObject({ email: "maria@example.com", situacao: "pendente", autorizacaoVersao: 1, autorizacaoTexto: TEXTO });
  expect(c.autorizadoEm).toEqual(c.criadoEm);
  expect(JSON.stringify(c)).not.toContain("forjado");
  expect(m.apagar).toHaveBeenCalledTimes(1);
});

it("texto mudou depois que a página abriu: mostra o texto novo com a caixa desmarcada, sem gravar; marcando de novo, grava", async () => {
  // A página abriu com a versão 1; antes do envio, saiu no painel a versão 2 do texto (M7.15).
  const marcaDaPagina = autorizacaoDeOrigem("cadastro", "Sua Casa Exemplo").marca;
  expect(await publicarTextoAutorizacao(m.db, m.org, "cadastro", "Texto fictício da versão 2 do cadastro.", null, "2026-10-15", 1)).toMatchObject({ ok: true });
  const novo = montarAutorizacao(2, "Texto fictício da versão 2 do cadastro.", "Sua Casa Exemplo");
  const r = await enviarCadastroAcao({}, formulario({ autorizacao: marcaDaPagina }));
  expect(r).toMatchObject({ erros: { consentimento: ERRO_AUTORIZACAO_MUDOU }, mensagem: "Confira os campos destacados.", valores: { nome: "Maria Exemplo", consentimento: "" }, autorizacao: novo });
  expect(await linhas()).toEqual([]);
  expect(m.apagar).not.toHaveBeenCalled();
  await expect(enviarCadastroAcao(r, formulario({ autorizacao: novo.marca }))).rejects.toThrow("redirecionou para /anunciar/enviado");
  expect(await linhas()).toEqual([expect.objectContaining({ autorizacaoVersao: 2, autorizacaoTexto: "Texto fictício da versão 2 do cadastro." })]);
});
