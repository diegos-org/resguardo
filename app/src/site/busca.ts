/**
 * Busca em todas as casas (M7.9, pedido de Diego em 14/10): o visitante informa só as datas e as pessoas e vê as casas
 * que recebem o grupo, cada uma com a situação real daquelas datas — a mesma consulta da página da casa (M7.2), nunca
 * "disponível" sem leitura válida. Casa sem capacidade cadastrada entra na lista, mas nunca como "cabe": a consulta dela
 * fica a confirmar, com o aviso. Casa que recebe menos pessoas fica de fora (e é contada, para o aviso da página).
 *
 * Nada é gravado. Custo: as configurações são lidas uma vez e há uma consulta de disponibilidade por casa, até
 * `MAXIMO_CASAS_NA_BUSCA`; as que passarem do limite aparecem sem situação, com o convite para ver as datas na página.
 */
import type { Db } from "@/db/types";
import { consultarDisponibilidade, type Disponibilidade, lerConfigDaConsulta } from "./disponibilidade";
import { conferirDatasEPessoas, type ErrosConsulta, hojeMaisCedo, type ImovelPublico, type PedidoConsulta } from "./site";

/** Teto de consultas de disponibilidade por busca (uma por casa). */
export const MAXIMO_CASAS_NA_BUSCA = 10;
/** Quantas casas são consultadas ao mesmo tempo (o resto espera a vez). */
const CONSULTAS_SIMULTANEAS = 4;

export type CasaNaBusca = {
  imovel: ImovelPublico;
  /** null = além do limite da busca: não consultada, a situação aparece na página da casa. */
  disponibilidade: Disponibilidade | null;
};

export type ResultadoBusca =
  | { ok: false; erros: ErrosConsulta }
  | {
      ok: true;
      hospedes: number;
      /** As casas que recebem o grupo (ou sem capacidade cadastrada), as livres primeiro. */
      casas: CasaNaBusca[];
      /** Casas que recebem menos pessoas que o grupo (ficam de fora da lista). */
      foraDoGrupo: number;
    };

/**
 * Casas para o grupo: as que recebem pelo menos `hospedes` pessoas e as sem capacidade cadastrada (essas nunca como
 * "cabe": a consulta delas fica a confirmar). As que recebem menos ficam de fora.
 */
export function casasParaOGrupo<T extends Pick<ImovelPublico, "capacidade">>(casas: T[], hospedes: number): { cabem: T[]; foraDoGrupo: number } {
  const cabem = casas.filter((c) => !c.capacidade || c.capacidade >= hospedes);
  return { cabem, foraDoGrupo: casas.length - cabem.length };
}

/** Ordem da lista: disponível, a confirmar, indisponível, dados a conferir e, por fim, as não consultadas. */
const ORDEM: Record<Disponibilidade["situacao"] | "nao_consultada", number> = { disponivel: 0, a_confirmar: 1, indisponivel: 2, invalida: 3, nao_consultada: 4 };
const posicao = (c: CasaNaBusca) => ORDEM[c.disponibilidade?.situacao ?? "nao_consultada"];

async function emLotes<T, R>(itens: T[], tamanho: number, f: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(f))));
  return saida;
}

/**
 * Situação de cada casa do site para as datas e as pessoas pedidas. A conferência das datas usa o "hoje" mais cedo entre
 * os fusos das casas (uma entrada válida em alguma delas não é recusada aqui); a consulta de cada casa confere de novo no
 * fuso dela.
 */
export async function buscarEmTodasAsCasas(
  db: Db,
  organizacaoId: string,
  p: Pick<PedidoConsulta, "entrada" | "saida" | "hospedes">,
  casas: ImovelPublico[],
  agora = new Date(),
): Promise<ResultadoBusca> {
  const { erros, hospedes } = conferirDatasEPessoas(p, hojeMaisCedo(casas, agora));
  if (Object.keys(erros).length) return { ok: false, erros };
  const { cabem, foraDoGrupo } = casasParaOGrupo(casas, hospedes);
  if (!cabem.length) return { ok: true, hospedes, casas: [], foraDoGrupo };
  const consultadas = cabem.slice(0, MAXIMO_CASAS_NA_BUSCA);
  const config = await lerConfigDaConsulta(db, organizacaoId);
  const situacoes = await emLotes(consultadas, CONSULTAS_SIMULTANEAS, (imovel) =>
    consultarDisponibilidade(db, organizacaoId, { imovel: imovel.codigo, entrada: p.entrada, saida: p.saida, hospedes: String(hospedes) }, agora, { config }),
  );
  const lista: CasaNaBusca[] = [...consultadas.map((imovel, i) => ({ imovel, disponibilidade: situacoes[i] })), ...cabem.slice(MAXIMO_CASAS_NA_BUSCA).map((imovel) => ({ imovel, disponibilidade: null }))];
  // Ordem estável: dentro de cada situação, a ordem do site (pelo código).
  const ordenada = lista.map((c, i) => ({ c, i })).sort((a, b) => posicao(a.c) - posicao(b.c) || a.i - b.i).map(({ c }) => c);
  return { ok: true, hospedes, casas: ordenada, foraDoGrupo };
}
