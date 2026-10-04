/**
 * Extratos oficiais dos canais guardados por imóvel e mês (M5.7). A equipe sobe, em Financeiro → Repasses, o PDF que o
 * canal emitiu (Airbnb, Booking…) antes do fechamento; o relatório do e-mail do fechamento os anexa no fim, como
 * emitidos, só as páginas escolhidas. Um por imóvel, mês e canal (subir de novo substitui). Privado, no banco
 * (`arquivos`), como o comprovante do Pix. Sem arquivo guardado o relatório sai sem anexos e o painel avisa — nunca se
 * supõe. O sistema não lê o conteúdo do extrato: só confere que é um PDF e que as páginas pedidas existem.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { arquivos, extratosCanal, imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { NOMES_ORIGEM } from "@/reservas/regras";
import { ErroRelatorio, type ExtratoAnexo, lerPaginas, LIMITE_EXTRATO } from "./pdf";

/** Canais que emitem extrato próprio (site e direta são da empresa: não há extrato de canal). */
export const CANAIS_EXTRATO = ["airbnb", "booking", "outro"] as const satisfies readonly (keyof typeof NOMES_ORIGEM)[];
export type CanalExtrato = (typeof CANAIS_EXTRATO)[number];
export const canalExtratoValido = (c: string): c is CanalExtrato => (CANAIS_EXTRATO as readonly string[]).includes(c);
/** Nome do canal para a tela e o selo do anexo; um valor desconhecido (dado antigo) sai como está. */
export const nomeDoCanalExtrato = (c: string): string => (canalExtratoValido(c) ? NOMES_ORIGEM[c] : c);

export type NovoExtrato = {
  imovelId: string;
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

/** Quantas páginas tem o PDF; null se não dá para ler. */
async function paginasDoPdf(bytes: Uint8Array): Promise<number | null> {
  try {
    return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  } catch {
    return null;
  }
}

/** Guarda (ou substitui) o extrato de um canal para um imóvel e mês. Confere PDF, tamanho e páginas; nada do conteúdo é lido. */
export async function guardarExtrato(db: Db, organizacaoId: string, e: NovoExtrato, autorId: string | null): Promise<ResultadoExtrato> {
  if (!MES.test(e.mes)) return { ok: false, erro: "Mês inválido." };
  if (!canalExtratoValido(e.canal)) return { ok: false, erro: "Escolha o canal do extrato (Airbnb, Booking.com ou outro)." };
  if (!e.arquivo.conteudo.length) return { ok: false, erro: "Escolha o arquivo PDF do extrato." };
  if (e.arquivo.conteudo.length > LIMITE_EXTRATO) return { ok: false, erro: "O extrato passa de 2 MB: exporte só o período do mês." };
  if (!ePdf(e.arquivo.conteudo)) return { ok: false, erro: "O extrato precisa ser um PDF (o arquivo que o canal emite)." };
  const total = await paginasDoPdf(e.arquivo.conteudo);
  if (!total) return { ok: false, erro: "Não foi possível ler o PDF do extrato: exporte de novo pelo canal." };
  const paginas = e.paginas.trim();
  try {
    lerPaginas(paginas, total);
  } catch (err) {
    if (err instanceof ErroRelatorio) return { ok: false, erro: err.message };
    throw err;
  }
  const [imovel] = await db.select({ id: imoveis.id, codigo: imoveis.codigo }).from(imoveis).where(and(eq(imoveis.id, e.imovelId), eq(imoveis.organizacaoId, organizacaoId)));
  if (!imovel) return { ok: false, erro: "Imóvel não encontrado." };
  const canal = e.canal;
  return db.transaction(async (tx) => {
    const [antigo] = await tx
      .select({ id: extratosCanal.id, arquivoId: extratosCanal.arquivoId })
      .from(extratosCanal)
      .where(and(eq(extratosCanal.organizacaoId, organizacaoId), eq(extratosCanal.imovelId, imovel.id), eq(extratosCanal.mes, e.mes), eq(extratosCanal.canal, canal)))
      .for("update");
    if (antigo) {
      await tx.delete(extratosCanal).where(eq(extratosCanal.id, antigo.id));
      await tx.delete(arquivos).where(and(eq(arquivos.id, antigo.arquivoId), eq(arquivos.organizacaoId, organizacaoId)));
    }
    const [arquivo] = await tx
      .insert(arquivos)
      .values({ organizacaoId, nome: (e.arquivo.nome.trim() || `extrato-${canal}-${e.mes}.pdf`).slice(0, 200), tipo: "application/pdf", tamanho: e.arquivo.conteudo.length, conteudo: Buffer.from(e.arquivo.conteudo), criadoPor: autorId })
      .returning({ id: arquivos.id });
    const [linha] = await tx.insert(extratosCanal).values({ organizacaoId, imovelId: imovel.id, mes: e.mes, canal, arquivoId: arquivo.id, paginas, criadoPor: autorId }).returning({ id: extratosCanal.id });
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "extrato_canal.guardar",
      entidade: "imovel",
      entidadeId: imovel.id,
      mudancas: { extrato: [antigo ? "substituído" : null, `${NOMES_ORIGEM[canal]} · ${e.mes} · ${total} página(s)${paginas ? ` (usar ${paginas})` : ""}`] },
    });
    return { ok: true as const, id: linha.id, substituiu: Boolean(antigo), paginasTotal: total };
  });
}

