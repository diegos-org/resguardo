import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sessao: vi.fn(), mp: vi.fn(), redirect: vi.fn(), reservasBeds24: vi.fn() }));
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
}));
import type { PainelReservasBeds24 } from "@/beds24/reservas-site-painel";
import Page from "./page";

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
