import { describe, expect, it } from "vitest";
import {
  acertoDaPerda,
  assinaturaDaDecisao,
  assinaturaDoResultado,
  AVISOS_DE_CONTESTACAO,
  caixaFinalDaPerda,
  casarContestacao,
  casoDestePagamento,
  chavesDaContestacao,
  CODIGOS_CAUSA_CONTESTACAO,
  confirmacaoReforcadaDaDecisao,
  confirmadoPelasSubstituidas,
  contestacaoDaLeitura,
  contestacaoEmCurso,
  contestacaoSemDecisao,
  DIAS_ESCALADA_CONTESTACAO,
  disputaDoPagamento,
  dividirPerda,
  divisaoDaDecisao,
  ehChaveDeContestacao,
  esperaDaLeituraDaContestacao,
  estadoDaVolta,
  fatosSemLeitura,
  fraseDaCausa,
  JANELA_CONTESTACAO_TARDIA,
  LEITURAS_DE_CONTESTACAO_POR_VOLTA,
  type LeituraDeContestacao,
  type LinhaDeContestacao,
  type LinhaParaConferencia,
  liquidoNaoEntrouProposto,
  naJanelaTardia,
  novaContestacao,
  ORIGEM_LANCAMENTO_CONTESTACAO,
  perdaADividir,
  perguntaDaDecisao,
  PRAZO_LEITURA_CONTESTACAO_DIAS,
  quemArcaPelaRegra,
  RELER_CONTESTACAO_A_CADA_MS,
  resultadoSugeridoPelaLeitura,
  SITUACOES_CONTESTACAO,
  situacaoAntesDaContestacao,
  situacaoPodeMudar,
  SUGERIR_RESULTADO_PELA_LEITURA,
  TEXTO_CONFIRMACAO_REFORCADA_FRAUDE,
  TEXTO_DISPUTA_EM_CURSO_CANCELAMENTO,
  TEXTO_NOTA_REFORCADA,
  TEXTOS_BASE_CAUSAS_CONTESTACAO,
  transicaoDaContestacao,
  type TransicaoDaContestacao,
  valorEmRisco,
  valorSeguradoDesatualizado,
} from "./contestacao-regras";

const DIA = 86_400_000;
const T0 = new Date("2026-10-01T12:00:00Z");
const em = (min: number) => new Date(T0.getTime() + min * 60_000);

const leitura = (x: Partial<LeituraDeContestacao> = {}): LeituraDeContestacao => ({
  fonte: "order",
  idCaso: null,
  idContestacao: null,
  estadoLido: "in_process",
  coberturaAplicada: null,
  valor: 100_000,
  lidaEm: em(0),
  atualizadoNoProvedorEm: null,
  ...x,
});
/** Um caso da Chargebacks API (sem estado; a cobertura diz se terminou). */
const caso = (idCaso: string, x: Partial<LeituraDeContestacao> = {}) => leitura({ fonte: "chargebacks", idCaso, estadoLido: null, prazoDocumentacao: em(7 * 24 * 60), ...x });
const linha = (x: Partial<LinhaDeContestacao> = {}): LinhaDeContestacao => ({
  ...fatosSemLeitura(),
  id: "c1",
  pagamentoId: "p1",
  tipo: "chargeback",
  situacao: "aberta",
  idCaso: null,
  idContestacao: null,
  idTransacao: null,
  rodada: 1,
  duplicataPossivel: false,
  abertaEm: T0,
  avisos: [],
  avisoConferidoEm: null,
  ...x,
});
const PAGAMENTO = { situacao: "aprovado" as const, devolvidoLido: 0, pago: 100_000, valor: 100_000, tresDSStatus: "AUTHENTICATED" };

/** Uma transição que deu certo e não foi descartada. */
function aplicada(t: TransicaoDaContestacao) {
  if (!t.ok) throw new Error(t.erro);
  if (t.descartada) throw new Error("descartada");
  return t;
}

/** Uma volta da leitura, como o domínio faz sob a trava: casa, aplica nas existentes e cria as novas. */
function volta(linhas: LinhaDeContestacao[], lidas: LeituraDeContestacao[]) {
  const r = casarContestacao(lidas, linhas);
  const eventos: string[] = [];
  const depois = linhas.map((l) => ({ ...l }));
  for (const x of r.existentes) {
    const i = depois.findIndex((l) => l.id === x.linhaId);
    const l = { ...depois[i], ...x.completar };
    const t = transicaoDaContestacao(l, { tipo: "leitura", leituras: x.leituras });
    if (!t.ok) throw new Error(t.erro);
    if (t.descartada) continue;
    depois[i] = { ...l, ...t.fatos, situacao: t.situacao, avisos: t.avisos };
    eventos.push(...t.eventos.map((e) => e.tipo));
  }
  for (const n of r.novas) {
    const v = novaContestacao({
      origem: "leitura",
      tipo: "chargeback",
      forma: "cartao",
      leituras: n.leituras,
      identificacao: n.identificacao,
      duplicataPossivel: n.duplicataPossivel,
      pagamento: PAGAMENTO,
      deOutraNaoFinal: null,
      outras: 0,
      comDevolucaoRealizada: false,
      agora: n.leituras[0].lidaEm,
    });
    depois.push({ ...linha(), ...v, id: `c${depois.length + 1}` });
    eventos.push("aberta");
  }
  return { linhas: depois, eventos, r };
}

describe("listas e constantes (M8.2e)", () => {
  it("listas fechadas, origem dos lançamentos e prazos da leitura", () => {
    expect(SITUACOES_CONTESTACAO).toEqual(["aberta", "a_confirmar", "ganha", "perdida", "sem_efeito"]);
    expect(AVISOS_DE_CONTESTACAO).toHaveLength(17);
    expect(new Set(AVISOS_DE_CONTESTACAO).size).toBe(17);
    expect(ORIGEM_LANCAMENTO_CONTESTACAO).toBe("contestacao_pagamento");
    expect(RELER_CONTESTACAO_A_CADA_MS).toBe(DIA);
    expect(LEITURAS_DE_CONTESTACAO_POR_VOLTA).toBe(50);
    expect(PRAZO_LEITURA_CONTESTACAO_DIAS).toBe(240);
    expect(DIAS_ESCALADA_CONTESTACAO).toBe(15);
    expect(JANELA_CONTESTACAO_TARDIA).toMatchObject({ desdeDias: 80, depoisDaSaidaDias: 200, tetoDias: 540 });
    // C1: a sugestão do resultado pela leitura existe, desligada.
    expect(SUGERIR_RESULTADO_PELA_LEITURA).toBe(false);
    expect(resultadoSugeridoPelaLeitura({ coberturaAplicada: true })).toBeNull();
    expect(resultadoSugeridoPelaLeitura({ coberturaAplicada: true }, true)).toBe("ganha");
    expect(resultadoSugeridoPelaLeitura({ coberturaAplicada: false }, true)).toBe("perdida");
    expect(resultadoSugeridoPelaLeitura({ coberturaAplicada: null }, true)).toBeNull();
  });

  it("a fila anda na falha: 1, 2, 4 e até 7 dias; a busca tardia na janela de 80 dias até 200 depois da saída, com teto de 540", () => {
    expect([0, 1, 2, 3, 4, 10].map((f) => esperaDaLeituraDaContestacao(f) / DIA)).toEqual([1, 1, 2, 4, 7, 7]);
    const aprovado = T0;
    const dia = (n: number) => new Date(T0.getTime() + n * DIA);
    const saida = dia(10);
    expect(naJanelaTardia(aprovado, saida, dia(79))).toBe(false);
    expect(naJanelaTardia(aprovado, saida, dia(80))).toBe(true);
    expect(naJanelaTardia(aprovado, saida, dia(210))).toBe(true);
    expect(naJanelaTardia(aprovado, saida, dia(211))).toBe(false);
    // Saída longe: o teto de 540 dias da aprovação.
    expect(naJanelaTardia(aprovado, dia(400), dia(540))).toBe(true);
    expect(naJanelaTardia(aprovado, dia(400), dia(541))).toBe(false);
    // Sem reserva: conta da aprovação.
    expect(naJanelaTardia(aprovado, null, dia(200))).toBe(true);
    expect(naJanelaTardia(aprovado, null, dia(201))).toBe(false);
  });
});

