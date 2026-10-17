/**
 * Normalização estrita das respostas do Beds24 → tipos internos. Qualquer coisa fora do
 * esperado vira divergência (nunca um dado "chutado"). Formato conferido contra a
 * documentação pública da API v2; confirmar com a conta real antes de sincronizar (M3.3).
 * M8.3c: também o caminho de volta da escrita de reservas, num lugar só para o HTTP e o falso —
 * o corpo de `POST /bookings` (`corpoDaGravacaoReserva`) e a classificação da resposta
 * (`classificarGravacaoReserva`).
 */
import { uuidValido } from "@/lib/ids";
import { codigosDeReservaNoTexto, dataValida, ehCodigoDeReserva } from "@/reservas/regras";
import {
  BLOQUEIOS_BEDS24, type CanalBeds24, type CredencialBeds24, type DiaCalendario, type Divergencia, ErroBeds24, type EstadoBeds24, type ItemGravacaoReserva,
  type ObservadoNaGravacao, type QuartoBeds24, type RespostaBeds24, type RespostaGravacaoReserva, type ReservaBeds24, TEXTOS_DE_ERRO_BEDS24,
} from "./tipos";

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

/**
 * Info items bem formados ({ code, text } em texto). Lista ausente ou torta conta como sem info items, nunca como divergência.
 * M8.3c (desenho 5.2): o info item `SCL` com o texto que não é texto (ausente, null, número) fica, com o texto vazio — a
 * marca está lá e não dá para ler (`marcaAmbigua`); descartá-lo em silêncio faria valer o código do nome ou das notas.
 */
function infoItems(v: unknown): { code: string; text: string }[] {
  if (!Array.isArray(v)) return [];
  return v.filter(ehObj).flatMap((i) => {
    if (typeof i.code !== "string") return [];
    const code = i.code.trim().toUpperCase();
    if (typeof i.text === "string") return [{ code, text: i.text.trim() }];
    return code === INFO_MARCA_SCL ? [{ code, text: "" }] : [];
  });
}

type MarcaLida = Pick<ReservaBeds24, "referenciaScl" | "marcaFonte" | "marcaAmbigua">;

/**
 * Marca do SCL num registro (M8.3, desenho 3.5): o info item `SCL` com um código válido; sem ele, como reforço, o código
 * solto no nome ou nas notas. Mais de um código diferente na mesma fonte = sem referência: nunca escolhe um dos códigos.
 * M8.3c (desenho 5.2): esse caso, e o info item `SCL` com um texto que não é um código válido (ou sem texto), ficam
 * separados de "sem marca" como `marcaAmbigua`, para desviar com aviso. O info item vale antes do texto: com ele, o código
 * no nome ou nas notas não conta.
 */
function marcaDoScl(b: Obj, itens: { code: string; text: string }[]): MarcaLida {
  const doInfo = itens.filter((i) => i.code === INFO_MARCA_SCL).map((i) => i.text);
  if (doInfo.length) {
    const distintos = [...new Set(doInfo)];
    return distintos.length === 1 && ehCodigoDeReserva(distintos[0])
      ? { referenciaScl: distintos[0], marcaFonte: "info", marcaAmbigua: false }
      : { referenciaScl: null, marcaFonte: null, marcaAmbigua: true };
  }
  const reforco = codigosDeReservaNoTexto([texto(b.firstName), texto(b.lastName), texto(b.notes)].join(" "));
  if (reforco.length === 1) return { referenciaScl: reforco[0], marcaFonte: "texto", marcaAmbigua: false };
  return { referenciaScl: null, marcaFonte: null, marcaAmbigua: reforco.length > 1 };
}

/** O id da operação do ensaio no info item `SCL-ENSAIO` (M8.3c): um uuid só; outro texto, ou dois ids diferentes, = null. */
function ensaioOperacaoId(itens: { code: string; text: string }[]): string | null {
  const ids = [...new Set(itens.filter((i) => i.code === INFO_ENSAIO_SCL).map((i) => i.text.toLowerCase()))];
  return ids.length === 1 && uuidValido(ids[0]) ? ids[0] : null;
}

