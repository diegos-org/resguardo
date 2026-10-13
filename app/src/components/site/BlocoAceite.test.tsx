import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AceiteNaPagina } from "@/site/aceites";
import { BlocoAceite } from "./BlocoAceite";

const base: AceiteNaPagina = {
  versoes: { termos: 2, privacidade: 1, cancelamento: 3 },
  aceito: null,
  resumo: [{ tipo: "paragrafo", texto: "RESUMO" }],
  prazo: { tipo: "integral_ate", data: "2026-10-26" },
};
const html = (a: AceiteNaPagina) => renderToStaticMarkup(<BlocoAceite aceite={a} fuso="America/Sao_Paulo" />);
const semTags = (h: string) => h.replace(/<[^>]+>/g, "");

describe("a caixa do aceite antes de pagar", () => {
  it("o pagamento da cotação (M7.4): aceita os Termos e a Política de cancelamento e leu a Privacidade, com as versões em vigor escondidas", () => {
    const h = html(base);
    expect(semTags(h)).toContain("Li e aceito os Termos de uso e a Política de cancelamento, e li a Política de privacidade.");
    expect(semTags(h)).toContain("Resumo da Política de cancelamento:");
    expect(h).toContain('name="versaoTermos" value="2"');
    expect(h).toContain('name="versaoPrivacidade" value="1"');
    expect(h).toContain('name="versaoCancelamento" value="3"');
  });

  it("a diferença de uma alteração (M8.2d, D11): só os Termos e a Privacidade em vigor; a reserva continua na política aceita (versão e dia), que é a escondida", () => {
    const h = html({ ...base, versoes: { termos: 2, privacidade: 1, cancelamento: 1 }, daReserva: { versao: 1, em: "2026-09-20T13:00:00.000Z" } });
    expect(semTags(h)).toContain("Li e aceito os Termos (versão 2) e li a Privacidade (versão 1). A sua reserva continua na Política de cancelamento versão 1, aceita em 20/09.");
    expect(semTags(h)).toContain("Resumo da Política de cancelamento da sua reserva:");
    expect(semTags(h)).not.toContain("Li e aceito os Termos de uso e a Política de cancelamento");
    expect(h).toContain('href="/cancelamento?versao=1"');
    expect(h).toContain('href="/termos?versao=2"');
    expect(h).toContain('name="versaoCancelamento" value="1"');
    expect(h).toContain('<input type="checkbox" required="" name="aceite" value="sim"/>');
  });
});
