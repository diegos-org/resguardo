import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditoria, disjuntoresCartao, pagamentos, usuarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { conferirTentativa } from "./conferencia";
import { avisosDePagamento } from "./consultas";
import {
  ALERTA_RECUSAS_24H,
  ALERTA_TOKEN_INVALIDO_1H,
  avaliarDisjuntor,
  contaNoDisjuntor,
  DESLIGADO_POR_MS,
  disjuntorAberto,
  RECUSAS_PARA_DESLIGAR,
  RECUSAS_PARA_DESLIGAR_24H,
  recusasNasUltimas24h,
  religarCartao,
  ultimosDisparos,
} from "./disjuntor";
import { ofertaDePix } from "./oferta";
import { gerarPix } from "./pix";
import { ErroProvedor } from "./provedor";
import { AGORA, type Cenario, DISPOSITIVO_FICTICIO, DOCUMENTO_FICTICIO, EMAIL_HOSPEDE, env, minutos, montarCenario, semDadosPessoais, TOKEN_FICTICIO, TOTAL } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

/** Datas livres no cenário (leitura do Beds24 de 1/10 a 30/11): a n-ésima estadia de 3 noites a partir de 16/10. */
const estadia = (n: number) => {
  const dia = (d: number) => new Date(Date.parse("2026-10-16T00:00:00Z") + d * 86_400_000).toISOString().slice(0, 10);
  return { entrada: dia(n * 4), saida: dia(n * 4 + 3), email: `d${n}@example.com` };
};
const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const chamadas = (metodo: string) => c.provedor.chamadas.filter((x) => x.metodo === metodo).length;
const avaliar = (quando: Date) => db.transaction((tx) => avaliarDisjuntor(tx, c.org, quando));
const linhas = () => db.select().from(disjuntoresCartao).where(eq(disjuntoresCartao.organizacaoId, c.org));

