/**
 * Beds24 FALSO para testes e desenvolvimento: guarda registros no formato da API e passa
 * pela mesma normalização do cliente real. Nunca usa rede. A escrita de calendário aplica
 * as faixas ao calendário em memória, para a releitura refletir o que foi "gravado".
 * M8.3a (só leitura): os info items só voltam quando a leitura os pede (`incluirInfo`), os
 * filtros novos (quarto, chegada exata, busca por texto) e os escopos da credencial
 * (GET /authentication/details) com a resposta configurável.
 * M8.3c (escrita de reservas, desenho 10): `gravarReservas` cria, altera e cancela com o mesmo
 * corpo e a mesma classificação da resposta do cliente HTTP (`corpoDaGravacaoReserva` e
 * `classificarGravacaoReserva`), e guarda o que foi enviado. As reservas gravadas ocupam o
 * calendário guardado, como no Beds24: gravar uma reserva que ocupa tira uma unidade de cada
 * noite, e cancelar ou mudar as datas devolve (`numAvail` pode ficar negativo: overbooking); o
 * bloqueio do calendário não libera nem apaga o que elas ocupam. O `checkAvailability` da criação
 * recusa quando falta unidade. As opções simulam as respostas
 * difíceis (resposta perdida, sem id, success:false que gravou, 401, 403, 429, lentidão,
 * crédito) sem dormir e sem rede.
 */
import { classificarGravacaoReserva, corpoDaGravacaoReserva, normalizarCalendario, normalizarCredencial, normalizarQuartos, normalizarReserva, respostaDaGravacao } from "./normalizar";
import {
  type CredencialBeds24, type DiaCalendario, type EnvioCalendario, ErroBeds24, type EscritorBeds24, type EscritorReservasBeds24, type FiltroCalendario, type FiltroReservas,
  type ItemGravacaoReserva, type LeitorBeds24, type LeitorCredencialBeds24, type Lido, type QuartoBeds24, type RespostaGravacaoReserva, type ReservaBeds24, type ResultadoEscrita,
} from "./tipos";

type Obj = Record<string, unknown>;
const somarDias = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A resposta de uma credencial feita com exatamente os escopos do convite (desenho 7, D10). */
export const ESCOPOS_ESPERADOS_FALSO = ["read:bookings", "write:bookings", "read:bookings-personal", "read:bookings-financial", "read:properties", "read:inventory", "write:inventory"];

/**
 * A recusa de disponibilidade do falso: traz um nome fictício de propósito, para os testes conferirem que o texto do
 * Beds24 nunca chega a uma tabela (o `erro` é fixo por código, desenho 3.8).
 */
export const MENSAGEM_SEM_DISPONIBILIDADE_FALSO = "Not available: the dates overlap booking 5550001 (Hóspede Fictício)";

/** As situações que ocupam unidade no calendário (consulta e cancelada não ocupam; desenho 4.1). */
const OCUPAM = new Set(["confirmed", "new", "request", "black"]);

export class Beds24Falso implements LeitorBeds24, LeitorCredencialBeds24, EscritorBeds24, EscritorReservasBeds24 {
  bookings: Obj[] = [];
  /** Corpo de GET /authentication/details, como a API mandaria (o formato real está "a confirmar"); passa pela mesma normalização. */
  detalhesCredencial: unknown = { validToken: true, token: { scopes: ESCOPOS_ESPERADOS_FALSO } };
  /** Os filtros de cada leitura de reservas, na ordem (para conferir o que foi pedido). */
  filtrosLidos: FiltroReservas[] = [];
  calendarios: Obj[] = [];
  properties: Obj[] = [];
  /** Para simular falhas do serviço (na gravação de reservas, que nunca lança, vira `rede` ou `tempo`, sem gravar). */
  falhar: Error | null = null;
  /** Para simular falha só na escrita (a leitura segue funcionando). */
  falharEscrita: Error | null = null;
  /** Quartos que o serviço "recusa" na escrita (resposta success:false). */
  recusarQuartos: string[] = [];
  chamadas = 0;
  /** Tudo o que foi enviado para escrita, na ordem. */
  escritas: EnvioCalendario[][] = [];

  // ---------------------------------------------------------------- escrita de reservas (M8.3c)

