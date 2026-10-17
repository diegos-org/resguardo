import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M0.9: as rotinas automáticas respondem 500 sem deixar o erro escapar (o detalhe fica em Sistema), então o
 * `onRequestError` do Next não as vê; cada rota avisa o Sentry ela mesma, com o nome da rotina e sem a mensagem
 * original (revisão do Codex: ela pode ter o nome de um proprietário). O pacote do Sentry é falso aqui: nada sai.
 */
const m = vi.hoisted(() => ({
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
  rotinas: {
    agenda: vi.fn(),
    fechamento: vi.fn(),
    mensagens: vi.fn(),
    repasses: vi.fn(),
    repassesEmails: vi.fn(),
    beds24: vi.fn(),
    beds24Envio: vi.fn(),
    beds24Reservas: vi.fn(),
    rotinaDoSite: vi.fn(),
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: m.captureException, flush: m.flush }));
vi.mock("@/db/client", () => ({ getDb: () => ({ banco: true }) }));
vi.mock("@/email/correio", () => ({ correioDoAmbiente: () => null }));
vi.mock("@/agenda/cron", () => ({ agendaDeTodas: m.rotinas.agenda }));
vi.mock("@/fechamento/cron", () => ({ fechamentoDeTodas: m.rotinas.fechamento }));
vi.mock("@/mensagens/cron", () => ({ mensagensDeTodas: m.rotinas.mensagens }));
vi.mock("@/repasses/cron", () => ({ repassesDeTodas: m.rotinas.repasses, emailsDeRepassesDeTodas: m.rotinas.repassesEmails }));
vi.mock("@/beds24/cron", () => ({ executarCronBeds24: m.rotinas.beds24 }));
vi.mock("@/beds24/cron-envio", () => ({ executarCronEnvioBeds24: m.rotinas.beds24Envio }));
vi.mock("@/beds24/cron-reservas", () => ({ executarCronReservasBeds24: m.rotinas.beds24Reservas }));
vi.mock("@/pagamentos/rotina", () => ({ rotinaDoSite: m.rotinas.rotinaDoSite }));
vi.mock("@/pagamentos/oferta", () => ({ provedorDeConferencia: async () => ({ ok: false, motivo: "so_nas_previas", texto: "" }) }));
// Como a de verdade: roda a função e deixa o erro subir.
vi.mock("@/sistema/automacoes", () => ({ registrarExecucao: async (_db: unknown, _nome: string, fn: () => Promise<string>) => fn() }));

import { ErroDeRotina, MENSAGEM_OMITIDA } from "@/observabilidade/erro-de-rotina";
import { GET as agenda } from "./agenda/route";
import { GET as beds24 } from "./beds24/route";
import { GET as beds24Envio } from "./beds24-envio/route";
import { GET as beds24Reservas } from "./beds24-reservas/route";
import { GET as cotacoes } from "./cotacoes/route";
import { GET as fechamento } from "./fechamento/route";
import { GET as mensagens } from "./mensagens/route";
import { GET as repasses } from "./repasses/route";
import { GET as repassesEmails } from "./repasses-emails/route";

const pedido = () => new Request("https://example.com/api/cron/x", { headers: { authorization: "Bearer cron-teste" } });
const NOME = "Maria Fictícia Teste";
/** O erro que foi ao Sentry e as causas dele: o tipo, a mensagem e a pilha (tudo o que o Sentry lê). */
const cadeia = (e: unknown): Error[] => (e instanceof Error ? [e, ...cadeia(e.cause)] : []);
const avisado = () => {
  expect(m.captureException).toHaveBeenCalledOnce();
  return m.captureException.mock.calls[0] as unknown as [Error, unknown];
};
const textoDoAviso = (e: Error) => JSON.stringify(cadeia(e).map((x) => [x.name, x.message, x.stack]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-teste");
  vi.stubEnv("VERCEL_ENV", "production");
});
afterEach(() => vi.unstubAllEnvs());

describe("rotinas automáticas: o erro vai para o Sentry com o nome da rotina (M0.9)", () => {
  it.each([
    ["agenda", agenda, m.rotinas.agenda, "agenda-diaria"],
    ["beds24", beds24, m.rotinas.beds24, "sync-beds24"],
    ["beds24-envio", beds24Envio, m.rotinas.beds24Envio, "envio-beds24"],
    ["beds24-reservas", beds24Reservas, m.rotinas.beds24Reservas, "reservas-beds24"],
    ["fechamento", fechamento, m.rotinas.fechamento, "fechamento-email"],
    ["mensagens", mensagens, m.rotinas.mensagens, "mensagens-hospede"],
    ["repasses", repasses, m.rotinas.repasses, "repasses-periodicos"],
    ["repasses-emails", repassesEmails, m.rotinas.repassesEmails, "repasses-emails"],
  ] as const)("%s", async (_rota, GET, rotina, nome) => {
    // Um erro qualquer (fora do ErroDeRotina) com um nome na mensagem: vai o texto fixo, com o tipo e a pilha.
    rotina.mockRejectedValue(new Error(`erro numa organização: relatório de ${NOME}`));
    const r = await GET(pedido());
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false });
    const [erro, contexto] = avisado();
    expect(contexto).toEqual({ tags: { rotina: nome } });
    expect(erro.message).toBe(MENSAGEM_OMITIDA);
    expect(erro.stack).toMatch(/\n\s+at /);
    expect(textoDoAviso(erro)).not.toContain(NOME);
    // Espera o envio antes de a função terminar.
    expect(m.flush).toHaveBeenCalledWith(2000);
  });

  it("o resumo de um ErroDeRotina vai no lugar do detalhe (que fica para Sistema)", async () => {
    m.rotinas.repasses.mockRejectedValue(new ErroDeRotina(`0 repasse(s) antecipado(s) gerado(s), ${NOME}: Proprietário não encontrado.`, { antecipado_nao_gerado: 1 }));
    expect((await repasses(pedido())).status).toBe(500);
    const [erro] = avisado();
    expect(erro.name).toBe("ErroDeRotina");
    expect(erro.message).toBe("1 repasse(s) antecipado(s) não gerado(s) (detalhe na página Sistema)");
    expect(textoDoAviso(erro)).not.toContain(NOME);
  });

  it("pedidos do site: o texto fixo vai para Sistema, e o erro original segue como causa para o Sentry, sem a mensagem", async () => {
    const original = Object.assign(new Error(`SEGREDO do provedor para ${NOME}`), { code: "22P02" });
    m.rotinas.rotinaDoSite.mockRejectedValue(original);
    const r = await cotacoes(pedido());
    expect(r.status).toBe(500);
    const [erro, contexto] = avisado();
    expect(erro.message).toBe("1 rotina interrompida no meio (detalhe na página Sistema)");
    expect((erro.cause as Error).message).toBe(`${MENSAGEM_OMITIDA}; código 22P02`);
    expect(textoDoAviso(erro)).not.toContain(NOME);
    expect(textoDoAviso(erro)).not.toContain("SEGREDO");
    expect(contexto).toEqual({ tags: { rotina: "pedidos-site" } });
  });

  it("deu certo: nada vai para o Sentry", async () => {
    m.rotinas.agenda.mockResolvedValue("ok");
    expect((await agenda(pedido())).status).toBe(200);
    expect(m.captureException).not.toHaveBeenCalled();
  });

  it("o Sentry fora do ar não muda a resposta da rotina", async () => {
    m.rotinas.agenda.mockRejectedValue(new Error("falhou"));
    m.captureException.mockImplementationOnce(() => {
      throw new Error("Sentry quebrou");
    });
    const r = await agenda(pedido());
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false });
  });
});
