/**
 * Leitura dos avisos (M10.1a): um caso por regra das seções 3.2 a 3.7 do desenho, com os envelopes das páginas de
 * referência da Meta (cópias sem rede: exemplos públicos ou os construtores de `testes.ts`, com os ids fictícios dessas
 * páginas). O que é ignorado e o que é desconhecido são contados; nada de mídia, coordenada, contato compartilhado ou
 * `system.body` sai na leitura.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type AvisoLido, type BlocoLido, lerAviso } from "./aviso";
import { EVENTOS_CONTA_SEM_EFEITO, LIMITE_ITENS, UNSUPPORTED_SEM_LINHA } from "./regras";
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
  corpoComBloco,
  ecoDoAviso,
  ERRO_HISTORICO_RECUSADO,
  FICTICIOS,
  HORA_DO_AVISO,
  itemDaAgenda,
  itemDoAviso,
  juntarCorpos,
  pedacoDoHistorico,
} from "./testes";

type Lido = Extract<AvisoLido, { ilegivel: false }>;
const ler = (json: unknown): Lido => {
  const a = lerAviso(json);
  if (a.ilegivel) throw new Error("aviso ilegível");
  return a;
};
const bloco = (json: unknown): BlocoLido => {
  const a = ler(json);
  expect(a.blocos).toHaveLength(1);
  return a.blocos[0];
};
const BR = { waId: CANARIOS.waIdBr, bsuid: null };
const texto = (t: string) => ({ tipo: "texto", texto: t, anexoMime: null, respostaA: null });
const sem = (tipo: string) => ({ tipo, texto: "", anexoMime: null, respostaA: null });
const MAIS_TARDE = new Date(HORA_DO_AVISO.getTime() + 60_000);
/** Telefone de um contato compartilhado: o canário estrangeiro (faixa de exemplo 555-01xx), diferente do remetente. */
const COMPARTILHADO = CANARIOS.waIdEstrangeiro;

describe("envelope", () => {
  it("o corpo da fixture assinada: um bloco messages com o perfil, a identidade do contato e o texto", () => {
    const corpo = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/corpo-assinado.json", import.meta.url)), "utf8"));
    const b = bloco(corpo);
    const cliente = { waId: FICTICIOS.cliente, bsuid: "US.13491208655302741918" };
    expect(b).toMatchObject({ campo: "messages", wabaIds: [FICTICIOS.waba], numeroId: FICTICIOS.numero, contagem: {}, conta: null, progresso: null, historicoRecusado: false });
    expect(b.perfis).toEqual([{ cliente, nome: "Hóspede Fictício" }]);
    expect(b.mensagens).toEqual([
      { wamid: "wamid.FICTICIO0001", direcao: "recebida", origem: "tempo_real", cliente, enviadaEm: new Date("2026-10-17T16:00:00Z"), conteudo: texto("Olá, a reserva SCL-ABC123 está confirmada?") },
    ]);
  });

  it.each([
    ["object errado", { ...avisoDeMensagens(), object: "page" }],
    ["sem object", { entry: (avisoDeMensagens() as { entry: unknown }).entry }],
    ["texto", "whatsapp_business_account"],
    ["lista", [avisoDeMensagens()]],
    ["null", null],
  ])("%s → ilegível", (_, json) => {
    expect(lerAviso(json)).toEqual({ ilegivel: true });
  });

  it("sem entry, ou entry vazio → nada lido e desconhecidos +1", () => {
    expect(ler({ object: "whatsapp_business_account" })).toEqual({ ilegivel: false, blocos: [], contagem: { desconhecidos: 1 } });
    expect(ler({ object: "whatsapp_business_account", entry: [] })).toEqual({ ilegivel: false, blocos: [], contagem: { desconhecidos: 1 } });
  });

  it("entrada sem id da Meta válido, sem changes ou com changes vazio: descartada, desconhecidos +1 cada", () => {
    const valida = (avisoDeMensagens() as { entry: Record<string, unknown>[] }).entry[0];
    const a = ler({
      object: "whatsapp_business_account",
      entry: [valida, { ...valida, id: "abc" }, { ...valida, id: "1".repeat(26) }, { ...valida, id: 200 }, { id: FICTICIOS.waba }, { id: FICTICIOS.waba, changes: [] }, "x"],
    });
    expect(a.blocos).toHaveLength(1);
    expect(a.contagem).toEqual({ desconhecidos: 6 });
  });

  it("campo desconhecido, bloco sem value e bloco fora da forma: desconhecidos +1 cada", () => {
    const a = ler({
      object: "whatsapp_business_account",
      entry: [{ id: FICTICIOS.waba, changes: [{ field: "message_template_status_update", value: {} }, { field: "messages" }, "x", { field: "messages", value: [] }] }],
    });
    expect(a).toEqual({ ilegivel: false, blocos: [], contagem: { desconhecidos: 4 } });
  });

  it("sem teto de 100 entradas: 150 entradas válidas viram 150 blocos (a Meta agrupa até 1.000 por POST)", () => {
    const corpos = Array.from({ length: 150 }, (_, i) => avisoDeMensagens({ mensagens: [itemDoAviso({ id: `wamid.FICTICIO${i}` })] }));
    const a = ler(juntarCorpos(...corpos));
    expect(a.blocos).toHaveLength(150);
    expect(a.blocos.map((b) => b.mensagens[0].wamid)).toEqual(Array.from({ length: 150 }, (_, i) => `wamid.FICTICIO${i}`));
  });

  it(`mais de ${LIMITE_ITENS} itens no corpo → ilegível inteiro (nunca cortado em parte); no limite, lido`, () => {
    const status = { id: "wamid.FICTICIOSTATUS", status: "read" };
    // entrada + bloco + contato + mensagem = 4 itens; os status completam.
    const noLimite = avisoDeMensagens({ statuses: Array.from({ length: LIMITE_ITENS - 4 }, () => status) });
    expect(ler(noLimite).blocos[0].contagem).toEqual({ ignorados: LIMITE_ITENS - 4 });
    const acima = avisoDeMensagens({ statuses: Array.from({ length: LIMITE_ITENS - 3 }, () => status) });
    expect(lerAviso(acima)).toEqual({ ilegivel: true });
  });

  it(`o teto de ${LIMITE_ITENS} itens também conta as mensagens das conversas do histórico`, () => {
    // entrada + bloco + pedaço + conversa = 4 itens; as mensagens completam.
    const hist = (n: number) => avisoDeHistorico({ pedacos: [pedacoDoHistorico({ conversas: [conversaDoHistorico({ mensagens: Array.from({ length: n }, () => itemDoAviso()) })] })] });
    expect(ler(hist(LIMITE_ITENS - 4)).blocos).toHaveLength(1);
    expect(lerAviso(hist(LIMITE_ITENS - 3))).toEqual({ ilegivel: true });
  });

  it("os quatro campos de mensagem sem metadata.phone_number_id (ausente ou inválido): bloco descartado, desconhecidos +1 (T18)", () => {
    const semNumero = [
      avisoDeMensagens({ numero: null }),
      avisoDeEcos({ numero: null }),
      avisoDeHistorico({ numero: null }),
      avisoDeAgenda({ numero: null }),
      avisoDeMensagens({ numero: "numero-torto" }),
      avisoDeMensagens({ numero: "1".repeat(26) }),
    ];
    for (const corpo of semNumero) expect(ler(corpo)).toEqual({ ilegivel: false, blocos: [], contagem: { desconhecidos: 1 } });
    // Só o account_update dispensa o número.
    expect(bloco(avisoDeConta({ evento: "PARTNER_ADDED" })).numeroId).toBeNull();
  });
});

