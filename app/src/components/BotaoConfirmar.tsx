"use client";

import type { ButtonHTMLAttributes } from "react";

/**
 * Botão de envio que pede confirmação antes (excluir, remover, cancelar, estornar):
 * nada some por um toque acidental. Regra do sistema: toda ação destrutiva usa este botão.
 * A pergunta pode ser montada na hora do clique (ex.: com o valor digitado no formulário).
 */
export function BotaoConfirmar({ pergunta, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pergunta: string | (() => string) }) {
  return (
    <button
      type="submit"
      {...props}
      onClick={(ev) => {
        if (!window.confirm(typeof pergunta === "function" ? pergunta() : pergunta)) {
          ev.preventDefault();
          return;
        }
        onClick?.(ev);
      }}
    />
  );
}
