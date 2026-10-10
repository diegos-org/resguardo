/**
 * M8.2d — as mensagens da alteração de reserva paga pelo site: a proposta (enquanto as datas estão seguradas), a alteração
 * confirmada e a devolução da diferença feita (com o modelo "Devolução feita"). O motor manda só ligado, uma vez por
 * referência, acende a marca de "mensagem enviada" na alteração (pelo sistema) e não manda de novo a confirmação da
 * reserva só porque as datas mudaram. Os botões "Copiar" do painel usam o mesmo preenchimento. Dados fictícios.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lerEmpresa, salvarEmpresa } from "@/configuracoes/empresa";
import { criarModelo } from "@/configuracoes/modelos";
import { TEXTOS_BASE_ALTERACAO, TEXTOS_BASE_CANCELAMENTO } from "@/configuracoes/modelos-texto";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { alteracoesReserva, devolucoesPagamento, mensagensHospede } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CorreioMemoria } from "@/email/correio";
import { marcarHospedeAvisadoDaAlteracao } from "@/pagamentos/alteracao";
import { tentarDevolucao } from "@/pagamentos/devolucao";
import { AGORA, alteracaoGravada, alterar, type Cenario, EMAIL_HOSPEDE, liberar, minutos, montarCenario, pagarDiferenca, pagarEConfirmar, usuarioDeTeste } from "@/pagamentos/testes";
import { enviarMensagensHospede, mensagensDaAlteracao, salvarConfigMensagens } from "./hospede";

let db: Db, close: () => Promise<void>, c: Cenario, correio: CorreioMemoria, equipe: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  correio = new CorreioMemoria();
  equipe = await usuarioDeTeste(c);
  await salvarEmpresa(db, c.org, { ...(await lerEmpresa(db, c.org)), nome: "Sua Casa Exemplo", site: "https://www.exemplo.com.br/" }, null);
});

const SITE = "https://www.exemplo.com.br";
const tiposEnviados = async (reservaId: string) => (await db.select().from(mensagensHospede).where(eq(mensagensHospede.reservaId, reservaId))).map((m) => m.tipo).sort();

/** Os modelos (o texto-base de cada um) e o envio ligado para reservas do site desde `quando`. */
async function ligar(quando: Date = AGORA) {
  const criar = async (nome: string, texto: string) => {
    const r = await criarModelo(db, c.org, { nome, quando: "", texto }, null);
    if (!r.ok || !r.modelo) throw new Error(JSON.stringify(r));
    return r.modelo.id;
  };
  const modelos = {
    confirmacao: await criar("Confirmação da reserva", "Olá, {hospede}! A reserva {codigo} está confirmada: {checkin} a {checkout}."),
    alteracao_proposta: await criar("Alteração: proposta", TEXTOS_BASE_ALTERACAO.alteracao_proposta),
    alteracao_confirmada: await criar("Alteração confirmada", TEXTOS_BASE_ALTERACAO.alteracao_confirmada),
    devolucao_concluida: await criar("Devolução feita", TEXTOS_BASE_CANCELAMENTO.devolucao_concluida),
  };
  expect(await salvarConfigMensagens(db, c.org, { ativo: true, origens: ["site"], modelos }, null, quando)).toEqual({ ok: true });
}

