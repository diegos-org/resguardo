/**
 * Agenda diária da equipe (M6.3). Todo dia às 20h, os próximos cinco dias, uma seção por cidade
 * (Rio e Búzios separados, nunca somados), no modelo que Diego definiu em 23/09:
 * - formato "limpezas" (Rio): um dia por linha só com as limpezas (dia de checkout), "nenhuma
 *   limpeza" nos dias vazios, horário-limite quando alguém entra no mesmo dia, e as entradas num
 *   parágrafo à parte (misturar entradas e limpezas confundiu a equipe);
 * - formato "reservas" (Búzios): uma linha por reserva, com entrada, saída e nº de hóspedes.
 * Mais as reservas novas desde a última agenda, mesmo fora da janela. A agenda só informa: não
 * confirma limpeza nem preparação.
 *
 * Quem recebe e se a agenda está ligada fica em Configurações (config "agenda"), editável no
 * painel. Envio pelo mesmo adaptador de e-mail do login (M1.3); em teste, nada sai.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import { appSettings, auditoria, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { type Correio, ErroEnvioIncerto } from "@/email/correio";
import { hojeISO } from "@/lib/datas";
import { listarLimpezas, NOMES_ESTADO, sincronizarLimpezas } from "@/limpezas/limpezas";

export const DIAS_AGENDA = 5;

const dia = (d: string) => Date.parse(`${d}T00:00:00Z`);
const somaDias = (d: string, n: number) => new Date(dia(d) + n * 86_400_000).toISOString().slice(0, 10);
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const diaCurto = (d: string) => `${SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.split("-").reverse().slice(0, 2).join("/")}`;

// ——— Configuração (editável no painel) ———

export type Destinatario = { email: string; /** Vazio = todas as cidades. */ cidades: string[] };
export const FORMATOS = ["limpezas", "reservas"] as const;
export type Formato = (typeof FORMATOS)[number];
export const NOMES_FORMATO: Record<Formato, string> = {
  limpezas: "Limpezas por dia (entradas à parte)",
  reservas: "Uma linha por reserva (entrada, saída e hóspedes)",
};
export type ConfigAgenda = {
  ativa: boolean;
  destinatarios: Destinatario[];
  /** Formato de cada cidade; sem escolha, ver `formatoDa`. */
  formatos: Record<string, Formato>;
  /** Horários do check-in e do checkout, como aparecem no texto (ex.: "15h", "11h"). */
  horaEntrada: string;
  horaSaida: string;
};

/** Horários das regras de atendimento (Diego, 23/09); editáveis na tela da agenda. */
export const HORA_ENTRADA_PADRAO = "15h";
export const HORA_SAIDA_PADRAO = "11h";
const HORA = /^([01]?\d|2[0-3])h([0-5]\d)?$/;

/**
 * Formato de uma cidade: o escolhido na tela; sem escolha, casa única (um imóvel na cidade) vai
 * por reserva e cidade com vários apartamentos vai por limpezas. A tela mostra qual está valendo.
 */
export function formatoDa(c: Pick<ConfigAgenda, "formatos">, cidade: string, imoveisNaCidade: number): Formato {
  return c.formatos[cidade] ?? (imoveisNaCidade === 1 ? "reservas" : "limpezas");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function lerConfigAgenda(db: Db, organizacaoId: string): Promise<ConfigAgenda> {
  const c = await lerConfig(db, organizacaoId, "agenda");
  const lista = Array.isArray(c?.destinatarios) ? (c.destinatarios as unknown[]) : [];
  const destinatarios = lista
    .filter((d): d is Destinatario => !!d && typeof (d as Destinatario).email === "string" && Array.isArray((d as Destinatario).cidades))
    .map((d) => ({ email: d.email, cidades: d.cidades.filter((x) => typeof x === "string") }));
  const formatos: Record<string, Formato> = {};
  if (c?.formatos && typeof c.formatos === "object" && !Array.isArray(c.formatos)) {
    for (const [cidade, f] of Object.entries(c.formatos as Record<string, unknown>)) if ((FORMATOS as readonly unknown[]).includes(f)) formatos[cidade] = f as Formato;
  }
  const hora = (v: unknown, padrao: string) => (typeof v === "string" && HORA.test(v) ? v : padrao);
  return { ativa: c?.ativa === true, destinatarios, formatos, horaEntrada: hora(c?.horaEntrada, HORA_ENTRADA_PADRAO), horaSaida: hora(c?.horaSaida, HORA_SAIDA_PADRAO) };
}

/** Cidades dos imóveis ativos (a agenda separa por elas). */
export async function cidadesDosImoveis(db: Db, organizacaoId: string): Promise<string[]> {
  const l = await db
    .selectDistinct({ cidade: imoveis.cidade })
    .from(imoveis)
    .where(and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.ativo, true)))
    .orderBy(asc(imoveis.cidade));
  return l.map((x) => x.cidade);
}

/** Formato e horários ausentes mantêm o que já estava salvo. */
export type NovaConfigAgenda = Pick<ConfigAgenda, "ativa" | "destinatarios"> & Partial<Pick<ConfigAgenda, "formatos" | "horaEntrada" | "horaSaida">>;

export async function salvarConfigAgenda(db: Db, organizacaoId: string, c: NovaConfigAgenda, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  // Cidades válidas: as dos imóveis ativos e as já configuradas (imóvel renomeado ou inativado
  // não vira "todas as cidades" por engano: a escolha continua como estava).
  const anterior = await lerConfigAgenda(db, organizacaoId);
  const cidades = [...(await cidadesDosImoveis(db, organizacaoId)), ...anterior.destinatarios.flatMap((d) => d.cidades), ...Object.keys(anterior.formatos)];
  const vistos = new Set<string>();
  const destinatarios: Destinatario[] = [];
  for (const d of c.destinatarios) {
    const email = d.email.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL.test(email) || email.length > 200) return { ok: false, erro: `E-mail inválido: ${email}` };
    if (vistos.has(email)) return { ok: false, erro: `E-mail repetido: ${email}` };
    vistos.add(email);
    const fora = d.cidades.find((x) => !cidades.includes(x));
    if (fora) return { ok: false, erro: `Cidade sem imóvel ativo: ${fora}` };
    destinatarios.push({ email, cidades: [...new Set(d.cidades)].sort() });
  }
  if (destinatarios.length > 30) return { ok: false, erro: "No máximo 30 destinatários." };
  if (c.ativa && !destinatarios.length) return { ok: false, erro: "Para ligar a agenda, informe pelo menos um destinatário." };
  const horaEntrada = (c.horaEntrada ?? anterior.horaEntrada).trim().toLowerCase();
  const horaSaida = (c.horaSaida ?? anterior.horaSaida).trim().toLowerCase();
  if (!HORA.test(horaEntrada) || !HORA.test(horaSaida)) return { ok: false, erro: "Horário no formato 15h ou 15h30." };
  const formatos: Record<string, Formato> = {};
  for (const [cidade, f] of Object.entries(c.formatos ?? anterior.formatos)) {
    if (!(FORMATOS as readonly string[]).includes(f)) return { ok: false, erro: `Formato inválido para ${cidade}.` };
    // Cidade sem imóvel ativo nem destinatário: a escolha antiga fica (reativar o imóvel volta como estava).
    formatos[cidade] = f;
  }
  const valor = { ativa: c.ativa, destinatarios, formatos, horaEntrada, horaSaida };
  await db.transaction((tx) => gravarConfig(tx, organizacaoId, "agenda", valor, autorId));
  return { ok: true };
}

