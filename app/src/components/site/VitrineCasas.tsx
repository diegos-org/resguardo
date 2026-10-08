"use client";

import { Children, type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import styles from "./site.module.css";

const MENOS_MOVIMENTO = "(prefers-reduced-motion: reduce)";
const pediuPoucoMovimento = () => window.matchMedia?.(MENOS_MOVIMENTO)?.matches ?? false;
function assinarMovimento(avisar: () => void) {
  const m = window.matchMedia?.(MENOS_MOVIMENTO);
  m?.addEventListener?.("change", avisar);
  return () => m?.removeEventListener?.("change", avisar);
}

/** Intervalo do movimento automático da vitrine. */
export const PASSO_VITRINE_MS = 6000;

/**
 * Vitrine "Seu endereço no Leblon" (M7.6): carrossel com setas e movimento automático, que para com o botão "Pausar
 * movimento", ao passar o mouse ou focar um cartão ou uma seta, e não começa para quem pediu menos movimento no aparelho. No
 * celular, um cartão por vez. Sem JavaScript, continua sendo uma faixa que rola para o lado.
 */
export function VitrineCasas({ children, rotulo, rodape }: { children: ReactNode; rotulo: string; rodape?: ReactNode }) {
  const faixa = useRef<HTMLDivElement>(null);
  const total = Children.count(children);
  const [pausado, setPausado] = useState(false);
  const [parado, setParado] = useState(false);
  const poucoMovimento = useSyncExternalStore(assinarMovimento, pediuPoucoMovimento, () => false);

  /** Rola um cartão para o lado; no fim, volta ao começo (e vice-versa). */
  const passar = useCallback((direcao: 1 | -1) => {
    const f = faixa.current;
    const cartao = f?.firstElementChild as HTMLElement | null;
    if (!f || !cartao) return;
    const passo = cartao.getBoundingClientRect().width + parseFloat(getComputedStyle(f).columnGap || "0");
    const fim = f.scrollWidth - f.clientWidth - 2;
    const destino = direcao === 1 && f.scrollLeft >= fim ? 0 : direcao === -1 && f.scrollLeft <= 2 ? f.scrollWidth : f.scrollLeft + direcao * passo;
    f.scrollTo({ left: destino, behavior: poucoMovimento ? "auto" : "smooth" });
  }, [poucoMovimento]);

  const automatico = total > 1 && !pausado && !parado && !poucoMovimento;
  useEffect(() => {
    if (!automatico) return;
    const t = window.setInterval(() => passar(1), PASSO_VITRINE_MS);
    return () => window.clearInterval(t);
  }, [automatico, passar]);

  return (
    <div className={styles.vitrine}>
      {/* A pausa por mouse ou foco vale para os cartões e as setas juntos: ir de um para o outro não solta o movimento. */}
      <div
        className={styles.vitrineFaixa}
        onMouseEnter={() => setParado(true)}
        onMouseLeave={() => setParado(false)}
        onFocus={() => setParado(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setParado(false);
        }}
      >
        <div ref={faixa} className={styles.carrossel} role="region" aria-roledescription="carrossel" aria-label={rotulo}>
          {children}
        </div>
        {total > 1 && (
          <>
            <button type="button" className={`${styles.setaVitrine} ${styles.setaAnterior}`} onClick={() => passar(-1)} aria-label="Casa anterior">
              ←
            </button>
            <button type="button" className={`${styles.setaVitrine} ${styles.setaProxima}`} onClick={() => passar(1)} aria-label="Próxima casa">
              →
            </button>
          </>
        )}
      </div>
      <div className={styles.vitrineRodape}>
        {rodape}
        {total > 1 && !poucoMovimento && (
          <button type="button" className={styles.pausaVitrine} onClick={() => setPausado((p) => !p)} aria-pressed={pausado}>
            {pausado ? "Retomar movimento" : "Pausar movimento"}
          </button>
        )}
      </div>
    </div>
  );
}
