import Link from "next/link";
import { salvarAnuncioAcao } from "@/anuncios/acoes";
import type { listarAnuncios } from "@/anuncios/repositorio";
import { CANAIS_ANUNCIO, compararAnuncios, SITUACOES, type ReferenciaComparacao, type Situacao } from "@/anuncios/regras";
import { formatBRL } from "@/lib/money";
import { FormAnuncio } from "./FormAnuncio";
import styles from "./anuncios.module.css";

export type ImovelAnuncios = Awaited<ReturnType<typeof listarAnuncios>>[number];
const nomes = { airbnb: "Airbnb", booking: "Booking.com" };
export function referenciasDoQuadro(imovel: ImovelAnuncios, siteDaOrg: boolean): ReferenciaComparacao[] {
  return [{ nome: "Site", situacao: siteDaOrg && imovel.ativo && imovel.publico ? "publicado" : "inexistente", titulo: imovel.nome, descricao: imovel.descricao, precoBase: imovel.precoBase, fotos: [] },
    ...imovel.anuncios.filter(a => a.canal === "airbnb" || a.canal === "booking").map(a => ({ ...a, nome: nomes[a.canal as keyof typeof nomes], situacao: a.situacao as Situacao }))];
}
export function QuadroAnuncios({ imovel: i, podeEditar, siteDaOrg }: { imovel: ImovelAnuncios; podeEditar: boolean; siteDaOrg: boolean }) {
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
        <dl><dt>Título</dt><dd>{i.nome}</dd><dt>Descrição</dt><dd>{i.descricao || "Não cadastrada"}</dd><dt>Preço base cadastrado</dt><dd>{i.precoBase === null ? "Não informado" : formatBRL(i.precoBase)}</dd></dl>
        <p className={styles.miudo}>Preço interno de referência. O site ainda não publica cotações de estadia.</p>
        <p>Fotos reais ainda não publicadas; a galeria usa imagens provisórias.</p>
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
          <p className={styles.miudo}>{a?.conferidoEm ? `Conferência manual em ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(a.conferidoEm)} (Brasília).` : "Aguardando conferência manual."}</p>
          <dl><dt>Título</dt><dd>{a?.titulo || "Não informado"}</dd><dt>Descrição</dt><dd>{a?.descricao || "Não informada"}</dd><dt>Preço base informado</dt><dd>{a?.precoBase == null ? "Não informado" : formatBRL(a.precoBase)}</dd></dl>
          <div><strong>Fotos de referência</strong>{a?.fotos.length ? <ol>{a.fotos.map((url, n) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">Abrir foto {n + 1}</a></li>)}</ol> : <p>Nenhuma foto informada.</p>}</div>
          {podeEditar && <details><summary>Editar referência do {nomes[canal]}</summary><FormAnuncio imovelId={i.id} canal={canal} inicial={a} salvar={salvarAnuncioAcao} /></details>}
        </article>;
      })}
    </div>
  </section>;
}
