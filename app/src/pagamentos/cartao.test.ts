import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lerRegrasCalendario, salvarRegrasCalendario } from "@/calendario/regras-config";
import { CONFIG_PAGAMENTO_SITE_PADRAO, salvarConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { aceitesSite, beds24Calendario, cotacoes, lancamentos, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { tentarCancelarReserva } from "@/reservas/repositorio";
import { expirarHoldsVencidos } from "@/site/cotacoes";
import { CARTOES_POR_HORA_NA_ORGANIZACAO, DESISTIR_SEM_ORDER_CARTAO_MS, MAXIMO_CARTAO_POR_COTACAO } from "./andamento";
import { pagarComCartao, recusaDoCartao } from "./cartao";
import { conferirTentativa, processarAvisoDeOrder } from "./conferencia";
import { vistaDaCotacaoParaHospede } from "./consultas";
import { chaveCriacao, referenciaDaTentativa } from "./criacao";
import { registrarLiberacaoManual } from "./liberacao";
import { gerarPix } from "./pix";
import { ErroProvedor } from "./provedor";
import { textosDosAvisos } from "./situacoes";
import { AGORA, CARTAO_FICTICIO, type Cenario, DISPOSITIVO_FICTICIO, DOCUMENTO_FICTICIO, EMAIL_HOSPEDE, minutos, montarCenario, semDadosPessoais, TOKEN_FICTICIO, TOTAL } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

const conferir = (id: string, quando: Date) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true });
const outras = (n: number) => ({ entrada: `2026-11-${String(2 + n * 4).padStart(2, "0")}`, saida: `2026-11-${String(5 + n * 4).padStart(2, "0")}`, email: `v${n}@example.com` });
const chamadas = (metodo: string) => c.provedor.chamadas.filter((x) => x.metodo === metodo).length;
const doCartao = (cotacaoId: string) => db.select().from(pagamentos).where(and(eq(pagamentos.cotacaoId, cotacaoId), eq(pagamentos.forma, "cartao")));
const vista = (cotacaoId: string, quando: Date, comAutorizacao = true) => vistaDaCotacaoParaHospede(db, c.org, cotacaoId, quando, { comAutorizacao, oferecido: true });
const travaOcupada = () => Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
/** O banco, com as transações de número `n` (contando a partir de 1) abortadas por tempo-limite de trava. */
const falhandoNas = (...n: number[]): Db => {
  let i = 0;
  return new Proxy(db, {
    get(alvo, k, r) {
      if (k === "transaction") return (...a: Parameters<Db["transaction"]>) => (n.includes(++i) ? Promise.reject(travaOcupada()) : alvo.transaction(...a));
      return Reflect.get(alvo, k, r);
    },
  });
};

