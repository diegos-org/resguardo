import { describe, expect, it } from "vitest";
import { diaCurto as diaCurtoDaAgenda } from "@/agenda/agenda";
import { instanteLocal as instanteDoPortal, somarDias as somarDoPortal } from "@/hospede/portal";
import { DIAS_SEMANA as diasDasRegras, diaDaSemana as diaDasRegras } from "@/imoveis/regras-venda";
import { NOMES_DIA_SEMANA as nomesDoRepasse } from "@/repasses/periodicidade";
import { DIAS_DA_SEMANA_CURTOS as curtosDoSite, DIAS_SEMANA as diasDoSite } from "@/site/calendario";
import {
  dataBr,
  dataHoraNoFuso,
  dataNoFuso,
  diaCurto,
  diaDaSemana,
  diaDaSemanaEData,
  diaHoraNoFuso,
  diaMesBr,
  diaMesNoFuso,
  DIAS_DA_SEMANA_CURTOS,
  DIAS_NA_ORDEM,
  DIAS_SEMANA,
  escreverHora,
  fimDeSemana,
  FUSO_PADRAO,
  HORA_VALIDA,
  horaNoFuso,
  INTERVALO_DA_SEMANA,
  hojeISO,
  instanteLocal,
  LETRAS_DA_SEMANA,
  lerHora,
  NOMES_DIA_SEMANA,
  PADRAO_DO_CAMPO_HORA,
  posicaoNaSemana,
  PRIMEIRO_DIA_DA_SEMANA,
  rotuloDoFuso,
  somarDias,
} from "./datas";

