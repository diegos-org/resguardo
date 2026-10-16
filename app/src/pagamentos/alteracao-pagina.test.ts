/**
 * M8.2d — a alteração do lado do hóspede e do pagamento da diferença: a página da reserva (a alteração segurada com a
 * diferença a pagar, a aplicada com a devolução, a retida), o Pix e o cartão da diferença (o alvo da cobrança: valor,
 * limites, "já pago" e a alteração que mudou; o aceite na política da reserva), as tentativas irmãs que não se cancelam,
 * o bloqueio manual que vence antes a alteração e os avisos do Início. Dados fictícios; nada de rede.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { lerRegrasCalendario, salvarRegrasCalendario } from "@/calendario/regras-config";
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import { PAGINAS_LEGAIS } from "@/configuracoes/paginas-legais-texto";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { aceitesSite, alteracoesReserva, auditoria, contratos, devolucoesPagamento, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { listarImoveis } from "@/imoveis/repositorio";
import { avisosDeAlteracao, carregarDashboard } from "@/painel/dashboard";
import { criarBloqueio } from "@/reservas/bloqueios";
import { vistaDoPagamento } from "@/site/pagamento";
import { textoDaAlteracao } from "@/site/pagamento-vista";
import { desistirDaAlteracao } from "./alteracao";
import { pagarComCartao } from "./cartao";
import { conferirTentativa } from "./conferencia";
import { pedirRestanteDaDevolucao } from "./devolucao";
import { listarPagamentos } from "./consultas";
import { ofertaDeCartao, ofertaDePix, type PortaoCobranca, TEXTO_SEM_COBRANCA, TEXTO_SEM_PIX } from "./oferta";
import { gerarPix } from "./pix";
import { ErroProvedor } from "./provedor";
import { alteracaoGravada, alterar, aumentarDeTeste, CARTAO_FICTICIO, type Cenario, envelhecer, minutos, montarCenario, pagarDiferenca, pagarEConfirmar, reduzirDeTeste, semDadosDoHospede, TOTAL, usuarioDeTeste } from "./testes";

let db: Db, close: () => Promise<void>, c: Cenario, equipe: string;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  equipe = await usuarioDeTeste(c);
});

const pagina = (cotacaoId: string, quando: Date) => vistaDoPagamento(db, c.org, cotacaoId, quando, { comAutorizacao: true, gate: async () => c.gate });
const texto = (a: Parameters<typeof textoDaAlteracao>[0], codigo: string) => textoDaAlteracao(a, TEXTOS_SITE_INICIAIS, codigo);
/** Uma tentativa encerrada (cancelada) direto no banco: conta nos limites do alvo dela. */
const tentativaEncerrada = (x: { cotacaoId: string; reservaId: string }, alteracaoId: string | null, forma: "pix" | "cartao" = "pix") => {
  const id = randomUUID();
  return db.insert(pagamentos).values({ id, organizacaoId: c.org, cotacaoId: x.cotacaoId, reservaId: x.reservaId, imovelId: c.imovel, ambiente: "teste", forma, referencia: `scl-teste-${id}`, chaveIdempotencia: `chave-${id}`, situacao: "cancelado", valor: 100, alteracaoId, criadoEm: minutos(21), atualizadoEm: minutos(21) });
};
/** Publica uma versão nova de uma página legal (a 2), igual à 1 (o texto não importa aqui). */
async function publicarVersao2(doc: "termos" | "cancelamento") {
  const chave = PAGINAS_LEGAIS[doc].chave;
  const atual = (await lerConfig(db, c.org, chave)) as { versoes: { numero: number; data: string }[] };
  await gravarConfig(db, c.org, chave, { versoes: [...atual.versoes, { ...atual.versoes[0], numero: 2, data: "2026-10-01" }] }, null, false);
}

