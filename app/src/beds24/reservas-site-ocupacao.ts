/**
 * Reserva paga do site no Beds24 (M8.3c, desenho 4.1 a 4.4): quem ocupa as noites de uma reserva antes de criá-la ou de
 * mudar as datas dela, e as noites com overbooking depois de uma escrita. As regras são puras, sem banco e sem rede; só
 * `lerOcupantes` lê (o Beds24 pelo leitor injetado e o banco): as reservas do quarto que se sobrepõem às noites (com
 * `chegadaDe` explícito: sem ele, o Beds24 só devolve as futuras, e a estadia em curso sumiria), o calendário do quarto, as
 * noites que o M3.7 fechou (`beds24_calendario_enviado`) e os bloqueios `beds24` do SCL, e entrega à classificação. A
 * leitura incompleta nunca dá `livre`.
 */
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { beds24CalendarioEnviado, bloqueios } from "@/db/schema";
import type { Db } from "@/db/types";
import { somarDias } from "@/lib/datas";
import { dataValida } from "@/reservas/regras";
import { type BloqueioAchadoBeds24, origemPodeSerDoScl } from "./reservas-site-regras";
import { type DiaCalendario, ErroBeds24, type LeitorBeds24, type ReservaBeds24 } from "./tipos";

/** As noites `[chegada, saida)`, AAAA-MM-DD. Datas inválidas ou fora de ordem = nenhuma. */
export function noitesDe(chegada: string, saida: string): string[] {
  if (!dataValida(chegada) || !dataValida(saida) || chegada >= saida) return [];
  const noites: string[] = [];
  for (let d = chegada; d < saida; d = somarDias(d, 1)) noites.push(d);
  return noites;
}

/**
 * As noites que entram numa atualização (desenho 4.2: "as que entram e não estavam no Beds24"): as do pedido menos as do
 * registro RELIDO por id na fase 2 desta operação (a mesma leitura que confere a marca, a situação e o quarto). Nunca o
 * `esperado`, o pedido anterior nem o `lido` guardado: depois de uma `mudada_no_beds24` (a reserva tirada das noites A e posta
 * em B no Beds24), um "Reenviar" com essa base não conferiria as noites A, que ficaram livres e podem ter sido vendidas numa
 * OTA. `antes` null (sem registro relido) = todas as noites do pedido.
 */
export function noitesNovas(antes: { chegada: string; saida: string } | null, depois: { chegada: string; saida: string }): string[] {
  const ja = new Set(antes ? noitesDe(antes.chegada, antes.saida) : []);
  return noitesDe(depois.chegada, depois.saida).filter((n) => !ja.has(n));
}

/** O que a classificação recebe, já lido por quem chama (`lerOcupantes`). */
export type EntradaDosOcupantes = {
  /** A reserva do SCL: o quarto guardado (na criação, o do vínculo), a chegada e a saída do pedido. */
  alvo: { quarto: string; chegada: string; saida: string };
  /** As noites a conferir: na criação, todas (`noitesDe`); na atualização, só as novas (`noitesNovas`). */
  noites: readonly string[];
  /** As reservas do quarto que se sobrepõem às noites, de todas as situações (a classificação filtra). */
  reservas: readonly ReservaBeds24[];
  /** Os dias do calendário do quarto. */
  dias: readonly DiaCalendario[];
  /** As noites deste quarto que o M3.7 fechou com blackout (`beds24_calendario_enviado`, `bloqueio = 'blackout'`, o mesmo `room_id`). */
  blackoutsDoScl: ReadonlySet<string>;
  /** Os bloqueios `fonte = 'beds24'` do SCL no imóvel, `[inicio, fim)`. */
  bloqueiosDoBeds24NoScl: readonly BloqueioAchadoBeds24[];
  /** O id desta reserva no Beds24: na atualização, ela não ocupa as próprias noites. */
  idProprio: string | null;
  /**
   * O ocupante exato pode valer (desenho 3.8, item 5): a reserva tem uma `criar` com `enviado_em` e sem `beds24_id`, de
   * qualquer versão. Sem POST anterior, o registro igual é `noites_ocupadas`: uma reserva direta criada à mão pela equipe nunca
   * vira "incerta".
   */
  comPostAnterior: boolean;
};

