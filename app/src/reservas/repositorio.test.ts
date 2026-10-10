import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { historicoDe } from "@/auditoria/auditoria";
import { bloqueios, imoveis, organizacoes } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import type { DadosReserva } from "./regras";
import { cancelarPortador, cancelarReserva, confirmarReserva, criarReserva, dadosDoSite, FONTE_ALTERACAO, listarBloqueios, listarReservas, obterReserva, salvarEmailHospede, sincronizarReserva, tentarCancelarReserva } from "./repositorio";

let db: Db;
let close: () => Promise<void>;
let org: string;
let outra: string;
let im: string;
let im2: string;

const dados = (over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId: im,
  origem: "airbnb",
  estado: "confirmada",
  checkin: "2026-10-10",
  checkout: "2026-10-13",
  hospedes: 2,
  hospedeNome: "Hóspede Teste",
  hospedeEmail: "hospede@example.com",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 150000,
  taxaCanal: 22500,
  valorLiquido: 127500,
  codigoCanal: "HM123",
  observacoes: "",
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [a, b] = await db.insert(organizacoes).values([{ nome: "A" }, { nome: "B" }]).returning();
  org = a.id;
  outra = b.id;
  const [i1, i2] = await db
    .insert(imoveis)
    .values([
      { organizacaoId: org, codigo: "t1", nome: "Um" },
      { organizacaoId: org, codigo: "t2", nome: "Dois" },
    ])
    .returning();
  im = i1.id;
  im2 = i2.id;
});
afterEach(() => close());

