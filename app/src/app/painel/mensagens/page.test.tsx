/**
 * Caixa de entrada do WhatsApp (M10.1a, desenho 6.3; testes de 8-G e da seção 12, item 1): quem vê é decidido de verdade
 * por `whatsapp/acesso.ts`, com a configuração "Quem vê as conversas" simulada; as consultas das conversas e da conta são
 * simuladas (anotadas), e o banco é um objeto vazio (qualquer consulta de verdade lançaria). Só dados fictícios.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumoConversa } from "@/whatsapp/conversas";
import type { SituacaoWhatsapp } from "@/whatsapp/integracao";

const m = vi.hoisted(() => ({ sessao: vi.fn(), config: vi.fn(), listar: vi.fn(), conta: vi.fn() }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode; className?: string; "aria-current"?: "page" }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));
vi.mock("@/whatsapp/configuracao", async (original) => ({ ...(await original<typeof import("@/whatsapp/configuracao")>()), lerConfigWhatsapp: m.config }));
vi.mock("@/whatsapp/conversas", async (original) => ({ ...(await original<typeof import("@/whatsapp/conversas")>()), listarConversas: m.listar }));
vi.mock("@/whatsapp/integracao", async (original) => ({ ...(await original<typeof import("@/whatsapp/integracao")>()), contaDoWhatsapp: m.conta }));
import CarregandoConversa from "./[id]/loading";
import CarregandoMensagens from "./loading";
import Page from "./page";

const SEM_ACESSO =
  "As conversas do WhatsApp estão visíveis só para o administrador. Quem muda isso é o administrador, em Configurações → Integrações → WhatsApp.";
const CONTA: SituacaoWhatsapp["conta"] = {
  situacao: "conectada",
  ultimoEvento: "PARTNER_ADDED",
  motivo: null,
  iniciadoPor: null,
  situacaoEm: new Date("2026-10-10T12:00:00Z"),
  conectadoEm: new Date("2026-10-10T12:00:00Z"),
  prazo24h: null,
  sincronizacaoContatos: "nao_pedida",
  contatosRecebidosEm: null,
  sincronizacaoHistorico: "nao_pedida",
  progressoHistorico: null,
};
const conversa = (o: Partial<ResumoConversa> = {}): ResumoConversa => ({
  id: "11111111-1111-4111-8111-111111111111",
  nome: "Hóspede Fictício",
  telefone: "+55 21 99999-0000",
  ultimaMensagemEm: new Date("2026-10-17T15:00:00Z"),
  previa: "Oi, tudo bem? Chego amanhã às 15:00.",
  naoLida: false,
  semResposta: false,
  vinculo: null,
  conflitoIdentidade: false,
  ...o,
});
const lista = (itens: ResumoConversa[], o: { total?: number; pagina?: number; paginas?: number } = {}) => ({ itens, total: o.total ?? itens.length, pagina: o.pagina ?? 1, paginas: o.paginas ?? 1 });

const sessao = (papel: string) => m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: papel === "proprietario" ? ["im"] : [] });
const configuracao = (quemVeConversas: string) => m.config.mockResolvedValue({ wabaId: null, numeroId: null, quemVeConversas });
const html = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await Page({ params: Promise.resolve({}), searchParams: Promise.resolve(busca) } as PageProps<"/painel/mensagens">));
/** O texto visível (sem as marcas do HTML nem as entidades das aspas). */
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

beforeEach(() => {
  vi.clearAllMocks();
  sessao("admin");
  configuracao("so_admin");
  m.listar.mockResolvedValue(lista([conversa()]));
  m.conta.mockResolvedValue(CONTA);
  vi.stubEnv("WHATSAPP_RECEBIMENTO", "ligada");
});
afterEach(() => vi.unstubAllEnvs());

describe("quem vê a caixa de entrada (seção 12, item 1)", () => {
  it("operação com o padrão só o admin: vê só o aviso, sem nenhuma consulta das conversas nem da conta", async () => {
    sessao("operacao");
    const h = await html();
    expect(h).toContain("<h1>Mensagens</h1>");
    expect(h).toContain(SEM_ACESSO);
    expect(m.config).toHaveBeenCalledWith({}, "org");
    expect(m.listar).not.toHaveBeenCalled();
    expect(m.conta).not.toHaveBeenCalled();
    expect(h).not.toContain("Hóspede Fictício");
  });

  it.each([
    ["admin", "so_admin", true],
    ["admin", "admin_e_operacao", true],
    ["admin", "valor-torto", true],
    ["operacao", "so_admin", false],
    ["operacao", "admin_e_operacao", true],
    ["operacao", "valor-torto", false],
    ["proprietario", "so_admin", false],
    ["proprietario", "admin_e_operacao", false],
    ["limpeza", "so_admin", false],
    ["limpeza", "admin_e_operacao", false],
    ["hospede", "admin_e_operacao", false],
  ])("%s com %s: vê a lista = %s; quando nega, só o aviso e nenhuma consulta", async (papel, quem, ve) => {
    sessao(papel);
    configuracao(quem);
    const h = await html();
    if (ve) {
      expect(m.listar).toHaveBeenCalledTimes(1);
      expect(h).toContain("Hóspede Fictício");
      expect(h).not.toContain(SEM_ACESSO);
    } else {
      expect(m.listar).not.toHaveBeenCalled();
      expect(m.conta).not.toHaveBeenCalled();
      expect(h).toContain(SEM_ACESSO);
      expect(h).not.toContain("Hóspede Fictício");
    }
  });
});