describe("pagar com cartão (M8.2b): criação em três fases", () => {
  it("aprovado: a reserva confirma na fase 3; a tentativa guarda aceite, parcelas, bandeira e a verificação do banco pedida; o provedor recebeu documento e aparelho (nada disso guardado)", async () => {
    const s = await c.segurar();
    const r = await c.cartao(s.cotacaoId);
    expect(r.resultado).toEqual({ ok: true, pagamentoId: r.pagamentoId, situacao: "aprovado" });
    const p = await c.tentativa(r.pagamentoId!);
    expect(p).toMatchObject({
      forma: "cartao",
      situacao: "aprovado",
      desfecho: "reserva",
      valor: TOTAL,
      referencia: referenciaDaTentativa(p.id),
      chaveIdempotencia: chaveCriacao(p.id),
      parcelas: 1,
      bandeira: "master",
      tresDS: "on_fraud_risk",
      tresDSStatus: "AUTHENTICATED",
      comDispositivo: true,
      etapaCartao: null,
      desafioUrl: null,
      encerradoEm: null,
      contaNoDisjuntor: false,
    });
    expect(p.aceiteId).not.toBeNull();
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
    expect((await c.cotacao(s.cotacaoId)).estado).toBe("convertida");
    expect(c.provedor.ultimoPedidoCartao).toMatchObject({
      tipo: "credit_card",
      parcelas: 1,
      tresDS: "on_fraud_risk",
      bandeira: "master",
      email: EMAIL_HOSPEDE,
      emissor: null,
      documento: { tipo: "CPF", numero: DOCUMENTO_FICTICIO },
      sessaoDispositivo: DISPOSITIVO_FICTICIO,
      comToken: true,
      valor: TOTAL,
    });
    // A verificação do banco é um retrato do painel na criação: mudar depois vale só para os cartões novos.
    await salvarConfigPagamentoSite(db, c.org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, cartao: true, tresDS: "never" }, null);
    const s2 = await c.segurar(outras(0));
    const r2 = await c.cartao(s2.cotacaoId);
    expect(await c.tentativa(r2.pagamentoId!)).toMatchObject({ tresDS: "never", tresDSStatus: null });
    expect(c.provedor.ultimoPedidoCartao?.tresDS).toBe("never");
    expect((await c.tentativa(p.id)).tresDS).toBe("on_fraud_risk");
  });

  it("recusado: código genérico (o motivo fica só no detalhe), o prazo das datas não muda e a tentativa conta no disjuntor", async () => {
    const s = await c.segurar();
    const antes = (await c.cotacao(s.cotacaoId)).holdAte!;
    c.provedor.respostaCartao = "recusado";
    c.provedor.motivoRecusaCartao = "high_risk";
    const r = await c.cartao(s.cotacaoId, {}, minutos(1));
    expect(r.resultado).toMatchObject({ ok: false, codigo: "recusado" });
    expect(JSON.stringify(r.resultado)).not.toContain("high_risk");
    const p = await c.tentativa(r.pagamentoId!);
    expect(p).toMatchObject({ situacao: "recusado", contaNoDisjuntor: true, encerradoEm: minutos(1), idProvedor: expect.stringMatching(/^ORDTST/) });
    expect(p.detalheProvedor).toContain("high_risk");
    expect((await c.cotacao(s.cotacaoId)).holdAte?.toISOString()).toBe(antes.toISOString());
    // A vista do hóspede: datas seguradas, cartão recusado com o texto de sempre.
    expect(await vista(s.cotacaoId, minutos(2))).toMatchObject({ estado: "cartao_recusado", recusa: "cartao", cartaoRestantes: 2, forma: "cartao" });
  });

  it("motivos documentados da Orders API viram a mesma recusa; dados do cartão vencidos pedem preencher de novo; falha técnica do Mercado Pago é 'provedor'; verificação do banco pelo estado", () => {
    const recusado = (detalhe: string, tresDSStatus: Parameters<typeof recusaDoCartao>[0]["tresDSStatus"] = null) => recusaDoCartao({ situacao: "recusado", detalheProvedor: detalhe, tresDSStatus });
    for (const codigo of [
      "bad_filled_card_data",
      "rejected_by_issuer",
      "high_risk",
      "card_disabled",
      "required_call_for_authorize",
      "max_attempts_exceeded",
      "insufficient_amount",
      "card_insufficient_amount",
      "amount_limit_exceeded",
      "invalid_installments",
      "codigo_desconhecido",
      "blacklist",
    ])
      expect(recusado(`failed/failed; pagamento failed/${codigo}`)).toBe("recusado");
    expect(recusado("recusado/?")).toBe("recusado");
    for (const codigo of ["invalid_card_token", "card_token_not_found", "invalid_token"]) {
      expect(recusado(`failed/failed; pagamento failed/${codigo}`)).toBe("dados_cartao");
      expect(recusado(`dados_invalidos/${codigo}`)).toBe("dados_cartao");
    }
    expect(recusado("failed/failed; pagamento failed/processing_error")).toBe("provedor");
    // 3DS pelo estado: o sandbox encerra o desafio recusado como failed/failed.
    expect(recusado("failed/failed", "NOT_AUTHENTICATED")).toBe("verificacao");
    expect(recusado("failed/failed", "CHALLENGE")).toBe("verificacao");
    expect(recusado("failed/failed", "REJECTED")).toBe("verificacao");
    expect(recusado("failed/failed", "AUTHENTICATED")).toBe("recusado");
    expect(recusado("failed/failed; pagamento failed/cc_rejected_3ds_challenge")).toBe("verificacao");
    expect(recusado("failed/3ds_challenge_expired")).toBe("verificacao");
    expect(recusaDoCartao({ situacao: "recusado", detalheProvedor: "failed/failed", tresDSStatus: null }, { estavaNoDesafio: true })).toBe("verificacao");
    for (const situacao of ["cancelado", "expirado"] as const) expect(recusaDoCartao({ situacao, detalheProvedor: "canceled/expired", tresDSStatus: null })).toBe("verificacao");
    expect(recusaDoCartao({ situacao: "aprovado", detalheProvedor: "processed/accredited", tresDSStatus: null })).toBeNull();
  });

  it("de ponta a ponta: processing_error vira 'provedor' e token vencido 'dados_cartao' (nenhum dos dois conta no disjuntor); 402 sem a order no corpo é recusa e conta", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "recusado";
    c.provedor.motivoRecusaCartao = "processing_error";
    const a = await c.cartao(s.cotacaoId);
    expect(a.resultado).toMatchObject({ ok: false, codigo: "provedor" });
    expect(await c.tentativa(a.pagamentoId!)).toMatchObject({ situacao: "recusado", contaNoDisjuntor: false });
    c.provedor.motivoRecusaCartao = "invalid_card_token";
    const b = await c.cartao(s.cotacaoId);
    expect(b.resultado).toMatchObject({ ok: false, codigo: "dados_cartao" });
    expect(await c.tentativa(b.pagamentoId!)).toMatchObject({ situacao: "recusado", contaNoDisjuntor: false });
    c.provedor.respostaCartao = "recusado_sem_order";
    c.provedor.motivoRecusaCartao = "rejected_by_issuer";
    const d = await c.cartao(s.cotacaoId);
    expect(d.resultado).toMatchObject({ ok: false, codigo: "recusado" });
    expect(await c.tentativa(d.pagamentoId!)).toMatchObject({ situacao: "recusado", idProvedor: null, detalheProvedor: "recusado/rejected_by_issuer", contaNoDisjuntor: true });
  });

  it("3DS: desafio recusado (failed/failed com NOT_AUTHENTICATED) e verificação sem desafio recusada (NOT_AUTHENTICATED) dizem que a verificação do banco não foi concluída", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "desafio";
    const a = await c.cartao(s.cotacaoId);
    expect(a.resultado).toMatchObject({ ok: true, situacao: "desafio" });
    c.provedor.concluirDesafio(a.idProvedor!, "recusado");
    await conferir(a.pagamentoId!, minutos(5));
    const pa = await c.tentativa(a.pagamentoId!);
    expect(pa).toMatchObject({ situacao: "recusado", detalheProvedor: "failed/failed", tresDSStatus: "NOT_AUTHENTICATED", etapaCartao: null, desafioUrl: null, contaNoDisjuntor: true });
    expect(recusaDoCartao(pa)).toBe("verificacao");
    expect(await vista(s.cotacaoId, minutos(5))).toMatchObject({ estado: "cartao_recusado", recusa: "verificacao" });
    // OTHE-NAUT: a verificação sem desafio recusa na própria criação.
    c.provedor.respostaCartao = "recusado";
    c.provedor.tresDSStatus = "NOT_AUTHENTICATED";
    const b = await c.cartao(s.cotacaoId, {}, minutos(6));
    expect(b.resultado).toMatchObject({ ok: false, codigo: "verificacao" });
    // Desafio recusado com o código do 3DS na transação (outra forma documentada).
    c.provedor.tresDSStatus = "AUTHENTICATED";
    c.provedor.respostaCartao = "desafio";
    const d = await c.cartao(s.cotacaoId, {}, minutos(7));
    c.provedor.concluirDesafio(d.idProvedor!, "recusado", { detalhe: "cc_rejected_3ds_challenge" });
    await conferir(d.pagamentoId!, minutos(8));
    expect(recusaDoCartao(await c.tentativa(d.pagamentoId!))).toBe("verificacao");
  });

  it("antes de qualquer trava ou chamada: só crédito, token e bandeira com formato, parcelas de 1 a 36; acima do painel, recusado na fase 1 — nada chega ao provedor", async () => {
    const s = await c.segurar();
    expect((await c.cartao(s.cotacaoId, { tipo: "debit_card" })).resultado).toMatchObject({ ok: false, codigo: "so_credito" });
    expect((await c.cartao(s.cotacaoId, { tipo: "prepaid_card" })).resultado).toMatchObject({ ok: false, codigo: "so_credito" });
    expect((await c.cartao(s.cotacaoId, { token: "curto" })).resultado).toMatchObject({ ok: false, codigo: "dados_cartao" });
    expect((await c.cartao(s.cotacaoId, { bandeira: "<script>" })).resultado).toMatchObject({ ok: false, codigo: "dados_cartao" });
    for (const parcelas of [0, 37, 2.5, Number.NaN]) expect((await c.cartao(s.cotacaoId, { parcelas })).resultado).toMatchObject({ ok: false, codigo: "parcelas" });
    await salvarConfigPagamentoSite(db, c.org, { ...CONFIG_PAGAMENTO_SITE_PADRAO, oferecer: true, cartao: true, parcelasMaximas: 3 }, null);
    expect((await c.cartao(s.cotacaoId, { parcelas: 4 })).resultado).toMatchObject({ ok: false, codigo: "parcelas" });
    expect(chamadas("criarCartao")).toBe(0);
    expect(await doCartao(s.cotacaoId)).toEqual([]);
    // Dentro do painel, passa (bandeira em maiúsculas é normalizada).
    expect((await c.cartao(s.cotacaoId, { parcelas: 3, bandeira: "MASTER" })).resultado).toMatchObject({ ok: true });
    expect(c.provedor.ultimoPedidoCartao).toMatchObject({ parcelas: 3, bandeira: "master" });
  });

  it("aceite das páginas legais: sem aceite, recusado; versões mudadas, recusado; o aceite novo enviado junto é gravado com origem cartão", async () => {
    const s = await c.segurar({ semAceite: true });
    const pagar = (aceite: Parameters<typeof pagarComCartao>[6]) => pagarComCartao(db, c.org, s.cotacaoId, AGORA, c.provedor, CARTAO_FICTICIO, aceite);
    expect(await pagar({})).toMatchObject({ ok: false, codigo: "aceite_pendente" });
    expect(await pagar({ aceite: { termos: 99, privacidade: 99, cancelamento: 99 } })).toMatchObject({ ok: false, codigo: "aceite_mudou" });
    expect(chamadas("criarCartao")).toBe(0);
    const r = await pagar({ aceite: c.versoesLegais });
    expect(r).toMatchObject({ ok: true });
    const [aceite] = await db.select().from(aceitesSite).where(eq(aceitesSite.cotacaoId, s.cotacaoId));
    expect(aceite).toMatchObject({ origem: "cartao" });
    expect((await doCartao(s.cotacaoId))[0].aceiteId).toBe(aceite.id);
  });

  it("até 3 cartões por cotação (o Pix continua); 30 por hora na organização pelas linhas que chegaram ao Mercado Pago, nunca pelos cliques", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "recusado";
    for (let i = 0; i < MAXIMO_CARTAO_POR_COTACAO; i++) expect((await c.cartao(s.cotacaoId, {}, minutos(i))).resultado).toMatchObject({ ok: false, codigo: "recusado" });
    // 31 cliques recusados no teto da cotação não gastam o teto da organização.
    for (let i = 0; i < 31; i++) expect((await c.cartao(s.cotacaoId, {}, minutos(4))).resultado).toMatchObject({ ok: false, codigo: "limite" });
    expect(chamadas("criarCartao")).toBe(MAXIMO_CARTAO_POR_COTACAO);
    expect((await gerarPix(db, c.org, s.cotacaoId, minutos(4), c.provedor)).ok).toBe(true);
    c.provedor.respostaCartao = "aprovado";
    const outra = await c.segurar(outras(0), minutos(4));
    expect((await c.cartao(outra.cotacaoId, {}, minutos(5))).resultado).toMatchObject({ ok: true });
    // 30 tentativas de cartão gravadas na última hora (outras cotações): a próxima nem chega ao provedor.
    const terceira = await c.segurar(outras(1), minutos(5));
    const linha = (await doCartao(outra.cotacaoId))[0];
    await db.insert(pagamentos).values(
      Array.from({ length: CARTOES_POR_HORA_NA_ORGANIZACAO - 4 }, (_, i) => ({
        organizacaoId: c.org,
        cotacaoId: linha.cotacaoId,
        reservaId: linha.reservaId,
        imovelId: linha.imovelId,
        ambiente: "teste" as const,
        forma: "cartao" as const,
        situacao: "recusado" as const,
        valor: TOTAL,
        referencia: `scl-teste-${i}`,
        chaveIdempotencia: `teste-${i}`,
        criadoEm: minutos(5),
      })),
    );
    const antes = chamadas("criarCartao");
    expect((await c.cartao(terceira.cotacaoId, {}, minutos(6))).resultado).toMatchObject({ ok: false, codigo: "limite_geral" });
    expect(chamadas("criarCartao")).toBe(antes);
    // Passada uma hora daquelas linhas, cabe de novo (outra cotação, segurada agora).
    const quarta = await c.segurar(outras(2), minutos(66));
    expect((await c.cartao(quarta.cotacaoId, {}, minutos(66))).resultado).toMatchObject({ ok: true });
  });

  it("Pix pendente: o cartão o cancela no provedor (quem pediu: o hóspede) e relê antes; Pix pago nesse meio-tempo = 'já pago', nenhum cartão", async () => {
    const s = await c.segurar();
    const pix = await c.pix(s.cotacaoId);
    const r = await c.cartao(s.cotacaoId, {}, minutos(2));
    expect(r.resultado).toMatchObject({ ok: true, situacao: "aprovado" });
    expect(await c.tentativa(pix.pagamentoId)).toMatchObject({ situacao: "cancelado", cancelamentoPor: "hospede" });
    const outra = await c.segurar(outras(0), minutos(2));
    const pix2 = await c.pix(outra.cotacaoId, minutos(2));
    c.provedor.aprovar(pix2.idProvedor);
    const antes = chamadas("criarCartao");
    expect((await c.cartao(outra.cotacaoId, {}, minutos(3))).resultado).toMatchObject({ ok: false, codigo: "ja_pago" });
    expect(chamadas("criarCartao")).toBe(antes);
    expect((await c.reserva(outra.reservaId)).estado).toBe("confirmada");
  });

  it("cartão em análise: nem Pix nem outro cartão; processando: espera; no desafio do banco, um cartão novo ou um Pix cancelam o desafio (quem pediu: o hóspede)", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "em_analise";
    expect((await c.cartao(s.cotacaoId)).resultado).toMatchObject({ ok: true, situacao: "analise" });
    expect((await c.cartao(s.cotacaoId, {}, minutos(1))).resultado).toMatchObject({ ok: false, codigo: "em_analise" });
    expect(await gerarPix(db, c.org, s.cotacaoId, minutos(1), c.provedor)).toMatchObject({ ok: false, codigo: "em_analise" });
    const p = await c.segurar(outras(0));
    c.provedor.respostaCartao = "processando";
    expect((await c.cartao(p.cotacaoId)).resultado).toMatchObject({ ok: true, situacao: "conferindo" });
    expect((await c.cartao(p.cotacaoId, {}, minutos(1))).resultado).toMatchObject({ ok: false, codigo: "em_andamento" });
    expect(await gerarPix(db, c.org, p.cotacaoId, minutos(1), c.provedor)).toMatchObject({ ok: false, codigo: "em_andamento" });
    // Desafio trocado por outro cartão e depois por um Pix.
    const d = await c.segurar(outras(1));
    c.provedor.respostaCartao = "desafio";
    const a = await c.cartao(d.cotacaoId);
    expect(a.resultado).toMatchObject({ ok: true, situacao: "desafio" });
    const b = await c.cartao(d.cotacaoId, {}, minutos(2));
    expect(b.resultado).toMatchObject({ ok: true, situacao: "desafio" });
    expect(await c.tentativa(a.pagamentoId!)).toMatchObject({ situacao: "cancelado", cancelamentoPor: "hospede", contaNoDisjuntor: true, etapaCartao: null, desafioUrl: null });
    expect((await gerarPix(db, c.org, d.cotacaoId, minutos(3), c.provedor)).ok).toBe(true);
    expect(await c.tentativa(b.pagamentoId!)).toMatchObject({ situacao: "cancelado", cancelamentoPor: "hospede", contaNoDisjuntor: true });
  });
});

