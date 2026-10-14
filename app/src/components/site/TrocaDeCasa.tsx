"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { linkDaCasa } from "@/site/link-da-casa";

/**
 * Cartão "Planeje sua estadia" da página de uma casa (M7.9, como no estudo): com outra casa escolhida em "Seu lugar",
 * o envio ("Continuar") abre a página da outra casa com as datas e as pessoas já escolhidas.
 *
 * A troca acontece no envio, nunca ao mudar o campo: no Windows, as setas do teclado num campo de escolha fechado mudam o
 * valor a cada tecla, e abrir outra página nessa hora levaria quem usa o teclado para a casa seguinte já na primeira seta
 * (regra de acessibilidade: mudar um campo não muda de página sozinho). "Todas as casas" e a própria casa seguem o envio
 * normal (a busca e a consulta). Envio já barrado por outro campo (sem as datas, o calendário abre em vez de enviar) não
 * troca de casa: por isso a escuta fica no documento, depois das do próprio formulário. Sem JavaScript, nada muda: o
 * formulário continua indo para a consulta.
 */
export function TrocaDeCasa({ campo = "imovel", atual }: { campo?: string; atual: string }) {
  const marca = useRef<HTMLSpanElement>(null);
  const router = useRouter();
  useEffect(() => {
    const form = marca.current?.closest("form");
    const seletor = form?.elements.namedItem(campo);
    if (!form || !(seletor instanceof HTMLSelectElement)) return;
    const valor = (nome: string) => {
      const el = form.elements.namedItem(nome);
      return el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.value : "";
    };
    const aoEnviar = (e: SubmitEvent) => {
      if (e.target !== form || e.defaultPrevented || seletor.value === atual) return;
      const destino = linkDaCasa(seletor.value, { entrada: valor("entrada"), saida: valor("saida"), hospedes: valor("hospedes") });
      if (!destino) return;
      e.preventDefault();
      router.push(destino);
    };
    const documento = form.ownerDocument;
    documento.addEventListener("submit", aoEnviar);
    return () => documento.removeEventListener("submit", aoEnviar);
  }, [campo, atual, router]);
  return <span ref={marca} hidden />;
}
