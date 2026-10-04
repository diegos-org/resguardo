import Link from "next/link";
import { CartaoImovel } from "@/components/site/CartaoImovel";
import { canalDeContato, FormConsulta } from "@/components/site/FormConsulta";
import { Moldura, SiteEmConfiguracao, TextoComDestaque } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { blocosDoTexto } from "@/configuracoes/textos-site";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { hojeMaisCedo, imoveisDoSite } from "@/site/site";

export const generateMetadata = () => metadadosDoSite();

/** Página inicial: capa, busca, casas, por que reservar direto, como reservar, contato e fechamento — tudo editável no painel. */
export default async function Inicio() {
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const { textos } = conteudo;
  const lista = await imoveisDoSite(db, conteudo.organizacaoId);
  const beneficios = blocosDoTexto(textos.sobre);
  const lugares = [...new Set(lista.map((i) => i.bairro).filter(Boolean))];
  return (
    <Moldura conteudo={conteudo} largura="cheia">
      <section className={styles.capa} aria-label="Apresentação">
        <div className={styles.capaDentro}>
          {textos.olho && <p className={styles.olho}>{textos.olho}</p>}
          <h1>
            <TextoComDestaque texto={textos.titulo} />
          </h1>
          {textos.subtitulo && <p className={styles.capaTexto}>{textos.subtitulo}</p>}
          <Link href="/imoveis" className={styles.capaLink}>
            Conheça as casas
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
      {lista.length > 0 && (
        <div className={styles.busca}>
          <div className={styles.buscaCaixa}>
            <FormConsulta imoveis={lista} valores={{}} hoje={hojeMaisCedo(lista)} canal={canalDeContato(conteudo)} variante="busca" />
          </div>
        </div>
      )}
      <section className={`${styles.secao} ${styles.casas}`} aria-labelledby="titulo-casas">
        <div className={styles.dentro}>
          <div className={styles.cabecalhoSecao}>
            <div>
              <p className={styles.olho}>Apartamentos</p>
              <h2 id="titulo-casas">Nossas casas</h2>
              {lugares.length > 0 && <p>{lugares.join(" · ")}</p>}
            </div>
            <Link href="/imoveis" className={styles.linkTexto}>
              Ver todas →
            </Link>
          </div>
          {lista.length ? (
            <div className={styles.carrossel}>
              {lista.map((i) => (
                <CartaoImovel key={i.codigo} imovel={i} />
              ))}
            </div>
          ) : (
            <p className={styles.miudo}>Em breve.</p>
          )}
        </div>
      </section>
      {beneficios.length > 0 && (
        <section className={`${styles.secao} ${styles.porque}`} aria-labelledby="titulo-porque">
          <div className={styles.dentro}>
            <p className={styles.olho}>Reservar direto</p>
            <h2 id="titulo-porque">Por que reservar direto</h2>
            {beneficios.length > 1 ? (
              <div className={styles.beneficios}>
                {beneficios.map((b, i) => (
                  <article key={i}>
                    <span>{String(i + 1).padStart(2, "0")} /</span>
                    {b.titulo && <h3>{b.titulo}</h3>}
                    <p>{b.texto}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.texto}>
                {beneficios[0].titulo && <h3>{beneficios[0].titulo}</h3>}
                <p>{beneficios[0].texto}</p>
              </div>
            )}
          </div>
        </section>
      )}
      {textos.comoReservar && (
        <section className={styles.secao} aria-labelledby="titulo-como">
          <div className={styles.dentro}>
            <p className={styles.olho}>Passo a passo</p>
            <h2 id="titulo-como">Como reservar</h2>
            <p className={styles.texto}>{textos.comoReservar}</p>
          </div>
        </section>
      )}
      {textos.contato && (
        <section className={styles.secao} aria-labelledby="titulo-contato">
          <div className={styles.dentro}>
            <p className={styles.olho}>Fale com a gente</p>
            <h2 id="titulo-contato">Contato</h2>
            <p className={styles.texto}>{textos.contato}</p>
          </div>
        </section>
      )}
      {textos.chamada && (
        <section className={`${styles.secao} ${styles.fechamento}`} aria-labelledby="titulo-chamada">
          <div className={styles.dentro}>
            <h2 id="titulo-chamada">
              <TextoComDestaque texto={textos.chamada} />
            </h2>
            <Link href="/consulta" className={`${styles.botao} ${styles.botaoClaro}`}>
              Planeje sua estadia
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </section>
      )}
    </Moldura>
  );
}
