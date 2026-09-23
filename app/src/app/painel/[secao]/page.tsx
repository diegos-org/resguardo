import { notFound } from "next/navigation";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { opcoesDeFiltro } from "@/imoveis/repositorio";
import { FiltroGlobal } from "@/components/painel/FiltroGlobal";
import styles from "@/components/painel/painel.module.css";
import { descreverFiltros, lerFiltros } from "@/lib/filtros";
import { encontrarSecao } from "@/lib/navegacao";

export default async function SecaoPainel({ params, searchParams }: PageProps<"/painel/[secao]">) {
  const sessao = await exigirSessaoPainel();
  const opcoes = await opcoesDeFiltro(getDb(), sessao.organizacaoId);
  const { secao: slug } = await params;
  const secao = encontrarSecao(slug);
  if (!secao) notFound();
  const filtros = lerFiltros(await searchParams, opcoes);
  return (
    <>
      <h1>{secao.titulo}</h1>
      <FiltroGlobal filtros={filtros} opcoes={opcoes} acao={`/painel/${secao.slug}`} />
      <section className={styles.cartao}>
        <h2>Em construção</h2>
        <p>{secao.descricao}</p>
        <p className={styles.muted}>
          Previsto no item {secao.marco} do ROADMAP. Seleção atual: {descreverFiltros(filtros, opcoes)}.
        </p>
      </section>
    </>
  );
}
