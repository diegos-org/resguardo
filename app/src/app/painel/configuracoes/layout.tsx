import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { Abas } from "@/components/configuracoes/Abas";
import { ABAS_CONFIG } from "@/configuracoes/abas";

export default async function LayoutConfiguracoes({ children }: LayoutProps<"/painel/configuracoes">) {
  const sessao = await exigirSessaoPainel();
  const abas = ABAS_CONFIG.filter((a) => podeFazer(sessao.papel, a.exige));
  if (!abas.length) redirect("/painel");
  return (
    <>
      <h1>Configurações</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Tudo o que pode mudar sem mexer em código. Cada alteração fica no histórico, com quem fez e quando.
      </p>
      <Abas abas={abas.map(({ slug, titulo }) => ({ slug, titulo }))} />
      {children}
    </>
  );
}
