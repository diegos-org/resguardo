import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REGRAS_CALENDARIO_PADRAO } from "@/calendario/regras-config";
import { gravarConfig } from "@/configuracoes/armazem";
import { beds24Calendario, bloqueios, cotacoes, idsExternos, imoveis, imoveisDetalhes, lancamentos, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { cancelarReserva, confirmarReserva } from "@/reservas/repositorio";
import { codigoCotacaoValido, criarCotacao, expirarHoldsVencidos, MAXIMO_COTACOES_ABERTAS_POR_IMOVEL, MAXIMO_HOLDS_POR_IMOVEL, motivoDaMudanca, segurarDatas, textoDaCotacao, validarContato, verCotacao } from "./cotacoes";
import { consultarDisponibilidade } from "./disponibilidade";

let db: Db, close: () => Promise<void>, org: string, im: string;
// 1/10/2026 (quinta), 12:00 em São Paulo.
const agora = new Date("2026-10-01T15:00:00Z");
const depois = (min: number) => new Date(agora.getTime() + min * 60_000);
const pedido = (over: Partial<{ imovel: string; entrada: string; saida: string; hospedes: string }> = {}) => ({ imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "4", ...over });
const contato = (over: Partial<{ nome: string; email: string; telefone: string }> = {}) => ({ nome: "Visitante Fictício", email: "Visitante@Example.com", telefone: "(21) 99999-0000", ...over });
const dias = (de: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${de}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
const cotar = async (over = {}, quando = agora) => {
  const r = await criarCotacao(db, org, pedido(over), quando);
  if (!r.ok) throw new Error(r.erro);
  return r.cotacao;
};
const minhasReservas = () => db.select().from(reservas).where(eq(reservas.organizacaoId, org));

beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio Exemplo", publico: true, capacidade: 4 }).returning();
  await db.insert(imoveisDetalhes).values({ imovelId: im, organizacaoId: org, precoBase: 45000, taxaLimpeza: 25000, hospedeExtraValor: 5000, hospedeExtraAPartirDe: 3, pisoUltimaHora1: 35000, pisoUltimaHora2: 30000 });
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
  // Leitura recente do Beds24 para outubro e novembro: tudo livre.
  await db.insert(beds24Calendario).values(dias("2026-10-01", 61).map((data) => ({ organizacaoId: org, imovelId: im, data, roomId: "20", livres: 1, preco: 45000, minimoNoites: 1, maximoNoites: 27, bloqueio: "none", observadoEm: new Date("2026-10-01T09:15:00Z") })));
});

