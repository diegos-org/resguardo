import type { Acao } from "@/acesso/politica";

/** Sub-abas de Configurações (M1.7). Cada aba só aparece para quem pode editá-la. */
export const ABAS_CONFIG: readonly { slug: string; titulo: string; exige: Acao }[] = [
  { slug: "empresa", titulo: "Empresa", exige: "configuracao:editar" },
  { slug: "usuarios", titulo: "Usuários e permissões", exige: "usuario:gerenciar" },
  { slug: "regras", titulo: "Regras financeiras", exige: "configuracao:editar" },
  { slug: "integracoes", titulo: "Integrações", exige: "configuracao:editar" },
  { slug: "calendario", titulo: "Calendário e preços", exige: "configuracao:editar" },
  { slug: "marketplace", titulo: "Marketplace e desconto do site", exige: "configuracao:editar" },
  // Regras de venda do pagamento no site (M8.2a). A aba aparece para quem edita o financeiro (o proprietário, que lê o
  // financeiro dos seus imóveis, nunca vê Configurações); a página também abre só para leitura com financeiro:ler.
  { slug: "pagamento-site", titulo: "Pagamento no site", exige: "financeiro:editar" },
  { slug: "repasses", titulo: "Repasses", exige: "configuracao:editar" },
  { slug: "categorias", titulo: "Categorias de despesa", exige: "despesa:editar" },
  { slug: "mensagens", titulo: "Modelos de mensagem", exige: "configuracao:editar" },
  { slug: "site", titulo: "Textos do site", exige: "configuracao:editar" },
  // Termos de uso, Política de privacidade e Política de cancelamento do site (M7.4), versionados.
  { slug: "paginas-legais", titulo: "Páginas legais do site", exige: "configuracao:editar" },
  { slug: "pagina-proprietarios", titulo: "Página para proprietários", exige: "configuracao:editar" },
  // Texto das caixas de autorização dos dois formulários de "Anuncie seu imóvel" (M7.15), versionado como as páginas legais.
  { slug: "autorizacao-proprietarios", titulo: "Autorização dos proprietários", exige: "configuracao:editar" },
  { slug: "como-funciona", titulo: "Como funciona (proprietário)", exige: "configuracao:editar" },
];
