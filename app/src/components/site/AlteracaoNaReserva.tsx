import type { ReactNode } from "react";
import type { AceiteNaPagina } from "@/site/aceites";
import type { EstadoCartao, EstadoContinuar, EstadoPix } from "@/site/acoes-pagamento";
import { type AlteracaoDoHospede, type TextosDaAlteracao, textoDaAlteracao } from "@/site/pagamento-vista";
import { PagamentoPix, type TextosPagamento } from "./PagamentoPix";
import styles from "./site.module.css";

type AcaoPix = (estado: EstadoPix, form: FormData) => Promise<EstadoPix>;
type AcaoContinuar = (estado: EstadoContinuar, form: FormData) => Promise<EstadoContinuar>;
type AcaoCartao = (form: FormData) => Promise<EstadoCartao>;

/** O título do quadro em cada situação da alteração. */
export const TITULO_ALTERACAO: Record<AlteracaoDoHospede["situacao"], string> = {
  segurada: "Alteração da sua reserva",
  aplicada: "Alteração confirmada",
  nao_aplicada: "A alteração não pôde ser feita",
  nao_vale: "Alteração que não vale mais",
};

/** Sem o pagamento da diferença oferecido agora (as travas, a oferta): a equipe confirma a alteração. */
export const TEXTO_DIFERENCA_INDISPONIVEL = "O pagamento da diferença pelo site não está disponível agora. Fale com a equipe para confirmar a alteração.";

/**
 * A alteração da reserva paga pelo site na página da reserva (M8.2d, design §8.3), acima do quadro do pagamento: as linhas
 * do compositor único (`textoDaAlteracao`: a segurada em qualquer direção, a aplicada com a devolução da diferença, a que
 * não pôde valer e a que não vale mais; a linha da política sempre). No aumento com as datas seguradas, o pagamento da
 * diferença na mesma caixa do da cotação (`PagamentoPix` com `alteracaoId`: o Pix e o cartão levam a alteração, o valor é
 * a diferença, o acompanhamento é o dela) e o aceite na forma do D11 (`aceite`: os Termos e a Privacidade em vigor com a
 * política da reserva; a caixa só quando essas versões ainda não foram aceitas nesta cotação). Nada daqui cita o Beds24
 * nem tem dado pessoal; quem decide o que vale é o servidor.
 */
export function AlteracaoNaReserva({
  codigo,
  reservaCodigo,
  alteracao: a,
  textos,
  fuso,
  autorizado,
  aceite,
  textosPagamento,
  contato,
  gerarPix,
  continuar,
  pagarComCartao,
  linhaAnalise = null,
}: {
  /** Código da cotação (a rota de acompanhamento e as ações do pagamento). */
  codigo: string;
  /** Código da reserva (SCL-…), o que o texto da alteração cita. */
  reservaCodigo: string;
  alteracao: AlteracaoDoHospede;
  textos: TextosDaAlteracao;
  fuso: string;
  autorizado: boolean;
  aceite: AceiteNaPagina | null;
  textosPagamento: Omit<TextosPagamento, "convite" | "cancelamento">;
  contato: ReactNode;
  gerarPix: AcaoPix;
  continuar: AcaoContinuar;
  pagarComCartao?: AcaoCartao;
  linhaAnalise?: string | null;
}) {
  const { linhas } = textoDaAlteracao(a, textos, reservaCodigo, fuso);
  const pagamento = a.situacao === "segurada" && a.rumo === "aumento" ? a.pagamento : null;
  return (
    <section className={styles.aviso} aria-label="Alteração da reserva">
      <h3>{TITULO_ALTERACAO[a.situacao]}</h3>
      {linhas.map((l, i) => (
        <p key={l} className={styles.texto}>
          {i === 0 && a.situacao !== "nao_vale" ? <strong>{l}</strong> : l}
        </p>
      ))}
      {pagamento &&
        (pagamento.estado === "sem_pagamento" ? (
          <>
            <p className={styles.texto}>{TEXTO_DIFERENCA_INDISPONIVEL}</p>
            {contato}
          </>
        ) : (
          <PagamentoPix
            codigo={codigo}
            pagamento={pagamento}
            autorizado={autorizado}
            fuso={fuso}
            total={a.diferenca}
            // Sem convite: a linha da alteração acima já diz o que fazer (a frase editável de "Alteração com diferença a pagar").
            textos={{ ...textosPagamento, convite: "" }}
            contato={contato}
            gerarPix={gerarPix}
            continuar={continuar}
            pagarComCartao={pagarComCartao}
            aceite={aceite}
            linhaAnalise={pagamento.estado === "cartao_em_analise" ? linhaAnalise : null}
            alteracaoId={a.id}
          />
        ))}
    </section>
  );
}
