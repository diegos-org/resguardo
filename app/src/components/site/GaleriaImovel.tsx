"use client";

import Image from "next/image";
import { useState } from "react";
import type { FotoPublica } from "@/imoveis/fotos-regras";
import styles from "./site.module.css";

/** Galeria da página do imóvel (M7.3): a foto escolhida em destaque, com contador e legenda, e as miniaturas ao lado. */
export function GaleriaImovel({ nome, fotos }: { nome: string; fotos: readonly FotoPublica[] }) {
  const [atual, setAtual] = useState(0);
  const foto = fotos[atual] ?? fotos[0];
  if (!foto) return null;
  const uma = fotos.length === 1;
  return (
    <div className={`${styles.galeria} ${uma ? styles.galeriaUma : ""}`} role="region" aria-label={`Fotos de ${nome}`}>
      <figure className={styles.galeriaPrincipal}>
        <Image src={foto.grande} alt={foto.legenda || `Foto ${atual + 1} de ${nome}`} fill sizes={uma ? "100vw" : "(max-width: 600px) 100vw, 50vw"} unoptimized priority className={styles.fotoReal} />
        {foto.legenda && <figcaption className={styles.legendaFoto}>{foto.legenda}</figcaption>}
        {!uma && (
          <span className={styles.contador} aria-live="polite">
            {atual + 1} / {fotos.length}
          </span>
        )}
      </figure>
      {!uma && (
        <div className={`${styles.miniaturas} ${fotos.length > 4 ? styles.miniaturasRolagem : ""}`}>
          {fotos.map((f, i) => (
            <button key={f.grande} type="button" className={styles.miniatura} aria-label={`Ver a foto ${i + 1}${f.legenda ? `: ${f.legenda}` : ""}`} aria-current={i === atual} onClick={() => setAtual(i)}>
              <Image src={f.pequena} alt="" fill sizes="160px" unoptimized className={styles.fotoReal} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
