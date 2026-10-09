import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventosPagamento, pagamentos } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { aplicarNaTransacao, conferirCotacaoParaPagina, conferirTentativa, idDeOrder, INTERVALO_CONSULTA_MS, marcarAviso, processarAvisoDeOrder } from "./conferencia";
import { apagarEventosAntigos, GUARDAR_EVENTOS_DIAS, marcarResultadoDoEvento, registrarAssinaturaRecusada, registrarEventoDeAviso, situacaoDosAvisos } from "./eventos";
import { ProvedorFalso } from "./falso";
import { ErroProvedor } from "./provedor";
import { situacaoDoMercadoPago, ENDERECO_WEBHOOK, segredoDoWebhook } from "./integracao";
import { conferirPendentes, rotinaDoSite } from "./rotina";
import { AGORA, type Cenario, env, minutos, montarCenario, TOTAL } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

describe("avisos assinados (webhook) do provedor (M8.2a)", () => {
  it("evento válido gravado uma vez (repetição não processa); assinatura recusada só conta no dia; último aviso válido; limpeza depois de 90 dias", async () => {
    const e = { tipo: "order", acao: "order.processed", dataId: "ORDTST9999", requestId: "req-abc", ts: "1759330800", aoVivo: false };
    const a = await registrarEventoDeAviso(db, e, AGORA);
    expect(a).toMatchObject({ novo: true });
    expect(await registrarEventoDeAviso(db, e, minutos(1))).toEqual({ id: a!.id, novo: false });
    // Outro ts (reenvio) é outro evento.
    expect(await registrarEventoDeAviso(db, { ...e, ts: "1759331700" }, minutos(15))).toMatchObject({ novo: true });
    await registrarAssinaturaRecusada(db, minutos(2));
    await registrarAssinaturaRecusada(db, minutos(3));
    expect(await situacaoDosAvisos(db, minutos(20))).toEqual({ recusadasHoje: 2, ultimoValidoEm: minutos(15) });
    await marcarResultadoDoEvento(db, a!.id, "desconhecido", minutos(1));
    const [gravado] = await db.select().from(eventosPagamento).where(eq(eventosPagamento.id, a!.id));
    expect(gravado).toMatchObject({ tipo: "order", acao: "order.processed", dataId: "ORDTST9999", requestId: "req-abc", resultado: "desconhecido", aoVivo: false });
    // Campos estranhos não entram (nada do corpo é guardado por extenso).
    expect(await registrarEventoDeAviso(db, { dataId: "ORD com espaço" }, AGORA)).toBeNull();
    expect(await apagarEventosAntigos(db, new Date(minutos(16).getTime() + (GUARDAR_EVENTOS_DIAS + 1) * 86_400_000))).toBeGreaterThanOrEqual(2);
    expect(await db.select().from(eventosPagamento).where(eq(eventosPagamento.id, a!.id))).toEqual([]);
  });

  it("aviso sem request-id e sem ts: cada um é um evento novo (nunca se funde com o anterior da mesma order); com um dos dois, a repetição é reconhecida", async () => {
    const a = await registrarEventoDeAviso(db, { tipo: "order", acao: "order.processed", dataId: "ORDSEMMETA1" }, AGORA);
    const b = await registrarEventoDeAviso(db, { tipo: "order", acao: "order.refunded", dataId: "ORDSEMMETA1" }, minutos(1));
    expect(a).toMatchObject({ novo: true });
    expect(b).toMatchObject({ novo: true });
    expect(b!.id).not.toBe(a!.id);
    expect(await db.select().from(eventosPagamento).where(eq(eventosPagamento.dataId, "ORDSEMMETA1"))).toHaveLength(2);
    // Só o ts (sem request-id) ou só o request-id (sem ts): a repetição continua reconhecida.
    const t1 = await registrarEventoDeAviso(db, { dataId: "ORDSEMMETA1", ts: "1759330800" }, minutos(2));
    expect(await registrarEventoDeAviso(db, { dataId: "ORDSEMMETA1", ts: "1759330800" }, minutos(3))).toEqual({ id: t1!.id, novo: false });
    const r1 = await registrarEventoDeAviso(db, { dataId: "ORDSEMMETA1", requestId: "req-so" }, minutos(2));
    expect(await registrarEventoDeAviso(db, { dataId: "ORDSEMMETA1", requestId: "req-so" }, minutos(3))).toEqual({ id: r1!.id, novo: false });
  });

  it("processar: id que não é de order é ignorado; order desconhecida não avisa; order conhecida é aplicada e o evento leva o resultado e a empresa", async () => {
    expect(idDeOrder("123456")).toBe(false);
    expect(await processarAvisoDeOrder(db, c.provedor, "123456", AGORA)).toBe("ignorado");
    expect(await processarAvisoDeOrder(db, c.provedor, "ORDNAOEXISTE", AGORA)).toBe("desconhecido");
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    c.provedor.aprovar(p.idProvedor);
    const ev = await registrarEventoDeAviso(db, { tipo: "order", acao: "order.processed", dataId: p.idProvedor, requestId: "r-2", ts: "2" }, minutos(2));
    // Mesmo logo depois de outra leitura (menos de 15 s), o aviso lê o provedor.
    await conferirTentativa(db, c.org, p.pagamentoId, c.provedor, minutos(2), { origem: "pagina" });
    expect(await processarAvisoDeOrder(db, c.provedor, p.idProvedor, new Date(minutos(2).getTime() + 1000), { eventoId: ev!.id })).toBe("aplicado");
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
    const [gravado] = await db.select().from(eventosPagamento).where(eq(eventosPagamento.id, ev!.id));
    expect(gravado).toMatchObject({ resultado: "aplicado", organizacaoId: c.org });
    expect(INTERVALO_CONSULTA_MS).toBe(15_000);
  });

  it("aviso que chega antes de a criação gravar o id da order: acha a tentativa pela referência e grava o id", async () => {
    const s = await c.segurar();
    // A criação no ar: a tentativa ainda "criando", sem id; a order já existe no provedor.
    const id = "11111111-1111-4111-8111-111111111111";
    await db.insert(pagamentos).values({ id, organizacaoId: c.org, cotacaoId: s.cotacaoId, reservaId: s.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: `scl-${id}`, chaveIdempotencia: `pagamento:${id}:criar`, situacao: "criando", valor: TOTAL, criadoEm: AGORA });
    const r = await c.provedor.criarPix({ referencia: `scl-${id}`, chaveIdempotencia: `pagamento:${id}:criar`, valor: TOTAL, email: "test@testuser.com", nome: "", validadeMinutos: 30, descricao: "", descricaoFatura: null });
    if (!r.ok) throw new Error("order");
    c.provedor.aprovar(r.cobranca.idProvedor);
    expect(await processarAvisoDeOrder(db, c.provedor, r.cobranca.idProvedor, minutos(1))).toBe("aplicado");
    expect(await c.tentativa(id)).toMatchObject({ idProvedor: r.cobranca.idProvedor, situacao: "aprovado", desfecho: "reserva" });
  });

  it("falha do provedor no processamento: o evento fica com erro e a exceção sobe (a rotina confere depois)", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    const ev = await registrarEventoDeAviso(db, { dataId: p.idProvedor, requestId: "r-3", ts: "3" }, minutos(1));
    c.provedor.falhas.consultar = new ErroProvedor("incerto", "tempo");
    await expect(processarAvisoDeOrder(db, c.provedor, p.idProvedor, minutos(1), { eventoId: ev!.id })).rejects.toBeInstanceOf(ErroProvedor);
    expect((await db.select().from(eventosPagamento).where(eq(eventosPagamento.id, ev!.id)))[0].resultado).toBe("erro");
    c.provedor.falhas.consultar = null;
    c.provedor.aprovar(p.idProvedor);
    expect(await conferirPendentes(db, c.org, c.provedor, minutos(2))).toMatchObject({ conferidas: 1, mudaram: 1, falhas: 0 });
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
  });
});

