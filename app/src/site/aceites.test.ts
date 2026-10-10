import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { gravarConfig, lerConfig, travarConfig, travarConfigCompartilhada } from "@/configuracoes/armazem";
import { salvarEmpresa } from "@/configuracoes/empresa";
import { publicarPaginaLegal } from "@/configuracoes/paginas-legais";
import { RASCUNHO_PAGINAS_LEGAIS } from "@/configuracoes/paginas-legais-rascunho";
import { PAGINAS_LEGAIS } from "@/configuracoes/paginas-legais-texto";
import { publicarPaginasLegaisDeTeste } from "@/configuracoes/paginas-legais-testes";
import { aceitesSite, auditoria, cotacoes, organizacoes, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { conferirTentativa } from "@/pagamentos/conferencia";
import { podeCobrar, TEXTO_SEM_COBRANCA } from "@/pagamentos/oferta";
import { gerarPix } from "@/pagamentos/pix";
import { AGORA, alterar, type Cenario, EMAIL_HOSPEDE, env, minutos, montarCenario, pagarEConfirmar, usuarioDeTeste } from "@/pagamentos/testes";
import { travarCotacao } from "@/pagamentos/travas";
import { aceiteDaDiferencaParaPagina, aceiteParaPagina, aceitesDaReserva, contarAceitesPorVersao, MENSAGENS_ACEITE, politicaDoPagamento, registrarAceiteDoHospede, versoesDoFormulario } from "./aceites";
import { criarCotacao } from "./cotacoes";

// As travas são espiadas: o Pix lê as versões publicadas sob a trava COMPARTILHADA dos três documentos, depois das
// travas da cotação; a publicação usa a exclusiva da própria chave.
vi.mock("@/configuracoes/armazem", async (orig) => {
  const m = await orig<typeof import("@/configuracoes/armazem")>();
  return { ...m, travarConfig: vi.fn(m.travarConfig), travarConfigCompartilhada: vi.fn(m.travarConfigCompartilhada) };
});
vi.mock("@/pagamentos/travas", async (orig) => {
  const m = await orig<typeof import("@/pagamentos/travas")>();
  return { ...m, travarCotacao: vi.fn(m.travarCotacao) };
});

let db: Db, close: () => Promise<void>, c: Cenario;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => { c = await montarCenario(db); });

const V1 = { termos: 1, privacidade: 1, cancelamento: 1 };
const aceitesDa = (cotacaoId: string) => db.select().from(aceitesSite).where(eq(aceitesSite.cotacaoId, cotacaoId));
const auditoriaDoAceite = (reservaId: string) => db.select().from(auditoria).where(and(eq(auditoria.entidadeId, reservaId), eq(auditoria.acao, "cotacao.aceitar_paginas_legais")));
const tentativasDa = (cotacaoId: string) => db.select().from(pagamentos).where(eq(pagamentos.cotacaoId, cotacaoId));

/** Publica a versão 2 da Política de cancelamento (prazo de 7 dias) pelo caminho do painel, com dados fictícios da empresa. */
async function publicarCancelamentoV2(hoje = "2026-10-01") {
  await salvarEmpresa(
    db,
    c.org,
    { nome: "Sua Casa Exemplo", razaoSocial: "Casa Exemplo Temporada Ltda.", cnpj: "00.000.000/0001-00", email: "contato@example.com", telefone: "(21) 90000-0000", endereco: "Rua Fictícia, 100, Rio de Janeiro, RJ", encarregado: "Pessoa Exemplo", site: "", chavePix: "" },
    null,
  );
  const r = await publicarPaginaLegal(db, c.org, "cancelamento", { secoes: RASCUNHO_PAGINAS_LEGAIS.cancelamento.secoes, diasReembolsoIntegral: 7 }, null, hoje, 1);
  if (!r.ok || r.versao.numero !== 2) throw new Error(r.ok ? "sem versão nova" : r.erro);
}

