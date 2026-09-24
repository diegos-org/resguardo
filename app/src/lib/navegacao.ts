/** Seções do painel interno. `marco` indica em que item do ROADMAP a seção ganha conteúdo. */
export type Secao = {
  slug: string;
  titulo: string;
  marco: string;
  descricao: string;
};

export const SECOES: readonly Secao[] = [
  { slug: "calendario", titulo: "Calendário", marco: "M3.4", descricao: "Ocupação de todas as unidades, reservas, bloqueios, limpezas e manutenção." },
  { slug: "reservas", titulo: "Reservas", marco: "M3.5", descricao: "Lista de reservas de todos os canais, com filtros e detalhe." },
  { slug: "imoveis", titulo: "Imóveis", marco: "M2.1", descricao: "Cadastro dos imóveis, dados públicos e mapeamento com os canais." },
  { slug: "proprietarios", titulo: "Proprietários", marco: "M2.2", descricao: "Proprietários, representantes, contratos e convites para o portal." },
  { slug: "financeiro", titulo: "Financeiro", marco: "M4.6", descricao: "Dashboard da empresa, comissões, repasses e conciliação." },
  { slug: "apartamentos", titulo: "Apartamentos", marco: "M4.7", descricao: "Resultado por imóvel: comissões, despesas e acertos com o proprietário." },
  { slug: "despesas", titulo: "Despesas", marco: "M4.3", descricao: "Despesas da empresa e dos proprietários, com categorias editáveis." },
  { slug: "limpezas", titulo: "Limpezas", marco: "M6.1", descricao: "Faxinas por checkout: pedida, confirmada e realizada." },
  { slug: "manutencao", titulo: "Manutenção", marco: "M6.2", descricao: "Pedidos, orçamentos, aprovação e custos de manutenção." },
  { slug: "mensagens", titulo: "Mensagens", marco: "M10.1", descricao: "Caixa de entrada do WhatsApp e mensagens programadas." },
  { slug: "sistema", titulo: "Sistema", marco: "M1.6", descricao: "Serviços ligados, automações e regras em vigor." },
  { slug: "configuracoes", titulo: "Configurações", marco: "M1.2", descricao: "Usuários, permissões e integrações." },
];

export function encontrarSecao(slug: string): Secao | undefined {
  return SECOES.find((s) => s.slug === slug);
}
