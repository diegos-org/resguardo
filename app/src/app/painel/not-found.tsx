import Link from "next/link";
import styles from "@/components/painel/painel.module.css";

/**
 * Página não encontrada do painel (M7.8): dentro da moldura do painel (menu e cabeçalho), não na do site. Vale para os
 * `notFound()` das telas do painel — registro que não existe, ou que o papel de quem entrou não pode ver — e para
 * endereços que não existem dentro do painel.
 */
export default function NaoEncontradaNoPainel() {
  return (
    <>
      <h1>Página não encontrada</h1>
      <section className={styles.cartao}>
        <p style={{ marginTop: 0 }}>O endereço pode estar errado, ou o registro não existe mais ou não está disponível para o seu acesso.</p>
        <p style={{ marginBottom: 0 }}>
          <Link href="/painel">Voltar ao início do painel</Link>
        </p>
      </section>
    </>
  );
}
