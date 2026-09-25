import Link from "next/link";
import type { ImovelPublico } from "@/site/site";
import { FotoProvisoria } from "./Moldura";
import styles from "./site.module.css";

export function resumoImovel(i: ImovelPublico): string {
  const partes = [
    i.capacidade ? `até ${i.capacidade} ${i.capacidade === 1 ? "pessoa" : "pessoas"}` : null,
    i.quartos === 0 ? "studio" : i.quartos ? `${i.quartos} ${i.quartos === 1 ? "quarto" : "quartos"}` : null,
    i.banheiros ? `${i.banheiros} ${i.banheiros === 1 ? "banheiro" : "banheiros"}` : null,
  ].filter(Boolean);
  return partes.join(" · ");
}

export function CartaoImovel({ imovel }: { imovel: ImovelPublico }) {
  return (
    <Link href={`/imoveis/${encodeURIComponent(imovel.codigo)}`} className={styles.cartao}>
      <FotoProvisoria titulo={imovel.nome} />
      <div className={styles.cartaoCorpo}>
        <h3>{imovel.nome}</h3>
        <span className={styles.miudo}>{[imovel.bairro, imovel.cidade].filter(Boolean).join(", ")}</span>
        {resumoImovel(imovel) && <span className={styles.miudo}>{resumoImovel(imovel)}</span>}
      </div>
    </Link>
  );
}
