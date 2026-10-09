import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { blocosDoDocumento } from "@/configuracoes/paginas-legais-texto";
import { DocumentoLegal } from "./DocumentoLegal";

it("cada tipo de bloco: título em <h2>, parágrafo com as quebras de linha, lista com marcadores e lista numerada que começa no primeiro número", () => {
  const h = renderToStaticMarkup(
    <DocumentoLegal blocos={blocosDoDocumento("## Quem somos\n\nPrimeira linha\nsegunda linha\n\n- um\n- dois\n\n3. três\n4. quatro")} />,
  );
  expect(h).toContain("<h2>Quem somos</h2>");
  expect(h).toMatch(/<p class="[^"]*">Primeira linha\nsegunda linha<\/p>/);
  expect(h).toContain("<ul><li>um</li><li>dois</li></ul>");
  expect(h).toContain('<ol start="3"><li>três</li><li>quatro</li></ol>');
});

it("os marcadores da prévia do painel só ganham destaque com marcarFaltas; o texto é sempre texto (nada vira HTML)", () => {
  const blocos = blocosDoDocumento("CNPJ [falta: CNPJ] e [não existe: {{cnpjj}}]\n\n- <b>negrito</b> [não vale aqui: {{dias_reembolso_integral}}]");
  const site = renderToStaticMarkup(<DocumentoLegal blocos={blocos} />);
  expect(site).not.toContain("<mark");
  expect(site).toContain("&lt;b&gt;negrito&lt;/b&gt;");
  const painel = renderToStaticMarkup(<DocumentoLegal blocos={blocos} marcarFaltas />);
  expect(painel.match(/<mark/g)).toHaveLength(3);
  expect(painel).toMatch(/<mark class="[^"]*">\[falta: CNPJ\]<\/mark>/);
  expect(painel).toContain("&lt;b&gt;negrito&lt;/b&gt;");
});
