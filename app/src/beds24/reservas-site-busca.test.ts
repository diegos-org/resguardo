/**
 * Reserva paga do site no Beds24 (M8.3a) — a busca pela marca do SCL, só leitura, e as regras de adoção (desenho 3.5;
 * seção 10, teste 10), mais a comparação com o esperado (4.3, 5.2). Versão falsa do Beds24, sem rede.
 */
import { describe, expect, it } from "vitest";
import { Beds24Falso } from "./falso";
import { INFO_ENSAIO_SCL, INFO_MARCA_SCL, normalizarReserva } from "./normalizar";
import { procurarReservaDoSite } from "./reservas-site";
import { assinaturaAtualDoScl, assinaturaEsperado, diferencaNaMarca, diferencaNoBeds24, type EsperadoBeds24, lidoDoRegistro, regraDeAdocao } from "./reservas-site-regras";
import { ErroBeds24, type LeitorBeds24 } from "./tipos";

const CODIGO = "SCL-7K2QXM";
const ESPERADO: EsperadoBeds24 = { quarto: "123456", chegada: "2026-12-20", saida: "2026-12-27", hospedes: 4, situacao: "confirmada" };
const ALVO = { referencia: CODIGO, quarto: ESPERADO.quarto, chegada: ESPERADO.chegada };
// M8.3c: a reserva criada pelo SCL volta com a origem pela API (`apiSource`, como a do falso): sem ela, num canal desconhecido,
// a adoção passa a recusar (desenho 3.5; `origemPodeSerDoScl`). Antes, o registro não levava origem nenhuma.
const registro = (o: Record<string, unknown> = {}) => ({ id: 98765, propertyId: 100, roomId: 123456, status: "confirmed", arrival: "2026-12-20", departure: "2026-12-27", numAdult: 4, apiSource: "API", infoItems: [{ code: INFO_MARCA_SCL, text: CODIGO }], ...o });
const lida = (o: Record<string, unknown> = {}) => {
  const n = normalizarReserva(registro(o));
  if (!n.ok) throw new Error(n.d.motivo);
  return n.r;
};
const falso = (...bookings: Record<string, unknown>[]) => {
  const f = new Beds24Falso(() => new Date("2026-12-22T12:00:00Z"));
  f.bookings = bookings;
  return f;
};

