/**
 * Reserva paga do site no Beds24 (M8.3a) — a marca do SCL na leitura (desenho 3.5; seção 10, teste 9), com a marca ambígua,
 * a fonte da marca, o id do ensaio e a origem pela API do M8.3c (desenho 5.2), e a versão falsa
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
    // Desde o M8.3c, o `{ code: "SCL" }` sem texto é a marca ilegível (`marcaAmbigua`, desenho 5.2), não ausente: a reserva
    // continua lida, sem referência.
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

describe("marca ambígua, fonte da marca, ensaio e origem (M8.3c, desenho 5.2 \"Para o M8.3c\")", () => {
  it("a marca ambígua fica separada de \"sem marca\": dois info items SCL diferentes, o info item SCL com texto inválido, o nome e as notas com códigos diferentes", () => {
    for (const o of [
      { infoItems: [{ code: "SCL", text: "SCL-7K2QXM" }, { code: "SCL", text: "SCL-ABCDEF" }] },
      { infoItems: [{ code: "SCL", text: "SCL-7K2QX0" }] },
      { infoItems: [{ code: "SCL", text: "lixo" }] },
      // O info item inválido não cai no reforço do texto: a marca existe e não dá para ler.
      { infoItems: [{ code: "SCL", text: "lixo" }], notes: "SCL-7K2QXM" },
      // Também o info item SCL sem texto, ou com um texto que não é texto (desenho 5.2: "presente e ilegível").
      { infoItems: [{ code: "SCL" }] },
      { infoItems: [{ code: "SCL", text: null }], notes: "SCL-7K2QXM" },
      { infoItems: [{ code: " scl ", text: 123 }], lastName: "SCL-7K2QXM" },
      { infoItems: [{ code: "SCL", text: "SCL-7K2QXM" }, { code: "SCL", text: "SCL-7K2QX0" }] },
      { lastName: "SCL-7K2QXM", notes: "SCL-ABCDEF" },
    ]) expect(lida(o)).toMatchObject({ referenciaScl: null, marcaAmbigua: true, marcaFonte: null });
    // Sem marca nenhuma não é ambígua.
    expect(lida({})).toMatchObject({ referenciaScl: null, marcaAmbigua: false, marcaFonte: null });
    expect(lida({ infoItems: [{ code: "OUTRO", text: "SCL-7K2QXM" }] })).toMatchObject({ referenciaScl: null, marcaAmbigua: false });
    // O info item de código torto (que não é texto) continua contando como ausente, nunca como ambíguo: vale o reforço do
    // texto, como antes.
    expect(lida({ infoItems: [{ code: 1, text: "SCL-7K2QXM" }] })).toMatchObject({ referenciaScl: null, marcaAmbigua: false });
    expect(lida({ infoItems: [{ code: 1, text: "SCL-7K2QXM" }], notes: "SCL-7K2QXM" })).toMatchObject({ referenciaScl: "SCL-7K2QXM", marcaFonte: "texto" });
    // O info item SCL sem texto é a marca ilegível, ao lado de um de código torto: ambígua (antes, contava como ausente).
    expect(lida({ infoItems: [{ code: "SCL" }, { code: 1, text: "SCL-7K2QXM" }] })).toMatchObject({ referenciaScl: null, marcaAmbigua: true, marcaFonte: null });
  });

  it("a fonte da marca: o info item ou o texto (só a do info item adota e cancela duplicada)", () => {
    expect(lida({ infoItems: [{ code: "SCL", text: "SCL-7K2QXM" }] })).toMatchObject({ referenciaScl: "SCL-7K2QXM", marcaFonte: "info", marcaAmbigua: false });
    expect(lida({ infoItems: [{ code: "SCL", text: "SCL-7K2QXM" }, { code: "scl", text: " SCL-7K2QXM " }] })).toMatchObject({ referenciaScl: "SCL-7K2QXM", marcaFonte: "info" });
    expect(lida({ notes: "Reserva paga pelo site SCL-7K2QXM" })).toMatchObject({ referenciaScl: "SCL-7K2QXM", marcaFonte: "texto", marcaAmbigua: false });
    expect(lida({ lastName: "SCL-7K2QXM (não altere aqui)", notes: "SCL-7K2QXM" })).toMatchObject({ referenciaScl: "SCL-7K2QXM", marcaFonte: "texto" });
    // O info item vale antes do texto, mesmo com outro código nas notas.
    expect(lida({ infoItems: [{ code: "SCL", text: "SCL-ABCDEF" }], notes: "SCL-7K2QXM" })).toMatchObject({ referenciaScl: "SCL-ABCDEF", marcaFonte: "info", marcaAmbigua: false });
  });

  it("o id da operação do ensaio sai do info item SCL-ENSAIO só quando é um uuid (um só)", () => {
    const op = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(lida({ infoItems: [{ code: "SCL-ENSAIO", text: op }] })).toMatchObject({ ensaio: true, ensaioOperacaoId: op });
    expect(lida({ infoItems: [{ code: "SCL-ENSAIO", text: op.toUpperCase() }] }).ensaioOperacaoId).toBe(op);
    expect(lida({ infoItems: [{ code: "SCL-ENSAIO", text: "x" }] })).toMatchObject({ ensaio: true, ensaioOperacaoId: null });
    expect(lida({ infoItems: [{ code: "SCL-ENSAIO", text: op }, { code: "SCL-ENSAIO", text: "00000000-0000-4000-8000-000000000000" }] }).ensaioOperacaoId).toBeNull();
    expect(lida({ notes: op }).ensaioOperacaoId).toBeNull();
  });

  it("a origem pela API (apiSource): curta e só com caracteres seguros; senão, null", () => {
    expect(lida({ apiSource: " API v2 " }).origemApi).toBe("API v2");
    expect(lida({ apiSource: "booking.com/api_v2:1" }).origemApi).toBe("booking.com/api_v2:1");
    expect(lida({}).origemApi).toBeNull();
    for (const apiSource of ["", "<script>", "a".repeat(41), "Hóspede", "x\ny", { a: 1 }]) expect(lida({ apiSource }).origemApi).toBeNull();
    // O canal desconhecido continua "outro", com ou sem a origem.
    expect(lida({ channel: "expedia", apiSource: "API" })).toMatchObject({ canal: "outro", origemApi: "API" });
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

  it("a escrita de reservas é a do M8.3c: o calendário e as reservas, cada uma com o seu método", () => {
    // M8.3c (muda junto, desenho 10): o falso ganhou `gravarReservas` e `prepararToken` (o contrato `EscritorReservasBeds24`)
    // e os auxiliares privados da escrita (criar, modificar, ocupar o calendário e contar o que as gravadas ocupam). Nenhum
    // método apaga.
    const metodos = Object.getOwnPropertyNames(Beds24Falso.prototype).filter((m) => m !== "constructor").sort();
    expect(metodos).toEqual(["calendario", "checar", "credencial", "criar", "diasDaSala", "escreverCalendario", "gravarReservas", "guardarDias", "modificar", "ocupadasNaNoite", "ocupar", "prepararToken", "quartos", "reservas"]);
  });
});
