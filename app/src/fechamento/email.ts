/**
 * Envio mensal do fechamento por e-mail (M5.4): no dia 1º (e nos dias seguintes, até sair), cada
 * proprietário recebe o relatório em PDF do mês anterior, **só depois de fechado**:
 * - com repasse gerado (Financeiro → Repasses), ou
 * - sem nada a transferir e sem pendência que impeça o fechamento.
 * Mês com pendência (acerto pendente, ajuste a esclarecer…) não sai: o resultado avisa quem ficou.
 *
 * Uma vez por proprietário e mês: a marca é gravada antes de chamar o provedor, com o pedido
 * (texto e PDF) guardado. Se o provedor recusar, a marca sai e a próxima execução tenta de novo;
 * se não der para saber se saiu, a retomada (depois de 15 minutos) repete o mesmo pedido com a
 * mesma chave, e o provedor não duplica.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import { appSettings, representantes } from "@/db/schema";
import type { Db } from "@/db/types";
import { type Correio, ErroEnvioIncerto } from "@/email/correio";
import { hojeISO } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { relatorioDoFechamento } from "@/relatorios/gerar";
import { imoveisDoProprietario } from "@/relatorios/relatorio";
import { limitesDoMes, mesAFechar, nomeMes, preverRepasses, type PrevisaoRepasse, somarMes } from "@/repasses/repasses";

/** `ativoDesde`: o primeiro mês que o envio automático cobre (o mês a fechar quando foi ligado). */
export type ConfigFechamentoEmail = { ativo: boolean; assunto: string; texto: string; ativoDesde?: string };

export const ASSUNTO_PADRAO = "Fechamento de {mes} — Sua Casa Leblon";
export const TEXTO_PADRAO =
  "Olá, {nome}.\n\nSegue em anexo o relatório de {mes} dos seus imóveis, com as reservas, os valores e o saldo do mês.\n\nQualquer dúvida, é só responder este e-mail.";

/** Uma retomada só depois deste tempo sem confirmação (a tentativa pode ainda estar em andamento). */
const RETOMADA_MS = 15 * 60_000;
/**
 * A chave de idempotência do provedor vale 24h a partir do primeiro pedido: depois disso, repetir
 * poderia mandar o PDF de novo. Tentativa sem confirmação mais velha que isso vira "incerto" e não é
 * repetida sozinha (o painel mostra; quem decide reenviar é a pessoa).
 */
const JANELA_PROVEDOR_MS = 23 * 3_600_000;
/** Quantos meses para trás o envio automático ainda tenta (mês fechado com atraso). */
const MESES_PARA_TRAS = 12;

export async function lerConfigFechamentoEmail(db: Db, organizacaoId: string): Promise<ConfigFechamentoEmail> {
  const c = await lerConfig(db, organizacaoId, "fechamento_email");
  const texto = (v: unknown, padrao: string) => (typeof v === "string" && v.trim() ? v : padrao);
  const ativoDesde = typeof c?.ativoDesde === "string" && limitesDoMes(c.ativoDesde) ? c.ativoDesde : undefined;
  return { ativo: c?.ativo === true, assunto: texto(c?.assunto, ASSUNTO_PADRAO), texto: texto(c?.texto, TEXTO_PADRAO), ...(ativoDesde ? { ativoDesde } : {}) };
}

