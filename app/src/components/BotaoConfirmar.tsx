"use client";

import type { ButtonHTMLAttributes } from "react";

/**
 * Botão de envio que pede confirmação antes (excluir, remover, cancelar, estornar):
 * nada some por um toque acidental. Regra do sistema: toda ação destrutiva usa este botão.
 */
export function BotaoConfirmar({ pergunta, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pergunta: string }) {
  return (
    <button
      type="submit"
      {...props}
      onClick={(ev) => {
        if (!window.confirm(pergunta)) {
          ev.preventDefault();
          return;
        }
        onClick?.(ev);
      }}
    />
  );
}
