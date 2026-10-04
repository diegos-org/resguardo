import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { podeFazer } from "@/acesso/politica";
import * as aplicar from "@/financeiro/aplicar";
import { ABAS_CONFIG } from "./abas";
import { and, eq } from "drizzle-orm";
import { historicoDe } from "@/auditoria/auditoria";
import { criarContrato } from "@/contratos/repositorio";
import { auditoria, configuracoes, imoveis, organizacoes, proprietarioImoveis, proprietarios, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { saldoAcerto } from "@/financeiro/ledger";
import { REGRAS_PADRAO } from "@/financeiro/motor";
import type { DadosReserva } from "@/reservas/regras";
import { sincronizarReserva } from "@/reservas/repositorio";
import { lerEmpresa, nomeDaEmpresa, nomeDaEmpresaPorEmail, salvarEmpresa, validarEmpresa } from "./empresa";
import { criarModelo, excluirModelo, garantirModelosIniciais, listarModelos, MODELOS_INICIAIS, preencherModelo, atualizarModelo, validarModelo } from "./modelos";
import { lerFormRegras, lerRegrasFinanceiras, lerVersoesRegras, normalizarRegras, prazoDoCanal, regrasNaData, versoesDe } from "./regras-financeiras";
import { salvarRegrasFinanceiras } from "./salvar-regras";
import { lerTextosSite, salvarTextosSite, TEXTOS_SITE_INICIAIS, validarTextosSite } from "./textos-site";
import { alterarUsuario, criarUsuarioEquipe, listarUsuarios } from "./usuarios";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;
let admin: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: admin }] = await db.insert(usuarios).values({ organizacaoId: org, email: "admin@example.com", nome: "Admin", papel: "admin" }).returning();
});
afterEach(() => {
  vi.restoreAllMocks();
  return close();
});

