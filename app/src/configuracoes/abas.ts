import type { Acao } from "@/acesso/politica";

/** Sub-abas de Configurações (M1.7). Cada aba só aparece para quem pode editá-la. */
export const ABAS_CONFIG: readonly { slug: string; titulo: string; exige: Acao }[] = [
  { slug: "empresa", titulo: "Empresa", exige: "configuracao:editar" },
  { slug: "usuarios", titulo: "Usuários e permissões", exige: "usuario:gerenciar" },
  { slug: "regras", titulo: "Regras financeiras", exige: "configuracao:editar" },
  { slug: "integracoes", titulo: "Integrações", exige: "configuracao:editar" },
  { slug: "calendario", titulo: "Calendário e preços", exige: "configuracao:editar" },
  { slug: "categorias", titulo: "Categorias de despesa", exige: "despesa:editar" },
  { slug: "mensagens", titulo: "Modelos de mensagem", exige: "configuracao:editar" },
  { slug: "site", titulo: "Textos do site", exige: "configuracao:editar" },
];