describe("casamento e idempotência (matriz de casarContestacao)", () => {
  it("N leituras = 1 linha, e o evento só quando muda", () => {
    const a = volta([], [leitura({ idContestacao: "CBK1", idCaso: "123" })]);
    expect(a.linhas).toHaveLength(1);
    expect(a.eventos).toEqual(["aberta"]);
    expect(a.linhas[0]).toMatchObject({ situacao: "aberta", idCaso: "123", idContestacao: "CBK1", estadoLido: "in_process", valor: 100_000, valorEmRisco: 100_000, tresDSStatus: "AUTHENTICATED" });
    let linhas = a.linhas;
    for (const n of [1, 2, 3]) {
      const b = volta(linhas, [leitura({ idContestacao: "CBK1", idCaso: "123", lidaEm: em(n * 60) })]);
      expect(b.linhas).toHaveLength(1);
      expect(b.eventos).toEqual([]);
      linhas = b.linhas;
    }
  });

  it("a order antes da API e a API antes da order dão a mesma linha; sem id é completada pelo caso", () => {
    const orderPrimeiro = volta(volta([], [leitura({ idContestacao: "CBK1", idCaso: "123" })]).linhas, [caso("123", { lidaEm: em(10) })]);
    expect(orderPrimeiro.linhas).toHaveLength(1);
    const apiPrimeiro = volta([], [caso("123")]);
    expect(apiPrimeiro.linhas).toHaveLength(1);
    expect(apiPrimeiro.linhas[0]).toMatchObject({ idCaso: "123", idContestacao: null, situacao: "aberta" });
    const depois = volta(apiPrimeiro.linhas, [leitura({ idContestacao: "CBK1", idCaso: "123", lidaEm: em(10) })]);
    expect(depois.linhas).toHaveLength(1);
    expect(depois.r.existentes[0].completar).toEqual({ idContestacao: "CBK1" });
    // A leitura sem lista (transação charged_back sem item) e depois com a lista: completada, nunca duplicada.
    const semLista = volta([], [leitura()]);
    expect(semLista.linhas[0]).toMatchObject({ idCaso: null, idContestacao: null });
    const comLista = volta(semLista.linhas, [leitura({ idContestacao: "CBK7", idCaso: "777", idTransacao: "PAY9", lidaEm: em(5) })]);
    expect(comLista.linhas).toHaveLength(1);
    expect(comLista.r.existentes[0].completar).toEqual({ idCaso: "777", idContestacao: "CBK7", idTransacao: "PAY9" });
    // Duas fontes da mesma volta mostrando a mesma disputa nova: uma linha só (com os ids das duas).
    const juntas = volta([], [leitura(), caso("123")]);
    expect(juntas.linhas).toHaveLength(1);
    expect(juntas.r.novas[0].leituras).toHaveLength(2);
    expect(juntas.linhas[0]).toMatchObject({ idCaso: "123" });
  });

  it("o id da transação nunca casa sozinho; ids que se contradizem são ambíguos", () => {
    const l = linha({ idCaso: "1", idContestacao: "CBK1", idTransacao: "PAY1", situacao: "ganha" });
    // Só o PAY igual: é um id nunca visto (a linha é final): não casa e, em disputa sem outra não final, abre linha nova.
    expect(casarContestacao([leitura({ idTransacao: "PAY1", idContestacao: "CBK2" })], [l]).novas).toHaveLength(1);
    // O caso de uma linha com o CBK de outra disputa: ambígua.
    expect(casarContestacao([leitura({ idCaso: "1", idContestacao: "CBK9" })], [l]).ambiguas).toHaveLength(1);
    expect(casarContestacao([leitura({ idCaso: "9", idContestacao: "CBK1" })], [l]).ambiguas).toHaveLength(1);
  });

  it("leitura encerrada nunca cria linha: sem id é explicada por uma final; num pagamento sem linha (ou id desconhecido) é ambígua", () => {
    expect(casarContestacao([leitura({ estadoLido: "settled" })], [])).toMatchObject({ novas: [], ambiguas: [expect.anything()] });
    expect(casarContestacao([leitura({ idContestacao: "CBK9", estadoLido: "reimbursed" })], [])).toMatchObject({ novas: [], ambiguas: [expect.anything()] });
    expect(casarContestacao([caso("9", { coberturaAplicada: true })], [])).toMatchObject({ novas: [], ambiguas: [expect.anything()] });
    const final = linha({ situacao: "ganha", idCaso: "1" });
    expect(casarContestacao([leitura({ estadoLido: "reimbursed" })], [final])).toMatchObject({ novas: [], explicadas: [expect.anything()], existentes: [] });
    expect(casarContestacao([leitura({ idContestacao: "CBK9", estadoLido: "settled" })], [final])).toMatchObject({ novas: [], ambiguas: [expect.anything()] });
    // A linha final relida pelo id: os fatos, nunca linha nova.
    const relida = volta([final], [caso("1", { coberturaAplicada: true })]);
    expect(relida.linhas).toHaveLength(1);
    expect(relida.linhas[0]).toMatchObject({ situacao: "ganha", coberturaAplicada: true });
  });

  it("in_process sem id com só linhas finais vai para a final mais nova com resultado e liga o aviso, sem linha nova; a sem efeito nunca a absorve", () => {
    const velha = linha({ id: "c1", situacao: "perdida", idCaso: "1", abertaEm: em(0) });
    const nova = linha({ id: "c2", situacao: "sem_efeito", abertaEm: em(100) });
    const r = volta([velha, nova], [leitura({ lidaEm: em(200) })]);
    expect(r.linhas).toHaveLength(2);
    expect(r.r.existentes.map((x) => x.linhaId)).toEqual(["c1"]);
    expect(r.linhas[0]).toMatchObject({ situacao: "perdida", avisos: ["contestacao_resultado_mudou"], estadoLido: "in_process" });
    expect(r.linhas[1]).toMatchObject({ situacao: "sem_efeito", avisos: [] });
    // Só uma sem efeito (registrada por engano): a disputa lida em andamento é uma disputa nova (revisão de 11/10).
    const soSemEfeito = volta([linha({ id: "c3", situacao: "sem_efeito", abertaEm: em(0) })], [leitura({ lidaEm: em(200) })]);
    expect(soSemEfeito.r.existentes).toEqual([]);
    expect(soSemEfeito.linhas).toHaveLength(2);
    expect(soSemEfeito.linhas[1]).toMatchObject({ situacao: "aberta", estadoLido: "in_process", duplicataPossivel: false });
  });

  it("duas não finais e uma leitura sem id = ambígua; segunda disputa com outra aberta = possível duplicata com valor em risco 0", () => {
    const duas = [linha({ id: "c1", idCaso: "1" }), linha({ id: "c2", idCaso: "2" })];
    expect(casarContestacao([leitura()], duas)).toMatchObject({ novas: [], existentes: [], ambiguas: [expect.anything()] });
    // Um id novo com duas não finais, uma sem id (que poderia ser ela): ambígua.
    expect(casarContestacao([caso("3")], [linha({ id: "c1", idCaso: "1" }), linha({ id: "c2" })]).ambiguas).toHaveLength(1);
    const aberta = volta([], [leitura({ idCaso: "1" })]).linhas;
    const segunda = volta(aberta, [leitura({ idCaso: "2", lidaEm: em(10) })]);
    expect(segunda.linhas).toHaveLength(2);
    expect(segunda.linhas[1]).toMatchObject({ idCaso: "2", duplicataPossivel: true, valorEmRisco: 0, avisos: expect.arrayContaining(["contestacao_possivel_duplicata"]) });
    // Sem outra não final, a disputa nova é só uma disputa nova.
    const depoisDaGanha = volta([linha({ idCaso: "1", situacao: "ganha" })], [leitura({ idCaso: "2" })]);
    expect(depoisDaGanha.linhas[1]).toMatchObject({ idCaso: "2", duplicataPossivel: false });
  });

  it("registro da equipe: o mesmo caso já está no quadro; sem id com uma sem id aberta é ela; com outra aberta, possível duplicata", () => {
    const equipe = (x: Partial<LeituraDeContestacao> = {}) => leitura({ fonte: "equipe", estadoLido: null, valor: 30_000, ...x });
    const comCaso = linha({ id: "c1", idCaso: "123" });
    expect(casarContestacao([equipe({ idCaso: "123" })], [comCaso]).existentes).toEqual([{ linhaId: "c1", leituras: [expect.anything()], completar: {} }]);
    expect(casarContestacao([equipe()], [linha({ id: "c9" })]).existentes.map((x) => x.linhaId)).toEqual(["c9"]);
    expect(casarContestacao([equipe()], [comCaso]).novas).toEqual([expect.objectContaining({ duplicataPossivel: true })]);
    expect(casarContestacao([equipe()], [linha({ idCaso: "1", situacao: "ganha" })]).novas).toEqual([expect.objectContaining({ duplicataPossivel: false })]);
    expect(casarContestacao([equipe()], []).novas).toEqual([expect.objectContaining({ duplicataPossivel: false })]);
    // A linha da equipe: o valor e o prazo do registro, sem leitura; o MED não liga o aviso do Pix contestado.
    const v = novaContestacao({
      origem: "equipe",
      tipo: "med",
      forma: "pix",
      leituras: [equipe()],
      identificacao: { idCaso: null, idContestacao: null, idTransacao: null },
      duplicataPossivel: false,
      pagamento: { ...PAGAMENTO, tresDSStatus: null },
      deOutraNaoFinal: null,
      outras: 0,
      comDevolucaoRealizada: false,
      equipe: { valor: 30_000, prazo: null },
      agora: T0,
    });
    expect(v).toMatchObject({ origem: "equipe", tipo: "med", situacao: "aberta", valor: 30_000, valorOrigem: "equipe", valorEmRisco: 30_000, estadoLido: null, avisos: ["contestacao_prazo_desconhecido"] });
  });

  it("a linha nova: Pix contestado, valor ilegível ou acima da reserva, devolução realizada, a situação de antes e o retrato da verificação do banco", () => {
    const base = {
      origem: "leitura" as const,
      tipo: "chargeback" as const,
      identificacao: { idCaso: null, idContestacao: null, idTransacao: null },
      duplicataPossivel: false,
      deOutraNaoFinal: null,
      outras: 0,
      comDevolucaoRealizada: false,
      agora: T0,
    };
    const pix = novaContestacao({ ...base, forma: "pix", leituras: [leitura({ valor: null })], pagamento: { ...PAGAMENTO, tresDSStatus: null } });
    expect(pix.avisos).toEqual(expect.arrayContaining(["contestacao_pix", "contestacao_valor_desconhecido", "contestacao_prazo_desconhecido"]));
    expect(pix).toMatchObject({ valor: null, valorOrigem: "pagamento", valorEmRisco: 100_000, tresDSStatus: null });
    const acima = novaContestacao({ ...base, forma: "cartao", leituras: [leitura({ valor: 104_000 })], pagamento: { ...PAGAMENTO, pago: 104_000 } });
    expect(acima.avisos).toContain("contestacao_valor_acima");
    expect(acima.valorEmRisco).toBe(104_000);
    const devolvido = novaContestacao({ ...base, forma: "cartao", leituras: [leitura()], pagamento: { ...PAGAMENTO, situacao: "devolvido", devolvidoLido: 100_000 } });
    expect(devolvido.avisos).toContain("contestacao_com_devolucao");
    expect(devolvido.situacaoPagamentoAntes).toBe("devolvido");
    expect(novaContestacao({ ...base, forma: "cartao", leituras: [leitura()], pagamento: PAGAMENTO, deOutraNaoFinal: "devolvido_parcial" }).situacaoPagamentoAntes).toBe("devolvido_parcial");
    // Contestado sem linha (lido antes do M8.2e): o que a leitura mostrou das devoluções.
    expect(situacaoAntesDaContestacao({ situacao: "contestado", devolvidoLido: 0, pago: 100_000 }, null)).toBe("aprovado");
    expect(situacaoAntesDaContestacao({ situacao: "contestado", devolvidoLido: 20_000, pago: 100_000 }, null)).toBe("devolvido_parcial");
    expect(situacaoAntesDaContestacao({ situacao: "contestado", devolvidoLido: 100_000, pago: 100_000 }, null)).toBe("devolvido");
  });

  it("o caso precisa ser deste pagamento (payments[] com o número); sem o número, só referência", () => {
    expect(casoDestePagamento({ pagamentos: ["111", "222"] }, "222")).toBe("sim");
    expect(casoDestePagamento({ pagamentos: ["111"] }, "222")).toBe("outro");
    expect(casoDestePagamento({ pagamentos: ["111"] }, null)).toBe("sem_numero");
  });
});