describe("regras financeiras", () => {
  let im: string;
  let dono: string;
  const reserva = (externo: string, over: Partial<DadosReserva>): DadosReserva => ({
    imovelId: im,
    origem: "booking",
    estado: "confirmada",
    checkin: "2030-10-10",
    checkout: "2030-10-13",
    hospedes: 2,
    hospedeNome: `Teste ${externo}`,
    hospedeEmail: "",
    hospedeTelefone: "",
    hospedeOrigem: "",
    moeda: "BRL",
    valorBruto: 150000,
    taxaCanal: 22500,
    valorLiquido: null,
    codigoCanal: "",
    observacoes: "",
    ...over,
  });
  const sinc = async (externo: string, over: Partial<DadosReserva> = {}) => {
    const r = await sincronizarReserva(db, org, "beds24", externo, reserva(externo, over));
    if (!r.ok) throw new Error("falhou");
    return r.reserva.id;
  };

  beforeEach(async () => {
    [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "t1", nome: "Um" }).returning();
    [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona", email: "dona@example.com" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im });
    await criarContrato(db, org, im, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  });

  it("sem nada gravado vale o padrão confirmado por Diego", async () => {
    expect(await lerRegrasFinanceiras(db, org)).toEqual(REGRAS_PADRAO);
  });

  it("valor gravado estranho cai no padrão, campo a campo", () => {
    expect(normalizarRegras({ base: "x", recebimento: { airbnb: "empresa", booking: 3 } })).toEqual({
      base: "liquido_canal",
      recebimento: { ...REGRAS_PADRAO.recebimento, airbnb: "empresa" },
      prazoPagamento: REGRAS_PADRAO.prazoPagamento,
    });
  });

  it("prazo de pagamento por canal (M4.12): padrão Airbnb 1 dia; null = sem regra; fora de 0–60 ou não inteiro cai no padrão; versão antiga sem o campo lê o padrão", () => {
    expect(normalizarRegras(null).prazoPagamento).toEqual({ airbnb: 1, booking: null, site: null, direta: null, outro: null });
    expect(normalizarRegras({ prazoPagamento: { airbnb: null, booking: 3, site: "x", direta: 99, outro: 1.5 } }).prazoPagamento).toEqual({ airbnb: null, booking: 3, site: null, direta: null, outro: null });
    expect(prazoDoCanal({ base: "liquido_canal", recebimento: REGRAS_PADRAO.recebimento }, "airbnb")).toBe(1);
    expect(prazoDoCanal({ base: "liquido_canal", recebimento: REGRAS_PADRAO.recebimento }, "booking")).toBeNull();
    expect(prazoDoCanal(normalizarRegras({ prazoPagamento: { airbnb: null } }), "airbnb")).toBeNull();
    // Formulário: campo ausente = padrão; vazio = sem regra; dígitos de 0 a 60; o resto é recusado.
    const form = { base: "liquido_canal", recebimento_airbnb: "split", recebimento_booking: "empresa", recebimento_site: "empresa", recebimento_direta: "empresa", recebimento_outro: "empresa" };
    expect(lerFormRegras(form)?.prazoPagamento).toEqual(REGRAS_PADRAO.prazoPagamento);
    expect(lerFormRegras({ ...form, prazo_airbnb: "", prazo_booking: "2", prazo_site: " 0 ", prazo_direta: "60" })?.prazoPagamento).toEqual({ airbnb: null, booking: 2, site: 0, direta: 60, outro: null });
    expect(lerFormRegras({ ...form, prazo_airbnb: "61" })).toBeNull();
    expect(lerFormRegras({ ...form, prazo_airbnb: "-1" })).toBeNull();
    expect(lerFormRegras({ ...form, prazo_airbnb: "1.5" })).toBeNull();
    expect(lerFormRegras({ ...form, prazo_airbnb: "abc" })).toBeNull();
  });

  it("mudar o prazo do canal grava uma versão nova e registra a mudança; apagar a regra também; a data da reserva escolhe a versão", async () => {
    const novas = { ...REGRAS_PADRAO, prazoPagamento: { ...REGRAS_PADRAO.prazoPagamento!, airbnb: 2 } };
    const r = await salvarRegrasFinanceiras(db, org, novas, admin);
    expect(r.mudou).toBe(true);
    expect(await lerRegrasFinanceiras(db, org)).toEqual(novas);
    expect((await lerVersoesRegras(db, org)).at(-1)?.prazoPagamento).toEqual(novas.prazoPagamento);
    expect(JSON.stringify(await historicoDe(db, org, "configuracao", org))).toContain('"prazoPagamento.airbnb":[1,2]');
    expect((await salvarRegrasFinanceiras(db, org, novas, admin)).mudou).toBe(false);
    const semRegra = { ...novas, prazoPagamento: { ...novas.prazoPagamento, airbnb: null } };
    expect((await salvarRegrasFinanceiras(db, org, semRegra, admin)).mudou).toBe(true);
    expect(prazoDoCanal(await lerRegrasFinanceiras(db, org), "airbnb")).toBeNull();
    // Antes de qualquer versão vale o padrão: uma reserva antiga do Airbnb segue com 1 dia.
    expect(prazoDoCanal(regrasNaData(await lerVersoesRegras(db, org), "2026-01-01"), "airbnb")).toBe(1);
  });

  it("formulário com opção inválida é recusado", () => {
    const ok = { base: "bruto", recebimento_airbnb: "split", recebimento_booking: "empresa", recebimento_site: "empresa", recebimento_direta: "a_confirmar", recebimento_outro: "empresa" };
    expect(lerFormRegras(ok)?.recebimento.direta).toBe("a_confirmar");
    expect(lerFormRegras({ ...ok, recebimento_site: "hackear" })).toBeNull();
    expect(lerFormRegras({ ...ok, base: "" })).toBeNull();
  });

  it("mudar o padrão recalcula só de hoje em diante; o passado não muda", async () => {
    const futura = await sinc("1");
    const passada = await sinc("2", { checkin: "2025-11-10", checkout: "2025-11-12" });
    const saldoFutura = await saldoAcerto(db, org, { proprietarioId: dono });
    expect(saldoFutura).toBeGreaterThan(0); // Booking: empresa recebe e deve a parte da dona

    const novas = { ...REGRAS_PADRAO, recebimento: { ...REGRAS_PADRAO.recebimento, booking: "split" as const } };
    const r = await salvarRegrasFinanceiras(db, org, novas, admin);
    expect(r.mudou).toBe(true);
    expect(r.recalculo?.reservas).toBe(1); // só a futura
    expect(await lerRegrasFinanceiras(db, org)).toEqual(novas);

    // A passada continua como estava; a futura deixou de gerar dívida da empresa.
    const { listarLancamentos } = await import("@/financeiro/ledger");
    const daPassada = await listarLancamentos(db, org, { reservaId: passada });
    expect(daPassada.some((l) => l.estornoDe)).toBe(false);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBeLessThan(saldoFutura);
    expect((await listarLancamentos(db, org, { reservaId: futura })).some((l) => l.estornoDe)).toBe(true);

    // Salvar igual não recalcula nem registra histórico de novo.
    expect((await salvarRegrasFinanceiras(db, org, novas, admin)).mudou).toBe(false);
    expect(await historicoDe(db, org, "configuracao", org)).toHaveLength(1);
  });

  it("sincronizar de novo uma reserva antiga usa a regra da época, não a de hoje", async () => {
    const passada = await sinc("5", { checkin: "2025-11-10", checkout: "2025-11-12" });
    const { listarLancamentos } = await import("@/financeiro/ledger");
    const antes = await listarLancamentos(db, org, { reservaId: passada });
    await salvarRegrasFinanceiras(db, org, { base: "bruto", recebimento: { ...REGRAS_PADRAO.recebimento, booking: "split" } }, admin);
    await sinc("5", { checkin: "2025-11-10", checkout: "2025-11-12" }); // Beds24 manda de novo
    const depois = await listarLancamentos(db, org, { reservaId: passada });
    expect(depois).toHaveLength(antes.length);
    expect(depois.some((l) => l.estornoDe)).toBe(false);
    expect(await lerRegrasFinanceiras(db, org, "2025-11-10")).toEqual(REGRAS_PADRAO);
  });

  it("versões: cada data usa a vigente; salvar de novo no mesmo dia substitui a do dia", () => {
    const v = versoesDe({
      versoes: [
        { desde: "2027-01-01", base: "bruto", recebimento: {} },
        { desde: "2026-01-01", base: "liquido_canal", recebimento: { airbnb: "empresa" } },
        { desde: "lixo", base: "bruto" },
      ],
    });
    expect(v.map((x) => x.desde)).toEqual(["2026-01-01", "2027-01-01"]);
    expect(regrasNaData(v, "2025-12-31")).toEqual(REGRAS_PADRAO);
    expect(regrasNaData(v, "2026-06-01").recebimento.airbnb).toBe("empresa");
    expect(regrasNaData(v, "2027-01-01").base).toBe("bruto");
  });

  it("duas mudanças no mesmo dia ficam numa versão só", async () => {
    await salvarRegrasFinanceiras(db, org, { ...REGRAS_PADRAO, base: "bruto" }, admin);
    await salvarRegrasFinanceiras(db, org, { ...REGRAS_PADRAO, recebimento: { ...REGRAS_PADRAO.recebimento, site: "split" } }, admin);
    const v = await lerVersoesRegras(db, org);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ base: "liquido_canal", recebimento: { site: "split" } });
  });

  it("reserva nova já nasce com a regra da empresa", async () => {
    await salvarRegrasFinanceiras(db, org, { ...REGRAS_PADRAO, recebimento: { ...REGRAS_PADRAO.recebimento, booking: "a_confirmar" } }, admin);
    const id = await sinc("3");
    const { listarLancamentos } = await import("@/financeiro/ledger");
    const l = await listarLancamentos(db, org, { reservaId: id });
    expect(l.some((x) => x.estado === "pendente")).toBe(true);
  });

  it("se o recálculo falhar, a regra nova não é gravada (tudo-ou-nada)", async () => {
    await sinc("4");
    vi.spyOn(aplicar, "recalcularReservas").mockRejectedValueOnce(new Error("queda do banco"));
    await expect(salvarRegrasFinanceiras(db, org, { ...REGRAS_PADRAO, base: "bruto" }, admin)).rejects.toThrow("queda do banco");
    expect(await lerRegrasFinanceiras(db, org)).toEqual(REGRAS_PADRAO);
    expect(await db.select().from(configuracoes)).toEqual([]);
  });

  it("cada organização tem as suas regras", async () => {
    await salvarRegrasFinanceiras(db, org, { ...REGRAS_PADRAO, base: "bruto" }, admin);
    expect((await lerRegrasFinanceiras(db, outraOrg)).base).toBe("liquido_canal");
  });
});

