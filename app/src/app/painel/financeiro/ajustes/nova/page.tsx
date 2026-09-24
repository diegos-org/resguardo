import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { salvarAjusteAcao } from "@/ajustes/acoes";
import { DIRECOES, NOMES_ORIGEM_AJUSTE } from "@/ajustes/ajustes";
import { FormAjuste } from "@/components/ajustes/FormAjuste";
import { getDb } from "@/db/client";
import { listarImoveis } from "@/imoveis/repositorio";
import { hojeISO } from "@/lib/datas";

export default async function NovoAjuste() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "financeiro:editar")) redirect("/painel/financeiro/ajustes");
  const imoveis = await listarImoveis(getDb(), sessao.organizacaoId);
  return (
    <>
      <h1>Registrar ajuste</h1>
      <FormAjuste
        salvar={salvarAjusteAcao}
        imoveis={imoveis.map((i) => ({ id: i.id, codigo: i.codigo, nome: i.nome }))}
        origens={NOMES_ORIGEM_AJUSTE}
        direcoes={Object.fromEntries(Object.entries(DIRECOES).map(([k, d]) => [k, d.texto]))}
        inicial={{ data: hojeISO() }}
      />
    </>
  );
}