describe("ordem das leituras", () => {
  it("leitura iniciada antes da última aplicada é descartada; date_last_updated mais velho também", () => {
    const l = linha({ idCaso: "1", lidaEm: em(10), atualizadoNoProvedorEm: em(10) });
    expect(transicaoDaContestacao(l, { tipo: "leitura", leituras: [caso("1", { lidaEm: em(5), coberturaAplicada: true })] })).toEqual({ ok: true, descartada: true });
    expect(transicaoDaContestacao(l, { tipo: "leitura", leituras: [caso("1", { lidaEm: em(20), atualizadoNoProvedorEm: em(5), coberturaAplicada: true })] })).toEqual({ ok: true, descartada: true });
    // A order não traz a data do caso: só a ordem de início conta.
    const t = aplicada(transicaoDaContestacao(l, { tipo: "leitura", leituras: [leitura({ idCaso: "1", estadoLido: "settled", lidaEm: em(20) })] }));
    expect(t).toMatchObject({ situacao: "a_confirmar", fatos: { estadoLido: "settled", lidaEm: em(20), atualizadoNoProvedorEm: em(10) } });
    // Uma leitura que não muda nada só atualiza a leitura (sem evento).
    const igual = aplicada(transicaoDaContestacao({ ...l, ...t.fatos, situacao: t.situacao, avisos: t.avisos }, { tipo: "leitura", leituras: [leitura({ idCaso: "1", estadoLido: "settled", lidaEm: em(30) })] }));
    expect(igual).toMatchObject({ mudou: false, eventos: [], fatos: { lidaEm: em(30) } });
  });

  it("qualquer in_process = em disputa; fontes que divergem no encerramento ligam o aviso uma vez, sem transição e sem oscilar", () => {
    expect(estadoDaVolta([leitura({ estadoLido: "in_process" }), caso("1", { coberturaAplicada: true })])).toBe("em_disputa");
    expect(estadoDaVolta([leitura({ estadoLido: "reimbursed" }), caso("1", { coberturaAplicada: true })])).toBe("conflito");
    expect(estadoDaVolta([leitura({ estadoLido: "settled" }), leitura({ fonte: "payments", estadoLido: "reimbursed" })])).toBe("conflito");
    expect(estadoDaVolta([leitura({ estadoLido: "settled" }), caso("1", { coberturaAplicada: true })])).toBe("encerrada");
    expect(estadoDaVolta([leitura({ estadoLido: "desconhecido" })])).toBe("sem_estado");
    let l = linha({ idCaso: "1" });
    const fontes = (min: number) => [leitura({ idCaso: "1", estadoLido: "reimbursed", lidaEm: em(min) }), caso("1", { coberturaAplicada: true, lidaEm: em(min) })];
    const a = aplicada(transicaoDaContestacao(l, { tipo: "leitura", leituras: fontes(10) }));
    expect(a).toMatchObject({ situacao: "aberta", avisos: ["contestacao_leitura_conflitante"], mudou: true });
    l = { ...l, ...a.fatos, situacao: a.situacao, avisos: a.avisos };
    for (const min of [20, 30]) {
      const b = aplicada(transicaoDaContestacao(l, { tipo: "leitura", leituras: fontes(min) }));
      expect(b).toMatchObject({ situacao: "aberta", avisos: ["contestacao_leitura_conflitante"], mudou: false, eventos: [] });
      l = { ...l, ...b.fatos, situacao: b.situacao, avisos: b.avisos };
    }
  });

  it("a confirmação da equipe nunca é desfeita por uma leitura velha", () => {
    const l = linha({ idCaso: "1", estadoLido: "in_process", lidaEm: em(10) });
    const g = aplicada(transicaoDaContestacao(l, { tipo: "resultado", resultado: "ganha", em: em(20), emDisputaNaLeitura: false, notaReforcada: false }));
    const ganha = { ...l, ...g.fatos, situacao: g.situacao, avisos: g.avisos };
    expect(ganha.lidaEm).toEqual(em(20));
    // Iniciada antes da confirmação (uma volta da rotina que caiu no meio): descartada.
    expect(transicaoDaContestacao(ganha, { tipo: "leitura", leituras: [leitura({ idCaso: "1", lidaEm: em(15) })] })).toEqual({ ok: true, descartada: true });
    // Depois dela, a contradição liga o aviso; a situação continua ganha.
    expect(aplicada(transicaoDaContestacao(ganha, { tipo: "leitura", leituras: [leitura({ idCaso: "1", lidaEm: em(25) })] }))).toMatchObject({ situacao: "ganha", avisos: ["contestacao_resultado_mudou"] });
  });
});