describe("conferência: freio da página e leituras antigas (M8.2a)", () => {
  it("a página lê o provedor no máximo a cada 15 s por tentativa, e só enquanto o Pix está pendente", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    const lidas = () => c.provedor.chamadas.filter((x) => x.metodo === "consultar").length;
    const antes = lidas();
    expect(await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, new Date(AGORA.getTime() + 5_000))).toMatchObject({ ok: true, consultou: false });
    expect(lidas()).toBe(antes);
    expect(await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, new Date(AGORA.getTime() + 15_000))).toMatchObject({ ok: true, consultou: true });
    expect(await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, new Date(AGORA.getTime() + 20_000))).toMatchObject({ consultou: false });
    c.provedor.aprovar(p.idProvedor);
    await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, minutos(1));
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
    // Aprovado: a página para de consultar o provedor.
    const depois = lidas();
    expect(await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, minutos(5))).toBeNull();
    expect(lidas()).toBe(depois);
  });

  it("Pix cancelado há pouco que acabou pago (o cancelamento cruzou com o pagamento): a página também o lê e confirma; bem depois do prazo dele, não lê mais", async () => {
    const s = await c.segurar();
    const a = await c.pix(s.cotacaoId);
    // A foi cancelado para dar lugar a outro Pix, mas o hóspede pagou A no mesmo instante.
    await db.update(pagamentos).set({ situacao: "cancelado", atualizadoEm: minutos(1) }).where(eq(pagamentos.id, a.pagamentoId));
    c.provedor.aprovar(a.idProvedor);
    await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, minutos(2));
    expect(await c.tentativa(a.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: "reserva" });
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");

    const outra = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "outra@example.com" });
    const b = await c.pix(outra.cotacaoId);
    c.provedor.expirar(b.idProvedor);
    const lidas = () => c.provedor.chamadas.filter((x) => x.metodo === "consultar" && x.id === b.idProvedor).length;
    // Vencido e lido de novo pela página (cada leitura atualiza a tentativa, mas não o prazo da leitura).
    await conferirCotacaoParaPagina(db, c.org, outra.cotacaoId, c.provedor, minutos(31));
    expect((await c.tentativa(b.pagamentoId)).situacao).toBe("expirado");
    await conferirCotacaoParaPagina(db, c.org, outra.cotacaoId, c.provedor, minutos(40));
    const antes = lidas();
    // O prazo do Pix (30 min) mais a folga (15 min) já passou: nada é lido, por mais que a página tenha lido antes.
    expect(await conferirCotacaoParaPagina(db, c.org, outra.cotacaoId, c.provedor, minutos(50))).toBeNull();
    expect(lidas()).toBe(antes);
  });

  it("Pix recusado que o provedor depois corrige para aprovado: a página também o lê e confirma", async () => {
    const s = await c.segurar();
    const a = await c.pix(s.cotacaoId);
    c.provedor.recusar(a.idProvedor);
    await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, minutos(1));
    expect((await c.tentativa(a.pagamentoId)).situacao).toBe("recusado");
    c.provedor.aprovar(a.idProvedor);
    await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, minutos(2));
    expect(await c.tentativa(a.pagamentoId)).toMatchObject({ situacao: "aprovado", desfecho: "reserva" });
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
  });

  it("leituras simultâneas da página: a leitura é reservada num comando só — 25 pedidos ao mesmo tempo, uma leitura do provedor", async () => {
    const s = await c.segurar();
    await c.pix(s.cotacaoId);
    const lidas = () => c.provedor.chamadas.filter((x) => x.metodo === "consultar" || x.metodo === "buscarPorReferencia").length;
    const antes = lidas();
    const quando = new Date(AGORA.getTime() + 20_000);
    const r = await Promise.all(Array.from({ length: 25 }, () => conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, quando)));
    expect(lidas() - antes).toBe(1);
    expect(r.filter((x) => x?.ok && x.consultou)).toHaveLength(1);
    // Leitura que nem chegou ao provedor não conta: a marca volta e a próxima (15 s depois da última que valeu) lê de novo.
    c.provedor.falhas.consultar = new ErroProvedor("indisponivel", "sem conexão");
    expect(await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, new Date(quando.getTime() + 15_000))).toMatchObject({ ok: false });
    expect((await db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, s.cotacaoId)))[0].consultadoEm?.toISOString()).toBe(quando.toISOString());
    c.provedor.falhas.consultar = null;
    expect(await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, new Date(quando.getTime() + 16_000))).toMatchObject({ ok: true, consultou: true });
  });

  it.each(["limite", "incerto"] as const)("Mercado Pago falhando (%s) com a página consultando a cada 5 s: no máximo uma leitura a cada 15 s (a marca fica); a rotina e o pedido que nem saiu devolvem a marca", async (tipo) => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    const lidas = () => c.provedor.chamadas.filter((x) => x.metodo === "consultar" || x.metodo === "buscarPorReferencia").length;
    c.provedor.falhas.consultar = new ErroProvedor(tipo, tipo === "limite" ? "Muitas chamadas ao Mercado Pago." : "O Mercado Pago não respondeu.", tipo === "limite" ? 30 : null);
    const inicio = new Date(AGORA.getTime() + 20_000);
    const antes = lidas();
    // Um minuto de consultas a cada 5 s, cada volta com 5 pedidos ao mesmo tempo (várias abas).
    for (let i = 0; i < 12; i++) {
      const quando = new Date(inicio.getTime() + i * 5_000);
      await Promise.all(Array.from({ length: 5 }, () => conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, quando)));
    }
    expect(lidas() - antes).toBe(4);
    const consultadoEm = async () => (await c.tentativa(p.pagamentoId)).consultadoEm?.toISOString();
    expect(await consultadoEm()).toBe(new Date(inicio.getTime() + 45_000).toISOString());
    // A rotina, falhando do mesmo jeito, devolve a marca (não atrasa a releitura dela).
    const rotina = new Date(inicio.getTime() + 61_000);
    expect(await conferirTentativa(db, c.org, p.pagamentoId, c.provedor, rotina, { origem: "rotina" })).toMatchObject({ ok: false });
    expect(await consultadoEm()).toBe(new Date(inicio.getTime() + 45_000).toISOString());
    // Pedido que nem saiu (sem conexão): a página também devolve a marca.
    c.provedor.falhas.consultar = new ErroProvedor("indisponivel", "sem conexão");
    expect(await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, new Date(inicio.getTime() + 62_000))).toMatchObject({ ok: false });
    expect(await consultadoEm()).toBe(new Date(inicio.getTime() + 45_000).toISOString());
    // Voltou: a próxima leitura vale normalmente.
    c.provedor.falhas.consultar = null;
    expect(await conferirCotacaoParaPagina(db, c.org, s.cotacaoId, c.provedor, new Date(inicio.getTime() + 63_000))).toMatchObject({ ok: true, consultou: true });
  });

  it("aviso de cancelamento ligado e desligado num comando só: nunca apaga os outros avisos gravados", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    await db.update(pagamentos).set({ avisos: ["ao_vivo"] }).where(eq(pagamentos.id, p.pagamentoId));
    await marcarAviso(db, p.pagamentoId, "cancelamento_pendente", true);
    await marcarAviso(db, p.pagamentoId, "cancelamento_pendente", true);
    expect((await c.tentativa(p.pagamentoId)).avisos).toEqual(["ao_vivo", "cancelamento_pendente"]);
    // Outro aviso gravado entre uma marcação e outra continua lá.
    await db.update(pagamentos).set({ avisos: ["ao_vivo", "cancelamento_pendente", "situacao_desconhecida"] }).where(eq(pagamentos.id, p.pagamentoId));
    await marcarAviso(db, p.pagamentoId, "cancelamento_pendente", false);
    expect((await c.tentativa(p.pagamentoId)).avisos).toEqual(["ao_vivo", "situacao_desconhecida"]);
    await marcarAviso(db, p.pagamentoId, "cancelamento_pendente", false);
    expect((await c.tentativa(p.pagamentoId)).avisos).toEqual(["ao_vivo", "situacao_desconhecida"]);
  });

  it("ausência lida pela referência antes de a criação gravar o id da order não vira aviso", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    await aplicarNaTransacao(db, c.org, { id: p.pagamentoId, cotacaoId: s.cotacaoId }, { cobranca: null, idLido: null }, minutos(1));
    expect(await c.tentativa(p.pagamentoId)).toMatchObject({ situacao: "pendente", avisos: [] });
    await aplicarNaTransacao(db, c.org, { id: p.pagamentoId, cotacaoId: s.cotacaoId }, { cobranca: null, idLido: p.idProvedor }, minutos(2));
    expect((await c.tentativa(p.pagamentoId)).avisos).toEqual(["order_nao_encontrada"]);
  });
});

