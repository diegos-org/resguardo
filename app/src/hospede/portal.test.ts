import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pedirCodigo, verificarCodigo } from "@/acesso/codigo-email";
import { salvarEmpresa } from "@/configuracoes/empresa";
import { auditoria, codigosLogin, imoveis, organizacoes, reservas, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { DETALHES_VAZIOS, salvarDetalhes } from "@/imoveis/detalhes";
import { salvarEmailHospede } from "@/reservas/repositorio";
import { hospedeTemAcesso, instanteLocal, liberacaoDasInstrucoes, pedirCodigoHospede, reservasDoHospede, verificarCodigoHospede } from "./portal";
import { criarSessaoHospede, lerSessaoHospede, VALIDADE_SESSAO_HOSPEDE_MS } from "./sessao";

let db: Db;
let close: () => Promise<void>;
let correio: CorreioMemoria;
let org: string;
let studio: string;
const segredo = "segredo-de-teste";
// 25/09/2026 12:00 em São Paulo.
const agora = new Date("2026-09-25T15:00:00Z");
const opcoes = (over: object = {}) => ({ segredo, agora, gerar: () => "123456", ...over });

const reserva = (over: Partial<typeof reservas.$inferInsert> = {}) => ({
  organizacaoId: org,
  imovelId: studio,
  codigo: "SCL-0001",
  origem: "direta" as const,
  checkin: "2026-10-10",
  checkout: "2026-10-13",
  hospedes: 2,
  hospedeNome: "Ana Exemplo",
  hospedeEmail: "Ana@Example.com ",
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: studio }] = await db
    .insert(imoveis)
    .values({ organizacaoId: org, codigo: "403", nome: "Studio Exemplo", bairro: "Leblon", endereco: "Rua Fictícia, 403" })
    .returning();
  await salvarDetalhes(db, org, studio, { ...DETALHES_VAZIOS, complemento: "apto 101", checkinAPartirDe: "14:00", checkoutAte: "10:00" }, null);
  correio = new CorreioMemoria();
});
afterEach(() => close());

describe("portal do hóspede: quem recebe código (M9.1)", () => {
  it("só o e-mail de uma reserva confirmada e atual; resposta igual para os outros e nada gravado", async () => {
    await db.insert(reservas).values([
      reserva(),
      reserva({ codigo: "SCL-0002", hospedeEmail: "pendente@example.com", estado: "pendente" }),
      reserva({ codigo: "SCL-0003", hospedeEmail: "cancelou@example.com", estado: "cancelada" }),
      reserva({ codigo: "SCL-0004", hospedeEmail: "antigo@example.com", checkin: "2026-08-01", checkout: "2026-08-05" }),
      reserva({ codigo: "SCL-0005", hospedeEmail: "recente@example.com", checkin: "2026-09-01", checkout: "2026-09-05" }),
    ]);
    for (const e of ["pendente@example.com", "cancelou@example.com", "antigo@example.com", "ninguem@example.com", "SCL-0001"])
      expect(await pedirCodigoHospede(db, correio, org, e, opcoes())).toMatch(/sem-acesso|invalido/);
    expect(correio.enviadas).toHaveLength(0);
    expect(await db.select().from(codigosLogin)).toHaveLength(0);

    expect(await pedirCodigoHospede(db, correio, org, " ana@EXAMPLE.com", opcoes())).toBe("enviado");
    expect(await pedirCodigoHospede(db, correio, org, "recente@example.com", opcoes())).toBe("enviado");
    expect(correio.enviadas[0]).toMatchObject({ para: "ana@example.com" });
    expect(correio.enviadas[0].texto).toContain("123456");
    expect(correio.enviadas[0].texto).toContain("Sua Casa Exemplo");
    // O e-mail não leva dados da reserva.
    expect(correio.enviadas[0].texto).not.toMatch(/SCL-0001|Studio|Rua/);
  });

  it("o código do hóspede não entra no painel, e o do painel não entra no portal", async () => {
    await db.insert(reservas).values(reserva());
    await db.insert(usuarios).values({ organizacaoId: org, email: "ana@example.com", nome: "Ana", papel: "operacao" });
    await pedirCodigoHospede(db, correio, org, "ana@example.com", opcoes());
    expect(await verificarCodigo(db, "ana@example.com", "123456", opcoes())).toMatchObject({ ok: false });
    await pedirCodigo(db, correio, "ana@example.com", { segredo, agora, adminEmails: [], gerar: () => "654321" });
    expect(await verificarCodigoHospede(db, org, "ana@example.com", "654321", opcoes())).toMatchObject({ ok: false });
    expect(await verificarCodigoHospede(db, org, "ana@example.com", "123456", opcoes())).toEqual({ ok: true, email: "ana@example.com" });
    expect(await verificarCodigo(db, "ana@example.com", "654321", opcoes())).toMatchObject({ ok: true });
    // Um "e-mail" com o escopo na frente não alcança o código do hóspede.
    await pedirCodigoHospede(db, correio, org, "ana@example.com", opcoes({ gerar: () => "333333" }));
    expect(await verificarCodigo(db, "hospede:ana@example.com", "333333", opcoes())).toMatchObject({ ok: false });
    expect(await verificarCodigoHospede(db, org, "ana@example.com", "333333", opcoes())).toMatchObject({ ok: true });
  });

  it("código de uso único, com limite de tentativas; perdeu o acesso no meio: o código não vale", async () => {
    await db.insert(reservas).values(reserva());
    await pedirCodigoHospede(db, correio, org, "ana@example.com", opcoes());
    for (let i = 0; i < 4; i++) expect(await verificarCodigoHospede(db, org, "ana@example.com", "000000", opcoes())).toMatchObject({ ok: false, motivo: "invalido" });
    expect(await verificarCodigoHospede(db, org, "ana@example.com", "000000", opcoes())).toMatchObject({ ok: false, motivo: "bloqueado" });
    expect(await verificarCodigoHospede(db, org, "ana@example.com", "123456", opcoes())).toMatchObject({ ok: false });

    await pedirCodigoHospede(db, correio, org, "ana@example.com", opcoes({ gerar: () => "222222" }));
    await db.update(reservas).set({ estado: "cancelada" });
    expect(await verificarCodigoHospede(db, org, "ana@example.com", "222222", opcoes())).toMatchObject({ ok: false });
  });
});

