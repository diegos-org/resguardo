import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sessao: vi.fn(), mp: vi.fn(), redirect: vi.fn(), reservasBeds24: vi.fn(), wa: vi.fn(), propsWa: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }) }),
}));
vi.mock("@/beds24/configuracao", () => ({ lerConfigBeds24: async () => ({ automatica: false, desde: "2026-09-28", diasCalendario: 180 }), listarMapeamentosBeds24: async () => [] }));
vi.mock("@/beds24/sincronizacao", () => ({ ultimasSincronizacoes: async () => [] }));
vi.mock("@/components/configuracoes/TestarBeds24", () => ({ TestarBeds24: () => null }));
vi.mock("@/components/configuracoes/SincronizarBeds24", () => ({ SincronizarBeds24: () => null }));
vi.mock("@/pagamentos/integracao", () => ({ situacaoDoMercadoPago: m.mp }));
// M8.3a: a seção das reservas do site no Beds24 (o painel lê do banco; os botões são do servidor).
vi.mock("@/beds24/reservas-site-painel", () => ({ painelReservasBeds24: m.reservasBeds24 }));
vi.mock("@/beds24/acoes-reservas", () => ({
  pausarReservasBeds24Acao: vi.fn(),
  retomarReservasBeds24Acao: vi.fn(),
  ligarImovelReservasBeds24Acao: vi.fn(),
  desligarImovelReservasBeds24Acao: vi.fn(),
  conferirEscoposReservasBeds24Acao: vi.fn(),
  // M8.3c: o ensaio.
  criarEnsaioReservasBeds24Acao: vi.fn(),
  cancelarEnsaioReservasBeds24Acao: vi.fn(),
  conferirEnsaioReservasBeds24Acao: vi.fn(),
}));
// M10.1a: a situação do WhatsApp (a mesma função de Sistema), as ações dos dois formulários e o quadro, de verdade, com
// as propriedades que recebe anotadas (nunca o ambiente).
vi.mock("@/whatsapp/integracao", async (original) => ({ ...(await original<typeof import("@/whatsapp/integracao")>()), situacaoDoWhatsapp: m.wa }));
vi.mock("@/whatsapp/acoes", () => ({ salvarIdsWhatsappAcao: vi.fn(), salvarQuemVeConversasAcao: vi.fn() }));
vi.mock("@/components/configuracoes/WhatsappIntegracao", async (original) => {
  const o = await original<typeof import("@/components/configuracoes/WhatsappIntegracao")>();
  return { WhatsappIntegracao: (p: Parameters<typeof o.WhatsappIntegracao>[0]) => (m.propsWa(p), o.WhatsappIntegracao(p)) };
});
import type { PainelReservasBeds24 } from "@/beds24/reservas-site-painel";
import { servicoWhatsapp } from "@/sistema/servicos";
import type { SituacaoWhatsapp } from "@/whatsapp/integracao";
import Page from "./page";

const WHATSAPP: SituacaoWhatsapp = {
  recebimentoLigado: true,
  token: "ok",
  segredoConfigurado: true,
  config: { wabaId: "200000000000002", numeroId: "100000000000001", quemVeConversas: "so_admin" },
  conta: {
    situacao: "conectada",
    ultimoEvento: "PARTNER_ADDED",
    motivo: null,
    iniciadoPor: null,
    situacaoEm: new Date("2026-10-17T12:00:00Z"),
    conectadoEm: new Date("2026-10-17T12:00:00Z"),
    prazo24h: null,
    sincronizacaoContatos: "nao_pedida",
    contatosRecebidosEm: null,
    sincronizacaoHistorico: "nao_pedida",
    progressoHistorico: null,
  },
  avisos: { hoje: { assinaturas_recusadas: 1, ilegiveis: 0, outra_conta: 0, desconhecidos: 0, ignorados: 0 }, ultimoValidoEm: new Date("2026-10-17T13:00:00Z") },
  eventosDaConta: [],
  enderecoWebhook: "https://scl-reconstrucao.vercel.app/api/whatsapp",
};

