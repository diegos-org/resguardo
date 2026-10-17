/**
 * Reserva paga do site no Beds24 (M8.3c) — a versão falsa ampliada com a escrita de reservas (desenho 10): o mesmo corpo
 * e a mesma classificação do cliente HTTP, as reservas ocupando o calendário guardado, o `checkAvailability` e as opções
 * que simulam as respostas difíceis. Sem rede.
 */
import { describe, expect, it } from "vitest";
import { Beds24Falso, MENSAGEM_SEM_DISPONIBILIDADE_FALSO } from "./falso";
import { corpoDaGravacaoReserva } from "./normalizar";
import { ErroBeds24, type ItemGravacaoReserva, TEXTOS_DE_ERRO_BEDS24 } from "./tipos";

const AGORA = new Date("2026-10-17T12:00:00Z");
/** O quarto 20 do imóvel 10, em BRL, com uma unidade de 18 a 31/12. */
function falso() {
  const b = new Beds24Falso(() => AGORA);
  b.properties = [{ id: 10, currency: "BRL", roomTypes: [{ id: 20, name: "Studio" }] }];
  b.calendarios = [{ roomId: 20, calendar: [{ from: "2026-12-18", to: "2026-12-31", numAvail: 1, price1: 450 }] }];
  return b;
}
const CRIAR: ItemGravacaoReserva = { tipo: "criar", quarto: "20", chegada: "2026-12-20", saida: "2026-12-23", hospedes: 2, marca: { tipo: "reserva", codigo: "SCL-7K2QXM" } };
const livres = async (b: Beds24Falso, inicio = "2026-12-19", fim = "2026-12-27") =>
  Object.fromEntries((await b.calendario({ roomIds: ["20"], inicio, fim })).itens.map((d) => [d.data.slice(5), d.livres]));