  /** Cada `POST /bookings` que saiu (um por chamada a `gravarReservas`), com o mesmo corpo do HTTP. Nunca há outro método. */
  escritasReservas: { metodo: "POST"; corpo: Obj[] }[] = [];
  /** O token não vem: `prepararToken` lança este erro (falha antes do POST). */
  falharToken: Error | null = null;
  /** Grava e perde a resposta (tempo esgotado). */
  perderRespostaReserva = false;
  /** Cria e responde `success: true` sem o id. */
  respostaSemId = false;
  /** Grava e responde `success: false` ("Success being false does not necessarily mean that nothing has changed"). */
  gravarComSuccessFalse = false;
  /** Na criação e na atualização: não grava e recusa por disponibilidade, mesmo com unidade livre. */
  recusarDisponibilidade = false;
  /** A credencial não lê a marca: as leituras de reservas voltam sem os info items, mesmo pedidos. */
  semMarcaNaLeitura = false;
  /** 401 também depois da renovação: nada é gravado. */
  responder401Repetido = false;
  /** 403: nada é gravado. */
  responder403 = false;
  /** 429 sem a lista de itens (o pedido não foi processado): nada é gravado. */
  responder429 = false;
  /** 429 com a lista de itens: grava, e o item diz `success: true` (sucesso duvidoso). */
  responder429ComLista = false;
  /** Chamado a cada chamada ao falso (leitura ou escrita), antes de responder: o teste avança ali o relógio que injetou. Nunca dorme. */
  lento: (() => void) | null = null;
  /** Crédito restante no cabeçalho da resposta da gravação (null = sem o cabeçalho). */
  creditoRestante: number | null = null;
  /** Portão antes de gravar (testes de concorrência): a gravação espera a promessa. */
  antesDeGravar: (() => Promise<void>) | null = null;
  /** O que a reserva criada traz de origem na leitura (`channel`, `referer`, `apiSource`; o real está "a confirmar", item 9). */
  origemDaCriada: Obj = { apiSource: "API" };
  /** Os ids que `gravarReservas` criou: só essas reservas são contadas sobre o calendário (`ocupadasNaNoite`). */
  private readonly gravadas = new Set<string>();

  constructor(private readonly agora: () => Date = () => new Date()) {}

  private checar() {
    this.chamadas++;
    this.lento?.();
    if (this.falhar) throw this.falhar;
  }

  async reservas(f: FiltroReservas): Promise<Lido<ReservaBeds24>> {
    this.checar();
    this.filtrosLidos.push({ ...f });
    const pesquisa = f.pesquisa?.trim().toLowerCase();
    const filtrados = this.bookings.filter((b) => {
      const chegada = String(b.arrival ?? "");
      if (f.chegadaExata !== undefined) {
        if (chegada !== f.chegadaExata) return false;
      } else {
        if (f.chegadaDe && chegada < f.chegadaDe) return false;
        if (f.chegadaAte && chegada > f.chegadaAte) return false;
      }
      if (f.saidaDe && String(b.departure ?? "") < f.saidaDe) return false;
      if (f.ids?.length && !f.ids.includes(String(b.id))) return false;
      if (f.modificadasDesde && String(b.modifiedTime ?? "") < f.modificadasDesde) return false;
      if (f.propertyIds?.length && !f.propertyIds.includes(String(b.propertyId))) return false;
      if (f.quarto !== undefined && String(b.roomId) !== f.quarto) return false;
      // Aproximação da busca do Beds24: nome, e-mail, notas e ids (os info items não entram na busca).
      if (pesquisa && ![b.firstName, b.lastName, b.email, b.notes, b.id, b.apiReference].some((v) => String(v ?? "").toLowerCase().includes(pesquisa))) return false;
      return true;
    });
    const itens: ReservaBeds24[] = [];
    const divergencias = [];
    for (const registro of filtrados) {
      // Os info items só vêm quando a leitura pede (includeInfoItems=true), como na API, e a credencial lê a marca.
      const b = f.incluirInfo && !this.semMarcaNaLeitura ? registro : Object.fromEntries(Object.entries(registro).filter(([k]) => k !== "infoItems"));
      const n = normalizarReserva(b);
      if (n.ok) itens.push(n.r);
      else divergencias.push(n.d);
    }
    return { itens, divergencias, lidoEm: this.agora().toISOString() };
  }

  async calendario(f: FiltroCalendario): Promise<Lido<DiaCalendario>> {
    this.checar();
    const salas = this.calendarios.filter((c) => f.roomIds.includes(String(c.roomId)));
    return { ...normalizarCalendario(salas, f.inicio, f.fim), lidoEm: this.agora().toISOString() };
  }

  async quartos(): Promise<Lido<QuartoBeds24>> {
    this.checar();
    return { ...normalizarQuartos(this.properties), lidoEm: this.agora().toISOString() };
  }

  async credencial(): Promise<CredencialBeds24> {
    this.checar();
    return { ...normalizarCredencial(this.detalhesCredencial), lidoEm: this.agora().toISOString() };
  }