describe("a lista (6.3)", () => {
  it("cabeçalho, filtros, a linha da conversa com o link, a prévia, a hora e os selos; sem caixa de resposta", async () => {
    m.listar.mockResolvedValue(
      lista([
        conversa({ naoLida: true, semResposta: true }),
        conversa({ id: "22222222-2222-4222-8222-222222222222", nome: "Interessado Exemplo", vinculo: { tipo: "reserva", rotulo: "Reserva SCL-ABC234 · Studio", selo: "Reserva SCL-ABC234", link: "/painel/reservas/r1", podeDesfazer: true }, conflitoIdentidade: true }),
        conversa({ id: "33333333-3333-4333-8333-333333333333", nome: "Contato sem nome", previa: "Foto — ver no celular", vinculo: { tipo: "proprietario", rotulo: "um proprietário", selo: "Proprietário", link: null, podeDesfazer: false } }),
      ]),
    );
    const h = await html();
    const t = texto(h);
    expect(t).toContain("Conversas do WhatsApp da empresa. Tudo o que aparece aqui também está no celular. Para responder, use o celular: a resposta pelo painel chega numa próxima etapa.");
    expect(h).toContain('href="/painel/mensagens" aria-current="page">Todas</a>');
    expect(h).toContain('href="/painel/mensagens?filtro=sem_resposta">Sem resposta</a>');
    expect(h).toContain('href="/painel/mensagens?filtro=sem_vinculo">Sem vínculo</a>');
    expect(h).toContain('href="/painel/mensagens/11111111-1111-4111-8111-111111111111"');
    expect(t).toContain("Hóspede Fictício");
    expect(t).toContain("Oi, tudo bem? Chego amanhã às 15:00.");
    expect(t).toContain("17/10 às 12:00");
    expect(h).toContain(">Não lida</span>");
    expect(h).toContain(">Sem resposta</span>");
    expect(h).toContain(">Reserva SCL-ABC234</span>");
    expect(h).toContain(">Proprietário</span>");
    expect(h).toContain(">Sem vínculo</span>");
    expect(h).toContain(">Confira o contato</span>");
    expect(t).toContain("Mostrando 1–3 de 3.");
    // Só leitura: nada de responder pelo painel (M10.2). A lista não mostra o telefone.
    expect(h).not.toMatch(/<textarea|Responder|Enviar/);
    expect(t).not.toContain("+55 21 99999-0000");
  });

  it("filtro desconhecido vale \"todas\"; imóvel, ano e mês do filtro do painel são ignorados; a página vem da URL", async () => {
    await html({ filtro: "outro", imovel: "403", ano: "2026", mes: "10" });
    expect(m.listar).toHaveBeenLastCalledWith({}, expect.objectContaining({ papel: "admin" }), { filtro: "todas", pagina: 1 });
    await html({ filtro: "sem_resposta", pagina: "3" });
    expect(m.listar).toHaveBeenLastCalledWith({}, expect.anything(), { filtro: "sem_resposta", pagina: 3 });
    await html({ filtro: "sem_vinculo", pagina: "-2" });
    expect(m.listar).toHaveBeenLastCalledWith({}, expect.anything(), { filtro: "sem_vinculo", pagina: 1 });
    await html({ pagina: "abc" });
    expect(m.listar).toHaveBeenLastCalledWith({}, expect.anything(), { filtro: "todas", pagina: 1 });
  });

  it("vazio: \"Nenhuma conversa ainda.\" em Todas e \"Nenhuma conversa neste filtro.\" nos outros, sem paginação", async () => {
    m.listar.mockResolvedValue(lista([]));
    let t = texto(await html());
    expect(t).toContain("Nenhuma conversa ainda.");
    expect(t).not.toContain("Mostrando");
    t = texto(await html({ filtro: "sem_resposta" }));
    expect(t).toContain("Nenhuma conversa neste filtro.");
    expect(t).not.toContain("Nenhuma conversa ainda.");
  });

  it("paginação: \"Mostrando {a}–{b} de {total}.\" e os links Anteriores e Seguintes, com o filtro", async () => {
    m.listar.mockResolvedValue(lista([conversa(), conversa({ id: "44444444-4444-4444-8444-444444444444" })], { total: 102, pagina: 2, paginas: 3 }));
    const h = await html({ filtro: "sem_resposta", pagina: "2" });
    expect(texto(h)).toContain("Mostrando 51–52 de 102.");
    expect(h).toContain('href="/painel/mensagens?filtro=sem_resposta">Anteriores</a>');
    expect(h).toContain('href="/painel/mensagens?filtro=sem_resposta&amp;pagina=3">Seguintes</a>');
  });
});

