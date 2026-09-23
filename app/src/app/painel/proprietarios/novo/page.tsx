import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormProprietario } from "@/components/proprietarios/FormProprietario";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { salvarProprietario } from "@/proprietarios/acoes";

export default async function NovoProprietario() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "proprietario:editar")) redirect("/painel/proprietarios");
  const imoveis = await listarImoveis(getDb(), sessao.organizacaoId);
  return (
    <>
      <h1>Novo proprietário</h1>
      <FormProprietario acao={salvarProprietario} imoveis={imoveis} />
    </>
  );
}