describe("Beds24 falso: escrita de reservas (M8.3c, desenho 10)", () => {
  it("cria, altera e cancela com o mesmo corpo do HTTP; a releitura mostra o gravado, e as reservas ocupam e devolvem as noites", async () => {
    const b = falso();
    const criada = await b.gravarReservas(CRIAR);
    expect(criada).toMatchObject({ resposta: "criada", beds24Id: "900001", http: 201, erro: "" });
    expect(b.escritasReservas).toEqual([{ metodo: "POST", corpo: corpoDaGravacaoReserva(CRIAR) }]);
    const [lida] = (await b.reservas({ ids: ["900001"], incluirInfo: true })).itens;
    expect(lida).toMatchObject({
      idExterno: "900001", propertyId: "10", roomId: "20", estado: "confirmada", checkin: "2026-12-20", checkout: "2026-12-23", hospedes: 2,
      referenciaScl: "SCL-7K2QXM", marcaFonte: "info", origemApi: "API", reservadaEm: AGORA.toISOString(), modificadoEm: AGORA.toISOString(), nome: "", email: "", telefone: "",
    });
    expect(await livres(b)).toEqual({ "12-19": 1, "12-20": 0, "12-21": 0, "12-22": 0, "12-23": 1, "12-24": 1, "12-25": 1, "12-26": 1 });

    // Atualizar: devolve as noites que saíram e ocupa as que entraram; nunca troca o quarto.
    expect(await b.gravarReservas({ tipo: "atualizar", id: "900001", chegada: "2026-12-21", saida: "2026-12-25", hospedes: 3 })).toMatchObject({ resposta: "modificada", beds24Id: "900001", http: 200 });
    expect((await b.reservas({ ids: ["900001"] })).itens[0]).toMatchObject({ checkin: "2026-12-21", checkout: "2026-12-25", hospedes: 3, roomId: "20" });
    expect(await livres(b)).toEqual({ "12-19": 1, "12-20": 1, "12-21": 0, "12-22": 0, "12-23": 0, "12-24": 0, "12-25": 1, "12-26": 1 });

    // Cancelar: a situação muda (nunca apaga) e as noites voltam.
    expect(await b.gravarReservas({ tipo: "cancelar", id: "900001" })).toMatchObject({ resposta: "modificada", beds24Id: "900001" });
    expect(b.bookings).toHaveLength(1);
    expect((await b.reservas({ ids: ["900001"] })).itens[0].estado).toBe("cancelada");
    expect(Object.values(await livres(b)).every((n) => n === 1)).toBe(true);
    expect(b.escritasReservas.map((e) => e.metodo)).toEqual(["POST", "POST", "POST"]);
    // A segunda criação ganha o id seguinte.
    expect(await b.gravarReservas({ ...CRIAR, chegada: "2026-12-26", saida: "2026-12-28" })).toMatchObject({ resposta: "criada", beds24Id: "900002" });
  });

  it("checkAvailability: sem unidade (ou sem a noite no calendário) recusa com a mensagem de disponibilidade e não grava; o texto não vai para o `erro`", async () => {
    const b = falso();
    b.calendarios = [{ roomId: 20, calendar: [{ from: "2026-12-18", to: "2026-12-31", numAvail: 1 }, { from: "2026-12-21", numAvail: 0 }] }];
    const recusa = await b.gravarReservas(CRIAR);
    expect(recusa).toMatchObject({ resposta: "recusada_disponibilidade", beds24Id: null, erro: TEXTOS_DE_ERRO_BEDS24.recusada_disponibilidade });
    expect(JSON.stringify(recusa)).not.toContain("Fictício");
    expect(MENSAGEM_SEM_DISPONIBILIDADE_FALSO).toContain("Fictício");
    expect(b.bookings).toHaveLength(0);
    // A noite que o calendário não informa também recusa (nunca "livre" por omissão).
    const semNoite = falso();
    semNoite.calendarios = [{ roomId: 20, calendar: [{ from: "2026-12-20", to: "2026-12-21", numAvail: 1 }] }];
    expect(await semNoite.gravarReservas(CRIAR)).toMatchObject({ resposta: "recusada_disponibilidade" });
    // O quarto que não existe em `properties` é recusado como pelo Beds24.
    const semQuarto = falso();
    semQuarto.properties = [];
    expect(await semQuarto.gravarReservas(CRIAR)).toMatchObject({ resposta: "recusada" });
    expect(semQuarto.bookings).toHaveLength(0);
  });

  it("a atualização não confere a disponibilidade: as noites novas vendidas por uma OTA ficam em overbooking (-1) na releitura", async () => {
    const b = falso();
    await b.gravarReservas(CRIAR);
    // Uma OTA vendeu 23 e 24/12 (a reserva dela já ocupou a unidade no calendário).
    b.bookings.push({ id: 5550001, propertyId: 10, roomId: 20, status: "confirmed", arrival: "2026-12-23", departure: "2026-12-25", referer: "Airbnb" });
    b.calendarios = [{ roomId: 20, calendar: [...(b.calendarios[0].calendar as Record<string, unknown>[]).map((d) => (d.from === "2026-12-23" || d.from === "2026-12-24" ? { ...d, numAvail: 0 } : d))] }];
    expect(await b.gravarReservas({ tipo: "atualizar", id: "900001", chegada: "2026-12-20", saida: "2026-12-25", hospedes: 2 })).toMatchObject({ resposta: "modificada" });
    expect(await livres(b)).toMatchObject({ "12-22": 0, "12-23": -1, "12-24": -1, "12-25": 1 });
  });

  it("a escrita do calendário respeita as reservas gravadas: tirar o bloqueio não libera a noite reservada, o blackout não apaga o overbooking e cancelar sob o blackout não reabre", async () => {
    const b = falso();
    const bloqueio = (bloqueio: "none" | "blackout") => b.escreverCalendario([{ roomId: "20", faixas: [{ from: "2026-12-20", to: "2026-12-22", bloqueio }] }]);
    await b.gravarReservas(CRIAR);
    await bloqueio("none");
    expect(await livres(b)).toMatchObject({ "12-19": 1, "12-20": 0, "12-21": 0, "12-22": 0, "12-23": 1 });
    // Uma segunda reserva levada para cima da primeira (a atualização não confere a disponibilidade): overbooking.
    await b.gravarReservas({ ...CRIAR, chegada: "2026-12-24", saida: "2026-12-26" });
    await b.gravarReservas({ tipo: "atualizar", id: "900002", chegada: "2026-12-21", saida: "2026-12-23", hospedes: 2 });
    expect(await livres(b)).toMatchObject({ "12-20": 0, "12-21": -1, "12-22": -1, "12-24": 1, "12-25": 1 });
    await bloqueio("blackout");
    expect(await livres(b)).toMatchObject({ "12-20": 0, "12-21": -1, "12-22": -1 });
    // Sob o blackout, cancelar devolve a unidade às reservas que ficam, mas a noite continua fechada.
    await b.gravarReservas({ tipo: "cancelar", id: "900002" });
    expect(await livres(b)).toMatchObject({ "12-20": 0, "12-21": 0, "12-22": 0 });
    await b.gravarReservas({ tipo: "cancelar", id: "900001" });
    expect(await livres(b)).toMatchObject({ "12-20": 0, "12-21": 0, "12-22": 0 });
    // Tirado o bloqueio, sem reserva gravada nas noites, a unidade volta.
    await bloqueio("none");
    expect(Object.values(await livres(b)).every((n) => n === 1)).toBe(true);
  });

  it("as opções: resposta perdida, sem id e success:false gravam; recusa de disponibilidade, 401 repetido, 403 e 429 sem a lista não gravam; 429 com a lista grava com sucesso duvidoso", async () => {
    const caso = async (opcao: Partial<Beds24Falso>, item: ItemGravacaoReserva = CRIAR) => {
      const b = Object.assign(falso(), opcao);
      return { b, r: await b.gravarReservas(item) };
    };
    const perdida = await caso({ perderRespostaReserva: true });
    expect(perdida.r).toMatchObject({ resposta: "tempo", http: null });
    expect(perdida.b.bookings).toHaveLength(1);
    const semId = await caso({ respostaSemId: true });
    expect(semId.r).toMatchObject({ resposta: "sem_id", beds24Id: null, http: 201 });
    expect(semId.b.bookings).toHaveLength(1);
    const falsoFalse = await caso({ gravarComSuccessFalse: true });
    expect(falsoFalse.r).toMatchObject({ resposta: "recusada" });
    expect(falsoFalse.b.bookings).toHaveLength(1);
    const disponibilidade = await caso({ recusarDisponibilidade: true });
    expect(disponibilidade.r).toMatchObject({ resposta: "recusada_disponibilidade" });
    expect(disponibilidade.b.bookings).toHaveLength(0);
    for (const [opcao, resposta, http] of [[{ responder401Repetido: true }, "http_401", 401], [{ responder403: true }, "http_403", 403], [{ responder429: true }, "limite", 429]] as const) {
      const c = await caso(opcao);
      expect(c.r, resposta).toMatchObject({ resposta, http });
      expect(c.b.bookings).toHaveLength(0);
      // O pedido chegou (um registro por chamada), mas não foi processado.
      expect(c.b.escritasReservas).toHaveLength(1);
    }
    const comLista = await caso({ responder429ComLista: true });
    expect(comLista.r).toMatchObject({ resposta: "sem_id", beds24Id: null, http: 429 });
    expect(comLista.b.bookings).toHaveLength(1);
    // As mesmas opções na atualização e no cancelamento.
    const b = falso();
    await b.gravarReservas(CRIAR);
    b.perderRespostaReserva = true;
    expect(await b.gravarReservas({ tipo: "cancelar", id: "900001" })).toMatchObject({ resposta: "tempo" });
    expect(b.bookings[0].status).toBe("cancelled");
    b.perderRespostaReserva = false;
    expect(await b.gravarReservas({ tipo: "cancelar", id: "424242" })).toMatchObject({ resposta: "recusada" });
  });

  it("o crédito restante no cabeçalho; sem a opção, desconhecido", async () => {
    const b = falso();
    expect((await b.gravarReservas(CRIAR)).creditoRestante).toBeNull();
    b.creditoRestante = 15;
    expect(await b.gravarReservas({ ...CRIAR, chegada: "2026-12-26", saida: "2026-12-28" })).toMatchObject({ resposta: "criada", creditoRestante: 15, observado: { cabecalhosDeCredito: ["x-five-min-limit-remaining"] } });
  });

  it("sem marca na leitura: os info items não voltam, mesmo pedidos (a credencial não lê a marca)", async () => {
    const b = falso();
    await b.gravarReservas(CRIAR);
    b.semMarcaNaLeitura = true;
    expect((await b.reservas({ ids: ["900001"], incluirInfo: true })).itens[0]).toMatchObject({ referenciaScl: null, marcaFonte: null, marcaAmbigua: false });
    b.semMarcaNaLeitura = false;
    expect((await b.reservas({ ids: ["900001"], incluirInfo: true })).itens[0].referenciaScl).toBe("SCL-7K2QXM");
  });

  it("o ensaio grava o info item SCL-ENSAIO com o id da operação, e a leitura devolve o id", async () => {
    const b = falso();
    const op = "0f8fad5b-d9cb-469f-a165-70867728950e";
    await b.gravarReservas({ ...CRIAR, hospedes: 1, marca: { tipo: "ensaio", operacaoId: op } });
    expect((await b.reservas({ quarto: "20", chegadaExata: "2026-12-20", incluirInfo: true })).itens[0]).toMatchObject({ ensaio: true, ensaioOperacaoId: op, referenciaScl: null });
  });

  it("lento: o relógio do teste anda a cada chamada (sem dormir); antesDeGravar segura a gravação até o teste liberar", async () => {
    const b = falso();
    let passos = 0;
    b.lento = () => { passos++; };
    let liberar!: () => void;
    const portao = new Promise<void>((r) => { liberar = r; });
    b.antesDeGravar = () => portao;
    const gravando = b.gravarReservas(CRIAR);
    await Promise.resolve();
    expect(b.bookings).toHaveLength(0);
    expect(b.escritasReservas).toHaveLength(0);
    await b.reservas({});
    liberar();
    expect(await gravando).toMatchObject({ resposta: "criada" });
    expect(b.bookings).toHaveLength(1);
    expect(passos).toBe(2);
  });

  it("o token e o serviço fora do ar: prepararToken lança; gravarReservas nunca lança (fora do ar vira rede ou tempo, sem gravar); item inválido não sai", async () => {
    const b = falso();
    b.falharToken = new ErroBeds24("Beds24 não respondeu a tempo. Etapa: renovação do token.", "tempo");
    await expect(b.prepararToken()).rejects.toMatchObject({ tipo: "tempo" });
    b.falharToken = null;
    await expect(b.prepararToken()).resolves.toBeUndefined();
    b.falhar = new ErroBeds24("fora do ar", "rede");
    await expect(b.prepararToken()).rejects.toThrow("fora do ar");
    expect(await b.gravarReservas(CRIAR)).toMatchObject({ resposta: "rede" });
    b.falhar = new ErroBeds24("demorou", "tempo");
    expect(await b.gravarReservas(CRIAR)).toMatchObject({ resposta: "tempo" });
    expect(b.bookings).toHaveLength(0);
    expect(b.escritasReservas).toHaveLength(0);
    b.falhar = null;
    expect(await b.gravarReservas({ ...CRIAR, marca: { tipo: "reserva", codigo: "não é código" } })).toMatchObject({ resposta: "nao_enviado" });
    expect(b.escritasReservas).toHaveLength(0);
  });
});
