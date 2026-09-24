import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { ImportarCsv } from "@/components/reservas/ImportarCsv";
import { conferirCsvAcao, importarCsvAcao } from "@/reservas/acoes";

/** Importação de até 500 reservas: tempo extra para a função na Vercel. */
export const maxDuration = 120;

export default async function ImportarReservas() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "reserva:editar") || !podeFazer(sessao.papel, "financeiro:editar")) redirect("/painel/reservas");
  return (
    <>
      <h1>Importar reservas (planilha)</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Enquanto o Beds24 não está ligado, dá para trazer reservas de uma planilha. Primeiro o sistema confere o arquivo e mostra o que vai
        acontecer em cada linha; só depois você importa. Importar o mesmo arquivo de novo não duplica: a reserva é reconhecida pela origem +
        código do canal, e o que mudou é atualizado. O financeiro de cada reserva é calculado na hora; o que faltar para o cálculo (valor, contrato) e reserva que já teve dinheiro movimentado são avisados linha a linha.
      </p>
      <ImportarCsv conferirAcao={conferirCsvAcao} importarAcao={importarCsvAcao} />
      <p>
        <Link href="/painel/reservas">← Voltar para reservas</Link>
      </p>
    </>
  );
}
