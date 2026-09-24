import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { criarContrato, encerrarContrato } from "@/contratos/repositorio";
import { contratos, imoveis, organizacoes, proprietarioImoveis, proprietarios } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db/types";
import type { DadosReserva } from "@/reservas/regras";
import { cancelarReserva, criarReserva, sincronizarReserva } from "@/reservas/repositorio";
import { aplicarMotor, recalcularReservas } from "./aplicar";
import { REGRAS_PADRAO } from "./motor";
import { lerRecebimento, salvarRecebimento } from "@/imoveis/recebimento";
import { historicoDe } from "@/auditoria/auditoria";
import { listarLancamentos, mudarEstado, saldoAcerto, totaisPorTipo } from "./ledger";

let db: Db;
let close: () => Promise<void>;
let org: string;
let im: string;
let dono: string;

const dados = (over: Partial<DadosReserva> = {}): DadosReserva => ({
  imovelId: im,
  origem: "booking",
  estado: "confirmada",
  // Datas no futuro: o recálculo por mudança de regra só alcança reservas de hoje em diante.
  checkin: "2030-10-10",
  checkout: "2030-10-13",
  hospedes: 2,
  hospedeNome: "Teste",
  hospedeEmail: "",
  hospedeTelefone: "",
  hospedeOrigem: "",
  moeda: "BRL",
  valorBruto: 150000,
  taxaCanal: 22500,
  valorLiquido: null,
  codigoCanal: "",
  observacoes: "",
  ...over,
});

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  [{ id: org }] = await db.insert(organizacoes).values({ nome: "A" }).returning();
  [{ id: im }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "t1", nome: "Um" }).returning();
  [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im });
  await criarContrato(db, org, im, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
});
afterEach(() => close());

const sinc = async (over: Partial<DadosReserva> = {}) => {
  const r = await sincronizarReserva(db, org, "beds24", "1", dados(over));
  if (!r.ok) throw new Error("falhou");
  return r.reserva.id;
};
const ativosDoMotor = async (id: string) => {
  const todos = await listarLancamentos(db, org, { reservaId: id });
  const estornados = new Set(todos.map((l) => l.estornoDe).filter(Boolean));
  return todos.filter((l) => l.origem === "motor" && !estornados.has(l.id));
};

