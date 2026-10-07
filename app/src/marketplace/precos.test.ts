import { describe, expect, it } from "vitest";
import { descontoBp, descontoDoSite, mesmosPesos, PESOS_PADRAO_ANTIGO, PRECOS_MARKETPLACE_PADRAO, type PrecosMarketplace, precosDeJson, simular, validarFormPrecos } from "./precos";

// Partes iguais (1/1/1): o modelo como nasceu em 4/10; o padrão desde 7/10 é 1/1/2 (testes abaixo).
const P: PrecosMarketplace = { ...PRECOS_MARKETPLACE_PADRAO, pesos: { ...PESOS_PADRAO_ANTIGO } };

describe("padrão 6/3/3 (Diego, 7/10/2026, M12.5)", () => {
  it("R$ 1.000: da margem de 12 pontos, hóspede 3% de desconto, proprietário 3% a mais e SCL 6%", () => {
    const D = PRECOS_MARKETPLACE_PADRAO;
    expect(D.pesos).toEqual({ hospede: 1, proprietario: 1, scl: 2 });
    const s = simular(100000, D);
    expect(s.partes).toEqual({ hospede: 3000, proprietario: 3000, scl: 6000 });
    expect(s.site).toEqual({ desconto: 3000, hospedePaga: 97000, taxa: 3880, scl: 6000, proprietarioRecebe: 87120 });
    expect(s.site.taxa + s.site.scl + s.site.proprietarioRecebe).toBe(s.site.hospedePaga);
    // O proprietário fica com os 3% dele mais a taxa poupada sobre o desconto (4% de R$ 30 = R$ 1,20).
    expect(s.comparacao).toEqual({ hospedeEconomiza: 3000, proprietarioGanhaMais: 3120 });
    expect(descontoBp(D)).toBe(300);
    // Configuração nunca gravada usa o padrão novo; pesos gravados (mesmo os antigos) continuam valendo.
    expect(precosDeJson(null).pesos).toEqual(D.pesos);
    expect(precosDeJson({ pesos: { hospede: 1, proprietario: 1, scl: 1 } }).pesos).toEqual(PESOS_PADRAO_ANTIGO);
    expect(mesmosPesos(precosDeJson({ pesos: { hospede: 1, proprietario: 1, scl: 1 } }).pesos, PESOS_PADRAO_ANTIGO)).toBe(true);
    expect(mesmosPesos(D.pesos, PESOS_PADRAO_ANTIGO)).toBe(false);
  });
});

describe("modelo B em partes iguais (Diego, 4/10/2026)", () => {
  it("R$ 1.000: margem 12% rateada em três; hóspede paga 4% menos, SCL fica com 4%, proprietário recebe mais que na OTA", () => {
    const s = simular(100000, P);
    expect(s.margemReferencia).toBe(12000);
    expect(s.partes).toEqual({ hospede: 4000, proprietario: 4000, scl: 4000 });
    expect(s.airbnb).toEqual({ hospedePaga: 100000, taxa: 16000, proprietarioRecebe: 84000 });
    expect(s.booking).toEqual({ hospedePaga: 100000, taxa: 15000, proprietarioRecebe: 85000 });
    expect(s.site).toEqual({ desconto: 4000, hospedePaga: 96000, taxa: 3840, scl: 4000, proprietarioRecebe: 88160 });
    // Nada se perde: o que o hóspede paga = taxa + SCL + proprietário.
    expect(s.site.taxa + s.site.scl + s.site.proprietarioRecebe).toBe(s.site.hospedePaga);
    // O proprietário fica com a sua parte mais a taxa poupada sobre o desconto (4% de R$ 40 = R$ 1,60).
    expect(s.comparacao).toEqual({ hospedeEconomiza: 4000, proprietarioGanhaMais: 4160 });
    expect(s.avisos).toEqual([]);
  });

  it("exemplo do documento (R$ 1.650): todo mundo ganha e os centavos fecham", () => {
    const s = simular(165000, P);
    expect(s.margemReferencia).toBe(19800);
    expect(s.partes).toEqual({ hospede: 6600, proprietario: 6600, scl: 6600 });
    expect(s.site.hospedePaga).toBe(158400);
    expect(s.site.proprietarioRecebe).toBeGreaterThan(s.airbnb.proprietarioRecebe);
    expect(s.site.taxa + s.site.scl + s.site.proprietarioRecebe).toBe(s.site.hospedePaga);
  });

  it("pesos diferentes (40/30/30) e rateio sem perder centavo", () => {
    const p: PrecosMarketplace = { ...P, pesos: { hospede: 40, proprietario: 30, scl: 30 } };
    const s = simular(100001, p);
    expect(s.partes.hospede + s.partes.proprietario + s.partes.scl).toBe(s.margemReferencia);
    expect(s.partes.hospede).toBeGreaterThan(s.partes.scl);
    expect(s.site.taxa + s.site.scl + s.site.proprietarioRecebe).toBe(s.site.hospedePaga);
    expect(descontoBp(p)).toBe(480); // 12% × 40% = 4,8%
  });

  it("sem margem (taxa do pagamento ≥ taxa da OTA): site vende pelo preço cheio, com aviso; preço zero não avisa", () => {
    const s = simular(100000, { ...P, taxaPagamentoBp: 1600 });
    expect(s.margemReferencia).toBe(0);
    expect(s.site).toMatchObject({ desconto: 0, hospedePaga: 100000, scl: 0 });
    expect(s.avisos[0]).toContain("não há margem");
    expect(simular(0, P).avisos).toEqual([]);
    expect(descontoDoSite(0, P)).toBe(0);
    expect(descontoDoSite(190000, P)).toBe(7600);
    expect(descontoBp(P)).toBe(400);
    expect(() => simular(-1, P)).toThrow();
    expect(() => simular(10.5, P)).toThrow();
  });
});

