import { describe, expect, it } from "vitest";
import { DETALHES_VAZIOS, regrasDeVenda } from "@/imoveis/detalhes";
import { elevarParaPiso, faixasDeEnvio, intervaloDasReservas, janelasDeFeriado, planejarCalendario, reduzir, resumirPlano, type EntradaPlano, type LinhaPlano } from "./motor";
import { REGRAS_CALENDARIO_PADRAO, type RegrasCalendario } from "./regras-config";

const IM = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const regras = (over: Partial<RegrasCalendario> = {}): RegrasCalendario => ({ ...REGRAS_CALENDARIO_PADRAO, ...over });
const imovel = (over: Partial<EntradaPlano["imovel"]> = {}, detalhes: Partial<typeof DETALHES_VAZIOS> = {}): EntradaPlano["imovel"] => ({
  id: IM, regras: regrasDeVenda({ ...DETALHES_VAZIOS, precoBase: 45000, ...detalhes }), periodos: [], pisos: [35000, 30000] as const, fontePrecos: "scl", ...over,
} as EntradaPlano["imovel"]);
// Outubro de 2026: 1/10 é quinta; 2/10 sexta; 3/10 sábado; 4/10 domingo; 5/10 segunda.
const entrada = (over: Partial<EntradaPlano> = {}): EntradaPlano => ({
  imovel: imovel(), regras: regras(), hoje: "2026-10-01", inicio: "2026-10-01", fim: "2026-10-10", reservas: [], bloqueios: [], observacoes: [], enviados: [], ...over,
});
const obs = (data: string, over: Partial<EntradaPlano["observacoes"][number]> = {}) => ({ data, preco: 45000, minimoNoites: 1, maximoNoites: 27, livres: 1, bloqueio: null, observadoEm: new Date("2026-10-01T09:00:00Z"), ...over });
const porData = (linhas: LinhaPlano[], data: string) => linhas.find((l) => l.data === data)!;

describe("janelas de feriadão", () => {
  it("segue a tabela do requisito pelo dia da semana do feriado e ignora quarta, sábado e domingo", () => {
    // 15/10/2026 quinta; 20/11/2026 sexta; 7/9/2026 segunda; 21/4/2026 terça; 25/12/2026 sexta; 1/5/2026 sexta.
    expect(janelasDeFeriado([{ data: "2026-10-15", nome: "Professores" }])).toEqual([{ nome: "Professores", inicio: "2026-10-14", fim: "2026-10-18" }]);
    expect(janelasDeFeriado([{ data: "2026-11-20", nome: "Consciência Negra" }])).toEqual([{ nome: "Consciência Negra", inicio: "2026-11-19", fim: "2026-11-22" }]);
    expect(janelasDeFeriado([{ data: "2026-09-07", nome: "Independência" }])).toEqual([{ nome: "Independência", inicio: "2026-09-04", fim: "2026-09-07" }]);
    expect(janelasDeFeriado([{ data: "2026-04-21", nome: "Tiradentes" }])).toEqual([{ nome: "Tiradentes", inicio: "2026-04-17", fim: "2026-04-21" }]);
    // 12/10/2026 segunda → janela; 1/11/2026 domingo e 2/11/2026 segunda: só a segunda gera janela.
    expect(janelasDeFeriado([{ data: "2026-11-01", nome: "Todos os Santos" }, { data: "2026-11-02", nome: "Finados" }, { data: "2026-04-22", nome: "quarta" }, { data: "2026-04-25", nome: "sábado" }]))
      .toEqual([{ nome: "Finados", inicio: "2026-10-30", fim: "2026-11-02" }]);
  });
  it("une janelas vizinhas sem interrupção (quinta/sexta seguida de segunda/terça)", () => {
    // 16/4/2026 quinta (14/4–19/4) e 21/4/2026 terça (17/4–21/4): cruzam → uma só janela.
    expect(janelasDeFeriado([{ data: "2026-04-21", nome: "Tiradentes" }, { data: "2026-04-16", nome: "Quinta fictícia" }]))
      .toEqual([{ nome: "Quinta fictícia + Tiradentes", inicio: "2026-04-15", fim: "2026-04-21" }]);
    // 15/10 quinta (14–18/10) e 20/10 terça (16–20/10) também se unem; 29/10 quinta fica separada.
    expect(janelasDeFeriado([{ data: "2026-10-15", nome: "A" }, { data: "2026-10-20", nome: "B" }, { data: "2026-10-29", nome: "C" }]).map((j) => [j.inicio, j.fim]))
      .toEqual([["2026-10-14", "2026-10-20"], ["2026-10-28", "2026-11-01"]]);
  });
});

