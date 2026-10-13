import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PrevisaoRepasse, Repasse } from "@/repasses/repasses";
import { linhasDosNumeros, NumerosDoRepasse } from "./NumerosDoRepasse";

const semAntecipado = { noites: 0, desconto: 0, estorno: 0, disputa: 0 };
const previsao = (over: Partial<PrevisaoRepasse>): PrevisaoRepasse =>
  ({ saldo: 72250, aDescontar: 0, contestado: 0, fora: 0, foraPorDisputa: 0, foraDividido: { presa: 0, seguradoJunto: 0, outras: 0 }, antecipadoSeparado: semAntecipado, repasse: null, ...over }) as PrevisaoRepasse;
const fechado = (foraDoFechamento: number) => ({ saldo: 72250, descontado: 0, contestado: 0, foraDoFechamento, antecipado: 0, mes: "2026-10-01" }) as Repasse;

describe("Financeiro → Repasses: o que ficou fora do fechamento, pelo motivo (M8.2e, aceite)", () => {
  it("mês já fechado: a parte presa por disputa sai com o motivo da disputa, nunca 'dinheiro ainda não com a empresa'", () => {
    const linhas = linhasDosNumeros(previsao({ repasse: fechado(72250), foraPorDisputa: 72250, foraDividido: { presa: 72250, seguradoJunto: 0, outras: 0 } }), []);
    expect(linhas).toContainEqual(["− Fora do fechamento (reserva em conferência: disputa do pagamento)", "R$ 722,50"]);
    expect(linhas.map(([k]) => k).join(" ")).not.toContain("dinheiro ainda não com a empresa");
  });

  it("o valor segurado que espera junto com a parte tem linha própria, com o sinal dele (nunca '-R$' no motivo da disputa)", () => {
    const p = previsao({ fora: -12750, foraPorDisputa: -85000, foraDividido: { presa: 0, seguradoJunto: -85000, outras: 72250 } });
    const linhas = linhasDosNumeros(p, []);
    expect(linhas).toContainEqual(["− Fora do fechamento (dinheiro ainda não com a empresa)", "R$ 722,50"]);
    expect(linhas).toContainEqual(["+ Valor segurado pela disputa do pagamento, fora deste repasse (espera junto com a parte da reserva)", "R$ 850,00"]);
    expect(linhas.map(([k]) => k).join(" ")).not.toContain("(reserva em conferência: disputa do pagamento)");
    const h = renderToStaticMarkup(<NumerosDoRepasse p={p} itensDoFechamento={[]} />);
    expect(h).not.toContain("-R$");
  });
});
