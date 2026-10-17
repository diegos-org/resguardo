import { Carregando } from "@/components/mensagens/Carregando";

/** Enquanto a caixa de entrada carrega (M10.1a): o esqueleto da lista, sem dado nenhum. */
export default function CarregandoMensagens() {
  return <Carregando texto="Carregando as conversas…" linhas={6} />;
}