describe("mensagens da alteração pelo motor (M8.2d)", () => {
  it("aumento: a proposta uma vez enquanto as datas estão seguradas; depois de paga, a alteração confirmada; a confirmação da reserva não sai de novo", async () => {
    await ligar();
    const x = await pagarEConfirmar(c);
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(5))).toMatchObject({ enviadas: 1 });
    expect(await tiposEnviados(x.reservaId)).toEqual(["confirmacao"]);

    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(21))).toMatchObject({ enviadas: 1, falhas: 0, avisos: [] });
    const proposta = correio.enviadas.at(-1)!;
    expect(proposta).toMatchObject({ para: EMAIL_HOSPEDE, assunto: `Alteração: proposta — reserva ${x.reservaCodigo}` });
    expect(proposta.texto).toBe(
      `Olá, Visitante Fictício! Preparamos a alteração da sua reserva ${x.reservaCodigo}: Alteração da reserva ${x.reservaCodigo}: de 12/10–15/10 (3 noites, 4 pessoas) para 12/10–16/10 (4 noites, 4 pessoas). Valor: de R$ 1.824,00 para R$ 2.352,00 — diferença de R$ 528,00. Datas seguradas até 13:20 (horário de Brasília). ${TEXTOS_SITE_INICIAIS.alteracaoEmAndamento} Versão 1 da Política de cancelamento, aceita no pagamento da reserva; prazos contados da entrada de 12/10. ${TEXTOS_SITE_INICIAIS.alteracaoPolitica} Veja os detalhes em ${SITE}/reservar/${x.codigo}. Até a confirmação, a reserva continua como está.`,
    );
    expect(proposta.texto).not.toContain("Beds24");
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ hospedeAvisadoPropostaEm: minutos(21), hospedeAvisadoPropostaPor: null });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(22))).toMatchObject({ enviadas: 0 });

    await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25) });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(30))).toMatchObject({ enviadas: 1, avisos: [] });
    expect(correio.enviadas.at(-1)!.texto).toBe(
      `Olá, Visitante Fictício! A alteração da sua reserva ${x.reservaCodigo} está confirmada: Alteração confirmada em 01/10: 12/10–16/10, 4 pessoas, R$ 2.352,00. ${TEXTOS_SITE_INICIAIS.alteracaoConfirmada} Versão 1 da Política de cancelamento, aceita no pagamento da reserva; prazos contados da entrada de 12/10. ${TEXTOS_SITE_INICIAIS.alteracaoPolitica} Acompanhe em ${SITE}/reservar/${x.codigo}. Qualquer dúvida, é só responder esta mensagem.`,
    );
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ hospedeAvisadoConfirmacaoEm: minutos(30) });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(31))).toMatchObject({ enviadas: 0 });
    expect(await tiposEnviados(x.reservaId)).toEqual(["alteracao_confirmada", "alteracao_proposta", "confirmacao"]);
  });

  it("redução integral: a devolução feita da diferença sai com o modelo 'Devolução feita', uma vez, depois de confirmada", async () => {
    await ligar();
    const x = await pagarEConfirmar(c);
    await enviarMensagensHospede(db, c.org, correio, minutos(5));
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-14" }, minutos(20), { autorId: equipe, aplicar: true });
    if (!resultado.ok) throw new Error(resultado.erro);
    // Aplicada: a alteração confirmada sai; a devolução espera a liberação (nada a avisar sobre ela ainda).
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(21))).toMatchObject({ enviadas: 1 });
    expect(correio.enviadas.at(-1)!.texto).toContain(`Devolução da diferença: R$ 528,00. ${TEXTOS_SITE_INICIAIS.devolucaoAguardaLiberacao}`);
    await liberar(c, x.pagamentoId, { quando: minutos(40) });
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.alteracaoId, resultado.alteracaoId));
    expect(await tentarDevolucao(db, c.org, d.id, c.provedor, minutos(41))).toBe("confirmada");
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(42))).toMatchObject({ enviadas: 1, avisos: [] });
    expect(correio.enviadas.at(-1)!.texto).toBe(`Olá, Visitante Fictício! A devolução de R$ 528,00 da reserva ${x.reservaCodigo} foi feita em 01/10/2026. ${TEXTOS_SITE_INICIAIS.cancelamentoVoltaPix}`);
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ hospedeAvisadoDevolucaoEm: minutos(42), hospedeAvisadoDevolucaoPor: null });
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(43))).toMatchObject({ enviadas: 0 });
  });

  it("o que a equipe marcou como enviado não sai pelo motor; a marca vale uma vez e só no momento certo", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    expect(await marcarHospedeAvisadoDaAlteracao(db, c.org, resultado.alteracaoId, "confirmacao", equipe, minutos(21))).toMatchObject({ ok: false, erro: "A alteração ainda não foi aplicada." });
    expect(await marcarHospedeAvisadoDaAlteracao(db, c.org, resultado.alteracaoId, "proposta", equipe, minutos(21))).toEqual({ ok: true });
    expect(await marcarHospedeAvisadoDaAlteracao(db, c.org, resultado.alteracaoId, "proposta", equipe, minutos(22))).toMatchObject({ ok: false });
    await ligar(minutos(10));
    expect(await enviarMensagensHospede(db, c.org, correio, minutos(23))).toMatchObject({ enviadas: 0 });
    expect(await tiposEnviados(x.reservaId)).toEqual([]);
    const [a] = await db.select().from(alteracoesReserva).where(eq(alteracoesReserva.id, resultado.alteracaoId));
    expect(a).toMatchObject({ hospedeAvisadoPropostaPor: equipe });
  });
});