describe("situações e transições (matriz de transicaoDaContestacao)", () => {
  it("as mudanças de situação possíveis, pela leitura e pela equipe", () => {
    const pode: string[] = [];
    for (const de of SITUACOES_CONTESTACAO) for (const para of SITUACOES_CONTESTACAO) for (const por of ["leitura", "equipe"] as const) if (situacaoPodeMudar(de, para, por)) pode.push(`${por}:${de}>${para}`);
    expect(pode.sort()).toEqual(
      [
        "leitura:aberta>a_confirmar",
        "leitura:a_confirmar>aberta",
        "equipe:aberta>ganha",
        "equipe:aberta>perdida",
        "equipe:aberta>sem_efeito",
        "equipe:a_confirmar>ganha",
        "equipe:a_confirmar>perdida",
        "equipe:a_confirmar>sem_efeito",
      ].sort(),
    );
  });

  it("pela leitura: aberta → a_confirmar (settled, cobertura ou a transação de volta a aprovada); a_confirmar → aberta com in_process mais novo, com evento e aviso", () => {
    for (const l of [leitura({ estadoLido: "settled" }), caso("1", { coberturaAplicada: false }), leitura({ estadoLido: null, voltouAAprovada: true })]) {
      const t = aplicada(transicaoDaContestacao(linha({ idCaso: "1" }), { tipo: "leitura", leituras: [l] }));
      expect(t.situacao).toBe("a_confirmar");
      expect(t.eventos.find((e) => e.tipo === "estado_lido")).toMatchObject({ antes: { situacao: "aberta" }, depois: { situacao: "a_confirmar" } });
    }
    const aConfirmar = linha({ idCaso: "1", situacao: "a_confirmar", estadoLido: "settled", lidaEm: em(10), documentacaoPrazo: em(9000), valor: 100_000, valorOrigem: "leitura" });
    const t = aplicada(transicaoDaContestacao(aConfirmar, { tipo: "leitura", leituras: [leitura({ idCaso: "1", lidaEm: em(20) })] }));
    expect(t).toMatchObject({ situacao: "aberta", avisos: ["contestacao_resultado_mudou"], fatos: { estadoLido: "in_process" } });
    expect(t.eventos).toEqual([{ tipo: "estado_lido", antes: { estadoLido: "settled", situacao: "a_confirmar" }, depois: { estadoLido: "in_process", situacao: "aberta" } }]);
    // A Chargebacks API sem cobertura numa linha que já tem cobertura não diz nada (null também é ilegível).
    const comCobertura = linha({ idCaso: "1", situacao: "a_confirmar", coberturaAplicada: true });
    expect(aplicada(transicaoDaContestacao(comCobertura, { tipo: "leitura", leituras: [caso("1", { coberturaAplicada: null, lidaEm: em(30) })] }))).toMatchObject({ situacao: "a_confirmar", fatos: { coberturaAplicada: true } });
  });

  it("desconhecido nunca sobrescreve conhecido; valor ilegível usa o pago e avisa; valor acima da reserva avisa", () => {
    const l = linha({ idCaso: "1", estadoLido: "in_process", codigo: "in_process", valor: 80_000, valorOrigem: "leitura", documentacaoPrazo: em(9000) });
    const d = aplicada(transicaoDaContestacao(l, { tipo: "leitura", leituras: [leitura({ idCaso: "1", estadoLido: "desconhecido", codigo: "em_arbitragem", valor: null, lidaEm: em(10) })] }));
    expect(d).toMatchObject({ situacao: "aberta", fatos: { estadoLido: "in_process", codigo: "em_arbitragem", valor: 80_000 }, avisos: ["contestacao_situacao_desconhecida"] });
    const volta = aplicada(transicaoDaContestacao({ ...l, ...d.fatos, avisos: d.avisos }, { tipo: "leitura", leituras: [leitura({ idCaso: "1", lidaEm: em(20), valor: 80_000 })] }));
    expect(volta).toMatchObject({ fatos: { codigo: "in_process" }, avisos: [] });
    const semValor = linha({ idCaso: "1", documentacaoPrazo: em(9000) });
    expect(aplicada(transicaoDaContestacao(semValor, { tipo: "leitura", leituras: [leitura({ idCaso: "1", valor: null })] })).avisos).toEqual(["contestacao_valor_desconhecido"]);
    const acima = aplicada(transicaoDaContestacao(semValor, { tipo: "leitura", leituras: [leitura({ idCaso: "1", valor: 104_000 })], valorDaReserva: 100_000 }));
    expect(acima).toMatchObject({ fatos: { valor: 104_000, valorOrigem: "leitura" }, avisos: ["contestacao_valor_acima"] });
    expect(acima.eventos).toEqual([
      { tipo: "estado_lido", antes: { estadoLido: null }, depois: { estadoLido: "in_process" } },
      { tipo: "valor", antes: { valor: null }, depois: { valor: 104_000 } },
    ]);
    // A leitura troca o valor registrado pela equipe (o fato do Mercado Pago); o prazo lido desliga o aviso do prazo.
    const daEquipe = linha({ idCaso: "1", valor: 30_000, valorOrigem: "equipe", avisos: ["contestacao_prazo_desconhecido"] });
    expect(aplicada(transicaoDaContestacao(daEquipe, { tipo: "leitura", leituras: [caso("1", { valor: 35_000, documentacao: "pending" })] }))).toMatchObject({
      fatos: { valor: 35_000, valorOrigem: "leitura", documentacao: "pending" },
      avisos: [],
    });
  });

  it("as finais não mudam pela leitura; a que contradiz liga contestacao_resultado_mudou (ganha × in_process ou cobertura false; perdida × cobertura true)", () => {
    const ganha = linha({ idCaso: "1", situacao: "ganha", estadoLido: "settled", coberturaAplicada: true });
    const perdida = linha({ idCaso: "1", situacao: "perdida", estadoLido: "reimbursed", coberturaAplicada: false });
    const ler = (l: LinhaDeContestacao, x: LeituraDeContestacao) => aplicada(transicaoDaContestacao(l, { tipo: "leitura", leituras: [x] }));
    expect(ler(ganha, leitura({ idCaso: "1" }))).toMatchObject({ situacao: "ganha", avisos: ["contestacao_resultado_mudou"], fatos: { estadoLido: "in_process" } });
    expect(ler(ganha, caso("1", { coberturaAplicada: false }))).toMatchObject({ situacao: "ganha", avisos: ["contestacao_resultado_mudou"] });
    expect(ler(ganha, leitura({ idCaso: "1", estadoLido: "reimbursed" }))).toMatchObject({ situacao: "ganha", avisos: [] });
    expect(ler(perdida, caso("1", { coberturaAplicada: true }))).toMatchObject({ situacao: "perdida", avisos: ["contestacao_resultado_mudou"] });
    // Pelo id, a perdida relida in_process não é contradição (a correção é um ajuste); a sem efeito também não.
    expect(ler(perdida, leitura({ idCaso: "1" }))).toMatchObject({ situacao: "perdida", avisos: [] });
    expect(ler(linha({ idCaso: "1", situacao: "sem_efeito" }), leitura({ idCaso: "1" })).avisos).toEqual([]);
    // Sem id, in_process contra qualquer final liga o aviso.
    expect(ler(linha({ situacao: "sem_efeito" }), leitura()).avisos).toEqual(["contestacao_resultado_mudou"]);
  });

  it('"Conferir o aviso": continua encerrada tira o aviso (e a mesma leitura não o liga de novo); reaberta só na ganha relida in_process, com a rodada seguinte', () => {
    const ganha = linha({ idCaso: "1", situacao: "ganha", estadoLido: "settled", coberturaAplicada: true, lidaEm: em(10) });
    const contradita = aplicada(transicaoDaContestacao(ganha, { tipo: "leitura", leituras: [leitura({ idCaso: "1", lidaEm: em(20) })] }));
    const comAviso = { ...ganha, ...contradita.fatos, avisos: contradita.avisos };
    const c = aplicada(transicaoDaContestacao(comAviso, { tipo: "conferir_aviso", como: "continua_encerrada", em: em(30) }));
    expect(c).toMatchObject({ situacao: "ganha", avisos: [], avisoConferidoEm: em(30), novaRodada: false, eventos: [{ tipo: "aviso_conferido" }] });
    const conferida = { ...comAviso, avisos: c.avisos, avisoConferidoEm: c.avisoConferidoEm };
    expect(aplicada(transicaoDaContestacao(conferida, { tipo: "leitura", leituras: [leitura({ idCaso: "1", lidaEm: em(40) })] }))).toMatchObject({ avisos: [], mudou: false });
    // Um fato novo que contradiz liga de novo.
    expect(aplicada(transicaoDaContestacao(conferida, { tipo: "leitura", leituras: [caso("1", { coberturaAplicada: false, lidaEm: em(50) })] })).avisos).toEqual(["contestacao_resultado_mudou"]);
    // Reaberta: a rodada seguinte, que o casamento passa a usar (a mais nova).
    const r = aplicada(transicaoDaContestacao(comAviso, { tipo: "conferir_aviso", como: "reaberta", em: em(30) }));
    expect(r).toMatchObject({ novaRodada: true, avisos: [], eventos: [{ tipo: "reaberta" }] });
    const rodada2 = linha({ id: "c2", idCaso: "1", rodada: 2, abertaEm: em(30) });
    expect(casarContestacao([leitura({ idCaso: "1", lidaEm: em(60) })], [{ ...comAviso, situacao: "ganha" }, rodada2]).existentes.map((x) => x.linhaId)).toEqual(["c2"]);
    // A perdida contradita só "continua encerrada" (a correção é um ajuste); sem o aviso, nada a conferir.
    const perdida = linha({ situacao: "perdida", avisos: ["contestacao_resultado_mudou"], estadoLido: "in_process" });
    expect(transicaoDaContestacao(perdida, { tipo: "conferir_aviso", como: "reaberta", em: em(30) })).toMatchObject({ ok: false, codigo: "nao_reabre" });
    expect(transicaoDaContestacao(ganha, { tipo: "conferir_aviso", como: "continua_encerrada", em: em(30) })).toMatchObject({ ok: false, codigo: "sem_aviso" });
    expect(transicaoDaContestacao(linha({ avisos: ["contestacao_resultado_mudou"] }), { tipo: "conferir_aviso", como: "continua_encerrada", em: em(30) })).toMatchObject({ ok: false, codigo: "sem_aviso" });
  });

  it("sem efeito e resultado contra uma leitura in_process só com a nota reforçada; finais e possível duplicata recusam", () => {
    const aberta = linha({ idCaso: "1", avisos: ["contestacao_leitura_conflitante", "contestacao_prazo_desconhecido", "contestacao_pix"] });
    expect(transicaoDaContestacao(aberta, { tipo: "resultado", resultado: "perdida", em: em(5), emDisputaNaLeitura: true, notaReforcada: false })).toEqual({ ok: false, codigo: "nota_reforcada", erro: TEXTO_NOTA_REFORCADA });
    expect(transicaoDaContestacao(aberta, { tipo: "sem_efeito", em: em(5), emDisputaNaLeitura: true, notaReforcada: false })).toMatchObject({ ok: false, codigo: "nota_reforcada" });
    const p = aplicada(transicaoDaContestacao(aberta, { tipo: "resultado", resultado: "perdida", em: em(5), emDisputaNaLeitura: true, notaReforcada: true }));
    // Os avisos de leitura saem (a disputa terminou aqui); o fato do Pix contestado fica.
    expect(p).toMatchObject({ situacao: "perdida", avisos: ["contestacao_pix"], eventos: [{ tipo: "resultado", antes: { situacao: "aberta" }, depois: { situacao: "perdida", emDisputaNaLeitura: true } }] });
    expect(transicaoDaContestacao({ ...aberta, situacao: "perdida" }, { tipo: "resultado", resultado: "ganha", em: em(5), emDisputaNaLeitura: false, notaReforcada: false })).toMatchObject({ ok: false, codigo: "nao_permitida" });
    expect(transicaoDaContestacao({ ...aberta, situacao: "ganha" }, { tipo: "sem_efeito", em: em(5), emDisputaNaLeitura: false, notaReforcada: false })).toMatchObject({ ok: false, codigo: "nao_permitida" });
    // A possível duplicata: o resultado espera "Confirmar que é outra disputa"; sem efeito vale (e tira o aviso).
    const dup = linha({ idCaso: "2", duplicataPossivel: true, avisos: ["contestacao_possivel_duplicata"] });
    expect(transicaoDaContestacao(dup, { tipo: "resultado", resultado: "ganha", em: em(5), emDisputaNaLeitura: false, notaReforcada: false })).toMatchObject({ ok: false, codigo: "duplicata" });
    expect(aplicada(transicaoDaContestacao(dup, { tipo: "sem_efeito", em: em(5), emDisputaNaLeitura: false, notaReforcada: false }))).toMatchObject({ situacao: "sem_efeito", avisos: [] });
    const outra = aplicada(transicaoDaContestacao(dup, { tipo: "outra_disputa", em: em(5) }));
    expect(outra).toMatchObject({ situacao: "aberta", duplicataPossivel: false, avisos: [], eventos: [{ tipo: "outra_disputa" }] });
    expect(transicaoDaContestacao(aberta, { tipo: "outra_disputa", em: em(5) })).toMatchObject({ ok: false, codigo: "nao_permitida" });
  });
});

