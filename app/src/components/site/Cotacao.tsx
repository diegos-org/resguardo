import type { ReactNode } from "react";
import { type CotacaoVista, motivoDaMudanca, textoDaCotacao } from "@/site/cotacoes";
import { linkWhatsapp } from "@/site/site";
import styles from "./site.module.css";

const brl = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBr = (d: string) => d.split("-").reverse().join("/");
const quando = (d: Date, fuso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, dateStyle: "short", timeStyle: "short" }).format(d);

export const TITULO_COTACAO: Record<CotacaoVista["estado"], string> = {
  aberta: "Sua cotação",
  segurada: "Datas seguradas",
  convertida: "Reserva confirmada",
  expirada: "O tempo desta cotação acabou",
  desatualizada: "Esta cotação mudou",
  cancelada: "Este pedido foi cancelado",
};

/** Botão para falar com a equipe (WhatsApp antes do e-mail), com a mensagem da cotação; null sem contato configurado. */
export function BotaoContato({ whatsapp, email, codigo, texto, secundario = false }: { whatsapp: string | null; email: string; codigo: string; texto: string; secundario?: boolean }) {
  const classe = secundario ? `${styles.botao} ${styles.botaoContorno}` : styles.botao;
  if (whatsapp) {
    return (
      <a href={linkWhatsapp(whatsapp, texto)} className={classe} target="_blank" rel="noopener noreferrer">
        Falar com a equipe pelo WhatsApp
      </a>
    );
  }
  if (email) {
    return (
      <a href={`mailto:${email}?subject=${encodeURIComponent(`Cotação ${codigo}`)}&body=${encodeURIComponent(texto)}`} className={classe}>
        Falar com a equipe por e-mail
      </a>
    );
  }
  return null;
}

/** "Nenhum pagamento é feito no site…": com o Pix oferecido para a cotação, diz como é o pagamento. */
export const RODAPE_COTACAO = {
  semPagamento: "Nenhum pagamento é feito no site por enquanto. A reserva é confirmada pela equipe.",
  comPagamento: "Nada é cobrado ao segurar as datas: o pagamento é por Pix, aqui no site, com as datas seguradas.",
} as const;

/**
 * Página da cotação (M8.1): resumo do que foi cotado e, conforme o estado, o formulário para segurar as
 * datas, o prazo do hold com o botão de WhatsApp, ou o aviso de que mudou/venceu com o caminho para
 * consultar de novo. `formulario` é o formulário de contato (só faz sentido na cotação aberta e válida).
 * `pagamento` (M8.2a): quando há pagamento no site (Pix oferecido, aguardando, recebido…), o título e o quadro
 * dele vêm primeiro e substituem o que o estado da cotação diria — um pagamento vence "expirada" e "cancelada".
 * `pagamentoNoSite`: o site oferece o Pix para esta cotação (muda o texto "nenhum pagamento é feito no site").
 */
