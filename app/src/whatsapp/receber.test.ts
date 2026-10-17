/**
 * Recebimento de um aviso já lido (M10.1a, desenho 4.1; cenários de 8-D): de que organização é cada bloco (só pelos ids
 * configurados, exatamente uma organização), a transação única com os contadores do dia, as entregas em paralelo (com
 * a corrida injetada entre a busca e o insert), a falha no meio sem deixar nada e o lote de 5.000 mensagens do
 * histórico com o tempo e o número de consultas medidos. PGlite, sem rede; só valores fictícios.
 */
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { whatsappAvisosDia, whatsappConta, whatsappContatos, whatsappEventos, whatsappMensagens } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { lerAviso } from "./aviso";
import { receberAviso } from "./receber";
import { LOTE_INSERCAO } from "./regras";
import {
  avisoDeConta,
  avisoDeHistorico,
  avisoDeHistoricoRecusado,
  avisoDeMensagens,
  CANARIOS,
  contatoDoAviso,
  conversaDoHistorico,
  entregarAviso,
  FICTICIOS,
  HORA_DO_AVISO,
  itemDoAviso,
  juntarCorpos,
  organizacaoComWhatsapp,
  pedacoDoHistorico,
  semDadosPessoaisWhatsapp,
} from "./testes";

let db: Db, close: () => Promise<void>, org: string;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  await db.delete(whatsappAvisosDia);
  org = await organizacaoComWhatsapp(db);
});

let relogio = 0;
const agora = () => new Date(Date.UTC(2026, 9, 17, 16, 0, 0) + ++relogio * 1000);
const entregar = (json: unknown, alvo: Db = db) => entregarAviso(alvo, json, agora());
const lido = (json: unknown) => {
  const a = lerAviso(json);
  if (a.ilegivel) throw new Error("aviso ilegível");
  return a;
};

const daOrganizacao = async (o: string) => ({
  conversas: await db.select().from(whatsappContatos).where(eq(whatsappContatos.organizacaoId, o)).orderBy(asc(whatsappContatos.criadoEm)),
  mensagens: await db.select().from(whatsappMensagens).where(eq(whatsappMensagens.organizacaoId, o)),
  eventos: await db.select().from(whatsappEventos).where(eq(whatsappEventos.organizacaoId, o)),
  conta: (await db.select().from(whatsappConta).where(eq(whatsappConta.organizacaoId, o)))[0],
});
const contadoresDeHoje = async () => (await db.select().from(whatsappAvisosDia).where(eq(whatsappAvisosDia.dia, hojeISO("America/Sao_Paulo", agora()))))[0];
const vazio = { conversas: [], mensagens: [], eventos: [], conta: undefined };

/**
 * O banco visto por dentro da transação da gravação: `aoUsar` decide, a cada chamada de `select`, `insert`, `update`,
 * `delete` ou `execute` no `tx`, se conta, lança ou injeta algo (o mesmo molde de `pagamentos/eventos.test.ts`).
 */
