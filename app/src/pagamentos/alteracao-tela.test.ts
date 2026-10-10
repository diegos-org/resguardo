import { describe, expect, it } from "vitest";
import { type PreviaAlteracao, perguntaDaAlteracao } from "./alteracao";
import { previaAlteracaoParaTela, RESULTADOS_DA_ALTERACAO, resultadoDaAlteracao, rotaDaPrevia, textoDoResultadoDaAlteracao } from "./alteracao-tela";

const AGORA = new Date("2026-10-01T15:00:00Z"); // 12:00 em São Paulo
const zero = { bruto: 0, taxa: 0, comissao: 0, parte: 0 };
const politica = { versao: 1, data: "2026-09-20", diasReembolsoIntegral: 14, arrependimentoAteEntrada: true };
/** Exemplo A do desenho: 10/11→14/11 para 10/11→15/11 pela cotação; diferença R$ 400,00 (Pix 0,99%, comissão 15%). */
const aumento: PreviaAlteracao = {
  alteracaoId: null,
  reservaId: "r",
  reservaCodigo: "SCL-TESTE1",
  antes: { checkin: "2026-11-10", checkout: "2026-11-14", hospedes: 2, valor: 150000 },
  depois: { checkin: "2026-11-10", checkout: "2026-11-15", hospedes: 2, valor: 190000 },
  cotacao: { diarias: 190000, limpeza: 0, hospedeExtra: 0, valorCheio: 190000, desconto: 0, total: 190000, situacao: "disponivel", leituraEm: null },
  origemValor: "cotacao",
  motivoValor: null,
  diferenca: 40000,
  rumo: "aumento",
  valorNovo: 190000,
  quemPede: "hospede",
  noitesNovas: { inicio: "2026-11-14", fim: "2026-11-15" },
  holdMinutos: 60,
  holdAte: null,
  entradaDaPolitica: "2026-11-10",
  decisao: null,
  direito: null,
  base: null,
  escolha: null,
  valorADevolver: 0,
  politica,
  partes: [],
  financeiro: {
    antes: { bruto: 150000, taxa: -1485, comissao: 22277, parte: 126238 },
    depois: { bruto: 190000, taxa: -1485, comissao: 28277, parte: 160238 },
    porMes: [{ mes: "2026-11", antes: { bruto: 150000, taxa: -1485, comissao: 22277, parte: 126238 }, depois: { bruto: 190000, taxa: -1485, comissao: 28277, parte: 160238 } }],
    taxaDevolvida: null,
    taxaDesconhecida: true,
  },
  leitura: [],
  avisos: ["A taxa do pagamento da diferença fica conhecida depois do pagamento.", "Leitura do Mercado Pago de 01/10 às 11:58: aprovado."],
  assinatura: "0123456789abcdef",
  pergunta: "",
};
const comPergunta = (p: PreviaAlteracao) => ({ ...p, pergunta: perguntaDaAlteracao(p, "America/Sao_Paulo", AGORA) });
/** Exemplo B: 28/11→03/12 para 05/12→09/12, pela política (integral), R$ 300,00 de volta; o Pix liberado, a taxa conhecida. */
const reducao: PreviaAlteracao = {
  ...aumento,
  antes: { checkin: "2026-11-28", checkout: "2026-12-03", hospedes: 2, valor: 150000 },
  depois: { checkin: "2026-12-05", checkout: "2026-12-09", hospedes: 2, valor: 120000 },
  diferenca: -30000,
  rumo: "reducao",
  valorNovo: 120000,
  noitesNovas: { inicio: "2026-12-05", fim: "2026-12-09" },
  entradaDaPolitica: "2026-11-28",
  decisao: { calculado: "integral", base: "prazo", valorADevolver: 30000, integralAte: "2026-11-14", arrependimentoAte: "2026-10-08", entradaEm: new Date("2026-11-28T18:00:00Z"), comecou: false },
  direito: "integral",
  base: "prazo",
  valorADevolver: 30000,
  partes: [{ pagamentoId: "p1", forma: "pix", valor: 30000, taxa: 1485, rota: "pedida", aguardaLiberacao: false, liberacaoPrevista: null, pagoEm: new Date("2026-10-01T14:00:00Z") }],
  financeiro: { antes: { ...zero, bruto: 150000 }, depois: { ...zero, bruto: 120000 }, porMes: [], taxaDevolvida: 297, taxaDesconhecida: false },
  avisos: [],
};

