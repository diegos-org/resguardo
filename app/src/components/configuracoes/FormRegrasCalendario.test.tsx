import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { REGRAS_CALENDARIO_PADRAO } from "@/calendario/regras-config";
import { FormRegrasCalendario } from "./FormRegrasCalendario";

const salvar = vi.fn(async () => ({}));

describe("Configurações → Calendário e preços: o prazo das datas de uma alteração (M8.2d)", () => {
  it("o campo próprio, com o padrão de 60 minutos e a faixa de 5 minutos a 48 horas, separado do prazo do visitante", () => {
    const h = renderToStaticMarkup(<FormRegrasCalendario regras={REGRAS_CALENDARIO_PADRAO} imoveis={[]} salvar={salvar} />);
    expect(h).toContain("Minutos que as novas datas de uma alteração de reserva paga pelo site ficam seguradas");
    expect(h).toContain('<input type="number" min="5" max="2880" name="siteMinutosHoldAlteracao" value="60"/>');
    expect(h).toContain("Ao preparar a alteração de uma reserva paga pelo site, as novas noites ficam seguradas por esse tempo (padrão 60 minutos, até 48 horas); o Pix da diferença estende o prazo. Não muda o tempo do site.");
    // O do visitante continua o dele.
    expect(h).toContain('<input type="number" min="5" max="240" name="siteMinutosHold" value="30"/>');
  });

  it("mostra o valor gravado", () => {
    const h = renderToStaticMarkup(<FormRegrasCalendario regras={{ ...REGRAS_CALENDARIO_PADRAO, site: { ...REGRAS_CALENDARIO_PADRAO.site, minutosHoldAlteracao: 240 } }} imoveis={[]} salvar={salvar} />);
    expect(h).toMatch(/name="siteMinutosHoldAlteracao"[^>]*value="240"/);
  });
});
