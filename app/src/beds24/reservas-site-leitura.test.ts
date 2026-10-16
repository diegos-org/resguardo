/**
 * Reserva paga do site no Beds24 (M8.3a) — a marca do SCL na leitura (desenho 3.5; seção 10, teste 9) e a versão falsa
 * ampliada só na leitura (info items com `incluirInfo`, filtros novos, escopos da credencial). Sem rede.
 */
import { describe, expect, it } from "vitest";
import { Beds24Falso, ESCOPOS_ESPERADOS_FALSO } from "./falso";
import { INFO_ENSAIO_SCL, INFO_MARCA_SCL, normalizarReserva } from "./normalizar";
import { avaliarEscoposBeds24 } from "./reservas-site-regras";

const registro = (o: Record<string, unknown> = {}) => ({ id: 98765, propertyId: 100, roomId: 123456, status: "confirmed", arrival: "2026-12-20", departure: "2026-12-27", numAdult: 4, numChild: 0, ...o });
const lida = (o: Record<string, unknown>) => {
  const n = normalizarReserva(registro(o));
  if (!n.ok) throw new Error(n.d.motivo);
  return n.r;
};

describe("marca do SCL na normalização (M8.3a, teste 9)", () => {
  it("a referência sai do info item SCL", () => {
    expect(lida({ infoItems: [{ id: 1, code: INFO_MARCA_SCL, text: "SCL-7K2QXM" }] })).toMatchObject({ referenciaScl: "SCL-7K2QXM", ensaio: false });
    // Código e texto com espaço ou o código em minúsculas continuam sendo a marca.
    expect(lida({ infoItems: [{ code: " scl ", text: " SCL-7K2QXM " }] }).referenciaScl).toBe("SCL-7K2QXM");
  });

  it("como reforço, sai do nome (Site / SCL-XXXXXX) ou das notas", () => {
    expect(lida({ firstName: "Site", lastName: "SCL-7K2QXM (não altere aqui)" }).referenciaScl).toBe("SCL-7K2QXM");
    expect(lida({ notes: "Reserva paga pelo site SCL-7K2QXM: não altere aqui, mude pelo SCL" }).referenciaScl).toBe("SCL-7K2QXM");
    // O info item vale antes do nome.
    expect(lida({ infoItems: [{ code: "SCL", text: "SCL-ABCDEF" }], notes: "SCL-7K2QXM" }).referenciaScl).toBe("SCL-ABCDEF");
  });

  it("sem marca legível: null (nada inventado)", () => {
    expect(lida({}).referenciaScl).toBeNull();
    // Info item com outro código, texto que não é um código válido, alfabeto ambíguo, código grudado.
    expect(lida({ infoItems: [{ code: "OUTRO", text: "SCL-7K2QXM" }] }).referenciaScl).toBeNull();
    expect(lida({ infoItems: [{ code: "SCL", text: "SCL-7K2QX0" }] }).referenciaScl).toBeNull();
    expect(lida({ notes: "ref XSCL-7K2QXM e SCL-7K2QXMZ" }).referenciaScl).toBeNull();
    expect(lida({ comments: "SCL-7K2QXM" }).referenciaScl).toBeNull();
    // Dois códigos diferentes: não dá para saber qual vale.
    expect(lida({ infoItems: [{ code: "SCL", text: "SCL-7K2QXM" }, { code: "SCL", text: "SCL-ABCDEF" }] }).referenciaScl).toBeNull();
    expect(lida({ lastName: "SCL-7K2QXM", notes: "SCL-ABCDEF" }).referenciaScl).toBeNull();
    // O mesmo código repetido continua valendo.
    expect(lida({ infoItems: [{ code: "SCL", text: "SCL-7K2QXM" }, { code: "SCL", text: "SCL-7K2QXM" }] }).referenciaScl).toBe("SCL-7K2QXM");
  });

  it("info items tortos contam como ausentes: a reserva continua sendo lida (nunca some da importação por isso)", () => {
    for (const infoItems of ["SCL-7K2QXM", { code: "SCL", text: "SCL-7K2QXM" }, [null, 1, { code: 1, text: "SCL-7K2QXM" }, { code: "SCL" }]]) {
      const n = normalizarReserva(registro({ infoItems }));
      expect(n.ok).toBe(true);
      if (n.ok) expect(n.r).toMatchObject({ referenciaScl: null, ensaio: false });
    }
  });

  it("o ensaio é reconhecido pelo info item SCL-ENSAIO", () => {
    expect(lida({ infoItems: [{ code: INFO_ENSAIO_SCL, text: "00000000-0000-4000-8000-000000000000" }] })).toMatchObject({ ensaio: true, referenciaScl: null });
    expect(lida({ infoItems: [{ code: "scl-ensaio", text: "x" }] }).ensaio).toBe(true);
    expect(lida({ notes: "SCL-ENSAIO" }).ensaio).toBe(false);
  });

  it("a marca não leva dado pessoal para fora da normalização: as notas não viram campo", () => {
    const r = lida({ notes: "SCL-7K2QXM telefone (21) 99999-0000" });
    expect(JSON.stringify(r)).not.toContain("99999");
  });
});

