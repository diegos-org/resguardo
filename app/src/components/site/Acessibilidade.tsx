import type { ComponentProps } from "react";

/**
 * Peças de acessibilidade do site público, das páginas do hóspede e dos portais (M7.11). Um lugar só: o "Pular para o
 * conteúdo" das molduras e o link que abre outra janela. Os estilos (`.scl-pular`, `.scl-so-leitor`) ficam em
 * globals.css, junto do contorno de foco. Os textos são rótulos fixos de interface, como os outros rótulos do site.
 */

/** Id do miolo das molduras (`<main>`), para onde o "Pular para o conteúdo" leva. */
export const ID_CONTEUDO = "conteudo";

export const ROTULO_PULAR = "Pular para o conteúdo";

/**
 * Primeiro elemento focável da moldura: escondido até receber o foco do teclado, leva direto ao miolo, sem passar pelo
 * menu. O miolo tem `tabIndex={-1}` para receber o foco de fato (e o leitor de tela continuar a leitura dali).
 */
export function PularParaConteudo() {
  return (
    <a href={`#${ID_CONTEUDO}`} className="scl-pular">
      {ROTULO_PULAR}
    </a>
  );
}

/** O aviso lido por quem usa leitor de tela nos links que abrem outra janela (WCAG 3.2.5). */
export const AVISO_NOVA_JANELA = "abre em nova janela";

/** Rótulo com o aviso, para o link que já tem `aria-label` (o aria-label substitui o texto do link na leitura). */
export const comAvisoNovaJanela = (rotulo: string) => `${rotulo} (${AVISO_NOVA_JANELA})`;

/**
 * Link que abre outra janela (WhatsApp, Pix no Mercado Pago, páginas legais na versão aceita). O único `target="_blank"`
 * do site, das páginas do hóspede e dos portais: sempre com `rel="noopener noreferrer"` e com o aviso para o leitor de
 * tela — no `aria-label`, quando o link já tem um, ou num texto visualmente oculto no fim do link. Nada muda na tela.
 */
export function LinkNovaJanela({ children, "aria-label": rotulo, ...resto }: Omit<ComponentProps<"a">, "target" | "rel">) {
  return (
    <a {...resto} target="_blank" rel="noopener noreferrer" aria-label={rotulo ? comAvisoNovaJanela(rotulo) : undefined}>
      {children}
      {!rotulo && <span className="scl-so-leitor">{` (${AVISO_NOVA_JANELA})`}</span>}
    </a>
  );
}
