/**
 * Vínculo da conversa do WhatsApp (M10.1a, desenho 5.3 e 5.4; cenários de 8-F): sugestões pelo código e pelo telefone,
 * a permissão de cada tipo de alvo, a ordem e o limite, confirmar, vincular pelo código, desfazer, auditoria só com
 * `tipo:id`, nada gravado nos cadastros (foto das linhas), nada se confirma sozinho, acesso negado sem gravar e erro de
 * banco sem dado pessoal. As conversas nascem de avisos fictícios pela leitura e pela gravação, como na rota
 * (`entregarAviso`). PGlite, sem rede.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import {
  auditoria,
  cadastrosMarketplace,
  cotacoes,
  type EstadoReserva,
  imoveis,
  organizacoes,
  type Papel,
  pedidosContatoProprietario,
  profissionaisLimpeza,
  proprietarios,
  representantes,
  reservas,
  usuarios,
  whatsappContatos,
} from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { MENSAGEM_OMITIDA } from "@/observabilidade/erro-de-rotina";
import { gerarCodigo } from "@/reservas/regras";
import { salvarQuemVeConversas } from "./configuracao";
import { conversasDaReserva } from "./conversas";
import {
  avisoDeEcos,
  avisoDeMensagens,
  CANARIOS,
  contatoDoAviso,
  ecoDoAviso,
  entregarAviso,
  FICTICIOS,
  HORA_DO_AVISO,
  itemDoAviso,
  organizacaoComWhatsapp,
  semDadosPessoaisWhatsapp,
} from "./testes";
import {
  type Candidato,
  candidatosDaConversa,
  confirmarVinculo,
  conversasQueSugeremAReserva,
  desfazerVinculo,
  MAXIMO_CANDIDATOS,
  ROTULO_MOTIVO_CANDIDATO,
  vinculosNaTela,
  vincularPorCodigo,
} from "./vinculo";

/** 17/10/2026, 12:00 em São Paulo: "hoje − 365 dias" é 17/10/2025. */
const AGORA = new Date("2026-10-17T15:00:00Z");

let db: Db, close: () => Promise<void>, org: string, outra: string, im: string, imOutra: string;
let admin: Sessao, operacao: Sessao, dono: Sessao, limpeza: Sessao;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());

const usuario = async (organizacaoId: string, papel: Papel, extra: Partial<Sessao> = {}): Promise<Sessao> => {
  const [u] = await db.insert(usuarios).values({ organizacaoId, email: `${papel}.${crypto.randomUUID().slice(0, 8)}@example.com`, nome: `Usuário ${papel} fictício`, papel }).returning();
  return { usuarioId: u.id, organizacaoId, papel, imovelIds: [], ...extra };
};

beforeEach(async () => {
  org = await organizacaoComWhatsapp(db);
  [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra Empresa Exemplo" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio Exemplo" }).returning();
  [{ id: imOutra }] = await db.insert(imoveis).values({ organizacaoId: outra, codigo: "403", nome: "Studio de Outra Empresa" }).returning();
  admin = await usuario(org, "admin");
  operacao = await usuario(org, "operacao");
  dono = await usuario(org, "proprietario", { imovelIds: [im] });
  limpeza = await usuario(org, "limpeza", { profissionalId: crypto.randomUUID() });
});

// ---------------------------------------------------------------- montagem

async function reserva(o: { codigo?: string; telefone?: string; entrada?: string; saida?: string; estado?: EstadoReserva; organizacaoId?: string; hospede?: string } = {}) {
  const daOutra = o.organizacaoId === outra;
  const [r] = await db
    .insert(reservas)
    .values({
      organizacaoId: o.organizacaoId ?? org,
      imovelId: daOutra ? imOutra : im,
      codigo: o.codigo ?? gerarCodigo(),
      origem: "direta",
      estado: o.estado ?? "confirmada",
      checkin: o.entrada ?? "2026-12-20",
      checkout: o.saida ?? "2026-12-27",
      hospedeNome: o.hospede ?? "Hóspede Fictício",
      hospedeTelefone: o.telefone ?? "",
    })
    .returning();
  return r;
}

async function cotacao(o: { codigo: string; reservaId?: string; organizacaoId?: string }) {
  const [c] = await db
    .insert(cotacoes)
    .values({ organizacaoId: o.organizacaoId ?? org, imovelId: o.organizacaoId === outra ? imOutra : im, codigo: o.codigo, reservaId: o.reservaId, checkin: "2026-12-20", checkout: "2026-12-27", noites: 7, hospedes: 2, situacao: "disponivel", diarias: 1, limpeza: 0, hospedeExtra: 0, valorCheio: 1, total: 1 })
    .returning();
  return c;
}

const proprietario = async (nome: string, telefone = "") => (await db.insert(proprietarios).values({ organizacaoId: org, nome, telefone }).returning())[0];
const pedido = async (telefone: string, criadoEm = new Date("2026-10-10T15:00:00Z")) =>
  (await db.insert(pedidosContatoProprietario).values({ organizacaoId: org, nome: "Interessado Fictício", email: "interessado@example.com", telefone, bairro: "Leblon", cidade: "Rio de Janeiro", criadoEm }).returning())[0];
const cadastro = async (telefone: string, criadoEm = new Date("2026-10-11T15:00:00Z")) =>
  (
    await db
      .insert(cadastrosMarketplace)
      .values({ organizacaoId: org, email: "cadastro@example.com", nome: "Cadastro Fictício", telefone, anuncio: "novo", criadoEm, imovel: { nome: "Apto", bairro: "Leblon", cidade: "Rio de Janeiro", endereco: "Rua Fictícia, 1", capacidade: 2, quartos: 1, banheiros: 1, descricao: "" } })
      .returning()
  )[0];

let wamids = 0;
let minutos = 0;
const proximaHora = () => new Date(HORA_DO_AVISO.getTime() + ++minutos * 60_000);
const entregar = (json: unknown) => entregarAviso(db, json, new Date(AGORA.getTime() + minutos * 1000));

