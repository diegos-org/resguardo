/**
 * Gravação idempotente dos avisos do WhatsApp (M10.1a, desenho 4.2 e 4.3; cenários de 8-D): repetição, eco, histórico,
 * precedência por posto no mesmo wamid, edição, apagamento, reação, identidades (BSUID, wa_id com e sem o nono dígito,
 * conflito, trocas), agenda, histórico, situação da conta e "sem resposta". Os avisos passam pela leitura e pela
 * gravação como na rota (`entregarAviso`), com os envelopes fictícios de `testes.ts`. PGlite, sem rede.
 */
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditoria, whatsappAvisosDia, whatsappConta, whatsappContatos, whatsappEventos, whatsappMensagens } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { MOTIVOS_DESCONEXAO } from "./regras";
import {
  avisoDeAgenda,
  avisoDeConta,
  avisoDeEcos,
  avisoDeHistorico,
  avisoDeHistoricoRecusado,
  avisoDeMensagens,
  CANARIOS,
  contatoDoAviso,
  conversaDoHistorico,
  ecoDoAviso,
  entregarAviso,
  FICTICIOS,
  HORA_DO_AVISO,
  itemDaAgenda,
  itemDoAviso,
  juntarCorpos,
  organizacaoComWhatsapp,
  pedacoDoHistorico,
  semDadosPessoaisWhatsapp,
  tabelasComTexto,
} from "./testes";

let db: Db, close: () => Promise<void>, org: string;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  await db.delete(whatsappAvisosDia);
  org = await organizacaoComWhatsapp(db);
});

/** A hora de cada entrega (`recebido_em`): sempre depois da anterior, para os eventos saírem em ordem. */
let relogio = 0;
const agora = () => new Date(Date.UTC(2026, 9, 17, 16, 0, 0) + ++relogio * 1000);
const entregar = (json: unknown) => entregarAviso(db, json, agora());
/** Minutos depois da hora padrão dos avisos. */
const min = (n: number) => new Date(HORA_DO_AVISO.getTime() + n * 60_000);

const conversas = () => db.select().from(whatsappContatos).where(eq(whatsappContatos.organizacaoId, org)).orderBy(asc(whatsappContatos.criadoEm));
const mensagens = () => db.select().from(whatsappMensagens).where(eq(whatsappMensagens.organizacaoId, org)).orderBy(asc(whatsappMensagens.enviadaEm), asc(whatsappMensagens.wamid));
const mensagem = async (wamid: string) => (await db.select().from(whatsappMensagens).where(and(eq(whatsappMensagens.organizacaoId, org), eq(whatsappMensagens.wamid, wamid))))[0];
const eventos = () => db.select().from(whatsappEventos).where(eq(whatsappEventos.organizacaoId, org)).orderBy(asc(whatsappEventos.recebidoEm));
const conta = async () => (await db.select().from(whatsappConta).where(eq(whatsappConta.organizacaoId, org)))[0];
const contadoresDeHoje = async () => (await db.select().from(whatsappAvisosDia).where(eq(whatsappAvisosDia.dia, hojeISO("America/Sao_Paulo", agora()))))[0];
/** "Sem resposta" (T13): a última recebida em tempo real é mais nova que a última enviada em tempo real. */
const semResposta = (c: typeof whatsappContatos.$inferSelect) => c.ultimaRecebidaEm !== null && (c.ultimaEnviadaEm === null || c.ultimaEnviadaEm < c.ultimaRecebidaEm);

/** Um texto recebido em tempo real (do wa_id canário, com o contato canário). */
const recebida = (id: string, em: Date, o: Parameters<typeof itemDoAviso>[0] = {}) => avisoDeMensagens({ mensagens: [itemDoAviso({ id, em, ...o })] });
/** Uma mensagem do histórico, na conversa do wa_id canário. */
const doHistorico = (item: Record<string, unknown>, o: { progresso?: number } = {}) =>
  avisoDeHistorico({ pedacos: [pedacoDoHistorico({ progresso: o.progresso, conversas: [conversaDoHistorico({ mensagens: [item] })] })] });
const edicao = (id: string, original: string, em: Date, corpo: string) => itemDoAviso({ id, em, tipo: "edit", conteudo: { original_message_id: original, message: { type: "text", text: { body: corpo } } } });
const apagamento = (id: string, original: string, em: Date) => itemDoAviso({ id, em, tipo: "revoke", conteudo: { original_message_id: original } });
const reacao = (id: string, alvo: string, em: Date, emoji?: string) => itemDoAviso({ id, em, tipo: "reaction", conteudo: { message_id: alvo, emoji } });
/** Os BSUID dos exemplos públicos da página de BSUID e da referência messages/system. */
const BSUID_ANTIGO = "US.10230984751029384756";
const BSUID_NOVO = "US.13491208655302741918";

