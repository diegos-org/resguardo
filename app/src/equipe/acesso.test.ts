import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entrarComSenha, MAX_ERROS } from "@/acesso/senha";
import { carregarSessao } from "@/acesso/sessao";
import { historicoDe } from "@/auditoria/auditoria";
import { imoveis, limpezas, organizacoes, profissionaisLimpeza, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { confirmarLimpeza, criarLimpezaAvulsa, criarProfissional, editarProfissional } from "@/limpezas/limpezas";
import { criarReserva } from "@/reservas/repositorio";
import { agendaDaProfissional, definirCidades, definirSenhaPelaEmpresa, situacaoDaSenha, trocarMinhaSenha } from "./acesso";
import { acessosDasProfissionais, avisarAtribuicao, darAcesso, tirarAcesso } from "./equipe";

let db: Db, close: () => Promise<void>, org: string, outraOrg: string, ana: string, bia: string, rio: string, buzios: string;
const AGORA = new Date("2026-10-08T12:00:00Z");

const usuarioDe = async (profissionalId: string) => (await db.select().from(profissionaisLimpeza).where(eq(profissionaisLimpeza.id, profissionalId)))[0].usuarioId!;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: rio }, { id: buzios }] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "403", nome: "Quatro", cidade: "Rio de Janeiro" },
      { organizacaoId: org, codigo: "BZ1", nome: "Casa Búzios", cidade: "Armação dos Búzios" },
    ])
    .returning();
  await criarProfissional(db, org, { nome: "Ana Fictícia", telefone: "", observacoes: "" }, null);
  await criarProfissional(db, org, { nome: "Bia Fictícia", telefone: "", observacoes: "" }, null);
  const ps = await db.select().from(profissionaisLimpeza);
  ana = ps.find((p) => p.nome.startsWith("Ana"))!.id;
  bia = ps.find((p) => p.nome.startsWith("Bia"))!.id;
});
afterEach(() => close());

