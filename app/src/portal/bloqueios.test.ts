import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { historicoDe } from "@/auditoria/auditoria";
import { criarContrato } from "@/contratos/repositorio";
import { beds24Envios, bloqueios, imoveis, organizacoes, proprietarioImoveis, proprietarios, proprietarioUsuarios, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarBloqueio } from "@/reservas/bloqueios";
import { bloqueiosDoProprietario, bloquearPeloProprietario, liberarPeloProprietario, permissaoAPartirDe, permissaoNoIntervalo, permissoesDeBloqueio } from "./bloqueios";

let db: Db, close: () => Promise<void>, org: string, a: string, b: string, c: string, d: string, usuario: string, dona: string, outro: string;
// 3/10/2026, 12:00 em São Paulo.
const agora = new Date("2026-10-03T15:00:00Z");
const sessao = (imovelIds = [a]): Sessao => ({ usuarioId: usuario, organizacaoId: org, papel: "proprietario", imovelIds });
const bloquear = (imovelId: string, inicio: string, fim: string, motivo = "", s = sessao()) => bloquearPeloProprietario(db, s, { imovelId, inicio, fim, motivo }, agora);
const lista = () => db.select().from(bloqueios).where(eq(bloqueios.organizacaoId, org)).orderBy(bloqueios.inicio);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  // a: do proprietário, com contrato; b: de outro dono; c: do proprietário, contrato sem a permissão; d: do proprietário, sem contrato.
  [{ id: a }, { id: b }, { id: c }, { id: d }] = await db.insert(imoveis).values([
    { organizacaoId: org, codigo: "403", nome: "Quatro" },
    { organizacaoId: org, codigo: "102", nome: "Um" },
    { organizacaoId: org, codigo: "303", nome: "Três" },
    { organizacaoId: org, codigo: "103", nome: "Boutique" },
  ]).returning();
  [{ id: dona }, { id: outro }] = await db.insert(proprietarios).values([{ organizacaoId: org, nome: "Dona" }, { organizacaoId: org, nome: "Outro" }]).returning();
  await db.insert(proprietarioImoveis).values([{ proprietarioId: dona, imovelId: a }, { proprietarioId: outro, imovelId: b }, { proprietarioId: dona, imovelId: c }, { proprietarioId: dona, imovelId: d }]);
  [{ id: usuario }] = await db.insert(usuarios).values({ organizacaoId: org, email: "dona@example.com", nome: "Dona", papel: "proprietario" }).returning();
  // O usuário do portal representa a titular "Dona" (é daí que a sessão real tira os imóveis).
  await db.insert(proprietarioUsuarios).values({ proprietarioId: dona, usuarioId: usuario });
  for (const i of [a, b]) await criarContrato(db, org, i, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  await criarContrato(db, org, c, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01", proprietarioBloqueia: "nao" }, null);
});
afterEach(() => close());

