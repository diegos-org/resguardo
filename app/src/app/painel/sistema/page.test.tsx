import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ sessao: vi.fn(), mp: vi.fn(), execute: vi.fn(), redirect: vi.fn(), execucoes: vi.fn(), estadoReservas: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/acesso/sessao-atual", () => ({ exigirSessaoPainel: m.sessao }));
vi.mock("@/db/client", () => ({ getDb: () => ({ execute: m.execute }) }));
vi.mock("@/sistema/automacoes", async (original) => ({ ...(await original<typeof import("@/sistema/automacoes")>()), ultimasExecucoes: m.execucoes }));
vi.mock("@/sistema/regras", () => ({ regrasEmVigor: async () => [] }));
vi.mock("@/configuracoes/regras-financeiras", () => ({ lerRegrasFinanceiras: async () => ({ base: "bruto" }) }));
vi.mock("@/pagamentos/integracao", () => ({ situacaoDoMercadoPago: m.mp }));
// M8.3c: o estado que decide o motivo de configuração das reservas do site (o banco é falso aqui); a regra é a de verdade.
vi.mock("@/beds24/reservas-site-rotina", async (original) => ({ ...(await original<typeof import("@/beds24/reservas-site-rotina")>()), estadoDaConfiguracaoDasReservas: m.estadoReservas }));
import Page from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  m.execute.mockResolvedValue([]);
  m.execucoes.mockResolvedValue(new Map([["pedidos-site", { nome: "pedidos-site", iniciadoEm: new Date("2026-10-08T13:00:00Z"), ok: true, resumo: "Pagamentos: 1 conferido(s)" }]]));
  m.sessao.mockResolvedValue({ papel: "admin", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  m.mp.mockResolvedValue({ situacao: "so_nas_previas", motivo: null, contaDeTeste: null, segredoWebhook: true, ultimoAvisoValidoEm: null, assinaturasRecusadasHoje: 0, enderecoWebhook: "https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago" });
  // A sessão pode ter a credencial real (e as chaves) do Beds24 no ambiente: cada teste parte sem elas.
  for (const v of ["BEDS24_REFRESH_TOKEN", "BEDS24_API_KEY", "BEDS24_ESCRITA", "BEDS24_ESCRITA_RESERVAS"]) vi.stubEnv(v, undefined);
});

afterEach(() => vi.unstubAllEnvs());

it("operação não abre Sistema", async () => {
  m.sessao.mockResolvedValue({ papel: "operacao", organizacaoId: "org", usuarioId: "u", imovelIds: [] });
  await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
  expect(m.mp).not.toHaveBeenCalled();
});

it("Mercado Pago pela mesma função de Integrações e a rotina dos pedidos e pagamentos do site", async () => {
  const h = renderToStaticMarkup(await Page());
  expect(m.mp).toHaveBeenCalledTimes(1);
  expect(h).toContain("Pagamentos (Mercado Pago)");
  expect(h).toContain("o teste do pagamento roda nas prévias da Vercel");
  expect(h).toContain("Pedidos e pagamentos do site");
  expect(h).toContain("Pagamentos: 1 conferido(s)");
});

it("sem banco, a linha do Mercado Pago diz que não foi conferida (sem chamar a função)", async () => {
  m.execute.mockRejectedValue(new Error("fora do ar"));
  const h = renderToStaticMarkup(await Page());
  expect(m.mp).not.toHaveBeenCalled();
  expect(h).toContain("Situação não conferida nesta abertura");
});

it("rotina que não rodou (M8.3a): o resumo com o selo de aviso, não o de falha nem como sucesso", async () => {
  m.execucoes.mockResolvedValue(
    new Map([
      ["sync-beds24", { nome: "sync-beds24", iniciadoEm: new Date("2026-10-16T09:15:00Z"), ok: false, resumo: "Não rodou: envio de reserva do site ao Beds24 em andamento" }],
      ["envio-beds24", { nome: "envio-beds24", iniciadoEm: new Date("2026-10-16T10:00:00Z"), ok: false, resumo: "Falhou: Credencial Beds24 não configurada." }],
    ]),
  );
  const h = renderToStaticMarkup(await Page());
  expect(h).toContain('style="background:var(--scl-aviso-fundo)">Não rodou: envio de reserva do site ao Beds24 em andamento</span>');
  expect(h).toContain('style="background:var(--scl-erro-fundo)">Falhou: Credencial Beds24 não configurada.</span>');
});

// Muda junto (M8.3c): a rotina das reservas do site chegou e aparece como ativa (antes, planejada, com "chega no M8.3c").
it("M8.3a: as duas chaves do Beds24 pelas funções, o aviso de credencial de escrita fora da produção e a rotina das reservas como ativa (M8.3c)", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("BEDS24_REFRESH_TOKEN", "refresh-secreto-ficticio");
  vi.stubEnv("BEDS24_ESCRITA", "ligada");
  const h = renderToStaticMarkup(await Page());
  expect(h).toContain("envio para o Beds24 LIGADO");
  expect(h).toContain("reservas do site no Beds24: chave desligada (BEDS24_ESCRITA_RESERVAS)");
  expect(h).toContain("Credencial de escrita presente fora da produção");
  expect(h).not.toContain("refresh-secreto-ficticio");
  expect(h).toContain("Reservas pagas do site no Beds24 (criar, atualizar, cancelar e conferir)</td><td>A cada 10 minutos, fora das janelas da importação e do envio diários, só no deploy de produção; escreve só com BEDS24_ESCRITA_RESERVAS=ligada e a configuração pronta; também na ficha</td><td>—</td><td>ainda não rodou</td>");
  expect(h).not.toContain("chega no M8.3c");
  // Fora do deploy de produção, o motivo de configuração das reservas nem é lido.
  expect(m.estadoReservas).not.toHaveBeenCalled();
});

it("M8.3c: com a chave das reservas pronta no deploy de produção, a linha do Beds24 diz por que o envio está parado", async () => {
  for (const [k, v] of Object.entries({ VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_ESCRITA_RESERVAS: "ligada", BEDS24_REFRESH_TOKEN: "refresh-secreto-ficticio" })) vi.stubEnv(k, v);
  m.estadoReservas.mockImplementation(async (_db: unknown, _org: string, _env: NodeJS.ProcessEnv, agora: Date) => ({
    refreshToken: true, credencial: "refresh:ficticia", rotina: { escopos: { situacao: "em_ordem", excessivos: [], faltando: [], ilegiveis: [] }, escoposCredencial: "refresh:ficticia", escoposLidosEm: agora }, leituraFalhou: false, agora, ensaioValido: false, marcaIlegivel: false,
  }));
  const h = renderToStaticMarkup(await Page());
  expect(m.estadoReservas).toHaveBeenCalledOnce();
  expect(m.estadoReservas.mock.calls[0][1]).toBe("org");
  expect(h).toContain("reservas do site no Beds24: chave LIGADA e pronta neste deploy");
  expect(h).toContain("envio de reservas parado: falta um ensaio conferido com a credencial atual; as reservas novas não são criadas");
  expect(h).not.toContain("refresh-secreto-ficticio");
});