describe("reservas", () => {
  it("e-mail do hóspede corrigido no painel vale sobre o da fonte na próxima sincronização (M9.1)", async () => {
    const r1 = await sincronizarReserva(db, org, "beds24", "777", dados({ hospedeEmail: "errado@example.com" }));
    const id = r1.ok ? r1.reserva.id : "";
    // Sem correção manual: a fonte manda.
    await sincronizarReserva(db, org, "beds24", "777", dados({ hospedeEmail: "outro@example.com" }));
    expect((await obterReserva(db, org, id))?.hospedeEmail).toBe("outro@example.com");
    expect(await salvarEmailHospede(db, org, id, "certo@example.com", null)).toEqual({ ok: true });
    const r2 = await sincronizarReserva(db, org, "beds24", "777", dados({ hospedeEmail: "outro@example.com", hospedes: 3 }));
    expect(r2.ok && r2.reserva).toMatchObject({ hospedeEmail: "certo@example.com", hospedes: 3 });
    // Apagar à mão (tirar o acesso) também vale sobre a fonte.
    await salvarEmailHospede(db, org, id, "", null);
    await sincronizarReserva(db, org, "beds24", "777", dados({ hospedeEmail: "outro@example.com" }));
    expect((await obterReserva(db, org, id))?.hospedeEmail).toBe("");
  });

  it("cria reserva manual com código SCL e histórico sem e-mail por extenso", async () => {
    const r = await criarReserva(db, org, dados(), null);
    expect(r.ok && r.reserva.codigo).toMatch(/^SCL-/);
    const id = r.ok ? r.reserva.id : "";
    const h = await historicoDe(db, org, "reserva", id);
    expect(h[0].acao).toBe("reserva.criar");
    expect(JSON.stringify(h)).not.toContain("hospede@example.com");
  });

  it("sincronização é idempotente e registra só mudanças reais", async () => {
    const r1 = await sincronizarReserva(db, org, "beds24", "555", dados());
    expect(r1.ok && r1.criada).toBe(true);
    const r2 = await sincronizarReserva(db, org, "beds24", "555", dados());
    expect(r2.ok && r2.criada).toBe(false);
    const r3 = await sincronizarReserva(db, org, "beds24", "555", dados({ checkout: "2026-10-14", estado: "cancelada" }));
    expect(r3.ok && r3.reserva.checkout).toBe("2026-10-14");
    expect(r3.ok && r3.reserva.canceladaEm).toBeInstanceOf(Date);
    const id = r1.ok ? r1.reserva.id : "";
    expect((await historicoDe(db, org, "reserva", id)).map((h) => h.acao)).toEqual(["reserva.sincronizar", "reserva.importar"]);
    // Outra fonte com o mesmo canal+código não duplica a reserva já ligada ao Beds24.
    const r4 = await sincronizarReserva(db, org, "csv", "555", dados());
    expect(r4).toMatchObject({ ok: false, erros: { geral: expect.stringContaining("já é atualizada") } });
  });

  it("sincronizações simultâneas da mesma reserva não duplicam nem falham", async () => {
    const resultados = await Promise.all([1, 2, 3].map(() => sincronizarReserva(db, org, "beds24", "777", dados())));
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(resultados.filter((r) => r.ok && r.criada)).toHaveLength(1);
    expect(await listarReservas(db, org, { inicio: "2026-01-01", fim: "2027-01-01", incluirCanceladas: true })).toHaveLength(1);
  });

  it("reserva reativada pela sincronização perde a data de cancelamento", async () => {
    await sincronizarReserva(db, org, "beds24", "999", dados({ estado: "cancelada" }));
    const r = await sincronizarReserva(db, org, "beds24", "999", dados({ estado: "confirmada" }));
    expect(r.ok && r.reserva.canceladaEm).toBeNull();
  });

  it("reserva que já chega cancelada ganha data de cancelamento", async () => {
    const r = await sincronizarReserva(db, org, "beds24", "888", dados({ estado: "cancelada" }));
    expect(r.ok && r.reserva.canceladaEm).toBeInstanceOf(Date);
  });

  it("lista por período (saída exclusiva), filtra imóveis e esconde canceladas", async () => {
    await criarReserva(db, org, dados({ checkin: "2026-09-28", checkout: "2026-10-01" }), null);
    const dentro = await criarReserva(db, org, dados({ checkin: "2026-10-05", checkout: "2026-10-08" }), null);
    await criarReserva(db, org, dados({ imovelId: im2, checkin: "2026-10-20", checkout: "2026-10-22" }), null);
    const cancelada = await criarReserva(db, org, dados({ checkin: "2026-10-25", checkout: "2026-10-27" }), null);
    await cancelarReserva(db, org, cancelada.ok ? cancelada.reserva.id : "", null);

    const outubro = { inicio: "2026-10-01", fim: "2026-11-01" };
    expect((await listarReservas(db, org, outubro)).map((r) => r.checkin)).toEqual(["2026-10-05", "2026-10-20"]);
    expect((await listarReservas(db, org, { ...outubro, imovelIds: [im] })).map((r) => r.id)).toEqual([dentro.ok ? dentro.reserva.id : ""]);
    expect(await listarReservas(db, org, { ...outubro, incluirCanceladas: true })).toHaveLength(3);
    expect(await listarReservas(db, outra, outubro)).toEqual([]);
  });

  it("isolamento: não cria em imóvel de outra organização nem lê/cancela de fora", async () => {
    expect(await criarReserva(db, outra, dados(), null)).toEqual({ ok: false, erros: { imovelId: "Imóvel não encontrado." } });
    const r = await criarReserva(db, org, dados(), null);
    const id = r.ok ? r.reserva.id : "";
    expect(await obterReserva(db, outra, id)).toBeNull();
    expect(await cancelarReserva(db, outra, id, null)).toBe(false);
    expect(await cancelarReserva(db, org, id, null)).toBe(true);
    expect(await cancelarReserva(db, org, id, null)).toBe(false);
  });

  it("recusa dados inválidos sem gravar", async () => {
    const r = await criarReserva(db, org, dados({ checkout: "2026-10-01" }), null);
    expect(r.ok).toBe(false);
    expect(await listarReservas(db, org, { inicio: "2026-01-01", fim: "2027-01-01", incluirCanceladas: true })).toEqual([]);
  });

  it("bloqueios por período", async () => {
    await db.insert(bloqueios).values({ organizacaoId: org, imovelId: im, inicio: "2026-10-01", fim: "2026-10-03", motivo: "manutenção" });
    expect(await listarBloqueios(db, org, { inicio: "2026-10-02", fim: "2026-10-05" })).toHaveLength(1);
    expect(await listarBloqueios(db, org, { inicio: "2026-10-03", fim: "2026-10-05" })).toHaveLength(0);
  });
});