// ——— Montagem ———

export type ItemAgenda =
  | { tipo: "entrada" | "saida"; imovel: string; reserva: string; hospede: string; hospedes: number | null }
  | { tipo: "limpeza"; imovel: string; estado: string; profissional: string | null; avisos: string[] };

export type NovaReserva = {
  id: string;
  imovelId: string;
  /** Identifica o aviso (reserva + quando ficou nova): reconfirmar depois de cancelar é outro aviso. */
  evento: string;
  imovel: string;
  reserva: string;
  hospede: string;
  hospedes: number | null;
  checkin: string;
  checkout: string;
  /** Quando passou a ser nova (criada confirmada, ou a confirmação mais recente). */
  registradaEm: string;
};

/** Reserva com entrada ou saída dentro da janela (formato "reservas"). */
export type ReservaDaJanela = { imovel: string; hospede: string; hospedes: number | null; checkin: string; checkout: string };

export type SecaoCidade = {
  cidade: string;
  /** Imóveis ativos nesta cidade (define o formato quando não há escolha). */
  imoveis: number;
  /** Ids dos imóveis ativos nesta cidade (o que um envio "cobre"). */
  imovelIds: string[];
  dias: { data: string; itens: ItemAgenda[] }[];
  reservas: ReservaDaJanela[];
  novas: NovaReserva[];
};

export type Agenda = { hoje: string; dias: string[]; secoes: SecaoCidade[] };

/** Só o primeiro nome do hóspede: a equipe não precisa de mais. */
const primeiroNome = (n: string) => n.trim().split(/\s+/)[0] ?? "";

const ORDEM: Record<ItemAgenda["tipo"], number> = { saida: 0, limpeza: 1, entrada: 2 };

/**
 * Agenda dos próximos `DIAS_AGENDA` dias a partir de amanhã. `novasDesde`: reservas confirmadas
 * criadas depois disso entram em "novas" (qualquer data futura).
 */
export async function montarAgenda(db: Db, organizacaoId: string, hoje: string, novasDesde: Date | null, novasAte: Date = new Date()): Promise<Agenda> {
  const inicio = somaDias(hoje, 1);
  const fim = somaDias(hoje, DIAS_AGENDA + 1);
  const dias = Array.from({ length: DIAS_AGENDA }, (_, i) => somaDias(inicio, i));
  const ativos = await db
    .select({ id: imoveis.id, codigo: imoveis.codigo, cidade: imoveis.cidade })
    .from(imoveis)
    .where(and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.ativo, true)))
    .orderBy(asc(imoveis.codigo));
  if (!ativos.length) return { hoje, dias, secoes: [] };
  const ids = ativos.map((i) => i.id);
  const doImovel = new Map(ativos.map((i) => [i.id, i]));

  // Garante as limpezas das saídas da janela (mesma regra da tela de Limpezas).
  await sincronizarLimpezas(db, organizacaoId, { inicio, fim });
  const [daJanela, limpezasDaJanela, novas] = await Promise.all([
    db
      .select()
      .from(reservas)
      .where(
        and(
          eq(reservas.organizacaoId, organizacaoId),
          eq(reservas.estado, "confirmada"),
          inArray(reservas.imovelId, ids),
          lt(reservas.checkin, fim),
          gte(reservas.checkout, inicio),
        ),
      ),
    listarLimpezas(db, organizacaoId, { inicio, fim, imovelIds: ids, hoje }),
    novasDesde
      ? db
          .select()
          .from(reservas)
          .where(
            and(
              eq(reservas.organizacaoId, organizacaoId),
              // Confirmada no corte (último estado registrado no histórico até `novasAte`, ou o atual se não
              // houver): cancelada antes do corte e reconfirmada depois fica para a próxima agenda.
              sql`coalesce((select ${auditoria.mudancas} -> 'estado' ->> 1 from ${auditoria} where ${auditoria.organizacaoId} = ${organizacaoId} and ${auditoria.entidade} = 'reserva' and ${auditoria.entidadeId} = ${reservas.id}::text and ${auditoria.mudancas} ? 'estado' and ${auditoria.criadoEm} <= ${novasAte.toISOString()}::timestamptz order by ${auditoria.criadoEm} desc limit 1), ${reservas.estado}::text) = 'confirmada'`,
              inArray(reservas.imovelId, ids),
              // Nova = criada já confirmada depois do marco, ou que passou a confirmada depois dele
              // (pendente/cancelada que confirmou numa sincronização: registrada no histórico).
              // Até `novasAte` (o corte gravado como marco): o que entrar depois fica para a próxima.
              or(
                // Criada já confirmada (o histórico da criação diz "confirmada"): uma criada pendente e
                // confirmada depois só conta pela confirmação, que pode ser posterior ao corte.
                and(
                  gt(reservas.criadoEm, novasDesde),
                  lte(reservas.criadoEm, novasAte),
                  sql`exists (select 1 from ${auditoria} where ${auditoria.organizacaoId} = ${organizacaoId} and ${auditoria.entidade} = 'reserva' and ${auditoria.entidadeId} = ${reservas.id}::text and ${auditoria.acao} in ('reserva.criar', 'reserva.importar') and ${auditoria.mudancas} -> 'estado' ->> 1 = 'confirmada')`,
                ),
                sql`${reservas.id}::text in (select ${auditoria.entidadeId} from ${auditoria} where ${auditoria.organizacaoId} = ${organizacaoId} and ${auditoria.entidade} = 'reserva' and ${auditoria.criadoEm} > ${novasDesde.toISOString()}::timestamptz and ${auditoria.criadoEm} <= ${novasAte.toISOString()}::timestamptz and ${auditoria.mudancas} -> 'estado' ->> 1 = 'confirmada')`,
              ),
              gte(reservas.checkout, hoje),
            ),
          )
          .orderBy(asc(reservas.checkin))
      : Promise.resolve([]),
  ]);

  const porCidade = new Map<string, SecaoCidade>();
  const secao = (cidade: string) => {
    let s = porCidade.get(cidade);
    if (!s) porCidade.set(cidade, (s = { cidade, imoveis: 0, imovelIds: [], dias: dias.map((data) => ({ data, itens: [] })), reservas: [], novas: [] }));
    return s;
  };
  for (const i of ativos) {
    const x = secao(i.cidade);
    x.imoveis++;
    x.imovelIds.push(i.id);
  }
  const noDia = (cidade: string, data: string) => secao(cidade).dias.find((d) => d.data === data);

  for (const r of daJanela) {
    const im = doImovel.get(r.imovelId)!;
    const base = { imovel: im.codigo, reserva: r.codigo, hospede: primeiroNome(r.hospedeNome), hospedes: r.hospedes };
    const entra = noDia(im.cidade, r.checkin);
    const sai = noDia(im.cidade, r.checkout);
    entra?.itens.push({ tipo: "entrada", ...base });
    sai?.itens.push({ tipo: "saida", ...base });
    if (entra || sai) secao(im.cidade).reservas.push({ imovel: im.codigo, hospede: base.hospede, hospedes: r.hospedes, checkin: r.checkin, checkout: r.checkout });
  }
  for (const l of limpezasDaJanela) {
    if (l.movida || l.estado === "cancelada") continue;
    const im = doImovel.get(l.imovelId);
    if (!im) continue;
    noDia(im.cidade, l.data)?.itens.push({
      tipo: "limpeza",
      imovel: im.codigo,
      estado: l.estado === "pedida" ? "a confirmar" : NOMES_ESTADO[l.estado].toLowerCase(),
      profissional: l.profissional,
      avisos: l.avisos,
    });
  }
  // Quando cada uma passou a ser "nova" nesta faixa: a confirmação mais recente registrada no
  // histórico ou, sem ela, a criação. Uma reserva cancelada e reconfirmada é outro evento.
  const confirmacoes =
    novas.length && novasDesde
      ? await db
          .select({ id: auditoria.entidadeId, em: sql<string>`to_char(max(${auditoria.criadoEm}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` })
          .from(auditoria)
          .where(
            and(
              eq(auditoria.organizacaoId, organizacaoId),
              eq(auditoria.entidade, "reserva"),
              inArray(
                auditoria.entidadeId,
                novas.map((r) => r.id),
              ),
              gt(auditoria.criadoEm, novasDesde),
              lte(auditoria.criadoEm, novasAte),
              sql`${auditoria.mudancas} -> 'estado' ->> 1 = 'confirmada'`,
            ),
          )
          .groupBy(auditoria.entidadeId)
      : [];
  for (const r of novas) {
    const im = doImovel.get(r.imovelId)!;
    const confirmada = confirmacoes.find((c) => c.id === r.id);
    const registradaEm = confirmada ? new Date(confirmada.em).toISOString() : r.criadoEm.toISOString();
    secao(im.cidade).novas.push({
      id: r.id,
      imovelId: r.imovelId,
      evento: `${r.id}@${registradaEm}`,
      registradaEm,
      imovel: im.codigo,
      reserva: r.codigo,
      hospede: primeiroNome(r.hospedeNome),
      hospedes: r.hospedes,
      checkin: r.checkin,
      checkout: r.checkout,
    });
  }
  const secoes = [...porCidade.values()].sort((a, b) => a.cidade.localeCompare(b.cidade, "pt-BR"));
  for (const s of secoes) {
    for (const d of s.dias) d.itens.sort((a, b) => ORDEM[a.tipo] - ORDEM[b.tipo] || a.imovel.localeCompare(b.imovel));
    s.reservas.sort((a, b) => a.checkin.localeCompare(b.checkin) || a.imovel.localeCompare(b.imovel));
  }
  return { hoje, dias, secoes };
}

