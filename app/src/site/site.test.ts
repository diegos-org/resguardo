import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { salvarEmpresa } from "@/configuracoes/empresa";
import { salvarTextosSite, TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { DETALHES_VAZIOS, salvarDetalhes } from "@/imoveis/detalhes";
import { guardarFoto } from "@/imoveis/fotos";
import { conteudoDoSite, destinoDoLinkAntigo, hojeMaisCedo, imovelDoSite, imoveisDoSite, lerPedidoConsulta, tituloDoSite, linkWhatsapp, montarConsulta, numeroWhatsapp, organizacaoDoSite } from "./site";

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

  it("fotos reais (M7.3): cada imóvel com as suas, na ordem, só endereço e legenda; sem foto, lista vazia", async () => {
    const jpg = (n: number) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, n]);
    const f1 = await guardarFoto(db, org, { imovelId: studio, legenda: "Sala", arquivo: { nome: "a.jpg", conteudo: jpg(1) }, miniatura: jpg(2) }, null);
    const f2 = await guardarFoto(db, org, { imovelId: studio, arquivo: { nome: "b.jpg", conteudo: jpg(3) } }, null);
    if (!f1.ok || !f2.ok) throw new Error("foto");
    const [dois, s] = await imoveisDoSite(db, org);
    expect(s.fotos).toEqual([
      { grande: `/fotos/${f1.id}`, pequena: `/fotos/${f1.id}/pequena`, legenda: "Sala" },
      { grande: `/fotos/${f2.id}`, pequena: `/fotos/${f2.id}`, legenda: "" },
    ]);
    expect(dois.fotos).toEqual([]);
    expect((await imovelDoSite(db, org, "403"))?.fotos).toEqual(s.fotos);
    // O id do imóvel (usado só para buscar as fotos) nunca vai para o objeto público.
    expect(JSON.stringify(s)).not.toContain(studio);
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
    expect(montarConsulta({ ...base, hospedes: "2e0" }, imovel, "2026-09-25")).toMatchObject({ ok: false, erros: { hospedes: "Informe quantas pessoas." } });
    expect(montarConsulta({ ...base, hospedes: "0" }, imovel, "2026-09-25")).toMatchObject({ ok: false, erros: { hospedes: "Informe quantas pessoas." } });
    expect(montarConsulta(base, null, "2026-09-25")).toMatchObject({ ok: false, erros: { imovel: expect.any(String) } });
    // Com o resultado do site (M7.2), a mensagem traz o valor como referência; indisponível ou sem valor, não.
    expect(montarConsulta(base, imovel, "2026-09-25", { situacao: "disponivel", noites: 3, total: 160000 })).toMatchObject({ ok: true, texto: expect.stringContaining("O site mostrou R$ 1.600,00 para 3 noites.") });
    expect(montarConsulta(base, imovel, "2026-09-25", { situacao: "a_confirmar", noites: 1, total: 58750 })).toMatchObject({ texto: expect.stringContaining("R$ 587,50 para 1 noite (disponibilidade a confirmar).") });
    // Com desconto do site (M12.1): o total já é o valor com desconto, e a mensagem diz isso.
    expect(montarConsulta(base, imovel, "2026-09-25", { situacao: "disponivel", noites: 3, total: 153600, desconto: 6400 })).toMatchObject({ texto: expect.stringContaining("O site mostrou R$ 1.536,00 para 3 noites (já com o desconto do site de R$ 64,00).") });
    expect(montarConsulta(base, imovel, "2026-09-25", { situacao: "disponivel", noites: 3, total: 160000, desconto: 0 })).toMatchObject({ texto: expect.stringContaining("O site mostrou R$ 1.600,00 para 3 noites.") });
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
    // 25/09/2026, 12:00 em São Paulo.
    const agora = new Date("2026-09-25T15:00:00Z");
    expect(destinoDoLinkAntigo(q({ ...valido, email: "x@example.com", token: "t", property: "102" }), imovel, agora)).toEqual({
      status: 308,
      destino: "/imoveis/403?checkin=2026-10-10&checkout=2026-10-12&guests=2",
    });
    expect(destinoDoLinkAntigo(q({ email: "x@example.com" }), imovel, agora)).toEqual({ status: 308, destino: "/imoveis/403" });
    for (const ruim of [{ guests: "5" }, { checkin: "2026-02-30" }, { checkout: "2026-10-10" }, { guests: "2e0" }, { checkin: "2020-01-01" }])
      expect(destinoDoLinkAntigo(q({ ...valido, ...ruim }), imovel, agora)).toMatchObject({ status: 400 });
    expect(destinoDoLinkAntigo(q({ guests: "2" }), imovel, agora)).toMatchObject({ status: 400 });
    expect(destinoDoLinkAntigo(new URLSearchParams(`${q(valido)}&guests=3`), imovel, agora)).toMatchObject({ status: 400 });
    expect(destinoDoLinkAntigo(q(valido), null, agora)).toEqual({ status: 404 });
    // "Hoje" no fuso do imóvel: 00:30 em São Paulo (03:30Z) ainda é dia 9 em Rio Branco, então entrada em 9/10 é válida lá.
    const madrugada = new Date("2026-10-10T03:30:00Z");
    const hojeLink = { checkin: "2026-10-09", checkout: "2026-10-12", guests: "2" };
    expect(destinoDoLinkAntigo(q(hojeLink), imovel, madrugada)).toMatchObject({ status: 400 });
    expect(destinoDoLinkAntigo(q(hojeLink), { ...imovel!, fuso: "America/Rio_Branco" }, madrugada)).toMatchObject({ status: 308 });
  });
});

describe("hojeMaisCedo", () => {
  it("é o \"hoje\" mais cedo entre os fusos dos imóveis listados (nunca recusa uma entrada válida em fuso mais atrasado)", () => {
    // 00:30 em São Paulo (03:30Z) ainda é dia 11 em Rio Branco (22:30 local).
    const agora = new Date("2026-10-12T03:30:00Z");
    expect(hojeMaisCedo([{ fuso: "America/Sao_Paulo" }, { fuso: "America/Rio_Branco" }], agora)).toBe("2026-10-11");
    expect(hojeMaisCedo([{ fuso: "America/Sao_Paulo" }], agora)).toBe("2026-10-12");
    expect(hojeMaisCedo([], agora)).toBe("2026-10-12");
  });
});