describe("procurarReservaDoSite (M8.3a, teste 10): filtros", () => {
  it("o quarto com a chegada explícita (chegada exata) e os info items; todas as situações voltam e a saída é filtrada pela marca", async () => {
    const f = falso(registro(), registro({ id: 2, status: "cancelled" }), registro({ id: 3, status: "black" }), registro({ id: 4, infoItems: [] }), registro({ id: 5, roomId: 999 }));
    const b = await procurarReservaDoSite(f, ALVO);
    expect(f.filtrosLidos).toEqual([{ quarto: "123456", chegadaExata: "2026-12-20", incluirInfo: true }]);
    if (!b.funcionou) throw new Error(b.erro);
    expect(b.comMarca.map((r) => [r.idExterno, r.estado])).toEqual([["98765", "confirmada"], ["2", "cancelada"], ["3", "bloqueio"]]);
  });

  it("com a marca no nome, também a busca por texto desde 1900; com ids conhecidos, a releitura por id (sem depender da marca na chegada)", async () => {
    const f = falso(registro({ arrival: "2026-12-21", departure: "2026-12-27", infoItems: [], lastName: `${CODIGO} (não altere aqui)` }), registro({ id: 7, arrival: "2026-12-19" }));
    const b = await procurarReservaDoSite(f, { ...ALVO, marcaNoNome: true, idsConhecidos: ["7", "7", "id com espaço"] });
    expect(f.filtrosLidos).toEqual([
      { quarto: "123456", chegadaExata: "2026-12-20", incluirInfo: true },
      { pesquisa: CODIGO, chegadaDe: "1900-01-01", incluirInfo: true },
      { ids: ["7"], chegadaDe: "1900-01-01", incluirInfo: true },
    ]);
    if (!b.funcionou) throw new Error(b.erro);
    expect(b.comMarca.map((r) => r.idExterno).sort()).toEqual(["7", "98765"]);
  });

  it("M8.3c: a marca ambígua (dois códigos no info item, ou o info item SCL com texto inválido) não conclui, em qualquer leitura", async () => {
    const ambiguas = [
      registro({ id: 2, infoItems: [{ code: INFO_MARCA_SCL, text: CODIGO }, { code: INFO_MARCA_SCL, text: "SCL-ABCDEF" }] }),
      registro({ id: 3, infoItems: [{ code: INFO_MARCA_SCL, text: "ilegível" }] }),
      registro({ id: 4, infoItems: [], firstName: CODIGO, notes: "SCL-ABCDEF" }),
    ];
    for (const b of ambiguas) {
      expect(await procurarReservaDoSite(falso(registro(), b), ALVO)).toMatchObject({ funcionou: false, erro: expect.stringContaining("marca do SCL ambígua") });
    }
    // Também na releitura por id e na pesquisa por texto (outro quarto e outra chegada: só ela traz o registro ambíguo).
    const f = falso(registro(), registro({ id: 7, roomId: 999, arrival: "2026-12-01", infoItems: [{ code: INFO_MARCA_SCL, text: "?" }] }));
    expect(await procurarReservaDoSite(f, { ...ALVO, idsConhecidos: ["7"] })).toMatchObject({ funcionou: false, erro: expect.stringContaining("marca do SCL ambígua") });
    expect(f.filtrosLidos.at(-1)).toEqual({ ids: ["7"], chegadaDe: "1900-01-01", incluirInfo: true });
    const t = falso(registro(), registro({ id: 8, roomId: 999, arrival: "2026-12-01", infoItems: [], lastName: CODIGO, notes: "SCL-ABCDEF" }));
    expect(await procurarReservaDoSite(t, { ...ALVO, marcaNoNome: true })).toMatchObject({ funcionou: false, erro: expect.stringContaining("marca do SCL ambígua") });
    expect(t.filtrosLidos.at(-1)).toEqual({ pesquisa: CODIGO, chegadaDe: "1900-01-01", incluirInfo: true });
  });

  it("o ensaio nunca entra; a marca de outra reserva também não", async () => {
    const f = falso(registro({ infoItems: [{ code: INFO_ENSAIO_SCL, text: "x" }, { code: INFO_MARCA_SCL, text: CODIGO }] }), registro({ id: 2, infoItems: [{ code: INFO_MARCA_SCL, text: "SCL-ABCDEF" }] }));
    expect(await procurarReservaDoSite(f, ALVO)).toMatchObject({ funcionou: true, comMarca: [] });
  });

  it("a busca não conclui com a leitura falhando ou com um registro ilegível (pode ser o nosso)", async () => {
    const f = falso(registro());
    f.falhar = new ErroBeds24("Beds24 não respondeu a tempo.", "tempo");
    expect(await procurarReservaDoSite(f, ALVO)).toEqual({ funcionou: false, erro: "Beds24 não respondeu a tempo." });
    const segredo: LeitorBeds24 = { reservas: async () => { throw new Error("TOKEN SECRETO"); }, calendario: async () => ({ itens: [], divergencias: [], lidoEm: "" }), quartos: async () => ({ itens: [], divergencias: [], lidoEm: "" }) };
    expect(await procurarReservaDoSite(segredo, ALVO)).toEqual({ funcionou: false, erro: "Não foi possível ler o Beds24." });
    expect(await procurarReservaDoSite(falso(registro(), registro({ id: 9, status: "?" })), ALVO)).toMatchObject({ funcionou: false, erro: expect.stringContaining("formato inválido") });
  });

  it("a busca não conclui com o mesmo id duas vezes numa leitura, nem com o mesmo registro diferente em duas leituras (qual cópia vale?)", async () => {
    // Nas duas ordens: a adoção dependeria de qual cópia veio antes.
    for (const copias of [[registro(), registro({ status: "cancelled" })], [registro({ status: "cancelled" }), registro()]]) {
      expect(await procurarReservaDoSite(falso(...copias), ALVO)).toMatchObject({ funcionou: false, erro: expect.stringContaining("o mesmo registro duas vezes") });
    }
    // Confirmada na leitura do quarto e cancelada na releitura por id.
    const leitor = (porId: Record<string, unknown>): LeitorBeds24 => ({
      reservas: async (f) => ({ itens: [lida(f.ids ? porId : {})], divergencias: [], lidoEm: "2026-12-22T12:00:00.000Z" }),
      calendario: async () => ({ itens: [], divergencias: [], lidoEm: "" }),
      quartos: async () => ({ itens: [], divergencias: [], lidoEm: "" }),
    });
    expect(await procurarReservaDoSite(leitor({ status: "cancelled" }), { ...ALVO, idsConhecidos: ["98765"] })).toMatchObject({ funcionou: false, erro: expect.stringContaining("voltou diferente em duas leituras") });
    // O mesmo registro, igual nas duas leituras: conta uma vez.
    const igual = await procurarReservaDoSite(leitor({}), { ...ALVO, idsConhecidos: ["98765"] });
    if (!igual.funcionou) throw new Error(igual.erro);
    expect(igual.comMarca.map((r) => r.idExterno)).toEqual(["98765"]);
  });
});

