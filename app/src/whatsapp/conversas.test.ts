/**
 * Consultas das conversas do WhatsApp (M10.1a, desenho 5.6; cenários de 8-F, conversas): filtros, paginação, ordem,
 * prévia de cada tipo, "não lida" e "lida", a conversa inteira, o bloco da ficha da reserva, a contagem do Início, o
 * acesso negado sem consulta, o vínculo visto por quem não lê o alvo e o erro de banco sem dado pessoal. As conversas
 * nascem de avisos fictícios pela leitura e pela gravação, como na rota (`entregarAviso`). PGlite, sem rede.
 */
import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import * as schema from "@/db/schema";
import { cadastrosMarketplace, cotacoes, imoveis, type Papel, pedidosContatoProprietario, proprietarios, reservas, usuarios, whatsappContatos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { MENSAGEM_OMITIDA } from "@/observabilidade/erro-de-rotina";
import { gerarCodigo } from "@/reservas/regras";
import { salvarQuemVeConversas } from "./configuracao";
import {
  CONVERSAS_POR_PAGINA,
  conteudoDaMensagem,
  contarConversasSemResposta,
  conversasDaReserva,
  LIMITE_PREVIA,
  listarConversas,
  marcarComoLida,
  MENSAGENS_NA_CONVERSA,
  nomeDaConversa,
  obterConversa,
  previaDaMensagem,
  ROTULO_TIPO,
} from "./conversas";
import { TIPOS_MENSAGEM } from "./regras";
import {
  avisoDeEcos,
  avisoDeHistorico,
  avisoDeMensagens,
  CANARIOS,
  contatoDoAviso,
  conversaDoHistorico,
  ecoDoAviso,
  entregarAviso,
  FICTICIOS,
  HORA_DO_AVISO,
  itemDoAviso,
  organizacaoComWhatsapp,
  pedacoDoHistorico,
} from "./testes";
import { confirmarVinculo } from "./vinculo";

/** 17/10/2026, 15:00 em São Paulo (três horas depois da hora padrão dos avisos de teste). */
const AGORA = new Date("2026-10-17T18:00:00Z");
/** Minutos depois da hora padrão dos avisos. */
const min = (n: number) => new Date(HORA_DO_AVISO.getTime() + n * 60_000);

let db: Db, close: () => Promise<void>, org: string, im: string;
let admin: Sessao, operacao: Sessao, dono: Sessao, limpeza: Sessao;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());

const usuario = async (organizacaoId: string, papel: Papel, extra: Partial<Sessao> = {}): Promise<Sessao> => {
  const [u] = await db.insert(usuarios).values({ organizacaoId, email: `${papel}.${crypto.randomUUID().slice(0, 8)}@example.com`, nome: `Usuário ${papel} fictício`, papel }).returning();
  return { usuarioId: u.id, organizacaoId, papel, imovelIds: [], ...extra };
};

beforeEach(async () => {
  org = await organizacaoComWhatsapp(db);
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio Exemplo" }).returning();
  admin = await usuario(org, "admin");
  operacao = await usuario(org, "operacao");
  dono = await usuario(org, "proprietario", { imovelIds: [im] });
  limpeza = await usuario(org, "limpeza", { profissionalId: crypto.randomUUID() });
});

let wamids = 0;
const novoWamid = () => `wamid.TESTE.C${++wamids}`;
const entregar = (json: unknown) => entregarAviso(db, json, AGORA);

/** Uma mensagem do cliente em tempo real; devolve o id da conversa (achada pelo wa_id, ou pelo BSUID). */
async function recebida(em: Date, o: { waId?: string | null; bsuid?: string; nome?: string | null; texto?: string; id?: string; tipo?: string; conteudo?: unknown; waba?: string; numero?: string } = {}): Promise<string> {
  const waId = o.waId === undefined ? CANARIOS.waIdBr : o.waId;
  const id = o.id ?? novoWamid();
  await entregar(
    avisoDeMensagens({
      waba: o.waba,
      numero: o.numero,
      contatos: [contatoDoAviso({ waId, bsuid: o.bsuid, nome: o.nome })],
      mensagens: [itemDoAviso({ id, de: waId, deUsuario: o.bsuid, em, tipo: o.tipo, conteudo: o.conteudo ?? (o.tipo ? undefined : { body: o.texto ?? CANARIOS.texto }) })],
    }),
  );
  // Aviso de outra conta: a conversa é da outra organização, e o teste não precisa dela.
  if (o.waba) return "";
  const [c] = await db
    .select()
    .from(whatsappContatos)
    .where(and(eq(whatsappContatos.organizacaoId, org), waId ? eq(whatsappContatos.waId, waId) : eq(whatsappContatos.bsuid, o.bsuid ?? "")));
  return c.id;
}
/** A resposta pelo celular (eco) a um wa_id. */
const respondida = (em: Date, waId: string = CANARIOS.waIdBr, texto = "Resposta fictícia pelo celular") => entregar(avisoDeEcos({ ecos: [ecoDoAviso({ id: novoWamid(), para: waId, em, conteudo: { body: texto } })] }));

