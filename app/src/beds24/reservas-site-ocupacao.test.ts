/**
 * Reserva paga do site no Beds24 (M8.3c, desenho 4.1 a 4.4; seção 10, teste 26, a parte pura): quem ocupa as noites antes de
 * criar ou de mudar as datas, as noites novas de uma atualização e o overbooking depois da escrita. Sem banco e sem rede.
 */
import { describe, expect, it } from "vitest";
import { classificarOcupantes, type EntradaDosOcupantes, noitesComOverbooking, noitesDe, noitesNovas, noitesSemLeitura } from "./reservas-site-ocupacao";
import type { DiaCalendario, ReservaBeds24 } from "./tipos";

const QUARTO = "20";
const ALVO = { quarto: QUARTO, chegada: "2026-12-20", saida: "2026-12-23" };
const NOITES = ["2026-12-20", "2026-12-21", "2026-12-22"];
const dia = (data: string, o: Partial<DiaCalendario> = {}): DiaCalendario => ({ roomId: QUARTO, data, livres: 1, preco: 50000, minimoNoites: 1, maximoNoites: null, bloqueio: null, ...o });
/** Uma reserva do quarto, normalizada (dados fictícios): por padrão, uma reserva de OTA nas mesmas noites. */
const reserva = (o: Partial<ReservaBeds24> = {}): ReservaBeds24 => ({
  idExterno: "555", propertyId: "10", roomId: QUARTO, estado: "confirmada", checkin: "2026-12-20", checkout: "2026-12-23", hospedes: 2,
  nome: "", email: "", telefone: "", valorBruto: null, comissaoCanal: null, canal: "airbnb", codigoCanal: "HMFICT", modificadoEm: null,
  referenciaScl: null, marcaFonte: null, marcaAmbigua: false, ensaio: false, ensaioOperacaoId: null, origemApi: null, ...o,
});
const entrada = (o: Partial<EntradaDosOcupantes> = {}): EntradaDosOcupantes => ({
  alvo: ALVO, noites: NOITES, reservas: [], dias: NOITES.map((n) => dia(n)), blackoutsDoScl: new Set(), bloqueiosDoBeds24NoScl: [], idProprio: null, comPostAnterior: false, ...o,
});