describe("entrada da equipe sem e-mail (M6.8)", () => {
  it.each([
    { papel: "admin" as const, outra: false },
    { papel: "operacao" as const, outra: false },
    { papel: "proprietario" as const, outra: false },
    { papel: "hospede" as const, outra: false },
    { papel: "limpeza" as const, outra: true },
  ])("vínculo inconsistente ($papel, outra organização: $outra) não permite alterar nem retirar a conta", async ({ papel, outra }) => {
    // Simula cadastro legado inconsistente. O fluxo da equipe não ganha controle dessa conta.
    const [u] = await db.insert(usuarios).values({ organizacaoId: outra ? outraOrg : org, email: "conta@example.com", nome: "Conta preservada", papel, ativo: false, login: "conta", senhaHash: "hash-ficticio" }).returning();
    await db.update(profissionaisLimpeza).set({ usuarioId: u.id }).where(eq(profissionaisLimpeza.id, ana));
    expect.soft(await definirSenhaPelaEmpresa(db, org, ana, { login: "ana" }, null, AGORA)).toMatchObject({ ok: false });
    expect.soft(await darAcesso(db, org, ana, "novo@example.com", null)).toMatchObject({ ok: false });
    expect.soft(await tirarAcesso(db, org, ana, null)).toMatchObject({ ok: false });
    expect(await editarProfissional(db, org, ana, { nome: "Ana Fictícia", telefone: "", observacoes: "", ativo: false }, null)).toEqual({ ok: true });
    const [depois] = await db.select().from(usuarios).where(eq(usuarios.id, u.id));
    expect(depois).toEqual(u);
    expect(await historicoDe(db, org, "profissional_limpeza", ana)).not.toEqual(expect.arrayContaining([expect.objectContaining({ acao: "profissional_limpeza.acesso" })]));
  });

  it.each([
    { papel: "admin" as const, outra: false },
    { papel: "limpeza" as const, outra: true },
  ])("vínculo inconsistente ativo ($papel, outra organização: $outra) não aparece na lista e não recebe aviso", async ({ papel, outra }) => {
    const [u] = await db.insert(usuarios).values({ organizacaoId: outra ? outraOrg : org, email: "conta@example.com", nome: "Conta preservada", papel, ativo: true }).returning();
    await db.update(profissionaisLimpeza).set({ usuarioId: u.id }).where(eq(profissionaisLimpeza.id, ana));
    expect((await acessosDasProfissionais(db, org)).has(ana)).toBe(false);
    expect(await criarLimpezaAvulsa(db, org, { imovelId: rio, data: "2026-10-12", observacao: "" }, null)).toEqual({ ok: true });
    const [l] = await db.select().from(limpezas).where(eq(limpezas.imovelId, rio));
    expect(await confirmarLimpeza(db, org, l.id, ana, null)).toEqual({ ok: true });
    const correio = new CorreioMemoria();
    expect(await avisarAtribuicao(db, org, l.id, correio, "https://exemplo/equipe")).toEqual({ enviado: false, aviso: null });
    expect(correio.enviadas).toEqual([]);
    expect((await db.select().from(usuarios).where(eq(usuarios.id, u.id)))[0]).toEqual(u);
  });

  it("a empresa cria usuário e senha provisória (sem e-mail); ela entra com eles e cai na tela da equipe; a senha não fica guardada nem no histórico", async () => {
    const r = await definirSenhaPelaEmpresa(db, org, ana, { login: " Ana.Limpeza " }, null, AGORA);
    if (!r.ok) throw new Error(r.erro);
    expect(r.login).toBe("ana.limpeza");
    expect(r.senha).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    const [u] = await db.select().from(usuarios).where(eq(usuarios.id, await usuarioDe(ana)));
    expect(u).toMatchObject({ email: "", login: "ana.limpeza", papel: "limpeza", senhaProvisoria: true, ativo: true });
    expect(u.senhaHash).not.toContain(r.senha);
    const entrou = await entrarComSenha(db, "ana.limpeza", r.senha, new Date(AGORA.getTime() + 1000));
    expect(entrou).toMatchObject({ ok: true, usuarioId: u.id });
    expect(await carregarSessao(db, u.id, { emitidaEm: AGORA.getTime() + 1000 })).toMatchObject({ papel: "limpeza", profissionalId: ana });
    const historico = await historicoDe(db, org, "profissional_limpeza", ana);
    expect(JSON.stringify(historico)).not.toContain(r.senha);
    expect(JSON.stringify(historico)).toContain("senha provisória definida pela empresa");
    expect(await situacaoDaSenha(db, u.id)).toEqual({ temSenha: true, provisoria: true });
    // Duas sem e-mail convivem (o e-mail vazio não conta como repetido).
    expect(await definirSenhaPelaEmpresa(db, org, bia, { login: "bia", senha: "senha-da-bia" }, null, AGORA)).toMatchObject({ ok: true, senha: "senha-da-bia" });
    expect((await acessosDasProfissionais(db, org)).get(bia)).toMatchObject({ email: "", login: "bia", temSenha: true, senhaProvisoria: true, ativo: true });
  });

  it("senha nova derruba quem tinha entrado antes; usuário de outra pessoa, senha fraca e profissional arquivada são recusados", async () => {
    const r1 = await definirSenhaPelaEmpresa(db, org, ana, { login: "ana", senha: "primeira-senha" }, null, AGORA);
    expect(r1.ok).toBe(true);
    const uid = await usuarioDe(ana);
    const entrouAntes = AGORA.getTime() + 1000;
    expect(await carregarSessao(db, uid, { emitidaEm: entrouAntes })).not.toBeNull();
    const depois = new Date(AGORA.getTime() + 60_000);
    expect(await definirSenhaPelaEmpresa(db, org, ana, { login: "ana", senha: "segunda-senha" }, null, depois)).toMatchObject({ ok: true });
    expect(await carregarSessao(db, uid, { emitidaEm: entrouAntes })).toBeNull();
    expect(await entrarComSenha(db, "ana", "primeira-senha", depois)).toMatchObject({ ok: false });
    expect(await entrarComSenha(db, "ana", "segunda-senha", depois)).toMatchObject({ ok: true });
    // A sessão vale da hora em que a senha foi conferida: a de antes da troca cai; a de depois, com a senha nova, vale.
    const antesDaTroca = await entrarComSenha(db, "ana", "segunda-senha", depois);
    if (!antesDaTroca.ok) throw new Error("devia entrar");
    const terceira = new Date(depois.getTime() + 30_000);
    expect(await definirSenhaPelaEmpresa(db, org, ana, { login: "ana", senha: "outra-senha-1" }, null, terceira)).toMatchObject({ ok: true });
    expect(await carregarSessao(db, uid, { emitidaEm: antesDaTroca.conferidaEm })).toBeNull();
    const depoisDaTroca = await entrarComSenha(db, "ana", "outra-senha-1", new Date(terceira.getTime() + 1000));
    if (!depoisDaTroca.ok) throw new Error("devia entrar");
    expect(depoisDaTroca.conferidaEm).toBeGreaterThan(terceira.getTime());
    expect(await carregarSessao(db, uid, { emitidaEm: depoisDaTroca.conferidaEm })).not.toBeNull();
    // Errou demais e ficou esperando: a senha nova da empresa vale na hora.
    for (let i = 1; i <= MAX_ERROS; i++) await entrarComSenha(db, "ana", `errada-${i}`, depois);
    expect(await entrarComSenha(db, "ana", "outra-senha-1", depois)).toEqual({ ok: false, motivo: "bloqueado" });
    expect(await definirSenhaPelaEmpresa(db, org, ana, { login: "ana", senha: "terceira-senha" }, null, depois)).toMatchObject({ ok: true });
    expect(await entrarComSenha(db, "ana", "terceira-senha", new Date(depois.getTime() + 1000))).toMatchObject({ ok: true });
    // O mesmo usuário para outra pessoa, mesmo noutra organização: recusado (o usuário é único no sistema).
    expect(await definirSenhaPelaEmpresa(db, org, bia, { login: "ANA" }, null, AGORA)).toMatchObject({ ok: false, erro: expect.stringContaining("outra pessoa") });
    expect(await definirSenhaPelaEmpresa(db, org, bia, { login: "bia", senha: "curta" }, null, AGORA)).toMatchObject({ ok: false, erro: expect.stringContaining("8") });
    expect(await definirSenhaPelaEmpresa(db, org, bia, { login: "bia@x.com" }, null, AGORA)).toMatchObject({ ok: false, erro: expect.stringContaining("usuário") });
    expect(await definirSenhaPelaEmpresa(db, outraOrg, bia, { login: "bia" }, null, AGORA)).toEqual({ ok: false, erro: "Profissional não encontrada." });
    await db.update(profissionaisLimpeza).set({ ativo: false }).where(eq(profissionaisLimpeza.id, bia));
    expect(await definirSenhaPelaEmpresa(db, org, bia, { login: "bia" }, null, AGORA)).toMatchObject({ ok: false, erro: expect.stringContaining("arquivada") });
    // Tirar o acesso vale também para quem entra com senha.
    expect(await tirarAcesso(db, org, ana, null)).toEqual({ ok: true });
    expect(await entrarComSenha(db, "ana", "terceira-senha", depois)).toMatchObject({ ok: false });
  });

  it("quem tem e-mail ganha também usuário e senha (mesmo usuário); quem tem só senha pode ganhar e-mail depois", async () => {
    expect(await darAcesso(db, org, ana, "ana@example.com", null)).toEqual({ ok: true });
    const uid = await usuarioDe(ana);
    expect(await definirSenhaPelaEmpresa(db, org, ana, { login: "ana", senha: "senha-da-ana" }, null, AGORA)).toMatchObject({ ok: true });
    expect(await usuarioDe(ana)).toBe(uid);
    expect(await entrarComSenha(db, "ana@example.com", "senha-da-ana", AGORA)).toMatchObject({ ok: true, usuarioId: uid });
    expect(await entrarComSenha(db, "ana", "senha-da-ana", AGORA)).toMatchObject({ ok: true, usuarioId: uid });
    expect(await definirSenhaPelaEmpresa(db, org, bia, { login: "bia", senha: "senha-da-bia" }, null, AGORA)).toMatchObject({ ok: true });
    expect(await darAcesso(db, org, bia, "bia@example.com", null)).toEqual({ ok: true });
    expect((await acessosDasProfissionais(db, org)).get(bia)).toMatchObject({ email: "bia@example.com", login: "bia", temSenha: true });
  });

  it("a própria pessoa troca a senha (com a atual) ou cria uma (sem ter); a nova deixa de ser provisória", async () => {
    await definirSenhaPelaEmpresa(db, org, ana, { login: "ana", senha: "provisoria-1" }, null, AGORA);
    const uid = await usuarioDe(ana);
    expect(await trocarMinhaSenha(db, uid, { atual: "errada-1", nova: "minha-senha-1", repetir: "minha-senha-1" })).toEqual({ ok: false, erro: "A senha atual não confere." });
    expect(await trocarMinhaSenha(db, uid, { atual: "provisoria-1", nova: "minha-senha-1", repetir: "outra" })).toMatchObject({ ok: false, erro: expect.stringContaining("iguais") });
    expect(await trocarMinhaSenha(db, uid, { atual: "provisoria-1", nova: "ana", repetir: "ana" })).toMatchObject({ ok: false });
    // Erros com a senha provisória (em outro aparelho, por exemplo) e uma sessão aberta antes da troca.
    for (let i = 1; i < MAX_ERROS; i++) await entrarComSenha(db, "ana", `errada-${i}`, AGORA);
    const sessaoAntes = await entrarComSenha(db, "ana", "provisoria-1", AGORA);
    if (!sessaoAntes.ok) throw new Error("devia entrar");
    for (let i = 1; i < MAX_ERROS; i++) await entrarComSenha(db, "ana", `errada-${i}`, AGORA);
    const troca = new Date(AGORA.getTime() + 5_000);
    expect(await trocarMinhaSenha(db, uid, { atual: "provisoria-1", nova: "minha-senha-1", repetir: "minha-senha-1" }, troca)).toEqual({ ok: true });
    // A sessão aberta com a provisória cai; a conta de erros recomeça (um erro agora não bloqueia).
    expect(await carregarSessao(db, uid, { emitidaEm: sessaoAntes.conferidaEm })).toBeNull();
    expect(await entrarComSenha(db, "ana", "errada-de-novo", troca)).toEqual({ ok: false, motivo: "senha" });
    expect(await situacaoDaSenha(db, uid)).toEqual({ temSenha: true, provisoria: false });
    expect(await entrarComSenha(db, "ana", "minha-senha-1", AGORA)).toMatchObject({ ok: true });
    expect(await entrarComSenha(db, "ana", "provisoria-1", AGORA)).toMatchObject({ ok: false });
    // Quem entrou pelo código (sem senha) cria a sua direto.
    await darAcesso(db, org, bia, "bia@example.com", null);
    const bid = await usuarioDe(bia);
    expect(await situacaoDaSenha(db, bid)).toEqual({ temSenha: false, provisoria: false });
    expect(await trocarMinhaSenha(db, bid, { nova: "senha-da-bia", repetir: "senha-da-bia" })).toEqual({ ok: true });
    expect(await entrarComSenha(db, "bia@example.com", "senha-da-bia", AGORA)).toMatchObject({ ok: true });
    // Depois que a empresa define uma senha (socorro), a troca pela própria pessoa confere com a senha gravada agora:
    // quem só tinha a antiga (ou nenhuma) não desfaz a da empresa.
    expect(await definirSenhaPelaEmpresa(db, org, bia, { login: "bia", senha: "senha-da-empresa" }, null, AGORA)).toMatchObject({ ok: true });
    expect(await trocarMinhaSenha(db, bid, { nova: "tomada-de-volta", repetir: "tomada-de-volta" })).toEqual({ ok: false, erro: "A senha atual não confere." });
    expect(await trocarMinhaSenha(db, bid, { atual: "senha-da-bia", nova: "tomada-de-volta", repetir: "tomada-de-volta" })).toEqual({ ok: false, erro: "A senha atual não confere." });
    expect(await entrarComSenha(db, "bia", "senha-da-empresa", new Date(AGORA.getTime() + 1000))).toMatchObject({ ok: true });
  });

  it("cada uma vê só a agenda das cidades dela (Búzios só Búzios, Rio só Rio); sem cidade escolhida, nenhuma", async () => {
    const r = await criarReserva(db, org, { imovelId: buzios, origem: "airbnb", estado: "confirmada", checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 2, hospedeNome: "Carla Fictícia", hospedeEmail: "", hospedeTelefone: "", hospedeOrigem: "", moeda: "BRL", valorBruto: 100000, taxaCanal: 15000, valorLiquido: null, codigoCanal: "", observacoes: "" }, null);
    expect(r.ok).toBe(true);
    const r2 = await criarReserva(db, org, { imovelId: rio, origem: "airbnb", estado: "confirmada", checkin: "2026-10-09", checkout: "2026-10-11", hospedes: 2, hospedeNome: "Duda Fictícia", hospedeEmail: "", hospedeTelefone: "", hospedeOrigem: "", moeda: "BRL", valorBruto: 100000, taxaCanal: 15000, valorLiquido: null, codigoCanal: "", observacoes: "" }, null);
    expect(r2.ok).toBe(true);
    expect(await agendaDaProfissional(db, org, ana, "2026-10-08")).toEqual({ cidades: [], secoes: [] });
    expect(await definirCidades(db, org, ana, ["Armação dos Búzios"], null)).toEqual({ ok: true });
    const deAna = await agendaDaProfissional(db, org, ana, "2026-10-08");
    expect(deAna.secoes.map((s) => s.cidade)).toEqual(["Armação dos Búzios"]);
    expect(deAna.secoes[0].linhas.join("\n")).toContain("Carla");
    // Horário da casa sem ficha, no formato 15:00 (M7.22).
    expect(deAna.secoes[0].linhas.join("\n")).toContain("entrada seg 12/10 às 15:00 (padrão) · saída qui 15/10 às 11:00 (padrão)");
    expect(JSON.stringify(deAna)).not.toContain("Duda");
    expect(await definirCidades(db, org, bia, ["Rio de Janeiro"], null)).toEqual({ ok: true });
    const deBia = await agendaDaProfissional(db, org, bia, "2026-10-08");
    expect(deBia.secoes.map((s) => s.cidade)).toEqual(["Rio de Janeiro"]);
    expect(JSON.stringify(deBia)).not.toContain("Carla");
    // Cidade sem imóvel ativo e profissional de outra organização: recusados; o histórico registra a troca.
    expect(await definirCidades(db, org, ana, ["Niterói"], null)).toMatchObject({ ok: false, erro: expect.stringContaining("Niterói") });
    expect(await definirCidades(db, outraOrg, ana, [], null)).toEqual({ ok: false, erro: "Profissional não encontrada." });
    expect((await historicoDe(db, org, "profissional_limpeza", ana)).map((h) => h.acao)).toContain("profissional_limpeza.cidades");
    expect(await agendaDaProfissional(db, outraOrg, ana, "2026-10-08")).toEqual({ cidades: [], secoes: [] });
  });

  it("aviso de limpeza por e-mail: quem entra só com usuário e senha não recebe (não tem e-mail), sem erro", async () => {
    await definirSenhaPelaEmpresa(db, org, ana, { login: "ana", senha: "senha-da-ana" }, null, AGORA);
    expect(await criarLimpezaAvulsa(db, org, { imovelId: rio, data: "2026-10-12", observacao: "" }, null)).toEqual({ ok: true });
    const [l] = await db.select().from(limpezas).where(eq(limpezas.imovelId, rio));
    expect(await confirmarLimpeza(db, org, l.id, ana, null)).toEqual({ ok: true });
    const correio = new CorreioMemoria();
    expect(await avisarAtribuicao(db, org, l.id, correio, "https://exemplo/equipe")).toEqual({ enviado: false, aviso: null });
    expect(correio.enviadas).toEqual([]);
  });
});

