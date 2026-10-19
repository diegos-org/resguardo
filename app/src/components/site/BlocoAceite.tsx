import type { ReactNode } from "react";
import { HORA_LIMITE_DO_DIA } from "@/configuracoes/politica-cancelamento";
import { CAMPOS_VERSAO, DOCUMENTOS_LEGAIS, type DocumentoLegal as Documento, PAGINAS_LEGAIS, type VersoesLegais } from "@/configuracoes/paginas-legais-texto";
import { dataBr, diaHoraNoFuso, diaMesBr, hojeISO, rotuloDoFuso } from "@/lib/datas";
import type { AceiteNaPagina } from "@/site/aceites";
import { LinkNovaJanela } from "./Acessibilidade";
import { DocumentoLegal } from "./DocumentoLegal";
import styles from "./site.module.css";

/** A versão aceita (ou a que vai ser aceita) de um documento, numa aba nova: a página do pagamento fica como está. */
function LinkLegal({ doc, versoes, children }: { doc: Documento; versoes: VersoesLegais; children?: ReactNode }) {
  return (
    <LinkNovaJanela href={`${PAGINAS_LEGAIS[doc].rota}?versao=${versoes[doc]}`}>{children ?? PAGINAS_LEGAIS[doc].titulo}</LinkNovaJanela>
  );
}

/** O prazo do reembolso integral desta reserva pela política (data do calendário no fuso do imóvel, até 23:59, `HORA_LIMITE_DO_DIA`). */
export function PrazoDoReembolso({ prazo, fuso }: { prazo: AceiteNaPagina["prazo"]; fuso: string }) {
  if (prazo.tipo === "integral_ate") {
    return (
      <p className={styles.texto}>
        Para esta reserva, o reembolso integral vale para pedidos de cancelamento até <strong>{`${HORA_LIMITE_DO_DIA} de ${dataBr(prazo.data)}`}</strong> ({rotuloDoFuso(fuso)}).
      </p>
    );
  }
  return (
    <p className={styles.texto}>
      Esta reserva já está a menos de {prazo.dias} {prazo.dias === 1 ? "dia" : "dias"} da entrada: pela política, o cancelamento não tem devolução, salvo os casos descritos nela.
    </p>
  );
}

/**
 * Caixa de aceite antes de pagar (M7.4), dentro do formulário que gera o pagamento (o Pix e o cartão, M8.2b, usam a
 * mesma): o resumo da Política de cancelamento em vigor, o prazo do reembolso desta reserva, a caixa obrigatória com os
 * links para as versões que a página mostra e, escondidas, essas versões — o servidor confere se ainda são as
 * publicadas e grava o aceite na mesma transação do pagamento. `aoMarcar` (cartão): avisa quem usa a caixa quando ela é
 * marcada ou desmarcada (o formulário do cartão só carrega depois da caixa marcada).
 *
 * Pagamento da diferença de uma alteração (M8.2d, D11, `aceite.daReserva`): a reserva continua na Política de
 * cancelamento aceita no pagamento que a confirmou; a caixa aceita só os Termos e a Privacidade em vigor e diz qual
 * política continua valendo (o resumo e o prazo são dela). As versões escondidas são as que o servidor confere.
 */
export function BlocoAceite({ aceite, fuso, aoMarcar }: { aceite: AceiteNaPagina; fuso: string; aoMarcar?: (marcado: boolean) => void }) {
  const { versoes, daReserva } = aceite;
  return (
    <fieldset className={styles.aceiteLegal}>
      <legend>Antes de pagar</legend>
      <p className={styles.miudo}>{daReserva ? "Resumo da Política de cancelamento da sua reserva:" : "Resumo da Política de cancelamento:"}</p>
      <DocumentoLegal blocos={aceite.resumo} />
      <PrazoDoReembolso prazo={aceite.prazo} fuso={fuso} />
      <label className={styles.opcao}>
        <input type="checkbox" name="aceite" value="sim" required onChange={aoMarcar ? (e) => aoMarcar(e.currentTarget.checked) : undefined} />
        {daReserva ? (
          <span>
            Li e aceito os{" "}
            <LinkLegal doc="termos" versoes={versoes}>
              Termos (versão {versoes.termos})
            </LinkLegal>{" "}
            e li a{" "}
            <LinkLegal doc="privacidade" versoes={versoes}>
              Privacidade (versão {versoes.privacidade})
            </LinkLegal>
            . A sua reserva continua na{" "}
            <LinkLegal doc="cancelamento" versoes={versoes}>
              Política de cancelamento versão {daReserva.versao}
            </LinkLegal>
            , aceita em {diaMesBr(hojeISO(fuso, new Date(daReserva.em)))}.
          </span>
        ) : (
          <span>
            Li e aceito os <LinkLegal doc="termos" versoes={versoes} /> e a <LinkLegal doc="cancelamento" versoes={versoes} />, e li a{" "}
            <LinkLegal doc="privacidade" versoes={versoes} />.
          </span>
        )}
      </label>
      {DOCUMENTOS_LEGAIS.map((doc) => (
        <input key={doc} type="hidden" name={CAMPOS_VERSAO[doc]} value={versoes[doc]} />
      ))}
    </fieldset>
  );
}

/**
 * O aceite já feito, com as versões (links para cada uma) e quando — no lugar da caixa, quando as versões em vigor já
 * foram aceitas nesta cotação, e na reserva confirmada (com o prazo do reembolso pela política aceita).
 */
export function AceiteFeito({ aceito, fuso, prazo }: { aceito: NonNullable<AceiteNaPagina["aceito"]>; fuso: string; prazo?: AceiteNaPagina["prazo"] }) {
  const v = aceito.versoes;
  const em = new Date(aceito.em);
  return (
    <div className={styles.aceiteFeito}>
      <p className={styles.miudo}>
        Você aceitou os{" "}
        <LinkLegal doc="termos" versoes={v}>
          Termos de uso (versão {v.termos})
        </LinkLegal>
        , a{" "}
        <LinkLegal doc="cancelamento" versoes={v}>
          Política de cancelamento (versão {v.cancelamento})
        </LinkLegal>{" "}
        e leu a{" "}
        <LinkLegal doc="privacidade" versoes={v}>
          Política de privacidade (versão {v.privacidade})
        </LinkLegal>{" "}
        em {diaHoraNoFuso(em, fuso)}.
      </p>
      {prazo && <PrazoDoReembolso prazo={prazo} fuso={fuso} />}
    </div>
  );
}
