import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { historicoDe } from "@/auditoria/auditoria";
import { travarConfig } from "@/configuracoes/armazem";
import { publicarComoFunciona, RASCUNHO_COMO_FUNCIONA } from "@/configuracoes/como-funciona";
import { aceitarConvite, criarConvite } from "@/convites/convites";
import { imoveis, organizacoes, proprietarioImoveis, proprietarios, proprietarioUsuarios, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { registrarAceite, situacaoDosProprietarios, situacaoNoPortal, ultimoAceite } from "./aceites";

// A trava da configuração é espiada: o aceite confere a versão publicada sob a mesma trava que a publicação usa.
vi.mock("@/configuracoes/armazem", async (orig) => {
  const m = await orig<typeof import("@/configuracoes/armazem")>();
  return { ...m, travarConfig: vi.fn(m.travarConfig) };
});

let db: Db, close: () => Promise<void>, org: string, dona: string, outro: string, usuario: string, admin: string;
const agora = new Date("2026-10-05T15:00:00Z");
const sessao = (): Sessao => ({ usuarioId: usuario, organizacaoId: org, papel: "proprietario", imovelIds: [] });
const publicar = (secoes = RASCUNHO_COMO_FUNCIONA, hoje = "2026-10-04") => publicarComoFunciona(db, org, secoes, admin, hoje);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  const [{ id: a }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Quatro" }).returning();
  [{ id: dona }, { id: outro }] = await db.insert(proprietarios).values([{ organizacaoId: org, nome: "Dona", email: "dona@example.com" }, { organizacaoId: org, nome: "Outro", email: "outro@example.com" }]).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: a });
  // Um usuário do portal que representa dois proprietários (titular e empresa dela, por exemplo).
  [{ id: usuario }, { id: admin }] = await db
    .insert(usuarios)
    .values([{ organizacaoId: org, email: "dona@example.com", nome: "Dona", papel: "proprietario" }, { organizacaoId: org, email: "admin@example.com", nome: "Admin", papel: "admin" }])
    .returning();
  await db.insert(proprietarioUsuarios).values([{ proprietarioId: dona, usuarioId: usuario }, { proprietarioId: outro, usuarioId: usuario }]);
});
afterEach(() => close());

