import { notFound, redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormImovel } from "@/components/imoveis/FormImovel";
import { getDb } from "@/db/client";
import { salvarImovel } from "@/imoveis/acoes";
import { obterImovel } from "@/imoveis/repositorio";

export default async function EditarImovel({ params }: PageProps<"/painel/imoveis/[id]">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "imovel:editar")) redirect("/painel/imoveis");
  const { id } = await params;
  const imovel = await obterImovel(getDb(), sessao.organizacaoId, id);
  if (!imovel) notFound();
  return (
    <>
      <h1>
        {imovel.codigo} · {imovel.nome}
      </h1>
      <FormImovel acao={salvarImovel} id={imovel.id} inicial={imovel} />
    </>
  );
}
