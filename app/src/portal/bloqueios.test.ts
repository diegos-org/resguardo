import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { historicoDe } from "@/auditoria/auditoria";
import { criarContrato } from "@/contratos/repositorio";
import { beds24Envios, bloqueios, imoveis, organizacoes, proprietarioImoveis, proprietarios, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { criarBloqueio } from "@/reservas/bloqueios";
import { bloqueiosDoProprietario, bloquearPeloProprietario, liberarPeloProprietario, permissoesDeBloqueio } from "./bloqueios";

let db: Db, close: () => Promise<void>, org: string, a: string, b: string, c: string, d: string, usuario: string;
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
  const [{ id: dona }, { id: outro }] = await db.insert(proprietarios).values([{ organizacaoId: org, nome: "Dona" }, { organizacaoId: org, nome: "Outro" }]).returning();
  await db.insert(proprietarioImoveis).values([{ proprietarioId: dona, imovelId: a }, { proprietarioId: outro, imovelId: b }, { proprietarioId: dona, imovelId: c }, { proprietarioId: dona, imovelId: d }]);
  [{ id: usuario }] = await db.insert(usuarios).values({ organizacaoId: org, email: "dona@example.com", nome: "Dona", papel: "proprietario" }).returning();
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
