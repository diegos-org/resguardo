import Link from "next/link";
import { Menu } from "@/components/painel/Menu";
import styles from "@/components/painel/painel.module.css";

export default function PainelLayout({ children }: LayoutProps<"/painel">) {
  return (
    <div className={styles.estrutura}>
      <aside className={styles.lateral}>
        <Link href="/painel" className={styles.marca}>
          Sua Casa Leblon
        </Link>
        <Menu />
      </aside>
      <div className={styles.principal}>
        <header className={styles.cabecalho}>
          <span>Painel interno</span>
          <span className={styles.selo}>Homologação · dados fictícios</span>
        </header>
        <main className={styles.conteudo}>{children}</main>
      </div>
    </div>
  );
}