// ——— Texto (e-mail e prévia na tela) ———

const pessoas = (n: number | null) => (n === null ? "nº de hóspedes não informado" : `${n} hóspede${n === 1 ? "" : "s"}`);
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** "qui 24" (dia da semana e dia do mês). */
const diaDoMes = (d: string) => `${SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.slice(8, 10)}`;
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}`);

export type OpcoesTexto = Pick<ConfigAgenda, "formatos" | "horaEntrada" | "horaSaida"> & { incertoAte?: Date | null };
export const OPCOES_PADRAO: OpcoesTexto = { formatos: {}, horaEntrada: HORA_ENTRADA_PADRAO, horaSaida: HORA_SAIDA_PADRAO };

export function textoDaNova(n: NovaReserva): string {
  return `${n.imovel}: entrada ${diaCurto(n.checkin)}, saída ${diaCurto(n.checkout)} — ${n.hospede || "hóspede sem nome"}, ${pessoas(n.hospedes)}`;
}

/** Rio: um dia por linha, só limpezas; entradas num parágrafo separado. */
function linhasLimpezas(s: SecaoCidade, o: OpcoesTexto): string[] {
  const linhas = ["Limpezas dos próximos dias:", ""];
  for (const d of s.dias) {
    const entradas = d.itens.filter((i) => i.tipo === "entrada");
    const limpezas = d.itens.filter((i) => i.tipo === "limpeza");
    const partes = limpezas.map((l) => {
      // Alguém entra no mesmo imóvel no mesmo dia: a limpeza tem hora para acabar.
      const entra = entradas.find((e) => e.imovel === l.imovel);
      return entra && entra.tipo === "entrada" ? `${l.imovel} (pronto até ${o.horaEntrada}, entra ${entra.hospede || "hóspede sem nome"})` : l.imovel;
    });
    linhas.push(`🧹 ${maiuscula(diaCurto(d.data))}: ${partes.length ? partes.join(" · ") : "nenhuma limpeza"}`);
  }
  const entradas = s.dias
    .map((d) => ({ d, e: d.itens.filter((i): i is Extract<ItemAgenda, { tipo: "entrada" | "saida" }> => i.tipo === "entrada") }))
    .filter((x) => x.e.length)
    .map((x) => `${diaDoMes(x.d.data)} — ${lista(x.e.map((e) => `${e.imovel} (${e.hospede || "hóspede sem nome"})`))}, ${o.horaEntrada}`);
  if (entradas.length) linhas.push("", `Só para referência, as entradas do período: ${entradas.join("; ")}.`);
  return linhas;
}

/** Búzios: uma linha por reserva, com entrada e saída (a equipe precisa estar nos dois momentos). */
function linhasReservas(s: SecaoCidade, o: OpcoesTexto, fim: string): string[] {
  if (!s.reservas.length) return [`Nenhuma entrada ou saída até ${diaCurto(fim)}.`];
  const linhas = ["Próximas reservas:", ""];
  for (const r of s.reservas) {
    const quem = `${s.imoveis > 1 ? `${r.imovel} · ` : ""}${r.hospede || "hóspede sem nome"}`;
    linhas.push(`• ${quem} — entrada ${diaCurto(r.checkin)} a partir das ${o.horaEntrada} · saída ${diaCurto(r.checkout)} até ${o.horaSaida} · ${pessoas(r.hospedes)}`);
    // Outra reserva entra no dia da saída: limpeza entre uma e outra.
    if (s.reservas.some((x) => x !== r && x.imovel === r.imovel && x.checkin === r.checkout)) linhas.push(`  (limpeza no dia ${r.checkout.slice(8, 10)} entre a saída e a entrada)`);
  }
  linhas.push("", `Nos outros dias até ${diaCurto(fim)} não há entradas nem saídas.`);
  return linhas;
}

/** Texto de uma cidade (o mesmo da prévia na tela). */
export function textoDaSecao(s: SecaoCidade, fim: string, o: OpcoesTexto = OPCOES_PADRAO): string[] {
  const linhas = formatoDa(o, s.cidade, s.imoveis) === "reservas" ? linhasReservas(s, o, fim) : linhasLimpezas(s, o);
  if (s.novas.length) {
    linhas.push("", "Reservas novas desde a última agenda:");
    for (const n of s.novas) {
      // Envio anterior sem confirmação de registro: pode ter chegado; avisa em vez de supor.
      const talvez = o.incertoAte && Date.parse(n.registradaEm) <= o.incertoAte.getTime() ? " (pode já ter vindo numa agenda anterior, cujo envio não foi confirmado)" : "";
      linhas.push(`• ${textoDaNova(n)}${talvez}`);
    }
  }
  return linhas;
}

export const FRASE_FINAL = "Essa é a agenda atual e ainda pode mudar com novas reservas ou cancelamentos.";

/** Texto simples do e-mail, só com as cidades pedidas (vazio = todas). */
export function textoDaAgenda(a: Agenda, cidades: readonly string[] = [], o: OpcoesTexto = OPCOES_PADRAO): string {
  const secoes = a.secoes.filter((s) => !cidades.length || cidades.includes(s.cidade));
  const fim = a.dias.at(-1)!;
  const linhas = [`Boa noite! Agenda de ${diaCurto(a.dias[0])} a ${diaCurto(fim)} (próximos ${a.dias.length} dias).`, ""];
  for (const s of secoes) linhas.push(`=== ${s.cidade} ===`, "", ...textoDaSecao(s, fim, o), "");
  if (!secoes.length) linhas.push("Nenhum imóvel ativo nas cidades deste destinatário.", "");
  linhas.push(FRASE_FINAL);
  return linhas.join("\n") + "\n";
}

// ——— Envio ———

const chaveUltima = (org: string) => `agenda-diaria:ultima:${org}`;
/** Marca de "já recebeu hoje": uma para o envio das 20h e outra para o "enviar agora" (um não bloqueia o outro). */
const chaveEnvio = (org: string, data: string, email: string, manual = false) => `agenda-diaria${manual ? "-manual" : ""}:${org}:${data}:${email}`;

const chaveUltimaDe = (org: string, email: string) => `agenda-diaria:ultima:${org}:${email}`;
const chaveAvisadasDe = (org: string, email: string) => `agenda-diaria:avisadas:${org}:${email}`;
const chaveTravaDe = (org: string, email: string) => `agenda-diaria:trava:${org}:${email}`;

/**
 * Sobreposição da busca de reservas novas antes do marco: uma reserva gravada com horário anterior
 * ao corte, mas confirmada no banco só depois da consulta, ainda aparece na agenda seguinte. As que
 * a pessoa já recebeu nessa faixa são puladas (lista das avisadas, mantida enquanto podem voltar).
 */
const SOBREPOSICAO_MS = 10 * 60_000;

/** `id`: o evento avisado (`NovaReserva.evento`), não só a reserva. */
type Avisada = { id: string; corte: string };

/** Reservas novas já avisadas a esta pessoa, com o corte do envio em que foram (para podar). */
async function lerAvisadas(db: Db, chave: string): Promise<Avisada[]> {
  const [l] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, chave));
  const lista = (l?.value as { avisadas?: unknown } | undefined)?.avisadas;
  return Array.isArray(lista) ? lista.filter((x): x is Avisada => !!x && typeof (x as Avisada).id === "string" && typeof (x as Avisada).corte === "string") : [];
}

/**
 * Lista a guardar depois de um envio: as de antes que ainda podem cair na faixa de sobreposição do
 * próximo envio (corte até SOBREPOSICAO antes deste) mais as deste envio. As mais antigas não voltam
 * a aparecer (o horário delas é anterior à faixa), então saem.
 */
function avisadasDepois(antes: readonly Avisada[], novas: readonly string[], corte: Date, marco: Date): Avisada[] {
  const limite = marco.getTime() - SOBREPOSICAO_MS;
  const ficam = antes.filter((a) => Date.parse(a.corte) >= limite && !novas.includes(a.id));
  return [...ficam, ...novas.map((id) => ({ id, corte: corte.toISOString() }))];
}

/** A agenda sem as reservas novas que a pessoa já recebeu. */
function semAvisadas(a: Agenda, avisadas: readonly Avisada[]): Agenda {
  if (!avisadas.length) return a;
  const ids = new Set(avisadas.map((x) => x.id));
  return { ...a, secoes: a.secoes.map((s) => ({ ...s, novas: s.novas.filter((n) => !ids.has(n.evento)) })) };
}

async function lerMarco(db: Db, chave: string): Promise<Date | null> {
  const [l] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, chave));
  const em = (l?.value as { em?: unknown } | undefined)?.em;
  return typeof em === "string" && !Number.isNaN(Date.parse(em)) ? new Date(em) : null;
}

/**
 * Imóveis que o marco da pessoa cobre (null = todos, marco antigo). Imóvel fora da cobertura (inativo
 * no envio, ou de cidade que ela passou a receber depois) conta como novo para ela: reservas novas das
 * últimas 24h daquele imóvel.
 */
async function lerCobertura(db: Db, chave: string): Promise<string[] | null> {
  const [l] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, chave));
  const c = (l?.value as { imoveis?: unknown } | undefined)?.imoveis;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === "string") : null;
}

async function gravarMarco(db: Db, chave: string, em: Date, imoveis?: string[] | null): Promise<void> {
  const value = imoveis === undefined ? { em: em.toISOString() } : { em: em.toISOString(), imoveis };
  await db.insert(appSettings).values({ key: chave, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Quando a última agenda foi enviada (para alguém). */
export function ultimaAgenda(db: Db, organizacaoId: string): Promise<Date | null> {
  return lerMarco(db, chaveUltima(organizacaoId));
}

/** Quando este destinatário recebeu a agenda por último (marco das reservas novas dele). */
export function ultimaAgendaDe(db: Db, organizacaoId: string, email: string): Promise<Date | null> {
  return lerMarco(db, chaveUltimaDe(organizacaoId, email));
}

/**
 * Prévia para a tela: os próximos dias e as reservas novas desde o início mais antigo que algum
 * envio usaria agora (marco de cada destinatário, as últimas 24h de imóvel não coberto, envios
 * incertos em aberto). É o máximo que alguém recebe; cada pessoa recebe só o que ainda não recebeu
 * e só as cidades dela.
 */
export async function previaDaAgenda(db: Db, organizacaoId: string, agora: Date = new Date()): Promise<{ agenda: Agenda; ultima: Date | null }> {
  const [ultima, config] = await Promise.all([ultimaAgenda(db, organizacaoId), lerConfigAgenda(db, organizacaoId)]);
  const umDia = new Date(agora.getTime() - 86_400_000);
  const marcos = await Promise.all(config.destinatarios.map((d) => ultimaAgendaDe(db, organizacaoId, d.email)));
  // Como no envio: imóvel que o marco não cobre (reativado, cidade nova) olha as últimas 24h, e um
  // envio incerto ainda aberto olha as 24h antes do corte dele. A prévia parte do mais antigo de tudo.
  const pendentes = await marcasPendentes(db, organizacaoId);
  const cortesIncertos = pendentes
    .map((l) => l.value as { corte?: string; em?: string })
    .map((v) => Date.parse(v.corte ?? v.em ?? ""))
    .filter((t) => !Number.isNaN(t))
    .map((t) => t - 86_400_000 - SOBREPOSICAO_MS);
  const inicios = [...marcos.map((m) => (m ? m.getTime() - SOBREPOSICAO_MS : umDia.getTime())), umDia.getTime(), ...cortesIncertos];
  const desde = marcos.length ? new Date(Math.min(...inicios)) : (ultima ?? umDia);
  const bruta = await montarAgenda(db, organizacaoId, hojeISO("America/Sao_Paulo", agora), desde, agora);
  // Como no envio: reserva nova que todas as pessoas que recebem aquela cidade já receberam não
  // aparece de novo (quem não recebe a cidade não conta).
  const listas = await Promise.all(config.destinatarios.map(async (d) => ({ d, avisadas: new Set((await lerAvisadas(db, chaveAvisadasDe(organizacaoId, d.email))).map((x) => x.id)) })));
  const agenda: Agenda = {
    ...bruta,
    secoes: bruta.secoes.map((sec) => {
      const recebem = listas.filter((x) => !x.d.cidades.length || x.d.cidades.includes(sec.cidade));
      return { ...sec, novas: sec.novas.filter((n) => !recebem.length || !recebem.every((x) => x.avisadas.has(n.evento))) };
    }),
  };
  return { agenda, ultima };
}

/**
 * Envios de dias anteriores para esta pessoa que ficaram "enviando" (o provedor pode ter aceitado,
 * mas o registro não foi gravado e a chave do provedor já é outra). Marca como "incerto" e devolve
 * o maior corte entre eles e os "incerto" ainda não resolvidos: as reservas novas até ele saem de
 * novo, com o aviso de que podem já ter chegado. Só um envio que dá certo resolve (`chaves`).
 */
/**
 * Um envio incerto: o corte dele e os imóveis que o e-mail levava (null = o pedido nem chegou a ser
 * montado: vale para todos).
 */
type Incerto = { chave: string; corte: Date | null; imoveis: string[] | null; eventos: string[] };

async function reconciliarIncertos(db: Db, pendentes: readonly Marca[], email: string, hoje: string): Promise<{ ate: Date | null; lista: Incerto[] }> {
  let maior: Date | null = null;
  const lista: Incerto[] = [];
  for (const l of pendentes) {
    const m = l.key.match(/^agenda-diaria(?:-manual)?:[^:]+:(\d{4}-\d{2}-\d{2}):(.+)$/);
    if (!m || m[2] !== email || m[1] >= hoje) continue;
    const v = l.value as { corte?: string; em?: string; estado?: string; carga?: unknown };
    const corte = new Date(v.corte ?? v.em ?? "");
    if (v.estado === "enviando") await db.update(appSettings).set({ value: { ...v, estado: "incerto" }, updatedAt: new Date() }).where(eq(appSettings.key, l.key));
    const valido = !Number.isNaN(corte.getTime());
    lista.push({ chave: l.key, corte: valido ? corte : null, imoveis: cargaValida(v.carga) ? v.carga.imoveis : null, eventos: cargaValida(v.carga) ? v.carga.eventos : [] });
    if (valido && (!maior || corte > maior)) maior = corte;
  }
  return { ate: maior, lista };
}

type Marca = { key: string; value: unknown };

/** Faixa de chaves das marcas diárias de uma organização (agendado e manual), consultada pelo índice da chave. */
const faixas = (org: string) => [`agenda-diaria:${org}:`, `agenda-diaria-manual:${org}:`];
const naFaixa = (prefixo: string, ate = "\uffff") => and(gte(appSettings.key, prefixo), lt(appSettings.key, prefixo + ate));

/** Marcas ainda não resolvidas desta organização ("enviando" ou "incerto"), lidas uma vez por execução. */
async function marcasPendentes(db: Db, org: string): Promise<Marca[]> {
  return db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(and(or(...faixas(org).map((p) => naFaixa(p))), sql`${appSettings.value} ->> 'estado' in ('enviando', 'incerto')`));
}

/**
 * Marcas diárias concluídas ("enviado", "resolvido") de mais de 3 dias atrás já não servem para nada
 * (a chave de idempotência do provedor vale 24h): saem, para a consulta não crescer com o histórico.
 */
async function limparMarcasAntigas(db: Db, org: string, hoje: string): Promise<void> {
  const limite = new Date(Date.parse(`${hoje}T12:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10);
  await db
    .delete(appSettings)
    .where(and(or(...faixas(org).map((p) => naFaixa(p, limite))), sql`${appSettings.value} ->> 'estado' in ('enviado', 'resolvido')`));
}