export function Cotacao({
  vista,
  whatsapp,
  email,
  formulario,
  pagamento,
  pagamentoNoSite = false,
}: {
  vista: CotacaoVista;
  whatsapp: string | null;
  email: string;
  formulario?: ReactNode;
  pagamento?: { titulo: string; conteudo: ReactNode };
  pagamentoNoSite?: boolean;
}) {
  const c = vista.cotacao;
  const novaConsulta = `/consulta?${new URLSearchParams({ imovel: c.imovelCodigo, entrada: c.checkin, saida: c.checkout, hospedes: String(c.hospedes) })}`;
  const contato = <BotaoContato whatsapp={whatsapp} email={email} codigo={c.codigo} texto={textoDaCotacao(vista)} />;
  const temContato = !!(whatsapp || email);
  const titulo = pagamento ? pagamento.titulo : vista.estado === "aberta" && vista.mudou ? TITULO_COTACAO.desatualizada : TITULO_COTACAO[vista.estado];
  const estado = pagamento ? null : vista.estado;
  return (
    <section className={styles.bloco} aria-label="Cotação">
      <h2>{titulo}</h2>
      <p className={styles.miudo}>
        Cotação <strong>{c.codigo}</strong> · {c.imovelNome} ({c.imovelCodigo})
      </p>
      <p className={styles.texto}>
        {dataBr(c.checkin)} a {dataBr(c.checkout)} · {c.noites} {c.noites === 1 ? "noite" : "noites"} · {c.hospedes} {c.hospedes === 1 ? "pessoa" : "pessoas"}
        {c.situacao === "a_confirmar" ? " · disponibilidade a confirmar pela equipe" : ""}
      </p>
      {pagamento?.conteudo}
      <dl className={styles.resumo}>
        <dt>Diárias</dt>
        <dd>{brl(c.diarias)}</dd>
        {c.limpeza > 0 && (
          <>
            <dt>Limpeza</dt>
            <dd>{brl(c.limpeza)}</dd>
          </>
        )}
        {c.hospedeExtra > 0 && (
          <>
            <dt>Hóspede extra</dt>
            <dd>{brl(c.hospedeExtra)}</dd>
          </>
        )}
        {c.desconto > 0 && (
          <>
            <dt>Valor cheio</dt>
            <dd>{brl(c.valorCheio)}</dd>
            <dt>Desconto do site</dt>
            <dd>− {brl(c.desconto)}</dd>
          </>
        )}
        <dt>
          <strong>Total</strong>
        </dt>
        <dd>
          <strong>{brl(c.total)}</strong>
        </dd>
      </dl>

      {estado === "aberta" && !vista.mudou && (
        <>
          <p className={styles.texto} style={{ marginTop: 12 }}>
            {pagamentoNoSite
              ? "Valor conferido agora. Para garantir as datas, deixe seu contato: elas ficam seguradas para você por alguns minutos, para pagar por Pix aqui mesmo ou falar com a equipe. Sem pagamento ou confirmação até lá, voltam à venda."
              : "Valor conferido agora. Para garantir as datas enquanto fala com a equipe, deixe seu contato: elas ficam seguradas para você por alguns minutos e, se não houver confirmação até lá, voltam à venda."}
          </p>
          {formulario}
        </>
      )}
      {estado === "aberta" && vista.mudou && (
        <>
          <p className={styles.aviso} role="alert" style={{ marginTop: 12 }}>
            {vista.atual ? motivoDaMudanca(c, vista.atual) : "Esta cotação mudou."}
            {vista.atual?.cotacao?.total != null && vista.atual.cotacao.total !== c.total ? ` Valor atual: ${brl(vista.atual.cotacao.total)}.` : ""}
            {vista.atual?.motivos.length ? ` ${vista.atual.motivos.join(" ")}` : ""}
          </p>
          <p style={{ marginTop: 12 }}>
            <a href={novaConsulta} className={styles.botao}>
              Fazer uma nova consulta
            </a>
          </p>
        </>
      )}
      {estado === "segurada" && c.holdAte && (
        <>
          <p className={styles.texto} style={{ marginTop: 12 }}>
            As datas estão seguradas para você até <strong>{quando(c.holdAte, c.fuso)}</strong>
            {vista.reserva ? ` (pedido ${vista.reserva.codigo})` : ""}. Fale com a equipe para confirmar a reserva; se o prazo passar sem confirmação, as datas voltam à venda.
          </p>
          {temContato ? (
            <p style={{ marginTop: 12 }}>{contato}</p>
          ) : (
            <p className={styles.aviso} role="note" style={{ marginTop: 12 }}>
              O contato ainda não foi configurado. Guarde o código da cotação.
            </p>
          )}
        </>
      )}
      {estado === "convertida" && (
        <p className={styles.texto} style={{ marginTop: 12 }}>
          A equipe confirmou a sua reserva{vista.reserva ? ` (código ${vista.reserva.codigo})` : ""}. Guarde este código: é com ele que você acompanha a reserva.
        </p>
      )}
      {(estado === "expirada" || estado === "desatualizada" || estado === "cancelada") && (
        <>
          <p className={styles.texto} style={{ marginTop: 12 }}>
            {estado === "expirada"
              ? "O prazo passou sem confirmação e as datas voltaram à venda. Se ainda quiser, faça uma nova consulta — pode ser que continuem livres."
              : estado === "cancelada"
                ? "Este pedido foi cancelado pela equipe. Se tiver dúvida, fale com a gente ou faça uma nova consulta."
                : "O valor ou a disponibilidade mudaram desde esta cotação. Faça uma nova consulta para ver a situação atual."}
          </p>
          <p style={{ marginTop: 12 }}>
            <a href={novaConsulta} className={styles.botao}>
              Fazer uma nova consulta
            </a>
          </p>
        </>
      )}
      {!pagamento && (
        <p className={styles.miudo} style={{ marginTop: 12 }}>
          {pagamentoNoSite ? RODAPE_COTACAO.comPagamento : RODAPE_COTACAO.semPagamento}
        </p>
      )}
    </section>
  );
}
