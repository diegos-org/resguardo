import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { organizacoes, tentativasLogin, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { conferirSenha, ESPERA_MS, entrarComSenha, gerarSenhaProvisoria, hashSenha, loginBloqueado, MAX_ERROS, validarLogin, validarSenha } from "./senha";

let db: Db, close: () => Promise<void>, org: string, maria: string;
const AGORA = new Date("2026-10-08T12:00:00Z");
const depois = (ms: number) => new Date(AGORA.getTime() + ms);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: maria }] = await db
    .insert(usuarios)
    .values({ organizacaoId: org, email: "", nome: "Maria Fictícia", papel: "limpeza", login: "maria.limpeza", senhaHash: await hashSenha("senha-da-maria") })
    .returning();
});
afterEach(() => close());

describe("senha (M6.8)", () => {
  it("o hash não guarda a senha, tem sal próprio e confere só a senha certa", async () => {
    const a = await hashSenha("uma senha qualquer");
    const b = await hashSenha("uma senha qualquer");
    expect(a).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(a).not.toContain("uma senha");
    expect(a).not.toBe(b);
    expect(await conferirSenha("uma senha qualquer", a)).toBe(true);
    expect(await conferirSenha("uma senha qualquer ", a)).toBe(false);
    expect(await conferirSenha("x", "lixo")).toBe(false);
    expect(await conferirSenha("x", "scrypt$30$8$1$AAAA$BBBB")).toBe(false);
  });

  it("regras simples: 8 caracteres, diferente do usuário; usuário sem acento nem @; provisória fácil de ditar", () => {
    expect(validarSenha("curta")).toContain("pelo menos 8");
    expect(validarSenha("maria.limpeza", "Maria.Limpeza")).toContain("igual ao usuário");
    expect(validarSenha("x".repeat(129))).toContain("no máximo");
    expect(validarSenha("oito1234")).toBeNull();
    expect(validarLogin("maria.limpeza")).toBeNull();
    for (const ruim of ["ma", "maria@x.com", "maría", ".maria", "maria limpeza", "x".repeat(41)]) expect(validarLogin(ruim)).not.toBeNull();
    const p = gerarSenhaProvisoria();
    expect(p).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(p).not.toMatch(/[lo01i]/);
    expect(validarSenha(p)).toBeNull();
  });

  it("entra com o usuário (sem diferença de maiúscula) ou com o e-mail; quem está inativo ou sem senha não entra", async () => {
    expect(await entrarComSenha(db, "  Maria.Limpeza ", "senha-da-maria", AGORA)).toEqual({ ok: true, usuarioId: maria });
    const [ana] = await db.insert(usuarios).values({ organizacaoId: org, email: "Ana@Example.com", nome: "Ana", papel: "limpeza", senhaHash: await hashSenha("senha-da-ana") }).returning();
    expect(await entrarComSenha(db, "ana@example.com", "senha-da-ana", AGORA)).toEqual({ ok: true, usuarioId: ana.id });
    // Sem senha cadastrada (entra só pelo código ou pelo Google): por aqui, não.
    await db.insert(usuarios).values({ organizacaoId: org, email: "bia@example.com", nome: "Bia", papel: "limpeza" });
    expect(await entrarComSenha(db, "bia@example.com", "qualquer-coisa", AGORA)).toEqual({ ok: false, motivo: "senha" });
    await db.update(usuarios).set({ ativo: false }).where(eq(usuarios.id, maria));
    expect(await entrarComSenha(db, "maria.limpeza", "senha-da-maria", AGORA)).toEqual({ ok: false, motivo: "senha" });
    expect(await entrarComSenha(db, "", "senha-da-maria", AGORA)).toEqual({ ok: false, motivo: "senha" });
  });

  it("no quinto erro seguido espera 15 minutos (nem a senha certa entra); depois da espera a conta recomeça; acerto zera", async () => {
    for (let i = 1; i < MAX_ERROS; i++) expect(await entrarComSenha(db, "maria.limpeza", `errada-${i}`, AGORA)).toEqual({ ok: false, motivo: "senha" });
    // Um acerto antes do quinto zera a conta.
    expect(await entrarComSenha(db, "maria.limpeza", "senha-da-maria", AGORA)).toMatchObject({ ok: true });
    expect(await db.select().from(tentativasLogin)).toEqual([]);
    for (let i = 1; i < MAX_ERROS; i++) await entrarComSenha(db, "maria.limpeza", `errada-${i}`, AGORA);
    expect(await loginBloqueado(db, "maria.limpeza", AGORA)).toBeNull();
    expect(await entrarComSenha(db, "maria.limpeza", "errada-5", AGORA)).toEqual({ ok: false, motivo: "bloqueado" });
    expect(await loginBloqueado(db, "MARIA.limpeza", AGORA)).toEqual(depois(ESPERA_MS));
    expect(await entrarComSenha(db, "maria.limpeza", "senha-da-maria", depois(ESPERA_MS - 1000))).toEqual({ ok: false, motivo: "bloqueado" });
    // Passada a espera: entra; e um erro depois dela conta do zero (não volta a bloquear no primeiro).
    expect(await entrarComSenha(db, "maria.limpeza", "errada", depois(ESPERA_MS + 1000))).toEqual({ ok: false, motivo: "senha" });
    expect(await loginBloqueado(db, "maria.limpeza", depois(ESPERA_MS + 1000))).toBeNull();
    expect(await entrarComSenha(db, "maria.limpeza", "senha-da-maria", depois(ESPERA_MS + 2000))).toMatchObject({ ok: true });
  });

  it("quem não existe recebe a mesma resposta e a mesma espera: não dá para descobrir quem tem acesso", async () => {
    for (let i = 1; i < MAX_ERROS; i++) expect(await entrarComSenha(db, "ninguem", "x".repeat(8), AGORA)).toEqual({ ok: false, motivo: "senha" });
    expect(await entrarComSenha(db, "ninguem", "x".repeat(8), AGORA)).toEqual({ ok: false, motivo: "bloqueado" });
    expect(await loginBloqueado(db, "ninguem", AGORA)).toEqual(depois(ESPERA_MS));
    // A espera é de quem foi digitado: a Maria continua entrando.
    expect(await entrarComSenha(db, "maria.limpeza", "senha-da-maria", AGORA)).toMatchObject({ ok: true });
  });
});