export async function salvarConfigFechamentoEmail(
  db: Db,
  organizacaoId: string,
  c: Omit<ConfigFechamentoEmail, "ativoDesde">,
  autorId: string | null,
  agora: Date = new Date(),
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const assunto = c.assunto.trim();
  const texto = c.texto.replace(/\r\n/g, "\n").trim();
  if (!assunto || assunto.length > 200) return { ok: false, erro: "Assunto obrigatório, até 200 caracteres." };
  if (!texto || texto.length > 4000) return { ok: false, erro: "Texto obrigatório, até 4000 caracteres." };
  const desconhecida = [...`${assunto} ${texto}`.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).find((x) => !["nome", "mes"].includes(x));
  if (desconhecida !== undefined) return { ok: false, erro: `Campo desconhecido: {${desconhecida}}. Use {nome} e {mes}.` };
  // Ligado agora: o automático cobre do mês a fechar em diante (não manda meses antigos de uma vez).
  const anterior = await lerConfigFechamentoEmail(db, organizacaoId);
  const ativoDesde = c.ativo ? (anterior.ativo && anterior.ativoDesde ? anterior.ativoDesde : mesAFechar(hojeISO("America/Sao_Paulo", agora))) : undefined;
  await db.transaction((tx) => gravarConfig(tx, organizacaoId, "fechamento_email", { ativo: c.ativo, assunto, texto, ...(ativoDesde ? { ativoDesde } : {}) }, autorId));
  return { ok: true };
}

const preencher = (modelo: string, nome: string, mes: string) => modelo.replaceAll("{nome}", nome).replaceAll("{mes}", nomeMes(mes).toLowerCase());

/** O que vai no e-mail além do texto: o valor do mês, tirado do fechamento (nunca calculado de novo aqui). */
function linhaDoValor(p: PrevisaoRepasse): string {
  const r = p.repasse;
  if (r) return r.situacao === "pago" ? `Repasse do mês: ${formatBRL(r.valor)}, pago em ${r.dataPagamento!.split("-").reverse().join("/")}.` : `Repasse do mês: ${formatBRL(r.valor)}.`;
  if (p.deve > 0) return `Saldo do mês: você deve ${formatBRL(p.deve)} à Sua Casa Leblon (detalhes no relatório).`;
  return "Não há valor a repassar neste mês.";
}

/** incerto: tentativa sem confirmação do provedor por mais tempo do que a chave dele vale (pode ter chegado). */
export type Situacao = "pronto" | "enviado" | "incerto" | "pendente" | "sem_email";

/**
 * Situação do e-mail de cada proprietário no mês (a tela e o envio usam a mesma regra). Entra quem
 * tinha imóvel ou movimento naquele mês (o mesmo critério do PDF), mesmo com saldo zero. Destinos: o
 * e-mail do proprietário e, em cópia, os representantes que recebem os relatórios. Mês reaberto
 * (repasse estornado) volta a "pendente", mesmo já enviado: só sai de novo depois de fechado.
 */
export async function situacaoDosFechamentos(
  db: Db,
  organizacaoId: string,
  mes: string,
  hoje: string,
): Promise<(PrevisaoRepasse & { email: string; destinos: string[]; situacao: Situacao; enviadoEm: string | null; enviadoPara: string[] })[]> {
  const periodo = limitesDoMes(mes);
  if (!periodo) return [];
  const todos = await preverRepasses(db, organizacaoId, mes, hoje, undefined, true);
  const doMes = await Promise.all(todos.map(async (p) => (await imoveisDoProprietario(db, organizacaoId, p.proprietarioId, periodo)).length > 0));
  const lista = todos.filter((p, i) => p.repasse || p.saldo !== 0 || p.contestado !== 0 || p.aDescontar !== 0 || doMes[i]);
  const [marcas, reps] = lista.length
    ? await Promise.all([
        db
          .select({ key: appSettings.key, value: appSettings.value })
          .from(appSettings)
          .where(inArray(appSettings.key, lista.map((p) => chaveDoEnvio(organizacaoId, p.proprietarioId, mes)))),
        db
          .select({ proprietarioId: representantes.proprietarioId, email: representantes.email })
          .from(representantes)
          .where(and(inArray(representantes.proprietarioId, lista.map((p) => p.proprietarioId)), eq(representantes.recebeRelatorios, true))),
      ])
    : [[], []];
  return lista.map((p) => {
    const marca = marcas.find((m) => m.key === chaveDoEnvio(organizacaoId, p.proprietarioId, mes))?.value as { estado?: string; em?: string; destinos?: unknown } | undefined;
    const email = (p.email ?? "").trim();
    const destinos = [...new Set([email, ...reps.filter((r) => r.proprietarioId === p.proprietarioId).map((r) => r.email.trim())].filter(Boolean))];
    const fechado = !!p.repasse || (p.valor <= 0 && p.bloqueios.length === 0);
    const enviado = marca?.estado === "enviado";
    const situacao: Situacao = !fechado ? "pendente" : enviado ? "enviado" : marca?.estado === "incerto" ? "incerto" : !destinos.length ? "sem_email" : "pronto";
    // Para quem foi, como gravado no envio (não o cadastro de hoje).
    const enviadoPara = enviado && Array.isArray(marca.destinos) ? marca.destinos.filter((x): x is string => typeof x === "string") : [];
    return { ...p, email, destinos, situacao, enviadoEm: enviado ? (marca.em ?? null) : null, enviadoPara };
  });
}

