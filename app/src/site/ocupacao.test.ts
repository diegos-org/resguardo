import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { beds24Calendario, beds24CalendarioEnviado, bloqueios, idsExternos, imoveis, imoveisDetalhes, organizacoes, reservas } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import { CACHE_OCUPACAO, lerPedidoOcupacao, noitesOcupadas, responderOcupacao } from "./ocupacao";

let db: Db, close: () => Promise<void>, org: string, im: string;
// 1/10/2026 (quinta), 12:00 em São Paulo.
const agora = new Date("2026-10-01T15:00:00Z");
const dias = (de: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${de}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
const observar = (datas: string[], over: Partial<typeof beds24Calendario.$inferInsert> = {}) =>
  db.insert(beds24Calendario).values(datas.map((data) => ({ organizacaoId: org, imovelId: im, data, roomId: "20", livres: 1, preco: 45000, minimoNoites: 1, maximoNoites: 27, bloqueio: "none", observadoEm: new Date("2026-10-01T09:15:00Z"), ...over })));
const ocupadas = (inicio = "2026-10-01", fim = "2026-11-01", codigo = "403") => noitesOcupadas(db, org, codigo, inicio, fim, agora);
const reserva = (checkin: string, checkout: string, over: Partial<typeof reservas.$inferInsert> = {}) =>
  db.insert(reservas).values({ organizacaoId: org, imovelId: im, codigo: `SCL-${checkin}`, origem: "airbnb", estado: "confirmada", checkin, checkout, hospedeNome: "Hóspede Fictício", hospedeEmail: "fake@example.com", fonte: "manual", idFonte: "", ...over });

beforeAll(async () => { ({ db, close } = await createTestDb()); });
afterAll(() => close());
beforeEach(async () => {
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio Exemplo", publico: true, capacidade: 4 }).returning();
  await db.insert(imoveis).values({ organizacaoId: org, codigo: "buzios", nome: "Casa", publico: false, capacidade: 8 });
  await db.insert(imoveisDetalhes).values({ imovelId: im, organizacaoId: org, precoBase: 45000, taxaLimpeza: 25000 });
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: im, canal: "beds24", idExterno: "10", detalhe: "20" });
});

describe("noites ocupadas do calendário do site (M7.6)", () => {
  it("reserva e bloqueio do SCL ocupam as noites (não o dia de saída); só datas em [início, fim), em ordem", async () => {
    await reserva("2026-10-13", "2026-10-15");
    await reserva("2026-10-20", "2026-10-21", { estado: "cancelada", codigo: "SCL-CANCELADA" });
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: im, inicio: "2026-10-28", fim: "2026-11-02", motivo: "Uso próprio" });
    expect(await ocupadas()).toEqual(["2026-10-13", "2026-10-14", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
    expect(await ocupadas("2026-10-14", "2026-10-29")).toEqual(["2026-10-14", "2026-10-28"]);
    expect(await ocupadas("2026-11-01", "2026-12-01")).toEqual(["2026-11-01"]);
  });

  it("leitura atual fechada (sem unidades ou blackout) ocupa; leitura velha, anterior ao envio, de outro quarto ou sem leitura não marcam nada", async () => {
    await observar(dias("2026-10-10", 6));
    await db.update(beds24Calendario).set({ livres: 0 }).where(eq(beds24Calendario.data, "2026-10-10"));
    await db.update(beds24Calendario).set({ bloqueio: "blackout", livres: null }).where(eq(beds24Calendario.data, "2026-10-11"));
    // Restrição de entrada/saída não é noite ocupada; unidades desconhecidas também não.
    await db.update(beds24Calendario).set({ bloqueio: "noCheckIn" }).where(eq(beds24Calendario.data, "2026-10-12"));
    await db.update(beds24Calendario).set({ livres: null }).where(eq(beds24Calendario.data, "2026-10-13"));
    // Leitura vencida (validade padrão de 36 h) com 0 unidades: incerta, não marcada.
    await db.update(beds24Calendario).set({ livres: 0, observadoEm: new Date("2026-09-20T09:00:00Z") }).where(eq(beds24Calendario.data, "2026-10-14"));
    // Leitura anterior ao último envio do SCL: incerta.
    await db.update(beds24Calendario).set({ livres: 0 }).where(eq(beds24Calendario.data, "2026-10-15"));
    await db.insert(beds24CalendarioEnviado).values({ organizacaoId: org, imovelId: im, data: "2026-10-15", roomId: "20", preco: null, minimo: null, maximo: 27, bloqueio: null, enviadoEm: new Date("2026-10-01T10:00:00Z"), confirmado: false });
    expect(await ocupadas()).toEqual(["2026-10-10", "2026-10-11"]);
    // Leitura de outro quarto não descreve o imóvel.
    await db.update(beds24Calendario).set({ roomId: "21" });
    expect(await ocupadas()).toEqual([]);
  });

  it("noites passadas não voltam; imóvel fora do site, inativo, de outra organização ou código estranho: null", async () => {
    await reserva("2026-09-28", "2026-10-03");
    expect(await ocupadas("2026-09-30", "2026-10-05")).toEqual(["2026-10-01", "2026-10-02"]);
    expect(await ocupadas("2026-10-05", "2026-10-05")).toEqual([]);
    expect(await ocupadas(undefined, undefined, "buzios")).toBeNull();
    expect(await ocupadas(undefined, undefined, "x' or 1=1")).toBeNull();
    expect(await ocupadas(undefined, undefined, "999")).toBeNull();
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "Outra" }).returning();
    expect(await noitesOcupadas(db, outra, "403", "2026-10-01", "2026-11-01", agora)).toBeNull();
    await db.update(imoveis).set({ ativo: false }).where(eq(imoveis.id, im));
    expect(await ocupadas()).toBeNull();
  });
});

