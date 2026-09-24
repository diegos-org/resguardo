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
import { appSettings } from "@/db/schema";
import type { Db } from "@/db/types";
import { type Correio, ErroEnvioIncerto } from "@/email/correio";
import { hojeISO } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { relatorioDoFechamento } from "@/relatorios/gerar";
import { mesAFechar, nomeMes, preverRepasses, type PrevisaoRepasse } from "@/repasses/repasses";

export type ConfigFechamentoEmail = { ativo: boolean; assunto: string; texto: string };

export const ASSUNTO_PADRAO = "Fechamento de {mes} — Sua Casa Leblon";
export const TEXTO_PADRAO =
  "Olá, {nome}.\n\nSegue em anexo o relatório de {mes} dos seus imóveis, com as reservas, os valores e o saldo do mês.\n\nQualquer dúvida, é só responder este e-mail.";

/** Uma retomada só depois deste tempo sem confirmação (a tentativa pode ainda estar em andamento). */
const RETOMADA_MS = 15 * 60_000;

export async function lerConfigFechamentoEmail(db: Db, organizacaoId: string): Promise<ConfigFechamentoEmail> {
  const c = await lerConfig(db, organizacaoId, "fechamento_email");
  const texto = (v: unknown, padrao: string) => (typeof v === "string" && v.trim() ? v : padrao);
  return { ativo: c?.ativo === true, assunto: texto(c?.assunto, ASSUNTO_PADRAO), texto: texto(c?.texto, TEXTO_PADRAO) };
}

export async function salvarConfigFechamentoEmail(db: Db, organizacaoId: string, c: ConfigFechamentoEmail, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  const assunto = c.assunto.trim();
  const texto = c.texto.replace(/\r\n/g, "\n").trim();
  if (!assunto || assunto.length > 200) return { ok: false, erro: "Assunto obrigatório, até 200 caracteres." };
  if (!texto || texto.length > 4000) return { ok: false, erro: "Texto obrigatório, até 4000 caracteres." };
  const desconhecida = [...`${assunto} ${texto}`.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).find((x) => !["nome", "mes"].includes(x));
  if (desconhecida !== undefined) return { ok: false, erro: `Campo desconhecido: {${desconhecida}}. Use {nome} e {mes}.` };
  await db.transaction((tx) => gravarConfig(tx, organizacaoId, "fechamento_email", { ativo: c.ativo, assunto, texto }, autorId));
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

export type Situacao = "pronto" | "enviado" | "pendente" | "sem_email";

/** Situação do e-mail de cada proprietário no mês (a tela e o envio usam a mesma regra). */
export async function situacaoDosFechamentos(db: Db, organizacaoId: string, mes: string, hoje: string): Promise<(PrevisaoRepasse & { email: string; situacao: Situacao; enviadoEm: string | null })[]> {
  const lista = await preverRepasses(db, organizacaoId, mes, hoje);
  const marcas = lista.length
    ? await db
        .select({ key: appSettings.key, value: appSettings.value })
        .from(appSettings)
        .where(inArray(appSettings.key, lista.map((p) => chaveDoEnvio(organizacaoId, p.proprietarioId, mes))))
    : [];
  return lista.map((p) => {
    const marca = marcas.find((m) => m.key === chaveDoEnvio(organizacaoId, p.proprietarioId, mes))?.value as { estado?: string; em?: string } | undefined;
    const email = (p.email ?? "").trim();
    const fechado = !!p.repasse || (p.valor <= 0 && p.bloqueios.length === 0);
    const situacao: Situacao = marca?.estado === "enviado" ? "enviado" : !fechado ? "pendente" : !email ? "sem_email" : "pronto";
    return { ...p, email, situacao, enviadoEm: marca?.estado === "enviado" ? (marca.em ?? null) : null };
  });
}

export const chaveDoEnvio = (organizacaoId: string, proprietarioId: string, mes: string) => `fechamento-email:${organizacaoId}:${proprietarioId}:${mes}`;

type Carga = { assunto: string; texto: string; arquivo: string; pdf: string };
const cargaValida = (c: unknown): c is Carga =>
  !!c && typeof c === "object" && ["assunto", "texto", "arquivo", "pdf"].every((k) => typeof (c as Record<string, unknown>)[k] === "string");

/**
 * Toma a marca do envio: nova, ou uma tentativa sem confirmação há mais de 15 minutos (retomada,
 * com o pedido guardado). Devolve null se já foi enviado ou se outra tentativa está em andamento.
 */
async function reservar(db: Db, chave: string, agora: Date): Promise<{ tentativa: string; carga: Carga | null } | null> {
  const tentativa = crypto.randomUUID();
  const [nova] = await db
    .insert(appSettings)
    .values({ key: chave, value: { estado: "enviando", em: agora.toISOString(), tentativa } })
    .onConflictDoNothing()
    .returning({ key: appSettings.key });
  if (nova) return { tentativa, carga: null };
  const limite = new Date(agora.getTime() - RETOMADA_MS).toISOString();
  const [velha] = await db
    .update(appSettings)
    .set({ value: sql`jsonb_set(jsonb_set(${appSettings.value}, '{tentativa}', ${JSON.stringify(tentativa)}::jsonb), '{em}', ${JSON.stringify(agora.toISOString())}::jsonb)`, updatedAt: new Date() })
    .where(and(eq(appSettings.key, chave), sql`${appSettings.value} ->> 'estado' = 'enviando'`, sql`(${appSettings.value} ->> 'em')::timestamptz < ${limite}::timestamptz`))
    .returning({ value: appSettings.value });
  if (!velha) return null;
  const carga = (velha.value as { carga?: unknown }).carga;
  return { tentativa, carga: cargaValida(carga) ? carga : null };
}

export type ResultadoFechamentoEmail = { mes: string; enviados: number; jaEnviados: number; pendentes: string[]; semEmail: string[]; falhas: string[]; aviso: string | null };

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
  const r: ResultadoFechamentoEmail = { mes, enviados: 0, jaEnviados: 0, pendentes: [], semEmail: [], falhas: [], aviso: null };
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
    if (p.situacao === "sem_email") {
      r.semEmail.push(p.nome);
      continue;
    }
    const base = chaveDoEnvio(organizacaoId, p.proprietarioId, mes);
    const chave = o.reenviar && p.situacao === "enviado" ? `${base}:reenvio:${agora.getTime()}` : base;
    const reserva = await reservar(db, chave, agora);
    if (!reserva) {
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
      await correio.enviar({ para: p.email, assunto: carga.assunto, texto: carga.texto, chave, anexos: [{ nome: carga.arquivo, conteudo: Buffer.from(carga.pdf, "base64") }] });
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
    const feito = { estado: "enviado", em: agora.toISOString() };
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
  if (r.falhas.length) partes.push(`${r.falhas.length} falha(s)`);
  return partes.join(", ");
}