const PAINEL: PainelReservasBeds24 = {
  chave: { ligada: false, ambienteDeProducao: false, pronta: false },
  credencial: { refreshToken: false, soTokenDireto: false, foraDaProducao: false },
  pausa: null,
  ensaio: null,
  marca: "nao_conferida",
  importacaoAutomatica: false,
  semLigar: "sem_ensaio",
  imoveis: [{ id: "im1", codigo: "103", ativo: true, ligadoEm: null, ligadoPor: null, quartoDoVinculo: "20" }],
  contadores: { pendente: 0, em_envio: 0, conferida: 0, divergente: 0, conflito: 0, aguardando_equipe: 0, manual: 0, encerrada: 0 },
  // Muda junto (M8.3c, bloco F): os campos novos do painel.
  ultimaRecusa: null,
  escopos: null,
  motivoDeConfiguracao: null,
  ensaioAtual: null,
  semEnsaio: "fora_da_producao",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.mp.mockResolvedValue({
    situacao: "teste",
    motivo: null,
    contaDeTeste: true,
    segredoWebhook: true,
    ultimoAvisoValidoEm: null,
    assinaturasRecusadasHoje: 1,
    enderecoWebhook: "https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago",
  });
  m.reservasBeds24.mockResolvedValue(PAINEL);
  m.wa.mockResolvedValue(WHATSAPP);
  vi.stubEnv("VERCEL_ENV", "preview");
  // A sessão pode ter a credencial real (e as chaves) do Beds24 no ambiente: cada teste parte sem elas.
  for (const v of ["BEDS24_REFRESH_TOKEN", "BEDS24_API_KEY", "BEDS24_ESCRITA", "BEDS24_ESCRITA_RESERVAS"]) vi.stubEnv(v, undefined);
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-token-secreto-ficticio");
});
afterEach(() => vi.unstubAllEnvs());

