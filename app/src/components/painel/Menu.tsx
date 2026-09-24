"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { manterFiltros } from "@/lib/filtros";
import type { Papel } from "@/db/schema";
import { secoesPara } from "@/lib/navegacao";
import styles from "./painel.module.css";


export function Menu({ papel }: { papel: Papel }) {
  const itens = [{ slug: "", titulo: "Início" }, ...secoesPara(papel)];
  const atual = usePathname();
  const filtros = manterFiltros(useSearchParams());
  return (
    <nav aria-label="Menu do painel">
      <ul className={styles.menu}>
        {itens.map((item) => {
          const href = item.slug ? `/painel/${item.slug}` : "/painel";
          // Subpáginas (ex.: /painel/configuracoes/regras) marcam a seção de cima.
          const ativo = atual === href || (item.slug !== "" && atual.startsWith(`${href}/`));
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