describe("datas no fuso do imóvel", () => {
  it("somarDias anda pelo calendário (mês, ano e ano bissexto)", () => {
    expect(somarDias("2026-10-30", 3)).toBe("2026-11-02");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(somarDias("2026-10-10", 0)).toBe("2026-10-10");
  });

  it("instanteLocal: a hora do dia no fuso (São Paulo é UTC−3; outro fuso, outro instante)", () => {
    expect(instanteLocal("2026-10-10", "15:00", "America/Sao_Paulo").toISOString()).toBe("2026-10-10T18:00:00.000Z");
    expect(instanteLocal("2026-10-10", "00:00", "America/Sao_Paulo").toISOString()).toBe("2026-10-10T03:00:00.000Z");
    expect(instanteLocal("2026-10-10", "23:59", "America/Sao_Paulo").toISOString()).toBe("2026-10-11T02:59:00.000Z");
    expect(instanteLocal("2026-07-10", "15:00", "Europe/Lisbon").toISOString()).toBe("2026-07-10T14:00:00.000Z");
    // O mesmo instante é de dias diferentes em UTC e em São Paulo.
    const tarde = instanteLocal("2026-10-16", "23:30", "America/Sao_Paulo");
    expect(hojeISO("America/Sao_Paulo", tarde)).toBe("2026-10-16");
    expect(hojeISO("UTC", tarde)).toBe("2026-10-17");
  });

  it("o portal do hóspede continua exportando as mesmas funções (uma regra, um lugar)", () => {
    expect(instanteDoPortal).toBe(instanteLocal);
    expect(somarDoPortal).toBe(somarDias);
  });

  it("escreverHora (casa, cotação e Minha reserva; Diego, 16/10/2026): sempre HH:MM com dois dígitos, nunca '15h'", () => {
    expect(escreverHora("15:00")).toBe("15:00");
    expect(escreverHora("11:00")).toBe("11:00");
    expect(escreverHora("09:00")).toBe("09:00");
    expect(escreverHora("9:00")).toBe("09:00");
    expect(escreverHora("10:00")).toBe("10:00");
    expect(escreverHora("00:00")).toBe("00:00");
    expect(escreverHora("15:30")).toBe("15:30");
    expect(escreverHora("09:30")).toBe("09:30");
    // O formato antigo (M7.20) também sai no novo.
    expect(escreverHora("15h")).toBe("15:00");
    expect(escreverHora("15h30")).toBe("15:30");
    // O que não é hora sai como está, sem palpite.
    expect(escreverHora("a combinar")).toBe("a combinar");
  });

  it("lerHora: aceita '15:00', '9:00', '15h', '15h30' e '9h05' e devolve HH:MM; o resto é null, sem adivinhar", () => {
    const validas: [string, string][] = [
      ["15:00", "15:00"],
      ["9:00", "09:00"],
      ["09:05", "09:05"],
      ["00:00", "00:00"],
      ["23:59", "23:59"],
      ["15h", "15:00"],
      ["15H", "15:00"],
      ["15h30", "15:30"],
      ["9h05", "09:05"],
      ["0h", "00:00"],
      [" 15:00 ", "15:00"],
    ];
    for (const [t, h] of validas) expect(lerHora(t), t).toBe(h);
    for (const t of ["25:00", "24:00", "15:60", "15:7", "15h7", "15", "1500", "", "  ", "texto", "15:00h", "15 h", "3 da tarde", "-1:00", "115:00"]) expect(lerHora(t), t).toBeNull();
  });

  it("HORA_VALIDA é o formato guardado (dois dígitos); o pattern do campo aceita o que lerHora lê com dois-pontos", () => {
    for (const h of ["00:00", "09:05", "15:00", "23:59"]) expect(HORA_VALIDA.test(h), h).toBe(true);
    for (const h of ["9:00", "24:00", "15:60", "15h", "15:00 "]) expect(HORA_VALIDA.test(h), h).toBe(false);
    // O navegador ancora o pattern no começo e no fim.
    const campo = new RegExp(`^(?:${PADRAO_DO_CAMPO_HORA})$`);
    for (const h of ["9:00", "09:00", "15:30", "23:59", "0:00"]) {
      expect(campo.test(h), h).toBe(true);
      expect(HORA_VALIDA.test(lerHora(h)!), h).toBe(true);
    }
    for (const h of ["24:00", "15:60", "15h", "15", "1:5"]) expect(campo.test(h), h).toBe(false);
  });

  it("horaNoFuso: HH:MM em 24 horas no fuso (padrão: São Paulo), meia-noite como 00:05, nunca AM/PM", () => {
    expect(FUSO_PADRAO).toBe("America/Sao_Paulo");
    expect(horaNoFuso(new Date("2026-10-17T01:30:00Z"))).toBe("22:30");
    expect(horaNoFuso(new Date("2026-10-17T01:30:00Z"), "America/Sao_Paulo")).toBe("22:30");
    expect(horaNoFuso(new Date("2026-10-17T03:05:00Z"))).toBe("00:05");
    expect(horaNoFuso(new Date("2026-07-10T23:05:00Z"), "Europe/Lisbon")).toBe("00:05");
    expect(horaNoFuso(new Date("2026-07-10T14:00:00Z"), "Europe/Lisbon")).toBe("15:00");
    for (let h = 0; h < 24; h++) {
      const saida = horaNoFuso(new Date(Date.UTC(2026, 9, 16, h, 7)));
      expect(saida, saida).toMatch(HORA_VALIDA);
      expect(saida).not.toMatch(/AM|PM/i);
    }
  });

  it("dataBr e diaMesBr: a data guardada em dd/mm/aaaa e dd/mm, sem fuso; o que não é data sai como está", () => {
    expect(dataBr("2026-10-16")).toBe("16/10/2026");
    expect(dataBr("2026-03-05")).toBe("05/03/2026");
    expect(diaMesBr("2026-10-16")).toBe("16/10");
    expect(diaMesBr("2026-03-05")).toBe("05/03");
    for (const t of ["", "a combinar", "16/10/2026"]) {
      expect(dataBr(t), t).toBe(t);
      expect(diaMesBr(t), t).toBe(t);
    }
  });

  it("dataNoFuso, dataHoraNoFuso e diaHoraNoFuso: o dia e a hora do instante em São Paulo (sem ISO, UTC nem segundos)", () => {
    const noite = new Date("2026-10-17T01:30:00Z"); // 16/10 às 22:30 em São Paulo; 17/10 em UTC.
    expect(dataNoFuso(noite)).toBe("16/10/2026");
    expect(dataHoraNoFuso(noite)).toBe("16/10/2026 às 22:30");
    expect(dataHoraNoFuso(noite, "America/Sao_Paulo")).toBe("16/10/2026 às 22:30");
    expect(diaHoraNoFuso(noite)).toBe("16/10 às 22:30");
    // Meia-noite e cinco é "00:05", do dia certo.
    expect(dataHoraNoFuso(new Date("2026-10-17T03:05:00Z"))).toBe("17/10/2026 às 00:05");
    expect(diaHoraNoFuso(new Date("2026-03-05T12:07:45Z"))).toBe("05/03 às 09:07");
    // Outro fuso, outro dia e outra hora para o mesmo instante.
    expect(dataHoraNoFuso(new Date("2026-07-10T23:05:00Z"), "Europe/Lisbon")).toBe("11/07/2026 às 00:05");
    expect(diaHoraNoFuso(new Date("2026-07-10T23:05:00Z"), "Europe/Lisbon")).toBe("11/07 às 00:05");
    expect(dataNoFuso(noite, "UTC")).toBe("17/10/2026");
    expect(diaMesNoFuso(noite)).toBe("16/10");
    expect(diaMesNoFuso(noite, "UTC")).toBe("17/10");
    // A virada do ano é a de São Paulo (o rodapé "©" usa o ano daqui).
    expect(hojeISO(FUSO_PADRAO, new Date("2027-01-01T02:00:00Z")).startsWith("2026")).toBe(true);
    for (let h = 0; h < 24; h++) {
      const d = new Date(Date.UTC(2026, 9, 16, h, 7, 59));
      for (const saida of [dataHoraNoFuso(d), diaHoraNoFuso(d)]) {
        expect(saida, saida).toMatch(/^\d{2}\/\d{2}(\/\d{4})? às ([01]\d|2[0-3]):[0-5]\d$/);
        expect(saida).not.toMatch(/AM|PM|:\d{2}:\d{2}|,|T\d|Z/);
      }
    }
  });

  it("rotuloDoFuso: horário de Brasília no padrão, horário do local do imóvel nos outros", () => {
    expect(rotuloDoFuso("America/Sao_Paulo")).toBe("horário de Brasília");
    expect(rotuloDoFuso(FUSO_PADRAO)).toBe("horário de Brasília");
    expect(rotuloDoFuso("Europe/Lisbon")).toBe("horário do local do imóvel");
  });
});