async function reserva(o: { codigo?: string; telefone?: string } = {}) {
  const [r] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: o.codigo ?? gerarCodigo(), origem: "direta", checkin: "2026-12-20", checkout: "2026-12-27", hospedeNome: "Hóspede Fictício", hospedeTelefone: o.telefone ?? "" }).returning();
  return r;
}

/** Um db que registra o SQL de cada consulta (prova de que uma tabela não foi consultada). */
function registrado(): { db: Db; consultas: string[] } {
  const consultas: string[] = [];
  const comLog = drizzle((db as unknown as { $client: PGlite }).$client, { schema, logger: { logQuery: (q) => void consultas.push(q) } }) as unknown as Db;
  return { db: comLog, consultas };
}
/** Um banco que não pode ser consultado: qualquer uso derruba o teste. */
const semConsulta = new Proxy({}, { get: (_, p) => { throw new Error(`consultou o banco (${String(p)})`); } }) as unknown as Db;
const TABELAS_DO_WHATSAPP = /whatsapp_(contatos|mensagens)/;

// ---------------------------------------------------------------- prévia (pura)

describe("prévia e conteúdo das mensagens (M10.1a)", () => {
  it("cada tipo com o rótulo exato; a legenda aparece depois do rótulo; apagada vira 'Mensagem apagada'; tipo torto vale 'outro'", () => {
    const semTexto = (tipo: (typeof TIPOS_MENSAGEM)[number]) => previaDaMensagem({ tipo, texto: "", apagadaEm: null });
    expect(Object.fromEntries(TIPOS_MENSAGEM.map((t) => [t, semTexto(t)]))).toEqual({
      texto: "Mensagem de texto",
      imagem: "Foto — ver no celular",
      audio: "Áudio — ver no celular",
      video: "Vídeo — ver no celular",
      documento: "Documento — ver no celular",
      figurinha: "Figurinha — ver no celular",
      localizacao: "Localização — ver no celular",
      contato: "Contato compartilhado — ver no celular",
      nao_suportada: "Mensagem que o sistema não consegue mostrar — ver no celular",
      sistema: "Aviso do WhatsApp: o contato mudou de número ou de identificação",
      outro: "Mensagem de um tipo que o sistema não mostra — ver no celular",
      pendente: "Mensagem ainda não recebida pelo sistema — ver no celular",
      midia_pendente: "Anexo ainda não recebido — ver no celular",
    });
    expect(previaDaMensagem({ tipo: "texto", texto: "Bom dia!", apagadaEm: null })).toBe("Bom dia!");
    expect(previaDaMensagem({ tipo: "imagem", texto: "Vista fictícia", apagadaEm: null })).toBe("Foto — ver no celular: Vista fictícia");
    expect(previaDaMensagem({ tipo: "texto", texto: "", apagadaEm: AGORA })).toBe("Mensagem apagada");
    expect(previaDaMensagem({ tipo: "imagem", texto: "", apagadaEm: AGORA })).toBe("Mensagem apagada");
    expect(previaDaMensagem({ tipo: "tipo-torto" as never, texto: "", apagadaEm: null })).toBe(ROTULO_TIPO.outro);
  });

  it("a prévia tem até 80 caracteres, numa linha só, sem partir um emoji; o conteúdo da conversa sai inteiro", () => {
    const longo = `${"Linha um\ncom quebra ".repeat(6)}fim`;
    const p = previaDaMensagem({ tipo: "texto", texto: longo, apagadaEm: null });
    expect(Array.from(p)).toHaveLength(LIMITE_PREVIA);
    expect(p.endsWith("…")).toBe(true);
    expect(p).not.toContain("\n");
    expect(conteudoDaMensagem({ tipo: "texto", texto: longo, apagadaEm: null })).toBe(longo);
    const emojis = "😀".repeat(100);
    expect(previaDaMensagem({ tipo: "texto", texto: emojis, apagadaEm: null })).toBe(`${"😀".repeat(LIMITE_PREVIA - 1)}…`);
    expect(previaDaMensagem({ tipo: "texto", texto: "a".repeat(LIMITE_PREVIA), apagadaEm: null })).toBe("a".repeat(LIMITE_PREVIA));
  });

  it("o nome da conversa: o da agenda, senão o do perfil, senão 'Contato sem nome'", () => {
    expect(nomeDaConversa({ nomeAgenda: "Agenda", nomePerfil: "Perfil" })).toBe("Agenda");
    expect(nomeDaConversa({ nomeAgenda: "", nomePerfil: "Perfil" })).toBe("Perfil");
    expect(nomeDaConversa({ nomeAgenda: "", nomePerfil: "" })).toBe("Contato sem nome");
  });
});