describe("empresa", () => {
  const base = { nome: "Sua Casa Leblon", razaoSocial: "", cnpj: "", email: "", telefone: "", endereco: "", site: "", chavePix: "" };

  it("valida nome, e-mail, CNPJ e site", () => {
    expect(validarEmpresa({ ...base, nome: " " })).toMatchObject({ ok: false, erros: { nome: expect.any(String) } });
    const r = validarEmpresa({ ...base, email: "x", cnpj: "123", site: "sualeblon.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(["cnpj", "email", "site"]);
    expect(validarEmpresa({ ...base, cnpj: "12.345.678/0001-90", email: "Contato@Example.com" })).toMatchObject({ ok: true, dados: { email: "contato@example.com" } });
  });

  it("nome vai para a organização (onde o sistema já lê) e o resto para a configuração", async () => {
    await salvarEmpresa(db, org, { ...base, nome: "SCL", telefone: "+55 21 0000-0000", chavePix: "financeiro@example.com" }, admin);
    const [o] = await db.select().from(organizacoes).where(eq(organizacoes.id, org));
    expect(o.nome).toBe("SCL");
    expect(await lerEmpresa(db, org)).toMatchObject({ nome: "SCL", telefone: "+55 21 0000-0000", chavePix: "financeiro@example.com" });
    expect((await lerEmpresa(db, outraOrg)).telefone).toBe("");
    const [c] = await db.select().from(configuracoes).where(eq(configuracoes.organizacaoId, org));
    expect(c.valor).not.toHaveProperty("nome");
    // O nome salvo é o que aparece no painel e nos e-mails.
    expect(await nomeDaEmpresa(db, org)).toBe("SCL");
    expect(await nomeDaEmpresaPorEmail(db, "ADMIN@example.com")).toBe("SCL");
    expect(["SCL", "B"]).toContain(await nomeDaEmpresaPorEmail(db, "ninguem@example.com")); // sem usuário: organização mais antiga
  });

  it("a chave Pix da empresa não fica em claro no histórico", async () => {
    await salvarEmpresa(db, org, { ...base, chavePix: "financeiro@example.com", telefone: "1" }, admin);
    await salvarEmpresa(db, org, { ...base, chavePix: "outra@example.com", telefone: "1" }, admin);
    const h = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, "configuracao.empresa")));
    expect(JSON.stringify(h.map((x) => x.mudancas))).not.toContain("example.com");
    const comPix = h.filter((x) => (x.mudancas as Record<string, unknown>).chavePix);
    expect(comPix.length).toBe(2);
    expect(comPix.every((x) => JSON.stringify((x.mudancas as Record<string, unknown>).chavePix) === JSON.stringify(["(alterado)", "(alterado)"]))).toBe(true);
    expect(h.some((x) => (x.mudancas as Record<string, unknown>).telefone)).toBe(true);
  });
});

