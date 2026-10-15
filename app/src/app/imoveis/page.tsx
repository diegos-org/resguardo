import { CartaoImovel } from "@/components/site/CartaoImovel";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import { SemCasas, textoSemCasas } from "@/components/site/SemCasas";
import styles from "@/components/site/site.module.css";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { imoveisDoSite } from "@/site/site";

/**
 * Prévia do link (M7.13): a frase da vitrine de casas da página inicial (Configurações → Textos do site; esta página tem
 * uma frase fixa) e a capa do site; sem nenhuma casa no site (M7.8), o aviso do site sem casas, o que a página mostra. A
 * lista é a mesma da página (`imoveisDoSite`, com `cache`: uma leitura só).
 */
export async function generateMetadata() {
  const { db, conteudo } = await carregarSite();
  const temCasas = conteudo ? (await imoveisDoSite(db, conteudo.organizacaoId)).length > 0 : false;
  return metadadosDoSite("Nossas casas", { descricao: conteudo && (temCasas ? conteudo.textos.vitrineTexto : textoSemCasas(conteudo.textos)) });
}

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
        {lista.length > 0 && <p>Escolha um apartamento para ver o que ele oferece e consultar as datas.</p>}
      </header>
      {lista.length ? (
        <div className={styles.grade}>
          {lista.map((i) => (
            // Logo abaixo do h1 "Nossas casas": o título de cada casa é h2 (M7.11).
            <CartaoImovel key={i.codigo} imovel={i} nivel={2} />
          ))}
        </div>
      ) : (
        // Nenhuma casa publicada (M7.8): avisa e oferece o contato, em vez de "Em breve.".
        <SemCasas conteudo={conteudo} />
      )}
    </Moldura>
  );
}
