import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormImovel } from "@/components/imoveis/FormImovel";
import { salvarImovel } from "@/imoveis/acoes";

export default async function NovoImovel() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "imovel:editar")) redirect("/painel/imoveis");
  return (
    <>
      <h1>Novo imóvel</h1>
      <FormImovel acao={salvarImovel} />
    </>
  );
}
