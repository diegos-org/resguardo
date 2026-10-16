import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { SEM_REGISTRO_AUTORIZACAO } from "@/proprietarios/autorizacao";
import type { PedidoContatoComAutor } from "@/proprietarios/pedidos-contato";
import Page from "./page";

const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), listar: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/proprietarios/pedidos-contato", async (original) => ({ ...(await original<typeof import("@/proprietarios/pedidos-contato")>()), listarPedidosContato: m.listar }));
vi.mock("@/proprietarios/acoes-contatos", () => ({ marcarRespondidoAcao: vi.fn(), arquivarPedidoAcao: vi.fn() }));

const pedido = (over: Partial<PedidoContatoComAutor> = {}): PedidoContatoComAutor => ({
  id: "00000000-0000-4000-8000-0000000000a1",
  organizacaoId: "org",
  nome: "Maria Exemplo",
  email: "maria@exemplo.com",
  telefone: "(21) 90000-0000",
  bairro: "Ipanema",
  cidade: "Rio de Janeiro",
  quartos: 0,
  anunciaHoje: true,
  mensagem: "Apartamento fictício.",
  situacao: "novo",
  nota: "",
  criadoEm: new Date("2026-10-08T15:30:00Z"),
  decididoEm: null,
  decididoPor: null,
  decididoPorNome: null,
  autorizadoEm: null,
  autorizacaoVersao: null,
  autorizacaoTexto: null,
  ...over,
});
/** O registro da autorização (M7.14), como o servidor grava. */
const TEXTO = "Autorizo o uso destes dados só para a Sua Casa Exemplo me responder sobre a gestão do imóvel.";
const autorizado = { autorizadoEm: new Date("2026-10-15T15:30:00Z"), autorizacaoVersao: 1, autorizacaoTexto: TEXTO };
/** Como o React escreve o texto no HTML (as aspas e os acentos não mudam; só & < > " são escapados). */
const registroNoHtml = `Autorizado em 15/10/2026 às 12:30 (texto da versão 1): “${TEXTO}”`;

beforeEach(() => {
  vi.clearAllMocks();
  m.db.mockReturnValue({});
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org", imovelIds: [] });
  m.listar.mockResolvedValue({ novos: [], totalNovos: 0, decididos: [] });
});
const html = async (params: Record<string, string> = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(params) }));

it.each(["operacao", "proprietario"])("%s vê só o aviso de área restrita, sem ler os pedidos", async (papel) => {
  m.sessao.mockResolvedValue({ papel, usuarioId: "u", organizacaoId: "org", imovelIds: [] });
  const h = await html();
  expect(h).toContain("Pedidos de contato (gestão completa)");
  expect(h).toContain("restrita aos administradores");
  expect(m.listar).not.toHaveBeenCalled();
  expect(m.db).not.toHaveBeenCalled();
});

it("sem pedidos: diz que não há nada esperando", async () => {
  const h = await html();
  expect(m.listar).toHaveBeenCalledWith({}, "org", 1);
  expect(h).toContain("Nenhum pedido esperando resposta.");
  expect(h).toContain("Nenhum pedido tratado ainda.");
});

it("novo: mostra os dados, links de e-mail e WhatsApp e as duas ações", async () => {
  m.listar.mockResolvedValue({ novos: [pedido()], totalNovos: 1, decididos: [] });
  const h = await html();
  expect(h).toContain("Novos (1)");
  expect(h).toContain("Maria Exemplo · Ipanema, Rio de Janeiro");
  expect(h).toContain('href="mailto:maria@exemplo.com"');
  // Só DDD + número: o link do WhatsApp ganha o 55.
  expect(h).toContain('href="https://wa.me/5521900000000"');
  expect(h).toContain("Studio");
  expect(h).toContain("Sim");
  expect(h).toContain("Apartamento fictício.");
  // Horário de Brasília.
  expect(h).toContain("08/10/2026 às 12:30");
  expect(h).toContain('name="id" value="00000000-0000-4000-8000-0000000000a1"');
  expect(h).toContain('name="nota"');
  expect(h).toContain("Marcar como respondido");
  expect(h).toContain("Arquivar");
});