/**
 * Um envio por vez para cada pessoa ("enviar agora" junto com o das 20h): a trava vale da montagem
 * do e-mail até o registro, para que os dois não leiam as mesmas avisadas e repitam a reserva.
 * Trava mais velha que ENVIO_EXPIRA_MS (execução que caiu) pode ser tomada.
 */
async function travarPessoa(db: Db, chave: string, agora: Date): Promise<string | null> {
  // `dono`: só quem tomou a trava a solta (uma execução atrasada não solta a de quem a retomou).
  const valor = { em: agora.toISOString(), dono: randomUUID() };
  const [nova] = await db.insert(appSettings).values({ key: chave, value: valor }).onConflictDoNothing().returning();
  if (nova) return valor.dono;
  const [l] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, chave));
  const em = (l?.value as { em?: string } | undefined)?.em;
  if (em && agora.getTime() - Date.parse(em) < ENVIO_EXPIRA_MS) return null;
  const [tomada] = await db
    .update(appSettings)
    .set({ value: valor, updatedAt: new Date() })
    .where(and(eq(appSettings.key, chave), em ? sql`${appSettings.value} ->> 'em' = ${em}` : sql`true`))
    .returning();
  return tomada ? valor.dono : null;
}

/** Confere que a trava ainda é deste dono e renova o prazo dela; false se outra execução a tomou. */
async function renovarPessoa(db: Db, chave: string, dono: string, em: Date): Promise<boolean> {
  const [minha] = await db
    .update(appSettings)
    .set({ value: sql`jsonb_set(${appSettings.value}, '{em}', to_jsonb(${em.toISOString()}::text))`, updatedAt: new Date() })
    .where(and(eq(appSettings.key, chave), sql`${appSettings.value} ->> 'dono' = ${dono}`))
    .returning({ key: appSettings.key });
  return !!minha;
}

