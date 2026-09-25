import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { destinoPainel } from "@/acesso/painel";
import { autorizar, podeFazer } from "@/acesso/politica";
import { carregarSessao } from "@/acesso/sessao";
import { imoveis, limpezas, organizacoes, profissionaisLimpeza, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { type Correio, CorreioMemoria } from "@/email/correio";
import { cancelarLimpeza, confirmarLimpeza, criarLimpezaAvulsa, criarProfissional, editarProfissional } from "@/limpezas/limpezas";
import { acessosDasProfissionais, avisarAtribuicao, darAcesso, limpezasDaProfissional, marcarFeitaPelaProfissional, tirarAcesso } from "./equipe";

let db: Db;
let close: () => Promise<void>;
let org: string;
let casa: string;
let ana: string;
let bia: string;
const HOJE = "2026-10-10";

async function limpeza(data: string, profissionalId: string | null) {
  expect(await criarLimpezaAvulsa(db, org, { imovelId: casa, data, observacao: "" }, null)).toEqual({ ok: true });
  const [l] = await db.select().from(limpezas).where(and(eq(limpezas.imovelId, casa), eq(limpezas.data, data)));
  if (profissionalId) expect(await confirmarLimpeza(db, org, l.id, profissionalId, null)).toEqual({ ok: true });
  return l.id;
}

async function usuarioDe(profissionalId: string) {
  const [p] = await db.select().from(profissionaisLimpeza).where(eq(profissionaisLimpeza.id, profissionalId));
  return p.usuarioId!;
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: casa }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Quatro", endereco: "Rua Fictícia, 1" }).returning();
  await criarProfissional(db, org, { nome: "Ana Fictícia", telefone: "", observacoes: "" }, null);
  await criarProfissional(db, org, { nome: "Bia Fictícia", telefone: "", observacoes: "" }, null);
  const ps = await db.select().from(profissionaisLimpeza);
  ana = ps.find((p) => p.nome.startsWith("Ana"))!.id;
  bia = ps.find((p) => p.nome.startsWith("Bia"))!.id;
});
afterEach(() => close());

describe("acesso da profissional pelo celular (M6.6)", () => {
  it("dar acesso cria o usuário \"limpeza\" ligado à profissional; a sessão traz a profissional e vai para /equipe", async () => {
    expect(await darAcesso(db, org, ana, "Ana@Example.com", null)).toEqual({ ok: true });
    const usuarioId = await usuarioDe(ana);
    const [u] = await db.select().from(usuarios).where(eq(usuarios.id, usuarioId));
    expect(u).toMatchObject({ email: "ana@example.com", papel: "limpeza", ativo: true });
    const sessao = await carregarSessao(db, usuarioId);
    expect(sessao).toMatchObject({ papel: "limpeza", profissionalId: ana });
    expect(destinoPainel(sessao)).toEqual({ ok: false, redirecionar: "/equipe" });
    // Só a própria tela: nada do painel, do financeiro ou de outras limpezas.
    expect(podeFazer("limpeza", "limpeza:propria")).toBe(true);
    for (const acao of ["limpeza:ler", "limpeza:editar", "financeiro:ler", "reserva:ler", "imovel:ler"] as const) expect(podeFazer("limpeza", acao)).toBe(false);
    expect(autorizar(sessao, "limpeza:ler", { organizacaoId: org })).toMatchObject({ permitido: false });
    expect((await acessosDasProfissionais(db, org)).get(ana)).toMatchObject({ email: "ana@example.com", ativo: true });
  });

  it("tirar acesso ou arquivar a profissional corta a entrada na hora; dar de novo reativa o mesmo usuário", async () => {
    await darAcesso(db, org, ana, "ana@example.com", null);
    const usuarioId = await usuarioDe(ana);
    expect(await tirarAcesso(db, org, ana, null)).toEqual({ ok: true });
    expect(await carregarSessao(db, usuarioId)).toBeNull();
    expect(await darAcesso(db, org, ana, "ana@example.com", null)).toEqual({ ok: true });
    expect(await usuarioDe(ana)).toBe(usuarioId);
    expect(await carregarSessao(db, usuarioId)).toMatchObject({ profissionalId: ana });
    // Arquivada: não entra, mesmo com o usuário ativo.
    expect(await editarProfissional(db, org, ana, { nome: "Ana Fictícia", telefone: "", observacoes: "", ativo: false }, null)).toEqual({ ok: true });
    expect(await carregarSessao(db, usuarioId)).toBeNull();
    expect(await darAcesso(db, org, ana, "ana@example.com", null)).toMatchObject({ ok: false, erro: expect.stringContaining("arquivada") });
  });

  it("e-mail que já é de outra pessoa do sistema é recusado; e-mail inválido também", async () => {
    await db.insert(usuarios).values({ organizacaoId: org, email: "diego@example.com", nome: "Diego", papel: "admin" });
    expect(await darAcesso(db, org, ana, "diego@example.com", null)).toEqual({ ok: false, erro: "Esse e-mail já é de outra pessoa do sistema." });
    await darAcesso(db, org, bia, "bia@example.com", null);
    expect(await darAcesso(db, org, ana, "bia@example.com", null)).toMatchObject({ ok: false });
    expect(await darAcesso(db, org, ana, "sem-arroba", null)).toEqual({ ok: false, erro: "Informe um e-mail válido." });
  });
});

