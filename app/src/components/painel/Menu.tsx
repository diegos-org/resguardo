"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { manterFiltros } from "@/lib/filtros";
import { SECOES } from "@/lib/navegacao";
import styles from "./painel.module.css";

const ITENS = [{ slug: "", titulo: "Início" }, ...SECOES];

export function Menu() {
  const atual = usePathname();
  const filtros = manterFiltros(useSearchParams());
  return (
    <nav aria-label="Menu do painel">
      <ul className={styles.menu}>
        {ITENS.map((item) => {
          const href = item.slug ? `/painel/${item.slug}` : "/painel";
          const ativo = atual === href;
          return (
            <li key={href}>
              <Link href={href + filtros} className={ativo ? styles.ativo : undefined} aria-current={ativo ? "page" : undefined}>
                {item.titulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
