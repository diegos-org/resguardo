import type { LugarPublico } from "@/site/bairro";

/** "O bairro à sua porta" na ficha do imóvel (M7.6). ESBOÇO: a seção completa vem na parte (c) do M7.6. */
export function BairroAPorta({ lugares }: { lugares: LugarPublico[] }) {
  if (!lugares.length) return null;
  return null;
}
