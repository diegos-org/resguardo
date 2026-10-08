import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { salvarEmpresa } from "@/configuracoes/empresa";
import { auditoria, organizacoes, pedidosContatoProprietario, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { type Correio, CorreioMemoria } from "@/email/correio";
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
    expect((await registrarPedidoContato(db, outra, dados(), agora)).ok).toBe(true);
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
    expect((await registrarPedidoContato(db, outra, dados(), agora)).ok).toBe(true);
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

  it("envios simultâneos do mesmo e-mail não passam do teto", async () => {
    const rs = await Promise.all(Array.from({ length: MAX_POR_EMAIL_POR_DIA + 3 }, () => registrarPedidoContato(db, org, dados(), agora)));
    expect(rs.filter((r) => r.ok)).toHaveLength(MAX_POR_EMAIL_POR_DIA);
    expect(await contarPedidosNovos(db, org)).toBe(MAX_POR_EMAIL_POR_DIA);
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
  const empresa = { nome: "Sua Casa Exemplo", razaoSocial: "", cnpj: "", email: "contato@empresa-exemplo.com", telefone: "", endereco: "", site: "", chavePix: "" };

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