describe("versões do formulário (M7.4)", () => {
  it("as três versões em número inteiro positivo; faltando ou fora do formato, null", () => {
    const form = (campos: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(campos)) f.set(k, v);
      return f;
    };
    expect(versoesDoFormulario(form({ versaoTermos: "1", versaoPrivacidade: "2", versaoCancelamento: "3" }))).toEqual({ termos: 1, privacidade: 2, cancelamento: 3 });
    expect(versoesDoFormulario(form({ versaoTermos: "1", versaoPrivacidade: "2" }))).toBeNull();
    for (const ruim of ["0", "-1", "1.5", "abc", "", "1234567"]) expect(versoesDoFormulario(form({ versaoTermos: ruim, versaoPrivacidade: "1", versaoCancelamento: "1" }))).toBeNull();
  });
});

describe("trava do pagamento: as três páginas legais publicadas (M7.4)", () => {
  it("sem as páginas publicadas o site não cobra (sem_paginas_legais, com o texto); publicadas as três, cobra", async () => {
    const s = await montarCenario(db, { semPaginasLegais: true });
    expect(s.versoesLegais).toBeNull();
    expect(s.gate).toEqual({ ok: false, motivo: "sem_paginas_legais", texto: TEXTO_SEM_COBRANCA.sem_paginas_legais });
    expect(await podeCobrar(db, s.org, env(), AGORA, { provedor: s.provedor })).toMatchObject({ ok: false, motivo: "sem_paginas_legais" });
    await publicarPaginasLegaisDeTeste(db, s.org);
    expect(await podeCobrar(db, s.org, env(), AGORA, { provedor: s.provedor })).toMatchObject({ ok: true, ambiente: "teste" });
  });

  it("segunda linha de defesa: sem as páginas, a fase 1 do Pix recusa (não oferecido) e nada é gravado", async () => {
    const s = await montarCenario(db, { semPaginasLegais: true });
    const h = await s.segurar();
    expect(await gerarPix(db, s.org, h.cotacaoId, AGORA, s.provedor, { aceite: V1 })).toEqual({ ok: false, codigo: "nao_oferecido", erro: TEXTO_SEM_COBRANCA.sem_paginas_legais });
    expect(await tentativasDa(h.cotacaoId)).toEqual([]);
    expect(await aceitesDa(h.cotacaoId)).toEqual([]);
  });
});

