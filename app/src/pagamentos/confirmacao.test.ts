import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditoria, beds24Calendario, cotacoes, lancamentos, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { lancamentoEmConferencia, lancamentoEmVigor } from "@/portal/posse";
import { partesDisponiveis } from "@/repasses/extrato";
import { registrarRecebimento } from "@/repasses/recebimentos";
import { gerarAntecipado } from "@/repasses/repasses";
import { confirmarReserva, criarReserva, tentarCancelarReserva } from "@/reservas/repositorio";
import { criarCotacao, ERRO_EMAIL_EM_ANDAMENTO, expirarHoldsVencidos, segurarDatas } from "@/site/cotacoes";
import { CARENCIA_PAGAMENTO_MS } from "./andamento";
import { conferirTentativa } from "./conferencia";
import { valorConfere } from "./confirmacao";
import { registrarDevolucaoPorFora } from "./devolucao";
import { gerarPix } from "./pix";
import { conferirPendentes } from "./rotina";
import type { Cobranca } from "./provedor";
import { textosDosAvisos } from "./situacoes";
import { chaveCriacao, referenciaDaTentativa } from "./criacao";
import { AGORA, alteracaoGravada, alterar, type Cenario, cancelar, EMAIL_HOSPEDE, entradaPadrao, envelhecer, liberar, minutos, montarCenario, pagarDiferenca, pagarEConfirmar, TOTAL, usuarioDeTeste } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

const conferir = (id: string, quando: Date, extra: { cobranca?: Cobranca } = {}) => conferirTentativa(db, c.org, id, c.provedor, quando, { origem: "rotina", forcar: true, ...extra });
const doMotor = (reservaId: string) => db.select().from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), eq(lancamentos.origem, "motor")));

/** Segura as datas e gera o Pix; T = o prazo das datas depois do Pix (vencimento do Pix + 2 min). */
async function comPix(over: Parameters<Cenario["segurar"]>[0] = {}) {
  const s = await c.segurar(over);
  const p = await c.pix(s.cotacaoId);
  const T = (await c.cotacao(s.cotacaoId)).holdAte!;
  return { ...s, ...p, T };
}

