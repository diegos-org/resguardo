import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormCampos } from "@/components/configuracoes/FormCampos";
import { FormMercado } from "@/components/configuracoes/FormMercado";
import { salvarMercadoAcao, salvarTextosProprietariosAcao } from "@/configuracoes/acoes";
import { CAMPOS_TEXTOS_PROPRIETARIOS, camposDoMercado, lerMercado, lerTextosProprietarios, TEXTOS_PROPRIETARIOS_OBRIGATORIOS } from "@/configuracoes/pagina-proprietarios";
import { getDb } from "@/db/client";

/** Página para proprietários do site (M7.7): textos e faixa de mercado. */
export default async function PaginaProprietarios() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const db = getDb();
  const [textos, mercado] = await Promise.all([lerTextosProprietarios(db, sessao.organizacaoId), lerMercado(db, sessao.organizacaoId)]);
  return (
    <>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
        Os textos da página <Link href="/anunciar">Anuncie seu imóvel</Link> do site. Começam com um texto-base para você revisar antes da entrada no ar. A
        vitrine mostra os imóveis públicos do site; &ldquo;Como funciona&rdquo; mostra a versão publicada em Configurações → Como funciona; os pedidos de
        contato chegam em Proprietários → Pedidos de contato.
      </p>
      <FormCampos
        titulo="Textos da página para proprietários"
        campos={CAMPOS_TEXTOS_PROPRIETARIOS.map((c) => ({ nome: c.chave, rotulo: c.rotulo, limite: c.limite, linhas: c.linhas, obrigatorio: TEXTOS_PROPRIETARIOS_OBRIGATORIOS.includes(c.chave) }))}
        valores={textos}
        salvar={salvarTextosProprietariosAcao}
      />
      <FormMercado valores={camposDoMercado(mercado)} salvar={salvarMercadoAcao} />
    </>
  );
}