describe("mensagens: repetição, eco e histórico", () => {
  it("o mesmo aviso duas vezes em série: uma conversa e uma mensagem; o segundo evento sai repetido", async () => {
    await entregar(avisoDeMensagens());
    await entregar(avisoDeMensagens());
    expect(await conversas()).toHaveLength(1);
    expect(await mensagens()).toMatchObject([{ wamid: CANARIOS.wamid, tipo: "texto", texto: CANARIOS.texto, direcao: "recebida", origem: "tempo_real" }]);
    expect((await eventos()).map((e) => [e.campo, e.resultado, e.itens, e.tipo, e.chave])).toEqual([
      ["messages", "gravado", 2, "", ""],
      ["messages", "repetido", 0, "", ""],
    ]);
  });

  it("o provisório repetido (131060 em tempo real e media_placeholder do histórico) não volta como gravado", async () => {
    await entregar(recebida("wamid.TESTE.NS", min(0), { tipo: "unsupported" }));
    await entregar(recebida("wamid.TESTE.NS", min(0), { tipo: "unsupported" }));
    await entregar(doHistorico(itemDoAviso({ id: "wamid.TESTE.MP", em: min(1), tipo: "media_placeholder" }), { progresso: 40 }));
    await entregar(doHistorico(itemDoAviso({ id: "wamid.TESTE.MP", em: min(1), tipo: "media_placeholder" }), { progresso: 40 }));
    expect((await mensagens()).map((m) => [m.wamid, m.tipo, m.origem])).toEqual([
      ["wamid.TESTE.NS", "nao_suportada", "tempo_real"],
      ["wamid.TESTE.MP", "midia_pendente", "historico"],
    ]);
    expect((await eventos()).map((e) => e.resultado)).toEqual(["gravado", "repetido", "gravado", "repetido"]);
  });

  it("histórico depois do tempo real: nada muda; tempo real depois do histórico: passa a tempo_real e conta em 'sem resposta'", async () => {
    await entregar(recebida("wamid.TESTE.A", min(0)));
    const antes = await mensagem("wamid.TESTE.A");
    await entregar(doHistorico(itemDoAviso({ id: "wamid.TESTE.A", em: min(0) })));
    expect(await mensagem("wamid.TESTE.A")).toEqual(antes);

    await entregar(doHistorico(itemDoAviso({ id: "wamid.TESTE.B", em: min(5) })));
    expect(await mensagem("wamid.TESTE.B")).toMatchObject({ origem: "historico" });
    expect((await conversas())[0].ultimaRecebidaEm).toEqual(min(0));
    await entregar(recebida("wamid.TESTE.B", min(5)));
    expect(await mensagem("wamid.TESTE.B")).toMatchObject({ origem: "tempo_real", tipo: "texto", texto: CANARIOS.texto });
    expect((await conversas())[0]).toMatchObject({ ultimaRecebidaEm: min(5), ultimaMensagemEm: min(5) });
  });

  it("o eco do mesmo wamid de uma mensagem já gravada não vira outra linha", async () => {
    await entregar(recebida("wamid.TESTE.ECO", min(0)));
    await entregar(avisoDeEcos({ ecos: [ecoDoAviso({ id: "wamid.TESTE.ECO", em: min(0) })] }));
    expect(await mensagens()).toMatchObject([{ wamid: "wamid.TESTE.ECO", direcao: "recebida" }]);
    expect((await eventos()).map((e) => e.resultado)).toEqual(["gravado", "repetido"]);
  });

  it("o eco vira enviada_celular na conversa do cliente (não na da empresa) e marca a resposta", async () => {
    await entregar(recebida("wamid.TESTE.P", min(0)));
    await entregar(avisoDeEcos({ ecos: [ecoDoAviso({ id: "wamid.TESTE.R", em: min(2), conteudo: { body: "Resposta pelo celular" } })] }));
    const [c] = await conversas();
    expect(await conversas()).toHaveLength(1);
    expect(c).toMatchObject({ waId: CANARIOS.waIdBr, ultimaRecebidaEm: min(0), ultimaEnviadaEm: min(2), ultimaMensagemEm: min(2) });
    expect(await mensagem("wamid.TESTE.R")).toMatchObject({ direcao: "enviada_celular", origem: "tempo_real", contatoId: c.id, texto: "Resposta pelo celular" });
    expect((await db.select().from(whatsappContatos).where(eq(whatsappContatos.waId, FICTICIOS.telefoneEmpresa)))).toEqual([]);
  });
});

describe("mensagens: precedência por posto no mesmo wamid (T16)", () => {
  it("131060 (nao_suportada) é substituída pelo conteúdo; midia_pendente pela mídia que chega depois", async () => {
    await entregar(recebida("wamid.TESTE.NS", min(0), { tipo: "unsupported" }));
    await entregar(recebida("wamid.TESTE.NS", min(0)));
    expect(await mensagem("wamid.TESTE.NS")).toMatchObject({ tipo: "texto", texto: CANARIOS.texto, origem: "tempo_real" });

    await entregar(doHistorico(itemDoAviso({ id: "wamid.TESTE.MP", em: min(1), tipo: "media_placeholder" })));
    await entregar(avisoDeHistorico({ mensagens: [itemDoAviso({ id: "wamid.TESTE.MP", em: min(1), tipo: "image", conteudo: { mime_type: "image/jpeg", caption: "Foto da varanda" } })] }));
    expect(await mensagem("wamid.TESTE.MP")).toMatchObject({ tipo: "imagem", texto: "Foto da varanda", anexoMime: "image/jpeg", origem: "historico" });
  });

  it("o histórico depois de uma 131060 em tempo real traz o conteúdo e mantém tempo_real", async () => {
    await entregar(recebida("wamid.TESTE.H", min(0), { tipo: "unsupported" }));
    await entregar(doHistorico(itemDoAviso({ id: "wamid.TESTE.H", em: min(0) })));
    expect(await mensagem("wamid.TESTE.H")).toMatchObject({ tipo: "texto", texto: CANARIOS.texto, origem: "tempo_real" });
  });

  it("uma 131060 em tempo real reenviada depois do histórico com o conteúdo não apaga texto nem tipo: só a origem vira tempo_real", async () => {
    await entregar(doHistorico(itemDoAviso({ id: "wamid.TESTE.T", em: min(0), tipo: "image", conteudo: { mime_type: "image/png", caption: "Planta do apartamento" } })));
    await entregar(recebida("wamid.TESTE.T", min(0), { tipo: "unsupported" }));
    expect(await mensagem("wamid.TESTE.T")).toMatchObject({ tipo: "imagem", texto: "Planta do apartamento", anexoMime: "image/png", origem: "tempo_real" });
  });

  it("o mesmo wamid duas vezes no mesmo bloco: uma linha, fica o de maior posto e, no empate, o primeiro", async () => {
    // Sem tirar o repetido do lote, o Postgres recusa o upsert que toca a mesma linha duas vezes (21000), a rota responde
    // 500 e a Meta reenvia o mesmo POST por 7 dias.
    await entregar(avisoDeMensagens({ mensagens: [itemDoAviso({ id: "wamid.TESTE.D", tipo: "unsupported" }), itemDoAviso({ id: "wamid.TESTE.D" })] }));
    expect(await mensagem("wamid.TESTE.D")).toMatchObject({ tipo: "texto", texto: CANARIOS.texto });
    await entregar(avisoDeMensagens({ mensagens: [itemDoAviso({ id: "wamid.TESTE.E", conteudo: { body: "Primeiro" } }), itemDoAviso({ id: "wamid.TESTE.E", conteudo: { body: "Segundo" } })] }));
    expect(await mensagem("wamid.TESTE.E")).toMatchObject({ texto: "Primeiro" });
    expect(await mensagens()).toHaveLength(2);
  });

  it("aviso sem context nem mime sobre a linha que já tem resposta_a e anexo_mime não os apaga", async () => {
    await entregar(doHistorico(itemDoAviso({ id: "wamid.TESTE.C", em: min(1), tipo: "image", respostaA: "wamid.TESTE.ANTERIOR", conteudo: { mime_type: "image/jpeg" } })));
    await entregar(recebida("wamid.TESTE.C", min(1), { tipo: "image", conteudo: { mime_type: "IMAGEM TORTA" } }));
    expect(await mensagem("wamid.TESTE.C")).toMatchObject({ origem: "tempo_real", respostaA: "wamid.TESTE.ANTERIOR", anexoMime: "image/jpeg" });
  });

  it("unsupported de evento (reaction, edit) não cria linha nem muda 'sem resposta' ou 'não lida'", async () => {
    await entregar(recebida("wamid.TESTE.P", min(0)));
    await entregar(avisoDeEcos({ ecos: [ecoDoAviso({ id: "wamid.TESTE.R", em: min(1) })] }));
    const antes = (await conversas())[0];
    for (const tipo of ["reaction", "edit"]) await entregar(recebida(`wamid.TESTE.U.${tipo}`, min(5), { tipo: "unsupported", conteudo: { type: tipo } }));
    expect((await mensagens()).map((m) => m.wamid)).toEqual(["wamid.TESTE.P", "wamid.TESTE.R"]);
    const depois = (await conversas())[0];
    expect(depois).toMatchObject({ ultimaRecebidaEm: antes.ultimaRecebidaEm, ultimaEnviadaEm: antes.ultimaEnviadaEm, ultimaMensagemEm: antes.ultimaMensagemEm });
    expect(semResposta(depois)).toBe(false);
    expect((await eventos()).slice(-2).map((e) => e.resultado)).toEqual(["ignorado", "ignorado"]);
    expect(await contadoresDeHoje()).toMatchObject({ ignorados: 2 });
  });
});

