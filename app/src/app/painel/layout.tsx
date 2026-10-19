import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/acesso/auth";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { Menu } from "@/components/painel/Menu";
import { marcaComDestaque } from "@/components/site/MolduraBase";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { getDb } from "@/db/client";
import { podeVerConversas } from "@/whatsapp/acesso";
import styles from "@/components/painel/painel.module.css";

export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  const sessao = await exigirSessaoPainel();
  const db = getDb();
  // M10.1a: "Mensagens" só no menu de quem vê as conversas (a configuração "Quem vê as conversas", padrão só o admin).
  const [empresa, verConversas] = await Promise.all([nomeDaEmpresa(db, sessao.organizacaoId), podeVerConversas(db, sessao)]);

  async function sair() {
    "use server";
    await signOut({ redirectTo: "/entrar" });
  }

  return (
    <div className={styles.estrutura}>
      <aside className={styles.lateral}>
        <Link href="/painel" className={styles.marca}>
          {marcaComDestaque(empresa)}
        </Link>
        <Suspense>
          <Menu papel={sessao.papel} ocultar={verConversas ? [] : ["mensagens"]} />
        </Suspense>
      </aside>
      <div className={styles.principal}>
        <header className={styles.cabecalho}>
          <span>Painel interno</span>
          <span className={styles.cabecalhoAcoes}>
            <span className={styles.selo}>Homologação · dados fictícios</span>
            <form action={sair}>
              <button type="submit" className={styles.sair}>
                Sair
              </button>
            </form>
          </span>
        </header>
        <main className={styles.conteudo}>{children}</main>
      </div>
    </div>
  );
}