describe("cartão sem resposta conhecida (D18)", () => {
  it("resposta perdida: a order só aparece na busca depois de 20 min — não é dada por não feita aos 15, nada novo sai enquanto isso, e a order é aplicada quando achada", async () => {
    const s = await c.segurar();
    c.provedor.atrasoBuscaMs = 20 * 60_000;
    c.provedor.falhasDepois.criarCartao = new ErroProvedor("incerto", "conexão cortada");
    const r = await c.cartao(s.cotacaoId);
    expect(r.resultado).toMatchObject({ ok: false, codigo: "incerto" });
    c.provedor.falhasDepois.criarCartao = null;
    expect(await c.tentativa(r.pagamentoId!)).toMatchObject({ situacao: "incerta", idProvedor: null });
    c.relogio.agora = minutos(16);
    expect(await conferir(r.pagamentoId!, minutos(16))).toMatchObject({ ok: true, situacao: "incerta" });
    expect((await c.cartao(s.cotacaoId, {}, minutos(16))).resultado).toMatchObject({ ok: false, codigo: "em_andamento" });
    expect(await gerarPix(db, c.org, s.cotacaoId, minutos(16), c.provedor)).toMatchObject({ ok: false, codigo: "em_andamento" });
    expect(chamadas("criarCartao")).toBe(1);
    // A rotina não vence o pedido enquanto a criação não se resolve (carência), e aos 21 min a order aparece.
    c.relogio.agora = minutos(21);
    expect(await conferir(r.pagamentoId!, minutos(21))).toMatchObject({ ok: true, situacao: "aprovado" });
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
  });

  it("24 h sem a order nem pagamento na Payments API: criação não feita; com um pagamento na Payments API, nunca é dada por não feita", async () => {
    const s = await c.segurar();
    c.provedor.falhas.criarCartao = new ErroProvedor("incerto", "tempo esgotado");
    const r = await c.cartao(s.cotacaoId);
    c.provedor.falhas.criarCartao = null;
    expect(await c.tentativa(r.pagamentoId!)).toMatchObject({ situacao: "incerta" });
    const quase = new Date(AGORA.getTime() + DESISTIR_SEM_ORDER_CARTAO_MS - 60_000);
    expect(await conferir(r.pagamentoId!, quase)).toMatchObject({ ok: true, situacao: "incerta" });
    expect(chamadas("existePagamentoPorReferencia")).toBe(0);
    const depois = new Date(AGORA.getTime() + DESISTIR_SEM_ORDER_CARTAO_MS);
    expect(await conferir(r.pagamentoId!, depois)).toMatchObject({ ok: true, situacao: "cancelado" });
    expect(await c.tentativa(r.pagamentoId!)).toMatchObject({ situacao: "cancelado", detalheProvedor: "nao_criada", contaNoDisjuntor: false });
    expect(chamadas("existePagamentoPorReferencia")).toBe(1);

    // Outra cotação: a order existe, mas a busca das orders não a acha; a Payments API acha o pagamento.
    const o = await c.segurar(outras(0));
    c.provedor.falhasDepois.criarCartao = new ErroProvedor("incerto", "conexão cortada");
    const x = await c.cartao(o.cotacaoId);
    c.provedor.falhasDepois.criarCartao = null;
    c.provedor.buscarPorReferencia = async () => null;
    expect(await conferir(x.pagamentoId!, depois)).toMatchObject({ ok: true, situacao: "incerta" });
    expect(await conferir(x.pagamentoId!, new Date(depois.getTime() + 86_400_000))).toMatchObject({ ok: true, situacao: "incerta" });
    // Se a Payments API falha, nada se decide.
    c.provedor.falhas.existePagamentoPorReferencia = new ErroProvedor("incerto", "fora do ar");
    expect(await conferir(x.pagamentoId!, new Date(depois.getTime() + 2 * 86_400_000))).toMatchObject({ ok: false });
    expect((await c.tentativa(x.pagamentoId!)).situacao).toBe("incerta");
  });

  it("trava não obtida na fase 3: o id da order é gravado e a fase 3 é tentada de novo; na segunda falha, 'incerto' e a leitura seguinte vai pelo id", async () => {
    const s = await c.segurar();
    // Transações: 1 = fase 1, 2 = fase 3 (falha), 3 = gravar o id, 4 = fase 3 de novo.
    const r = await pagarComCartao(falhandoNas(2), c.org, s.cotacaoId, AGORA, c.provedor, CARTAO_FICTICIO);
    expect(r).toMatchObject({ ok: true, situacao: "aprovado" });
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");

    const o = await c.segurar(outras(0));
    const r2 = await pagarComCartao(falhandoNas(2, 4), c.org, o.cotacaoId, AGORA, c.provedor, CARTAO_FICTICIO);
    expect(r2).toMatchObject({ ok: false, codigo: "incerto" });
    const [p] = await doCartao(o.cotacaoId);
    expect(p).toMatchObject({ situacao: "criando", idProvedor: expect.stringMatching(/^ORDTST/) });
    const buscas = chamadas("buscarPorReferencia");
    expect(await conferir(p.id, minutos(1))).toMatchObject({ ok: true, situacao: "aprovado" });
    expect(chamadas("buscarPorReferencia")).toBe(buscas);
    expect(c.provedor.chamadas.at(-2)).toMatchObject({ metodo: "consultar", id: p.idProvedor });
    // Trava não obtida antes da chamada (fase 1): "ocupado", nada criado.
    const t = await c.segurar(outras(1));
    expect(await pagarComCartao(falhandoNas(1), c.org, t.cotacaoId, AGORA, c.provedor, CARTAO_FICTICIO)).toMatchObject({ ok: false, codigo: "ocupado" });
    expect(await doCartao(t.cotacaoId)).toEqual([]);
  });

  it("pedido que não chegou ao provedor: a tentativa é apagada (não conta no teto)", async () => {
    const s = await c.segurar();
    c.provedor.falhas.criarCartao = new ErroProvedor("indisponivel", "sem conexão");
    for (const m of [0, 1, 2, 3]) expect((await c.cartao(s.cotacaoId, {}, minutos(m))).resultado).toMatchObject({ ok: false, codigo: "provedor" });
    expect(await doCartao(s.cotacaoId)).toEqual([]);
    c.provedor.falhas.criarCartao = null;
    expect((await c.cartao(s.cotacaoId, {}, minutos(4))).resultado).toMatchObject({ ok: true });
  });

  it("cartão marcado como real (live_mode) no teste: nenhuma reserva; depois dele, nem cartão nem Pix", async () => {
    const s = await c.segurar();
    c.provedor.aoVivo = true;
    expect((await c.cartao(s.cotacaoId)).resultado).toMatchObject({ ok: false, codigo: "ao_vivo" });
    c.provedor.aoVivo = false;
    const [p] = await doCartao(s.cotacaoId);
    expect(p).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "ao_vivo", aoVivo: true });
    expect((await c.reserva(s.reservaId)).estado).toBe("pedido");
    expect((await c.cartao(s.cotacaoId, {}, minutos(1))).resultado).toMatchObject({ ok: false, codigo: "ja_pago" });
    const o = await c.segurar(outras(0));
    c.provedor.aoVivo = true;
    c.provedor.respostaCartao = "desafio";
    expect((await c.cartao(o.cotacaoId)).resultado).toMatchObject({ ok: false, codigo: "ao_vivo" });
    c.provedor.aoVivo = false;
    expect((await c.cartao(o.cotacaoId, {}, minutos(1))).resultado).toMatchObject({ ok: false, codigo: "ao_vivo" });
    expect(await gerarPix(db, c.org, o.cotacaoId, minutos(1), c.provedor)).toMatchObject({ ok: false, codigo: "ao_vivo" });
    // O desafio marcado como real foi cancelado pelo sistema (não conta no disjuntor).
    expect((await doCartao(o.cotacaoId))[0]).toMatchObject({ situacao: "cancelado", cancelamentoPor: "sistema", contaNoDisjuntor: false });
  });
});