describe("aplicarMotor", () => {
  it("a sincronização já lança; rodar de novo não duplica", async () => {
    const id = await sinc();
    expect(await ativosDoMotor(id)).toHaveLength(4);
    expect(await aplicarMotor(db, org, id, null)).toMatchObject({ criados: 0, estornados: 0, mantidos: 4 });
    await sinc(); // mesma reserva de novo
    expect(await listarLancamentos(db, org, { reservaId: id })).toHaveLength(4);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(108375);
    expect((await totaisPorTipo(db, org, {})).comissao).toBe(19125);
  });

  it("reserva alterada: estorna o que mudou e lança o novo; totais corretos", async () => {
    const id = await sinc();
    await sinc({ valorBruto: 200000, taxaCanal: 30000 });
    expect(await listarLancamentos(db, org, { reservaId: id })).toHaveLength(12); // 4 + 4 estornos + 4 novos
    const t = await totaisPorTipo(db, org, {});
    expect(t.receita_bruta).toBe(200000);
    expect(t.comissao).toBe(25500);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(144500);
  });

  it("valor volta ao cálculo anterior (A → B → A): lança de novo em vez de reaproveitar o estornado", async () => {
    const id = await sinc();
    await sinc({ valorBruto: 200000, taxaCanal: 30000 });
    await sinc();
    expect(await ativosDoMotor(id)).toHaveLength(4);
    const t = await totaisPorTipo(db, org, {});
    expect(t.receita_bruta).toBe(150000);
    expect(t.comissao).toBe(19125);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(108375);
    // E ainda assim idempotente.
    expect(await aplicarMotor(db, org, id, null)).toMatchObject({ criados: 0, estornados: 0, mantidos: 4 });
  });

  it("reserva muda de imóvel (mesmo dono e valores): lançamentos passam para o novo imóvel", async () => {
    const [{ id: im2 }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "t2", nome: "Dois" }).returning();
    await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: im2 });
    await criarContrato(db, org, im2, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
    const id = await sinc();
    await sinc({ imovelId: im2 });
    const ativos = await ativosDoMotor(id);
    expect(ativos).toHaveLength(4);
    expect(ativos.every((l) => l.imovelId === im2)).toBe(true);
    expect((await totaisPorTipo(db, org, { imovelIds: [im] })).receita_bruta ?? 0).toBe(0);
  });

  it("um proprietário por imóvel: o banco não aceita um segundo dono", async () => {
    const [{ id: outro }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Outro" }).returning();
    await expect(db.insert(proprietarioImoveis).values({ proprietarioId: outro, imovelId: im })).rejects.toThrow();
  });

  it("Airbnb: split por padrão (fora do acerto); se a reserva disser que a empresa recebeu, entra no acerto", async () => {
    const id = await sinc({ origem: "airbnb" });
    expect((await ativosDoMotor(id)).find((l) => l.tipo === "direito_proprietario")).toMatchObject({ estado: "previsto", efeitoSaldo: 0 });
    await sinc({ origem: "airbnb", recebimento: "empresa" });
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(108375);
  });

  it("cancelamento estorna tudo e o acerto volta a zero", async () => {
    const id = await sinc();
    await sinc({ estado: "cancelada" });
    expect(await ativosDoMotor(id)).toHaveLength(0);
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(0);
    expect(await listarLancamentos(db, org, { reservaId: id })).toHaveLength(8); // histórico preservado
  });

  it("reserva lançada à mão e cancelada no painel: financeiro acompanha na mesma transação", async () => {
    const r = await criarReserva(db, org, dados(), null);
    const id = r.ok ? r.reserva.id : "";
    expect(await ativosDoMotor(id)).toHaveLength(4);
    expect(await cancelarReserva(db, org, id, null)).toBe(true);
    expect(await ativosDoMotor(id)).toHaveLength(0);
  });

  it("regra padrão alterada: recalcular faz os lançamentos antigos acompanharem", async () => {
    const aConfirmar = { ...REGRAS_PADRAO, recebimento: { ...REGRAS_PADRAO.recebimento, airbnb: "a_confirmar" as const } };
    const id = await sinc({ origem: "airbnb" });
    await recalcularReservas(db, org, {}, null, aConfirmar); // como estava na versão anterior
    expect((await ativosDoMotor(id)).find((l) => l.tipo === "direito_proprietario")?.estado).toBe("pendente");
    const r = await recalcularReservas(db, org); // versão nova: Airbnb = split
    expect(r).toMatchObject({ reservas: 1, criados: 1, estornados: 1 });
    expect((await ativosDoMotor(id)).find((l) => l.tipo === "direito_proprietario")?.estado).toBe("previsto");
    expect(await recalcularReservas(db, org)).toMatchObject({ criados: 0, estornados: 0 }); // idempotente
  });

  it("contrato novo: recalcular o imóvel aplica a nova comissão", async () => {
    const id = await sinc({ checkin: "2031-02-10", checkout: "2031-02-13" });
    expect((await totaisPorTipo(db, org, {})).comissao).toBe(19125);
    const [c] = await db.select().from(contratos).where(eq(contratos.imovelId, im));
    await encerrarContrato(db, org, c.id, "2030-12-31", null);
    await criarContrato(db, org, im, { tipo: "gestao_completa", comissao: "20", inicio: "2031-01-01" }, null);
    expect(await recalcularReservas(db, org, { imovelId: im })).toMatchObject({ reservas: 1 });
    expect((await totaisPorTipo(db, org, {})).comissao).toBe(25500);
    expect(await ativosDoMotor(id)).toHaveLength(4);
    expect(await recalcularReservas(db, org, { imovelId: "lixo" })).toEqual({ reservas: 0, criados: 0, estornados: 0 });
  });

  it("configuração do imóvel (quem recebe por canal): salvar recalcula as reservas dele", async () => {
    const id = await sinc({ origem: "booking" });
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(108375);
    expect(await salvarRecebimento(db, org, im, { booking: "split" }, null)).toBe(true);
    expect(await lerRecebimento(db, org, im)).toEqual({ booking: "split" });
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(0);
    expect(await ativosDoMotor(id)).toHaveLength(4);
    expect((await historicoDe(db, org, "imovel", im)).map((h) => h.acao)).toContain("imovel.recebimento");
    expect(await salvarRecebimento(db, org, im, {}, null)).toBe(true); // volta ao padrão
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(108375);
    // outra organização / valor inválido: nada muda
    const [{ id: outra }] = await db.insert(organizacoes).values({ nome: "B" }).returning();
    expect(await salvarRecebimento(db, outra, im, { booking: "split" }, null)).toBe(false);
    expect(await salvarRecebimento(db, org, im, { booking: "qualquer" as "split" }, null)).toBe(false);
    expect(await lerRecebimento(db, org, im)).toEqual({});
  });

  it("recebimento: gravar e recalcular é tudo-ou-nada", async () => {
    await sinc({ origem: "booking" });
    // Uma falha depois de gravar (simulada numa transação externa) desfaz a configuração e
    // o recálculo juntos: nada fica meio aplicado.
    await expect(
      db.transaction(async (tx) => {
        await salvarRecebimento(tx, org, im, { booking: "split" }, null);
        throw new Error("falha simulada depois de salvar");
      }),
    ).rejects.toThrow("falha simulada");
    expect(await lerRecebimento(db, org, im)).toEqual({});
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(108375);
  });

  it("mudança de regra só vale daquela data para frente: reserva passada não é recalculada", async () => {
    const passada = await sinc({ checkin: "2025-03-10", checkout: "2025-03-13" });
    const r = await sincronizarReserva(db, org, "beds24", "2", dados()); // futura
    const futura = r.ok ? r.reserva.id : "";
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(2 * 108375);
    await salvarRecebimento(db, org, im, { booking: "split" }, null);
    // a futura mudou (split: fora do acerto); a passada ficou exatamente como estava
    expect(await saldoAcerto(db, org, { proprietarioId: dono })).toBe(108375);
    expect((await ativosDoMotor(passada)).find((l) => l.tipo === "direito_proprietario")?.efeitoSaldo).toBe(108375);
    expect((await ativosDoMotor(futura)).find((l) => l.tipo === "direito_proprietario")?.efeitoSaldo).toBe(0);
    // mesmo pedindo uma data no passado, o recálculo começa hoje
    expect(await recalcularReservas(db, org, { aPartirDe: "2000-01-01" })).toMatchObject({ reservas: 1 });
  });

  it("o que já movimentou dinheiro não é mexido automaticamente: fica como está e avisa", async () => {
    const id = await sinc();
    const direito = (await ativosDoMotor(id)).find((l) => l.tipo === "direito_proprietario")!;
    await mudarEstado(db, org, direito.id, "realizado", null, "2030-10-14");
    await sinc({ valorBruto: 200000, taxaCanal: 30000 }); // o canal mudou o valor depois
    const res = await aplicarMotor(db, org, id, null);
    expect(res).toMatchObject({ criados: 0, estornados: 0 });
    expect(res?.avisos.some((a) => a.includes("dinheiro movimentado"))).toBe(true);
    expect((await totaisPorTipo(db, org, {})).receita_bruta).toBe(150000); // intacto
    expect(await listarLancamentos(db, org, { reservaId: id })).toHaveLength(4);
  });

  it("reserva de outra organização ou id inválido: nada acontece", async () => {
    expect(await aplicarMotor(db, org, "lixo", null)).toBeNull();
    expect(await aplicarMotor(db, org, "00000000-0000-4000-8000-000000000999", null)).toBeNull();
  });
});
