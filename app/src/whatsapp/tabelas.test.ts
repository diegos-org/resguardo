/**
 * As cinco tabelas do M10.1a (migração 0073, desenho 1.2): os únicos e os CHECKs que o banco garante sozinho, e a
 * varredura `semDadosPessoaisWhatsapp`, que passa a cobrir os eventos, os contadores e a situação da conta (nunca as
 * conversas e as mensagens, que guardam o dado de propósito). PGlite, sem rede; só valores fictícios.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  auditoria,
  cadastrosMarketplace,
  cotacoes,
  execucoesAutomacao,
  imoveis,
  organizacoes,
  pedidosContatoProprietario,
  proprietarios,
  reservas,
  whatsappAvisosDia,
  whatsappConta,
  whatsappContatos,
  whatsappEventos,
  whatsappMensagens,
} from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { semDadosPessoais } from "@/pagamentos/testes";
import { LIMITE_WAMID } from "./regras";
import { CANARIOS, semDadosPessoaisWhatsapp } from "./testes";

let db: Db, close: () => Promise<void>, org: string, outra: string, im: string;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra Empresa Exemplo" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "T1", nome: "Imóvel fictício" }).returning();
});

/** O código do Postgres do erro (o drizzle embrulha o erro do PGlite). */
async function codigoDoErro(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    const c = e as { code?: string; cause?: { code?: string } };
    return c.code ?? c.cause?.code;
  }
}
const conversa = (o: Partial<typeof whatsappContatos.$inferInsert> = {}) => db.insert(whatsappContatos).values({ organizacaoId: org, waId: CANARIOS.waIdBr, ...o }).returning();
const mensagem = (contatoId: string, o: Partial<typeof whatsappMensagens.$inferInsert> = {}) =>
  db.insert(whatsappMensagens).values({ organizacaoId: org, contatoId, wamid: CANARIOS.wamid, direcao: "recebida", origem: "tempo_real", tipo: "texto", texto: "Olá", enviadaEm: new Date("2026-10-17T12:00:00Z"), ...o }).returning();

