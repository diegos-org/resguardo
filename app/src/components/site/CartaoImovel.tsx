import Link from "next/link";
import type { ImovelPublico } from "@/site/site";
import { CapaDoImovel } from "./CapaDoImovel";
import styles from "./site.module.css";

export function resumoImovel(i: ImovelPublico): string {
  const partes = [
    i.capacidade ? `até ${i.capacidade} ${i.capacidade === 1 ? "pessoa" : "pessoas"}` : null,
    i.quartos === 0 ? "studio" : i.quartos ? `${i.quartos} ${i.quartos === 1 ? "quarto" : "quartos"}` : null,
    i.banheiros ? `${i.banheiros} ${i.banheiros === 1 ? "banheiro" : "banheiros"}` : null,
  ].filter(Boolean);
  return partes.join(" · ");
}

/** Primeira frase da descrição (até 120 caracteres) para o cartão; sem descrição, bairro e cidade. */
export function fraseDoImovel(i: Pick<ImovelPublico, "descricao" | "bairro" | "cidade">): string {
  const frase = i.descricao.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  if (frase) return frase.length > 120 ? `${frase.slice(0, 119).trimEnd()}…` : frase;
  return [i.bairro, i.cidade].filter(Boolean).join(", ");
}

/** "Olho" do cartão: bairro e código do imóvel, em maiúsculas pelo CSS. */
export const olhoImovel = (i: Pick<ImovelPublico, "bairro" | "cidade" | "codigo">) => [i.bairro || i.cidade, i.codigo].filter(Boolean).join(" · ");

/** Cartão sálvia do apartamento (carrossel da página inicial e catálogo). */
export function CartaoImovel({ imovel }: { imovel: ImovelPublico }) {
  const resumo = resumoImovel(imovel);
  return (
    <Link href={`/imoveis/${encodeURIComponent(imovel.codigo)}`} className={styles.cartaoCasa}>
      <div className={styles.cartaoFoto}>
        <CapaDoImovel nome={imovel.nome} fotos={imovel.fotos} sizes="(max-width: 600px) 100vw, 360px" />
      </div>
      <div className={styles.cartaoCorpo}>
        <p className={styles.olho}>{olhoImovel(imovel)}</p>
        <h3>{imovel.nome}</h3>
        <p>{fraseDoImovel(imovel)}</p>
        <div className={styles.cartaoRodape}>
          <span>{resumo}</span>
          <span>Conheça a casa →</span>
        </div>
      </div>
    </Link>
  );
}