describe("preço de referência", () => {
  it("usa o preço base fora de eventos e ignora noites passadas", () => {
    const linhas = planejarCalendario(entrada({ inicio: "2026-09-25" }));
    expect(linhas[0].data).toBe("2026-10-01");
    expect(linhas).toHaveLength(10);
    expect(porData(linhas, "2026-10-09")).toMatchObject({ fontePreco: "base", precoReferencia: 45000, precoEnviar: 45000, precoFinalEsperado: 45000, motivoPreco: "Preço base" });
  });
  it("período explícito substitui multiplicadores e não é limitado ao teto", () => {
    const ev = { id: OUTRO, nome: "Carnaval", inicio: "2026-10-05", fim: "2026-10-09", multiplicador: 400, estadiaMinima: 5, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] };
    const linhas = planejarCalendario(entrada({
      regras: regras({ eventos: [ev] }),
      imovel: imovel({ periodos: [{ nome: "Réveillon", inicio: "2026-10-08", fim: "2026-10-09", precoNoite: 300000, estadiaMinima: null }] }, { precoDinamico: true, precoMinimo: 40000, precoMaximo: 60000 }),
    }));
    expect(porData(linhas, "2026-10-08")).toMatchObject({ fontePreco: "periodo", precoReferencia: 300000, motivoPreco: "Período Réveillon", minimoRegra: 5, motivoMinimo: "Evento Carnaval" });
    expect(porData(linhas, "2026-10-07")).toMatchObject({ fontePreco: "evento", precoReferencia: 180000, motivoPreco: "Evento Carnaval (4× a base)" });
  });
  it("multiplicadores não somam: vale o maior; evento só nos imóveis escolhidos", () => {
    const alta = { id: OUTRO, nome: "Alta temporada", inicio: "2026-10-01", fim: "2026-10-10", multiplicador: 200, estadiaMinima: null, minimoNormalComReserva: true, todosImoveis: false, imoveis: [IM] };
    const carnaval = { id: IM, nome: "Carnaval", inicio: "2026-10-05", fim: "2026-10-06", multiplicador: 400, estadiaMinima: 5, minimoNormalComReserva: true, todosImoveis: false, imoveis: [IM] };
    const soOutro = { id: "33333333-3333-4333-8333-333333333333", nome: "Búzios", inicio: "2026-10-01", fim: "2026-10-10", multiplicador: 1000, estadiaMinima: null, minimoNormalComReserva: true, todosImoveis: false, imoveis: [OUTRO] };
    const linhas = planejarCalendario(entrada({ regras: regras({ eventos: [alta, carnaval, soOutro] }) }));
    expect(porData(linhas, "2026-10-05")).toMatchObject({ precoReferencia: 180000, motivoPreco: "Evento Carnaval (4× a base); multiplicadores não somam, vale o maior", minimoRegra: 5 });
    expect(porData(linhas, "2026-10-04")).toMatchObject({ precoReferencia: 90000, motivoPreco: "Evento Alta temporada (2× a base)", minimoRegra: 1 });
    expect(planejarCalendario(entrada({ regras: regras({ eventos: [soOutro] }) })).every((l) => l.precoReferencia === 45000)).toBe(true);
  });
  it("feriadão multiplica e eleva o mínimo só nos imóveis escolhidos; multiplicador com decimais arredonda em centavos", () => {
    // 15/10/2026 quinta → janela 14/10 a 18/10.
    const r = regras({ feriados: [{ data: "2026-10-15", nome: "Professores" }], janelaFeriado: { estadiaMinima: 3, multiplicador: 250, minimoNormalComReserva: true, todosImoveis: false, imoveis: [IM] } });
    const linhas = planejarCalendario(entrada({ regras: r, inicio: "2026-10-13", fim: "2026-10-19", imovel: imovel({}, { precoBase: 45001 }) }));
    expect(porData(linhas, "2026-10-13")).toMatchObject({ precoReferencia: 45001, minimoRegra: 1 });
    expect(porData(linhas, "2026-10-14")).toMatchObject({ fontePreco: "feriado", precoReferencia: 112503, motivoPreco: "Feriadão Professores (2,5× a base)", minimoRegra: 3, motivoMinimo: "Feriadão Professores" });
    expect(porData(linhas, "2026-10-18")).toMatchObject({ precoReferencia: 112503, minimoRegra: 3 });
    expect(porData(linhas, "2026-10-19")).toMatchObject({ precoReferencia: 45001, minimoRegra: 1 });
    const semImovel = planejarCalendario(entrada({ regras: { ...r, janelaFeriado: { ...r.janelaFeriado, imoveis: [] } }, inicio: "2026-10-15", fim: "2026-10-15" }));
    expect(semImovel[0]).toMatchObject({ precoReferencia: 45000, minimoRegra: 1 });
  });
  it("sem preço base nada é enviado como preço e a noite recebe aviso; mínimo ainda é planejado", () => {
    const [l] = planejarCalendario(entrada({ imovel: imovel({}, { precoBase: null }), fim: "2026-10-01" }));
    expect(l).toMatchObject({ fontePreco: "sem_preco", precoReferencia: null, precoEnviar: null, acao: "enviar", minimoEnviar: 1 });
    expect(l.avisos).toContain("Preço não cadastrado no SCL: nenhum preço será enviado para esta noite.");
    // Sem preço a enviar, o preço do Beds24 não entra na comparação: mínimo e máximo iguais → "igual", sem reenvio eterno.
    const [igual] = planejarCalendario(entrada({ imovel: imovel({}, { precoBase: null }), fim: "2026-10-01", observacoes: [obs("2026-10-01", { preco: 40000, minimoNoites: 1, maximoNoites: 27 })] }));
    expect(igual.acao).toBe("igual");
    const [diferente] = planejarCalendario(entrada({ imovel: imovel({}, { precoBase: null }), fim: "2026-10-01", observacoes: [obs("2026-10-01", { preco: 40000, minimoNoites: 2, maximoNoites: 27 })] }));
    expect(diferente.acao).toBe("enviar");
  });
});

describe("última hora", () => {
  const ref = (hoje: string, data: string, over: Partial<EntradaPlano> = {}) => porData(planejarCalendario(entrada({ hoje, inicio: data, fim: data, ...over })), data);
  it("faixas por antecedência da noite com o Beds24 aplicando: envia a referência e espera o preço reduzido", () => {
    expect(ref("2026-10-01", "2026-10-09")).toMatchObject({ antecedencia: 8, faixaUltimaHora: null, percentualUltimaHora: 0, precoEnviar: 45000, precoFinalEsperado: 45000 });
    expect(ref("2026-10-01", "2026-10-08")).toMatchObject({ antecedencia: 7, faixaUltimaHora: 0, percentualUltimaHora: 15, piso: 35000, precoEnviar: 45000, precoFinalEsperado: 38250 });
    expect(ref("2026-10-01", "2026-10-04")).toMatchObject({ antecedencia: 3, percentualUltimaHora: 15, precoFinalEsperado: 38250 });
    expect(ref("2026-10-01", "2026-10-03")).toMatchObject({ antecedencia: 2, faixaUltimaHora: 1, percentualUltimaHora: 25, piso: 30000, precoEnviar: 45000, precoFinalEsperado: 33750 });
    expect(ref("2026-10-01", "2026-10-01")).toMatchObject({ antecedencia: 0, percentualUltimaHora: 25, precoFinalEsperado: 33750 });
  });
  it("a passagem de D−3 para D−2 muda a faixa sem acumular: a referência vem sempre do cadastro", () => {
    const d3 = ref("2026-10-01", "2026-10-04", { observacoes: [obs("2026-10-04")] });
    const d2 = ref("2026-10-02", "2026-10-04", { observacoes: [obs("2026-10-04", { preco: d3.precoEnviar })] });
    expect([d3.percentualUltimaHora, d2.percentualUltimaHora]).toEqual([15, 25]);
    expect(d2.precoReferencia).toBe(45000);
    expect(d2.precoFinalEsperado).toBe(33750);
  });
  it("protege o piso elevando a referência enviada quando o desconto nativo cairia abaixo dele (arredondamento conferido)", () => {
    // 393 × 0,85 = 334,05 < piso 350 → envia ceil(350/0,85) = 411,77; 411,77 × 0,85 = 350,00 (arredondado).
    const l = ref("2026-10-01", "2026-10-04", { imovel: imovel({}, { precoBase: 39300 }) });
    expect(l).toMatchObject({ precoReferencia: 39300, precoEnviar: 41177, precoFinalEsperado: 35000, motivoPreco: "Preço base" });
    expect(l.regra).toContain("referência elevada para proteger o piso de R$ 350,00");
    expect(reduzir(41177, 15)).toBe(35000);
    expect(elevarParaPiso(35000, 15)).toBe(41177);
    expect(reduzir(45001, 15)).toBe(38251);
    // Com 25% e piso 300: 393 × 0,75 = 294,75 < 300 → envia 400,00 → final 300,00.
    expect(ref("2026-10-01", "2026-10-02", { imovel: imovel({}, { precoBase: 39300 }) })).toMatchObject({ precoEnviar: 40000, precoFinalEsperado: 30000 });
    // Referência já acima: nada muda.
    expect(ref("2026-10-01", "2026-10-02", { imovel: imovel({}, { precoBase: 80000 }) })).toMatchObject({ precoEnviar: 80000, precoFinalEsperado: 60000 });
  });
  it("sem piso cadastrado avisa: Beds24 reduz mesmo assim; SCL não reduz", () => {
    const b = ref("2026-10-01", "2026-10-02", { imovel: imovel({ pisos: [null, null] }) });
    expect(b).toMatchObject({ precoEnviar: 45000, precoFinalEsperado: 33750 });
    expect(b.avisos).toContain("Piso da 2ª faixa de última hora não cadastrado: o desconto nativo de 25% pode ficar abaixo do desejado.");
    const scl = regras({ ultimaHora: { ...REGRAS_CALENDARIO_PADRAO.ultimaHora, aplicadoPor: "scl" } });
    const s = ref("2026-10-01", "2026-10-02", { imovel: imovel({ pisos: [null, null] }), regras: scl });
    expect(s).toMatchObject({ precoEnviar: 45000, precoFinalEsperado: 45000 });
    expect(s.avisos).toContain("Piso da 2ª faixa de última hora não cadastrado: a redução de 25% não foi aplicada.");
  });
  it("SCL aplicando envia o preço final já reduzido, limitado ao piso; desligada não reduz", () => {
    const scl = regras({ ultimaHora: { ...REGRAS_CALENDARIO_PADRAO.ultimaHora, aplicadoPor: "scl" } });
    expect(ref("2026-10-01", "2026-10-05", { regras: scl })).toMatchObject({ precoEnviar: 38250, precoFinalEsperado: 38250, percentualUltimaHora: 15 });
    expect(ref("2026-10-01", "2026-10-02", { regras: scl, imovel: imovel({}, { precoBase: 39300 }) })).toMatchObject({ precoEnviar: 30000, precoFinalEsperado: 30000 });
    const des = regras({ ultimaHora: { ...REGRAS_CALENDARIO_PADRAO.ultimaHora, aplicadoPor: "desligada" } });
    expect(ref("2026-10-01", "2026-10-01", { regras: des })).toMatchObject({ faixaUltimaHora: null, precoEnviar: 45000, precoFinalEsperado: 45000 });
  });
});