async function soltarPessoa(db: Db, chave: string, dono: string): Promise<void> {
  await db.delete(appSettings).where(and(eq(appSettings.key, chave), sql`${appSettings.value} ->> 'dono' = ${dono}`));
}

/** Prazo de uma chamada ao provedor de e-mail (bem menor que ENVIO_EXPIRA_MS). */
const PRAZO_PROVEDOR_MS = 60_000;

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, falha) => {
    timer = setTimeout(() => falha(new ErroEnvioIncerto(`O provedor de e-mail não respondeu em ${ms / 1000}s.`)), ms);
  });
  return Promise.race([p, limite]).finally(() => clearTimeout(timer));
}

/** Tentativa "enviando" mais velha que isto (a execução caiu no meio) pode ser refeita. */
const ENVIO_EXPIRA_MS = 15 * 60_000;

/**
 * Marca o envio do dia para este destinatário como "enviando". Devolve false se já foi enviado
 * ou se há outra tentativa em andamento (recente); uma tentativa antiga que ficou pela metade
 * (execução interrompida antes de confirmar) é retomada.
 */
/** O pedido exato feito ao provedor, guardado antes de enviar para uma retomada repetir igual. */
/** `imoveis`: os imóveis ativos das seções do e-mail (os cobertos por este envio). */
type Carga = { assunto: string; texto: string; eventos: string[]; imoveis: string[] };