it.each(["operacao", "proprietario", "limpeza"])("%s não abre Integrações", async (papel) => {
  m.sessao.mockResolvedValue({ papel, organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.mp).not.toHaveBeenCalled();
  // M10.1a: nem a situação do WhatsApp (os ids da Meta) é lida.
  expect(m.wa).not.toHaveBeenCalled();
});

it("Mercado Pago pela mesma função de Sistema: linha na tabela com as variáveis, o quadro com o endereço e a nota da prévia, sem chave", async () => {
  const h = renderToStaticMarkup(await Page());
  expect(m.mp).toHaveBeenCalledTimes(1);
  expect(h).toContain("Pagamentos (Mercado Pago)");
  expect(h).toContain("conta conferida como de teste");
  expect(h).toContain("MERCADOPAGO_PUBLIC_KEY, MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_AMBIENTE");
  expect(h).toContain("MERCADOPAGO_WEBHOOK_SECRET: em Preview e Production");
  expect(h).toContain("https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago");
  expect(h).toContain("aqui use Conferir agora");
  expect(h).not.toContain("TEST-token-secreto-ficticio");
});

it("M8.3a: as duas chaves do Beds24 (calendário e reservas do site), cada uma pela sua função, os escopos do convite e só em Production", async () => {
  const h = renderToStaticMarkup(await Page());
  expect(m.reservasBeds24).toHaveBeenCalledWith(expect.anything(), "org", process.env);
  // Na tabela (a mesma de Sistema) e no texto das variáveis.
  expect(h).toContain("envio para o Beds24 desligado (BEDS24_ESCRITA)");
  expect(h).toContain("reservas do site no Beds24: chave desligada (BEDS24_ESCRITA_RESERVAS)");
  expect(h).toContain("Reservas do site no Beds24 só com BEDS24_ESCRITA_RESERVAS=ligada");
  expect(h).toContain("o convite novo pede exatamente leitura e escrita em bookings, leitura em bookings-personal, bookings-financial e properties e leitura e escrita em inventory, e nada além");
  expect(h).toContain("qualquer outro escopo (escrita ou all em bookings-personal, all, apagar ou outra área) conta como a mais");
  expect(h).toContain("O refresh token de escrita vai só no ambiente Production da Vercel");
  // A seção nova.
  expect(h).toContain('aria-label="Reservas do site no Beds24"');
  expect(h).toContain("Chave BEDS24_ESCRITA_RESERVAS: <strong>desligada</strong>");
  expect(h).toContain("fora do deploy de produção");
  expect(h).not.toContain("Credencial de escrita presente fora da produção");
});

it("M8.3a: o refresh token numa prévia avisa \"credencial de escrita presente fora da produção\" (na tabela e na seção), sem mostrar o valor", async () => {
  vi.stubEnv("BEDS24_REFRESH_TOKEN", "refresh-secreto-ficticio");
  vi.stubEnv("BEDS24_ESCRITA_RESERVAS", "ligada");
  m.reservasBeds24.mockResolvedValue({ ...PAINEL, chave: { ...PAINEL.chave, ligada: true }, credencial: { refreshToken: true, soTokenDireto: false, foraDaProducao: true } });
  const h = renderToStaticMarkup(await Page());
  expect(h.split("Credencial de escrita presente fora da produção").length - 1).toBe(2);
  expect(h).toContain("reservas do site no Beds24: chave ligada, mas a escrita não sai daqui");
  expect(h).toContain("Chave BEDS24_ESCRITA_RESERVAS: <strong>ligada</strong>");
  expect(h).not.toContain("refresh-secreto-ficticio");
});

it("M8.3a: a prontidão só leitura (escopos por um botão, marca, ensaio, importação automática), a pausa, o imóvel que não liga sem ensaio e os contadores", async () => {
  m.reservasBeds24.mockResolvedValue({
    ...PAINEL,
    pausa: { em: "2026-10-16T12:00:00.000Z", por: "Admin Fictício" },
    importacaoAutomatica: false,
    contadores: { ...PAINEL.contadores, conferida: 2, divergente: 1 },
  });
  const h = renderToStaticMarkup(await Page());
  expect(h).toContain("Prontidão (só leitura)");
  expect(h).toContain("Conferir os escopos");
  expect(h).toContain("Marca do SCL: ainda não conferida");
  expect(h).toContain("Último ensaio:");
  expect(h).toContain("nenhum ainda");
  expect(h).toContain("Importação automática do Beds24: <strong>desligada</strong>");
  expect(h).toContain("<strong>Pausado</strong> desde 16/10/2026");
  expect(h).toContain("por Admin Fictício");
  expect(h).toContain(">Retomar</button>");
  expect(h).toContain("falta um ensaio conferido com a credencial atual");
  expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Ligar<\/button>/);
  expect(h).toContain("Conferida: o Beds24 está igual ao SCL: 2");
  expect(h).toContain("Diferente no Beds24: 1");
});

it("M8.3a: o imóvel ligado que foi desativado aparece como inativo, só com Desligar", async () => {
  m.reservasBeds24.mockResolvedValue({ ...PAINEL, semLigar: null, imoveis: [{ id: "im1", codigo: "103", ativo: false, ligadoEm: "2026-10-10T12:00:00.000Z", ligadoPor: "Admin Fictício", quartoDoVinculo: "20" }] });
  const h = renderToStaticMarkup(await Page());
  expect(h).toContain("ligado desde 10/10/2026");
  expect(h).toContain("imóvel inativo (reative no cadastro antes de ligar de novo)");
  expect(h).toContain(">Desligar</button>");
  expect(h).not.toContain(">Ligar</button>");
});