describe("calendário do proprietário (M5.5)", () => {
  it("bloqueia datas futuras do próprio imóvel com fonte 'proprietario', motivo padrão e histórico; nunca no passado, por cima de reserva ou de outro bloqueio", async () => {
    expect(await bloquear(a, "2026-10-10", "2026-10-12")).toMatchObject({ ok: true });
    const [feito] = await lista();
    expect(feito).toMatchObject({ imovelId: a, inicio: "2026-10-10", fim: "2026-10-12", motivo: "Uso próprio", fonte: "proprietario" });
    expect((await historicoDe(db, org, "imovel", a)).map((h) => h.acao)).toContain("bloqueio.criar");
    expect(await bloquear(a, "2026-10-11", "2026-10-13", "férias")).toMatchObject({ ok: false, erro: expect.stringContaining("Já existe") });
    expect(await bloquear(a, "2026-10-02", "2026-10-04")).toMatchObject({ ok: false, erro: expect.stringContaining("a partir de hoje") });
    // Hoje (3/10) ainda pode ser bloqueado.
    expect(await bloquear(a, "2026-10-03", "2026-10-04")).toMatchObject({ ok: true });
    // Reserva não cancelada nas datas: recusa; cancelada não conta.
    await db.insert(reservas).values([
      { organizacaoId: org, imovelId: a, codigo: "SCL-T1", origem: "airbnb", estado: "confirmada", checkin: "2026-10-20", checkout: "2026-10-23", hospedeNome: "Hóspede Fictício", fonte: "manual", idFonte: "" },
      { organizacaoId: org, imovelId: a, codigo: "SCL-T2", origem: "airbnb", estado: "cancelada", checkin: "2026-11-01", checkout: "2026-11-03", hospedeNome: "Outro Fictício", fonte: "manual", idFonte: "" },
    ]);
    expect(await bloquear(a, "2026-10-22", "2026-10-24")).toMatchObject({ ok: false, erro: expect.stringContaining("reserva") });
    expect(await bloquear(a, "2026-11-01", "2026-11-02")).toMatchObject({ ok: true });
    expect(await bloquear(a, "2026-11-10", "2026-11-09")).toMatchObject({ ok: false, erro: expect.stringContaining("depois") });
    // Consulta não ocupa inventário (não impede); pedido ocupa (impede) — a mesma regra do calendário.
    await db.insert(reservas).values([
      { organizacaoId: org, imovelId: a, codigo: "SCL-T3", origem: "site", estado: "consulta", checkin: "2026-11-20", checkout: "2026-11-22", hospedeNome: "Curioso Fictício", fonte: "manual", idFonte: "" },
      { organizacaoId: org, imovelId: a, codigo: "SCL-T4", origem: "site", estado: "pedido", checkin: "2026-11-25", checkout: "2026-11-27", hospedeNome: "Pedido Fictício", fonte: "manual", idFonte: "" },
    ]);
    expect(await bloquear(a, "2026-11-20", "2026-11-22")).toMatchObject({ ok: true });
    expect(await bloquear(a, "2026-11-26", "2026-11-28")).toMatchObject({ ok: false, erro: expect.stringContaining("reserva") });
    // O bloqueio guarda a titular que o fez.
    expect((await lista()).every((x) => x.proprietarioId === dona)).toBe(true);
  });

  it("troca de titular: o novo proprietário vê o bloqueio do anterior, mas não libera; sem titular identificável na conta, avisa", async () => {
    const meu = await bloquear(a, "2026-10-10", "2026-10-12");
    if (!meu.ok) throw new Error(meu.erro);
    // O imóvel passa para "Outro", representado por outro usuário.
    await db.delete(proprietarioImoveis).where(eq(proprietarioImoveis.imovelId, a));
    await db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: a });
    const [{ id: usuario2 }] = await db.insert(usuarios).values({ organizacaoId: org, email: "outro@example.com", nome: "Outro", papel: "proprietario" }).returning();
    await db.insert(proprietarioUsuarios).values({ proprietarioId: outro, usuarioId: usuario2 });
    const s2: Sessao = { usuarioId: usuario2, organizacaoId: org, papel: "proprietario", imovelIds: [a] };
    expect(await bloqueiosDoProprietario(db, s2, agora)).toMatchObject([{ id: meu.id, fonte: "proprietario", proprio: false, liberavel: false }]);
    expect(await liberarPeloProprietario(db, s2, meu.id, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("outro proprietário") });
    // O novo titular bloqueia normalmente (fica ligado a ele) e libera o dele.
    const dele = await bloquearPeloProprietario(db, s2, { imovelId: a, inicio: "2026-12-01", fim: "2026-12-03", motivo: "" }, agora);
    expect(dele).toMatchObject({ ok: true });
    expect(await bloqueiosDoProprietario(db, s2, agora)).toMatchObject([{ id: meu.id, proprio: false }, { proprio: true, liberavel: true }]);
    if (dele.ok) expect(await liberarPeloProprietario(db, s2, dele.id, agora)).toEqual({ ok: true });
    expect((await lista()).map((x) => x.id)).toEqual([meu.id]);
    // Usuário com acesso ao imóvel mas sem titular ligado na conta: não dá para registrar quem bloqueou → avisa, nada gravado.
    const [{ id: usuario3 }] = await db.insert(usuarios).values({ organizacaoId: org, email: "solto@example.com", nome: "Solto", papel: "proprietario" }).returning();
    const s3: Sessao = { usuarioId: usuario3, organizacaoId: org, papel: "proprietario", imovelIds: [a] };
    expect(await bloquearPeloProprietario(db, s3, { imovelId: a, inicio: "2026-12-10", fim: "2026-12-12", motivo: "" }, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("titular") });
    expect(await lista()).toHaveLength(1);
  });

  it("só nos imóveis dele e conforme o contrato: outro dono é negado; contrato sem permissão e imóvel sem contrato são recusados", async () => {
    await expect(bloquear(b, "2026-10-10", "2026-10-12")).rejects.toBeInstanceOf(AcessoNegado);
    // Sessão de outra empresa: o imóvel não é encontrado dentro dela (nada é revelado nem gravado).
    expect(await bloquear(a, "2026-10-10", "2026-10-12", "", { ...sessao(), organizacaoId: "00000000-0000-0000-0000-000000000000" })).toEqual({ ok: false, erro: "Imóvel não encontrado." });
    const s = sessao([a, c, d]);
    expect(await bloquear(c, "2026-10-10", "2026-10-12", "", s)).toMatchObject({ ok: false, erro: expect.stringContaining("não prevê bloqueio") });
    expect(await bloquear(d, "2026-10-10", "2026-10-12", "", s)).toMatchObject({ ok: false, erro: expect.stringContaining("contrato em vigor") });
    expect(await permissoesDeBloqueio(db, org, [a, c, d], "2026-10-03")).toEqual(new Map([[a, true], [c, false], [d, null]]));
    // A permissão precisa valer também na última noite: contrato que termina antes do fim do bloqueio.
    await criarContrato(db, org, d, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01", fim: "2026-10-15" }, null);
    expect(await bloquear(d, "2026-10-14", "2026-10-18", "", s)).toMatchObject({ ok: false, erro: expect.stringContaining("contrato em vigor") });
    expect(await bloquear(d, "2026-10-14", "2026-10-16", "", s)).toMatchObject({ ok: true });
    expect(await lista()).toHaveLength(1);
    // Dois contratos com permissão, com um buraco entre eles (16 a 19/10): um só contrato precisa cobrir todas as noites.
    await criarContrato(db, org, d, { tipo: "gestao_completa", comissao: "15", inicio: "2026-10-20" }, null);
    expect(await bloquear(d, "2026-10-14", "2026-10-22", "", s)).toMatchObject({ ok: false, erro: expect.stringContaining("contrato em vigor") });
    expect(await bloquear(d, "2026-10-20", "2026-10-22", "", s)).toMatchObject({ ok: true });
    expect(await lista()).toHaveLength(2);
  });

  it("regras puras: um só contrato cobre o intervalo; a lista do formulário conta contrato futuro, o servidor confere as datas", async () => {
    const c = (inicio: string, fim: string | null, proprietarioBloqueia = true) => ({ imovelId: d, tipo: "gestao_completa" as const, comissaoBp: 1500, inicio, fim, proprietarioBloqueia });
    expect(permissaoNoIntervalo([c("2025-01-01", "2026-10-12"), c("2026-10-15", null)], "2026-10-11", "2026-10-17")).toBeNull();
    expect(permissaoNoIntervalo([c("2025-01-01", "2026-10-12"), c("2026-10-15", null)], "2026-10-11", "2026-10-12")).toBe(true);
    expect(permissaoNoIntervalo([c("2025-01-01", "2026-10-12", false)], "2026-10-11", "2026-10-12")).toBe(false);
    expect(permissaoNoIntervalo([], "2026-10-11", "2026-10-12")).toBeNull();
    expect(permissaoAPartirDe([c("2025-01-01", "2026-10-02")], "2026-10-03")).toBeNull(); // só contrato encerrado
    expect(permissaoAPartirDe([c("2025-01-01", "2026-10-02"), c("2026-11-01", null)], "2026-10-03")).toBe(true); // futuro com permissão
    expect(permissaoAPartirDe([c("2025-01-01", null, false)], "2026-10-03")).toBe(false);
    expect(permissaoAPartirDe([c("2025-01-01", null, false), c("2027-01-01", null)], "2026-10-03")).toBe(true); // hoje não, mas o futuro permite
    // No banco: d só com contrato futuro aparece no formulário, mas só as datas dele passam.
    await criarContrato(db, org, d, { tipo: "gestao_completa", comissao: "15", inicio: "2026-11-01" }, null);
    expect((await permissoesDeBloqueio(db, org, [d], "2026-10-03")).get(d)).toBe(true);
    const s = sessao([d]);
    expect(await bloquear(d, "2026-10-10", "2026-10-12", "", s)).toMatchObject({ ok: false, erro: expect.stringContaining("contrato em vigor") });
    expect(await bloquear(d, "2026-10-30", "2026-11-02", "", s)).toMatchObject({ ok: false, erro: expect.stringContaining("contrato em vigor") });
    expect(await bloquear(d, "2026-11-02", "2026-11-04", "", s)).toMatchObject({ ok: true });
  });

  it("lista do portal usa o 'hoje' de cada imóvel (fuso do imóvel), igual à liberação", async () => {
    // 03:30Z de 3/10: 00:30 de 3/10 em São Paulo e 22:30 de 2/10 em Rio Branco.
    const meiaNoite = new Date("2026-10-03T03:30:00Z");
    const [{ id: e }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "505", nome: "Acre", fuso: "America/Rio_Branco" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dona, imovelId: e });
    const [spHoje, spOntem, rbHoje, rbOntem] = await db
      .insert(bloqueios)
      .values([
        { organizacaoId: org, imovelId: a, inicio: "2026-10-01", fim: "2026-10-03", motivo: "", fonte: "proprietario", proprietarioId: dona },
        { organizacaoId: org, imovelId: a, inicio: "2026-09-30", fim: "2026-10-02", motivo: "", fonte: "proprietario", proprietarioId: dona },
        { organizacaoId: org, imovelId: e, inicio: "2026-10-01", fim: "2026-10-03", motivo: "", fonte: "proprietario", proprietarioId: dona },
        { organizacaoId: org, imovelId: e, inicio: "2026-09-30", fim: "2026-10-02", motivo: "", fonte: "proprietario", proprietarioId: dona },
      ])
      .returning({ id: bloqueios.id });
    const s = sessao([a, e]);
    const vistos = await bloqueiosDoProprietario(db, s, meiaNoite);
    expect(vistos.map((b) => [b.id, b.liberavel])).toEqual([
      [rbOntem.id, false], // em Rio Branco ainda é 2/10: acaba hoje, aparece mas não libera
      [spHoje.id, false], // em São Paulo já é 3/10: acaba hoje
      [rbHoje.id, true], // em Rio Branco ainda falta uma noite
    ]);
    expect(vistos.some((b) => b.id === spOntem.id)).toBe(false);
    expect(await liberarPeloProprietario(db, s, spHoje.id, meiaNoite)).toMatchObject({ ok: false, erro: expect.stringContaining("já passou") });
    expect(await liberarPeloProprietario(db, s, rbHoje.id, meiaNoite)).toEqual({ ok: true });
  });

  it("libera só o que ele mesmo bloqueou e que ainda não passou; o bloqueio da empresa e o de outro dono ficam", async () => {
    const meu = await bloquear(a, "2026-10-10", "2026-10-12");
    const daEmpresa = await criarBloqueio(db, org, { imovelId: a, inicio: "2026-11-10", fim: "2026-11-12", motivo: "Manutenção" }, null);
    const [passado] = await db.insert(bloqueios).values({ organizacaoId: org, imovelId: a, inicio: "2026-09-20", fim: "2026-09-22", motivo: "Uso próprio", fonte: "proprietario" }).returning({ id: bloqueios.id });
    const deOutro = await criarBloqueio(db, org, { imovelId: b, inicio: "2026-10-10", fim: "2026-10-12", motivo: "" }, null, { fonte: "proprietario" });
    if (!meu.ok || !daEmpresa.ok || !deOutro.ok) throw new Error("fixture");
    expect(await bloqueiosDoProprietario(db, sessao(), agora)).toMatchObject([
      { id: meu.id, codigo: "403", inicio: "2026-10-10", fonte: "proprietario", liberavel: true },
      { id: daEmpresa.id, codigo: "403", inicio: "2026-11-10", fonte: "manual", liberavel: false },
    ]);
    expect(await liberarPeloProprietario(db, sessao(), daEmpresa.id, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("empresa") });
    expect(await liberarPeloProprietario(db, sessao(), passado.id, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("já passou") });
    await expect(liberarPeloProprietario(db, sessao(), deOutro.id, agora)).rejects.toBeInstanceOf(AcessoNegado);
    expect(await liberarPeloProprietario(db, sessao(), "nao-e-uuid", agora)).toMatchObject({ ok: false });
    expect(await liberarPeloProprietario(db, sessao(), meu.id, agora)).toEqual({ ok: true });
    expect((await lista()).map((x) => x.id)).toEqual(expect.arrayContaining([daEmpresa.id, passado.id, deOutro.id]));
    expect((await lista()).some((x) => x.id === meu.id)).toBe(false);
    expect((await historicoDe(db, org, "imovel", a)).map((h) => h.acao)).toContain("bloqueio.remover");
  });

  it("durante um envio de calendário em andamento, bloquear e liberar esperam (mensagem clara)", async () => {
    const meu = await bloquear(a, "2026-10-10", "2026-10-12");
    if (!meu.ok) throw new Error(meu.erro);
    await db.insert(beds24Envios).values({ organizacaoId: org, iniciadoEm: new Date(Date.now() - 60_000), modo: "envio", situacao: "executando" });
    expect(await bloquear(a, "2026-12-01", "2026-12-03")).toMatchObject({ ok: false, erro: expect.stringContaining("envio de calendário") });
    expect(await liberarPeloProprietario(db, sessao(), meu.id, agora)).toMatchObject({ ok: false, erro: expect.stringContaining("envio de calendário") });
  });
});
