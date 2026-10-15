import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { salvarEmpresa } from "@/configuracoes/empresa";
import { auditoria, organizacoes, pedidosContatoProprietario, tentativasLogin, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { type Correio, CorreioMemoria } from "@/email/correio";
import { ERRO_AUTORIZACAO_MUDOU, TEXTOS_AUTORIZACAO, textoDaAutorizacao } from "./autorizacao";
import {
  arquivarPedido,
  avisarEquipe,
  contarPedidosNovos,
  type DadosPedidoContato,
  descreverQuartos,
  ERRO_LIMITE_ORIGEM,
  ERRO_LIMITE_POR_EMAIL,
  ERRO_LIMITE_TOTAL,
  LIMITE_POR_ORIGEM,
  LIMITE_TENTATIVAS_GERAL,
  listarPedidosContato,
  marcarRespondido,
  MAX_POR_EMAIL_POR_DIA,
  MAX_POR_HORA,
  NOVOS_POR_PAGINA,
  preencheuIsca,
  registrarPedidoContato,
  validarPedidoContato,
} from "./pedidos-contato";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outra: string;
let ana: string;
const agora = new Date("2026-10-08T15:00:00Z");
const depois = new Date("2026-10-09T12:00:00Z");
/** Marca do texto da caixa que a página mostra, com o nome de cada empresa fictícia (M7.14). */
const marca = (empresa = "Sua Casa Exemplo") => textoDaAutorizacao("contato", empresa).marca;
const MARCA_OUTRA = marca("Outra Empresa");
const TEXTO_V1 = "Autorizo o uso destes dados só para a Sua Casa Exemplo me responder sobre a gestão do imóvel.";

const form = (over: Record<string, unknown> = {}) => ({
  nome: "Maria Exemplo",
  email: "  Maria@Exemplo.COM ",
  telefone: "(21) 90000-0000",
  bairro: "Ipanema",
  cidade: "Rio de Janeiro",
  quartos: "2",
  anunciaHoje: "sim",
  mensagem: "Apartamento fictício, perto da praia.\r\nPodem ligar à tarde.",
  consentimento: "on",
  autorizacao: marca(),
  ...over,
});

const dados = (over: Partial<DadosPedidoContato> = {}): DadosPedidoContato => ({
  nome: "Maria Exemplo",
  email: "maria@exemplo.com",
  telefone: "(21) 90000-0000",
  bairro: "Ipanema",
  cidade: "Rio de Janeiro",
  quartos: 2,
  anunciaHoje: true,
  mensagem: "",
  marcaAutorizacao: marca(),
  ...over,
});

async function registrar(over: Partial<DadosPedidoContato> = {}, organizacaoId = org, quando = agora) {
  const r = await registrarPedidoContato(db, organizacaoId, dados(over), quando);
  if (!r.ok) throw new Error(r.erro);
  return r.pedido;
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }, { id: outra }] = await db.insert(organizacoes).values([{ nome: "Sua Casa Exemplo" }, { nome: "Outra Empresa" }]).returning();
  [{ id: ana }] = await db.insert(usuarios).values({ organizacaoId: org, email: "ana@exemplo.com", nome: "Ana Equipe", papel: "admin" }).returning();
});
afterEach(() => close());

