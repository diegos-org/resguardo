import { notFound } from "next/navigation";
import { FiltroGlobal } from "@/components/painel/FiltroGlobal";
import styles from "@/components/painel/painel.module.css";
import { descreverFiltros, lerFiltros } from "@/lib/filtros";
import { encontrarSecao } from "@/lib/navegacao";

export default async function SecaoPainel({ params, searchParams }: PageProps<"/painel/[secao]">) {
  const { secao: slug } = await params;
  const secao = encontrarSecao(slug);
  if (!secao) notFound();
  const filtros = lerFiltros(await searchParams);
  return (
    <>
      <h1>{secao.titulo}</h1>
      <FiltroGlobal filtros={filtros} acao={`/painel/${secao.slug}`} />
      <section className={styles.cartao}>
        <h2>Em construção</h2>
        <p>{secao.descricao}</p>
        <p className={styles.muted}>
          Previsto no item {secao.marco} do ROADMAP. Seleção atual: {descreverFiltros(filtros)}.
        </p>
      </section>
    </>
  );
}
