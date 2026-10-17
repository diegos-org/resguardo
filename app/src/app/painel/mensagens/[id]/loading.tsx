import { Carregando } from "@/components/mensagens/Carregando";

/** Enquanto a conversa carrega (M10.1a): o esqueleto dos balões, sem dado nenhum. */
export default function CarregandoConversa() {
  return <Carregando texto="Carregando a conversa…" linhas={4} forma="conversa" />;
}
