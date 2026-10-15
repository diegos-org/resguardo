import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { auditoria, cadastrosMarketplace, configuracoes, organizacoes, pedidosContatoProprietario, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { autorizacaoDeOrigem, ERROS_TEXTO_AUTORIZACAO, montarAutorizacao, TEXTOS_ORIGEM_AUTORIZACAO } from "@/proprietarios/autorizacao";
import {
  autorizacaoEmVigor,
  CAIXAS_AUTORIZACAO,
  conferirAutorizacao,
  enviosPorVersao,
  historicoDaAutorizacao,
  lerVersoesAutorizacao,
  publicarTextoAutorizacao,
  versaoDaAutorizacaoEmVigor,
} from "./autorizacao-proprietarios";
import { salvarEmpresa } from "./empresa";

let db: Db, close: () => Promise<void>, org: string, outra: string, admin: string;
const HOJE = "2026-10-15";
const NOVO = "Autorizo a {empresa} a usar estes dados só para responder sobre a gestão do imóvel (texto fictício da versão 2).";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outra }] = await db.insert(organizacoes).values([{ nome: "Sua Casa Exemplo" }, { nome: "Outra Empresa" }]).returning();
  [{ id: admin }] = await db.insert(usuarios).values({ organizacaoId: org, email: "admin@example.com", nome: "Admin Exemplo", papel: "admin" }).returning();
});
afterEach(() => close());

const configsDe = (o: string) => db.select().from(configuracoes).where(eq(configuracoes.organizacaoId, o));

