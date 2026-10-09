/**
 * Regras operacionais de calendário e preços (M3.7), editáveis em Configurações →
 * Calendário e preços. Uma regra, um lugar: o motor (`motor.ts`), a prévia e o envio ao
 * Beds24 leem daqui. Os valores vêm de `requisitos/operations/CALENDARIO-PRECOS-OPERACAO.md`
 * como padrão inicial; o que depende de decisão do Diego (feriados, eventos, imóveis
 * com envio ligado) começa vazio — o sistema avisa em vez de supor.
 */
import { randomUUID } from "node:crypto";
import { gravarConfig, lerConfig, travarConfig } from "@/configuracoes/armazem";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { dataValida } from "@/reservas/regras";

export type Feriado = { data: string; nome: string };
/**
 * `multiplicador` em centésimos: 200 = 2× o preço base. `minimoNormalComReserva` (regra de 6/10): com uma
 * reserva confirmada no período do evento, as noites livres dele usam o mínimo normal da semana em vez do
 * mínimo do evento (o preço do evento continua). Desligado para temporadas longas, como a alta temporada.
 */
export type Evento = { id: string; nome: string; inicio: string; fim: string; multiplicador: number; estadiaMinima: number | null; minimoNormalComReserva: boolean; todosImoveis: boolean; imoveis: string[] };
export type FaixaUltimaHora = { deDias: number; ateDias: number; percentual: number };
/** Quem aplica o desconto de última hora: as regras nativas do Beds24 (já configuradas), o SCL (envia o preço final) ou ninguém. */
export type AplicacaoUltimaHora = "beds24" | "scl" | "desligada";
export const APLICACOES_ULTIMA_HORA: Record<AplicacaoUltimaHora, string> = {
  beds24: "Beds24 aplica (regras nativas de preço); o SCL envia a referência e protege o piso",
  scl: "SCL aplica e envia o preço final (as regras nativas do Beds24 precisam estar desligadas)",
  desligada: "Sem desconto de última hora pelo SCL",
};

export type RegrasCalendario = {
  /** Estadia mínima por dia da semana da entrada (0 = domingo … 6 = sábado). */
  minimoPorDia: number[];
  /** Máximo de noites quando o imóvel não tem o próprio. */
  estadiaMaxima: number;
  /** Quantas noites, a partir de hoje, o envio cobre. */
  horizonteDias: number;
  feriados: Feriado[];
  /** `minimoNormalComReserva`: a mesma regra de 6/10 dos eventos, para a janela de cada feriadão. */
  janelaFeriado: { estadiaMinima: number; multiplicador: number; minimoNormalComReserva: boolean; todosImoveis: boolean; imoveis: string[] };
  eventos: Evento[];
  ultimaHora: { aplicadoPor: AplicacaoUltimaHora; faixas: [FaixaUltimaHora, FaixaUltimaHora] };
  envio: { imoveis: string[]; automatico: boolean };
  /**
   * Site público (M7.2/M8.1): por quantas horas uma leitura do Beds24 vale como disponibilidade; máximo de
   * noites cotadas online; por quantos minutos "segurar as datas" ocupa o calendário antes de vencer.
   */
  site: { validadeLeituraHoras: number; maximoNoitesConsulta: number; minutosHold: number };
};

export const REGRAS_CALENDARIO_PADRAO: RegrasCalendario = {
  minimoPorDia: [1, 1, 1, 1, 1, 2, 2],
  estadiaMaxima: 27,
  horizonteDias: 270,
  feriados: [],
  janelaFeriado: { estadiaMinima: 3, multiplicador: 200, minimoNormalComReserva: true, todosImoveis: false, imoveis: [] },
  eventos: [],
  ultimaHora: { aplicadoPor: "beds24", faixas: [{ deDias: 3, ateDias: 7, percentual: 15 }, { deDias: 0, ateDias: 2, percentual: 25 }] },
  envio: { imoveis: [], automatico: false },
  site: { validadeLeituraHoras: 36, maximoNoitesConsulta: 90, minutosHold: 30 },
};

