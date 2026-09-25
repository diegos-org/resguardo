import styles from "@/components/site/site.module.css";
import { Moldura } from "@/components/site/Moldura";
import { carregarSite, metadadosDoSite } from "@/site/pagina";

export const generateMetadata = () => metadadosDoSite("Anuncie seu imóvel");

export default async function CadastroEnviado() {
  const { conteudo } = await carregarSite();
  return (
    <Moldura conteudo={conteudo}>
      <section className={styles.secao} style={{ maxWidth: 560 }}>
        <h1>Recebemos seu cadastro</h1>
        <p>
          Obrigado! A nossa equipe vai analisar os dados do seu imóvel e responder pelo e-mail que você confirmou. Se aprovado, você recebe um convite para
          acompanhar tudo pelo portal do proprietário.
        </p>
      </section>
    </Moldura>
  );
}
