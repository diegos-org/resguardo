/**
 * Agenda diária da equipe (M6.3). Todo dia às 20h: entradas, saídas e limpezas dos próximos
 * cinco dias, uma seção por cidade (Rio e Búzios separados, nunca somados), mais as reservas
 * novas desde a última agenda, mesmo fora da janela. A agenda só informa: não confirma limpeza
 * (a limpeza "pedida" aparece como "a confirmar").
 *
 * Quem recebe e se a agenda está ligada fica em Configurações (config "agenda"), editável no
 * painel. Envio pelo mesmo adaptador de e-mail do login (M1.3); em teste, nada sai.
 */
import { and, asc, eq, gt, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import { appSettings, auditoria, imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { hojeISO } from "@/lib/datas";
import { listarLimpezas, NOMES_ESTADO, sincronizarLimpezas } from "@/limpezas/limpezas";

export const DIAS_AGENDA = 5;

const dia = (d: string) => Date.parse(`${d}T00:00:00Z`);
const somaDias = (d: string, n: number) => new Date(dia(d) + n * 86_400_000).toISOString().slice(0, 10);
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const diaCurto = (d: string) => `${SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.split("-").reverse().slice(0, 2).join("/")}`;

// ——— Configuração (editável no painel) ———

export type Destinatario = { email: string; /** Vazio = todas as cidades. */ cidades: string[] };
export type ConfigAgenda = { ativa: boolean; destinatarios: Destinatario[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function lerConfigAgenda(db: Db, organizacaoId: string): Promise<ConfigAgenda> {
  const c = await lerConfig(db, organizacaoId, "agenda");
  const lista = Array.isArray(c?.destinatarios) ? (c.destinatarios as unknown[]) : [];
  const destinatarios = lista
    .filter((d): d is Destinatario => !!d && typeof (d as Destinatario).email === "string" && Array.isArray((d as Destinatario).cidades))
    .map((d) => ({ email: d.email, cidades: d.cidades.filter((x) => typeof x === "string") }));
  return { ativa: c?.ativa === true, destinatarios };
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

export async function salvarConfigAgenda(db: Db, organizacaoId: string, c: ConfigAgenda, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  // Cidades válidas: as dos imóveis ativos e as já configuradas (imóvel renomeado ou inativado
  // não vira "todas as cidades" por engano: a escolha continua como estava).
  const anterior = await lerConfigAgenda(db, organizacaoId);
  const cidades = [...(await cidadesDosImoveis(db, organizacaoId)), ...anterior.destinatarios.flatMap((d) => d.cidades)];
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
  await db.transaction((tx) => gravarConfig(tx, organizacaoId, "agenda", { ativa: c.ativa, destinatarios }, autorId));
  return { ok: true };
}

// ——— Montagem ———

export type ItemAgenda =
  | { tipo: "entrada" | "saida"; imovel: string; reserva: string; hospede: string; hospedes: number | null }
  | { tipo: "limpeza"; imovel: string; estado: string; profissional: string | null; avisos: string[] };

export type NovaReserva = { imovel: string; reserva: string; hospede: string; hospedes: number | null; checkin: string; checkout: string };

export type SecaoCidade = { cidade: string; dias: { data: string; itens: ItemAgenda[] }[]; novas: NovaReserva[] };

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
              eq(reservas.estado, "confirmada"),
              inArray(reservas.imovelId, ids),
              // Nova = criada já confirmada depois do marco, ou que passou a confirmada depois dele
              // (pendente/cancelada que confirmou numa sincronização: registrada no histórico).
              // Até `novasAte` (o corte gravado como marco): o que entrar depois fica para a próxima.
              or(
                and(gt(reservas.criadoEm, novasDesde), lte(reservas.criadoEm, novasAte)),
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
    if (!s) porCidade.set(cidade, (s = { cidade, dias: dias.map((data) => ({ data, itens: [] })), novas: [] }));
    return s;
  };
  for (const i of ativos) secao(i.cidade);
  const noDia = (cidade: string, data: string) => secao(cidade).dias.find((d) => d.data === data);

  for (const r of daJanela) {
    const im = doImovel.get(r.imovelId)!;
    const base = { imovel: im.codigo, reserva: r.codigo, hospede: primeiroNome(r.hospedeNome), hospedes: r.hospedes };
    noDia(im.cidade, r.checkin)?.itens.push({ tipo: "entrada", ...base });
    noDia(im.cidade, r.checkout)?.itens.push({ tipo: "saida", ...base });
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
  for (const r of novas) {
    const im = doImovel.get(r.imovelId)!;
    secao(im.cidade).novas.push({ imovel: im.codigo, reserva: r.codigo, hospede: primeiroNome(r.hospedeNome), hospedes: r.hospedes, checkin: r.checkin, checkout: r.checkout });
  }
  const secoes = [...porCidade.values()].sort((a, b) => a.cidade.localeCompare(b.cidade, "pt-BR"));
  for (const s of secoes) for (const d of s.dias) d.itens.sort((a, b) => ORDEM[a.tipo] - ORDEM[b.tipo] || a.imovel.localeCompare(b.imovel));
  return { hoje, dias, secoes };
}

// ——— Texto do e-mail ———

const pessoas = (n: number | null) => (n === null ? "nº de hóspedes não informado" : `${n} hóspede(s)`);

export function textoDoItem(i: ItemAgenda): string {
  if (i.tipo === "limpeza") {
    const quem = i.profissional ? ` · ${i.profissional}` : " · sem profissional";
    return `Limpeza ${i.imovel} — ${i.estado}${quem}${i.avisos.length ? ` · atenção: ${i.avisos.join(" ")}` : ""}`;
  }
  const nome = i.hospede || "hóspede sem nome";
  return `${i.tipo === "entrada" ? "Entrada" : "Saída"} ${i.imovel} — ${nome}, ${pessoas(i.hospedes)} (${i.reserva})`;
}

export function textoDaNova(n: NovaReserva): string {
  return `${n.imovel}: entrada ${diaCurto(n.checkin)}, saída ${diaCurto(n.checkout)} — ${n.hospede || "hóspede sem nome"}, ${pessoas(n.hospedes)} (${n.reserva})`;
}

/** Texto simples do e-mail, só com as cidades pedidas (vazio = todas). */
export function textoDaAgenda(a: Agenda, cidades: readonly string[] = []): string {
  const secoes = a.secoes.filter((s) => !cidades.length || cidades.includes(s.cidade));
  const linhas = [`Agenda de ${diaCurto(a.dias[0])} a ${diaCurto(a.dias.at(-1)!)} (próximos ${a.dias.length} dias).`, "A agenda informa; não confirma limpeza.", ""];
  for (const s of secoes) {
    linhas.push(`=== ${s.cidade} ===`);
    for (const d of s.dias) {
      linhas.push(`${diaCurto(d.data)}:`);
      if (!d.itens.length) linhas.push("  nada previsto");
      for (const i of d.itens) linhas.push(`  - ${textoDoItem(i)}`);
    }
    if (s.novas.length) {
      linhas.push("Reservas novas desde a última agenda:");
      for (const n of s.novas) linhas.push(`  - ${textoDaNova(n)}`);
    }
    linhas.push("");
  }
  if (!secoes.length) linhas.push("Nenhum imóvel ativo nas cidades deste destinatário.");
  return linhas.join("\n").trimEnd() + "\n";
}

// ——— Envio ———

const chaveUltima = (org: string) => `agenda-diaria:ultima:${org}`;
/** Marca de "já recebeu hoje": uma para o envio das 20h e outra para o "enviar agora" (um não bloqueia o outro). */
const chaveEnvio = (org: string, data: string, email: string, manual = false) => `agenda-diaria${manual ? "-manual" : ""}:${org}:${data}:${email}`;

const chaveUltimaDe = (org: string, email: string) => `agenda-diaria:ultima:${org}:${email}`;

async function lerMarco(db: Db, chave: string): Promise<Date | null> {
  const [l] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, chave));
  const em = (l?.value as { em?: unknown } | undefined)?.em;
  return typeof em === "string" && !Number.isNaN(Date.parse(em)) ? new Date(em) : null;
}

async function gravarMarco(db: Db, chave: string, em: Date): Promise<void> {
  const value = { em: em.toISOString() };
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

/** O que a agenda mandaria agora (para a tela): novas desde a última agenda, ou das últimas 24h. */
export async function previaDaAgenda(db: Db, organizacaoId: string, agora: Date = new Date()): Promise<{ agenda: Agenda; ultima: Date | null }> {
  const ultima = await ultimaAgenda(db, organizacaoId);
  const agenda = await montarAgenda(db, organizacaoId, hojeISO("America/Sao_Paulo", agora), ultima ?? new Date(agora.getTime() - 86_400_000));
  return { agenda, ultima };
}

/** Tentativa "enviando" mais velha que isto (a execução caiu no meio) pode ser refeita. */
const ENVIO_EXPIRA_MS = 15 * 60_000;

/**
 * Marca o envio do dia para este destinatário como "enviando". Devolve false se já foi enviado
 * ou se há outra tentativa em andamento (recente); uma tentativa antiga que ficou pela metade
 * (execução interrompida antes de confirmar) é retomada.
 */
async function reservarEnvio(db: Db, chave: string, agora: Date): Promise<{ corte: Date } | null> {
  // `corte`: o limite das reservas novas desta tentativa. Uma retomada reaproveita o da tentativa
  // original (o provedor ignora o reenvio com a mesma chave; o marco tem de ser o do e-mail que saiu).
  const valor = { em: agora.toISOString(), estado: "enviando", corte: agora.toISOString() };
  const [nova] = await db.insert(appSettings).values({ key: chave, value: valor }).onConflictDoNothing().returning();
  if (nova) return { corte: agora };
  const [l] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, chave));
  const v = (l?.value ?? {}) as { em?: string; estado?: string; corte?: string };
  if (v.estado !== "enviando" || !v.em || agora.getTime() - Date.parse(v.em) < ENVIO_EXPIRA_MS) return null;
  const corte = v.corte && !Number.isNaN(Date.parse(v.corte)) ? v.corte : v.em;
  // Troca só se ninguém retomou antes (compara o valor antigo).
  const [retomada] = await db
    .update(appSettings)
    .set({ value: { ...valor, corte }, updatedAt: new Date() })
    .where(and(eq(appSettings.key, chave), sql`${appSettings.value} ->> 'em' = ${v.em}`, sql`${appSettings.value} ->> 'estado' = 'enviando'`))
    .returning();
  return retomada ? { corte: new Date(corte) } : null;
}

export type ResultadoEnvio = { enviados: number; jaEnviados: number; falhas: string[]; aviso: string | null };

/**
 * Envia a agenda a cada destinatário. No envio agendado, cada destinatário recebe uma vez por
 * dia (marca antes de enviar; se o envio falha, a marca sai para a próxima tentativa). O envio
 * manual ("enviar agora") tem a sua própria marca: não impede o das 20h, e repeti-lo no mesmo dia
 * só tenta de novo quem falhou (ou entrou na lista depois).
 */
export async function enviarAgenda(db: Db, organizacaoId: string, correio: Correio | null, agora: Date, o: { manual?: boolean } = {}): Promise<ResultadoEnvio> {
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
  for (const d of config.destinatarios) {
    const chave = chaveEnvio(organizacaoId, hoje, d.email, o.manual);
    const reserva = await reservarEnvio(db, chave, agora);
    if (!reserva) {
      r.jaEnviados++;
      continue;
    }
    const { corte } = reserva;
    try {
      // Sem marco próprio (primeira agenda desta pessoa): as reservas novas das últimas 24h.
      const desde = (await lerMarco(db, chaveUltimaDe(organizacaoId, d.email))) ?? new Date(agora.getTime() - 86_400_000);
      const agenda = await agendaDesde(desde, corte);
      // A mesma chave do dia vai para o provedor: uma nova tentativa do mesmo envio não duplica.
      await correio.enviar({ para: d.email, assunto: `Agenda SCL — ${diaCurto(agenda.dias[0])} a ${diaCurto(agenda.dias.at(-1)!)}`, texto: textoDaAgenda(agenda, d.cidades), chave });
    } catch (e) {
      // O provedor não aceitou: libera para tentar de novo.
      await db.delete(appSettings).where(eq(appSettings.key, chave));
      r.falhas.push(`${d.email}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    // Daqui em diante o e-mail já saiu: falha ao registrar não libera outro envio (a marca fica).
    r.enviados++;
    try {
      // Marca do dia e marco das reservas novas juntos: ou os dois, ou nenhum.
      await db.transaction(async (tx) => {
        await tx.update(appSettings).set({ value: { em: agora.toISOString(), estado: "enviado", corte: corte.toISOString() }, updatedAt: new Date() }).where(eq(appSettings.key, chave));
        await gravarMarco(tx, chaveUltimaDe(organizacaoId, d.email), corte);
      });
    } catch (e) {
      r.falhas.push(`${d.email}: enviada, mas não foi possível registrar o envio (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  // Para a tela: quando a agenda saiu por último (para alguém).
  if (r.enviados) await gravarMarco(db, chaveUltima(organizacaoId), agora);
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