describe("regras de adoção (M8.3a, teste 10)", () => {
  const esperado = { quarto: ESPERADO.quarto, chegada: ESPERADO.chegada, saida: ESPERADO.saida };

  it("exatamente um registro com a marca, confirmed ou new, no quarto guardado e com as datas do esperado: adota", () => {
    expect(regraDeAdocao([lida()], esperado)).toMatchObject({ adotar: true, registro: { idExterno: "98765" } });
    expect(regraDeAdocao([lida({ status: "new" })], esperado)).toMatchObject({ adotar: true });
    // M8.3c: a marca só no nome ou nas notas, ou num registro de canal, não adota (o código anotado numa reserva de OTA).
    expect(regraDeAdocao([lida({ infoItems: [], notes: `Ver ${CODIGO}` })], esperado)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "98765" });
    expect(regraDeAdocao([lida({ channel: "Airbnb" })], esperado)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "98765" });
    expect(regraDeAdocao([lida({ apiSource: undefined })], esperado)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "98765" });
  });

  it("hóspede já na casa: a chegada explícita acha o registro de entrada passada, e ele é adotado", async () => {
    const f = falso(registro({ arrival: "2026-12-20" }));
    const b = await procurarReservaDoSite(f, ALVO);
    if (!b.funcionou) throw new Error(b.erro);
    expect(f.filtrosLidos[0]).toMatchObject({ chegadaExata: "2026-12-20" });
    expect(regraDeAdocao(b.comMarca, esperado)).toMatchObject({ adotar: true });
  });

  it("black com o código, cancelled com o código, outro quarto ou outras datas: marca em registro inesperado (nenhum POST)", () => {
    for (const o of [{ status: "black" }, { status: "cancelled" }, { status: "request" }, { roomId: 654321 }, { arrival: "2026-12-21" }, { departure: "2026-12-28" }]) {
      expect(regraDeAdocao([lida(o)], esperado)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "98765" });
    }
    // Sem esperado (nenhuma criação pedida), nada se adota.
    expect(regraDeAdocao([lida()], null)).toEqual({ adotar: false, motivo: "marca_em_registro_inesperado", id: "98765" });
  });

  it("dois registros com a marca (um deles pode até bater): duplicada, com os ids; nenhum: nenhum", () => {
    expect(regraDeAdocao([lida(), lida({ id: 11, status: "black" })], esperado)).toEqual({ adotar: false, motivo: "duplicada", ids: ["11", "98765"] });
    expect(regraDeAdocao([lida(), lida()], esperado)).toMatchObject({ adotar: true });
    expect(regraDeAdocao([], esperado)).toEqual({ adotar: false, motivo: "nenhum" });
  });
});