/**
 * Quem ocupa as noites, na ordem da 4.1:
 * - `bloqueio_manual`: um `black`, um bloqueio `beds24` no SCL ou um blackout no calendário que o M3.7 não marcou como dele
 *   (a transição, 6.6), com as noites achadas;
 * - `bloqueio_do_scl`: o blackout do próprio M3.7 (um bloqueio do SCL sobre a reserva);
 * - `noites_ocupadas`: outra reserva (OTA ou direta), com os ids; salvo
 * - `ocupante_exato`: o único ocupante é um registro `confirmed` ou `new` no mesmo quarto, com a mesma chegada e a mesma
 *   saída, sem marca legível (nem a do ensaio: ele tem marca, só que outra), com a origem que pode ser a do SCL e com um POST
 *   anterior desta reserva (`comPostAnterior`);
 * - `sem_disponibilidade`: `livres` desconhecido ou menor que 1, sem ocupante;
 * - `livre`: nada.
 * `leitura_incompleta`: falta no calendário alguma noite a conferir, ou a mesma noite veio duas vezes diferente — nunca
 * `livre` (quem chama trata como falha antes do POST). A consulta e a cancelada não ocupam.
 */
export type OcupacaoDasNoites =
  | { resultado: "livre" }
  | { resultado: "bloqueio_manual"; bloqueio: BloqueioAchadoBeds24 }
  | { resultado: "bloqueio_do_scl"; bloqueio: BloqueioAchadoBeds24 }
  | { resultado: "noites_ocupadas"; ids: string[] }
  | { resultado: "ocupante_exato"; id: string }
  | { resultado: "sem_disponibilidade" }
  | { resultado: "leitura_incompleta" };

/** As noites `[inicio, fim)` que cobrem as achadas (da primeira à noite seguinte à última). */
const faixa = (noites: readonly string[]): BloqueioAchadoBeds24 => {
  const ordem = [...noites].sort();
  return { inicio: ordem[0], fim: somarDias(ordem[ordem.length - 1], 1) };
};

/** A situação que ocupa o quarto (desenho 4.1): todas menos a cancelada e a consulta (inquiry). */
const ocupa = (b: ReservaBeds24) => b.estado !== "cancelada" && b.estado !== "consulta";