describe("formulário do pedido de contato (M7.7)", () => {
  it("aceita o formulário completo: e-mail em minúsculas, mensagem com quebras normalizadas", () => {
    expect(validarPedidoContato(form())).toEqual({
      ok: true,
      dados: {
        nome: "Maria Exemplo",
        email: "maria@exemplo.com",
        telefone: "(21) 90000-0000",
        bairro: "Ipanema",
        cidade: "Rio de Janeiro",
        quartos: 2,
        anunciaHoje: true,
        mensagem: "Apartamento fictício, perto da praia.\nPodem ligar à tarde.",
        marcaAutorizacao: marca(),
      },
    });
  });

  it("quartos, \"já anuncia\" e mensagem são opcionais; studio é 0 e \"não\" é false", () => {
    expect(validarPedidoContato(form({ quartos: "", anunciaHoje: "", mensagem: "" }))).toMatchObject({ ok: true, dados: { quartos: null, anunciaHoje: null, mensagem: "" } });
    expect(validarPedidoContato(form({ quartos: "0", anunciaHoje: "nao" }))).toMatchObject({ ok: true, dados: { quartos: 0, anunciaHoje: false } });
    expect(validarPedidoContato(form({ quartos: "10" }))).toMatchObject({ ok: true, dados: { quartos: 10 } });
  });

  it("aponta cada campo com problema, pelo nome do campo do formulário", () => {
    const r = validarPedidoContato({ email: "sem-arroba", telefone: "1234", quartos: "11", anunciaHoje: "talvez", mensagem: "x".repeat(2001) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros).toEqual({
      nome: "Informe seu nome.",
      email: expect.stringContaining("E-mail inválido"),
      telefone: expect.stringContaining("Telefone com DDD"),
      bairro: "Informe o bairro do imóvel.",
      cidade: "Informe a cidade.",
      quartos: expect.any(String),
      anunciaHoje: expect.any(String),
      mensagem: "Máximo de 2000 caracteres.",
      consentimento: "É preciso autorizar o uso dos dados para a gente responder.",
    });
  });

  it("limites de tamanho e formatos de telefone", () => {
    const erros = (over: Record<string, unknown>) => {
      const r = validarPedidoContato(form(over));
      return r.ok ? {} : r.erros;
    };
    expect(erros({ nome: "x".repeat(151) }).nome).toBe("Máximo de 150 caracteres.");
    expect(erros({ email: `${"x".repeat(195)}@ex.com` }).email).toBe("Máximo de 200 caracteres.");
    expect(erros({ email: "" }).email).toBe("Informe seu e-mail.");
    expect(erros({ bairro: "x".repeat(81) }).bairro).toBe("Máximo de 80 caracteres.");
    expect(erros({ cidade: "x".repeat(81) }).cidade).toBe("Máximo de 80 caracteres.");
    expect(erros({ quartos: "-1" }).quartos).toBeDefined();
    expect(erros({ quartos: "2.5" }).quartos).toBeDefined();
    // Mesma regra do cadastro do marketplace: DDD obrigatório, 10 a 13 dígitos, sem letras.
    expect(erros({ telefone: "+55 21 90000-0000" })).toEqual({});
    expect(erros({ telefone: "21 3000-0000" })).toEqual({});
    expect(erros({ telefone: "90000-0000" }).telefone).toBeDefined();
    expect(erros({ telefone: "21 9000O-0000" }).telefone).toBeDefined();
    expect(erros({ telefone: "" }).telefone).toBeDefined();
    expect(erros({ consentimento: "" }).consentimento).toBeDefined();
  });

  it("campo-isca: só conta quando preenchido", () => {
    expect(preencheuIsca(form())).toBe(false);
    expect(preencheuIsca(form({ site: "  " }))).toBe(false);
    expect(preencheuIsca(form({ site: "https://spam.example" }))).toBe(true);
  });

  it("descreve os quartos como o formulário oferece", () => {
    expect([null, 0, 1, 2, 4, 6].map(descreverQuartos)).toEqual(["Não informado", "Studio", "1 quarto", "2 quartos", "4 ou mais quartos", "6 quartos"]);
  });
});

describe("registro e tetos", () => {
  it("grava como novo, sem tocar em outra organização", async () => {
    const p = await registrar({ email: "Maria@Exemplo.com" });
    expect(p).toMatchObject({ organizacaoId: org, situacao: "novo", email: "maria@exemplo.com", nota: "", decididoEm: null, decididoPor: null, criadoEm: agora });
    expect(await contarPedidosNovos(db, org)).toBe(1);
    expect(await contarPedidosNovos(db, outra)).toBe(0);
    expect((await listarPedidosContato(db, outra)).novos).toEqual([]);
  });

  it(`no máximo ${MAX_POR_EMAIL_POR_DIA} pedidos por e-mail em 24 horas; passado o dia, volta (ninguém fica bloqueado por spam com o seu e-mail)`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_POR_EMAIL_POR_DIA; i++) ids.push((await registrar()).id);
    expect(await registrarPedidoContato(db, org, dados({ email: "MARIA@exemplo.com" }), agora)).toEqual({ ok: false, erro: ERRO_LIMITE_POR_EMAIL });
    // Outro e-mail e outra organização seguem livres.
    expect((await registrarPedidoContato(db, org, dados({ email: "joao@exemplo.com" }), agora)).ok).toBe(true);
    expect((await registrarPedidoContato(db, outra, dados({ marcaAutorizacao: MARCA_OUTRA }), agora)).ok).toBe(true);
    // Tratar os pedidos não muda a conta do dia; o tempo, sim: 24 horas depois do mais recente, o e-mail volta.
    expect(await marcarRespondido(db, org, ids[0], "", ana, depois)).toEqual({ ok: true });
    expect(await registrarPedidoContato(db, org, dados(), new Date(agora.getTime() + 23 * 60 * 60_000))).toEqual({ ok: false, erro: ERRO_LIMITE_POR_EMAIL });
    expect((await registrarPedidoContato(db, org, dados(), new Date(agora.getTime() + 24 * 60 * 60_000 + 60_000))).ok).toBe(true);
  });

  it(`no máximo ${MAX_POR_HORA} pedidos por hora na organização; passada a hora, volta a receber sem ninguém arquivar nada`, async () => {
    const antes = new Date(agora.getTime() - 61 * 60_000);
    // Pedidos antigos (mesmo ainda "novos") não contam: spam de ontem não trava o formulário de hoje.
    await db.insert(pedidosContatoProprietario).values(Array.from({ length: MAX_POR_HORA }, (_, i) => ({ organizacaoId: org, ...dados({ email: `velho${i}@exemplo.com` }), criadoEm: antes })));
    expect((await registrarPedidoContato(db, org, dados({ email: "primeira@exemplo.com" }), agora)).ok).toBe(true);
    await db.insert(pedidosContatoProprietario).values(
      Array.from({ length: MAX_POR_HORA - 1 }, (_, i) => ({ organizacaoId: org, ...dados({ email: `pessoa${i}@exemplo.com` }), criadoEm: new Date(agora.getTime() - 30 * 60_000) })),
    );
    expect(await registrarPedidoContato(db, org, dados({ email: "nova@exemplo.com" }), agora)).toEqual({ ok: false, erro: ERRO_LIMITE_TOTAL });
    expect((await registrarPedidoContato(db, outra, dados({ marcaAutorizacao: MARCA_OUTRA }), agora)).ok).toBe(true);
    // Uma hora depois do mais recente, a janela passou.
    expect((await registrarPedidoContato(db, org, dados({ email: "nova@exemplo.com" }), new Date(agora.getTime() + 61 * 60_000))).ok).toBe(true);
  });

  it(`no máximo ${LIMITE_POR_ORIGEM.tentativas} pedidos por hora do mesmo endereço de origem; outro endereço segue livre`, async () => {
    for (let i = 0; i < LIMITE_POR_ORIGEM.tentativas; i++) expect((await registrarPedidoContato(db, org, dados({ email: `p${i}@exemplo.com` }), agora, "203.0.113.7")).ok).toBe(true);
    expect(await registrarPedidoContato(db, org, dados({ email: "outro@exemplo.com" }), agora, "203.0.113.7")).toEqual({ ok: false, erro: ERRO_LIMITE_ORIGEM });
    expect((await registrarPedidoContato(db, org, dados({ email: "outro@exemplo.com" }), agora, "198.51.100.9")).ok).toBe(true);
    // Passada a hora, o mesmo endereço volta a poder enviar.
    expect((await registrarPedidoContato(db, org, dados({ email: "depois@exemplo.com" }), new Date(agora.getTime() + 61 * 60_000), "203.0.113.7")).ok).toBe(true);
    // O pedido não guarda o endereço.
    expect(JSON.stringify(await db.select().from(pedidosContatoProprietario))).not.toContain("203.0.113.7");
  });

  it(`no máximo ${LIMITE_TENTATIVAS_GERAL.tentativas} tentativas por hora no total, antes de contar a origem; a limpeza das contas velhas roda uma vez por hora`, async () => {
    // Conta parada há mais de um dia (de uma origem qualquer): sai na primeira tentativa da janela geral.
    await db.insert(tentativasLogin).values({ chave: `contato-origem:${org}:192.0.2.1`, erros: 2, atualizadoEm: new Date(agora.getTime() - 25 * 60 * 60_000) });
    await db.insert(tentativasLogin).values({ chave: `contato-geral:${org}`, erros: LIMITE_TENTATIVAS_GERAL.tentativas, atualizadoEm: new Date(agora.getTime() - 10 * 60_000) });
    // Janela geral ainda aberta e no teto: recusa sem criar conta para a origem nova e sem limpar.
    expect(await registrarPedidoContato(db, org, dados({ email: "x@exemplo.com" }), agora, "198.51.100.20")).toEqual({ ok: false, erro: ERRO_LIMITE_TOTAL });
    const chaves = async () => (await db.select({ chave: tentativasLogin.chave }).from(tentativasLogin)).map((t) => t.chave).sort();
    expect(await chaves()).toEqual([`contato-geral:${org}`, `contato-origem:${org}:192.0.2.1`]);
    // Uma hora depois, a janela geral recomeça: limpa a conta velha e aceita.
    const depoisDaHora = new Date(agora.getTime() + 60 * 60_000);
    expect((await registrarPedidoContato(db, org, dados({ email: "x@exemplo.com" }), depoisDaHora, "198.51.100.20")).ok).toBe(true);
    expect(await chaves()).toEqual([`contato-geral:${org}`, `contato-origem:${org}:198.51.100.20`]);
    // Outra organização tem as suas próprias contas: o teto de uma não gasta o da outra.
    await db.update(tentativasLogin).set({ erros: LIMITE_TENTATIVAS_GERAL.tentativas + 5 }).where(eq(tentativasLogin.chave, `contato-geral:${org}`));
    expect((await registrarPedidoContato(db, outra, dados({ email: "x@exemplo.com", marcaAutorizacao: MARCA_OUTRA }), depoisDaHora, "198.51.100.20")).ok).toBe(true);
    expect(await registrarPedidoContato(db, org, dados({ email: "y@exemplo.com" }), depoisDaHora, "198.51.100.21")).toEqual({ ok: false, erro: ERRO_LIMITE_TOTAL });
  });

  it("envios simultâneos do mesmo e-mail não passam do teto", async () => {
    const rs = await Promise.all(Array.from({ length: MAX_POR_EMAIL_POR_DIA + 3 }, () => registrarPedidoContato(db, org, dados(), agora)));
    expect(rs.filter((r) => r.ok)).toHaveLength(MAX_POR_EMAIL_POR_DIA);
    expect(await contarPedidosNovos(db, org)).toBe(MAX_POR_EMAIL_POR_DIA);
  });
});