describe("aceite ao gerar o Pix (M7.4)", () => {
  it("sem aceite: aceite_pendente, nenhuma tentativa criada e o prazo das datas não muda", async () => {
    const s = await c.segurar({ semAceite: true });
    const antes = (await c.cotacao(s.cotacaoId)).holdAte;
    expect(await gerarPix(db, c.org, s.cotacaoId, AGORA, c.provedor)).toMatchObject({ ok: false, codigo: "aceite_pendente" });
    expect(await tentativasDa(s.cotacaoId)).toEqual([]);
    expect(await aceitesDa(s.cotacaoId)).toEqual([]);
    expect((await c.cotacao(s.cotacaoId)).holdAte).toEqual(antes);
    expect(c.provedor.chamadas.filter((x) => x.metodo === "criarPix")).toEqual([]);
  });

  it("aceite junto com o Pix: gravado na mesma transação (versões, origem, hora), a tentativa aponta para ele, uma auditoria sem usuário e sem dado pessoal", async () => {
    const s = await c.segurar({ semAceite: true });
    const r = await gerarPix(db, c.org, s.cotacaoId, AGORA, c.provedor, { aceite: V1 });
    expect(r).toMatchObject({ ok: true, reaproveitado: false });
    const [aceite, ...outros] = await aceitesDa(s.cotacaoId);
    expect(outros).toEqual([]);
    expect(aceite).toMatchObject({ organizacaoId: c.org, reservaId: s.reservaId, versaoTermos: 1, versaoPrivacidade: 1, versaoCancelamento: 1, origem: "pix", aceitoEm: AGORA });
    const [tentativa] = await tentativasDa(s.cotacaoId);
    expect(tentativa.aceiteId).toBe(aceite.id);
    const aud = await auditoriaDoAceite(s.reservaId);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ usuarioId: null, entidade: "reserva", mudancas: { paginasLegais: [null, "termos v1, privacidade v1, cancelamento v1 (pix)"] } });
    for (const proibido of [EMAIL_HOSPEDE, "Visitante Fictício", "99999-0000"]) expect(JSON.stringify([aceite, aud])).not.toContain(proibido);
  });

  it("versões velhas (a página ficou aberta enquanto saiu outra versão): aceite_mudou, nada gravado", async () => {
    const s = await c.segurar({ semAceite: true });
    await publicarCancelamentoV2();
    expect(await gerarPix(db, c.org, s.cotacaoId, AGORA, c.provedor, { aceite: V1 })).toMatchObject({ ok: false, codigo: "aceite_mudou" });
    expect(await aceitesDa(s.cotacaoId)).toEqual([]);
    expect(await tentativasDa(s.cotacaoId)).toEqual([]);
    expect(await gerarPix(db, c.org, s.cotacaoId, AGORA, c.provedor, { aceite: { ...V1, cancelamento: 2 } })).toMatchObject({ ok: true });
  });

  it("idempotente: o mesmo aceite duas vezes é uma linha e uma auditoria", async () => {
    const s = await c.segurar();
    expect(await registrarAceiteDoHospede(db, c.org, s.cotacaoId, V1, "pix", minutos(1))).toMatchObject({ ok: true, aceite: { versoes: V1, aceitoEm: AGORA } });
    expect(await aceitesDa(s.cotacaoId)).toHaveLength(1);
    expect(await auditoriaDoAceite(s.reservaId)).toHaveLength(1);
    // Com o aceite já gravado, a caixa marcada de novo no Pix também não duplica.
    expect(await gerarPix(db, c.org, s.cotacaoId, minutos(2), c.provedor, { aceite: V1 })).toMatchObject({ ok: true });
    expect(await aceitesDa(s.cotacaoId)).toHaveLength(1);
  });

  it("versão nova depois do aceite: o Pix válido é mostrado de novo sem pedir nada; vencido, o próximo pede o aceite da versão nova; a tentativa antiga continua com o aceite antigo", async () => {
    const s = await c.segurar();
    const a = await c.pix(s.cotacaoId);
    const [aceiteV1] = await aceitesDa(s.cotacaoId);
    await publicarCancelamentoV2();
    expect(await gerarPix(db, c.org, s.cotacaoId, minutos(5), c.provedor)).toEqual({ ok: true, pagamentoId: a.pagamentoId, reaproveitado: true });
    expect(await aceitesDa(s.cotacaoId)).toHaveLength(1);
    // Perto de vencer: um Pix novo, que pede o aceite das versões em vigor.
    expect(await gerarPix(db, c.org, s.cotacaoId, minutos(29.5), c.provedor)).toMatchObject({ ok: false, codigo: "aceite_pendente" });
    expect((await c.tentativa(a.pagamentoId)).situacao).toBe("pendente");
    const b = await gerarPix(db, c.org, s.cotacaoId, minutos(29.5), c.provedor, { aceite: { ...V1, cancelamento: 2 } });
    expect(b).toMatchObject({ ok: true, reaproveitado: false });
    if (!b.ok) return;
    const aceites = await aceitesDa(s.cotacaoId);
    const aceiteV2 = aceites.find((x) => x.versaoCancelamento === 2)!;
    expect(aceites).toHaveLength(2);
    expect((await c.tentativa(b.pagamentoId)).aceiteId).toBe(aceiteV2.id);
    expect(await c.tentativa(a.pagamentoId)).toMatchObject({ situacao: "cancelado", aceiteId: aceiteV1.id });
    // A devolução (M8.2c) lê a política de cada tentativa, nunca a em vigor.
    expect(await politicaDoPagamento(db, c.org, a.pagamentoId)).toEqual({ versao: 1, data: "2026-10-01", regras: { diasReembolsoIntegral: 14, arrependimentoAteEntrada: true } });
    expect(await politicaDoPagamento(db, c.org, b.pagamentoId)).toEqual({ versao: 2, data: "2026-10-01", regras: { diasReembolsoIntegral: 7, arrependimentoAteEntrada: true } });
  });

  it("a aprovação nunca confere aceite: versão nova publicada depois do Pix e o pagamento aprovado confirma a reserva", async () => {
    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    await publicarCancelamentoV2();
    vi.mocked(travarConfigCompartilhada).mockClear();
    c.provedor.aprovar(p.idProvedor);
    expect(await conferirTentativa(db, c.org, p.pagamentoId, c.provedor, minutos(3), { origem: "rotina", forcar: true })).toMatchObject({ ok: true, situacao: "aprovado" });
    expect((await c.reserva(s.reservaId)).estado).toBe("confirmada");
    expect(await c.tentativa(p.pagamentoId)).toMatchObject({ desfecho: "reserva", motivoSemReserva: null });
    expect(vi.mocked(travarConfigCompartilhada)).not.toHaveBeenCalled();
  });
});