describe("a prévia da alteração na tela (M8.2d, §9.2)", () => {
  it("aumento: hoje e depois, a diferença a pagar, as novas noites seguradas pelo prazo próprio, o financeiro por mês e a pergunta de segurar (sem 'Só segurar')", () => {
    const t = previaAlteracaoParaTela(comPergunta(aumento), AGORA);
    expect(t.hoje).toBe("Hoje: 10/11–14/11, 4 noites, 2 pessoas, R$ 1.500,00.");
    expect(t.depois).toBe("Depois: 10/11–15/11, 5 noites, 2 pessoas, R$ 1.900,00 (cotação do site).");
    expect(t.diferenca).toBe("Diferença: o hóspede paga R$ 400,00 na página da reserva.");
    expect(t.noitesNovas).toBe("Novas noites seguradas: 14/11–15/11 por 60 minutos.");
    expect(t.politica).toBe("Política aceita: versão 1 (continua valendo para a reserva; prazos contados da entrada de 10/11).");
    expect(t.botao).toBe("Segurar as novas datas e liberar o pagamento da diferença");
    expect(t.perguntaSoSegurar).toBeNull();
    expect(t.rota).toBe("aumento");
    expect(t.pergunta).toContain("até 13:00 e liberar para o hóspede pagar a diferença de R$ 400,00 na página da reserva?");
    expect(t.pergunta).not.toContain("proposta pela SCL");
    expect(t.financeiro).toContainEqual({ rotulo: "Comissão da SCL", antes: "R$ 222,77", depois: "R$ 282,77", diferenca: "+R$ 60,00" });
    expect(t.meses[0].mes).toBe("11/2026");
    expect(t.leitura).toEqual(["Leitura do Mercado Pago de 01/10 às 11:58: aprovado."]);
    expect(t.avisos).toEqual(["A taxa do pagamento da diferença fica conhecida depois do pagamento."]);
  });

  it("a SCL propõe e cobra pela cotação: a pergunta pede a confirmação de que o hóspede paga a diferença", () => {
    const t = previaAlteracaoParaTela(comPergunta({ ...aumento, quemPede: "empresa" }), AGORA);
    expect(t.pergunta).toContain("A alteração é proposta pela SCL: confirme que o hóspede paga a diferença.");
  });

  it("redução integral: a devolução pela política, como sai, a política com os prazos e 'Aplicar' ou 'Só segurar'", () => {
    const t = previaAlteracaoParaTela(comPergunta(reducao), AGORA);
    expect(t.diferenca).toBe("Diferença: devolução de R$ 300,00 pela política (pedido dentro do prazo de reembolso integral).");
    expect(t.politica).toBe("Política aceita: versão 1 — reembolso integral para pedidos até 14/11 (23h59), contando da entrada de 28/11; arrependimento até 08/10.");
    expect(t.comoSai).toEqual(["Pix de 01/10: R$ 300,00 — pelo Mercado Pago agora."]);
    expect(t.botao).toBe("Aplicar a alteração");
    expect(t.rota).toBe("pedida");
    expect(t.pergunta).toContain("Confirme que o hóspede aceitou por escrito");
    expect(t.pergunta).toContain("a diferença de R$ 300,00 é devolvida pelo Mercado Pago.");
    expect(t.pergunta).toContain("A taxa do Mercado Pago sobre a parte devolvida (R$ 2,97) sai da reserva");
    expect(t.perguntaSoSegurar).toBe(
      'Segurar as novas datas (05/12 a 09/12, 2 pessoas) até 13:00, sem aplicar? A reserva continua como está (28/11 a 03/12); depois que o hóspede aceitar por escrito, use "Aplicar a alteração", ou desista.',
    );
  });

  it("a rota escolhe o texto do resultado: esperando a liberação, mais de 78 dias, retida e o mesmo valor", () => {
    const parte = reducao.partes[0];
    expect(rotaDaPrevia({ ...reducao, partes: [{ ...parte, aguardaLiberacao: true, liberacaoPrevista: new Date("2026-10-20T15:00:00Z") }] })).toBe("liberacao");
    expect(rotaDaPrevia({ ...reducao, partes: [{ ...parte, rota: "fora_do_prazo" }] })).toBe("fora_do_prazo");
    expect(rotaDaPrevia({ ...reducao, direito: "nenhum", partes: [] })).toBe("sem_devolucao");
    expect(rotaDaPrevia({ ...reducao, rumo: "igual", partes: [] })).toBe("igual");
    const liberacao = previaAlteracaoParaTela({ ...reducao, partes: [{ ...parte, aguardaLiberacao: true, liberacaoPrevista: new Date("2026-10-20T15:00:00Z") }] }, AGORA);
    expect(liberacao.comoSai).toEqual(["Pix de 01/10: R$ 300,00 — pelo Mercado Pago, quando ele liberar o pagamento (previsto para 20/10)."]);
  });

  it("redução retida: sem devolução, o valor da reserva continua o de antes", () => {
    const retida = previaAlteracaoParaTela(
      { ...reducao, direito: "nenhum", base: "fora_do_prazo", valorADevolver: 0, partes: [], decisao: { ...reducao.decisao!, calculado: "nenhum", base: "fora_do_prazo", valorADevolver: 0 } },
      AGORA,
    );
    expect(retida.diferenca).toBe("Diferença: sem devolução pela política (pedido depois do prazo de reembolso integral): o valor da reserva continua R$ 1.500,00.");
    expect(retida.depois).toBe("Depois: 05/12–09/12, 4 noites, 2 pessoas, R$ 1.200,00 (cotação do site); pela política, a reserva continua valendo R$ 1.500,00.");
    expect(retida.rota).toBe("sem_devolucao");
    expect(retida.comoSai).toEqual([]);
  });

  it("valor mantido com o motivo; a prévia do 'Aplicar' de uma segurada mostra o prazo gravado e não oferece 'Só segurar'", () => {
    const mantido = previaAlteracaoParaTela({ ...aumento, origemValor: "mantido", motivoValor: "alteracao_pela_scl", diferenca: 0, rumo: "igual" }, AGORA);
    expect(mantido.depois).toContain("(valor atual mantido: A SCL propôs a alteração)");
    expect(mantido.diferenca).toBe("Diferença: o valor não muda.");
    const aplicar = previaAlteracaoParaTela({ ...reducao, alteracaoId: "a", holdAte: new Date("2026-10-01T16:30:00Z") }, AGORA);
    expect(aplicar.noitesNovas).toBe("Novas noites seguradas: 05/12–09/12 até 13:30.");
    expect(aplicar.perguntaSoSegurar).toBeNull();
    const semNoites = previaAlteracaoParaTela({ ...reducao, noitesNovas: null }, AGORA);
    expect(semNoites.noitesNovas).toBe("Nenhuma noite nova: as novas datas cabem nas de agora.");
  });
});