describe("messages: identidade e formas", () => {
  it("contato só com BSUID (sem wa_id e sem from)", () => {
    const b = bloco(avisoDeMensagens({ contatos: [contatoDoAviso({ waId: null, bsuid: CANARIOS.bsuid })], mensagens: [itemDoAviso({ de: null, deUsuario: CANARIOS.bsuid })] }));
    expect(b.mensagens[0].cliente).toEqual({ waId: null, bsuid: CANARIOS.bsuid });
    expect(b.perfis).toEqual([{ cliente: { waId: null, bsuid: CANARIOS.bsuid }, nome: CANARIOS.nomePerfil }]);
  });

  it("from com + vira só dígitos; from '+16505551234' com contacts[].wa_id '16505551234' usa o wa_id do contato", () => {
    expect(bloco(avisoDeMensagens({ contatos: [], mensagens: [itemDoAviso({ de: CANARIOS.comMais })] })).mensagens[0].cliente).toEqual(BR);
    const b = bloco(avisoDeMensagens({ contatos: [contatoDoAviso({ waId: FICTICIOS.cliente })], mensagens: [itemDoAviso({ de: `+${FICTICIOS.cliente}` })] }));
    expect(b.mensagens[0].cliente).toEqual({ waId: FICTICIOS.cliente, bsuid: null });
  });

  it("from com o nono dígito e contacts[].wa_id sem ele: o wa_id do contato, e um contato só", () => {
    const b = bloco(avisoDeMensagens({ contatos: [contatoDoAviso({ waId: CANARIOS.waIdBrSem9 })], mensagens: [itemDoAviso({ de: CANARIOS.waIdBr })] }));
    expect(b.mensagens[0].cliente).toEqual({ waId: CANARIOS.waIdBrSem9, bsuid: null });
    expect(b.perfis).toHaveLength(1);
  });

  it("o contato casa pelo BSUID antes do telefone; com vários contatos e nada casando, fica o from", () => {
    const outro = contatoDoAviso({ waId: CANARIOS.waIdEstrangeiro, bsuid: "US.13491208655302741918", nome: "Outro Fictício" });
    const meu = contatoDoAviso({ waId: CANARIOS.waIdBrSem9, bsuid: CANARIOS.bsuid });
    // O telefone da primeira mensagem leva ao `outro` e o BSUID ao `meu`: vence o BSUID.
    const b = bloco(avisoDeMensagens({ contatos: [outro, meu], mensagens: [itemDoAviso({ de: CANARIOS.waIdEstrangeiro, deUsuario: CANARIOS.bsuid }), itemDoAviso({ id: "wamid.FICTICIO2", de: FICTICIOS.cliente })] }));
    expect(b.mensagens.map((m) => m.cliente)).toEqual([{ waId: CANARIOS.waIdBrSem9, bsuid: CANARIOS.bsuid }, { waId: FICTICIOS.cliente, bsuid: null }]);
  });

  it("milhares de contatos e mensagens no mesmo bloco: cada mensagem casa com o seu contato (pelo BSUID ou pelo wa_id sem o nono dígito)", () => {
    const n = 3000;
    // wa_id fictícios montados na hora: 55 21 99999 + 4 dígitos (com o nono dígito), e o contato sem ele (55 21 9999 + 4).
    const waId = (i: number) => `5521${"99999"}${String(i).padStart(4, "0")}`;
    const semNono = (i: number) => `5521${"9999"}${String(i).padStart(4, "0")}`;
    const contatos = Array.from({ length: n }, (_, i) => contatoDoAviso({ waId: semNono(i), bsuid: i % 2 ? `BR.Ficticio${i}` : undefined, nome: `Perfil Fictício ${i}` }));
    const mensagens = Array.from({ length: n }, (_, i) => itemDoAviso({ id: `wamid.FICTICIO${i}`, de: waId(i), deUsuario: i % 2 ? `BR.Ficticio${i}` : undefined }));
    const b = bloco(avisoDeMensagens({ contatos, mensagens }));
    expect(b.mensagens).toHaveLength(n);
    expect(b.mensagens.every((m, i) => m.cliente.waId === semNono(i) && m.cliente.bsuid === (i % 2 ? `BR.Ficticio${i}` : null))).toBe(true);
    expect(b.perfis).toHaveLength(n);
  });

  it("um só contato no bloco vale para a mensagem, salvo se o BSUID dele contradiz o da mensagem", () => {
    const so = contatoDoAviso({ waId: FICTICIOS.cliente, bsuid: CANARIOS.bsuid });
    expect(bloco(avisoDeMensagens({ contatos: [so], mensagens: [itemDoAviso({ de: CANARIOS.waIdEstrangeiro })] })).mensagens[0].cliente).toEqual({ waId: FICTICIOS.cliente, bsuid: CANARIOS.bsuid });
    const contradiz = bloco(avisoDeMensagens({ contatos: [so], mensagens: [itemDoAviso({ de: CANARIOS.waIdEstrangeiro, deUsuario: "US.13491208655302741918" })] }));
    expect(contradiz.mensagens[0].cliente).toEqual({ waId: CANARIOS.waIdEstrangeiro, bsuid: "US.13491208655302741918" });
  });

  it("um contato e dois itens: o contato vale só para o item que casa com ele; o de outro telefone fica com o próprio from/to", () => {
    const so = contatoDoAviso({ waId: FICTICIOS.cliente, bsuid: CANARIOS.bsuid });
    const b = bloco(avisoDeMensagens({ contatos: [so], mensagens: [itemDoAviso({ de: FICTICIOS.cliente }), itemDoAviso({ id: "wamid.FICTICIO2", de: CANARIOS.waIdBr })] }));
    expect(b.mensagens.map((m) => m.cliente)).toEqual([{ waId: FICTICIOS.cliente, bsuid: CANARIOS.bsuid }, BR]);
    // No eco, o contato só com BSUID não empresta o BSUID ao eco para outro telefone.
    const soBsuid = contatoDoAviso({ waId: null, bsuid: CANARIOS.bsuid, nome: null });
    const e = bloco(avisoDeEcos({ contatos: [soBsuid], ecos: [ecoDoAviso({ para: undefined, paraUsuario: CANARIOS.bsuid }), ecoDoAviso({ id: "wamid.FICTICIO2", para: CANARIOS.waIdEstrangeiro })] }));
    expect(e.mensagens.map((m) => m.cliente)).toEqual([{ waId: null, bsuid: CANARIOS.bsuid }, { waId: CANARIOS.waIdEstrangeiro, bsuid: null }]);
  });

  it("o perfil fica para o contato com mensagem, edição ou apagamento aceito, e só para ele", () => {
    const b = bloco(
      avisoDeMensagens({
        contatos: [contatoDoAviso(), contatoDoAviso({ waId: CANARIOS.waIdEstrangeiro, nome: "Edição Fictícia" }), contatoDoAviso({ waId: FICTICIOS.cliente, nome: "Apagamento Fictício" })],
        mensagens: [
          { ...itemDoAviso(), timestamp: "ontem" },
          itemDoAviso({ id: "wamid.FICTICIO2", de: CANARIOS.waIdEstrangeiro, tipo: "edit", conteudo: { original_message_id: "wamid.FICTICIOORIGINAL", message: { type: "text", text: { body: "Editada fictícia" } } } }),
          itemDoAviso({ id: "wamid.FICTICIO3", de: FICTICIOS.cliente, tipo: "revoke", conteudo: { original_message_id: "wamid.FICTICIOORIGINAL2" } }),
        ],
      }),
    );
    expect(b.perfis.map((p) => p.nome)).toEqual(["Edição Fictícia", "Apagamento Fictício"]);
    expect(b.contagem).toEqual({ desconhecidos: 1 });
  });

  it.each([
    ["hora inválida", { ...itemDoAviso(), timestamp: "ontem" }],
    ["wamid inválido", { ...itemDoAviso(), id: "" }],
    ["reação", itemDoAviso({ tipo: "reaction", conteudo: { message_id: "wamid.FICTICIOALVO", emoji: "👍" } })],
    ["grupo", itemDoAviso({ extra: { group_id: "grupo-ficticio" } })],
    ["unsupported de evento", itemDoAviso({ tipo: "unsupported", conteudo: { type: "edit" } })],
  ])("contato só com item que não vira linha (%s): nenhum perfil, e o telefone e o nome dele não saem na leitura", (_, item) => {
    const b = bloco(avisoDeMensagens({ mensagens: [item] }));
    expect(b.perfis).toEqual([]);
    const saida = JSON.stringify(b);
    for (const proibido of [CANARIOS.waIdBr, CANARIOS.nomePerfil]) expect(saida).not.toContain(proibido);
  });

  it("recebida com from = telefone da empresa (não acontece no tempo real): descartada, desconhecidos +1", () => {
    const b = bloco(avisoDeMensagens({ mensagens: [itemDoAviso({ de: FICTICIOS.telefoneEmpresa })] }));
    expect(b).toMatchObject({ mensagens: [], perfis: [], contagem: { desconhecidos: 1 } });
  });

  it("mensagem sem telefone e sem BSUID válidos: descartada, desconhecidos +1", () => {
    const b = bloco(avisoDeMensagens({ contatos: [], mensagens: [itemDoAviso({ de: null }), itemDoAviso({ de: "abc", deUsuario: "us.minusculo" }), itemDoAviso({ de: "12345" })] }));
    expect(b.mensagens).toEqual([]);
    expect(b.contagem).toEqual({ desconhecidos: 3 });
  });

  it.each([
    ["wa_id com letra", "5521a99990000"], ["wa_id curto", "12345"], ["wa_id longo", "1".repeat(21)], ["dois +", "++5521999990000"], ["com espaço", "+55 21 99999-0000"],
  ])("telefone fora da forma (%s) é tratado como ausente", (_, tel) => {
    const b = bloco(avisoDeMensagens({ contatos: [contatoDoAviso({ waId: tel, bsuid: CANARIOS.bsuid })], mensagens: [itemDoAviso({ de: tel, deUsuario: CANARIOS.bsuid })] }));
    expect(b.mensagens[0].cliente).toEqual({ waId: null, bsuid: CANARIOS.bsuid });
  });

  it.each([
    ["minúsculas no país", "br.Ficticio1"], ["sem ponto", "BRFicticio1"], ["com hífen", "BR.Ficticio-1"], ["longo", `BR.${"a".repeat(129)}`], ["ENT minúsculo", "US.ent.123"],
  ])("BSUID fora da forma (%s) é tratado como ausente", (_, id) => {
    const b = bloco(avisoDeMensagens({ contatos: [], mensagens: [itemDoAviso({ deUsuario: id })] }));
    expect(b.mensagens[0].cliente).toEqual(BR);
  });

  it("BSUID de empresa (com ENT.) é aceito", () => {
    const b = bloco(avisoDeMensagens({ contatos: [], mensagens: [itemDoAviso({ de: null, deUsuario: "US.ENT.506847293015824" })] }));
    expect(b.mensagens[0].cliente).toEqual({ waId: null, bsuid: "US.ENT.506847293015824" });
  });

  it.each([
    ["vazio", ""], ["com espaço", "wamid.COM ESPACO"], ["acento", "wamid.ação"], ["257 caracteres", `wamid.${"A".repeat(251)}`], ["número", 123],
  ])("wamid fora da forma (%s): mensagem descartada, desconhecidos +1", (_, id) => {
    const b = bloco(avisoDeMensagens({ mensagens: [{ ...itemDoAviso(), id }] }));
    expect(b.mensagens).toEqual([]);
    expect(b.contagem).toEqual({ desconhecidos: 1 });
  });

  it("wamid sem o prefixo 'wamid.' e com 256 caracteres é aceito", () => {
    const id = "A".repeat(256);
    expect(bloco(avisoDeMensagens({ mensagens: [itemDoAviso({ id })] })).mensagens[0].wamid).toBe(id);
  });

  it.each([
    ["texto com letra", "17x"], ["13 dígitos", "1".repeat(13)], ["antes de 2009", "1229999999"], ["depois de 2100", "4102444801"], ["fração", 1792252800.5], ["negativo", -1], ["ausente", undefined],
  ])("timestamp fora da forma (%s): item descartado, desconhecidos +1", (_, timestamp) => {
    const b = bloco(avisoDeMensagens({ mensagens: [{ ...itemDoAviso(), timestamp }] }));
    expect(b.mensagens).toEqual([]);
    expect(b.contagem).toEqual({ desconhecidos: 1 });
  });

  it("timestamp em texto ou em número", () => {
    const segundos = Math.floor(HORA_DO_AVISO.getTime() / 1000);
    const b = bloco(avisoDeMensagens({ mensagens: [itemDoAviso({ em: String(segundos) }), itemDoAviso({ id: "wamid.FICTICIO2", em: segundos })] }));
    expect(b.mensagens.map((m) => m.enviadaEm)).toEqual([HORA_DO_AVISO, HORA_DO_AVISO]);
  });

  it("nome do perfil: aparado; acima de 256 caracteres, com caractere de controle ou vazio é ignorado (sem perfil)", () => {
    const b = bloco(
      avisoDeMensagens({
        contatos: [
          contatoDoAviso({ waId: CANARIOS.waIdBr, nome: `  ${CANARIOS.nomePerfil}  ` }),
          contatoDoAviso({ waId: CANARIOS.waIdEstrangeiro, nome: "a".repeat(257) }),
          contatoDoAviso({ waId: FICTICIOS.cliente, nome: "Nome\u0007Fictício" }),
          contatoDoAviso({ bsuid: CANARIOS.bsuid, waId: null, nome: "   " }),
        ],
      }),
    );
    expect(b.perfis).toEqual([{ cliente: BR, nome: CANARIOS.nomePerfil }]);
  });

  it("contato sem identidade válida não vira perfil e conta desconhecidos", () => {
    const b = bloco(avisoDeMensagens({ contatos: [{ profile: { name: CANARIOS.nomePerfil } }, "x"], mensagens: [] }));
    expect(b.perfis).toEqual([]);
    expect(b.contagem).toEqual({ desconhecidos: 2 });
  });

  it("context.id vira respostaA; context sem id válido (encaminhada, 'com espaço') → null", () => {
    const b = bloco(
      avisoDeMensagens({
        mensagens: [
          itemDoAviso({ respostaA: "wamid.FICTICIOORIGINAL" }),
          itemDoAviso({ id: "wamid.FICTICIO2", extra: { context: { forwarded: true } } }),
          itemDoAviso({ id: "wamid.FICTICIO3", extra: { context: { id: "com espaço" } } }),
        ],
      }),
    );
    expect(b.mensagens.map((m) => m.conteudo.respostaA)).toEqual(["wamid.FICTICIOORIGINAL", null, null]);
  });

  it("referral, identity_key_hash, profile.username e parent_user_id não saem na leitura", () => {
    const contato = { ...contatoDoAviso(), identity_key_hash: "DF2lS5v2W6x=", parent_user_id: "US.ENT.506847293015824", profile: { name: CANARIOS.nomePerfil, username: "usuario.ficticio" } };
    const mensagem = itemDoAviso({ extra: { referral: { source_url: "https://example.invalid/anuncio-ficticio", ctwa_clid: "clique-ficticio" }, from_parent_user_id: "US.ENT.506847293015824" } });
    const saida = JSON.stringify(bloco(avisoDeMensagens({ contatos: [contato], mensagens: [mensagem] })));
    for (const proibido of ["DF2lS5v2W6x=", "US.ENT", "usuario.ficticio", "example.invalid", "clique-ficticio"]) expect(saida).not.toContain(proibido);
  });
});