describe("registro da autorização (M7.14)", () => {
  const linhas = () => db.select().from(pedidosContatoProprietario);

  it("grava quando, a versão e o texto da caixa no mesmo insert do pedido, com o nome da empresa do envio", async () => {
    const v = validarPedidoContato(form());
    if (!v.ok) throw new Error("form inválido");
    const r = await registrarPedidoContato(db, org, v.dados, agora);
    expect(r).toMatchObject({ ok: true, pedido: { autorizadoEm: agora, autorizacaoVersao: 1, autorizacaoTexto: TEXTO_V1, criadoEm: agora } });
    expect(await linhas()).toEqual([expect.objectContaining({ autorizadoEm: agora, autorizacaoVersao: 1, autorizacaoTexto: TEXTO_V1 })]);
    // A outra organização grava com o nome dela.
    expect(await registrarPedidoContato(db, outra, dados({ marcaAutorizacao: MARCA_OUTRA }), agora)).toMatchObject({
      ok: true,
      pedido: { autorizacaoTexto: "Autorizo o uso destes dados só para a Outra Empresa me responder sobre a gestão do imóvel." },
    });
  });

  it("o texto gravado vem do servidor: texto mandado pelo navegador é ignorado, e marca que não é a do texto atual é recusada sem gravar", async () => {
    // Um campo com texto qualquer não entra em lugar nenhum.
    const v = validarPedidoContato(form({ autorizacaoTexto: "Autorizo tudo (texto forjado)", autorizacao_texto: "forjado" }));
    if (!v.ok) throw new Error("form inválido");
    expect(await registrarPedidoContato(db, org, v.dados, agora)).toMatchObject({ ok: true, pedido: { autorizacaoTexto: TEXTO_V1 } });
    expect(JSON.stringify(await linhas())).not.toContain("forjado");
    // O texto no lugar da marca, uma marca qualquer ou nenhuma: recusa, devolve o texto atual e não grava.
    for (const enviada of [TEXTO_V1, "v1.qualquer", ""]) {
      const w = validarPedidoContato(form({ email: "outra@exemplo.com", autorizacao: enviada }));
      if (!w.ok) throw new Error("form inválido");
      expect(await registrarPedidoContato(db, org, w.dados, agora)).toEqual({ ok: false, erro: ERRO_AUTORIZACAO_MUDOU, autorizacao: textoDaAutorizacao("contato", "Sua Casa Exemplo") });
    }
    const sem = validarPedidoContato(form({ email: "sem@exemplo.com", autorizacao: undefined }));
    if (!sem.ok) throw new Error("form inválido");
    expect(sem.dados.marcaAutorizacao).toBe("");
    expect(await registrarPedidoContato(db, org, sem.dados, agora)).toMatchObject({ ok: false, erro: ERRO_AUTORIZACAO_MUDOU });
    expect(await linhas()).toHaveLength(1);
  });

  it("nome da empresa mudou depois que a página abriu: recusa com o texto novo; marcando de novo, grava o texto novo", async () => {
    await salvarEmpresa(db, org, { nome: "Casa Nova Exemplo", razaoSocial: "", cnpj: "", email: "", telefone: "", endereco: "", encarregado: "", site: "", chavePix: "" }, null);
    const r = await registrarPedidoContato(db, org, dados(), agora);
    const novo = "Autorizo o uso destes dados só para a Casa Nova Exemplo me responder sobre a gestão do imóvel.";
    expect(r).toEqual({ ok: false, erro: ERRO_AUTORIZACAO_MUDOU, autorizacao: { versao: 1, texto: novo, marca: marca("Casa Nova Exemplo") } });
    expect(await linhas()).toEqual([]);
    expect(await registrarPedidoContato(db, org, dados({ marcaAutorizacao: marca("Casa Nova Exemplo") }), agora)).toMatchObject({ ok: true, pedido: { autorizacaoTexto: novo } });
  });

  it("versão nova do texto (ou nome novo da empresa) não muda os registros antigos", async () => {
    const antigo = await registrar();
    const definicao = TEXTOS_AUTORIZACAO.contato;
    const marcaV1 = marca();
    // Simula uma versão nova no código.
    TEXTOS_AUTORIZACAO.contato = { versao: 2, modelo: "Texto fictício da versão 2: autorizo a {empresa} a me responder." };
    try {
      // A marca da versão 1 deixa de valer.
      expect(await registrarPedidoContato(db, org, dados({ email: "v1@exemplo.com", marcaAutorizacao: marcaV1 }), depois)).toMatchObject({ ok: false, erro: ERRO_AUTORIZACAO_MUDOU, autorizacao: { versao: 2 } });
      const v2 = await registrar({ email: "v2@exemplo.com", marcaAutorizacao: marca() }, org, depois);
      expect(v2).toMatchObject({ autorizacaoVersao: 2, autorizacaoTexto: "Texto fictício da versão 2: autorizo a Sua Casa Exemplo a me responder.", autorizadoEm: depois });
    } finally {
      TEXTOS_AUTORIZACAO.contato = definicao;
    }
    await salvarEmpresa(db, org, { nome: "Casa Nova Exemplo", razaoSocial: "", cnpj: "", email: "", telefone: "", endereco: "", encarregado: "", site: "", chavePix: "" }, null);
    const { novos } = await listarPedidosContato(db, org);
    expect(novos.find((p) => p.id === antigo.id)).toMatchObject({ autorizadoEm: agora, autorizacaoVersao: 1, autorizacaoTexto: TEXTO_V1 });
  });

  it("recusa sem a caixa marcada: o formulário volta com o erro e nada chega a ser gravado", () => {
    for (const consentimento of ["", "off", undefined]) {
      const r = validarPedidoContato(form({ consentimento }));
      expect(r).toEqual({ ok: false, erros: { consentimento: "É preciso autorizar o uso dos dados para a gente responder." } });
    }
  });

  it("o banco não aceita registro pela metade (os três juntos ou nenhum); pedido sem registro continua valendo", async () => {
    // Gravado direto, como nos outros testes (a marca do formulário não é coluna: fica de fora do insert).
    const semMarca = dados();
    await expect(db.insert(pedidosContatoProprietario).values({ organizacaoId: org, ...semMarca, autorizadoEm: agora })).rejects.toThrow();
    await expect(db.insert(pedidosContatoProprietario).values({ organizacaoId: org, ...semMarca, autorizadoEm: agora, autorizacaoVersao: 1, autorizacaoTexto: "" })).rejects.toThrow();
    await expect(db.insert(pedidosContatoProprietario).values({ organizacaoId: org, ...semMarca, autorizadoEm: agora, autorizacaoVersao: 0, autorizacaoTexto: TEXTO_V1 })).rejects.toThrow();
    // Como os pedidos de antes deste item: sem nenhum dos três.
    const [velho] = await db.insert(pedidosContatoProprietario).values({ organizacaoId: org, ...semMarca }).returning();
    expect(velho).toMatchObject({ autorizadoEm: null, autorizacaoVersao: null, autorizacaoTexto: null });
  });
});

