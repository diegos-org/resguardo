import { type Acao, podeFazer } from "@/acesso/politica";
import type { Papel } from "@/db/schema";

/**
 * Seções do painel interno. `marco` indica em que item do ROADMAP a seção ganha conteúdo;
 * `exige` é a permissão para ver a seção (o menu só mostra o que o papel pode abrir).
 */
export type Secao = {
  slug: string;
  titulo: string;
  marco: string;
  descricao: string;
  exige: Acao;
  /** Só para a equipe interna (mostra dados de todos os proprietários): nunca para proprietário. */
  interno?: boolean;
};

export const SECOES: readonly Secao[] = [
  { slug: "calendario", titulo: "Calendário", marco: "M3.4", descricao: "Ocupação de todas as unidades, reservas, bloqueios, limpezas e manutenção." , exige: "calendario:ler" },
  { slug: "reservas", titulo: "Reservas", marco: "M3.5", descricao: "Lista de reservas de todos os canais, com filtros e detalhe." , exige: "reserva:ler" },
  { slug: "imoveis", titulo: "Imóveis", marco: "M2.1", descricao: "Cadastro dos imóveis, dados públicos e mapeamento com os canais." , exige: "imovel:ler" },
  { slug: "proprietarios", titulo: "Proprietários", marco: "M2.2", descricao: "Proprietários, representantes, contratos e convites para o portal." , exige: "proprietario:ler" },
  { slug: "financeiro", titulo: "Financeiro", marco: "M4.6", descricao: "Dashboard da empresa, comissões, repasses e conciliação." , exige: "financeiro:ler" },
  { slug: "apartamentos", titulo: "Apartamentos", marco: "M4.7", descricao: "Resultado por imóvel: comissões, despesas e acertos com o proprietário." , exige: "financeiro:ler", interno: true },
  { slug: "despesas", titulo: "Despesas", marco: "M4.3", descricao: "Despesas da empresa e dos proprietários, com categorias editáveis." , exige: "financeiro:ler" },
  { slug: "limpezas", titulo: "Limpezas", marco: "M6.1", descricao: "Faxinas por checkout: pedida, confirmada e realizada." , exige: "limpeza:ler" },
  { slug: "agenda", titulo: "Agenda", marco: "M6.3", descricao: "Agenda diária da equipe: entradas, saídas e limpezas dos próximos 5 dias, por cidade." , exige: "limpeza:ler", interno: true },
  { slug: "manutencao", titulo: "Manutenção", marco: "M6.2", descricao: "Pedidos, orçamentos, aprovação e custos de manutenção." , exige: "manutencao:ler" },
  { slug: "mensagens", titulo: "Mensagens", marco: "M10.1", descricao: "Caixa de entrada do WhatsApp e mensagens programadas." , exige: "mensagem:ler" },
  { slug: "sistema", titulo: "Sistema", marco: "M1.6", descricao: "Serviços ligados, automações e regras em vigor." , exige: "configuracao:editar" },
  { slug: "configuracoes", titulo: "Configurações", marco: "M1.7", descricao: "Empresa, usuários, regras financeiras, integrações, categorias, modelos de mensagem e textos do site." , exige: "configuracao:editar" },
];

/** Só as seções que este papel pode abrir. */
export function secoesPara(papel: Papel): Secao[] {
  return SECOES.filter((s) => podeFazer(papel, s.exige) && !(s.interno && papel === "proprietario"));
}

export function encontrarSecao(slug: string): Secao | undefined {
  return SECOES.find((s) => s.slug === slug);
}
