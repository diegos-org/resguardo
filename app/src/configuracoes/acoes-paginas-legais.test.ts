import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado } from "@/acesso/politica";
import { organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { publicarPaginaLegalAcao } from "./acoes";
import { type DadosEmpresa, salvarEmpresa } from "./empresa";
import { lerPaginaLegal } from "./paginas-legais";
import { RASCUNHO_PAGINAS_LEGAIS } from "./paginas-legais-rascunho";

const m = vi.hoisted(() => ({ sessao: vi.fn(), db: { atual: null as unknown }, revalidar: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => m.db.atual }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidar }));
vi.mock("@/lib/datas", async (orig) => ({ ...(await orig<typeof import("@/lib/datas")>()), hojeISO: () => "2026-10-10" }));

// Dados fictícios da empresa, com todos os campos que os textos-base usam.
const EMPRESA: DadosEmpresa = {
  nome: "Casa Exemplo",
  razaoSocial: "Casa Exemplo Temporada Ltda.",
  cnpj: "00.000.000/0001-00",
  email: "contato@example.com",
  telefone: "(21) 90000-0000",
  endereco: "Rua Fictícia, 100, Rio de Janeiro, RJ",
  encarregado: "Pessoa Exemplo",
  site: "",
  chavePix: "",
};

let db: Db, close: () => Promise<void>, org: string, admin: string;
beforeEach(async () => {
  vi.clearAllMocks();
  ({ db, close } = await createTestDb());
  m.db.atual = db;
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Casa Exemplo" }).returning();
  [{ id: admin }] = await db.insert(usuarios).values({ organizacaoId: org, email: "admin@example.com", nome: "Admin", papel: "admin" }).returning();
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: admin, organizacaoId: org, imovelIds: [] });
});
afterEach(() => close());

const formulario = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const termos = (o: Record<string, string> = {}) => formulario({ documento: "termos", versaoBase: "0", texto: RASCUNHO_PAGINAS_LEGAIS.termos.secoes.texto, ...o });

describe("publicar uma página legal pelo painel (M7.4)", () => {
  it("publica a versão 1 datada de hoje, revalida o painel e a página do site; de novo, igual, não cria versão", async () => {
    await salvarEmpresa(db, org, EMPRESA, admin);
    expect(await publicarPaginaLegalAcao({}, termos())).toEqual({ ok: true, aviso: "Versão 1 publicada em 10/10/2026. O site já mostra esta versão; os próximos pagamentos pedem o aceite dela." });
    expect(m.revalidar.mock.calls).toEqual([["/painel/configuracoes/paginas-legais"], ["/termos"]]);
    const [v1] = await lerPaginaLegal(db, org, "termos");
    expect(v1).toMatchObject({ numero: 1, data: "2026-10-10", autorId: admin, valores: { cnpj: EMPRESA.cnpj } });
    expect(await publicarPaginaLegalAcao({}, termos({ versaoBase: "1" }))).toEqual({ ok: true, aviso: "Nada mudou: a versão 1, de 10/10/2026, continua valendo." });
    expect(await lerPaginaLegal(db, org, "termos")).toHaveLength(1);
  });

  it("Política de cancelamento com o prazo do formulário; prazo inválido volta como erro do campo, com o que foi digitado", async () => {
    await salvarEmpresa(db, org, EMPRESA, admin);
    const base = { documento: "cancelamento", versaoBase: "0", ...RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes };
    const recusa = await publicarPaginaLegalAcao({}, formulario({ ...base, diasReembolsoIntegral: "0" }));
    expect(recusa).toMatchObject({ mensagem: "Confira os campos destacados.", erros: { diasReembolsoIntegral: "Informe um número de dias entre 1 e 365." }, valores: { diasReembolsoIntegral: "0", versaoBase: "0" } });
    expect(m.revalidar).not.toHaveBeenCalled();
    expect(await publicarPaginaLegalAcao({}, formulario({ ...base, diasReembolsoIntegral: "21" }))).toMatchObject({ ok: true });
    expect(m.revalidar).toHaveBeenCalledWith("/cancelamento");
    expect((await lerPaginaLegal(db, org, "cancelamento"))[0]).toMatchObject({ regras: { diasReembolsoIntegral: 21 }, valores: { dias_reembolso_integral: "21" } });
  });

  it("recusada (falta dado da empresa, outra pessoa publicou no meio): nada é revalidado e o texto digitado volta com a versão base", async () => {
    const semEmpresa = await publicarPaginaLegalAcao({}, termos());
    expect(semEmpresa.mensagem).toContain("Preencha em Configurações → Empresa antes de publicar: razão social, CNPJ, endereço");
    expect(semEmpresa.valores).toMatchObject({ texto: RASCUNHO_PAGINAS_LEGAIS.termos.secoes.texto, versaoBase: "0" });
    await salvarEmpresa(db, org, EMPRESA, admin);
    await publicarPaginaLegalAcao({}, termos());
    m.revalidar.mockClear();
    const velha = await publicarPaginaLegalAcao({}, termos({ texto: "## Outro\n\nTexto {{nome_empresa}}." }));
    expect(velha.mensagem).toBe("Enquanto você editava, a versão 1 foi publicada por outra pessoa em 10/10/2026. Recarregue a página, confira o texto atual e publique de novo.");
    expect(velha.valores).toMatchObject({ versaoBase: "0", texto: "## Outro\n\nTexto {{nome_empresa}}." });
    expect(m.revalidar).not.toHaveBeenCalled();
    expect(await lerPaginaLegal(db, org, "termos")).toHaveLength(1);
  });

  it("documento fora da lista, versão base malformada e texto vazio são recusados sem gravar", async () => {
    await salvarEmpresa(db, org, EMPRESA, admin);
    expect(await publicarPaginaLegalAcao({}, termos({ documento: "como_funciona" }))).toEqual({ mensagem: "Documento desconhecido. Recarregue a página." });
    expect(await publicarPaginaLegalAcao({}, termos({ versaoBase: "-1" }))).toMatchObject({ mensagem: "Recarregue a página e tente de novo." });
    expect(await publicarPaginaLegalAcao({}, termos({ texto: "  " }))).toMatchObject({ erros: { texto: "Escreva esta parte antes de publicar." } });
    expect(await lerPaginaLegal(db, org, "termos")).toEqual([]);
    expect(m.revalidar).not.toHaveBeenCalled();
  });

  it("sem configuracao:editar, a ação é negada no servidor", async () => {
    m.sessao.mockResolvedValue({ papel: "operacao", usuarioId: admin, organizacaoId: org, imovelIds: [] });
    await expect(publicarPaginaLegalAcao({}, termos())).rejects.toThrow(AcessoNegado);
    expect(await lerPaginaLegal(db, org, "termos")).toEqual([]);
  });
});