function espiar(alvo: Db, aoUsar: (metodo: string, tx: Db, args: unknown[]) => unknown): Db {
  const dentro = (tx: Db): Db =>
    new Proxy(tx, {
      get(t, k) {
        const v = Reflect.get(t, k);
        if (typeof v !== "function") return v;
        if (k === "transaction") return (f: (x: Db) => Promise<unknown>) => (t as Db).transaction((x) => f(dentro(x as Db)));
        if (typeof k === "string" && ["select", "insert", "update", "delete", "execute"].includes(k)) {
          return (...args: unknown[]) => {
            const trocado = aoUsar(k, t, args);
            return trocado ?? (v as (...a: unknown[]) => unknown).apply(t, args);
          };
        }
        return (v as (...a: unknown[]) => unknown).bind(t);
      },
    });
  return new Proxy(alvo, {
    get(t, k) {
      if (k === "transaction") return (f: (x: Db) => Promise<unknown>) => t.transaction((tx) => f(dentro(tx as Db)));
      const v = Reflect.get(t, k);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}

/** Um construtor de consulta do drizzle que, antes de rodar, roda `antes` (para injetar a "outra entrega" no meio). */
function antesDeRodar<T extends object>(consulta: T, antes: () => Promise<unknown>): T {
  return new Proxy(consulta, {
    get(t, k) {
      const v = Reflect.get(t, k);
      if (typeof v !== "function") return v;
      if (k === "then") return (ok: (x: unknown) => unknown, erro: (e: unknown) => unknown) => antes().then(() => (v as (...a: unknown[]) => unknown).call(t, ok, erro));
      return (...a: unknown[]) => {
        const r = (v as (...a: unknown[]) => unknown).apply(t, a);
        return r && typeof r === "object" ? antesDeRodar(r as object, antes) : r;
      };
    },
  });
}

describe("de que organização é cada bloco", () => {
  it("WABA desconhecida: outra_conta +1 e nada gravado (o aviso válido marca o último aviso válido)", async () => {
    await entregar(avisoDeMensagens({ waba: FICTICIOS.outraWaba }));
    expect(await daOrganizacao(org)).toEqual(vazio);
    expect(await contadoresDeHoje()).toMatchObject({ outraConta: 1, ignorados: 0, desconhecidos: 0 });
    expect((await contadoresDeHoje()).ultimoValidoEm).not.toBeNull();
  });

  it("número diferente do configurado: outra_conta +1 e nada gravado", async () => {
    await entregar(avisoDeMensagens({ numero: FICTICIOS.outroNumero }));
    expect(await daOrganizacao(org)).toEqual(vazio);
    expect(await contadoresDeHoje()).toMatchObject({ outraConta: 1 });
  });

  it("organização sem o id do número: os avisos de mensagem vão para outra_conta; o account_update é aceito", async () => {
    org = await organizacaoComWhatsapp(db, { numeroId: null });
    await entregar(avisoDeMensagens());
    expect(await daOrganizacao(org)).toEqual(vazio);
    expect(await contadoresDeHoje()).toMatchObject({ outraConta: 1 });
    await entregar(avisoDeConta({ evento: "PARTNER_ADDED", em: HORA_DO_AVISO }));
    expect((await daOrganizacao(org)).conta).toMatchObject({ situacao: "conectada" });
    expect(await contadoresDeHoje()).toMatchObject({ outraConta: 1 });
  });

  it("dois blocos de duas organizações no mesmo corpo: cada um na sua; a contagem dos blocos de outra conta não soma", async () => {
    const outra = await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba, numeroId: FICTICIOS.outroNumero }, { manterOutras: true });
    const daOutra = avisoDeMensagens({ waba: FICTICIOS.outraWaba, numero: FICTICIOS.outroNumero, mensagens: [itemDoAviso({ id: "wamid.TESTE.OUTRA" })] });
    // De uma conta que ninguém configurou (o id fictício do número, usado aqui como WABA de ninguém), com um status (que
    // contaria em ignorados se fosse da casa).
    const deNinguem = avisoDeMensagens({ waba: FICTICIOS.numero, statuses: [{ id: "wamid.TESTE.STATUS", status: "read" }] });
    await entregar(juntarCorpos(avisoDeMensagens(), daOutra, deNinguem));
    expect((await daOrganizacao(org)).mensagens.map((m) => m.wamid)).toEqual([CANARIOS.wamid]);
    expect((await daOrganizacao(outra)).mensagens.map((m) => m.wamid)).toEqual(["wamid.TESTE.OUTRA"]);
    expect(await contadoresDeHoje()).toMatchObject({ outraConta: 1, ignorados: 0 });
  });

  it("account_update com entry.id de uma organização e waba_info.waba_id de outra: nenhuma das duas (outra_conta)", async () => {
    const outra = await organizacaoComWhatsapp(db, { wabaId: FICTICIOS.outraWaba, numeroId: FICTICIOS.outroNumero }, { manterOutras: true });
    expect((await entregar(avisoDeConta({ evento: "PARTNER_REMOVED", entrada: FICTICIOS.outraWaba }))).emails).toEqual([]);
    expect(await daOrganizacao(org)).toEqual(vazio);
    expect(await daOrganizacao(outra)).toEqual(vazio);
    expect(await contadoresDeHoje()).toMatchObject({ outraConta: 1 });
  });

  it("histórico recusado sem envelope: acha a organização pelo número; número de ninguém → outra_conta", async () => {
    await entregar(avisoDeHistoricoRecusado());
    expect((await daOrganizacao(org)).conta).toMatchObject({ sincronizacaoHistorico: "recusada" });
    await entregar(avisoDeHistoricoRecusado({ numero: FICTICIOS.outroNumero }));
    expect(await contadoresDeHoje()).toMatchObject({ outraConta: 1 });
  });
});

describe("contadores do dia", () => {
  it("grupos e statuses → ignorados; entrada sem id e bloco sem número → desconhecidos; tudo na mesma transação", async () => {
    const corpo = juntarCorpos(
      avisoDeMensagens({ mensagens: [itemDoAviso({ id: "wamid.TESTE.GRUPO", extra: { group_id: "GRUPO.FICTICIO" } })], statuses: [{ id: "wamid.TESTE.S1" }, { id: "wamid.TESTE.S2" }] }),
      avisoDeMensagens({ numero: null }),
      { entry: [{ changes: [] }] },
    );
    await entregar(corpo);
    const o = await daOrganizacao(org);
    expect(o.conversas).toEqual([]);
    expect(o.mensagens).toEqual([]);
    expect(o.eventos.map((e) => [e.campo, e.resultado, e.itens])).toEqual([["messages", "ignorado", 0]]);
    expect(await contadoresDeHoje()).toMatchObject({ ignorados: 3, desconhecidos: 2, outraConta: 0, assinaturasRecusadas: 0, ilegiveis: 0 });
  });

  it("falha no meio da transação (o insert das mensagens lança): nada fica, nem a conversa, nem os contadores, nem o último aviso válido", async () => {
    const falhando = espiar(db, (metodo, _tx, args) => {
      if (metodo === "insert" && args[0] === whatsappMensagens) throw new Error("queda simulada");
      return undefined;
    });
    await expect(entregar(avisoDeMensagens({ statuses: [{ id: "wamid.TESTE.S" }] }), falhando)).rejects.toThrow("queda simulada");
    expect(await daOrganizacao(org)).toEqual(vazio);
    expect(await contadoresDeHoje()).toBeUndefined();
    // A Meta reenvia: o reenvio grava normalmente.
    await entregar(avisoDeMensagens({ statuses: [{ id: "wamid.TESTE.S" }] }));
    expect((await daOrganizacao(org)).mensagens).toHaveLength(1);
    expect(await contadoresDeHoje()).toMatchObject({ ignorados: 1 });
  });

  it("o evento de conta novo que pede e-mail volta com a organização e fica marcado no evento", async () => {
    const r = await entregar(avisoDeConta({ evento: "PARTNER_REMOVED", motivo: "PRIMARY_INACTIVITY" }));
    const [evento] = (await daOrganizacao(org)).eventos;
    expect(r.emails).toEqual([{ organizacaoId: org, eventoId: evento.id }]);
    expect(evento).toMatchObject({ avisarPorEmail: true, emailAvisoEm: null, emailResultado: null });
  });
});

describe("entregas em paralelo", () => {
  it("o mesmo aviso duas vezes ao mesmo tempo: uma conversa e uma mensagem", async () => {
    // O PGlite roda as transações em fila (_runExclusiveTransaction): este caso não exercita a corrida; ela é coberta no
    // caso seguinte, injetando a linha da outra entrega no meio. A garantia real de "uma linha só" são os índices únicos.
    const corpo = avisoDeMensagens({ contatos: [contatoDoAviso({ bsuid: CANARIOS.bsuid })], mensagens: [itemDoAviso({ deUsuario: CANARIOS.bsuid })] });
    await Promise.all([entregar(corpo), entregar(corpo)]);
    const o = await daOrganizacao(org);
    expect(o.conversas).toHaveLength(1);
    expect(o.mensagens).toHaveLength(1);
    expect(o.eventos.map((e) => e.resultado).sort()).toEqual(["gravado", "repetido"]);
  });

  it("corrida entre a busca e o insert: a entrega A (só o wa_id) grava no meio da B (wa_id e BSUID); a releitura acha a linha e completa o BSUID", async () => {
    let injetada = false;
    const corrida = espiar(db, (metodo, tx, args) => {
      if (metodo !== "insert" || args[0] !== whatsappContatos || injetada) return undefined;
      injetada = true;
      // A linha "da outra entrega", gravada depois da busca e antes do insert desta.
      return antesDeRodar(tx.insert(whatsappContatos), () => tx.insert(whatsappContatos).values({ organizacaoId: org, waId: CANARIOS.waIdBr }));
    });
    const b = avisoDeMensagens({ contatos: [contatoDoAviso({ bsuid: CANARIOS.bsuid })], mensagens: [itemDoAviso({ deUsuario: CANARIOS.bsuid })] });
    await entregar(b, corrida);
    expect(injetada).toBe(true);
    const o = await daOrganizacao(org);
    expect(o.conversas).toMatchObject([{ waId: CANARIOS.waIdBr, bsuid: CANARIOS.bsuid, nomePerfil: CANARIOS.nomePerfil, conflitoIdentidade: false }]);
    expect(o.mensagens).toMatchObject([{ wamid: CANARIOS.wamid, contatoId: o.conversas[0].id }]);
  });
});

describe("lote grande do histórico (T26)", () => {
  /**
   * Cada conversa do lote é identificada por um BSUID fictício (não é telefone): as mensagens do cliente vêm sem `from`
   * e com o `from_user_id` da conversa (recebidas, 3.5 a); as da empresa, do telefone fictício da empresa.
   */
  const bsuidDoLote = (c: number) => `BR.LoteFicticio${c}`;
  /** Um pedaço do histórico com `total` mensagens em `quantas` conversas (até 500, divisor de `total`), metade de cada lado. */
  function pedaco(quantas: number, total: number) {
    const porConversa = total / quantas;
    const conversas = Array.from({ length: quantas }, (_, c) =>
      conversaDoHistorico({
        id: bsuidDoLote(c),
        bsuid: bsuidDoLote(c),
        mensagens: Array.from({ length: porConversa }, (_, j) =>
          itemDoAviso({
            id: `wamid.LOTE.${quantas}.${c}.${j}`,
            ...(j % 2 ? { de: FICTICIOS.telefoneEmpresa } : { de: null, deUsuario: bsuidDoLote(c) }),
            em: new Date(HORA_DO_AVISO.getTime() - (porConversa - j) * 60_000),
            conteudo: { body: `Mensagem fictícia ${j}` },
          }),
        ),
      }),
    );
    return avisoDeHistorico({ pedacos: [pedacoDoHistorico({ progresso: 100, conversas })] });
  }
  /** Grava e mede: consultas no `tx` (select, insert, update, delete, execute), inserts de mensagens e o tempo. */
  async function medir(quantas: number) {
    org = await organizacaoComWhatsapp(db);
    const aviso = lido(pedaco(quantas, 5000));
    let consultas = 0;
    let insercoes = 0;
    const contando = espiar(db, (metodo, _tx, args) => {
      consultas += 1;
      if (metodo === "insert" && args[0] === whatsappMensagens) insercoes += 1;
      return undefined;
    });
    const inicio = performance.now();
    await receberAviso(contando, aviso, agora());
    const ms = Math.round(performance.now() - inicio);
    const o = await daOrganizacao(org);
    expect(o.conversas).toHaveLength(quantas);
    expect(o.mensagens).toHaveLength(5000);
    expect(o.eventos).toMatchObject([{ campo: "history", resultado: "gravado", itens: 5000 + quantas + 1 }]);
    expect(o.conta).toMatchObject({ sincronizacaoHistorico: "concluida", progressoHistorico: 100 });
    // Do histórico, nada fica "sem resposta"; a lista se ordena pela última mensagem.
    expect(o.conversas.every((c) => c.ultimaRecebidaEm === null && c.ultimaEnviadaEm === null && c.ultimaMensagemEm !== null)).toBe(true);
    // Recebidas e enviadas pelo celular, metade de cada lado, cada conversa só com o BSUID do lote.
    expect(o.mensagens.filter((m) => m.direcao === "recebida")).toHaveLength(2500);
    expect(o.conversas.every((c) => c.waId === null && c.bsuid?.startsWith("BR.LoteFicticio"))).toBe(true);
    return { consultas, insercoes, ms };
  }

  it("5.000 mensagens em 100, 250 e 500 conversas: em lotes, e o número de consultas não cresce com o número de conversas (dentro do lote de 500)", async ({ annotate }) => {
    const medidas = { 100: await medir(100), 250: await medir(250), 500: await medir(500) };
    // Por pedaço: uma busca e um insert das conversas, 10 inserts de 500 mensagens, o progresso, o resumo, o evento e
    // os contadores do dia.
    expect(new Set(Object.values(medidas).map((m) => m.consultas)).size).toBe(1);
    expect(medidas[500].consultas).toBeLessThanOrEqual(20);
    // Em lotes, e não um insert só: 5.000 linhas × 11 colunas chegariam perto do teto de 65.535 parâmetros do Postgres.
    for (const m of Object.values(medidas)) expect(m.insercoes).toBe(Math.ceil(5000 / LOTE_INSERCAO));
    await annotate(`5.000 mensagens: ${Object.entries(medidas).map(([n, m]) => `${n} conversas, ${m.consultas} consultas (${m.insercoes} inserts de mensagens), ${m.ms} ms`).join("; ")} (PGlite em memória)`);
  }, 120_000);
});

describe("privacidade", () => {
  it("depois de todos os cenários, nenhum canário fora das conversas e das mensagens", async () => {
    expect(await semDadosPessoaisWhatsapp(db)).toEqual([]);
  });
});