  /** O calendário do quarto em dias (uma faixa por dia), para aplicar a escrita noite a noite; `criar` acrescenta a sala que falta. */
  private diasDaSala(roomId: string, criar: boolean): { sala: Obj; porDia: Map<string, Obj> } | null {
    let sala = this.calendarios.find((c) => String(c.roomId) === roomId);
    if (!sala) {
      if (!criar) return null;
      sala = { roomId, calendar: [] };
      this.calendarios.push(sala);
    }
    const porDia = new Map<string, Obj>();
    for (const faixa of (sala.calendar as Obj[])) {
      const de = String(faixa.from);
      const ate = String(faixa.to ?? faixa.from);
      for (let d = de; d <= ate; d = somarDias(d, 1)) porDia.set(d, { ...(porDia.get(d) ?? {}), ...faixa, from: d, to: d });
    }
    return { sala, porDia };
  }

  private guardarDias(sala: Obj, porDia: Map<string, Obj>) {
    sala.calendar = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }

  /** Aplica cada faixa dia a dia sobre o calendário do quarto (campo ausente = não altera). */
  async escreverCalendario(itens: EnvioCalendario[]): Promise<ResultadoEscrita[]> {
    this.checar();
    if (this.falharEscrita) throw this.falharEscrita;
    this.escritas.push(itens);
    return itens.map((i) => {
      if (this.recusarQuartos.includes(i.roomId)) return { roomId: i.roomId, ok: false, erro: "Quarto recusado pelo serviço falso." };
      const { sala, porDia } = this.diasDaSala(i.roomId, true)!;
      for (const f of i.faixas) {
        for (let d = f.from; d <= f.to; d = somarDias(d, 1)) {
          const atual = porDia.get(d) ?? { from: d, to: d };
          if (f.preco !== undefined) atual.price1 = f.preco / 100;
          if (f.minimo !== undefined) atual.minStay = f.minimo;
          if (f.maximo !== undefined) atual.maxStay = f.maximo;
          if (f.bloqueio !== undefined) {
            atual.override = f.bloqueio;
            // Aproximação do serviço falso (uma unidade): blackout fecha a unidade; qualquer outro override a devolve. As
            // reservas gravadas pelo falso continuam ocupando, como no Beds24: tirar o bloqueio não libera a noite reservada,
            // e o blackout não apaga o overbooking (−1).
            const ocupadas = this.ocupadasNaNoite(i.roomId, d);
            if (f.bloqueio === "blackout") atual.numAvail = Math.min(0, 1 - ocupadas);
            else if (atual.numAvail === 0 && ocupadas === 0) atual.numAvail = 1;
          }
          porDia.set(d, atual);
        }
      }
      this.guardarDias(sala, porDia);
      return { roomId: i.roomId, ok: true, erro: "" };
    });
  }

  /** O token: lança `falharToken` (ou `falhar`), como a renovação que cai antes do POST. */
  async prepararToken(): Promise<void> {
    this.checar();
    if (this.falharToken) throw this.falharToken;
  }

  /**
   * POST /bookings falso (M8.3c): o mesmo corpo do HTTP e a mesma classificação da resposta, a partir da resposta que a API
   * mandaria. Nunca lança, como o HTTP: o serviço fora do ar (`falhar`) vira `rede` ou `tempo`, sem gravar.
   */
  async gravarReservas(item: ItemGravacaoReserva): Promise<RespostaGravacaoReserva> {
    this.chamadas++;
    this.lento?.();
    let corpo: Obj[];
    try {
      corpo = corpoDaGravacaoReserva(item);
    } catch {
      return respostaDaGravacao("nao_enviado");
    }
    if (this.antesDeGravar) await this.antesDeGravar();
    if (this.falhar) return respostaDaGravacao(this.falhar instanceof ErroBeds24 && this.falhar.tipo === "tempo" ? "tempo" : "rede");
    this.escritasReservas.push({ metodo: "POST", corpo });
    const cabecalhos = new Headers(this.creditoRestante === null ? {} : { "x-five-min-limit-remaining": String(this.creditoRestante) });
    const responder = (status: number, valor: unknown) => classificarGravacaoReserva(item, { status, json: { valor }, cabecalhos });
    if (this.responder401Repetido) return responder(401, { success: false, error: "Unauthorized" });
    if (this.responder403) return responder(403, { success: false, error: "Forbidden" });
    if (this.responder429) return responder(429, { success: false, error: "Credit limit exceeded" });
    const pedido = corpo[0];
    const recusa = (mensagem: string) => responder(item.tipo === "criar" ? 201 : 200, [{ success: false, errors: [{ action: item.tipo === "criar" ? "new" : "modify", message: mensagem }] }]);
    if (this.recusarDisponibilidade && item.tipo !== "cancelar") return recusa(MENSAGEM_SEM_DISPONIBILIDADE_FALSO);
    const gravada = item.tipo === "criar" ? this.criar(pedido) : this.modificar(pedido);
    if (!gravada.ok) return recusa(gravada.mensagem);
    if (this.perderRespostaReserva) return respostaDaGravacao("tempo");
    if (this.gravarComSuccessFalse) return recusa("Booking saved with errors");
    if (this.responder429ComLista) return responder(429, [{ success: true, ...(item.tipo === "criar" ? { new: { id: Number(gravada.id) } } : { modified: { id: Number(gravada.id) } }) }]);
    if (item.tipo !== "criar") return responder(200, [{ success: true, modified: { id: Number(gravada.id) } }]);
    return responder(201, [{ success: true, new: this.respostaSemId ? {} : { id: Number(gravada.id) } }]);
  }