describe("confirmação pelo pagamento (M8.2a)", () => {
  it("aprovado com as datas seguradas: reserva confirmada (quem recebe = empresa), cotação convertida, motor rodou, desfecho reserva, auditoria sem dados do pagador", async () => {
    const x = await comPix();
    c.provedor.aprovar(x.idProvedor);
    const quando = minutos(3);
    expect(await conferir(x.pagamentoId, quando)).toMatchObject({ ok: true, situacao: "aprovado", mudou: true });
    const r = await c.reserva(x.reservaId);
    expect(r).toMatchObject({ estado: "confirmada", recebimento: "empresa", hospedeEmail: EMAIL_HOSPEDE });
    expect(r.confirmadaEm?.toISOString()).toBe(quando.toISOString());
    expect((await c.cotacao(x.cotacaoId)).estado).toBe("convertida");
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: "reserva", desfechoMotivo: "confirmada", motivoSemReserva: null, aprovadoEm: quando, pixCopiaECola: null });
    expect((await doMotor(x.reservaId)).map((l) => l.tipo).sort()).toEqual(["comissao", "direito_proprietario", "receita_bruta"]);
    const [aud] = await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, x.reservaId), eq(auditoria.acao, "pagamento.confirmar")));
    expect(aud.mudancas).toEqual({ estado: ["pedido", "confirmada"], pagamento: [null, x.pagamentoId] });
    // O retorno do navegador nunca confirma: só a leitura. Reaplicar não muda nada (idempotente).
    expect(await conferir(x.pagamentoId, minutos(4))).toMatchObject({ ok: true, mudou: false });
    expect(await doMotor(x.reservaId)).toHaveLength(3);
  });

  it("carência: Pix pago 10 s antes do prazo e processado 5 min depois confirma; nesse meio-tempo ninguém fica com as noites", async () => {
    const x = await comPix();
    c.relogio.agora = new Date(x.T.getTime() - 10_000);
    c.provedor.aprovar(x.idProvedor);
    // Um minuto depois do prazo, a rotina não vence o pedido (pagamento em andamento) e outro visitante não consegue as noites.
    const t1 = new Date(x.T.getTime() + 60_000);
    expect(await expirarHoldsVencidos(db, c.org, t1)).toMatchObject({ expiradas: 0 });
    expect(await expirarHoldsVencidos(db, null, t1)).toMatchObject({ expiradas: 0 });
    expect(await criarCotacao(db, c.org, { imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "3" }, t1)).toMatchObject({ ok: false, erro: "Essas datas não estão disponíveis." });
    expect((await c.reserva(x.reservaId)).estado).toBe("pedido");
    expect(await conferir(x.pagamentoId, new Date(x.T.getTime() + 5 * 60_000))).toMatchObject({ ok: true, situacao: "aprovado" });
    expect((await c.reserva(x.reservaId)).estado).toBe("confirmada");
    expect(CARENCIA_PAGAMENTO_MS).toBe(15 * 60_000);
  });

  it("sem pagamento, a carência acaba: depois de 15 min do prazo o pedido vence; Pix já lido como vencido não segura nada", async () => {
    const x = await comPix();
    expect(await expirarHoldsVencidos(db, c.org, new Date(x.T.getTime() + 14 * 60_000))).toMatchObject({ expiradas: 0 });
    expect(await expirarHoldsVencidos(db, c.org, new Date(x.T.getTime() + 15 * 60_000))).toMatchObject({ expiradas: 1 });
    expect((await c.reserva(x.reservaId)).estado).toBe("cancelada");
    // Outro pedido: o Pix venceu e foi lido; no prazo, sem carência, vence.
    const y = await comPix({ entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    c.provedor.expirar(y.idProvedor);
    await conferir(y.pagamentoId, y.T);
    expect(await expirarHoldsVencidos(db, c.org, y.T)).toMatchObject({ expiradas: 1 });
  });

  it("aprovação tardia: só revive a cotação expirada, com as noites livres no SCL e na leitura atual do Beds24 — a mesma reserva", async () => {
    const x = await comPix();
    const vencido = new Date(x.T.getTime() + 16 * 60_000);
    await expirarHoldsVencidos(db, c.org, vencido);
    expect((await c.cotacao(x.cotacaoId)).estado).toBe("expirada");
    const codigo = (await c.reserva(x.reservaId)).codigo;
    c.provedor.aprovar(x.idProvedor);
    expect(await conferir(x.pagamentoId, vencido)).toMatchObject({ ok: true, situacao: "aprovado" });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "confirmada", codigo, canceladaEm: null });
    expect((await c.cotacao(x.cotacaoId)).estado).toBe("convertida");
    expect((await c.tentativa(x.pagamentoId)).desfechoMotivo).toBe("confirmada_tardia");
    expect(await db.select().from(auditoria).where(and(eq(auditoria.entidadeId, x.reservaId), eq(auditoria.acao, "pagamento.confirmar_tardio")))).toHaveLength(1);
  });

  it("aprovação tardia sem leitura atual do Beds24, ou com as noites ocupadas: aprovado sem reserva, com o motivo", async () => {
    const x = await comPix();
    const vencido = new Date(x.T.getTime() + 16 * 60_000);
    await expirarHoldsVencidos(db, c.org, vencido);
    await db.delete(beds24Calendario).where(and(eq(beds24Calendario.organizacaoId, c.org), eq(beds24Calendario.data, "2026-10-13")));
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, vencido);
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "sem_leitura" });
    expect((await c.reserva(x.reservaId)).estado).toBe("cancelada");

    const y = await comPix({ entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    const vencidoY = new Date(y.T.getTime() + 16 * 60_000);
    await expirarHoldsVencidos(db, c.org, vencidoY);
    const outra = await criarReserva(db, c.org, { imovelId: c.imovel, origem: "booking", estado: "confirmada", checkin: "2026-11-03", checkout: "2026-11-06", hospedes: 2, hospedeNome: "Outro Fictício", hospedeEmail: "", hospedeTelefone: "", hospedeOrigem: "", moeda: "BRL", valorBruto: 100000, taxaCanal: 15000, valorLiquido: null, codigoCanal: "", observacoes: "" }, null);
    if (!outra.ok) throw new Error("reserva");
    c.provedor.aprovar(y.idProvedor);
    await conferir(y.pagamentoId, vencidoY);
    expect((await c.tentativa(y.pagamentoId)).motivoSemReserva).toBe(`noites_ocupadas:${outra.reserva.codigo}`);
  });

  it("pedido cancelado pela equipe nunca é revivido (antes ou depois da rotina)", async () => {
    const x = await comPix();
    // Pix lido como vencido; a equipe cancela o pedido (sem pagamento em andamento, é permitido).
    c.provedor.expirar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(31));
    expect(await tentarCancelarReserva(db, c.org, x.reservaId, null)).toEqual({ ok: true });
    // O provedor depois informa aprovado (pago no último segundo): expirado → aprovado vale, mas não confirma.
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(33));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "cancelada_pela_equipe" });
    expect((await c.reserva(x.reservaId)).estado).toBe("cancelada");
    // Depois da rotina (cotação cancelada), também não.
    const y = await comPix({ entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    c.provedor.expirar(y.idProvedor);
    await conferir(y.pagamentoId, minutos(31));
    await tentarCancelarReserva(db, c.org, y.reservaId, null);
    await expirarHoldsVencidos(db, c.org, minutos(34));
    expect((await c.cotacao(y.cotacaoId)).estado).toBe("cancelada");
    c.provedor.aprovar(y.idProvedor);
    await conferir(y.pagamentoId, minutos(35));
    expect((await c.tentativa(y.pagamentoId)).motivoSemReserva).toBe("cancelada_pela_equipe");
  });

  it("conflito com outra reserva nas mesmas noites (importada no meio do hold): aprovado sem reserva, com o código da outra", async () => {
    const x = await comPix();
    const [outra] = await db
      .insert(reservas)
      .values({ organizacaoId: c.org, imovelId: c.imovel, codigo: "SCL-OTA001", origem: "airbnb", estado: "confirmada", checkin: "2026-10-14", checkout: "2026-10-16", fonte: "beds24", idFonte: "99" })
      .returning();
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(3));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: null, motivoSemReserva: `conflito:${outra.codigo}` });
    expect((await c.reserva(x.reservaId)).estado).toBe("pedido");
  });

  it("valor aprovado diferente do total da cotação; aviso com live_mode; segunda aprovação da mesma cotação: aprovado sem reserva", async () => {
    const x = await comPix();
    await db.update(cotacoes).set({ total: TOTAL + 100 }).where(eq(cotacoes.id, x.cotacaoId));
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(3));
    expect((await c.tentativa(x.pagamentoId)).motivoSemReserva).toBe("valor_divergente");
    expect((await c.reserva(x.reservaId)).estado).toBe("pedido");

    const y = await comPix({ entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === y.idProvedor);
    await conferir(y.pagamentoId, minutos(3), { cobranca: { ...order, situacao: "aprovado", aoVivo: true } });
    expect(await c.tentativa(y.pagamentoId)).toMatchObject({ motivoSemReserva: "ao_vivo", aoVivo: true });
    expect((await c.tentativa(y.pagamentoId)).avisos).toContain("ao_vivo");

    // Duas tentativas da mesma cotação pagas antes da conferência: a primeira confirma, a segunda fica para devolver.
    const z = await comPix({ entrada: "2026-11-10", saida: "2026-11-13", email: "z@example.com" });
    const extra = await c.provedor.criarPix({ referencia: "scl-extra-0001", chaveIdempotencia: "extra-0001", valor: TOTAL, email: "test@testuser.com", nome: "", validadeMinutos: 30, descricao: "", descricaoFatura: null });
    if (!extra.ok) throw new Error("extra");
    const [segunda] = await db.insert(pagamentos).values({ organizacaoId: c.org, cotacaoId: z.cotacaoId, reservaId: z.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: "scl-extra-0001", chaveIdempotencia: "extra-0001", situacao: "pendente", idProvedor: extra.cobranca.idProvedor, valor: TOTAL }).returning();
    c.provedor.aprovar(z.idProvedor);
    c.provedor.aprovar(extra.cobranca.idProvedor);
    await conferir(z.pagamentoId, minutos(4));
    expect((await c.tentativa(z.pagamentoId)).desfecho).toBe("reserva");
    // A confirmação tenta cancelar a outra; já paga, a leitura a decide: outra tentativa já tem a reserva.
    expect(c.provedor.chamadas.some((ch) => ch.metodo === "cancelar" && ch.id === extra.cobranca.idProvedor)).toBe(true);
    expect(await c.tentativa(segunda.id)).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "outra_tentativa" });
  });

  it("valor: o valor da transação (que precisa vir) e o total pago, quando vier, também têm de bater com o total da cotação", async () => {
    const leitura = async (over: Partial<Cobranca>, n: number) => {
      const x = await comPix({ entrada: `2026-11-${String(2 + n * 4).padStart(2, "0")}`, saida: `2026-11-${String(5 + n * 4).padStart(2, "0")}`, email: `v${n}@example.com` });
      c.provedor.aprovar(x.idProvedor);
      const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
      await conferir(x.pagamentoId, minutos(3), { cobranca: { ...order, ...over } });
      return { ...x, t: await c.tentativa(x.pagamentoId), r: await c.reserva(x.reservaId) };
    };
    for (const [over, n] of [[{ valorTransacao: TOTAL - 1 }, 0], [{ valorTransacao: null }, 1], [{ pago: TOTAL + 100 }, 2]] as const) {
      const { t, r } = await leitura(over, n);
      expect(t).toMatchObject({ desfecho: null, motivoSemReserva: "valor_divergente" });
      expect(r.estado).toBe("pedido");
    }
    // Tudo igual (e o pago ausente): confirma.
    expect((await leitura({ pago: null }, 3)).t).toMatchObject({ desfecho: "reserva" });
  });

  it("pedido com pagamento aprovado sem reserva: a confirmação à mão é recusada, apontando para o quadro do pagamento", async () => {
    const x = await comPix();
    await db.update(cotacoes).set({ total: TOTAL + 100 }).where(eq(cotacoes.id, x.cotacaoId));
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(3));
    expect((await c.tentativa(x.pagamentoId)).motivoSemReserva).toBe("valor_divergente");
    expect(await confirmarReserva(db, c.org, x.reservaId, null, minutos(4))).toEqual({
      ok: false,
      aviso: 'Não confirmada: este pedido tem um pagamento do site aprovado sem reserva, a devolver ao hóspede. Resolva pelo quadro "Pagamento no site" desta reserva antes de confirmar à mão.',
    });
    expect((await c.reserva(x.reservaId)).estado).toBe("pedido");
  });

  it("dinheiro que chega já devolvido em parte ou contestado (sem leitura 'aprovado' antes): nunca confirma; fica sem reserva, com aviso", async () => {
    for (const [n, simular] of [[0, (id: string) => c.provedor.devolverNoProvedor(id, 1000)], [1, (id: string) => c.provedor.contestar(id)]] as const) {
      const x = await comPix({ entrada: `2026-11-${String(2 + n * 4).padStart(2, "0")}`, saida: `2026-11-${String(5 + n * 4).padStart(2, "0")}`, email: `w${n}@example.com` });
      c.provedor.aprovar(x.idProvedor);
      simular(x.idProvedor);
      await conferir(x.pagamentoId, minutos(3));
      const t = await c.tentativa(x.pagamentoId);
      expect(t).toMatchObject({ situacao: n === 0 ? "devolvido_parcial" : "contestado", desfecho: null, motivoSemReserva: "situacao_inesperada" });
      expect(t.avisos).toContain("situacao_inesperada");
      expect((await c.reserva(x.reservaId)).estado).toBe("pedido");
      // Ler de novo não decide nada.
      await conferir(x.pagamentoId, minutos(5));
      expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: null, motivoSemReserva: "situacao_inesperada" });
    }
  });

  it("a confirmação cancela no provedor o outro Pix pendente da cotação", async () => {
    const z = await comPix();
    const extra = await c.provedor.criarPix({ referencia: "scl-extra-0002", chaveIdempotencia: "extra-0002", valor: TOTAL, email: "test@testuser.com", nome: "", validadeMinutos: 30, descricao: "", descricaoFatura: null });
    if (!extra.ok) throw new Error("extra");
    const [segunda] = await db.insert(pagamentos).values({ organizacaoId: c.org, cotacaoId: z.cotacaoId, reservaId: z.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: "scl-extra-0002", chaveIdempotencia: "extra-0002", situacao: "pendente", idProvedor: extra.cobranca.idProvedor, valor: TOTAL }).returning();
    c.provedor.aprovar(z.idProvedor);
    await conferir(z.pagamentoId, minutos(4));
    expect((await c.tentativa(segunda.id)).situacao).toBe("cancelado");
  });

  it("dinheiro que chega sem confirmar a reserva (Pix vencido pago depois, com as noites já ocupadas): o outro Pix pendente da cotação é cancelado no provedor, na leitura e pela rotina", async () => {
    const z = await comPix();
    const extra = await c.provedor.criarPix({ referencia: "scl-extra-0004", chaveIdempotencia: "extra-0004", valor: TOTAL, email: "test@testuser.com", nome: "", validadeMinutos: 30, descricao: "", descricaoFatura: null });
    if (!extra.ok) throw new Error("extra");
    const [segunda] = await db.insert(pagamentos).values({ organizacaoId: c.org, cotacaoId: z.cotacaoId, reservaId: z.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: "scl-extra-0004", chaveIdempotencia: "extra-0004", situacao: "pendente", idProvedor: extra.cobranca.idProvedor, valor: TOTAL }).returning();
    // O valor aprovado não bate com a cotação: aprovado sem reserva (nenhum desfecho).
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, z.cotacaoId));
    c.provedor.aprovar(z.idProvedor);
    await conferir(z.pagamentoId, minutos(4));
    expect(await c.tentativa(z.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "valor_divergente" });
    expect((await c.tentativa(segunda.id)).situacao).toBe("cancelado");
    // E a rotina também cancela o que sobrar numa cotação com dinheiro, mesmo sem reserva confirmada.
    const outra = await c.provedor.criarPix({ referencia: "scl-extra-0005", chaveIdempotencia: "extra-0005", valor: TOTAL, email: "test@testuser.com", nome: "", validadeMinutos: 30, descricao: "", descricaoFatura: null });
    if (!outra.ok) throw new Error("outra");
    const [terceira] = await db.insert(pagamentos).values({ organizacaoId: c.org, cotacaoId: z.cotacaoId, reservaId: z.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: "scl-extra-0005", chaveIdempotencia: "extra-0005", situacao: "pendente", idProvedor: outra.cobranca.idProvedor, valor: TOTAL, criadoEm: minutos(5) }).returning();
    await conferirPendentes(db, c.org, c.provedor, minutos(6));
    expect((await c.tentativa(terceira.id)).situacao).toBe("cancelado");
  });

  it("Pix que sobrou pendente numa cotação confirmada, mas fora do prazo do provedor (85 dias): a rotina não cancela nem relê; fica o aviso", async () => {
    const z = await comPix();
    c.provedor.aprovar(z.idProvedor);
    await conferir(z.pagamentoId, minutos(4));
    expect((await c.tentativa(z.pagamentoId)).desfecho).toBe("reserva");
    const extra = await c.provedor.criarPix({ referencia: "scl-extra-0003", chaveIdempotencia: "extra-0003", valor: TOTAL, email: "test@testuser.com", nome: "", validadeMinutos: 30, descricao: "", descricaoFatura: null });
    if (!extra.ok) throw new Error("extra");
    const [velha] = await db
      .insert(pagamentos)
      .values({ organizacaoId: c.org, cotacaoId: z.cotacaoId, reservaId: z.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: "scl-extra-0003", chaveIdempotencia: "extra-0003", situacao: "pendente", idProvedor: extra.cobranca.idProvedor, valor: TOTAL, criadoEm: new Date(AGORA.getTime() - 100 * 86_400_000) })
      .returning();
    const chamadas = () => c.provedor.chamadas.filter((ch) => (ch.metodo === "cancelar" || ch.metodo === "consultar") && ch.id === extra.cobranca.idProvedor).length;
    const antes = chamadas();
    await conferirPendentes(db, c.org, c.provedor, minutos(5));
    expect(chamadas()).toBe(antes);
    expect(await c.tentativa(velha.id)).toMatchObject({ situacao: "pendente", avisos: expect.arrayContaining(["andamento_fora_do_prazo"]) });
  });

  it("reserva confirmada à mão: sem recebimento manual o pagamento vira o desfecho dela; com recebimento manual, aprovado sem reserva", async () => {
    const x = await comPix();
    c.provedor.expirar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    expect(await confirmarReserva(db, c.org, x.reservaId, null, minutos(11))).toEqual({ ok: true });
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(12));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ desfecho: "reserva", desfechoMotivo: "confirmada_pela_equipe" });
    expect((await c.reserva(x.reservaId)).recebimento).toBe("empresa");

    const y = await comPix({ entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    c.provedor.expirar(y.idProvedor);
    await conferir(y.pagamentoId, minutos(10));
    expect(await confirmarReserva(db, c.org, y.reservaId, null, minutos(11))).toEqual({ ok: true });
    expect(await registrarRecebimento(db, c.org, { reservaId: y.reservaId, data: "2026-10-01", valor: TOTAL, nota: "Pix na conta" }, null, "2026-10-01")).toMatchObject({ ok: true });
    c.provedor.aprovar(y.idProvedor);
    await conferir(y.pagamentoId, minutos(12));
    expect(await c.tentativa(y.pagamentoId)).toMatchObject({ desfecho: null, motivoSemReserva: "recebimento_manual" });
  });

  it("pedido ainda segurado com recebimento registrado à mão (entre um Pix vencido e outro pago): a aprovação não confirma a reserva (nunca dois recebimentos)", async () => {
    const x = await comPix();
    c.provedor.expirar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(10));
    expect((await c.reserva(x.reservaId)).estado).toBe("pedido");
    expect(await registrarRecebimento(db, c.org, { reservaId: x.reservaId, data: "2026-10-01", valor: TOTAL, nota: "Pix na conta" }, null, "2026-10-01")).toMatchObject({ ok: true });
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(12));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "recebimento_manual" });
    expect((await c.reserva(x.reservaId)).estado).toBe("pedido");
  });

  it("transições só pela leitura: recusado → aprovado vale; aprovado → pendente é ignorado; desconhecido vira aviso e não sobrescreve", async () => {
    const x = await comPix();
    c.provedor.recusar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(2));
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("recusado");
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(3));
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("aprovado");
    const [order] = c.provedor.todas().filter((o) => o.idProvedor === x.idProvedor);
    await conferir(x.pagamentoId, minutos(4), { cobranca: { ...order, situacao: "pendente" } });
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("aprovado");
    await conferir(x.pagamentoId, minutos(5), { cobranca: { ...order, situacao: "desconhecido" } });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "aprovado", avisos: ["situacao_desconhecida"] });
    // Leitura que volta a ser conhecida limpa o aviso; o relógio nunca muda a situação.
    await conferir(x.pagamentoId, minutos(500));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "aprovado", avisos: [] });
    // Referência de outra order: nada é aplicado.
    await conferir(x.pagamentoId, minutos(501), { cobranca: { ...order, referencia: "scl-outra", situacao: "devolvido" } });
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "aprovado", avisos: ["referencia_divergente"] });
  });

  it("reserva paga pelo site e depois devolvida no painel do Mercado Pago: continua presa ao pagamento (nem cancelar nem recebimento à mão, até o M8.2c)", async () => {
    const x = await comPix();
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(3));
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "confirmada" });
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferir(x.pagamentoId, minutos(10));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", desfecho: "reserva" });
    expect(await tentarCancelarReserva(db, c.org, x.reservaId, null)).toEqual({ ok: false, aviso: expect.stringContaining("foi paga pelo site") });
    expect(await c.reserva(x.reservaId)).toMatchObject({ estado: "confirmada" });
    expect(await registrarRecebimento(db, c.org, { reservaId: x.reservaId, data: "2026-10-01", valor: TOTAL, nota: "Pix na conta" }, null, "2026-10-01")).toMatchObject({ ok: false });
  });

  it("painel: confirmar à mão e cancelar um pedido com Pix em andamento são recusados (com a hora); depois do Pix vencido, valem", async () => {
    const x = await comPix();
    const conf = await confirmarReserva(db, c.org, x.reservaId, null, minutos(5));
    expect(conf).toMatchObject({ ok: false, aviso: expect.stringContaining("há um Pix em andamento até 12:30") });
    expect(await tentarCancelarReserva(db, c.org, x.reservaId, null)).toMatchObject({ ok: false, aviso: expect.stringContaining("Pix do site em andamento até 12:30. Aguarde o prazo dele.") });
    // Mesmo com o prazo vencido (na carência), a confirmação manual não vence o pedido.
    expect(await confirmarReserva(db, c.org, x.reservaId, null, new Date(x.T.getTime() + 60_000))).toMatchObject({ ok: false, aviso: expect.stringContaining("Pix em andamento") });
    expect((await c.reserva(x.reservaId)).estado).toBe("pedido");
    // Reserva paga: cancelar continua recusado.
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(6));
    expect(await tentarCancelarReserva(db, c.org, x.reservaId, null)).toMatchObject({ ok: false, aviso: expect.stringContaining("foi paga pelo site") });
  });

  it("segurar: o mesmo e-mail com Pix em andamento não segura outras datas na carência; depois dela, a tentativa que nunca se resolve não prende o e-mail; aprovado sem desfecho prende sempre; a resposta não revela o pagamento", async () => {
    const x = await comPix();
    const r = await criarCotacao(db, c.org, { imovel: "403", entrada: "2026-11-20", saida: "2026-11-22", hospedes: "2" }, new Date(x.T.getTime() + 60_000));
    if (!r.ok) throw new Error(r.erro);
    const segurarCom = (codigo: string, email: string, quando: Date) => segurarDatas(db, c.org, codigo, { nome: "Visitante Fictício", email, telefone: "(21) 99999-0000" }, quando);
    const naCarencia = await segurarCom(r.cotacao.codigo, EMAIL_HOSPEDE, new Date(x.T.getTime() + 60_000));
    // A mesma resposta de "reserva em andamento" (M8.2b: um texto só para os dois casos): nada diz que essa pessoa está pagando.
    expect(naCarencia).toEqual({ ok: false, erro: ERRO_EMAIL_EM_ANDAMENTO });
    // Outro e-mail segura normalmente.
    expect((await segurarCom(r.cotacao.codigo, "outra@example.com", new Date(x.T.getTime() + 60_000))).ok).toBe(true);
    // Passada a carência, o Pix que nunca teve resposta (ainda "pendente" no sistema) não prende mais o e-mail.
    const r2 = await criarCotacao(db, c.org, { imovel: "403", entrada: "2026-11-24", saida: "2026-11-26", hospedes: "2" }, new Date(x.T.getTime() + 20 * 60_000));
    if (!r2.ok) throw new Error(r2.erro);
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("pendente");
    expect((await segurarCom(r2.cotacao.codigo, EMAIL_HOSPEDE, new Date(x.T.getTime() + 20 * 60_000))).ok).toBe(true);

    // Aprovado sem reserva (a devolver): o e-mail continua preso, dias depois.
    const y = await comPix({ entrada: "2026-11-02", saida: "2026-11-05", email: "y@example.com" });
    await db.update(cotacoes).set({ total: TOTAL + 1 }).where(eq(cotacoes.id, y.cotacaoId));
    c.provedor.aprovar(y.idProvedor);
    await conferir(y.pagamentoId, minutos(3));
    expect((await c.tentativa(y.pagamentoId)).motivoSemReserva).toBe("valor_divergente");
    const tresDias = minutos(3 * 24 * 60);
    const r3 = await criarCotacao(db, c.org, { imovel: "403", entrada: "2026-11-27", saida: "2026-11-29", hospedes: "2" }, tresDias);
    if (!r3.ok) throw new Error(r3.erro);
    expect(await segurarCom(r3.cotacao.codigo, "y@example.com", tresDias)).toEqual({ ok: false, erro: ERRO_EMAIL_EM_ANDAMENTO });
  });

  it("rotina de holds: um hold que não dá para fechar (impasse, trava ocupada ou outro erro) é contado e os seguintes continuam", async () => {
    const a = await c.segurar();
    const b = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "b@example.com" });
    let i = 0;
    const falhaNaPrimeira = new Proxy(db, {
      get(alvo, k, r) {
        if (k === "transaction") return (...x: Parameters<typeof db.transaction>) => (++i === 1 ? Promise.reject(Object.assign(new Error("deadlock detected"), { code: "40P01" })) : alvo.transaction(...x));
        return Reflect.get(alvo, k, r);
      },
    });
    const r = await expirarHoldsVencidos(falhaNaPrimeira, c.org, minutos(31));
    expect(r).toMatchObject({ expiradas: 1, falhas: 1 });
    const estados = [(await c.reserva(a.reservaId)).estado, (await c.reserva(b.reservaId)).estado].sort();
    expect(estados).toEqual(["cancelada", "pedido"]);
    // A próxima volta fecha o que ficou.
    expect(await expirarHoldsVencidos(db, c.org, minutos(41))).toMatchObject({ expiradas: 1, falhas: 0 });
  });

  it("gerar Pix com a cotação de outra empresa, ou depois de confirmada: recusado", async () => {
    const x = await comPix();
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(3));
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(4), c.provedor)).toMatchObject({ ok: false, codigo: "nao_oferecido" });
    expect(AGORA.toISOString()).toBe("2026-10-01T15:00:00.000Z");
  });
});