// ---------------------------------------------------------------- lista

describe("caixa de entrada: filtros, ordem e paginação (M10.1a)", () => {
  it("filtros todas, sem resposta e sem vínculo; ordem pela última mensagem; outra organização não aparece; filtro torto vale 'todas'", async () => {
    const outra = await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba, numeroId: FICTICIOS.outroNumero }, { manterOutras: true });
    const a = await recebida(min(10), { nome: "Hóspede A Fictício", texto: "Mensagem A" });
    const b = await recebida(min(5), { waId: CANARIOS.waIdEstrangeiro, nome: "Hóspede B Fictício" });
    await respondida(min(6), CANARIOS.waIdEstrangeiro);
    const c = await recebida(min(20), { waId: FICTICIOS.cliente, nome: "Hóspede C Fictício" });
    await recebida(min(30), { waba: FICTICIOS.outraWaba, numero: FICTICIOS.outroNumero, waId: "1234567" });
    expect((await db.select().from(whatsappContatos).where(eq(whatsappContatos.organizacaoId, outra))).length).toBe(1);
    const r = await reserva({ codigo: "SCL-ABC234" });
    expect(await confirmarVinculo(db, admin, { contatoId: c, tipo: "reserva", alvoId: r.id }, AGORA)).toBe("vinculada");

    const todas = await listarConversas(db, admin, { filtro: "todas", pagina: 1 });
    expect(todas).toMatchObject({ total: 3, pagina: 1, paginas: 1 });
    expect(todas.itens.map((i) => i.id)).toEqual([c, a, b]);
    expect(todas.itens[1]).toEqual({ id: a, nome: "Hóspede A Fictício", telefone: "+55 21 99999-0000", ultimaMensagemEm: min(10), previa: "Mensagem A", naoLida: true, semResposta: true, vinculo: null, conflitoIdentidade: false });
    expect(todas.itens[2]).toMatchObject({ id: b, telefone: "+16505550199", previa: "Resposta fictícia pelo celular", naoLida: false, semResposta: false });
    expect(todas.itens[0].vinculo).toEqual({ tipo: "reserva", selo: "Reserva SCL-ABC234", rotulo: "Reserva SCL-ABC234 · Studio Exemplo · 20/12/2026 a 27/12/2026 · Hóspede Fictício", link: `/painel/reservas/${r.id}`, podeDesfazer: true });

    expect((await listarConversas(db, admin, { filtro: "sem_resposta", pagina: 1 })).itens.map((i) => i.id)).toEqual([c, a]);
    expect((await listarConversas(db, admin, { filtro: "sem_vinculo", pagina: 1 })).itens.map((i) => i.id)).toEqual([a, b]);
    expect((await listarConversas(db, admin, { filtro: "torto" as never, pagina: 1 })).itens.map((i) => i.id)).toEqual([c, a, b]);
  });

  it("sem conversa: lista vazia, uma página", async () => {
    expect(await listarConversas(db, admin, { filtro: "todas", pagina: 1 })).toEqual({ itens: [], total: 0, pagina: 1, paginas: 1 });
  });

  it("50 por página, mais recente primeiro; página fora do intervalo vale a mais próxima", async () => {
    const n = CONVERSAS_POR_PAGINA + 5;
    const waIds = Array.from({ length: n }, (_, i) => String(1_000_000 + i));
    await entregar(
      avisoDeMensagens({
        contatos: waIds.map((w) => contatoDoAviso({ waId: w, nome: `Hóspede ${w}` })),
        mensagens: waIds.map((w, i) => itemDoAviso({ id: novoWamid(), de: w, em: min(i), conteudo: { body: `Olá ${i}` } })),
      }),
    );
    const p1 = await listarConversas(db, admin, { filtro: "todas", pagina: 1 });
    expect(p1).toMatchObject({ total: n, pagina: 1, paginas: 2 });
    expect(p1.itens).toHaveLength(CONVERSAS_POR_PAGINA);
    expect(p1.itens[0]).toMatchObject({ nome: `Hóspede ${waIds[n - 1]}`, previa: `Olá ${n - 1}` });
    const p2 = await listarConversas(db, admin, { filtro: "todas", pagina: 2 });
    expect(p2.itens.map((i) => i.previa)).toEqual(["Olá 4", "Olá 3", "Olá 2", "Olá 1", "Olá 0"]);
    expect(new Set([...p1.itens, ...p2.itens].map((i) => i.id)).size).toBe(n);
    expect((await listarConversas(db, admin, { filtro: "todas", pagina: 3 })).pagina).toBe(2);
    expect((await listarConversas(db, admin, { filtro: "todas", pagina: 0 })).pagina).toBe(1);
    expect((await listarConversas(db, admin, { filtro: "todas", pagina: Number.NaN })).pagina).toBe(1);
  });

  it("a prévia é da última mensagem, com o rótulo do anexo e a legenda", async () => {
    await recebida(min(0), { texto: "Primeira" });
    await recebida(min(1), { tipo: "image", conteudo: { mime_type: "image/jpeg", caption: "Vista fictícia" } });
    expect((await listarConversas(db, admin, { filtro: "todas", pagina: 1 })).itens[0].previa).toBe("Foto — ver no celular: Vista fictícia");
  });
});

