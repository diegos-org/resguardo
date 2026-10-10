/**
 * M8.2c — as mensagens do cancelamento de reserva paga pelo site: pedido recebido, decisão e devolução feita. O motor
 * manda só ligado, uma vez por referência, e acende a marca de "mensagem enviada" no cancelamento; não manda o que a
 * equipe já marcou. As mensagens prontas para copiar no painel usam o mesmo preenchimento. Dados fictícios.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lerEmpresa, salvarEmpresa } from "@/configuracoes/empresa";
import { atualizarModelo, criarModelo } from "@/configuracoes/modelos";
import { TEXTOS_BASE_CANCELAMENTO } from "@/configuracoes/modelos-texto";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { cancelamentosReserva, devolucoesPagamento, mensagensHospede, modelosMensagem } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { pedirCancelamentoPeloHospede } from "@/hospede/cancelamento";
import { marcarHospedeAvisado } from "@/pagamentos/cancelamento";
import { conferirTentativa } from "@/pagamentos/conferencia";
import { registrarDevolucaoPorFora, tentarDevolucao } from "@/pagamentos/devolucao";
import { AGORA, aumentarDeTeste, type Cenario, cancelar, EMAIL_HOSPEDE, entradaPadrao, minutos, montarCenario, pagarEConfirmar, pedir, reduzirDeTeste, TOTAL, usuarioDeTeste } from "@/pagamentos/testes";
import { enviarMensagensHospede, mensagensDoCancelamento, salvarConfigMensagens } from "./hospede";

let db: Db, close: () => Promise<void>, c: Cenario, correio: CorreioMemoria, equipe: string;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  modelos = null;
  correio = new CorreioMemoria();
  equipe = await usuarioDeTeste(c);
  await salvarEmpresa(db, c.org, { ...(await lerEmpresa(db, c.org)), nome: "Sua Casa Exemplo", site: "https://www.exemplo.com.br/" }, null);
});

const SITE = "https://www.exemplo.com.br";
const longe = { entrada: "2026-11-20", saida: "2026-11-23" };
const cancelamentoDe = async (reservaId: string) => (await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, reservaId))).find((x) => x.situacao !== "descartado")!;

let modelos: Record<string, string> | null = null;
/** Os três modelos (o texto-base de cada um, criados uma vez) e o envio ligado (ou não) para reservas do site desde `quando`. */
async function ligar(quando: Date = AGORA, ativo = true) {
  const criar = async (nome: string, texto: string) => {
    const r = await criarModelo(db, c.org, { nome, quando: "", texto }, null);
    if (!r.ok || !r.modelo) throw new Error(JSON.stringify(r));
    return r.modelo.id;
  };
  modelos ??= {
    cancelamento_recebido: await criar("Pedido recebido", TEXTOS_BASE_CANCELAMENTO.cancelamento_recebido),
    cancelamento_decidido: await criar("Cancelamento decidido", TEXTOS_BASE_CANCELAMENTO.cancelamento_decidido),
    devolucao_concluida: await criar("Devolução feita", TEXTOS_BASE_CANCELAMENTO.devolucao_concluida),
  };
  expect(await salvarConfigMensagens(db, c.org, { ativo, origens: ["site"], modelos }, null, quando)).toEqual({ ok: true });
}