describe("reserva do site e a reserva-pedido de uma alteração (M8.2d)", () => {
  it("dadosDoSite: os dados da própria reserva, confirmada, com quem recebe = a empresa", async () => {
    const s = await sincronizarReserva(db, org, "site", "cot-1", dados({ origem: "site", estado: "pedido", hospedeTelefone: "(21) 90000-0000", observacoes: "Pedido pelo site" }));
    if (!s.ok) throw new Error("falhou");
    const r = (await obterReserva(db, org, s.reserva.id))!;
    expect(dadosDoSite(r)).toMatchObject({
      imovelId: im,
      origem: "site",
      estado: "confirmada",
      recebimento: "empresa",
      checkin: r.checkin,
      checkout: r.checkout,
      hospedes: r.hospedes,
      hospedeNome: r.hospedeNome,
      hospedeEmail: r.hospedeEmail,
      hospedeTelefone: "(21) 90000-0000",
      valorBruto: r.valorBruto,
      taxaCanal: r.taxaCanal,
      valorLiquido: r.valorLiquido,
      observacoes: "Pedido pelo site",
    });
  });

  it("a reserva-pedido não se confirma nem se cancela pela ficha; cancelarPortador só cancela a da própria alteração, uma vez", async () => {
    const alterada = await sincronizarReserva(db, org, "site", "cot-2", dados({ origem: "site", codigoCanal: "" }));
    if (!alterada.ok) throw new Error("falhou");
    const alteracaoId = crypto.randomUUID();
    const portador = await sincronizarReserva(db, org, FONTE_ALTERACAO, alteracaoId, dados({ origem: "site", estado: "pedido", checkin: "2026-10-13", checkout: "2026-10-14", hospedeNome: `Alteração ${alterada.reserva.codigo}`, hospedeEmail: "", valorBruto: null, taxaCanal: null, valorLiquido: null, codigoCanal: "" }));
    if (!portador.ok) throw new Error("falhou");
    const conf = await confirmarReserva(db, org, portador.reserva.id, null);
    expect(conf).toEqual({ ok: false, aviso: `Estas são as datas seguradas de uma alteração da reserva ${alterada.reserva.codigo}: elas não se confirmam por aqui.` });
    expect(await tentarCancelarReserva(db, org, portador.reserva.id, null)).toEqual({ ok: false, aviso: `Estas são as datas seguradas de uma alteração da reserva ${alterada.reserva.codigo}: elas somem sozinhas quando a alteração é aplicada, desistida ou vence.` });
    // Outra alteração (id diferente) não cancela esta; a própria cancela, uma vez.
    const agora = new Date("2026-10-01T15:00:00Z");
    expect(await db.transaction((tx) => cancelarPortador(tx, org, { id: crypto.randomUUID(), reservaId: alterada.reserva.id, holdReservaId: portador.reserva.id }, null, agora, "teste"))).toBe(false);
    expect(await db.transaction((tx) => cancelarPortador(tx, org, { id: alteracaoId, reservaId: alterada.reserva.id, holdReservaId: alterada.reserva.id }, null, agora, "teste"))).toBe(false);
    expect(await db.transaction((tx) => cancelarPortador(tx, org, { id: alteracaoId, reservaId: alterada.reserva.id, holdReservaId: portador.reserva.id }, null, agora, "teste"))).toBe(true);
    expect(await db.transaction((tx) => cancelarPortador(tx, org, { id: alteracaoId, reservaId: alterada.reserva.id, holdReservaId: portador.reserva.id }, null, agora, "teste"))).toBe(false);
    expect((await obterReserva(db, org, portador.reserva.id))?.estado).toBe("cancelada");
    expect((await obterReserva(db, org, alterada.reserva.id))?.estado).toBe("confirmada");
    // De outra empresa: nada.
    expect(await db.transaction((tx) => cancelarPortador(tx, outra, { id: alteracaoId, reservaId: alterada.reserva.id, holdReservaId: portador.reserva.id }, null, agora, "teste"))).toBe(false);
  });
});
