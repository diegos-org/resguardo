import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Beds24Falso } from "@/beds24/falso";
import { ErroBeds24 } from "@/beds24/tipos";
import { REGRAS_CALENDARIO_PADRAO } from "@/calendario/regras-config";
import { gravarConfig } from "@/configuracoes/armazem";
import { appSettings, idsExternos, imoveis, organizacoes, proprietarios, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { ultimasSincronizacoes } from "@/beds24/sincronizacao";
import { escolherPeriodicidade } from "@/repasses/proprietario";
import { ultimasExecucoes } from "@/sistema/automacoes";
import { opcoesDoSentry } from "@/observabilidade/sentry";

/**
 * M0.9, revisão do Codex: um nome (ou outro dado do negócio) que entra no texto de uma rotina automática fica no
 * registro local (a página Sistema, ou o da organização) e não vai ao Sentry. Cada caso injeta um nome fictício no
 * ponto em que ele entra no texto e roda a rota de verdade, com o banco de teste (PGlite) e o pacote do Sentry de verdade
 * com um transporte falso, que só guarda o que seria enviado: nada vai para a rede.
 */
const NOME = "Maria Fictícia Teste";
// O código de um imóvel só aceita minúsculas, dígitos e hífen: o nome entra assim.
const CODIGO = "maria-ficticia-teste";

const m = vi.hoisted(() => ({
  db: null as unknown as Db,
  travadas: vi.fn(),
  fechamentos: vi.fn(),
  mensagens: vi.fn(),
  agenda: vi.fn(),
  rotinaDoSite: vi.fn(),
  enviarCalendario: vi.fn(),
  leitor: null as unknown as Beds24Falso,
}));
vi.mock("@/db/client", () => ({ getDb: () => m.db }));
vi.mock("@/email/correio", async (orig) => ({ ...(await orig<typeof import("@/email/correio")>()), correioDoAmbiente: () => null }));
// Pontos em que o texto entra, espiados (por padrão, o de verdade).
vi.mock("@/financeiro/trava", async (orig) => {
  const o = await orig<typeof import("@/financeiro/trava")>();
  m.travadas.mockImplementation(o.lerComReservasTravadas);
  return { ...o, lerComReservasTravadas: m.travadas };
});
vi.mock("@/fechamento/email", async (orig) => ({ ...(await orig<typeof import("@/fechamento/email")>()), enviarFechamentosAutomaticos: m.fechamentos }));
vi.mock("@/mensagens/hospede", async (orig) => ({ ...(await orig<typeof import("@/mensagens/hospede")>()), enviarMensagensHospede: m.mensagens }));
vi.mock("@/agenda/agenda", async (orig) => ({ ...(await orig<typeof import("@/agenda/agenda")>()), enviarAgenda: m.agenda }));
vi.mock("@/pagamentos/rotina", () => ({ rotinaDoSite: m.rotinaDoSite }));
vi.mock("@/pagamentos/oferta", () => ({ provedorDeConferencia: async () => ({ ok: false, motivo: "so_nas_previas", texto: "" }) }));
vi.mock("@/calendario/envio", async (orig) => ({ ...(await orig<typeof import("@/calendario/envio")>()), enviarCalendarioBeds24: m.enviarCalendario }));
vi.mock("@/beds24/http", async (orig) => ({ ...(await orig<typeof import("@/beds24/http")>()), leitorParaSincronizacao: () => m.leitor, escritorDoAmbiente: () => new Beds24Falso() }));

import { GET as agenda } from "./agenda/route";
import { GET as beds24 } from "./beds24/route";
import { GET as beds24Envio } from "./beds24-envio/route";
import { GET as cotacoes } from "./cotacoes/route";
import { GET as fechamento } from "./fechamento/route";
import { GET as mensagens } from "./mensagens/route";
import { GET as repasses } from "./repasses/route";

const enviados: string[] = [];
beforeAll(() => {
  const transport = (opcoes: Parameters<typeof Sentry.createTransport>[0]) =>
    Sentry.createTransport(opcoes, async (pedido) => {
      enviados.push(typeof pedido.body === "string" ? pedido.body : new TextDecoder().decode(pedido.body));
      return { statusCode: 200 };
    });
  Sentry.init({ ...opcoesDoSentry({ NEXT_PUBLIC_SENTRY_DSN: "https://chavepublicaficticia@o0.ingest.exemplo.io/0", VERCEL_ENV: "preview" })!, transport });
});
afterAll(() => Sentry.close());

let close: () => Promise<void>, org: string;
beforeEach(async () => {
  enviados.length = 0;
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-teste");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("BEDS24_ORGANIZACAO_ID", "");
  m.leitor = new Beds24Falso();
  ({ db: m.db, close } = await createTestDb());
  [{ id: org }] = await m.db.insert(organizacoes).values({ nome: "Organização fictícia" }).returning();
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await close();
});

const pedido = () => new Request("https://example.com/api/cron/x", { headers: { authorization: "Bearer cron-teste" } });

/** O único aviso enviado ao Sentry, já como sairia (sem o código-fonte em volta da pilha, que é deste teste). */
function avisoEnviado(): { evento: { tags: Record<string, string>; exception: { values: { type: string; value: string }[] } }; texto: string } {
  expect(enviados).toHaveLength(1);
  const itens = enviados[0]
    .split("\n")
    .filter(Boolean)
    .map((linha) => JSON.parse(linha));
  const evento = itens.find((i) => i.exception);
  for (const e of evento.exception.values) for (const q of e.stacktrace?.frames ?? []) for (const k of ["pre_context", "context_line", "post_context"]) delete q[k];
  return { evento, texto: JSON.stringify(itens) };
}
const valores = (evento: { exception: { values: { value: string }[] } }) => evento.exception.values.map((e) => e.value);
const resumoLocal = async (rotina: string) => (await ultimasExecucoes(m.db)).get(rotina)?.resumo ?? "";

describe("rotinas automáticas: o nome fica em Sistema e não vai ao Sentry (M0.9, revisão do Codex)", () => {
  it("repasses: o nome do proprietário cujo antecipado não saiu (reservas em recálculo)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T11:00:00Z"));
    const [dono] = await m.db.insert(proprietarios).values({ organizacaoId: org, nome: NOME, email: "dono@example.com" }).returning();
    await escolherPeriodicidade(m.db, org, dono.id, "disponivel", null);
    // O recálculo do deploy segura as reservas: o antecipado volta com um erro que a rotina não reconhece.
    m.travadas.mockResolvedValueOnce(null);

    expect((await repasses(pedido())).status).toBe(500);
    expect(await resumoLocal("repasses-periodicos")).toContain(`${NOME}: Reservas deste proprietário estão sendo recalculadas agora`);
    const { evento, texto } = avisoEnviado();
    expect(evento.tags).toMatchObject({ rotina: "repasses-periodicos" });
    expect(valores(evento)).toEqual(["1 repasse(s) antecipado(s) não gerado(s) (detalhe na página Sistema)"]);
    expect(texto).not.toContain(NOME);
  });

  it("fechamento: a mensagem de um erro inesperado numa organização", async () => {
    m.fechamentos.mockRejectedValue(new Error(`Falha ao montar o relatório de ${NOME}`));
    expect((await fechamento(pedido())).status).toBe(500);
    expect(await resumoLocal("fechamento-email")).toBe(`Falhou: erro numa organização: Falha ao montar o relatório de ${NOME}`);
    const { evento, texto } = avisoEnviado();
    expect(evento.tags).toMatchObject({ rotina: "fechamento-email" });
    expect(valores(evento)).toEqual(["1 organização(ões) com erro inesperado (detalhe na página Sistema)"]);
    expect(texto).not.toContain(NOME);
  });

  it("mensagens ao hóspede: o erro de uma organização fica no registro dela", async () => {
    m.mensagens.mockRejectedValue(new Error(`Modelo sem dado para ${NOME}`));
    expect((await mensagens(pedido())).status).toBe(500);
    expect(await resumoLocal("mensagens-hospede")).toContain("erro numa organização");
    const [ultima] = await m.db.select().from(appSettings).where(eq(appSettings.key, `mensagens-hospede:ultima:${org}`));
    expect(ultima.value).toMatchObject({ resumo: `erro: Modelo sem dado para ${NOME}`, ok: false });
    const { evento, texto } = avisoEnviado();
    // Em Sistema, só as contagens: o aviso aponta para a última execução da organização, onde está o detalhe.
    expect(valores(evento)).toEqual(["1 organização(ões) com erro inesperado (detalhe em Configurações → Modelos de mensagem, na última execução de cada organização)"]);
    expect(texto).not.toContain(NOME);
  });

  it("agenda: o erro de uma organização (Sistema já ficava com um texto fixo)", async () => {
    m.agenda.mockRejectedValue(new Error(`Falha ao enviar para ${NOME}`));
    expect((await agenda(pedido())).status).toBe(500);
    expect(await resumoLocal("agenda-diaria")).toBe("Falhou: erro ao montar ou enviar a agenda de uma organização");
    const { evento, texto } = avisoEnviado();
    expect(valores(evento)).toEqual(["1 organização(ões) com erro inesperado (detalhe na página Sistema)"]);
    expect(texto).not.toContain(NOME);
  });

  it("pedidos do site: o valor que o Postgres repete na causa de um erro do banco", async () => {
    // O nome chega a uma coluna de id: o erro de verdade do Postgres repete o valor na mensagem.
    m.rotinaDoSite.mockImplementation((db: Db) => db.select().from(reservas).where(eq(reservas.id, NOME)));
    expect((await cotacoes(pedido())).status).toBe(500);
    expect(await resumoLocal("pedidos-site")).toBe("Falhou: a rotina parou no meio; roda de novo em 10 minutos");
    const { evento, texto } = avisoEnviado();
    expect(evento.tags).toMatchObject({ rotina: "pedidos-site" });
    expect(evento.exception.values.map((e) => [e.type, e.value])).toEqual(
      expect.arrayContaining([
        ["ErroDeRotina", "1 rotina interrompida no meio (detalhe na página Sistema)"],
        ["DrizzleQueryError", "mensagem omitida (pode ter dados pessoais)"],
        [expect.any(String), "mensagem omitida (pode ter dados pessoais); código 22P02"],
      ]),
    );
    expect(texto).not.toContain(NOME);
  });

  /** A importação de verdade (`sincronizarBeds24`), com um imóvel fictício vinculado ao quarto 20 do Beds24 falso. */
  async function prepararImportacao() {
    await m.db.transaction((tx) => gravarConfig(tx, org, "beds24", { automatica: true, desde: "2026-09-01", diasCalendario: 2 }, null));
    const [im] = await m.db.insert(imoveis).values({ organizacaoId: org, codigo: CODIGO, nome: "Imóvel fictício" }).returning();
    await m.db.insert(idsExternos).values({ organizacaoId: org, imovelId: im.id, canal: "beds24", idExterno: "10", detalhe: "20" });
  }
  const INTEGRACOES = "detalhe em Configurações → Integrações, nas últimas importações do Beds24";

  it("importação do Beds24: o código do imóvel fica nas últimas importações, e o Sentry recebe o motivo certo", async () => {
    await prepararImportacao();
    // O Beds24 falso não tem o quarto vinculado: a importação para com o código do imóvel na mensagem.
    m.leitor.properties = [];
    expect((await beds24(pedido())).status).toBe(500);
    expect(await resumoLocal("sync-beds24")).toBe("Falhou: Sincronização falhou; consulte Integrações.");
    const [ultima] = await ultimasSincronizacoes(m.db, org);
    expect(ultima).toMatchObject({ situacao: "erro", resumo: expect.stringContaining(`imóvel ${CODIGO} não está acessível`) });
    const { evento, texto } = avisoEnviado();
    expect(evento.tags).toMatchObject({ rotina: "sync-beds24" });
    expect(valores(evento)).toEqual([`1 falha de configuração ou de vínculo (${INTEGRACOES})`]);
    expect(texto).not.toContain(CODIGO);
  });

  it("importação do Beds24 (revisão): a queda da rede e um erro inesperado não viram falha de configuração", async () => {
    await prepararImportacao();
    const casos: [Error, string][] = [
      [new ErroBeds24("A conexão com o Beds24 foi interrompida.", "rede"), "1 falha de rede"],
      [new ErroBeds24("A conexão com o Beds24 excedeu o tempo-limite.", "tempo"), "1 tempo esgotado"],
      [new Error(`falha interna ao ler o quarto de ${NOME}`), "1 erro inesperado"],
    ];
    for (const [falha, motivo] of casos) {
      enviados.length = 0;
      m.leitor.falhar = falha;
      expect((await beds24(pedido())).status).toBe(500);
      expect(await resumoLocal("sync-beds24")).toBe("Falhou: Sincronização falhou; consulte Integrações.");
      const { evento, texto } = avisoEnviado();
      expect(valores(evento)).toEqual([`${motivo} (${INTEGRACOES})`]);
      expect(texto).not.toContain(NOME);
    }
    // O detalhe de cada uma ficou nas últimas importações (o erro inesperado, com o texto seguro de sempre).
    expect((await ultimasSincronizacoes(m.db, org)).map((e) => e.situacao)).toEqual(["erro", "erro", "erro"]);
  });

  it("importação do Beds24: falha antes de importar (credencial ou organização) fica em Sistema, com o motivo", async () => {
    await m.db.transaction((tx) => gravarConfig(tx, org, "beds24", { automatica: true, desde: "2026-09-01", diasCalendario: 2 }, null));
    // Outra organização sem BEDS24_ORGANIZACAO_ID: a rotina não sabe qual atender.
    await m.db.insert(organizacoes).values({ nome: "Outra organização fictícia" });
    expect((await beds24(pedido())).status).toBe(500);
    expect(await resumoLocal("sync-beds24")).toContain("configure BEDS24_ORGANIZACAO_ID");
    const { evento } = avisoEnviado();
    expect(valores(evento)).toEqual(expect.arrayContaining(["1 falha de configuração ou de vínculo (detalhe na página Sistema)"]));
  });

  it("envio ao Beds24: o código do imóvel no resultado do envio", async () => {
    vi.stubEnv("BEDS24_ESCRITA", "ligada");
    await m.db.transaction((tx) => gravarConfig(tx, org, "calendario_regras", { ...REGRAS_CALENDARIO_PADRAO, envio: { imoveis: [], automatico: true } }, null));
    m.enviarCalendario.mockResolvedValue({ ok: false, situacao: "erro", mensagem: `O quarto vinculado ao imóvel ${CODIGO} (propriedade 10, quarto 20) não está acessível nesta credencial.`, imoveis: [], avisos: [], totalAvisos: 0 });
    expect((await beds24Envio(pedido())).status).toBe(500);
    expect(m.enviarCalendario).toHaveBeenCalledOnce();
    expect(await resumoLocal("envio-beds24")).toContain(`Envio erro: O quarto vinculado ao imóvel ${CODIGO}`);
    const { evento, texto } = avisoEnviado();
    expect(evento.tags).toMatchObject({ rotina: "envio-beds24" });
    expect(valores(evento)).toEqual(["1 envio incompleto (detalhe na página Sistema)"]);
    expect(texto).not.toContain(CODIGO);
  });
});
