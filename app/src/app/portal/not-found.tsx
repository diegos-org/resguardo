import Link from "next/link";
import { MolduraPortal } from "@/components/portal/MolduraPortal";
import styles from "@/components/portal/portal.module.css";
import { carregarSite } from "@/site/pagina";

/**
 * Endereço que não existe no portal do proprietário (M7.8): na moldura do portal, não na do site. Não mostra nada de
 * quem está entrando: só o nome da empresa (o mesmo da página de entrada) e o caminho de volta.
 */
export default async function NaoEncontradaNoPortal() {
  const { conteudo } = await carregarSite();
  return (
    <MolduraPortal empresa={conteudo?.nomeEmpresa ?? ""} titulo="Portal do proprietário" estreito>
      <header>
        <h1>Página não encontrada</h1>
        <p className={styles.miudo}>Este endereço não existe no portal. Confira o link ou volte ao início do portal.</p>
      </header>
      <Link href="/portal" className={styles.botao}>
        Voltar ao portal
      </Link>
    </MolduraPortal>
  );
}
