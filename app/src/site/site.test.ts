import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { salvarEmpresa } from "@/configuracoes/empresa";
import { salvarTextosSite, TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { DETALHES_VAZIOS, salvarDetalhes } from "@/imoveis/detalhes";
import { conteudoDoSite, destinoDoLinkAntigo, imovelDoSite, imoveisDoSite, lerPedidoConsulta, tituloDoSite, linkWhatsapp, montarConsulta, numeroWhatsapp, organizacaoDoSite } from "./site";

let db: Db;
let close: () => Promise<void>;
let org: string;
let studio: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: studio }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Studio Exemplo Leblon", publico: true, bairro: "Leblon", capacidade: 4, descricao: "Studio fictício.", endereco: "Rua Fictícia, 403 apto 1" },
      { organizacaoId: org, codigo: "102", nome: "Studio Dois", publico: true, capacidade: 2 },
      { organizacaoId: org, codigo: "buzios", nome: "Casa Búzios", publico: false },
      { organizacaoId: org, codigo: "303", nome: "Inativo", publico: true, ativo: false },
    ])
    .returning();
});
afterEach(() => close());

describe("site público (M7.1)", () => {
  it("de qual organização: a da variável, ou a única do banco; com duas e sem variável, nenhuma", async () => {
    expect(await organizacaoDoSite(db, undefined)).toBe(org);
    expect(await organizacaoDoSite(db, org)).toBe(org);
    expect(await organizacaoDoSite(db, "nao-e-uuid")).toBeNull();
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra" }).returning();
    expect(await organizacaoDoSite(db, undefined)).toBeNull();
    expect(await organizacaoDoSite(db, outra)).toBe(outra);
  });

  it("só imóveis públicos e ativos, pelo código, sem endereço nem dados internos", async () => {
    await salvarDetalhes(
      db,
      org,
      studio,
      { ...DETALHES_VAZIOS, camas: { queen: 1, sofa_cama: 1 }, comodidades: ["Wi-Fi", "Elevador"], estadiaMinima: 3, cep: "22000-000", complemento: "apto 1", precoBase: 50000 },
      null,
    );
    const lista = await imoveisDoSite(db, org);
    expect(lista.map((i) => i.codigo)).toEqual(["102", "403"]);
    const s = lista[1];
    expect(s).toMatchObject({ nome: "Studio Exemplo Leblon", capacidade: 4, camas: ["1 cama Queen", "1 Sofá-cama"], comodidades: ["Wi-Fi", "Elevador"], estadiaMinima: 3 });
    expect(JSON.stringify(lista)).not.toMatch(/Rua Fictícia|22000|apto 1|50000|precoBase|endereco|cep/);
    // Sem cadastro completo: valores neutros.
    expect(lista[0]).toMatchObject({ camas: [], comodidades: [], checkinAPartirDe: "15:00" });
  });

  it("página do imóvel: só se for público e ativo", async () => {
    expect(await imovelDoSite(db, org, "403")).toMatchObject({ nome: "Studio Exemplo Leblon" });
    expect(await imovelDoSite(db, org, "buzios")).toBeNull();
    expect(await imovelDoSite(db, org, "303")).toBeNull();
    expect(await imovelDoSite(db, org, "x' or 1=1")).toBeNull();
  });

  it("textos e contato vêm do painel; sem telefone, sem WhatsApp", async () => {
    let c = await conteudoDoSite(db);
    expect(c).toMatchObject({ organizacaoId: org, nomeEmpresa: "Sua Casa Exemplo", whatsapp: null, textos: { titulo: TEXTOS_SITE_INICIAIS.titulo } });
    await salvarTextosSite(db, org, { ...TEXTOS_SITE_INICIAIS, titulo: "Título novo", sobre: "Sobre nós." }, null);
    await salvarEmpresa(db, org, { nome: "Sua Casa Exemplo", razaoSocial: "", cnpj: "", email: "contato@example.com", telefone: "(21) 90000-0000", endereco: "", site: "", chavePix: "" }, null);
    c = await conteudoDoSite(db);
    expect(c).toMatchObject({ whatsapp: "5521900000000", email: "contato@example.com", textos: { titulo: "Título novo", sobre: "Sobre nós." } });
  });

  it("número do WhatsApp a partir do telefone do cadastro", () => {
    expect(numeroWhatsapp("(21) 90000-0000")).toBe("5521900000000");
    expect(numeroWhatsapp("+55 21 3000-0000")).toBe("552130000000");
    expect(numeroWhatsapp("123")).toBeNull();
    expect(numeroWhatsapp("")).toBeNull();
  });

  it("consulta: confere datas e hóspedes e monta a mensagem; nada é gravado", async () => {
    const imovel = await imovelDoSite(db, org, "403");
    const base = { imovel: "403", entrada: "2026-10-10", saida: "2026-10-13", hospedes: "2" };
    const r = montarConsulta(base, imovel, "2026-09-25");
    expect(r).toEqual({
      ok: true,
      texto: "Olá! Gostaria de consultar a disponibilidade do Studio Exemplo Leblon (403).\nEntrada: 10/10/2026 · Saída: 13/10/2026 · 2 pessoas.",
    });
    expect(montarConsulta({ ...base, entrada: "2026-09-01" }, imovel, "2026-09-25")).toMatchObject({ ok: false, erros: { entrada: expect.any(String) } });
    expect(montarConsulta({ ...base, saida: "2026-10-10" }, imovel, "2026-09-25")).toMatchObject({ ok: false, erros: { saida: expect.any(String) } });
    expect(montarConsulta({ ...base, entrada: "2026-02-30" }, imovel, "2026-01-01")).toMatchObject({ ok: false, erros: { entrada: expect.any(String) } });
    expect(montarConsulta({ ...base, hospedes: "5" }, imovel, "2026-09-25")).toMatchObject({ ok: false, erros: { hospedes: "Este apartamento recebe até 4 pessoas." } });
    expect(montarConsulta(base, null, "2026-09-25")).toMatchObject({ ok: false, erros: { imovel: expect.any(String) } });
    // Com o resultado do site (M7.2), a mensagem traz o valor como referência; indisponível ou sem valor, não.
    expect(montarConsulta(base, imovel, "2026-09-25", { situacao: "disponivel", noites: 3, total: 160000 })).toMatchObject({ ok: true, texto: expect.stringContaining("O site mostrou R$ 1.600,00 para 3 noites.") });
    expect(montarConsulta(base, imovel, "2026-09-25", { situacao: "a_confirmar", noites: 1, total: 58750 })).toMatchObject({ texto: expect.stringContaining("R$ 587,50 para 1 noite (disponibilidade a confirmar).") });
    expect(montarConsulta(base, imovel, "2026-09-25", { situacao: "indisponivel", noites: 3, total: null })).toMatchObject({ texto: expect.not.stringContaining("O site mostrou") });
    expect(linkWhatsapp("5521900000000", "a b&c")).toBe("https://wa.me/5521900000000?text=a%20b%26c");
  });

  it("link da consulta: aceita os nomes em português e os do contrato de links (property, checkin, checkout, guests)", () => {
    const esperado = { imovel: "102", entrada: "2026-10-10", saida: "2026-10-12", hospedes: "2" };
    expect(lerPedidoConsulta({ imovel: "102", entrada: "2026-10-10", saida: "2026-10-12", hospedes: "2" })).toEqual(esperado);
    expect(lerPedidoConsulta({ property: "102", checkin: "2026-10-10", checkout: "2026-10-12", guests: "2", scenario: "x" })).toEqual(esperado);
    expect(lerPedidoConsulta({ imovel: ["a", "b"] })).toEqual({ imovel: "", entrada: "", saida: "", hospedes: "" });
  });

  it("título da aba usa o nome da empresa do site", () => {
    expect(tituloDoSite({ nomeEmpresa: "Empresa Exemplo" }, "Apartamentos")).toBe("Apartamentos — Empresa Exemplo");
    expect(tituloDoSite({ nomeEmpresa: "Empresa Exemplo" })).toBe("Empresa Exemplo");
    expect(tituloDoSite(null, "Consulta")).toBe("Consulta");
  });

  it("links antigos /property/<código>: levam à página do imóvel só com os critérios de estadia válidos", async () => {
    const imovel = await imovelDoSite(db, org, "403");
    const q = (o: Record<string, string>) => new URLSearchParams(o);
    const valido = { checkin: "2026-10-10", checkout: "2026-10-12", guests: "2" };
    expect(destinoDoLinkAntigo(q({ ...valido, email: "x@example.com", token: "t", property: "102" }), imovel, "2026-09-25")).toEqual({
      status: 308,
      destino: "/imoveis/403?checkin=2026-10-10&checkout=2026-10-12&guests=2",
    });
    expect(destinoDoLinkAntigo(q({ email: "x@example.com" }), imovel, "2026-09-25")).toEqual({ status: 308, destino: "/imoveis/403" });
    for (const ruim of [{ guests: "5" }, { checkin: "2026-02-30" }, { checkout: "2026-10-10" }, { guests: "2e0" }, { checkin: "2020-01-01" }])
      expect(destinoDoLinkAntigo(q({ ...valido, ...ruim }), imovel, "2026-09-25")).toMatchObject({ status: 400 });
    expect(destinoDoLinkAntigo(q({ guests: "2" }), imovel, "2026-09-25")).toMatchObject({ status: 400 });
    expect(destinoDoLinkAntigo(new URLSearchParams(`${q(valido)}&guests=3`), imovel, "2026-09-25")).toMatchObject({ status: 400 });
    expect(destinoDoLinkAntigo(q(valido), null, "2026-09-25")).toEqual({ status: 404 });
  });
});
