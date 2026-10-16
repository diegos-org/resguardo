/**
 * Fotos reais dos imóveis (M7.3, liberado por Diego em 7/10/2026: as dos anúncios do Airbnb ou as que ele separa). A
 * equipe sobe na ficha do imóvel; o navegador reduz cada foto antes de subir e manda duas versões — a grande (galeria) e
 * a pequena (cartões, miniaturas e capa do relatório) —, guardadas em `arquivos`, como o comprovante e o extrato (fora
 * do Git, sem conta nova). O servidor nunca confia no nome nem no tipo que o navegador diz: confere os primeiros bytes
 * (JPG ou PNG) e o tamanho. A ordem decide a galeria; a primeira é a capa. O site só mostra fotos de imóvel público e
 * ativo; sem foto, continua o quadro "foto em breve", nunca uma imagem genérica.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { arquivos, fotosImoveis, imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import {
  BYTES_DAS_MEDIDAS,
  enderecoDaFoto,
  type FotoPublica,
  LIMITE_FOTO,
  LIMITE_MINIATURA,
  limparLegenda,
  MAXIMO_FOTOS,
  type Medidas,
  medidasDaImagem,
  type TipoFoto,
  tipoDaImagem,
} from "./fotos-regras";

export type FotoImovel = { id: string; ordem: number; legenda: string; tamanho: number; temMiniatura: boolean; criadoEm: Date };
export type { FotoPublica };

export type NovaFoto = {
  imovelId: string;
  legenda?: string;
  arquivo: { nome: string; conteudo: Uint8Array };
  /** A versão pequena, também reduzida no navegador; sem ela, a grande vale para tudo. */
  miniatura?: Uint8Array | null;
};

export type ResultadoFoto = { ok: true; id: string } | { ok: false; erro: string };

const SEM_IMOVEL = "Imóvel não encontrado.";
const SEM_FOTO = "Foto não encontrada.";
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

function nomeDoArquivo(nome: string, codigo: string, tipo: TipoFoto, sufixo = ""): string {
  const ext = tipo === "image/png" ? "png" : "jpg";
  const base = nome.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `foto-${codigo}`;
  return `${base}${sufixo}.${ext}`;
}

/** Guarda uma foto nova no fim da galeria do imóvel (a primeira do imóvel vira a capa). */
export async function guardarFoto(db: Db, organizacaoId: string, e: NovaFoto, autorId: string | null): Promise<ResultadoFoto> {
  if (!uuidValido(e.imovelId)) return { ok: false, erro: SEM_IMOVEL };
  const bytes = e.arquivo.conteudo;
  if (!bytes.length) return { ok: false, erro: "Escolha a foto." };
  if (bytes.length > LIMITE_FOTO) return { ok: false, erro: "A foto passa de 2 MB mesmo reduzida: use uma versão menor." };
  const tipo = tipoDaImagem(bytes);
  if (!tipo) return { ok: false, erro: "A foto precisa ser JPG ou PNG." };
  const mini = e.miniatura?.length ? e.miniatura : null;
  const tipoMini = mini ? tipoDaImagem(mini) : null;
  if (mini && (!tipoMini || mini.length > LIMITE_MINIATURA)) return { ok: false, erro: "A versão pequena da foto não veio certa: tente subir de novo." };
  return db.transaction(async (tx) => {
    // Trava o imóvel: duas fotos subindo juntas não ficam com a mesma posição.
    const [im] = await tx.select({ id: imoveis.id, codigo: imoveis.codigo }).from(imoveis).where(and(eq(imoveis.id, e.imovelId), eq(imoveis.organizacaoId, organizacaoId))).for("update");
    if (!im) return { ok: false as const, erro: SEM_IMOVEL };
    const atuais = await tx.select({ ordem: fotosImoveis.ordem }).from(fotosImoveis).where(eq(fotosImoveis.imovelId, im.id));
    if (atuais.length >= MAXIMO_FOTOS) return { ok: false as const, erro: `O imóvel já tem ${MAXIMO_FOTOS} fotos: remova alguma antes de subir outra.` };
    const ordem = atuais.reduce((m, f) => Math.max(m, f.ordem + 1), 0);
    const [grande] = await tx
      .insert(arquivos)
      .values({ organizacaoId, nome: nomeDoArquivo(e.arquivo.nome, im.codigo, tipo), tipo, tamanho: bytes.length, conteudo: Buffer.from(bytes), criadoPor: autorId })
      .returning({ id: arquivos.id });
    const [pequena] =
      mini && tipoMini
        ? await tx
            .insert(arquivos)
            .values({ organizacaoId, nome: nomeDoArquivo(e.arquivo.nome, im.codigo, tipoMini, "-pequena"), tipo: tipoMini, tamanho: mini.length, conteudo: Buffer.from(mini), criadoPor: autorId })
            .returning({ id: arquivos.id })
        : [null];
    const [foto] = await tx
      .insert(fotosImoveis)
      .values({ organizacaoId, imovelId: im.id, arquivoId: grande.id, miniaturaId: pequena?.id ?? null, ordem, legenda: limparLegenda(e.legenda ?? ""), criadoPor: autorId })
      .returning({ id: fotosImoveis.id });
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "foto_imovel.guardar",
      entidade: "imovel",
      entidadeId: im.id,
      mudancas: { foto: [null, `${ordem === 0 ? "capa" : `foto ${atuais.length + 1}`} · ${kb(bytes.length)}`] },
    });
    return { ok: true as const, id: foto.id };
  });
}