describe("aceite avulso: registrarAceiteDoHospede (M7.4)", () => {
  it("deny-by-default: id inválido, outra empresa, cotação sem pedido, cotação não segurada, prazo vencido e versões diferentes das publicadas", async () => {
    const s = await c.segurar({ semAceite: true });
    expect(await registrarAceiteDoHospede(db, c.org, "nada", V1, "pix", AGORA)).toEqual({ ok: false, erro: MENSAGENS_ACEITE.nao_encontrada });
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra Exemplo" }).returning();
    await publicarPaginasLegaisDeTeste(db, outra);
    expect(await registrarAceiteDoHospede(db, outra, s.cotacaoId, V1, "pix", AGORA)).toEqual({ ok: false, erro: MENSAGENS_ACEITE.nao_encontrada });
    const aberta = await criarCotacao(db, c.org, { imovel: "403", entrada: "2026-11-02", saida: "2026-11-05", hospedes: "2" }, AGORA);
    if (!aberta.ok) throw new Error(aberta.erro);
    expect(await registrarAceiteDoHospede(db, c.org, aberta.cotacao.id, V1, "pix", AGORA)).toEqual({ ok: false, erro: MENSAGENS_ACEITE.nao_encontrada });
    expect(await registrarAceiteDoHospede(db, c.org, s.cotacaoId, { ...V1, termos: 2 }, "pix", AGORA)).toEqual({ ok: false, erro: MENSAGENS_ACEITE.mudou });
    expect(await registrarAceiteDoHospede(db, c.org, s.cotacaoId, V1, "pix", minutos(31))).toEqual({ ok: false, erro: MENSAGENS_ACEITE.prazo_vencido });
    await db.update(cotacoes).set({ estado: "expirada" }).where(eq(cotacoes.id, s.cotacaoId));
    expect(await registrarAceiteDoHospede(db, c.org, s.cotacaoId, V1, "pix", AGORA)).toEqual({ ok: false, erro: MENSAGENS_ACEITE.nao_segurada });
    expect(await aceitesDa(s.cotacaoId)).toEqual([]);
    expect(await auditoriaDoAceite(s.reservaId)).toEqual([]);
  });
});

