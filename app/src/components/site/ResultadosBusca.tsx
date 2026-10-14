import { diasEntre } from "@/imoveis/regras-venda";
import type { CasaNaBusca, ResultadoBusca } from "@/site/busca";
import { MOTIVO_SEM_CAPACIDADE } from "@/site/disponibilidade";
import { linkDaCasa } from "@/site/link-da-casa";
import { AVISO_SEM_CONTATO, canalDeContato, type ConteudoSite, type ImovelPublico, linkWhatsapp, mensagemDaBusca, type PedidoConsulta } from "@/site/site";
import { CartaoImovel } from "./CartaoImovel";
import { brl, TITULO_DA_SITUACAO } from "./Disponibilidade";
import { FormConsulta } from "./FormConsulta";
import { TextoComDestaque } from "./Moldura";
import styles from "./site.module.css";

const dataBr = (d: string) => d.split("-").reverse().join("/");
const ETIQUETA: Record<NonNullable<CasaNaBusca["disponibilidade"]>["situacao"], string> = {
  disponivel: styles.etiquetaDisponivel,
  a_confirmar: styles.etiquetaAConfirmar,
  indisponivel: styles.etiquetaIndisponivel,
  invalida: styles.etiquetaInvalida,
};

/**
 * A situação de uma casa no cartão da busca (M7.9): o nome da situação da consulta (M7.2), os motivos em linguagem
 * simples e, quando há valor, o total com o valor cheio e o desconto do site visíveis (regra do M12.1). Casa além do
 * limite da busca: sem situação, com uma etiqueta neutra própria (não foi consultada; não quer dizer que está ocupada) e
 * o convite para ver as datas na página dela. Casa sem capacidade cadastrada: a linha "Capacidade não informada" em
 * qualquer caso, no lugar do motivo da consulta que diz o mesmo (um aviso só por cartão).
 */