describe("portal do hóspede: o que ele vê (M9.1)", () => {
  it("só reservas da empresa do site: reserva do mesmo e-mail em outra organização não dá acesso nem aparece", async () => {
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra Empresa" }).returning();
    const [{ id: imovelOutra }] = await db.insert(imoveis).values({ organizacaoId: outra, codigo: "900", nome: "Casa de Outra", endereco: "Rua de Outra, 9" }).returning();
    await db.insert(reservas).values(reserva({ organizacaoId: outra, imovelId: imovelOutra, codigo: "SCL-0900" }));
    expect(await hospedeTemAcesso(db, org, "ana@example.com", agora)).toBe(false);
    expect(await pedirCodigoHospede(db, correio, org, "ana@example.com", opcoes())).toBe("sem-acesso");
    expect(correio.enviadas).toHaveLength(0);
    expect(await reservasDoHospede(db, org, "ana@example.com", new Date("2026-10-12T15:00:00Z"))).toEqual([]);
    // Na própria organização, sim — e só a dela.
    expect((await reservasDoHospede(db, outra, "ana@example.com", agora)).map((r) => r.codigo)).toEqual(["SCL-0900"]);
    await pedirCodigoHospede(db, correio, outra, "ana@example.com", opcoes());
    expect(await verificarCodigoHospede(db, org, "ana@example.com", "123456", opcoes())).toMatchObject({ ok: false });
  });

  it("só as próprias reservas; trocar o e-mail da reserva no painel tira o acesso", async () => {
    await db.insert(reservas).values([reserva(), reserva({ codigo: "SCL-0009", hospedeEmail: "outro@example.com", hospedeNome: "Outro" })]);
    const lista = await reservasDoHospede(db, org, "ana@example.com", agora);
    expect(lista.map((r) => r.codigo)).toEqual(["SCL-0001"]);
    expect(lista[0]).toMatchObject({ imovel: "Studio Exemplo", bairro: "Leblon", noites: 3, hospedes: 2, entradaAPartirDe: "14:00", saidaAte: "10:00", nomeHospede: "Ana Exemplo" });
    expect(JSON.stringify(lista)).not.toMatch(/Outro|valor|Bruto|Liquido/);

    await db.update(reservas).set({ hospedeEmail: "novo@example.com" });
    expect(await reservasDoHospede(db, org, "ana@example.com", agora)).toEqual([]);
    expect(await hospedeTemAcesso(db, org, "ana@example.com", agora)).toBe(false);
  });

  it("endereço completo só a partir de 2 dias antes da entrada, às 10h de São Paulo", async () => {
    await db.insert(reservas).values(reserva());
    const ver = async (iso: string) => (await reservasDoHospede(db, org, "ana@example.com", new Date(iso)))[0].instrucoes;
    // 08/10 09:59 em São Paulo (12:59 UTC): ainda não.
    expect(await ver("2026-10-08T12:59:00Z")).toEqual({ liberadas: false, liberaEm: new Date("2026-10-08T13:00:00Z"), dia: "2026-10-08" });
    expect(JSON.stringify(await reservasDoHospede(db, org, "ana@example.com", new Date("2026-10-08T12:59:00Z")))).not.toMatch(/Rua Fictícia|apto 101/);
    expect(await ver("2026-10-08T13:00:00Z")).toEqual({ liberadas: true, endereco: "Rua Fictícia, 403", complemento: "apto 101" });
    // No dia da saída, até o horário de saída do imóvel (10h): ainda aparece.
    expect(await ver("2026-10-13T12:59:00Z")).toMatchObject({ liberadas: true });
    // Passou do horário de saída (mesmo dia): some, e a reserva aparece como encerrada.
    const depois = (await reservasDoHospede(db, org, "ana@example.com", new Date("2026-10-13T13:00:00Z")))[0];
    expect(depois).toMatchObject({ encerrada: true, instrucoes: { liberadas: false } });
  });

  it("horário local no fuso do imóvel", () => {
    expect(instanteLocal("2026-10-08", "10:00", "America/Sao_Paulo").toISOString()).toBe("2026-10-08T13:00:00.000Z");
    expect(instanteLocal("2026-07-01", "10:00", "Europe/Lisbon").toISOString()).toBe("2026-07-01T09:00:00.000Z");
    expect(instanteLocal("2026-01-15", "10:00", "Europe/Lisbon").toISOString()).toBe("2026-01-15T10:00:00.000Z");
    // Entrada dia 1º: libera no dia 30 do mês anterior.
    expect(liberacaoDasInstrucoes("2026-11-01", "America/Sao_Paulo").toISOString()).toBe("2026-10-30T13:00:00.000Z");
  });

  it("contato da empresa para dúvidas vem do cadastro da empresa", async () => {
    await db.insert(reservas).values(reserva());
    await salvarEmpresa(db, org, { nome: "Sua Casa Exemplo", razaoSocial: "", cnpj: "", email: "contato@example.com", telefone: "(21) 90000-0000", endereco: "", site: "", chavePix: "" }, null);
    const [r] = await reservasDoHospede(db, org, "ana@example.com", agora);
    expect(r.contato).toEqual({ empresa: "Sua Casa Exemplo", whatsapp: "5521900000000", email: "contato@example.com" });
  });
});

