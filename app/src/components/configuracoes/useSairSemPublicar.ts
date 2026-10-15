"use client";

import { useCallback, useEffect, useRef } from "react";

/** A pergunta de quem sai de uma tela de texto versionado com o texto mudado e não publicado. */
export const PERGUNTA_SAIR_SEM_PUBLICAR = "Sair sem publicar? O texto mudado aqui se perde.";

const mesmaPagina = (a: URL, b: URL) => a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;

/**
 * Clique que tira desta tela na mesma aba: um link para outra página (abas de Configurações, menu do painel, os links
 * daqui). Não contam o que abre em outra aba ou janela, o que baixa um arquivo e o link que só rola esta página (#).
 */
function cliqueQueSai(e: MouseEvent): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!a || a.hasAttribute("download") || !["", "_self"].includes(a.getAttribute("target") ?? "")) return false;
  const destino = new URL(a.getAttribute("href") ?? "", window.location.href);
  if (destino.protocol !== "http:" && destino.protocol !== "https:") return false;
  return !(destino.hash && mesmaPagina(destino, new URL(window.location.href)));
}

/** Saídas (clique ou Voltar) já confirmadas por outro formulário da mesma tela: a pergunta aparece uma vez só. */
const saidasConfirmadas = new WeakSet<Event>();

/**
 * Proteção de saída das telas de texto versionado (páginas legais, M7.4; caixas de autorização dos proprietários,
 * M7.15): nada é guardado antes de publicar, e por isso sair com o texto mudado pede confirmação. Fechar ou recarregar
 * passa pelo aviso do navegador; os links do painel (<Link>, que trocam de tela sem recarregar) e o Voltar/Avançar do
 * navegador não passam, e por isso são parados aqui antes de o roteador agir. Dois formulários mudados na mesma tela
 * perguntam uma vez só.
 *
 * `alterado`: o texto da tela é diferente do publicado. Devolve `rearmar`, para chamar a cada edição: depois de Diego
 * confirmar a saída, a pergunta não se repete no caminho; se a tela ficou e ele voltou a editar, a proteção volta.
 */
export function useSairSemPublicar(alterado: boolean): () => void {
  // Diego já confirmou sair sem publicar (não pergunta de novo no caminho).
  const saidaConfirmada = useRef(false);
  useEffect(() => {
    if (!alterado) return;
    saidaConfirmada.current = false;
    // Esta tela no histórico, para voltar a ela se Diego desistir de sair pelo Voltar do navegador.
    const aqui = { url: window.location.href, estado: window.history.state as unknown };
    const confirmar = (e: Event) => {
      if (saidaConfirmada.current) return true;
      saidaConfirmada.current = saidasConfirmadas.has(e) || window.confirm(PERGUNTA_SAIR_SEM_PUBLICAR);
      if (saidaConfirmada.current) saidasConfirmadas.add(e);
      return saidaConfirmada.current;
    };
    const avisar = (e: BeforeUnloadEvent) => {
      if (saidaConfirmada.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    // Na captura do documento: roda antes do <Link> (que ouve na raiz do React) e, se Diego desistir, ele nem fica sabendo.
    const clicar = (e: MouseEvent) => {
      if (!cliqueQueSai(e) || confirmar(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Na captura da janela: roda antes do roteador do Next. Desistiu? A tela volta para o histórico, como se não tivesse saído.
    const voltar = (e: PopStateEvent) => {
      if (mesmaPagina(new URL(window.location.href), new URL(aqui.url)) || confirmar(e)) return;
      e.stopImmediatePropagation();
      window.history.pushState(aqui.estado, "", aqui.url);
    };
    window.addEventListener("beforeunload", avisar);
    document.addEventListener("click", clicar, true);
    window.addEventListener("popstate", voltar, true);
    return () => {
      window.removeEventListener("beforeunload", avisar);
      document.removeEventListener("click", clicar, true);
      window.removeEventListener("popstate", voltar, true);
    };
  }, [alterado]);
  return useCallback(() => {
    saidaConfirmada.current = false;
  }, []);
}