describe("travas do aceite (M7.4)", () => {
  it("na fase 1 do Pix: as três travas compartilhadas, na ordem, depois da trava da cotação; nenhuma exclusiva", async () => {
    const s = await c.segurar({ semAceite: true });
    vi.mocked(travarConfig).mockClear();
    vi.mocked(travarConfigCompartilhada).mockClear();
    vi.mocked(travarCotacao).mockClear();
    expect(await gerarPix(db, c.org, s.cotacaoId, AGORA, c.provedor, { aceite: V1 })).toMatchObject({ ok: true });
    const compartilhadas = vi.mocked(travarConfigCompartilhada).mock;
    expect(compartilhadas.calls.map((x) => [x[1], x[2]])).toEqual([
      [c.org, "termos_uso"],
      [c.org, "politica_privacidade"],
      [c.org, "politica_cancelamento"],
    ]);
    // A primeira trava da cotação (fase 1) vem antes da primeira trava das páginas legais.
    expect(vi.mocked(travarCotacao).mock.invocationCallOrder[0]).toBeLessThan(compartilhadas.invocationCallOrder[0]);
    expect(vi.mocked(travarConfig).mock.calls.filter((x) => ["termos_uso", "politica_privacidade", "politica_cancelamento"].includes(x[2]))).toEqual([]);
  });

  it("publicar usa a trava exclusiva só da própria chave, e nenhuma compartilhada", async () => {
    vi.mocked(travarConfig).mockClear();
    vi.mocked(travarConfigCompartilhada).mockClear();
    await publicarCancelamentoV2();
    const exclusivas = vi.mocked(travarConfig).mock.calls.map((x) => x[2]);
    expect(exclusivas).toContain("politica_cancelamento");
    expect(exclusivas).not.toContain("termos_uso");
    expect(exclusivas).not.toContain("politica_privacidade");
    expect(vi.mocked(travarConfigCompartilhada)).not.toHaveBeenCalled();
  });
});