describe("desafio do banco (3DS)", () => {
  it("desafio: as datas ficam seguradas até a criação + 42 min; o endereço é guardado e sai quando o desafio acaba; aprovado confirma", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "desafio";
    const r = await c.cartao(s.cotacaoId, {}, minutos(1));
    expect(r.resultado).toMatchObject({ ok: true, situacao: "desafio" });
    const p = await c.tentativa(r.pagamentoId!);
    expect(p).toMatchObject({ situacao: "pendente", etapaCartao: "desafio", desafioUrl: "https://www.mercadopago.com.br/checkout/v1/3ds/FALSO0001", tresDSStatus: "CHALLENGE" });
    expect((await c.cotacao(s.cotacaoId)).holdAte?.toISOString()).toBe(minutos(43).toISOString());
    expect(await vista(s.cotacaoId, minutos(2))).toMatchObject({ estado: "cartao_desafio", desafioUrl: p.desafioUrl, dinheiroSemDesfecho: true });
    expect(await vista(s.cotacaoId, minutos(2), false)).toMatchObject({ estado: "cartao_desafio", desafioUrl: null });
    // A leitura seguinte (GET, sem o endereço) não o apaga.
    await conferir(p.id, minutos(3));
    expect((await c.tentativa(p.id)).desafioUrl).toBe(p.desafioUrl);
    c.provedor.concluirDesafio(r.idProvedor!, "aprovado");
    await conferir(p.id, minutos(10));
    expect(await c.tentativa(p.id)).toMatchObject({ situacao: "aprovado", desfecho: "reserva", etapaCartao: null, desafioUrl: null, tresDSStatus: "AUTHENTICATED" });
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
  });

  it("aviso da order antes da fase 3 (sem o endereço): nenhum aviso de desafio sem endereço; a fase 3 traz o endereço e o desafio aparece", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "desafio";
    const original = c.provedor.criarCartao.bind(c.provedor);
    c.provedor.criarCartao = async (pedido) => {
      const res = await original(pedido);
      if (res.ok) await processarAvisoDeOrder(db, c.provedor, res.cobranca.idProvedor, AGORA);
      return res;
    };
    const r = await c.cartao(s.cotacaoId);
    expect(r.resultado).toMatchObject({ ok: true, situacao: "desafio" });
    const p = await c.tentativa(r.pagamentoId!);
    expect(p).toMatchObject({ etapaCartao: "desafio", desafioUrl: expect.stringMatching(/^https:\/\/www\.mercadopago\.com\.br\//) });
    expect(p.avisos).not.toContain("desafio_sem_url");
  });

  it("a criação pede o desafio sem um endereço válido: cancelado pelo sistema, 'verificacao', aviso no painel, não conta no disjuntor", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "desafio";
    const original = c.provedor.criarCartao.bind(c.provedor);
    c.provedor.criarCartao = async (pedido) => {
      const res = await original(pedido);
      return res.ok && res.cobranca.cartao ? { ...res, cobranca: { ...res.cobranca, cartao: { ...res.cobranca.cartao, desafioUrl: "https://exemplo.invalid/3ds" } } } : res;
    };
    const r = await c.cartao(s.cotacaoId);
    expect(r.resultado).toMatchObject({ ok: false, codigo: "verificacao" });
    const p = await c.tentativa(r.pagamentoId!);
    expect(p).toMatchObject({ situacao: "cancelado", cancelamentoPor: "sistema", contaNoDisjuntor: false, desafioUrl: null });
    expect(textosDosAvisos(p.avisos).join(" ")).toContain("não mandou um endereço válido");
  });

  it("desafio sem endereço válido cujo cancelamento falhou: a leitura seguinte (rotina ou página) manda cancelar de novo e não estende as datas", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "desafio";
    const original = c.provedor.criarCartao.bind(c.provedor);
    c.provedor.criarCartao = async (pedido) => {
      const res = await original(pedido);
      return res.ok && res.cobranca.cartao ? { ...res, cobranca: { ...res.cobranca, cartao: { ...res.cobranca.cartao, desafioUrl: "https://exemplo.invalid/3ds" } } } : res;
    };
    c.provedor.falhas.cancelar = new ErroProvedor("indisponivel", "sem conexão");
    const r = await c.cartao(s.cotacaoId);
    expect(r.resultado).toMatchObject({ ok: false, codigo: "verificacao" });
    let p = await c.tentativa(r.pagamentoId!);
    expect(p).toMatchObject({ situacao: "pendente", etapaCartao: "desafio", desafioUrl: null, cancelamentoPor: "sistema" });
    expect(p.avisos).toEqual(expect.arrayContaining(["desafio_sem_url", "cancelamento_pendente"]));
    const holdAntes = (await c.cotacao(s.cotacaoId)).holdAte?.toISOString();
    // O Mercado Pago volta: a próxima leitura (sem `daCriacao`) cancela; o desafio inútil não segura mais as datas.
    c.provedor.falhas.cancelar = null;
    await conferir(p.id, minutos(5));
    p = await c.tentativa(p.id);
    expect(p).toMatchObject({ situacao: "cancelado", cancelamentoPor: "sistema" });
    expect(p.avisos).not.toContain("cancelamento_pendente");
    expect((await c.cotacao(s.cotacaoId)).holdAte?.toISOString()).toBe(holdAntes);
  });

  it("desafio com o pedido não mais segurado (a equipe cancelou durante a chamada): cancelado pelo sistema, 'prazo'", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "desafio";
    const original = c.provedor.criarCartao.bind(c.provedor);
    c.provedor.criarCartao = async (pedido) => {
      const res = await original(pedido);
      await db.update(reservas).set({ estado: "cancelada" }).where(eq(reservas.id, s.reservaId));
      return res;
    };
    const r = await c.cartao(s.cotacaoId);
    expect(r.resultado).toMatchObject({ ok: false, codigo: "prazo" });
    expect(await c.tentativa(r.pagamentoId!)).toMatchObject({ situacao: "cancelado", cancelamentoPor: "sistema", contaNoDisjuntor: false });
  });
});