export const chaveDoEnvio = (organizacaoId: string, proprietarioId: string, mes: string) => `fechamento-email:${organizacaoId}:${proprietarioId}:${mes}`;

/** O pedido guardado: uma retomada manda exatamente o mesmo, para os mesmos endereços. */
type Carga = { destinos: string[]; assunto: string; texto: string; arquivo: string; pdf: string };
const cargaValida = (c: unknown): c is Carga =>
  !!c &&
  typeof c === "object" &&
  ["assunto", "texto", "arquivo", "pdf"].every((k) => typeof (c as Record<string, unknown>)[k] === "string") &&
  Array.isArray((c as Carga).destinos) &&
  (c as Carga).destinos.length > 0 &&
  (c as Carga).destinos.every((d) => typeof d === "string");

/**
 * Toma a marca do envio: nova, ou uma tentativa sem confirmação há mais de 15 minutos (retomada,
 * com o pedido guardado). Devolve null se já foi enviado ou se outra tentativa está em andamento.
 */
async function reservar(db: Db, chave: string, agora: Date): Promise<{ tentativa: string; carga: Carga | null } | "ocupado" | "incerto"> {
  const tentativa = crypto.randomUUID();
  const [nova] = await db
    .insert(appSettings)
    .values({ key: chave, value: { estado: "enviando", em: agora.toISOString(), primeira: agora.toISOString(), tentativa } })
    .onConflictDoNothing()
    .returning({ key: appSettings.key });
  if (nova) return { tentativa, carga: null };
  // Passou da janela da chave do provedor: não repete sozinho (poderia chegar duas vezes).
  const janela = new Date(agora.getTime() - JANELA_PROVEDOR_MS).toISOString();
  const [vencida] = await db
    .update(appSettings)
    .set({ value: sql`jsonb_set(${appSettings.value}, '{estado}', '"incerto"')`, updatedAt: new Date() })
    .where(
      and(
        eq(appSettings.key, chave),
        sql`${appSettings.value} ->> 'estado' = 'enviando'`,
        sql`coalesce(${appSettings.value} ->> 'primeira', ${appSettings.value} ->> 'em')::timestamptz < ${janela}::timestamptz`,
      ),
    )
    .returning({ key: appSettings.key });
  if (vencida) return "incerto";
  const limite = new Date(agora.getTime() - RETOMADA_MS).toISOString();
  const [velha] = await db
    .update(appSettings)
    .set({ value: sql`jsonb_set(jsonb_set(${appSettings.value}, '{tentativa}', ${JSON.stringify(tentativa)}::jsonb), '{em}', ${JSON.stringify(agora.toISOString())}::jsonb)`, updatedAt: new Date() })
    .where(and(eq(appSettings.key, chave), sql`${appSettings.value} ->> 'estado' = 'enviando'`, sql`(${appSettings.value} ->> 'em')::timestamptz < ${limite}::timestamptz`))
    .returning({ value: appSettings.value });
  if (!velha) return "ocupado";
  const carga = (velha.value as { carga?: unknown }).carga;
  return { tentativa, carga: cargaValida(carga) ? carga : null };
}