describe("prova do aceite (M7.4)", () => {
  it("página da cotação: sem aceite, com aceite e, depois de confirmada, o aceite do pagamento que confirmou; o prazo da reserva", async () => {
    const s = await c.segurar({ semAceite: true });
    const cot = await c.cotacao(s.cotacaoId);
    const pagina = () => aceiteParaPagina(db, c.org, { id: cot.id, checkin: cot.checkin, fuso: "America/Sao_Paulo", reservaId: cot.reservaId }, minutos(4));
    const antes = await pagina();
    expect(antes).toMatchObject({ versoes: V1, aceito: null });
    // Entrada em 12/10 com 14 dias: o reembolso integral ia até 28/09, já passou.
    expect(antes?.prazo).toEqual({ tipo: "sem_reembolso", dias: 14 });
    expect(antes?.resumo.length).toBeGreaterThan(0);
    expect(JSON.stringify(antes?.resumo)).toContain("14 dias");
    expect(JSON.stringify(antes?.resumo)).not.toContain("{{");
    const p = await gerarPix(db, c.org, s.cotacaoId, AGORA, c.provedor, { aceite: V1 });
    if (!p.ok) throw new Error(p.erro);
    expect((await pagina())?.aceito).toEqual({ em: AGORA.toISOString(), versoes: V1 });
    // Versão nova antes da aprovação: a página mostra as versões em vigor, mas a reserva confirmada fica com o aceite do pagamento.
    await publicarCancelamentoV2();
    expect(await pagina()).toMatchObject({ versoes: { ...V1, cancelamento: 2 }, aceito: null });
    c.provedor.aprovar((await c.tentativa(p.pagamentoId)).idProvedor!);
    await conferirTentativa(db, c.org, p.pagamentoId, c.provedor, minutos(3), { origem: "rotina", forcar: true });
    const confirmada = await pagina();
    expect(confirmada).toMatchObject({ versoes: { ...V1, cancelamento: 2 }, aceito: { em: AGORA.toISOString(), versoes: V1 }, prazo: { tipo: "sem_reembolso", dias: 14 } });
    // Entrada mais longe, antes do aceite: vale a política em vigor (versão 2, 7 dias) — o último dia do reembolso
    // integral é a entrada menos os dias da política (datas no fuso do imóvel).
    const longe = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "longe@example.com", semAceite: true });
    const cl = await c.cotacao(longe.cotacaoId);
    expect((await aceiteParaPagina(db, c.org, { id: cl.id, checkin: cl.checkin, fuso: "America/Sao_Paulo", reservaId: cl.reservaId }, minutos(4)))?.prazo).toEqual({ tipo: "integral_ate", data: "2026-10-26" });
  });

  it("sem as três publicadas a página não mostra aceite; painel: aceites da reserva, contagem por versão e política de cada pagamento, por empresa", async () => {
    const sem = await montarCenario(db, { semPaginasLegais: true });
    const h = await sem.segurar();
    expect(await aceiteParaPagina(db, sem.org, { id: h.cotacaoId, checkin: "2026-10-12", fuso: "America/Sao_Paulo", reservaId: h.reservaId }, AGORA)).toBeNull();
    expect(await aceitesDaReserva(db, sem.org, h.reservaId)).toEqual([]);

    const s = await c.segurar();
    const p = await c.pix(s.cotacaoId);
    await publicarCancelamentoV2();
    expect(await registrarAceiteDoHospede(db, c.org, s.cotacaoId, { ...V1, cancelamento: 2 }, "pix", minutos(1))).toMatchObject({ ok: true });
    const outra = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "outra@example.com", semAceite: true });
    expect(await registrarAceiteDoHospede(db, c.org, outra.cotacaoId, { ...V1, cancelamento: 2 }, "cartao", minutos(1))).toMatchObject({ ok: true, aceite: { origem: "cartao" } });
    const daReserva = await aceitesDaReserva(db, c.org, s.reservaId);
    expect(daReserva.map((a) => [a.versoes.cancelamento, a.aceitoEm, a.origem])).toEqual([
      [2, minutos(1), "pix"],
      [1, AGORA, "pix"],
    ]);
    expect(await aceitesDaReserva(db, sem.org, s.reservaId)).toEqual([]);
    expect(await aceitesDaReserva(db, c.org, "nada")).toEqual([]);
    const contagem = await contarAceitesPorVersao(db, c.org);
    expect([...contagem.termos]).toEqual([[1, 3]]);
    expect([...contagem.privacidade]).toEqual([[1, 3]]);
    expect(new Map(contagem.cancelamento)).toEqual(new Map([[1, 1], [2, 2]]));
    expect((await contarAceitesPorVersao(db, sem.org)).termos.size).toBe(0);
    expect(await politicaDoPagamento(db, c.org, p.pagamentoId)).toEqual({ versao: 1, data: "2026-10-01", regras: { diasReembolsoIntegral: 14, arrependimentoAteEntrada: true } });
    expect(await politicaDoPagamento(db, sem.org, p.pagamentoId)).toBeNull();
    expect(await politicaDoPagamento(db, c.org, "nada")).toBeNull();
  });
});

describe("o prazo da página depois de uma alteração (M8.2d)", () => {
  it("reserva movida para antes: o prazo conta da entrada que conta (a menor), o mesmo do painel; movida para depois, continua da original", async () => {
    const x = await pagarEConfirmar(c, { entrada: "2026-11-20", saida: "2026-11-23" });
    const cot = await c.cotacao(x.cotacaoId);
    const pagina = async () => (await aceiteParaPagina(db, c.org, { id: cot.id, checkin: cot.checkin, fuso: "America/Sao_Paulo", reservaId: cot.reservaId }, minutos(4)))?.prazo;
    expect(await pagina()).toEqual({ tipo: "integral_ate", data: "2026-11-06" });
    await db.update(reservas).set({ checkin: "2026-11-10", checkout: "2026-11-13" }).where(eq(reservas.id, x.reservaId));
    expect(await pagina()).toEqual({ tipo: "integral_ate", data: "2026-10-27" });
    await db.update(reservas).set({ checkin: "2026-11-27", checkout: "2026-11-30" }).where(eq(reservas.id, x.reservaId));
    expect(await pagina()).toEqual({ tipo: "integral_ate", data: "2026-11-06" });
  });
});