describe("edição, apagamento e reação", () => {
  it("edição mais nova aplica; mais velha não; repetida não muda nada; depois do apagamento não devolve o texto", async () => {
    await entregar(recebida("wamid.TESTE.O", min(0), { conteudo: { body: "Texto original" } }));
    await entregar(avisoDeMensagens({ mensagens: [edicao("wamid.TESTE.E1", "wamid.TESTE.O", min(10), "Texto editado")] }));
    expect(await mensagem("wamid.TESTE.O")).toMatchObject({ tipo: "texto", texto: "Texto editado", editadaEm: min(10) });
    await entregar(avisoDeMensagens({ mensagens: [edicao("wamid.TESTE.E0", "wamid.TESTE.O", min(5), "Edição velha")] }));
    await entregar(avisoDeMensagens({ mensagens: [edicao("wamid.TESTE.E1", "wamid.TESTE.O", min(10), "Texto editado")] }));
    expect(await mensagem("wamid.TESTE.O")).toMatchObject({ texto: "Texto editado", editadaEm: min(10) });
    expect((await eventos()).map((e) => e.resultado)).toEqual(["gravado", "gravado", "repetido", "repetido"]);

    await entregar(avisoDeMensagens({ mensagens: [apagamento("wamid.TESTE.X", "wamid.TESTE.O", min(20))] }));
    await entregar(avisoDeMensagens({ mensagens: [edicao("wamid.TESTE.E2", "wamid.TESTE.O", min(30), "Depois de apagar")] }));
    await entregar(avisoDeMensagens({ mensagens: [apagamento("wamid.TESTE.X", "wamid.TESTE.O", min(20))] }));
    expect(await mensagem("wamid.TESTE.O")).toMatchObject({ texto: "", apagadaEm: min(20), editadaEm: min(10) });
    expect((await eventos()).slice(-3).map((e) => e.resultado)).toEqual(["gravado", "repetido", "repetido"]);
    // Edição e apagamento não mudam o resumo da conversa: a última recebida continua sendo a original.
    expect((await conversas())[0]).toMatchObject({ ultimaRecebidaEm: min(0), ultimaMensagemEm: min(0) });
  });

  it("apagamento antes da original: linha provisória sem texto, e a original tardia (tempo real e histórico) chega sem texto", async () => {
    await entregar(avisoDeMensagens({ mensagens: [apagamento("wamid.TESTE.X1", "wamid.TESTE.TR", min(10)), apagamento("wamid.TESTE.X2", "wamid.TESTE.HI", min(10))] }));
    expect((await mensagens()).map((m) => [m.wamid, m.tipo, m.texto, m.apagadaEm, m.enviadaEm])).toEqual([
      ["wamid.TESTE.HI", "pendente", "", min(10), min(10)],
      ["wamid.TESTE.TR", "pendente", "", min(10), min(10)],
    ]);
    await entregar(recebida("wamid.TESTE.TR", min(1)));
    await entregar(doHistorico(itemDoAviso({ id: "wamid.TESTE.HI", em: min(2) })));
    expect(await mensagem("wamid.TESTE.TR")).toMatchObject({ tipo: "texto", texto: "", apagadaEm: min(10), enviadaEm: min(1), origem: "tempo_real" });
    expect(await mensagem("wamid.TESTE.HI")).toMatchObject({ tipo: "texto", texto: "", apagadaEm: min(10), enviadaEm: min(2), origem: "tempo_real" });
  });

  it("edição antes da original: a original tardia mantém o texto editado e ganha o tipo, o mime e a hora", async () => {
    await entregar(avisoDeMensagens({ mensagens: [edicao("wamid.TESTE.E", "wamid.TESTE.IMG", min(10), "Legenda editada")] }));
    expect(await mensagem("wamid.TESTE.IMG")).toMatchObject({ tipo: "pendente", texto: "Legenda editada", editadaEm: min(10), enviadaEm: min(10) });
    await entregar(recebida("wamid.TESTE.IMG", min(1), { tipo: "image", conteudo: { mime_type: "image/jpeg", caption: "Legenda original" } }));
    expect(await mensagem("wamid.TESTE.IMG")).toMatchObject({ tipo: "imagem", texto: "Legenda editada", anexoMime: "image/jpeg", editadaEm: min(10), enviadaEm: min(1) });
  });

  it("reação aplica; retirada limpa; a mais velha não volta; sobre mensagem que o sistema não tem conta em ignorados", async () => {
    await entregar(recebida("wamid.TESTE.M", min(0)));
    const antes = (await conversas())[0];
    await entregar(avisoDeMensagens({ mensagens: [reacao("wamid.TESTE.R1", "wamid.TESTE.M", min(5), "👍")] }));
    expect(await mensagem("wamid.TESTE.M")).toMatchObject({ reacao: "👍", reacaoEm: min(5) });
    await entregar(avisoDeMensagens({ mensagens: [reacao("wamid.TESTE.R2", "wamid.TESTE.M", min(7), "")] }));
    expect(await mensagem("wamid.TESTE.M")).toMatchObject({ reacao: null, reacaoEm: min(7) });
    await entregar(avisoDeMensagens({ mensagens: [reacao("wamid.TESTE.R3", "wamid.TESTE.M", min(6), "❤️")] }));
    expect(await mensagem("wamid.TESTE.M")).toMatchObject({ reacao: null, reacaoEm: min(7) });
    await entregar(avisoDeMensagens({ mensagens: [reacao("wamid.TESTE.R4", "wamid.TESTE.NAOEXISTE", min(8), "🙂")] }));
    expect(await mensagens()).toHaveLength(1);
    expect((await eventos()).map((e) => e.resultado)).toEqual(["gravado", "gravado", "gravado", "repetido", "ignorado"]);
    expect(await contadoresDeHoje()).toMatchObject({ ignorados: 1 });
    // A reação não mexe no resumo ("sem resposta" e "não lida").
    expect((await conversas())[0]).toMatchObject({ ultimaRecebidaEm: antes.ultimaRecebidaEm, ultimaMensagemEm: antes.ultimaMensagemEm });
  });
});