/** Remove um extrato guardado (e o arquivo dele). */
export async function removerExtrato(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, erro: "Extrato não encontrado." };
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(extratosCanal).where(and(eq(extratosCanal.id, id), eq(extratosCanal.organizacaoId, organizacaoId))).for("update");
    if (!l) return { ok: false as const, erro: "Extrato não encontrado." };
    await tx.delete(extratosCanal).where(eq(extratosCanal.id, l.id));
    await tx.delete(arquivos).where(and(eq(arquivos.id, l.arquivoId), eq(arquivos.organizacaoId, organizacaoId)));
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "extrato_canal.remover", entidade: "imovel", entidadeId: l.imovelId, mudancas: { extrato: [`${nomeDoCanalExtrato(l.canal)} · ${l.mes}`, null] } });
    return { ok: true as const };
  });
}

/** Extratos guardados de um mês (todos os imóveis, ou só alguns), na ordem do código do imóvel e do canal. */
export async function listarExtratos(db: Db, organizacaoId: string, mes: string, imovelIds?: readonly string[]): Promise<ExtratoGuardado[]> {
  if (imovelIds && !imovelIds.length) return [];
  const linhas = await db
    .select({
      id: extratosCanal.id,
      imovelId: extratosCanal.imovelId,
      imovelCodigo: imoveis.codigo,
      imovelNome: imoveis.nome,
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
    .innerJoin(arquivos, eq(arquivos.id, extratosCanal.arquivoId))
    .where(and(eq(extratosCanal.organizacaoId, organizacaoId), eq(extratosCanal.mes, mes), imovelIds ? inArray(extratosCanal.imovelId, [...imovelIds]) : undefined))
    .orderBy(asc(imoveis.codigo), asc(extratosCanal.canal));
  return linhas.map((l) => ({ ...l, canal: l.canal as CanalExtrato, canalNome: nomeDoCanalExtrato(l.canal) }));
}

/**
 * Os extratos guardados dos imóveis de um relatório, prontos para o fim do PDF (`Anexos.extratos`). Com mais de um imóvel,
 * o selo do anexo traz o código do imóvel junto do canal.
 */
export async function extratosDoRelatorio(db: Db, organizacaoId: string, imovelIds: readonly string[], mes: string): Promise<ExtratoAnexo[]> {
  const lista = await listarExtratos(db, organizacaoId, mes, imovelIds);
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