describe("estadia mínima, máxima e sobras", () => {
  it("semana normal (sexta e sábado 2), cadastro do imóvel e máximo padrão/próprio", () => {
    const linhas = planejarCalendario(entrada());
    expect(linhas.map((l) => l.minimoRegra)).toEqual([1, 2, 2, 1, 1, 1, 1, 1, 2, 2]);
    expect(porData(linhas, "2026-10-02").motivoMinimo).toBe("Semana normal");
    expect(linhas.every((l) => l.maximoEnviar === 27)).toBe(true);
    const proprio = planejarCalendario(entrada({ imovel: imovel({}, { estadiaMinima: 3, estadiaMaxima: 10 }) }));
    expect(proprio.map((l) => l.minimoRegra)).toEqual(Array(10).fill(3));
    expect(proprio[0]).toMatchObject({ motivoMinimo: "Cadastro do imóvel", maximoEnviar: 10 });
  });
  it("sobras: mínimo ajustado ao número de noites livres até a próxima reserva ou bloqueio (3, 2, 1), sem mexer no que está ocupado", () => {
    // Regra de 6/10 desligada no evento (ex.: temporada longa): vale só a regra geral das sobras.
    const ev = { id: OUTRO, nome: "Réveillon", inicio: "2026-10-01", fim: "2026-10-10", multiplicador: 400, estadiaMinima: 5, minimoNormalComReserva: false, todosImoveis: true, imoveis: [] };
    const linhas = planejarCalendario(entrada({
      regras: regras({ eventos: [ev] }),
      reservas: [{ checkin: "2026-10-04", checkout: "2026-10-09", estado: "confirmada" }, { checkin: "2026-10-09", checkout: "2026-10-12", estado: "consulta" }],
      fimDados: "2026-10-20",
    }));
    expect(linhas.map((l) => [l.livresSeguidas, l.minimoEnviar])).toEqual([[3, 3], [2, 2], [1, 1], [0, 5], [0, 5], [0, 5], [0, 5], [0, 5], [null, 5], [null, 5]]);
    expect(porData(linhas, "2026-10-02").motivoMinimo).toBe("Evento Réveillon; sobra de 2 noite(s) até a próxima reserva/bloqueio");
    expect(porData(linhas, "2026-10-04")).toMatchObject({ reservas: 1, minimoEnviar: 5 });
  });
  it("regra de 6/10: evento com reserva confirmada no período usa o mínimo normal da semana nas noites livres, antes e depois da reserva, e mantém o preço", () => {
    // 1/10 quinta, 2/10 sexta, 3/10 sábado; reserva confirmada de 4/10 a 9/10 no meio do evento.
    const ev = { id: OUTRO, nome: "Réveillon", inicio: "2026-10-01", fim: "2026-10-10", multiplicador: 400, estadiaMinima: 5, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] };
    const linhas = planejarCalendario(entrada({ regras: regras({ eventos: [ev] }), reservas: [{ checkin: "2026-10-04", checkout: "2026-10-09", estado: "confirmada" }], fimDados: "2026-10-20" }));
    // Quinta 1 noite; sexta e sábado 2, limitado às noites livres seguidas (o sábado sobra sozinho: 1). Depois da reserva, 9/10 sexta e 10/10 sábado: 2.
    expect(linhas.map((l) => [l.data, l.minimoRegra, l.minimoEnviar])).toEqual([
      ["2026-10-01", 1, 1], ["2026-10-02", 2, 2], ["2026-10-03", 2, 1], ["2026-10-04", 1, 1], ["2026-10-05", 1, 1], ["2026-10-06", 1, 1], ["2026-10-07", 1, 1], ["2026-10-08", 1, 1], ["2026-10-09", 2, 2], ["2026-10-10", 2, 2],
    ]);
    expect(porData(linhas, "2026-10-01").motivoMinimo).toBe("Semana normal; Evento Réveillon já tem reserva confirmada: noites livres com o mínimo normal");
    expect(porData(linhas, "2026-10-03").motivoMinimo).toBe("Semana normal; Evento Réveillon já tem reserva confirmada: noites livres com o mínimo normal; sobra de 1 noite(s) até a próxima reserva/bloqueio");
    // O preço do evento continua em todas as noites da janela, antes e depois da reserva.
    expect(linhas.every((l) => l.precoReferencia === 180000 && l.fontePreco === "evento")).toBe(true);
    // Depois da janela, volta ao normal da data (11/10 domingo: 1 noite, preço base).
    const depois = planejarCalendario(entrada({ regras: regras({ eventos: [ev] }), reservas: [{ checkin: "2026-10-04", checkout: "2026-10-09", estado: "confirmada" }], inicio: "2026-10-11", fim: "2026-10-11" }));
    expect(depois[0]).toMatchObject({ minimoRegra: 1, precoReferencia: 45000, motivoMinimo: "Semana normal" });
  });
  it("regra de 6/10: sem reserva confirmada no período (só consulta, pedido do site ou pendente), o mínimo do evento vale na janela inteira", () => {
    const ev = { id: OUTRO, nome: "Carnaval", inicio: "2026-10-01", fim: "2026-10-10", multiplicador: 400, estadiaMinima: 5, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] };
    for (const estado of ["consulta", "pedido", "pendente", "cancelada"] as const) {
      const linhas = planejarCalendario(entrada({ regras: regras({ eventos: [ev] }), reservas: [{ checkin: "2026-10-04", checkout: "2026-10-06", estado }] }));
      expect(porData(linhas, "2026-10-01").minimoRegra).toBe(5);
      expect(porData(linhas, "2026-10-08")).toMatchObject({ minimoRegra: 5, motivoMinimo: "Evento Carnaval" });
    }
    // Reserva confirmada fora do período (antes ou depois) não conta; de outro evento também não.
    const fora = planejarCalendario(entrada({ regras: regras({ eventos: [ev] }), reservas: [{ checkin: "2026-09-28", checkout: "2026-10-01", estado: "confirmada" }, { checkin: "2026-10-11", checkout: "2026-10-13", estado: "confirmada" }], fimDados: "2026-10-20" }));
    expect(porData(fora, "2026-10-05").minimoRegra).toBe(5);
    // Reserva que só toca a última noite do período conta (entra em 10/10).
    const ultima = planejarCalendario(entrada({ regras: regras({ eventos: [ev] }), reservas: [{ checkin: "2026-10-10", checkout: "2026-10-12", estado: "confirmada" }] }));
    expect(porData(ultima, "2026-10-01").minimoRegra).toBe(1);
  });
  it("regra de 6/10: reserva confirmada anterior a hoje, dentro do período, ainda conta; evento sem a regra mantém o mínimo; vale o maior dos que não cedem", () => {
    const reveillon = { id: OUTRO, nome: "Réveillon", inicio: "2026-09-28", fim: "2026-10-06", multiplicador: 400, estadiaMinima: 5, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] };
    const passada = [{ checkin: "2026-09-28", checkout: "2026-09-30", estado: "confirmada" as const }];
    expect(porData(planejarCalendario(entrada({ regras: regras({ eventos: [reveillon] }), reservas: passada })), "2026-10-01").minimoRegra).toBe(1);
    // Temporada longa com a regra desligada continua exigindo o mínimo dela mesmo com o Réveillon cedendo.
    const alta = { id: IM, nome: "Alta temporada", inicio: "2026-09-01", fim: "2026-10-31", multiplicador: 200, estadiaMinima: 3, minimoNormalComReserva: false, todosImoveis: true, imoveis: [] };
    const linhas = planejarCalendario(entrada({ regras: regras({ eventos: [reveillon, alta] }), reservas: passada }));
    expect(porData(linhas, "2026-10-01")).toMatchObject({ minimoRegra: 3, motivoMinimo: "Evento Alta temporada; Evento Réveillon já tem reserva confirmada: noites livres com o mínimo normal" });
    // O cadastro do imóvel faz parte do mínimo normal e continua valendo.
    const cadastro = planejarCalendario(entrada({ imovel: imovel({}, { estadiaMinima: 2 }), regras: regras({ eventos: [reveillon] }), reservas: passada }));
    expect(porData(cadastro, "2026-10-01")).toMatchObject({ minimoRegra: 2, motivoMinimo: "Cadastro do imóvel; Evento Réveillon já tem reserva confirmada: noites livres com o mínimo normal" });
    // Período explícito do imóvel com mínimo substitui tudo, como antes.
    const periodo = planejarCalendario(entrada({ imovel: imovel({ periodos: [{ nome: "Réveillon do imóvel", inicio: "2026-10-01", fim: "2026-10-02", precoNoite: null, estadiaMinima: 4 }] }), regras: regras({ eventos: [reveillon] }), reservas: passada }));
    expect(porData(periodo, "2026-10-01")).toMatchObject({ minimoRegra: 4, motivoMinimo: "Período Réveillon do imóvel" });
  });
  it("regra de 6/10 também no feriadão (janela inteira, com a opção ligada); desligada, mantém o mínimo do feriadão", () => {
    // 15/10/2026 quinta → janela 14/10 (quarta) a 18/10 (domingo); reserva confirmada de 15 a 17/10.
    const base = regras({ feriados: [{ data: "2026-10-15", nome: "Professores" }], janelaFeriado: { estadiaMinima: 3, multiplicador: 200, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] } });
    const reservas = [{ checkin: "2026-10-15", checkout: "2026-10-17", estado: "confirmada" as const }];
    const linhas = planejarCalendario(entrada({ regras: base, reservas, inicio: "2026-10-14", fim: "2026-10-18", fimDados: "2026-10-30" }));
    expect(linhas.map((l) => [l.data, l.minimoEnviar, l.precoReferencia])).toEqual([
      ["2026-10-14", 1, 90000], ["2026-10-15", 1, 90000], ["2026-10-16", 2, 90000], ["2026-10-17", 2, 90000], ["2026-10-18", 1, 90000],
    ]);
    expect(porData(linhas, "2026-10-14").motivoMinimo).toContain("Feriadão Professores já tem reserva confirmada");
    // Desligada: o mínimo do feriadão (3) volta, só encurtado pela regra geral da sobra (reserva fora da janela em 19/10).
    const desligada = planejarCalendario(entrada({ regras: { ...base, janelaFeriado: { ...base.janelaFeriado, minimoNormalComReserva: false } }, reservas: [...reservas, { checkin: "2026-10-19", checkout: "2026-10-21", estado: "confirmada" }], inicio: "2026-10-17", fim: "2026-10-17", fimDados: "2026-10-30" }));
    expect(desligada[0]).toMatchObject({ minimoRegra: 3, minimoEnviar: 2, motivoMinimo: "Feriadão Professores; sobra de 2 noite(s) até a próxima reserva/bloqueio" });
  });
  it("regra de 6/10 noite a noite: feriadão dentro do Réveillon ou do Carnaval cede junto quando o evento já tem reserva", () => {
    // Réveillon 25/12/2026 a 1/1/2027 (mínimo 5); Natal 25/12 (sexta: janela 24–27/12) e Confraternização 1/1/2027
    // (sexta: janela 31/12–3/1), mínimo do feriadão 3; uma reserva confirmada de 28 a 30/12, no miolo do Réveillon.
    const reveillon = { id: OUTRO, nome: "Réveillon", inicio: "2026-12-25", fim: "2027-01-01", multiplicador: 400, estadiaMinima: 5, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] };
    const r = regras({ eventos: [reveillon], feriados: [{ data: "2026-12-25", nome: "Natal" }, { data: "2027-01-01", nome: "Confraternização" }], janelaFeriado: { estadiaMinima: 3, multiplicador: 200, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] } });
    const linhas = planejarCalendario(entrada({ regras: r, hoje: "2026-12-01", inicio: "2026-12-24", fim: "2027-01-03", reservas: [{ checkin: "2026-12-28", checkout: "2026-12-30", estado: "confirmada" }], fimDados: "2027-01-20" }));
    // 24/12 (quinta) é só do feriadão do Natal, sem reserva nele: mantém 3. 25/12 a 1/1: mínimo normal (sexta e sábado 2,
    // limitado à sobra). 2/1 e 3/1 estão só na janela da Confraternização, sem reserva nela: mantêm 3 (limitado ao que sobra).
    expect(linhas.map((l) => [l.data, l.minimoRegra])).toEqual([
      ["2026-12-24", 3], ["2026-12-25", 2], ["2026-12-26", 2], ["2026-12-27", 1], ["2026-12-28", 1], ["2026-12-29", 1], ["2026-12-30", 1], ["2026-12-31", 1], ["2027-01-01", 2], ["2027-01-02", 3], ["2027-01-03", 3],
    ]);
    expect(porData(linhas, "2026-12-31").motivoMinimo).toBe("Semana normal; Evento Réveillon já tem reserva confirmada: noites livres com o mínimo normal");
    // Carnaval 1/2 a 10/2/2027 (mínimo 5) e feriado estadual numa terça, 9/2 (janela 5/2–9/2, mínimo 3); reserva de 1 a 4/2.
    const carnaval = { ...reveillon, nome: "Carnaval", inicio: "2027-02-01", fim: "2027-02-10" };
    const c = regras({ eventos: [carnaval], feriados: [{ data: "2027-02-09", nome: "Feriado fictício" }], janelaFeriado: { estadiaMinima: 3, multiplicador: 200, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] } });
    const lc = planejarCalendario(entrada({ regras: c, hoje: "2027-01-10", inicio: "2027-02-05", fim: "2027-02-09", reservas: [{ checkin: "2027-02-01", checkout: "2027-02-04", estado: "confirmada" }] }));
    expect(lc.map((l) => l.minimoRegra)).toEqual([2, 2, 1, 1, 1]);
    // Temporada longa com a regra desligada não cede, mesmo na noite em que o Réveillon cedeu.
    const alta = { ...reveillon, id: IM, nome: "Alta temporada", inicio: "2026-12-15", fim: "2027-02-28", multiplicador: 200, estadiaMinima: 4, minimoNormalComReserva: false };
    const comAlta = planejarCalendario(entrada({ regras: { ...r, eventos: [reveillon, alta] }, hoje: "2026-12-01", inicio: "2026-12-31", fim: "2026-12-31", reservas: [{ checkin: "2026-12-28", checkout: "2026-12-30", estado: "confirmada" }], fimDados: "2027-01-20" }));
    expect(comAlta[0]).toMatchObject({ minimoRegra: 4, motivoMinimo: "Evento Alta temporada; Evento Réveillon já tem reserva confirmada: noites livres com o mínimo normal" });
  });
  it("intervaloDasReservas estende a carga ao período inteiro dos eventos e feriadões com a regra ligada que tocam as noites", () => {
    const ev = { id: OUTRO, nome: "Réveillon", inicio: "2026-12-25", fim: "2027-01-01", multiplicador: 400, estadiaMinima: 5, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] };
    const semMinimo = { ...ev, id: IM, nome: "Alta", inicio: "2026-12-01", fim: "2027-02-28", estadiaMinima: null };
    const desligado = { ...ev, id: "33333333-3333-4333-8333-333333333333", inicio: "2026-12-20", fim: "2027-01-05", minimoNormalComReserva: false };
    const outroImovel = { ...ev, id: "44444444-4444-4444-8444-444444444444", inicio: "2026-12-10", fim: "2027-01-10", todosImoveis: false, imoveis: [OUTRO] };
    const r = regras({ eventos: [ev, semMinimo, desligado, outroImovel], feriados: [{ data: "2027-01-01", nome: "Confraternização" }], janelaFeriado: { estadiaMinima: 3, multiplicador: 200, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] } });
    // 1/1/2027 sexta → janela 31/12 a 3/1.
    expect(intervaloDasReservas(r, IM, "2026-12-30", "2026-12-30")).toEqual({ inicio: "2026-12-25", fim: "2027-01-01" });
    expect(intervaloDasReservas(r, IM, "2027-01-02", "2027-01-02")).toEqual({ inicio: "2026-12-31", fim: "2027-01-03" });
    expect(intervaloDasReservas(r, IM, "2027-01-20", "2027-01-25")).toEqual({ inicio: "2027-01-20", fim: "2027-01-25" });
    expect(intervaloDasReservas({ ...r, janelaFeriado: { ...r.janelaFeriado, minimoNormalComReserva: false } }, IM, "2027-01-02", "2027-01-02")).toEqual({ inicio: "2027-01-02", fim: "2027-01-02" });
  });
  it("sobra limitada pelos dados carregados: sem fim conhecido não reduz; bloqueio importado também conta como ocupação", () => {
    const linhas = planejarCalendario(entrada({ imovel: imovel({}, { estadiaMinima: 4 }), bloqueios: [{ inicio: "2026-10-12", fim: "2026-10-14", fonte: "beds24" }], fim: "2026-10-10", fimDados: "2026-10-15" }));
    expect(linhas.map((l) => l.minimoEnviar)).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 3, 2]);
    expect(linhas.every((l) => l.bloqueioEnviar === undefined)).toBe(true);
    const semFim = planejarCalendario(entrada({ imovel: imovel({}, { estadiaMinima: 4 }), fim: "2026-10-10" }));
    expect(semFim.map((l) => l.minimoEnviar)).toEqual(Array(10).fill(4));
  });
  it("mínimo acima do máximo nunca é enviado: vai o máximo como mínimo, com aviso", () => {
    const [l] = planejarCalendario(entrada({ imovel: imovel({}, { estadiaMinima: 30, estadiaMaxima: 10 }), fim: "2026-10-01" }));
    expect(l.avisos).toContain("Mínimo (30) acima do máximo (10): enviado mínimo igual ao máximo; conferir o cadastro.");
    expect(l).toMatchObject({ minimoRegra: 30, minimoEnviar: 10, maximoEnviar: 10 });
    expect(faixasDeEnvio([l])).toEqual([{ from: "2026-10-01", to: "2026-10-01", preco: 45000, minimo: 10, maximo: 10 }]);
    // Máximo 1 com mínimo de sexta 2: enviado 1/1.
    const sexta = porData(planejarCalendario(entrada({ imovel: imovel({}, { estadiaMaxima: 1 }) })), "2026-10-02");
    expect(sexta).toMatchObject({ minimoEnviar: 1, maximoEnviar: 1 });
  });
});