describe("a página da reserva mostra a alteração", () => {
  it("segurada com a diferença a pagar: Pix e cartão da diferença oferecidos; depois de paga, a alteração confirmada; sem Beds24 nem dado pessoal", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const v = await pagina(x.cotacaoId, minutos(21));
    expect(v?.alteracao).toMatchObject({ id: resultado.alteracaoId, situacao: "segurada", rumo: "aumento", diferenca: 52800, valorNovo: 235200, holdAte: minutos(80).toISOString() });
    expect(v?.alteracao?.pagamento).toMatchObject({ podeGerar: true, podePagarCartao: true, cartao: { valor: 52800 } });
    const t = texto(v!.alteracao!, x.reservaCodigo);
    expect(t.linhas[0]).toBe(
      `Alteração da reserva ${x.reservaCodigo}: de 12/10–15/10 (3 noites, 4 pessoas) para 12/10–16/10 (4 noites, 4 pessoas). Valor: de R$ 1.824,00 para R$ 2.352,00 — diferença de R$ 528,00. Datas seguradas até 13:20 (horário de Brasília). ${TEXTOS_SITE_INICIAIS.alteracaoEmAndamento}`,
    );
    expect(t.resumo).toContain("Versão 1 da Política de cancelamento, aceita no pagamento da reserva");
    expect(t.resumo).not.toMatch(/Beds24|visitante@example\.com|99999/);
    // O pagamento da reserva continua o mesmo (a diferença tem a vista própria). Segurada, a reserva ainda não mudou.
    expect(v?.estado).toBe((await pagina(x.cotacaoId, minutos(21)))?.estado);
    expect(v?.reservaAtual).toBeUndefined();

    await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25) });
    const depois = await pagina(x.cotacaoId, minutos(30));
    expect(depois?.alteracao).toMatchObject({ situacao: "aplicada", pagamento: null, devolucao: null });
    expect(texto(depois!.alteracao!, x.reservaCodigo).linhas[0]).toBe(`Alteração confirmada em 01/10: 12/10–16/10, 4 pessoas, R$ 2.352,00. ${TEXTOS_SITE_INICIAIS.alteracaoConfirmada}`);
    // A reserva como está agora (o resumo da página é o da cotação original), também depois que a alteração sai do quadro.
    expect(depois?.reservaAtual).toEqual({ checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, valor: 235200 });
    const muitoDepois = await pagina(x.cotacaoId, minutos(60 * 24 * 40));
    expect(muitoDepois?.alteracao ?? null).toBeNull();
    expect(muitoDepois?.reservaAtual).toEqual({ checkin: "2026-10-12", checkout: "2026-10-16", hospedes: 4, valor: 235200 });
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("redução integral esperando a liberação: 'aguardando' (nunca 'pedimos'); retida: a diferença não é devolvida", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-14" }, minutos(20), { autorId: equipe, aplicar: true });
    if (!resultado.ok) throw new Error(resultado.erro);
    const v = await pagina(x.cotacaoId, minutos(21));
    expect(v?.alteracao).toMatchObject({ situacao: "aplicada", rumo: "reducao", reducao: { direito: "integral", base: "arrependimento" }, devolucao: { estado: "aguardando_liberacao", valor: 52800 } });
    const t = texto(v!.alteracao!, x.reservaCodigo);
    expect(t.resumo).toContain(`Devolução da diferença: R$ 528,00. ${TEXTOS_SITE_INICIAIS.devolucaoAguardaLiberacao}`);
    expect(t.resumo).not.toContain(TEXTOS_SITE_INICIAIS.cancelamentoDevolucaoPedida);

    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    const valor = { origem: "digitado" as const, valor: TOTAL - 20_000, motivo: "acordo_com_hospede" as const, nota: "Saída um dia antes" };
    const tarde = new Date("2026-10-10T14:00:00Z");
    const retida = await alterar(c, y.reservaId, { checkout: "2026-10-22", recebidoEm: tarde, valor }, tarde, { autorId: equipe, aplicar: true });
    expect(retida.resultado).toMatchObject({ ok: true, situacao: "aplicada" });
    const vr = await pagina(y.cotacaoId, new Date(tarde.getTime() + 60_000));
    expect(vr?.alteracao).toMatchObject({ situacao: "aplicada", reducao: { direito: "nenhum" }, devolucao: null, valorNovo: TOTAL });
    expect(texto(vr!.alteracao!, y.reservaCodigo).resumo).toContain(`Pela política, a diferença de R$ 200,00 não é devolvida (o pedido chegou depois de 06/10, 23:59, contando da entrada de 20/10). ${TEXTOS_SITE_INICIAIS.alteracaoSemDevolucao}`);
  });

  it("a que não vale mais (a equipe desistiu): por 7 dias", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    expect(await desistirDaAlteracao(db, c.org, resultado.alteracaoId, "O hóspede desistiu", equipe, c.provedor, minutos(22))).toEqual({ ok: true });
    const v = await pagina(x.cotacaoId, minutos(23));
    expect(v?.alteracao).toMatchObject({ situacao: "nao_vale" });
    // A linha da política vale sempre (§8.2).
    expect(texto(v!.alteracao!, x.reservaCodigo).resumo).toBe(
      `A alteração preparada em 01/10 não vale mais. ${TEXTOS_SITE_INICIAIS.alteracaoNaoVale} Versão 1 da Política de cancelamento, aceita no pagamento da reserva; prazos contados da entrada de 12/10. ${TEXTOS_SITE_INICIAIS.alteracaoPolitica}`,
    );
    expect((await pagina(x.cotacaoId, new Date(minutos(23).getTime() + 8 * 86_400_000)))?.alteracao ?? null).toBeNull();
  });
});