describe("a situação que vale para o pagamento (contestacaoDaLeitura) e o em curso", () => {
  const contestado = (...contestacoes: Parameters<typeof contestacaoDaLeitura>[0]["contestacoes"]) => ({ situacao: "contestado", contestacoes });
  const item = (x: Partial<LeituraDeContestacao> = {}) => ({ idCaso: null, idContestacao: null, estadoLido: "in_process" as const, ...x });

  it("contestado durante a disputa; explicado pelas linhas finais depois do resultado; disputa nova ou desconhecida continua contestado", () => {
    expect(contestacaoDaLeitura({ situacao: "aprovado", contestacoes: [] }, [])).toEqual({ explicada: true, contestado: false });
    expect(contestacaoDaLeitura(contestado(item({ idContestacao: "CBK1" })), [linha({ idContestacao: "CBK1" })])).toEqual({ explicada: true, contestado: true });
    // Depois da ganha: o CBK conhecido encerrado e uma leitura sem id encerrada são explicados; vale a situação local.
    const ganha = linha({ idContestacao: "CBK1", situacao: "ganha" });
    expect(contestacaoDaLeitura(contestado(item({ idContestacao: "CBK1", estadoLido: "settled" })), [ganha])).toEqual({ explicada: true, contestado: false });
    expect(contestacaoDaLeitura(contestado(item({ estadoLido: "reimbursed" })), [ganha])).toEqual({ explicada: true, contestado: false });
    // in_process contra a final (pelo id ou sem id): não explicada, mas a situação do pagamento não muda (o em curso segura).
    expect(contestacaoDaLeitura(contestado(item({ idContestacao: "CBK1" })), [ganha])).toEqual({ explicada: false, contestado: false });
    expect(contestacaoDaLeitura(contestado(item()), [ganha])).toEqual({ explicada: false, contestado: false });
    // Caso novo in_process abre linha: contestado. Disputa encerrada que o sistema não conhece: contestado (a equipe a registra).
    expect(contestacaoDaLeitura(contestado(item({ idContestacao: "CBK2" })), [ganha])).toEqual({ explicada: false, contestado: true });
    expect(contestacaoDaLeitura(contestado(item({ estadoLido: "settled" })), [])).toEqual({ explicada: false, contestado: true });
    // charged_back sem lista: uma sem identificação de estado desconhecido.
    expect(contestacaoDaLeitura(contestado(), [linha()])).toEqual({ explicada: true, contestado: true });
    expect(contestacaoDaLeitura(contestado(), [])).toEqual({ explicada: false, contestado: true });
  });

  it("em curso: aberta, a_confirmar ou perdida de qualquer origem, ou a ganha com o resultado mudado por in_process ainda não conferido", () => {
    const t = (...contestacoes: Partial<LinhaDeContestacao>[]) => ({ contestacoes: contestacoes.map((x) => linha(x)) });
    expect(disputaDoPagamento(t({ situacao: "aberta" }), "p1")).toBe("em_curso");
    expect(disputaDoPagamento(t({ situacao: "a_confirmar" }), "p1")).toBe("em_curso");
    expect(disputaDoPagamento(t({ situacao: "perdida" }), "p1")).toBe("perdida");
    expect(disputaDoPagamento(t({ situacao: "perdida" }, { situacao: "aberta", id: "c2" }), "p1")).toBe("em_curso");
    expect(disputaDoPagamento(t({ situacao: "ganha", estadoLido: "in_process", avisos: ["contestacao_resultado_mudou"] }), "p1")).toBe("em_curso");
    expect(disputaDoPagamento(t({ situacao: "ganha", estadoLido: "settled", avisos: ["contestacao_resultado_mudou"] }), "p1")).toBeNull();
    expect(disputaDoPagamento(t({ situacao: "ganha", estadoLido: "in_process" }), "p1")).toBeNull();
    expect(disputaDoPagamento(t({ situacao: "sem_efeito" }), "p1")).toBeNull();
    expect(contestacaoEmCurso(t({ situacao: "aberta" }), "p2")).toBe(false);
    expect(contestacaoEmCurso(t({ situacao: "perdida" }), "p1")).toBe(true);
    // O texto da recusa do cancelamento com disputa em curso.
    expect(TEXTO_DISPUTA_EM_CURSO_CANCELAMENTO).toContain("Cancelar a reserva contestada");
  });

  it("em conferência por disputa: não duplicada, dinheiro da reserva, aberta com valor em risco sem decisão, ou perdida com perda a dividir sem decisão", () => {
    const l = (x: Partial<LinhaParaConferencia> = {}): LinhaParaConferencia => ({ situacao: "aberta", duplicataPossivel: false, valorEmRisco: 100_000, decisaoVersao: 0, perdaADividir: null, desfecho: "reserva", ...x });
    expect(contestacaoSemDecisao([l()])).toBe(true);
    expect(contestacaoSemDecisao([l({ situacao: "a_confirmar", desfecho: "alteracao" })])).toBe(true);
    expect(contestacaoSemDecisao([l({ valorEmRisco: 0 })])).toBe(false);
    expect(contestacaoSemDecisao([l({ decisaoVersao: 1 })])).toBe(false);
    expect(contestacaoSemDecisao([l({ duplicataPossivel: true })])).toBe(false);
    expect(contestacaoSemDecisao([l({ desfecho: "devolucao" })])).toBe(false);
    expect(contestacaoSemDecisao([l({ desfecho: null })])).toBe(false);
    expect(contestacaoSemDecisao([l({ situacao: "perdida", perdaADividir: 100_000 })])).toBe(true);
    expect(contestacaoSemDecisao([l({ situacao: "perdida", perdaADividir: 0 })])).toBe(false);
    expect(contestacaoSemDecisao([l({ situacao: "ganha" }), l({ situacao: "sem_efeito" })])).toBe(false);
    expect(contestacaoSemDecisao([l({ valorEmRisco: 0 }), l()])).toBe(true);
  });
});