/** Fotos do imóvel, na ordem da galeria (a primeira é a capa). */
export async function listarFotos(db: Db, organizacaoId: string, imovelId: string): Promise<FotoImovel[]> {
  if (!uuidValido(imovelId)) return [];
  const linhas = await db
    .select({ id: fotosImoveis.id, ordem: fotosImoveis.ordem, legenda: fotosImoveis.legenda, tamanho: arquivos.tamanho, miniaturaId: fotosImoveis.miniaturaId, criadoEm: fotosImoveis.criadoEm })
    .from(fotosImoveis)
    .innerJoin(arquivos, eq(arquivos.id, fotosImoveis.arquivoId))
    .where(and(eq(fotosImoveis.organizacaoId, organizacaoId), eq(fotosImoveis.imovelId, imovelId)))
    .orderBy(asc(fotosImoveis.ordem), asc(fotosImoveis.criadoEm), asc(fotosImoveis.id));
  return linhas.map(({ miniaturaId, ...l }) => ({ ...l, temMiniatura: miniaturaId !== null }));
}

/** A foto (travada) e a galeria do imóvel dela, na ordem; null se a foto não é desta organização. */
async function galeriaDaFoto(tx: Db, organizacaoId: string, id: string) {
  if (!uuidValido(id)) return null;
  const [foto] = await tx
    .select({ id: fotosImoveis.id, imovelId: fotosImoveis.imovelId, legenda: fotosImoveis.legenda, arquivoId: fotosImoveis.arquivoId, miniaturaId: fotosImoveis.miniaturaId })
    .from(fotosImoveis)
    .where(and(eq(fotosImoveis.id, id), eq(fotosImoveis.organizacaoId, organizacaoId)));
  if (!foto) return null;
  // A mesma trava do upload: mexer na ordem enquanto outra foto chega não embaralha a galeria.
  await tx.select({ id: imoveis.id }).from(imoveis).where(eq(imoveis.id, foto.imovelId)).for("update");
  const ids = (
    await tx
      .select({ id: fotosImoveis.id })
      .from(fotosImoveis)
      .where(eq(fotosImoveis.imovelId, foto.imovelId))
      .orderBy(asc(fotosImoveis.ordem), asc(fotosImoveis.criadoEm), asc(fotosImoveis.id))
  ).map((f) => f.id);
  // Removida por outro pedido enquanto esperava a trava: não existe mais.
  if (!ids.includes(foto.id)) return null;
  return { foto, ids };
}