it("M8.3c: o texto de abertura sem \"por enquanto nada é escrito\", o último 403, os escopos guardados, o motivo da parada e os contadores com link", async () => {
  m.reservasBeds24.mockResolvedValue({
    ...PAINEL,
    chave: { ligada: true, ambienteDeProducao: true, pronta: true },
    credencial: { refreshToken: true, soTokenDireto: false, foraDaProducao: false },
    ultimaRecusa: { resposta: "http_403", em: new Date("2026-10-16T14:00:00Z"), tipo: "ensaio", comCredencialAtual: true },
    escopos: { situacao: "escopo_excessivo", excessivos: ["all:bookings"], faltando: [], ilegiveis: [], lidoEm: new Date("2026-10-16T14:30:00Z"), comCredencialAtual: true, valida: true },
    motivoDeConfiguracao: { motivo: "escopo_excessivo", para: "tudo" },
    contadores: { ...PAINEL.contadores, conflito: 1, conferida: 2 },
  });
  const h = renderToStaticMarkup(await Page());
  expect(h).not.toContain("Por enquanto nada é escrito");
  expect(h).toContain("Nas prévias e no computador, nada é escrito no Beds24.");
  expect(h).toContain("Última recusa do Beds24 ao gravar reservas: 403 (sem permissão de escrever reservas), em 16/10/2026 às 11:00, no ensaio, com a credencial atual.");
  expect(h).toContain("Escopos da credencial: com permissões demais (nada é escrito com esta credencial), lidos em 16/10/2026 às 11:30.");
  expect(h).toContain("Envio de reservas parado: a credencial tem permissões além das do convite; nada é escrito.");
  expect(h).toContain('<a href="/painel/reservas?beds24=atencao">Noites ocupadas por outra reserva: 1</a>');
  expect(h).toContain("<li>Conferida: o Beds24 está igual ao SCL: 2</li>");
});

it("M8.3c: o ensaio — o formulário só com os imóveis do vínculo, desabilitado com o motivo, e cada fase com os botões dela", async () => {
  const base = { operacaoId: "op-1", situacao: "feita" as const, imovel: "103", chegada: "2026-11-03", saida: "2026-11-04", beds24Id: "900001", comCredencialAtual: true, iniciadoEm: new Date("2026-10-16T14:00:00Z"), terminadoEm: null, erro: "", podeCancelar: true, podeConferir: false, conferirAPartirDe: null };
  m.reservasBeds24.mockResolvedValue({ ...PAINEL, imoveis: [...PAINEL.imoveis, { id: "im2", codigo: "204", ativo: true, ligadoEm: null, ligadoPor: null, quartoDoVinculo: null }] });
  let h = renderToStaticMarkup(await Page());
  expect(h).toContain("Ensaio (o primeiro teste real)");
  expect(h).toContain("O ensaio só roda no deploy de produção");
  expect(h).toContain('<option value="im1">103</option>');
  expect(h).not.toContain('<option value="im2">204</option>');
  expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Criar o ensaio<\/button>/);

  m.reservasBeds24.mockResolvedValue({ ...PAINEL, semEnsaio: "em_curso", ensaioAtual: { ...base, fase: "criado" } });
  h = renderToStaticMarkup(await Page());
  expect(h).toContain("<strong>Ensaio criado</strong> (imóvel 103, de 03/11/2026 a 04/11/2026, reserva de teste 900001 no Beds24): confira no Beds24 e nas OTAs que as datas fecharam");
  expect(h).toContain(">Cancelar o ensaio</button>");
  expect(h).not.toContain(">Conferir o ensaio</button>");
  expect(h).toContain("Um ensaio por vez");

  m.reservasBeds24.mockResolvedValue({ ...PAINEL, semEnsaio: "em_curso", ensaioAtual: { ...base, fase: "nao_resolvido", situacao: "incerta", beds24Id: null, podeCancelar: false, conferirAPartirDe: new Date("2026-10-16T14:05:00Z") } });
  h = renderToStaticMarkup(await Page());
  expect(h).toContain("Ensaio criado e não cancelado: mude para Cancelado no Beds24 (não apague)");
  expect(h).toContain("Conferir o ensaio fica disponível a partir de 16/10/2026 às 11:05");
  expect(h).not.toContain(">Cancelar o ensaio</button>");

  m.reservasBeds24.mockResolvedValue({ ...PAINEL, ensaioAtual: { ...base, fase: "nao_resolvido", situacao: "divergente", podeConferir: true } });
  h = renderToStaticMarkup(await Page());
  expect(h).toContain(">Cancelar o ensaio</button>");
  expect(h).toContain(">Conferir o ensaio</button>");
  expect(h).not.toContain("feito com outra credencial");
  // Com outra credencial, o sistema não cancela: a tela diz o caminho (Cancelado no Beds24 e Conferir o ensaio).
  m.reservasBeds24.mockResolvedValue({ ...PAINEL, ensaioAtual: { ...base, fase: "criado", comCredencialAtual: false, podeConferir: true } });
  h = renderToStaticMarkup(await Page());
  expect(h).toContain("Este ensaio foi feito com outra credencial");
  expect(h).toContain(">Conferir o ensaio</button>");

  m.reservasBeds24.mockResolvedValue({ ...PAINEL, ensaioAtual: { ...base, fase: "terminado", situacao: "conferida", podeCancelar: false, terminadoEm: new Date("2026-10-16T14:10:00Z") } });
  h = renderToStaticMarkup(await Page());
  expect(h).toContain("Ensaio mais recente (imóvel 103, de 03/11/2026 a 04/11/2026, reserva de teste 900001 no Beds24, terminado em 16/10/2026 às 11:10): conferido e cancelado.");
  m.reservasBeds24.mockResolvedValue({ ...PAINEL, ensaioAtual: { ...base, fase: "terminado", situacao: "conflito", beds24Id: null, podeCancelar: false, erro: "As noites do ensaio não estão livres no Beds24 (outra reserva, um bloqueio ou sem unidade livre): nada foi enviado. Escolha outras datas.", terminadoEm: new Date("2026-10-16T14:10:00Z") } });
  h = renderToStaticMarkup(await Page());
  expect(h).toContain("terminado em 16/10/2026 às 11:10): não concluído. As noites do ensaio não estão livres no Beds24");
});

