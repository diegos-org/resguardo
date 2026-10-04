import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormPrecosMarketplace } from "@/components/configuracoes/FormPrecosMarketplace";
import { getDb } from "@/db/client";
import { salvarPrecosMarketplaceAcao } from "@/marketplace/acoes-precos";
import { lerPrecosMarketplace } from "@/marketplace/precos-config";

export default async function MarketplacePrecos() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const precos = await lerPrecosMarketplace(getDb(), sessao.organizacaoId);
  return <>
    <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
      Modelo B em partes iguais: a margem entre a taxa da OTA e a taxa do pagamento é dividida entre hóspede, proprietário e SCL. A parte do hóspede é o <strong>desconto único do site</strong>, aplicado na <Link href="/consulta">consulta</Link> e na cotação para qualquer imóvel e qualquer contrato; o valor cheio e o desconto aparecem para o visitante. A divisão entre proprietário e SCL no financeiro (contrato de marketplace) é o próximo passo (M12.2).
    </p>
    <FormPrecosMarketplace precos={precos} salvar={salvarPrecosMarketplaceAcao} />
  </>;
}