/** Grava a ordem da lista (0, 1, 2…), só nas fotos que mudaram de lugar. */
async function gravarOrdem(tx: Db, ids: readonly string[], antes: readonly string[]) {
  for (const [i, id] of ids.entries()) if (antes[i] !== id) await tx.update(fotosImoveis).set({ ordem: i }).where(eq(fotosImoveis.id, id));
}

/** Muda a foto de lugar na galeria: uma posição para a frente (-1) ou para trás (+1). */
export async function moverFoto(db: Db, organizacaoId: string, id: string, passo: -1 | 1, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  return db.transaction(async (tx) => {
    const g = await galeriaDaFoto(tx, organizacaoId, id);
    if (!g) return { ok: false as const, erro: SEM_FOTO };
    const de = g.ids.indexOf(g.foto.id);
    const para = de + passo;
    if (para < 0 || para >= g.ids.length) return { ok: true as const };
    const nova = [...g.ids];
    [nova[de], nova[para]] = [nova[para], nova[de]];
    await gravarOrdem(tx, nova, g.ids);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "foto_imovel.ordem", entidade: "imovel", entidadeId: g.foto.imovelId, mudancas: { foto: [`posição ${de + 1}`, `posição ${para + 1}`] } });
    return { ok: true as const };
  });
}

/** Põe a foto no começo da galeria: ela vira a capa (cartão do site, página do imóvel e relatório mensal). */
export async function usarComoCapa(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  return db.transaction(async (tx) => {
    const g = await galeriaDaFoto(tx, organizacaoId, id);
    if (!g) return { ok: false as const, erro: SEM_FOTO };
    const de = g.ids.indexOf(g.foto.id);
    if (de === 0) return { ok: true as const };
    await gravarOrdem(tx, [g.foto.id, ...g.ids.filter((x) => x !== g.foto.id)], g.ids);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "foto_imovel.capa", entidade: "imovel", entidadeId: g.foto.imovelId, mudancas: { capa: [null, `foto que estava na posição ${de + 1}`] } });
    return { ok: true as const };
  });
}

/** Troca a legenda (o texto que descreve a foto; no site, vira o texto alternativo). */
export async function legendarFoto(db: Db, organizacaoId: string, id: string, legenda: string, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  const nova = limparLegenda(legenda);
  return db.transaction(async (tx) => {
    const g = await galeriaDaFoto(tx, organizacaoId, id);
    if (!g) return { ok: false as const, erro: SEM_FOTO };
    if (g.foto.legenda === nova) return { ok: true as const };
    await tx.update(fotosImoveis).set({ legenda: nova }).where(eq(fotosImoveis.id, g.foto.id));
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "foto_imovel.legenda", entidade: "imovel", entidadeId: g.foto.imovelId, mudancas: { legenda: [g.foto.legenda || null, nova || null] } });
    return { ok: true as const };
  });
}

/** Remove a foto (e os arquivos dela); as outras sobem uma posição. Se era a capa, a seguinte vira a capa. */
export async function removerFoto(db: Db, organizacaoId: string, id: string, autorId: string | null): Promise<{ ok: true } | { ok: false; erro: string }> {
  return db.transaction(async (tx) => {
    const g = await galeriaDaFoto(tx, organizacaoId, id);
    if (!g) return { ok: false as const, erro: SEM_FOTO };
    const de = g.ids.indexOf(g.foto.id);
    await tx.delete(fotosImoveis).where(eq(fotosImoveis.id, g.foto.id));
    const doArquivo = [g.foto.arquivoId, g.foto.miniaturaId].filter((x): x is string => x !== null);
    await tx.delete(arquivos).where(and(eq(arquivos.organizacaoId, organizacaoId), inArray(arquivos.id, doArquivo)));
    const resto = g.ids.filter((x) => x !== g.foto.id);
    await gravarOrdem(tx, resto, g.ids);
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "foto_imovel.remover", entidade: "imovel", entidadeId: g.foto.imovelId, mudancas: { foto: [de === 0 ? "capa" : `foto ${de + 1}`, null] } });
    return { ok: true as const };
  });
}