describe("identidade das conversas", () => {
  it("contato só com BSUID; o mesmo cliente chegando depois com wa_id completa a linha (e o nome do perfil)", async () => {
    await entregar(avisoDeMensagens({ contatos: [contatoDoAviso({ waId: null, bsuid: CANARIOS.bsuid, nome: null })], mensagens: [itemDoAviso({ id: "wamid.TESTE.1", de: null, deUsuario: CANARIOS.bsuid, em: min(0) })] }));
    expect(await conversas()).toMatchObject([{ waId: null, bsuid: CANARIOS.bsuid, nomePerfil: "" }]);
    await entregar(avisoDeMensagens({ contatos: [contatoDoAviso({ bsuid: CANARIOS.bsuid })], mensagens: [itemDoAviso({ id: "wamid.TESTE.2", deUsuario: CANARIOS.bsuid, em: min(1) })] }));
    const lista = await conversas();
    expect(lista).toMatchObject([{ waId: CANARIOS.waIdBr, bsuid: CANARIOS.bsuid, nomePerfil: CANARIOS.nomePerfil, conflitoIdentidade: false }]);
    expect(new Set((await mensagens()).map((m) => m.contatoId))).toEqual(new Set([lista[0].id]));
  });

  it("wa_id e BSUID em duas conversas diferentes: as duas ficam com o aviso de conflito, nada é fundido, fica a do BSUID", async () => {
    await entregar(avisoDeMensagens({ mensagens: [itemDoAviso({ id: "wamid.TESTE.1", em: min(0) })] }));
    await entregar(avisoDeMensagens({ contatos: [], mensagens: [itemDoAviso({ id: "wamid.TESTE.2", de: null, deUsuario: CANARIOS.bsuid, em: min(1) })] }));
    expect((await conversas()).map((c) => [c.waId, c.bsuid, c.conflitoIdentidade])).toEqual([
      [CANARIOS.waIdBr, null, false],
      [null, CANARIOS.bsuid, false],
    ]);
    await entregar(avisoDeMensagens({ contatos: [contatoDoAviso({ bsuid: CANARIOS.bsuid })], mensagens: [itemDoAviso({ id: "wamid.TESTE.3", deUsuario: CANARIOS.bsuid, em: min(2) })] }));
    const [porWaId, porBsuid] = await conversas();
    expect([porWaId, porBsuid].map((c) => [c.waId, c.bsuid, c.conflitoIdentidade])).toEqual([
      [CANARIOS.waIdBr, null, true],
      [null, CANARIOS.bsuid, true],
    ]);
    expect(await mensagem("wamid.TESTE.3")).toMatchObject({ contatoId: porBsuid.id });
  });

  it("conversa achada só pelo telefone, com outro BSUID: a mensagem cai nela, o BSUID não muda e ela ganha o aviso de conflito (T15)", async () => {
    // Acréscimo ao desenho (T15, "avisar em vez de supor"): pode ser outra pessoa com o mesmo número.
    await entregar(avisoDeMensagens({ contatos: [contatoDoAviso({ bsuid: BSUID_ANTIGO })], mensagens: [itemDoAviso({ id: "wamid.TESTE.1", deUsuario: BSUID_ANTIGO, em: min(0) })] }));
    await entregar(avisoDeMensagens({ contatos: [contatoDoAviso({ bsuid: BSUID_NOVO })], mensagens: [itemDoAviso({ id: "wamid.TESTE.2", deUsuario: BSUID_NOVO, em: min(1) })] }));
    const lista = await conversas();
    expect(lista).toMatchObject([{ waId: CANARIOS.waIdBr, bsuid: BSUID_ANTIGO, conflitoIdentidade: true }]);
    expect((await mensagens()).map((m) => m.contatoId)).toEqual([lista[0].id, lista[0].id]);
  });

  it("a mesma conversa com e sem o nono dígito: a mensagem acha a gravada, nos dois sentidos, sem criar outra", async () => {
    await entregar(avisoDeMensagens({ mensagens: [itemDoAviso({ id: "wamid.TESTE.COM9", em: min(0) })] }));
    await entregar(avisoDeMensagens({ contatos: [contatoDoAviso({ waId: CANARIOS.waIdBrSem9 })], mensagens: [itemDoAviso({ id: "wamid.TESTE.SEM9", de: CANARIOS.waIdBrSem9, em: min(1) })] }));
    expect(await conversas()).toMatchObject([{ waId: CANARIOS.waIdBr }]);
    expect(await mensagens()).toHaveLength(2);

    org = await organizacaoComWhatsapp(db);
    await entregar(avisoDeMensagens({ contatos: [contatoDoAviso({ waId: CANARIOS.waIdBrSem9 })], mensagens: [itemDoAviso({ id: "wamid.TESTE.SEM9", de: CANARIOS.waIdBrSem9, em: min(0) })] }));
    await entregar(avisoDeMensagens({ mensagens: [itemDoAviso({ id: "wamid.TESTE.COM9", em: min(1) })] }));
    expect(await conversas()).toMatchObject([{ waId: CANARIOS.waIdBrSem9 }]);
    expect(await mensagens()).toHaveLength(2);
  });
});

