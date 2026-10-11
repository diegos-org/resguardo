"use client";

/** "Imprimir" (ou salvar em PDF pelo navegador) a página aberta: nada é gerado nem guardado pelo sistema. */
export function BotaoImprimir({ rotulo = "Imprimir" }: { rotulo?: string }) {
  return (
    <button type="button" onClick={() => window.print()}>
      {rotulo}
    </button>
  );
}