describe("pedido da rota de noites ocupadas (M7.6)", () => {
  const ler = (q: string, hoje = "2026-10-07") => lerPedidoOcupacao(new URLSearchParams(q), hoje);

  it("aceita código, datas válidas, até 62 dias, de ontem até o fim do calendário", () => {
    expect(ler("imovel=403&inicio=2026-10-07&fim=2026-11-01")).toEqual({ ok: true, pedido: { imovel: "403", inicio: "2026-10-07", fim: "2026-11-01" } });
    expect(ler("imovel=casa-2_b&inicio=2026-10-06&fim=2026-12-07&_=1").ok).toBe(true);
    expect(ler("imovel=403&inicio=2028-03-01&fim=2028-04-01").ok).toBe(true);
  });

  it("recusa com uma frase curta: parâmetro faltando ou repetido, código ou datas inválidos, intervalo invertido, longo, passado ou distante", () => {
    const erro = (q: string) => {
      const r = ler(q);
      return r.ok ? null : r.erro;
    };
    expect(erro("inicio=2026-10-07&fim=2026-11-01")).toBe("Informe uma vez o apartamento, o início e o fim.");
    expect(erro("imovel=403&imovel=102&inicio=2026-10-07&fim=2026-11-01")).toBe("Informe uma vez o apartamento, o início e o fim.");
    expect(erro("imovel=40%203&inicio=2026-10-07&fim=2026-11-01")).toBe("Apartamento inválido.");
    expect(erro(`imovel=${"a".repeat(41)}&inicio=2026-10-07&fim=2026-11-01`)).toBe("Apartamento inválido.");
    expect(erro("imovel=403&inicio=2026-10-7&fim=2026-11-01")).toBe("Informe as datas como AAAA-MM-DD.");
    expect(erro("imovel=403&inicio=2026-10-07&fim=2026-02-30")).toBe("Informe as datas como AAAA-MM-DD.");
    expect(erro("imovel=403&inicio=2026-10-07&fim=2026-10-07")).toBe("O fim precisa ser depois do início.");
    expect(erro("imovel=403&inicio=2026-10-07&fim=2026-12-09")).toBe("Peça no máximo 62 dias por vez.");
    expect(erro("imovel=403&inicio=2026-10-05&fim=2026-11-01")).toBe("O início não pode ser antes de ontem.");
    expect(erro("imovel=403&inicio=2028-03-15&fim=2028-04-02")).toBe("Datas além do que o calendário mostra.");
  });
});

describe("rota pública GET /api/site/ocupacao (M7.6)", () => {
  const pedir = (q: string, organizacao: string | null = org) => responderOcupacao(db, organizacao, new URLSearchParams(q), agora);

  it("devolve só as datas, com cache público curto; nada do hóspede nem da origem", async () => {
    await reserva("2026-10-13", "2026-10-15");
    await observar(["2026-10-20"], { livres: 0 });
    const r = await pedir("imovel=403&inicio=2026-10-01&fim=2026-11-01");
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe(CACHE_OCUPACAO);
    expect(r.headers.get("Content-Type")).toContain("application/json");
    const corpo = await r.text();
    expect(JSON.parse(corpo)).toEqual({ ocupadas: ["2026-10-13", "2026-10-14", "2026-10-20"] });
    expect(corpo).not.toMatch(/Fictício|fake@|airbnb|beds24|SCL-/i);
  });

  it("pedido inválido: 400 com a frase; imóvel fora do site ou inexistente: o mesmo 404; site sem organização: 404", async () => {
    const invalido = await pedir("imovel=403&inicio=2026-10-01&fim=2026-12-15");
    expect(invalido.status).toBe(400);
    expect(await invalido.json()).toEqual({ erro: "Peça no máximo 62 dias por vez." });
    expect(invalido.headers.get("Cache-Control")).toBe("no-store");
    // "Ontem" no fuso do imóvel: 30/9 é aceito em 1/10, 29/9 não.
    expect((await pedir("imovel=403&inicio=2026-09-30&fim=2026-10-05")).status).toBe(200);
    expect((await pedir("imovel=403&inicio=2026-09-29&fim=2026-10-05")).status).toBe(400);
    expect((await pedir("imovel=x'%20or%201=1&inicio=2026-10-01&fim=2026-11-01")).status).toBe(400);
    const oculto = await pedir("imovel=buzios&inicio=2026-10-01&fim=2026-11-01");
    const inexistente = await pedir("imovel=999&inicio=2026-10-01&fim=2026-11-01");
    expect([oculto.status, inexistente.status]).toEqual([404, 404]);
    expect(await oculto.json()).toEqual(await inexistente.json());
    expect((await pedir("imovel=403&inicio=2026-10-01&fim=2026-11-01", null)).status).toBe(404);
  });
});