describe("cartão em análise ou processando", () => {
  it("extensão única por cotação: agora + os minutos do painel; a segunda não estende; 0 = nenhuma", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "processando";
    const r = await c.cartao(s.cotacaoId, {}, minutos(1));
    expect(r.resultado).toMatchObject({ ok: true, situacao: "conferindo" });
    expect(await c.tentativa(r.pagamentoId!)).toMatchObject({ etapaCartao: "processando", prazoAnaliseAte: minutos(61) });
    expect((await c.cotacao(s.cotacaoId)).holdAte?.toISOString()).toBe(minutos(61).toISOString());
    // Termina recusado; um segundo cartão em análise na mesma cotação não estende de novo.
    c.provedor.motivoRecusaCartao = "rejected_by_issuer";
    c.provedor.concluirAnalise(r.idProvedor!, "recusado");
    await conferir(r.pagamentoId!, minutos(10));
    c.provedor.respostaCartao = "em_analise";
    const r2 = await c.cartao(s.cotacaoId, {}, minutos(30));
    expect(r2.resultado).toMatchObject({ ok: true, situacao: "analise" });
    expect(await c.tentativa(r2.pagamentoId!)).toMatchObject({ etapaCartao: "analise", prazoAnaliseAte: null });
    expect((await c.cotacao(s.cotacaoId)).holdAte?.toISOString()).toBe(minutos(61).toISOString());
    expect(await vista(s.cotacaoId, minutos(31))).toMatchObject({ estado: "cartao_em_analise" });
    // Com 0 minutos no painel, nenhuma extensão.
    const regras = await lerRegrasCalendario(db, c.org);
    await salvarRegrasCalendario(db, c.org, { ...regras, site: { ...regras.site, minutosAnaliseCartao: 0 } }, null);
    const o = await c.segurar(outras(0));
    const antes = (await c.cotacao(o.cotacaoId)).holdAte!;
    const r3 = await c.cartao(o.cotacaoId, {}, minutos(1));
    expect(r3.resultado).toMatchObject({ ok: true, situacao: "analise" });
    expect(await c.tentativa(r3.pagamentoId!)).toMatchObject({ prazoAnaliseAte: null });
    expect((await c.cotacao(o.cotacaoId)).holdAte?.toISOString()).toBe(antes.toISOString());
  });

  it("depois da extensão e da carência o pedido vence; a aprovação tardia confirma com as noites livres e a leitura atual; ocupadas, fica sem reserva; cancelada pela equipe, nunca revive", async () => {
    c.provedor.respostaCartao = "em_analise";
    const a = await c.segurar();
    const ra = await c.cartao(a.cotacaoId);
    expect((await c.cotacao(a.cotacaoId)).holdAte?.toISOString()).toBe(minutos(60).toISOString());
    expect(await expirarHoldsVencidos(db, c.org, minutos(74))).toMatchObject({ expiradas: 0 });
    expect(await expirarHoldsVencidos(db, c.org, minutos(76))).toMatchObject({ expiradas: 1 });
    expect(await vista(a.cotacaoId, minutos(77))).toMatchObject({ estado: "cartao_em_analise" });
    c.provedor.concluirAnalise(ra.idProvedor!, "aprovado");
    expect(await conferir(ra.pagamentoId!, minutos(80))).toMatchObject({ ok: true, situacao: "aprovado" });
    expect(await c.tentativa(ra.pagamentoId!)).toMatchObject({ desfecho: "reserva", desfechoMotivo: "confirmada_tardia", etapaCartao: null });
    expect((await c.reserva(a.reservaId)).estado).toBe("confirmada");

    // Noites ocupadas por outro pedido depois do vencimento.
    const b = await c.segurar(outras(0), minutos(80));
    const rb = await c.cartao(b.cotacaoId, {}, minutos(80));
    await expirarHoldsVencidos(db, c.org, minutos(156));
    expect((await c.cotacao(b.cotacaoId)).estado).toBe("expirada");
    const outro = await c.segurar({ ...outras(0), email: "outro@example.com" }, minutos(157));
    expect(outro.cotacaoId).toBeTruthy();
    c.provedor.concluirAnalise(rb.idProvedor!, "aprovado");
    await conferir(rb.pagamentoId!, minutos(160));
    expect((await c.tentativa(rb.pagamentoId!)).motivoSemReserva).toMatch(/^noites_ocupadas/);

    // Cancelada pela equipe (a cotação): nunca revive.
    const d = await c.segurar(outras(1), minutos(160));
    const rd = await c.cartao(d.cotacaoId, {}, minutos(160));
    await db.update(cotacoes).set({ estado: "cancelada" }).where(eq(cotacoes.id, d.cotacaoId));
    c.provedor.concluirAnalise(rd.idProvedor!, "aprovado");
    await conferir(rd.pagamentoId!, minutos(165));
    expect((await c.tentativa(rd.pagamentoId!)).motivoSemReserva).toBe("cancelada_pela_equipe");
  });
});

