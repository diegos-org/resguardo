import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/acesso/auth";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { Menu } from "@/components/painel/Menu";
import { marcaComDestaque } from "@/components/site/MolduraBase";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { getDb } from "@/db/client";
import styles from "@/components/painel/painel.module.css";

export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  const sessao = await exigirSessaoPainel();
  const empresa = await nomeDaEmpresa(getDb(), sessao.organizacaoId);

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
          <Menu papel={sessao.papel} />
        </Suspense>
      </aside>
      <div className={styles.principal}>
        <header className={styles.cabecalho}>
          <span>Painel interno</span>
          <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
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