describe("tratamento no painel", () => {
  it(`novos em páginas de ${NOVOS_POR_PAGINA}, dos mais antigos para os mais novos, com o total`, async () => {
    const base = agora.getTime() - 2 * 60 * 60_000;
    await db.insert(pedidosContatoProprietario).values(
      Array.from({ length: NOVOS_POR_PAGINA + 5 }, (_, i) => ({ organizacaoId: org, ...dados({ email: `fila${i}@exemplo.com` }), criadoEm: new Date(base + i * 1000) })),
    );
    const p1 = await listarPedidosContato(db, org);
    expect(p1.totalNovos).toBe(NOVOS_POR_PAGINA + 5);
    expect(p1.novos).toHaveLength(NOVOS_POR_PAGINA);
    expect(p1.novos[0].email).toBe("fila0@exemplo.com");
    const p2 = await listarPedidosContato(db, org, 2);
    expect(p2.novos.map((p) => p.email)).toEqual(Array.from({ length: 5 }, (_, i) => `fila${NOVOS_POR_PAGINA + i}@exemplo.com`));
    expect((await listarPedidosContato(db, org, 9)).novos).toEqual([]);
    expect((await listarPedidosContato(db, org, 0)).novos).toHaveLength(NOVOS_POR_PAGINA);
  });

  it("lista novos do mais antigo para o mais novo e os tratados do mais recente, com quem tratou", async () => {
    const velho = await registrar({ nome: "Primeiro" }, org, new Date("2026-10-01T10:00:00Z"));
    const novo = await registrar({ nome: "Segundo", email: "segundo@exemplo.com" }, org, new Date("2026-10-05T10:00:00Z"));
    const terceiro = await registrar({ nome: "Terceiro", email: "terceiro@exemplo.com" }, org, new Date("2026-10-06T10:00:00Z"));
    const quarto = await registrar({ nome: "Quarto", email: "quarto@exemplo.com" }, org, new Date("2026-10-07T10:00:00Z"));
    expect((await listarPedidosContato(db, org)).novos.map((p) => p.nome)).toEqual(["Primeiro", "Segundo", "Terceiro", "Quarto"]);

    expect(await marcarRespondido(db, org, terceiro.id, "  Liguei, vai mandar fotos.  ", ana, new Date("2026-10-08T10:00:00Z"))).toEqual({ ok: true });
    expect(await arquivarPedido(db, org, velho.id, "", null, new Date("2026-10-09T10:00:00Z"))).toEqual({ ok: true });
    const { novos, decididos } = await listarPedidosContato(db, org);
    expect(novos.map((p) => p.id)).toEqual([novo.id, quarto.id]);
    expect(decididos.map((p) => [p.nome, p.situacao, p.decididoPorNome, p.nota])).toEqual([
      ["Primeiro", "arquivado", null, ""],
      ["Terceiro", "respondido", "Ana Equipe", "Liguei, vai mandar fotos."],
    ]);
    expect(decididos[1].decididoEm).toEqual(new Date("2026-10-08T10:00:00Z"));
    expect(await contarPedidosNovos(db, org)).toBe(2);
  });

  it("respondido só sai de novo; arquivar vale de novo ou de respondido e soma a nota", async () => {
    const p = await registrar();
    expect(await marcarRespondido(db, org, p.id, "Primeira conversa.", ana, agora)).toEqual({ ok: true });
    expect(await marcarRespondido(db, org, p.id, "", ana, depois)).toEqual({ ok: false, erro: "nao-encontrado" });
    expect(await arquivarPedido(db, org, p.id, "Não quis seguir.", ana, depois)).toEqual({ ok: true });
    const [salvo] = await db.select().from(pedidosContatoProprietario).where(eq(pedidosContatoProprietario.id, p.id));
    expect(salvo).toMatchObject({ situacao: "arquivado", nota: "Primeira conversa.\nNão quis seguir.", decididoEm: depois, decididoPor: ana });
    expect(await arquivarPedido(db, org, p.id, "", ana, depois)).toEqual({ ok: false, erro: "nao-encontrado" });
    expect(await marcarRespondido(db, org, p.id, "", ana, depois)).toEqual({ ok: false, erro: "nao-encontrado" });
  });

  it("id inválido, de outra organização ou nota longa: nada muda", async () => {
    const p = await registrar();
    expect(await marcarRespondido(db, org, "nao-e-uuid", "", ana, agora)).toEqual({ ok: false, erro: "nao-encontrado" });
    expect(await marcarRespondido(db, outra, p.id, "", ana, agora)).toEqual({ ok: false, erro: "nao-encontrado" });
    expect(await arquivarPedido(db, outra, p.id, "", ana, agora)).toEqual({ ok: false, erro: "nao-encontrado" });
    expect(await marcarRespondido(db, org, p.id, "x".repeat(501), ana, agora)).toEqual({ ok: false, erro: "nota-longa" });
    const [salvo] = await db.select().from(pedidosContatoProprietario).where(eq(pedidosContatoProprietario.id, p.id));
    expect(salvo).toMatchObject({ situacao: "novo", nota: "", decididoEm: null });
    expect(await db.select().from(auditoria)).toEqual([]);
  });

  it("o histórico registra só a mudança de situação, sem dados da pessoa nem a nota", async () => {
    const p = await registrar({ mensagem: "Mensagem fictícia" });
    await marcarRespondido(db, org, p.id, "Nota com telefone 21 90000-0000", ana, agora);
    await arquivarPedido(db, org, p.id, "", ana, depois);
    const registros = await db.select().from(auditoria).where(eq(auditoria.entidadeId, p.id));
    expect(registros.map((r) => [r.acao, r.entidade, r.usuarioId, r.mudancas])).toEqual([
      ["pedido_contato.responder", "pedido_contato_proprietario", ana, { situacao: ["novo", "respondido"] }],
      ["pedido_contato.arquivar", "pedido_contato_proprietario", ana, { situacao: ["respondido", "arquivado"] }],
    ]);
    const texto = JSON.stringify(registros);
    for (const dado of ["maria@exemplo.com", "90000", "Mensagem fictícia", "Maria"]) expect(texto).not.toContain(dado);
  });

  it("usuário apagado não apaga o pedido: só deixa o autor em branco", async () => {
    const [beto] = await db.insert(usuarios).values({ organizacaoId: org, email: "beto@exemplo.com", nome: "Beto", papel: "admin" }).returning();
    // Gravado direto (sem histórico, que também segura o usuário): aqui só interessa a chave do pedido.
    const [p] = await db
      .insert(pedidosContatoProprietario)
      .values({ organizacaoId: org, ...dados(), situacao: "respondido", decididoEm: agora, decididoPor: beto.id })
      .returning();
    await db.delete(usuarios).where(eq(usuarios.id, beto.id));
    const { decididos } = await listarPedidosContato(db, org);
    expect(decididos).toHaveLength(1);
    expect(decididos[0]).toMatchObject({ id: p.id, situacao: "respondido", decididoPor: null, decididoPorNome: null });
  });
});