const LIMITES = { minimo: [1, 30], estadiaMaxima: [1, 364], horizonte: [7, 540], multiplicador: [100, 1000], percentual: [0, 90], dias: [0, 60], feriados: 200, eventos: 100, validadeHoras: [1, 720], noitesConsulta: [1, 364], minutosHold: [5, 240] } as const;

type Entrada = Record<string, unknown>;
const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const lista = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined || v === "" ? [] : [v]).filter((x): x is string => typeof x === "string");
const marcado = (v: unknown) => v === "on" || v === "true" || v === true;
const inteiroEntre = (v: unknown, [min, max]: readonly [number, number]) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const ids = (v: unknown, validos?: readonly string[]) => [...new Set(lista(v).filter((x) => uuidValido(x) && (!validos || validos.includes(x))))];

/** "2", "2,5", "2.50" → centésimos (200, 250). Inválido → undefined. */
export function multiplicadorParaCentesimos(texto: string): number | undefined {
  const t = texto.trim().replace(",", ".").replace(/[x×]$/i, "").trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return undefined;
  const c = Math.round(Number(t) * 100);
  return inteiroEntre(c, LIMITES.multiplicador) ? c : undefined;
}
export const centesimosParaMultiplicador = (c: number) => (c / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** "DD/MM/AAAA" ou "AAAA-MM-DD" → ISO; inválida → null. */
export function lerData(texto: string): string | null {
  const t = texto.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : t;
  return dataValida(iso) ? iso : null;
}
export const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/** Par de faixas só vale com a 2ª mais perto da data que a 1ª; senão volta ao padrão (nunca troca pisos em silêncio). */
function sanearFaixas(f: [FaixaUltimaHora, FaixaUltimaHora], padrao: [FaixaUltimaHora, FaixaUltimaHora]): [FaixaUltimaHora, FaixaUltimaHora] {
  return f[1].ateDias < f[0].deDias ? f : [{ ...padrao[0] }, { ...padrao[1] }];
}
function sanearFaixa(v: unknown, padrao: FaixaUltimaHora): FaixaUltimaHora {
  const f = v as Partial<FaixaUltimaHora> | null;
  const ok = f && inteiroEntre(f.deDias, LIMITES.dias) && inteiroEntre(f.ateDias, LIMITES.dias) && inteiroEntre(f.percentual, LIMITES.percentual) && f.deDias! <= f.ateDias!;
  return ok ? { deDias: f.deDias!, ateDias: f.ateDias!, percentual: f.percentual! } : padrao;
}

/** Lê o JSON gravado tolerando campos ausentes/inválidos (voltam ao padrão), sem nunca inventar feriados ou eventos. */
export function regrasDeJson(valor: unknown): RegrasCalendario {
  const c = (valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {}) as Record<string, unknown>;
  const P = REGRAS_CALENDARIO_PADRAO;
  const minimos = Array.isArray(c.minimoPorDia) && c.minimoPorDia.length === 7 && c.minimoPorDia.every((n) => inteiroEntre(n, LIMITES.minimo)) ? (c.minimoPorDia as number[]) : P.minimoPorDia;
  const jf = (c.janelaFeriado ?? {}) as Record<string, unknown>;
  const uh = (c.ultimaHora ?? {}) as Record<string, unknown>;
  const faixas = Array.isArray(uh.faixas) ? uh.faixas : [];
  const env = (c.envio ?? {}) as Record<string, unknown>;
  const site = (c.site ?? {}) as Record<string, unknown>;
  const feriados: Feriado[] = [];
  for (const f of Array.isArray(c.feriados) ? c.feriados : []) {
    const o = f as Partial<Feriado> | null;
    if (o && typeof o.data === "string" && dataValida(o.data) && !feriados.some((x) => x.data === o.data)) feriados.push({ data: o.data, nome: txt(o.nome).slice(0, 60) });
  }
  const eventos: Evento[] = [];
  for (const e of Array.isArray(c.eventos) ? c.eventos : []) {
    const o = e as Partial<Evento> | null;
    if (!o || !uuidValido(o.id) || typeof o.inicio !== "string" || typeof o.fim !== "string" || !dataValida(o.inicio) || !dataValida(o.fim) || o.fim < o.inicio) continue;
    if (!inteiroEntre(o.multiplicador, LIMITES.multiplicador)) continue;
    eventos.push({
      id: o.id!, nome: txt(o.nome).slice(0, 60) || "Evento", inicio: o.inicio, fim: o.fim, multiplicador: o.multiplicador!,
      estadiaMinima: inteiroEntre(o.estadiaMinima, LIMITES.minimo) ? (o.estadiaMinima as number) : null,
      // Gravado antes da regra de 6/10: vale a regra (ligada); só um "false" gravado desliga.
      minimoNormalComReserva: o.minimoNormalComReserva !== false,
      todosImoveis: o.todosImoveis === true, imoveis: ids(o.imoveis),
    });
  }
  return {
    minimoPorDia: [...minimos],
    estadiaMaxima: inteiroEntre(c.estadiaMaxima, LIMITES.estadiaMaxima) ? (c.estadiaMaxima as number) : P.estadiaMaxima,
    horizonteDias: inteiroEntre(c.horizonteDias, LIMITES.horizonte) ? (c.horizonteDias as number) : P.horizonteDias,
    feriados: feriados.sort((a, b) => a.data.localeCompare(b.data)).slice(0, LIMITES.feriados),
    janelaFeriado: {
      estadiaMinima: inteiroEntre(jf.estadiaMinima, LIMITES.minimo) ? (jf.estadiaMinima as number) : P.janelaFeriado.estadiaMinima,
      multiplicador: inteiroEntre(jf.multiplicador, LIMITES.multiplicador) ? (jf.multiplicador as number) : P.janelaFeriado.multiplicador,
      minimoNormalComReserva: jf.minimoNormalComReserva !== false,
      todosImoveis: jf.todosImoveis === true,
      imoveis: ids(jf.imoveis),
    },
    eventos: eventos.sort((a, b) => a.inicio.localeCompare(b.inicio)).slice(0, LIMITES.eventos),
    ultimaHora: {
      aplicadoPor: uh.aplicadoPor === "scl" || uh.aplicadoPor === "desligada" ? uh.aplicadoPor : "beds24",
      faixas: sanearFaixas([sanearFaixa(faixas[0], P.ultimaHora.faixas[0]), sanearFaixa(faixas[1], P.ultimaHora.faixas[1])], P.ultimaHora.faixas),
    },
    envio: { imoveis: ids(env.imoveis), automatico: env.automatico === true },
    site: {
      validadeLeituraHoras: inteiroEntre(site.validadeLeituraHoras, LIMITES.validadeHoras) ? (site.validadeLeituraHoras as number) : P.site.validadeLeituraHoras,
      maximoNoitesConsulta: inteiroEntre(site.maximoNoitesConsulta, LIMITES.noitesConsulta) ? (site.maximoNoitesConsulta as number) : P.site.maximoNoitesConsulta,
      minutosHold: inteiroEntre(site.minutosHold, LIMITES.minutosHold) ? (site.minutosHold as number) : P.site.minutosHold,
    },
  };
}

export async function lerRegrasCalendario(db: Db, organizacaoId: string): Promise<RegrasCalendario> {
  return regrasDeJson(await lerConfig(db, organizacaoId, "calendario_regras"));
}

export type ErrosRegrasCalendario = Record<string, string>;

/**
 * Formulário geral (tudo menos os eventos, que têm ações próprias). `imoveisDaOrg` limita
 * as seleções aos imóveis desta empresa; os eventos atuais são preservados.
 */
export function validarFormRegras(e: Entrada, atual: RegrasCalendario, imoveisDaOrg: readonly string[]): { ok: true; regras: RegrasCalendario } | { ok: false; erros: ErrosRegrasCalendario } {
  const erros: ErrosRegrasCalendario = {};
  const inteiro = (campo: string, [min, max]: readonly [number, number]): number => {
    const v = txt(e[campo]);
    if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
      erros[campo] = `Número inteiro entre ${min} e ${max}.`;
      return min;
    }
    return Number(v);
  };
  const minimoPorDia = Array.from({ length: 7 }, (_, d) => inteiro(`minimo_${d}`, LIMITES.minimo));
  const estadiaMaxima = inteiro("estadiaMaxima", LIMITES.estadiaMaxima);
  const horizonteDias = inteiro("horizonteDias", LIMITES.horizonte);
  const feriados: Feriado[] = [];
  const linhas = txt(e.feriados).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (linhas.length > LIMITES.feriados) erros.feriados = `No máximo ${LIMITES.feriados} feriados.`;
  for (const l of linhas) {
    const [dataTexto, ...resto] = l.split(/\s+/);
    const data = lerData(dataTexto);
    const nome = resto.join(" ").slice(0, 60);
    if (!data) { erros.feriados = `Linha "${l.slice(0, 40)}": use DD/MM/AAAA seguido do nome.`; continue; }
    if (!feriados.some((f) => f.data === data)) feriados.push({ data, nome });
  }
  const multiplicador = multiplicadorParaCentesimos(txt(e.feriadoMultiplicador));
  if (multiplicador === undefined) erros.feriadoMultiplicador = "Multiplicador entre 1 e 10 (ex.: 2 ou 2,5).";
  const faixa = (n: 1 | 2): FaixaUltimaHora => {
    const f = { deDias: inteiro(`faixa${n}De`, LIMITES.dias), ateDias: inteiro(`faixa${n}Ate`, LIMITES.dias), percentual: inteiro(`faixa${n}Pct`, LIMITES.percentual) };
    if (f.deDias > f.ateDias) erros[`faixa${n}Ate`] = "O fim da faixa não pode ser antes do início.";
    return f;
  };
  const faixas: [FaixaUltimaHora, FaixaUltimaHora] = [faixa(1), faixa(2)];
  // A faixa 2 é a mais próxima da data (o 2º piso da ficha do imóvel é o "mais perto da data"): precisa terminar
  // antes do início da faixa 1. Ordem trocada ou cruzamento trocaria os pisos em silêncio.
  if (!erros.faixa1Ate && !erros.faixa2Ate && faixas[1].ateDias >= faixas[0].deDias) erros.faixa2Ate = "A 2ª faixa é a mais próxima da data: precisa terminar antes do início da 1ª (ex.: 1ª de 3 a 7 dias, 2ª de 0 a 2).";
  const aplicadoPor = txt(e.ultimaHoraModo);
  if (!(aplicadoPor in APLICACOES_ULTIMA_HORA)) erros.ultimaHoraModo = "Escolha quem aplica a última hora.";
  // Todo campo numérico é lido antes da checagem de erros: nenhum volta ao padrão em silêncio.
  const feriadoMinimo = inteiro("feriadoMinimo", LIMITES.minimo);
  const siteValidadeHoras = inteiro("siteValidadeHoras", LIMITES.validadeHoras);
  const siteMaximoNoites = inteiro("siteMaximoNoites", LIMITES.noitesConsulta);
  const siteMinutosHold = inteiro("siteMinutosHold", LIMITES.minutosHold);
  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    regras: {
      minimoPorDia, estadiaMaxima, horizonteDias,
      feriados: feriados.sort((a, b) => a.data.localeCompare(b.data)),
      janelaFeriado: { estadiaMinima: feriadoMinimo, multiplicador: multiplicador!, minimoNormalComReserva: marcado(e.feriadoMinimoNormal), todosImoveis: marcado(e.feriadoTodos), imoveis: ids(e.feriadoImoveis, imoveisDaOrg) },
      eventos: atual.eventos,
      ultimaHora: { aplicadoPor: aplicadoPor as AplicacaoUltimaHora, faixas },
      envio: { imoveis: ids(e.envioImoveis, imoveisDaOrg), automatico: marcado(e.envioAutomatico) },
      site: { validadeLeituraHoras: siteValidadeHoras, maximoNoitesConsulta: siteMaximoNoites, minutosHold: siteMinutosHold },
    },
  };
}