  /** Cria a reserva (com o `checkAvailability` do pedido) e ocupa as noites. O quarto precisa existir em `properties`. */
  private criar(p: Obj): { ok: true; id: string } | { ok: false; mensagem: string } {
    const roomId = String(p.roomId);
    const prop = this.properties.find((x) => Array.isArray(x.roomTypes) && (x.roomTypes as Obj[]).some((q) => String(q.id) === roomId));
    if (!prop) return { ok: false, mensagem: "Invalid roomId" };
    const de = String(p.arrival);
    const ate = String(p.departure);
    if ((p.actions as Obj | undefined)?.checkAvailability === true) {
      const dias = this.diasDaSala(roomId, false)?.porDia;
      for (let d = de; d < ate; d = somarDias(d, 1)) {
        const livres = dias?.get(d)?.numAvail;
        if (livres === undefined || livres === null || Number(livres) < 1) return { ok: false, mensagem: MENSAGEM_SEM_DISPONIBILIDADE_FALSO };
      }
    }
    const id = String(Math.max(900_000, ...this.bookings.map((b) => Number(b.id)).filter(Number.isSafeInteger)) + 1);
    const instante = this.agora().toISOString();
    this.bookings.push({
      id: Number(id), propertyId: prop.id, roomId: Number(roomId), status: "confirmed", arrival: de, departure: ate,
      // Cópia: o registro guardado não divide objetos com o corpo enviado (`escritasReservas`).
      numAdult: p.numAdult, numChild: p.numChild, infoItems: structuredClone(p.infoItems), modifiedTime: instante, bookingTime: instante, ...this.origemDaCriada,
    });
    this.gravadas.add(id);
    this.ocupar(roomId, de, ate, -1);
    return { ok: true, id };
  }

  /** Atualiza (datas e pessoas, nunca o quarto) ou cancela, devolvendo e ocupando as noites conforme a situação. */
  private modificar(p: Obj): { ok: true; id: string } | { ok: false; mensagem: string } {
    const b = this.bookings.find((x) => String(x.id) === String(p.id));
    if (!b) return { ok: false, mensagem: "Booking not found" };
    const roomId = String(b.roomId);
    const antes = OCUPAM.has(String(b.status)) ? { de: String(b.arrival), ate: String(b.departure) } : null;
    for (const k of ["arrival", "departure", "numAdult", "status"]) if (p[k] !== undefined) b[k] = p[k];
    b.modifiedTime = this.agora().toISOString();
    // Devolve e ocupa depois de gravar: a noite com blackout é recontada pelo que ficou gravado (`ocupar`).
    if (antes) this.ocupar(roomId, antes.de, antes.ate, +1);
    if (OCUPAM.has(String(b.status))) this.ocupar(roomId, String(b.arrival), String(b.departure), -1);
    return { ok: true, id: String(b.id) };
  }

  /**
   * Tira (−1) ou devolve (+1) uma unidade em cada noite [de, ate) que o calendário guardado informa; noite sem número fica
   * como está. Na noite com blackout, a unidade continua fechada: o número sai das reservas gravadas que ocupam (o −1 do
   * overbooking fica, e cancelar não reabre), como na escrita do calendário.
   */
  private ocupar(roomId: string, de: string, ate: string, delta: number) {
    const dias = this.diasDaSala(roomId, false);
    if (!dias) return;
    for (let d = de; d < ate; d = somarDias(d, 1)) {
      const dia = dias.porDia.get(d);
      if (!dia || dia.numAvail === undefined || dia.numAvail === null || !Number.isFinite(Number(dia.numAvail))) continue;
      dia.numAvail = dia.override === "blackout" ? Math.min(0, 1 - this.ocupadasNaNoite(roomId, d)) : Number(dia.numAvail) + delta;
    }
    this.guardarDias(dias.sala, dias.porDia);
  }

  /**
   * Quantas reservas gravadas por `gravarReservas` ocupam a noite. Só elas: os testes antigos montam `bookings` e o
   * calendário separados, e o calendário deles já diz o que está ocupado.
   */
  private ocupadasNaNoite(roomId: string, d: string): number {
    return this.bookings.filter((b) => this.gravadas.has(String(b.id)) && String(b.roomId) === roomId && OCUPAM.has(String(b.status)) && String(b.arrival) <= d && d < String(b.departure)).length;
  }
}