export function classificarOcupantes(e: EntradaDosOcupantes): OcupacaoDasNoites {
  const noites = [...new Set(e.noites)].sort();
  if (!noites.length) return { resultado: "livre" };
  const porNoite = new Map<string, DiaCalendario>();
  for (const d of e.dias) {
    if (d.roomId !== e.alvo.quarto) continue;
    const antes = porNoite.get(d.data);
    if (antes && (antes.livres !== d.livres || antes.bloqueio !== d.bloqueio)) return { resultado: "leitura_incompleta" };
    porNoite.set(d.data, d);
  }
  if (noites.some((n) => !porNoite.has(n))) return { resultado: "leitura_incompleta" };

  const naNoite = (b: { checkin: string; checkout: string } | BloqueioAchadoBeds24, n: string) => ("checkin" in b ? b.checkin <= n && n < b.checkout : b.inicio <= n && n < b.fim);
  const ocupantes = e.reservas.filter((b) => b.roomId === e.alvo.quarto && b.idExterno !== e.idProprio && ocupa(b) && noites.some((n) => naNoite(b, n)));

  // 1. O bloqueio feito à mão: o `black`, o bloqueio do Beds24 importado no SCL e o blackout que o M3.7 não fechou.
  const manual = noites.filter(
    (n) => ocupantes.some((b) => b.estado === "bloqueio" && naNoite(b, n)) || e.bloqueiosDoBeds24NoScl.some((b) => naNoite(b, n)) || (porNoite.get(n)!.bloqueio === "blackout" && !e.blackoutsDoScl.has(n)),
  );
  if (manual.length) return { resultado: "bloqueio_manual", bloqueio: faixa(manual) };
  // 2. O blackout do próprio M3.7.
  const doScl = noites.filter((n) => porNoite.get(n)!.bloqueio === "blackout");
  if (doScl.length) return { resultado: "bloqueio_do_scl", bloqueio: faixa(doScl) };
  // 3. Outra reserva, salvo o ocupante exato (o único, e só com POST anterior).
  if (ocupantes.length) {
    const [b] = ocupantes;
    const exato = e.comPostAnterior && ocupantes.length === 1 && !b.ensaio && b.estado === "confirmada" && b.checkin === e.alvo.chegada && b.checkout === e.alvo.saida && b.referenciaScl === null && origemPodeSerDoScl(b);
    return exato ? { resultado: "ocupante_exato", id: b.idExterno } : { resultado: "noites_ocupadas", ids: [...new Set(ocupantes.map((x) => x.idExterno))].sort() };
  }
  // 4. Sem unidade livre (ou sem saber), sem ocupante: pode ser data sem preço (desenho 4.1, [I]).
  if (noites.some((n) => { const l = porNoite.get(n)!.livres; return l === null || l < 1; })) return { resultado: "sem_disponibilidade" };
  return { resultado: "livre" };
}

/**
 * As noites escritas com overbooking na releitura do calendário depois de uma escrita (desenho 4.4: `numAvail` "may be
 * negative… if a room is overbooked"): `livres < 0`. A nossa reserva está certa (o acompanhamento continua `conferida`, com
 * as marcas, e ganha o motivo `noites_ocupadas`); some quando uma releitura mostrar `livres >= 0`. A noite que não voltou na
 * leitura não conta como overbooking (nem como resolvida: quem chama confere `noitesSemLeitura`).
 */
export function noitesComOverbooking(dias: readonly DiaCalendario[], quarto: string, noites: readonly string[]): string[] {
  const alvo = new Set(noites);
  return [...new Set(dias.filter((d) => d.roomId === quarto && alvo.has(d.data) && d.livres !== null && d.livres < 0).map((d) => d.data))].sort();
}

/** As noites que a leitura do calendário não trouxe (a releitura não conclui nada sobre elas). */
export function noitesSemLeitura(dias: readonly DiaCalendario[], quarto: string, noites: readonly string[]): string[] {
  const lidas = new Set(dias.filter((d) => d.roomId === quarto).map((d) => d.data));
  return [...new Set(noites)].filter((n) => !lidas.has(n)).sort();
}

// ---------------------------------------------------------------- a leitura (desenho 4.1 e 4.2)

/** O que `lerOcupantes` confere: o imóvel do SCL (para os bloqueios e as noites do M3.7) e a entrada da classificação. */
export type AlvoDosOcupantes = Pick<EntradaDosOcupantes, "alvo" | "noites" | "idProprio" | "comPostAnterior"> & { imovelId: string };

/**
 * `funcionou: false` = não dá para concluir (alguma leitura falhou, trouxe registro em formato inválido ou o mesmo id duas
 * vezes, ou faltou no calendário uma noite a conferir): falha antes do POST, nunca `livre`. Com `funcionou`, a ocupação nunca
 * é `leitura_incompleta`, e `dias` é o calendário lido (a releitura do overbooking compara com ele). `status`: o HTTP da recusa
 * do Beds24 que derrubou a leitura (o 429, o 401 e o 403 param a volta do envio); sem ele, não houve resposta.
 */
export type LeituraDosOcupantes = { funcionou: true; ocupacao: Exclude<OcupacaoDasNoites, { resultado: "leitura_incompleta" }>; dias: DiaCalendario[] } | { funcionou: false; erro: string; status?: number };

