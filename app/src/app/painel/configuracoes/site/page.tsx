import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormCampos } from "@/components/configuracoes/FormCampos";
import { salvarTextosAcao } from "@/configuracoes/acoes";
import { CAMPOS_TEXTOS_SITE, lerTextosSite } from "@/configuracoes/textos-site";
import { getDb } from "@/db/client";

export default async function TextosSite() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const textos = await lerTextosSite(getDb(), sessao.organizacaoId);
  return (
    <>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
        Os textos do site público (página inicial, consulta e rodapé). O que aparece de cada apartamento vem do cadastro do imóvel
        (marcado como público); o WhatsApp da consulta é o telefone em Empresa.
      </p>
      <FormCampos
        titulo="Textos do site"
        campos={CAMPOS_TEXTOS_SITE.map((c) => ({ nome: c.chave, rotulo: c.rotulo, limite: c.limite, linhas: c.linhas, obrigatorio: c.chave === "titulo" }))}
        valores={textos}
        salvar={salvarTextosAcao}
      />
    </>
  );
}