describe("aviso por e-mail para a equipe", () => {
  const empresa = { nome: "Sua Casa Exemplo", razaoSocial: "", cnpj: "", email: "contato@empresa-exemplo.com", telefone: "", endereco: "", encarregado: "", site: "", chavePix: "" };

  it("manda um e-mail restrito para o e-mail da empresa, com os dados e o link do painel", async () => {
    await salvarEmpresa(db, org, empresa, null);
    const p = await registrar({ quartos: 0, anunciaHoje: false, mensagem: "Pode ligar à tarde." });
    const correio = new CorreioMemoria();
    expect(await avisarEquipe(db, org, p, correio, "https://exemplo.test/painel/proprietarios/contatos")).toBe("enviado");
    expect(correio.enviadas).toHaveLength(1);
    const m = correio.enviadas[0];
    expect(m).toMatchObject({ para: "contato@empresa-exemplo.com", assunto: "Novo pedido de contato de proprietário", conteudoRestrito: true, chave: `pedido-contato-proprietario:${p.id}` });
    for (const trecho of [
      "Nome: Maria Exemplo",
      "E-mail: maria@exemplo.com",
      "Telefone: (21) 90000-0000",
      "Imóvel: Ipanema, Rio de Janeiro",
      "Quartos: Studio",
      "Já anuncia em alguma plataforma: Não",
      "Mensagem: Pode ligar à tarde.",
      "https://exemplo.test/painel/proprietarios/contatos",
    ])
      expect(m.texto).toContain(trecho);
  });

  it("sem e-mail do sistema ou sem e-mail da empresa: não envia e diz o porquê", async () => {
    const p = await registrar();
    const correio = new CorreioMemoria();
    expect(await avisarEquipe(db, org, p, null, "x")).toBe("sem-correio");
    expect(await avisarEquipe(db, org, p, correio, "x")).toBe("sem-email");
    expect(correio.enviadas).toEqual([]);
  });

  it("falha do provedor não derruba o pedido: volta \"falhou\" e o pedido segue novo", async () => {
    await salvarEmpresa(db, org, empresa, null);
    const p = await registrar();
    const quebrado: Correio = { nome: "quebrado", enviar: async () => Promise.reject(new Error("provedor fora do ar")) };
    const erro = console.error;
    console.error = () => {};
    try {
      expect(await avisarEquipe(db, org, p, quebrado, "x")).toBe("falhou");
    } finally {
      console.error = erro;
    }
    expect(await contarPedidosNovos(db, org)).toBe(1);
  });
});