describe("mensagens do cancelamento pelo motor (M8.2c)", () => {
  it("pedido recebido, decisão e devolução feita: cada uma uma vez, preenchidas com o texto da página, e a marca acende pelo sistema", async () => {
    await ligar();
    const x = await pagarEConfirmar(c);
    const p = await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60));
    expect(p).toMatchObject({ ok: true });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(61))).toMatchObject({ enviadas: 1, falhas: 0, avisos: [] });
    expect(correio.enviadas).toHaveLength(1);
    expect(correio.enviadas[0]).toMatchObject({
      para: EMAIL_HOSPEDE,
      assunto: `Pedido recebido — reserva ${x.reservaCodigo}`,
      texto: `Olá, Visitante Fictício! Recebemos o seu pedido de cancelamento da reserva ${x.reservaCodigo} em 01/10/2026 às 13:00 (horário de Brasília). Vamos conferir pela Política de cancelamento que você aceitou e confirmamos com você, por escrito, o valor da devolução. Acompanhe em ${SITE}/reservar/${x.codigo}.`,
    });
    expect(await cancelamentoDe(x.reservaId)).toMatchObject({ hospedeAvisadoPedidoEm: minutos(61), hospedeAvisadoPedidoPor: null });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(62))).toMatchObject({ enviadas: 0 });

    // A equipe cancela (dentro do arrependimento: integral); a devolução é confirmada pela leitura na hora.
    await cancelar(c, x.reservaId, entradaPadrao(), equipe, minutos(120));
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(121))).toMatchObject({ enviadas: 2 });
    const [decidido, devolvida] = correio.enviadas.slice(1);
    expect(decidido.texto).toBe(
      `Olá, Visitante Fictício! A reserva ${x.reservaCodigo} foi cancelada. Pela Política de cancelamento que você aceitou (versão 1), devolvemos o valor integral pago, R$ 1.824,00, ${TEXTOS_SITE_INICIAIS.cancelamentoSemTaxas} Devolução de R$ 1.824,00 confirmada pelo Mercado Pago em 01/10. Acompanhe em ${SITE}/reservar/${x.codigo}. Qualquer dúvida, é só responder esta mensagem.`,
    );
    expect(devolvida.texto).toBe(`Olá, Visitante Fictício! A devolução de R$ 1.824,00 da reserva ${x.reservaCodigo} foi feita em 01/10/2026. ${TEXTOS_SITE_INICIAIS.cancelamentoVoltaPix}`);
    expect(await cancelamentoDe(x.reservaId)).toMatchObject({ hospedeAvisadoDecisaoEm: minutos(121), hospedeAvisadoDevolucaoEm: minutos(121), hospedeAvisadoDecisaoPor: null });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(122))).toMatchObject({ enviadas: 0 });
    expect((await db.select().from(mensagensHospede).where(eq(mensagensHospede.reservaId, x.reservaId))).map((m) => [m.tipo, m.estado]).sort()).toEqual([
      ["cancelamento_decidido", "enviado"],
      ["cancelamento_recebido", "enviado"],
      ["devolucao_concluida", "enviado"],
    ]);
    for (const m of correio.enviadas) expect(m.texto).not.toMatch(/Beds24/i);
  });

  it("desligado, nada sai; a marca da equipe impede o envio; a SCL cancelando não manda 'pedido recebido'; sem devolução não há 'devolução feita'", async () => {
    await ligar(AGORA, false);
    const x = await pagarEConfirmar(c, longe);
    await pedir(c, x.reservaId, equipe, { recebidoEm: minutos(30), quando: minutos(40) });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(41))).toMatchObject({ desligado: true, enviadas: 0 });
    expect(correio.enviadas).toEqual([]);

    await ligar(AGORA);
    // A equipe já mandou o "pedido recebido" à mão: o motor não manda.
    expect(await marcarHospedeAvisado(db, c.org, x.reservaId, "pedido", equipe, minutos(42))).toEqual({ ok: true });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(43))).toMatchObject({ enviadas: 0 });

    // A SCL cancela outra reserva (sem pedido do hóspede): só a decisão e a devolução feita.
    const y = await pagarEConfirmar(c, { entrada: "2026-11-25", saida: "2026-11-27", email: "y@example.com" });
    await cancelar(c, y.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, minutos(60));
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(61))).toMatchObject({ enviadas: 2 });
    expect(correio.enviadas.map((m) => m.assunto).sort()).toEqual([`Cancelamento decidido — reserva ${y.reservaCodigo}`, `Devolução feita — reserva ${y.reservaCodigo}`]);
    expect(correio.enviadas.find((m) => m.assunto.startsWith("Cancelamento decidido"))!.texto).toContain("devolvemos o valor integral pago, R$ 1.296,00");

    // Sem devolução (valor retido): a decisão, nunca a devolução feita.
    const z = await pagarEConfirmar(c, { email: "z@example.com" });
    await cancelar(c, z.reservaId, entradaPadrao({ recebidoEm: new Date("2026-10-10T10:00:00-03:00"), canal: "email" }), equipe, new Date("2026-10-10T11:00:00-03:00"));
    const antes = correio.enviadas.length;
    // (O pedido do hóspede registrado pela equipe também recebe o "pedido recebido": é o recibo por escrito.)
    expect(await enviarMensagensHospede(db, c.org, correio, new Date("2026-10-10T11:05:00-03:00"))).toMatchObject({ enviadas: 2 });
    const ultimas = correio.enviadas.slice(antes);
    expect(ultimas.map((m) => m.assunto).sort()).toEqual([`Cancelamento decidido — reserva ${z.reservaCodigo}`, `Pedido recebido — reserva ${z.reservaCodigo}`]);
    // Paga em 01/10 com o prazo do integral até 28/09: esse prazo nunca valeu para ela (não aparece), só o arrependimento.
    expect(ultimas.find((m) => m.assunto.startsWith("Cancelamento decidido"))!.texto).toContain("Esta reserva foi paga quando o prazo de reembolso integral já tinha passado. Arrependimento: até 08/10.");
  });

  it("pedido do hóspede pelo site e a SCL cancela antes de o motor rodar: o 'pedido recebido' sai mesmo assim (o recibo é do pedido), com a hora do pedido; o botão de copiar também", async () => {
    await ligar();
    const x = await pagarEConfirmar(c, longe);
    expect(await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60))).toMatchObject({ ok: true });
    await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "imovel_sem_condicoes" }), equipe, minutos(61));
    expect(await cancelamentoDe(x.reservaId)).toMatchObject({ situacao: "cancelada", quemCancela: "empresa", canal: "site", pedidoRecebidoEm: minutos(60) });
    expect((await mensagensDoCancelamento(db, c.org, x.reservaId, minutos(62))).recebido?.texto).toContain(`Recebemos o seu pedido de cancelamento da reserva ${x.reservaCodigo} em 01/10/2026 às 13:00`);
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(62))).toMatchObject({ enviadas: 3, falhas: 0, avisos: [] });
    expect(correio.enviadas.map((m) => m.assunto).sort()).toEqual([`Cancelamento decidido — reserva ${x.reservaCodigo}`, `Devolução feita — reserva ${x.reservaCodigo}`, `Pedido recebido — reserva ${x.reservaCodigo}`]);
    expect(correio.enviadas.find((m) => m.assunto.startsWith("Cancelamento decidido"))!.texto).toContain("devolvemos o valor integral pago, R$ 1.824,00");
    expect(await cancelamentoDe(x.reservaId)).toMatchObject({ hospedeAvisadoPedidoEm: minutos(62), hospedeAvisadoDecisaoEm: minutos(62), hospedeAvisadoDevolucaoEm: minutos(62) });
  });
});

