import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pedirCodigo, verificarCodigo } from "@/acesso/codigo-email";
import { cadastrosMarketplace, codigosLogin, convites, imoveis, organizacoes, proprietarioImoveis, proprietarios, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { criarToken, lerToken } from "@/lib/token-assinado";
import {
  aprovarCadastro,
  contarPendentes,
  enviarCadastro,
  listarCadastros,
  MAX_CODIGOS_CADASTRO_POR_HORA,
  MAX_PENDENTES_POR_EMAIL,
  pedirCodigoCadastro,
  recusarCadastro,
  validarCadastro,
  verificarCodigoCadastro,
} from "./cadastro";

let db: Db;
let close: () => Promise<void>;
let org: string;
let correio: CorreioMemoria;
const segredo = "segredo-de-teste";
const agora = new Date("2026-09-25T15:00:00Z");

const form = (over: Record<string, string> = {}) => ({
  nome: "Maria Exemplo",
  tipo: "fisica",
  telefone: "(21) 90000-0000",
  consentimento: "on",
  imovel_nome: "Apartamento Exemplo",
  imovel_bairro: "Ipanema",
  imovel_cidade: "Rio de Janeiro",
  imovel_endereco: "Rua Fictícia, 100",
  imovel_capacidade: "4",
  imovel_quartos: "2",
  imovel_banheiros: "1",
  imovel_descricao: "Perto da praia.",
  anuncio: "ja_anuncio",
  links: "https://www.airbnb.com/rooms/000000",
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  correio = new CorreioMemoria();
});
afterEach(() => close());

describe("formulário do cadastro (M12.3)", () => {
  it("aceita o formulário completo e monta os dados", () => {
    const r = validarCadastro(form());
    expect(r).toEqual({
      ok: true,
      dados: {
        nome: "Maria Exemplo",
        tipo: "fisica",
        telefone: "(21) 90000-0000",
        imovel: { nome: "Apartamento Exemplo", bairro: "Ipanema", cidade: "Rio de Janeiro", endereco: "Rua Fictícia, 100", capacidade: 4, quartos: 2, banheiros: 1, descricao: "Perto da praia." },
        anuncio: "ja_anuncio",
        links: ["https://www.airbnb.com/rooms/000000"],
      },
    });
    // Anúncio novo: links ignorados; quartos/banheiros podem ficar em branco.
    expect(validarCadastro(form({ anuncio: "novo", links: "qualquer coisa", imovel_quartos: "", imovel_banheiros: "" }))).toMatchObject({ ok: true, dados: { links: [], imovel: { quartos: null, banheiros: null } } });
  });

  it("recusa o que falta ou está errado, sem supor", () => {
    const r = validarCadastro(form({ nome: "", telefone: "123", consentimento: "", imovel_bairro: "", imovel_capacidade: "0", anuncio: "", imovel_quartos: "x" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(["anuncio", "consentimento", "imovel_bairro", "imovel_capacidade", "imovel_quartos", "nome", "telefone"]);
    expect(validarCadastro(form({ telefone: `(21) 90000-0000${" -".repeat(500)}` }))).toMatchObject({ ok: false, erros: { telefone: expect.any(String) } });
    expect(validarCadastro(form({ telefone: "abcdefghij1234567890" }))).toMatchObject({ ok: false, erros: { telefone: expect.any(String) } });
    expect(validarCadastro(form({ telefone: "+55 (21) 90000-0000" })).ok).toBe(true);
    expect(validarCadastro(form({ links: "" }))).toMatchObject({ ok: false, erros: { links: expect.any(String) } });
    expect(validarCadastro(form({ links: "http://inseguro.example.com/x" }))).toMatchObject({ ok: false, erros: { links: expect.any(String) } });
    expect(validarCadastro(form({ links: "https://a.example/1 https://a.example/2 https://a.example/3 https://a.example/4" }))).toMatchObject({ ok: false });
  });
});

describe("código de confirmação do e-mail (M12.3)", () => {
  it("qualquer e-mail válido recebe; o código do cadastro não entra no painel", async () => {
    expect(await pedirCodigoCadastro(db, correio, org, "Maria@Example.com", { segredo, agora, gerar: () => "111111" })).toBe("enviado");
    expect(correio.enviadas[0]).toMatchObject({ para: "maria@example.com" });
    expect(correio.enviadas[0].texto).toContain("Sua Casa Exemplo");
    expect(await verificarCodigo(db, "maria@example.com", "111111", { segredo, agora })).toMatchObject({ ok: false });
    expect(await verificarCodigoCadastro(db, "maria@example.com", "111111", { segredo, agora })).toEqual({ ok: true, email: "maria@example.com" });
    expect(await pedirCodigoCadastro(db, correio, org, "nao-e-email", { segredo, agora })).toBe("invalido");
  });

  it("abuso no cadastro não trava o login da equipe (teto geral separado)", async () => {
    await db.insert(codigosLogin).values(
      Array.from({ length: MAX_CODIGOS_CADASTRO_POR_HORA }, (_, i) => ({ email: `cadastro:x${i}@example.com`, codigoHash: "x", expiraEm: agora, criadoEm: agora })),
    );
    expect(await pedirCodigoCadastro(db, correio, org, "nova@example.com", { segredo, agora })).toBe("limite");
    await db.insert(usuarios).values({ organizacaoId: org, email: "equipe@example.com", nome: "Equipe", papel: "operacao" });
    expect(await pedirCodigo(db, correio, "equipe@example.com", { segredo, agora, adminEmails: [] })).toBe("enviado");
  });

  it("pedidos simultâneos não passam do limite (reserva antes de enviar)", async () => {
    let soltar: () => void = () => undefined;
    const portao = new Promise<void>((r) => (soltar = r));
    let enviados = 0;
    const lento = { nome: "lento", enviar: async () => { enviados++; await portao; } };
    // Mesmo e-mail: no máximo 5 por hora.
    const mesmos = Array.from({ length: 12 }, (_, i) => pedirCodigoCadastro(db, lento, org, "alvo@example.com", { segredo, agora, gerar: () => String(100000 + i) }));
    // Muitos e-mails: no máximo 50 por hora no total do cadastro.
    const varios = Array.from({ length: 70 }, (_, i) => pedirCodigoCadastro(db, lento, org, `v${i}@example.com`, { segredo, agora }));
    await new Promise((r) => setTimeout(r, 200));
    soltar();
    const rs = await Promise.all([...mesmos, ...varios]);
    expect(rs.slice(0, 12).filter((r) => r === "enviado").length).toBeLessThanOrEqual(5);
    expect(rs.filter((r) => r === "enviado").length).toBeLessThanOrEqual(MAX_CODIGOS_CADASTRO_POR_HORA);
    expect(enviados).toBeLessThanOrEqual(MAX_CODIGOS_CADASTRO_POR_HORA);
    // O último código válido do alvo funciona; só um fica valendo.
    const ativos = (await db.select().from(codigosLogin).where(eq(codigosLogin.email, "cadastro:alvo@example.com"))).filter((c) => !c.invalidadoEm);
    expect(ativos).toHaveLength(1);
  });

  it("sessão do cadastro não vale como sessão do hóspede (e vice-versa)", () => {
    const t = criarToken("cadastro-marketplace:sessao:v1", "maria@example.com", segredo, agora, 60_000);
    expect(lerToken("cadastro-marketplace:sessao:v1", t, segredo, agora)).toBe("maria@example.com");
    expect(lerToken("portal-hospede:sessao:v1", t, segredo, agora)).toBeNull();
    expect(lerToken("cadastro-marketplace:sessao:v1", t, segredo, new Date(agora.getTime() + 60_000))).toBeNull();
  });
});

describe("pedido e revisão (M12.3)", () => {
  const enviar = async (email = "maria@example.com", over: Record<string, string> = {}) => {
    const v = validarCadastro(form(over));
    if (!v.ok) throw new Error("form inválido");
    return enviarCadastro(db, org, email, v.dados, agora);
  };

  it("pedido fica pendente; nada é criado antes da aprovação; limite por e-mail", async () => {
    for (let i = 0; i < MAX_PENDENTES_POR_EMAIL; i++) expect(await enviar()).toMatchObject({ ok: true });
    expect(await enviar()).toMatchObject({ ok: false, erro: expect.stringContaining("em análise") });
    expect(await enviar("outra@example.com")).toMatchObject({ ok: true });
    expect(await contarPendentes(db, org)).toBe(MAX_PENDENTES_POR_EMAIL + 1);
    expect(await db.select().from(proprietarios)).toHaveLength(0);
    expect(await db.select().from(imoveis)).toHaveLength(0);
  });

  it("aprovar cria proprietário, imóvel NÃO público ligado a ele e o convite; tudo ou nada", async () => {
    const r = await enviar();
    const id = r.ok ? r.id : "";
    // Código de imóvel inválido: nada é criado.
    expect(await aprovarCadastro(db, org, id, "Código Ruim", null, agora)).toMatchObject({ ok: false });
    expect(await db.select().from(proprietarios)).toHaveLength(0);

    const a = await aprovarCadastro(db, org, id, "ipa-100", null, agora);
    expect(a).toMatchObject({ ok: true, email: "maria@example.com", token: expect.any(String) });
    const [p] = await db.select().from(proprietarios);
    expect(p).toMatchObject({ nome: "Maria Exemplo", email: "maria@example.com", telefone: "(21) 90000-0000", documento: "", chavePix: "" });
    expect(p.observacoes).toContain("https://www.airbnb.com/rooms/000000");
    const [i] = await db.select().from(imoveis);
    expect(i).toMatchObject({ codigo: "ipa-100", nome: "Apartamento Exemplo", publico: false, ativo: true, capacidade: 4, endereco: "Rua Fictícia, 100" });
    expect(await db.select().from(proprietarioImoveis)).toEqual([expect.objectContaining({ proprietarioId: p.id, imovelId: i.id })]);
    expect(await db.select().from(convites)).toEqual([expect.objectContaining({ proprietarioId: p.id, email: "maria@example.com" })]);
    const [c] = await db.select().from(cadastrosMarketplace);
    expect(c).toMatchObject({ situacao: "aprovado", proprietarioId: p.id, imovelId: i.id });
    // Não aprova duas vezes.
    expect(await aprovarCadastro(db, org, id, "ipa-101", null, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("já foi decidido") });
  });

  it("código de imóvel já usado ou e-mail da equipe: não aprova e não deixa nada pela metade", async () => {
    await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Já existe" });
    const r = await enviar();
    const id = r.ok ? r.id : "";
    expect(await aprovarCadastro(db, org, id, "403", null, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("403") });
    expect(await db.select().from(proprietarios)).toHaveLength(0);

    await db.insert(usuarios).values({ organizacaoId: org, email: "equipe@example.com", nome: "Equipe", papel: "operacao" });
    const r2 = await enviar("equipe@example.com");
    expect(await aprovarCadastro(db, org, r2.ok ? r2.id : "", "novo-1", null, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("Convite") });
    expect(await db.select().from(proprietarios)).toHaveLength(0);
    expect(await db.select().from(imoveis)).toHaveLength(1);
    expect((await db.select().from(cadastrosMarketplace).where(eq(cadastrosMarketplace.email, "equipe@example.com")))[0].situacao).toBe("pendente");
  });

  it("recusar exige motivo; outra organização não vê nem decide", async () => {
    const r = await enviar();
    const id = r.ok ? r.id : "";
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra" }).returning();
    expect(await recusarCadastro(db, outra, id, "não", null)).toMatchObject({ ok: false });
    expect(await aprovarCadastro(db, outra, id, "x1", null)).toMatchObject({ ok: false });
    expect((await listarCadastros(db, outra)).pendentes).toHaveLength(0);
    expect(await recusarCadastro(db, org, id, "  ", null)).toMatchObject({ ok: false });
    expect(await recusarCadastro(db, org, id, "Fora da região atendida.", null, agora)).toEqual({ ok: true });
    const l = await listarCadastros(db, org);
    expect(l.pendentes).toHaveLength(0);
    expect(l.decididos[0]).toMatchObject({ situacao: "recusado", motivoRecusa: "Fora da região atendida." });
  });
});
