import { notFound } from "next/navigation";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";

/**
 * Qualquer outro endereço dentro do painel (M7.8), como `/painel/reservas/x/y`: a página não encontrada do painel,
 * dentro da moldura dele e só para quem entrou (sem sessão, vai para a entrada, como as outras telas). Sem isto, o Next
 * usaria a do site (a da raiz).
 */
export default async function PainelNaoEncontrado(): Promise<never> {
  await exigirSessaoPainel();
  notFound();
}