export function validarEvento(e: Entrada, imoveisDaOrg: readonly string[]): { ok: true; evento: Omit<Evento, "id"> } | { ok: false; erro: string } {
  const nome = txt(e.nome).slice(0, 60);
  const inicio = lerData(txt(e.inicio));
  const fim = lerData(txt(e.fim));
  if (!nome) return { ok: false, erro: "Dê um nome ao evento (ex.: Réveillon 2026, Carnaval 2027)." };
  if (!inicio || !fim) return { ok: false, erro: "Datas inválidas." };
  if (fim < inicio) return { ok: false, erro: "A última noite não pode ser antes da primeira." };
  const multiplicador = multiplicadorParaCentesimos(txt(e.multiplicador));
  if (multiplicador === undefined) return { ok: false, erro: "Multiplicador entre 1 e 10 (ex.: 4 = quatro vezes o preço base)." };
  const m = txt(e.estadiaMinima);
  if (m && (!/^\d+$/.test(m) || !inteiroEntre(Number(m), LIMITES.minimo))) return { ok: false, erro: "Estadia mínima: número de 1 a 30." };
  const todosImoveis = marcado(e.todosImoveis);
  const imoveis = todosImoveis ? [] : ids(e.imoveis, imoveisDaOrg);
  if (!todosImoveis && !imoveis.length) return { ok: false, erro: "Escolha os imóveis do evento (ou marque todos)." };
  return { ok: true, evento: { nome, inicio, fim, multiplicador, estadiaMinima: m ? Number(m) : null, minimoNormalComReserva: marcado(e.minimoNormalComReserva), todosImoveis, imoveis } };
}

