import Image from "next/image";
import type { FotoPublica } from "@/imoveis/fotos-regras";
import { FotoProvisoria } from "./Moldura";
import styles from "./site.module.css";

/** Capa do imóvel no cartão (M7.3): a primeira foto real, na versão pequena; sem foto, o quadro "foto em breve". */
export function CapaDoImovel({ nome, fotos, sizes, carregarCedo = false }: { nome: string; fotos: readonly FotoPublica[]; sizes: string; carregarCedo?: boolean }) {
  const capa = fotos[0];
  if (!capa) return <FotoProvisoria titulo={nome} />;
  return <Image src={capa.pequena} alt={capa.legenda || `Foto de ${nome}`} fill sizes={sizes} unoptimized loading={carregarCedo ? "eager" : "lazy"} className={styles.fotoReal} />;
}
