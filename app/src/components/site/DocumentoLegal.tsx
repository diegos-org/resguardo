import { Fragment, type ReactNode } from "react";
import type { Bloco } from "@/configuracoes/paginas-legais-texto";
import styles from "./site.module.css";

/** Marcadores da prévia do painel ("[falta: CNPJ]", "[não existe: {{x}}]", "[não vale aqui: {{x}}]"). */
const MARCADOR_PREVIA = /(\[(?:falta|não existe|não vale aqui): [^\]\n]*\])/;

function comMarcas(texto: string, marcar: boolean): ReactNode {
  if (!marcar) return texto;
  return texto.split(MARCADOR_PREVIA).map((parte, i) => (i % 2 ? <mark key={i} className={styles.faltaLegal}>{parte}</mark> : <Fragment key={i}>{parte}</Fragment>));
}

/**
 * Texto de uma página legal (M7.4), já em blocos (`blocosDoDocumento`): título vira `<h2>`, parágrafo mantém as quebras
 * de linha, lista vira `<ul>`/`<ol>`. Só apresentação, sem estado: serve à página do site, à prévia do painel e ao
 * resumo junto da caixa de aceite. `marcarFaltas` destaca os marcadores da prévia (só no painel).
 */
export function DocumentoLegal({ blocos, marcarFaltas = false, className }: { blocos: readonly Bloco[]; marcarFaltas?: boolean; className?: string }) {
  return (
    <div className={className ? `${styles.documentoLegal} ${className}` : styles.documentoLegal}>
      {blocos.map((b, i) => {
        if (b.tipo === "titulo") return <h2 key={i}>{comMarcas(b.texto, marcarFaltas)}</h2>;
        if (b.tipo === "paragrafo")
          return (
            <p key={i} className={styles.texto}>
              {comMarcas(b.texto, marcarFaltas)}
            </p>
          );
        const itens = b.itens.map((item, j) => <li key={j}>{comMarcas(item, marcarFaltas)}</li>);
        return b.ordenada ? (
          <ol key={i} start={b.inicio}>
            {itens}
          </ol>
        ) : (
          <ul key={i}>{itens}</ul>
        );
      })}
    </div>
  );
}
