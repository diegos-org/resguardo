import Image from "next/image";
import type { BairroPublico } from "@/site/bairro";
import css from "./bairro.module.css";
import site from "./site.module.css";

/**
 * "O bairro à sua porta" no fim da ficha do imóvel (M7.6, estudo Sage): filete, olho, título, subtítulo e um cartão por
 * lugar (foto quando houver, nome, frase curta e distância). Sem foto, o cartão fica só com o texto — nunca uma imagem
 * genérica. Sem lugar, a seção não aparece. O olho (M7.16) e o subtítulo em branco não deixam parágrafo vazio.
 */
export function BairroAPorta({ olho, titulo, subtitulo, lugares }: BairroPublico) {
  if (!lugares.length) return null;
  return (
    <section className={css.secao} aria-labelledby="titulo-bairro">
      {olho && <p className={`${site.olho} ${css.olho}`}>{olho}</p>}
      <h2 id="titulo-bairro" className={css.titulo}>
        {titulo}
      </h2>
      {subtitulo && <p className={css.subtitulo}>{subtitulo}</p>}
      <ul className={css.lugares}>
        {lugares.map((l, i) => (
          <li key={`${i}-${l.nome}`} className={css.lugar}>
            {l.foto && (
              <div className={css.foto}>
                <Image src={l.foto} alt={`Foto de ${l.nome}`} fill sizes="(max-width: 1000px) 50vw, 300px" unoptimized loading="lazy" className={css.imagem} />
              </div>
            )}
            <div className={css.corpo}>
              <h3>{l.nome}</h3>
              {l.frase && <p>{l.frase}</p>}
              {l.distancia && <small>{l.distancia}</small>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