describe("revisão do M8.2d: o modelo 'Devolução feita' com o momento do pedido", () => {
  it("{recebido} (que vale no cancelamento) também se preenche na devolução da diferença: o pedido da alteração; a mensagem sai e o botão copia", async () => {
    const r = await criarModelo(db, c.org, { nome: "Devolução feita com o pedido", quando: "", texto: "Olá, {hospede}! Sobre o seu pedido de {recebido}: a devolução de {valor} foi feita em {data}." }, null);
    if (!r.ok || !r.modelo) throw new Error(JSON.stringify(r));
    expect(await salvarConfigMensagens(db, c.org, { ativo: true, origens: ["site"], modelos: { devolucao_concluida: r.modelo.id } }, null, AGORA)).toEqual({ ok: true });
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-14" }, minutos(20), { autorId: equipe, aplicar: true });
    if (!resultado.ok) throw new Error(resultado.erro);
    await liberar(c, x.pagamentoId, { quando: minutos(40) });
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.alteracaoId, resultado.alteracaoId));
    expect(await tentarDevolucao(db, c.org, d.id, c.provedor, minutos(41))).toBe("confirmada");
    const esperado = "Olá, Visitante Fictício! Sobre o seu pedido de 01/10/2026 às 12:20: a devolução de R$ 528,00 foi feita em 01/10/2026.";
    const m = await mensagensDaAlteracao(db, c.org, resultado.alteracaoId, minutos(42));
    expect(m.devolvida).toMatchObject({ texto: esperado, falta: [], textoBase: false });
    const res = await enviarMensagensHospede(db, c.org, correio, minutos(42));
    expect(res.avisos).toEqual([]);
    expect(correio.enviadas.at(-1)!.texto).toBe(esperado);
  });
});

describe("mensagens da alteração prontas para copiar (painel)", () => {
  it("sem modelo, o texto-base; a proposta só enquanto segurada; a confirmação depois de aplicada; de outra empresa, nada", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const m = await mensagensDaAlteracao(db, c.org, resultado.alteracaoId, minutos(21));
    expect(m.proposta).toMatchObject({ textoBase: true, falta: [] });
    expect(m.proposta?.texto).toContain(`Preparamos a alteração da sua reserva ${x.reservaCodigo}`);
    expect(m.proposta?.texto).toContain(`${SITE}/reservar/${x.codigo}`);
    expect(m.confirmada).toBeNull();
    expect(m.devolvida).toBeNull();
    await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25) });
    const depois = await mensagensDaAlteracao(db, c.org, resultado.alteracaoId, minutos(30));
    expect(depois.proposta).toBeNull();
    expect(depois.confirmada?.texto).toContain("Alteração confirmada em 01/10");
    const outra = await montarCenario(db);
    expect(await mensagensDaAlteracao(db, outra.org, resultado.alteracaoId, minutos(30))).toEqual({ proposta: null, confirmada: null, devolvida: null });
  });
});