describe("textos do site", () => {
  it("começa com textos iniciais, valida limites e grava", async () => {
    expect(await lerTextosSite(db, org)).toEqual(TEXTOS_SITE_INICIAIS);
    expect(validarTextosSite({ titulo: "" }).ok).toBe(false);
    expect(validarTextosSite({ titulo: "Oi", sobre: "x".repeat(2001) }).ok).toBe(false);
    const v = validarTextosSite({ ...TEXTOS_SITE_INICIAIS, titulo: "Novo título", sobre: "linha 1\r\nlinha 2" });
    if (!v.ok) throw new Error("inválido");
    expect(await salvarTextosSite(db, org, v.textos, admin)).toBe(true);
    expect(await salvarTextosSite(db, org, v.textos, admin)).toBe(false);
    expect(await lerTextosSite(db, org)).toMatchObject({ titulo: "Novo título", sobre: "linha 1\nlinha 2" });
  });
});

describe("usuários da equipe", () => {
  it("cria com papel da equipe; e-mail repetido e papel de proprietário são recusados", async () => {
    expect(await criarUsuarioEquipe(db, org, { nome: "Bia", email: "Bia@Example.com", papel: "operacao" }, admin)).toEqual({ ok: true });
    expect(await criarUsuarioEquipe(db, org, { nome: "Bia 2", email: "bia@example.com", papel: "admin" }, admin)).toMatchObject({ ok: false });
    expect(await criarUsuarioEquipe(db, org, { nome: "X", email: "x@example.com", papel: "proprietario" }, admin)).toMatchObject({ ok: false });
    const lista = await listarUsuarios(db, org);
    expect(lista.map((u) => u.email)).toContain("bia@example.com");
  });

  it("e-mail com convite de proprietário pendente não vira usuário da equipe", async () => {
    const { criarConvite, revogarConvite } = await import("@/convites/convites");
    const [p] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dono", email: "dono@example.com" }).returning();
    const c = await criarConvite(db, org, p.id, "dono@example.com", admin);
    if (!c.ok) throw new Error(c.erro);
    expect(await criarUsuarioEquipe(db, org, { nome: "Dono", email: "Dono@example.com", papel: "operacao" }, admin)).toMatchObject({
      ok: false,
      erro: expect.stringContaining("convite"),
    });
    await revogarConvite(db, org, c.convite.id, admin);
    expect(await criarUsuarioEquipe(db, org, { nome: "Dono", email: "dono@example.com", papel: "operacao" }, admin)).toEqual({ ok: true });
  });

  it("ninguém muda o próprio papel nem se desativa; sempre sobra um admin ativo", async () => {
    await criarUsuarioEquipe(db, org, { nome: "Bia", email: "bia@example.com", papel: "admin" }, admin);
    const bia = (await listarUsuarios(db, org)).find((u) => u.email === "bia@example.com")!;
    expect(await alterarUsuario(db, org, admin, { papel: "operacao" }, admin)).toMatchObject({ ok: false });
    expect(await alterarUsuario(db, org, admin, { ativo: false }, admin)).toMatchObject({ ok: false });
    expect(await alterarUsuario(db, org, admin, { nome: "Diego", papel: "admin" }, admin)).toEqual({ ok: true });
    // Bia pode rebaixar o admin original, mas aí ninguém pode rebaixar a Bia (seria o último).
    expect(await alterarUsuario(db, org, admin, { papel: "operacao" }, bia.id)).toEqual({ ok: true });
    const [u] = await db.select().from(usuarios).where(eq(usuarios.id, admin));
    expect(u).toMatchObject({ papel: "operacao", nome: "Diego" });
    expect(await historicoDe(db, org, "usuario", admin)).toHaveLength(2);
  });

  it("o último admin ativo não pode ser desativado por outro", async () => {
    await criarUsuarioEquipe(db, org, { nome: "Op", email: "op@example.com", papel: "operacao" }, admin);
    const op = (await listarUsuarios(db, org)).find((u) => u.email === "op@example.com")!;
    expect(await alterarUsuario(db, org, admin, { ativo: false }, op.id)).toMatchObject({ ok: false, erro: expect.stringContaining("administrador") });
  });

  it("não mexe em usuário de outra organização nem em proprietário", async () => {
    const [fora] = await db.insert(usuarios).values({ organizacaoId: outraOrg, email: "fora@example.com", nome: "Fora", papel: "operacao" }).returning();
    const [dono] = await db.insert(usuarios).values({ organizacaoId: org, email: "dono@example.com", nome: "Dono", papel: "proprietario" }).returning();
    expect(await alterarUsuario(db, org, fora.id, { ativo: false }, admin)).toMatchObject({ ok: false });
    expect(await alterarUsuario(db, org, dono.id, { papel: "admin" }, admin)).toMatchObject({ ok: false });
    expect(await alterarUsuario(db, org, "nao-e-uuid", { ativo: false }, admin)).toMatchObject({ ok: false });
  });
});

