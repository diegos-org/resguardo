"use client";

import { useEffect, useRef } from "react";
import { marcarComoLidaAcao } from "@/whatsapp/acoes";

/**
 * Marca a conversa como lida (estado interno do sistema; nada vai para a Meta) depois que a tela abre no navegador,
 * uma vez por conversa e última mensagem mostrada. Nunca no carregamento do servidor: o `Link` da lista pode
 * pré-carregar a página sem ninguém abrir a conversa. Recebe só o id da conversa e a hora da última recebida (ISO).
 */
export function MarcarComoLida({ contatoId, ate }: { contatoId: string; ate: string }) {
  const marcada = useRef<string | null>(null);
  useEffect(() => {
    const chave = `${contatoId}|${ate}`;
    if (marcada.current === chave) return;
    marcada.current = chave;
    // Falhou (sem conexão, sessão vencida): fica não lida, e a próxima abertura tenta de novo. O servidor registra o erro.
    marcarComoLidaAcao(contatoId, ate).catch(() => undefined);
  }, [contatoId, ate]);
  return null;
}
