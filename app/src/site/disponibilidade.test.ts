import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PESOS_PADRAO_ANTIGO, PRECOS_MARKETPLACE_PADRAO } from "@/marketplace/precos";
import { salvarPrecosMarketplace } from "@/marketplace/precos-config";
import { eq } from "drizzle-orm";
import { gravarConfig } from "@/configuracoes/armazem";
import { REGRAS_CALENDARIO_PADRAO } from "@/calendario/regras-config";
import { alteracoesReserva, beds24Calendario, beds24CalendarioEnviado, bloqueios, cotacoes, idsExternos, imoveis, imoveisDetalhes, organizacoes, pagamentos, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { consultarDisponibilidade, noitesLivres } from "./disponibilidade";

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

describe("cotação da alteração de uma reserva paga (M8.2d): as noites da própria reserva", () => {
  // A reserva paga pelo site ocupa 12 a 15/10; a equipe fechou as datas no Beds24 (bloqueio importado) e a leitura mostra 0.
  let r: string;
  beforeEach(async () => {
    [{ id: r }] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-ALT01", origem: "direta", estado: "confirmada", checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 2, fonte: "site", idFonte: "cot-1" }).returning();
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: im, inicio: "2026-10-12", fim: "2026-10-15", fonte: "beds24", idFonte: "blk-1" });
    await observar(dias("2026-10-12", 6));
    for (const d of dias("2026-10-12", 3)) await db.update(beds24Calendario).set({ livres: 0, bloqueio: "blackout" }).where(eq(beds24Calendario.data, d));
  });
  const propria = () => ({ propria: { reservaId: r, checkin: "2026-10-12", checkout: "2026-10-15" } });
  const cotar = (over: Partial<ReturnType<typeof pedido>> = {}) => consultarDisponibilidade(db, org, pedido(over), agora, propria());

  it("as noites dela não contam como ocupadas (reserva, bloqueio do Beds24 e leitura fechada); as acrescentadas passam pela conferência inteira", async () => {
    expect((await consultar({ saida: "2026-10-16" })).situacao).toBe("indisponivel");
    const r1 = await cotar({ saida: "2026-10-16" });
    expect(r1).toMatchObject({ situacao: "disponivel", motivos: [], noites: 4, cotacao: { diarias: 180000, limpeza: 25000, valorCheio: 205000 } });
    // A "agenda conferida em" é só a das noites que a leitura decidiu (a acrescentada e o dia de saída).
    expect(r1.leituraEm?.toISOString()).toBe("2026-10-01T09:15:00.000Z");
    // Menos noites, dentro da própria: disponível sem precisar da leitura delas.
    expect(await cotar({ saida: "2026-10-14" })).toMatchObject({ situacao: "disponivel" });
    // A noite acrescentada fechada na leitura: indisponível.
    await db.update(beds24Calendario).set({ livres: 0 }).where(eq(beds24Calendario.data, "2026-10-15"));
    expect(await cotar({ saida: "2026-10-16" })).toMatchObject({ situacao: "indisponivel", motivos: ["Há noites já reservadas nessas datas (15/10/2026)."] });
    // Sem leitura da acrescentada: a confirmar.
    await db.delete(beds24Calendario).where(eq(beds24Calendario.data, "2026-10-15"));
    expect(await cotar({ saida: "2026-10-16" })).toMatchObject({ situacao: "a_confirmar" });
  });

  it("a leitura velha das noites dela não deixa a confirmar; a restrição de entrada e saída vale na data nova, como para qualquer estadia", async () => {
    const velha = { observadoEm: new Date("2026-09-20T09:00:00Z") };
    for (const d of ["2026-10-13", "2026-10-14"]) await db.update(beds24Calendario).set(velha).where(eq(beds24Calendario.data, d));
    expect(await cotar({ saida: "2026-10-16" })).toMatchObject({ situacao: "disponivel" });
    // Uma entrada nova (13/10) é conferida pela restrição de entrada: leitura velha nela deixa a confirmar.
    expect(await cotar({ entrada: "2026-10-13", saida: "2026-10-16" })).toMatchObject({ situacao: "a_confirmar" });
    // A saída nova (16/10) com restrição de saída: indisponível, como para qualquer estadia.
    await db.update(beds24Calendario).set({ bloqueio: "noCheckOut" }).where(eq(beds24Calendario.data, "2026-10-16"));
    expect(await cotar({ saida: "2026-10-16" })).toMatchObject({ situacao: "indisponivel", motivos: ["Saída não permitida em 16/10/2026."] });
  });

  it("na entrada e na saída que não mudam (já vendidas, D1), as regras do dia de entrada e de saída não valem; na data nova, valem", async () => {
    // Antecedência de 30 dias, horizonte de 5 dias, entrada só na terça e saída só no sábado: nenhuma vale para 12 (segunda)
    // a 15/10 (quinta), já vendidas; a entrada (12/10) e a saída (15/10) dela têm restrição no Beds24 e leitura velha.
    await db.update(imoveisDetalhes).set({ antecedenciaMinima: 30, janelaMaxima: 5, diasChegada: [2], diasSaida: [6] }).where(eq(imoveisDetalhes.imovelId, im));
    await db.update(beds24Calendario).set({ bloqueio: "noCheckIn", observadoEm: new Date("2026-09-20T09:00:00Z") }).where(eq(beds24Calendario.data, "2026-10-12"));
    await db.update(beds24Calendario).set({ bloqueio: "noCheckOut", observadoEm: new Date("2026-09-20T09:00:00Z") }).where(eq(beds24Calendario.data, "2026-10-15"));
    // Uma estadia nova nas mesmas datas não seria vendida.
    expect((await consultar({ hospedes: "3" })).motivos).toEqual(
      expect.arrayContaining(["Precisa reservar com 30 dia(s) de antecedência.", "Aceita reservas só até 5 dias à frente.", "Entrada só em: terça.", "Saída só em: sábado."]),
    );
    // Só as pessoas mudam: disponível, com o hóspede extra da terceira pessoa (sem leitura que participe da decisão).
    expect(await cotar({ hospedes: "3" })).toMatchObject({ situacao: "disponivel", motivos: [], noites: 3, cotacao: { diarias: 135000, hospedeExtra: 15000 }, leituraEm: null });
    // Mais noites no fim (15/10 passa a ser noite nova, com leitura atual): a entrada não muda (as regras dela não valem); a
    // saída nova passa pelas da saída (sexta não; sábado sim).
    await db.update(beds24Calendario).set({ bloqueio: "none", observadoEm: new Date("2026-10-01T09:15:00Z") }).where(eq(beds24Calendario.data, "2026-10-15"));
    expect(await cotar({ saida: "2026-10-16" })).toMatchObject({ situacao: "indisponivel", motivos: ["Saída só em: sábado."] });
    expect(await cotar({ saida: "2026-10-17" })).toMatchObject({ situacao: "disponivel", noites: 5 });
    // Entrada nova (11/10, domingo, sem leitura): antecedência, horizonte e dia de entrada valem; a saída que não muda, não.
    const antes = await cotar({ entrada: "2026-10-11" });
    expect(antes.situacao).toBe("indisponivel");
    expect(antes.motivos).toEqual(expect.arrayContaining(["Precisa reservar com 30 dia(s) de antecedência.", "Aceita reservas só até 5 dias à frente.", "Entrada só em: terça."]));
    expect(antes.motivos.join(" ")).not.toMatch(/Saída/);
    // Entrada nova dentro da estadia (13/10, terça) com restrição de entrada no Beds24: vale, como para qualquer estadia.
    await db.update(beds24Calendario).set({ bloqueio: "noCheckIn" }).where(eq(beds24Calendario.data, "2026-10-13"));
    expect(await cotar({ entrada: "2026-10-13" })).toMatchObject({ situacao: "indisponivel" });
    expect((await cotar({ entrada: "2026-10-13" })).motivos).toEqual(expect.arrayContaining(["Entrada não permitida em 13/10/2026."]));
  });

  it("sem mudar as datas, o mínimo e o máximo de noites não contam; mudando, contam (calculados sem ela)", async () => {
    await db.update(imoveisDetalhes).set({ estadiaMinima: 4, estadiaMaxima: 3 }).where(eq(imoveisDetalhes.imovelId, im));
    expect((await consultar()).motivos).toEqual(expect.arrayContaining(["Para entrada em 12/10/2026, o mínimo é de 4 noites."]));
    expect(await cotar({ hospedes: "3" })).toMatchObject({ situacao: "disponivel", noites: 3 });
    expect(await cotar({ saida: "2026-10-14" })).toMatchObject({ situacao: "indisponivel", motivos: expect.arrayContaining(["Para entrada em 12/10/2026, o mínimo é de 4 noites."]) });
    expect((await cotar({ saida: "2026-10-16" })).motivos).toEqual(expect.arrayContaining(["Máximo de 3 noites por estadia."]));
  });

  it("outra reserva ou um bloqueio do SCL nas noites dela ainda ocupam (só ela e o bloqueio do Beds24 dela ficam de fora)", async () => {
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: im, inicio: "2026-10-13", fim: "2026-10-14", fonte: "manual", motivo: "Manutenção" });
    expect(await cotar({ saida: "2026-10-16" })).toMatchObject({ situacao: "indisponivel", motivos: ["Há noites já reservadas nessas datas (13/10/2026)."] });
  });

  it("preço pela fonte do imóvel: com preços do Beds24, a noite dela também precisa de uma leitura atual com preço", async () => {
    await db.update(imoveisDetalhes).set({ fontePrecos: "beds24" }).where(eq(imoveisDetalhes.imovelId, im));
    await db.update(beds24Calendario).set({ preco: 52000 });
    expect(await cotar({ saida: "2026-10-16" })).toMatchObject({ situacao: "disponivel", cotacao: { diarias: 208000 } });
    await db.update(beds24Calendario).set({ observadoEm: new Date("2026-09-20T09:00:00Z") }).where(eq(beds24Calendario.data, "2026-10-13"));
    expect(await cotar({ saida: "2026-10-16" })).toMatchObject({ situacao: "a_confirmar", cotacao: { diarias: null, total: null } });
  });

  it("mínimo de noites e sobras calculados sem ela: o espaço até a próxima reserva conta as noites dela como livres", async () => {
    await db.update(imoveisDetalhes).set({ estadiaMinima: 5 }).where(eq(imoveisDetalhes.imovelId, im));
    await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-OUTRA", origem: "airbnb", estado: "confirmada", checkin: "2026-10-16", checkout: "2026-10-20", fonte: "manual", idFonte: "" });
    // De 12 a 16/10 há 4 noites livres sem ela: o mínimo de 5 cede às sobras.
    expect(await cotar({ saida: "2026-10-16" })).toMatchObject({ situacao: "disponivel", noites: 4 });
    // As pessoas continuam limitadas pela capacidade.
    expect(await cotar({ saida: "2026-10-16", hospedes: "5" })).toMatchObject({ situacao: "invalida", motivos: ["Este apartamento recebe até 4 pessoas."] });
  });
});

