import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormInicioDoSistema } from "@/components/configuracoes/FormInicioDoSistema";
import { FormRegrasRepasses } from "@/components/configuracoes/FormRegrasRepasses";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { salvarInicioDoSistemaAcao, salvarRegrasRepassesAcao } from "@/repasses/acoes";
import { lerInicioDoSistema, lerRegrasRepasses } from "@/repasses/regras-config";

export default async function RegrasRepasses() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const db = getDb();
  const regras = await lerRegrasRepasses(db, sessao.organizacaoId);
  const inicio = await lerInicioDoSistema(db, sessao.organizacaoId);
  return (
    <>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
        Repasses por periodicidade (M4.10): a parte do proprietário em cada reserva fica <strong>disponível</strong> depois do check-in e com o dinheiro registrado na empresa; o repasse
        reúne o que está disponível na data dele. Os repasses em si ficam em <Link href="/painel/financeiro/repasses">Financeiro → Repasses</Link>; aqui ficam só as regras.
      </p>
      <FormRegrasRepasses regras={regras} salvar={salvarRegrasRepassesAcao} />
      <FormInicioDoSistema inicio={inicio} hoje={hojeISO()} salvar={salvarInicioDoSistemaAcao} />
    </>
  );
}