/**
 * Grava as regras gerais. Os eventos são relidos sob a trava e preservados: o formulário geral
 * nunca desfaz um evento adicionado ou removido em outra aba entre a leitura e o salvamento.
 */
export async function salvarRegrasCalendario(db: Db, organizacaoId: string, regras: RegrasCalendario, autorId: string | null): Promise<boolean> {
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "calendario_regras");
    const atual = await lerRegrasCalendario(tx, organizacaoId);
    return Object.keys(await gravarConfig(tx, organizacaoId, "calendario_regras", { ...regras, eventos: atual.eventos }, autorId)).length > 0;
  });
}

export async function adicionarEvento(db: Db, organizacaoId: string, evento: Omit<Evento, "id">, autorId: string | null): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "calendario_regras");
    const atual = await lerRegrasCalendario(tx, organizacaoId);
    if (atual.eventos.length >= LIMITES.eventos) return { ok: false as const, erro: `No máximo ${LIMITES.eventos} eventos. Exclua os passados.` };
    const id = randomUUID();
    await gravarConfig(tx, organizacaoId, "calendario_regras", { ...atual, eventos: [...atual.eventos, { ...evento, id }] }, autorId);
    return { ok: true as const, id };
  });
}

/** Liga ou desliga, num evento já cadastrado, a regra de 6/10 das noites livres com reserva no período. */
export async function definirMinimoNormalDoEvento(db: Db, organizacaoId: string, id: string, ligado: boolean, autorId: string | null): Promise<boolean> {
  if (!uuidValido(id)) return false;
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "calendario_regras");
    const atual = await lerRegrasCalendario(tx, organizacaoId);
    const evento = atual.eventos.find((e) => e.id === id);
    if (!evento) return false;
    if (evento.minimoNormalComReserva === ligado) return true;
    await gravarConfig(tx, organizacaoId, "calendario_regras", { ...atual, eventos: atual.eventos.map((e) => (e.id === id ? { ...e, minimoNormalComReserva: ligado } : e)) }, autorId);
    return true;
  });
}

export async function removerEvento(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<boolean> {
  if (!uuidValido(id)) return false;
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "calendario_regras");
    const atual = await lerRegrasCalendario(tx, organizacaoId);
    if (!atual.eventos.some((e) => e.id === id)) return false;
    await gravarConfig(tx, organizacaoId, "calendario_regras", { ...atual, eventos: atual.eventos.filter((e) => e.id !== id) }, autorId);
    return true;
  });
}