const naoConclui = (erro: string, status?: number): LeituraDosOcupantes => ({ funcionou: false, erro, ...(status !== undefined ? { status } : {}) });

/**
 * Lê quem ocupa as noites (desenho 4.1), só leitura: (1) as reservas do quarto que se sobrepõem às noites, todas as
 * situações, com os info items (a chegada explícita desde 1900 e a saída depois da primeira noite: a estadia em curso entra);
 * (2) o calendário do quarto nas noites; (3) no banco, as noites que o M3.7 fechou com blackout neste quarto e os bloqueios
 * `beds24` do SCL no imóvel. Qualquer leitura com divergência ou id repetido, ou a noite que o calendário não trouxe, não
 * conclui (`normalizarCalendario` descarta a faixa inteira com um valor inválido, e a reserva de situação desconhecida vai
 * para as divergências: com as duas coisas juntas, a classificação diria "nada" sobre uma noite ocupada).
 */
export async function lerOcupantes(leitor: LeitorBeds24, db: Db, org: string, a: AlvoDosOcupantes): Promise<LeituraDosOcupantes> {
  const noites = [...new Set(a.noites)].sort();
  if (!noites.length) return { funcionou: true, ocupacao: { resultado: "livre" }, dias: [] };
  const inicio = noites[0];
  const fim = somarDias(noites[noites.length - 1], 1);
  let lidas: ReservaBeds24[];
  let dias: DiaCalendario[];
  try {
    const r = await leitor.reservas({ quarto: a.alvo.quarto, chegadaDe: "1900-01-01", chegadaAte: noites[noites.length - 1], saidaDe: somarDias(inicio, 1), incluirInfo: true });
    if (r.divergencias.length) return naoConclui("A leitura das reservas do quarto trouxe registro em formato inválido: a conferência das noites não conclui.");
    if (new Set(r.itens.map((b) => b.idExterno)).size !== r.itens.length) return naoConclui("A leitura das reservas do quarto trouxe o mesmo registro duas vezes: a conferência das noites não conclui.");
    const c = await leitor.calendario({ roomIds: [a.alvo.quarto], inicio, fim });
    if (c.divergencias.length) return naoConclui("O calendário do quarto voltou em formato inválido: a conferência das noites não conclui.");
    lidas = r.itens;
    dias = c.itens;
  } catch (e) {
    return e instanceof ErroBeds24 ? naoConclui(e.message, e.status) : naoConclui("Não foi possível ler o Beds24.");
  }
  const doScl = await db
    .select({ data: beds24CalendarioEnviado.data })
    .from(beds24CalendarioEnviado)
    .where(and(eq(beds24CalendarioEnviado.organizacaoId, org), eq(beds24CalendarioEnviado.imovelId, a.imovelId), eq(beds24CalendarioEnviado.roomId, a.alvo.quarto), eq(beds24CalendarioEnviado.bloqueio, "blackout"), inArray(beds24CalendarioEnviado.data, noites)));
  const doBeds24 = await db
    .select({ inicio: bloqueios.inicio, fim: bloqueios.fim })
    .from(bloqueios)
    .where(and(eq(bloqueios.organizacaoId, org), eq(bloqueios.imovelId, a.imovelId), eq(bloqueios.fonte, "beds24"), lt(bloqueios.inicio, fim), gt(bloqueios.fim, inicio)));
  const ocupacao = classificarOcupantes({ alvo: a.alvo, noites, reservas: lidas, dias, blackoutsDoScl: new Set(doScl.map((d) => d.data)), bloqueiosDoBeds24NoScl: doBeds24, idProprio: a.idProprio, comPostAnterior: a.comPostAnterior });
  if (ocupacao.resultado === "leitura_incompleta") return naoConclui("O calendário do quarto não trouxe todas as noites (ou trouxe a mesma noite diferente): a conferência das noites não conclui.");
  return { funcionou: true, ocupacao, dias };
}
