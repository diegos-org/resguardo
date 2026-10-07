import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { partesDoTitulo } from "@/configuracoes/textos-site";
import { type ConteudoSite, linkWhatsapp } from "@/site/site";
import styles from "./site.module.css";

/**
 * Nome da empresa com a última palavra em destaque ("Sua Casa *Leblon*"), como no logotipo do estudo.
 * Com uma palavra só, nada é destacado.
 */
export function marcaComDestaque(nome: string): ReactNode {
  const palavras = nome.trim().split(/\s+/).filter(Boolean);
  if (palavras.length < 2) return nome.trim();
  const ultima = palavras.pop()!;
  return (
    <>
      {palavras.join(" ")} <em>{ultima}</em>
    </>
  );
}

/** Texto editável com a palavra entre *asteriscos* em itálico (título da capa, chamada final). */
export function TextoComDestaque({ texto }: { texto: string }) {
  return (
    <>
      {partesDoTitulo(texto).map((p, i) =>
        p.destaque ? <em key={i}>{p.texto}</em> : <Fragment key={i}>{p.texto}</Fragment>,
      )}
    </>
  );
}

const IconeWhatsapp = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 12 12 0 0 0 4.6 4c1.7.7 2.1.6 2.8.5a2.4 2.4 0 0 0 1.6-1.1c.2-.6.2-1 .1-1.1l-.5-.3z" />
  </svg>
);

/**
 * Cabeçalho (floresta) e rodapé (profundo) do site público, com o botão do WhatsApp quando a empresa
 * tem telefone. `largura="cheia"` é para a página inicial, que tem faixas de cor de ponta a ponta;
 * as outras páginas ficam no miolo centralizado.
 */
export function Moldura({ conteudo, children, largura = "miolo" }: { conteudo: ConteudoSite | null; children: ReactNode; largura?: "miolo" | "cheia" }) {
  const nome = conteudo?.nomeEmpresa.trim() || "Início";
  const ano = new Date().getFullYear();
  return (
    <div className={styles.pagina}>
      <header className={styles.topo}>
        <Link href="/" className={styles.marca}>
          {marcaComDestaque(nome)}
        </Link>
        <nav className={styles.menu} aria-label="Principal">
          <Link href="/imoveis" className={styles.menuCelularOculto}>
            Nossas casas
          </Link>
          <Link href="/hospede" className={styles.menuOculto}>
            Minha reserva
          </Link>
          <Link href="/anunciar" className={styles.menuOculto}>
            Anuncie seu imóvel
          </Link>
          <Link href="/consulta" className={styles.menuBotao}>
            Planeje sua estadia
            <span className={styles.seta} aria-hidden="true">
              ↗
            </span>
          </Link>
        </nav>
      </header>
      <main className={largura === "cheia" ? styles.conteudo : `${styles.conteudo} ${styles.miolo}`}>{children}</main>
      {conteudo?.whatsapp && (
        <a className={styles.whatsapp} href={linkWhatsapp(conteudo.whatsapp, "Olá! Vim pelo site e gostaria de falar com a equipe.")} target="_blank" rel="noopener noreferrer" aria-label={`Falar com ${nome} pelo WhatsApp`}>
          <IconeWhatsapp />
        </a>
      )}
      <footer className={styles.rodape}>
        <div className={styles.rodapeDentro}>
          <strong className={styles.rodapeMarca}>{marcaComDestaque(nome)}</strong>
          <p>{conteudo?.textos.rodape || conteudo?.textos.subtitulo || nome}</p>
          <div className={styles.rodapeLinks}>
            <Link href="/imoveis">Nossas casas</Link>
            <Link href="/consulta">Consulta</Link>
            <Link href="/hospede">Minha reserva</Link>
            <Link href="/anunciar">Anuncie seu imóvel</Link>
            <Link href="/painel">Área da equipe</Link>
          </div>
          <small>
            © {ano} {nome}
          </small>
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

/** Imóvel ainda sem foto real (M7.3): um quadro com o nome do apartamento — nunca uma imagem genérica. */
export function FotoProvisoria({ titulo }: { titulo: string }) {
  return (
    <div className={styles.foto} role="img" aria-label={titulo ? `Foto de ${titulo} (em breve)` : "Foto (em breve)"}>
      {titulo}
      <small>Foto em breve</small>
    </div>
  );
}
