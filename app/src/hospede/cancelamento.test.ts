/**
 * M8.2c — o pedido de cancelamento pelo hóspede em Minha reserva: só a reserva paga pelo site do próprio e-mail, antes
 * da entrada e com o botão ligado; a hora do servidor, gravada uma vez; a trava ocupada tentada de novo com a mesma hora;
 * a equipe que cancela no meio; o e-mail à equipe sem dado do hóspede. Dados fictícios; provedor e correio falsos.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { lerEmpresa, salvarEmpresa } from "@/configuracoes/empresa";
import { lerConfigPagamentoSite, salvarConfigPagamentoSite } from "@/configuracoes/pagamento-site";
import { auditoria, cancelamentosReserva, reservas } from "@/db/schema";
import { previaDoCancelamento } from "@/pagamentos/cancelamento";
import { conferirTentativa } from "@/pagamentos/conferencia";
import { tentarDevolucao } from "@/pagamentos/devolucao";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { type Cenario, cancelar, EMAIL_HOSPEDE, entradaPadrao, minutos, montarCenario, NOME_HOSPEDE, pagarEConfirmar, pedir, reduzirDeTeste, semDadosDoHospede, TELEFONE_HOSPEDE, TOTAL, usuarioDeTeste } from "@/pagamentos/testes";
import { avisarEquipeDoPedido, cancelamentoNoPortal, mensagemPedidoDeCancelamento, pedirCancelamentoPeloHospede } from "./cancelamento";

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });
// Dados pessoais (§10): depois de cada fluxo, nem o e-mail, nem o telefone, nem o nome do hóspede nas tabelas do pagamento,
// do cancelamento e do livro, nem na auditoria (o nome fica só na da reserva criada no M8.1, `reserva.importar`).
afterEach(async () => {
  expect(await semDadosDoHospede(db)).toEqual([]);
});

const NAO_DA = "Não foi possível registrar o pedido por aqui: fale com a equipe.";
/** Um instante em São Paulo ("2026-10-12 15:00"). */
const sp = (dataHora: string) => new Date(`${dataHora.replace(" ", "T")}:00-03:00`);
const ativos = (reservaId: string) => db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, reservaId));