describe("os resultados da alteração na ficha", () => {
  it("a chave vem da situação gravada e da rota da prévia", () => {
    expect(resultadoDaAlteracao("segurada", "pedida")).toBe("segurada");
    expect(resultadoDaAlteracao("aplicada", "pedida")).toBe("aplicada_pedida");
    expect(resultadoDaAlteracao("aplicada", "liberacao")).toBe("aplicada_liberacao");
    expect(resultadoDaAlteracao("aplicada", "fora_do_prazo")).toBe("aplicada_fora_do_prazo");
    expect(resultadoDaAlteracao("aplicada", "sem_devolucao")).toBe("aplicada_sem_devolucao");
    expect(resultadoDaAlteracao("aplicada", "igual")).toBe("aplicada");
    expect(resultadoDaAlteracao("aplicada", "<script>")).toBe("aplicada");
  });

  it("o texto só para chaves conhecidas; o valor só quando a ficha manda (quem lê o financeiro)", () => {
    const ctx = { holdAte: new Date("2026-10-01T16:30:00Z"), valorADevolver: 30000, previstaEm: "2026-10-20" };
    expect(textoDoResultadoDaAlteracao("segurada", ctx)).toBe("Datas seguradas até 13:30: copie a proposta para o hóspede.");
    expect(textoDoResultadoDaAlteracao("aplicada_liberacao", ctx)).toBe("Alteração aplicada. Devolução de R$ 300,00 pedida quando o Mercado Pago liberar o pagamento (previsto para 20/10).");
    expect(textoDoResultadoDaAlteracao("aplicada_pedida", { ...ctx, valorADevolver: null })).toBe(
      "Alteração aplicada. Devolução da diferença pedida ao Mercado Pago: a confirmação aparece no quadro do pagamento quando ele concluir.",
    );
    expect(textoDoResultadoDaAlteracao("aplicada_sem_devolucao", ctx)).toBe("Alteração aplicada: pela política, sem devolução da diferença.");
    expect(textoDoResultadoDaAlteracao("qualquer", ctx)).toBeNull();
    expect(textoDoResultadoDaAlteracao(["segurada"], ctx)).toBeNull();
    for (const k of RESULTADOS_DA_ALTERACAO) expect(textoDoResultadoDaAlteracao(k, ctx)).toBeTruthy();
  });
});