describe("dinheiro", () => {
  it("valor em risco: o contestado (ilegível = o pago), limitado ao pago menos as outras, menos o substituído; possível duplicata e sem efeito = 0", () => {
    const v = (x: Partial<Parameters<typeof valorEmRisco>[0]>) => valorEmRisco({ valor: 100_000, pago: 100_000, outras: 0, substituido: 0, duplicataPossivel: false, situacao: "aberta", ...x });
    expect(v({})).toBe(100_000);
    expect(v({ valor: 30_000 })).toBe(30_000);
    expect(v({ valor: null })).toBe(100_000);
    expect(v({ valor: 104_000, pago: 104_000 })).toBe(104_000);
    expect(v({ outras: 70_000 })).toBe(30_000);
    expect(v({ substituido: 100_000 })).toBe(0);
    expect(v({ substituido: 20_000 })).toBe(80_000);
    expect(v({ duplicataPossivel: true })).toBe(0);
    expect(v({ situacao: "sem_efeito" })).toBe(0);
    expect(v({ outras: 100_000, valor: 50_000 })).toBe(0);
    // Σ ≤ pago: cada disputa nova vê as outras.
    const a = v({ valor: 60_000 });
    const b = v({ valor: 70_000, outras: a });
    expect(a + b).toBe(100_000);
    expect(v({ valor: 60_000, outras: b })).toBe(60_000);
    expect(() => v({ valor: 1.5 })).toThrow();
  });

  it("dividirPerda: proprietário com meio centavo para cima, SCL com o resto (soma exata); quem arca; D + C = 0 não divide", () => {
    expect(dividirPerda(1, 1, 1)).toEqual({ proprietario: 1, scl: 0 });
    expect(dividirPerda(5, 1, 1)).toEqual({ proprietario: 3, scl: 2 });
    expect(dividirPerda(100, 1, 2)).toEqual({ proprietario: 33, scl: 67 });
    expect(dividirPerda(3, 1, 2)).toEqual({ proprietario: 1, scl: 2 });
    expect(dividirPerda(0, 80_767, 14_253)).toEqual({ proprietario: 0, scl: 0 });
    for (const [valor, D, C] of [
      [99_999, 80_767, 14_253],
      [12_345, 1, 3],
      [1_000_000_000, 999_999_937, 7],
      [7, 3, 3],
    ])
      expect(dividirPerda(valor, D, C)!.proprietario + dividirPerda(valor, D, C)!.scl).toBe(valor);
    // Base líquida (a taxa saiu antes): 85% e 15% numa comissão de 15%. Base bruta: a mesma proporção, e a taxa fica com a SCL.
    expect(dividirPerda(100_000, 80_767, 14_253)).toEqual({ proprietario: 85_000, scl: 15_000 });
    expect(dividirPerda(100_000, 85_000, 15_000)).toEqual({ proprietario: 85_000, scl: 15_000 });
    // Partes efetivas com espelhos: o cancelamento integral zera as duas (D + C = 0): escolha a SCL ou o proprietário.
    expect(dividirPerda(100_000, 80_767 - 80_767, 14_253 - 14_253)).toBeNull();
    expect(dividirPerda(100_000, -10, 20)).toBeNull();
    expect(() => dividirPerda(-1, 1, 1)).toThrow();
    expect(divisaoDaDecisao("proprietario", 100_000, 0, 0)).toEqual({ proprietario: 100_000, scl: 0 });
    expect(divisaoDaDecisao("scl", 100_000, 0, 0)).toEqual({ proprietario: 0, scl: 100_000 });
    expect(divisaoDaDecisao("proporcional", 100_000, 0, 0)).toBeNull();
    expect(divisaoDaDecisao("proporcional", 100_000, 81_617, 14_403)).toEqual({ proprietario: 85_000, scl: 15_000 });
  });

  it("acertoDaPerda compara com o já lançado: exposição 100.000 (85.000 + 15.000), perdidos 80.000 → 68.000, ajuste +17.000, 12.000", () => {
    const base = { substituidas: [], quemArca: "proporcional" as const, baseParteProprietario: 80_767, baseComissao: 14_253 };
    expect(acertoDaPerda({ ...base, valorPerdido: 80_000, lancadoProprietario: 85_000, lancadoScl: 15_000 })).toEqual({
      perdaADividir: 80_000,
      proprietario: 68_000,
      scl: 12_000,
      ajusteProprietario: 17_000,
      espelhoScl: 15_000,
      perdaDefinitivaScl: -12_000,
    });
    // Perdida sem decisão: a decisão depois nasce definitiva (nada lançado antes).
    expect(acertoDaPerda({ ...base, valorPerdido: 100_000, lancadoProprietario: 0, lancadoScl: 0 })).toMatchObject({ ajusteProprietario: -85_000, espelhoScl: 0, perdaDefinitivaScl: -15_000 });
    expect(acertoDaPerda({ ...base, baseParteProprietario: 0, baseComissao: 0, valorPerdido: 100_000, lancadoProprietario: 0, lancadoScl: 0 })).toBeNull();
    // A devolução substituída é confirmada pela disputa pelo menor entre o valor dela e o perdido.
    expect(confirmadoPelasSubstituidas([100_000], 100_000)).toEqual([100_000]);
    expect(confirmadoPelasSubstituidas([100_000], 60_000)).toEqual([60_000]);
    expect(confirmadoPelasSubstituidas([30_000, 50_000], 60_000)).toEqual([30_000, 30_000]);
    expect(perdaADividir(100_000, [20_000])).toBe(80_000);
    expect(perdaADividir(60_000, [100_000])).toBe(0);
    expect(liquidoNaoEntrouProposto({ comRecebimento: false, liquido: 96_020 })).toBe(96_020);
    expect(liquidoNaoEntrouProposto({ comRecebimento: true, liquido: 96_020 })).toBe(0);
    expect(liquidoNaoEntrouProposto({ comRecebimento: false, liquido: null })).toBeNull();
    expect(valorSeguradoDesatualizado({ decisaoVersao: 1, exposicao: 100_000, valorEmRisco: 80_000, situacao: "aberta" })).toBe(true);
    expect(valorSeguradoDesatualizado({ decisaoVersao: 1, exposicao: 100_000, valorEmRisco: 100_000, situacao: "aberta" })).toBe(false);
    expect(valorSeguradoDesatualizado({ decisaoVersao: 0, exposicao: null, valorEmRisco: 80_000, situacao: "aberta" })).toBe(false);
    expect(valorSeguradoDesatualizado({ decisaoVersao: 1, exposicao: 100_000, valorEmRisco: 80_000, situacao: "perdida" })).toBe(false);
  });

  /**
   * Os seis exemplos do desenho (cartão, comissão de 15%, base líquida): o resultado final de cada lado (a parte da
   * reserva + os lançamentos da disputa) e a identidade do caixa (o que entrou − o retido realizado + a volta − o caixa
   * final = a soma dos dois lados). A taxa que não voltou é só resultado: o dinheiro já saiu no débito da disputa.
   */
  it("os seis exemplos: o final de cada lado e a identidade do caixa", () => {
    type Caso = { parte: number; comissao: number; entrou: number; retidoRealizado: number; volta?: number; taxaPerdida?: number; donoDisputa: number; sclDisputa: number; caixaFinal: number };
    const confere = (c: Caso, dono: number, scl: number) => {
      expect(c.parte + c.donoDisputa).toBe(dono);
      expect(c.comissao + c.sclDisputa - (c.taxaPerdida ?? 0)).toBe(scl);
      expect(c.entrou - c.retidoRealizado + (c.volta ?? 0) - c.caixaFinal).toBe(dono + scl);
    };
    const proporcional = { quemArca: "proporcional" as const, baseParteProprietario: 80_767, baseComissao: 14_253, substituidas: [] };
    // 1. Liberado na hora, parte repassada, proporcional, perdida: −42,33 e −7,47 (somam −49,80, a taxa).
    const d1 = divisaoDaDecisao("proporcional", 100_000, 80_767, 14_253)!;
    const a1 = acertoDaPerda({ ...proporcional, valorPerdido: 100_000, lancadoProprietario: d1.proprietario, lancadoScl: d1.scl })!;
    expect(a1).toMatchObject({ ajusteProprietario: 0, espelhoScl: 15_000, perdaDefinitivaScl: -15_000 });
    const cf1 = caixaFinalDaPerda({ valorPerdido: 100_000, liquidoNaoEntrou: 0, retidoRealizado: 100_000 });
    expect(cf1).toBe(0);
    confere({ parte: 80_767, comissao: 14_253, entrou: 95_020, retidoRealizado: 100_000, donoDisputa: -d1.proprietario + a1.ajusteProprietario, sclDisputa: -d1.scl + a1.espelhoScl + a1.perdaDefinitivaScl, caixaFinal: cf1 }, -4_233, -747);
    // 2. O mesmo, ganha: reversão +850,00, espelho +150,00 e a volta de 1.000,00: o resultado de antes da disputa.
    confere({ parte: 80_767, comissao: 14_253, entrou: 95_020, retidoRealizado: 100_000, volta: 100_000, donoDisputa: -d1.proprietario + d1.proprietario, sclDisputa: -d1.scl + d1.scl, caixaFinal: 0 }, 80_767, 14_253);
    // 3. Liberação em 30 dias (3,98%), disputa antes da liberação, o proprietário arca, perdida sem nunca liberar: saída de 39,80.
    const naoEntrou = liquidoNaoEntrouProposto({ comRecebimento: false, liquido: 96_020 })!;
    const cf3 = caixaFinalDaPerda({ valorPerdido: 100_000, liquidoNaoEntrou: naoEntrou, retidoRealizado: 0 });
    expect(cf3).toBe(3_980);
    const a3 = acertoDaPerda({ quemArca: "proprietario", baseParteProprietario: 81_617, baseComissao: 14_403, substituidas: [], valorPerdido: 100_000, lancadoProprietario: 100_000, lancadoScl: 0 })!;
    expect(a3).toMatchObject({ ajusteProprietario: 0, espelhoScl: 0, perdaDefinitivaScl: -0 });
    confere({ parte: 81_617, comissao: 14_403, entrou: 0, retidoRealizado: 0, donoDisputa: -100_000, sclDisputa: 0, caixaFinal: cf3 }, -18_383, 14_403);
    // 4. Liberado, a SCL arca (cobrança em dobro), perdida: o proprietário mantém a parte; a SCL fica com −857,47.
    const a4 = acertoDaPerda({ quemArca: "scl", baseParteProprietario: 80_767, baseComissao: 14_253, substituidas: [], valorPerdido: 100_000, lancadoProprietario: 0, lancadoScl: 100_000 })!;
    confere({ parte: 80_767, comissao: 14_253, entrou: 95_020, retidoRealizado: 100_000, donoDisputa: 0, sclDisputa: -100_000 + a4.espelhoScl + a4.perdaDefinitivaScl, caixaFinal: 0 }, 80_767, -85_747);
    // 5. Disputa de 300,00 antes da liberação (registrada à mão: 960,20 entram), a SCL arca, perdida: caixa final 0.
    const cf5 = caixaFinalDaPerda({ valorPerdido: 30_000, liquidoNaoEntrou: liquidoNaoEntrouProposto({ comRecebimento: true, liquido: 96_020 })!, retidoRealizado: 30_000 });
    expect(cf5).toBe(0);
    confere({ parte: 81_617, comissao: 14_403, entrou: 96_020, retidoRealizado: 30_000, donoDisputa: 0, sclDisputa: -30_000, caixaFinal: cf5 }, 81_617, -15_597);
    // 6. Cancelamento integral com a devolução ainda não saída, depois a disputa, perdida: a devolução é confirmada pela
    // disputa; nada a dividir; a taxa que não voltou (49,80) é da SCL. Proprietário −807,67 só pelo cancelamento.
    expect(valorEmRisco({ valor: 100_000, pago: 100_000, outras: 0, substituido: 100_000, duplicataPossivel: false, situacao: "aberta" })).toBe(0);
    expect(perdaADividir(100_000, [100_000])).toBe(0);
    const cf6 = caixaFinalDaPerda({ valorPerdido: 100_000, liquidoNaoEntrou: 0, retidoRealizado: 100_000 });
    // O cancelamento espelhou a parte (o desconto de −807,67 do que já foi repassado) e a comissão: a disputa não lança
    // nada para ninguém, e o resultado é a taxa da SCL; o caixa, o débito da disputa sobre o líquido que entrou.
    expect(cf6).toBe(0);
    confere({ parte: 80_767 - 80_767, comissao: 14_253 - 14_253, entrou: 95_020, retidoRealizado: 100_000, taxaPerdida: 4_980, donoDisputa: 0, sclDisputa: 0, caixaFinal: cf6 }, 0, -4_980);
  });
});

