import styles from "./mensagens.module.css";

/**
 * O carregamento da caixa de entrada e da conversa (M10.1a): só a forma e o texto, sem dado nenhum (nada é lido aqui).
 * A caixa de entrada mostra a forma da lista; a conversa, a dos balões (um de cada lado), para a tela não pular de forma
 * quando a página chega. As duas `loading.tsx` de `app/painel/mensagens` usam este componente.
 */
export function Carregando({ texto, linhas, forma = "lista" }: { texto: string; linhas: number; forma?: "lista" | "conversa" }) {
  return (
    <section aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 820 }}>
      <h1>Mensagens</h1>
      <p role="status" className={styles.subtitulo}>
        {texto}
      </p>
      {forma === "lista" ? (
        <ul className={styles.lista} aria-hidden="true">
          {Array.from({ length: linhas }, (_, i) => (
            <li key={i} className={styles.item} style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <span className={styles.esqueleto} style={{ width: `${40 + ((i * 17) % 30)}%` }} />
              <span className={styles.esqueleto} style={{ width: `${65 + ((i * 11) % 25)}%`, height: 10 }} />
            </li>
          ))}
        </ul>
      ) : (
        <ol className={styles.mensagens} aria-hidden="true">
          {Array.from({ length: linhas }, (_, i) => (
            <li key={i} className={`${styles.balao} ${i % 2 ? styles.enviada : ""}`} style={{ width: `${45 + ((i * 13) % 30)}%` }}>
              <span className={styles.esqueleto} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
