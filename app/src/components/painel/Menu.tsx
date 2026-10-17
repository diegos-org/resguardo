"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useId, useRef } from "react";
import { manterFiltros } from "@/lib/filtros";
import type { Papel } from "@/db/schema";
import { secoesPara } from "@/lib/navegacao";
import styles from "./painel.module.css";

/** Dito só ao leitor de tela, entre "Menu" e o nome da seção atual (na tela, um "·"). */
export const ROTULO_SECAO_ATUAL = ", você está em ";

/** `ocultar` (M10.1a): seções que a sessão não abre além das da permissão do papel (ex.: "mensagens", pela configuração). */
export function Menu({ papel, ocultar = [] }: { papel: Papel; ocultar?: readonly string[] }) {
  const atual = usePathname();
  const filtros = manterFiltros(useSearchParams());
  const idLista = useId();
  const gaveta = useRef<HTMLDetailsElement>(null);
  const itens = [{ slug: "", titulo: "Início" }, ...secoesPara(papel, ocultar)].map((item) => {
    const href = item.slug ? `/painel/${item.slug}` : "/painel";
    // Subpáginas (ex.: /painel/configuracoes/regras) marcam a seção de cima.
    const ativo = atual === href || (item.slug !== "" && atual.startsWith(`${href}/`));
    return { ...item, href, ativo };
  });
  const secaoAtual = itens.find((item) => item.ativo);
  // Tocar numa seção fecha a lista (também a da própria página, que não muda o caminho).
  const fechar = () => {
    if (gaveta.current) gaveta.current.open = false;
  };
  return (
    <nav aria-label="Menu do painel">
      {/*
        Celular (M0.10): o botão "Menu" abre a lista inteira logo abaixo, sem JavaScript (a lista vem logo depois do
        <details> e o CSS a esconde enquanto ele está fechado). Fecha sozinho ao trocar de página: a chave remonta o
        <details> fechado. No computador, o botão não aparece e a lista fica sempre à vista, como antes.
        Quem toca em "Menu" antes de o JavaScript carregar (celular lento) já abre a lista: o navegador põe o atributo
        `open`, que o React não esperava, e no desenvolvimento acusaria a diferença na hidratação. O
        suppressHydrationWarning vale só para os atributos deste <details> e não muda nada no navegador.
      */}
      <details key={atual} ref={gaveta} className={styles.gaveta} suppressHydrationWarning>
        <summary className={styles.botaoMenu} aria-controls={idLista}>
          <span className={styles.iconeMenu} aria-hidden="true" />
          <span className={styles.rotuloMenu}>
            Menu
            {secaoAtual && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="scl-so-leitor">{ROTULO_SECAO_ATUAL}</span>
                {secaoAtual.titulo}
              </>
            )}
          </span>
        </summary>
      </details>
      <ul id={idLista} className={styles.menu}>
        {itens.map((item) => (
          <li key={item.href}>
            <Link href={item.href + filtros} className={item.ativo ? styles.ativo : undefined} aria-current={item.ativo ? "page" : undefined} onClick={fechar}>
              {item.titulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
