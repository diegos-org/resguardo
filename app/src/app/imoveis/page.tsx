import type { Metadata } from "next";
import { CartaoImovel } from "@/components/site/CartaoImovel";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { carregarSite } from "@/site/pagina";
import { imoveisDoSite } from "@/site/site";

export const metadata: Metadata = { title: "Apartamentos — Sua Casa Leblon" };

export default async function Catalogo() {
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const lista = await imoveisDoSite(db, conteudo.organizacaoId);
  return (
    <Moldura conteudo={conteudo}>
      <section className={styles.secao}>
        <h1 style={{ fontSize: "2rem", marginBottom: 16 }}>Apartamentos</h1>
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
    </Moldura>
  );
}