describe("configuração", () => {
  it("lê o JSON tolerando lixo: campo inválido volta ao padrão; pesos todos zero voltam ao padrão", () => {
    expect(precosDeJson(null)).toEqual(PRECOS_MARKETPLACE_PADRAO);
    expect(precosDeJson({ taxaOtaBp: 1500, taxaPagamentoBp: "4", pesos: { hospede: 2, scl: 1 } })).toEqual({ ...PRECOS_MARKETPLACE_PADRAO, taxaOtaBp: 1500, pesos: { hospede: 2, proprietario: 1, scl: 1 } });
    // Configuração gravada sem pesos válidos: o padrão de quando ela foi gravada (1/1/1), nunca o novo em silêncio (M12.5).
    expect(precosDeJson({ pesos: { hospede: 0, proprietario: 0, scl: 0 } })).toEqual({ ...PRECOS_MARKETPLACE_PADRAO, pesos: PESOS_PADRAO_ANTIGO });
    expect(precosDeJson({ taxaBookingBp: 9999 })).toEqual({ ...PRECOS_MARKETPLACE_PADRAO, pesos: PESOS_PADRAO_ANTIGO });
    expect(precosDeJson({ taxaOtaBp: 1500, pesos: { hospede: 2, proprietario: 1, scl: "x" } }).pesos).toEqual({ hospede: 2, proprietario: 1, scl: 1 });
  });

  it("formulário: percentuais com vírgula e pesos inteiros; erros por campo, nunca padrão em silêncio", () => {
    const ok = validarFormPrecos({ taxaOta: "16", taxaBooking: "15", taxaPagamento: "3,98", pesoHospede: "1", pesoProprietario: "1", pesoScl: "1" });
    expect(ok).toEqual({ ok: true, precos: { taxaOtaBp: 1600, taxaBookingBp: 1500, taxaPagamentoBp: 398, pesos: { hospede: 1, proprietario: 1, scl: 1 } } });
    const ruim = validarFormPrecos({ taxaOta: "60", taxaBooking: "x", taxaPagamento: "4", pesoHospede: "0", pesoProprietario: "0", pesoScl: "0" });
    expect(ruim.ok).toBe(false);
    if (!ruim.ok) expect(Object.keys(ruim.erros).sort()).toEqual(["pesoHospede", "taxaBooking", "taxaOta"]);
    const peso = validarFormPrecos({ taxaOta: "16", taxaBooking: "15", taxaPagamento: "4", pesoHospede: "1,5", pesoProprietario: "101", pesoScl: "1" });
    expect(!peso.ok && Object.keys(peso.erros).sort()).toEqual(["pesoHospede", "pesoProprietario"]);
  });
});
