import { describe, expect, it } from "vitest";
import {
  cruzaOcupada,
  dataCurta,
  dataISOValida,
  dataPorExtenso,
  DIAS_DA_SEMANA_CURTOS,
  escolherDia,
  inicioDoMes,
  limiteDoCalendario,
  mesesEntre,
  nomeDoMes,
  RECUSAS,
  rotuloDoDia,
  semanasDoMes,
  situacaoDoDia,
  somarMeses,
  ultimaSaidaPossivel,
} from "./calendario";

const hoje = "2026-10-07";
const ocupadas = new Set(["2026-10-14", "2026-10-15"]);
const c = { hoje, ocupadas };
const vazio = { entrada: "", saida: "" };

describe("calendário do site: datas (M7.6)", () => {
  it("datas ISO de calendário, sem fuso: validação, meses e nomes em português", () => {
    expect(dataISOValida("2026-10-12")).toBe(true);
    expect(dataISOValida("2026-02-29")).toBe(false);
    expect(dataISOValida("2028-02-29")).toBe(true);
    expect(dataISOValida("2026-10-1")).toBe(false);
    expect(dataISOValida("12/10/2026")).toBe(false);
    expect(inicioDoMes("2026-10-31")).toBe("2026-10-01");
    expect(somarMeses("2026-10-31", 1)).toBe("2026-11-01");
    expect(somarMeses("2026-12-15", 1)).toBe("2027-01-01");
    expect(somarMeses("2026-01-15", -1)).toBe("2025-12-01");
    expect(somarMeses("2026-10-01", 18)).toBe("2028-04-01");
    expect(mesesEntre("2026-11-20", "2027-01-03")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
    expect(mesesEntre("2027-01-03", "2026-11-20")).toEqual([]);
    expect(nomeDoMes("2026-10-12")).toBe("outubro de 2026");
    expect(nomeDoMes("2027-03-01")).toBe("março de 2027");
    expect(dataCurta("2026-10-12")).toBe("12/10/2026");
    expect(dataPorExtenso("2026-10-02")).toBe("2 de outubro de 2026");
    expect(DIAS_DA_SEMANA_CURTOS.join(" ")).toBe("dom seg ter qua qui sex sáb");
    // O calendário vai até o fim do 18º mês contado a partir do mês de hoje.
    expect(limiteDoCalendario("2026-10-07")).toBe("2028-04-01");
  });

  it("grade do mês com a semana começando no domingo e dias de outro mês vazios", () => {
    // 1/10/2026 é quinta: quatro casas vazias antes; 31/10 é sábado e fecha a última semana.
    const outubro = semanasDoMes("2026-10-20");
    expect(outubro).toHaveLength(5);
    expect(outubro[0]).toEqual([null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(outubro[4]).toEqual(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
    // Fevereiro de 2026 começa num domingo e cabe em quatro semanas; novembro de 2026 completa a última com vazios.
    expect(semanasDoMes("2026-02-01")).toHaveLength(4);
    expect(semanasDoMes("2026-02-01")[0][0]).toBe("2026-02-01");
    expect(semanasDoMes("2026-11-01").at(-1)).toEqual(["2026-11-29", "2026-11-30", null, null, null, null, null]);
    expect(semanasDoMes("2028-02-01").flat().filter(Boolean)).toHaveLength(29);
  });
});

describe("calendário do site: escolha da entrada e da saída (M7.6)", () => {
  it("primeiro clique é a entrada, o segundo depois dela é a saída", () => {
    const a = escolherDia(vazio, "2026-10-09", "entrada", c);
    expect(a).toEqual({ datas: { entrada: "2026-10-09", saida: "" }, etapa: "saida", recusa: null });
    const b = escolherDia(a.datas, "2026-10-12", "saida", c);
    expect(b).toEqual({ datas: { entrada: "2026-10-09", saida: "2026-10-12" }, etapa: "pronta", recusa: null });
  });

  it("clique antes da entrada (ou nela) recomeça a escolha por esse dia", () => {
    const sel = { entrada: "2026-10-09", saida: "" };
    expect(escolherDia(sel, "2026-10-08", "saida", c)).toEqual({ datas: { entrada: "2026-10-08", saida: "" }, etapa: "saida", recusa: null });
    expect(escolherDia(sel, "2026-10-09", "saida", c)).toEqual({ datas: { entrada: "2026-10-09", saida: "" }, etapa: "saida", recusa: null });
  });

  it("escolhendo a entrada com a estadia completa, a saída anterior é descartada", () => {
    const sel = { entrada: "2026-10-09", saida: "2026-10-12" };
    expect(escolherDia(sel, "2026-10-20", "entrada", c)).toEqual({ datas: { entrada: "2026-10-20", saida: "" }, etapa: "saida", recusa: null });
    // Aberto pela saída, um dia depois da entrada troca só a saída.
    expect(escolherDia(sel, "2026-10-13", "saida", c)).toEqual({ datas: { entrada: "2026-10-09", saida: "2026-10-13" }, etapa: "pronta", recusa: null });
    // Etapa "saída" sem entrada vale como entrada.
    expect(escolherDia(vazio, "2026-10-20", "saida", c).datas).toEqual({ entrada: "2026-10-20", saida: "" });
  });

  it("entrada não pode ser antes de hoje nem numa noite ocupada", () => {
    expect(escolherDia(vazio, "2026-10-06", "entrada", c)).toEqual({ datas: vazio, etapa: "entrada", recusa: RECUSAS.passada });
    expect(escolherDia(vazio, "2026-10-07", "entrada", c).recusa).toBeNull();
    expect(escolherDia(vazio, "2026-10-14", "entrada", c)).toEqual({ datas: vazio, etapa: "entrada", recusa: "Essa noite já está ocupada." });
    // Recomeçar (clique antes da entrada) numa noite ocupada também é recusado, mantendo a escolha.
    const sel = { entrada: "2026-10-16", saida: "" };
    expect(escolherDia(sel, "2026-10-15", "saida", c)).toEqual({ datas: sel, etapa: "saida", recusa: RECUSAS.ocupada });
  });

  it("estadia não pode incluir noite ocupada; o dia de saída pode ser uma noite ocupada (saída de manhã)", () => {
    const sel = { entrada: "2026-10-10", saida: "" };
    expect(escolherDia(sel, "2026-10-14", "saida", c)).toEqual({ datas: { entrada: "2026-10-10", saida: "2026-10-14" }, etapa: "pronta", recusa: null });
    expect(escolherDia(sel, "2026-10-15", "saida", c)).toEqual({ datas: sel, etapa: "saida", recusa: "Há noites ocupadas nesse intervalo." });
    expect(escolherDia(sel, "2026-10-20", "saida", c).recusa).toBe(RECUSAS.cruza);
    // A recusa mantém a saída já escolhida.
    const completa = { entrada: "2026-10-10", saida: "2026-10-12" };
    expect(escolherDia(completa, "2026-10-18", "saida", c).datas).toEqual(completa);
    // Depois das noites ocupadas, uma nova entrada é livre.
    expect(escolherDia(vazio, "2026-10-16", "entrada", c).recusa).toBeNull();
    expect(cruzaOcupada("2026-10-10", "2026-10-14", ocupadas)).toBe(false);
    expect(cruzaOcupada("2026-10-10", "2026-10-15", ocupadas)).toBe(true);
    expect(ultimaSaidaPossivel("2026-10-10", ocupadas)).toBe("2026-10-14");
    expect(ultimaSaidaPossivel("2026-10-16", ocupadas)).toBeNull();
  });

  it("sem noites conhecidas (lugar não escolhido ou leitura incerta), nada é recusado além do passado", () => {
    const livre = { hoje, ocupadas: new Set<string>() };
    expect(escolherDia({ entrada: "2026-10-10", saida: "" }, "2026-12-20", "saida", livre).etapa).toBe("pronta");
  });
});

describe("calendário do site: como cada dia aparece (M7.6)", () => {
  it("passado, ocupada, disponível e rótulos para leitores de tela", () => {
    const passado = situacaoDoDia("2026-10-06", vazio, "entrada", c);
    expect(passado).toMatchObject({ passada: true, disponivel: false });
    expect(rotuloDoDia("2026-10-06", passado)).toBe("6 de outubro de 2026, já passou");
    const ocupada = situacaoDoDia("2026-10-14", vazio, "entrada", c);
    expect(ocupada).toMatchObject({ ocupada: true, soSaida: false, disponivel: false });
    expect(rotuloDoDia("2026-10-14", ocupada)).toBe("14 de outubro de 2026, ocupada");
    const hojeS = situacaoDoDia(hoje, vazio, "entrada", c);
    expect(hojeS).toMatchObject({ hoje: true, disponivel: true });
    expect(rotuloDoDia(hoje, hojeS)).toBe("7 de outubro de 2026, hoje");
  });

  it("escolhendo a saída: a primeira noite ocupada serve de saída; depois dela, indisponível; dias antes da entrada recomeçam", () => {
    const sel = { entrada: "2026-10-10", saida: "" };
    const saidaOcupada = situacaoDoDia("2026-10-14", sel, "saida", c);
    expect(saidaOcupada).toMatchObject({ ocupada: true, soSaida: true, disponivel: true });
    expect(rotuloDoDia("2026-10-14", saidaOcupada)).toBe("14 de outubro de 2026, ocupada, pode ser o dia de saída");
    expect(situacaoDoDia("2026-10-15", sel, "saida", c)).toMatchObject({ ocupada: true, soSaida: false, disponivel: false });
    const depois = situacaoDoDia("2026-10-20", sel, "saida", c);
    expect(depois).toMatchObject({ ocupada: false, disponivel: false });
    expect(rotuloDoDia("2026-10-20", depois)).toBe("20 de outubro de 2026, indisponível, há noites ocupadas no caminho");
    expect(situacaoDoDia("2026-10-08", sel, "saida", c)).toMatchObject({ disponivel: true });
    // Escolhendo a entrada de novo, a noite ocupada volta a ser só ocupada.
    expect(situacaoDoDia("2026-10-14", sel, "entrada", c)).toMatchObject({ soSaida: false, disponivel: false });
  });

  it("intervalo escolhido e prévia até o dia sob o ponteiro, só quando a saída seria aceita", () => {
    const completa = { entrada: "2026-10-09", saida: "2026-10-12" };
    expect(situacaoDoDia("2026-10-09", completa, "entrada", c)).toMatchObject({ entrada: true, noIntervalo: false });
    expect(situacaoDoDia("2026-10-10", completa, "entrada", c)).toMatchObject({ noIntervalo: true });
    expect(situacaoDoDia("2026-10-12", completa, "entrada", c)).toMatchObject({ saida: true, noIntervalo: false });
    expect(rotuloDoDia("2026-10-12", situacaoDoDia("2026-10-12", completa, "entrada", c))).toBe("12 de outubro de 2026, saída");
    const sel = { entrada: "2026-10-09", saida: "" };
    expect(situacaoDoDia("2026-10-11", sel, "saida", c, "2026-10-13")).toMatchObject({ noIntervalo: true });
    expect(situacaoDoDia("2026-10-13", sel, "saida", c, "2026-10-13")).toMatchObject({ noIntervalo: false });
    // Prévia além da noite ocupada não pinta o intervalo.
    expect(situacaoDoDia("2026-10-11", sel, "saida", c, "2026-10-20")).toMatchObject({ noIntervalo: false });
    // Escolhendo a entrada, a prévia não conta.
    expect(situacaoDoDia("2026-10-11", sel, "entrada", c, "2026-10-13")).toMatchObject({ noIntervalo: false });
  });
});
