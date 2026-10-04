import { CartaoImovel } from "@/components/site/CartaoImovel";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { imoveisDoSite } from "@/site/site";

export const generateMetadata = () => metadadosDoSite("Nossas casas");

export default async function Catalogo() {
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const lista = await imoveisDoSite(db, conteudo.organizacaoId);
  const lugares = [...new Set(lista.map((i) => i.bairro).filter(Boolean))];
  return (
    <Moldura conteudo={conteudo}>
      <header className={styles.cabecalhoPagina}>
        <p className={styles.olho}>{["Apartamentos", ...lugares].join(" · ")}</p>
        <h1>Nossas casas</h1>
        <p>Escolha um apartamento para ver o que ele oferece e consultar as datas.</p>
      </header>
      {lista.length ? (
        <div className={styles.grade}>
          {lista.map((i) => (
            <CartaoImovel key={i.codigo} imovel={i} />
          ))}
        </div>
      ) : (
        <p className={styles.miudo}>Em breve.</p>
      )}
    </Moldura>
  );
}