describe("trocas de identidade (mensagem de sistema)", () => {
  // Os valores dos dois exemplos públicos da referência messages/system.
  const NUMERO_ANTIGO = FICTICIOS.cliente;
  const NUMERO_NOVO = "12195555358";
  type Sistema = { de?: string | null; type: string; waId?: string; userId?: string; previo?: string; id?: string; em?: Date };
  const itemDeSistema = (o: Sistema) =>
    itemDoAviso({ id: o.id ?? "wamid.TESTE.SIS", de: o.de === undefined ? NUMERO_ANTIGO : o.de, em: o.em ?? min(5), tipo: "system", conteudo: { type: o.type, wa_id: o.waId, user_id: o.userId, previous_user_id: o.previo, body: "Texto do sistema" } });
  const sistema = (o: Sistema) => avisoDeMensagens({ contatos: [], mensagens: [itemDeSistema(o)] });
  const doCliente = (id: string, waId: string, bsuid: string, em: Date) => avisoDeMensagens({ contatos: [contatoDoAviso({ waId, bsuid })], mensagens: [itemDoAviso({ id, de: waId, deUsuario: bsuid, em })] });

  it("troca de número: a conversa ganha o número e o BSUID novos, sem conflito falso, e a próxima mensagem cai nela", async () => {
    await entregar(doCliente("wamid.TESTE.1", NUMERO_ANTIGO, BSUID_ANTIGO, min(0)));
    await entregar(sistema({ type: "user_changed_number", waId: NUMERO_NOVO, userId: BSUID_NOVO, previo: BSUID_ANTIGO }));
    // O aviso de troca entra na lista, mas não deixa a conversa "sem resposta" por conta própria.
    expect((await conversas())[0]).toMatchObject({ ultimaRecebidaEm: min(0), ultimaMensagemEm: min(5) });
    await entregar(doCliente("wamid.TESTE.2", NUMERO_NOVO, BSUID_NOVO, min(6)));
    const lista = await conversas();
    expect(lista).toMatchObject([{ waId: NUMERO_NOVO, bsuid: BSUID_NOVO, conflitoIdentidade: false }]);
    expect((await mensagens()).map((m) => [m.wamid, m.tipo, m.texto, m.contatoId])).toEqual([
      ["wamid.TESTE.1", "texto", CANARIOS.texto, lista[0].id],
      ["wamid.TESTE.SIS", "sistema", "", lista[0].id],
      ["wamid.TESTE.2", "texto", CANARIOS.texto, lista[0].id],
    ]);
    expect(lista[0].ultimaRecebidaEm).toEqual(min(6));
  });

  it("troca de BSUID sem from: acha a conversa pelo previous_user_id, troca o BSUID, mantém o wa_id e grava a linha sistema nela", async () => {
    await entregar(doCliente("wamid.TESTE.1", NUMERO_ANTIGO, BSUID_ANTIGO, min(0)));
    await entregar(sistema({ de: null, type: "user_changed_user_id", userId: BSUID_NOVO, previo: BSUID_ANTIGO }));
    const lista = await conversas();
    expect(lista).toMatchObject([{ waId: NUMERO_ANTIGO, bsuid: BSUID_NOVO, conflitoIdentidade: false }]);
    expect(await mensagem("wamid.TESTE.SIS")).toMatchObject({ tipo: "sistema", texto: "", contatoId: lista[0].id });
  });

  it("troca de número sem from: acha a conversa só pelo BSUID antigo", async () => {
    await entregar(doCliente("wamid.TESTE.1", NUMERO_ANTIGO, BSUID_ANTIGO, min(0)));
    await entregar(sistema({ de: null, type: "user_changed_number", waId: NUMERO_NOVO, previo: BSUID_ANTIGO }));
    expect(await conversas()).toMatchObject([{ waId: NUMERO_NOVO, bsuid: BSUID_ANTIGO, conflitoIdentidade: false }]);
  });

  it("troca para uma identidade que já é de outra conversa: conflito nas duas e nada muda", async () => {
    await entregar(doCliente("wamid.TESTE.1", NUMERO_ANTIGO, BSUID_ANTIGO, min(0)));
    await entregar(avisoDeMensagens({ contatos: [contatoDoAviso({ waId: NUMERO_NOVO })], mensagens: [itemDoAviso({ id: "wamid.TESTE.2", de: NUMERO_NOVO, em: min(1) })] }));
    await entregar(sistema({ type: "user_changed_number", waId: NUMERO_NOVO, userId: BSUID_NOVO, previo: BSUID_ANTIGO }));
    expect((await conversas()).map((c) => [c.waId, c.bsuid, c.conflitoIdentidade])).toEqual([
      [NUMERO_ANTIGO, BSUID_ANTIGO, true],
      [NUMERO_NOVO, null, true],
    ]);
  });

  // A Meta junta até 1.000 atualizações por POST: a troca e a primeira mensagem da identidade nova podem chegar juntas.
  it("troca de número e a primeira mensagem da identidade nova no mesmo bloco: uma conversa, com a identidade nova, sem conflito", async () => {
    await entregar(doCliente("wamid.TESTE.1", NUMERO_ANTIGO, BSUID_ANTIGO, min(0)));
    await entregar(
      avisoDeMensagens({
        contatos: [contatoDoAviso({ waId: NUMERO_NOVO, bsuid: BSUID_NOVO })],
        mensagens: [
          itemDeSistema({ type: "user_changed_number", waId: NUMERO_NOVO, userId: BSUID_NOVO, previo: BSUID_ANTIGO }),
          itemDoAviso({ id: "wamid.TESTE.2", de: NUMERO_NOVO, deUsuario: BSUID_NOVO, em: min(6) }),
        ],
      }),
    );
    const lista = await conversas();
    expect(lista).toMatchObject([{ waId: NUMERO_NOVO, bsuid: BSUID_NOVO, conflitoIdentidade: false, nomePerfil: CANARIOS.nomePerfil, ultimaRecebidaEm: min(6) }]);
    expect((await mensagens()).map((m) => [m.wamid, m.contatoId])).toEqual([
      ["wamid.TESTE.1", lista[0].id],
      ["wamid.TESTE.SIS", lista[0].id],
      ["wamid.TESTE.2", lista[0].id],
    ]);
  });

  it("troca de BSUID e mensagem da identidade nova no mesmo bloco (só o BSUID, e com o wa_id): uma conversa, sem conflito", async () => {
    await entregar(doCliente("wamid.TESTE.1", NUMERO_ANTIGO, BSUID_ANTIGO, min(0)));
    await entregar(
      avisoDeMensagens({
        contatos: [],
        mensagens: [itemDeSistema({ de: null, type: "user_changed_user_id", userId: BSUID_NOVO, previo: BSUID_ANTIGO }), itemDoAviso({ id: "wamid.TESTE.2", de: null, deUsuario: BSUID_NOVO, em: min(6) })],
      }),
    );
    let lista = await conversas();
    expect(lista).toMatchObject([{ waId: NUMERO_ANTIGO, bsuid: BSUID_NOVO, conflitoIdentidade: false }]);
    expect(new Set((await mensagens()).map((m) => m.contatoId))).toEqual(new Set([lista[0].id]));

    org = await organizacaoComWhatsapp(db);
    await entregar(doCliente("wamid.TESTE.1", NUMERO_ANTIGO, BSUID_ANTIGO, min(0)));
    await entregar(
      avisoDeMensagens({
        contatos: [contatoDoAviso({ waId: NUMERO_ANTIGO, bsuid: BSUID_NOVO })],
        mensagens: [itemDeSistema({ type: "user_changed_user_id", userId: BSUID_NOVO, previo: BSUID_ANTIGO }), itemDoAviso({ id: "wamid.TESTE.2", de: NUMERO_ANTIGO, deUsuario: BSUID_NOVO, em: min(6) })],
      }),
    );
    lista = await conversas();
    expect(lista).toMatchObject([{ waId: NUMERO_ANTIGO, bsuid: BSUID_NOVO, conflitoIdentidade: false }]);
    expect(new Set((await mensagens()).map((m) => m.contatoId))).toEqual(new Set([lista[0].id]));
    expect(await mensagens()).toHaveLength(3);
  });

  it("duas trocas encadeadas no mesmo bloco: uma conversa, com o BSUID final, sem conflito", async () => {
    await entregar(doCliente("wamid.TESTE.1", NUMERO_ANTIGO, BSUID_ANTIGO, min(0)));
    await entregar(
      avisoDeMensagens({
        contatos: [],
        mensagens: [
          itemDeSistema({ id: "wamid.TESTE.SIS1", de: null, type: "user_changed_user_id", userId: BSUID_NOVO, previo: BSUID_ANTIGO, em: min(5) }),
          itemDeSistema({ id: "wamid.TESTE.SIS2", de: null, type: "user_changed_user_id", userId: CANARIOS.bsuid, previo: BSUID_NOVO, em: min(6) }),
          itemDoAviso({ id: "wamid.TESTE.2", de: null, deUsuario: CANARIOS.bsuid, em: min(7) }),
        ],
      }),
    );
    const lista = await conversas();
    expect(lista).toMatchObject([{ waId: NUMERO_ANTIGO, bsuid: CANARIOS.bsuid, conflitoIdentidade: false }]);
    expect((await mensagens()).map((m) => [m.wamid, m.contatoId])).toEqual([
      ["wamid.TESTE.1", lista[0].id],
      ["wamid.TESTE.SIS1", lista[0].id],
      ["wamid.TESTE.SIS2", lista[0].id],
      ["wamid.TESTE.2", lista[0].id],
    ]);
  });

  it("troca para uma identidade que já é de outra conversa, com mensagem dela no mesmo bloco: conflito nas duas e a mensagem fica na conversa dela", async () => {
    await entregar(doCliente("wamid.TESTE.1", NUMERO_ANTIGO, BSUID_ANTIGO, min(0)));
    await entregar(doCliente("wamid.TESTE.2", NUMERO_NOVO, BSUID_NOVO, min(1)));
    await entregar(
      avisoDeMensagens({
        contatos: [contatoDoAviso({ waId: NUMERO_NOVO, bsuid: BSUID_NOVO })],
        mensagens: [
          itemDeSistema({ type: "user_changed_number", waId: NUMERO_NOVO, userId: BSUID_NOVO, previo: BSUID_ANTIGO }),
          itemDoAviso({ id: "wamid.TESTE.3", de: NUMERO_NOVO, deUsuario: BSUID_NOVO, em: min(6) }),
        ],
      }),
    );
    const [antiga, nova] = await conversas();
    expect([antiga, nova].map((c) => [c.waId, c.bsuid, c.conflitoIdentidade])).toEqual([
      [NUMERO_ANTIGO, BSUID_ANTIGO, true],
      [NUMERO_NOVO, BSUID_NOVO, true],
    ]);
    expect(await mensagem("wamid.TESTE.SIS")).toMatchObject({ contatoId: antiga.id });
    expect(await mensagem("wamid.TESTE.3")).toMatchObject({ contatoId: nova.id });
  });
});

