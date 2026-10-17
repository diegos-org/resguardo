/**
 * Normalização estrita das respostas do Beds24 → tipos internos. Qualquer coisa fora do
 * esperado vira divergência (nunca um dado "chutado"). Formato conferido contra a
 * documentação pública da API v2; confirmar com a conta real antes de sincronizar (M3.3).
 */
import { codigosDeReservaNoTexto, dataValida, ehCodigoDeReserva } from "@/reservas/regras";
import { BLOQUEIOS_BEDS24, type CanalBeds24, type CredencialBeds24, type DiaCalendario, type Divergencia, type EstadoBeds24, type QuartoBeds24, type ReservaBeds24 } from "./tipos";

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
  request: "pedido",
  inquiry: "consulta",
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

/** API v2 bookingTime é ISO com fuso explícito. Ausência/formato inválido = desconhecido. */
export function instanteDaReserva(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !dataValida(v.slice(0, 10))) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Código do info item com a marca do SCL (M8.3): o texto é o código da reserva (SCL-XXXXXX). */
export const INFO_MARCA_SCL = "SCL";
/** Código do info item do ensaio do SCL (M8.3): o texto é o id da operação do ensaio. */
export const INFO_ENSAIO_SCL = "SCL-ENSAIO";

/** Info items bem formados ({ code, text } em texto). Lista ausente ou torta conta como sem info items, nunca como divergência. */
function infoItems(v: unknown): { code: string; text: string }[] {
  if (!Array.isArray(v)) return [];
  return v.filter(ehObj).flatMap((i) => (typeof i.code === "string" && typeof i.text === "string" ? [{ code: i.code.trim().toUpperCase(), text: i.text.trim() }] : []));
}

/**
 * Marca do SCL num registro (M8.3, desenho 3.5): o info item `SCL` com um código válido; sem ele, como reforço, o código
 * solto no nome ou nas notas. Mais de um código diferente na mesma fonte = null, como sem marca: nunca escolhe um dos
 * códigos. Separar "ambígua" de "sem marca", para desviar o ambíguo com aviso, fica para o M8.3c (desenho 5.2).
 */
function marcaDoScl(b: Obj, itens: { code: string; text: string }[]): string | null {
  const unico = (xs: string[]) => {
    const distintos = [...new Set(xs)];
    return distintos.length === 1 ? distintos[0] : distintos.length > 1 ? null : undefined;
  };
  const doInfo = unico(itens.filter((i) => i.code === INFO_MARCA_SCL && ehCodigoDeReserva(i.text)).map((i) => i.text));
  if (doInfo !== undefined) return doInfo;
  const reforco = unico(codigosDeReservaNoTexto([texto(b.firstName), texto(b.lastName), texto(b.notes)].join(" ")));
  return reforco ?? null;
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
  const itens = infoItems(b.infoItems);
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
      reservadaEm: instanteDaReserva(b.bookingTime),
      referenciaScl: marcaDoScl(b, itens),
      ensaio: itens.some((i) => i.code === INFO_ENSAIO_SCL),
    },
  };
}

/** Escopo no formato "nível:recurso" (ex.: "read:bookings", "write:bookings-personal", "all:inventory"). */
const ESCOPO = /^(read|write|delete|all):[a-z][a-z0-9-]{0,40}$/;
/** Um item fora do formato, só para mostrar: texto visível, curto. */
const amostra = (v: unknown) => (typeof v === "string" ? v.replace(/[^\x20-\x7E]/g, "?").slice(0, 60) || "(vazio)" : "(não é texto)");

/**
 * GET /authentication/details → escopos da credencial (M8.3, prontidão). O formato está "a confirmar": a lista é lida em
 * `token.scopes` (ou `scopes`); `validToken` presente e diferente do booleano `true` (`false`, `"false"`, `"true"`, `1`,
 * `null`), corpo torto ou lista ausente = null (não deu para ler). Item fora do formato conhecido vai para `ilegiveis` —
 * nunca é descartado em silêncio, para não parecer em ordem.
 */
export function normalizarCredencial(corpo: unknown): Omit<CredencialBeds24, "lidoEm"> {
  if (!ehObj(corpo) || ("validToken" in corpo && corpo.validToken !== true)) return { escopos: null, ilegiveis: [] };
  const lista = ehObj(corpo.token) && corpo.token.scopes !== undefined ? corpo.token.scopes : corpo.scopes;
  if (!Array.isArray(lista)) return { escopos: null, ilegiveis: [] };
  const escopos: string[] = [];
  const ilegiveis: string[] = [];
  for (const item of lista) {
    const t = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (ESCOPO.test(t)) {
      if (!escopos.includes(t)) escopos.push(t);
    } else ilegiveis.push(amostra(item));
  }
  return { escopos, ilegiveis };
}

const OVERRIDES = new Set<string>(BLOQUEIOS_BEDS24);

/** Calendário: `data` = [{ roomId, calendar: [{ from, to, numAvail, price1, minStay, maxStay, override }] }]. */
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
      const maximo = faixa.maxStay === undefined || faixa.maxStay === null ? null : Number(faixa.maxStay);
      const bloqueio = faixa.override === undefined || faixa.override === null ? null : texto(faixa.override);
      const inteiroNaoNegativo = (x: number | null) => x === null || (Number.isInteger(x) && x >= 0 && x <= 2_147_483_647);
      if (preco === undefined || !inteiroNaoNegativo(preco) || !inteiroNaoNegativo(livres) || !inteiroNaoNegativo(minimo) || !inteiroNaoNegativo(maximo) || (bloqueio !== null && !OVERRIDES.has(bloqueio))) {
        divergencias.push({ origem: "calendario", id: roomId, motivo: "valores inválidos" });
        continue;
      }
      // Faixa inclusiva [from, to]: expande em dias, recortando ao período pedido [inicio, fim).
      // Recorta antes de expandir: uma faixa absurda não pode monopolizar o processo.
      const de = texto(faixa.from) < inicio ? inicio : texto(faixa.from);
      const ate = texto(faixa.to ?? faixa.from) > fim ? fim : texto(faixa.to ?? faixa.from);
      for (let t = Date.parse(`${de}T00:00:00Z`); t <= Date.parse(`${ate}T00:00:00Z`); t += 86_400_000) {
        const data = new Date(t).toISOString().slice(0, 10);
        if (data >= inicio && data < fim) itens.push({ roomId, data, livres, preco, minimoNoites: minimo, maximoNoites: maximo, bloqueio });
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
      itens.push({ propertyId: id(p.id), roomId: id(q.id), nome: texto(q.name || p.name).slice(0, 200), ...(p.currency ? { moeda: texto(p.currency).toUpperCase() } : {}) });
    }
  }
  return { itens, divergencias };
}