describe("a semana começando na segunda (Diego, 16/10/2026)", () => {
  it("diaDaSemana é o número guardado, 0 = domingo … 6 = sábado, sem fuso", () => {
    // 11/10/2026 é domingo; a semana de 11 a 17 percorre os sete números.
    expect(Array.from({ length: 7 }, (_, i) => diaDaSemana(somarDias("2026-10-11", i)))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(diaDaSemana("2026-10-16")).toBe(5);
    expect(diaDaSemana("2028-02-29")).toBe(2);
    expect(diaDaSemana("2026-12-31")).toBe(4);
  });

  it("a ordem mostrada vai de segunda a domingo, com os mesmos números guardados", () => {
    expect(PRIMEIRO_DIA_DA_SEMANA).toBe(1);
    expect(DIAS_NA_ORDEM).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(DIAS_NA_ORDEM.map((n) => DIAS_SEMANA[n])).toEqual(["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]);
    expect(DIAS_NA_ORDEM.map((n) => DIAS_DA_SEMANA_CURTOS[n]).join(" ")).toBe("seg ter qua qui sex sáb dom");
    expect(DIAS_NA_ORDEM.map((n) => LETRAS_DA_SEMANA[n]).join("")).toBe("STQQSSD");
    // O rótulo ao lado de uma lista por dia sai da mesma ordem (a prévia do calendário: "mínimo 1/1/1/1/2/2/1 (seg a dom)").
    expect(INTERVALO_DA_SEMANA).toBe("seg a dom");
    expect(NOMES_DIA_SEMANA[1]).toBe("segunda-feira");
    expect(NOMES_DIA_SEMANA[0]).toBe("domingo");
    // A posição na semana: 0 na segunda (12/10/2026) … 6 no domingo (18/10/2026).
    expect(Array.from({ length: 7 }, (_, i) => posicaoNaSemana(somarDias("2026-10-12", i)))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(posicaoNaSemana("2026-10-11")).toBe(6);
  });

  it("fim de semana, rótulo curto e dia com a data, sem Intl", () => {
    expect(["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"].map(fimDeSemana)).toEqual([false, true, true, false]);
    expect(diaCurto("2026-10-16")).toBe("sex 16/10");
    expect(diaCurto("2026-03-05")).toBe("qui 05/03");
    expect(diaDaSemanaEData("2026-10-16")).toBe("sex, 16/10/2026");
    expect(diaDaSemanaEData("2026-11-09")).toBe("seg, 09/11/2026");
    expect(diaDaSemanaEData("2026-10-17")).not.toContain(".");
  });

  it("os módulos que mostram dias reexportam os mesmos objetos de lib/datas.ts (uma regra, um lugar)", () => {
    expect(diaDasRegras).toBe(diaDaSemana);
    expect(diasDasRegras).toBe(DIAS_SEMANA);
    expect(diasDoSite).toBe(DIAS_SEMANA);
    expect(curtosDoSite).toBe(DIAS_DA_SEMANA_CURTOS);
    expect(nomesDoRepasse).toBe(NOMES_DIA_SEMANA);
    expect(diaCurtoDaAgenda).toBe(diaCurto);
  });
});
