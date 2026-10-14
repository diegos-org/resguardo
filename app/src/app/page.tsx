import Image from "next/image";
import Link from "next/link";
import { CartaoImovel } from "@/components/site/CartaoImovel";
import { canalDeContato, FormConsulta } from "@/components/site/FormConsulta";
import { Moldura, SiteEmConfiguracao, TextoComDestaque } from "@/components/site/Moldura";
import { SemCasas } from "@/components/site/SemCasas";
import styles from "@/components/site/site.module.css";
import { VitrineCasas } from "@/components/site/VitrineCasas";
import { blocosDoTexto, tituloSimples } from "@/configuracoes/textos-site";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { hojeMaisCedo, imoveisDoSite } from "@/site/site";

export const generateMetadata = () => metadadosDoSite();

/**
 * Página inicial (M7.5, M7.6): capa com a foto escolhida no painel e a legenda vertical, busca, vitrine das casas em
 * carrossel, por que reservar direto, como reservar, contato e fechamento — textos e fotos editáveis no painel.
 */
export default async function Inicio() {
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const { textos, imagens } = conteudo;
  const lista = await imoveisDoSite(db, conteudo.organizacaoId);
  const beneficios = blocosDoTexto(textos.porque);
  return (
    <Moldura conteudo={conteudo} largura="cheia">
      <section className={`${styles.capa} ${imagens.capa ? styles.capaComFoto : ""}`} aria-label="Apresentação">
        {imagens.capa && <Image src={imagens.capa} alt="" fill sizes="100vw" unoptimized loading="eager" fetchPriority="high" className={styles.capaFoto} />}
        <div className={styles.capaDentro}>
          <div className={styles.capaTextos}>
            {textos.olho && <p className={styles.olho}>{textos.olho}</p>}
            <h1>
              <TextoComDestaque texto={textos.titulo} />
            </h1>
            {textos.subtitulo && <p className={styles.capaTexto}>{textos.subtitulo}</p>}
          </div>
          <a href={lista.length ? "#busca" : "#titulo-casas"} className={styles.capaLink}>
            Encontre seu lugar
            <span aria-hidden="true">↓</span>
          </a>
        </div>
        {textos.legendaCapa && (
          <p className={styles.capaLegenda} aria-hidden="true">
            {textos.legendaCapa}
          </p>
        )}
      </section>
      {lista.length > 0 && (
        <div className={styles.busca} id="busca">
          <div className={styles.buscaCaixa}>
            <FormConsulta imoveis={lista} valores={{}} hoje={hojeMaisCedo(lista)} canal={canalDeContato(conteudo)} variante="busca" />
          </div>
        </div>
      )}
      <section className={`${styles.secao} ${styles.casas}`} aria-labelledby="titulo-casas">
        <div className={styles.dentro}>
          <div className={styles.cabecalhoSecao}>
            <div>
              {textos.vitrineOlho && <p className={styles.olho}>{textos.vitrineOlho}</p>}
              <h2 id="titulo-casas">
                <TextoComDestaque texto={textos.vitrineTitulo || "Nossas casas"} />
              </h2>
              {textos.vitrineTexto && <p>{textos.vitrineTexto}</p>}
            </div>
            <Link href="/imoveis" className={styles.linkTexto}>
              Ver todas as casas ↗
            </Link>
          </div>
          {lista.length ? (
            <VitrineCasas
              rotulo={tituloSimples(textos.vitrineTitulo) || "Nossas casas"}
              rodape={
                <Link href="/imoveis" className={styles.linkTexto}>
                  Explore nossas casas
                </Link>
              }
            >
              {lista.map((i, n) => (
                <CartaoImovel key={i.codigo} imovel={i} carregarCedo={n < 2} />
              ))}
            </VitrineCasas>
          ) : (
            // Nenhuma casa publicada (M7.8): avisa e oferece o contato, em vez de "Em breve.".
            <SemCasas conteudo={conteudo} />
          )}
        </div>
      </section>
      {beneficios.length > 0 && (
        <section className={`${styles.secao} ${styles.porque}`} aria-labelledby="titulo-porque">
          <div className={styles.dentro}>
            {textos.porqueOlho && <p className={styles.olho}>{textos.porqueOlho}</p>}
            <h2 id="titulo-porque" className={styles.porqueTitulo}>
              <TextoComDestaque texto={textos.porqueTitulo || "Por que reservar direto"} />
            </h2>
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
            {textos.chamadaOlho && <p className={styles.olho}>{textos.chamadaOlho}</p>}
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