describe("noitesLivres com várias reservas de fora e as datas seguradas de uma alteração (M8.2d)", () => {
  const minutos = (n: number) => new Date(agora.getTime() + n * 60_000);
  /** Reserva paga R (12 a 15/10) com a alteração que segura 15 a 17/10 numa reserva-pedido (fonte 'alteracao'). */
  async function cenario(alteracao: { situacao?: "segurada" | "aplicada" | "expirada" | "desistida"; holdAte?: Date | null } = {}) {
    const [r] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-ALT02", origem: "direta", estado: "confirmada", checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 2, fonte: "site", idFonte: "cot-2" }).returning();
    const [cot] = await db.insert(cotacoes).values({ organizacaoId: org, imovelId: im, codigo: "COT-ALT02", estado: "convertida", checkin: "2026-10-12", checkout: "2026-10-15", hospedes: 2, noites: 3, situacao: "disponivel", diarias: 135000, limpeza: 25000, hospedeExtra: 0, valorCheio: 160000, total: 153600, reservaId: r.id }).returning();
    const pagamento = (o: { alteracaoId?: string; situacao?: "aprovado" | "pendente"; referencia: string }) =>
      db.insert(pagamentos).values({ organizacaoId: org, cotacaoId: cot.id, reservaId: r.id, imovelId: im, ambiente: "teste", forma: "pix", referencia: o.referencia, chaveIdempotencia: o.referencia, valor: 153600, situacao: o.situacao ?? "aprovado", alteracaoId: o.alteracaoId ?? null }).returning();
    const [p0] = await pagamento({ referencia: "scl-alt-p0" });
    const [a] = await db
      .insert(alteracoesReserva)
      .values({
        organizacaoId: org, reservaId: r.id, cotacaoId: cot.id, pagamentoId: p0.id, situacao: alteracao.situacao ?? "segurada", pedidoRecebidoEm: agora,
        checkinAntes: "2026-10-12", checkoutAntes: "2026-10-15", hospedesAntes: 2, valorAntes: 153600, checkinDepois: "2026-10-12", checkoutDepois: "2026-10-17", hospedesDepois: 2, valorDepois: 240000,
        origemValor: "cotacao", cotacao: { diarias: 225000, limpeza: 25000, hospedeExtra: 0, valorCheio: 250000, desconto: 10000, total: 240000, situacao: "disponivel", leituraEm: null },
        diferenca: 86400, entradaDaPolitica: "2026-10-12", noitesNovasInicio: "2026-10-15", noitesNovasFim: "2026-10-17", holdAte: alteracao.holdAte === undefined ? minutos(60) : alteracao.holdAte, assinatura: "0123456789abcdef",
      })
      .returning();
    const [portador] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-ALT03", origem: "site", estado: "pedido", checkin: "2026-10-15", checkout: "2026-10-17", hospedeNome: "Alteração SCL-ALT02", fonte: "alteracao", idFonte: a.id }).returning();
    await db.update(alteracoesReserva).set({ holdReservaId: portador.id }).where(eq(alteracoesReserva.id, a.id));
    return { r: r.id, alteracao: a.id, portador: portador.id, pagamento };
  }
  const livres = (o: Parameters<typeof noitesLivres>[5] = {}) => noitesLivres(db, org, im, "2026-10-14", "2026-10-17", { agora, ...o });

  it("excetoReservaIds tira várias reservas (a própria e as datas seguradas dela); excetoReservaId continua valendo", async () => {
    const c = await cenario();
    expect(await livres()).toEqual({ livres: false, motivo: "ocupada", conflito: "SCL-ALT02" });
    expect(await livres({ excetoReservaId: c.r })).toEqual({ livres: false, motivo: "ocupada", conflito: "SCL-ALT03" });
    expect(await livres({ excetoReservaIds: [c.r, c.portador] })).toEqual({ livres: true });
    expect(await livres({ excetoReservaIds: [c.portador], excetoReservaId: c.r })).toEqual({ livres: true });
    expect(await livres({ excetoReservaIds: [] })).toMatchObject({ livres: false, conflito: "SCL-ALT02" });
  });

  it("as datas seguradas ocupam enquanto a alteração vale; vencida (sem pagamento que segure) não ocupa, mesmo antes de a rotina gravar", async () => {
    const c = await cenario({ holdAte: minutos(10) });
    expect(await livres({ excetoReservaId: c.r })).toMatchObject({ livres: false, conflito: "SCL-ALT03" });
    expect(await livres({ excetoReservaId: c.r, agora: minutos(11) })).toEqual({ livres: true });
    // Com um Pix da diferença pendente, a carência (15 minutos) segura as datas; passada, não.
    await c.pagamento({ alteracaoId: c.alteracao, situacao: "pendente", referencia: "scl-alt-p1" });
    expect(await livres({ excetoReservaId: c.r, agora: minutos(20) })).toMatchObject({ livres: false, conflito: "SCL-ALT03" });
    expect(await livres({ excetoReservaId: c.r, agora: minutos(26) })).toEqual({ livres: true });
  });

  it("alteração aplicada, desistida ou expirada não segura nada; sem a alteração da reserva-pedido, ocupa (nunca livre por palpite)", async () => {
    for (const situacao of ["aplicada", "desistida", "expirada"] as const) {
      const c = await cenario({ situacao });
      expect(await livres({ excetoReservaId: c.r }), situacao).toEqual({ livres: true });
      // Limpa só esta organização (pagamento e alteração se referem um ao outro).
      await db.update(pagamentos).set({ alteracaoId: null }).where(eq(pagamentos.organizacaoId, org));
      await db.delete(alteracoesReserva).where(eq(alteracoesReserva.organizacaoId, org));
      await db.delete(pagamentos).where(eq(pagamentos.organizacaoId, org));
      await db.delete(cotacoes).where(eq(cotacoes.organizacaoId, org));
      await db.delete(reservas).where(eq(reservas.organizacaoId, org));
    }
    const [orfa] = await db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: "SCL-ORFA", origem: "site", estado: "pedido", checkin: "2026-10-15", checkout: "2026-10-17", fonte: "alteracao", idFonte: "sem-alteracao" }).returning();
    expect(await livres()).toEqual({ livres: false, motivo: "ocupada", conflito: orfa.codigo });
  });
});