function SituacaoNaBusca({ casa }: { casa: CasaNaBusca }) {
  const d = casa.disponibilidade;
  const semCapacidade = !casa.imovel.capacidade && <p>Capacidade não informada: a equipe confirma na conversa se o grupo cabe.</p>;
  if (!d) {
    return (
      <div className={styles.situacaoCasa}>
        <p className={`${styles.etiqueta} ${styles.etiquetaNaoConsultada}`}>Veja as datas na página da casa</p>
        {semCapacidade}
      </div>
    );
  }
  const motivos = d.motivos.filter((m) => m !== MOTIVO_SEM_CAPACIDADE);
  const c = d.cotacao;
  const comValor = (d.situacao === "disponivel" || d.situacao === "a_confirmar") && c;
  return (
    <div className={styles.situacaoCasa}>
      <p className={`${styles.etiqueta} ${ETIQUETA[d.situacao]}`}>{TITULO_DA_SITUACAO[d.situacao]}</p>
      {semCapacidade}
      {motivos.length > 0 && (
        <ul className={styles.motivosCasa}>
          {motivos.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {comValor && (
        <dl className={styles.valoresCasa}>
          {c.desconto > 0 && c.valorCheio !== null && (
            <>
              <dt>Valor cheio</dt>
              <dd>{brl(c.valorCheio)}</dd>
              <dt>Desconto do site</dt>
              <dd>− {brl(c.desconto)}</dd>
            </>
          )}
          <dt>
            Total ({d.noites} {d.noites === 1 ? "noite" : "noites"})
          </dt>
          <dd>
            <strong>{c.total === null ? "a confirmar" : brl(c.total)}</strong>
          </dd>
        </dl>
      )}
    </div>
  );
}

/** Contato para continuar a conversa: o canal de `canalDeContato` (WhatsApp, senão e-mail), como na consulta; sem nenhum, o aviso. */
function Contato({ conteudo, texto }: { conteudo: ConteudoSite; texto: string }) {
  const canal = canalDeContato(conteudo);
  if (canal === "whatsapp")
    return (
      <a href={linkWhatsapp(conteudo.whatsapp!, texto)} className={styles.botao} target="_blank" rel="noopener noreferrer">
        Falar pelo WhatsApp
        <span aria-hidden="true">↗</span>
      </a>
    );
  if (canal === "email")
    return (
      <a href={`mailto:${conteudo.email.trim()}?subject=${encodeURIComponent("Consulta de disponibilidade")}&body=${encodeURIComponent(texto)}`} className={styles.botao}>
        Falar por e-mail
        <span aria-hidden="true">↗</span>
      </a>
    );
  return (
    <p className={styles.aviso} role="note">
      {AVISO_SEM_CONTATO}
    </p>
  );
}

/** Cabeçalho da página "Sua busca" (M7.9): o olho e o título de Configurações → Textos do site (também no site sem casas). */
export function CabecalhoBusca({ textos }: { textos: Pick<ConteudoSite["textos"], "buscaOlho" | "buscaTitulo"> }) {
  return (
    <header className={`${styles.cabecalhoPagina} ${styles.cabecalhoConsulta}`}>
      {textos.buscaOlho && <p className={styles.olho}>{textos.buscaOlho}</p>}
      <h1>
        <TextoComDestaque texto={textos.buscaTitulo || "Encontre seu lugar."} />
      </h1>
    </header>
  );
}

/**
 * Página da busca em todas as casas (M7.9): o olho, o título, o aviso, a frase sem casa para o grupo e a do contato vêm
 * de Configurações → Textos do site; a busca para ajustar e um cartão por casa que recebe o grupo, levando à página dela
 * com as datas e as pessoas. Nada é gravado. Só aparece com casas no site (sem nenhuma, a consulta mostra o aviso do site
 * sem casas, M7.8).
 */
export function ResultadosBusca({
  conteudo,
  imoveis,
  pedido,
  resultado,
  hoje,
}: {
  conteudo: ConteudoSite;
  /** Todas as casas do site (para o "Seu lugar" da busca). */
  imoveis: ImovelPublico[];
  pedido: PedidoConsulta;
  resultado: ResultadoBusca;
  /** Mínimo do campo de datas. */
  hoje: string;
}) {
  const { textos } = conteudo;
  return (
    <div className={styles.buscaPagina}>
      <CabecalhoBusca textos={textos} />
      <div className={styles.buscaCaixa}>
        <FormConsulta imoveis={imoveis} valores={pedido} erros={resultado.ok ? {} : resultado.erros} hoje={hoje} canal={canalDeContato(conteudo)} variante="busca" />
      </div>
      {!resultado.ok ? (
        <p className={`${styles.aviso} ${styles.avisoBusca}`} role="alert">
          Confira as datas e as pessoas acima para ver as casas.
        </p>
      ) : resultado.casas.length === 0 ? (
        <section className={styles.semCasa} aria-label="Nenhuma casa para o grupo">
          {/* Lista vazia aqui é sempre pelo tamanho do grupo: sem nenhuma casa no site, a consulta mostra antes o aviso do site
              sem casas (M7.8), a regra única desse caso. */}
          <p className={styles.aviso} role="status">
            {textos.buscaSemCasa}
          </p>
          <Contato conteudo={conteudo} texto={mensagemDaBusca(pedido, resultado.hospedes)} />
        </section>
      ) : (
        <section aria-labelledby="titulo-casas-busca">
          {/* "Na sua busca", não "para N pessoas": a lista inclui as casas sem capacidade cadastrada, que podem não caber. */}
          <h2 id="titulo-casas-busca" className={styles.tituloBusca}>
            {resultado.casas.length} {resultado.casas.length === 1 ? "casa" : "casas"} na sua busca
          </h2>
          <p className={styles.miudo}>
            {dataBr(pedido.entrada)} a {dataBr(pedido.saida)} · {diasEntre(pedido.entrada, pedido.saida)} {diasEntre(pedido.entrada, pedido.saida) === 1 ? "noite" : "noites"} · {resultado.hospedes}{" "}
            {resultado.hospedes === 1 ? "pessoa" : "pessoas"}
            {resultado.foraDoGrupo > 0 && ` · ${resultado.foraDoGrupo} ${resultado.foraDoGrupo === 1 ? "casa recebe" : "casas recebem"} menos pessoas e não ${resultado.foraDoGrupo === 1 ? "aparece" : "aparecem"} aqui`}
          </p>
          {textos.buscaAviso && (
            <p className={`${styles.aviso} ${styles.avisoBusca}`} role="note">
              {textos.buscaAviso}
            </p>
          )}
          <div className={styles.grade}>
            {resultado.casas.map((c, n) => (
              <CartaoImovel
                key={c.imovel.codigo}
                imovel={c.imovel}
                carregarCedo={n < 2}
                href={linkDaCasa(c.imovel.codigo, { entrada: pedido.entrada, saida: pedido.saida, hospedes: String(resultado.hospedes) }) ?? undefined}
                chamada="Ver a casa com as datas →"
              >
                <SituacaoNaBusca casa={c} />
              </CartaoImovel>
            ))}
          </div>
          <div className={styles.contatoBusca}>
            {textos.buscaContato && <p className={styles.miudo}>{textos.buscaContato}</p>}
            <Contato conteudo={conteudo} texto={mensagemDaBusca(pedido, resultado.hospedes)} />
          </div>
        </section>
      )}
    </div>
  );
}
