import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditoria, beds24Calendario, cotacoes, lancamentos, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { registrarRecebimento } from "@/repasses/recebimentos";
import { confirmarReserva, criarReserva, tentarCancelarReserva } from "@/reservas/repositorio";
import { criarCotacao, expirarHoldsVencidos, segurarDatas } from "@/site/cotacoes";
import { CARENCIA_PAGAMENTO_MS } from "./andamento";
import { conferirTentativa } from "./conferencia";
import { gerarPix } from "./pix";
import type { Cobranca } from "./provedor";
import { AGORA, type Cenario, EMAIL_HOSPEDE, minutos, montarCenario, TOTAL } from "./testes";

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

  it("painel: confirmar à mão e cancelar um pedido com Pix em andamento são recusados (com a hora); depois do Pix vencido, valem", async () => {
    const x = await comPix();
    const conf = await confirmarReserva(db, c.org, x.reservaId, null, minutos(5));
    expect(conf).toMatchObject({ ok: false, aviso: expect.stringContaining("há um Pix em andamento até 12:30") });
    expect(await tentarCancelarReserva(db, c.org, x.reservaId, null)).toMatchObject({ ok: false, aviso: expect.stringContaining("M8.2c") });
    // Mesmo com o prazo vencido (na carência), a confirmação manual não vence o pedido.
    expect(await confirmarReserva(db, c.org, x.reservaId, null, new Date(x.T.getTime() + 60_000))).toMatchObject({ ok: false, aviso: expect.stringContaining("Pix em andamento") });
    expect((await c.reserva(x.reservaId)).estado).toBe("pedido");
    // Reserva paga: cancelar continua recusado.
    c.provedor.aprovar(x.idProvedor);
    await conferir(x.pagamentoId, minutos(6));
    expect(await tentarCancelarReserva(db, c.org, x.reservaId, null)).toMatchObject({ ok: false, aviso: expect.stringContaining("pagamento aprovado pelo site") });
  });

  it("segurar: o mesmo e-mail com Pix em andamento não segura outras datas na carência; depois dela, a tentativa que nunca se resolve não prende o e-mail; aprovado sem desfecho prende sempre; a resposta não revela o pagamento", async () => {
    const x = await comPix();
    const r = await criarCotacao(db, c.org, { imovel: "403", entrada: "2026-11-20", saida: "2026-11-22", hospedes: "2" }, new Date(x.T.getTime() + 60_000));
    if (!r.ok) throw new Error(r.erro);
    const segurarCom = (codigo: string, email: string, quando: Date) => segurarDatas(db, c.org, codigo, { nome: "Visitante Fictício", email, telefone: "(21) 99999-0000" }, quando);
    const naCarencia = await segurarCom(r.cotacao.codigo, EMAIL_HOSPEDE, new Date(x.T.getTime() + 60_000));
    // A mesma resposta de "reserva em andamento": nada diz que essa pessoa está pagando.
    expect(naCarencia).toMatchObject({ ok: false, erro: "Já existe uma reserva em andamento com este e-mail. Conclua aquela ou aguarde o prazo dela acabar." });
    expect(JSON.stringify(naCarencia)).not.toMatch(/pagamento/i);
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
    expect(await segurarCom(r3.cotacao.codigo, "y@example.com", tresDias)).toMatchObject({ ok: false, erro: expect.stringContaining("reserva em andamento") });
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
