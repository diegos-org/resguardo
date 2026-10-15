import { redirect } from "next/navigation";
import styles from "@/components/site/site.module.css";
import { FormCadastro } from "@/components/site/FormCadastro";
import { Moldura } from "@/components/site/Moldura";
import { enviarCadastroAcao } from "@/marketplace/acoes";
import { emailDoCadastro } from "@/marketplace/sessao";
import { carregarSite, metadadosDoSite } from "@/site/pagina";

export const generateMetadata = () => metadadosDoSite("Anuncie seu imóvel");

/** Passo 2: dados do proprietário e do imóvel (só com o e-mail confirmado). */
export default async function DadosCadastro() {
  const email = await emailDoCadastro();
  if (!email) redirect("/anunciar");
  const { conteudo } = await carregarSite();
  return (
    <Moldura conteudo={conteudo}>
      <section className={styles.estreito}>
        <header className={styles.cabecalhoPagina}>
          <p className={styles.olho}>Para proprietários</p>
          <h1>Dados do seu imóvel</h1>
        </header>
        <p className={styles.miudo}>E-mail confirmado: {email}. O endereço exato fica só com a nossa equipe; nada aparece no site antes da análise.</p>
        <FormCadastro enviar={enviarCadastroAcao} empresa={conteudo?.nomeEmpresa ?? ""} />
      </section>
    </Moldura>
  );
}