/** `apiSource` (M8.3c): curto e só com caracteres seguros; fora disso, null (nunca um texto livre do Beds24 guardado). */
const origemApi = (v: unknown) => {
  const t = texto(v);
  return /^[A-Za-z0-9 ._:/-]{1,40}$/.test(t) ? t : null;
};

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
      ...marcaDoScl(b, itens),
      ensaio: itens.some((i) => i.code === INFO_ENSAIO_SCL),
      ensaioOperacaoId: ensaioOperacaoId(itens),
      origemApi: origemApi(b.apiSource),
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
      // M8.3c: `numAvail` negativo é o overbooking ("may be negative… if a room is overbooked", desenho 4.4), não um valor
      // inválido: vem como está e conta como noite fechada (`fechadaNaLeitura`). Antes, a faixa inteira virava divergência.
      const inteiroComSinal = (x: number | null) => x === null || (Number.isInteger(x) && Math.abs(x) <= 2_147_483_647);
      if (preco === undefined || !inteiroNaoNegativo(preco) || !inteiroComSinal(livres) || !inteiroNaoNegativo(minimo) || !inteiroNaoNegativo(maximo) || (bloqueio !== null && !OVERRIDES.has(bloqueio))) {
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

// ---------------------------------------------------------------- escrita de reservas (M8.3c, desenho 3.7 e 3.8)

/** Os dois nomes do cabeçalho de crédito restante: a wiki e a especificação divergem (desenho 9; item 11 a confirmar). */
export const CABECALHOS_CREDITO_BEDS24 = ["x-five-min-limit-remaining", "x-fivemincreditlimit-remaining"] as const;

/** Id de reserva e de quarto do Beds24: só dígitos (os ids são números na API). */
const ID_NUMERICO = /^\d{1,15}$/;

/**
 * O corpo de `POST /bookings` para um item (desenho 3.7): uma lista com um item só, com quarto, datas, pessoas, situação e
 * a marca — nunca nome, e-mail, telefone, `notes`, `price`, `deposit`, `invoiceItems` nem `commission` (D1 e D2). As duas
 * notificações vão sempre `false`, explícitas (o padrão não está documentado). Item fora do formato lança
 * (`configuracao`) antes de qualquer rede: nada sai com um dado que não passou na validação.
 */
export function corpoDaGravacaoReserva(item: ItemGravacaoReserva): Obj[] {
  const recusar = (motivo: string): never => {
    throw new ErroBeds24(`Pedido de reserva ao Beds24 inválido (${motivo}): nada foi enviado.`, "configuracao");
  };
  const id = (v: string) => (ID_NUMERICO.test(v) && Number(v) > 0 ? Number(v) : recusar("id"));
  const datas = (chegada: string, saida: string) => (dataValida(chegada) && dataValida(saida) && chegada < saida ? { arrival: chegada, departure: saida } : recusar("datas"));
  const pessoas = (n: number) => (Number.isInteger(n) && n >= 1 && n <= 99 ? n : recusar("pessoas"));
  switch (item.tipo) {
    case "criar": {
      const marca = item.marca.tipo === "reserva"
        ? (ehCodigoDeReserva(item.marca.codigo) ? { code: INFO_MARCA_SCL, text: item.marca.codigo } : recusar("marca"))
        : (uuidValido(item.marca.operacaoId) ? { code: INFO_ENSAIO_SCL, text: item.marca.operacaoId.toLowerCase() } : recusar("marca"));
      return [{
        roomId: id(item.quarto), ...datas(item.chegada, item.saida), status: "confirmed", numAdult: pessoas(item.hospedes), numChild: 0,
        infoItems: [marca], actions: { checkAvailability: true, notifyGuest: false, notifyHost: false },
      }];
    }
    // Nunca troca o quarto: só as datas e as pessoas.
    case "atualizar":
      return [{ id: id(item.id), ...datas(item.chegada, item.saida), numAdult: pessoas(item.hospedes) }];
    // Nunca DELETE: "Deleted bookings can not be updated" (desenho 3.7).
    case "cancelar":
      return [{ id: id(item.id), status: "cancelled" }];
    default:
      return recusar("tipo");
  }
}

/** A resposta já classificada, com o `erro` fixo do código (nunca o texto do Beds24). */
export function respostaDaGravacao(
  resposta: RespostaBeds24,
  o: { beds24Id?: string | null; http?: number | null; creditoRestante?: number | null; observado?: ObservadoNaGravacao } = {},
): RespostaGravacaoReserva {
  return { resposta, beds24Id: o.beds24Id ?? null, http: o.http ?? null, erro: TEXTOS_DE_ERRO_BEDS24[resposta], creditoRestante: o.creditoRestante ?? null, ...(o.observado ? { observado: o.observado } : {}) };
}

/** Crédito restante dos cabeçalhos (os dois nomes; com os dois, o menor). Sem nenhum legível, null: desconhecido. */
export function creditoRestanteBeds24(cabecalhos: Headers): number | null {
  const valores = CABECALHOS_CREDITO_BEDS24.map((n) => cabecalhos.get(n)?.trim() ?? "").filter((t) => /^-?\d{1,9}$/.test(t)).map(Number);
  return valores.length ? Math.min(...valores) : null;
}

/** Só os nomes (nunca os valores) dos cabeçalhos que parecem de crédito ou limite, para o ensaio registrar (item 11). */
const nomesDeCredito = (cabecalhos: Headers) => [...cabecalhos.keys()].filter((n) => /credit|limit/i.test(n) && /^[a-z0-9-]{1,60}$/.test(n)).slice(0, 10);

/**
 * O id da reserva criada dentro de `new` (desenho 3.8; a chave está "a confirmar", item 1): `id`, `bookId` ou
 * `bookingId`, ou o próprio `new` quando é o número. Só dígitos, sem zero; senão, null (a criação fica sem a prova).
 */
function idDaCriada(novo: unknown): { id: string; chave: string } | null {
  const ler = (v: unknown) => {
    const t = texto(v);
    const n = Number(t);
    return ID_NUMERICO.test(t) && Number.isSafeInteger(n) && n > 0 ? String(n) : null;
  };
  if (!ehObj(novo)) {
    const id = ler(novo);
    return id ? { id, chave: "new" } : null;
  }
  for (const chave of ["id", "bookId", "bookingId"]) {
    const id = ler(novo[chave]);
    if (id) return { id, chave };
  }
  return null;
}

/** A recusa por disponibilidade: a mensagem só é lida aqui (o formato está "a confirmar", item 2) e nunca guardada. */
const recusaDeDisponibilidade = (erros: unknown[]) => erros.some((e) => ehObj(e) && typeof e.message === "string" && /availab|disponib/i.test(e.message));

/**
 * A resposta de `POST /bookings` (desenho 3.8) → a classificação de um item, a mesma no HTTP e no falso. Entra a última
 * resposta (depois da renovação do 401, se houve), com o corpo já lido como JSON (`json` null = não é JSON). Os desfechos
 * sem resposta (rede, tempo, o token que não veio) são classificados por quem chama.
 * - 401 e 403: o pedido não foi processado; 429 sem a lista de itens: `limite`; outro 4xx: `http_4xx`; 5xx: `http_5xx`;
 * - 2xx (e o 429 com a lista) pelo item: `success: false` ou `errors` = recusa; `success: true` = sucesso — no 429, sempre
 *   duvidoso (`sem_id`); na criação, só com id legível em `new`; o que não for nem um nem outro = `formato`.
 */
export function classificarGravacaoReserva(item: ItemGravacaoReserva, cru: { status: number; json: { valor: unknown } | null; cabecalhos: Headers }): RespostaGravacaoReserva {
  const creditoRestante = creditoRestanteBeds24(cru.cabecalhos);
  const cabecalhosDeCredito = nomesDeCredito(cru.cabecalhos);
  const fim = (resposta: RespostaBeds24, beds24Id: string | null = null, chaveDoId: string | null = null, chavesEmNew: string[] = []) =>
    respostaDaGravacao(resposta, { beds24Id, http: cru.status, creditoRestante, observado: { chaveDoId, chavesEmNew, cabecalhosDeCredito } });
  const s = cru.status;
  const lista = cru.json && Array.isArray(cru.json.valor) ? cru.json.valor : null;
  const r = lista?.[0];
  if (s === 401) return fim("http_401");
  if (s === 403) return fim("http_403");
  if (s === 429 && !ehObj(r)) return fim("limite");
  if (s >= 400 && s < 500 && s !== 429) return fim("http_4xx");
  if (s >= 500 && s < 600) return fim("http_5xx");
  if ((s < 200 || s >= 300) && s !== 429) return fim("formato");
  if (!ehObj(r)) return fim("formato");
  const erros = Array.isArray(r.errors) ? r.errors : [];
  if (r.success === false || erros.length) return fim(recusaDeDisponibilidade(erros) ? "recusada_disponibilidade" : "recusada");
  if (r.success !== true) return fim("formato");
  // Só nomes de chave seguros, para o ensaio registrar onde o id veio (item 1).
  const chavesEmNew = ehObj(r.new) ? Object.keys(r.new).filter((k) => /^[A-Za-z0-9_]{1,40}$/.test(k)).slice(0, 20) : [];
  if (s === 429) return fim("sem_id", null, null, chavesEmNew);
  if (item.tipo !== "criar") return fim("modificada", String(Number(item.id)));
  const novo = idDaCriada(r.new);
  return novo ? fim("criada", novo.id, novo.chave, chavesEmNew) : fim("sem_id", null, null, chavesEmNew);
}
