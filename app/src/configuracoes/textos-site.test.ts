import { describe, expect, it } from "vitest";
import { blocosDoTexto, CAMPOS_TEXTOS_SITE, partesDoTitulo, TEXTOS_SITE_INICIAIS, TEXTOS_SITE_OBRIGATORIOS, tituloSimples, validarTextosSite } from "./textos-site";

describe("textos do site (M7.5): destaque no título e blocos do texto", () => {
  it("palavra entre asteriscos vira destaque; sem asteriscos, uma parte só", () => {
    expect(partesDoTitulo("Um pouco de Rio. Um lugar *seu*.")).toEqual([
      { texto: "Um pouco de Rio. Um lugar ", destaque: false },
      { texto: "seu", destaque: true },
      { texto: ".", destaque: false },
    ]);
    expect(partesDoTitulo("Sem destaque")).toEqual([{ texto: "Sem destaque", destaque: false }]);
    expect(partesDoTitulo("*Tudo*")).toEqual([{ texto: "Tudo", destaque: true }]);
    expect(partesDoTitulo("")).toEqual([{ texto: "", destaque: false }]);
    expect(tituloSimples(TEXTOS_SITE_INICIAIS.titulo)).toBe("Um pouco de Rio. Um lugar seu.");
  });

  it("blocos separados por linha em branco; a primeira linha de um bloco com várias é o título", () => {
    expect(blocosDoTexto("")).toEqual([]);
    expect(blocosDoTexto("Só um parágrafo.")).toEqual([{ titulo: null, texto: "Só um parágrafo." }]);
    expect(blocosDoTexto("Preço justo\nSem a taxa das plataformas.\n\nAtendimento direto\nQuem responde é quem cuida da casa.\nSempre.\n\n  \nSem título aqui")).toEqual([
      { titulo: "Preço justo", texto: "Sem a taxa das plataformas." },
      { titulo: "Atendimento direto", texto: "Quem responde é quem cuida da casa.\nSempre." },
      { titulo: null, texto: "Sem título aqui" },
    ]);
  });

  it("os textos novos da capa (olho e chamada) são opcionais e respeitam o limite", () => {
    const v = validarTextosSite({ ...TEXTOS_SITE_INICIAIS, olho: "", chamada: "" });
    expect(v.ok).toBe(true);
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, olho: "x".repeat(61) })).toMatchObject({ ok: false, erros: { olho: "Máximo de 60 caracteres." } });
  });
});

describe("textos do pagamento por Pix (M8.2a): editáveis, com texto-base", () => {
  it("convite, Pix aguardando e pagamento sem as datas: texto-base dentro do limite e obrigatórios", () => {
    const chaves = ["pagamentoConvite", "pagamentoAguardando", "pagamentoSemDatas"] as const;
    for (const k of chaves) {
      const campo = CAMPOS_TEXTOS_SITE.find((c) => c.chave === k)!;
      expect(campo).toBeTruthy();
      expect(TEXTOS_SITE_INICIAIS[k].length).toBeGreaterThan(20);
      expect(TEXTOS_SITE_INICIAIS[k].length).toBeLessThanOrEqual(campo.limite);
      expect(TEXTOS_SITE_OBRIGATORIOS).toContain(k);
    }
    expect(TEXTOS_SITE_INICIAIS.pagamentoSemDatas).toBe("Recebemos seu pagamento, mas não conseguimos garantir as datas. A equipe vai falar com você e devolver o valor integral.");
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS })).toMatchObject({ ok: true });
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, pagamentoConvite: "  ", pagamentoSemDatas: "" })).toEqual({
      ok: false,
      erros: { pagamentoConvite: "Este texto não pode ficar vazio.", pagamentoSemDatas: "Este texto não pode ficar vazio." },
    });
    const limite = CAMPOS_TEXTOS_SITE.find((c) => c.chave === "pagamentoAguardando")!.limite;
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, pagamentoAguardando: "x".repeat(limite + 1) })).toMatchObject({ ok: false, erros: { pagamentoAguardando: `Máximo de ${limite} caracteres.` } });
    // Título continua com a mensagem própria.
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, titulo: "" })).toMatchObject({ ok: false, erros: { titulo: "O título não pode ficar vazio." } });
  });

  it("texto-base não cita o Beds24 nem promete o que o site não faz", () => {
    for (const k of ["pagamentoConvite", "pagamentoAguardando", "pagamentoSemDatas"] as const) expect(TEXTOS_SITE_INICIAIS[k]).not.toMatch(/beds24|cart[ãa]o/i);
  });
});

