import { type Filtros, IMOVEIS_PROVISORIOS, nomeDoMes, type OpcaoImovel } from "@/lib/filtros";
import styles from "./painel.module.css";

type Props = {
  filtros: Filtros;
  /** Caminho da página atual; o formulário envia os filtros para ela mesma. */
  acao: string;
  opcoes?: readonly OpcaoImovel[];
  /** Parâmetros locais da página que continuam valendo ao mudar o filtro (ex.: colunas). */
  manter?: readonly [string, string][];
};

/**
 * Filtro global de imóveis e período. Funciona como formulário GET (sem JavaScript):
 * o resultado fica na URL e qualquer página do painel pode lê-lo com `lerFiltros`.
 */
export function FiltroGlobal({ filtros, acao, opcoes = IMOVEIS_PROVISORIOS, manter = [] }: Props) {
  const todos = filtros.imoveis.length === 0;
  const anos = Array.from({ length: 5 }, (_, i) => filtros.ano - 2 + i);
  return (
    <form method="get" action={acao} className={styles.filtro} aria-label="Filtro global">
      <fieldset className={styles.imoveis}>
        <legend>Imóveis</legend>
        {opcoes.length === 0 && <span>Nenhum imóvel cadastrado ainda.</span>}
        {opcoes.map((o) => (
          <label key={o.codigo}>
            <input type="checkbox" name="imovel" value={o.codigo} defaultChecked={todos || filtros.imoveis.includes(o.codigo)} />
            {o.nome}
          </label>
        ))}
      </fieldset>
      <label>
        Mês
        <select name="mes" defaultValue={filtros.mes === null ? "todos" : String(filtros.mes)}>
          <option value="todos">Ano inteiro</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {nomeDoMes(i + 1)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Ano
        <select name="ano" defaultValue={String(filtros.ano)}>
          {anos.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      {manter.map(([nome, valor], i) => (
        <input key={`${nome}-${i}`} type="hidden" name={nome} value={valor} />
      ))}
      <button type="submit">Aplicar</button>
    </form>
  );
}
