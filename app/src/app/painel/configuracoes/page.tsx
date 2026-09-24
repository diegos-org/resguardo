import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { ABAS_CONFIG } from "@/configuracoes/abas";

export default async function Configuracoes() {
  const sessao = await exigirSessaoPainel();
  const primeira = ABAS_CONFIG.find((a) => podeFazer(sessao.papel, a.exige));
  redirect(primeira ? `/painel/configuracoes/${primeira.slug}` : "/painel");
}
