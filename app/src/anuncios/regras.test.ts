import { describe, expect, it } from "vitest";
import { compararAnuncios, validarAnuncio, type ReferenciaComparacao } from "./regras";

const entrada = { canal: "airbnb", situacao: "publicado", titulo: "Studio de teste", url: "https://www.airbnb.com.br/rooms/123", descricao: "Teste", fotos: "https://images.example.com/a.jpg", precoBase: "250,50" };
describe("validação dos anúncios", () => {
  it("converte centavos e mantém ausente diferente de zero; deduplica links preservando ordem", () => {
    expect(validarAnuncio({ ...entrada, fotos: `${entrada.fotos}\n${entrada.fotos}` })).toMatchObject({ ok: true, dados: { precoBase: 25050, fotos: [entrada.fotos] } });
    expect(validarAnuncio({ ...entrada, precoBase: "" })).toMatchObject({ ok: true, dados: { precoBase: null } });
    expect(validarAnuncio({ ...entrada, precoBase: "0" }).ok).toBe(false);
  });
  it.each(["javascript:alert(1)", "http://www.airbnb.com/rooms/1", "https://airbnb.com.evil.com/1", "https://user:senha@airbnb.com/1", "https://booking.com/hotel/a"])("recusa link indevido: %s", url => expect(validarAnuncio({ ...entrada, url }).ok).toBe(false));
  it.each(["data:image/png;base64,AAAA", "https://127.0.0.1/x", "https://localhost/x", "https://files.internal/x", "https://[::1]/x"])("recusa foto indevida: %s", fotos => expect(validarAnuncio({ ...entrada, fotos }).ok).toBe(false));
  it("recusa canal/situação desconhecidos e limites de texto, preço e fotos", () => {
    for (const e of [{ canal: "site" }, { situacao: "toString" }, { titulo: "a".repeat(201) }, { descricao: "a".repeat(10001) }, { precoBase: "-1" }, { precoBase: "1000001" }, { fotos: Array.from({ length: 31 }, (_, n) => `https://images.example.com/${n}`).join("\n") }]) expect(validarAnuncio({ ...entrada, ...e }).ok).toBe(false);
  });
});
const referencia: ReferenciaComparacao = { nome: "Airbnb", situacao: "publicado", titulo: "Studio", descricao: "Um lugar tranquilo", fotos: ["https://images.example.com/a"], precoBase: 25000 };
describe("comparação honesta", () => {
  it("ignora espaços e não transforma ausência em diferença ou em zero", () => {
    expect(compararAnuncios([referencia, { ...referencia, nome: "Site", titulo: " Studio ", descricao: "Um  lugar\ntranquilo", fotos: [], precoBase: null }])).toEqual([]);
  });
  it("compara pares e sinaliza preço, texto, situação e referência das fotos", () => {
    const avisos = compararAnuncios([referencia, { ...referencia, nome: "Booking", titulo: "Outro", descricao: "Outra", fotos: ["https://images.example.com/b"], precoBase: 30000, situacao: "pausado" }]);
    expect(avisos).toHaveLength(5);
    expect(avisos.join(" ")).toContain("confira visualmente");
    expect(avisos.join(" ")).toContain("taxas e regras");
  });
  it("não compara com anúncio explicitamente inexistente nem acusa situação desconhecida", () => {
    expect(compararAnuncios([referencia, { ...referencia, nome: "Site", situacao: "inexistente", titulo: "Outra coisa", precoBase: 5 }])).toEqual([]);
    expect(compararAnuncios([referencia, { ...referencia, situacao: "nao_conferido" }])).toEqual([]);
  });
});
