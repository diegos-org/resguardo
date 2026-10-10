import Link from "next/link";
import type { ImovelPublico } from "@/site/site";
import { CapaDoImovel } from "./CapaDoImovel";
import { comodidadesDoCartao, IconeComodidade } from "./IconeComodidade";
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

/** Selo sobre a foto (M7.6): o tipo pelo número de quartos (0 = studio) e o bairro; só o que o cadastro diz. */
export function seloDoImovel(i: Pick<ImovelPublico, "quartos" | "bairro" | "cidade">): string {
  const tipo = i.quartos === 0 ? "Studio" : i.quartos ? `${i.quartos} ${i.quartos === 1 ? "quarto" : "quartos"}` : null;
  return [tipo, i.bairro || i.cidade].filter(Boolean).join(" · ");
}

/** Cartão sálvia do apartamento (vitrine da página inicial e catálogo), como no estudo: foto com selo, ícones e capacidade. */
export function CartaoImovel({ imovel, carregarCedo = false }: { imovel: ImovelPublico; carregarCedo?: boolean }) {
  const selo = seloDoImovel(imovel);
  const icones = comodidadesDoCartao(imovel.comodidades);
  return (
    <Link href={`/imoveis/${encodeURIComponent(imovel.codigo)}`} className={styles.cartaoCasa}>
      <div className={styles.cartaoFoto}>
        <CapaDoImovel nome={imovel.nome} fotos={imovel.fotos} sizes="(max-width: 600px) 100vw, 360px" carregarCedo={carregarCedo} />
        {selo && imovel.fotos.length > 0 && <span className={styles.selo}>{selo}</span>}
      </div>
      <div className={styles.cartaoCorpo}>
        <p className={styles.olho}>{olhoImovel(imovel)}</p>
        <h3>
          {imovel.nome}
          <span aria-hidden="true">↗</span>
        </h3>
        <div className={styles.cartaoMeio}>
          <p>{fraseDoImovel(imovel)}</p>
          {icones.length > 0 && (
            <div className={styles.icones}>
              {icones.map((c) => (
                <IconeComodidade key={c} nome={c} />
              ))}
            </div>
          )}
        </div>
        <div className={styles.cartaoRodape}>
          <span>{imovel.capacidade ? `Até ${imovel.capacidade} ${imovel.capacidade === 1 ? "hóspede" : "hóspedes"}` : resumoImovel(imovel)}</span>
          <span>Conheça a casa →</span>
        </div>
      </div>
    </Link>
  );
}
