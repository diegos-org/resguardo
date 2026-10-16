import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { MARCA_PADRAO } from "@/site/marca";
import { ID_CONTEUDO, LinkNovaJanela, PularParaConteudo } from "./Acessibilidade";
import styles from "./site.module.css";

/**
 * A moldura do site sem nada do banco (M7.8): cabeçalho, miolo e rodapé a partir de valores já prontos. A `Moldura` (do
 * servidor) lê o conteúdo do site e entrega aqui; as páginas de erro, que são componentes de cliente e podem aparecer
 * justamente quando o banco falha, usam esta direto, com a marca do estudo.
 */

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

const IconeWhatsapp = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 12 12 0 0 0 4.6 4c1.7.7 2.1.6 2.8.5a2.4 2.4 0 0 0 1.6-1.1c.2-.6.2-1 .1-1.1l-.5-.3z" />
  </svg>
);

/**
 * Cabeçalho (floresta) e rodapé (profundo) do site público, com o botão do WhatsApp quando há o endereço dele.
 * `largura="cheia"` é para a página inicial, que tem faixas de cor de ponta a ponta; as outras ficam no miolo.
 * Sem o nome da empresa (a página de erro, que não lê o banco, ou o site em configuração), nenhum nome é inventado: o
 * cabeçalho mostra só a marca, com o link "Início" para quem usa leitor de tela, e o rodapé fica sem a frase e sem o ©.
 */
export function MolduraBase({
  nome: nomeRecebido = "",
  marca = MARCA_PADRAO,
  rodape,
  identidade = null,
  whatsapp = null,
  largura = "miolo",
  children,
}: {
  /** Nome da empresa (o texto da marca e do ©); vazio ou omitido = não conhecido. */
  nome?: string;
  marca?: string;
  /** Frase do rodapé; vazia = o nome. */
  rodape?: string;
  /** Linha "razão social · CNPJ · endereço" (Decreto 7.962, art. 2º), ou null quando não há. */
  identidade?: string | null;
  /** Link do botão flutuante do WhatsApp (null = sem botão). */
  whatsapp?: string | null;
  largura?: "miolo" | "cheia";
  children: ReactNode;
}) {
  const ano = new Date().getFullYear();
  const nome = nomeRecebido.trim();
  const frase = rodape?.trim() || nome;
  return (
    <div className={styles.pagina}>
      {/* M7.11: o primeiro elemento focável; leva ao miolo sem passar pelo menu. */}
      <PularParaConteudo />
      <header className={styles.topo}>
        <Link href="/" className={styles.marca} aria-label={nome ? undefined : "Início"}>
          <Image src={marca} alt="" width={40} height={40} unoptimized className={styles.marcaIcone} />
          {nome && <span>{marcaComDestaque(nome)}</span>}
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
      <main id={ID_CONTEUDO} tabIndex={-1} className={largura === "cheia" ? styles.conteudo : `${styles.conteudo} ${styles.miolo}`}>
        {children}
      </main>
      {whatsapp && (
        <LinkNovaJanela className={styles.whatsapp} href={whatsapp} aria-label={nome ? `Falar com ${nome} pelo WhatsApp` : "Falar pelo WhatsApp"}>
          <IconeWhatsapp />
        </LinkNovaJanela>
      )}
      <footer className={styles.rodape}>
        <div className={styles.rodapeDentro}>
          <strong className={styles.rodapeMarca}>
            <Image src={marca} alt="" width={34} height={34} unoptimized className={styles.marcaIcone} />
            {nome && <span>{marcaComDestaque(nome)}</span>}
          </strong>
          {frase && <p>{frase}</p>}
          <div className={styles.rodapeLinks}>
            <Link href="/imoveis">Nossas casas</Link>
            <Link href="/consulta">Consulta</Link>
            <Link href="/hospede">Minha reserva</Link>
            <Link href="/anunciar">Anuncie seu imóvel</Link>
            <Link href="/painel">Área da equipe</Link>
          </div>
          {/* Páginas legais (M7.4): sempre no rodapé; antes da versão 1, cada uma diz que está em preparação. */}
          <div className={styles.rodapeLegal}>
            <Link href="/termos">Termos de uso</Link>
            <Link href="/privacidade">Privacidade</Link>
            <Link href="/cancelamento">Cancelamento</Link>
          </div>
          {identidade && <small className={styles.rodapeIdentidade}>{identidade}</small>}
          {nome && (
            <small>
              © {ano} {nome}
            </small>
          )}
        </div>
      </footer>
    </div>
  );
}