describe("as noites (desenho 4.2)", () => {
  it("as noites [chegada, saída); datas inválidas ou fora de ordem, nenhuma", () => {
    expect(noitesDe("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(noitesDe("2026-12-20", "2026-12-20")).toEqual([]);
    expect(noitesDe("2026-12-21", "2026-12-20")).toEqual([]);
    expect(noitesDe("20/12/2026", "2026-12-22")).toEqual([]);
  });

  it("as noites novas saem do registro relido no Beds24, nunca do esperado: as que entram e não estavam lá", () => {
    expect(noitesNovas({ chegada: "2026-12-20", saida: "2026-12-23" }, { chegada: "2026-12-20", saida: "2026-12-25" })).toEqual(["2026-12-23", "2026-12-24"]);
    expect(noitesNovas({ chegada: "2026-12-20", saida: "2026-12-23" }, { chegada: "2026-12-18", saida: "2026-12-24" })).toEqual(["2026-12-18", "2026-12-19", "2026-12-23"]);
    expect(noitesNovas({ chegada: "2026-12-20", saida: "2026-12-23" }, { chegada: "2026-12-21", saida: "2026-12-22" })).toEqual([]);
    // Depois de uma mudada_no_beds24 (a reserva tirada das noites A e posta em B no Beds24), o "Reenviar" confere A de novo.
    expect(noitesNovas({ chegada: "2027-01-10", saida: "2027-01-13" }, { chegada: "2026-12-20", saida: "2026-12-23" })).toEqual(NOITES);
    expect(noitesNovas(null, { chegada: "2026-12-20", saida: "2026-12-23" })).toEqual(NOITES);
  });
});

describe("quem ocupa as noites (desenho 4.1, na ordem)", () => {
  it("nada: livre; uma reserva de OTA: noites_ocupadas, com o id", () => {
    expect(classificarOcupantes(entrada())).toEqual({ resultado: "livre" });
    expect(classificarOcupantes(entrada({ reservas: [reserva()] }))).toEqual({ resultado: "noites_ocupadas", ids: ["555"] });
  });

  it("o black, o bloqueio do Beds24 no SCL e o blackout que o M3.7 não fechou: bloqueio_manual, com as noites achadas", () => {
    expect(classificarOcupantes(entrada({ reservas: [reserva({ estado: "bloqueio", checkin: "2026-12-21", checkout: "2026-12-22", canal: "outro" })] }))).toEqual({ resultado: "bloqueio_manual", bloqueio: { inicio: "2026-12-21", fim: "2026-12-22" } });
    expect(classificarOcupantes(entrada({ bloqueiosDoBeds24NoScl: [{ inicio: "2026-12-22", fim: "2026-12-30" }] }))).toEqual({ resultado: "bloqueio_manual", bloqueio: { inicio: "2026-12-22", fim: "2026-12-23" } });
    const blackout = entrada({ dias: [dia("2026-12-20", { bloqueio: "blackout", livres: 0 }), dia("2026-12-21", { bloqueio: "blackout", livres: 0 }), dia("2026-12-22")] });
    expect(classificarOcupantes(blackout)).toEqual({ resultado: "bloqueio_manual", bloqueio: { inicio: "2026-12-20", fim: "2026-12-22" } });
    // O bloqueio vem antes da reserva de OTA (a ordem da 4.1).
    expect(classificarOcupantes({ ...blackout, reservas: [reserva()] })).toMatchObject({ resultado: "bloqueio_manual" });
  });

  it("o blackout do próprio M3.7 (beds24_calendario_enviado): bloqueio_do_scl", () => {
    const e = entrada({ dias: [dia("2026-12-20"), dia("2026-12-21", { bloqueio: "blackout", livres: 0 }), dia("2026-12-22")], blackoutsDoScl: new Set(["2026-12-21"]) });
    expect(classificarOcupantes(e)).toEqual({ resultado: "bloqueio_do_scl", bloqueio: { inicio: "2026-12-21", fim: "2026-12-22" } });
    // A marca do M3.7 sem o blackout no calendário (ele já reabriu): não é bloqueio.
    expect(classificarOcupantes(entrada({ blackoutsDoScl: new Set(["2026-12-21"]) }))).toEqual({ resultado: "livre" });
  });

  it("livres nulo ou zero, sem ocupante: sem_disponibilidade; nunca livre sem saber", () => {
    expect(classificarOcupantes(entrada({ dias: [dia("2026-12-20"), dia("2026-12-21", { livres: null }), dia("2026-12-22")] }))).toEqual({ resultado: "sem_disponibilidade" });
    expect(classificarOcupantes(entrada({ dias: [dia("2026-12-20"), dia("2026-12-21", { livres: 0 }), dia("2026-12-22")] }))).toEqual({ resultado: "sem_disponibilidade" });
    expect(classificarOcupantes(entrada({ dias: [dia("2026-12-20"), dia("2026-12-21", { livres: -1 }), dia("2026-12-22")] }))).toEqual({ resultado: "sem_disponibilidade" });
  });

  it("a consulta (inquiry) e a cancelada não ocupam; a estadia em curso, sim; outro quarto e as noites de fora não contam", () => {
    expect(classificarOcupantes(entrada({ reservas: [reserva({ estado: "consulta" }), reserva({ idExterno: "556", estado: "cancelada" })] }))).toEqual({ resultado: "livre" });
    expect(classificarOcupantes(entrada({ reservas: [reserva({ checkin: "2026-12-15", checkout: "2026-12-21" })] }))).toEqual({ resultado: "noites_ocupadas", ids: ["555"] });
    expect(classificarOcupantes(entrada({ reservas: [reserva({ roomId: "21" }), reserva({ idExterno: "557", checkin: "2026-12-23", checkout: "2026-12-26" })] }))).toEqual({ resultado: "livre" });
    // O pedido (request) ocupa, como no Beds24.
    expect(classificarOcupantes(entrada({ reservas: [reserva({ estado: "pedido" })] }))).toEqual({ resultado: "noites_ocupadas", ids: ["555"] });
  });

  it("na atualização: a própria reserva não ocupa, e só as noites novas são conferidas", () => {
    const novas = noitesNovas({ chegada: "2026-12-20", saida: "2026-12-23" }, { chegada: "2026-12-20", saida: "2026-12-25" });
    const e = entrada({ alvo: { ...ALVO, saida: "2026-12-25" }, noites: novas, dias: novas.map((n) => dia(n)), idProprio: "98765", reservas: [reserva({ idExterno: "98765", canal: "outro", origemApi: "API" })] });
    expect(classificarOcupantes(e)).toEqual({ resultado: "livre" });
    // As noites novas vendidas no meio por uma OTA: conflito.
    expect(classificarOcupantes({ ...e, reservas: [...e.reservas, reserva({ idExterno: "777", checkin: "2026-12-24", checkout: "2026-12-26" })] })).toEqual({ resultado: "noites_ocupadas", ids: ["777"] });
  });
});

describe("o ocupante exato (desenho 3.8, item 5)", () => {
  const nosso = reserva({ idExterno: "98765", canal: "outro", codigoCanal: "", origemApi: "API" });

  it("só com um POST anterior desta reserva: o mesmo quarto e datas, confirmado, sem marca legível, com a origem do SCL", () => {
    expect(classificarOcupantes(entrada({ reservas: [nosso], comPostAnterior: true }))).toEqual({ resultado: "ocupante_exato", id: "98765" });
    expect(classificarOcupantes(entrada({ reservas: [reserva({ idExterno: "98765", canal: "direta", origemApi: null })], comPostAnterior: true }))).toEqual({ resultado: "ocupante_exato", id: "98765" });
    // Sem POST anterior, o mesmo registro é a reserva direta que a equipe criou à mão: noites_ocupadas.
    expect(classificarOcupantes(entrada({ reservas: [nosso] }))).toEqual({ resultado: "noites_ocupadas", ids: ["98765"] });
  });

  it("nunca: de canal nomeado, 'outro' sem a origem pela API, com marca legível, com outras datas, ou com mais um ocupante", () => {
    for (const r of [reserva({ idExterno: "98765" }), reserva({ idExterno: "98765", canal: "booking", origemApi: "API" }), reserva({ idExterno: "98765", canal: "outro", origemApi: null })]) {
      expect(classificarOcupantes(entrada({ reservas: [r], comPostAnterior: true }))).toEqual({ resultado: "noites_ocupadas", ids: ["98765"] });
    }
    expect(classificarOcupantes(entrada({ reservas: [{ ...nosso, referenciaScl: "SCL-ABCDEF", marcaFonte: "info" }], comPostAnterior: true }))).toMatchObject({ resultado: "noites_ocupadas" });
    expect(classificarOcupantes(entrada({ reservas: [{ ...nosso, checkout: "2026-12-24" }], comPostAnterior: true }))).toMatchObject({ resultado: "noites_ocupadas" });
    expect(classificarOcupantes(entrada({ reservas: [nosso, reserva({ idExterno: "777", checkin: "2026-12-22", checkout: "2026-12-24" })], comPostAnterior: true }))).toEqual({ resultado: "noites_ocupadas", ids: ["777", "98765"] });
    // O ensaio que não foi cancelado, criado pela API nas mesmas datas: tem marca (a dele), nunca é o candidato do "Vincular".
    expect(classificarOcupantes(entrada({ reservas: [reserva({ idExterno: "98765", ensaio: true, canal: "outro", origemApi: "API" })], comPostAnterior: true }))).toEqual({ resultado: "noites_ocupadas", ids: ["98765"] });
  });
});

describe("a leitura incompleta nunca dá livre", () => {
  it("noite faltando no calendário, ou a mesma noite duas vezes diferente: leitura_incompleta", () => {
    expect(classificarOcupantes(entrada({ dias: [dia("2026-12-20"), dia("2026-12-22")] }))).toEqual({ resultado: "leitura_incompleta" });
    expect(classificarOcupantes(entrada({ dias: NOITES.map((n) => dia(n, { roomId: "21" })) }))).toEqual({ resultado: "leitura_incompleta" });
    expect(classificarOcupantes(entrada({ dias: [...NOITES.map((n) => dia(n)), dia("2026-12-21", { livres: 0 })] }))).toEqual({ resultado: "leitura_incompleta" });
    // A mesma noite repetida igual não atrapalha.
    expect(classificarOcupantes(entrada({ dias: [...NOITES.map((n) => dia(n)), dia("2026-12-21")] }))).toEqual({ resultado: "livre" });
  });

  it("sem noites a conferir (a atualização que só encurta): livre, sem ler nada", () => {
    expect(classificarOcupantes(entrada({ noites: [], dias: [] }))).toEqual({ resultado: "livre" });
  });
});

describe("o overbooking depois da escrita (desenho 4.4)", () => {
  it("só livres < 0 nas noites escritas e no quarto; a noite que não voltou não conclui", () => {
    const dias = [dia("2026-12-20", { livres: -1 }), dia("2026-12-21", { livres: 0 }), dia("2026-12-22", { livres: -2, roomId: "21" })];
    expect(noitesComOverbooking(dias, QUARTO, NOITES)).toEqual(["2026-12-20"]);
    expect(noitesComOverbooking(dias, QUARTO, ["2026-12-21"])).toEqual([]);
    expect(noitesSemLeitura(dias, QUARTO, NOITES)).toEqual(["2026-12-22"]);
  });
});
