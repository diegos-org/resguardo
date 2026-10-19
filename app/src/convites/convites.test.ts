import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pedirCodigo } from "@/acesso/codigo-email";
import { carregarSessao } from "@/acesso/sessao";
import { historicoDe } from "@/auditoria/auditoria";
import { convites, imoveis, organizacoes, proprietarioImoveis, proprietarios, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { aceitarConvite, criarConvite, lerConvite, listarConvites, revogarConvite, situacao, temConvitePendente } from "./convites";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outraOrg: string;
let dono: string;
let im: string;
const t0 = new Date("2026-10-01T12:00:00Z");
const dias = (n: number) => new Date(t0.getTime() + n * 86_400_000);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outraOrg }] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona Fictícia", email: "dona@example.com" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "102", nome: "Studio" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im });
});
afterEach(() => close());

async function convite(email = "Dona@Example.com", agora = t0) {
  const r = await criarConvite(db, org, dono, email, null, agora);
  if (!r.ok) throw new Error(r.erro);
  return r;
}

describe("convites", () => {
  it("cria com token aleatório (só o hash no banco) e validade de 7 dias", async () => {
    const r = await convite();
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.convite.tokenHash).not.toContain(r.token);
    expect(r.convite.email).toBe("dona@example.com");
    expect(r.convite.expiraEm.toISOString()).toBe(dias(7).toISOString());
    expect(await lerConvite(db, r.token, dias(1))).toMatchObject({ ok: true, nomeProprietario: "Dona Fictícia" });
    expect(await lerConvite(db, "x".repeat(43), dias(1))).toEqual({ ok: false, motivo: "invalido" });
    expect(await lerConvite(db, "curto", dias(1))).toEqual({ ok: false, motivo: "invalido" });
    expect((await historicoDe(db, org, "proprietario", dono)).map((h) => h.acao)).toContain("convite.criar");
  });

  it("o histórico diz até quando o convite vale no horário de Brasília (16/10 às 22:30 + 7 dias, não o dia em UTC)", async () => {
    await convite("dona@example.com", new Date("2026-10-17T01:30:00Z"));
    const [linha] = (await historicoDe(db, org, "proprietario", dono)).filter((h) => h.acao === "convite.criar");
    expect(linha.mudancas.convite).toEqual([null, "para dona@example.com, vale até 23/10/2026 às 22:30"]);
  });

  it("aceite: cria o acesso de proprietário ligado aos imóveis dele, uma vez só", async () => {
    const r = await convite();
    const uid = await aceitarConvite(db, r.token, "DONA@example.com", dias(1));
    expect(uid).toBeTruthy();
    const sessao = await carregarSessao(db, uid!);
    expect(sessao).toMatchObject({ papel: "proprietario", organizacaoId: org, imovelIds: [im] });
    expect(situacao((await listarConvites(db, org, dono))[0], dias(1))).toBe("aceito");
    expect(await aceitarConvite(db, r.token, "dona@example.com", dias(1))).toBeNull(); // uso único
    expect(await lerConvite(db, r.token, dias(1))).toEqual({ ok: false, motivo: "aceito" });
  });

  it("só aceita com o e-mail convidado, dentro da validade e se não foi cancelado", async () => {
    const r = await convite();
    expect(await aceitarConvite(db, r.token, "outra@example.com", dias(1))).toBeNull();
    expect(await aceitarConvite(db, r.token, "dona@example.com", dias(8))).toBeNull();
    expect(await lerConvite(db, r.token, dias(8))).toEqual({ ok: false, motivo: "vencido" });
    const c = (await listarConvites(db, org, dono))[0];
    expect(await revogarConvite(db, org, c.id, null, dias(1))).toBe(true);
    expect(await revogarConvite(db, org, c.id, null, dias(1))).toBe(false);
    expect(await aceitarConvite(db, r.token, "dona@example.com", dias(1))).toBeNull();
    expect(await lerConvite(db, r.token, dias(1))).toEqual({ ok: false, motivo: "revogado" });
  });

  it("convite novo cancela o anterior pendente do mesmo e-mail", async () => {
    const a = await convite();
    const b = await convite("dona@example.com", dias(1));
    expect(await aceitarConvite(db, a.token, "dona@example.com", dias(2))).toBeNull();
    expect(await aceitarConvite(db, b.token, "dona@example.com", dias(2))).toBeTruthy();
  });

  it("e-mail da equipe não vira proprietário; usuário proprietário desativado não é reativado", async () => {
    await db.insert(usuarios).values({ organizacaoId: org, email: "equipe@example.com", nome: "Equipe", papel: "operacao" });
    expect(await criarConvite(db, org, dono, "equipe@example.com", null, t0)).toMatchObject({ ok: false });
    const r = await convite("ex@example.com");
    await db.insert(usuarios).values({ organizacaoId: org, email: "ex@example.com", nome: "Ex", papel: "proprietario", ativo: false });
    expect(await aceitarConvite(db, r.token, "ex@example.com", dias(1))).toBeNull();
  });

  it("proprietário que já tem acesso é ligado a mais um proprietário (coproprietário)", async () => {
    const r1 = await convite();
    const uid = await aceitarConvite(db, r1.token, "dona@example.com", dias(1));
    const [{ id: outroDono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Outro" }).returning();
    const [{ id: im2 }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "303", nome: "Outro" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: outroDono, imovelId: im2 });
    const r2 = await criarConvite(db, org, outroDono, "dona@example.com", null, dias(2));
    expect(r2.ok && (await aceitarConvite(db, r2.token, "dona@example.com", dias(2)))).toBe(uid);
    expect([...((await carregarSessao(db, uid!))?.imovelIds ?? [])].sort()).toEqual([im, im2].sort());
    // Um dos proprietários sai (desativado): o acesso aos imóveis dele acaba na hora; o do outro continua.
    await db.update(proprietarios).set({ ativo: false }).where(eq(proprietarios.id, outroDono));
    expect((await carregarSessao(db, uid!))?.imovelIds).toEqual([im]);
    await db.update(proprietarios).set({ ativo: false }).where(eq(proprietarios.id, dono));
    expect((await carregarSessao(db, uid!))?.imovelIds).toEqual([]);
  });

  it("isolamento: outra organização não convida nem cancela", async () => {
    expect(await criarConvite(db, outraOrg, dono, "x@example.com", null, t0)).toMatchObject({ ok: false });
    await convite();
    const c = (await listarConvites(db, org, dono))[0];
    expect(await revogarConvite(db, outraOrg, c.id, null)).toBe(false);
    expect(await listarConvites(db, outraOrg, dono)).toHaveLength(0);
  });

  it("proprietário inativo não pode ser convidado nem aceitar", async () => {
    const r = await convite();
    await db.update(proprietarios).set({ ativo: false }).where(eq(proprietarios.id, dono));
    expect(await criarConvite(db, org, dono, "dona@example.com", null, t0)).toMatchObject({ ok: false });
    expect(await aceitarConvite(db, r.token, "dona@example.com", dias(1))).toBeNull();
  });

  it("convite pendente libera o envio do código de login para aquele e-mail", async () => {
    const correio = new CorreioMemoria();
    const opcoes = { segredo: "s", adminEmails: [], agora: new Date() };
    expect(await pedirCodigo(db, correio, "dona@example.com", opcoes)).toBe("sem-acesso");
    await convite("dona@example.com", new Date());
    expect(await temConvitePendente(db, "DONA@example.com")).toBe(true);
    expect(await pedirCodigo(db, correio, "dona@example.com", opcoes)).toBe("enviado");
    expect(await db.select().from(convites)).toHaveLength(1);
  });
});