describe("o aceite do pagamento da diferença na página da reserva (M8.2d, D11)", () => {
  /** Publica a versão 2 dos Termos de uso (igual à 1; o texto não importa aqui). */
  async function publicarTermosV2() {
    const chave = PAGINAS_LEGAIS.termos.chave;
    const atual = (await lerConfig(db, c.org, chave)) as { versoes: { numero: number; data: string }[] };
    await gravarConfig(db, c.org, chave, { versoes: [...atual.versoes, { ...atual.versoes[0], numero: 2, data: "2026-10-01" }] }, null, false);
  }

  it("os Termos e a Privacidade em vigor com a política da reserva (versão e dia do aceite que a confirmou); a caixa some com o aceite dessas versões; sem aceite na reserva, a política em vigor", async () => {
    const x = await pagarEConfirmar(c);
    const cot = await c.cotacao(x.cotacaoId);
    const pagina = (quando: Date) => aceiteDaDiferencaParaPagina(db, c.org, { id: cot.id, checkin: cot.checkin, fuso: "America/Sao_Paulo", reservaId: x.reservaId }, quando);
    const [doP0] = await db.select().from(aceitesSite).where(eq(aceitesSite.id, (await c.tentativa(x.pagamentoId)).aceiteId!));
    // As versões do pagamento que confirmou ainda em vigor: já aceitas nesta cotação, nenhuma caixa.
    expect(await pagina(minutos(20))).toMatchObject({ versoes: V1, aceito: { versoes: V1 }, daReserva: { versao: 1, em: doP0.aceitoEm.toISOString() } });
    // Termos e Política de cancelamento novos: a caixa pede os Termos 2 com a política 1 da reserva (o resumo e o prazo são dela).
    await publicarTermosV2();
    await publicarCancelamentoV2();
    const pendente = await pagina(minutos(20));
    expect(pendente).toMatchObject({ versoes: { termos: 2, privacidade: 1, cancelamento: 1 }, aceito: null, daReserva: { versao: 1 }, prazo: { tipo: "sem_reembolso", dias: 14 } });
    expect(JSON.stringify(pendente?.resumo)).toContain("14 dias");
    // O Pix da diferença com essas versões grava o aceite: a página passa a mostrar o aceite feito.
    const equipe = await usuarioDeTeste(c);
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20), { autorId: equipe });
    if (!resultado.ok) throw new Error(resultado.erro);
    const pix = await gerarPix(db, c.org, x.cotacaoId, minutos(21), c.provedor, { alteracaoId: resultado.alteracaoId, aceite: { termos: 2, privacidade: 1, cancelamento: 1 } });
    expect(pix).toMatchObject({ ok: true });
    expect((await pagina(minutos(22)))?.aceito).toEqual({ em: minutos(21).toISOString(), versoes: { termos: 2, privacidade: 1, cancelamento: 1 } });
    // Reserva confirmada por um pagamento sem aceite (antes das páginas legais): vale a política em vigor, como no domínio.
    await db.update(pagamentos).set({ aceiteId: null }).where(eq(pagamentos.id, x.pagamentoId));
    const semAceite = await pagina(minutos(22));
    expect(semAceite).toMatchObject({ versoes: { termos: 2, privacidade: 1, cancelamento: 2 }, aceito: null });
    expect(semAceite?.daReserva).toBeUndefined();
    // Outra empresa não vê nada desta reserva; sem as três páginas publicadas, nada.
    const sem = await montarCenario(db, { semPaginasLegais: true });
    expect(await aceiteDaDiferencaParaPagina(db, sem.org, { id: cot.id, checkin: cot.checkin, fuso: "America/Sao_Paulo", reservaId: x.reservaId }, minutos(22))).toBeNull();
  });
});
