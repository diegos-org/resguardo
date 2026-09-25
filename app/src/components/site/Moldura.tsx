import Link from "next/link";
import type { ReactNode } from "react";
import type { ConteudoSite } from "@/site/site";
import styles from "./site.module.css";

/** Cabeçalho e rodapé do site público. */
export function Moldura({ conteudo, children }: { conteudo: ConteudoSite | null; children: ReactNode }) {
  const nome = conteudo?.nomeEmpresa.trim() || "Início";
  return (
    <div className={styles.pagina}>
      <header className={styles.topo}>
        <Link href="/" className={styles.marca}>
          {nome}
        </Link>
        <nav className={styles.menu} aria-label="Principal">
          <Link href="/imoveis">Apartamentos</Link>
          <Link href="/consulta">Consulta</Link>
          <Link href="/hospede">Minha reserva</Link>
        </nav>
      </header>
      <main className={styles.conteudo}>{children}</main>
      <footer className={styles.rodape}>
        <div className={styles.rodapeDentro}>
          <span>{conteudo?.textos.rodape || nome}</span>
          <Link href="/painel">Área da equipe</Link>
        </div>
      </footer>
    </div>
  );
}

/** Sem organização definida para o site: avisa em vez de escolher uma. */
export function SiteEmConfiguracao() {
  return (
    <Moldura conteudo={null}>
      <p className={styles.aviso} role="note">
        Site em configuração. Volte em breve.
      </p>
    </Moldura>
  );
}

/** Enquanto as fotos reais não são liberadas (M7.3): um quadro com o nome do apartamento. */
export function FotoProvisoria({ titulo }: { titulo: string }) {
  return (
    <div className={styles.foto} role="img" aria-label={`Foto de ${titulo} (em breve)`}>
      {titulo}
    </div>
  );
}
