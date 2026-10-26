import Link from "next/link";
import { salvarAnuncioAcao } from "@/anuncios/acoes";
import type { listarAnuncios } from "@/anuncios/repositorio";
import { CANAIS_ANUNCIO, compararAnuncios, SITUACOES, type ReferenciaComparacao, type Situacao } from "@/anuncios/regras";
import type { FontePrecos } from "@/imoveis/fonte-precos";
import { dataHoraNoFuso, FUSO_PADRAO, rotuloDoFuso } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { fraseDoImovel } from "@/site/frase-do-imovel";
import { FormAnuncio } from "./FormAnuncio";
import styles from "./anuncios.module.css";

export type ImovelAnuncios = Awaited<ReturnType<typeof listarAnuncios>>[number];
const nomes = { airbnb: "Airbnb", booking: "Booking.com" };
/**
 * Nota do preço base no cartão "Site", pela fonte de preços da ficha (M3.9). Até o M7.17 era uma frase só, "O site ainda
 * não publica cotações de estadia.", vencida desde o M7.2/M8.1 (o site mostra o valor da estadia, calculado noite a noite,
 * com o desconto do site, M12.1, por cima). Na primeira correção do M7.17 virou "Preço interno de referência. O valor que
 * o site mostra numa consulta é calculado noite a noite pela fonte de preços escolhida na ficha do imóvel, com o desconto
 * do site por cima.", que só vale para a fonte Beds24: com SCL ou manual, o preço base é o da noite sem preço de período
 * (`precoDaNoite`, base do `precoFinalEsperado` que o site usa). Por isso a nota depende da fonte.
 */
export const NOTAS_PRECO_SITE: Record<FontePrecos, string> = {
  scl: "É a base do valor da noite no site: com os preços automáticos do SCL, cada noite parte deste preço (ou do preço do período), com os ajustes automáticos e o desconto do site por cima.",
  manual: "É a base do valor da noite no site: com os preços digitados no cadastro, vale este preço (ou o do período), sem ajustes automáticos, com o desconto do site por cima.",
  beds24: "Só referência interna: com os preços definidos no Beds24, o site usa o preço de cada noite lido do Beds24, com o desconto do site por cima; este preço não entra no site.",
  so_disponibilidade: "Só referência interna: com só disponibilidade, o site usa o preço e as estadias mínima e máxima de cada noite lidos do Beds24, com o desconto do site por cima; este preço não entra no site.",
};
/**
 * Frase de abertura no cartão "Site" (M7.17). Sem ela, o que o cartão da casa e a prévia do link usam no lugar, pela
 * própria `fraseDoImovel` (a regra fica num lugar só; o painel não a descreve de novo em texto).
 */