export type ResultadoFechamentoEmail = {
  mes: string;
  enviados: number;
  jaEnviados: number;
  pendentes: string[];
  semEmail: string[];
  /** Sem confirmação do provedor e fora da janela da chave: pode ter chegado; conferir no painel. */
  incertos: string[];
  falhas: string[];
  aviso: string | null;
};

/**
 * Envia o fechamento do mês (padrão: o mês anterior a hoje) a cada proprietário pronto.
 * `proprietarioId`: só esse (botão do painel). `reenviar`: manda de novo mesmo já enviado (com
 * chave nova; a marca continua "enviado").
 */
export async function enviarFechamentos(
  db: Db,
  organizacaoId: string,
  correio: Correio | null,
  agora: Date,
  o: { mes?: string; proprietarioId?: string; manual?: boolean; reenviar?: boolean } = {},
): Promise<ResultadoFechamentoEmail> {
  const hoje = hojeISO("America/Sao_Paulo", agora);
  const mes = o.mes ?? mesAFechar(hoje);
  const r: ResultadoFechamentoEmail = { mes, enviados: 0, jaEnviados: 0, pendentes: [], semEmail: [], incertos: [], falhas: [], aviso: null };
  const config = await lerConfigFechamentoEmail(db, organizacaoId);
  if (!config.ativo && !o.manual) return { ...r, aviso: "envio do fechamento desligado" };
  if (!correio) return { ...r, aviso: "sem provedor de e-mail configurado: nada enviado" };
  const lista = (await situacaoDosFechamentos(db, organizacaoId, mes, hoje)).filter((p) => !o.proprietarioId || p.proprietarioId === o.proprietarioId);
  for (const p of lista) {
    if (p.situacao === "enviado" && !o.reenviar) {
      r.jaEnviados++;
      continue;
    }
    // Avisar em vez de supor: mês não fechado ou proprietário sem e-mail ficam de fora, com o nome.
    if (p.situacao === "pendente") {
      r.pendentes.push(p.nome);
      continue;
    }
    if (p.situacao === "incerto" && !o.reenviar) {
      r.incertos.push(p.nome);
      continue;
    }
    if (p.situacao === "sem_email") {
      r.semEmail.push(p.nome);
      continue;
    }
    const base = chaveDoEnvio(organizacaoId, p.proprietarioId, mes);
    // Reenvio: retoma um reenvio ainda sem confirmação (mesma chave), em vez de abrir outro.
    let chave = base;
    if (o.reenviar && (p.situacao === "enviado" || p.situacao === "incerto")) {
      const [aberto] = await db
        .select({ key: appSettings.key })
        .from(appSettings)
        .where(and(sql`${appSettings.key} like ${`${base}:reenvio:%`}`, sql`${appSettings.value} ->> 'estado' = 'enviando'`))
        .orderBy(appSettings.key)
        .limit(1);
      chave = aberto?.key ?? `${base}:reenvio:${agora.getTime()}`;
    }
    const reserva = await reservar(db, chave, agora);
    if (reserva === "incerto") {
      r.incertos.push(p.nome);
      continue;
    }
    if (reserva === "ocupado") {
      r.falhas.push(`${p.nome}: o envio anterior ainda não foi confirmado pelo provedor; nova tentativa com o mesmo e-mail depois de 15 minutos`);
      continue;
    }
    const daTentativa = sql`${appSettings.value} ->> 'tentativa' = ${reserva.tentativa}`;
    let carga = reserva.carga;
    try {
      if (!carga) {
        const pdf = await relatorioDoFechamento(db, organizacaoId, p.proprietarioId, mes.slice(0, 7), agora);
        if (!pdf.ok) throw new Error(pdf.erro);
        carga = {
          destinos: p.destinos,
          assunto: preencher(config.assunto, p.nome, mes),
          texto: `${preencher(config.texto, p.nome, mes)}\n\n${linhaDoValor(p)}\n`,
          arquivo: pdf.arquivo,
          pdf: Buffer.from(pdf.pdf).toString("base64"),
        };
        // Guarda o pedido antes de enviar: uma retomada manda exatamente o mesmo.
        await db
          .update(appSettings)
          .set({ value: { estado: "enviando", em: agora.toISOString(), tentativa: reserva.tentativa, carga }, updatedAt: new Date() })
          .where(and(eq(appSettings.key, chave), daTentativa));
      }
      const [para, ...copias] = carga.destinos;
      await correio.enviar({ para, copias, assunto: carga.assunto, texto: carga.texto, chave, anexos: [{ nome: carga.arquivo, conteudo: Buffer.from(carga.pdf, "base64") }] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof ErroEnvioIncerto) {
        r.falhas.push(`${p.nome}: envio incerto (${msg}); nova tentativa com o mesmo e-mail depois de 15 minutos`);
        continue;
      }
      await db.delete(appSettings).where(and(eq(appSettings.key, chave), daTentativa));
      r.falhas.push(`${p.nome}: ${msg}`);
      continue;
    }
    r.enviados++;
    // Enviado: a marca fica sem o pedido (o PDF não precisa ficar guardado).
    const feito = { estado: "enviado", em: agora.toISOString(), destinos: carga.destinos };
    await db.update(appSettings).set({ value: feito, updatedAt: new Date() }).where(and(eq(appSettings.key, chave), daTentativa));
    // Reenvio: a marca do mês continua "enviado", com a data do último envio.
    if (chave !== base) await db.update(appSettings).set({ value: feito, updatedAt: new Date() }).where(eq(appSettings.key, base));
    await registrarAuditoria(db, {
      organizacaoId,
      usuarioId: null,
      acao: "fechamento.email",
      entidade: "proprietario",
      entidadeId: p.proprietarioId,
      mudancas: { fechamento: [null, `${mes.slice(0, 7)} enviado${chave !== base ? " de novo" : ""}`] },
    });
  }
  return r;
}

export function resumoDoFechamentoEmail(r: ResultadoFechamentoEmail): string {
  if (r.aviso) return r.aviso;
  const partes = [`${nomeMes(r.mes)}: ${r.enviados} enviado(s)`];
  if (r.jaEnviados) partes.push(`${r.jaEnviados} já enviado(s)`);
  if (r.pendentes.length) partes.push(`${r.pendentes.length} com o mês ainda não fechado`);
  if (r.semEmail.length) partes.push(`${r.semEmail.length} sem e-mail cadastrado`);
  if (r.incertos.length) partes.push(`${r.incertos.length} sem confirmação do provedor (conferir no painel)`);
  if (r.falhas.length) partes.push(`${r.falhas.length} falha(s)`);
  return partes.join(", ");
}

/**
 * O envio automático (agendador): o mês a fechar e os anteriores ainda não enviados, desde o mês em
 * que o envio foi ligado (no máximo 12 meses): mês fechado com atraso também sai. Um resultado por
 * mês com algo a dizer (o mês a fechar sempre).
 */
export async function enviarFechamentosAutomaticos(db: Db, organizacaoId: string, correio: Correio | null, agora: Date): Promise<ResultadoFechamentoEmail[]> {
  const hoje = hojeISO("America/Sao_Paulo", agora);
  const atual = mesAFechar(hoje);
  const config = await lerConfigFechamentoEmail(db, organizacaoId);
  if (!config.ativo || !config.ativoDesde) return [await enviarFechamentos(db, organizacaoId, correio, agora, { mes: atual })];
  const limite = somarMes(atual, -(MESES_PARA_TRAS - 1));
  const meses: string[] = [];
  for (let m = config.ativoDesde > limite ? config.ativoDesde : limite; m <= atual; m = somarMes(m, 1)) meses.push(m);
  const resultados: ResultadoFechamentoEmail[] = [];
  for (const mes of meses) {
    const r = await enviarFechamentos(db, organizacaoId, correio, agora, { mes });
    if (mes === atual || r.enviados || r.falhas.length || r.incertos.length || r.aviso) resultados.push(r);
  }
  return resultados;
}