describe("bloqueios e conferência com o Beds24", () => {
  it("bloqueio manual do SCL fecha a noite; reabre só o que o SCL fechou antes; nunca o que veio do Beds24", () => {
    const enviado = { data: "2026-10-05", preco: 45000, minimo: 1, maximo: 27, bloqueio: "blackout", confirmado: true, enviadoEm: new Date("2026-09-30T10:00:00Z") };
    const linhas = planejarCalendario(entrada({
      bloqueios: [{ inicio: "2026-10-02", fim: "2026-10-04", fonte: "manual" }],
      enviados: [enviado],
      observacoes: [obs("2026-10-05", { livres: 0, bloqueio: "blackout" }), obs("2026-10-07", { livres: 0, bloqueio: "blackout" }), obs("2026-10-08", { livres: 0 })],
    }));
    expect(linhas.map((l) => l.bloqueioEnviar)).toEqual([undefined, "blackout", "blackout", undefined, "none", undefined, undefined, undefined, undefined, undefined]);
    expect(porData(linhas, "2026-10-02")).toMatchObject({ bloqueioScl: true, livresSeguidas: 0, acao: "enviar" });
    expect(porData(linhas, "2026-10-02").regra).toContain("bloqueio do SCL");
    expect(porData(linhas, "2026-10-05").regra).toContain("reabre bloqueio do SCL");
    expect(porData(linhas, "2026-10-07").avisos).toContain("Beds24 tem bloqueio (blackout) sem bloqueio no SCL: o SCL não reabre o que não fechou; confira.");
    expect(porData(linhas, "2026-10-08").avisos).toContain("Beds24 informa 0 unidades sem reserva ou bloqueio no SCL: confira a importação antes de vender.");
  });
  it("M8.3c: unidades negativas no Beds24 (overbooking) dão o aviso próprio, com ou sem reserva no SCL", () => {
    const overbooking = "Beds24 informa unidades negativas (overbooking): há mais reservas que unidades nesta noite; resolva no Beds24 com o hóspede ou com o canal.";
    const linhas = planejarCalendario(entrada({
      reservas: [{ checkin: "2026-10-03", checkout: "2026-10-04", estado: "confirmada" }],
      observacoes: [obs("2026-10-02", { livres: -1 }), obs("2026-10-03", { livres: -2 }), obs("2026-10-04", { livres: 0 })],
    }));
    expect(porData(linhas, "2026-10-02").avisos).toContain(overbooking);
    expect(porData(linhas, "2026-10-02").avisos.join(" ")).not.toContain("0 unidades");
    expect(porData(linhas, "2026-10-03").avisos).toContain(overbooking);
    // O zero continua com o aviso de antes, e não com o do overbooking.
    expect(porData(linhas, "2026-10-04").avisos).not.toContain(overbooking);
    expect(porData(linhas, "2026-10-04").avisos).toContain("Beds24 informa 0 unidades sem reserva ou bloqueio no SCL: confira a importação antes de vender.");
  });
  it("reabertura do bloqueio do SCL só quando a leitura atual ainda mostra o blackout; restrição externa ou falta de leitura não são apagadas", () => {
    const enviadoEm = new Date("2026-09-30T10:00:00Z");
    const enviado = (data: string) => ({ data, preco: 45000, minimo: 1, maximo: 27, bloqueio: "blackout", confirmado: true, enviadoEm });
    const linhas = planejarCalendario(entrada({
      enviados: [enviado("2026-10-02"), enviado("2026-10-03"), enviado("2026-10-04"), enviado("2026-10-05")],
      observacoes: [obs("2026-10-02", { livres: 0, bloqueio: "blackout" }), obs("2026-10-03", { bloqueio: "noCheckIn" }), obs("2026-10-05", { bloqueio: "blackout", observadoEm: new Date("2026-09-29T00:00:00Z") })],
    }));
    expect(porData(linhas, "2026-10-02")).toMatchObject({ bloqueioEnviar: "none", acao: "enviar" });
    expect(porData(linhas, "2026-10-02").posseBloqueioEncerrada).toBe(false);
    expect(porData(linhas, "2026-10-03")).toMatchObject({ bloqueioEnviar: undefined, posseBloqueioEncerrada: true });
    expect(porData(linhas, "2026-10-03").avisos).toContain('Bloqueio do SCL removido, mas o Beds24 tem a restrição "noCheckIn" nesta noite: não é apagada, e o SCL deixa de considerar o bloqueio como seu; confira no Beds24.');
    expect(porData(linhas, "2026-10-04")).toMatchObject({ bloqueioEnviar: undefined, posseBloqueioEncerrada: false });
    expect(porData(linhas, "2026-10-04").avisos).toContain("Bloqueio do SCL removido, mas sem leitura recente do Beds24: a reabertura espera a próxima leitura.");
    // Observação mais antiga que o último envio não vale como leitura atual: posse mantida, nada enviado.
    expect(porData(linhas, "2026-10-05")).toMatchObject({ bloqueioEnviar: undefined, posseBloqueioEncerrada: false });
    expect(faixasDeEnvio(linhas).filter(f => f.bloqueio)).toEqual([{ from: "2026-10-02", to: "2026-10-02", preco: 45000, minimo: 2, maximo: 27, bloqueio: "none" }]);
    // Já reaberto no Beds24 por alguém: nada a enviar e a posse acaba.
    const [reaberto] = planejarCalendario(entrada({ fim: "2026-10-01", enviados: [enviado("2026-10-01")], observacoes: [obs("2026-10-01", { bloqueio: "none" })] }));
    expect(reaberto).toMatchObject({ bloqueioEnviar: undefined, posseBloqueioEncerrada: true, acao: "igual" });
    expect(reaberto.avisos).toContain("Bloqueio do SCL removido e já reaberto no Beds24: nada a enviar; o SCL deixa de considerar esse bloqueio como seu.");
  });
  it("restrição que já existia no Beds24 (noCheckIn etc.) é guardada ao bloquear e devolvida ao reabrir, em vez de \"none\"", () => {
    const enviadoEm = new Date("2026-09-30T10:00:00Z");
    const bloqueio = [{ inicio: "2026-10-01", fim: "2026-10-02", fonte: "manual" }];
    const enviado = (over: Partial<EntradaPlano["enviados"][number]> = {}) => ({ data: "2026-10-01", preco: 40000, minimo: 1, maximo: 27, bloqueio: "blackout", confirmado: true, enviadoEm, ...over });
    // Bloqueio novo sobre noite com noCheckIn: envia blackout e guarda a restrição anterior.
    const [novo] = planejarCalendario(entrada({ fim: "2026-10-01", bloqueios: bloqueio, observacoes: [obs("2026-10-01", { bloqueio: "noCheckIn" })] }));
    expect([novo.bloqueioEnviar, novo.bloqueioAnterior]).toEqual(["blackout", "noCheckIn"]);
    expect(novo.regra).toContain('bloqueio do SCL (antes: "noCheckIn")');
    // Blackout já do SCL reenviado (ex.: preço mudou): mantém a restrição guardada, não a leitura (blackout).
    const [mantido] = planejarCalendario(entrada({ fim: "2026-10-01", bloqueios: bloqueio, enviados: [enviado({ bloqueioAnterior: "noCheckOut" })], observacoes: [obs("2026-10-01", { preco: 40000, livres: 0, bloqueio: "blackout" })] }));
    expect([mantido.bloqueioEnviar, mantido.bloqueioAnterior, mantido.acao]).toEqual(["blackout", "noCheckOut", "enviar"]);
    // Sem leitura nova, vale o último envio confirmado (uma restrição devolvida antes); sem nada, null.
    const [doEnvio] = planejarCalendario(entrada({ fim: "2026-10-01", bloqueios: bloqueio, enviados: [enviado({ bloqueio: "noCheckInOrCheckOut" })] }));
    expect(doEnvio.bloqueioAnterior).toBe("noCheckInOrCheckOut");
    expect(planejarCalendario(entrada({ fim: "2026-10-01", bloqueios: bloqueio }))[0].bloqueioAnterior).toBeNull();
    // Reabertura: devolve a restrição guardada (vai no payload); sem registro, "none".
    const [devolve] = planejarCalendario(entrada({ fim: "2026-10-01", enviados: [enviado({ bloqueioAnterior: "noCheckIn" })], observacoes: [obs("2026-10-01", { livres: 0, bloqueio: "blackout" })] }));
    expect([devolve.bloqueioEnviar, devolve.bloqueioAnterior, devolve.acao]).toEqual(["noCheckIn", null, "enviar"]);
    expect(devolve.regra).toContain('reabre bloqueio do SCL e devolve "noCheckIn"');
    expect(faixasDeEnvio([devolve])[0].bloqueio).toBe("noCheckIn");
    const [semRegistro] = planejarCalendario(entrada({ fim: "2026-10-01", enviados: [enviado()], observacoes: [obs("2026-10-01", { livres: 0, bloqueio: "blackout" })] }));
    expect(semRegistro.bloqueioEnviar).toBe("none");
    // Registro de uma tentativa em aberto só é reaproveitado enquanto a leitura mostra blackout; leitura "none" zera.
    const emAberto = enviado({ bloqueio: null, bloqueioAnterior: "noCheckIn", confirmado: false });
    expect(planejarCalendario(entrada({ fim: "2026-10-01", bloqueios: bloqueio, enviados: [emAberto], observacoes: [obs("2026-10-01", { livres: 0, bloqueio: "blackout" })] }))[0].bloqueioAnterior).toBe("noCheckIn");
    expect(planejarCalendario(entrada({ fim: "2026-10-01", bloqueios: bloqueio, enviados: [emAberto] }))[0].bloqueioAnterior).toBe("noCheckIn");
    expect(planejarCalendario(entrada({ fim: "2026-10-01", bloqueios: bloqueio, enviados: [emAberto], observacoes: [obs("2026-10-01", { bloqueio: "none" })] }))[0].bloqueioAnterior).toBeNull();
    // Restrição devolvida que a leitura nova já mostra: posse encerrada sem alarme de "troca externa".
    const [devolvida] = planejarCalendario(entrada({ fim: "2026-10-01", enviados: [enviado({ bloqueioAnterior: "noCheckIn" })], observacoes: [obs("2026-10-01", { bloqueio: "noCheckIn" })] }));
    expect([devolvida.bloqueioEnviar, devolvida.posseBloqueioEncerrada]).toEqual([undefined, true]);
    expect(devolvida.avisos).toContain('Bloqueio do SCL removido e a restrição anterior ("noCheckIn") já está de volta no Beds24: nada a enviar.');
  });

  it("igual quando a observação (mais recente que o último envio) já tem os valores; senão vale o envio confirmado", () => {
    const quando = new Date("2026-10-01T08:00:00Z");
    const enviadoIgual = { data: "2026-10-05", preco: 45000, minimo: 1, maximo: 27, bloqueio: null, confirmado: true, enviadoEm: quando };
    const linhas = planejarCalendario(entrada({
      observacoes: [obs("2026-10-01"), obs("2026-10-02"), obs("2026-10-03", { minimoNoites: 2 }), obs("2026-10-04", { maximoNoites: null }), obs("2026-10-06", { observadoEm: new Date("2026-09-30T00:00:00Z") })],
      enviados: [enviadoIgual, { ...enviadoIgual, data: "2026-10-06" }, { ...enviadoIgual, data: "2026-10-07", confirmado: false }, { ...enviadoIgual, data: "2026-10-08", preco: 1 }],
    }));
    expect(linhas.map((l) => l.acao)).toEqual(["igual", "enviar", "igual", "enviar", "igual", "igual", "enviar", "enviar", "enviar", "enviar"]);
    expect(porData(linhas, "2026-10-02").avisos).not.toContain("Beds24 difere do último envio confirmado pelo SCL: o SCL reenvia o valor oficial.");
    const mudado = planejarCalendario(entrada({ observacoes: [obs("2026-10-05", { preco: 50000, observadoEm: new Date("2026-10-01T09:00:00Z") })], enviados: [enviadoIgual] }));
    expect(porData(mudado, "2026-10-05")).toMatchObject({ acao: "enviar" });
    expect(porData(mudado, "2026-10-05").avisos).toContain("Beds24 difere do último envio confirmado pelo SCL: o SCL reenvia o valor oficial.");
  });
  it("avisos de ocupação contraditória e de leitura ausente, como na prévia", () => {
    const linhas = planejarCalendario(entrada({ reservas: [{ checkin: "2026-10-01", checkout: "2026-10-02", estado: "confirmada" }, { checkin: "2026-10-01", checkout: "2026-10-02", estado: "pedido" }], bloqueios: [{ inicio: "2026-10-01", fim: "2026-10-02", fonte: "manual" }], observacoes: [obs("2026-10-01")] }));
    expect(linhas[0].avisos).toEqual(expect.arrayContaining(["Mais de uma reserva ocupa esta noite.", "Reserva e bloqueio se sobrepõem nesta noite.", "Beds24 informou unidades livres, mas há reserva ou bloqueio no SCL: conferir."]));
    expect(linhas[1].avisos).toContain("Sem leitura do Beds24 para esta noite.");
  });
});