describe("mensagens prontas para copiar no painel (M8.2c)", () => {
  it("do texto-base sem modelo escolhido; null quando não cabem; com dado faltando, sem texto e com o que falta", async () => {
    const x = await pagarEConfirmar(c);
    expect(await mensagensDoCancelamento(db, c.org, x.reservaId, minutos(10))).toEqual({ recebido: null, decidido: null, devolvida: null });
    await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60));
    const pedido = await mensagensDoCancelamento(db, c.org, x.reservaId, minutos(70));
    expect(pedido).toMatchObject({ recebido: { falta: [], textoBase: true, texto: expect.stringContaining(`Recebemos o seu pedido de cancelamento da reserva ${x.reservaCodigo} em 01/10/2026 às 13:00`) }, decidido: null, devolvida: null });
    // Sem o endereço do site em Configurações → Empresa: o link falta.
    await salvarEmpresa(db, c.org, { ...(await lerEmpresa(db, c.org)), site: "" }, null);
    expect((await mensagensDoCancelamento(db, c.org, x.reservaId, minutos(70))).recebido).toEqual({ texto: null, falta: ["link"], textoBase: true });
    await salvarEmpresa(db, c.org, { ...(await lerEmpresa(db, c.org)), site: SITE }, null);
    // Decidida com a devolução ainda pedida: a decisão, sem a devolução feita; confirmada, as duas.
    c.provedor.respostaDevolucao = "pedida";
    await cancelar(c, x.reservaId, entradaPadrao(), equipe, minutos(120));
    const decidida = await mensagensDoCancelamento(db, c.org, x.reservaId, minutos(130));
    expect(decidida.decidido?.texto).toContain(TEXTOS_SITE_INICIAIS.cancelamentoDevolucaoPedida);
    expect(decidida.devolvida).toBeNull();
    c.provedor.confirmarDevolucoes(x.idProvedor);
    const { conferirTentativa } = await import("@/pagamentos/conferencia");
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, minutos(140), { origem: "painel", forcar: true });
    const feita = await mensagensDoCancelamento(db, c.org, x.reservaId, minutos(150));
    expect(feita.devolvida).toEqual({ texto: `Olá, Visitante Fictício! A devolução de R$ 1.824,00 da reserva ${x.reservaCodigo} foi feita em 01/10/2026. ${TEXTOS_SITE_INICIAIS.cancelamentoVoltaPix}`, falta: [], textoBase: true });
    // O botão de copiar não depende do prazo do envio automático: o "pedido recebido" continua disponível depois.
    expect((await mensagensDoCancelamento(db, c.org, x.reservaId, new Date(minutos(60).getTime() + 3 * 86_400_000))).recebido?.texto).toContain("Recebemos o seu pedido");
    expect(await mensagensDoCancelamento(db, c.org, "nao-e-uuid", minutos(150))).toEqual({ recebido: null, decidido: null, devolvida: null });
  });

  it("modelo editado depois de escolhido com {valor} no pedido recebido: a edição é recusada; e um texto gravado que não serve não chega ao botão de copiar (usa o texto-base, sem R$)", async () => {
    const x = await pagarEConfirmar(c);
    const r = await criarModelo(db, c.org, { nome: "Recibo", quando: "", texto: "Recebemos o pedido da reserva {codigo} em {recebido}." }, null);
    if (!r.ok || !r.modelo) throw new Error("modelo");
    const id = r.modelo.id;
    expect(await salvarConfigMensagens(db, c.org, { ativo: false, origens: ["site"], modelos: { cancelamento_recebido: id } }, null, AGORA)).toEqual({ ok: true });
    // Editar o modelo escolhido para pôr {valor}: recusado, como na escolha (a operação copia esta mensagem).
    expect(await atualizarModelo(db, c.org, id, { dados: { nome: "Recibo", quando: "", texto: "Recebemos o pedido da reserva {codigo} em {recebido}. Devolução de {valor}." } }, null)).toMatchObject({
      ok: false,
      erros: { texto: expect.stringContaining("não pode usar {valor}") },
    });
    // Um texto que não serve gravado assim mesmo (antes desta conferência): a cópia não o usa.
    await db.update(modelosMensagem).set({ texto: "Recebemos {codigo} em {recebido}. Devolução de {valor}. {decisao}" }).where(eq(modelosMensagem.id, id));
    await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60));
    await cancelar(c, x.reservaId, entradaPadrao(), equipe, minutos(120));
    const m = await mensagensDoCancelamento(db, c.org, x.reservaId, minutos(130));
    expect(m.recebido).toMatchObject({ textoBase: true, modeloRecusado: expect.stringContaining("não pode usar {valor}") });
    expect(m.recebido!.texto).toContain("Recebemos o seu pedido de cancelamento");
    expect(m.recebido!.texto).not.toContain("R$");
  });

  it("pagamento sem a política aceita: o texto-base do pedido recebido não diz 'a política que você aceitou'", async () => {
    const x = await pagarEConfirmar(c, { semAceite: true });
    await pedirCancelamentoPeloHospede(db, c.org, EMAIL_HOSPEDE, x.reservaCodigo, minutos(60));
    const m = await mensagensDoCancelamento(db, c.org, x.reservaId, minutos(70));
    expect(m.recebido?.texto).toContain("Recebemos o seu pedido de cancelamento");
    expect(m.recebido?.texto).not.toContain("que você aceitou");
    expect(m.recebido?.texto).toContain("confirmamos com você, por escrito, o valor da devolução");
  });
});