describe("messages: tipos", () => {
  it("texto; texto de 8.192 caracteres cabe; de 8.193 vira outro sem texto e desconhecidos +1 (T25)", () => {
    const b = bloco(
      avisoDeMensagens({
        mensagens: [
          itemDoAviso(),
          itemDoAviso({ id: "wamid.FICTICIO2", conteudo: { body: "a".repeat(8192) } }),
          itemDoAviso({ id: "wamid.FICTICIO3", conteudo: { body: "a".repeat(8193) } }),
          itemDoAviso({ id: "wamid.FICTICIO4", conteudo: {} }),
        ],
      }),
    );
    expect(b.mensagens.map((m) => m.conteudo)).toEqual([texto(CANARIOS.texto), texto("a".repeat(8192)), sem("outro"), sem("outro")]);
    expect(b.contagem).toEqual({ desconhecidos: 2 });
  });

  it("o limite de texto conta caracteres, não unidades UTF-16 (emoji)", () => {
    const b = bloco(avisoDeMensagens({ mensagens: [itemDoAviso({ conteudo: { body: "😀".repeat(8192) } })] }));
    expect(b.mensagens[0].conteudo.tipo).toBe("texto");
  });

  const MIDIA = { url: "https://example.invalid/midia-ficticia", id: "id-ficticio-da-midia", sha256: "sha-ficticio-da-midia", filename: "arquivo-ficticio.pdf" };
  it.each([
    ["image", "imagem", "image/jpeg", "Legenda fictícia"],
    ["video", "video", "video/mp4", "Legenda fictícia"],
    ["document", "documento", "application/pdf", "Legenda fictícia"],
    ["audio", "audio", "audio/ogg; codecs=opus", ""],
    ["sticker", "figurinha", "image/webp", ""],
  ])("%s → %s: só o mime e a legenda; nunca url, id, sha256 ou filename", (tipo, esperado, mimeType, legenda) => {
    const b = bloco(avisoDeMensagens({ mensagens: [itemDoAviso({ tipo, conteudo: { ...MIDIA, mime_type: mimeType, ...(legenda ? { caption: legenda } : {}) } })] }));
    expect(b.mensagens[0].conteudo).toEqual({ tipo: esperado, texto: legenda, anexoMime: mimeType, respostaA: null });
    const saida = JSON.stringify(b);
    for (const v of Object.values(MIDIA)) expect(saida).not.toContain(v);
  });

  it("mídia sem legenda e sem mime; legenda grande demais vira outro e desconhecidos +1", () => {
    const b = bloco(
      avisoDeMensagens({
        mensagens: [itemDoAviso({ tipo: "image", conteudo: {} }), itemDoAviso({ id: "wamid.FICTICIO2", tipo: "image", conteudo: { caption: "a".repeat(8193), mime_type: "image/jpeg" } })],
      }),
    );
    expect(b.mensagens.map((m) => m.conteudo)).toEqual([sem("imagem"), sem("outro")]);
    expect(b.contagem).toEqual({ desconhecidos: 1 });
  });

  it.each([["IMAGE/JPEG"], ["image"], ["image/jpeg; charset=utf-8"], [`image/${"a".repeat(101)}`], ["image/jpeg\n"]])("mime fora da forma (%j) → anexoMime null", (mimeType) => {
    const b = bloco(avisoDeMensagens({ mensagens: [itemDoAviso({ tipo: "image", conteudo: { mime_type: mimeType } })] }));
    expect(b.mensagens[0].conteudo).toEqual(sem("imagem"));
  });

  it("localização e contato compartilhado: sem conteúdo (nunca coordenadas, endereço, nome, url, telefones ou vcard)", () => {
    const local = { latitude: -22.98, longitude: -43.22, name: "Lugar Fictício", address: "Rua Fictícia, 1", url: "https://example.invalid/lugar" };
    const compartilhado = [{ name: { formatted_name: "Contato Compartilhado Fictício" }, phones: [{ phone: "+1 650 555 0199", wa_id: COMPARTILHADO }], emails: [{ email: "ficticio@example.invalid" }], vcard: "BEGIN:VCARD-FICTICIO" }];
    const b = bloco(avisoDeMensagens({ mensagens: [itemDoAviso({ tipo: "location", conteudo: local }), itemDoAviso({ id: "wamid.FICTICIO2", tipo: "contacts", conteudo: compartilhado })] }));
    expect(b.mensagens.map((m) => m.conteudo)).toEqual([sem("localizacao"), sem("contato")]);
    const saida = JSON.stringify(b);
    for (const proibido of ["-22.98", "43.22", "Lugar Fictício", "Rua Fictícia", "example.invalid", "Contato Compartilhado", "555 0199", COMPARTILHADO, "VCARD"]) expect(saida).not.toContain(proibido);
    expect(b.perfis).toHaveLength(1);
  });

  // Exemplo da referência messages/unsupported (131051 com unsupported.type "edit").
  const UNSUPPORTED_OFICIAL = {
    object: "whatsapp_business_account",
    entry: [{
      id: "102290129340398",
      changes: [{
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
          contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: "16505551234" }],
          messages: [{
            from: "16505551234",
            id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=",
            timestamp: "1750090702",
            errors: [{ code: 131051, title: "Message type unknown", message: "Message type unknown", error_data: { details: "Message type is currently not supported." } }],
            type: "unsupported",
            unsupported: { type: "edit" },
          }],
        },
        field: "messages",
      }],
    }],
  };

  it("o exemplo oficial de unsupported (type 'edit') não vira linha nem perfil: ignorados 1", () => {
    const b = bloco(UNSUPPORTED_OFICIAL);
    expect(b.mensagens).toEqual([]);
    expect(b.perfis).toEqual([]);
    expect(b.contagem).toEqual({ ignorados: 1 });
  });

  it.each(UNSUPPORTED_SEM_LINHA.map((t) => [t]))("unsupported.type %s (evento sobre outra mensagem, com contacts[]): nenhuma linha nem perfil, ignorados 1", (tipo) => {
    const b = bloco(avisoDeMensagens({ mensagens: [itemDoAviso({ tipo: "unsupported", conteudo: { type: tipo } })] }));
    expect(b).toMatchObject({ mensagens: [], edicoes: [], reacoes: [], perfis: [], contagem: { ignorados: 1 } });
  });

  it("unsupported 131051 e 131060 sem unsupported.type, e com 'gif': nao_suportada sem texto", () => {
    const erro = (code: number) => ({ errors: [{ code, title: "Fictício" }] });
    const b = bloco(
      avisoDeMensagens({
        mensagens: [
          itemDoAviso({ tipo: "unsupported", extra: erro(131051) }),
          itemDoAviso({ id: "wamid.FICTICIO2", tipo: "unsupported", extra: erro(131060) }),
          itemDoAviso({ id: "wamid.FICTICIO3", tipo: "unsupported", conteudo: { type: "gif" } }),
        ],
      }),
    );
    expect(b.mensagens.map((m) => m.conteudo)).toEqual([sem("nao_suportada"), sem("nao_suportada"), sem("nao_suportada")]);
    expect(b.contagem).toEqual({});
  });

  it("button, interactive e order → outro sem texto (conhecidos); media_placeholder → midia_pendente; tipo desconhecido → outro e desconhecidos +1", () => {
    const b = bloco(
      avisoDeMensagens({
        mensagens: [
          itemDoAviso({ tipo: "button", conteudo: { text: "Botão fictício", payload: "x" } }),
          itemDoAviso({ id: "wamid.FICTICIO2", tipo: "interactive", conteudo: { type: "list_reply" } }),
          itemDoAviso({ id: "wamid.FICTICIO3", tipo: "order", conteudo: {} }),
          itemDoAviso({ id: "wamid.FICTICIO4", tipo: "media_placeholder" }),
          itemDoAviso({ id: "wamid.FICTICIO5", tipo: "enquete_ficticia", conteudo: { body: CANARIOS.texto } }),
          itemDoAviso({ id: "wamid.FICTICIO6", tipo: "constructor" }),
        ],
      }),
    );
    expect(b.mensagens.map((m) => m.conteudo)).toEqual([sem("outro"), sem("outro"), sem("outro"), sem("midia_pendente"), sem("outro"), sem("outro")]);
    expect(b.contagem).toEqual({ desconhecidos: 2 });
    expect(JSON.stringify(b)).not.toContain("Botão fictício");
  });

  it("mensagem de grupo (group_id) é ignorada: nada guardado (nem o perfil do participante), ignorados +1 (T24)", () => {
    const b = bloco(avisoDeMensagens({ mensagens: [itemDoAviso({ extra: { group_id: "grupo-ficticio" } }), itemDoAviso({ id: "wamid.FICTICIO2", tipo: "reaction", conteudo: { message_id: "wamid.X", emoji: "👍" }, extra: { group_id: "grupo-ficticio" } })] }));
    expect(b).toMatchObject({ mensagens: [], reacoes: [], perfis: [], contagem: { ignorados: 2 } });
  });

  it("statuses[] e value.errors[] contam em ignorados, sem conteúdo", () => {
    const b = bloco(avisoDeMensagens({ contatos: [], mensagens: [], statuses: [{ id: CANARIOS.wamid, status: "read", recipient_id: CANARIOS.waIdBr }, { id: "wamid.FICTICIO2", status: "sent" }], erros: [{ code: 130429, title: "Rate limit hit" }] }));
    expect(b.contagem).toEqual({ ignorados: 3 });
    expect(JSON.stringify(b)).not.toContain(CANARIOS.waIdBr);
  });

  it("lista do aviso fora da forma (messages como objeto) conta desconhecidos", () => {
    const b = bloco(corpoComBloco("messages", { messaging_product: "whatsapp", metadata: { phone_number_id: FICTICIOS.numero }, messages: { id: "x" } }));
    expect(b).toMatchObject({ mensagens: [], contagem: { desconhecidos: 1 } });
  });
});

