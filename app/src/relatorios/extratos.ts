/**
 * Extratos oficiais dos canais guardados por imóvel, proprietário e mês (M5.7). A equipe sobe, em Financeiro →
 * Repasses, o PDF que o canal emitiu (Airbnb, Booking…) antes do fechamento; o relatório do e-mail do fechamento os
 * anexa no fim, como emitidos, só as páginas escolhidas. Um por imóvel, proprietário (favorecido), mês e canal (subir
 * de novo substitui). O proprietário é parte da chave de propósito: um imóvel que troca de dono no meio do mês gera
 * dois relatórios, e o extrato guardado para um nunca vai no do outro. Privado, no banco (`arquivos`), como o
 * comprovante do Pix. Sem arquivo guardado o relatório sai sem anexos e o painel avisa — nunca se supõe. O sistema não
 * lê o conteúdo do extrato: só confere que é um PDF e que as páginas pedidas existem.
 */
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { arquivos, extratosCanal, imoveis, lancamentos, proprietarioImoveis, proprietarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import { NOMES_ORIGEM } from "@/reservas/regras";
import { limitesDe } from "./metricas";
import { ErroRelatorio, type ExtratoAnexo, lerPaginas, LIMITE_EXTRATO } from "./pdf";

/** Canais que emitem extrato próprio (site e direta são da empresa: não há extrato de canal). */
export const CANAIS_EXTRATO = ["airbnb", "booking", "outro"] as const satisfies readonly (keyof typeof NOMES_ORIGEM)[];
export type CanalExtrato = (typeof CANAIS_EXTRATO)[number];
export const canalExtratoValido = (c: string): c is CanalExtrato => (CANAIS_EXTRATO as readonly string[]).includes(c);
/** Nome do canal para a tela e o selo do anexo; um valor desconhecido (dado antigo) sai como está. */
export const nomeDoCanalExtrato = (c: string): string => (canalExtratoValido(c) ? NOMES_ORIGEM[c] : c);

export type NovoExtrato = {
  imovelId: string;
  /** Favorecido: o proprietário em cujo relatório o extrato vai. */
  proprietarioId: string;
  /** "AAAA-MM". */
  mes: string;
  canal: string;
  /** Páginas a copiar ("1-2, 4"); vazio = todas. */
  paginas: string;
  arquivo: { nome: string; tipo: string; conteudo: Uint8Array };
};

export type ExtratoGuardado = {
  id: string;
  imovelId: string;
  imovelCodigo: string;
  imovelNome: string;
  proprietarioId: string;
  proprietarioNome: string;
  mes: string;
  canal: CanalExtrato;
  canalNome: string;
  paginas: string;
  arquivoId: string;
  arquivoNome: string;
  tamanho: number;
  criadoEm: Date;
};

export type ResultadoExtrato = { ok: true; id: string; substituiu: boolean; paginasTotal: number } | { ok: false; erro: string };

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const ePdf = (b: Uint8Array) => b.length > 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-";

/**
 * Quantas páginas tem o PDF, lendo do mesmo jeito que o relatório lê na hora de anexar (`gerarPdfRelatorio`): arquivo
 * protegido por senha é recusado aqui, no upload, e não na hora de mandar o e-mail do fechamento.
 */
async function paginasDoPdf(bytes: Uint8Array): Promise<{ total: number } | "protegido" | null> {
  try {
    return { total: (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount() };
  } catch (err) {
    return err instanceof Error && /encrypt/i.test(err.message) ? "protegido" : null;
  }
}

/** Guarda (ou substitui) o extrato de um canal para um imóvel e mês. Confere PDF, tamanho e páginas; nada do conteúdo é lido. */
export async function guardarExtrato(db: Db, organizacaoId: string, e: NovoExtrato, autorId: string | null): Promise<ResultadoExtrato> {
  if (!MES.test(e.mes)) return { ok: false, erro: "Mês inválido." };
  if (!canalExtratoValido(e.canal)) return { ok: false, erro: "Escolha o canal do extrato (Airbnb, Booking.com ou outro)." };
  if (!e.arquivo.conteudo.length) return { ok: false, erro: "Escolha o arquivo PDF do extrato." };
  if (e.arquivo.conteudo.length > LIMITE_EXTRATO) return { ok: false, erro: "O extrato passa de 2 MB: exporte só o período do mês." };
  if (!ePdf(e.arquivo.conteudo)) return { ok: false, erro: "O extrato precisa ser um PDF (o arquivo que o canal emite)." };
  const lido = await paginasDoPdf(e.arquivo.conteudo);
  if (lido === "protegido") return { ok: false, erro: "O extrato está protegido por senha: exporte de novo sem senha." };
  if (!lido || !lido.total) return { ok: false, erro: "Não foi possível ler o PDF do extrato: exporte de novo pelo canal." };
  const total = lido.total;
  const paginas = e.paginas.trim();
  try {
    lerPaginas(paginas, total);
  } catch (err) {
    if (err instanceof ErroRelatorio) return { ok: false, erro: err.message };
    throw err;
  }
  const [imovel] = await db.select({ id: imoveis.id, codigo: imoveis.codigo }).from(imoveis).where(and(eq(imoveis.id, e.imovelId), eq(imoveis.organizacaoId, organizacaoId)));
  if (!imovel) return { ok: false, erro: "Imóvel não encontrado." };
  const dono = await donoDoImovelNoMes(db, organizacaoId, imovel.id, e.proprietarioId, e.mes);
  if (!dono) return { ok: false, erro: "Escolha o proprietário favorecido: ele precisa ter esse imóvel (no cadastro ou no livro desse mês)." };
  const canal = e.canal;
  return db.transaction(async (tx) => {
    const [antigo] = await tx
      .select({ id: extratosCanal.id, arquivoId: extratosCanal.arquivoId })
      .from(extratosCanal)
      .where(and(eq(extratosCanal.organizacaoId, organizacaoId), eq(extratosCanal.imovelId, imovel.id), eq(extratosCanal.proprietarioId, dono.id), eq(extratosCanal.mes, e.mes), eq(extratosCanal.canal, canal)))
      .for("update");
    if (antigo) {
      await tx.delete(extratosCanal).where(eq(extratosCanal.id, antigo.id));
      await tx.delete(arquivos).where(and(eq(arquivos.id, antigo.arquivoId), eq(arquivos.organizacaoId, organizacaoId)));
    }
    const [arquivo] = await tx
      .insert(arquivos)
      .values({ organizacaoId, nome: (e.arquivo.nome.trim() || `extrato-${canal}-${e.mes}.pdf`).slice(0, 200), tipo: "application/pdf", tamanho: e.arquivo.conteudo.length, conteudo: Buffer.from(e.arquivo.conteudo), criadoPor: autorId })
      .returning({ id: arquivos.id });
    const [linha] = await tx.insert(extratosCanal).values({ organizacaoId, imovelId: imovel.id, proprietarioId: dono.id, mes: e.mes, canal, arquivoId: arquivo.id, paginas, criadoPor: autorId }).returning({ id: extratosCanal.id });
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "extrato_canal.guardar",
      entidade: "imovel",
      entidadeId: imovel.id,
      mudancas: { extrato: [antigo ? "substituído" : null, `${NOMES_ORIGEM[canal]} · ${e.mes} · ${dono.nome} · ${total} página(s)${paginas ? ` (usar ${paginas})` : ""}`] },
    });
    return { ok: true as const, id: linha.id, substituiu: Boolean(antigo), paginasTotal: total };
  });
}

