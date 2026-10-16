/**
 * Beds24 FALSO para testes e desenvolvimento: guarda registros no formato da API e passa
 * pela mesma normalização do cliente real. Nunca usa rede. A escrita de calendário aplica
 * as faixas ao calendário em memória, para a releitura refletir o que foi "gravado".
 * M8.3a (só leitura): os info items só voltam quando a leitura os pede (`incluirInfo`), os
 * filtros novos (quarto, chegada exata, busca por texto) e os escopos da credencial
 * (GET /authentication/details) com a resposta configurável. A escrita de reservas é do M8.3c.
 */
import { normalizarCalendario, normalizarCredencial, normalizarQuartos, normalizarReserva } from "./normalizar";
import type { CredencialBeds24, DiaCalendario, EnvioCalendario, EscritorBeds24, FiltroCalendario, FiltroReservas, LeitorBeds24, LeitorCredencialBeds24, Lido, QuartoBeds24, ReservaBeds24, ResultadoEscrita } from "./tipos";

type Obj = Record<string, unknown>;
const somarDias = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A resposta de uma credencial feita com exatamente os escopos do convite (desenho 7, D10). */
export const ESCOPOS_ESPERADOS_FALSO = ["read:bookings", "write:bookings", "read:bookings-personal", "read:bookings-financial", "read:properties", "read:inventory", "write:inventory"];

export class Beds24Falso implements LeitorBeds24, LeitorCredencialBeds24, EscritorBeds24 {
  bookings: Obj[] = [];
  /** Corpo de GET /authentication/details, como a API mandaria (o formato real está "a confirmar"); passa pela mesma normalização. */
  detalhesCredencial: unknown = { validToken: true, token: { scopes: ESCOPOS_ESPERADOS_FALSO } };
  /** Os filtros de cada leitura de reservas, na ordem (para conferir o que foi pedido). */
  filtrosLidos: FiltroReservas[] = [];
  calendarios: Obj[] = [];
  properties: Obj[] = [];
  /** Para simular falhas do serviço. */
  falhar: Error | null = null;
  /** Para simular falha só na escrita (a leitura segue funcionando). */
  falharEscrita: Error | null = null;
  /** Quartos que o serviço "recusa" na escrita (resposta success:false). */
  recusarQuartos: string[] = [];
  chamadas = 0;
  /** Tudo o que foi enviado para escrita, na ordem. */
  escritas: EnvioCalendario[][] = [];

  constructor(private readonly agora: () => Date = () => new Date()) {}

  private checar() {
    this.chamadas++;
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
      // Os info items só vêm quando a leitura pede (includeInfoItems=true), como na API.
      const b = f.incluirInfo ? registro : Object.fromEntries(Object.entries(registro).filter(([k]) => k !== "infoItems"));
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

  /** Aplica cada faixa dia a dia sobre o calendário do quarto (campo ausente = não altera). */
  async escreverCalendario(itens: EnvioCalendario[]): Promise<ResultadoEscrita[]> {
    this.checar();
    if (this.falharEscrita) throw this.falharEscrita;
    this.escritas.push(itens);
    return itens.map((i) => {
      if (this.recusarQuartos.includes(i.roomId)) return { roomId: i.roomId, ok: false, erro: "Quarto recusado pelo serviço falso." };
      let sala = this.calendarios.find((c) => String(c.roomId) === i.roomId);
      if (!sala) {
        sala = { roomId: i.roomId, calendar: [] };
        this.calendarios.push(sala);
      }
      // Expande o calendário atual em dias, aplica as faixas e guarda um registro por dia.
      const porDia = new Map<string, Obj>();
      for (const faixa of (sala.calendar as Obj[])) {
        const de = String(faixa.from);
        const ate = String(faixa.to ?? faixa.from);
        for (let d = de; d <= ate; d = somarDias(d, 1)) porDia.set(d, { ...(porDia.get(d) ?? {}), ...faixa, from: d, to: d });
      }
      for (const f of i.faixas) {
        for (let d = f.from; d <= f.to; d = somarDias(d, 1)) {
          const atual = porDia.get(d) ?? { from: d, to: d };
          if (f.preco !== undefined) atual.price1 = f.preco / 100;
          if (f.minimo !== undefined) atual.minStay = f.minimo;
          if (f.maximo !== undefined) atual.maxStay = f.maximo;
          if (f.bloqueio !== undefined) {
            atual.override = f.bloqueio;
            // Aproximação do serviço falso: blackout fecha a unidade; qualquer outro override a devolve.
            if (f.bloqueio === "blackout") atual.numAvail = 0;
            else if (atual.numAvail === 0) atual.numAvail = 1;
          }
          porDia.set(d, atual);
        }
      }
      sala.calendar = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
      return { roomId: i.roomId, ok: true, erro: "" };
    });
  }
}