describe("juros, parcelamento sem acréscimo e liberação", () => {
  it("parcelado com juros do hóspede: pago > valor confirma (juros só para mostrar); à vista com pago a mais é valor divergente", async () => {
    const s = await c.segurar();
    c.provedor.jurosCartao = 9_000;
    const r = await c.cartao(s.cotacaoId, { parcelas: 3 });
    expect(r.resultado).toMatchObject({ ok: true, situacao: "aprovado" });
    expect(await c.tentativa(r.pagamentoId!)).toMatchObject({ desfecho: "reserva", valor: TOTAL, valorPago: TOTAL + 9_000, parcelas: 3 });
    expect((await c.tentativa(r.pagamentoId!)).avisos).not.toContain("parcelas_sem_juros");
    expect((await c.reserva(s.reservaId)).valorBruto).toBe(TOTAL);

    const o = await c.segurar(outras(0));
    const original = c.provedor.criarCartao.bind(c.provedor);
    c.provedor.criarCartao = async (pedido) => {
      const res = await original(pedido);
      return res.ok ? { ...res, cobranca: { ...res.cobranca, pago: TOTAL + 100 } } : res;
    };
    const r2 = await c.cartao(o.cotacaoId);
    expect(r2.resultado).toMatchObject({ ok: true, situacao: "aprovado" });
    expect(await c.tentativa(r2.pagamentoId!)).toMatchObject({ desfecho: null, motivoSemReserva: "valor_divergente" });
  });

  it("parcelamento sem acréscimo (custo cobrado da SCL): aviso, taxa fora da reserva e nenhuma liberação lançada mesmo liberado; à vista sem custo, nenhum aviso", async () => {
    const s = await c.segurar();
    c.provedor.jurosPor = "vendedor";
    c.provedor.jurosCartao = 9_000;
    const r = await c.cartao(s.cotacaoId, { parcelas: 3 });
    expect(r.resultado).toMatchObject({ ok: true, situacao: "aprovado" });
    c.provedor.atualizarFinanceiro(r.idProvedor!, { taxa: 9_000 + 9_100, liquido: TOTAL - 18_100, liberado: true, liberacaoPrevista: minutos(-1) });
    await conferir(r.pagamentoId!, minutos(5));
    const p = await c.tentativa(r.pagamentoId!);
    expect(p.avisos).toContain("parcelas_sem_juros");
    expect(p).toMatchObject({ taxa: null, custoParcelasVendedor: 9_000, liberacaoConfirmadaEm: null, desfecho: "reserva" });
    expect((await c.reserva(s.reservaId)).taxaCanal).toBeNull();
    expect(await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, s.reservaId), eq(lancamentos.tipo, "recebimento")))).toEqual([]);

    const o = await c.segurar(outras(0));
    const r2 = await c.cartao(o.cotacaoId, { parcelas: 1 });
    c.provedor.atualizarFinanceiro(r2.idProvedor!, { taxa: 9_100, liquido: TOTAL - 9_100 });
    await conferir(r2.pagamentoId!, minutos(5));
    const p2 = await c.tentativa(r2.pagamentoId!);
    expect(p2.avisos).not.toContain("parcelas_sem_juros");
    expect(p2).toMatchObject({ taxa: 9_100, custoParcelasVendedor: 0 });
    expect((await c.reserva(o.reservaId)).taxaCanal).toBe(9_100);
  });

  it("parcelamento sem acréscimo: a trava fica de uma leitura para a outra (o custo lido uma vez e depois ausente nunca deixa a taxa nem a liberação entrarem sozinhas); só a liberação registrada à mão a solta", async () => {
    const s = await c.segurar();
    c.provedor.jurosPor = "vendedor";
    c.provedor.jurosCartao = 9_000;
    const r = await c.cartao(s.cotacaoId, { parcelas: 3 });
    c.provedor.atualizarFinanceiro(r.idProvedor!, { taxa: 9_000 + 9_100, liquido: TOTAL - 18_100 });
    await conferir(r.pagamentoId!, minutos(5));
    expect(await c.tentativa(r.pagamentoId!)).toMatchObject({ taxa: null, custoParcelasVendedor: 9_000 });
    // Leitura seguinte sem o custo (fee_details ausente ou ilegível), já liberado: nada entra sozinho.
    c.provedor.atualizarFinanceiro(r.idProvedor!, { custoParcelasVendedor: null, liberado: true, liberacaoPrevista: minutos(-1) });
    await conferir(r.pagamentoId!, minutos(10));
    const p = await c.tentativa(r.pagamentoId!);
    expect(p.avisos).toContain("parcelas_sem_juros");
    expect(p).toMatchObject({ taxa: null, custoParcelasVendedor: 9_000, liberacaoConfirmadaEm: null, liberacaoOrigem: null });
    expect((await c.reserva(s.reservaId)).taxaCanal).toBeNull();
    const recebimentos = () => db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, s.reservaId), eq(lancamentos.tipo, "recebimento")));
    expect(await recebimentos()).toEqual([]);
    // A equipe decide (a SCL fica com o custo) e registra a liberação à mão: o aviso sai e a taxa dela fica.
    expect(await registrarLiberacaoManual(db, c.org, r.pagamentoId!, { data: "2026-10-01", liquido: TOTAL - 9_100 }, null, minutos(15))).toEqual({ ok: true });
    await conferir(r.pagamentoId!, minutos(20));
    const depois = await c.tentativa(r.pagamentoId!);
    expect(depois.avisos).not.toContain("parcelas_sem_juros");
    expect(depois).toMatchObject({ taxa: 9_100, liberacaoOrigem: "manual" });
    expect((await c.reserva(s.reservaId)).taxaCanal).toBe(9_100);
    expect(await recebimentos()).toMatchObject([{ montante: TOTAL - 9_100, estado: "realizado" }]);
  });

  it("parcelamento sem acréscimo registrado à mão com o líquido do Mercado Pago e depois conciliado por ele: o aviso e a trava não voltam", async () => {
    const s = await c.segurar();
    c.provedor.jurosPor = "vendedor";
    c.provedor.jurosCartao = 9_000;
    const r = await c.cartao(s.cotacaoId, { parcelas: 3 });
    c.provedor.atualizarFinanceiro(r.idProvedor!, { taxa: 18_100, liquido: TOTAL - 18_100 });
    await conferir(r.pagamentoId!, minutos(5));
    expect(await registrarLiberacaoManual(db, c.org, r.pagamentoId!, { data: "2026-10-01", liquido: TOTAL - 18_100 }, null, minutos(10))).toEqual({ ok: true });
    c.provedor.atualizarFinanceiro(r.idProvedor!, { liberado: true, liberacaoPrevista: minutos(-1) });
    await conferir(r.pagamentoId!, minutos(20));
    expect(await c.tentativa(r.pagamentoId!)).toMatchObject({ liberacaoOrigem: "provedor", taxa: 18_100 });
    expect(await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, s.reservaId), eq(lancamentos.tipo, "recebimento")))).toMatchObject([{ montante: TOTAL - 18_100, estado: "conciliado" }]);
    await conferir(r.pagamentoId!, minutos(30));
    expect((await c.tentativa(r.pagamentoId!)).avisos).toEqual([]);
  });

  it("parcelado aprovado sem nenhum juro (pago igual ao valor) e custo zero: aviso e a mesma trava — taxa e liberação ficam para a equipe", async () => {
    const s = await c.segurar();
    const r = await c.cartao(s.cotacaoId, { parcelas: 3 });
    expect(await c.tentativa(r.pagamentoId!)).toMatchObject({ desfecho: "reserva", valorPago: TOTAL });
    c.provedor.atualizarFinanceiro(r.idProvedor!, { taxa: 9_100, liquido: TOTAL - 9_100, liberado: true, liberacaoPrevista: minutos(-1) });
    await conferir(r.pagamentoId!, minutos(5));
    const p = await c.tentativa(r.pagamentoId!);
    expect(p.avisos).toContain("parcelas_sem_juros");
    expect(p).toMatchObject({ taxa: null, custoParcelasVendedor: 0, liberacaoConfirmadaEm: null });
    expect((await c.reserva(s.reservaId)).taxaCanal).toBeNull();
    expect(await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, s.reservaId), eq(lancamentos.tipo, "recebimento")))).toEqual([]);
  });

  it("parcelado com o custo das parcelas desconhecido: aviso próprio, nada lançado (nunca supor zero); quando o custo vem zero, taxa e liberação entram", async () => {
    const s = await c.segurar();
    c.provedor.jurosCartao = 9_000;
    const r = await c.cartao(s.cotacaoId, { parcelas: 3 });
    c.provedor.atualizarFinanceiro(r.idProvedor!, { taxa: 9_100, liquido: TOTAL - 9_100, custoParcelasVendedor: null, liberado: true, liberacaoPrevista: minutos(-1) });
    await conferir(r.pagamentoId!, minutos(5));
    const p = await c.tentativa(r.pagamentoId!);
    expect(p.avisos).toContain("custo_parcelas_desconhecido");
    expect(p.avisos).not.toContain("parcelas_sem_juros");
    expect(textosDosAvisos(p.avisos)[0]).toContain("não se cobrou da SCL algum custo das parcelas");
    expect(p).toMatchObject({ taxa: null, custoParcelasVendedor: null, liberacaoConfirmadaEm: null });
    expect((await c.reserva(s.reservaId)).taxaCanal).toBeNull();
    const recebimentos = () => db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, s.reservaId), eq(lancamentos.tipo, "recebimento")));
    expect(await recebimentos()).toEqual([]);
    c.provedor.atualizarFinanceiro(r.idProvedor!, { custoParcelasVendedor: 0 });
    await conferir(r.pagamentoId!, minutos(10));
    const depois = await c.tentativa(r.pagamentoId!);
    expect(depois.avisos).not.toContain("custo_parcelas_desconhecido");
    expect(depois).toMatchObject({ taxa: 9_100, custoParcelasVendedor: 0, liberacaoOrigem: "provedor" });
    expect((await c.reserva(s.reservaId)).taxaCanal).toBe(9_100);
    expect(await recebimentos()).toMatchObject([{ montante: TOTAL - 9_100, estado: "conciliado" }]);
  });

  it("liberação parcela a parcela: liberado nunca lança o recebimento; aviso para registrar à mão", async () => {
    const s = await c.segurar();
    c.provedor.liberacaoEmParcelas = true;
    const r = await c.cartao(s.cotacaoId, { parcelas: 1 });
    c.provedor.atualizarFinanceiro(r.idProvedor!, { taxa: 9_100, liquido: TOTAL - 9_100, liberado: true, liberacaoPrevista: minutos(-1) });
    await conferir(r.pagamentoId!, minutos(5));
    const p = await c.tentativa(r.pagamentoId!);
    expect(p.avisos).toContain("liberacao_em_parcelas");
    expect(p).toMatchObject({ taxa: 9_100, liberacaoConfirmadaEm: null, idPagamentoProvedor: expect.stringMatching(/^\d+$/) });
    expect(await db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, s.reservaId), eq(lancamentos.tipo, "recebimento")))).toEqual([]);
  });
});