describe("sessão do portal do hóspede (M9.1)", () => {
  it("cookie assinado: vale até vencer; adulterado ou com outro segredo, não vale", () => {
    const t = criarSessaoHospede("ana@example.com", segredo, agora);
    expect(lerSessaoHospede(t, segredo, agora)).toBe("ana@example.com");
    expect(lerSessaoHospede(t, segredo, new Date(agora.getTime() + VALIDADE_SESSAO_HOSPEDE_MS))).toBeNull();
    expect(lerSessaoHospede(t, "outro-segredo", agora)).toBeNull();
    const [corpo, assinatura] = t.split(".");
    const falso = Buffer.from(JSON.stringify({ e: "outro@example.com", x: agora.getTime() + 1000 })).toString("base64url");
    expect(lerSessaoHospede(`${falso}.${assinatura}`, segredo, agora)).toBeNull();
    expect(lerSessaoHospede(`${corpo}.${assinatura}.x`, segredo, agora)).toBeNull();
    expect(lerSessaoHospede(undefined, segredo, agora)).toBeNull();
    expect(lerSessaoHospede(t, undefined, agora)).toBeNull();
  });
});

describe("e-mail do hóspede no painel (M9.1)", () => {
  it("cadastrar/corrigir o e-mail passa o acesso ao e-mail novo, sem o e-mail por extenso no histórico", async () => {
    const [{ id }] = await db.insert(reservas).values(reserva({ hospedeEmail: "" })).returning();
    expect(await hospedeTemAcesso(db, org, "ana@example.com", agora)).toBe(false);
    expect(await salvarEmailHospede(db, org, id, "nao-e-email", null)).toEqual({ ok: false, erro: "E-mail inválido." });
    const [{ id: outraOrg }] = await db.insert(organizacoes).values({ nome: "Outra" }).returning();
    expect(await salvarEmailHospede(db, outraOrg, id, "ana@example.com", null)).toMatchObject({ ok: false });
    expect(await salvarEmailHospede(db, org, id, " Ana@Example.com ", null)).toEqual({ ok: true });
    expect(await hospedeTemAcesso(db, org, "ana@example.com", agora)).toBe(true);
    expect(await salvarEmailHospede(db, org, id, "nova@example.com", null)).toEqual({ ok: true });
    expect(await hospedeTemAcesso(db, org, "ana@example.com", agora)).toBe(false);
    const hist = await db.select().from(auditoria);
    expect(hist.filter((h) => h.acao === "reserva.email_hospede")).toHaveLength(2);
    expect(JSON.stringify(hist)).not.toMatch(/ana@example|nova@example/);
  });
});
