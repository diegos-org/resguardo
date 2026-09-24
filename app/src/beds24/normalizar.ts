/**
 * Normalização estrita das respostas do Beds24 → tipos internos. Qualquer coisa fora do
 * esperado vira divergência (nunca um dado "chutado"). Formato conferido contra a
 * documentação pública da API v2; confirmar com a conta real antes de sincronizar (M3.3).
 */
import { dataValida } from "@/reservas/regras";
import type { CanalBeds24, DiaCalendario, Divergencia, EstadoBeds24, QuartoBeds24, ReservaBeds24 } from "./tipos";

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const texto = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const id = (v: unknown) => {
  const t = texto(v);
  return /^[A-Za-z0-9._:-]{1,64}$/.test(t) ? t : "";
};

/**
 * Valor em reais (número ou texto "1234.50") → centavos, pelos DÍGITOS (sem conta em
 * ponto flutuante: 1.005 vira 101, não 100). Meio centavo arredonda para longe do zero.
 * Inválido → undefined.
 */
export function reaisParaCentavosApi(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v.trim() : "";
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return undefined; // inclui notação científica (1e21) e vírgula
  const [, sinal, inteiro, frac = ""] = m;
  let centavos = Number(inteiro) * 100 + Number(frac.slice(0, 2).padEnd(2, "0"));
  if (frac.length > 2 && frac[2] >= "5") centavos += 1;
  if (!Number.isSafeInteger(centavos)) return undefined;
  return sinal ? -centavos : centavos;
}

const ESTADOS: Record<string, EstadoBeds24> = {
  confirmed: "confirmada",
  new: "confirmada",
  request: "pendente",
  inquiry: "pendente",
  cancelled: "cancelada",
  black: "bloqueio",
};

/** Canal pela origem informada (campos `channel`/`referer`). Desconhecido → "outro". */
export function canalDe(...fontes: unknown[]): CanalBeds24 {
  const t = fontes.map(texto).join(" ").toLowerCase();
  if (t.includes("airbnb")) return "airbnb";
  if (t.includes("booking")) return "booking";
  if (/\b(direct|direto|direta|website|site)\b/.test(t)) return "direta";
  return "outro";
}

export function normalizarReserva(b: unknown): { ok: true; r: ReservaBeds24 } | { ok: false; d: Divergencia } {
  const falha = (motivo: string) => ({ ok: false as const, d: { origem: "reserva" as const, id: ehObj(b) ? texto(b.id) || "?" : "?", motivo } });
  if (!ehObj(b)) return falha("registro não é um objeto");
  const idExterno = id(b.id);
  if (!idExterno) return falha("sem id");
  const propertyId = id(b.propertyId);
  const roomId = id(b.roomId);
  if (!propertyId || !roomId) return falha("sem propertyId/roomId");
  const estado = ESTADOS[texto(b.status).toLowerCase()];
  if (!estado) return falha(`situação desconhecida: ${texto(b.status) || "(vazia)"}`);
  const checkin = texto(b.arrival);
  const checkout = texto(b.departure);
  if (!dataValida(checkin) || !dataValida(checkout)) return falha("datas inválidas");
  // No Beds24 a data de saída é o dia do checkout (exclusivo), como no SCL.
  if (checkout <= checkin) return falha("saída não é depois da entrada");
  const valorBruto = reaisParaCentavosApi(b.price);
  const comissaoCanal = reaisParaCentavosApi(b.commission);
  if (valorBruto === undefined || comissaoCanal === undefined) return falha("valor inválido");
  if ((valorBruto ?? 0) < 0 || (comissaoCanal ?? 0) < 0) return falha("valor negativo");
  const adultos = Number(b.numAdult ?? 0);
  const criancas = Number(b.numChild ?? 0);
  if (!Number.isInteger(adultos) || !Number.isInteger(criancas) || adultos < 0 || criancas < 0) return falha("número de hóspedes inválido");
  const hospedes = adultos + criancas > 0 ? adultos + criancas : null;
  return {
    ok: true,
    r: {
      idExterno,
      propertyId,
      roomId,
      estado,
      checkin,
      checkout,
      hospedes,
      nome: [texto(b.firstName), texto(b.lastName)].filter(Boolean).join(" ").slice(0, 200),
      email: texto(b.email).toLowerCase().slice(0, 200),
      telefone: texto(b.phone || b.mobile).slice(0, 50),
      valorBruto,
      comissaoCanal,
      canal: canalDe(b.channel, b.referer),
      codigoCanal: id(b.apiReference),
      modificadoEm: texto(b.modifiedTime) || null,
    },
  };
}