describe("a página da reserva: os outros estados da alteração (M8.2d §8)", () => {
  const politica = `Versão 1 da Política de cancelamento, aceita no pagamento da reserva; prazos contados da entrada de 12/10. ${TEXTOS_SITE_INICIAIS.alteracaoPolitica}`;
  const menos200 = { origem: "digitado" as const, valor: TOTAL - 20_000, motivo: "acordo_com_hospede" as const, nota: "Saída um dia antes" };

  it("segurada numa redução e no mesmo valor: o hóspede confirma respondendo à mensagem (sem pagamento); a redução diz se a diferença volta", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-14", valor: menos200 }, minutos(20), { autorId: equipe });
    expect(resultado).toMatchObject({ ok: true, situacao: "segurada" });
    const v = await pagina(x.cotacaoId, minutos(21));
    expect(v?.alteracao).toMatchObject({ situacao: "segurada", rumo: "reducao", pagamento: null, reducao: { direito: "integral", base: "arrependimento" } });
    expect(texto(v!.alteracao!, x.reservaCodigo).linhas).toEqual([
      `Alteração da reserva ${x.reservaCodigo}: de 12/10–15/10 (3 noites, 4 pessoas) para 12/10–14/10 (2 noites, 4 pessoas). Valor: de R$ 1.824,00 para R$ 1.624,00 — diferença de R$ 200,00. Datas seguradas até 13:20 (horário de Brasília). ${TEXTOS_SITE_INICIAIS.alteracaoAguardaConfirmacao}`,
      "Pela política, a diferença de R$ 200,00 é devolvida (direito de arrependimento: até 08/10, 7 dias depois do pagamento).",
      politica,
    ]);
    // Entrada (05/10) antes dos 7 dias do pagamento (08/10), com a política parando na entrada: o direito acaba nela.
    const z = await pagarEConfirmar(c, { entrada: "2026-10-05", saida: "2026-10-08", email: "z@example.com" });
    expect((await alterar(c, z.reservaId, { checkout: "2026-10-07", valor: menos200 }, minutos(20), { autorId: equipe })).resultado).toMatchObject({ ok: true, situacao: "segurada" });
    const vz = await pagina(z.cotacaoId, minutos(21));
    expect(vz?.alteracao?.reducao).toMatchObject({ direito: "integral", base: "arrependimento" });
    expect(texto(vz!.alteracao!, z.reservaCodigo).linhas[1]).toMatch(/^Pela política, a diferença de R\$ [\d.,]+ é devolvida \(direito de arrependimento: até a entrada, em 05\/10\)\.$/);
    // A alteração adianta a entrada (09/10) para antes dos 7 dias (03/10): o texto conta da entrada alterada, a que vale
    // daqui em diante (a decisão continua contando da estadia de quando o pedido chegou).
    const w = await pagarEConfirmar(c, { entrada: "2026-10-09", saida: "2026-10-12", email: "w@example.com" });
    expect((await alterar(c, w.reservaId, { checkin: "2026-10-03", checkout: "2026-10-05", valor: menos200 }, minutos(20), { autorId: equipe })).resultado).toMatchObject({ ok: true, situacao: "segurada" });
    const vw = await pagina(w.cotacaoId, minutos(21));
    expect(vw?.alteracao?.reducao).toMatchObject({ direito: "integral", base: "arrependimento", entradaDaEstadia: "2026-10-03" });
    expect(texto(vw!.alteracao!, w.reservaCodigo).linhas[1]).toMatch(/^Pela política, a diferença de R\$ [\d.,]+ é devolvida \(direito de arrependimento: até a entrada, em 03\/10\)\.$/);
    // Mesmo valor (outra reserva: só as datas mudam).
    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com" });
    const mantido = { origem: "mantido" as const, motivo: "acordo_com_hospede" as const, nota: "Mesmas noites em outra semana" };
    expect((await alterar(c, y.reservaId, { checkin: "2026-10-24", checkout: "2026-10-27", valor: mantido }, minutos(20), { autorId: equipe })).resultado).toMatchObject({ ok: true, situacao: "segurada" });
    const vy = await pagina(y.cotacaoId, minutos(21));
    expect(vy?.alteracao).toMatchObject({ situacao: "segurada", rumo: "igual", pagamento: null });
    expect(texto(vy!.alteracao!, y.reservaCodigo).linhas[0]).toBe(
      `Alteração da reserva ${y.reservaCodigo}: de 20/10–23/10 (3 noites, 4 pessoas) para 24/10–27/10 (3 noites, 4 pessoas). Valor: o mesmo (R$ 1.824,00). Datas seguradas até 13:20 (horário de Brasília). ${TEXTOS_SITE_INICIAIS.alteracaoAguardaConfirmacao}`,
    );
  });

  it("não aplicada: a diferença paga depois de a equipe desistir — recebemos o pagamento e vamos devolver; com a linha da política", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const pix = await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25), aprovar: false });
    c.provedor.aprovar(pix.idProvedor, { taxa: 528 });
    expect(await desistirDaAlteracao(db, c.org, resultado.alteracaoId, "O hóspede desistiu", equipe, c.provedor, minutos(30))).toEqual({ ok: true });
    await conferirTentativa(db, c.org, pix.pagamentoId, c.provedor, minutos(31), { origem: "rotina", forcar: true });
    expect(await c.tentativa(pix.pagamentoId)).toMatchObject({ desfecho: null, motivoSemReserva: "alteracao_desistida" });
    const v = await pagina(x.cotacaoId, minutos(32));
    expect(v?.alteracao).toMatchObject({ situacao: "nao_aplicada", pagoSemAlteracao: { valor: 52800 } });
    expect(texto(v!.alteracao!, x.reservaCodigo).linhas).toEqual([`Recebemos o pagamento da diferença (R$ 528,00) em 01/10. ${TEXTOS_SITE_INICIAIS.alteracaoNaoAplicada}`, politica]);
    expect(texto(v!.alteracao!, x.reservaCodigo).resumo).not.toMatch(/Beds24|visitante@example\.com|99999/);
  });

  it("aplicada com a devolução pedida (enviada, esperando o Mercado Pago), com a equipe (Pix com mais de 78 dias: nada pedido) e em conferência (devolvida a menor)", async () => {
    const casos = [
      { email: "pedida@example.com", entrada: "2026-10-12", preparar: async () => void (c.provedor.respostaDevolucao = "pedida"), estado: "pedida", linha: `Devolução da diferença: R$ 200,00. ${TEXTOS_SITE_INICIAIS.cancelamentoDevolucaoPedida}` },
      {
        email: "equipe@example.com",
        entrada: "2026-11-20",
        preparar: (x: { pagamentoId: string }) => envelhecer(c, x.pagamentoId, 80),
        estado: "com_a_equipe",
        linha: `Devolução da diferença: R$ 200,00. A devolução pelo Mercado Pago não foi possível. ${TEXTOS_SITE_INICIAIS.cancelamentoComAEquipe}`,
      },
      { email: "menor@example.com", entrada: "2026-11-02", preparar: async () => c.provedor.devolverAMenos(15_000), estado: "em_conferencia", linha: `Devolução da diferença: R$ 200,00. ${TEXTOS_SITE_INICIAIS.cancelamentoEmConferencia}` },
    ] as const;
    for (const caso of casos) {
      c.provedor.respostaDevolucao = "confirmada";
      const saida = new Date(Date.parse(`${caso.entrada}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
      const antesDaSaida = new Date(Date.parse(`${caso.entrada}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
      const x = await pagarEConfirmar(c, { entrada: caso.entrada, saida, email: caso.email, liberar: true });
      await caso.preparar(x);
      const { resultado } = await alterar(c, x.reservaId, { checkout: antesDaSaida, valor: menos200 }, minutos(20), { autorId: equipe, aplicar: true });
      expect(resultado).toMatchObject({ ok: true, situacao: "aplicada" });
      const v = await pagina(x.cotacaoId, minutos(25));
      expect(v?.alteracao).toMatchObject({ situacao: "aplicada", rumo: "reducao", devolucao: { estado: caso.estado, valor: 20_000 } });
      const t = texto(v!.alteracao!, x.reservaCodigo);
      expect(t.linhas).toContain(caso.linha);
      expect(t.linhas.at(-1)).toBe(`Versão 1 da Política de cancelamento, aceita no pagamento da reserva; prazos contados da entrada de ${caso.entrada.slice(8, 10)}/${caso.entrada.slice(5, 7)}. ${TEXTOS_SITE_INICIAIS.alteracaoPolitica}`);
      // Nunca "já pedimos" fora da pedida.
      if (caso.estado !== "pedida") expect(t.resumo).not.toContain(TEXTOS_SITE_INICIAIS.cancelamentoDevolucaoPedida);
    }
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("devolvida a menos e o restante pedido: o valor da devolução da diferença é o da alteração (o restante não soma de novo)", async () => {
    const x = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05", email: "restante@example.com", liberar: true });
    c.provedor.devolverAMenos(15_000);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-11-04", valor: menos200 }, minutos(20), { autorId: equipe, aplicar: true });
    expect(resultado).toMatchObject({ ok: true, situacao: "aplicada" });
    const [d] = await db.select().from(devolucoesPagamento).where(eq(devolucoesPagamento.pagamentoId, x.pagamentoId));
    expect(d).toMatchObject({ situacao: "confirmada", valor: 20_000, valorConfirmado: 15_000 });
    c.provedor.respostaDevolucao = "pedida";
    expect(await pedirRestanteDaDevolucao(db, c.org, d.id, equipe, c.provedor, minutos(30))).toMatchObject({ ok: true });
    const v = await pagina(x.cotacaoId, minutos(31));
    expect(v?.alteracao?.devolucao).toMatchObject({ estado: "pedida", valor: 20_000 });
    expect(texto(v!.alteracao!, x.reservaCodigo).resumo).not.toContain("R$ 250,00");
  });

  it("aplicada depois de adiantar a estadia: a linha da política conta da entrada nova (a menor), a decisão, da de então", async () => {
    const x = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23" });
    const mantido = { origem: "mantido" as const, motivo: "acordo_com_hospede" as const, nota: "Adiantou a viagem" };
    expect((await alterar(c, x.reservaId, { checkin: "2026-10-12", checkout: "2026-10-15", valor: mantido }, minutos(20), { autorId: equipe, aplicar: true })).resultado).toMatchObject({ ok: true, situacao: "aplicada" });
    const v = await pagina(x.cotacaoId, minutos(25));
    expect(v?.alteracao).toMatchObject({ situacao: "aplicada", entradaDaPolitica: "2026-11-20", entradaDosPrazos: "2026-10-12" });
    expect(texto(v!.alteracao!, x.reservaCodigo).linhas.at(-1)).toBe(`Versão 1 da Política de cancelamento, aceita no pagamento da reserva; prazos contados da entrada de 12/10. ${TEXTOS_SITE_INICIAIS.alteracaoPolitica}`);
  });
});

describe("revisão do M8.2d: o que a página da reserva diz da alteração", () => {
  const menos200 = { origem: "digitado" as const, valor: TOTAL - 20_000, motivo: "acordo_com_hospede" as const, nota: "Saída um dia antes" };
  const tarde = new Date("2026-10-09T13:00:00Z");

  it("cartão com mais de 78 dias: a devolução da diferença é o estorno que a equipe faz no painel do Mercado Pago — nunca 'já pedimos'", async () => {
    const x = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23", forma: "cartao", liberar: true });
    await envelhecer(c, x.pagamentoId, 80);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-11-22", valor: menos200 }, minutos(20), { autorId: equipe, aplicar: true });
    expect(resultado).toMatchObject({ ok: true, situacao: "aplicada", devolucoes: ["recusada"] });
    const v = await pagina(x.cotacaoId, minutos(25));
    expect(v?.alteracao).toMatchObject({ situacao: "aplicada", devolucao: { estado: "pedida", estornoPelaEquipe: true, forma: "cartao" } });
    const t = texto(v!.alteracao!, x.reservaCodigo);
    expect(t.linhas).toContain(`Devolução da diferença: R$ 200,00. ${TEXTOS_SITE_INICIAIS.cancelamentoEstornoNoCartao}`);
    expect(t.resumo).not.toContain(TEXTOS_SITE_INICIAIS.cancelamentoDevolucaoPedida);
  });

  it("a devolução que a fase 2 não pediu (sem provedor) num pagamento ainda não liberado: esperando a liberação — nunca 'já pedimos'", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-14", valor: menos200 }, minutos(20), { autorId: equipe, aplicar: true, provedor: null });
    expect(resultado).toMatchObject({ ok: true, situacao: "aplicada", devolucoes: ["pedida"] });
    const v = await pagina(x.cotacaoId, minutos(25));
    expect(v?.alteracao).toMatchObject({ devolucao: { estado: "aguardando_liberacao", valor: 20_000 } });
    const t = texto(v!.alteracao!, x.reservaCodigo);
    expect(t.resumo).toContain(`Devolução da diferença: R$ 200,00. ${TEXTOS_SITE_INICIAIS.devolucaoAguardaLiberacao}`);
    expect(t.resumo).not.toContain(TEXTOS_SITE_INICIAIS.cancelamentoDevolucaoPedida);
  });

  it("o prazo das datas que acaba noutro dia (até 48 horas): 'até dd/mm às HH:MM'", async () => {
    const regras = await lerRegrasCalendario(db, c.org);
    expect(await salvarRegrasCalendario(db, c.org, { ...regras, site: { ...regras.site, minutosHoldAlteracao: 1440 } }, null)).toBe(true);
    const x = await pagarEConfirmar(c);
    expect((await alterar(c, x.reservaId, { checkout: "2026-10-14", valor: menos200 }, minutos(20), { autorId: equipe })).resultado).toMatchObject({ ok: true, situacao: "segurada" });
    const v = await pagina(x.cotacaoId, minutos(21));
    expect(texto(v!.alteracao!, x.reservaCodigo).linhas[0]).toContain("Datas seguradas até 02/10 às 12:20 (horário de Brasília).");
  });

  it("a decisão da equipe (exceção) e o pagamento sem política aceita: nunca 'pela política', nem 'a política que você aceitou'", async () => {
    const x = await pagarEConfirmar(c);
    const excecao = { decisao: "excecao" as const, motivoExcecao: "cortesia_comercial" as const, motivoDecisao: "Cliente antigo" };
    expect((await alterar(c, x.reservaId, { checkout: "2026-10-14", valor: menos200, recebidoEm: tarde, ...excecao }, tarde, { autorId: equipe })).resultado).toMatchObject({ ok: true, situacao: "segurada" });
    const v = await pagina(x.cotacaoId, new Date(tarde.getTime() + 60_000));
    expect(v?.alteracao).toMatchObject({ reducao: { direito: "integral", base: "excecao" } });
    const t = texto(v!.alteracao!, x.reservaCodigo);
    expect(t.linhas).toContain("Por decisão da nossa equipe, a diferença de R$ 200,00 é devolvida.");
    expect(t.resumo).not.toContain("Pela política");

    const y = await pagarEConfirmar(c, { entrada: "2026-10-20", saida: "2026-10-23", email: "y@example.com", semAceite: true });
    const semPolitica = { decisao: "nenhum" as const, motivoDecisao: "Combinado com o hóspede" };
    expect((await alterar(c, y.reservaId, { checkout: "2026-10-22", valor: menos200, ...semPolitica }, minutos(20), { autorId: equipe })).resultado).toMatchObject({ ok: true, situacao: "segurada" });
    const vy = await pagina(y.cotacaoId, minutos(21));
    expect(vy?.alteracao).toMatchObject({ politicaVersao: null, reducao: { direito: "nenhum", base: "sem_politica" } });
    const ty = texto(vy!.alteracao!, y.reservaCodigo);
    expect(ty.linhas).toContain("Por decisão da nossa equipe, a diferença de R$ 200,00 não é devolvida.");
    expect(ty.resumo).not.toContain("Pela política");
    expect(ty.resumo).not.toContain(TEXTOS_SITE_INICIAIS.alteracaoPolitica);
  });
});

describe("revisão do M8.2d: como volta a devolução da diferença com partes por caminhos diferentes", () => {
  it("reserva no Pix e aumento no cartão, depois a redução devolvida dos dois: as frases dos dois meios; uma parte por fora: a do cartão e a da transferência", async () => {
    const x = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23", email: "meios@example.com", liberar: true });
    const inc = await aumentarDeTeste(c, x, TOTAL + 40_000, { quando: minutos(15) });
    await db.update(pagamentos).set({ forma: "cartao" }).where(eq(pagamentos.id, inc.pagamentoId));
    // A redução de R$ 500,00: R$ 400,00 do cartão (a diferença) e R$ 100,00 do Pix (a reserva).
    const red = await reduzirDeTeste(c, x, TOTAL - 10_000, { quando: minutos(20), devolucoes: [{ pagamentoId: inc.pagamentoId, valor: 40_000 }, { pagamentoId: x.pagamentoId, valor: 10_000 }] });
    const [doCartao, doPix] = red.devolucaoIds;
    const confirmar = (id: string, valor: number) => db.update(devolucoesPagamento).set({ situacao: "confirmada", valorConfirmado: valor, confirmadaEm: minutos(30), confirmadaPor: "leitura" }).where(eq(devolucoesPagamento.id, id));
    await confirmar(doCartao, 40_000);
    await confirmar(doPix, 10_000);
    let v = await pagina(x.cotacaoId, minutos(31));
    expect(v?.alteracao).toMatchObject({ situacao: "aplicada", rumo: "reducao", devolucao: { estado: "feita", valor: 50_000, forma: null, porFora: false, algumaPorFora: false } });
    let t = texto(v!.alteracao!, x.reservaCodigo);
    expect(t.linhas).toContain(`${TEXTOS_SITE_INICIAIS.cancelamentoVoltaPix} ${TEXTOS_SITE_INICIAIS.cancelamentoVoltaCartao}`);
    // A parte do Pix devolvida por fora (transferência da empresa): a do cartão continua pelo Mercado Pago.
    await db.update(devolucoesPagamento).set({ situacao: "por_fora", porForaData: "2026-10-01", porForaValor: 10_000, valorConfirmado: null, confirmadaEm: null, confirmadaPor: null }).where(eq(devolucoesPagamento.id, doPix));
    v = await pagina(x.cotacaoId, minutos(32));
    expect(v?.alteracao?.devolucao).toMatchObject({ estado: "feita", forma: "cartao", porFora: false, algumaPorFora: true });
    t = texto(v!.alteracao!, x.reservaCodigo);
    expect(t.linhas).toContain(`${TEXTOS_SITE_INICIAIS.cancelamentoVoltaCartao} ${TEXTOS_SITE_INICIAIS.cancelamentoVoltaPorFora}`);
    expect(t.linhas.join(" ")).not.toContain(TEXTOS_SITE_INICIAIS.cancelamentoVoltaPix);
    // As duas por fora: só a transferência.
    await db.update(devolucoesPagamento).set({ situacao: "por_fora", porForaData: "2026-10-01", porForaValor: 40_000, valorConfirmado: null, confirmadaEm: null, confirmadaPor: null }).where(eq(devolucoesPagamento.id, doCartao));
    v = await pagina(x.cotacaoId, minutos(33));
    expect(v?.alteracao?.devolucao).toMatchObject({ porFora: true, algumaPorFora: true });
    t = texto(v!.alteracao!, x.reservaCodigo);
    expect(t.linhas).toContain(TEXTOS_SITE_INICIAIS.cancelamentoVoltaPorFora);
    for (const meio of [TEXTOS_SITE_INICIAIS.cancelamentoVoltaPix, TEXTOS_SITE_INICIAIS.cancelamentoVoltaCartao]) expect(t.linhas.join(" ")).not.toContain(meio);
    expect(await semDadosDoHospede(db)).toEqual([]);
  });
});

describe("o pagamento da diferença (o alvo da cobrança)", () => {
  it("Pix: valor = diferença; os Pix da reserva não contam no limite da alteração; 3 da alteração esgotam; 'alteracao_mudou' quando ela já não vale", async () => {
    const x = await pagarEConfirmar(c);
    // Dois Pix da reserva encerrados (com o que confirmou, três): não contam para a diferença.
    await tentativaEncerrada(x, null);
    await tentativaEncerrada(x, null);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const pix = await gerarPix(db, c.org, x.cotacaoId, minutos(22), c.provedor, { alteracaoId: resultado.alteracaoId });
    expect(pix).toMatchObject({ ok: true, reaproveitado: false });
    if (!pix.ok) throw new Error();
    expect(await c.tentativa(pix.pagamentoId)).toMatchObject({ valor: 52800, alteracaoId: resultado.alteracaoId, situacao: "pendente" });
    // A descrição no Mercado Pago diz que é a diferença.
    expect(c.provedor.chamadas.find((y) => y.metodo === "criarPix")).toBeTruthy();
    // O mesmo Pix aparece de novo (válido); o do alvo da reserva não existe mais (já confirmada).
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(23), c.provedor, { alteracaoId: resultado.alteracaoId })).toEqual({ ok: true, pagamentoId: pix.pagamentoId, reaproveitado: true });
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(23), c.provedor)).toMatchObject({ ok: false });
    // Reler o pagamento que confirmou a reserva não cancela o Pix da diferença (são de alvos diferentes).
    await conferirTentativa(db, c.org, x.pagamentoId, c.provedor, minutos(24), { origem: "rotina", forcar: true });
    expect(c.provedor.chamadas.some((y) => y.metodo === "cancelar")).toBe(false);
    expect((await c.tentativa(pix.pagamentoId)).situacao).toBe("pendente");
    // Uma alteração que já não vale: a página ficou aberta.
    expect(await desistirDaAlteracao(db, c.org, resultado.alteracaoId, "Teste", equipe, c.provedor, minutos(25))).toEqual({ ok: true });
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(26), c.provedor, { alteracaoId: resultado.alteracaoId })).toMatchObject({ ok: false, codigo: "alteracao_mudou" });
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(26), c.provedor, { alteracaoId: "nao-e-um-id" })).toMatchObject({ ok: false, codigo: "alteracao_mudou" });

    // Outra alteração com três Pix já usados: esgotou.
    const b = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(30), { autorId: equipe });
    if (!b.resultado.ok) throw new Error(b.resultado.erro);
    for (let i = 0; i < 3; i++) await tentativaEncerrada(x, b.resultado.alteracaoId);
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(31), c.provedor, { alteracaoId: b.resultado.alteracaoId })).toMatchObject({ ok: false, codigo: "limite" });
  });

  it("'já pago' só pelas tentativas da alteração; uma tentativa da diferença marcada como real bloqueia toda cobrança da cotação", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    // O pagamento aprovado da reserva não é "já pago" da diferença.
    const p = await gerarPix(db, c.org, x.cotacaoId, minutos(21), c.provedor, { alteracaoId: resultado.alteracaoId });
    expect(p).toMatchObject({ ok: true });
    expect(await desistirDaAlteracao(db, c.org, resultado.alteracaoId, "Teste", equipe, c.provedor, minutos(22))).toEqual({ ok: true });
    // Outra alteração: o Mercado Pago marca o Pix da diferença como real (live_mode) no teste.
    const b = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(23), { autorId: equipe });
    if (!b.resultado.ok) throw new Error(b.resultado.erro);
    c.provedor.aoVivo = true;
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(24), c.provedor, { alteracaoId: b.resultado.alteracaoId })).toMatchObject({ ok: false, codigo: "ao_vivo" });
    c.provedor.aoVivo = false;
    // A guarda é da cotação toda: nenhum Pix nem cartão sai mais nela.
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(25), c.provedor, { alteracaoId: b.resultado.alteracaoId })).toMatchObject({ ok: false, codigo: "ao_vivo" });
    expect(await pagarComCartao(db, c.org, x.cotacaoId, minutos(25), c.provedor, CARTAO_FICTICIO, { alteracaoId: b.resultado.alteracaoId })).toMatchObject({ ok: false, codigo: "ao_vivo" });
  });

  it("cartão da diferença: valor = diferença, alvo da alteração; 'alteracao_mudou' fora dela", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    c.provedor.respostaCartao = "aprovado";
    const r = await pagarComCartao(db, c.org, x.cotacaoId, minutos(22), c.provedor, CARTAO_FICTICIO, { alteracaoId: resultado.alteracaoId });
    expect(r).toMatchObject({ ok: true });
    const [nova] = await db.select().from(pagamentos).where(and(eq(pagamentos.cotacaoId, x.cotacaoId), eq(pagamentos.forma, "cartao")));
    expect(nova).toMatchObject({ valor: 52800, alteracaoId: resultado.alteracaoId });
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ situacao: "aplicada" });
    expect(await pagarComCartao(db, c.org, x.cotacaoId, minutos(23), c.provedor, CARTAO_FICTICIO, { alteracaoId: resultado.alteracaoId })).toMatchObject({ ok: false, codigo: "alteracao_mudou" });
  });

  it("aceite: a diferença segue a política da reserva (versão 1) com os Termos e a Privacidade em vigor", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    // Termos e Política de cancelamento publicados na versão 2 depois do pagamento.
    await publicarVersao2("termos");
    await publicarVersao2("cancelamento");
    const id = resultado.alteracaoId;
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(21), c.provedor, { alteracaoId: id })).toMatchObject({ ok: false, codigo: "aceite_pendente" });
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(21), c.provedor, { alteracaoId: id, aceite: { termos: 2, privacidade: 1, cancelamento: 2 } })).toMatchObject({ ok: false, codigo: "aceite_mudou" });
    const ok = await gerarPix(db, c.org, x.cotacaoId, minutos(21), c.provedor, { alteracaoId: id, aceite: { termos: 2, privacidade: 1, cancelamento: 1 } });
    expect(ok).toMatchObject({ ok: true });
    if (!ok.ok) throw new Error();
    const p = await c.tentativa(ok.pagamentoId);
    const [aceite] = await db.select().from(aceitesSite).where(eq(aceitesSite.id, p.aceiteId!));
    expect(aceite).toMatchObject({ versaoTermos: 2, versaoPrivacidade: 1, versaoCancelamento: 1 });
  });
});

