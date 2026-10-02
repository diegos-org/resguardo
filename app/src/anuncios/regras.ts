import { reaisParaCentavos } from "@/lib/dinheiro-form";

export const CANAIS_ANUNCIO = ["airbnb", "booking"] as const;
export type CanalAnuncio = (typeof CANAIS_ANUNCIO)[number];
export const SITUACOES = { nao_conferido: "Não conferido", publicado: "Publicado", pausado: "Pausado", rascunho: "Rascunho", inexistente: "Sem anúncio" } as const;
export type Situacao = keyof typeof SITUACOES;
export type DadosAnuncio = { canal: CanalAnuncio; situacao: Situacao; url: string; titulo: string; descricao: string; fotos: string[]; precoBase: number | null };
const texto = (v: unknown) => typeof v === "string" ? v.trim() : "";

/** Somente links HTTPS públicos, sem credenciais. Nenhum link é buscado pelo servidor. */
export function urlPublica(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && !u.port &&
      !/[\s\\]/.test(v) && u.hostname.includes(".") &&
      !/^[\d.]+$/.test(u.hostname) && !u.hostname.includes(":") &&
      !/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname);
  } catch { return false; }
}

export function validarAnuncio(e: Record<string, unknown>): { ok: true; dados: DadosAnuncio } | { ok: false; erro: string } {
  if (!CANAIS_ANUNCIO.includes(e.canal as CanalAnuncio)) return { ok: false, erro: "Escolha Airbnb ou Booking.com." };
  if (typeof e.situacao !== "string" || !Object.hasOwn(SITUACOES, e.situacao)) return { ok: false, erro: "Escolha a situação do anúncio." };
  const url = texto(e.url), titulo = texto(e.titulo), descricao = texto(e.descricao).replace(/\r\n/g, "\n");
  if (url.length > 2048 || (url && !urlPublica(url))) return { ok: false, erro: "Informe um link HTTPS público, sem usuário ou senha." };
  if (url) {
    const host = new URL(url).hostname;
    const dominios = e.canal === "airbnb" ? ["airbnb.com", "airbnb.com.br", "airbnb.pt"] : ["booking.com"];
    if (!dominios.some(d => host === d || host.endsWith(`.${d}`))) return { ok: false, erro: "O link precisa pertencer ao canal escolhido (Airbnb ou Booking.com)." };
  }
  if (titulo.length > 200 || descricao.length > 10000) return { ok: false, erro: "Use até 200 caracteres no título e 10.000 na descrição." };
  const fotosTexto = texto(e.fotos);
  if (fotosTexto.length > 62000) return { ok: false, erro: "Use até 30 links de fotos." };
  const fotos = [...new Set(fotosTexto.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
  if (fotos.length > 30 || fotos.some(f => f.length > 2048 || !urlPublica(f))) return { ok: false, erro: "Fotos: até 30 links HTTPS públicos, um por linha (máximo de 2.048 caracteres por link)." };
  const precoBase = reaisParaCentavos(texto(e.precoBase));
  if (precoBase === undefined || (precoBase !== null && (precoBase <= 0 || precoBase > 100_000_000))) return { ok: false, erro: "Preço base: informe um valor positivo até R$ 1.000.000,00 ou deixe em branco." };
  return { ok: true, dados: { canal: e.canal as CanalAnuncio, situacao: e.situacao as Situacao, url, titulo, descricao, fotos, precoBase } };
}

export type ReferenciaComparacao = Pick<DadosAnuncio, "situacao" | "titulo" | "descricao" | "fotos" | "precoBase"> & { nome: string };
const normalizar = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
/** Compara só valores conhecidos. URLs de fotos distintas não provam imagens distintas. */
export function compararAnuncios(referencias: ReferenciaComparacao[]): string[] {
  const avisos: string[] = [];
  const ativos = referencias.filter(r => r.situacao !== "inexistente");
  for (let i = 0; i < ativos.length; i++) for (let j = i + 1; j < ativos.length; j++) {
    const a = ativos[i], b = ativos[j], par = `${a.nome} × ${b.nome}`;
    if (a.situacao !== "nao_conferido" && b.situacao !== "nao_conferido" && a.situacao !== b.situacao) avisos.push(`${par}: situações diferentes.`);
    for (const campo of ["titulo", "descricao"] as const) {
      if (normalizar(a[campo]) && normalizar(b[campo]) && normalizar(a[campo]) !== normalizar(b[campo])) avisos.push(`${par}: ${campo === "titulo" ? "títulos" : "descrições"} diferentes.`);
    }
    if (a.precoBase !== null && b.precoBase !== null && a.precoBase !== b.precoBase) avisos.push(`${par}: preços base informados diferentes; confira taxas e regras de cada canal.`);
    if (a.fotos.length && b.fotos.length && JSON.stringify(a.fotos) !== JSON.stringify(b.fotos)) avisos.push(`${par}: referências ou ordem das fotos diferentes; confira visualmente nos canais.`);
  }
  return avisos;
}
