import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormCampos } from "@/components/configuracoes/FormCampos";
import { salvarEmpresaAcao } from "@/configuracoes/acoes";
import { lerEmpresa } from "@/configuracoes/empresa";
import { getDb } from "@/db/client";

const CAMPOS = [
  { nome: "nome", rotulo: "Nome da empresa (aparece no painel, no portal do proprietário e nos e-mails de convite e de código)", limite: 80, obrigatorio: true },
  { nome: "razaoSocial", rotulo: "Razão social", limite: 120 },
  { nome: "cnpj", rotulo: "CNPJ", limite: 18 },
  { nome: "email", rotulo: "E-mail de contato", limite: 200, tipo: "email" },
  { nome: "telefone", rotulo: "Telefone / WhatsApp", limite: 30 },
  { nome: "endereco", rotulo: "Endereço", limite: 200 },
  { nome: "site", rotulo: "Site", limite: 200, dica: "Com https:// no começo." },
  { nome: "chavePix", rotulo: "Chave Pix da empresa", limite: 140, dica: "Aparece no portal para o proprietário que deve à empresa, depois do fechamento do mês." },
];

export default async function Empresa() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const empresa = await lerEmpresa(getDb(), sessao.organizacaoId);
  return <FormCampos titulo="Dados da empresa" campos={CAMPOS} valores={empresa} salvar={salvarEmpresaAcao} />;
}
