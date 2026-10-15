import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { organizacoes, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { atualizarImovel, CodigoDuplicado, criarImovel, listarImoveis, obterImovel, opcoesDeFiltro } from "./repositorio";
import { type DadosImovel, validarImovel } from "./validacao";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;

const dados = (over: Partial<DadosImovel> = {}): DadosImovel => ({
  codigo: "t1",
  nome: "Teste 1",
  publico: true,
  ativo: true,
  bairro: "Bairro",
  cidade: "Rio de Janeiro",
  endereco: "",
  fuso: "America/Sao_Paulo",
  capacidade: 2,
  quartos: 1,
  banheiros: 1,
  descricao: "",
  frase: "",
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [a, b] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  org = a.id;
  outraOrg = b.id;
});
afterEach(() => close());

describe("repositório de imóveis", () => {
  it("cria, lista em ordem de código e esconde inativos por padrão", async () => {
    await criarImovel(db, org, dados({ codigo: "t2", nome: "Dois" }), null);
    await criarImovel(db, org, dados({ codigo: "t1", nome: "Um" }), null);
    await criarImovel(db, org, dados({ codigo: "t3", nome: "Três", ativo: false }), null);
    expect((await listarImoveis(db, org)).map((i) => i.codigo)).toEqual(["t1", "t2"]);
    expect((await listarImoveis(db, org, { incluirInativos: true })).map((i) => i.codigo)).toEqual(["t1", "t2", "t3"]);
    expect(await opcoesDeFiltro(db, org)).toEqual([
      { codigo: "t1", nome: "Um" },
      { codigo: "t2", nome: "Dois" },
    ]);
  });

  it("não deixa repetir código na mesma organização, mas permite em outra", async () => {
    await criarImovel(db, org, dados(), null);
    await expect(criarImovel(db, org, dados(), null)).rejects.toBeInstanceOf(CodigoDuplicado);
    await expect(criarImovel(db, outraOrg, dados(), null)).resolves.toBeTruthy();
  });

  it("atualiza e protege contra código duplicado", async () => {
    const a = await criarImovel(db, org, dados({ codigo: "t1" }), null);
    await criarImovel(db, org, dados({ codigo: "t2" }), null);
    const salvo = await atualizarImovel(db, org, a.id, dados({ codigo: "t1", nome: "Novo nome" }), null);
    expect(salvo?.nome).toBe("Novo nome");
    expect(salvo!.atualizadoEm.getTime()).toBeGreaterThanOrEqual(a.atualizadoEm.getTime());
    await expect(atualizarImovel(db, org, a.id, dados({ codigo: "t2" }), null)).rejects.toBeInstanceOf(CodigoDuplicado);
  });

  it("não enxerga nem altera imóvel de outra organização", async () => {
    const a = await criarImovel(db, org, dados(), null);
    expect(await obterImovel(db, outraOrg, a.id)).toBeNull();
    expect(await atualizarImovel(db, outraOrg, a.id, dados({ nome: "Invasão" }), null)).toBeNull();
    expect((await obterImovel(db, org, a.id))?.nome).toBe("Teste 1");
    expect(await obterImovel(db, org, "não-é-uuid")).toBeNull();
  });

  it("frase de abertura (M7.17): grava pelo formulário, edita, apaga e cada mudança sai no histórico da ficha com o autor", async () => {
    const [{ id: autor }] = await db.insert(usuarios).values({ organizacaoId: org, email: "autora@example.com", nome: "Autora Fictícia", papel: "admin" }).returning();
    // O caminho do painel: o formulário passa pela validação (que apara a frase) e vai inteiro para o repositório.
    const formulario = { codigo: "t1", nome: "Teste 1", ativo: "on", descricao: "Descrição fictícia.", frase: "  Um refúgio fictício para dois.  " };
    const v = validarImovel(formulario);
    if (!v.ok) throw new Error("fixture");
    const im = await criarImovel(db, org, v.dados, autor);
    expect(im.frase).toBe("Um refúgio fictício para dois.");
    // Imóvel criado sem frase: vazia, nunca um texto de exemplo.
    const sem = validarImovel({ codigo: "t2", nome: "Teste 2" });
    if (!sem.ok) throw new Error("fixture");
    expect((await criarImovel(db, org, sem.dados, autor)).frase).toBe("");

    const editar = async (frase: string, extra: Record<string, string> = {}) => {
      const r = validarImovel({ ...formulario, ...extra, frase });
      if (!r.ok) throw new Error("fixture");
      return atualizarImovel(db, org, im.id, r.dados, autor);
    };
    expect((await editar("Dias leves fictícios."))?.frase).toBe("Dias leves fictícios.");
    expect((await obterImovel(db, org, im.id))?.frase).toBe("Dias leves fictícios.");
    // Salvar de novo sem mudar nada não registra; mudar só a descrição não mexe na frase.
    await editar("Dias leves fictícios.");
    expect((await editar("Dias leves fictícios.", { descricao: "Outra descrição fictícia." }))?.frase).toBe("Dias leves fictícios.");
    expect((await editar(""))?.frase).toBe("");

    const h = await historicoDe(db, org, "imovel", im.id);
    expect(h.map((l) => [l.acao, l.mudancas.frase ?? null])).toEqual([
      ["imovel.editar", ["Dias leves fictícios.", ""]],
      ["imovel.editar", null],
      ["imovel.editar", ["Um refúgio fictício para dois.", "Dias leves fictícios."]],
      ["imovel.criar", [null, "Um refúgio fictício para dois."]],
    ]);
    expect(h[1].mudancas).toEqual({ descricao: ["Descrição fictícia.", "Outra descrição fictícia."] });
    expect(h.every((l) => l.autor === "Autora Fictícia")).toBe(true);
  });

  it("só o cadastro grava a tabela de imóveis: nenhuma sincronização ou importação (Beds24, planilha, marketplace) escreve a frase", () => {
    // O cadastro (este repositório) é o único que grava; o apoio dos testes do pagamento monta um cenário fictício.
    const PERMITIDOS = ["src/imoveis/repositorio.ts", "src/pagamentos/testes.ts"];
    const raiz = process.cwd();
    const achados: string[] = [];
    (function varrer(dir: string) {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        const rel = relative(raiz, caminho).split(sep).join("/");
        if (statSync(caminho).isDirectory()) varrer(caminho);
        else if (/\.(ts|tsx|mts)$/.test(nome) && !/\.test\.tsx?$/.test(nome) && !PERMITIDOS.includes(rel)) {
          const codigo = readFileSync(caminho, "utf8");
          if (/\.(insert|update|delete)\(\s*(schema\.)?imoveis\s*\)/.test(codigo) || /\b(update|insert into|delete from)\s+"?imoveis"?\b/i.test(codigo)) achados.push(rel);
        }
      }
    })(join(raiz, "src"));
    (function varrer(dir: string) {
      for (const nome of readdirSync(dir)) if (/\.(ts|mts)$/.test(nome) && /\.(insert|update|delete)\(\s*imoveis\s*\)/.test(readFileSync(join(dir, nome), "utf8"))) achados.push(`scripts/${nome}`);
    })(join(raiz, "scripts"));
    expect(achados).toEqual([]);
  });
});