describe("versão falsa ampliada (só leitura)", () => {
  const falso = () => {
    const b = new Beds24Falso(() => new Date("2026-10-16T12:00:00Z"));
    b.bookings = [
      registro({ id: 1, infoItems: [{ code: "SCL", text: "SCL-7K2QXM" }] }),
      registro({ id: 2, roomId: 777, lastName: "SCL-ABCDEF" }),
      registro({ id: 3, arrival: "2026-12-21", departure: "2026-12-27", notes: "outra reserva" }),
      registro({ id: 4, status: "cancelled", infoItems: [{ code: "SCL-ENSAIO", text: "op" }] }),
    ];
    return b;
  };

  it("os info items só voltam quando a leitura pede (includeInfoItems), como na API", async () => {
    const b = falso();
    expect((await b.reservas({ ids: ["1"] })).itens[0].referenciaScl).toBeNull();
    expect((await b.reservas({ ids: ["1"], incluirInfo: true })).itens[0].referenciaScl).toBe("SCL-7K2QXM");
    expect((await b.reservas({ ids: ["4"], incluirInfo: true })).itens[0]).toMatchObject({ ensaio: true, estado: "cancelada" });
    // O registro guardado não muda.
    expect(b.bookings[0].infoItems).toEqual([{ code: "SCL", text: "SCL-7K2QXM" }]);
  });

  it("quarto, chegada exata (vale no lugar do intervalo) e busca por texto; registra os filtros pedidos", async () => {
    const b = falso();
    const ids = async (f: Parameters<Beds24Falso["reservas"]>[0]) => (await b.reservas(f)).itens.map((r) => r.idExterno);
    expect(await ids({ quarto: "123456", chegadaExata: "2026-12-20" })).toEqual(["1", "4"]);
    expect(await ids({ chegadaExata: "2026-12-21", chegadaDe: "2026-12-22" })).toEqual(["3"]);
    expect(await ids({ pesquisa: "scl-abcdef" })).toEqual(["2"]);
    // A busca por texto não olha os info items.
    expect(await ids({ pesquisa: "SCL-7K2QXM" })).toEqual([]);
    expect(b.filtrosLidos.at(-1)).toEqual({ pesquisa: "SCL-7K2QXM" });
  });

  it("escopos da credencial configuráveis, pela mesma normalização do HTTP", async () => {
    const b = falso();
    expect(await b.credencial()).toEqual({ escopos: ESCOPOS_ESPERADOS_FALSO, ilegiveis: [], lidoEm: "2026-10-16T12:00:00.000Z" });
    expect(avaliarEscoposBeds24(await b.credencial()).situacao).toBe("em_ordem");
    b.detalhesCredencial = { validToken: true, token: { scopes: ["all:bookings"] } };
    expect(avaliarEscoposBeds24(await b.credencial()).situacao).toBe("escopo_excessivo");
    b.detalhesCredencial = { formatoNovo: true };
    expect(await b.credencial()).toMatchObject({ escopos: null });
    b.falhar = new Error("fora do ar");
    await expect(b.credencial()).rejects.toThrow("fora do ar");
  });

  it("não ganhou escrita de reservas (é do M8.3c): só o calendário escreve", () => {
    const metodos = Object.getOwnPropertyNames(Beds24Falso.prototype).filter((m) => m !== "constructor").sort();
    expect(metodos).toEqual(["calendario", "checar", "credencial", "escreverCalendario", "quartos", "reservas"]);
  });
});
