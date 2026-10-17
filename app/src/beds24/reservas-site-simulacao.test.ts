/**
 * "Simular" da ficha (M8.3a, desenho 2.4, 3.3 e 8; seção 10, teste 11): zero `fetch`, uma operação `simulacao`/`simulada`
 * com o pedido montado só com o banco (sem nome, e-mail, telefone nem valor), nenhuma marca das OTAs e nenhum
 * acompanhamento. Só fora do deploy de produção ou com a chave das reservas desligada; `reserva:editar`. PGlite, sem rede.
 */
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AcessoNegado, type Sessao } from "@/acesso/politica";
import { gravarConfig } from "@/configuracoes/armazem";
import { beds24ReservasOperacoes, beds24ReservasSite, cancelamentosReserva, contratos, idsExternos, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { confirmarReserva } from "@/reservas/repositorio";
import { alteracaoGravada, alterar, type Cenario, entradaPadrao, cancelar, env, minutos, montarCenario, pagarDiferenca, pagarEConfirmar, semDadosDoHospede, TOTAL, usuarioDeTeste } from "@/pagamentos/testes";
import { assinaturaEsperado, chaveSimulacaoBeds24 } from "./reservas-site-regras";
import { chaveDoResultadoDaSimulacao, simularReservaNoBeds24 } from "./reservas-site-simulacao";

const PRODUCAO = { VERCEL_ENV: "production", NODE_ENV: "production", BEDS24_REFRESH_TOKEN: "refresh-ficticio" };

let db: Db, close: () => Promise<void>, c: Cenario, admin: Sessao;
beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  c = await montarCenario(db);
  admin = { usuarioId: await usuarioDeTeste(c), organizacaoId: c.org, papel: "admin", imovelIds: [] };
});

const operacoes = (reservaId: string) => db.select().from(beds24ReservasOperacoes).where(and(eq(beds24ReservasOperacoes.organizacaoId, c.org), eq(beds24ReservasOperacoes.reservaId, reservaId)));
const acompanhamentos = () => db.select().from(beds24ReservasSite).where(eq(beds24ReservasSite.organizacaoId, c.org));

/** Simula vigiando a rede: nenhum `fetch` sai (a barreira do setup também derrubaria um para o Beds24). */
async function simularSemRede(sessao: Sessao, reservaId: string, e: NodeJS.ProcessEnv = env(), agora = minutos(10)) {
  const espiao = vi.spyOn(globalThis, "fetch");
  try {
    return await simularReservaNoBeds24(db, sessao, reservaId, e, agora);
  } finally {
    expect(espiao).not.toHaveBeenCalled();
    espiao.mockRestore();
  }
}

