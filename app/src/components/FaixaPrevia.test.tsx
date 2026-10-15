// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";
import { FaixaPrevia, TEXTO_FAIXA_PREVIA } from "./FaixaPrevia";

/** O ambiente simulado: VERCEL_ENV e NODE_ENV de cada caso (vazio = sem a variável). */
function ambiente(vercel: string, node = "test") {
  vi.unstubAllEnvs();
  vi.stubEnv("VERCEL_ENV", vercel);
  vi.stubEnv("NODE_ENV", node);
}
const pagina = () => renderToStaticMarkup(RootLayout({ children: <main id="conteudo">Miolo</main> } as LayoutProps<"/">));

describe('faixa "Prévia de teste" (M7.12)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it("aparece nas prévias, no `vercel dev` e no computador de desenvolvimento, com o texto fixo", () => {
    for (const [vercel, node] of [["preview", "production"], ["development", "development"], ["", "development"], ["", "test"]]) {
      ambiente(vercel, node);
      const h = renderToStaticMarkup(<FaixaPrevia />);
      expect(h, `${vercel || "sem VERCEL_ENV"} / ${node}`).toBe(`<p class="scl-previa" role="note">${TEXTO_FAIXA_PREVIA}</p>`);
    }
  });

  it("não aparece no deploy de produção, com um VERCEL_ENV inesperado nem fora da Vercel com NODE_ENV=production", () => {
    for (const [vercel, node] of [["production", "production"], ["staging", "production"], ["", "production"]]) {
      ambiente(vercel, node);
      expect(renderToStaticMarkup(<FaixaPrevia />), `${vercel || "sem VERCEL_ENV"} / ${node}`).toBe("");
    }
  });

  it("o texto só afirma o que o código garante: não diz dados fictícios nem banco separado, e não cita o Beds24", () => {
    expect(TEXTO_FAIXA_PREVIA).toBe("Prévia de teste · não é o site de verdade · nenhuma cobrança real");
    expect(TEXTO_FAIXA_PREVIA).not.toMatch(/fict[ií]c|banco|Beds24/i);
  });

  it("layout raiz: a faixa vem primeiro no corpo de toda página, sem nada focável, e some na produção", () => {
    ambiente("preview", "production");
    const corpo = document.createElement("div");
    corpo.innerHTML = pagina();
    const faixa = corpo.firstElementChild;
    expect(faixa?.className).toBe("scl-previa");
    expect(faixa?.textContent).toBe(TEXTO_FAIXA_PREVIA);
    expect(faixa?.querySelector("a, button, input, select, textarea, summary, [tabindex]")).toBeNull();
    expect(faixa?.nextElementSibling?.id).toBe("conteudo");
    ambiente("production", "production");
    const producao = pagina();
    expect(producao).not.toContain("scl-previa");
    expect(producao).toContain('<body><main id="conteudo">Miolo</main></body>');
  });
});
