import { TITULO_REGRAS_DA_CASA } from "@/site/regras-da-casa";
import styles from "./site.module.css";

/**
 * A parte "Regras da casa" (M7.20): as regras em fichas e o texto livre da ficha do imóvel. A página da casa usa como
 * título da ficha (h2, com os horários e a estadia mínima nas fichas); a página da cotação, dentro do quadro da cotação
 * (h3, só as regras de convivência: os horários vão numa linha acima).
 */
export function RegrasDaCasa({ itens, texto, nivel = 2 }: { itens: string[]; texto: string; nivel?: 2 | 3 }) {
  const Titulo = nivel === 3 ? "h3" : "h2";
  return (
    <section aria-labelledby="titulo-regras">
      <Titulo id="titulo-regras" className={styles.tituloFicha}>
        {TITULO_REGRAS_DA_CASA}
      </Titulo>
      <ul className={styles.fichas}>
        {itens.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {texto && (
        <p className={styles.texto} style={{ marginTop: 12 }}>
          {texto}
        </p>
      )}
    </section>
  );
}
