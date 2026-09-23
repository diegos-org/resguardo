import Link from "next/link";
import { FiltroGlobal } from "@/components/painel/FiltroGlobal";
import styles from "@/components/painel/painel.module.css";
import { descreverFiltros, lerFiltros } from "@/lib/filtros";
import { SECOES } from "@/lib/navegacao";

export default async function PainelInicio({ searchParams }: PageProps<"/painel">) {
  const filtros = lerFiltros(await searchParams);
  return (
    <>
      <h1>Início</h1>
      <FiltroGlobal filtros={filtros} acao="/painel" />
      <p className={styles.muted}>Seleção atual: {descreverFiltros(filtros)}</p>
      <section className={styles.grade} aria-label="Seções do painel">
        {SECOES.map((s) => (
          <Link key={s.slug} href={`/painel/${s.slug}`} className={styles.cartao}>
            <h2>{s.titulo}</h2>
            <p className={styles.muted}>{s.descricao}</p>
          </Link>
        ))}
      </section>
    </>
  );
}
