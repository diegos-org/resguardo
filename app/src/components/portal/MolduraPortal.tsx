import Link from "next/link";
import type { ReactNode } from "react";
// Da moldura sem banco: assim a página de erro do portal (componente de cliente, M7.8) também usa esta moldura.
import { marcaComDestaque } from "@/components/site/MolduraBase";
import styles from "./portal.module.css";

/**
 * Moldura dos portais (proprietário, equipe de limpeza, entrada e convite): cabeçalho floresta com o
 * nome da empresa, miolo em creme e rodapé profundo — a mesma linguagem do site público (M7.5).
 * `sair` é a ação do botão "Sair" (só com sessão); `estreito` centraliza um bloco curto (entrada).
 */
export function MolduraPortal({
  empresa,
  titulo,
  sair,
  estreito = false,
  children,
}: {
  empresa: string;
  /** Texto pequeno ao lado da marca (ex.: "Portal do proprietário"). */
  titulo?: string;
  sair?: () => Promise<void>;
  estreito?: boolean;
  children: ReactNode;
}) {
  const nome = empresa.trim() || "Início";
  return (
    <div className={styles.pagina}>
      <header className={styles.topo}>
        <div className={styles.topoAcoes}>
          <Link href="/" className={styles.marca}>
            {marcaComDestaque(nome)}
          </Link>
          {titulo && <span className={styles.topoTitulo}>{titulo}</span>}
        </div>
        {sair && (
          <form action={sair}>
            <button type="submit" className={`${styles.botao} ${styles.botaoContorno}`}>
              Sair
            </button>
          </form>
        )}
      </header>
      <main className={estreito ? `${styles.miolo} ${styles.estreito}` : styles.miolo}>{children}</main>
      <footer className={styles.rodape}>
        <span>
          © {new Date().getFullYear()} {nome}
        </span>
        <Link href="/">Site</Link>
      </footer>
    </div>
  );
}
