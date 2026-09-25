import type { ErrosConsulta, ImovelPublico, PedidoConsulta } from "@/site/site";
import styles from "./site.module.css";

/**
 * Formulário da consulta (GET para /consulta): nada é gravado; vira uma mensagem de WhatsApp.
 * Só apartamento, datas e pessoas vão no endereço da página — nome e mensagem o visitante escreve
 * direto no WhatsApp (dado pessoal não fica no endereço, no histórico nem em registro de acesso).
 */
export function FormConsulta({ imoveis, valores, erros = {}, hoje }: { imoveis: ImovelPublico[]; valores: Partial<PedidoConsulta>; erros?: ErrosConsulta; hoje: string }) {
  const erro = (k: keyof PedidoConsulta) =>
    erros[k] ? (
      <span className={styles.erro} id={`erro-${k}`}>
        {erros[k]}
      </span>
    ) : null;
  return (
    <form action="/consulta" method="get" className={styles.formulario}>
      <strong>Consultar disponibilidade</strong>
      <label>
        Apartamento
        <select name="imovel" defaultValue={valores.imovel ?? ""} required aria-describedby={erros.imovel ? "erro-imovel" : undefined}>
          <option value="" disabled>
            Escolha
          </option>
          {imoveis.map((i) => (
            <option key={i.codigo} value={i.codigo}>
              {i.nome}
            </option>
          ))}
        </select>
        {erro("imovel")}
      </label>
      <div className={styles.linha}>
        <label>
          Entrada
          <input type="date" name="entrada" min={hoje} defaultValue={valores.entrada ?? ""} required />
          {erro("entrada")}
        </label>
        <label>
          Saída
          <input type="date" name="saida" min={hoje} defaultValue={valores.saida ?? ""} required />
          {erro("saida")}
        </label>
      </div>
      <label>
        Pessoas
        <input type="number" name="hospedes" min={1} max={Math.max(1, ...imoveis.map((i) => i.capacidade ?? 1))} defaultValue={valores.hospedes ?? "2"} required />
        {erro("hospedes")}
      </label>
      <button type="submit" className={styles.botao}>
        Continuar
      </button>
      <span className={styles.miudo}>A conversa continua no WhatsApp da Sua Casa Leblon, onde você pode se apresentar e contar mais. Nenhum pagamento é feito aqui.</span>
    </form>
  );
}
