/**
 * M8.2c — as mensagens do cancelamento de reserva paga pelo site: pedido recebido, decisão e devolução feita. O motor
 * manda só ligado, uma vez por referência, e acende a marca de "mensagem enviada" no cancelamento; não manda o que a
 * equipe já marcou. As mensagens prontas para copiar no painel usam o mesmo preenchimento. Dados fictícios.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lerEmpresa, salvarEmpresa } from "@/configuracoes/empresa";
import { criarModelo } from "@/configuracoes/modelos";
import { TEXTOS_BASE_CANCELAMENTO } from "@/configuracoes/modelos-texto";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { cancelamentosReserva, mensagensHospede } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { pedirCancelamentoPeloHospede } from "@/hospede/cancelamento";
import { marcarHospedeAvisado } from "@/pagamentos/cancelamento";
import { AGORA, type Cenario, cancelar, EMAIL_HOSPEDE, entradaPadrao, minutos, montarCenario, pagarEConfirmar, pedir, usuarioDeTeste } from "@/pagamentos/testes";
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
    expect(ultimas.find((m) => m.assunto.startsWith("Cancelamento decidido"))!.texto).toContain("Prazo de reembolso integral: pedidos até 28/09, às 23h59.");
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
});
