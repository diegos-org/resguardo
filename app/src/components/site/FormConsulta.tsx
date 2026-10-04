import type { ConteudoSite, ErrosConsulta, ImovelPublico, PedidoConsulta } from "@/site/site";
import styles from "./site.module.css";

/**
 * Formulário da consulta (GET para /consulta): nada é gravado; vira uma mensagem para o contato da
 * empresa (WhatsApp ou e-mail).
 * Só apartamento, datas e pessoas vão no endereço da página — nome e mensagem o visitante escreve
 * direto na conversa (dado pessoal não fica no endereço, no histórico nem em registro de acesso).
 */
export type CanalContato = "whatsapp" | "email" | null;
/** Por onde a conversa continua: o que está no cadastro da empresa (WhatsApp antes do e-mail). */
export const canalDeContato = (c: Pick<ConteudoSite, "whatsapp" | "email">): CanalContato => (c.whatsapp ? "whatsapp" : c.email ? "email" : null);

const TEXTO_CANAL: Record<"whatsapp" | "email" | "nenhum", string> = {
  whatsapp: "A conversa continua pelo WhatsApp, onde você pode se apresentar e contar mais.",
  email: "A conversa continua por e-mail, onde você pode se apresentar e contar mais.",
  nenhum: "Confira os dados antes de continuar.",
};

/**
 * `variante`: "busca" é a caixa translúcida sob a capa (campos em linha, sem título); "lateral" é o
 * cartão "Planeje sua estadia" da página do imóvel (o título fica fora do formulário); o padrão é o
 * cartão papel com título, usado na página de consulta.
 */
export function FormConsulta({
  imoveis,
  valores,
  erros = {},
  hoje,
  canal,
  variante = "padrao",
}: {
  imoveis: ImovelPublico[];
  valores: Partial<PedidoConsulta>;
  erros?: ErrosConsulta;
  hoje: string;
  canal: CanalContato;
  variante?: "padrao" | "busca" | "lateral";
}) {
  const erro = (k: keyof PedidoConsulta) =>
    erros[k] ? (
      <span className={styles.erro} id={`erro-${k}`}>
        {erros[k]}
      </span>
    ) : null;
  const classe = variante === "busca" ? styles.buscaForm : `${styles.formulario} ${styles.duasColunas}`;
  const dica = variante === "busca" ? "Escolha o lugar e as datas. A disponibilidade e o valor aparecem na próxima tela, antes de qualquer reserva." : `${TEXTO_CANAL[canal ?? "nenhum"]} Nenhum pagamento é feito aqui.`;
  return (
    <form action="/consulta" method="get" className={classe} aria-label="Consultar disponibilidade">
      {variante === "padrao" && <strong>Consultar disponibilidade</strong>}
      <label className={styles.campoLargo}>
        Seu lugar
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
      <label className={variante === "busca" ? undefined : styles.campoLargo}>
        Hóspedes
        <input type="number" name="hospedes" min={1} max={imoveis.length && imoveis.every((i) => i.capacidade) ? Math.max(...imoveis.map((i) => i.capacidade ?? 0)) : undefined} defaultValue={valores.hospedes || "2"} required />
        {erro("hospedes")}
      </label>
      <button type="submit" className={styles.botao}>
        {variante === "busca" ? "Consultar" : "Continuar"}
        <span aria-hidden="true">↗</span>
      </button>
      <p className={styles.dica}>{dica}</p>
    </form>
  );
}
