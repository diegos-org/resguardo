import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { DadosEmpresa } from "@/configuracoes/empresa";
import type { VersaoPaginaLegal } from "@/configuracoes/paginas-legais";
import { RASCUNHO_PAGINAS_LEGAIS } from "@/configuracoes/paginas-legais-rascunho";
import type { DocumentoLegal } from "@/configuracoes/paginas-legais-texto";
import Page from "./page";

const m = vi.hoisted(() => ({ sessao: vi.fn(), db: vi.fn(), paginas: vi.fn(), empresa: vi.fn(), redirect: vi.fn(), autores: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: m.db }));
vi.mock("@/configuracoes/acoes", () => ({ publicarPaginaLegalAcao: vi.fn() }));
vi.mock("@/configuracoes/paginas-legais", async (orig) => ({ ...(await orig<typeof import("@/configuracoes/paginas-legais")>()), lerPaginasLegais: m.paginas }));
vi.mock("@/configuracoes/empresa", async (orig) => ({ ...(await orig<typeof import("@/configuracoes/empresa")>()), lerEmpresa: m.empresa }));

// Dados fictícios. A versão 2 dos termos congelou o CNPJ antigo; o cadastro da empresa já tem outro.
const EMPRESA: DadosEmpresa = {
  nome: "Casa Exemplo",
  razaoSocial: "Casa Exemplo Temporada Ltda.",
  cnpj: "11.111.111/0001-11",
  email: "contato@example.com",
  telefone: "(21) 90000-0000",
  endereco: "Rua Fictícia, 100, Rio de Janeiro, RJ",
  encarregado: "",
  site: "",
  chavePix: "",
};
const versao = (numero: number, data: string, autorId: string | null, o: Partial<VersaoPaginaLegal> = {}): VersaoPaginaLegal => ({
  numero,
  data,
  autorId,
  secoes: { resumo: "", texto: `## Quem somos\n\nTexto da versão ${numero}, CNPJ {{cnpj}}.` },
  valores: { cnpj: "00.000.000/0001-00" },
  regras: null,
  ...o,
});
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const semNada: Record<DocumentoLegal, VersaoPaginaLegal[]> = { termos: [], privacidade: [], cancelamento: [] };

beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.sessao.mockResolvedValue({ papel: "admin", usuarioId: U1, organizacaoId: "org" });
  m.autores.mockResolvedValue([
    { id: U1, nome: "Admin Exemplo" },
    { id: U2, nome: "Diego Exemplo" },
  ]);
  m.db.mockReturnValue({ select: () => ({ from: () => ({ where: m.autores }) }) });
  m.empresa.mockResolvedValue(EMPRESA);
  m.paginas.mockResolvedValue({ ...semNada, termos: [versao(1, "2026-10-01", U1), versao(2, "2026-10-10", U2)] });
});
const html = async (doc?: string) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(doc === undefined ? {} : { doc }) }));

it.each(["operacao", "proprietario", "limpeza"])("%s não abre a aba", async (papel) => {
  m.sessao.mockResolvedValue({ papel, usuarioId: U1, organizacaoId: "org" });
  await expect(html()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.redirect).toHaveBeenCalledWith("/painel/configuracoes");
  expect(m.paginas).not.toHaveBeenCalled();
});

it("situação dos três documentos, o pagamento desligado enquanto falta algum e o aviso de dados da empresa que mudaram depois da versão", async () => {
  const h = await html();
  expect(m.paginas).toHaveBeenCalledWith(expect.anything(), "org");
  expect(m.empresa).toHaveBeenCalledWith(expect.anything(), "org");
  expect(h).toContain('<a href="/painel/configuracoes/paginas-legais?doc=termos" aria-current="page" style="font-weight:700">Termos de uso</a> — versão 2, de 10/10/2026');
  expect(h).toContain('<a href="/painel/configuracoes/paginas-legais?doc=privacidade">Política de privacidade</a> — não publicada');
  expect(h).toContain("O site ainda não oferece pagamento: falta publicar Política de privacidade e Política de cancelamento.");
  expect(h).toContain("Os dados da empresa mudaram depois da versão 2 (CNPJ): publique de novo para o site mostrar os dados atuais.");
  // O formulário traz o texto da versão em vigor e oferece a seguinte.
  expect(h).toContain("Texto da versão 2, CNPJ {{cnpj}}.");
  expect(h).toContain("Publicar a versão 3");
  expect(h).not.toContain("Nenhuma versão publicada: este é o texto-base.");
  // Na prévia, o CNPJ de agora (o site continua com o congelado até publicar de novo).
  expect(h).toContain("Texto da versão 2, CNPJ 11.111.111/0001-11.");
});

