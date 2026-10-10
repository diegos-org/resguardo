import Link from "next/link";
import { notFound } from "next/navigation";
import { type DocumentoLegal as Documento, PAGINAS_LEGAIS } from "@/configuracoes/paginas-legais-texto";
import { carregarSite } from "@/site/pagina";
import { vistaDaPaginaLegal } from "@/site/paginas-legais";
import { DocumentoLegal } from "./DocumentoLegal";
import { Moldura, SiteEmConfiguracao } from "./Moldura";
import styles from "./site.module.css";

const br = (d: string) => d.split("-").reverse().join("/");

/**
 * Termos de uso, Política de privacidade ou Política de cancelamento no site (M7.4): a versão em vigor, com a data, ou
 * uma versão anterior (`?versao=N`) com o aviso de que foi substituída. Na Política de cancelamento, o resumo vem antes,
 * em destaque. Sem versão publicada, só o aviso de que a página está em preparação.
 */
export async function PaginaLegal({ documento, versao }: { documento: Documento; versao: string | string[] | undefined }) {
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const vista = await vistaDaPaginaLegal(db, conteudo.organizacaoId, documento, versao);
  if (!vista) notFound();
  const { rota } = PAGINAS_LEGAIS[documento];
  return (
    <Moldura conteudo={conteudo}>
      <div className={styles.largo}>
        <header className={styles.cabecalhoPagina}>
          <p className={styles.olho}>Documento</p>
          <h1>{vista.titulo}</h1>
          {vista.tipo === "versao" && (vista.substituidaEm ? <p>Versão {vista.numero}, de {br(vista.data)}.</p> : <p>Versão {vista.numero}, em vigor desde {br(vista.data)}.</p>)}
        </header>
        {vista.tipo === "em_preparacao" ? (
          <p className={styles.aviso} role="note">
            Esta página está em preparação. Enquanto isso, as reservas seguem pela conversa com a nossa equipe.
          </p>
        ) : (
          <>
            {vista.substituidaEm && (
              <p className={styles.aviso} role="note">
                Você está vendo a versão {vista.numero}, de {br(vista.data)}, substituída em {br(vista.substituidaEm)}. <Link href={rota}>Ver a versão atual</Link>
              </p>
            )}
            {vista.resumo && (
              <section className={styles.resumoLegal} aria-labelledby="titulo-resumo-legal">
                <h2 id="titulo-resumo-legal">Resumo</h2>
                <DocumentoLegal blocos={vista.resumo} />
              </section>
            )}
            <DocumentoLegal blocos={vista.blocos} />
            {vista.versoes.length > 1 && (
              <nav className={styles.versoesLegais} aria-label="Outras versões">
                <h2>Outras versões</h2>
                <ul>
                  {vista.versoes
                    .filter((v) => v.numero !== vista.numero)
                    .map((v) => (
                      <li key={v.numero}>
                        <Link href={`${rota}?versao=${v.numero}`}>
                          Versão {v.numero}, de {br(v.data)}
                          {v.numero === vista.atual.numero ? " (em vigor)" : ""}
                        </Link>
                      </li>
                    ))}
                </ul>
              </nav>
            )}
          </>
        )}
      </div>
    </Moldura>
  );
}