describe("texto das caixas de autorização no painel (M7.15)", () => {
  it("sem nada publicado, vale a versão 1 do código: o mesmo texto e a mesma marca do M7.14, sem gravar nada no banco", async () => {
    for (const f of ["contato", "cadastro"] as const) {
      expect(await lerVersoesAutorizacao(db, org, f)).toEqual([]);
      const v = versaoDaAutorizacaoEmVigor(f, []);
      expect(v).toEqual({ numero: 1, data: "", autorId: null, secoes: { texto: TEXTOS_ORIGEM_AUTORIZACAO[f] } });
      expect(historicoDaAutorizacao(f, [])).toEqual([v]);
      expect(await autorizacaoEmVigor(db, org, f)).toEqual(autorizacaoDeOrigem(f, "Sua Casa Exemplo"));
    }
    expect((await autorizacaoEmVigor(db, org, "contato")).texto).toBe("Autorizo o uso destes dados só para a Sua Casa Exemplo me responder sobre a gestão do imóvel.");
    expect((await autorizacaoEmVigor(db, org, "cadastro")).texto).toBe("Autorizo a equipe a usar estes dados para analisar o cadastro e entrar em contato comigo.");
    expect(await configsDe(org)).toEqual([]);
  });

  it("publicar o mesmo texto da versão 1 não cria versão nem histórico", async () => {
    expect(await publicarTextoAutorizacao(db, org, "contato", `  ${TEXTOS_ORIGEM_AUTORIZACAO.contato}  `, admin, HOJE, 1)).toEqual({
      ok: true,
      mudou: false,
      versao: { numero: 1, data: "", autorId: null, secoes: { texto: TEXTOS_ORIGEM_AUTORIZACAO.contato } },
    });
    expect(await configsDe(org)).toEqual([]);
    expect(await db.select().from(auditoria).where(eq(auditoria.organizacaoId, org))).toEqual([]);
  });

  it("publicar texto novo cria a versão 2, numerada e datada de hoje, com quem publicou; a outra caixa e a outra empresa não mudam", async () => {
    const r = await publicarTextoAutorizacao(db, org, "contato", NOVO, admin, HOJE, 1);
    expect(r).toEqual({ ok: true, mudou: true, versao: { numero: 2, data: HOJE, autorId: admin, secoes: { texto: NOVO } } });
    const publicadas = await lerVersoesAutorizacao(db, org, "contato");
    expect(publicadas.map((v) => [v.numero, v.data, v.autorId])).toEqual([[2, HOJE, admin]]);
    expect(historicoDaAutorizacao("contato", publicadas).map((v) => [v.numero, v.data, v.secoes.texto])).toEqual([
      [1, "", TEXTOS_ORIGEM_AUTORIZACAO.contato],
      [2, HOJE, NOVO],
    ]);
    // A página e o servidor passam a ler a versão 2, com o nome da empresa de agora no lugar do marcador.
    expect(await autorizacaoEmVigor(db, org, "contato")).toEqual(montarAutorizacao(2, NOVO, "Sua Casa Exemplo"));
    expect((await autorizacaoEmVigor(db, org, "contato")).texto).toBe(
      "Autorizo a Sua Casa Exemplo a usar estes dados só para responder sobre a gestão do imóvel (texto fictício da versão 2).",
    );
    // Uma chave por caixa: o cadastro continua na versão 1; a outra empresa também.
    expect(await autorizacaoEmVigor(db, org, "cadastro")).toEqual(autorizacaoDeOrigem("cadastro", "Sua Casa Exemplo"));
    expect(await autorizacaoEmVigor(db, outra, "contato")).toEqual(autorizacaoDeOrigem("contato", "Outra Empresa"));
    const [linha] = await db.select().from(configuracoes).where(and(eq(configuracoes.organizacaoId, org), eq(configuracoes.chave, CAIXAS_AUTORIZACAO.contato.chave)));
    expect(linha.valor).toEqual({ versoes: [{ numero: 2, data: HOJE, autorId: admin, secoes: { texto: NOVO } }] });
    // O histórico de auditoria guarda o antes e o depois.
    const h = (await historicoDe(db, org, "configuracao", org)).filter((x) => x.acao === "configuracao.autorizacao_contato");
    expect(h.map((x) => x.mudancas)).toEqual([{ versao: [1, 2], "secao.texto": [TEXTOS_ORIGEM_AUTORIZACAO.contato, NOVO] }]);
  });

  it("texto vazio, com quebra de linha ou com marcação não é publicado (a caixa é obrigatória e o texto é puro); nada é gravado", async () => {
    for (const [texto, erro] of [
      ["", ERROS_TEXTO_AUTORIZACAO.vazio],
      ["   ", ERROS_TEXTO_AUTORIZACAO.vazio],
      [undefined, ERROS_TEXTO_AUTORIZACAO.vazio],
      ["Autorizo.\nOutra linha.", ERROS_TEXTO_AUTORIZACAO.linhas],
      ["Autorizo o <script>uso</script>.", ERROS_TEXTO_AUTORIZACAO.marcacao],
      ["Autorizo a {proprietario}.", ERROS_TEXTO_AUTORIZACAO.chaves],
      ["x".repeat(501), "Máximo de 500 caracteres (o texto tem 501)."],
    ] as const) {
      expect(await publicarTextoAutorizacao(db, org, "cadastro", texto, admin, HOJE, 1)).toEqual({
        ok: false,
        erro,
        erros: { texto: erro },
        atual: { numero: 1, data: "", autorId: null, secoes: { texto: TEXTOS_ORIGEM_AUTORIZACAO.cadastro } },
      });
    }
    expect(await configsDe(org)).toEqual([]);
    expect(await db.select().from(auditoria).where(eq(auditoria.organizacaoId, org))).toEqual([]);
  });

  it("formulário aberto numa versão que já mudou é recusado em vez de passar por cima", async () => {
    await publicarTextoAutorizacao(db, org, "contato", NOVO, admin, HOJE, 1);
    const r = await publicarTextoAutorizacao(db, org, "contato", "Outro texto fictício.", admin, HOJE, 1);
    expect(r).toMatchObject({ ok: false, erro: "Enquanto você editava, a versão 2 foi publicada por outra pessoa em 15/10/2026. Recarregue a página, confira o texto atual e publique de novo.", atual: { numero: 2 } });
    expect(await lerVersoesAutorizacao(db, org, "contato")).toHaveLength(1);
    // Com a base certa, sai a versão 3.
    expect(await publicarTextoAutorizacao(db, org, "contato", "Outro texto fictício.", admin, "2026-10-16", 2)).toMatchObject({ ok: true, versao: { numero: 3, data: "2026-10-16" } });
  });

  it("no envio: a marca da versão em vigor confere; depois de publicar a versão nova, a marca antiga é recusada e o texto novo volta", async () => {
    const v1 = autorizacaoDeOrigem("contato", "Sua Casa Exemplo");
    expect(await db.transaction((tx) => conferirAutorizacao(tx, org, "contato", v1.marca))).toEqual({ ok: true, autorizacao: v1 });
    await publicarTextoAutorizacao(db, org, "contato", NOVO, admin, HOJE, 1);
    const v2 = montarAutorizacao(2, NOVO, "Sua Casa Exemplo");
    expect(await db.transaction((tx) => conferirAutorizacao(tx, org, "contato", v1.marca))).toEqual({ ok: false, autorizacao: v2 });
    expect(await db.transaction((tx) => conferirAutorizacao(tx, org, "contato", v2.marca))).toEqual({ ok: true, autorizacao: v2 });
    // O nome da empresa entra na hora: nome novo muda o texto e a marca, sem versão nova.
    await salvarEmpresa(db, org, { nome: "Casa Nova Exemplo", razaoSocial: "", cnpj: "", email: "", telefone: "", endereco: "", encarregado: "", site: "", chavePix: "" }, null);
    const comNome = await db.transaction((tx) => conferirAutorizacao(tx, org, "contato", v2.marca));
    expect(comNome).toEqual({ ok: false, autorizacao: montarAutorizacao(2, NOVO, "Casa Nova Exemplo") });
    expect(comNome.autorizacao.texto).toContain("Autorizo a Casa Nova Exemplo a usar");
    expect(await lerVersoesAutorizacao(db, org, "contato")).toHaveLength(1);
  });

  it("envios por versão: contagem e o primeiro de cada uma, por caixa e por empresa; os sem registro não entram", async () => {
    const dados = { nome: "Maria Exemplo", telefone: "(21) 90000-0000", bairro: "Ipanema", cidade: "Rio de Janeiro" };
    const em = (iso: string) => new Date(iso);
    await db.insert(pedidosContatoProprietario).values([
      { organizacaoId: org, ...dados, email: "a@example.com", autorizadoEm: em("2026-10-15T13:00:00Z"), autorizacaoVersao: 1, autorizacaoTexto: "Texto v1." },
      { organizacaoId: org, ...dados, email: "b@example.com", autorizadoEm: em("2026-10-15T12:00:00Z"), autorizacaoVersao: 1, autorizacaoTexto: "Texto v1." },
      { organizacaoId: org, ...dados, email: "c@example.com", autorizadoEm: em("2026-10-16T12:00:00Z"), autorizacaoVersao: 2, autorizacaoTexto: "Texto v2." },
      { organizacaoId: org, ...dados, email: "antes@example.com" },
      { organizacaoId: outra, ...dados, email: "d@example.com", autorizadoEm: em("2026-10-15T12:00:00Z"), autorizacaoVersao: 1, autorizacaoTexto: "Texto v1." },
    ]);
    const contato = await enviosPorVersao(db, org, "contato");
    expect([...contato.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1, { envios: 2, primeiro: em("2026-10-15T12:00:00Z") }],
      [2, { envios: 1, primeiro: em("2026-10-16T12:00:00Z") }],
    ]);
    expect((await enviosPorVersao(db, outra, "contato")).get(1)).toEqual({ envios: 1, primeiro: em("2026-10-15T12:00:00Z") });
    expect((await enviosPorVersao(db, org, "cadastro")).size).toBe(0);
    await db.insert(cadastrosMarketplace).values({
      organizacaoId: org,
      email: "dona@example.com",
      nome: "Dona Exemplo",
      telefone: "(21) 90000-0001",
      imovel: { nome: "Apto Exemplo", bairro: "Leblon", cidade: "Rio de Janeiro", endereco: "Rua Fictícia, 1", capacidade: 2, quartos: 1, banheiros: 1, descricao: "" },
      anuncio: "novo",
      autorizadoEm: em("2026-10-15T12:30:00Z"),
      autorizacaoVersao: 1,
      autorizacaoTexto: "Texto v1.",
    });
    expect([...(await enviosPorVersao(db, org, "cadastro")).entries()]).toEqual([[1, { envios: 1, primeiro: em("2026-10-15T12:30:00Z") }]]);
  });
});
