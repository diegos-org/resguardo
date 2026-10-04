import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalizarSecoes } from "@/configuracoes/como-funciona";
import { DocumentoComoFunciona } from "./DocumentoComoFunciona";

const versao = { numero: 2, data: "2026-10-06", autorId: null, secoes: { ...normalizarSecoes(null), oQueFazemos: "A {empresa} cuida.\n\nVocê acompanha.", duvidas: "Fale com a {empresa}." } };
const dados = [
  {
    proprietarioId: "p1",
    nome: "Dona",
    imoveis: [
      { codigo: "403", nome: "Quatro", contrato: { tipo: "Gestão completa", comissao: "15%", desde: "2025-01-01" } },
      { codigo: "102", nome: "Um", contrato: null },
    ],
    periodicidade: { proprietarioId: "p1", escolha: null, efetiva: "mensal" as const, nome: "Mensal", descricao: "no dia 1º", tiposContrato: ["gestao_completa" as const], proximaData: "2026-11-01" },
  },
];
const acao = async () => {};
const soTexto = (html: string) => html.replace(/<[^>]+>/g, "");

describe("documento 'Como funciona' no portal (M5.6)", () => {
  it("mostra as seções com o nome da empresa (seção vazia não aparece), os dados do contrato e o pedido de aceite quando falta", () => {
    const html = renderToStaticMarkup(<DocumentoComoFunciona versao={versao} empresa="SCL" dados={dados} donos={[{ nome: "Dona", aceite: null, ultimo: null }]} aceitar={acao} />);
    const texto = soTexto(html);
    expect(texto).toContain("Versão 2, de 06/10/2026");
    expect(texto).toContain("A SCL cuida.");
    expect(texto).toContain("Você acompanha.");
    expect(texto).toContain("Fale com a SCL.");
    expect(texto).not.toContain("Se o seu contrato é marketplace");
    expect(texto).toContain("403 · Quatro: Gestão completa, comissão de 15%, desde 01/01/2025");
    expect(texto).toContain("102 · Um: sem contrato em vigor hoje");
    expect(texto).toContain("Repasses: Mensal — no dia 1º (padrão do contrato; você pode mudar no portal, em Extrato e repasses).");
    expect(texto).toContain("Dona: ainda sem aceite.");
    expect(html).toContain('name="versao" value="2"');
    expect(html).toContain('name="aceito"');
    expect(html).toContain("Registrar o meu aceite");
  });

  it("aceito: mostra quem e quando, sem formulário; versão antiga aceita pede a nova; sem ação não há formulário", () => {
    const aceitoEm = new Date("2026-10-07T15:00:00Z");
    const aceito = renderToStaticMarkup(<DocumentoComoFunciona versao={versao} empresa="SCL" dados={[]} donos={[{ nome: "Dona", aceite: { aceitoEm, email: "dona@example.com" }, ultimo: { versao: 2, aceitoEm } }]} aceitar={acao} />);
    expect(soTexto(aceito)).toMatch(/Dona: versão 2 aceita em 07\/10\/2026,? 12:00 \(dona@example\.com\)\./);
    expect(aceito).not.toContain('name="aceito"');
    const velha = soTexto(
      renderToStaticMarkup(<DocumentoComoFunciona versao={versao} empresa="SCL" dados={[]} donos={[{ nome: "Dona", aceite: null, ultimo: { versao: 1, aceitoEm } }]} aceitar={acao} mensagem={{ tipo: "erro", texto: "O documento mudou" }} />),
    );
    expect(velha).toMatch(/Dona: a versão 1 foi aceita em 07\/10\/2026,? 12:00; o texto mudou em 06\/10\/2026 — leia e aceite a versão 2\./);
    expect(velha).toContain("O documento mudou");
    expect(renderToStaticMarkup(<DocumentoComoFunciona versao={versao} empresa="SCL" dados={[]} donos={[{ nome: "Dona", aceite: null, ultimo: null }]} />)).not.toContain("<form");
  });
});