type Identidade = { waId?: string | null; bsuid?: string };
/** Mensagens do cliente (e, se dadas, respostas pelo celular) numa conversa; devolve o id da conversa. */
async function conversa(textos: string[], o: Identidade & { ecos?: string[] } = {}): Promise<string> {
  const waId = o.waId === undefined ? CANARIOS.waIdBr : o.waId;
  const de = waId ?? null;
  const mensagens = textos.map((t) => itemDoAviso({ id: `wamid.TESTE.V${++wamids}`, de, deUsuario: o.bsuid, em: proximaHora(), conteudo: { body: t } }));
  await entregar(avisoDeMensagens({ contatos: [contatoDoAviso({ waId, bsuid: o.bsuid })], mensagens }));
  if (o.ecos?.length) {
    const ecos = o.ecos.map((t) => ecoDoAviso({ id: `wamid.TESTE.V${++wamids}`, para: waId ?? undefined, paraUsuario: o.bsuid, em: proximaHora(), conteudo: { body: t } }));
    await entregar(avisoDeEcos({ ecos }));
  }
  const linhas = await db.select().from(whatsappContatos).where(eq(whatsappContatos.organizacaoId, org));
  const achada = linhas.find((c) => (waId !== null && c.waId === waId) || (o.bsuid !== undefined && c.bsuid === o.bsuid));
  if (!achada) throw new Error("conversa de teste não gravada");
  return achada.id;
}

const sugestoes = async (contatoId: string, sessao: Sessao = admin) => {
  const r = await candidatosDaConversa(db, sessao, contatoId, AGORA);
  if (!r) throw new Error("conversa não encontrada");
  return r;
};
const resumo = (cs: Candidato[]) => cs.map((c) => [c.tipo, c.id, c.motivos]);
const linhaDa = async (contatoId: string) => (await db.select().from(whatsappContatos).where(eq(whatsappContatos.id, contatoId)))[0];
const daAuditoria = () => db.select().from(auditoria).where(eq(auditoria.organizacaoId, org)).orderBy(asc(auditoria.criadoEm), asc(auditoria.id));

// ---------------------------------------------------------------- sugestões pelo código

