import Link from "next/link";
import { CartaoImovel } from "@/components/site/CartaoImovel";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { carregarSite } from "@/site/pagina";
import { imoveisDoSite } from "@/site/site";

export default async function Inicio() {
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const { textos } = conteudo;
  const lista = await imoveisDoSite(db, conteudo.organizacaoId);
  return (
    <Moldura conteudo={conteudo}>
      <section className={styles.heroi}>
        <h1>{textos.titulo}</h1>
        {textos.subtitulo && <p>{textos.subtitulo}</p>}
      </section>
      <section className={styles.secao}>
        <h2>Apartamentos</h2>
        {lista.length ? (
          <div className={styles.grade}>
            {lista.map((i) => (
              <CartaoImovel key={i.codigo} imovel={i} />
            ))}
          </div>
        ) : (
          <p className={styles.miudo}>Em breve.</p>
        )}
      </section>
      {textos.sobre && (
        <section className={styles.secao}>
          <h2>Sobre</h2>
          <p className={styles.texto}>{textos.sobre}</p>
        </section>
      )}
      {textos.comoReservar && (
        <section className={styles.secao}>
          <h2>Como reservar</h2>
          <p className={styles.texto}>{textos.comoReservar}</p>
        </section>
      )}
      <section className={styles.secao}>
        <h2>Contato</h2>
        {textos.contato && <p className={styles.texto}>{textos.contato}</p>}
        <p style={{ marginTop: 12 }}>
          <Link href="/consulta" className={styles.botao}>
            Consultar disponibilidade
          </Link>
        </p>
      </section>
    </Moldura>
  );
}