describe("a devolução feita do cancelamento de uma reserva alterada (M8.2d)", () => {
  it("duas devoluções (o pagamento da reserva e a diferença): a mensagem sai uma vez, só quando as duas se realizaram, com o total", async () => {
    await ligar();
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const inc = await aumentarDeTeste(c, x, TOTAL + 40000, { quando: minutos(15) });
    c.provedor.respostaDevolucao = "pedida";
    await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, minutos(60));
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(61))).toMatchObject({ enviadas: 1 });
    expect(correio.enviadas.map((m) => m.assunto)).not.toContainEqual(expect.stringContaining("Devolução"));
    c.provedor.confirmarDevolucoes(x.idProvedor);
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, minutos(70), { origem: "rotina", forcar: true });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(71))).toMatchObject({ enviadas: 0 });
    c.provedor.confirmarDevolucoes(inc.idProvedor);
    await conferirTentativa(db, c.org, inc.pagamentoId, c.provedor, minutos(80), { origem: "rotina", forcar: true });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(81))).toMatchObject({ enviadas: 1 });
    expect(correio.enviadas.at(-1)?.texto).toContain("A devolução de R$ 2.224,00");
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(82))).toMatchObject({ enviadas: 0 });
    expect((await cancelamentoDe(x.reservaId)).hospedeAvisadoDevolucaoEm).toEqual(minutos(81));
  });

  it("depois de uma redução confirmada, o restante recusado pelo Mercado Pago: nada de 'devolução feita' enquanto ele não sai; feito por fora, a mensagem sai uma vez, com o valor do cancelamento", async () => {
    await ligar();
    const x = await pagarEConfirmar(c, { ...longe, liberar: true });
    const red = await reduzirDeTeste(c, x, TOTAL - 30000, { quando: minutos(15) });
    expect(await tentarDevolucao(db, c.org, red.devolucaoIds[0], c.provedor, minutos(20))).toBe("confirmada");
    c.provedor.respostaDevolucao = "saldo_insuficiente";
    await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, minutos(60));
    const [d] = (await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId))).filter((y) => y.origem === "cancelamento");
    for (const m of [71, 82]) await tentarDevolucao(db, c.org, d.id, c.provedor, minutos(m));
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(83))).toMatchObject({ enviadas: 1 });
    expect(correio.enviadas.map((m) => m.assunto)).not.toContainEqual(expect.stringContaining("Devolução"));
    c.provedor.respostaDevolucao = "confirmada";
    expect(await registrarDevolucaoPorFora(db, c.org, { devolucaoId: d.id }, { data: "2026-10-01", valor: TOTAL - 30000, nota: "Pix da conta da empresa" }, equipe, c.provedor, minutos(90))).toMatchObject({ ok: true });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(91))).toMatchObject({ enviadas: 1 });
    expect(correio.enviadas.at(-1)?.texto).toContain("A devolução de R$ 1.524,00");
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(92))).toMatchObject({ enviadas: 0 });
    expect((await cancelamentoDe(x.reservaId)).hospedeAvisadoDevolucaoEm).toEqual(minutos(91));
  });
});
