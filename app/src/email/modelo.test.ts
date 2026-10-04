import { describe, expect, it } from "vitest";
import { comecaComSaudacao, escaparHtml, montarEmail, primeiroNome } from "./modelo";

describe("esqueleto dos e-mails (M5.7): saudação, frase, destaque, lista curta, próximo passo, assinatura", () => {
  it("texto e HTML na mesma ordem; só o primeiro nome; até cinco linhas; sem destaque nem link nada sobra", () => {
    const m = montarEmail({
      empresa: "Sua Casa Leblon",
      nome: "Maria Fictícia da Silva",
      frase: "Segue o fechamento de outubro.\n\nO relatório completo está anexo.",
      destaque: { rotulo: "Repasse do mês", valor: "R$ 722,50", nota: "Pix em 02/11/2026" },
      valores: [{ rotulo: "Bruto das reservas", valor: "R$ 1.000,00" }, { rotulo: "Sua parte", valor: "R$ 722,50" }],
      linhas: ["um", "dois", "três", "quatro", "cinco", "seis (não entra)"],
      proximoPasso: "O extrato por reserva está no portal.",
      link: { texto: "Abrir o portal", url: "https://exemplo.test/portal?a=1&b=2" },
    });
    expect(m.texto).toBe(
      [
        "Olá, Maria.",
        "",
        "Segue o fechamento de outubro.",
        "",
        "O relatório completo está anexo.",
        "",
        "Repasse do mês: R$ 722,50 (Pix em 02/11/2026)",
        "",
        "Bruto das reservas: R$ 1.000,00",
        "Sua parte: R$ 722,50",
        "",
        "- um",
        "- dois",
        "- três",
        "- quatro",
        "- cinco",
        "",
        "O extrato por reserva está no portal.",
        "",
        "Abrir o portal: https://exemplo.test/portal?a=1&b=2",
        "",
        "Qualquer dúvida, é só responder este e-mail.",
        "",
        "Equipe Sua Casa Leblon",
      ].join("\n"),
    );
    // HTML: a mesma ordem, a marca na faixa, o destaque antes da tabela e da lista, o botão com o link escapado.
    const ordem = ["Sua Casa Leblon", "Olá, Maria.", "Segue o fechamento de outubro.", "Repasse do mês", "R$ 722,50", "Bruto das reservas", "<li", "O extrato por reserva", "https://exemplo.test/portal?a=1&amp;b=2", "Qualquer dúvida", "Equipe Sua Casa Leblon"];
    const posicoes = ordem.map((t) => m.html.indexOf(t));
    expect(posicoes.every((x) => x >= 0)).toBe(true);
    expect([...posicoes].sort((x, y) => x - y)).toEqual(posicoes);
    expect(m.html).not.toContain("seis (não entra)");
    expect(m.html).toContain("<!doctype html>");
    expect(m.html).not.toContain("<img");
    // Mínimo: só saudação, frase, contato e assinatura.
    const minimo = montarEmail({ empresa: "SCL", nome: "", frase: "Segue." });
    expect(minimo.texto).toBe("Olá.\n\nSegue.\n\nQualquer dúvida, é só responder este e-mail.\n\nEquipe SCL");
    expect(minimo.html).not.toContain("<ul");
    expect(minimo.html).not.toContain("<a ");
  });

  it("modelo editável que já cumprimenta não ganha segunda saudação; o primeiro parágrafo vira o título no HTML", () => {
    expect(comecaComSaudacao("Olá, Maria. Segue o relatório.")).toBe(true);
    expect(comecaComSaudacao("  Bom dia! Tudo bem?")).toBe(true);
    expect(comecaComSaudacao("Segue o relatório de outubro.")).toBe(false);
    expect(comecaComSaudacao("Olavo chegou.")).toBe(false);
    const m = montarEmail({ empresa: "SCL", nome: "Maria Fictícia", frase: "Olá, Maria. Segue o relatório de outubro.\n\nBoa leitura." });
    expect(m.texto.startsWith("Olá, Maria. Segue o relatório de outubro.\n\nBoa leitura.\n\n")).toBe(true);
    expect(m.texto.match(/Olá/g)).toHaveLength(1);
    expect(m.html).toContain("<h1");
    expect(m.html.match(/Olá/g)).toHaveLength(1);
  });

  it("nada do que vem dos dados vira HTML: nomes e textos são escapados", () => {
    const m = montarEmail({ empresa: "<Empresa> & Cia", nome: "<b>Zé</b>", frase: 'Texto com <script>alert("x")</script>', linhas: ["a < b"], assinatura: "Ana & Bia" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("&lt;Empresa&gt; &amp; Cia");
    expect(m.html).toContain("Olá, &lt;b&gt;Zé&lt;/b&gt;.");
    expect(m.html).toContain("a &lt; b");
    expect(m.html).toContain("Ana &amp; Bia");
    expect(m.texto).toContain('Texto com <script>alert("x")</script>');
    expect(escaparHtml(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
    expect(primeiroNome("  Carlos Alberto ")).toBe("Carlos");
    expect(primeiroNome("")).toBe("");
  });
});
