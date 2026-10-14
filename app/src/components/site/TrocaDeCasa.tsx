"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { linkDaCasa } from "@/site/link-da-casa";

/**
 * Cartão "Planeje sua estadia" da página de uma casa (M7.9, como no estudo): trocar a casa em "Seu lugar" abre a página
 * da outra casa com as datas e as pessoas já escolhidas. "Todas as casas" não abre nada (o envio leva à busca). Sem
 * JavaScript, nada muda: o formulário continua indo para a consulta.
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
    const aoTrocar = () => {
      if (seletor.value === atual) return;
      const destino = linkDaCasa(seletor.value, { entrada: valor("entrada"), saida: valor("saida"), hospedes: valor("hospedes") });
      if (destino) router.push(destino);
    };
    seletor.addEventListener("change", aoTrocar);
    return () => seletor.removeEventListener("change", aoTrocar);
  }, [campo, atual, router]);
  return <span ref={marca} hidden />;
}