// ---------------------------------------------------------------- lida e não lida

describe("não lida e marcar como lida (M10.1a)", () => {
  const naoLida = async (id: string) => (await obterConversa(db, admin, id))?.naoLida;
  const lidaAte = async (id: string) => (await db.select().from(whatsappContatos).where(eq(whatsappContatos.id, id)))[0].lidaAte;

  it("antes e depois de marcarComoLida; a resposta pelo celular também lê; nunca passa de agora nem volta para trás", async () => {
    const id = await recebida(min(0));
    expect(await naoLida(id)).toBe(true);
    expect(await marcarComoLida(db, admin, id, min(0), min(30))).toBe(true);
    expect(await lidaAte(id)).toEqual(min(0));
    expect(await naoLida(id)).toBe(false);

    await recebida(min(5));
    expect(await naoLida(id)).toBe(true);
    // Pedir "lida até" depois de agora: fica em agora.
    expect(await marcarComoLida(db, admin, id, min(100), min(40))).toBe(true);
    expect(await lidaAte(id)).toEqual(min(40));
    expect(await naoLida(id)).toBe(false);
    // Para trás: não volta.
    expect(await marcarComoLida(db, admin, id, min(1), min(50))).toBe(true);
    expect(await lidaAte(id)).toEqual(min(40));

    await recebida(min(45));
    expect(await naoLida(id)).toBe(true);
    await respondida(min(46));
    expect(await naoLida(id)).toBe(false);
    expect((await obterConversa(db, admin, id))?.semResposta).toBe(false);
  });

  it("conversa de outra organização, id malformado ou data inválida: falso, sem mudar nada", async () => {
    const id = await recebida(min(0));
    expect(await marcarComoLida(db, admin, crypto.randomUUID(), min(0), AGORA)).toBe(false);
    expect(await marcarComoLida(db, admin, "nao-e-um-id", min(0), AGORA)).toBe(false);
    expect(await marcarComoLida(db, admin, id, new Date(Number.NaN), AGORA)).toBe(false);
    const outra = await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba, numeroId: FICTICIOS.outroNumero }, { manterOutras: true });
    const adminOutra = await usuario(outra, "admin");
    expect(await marcarComoLida(db, adminOutra, id, min(0), AGORA)).toBe(false);
    expect(await lidaAte(id)).toBeNull();
  });
});

// ---------------------------------------------------------------- conversa