describe("confirmação pelo cartão (M8.2b)", () => {
  const cobranca = (o: Partial<Cobranca> = {}): Cobranca => ({
    idProvedor: "ORDTST9999",
    referencia: "scl-x",
    situacao: "aprovado",
    detalhe: "processed/accredited",
    forma: "cartao",
    valor: TOTAL,
    valorTransacao: TOTAL,
    pago: TOTAL,
    devolvido: 0,
    devolucaoEmAndamento: false,
    devolucoes: [],
    parcelas: 1,
    idTransacao: "PAYTST9999",
    aoVivo: false,
    pix: null,
    cartao: null,
    ...o,
  });
  it("o valor confere: Pix igual; cartão à vista igual; cartão parcelado com juros (pela tentativa, mesmo com a leitura sem tipo e parcelas); à vista com a mais e transação diferente, não", () => {
    const pix = { valor: TOTAL, forma: "pix" as const, parcelas: null };
    const cartao = (parcelas: number | null) => ({ valor: TOTAL, forma: "cartao" as const, parcelas });
    expect(valorConfere(cobranca({ forma: "pix", parcelas: null }), pix, TOTAL)).toBe(true);
    expect(valorConfere(cobranca({ forma: "pix", parcelas: null, pago: TOTAL + 1 }), pix, TOTAL)).toBe(false);
    expect(valorConfere(cobranca(), cartao(1), TOTAL)).toBe(true);
    expect(valorConfere(cobranca({ parcelas: 3, pago: TOTAL + 9_000 }), cartao(3), TOTAL)).toBe(true);
    // O GET pode vir sem o tipo e as parcelas: vale o que a tentativa mandou e o Mercado Pago validou na criação.
    expect(valorConfere(cobranca({ parcelas: null, forma: null, pago: TOTAL + 9_000 }), cartao(3), TOTAL)).toBe(true);
    expect(valorConfere(cobranca({ parcelas: null, forma: null, pago: TOTAL + 9_000 }), cartao(1), TOTAL)).toBe(false);
    expect(valorConfere(cobranca({ pago: TOTAL + 100 }), cartao(1), TOTAL)).toBe(false);
    expect(valorConfere(cobranca({ parcelas: 3, pago: TOTAL - 1 }), cartao(3), TOTAL)).toBe(false);
    expect(valorConfere(cobranca({ parcelas: 3, valorTransacao: TOTAL + 9_000, pago: TOTAL + 9_000 }), cartao(3), TOTAL)).toBe(false);
    expect(valorConfere(cobranca({ pago: null }), cartao(1), TOTAL)).toBe(true);
    expect(valorConfere(null, cartao(1), TOTAL)).toBe(false);
  });

  it("cartão 3x lido com parcelas e tipo vazios e o pago com juros: confirma a reserva", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "processando";
    const r = await c.cartao(s.cotacaoId, { parcelas: 3 });
    const lida = { ...(await c.provedor.consultar(r.idProvedor!))!, situacao: "aprovado" as const, detalhe: "processed/accredited", parcelas: null, forma: null, pago: TOTAL + 9_000 };
    expect(await conferir(r.pagamentoId!, minutos(2), { cobranca: lida })).toMatchObject({ ok: true, situacao: "aprovado" });
    expect(await c.tentativa(r.pagamentoId!)).toMatchObject({ desfecho: "reserva", parcelas: 3, valorPago: TOTAL + 9_000 });
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
  });

  it("confirmação tardia com outra reserva do site do mesmo e-mail confirmada depois que o cartão foi criado: aviso de possível pagamento em dobro (a regra de reviver não muda)", async () => {
    const s = await c.segurar();
    c.provedor.respostaCartao = "em_analise";
    const r = await c.cartao(s.cotacaoId);
    await expirarHoldsVencidos(db, c.org, minutos(76));
    expect((await c.cotacao(s.cotacaoId)).estado).toBe("expirada");
    // Outro aparelho, outro e-mail digitado na hora, depois corrigido para o mesmo: outra reserva do site confirmada.
    const outra = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "outra@example.com" }, minutos(77));
    const pix = await c.pix(outra.cotacaoId, minutos(77));
    c.provedor.aprovar(pix.idProvedor);
    await conferir(pix.pagamentoId, minutos(78));
    await db.update(reservas).set({ hospedeEmail: EMAIL_HOSPEDE }).where(eq(reservas.id, outra.reservaId));
    expect((await c.reserva(outra.reservaId)).estado).toBe("confirmada");
    c.provedor.concluirAnalise(r.idProvedor!, "aprovado");
    await conferir(r.pagamentoId!, minutos(80));
    const p = await c.tentativa(r.pagamentoId!);
    expect(p).toMatchObject({ desfecho: "reserva", desfechoMotivo: "confirmada_tardia" });
    expect(p.avisos).toContain("outra_reserva_mesmo_email");
    expect(textosDosAvisos(p.avisos).join(" ")).toContain("o hóspede pode ter pago duas vezes");
    // Sem outra reserva do mesmo e-mail, nenhum aviso.
    expect((await c.tentativa(pix.pagamentoId)).avisos).not.toContain("outra_reserva_mesmo_email");
  });
});