describe("modelos de mensagem", () => {
  it("preenche variáveis e deixa intactas as que não têm valor", () => {
    expect(preencherModelo("Olá, {hospede}! {checkin} {x}", { hospede: "Ana", checkin: "10/10" })).toBe("Olá, Ana! 10/10 {x}");
    expect(preencherModelo("{constructor}", {})).toBe("{constructor}");
  });

  it("recusa variável desconhecida (erro de digitação)", () => {
    const r = validarModelo({ nome: "A", texto: "Olá {hopede}" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.texto).toContain("{hopede}");
    expect(validarModelo({ nome: "A", texto: "Olá {hospede}" }).ok).toBe(true);
    for (const ruim of ["Olá {hospede }", "Olá { hospede}", "Olá {Hospede}", "Olá {hospede", "Olá hospede}", "Olá {{hospede}}", "Olá {}"]) {
      expect(validarModelo({ nome: "A", texto: ruim }).ok, ruim).toBe(false);
    }
  });

  it("modelos iniciais uma vez só; criar, editar, arquivar e excluir", async () => {
    await garantirModelosIniciais(db, org);
    await garantirModelosIniciais(db, org);
    const iniciais = await listarModelos(db, org);
    expect(iniciais.map((m) => m.nome)).toEqual(MODELOS_INICIAIS.map((m) => m.nome));
    for (const m of iniciais) expect(validarModelo(m).ok).toBe(true);

    expect(await criarModelo(db, org, { nome: "agradecimento", texto: "Oi" }, admin)).toMatchObject({ ok: false, erros: { nome: expect.any(String) } });
    const novo = await criarModelo(db, org, { nome: "Boas-vindas", quando: "", texto: "Oi {hospede}" }, admin);
    if (!novo.ok || !novo.modelo) throw new Error("falhou");
    expect(await atualizarModelo(db, org, novo.modelo.id, { ativo: false }, admin)).toMatchObject({ ok: true, modelo: { ativo: false } });
    expect(await atualizarModelo(db, org, novo.modelo.id, { dados: { nome: "Boas-vindas", texto: "Olá {hospede}" } }, admin)).toMatchObject({ ok: true, modelo: { texto: "Olá {hospede}" } });
    expect(await excluirModelo(db, outraOrg, novo.modelo.id, admin)).toBe(false);
    expect(await excluirModelo(db, org, novo.modelo.id, admin)).toBe(true);
    expect(await listarModelos(db, org)).toHaveLength(MODELOS_INICIAIS.length);
    expect(await historicoDe(db, org, "modelo_mensagem", novo.modelo.id)).toHaveLength(4);
  });
});

describe("abas", () => {
  it("só o admin vê as abas; operação e proprietário, nenhuma", () => {
    expect(ABAS_CONFIG.filter((a) => podeFazer("admin", a.exige))).toHaveLength(ABAS_CONFIG.length);
    for (const p of ["operacao", "proprietario", "hospede"] as const) expect(ABAS_CONFIG.filter((a) => podeFazer(p, a.exige))).toEqual([]);
  });
});