describe("faixas de envio e resumo", () => {
  it("agrupa noites consecutivas com a mesma carga e pula as iguais; preço ausente não vai", () => {
    const linhas = planejarCalendario(entrada({
      imovel: imovel({ periodos: [{ nome: "Sem preço", inicio: "2026-10-09", fim: "2026-10-09", precoNoite: null, estadiaMinima: 7 }] }),
      observacoes: [obs("2026-10-04"), obs("2026-10-05")],
      bloqueios: [{ inicio: "2026-10-06", fim: "2026-10-07", fonte: "manual" }],
    }));
    expect(faixasDeEnvio(linhas)).toEqual([
      { from: "2026-10-01", to: "2026-10-01", preco: 45000, minimo: 1, maximo: 27 },
      { from: "2026-10-02", to: "2026-10-03", preco: 45000, minimo: 2, maximo: 27 },
      { from: "2026-10-06", to: "2026-10-06", preco: 45000, minimo: 1, maximo: 27, bloqueio: "blackout" },
      { from: "2026-10-07", to: "2026-10-08", preco: 45000, minimo: 1, maximo: 27 },
      { from: "2026-10-09", to: "2026-10-09", preco: 45000, minimo: 7, maximo: 27 },
      { from: "2026-10-10", to: "2026-10-10", preco: 45000, minimo: 2, maximo: 27 },
    ]);
    expect(resumirPlano(linhas)).toEqual({ noites: 10, enviar: 8, iguais: 2, semDados: 0, ocupadas: 1, comAvisos: 8 });
    const semPreco = planejarCalendario(entrada({ imovel: imovel({}, { precoBase: null }), fim: "2026-10-02" }));
    expect(faixasDeEnvio(semPreco)).toEqual([{ from: "2026-10-01", to: "2026-10-01", minimo: 1, maximo: 27 }, { from: "2026-10-02", to: "2026-10-02", minimo: 2, maximo: 27 }]);
  });
});