describe("agenda do celular (T11)", () => {
  it("antes da conversa: descartada sem rastro em nenhuma tabela, e a conversa criada depois não ganha o nome", async () => {
    await entregar(avisoDeAgenda({ itens: [itemDaAgenda({ telefone: CANARIOS.waIdBr, nome: CANARIOS.nomeAgenda })] }));
    expect(await conversas()).toEqual([]);
    expect(await tabelasComTexto(db, CANARIOS.nomeAgenda)).toEqual([]);
    expect(await conta()).toMatchObject({ sincronizacaoContatos: "recebendo" });
    expect((await eventos()).map((e) => [e.campo, e.resultado, e.itens])).toEqual([["smb_app_state_sync", "ignorado", 0]]);
    await entregar(avisoDeMensagens());
    expect(await conversas()).toMatchObject([{ nomeAgenda: "", nomeAgendaEm: null }]);
  });

  it("só a conversa existente ganha o nome (pelo wa_id, com ou sem o nono dígito); o mais novo vale; remove limpa; recebidos em avança", async () => {
    await entregar(avisoDeMensagens());
    const t1 = agora();
    await entregar(avisoDeAgenda({ itens: [itemDaAgenda({ telefone: CANARIOS.waIdBrSem9, nome: "Nome Mais Novo", em: min(2) }), itemDaAgenda({ telefone: CANARIOS.waIdBr, nome: "Nome Mais Velho", em: min(1) }), itemDaAgenda({ telefone: CANARIOS.waIdEstrangeiro, nome: "Contato Agenda Sem Conversa Fictício" })] }));
    expect(await conversas()).toMatchObject([{ nomeAgenda: "Nome Mais Novo", nomeAgendaEm: min(2) }]);
    // A mesma busca que prova a ausência acha o nome onde ele está.
    expect(await tabelasComTexto(db, "Nome Mais Novo")).toEqual(["whatsapp_contatos"]);
    const primeira = (await conta()).contatosRecebidosEm!;
    expect(primeira.getTime()).toBeGreaterThan(t1.getTime());
    // Um item mais velho que o gravado não volta.
    await entregar(avisoDeAgenda({ itens: [itemDaAgenda({ telefone: CANARIOS.waIdBr, nome: "Nome Antigo", em: min(0) })] }));
    expect(await conversas()).toMatchObject([{ nomeAgenda: "Nome Mais Novo" }]);
    await entregar(avisoDeAgenda({ itens: [itemDaAgenda({ acao: "remove", telefone: CANARIOS.waIdBr, em: min(3) })] }));
    expect(await conversas()).toMatchObject([{ nomeAgenda: "", nomeAgendaEm: min(3) }]);
    const c = await conta();
    expect(c).toMatchObject({ sincronizacaoContatos: "recebendo" });
    expect(c.contatosRecebidosEm!.getTime()).toBeGreaterThan(primeira.getTime());
    expect(await tabelasComTexto(db, "Contato Agenda Sem Conversa Fictício")).toEqual([]);
    expect((await eventos()).slice(1).map((e) => e.resultado)).toEqual(["gravado", "repetido", "gravado"]);
  });
});

