import { describe, expect, it } from "vitest";
import { lerCabecalho, lerCsv, lerLinha, MODELO_CSV } from "./csv";

describe("lerCsv", () => {
  it("detecta ; e , e trata aspas, BOM, CRLF e linhas vazias", () => {
    expect(lerCsv('﻿a;b;c\r\n1;"x;y";"diz ""oi"""\r\n\r\n')).toEqual([
      ["a", "b", "c"],
      ["1", "x;y", 'diz "oi"'],
    ]);
    expect(lerCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(lerCsv('a,b\n"linha\nquebrada",2')).toEqual([
      ["a", "b"],
      ["linha\nquebrada", "2"],
    ]);
  });
});

describe("cabeçalho", () => {
  it("aceita nomes variados, com acento e maiúsculas", () => {
    const c = lerCabecalho(["Imóvel", "Canal", "Código da reserva", "Check-in", "Saída", "Valor Total", "Coluna estranha"]);
    expect(c.faltando).toEqual([]);
    expect(c.mapa).toMatchObject({ imovel: 0, origem: 1, codigoCanal: 2, checkin: 3, checkout: 4, valorBruto: 5 });
    expect(c.ignoradas).toEqual(["Coluna estranha"]);
    expect(lerCabecalho(["imovel", "entrada"]).faltando).toEqual(["origem", "codigoCanal", "checkout"]);
  });
});

describe("linhas", () => {
  const [cabecalho, ...linhas] = lerCsv(MODELO_CSV);
  const cab = lerCabecalho(cabecalho);

  it("o modelo é lido sem erros: datas, centavos, origem e id estável", () => {
    const l = lerLinha(linhas[0], cab, 2);
    if (!l.ok) throw new Error(l.erros.join(" "));
    expect(l).toMatchObject({
      imovel: "403",
      idFonte: "airbnb:HMEXEMPLO1",
      dados: { origem: "airbnb", estado: "confirmada", checkin: "2026-10-10", checkout: "2026-10-14", hospedes: 2, valorBruto: 240000, taxaCanal: 36000, valorLiquido: null },
    });
    expect(lerLinha(linhas[1], cab, 3).ok).toBe(true);
  });

  it("aponta cada problema da linha, sem supor", () => {
    const ruim = ["", "hotel", "", "talvez", "31/02/2026", "2026-10-01", "dois", "Fulano", "", "", "mil", "", ""];
    const l = lerLinha(ruim, cab, 5);
    expect(l.ok).toBe(false);
    if (!l.ok) {
      expect(l.numero).toBe(5);
      expect(l.erros.join(" ")).toMatch(/Falta o imóvel.*Origem "hotel".*código da reserva.*Situação "talvez".*entrada inválida.*hóspedes.*valor bruto/);
    }
  });

  it("situação em branco = confirmada; whatsapp = direta; saída antes da entrada é erro", () => {
    const base = ["403", "WhatsApp", "W1", "", "2026-10-10", "2026-10-12", "", "", "", "", "", "", ""];
    const ok = lerLinha(base, cab, 2);
    expect(ok).toMatchObject({ ok: true, dados: { origem: "direta", estado: "confirmada", hospedes: null } });
    const inv = lerLinha([...base.slice(0, 4), "2026-10-12", "2026-10-10", ...base.slice(6)], cab, 2);
    expect(inv).toMatchObject({ ok: false, erros: ["A saída deve ser depois da entrada."] });
  });
});