const cargaValida = (c: unknown): c is Carga =>
  !!c &&
  typeof (c as Carga).assunto === "string" &&
  typeof (c as Carga).texto === "string" &&
  Array.isArray((c as Carga).eventos) &&
  Array.isArray((c as Carga).imoveis);

async function reservarEnvio(db: Db, chave: string, agora: Date): Promise<{ corte: Date; carga: Carga | null; tentativa: string } | null> {
  // `corte`: o limite das reservas novas desta tentativa. Uma retomada reaproveita o da tentativa
  // original e, se o pedido já tinha sido montado, o pedido inteiro: o provedor só ignora o reenvio
  // com a mesma chave se o conteúdo for idêntico, e o marco tem de ser o do e-mail que saiu.
  // `tentativa`: só a tentativa dona da marca a grava ou apaga (uma execução atrasada, cuja marca foi
  // retomada por outra, não mexe no estado da que a retomou).
  const tentativa = randomUUID();
  const valor = { em: agora.toISOString(), estado: "enviando", corte: agora.toISOString(), tentativa };
  const [nova] = await db.insert(appSettings).values({ key: chave, value: valor }).onConflictDoNothing().returning();
  if (nova) return { corte: agora, carga: null, tentativa };
  const [l] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, chave));
  const v = (l?.value ?? {}) as { em?: string; estado?: string; corte?: string; carga?: unknown };
  if (v.estado !== "enviando" || !v.em || agora.getTime() - Date.parse(v.em) < ENVIO_EXPIRA_MS) return null;
  const corte = v.corte && !Number.isNaN(Date.parse(v.corte)) ? v.corte : v.em;
  const carga = cargaValida(v.carga) ? v.carga : null;
  // Troca só se ninguém retomou antes (compara o valor antigo).
  const [retomada] = await db
    .update(appSettings)
    .set({ value: { ...valor, corte, ...(carga ? { carga } : {}) }, updatedAt: new Date() })
    .where(and(eq(appSettings.key, chave), sql`${appSettings.value} ->> 'em' = ${v.em}`, sql`${appSettings.value} ->> 'estado' = 'enviando'`))
    .returning();
  return retomada ? { corte: new Date(corte), carga, tentativa } : null;
}

export type ResultadoEnvio = { enviados: number; jaEnviados: number; falhas: string[]; aviso: string | null };

/**
 * Envia a agenda a cada destinatário. No envio agendado, cada destinatário recebe uma vez por
 * dia (marca antes de enviar; se o envio falha, a marca sai para a próxima tentativa). O envio
 * manual ("enviar agora") tem a sua própria marca: não impede o das 20h, e repeti-lo no mesmo dia
 * só tenta de novo quem falhou (ou entrou na lista depois).
 */