/** Cotação segurada (uma por cenário) onde as linhas fictícias de `recusasEm` ficam. */
const cotacaoDasRecusas = new Map<string, { cotacaoId: string; reservaId: string }>();
/** Recusas de cartão já encerradas (linhas fictícias numa cotação segurada), contando no disjuntor, nos instantes dados. */
async function recusasEm(instantes: Date[], o: { conta?: boolean; detalhe?: string } = {}) {
  let s = cotacaoDasRecusas.get(c.org);
  if (!s) {
    s = await c.segurar(estadia(10), AGORA);
    cotacaoDasRecusas.set(c.org, s);
  }
  if (!instantes.length) return;
  await db.insert(pagamentos).values(
    instantes.map((quando, i) => ({
      organizacaoId: c.org,
      cotacaoId: s.cotacaoId,
      reservaId: s.reservaId,
      imovelId: c.imovel,
      ambiente: "teste" as const,
      forma: "cartao" as const,
      referencia: `scl-recusa-${quando.getTime()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      chaveIdempotencia: `recusa-${quando.getTime()}-${i}`,
      situacao: "recusado" as const,
      detalheProvedor: o.detalhe ?? "failed/failed; pagamento failed/rejected_by_issuer",
      valor: TOTAL,
      contaNoDisjuntor: o.conta ?? true,
      encerradoEm: quando,
      criadoEm: quando,
      atualizadoEm: quando,
    })),
  );
}

describe("disjuntor de recusas do cartão (M8.2b)", () => {
  it("o que conta: recusa com order ou 402 sem order, fim de um desafio com endereço, desafio trocado pelo hóspede; nunca token, falha técnica, dados inválidos, sistema, equipe ou live_mode", () => {
    const base = { forma: "cartao" as const, situacao: "pendente" as const, etapaCartao: null, desafioUrl: null, cancelamentoPor: null, aoVivo: false };
    const desafio = { ...base, etapaCartao: "desafio" as const, desafioUrl: "https://www.mercadopago.com.br/3ds/x" };
    const l = (o: Partial<Parameters<typeof contaNoDisjuntor>[2]> = {}) => ({ codigo: null, idProvedor: null, ...o });
    expect(contaNoDisjuntor(base, "recusado", l({ idProvedor: "ORD1", codigo: "rejected_by_issuer" }))).toBe(true);
    expect(contaNoDisjuntor({ ...base, situacao: "criando" }, "recusado", l({ recusadaSemOrder: "recusado", codigo: "high_risk" }))).toBe(true);
    expect(contaNoDisjuntor({ ...base, situacao: "criando" }, "recusado", l({ recusadaSemOrder: "dados_invalidos", codigo: "bad_request" }))).toBe(false);
    for (const codigo of ["invalid_card_token", "card_token_not_found", "invalid_token", "processing_error"]) expect(contaNoDisjuntor(base, "recusado", l({ idProvedor: "ORD1", codigo }))).toBe(false);
    expect(contaNoDisjuntor(desafio, "recusado", l({ idProvedor: "ORD1", codigo: "failed" }))).toBe(true);
    expect(contaNoDisjuntor(desafio, "expirado", l({ idProvedor: "ORD1" }))).toBe(true);
    expect(contaNoDisjuntor({ ...desafio, desafioUrl: null }, "expirado", l({ idProvedor: "ORD1" }))).toBe(false);
    expect(contaNoDisjuntor({ ...desafio, cancelamentoPor: "hospede" }, "cancelado", l({ idProvedor: "ORD1" }))).toBe(true);
    for (const quem of ["sistema", "equipe"] as const) {
      expect(contaNoDisjuntor({ ...desafio, cancelamentoPor: quem }, "cancelado", l({ idProvedor: "ORD1" }))).toBe(false);
      expect(contaNoDisjuntor({ ...desafio, cancelamentoPor: quem }, "expirado", l({ idProvedor: "ORD1" }))).toBe(false);
    }
    expect(contaNoDisjuntor(desafio, "cancelado", l({ idProvedor: "ORD1" }))).toBe(false);
    expect(contaNoDisjuntor({ ...base, aoVivo: true }, "recusado", l({ idProvedor: "ORD1" }))).toBe(false);
    expect(contaNoDisjuntor(base, "recusado", l({ idProvedor: "ORD1", aoVivo: true }))).toBe(false);
    expect(contaNoDisjuntor({ ...base, forma: "pix" }, "recusado", l({ idProvedor: "ORD1" }))).toBe(false);
    expect(contaNoDisjuntor(base, "aprovado", l({ idProvedor: "ORD1" }))).toBe(false);
    expect(contaNoDisjuntor({ ...base, situacao: "recusado" }, "recusado", l({ idProvedor: "ORD1" }))).toBe(false);
    // Cancelamento sem desafio (cartão processando que o sistema cancelou, por exemplo) e criação não feita: nunca.
    expect(contaNoDisjuntor({ ...base, situacao: "incerta" }, "cancelado", l())).toBe(false);
  });

  it("8 recusas com order em cotações diferentes desligam o cartão: a 9ª nem chega ao provedor; o Pix continua oferecido e gerado; auditoria só com contagens", async () => {
    c.provedor.respostaCartao = "recusado";
    const cotacoes = [];
    for (let n = 0; n < 3; n++) cotacoes.push(await c.segurar(estadia(n)));
    let i = 0;
    for (const s of cotacoes)
      for (let k = 0; k < 3 && i < RECUSAS_PARA_DESLIGAR; k++, i++) expect((await c.cartao(s.cotacaoId, {}, minutos(i))).resultado).toMatchObject({ ok: false, codigo: "recusado" });
    expect(await disjuntorAberto(db, c.org, minutos(8))).toMatchObject({ recusas: 8, janela: "30min", ate: new Date(minutos(7).getTime() + DESLIGADO_POR_MS) });
    const antes = chamadas("criarCartao");
    expect((await c.cartao(cotacoes[2].cotacaoId, {}, minutos(9))).resultado).toMatchObject({ ok: false, codigo: "indisponivel" });
    expect(chamadas("criarCartao")).toBe(antes);
    expect(await ofertaDePix(db, c.org, cotacoes[2].cotacaoId, minutos(9), c.gate)).toEqual({ oferecer: true });
    expect((await gerarPix(db, c.org, cotacoes[2].cotacaoId, minutos(9), c.provedor)).ok).toBe(true);
    expect(await linhas()).toHaveLength(1);
    const [aud] = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "pagamento.disjuntor_aberto")));
    expect(aud).toMatchObject({ usuarioId: null, mudancas: { recusas: [null, 8], janela: [null, "30min"], ate: [null, new Date(minutos(7).getTime() + DESLIGADO_POR_MS).toISOString()] } });
    expect(await semDadosPessoais(db, [TOKEN_FICTICIO, DOCUMENTO_FICTICIO, DISPOSITIVO_FICTICIO, EMAIL_HOSPEDE, "d0@example.com", "d1@example.com", "d2@example.com"])).toEqual([]);
  });

  it("8 recusas no 402 sem a order no corpo desligam; 8 de dados do cartão inválidos (400, sem order) e 8 de falha técnica do Mercado Pago, não", async () => {
    c.provedor.respostaCartao = "recusado_sem_order";
    let i = 0;
    for (let n = 0; n < 3; n++) {
      const s = await c.segurar(estadia(n));
      for (let k = 0; k < 3 && i < 8; k++, i++) await c.cartao(s.cotacaoId, {}, minutos(i));
    }
    expect(await disjuntorAberto(db, c.org, minutos(8))).toMatchObject({ recusas: 8 });

    const outro = await montarCenario(db);
    const original = outro.provedor.criarCartao.bind(outro.provedor);
    outro.provedor.criarCartao = async () => ({ ok: false, motivo: "dados_invalidos", mensagem: "Token inválido.", cobranca: null, codigo: "invalid_card_token" });
    i = 0;
    for (let n = 0; n < 3; n++) {
      const s = await outro.segurar(estadia(n));
      for (let k = 0; k < 3 && i < 8; k++, i++) expect((await outro.cartao(s.cotacaoId, {}, minutos(i))).resultado).toMatchObject({ ok: false, codigo: "dados_cartao" });
    }
    // Depois do prazo daquelas datas, outras cotações com a falha técnica do Mercado Pago.
    outro.provedor.criarCartao = original;
    outro.provedor.respostaCartao = "recusado";
    outro.provedor.motivoRecusaCartao = "processing_error";
    i = 0;
    for (let n = 3; n < 6; n++) {
      const s = await outro.segurar(estadia(n), minutos(40));
      for (let k = 0; k < 3 && i < 8; k++, i++) expect((await outro.cartao(s.cotacaoId, {}, minutos(40 + i))).resultado).toMatchObject({ ok: false, codigo: "provedor" });
    }
    expect(await disjuntorAberto(db, outro.org, minutos(50))).toBeNull();
    expect(await recusasNasUltimas24h(db, outro.org, minutos(50))).toBe(0);
    // A recusa por token pede atenção no Início (chave pública e token de contas diferentes, quase sempre).
    const inicio = await avisosDePagamento(db, outro.org, minutos(5), { env: env({}) });
    expect(inicio.contagens.recusasPorToken).toBe(8);
    expect(inicio.alertas.map((a) => a.texto).join("\n")).toContain("recusados por dados do cartão inválidos na última hora");
    expect(ALERTA_TOKEN_INVALIDO_1H).toBe(3);
  });

  it("desafios trocados por um cartão novo ou por um Pix contam: 8 em 30 minutos desligam; o desafio que vence sem resposta também conta", async () => {
    c.provedor.respostaCartao = "desafio";
    let aberto = null;
    for (let n = 0; n < 3 && !aberto; n++) {
      const s = await c.segurar(estadia(n), minutos(n * 5));
      for (let k = 0; k < 3; k++) {
        const r = await c.cartao(s.cotacaoId, {}, minutos(n * 5 + k));
        if (!r.resultado.ok) break;
      }
      aberto = await disjuntorAberto(db, c.org, minutos(n * 5 + 3));
      if (!aberto) expect((await gerarPix(db, c.org, s.cotacaoId, minutos(n * 5 + 3), c.provedor)).ok).toBe(true);
    }
    expect(aberto).toMatchObject({ recusas: 8, janela: "30min" });
    const contados = await db.select().from(pagamentos).where(and(eq(pagamentos.organizacaoId, c.org), eq(pagamentos.contaNoDisjuntor, true)));
    expect(contados.every((p) => p.cancelamentoPor === "hospede" && p.situacao === "cancelado")).toBe(true);

    const outro = await montarCenario(db);
    outro.provedor.respostaCartao = "desafio";
    const s = await outro.segurar();
    const r = await outro.cartao(s.cotacaoId);
    outro.provedor.concluirDesafio(r.idProvedor!, "expirado");
    await conferirTentativa(db, outro.org, r.pagamentoId!, outro.provedor, minutos(41), { origem: "rotina", forcar: true });
    expect(await outro.tentativa(r.pagamentoId!)).toMatchObject({ situacao: "expirado", contaNoDisjuntor: true, encerradoEm: minutos(41) });
  });

  it("não contam: falha de transporte, criação dada por não feita, aprovações, análises e cancelamentos do sistema", async () => {
    const a = await c.segurar(estadia(0));
    c.provedor.falhas.criarCartao = new ErroProvedor("indisponivel", "sem conexão");
    await c.cartao(a.cotacaoId);
    c.provedor.falhas.criarCartao = new ErroProvedor("incerto", "tempo");
    const incerta = await c.cartao(a.cotacaoId);
    c.provedor.falhas.criarCartao = null;
    await conferir(incerta.pagamentoId!, new Date(AGORA.getTime() + 25 * 3_600_000));
    expect(await c.tentativa(incerta.pagamentoId!)).toMatchObject({ situacao: "cancelado", detalheProvedor: "nao_criada", contaNoDisjuntor: false });
    const b = await c.segurar(estadia(1));
    await c.cartao(b.cotacaoId);
    const d = await c.segurar(estadia(2));
    c.provedor.respostaCartao = "em_analise";
    const analise = await c.cartao(d.cotacaoId);
    c.provedor.concluirAnalise(analise.idProvedor!, "aprovado");
    await conferir(analise.pagamentoId!, minutos(5));
    // Desafio que o sistema cancela (o pedido deixou de estar segurado).
    const e = await c.segurar(estadia(3));
    c.provedor.respostaCartao = "desafio";
    const desafio = await c.cartao(e.cotacaoId);
    await db.update(pagamentos).set({ cancelamentoPor: "sistema" }).where(eq(pagamentos.id, desafio.pagamentoId!));
    c.provedor.concluirDesafio(desafio.idProvedor!, "expirado");
    await conferir(desafio.pagamentoId!, minutos(45));
    expect(await c.tentativa(desafio.pagamentoId!)).toMatchObject({ situacao: "expirado", contaNoDisjuntor: false });
    expect(await recusasNasUltimas24h(db, c.org, minutos(45))).toBe(0);
  });

  it("janelas: desliga por 60 minutos e volta sozinho sem disparar de novo com as mesmas recusas; ritmo de 7 a cada 30 minutos nunca dispara a janela curta, mas a de 24 h desliga com 20 até religar", async () => {
    await recusasEm(Array.from({ length: 8 }, (_, i) => minutos(i)));
    expect(await avaliar(minutos(8))).toBe(true);
    expect(await disjuntorAberto(db, c.org, minutos(67))).not.toBeNull();
    expect(await disjuntorAberto(db, c.org, minutos(68))).toBeNull();
    // Voltou sozinho: uma recusa nova não dispara com as de antes do fim do disparo.
    await recusasEm([minutos(69)]);
    expect(await avaliar(minutos(69))).toBe(false);

    const outro = await montarCenario(db);
    const antes = c;
    c = outro;
    const instantes: Date[] = [];
    // 7 recusas a cada 30 minutos (nunca 8 numa janela de 30), por 90 minutos.
    for (let bloco = 0; bloco < 3; bloco++) for (let k = 0; k < 7; k++) instantes.push(minutos(bloco * 31 + k * 4));
    await recusasEm(instantes.slice(0, 19));
    for (const q of instantes.slice(0, 19)) expect(await avaliar(q)).toBe(false);
    await recusasEm([instantes[19]]);
    expect(await avaliar(instantes[19])).toBe(true);
    const [linha] = await linhas();
    expect(linha).toMatchObject({ janela: "24h", recusas: RECUSAS_PARA_DESLIGAR_24H, ate: null, reincidente: true });
    expect(await disjuntorAberto(db, c.org, minutos(60 * 30))).not.toBeNull();
    c = antes;
  });

  it("terceiro disparo em 24 h: só religando à mão; religar é auditado e as recusas de antes nunca disparam de novo (nenhuma das janelas)", async () => {
    const ciclo = async (inicio: number) => {
      await recusasEm(Array.from({ length: 8 }, (_, i) => minutos(inicio + i)));
      return avaliar(minutos(inicio + 8));
    };
    expect(await ciclo(0)).toBe(true);
    expect(await religarCartao(db, c.org, (await usuario()).id, minutos(10))).toEqual({ ok: true });
    expect(await disjuntorAberto(db, c.org, minutos(10))).toBeNull();
    // As recusas de antes de religar não disparam de novo.
    await recusasEm([minutos(11)]);
    expect(await avaliar(minutos(11))).toBe(false);
    expect(await ciclo(12)).toBe(true);
    expect((await disjuntorAberto(db, c.org, minutos(21)))?.ate).not.toBeNull();
    expect(await religarCartao(db, c.org, (await usuario()).id, minutos(22))).toEqual({ ok: true });
    expect(await ciclo(23)).toBe(true);
    expect(await disjuntorAberto(db, c.org, minutos(60 * 20))).toMatchObject({ ate: null, janela: "30min" });
    expect((await ultimosDisparos(db, c.org)).map((d) => d.reincidente)).toEqual([true, false, false]);
    const religados = await db.select().from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.acao, "pagamento.disjuntor_religado")));
    expect(religados).toHaveLength(2);
    expect(religados[0].usuarioId).not.toBeNull();
    // Religar sem disjuntor aberto: recusa clara.
    expect(await religarCartao(db, c.org, (await usuario()).id, minutos(60 * 25))).toMatchObject({ ok: true });
    expect(await religarCartao(db, c.org, (await usuario()).id, minutos(60 * 25))).toEqual({ ok: false, erro: "O cartão não está desligado pelo disjuntor." });
  });

  it("duas recusas ao mesmo tempo no limite abrem um disjuntor só", async () => {
    await recusasEm(Array.from({ length: 8 }, (_, i) => minutos(i)));
    const [a, b] = await Promise.all([avaliar(minutos(8)), avaliar(minutos(8))]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await linhas()).toHaveLength(1);
  });

  it("Início: o disjuntor aberto (até a hora ou até religar), o alerta a partir de 10 recusas em 24 h e o cartão em análise há mais de um dia", async () => {
    await recusasEm(Array.from({ length: ALERTA_RECUSAS_24H }, (_, i) => minutos(i * 10)));
    const textos = async (quando: Date, cenario: Cenario = c) => (await avisosDePagamento(db, cenario.org, quando, { env: env({}) })).alertas.map((a) => a.texto).join("\n");
    expect(await textos(minutos(100))).toContain("10 pagamentos com cartão recusados nas últimas 24 horas");
    expect(await textos(minutos(100))).toContain("O cartão desliga sozinho com 20");
    await recusasEm(Array.from({ length: 8 }, (_, i) => minutos(101 + i)));
    await avaliar(minutos(109));
    const aberto = await textos(minutos(110));
    // Na janela de 30 minutos entram também as duas recusas de 80 e 90 minutos.
    expect(aberto).toContain("Pagamento com cartão desligado até 01/10, 14:49: 10 recusas em 30 minutos");
    expect(aberto).toContain("O Pix continua");
    expect(aberto).not.toContain("recusados nas últimas 24 horas");

    const outro = await montarCenario(db);
    outro.provedor.respostaCartao = "em_analise";
    const s = await outro.segurar();
    await outro.cartao(s.cotacaoId);
    expect(await textos(minutos(60 * 23), outro)).not.toContain("em análise há mais de um dia");
    expect(await textos(minutos(60 * 25), outro)).toContain("1 pagamento(s) com cartão em análise há mais de um dia");
  });
});

/** Um usuário fictício da organização para religar (religar exige quem fez). */
async function usuario() {
  const [u] = await db.select().from(usuarios).where(eq(usuarios.organizacaoId, c.org));
  if (u) return u;
  const [novo] = await db.insert(usuarios).values({ organizacaoId: c.org, email: `equipe-${c.org.slice(0, 8)}@example.com`, nome: "Equipe Fictícia", papel: "admin" }).returning();
  return novo;
}