describe("a conversa (M10.1a)", () => {
  it("mensagens em ordem de envio, com direção, origem, edição, apagamento e reação; outra organização ou id malformado → null", async () => {
    const original = novoWamid();
    const eco = novoWamid();
    const foto = novoWamid();
    await entregar(avisoDeHistorico({ pedacos: [pedacoDoHistorico({ conversas: [conversaDoHistorico({ mensagens: [itemDoAviso({ id: novoWamid(), em: min(-60), conteudo: { body: "Do histórico" } })] })] })] }));
    const id = await recebida(min(0), { id: original, texto: "Texto original" });
    await entregar(avisoDeEcos({ ecos: [ecoDoAviso({ id: eco, em: min(1), conteudo: { body: "Resposta pelo celular" } })] }));
    await recebida(min(2), { id: foto, tipo: "image", conteudo: { mime_type: "image/jpeg", caption: "Legenda fictícia" } });
    await recebida(min(3), { tipo: "edit", conteudo: { original_message_id: original, message: { type: "text", text: { body: "Texto editado" } } } });
    await recebida(min(4), { tipo: "revoke", conteudo: { original_message_id: foto } });
    await recebida(min(5), { tipo: "reaction", conteudo: { message_id: eco, emoji: "👍" } });

    const c = await obterConversa(db, admin, id);
    expect(c).toMatchObject({ id, nome: CANARIOS.nomePerfil, telefone: "+55 21 99999-0000", conflitoIdentidade: false, vinculo: null, maisMensagens: false, ultimaRecebidaEm: min(2) });
    expect(c?.mensagens.map((x) => [x.direcao, x.origem, x.tipo, x.conteudo, x.editadaEm, x.apagadaEm !== null, x.reacao])).toEqual([
      ["recebida", "historico", "texto", "Do histórico", null, false, null],
      ["recebida", "tempo_real", "texto", "Texto editado", min(3), false, null],
      ["enviada_celular", "tempo_real", "texto", "Resposta pelo celular", null, false, "👍"],
      ["recebida", "tempo_real", "imagem", "Mensagem apagada", null, true, null],
    ]);
    expect(await obterConversa(db, admin, "nao-e-um-id")).toBeNull();
    expect(await obterConversa(db, admin, crypto.randomUUID())).toBeNull();
    const outra = await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba, numeroId: FICTICIOS.outroNumero }, { manterOutras: true });
    expect(await obterConversa(db, await usuario(outra, "admin"), id)).toBeNull();
  });

  it("com mais de 200 mensagens, mostra as 200 mais recentes e avisa", async () => {
    const n = MENSAGENS_NA_CONVERSA + 5;
    await entregar(avisoDeMensagens({ mensagens: Array.from({ length: n }, (_, i) => itemDoAviso({ id: novoWamid(), em: min(i), conteudo: { body: `M${i}` } })) }));
    const [linha] = await db.select().from(whatsappContatos).where(eq(whatsappContatos.organizacaoId, org));
    const c = await obterConversa(db, admin, linha.id);
    expect(c?.mensagens).toHaveLength(MENSAGENS_NA_CONVERSA);
    expect(c?.mensagens[0].conteudo).toBe("M5");
    expect(c?.mensagens.at(-1)?.conteudo).toBe(`M${n - 1}`);
    expect(c?.maisMensagens).toBe(true);
  });

  it("contato só com BSUID: sem telefone", async () => {
    const id = await recebida(min(0), { waId: null, bsuid: CANARIOS.bsuid, nome: null });
    expect(await obterConversa(db, admin, id)).toMatchObject({ telefone: null, nome: "Contato sem nome" });
  });
});

// ---------------------------------------------------------------- ficha da reserva