describe("histórico (progresso e recusa)", () => {
  it("pedaços fora de ordem: o progresso fica no maior; 100 conclui; a recusa não sobrescreve o concluído", async () => {
    const pedaco = (progresso: number, id: string) => avisoDeHistorico({ pedacos: [pedacoDoHistorico({ progresso, conversas: [conversaDoHistorico({ mensagens: [itemDoAviso({ id, em: min(0) })] })] })] });
    await entregar(pedaco(30, "wamid.TESTE.H2"));
    expect(await conta()).toMatchObject({ sincronizacaoHistorico: "recebendo", progressoHistorico: 30 });
    await entregar(pedaco(10, "wamid.TESTE.H1"));
    expect(await conta()).toMatchObject({ sincronizacaoHistorico: "recebendo", progressoHistorico: 30 });
    await entregar(pedaco(100, "wamid.TESTE.H3"));
    await entregar(pedaco(55, "wamid.TESTE.H2"));
    expect(await conta()).toMatchObject({ sincronizacaoHistorico: "concluida", progressoHistorico: 100 });
    await entregar(avisoDeHistoricoRecusado({ comEnvelope: true }));
    expect(await conta()).toMatchObject({ sincronizacaoHistorico: "concluida" });
    expect((await mensagens()).map((m) => m.wamid)).toEqual(["wamid.TESTE.H1", "wamid.TESTE.H2", "wamid.TESTE.H3"]);
    // Do histórico, nada conta como "sem resposta" (T13).
    expect((await conversas())[0]).toMatchObject({ ultimaRecebidaEm: null, ultimaMensagemEm: min(0) });
  });

  it("2593109 (recusado no celular) → recusada; repetido não muda", async () => {
    await entregar(avisoDeHistoricoRecusado({ comEnvelope: true }));
    expect(await conta()).toMatchObject({ sincronizacaoHistorico: "recusada", progressoHistorico: null });
    await entregar(avisoDeHistoricoRecusado({ comEnvelope: true }));
    expect((await eventos()).map((e) => e.resultado)).toEqual(["gravado", "repetido"]);
  });
});