/** Quantas fotos cada imóvel tem (os sem foto ficam de fora do mapa). */
export async function quantasFotos(db: Db, organizacaoId: string): Promise<Map<string, number>> {
  const linhas = await db.select({ imovelId: fotosImoveis.imovelId }).from(fotosImoveis).where(eq(fotosImoveis.organizacaoId, organizacaoId));
  const n = new Map<string, number>();
  for (const l of linhas) n.set(l.imovelId, (n.get(l.imovelId) ?? 0) + 1);
  return n;
}

/**
 * Medidas já lidas, por organização e arquivo (M7.19). O conteúdo de um arquivo nunca muda depois de gravado (foto
 * trocada é outro arquivo, com outro id), então cada um é lido uma vez só enquanto o servidor estiver de pé, e não a
 * cada visita à página da casa. A organização entra na chave: o que uma leu não vale para outra, como no banco. O
 * tamanho é limitado para não crescer sem fim: passou do limite, começa de novo.
 */
const medidasLidas = new Map<string, Medidas | null>();
const MAXIMO_MEDIDAS_GUARDADAS = 5000;

/** Medidas dos arquivos, pelo começo de cada um (`BYTES_DAS_MEDIDAS`, sem trazer a foto inteira); null = não deu para ler. */
async function medidasDosArquivos(db: Db, organizacaoId: string, ids: readonly string[]): Promise<Map<string, Medidas | null>> {
  const achadas = new Map<string, Medidas | null>();
  const faltam: string[] = [];
  const chave = (id: string) => `${organizacaoId}:${id}`;
  for (const id of new Set(ids)) {
    const guardada = medidasLidas.get(chave(id));
    if (guardada !== undefined) achadas.set(id, guardada);
    else faltam.push(id);
  }
  if (!faltam.length) return achadas;
  const linhas = await db
    .select({ id: arquivos.id, inicio: sql<Uint8Array>`substring(${arquivos.conteudo} from 1 for ${sql.raw(String(BYTES_DAS_MEDIDAS))})` })
    .from(arquivos)
    .where(and(eq(arquivos.organizacaoId, organizacaoId), inArray(arquivos.id, faltam)));
  if (medidasLidas.size + linhas.length > MAXIMO_MEDIDAS_GUARDADAS) medidasLidas.clear();
  for (const l of linhas) {
    const medidas = medidasDaImagem(new Uint8Array(l.inicio));
    achadas.set(l.id, medidas);
    medidasLidas.set(chave(l.id), medidas);
  }
  return achadas;
}

/**
 * Fotos para o site, por imóvel (a primeira é a capa). Quem chama já escolheu só imóveis públicos e ativos. Com
 * `medidas` (a página da casa, M7.19), cada foto que tem as duas versões traz as medidas delas, para a galeria deixar o
 * navegador escolher entre a pequena e a grande; as listas de casas não precisam (o cartão usa sempre a pequena).
 */
export async function fotosParaOSite(db: Db, organizacaoId: string, imovelIds: readonly string[], opcoes: { medidas?: boolean } = {}): Promise<Map<string, FotoPublica[]>> {
  const ids = imovelIds.filter(uuidValido);
  const porImovel = new Map<string, FotoPublica[]>();
  if (!ids.length) return porImovel;
  const linhas = await db
    .select({ id: fotosImoveis.id, imovelId: fotosImoveis.imovelId, legenda: fotosImoveis.legenda, arquivoId: fotosImoveis.arquivoId, miniaturaId: fotosImoveis.miniaturaId })
    .from(fotosImoveis)
    .where(and(eq(fotosImoveis.organizacaoId, organizacaoId), inArray(fotosImoveis.imovelId, ids)))
    .orderBy(asc(fotosImoveis.ordem), asc(fotosImoveis.criadoEm), asc(fotosImoveis.id));
  // Só as fotos com as duas versões: sem a pequena, não há o que escolher.
  const medidas = opcoes.medidas ? await medidasDosArquivos(db, organizacaoId, linhas.flatMap((l) => (l.miniaturaId ? [l.arquivoId, l.miniaturaId] : []))) : null;
  for (const l of linhas) {
    const lista = porImovel.get(l.imovelId) ?? [];
    const foto: FotoPublica = { grande: enderecoDaFoto(l.id), pequena: enderecoDaFoto(l.id, l.miniaturaId ? "pequena" : "grande"), legenda: l.legenda };
    const grande = medidas?.get(l.arquivoId);
    const pequena = l.miniaturaId ? medidas?.get(l.miniaturaId) : null;
    if (grande && pequena) foto.medidas = { grande, pequena };
    lista.push(foto);
    porImovel.set(l.imovelId, lista);
  }
  return porImovel;
}

