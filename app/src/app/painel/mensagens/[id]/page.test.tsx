/**
 * Uma conversa do WhatsApp (M10.1a, desenho 6.4; testes de 8-G e da seção 12, item 1): quem vê é decidido de verdade por
 * `whatsapp/acesso.ts`, com a configuração "Quem vê as conversas" simulada; a conversa, as sugestões e o histórico são
 * simulados (anotados), e o conteúdo de cada mensagem sai do `conteudoDaMensagem` de verdade. As ações e o "lida" ficam
 * só anotados (nada grava). O banco é um objeto vazio. Só dados fictícios.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinhaHistorico } from "@/auditoria/auditoria";
import { type ConversaCompleta, conteudoDaMensagem, type MensagemNaTela } from "@/whatsapp/conversas";
import type { TipoMensagem } from "@/whatsapp/regras";
import type { Candidato } from "@/whatsapp/vinculo";

const m = vi.hoisted(() => ({ sessao: vi.fn(), config: vi.fn(), obter: vi.fn(), candidatos: vi.fn(), historico: vi.fn(), ordem: [] as string[] }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/whatsapp/configuracao", async (original) => ({ ...(await original<typeof import("@/whatsapp/configuracao")>()), lerConfigWhatsapp: m.config }));
vi.mock("@/whatsapp/conversas", async (original) => ({ ...(await original<typeof import("@/whatsapp/conversas")>()), obterConversa: (...a: unknown[]) => (m.ordem.push("obter"), m.obter(...a)) }));
vi.mock("@/whatsapp/vinculo", async (original) => ({ ...(await original<typeof import("@/whatsapp/vinculo")>()), candidatosDaConversa: (...a: unknown[]) => (m.ordem.push("candidatos"), m.candidatos(...a)) }));
vi.mock("@/auditoria/auditoria", async (original) => ({ ...(await original<typeof import("@/auditoria/auditoria")>()), historicoDe: (...a: unknown[]) => (m.ordem.push("historico"), m.historico(...a)) }));
vi.mock("@/whatsapp/acoes", () => ({ confirmarVinculoAcao: vi.fn(), vincularPorCodigoAcao: vi.fn(), desfazerVinculoAcao: vi.fn(), marcarComoLidaAcao: vi.fn() }));
// A pergunta do BotaoConfirmar fica no atributo (o componente de verdade só a mostra no clique).
vi.mock("@/components/BotaoConfirmar", () => ({
  BotaoConfirmar: ({ pergunta, children, className }: { pergunta: string; children?: React.ReactNode; className?: string }) => (
    <button type="submit" data-pergunta={pergunta} className={className}>
      {children}
    </button>
  ),
}));
// O "lida" é marcado pelo navegador depois de aberta: aqui só aparece o que a página entregaria ao componente.
vi.mock("@/components/mensagens/MarcarComoLida", () => ({ MarcarComoLida: ({ contatoId, ate }: { contatoId: string; ate: string }) => <i data-marcar={`${contatoId}|${ate}`} /> }));
import Page from "./page";

const ID = "11111111-1111-4111-8111-111111111111";
const SEM_ACESSO =
  "As conversas do WhatsApp estão visíveis só para o administrador. Quem muda isso é o administrador, em Configurações → Integrações → WhatsApp.";
let n = 0;
const mensagem = (o: Partial<Omit<MensagemNaTela, "conteudo">> & { texto?: string } = {}): MensagemNaTela => {
  const { texto = "", ...resto } = o;
  const base = { id: `m${++n}`, direcao: "recebida" as const, origem: "tempo_real" as const, tipo: "texto" as TipoMensagem, enviadaEm: new Date("2026-10-17T15:00:00Z"), editadaEm: null, apagadaEm: null, reacao: null, ...resto };
  return { ...base, conteudo: conteudoDaMensagem({ tipo: base.tipo, texto, apagadaEm: base.apagadaEm }) };
};
const conversa = (o: Partial<ConversaCompleta> = {}): ConversaCompleta => ({
  id: ID,
  nome: "Hóspede Fictício",
  telefone: "+55 21 99999-0000",
  ultimaMensagemEm: new Date("2026-10-17T15:00:00Z"),
  ultimaRecebidaEm: new Date("2026-10-17T15:00:00Z"),
  naoLida: false,
  semResposta: true,
  conflitoIdentidade: false,
  vinculo: null,
  mensagens: [mensagem({ texto: "Oi! Minha reserva é SCL-ABC234." })],
  maisMensagens: false,
  ...o,
});
const candidato = (o: Partial<Candidato> = {}): Candidato => ({
  tipo: "reserva",
  id: "22222222-2222-4222-8222-222222222222",
  motivos: ["codigo_reserva", "telefone_hospede"],
  rotulo: "Reserva SCL-ABC234 · Studio Exemplo · 20/12/2026 a 27/12/2026 · Hóspede Fictício",
  link: "/painel/reservas/22222222-2222-4222-8222-222222222222",
  ...o,
});

const sessao = (papel: string) => m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: papel === "proprietario" ? ["im"] : [] });
const configuracao = (quemVeConversas: string) => m.config.mockResolvedValue({ wabaId: null, numeroId: null, quemVeConversas });
const html = async (busca: Record<string, string> = {}, id = ID) =>
  renderToStaticMarkup(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(busca) } as PageProps<"/painel/mensagens/[id]">));
const texto = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

beforeEach(() => {
  vi.clearAllMocks();
  m.ordem.length = 0;
  sessao("admin");
  configuracao("so_admin");
  m.obter.mockResolvedValue(conversa());
  m.candidatos.mockResolvedValue({ candidatos: [candidato()], mais: 0 });
  m.historico.mockResolvedValue([]);
});

describe("quem abre a conversa (seção 12, item 1)", () => {
  it("operação com o padrão só o admin: só o aviso, sem ler a conversa, as sugestões nem o histórico", async () => {
    sessao("operacao");
    const h = await html();
    expect(h).toContain(SEM_ACESSO);
    expect(m.config).toHaveBeenCalledWith({}, "org");
    expect(m.ordem).toEqual([]);
    expect(h).not.toContain("Hóspede Fictício");
  });

  it.each([
    ["operacao", "admin_e_operacao", true],
    ["proprietario", "so_admin", false],
    ["proprietario", "admin_e_operacao", false],
    ["limpeza", "admin_e_operacao", false],
    ["admin", "valor-torto", true],
  ])("%s com %s: abre = %s", async (papel, quem, abre) => {
    sessao(papel);
    configuracao(quem);
    const h = await html();
    if (abre) expect(m.ordem).toContain("obter");
    else {
      expect(m.ordem).toEqual([]);
      expect(h).toContain(SEM_ACESSO);
    }
  });

  it("id malformado → 404 sem nenhuma consulta; conversa de outra empresa (null pela sessão) → 404 sem histórico nem sugestões", async () => {
    await expect(html({}, "nao-e-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(m.ordem).toEqual([]);
    m.obter.mockResolvedValue(null);
    await expect(html()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(m.obter).toHaveBeenCalledWith({}, expect.objectContaining({ organizacaoId: "org" }), ID);
    expect(m.ordem).toEqual(["obter"]);
  });
});

describe("a conversa (6.4)", () => {
  it("cabeçalho com o telefone formatado e o link de volta; sem número, o nome de usuário; o conflito de identidade avisa", async () => {
    let t = texto(await html());
    expect(t).toContain("← Mensagens");
    // Só a largura do texto, com alvo de toque de 44px no celular (.link).
    expect(await html()).toMatch(/<a href="\/painel\/mensagens" class="_link_\w+">← Mensagens<\/a>/);
    expect(t).toContain("Hóspede Fictício");
    expect(t).toContain("WhatsApp: +55 21 99999-0000");
    m.obter.mockResolvedValue(conversa({ telefone: null, conflitoIdentidade: true }));
    t = texto(await html());
    expect(t).toContain("Contato com nome de usuário, sem número");
    expect(t).toContain("Este contato pode ser o mesmo de outra conversa (o WhatsApp trocou o número ou a identificação). Confira no celular antes de vincular.");
  });

  it.each<[TipoMensagem, string, string]>([
    ["texto", "Oi, chego às 15:00.", "Oi, chego às 15:00."],
    ["imagem", "", "Foto — ver no celular"],
    ["imagem", "A vista da varanda", "Foto — ver no celular: A vista da varanda"],
    ["audio", "", "Áudio — ver no celular"],
    ["video", "", "Vídeo — ver no celular"],
    ["documento", "", "Documento — ver no celular"],
    ["figurinha", "", "Figurinha — ver no celular"],
    ["localizacao", "", "Localização — ver no celular"],
    ["contato", "", "Contato compartilhado — ver no celular"],
    ["nao_suportada", "", "Mensagem que o sistema não consegue mostrar — ver no celular"],
    // "sistema" tem caso próprio abaixo: sai no meio da conversa, sem balão (revisão do bloco G).
    ["outro", "", "Mensagem de um tipo que o sistema não mostra — ver no celular"],
    ["pendente", "", "Mensagem ainda não recebida pelo sistema — ver no celular"],
    ["midia_pendente", "", "Anexo ainda não recebido — ver no celular"],
  ])("tipo %s: o conteúdo inteiro, com o texto exato", async (tipo, guardado, esperado) => {
    m.obter.mockResolvedValue(conversa({ mensagens: [mensagem({ tipo, texto: guardado })] }));
    expect(await html()).toContain(`>${esperado}</p>`);
  });

  it("o texto do sistema no lugar do conteúdo sai como marcador; o que o cliente escreveu, não", async () => {
    m.obter.mockResolvedValue(conversa({ mensagens: [mensagem({ texto: "Texto do cliente" }), mensagem({ tipo: "midia_pendente" }), mensagem({ texto: "", apagadaEm: new Date("2026-10-17T15:30:00Z") })] }));
    const h = await html();
    expect(h).toMatch(/<p class="_conteudo_\w+ ">Texto do cliente<\/p>/);
    expect(h).toMatch(/<p class="_conteudo_\w+ _marcador_\w+">Anexo ainda não recebido — ver no celular<\/p>/);
    expect(h).toMatch(/<p class="_conteudo_\w+ _marcador_\w+">Mensagem apagada<\/p>/);
  });

  it("o aviso do WhatsApp (troca de número) sai no meio da conversa, com a hora, sem balão e sem \"Cliente\": não foi o cliente que mandou", async () => {
    m.obter.mockResolvedValue(conversa({ mensagens: [mensagem({ tipo: "sistema" })] }));
    const h = await html();
    expect(h).toMatch(/<li class="_avisoNaConversa_\w+">Aviso do WhatsApp: o contato mudou de número ou de identificação · 17\/10 às 12:00<\/li>/);
    expect(h).not.toContain("<strong>Cliente</strong>");
  });

  it("a conversa fica numa área rolável que abre na mais recente e recebe o foco pelo teclado; a ordem no HTML é a de envio", async () => {
    m.obter.mockResolvedValue(conversa({ mensagens: [mensagem({ texto: "Primeira" }), mensagem({ texto: "Segunda" })] }));
    const h = await html();
    expect(h).toMatch(/<div class="_rolagemConversa_\w+" tabindex="0" role="region" aria-label="Conversa"><ol class="_mensagens_\w+" aria-label="Mensagens">/);
    expect(h.indexOf("Primeira")).toBeLessThan(h.indexOf("Segunda"));
    // O vínculo vem logo depois da conversa.
    expect(h.indexOf("</ol></div>")).toBeLessThan(h.indexOf('aria-label="Sugestões de vínculo"'));
  });

  it("quem mandou, a hora, a edição, o apagamento, a reação, \"do histórico\" e o rodapé das 200 mais recentes; sem caixa de resposta", async () => {
    m.obter.mockResolvedValue(
      conversa({
        maisMensagens: true,
        mensagens: [
          mensagem({ texto: "Mensagem editada pelo cliente", editadaEm: new Date("2026-10-17T15:20:00Z"), reacao: "👍" }),
          mensagem({ direcao: "enviada_celular", texto: "", apagadaEm: new Date("2026-10-17T15:30:00Z"), editadaEm: new Date("2026-10-17T15:25:00Z") }),
          mensagem({ origem: "historico", texto: "Mensagem antiga do histórico", enviadaEm: new Date("2026-09-01T12:00:00Z") }),
        ],
      }),
    );
    const h = await html();
    const t = texto(h);
    expect(h).toContain("<strong>Cliente</strong>");
    expect(h).toContain("<strong>Enviada pelo celular</strong>");
    expect(t).toContain("17/10 às 12:00");
    expect(h).toContain(">(editada às 12:20)</p>");
    expect(h).toContain(">Reação: 👍</p>");
    expect(h).toContain(">Mensagem apagada</p>");
    // A apagada não mostra a edição nem texto.
    expect(t).not.toContain("(editada às 12:25)");
    expect(h).toContain("<span>do histórico</span>");
    expect(t).toContain("01/09 às 09:00");
    expect(h).toContain(">Mostrando as 200 mensagens mais recentes.</p>");
    expect(h).not.toMatch(/<textarea|Responder|Enviar mensagem/);
  });

  it("o \"lida\" vai para o navegador só na conversa não lida, com a hora da última recebida; lida, nada", async () => {
    m.obter.mockResolvedValue(conversa({ naoLida: true }));
    expect(await html()).toContain(`data-marcar="${ID}|2026-10-17T15:00:00.000Z"`);
    m.obter.mockResolvedValue(conversa({ naoLida: false }));
    expect(await html()).not.toContain("data-marcar");
  });
});

describe("erro (seção 13, item 1)", () => {
  it("a falha de leitura da conversa sobe para o app/painel/error.tsx, sem ler as sugestões nem o histórico", async () => {
    m.obter.mockRejectedValue(new Error("falha fictícia de leitura"));
    await expect(html()).rejects.toThrow("falha fictícia de leitura");
    expect(m.ordem).toEqual(["obter"]);
  });
});

describe("vínculo (6.4)", () => {
  it("sem vínculo: as sugestões com o rótulo, os motivos e \"Vincular\", \"e mais {n}\", a busca manual e a frase fixa", async () => {
    m.candidatos.mockResolvedValue({ candidatos: [candidato(), candidato({ tipo: "cotacao", id: "33333333-3333-4333-8333-333333333333", motivos: ["codigo_cotacao"], rotulo: "Cotação COT-ABCDEFGH · Studio Exemplo · 20/12/2026 a 27/12/2026", link: null })], mais: 4 });
    const h = await html();
    const t = texto(h);
    expect(m.candidatos).toHaveBeenCalledWith({}, expect.objectContaining({ papel: "admin" }), ID, expect.any(Date));
    expect(t).toContain("Sugestões de vínculo");
    expect(t).toContain("Reserva SCL-ABC234 · Studio Exemplo · 20/12/2026 a 27/12/2026 · Hóspede Fictício — código da reserva na conversa, mesmo telefone do hóspede");
    expect(t).toContain("Cotação COT-ABCDEFGH · Studio Exemplo · 20/12/2026 a 27/12/2026 — código da cotação na conversa");
    expect(h).toContain('name="tipo" value="cotacao"');
    expect(h).toContain('name="alvoId" value="33333333-3333-4333-8333-333333333333"');
    expect(h.split(">Vincular</button>").length - 1).toBe(2);
    // Cada "Vincular" com um nome próprio, que começa pelo texto visível.
    expect(h).toContain('aria-label="Vincular a Reserva SCL-ABC234 · Studio Exemplo · 20/12/2026 a 27/12/2026 · Hóspede Fictício"');
    expect(h).toContain('aria-label="Vincular a Cotação COT-ABCDEFGH · Studio Exemplo · 20/12/2026 a 27/12/2026"');
    expect(h).toMatch(/<input class="_campo_\w+"[^>]*name="codigo"/);
    expect(t).toContain("e mais 4");
    expect(t).toContain("Código da reserva ou da cotação");
    expect(h).toContain('placeholder="SCL-XXXXXX ou COT-XXXXXXXX"');
    expect(h).toContain(">Procurar e vincular</button>");
    expect(t).toContain("O vínculo não copia o telefone nem o nome para a reserva ou para nenhum cadastro.");
    expect(t).not.toContain("Desfazer vínculo");
  });

  it("sem sugestão: o texto de como o sistema sugere, e que nunca vincula sozinho", async () => {
    m.candidatos.mockResolvedValue({ candidatos: [], mais: 0 });
    expect(texto(await html())).toContain(
      "Nenhuma sugestão. O sistema sugere pelo código da reserva (SCL-…) ou da cotação (COT-…) escrito na conversa e pelo telefone; nunca vincula sozinho.",
    );
  });

  it("confirmado: quem e quando, \"Abrir\" e \"Desfazer vínculo\" com a pergunta; sem sugestões nem busca", async () => {
    m.obter.mockResolvedValue(
      conversa({ vinculo: { tipo: "reserva", rotulo: "Reserva SCL-ABC234 · Studio Exemplo", selo: "Reserva SCL-ABC234", link: "/painel/reservas/r1", podeDesfazer: true, confirmadoPor: "Diego", confirmadoEm: new Date("2026-10-17T16:00:00Z") } }),
    );
    const h = await html();
    const t = texto(h);
    expect(m.candidatos).not.toHaveBeenCalled();
    expect(t).toContain("Vinculada por Diego em 17/10/2026 às 13:00 a: Reserva SCL-ABC234 · Studio Exemplo.");
    // "Abrir" é o botão principal; "Desfazer vínculo", o secundário (.pequeno), como os "Desfazer" do painel.
    expect(h).toMatch(/<a href="\/painel\/reservas\/r1" class="_botao_\w+">Abrir<\/a>/);
    expect(h).toMatch(/data-pergunta="Desfazer o vínculo desta conversa com Reserva SCL-ABC234 · Studio Exemplo\? A conversa continua guardada." class="_pequeno_\w+">Desfazer vínculo<\/button>/);
    expect(t).not.toContain("Sugestões de vínculo");
    expect(t).not.toContain("Procurar e vincular");
    m.obter.mockResolvedValue(conversa({ vinculo: { tipo: "reserva", rotulo: "Reserva SCL-ABC234", selo: "Reserva SCL-ABC234", link: null, podeDesfazer: true, confirmadoPor: null, confirmadoEm: new Date("2026-10-17T16:00:00Z") } }));
    expect(texto(await html())).toContain("Vinculada por usuário removido em 17/10/2026 às 13:00 a: Reserva SCL-ABC234.");
  });

  it("com admin e operação, a operação diante do vínculo a um proprietário feito pelo admin: o rótulo genérico, sem link nem \"Desfazer vínculo\"", async () => {
    sessao("operacao");
    configuracao("admin_e_operacao");
    m.obter.mockResolvedValue(conversa({ vinculo: { tipo: "proprietario", rotulo: "um proprietário", selo: "Proprietário", link: null, podeDesfazer: false, confirmadoPor: "Diego", confirmadoEm: new Date("2026-10-17T16:00:00Z") } }));
    const h = await html();
    expect(texto(h)).toContain("Vinculada por Diego em 17/10/2026 às 13:00 a: um proprietário.");
    expect(h).not.toContain("/painel/proprietarios/");
    expect(h).not.toContain("Desfazer vínculo");
    expect(h).not.toMatch(/>Abrir<\/a>/);
  });

  it("o resultado das ações só pelas chaves conhecidas; outra chave não aparece", async () => {
    const casos: [Record<string, string>, string][] = [
      [{ feito: "vinculada" }, "Conversa vinculada."],
      [{ feito: "desfeito" }, "Vínculo desfeito."],
      [{ erro: "codigo_invalido" }, "Esse código não está no formato SCL-XXXXXX ou COT-XXXXXXXX."],
      [{ erro: "codigo_nao_encontrado" }, "Nenhuma reserva ou cotação com esse código."],
      [{ erro: "alvo_nao_encontrado" }, "Não encontramos esse cadastro. Atualize a página."],
      [{ erro: "ja_vinculada" }, "Esta conversa já está vinculada. Desfaça o vínculo antes de escolher outro."],
    ];
    for (const [busca, esperado] of casos) expect(texto(await html(busca))).toContain(esperado);
    // Nas cores do resto do painel: sucesso em verde, erro em vermelho.
    expect(await html({ feito: "vinculada" })).toMatch(/<p role="status" class="_sucesso_\w+"[^>]*>Conversa vinculada.<\/p>/);
    expect(await html({ erro: "ja_vinculada" })).toMatch(/<p role="alert" class="_alerta_\w+"[^>]*>Esta conversa já está vinculada/);
    const h = await html({ feito: "<script>x</script>", erro: "constructor" });
    expect(h).not.toContain("<script>x");
    expect(h).not.toContain("&lt;script&gt;");
    expect(h).not.toMatch(/role="(status|alert)"/);
  });
});

describe("histórico do vínculo (6.4, 6.10)", () => {
  it("o histórico da conversa (\"whatsapp_conversa\") aparece com os verbos novos, lido só depois de a conversa existir", async () => {
    const linhas: LinhaHistorico[] = [
      { id: "h1", acao: "whatsapp.conversa.vincular", mudancas: { vinculo: [null, "reserva:22222222-2222-4222-8222-222222222222"] }, criadoEm: new Date("2026-10-17T16:00:00Z"), autor: "Diego" },
      { id: "h2", acao: "whatsapp.conversa.desvincular", mudancas: { vinculo: ["reserva:22222222-2222-4222-8222-222222222222", null] }, criadoEm: new Date("2026-10-17T17:00:00Z"), autor: "Diego" },
    ];
    m.historico.mockResolvedValue(linhas);
    const t = texto(await html());
    expect(m.historico).toHaveBeenCalledWith({}, "org", "whatsapp_conversa", ID);
    expect(m.ordem.indexOf("obter")).toBeLessThan(m.ordem.indexOf("historico"));
    expect(t).toContain("Diego vinculou a conversa do WhatsApp · 17/10/2026 às 13:00");
    expect(t).toContain("Diego desfez o vínculo da conversa do WhatsApp · 17/10/2026 às 14:00");
    // O vínculo sai só pelo tipo: o id gravado na auditoria ("tipo:id") nunca aparece na tela.
    expect(t).toContain("Vínculo: — → uma reserva");
    expect(t).toContain("Vínculo: uma reserva → —");
    expect(t).not.toContain("22222222-2222-4222-8222-222222222222");
  });
});
