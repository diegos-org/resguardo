import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormRegras } from "@/components/configuracoes/FormRegras";
import { salvarRegrasAcao } from "@/configuracoes/acoes";
import { lerRegrasFinanceiras, lerVersoesRegras } from "@/configuracoes/regras-financeiras";
import { getDb } from "@/db/client";
import { NOMES_ORIGEM } from "@/reservas/regras";

export default async function Regras() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const [regras, versoes] = await Promise.all([lerRegrasFinanceiras(getDb(), sessao.organizacaoId), lerVersoesRegras(getDb(), sessao.organizacaoId)]);
  return (
    <>
      <ul style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, paddingLeft: 18, maxWidth: 820 }}>
        <li>
          Ao salvar, a regra nova vale para reservas com entrada de hoje em diante, que são recalculadas. Reservas mais antigas continuam
          com a regra da época, mesmo se forem sincronizadas de novo.
        </li>
        <li>
          {versoes.length
            ? `Regra atual em vigor desde ${versoes.at(-1)!.desde.split("-").reverse().join("/")}${versoes.length > 1 ? ` (${versoes.length} versões no total)` : ""}.`
            : "Ainda não houve mudança: vale a regra inicial."}
        </li>
        <li>
          O percentual de comissão fica no contrato de cada imóvel; a escolha de quem recebe pode ser diferente por imóvel (na página do
          imóvel) e por reserva.
        </li>
        <li>Estadia entre meses: valor total (com limpeza) dividido igualmente por noite. Repasse e relatório: dia 1º do mês seguinte.</li>
      </ul>
      <FormRegras regras={regras} origens={NOMES_ORIGEM} salvar={salvarRegrasAcao} />
      <p style={{ fontSize: "0.875rem", margin: 0 }}>
        <Link href="/painel/sistema">Ver as regras em vigor em cada imóvel →</Link>
      </p>
    </>
  );
}