describe("cotação do site (M8.1)", () => {
  it("grava o que o site mostrou, com código público; 'a confirmar' também cota; indisponível, sem valor e inválida recusam", async () => {
    const r = await criarCotacao(db, org, pedido(), agora);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cotacao).toMatchObject({ estado: "aberta", situacao: "disponivel", noites: 3, hospedes: 4, diarias: 135000, limpeza: 25000, hospedeExtra: 30000, total: 190000, checkin: "2026-10-12", checkout: "2026-10-15", reservaId: null, holdAte: null });
    expect(codigoCotacaoValido(r.cotacao.codigo)).toBe(true);
    expect(r.cotacao.leituraEm?.toISOString()).toBe("2026-10-01T09:15:00.000Z");
    const v = await verCotacao(db, org, r.cotacao.codigo, agora);
    expect(v).toMatchObject({ estado: "aberta", mudou: false, reserva: null, cotacao: { imovelCodigo: "403", imovelNome: "Studio Exemplo", fuso: "America/Sao_Paulo" } });
    expect(v?.atual?.situacao).toBe("disponivel");
    expect(textoDaCotacao(v!)).toContain("R$ 1.900,00 por 3 noites");
    // Sem leitura do Beds24 nas datas: "a confirmar", mas com valor — pode ser cotada.
    const ac = await criarCotacao(db, org, pedido({ entrada: "2026-12-10", saida: "2026-12-12" }), agora);
    expect(ac.ok && ac.cotacao.situacao).toBe("a_confirmar");
    // Indisponível (bloqueio no meio), sem valor completo (limpeza não cadastrada) e inválida.
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: im, inicio: "2026-10-20", fim: "2026-10-21", motivo: "" });
    expect(await criarCotacao(db, org, pedido({ entrada: "2026-10-19", saida: "2026-10-22" }), agora)).toMatchObject({ ok: false, erro: "Essas datas não estão disponíveis." });
    await db.update(imoveisDetalhes).set({ taxaLimpeza: null }).where(eq(imoveisDetalhes.imovelId, im));
    expect(await criarCotacao(db, org, pedido(), agora)).toMatchObject({ ok: false, erro: expect.stringContaining("confirmado pela equipe") });
    expect(await criarCotacao(db, org, pedido({ hospedes: "9" }), agora)).toMatchObject({ ok: false, erro: "Confira os dados da consulta." });
    expect(await verCotacao(db, org, "COT-NAOEXISTE", agora)).toBeNull();
    expect(await verCotacao(db, org, "COT-ABCDEFGH", agora)).toBeNull();
  });

  it("repetir a mesma consulta reaproveita a cotação aberta; há teto de cotações abertas por imóvel; as antigas sem pedido são apagadas", async () => {
    const a = await cotar();
    const b = await cotar();
    expect(b.id).toBe(a.id);
    const c = await cotar({ hospedes: "2" }); // valores diferentes: outra cotação
    expect(c.id).not.toBe(a.id);
    expect(await db.select().from(cotacoes).where(eq(cotacoes.organizacaoId, org))).toHaveLength(2);
    // Teto: muitas cotações abertas nas últimas 24 h → recusa com aviso (as já abertas continuam valendo).
    await db.insert(cotacoes).values(
      Array.from({ length: MAXIMO_COTACOES_ABERTAS_POR_IMOVEL }, (_, i) => ({
        organizacaoId: org, imovelId: im, codigo: `COT-TESTE${String(i).padStart(3, "0")}`, estado: "aberta", checkin: "2026-11-01", checkout: "2026-11-02", hospedes: 1, noites: 1, situacao: "disponivel", diarias: 1, limpeza: 0, hospedeExtra: 0, total: 1, criadaEm: agora, atualizadaEm: agora,
      })),
    );
    expect(await criarCotacao(db, org, pedido({ hospedes: "3" }), agora)).toMatchObject({ ok: false, erro: expect.stringContaining("muitas consultas") });
    expect((await criarCotacao(db, org, pedido(), agora))).toMatchObject({ ok: true, cotacao: { id: a.id } }); // a repetida ainda é reaproveitada
    // Limpeza da rotina: aberta/desatualizada sem pedido com mais de 30 dias somem; recentes e com pedido ficam.
    await db.insert(cotacoes).values([
      { organizacaoId: org, imovelId: im, codigo: "COT-VELHA001", estado: "aberta", checkin: "2026-11-01", checkout: "2026-11-02", hospedes: 1, noites: 1, situacao: "disponivel", diarias: 1, limpeza: 0, hospedeExtra: 0, total: 1, criadaEm: new Date(agora.getTime() - 40 * 86_400_000), atualizadaEm: agora },
      { organizacaoId: org, imovelId: im, codigo: "COT-VELHA002", estado: "desatualizada", checkin: "2026-11-01", checkout: "2026-11-02", hospedes: 1, noites: 1, situacao: "disponivel", diarias: 1, limpeza: 0, hospedeExtra: 0, total: 1, criadaEm: new Date(agora.getTime() - 40 * 86_400_000), atualizadaEm: agora },
    ]);
    expect(await expirarHoldsVencidos(db, org, agora)).toEqual({ expiradas: 0, convertidas: 0, canceladas: 0, removidas: 2 });
    expect(await db.select().from(cotacoes).where(eq(cotacoes.organizacaoId, org))).toHaveLength(2 + MAXIMO_COTACOES_ABERTAS_POR_IMOVEL);
  });

  it("reaproveitar exige a mesma situação; o teto vale mesmo com pedidos simultâneos", async () => {
    const a = await cotar();
    expect(a.situacao).toBe("disponivel");
    // Leitura de uma noite some: mesma estadia e valor, mas "a confirmar" → cotação nova, não a antiga.
    await db.delete(beds24Calendario).where(eq(beds24Calendario.data, "2026-10-13"));
    const b = await cotar();
    expect(b.id).not.toBe(a.id);
    expect(b.situacao).toBe("a_confirmar");
    expect((await cotar()).id).toBe(b.id);
    // Falta uma vaga para o teto: três consultas distintas ao mesmo tempo → só uma entra.
    await db.insert(cotacoes).values(
      Array.from({ length: MAXIMO_COTACOES_ABERTAS_POR_IMOVEL - 3 }, (_, i) => ({
        organizacaoId: org, imovelId: im, codigo: `COT-SIMUL${String(i).padStart(3, "0")}`, estado: "aberta", checkin: "2026-11-01", checkout: "2026-11-02", hospedes: 1, noites: 1, situacao: "disponivel", diarias: 1, limpeza: 0, hospedeExtra: 0, total: 1, criadaEm: agora, atualizadaEm: agora,
      })),
    );
    const r = await Promise.all([criarCotacao(db, org, pedido({ hospedes: "1" }), agora), criarCotacao(db, org, pedido({ hospedes: "2" }), agora), criarCotacao(db, org, pedido({ hospedes: "3" }), agora)]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.filter((x) => !x.ok).map((x) => !x.ok && x.erro)).toEqual([expect.stringContaining("muitas consultas"), expect.stringContaining("muitas consultas")]);
    expect((await db.select().from(cotacoes).where(and(eq(cotacoes.organizacaoId, org), eq(cotacoes.estado, "aberta"))))).toHaveLength(MAXIMO_COTACOES_ABERTAS_POR_IMOVEL);
  });

  it("segurar: cria o pedido do site com o contato, ocupa as noites, revalida a outra cotação e não repete", async () => {
    const c1 = await cotar();
    const c2 = await cotar({ hospedes: "3" }); // outro visitante, mesma estadia (valores diferentes: outra cotação)
    const h = await segurarDatas(db, org, c1.codigo, contato(), agora);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.holdAte.toISOString()).toBe(depois(30).toISOString());
    expect(h.reservaCodigo).toMatch(/^SCL-/);
    const [r] = await minhasReservas();
    expect(r).toMatchObject({ estado: "pedido", origem: "site", fonte: "site", idFonte: c1.id, checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 4, hospedeNome: "Visitante Fictício", hospedeEmail: "visitante@example.com", hospedeTelefone: "(21) 99999-0000", valorBruto: 190000, taxaCanal: null, codigoCanal: c1.codigo });
    expect(r.observacoes).toContain(c1.codigo);
    // Pedido não entra no financeiro.
    expect(await db.select().from(lancamentos).where(eq(lancamentos.organizacaoId, org))).toEqual([]);
    // As noites ficam ocupadas para o site…
    expect(await consultarDisponibilidade(db, org, pedido(), agora)).toMatchObject({ situacao: "indisponivel", motivos: ["Essas datas já estão reservadas."] });
    // …e o segundo visitante não segura a dele: a cotação fica desatualizada, nada é gravado.
    expect(await segurarDatas(db, org, c2.codigo, contato({ email: "outro@example.com" }), agora)).toMatchObject({ ok: false, erro: "Essas datas acabaram de ficar indisponíveis.", estado: "desatualizada" });
    expect((await verCotacao(db, org, c2.codigo, agora))?.estado).toBe("desatualizada");
    // Repetir na mesma cotação não cria outro pedido.
    expect(await segurarDatas(db, org, c1.codigo, contato(), agora)).toMatchObject({ ok: false, erro: expect.stringContaining("já estão seguradas") });
    expect(await minhasReservas()).toHaveLength(1);
    const v = await verCotacao(db, org, c1.codigo, agora);
    expect(v).toMatchObject({ estado: "segurada", atual: null, reserva: { codigo: h.reservaCodigo, estado: "pedido" } });
    expect(textoDaCotacao(v!)).toContain("seguradas para mim até 01/10, 12:30"); // 30 min depois de 12:00 em São Paulo
    // Contato inválido e cotação inexistente.
    expect(await segurarDatas(db, org, c1.codigo, { nome: "A", email: "x", telefone: "1" }, agora)).toMatchObject({ ok: false, erros: { nome: expect.any(String), email: expect.any(String), telefone: expect.any(String) } });
    expect(await segurarDatas(db, org, "COT-ABCDEFGH", contato(), agora)).toMatchObject({ ok: false, erro: "Cotação não encontrada." });
    expect(validarContato({ nome: "Ana Fictícia", email: "ANA@example.com", telefone: "+55 21 98888-7777" })).toEqual({ ok: true, dados: { nome: "Ana Fictícia", email: "ana@example.com", telefone: "+55 21 98888-7777" } });
  });

  it("prazo vencido: a rotina cancela o pedido e as noites voltam; confirmado pela equipe vira reserva; cancelado pela equipe fecha a cotação", async () => {
    const c = await cotar();
    const h = await segurarDatas(db, org, c.codigo, contato(), agora);
    if (!h.ok) throw new Error(h.erro);
    // Antes da rotina, a página já mostra o vencimento.
    expect((await verCotacao(db, org, c.codigo, depois(29)))?.estado).toBe("segurada");
    expect((await verCotacao(db, org, c.codigo, depois(31)))?.estado).toBe("expirada");
    expect(await expirarHoldsVencidos(db, org, depois(29))).toEqual({ expiradas: 0, convertidas: 0, canceladas: 0, removidas: 0 });
    // Sem empresa (rotina): cobre todas — inclusive holds de outros testes neste banco compartilhado.
    expect((await expirarHoldsVencidos(db, null, depois(31))).expiradas).toBeGreaterThanOrEqual(1);
    expect(await expirarHoldsVencidos(db, org, depois(31))).toEqual({ expiradas: 0, convertidas: 0, canceladas: 0, removidas: 0 });
    expect((await db.select().from(reservas).where(eq(reservas.id, h.cotacao.reservaId!)))[0].estado).toBe("cancelada");
    expect(await verCotacao(db, org, c.codigo, depois(31))).toMatchObject({ estado: "expirada", atual: null });
    expect((await consultarDisponibilidade(db, org, pedido(), depois(31))).situacao).toBe("disponivel");
    expect(await segurarDatas(db, org, c.codigo, contato(), depois(31))).toMatchObject({ ok: false, erro: expect.stringContaining("tempo desta cotação acabou"), estado: "expirada" });
    // Equipe confirma o pedido no prazo: reserva confirmada, cotação convertida; a rotina não mexe mais.
    const c2 = await cotar({}, depois(40));
    const h2 = await segurarDatas(db, org, c2.codigo, contato(), depois(40));
    if (!h2.ok) throw new Error(h2.erro);
    expect(await confirmarReserva(db, org, h2.cotacao.reservaId!, null, depois(41))).toEqual({ ok: true });
    expect(await verCotacao(db, org, c2.codigo, depois(41))).toMatchObject({ estado: "convertida", reserva: { estado: "confirmada" } });
    expect(await expirarHoldsVencidos(db, org, depois(41))).toEqual({ expiradas: 0, convertidas: 1, canceladas: 0, removidas: 0 });
    expect((await db.select().from(cotacoes).where(eq(cotacoes.id, c2.id)))[0].estado).toBe("convertida");
    expect(await expirarHoldsVencidos(db, org, depois(200))).toEqual({ expiradas: 0, convertidas: 0, canceladas: 0, removidas: 0 });
    expect((await db.select().from(reservas).where(eq(reservas.id, h2.cotacao.reservaId!)))[0].estado).toBe("confirmada");
    // Equipe cancela o pedido: cotação cancelada, noites livres.
    const c3 = await cotar({ entrada: "2026-11-02", saida: "2026-11-04" }, depois(50));
    const h3 = await segurarDatas(db, org, c3.codigo, contato({ email: "c3@example.com" }), depois(50));
    if (!h3.ok) throw new Error(h3.erro);
    expect(await cancelarReserva(db, org, h3.cotacao.reservaId!, null)).toBe(true);
    expect((await verCotacao(db, org, c3.codigo, depois(51)))?.estado).toBe("cancelada");
    expect(await expirarHoldsVencidos(db, org, depois(51))).toEqual({ expiradas: 0, convertidas: 0, canceladas: 1, removidas: 0 });
    expect((await consultarDisponibilidade(db, org, pedido({ entrada: "2026-11-02", saida: "2026-11-04" }), depois(51))).situacao).toBe("disponivel");
  });

  it("freios: um pedido em andamento por e-mail e no máximo cinco por imóvel; prazo configurável no painel", async () => {
    await db.transaction((tx) => gravarConfig(tx, org, "calendario_regras", { ...REGRAS_CALENDARIO_PADRAO, site: { ...REGRAS_CALENDARIO_PADRAO.site, minutosHold: 5 } }, null));
    const c = await cotar();
    const h = await segurarDatas(db, org, c.codigo, contato(), agora);
    expect(h.ok && h.holdAte.toISOString()).toBe(depois(5).toISOString());
    const outra = await cotar({ entrada: "2026-10-20", saida: "2026-10-22" });
    expect(await segurarDatas(db, org, outra.codigo, contato(), agora)).toMatchObject({ ok: false, erro: expect.stringContaining("este e-mail") });
    // Passado o prazo, o mesmo e-mail pode segurar de novo (o pedido anterior venceu ao tentar).
    expect((await segurarDatas(db, org, outra.codigo, contato(), depois(6))).ok).toBe(true);
    expect((await db.select().from(cotacoes).where(eq(cotacoes.id, c.id)))[0].estado).toBe("expirada");
    // Máximo por imóvel: com um em andamento, cabem mais quatro; o sexto é recusado.
    for (let i = 0; i < 4; i++) {
      const ci = await cotar({ entrada: `2026-11-${String(2 + i * 3).padStart(2, "0")}`, saida: `2026-11-${String(4 + i * 3).padStart(2, "0")}` }, depois(6));
      expect((await segurarDatas(db, org, ci.codigo, contato({ email: `v${i}@example.com` }), depois(6))).ok).toBe(true);
    }
    const sexta = await cotar({ entrada: "2026-11-20", saida: "2026-11-22" }, depois(6));
    expect(await segurarDatas(db, org, sexta.codigo, contato({ email: "v9@example.com" }), depois(6))).toMatchObject({ ok: false, erro: expect.stringContaining("muitas reservas em andamento") });
    expect(MAXIMO_HOLDS_POR_IMOVEL).toBe(5);
    expect((await minhasReservas()).filter((r) => r.estado === "pedido")).toHaveLength(5);
  });

  it("leitura do Beds24 que vence ou some muda a situação e, portanto, a cotação: a página avisa e segurar recusa", async () => {
    const c = await cotar();
    expect(c.situacao).toBe("disponivel");
    // Leitura das noites some: mesma estadia, mesmo valor, mas agora "a confirmar".
    await db.delete(beds24Calendario).where(eq(beds24Calendario.data, "2026-10-13"));
    const v = await verCotacao(db, org, c.codigo, agora);
    expect(v).toMatchObject({ estado: "aberta", mudou: true });
    expect(v?.atual?.situacao).toBe("a_confirmar");
    expect(v?.atual?.cotacao?.total).toBe(190000);
    expect(motivoDaMudanca(c, v!.atual!)).toContain("precisa ser confirmada pela equipe");
    expect(await segurarDatas(db, org, c.codigo, contato(), agora)).toMatchObject({ ok: false, erro: expect.stringContaining("precisa ser confirmada pela equipe"), estado: "desatualizada" });
    expect(await minhasReservas()).toEqual([]);
    // O contrário também: cotada "a confirmar", a leitura chega e fica disponível → mudou.
    const ac = await cotar({ entrada: "2026-12-10", saida: "2026-12-12" });
    expect(ac.situacao).toBe("a_confirmar");
    await db.insert(beds24Calendario).values(dias("2026-12-10", 3).map((data) => ({ organizacaoId: org, imovelId: im, data, roomId: "20", livres: 1, preco: 45000, minimoNoites: 1, maximoNoites: 27, bloqueio: "none", observadoEm: agora })));
    expect((await verCotacao(db, org, ac.codigo, agora))?.mudou).toBe(true);
    expect(motivoDaMudanca(ac, (await verCotacao(db, org, ac.codigo, agora))!.atual!)).toContain("foi confirmada desde a cotação");
    // Segurar uma cotação segurada e vencida (antes da rotina) diz que o tempo acabou, sem mexer no pedido dela.
    const c3 = await cotar({ entrada: "2026-11-02", saida: "2026-11-04" });
    const h3 = await segurarDatas(db, org, c3.codigo, contato(), agora);
    if (!h3.ok) throw new Error(h3.erro);
    expect(await segurarDatas(db, org, c3.codigo, contato(), depois(31))).toMatchObject({ ok: false, erro: expect.stringContaining("tempo desta cotação acabou"), estado: "expirada" });
    expect((await db.select().from(cotacoes).where(eq(cotacoes.id, c3.id)))[0].estado).toBe("segurada");
  });

  it("a equipe não confirma um pedido do site vencido antes da rotina: ele vence na hora e as datas voltam", async () => {
    const c = await cotar();
    const h = await segurarDatas(db, org, c.codigo, contato(), agora);
    if (!h.ok) throw new Error(h.erro);
    // Prazo venceu há um minuto (a rotina de 10 min ainda não passou).
    expect(await confirmarReserva(db, org, h.cotacao.reservaId!, null, depois(31))).toMatchObject({ ok: false, aviso: expect.stringContaining("prazo deste pedido do site já passou") });
    expect((await db.select().from(reservas).where(eq(reservas.id, h.cotacao.reservaId!)))[0].estado).toBe("cancelada");
    expect((await db.select().from(cotacoes).where(eq(cotacoes.id, c.id)))[0].estado).toBe("expirada");
    expect((await consultarDisponibilidade(db, org, pedido(), agora)).situacao).toBe("disponivel");
    // Dentro do prazo, confirma normalmente.
    const c2 = await cotar();
    const h2 = await segurarDatas(db, org, c2.codigo, contato(), agora);
    if (!h2.ok) throw new Error(h2.erro);
    expect(await confirmarReserva(db, org, h2.cotacao.reservaId!, null, depois(29))).toEqual({ ok: true });
  });

  it("o mesmo e-mail em dois imóveis ao mesmo tempo: só um pedido fica em andamento", async () => {
    const [{ id: im2 }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "303", nome: "Outro Exemplo", publico: true, capacidade: 4 }).returning();
    await db.insert(imoveisDetalhes).values({ imovelId: im2, organizacaoId: org, precoBase: 40000, taxaLimpeza: 20000, hospedeExtraValor: 0, hospedeExtraAPartirDe: 3 });
    await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im2, canal: "beds24", idExterno: "10", detalhe: "21" });
    await db.insert(beds24Calendario).values(dias("2026-10-01", 61).map((data) => ({ organizacaoId: org, imovelId: im2, data, roomId: "21", livres: 1, preco: 40000, minimoNoites: 1, maximoNoites: 27, bloqueio: "none", observadoEm: new Date("2026-10-01T09:15:00Z") })));
    const [a, b] = await Promise.all([cotar(), cotar({ imovel: "303" })]);
    const [ra, rb] = await Promise.all([segurarDatas(db, org, a.codigo, contato(), agora), segurarDatas(db, org, b.codigo, contato(), agora)]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    expect([ra, rb].find((r) => !r.ok)).toMatchObject({ erro: expect.stringContaining("este e-mail") });
  });

  it("dois visitantes nas mesmas noites ao mesmo tempo: só um segura", async () => {
    const [a, b] = await Promise.all([cotar(), cotar({ hospedes: "3" })]);
    const [ra, rb] = await Promise.all([segurarDatas(db, org, a.codigo, contato({ email: "a@example.com" }), agora), segurarDatas(db, org, b.codigo, contato({ email: "b@example.com" }), agora)]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    expect((await minhasReservas()).filter((r) => r.estado === "pedido")).toHaveLength(1);
    expect([ra, rb].find((r) => !r.ok)).toMatchObject({ erro: "Essas datas acabaram de ficar indisponíveis." });
  });
});
