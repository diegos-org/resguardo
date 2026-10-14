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
      "cancelamentoDevolvidoPelaDisputa",
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

describe("textos da alteração de reserva paga (M8.2d): editáveis, com texto-base", () => {
  const chaves = ["alteracaoEmAndamento", "alteracaoAguardaConfirmacao", "alteracaoPolitica", "alteracaoConfirmada", "devolucaoAguardaLiberacao", "alteracaoSemDevolucao", "alteracaoNaoAplicada", "alteracaoNaoVale"] as const;
  const obrigatorias = ["alteracaoEmAndamento", "alteracaoAguardaConfirmacao", "alteracaoNaoAplicada", "alteracaoPolitica", "devolucaoAguardaLiberacao"];

  it("as chaves novas existem com texto-base dentro do limite; as que o hóspede precisa ler não ficam vazias", () => {
    for (const k of chaves) {
      const campo = CAMPOS_TEXTOS_SITE.find((c) => c.chave === k);
      expect(campo, k).toBeTruthy();
      expect(TEXTOS_SITE_INICIAIS[k].length, k).toBeGreaterThan(10);
      expect(TEXTOS_SITE_INICIAIS[k].length, k).toBeLessThanOrEqual(campo!.limite);
      expect(TEXTOS_SITE_OBRIGATORIOS.includes(k), k).toBe(obrigatorias.includes(k));
    }
    expect(TEXTOS_SITE_INICIAIS.alteracaoEmAndamento).toBe("Pague a diferença até esse horário para confirmar a alteração; até lá, a sua reserva continua como está.");
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, alteracaoConfirmada: "", alteracaoSemDevolucao: "", alteracaoNaoVale: "" })).toMatchObject({ ok: true });
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, alteracaoEmAndamento: " ", devolucaoAguardaLiberacao: "" })).toEqual({
      ok: false,
      erros: { alteracaoEmAndamento: "Este texto não pode ficar vazio.", devolucaoAguardaLiberacao: "Este texto não pode ficar vazio." },
    });
  });

  it("o texto-base não cita o Beds24, não traz valor, data nem dado pessoal; a devolução que espera a liberação nunca diz que já foi pedida", () => {
    for (const k of chaves) expect(TEXTOS_SITE_INICIAIS[k], k).not.toMatch(/beds24|R\$|\d|@/i);
    expect(TEXTOS_SITE_INICIAIS.devolucaoAguardaLiberacao).not.toMatch(/já pedimos/i);
    expect(TEXTOS_SITE_INICIAIS.devolucaoAguardaLiberacao).toContain("quando ele liberar o seu pagamento");
  });
});

describe("texto do pagamento em conferência (M8.2e): editável, com texto-base, pode ficar vazio", () => {
  it("a chave existe com o texto-base do desenho dentro de 240 caracteres; vazia vale (a linha some)", () => {
    const campo = CAMPOS_TEXTOS_SITE.find((c) => c.chave === "pagamentoEmConferencia");
    expect(campo).toBeTruthy();
    expect(campo!.limite).toBe(240);
    expect(TEXTOS_SITE_INICIAIS.pagamentoEmConferencia).toBe(
      "O pagamento desta reserva está em conferência com o Mercado Pago. Se tiver qualquer dúvida sobre a cobrança, fale com a nossa equipe.",
    );
    expect(TEXTOS_SITE_INICIAIS.pagamentoEmConferencia.length).toBeLessThanOrEqual(240);
    expect(TEXTOS_SITE_OBRIGATORIOS.includes("pagamentoEmConferencia")).toBe(false);
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, pagamentoEmConferencia: "" })).toMatchObject({ ok: true });
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, pagamentoEmConferencia: "x".repeat(241) })).toMatchObject({ ok: false, erros: { pagamentoEmConferencia: "Máximo de 240 caracteres." } });
  });

  it("o texto-base nunca diz contestação nem acusa, nem cita o Beds24, valores ou dados pessoais", () => {
    expect(TEXTOS_SITE_INICIAIS.pagamentoEmConferencia).not.toMatch(/contesta|chargeback|fraude|disputa|beds24|R\$|\d|@/i);
  });
});

describe("textos da busca em todas as casas (M7.9): editáveis, com o texto-base do estudo", () => {
  it("olho, título, aviso, frases sem casa e a do contato com texto-base dentro do limite; o aviso e o contato podem ficar vazios, as frases sem casa não", () => {
    for (const k of ["buscaOlho", "buscaTitulo", "buscaAviso", "buscaSemCasa", "buscaSemCasasNoSite", "buscaContato"] as const) {
      const campo = CAMPOS_TEXTOS_SITE.find((c) => c.chave === k)!;
      expect(campo).toBeTruthy();
      expect(TEXTOS_SITE_INICIAIS[k].length).toBeGreaterThan(0);
      expect(TEXTOS_SITE_INICIAIS[k].length).toBeLessThanOrEqual(campo.limite);
    }
    expect([TEXTOS_SITE_INICIAIS.buscaOlho, TEXTOS_SITE_INICIAIS.buscaTitulo]).toEqual(["Sua busca", "Encontre seu lugar."]);
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, buscaAviso: "", buscaOlho: "", buscaContato: "" })).toMatchObject({ ok: true });
    expect(TEXTOS_SITE_OBRIGATORIOS).toEqual(expect.arrayContaining(["buscaSemCasa", "buscaSemCasasNoSite"]));
    expect(TEXTOS_SITE_OBRIGATORIOS).not.toContain("buscaContato");
    expect(validarTextosSite({ ...TEXTOS_SITE_INICIAIS, buscaSemCasa: " ", buscaSemCasasNoSite: "" })).toEqual({
      ok: false,
      erros: { buscaSemCasa: "Este texto não pode ficar vazio.", buscaSemCasasNoSite: "Este texto não pode ficar vazio." },
    });
  });

  it("o texto-base não cita o Beds24 nem diz que alguma casa está livre ou que cabe o grupo (a situação é a da consulta de cada casa)", () => {
    for (const k of ["buscaOlho", "buscaTitulo", "buscaAviso", "buscaSemCasa", "buscaSemCasasNoSite", "buscaContato"] as const)
      expect(TEXTOS_SITE_INICIAIS[k]).not.toMatch(/beds24|dispon[ií]ve(l|is)|livres?\b/i);
    // O estudo dizia "ainda não confirmada"; aqui a situação de cada casa é a real, e nada fica reservado pela busca.
    expect(TEXTOS_SITE_INICIAIS.buscaAviso).toContain("Nada fica reservado pela busca");
    // A lista inclui casas sem capacidade cadastrada: o aviso diz "podem receber", nunca que todas recebem o grupo.
    expect(TEXTOS_SITE_INICIAIS.buscaAviso).toContain("podem receber o seu grupo");
    expect(TEXTOS_SITE_INICIAIS.buscaAviso).not.toMatch(/por partes|agenda de agora/);
  });
});