describe("Minha reserva: o quadro 'Cancelar a reserva' (M8.2c)", () => {
  it("só a reserva paga pelo site do próprio e-mail; outro e-mail ou código: nada (e a mesma recusa genérica); o botão desligado; depois da entrada, some", async () => {
    const x = await pagarEConfirmar(c);
    const quadro = await cancelamentoNoPortal(db, c.org, " Visitante@Example.com ", x.reservaCodigo.toLowerCase(), minutos(60));
    expect(quadro).toEqual({
      podePedir: true,
      pedidoEm: null,
      integralAte: "2026-09-28",
      arrependimentoAte: "2026-10-08",
      arrependimentoAteEntrada: true,
      entradaEm: sp("2026-10-12 15:00"),
      direitoAgora: "integral",
      semPolitica: false,
      linkCotacao: `/reservar/${x.codigo}`,
    });
    // Nunca valores no quadro.
    expect(JSON.stringify(quadro)).not.toMatch(/R\$|182400|1824/);
    // Outro e-mail, código inexistente ou malformado: nada aparece, e o pedido recebe a mesma recusa.
    for (const [email, codigo] of [
      ["outra@example.com", x.reservaCodigo],
      [EMAIL_HOSPEDE, "SCL-NAOEXISTE"],
      [EMAIL_HOSPEDE, "x'; drop"],
      ["sem-arroba", x.reservaCodigo],
    ]) {
      expect(await cancelamentoNoPortal(db, c.org, email, codigo, minutos(60))).toBeNull();
      expect(await pedirCancelamentoPeloHospede(db, c.org, email, codigo, minutos(60))).toEqual({ ok: false, erro: NAO_DA });
    }
    // Outra empresa: nada.
    expect(await cancelamentoNoPortal(db, "00000000-0000-4000-8000-000000000009", EMAIL_HOSPEDE, x.reservaCodigo, minutos(60))).toBeNull();
    // Depois do prazo integral e do arrependimento, o quadro diz "sem devolução" (sem valores).
    expect((await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, sp("2026-10-10 10:00")))?.direitoAgora).toBe("nenhum");
    // A partir do horário de entrada, o botão some (saída antecipada não é cancelamento) e o pedido é recusado.
    expect((await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, sp("2026-10-12 15:00")))?.podePedir).toBe(false);
    expect(await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, sp("2026-10-12 15:00"))).toEqual({ ok: false, erro: "A estadia já começou: para cancelar, fale com a equipe." });
    // Botão desligado em Configurações → Pagamento no site.
    const config = await lerConfigPagamentoSite(db, c.org);
    expect((await salvarConfigPagamentoSite(db, c.org, { ...config, pedidoCancelamentoNoPortal: false }, null)).ok).toBe(true);
    expect((await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60)))?.podePedir).toBe(false);
    expect(await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60))).toEqual({ ok: false, erro: "O pedido de cancelamento pelo site está desligado: fale com a equipe." });
    expect(await ativos(x.reservaId)).toEqual([]);
  });

  it("reserva que não foi paga pelo site: o quadro não aparece; pagamento sem o aceite da política: sem datas nem direito", async () => {
    const s = await c.segurar({ email: "segura@example.com" });
    expect(await cancelamentoNoPortal(db, c.org, "segura@example.com", (await c.reserva(s.reservaId)).codigo, minutos(5))).toBeNull();
    const x = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23", semAceite: true });
    expect(await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60))).toMatchObject({ podePedir: true, semPolitica: true, integralAte: null, arrependimentoAte: null, direitoAgora: null });
  });

  it("o pedido: a hora do servidor, canal site, auditoria sem usuário; pedir de novo devolve a mesma hora; a equipe decide com essa hora; depois de cancelada, o quadro some", async () => {
    const x = await pagarEConfirmar(c);
    const r = await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60));
    expect(r).toMatchObject({ ok: true, recebidoEm: minutos(60), novo: true });
    const [linha] = await ativos(x.reservaId);
    expect(linha).toMatchObject({ situacao: "pedido", canal: "site", quemCancela: "hospede", pedidoPor: null, pedidoRecebidoEm: minutos(60), pagamentoId: x.pagamentoId, nota: "" });
    const [a] = await db.select().from(auditoria).where(and(eq(auditoria.acao, "reserva.cancelamento_pedido"), eq(auditoria.entidadeId, x.reservaId)));
    expect(a).toMatchObject({ usuarioId: null, mudancas: { canal: [null, "site"], recebidoEm: [null, minutos(60).toISOString()] } });
    // De novo, mais tarde: o mesmo pedido, com a hora de antes.
    expect(await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(90))).toEqual({ ok: true, recebidoEm: minutos(60), cancelamentoId: linha.id, novo: false });
    expect(await ativos(x.reservaId)).toHaveLength(1);
    expect(await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(95))).toMatchObject({ podePedir: false, pedidoEm: minutos(60) });
    // A equipe não registra outro pedido por cima.
    const equipe = await usuarioDeTeste(c);
    expect(await pedir(c, x.reservaId, equipe, { recebidoEm: minutos(100), quando: minutos(100) })).toMatchObject({ ok: false });
    // A equipe cancela dias depois: vale a hora do pedido pelo site (dentro do arrependimento, integral).
    const { previa, resultado } = await cancelar(c, x.reservaId, entradaPadrao({ recebidoEm: sp("2026-10-10 10:00"), canal: "whatsapp" }), equipe, sp("2026-10-10 11:00"));
    expect(previa).toMatchObject({ ok: true, previa: { recebidoEm: minutos(60), canal: "site", direito: "integral", base: "arrependimento" } });
    expect(resultado).toMatchObject({ ok: true, direito: "integral" });
    expect(await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, sp("2026-10-10 12:00"))).toBeNull();
    expect(await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, sp("2026-10-10 12:00"))).toMatchObject({ ok: false });
    // (O nome do hóspede fica na auditoria da reserva desde o M8.1 — `reserva.importar` —, fora das tabelas do pagamento;
    // a varredura procura o nome em todo o resto.)
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("trava ocupada: uma tentativa de novo com a MESMA hora; ocupada de novo, pede para tentar em instantes (nada gravado)", async () => {
    const x = await pagarEConfirmar(c);
    const trava = () => Object.assign(new Error("lock timeout"), { code: "55P03" });
    const espiao = vi.spyOn(db, "transaction").mockRejectedValueOnce(trava());
    expect(await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60))).toMatchObject({ ok: true, recebidoEm: minutos(60), novo: true });
    espiao.mockRestore();
    const y = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23", email: "y@example.com" });
    const de = vi.spyOn(db, "transaction").mockRejectedValueOnce(trava()).mockRejectedValueOnce(Object.assign(new Error("deadlock"), { code: "40P01" }));
    expect(await pedirCancelamentoPeloHospede(db, c.org, "y@example.com", y.reservaCodigo, minutos(60))).toEqual({ ok: false, erro: "Não deu para registrar o pedido agora: tente de novo em instantes." });
    de.mockRestore();
    expect(await ativos(y.reservaId)).toEqual([]);
  });

  it("a equipe cancela entre a conferência e a trava: 'já cancelada'; outro pedido gravado ao mesmo tempo (índice único): responde por ele", async () => {
    const equipe = await usuarioDeTeste(c);
    const x = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23" });
    const original = db.transaction.bind(db);
    const espiao = vi.spyOn(db, "transaction").mockImplementationOnce(async (fn) => {
      // A equipe cancela pela política antes de o pedido do hóspede pegar a trava.
      await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, minutos(59));
      return original(fn);
    });
    expect(await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60))).toEqual({ ok: false, erro: "Esta reserva já foi cancelada." });
    espiao.mockRestore();
    expect((await ativos(x.reservaId)).map((l) => l.situacao)).toEqual(["cancelada"]);

    // O pedido da equipe gravado ao mesmo tempo que o do hóspede: o índice único recusa o segundo; vale o que ficou.
    const y = await pagarEConfirmar(c, { email: "y@example.com" });
    const dup = vi.spyOn(db, "transaction").mockImplementationOnce(async () => {
      await pedir(c, y.reservaId, equipe, { recebidoEm: minutos(55), quando: minutos(59) });
      throw Object.assign(new Error('duplicate key value violates unique constraint "cancelamentos_reserva_um_ativo"'), { code: "23505", constraint: "cancelamentos_reserva_um_ativo" });
    });
    expect(await pedirCancelamentoPeloHospede(db, c.org, "y@example.com", y.reservaCodigo, minutos(60))).toMatchObject({ ok: true, recebidoEm: minutos(55), novo: false });
    dup.mockRestore();
  });

  it("e-mail à equipe: o código, o apartamento e a hora; nunca o nome, o e-mail nem valores; sem e-mail da empresa ou sem correio, não envia", async () => {
    const x = await pagarEConfirmar(c);
    const r = await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60));
    if (!r.ok) throw new Error(r.erro);
    const correio = new CorreioMemoria();
    const link = `https://painel.exemplo/painel/reservas/${x.reservaId}`;
    expect(await avisarEquipeDoPedido(db, c.org, r.cancelamentoId, correio, link)).toBe("sem-email");
    expect(await avisarEquipeDoPedido(db, c.org, r.cancelamentoId, null, link)).toBe("sem-correio");
    await salvarEmpresa(db, c.org, { ...(await lerEmpresa(db, c.org)), email: "equipe@example.com" }, null);
    expect(await avisarEquipeDoPedido(db, c.org, r.cancelamentoId, correio, link)).toBe("enviado");
    expect(await avisarEquipeDoPedido(db, c.org, "nao-e-uuid", correio, link)).toBe("falhou");
    expect(await avisarEquipeDoPedido(db, "00000000-0000-4000-8000-000000000009", r.cancelamentoId, correio, link)).toBe("falhou");
    expect(correio.enviadas).toHaveLength(1);
    const [m] = correio.enviadas;
    expect(m).toMatchObject({
      para: "equipe@example.com",
      assunto: `Pedido de cancelamento pelo site: reserva ${x.reservaCodigo}`,
      texto: `Pedido de cancelamento pelo site: reserva ${x.reservaCodigo} (Studio Exemplo), recebido em 01/10 às 13:00 (horário de Brasília). Veja no painel: ${link}.\n`,
      conteudoRestrito: true,
      chave: `cancelamento:${r.cancelamentoId}:aviso`,
    });
    for (const proibido of [EMAIL_HOSPEDE, NOME_HOSPEDE, TELEFONE_HOSPEDE, "R$"]) expect(JSON.stringify(m)).not.toContain(proibido);
    expect(mensagemPedidoDeCancelamento({ reservaCodigo: "SCL-ABC123", imovel: "403", recebidoEm: sp("2026-10-10 23:59") }, "/painel/reservas/1")).toEqual({
      assunto: "Pedido de cancelamento pelo site: reserva SCL-ABC123",
      texto: "Pedido de cancelamento pelo site: reserva SCL-ABC123 (403), recebido em 10/10 às 23:59 (horário de Brasília). Veja no painel: /painel/reservas/1.\n",
    });
  });
});