/** Calendário: `data` = [{ roomId, calendar: [{ from, to, numAvail, price1, minStay }] }]. */
export function normalizarCalendario(salas: unknown[], inicio: string, fim: string): { itens: DiaCalendario[]; divergencias: Divergencia[] } {
  const itens: DiaCalendario[] = [];
  const divergencias: Divergencia[] = [];
  for (const s of salas) {
    if (!ehObj(s) || !id(s.roomId) || !Array.isArray(s.calendar)) {
      divergencias.push({ origem: "calendario", id: ehObj(s) ? texto(s.roomId) || "?" : "?", motivo: "quarto sem calendário" });
      continue;
    }
    const roomId = id(s.roomId);
    for (const faixa of s.calendar) {
      if (!ehObj(faixa) || !dataValida(texto(faixa.from)) || !dataValida(texto(faixa.to ?? faixa.from)) || texto(faixa.to ?? faixa.from) < texto(faixa.from)) {
        divergencias.push({ origem: "calendario", id: roomId, motivo: "faixa de datas inválida" });
        continue;
      }
      const preco = reaisParaCentavosApi(faixa.price1);
      const livres = faixa.numAvail === undefined || faixa.numAvail === null ? null : Number(faixa.numAvail);
      const minimo = faixa.minStay === undefined || faixa.minStay === null ? null : Number(faixa.minStay);
      const inteiroNaoNegativo = (x: number | null) => x === null || (Number.isInteger(x) && x >= 0);
      if (preco === undefined || (preco !== null && preco < 0) || !inteiroNaoNegativo(livres) || !inteiroNaoNegativo(minimo)) {
        divergencias.push({ origem: "calendario", id: roomId, motivo: "valores inválidos" });
        continue;
      }
      // Faixa inclusiva [from, to]: expande em dias, recortando ao período pedido [inicio, fim).
      for (let t = Date.parse(`${texto(faixa.from)}T00:00:00Z`); t <= Date.parse(`${texto(faixa.to ?? faixa.from)}T00:00:00Z`); t += 86_400_000) {
        const data = new Date(t).toISOString().slice(0, 10);
        if (data >= inicio && data < fim) itens.push({ roomId, data, livres, preco, minimoNoites: minimo });
      }
    }
  }
  return { itens, divergencias };
}

export function normalizarQuartos(props: unknown[]): { itens: QuartoBeds24[]; divergencias: Divergencia[] } {
  const itens: QuartoBeds24[] = [];
  const divergencias: Divergencia[] = [];
  for (const p of props) {
    if (!ehObj(p) || !id(p.id) || !Array.isArray(p.roomTypes)) {
      divergencias.push({ origem: "quarto", id: ehObj(p) ? texto(p.id) || "?" : "?", motivo: "imóvel sem quartos" });
      continue;
    }
    for (const q of p.roomTypes) {
      if (!ehObj(q) || !id(q.id)) {
        divergencias.push({ origem: "quarto", id: id(p.id), motivo: "quarto sem id" });
        continue;
      }
      itens.push({ propertyId: id(p.id), roomId: id(q.id), nome: texto(q.name || p.name).slice(0, 200) });
    }
  }
  return { itens, divergencias };
}
