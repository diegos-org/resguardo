"use client";

import Image, { getImageProps } from "next/image";
import { useCallback, useState } from "react";
import type { FotoPublica, Medidas } from "@/imoveis/fotos-regras";
import styles from "./site.module.css";

/**
 * Proporção do quadro da foto principal (largura ÷ altura), a mesma do site.module.css: `.galeriaPrincipal` 3:2 e, com
 * uma foto só, `.galeriaUma .galeriaPrincipal` 16:9. Mudou lá, muda aqui.
 */
export const PROPORCAO_QUADRO = { varias: 3 / 2, uma: 16 / 9 } as const;

/**
 * Largura do quadro da foto principal na tela (`sizes`, M7.19), tirada do site.module.css: o miolo da página tem até
 * 1240 px, com respiro de 5vw de cada lado (20 px até 600 px de tela); a galeria tem duas colunas iguais com 12 px entre
 * elas (uma coluna só até 600 px) e, com uma foto só, a foto ocupa a largura toda. Acima de 1240 px o quadro só diminui,
 * então vale o tamanho de 1240 px. Mudou lá, muda aqui: um valor menor que o real deixaria a foto borrada.
 */
export const SIZES_GALERIA = {
  varias: "(max-width: 600px) calc(100vw - 40px), (max-width: 1240px) calc(45vw - 6px), 552px",
  uma: "(max-width: 600px) calc(100vw - 40px), (max-width: 1240px) 90vw, 1116px",
} as const;

/** Endereço como o next/image escreve uma imagem sem o otimizador (o mesmo da foto, ou com o "?dpl=" da versão publicada). */
const enderecoDaImagem = (src: string) => getImageProps({ src, alt: "", width: 1, height: 1, unoptimized: true }).props.src;

/**
 * As duas versões da foto para o navegador escolher (`srcset`, M7.19), cada uma com a largura que ela de fato cobre no
 * quadro: o quadro corta a foto para cobrir tudo, então numa foto mais larga que o quadro só a parte que aparece conta
 * (a altura × a proporção do quadro). A foto em pé, com a pequena de 600 px de largura, entra como 600w, não 800w.
 * Sem as medidas das duas versões, ou se a pequena não é menor, nada: fica só a grande, como antes.
 */
export function srcsetDaFoto(foto: FotoPublica, proporcao: number): string | undefined {
  const m = foto.medidas;
  if (!m || foto.pequena === foto.grande) return undefined;
  const largura = ({ largura, altura }: Medidas) => Math.min(largura, Math.round(altura * proporcao));
  const pequena = largura(m.pequena);
  const grande = largura(m.grande);
  if (!(pequena > 0) || grande <= pequena) return undefined;
  return `${enderecoDaImagem(foto.pequena)} ${pequena}w, ${enderecoDaImagem(foto.grande)} ${grande}w`;
}

/**
 * A foto em destaque: a mesma imagem que o next/image montava (mesmos estilos de "fill", recorte e texto alternativo),
 * agora com o `srcset` e o `sizes` (o next/image não aceita `srcset` próprio e, sem o otimizador, não monta um). O
 * otimizador da Vercel fica desligado: as fotos saem das rotas /fotos/<id> e /fotos/<id>/pequena, com o cache de uma
 * hora do M7.3. Como no next/image, o texto alternativo só aparece se a foto não carregar. Também quando a falha vem
 * antes de a página ficar interativa: o React não repete esse aviso, então, ao montar, a foto que já terminou sem
 * imagem (`complete` e largura zero) conta como falha, sem pedir a foto de novo.
 */
function FotoPrincipal({ foto, alt, uma }: { foto: FotoPublica; alt: string; uma: boolean }) {
  const [falhou, setFalhou] = useState<string | null>(null);
  const aoMontar = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setFalhou(img.getAttribute("src"));
  }, []);
  const srcSet = srcsetDaFoto(foto, uma ? PROPORCAO_QUADRO.uma : PROPORCAO_QUADRO.varias);
  const { props } = getImageProps({ src: foto.grande, alt, fill: true, unoptimized: true, loading: "eager", className: styles.fotoReal });
  const { src, style, ...resto } = props;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...resto}
      ref={aoMontar}
      alt={alt}
      style={falhou === src ? { ...style, color: undefined } : style}
      onError={() => setFalhou(src)}
      // `sizes` e `srcSet` antes do `src`, como no next/image: o React grava nessa ordem, e o Safari começaria a baixar a
      // grande antes de saber das versões.
      sizes={srcSet ? (uma ? SIZES_GALERIA.uma : SIZES_GALERIA.varias) : undefined}
      srcSet={srcSet}
      src={src}
    />
  );
}

/**
 * Galeria da página do imóvel (M7.3): a foto escolhida em destaque, com contador e legenda, e as miniaturas ao lado. A
 * foto em destaque deixa o navegador escolher entre a versão pequena e a grande (M7.19); as miniaturas já usam a pequena.
 */
export function GaleriaImovel({ nome, fotos }: { nome: string; fotos: readonly FotoPublica[] }) {
  const [atual, setAtual] = useState(0);
  const foto = fotos[atual] ?? fotos[0];
  if (!foto) return null;
  const uma = fotos.length === 1;
  return (
    <div className={`${styles.galeria} ${uma ? styles.galeriaUma : ""}`} role="region" aria-label={`Fotos de ${nome}`}>
      <figure className={styles.galeriaPrincipal}>
        <FotoPrincipal foto={foto} alt={foto.legenda || `Foto ${atual + 1} de ${nome}`} uma={uma} />
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