describe("messages: reação, edição, apagamento", () => {
  it("reação com emoji; sem emoji e com emoji '' = retirada; não vira linha", () => {
    const b = bloco(
      avisoDeMensagens({
        mensagens: [
          itemDoAviso({ tipo: "reaction", conteudo: { message_id: "wamid.FICTICIOALVO", emoji: "👍" } }),
          itemDoAviso({ id: "wamid.FICTICIO2", tipo: "reaction", conteudo: { message_id: "wamid.FICTICIOALVO" }, em: MAIS_TARDE }),
          itemDoAviso({ id: "wamid.FICTICIO3", tipo: "reaction", conteudo: { message_id: "wamid.FICTICIOALVO", emoji: "" } }),
        ],
      }),
    );
    expect(b.mensagens).toEqual([]);
    expect(b.reacoes).toEqual([
      { alvo: "wamid.FICTICIOALVO", emoji: "👍", em: HORA_DO_AVISO },
      { alvo: "wamid.FICTICIOALVO", emoji: null, em: MAIS_TARDE },
      { alvo: "wamid.FICTICIOALVO", emoji: null, em: HORA_DO_AVISO },
    ]);
  });

  it("reação com emoji fora da forma ou sem alvo válido: descartada, desconhecidos +1", () => {
    const b = bloco(
      avisoDeMensagens({
        mensagens: [
          itemDoAviso({ tipo: "reaction", conteudo: { message_id: "wamid.X", emoji: "😀".repeat(33) } }),
          itemDoAviso({ tipo: "reaction", conteudo: { message_id: "wamid.X", emoji: 1 } }),
          itemDoAviso({ tipo: "reaction", conteudo: { message_id: "com espaço", emoji: "👍" } }),
          itemDoAviso({ tipo: "reaction", conteudo: { emoji: "👍" } }),
        ],
      }),
    );
    expect(b.reacoes).toEqual([]);
    expect(b.contagem).toEqual({ desconhecidos: 4 });
  });

  it("edição de imagem (exemplo de messages/edit) e de texto ([não confirmado]): pelo original; context 'M0' ignorado", () => {
    const imagem = { context: { id: "M0" }, type: "image", image: { caption: "Updated image caption", mime_type: "image/jpeg", sha256: "a1b2c3d4e5f6...", id: "id-ficticio-da-midia", url: "https://media.example.com/updated-image.jpg" } };
    const textoEditado = { context: { id: "M0" }, type: "text", text: { body: "Texto editado fictício" } };
    const b = bloco(
      avisoDeMensagens({
        mensagens: [
          itemDoAviso({ id: "wamid.FICTICIOEVENTO1", tipo: "edit", conteudo: { original_message_id: "wamid.FICTICIOORIGINAL1", message: imagem } }),
          itemDoAviso({ id: "wamid.FICTICIOEVENTO2", tipo: "edit", conteudo: { original_message_id: "wamid.FICTICIOORIGINAL2", message: textoEditado } }),
        ],
      }),
    );
    expect(b.mensagens).toEqual([]);
    expect(b.edicoes).toEqual([
      { original: "wamid.FICTICIOORIGINAL1", direcao: "recebida", origem: "tempo_real", cliente: BR, em: HORA_DO_AVISO, conteudo: { tipo: "imagem", texto: "Updated image caption", anexoMime: "image/jpeg", respostaA: null } },
      { original: "wamid.FICTICIOORIGINAL2", direcao: "recebida", origem: "tempo_real", cliente: BR, em: HORA_DO_AVISO, conteudo: texto("Texto editado fictício") },
    ]);
    const saida = JSON.stringify(b);
    for (const proibido of ["FICTICIOEVENTO", "media.example.com", "id-ficticio-da-midia", "a1b2c3d4e5f6", "M0"]) expect(saida).not.toContain(proibido);
  });

  it("edição sem original válido, sem message, ou com conteúdo ilegível: não se aplica, desconhecidos +1", () => {
    const b = bloco(
      avisoDeMensagens({
        mensagens: [
          itemDoAviso({ tipo: "edit", conteudo: { message: { type: "text", text: { body: "x" } } } }),
          itemDoAviso({ tipo: "edit", conteudo: { original_message_id: "wamid.X" } }),
          itemDoAviso({ tipo: "edit", conteudo: { original_message_id: "wamid.X", message: { type: "text", text: { body: "a".repeat(8193) } } } }),
          itemDoAviso({ tipo: "edit", conteudo: { original_message_id: "wamid.X", message: { type: "desconhecido" } } }),
        ],
      }),
    );
    expect(b.edicoes).toEqual([]);
    expect(b.contagem).toEqual({ desconhecidos: 4 });
  });

  it("apagamento (revoke) pelo original; sem original válido → desconhecidos", () => {
    const b = bloco(
      avisoDeMensagens({
        mensagens: [
          itemDoAviso({ id: "wamid.FICTICIOEVENTO", tipo: "revoke", conteudo: { original_message_id: "wamid.FICTICIOORIGINAL" } }),
          itemDoAviso({ id: "wamid.FICTICIO2", tipo: "revoke", conteudo: {} }),
        ],
      }),
    );
    expect(b.apagamentos).toEqual([{ original: "wamid.FICTICIOORIGINAL", direcao: "recebida", origem: "tempo_real", cliente: BR, em: HORA_DO_AVISO }]);
    expect(b.mensagens).toEqual([]);
    expect(b.contagem).toEqual({ desconhecidos: 1 });
  });
});

