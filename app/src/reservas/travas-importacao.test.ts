import { describe, expect, it } from "vitest";
import { chavesDaImportacao } from "./travas-importacao";
const dados = { origem: "airbnb", codigoCanal: "TESTE-A" };
const comuns = (a: string[], b: string[]) => a.filter(c => b.includes(c));
describe("travas de importação", () => {
  it("permite reservas independentes da mesma organização em paralelo", () => {
    const a = chavesDaImportacao("org", "csv", "1", dados);
    const b = chavesDaImportacao("org", "csv", "2", { ...dados, codigoCanal: "TESTE-B" });
    expect(comuns(a, b)).toEqual([]);
  });
  it("CSV e Beds24 compartilham trava de canal mesmo com IDs diferentes", () => {
    expect(comuns(chavesDaImportacao("org", "csv", "1", dados), chavesDaImportacao("org", "beds24", "99", dados))).toHaveLength(1);
  });
  it("a identidade da fonte permanece protegida sem código ou quando ele muda", () => {
    const a = chavesDaImportacao("org", "beds24", "1", dados);
    const b = chavesDaImportacao("org", "beds24", "1", { origem: "airbnb", codigoCanal: "" });
    expect(comuns(a, b)).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
  it("isola organizações e canais e mantém ordem determinística", () => {
    const a = chavesDaImportacao("org", "csv", "1", dados);
    expect(comuns(a, chavesDaImportacao("outra", "csv", "1", dados))).toEqual([]);
    expect(comuns(a, chavesDaImportacao("org", "beds24", "2", { ...dados, origem: "booking" }))).toEqual([]);
    expect(a).toEqual([...a].sort());
  });
  it("não confunde delimitadores nem aplica deduplicação de canal a fontes manuais", () => {
    const a = chavesDaImportacao("a:b", "csv", "c", dados);
    const b = chavesDaImportacao("a", "b:csv", "c", dados);
    expect(comuns(a, b)).toEqual([]);
    expect(chavesDaImportacao("org", "manual", "1", dados)).toHaveLength(1);
  });
});
