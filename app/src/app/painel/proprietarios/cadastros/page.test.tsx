import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Cadastro } from "@/marketplace/cadastro";
import { SEM_REGISTRO_AUTORIZACAO } from "@/proprietarios/autorizacao";
import Page from "./page";

const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), listar: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/marketplace/cadastro", () => ({ listarCadastros: m.listar }));
vi.mock("@/marketplace/acoes", () => ({ aprovarCadastroAcao: vi.fn(), recusarCadastroAcao: vi.fn() }));
// A decisão (aprovar/recusar) tem o próprio formulário: aqui só o lugar dela.
vi.mock("@/components/proprietarios/DecisaoCadastro", () => ({ DecisaoCadastro: ({ nome }: { nome: string }) => <div>decisão de {nome}</div> }));

const cadastro = (over: Partial<Cadastro> = {}): Cadastro => ({
  id: "00000000-0000-4000-8000-0000000000a1",
  organizacaoId: "org",
  email: "maria@example.com",
  nome: "Maria Exemplo",
  tipo: "fisica",
  telefone: "(21) 90000-0000",
  imovel: { nome: "Apartamento Exemplo", bairro: "Ipanema", cidade: "Rio de Janeiro", endereco: "Rua Fictícia, 100", capacidade: 4, quartos: 2, banheiros: 1, descricao: "" },
  anuncio: "novo",
  links: [],
  situacao: "pendente",
  motivoRecusa: "",
  decididoEm: null,
  decididoPor: null,
  proprietarioId: null,
  imovelId: null,
  criadoEm: new Date("2026-10-15T15:30:00Z"),
  autorizadoEm: null,
  autorizacaoVersao: null,
  autorizacaoTexto: null,
  ...over,
});
const TEXTO = "Autorizo a equipe a usar estes dados para analisar o cadastro e entrar em contato comigo.";
const autorizado = { autorizadoEm: new Date("2026-10-15T15:30:00Z"), autorizacaoVersao: 1, autorizacaoTexto: TEXTO };
const registroNoHtml = `Autorizado em 15/10/2026 às 12:30 (texto da versão 1): “${TEXTO}”`;

beforeEach(() => {
  vi.clearAllMocks();
  m.db.mockReturnValue({});
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: "u", organizacaoId: "org", imovelIds: [] });
  m.listar.mockResolvedValue({ pendentes: [], decididos: [] });
});
const html = async () => renderToStaticMarkup(await Page());

it.each(["operacao", "proprietario"])("%s vê só o aviso de área restrita, sem ler os cadastros", async (papel) => {
  m.sessao.mockResolvedValue({ papel, usuarioId: "u", organizacaoId: "org", imovelIds: [] });
  expect(await html()).toContain("restrita aos administradores");
  expect(m.listar).not.toHaveBeenCalled();
});

it("autorização (M7.14): mostra quando, a versão e o texto que a pessoa marcou; cadastro de antes aparece como sem registro", async () => {
  m.listar.mockResolvedValue({
    pendentes: [cadastro({ ...autorizado }), cadastro({ id: "00000000-0000-4000-8000-0000000000a2", nome: "Antiga Exemplo" })],
    decididos: [cadastro({ id: "00000000-0000-4000-8000-0000000000b2", situacao: "aprovado", decididoEm: new Date("2026-10-15T16:00:00Z"), ...autorizado })],
  });
  const h = await html();
  expect(m.listar).toHaveBeenCalledWith({}, "org");
  // No cartão do pendente e na tabela dos decididos, no horário de Brasília.
  expect(h.split(registroNoHtml)).toHaveLength(3);
  expect(h.split(SEM_REGISTRO_AUTORIZACAO)).toHaveLength(2);
  expect(h).toContain("<dt>Autorização</dt>");
  expect(h).toContain("<th>Autorização</th>");
  expect(h).toContain("decisão de Maria Exemplo");
});