describe("messages: sistema (troca de número ou de BSUID)", () => {
  // Os dois exemplos da referência messages/system (atualizada em 11/8/2026): sem contacts, sem from_user_id.
  const sistema = (mensagem: Record<string, unknown>) => ({
    object: "whatsapp_business_account",
    entry: [{ id: "102290129340398", changes: [{ value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" }, messages: [mensagem] }, field: "messages" }] }],
  });
  const TROCA_DE_NUMERO = {
    from: "16505551234",
    id: "wamid.HBgLMTk4MzU1NTE5NzQVAgASGAoxMTgyMDg2MjY3AA==",
    timestamp: "1750269342",
    system: {
      body: "User Sheena Nelson changed from 16505551234 to 12195555358",
      wa_id: "12195555358",
      type: "user_changed_number",
      user_id: "US.13491208655302741918",
      parent_user_id: "US.ENT.506847293015824",
      previous_user_id: "US.10230984751029384756",
      previous_parent_user_id: "US.ENT.918273645500112",
    },
    type: "system",
  };
  const TROCA_DE_BSUID = {
    id: "wamid.HBgLMTk4MzU1NTE5NzQVAgASGAoxMTgyMDg2MjY3AA==",
    timestamp: "1750269342",
    system: {
      body: "User changed from US.10230984751029384756 to US.13491208655302741918",
      type: "user_changed_user_id",
      user_id: "US.13491208655302741918",
      parent_user_id: "US.ENT.506847293015824",
      previous_user_id: "US.10230984751029384756",
      previous_parent_user_id: "US.ENT.918273645500112",
    },
    type: "system",
  };
  const EM = new Date("2025-06-18T17:55:42Z");
  const linhaSistema = (cliente: unknown) => ({ wamid: TROCA_DE_NUMERO.id, direcao: "recebida", origem: "tempo_real", cliente, enviadaEm: EM, conteudo: sem("sistema") });

  it("user_changed_number: anterior = from + previous_user_id; nova = system.wa_id + system.user_id; a linha sistema fica na anterior", () => {
    const b = bloco(sistema(TROCA_DE_NUMERO));
    const anterior = { waId: "16505551234", bsuid: "US.10230984751029384756" };
    expect(b.trocas).toEqual([{ tipo: "numero", anterior, nova: { waId: "12195555358", bsuid: "US.13491208655302741918" }, em: EM, wamid: TROCA_DE_NUMERO.id }]);
    expect(b.mensagens).toEqual([linhaSistema(anterior)]);
    expect(b.contagem).toEqual({});
  });

  it("user_changed_user_id sem from: anterior = só previous_user_id; nova = system.user_id", () => {
    const b = bloco(sistema(TROCA_DE_BSUID));
    const anterior = { waId: null, bsuid: "US.10230984751029384756" };
    expect(b.trocas).toEqual([{ tipo: "usuario", anterior, nova: { waId: null, bsuid: "US.13491208655302741918" }, em: EM, wamid: TROCA_DE_BSUID.id }]);
    expect(b.mensagens).toEqual([linhaSistema(anterior)]);
  });

  it("user_changed_user_id com system.wa_id: o wa_id fica nos dois lados", () => {
    const b = bloco(sistema({ ...TROCA_DE_BSUID, system: { ...TROCA_DE_BSUID.system, wa_id: "16505551234" } }));
    expect(b.trocas[0]).toMatchObject({ anterior: { waId: "16505551234", bsuid: "US.10230984751029384756" }, nova: { waId: "16505551234", bsuid: "US.13491208655302741918" } });
  });

  it("nunca lê system.body, parent_user_id nem previous_parent_user_id", () => {
    const saida = JSON.stringify([bloco(sistema(TROCA_DE_NUMERO)), bloco(sistema(TROCA_DE_BSUID))]);
    for (const proibido of ["Sheena", "changed from", "US.ENT"]) expect(saida).not.toContain(proibido);
  });

  it("sem previous_user_id e sem from: nenhuma troca, nenhuma linha, desconhecidos +1", () => {
    const semAnterior = { ...TROCA_DE_BSUID, system: { ...TROCA_DE_BSUID.system, previous_user_id: undefined } };
    const b = bloco(sistema(semAnterior));
    expect(b).toMatchObject({ trocas: [], mensagens: [], contagem: { desconhecidos: 1 } });
  });

  it("system.type desconhecido, ou sem wamid válido: desconhecidos +1", () => {
    expect(bloco(sistema({ ...TROCA_DE_NUMERO, system: { ...TROCA_DE_NUMERO.system, type: "outra_troca" } }))).toMatchObject({ trocas: [], mensagens: [], contagem: { desconhecidos: 1 } });
    expect(bloco(sistema({ ...TROCA_DE_NUMERO, id: "" }))).toMatchObject({ trocas: [], mensagens: [], contagem: { desconhecidos: 1 } });
  });

  it("troca de número sem o número novo (usernames) e sem BSUID novo: só a linha sistema, sem troca", () => {
    const b = bloco(sistema({ ...TROCA_DE_NUMERO, system: { type: "user_changed_number", previous_user_id: "US.10230984751029384756" } }));
    expect(b.trocas).toEqual([]);
    expect(b.mensagens).toHaveLength(1);
  });
});

describe("smb_message_echoes (mandadas pelo celular)", () => {
  it("eco vira enviada_celular com a identidade do to/to_user_id (o from é a empresa)", () => {
    const b = bloco(avisoDeEcos({ ecos: [ecoDoAviso({ paraUsuario: CANARIOS.bsuid })] }));
    expect(b.mensagens).toEqual([{ wamid: CANARIOS.wamid, direcao: "enviada_celular", origem: "tempo_real", cliente: { waId: CANARIOS.waIdBr, bsuid: CANARIOS.bsuid }, enviadaEm: HORA_DO_AVISO, conteudo: texto(CANARIOS.texto) }]);
  });

  it("eco com contacts[] (só com BSUID): casa pelo to_user_id e usa o wa_id do contato", () => {
    const b = bloco(avisoDeEcos({ contatos: [{ profile: { username: "usuario.ficticio" }, wa_id: CANARIOS.waIdBrSem9, user_id: CANARIOS.bsuid }], ecos: [ecoDoAviso({ para: undefined, paraUsuario: CANARIOS.bsuid })] }));
    expect(b.mensagens[0].cliente).toEqual({ waId: CANARIOS.waIdBrSem9, bsuid: CANARIOS.bsuid });
    expect(b.perfis).toEqual([]);
  });

  it("eco sem to e sem to_user_id: descartado, desconhecidos +1", () => {
    const eco = ecoDoAviso();
    delete (eco as Record<string, unknown>).to;
    const b = bloco(avisoDeEcos({ ecos: [eco] }));
    expect(b).toMatchObject({ mensagens: [], contagem: { desconhecidos: 1 } });
  });

  it("edição e apagamento feitos pela empresa (exemplos de smb_message_echoes): direção enviada_celular", () => {
    const b = bloco(
      avisoDeEcos({
        ecos: [
          ecoDoAviso({ id: "wamid.FICTICIOEVENTO1", tipo: "revoke", conteudo: { original_message_id: "wamid.FICTICIOORIGINAL" } }),
          ecoDoAviso({ id: "wamid.FICTICIOEVENTO2", tipo: "edit", conteudo: { original_message_id: "wamid.FICTICIOORIGINAL2", message: { context: { id: "M0" }, type: "image", image: { caption: "Updated image caption", mime_type: "image/jpeg" } } } }),
        ],
      }),
    );
    expect(b.apagamentos).toEqual([{ original: "wamid.FICTICIOORIGINAL", direcao: "enviada_celular", origem: "tempo_real", cliente: BR, em: HORA_DO_AVISO }]);
    expect(b.edicoes).toMatchObject([{ original: "wamid.FICTICIOORIGINAL2", direcao: "enviada_celular", conteudo: { tipo: "imagem", texto: "Updated image caption", respostaA: null } }]);
  });

  it("tipos no eco além dos documentados ([não confirmado]) são lidos de forma genérica", () => {
    const b = bloco(avisoDeEcos({ ecos: [ecoDoAviso({ tipo: "audio", conteudo: { mime_type: "audio/ogg; codecs=opus" } }), ecoDoAviso({ id: "wamid.FICTICIO2", tipo: "location", conteudo: { latitude: 1 } })] }));
    expect(b.mensagens.map((m) => [m.direcao, m.conteudo.tipo])).toEqual([["enviada_celular", "audio"], ["enviada_celular", "localizacao"]]);
  });
});

describe("history (origem historico)", () => {
  const conversa = (mensagens: Record<string, unknown>[], o: { id?: string | null; waId?: string; bsuid?: string } = {}) => conversaDoHistorico({ ...o, mensagens });

  it("(a) direção: from da conversa → recebida; from da empresa → enviada_celular; from que não casa → descartada e desconhecidos +1", () => {
    const b = bloco(
      avisoDeHistorico({
        pedacos: [
          pedacoDoHistorico({
            conversas: [
              conversa([
                itemDoAviso({ id: "wamid.FICTICIO1", de: CANARIOS.waIdBr }),
                itemDoAviso({ id: "wamid.FICTICIO2", de: FICTICIOS.telefoneEmpresa, para: CANARIOS.waIdBr }),
                itemDoAviso({ id: "wamid.FICTICIO3", de: CANARIOS.waIdEstrangeiro }),
                itemDoAviso({ id: "wamid.FICTICIO4", de: null }),
              ]),
            ],
          }),
        ],
      }),
    );
    expect(b.mensagens.map((m) => [m.wamid, m.direcao, m.origem, m.cliente])).toEqual([
      ["wamid.FICTICIO1", "recebida", "historico", BR],
      ["wamid.FICTICIO2", "enviada_celular", "historico", BR],
    ]);
    expect(b.contagem).toEqual({ desconhecidos: 2 });
  });

  it("(a) display_phone_number com o nono dígito e from da empresa sem ele → enviada_celular (tolerância)", () => {
    const b = bloco(
      avisoDeHistorico({
        telefoneEmpresa: CANARIOS.waIdBr,
        pedacos: [pedacoDoHistorico({ conversas: [conversa([itemDoAviso({ de: CANARIOS.waIdBrSem9 })], { id: CANARIOS.waIdEstrangeiro })] })],
      }),
    );
    expect(b.mensagens.map((m) => [m.direcao, m.cliente])).toEqual([["enviada_celular", { waId: CANARIOS.waIdEstrangeiro, bsuid: null }]]);
  });

  it("(a) conversa com o celular sem o nono dígito: from com ele ainda é recebida", () => {
    const b = bloco(avisoDeHistorico({ pedacos: [pedacoDoHistorico({ conversas: [conversa([itemDoAviso({ de: CANARIOS.waIdBr })], { id: CANARIOS.waIdBrSem9 })] })] }));
    expect(b.mensagens.map((m) => [m.direcao, m.cliente.waId])).toEqual([["recebida", CANARIOS.waIdBrSem9]]);
  });

  it("(a) identidade pelo context (wa_id e user_id); sem from, from_user_id da conversa → recebida", () => {
    const b = bloco(
      avisoDeHistorico({
        pedacos: [pedacoDoHistorico({ conversas: [conversa([itemDoAviso({ de: null, deUsuario: CANARIOS.bsuid }), itemDoAviso({ id: "wamid.FICTICIO2", de: null, deUsuario: "US.13491208655302741918" })], { id: null, waId: CANARIOS.waIdBr, bsuid: CANARIOS.bsuid })] })],
      }),
    );
    expect(b.mensagens.map((m) => [m.direcao, m.cliente])).toEqual([["recebida", { waId: CANARIOS.waIdBr, bsuid: CANARIOS.bsuid }]]);
    expect(b.contagem).toEqual({ desconhecidos: 1 });
  });

  it("(a) threads[].id em forma de BSUID ([não confirmado]): a identidade é o BSUID; from_user_id dele → recebida; from da empresa → enviada_celular", () => {
    const b = bloco(
      avisoDeHistorico({
        pedacos: [pedacoDoHistorico({ conversas: [conversa([itemDoAviso({ de: null, deUsuario: CANARIOS.bsuid }), itemDoAviso({ id: "wamid.FICTICIO2", de: FICTICIOS.telefoneEmpresa })], { id: CANARIOS.bsuid })] })],
      }),
    );
    const soBsuid = { waId: null, bsuid: CANARIOS.bsuid };
    expect(b.mensagens.map((m) => [m.direcao, m.cliente])).toEqual([["recebida", soBsuid], ["enviada_celular", soBsuid]]);
    expect(b.contagem).toEqual({});
  });

  it("(a) o from da empresa decide antes do from_user_id ([não confirmado] se a Meta põe o BSUID do cliente na mensagem da empresa)", () => {
    const b = bloco(avisoDeHistorico({ pedacos: [pedacoDoHistorico({ conversas: [conversa([itemDoAviso({ de: FICTICIOS.telefoneEmpresa, deUsuario: CANARIOS.bsuid })], { bsuid: CANARIOS.bsuid })] })] }));
    expect(b.mensagens.map((m) => m.direcao)).toEqual(["enviada_celular"]);
  });

  it("(a) conversa sem identidade, ou display_phone_number inválido com mensagem da empresa: descartadas, desconhecidos +1 cada", () => {
    const b = bloco(
      avisoDeHistorico({
        telefoneEmpresa: "numero-torto",
        pedacos: [pedacoDoHistorico({ conversas: [conversa([itemDoAviso({ de: FICTICIOS.cliente })], { id: null }), conversa([itemDoAviso({ id: "wamid.FICTICIO2", de: FICTICIOS.telefoneEmpresa })]), "x"] })],
      }),
    );
    expect(b.mensagens).toEqual([]);
    expect(b.contagem).toEqual({ desconhecidos: 3 });
  });

  it("(a) media_placeholder vira midia_pendente; edição e apagamento no histórico com origem historico; history_context ignorado", () => {
    const b = bloco(
      avisoDeHistorico({
        pedacos: [
          pedacoDoHistorico({
            conversas: [
              conversa([
                itemDoAviso({ id: "wamid.FICTICIO1", tipo: "media_placeholder", extra: { history_context: { status: "PLAYED" } } }),
                itemDoAviso({ id: "wamid.FICTICIO2", tipo: "revoke", conteudo: { original_message_id: "wamid.FICTICIOORIGINAL" } }),
                itemDoAviso({ id: "wamid.FICTICIO3", tipo: "edit", conteudo: { original_message_id: "wamid.FICTICIOORIGINAL2", message: { type: "text", text: { body: "Editada fictícia" } } } }),
              ]),
            ],
          }),
        ],
      }),
    );
    expect(b.mensagens.map((m) => [m.conteudo.tipo, m.origem])).toEqual([["midia_pendente", "historico"]]);
    expect(b.apagamentos.map((a) => a.origem)).toEqual(["historico"]);
    expect(b.edicoes.map((e) => [e.origem, e.conteudo.texto])).toEqual([["historico", "Editada fictícia"]]);
    expect(JSON.stringify(b)).not.toContain("PLAYED");
  });

  it("(a) progresso: fica o maior progress do bloco, com a fase e a ordem dele; valores fora da forma", () => {
    const b = bloco(
      avisoDeHistorico({
        pedacos: [
          pedacoDoHistorico({ fase: 0, ordem: 3, progresso: 40, conversas: [] }),
          pedacoDoHistorico({ fase: 1, ordem: 1, progresso: 70, conversas: [] }),
          pedacoDoHistorico({ fase: 2, ordem: 2, progresso: 55, conversas: [] }),
        ],
      }),
    );
    expect(b.progresso).toEqual({ progresso: 70, fase: 1, ordem: 1 });
    const tortos = bloco(avisoDeHistorico({ pedacos: [{ metadata: { phase: 3, chunk_order: -1, progress: 100 }, threads: [] }, { metadata: { progress: 101 }, threads: [] }, { metadata: { progress: "100" }, threads: [] }] }));
    expect(tortos.progresso).toEqual({ progresso: 100, fase: null, ordem: null });
    expect(bloco(avisoDeHistorico({ pedacos: [{ metadata: { progress: 50.5, phase: 1 }, threads: [] }] })).progresso).toBeNull();
  });

  it("(b) mídia que chega depois: messages[] e message_echoes[] com origem historico", () => {
    const b = bloco(
      avisoDeHistorico({
        mensagens: [itemDoAviso({ tipo: "image", conteudo: { caption: "Legenda fictícia", mime_type: "image/jpeg", sha256: "sha-ficticio", id: "id-ficticio-da-midia" } })],
        ecos: [ecoDoAviso({ id: "wamid.FICTICIO2", tipo: "video", conteudo: { mime_type: "video/mp4" } })],
      }),
    );
    expect(b.mensagens.map((m) => [m.direcao, m.origem, m.conteudo.tipo, m.conteudo.texto])).toEqual([
      ["recebida", "historico", "imagem", "Legenda fictícia"],
      ["enviada_celular", "historico", "video", ""],
    ]);
    expect(b.progresso).toBeNull();
  });

  it("(b) mídia tardia em messages[] com from = telefone da empresa: descartada, desconhecidos +1, nenhuma mensagem", () => {
    const b = bloco(avisoDeHistorico({ mensagens: [itemDoAviso({ de: FICTICIOS.telefoneEmpresa, tipo: "image", conteudo: { mime_type: "image/jpeg" } })] }));
    expect(b.mensagens).toEqual([]);
    expect(b.contagem).toEqual({ desconhecidos: 1 });
    // Com o nono dígito de diferença também (a mesma tolerância da direção no histórico).
    const semNono = bloco(avisoDeHistorico({ telefoneEmpresa: CANARIOS.waIdBr, mensagens: [itemDoAviso({ de: CANARIOS.waIdBrSem9, tipo: "image", conteudo: { mime_type: "image/jpeg" } })] }));
    expect(semNono).toMatchObject({ mensagens: [], contagem: { desconhecidos: 1 } });
  });

  it("(c) 2593109 com o envelope completo ([não confirmado]) → historicoRecusado; outro código → desconhecidos", () => {
    const b = bloco(avisoDeHistoricoRecusado({ comEnvelope: true }));
    expect(b).toMatchObject({ campo: "history", wabaIds: [FICTICIOS.waba], numeroId: FICTICIOS.numero, historicoRecusado: true, contagem: {} });
    const outro = bloco(avisoDeHistorico({ pedacos: [{ errors: [{ code: 131000, title: "Fictício" }] }] }));
    expect(outro).toMatchObject({ historicoRecusado: false, contagem: { desconhecidos: 1 } });
  });

  it("(c) 2593109 sem o envelope (como o exemplo da referência): um bloco history sem wabaIds, com o numeroId da metadata", () => {
    // Cópia do exemplo da referência de history ("Chat history sharing declined").
    const exemplo = {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
      history: [{ errors: [ERRO_HISTORICO_RECUSADO] }],
    };
    expect(ler(exemplo)).toEqual({ ilegivel: false, contagem: {}, blocos: [expect.objectContaining({ campo: "history", wabaIds: [], numeroId: "106540352242922", historicoRecusado: true, mensagens: [] })] });
    expect(bloco(avisoDeHistoricoRecusado()).numeroId).toBe(FICTICIOS.numero);
  });

  it.each([
    ["sem messaging_product", { metadata: { phone_number_id: FICTICIOS.numero }, history: [{ errors: [ERRO_HISTORICO_RECUSADO] }] }],
    ["sem número", { messaging_product: "whatsapp", history: [{ errors: [ERRO_HISTORICO_RECUSADO] }] }],
    ["outro código", { messaging_product: "whatsapp", metadata: { phone_number_id: FICTICIOS.numero }, history: [{ errors: [{ code: 131000 }] }] }],
    ["com conversas", { messaging_product: "whatsapp", metadata: { phone_number_id: FICTICIOS.numero }, history: [{ errors: [ERRO_HISTORICO_RECUSADO], threads: [] }] }],
    ["history vazio", { messaging_product: "whatsapp", metadata: { phone_number_id: FICTICIOS.numero }, history: [] }],
    ["mensagens sem envelope", { messaging_product: "whatsapp", metadata: { phone_number_id: FICTICIOS.numero }, messages: [itemDoAviso()] }],
    ["entry sem object", { entry: [], messaging_product: "whatsapp", metadata: { phone_number_id: FICTICIOS.numero }, history: [{ errors: [ERRO_HISTORICO_RECUSADO] }] }],
  ])("outro corpo sem envelope (%s) → ilegível", (_, json) => {
    expect(lerAviso(json)).toEqual({ ilegivel: true });
  });

  it("phase ambígua não decide o fim: só progress", () => {
    expect(bloco(avisoDeHistorico({ pedacos: [pedacoDoHistorico({ fase: 2, progresso: 30, conversas: [] })] })).progresso).toEqual({ progresso: 30, fase: 2, ordem: 1 });
  });
});

describe("smb_app_state_sync (agenda do celular)", () => {
  it("add com full_name (ou first_name), remove sem nome; timestamp em número e em texto", () => {
    const segundos = Math.floor(MAIS_TARDE.getTime() / 1000);
    const b = bloco(
      avisoDeAgenda({
        itens: [
          itemDaAgenda(),
          itemDaAgenda({ telefone: CANARIOS.waIdEstrangeiro, nome: undefined, primeiroNome: "Primeiro Fictício", em: segundos }),
          itemDaAgenda({ acao: "remove", telefone: null, bsuid: CANARIOS.bsuid, em: String(segundos) }),
        ],
      }),
    );
    expect(b.agenda).toEqual([
      { acao: "add", cliente: BR, nome: CANARIOS.nomeAgenda, em: HORA_DO_AVISO },
      { acao: "add", cliente: { waId: CANARIOS.waIdEstrangeiro, bsuid: null }, nome: CANARIOS.nomeAgenda, em: MAIS_TARDE },
      { acao: "remove", cliente: { waId: null, bsuid: CANARIOS.bsuid }, nome: null, em: MAIS_TARDE },
    ]);
  });

  it("first_name quando falta full_name; nunca contact.name", () => {
    const soPrimeiro = { type: "contact", contact: { first_name: "Primeiro Fictício", name: "Nome Errado", phone_number: CANARIOS.waIdBr }, action: "add", metadata: { timestamp: "1792252800" } };
    const soName = { ...soPrimeiro, contact: { name: "Nome Errado", phone_number: CANARIOS.waIdBr } };
    const b = bloco(avisoDeAgenda({ itens: [soPrimeiro, soName] }));
    expect(b.agenda.map((a) => a.nome)).toEqual(["Primeiro Fictício"]);
    expect(b.contagem).toEqual({ ignorados: 1 });
    expect(JSON.stringify(b)).not.toContain("Nome Errado");
  });

  it("outro type e item sem identidade → ignorados; ação desconhecida, hora inválida ou item fora da forma → desconhecidos", () => {
    const b = bloco(
      avisoDeAgenda({
        itens: [
          { ...itemDaAgenda(), type: "label" },
          itemDaAgenda({ telefone: null }),
          { ...itemDaAgenda(), action: "edit" },
          { ...itemDaAgenda(), metadata: { timestamp: "ontem" } },
          "x",
        ],
      }),
    );
    expect(b.agenda).toEqual([]);
    expect(b.contagem).toEqual({ ignorados: 2, desconhecidos: 3 });
  });

  it("bloco de agenda sem itens ainda é um bloco (a gravação marca que a agenda chegou)", () => {
    expect(bloco(avisoDeAgenda({ itens: [] }))).toMatchObject({ campo: "smb_app_state_sync", agenda: [], contagem: {} });
  });
});

describe("account_update", () => {
  it("entry.id (parceiro) diferente de waba_info.waba_id: as duas, sem repetir (T17)", () => {
    const b = bloco(avisoDeConta({ evento: "PARTNER_ADDED" }));
    expect(b.wabaIds).toEqual([FICTICIOS.outraWaba, FICTICIOS.waba]);
    expect(b.conta).toEqual({ evento: "PARTNER_ADDED", wabaIds: [FICTICIOS.outraWaba, FICTICIOS.waba], em: HORA_DO_AVISO, motivo: null, iniciadoPor: null, banimento: null });
    expect(bloco(avisoDeConta({ evento: "PARTNER_ADDED", entrada: FICTICIOS.waba })).wabaIds).toEqual([FICTICIOS.waba]);
  });

  it("o envelope da página de coexistência (PARTNER_REMOVED com entry.id = WABA, sem waba_info, com disconnection_info)", () => {
    // Cópia do exemplo da página de coexistência (embedded-signup, "Onboarding WhatsApp Business app users").
    const exemplo = {
      object: "whatsapp_business_account",
      entry: [{ id: "102290129340398", time: 1739212624, changes: [{ value: { phone_number: "15550783881", event: "PARTNER_REMOVED", disconnection_info: { reason: "PRIMARY_INACTIVITY", initiated_by: "SYSTEM" } }, field: "account_update" }] }],
    };
    const b = bloco(exemplo);
    expect(b.wabaIds).toEqual(["102290129340398"]);
    expect(b.conta).toEqual({ evento: "PARTNER_REMOVED", wabaIds: ["102290129340398"], em: new Date("2025-02-10T18:37:04Z"), motivo: "PRIMARY_INACTIVITY", iniciadoPor: "SYSTEM", banimento: null });
    expect(JSON.stringify(b)).not.toContain("15550783881");
  });

  it("entry.time em número e em texto; sem entry.time válido → desconhecidos, sem conta", () => {
    const segundos = Math.floor(HORA_DO_AVISO.getTime() / 1000);
    expect(bloco(avisoDeConta({ evento: "ACCOUNT_DELETED", em: segundos })).conta?.em).toEqual(HORA_DO_AVISO);
    expect(bloco(avisoDeConta({ evento: "ACCOUNT_DELETED", em: String(segundos) })).conta?.em).toEqual(HORA_DO_AVISO);
    expect(bloco(avisoDeConta({ evento: "ACCOUNT_DELETED", em: null }))).toMatchObject({ conta: null, contagem: { desconhecidos: 1 } });
    expect(bloco(avisoDeConta({ evento: "ACCOUNT_DELETED", em: "ontem" }))).toMatchObject({ conta: null, contagem: { desconhecidos: 1 } });
  });

  it("motivo, iniciado por e estado de banimento: da lista ou null", () => {
    const b = bloco(avisoDeConta({ evento: "PARTNER_REMOVED", motivo: "CHANGE_NUMBER", iniciadoPor: "USER" }));
    expect(b.conta).toMatchObject({ motivo: "CHANGE_NUMBER", iniciadoPor: "USER", banimento: null });
    const torto = bloco(avisoDeConta({ evento: "PARTNER_REMOVED", motivo: "MOTIVO_NOVO", iniciadoPor: "ADMIN" }));
    expect(torto.conta).toMatchObject({ motivo: null, iniciadoPor: null });
    expect(bloco(avisoDeConta({ evento: "DISABLED_UPDATE", banimento: "SCHEDULE_FOR_DISABLE" })).conta?.banimento).toBe("SCHEDULE_FOR_DISABLE");
    expect(bloco(avisoDeConta({ evento: "DISABLED_UPDATE", banimento: "BANIDO" })).conta?.banimento).toBeNull();
  });

  it.each(EVENTOS_CONTA_SEM_EFEITO.map((e) => [e]))("%s (documentado, sem efeito aqui) → ignorados, sem conta", (evento) => {
    expect(bloco(avisoDeConta({ evento }))).toMatchObject({ conta: null, contagem: { ignorados: 1 } });
  });

  it("evento fora das duas listas → desconhecidos, sem conta", () => {
    expect(bloco(avisoDeConta({ evento: "EVENTO_NOVO_FICTICIO" }))).toMatchObject({ conta: null, contagem: { desconhecidos: 1 } });
    expect(bloco(avisoDeConta({ evento: "partner_added" }))).toMatchObject({ conta: null, contagem: { desconhecidos: 1 } });
  });

  it("waba_info.waba_id inválido é ignorado; não lê owner_business_id, restriction_info nem violation_info", () => {
    const corpo = avisoDeConta({ evento: "ACCOUNT_RESTRICTION", wabaInfo: "waba-torta" }) as { entry: { changes: { value: Record<string, unknown> }[] }[] };
    Object.assign(corpo.entry[0].changes[0].value, { restriction_info: [{ restriction_type: "RESTRICTED_FICTICIO" }], violation_info: { violation_type: "VIOLACAO_FICTICIA" } });
    (corpo.entry[0].changes[0].value.waba_info as Record<string, unknown>).owner_business_id = "dono-ficticio";
    const b = bloco(corpo);
    expect(b.wabaIds).toEqual([FICTICIOS.outraWaba]);
    const saida = JSON.stringify(b);
    for (const proibido of ["RESTRICTED_FICTICIO", "VIOLACAO_FICTICIA", "dono-ficticio"]) expect(saida).not.toContain(proibido);
  });
});

describe("vários blocos e privacidade da saída", () => {
  it("cada change é um bloco, na ordem do corpo; a contagem fica em cada bloco", () => {
    const a = ler(juntarCorpos(avisoDeMensagens({ statuses: [{}] }), avisoDeEcos(), avisoDeConta({ evento: "PARTNER_APP_INSTALLED" })));
    expect(a.blocos.map((b) => [b.campo, b.contagem])).toEqual([
      ["messages", { ignorados: 1 }],
      ["smb_message_echoes", {}],
      ["account_update", { ignorados: 1 }],
    ]);
  });

  it("a saída nunca contém url, sha256, id de mídia, filename, coordenadas, system.body nem telefones de contato compartilhado", () => {
    const corpo = juntarCorpos(
      avisoDeMensagens({
        mensagens: [
          itemDoAviso({ tipo: "document", conteudo: { filename: "arquivo-ficticio.pdf", mime_type: "application/pdf", sha256: "sha-ficticio-da-midia", id: "id-ficticio-da-midia", url: "https://example.invalid/doc" } }),
          itemDoAviso({ id: "wamid.FICTICIO2", tipo: "location", conteudo: { latitude: -22.9876, longitude: -43.2101 } }),
          itemDoAviso({ id: "wamid.FICTICIO3", tipo: "contacts", conteudo: [{ phones: [{ phone: "+1 650 555 0199", wa_id: COMPARTILHADO }] }] }),
          itemDoAviso({ id: "wamid.FICTICIO4", tipo: "system", conteudo: { body: "Corpo de sistema fictício", type: "user_changed_number", previous_user_id: CANARIOS.bsuid } }),
        ],
      }),
      avisoDeHistorico({ mensagens: [itemDoAviso({ id: "wamid.FICTICIO5", tipo: "image", conteudo: { url: "https://example.invalid/img", sha256: "sha-ficticio-da-midia" } })] }),
    );
    const saida = JSON.stringify(ler(corpo));
    for (const proibido of ["arquivo-ficticio", "sha-ficticio", "id-ficticio-da-midia", "example.invalid", "22.9876", "43.2101", "555 0199", COMPARTILHADO, "Corpo de sistema"]) {
      expect(saida).not.toContain(proibido);
    }
  });
});
