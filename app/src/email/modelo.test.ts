import { describe, expect, it } from "vitest";
import { comecaComSaudacao, escaparHtml, fraseDoModelo, montarEmail, primeiroNome } from "./modelo";

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

  it("modelo editável que já cumprimenta: a saudação dele sai e entra a do esqueleto, pelo primeiro nome; o contato igual ao padrão não repete", () => {
    expect(comecaComSaudacao("Olá, Maria. Segue o relatório.")).toBe(true);
    expect(comecaComSaudacao("  Bom dia! Tudo bem?")).toBe(true);
    expect(comecaComSaudacao("Segue o relatório de outubro.")).toBe(false);
    expect(comecaComSaudacao("Olavo chegou.")).toBe(false);
    // O modelo padrão do fechamento, já preenchido com o nome completo: fica só a frase do meio.
    expect(fraseDoModelo("Olá, Dona Exemplo.\n\nSegue em anexo o relatório de outubro de 2026 dos seus imóveis.\n\nQualquer dúvida, é só responder este e-mail.")).toBe("Segue em anexo o relatório de outubro de 2026 dos seus imóveis.");
    expect(fraseDoModelo("Olá, {nome}. Segue o relatório de {mes}.")).toBe("Segue o relatório de {mes}.");
    expect(fraseDoModelo("Bom dia! Tudo bem?")).toBe("Tudo bem?");
    expect(fraseDoModelo("Oi. Segue.")).toBe("Segue.");
    expect(fraseDoModelo("Olá, Maria.")).toBe("");
    expect(fraseDoModelo("Olavo chegou.")).toBe("Olavo chegou.");
    // Saudação sem nome: só ela sai; a mensagem que vem depois fica inteira.
    expect(fraseDoModelo("Olá, segue em anexo o relatório.")).toBe("Segue em anexo o relatório.");
    expect(fraseDoModelo("Bom dia, segue o fechamento.")).toBe("Segue o fechamento.");
    expect(fraseDoModelo("Olá, tudo bem? Segue o relatório.")).toBe("Tudo bem? Segue o relatório.");
    expect(fraseDoModelo("Olá, Segue em anexo o relatório de outubro.")).toBe("Segue em anexo o relatório de outubro.");
    // Com nome (próprio ou marcador), sai o nome junto.
    expect(fraseDoModelo("Olá {nome}, segue o relatório.")).toBe("Segue o relatório.");
    expect(fraseDoModelo("Prezada Maria da Silva,\nSegue o relatório.")).toBe("Segue o relatório.");
    // Contato diferente do padrão fica; igual ao contato passado sai.
    expect(fraseDoModelo("Segue.\n\nFale com a Ana se precisar.")).toBe("Segue.\n\nFale com a Ana se precisar.");
    expect(fraseDoModelo("Segue.\n\nFale com a Ana se precisar.", "Fale com a Ana se precisar.")).toBe("Segue.");
    const m = montarEmail({ empresa: "SCL", nome: "Maria Fictícia", frase: "Olá, Maria Fictícia. Segue o relatório de outubro.\n\nBoa leitura.\n\nQualquer dúvida, é só responder este e-mail." });
    expect(m.texto).toBe("Olá, Maria.\n\nSegue o relatório de outubro.\n\nBoa leitura.\n\nQualquer dúvida, é só responder este e-mail.\n\nEquipe SCL");
    expect(m.texto.match(/Olá/g)).toHaveLength(1);
    expect(m.texto.match(/Qualquer dúvida/g)).toHaveLength(1);
    expect(m.html).toContain("<h1");
    expect(m.html.match(/Olá/g)).toHaveLength(1);
    expect(m.html.match(/Qualquer dúvida/g)).toHaveLength(1);
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
