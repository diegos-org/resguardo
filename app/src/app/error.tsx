"use client"; // As páginas de erro do Next são componentes de cliente.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ErroNoPortal, molduraDoErro } from "@/components/portal/ErroNoPortal";
import { MolduraBase } from "@/components/site/MolduraBase";
import styles from "@/components/site/site.module.css";

/**
 * Erro inesperado (M7.8), em português e no visual do site: "tente de novo" e a volta ao início. Texto fixo e curto, sem
 * nada do banco, porque o erro pode ser o próprio banco (por isso a moldura sem banco, com a marca do estudo). Nas áreas
 * internas sem página de erro própria (a agenda da equipe, a entrada, o convite, ou uma falha na moldura do painel),
 * a moldura dos portais, sem o menu do site.
 */
export default function ErroNaPagina({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const interna = molduraDoErro(usePathname() ?? "/");
  if (interna) return <ErroNoPortal titulo={interna.titulo} volta={interna.volta} digest={error.digest} retry={retry} />;
  return (
    // Sem o nome da empresa (viria do banco): a moldura mostra só a marca do estudo, sem inventar um nome.
    <MolduraBase>
      <section className={styles.paginaAviso} aria-labelledby="titulo-erro">
        <h1 id="titulo-erro">Algo não saiu como esperado</h1>
        <p>Não conseguimos abrir esta página agora. Tente de novo em instantes.</p>
        <div className={styles.acoesAviso}>
          <button type="button" className={styles.botao} onClick={() => retry()}>
            Tentar de novo
          </button>
          <Link href="/" className={styles.linkTexto}>
            Voltar ao início
          </Link>
        </div>
      </section>
    </MolduraBase>
  );
}