describe("aceite do 'Como funciona' pelo proprietário (M5.6)", () => {
  it("sem versão publicada nada é pedido; publicada, fica pendente até o aceite, que vale para todos os proprietários do usuário e fica no histórico", async () => {
    expect(await situacaoNoPortal(db, org, usuario)).toMatchObject({ atual: null, pendente: false, donos: [{ nome: "Dona", aceiteAtual: null, ultimo: null }, { nome: "Outro", aceiteAtual: null, ultimo: null }] });
    expect(await registrarAceite(db, sessao(), 1, agora)).toEqual({ ok: false, erro: "O documento ainda não foi publicado." });
    await publicar();
    expect(await situacaoNoPortal(db, org, usuario)).toMatchObject({ atual: { numero: 1 }, pendente: true });
    vi.mocked(travarConfig).mockClear();
    expect(await registrarAceite(db, sessao(), 1, agora)).toEqual({ ok: true, proprietarios: 2 });
    // A versão é conferida sob a trava `como_funciona` (a mesma da publicação), na transação que grava.
    expect(vi.mocked(travarConfig).mock.calls.map((c) => c[2])).toContain("como_funciona");
    const s = await situacaoNoPortal(db, org, usuario);
    expect(s.pendente).toBe(false);
    expect(s.donos.map((d) => [d.nome, d.aceiteAtual?.versao, d.aceiteAtual?.email, d.aceiteAtual?.aceitoEm])).toEqual([["Dona", 1, "dona@example.com", agora], ["Outro", 1, "dona@example.com", agora]]);
    // Repetir não duplica nem registra de novo.
    expect(await registrarAceite(db, sessao(), 1, new Date("2026-10-06T10:00:00Z"))).toEqual({ ok: true, proprietarios: 0 });
    expect((await historicoDe(db, org, "proprietario", dona)).filter((h) => h.acao === "como_funciona.aceitar").map((h) => h.mudancas)).toEqual([{ comoFunciona: [null, "versão 1 aceita"] }]);
    expect(await ultimoAceite(db, org, outro)).toMatchObject({ versao: 1, usuarioId: usuario, aceitoEm: agora });
  });

  it("deny-by-default: admin não aceita pelo portal; usuário sem proprietário ligado não aceita; número de versão estranho é recusado", async () => {
    await publicar();
    expect(await registrarAceite(db, { usuarioId: admin, organizacaoId: org, papel: "admin", imovelIds: [] }, 1, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("Só o proprietário") });
    const [{ id: solto }] = await db.insert(usuarios).values({ organizacaoId: org, email: "solto@example.com", nome: "Solto", papel: "proprietario" }).returning();
    expect(await registrarAceite(db, { usuarioId: solto, organizacaoId: org, papel: "proprietario", imovelIds: [] }, 1, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("Nenhum proprietário") });
    expect(await registrarAceite(db, sessao(), 1.5, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("O documento mudou") });
    expect(await registrarAceite(db, sessao(), Number.NaN, agora)).toMatchObject({ ok: false });
    expect(await ultimoAceite(db, org, dona)).toBeNull();
  });

  it("versão nova pede aceite novo: a antiga fica no histórico, o número velho é recusado, e o painel vê quem aceitou o quê", async () => {
    await publicar();
    await registrarAceite(db, sessao(), 1, agora);
    await publicar({ ...RASCUNHO_COMO_FUNCIONA, contestacoes: "A SCL arca." }, "2026-10-06");
    const depois = new Date("2026-10-07T12:00:00Z");
    expect(await registrarAceite(db, sessao(), 1, depois)).toMatchObject({ ok: false, erro: expect.stringContaining("O documento mudou (versão 2, de 06/10/2026)") });
    const s = await situacaoNoPortal(db, org, usuario);
    expect(s).toMatchObject({ atual: { numero: 2 }, pendente: true });
    expect(s.donos[0]).toMatchObject({ nome: "Dona", aceiteAtual: null, ultimo: { versao: 1 } });
    // Painel: proprietário sem acesso ao portal e sem aceite aparece assim; inativo também aparece, marcado.
    const [{ id: terceiro }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Terceiro" }).returning();
    const painel = await situacaoDosProprietarios(db, org, s.atual);
    expect(painel.map((p) => [p.nome, p.temAcesso, p.aceite?.versao ?? null, p.aceitouAtual])).toEqual([["Dona", true, 1, false], ["Outro", true, 1, false], ["Terceiro", false, null, false]]);
    expect(await registrarAceite(db, sessao(), 2, depois)).toEqual({ ok: true, proprietarios: 2 });
    expect((await situacaoDosProprietarios(db, org, s.atual)).map((p) => [p.nome, p.aceite?.versao ?? null, p.aceitouAtual])).toEqual([["Dona", 2, true], ["Outro", 2, true], ["Terceiro", null, false]]);
    expect(await ultimoAceite(db, org, dona)).toMatchObject({ versao: 2, aceitoEm: depois });
    expect(await ultimoAceite(db, org, terceiro)).toBeNull();
    // Outra organização não vê aceites nem proprietários daqui.
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "B" }).returning();
    expect(await situacaoDosProprietarios(db, outra, s.atual)).toEqual([]);
    expect(await ultimoAceite(db, outra, dona)).toBeNull();
  });

  it("aceite no convite: marcado na página do link, é gravado junto com o convite se a versão ainda é a publicada; versão velha não vale", async () => {
    await publicar();
    const [{ id: quarto }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Quarto", email: "quarto@example.com" }).returning();
    const c = await criarConvite(db, org, quarto, "quarto@example.com", admin);
    if (!c.ok) throw new Error(c.erro);
    vi.mocked(travarConfig).mockClear();
    expect(await aceitarConvite(db, c.token, "quarto@example.com", agora, 1)).toBeTruthy();
    expect(vi.mocked(travarConfig).mock.calls.map((x) => x[2])).toContain("como_funciona");
    expect(await ultimoAceite(db, org, quarto)).toMatchObject({ versao: 1, email: "quarto@example.com", aceitoEm: agora });
    expect((await historicoDe(db, org, "proprietario", quarto)).map((h) => h.acao)).toEqual(expect.arrayContaining(["como_funciona.aceitar", "convite.aceitar"]));
    // Convite aceito sem marcar nada: nenhum aceite gravado.
    const [{ id: quinto }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Quinto", email: "quinto@example.com" }).returning();
    const c2 = await criarConvite(db, org, quinto, "quinto@example.com", admin);
    if (!c2.ok) throw new Error(c2.erro);
    expect(await aceitarConvite(db, c2.token, "quinto@example.com", agora)).toBeTruthy();
    expect(await ultimoAceite(db, org, quinto)).toBeNull();
    // Convite aceito com a versão que já não é a atual: nada gravado (o portal vai pedir a nova).
    const [{ id: sexto }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Sexto", email: "sexto@example.com" }).returning();
    await publicar({ ...RASCUNHO_COMO_FUNCIONA, duvidas: "Novo." }, "2026-10-06");
    const c3 = await criarConvite(db, org, sexto, "sexto@example.com", admin);
    if (!c3.ok) throw new Error(c3.erro);
    expect(await aceitarConvite(db, c3.token, "sexto@example.com", agora, 1)).toBeTruthy();
    expect(await ultimoAceite(db, org, sexto)).toBeNull();
  });
});
