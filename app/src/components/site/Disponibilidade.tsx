import type { Disponibilidade as Resultado } from "@/site/disponibilidade";
import styles from "./site.module.css";

const brl = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TITULO: Record<Resultado["situacao"], string> = { disponivel: "Disponível", indisponivel: "Indisponível nessas datas", a_confirmar: "Disponibilidade a confirmar", invalida: "Confira os dados" };
const quando = (d: Date, fuso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, dateStyle: "short", timeStyle: "short" }).format(d);

/** Resultado da consulta no site: situação em linguagem simples, valor por partes e o aviso de que a reserva se confirma na conversa. */
export function Disponibilidade({
  resultado,
  entrada,
  saida,
  fuso,
  nivel = 2,
}: {
  resultado: Resultado;
  entrada: string;
  saida: string;
  /** Fuso do imóvel: a hora da leitura é mostrada nele. */
  fuso: string;
  /** Nível do título: 3 dentro do quadro "Resumo da viagem" da consulta. */
  nivel?: 2 | 3;
}) {
  const r = resultado;
  const Titulo = nivel === 3 ? "h3" : "h2";
  const dataBr = (d: string) => d.split("-").reverse().join("/");
  return (
    <section className={styles.bloco} aria-label="Disponibilidade e valor">
      <Titulo>{TITULO[r.situacao]}</Titulo>
      {r.noites > 0 && (
        <p className={styles.miudo}>
          {dataBr(entrada)} a {dataBr(saida)} · {r.noites} {r.noites === 1 ? "noite" : "noites"}
          {r.leituraEm ? ` · agenda conferida em ${quando(r.leituraEm, fuso)}` : ""}
        </p>
      )}
      {r.motivos.length > 0 && (
        <ul className={styles.texto} style={{ paddingLeft: 20, marginTop: 8 }}>
          {r.motivos.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {r.cotacao && (
        <dl className={styles.resumo}>
          <dt>Diárias</dt>
          <dd>{r.cotacao.diarias === null ? "a confirmar" : brl(r.cotacao.diarias)}</dd>
          {r.cotacao.limpeza > 0 && (
            <>
              <dt>Limpeza</dt>
              <dd>{brl(r.cotacao.limpeza)}</dd>
            </>
          )}
          {r.cotacao.hospedeExtra > 0 && (
            <>
              <dt>Hóspede extra</dt>
              <dd>{brl(r.cotacao.hospedeExtra)}</dd>
            </>
          )}
          {r.cotacao.desconto > 0 && r.cotacao.valorCheio !== null && (
            <>
              <dt>Valor cheio</dt>
              <dd>{brl(r.cotacao.valorCheio)}</dd>
              <dt>Desconto do site</dt>
              <dd>− {brl(r.cotacao.desconto)}</dd>
            </>
          )}
          <dt>
            <strong>Total</strong>
          </dt>
          <dd>
            <strong>{r.cotacao.total === null ? "a confirmar" : brl(r.cotacao.total)}</strong>
          </dd>
        </dl>
      )}
      {r.situacao !== "invalida" && (
        <p className={styles.miudo} style={{ marginTop: 12 }}>
          {r.cotacao?.total !== null && r.cotacao ? "Valor de hoje, em reais, sem reserva ou pagamento por aqui: a reserva é confirmada na conversa. " : ""}
          Nenhuma data fica reservada pela consulta.
        </p>
      )}
    </section>
  );
}