/**
 * O proprietário é dono do imóvel nesse mês? Vale o vínculo atual do cadastro ou qualquer lançamento dele para o imóvel
 * com competência no mês (o dono antigo, que ainda recebe o relatório daquele mês pelo livro). Fora disso, não: um
 * extrato guardado para quem não tem o imóvel nunca chegaria a relatório nenhum.
 */
async function donoDoImovelNoMes(db: Db, organizacaoId: string, imovelId: string, proprietarioId: string, mes: string): Promise<{ id: string; nome: string } | null> {
  if (!uuidValido(proprietarioId)) return null;
  const [p] = await db.select({ id: proprietarios.id, nome: proprietarios.nome }).from(proprietarios).where(and(eq(proprietarios.id, proprietarioId), eq(proprietarios.organizacaoId, organizacaoId)));
  if (!p) return null;
  const [vinculo] = await db.select({ id: proprietarioImoveis.proprietarioId }).from(proprietarioImoveis).where(and(eq(proprietarioImoveis.proprietarioId, p.id), eq(proprietarioImoveis.imovelId, imovelId))).limit(1);
  if (vinculo) return p;
  const { inicio, fim } = limitesDe(mes);
  const [noLivro] = await db
    .select({ id: lancamentos.id })
    .from(lancamentos)
    .where(and(eq(lancamentos.organizacaoId, organizacaoId), eq(lancamentos.proprietarioId, p.id), eq(lancamentos.imovelId, imovelId), gte(lancamentos.competencia, inicio), lt(lancamentos.competencia, fim)))
    .limit(1);
  return noLivro ? p : null;
}