describe("o pagamento da diferença recusado (o alvo e a oferta da alteração)", () => {
  const menos = { origem: "digitado" as const, valor: TOTAL - 10_000, motivo: "cortesia_comercial" as const, nota: "Cortesia" };

  it("vencida (prazo sem carência), sem diferença a pagar (redução ou mesmo valor): Pix e cartão recusam como 'alteração mudou'", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    // O prazo (13:20) passou e nenhuma tentativa da diferença segura carência.
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(81), c.provedor, { alteracaoId: resultado.alteracaoId })).toMatchObject({ ok: false, codigo: "alteracao_mudou" });
    expect(await pagarComCartao(db, c.org, x.cotacaoId, minutos(81), c.provedor, CARTAO_FICTICIO, { alteracaoId: resultado.alteracaoId })).toMatchObject({ ok: false, codigo: "alteracao_mudou" });
    // Uma redução segurada (a diferença é a devolver, não a pagar).
    const b = await alterar(c, x.reservaId, { checkout: "2026-10-14", valor: menos }, minutos(82), { autorId: equipe });
    if (!b.resultado.ok) throw new Error(b.resultado.erro);
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(83), c.provedor, { alteracaoId: b.resultado.alteracaoId })).toMatchObject({ ok: false, codigo: "alteracao_mudou" });
    expect(await pagarComCartao(db, c.org, x.cotacaoId, minutos(83), c.provedor, CARTAO_FICTICIO, { alteracaoId: b.resultado.alteracaoId })).toMatchObject({ ok: false, codigo: "alteracao_mudou" });
    expect(await db.select().from(pagamentos).where(and(eq(pagamentos.cotacaoId, x.cotacaoId), eq(pagamentos.organizacaoId, c.org)))).toHaveLength(1);
  });

  it("o portão desligado (oferta e página) e uma pendência do motor nas novas datas (o contrato acabou durante o prazo): nada é oferecido nem gerado", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const alteracaoId = resultado.alteracaoId;
    const desligado: PortaoCobranca = { ok: false, motivo: "desligado_no_painel", texto: TEXTO_SEM_COBRANCA.desligado_no_painel };
    expect(await ofertaDePix(db, c.org, x.cotacaoId, minutos(21), desligado, { alteracaoId })).toEqual({ oferecer: false, motivo: "desligado_no_painel" });
    expect(await ofertaDeCartao(db, c.org, x.cotacaoId, minutos(21), desligado, { alteracaoId })).toEqual({ oferecer: false, motivo: "desligado_no_painel" });
    const semPortao = await vistaDoPagamento(db, c.org, x.cotacaoId, minutos(21), { comAutorizacao: true, gate: async () => desligado });
    expect(semPortao?.alteracao?.pagamento).toMatchObject({ podeGerar: false, podePagarCartao: false, cartao: null });
    // Com o portão ligado, oferecido; o contrato termina antes da entrada: a diferença não sai mais (sem contrato vigente).
    expect(await ofertaDePix(db, c.org, x.cotacaoId, minutos(21), c.gate, { alteracaoId })).toEqual({ oferecer: true });
    await db.update(contratos).set({ fim: "2026-10-01" }).where(eq(contratos.imovelId, c.imovel));
    const criacoes = () => c.provedor.chamadas.filter((ch) => ch.metodo === "criarPix" || ch.metodo === "criarCartao").length;
    const antes = criacoes();
    expect(await ofertaDePix(db, c.org, x.cotacaoId, minutos(22), c.gate, { alteracaoId })).toEqual({ oferecer: false, motivo: "sem_contrato" });
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(22), c.provedor, { alteracaoId })).toMatchObject({ ok: false, codigo: "nao_oferecido", erro: TEXTO_SEM_PIX.sem_contrato });
    expect(await pagarComCartao(db, c.org, x.cotacaoId, minutos(22), c.provedor, CARTAO_FICTICIO, { alteracaoId })).toMatchObject({ ok: false, codigo: "nao_oferecido", erro: TEXTO_SEM_PIX.sem_contrato });
    expect(criacoes()).toBe(antes);
  });

  it("o Pix da diferença que não chega ao Mercado Pago: a tentativa some e o prazo provisório da alteração volta ao que era (alvo.voltar)", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const portador = async () => (await db.select().from(reservas).where(and(eq(reservas.organizacaoId, c.org), eq(reservas.fonte, "alteracao"))))[0];
    const observacao = (await portador()).observacoes;
    c.provedor.falhas.criarPix = new ErroProvedor("indisponivel", "Não deu para falar com o Mercado Pago.");
    // Aos 70 minutos o Pix (30 min + 2) passaria do prazo (13:20): a extensão provisória é desfeita quando nada é criado.
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(70), c.provedor, { alteracaoId: resultado.alteracaoId })).toMatchObject({ ok: false, codigo: "provedor" });
    expect((await alteracaoGravada(c, resultado.alteracaoId)).holdAte).toEqual(minutos(80));
    expect((await portador()).observacoes).toBe(observacao);
    expect(await db.select().from(pagamentos).where(and(eq(pagamentos.cotacaoId, x.cotacaoId), eq(pagamentos.alteracaoId, resultado.alteracaoId)))).toEqual([]);
    const acoes = (await db.select({ acao: auditoria.acao }).from(auditoria).where(and(eq(auditoria.organizacaoId, c.org), eq(auditoria.entidadeId, resultado.alteracaoId)))).map((a) => a.acao);
    expect(acoes).toEqual(expect.arrayContaining(["alteracao.estender", "alteracao.voltar_prazo"]));
    // O Mercado Pago volta: o Pix sai e estende o prazo de verdade.
    c.provedor.falhas.criarPix = null;
    expect(await gerarPix(db, c.org, x.cotacaoId, minutos(71), c.provedor, { alteracaoId: resultado.alteracaoId })).toMatchObject({ ok: true });
    expect((await alteracaoGravada(c, resultado.alteracaoId)).holdAte!.getTime()).toBeGreaterThan(minutos(100).getTime());
  });
});