describe("a leitura do pagamento depois do cancelamento pela política (M8.2c)", () => {
  const longe = { entrada: "2026-11-20", saida: "2026-11-23" };
  const empresa = () => entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" });
  const doLivro = (reservaId: string) => db.select().from(lancamentos).where(eq(lancamentos.reservaId, reservaId));
  const emConferencia = async (reservaId: string) =>
    (await db.select({ id: lancamentos.id }).from(lancamentos).where(and(eq(lancamentos.reservaId, reservaId), lancamentoEmVigor(db), lancamentoEmConferencia()))).length > 0;

  it("cancelamento devolvido por fora e o Mercado Pago mostrando a devolução: devolução em dobro", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, longe);
    await envelhecer(c, x.pagamentoId, 80);
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect(await registrarDevolucaoPorFora(db, c.org, x.pagamentoId, { data: "2026-10-01", valor: TOTAL, nota: "Pix da conta da empresa" }, equipe, c.provedor, minutos(70))).toEqual({ ok: true, situacao: "por_fora" });
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferir(x.pagamentoId, minutos(80));
    const t = await c.tentativa(x.pagamentoId);
    expect(t.avisos).toContain("devolucao_em_dobro");
    // A reserva cancelada com devolução integral não volta para a conferência (D21 só fora do cancelamento).
    expect(await emConferencia(x.reservaId)).toBe(false);
  });

  it("devolvido no painel do Mercado Pago numa reserva confirmada (sem cancelamento): devolvido por fora e a parte em conferência (D21), fora das disponíveis e de qualquer antecipado", async () => {
    const x = await pagarEConfirmar(c);
    await liberar(c, x.pagamentoId, { quando: minutos(10) });
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferir(x.pagamentoId, minutos(20));
    const t = await c.tentativa(x.pagamentoId);
    expect(t).toMatchObject({ situacao: "devolvido", desfecho: "reserva", devolvidoLido: TOTAL });
    expect(t.avisos).toContain("devolvido_por_fora");
    expect(await emConferencia(x.reservaId)).toBe(true);
    const depois = new Date("2026-10-16T12:00:00-03:00");
    expect((await partesDisponiveis(db, c.org, c.dono, depois)).filter((p) => p.reservaId === x.reservaId)).toEqual([]);
    expect(await gerarAntecipado(db, c.org, c.dono, "2026-10-16", null, { agora: depois })).toMatchObject({ ok: false });
  });

  it("cancelada com valor retido e depois devolvida no painel do Mercado Pago: em conferência", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c);
    const quando = new Date("2026-10-10T11:00:00-03:00");
    await cancelar(c, x.reservaId, entradaPadrao({ recebidoEm: new Date("2026-10-10T10:00:00-03:00"), canal: "email" }), equipe, quando);
    expect((await c.reserva(x.reservaId)).valorRetido).toBe(TOTAL);
    expect(await emConferencia(x.reservaId)).toBe(false);
    c.provedor.devolverNoProvedor(x.idProvedor, TOTAL);
    await conferir(x.pagamentoId, minutos(10, quando));
    expect((await c.tentativa(x.pagamentoId)).avisos).toContain("devolvido_por_fora");
    expect(await emConferencia(x.reservaId)).toBe(true);
  });

  it("taxa que chega depois do cancelamento integral: fica no pagamento, não entra na reserva (nada a dividir)", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, { ...longe, financeiro: { taxa: null } });
    expect((await c.tentativa(x.pagamentoId)).taxa).toBeNull();
    c.provedor.respostaDevolucao = "pedida";
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    const antes = (await c.reserva(x.reservaId)).taxaCanal;
    const livro = (await doLivro(x.reservaId)).length;
    c.provedor.atualizarFinanceiro(x.idProvedor, { taxa: 1824, liquido: TOTAL - 1824 });
    await conferir(x.pagamentoId, minutos(70));
    expect((await c.tentativa(x.pagamentoId)).taxa).toBe(1824);
    expect((await c.reserva(x.reservaId)).taxaCanal).toBe(antes);
    expect((await doLivro(x.reservaId)).length).toBe(livro);
    expect(await emConferencia(x.reservaId)).toBe(false);
  });

  it("taxa que chega depois do cancelamento com valor retido: entra na reserva, o motor divide de novo; fora da conferência", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, { financeiro: { taxa: null } });
    const quando = new Date("2026-10-10T11:00:00-03:00");
    await cancelar(c, x.reservaId, entradaPadrao({ recebidoEm: new Date("2026-10-10T10:00:00-03:00"), canal: "email" }), equipe, quando);
    c.provedor.atualizarFinanceiro(x.idProvedor, { taxa: 1824, liquido: TOTAL - 1824 });
    await conferir(x.pagamentoId, minutos(10, quando));
    expect((await c.reserva(x.reservaId)).taxaCanal).toBe(1824);
    const taxa = (await doLivro(x.reservaId)).filter((l) => l.origem === "motor" && l.tipo === "taxa_canal" && !l.estornoDe);
    expect(taxa.map((l) => l.valor)).toContain(-1824);
    expect(await emConferencia(x.reservaId)).toBe(false);
  });

  it("sinal de liberação numa reserva cancelada com devolução integral: só marca a liberação (nada entra no livro)", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, longe);
    c.provedor.respostaDevolucao = "pedida";
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("aprovado");
    c.provedor.atualizarFinanceiro(x.idProvedor, { liberado: true, liquido: TOTAL - 1824 });
    await conferir(x.pagamentoId, minutos(70));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ liberacaoConfirmadaEm: minutos(70), liberacaoOrigem: "provedor" });
    expect((await doLivro(x.reservaId)).filter((l) => l.tipo === "recebimento")).toEqual([]);
  });

  it("colunas da leitura gravadas: o devolvido lido, a devolução em andamento lida e o dia em que o sistema viu 'devolvido' (uma vez)", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, longe);
    c.provedor.respostaDevolucao = "pedida";
    await cancelar(c, x.reservaId, empresa(), equipe, minutos(60));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ devolvidoLido: 0, devolucaoEmAndamentoLida: true, devolvidoVistoEm: null });
    c.provedor.confirmarDevolucoes(x.idProvedor);
    await conferir(x.pagamentoId, minutos(70));
    expect(await c.tentativa(x.pagamentoId)).toMatchObject({ situacao: "devolvido", devolvidoLido: TOTAL, devolucaoEmAndamentoLida: false, devolvidoVistoEm: minutos(70) });
    await conferir(x.pagamentoId, minutos(90));
    expect((await c.tentativa(x.pagamentoId)).devolvidoVistoEm).toEqual(minutos(70));
  });
});