describe("comparação com o esperado (desenho 4.3 e 5.2)", () => {
  it("igual, mudada (datas, quarto, situação, pessoas), cancelada e apagada", () => {
    const lido = lidoDoRegistro(lida());
    expect(lido).toEqual({ quarto: "123456", chegada: "2026-12-20", saida: "2026-12-27", hospedes: 4, situacao: "confirmada" });
    expect(diferencaNoBeds24(ESPERADO, lido)).toBeNull();
    expect(diferencaNoBeds24(ESPERADO, { ...lido, saida: "2026-12-28" })).toEqual({ motivo: "mudada_no_beds24", soPessoas: false });
    expect(diferencaNoBeds24(ESPERADO, { ...lido, quarto: "1" })).toEqual({ motivo: "mudada_no_beds24", soPessoas: false });
    expect(diferencaNoBeds24(ESPERADO, { ...lido, situacao: "bloqueio" })).toEqual({ motivo: "mudada_no_beds24", soPessoas: false });
    expect(diferencaNoBeds24(ESPERADO, { ...lido, hospedes: 5 })).toEqual({ motivo: "mudada_no_beds24", soPessoas: true });
    expect(diferencaNoBeds24(ESPERADO, { ...lido, situacao: "cancelada" })).toEqual({ motivo: "cancelada_no_beds24", soPessoas: false });
    expect(diferencaNoBeds24(ESPERADO, null)).toEqual({ motivo: "apagada_no_beds24", soPessoas: false });
    // O cancelamento conferido: as pessoas não contam; reativada por fora é mudada.
    const cancelado: EsperadoBeds24 = { ...ESPERADO, hospedes: null, situacao: "cancelada" };
    expect(diferencaNoBeds24(cancelado, { ...lido, situacao: "cancelada", hospedes: 1 })).toBeNull();
    expect(diferencaNoBeds24(cancelado, lido)).toEqual({ motivo: "mudada_no_beds24", soPessoas: false });
  });

  it("a marca do registro ligado: a desta reserva confere; sem marca legível, marca ilegível; outro código ou o ensaio, mudada (D11)", () => {
    expect(diferencaNaMarca({ referenciaScl: "SCL-7K2QXM", ensaio: false }, "SCL-7K2QXM")).toBeNull();
    expect(diferencaNaMarca({ referenciaScl: null, ensaio: false }, "SCL-7K2QXM")).toBe("marca_ilegivel");
    expect(diferencaNaMarca({ referenciaScl: "SCL-ABCDEF", ensaio: false }, "SCL-7K2QXM")).toBe("mudada_no_beds24");
    expect(diferencaNaMarca({ referenciaScl: null, ensaio: true }, "SCL-7K2QXM")).toBe("mudada_no_beds24");
    expect(diferencaNaMarca({ referenciaScl: "SCL-7K2QXM", ensaio: true }, "SCL-7K2QXM")).toBe("mudada_no_beds24");
  });

  it("a assinatura do SCL de agora segue a régua (quarto guardado, datas, pessoas, situação); outra situação não compara", () => {
    const r = { estado: "confirmada" as const, checkin: ESPERADO.chegada, checkout: ESPERADO.saida, hospedes: 4 };
    expect(assinaturaAtualDoScl(r, ESPERADO.quarto)).toBe(assinaturaEsperado(ESPERADO));
    expect(assinaturaAtualDoScl({ ...r, checkout: "2026-12-28" }, ESPERADO.quarto)).not.toBe(assinaturaEsperado(ESPERADO));
    expect(assinaturaAtualDoScl({ ...r, estado: "cancelada" }, ESPERADO.quarto)).toBe(assinaturaEsperado({ ...ESPERADO, situacao: "cancelada" }));
    expect(assinaturaAtualDoScl({ ...r, estado: "pedido" }, ESPERADO.quarto)).toBeNull();
  });
});