describe("aparelho e dados pessoais", () => {
  it("o id do aparelho vai ao provedor e nunca é guardado (só `com_dispositivo`); com formato inválido, não vai", async () => {
    const s = await c.segurar();
    const r = await c.cartao(s.cotacaoId);
    expect(c.provedor.ultimoPedidoCartao?.sessaoDispositivo).toBe(DISPOSITIVO_FICTICIO);
    expect((await c.tentativa(r.pagamentoId!)).comDispositivo).toBe(true);
    const o = await c.segurar(outras(0));
    const r2 = await c.cartao(o.cotacaoId, { dispositivo: "com espaço e acentuação" });
    expect(c.provedor.ultimoPedidoCartao?.sessaoDispositivo).toBeNull();
    expect((await c.tentativa(r2.pagamentoId!)).comDispositivo).toBe(false);
    const t = await c.segurar(outras(1));
    const r3 = await c.cartao(t.cotacaoId, { dispositivo: null });
    expect(r3.resultado).toMatchObject({ ok: true });
    expect((await c.tentativa(r3.pagamentoId!)).comDispositivo).toBe(false);
  });

  it("depois de aprovado, recusado, em análise e desafio: nenhum token, documento, id do aparelho, e-mail ou nome do titular nas tabelas do pagamento", async () => {
    const a = await c.segurar();
    await c.cartao(a.cotacaoId);
    const b = await c.segurar(outras(0));
    c.provedor.respostaCartao = "recusado";
    await c.cartao(b.cotacaoId);
    c.provedor.respostaCartao = "recusado_sem_order";
    await c.cartao(b.cotacaoId);
    const d = await c.segurar(outras(1));
    c.provedor.respostaCartao = "em_analise";
    await c.cartao(d.cotacaoId);
    const e = await c.segurar(outras(2));
    c.provedor.respostaCartao = "desafio";
    const re = await c.cartao(e.cotacaoId);
    c.provedor.concluirDesafio(re.idProvedor!, "recusado");
    await conferir(re.pagamentoId!, minutos(5));
    expect(await semDadosPessoais(db, [TOKEN_FICTICIO, DOCUMENTO_FICTICIO, DISPOSITIVO_FICTICIO, EMAIL_HOSPEDE, "v0@example.com", "v1@example.com", "v2@example.com", "test@testuser.com", "APRO"])).toEqual([]);
    // A leitura do Beds24 continua (o cenário é fictício): nada daqui depende dela.
    expect((await db.select().from(beds24Calendario).where(eq(beds24Calendario.organizacaoId, c.org))).length).toBeGreaterThan(0);
  });
});

