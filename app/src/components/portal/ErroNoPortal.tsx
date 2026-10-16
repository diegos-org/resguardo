import Link from "next/link";
import { MolduraPortal } from "./MolduraPortal";
import styles from "./portal.module.css";

type Volta = { href: string; rotulo: string };

/**
 * Áreas internas que usam a moldura dos portais, para a página de erro da raiz (M7.8) não mostrar o menu do site a quem
 * está no painel, no portal, na agenda da equipe, na entrada ou num convite. `null` = página do site (a moldura do site).
 * O painel e o portal têm a sua página de erro; esta cobre o que falha acima delas (a moldura do painel, por exemplo).
 */
export function molduraDoErro(caminho: string): { titulo?: string; volta: Volta } | null {
  const area = /^\/([^/?#]+)/.exec(caminho)?.[1];
  switch (area) {
    case "painel":
      return { titulo: "Painel interno", volta: { href: "/painel", rotulo: "Ir para o início do painel" } };
    case "portal":
      return { titulo: "Portal do proprietário", volta: { href: "/portal", rotulo: "Voltar ao portal" } };
    case "equipe":
      return { titulo: "Equipe de limpeza", volta: { href: "/equipe", rotulo: "Voltar à agenda" } };
    case "entrar":
    case "convite":
      return { volta: { href: "/", rotulo: "Ir para o site" } };
    default:
      return null;
  }
}

/**
 * Erro inesperado nas áreas internas (M7.8), na moldura dos portais. Texto fixo e curto, sem nada do banco (o erro pode
 * ser o próprio banco); o código do erro ajuda a achar o registro do que aconteceu, sem mostrar o detalhe.
 */
export function ErroNoPortal({ titulo, volta, digest, retry }: { titulo?: string; volta: Volta; digest?: string; retry: () => void }) {
  return (
    <MolduraPortal empresa="" titulo={titulo} estreito>
      <header>
        <h1>Algo não saiu como esperado</h1>
        <p className={styles.miudo}>Esta página não abriu agora. Tente de novo em instantes.</p>
      </header>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button type="button" className={styles.botao} onClick={() => retry()}>
          Tentar de novo
        </button>
        <Link href={volta.href} className={`${styles.botao} ${styles.botaoContorno}`}>
          {volta.rotulo}
        </Link>
      </div>
      {digest && <p className={styles.miudo}>Se o problema continuar, este código ajuda a encontrar o que aconteceu: {digest}</p>}
    </MolduraPortal>
  );
}