describe("textos do pagamento com cartão (M8.2b)", () => {
  it("o convite não cita a forma (vale para Pix e cartão) e os rótulos falam do pagamento no site", () => {
    expect(TEXTOS_SITE_INICIAIS.pagamentoConvite).toBe("Pague aqui mesmo: assim que o pagamento é aprovado, a reserva fica confirmada, sem precisar esperar a equipe.");
    expect(TEXTOS_SITE_INICIAIS.pagamentoConvite).not.toMatch(/pix/i);
    const rotulo = (k: string) => CAMPOS_TEXTOS_SITE.find((c) => c.chave === k)!.rotulo;
    expect(rotulo("pagamentoConvite")).toMatch(/^Pagamento no site:/);
    expect(rotulo("pagamentoSemDatas")).toMatch(/^Pagamento no site:/);
    expect(rotulo("pagamentoAguardando")).toMatch(/^Pagamento por Pix:/);
  });

  it("cartão em análise: editável, obrigatório, sem horário (a página mostra o prazo numa linha fixa) e sem citar o Beds24", () => {
    const campo = CAMPOS_TEXTOS_SITE.find((c) => c.chave === "pagamentoCartaoAnalise")!;
    expect(campo).toMatchObject({ limite: 400, linhas: 3 });
    expect(TEXTOS_SITE_OBRIGATORIOS).toContain("pagamentoCartaoAnalise");
    const texto = TEXTOS_SITE_INICIAIS.pagamentoCartaoAnalise;
    expect(texto).toContain("até 2 dias úteis");
    expect(texto.length).toBeLessThanOrEqual(campo.limite);
    expect(texto).not.toMatch(/\d{1,2}:\d{2}|beds24/i);
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, pagamentoCartaoAnalise: " " })).toMatchObject({ ok: false, erros: { pagamentoCartaoAnalise: "Este texto não pode ficar vazio." } });
  });
});

describe("textos do cancelamento (M8.2c): editáveis, com texto-base", () => {
  const chaves = CAMPOS_TEXTOS_SITE.map((c) => c.chave).filter((k) => k.startsWith("cancelamento"));

  it("as frases novas existem, com texto-base dentro do limite; as que o hóspede precisa ler não ficam vazias", () => {
    expect(chaves).toEqual([
      "cancelamentoSemTaxas",
      "cancelamentoDevolucaoPedida",
      "cancelamentoEstornoNoCartao",
      "cancelamentoVoltaPix",
      "cancelamentoVoltaCartao",
      "cancelamentoVoltaPorFora",
      "cancelamentoComAEquipe",
      "cancelamentoEmConferencia",
      "cancelamentoSemDevolucaoPrazo",
      "cancelamentoSemDevolucaoNaoComparecimento",
      "cancelamentoSemDevolucaoEquipe",
      "cancelamentoFecho",
      "cancelamentoPedidoRecebido",
      "cancelamentoMinhaReservaIntro",
    ]);
    for (const k of chaves) {
      const campo = CAMPOS_TEXTOS_SITE.find((c) => c.chave === k)!;
      expect(TEXTOS_SITE_INICIAIS[k].length, k).toBeGreaterThan(10);
      expect(TEXTOS_SITE_INICIAIS[k].length, k).toBeLessThanOrEqual(campo.limite);
    }
    expect(TEXTOS_SITE_INICIAIS.cancelamentoSemTaxas).toBe("sem desconto de taxas.");
    expect(TEXTOS_SITE_INICIAIS.cancelamentoPedidoRecebido).toBe("A equipe confirma com você, por escrito, o valor da devolução pela política que você aceitou.");
    const opcionais = ["cancelamentoFecho", "cancelamentoMinhaReservaIntro"];
    for (const k of chaves) expect(TEXTOS_SITE_OBRIGATORIOS.includes(k), k).toBe(!opcionais.includes(k));
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, cancelamentoFecho: "", cancelamentoMinhaReservaIntro: "" })).toMatchObject({ ok: true });
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, cancelamentoVoltaPix: " ", cancelamentoPedidoRecebido: "" })).toEqual({
      ok: false,
      erros: { cancelamentoVoltaPix: "Este texto não pode ficar vazio.", cancelamentoPedidoRecebido: "Este texto não pode ficar vazio." },
    });
  });

  it("o texto-base não cita o Beds24, não traz valor nem dado pessoal (as datas e os valores são do sistema)", () => {
    for (const k of chaves) expect(TEXTOS_SITE_INICIAIS[k], k).not.toMatch(/beds24|R\$|\d|@/i);
  });

  it("as frases que também vão para a mensagem ao hóspede ({decisao}) não dizem 'esta página' (no e-mail não há página na frente dele)", () => {
    for (const k of ["cancelamentoDevolucaoPedida", "cancelamentoEstornoNoCartao"] as const) {
      expect(TEXTOS_SITE_INICIAIS[k], k).not.toMatch(/esta página/i);
      expect(TEXTOS_SITE_INICIAIS[k], k).toContain("a página da sua reserva");
    }
  });
});