describe("rotina de conferência (M8.2a)", () => {
  it("relê uma vez por dia o que confirmou a reserva: devolução ou contestação feitas por fora viram aviso, sem mexer na reserva", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    c.provedor.aprovar(p.idProvedor, { taxa: 1806, liberado: true });
    await conferirPendentes(db, c.org, c.provedor, minutos(2));
    expect((await c.tentativa(p.pagamentoId)).desfecho).toBe("reserva");
    c.provedor.devolverNoProvedor(p.idProvedor, 1000);
    // Antes de um dia, não relê.
    expect((await conferirPendentes(db, c.org, c.provedor, minutos(60))).conferidas).toBe(0);
    await conferirPendentes(db, c.org, c.provedor, minutos(24 * 60 + 5));
    expect(await c.tentativa(p.pagamentoId)).toMatchObject({ situacao: "devolvido_parcial", desfecho: "reserva" });
    expect((await c.tentativa(p.pagamentoId)).avisos).toContain("devolvido_por_fora");
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
    c.provedor.contestar(p.idProvedor);
    await conferirPendentes(db, c.org, c.provedor, minutos(2 * 24 * 60 + 10));
    expect(await c.tentativa(p.pagamentoId)).toMatchObject({ situacao: "contestado", avisos: expect.arrayContaining(["contestado"]) });
  });

  it("a releitura diária para antes do prazo de consulta do Mercado Pago (três meses); order velha não encontrada não vira aviso", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    c.provedor.aprovar(p.idProvedor, { taxa: 1806, liberado: true });
    await conferirPendentes(db, c.org, c.provedor, minutos(2));
    expect((await c.tentativa(p.pagamentoId)).desfecho).toBe("reserva");
    const dia = 24 * 60;
    expect((await conferirPendentes(db, c.org, c.provedor, minutos(84 * dia))).conferidas).toBe(1);
    expect((await conferirPendentes(db, c.org, c.provedor, minutos(86 * dia))).conferidas).toBe(0);
    // Lida à mão depois do prazo de consulta: o provedor não acha a order, e isso não pede atenção.
    await aplicarNaTransacao(db, c.org, { id: p.pagamentoId, cotacaoId: s.cotacaoId }, { cobranca: null, idLido: p.idProvedor }, minutos(91 * dia));
    expect((await c.tentativa(p.pagamentoId)).avisos).not.toContain("order_nao_encontrada");
  });

  it("à espera da liberação: no primeiro dia a cada volta; depois, a cada 6 h", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    c.provedor.aprovar(p.idProvedor, { taxa: 1806 });
    await conferirPendentes(db, c.org, c.provedor, minutos(2));
    expect((await conferirPendentes(db, c.org, c.provedor, minutos(12))).conferidas).toBe(1);
    const dia = 24 * 60;
    expect((await conferirPendentes(db, c.org, c.provedor, minutos(dia + 10))).conferidas).toBe(1);
    expect((await conferirPendentes(db, c.org, c.provedor, minutos(dia + 20))).conferidas).toBe(0);
    expect((await conferirPendentes(db, c.org, c.provedor, minutos(dia + 6 * 60 + 11))).conferidas).toBe(1);
  });

  it("Pix que sobrou numa cotação confirmada e cujo cancelamento falhou: a rotina cancela de novo", async () => {
    const z = await c.segurar();
    const a = await c.pix(z.cotacaoId);
    const extra = await c.provedor.criarPix({ referencia: "scl-sobra", chaveIdempotencia: "sobra", valor: TOTAL, email: "test@testuser.com", nome: "", validadeMinutos: 30, descricao: "", descricaoFatura: null });
    if (!extra.ok) throw new Error("extra");
    const [sobra] = await db.insert(pagamentos).values({ organizacaoId: c.org, cotacaoId: z.cotacaoId, reservaId: z.reservaId, imovelId: c.imovel, ambiente: "teste", forma: "pix", referencia: "scl-sobra", chaveIdempotencia: "sobra", situacao: "pendente", idProvedor: extra.cobranca.idProvedor, valor: TOTAL }).returning();
    c.provedor.falhas.cancelar = new ErroProvedor("incerto", "tempo");
    c.provedor.aprovar(a.idProvedor);
    await conferirTentativa(db, c.org, a.pagamentoId, c.provedor, minutos(2), { origem: "rotina", forcar: true });
    expect(await c.tentativa(sobra.id)).toMatchObject({ situacao: "pendente", avisos: ["cancelamento_pendente"] });
    c.provedor.falhas.cancelar = null;
    const r = await conferirPendentes(db, c.org, c.provedor, minutos(15));
    expect(r.canceladas).toBe(1);
    expect(await c.tentativa(sobra.id)).toMatchObject({ situacao: "cancelado", avisos: [] });
    // Cada pedido de cancelamento usa chave nova (repetir a chave dá "chave já usada" no provedor).
    const chaves = c.provedor.chamadas.filter((x) => x.metodo === "cancelar" && x.id === extra.cobranca.idProvedor).map((x) => x.chave);
    expect(chaves).toHaveLength(2);
    expect(new Set(chaves).size).toBe(2);
  });
});