/** Remove um extrato guardado (e o arquivo dele). */
export async function removerExtrato(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, erro: "Extrato não encontrado." };
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(extratosCanal).where(and(eq(extratosCanal.id, id), eq(extratosCanal.organizacaoId, organizacaoId))).for("update");
    if (!l) return { ok: false as const, erro: "Extrato não encontrado." };
    await tx.delete(extratosCanal).where(eq(extratosCanal.id, l.id));
    await tx.delete(arquivos).where(and(eq(arquivos.id, l.arquivoId), eq(arquivos.organizacaoId, organizacaoId)));
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "extrato_canal.remover", entidade: "imovel", entidadeId: l.imovelId, mudancas: { extrato: [`${nomeDoCanalExtrato(l.canal)} · ${l.mes} · ${l.proprietarioId}`, null] } });
    return { ok: true as const };
  });
}

/** Filtro dos extratos: só estes imóveis e/ou só estes favorecidos (um relatório pede os dois). */
export type FiltroExtratos = { imovelIds?: readonly string[]; proprietarioIds?: readonly string[] };

/** Extratos guardados de um mês (todos, ou filtrados por imóvel e favorecido), na ordem do código do imóvel, do favorecido e do canal. */
export async function listarExtratos(db: Db, organizacaoId: string, mes: string, f: FiltroExtratos = {}): Promise<ExtratoGuardado[]> {
  if ((f.imovelIds && !f.imovelIds.length) || (f.proprietarioIds && !f.proprietarioIds.length)) return [];
  const linhas = await db
    .select({
      id: extratosCanal.id,
      imovelId: extratosCanal.imovelId,
      imovelCodigo: imoveis.codigo,
      imovelNome: imoveis.nome,
      proprietarioId: extratosCanal.proprietarioId,
      proprietarioNome: proprietarios.nome,
      mes: extratosCanal.mes,
      canal: extratosCanal.canal,
      paginas: extratosCanal.paginas,
      arquivoId: extratosCanal.arquivoId,
      arquivoNome: arquivos.nome,
      tamanho: arquivos.tamanho,
      criadoEm: extratosCanal.criadoEm,
    })
    .from(extratosCanal)
    .innerJoin(imoveis, eq(imoveis.id, extratosCanal.imovelId))
    .innerJoin(proprietarios, eq(proprietarios.id, extratosCanal.proprietarioId))
    .innerJoin(arquivos, eq(arquivos.id, extratosCanal.arquivoId))
    .where(
      and(
        eq(extratosCanal.organizacaoId, organizacaoId),
        eq(extratosCanal.mes, mes),
        f.imovelIds ? inArray(extratosCanal.imovelId, [...f.imovelIds]) : undefined,
        f.proprietarioIds ? inArray(extratosCanal.proprietarioId, [...f.proprietarioIds]) : undefined,
      ),
    )
    .orderBy(asc(imoveis.codigo), asc(proprietarios.nome), asc(extratosCanal.canal));
  return linhas.map((l) => ({ ...l, canal: l.canal as CanalExtrato, canalNome: nomeDoCanalExtrato(l.canal) }));
}

/**
 * Os extratos guardados para um relatório — os imóveis dele **e** os favorecidos dele (o extrato de outro dono do mesmo
 * imóvel no mês nunca entra) — prontos para o fim do PDF (`Anexos.extratos`). Com mais de um imóvel, o selo do anexo
 * traz o código do imóvel junto do canal.
 */
export async function extratosDoRelatorio(db: Db, organizacaoId: string, f: { imovelIds: readonly string[]; proprietarioIds: readonly string[] }, mes: string): Promise<ExtratoAnexo[]> {
  const lista = await listarExtratos(db, organizacaoId, mes, f);
  if (!lista.length) return [];
  const conteudos = await db
    .select({ id: arquivos.id, conteudo: arquivos.conteudo })
    .from(arquivos)
    .where(and(eq(arquivos.organizacaoId, organizacaoId), inArray(arquivos.id, lista.map((l) => l.arquivoId))));
  const porId = new Map(conteudos.map((c) => [c.id, new Uint8Array(c.conteudo)]));
  const varios = new Set(lista.map((l) => l.imovelId)).size > 1;
  return lista.flatMap((l) => {
    const bytes = porId.get(l.arquivoId);
    return bytes ? [{ canal: varios ? `${l.canalNome} · ${l.imovelCodigo}` : l.canalNome, nome: l.arquivoNome, bytes, paginas: l.paginas }] : [];
  });
}