describe("sugestões pelo código (M10.1a)", () => {
  it("código SCL válido na mensagem do cliente vira sugestão; em minúsculas também; na resposta pelo celular também; de outra organização, fora do alfabeto ou em mensagem apagada, não", async () => {
    const a = await reserva({ codigo: "SCL-ABC234" });
    const b = await reserva({ codigo: "SCL-DEF567" });
    const c = await reserva({ codigo: "SCL-GHJ789" });
    await reserva({ codigo: "SCL-KMN234", organizacaoId: outra });
    // Gravada direto (fora do alfabeto, com "1"): o código no texto não é lido, então nunca vira sugestão.
    await reserva({ codigo: "SCL-ABC123" });
    const apagada = await reserva({ codigo: "SCL-PQR234" });
    const id = await conversa(["Oi! Minha reserva é SCL-ABC234.", "e a da minha irmã: scl-def567", "Vi também SCL-KMN234 e SCL-ABC123", "Era SCL-PQR234"], { ecos: ["Anotado: SCL-GHJ789"] });
    // O cliente apaga a mensagem com o SCL-PQR234: o código some das sugestões.
    await entregar(avisoDeMensagens({ mensagens: [itemDoAviso({ id: `wamid.TESTE.V${++wamids}`, em: proximaHora(), tipo: "revoke", conteudo: { original_message_id: `wamid.TESTE.V${wamids - 2}` } })] }));

    const { candidatos, mais } = await sugestoes(id);
    expect(new Set(candidatos.map((x) => x.id))).toEqual(new Set([a.id, b.id, c.id]));
    expect(candidatos.map((x) => x.id)).not.toContain(apagada.id);
    expect(candidatos.every((x) => x.tipo === "reserva" && x.motivos.join() === "codigo_reserva")).toBe(true);
    expect(mais).toBe(0);
    expect(candidatos.find((x) => x.id === a.id)).toEqual({
      tipo: "reserva",
      id: a.id,
      motivos: ["codigo_reserva"],
      rotulo: "Reserva SCL-ABC234 · Studio Exemplo · 20/12/2026 a 27/12/2026 · Hóspede Fictício",
      link: `/painel/reservas/${a.id}`,
    });
  });

  it("a fixture assinada (SCL-ABC123, fora do alfabeto) não sugere a reserva gravada com esse código", async () => {
    await reserva({ codigo: "SCL-ABC123" });
    await entregar(JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/corpo-assinado.json", import.meta.url)), "utf8")));
    const [c] = await db.select().from(whatsappContatos).where(and(eq(whatsappContatos.organizacaoId, org), eq(whatsappContatos.waId, FICTICIOS.cliente)));
    expect(await sugestoes(c.id)).toEqual({ candidatos: [], mais: 0 });
  });

  it("COT de cotação sem reserva sugere a cotação; COT de cotação que virou reserva sugere a reserva, com os motivos juntos", async () => {
    const r = await reserva({ codigo: "SCL-ABC234" });
    await cotacao({ codigo: "COT-7K3M9QX2", reservaId: r.id });
    const solta = await cotacao({ codigo: "COT-ABCDEFGH" });
    await cotacao({ codigo: "COT-HJKMNPQR", organizacaoId: outra });
    const id = await conversa(["Cotei COT-7K3M9QX2, COT-ABCDEFGH e COT-HJKMNPQR", "a reserva ficou SCL-ABC234"]);
    const { candidatos } = await sugestoes(id);
    expect(resumo(candidatos)).toEqual([
      ["reserva", r.id, ["codigo_reserva", "codigo_cotacao_com_reserva"]],
      ["cotacao", solta.id, ["codigo_cotacao"]],
    ]);
    expect(candidatos[1]).toMatchObject({ rotulo: "Cotação COT-ABCDEFGH · Studio Exemplo · 20/12/2026 a 27/12/2026", link: null });
    expect(candidatos.map((c) => c.motivos.map((m) => ROTULO_MOTIVO_CANDIDATO[m]))).toEqual([["código da reserva na conversa", "código da cotação que virou esta reserva"], ["código da cotação na conversa"]]);
  });

  it("código de reserva cancelada também vira sugestão, com ' · cancelada' no rótulo; sem nome do hóspede, o rótulo o omite", async () => {
    const x = await reserva({ codigo: "SCL-STU234", estado: "cancelada", hospede: "" });
    const id = await conversa(["A SCL-STU234 foi cancelada?"]);
    expect((await sugestoes(id)).candidatos).toEqual([
      { tipo: "reserva", id: x.id, motivos: ["codigo_reserva"], rotulo: "Reserva SCL-STU234 · Studio Exemplo · 20/12/2026 a 27/12/2026 · cancelada", link: `/painel/reservas/${x.id}` },
    ]);
  });

  it("até 5 códigos por mensagem (os primeiros do texto)", async () => {
    const cods = ["SCL-AAA234", "SCL-BBB234", "SCL-CCC234", "SCL-DDD234", "SCL-EEE234", "SCL-FFF234"];
    for (const k of cods) await reserva({ codigo: k });
    const id = await conversa([cods.join(" ")]);
    const { candidatos, mais } = await sugestoes(id);
    expect(candidatos.map((c) => c.rotulo.split(" ")[1]).sort()).toEqual(cods.slice(0, 5));
    expect(mais).toBe(0);
  });

  it("até 20 códigos por conversa, das mensagens mais recentes", async () => {
    const LETRAS = "ABCDE";
    // Cinco mensagens com cinco códigos distintos cada (25 códigos), uma reserva por código; a primeira é a mais antiga.
    const porMensagem = [...LETRAS].map((a) => [...LETRAS].map((b) => `SCL-${a}${b}Z234`));
    const doCodigo = new Map<string, string>();
    for (const k of porMensagem.flat()) doCodigo.set(k, (await reserva({ codigo: k })).id);
    const id = await conversa(porMensagem.map((ks) => ks.join(" ")));
    const { candidatos, mais } = await sugestoes(id);
    expect(candidatos).toHaveLength(MAXIMO_CANDIDATOS);
    expect(candidatos.length + mais).toBe(20);
    // A mensagem mais antiga fica de fora; a mais recente entra.
    const sugere = async (codigo: string) => (await conversasQueSugeremAReserva(db, admin, [id], doCodigo.get(codigo) ?? "", AGORA)).length === 1;
    for (const k of porMensagem[0]) expect(await sugere(k), k).toBe(false);
    for (const k of porMensagem[4]) expect(await sugere(k), k).toBe(true);
  });
});

// ---------------------------------------------------------------- sugestões pelo telefone

describe("sugestões pelo telefone (M10.1a)", () => {
  it("o telefone da reserva com e sem o nono dígito casa com o wa_id; cancelada e com saída antes de hoje − 365 dias não entram; o rótulo não leva telefone", async () => {
    const com9 = await reserva({ telefone: CANARIOS.telefoneFormatado });
    const sem9 = await reserva({ telefone: "(21) 9999-0000", entrada: "2026-11-01", saida: "2026-11-05" });
    await reserva({ telefone: CANARIOS.comMais, estado: "cancelada" });
    await reserva({ telefone: CANARIOS.telefoneFormatado, entrada: "2025-10-10", saida: "2025-10-16" });
    const noLimite = await reserva({ telefone: "+55 21 99999-0000", entrada: "2025-10-12", saida: "2025-10-17" });
    // Telefone que não casa com a conversa (FICTICIOS.cliente com DDI).
    await reserva({ telefone: "+1 650 555 1234" });
    await reserva({ telefone: CANARIOS.telefoneFormatado, organizacaoId: outra });
    const id = await conversa(["Olá, tudo bem?"]);
    const { candidatos } = await sugestoes(id);
    // Em curso e futuras pela entrada; depois as passadas.
    expect(resumo(candidatos)).toEqual([
      ["reserva", sem9.id, ["telefone_hospede"]],
      ["reserva", com9.id, ["telefone_hospede"]],
      ["reserva", noLimite.id, ["telefone_hospede"]],
    ]);
    for (const c of candidatos) expect(c.rotulo).not.toMatch(/9999|0000/);
  });

  it("a conversa com o wa_id sem o nono dígito casa com o telefone cadastrado com ele", async () => {
    const r = await reserva({ telefone: CANARIOS.telefoneFormatado });
    const id = await conversa(["Olá"], { waId: CANARIOS.waIdBrSem9 });
    expect(resumo((await sugestoes(id)).candidatos)).toEqual([["reserva", r.id, ["telefone_hospede"]]]);
  });

  it("estrangeiro: com '+' casa; sem '+' não (11 dígitos sem DDI são lidos como Brasil)", async () => {
    const comMais = await reserva({ telefone: "+1 650 555 0199" });
    await reserva({ telefone: CANARIOS.waIdEstrangeiro });
    const id = await conversa(["Hello"], { waId: CANARIOS.waIdEstrangeiro });
    expect(resumo((await sugestoes(id)).candidatos)).toEqual([["reserva", comMais.id, ["telefone_hospede"]]]);
  });

  it("contato só com BSUID: só pelo código", async () => {
    const pelo = await reserva({ codigo: "SCL-ABC234", telefone: CANARIOS.telefoneFormatado });
    await reserva({ telefone: CANARIOS.telefoneFormatado });
    const id = await conversa(["Minha reserva: SCL-ABC234"], { waId: null, bsuid: CANARIOS.bsuid });
    expect(resumo((await sugestoes(id)).candidatos)).toEqual([["reserva", pelo.id, ["codigo_reserva"]]]);
  });
});

// ---------------------------------------------------------------- tipos de alvo, permissão, ordem

describe("tipos de alvo, permissão e ordem (M10.1a)", () => {
  const TEL = "+1 650 555 1234";

  it("pedido de contato, cadastro, proprietário e representante (sugere o proprietário) pelo telefone, só para o admin; liberada, a operação vê só reserva e cotação", async () => {
    const solta = await cotacao({ codigo: "COT-ABCDEFGH" });
    const r = await reserva({ telefone: TEL });
    const p = await pedido(TEL);
    const k = await cadastro(TEL);
    const ana = await proprietario("Ana Fictícia", TEL);
    const bruno = await proprietario("Bruno Fictício");
    await db.insert(representantes).values([
      { proprietarioId: ana.id, nome: "Representante Um", telefone: TEL },
      { proprietarioId: bruno.id, nome: "Representante Dois", telefone: TEL },
    ]);
    const id = await conversa(["Olá, fiz a COT-ABCDEFGH"], { waId: FICTICIOS.cliente });

    const { candidatos } = await sugestoes(id);
    expect(resumo(candidatos)).toEqual([
      ["cotacao", solta.id, ["codigo_cotacao"]],
      ["reserva", r.id, ["telefone_hospede"]],
      ["pedido_contato", p.id, ["telefone_pedido_contato"]],
      ["cadastro_marketplace", k.id, ["telefone_cadastro"]],
      ["proprietario", ana.id, ["telefone_proprietario", "telefone_representante"]],
      ["proprietario", bruno.id, ["telefone_representante"]],
    ]);
    expect(candidatos.slice(2).map((c) => [c.rotulo, c.link])).toEqual([
      ["Pedido de contato de Interessado Fictício (10/10/2026)", "/painel/proprietarios/contatos"],
      ["Cadastro pelo site de Cadastro Fictício (11/10/2026)", "/painel/proprietarios/cadastros"],
      ["Proprietário Ana Fictícia", `/painel/proprietarios/${ana.id}`],
      ["Proprietário Bruno Fictício", `/painel/proprietarios/${bruno.id}`],
    ]);

    await expect(candidatosDaConversa(db, operacao, id, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    expect(await salvarQuemVeConversas(db, admin, "admin_e_operacao")).toBe("salvo");
    expect(resumo((await sugestoes(id, operacao)).candidatos)).toEqual([
      ["cotacao", solta.id, ["codigo_cotacao"]],
      ["reserva", r.id, ["telefone_hospede"]],
    ]);
  });

  it("vários candidatos: código antes de telefone, em curso e futuras (pela entrada) antes das passadas (a mais recente primeiro), até 10 e 'mais'", async () => {
    const peloCodigo = await reserva({ codigo: "SCL-ZZZ234", entrada: "2026-01-10", saida: "2026-01-15" });
    const futuras: (typeof reservas.$inferSelect)[] = [];
    // Criadas fora de ordem; a de 15/10 a 20/10 está em curso.
    for (const [entrada, saida] of [["2026-11-05", "2026-11-08"], ["2026-10-15", "2026-10-20"], ["2026-11-03", "2026-11-04"], ["2026-12-01", "2026-12-03"], ["2026-11-01", "2026-11-02"], ["2026-11-20", "2026-11-22"], ["2026-11-10", "2026-11-12"]])
      futuras.push(await reserva({ telefone: CANARIOS.telefoneFormatado, entrada, saida }));
    const passadas: (typeof reservas.$inferSelect)[] = [];
    for (const [entrada, saida] of [["2026-06-01", "2026-06-05"], ["2026-09-01", "2026-09-03"], ["2026-03-01", "2026-03-02"], ["2026-08-01", "2026-08-04"], ["2026-10-10", "2026-10-12"]])
      passadas.push(await reserva({ telefone: CANARIOS.telefoneFormatado, entrada, saida }));
    const id = await conversa(["Sobre a SCL-ZZZ234"]);

    const { candidatos, mais } = await sugestoes(id);
    expect(candidatos).toHaveLength(MAXIMO_CANDIDATOS);
    expect(mais).toBe(3);
    const porEntrada = (xs: typeof futuras) => [...xs].sort((a, b) => (a.checkin < b.checkin ? -1 : 1)).map((x) => x.id);
    expect(candidatos.map((c) => c.id)).toEqual([peloCodigo.id, ...porEntrada(futuras), ...porEntrada(passadas).reverse().slice(0, 2)]);
    expect(candidatos[0].motivos).toEqual(["codigo_reserva"]);
  });

  it("o alvo já vinculado à conversa sai das sugestões", async () => {
    const a = await reserva({ codigo: "SCL-ABC234" });
    const b = await reserva({ codigo: "SCL-DEF567" });
    const id = await conversa(["SCL-ABC234 e SCL-DEF567"]);
    expect(await confirmarVinculo(db, admin, { contatoId: id, tipo: "reserva", alvoId: a.id }, AGORA)).toBe("vinculada");
    expect(resumo((await sugestoes(id)).candidatos)).toEqual([["reserva", b.id, ["codigo_reserva"]]]);
  });

  it("conversa de outra organização ou id malformado: null", async () => {
    const outraComWhatsapp = await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba, numeroId: FICTICIOS.outroNumero }, { manterOutras: true });
    await entregar(avisoDeMensagens({ waba: FICTICIOS.outraWaba, numero: FICTICIOS.outroNumero }));
    const [deOutra] = await db.select().from(whatsappContatos).where(eq(whatsappContatos.organizacaoId, outraComWhatsapp));
    expect(deOutra).toBeDefined();
    expect(await candidatosDaConversa(db, admin, deOutra.id, AGORA)).toBeNull();
    expect(await candidatosDaConversa(db, admin, "nao-e-um-id", AGORA)).toBeNull();
    expect(await candidatosDaConversa(db, admin, crypto.randomUUID(), AGORA)).toBeNull();
  });
});

// ---------------------------------------------------------------- nada se confirma sozinho

describe("nada se confirma sozinho (M10.1a, T7)", () => {
  it("depois de avisos com códigos e telefones que casam, e de calcular as sugestões, todas as conversas continuam sem alvo", async () => {
    const r = await reserva({ codigo: "SCL-ABC234", telefone: CANARIOS.telefoneFormatado });
    await cotacao({ codigo: "COT-ABCDEFGH" });
    await proprietario("Ana Fictícia", "+1 650 555 1234");
    const a = await conversa(["Minha reserva é SCL-ABC234, cotei COT-ABCDEFGH"]);
    const b = await conversa(["Olá"], { waId: FICTICIOS.cliente });
    const c = await conversa(["SCL-ABC234"], { waId: null, bsuid: CANARIOS.bsuid });
    for (const id of [a, b, c]) expect((await sugestoes(id)).candidatos.length).toBeGreaterThan(0);
    expect((await conversasDaReserva(db, admin, r.id, AGORA)).sugeridas).toBe(2);
    for (const l of await db.select().from(whatsappContatos).where(eq(whatsappContatos.organizacaoId, org))) {
      expect([l.reservaId, l.cotacaoId, l.pedidoContatoId, l.cadastroMarketplaceId, l.proprietarioId, l.vinculoConfirmadoPor, l.vinculoConfirmadoEm]).toEqual([null, null, null, null, null, null, null]);
    }
    expect((await daAuditoria()).filter((l) => l.acao.startsWith("whatsapp.conversa"))).toEqual([]);
  });
});

// ---------------------------------------------------------------- confirmar, pelo código, desfazer

describe("confirmar, vincular pelo código e desfazer (M10.1a)", () => {
  it("confirmarVinculo grava o alvo, o autor e a data; o mesmo alvo de novo não grava; outro alvo → ja_vinculada; alvo de outra organização → alvo_nao_encontrado", async () => {
    const a = await reserva();
    const b = await reserva();
    const deOutra = await reserva({ organizacaoId: outra });
    const id = await conversa(["Olá"]);

    expect(await confirmarVinculo(db, admin, { contatoId: id, tipo: "reserva", alvoId: a.id }, AGORA)).toBe("vinculada");
    expect(await linhaDa(id)).toMatchObject({ reservaId: a.id, vinculoConfirmadoPor: admin.usuarioId, vinculoConfirmadoEm: AGORA, cotacaoId: null, proprietarioId: null });
    expect(await confirmarVinculo(db, admin, { contatoId: id, tipo: "reserva", alvoId: a.id }, new Date(AGORA.getTime() + 60_000))).toBe("vinculada");
    expect((await linhaDa(id)).vinculoConfirmadoEm).toEqual(AGORA);
    expect(await confirmarVinculo(db, admin, { contatoId: id, tipo: "reserva", alvoId: b.id }, AGORA)).toBe("ja_vinculada");
    expect((await linhaDa(id)).reservaId).toBe(a.id);
    expect((await daAuditoria()).filter((l) => l.acao === "whatsapp.conversa.vincular")).toHaveLength(1);

    const outraConversa = await conversa(["Hello"], { waId: CANARIOS.waIdEstrangeiro });
    expect(await confirmarVinculo(db, admin, { contatoId: outraConversa, tipo: "reserva", alvoId: deOutra.id }, AGORA)).toBe("alvo_nao_encontrado");
    expect(await confirmarVinculo(db, admin, { contatoId: outraConversa, tipo: "proprietario", alvoId: crypto.randomUUID() }, AGORA)).toBe("alvo_nao_encontrado");
    expect(await confirmarVinculo(db, admin, { contatoId: outraConversa, tipo: "reserva", alvoId: "nao-e-um-id" }, AGORA)).toBe("alvo_nao_encontrado");
    expect(await confirmarVinculo(db, admin, { contatoId: crypto.randomUUID(), tipo: "reserva", alvoId: a.id }, AGORA)).toBe("conversa_nao_encontrada");
    expect(await confirmarVinculo(db, admin, { contatoId: "nao-e-um-id", tipo: "reserva", alvoId: a.id }, AGORA)).toBe("conversa_nao_encontrada");
    // Tipo fora da lista fechada não chega ao banco.
    await expect(confirmarVinculo(db, admin, { contatoId: outraConversa, tipo: "__proto__" as never, alvoId: a.id }, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    expect((await linhaDa(outraConversa)).vinculoConfirmadoEm).toBeNull();
  });

  it("confirmarVinculo com uma cotação que virou reserva (depois da sugestão) grava a reserva, e a auditoria leva reserva:<id>", async () => {
    const r = await reserva({ codigo: "SCL-ABC234" });
    const cot = await cotacao({ codigo: "COT-ABCDEFGH" });
    const id = await conversa(["Cotei COT-ABCDEFGH"]);
    expect(resumo((await sugestoes(id)).candidatos)).toEqual([["cotacao", cot.id, ["codigo_cotacao"]]]);
    // O hóspede segura as datas no site: a cotação ganha a reserva antes do clique em "Vincular".
    await db.update(cotacoes).set({ reservaId: r.id }).where(eq(cotacoes.id, cot.id));
    expect(await confirmarVinculo(db, admin, { contatoId: id, tipo: "cotacao", alvoId: cot.id }, AGORA)).toBe("vinculada");
    expect(await linhaDa(id)).toMatchObject({ reservaId: r.id, cotacaoId: null, vinculoConfirmadoPor: admin.usuarioId, vinculoConfirmadoEm: AGORA });
    expect((await conversasDaReserva(db, admin, r.id, AGORA)).confirmadas.map((c) => c.id)).toEqual([id]);
    // De novo pela cotação: o mesmo alvo, sem gravar outra vez.
    expect(await confirmarVinculo(db, admin, { contatoId: id, tipo: "cotacao", alvoId: cot.id }, AGORA)).toBe("vinculada");
    expect((await daAuditoria()).filter((l) => l.acao.startsWith("whatsapp.conversa")).map((l) => l.mudancas)).toEqual([{ vinculo: [null, `reserva:${r.id}`] }]);
  });

  it("conversa de outra organização: confirmar, vincular pelo código e desfazer dão conversa_nao_encontrada, sem gravar", async () => {
    const outraOrg = await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba, numeroId: FICTICIOS.outroNumero }, { manterOutras: true });
    await entregar(avisoDeMensagens({ waba: FICTICIOS.outraWaba, numero: FICTICIOS.outroNumero }));
    const [deOutra] = await db.select().from(whatsappContatos).where(eq(whatsappContatos.organizacaoId, outraOrg));
    expect(deOutra).toBeDefined();
    const r = await reserva({ codigo: "SCL-ABC234" });

    expect(await confirmarVinculo(db, admin, { contatoId: deOutra.id, tipo: "reserva", alvoId: r.id }, AGORA)).toBe("conversa_nao_encontrada");
    expect(await vincularPorCodigo(db, admin, { contatoId: deOutra.id, codigo: "SCL-ABC234" }, AGORA)).toBe("conversa_nao_encontrada");
    expect((await linhaDa(deOutra.id)).vinculoConfirmadoEm).toBeNull();
    // Um vínculo gravado direto na conversa da outra organização: o admin desta não o desfaz.
    await db.update(whatsappContatos).set({ reservaId: r.id, vinculoConfirmadoEm: AGORA }).where(eq(whatsappContatos.id, deOutra.id));
    expect(await desfazerVinculo(db, admin, deOutra.id, AGORA)).toBe("conversa_nao_encontrada");
    expect(await linhaDa(deOutra.id)).toMatchObject({ reservaId: r.id, vinculoConfirmadoEm: AGORA });
    expect(await db.select().from(auditoria).where(and(inArray(auditoria.organizacaoId, [org, outraOrg]), like(auditoria.acao, "whatsapp.conversa.%")))).toEqual([]);
  });

  it("cada tipo de alvo confirmado grava a sua coluna (um só, com a data)", async () => {
    const alvos = [
      { tipo: "cotacao" as const, id: (await cotacao({ codigo: "COT-ABCDEFGH" })).id, coluna: "cotacaoId" as const },
      { tipo: "pedido_contato" as const, id: (await pedido("+1 650 555 1234")).id, coluna: "pedidoContatoId" as const },
      { tipo: "cadastro_marketplace" as const, id: (await cadastro("+1 650 555 1234")).id, coluna: "cadastroMarketplaceId" as const },
      { tipo: "proprietario" as const, id: (await proprietario("Ana Fictícia")).id, coluna: "proprietarioId" as const },
    ];
    const id = await conversa(["Olá"]);
    for (const a of alvos) {
      expect(await confirmarVinculo(db, admin, { contatoId: id, tipo: a.tipo, alvoId: a.id }, AGORA)).toBe("vinculada");
      const l = await linhaDa(id);
      expect(l[a.coluna]).toBe(a.id);
      expect([l.reservaId, l.cotacaoId, l.pedidoContatoId, l.cadastroMarketplaceId, l.proprietarioId].filter(Boolean)).toEqual([a.id]);
      expect(await desfazerVinculo(db, admin, id, AGORA)).toBe("desfeito");
    }
  });

  it("vincularPorCodigo: inválido, inexistente e de outra organização; minúsculas com espaços; a cotação que virou reserva vincula à reserva; a solta, à cotação", async () => {
    const r = await reserva({ codigo: "SCL-ABC234" });
    const daCotacao = await reserva({ codigo: "SCL-DEF567" });
    await cotacao({ codigo: "COT-7K3M9QX2", reservaId: daCotacao.id });
    const solta = await cotacao({ codigo: "COT-ABCDEFGH" });
    await reserva({ codigo: "SCL-KMN234", organizacaoId: outra });
    const a = await conversa(["Olá"]);
    const b = await conversa(["Olá"], { waId: CANARIOS.waIdEstrangeiro });
    const c = await conversa(["Olá"], { waId: FICTICIOS.cliente });

    for (const codigo of ["SCL-ABC123", "abc", "", "SCL-ABC2345", "COT-7K3M9QX", "COT 7K3M9QX2"]) expect(await vincularPorCodigo(db, admin, { contatoId: a, codigo }, AGORA)).toBe("codigo_invalido");
    expect(await vincularPorCodigo(db, admin, { contatoId: a, codigo: 42 as unknown as string }, AGORA)).toBe("codigo_invalido");
    expect(await vincularPorCodigo(db, admin, { contatoId: a, codigo: "SCL-QRS234" }, AGORA)).toBe("codigo_nao_encontrado");
    expect(await vincularPorCodigo(db, admin, { contatoId: a, codigo: "SCL-KMN234" }, AGORA)).toBe("codigo_nao_encontrado");
    expect(await vincularPorCodigo(db, admin, { contatoId: a, codigo: "COT-HJKMNPQR" }, AGORA)).toBe("codigo_nao_encontrado");
    expect(await vincularPorCodigo(db, admin, { contatoId: crypto.randomUUID(), codigo: "SCL-ABC234" }, AGORA)).toBe("conversa_nao_encontrada");
    expect((await linhaDa(a)).vinculoConfirmadoEm).toBeNull();

    expect(await vincularPorCodigo(db, admin, { contatoId: a, codigo: "  scl-abc234 " }, AGORA)).toBe("vinculada");
    expect((await linhaDa(a)).reservaId).toBe(r.id);
    expect(await vincularPorCodigo(db, admin, { contatoId: a, codigo: "SCL-DEF567" }, AGORA)).toBe("ja_vinculada");
    expect(await vincularPorCodigo(db, admin, { contatoId: b, codigo: "cot-7k3m9qx2" }, AGORA)).toBe("vinculada");
    expect(await linhaDa(b)).toMatchObject({ reservaId: daCotacao.id, cotacaoId: null });
    expect(await vincularPorCodigo(db, admin, { contatoId: c, codigo: "COT-ABCDEFGH" }, AGORA)).toBe("vinculada");
    expect(await linhaDa(c)).toMatchObject({ reservaId: null, cotacaoId: solta.id, vinculoConfirmadoPor: admin.usuarioId });
  });

  it("desfazerVinculo zera as colunas; sem vínculo → sem_vinculo; a auditoria leva só tipo:id, na entidade whatsapp_conversa, sem canário e nunca na entidade reserva", async () => {
    const r = await reserva({ codigo: "SCL-ABC234", telefone: CANARIOS.telefoneFormatado });
    const id = await conversa([`${CANARIOS.texto} SCL-ABC234`]);
    expect(await desfazerVinculo(db, admin, id, AGORA)).toBe("sem_vinculo");
    expect(await confirmarVinculo(db, admin, { contatoId: id, tipo: "reserva", alvoId: r.id }, AGORA)).toBe("vinculada");
    expect(await desfazerVinculo(db, admin, id, AGORA)).toBe("desfeito");
    const l = await linhaDa(id);
    expect([l.reservaId, l.cotacaoId, l.pedidoContatoId, l.cadastroMarketplaceId, l.proprietarioId, l.vinculoConfirmadoPor, l.vinculoConfirmadoEm]).toEqual([null, null, null, null, null, null, null]);
    expect(await desfazerVinculo(db, admin, id, AGORA)).toBe("sem_vinculo");
    expect(await desfazerVinculo(db, admin, crypto.randomUUID(), AGORA)).toBe("conversa_nao_encontrada");

    const linhas = (await daAuditoria()).filter((x) => x.acao.startsWith("whatsapp.conversa"));
    expect(linhas.map((x) => [x.acao, x.entidade, x.entidadeId, x.usuarioId, x.mudancas])).toEqual([
      ["whatsapp.conversa.vincular", "whatsapp_conversa", id, admin.usuarioId, { vinculo: [null, `reserva:${r.id}`] }],
      ["whatsapp.conversa.desvincular", "whatsapp_conversa", id, admin.usuarioId, { vinculo: [`reserva:${r.id}`, null] }],
    ]);
    expect((await db.select().from(auditoria).where(eq(auditoria.entidade, "reserva"))).length).toBe(0);
    const texto = JSON.stringify(linhas);
    for (const v of Object.values(CANARIOS)) expect(texto).not.toContain(v);
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([]);
  });

  it("foto das linhas: confirmar e desfazer não mudam reservas, cotações, proprietários, representantes, pedidos, cadastros nem a equipe de limpeza", async () => {
    const TEL = "+1 650 555 1234";
    const r = await reserva({ codigo: "SCL-ABC234", telefone: TEL });
    const cot = await cotacao({ codigo: "COT-ABCDEFGH" });
    const dona = await proprietario("Ana Fictícia", TEL);
    await db.insert(representantes).values({ proprietarioId: dona.id, nome: "Representante Fictício", telefone: TEL });
    const p = await pedido(TEL);
    const k = await cadastro(TEL);
    await db.insert(profissionaisLimpeza).values({ organizacaoId: org, nome: "Profissional Fictícia", telefone: TEL });
    const id = await conversa(["SCL-ABC234"], { waId: FICTICIOS.cliente });
    const tabelas = [reservas, cotacoes, proprietarios, representantes, pedidosContatoProprietario, cadastrosMarketplace, profissionaisLimpeza] as const;
    const foto = async () => JSON.stringify(await Promise.all(tabelas.map((t) => db.select().from(t).orderBy(asc(t.id)))));
    const antes = await foto();

    for (const [tipo, alvoId] of [["reserva", r.id], ["cotacao", cot.id], ["pedido_contato", p.id], ["cadastro_marketplace", k.id], ["proprietario", dona.id]] as const) {
      expect(await confirmarVinculo(db, admin, { contatoId: id, tipo, alvoId }, AGORA)).toBe("vinculada");
      expect(await foto()).toBe(antes);
      expect(await desfazerVinculo(db, admin, id, AGORA)).toBe("desfeito");
      expect(await foto()).toBe(antes);
    }
    expect(await vincularPorCodigo(db, admin, { contatoId: id, codigo: "SCL-ABC234" }, AGORA)).toBe("vinculada");
    expect(await foto()).toBe(antes);
    expect(JSON.stringify((await db.select().from(reservas).where(eq(reservas.id, r.id)))[0])).not.toContain(CANARIOS.nomePerfil);
  });
});

// ---------------------------------------------------------------- acesso

describe("acesso (M10.1a)", () => {
  it("operação com o padrão só o admin, proprietário e limpeza: AcessoNegado em todas as funções do vínculo, sem gravar nada", async () => {
    const r = await reserva({ codigo: "SCL-ABC234" });
    const r2 = await reserva({ codigo: "SCL-DEF567" });
    const id = await conversa(["SCL-ABC234"]);
    const outro = await conversa(["Olá"], { waId: CANARIOS.waIdEstrangeiro });
    expect(await confirmarVinculo(db, admin, { contatoId: id, tipo: "reserva", alvoId: r.id }, AGORA)).toBe("vinculada");
    const antes = JSON.stringify([await db.select().from(whatsappContatos).orderBy(asc(whatsappContatos.id)), await daAuditoria()]);

    for (const s of [operacao, dono, limpeza]) {
      await expect(candidatosDaConversa(db, s, id, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
      await expect(confirmarVinculo(db, s, { contatoId: outro, tipo: "reserva", alvoId: r2.id }, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
      await expect(vincularPorCodigo(db, s, { contatoId: outro, codigo: "SCL-DEF567" }, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
      await expect(desfazerVinculo(db, s, id, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
      await expect(vinculosNaTela(db, s, [{ tipo: "reserva", id: r.id }])).rejects.toBeInstanceOf(AcessoNegado);
      await expect(conversasQueSugeremAReserva(db, s, [outro], r2.id, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    }
    expect(JSON.stringify([await db.select().from(whatsappContatos).orderBy(asc(whatsappContatos.id)), await daAuditoria()])).toBe(antes);
  });

  it("com a configuração liberada, a operação confirma e desfaz reserva e cotação, mas não proprietário, pedido ou cadastro, nem desfaz o vínculo do admin a um proprietário", async () => {
    expect(await salvarQuemVeConversas(db, admin, "admin_e_operacao")).toBe("salvo");
    const r = await reserva();
    const cot = await cotacao({ codigo: "COT-ABCDEFGH" });
    const dona = await proprietario("Ana Fictícia");
    const p = await pedido("+1 650 555 1234");
    const k = await cadastro("+1 650 555 1234");
    const id = await conversa(["Olá"]);

    expect(await confirmarVinculo(db, operacao, { contatoId: id, tipo: "reserva", alvoId: r.id }, AGORA)).toBe("vinculada");
    expect((await linhaDa(id)).vinculoConfirmadoPor).toBe(operacao.usuarioId);
    expect(await desfazerVinculo(db, operacao, id, AGORA)).toBe("desfeito");
    expect(await vincularPorCodigo(db, operacao, { contatoId: id, codigo: "COT-ABCDEFGH" }, AGORA)).toBe("vinculada");
    expect((await linhaDa(id)).cotacaoId).toBe(cot.id);
    expect(await desfazerVinculo(db, operacao, id, AGORA)).toBe("desfeito");
    for (const [tipo, alvoId] of [["proprietario", dona.id], ["pedido_contato", p.id], ["cadastro_marketplace", k.id]] as const) {
      await expect(confirmarVinculo(db, operacao, { contatoId: id, tipo, alvoId }, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    }
    expect((await linhaDa(id)).vinculoConfirmadoEm).toBeNull();

    expect(await confirmarVinculo(db, admin, { contatoId: id, tipo: "proprietario", alvoId: dona.id }, AGORA)).toBe("vinculada");
    await expect(desfazerVinculo(db, operacao, id, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    expect((await linhaDa(id)).proprietarioId).toBe(dona.id);
    expect((await vinculosNaTela(db, operacao, [{ tipo: "proprietario", id: dona.id }])).get(`proprietario:${dona.id}`)).toEqual({ tipo: "proprietario", rotulo: "um proprietário", selo: "Proprietário", link: null, podeDesfazer: false });
    expect((await vinculosNaTela(db, admin, [{ tipo: "proprietario", id: dona.id }])).get(`proprietario:${dona.id}`)).toEqual({ tipo: "proprietario", rotulo: "Proprietário Ana Fictícia", selo: "Proprietário", link: `/painel/proprietarios/${dona.id}`, podeDesfazer: true });
  });
});

// ---------------------------------------------------------------- erro de banco sem dado pessoal

describe("erro de banco sem dado pessoal (M10.1a, correção 1 da revisão do plano)", () => {
  /** Um banco que falha como a drizzle-orm falha: a mensagem traz os parâmetros da consulta (aqui, os canários). */
  const quebrado = (erro: () => Error) => new Proxy({}, { get: () => () => { throw erro(); } }) as unknown as Db;
  const comCanarios = () => new Error(`Failed query: select … params: ${CANARIOS.waIdBr},${CANARIOS.texto}`, { cause: new Error(`params: ${CANARIOS.bsuid} ${CANARIOS.wamid}`) });
  /** A mensagem, a pilha e as de toda a cadeia de causas. */
  const textosDoErro = (e: unknown): string => {
    const partes: string[] = [];
    for (let x: unknown = e, i = 0; x instanceof Error && i < 10; x = x.cause, i++) partes.push(x.message, x.stack ?? "", x.name);
    return partes.join("\n");
  };
  const ID = crypto.randomUUID();

  it("candidatosDaConversa, conversasDaReserva, vincularPorCodigo e as outras lançam um erro sem nenhum canário na mensagem, na pilha e nas causas", async () => {
    const db = quebrado(comCanarios);
    const chamadas: [string, () => Promise<unknown>][] = [
      ["candidatosDaConversa", () => candidatosDaConversa(db, admin, ID, AGORA)],
      ["conversasDaReserva", () => conversasDaReserva(db, admin, ID, AGORA)],
      ["vincularPorCodigo", () => vincularPorCodigo(db, admin, { contatoId: ID, codigo: "SCL-ABC234" }, AGORA)],
      ["confirmarVinculo", () => confirmarVinculo(db, admin, { contatoId: ID, tipo: "reserva", alvoId: ID }, AGORA)],
      ["desfazerVinculo", () => desfazerVinculo(db, admin, ID, AGORA)],
      ["vinculosNaTela", () => vinculosNaTela(db, admin, [{ tipo: "reserva", id: ID }])],
      ["conversasQueSugeremAReserva", () => conversasQueSugeremAReserva(db, admin, [ID], ID, AGORA)],
    ];
    for (const [nome, chamar] of chamadas) {
      const erro = await chamar().then(() => null, (e: unknown) => e);
      expect(erro, nome).toBeInstanceOf(Error);
      expect(erro, nome).not.toBeInstanceOf(AcessoNegado);
      expect((erro as Error).message, nome).toBe(MENSAGEM_OMITIDA);
      const texto = textosDoErro(erro);
      for (const v of Object.values(CANARIOS)) expect(texto, `${nome}: ${v}`).not.toContain(v);
      expect(texto, nome).not.toContain("params");
    }
  });

  it("AcessoNegado continua sendo AcessoNegado (do banco ou da checagem)", async () => {
    const nega = quebrado(() => new AcessoNegado("OUTRA_ORGANIZACAO"));
    const erro = await candidatosDaConversa(nega, admin, ID, AGORA).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(AcessoNegado);
    expect((erro as AcessoNegado).motivo).toBe("OUTRA_ORGANIZACAO");
    await expect(vincularPorCodigo(quebrado(comCanarios), dono, { contatoId: ID, codigo: "SCL-ABC234" }, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
  });
});
