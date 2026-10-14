import { metadadosDaNaoEncontrada, PaginaNaoEncontrada } from "@/components/site/NaoEncontrada";

/** Link de uma casa que não existe ou saiu do site (M7.8): "Casa não encontrada", como no estudo aprovado. */
export const generateMetadata = () => metadadosDaNaoEncontrada("casa");

export default async function CasaNaoEncontrada() {
  return PaginaNaoEncontrada({ tipo: "casa" });
}