export function fraseNoQuadro(i: Pick<ImovelAnuncios, "frase" | "descricao" | "bairro" | "cidade">): string {
  const propria = i.frase.trim();
  if (propria) return propria;
  const noCartao = fraseDoImovel(i);
  return noCartao
    ? `Não cadastrada. O cartão da casa e a prévia do link usam: “${noCartao}”`
    : "Não cadastrada. O cartão da casa fica sem frase, e a prévia do link usa a descrição do site.";
}
export function referenciasDoQuadro(imovel: ImovelAnuncios, siteDaOrg: boolean): ReferenciaComparacao[] {
  return [{ nome: "Site", situacao: siteDaOrg && imovel.ativo && imovel.publico ? "publicado" : "inexistente", titulo: imovel.nome, descricao: imovel.descricao, precoBase: imovel.precoBase, fotos: [] },
    ...imovel.anuncios.filter(a => a.canal === "airbnb" || a.canal === "booking").map(a => ({ ...a, nome: nomes[a.canal as keyof typeof nomes], situacao: a.situacao as Situacao }))];
}
export function QuadroAnuncios({ imovel: i, podeEditar, siteDaOrg, fotosNoSite = 0 }: { imovel: ImovelAnuncios; podeEditar: boolean; siteDaOrg: boolean; fotosNoSite?: number }) {
  const avisos = compararAnuncios(referenciasDoQuadro(i, siteDaOrg));
  const siteVisivel = siteDaOrg && i.publico && i.ativo;
  return <section className={styles.imovel} aria-label={`Anúncios ${i.codigo}`}>
    <header className={styles.topo}><div><h2>{i.codigo} · {i.nome}</h2>{!i.ativo && <p>Imóvel arquivado</p>}</div>{podeEditar && <Link href={`/painel/imoveis/${i.id}`}>Editar cadastro e vínculos</Link>}</header>
    {avisos.length > 0 ? <div className={styles.avisos}><strong>Diferenças para conferir</strong><ul>{avisos.map(a => <li key={a}>{a}</li>)}</ul><p className={styles.miudo}>Comparação das referências cadastradas; diferenças entre canais podem ser intencionais.</p></div> : <p className={styles.miudo} style={{ marginBottom: 16 }}>Sem diferenças entre os valores disponíveis. Dados ausentes e canais não conferidos ainda precisam de conferência.</p>}
    <div className={styles.canais}>
      <article className={styles.canal} aria-label="Site">
        <h3>Site</h3><strong>{siteVisivel ? "Visível no site deste ambiente" : !siteDaOrg ? "Site não configurado para esta empresa" : "Não exibido no site"}</strong>
        {siteVisivel && <Link href={`/imoveis/${encodeURIComponent(i.codigo)}`} target="_blank" rel="noopener noreferrer">Abrir página do imóvel</Link>}
        <p className={styles.miudo}>Dados atuais do cadastro do imóvel.</p>
        <dl><dt>Título</dt><dd>{i.nome}</dd><dt>Frase de abertura</dt><dd>{fraseNoQuadro(i)}</dd><dt>Descrição</dt><dd>{i.descricao || "Não cadastrada"}</dd><dt>Preço base cadastrado</dt><dd>{i.precoBase === null ? "Não informado" : formatBRL(i.precoBase)}</dd></dl>
        <p className={styles.miudo}>{NOTAS_PRECO_SITE[i.fontePrecos]}</p>
        <p>{fotosNoSite ? `${fotosNoSite} ${fotosNoSite === 1 ? "foto real" : "fotos reais"} na galeria (a primeira é a capa).` : "Sem fotos ainda: o site mostra \"foto em breve\". Suba as fotos na ficha do imóvel."}</p>
        {podeEditar && <Link href={`/painel/imoveis/${i.id}`}>Editar dados do site no cadastro</Link>}
      </article>
      {CANAIS_ANUNCIO.map(canal => {
        const a = i.anuncios.find(a => a.canal === canal);
        const ids = i.vinculos.filter(v => v.canal === canal);
        return <article key={canal} className={styles.canal} aria-label={nomes[canal]}>
          <h3>{nomes[canal]}</h3><strong>{a ? (SITUACOES[a.situacao as Situacao] ?? "Não conferido") : "Não conferido"}</strong>
          <p className={styles.miudo}>{ids.length ? `IDs vinculados: ${ids.map(v => v.idExterno).join(", ")}` : "Sem ID deste canal vinculado ao imóvel."} Vínculo não comprova publicação.</p>
          {ids.length > 1 && <p>Há mais de um vínculo neste canal. Esta ficha registra uma referência principal; confira os demais no canal.</p>}
          {a?.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">Abrir anúncio no {nomes[canal]}</a> : <p>Link não cadastrado</p>}
          <p className={styles.miudo}>{a?.conferidoEm ? `Conferência manual em ${dataHoraNoFuso(a.conferidoEm)} (${rotuloDoFuso(FUSO_PADRAO)}).` : "Aguardando conferência manual."}</p>
          <dl><dt>Título</dt><dd>{a?.titulo || "Não informado"}</dd><dt>Descrição</dt><dd>{a?.descricao || "Não informada"}</dd><dt>Preço base informado</dt><dd>{a?.precoBase == null ? "Não informado" : formatBRL(a.precoBase)}</dd></dl>
          <div><strong>Fotos de referência</strong>{a?.fotos.length ? <ol>{a.fotos.map((url, n) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">Abrir foto {n + 1}</a></li>)}</ol> : <p>Nenhuma foto informada.</p>}</div>
          {podeEditar && <details><summary>Editar referência do {nomes[canal]}</summary><FormAnuncio imovelId={i.id} canal={canal} inicial={a} salvar={salvarAnuncioAcao} /></details>}
        </article>;
      })}
    </div>
  </section>;
}
