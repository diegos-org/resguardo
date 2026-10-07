import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PESOS_PADRAO_ANTIGO, PRECOS_MARKETPLACE_PADRAO } from "@/marketplace/precos";
import { salvarPrecosMarketplace } from "@/marketplace/precos-config";
import { eq } from "drizzle-orm";
import { gravarConfig } from "@/configuracoes/armazem";
import { REGRAS_CALENDARIO_PADRAO } from "@/calendario/regras-config";
import { beds24Calendario, beds24CalendarioEnviado, bloqueios, idsExternos, imoveis, imoveisDetalhes, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { consultarDisponibilidade } from "./disponibilidade";

let db: Db, close: () => Promise<void>, org: string, im: string;
// 1/10/2026 (quinta), 12:00 em São Paulo.
const agora = new Date("2026-10-01T15:00:00Z");
const pedido = (over: Partial<{ imovel: string; entrada: string; saida: string; hospedes: string }> = {}) => ({ imovel: "403", entrada: "2026-10-12", saida: "2026-10-15", hospedes: "2", ...over });
const consultar = (over = {}) => consultarDisponibilidade(db, org, pedido(over), agora);
const observar = (datas: string[], over: Partial<typeof beds24Calendario.$inferInsert> = {}) =>
  db.insert(beds24Calendario).values(datas.map((data) => ({ organizacaoId: org, imovelId: im, data, roomId: "20", livres: 1, preco: 45000, minimoNoites: 1, maximoNoites: 27, bloqueio: "none", observadoEm: new Date("2026-10-01T09:15:00Z"), ...over })));
const dias = (de: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${de}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio Exemplo", publico: true, capacidade: 4 }).returning();
  await db.insert(imoveis).values({ organizacaoId: org, codigo: "buzios", nome: "Casa", publico: false, capacidade: 8 });
  await db.insert(imoveisDetalhes).values({ imovelId: im, organizacaoId: org, precoBase: 45000, taxaLimpeza: 25000, hospedeExtraValor: 5000, hospedeExtraAPartirDe: 3, pisoUltimaHora1: 35000, pisoUltimaHora2: 30000 });
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
  // Os valores destes testes são com os pesos em partes iguais (1/1/1), gravados como numa organização que já salvou
  // a configuração; o padrão 6/3/3 (M12.5) é testado em marketplace/precos.test.ts.
  await salvarPrecosMarketplace(db, org, { ...PRECOS_MARKETPLACE_PADRAO, pesos: { ...PESOS_PADRAO_ANTIGO } }, null);
});

