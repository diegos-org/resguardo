import { notFound } from "next/navigation";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import { Cotacao } from "@/components/site/Cotacao";
import { FormSegurar } from "@/components/site/FormSegurar";
import { Moldura, SiteEmConfiguracao } from "@/components/site/Moldura";
import styles from "@/components/site/site.module.css";
import { segurarDatasAcao } from "@/site/acoes";
import { codigoCotacaoValido, verCotacao } from "@/site/cotacoes";
import { carregarSite, metadadosDoSite } from "@/site/pagina";

export const generateMetadata = () => metadadosDoSite("Cotação");

/** Página pública da cotação (M8.1): sempre revalidada ao abrir; nada é gravado só por visitar. */
export default async function PaginaCotacao({ params }: PageProps<"/reservar/[codigo]">) {
  const { codigo: bruto } = await params;
  const codigo = decodeURIComponent(bruto).toUpperCase();
  if (!codigoCotacaoValido(codigo)) notFound();
  const { db, conteudo } = await carregarSite();
  if (!conteudo) return <SiteEmConfiguracao />;
  const [vista, regras] = await Promise.all([verCotacao(db, conteudo.organizacaoId, codigo), lerRegrasCalendario(db, conteudo.organizacaoId)]);
  if (!vista) notFound();
  return (
    <Moldura conteudo={conteudo}>
      <div className={styles.largo}>
        <header className={styles.cabecalhoPagina}>
          <p className={styles.olho}>Cotação</p>
          <h1>Reservar</h1>
        </header>
        <Cotacao
          vista={vista}
          whatsapp={conteudo.whatsapp}
          email={conteudo.email}
          formulario={vista.estado === "aberta" && !vista.mudou ? <FormSegurar codigo={codigo} minutos={regras.site.minutosHold} acao={segurarDatasAcao} /> : null}
        />
      </div>
    </Moldura>
  );
}
