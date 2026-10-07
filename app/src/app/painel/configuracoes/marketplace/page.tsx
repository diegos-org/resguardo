import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormPrecosMarketplace } from "@/components/configuracoes/FormPrecosMarketplace";
import { getDb } from "@/db/client";
import { salvarPrecosMarketplaceAcao, usarPesosPadraoAcao } from "@/marketplace/acoes-precos";
import { lerPrecosMarketplace, pesosNoPadraoAntigo } from "@/marketplace/precos-config";
import styles from "@/components/formularios.module.css";

export default async function MarketplacePrecos() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const [precos, antigo] = await Promise.all([lerPrecosMarketplace(getDb(), sessao.organizacaoId), pesosNoPadraoAntigo(getDb(), sessao.organizacaoId)]);
  return <>
    <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
      Modelo B: a margem entre a taxa da OTA e a taxa do pagamento é dividida entre hóspede, proprietário e SCL pelos pesos abaixo. A parte do hóspede é o <strong>desconto único do site</strong>, aplicado na <Link href="/consulta">consulta</Link> e na cotação para qualquer imóvel e qualquer contrato; o valor cheio e o desconto aparecem para o visitante. A divisão entre proprietário e SCL no financeiro (contrato de marketplace) é o próximo passo (M12.2).
    </p>
    {antigo && (
      <form action={usarPesosPadraoAcao} className={styles.alerta} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", maxWidth: 820 }} aria-label="Pesos no padrão antigo">
        <span>Os pesos gravados aqui são o padrão antigo (1/1/1, partes iguais). O padrão decidido em 7/10 é hóspede 1, proprietário 1 e SCL 2 (3% / 3% / 6%). Nada muda sozinho.</span>
        <button type="submit">Usar o padrão novo</button>
      </form>
    )}
    <FormPrecosMarketplace precos={precos} salvar={salvarPrecosMarketplaceAcao} />
  </>;
}
