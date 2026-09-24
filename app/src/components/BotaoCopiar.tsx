"use client";

import { useState } from "react";

/** Copia um texto (chave Pix, valor) para a área de transferência, com retorno visível. */
export function BotaoCopiar({ texto, rotulo, className }: { texto: string; rotulo: string; className?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={() =>
        navigator.clipboard.writeText(texto).then(
          () => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          },
          () => setCopiado(false),
        )
      }
    >
      {copiado ? "Copiado!" : rotulo}
    </button>
  );
}
