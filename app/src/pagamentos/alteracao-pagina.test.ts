/**
 * M8.2d — a alteração do lado do hóspede e do pagamento da diferença: a página da reserva (a alteração segurada com a
 * diferença a pagar, a aplicada com a devolução, a retida), o Pix e o cartão da diferença (o alvo da cobrança: valor,
 * limites, "já pago" e a alteração que mudou; o aceite na política da reserva), as tentativas irmãs que não se cancelam,
 * o bloqueio manual que vence antes a alteração e os avisos do Início. Dados fictícios; nada de rede.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import { PAGINAS_LEGAIS } from "@/configuracoes/paginas-legais-texto";
import { TEXTOS_SITE_INICIAIS } from "@/configuracoes/textos-site";
import { aceitesSite, alteracoesReserva, pagamentos, reservas } from "@/db/schema";
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
import { listarPagamentos } from "./consultas";
import { gerarPix } from "./pix";
import { alteracaoGravada, alterar, CARTAO_FICTICIO, type Cenario, env, minutos, montarCenario, pagarDiferenca, pagarEConfirmar, semDadosDoHospede, TOTAL, usuarioDeTeste } from "./testes";

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
    // O pagamento da reserva continua o mesmo (a diferença tem a vista própria).
    expect(v?.estado).toBe((await pagina(x.cotacaoId, minutos(21)))?.estado);

    await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25) });
    const depois = await pagina(x.cotacaoId, minutos(30));
    expect(depois?.alteracao).toMatchObject({ situacao: "aplicada", pagamento: null, devolucao: null });
    expect(texto(depois!.alteracao!, x.reservaCodigo).linhas[0]).toBe(`Alteração confirmada em 01/10: 12/10–16/10, 4 pessoas, R$ 2.352,00. ${TEXTOS_SITE_INICIAIS.alteracaoConfirmada}`);
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
    expect(texto(vr!.alteracao!, y.reservaCodigo).resumo).toContain(`Pela política, a diferença de R$ 200,00 não é devolvida (o pedido chegou depois de 06/10, 23h59, contando da entrada de 20/10). ${TEXTOS_SITE_INICIAIS.alteracaoSemDevolucao}`);
  });

  it("a que não vale mais (a equipe desistiu): por 7 dias", async () => {
    const x = await pagarEConfirmar(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    expect(await desistirDaAlteracao(db, c.org, resultado.alteracaoId, "O hóspede desistiu", equipe, c.provedor, minutos(22))).toEqual({ ok: true });
    const v = await pagina(x.cotacaoId, minutos(23));
    expect(v?.alteracao).toMatchObject({ situacao: "nao_vale" });
    expect(texto(v!.alteracao!, x.reservaCodigo).resumo).toBe(`A alteração preparada em 01/10 não vale mais. ${TEXTOS_SITE_INICIAIS.alteracaoNaoVale}`);
    expect((await pagina(x.cotacaoId, new Date(minutos(23).getTime() + 8 * 86_400_000)))?.alteracao ?? null).toBeNull();
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
    expect((await avisosDeAlteracao(db, c.org, minutos(81), { env: env() })).some((a) => a.texto.includes("Alteração da reserva"))).toBe(false);
    // Outra empresa não vê.
    const outra = await montarCenario(db);
    expect(await avisosDeAlteracao(db, outra.org, minutos(30), { env: env() })).toEqual([]);
    expect(await db.select().from(alteracoesReserva).where(eq(alteracoesReserva.organizacaoId, outra.org))).toEqual([]);
  });
});