describe("chaves do livro", () => {
  it("todas com o prefixo da disputa, nunca com recebimento; a versão e o #N", () => {
    const k = chavesDaContestacao("p1", "c1");
    const todas = [
      k.retido(),
      k.retido(2),
      k.proprietario(1),
      k.scl(1),
      k.proprietario(3),
      k.scl(3),
      k.proprietarioReverte(),
      k.sclReverte(),
      k.volta(),
      k.proprietarioFinal(),
      k.sclEspelho(),
      k.sclFinal(),
      k.caixaFinal(),
      k.tarifa(),
      k.taxa(),
      k.semEfeito("l9"),
    ];
    expect(todas[0]).toBe("mercadopago:p1:contestacao:c1:retido");
    expect(todas[1]).toBe("mercadopago:p1:contestacao:c1:retido#2");
    expect(k.proprietario(1)).toBe("mercadopago:p1:contestacao:c1:proprietario:v1");
    expect(k.semEfeito("l9")).toBe("mercadopago:p1:contestacao:c1:sem_efeito:l9");
    expect(new Set(todas).size).toBe(todas.length);
    for (const c of todas) {
      expect(c.startsWith("mercadopago:p1:contestacao:c1:")).toBe(true);
      expect(c).not.toContain("recebimento");
      expect(ehChaveDeContestacao(c)).toBe(true);
    }
    expect(() => k.proprietario(0)).toThrow();
    expect(() => k.retido(0)).toThrow();
    for (const outra of ["mercadopago:p1:recebimento", "mercadopago:p1:devolucao:d1:saida", "mercadopago:p1:contestacao:c1:retido#1", "mercadopago:p1:contestacao:c1:proprietario:v0", "mercadopago:p1:contestacao:c1:outra", "reserva:r1:comissao"])
      expect(ehChaveDeContestacao(outra)).toBe(false);
  });
});