it("e-mail com caracteres de endereço não vira cópia nem assunto no link", async () => {
  m.listar.mockResolvedValue({ novos: [pedido({ email: "a?cc=b&x@exemplo.com", telefone: "+55 21 90000-0000" })], totalNovos: 1, decididos: [] });
  const h = await html();
  expect(h).toContain('href="mailto:a%3Fcc%3Db%26x@exemplo.com"');
  expect(h).toContain('href="https://wa.me/5521900000000"');
});

it("já tratados: situação, quando, quem e nota; respondido ainda pode ser arquivado", async () => {
  m.listar.mockResolvedValue({
    novos: [],
    totalNovos: 0,
    decididos: [
      pedido({ id: "00000000-0000-4000-8000-0000000000b2", nome: "Beto Exemplo", situacao: "respondido", nota: "Liguei.", decididoEm: new Date("2026-10-09T13:00:00Z"), decididoPorNome: "Ana Equipe" }),
      pedido({ id: "00000000-0000-4000-8000-0000000000c3", nome: "Caio Exemplo", situacao: "arquivado", decididoEm: new Date("2026-10-09T14:00:00Z") }),
    ],
  });
  const h = await html();
  expect(h).toContain("Respondido");
  expect(h).toContain("Arquivado");
  expect(h).toContain("09/10/2026 às 10:00");
  expect(h).toContain("Ana Equipe");
  expect(h).toContain("Liguei.");
  expect(h).toContain('aria-label="Arquivar o pedido de Beto Exemplo"');
  expect(h).not.toContain('aria-label="Arquivar o pedido de Caio Exemplo"');
});

it("mostra o resultado da última ação só para códigos conhecidos", async () => {
  expect(await html({ feito: "respondido" })).toContain("Pedido marcado como respondido.");
  expect(await html({ erro: "nao-encontrado" })).toContain("Pedido não encontrado ou já tratado.");
  const h = await html({ erro: "<b>texto qualquer</b>", feito: "toString" });
  expect(h).not.toContain("texto qualquer");
  expect(h).not.toContain('role="alert"');
  expect(h).not.toContain('role="status"');
});

it("fila grande: mostra uma página por vez, com o total e os links para as outras", async () => {
  m.listar.mockResolvedValue({ novos: [pedido()], totalNovos: 61, decididos: [] });
  const h = await html({ pagina: "2" });
  expect(m.listar).toHaveBeenCalledWith({}, "org", 2);
  expect(h).toContain("Novos (61)");
  expect(h).toContain("Mostrando 31–31 de 61, dos mais antigos para os mais novos.");
  expect(h).toContain('href="/painel/proprietarios/contatos?pagina=1"');
  expect(h).toContain('href="/painel/proprietarios/contatos?pagina=3"');
  // Página inválida vira a primeira.
  await html({ pagina: "abc" });
  expect(m.listar).toHaveBeenLastCalledWith({}, "org", 1);
  // Até 30, sem navegação.
  m.listar.mockResolvedValue({ novos: [pedido()], totalNovos: 1, decididos: [] });
  expect(await html()).not.toContain("Páginas dos pedidos novos");
});

it("autorização (M7.14): mostra quando, a versão e o texto que a pessoa marcou; pedido de antes aparece como sem registro", async () => {
  m.listar.mockResolvedValue({
    novos: [pedido({ ...autorizado }), pedido({ id: "00000000-0000-4000-8000-0000000000a2", nome: "Antigo Exemplo" })],
    totalNovos: 2,
    decididos: [pedido({ id: "00000000-0000-4000-8000-0000000000b2", nome: "Beto Exemplo", situacao: "respondido", decididoEm: new Date("2026-10-15T16:00:00Z"), ...autorizado })],
  });
  const h = await html();
  // Horário de Brasília, no cartão do novo e na tabela dos já tratados.
  expect(h.split(registroNoHtml)).toHaveLength(3);
  expect(h.split(SEM_REGISTRO_AUTORIZACAO)).toHaveLength(2);
  expect(h).toContain("<th>Autorização</th>");
  expect(h).toContain("<dt>Autorização</dt>");
});