it("histórico: versões da mais nova para a mais antiga, com data, quem publicou, a em vigor marcada e o link para ver no site", async () => {
  const h = await html();
  expect(m.autores).toHaveBeenCalledTimes(1);
  const linhas = h.slice(h.indexOf("<tbody>"), h.indexOf("</tbody>"));
  expect(linhas.indexOf("2 (em vigor)")).toBeLessThan(linhas.indexOf("<td>1</td>"));
  expect(linhas).toContain("<td>10/10/2026</td><td>Diego Exemplo</td>");
  expect(linhas).toContain("<td>01/10/2026</td><td>Admin Exemplo</td>");
  expect(linhas).toContain('<a href="/termos?versao=2" target="_blank" rel="noopener noreferrer">Ver a versão 2</a>');
  expect(linhas).toContain('<a href="/termos?versao=1" target="_blank" rel="noopener noreferrer">Ver a versão 1</a>');
});

it("documento sem versão: texto-base, aviso do que falta na empresa, sem histórico e sem consulta de autores", async () => {
  const h = await html("privacidade");
  expect(h).toContain('aria-current="page" style="font-weight:700">Política de privacidade</a>');
  expect(h).toContain("Nenhuma versão publicada: este é o texto-base.");
  expect(h).toContain("Publicar a versão 1");
  expect(h).toContain("## Quem cuida dos seus dados");
  expect(h).toContain("Preencha em Configurações → Empresa antes de publicar: encarregado pela proteção de dados.");
  expect(h).toContain("Nenhuma versão publicada ainda: a página /privacidade diz que está em preparação.");
  expect(h).not.toContain("Os dados da empresa mudaram");
  expect(m.autores).not.toHaveBeenCalled();
});

it("Política de cancelamento com o prazo da versão; ?doc= fora da lista abre os Termos de uso; com os três publicados, sem o aviso do pagamento", async () => {
  const cancelamento = versao(1, "2026-10-01", null, {
    secoes: { resumo: "- Até {{dias_reembolso_integral}} dias: devolução integral.", texto: RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes.texto },
    valores: { dias_reembolso_integral: "21" },
    regras: { diasReembolsoIntegral: 21 },
  });
  m.paginas.mockResolvedValue({ termos: [versao(1, "2026-10-01", null, { valores: { cnpj: EMPRESA.cnpj } })], privacidade: [versao(1, "2026-10-01", null)], cancelamento: [cancelamento] });
  const h = await html("cancelamento");
  expect(h).toMatch(/<input type="number" min="1" max="365" step="1" required="" [^>]*name="diasReembolsoIntegral" value="21"/);
  expect(h).toContain("Até 21 dias: devolução integral.");
  expect(h).not.toContain("O site ainda não oferece pagamento");
  expect(h).toContain("<td>—</td>");
  const outro = await html("../../segredo");
  expect(outro).toContain('aria-current="page" style="font-weight:700">Termos de uso</a>');
  expect(outro).not.toContain('name="diasReembolsoIntegral"');
});

it("texto em vigor que cita o Beds24: aviso no painel (o hóspede não deve ver o nome), sem impedir publicar", async () => {
  m.paginas.mockResolvedValue({ ...semNada, termos: [versao(1, "2026-10-01", U1, { secoes: { resumo: "", texto: "## Calendário\n\nUsamos o Beds24." } })] });
  const h = await html();
  expect(h).toContain("O texto cita o Beds24: pela sua decisão de 7/10 (M5.9), o hóspede não vê esse nome.");
});