describe("fonte de preços por imóvel (M3.9)", () => {
  const evento = { id: "e", nome: "Evento", inicio: "2026-10-03", fim: "2026-10-03", multiplicador: 300, estadiaMinima: null, minimoNormalComReserva: true, todosImoveis: true, imoveis: [] };
  it("beds24: o SCL não envia preço; o preço esperado é o lido do Beds24; sem leitura a noite fica sem preço e com aviso; mínimos continuam do SCL", () => {
    const linhas = planejarCalendario(entrada({ imovel: imovel({ fontePrecos: "beds24" }), regras: regras({ eventos: [evento] }), observacoes: [obs("2026-10-02", { preco: 52000 }), obs("2026-10-03", { preco: 61000 })] }));
    const l2 = porData(linhas, "2026-10-02");
    expect(l2).toMatchObject({ fontePreco: "beds24", precoReferencia: null, precoEnviar: null, precoFinalEsperado: 52000, percentualUltimaHora: 0, minimoEnviar: 2 });
    expect(l2.motivoPreco).toContain("definido no Beds24");
    expect(l2.avisos).not.toContainEqual(expect.stringContaining("Preço não cadastrado"));
    // Evento do SCL não mexe no preço de quem define preço no Beds24.
    expect(porData(linhas, "2026-10-03").precoFinalEsperado).toBe(61000);
    const l4 = porData(linhas, "2026-10-04");
    expect(l4).toMatchObject({ precoEnviar: null, precoFinalEsperado: null });
    expect(l4.avisos).toContainEqual(expect.stringContaining("Sem preço lido do Beds24"));
    // Nunca sai preço na carga; mínimo e máximo continuam indo.
    expect(linhas.every((l) => l.precoEnviar === null)).toBe(true);
    expect(faixasDeEnvio(linhas).every((f) => f.preco === undefined && f.maximo === 27)).toBe(true);
  });
  it("manual: vale o cadastro como está — sem evento, feriadão e última hora; período explícito continua valendo", () => {
    const linhas = planejarCalendario(entrada({
      imovel: imovel({ fontePrecos: "manual", periodos: [{ nome: "Especial", inicio: "2026-10-05", fim: "2026-10-05", precoNoite: 80000, estadiaMinima: null }] }),
      regras: regras({ eventos: [evento], feriados: [{ data: "2026-10-08", nome: "Quinta" }] }),
    }));
    // D0 com última hora ligada no padrão: na fonte manual não se aplica.
    expect(porData(linhas, "2026-10-01")).toMatchObject({ precoEnviar: 45000, precoFinalEsperado: 45000, percentualUltimaHora: 0 });
    expect(porData(linhas, "2026-10-01").motivoPreco).toContain("preços digitados");
    expect(porData(linhas, "2026-10-03")).toMatchObject({ fontePreco: "base", precoEnviar: 45000 }); // evento 3× ignorado
    expect(porData(linhas, "2026-10-08")).toMatchObject({ fontePreco: "base", precoEnviar: 45000 }); // feriadão ignorado no preço
    expect(porData(linhas, "2026-10-05")).toMatchObject({ fontePreco: "periodo", precoEnviar: 80000 });
    // O mesmo cadastro com fonte SCL aplica o evento e a última hora.
    const scl = planejarCalendario(entrada({ regras: regras({ eventos: [evento] }) }));
    expect(porData(scl, "2026-10-03").precoEnviar).toBe(135000);
    expect(porData(scl, "2026-10-01").percentualUltimaHora).toBeGreaterThan(0);
  });
  it("manual: os limites mínimo/máximo do preço dinâmico também não se aplicam — vai o valor digitado; na fonte SCL o piso vale", () => {
    const limites = { precoBase: 30000, precoDinamico: true, precoMinimo: 40000, precoMaximo: 60000 };
    const manual = planejarCalendario(entrada({ imovel: imovel({ fontePrecos: "manual" }, limites), regras: regras({ ultimaHora: { ...REGRAS_CALENDARIO_PADRAO.ultimaHora, aplicadoPor: "desligada" } }) }));
    expect(porData(manual, "2026-10-06")).toMatchObject({ fontePreco: "base", precoReferencia: 30000, precoEnviar: 30000, precoFinalEsperado: 30000 });
    expect(porData(manual, "2026-10-06").motivoPreco).not.toContain("limitado ao piso");
    const scl = planejarCalendario(entrada({ imovel: imovel({}, limites), regras: regras({ ultimaHora: { ...REGRAS_CALENDARIO_PADRAO.ultimaHora, aplicadoPor: "desligada" } }) }));
    expect(porData(scl, "2026-10-06")).toMatchObject({ precoEnviar: 40000, motivoPreco: "Preço base (limitado ao piso/teto)" });
  });
});