describe("rotina do site e situação do Mercado Pago (M8.2a)", () => {
  it("a rotina confere os pagamentos ANTES de vencer holds: Pix pago e ainda não lido depois da carência confirma, não vence", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    const T = (await c.cotacao(s.cotacaoId)).holdAte!;
    c.provedor.aprovar(p.idProvedor);
    const r = await rotinaDoSite(db, c.provedor, new Date(T.getTime() + 20 * 60_000));
    expect(r.pagamentos).toMatchObject({ mudaram: 1 });
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
    // Sem provedor (pagamento desligado), só vence os holds.
    expect((await rotinaDoSite(db, null, new Date(T.getTime() + 21 * 60_000))).pagamentos).toBeNull();
  });

  it("limpeza dos avisos com mais de 90 dias: na rotina do site, mesmo sem provedor (deploy de produção); nunca no Conferir agora de uma empresa", async () => {
    const ev = await registrarEventoDeAviso(db, { tipo: "order", acao: "order.processed", dataId: "ORDTSTLIMPA1", requestId: "r-limpa", ts: "9" }, AGORA);
    const depois = new Date(AGORA.getTime() + (GUARDAR_EVENTOS_DIAS + 1) * 86_400_000);
    await conferirPendentes(db, c.org, c.provedor, depois);
    expect(await db.select().from(eventosPagamento).where(eq(eventosPagamento.id, ev!.id))).toHaveLength(1);
    const r = await rotinaDoSite(db, null, depois);
    expect(r.pagamentos).toBeNull();
    expect(r.eventosApagados).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(eventosPagamento).where(eq(eventosPagamento.id, ev!.id))).toEqual([]);
  });

  it("Integrações: situação, conta conferida, segredo do webhook, avisos — sem chaves nem segredo na resposta", async () => {
    const chaves = { MERCADOPAGO_ACCESS_TOKEN: "APP_USR-ficticio", MERCADOPAGO_PUBLIC_KEY: "APP_USR-publica", MERCADOPAGO_WEBHOOK_SECRET: "segredo-ficticio" };
    const previa = await situacaoDoMercadoPago(db, env({ ...chaves, VERCEL_ENV: "production" }), AGORA);
    expect(previa).toMatchObject({ situacao: "so_nas_previas", contaDeTeste: null, segredoWebhook: true, enderecoWebhook: ENDERECO_WEBHOOK });
    const teste = await situacaoDoMercadoPago(db, env(chaves), AGORA, { provedor: c.provedor });
    expect(teste).toMatchObject({ situacao: "teste", contaDeTeste: true, segredoWebhook: true });
    expect(JSON.stringify(teste)).not.toContain("segredo-ficticio");
    expect(JSON.stringify(teste)).not.toContain("APP_USR");
    expect(await situacaoDoMercadoPago(db, env(), AGORA)).toMatchObject({ situacao: "desligado", motivo: expect.stringContaining("Falta configurar"), segredoWebhook: false });
    expect(segredoDoWebhook(env({ MERCADOPAGO_WEBHOOK_SECRET: "  " }))).toBeNull();
  });

  it("Integrações e Sistema: a conferência da conta que não responde não prende a tela (sai \"não conferida\" no prazo)", async () => {
    const chaves = { MERCADOPAGO_ACCESS_TOKEN: "APP_USR-ficticio", MERCADOPAGO_PUBLIC_KEY: "APP_USR-publica" };
    const lento = new ProvedorFalso(() => AGORA);
    lento.conferirContaDeTeste = () => new Promise<boolean | null>(() => {});
    const inicio = performance.now();
    const r = await situacaoDoMercadoPago(db, env(chaves), AGORA, { provedor: lento, esperaMs: 50 });
    expect(r).toMatchObject({ situacao: "teste", contaDeTeste: null });
    expect(performance.now() - inicio).toBeLessThan(1_000);
  });
});