export async function enviarAgenda(
  db: Db,
  organizacaoId: string,
  correio: Correio | null,
  agora: Date,
  o: { manual?: boolean; /** Só para testes. */ prazoProvedorMs?: number } = {},
): Promise<ResultadoEnvio> {
  const r: ResultadoEnvio = { enviados: 0, jaEnviados: 0, falhas: [], aviso: null };
  const config = await lerConfigAgenda(db, organizacaoId);
  if (!config.ativa && !o.manual) return { ...r, aviso: "agenda desligada" };
  if (!config.destinatarios.length) return { ...r, aviso: "sem destinatários" };
  if (!correio) return { ...r, aviso: "sem provedor de e-mail configurado: nada enviado" };
  const hoje = hojeISO("America/Sao_Paulo", agora);
  // Cada destinatário tem o seu marco de "reservas novas": quem falhou (ou entrou depois) recebe
  // tudo desde o que recebeu por último, sem depender dos outros.
  const agendas = new Map<string, Agenda>();
  const agendaDesde = async (desde: Date, corte: Date) => {
    const k = `${desde.toISOString()}|${corte.toISOString()}`;
    if (!agendas.has(k)) agendas.set(k, await montarAgenda(db, organizacaoId, hoje, desde, corte));
    return agendas.get(k)!;
  };
  // O relógio anda durante a execução: a trava de cada pessoa leva o horário de quando é tomada e de
  // quando é renovada (senão, depois de envios lentos, ela nasceria ou ficaria vencida).
  const inicio = Date.now();
  const relogio = () => new Date(agora.getTime() + (Date.now() - inicio));
  const enviarPara = async (d: Destinatario, trava: { chave: string; dono: string }, chaveForcada?: string): Promise<void> => {
    // Um envio de hoje do outro tipo ainda sem confirmação do provedor ("enviando"):
    // - "enviar agora" usa a marca e a chave do agendado (repete o mesmo pedido, que o provedor não
    //   duplica) em vez de mandar outro e-mail; antes de 15 minutos, espera;
    // - o das 20h primeiro fecha o manual pendente (mesmo pedido, mesma chave) e depois manda a
    //   agenda do dia com a própria chave: o pedido velho do manual não toma o lugar dela.
    let outraIncerta = false;
    let chave = chaveForcada ?? chaveEnvio(organizacaoId, hoje, d.email, o.manual);
    // Reservas novas de um manual ainda sem confirmação: não vão de novo no das 20h (se o manual não
    // chegou, a agenda seguinte as manda pelo caminho do envio incerto, com o aviso).
    let doManualPendente: string[] = [];
    if (!chaveForcada) {
      const outra = chaveEnvio(organizacaoId, hoje, d.email, !o.manual);
      const [daOutra] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, outra));
      const incerta = (daOutra?.value as { estado?: string } | undefined)?.estado === "enviando";
      if (incerta && !o.manual) {
        const antes = r.enviados;
        await enviarPara(d, trava, outra);
        if (r.enviados === antes) {
          const [ainda] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, outra));
          const v = ainda?.value as { estado?: string; carga?: unknown } | undefined;
          if (v?.estado === "enviando" && cargaValida(v.carga)) doManualPendente = v.carga.eventos;
        }
      } else if (incerta) {
        outraIncerta = true;
        chave = outra;
      }
    }
    const incertos = await reconciliarIncertos(db, pendentes, d.email, hoje);
    const incertoAte = incertos.ate;
    const reserva = await reservarEnvio(db, chave, agora);
    if (!reserva) {
      // "Já enviado" só se a marca diz "enviado": uma tentativa ainda sem confirmação do provedor
      // (deste tipo ou do outro) continua como falha até a retomada dar certo.
      const [marca] = outraIncerta ? [] : await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, chave));
      const emAberto = outraIncerta || (marca?.value as { estado?: string } | undefined)?.estado === "enviando";
      if (emAberto) r.falhas.push(`${d.email}: o envio anterior de hoje ainda não foi confirmado pelo provedor; nova tentativa com o mesmo e-mail depois de 15 minutos`);
      else r.jaEnviados++;
      return;
    }
    const { corte, tentativa } = reserva;
    const daTentativa = sql`${appSettings.value} ->> 'tentativa' = ${tentativa}`;
    let carga = reserva.carga;
    try {
      if (!carga) {
        // Sem marco próprio (primeira agenda desta pessoa): as reservas novas das 24h antes do corte.
        const marco = await lerMarco(db, chaveUltimaDe(organizacaoId, d.email));
        const umDia = new Date(corte.getTime() - 86_400_000);
        const desde = marco ? new Date(marco.getTime() - SOBREPOSICAO_MS) : umDia;
        // Imóveis que o marco não cobre (inativos no envio anterior, ou de cidade nova para a pessoa): desde 24h, como quem é novo.
        const cobertas = marco ? await lerCobertura(db, chaveUltimaDe(organizacaoId, d.email)) : null;
        const coberto = (imovelId: string) => cobertas === null || cobertas.includes(imovelId);
        // Imóvel que estava num envio incerto ainda não coberto: a faixa dele começa nas 24h (mais a
        // sobreposição) antes do corte daquele envio. Se ele não chegou, as reservas dele vão agora.
        const inicioIncerto = (i: Incerto) => (i.corte ? new Date(i.corte.getTime() - 86_400_000 - SOBREPOSICAO_MS) : null);
        const inicioDe = (imovelId: string) => {
          let t = coberto(imovelId) ? desde : umDia;
          for (const i of incertos.lista) {
            const ini = inicioIncerto(i);
            if (ini && ini < t && (i.imoveis === null || i.imoveis.includes(imovelId))) t = ini;
          }
          return t;
        };
        let menor = desde < umDia ? desde : umDia;
        for (const i of incertos.lista) {
          const ini = inicioIncerto(i);
          if (ini && ini < menor) menor = ini;
        }
        const avisadas = [...(await lerAvisadas(db, chaveAvisadasDe(organizacaoId, d.email))), ...doManualPendente.map((id) => ({ id, corte: corte.toISOString() }))];
        const bruta = await agendaDesde(menor, corte);
        const agenda = semAvisadas(
          { ...bruta, secoes: bruta.secoes.map((x) => ({ ...x, novas: x.novas.filter((n) => Date.parse(n.registradaEm) > inicioDe(n.imovelId).getTime()) })) },
          avisadas,
        );
        // Só o que vai no e-mail desta pessoa (as cidades dela) conta como avisado.
        const noEmail = agenda.secoes.filter((x) => !d.cidades.length || d.cidades.includes(x.cidade));
        carga = {
          assunto: `Agenda SCL — ${diaCurto(agenda.dias[0])} a ${diaCurto(agenda.dias.at(-1)!)}`,
          texto: textoDaAgenda(agenda, d.cidades, { ...config, incertoAte }),
          eventos: noEmail.flatMap((x) => x.novas.map((n) => n.evento)),
          imoveis: noEmail.flatMap((x) => x.imovelIds).sort(),
        };
        // Guarda o pedido antes de enviar: uma retomada manda exatamente o mesmo.
        const [minha] = await db
          .update(appSettings)
          .set({ value: { em: agora.toISOString(), estado: "enviando", corte: corte.toISOString(), tentativa, carga }, updatedAt: new Date() })
          .where(and(eq(appSettings.key, chave), daTentativa))
          .returning({ key: appSettings.key });
        if (!minha) {
          // Esta tentativa passou do prazo e outra a retomou: quem retomou envia; esta não chama o provedor.
          r.falhas.push(`${d.email}: tentativa demorou demais e foi retomada por outra execução`);
          return;
        }
      }
      // Logo antes do provedor: a trava da pessoa ainda é desta execução (e ganha prazo novo). Se outra
      // a tomou (esta demorou mais que o prazo), esta não envia: senão, com chaves diferentes (manual e
      // agendado), a pessoa receberia duas vezes.
      if (!(await renovarPessoa(db, trava.chave, trava.dono, relogio()))) {
        r.falhas.push(`${d.email}: tentativa demorou demais e foi retomada por outra execução`);
        return;
      }
      // A mesma chave do dia vai para o provedor: uma nova tentativa do mesmo envio não duplica.
      // Com prazo bem menor que o da trava: uma chamada presa vira "incerta" (a marca e o pedido ficam
      // para a retomada), em vez de continuar depois que outra execução pode ter tomado a trava.
      await comPrazo(correio.enviar({ para: d.email, assunto: carga.assunto, texto: carga.texto, chave }), o.prazoProvedorMs ?? PRAZO_PROVEDOR_MS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof ErroEnvioIncerto) {
        // Pode ter saído: a marca fica "enviando" com o pedido guardado. Uma retomada depois de 15
        // minutos repete o mesmo pedido com a mesma chave; se virar o dia, vira "incerto" e a agenda
        // seguinte avisa que as reservas podem já ter vindo.
        r.falhas.push(`${d.email}: envio incerto (${msg}); nova tentativa com o mesmo e-mail depois de 15 minutos`);
        return;
      }
      // O provedor recusou (ou nem chegou a ser chamado): libera para tentar de novo.
      await db.delete(appSettings).where(and(eq(appSettings.key, chave), daTentativa));
      r.falhas.push(`${d.email}: ${msg}`);
      return;
    }
    // Daqui em diante o e-mail já saiu: falha ao registrar não libera outro envio (a marca fica).
    r.enviados++;
    const enviada = carga;
    try {
      // Marca do dia e marco das reservas novas juntos: ou os dois, ou nenhum.
      await db.transaction(async (tx) => {
        const [dona] = await tx
          .update(appSettings)
          .set({ value: { em: agora.toISOString(), estado: "enviado", corte: corte.toISOString() }, updatedAt: new Date() })
          .where(and(eq(appSettings.key, chave), daTentativa))
          .returning({ key: appSettings.key });
        // A marca foi retomada por outra tentativa (esta passou do prazo): ela repete o mesmo pedido e registra.
        if (!dona) return;
        // "Enviar agora" que fechou o agendado pendente: o manual do dia também está feito (outro clique
        // hoje não manda de novo para esta pessoa).
        if (outraIncerta) {
          await tx
            .insert(appSettings)
            .values({ key: chaveEnvio(organizacaoId, hoje, d.email, true), value: { em: agora.toISOString(), estado: "enviado", corte: corte.toISOString() } })
            .onConflictDoNothing();
        }
        // Um envio por vez mexe no marco desta pessoa ("enviar agora" junto com o das 20h): relê com
        // trava, fica o maior corte e junta as avisadas dos dois.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${chaveUltimaDe(organizacaoId, d.email)}))`);
        const marcoAtual = await lerMarco(tx, chaveUltimaDe(organizacaoId, d.email));
        const marco = marcoAtual && marcoAtual > corte ? marcoAtual : corte;
        // Cobertura do marco que fica: a deste envio ou, se um envio mais novo já gravou, a dele. Nunca
        // é somada e é por imóvel: imóvel inativo, ou de cidade que saiu da lista, não fica coberto e,
        // ao voltar, conta como novo para a pessoa (reservas novas das últimas 24h).
        const deste = enviada.imoveis;
        const cobertura = marcoAtual && marcoAtual > corte ? await lerCobertura(tx, chaveUltimaDe(organizacaoId, d.email)) : deste;
        await gravarMarco(tx, chaveUltimaDe(organizacaoId, d.email), marco, cobertura);
        // As reservas novas deste envio: na próxima, a faixa de sobreposição não as repete.
        const atuais = await lerAvisadas(tx, chaveAvisadasDe(organizacaoId, d.email));
        const value = { avisadas: avisadasDepois(atuais, enviada.eventos, corte, marco) };
        await tx
          .insert(appSettings)
          .values({ key: chaveAvisadasDe(organizacaoId, d.email), value })
          .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
        // Os envios incertos de dias anteriores cobertos por este (com o aviso): resolvidos. Só os que
        // este e-mail cobre por inteiro: um imóvel dele que ficou de fora (inativo, cidade que saiu da
        // lista) deixa o incerto aberto, e as reservas dele saem quando o imóvel voltar.
        // E só se cada reserva nova daquele envio foi entregue (neste ou antes) ou já não precisa de
        // aviso (saída já passou, ou deixou de estar confirmada).
        for (const i of incertos.lista) {
          const foraImoveis = i.imoveis === null ? [] : i.imoveis.filter((x) => !enviada.imoveis.includes(x));
          const faltam = i.eventos.filter((e) => !enviada.eventos.includes(e) && !atuais.some((a) => a.id === e));
          const ids = [...new Set(faltam.map((e) => e.split("@")[0]).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
          const aindaValem = ids.length
            ? await tx
                .select({ id: reservas.id, imovelId: reservas.imovelId })
                .from(reservas)
                .where(and(inArray(reservas.id, ids), eq(reservas.estado, "confirmada"), gte(reservas.checkout, hoje)))
            : [];
          // Evento substituído (a reserva foi confirmada de novo depois dele: é outro evento, que segue o
          // seu próprio caminho) não segura o incerto.
          const reconfirmadas = aindaValem.length
            ? await tx
                .select({ id: auditoria.entidadeId, em: sql<string>`to_char(max(${auditoria.criadoEm}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` })
                .from(auditoria)
                .where(
                  and(
                    eq(auditoria.entidade, "reserva"),
                    inArray(
                      auditoria.entidadeId,
                      aindaValem.map((x) => x.id),
                    ),
                    sql`${auditoria.mudancas} -> 'estado' ->> 1 = 'confirmada'`,
                  ),
                )
                .groupBy(auditoria.entidadeId)
            : [];
          const eventos = faltam.filter((e) => {
            const [id, em] = e.split("@");
            if (!aindaValem.some((x) => x.id === id)) return false;
            const ultima = reconfirmadas.find((x) => x.id === id)?.em;
            return !(ultima && Date.parse(ultima) > Date.parse(em));
          });
          const pendentesIds = new Set(eventos.map((e) => e.split("@")[0]));
          if (!foraImoveis.length && !eventos.length) {
            await tx.update(appSettings).set({ value: sql`jsonb_set(${appSettings.value}, '{estado}', '"resolvido"')`, updatedAt: new Date() }).where(eq(appSettings.key, i.chave));
            continue;
          }
          // Parcial: o incerto fica só com o que ainda falta (imóveis de fora e reservas não entregues).
          // O que este e-mail já entregou sai dele, para a faixa do incerto não o mandar de novo.
          const imoveisRestantes = [...new Set([...foraImoveis, ...aindaValem.filter((x) => pendentesIds.has(x.id)).map((x) => x.imovelId)])].sort();
          await tx
            .update(appSettings)
            .set({
              value: sql`jsonb_set(jsonb_set(${appSettings.value}, '{carga,eventos}', ${JSON.stringify(eventos)}::jsonb, true), '{carga,imoveis}', ${JSON.stringify(imoveisRestantes)}::jsonb, true)`,
              updatedAt: new Date(),
            })
            .where(eq(appSettings.key, i.chave));
        }
      });
    } catch (e) {
      r.falhas.push(`${d.email}: enviada, mas não foi possível registrar o envio (${e instanceof Error ? e.message : String(e)})`);
    }
  };
  await limparMarcasAntigas(db, organizacaoId, hoje);
  const pendentes = await marcasPendentes(db, organizacaoId);

  for (const d of config.destinatarios) {
    const trava = chaveTravaDe(organizacaoId, d.email);
    const dono = await travarPessoa(db, trava, relogio());
    if (!dono) {
      r.falhas.push(`${d.email}: outro envio para esta pessoa está em andamento; tente de novo em alguns minutos`);
      continue;
    }
    try {
      await enviarPara(d, { chave: trava, dono });
    } finally {
      await soltarPessoa(db, trava, dono);
    }
  }

  // Para a tela: quando a agenda saiu por último (para alguém).
  if (r.enviados) {
    // Nunca volta: uma execução mais antiga que termina depois não troca o horário de uma mais nova.
    const value = { em: agora.toISOString() };
    await db
      .insert(appSettings)
      .values({ key: chaveUltima(organizacaoId), value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: sql`case when (${appSettings.value} ->> 'em')::timestamptz >= ${value.em}::timestamptz then ${appSettings.value} else excluded.value end`, updatedAt: new Date() },
      });
  }
  return r;
}

/** Resumo legível para a página "Sistema" (sem e-mails nem dados pessoais). */
export function resumoDoEnvio(r: ResultadoEnvio): string {
  if (r.aviso) return r.aviso;
  const partes = [`${r.enviados} enviada(s)`];
  if (r.jaEnviados) partes.push(`${r.jaEnviados} já enviada(s) hoje`);
  if (r.falhas.length) partes.push(`${r.falhas.length} falha(s)`);
  return partes.join(", ");
}