describe("o bloqueio manual e o Início", () => {
  it("criar um bloqueio vence antes as datas seguradas vencidas do imóvel", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    // O bloqueio usa o relógio de agora (bem depois do prazo de 01/10, 13:20).
    expect(await criarBloqueio(db, c.org, { imovelId: c.imovel, inicio: "2026-10-15", fim: "2026-10-16", motivo: "Manutenção" }, equipe, { semReserva: true })).toMatchObject({ ok: true });
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ situacao: "expirada" });
    expect((await db.select().from(reservas).where(and(eq(reservas.organizacaoId, c.org), eq(reservas.fonte, "alteracao"))))[0].estado).toBe("cancelada");
  });

  it("operação: a alteração segurada (sem valores, para quem edita reservas); a mensagem pendente ao hóspede só para quem lê o financeiro", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const base = { imoveis: await listarImoveis(db, c.org), todos: true, periodo: { inicio: "2026-10-01", fim: "2026-11-01" }, ano: 2026, hoje: "2026-10-01", verFinanceiro: false, agora: minutos(30) };
    const operacao = await carregarDashboard(db, c.org, { ...base, verCancelamentos: true, verPagamentos: false });
    expect(operacao.alertas).toContainEqual({ nivel: "info", texto: `Alteração da reserva ${x.reservaCodigo}: datas seguradas até 13:20, esperando o pagamento da diferença.`, link: `/painel/reservas/${x.reservaId}` });
    expect(operacao.alertas.some((a) => a.texto.includes("mensagem ao hóspede pendente"))).toBe(false);
    for (const a of operacao.alertas) expect(a.texto).not.toContain("R$");
    // Quem lê o financeiro também recebe a proposta a avisar.
    const financeiro = await carregarDashboard(db, c.org, { ...base, verCancelamentos: true, verPagamentos: true });
    expect(financeiro.alertas).toContainEqual({ nivel: "info", texto: `1 alteração(ões) com mensagem ao hóspede pendente (proposta, confirmação ou devolução feita): avise o hóspede (${x.reservaCodigo}).`, link: `/painel/reservas/${x.reservaId}` });
    // Financeiro → Pagamentos do site, "pede atenção": o pagamento da reserva com uma alteração segurada.
    expect((await listarPagamentos(db, c.org, { atencao: true }, minutos(30))).map((p) => p.id)).toEqual([x.pagamentoId]);
    expect(await listarPagamentos(db, c.org, { atencao: true }, minutos(81))).toEqual([]);
    // Sem reserva:editar, nada disso.
    expect((await carregarDashboard(db, c.org, base)).alertas.some((a) => a.texto.includes("Alteração da reserva"))).toBe(false);
    // Vencida (sem a rotina), o aviso sai sozinho.
    expect((await avisosDeAlteracao(db, c.org, minutos(81))).some((a) => a.texto.includes("Alteração da reserva"))).toBe(false);
    // Outra empresa não vê.
    const outra = await montarCenario(db);
    expect(await avisosDeAlteracao(db, outra.org, minutos(30))).toEqual([]);
    expect(await db.select().from(alteracoesReserva).where(eq(alteracoesReserva.organizacaoId, outra.org))).toEqual([]);
  });
});
