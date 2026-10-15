import { CartaoImovel } from "@/components/site/CartaoImovel";
import { Moldura, SiteEmConfiguracao, TextoComDestaque } from "@/components/site/Moldura";
import { SemCasas, textoSemCasas } from "@/components/site/SemCasas";
import styles from "@/components/site/site.module.css";
import { tituloDaSecao } from "@/configuracoes/textos-site";
import { carregarSite, metadadosDoSite } from "@/site/pagina";
import { imoveisDoSite } from "@/site/site";

/**
 * Prévia do link (M7.13): a frase que a página mostra — a de Nossas casas abaixo do título (Configurações → Textos do
 * site, M7.16; vazia, a descrição do site) — e a capa do site; sem nenhuma casa no site (M7.8), o aviso do site sem casas,
 * que a página mostra no lugar da lista. Até o M7.16 a frase da página era fixa no código e a prévia usava a da vitrine
 * de casas da página inicial. O título da aba continua "Nossas casas", o nome da página no menu, mesmo com outro título
 * na página. A lista é a mesma da página (`imoveisDoSite`, com `cache`: uma leitura só).
 */
export async function generateMetadata() {
  const { db, conteudo } = await carregarSite();
  const temCasas = conteudo ? (await imoveisDoSite(db, conteudo.organizacaoId)).length > 0 : false;
  return metadadosDoSite("Nossas casas", { descricao: conteudo && (temCasas ? conteudo.textos.catalogoTexto : textoSemCasas(conteudo.textos)) });
}

export default async function Catalogo() {
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const lista = await imoveisDoSite(db, conteudo.organizacaoId);
  const lugares = [...new Set(lista.map((i) => i.bairro).filter(Boolean))];
  return (
    <Moldura conteudo={conteudo}>
      <header className={styles.cabecalhoPagina}>
        {/* O olho vem dos bairros das casas do site (é dado, não um texto do painel). */}
        <p className={styles.olho}>{["Apartamentos", ...lugares].join(" · ")}</p>
        <h1>
          <TextoComDestaque texto={tituloDaSecao(conteudo.textos, "catalogoTitulo")} />
        </h1>
        {lista.length > 0 && conteudo.textos.catalogoTexto && <p>{conteudo.textos.catalogoTexto}</p>}
      </header>
      {lista.length ? (
        <div className={styles.grade}>
          {lista.map((i) => (
            // Logo abaixo do h1 da página: o título de cada casa é h2 (M7.11).
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