describe("a aprovação do pagamento da diferença de uma alteração (M8.2d)", () => {
  /** A leitura do Beds24 renovada pouco antes de `quando` (as noites continuam livres). */
  const lerAgenda = (quando: Date) => db.update(beds24Calendario).set({ observadoEm: new Date(quando.getTime() - 3_600_000) }).where(eq(beds24Calendario.organizacaoId, c.org));
  /** Uma alteração com aumento (uma noite a mais, pela cotação) segurada e o Pix da diferença gerado, ainda sem pagar. */
  async function comDiferenca(o: { entrada?: string; saida?: string; checkin?: string; checkout?: string } = {}) {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, { entrada: o.entrada, saida: o.saida });
    const r = await c.reserva(x.reservaId);
    const { resultado } = await alterar(c, x.reservaId, { checkin: o.checkin ?? r.checkin, checkout: o.checkout ?? "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const pix = await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25), aprovar: false });
    return { x, antes: r, alteracaoId: resultado.alteracaoId, pix };
  }
  /** Mais uma tentativa da diferença da mesma alteração (o Pix e o cartão na corrida), pendente no Mercado Pago falso. */
  async function outraTentativa(x: { cotacaoId: string; reservaId: string }, alteracaoId: string | null, valor: number, criadoEm: Date) {
    const id = crypto.randomUUID();
    const criada = await c.provedor.criarPix({ referencia: referenciaDaTentativa(id), chaveIdempotencia: chaveCriacao(id), valor, email: EMAIL_HOSPEDE, nome: "", validadeMinutos: 30, descricao: "", descricaoFatura: null });
    if (!criada.ok || !criada.cobranca) throw new Error("Pix falso não criado");
    await db.insert(pagamentos).values({ id, organizacaoId: c.org, cotacaoId: x.cotacaoId, reservaId: x.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: referenciaDaTentativa(id), chaveIdempotencia: chaveCriacao(id), situacao: "pendente", idProvedor: criada.cobranca.idProvedor, valor, pixExpiraEm: new Date(criadoEm.getTime() + 30 * 60_000), alteracaoId, criadoEm, atualizadoEm: criadoEm });
    return { pagamentoId: id, idProvedor: criada.cobranca.idProvedor };
  }

  it("aprovação tardia depois da NOVA entrada, mudando de mês (D1): sem reserva ('alteracao_nao_aplicada:estadia_iniciada'); nada lançado no mês que passou", async () => {
    // 02/11–05/11, adiantada para 30/10 (três noites a mais antes, em outubro e novembro), pela cotação.
    const s = await comDiferenca({ entrada: "2026-11-02", saida: "2026-11-05", checkin: "2026-10-30", checkout: "2026-11-05" });
    expect(await alteracaoGravada(c, s.alteracaoId)).toMatchObject({ noitesNovasInicio: "2026-10-30", noitesNovasFim: "2026-11-02" });
    // O Pix é pago em 01/11, depois da nova entrada (30/10) e antes da original (02/11), com a agenda do Beds24 atual.
    const tarde = new Date("2026-11-01T13:00:00Z");
    await lerAgenda(tarde);
    c.provedor.aprovar(s.pix.idProvedor, { taxa: 1000 });
    await conferir(s.pix.pagamentoId, tarde);
    expect(await c.tentativa(s.pix.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "alteracao_nao_aplicada:estadia_iniciada" });
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ checkin: "2026-11-02", checkout: "2026-11-05", valorBruto: s.antes.valorBruto, taxaCanal: s.antes.taxaCanal });
    expect(await alteracaoGravada(c, s.alteracaoId)).toMatchObject({ situacao: "expirada", aplicadaEm: null });
    // Nada no livro em outubro (o mês que passou), nem estorno: o motor da reserva continua em novembro.
    const livro = await db.select().from(lancamentos).where(eq(lancamentos.reservaId, s.x.reservaId));
    expect(livro.filter((l) => l.competencia < "2026-11-01")).toEqual([]);
    expect(livro.filter((l) => l.estornoDe)).toEqual([]);
  });

  it("duas aprovações da mesma alteração (o Pix e outro na corrida): a primeira aplica, a segunda fica sem reserva ('outra_tentativa'); a reserva muda uma vez", async () => {
    const s = await comDiferenca();
    const segunda = await outraTentativa(s.x, s.alteracaoId, 52800, minutos(26));
    c.provedor.aprovar(s.pix.idProvedor, { taxa: 528 });
    c.provedor.aprovar(segunda.idProvedor, { taxa: 528 });
    await conferir(s.pix.pagamentoId, minutos(27));
    await conferir(segunda.pagamentoId, minutos(28));
    expect(await c.tentativa(s.pix.pagamentoId)).toMatchObject({ desfecho: "alteracao" });
    expect(await c.tentativa(segunda.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "outra_tentativa" });
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ checkout: "2026-10-16", valorBruto: TOTAL + 52800, taxaCanal: 1824 + 528 });
    expect(await alteracaoGravada(c, s.alteracaoId)).toMatchObject({ situacao: "aplicada" });
  });

  it("aprovação tardia de uma tentativa antiga do pagamento da reserva, depois de uma alteração aplicada: 'outra_tentativa' (a alteração não confunde a regra)", async () => {
    const s = await comDiferenca();
    c.provedor.aprovar(s.pix.idProvedor, { taxa: 528 });
    await conferir(s.pix.pagamentoId, minutos(27));
    expect(await alteracaoGravada(c, s.alteracaoId)).toMatchObject({ situacao: "aplicada" });
    // Um Pix da própria reserva, de antes do pagamento que a confirmou, pago agora.
    const antiga = await outraTentativa(s.x, null, TOTAL, minutos(-5));
    c.provedor.aprovar(antiga.idProvedor, { taxa: 1824 });
    await conferir(antiga.pagamentoId, minutos(40));
    expect(await c.tentativa(antiga.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: null, motivoSemReserva: "outra_tentativa" });
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ checkout: "2026-10-16", valorBruto: TOTAL + 52800, taxaCanal: 1824 + 528 });
  });

  it("taxa da diferença ainda desconhecida na aprovação: a reserva fica com a taxa conhecida (F1), sem apagá-la; quando F2 chega, F1 + F2; reler o pagamento da reserva não volta atrás", async () => {
    const s = await comDiferenca();
    c.provedor.aprovar(s.pix.idProvedor, {});
    await conferir(s.pix.pagamentoId, minutos(27));
    expect(await c.tentativa(s.pix.pagamentoId)).toMatchObject({ desfecho: "alteracao", taxa: null });
    expect(await alteracaoGravada(c, s.alteracaoId)).toMatchObject({ situacao: "aplicada", taxaDepois: 1824 });
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ valorBruto: TOTAL + 52800, taxaCanal: 1824, valorLiquido: TOTAL + 52800 - 1824 });
    const taxaDoMotor = async () => (await doMotor(s.x.reservaId)).filter((l) => l.tipo === "taxa_canal" && !l.estornoDe).reduce((t, l) => t + l.valor, 0);
    // F2 chega numa leitura seguinte: a reserva passa a F1 + F2 e o motor divide de novo.
    c.provedor.atualizarFinanceiro(s.pix.idProvedor, { taxa: 528, liquido: 52800 - 528 });
    await conferir(s.pix.pagamentoId, minutos(40));
    expect(await c.tentativa(s.pix.pagamentoId)).toMatchObject({ taxa: 528 });
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ taxaCanal: 2352, valorLiquido: TOTAL + 52800 - 2352 });
    const depoisDeF2 = await taxaDoMotor();
    // Reler o pagamento que confirmou a reserva (taxa F1) não troca a taxa da reserva de volta.
    await conferir(s.x.pagamentoId, minutos(50));
    expect(await c.reserva(s.x.reservaId)).toMatchObject({ taxaCanal: 2352 });
    expect(await taxaDoMotor()).toBe(depoisDeF2);
  });
});
