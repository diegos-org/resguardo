import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { Modelos } from "@/components/configuracoes/Modelos";
import { editarModeloAcao, novoModeloAcao } from "@/configuracoes/acoes";
import { garantirModelosIniciais, listarModelos } from "@/configuracoes/modelos";
import { getDb } from "@/db/client";

export default async function Mensagens() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const db = getDb();
  await garantirModelosIniciais(db, sessao.organizacaoId);
  const lista = await listarModelos(db, sessao.organizacaoId);
  return <Modelos lista={lista.map(({ id, nome, quando, texto, ativo }) => ({ id, nome, quando, texto, ativo }))} criar={novoModeloAcao} editar={editarModeloAcao} />;
}