describe("M10.1a: WhatsApp em Integrações", () => {
  const TOKEN = "senha-de-verificacao-ficticia-com-mais-de-32-letras";
  const SEGREDO = "segredo-do-app-ficticio-de-teste";
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", TOKEN);
    vi.stubEnv("WHATSAPP_APP_SECRET", SEGREDO);
    vi.stubEnv("WHATSAPP_RECEBIMENTO", "ligada");
  });

  it("a situação pela mesma função de Sistema; a linha da tabela é a de Sistema, com as variáveis; o quadro com o endereço e os formulários; nunca o token nem o segredo", async () => {
    const h = renderToStaticMarkup(await Page());
    expect(m.wa).toHaveBeenCalledTimes(1);
    expect(m.wa).toHaveBeenCalledWith(expect.anything(), "org", process.env, expect.any(Date));
    // A mesma linha de Sistema (servicoWhatsapp), na tabela, e o que vai na Vercel.
    expect(h).toContain(`<td>WhatsApp (Meta)</td><td>Caixa de entrada do WhatsApp (recebimento)</td><td>${servicoWhatsapp(WHATSAPP).detalhe}</td>`);
    expect(h).toContain("WHATSAPP_VERIFY_TOKEN (pelo menos 32 caracteres, gerado só para isso) e WHATSAPP_APP_SECRET: só no ambiente Production da Vercel");
    expect(h).toContain("WHATSAPP_RECEBIMENTO=ligada, que só o Diego liga");
    expect(h).toContain('aria-label="WhatsApp"');
    expect(h).toContain("https://scl-reconstrucao.vercel.app/api/whatsapp");
    expect(h).toContain('aria-label="Identificação na Meta"');
    expect(h).toContain('aria-label="Quem vê as conversas"');
    expect(h).not.toContain(TOKEN);
    expect(h).not.toContain(SEGREDO);
  });

  it("o quadro recebe só a situação e se é prévia (nunca o ambiente); na prévia, o aviso de usar só ids fictícios", async () => {
    let h = renderToStaticMarkup(await Page());
    expect(m.propsWa).toHaveBeenLastCalledWith({ w: WHATSAPP, naPrevia: true });
    expect(Object.keys(m.propsWa.mock.lastCall![0]).sort()).toEqual(["naPrevia", "w"]);
    expect(h).toContain("Esta é uma prévia de teste: o endereço do WhatsApp só funciona na produção.");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    h = renderToStaticMarkup(await Page());
    expect(m.propsWa).toHaveBeenLastCalledWith({ w: WHATSAPP, naPrevia: false });
    expect(h).not.toContain("Esta é uma prévia de teste");
  });
});
