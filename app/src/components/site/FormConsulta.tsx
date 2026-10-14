import type { ConteudoSite, ErrosConsulta, ImovelPublico, PedidoConsulta } from "@/site/site";
import { CampoDatas } from "./CampoDatas";
import styles from "./site.module.css";
import { TrocaDeCasa } from "./TrocaDeCasa";

/**
 * Formulário da consulta (GET para /consulta): nada é gravado; vira uma mensagem para o contato da
 * empresa (WhatsApp ou e-mail).
 * Só apartamento, datas e pessoas vão no endereço da página — nome e mensagem o visitante escreve
 * direto na conversa (dado pessoal não fica no endereço, no histórico nem em registro de acesso).
 * "Seu lugar" é opcional (M7.9): "Todas as casas" (valor vazio) leva à busca com a situação de cada casa.
 */
export type CanalContato = "whatsapp" | "email" | null;
/** Por onde a conversa continua: o que está no cadastro da empresa (WhatsApp antes do e-mail). */
export const canalDeContato = (c: Pick<ConteudoSite, "whatsapp" | "email">): CanalContato => (c.whatsapp ? "whatsapp" : c.email ? "email" : null);

/**
 * Opções de "Hóspedes": de 1 até a maior capacidade dos lugares listados; com alguma capacidade não cadastrada,
 * até 10 (ou a maior conhecida, se passar disso). Um número já pedido acima do limite continua na lista, para a
 * mensagem do servidor ("recebe até N pessoas") fazer sentido.
 */
export function opcoesDeHospedes(imoveis: Pick<ImovelPublico, "capacidade">[], pedido?: string): number[] {
  const capacidades = imoveis.map((i) => i.capacidade ?? 0);
  const todas = imoveis.length > 0 && capacidades.every((c) => c > 0);
  const maximo = todas ? Math.max(...capacidades) : Math.max(10, ...capacidades);
  const opcoes = Array.from({ length: maximo }, (_, i) => i + 1);
  const n = pedido && /^\d{1,2}$/.test(pedido) ? Number(pedido) : 0;
  return n > maximo ? [...opcoes, n] : opcoes;
}

const TEXTO_CANAL: Record<"whatsapp" | "email" | "nenhum", string> = {
  whatsapp: "A conversa continua pelo WhatsApp, onde você pode se apresentar e contar mais.",
  email: "A conversa continua por e-mail, onde você pode se apresentar e contar mais.",
  nenhum: "Confira os dados antes de continuar.",
};

/**
 * `variante`: "busca" é a caixa translúcida sob a capa (campos em linha, sem título); "lateral" é o
 * cartão "Planeje sua estadia" da página do imóvel (o título fica fora do formulário; com outra casa
 * escolhida, o envio abre a página dela com as mesmas datas e pessoas, M7.9); o padrão é o cartão papel
 * com título, usado na página de consulta.
 */
export function FormConsulta({
  imoveis,
  valores,
  erros = {},
  hoje,
  canal,
  variante = "padrao",
  comPagamento = false,
}: {
  imoveis: ImovelPublico[];
  valores: Partial<PedidoConsulta>;
  erros?: ErrosConsulta;
  hoje: string;
  canal: CanalContato;
  variante?: "padrao" | "busca" | "lateral";
  /** O site cobra por Pix (M8.2a): a dica deixa de dizer que nenhum pagamento é feito no site. */
  comPagamento?: boolean;
}) {
  const erro = (k: keyof PedidoConsulta) =>
    erros[k] ? (
      <span className={styles.erro} id={`erro-${k}`}>
        {erros[k]}
      </span>
    ) : null;
  const pessoas = opcoesDeHospedes(imoveis, valores.hospedes);
  const pedidas = /^\d+$/.test(valores.hospedes ?? "") ? Number(valores.hospedes) : 0;
  const pessoasEscolhidas = String(pessoas.includes(pedidas) ? pedidas : Math.min(2, pessoas.length));
  const classe = variante === "busca" ? styles.buscaForm : `${styles.formulario} ${styles.duasColunas}`;
  const dica =
    variante === "busca"
      ? "Escolha as datas e, se quiser, uma casa. A disponibilidade e o valor aparecem antes de qualquer reserva."
      : `${TEXTO_CANAL[canal ?? "nenhum"]} ${comPagamento ? "Nada é cobrado na consulta." : "Nenhum pagamento é feito aqui."}`;
  // Cartão lateral (M7.9): a troca de casa acontece no envio, e o campo anuncia isso (a dica fica ligada a ele).
  const trocaNoEnvio = variante === "lateral" && !!valores.imovel;
  const descricaoLugar = [erros.imovel && "erro-imovel", trocaNoEnvio && "dica-troca-casa"].filter(Boolean).join(" ") || undefined;
  return (
    <form action="/consulta" method="get" className={classe} aria-label="Consultar disponibilidade">
      {variante === "padrao" && <strong>Consultar disponibilidade</strong>}
      <label className={styles.campoLargo}>
        Seu lugar
        <select name="imovel" defaultValue={valores.imovel ?? ""} aria-describedby={descricaoLugar}>
          <option value="">Todas as casas</option>
          {imoveis.map((i) => (
            <option key={i.codigo} value={i.codigo}>
              {i.nome}
            </option>
          ))}
        </select>
        {erro("imovel")}
      </label>
      {trocaNoEnvio && valores.imovel && <TrocaDeCasa atual={valores.imovel} />}
      {/* Datas num calendário próprio (M7.6), com as noites ocupadas do lugar escolhido acima. */}
      <CampoDatas hoje={hoje} entrada={valores.entrada} saida={valores.saida} campoImovel="imovel" erroEntrada={erros.entrada} erroSaida={erros.saida} variante={variante} />
      <label className={variante === "busca" ? undefined : styles.campoLargo}>
        Hóspedes
        <select name="hospedes" defaultValue={pessoasEscolhidas} required aria-describedby={erros.hospedes ? "erro-hospedes" : undefined}>
          {pessoas.map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "pessoa" : "pessoas"}
            </option>
          ))}
        </select>
        {erro("hospedes")}
      </label>
      <button type="submit" className={styles.botao}>
        {variante === "busca" ? "Consultar" : "Continuar"}
        <span aria-hidden="true">↗</span>
      </button>
      <p className={styles.dica}>
        {trocaNoEnvio && <span id="dica-troca-casa">Com outra casa escolhida, Continuar abre a página dela com as mesmas datas. </span>}
        {dica}
      </p>
    </form>
  );
}