describe("situação da conta (account_update)", () => {
  const emailsDe = async (json: unknown) => (await entregar(json)).emails;

  it("cada evento da tabela muda a situação como previsto, e só os de desconexão, espera e suspensão pedem e-mail", async () => {
    const passos: [NonNullable<Parameters<typeof avisoDeConta>[0]>, string, boolean][] = [
      [{ evento: "PARTNER_ADDED", em: min(0) }, "conectada", false],
      [{ evento: "PARTNER_REMOVED", em: min(1), motivo: "PRIMARY_INACTIVITY", iniciadoPor: "SYSTEM" }, "desconectada", true],
      [{ evento: "ACCOUNT_RECONNECTED", em: min(2) }, "conectada", false],
      [{ evento: "ACCOUNT_OFFBOARDED", em: min(3) }, "aguardando_reconexao", true],
      [{ evento: "ACCOUNT_DELETED", em: min(4) }, "desconectada", true],
      [{ evento: "PARTNER_APP_UNINSTALLED", em: min(5) }, "desconectada", true],
      [{ evento: "DISABLED_UPDATE", em: min(6), banimento: "DISABLE" }, "suspensa", true],
      [{ evento: "DISABLED_UPDATE", em: min(7), banimento: "REINSTATE" }, "conectada", false],
      [{ evento: "DISABLED_UPDATE", em: min(8), banimento: "SCHEDULE_FOR_DISABLE" }, "suspensa", true],
      [{ evento: "ACCOUNT_RESTRICTION", em: min(9) }, "suspensa", false],
      [{ evento: "ACCOUNT_VIOLATION", em: min(10) }, "suspensa", false],
      [{ evento: "DISABLED_UPDATE", em: min(11) }, "suspensa", false],
    ];
    for (const [aviso, situacao, email] of passos) {
      const emails = await emailsDe(avisoDeConta(aviso));
      expect([aviso.evento, (await conta()).situacao, emails.length]).toEqual([aviso.evento, situacao, email ? 1 : 0]);
    }
    expect(await conta()).toMatchObject({ conectadoEm: min(0), situacaoEm: min(8), ultimoEvento: "DISABLED_UPDATE" });
    const lista = await eventos();
    expect(lista).toHaveLength(passos.length);
    expect(lista.map((e) => [e.campo, e.tipo, e.resultado, e.avisarPorEmail])).toEqual(passos.map(([a, , email]) => ["account_update", a.evento, "gravado", email]));
    expect(lista[1]).toMatchObject({ motivo: "PRIMARY_INACTIVITY", ocorridoEm: min(1), chave: `account_update:PARTNER_REMOVED:${Math.floor(min(1).getTime() / 1000)}:PRIMARY_INACTIVITY:-` });
  });

  it("cada motivo de desconexão é guardado (na conta e no evento); a reconexão limpa o motivo", async () => {
    let n = 0;
    for (const motivo of MOTIVOS_DESCONEXAO) {
      await entregar(avisoDeConta({ evento: "PARTNER_REMOVED", em: min(++n), motivo, iniciadoPor: "USER" }));
      expect(await conta()).toMatchObject({ situacao: "desconectada", motivo, iniciadoPor: "USER" });
      expect((await eventos()).at(-1)).toMatchObject({ motivo });
    }
    await entregar(avisoDeConta({ evento: "ACCOUNT_RECONNECTED", em: min(++n) }));
    expect(await conta()).toMatchObject({ situacao: "conectada", motivo: null, iniciadoPor: null });
  });

  it("evento repetido não grava de novo nem pede e-mail; evento mais velho que o aplicado não muda a situação nem pede e-mail", async () => {
    const removido = avisoDeConta({ evento: "PARTNER_REMOVED", em: min(5), motivo: "ACCOUNT_DISCONNECTED" });
    expect(await emailsDe(removido)).toHaveLength(1);
    expect(await emailsDe(removido)).toEqual([]);
    expect(await eventos()).toHaveLength(1);
    expect(await emailsDe(avisoDeConta({ evento: "ACCOUNT_RECONNECTED", em: min(4) }))).toEqual([]);
    expect(await emailsDe(avisoDeConta({ evento: "ACCOUNT_OFFBOARDED", em: min(3) }))).toEqual([]);
    expect(await conta()).toMatchObject({ situacao: "desconectada", situacaoEm: min(5), motivo: "ACCOUNT_DISCONNECTED" });
    expect((await eventos()).map((e) => [e.tipo, e.avisarPorEmail])).toEqual([["PARTNER_REMOVED", true], ["ACCOUNT_RECONNECTED", false], ["ACCOUNT_OFFBOARDED", false]]);
  });

  it("dois eventos de conta com a mesma hora no mesmo corpo: vale o que vem depois", async () => {
    await entregar(juntarCorpos(avisoDeConta({ evento: "PARTNER_REMOVED", em: min(1) }), avisoDeConta({ evento: "ACCOUNT_RECONNECTED", em: min(1) })));
    expect(await conta()).toMatchObject({ situacao: "conectada", situacaoEm: min(1) });
    org = await organizacaoComWhatsapp(db);
    await entregar(juntarCorpos(avisoDeConta({ evento: "ACCOUNT_RECONNECTED", em: min(1) }), avisoDeConta({ evento: "PARTNER_REMOVED", em: min(1) })));
    expect(await conta()).toMatchObject({ situacao: "desconectada", situacaoEm: min(1) });
  });

  it("PARTNER_REMOVED com entry.id do parceiro e waba_info.waba_id da conta; e o envelope da página de coexistência (entry.id = WABA, sem waba_info)", async () => {
    expect(await emailsDe(avisoDeConta({ evento: "PARTNER_REMOVED", em: min(1), entrada: FICTICIOS.outraWaba }))).toHaveLength(1);
    expect(await conta()).toMatchObject({ situacao: "desconectada" });
    org = await organizacaoComWhatsapp(db);
    const coexistencia = avisoDeConta({ evento: "PARTNER_REMOVED", em: min(1), wabaInfo: null, telefone: FICTICIOS.telefoneEmpresa, motivo: "PRIMARY_INACTIVITY", iniciadoPor: "SYSTEM" });
    expect(await emailsDe(coexistencia)).toHaveLength(1);
    expect(await conta()).toMatchObject({ situacao: "desconectada", motivo: "PRIMARY_INACTIVITY", iniciadoPor: "SYSTEM" });
  });

  it("PARTNER_APP_INSTALLED (sem efeito): ignorados +1, sem evento, sem mudar a situação e sem e-mail", async () => {
    expect(await emailsDe(avisoDeConta({ evento: "PARTNER_APP_INSTALLED", em: min(1) }))).toEqual([]);
    expect(await conta()).toBeUndefined();
    expect(await eventos()).toEqual([]);
    expect(await contadoresDeHoje()).toMatchObject({ ignorados: 1, desconhecidos: 0 });
  });

  it("a auditoria whatsapp.conta.situacao só com códigos, sem autor, e só quando a situação muda", async () => {
    await entregar(avisoDeConta({ evento: "PARTNER_REMOVED", em: min(1), motivo: "CHANGE_NUMBER" }));
    await entregar(avisoDeConta({ evento: "ACCOUNT_DELETED", em: min(2) }));
    await entregar(avisoDeConta({ evento: "ACCOUNT_RECONNECTED", em: min(3) }));
    const linhas = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, org), eq(auditoria.acao, "whatsapp.conta.situacao"))).orderBy(asc(auditoria.criadoEm));
    expect(linhas.map((l) => [l.usuarioId, l.entidade, l.entidadeId, l.mudancas])).toEqual([
      [null, "whatsapp_conta", org, { situacao: ["nao_conectada", "desconectada"], motivo: [null, "CHANGE_NUMBER"] }],
      [null, "whatsapp_conta", org, { situacao: ["desconectada", "conectada"], motivo: [null, null] }],
    ]);
  });
});

describe("sem resposta (T13)", () => {
  it("recebida em tempo real sem eco: sim; com o eco depois: não; reação, edição e apagamento não mudam; só histórico: não", async () => {
    await entregar(recebida("wamid.TESTE.1", min(0)));
    expect(semResposta((await conversas())[0])).toBe(true);
    await entregar(avisoDeEcos({ ecos: [ecoDoAviso({ id: "wamid.TESTE.2", em: min(1) })] }));
    expect(semResposta((await conversas())[0])).toBe(false);
    await entregar(avisoDeMensagens({ mensagens: [reacao("wamid.TESTE.3", "wamid.TESTE.2", min(2), "👍"), edicao("wamid.TESTE.4", "wamid.TESTE.1", min(3), "Editada"), apagamento("wamid.TESTE.5", "wamid.TESTE.1", min(4))] }));
    expect(semResposta((await conversas())[0])).toBe(false);

    org = await organizacaoComWhatsapp(db);
    await entregar(doHistorico(itemDoAviso({ id: "wamid.TESTE.HIST", em: min(0) })));
    expect(semResposta((await conversas())[0])).toBe(false);
  });
});

describe("privacidade", () => {
  it("depois de todos os cenários, nenhum canário fora das conversas e das mensagens", async () => {
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([]);
  });
});