describe("tabelas do WhatsApp (migração 0073)", () => {
  it("wamid único por organização (outra organização pode repetir); on conflict não duplica, nem com dois inserts ao mesmo tempo", async () => {
    const [c] = await conversa();
    const [c2] = await conversa({ organizacaoId: outra });
    await mensagem(c.id);
    expect(await codigoDoErro(mensagem(c.id, { texto: "outra" }))).toBe("23505");
    await mensagem(c2.id, { organizacaoId: outra });
    const repetida = await db
      .insert(whatsappMensagens)
      .values({ organizacaoId: org, contatoId: c.id, wamid: CANARIOS.wamid, direcao: "enviada_celular", origem: "historico", tipo: "texto", enviadaEm: new Date() })
      .onConflictDoNothing()
      .returning();
    expect(repetida).toEqual([]);
    // Duas entregas do mesmo aviso ao mesmo tempo: uma linha só (a garantia é o índice único, não a ordem).
    const nova = () =>
      db.insert(whatsappMensagens).values({ organizacaoId: org, contatoId: c.id, wamid: "wamid.TESTE.PARALELO", direcao: "recebida", origem: "tempo_real", tipo: "texto", enviadaEm: new Date() }).onConflictDoNothing().returning();
    const [a, b] = await Promise.all([nova(), nova()]);
    expect(a.length + b.length).toBe(1);
    expect(await db.select().from(whatsappMensagens).where(eq(whatsappMensagens.organizacaoId, org))).toHaveLength(2);
    const [linha] = await db.select().from(whatsappMensagens).where(and(eq(whatsappMensagens.organizacaoId, org), eq(whatsappMensagens.wamid, CANARIOS.wamid)));
    expect(linha).toMatchObject({ direcao: "recebida", origem: "tempo_real", texto: "Olá", anexoMime: null, respostaA: null, editadaEm: null, apagadaEm: null, reacao: null, situacao: null });
  });

  it("wa_id e BSUID únicos por organização só quando preenchidos: dois nulos convivem e outra organização pode repetir", async () => {
    await conversa();
    expect(await codigoDoErro(conversa())).toBe("23505");
    await conversa({ organizacaoId: outra });
    // Duas conversas só com BSUID (wa_id nulo) e duas só com wa_id (BSUID nulo) convivem.
    await conversa({ waId: null, bsuid: CANARIOS.bsuid });
    await conversa({ waId: null, bsuid: "BR.FicticioDois" });
    await conversa({ waId: CANARIOS.waIdEstrangeiro });
    expect(await codigoDoErro(conversa({ waId: null, bsuid: CANARIOS.bsuid }))).toBe("23505");
    // O mesmo BSUID com outro wa_id também esbarra no único do BSUID.
    expect(await codigoDoErro(conversa({ waId: "16505551234", bsuid: CANARIOS.bsuid }))).toBe("23505");
    await conversa({ organizacaoId: outra, waId: null, bsuid: CANARIOS.bsuid });
    // Sem alvo, on conflict do nothing cobre os dois únicos parciais.
    expect(await db.insert(whatsappContatos).values({ organizacaoId: org, waId: CANARIOS.waIdBr, bsuid: "BR.FicticioTres" }).onConflictDoNothing().returning()).toEqual([]);
    expect(await db.select().from(whatsappContatos).where(eq(whatsappContatos.organizacaoId, org))).toHaveLength(4);
    const [c] = await db.select().from(whatsappContatos).where(and(eq(whatsappContatos.organizacaoId, org), eq(whatsappContatos.waId, CANARIOS.waIdBr)));
    expect(c).toMatchObject({ bsuid: null, nomePerfil: "", nomeAgenda: "", conflitoIdentidade: false, reservaId: null, vinculoConfirmadoEm: null, lidaAte: null, ultimaMensagemEm: null });
  });

  it("conversa sem wa_id e sem BSUID é recusada; wa_id só com dígitos (6 a 20)", async () => {
    expect(await codigoDoErro(conversa({ waId: null, nomePerfil: "Sem identidade" }))).toBe("23514");
    expect(await codigoDoErro(conversa({ waId: "5521a99990000" }))).toBe("23514");
    expect(await codigoDoErro(conversa({ waId: CANARIOS.comMais }))).toBe("23514");
    expect(await codigoDoErro(conversa({ waId: "12345" }))).toBe("23514");
    expect(await codigoDoErro(conversa({ waId: "1".repeat(21) }))).toBe("23514");
    await conversa({ waId: "123456" });
    await conversa({ waId: CANARIOS.waIdBrSem9 });
  });

  it("no máximo um vínculo, e só confirmado: dois alvos, alvo sem data e data sem alvo são recusados", async () => {
    const [reserva] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-ABC234", origem: "site", fonte: "site", checkin: "2026-12-20", checkout: "2026-12-27", hospedes: 2 }).returning();
    const [cotacao] = await db
      .insert(cotacoes)
      .values({ organizacaoId: org, imovelId: im, codigo: "COT-7K3M9QX2", checkin: "2026-12-20", checkout: "2026-12-27", noites: 7, hospedes: 2, situacao: "disponivel", diarias: 1, limpeza: 0, hospedeExtra: 0, valorCheio: 1, total: 1 })
      .returning();
    const [proprietario] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Proprietário Fictício" }).returning();
    const [pedido] = await db.insert(pedidosContatoProprietario).values({ organizacaoId: org, nome: "Interessado Fictício", email: "interessado@example.com", telefone: "16505551234", bairro: "Leblon", cidade: "Rio de Janeiro" }).returning();
    const [cadastro] = await db
      .insert(cadastrosMarketplace)
      .values({ organizacaoId: org, email: "cadastro@example.com", nome: "Cadastro Fictício", telefone: "16505551234", anuncio: "novo", imovel: { nome: "Apto", bairro: "Leblon", cidade: "Rio de Janeiro", endereco: "Rua Fictícia, 1", capacidade: 2, quartos: 1, banheiros: 1, descricao: "" } })
      .returning();
    const agora = new Date("2026-10-17T12:00:00Z");
    const alvos = [{ reservaId: reserva.id }, { cotacaoId: cotacao.id }, { pedidoContatoId: pedido.id }, { cadastroMarketplaceId: cadastro.id }, { proprietarioId: proprietario.id }];
    // Cada alvo sozinho, confirmado, entra (cada conversa com o seu wa_id).
    for (const [i, alvo] of alvos.entries()) await conversa({ waId: `100000${i}`, ...alvo, vinculoConfirmadoEm: agora });
    expect(await codigoDoErro(conversa({ waId: "1000010", reservaId: reserva.id, cotacaoId: cotacao.id, vinculoConfirmadoEm: agora }))).toBe("23514");
    expect(await codigoDoErro(conversa({ waId: "1000011", proprietarioId: proprietario.id, pedidoContatoId: pedido.id, vinculoConfirmadoEm: agora }))).toBe("23514");
    expect(await codigoDoErro(conversa({ waId: "1000012", reservaId: reserva.id }))).toBe("23514");
    expect(await codigoDoErro(conversa({ waId: "1000013", vinculoConfirmadoEm: agora }))).toBe("23514");
    // Desfazer zera o alvo e a data juntos; zerar só um dos dois é recusado.
    const [c] = await db.select().from(whatsappContatos).where(eq(whatsappContatos.reservaId, reserva.id));
    expect(await codigoDoErro(db.update(whatsappContatos).set({ reservaId: null }).where(eq(whatsappContatos.id, c.id)))).toBe("23514");
    await db.update(whatsappContatos).set({ reservaId: null, vinculoConfirmadoEm: null, vinculoConfirmadoPor: null }).where(eq(whatsappContatos.id, c.id));
    // O alvo precisa existir (chave estrangeira).
    expect(await codigoDoErro(conversa({ waId: "1000014", reservaId: crypto.randomUUID(), vinculoConfirmadoEm: agora }))).toBe("23503");
  });

  it("mensagem apagada não tem texto; wamid de 1 a 256 caracteres", async () => {
    const [c] = await conversa();
    expect(await codigoDoErro(mensagem(c.id, { wamid: "wamid.TESTE.APAGADA", apagadaEm: new Date() }))).toBe("23514");
    await mensagem(c.id, { wamid: "wamid.TESTE.APAGADA", texto: "", apagadaEm: new Date() });
    expect(await codigoDoErro(db.update(whatsappMensagens).set({ texto: "volta" }).where(eq(whatsappMensagens.wamid, "wamid.TESTE.APAGADA")))).toBe("23514");
    expect(await codigoDoErro(mensagem(c.id, { wamid: "" }))).toBe("23514");
    // O limite do parser (LIMITE_WAMID) e o CHECK da 0073 andam juntos: subir um sem o outro faria o banco recusar um
    // wamid que o parser aceitou (a transação falharia e a Meta reenviaria o aviso por 7 dias).
    expect(await codigoDoErro(mensagem(c.id, { wamid: "w".repeat(LIMITE_WAMID + 1) }))).toBe("23514");
    await mensagem(c.id, { wamid: "w".repeat(LIMITE_WAMID) });
    // A mensagem precisa de uma conversa (chave estrangeira).
    expect(await codigoDoErro(mensagem(crypto.randomUUID(), { wamid: "wamid.TESTE.SEMCONVERSA" }))).toBe("23503");
  });

  it("situação da conta: uma linha por organização, com os padrões, e progresso do histórico de 0 a 100", async () => {
    const [linha] = await db.insert(whatsappConta).values({ organizacaoId: org }).returning();
    expect(linha).toMatchObject({ situacao: "nao_conectada", sincronizacaoContatos: "nao_pedida", sincronizacaoHistorico: "nao_pedida", progressoHistorico: null, contatosRecebidosEm: null, conectadoEm: null, motivo: null });
    expect(await codigoDoErro(db.insert(whatsappConta).values({ organizacaoId: org }))).toBe("23505");
    expect(await codigoDoErro(db.update(whatsappConta).set({ progressoHistorico: 101 }).where(eq(whatsappConta.organizacaoId, org)))).toBe("23514");
    expect(await codigoDoErro(db.update(whatsappConta).set({ progressoHistorico: -1 }).where(eq(whatsappConta.organizacaoId, org)))).toBe("23514");
    await db.update(whatsappConta).set({ progressoHistorico: 100 }).where(eq(whatsappConta.organizacaoId, org));
    await db.update(whatsappConta).set({ progressoHistorico: 0 }).where(eq(whatsappConta.organizacaoId, org));
  });

  it("chave do evento: vazia repete à vontade (blocos de mensagem), igual na mesma organização é recusada (account_update)", async () => {
    const evento = (o: Partial<typeof whatsappEventos.$inferInsert> = {}) => db.insert(whatsappEventos).values({ organizacaoId: org, campo: "messages", resultado: "gravado", ...o }).returning();
    await evento();
    await evento();
    const chave = "account_update:PARTNER_REMOVED:1:ACCOUNT_DISCONNECTED:-";
    const [e] = await evento({ campo: "account_update", tipo: "PARTNER_REMOVED", chave });
    expect(e).toMatchObject({ itens: 0, avisarPorEmail: false, emailAvisoEm: null, emailResultado: null, motivo: null, ocorridoEm: null });
    expect(await codigoDoErro(evento({ campo: "account_update", chave }))).toBe("23505");
    expect(await db.insert(whatsappEventos).values({ organizacaoId: org, campo: "account_update", chave, resultado: "gravado" }).onConflictDoNothing().returning()).toEqual([]);
    await evento({ organizacaoId: outra, campo: "account_update", chave });
    expect(await db.select().from(whatsappEventos).where(eq(whatsappEventos.organizacaoId, org))).toHaveLength(3);
  });

  it("os índices do desenho existem com os nomes da migração", async () => {
    const r = await db.execute(sql`select indexname from pg_indexes where tablename like 'whatsapp_%' order by indexname`);
    const nomes = (r as unknown as { rows: { indexname: string }[] }).rows.map((x) => x.indexname);
    expect(nomes).toEqual(
      expect.arrayContaining([
        "whatsapp_contatos_wa_id", "whatsapp_contatos_bsuid", "whatsapp_contatos_ultima", "whatsapp_contatos_reserva", "whatsapp_contatos_cotacao",
        "whatsapp_mensagens_wamid", "whatsapp_mensagens_contato", "whatsapp_eventos_chave", "whatsapp_eventos_recebido",
      ]),
    );
    // A lista ordena por ultima_mensagem_em desc nulls last: o índice na ordem inversa (asc) não serviria a ela.
    const r2 = await db.execute(sql`select indexdef from pg_indexes where indexname = 'whatsapp_contatos_ultima'`);
    expect((r2 as unknown as { rows: { indexdef: string }[] }).rows[0].indexdef).toContain("(organizacao_id, ultima_mensagem_em DESC NULLS LAST)");
  });

  it("semDadosPessoaisWhatsapp acha o canário plantado nos eventos, na situação da conta e numa auditoria whatsapp.*; depois de limpar, nada", async () => {
    // As conversas e as mensagens guardam o dado de propósito: ficam fora da varredura.
    const [c] = await conversa({ bsuid: CANARIOS.bsuid, nomePerfil: CANARIOS.nomePerfil, nomeAgenda: CANARIOS.nomeAgenda });
    await mensagem(c.id, { texto: CANARIOS.texto });
    await db.insert(whatsappEventos).values({ organizacaoId: org, campo: "messages", resultado: "gravado" });
    await db.insert(whatsappConta).values({ organizacaoId: org });
    await db.insert(whatsappAvisosDia).values({ dia: "2026-10-17", ignorados: 3, ultimoValidoEm: new Date() });
    await db.insert(auditoria).values({ organizacaoId: org, acao: "whatsapp.conversa.vincular", entidade: "whatsapp_conversa", entidadeId: c.id, mudancas: { vinculo: [null, `reserva:${crypto.randomUUID()}`] } });
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([]);

    await db.update(whatsappEventos).set({ chave: `account_update:${CANARIOS.waIdBr}` }).where(eq(whatsappEventos.organizacaoId, org));
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([CANARIOS.waIdBr]);
    await db.update(whatsappConta).set({ motivo: CANARIOS.wamid as never }).where(eq(whatsappConta.organizacaoId, org));
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([CANARIOS.waIdBr, CANARIOS.wamid]);
    await db.insert(auditoria).values({ organizacaoId: org, acao: "whatsapp.conta.situacao", entidade: "whatsapp_conta", entidadeId: org, mudancas: { situacao: ["conectada", CANARIOS.nomePerfil] } });
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([CANARIOS.waIdBr, CANARIOS.wamid, CANARIOS.nomePerfil]);
    // Os contadores do dia só têm números e datas: o marcador é um número (nenhum CANARIO cabe numa coluna inteira).
    expect(await semDadosPessoais(db, ["987654321"])).toEqual([]);
    await db.update(whatsappAvisosDia).set({ desconhecidos: 987654321 }).where(eq(whatsappAvisosDia.dia, "2026-10-17"));
    expect(await semDadosPessoais(db, ["987654321"])).toEqual(["987654321"]);

    // Limpo: nada mais aparece (as conversas e as mensagens continuam com os canários).
    await db.update(whatsappEventos).set({ chave: "" }).where(eq(whatsappEventos.organizacaoId, org));
    await db.update(whatsappConta).set({ motivo: null }).where(eq(whatsappConta.organizacaoId, org));
    await db.delete(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, "whatsapp.conta.situacao")));
    await db.update(whatsappAvisosDia).set({ desconhecidos: 0 }).where(eq(whatsappAvisosDia.dia, "2026-10-17"));
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([]);
    expect(await semDadosPessoais(db, ["987654321"])).toEqual([]);
    expect(await db.select().from(whatsappMensagens).where(eq(whatsappMensagens.texto, CANARIOS.texto))).toHaveLength(1);
  });

  it("a varredura também lê o resumo das execuções das rotinas", async () => {
    const [e] = await db.insert(execucoesAutomacao).values({ nome: "whatsapp", ok: true, resumo: `0 aviso(s) antigo(s) apagado(s); ${CANARIOS.telefoneFormatado}` }).returning();
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([CANARIOS.telefoneFormatado]);
    await db.delete(execucoesAutomacao).where(eq(execucoesAutomacao.id, e.id));
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([]);
  });
});