describe("a equipe e as sobras (M8.2b)", () => {
  it("cartão em andamento: a equipe não cancela nem confirma à mão (o aviso fala do cartão, sem prazo)", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "em_analise";
    await c.cartao(s.cotacaoId);
    const cancelar = await tentarCancelarReserva(db, c.org, s.reservaId, null);
    expect(cancelar).toMatchObject({ ok: false, aviso: expect.stringContaining("há um pagamento com cartão em andamento (verificação do banco, processamento ou análise do Mercado Pago)") });
    expect((await c.reserva(s.reservaId)).estado).toBe("pedido");
  });

  it("dinheiro chegou noutra tentativa: o cartão pendente que sobrou é cancelado pelo sistema (não conta no disjuntor)", async () => {
    const s = await c.segurar();
    const pix = await c.pix(s.cotacaoId);
    // Um desafio que ficou de pé ao lado do Pix (só dá para montar assim: o domínio cancela um antes do outro).
    c.provedor.respostaCartao = "desafio";
    const criado = await c.provedor.criarCartao({ ...CARTAO_FICTICIO, referencia: "scl-sobra-0001", chaveIdempotencia: "sobra-0001", valor: TOTAL, tipo: "credit_card", tresDS: "on_fraud_risk", emissor: null, email: EMAIL_HOSPEDE, sessaoDispositivo: null, descricao: "x", descricaoFatura: null });
    if (!criado.ok) throw new Error("desafio não criado");
    const [pixRow] = await db.select().from(pagamentos).where(eq(pagamentos.id, pix.pagamentoId));
    const { id: _id, ...base } = pixRow;
    void _id;
    const [sobra] = await db
      .insert(pagamentos)
      .values({ ...base, forma: "cartao", referencia: "scl-sobra-0001", chaveIdempotencia: "sobra-0001", idProvedor: criado.cobranca.idProvedor, pixCopiaECola: null, pixImagem: null, pixLink: null, pixExpiraEm: null, etapaCartao: "desafio", desafioUrl: criado.cobranca.cartao!.desafioUrl })
      .returning();
    c.provedor.aprovar(pix.idProvedor);
    expect(await conferir(pix.pagamentoId, minutos(2))).toMatchObject({ ok: true, situacao: "aprovado", canceladas: 1 });
    expect(await c.tentativa(sobra.id)).toMatchObject({ situacao: "cancelado", cancelamentoPor: "sistema", contaNoDisjuntor: false });
  });
});