export type ConteudoFoto = { tipo: TipoFoto; conteudo: Buffer; imovelId: string; publica: boolean };

/**
 * O arquivo de uma foto, para a rota que a entrega: a grande ou a pequena (sem pequena, a grande). `publica` diz se o
 * imóvel dela está no site (público e ativo) — só aí ela pode ir para quem não entrou no painel.
 */
export async function conteudoDaFoto(db: Db, organizacaoId: string, id: string, tamanho: "grande" | "pequena"): Promise<ConteudoFoto | null> {
  if (!uuidValido(id)) return null;
  const [f] = await db
    .select({ imovelId: fotosImoveis.imovelId, arquivoId: fotosImoveis.arquivoId, miniaturaId: fotosImoveis.miniaturaId, publico: imoveis.publico, ativo: imoveis.ativo })
    .from(fotosImoveis)
    .innerJoin(imoveis, eq(imoveis.id, fotosImoveis.imovelId))
    .where(and(eq(fotosImoveis.id, id), eq(fotosImoveis.organizacaoId, organizacaoId)));
  if (!f) return null;
  const arquivoId = tamanho === "pequena" && f.miniaturaId ? f.miniaturaId : f.arquivoId;
  const [a] = await db.select({ tipo: arquivos.tipo, conteudo: arquivos.conteudo }).from(arquivos).where(and(eq(arquivos.id, arquivoId), eq(arquivos.organizacaoId, organizacaoId)));
  const tipo = a ? tipoDaImagem(new Uint8Array(a.conteudo)) : null;
  if (!a || !tipo) return null;
  return { tipo, conteudo: a.conteudo, imovelId: f.imovelId, publica: f.publico && f.ativo };
}

/**
 * Foto da capa do relatório mensal: a capa (versão pequena) do primeiro imóvel do relatório, na ordem dada, que tiver
 * foto. Sem nenhuma, nada — a capa do PDF mostra "foto do imóvel — em breve".
 */
export async function capaDoRelatorio(db: Db, organizacaoId: string, imovelIds: readonly string[]): Promise<Uint8Array | null> {
  const ids = imovelIds.filter(uuidValido);
  if (!ids.length) return null;
  const linhas = await db
    .select({ imovelId: fotosImoveis.imovelId, arquivoId: fotosImoveis.arquivoId, miniaturaId: fotosImoveis.miniaturaId })
    .from(fotosImoveis)
    .where(and(eq(fotosImoveis.organizacaoId, organizacaoId), inArray(fotosImoveis.imovelId, ids)))
    .orderBy(asc(fotosImoveis.ordem), asc(fotosImoveis.criadoEm), asc(fotosImoveis.id));
  const capa = ids.map((i) => linhas.find((l) => l.imovelId === i)).find((l) => l !== undefined);
  if (!capa) return null;
  const [a] = await db.select({ conteudo: arquivos.conteudo }).from(arquivos).where(and(eq(arquivos.id, capa.miniaturaId ?? capa.arquivoId), eq(arquivos.organizacaoId, organizacaoId)));
  return a ? new Uint8Array(a.conteudo) : null;
}
