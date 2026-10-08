import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { conferirAssinatura, lerCabecalhoAssinatura, manifestoAssinatura, momentoDaAssinatura } from "./assinatura";

const SEGREDO = "segredo-ficticio-de-teste";
const hmac = (manifesto: string, segredo = SEGREDO) => createHmac("sha256", segredo).update(manifesto).digest("hex");

describe("cabeçalho x-signature", () => {
  it("lê ts e v1 em qualquer ordem, com espaços e chaves extras", () => {
    const v1 = "a".repeat(64);
    expect(lerCabecalhoAssinatura(`ts=1742505638683,v1=${v1}`)).toEqual({ ts: "1742505638683", v1 });
    expect(lerCabecalhoAssinatura(` v1 = ${v1.toUpperCase()} , ts = 1781009491 , v2=xyz`)).toEqual({ ts: "1781009491", v1 });
    expect(lerCabecalhoAssinatura(`v1=${v1}`)).toEqual({ ts: null, v1 });
  });

  it("malformado → null", () => {
    const v1 = "b".repeat(64);
    for (const ruim of [undefined, null, "", "   ", "ts=1", `ts=1,v1=${"z".repeat(64)}`, `ts=1,v1=${"a".repeat(63)}`, `ts=1,v1=${v1},v1=${v1}`, `=x,v1=${v1}`, `ts,v1=${v1}`, `ts=abc,v1=${v1}`, `ts=,v1=${v1}`, `ts=1,v1=${v1}`.padEnd(2000, ",")]) {
      expect(lerCabecalhoAssinatura(ruim)).toBeNull();
    }
  });

  it("momento do ts aceita segundos e milissegundos", () => {
    const v1 = "c".repeat(64);
    expect(momentoDaAssinatura(`ts=1742505638683,v1=${v1}`)?.toISOString()).toBe("2025-03-20T21:20:38.683Z");
    expect(momentoDaAssinatura(`ts=1781009491,v1=${v1}`)?.toISOString()).toBe("2026-06-09T12:51:31.000Z");
    expect(momentoDaAssinatura(`v1=${v1}`)).toBeNull();
    expect(momentoDaAssinatura("lixo")).toBeNull();
  });

  it("manifesto só com as partes presentes, na ordem id, request-id, ts", () => {
    expect(manifestoAssinatura("ORD1", "req-1", "123")).toBe("id:ORD1;request-id:req-1;ts:123;");
    expect(manifestoAssinatura(null, "req-1", "123")).toBe("request-id:req-1;ts:123;");
    expect(manifestoAssinatura("ORD1", null, null)).toBe("id:ORD1;");
  });
});

describe("conferirAssinatura", () => {
  const dataId = "ORD01JQ4S4KY8HWQ6NA5PXB65B3D3";
  const xRequestId = "bb56a2f1-6aae-46ac-982e-9dcd3581d08e";
  const ts = "1742505638683";

  it("confere com o data.id como veio (como o SDK faz)", () => {
    const v1 = hmac(`id:${dataId};request-id:${xRequestId};ts:${ts};`);
    expect(conferirAssinatura({ xSignature: `ts=${ts},v1=${v1}`, xRequestId, dataId, segredo: SEGREDO })).toBe(true);
  });

  it("confere com o data.id em minúsculas (como a documentação manda)", () => {
    const v1 = hmac(`id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`);
    expect(conferirAssinatura({ xSignature: `v1=${v1},ts=${ts}`, xRequestId, dataId, segredo: SEGREDO })).toBe(true);
  });

  it("v1 em maiúsculas também confere", () => {
    const v1 = hmac(`id:${dataId};request-id:${xRequestId};ts:${ts};`).toUpperCase();
    expect(conferirAssinatura({ xSignature: `ts=${ts},v1=${v1}`, xRequestId, dataId, segredo: SEGREDO })).toBe(true);
  });

  it("partes ausentes ficam fora do manifesto", () => {
    const semRequest = hmac(`id:${dataId};ts:${ts};`);
    expect(conferirAssinatura({ xSignature: `ts=${ts},v1=${semRequest}`, xRequestId: null, dataId, segredo: SEGREDO })).toBe(true);
    const semTs = hmac(`id:${dataId};request-id:${xRequestId};`);
    expect(conferirAssinatura({ xSignature: `v1=${semTs}`, xRequestId, dataId, segredo: SEGREDO })).toBe(true);
    // Sem o request-id no manifesto, a assinatura com ele não confere.
    const comRequest = hmac(`id:${dataId};request-id:${xRequestId};ts:${ts};`);
    expect(conferirAssinatura({ xSignature: `ts=${ts},v1=${comRequest}`, xRequestId: undefined, dataId, segredo: SEGREDO })).toBe(false);
  });

  it("recusa assinatura adulterada, de outro segredo, outro id, outro ts ou outro request-id", () => {
    const certo = hmac(`id:${dataId};request-id:${xRequestId};ts:${ts};`);
    const base = { xSignature: `ts=${ts},v1=${certo}`, xRequestId, dataId, segredo: SEGREDO };
    expect(conferirAssinatura(base)).toBe(true);
    expect(conferirAssinatura({ ...base, segredo: "outro-segredo" })).toBe(false);
    expect(conferirAssinatura({ ...base, dataId: "ORD01OUTRO" })).toBe(false);
    expect(conferirAssinatura({ ...base, xRequestId: "outro" })).toBe(false);
    expect(conferirAssinatura({ ...base, xSignature: `ts=1742505638684,v1=${certo}` })).toBe(false);
    const trocado = (certo[0] === "0" ? "1" : "0") + certo.slice(1);
    expect(conferirAssinatura({ ...base, xSignature: `ts=${ts},v1=${trocado}` })).toBe(false);
  });

  it("segredo vazio, cabeçalho malformado ou nada assinável → false", () => {
    const certo = hmac(`id:${dataId};request-id:${xRequestId};ts:${ts};`);
    const base = { xSignature: `ts=${ts},v1=${certo}`, xRequestId, dataId, segredo: SEGREDO };
    expect(conferirAssinatura({ ...base, segredo: "" })).toBe(false);
    expect(conferirAssinatura({ ...base, segredo: null })).toBe(false);
    expect(conferirAssinatura({ ...base, segredo: undefined })).toBe(false);
    expect(conferirAssinatura({ ...base, xSignature: null })).toBe(false);
    expect(conferirAssinatura({ ...base, xSignature: `ts=${ts}` })).toBe(false);
    expect(conferirAssinatura({ ...base, xSignature: certo })).toBe(false);
    expect(conferirAssinatura({ ...base, dataId: "x".repeat(300) })).toBe(false);
    // Só o ts assinado não conta: o aviso precisa identificar a order.
    const soTs = hmac(`ts:${ts};`);
    expect(conferirAssinatura({ xSignature: `ts=${ts},v1=${soTs}`, xRequestId: null, dataId: null, segredo: SEGREDO })).toBe(false);
  });
});
