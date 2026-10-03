import type { ReactNode } from "react";
import { type CotacaoVista, textoDaCotacao } from "@/site/cotacoes";
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

/**
 * Página da cotação (M8.1): resumo do que foi cotado e, conforme o estado, o formulário para segurar as
 * datas, o prazo do hold com o botão de WhatsApp, ou o aviso de que mudou/venceu com o caminho para
 * consultar de novo. `formulario` é o formulário de contato (só faz sentido na cotação aberta e válida).
 */
export function Cotacao({ vista, whatsapp, email, formulario }: { vista: CotacaoVista; whatsapp: string | null; email: string; formulario?: ReactNode }) {
  const c = vista.cotacao;
  const novaConsulta = `/consulta?${new URLSearchParams({ imovel: c.imovelCodigo, entrada: c.checkin, saida: c.checkout, hospedes: String(c.hospedes) })}`;
  const texto = textoDaCotacao(vista);
  const contato = whatsapp ? (
    <a href={linkWhatsapp(whatsapp, texto)} className={styles.botao} target="_blank" rel="noopener noreferrer">
      Falar com a equipe pelo WhatsApp
    </a>
  ) : email ? (
    <a href={`mailto:${email}?subject=${encodeURIComponent(`Cotação ${c.codigo}`)}&body=${encodeURIComponent(texto)}`} className={styles.botao}>
      Falar com a equipe por e-mail
    </a>
  ) : null;
  const titulo = vista.estado === "aberta" && vista.mudou ? TITULO_COTACAO.desatualizada : TITULO_COTACAO[vista.estado];
  return (
    <section className={styles.secao} style={{ marginTop: 0 }} aria-label="Cotação">
      <h2>{titulo}</h2>
      <p className={styles.miudo}>
        Cotação <strong>{c.codigo}</strong> · {c.imovelNome} ({c.imovelCodigo})
      </p>
      <p className={styles.texto}>
        {dataBr(c.checkin)} a {dataBr(c.checkout)} · {c.noites} {c.noites === 1 ? "noite" : "noites"} · {c.hospedes} {c.hospedes === 1 ? "pessoa" : "pessoas"}
        {c.situacao === "a_confirmar" ? " · disponibilidade a confirmar pela equipe" : ""}
      </p>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content auto", gap: "4px 16px", marginTop: 12, background: "#fff", border: "1px solid #e4dccb", borderRadius: 8, padding: 16 }}>
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
        <dt>
          <strong>Total</strong>
        </dt>
        <dd>
          <strong>{brl(c.total)}</strong>
        </dd>
      </dl>

      {vista.estado === "aberta" && !vista.mudou && (
        <>
          <p className={styles.texto} style={{ marginTop: 12 }}>
            Valor conferido agora. Para garantir as datas enquanto fala com a equipe, deixe seu contato: elas ficam seguradas para você por alguns minutos e, se não houver confirmação até lá, voltam à venda.
          </p>
          {formulario}
        </>
      )}
      {vista.estado === "aberta" && vista.mudou && (
        <>
          <p className={styles.aviso} role="alert" style={{ marginTop: 12 }}>
            {vista.atual && (vista.atual.situacao === "disponivel" || vista.atual.situacao === "a_confirmar")
              ? `O valor mudou desde esta cotação${vista.atual.cotacao?.total !== null && vista.atual.cotacao?.total !== undefined ? ` (agora ${brl(vista.atual.cotacao.total)})` : ""}.`
              : "Essas datas não estão mais disponíveis."}
            {vista.atual?.motivos.length ? ` ${vista.atual.motivos.join(" ")}` : ""}
          </p>
          <p style={{ marginTop: 12 }}>
            <a href={novaConsulta} className={styles.botao}>
              Fazer uma nova consulta
            </a>
          </p>
        </>
      )}
      {vista.estado === "segurada" && c.holdAte && (
        <>
          <p className={styles.texto} style={{ marginTop: 12 }}>
            As datas estão seguradas para você até <strong>{quando(c.holdAte, c.fuso)}</strong>
            {vista.reserva ? ` (pedido ${vista.reserva.codigo})` : ""}. Fale com a equipe para confirmar a reserva; se o prazo passar sem confirmação, as datas voltam à venda.
          </p>
          {contato ? (
            <p style={{ marginTop: 12 }}>{contato}</p>
          ) : (
            <p className={styles.aviso} role="note" style={{ marginTop: 12 }}>
              O contato ainda não foi configurado. Guarde o código da cotação.
            </p>
          )}
        </>
      )}
      {vista.estado === "convertida" && (
        <p className={styles.texto} style={{ marginTop: 12 }}>
          A equipe confirmou a sua reserva{vista.reserva ? ` (código ${vista.reserva.codigo})` : ""}. Guarde este código: é com ele que você acompanha a reserva.
        </p>
      )}
      {(vista.estado === "expirada" || vista.estado === "desatualizada" || vista.estado === "cancelada") && (
        <>
          <p className={styles.texto} style={{ marginTop: 12 }}>
            {vista.estado === "expirada"
              ? "O prazo passou sem confirmação e as datas voltaram à venda. Se ainda quiser, faça uma nova consulta — pode ser que continuem livres."
              : vista.estado === "cancelada"
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
      <p className={styles.miudo} style={{ marginTop: 12 }}>
        Nenhum pagamento é feito no site por enquanto. A reserva é confirmada pela equipe.
      </p>
    </section>
  );
}