describe("conversas da ficha da reserva (M10.1a)", () => {
  it("confirmadas (até 3, com as 3 últimas mensagens) e sugeridas, sem contar a já vinculada, a apagada nem a de outra organização", async () => {
    const TEL = "+1 650 555 1234";
    const r = await reserva({ codigo: "SCL-ABC234", telefone: TEL });
    const r2 = await reserva({ codigo: "SCL-DEF567" });
    await db.insert(cotacoes).values({ organizacaoId: org, imovelId: im, codigo: "COT-7K3M9QX2", reservaId: r.id, checkin: "2026-12-20", checkout: "2026-12-27", noites: 7, hospedes: 2, situacao: "disponivel", diarias: 1, limpeza: 0, hospedeExtra: 0, valorCheio: 1, total: 1 });

    // Confirmada: quatro mensagens, a ficha mostra as três últimas.
    const ligada = await recebida(min(0), { texto: "Primeira" });
    await recebida(min(1), { texto: "Segunda" });
    await respondida(min(2), CANARIOS.waIdBr, "Terceira");
    await recebida(min(3), { texto: "Quarta" });
    expect(await confirmarVinculo(db, admin, { contatoId: ligada, tipo: "reserva", alvoId: r.id }, AGORA)).toBe("vinculada");
    // Sugeridas: pelo código da reserva, pelo telefone do hóspede e pelo código da cotação que virou a reserva.
    await recebida(min(10), { waId: CANARIOS.waIdEstrangeiro, texto: "Sobre a scl-abc234" });
    await recebida(min(11), { waId: FICTICIOS.cliente, texto: "Olá" });
    await recebida(min(12), { waId: null, bsuid: CANARIOS.bsuid, texto: "Cotei COT-7K3M9QX2" });
    // Não contam: já vinculada a outra reserva, mensagem apagada, outra organização.
    const outraLigada = await recebida(min(13), { waId: "1234567", texto: "SCL-ABC234" });
    expect(await confirmarVinculo(db, admin, { contatoId: outraLigada, tipo: "reserva", alvoId: r2.id }, AGORA)).toBe("vinculada");
    const apagada = novoWamid();
    await recebida(min(14), { waId: "7654321", id: apagada, texto: "SCL-ABC234" });
    await recebida(min(15), { waId: "7654321", tipo: "revoke", conteudo: { original_message_id: apagada } });
    await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba, numeroId: FICTICIOS.outroNumero }, { manterOutras: true });
    await recebida(min(16), { waba: FICTICIOS.outraWaba, numero: FICTICIOS.outroNumero, waId: "2345678", texto: "SCL-ABC234" });

    const ficha = await conversasDaReserva(db, admin, r.id, AGORA);
    expect(ficha.sugeridas).toBe(3);
    expect(ficha.confirmadas).toEqual([
      {
        id: ligada,
        nome: CANARIOS.nomePerfil,
        ultimaMensagemEm: min(3),
        mensagens: [
          { id: expect.any(String), direcao: "recebida", previa: "Segunda", enviadaEm: min(1) },
          { id: expect.any(String), direcao: "enviada_celular", previa: "Terceira", enviadaEm: min(2) },
          { id: expect.any(String), direcao: "recebida", previa: "Quarta", enviadaEm: min(3) },
        ],
      },
    ]);

    // Mais três conversas confirmadas com a reserva, mais recentes: a ficha mostra só as três últimas, da mais
    // recente para a mais antiga, e a primeira sai.
    const maisRecentes: string[] = [];
    for (const [w, n] of [["3456789", 20], ["4567890", 21], ["5678901", 22]] as const) {
      const x = await recebida(min(n), { waId: w, texto: "Olá" });
      expect(await confirmarVinculo(db, admin, { contatoId: x, tipo: "reserva", alvoId: r.id }, AGORA)).toBe("vinculada");
      maisRecentes.push(x);
    }
    const cheia = await conversasDaReserva(db, admin, r.id, AGORA);
    expect(cheia.confirmadas.map((x) => [x.id, x.ultimaMensagemEm])).toEqual([
      [maisRecentes[2], min(22)],
      [maisRecentes[1], min(21)],
      [maisRecentes[0], min(20)],
    ]);
    expect(cheia.confirmadas.map((x) => x.id)).not.toContain(ligada);
    expect(cheia.sugeridas).toBe(3);
    expect(await conversasDaReserva(db, admin, r2.id, AGORA)).toMatchObject({ confirmadas: [{ id: outraLigada }], sugeridas: 0 });
    expect(await conversasDaReserva(db, admin, crypto.randomUUID(), AGORA)).toEqual({ confirmadas: [], sugeridas: 0 });
    expect(await conversasDaReserva(db, admin, "nao-e-um-id", AGORA)).toEqual({ confirmadas: [], sugeridas: 0 });
  });
});

// ---------------------------------------------------------------- Início

describe("contagem do Início (M10.1a)", () => {
  it("não conta outra organização; o eco resolve; a operação com o padrão só o admin recebe 0 sem consultar whatsapp_contatos; liberada, a mesma contagem do admin", async () => {
    await recebida(min(0));
    await recebida(min(1), { waId: CANARIOS.waIdEstrangeiro });
    await respondida(min(2), CANARIOS.waIdEstrangeiro);
    await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba, numeroId: FICTICIOS.outroNumero }, { manterOutras: true });
    await recebida(min(3), { waba: FICTICIOS.outraWaba, numero: FICTICIOS.outroNumero, waId: "1234567" });
    expect(await contarConversasSemResposta(db, admin)).toBe(1);
    await respondida(min(4));
    expect(await contarConversasSemResposta(db, admin)).toBe(0);
    await recebida(min(5));

    const { db: espiado, consultas } = registrado();
    expect(await contarConversasSemResposta(espiado, operacao)).toBe(0);
    // Controle: o espião registrou a leitura da configuração (quem vê as conversas).
    expect(consultas.length).toBeGreaterThan(0);
    expect(consultas.some((q) => TABELAS_DO_WHATSAPP.test(q))).toBe(false);
    expect(await contarConversasSemResposta(semConsulta, dono)).toBe(0);
    expect(await contarConversasSemResposta(semConsulta, limpeza)).toBe(0);

    expect(await salvarQuemVeConversas(db, admin, "admin_e_operacao")).toBe("salvo");
    expect(await contarConversasSemResposta(db, operacao)).toBe(1);
    expect(await contarConversasSemResposta(db, admin)).toBe(1);
  });
});