describe("avisos no topo (6.3)", () => {
  const ANEXOS = "Fotos, áudios, vídeos, documentos e localizações aparecem como “ver no celular”: o sistema não baixa anexos. Mensagens vindas de aparelhos vinculados que a Meta não suporta podem não chegar aqui.";

  it.each<[string, Partial<SituacaoWhatsapp["conta"]>, string]>([
    ["não conectada", { situacao: "nao_conectada", situacaoEm: null }, "O WhatsApp ainda não está conectado ao sistema. As conversas aparecem aqui depois da conexão, que será feita no dia combinado."],
    [
      "desconectada",
      { situacao: "desconectada", motivo: "PRIMARY_INACTIVITY", situacaoEm: new Date("2026-10-16T21:30:00Z") },
      "A conexão do WhatsApp com o sistema caiu em 16/10/2026 às 18:30: o celular principal ficou cerca de 14 dias sem abrir o WhatsApp Business. As mensagens novas não chegam aqui até a conexão ser refeita; o celular continua funcionando.",
    ],
    ["desconectada sem motivo", { situacao: "desconectada", motivo: null, situacaoEm: new Date("2026-10-16T21:30:00Z") }, "caiu em 16/10/2026 às 18:30: motivo não informado pela Meta."],
    [
      "aguardando reconexão",
      { situacao: "aguardando_reconexao", situacaoEm: new Date("2026-10-16T21:30:00Z") },
      "O WhatsApp foi registrado de novo em 16/10/2026 às 18:30 (troca de aparelho ou reinstalação). A reconexão costuma ser automática em alguns minutos.",
    ],
    ["suspensa", { situacao: "suspensa", situacaoEm: new Date("2026-10-16T21:30:00Z") }, "A Meta suspendeu ou vai suspender a conta do WhatsApp (16/10/2026 às 18:30)."],
    [
      "prazo das 24 h correndo",
      { situacao: "conectada", conectadoEm: new Date("2026-10-17T02:00:00Z"), prazo24h: new Date("2026-10-18T02:00:00Z") },
      "Conectado em 16/10/2026 às 23:00. O prazo para pedir os contatos e o histórico termina em 17/10/2026 às 23:00.",
    ],
  ])("%s: o texto exato, e sempre a nota dos anexos", async (_caso, conta, esperado) => {
    m.conta.mockResolvedValue({ ...CONTA, ...conta });
    const t = texto(await html());
    expect(t).toContain(esperado);
    expect(t).toContain(ANEXOS);
  });

  it("o recebimento desligado só aparece para quem edita as configurações (o admin); a operação liberada não recebe nada da configuração", async () => {
    vi.stubEnv("WHATSAPP_RECEBIMENTO", undefined);
    const DESLIGADO = "O recebimento do WhatsApp está desligado: nada novo chega ao painel. Só o Diego liga, na Vercel (WHATSAPP_RECEBIMENTO).";
    expect(texto(await html())).toContain(DESLIGADO);
    sessao("operacao");
    configuracao("admin_e_operacao");
    const t = texto(await html());
    expect(t).toContain("Hóspede Fictício");
    expect(t).not.toContain(DESLIGADO);
    vi.stubEnv("WHATSAPP_RECEBIMENTO", "ligada");
    sessao("admin");
    expect(texto(await html())).not.toContain(DESLIGADO);
  });

  it("a conta lida é a da organização da sessão", async () => {
    await html();
    expect(m.conta).toHaveBeenCalledWith({}, "org", expect.any(Date));
  });
});

describe("erro (seção 13, item 1)", () => {
  it("a falha de leitura sobe para o app/painel/error.tsx: a página não a engole nem mostra uma lista vazia", async () => {
    m.listar.mockRejectedValue(new Error("falha fictícia de leitura"));
    await expect(html()).rejects.toThrow("falha fictícia de leitura");
  });
});

describe("carregando (seção 13, item 1)", () => {
  it("a lista e a conversa mostram só o esqueleto e o texto, sem dado nenhum", () => {
    const lista = renderToStaticMarkup(<CarregandoMensagens />);
    expect(lista).toContain("Carregando as conversas…");
    expect(lista).toContain('aria-busy="true"');
    // A lista na forma de lista; a conversa na forma dos balões (a tela não pula de forma quando a página chega).
    expect(lista).toMatch(/<ul[^>]*aria-hidden="true"/);
    const umaConversa = renderToStaticMarkup(<CarregandoConversa />);
    expect(umaConversa).toContain("Carregando a conversa…");
    expect(umaConversa).toMatch(/<ol[^>]*aria-hidden="true"/);
    expect(umaConversa).not.toContain("<ul");
    expect(m.listar).not.toHaveBeenCalled();
    expect(m.sessao).not.toHaveBeenCalled();
  });
});