describe("Simular (M8.3a, teste 11)", () => {
  it("reserva paga pelo site: o pedido de criação só com o banco, operação simulada, sem acompanhamento nem marca, sem dado pessoal", async () => {
    const x = await pagarEConfirmar(c);
    const r = await simularSemRede(admin, x.reservaId);
    const pedido = { quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada", referencia: x.reservaCodigo };
    // Imóvel desligado e confirmada antes de qualquer ligação de agora: ligar não faria ela sair (D6), e o resultado diz isso.
    expect(r).toEqual({ ok: true, operacaoId: expect.any(String), repetida: false, imovelDesligado: "anterior_a_ligar", tipo: "criar", pedido });
    expect(chaveDoResultadoDaSimulacao(r)).toBe("simulada_imovel_desligado_anterior");
    const [op] = await operacoes(x.reservaId);
    const assinatura = assinaturaEsperado({ quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada" });
    expect(op).toMatchObject({ tipo: "criar", modo: "simulacao", situacao: "simulada", chave: chaveSimulacaoBeds24(x.reservaId, "criar", assinatura, null), acompanhamentoId: null, autorId: admin.usuarioId, beds24Id: null, enviadoEm: null, credencial: "", pedido });
    // Nenhum acompanhamento (onde fica a marca "datas fechadas"), nenhum id do Beds24 na reserva.
    expect(await acompanhamentos()).toEqual([]);
    expect((await c.reserva(x.reservaId)).beds24Id).toBeNull();
    expect(JSON.stringify(op.pedido)).not.toContain(String(TOTAL));
    expect(await semDadosDoHospede(db)).toEqual([]);
  });

  it("simular de novo a mesma intenção não duplica (on conflict + releitura); mudar as pessoas é outra intenção", async () => {
    const x = await pagarEConfirmar(c);
    const a = await simularSemRede(admin, x.reservaId);
    const b = await simularSemRede(admin, x.reservaId, env(), minutos(20));
    expect(b).toMatchObject({ ok: true, repetida: true });
    expect(a.ok && b.ok && b.operacaoId === a.operacaoId).toBe(true);
    expect(await operacoes(x.reservaId)).toHaveLength(1);
    await db.update(reservas).set({ hospedes: 3 }).where(eq(reservas.id, x.reservaId));
    expect(await simularSemRede(admin, x.reservaId)).toMatchObject({ ok: true, repetida: false, pedido: { hospedes: 3 } });
    expect(await operacoes(x.reservaId)).toHaveLength(2);
    expect(chaveDoResultadoDaSimulacao(b)).toBe("repetida_imovel_desligado_anterior");
  });

  it("voltar a um estado já simulado (A→B→A) grava uma linha nova: \"repetida\" só quando a última simulação é a mesma intenção", async () => {
    const x = await pagarEConfirmar(c);
    const a1 = await simularSemRede(admin, x.reservaId);
    await db.update(reservas).set({ hospedes: 3 }).where(eq(reservas.id, x.reservaId));
    const b = await simularSemRede(admin, x.reservaId);
    await db.update(reservas).set({ hospedes: 4 }).where(eq(reservas.id, x.reservaId));
    const a2 = await simularSemRede(admin, x.reservaId);
    expect(a2).toMatchObject({ ok: true, repetida: false, pedido: { hospedes: 4 } });
    expect(a1.ok && b.ok && a2.ok && new Set([a1.operacaoId, b.operacaoId, a2.operacaoId]).size).toBe(3);
    expect(chaveDoResultadoDaSimulacao(a2)).toBe("simulada_imovel_desligado_anterior");
    // O histórico da ficha começa pela simulação de agora.
    const ordem = await db.select({ id: beds24ReservasOperacoes.id, pedido: beds24ReservasOperacoes.pedido }).from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.reservaId, x.reservaId)).orderBy(desc(beds24ReservasOperacoes.iniciadoEm), desc(beds24ReservasOperacoes.id));
    expect(ordem.map((o) => o.pedido?.hospedes)).toEqual([4, 3, 4]);
    expect(a2.ok && ordem[0].id === a2.operacaoId).toBe(true);
    // De novo, sem mudar nada: aí sim é a mesma da última.
    expect(await simularSemRede(admin, x.reservaId)).toMatchObject({ ok: true, repetida: true, operacaoId: a2.ok ? a2.operacaoId : "" });
    expect(await operacoes(x.reservaId)).toHaveLength(3);
  });

  it("com um envio real sem conclusão (em curso, incerto, ou o POST tentado sem o id), nada é simulado: nem \"criar\" de novo, nem \"nada a cancelar\"", async () => {
    const x = await pagarEConfirmar(c);
    const casos = [
      { situacao: "enviando" as const, enviadoEm: null },
      { situacao: "incerta" as const, enviadoEm: new Date("2026-10-01T12:00:00Z") },
      { situacao: "pendente" as const, enviadoEm: new Date("2026-10-01T12:00:00Z") },
    ];
    for (const caso of casos) {
      await db.delete(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.organizacaoId, c.org));
      await db.insert(beds24ReservasOperacoes).values({ organizacaoId: c.org, reservaId: x.reservaId, tipo: "criar", chave: `criar:${x.reservaId}:1`, modo: "real", situacao: caso.situacao, enviadoEm: caso.enviadoEm, pedido: { quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada", referencia: x.reservaCodigo } });
      const r = await simularSemRede(admin, x.reservaId);
      expect(r).toEqual({ ok: false, motivo: "envio_em_curso" });
      expect(chaveDoResultadoDaSimulacao(r)).toBe("nada_envio_em_curso");
      expect((await operacoes(x.reservaId)).filter((o) => o.modo === "simulacao")).toEqual([]);
    }
    // Uma criação real pendente, sem o POST tentado, não é incerteza: a simulação mostra o pedido.
    await db.update(beds24ReservasOperacoes).set({ enviadoEm: null }).where(eq(beds24ReservasOperacoes.organizacaoId, c.org));
    expect(await simularSemRede(admin, x.reservaId)).toMatchObject({ ok: true, tipo: "criar" });
    // O acompanhamento em envio também para a simulação.
    await db.delete(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.organizacaoId, c.org));
    await db.insert(beds24ReservasSite).values({ organizacaoId: c.org, reservaId: x.reservaId, imovelId: c.imovel, propertyId: "10", roomId: "20", referencia: x.reservaCodigo, situacao: "em_envio", versao: 1 });
    expect(await simularSemRede(admin, x.reservaId)).toEqual({ ok: false, motivo: "envio_em_curso" });
  });

  it("o mesmo estado simulado como criação e depois como atualização são duas intenções: a chave leva o tipo", async () => {
    const x = await pagarEConfirmar(c);
    const a = await simularSemRede(admin, x.reservaId);
    expect(a).toMatchObject({ ok: true, repetida: false, tipo: "criar" });
    // Criada no Beds24 em outro estado (3 pessoas) e a reserva voltou ao de antes (4): o mesmo estado e a mesma
    // assinatura, agora para atualizar. Não reaproveita a linha da criação.
    const esperado = { quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada" as const };
    const criadoCom = { ...esperado, hospedes: 3 };
    await db.update(reservas).set({ beds24Id: "98765" }).where(eq(reservas.id, x.reservaId));
    await db.insert(beds24ReservasSite).values({ organizacaoId: c.org, reservaId: x.reservaId, imovelId: c.imovel, propertyId: "10", roomId: "20", referencia: x.reservaCodigo, situacao: "conferida", versao: 1, esperado: criadoCom, assinaturaEsperada: assinaturaEsperado(criadoCom) });
    const b = await simularSemRede(admin, x.reservaId, env(), minutos(20));
    expect(b).toMatchObject({ ok: true, repetida: false, tipo: "atualizar", pedido: { quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4 } });
    expect(a.ok && b.ok && b.operacaoId !== a.operacaoId).toBe(true);
    const ops = await operacoes(x.reservaId);
    expect(ops.map((o) => [o.tipo, o.chave]).sort()).toEqual([
      ["atualizar", chaveSimulacaoBeds24(x.reservaId, "atualizar", assinaturaEsperado(esperado), a.ok ? a.operacaoId : null)],
      ["criar", chaveSimulacaoBeds24(x.reservaId, "criar", assinaturaEsperado(esperado), null)],
    ]);
    // De novo como atualização: aí sim é a mesma intenção.
    expect(await simularSemRede(admin, x.reservaId, env(), minutos(30))).toMatchObject({ ok: true, repetida: true, tipo: "atualizar" });
  });

  it("imóvel ligado (D6) antes da confirmação: simula com a ligação real; confirmada antes da ligação, nada (a equipe cuida à mão)", async () => {
    const x = await pagarEConfirmar(c);
    await gravarConfig(db, c.org, "reservas_beds24", { pausado: null, imoveis: [{ imovelId: c.imovel, ligadoEm: "2026-09-01T00:00:00.000Z", ligadoPor: null }], ensaio: null }, null);
    const r = await simularSemRede(admin, x.reservaId);
    expect(r).toMatchObject({ ok: true, imovelDesligado: null, tipo: "criar" });
    expect(chaveDoResultadoDaSimulacao(r)).toBe("simulada");
    await gravarConfig(db, c.org, "reservas_beds24", { pausado: null, imoveis: [{ imovelId: c.imovel, ligadoEm: "2026-10-05T00:00:00.000Z", ligadoPor: null }], ensaio: null }, null);
    await db.delete(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.organizacaoId, c.org));
    const depois = await simularSemRede(admin, x.reservaId);
    expect(depois).toEqual({ ok: false, motivo: "anterior_a_ligar" });
    expect(chaveDoResultadoDaSimulacao(depois)).toBe("nada_anterior_a_ligar");
    expect(await operacoes(x.reservaId)).toEqual([]);
  });

  it("imóvel desligado com o acompanhamento que já existe (sem id no Beds24): ligar agora faria a criação sair", async () => {
    const x = await pagarEConfirmar(c);
    await db.insert(beds24ReservasSite).values({ organizacaoId: c.org, reservaId: x.reservaId, imovelId: c.imovel, referencia: x.reservaCodigo, situacao: "pendente", motivo: "sem_vinculo", versao: 1 });
    const r = await simularSemRede(admin, x.reservaId);
    expect(r).toMatchObject({ ok: true, tipo: "criar", imovelDesligado: "espera_ligar" });
    expect(chaveDoResultadoDaSimulacao(r)).toBe("simulada_imovel_desligado");
  });

  it("cancelada pela política com reserva criada pelo sistema: o pedido de cancelamento, sem gravar a marca das OTAs nem mexer no acompanhamento", async () => {
    const x = await pagarEConfirmar(c);
    const equipe = await usuarioDeTeste(c, "Equipe Dois");
    const esperado = { quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada" as const };
    await db.update(reservas).set({ beds24Id: "98765" }).where(eq(reservas.id, x.reservaId));
    const [a] = await db
      .insert(beds24ReservasSite)
      .values({ organizacaoId: c.org, reservaId: x.reservaId, imovelId: c.imovel, propertyId: "10", roomId: "20", referencia: x.reservaCodigo, situacao: "conferida", versao: 1, esperado, assinaturaEsperada: assinaturaEsperado(esperado) })
      .returning();
    const canc = await cancelar(c, x.reservaId, entradaPadrao({ quemCancela: "empresa", motivoEmpresa: "forca_maior" }), equipe, minutos(59));
    expect(canc.resultado.ok).toBe(true);
    const r = await simularSemRede(admin, x.reservaId, env(), minutos(70));
    // O imóvel está desligado, mas o desligamento só para a criação: nenhum aviso de imóvel no cancelamento.
    expect(r).toMatchObject({ ok: true, tipo: "cancelar", imovelDesligado: null, pedido: { quarto: "20", situacao: "cancelada", referencia: x.reservaCodigo } });
    expect(chaveDoResultadoDaSimulacao(r)).toBe("simulada");
    const [cancelamento] = await db.select().from(cancelamentosReserva).where(eq(cancelamentosReserva.reservaId, x.reservaId));
    expect(cancelamento).toMatchObject({ situacao: "cancelada", otaLiberadaEm: null, otaLiberadaPor: null });
    const [depois] = await acompanhamentos();
    expect(depois).toEqual(a);
  });

  it("alteração segurada nunca entra (seção 10, teste 4): a principal fica sem mudança e a reserva-pedido é outra fonte; aplicada, vira atualizar", async () => {
    const x = await pagarEConfirmar(c, { liberar: true });
    await db.update(reservas).set({ beds24Id: "98765" }).where(eq(reservas.id, x.reservaId));
    const esperado = { quarto: "20", chegada: "2026-10-12", saida: "2026-10-15", hospedes: 4, situacao: "confirmada" as const };
    await db.insert(beds24ReservasSite).values({ organizacaoId: c.org, reservaId: x.reservaId, imovelId: c.imovel, propertyId: "10", roomId: "20", referencia: x.reservaCodigo, situacao: "conferida", versao: 1, esperado, assinaturaEsperada: assinaturaEsperado(esperado) });
    const { resultado } = await alterar(c, x.reservaId, { checkout: "2026-10-16" }, minutos(20));
    expect(resultado).toMatchObject({ ok: true, situacao: "segurada" });
    if (!resultado.ok || !("alteracaoId" in resultado)) throw new Error("alteração não segurada");
    expect(await simularSemRede(admin, x.reservaId, env(), minutos(21))).toEqual({ ok: false, motivo: "sem_mudanca" });
    const [portador] = await db.select().from(reservas).where(and(eq(reservas.organizacaoId, c.org), eq(reservas.fonte, "alteracao")));
    expect(portador).toMatchObject({ estado: "pedido" });
    expect(await simularSemRede(admin, portador.id, env(), minutos(21))).toEqual({ ok: false, motivo: "outra_fonte" });
    expect(await db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.organizacaoId, c.org))).toEqual([]);
    // O hóspede paga a diferença: a alteração é aplicada na reserva, e só então a régua manda atualizar.
    await pagarDiferenca(c, x.cotacaoId, resultado.alteracaoId, { quando: minutos(25) });
    expect(await alteracaoGravada(c, resultado.alteracaoId)).toMatchObject({ situacao: "aplicada" });
    expect(await simularSemRede(admin, x.reservaId, env(), minutos(30))).toMatchObject({ ok: true, tipo: "atualizar", imovelDesligado: null, pedido: { saida: "2026-10-16", situacao: "confirmada" } });
  });

  it("o que a régua não manda vira só o motivo, sem operação: pedido (hold), sem vínculo único, marketplace, outra fonte", async () => {
    const hold = await c.segurar({ entrada: "2026-11-02", saida: "2026-11-05", email: "outro.visitante@example.com" });
    expect(await simularSemRede(admin, hold.reservaId)).toEqual({ ok: false, motivo: "pedido" });
    const x = await pagarEConfirmar(c);
    await db.update(idsExternos).set({ detalhe: "" }).where(eq(idsExternos.organizacaoId, c.org));
    expect(await simularSemRede(admin, x.reservaId)).toEqual({ ok: false, motivo: "sem_vinculo" });
    await db.update(idsExternos).set({ detalhe: "20" }).where(eq(idsExternos.organizacaoId, c.org));
    await db.update(contratos).set({ tipo: "marketplace" }).where(eq(contratos.organizacaoId, c.org));
    expect(await simularSemRede(admin, x.reservaId)).toEqual({ ok: false, motivo: "marketplace" });
    await db.update(reservas).set({ fonte: "manual" }).where(eq(reservas.id, x.reservaId));
    expect(await simularSemRede(admin, x.reservaId)).toEqual({ ok: false, motivo: "outra_fonte" });
    expect(await simularSemRede(admin, crypto.randomUUID())).toEqual({ ok: false, motivo: "nao_encontrada" });
    expect(await db.select().from(beds24ReservasOperacoes).where(eq(beds24ReservasOperacoes.organizacaoId, c.org))).toEqual([]);
  });

  it("sem pagamento pelo site que confirmou (D3 e outros desfechos): nada, sem operação (a regra lida do banco, desfecho 'reserva')", async () => {
    // D3: o pedido do site confirmado à mão pela equipe, sem pagamento.
    const h = await c.segurar({}, minutos(1));
    expect((await confirmarReserva(db, c.org, h.reservaId, admin.usuarioId, minutos(2))).ok).toBe(true);
    expect((await c.reserva(h.reservaId)).estado).toBe("confirmada");
    expect(await simularSemRede(admin, h.reservaId)).toEqual({ ok: false, motivo: "sem_pagamento" });
    expect(await operacoes(h.reservaId)).toEqual([]);
    // Uma reserva do site cujo único pagamento tem outro desfecho (a diferença de uma alteração, uma devolução, por fora).
    const x = await pagarEConfirmar(c, { entrada: "2026-11-02", saida: "2026-11-05", email: "outro.visitante@example.com" });
    for (const desfecho of ["alteracao", "por_fora", "devolucao"] as const) {
      await db.update(pagamentos).set({ desfecho }).where(eq(pagamentos.reservaId, x.reservaId));
      expect(await simularSemRede(admin, x.reservaId)).toEqual({ ok: false, motivo: "sem_pagamento" });
    }
    expect(await operacoes(x.reservaId)).toEqual([]);
  });

  it("só fora do deploy de produção ou com a chave das reservas desligada", async () => {
    const x = await pagarEConfirmar(c);
    expect(await simularSemRede(admin, x.reservaId, env({ ...PRODUCAO, BEDS24_ESCRITA_RESERVAS: "ligada" }))).toEqual({ ok: false, motivo: "fora_do_ambiente" });
    expect(await operacoes(x.reservaId)).toEqual([]);
    // Produção com a chave desligada, ou a prévia com a chave ligada: pode simular (nada vai à rede em nenhum dos dois).
    expect(await simularSemRede(admin, x.reservaId, env(PRODUCAO))).toMatchObject({ ok: true });
    expect(await simularSemRede(admin, x.reservaId, env({ ...PRODUCAO, VERCEL_ENV: "preview", BEDS24_ESCRITA_RESERVAS: "ligada" }))).toMatchObject({ ok: true, repetida: true });
  });

  it("permissão: reserva:editar (a operação simula); sem ela, recusa antes de ler (deny-by-default)", async () => {
    const x = await pagarEConfirmar(c);
    const operacao: Sessao = { ...admin, papel: "operacao" };
    expect(await simularSemRede(operacao, x.reservaId)).toMatchObject({ ok: true });
    for (const papel of ["proprietario", "limpeza", "hospede"] as const) {
      await expect(simularReservaNoBeds24(db, { ...admin, papel, imovelIds: [c.imovel] }, x.reservaId, env(), minutos(10))).rejects.toBeInstanceOf(AcessoNegado);
    }
    // Outra organização: a reserva não é dela.
    expect(await simularSemRede({ ...admin, organizacaoId: crypto.randomUUID() }, x.reservaId)).toEqual({ ok: false, motivo: "nao_encontrada" });
    expect(await operacoes(x.reservaId)).toHaveLength(1);
  });
});