// ---------------------------------------------------------------- acesso

describe("acesso (M10.1a)", () => {
  it("operação com o padrão só o admin: AcessoNegado em todas as consultas, sem tocar as tabelas do WhatsApp", async () => {
    const id = await recebida(min(0));
    const r = await reserva();
    const { db: espiado, consultas } = registrado();
    await expect(listarConversas(espiado, operacao, { filtro: "todas", pagina: 1 })).rejects.toBeInstanceOf(AcessoNegado);
    await expect(obterConversa(espiado, operacao, id)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(conversasDaReserva(espiado, operacao, r.id, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    await expect(marcarComoLida(espiado, operacao, id, min(0), AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    expect(consultas.length).toBeGreaterThan(0);
    expect(consultas.some((q) => TABELAS_DO_WHATSAPP.test(q))).toBe(false);
    expect((await db.select().from(whatsappContatos).where(eq(whatsappContatos.id, id)))[0].lidaAte).toBeNull();
  });

  it.each([["proprietário", () => dono], ["limpeza", () => limpeza]])("%s: AcessoNegado sem nenhuma consulta, com qualquer configuração", async (_, sessao) => {
    for (const quem of ["so_admin", "admin_e_operacao"] as const) {
      if (quem === "admin_e_operacao") await salvarQuemVeConversas(db, admin, quem);
      const id = crypto.randomUUID();
      await expect(listarConversas(semConsulta, sessao(), { filtro: "todas", pagina: 1 })).rejects.toBeInstanceOf(AcessoNegado);
      await expect(obterConversa(semConsulta, sessao(), id)).rejects.toBeInstanceOf(AcessoNegado);
      await expect(conversasDaReserva(semConsulta, sessao(), id, AGORA)).rejects.toBeInstanceOf(AcessoNegado);
      await expect(marcarComoLida(semConsulta, sessao(), id, min(0), AGORA)).rejects.toBeInstanceOf(AcessoNegado);
    }
  });

  it("com 'admin e operação', a operação vê o vínculo do admin a um proprietário, a um pedido de contato e a um cadastro só pelo rótulo genérico, sem nome, sem link e sem 'Desfazer'", async () => {
    expect(await salvarQuemVeConversas(db, admin, "admin_e_operacao")).toBe("salvo");
    const [dona] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Ana Proprietária Fictícia" }).returning();
    const [pedido] = await db.insert(pedidosContatoProprietario).values({ organizacaoId: org, nome: "Interessado Fictício", email: "interessado@example.com", telefone: "+1 650 555 1234", bairro: "Leblon", cidade: "Rio de Janeiro" }).returning();
    const [cadastro] = await db
      .insert(cadastrosMarketplace)
      .values({ organizacaoId: org, email: "cadastro@example.com", nome: "Cadastro Fictício", telefone: "+1 650 555 1234", anuncio: "novo", imovel: { nome: "Apto", bairro: "Leblon", cidade: "Rio de Janeiro", endereco: "Rua Fictícia, 1", capacidade: 2, quartos: 1, banheiros: 1, descricao: "" } })
      .returning();
    const r = await reserva({ codigo: "SCL-ABC234" });
    const ids = {
      proprietario: await recebida(min(0)),
      pedido_contato: await recebida(min(1), { waId: CANARIOS.waIdEstrangeiro }),
      cadastro_marketplace: await recebida(min(2), { waId: FICTICIOS.cliente }),
      reserva: await recebida(min(3), { waId: "1234567" }),
    };
    expect(await confirmarVinculo(db, admin, { contatoId: ids.proprietario, tipo: "proprietario", alvoId: dona.id }, AGORA)).toBe("vinculada");
    expect(await confirmarVinculo(db, admin, { contatoId: ids.pedido_contato, tipo: "pedido_contato", alvoId: pedido.id }, AGORA)).toBe("vinculada");
    expect(await confirmarVinculo(db, admin, { contatoId: ids.cadastro_marketplace, tipo: "cadastro_marketplace", alvoId: cadastro.id }, AGORA)).toBe("vinculada");
    expect(await confirmarVinculo(db, admin, { contatoId: ids.reserva, tipo: "reserva", alvoId: r.id }, AGORA)).toBe("vinculada");

    const { db: espiado, consultas } = registrado();
    const vista = await obterConversa(espiado, operacao, ids.proprietario);
    expect(vista?.vinculo).toEqual({ tipo: "proprietario", rotulo: "um proprietário", selo: "Proprietário", link: null, podeDesfazer: false, confirmadoPor: "Usuário admin fictício", confirmadoEm: AGORA });
    const lista = await listarConversas(espiado, operacao, { filtro: "todas", pagina: 1 });
    const porId = new Map(lista.itens.map((i) => [i.id, i.vinculo]));
    expect(porId.get(ids.proprietario)).toEqual({ tipo: "proprietario", rotulo: "um proprietário", selo: "Proprietário", link: null, podeDesfazer: false });
    expect(porId.get(ids.pedido_contato)).toEqual({ tipo: "pedido_contato", rotulo: "um pedido de contato", selo: "Pedido de contato", link: null, podeDesfazer: false });
    expect(porId.get(ids.cadastro_marketplace)).toEqual({ tipo: "cadastro_marketplace", rotulo: "um cadastro pelo site", selo: "Cadastro pelo site", link: null, podeDesfazer: false });
    expect(porId.get(ids.reserva)).toMatchObject({ tipo: "reserva", selo: "Reserva SCL-ABC234", link: `/painel/reservas/${r.id}`, podeDesfazer: true });
    const texto = JSON.stringify([vista, lista]);
    for (const nome of ["Ana Proprietária Fictícia", "Interessado Fictício", "Cadastro Fictício", "/painel/proprietarios/"]) expect(texto).not.toContain(nome);
    // A operação nem consulta as tabelas que não lê (controle: o espião registrou as consultas da conversa e da lista).
    expect(consultas.some((q) => /"whatsapp_contatos"/.test(q))).toBe(true);
    expect(consultas.some((q) => /"(proprietarios|pedidos_contato_proprietario|cadastros_marketplace)"/.test(q))).toBe(false);

    const doAdmin = await obterConversa(db, admin, ids.proprietario);
    expect(doAdmin?.vinculo).toMatchObject({ rotulo: "Proprietário Ana Proprietária Fictícia", link: `/painel/proprietarios/${dona.id}`, podeDesfazer: true });
  });
});

// ---------------------------------------------------------------- erro de banco sem dado pessoal

describe("erro de banco sem dado pessoal (M10.1a, correção 1 da revisão do plano)", () => {
  const quebrado = new Proxy({}, {
    get: () => () => {
      throw new Error(`Failed query: select … params: ${CANARIOS.waIdBr},${CANARIOS.texto}`, { cause: new Error(`params: ${CANARIOS.nomePerfil}`) });
    },
  }) as unknown as Db;
  const textosDoErro = (e: unknown): string => {
    const partes: string[] = [];
    for (let x: unknown = e, i = 0; x instanceof Error && i < 10; x = x.cause, i++) partes.push(x.message, x.stack ?? "");
    return partes.join("\n");
  };
  const ID = crypto.randomUUID();

  it("listarConversas, obterConversa, conversasDaReserva, contarConversasSemResposta e marcarComoLida lançam sem nenhum canário", async () => {
    const chamadas: [string, () => Promise<unknown>][] = [
      ["listarConversas", () => listarConversas(quebrado, admin, { filtro: "todas", pagina: 1 })],
      ["obterConversa", () => obterConversa(quebrado, admin, ID)],
      ["conversasDaReserva", () => conversasDaReserva(quebrado, admin, ID, AGORA)],
      ["contarConversasSemResposta", () => contarConversasSemResposta(quebrado, admin)],
      ["marcarComoLida", () => marcarComoLida(quebrado, admin, ID, min(0), AGORA)],
    ];
    for (const [nome, chamar] of chamadas) {
      const erro = await chamar().then(() => null, (e: unknown) => e);
      expect(erro, nome).toBeInstanceOf(Error);
      expect(erro, nome).not.toBeInstanceOf(AcessoNegado);
      expect((erro as Error).message, nome).toBe(MENSAGEM_OMITIDA);
      const texto = textosDoErro(erro);
      for (const v of Object.values(CANARIOS)) expect(texto, `${nome}: ${v}`).not.toContain(v);
    }
  });
});