describe("assinaturas", () => {
  it("decisão: as entradas de dividirPerda; resultado: os fatos (nunca a hora da leitura)", () => {
    const d = { valor: 100_000, baseParteProprietario: 80_767, baseComissao: 14_253, quemArca: "proporcional" as const };
    expect(assinaturaDaDecisao(d)).toMatch(/^[0-9a-f]{16}$/);
    expect(assinaturaDaDecisao(d)).toBe(assinaturaDaDecisao({ ...d }));
    for (const mudou of [{ valor: 99_999 }, { baseParteProprietario: 80_000 }, { baseComissao: 14_000 }, { quemArca: "scl" as const }]) expect(assinaturaDaDecisao({ ...d, ...mudou })).not.toBe(assinaturaDaDecisao(d));
    const r = {
      situacao: "a_confirmar" as const,
      estadoLido: "reimbursed" as const,
      coberturaAplicada: false,
      valor: 100_000,
      valorEmRisco: 100_000,
      lancadoProprietario: 85_000,
      lancadoScl: 15_000,
      retido: { estado: "realizado", montante: 100_000 },
      decisaoVersao: 1,
    };
    expect(assinaturaDoResultado(r)).toMatch(/^[0-9a-f]{16}$/);
    for (const mudou of [{ situacao: "aberta" as const }, { estadoLido: "settled" as const }, { valorEmRisco: 80_000 }, { lancadoScl: 0 }, { retido: { estado: "previsto", montante: 100_000 } }, { retido: null }, { decisaoVersao: 2 }])
      expect(assinaturaDoResultado({ ...r, ...mudou })).not.toBe(assinaturaDoResultado(r));
  });
});

describe("causas e a decisão", () => {
  it("a frase de cada causa; na fraude, pela verificação do banco (AUTHENTICATED espera; Pix decide; os outros, a SCL); o sistema nunca escolhe", () => {
    const cartao = { forma: "cartao" as const, tresDSStatus: "AUTHENTICATED" };
    expect(CODIGOS_CAUSA_CONTESTACAO).toEqual(["imovel", "scl", "cobranca", "fraude", "outro"]);
    expect(fraseDaCausa("imovel", cartao)).toBe("pela regra de 7/10, o proprietário");
    expect(fraseDaCausa("cobranca", cartao)).toBe("pela regra de 7/10, a SCL");
    expect(fraseDaCausa("fraude", cartao)).toBe(TEXTOS_BASE_CAUSAS_CONTESTACAO.fraude.fraseComVerificacao);
    expect(fraseDaCausa("fraude", { forma: "cartao", tresDSStatus: "ATTEMPTED" })).toBe("pela regra da verificação do banco (Configurações → Pagamento no site), a SCL");
    expect(fraseDaCausa("fraude", { forma: "pix", tresDSStatus: null })).toBe("decida e registre o motivo");
    expect(fraseDaCausa("outro", cartao)).toBe("decida e registre o motivo");
    // As frases editadas valem.
    expect(fraseDaCausa("imovel", cartao, { ...TEXTOS_BASE_CAUSAS_CONTESTACAO, imovel: { nome: "Imóvel", frase: "o dono" } })).toBe("o dono");
    expect(quemArcaPelaRegra("imovel", cartao)).toBe("proprietario");
    expect(quemArcaPelaRegra("scl", cartao)).toBe("scl");
    expect(quemArcaPelaRegra("fraude", cartao)).toBeNull();
    expect(quemArcaPelaRegra("fraude", { forma: "cartao", tresDSStatus: null })).toBe("scl");
    expect(quemArcaPelaRegra("fraude", { forma: "pix", tresDSStatus: null })).toBeNull();
    expect(quemArcaPelaRegra("outro", cartao)).toBeNull();
    expect(confirmacaoReforcadaDaDecisao("fraude", "proprietario")).toBe(true);
    expect(confirmacaoReforcadaDaDecisao("fraude", "scl")).toBe(false);
    expect(confirmacaoReforcadaDaDecisao("imovel", "proprietario")).toBe(false);
  });

  it("a pergunta da confirmação: causa, quem arca, os dois valores, o segurado e a escolha diferente da regra", () => {
    const p = perguntaDaDecisao({ nomeCausa: "Pagamento não reconhecido", quemArca: "proprietario", proprietario: 100_000, scl: 0, comResultado: false, pelaRegra: "scl", reforcada: true });
    expect(p).toContain("Causa: Pagamento não reconhecido.");
    expect(p).toContain("Quem arca: o proprietário.");
    expect(p).toContain("R$ 1.000,00");
    expect(p).toContain("A regra indica a SCL: a decisão é diferente.");
    expect(p).toContain(TEXTO_CONFIRMACAO_REFORCADA_FRAUDE);
    expect(p).toContain("fica segurado nos próximos repasses até o resultado; volta no repasse seguinte se a SCL ganhar a disputa");
    const depois = perguntaDaDecisao({ nomeCausa: "Outro", quemArca: "proporcional", proprietario: 85_000, scl: 15_000, comResultado: true, pelaRegra: null, reforcada: false });
    expect(depois).not.toContain("até o resultado");
    expect(depois).not.toContain("A regra indica");
  });
});
