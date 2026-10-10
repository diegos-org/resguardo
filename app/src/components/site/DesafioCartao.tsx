"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { DOMINIOS_DESAFIO } from "@/pagamentos/provedor";
import styles from "./site.module.css";

/** A mensagem veio de uma página do Mercado Pago (https, domínio da lista do desafio)? */
export function origemDoDesafio(origem: string): boolean {
  try {
    const u = new URL(origem);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && DOMINIOS_DESAFIO.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

type Props = {
  codigo: string;
  /** Endereço do desafio (já conferido no servidor); null = o Mercado Pago não mandou um endereço que sirva. */
  desafioUrl: string | null;
  /** "Pagar com Pix" (cancela o desafio no Mercado Pago antes de gerar o Pix). */
  aoPagarComPix?: () => void;
  /** "Usar outro cartão" (o desafio é cancelado antes do novo cartão). */
  aoUsarOutroCartao?: () => void;
};

/**
 * Verificação do banco (3DS, M8.2b): a página do banco num quadro (só de domínio do Mercado Pago; a política de frames
 * da página também só deixa esses). Quando o quadro avisa que terminou, a página confere na hora pela rota (que lê o
 * Mercado Pago): o aviso do navegador nunca decide nada, e a página continua acompanhando de qualquer jeito. Ao lado,
 * os outros caminhos: Pix ou outro cartão.
 */
export function DesafioCartao({ codigo, desafioUrl, aoPagarComPix, aoUsarOutroCartao }: Props) {
  const router = useRouter();
  useEffect(() => {
    if (!desafioUrl) return;
    let conferindo = false;
    const aoReceber = (e: MessageEvent) => {
      if (!origemDoDesafio(e.origin)) return;
      const dados = e.data as { status?: unknown } | null;
      if (!dados || typeof dados !== "object" || dados.status !== "COMPLETE" || conferindo) return;
      conferindo = true;
      fetch(`/reservar/${encodeURIComponent(codigo)}/pagamento`, { cache: "no-store", headers: { accept: "application/json" } })
        .then(async (r) => {
          if (!r.ok) return;
          const j = (await r.json()) as { estado?: string };
          if (j.estado && j.estado !== "cartao_desafio") router.refresh();
        })
        .catch(() => {
          // Sem rede: o acompanhamento da página tenta de novo.
        })
        .finally(() => {
          conferindo = false;
        });
    };
    window.addEventListener("message", aoReceber);
    return () => window.removeEventListener("message", aoReceber);
  }, [codigo, desafioUrl, router]);

  return (
    <div className={styles.cartaoPagamento}>
      {desafioUrl ? (
        <>
          <p className={styles.texto}>Seu banco pediu uma verificação para aprovar o pagamento. Conclua abaixo: a página atualiza sozinha.</p>
          <iframe src={desafioUrl} title="Verificação do seu banco" referrerPolicy="no-referrer" className={styles.desafioCartao} />
        </>
      ) : (
        <p className={styles.aviso}>Não deu para abrir a verificação do banco. Tente com outro cartão ou pague com Pix.</p>
      )}
      {(aoPagarComPix || aoUsarOutroCartao) && (
        <div className={styles.cartaoOpcoes}>
          {aoPagarComPix && (
            <button type="button" className={`${styles.botao} ${styles.botaoContorno}`} onClick={aoPagarComPix}>
              Pagar com Pix
            </button>
          )}
          {aoUsarOutroCartao && (
            <button type="button" className={`${styles.botao} ${styles.botaoContorno}`} onClick={aoUsarOutroCartao}>
              Usar outro cartão
            </button>
          )}
        </div>
      )}
    </div>
  );
}