describe("limpezas da profissional (M6.6)", () => {
  it("só as dela, sem as canceladas, dos últimos dias às próximas duas semanas, sem custo", async () => {
    const minha = await limpeza("2026-10-10", ana);
    await limpeza("2026-10-11", bia);
    const cancelada = await limpeza("2026-10-12", ana);
    await cancelarLimpeza(db, org, cancelada, "reserva cancelada", null);
    await limpeza("2026-11-30", ana);
    const lista = await limpezasDaProfissional(db, org, ana, HOJE);
    expect(lista.map((l) => l.id)).toEqual([minha]);
    expect(lista[0]).toMatchObject({ imovelCodigo: "403", endereco: "Rua Fictícia, 1", estado: "confirmada", entraNoDia: false });
    expect(lista[0]).not.toHaveProperty("custo");
  });

  it("marca como feita só a dela e a partir do dia", async () => {
    await darAcesso(db, org, ana, "ana@example.com", null);
    const usuarioId = await usuarioDe(ana);
    const hoje = await limpeza("2026-10-10", ana);
    const amanha = await limpeza("2026-10-11", ana);
    const daBia = await limpeza("2026-10-09", bia);
    expect(await marcarFeitaPelaProfissional(db, org, ana, daBia, HOJE, usuarioId)).toEqual({ ok: false, erro: "Limpeza não encontrada." });
    expect(await marcarFeitaPelaProfissional(db, org, ana, amanha, HOJE, usuarioId)).toMatchObject({ ok: false });
    expect(await marcarFeitaPelaProfissional(db, org, ana, hoje, HOJE, usuarioId)).toEqual({ ok: true });
    const [l] = await db.select().from(limpezas).where(eq(limpezas.id, hoje));
    expect(l).toMatchObject({ estado: "realizada", profissionalId: ana, custo: null });
    const [b] = await db.select().from(limpezas).where(eq(limpezas.id, daBia));
    expect(b.estado).toBe("confirmada");
  });
});

describe("aviso de limpeza atribuída (M6.6)", () => {
  it("quem tem acesso recebe o e-mail, com chave que não repete; sem acesso, nada; sem provedor, aviso", async () => {
    await darAcesso(db, org, ana, "ana@example.com", null);
    const id = await limpeza("2026-10-12", ana);
    const correio = new CorreioMemoria();
    expect(await avisarAtribuicao(db, org, id, correio, "https://exemplo.test/equipe")).toEqual({ enviado: true, aviso: null });
    expect(correio.enviadas[0]).toMatchObject({ para: "ana@example.com", assunto: "Limpeza 12/10 — 403", chave: `limpeza-aviso:${id}:${ana}:2026-10-12` });
    expect(correio.enviadas[0].texto).toContain("https://exemplo.test/equipe");
    expect(correio.enviadas[0].texto).not.toMatch(/R\$|custo/i);
    const daBia = await limpeza("2026-10-13", bia);
    expect(await avisarAtribuicao(db, org, daBia, correio, "x")).toEqual({ enviado: false, aviso: null });
    expect(await avisarAtribuicao(db, org, id, null, "x")).toMatchObject({ enviado: false, aviso: expect.stringContaining("Sem provedor") });
    const falha: Correio = { nome: "falha", enviar: async () => Promise.reject(new Error("HTTP 500")) };
    expect(await avisarAtribuicao(db, org, id, falha, "x")).toMatchObject({ enviado: false, aviso: expect.stringContaining("falhou") });
  });
});
