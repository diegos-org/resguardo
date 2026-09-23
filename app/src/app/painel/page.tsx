import Link from "next/link";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FiltroGlobal } from "@/components/painel/FiltroGlobal";
import styles from "@/components/painel/painel.module.css";
import { descreverFiltros, lerFiltros, manterFiltros } from "@/lib/filtros";
import { SECOES } from "@/lib/navegacao";

export default async function PainelInicio({ searchParams }: PageProps<"/painel">) {
  await exigirSessaoPainel();
  const params = await searchParams;
  const filtros = lerFiltros(params);
  const query = manterFiltros(params);
  return (
    <>
      <h1>Início</h1>
      <FiltroGlobal filtros={filtros} acao="/painel" />
      <p className={styles.muted}>Seleção atual: {descreverFiltros(filtros)}</p>
      <section className={styles.grade} aria-label="Seções do painel">
        {SECOES.map((s) => (
          <Link key={s.slug} href={`/painel/${s.slug}${query}`} className={styles.cartao}>
            <h2>{s.titulo}</h2>
            <p className={styles.muted}>{s.descricao}</p>
          </Link>
        ))}
      </section>
    </>
  );
}