describe("Minha reserva depois de uma alteração ou de uma devolução em parte (M8.2d)", () => {
  const longe = { entrada: "2026-11-20", saida: "2026-11-23" };

  it("reserva movida para antes: o prazo do quadro é o mesmo do painel (conta da entrada que conta)", async () => {
    const x = await pagarEConfirmar(c, longe);
    await db.update(reservas).set({ checkin: "2026-11-10", checkout: "2026-11-13" }).where(eq(reservas.id, x.reservaId));
    const quadro = await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60));
    const previa = await previaDoCancelamento(db, c.org, x.reservaId, entradaPadrao({ recebidoEm: minutos(50), canal: "whatsapp" }), c.provedor, minutos(60));
    if (!previa.ok) throw new Error(previa.erro);
    expect(quadro?.integralAte).toBe("2026-10-27");
    expect(previa.previa.decisao.integralAte).toBe(quadro?.integralAte);
  });

  it("devolvida em parte pela redução (do sistema): o botão continua e o pedido é gravado; devolvida em parte pelo painel do Mercado Pago (fora do sistema): o botão some", async () => {
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const { devolucaoIds } = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    expect(await tentarDevolucao(db, c.org, devolucaoIds[0], c.provedor, minutos(20))).toBe("confirmada");
    expect((await c.tentativa(x.pagamentoId)).situacao).toBe("devolvido_parcial");
    expect((await cancelamentoNoPortal(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60)))?.podePedir).toBe(true);
    expect(await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60))).toMatchObject({ ok: true, novo: true });

    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com" });
    c.provedor.devolverNoProvedor(y.idProvedor, 1000);
    await conferirTentativa(db, c.org, y.pagamentoId, c.provedor, minutos(30), { origem: "rotina", forcar: true });
    expect((await cancelamentoNoPortal(db, c.org, "y@example.com", y.reservaCodigo, minutos(60)))?.podePedir).toBe(false);
    expect(await pedirCancelamentoPeloHospede(db, c.org, "y@example.com", y.reservaCodigo, minutos(60))).toEqual({ ok: false, erro: NAO_DA });
  });
});
