/**
 * A conversa do WhatsApp com o banco de teste (M10.1a, 8-G; seção 12, item 1): com a configuração liberada ("admin e
 * operação"), a operação abre a conversa, mas o vínculo que o admin fez a um proprietário aparece só como "um
 * proprietário" (sem o nome, sem o link, sem "Desfazer vínculo"), e as sugestões dela são só de reserva e cotação. As
 * conversas nascem de avisos fictícios pela leitura e pela gravação, como na rota; o resto é de verdade (acesso,
 * consultas, sugestões, histórico). PGlite, sem rede; as ações ficam só anotadas.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sessao } from "@/acesso/politica";
import { imoveis, proprietarios, reservas, usuarios, whatsappContatos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { salvarQuemVeConversas } from "@/whatsapp/configuracao";
import { avisoDeMensagens, CANARIOS, contatoDoAviso, entregarAviso, HORA_DO_AVISO, itemDoAviso, organizacaoComWhatsapp } from "@/whatsapp/testes";
import { confirmarVinculo } from "@/whatsapp/vinculo";

const m = vi.hoisted(() => ({ sessao: vi.fn(), db: null as unknown }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/whatsapp/acoes", () => ({ confirmarVinculoAcao: vi.fn(), vincularPorCodigoAcao: vi.fn(), desfazerVinculoAcao: vi.fn(), marcarComoLidaAcao: vi.fn() }));
vi.mock("@/components/BotaoConfirmar", () => ({ BotaoConfirmar: ({ children }: { children?: React.ReactNode }) => <button type="submit">{children}</button> }));
import Page from "./page";

const PROPRIETARIA = "Proprietária Fictícia Exemplo";
let db: Db, close: () => Promise<void>, admin: Sessao, operacao: Sessao, comTelefone: string, vinculada: string, proprietarioId: string, reservaId: string;

const usuario = async (organizacaoId: string, papel: "admin" | "operacao"): Promise<Sessao> => {
  const [u] = await db.insert(usuarios).values({ organizacaoId, email: `${papel}@example.com`, nome: papel === "admin" ? "Admin Fictício" : "Operação Fictícia", papel }).returning();
  return { usuarioId: u.id, organizacaoId, papel, imovelIds: [] };
};
const conversaDe = async (org: string, waId: string, wamid: string, texto: string) => {
  await entregarAviso(db, avisoDeMensagens({ contatos: [contatoDoAviso({ waId })], mensagens: [itemDoAviso({ id: wamid, de: waId, em: HORA_DO_AVISO, conteudo: { body: texto } })] }), HORA_DO_AVISO);
  const linhas = await db.select().from(whatsappContatos);
  const c = linhas.find((l) => l.organizacaoId === org && l.waId === waId);
  if (!c) throw new Error("conversa de teste não gravada");
  return c.id;
};
const abrir = async (sessao: Sessao, id: string) => {
  m.sessao.mockResolvedValue(sessao);
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) } as PageProps<"/painel/mensagens/[id]">));
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  m.db = db;
  const org = await organizacaoComWhatsapp(db);
  admin = await usuario(org, "admin");
  operacao = await usuario(org, "operacao");
  const [im] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio Exemplo" }).returning();
  // O mesmo telefone fictício no hóspede de uma reserva futura e na proprietária: as duas viram sugestão para o admin.
  [{ id: reservaId }] = await db
    .insert(reservas)
    .values({ organizacaoId: org, imovelId: im.id, codigo: "SCL-ABC234", origem: "direta", estado: "confirmada", checkin: "2030-01-10", checkout: "2030-01-15", hospedeNome: "Hóspede Fictício", hospedeTelefone: CANARIOS.telefoneFormatado })
    .returning();
  [{ id: proprietarioId }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: PROPRIETARIA, telefone: CANARIOS.comMais }).returning();
  comTelefone = await conversaDe(org, CANARIOS.waIdBr, "wamid.TESTE.PAGINA1", "Bom dia, tudo certo para a estadia?");
  vinculada = await conversaDe(org, CANARIOS.waIdEstrangeiro, "wamid.TESTE.PAGINA2", "Olá, quero falar sobre o apartamento.");
  expect(await confirmarVinculo(db, admin, { contatoId: vinculada, tipo: "proprietario", alvoId: proprietarioId })).toBe("vinculada");
  expect(await salvarQuemVeConversas(db, admin, "admin_e_operacao")).toBe("salvo");
});
afterAll(() => close());

describe("a conversa com o banco (M10.1a)", () => {
  it("o admin vê o vínculo à proprietária com o nome, o link e \"Desfazer vínculo\", e o histórico com o verbo novo", async () => {
    const h = await abrir(admin, vinculada);
    expect(h).toContain(`Vinculada a Proprietário ${PROPRIETARIA} por Admin Fictício em `);
    expect(h).toContain(`href="/painel/proprietarios/${proprietarioId}"`);
    expect(h).toContain(">Desfazer vínculo</button>");
    expect(h).toContain("vinculou a conversa do WhatsApp");
  });

  it("com admin e operação, a operação abre a mesma conversa: \"um proprietário\", sem o nome, sem link de proprietário e sem \"Desfazer vínculo\"", async () => {
    const h = await abrir(operacao, vinculada);
    expect(h).toContain("Olá, quero falar sobre o apartamento.");
    expect(h).toContain("Vinculada a um proprietário por Admin Fictício em ");
    expect(h).not.toContain(PROPRIETARIA);
    expect(h).not.toContain("/painel/proprietarios/");
    expect(h).not.toContain("Desfazer vínculo");
    // Nem pelo histórico: o vínculo sai só como "um proprietário", sem o id do cadastro.
    expect(h).toContain("Vínculo: — → um proprietário");
    expect(h).not.toContain(proprietarioId);
  });

  it("as sugestões da operação são só de reserva e cotação; o admin vê também a proprietária pelo telefone", async () => {
    const daOperacao = await abrir(operacao, comTelefone);
    expect(daOperacao).toContain("Sugestões de vínculo");
    expect(daOperacao).toContain(`name="alvoId" value="${reservaId}"`);
    expect(daOperacao).toContain("mesmo telefone do hóspede");
    expect(daOperacao).not.toContain(PROPRIETARIA);
    expect(daOperacao).not.toContain('value="proprietario"');
    const doAdmin = await abrir(admin, comTelefone);
    expect(doAdmin).toContain(`name="alvoId" value="${proprietarioId}"`);
    expect(doAdmin).toContain(`Proprietário ${PROPRIETARIA}`);
    expect(doAdmin).toContain("mesmo telefone do proprietário");
  });

  it("de volta ao padrão só o admin, a operação recebe só o aviso", async () => {
    expect(await salvarQuemVeConversas(db, admin, "so_admin")).toBe("salvo");
    const h = await abrir(operacao, vinculada);
    expect(h).toContain("As conversas do WhatsApp estão visíveis só para o administrador.");
    expect(h).not.toContain("Olá, quero falar sobre o apartamento.");
    expect(await salvarQuemVeConversas(db, admin, "admin_e_operacao")).toBe("salvo");
  });
});