describe("disponibilidade e cotação do site (M7.2)", () => {
  it("disponível com leitura recente (noites e dia de saída) e sem ocupação: valor pelas noites do motor mais limpeza e hóspede extra", async () => {
    await observar(dias("2026-10-12", 4));
    const r = await consultar({ hospedes: "4" });
    expect(r).toMatchObject({ situacao: "disponivel", motivos: [], noites: 3, cotacao: { diarias: 135000, limpeza: 25000, hospedeExtra: 30000, valorCheio: 190000, desconto: 7600, total: 182400 } });
    expect(r.leituraEm?.toISOString()).toBe("2026-10-01T09:15:00.000Z");
    // A hora mostrada é a leitura mais antiga usada na decisão: o dia de saída também conta.
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-09-30T20:00:00Z") }).where(eq(beds24Calendario.data, "2026-10-15"));
    const comSaidaAntiga = await consultar({ hospedes: "4" });
    expect(comSaidaAntiga.situacao).toBe("disponivel");
    expect(comSaidaAntiga.leituraEm?.toISOString()).toBe("2026-09-30T20:00:00.000Z");
    // Sem leitura do dia de saída não há hora a mostrar, como quando falta a de uma noite.
    await db.delete(beds24Calendario).where(eq(beds24Calendario.data, "2026-10-15"));
    expect(await consultar({ hospedes: "4" })).toMatchObject({ situacao: "a_confirmar", leituraEm: null });
  });

  it("última hora entra no valor (D−2: 25%, piso respeitado) e eventos também, como no envio ao Beds24", async () => {
    await observar(dias("2026-10-01", 11));
    // Quinta 1/10 (hoje, D0): 25% sobre 450 = 337,50 (piso 300 respeitado); sábado exige 2 noites.
    expect(await consultar({ entrada: "2026-10-01", saida: "2026-10-02" })).toMatchObject({ situacao: "disponivel", cotacao: { diarias: 33750, valorCheio: 58750, desconto: 2350, total: 56400 } });
    expect(await consultar({ entrada: "2026-10-03", saida: "2026-10-04" })).toMatchObject({ situacao: "indisponivel", motivos: ["Para entrada em 03/10/2026, o mínimo é de 2 noites."] });
    await db.transaction((tx) => gravarConfig(tx, org, "calendario_regras", { ...REGRAS_CALENDARIO_PADRAO, eventos: [{ id: im, nome: "Evento", inicio: "2026-10-09", fim: "2026-10-10", multiplicador: 300, estadiaMinima: 2, todosImoveis: true, imoveis: [] }] }, null));
    expect(await consultar({ entrada: "2026-10-09", saida: "2026-10-11" })).toMatchObject({ situacao: "disponivel", cotacao: { diarias: 270000, valorCheio: 295000, desconto: 11800, total: 283200 } });
    const curta = await consultar({ entrada: "2026-10-09", saida: "2026-10-10" });
    expect(curta).toMatchObject({ situacao: "indisponivel", motivos: ["Para entrada em 09/10/2026, o mínimo é de 2 noites."], cotacao: null });
  });

  it("reserva, bloqueio do SCL ou 0 unidades no Beds24 tornam as datas indisponíveis, sem expor quem reservou", async () => {
    await observar(dias("2026-10-12", 3));
    await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-TESTE2", origem: "airbnb", estado: "confirmada", checkin: "2026-10-13", checkout: "2026-10-14", hospedeNome: "Hóspede Fictício", hospedeEmail: "fake@example.com", fonte: "manual", idFonte: "" });
    const r = await consultar();
    expect(r).toMatchObject({ situacao: "indisponivel", motivos: ["Há noites já reservadas nessas datas (13/10/2026)."], cotacao: null });
    expect(JSON.stringify(r)).not.toMatch(/Fictício|fake@/);
    await db.delete(reservas);
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: im, inicio: "2026-10-12", fim: "2026-10-15", motivo: "Uso próprio" });
    expect(await consultar()).toMatchObject({ situacao: "indisponivel", motivos: ["Essas datas já estão reservadas."] });
    await db.delete(bloqueios);
    await db.update(beds24Calendario).set({ livres: 0 });
    expect(await consultar()).toMatchObject({ situacao: "indisponivel", motivos: ["Essas datas já estão reservadas."] });
    await db.update(beds24Calendario).set({ livres: 1, bloqueio: "blackout" });
    expect((await consultar()).situacao).toBe("indisponivel");
  });

  it("data ocupada no SCL e no Beds24 ao mesmo tempo conta uma vez: só as noites realmente tomadas aparecem", async () => {
    await observar(dias("2026-10-12", 4));
    // Reserva importada: existe no SCL e o Beds24 mostra 0 unidades na mesma noite (13/10).
    await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-TESTE3", origem: "airbnb", estado: "confirmada", checkin: "2026-10-13", checkout: "2026-10-14", hospedeNome: "Hóspede Fictício", hospedeEmail: "fake@example.com", fonte: "beds24", idFonte: "999" });
    await db.update(beds24Calendario).set({ livres: 0 }).where(eq(beds24Calendario.data, "2026-10-13"));
    // Duas noites (12 e 13), uma ocupada: não pode virar "essas datas já estão reservadas".
    expect(await consultar({ saida: "2026-10-14" })).toMatchObject({ situacao: "indisponivel", motivos: ["Há noites já reservadas nessas datas (13/10/2026)."] });
    // Quatro noites, uma ocupada em dobro: a lista não repete a data nem ganha reticências.
    expect(await consultar({ saida: "2026-10-16" })).toMatchObject({ situacao: "indisponivel", motivos: ["Há noites já reservadas nessas datas (13/10/2026)."] });
  });

  it("restrições de entrada/saída do Beds24 valem nas datas certas; restrição desconhecida fica a confirmar", async () => {
    await observar(dias("2026-10-12", 4));
    await db.update(beds24Calendario).set({ bloqueio: "noCheckIn" }).where(eq(beds24Calendario.data, "2026-10-13"));
    // noCheckIn numa noite intermediária não impede a estadia de 12 a 15.
    expect((await consultar()).situacao).toBe("disponivel");
    expect(await consultar({ entrada: "2026-10-13", saida: "2026-10-15" })).toMatchObject({ situacao: "indisponivel", motivos: ["Entrada não permitida em 13/10/2026."] });
    await db.update(beds24Calendario).set({ bloqueio: "noCheckOut" }).where(eq(beds24Calendario.data, "2026-10-15"));
    expect(await consultar()).toMatchObject({ situacao: "indisponivel", motivos: ["Saída não permitida em 15/10/2026."] });
    expect((await consultar({ saida: "2026-10-14" })).situacao).toBe("disponivel");
    await db.update(beds24Calendario).set({ bloqueio: "noCheckInOrCheckOut" }).where(eq(beds24Calendario.data, "2026-10-12"));
    expect((await consultar()).motivos).toContain("Entrada não permitida em 12/10/2026.");
    await db.update(beds24Calendario).set({ bloqueio: "exception" }).where(eq(beds24Calendario.data, "2026-10-13"));
    expect(await consultar({ entrada: "2026-10-13", saida: "2026-10-14" })).toMatchObject({ situacao: "a_confirmar" });
    // Dia de saída: restrição desconhecida fica a confirmar; blackout no dia de saída não impede sair.
    await db.update(beds24Calendario).set({ bloqueio: "exception" }).where(eq(beds24Calendario.data, "2026-10-15"));
    expect(await consultar({ entrada: "2026-10-14", saida: "2026-10-15" })).toMatchObject({ situacao: "a_confirmar", motivos: ["Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa."] });
    await db.update(beds24Calendario).set({ bloqueio: "blackout", livres: 0 }).where(eq(beds24Calendario.data, "2026-10-15"));
    expect((await consultar({ entrada: "2026-10-14", saida: "2026-10-15" })).situacao).toBe("disponivel");
    // Sem leitura do dia de saída: a confirmar, nunca disponível.
    await db.update(beds24Calendario).set({ bloqueio: "none", livres: 1 }).where(eq(beds24Calendario.data, "2026-10-15"));
    expect(await consultar({ entrada: "2026-10-14", saida: "2026-10-16" })).toMatchObject({ situacao: "a_confirmar", motivos: ["Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa."] });
  });

  it("leitura anterior ao último envio do SCL não vale (numa noite ou no dia de saída): a confirmar até uma leitura posterior à escrita", async () => {
    await observar(dias("2026-10-12", 4));
    const enviado = (data: string, enviadoEm: string) => db.insert(beds24CalendarioEnviado).values({ organizacaoId: org, imovelId: im, data, roomId: "20", preco: null, minimo: null, maximo: 27, bloqueio: null, enviadoEm: new Date(enviadoEm), confirmado: false });
    // Escrita do SCL em 13/10 depois da leitura (releitura falhou): a leitura guardada ainda mostra "aberto", mas já não descreve o Beds24.
    await enviado("2026-10-13", "2026-10-01T10:00:00Z");
    expect(await consultar()).toMatchObject({ situacao: "a_confirmar", motivos: ["Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa."], cotacao: { valorCheio: 160000, desconto: 6400, total: 153600 } });
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-10-01T10:00:00Z") }).where(eq(beds24Calendario.data, "2026-10-13"));
    expect((await consultar()).situacao).toBe("disponivel");
    // O mesmo no dia de saída: a restrição de saída só vale com leitura posterior à escrita.
    await enviado("2026-10-15", "2026-10-01T11:00:00Z");
    expect((await consultar()).situacao).toBe("a_confirmar");
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-10-01T11:00:00Z") }).where(eq(beds24Calendario.data, "2026-10-15"));
    expect((await consultar()).situacao).toBe("disponivel");
    // Estado enviado a outro quarto Beds24 não conta: o vínculo atual é o quarto 20.
    await db.update(beds24CalendarioEnviado).set({ roomId: "21", enviadoEm: new Date("2026-10-01T12:00:00Z") }).where(eq(beds24CalendarioEnviado.data, "2026-10-13"));
    expect((await consultar()).situacao).toBe("disponivel");
  });

  it("imóvel sem capacidade cadastrada nunca fica disponível: a confirmar, com o valor", async () => {
    await observar(dias("2026-10-12", 4));
    await db.update(imoveis).set({ capacidade: null }).where(eq(imoveis.id, im));
    expect(await consultar({ hospedes: "6" })).toMatchObject({ situacao: "a_confirmar", motivos: [expect.stringContaining("capacidade deste apartamento ainda não foi cadastrada")], cotacao: { hospedeExtra: 60000, valorCheio: 220000, desconto: 8800, total: 211200 } });
    await db.update(imoveis).set({ capacidade: 4 }).where(eq(imoveis.id, im));
    expect(await consultar({ hospedes: "6" })).toMatchObject({ situacao: "invalida", motivos: ["Este apartamento recebe até 4 pessoas."] });
  });

  it("leitura de outro quarto Beds24 (vínculo trocado ou removido) não vale: a confirmar, sem hora de leitura", async () => {
    await observar(dias("2026-10-12", 4), { roomId: "21" });
    expect(await consultar()).toMatchObject({ situacao: "a_confirmar", motivos: ["Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa."], cotacao: { valorCheio: 160000, desconto: 6400, total: 153600 }, leituraEm: null });
    await db.update(beds24Calendario).set({ roomId: "20" });
    expect((await consultar()).situacao).toBe("disponivel");
    // Sem vínculo Beds24, nenhuma leitura descreve o imóvel.
    await db.delete(idsExternos).where(eq(idsExternos.imovelId, im));
    expect(await consultar()).toMatchObject({ situacao: "a_confirmar", leituraEm: null });
  });

  it("restrição de entrada/saída com leitura vencida não bloqueia: vira a confirmar", async () => {
    await observar(dias("2026-10-12", 4), { observadoEm: new Date("2026-09-20T09:00:00Z") });
    await db.update(beds24Calendario).set({ bloqueio: "noCheckIn" }).where(eq(beds24Calendario.data, "2026-10-12"));
    await db.update(beds24Calendario).set({ bloqueio: "noCheckOut" }).where(eq(beds24Calendario.data, "2026-10-15"));
    expect(await consultar()).toMatchObject({ situacao: "a_confirmar", cotacao: { valorCheio: 160000, desconto: 6400, total: 153600 } });
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-10-01T09:15:00Z") });
    const r = await consultar();
    expect(r.situacao).toBe("indisponivel");
    expect(r.motivos).toEqual(["Entrada não permitida em 12/10/2026.", "Saída não permitida em 15/10/2026."]);
  });

  it("sem leitura, leitura velha ou sem unidades informadas: a confirmar, com o valor", async () => {
    expect(await consultar()).toMatchObject({ situacao: "a_confirmar", motivos: ["Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa."], cotacao: { valorCheio: 160000, desconto: 6400, total: 153600 }, leituraEm: null });
    await observar(dias("2026-10-12", 4), { observadoEm: new Date("2026-09-29T09:00:00Z") });
    const velha = await consultar();
    expect(velha.situacao).toBe("a_confirmar");
    expect(velha.leituraEm?.toISOString()).toBe("2026-09-29T09:00:00.000Z");
    await db.transaction((tx) => gravarConfig(tx, org, "calendario_regras", { ...REGRAS_CALENDARIO_PADRAO, site: { validadeLeituraHoras: 720, maximoNoitesConsulta: 90 } }, null));
    expect((await consultar()).situacao).toBe("disponivel");
    await db.update(beds24Calendario).set({ livres: null });
    expect((await consultar()).situacao).toBe("a_confirmar");
  });

  it("leitura sem o campo de restrição (override ausente) não vale como liberada: fica a confirmar", async () => {
    await observar(dias("2026-10-12", 4), { bloqueio: null });
    const r = await consultar();
    expect(r.situacao).toBe("a_confirmar");
    expect(r.motivos).toContain("Ainda não conferimos a agenda mais recente para essas datas: confirmamos na conversa.");
    // Só o dia de saída sem o campo também basta.
    await db.update(beds24Calendario).set({ bloqueio: "none" });
    await db.update(beds24Calendario).set({ bloqueio: null }).where(eq(beds24Calendario.data, "2026-10-15"));
    expect((await consultar()).situacao).toBe("a_confirmar");
    await db.update(beds24Calendario).set({ bloqueio: "none" });
    expect((await consultar()).situacao).toBe("disponivel");
  });

  it("blackout recente fecha a noite mesmo sem unidades informadas na leitura", async () => {
    await observar(dias("2026-10-12", 4));
    await db.update(beds24Calendario).set({ bloqueio: "blackout", livres: null }).where(eq(beds24Calendario.data, "2026-10-13"));
    expect(await consultar()).toMatchObject({ situacao: "indisponivel", motivos: ["Há noites já reservadas nessas datas (13/10/2026)."], cotacao: null });
  });

  it("mínimo do cadastro acima do máximo: o site não oferece a estadia, mesmo com o envio ao Beds24 ajustado ao máximo", async () => {
    await observar(dias("2026-10-12", 4));
    await db.update(imoveisDetalhes).set({ estadiaMinima: 30, estadiaMaxima: 2 });
    const r = await consultar({ saida: "2026-10-14" });
    expect(r.situacao).toBe("indisponivel");
    expect(r.motivos).toContain("Para entrada em 12/10/2026, o mínimo é de 30 noites.");
  });

  it("desconto único do site (M12.1): a parte do hóspede da margem do modelo B, pelos parâmetros de Configurações → Marketplace", async () => {
    await observar(dias("2026-10-12", 4));
    // Padrão (OTA 16%, pagamento 4%, pesos 1/1/1): margem 12% de R$ 1.900 = R$ 228, desconto 1/3 = R$ 76.
    expect(await consultar({ hospedes: "4" })).toMatchObject({ situacao: "disponivel", cotacao: { valorCheio: 190000, desconto: 7600, total: 182400 } });
    // Pesos mudam a parte do hóspede: 2/1/1 → metade da margem.
    await db.transaction((tx) => gravarConfig(tx, org, "marketplace_precos", { ...PRECOS_MARKETPLACE_PADRAO, pesos: { hospede: 2, proprietario: 1, scl: 1 } }, null));
    expect(await consultar({ hospedes: "4" })).toMatchObject({ cotacao: { valorCheio: 190000, desconto: 11400, total: 178600 } });
    // Sem margem (taxa do pagamento igual à da OTA): sem desconto, o site vende pelo valor cheio.
    await db.transaction((tx) => gravarConfig(tx, org, "marketplace_precos", { ...PRECOS_MARKETPLACE_PADRAO, taxaPagamentoBp: 1600 }, null));
    expect(await consultar({ hospedes: "4" })).toMatchObject({ cotacao: { valorCheio: 190000, desconto: 0, total: 190000 } });
  });

  it("fonte de preços do Beds24 (M3.9): o site cobra o preço lido; leitura sem preço ou vencida deixa a data a confirmar e sem valor, nunca o cadastro", async () => {
    await db.update(imoveisDetalhes).set({ fontePrecos: "beds24" }).where(eq(imoveisDetalhes.imovelId, im));
    await observar(dias("2026-10-12", 4), { preco: 52000 });
    // 3 × R$ 520 + limpeza R$ 250 + hóspede extra (2 × R$ 50 × 3) = R$ 2.110 cheio; desconto do site 4% = R$ 84,40.
    expect(await consultar({ hospedes: "4" })).toMatchObject({ situacao: "disponivel", motivos: [], cotacao: { diarias: 156000, valorCheio: 211000, desconto: 8440, total: 202560 } });
    // Uma noite sem preço no Beds24: sem valor e a confirmar (o preço base R$ 450 do cadastro não é usado).
    await db.update(beds24Calendario).set({ preco: null }).where(eq(beds24Calendario.data, "2026-10-13"));
    const semPreco = await consultar({ hospedes: "4" });
    expect(semPreco).toMatchObject({ situacao: "a_confirmar", motivos: [expect.stringContaining("ainda não foi confirmado")], cotacao: { diarias: null, valorCheio: null, total: null } });
    // M5.9: o hóspede nunca lê o nome do Beds24.
    expect(JSON.stringify(semPreco)).not.toMatch(/beds24/i);
    // Leitura vencida: idem, mesmo com preço na leitura antiga.
    await db.update(beds24Calendario).set({ preco: 52000, observadoEm: new Date("2026-09-20T09:00:00Z") }).where(eq(beds24Calendario.data, "2026-10-13"));
    expect(await consultar({ hospedes: "4" })).toMatchObject({ situacao: "a_confirmar", cotacao: { diarias: null, total: null } });
    // Fonte manual: o cadastro vale como está (sem última hora), e o site aplica o desconto normalmente.
    await db.update(imoveisDetalhes).set({ fontePrecos: "manual" }).where(eq(imoveisDetalhes.imovelId, im));
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-10-01T09:15:00Z") }).where(eq(beds24Calendario.data, "2026-10-13"));
    expect(await consultar({ hospedes: "4" })).toMatchObject({ situacao: "disponivel", cotacao: { diarias: 135000, valorCheio: 190000, desconto: 7600, total: 182400 } });
  });

  it("preço zero numa noite não vira diária grátis: diárias e total ficam a confirmar", async () => {
    await observar(dias("2026-10-12", 4));
    await db.update(imoveisDetalhes).set({ precoBase: 0 });
    const r = await consultar();
    expect(r.situacao).toBe("disponivel");
    expect(r.cotacao).toMatchObject({ diarias: null, valorCheio: null, desconto: 0, total: null });
    expect(r.motivos).toContain("O valor dessas datas é confirmado na conversa.");
  });

  it("sem preço ou sem taxa de limpeza cadastrados a disponibilidade aparece, mas o total fica para a conversa", async () => {
    await observar(dias("2026-10-12", 4));
    await db.update(imoveisDetalhes).set({ taxaLimpeza: null });
    expect(await consultar()).toMatchObject({ situacao: "disponivel", motivos: ["O valor dessas datas é confirmado na conversa."], cotacao: { diarias: 135000, limpeza: 0, valorCheio: null, desconto: 0, total: null } });
    await db.update(imoveisDetalhes).set({ precoBase: null, taxaLimpeza: 25000 });
    expect(await consultar()).toMatchObject({ situacao: "disponivel", motivos: ["O valor dessas datas é confirmado na conversa."], cotacao: { diarias: null, valorCheio: null, desconto: 0, total: null, limpeza: 25000 } });
  });

  it("pedido inválido: imóvel fora do site, datas, pessoas acima da capacidade; estadia longa demais vai para a equipe", async () => {
    expect(await consultar({ imovel: "buzios" })).toMatchObject({ situacao: "invalida", motivos: ["Escolha um apartamento."] });
    expect(await consultar({ imovel: "x' or 1=1" })).toMatchObject({ situacao: "invalida" });
    expect(await consultar({ entrada: "2026-09-30" })).toMatchObject({ situacao: "invalida", motivos: ["A entrada não pode ser antes de hoje."] });
    expect(await consultar({ saida: "2026-10-12" })).toMatchObject({ situacao: "invalida", motivos: ["A saída precisa ser depois da entrada."] });
    expect(await consultar({ hospedes: "5" })).toMatchObject({ situacao: "invalida", motivos: ["Este apartamento recebe até 4 pessoas."] });
    expect(await consultar({ hospedes: "2e0" })).toMatchObject({ situacao: "invalida", motivos: ["Informe quantas pessoas."] });
    expect(await consultar({ saida: "2027-02-01" })).toMatchObject({ situacao: "a_confirmar", motivos: ["Para estadias acima de 90 noites, fale com a equipe."], noites: 112, cotacao: null });
  });

  it("regras do cadastro (antecedência, dias de entrada) e máximo do motor também impedem", async () => {
    // 12/10/2026 é segunda: só terça como dia de entrada bloqueia.
    await db.update(imoveisDetalhes).set({ antecedenciaMinima: 30, diasChegada: [2], estadiaMaxima: 2 });
    await observar(dias("2026-10-12", 3));
    const r = await consultar();
    expect(r.situacao).toBe("indisponivel");
    expect(r.motivos).toEqual(expect.arrayContaining(["Máximo de 2 noites por estadia.", "Precisa reservar com 30 dia(s) de antecedência.", "Entrada só em: terça."]));
  });
});
