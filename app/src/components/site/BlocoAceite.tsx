import type { ReactNode } from "react";
import { CAMPOS_VERSAO, DOCUMENTOS_LEGAIS, type DocumentoLegal as Documento, PAGINAS_LEGAIS, type VersoesLegais } from "@/configuracoes/paginas-legais-texto";
import type { AceiteNaPagina } from "@/site/aceites";
import { DocumentoLegal } from "./DocumentoLegal";
import styles from "./site.module.css";

const br = (d: string) => d.split("-").reverse().join("/");
const formato = (fuso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, ...o });
const horario = (fuso: string) => (fuso === "America/Sao_Paulo" ? "horário de Brasília" : "horário do local do imóvel");

/** A versão aceita (ou a que vai ser aceita) de um documento, numa aba nova: a página do pagamento fica como está. */
function LinkLegal({ doc, versoes, children }: { doc: Documento; versoes: VersoesLegais; children?: ReactNode }) {
  return (
    <a href={`${PAGINAS_LEGAIS[doc].rota}?versao=${versoes[doc]}`} target="_blank" rel="noopener noreferrer">
      {children ?? PAGINAS_LEGAIS[doc].titulo}
    </a>
  );
}

/** O prazo do reembolso integral desta reserva pela política (data do calendário no fuso do imóvel, até 23h59). */
export function PrazoDoReembolso({ prazo, fuso }: { prazo: AceiteNaPagina["prazo"]; fuso: string }) {
  if (prazo.tipo === "integral_ate") {
    return (
      <p className={styles.texto}>
        Para esta reserva, o reembolso integral vale para pedidos de cancelamento até <strong>23h59 de {br(prazo.data)}</strong> ({horario(fuso)}).
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
 * Caixa de aceite antes de pagar (M7.4), dentro do formulário que gera o pagamento (Pix hoje; o cartão, M8.2b, usa a
 * mesma): o resumo da Política de cancelamento em vigor, o prazo do reembolso desta reserva, a caixa obrigatória com os
 * links para as versões que a página mostra e, escondidas, essas versões — o servidor confere se ainda são as
 * publicadas e grava o aceite na mesma transação do pagamento.
 */
export function BlocoAceite({ aceite, fuso }: { aceite: AceiteNaPagina; fuso: string }) {
  const { versoes } = aceite;
  return (
    <fieldset className={styles.aceiteLegal}>
      <legend>Antes de pagar</legend>
      <p className={styles.miudo}>Resumo da Política de cancelamento:</p>
      <DocumentoLegal blocos={aceite.resumo} />
      <PrazoDoReembolso prazo={aceite.prazo} fuso={fuso} />
      <label className={styles.opcao}>
        <input type="checkbox" name="aceite" value="sim" required />
        <span>
          Li e aceito os <LinkLegal doc="termos" versoes={versoes} /> e a <LinkLegal doc="cancelamento" versoes={versoes} />, e li a{" "}
          <LinkLegal doc="privacidade" versoes={versoes} />.
        </span>
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
        em {formato(fuso, { day: "2-digit", month: "2-digit" }).format(em)} às {formato(fuso, { hour: "2-digit", minute: "2-digit" }).format(em)}.
      </p>
      {prazo && <PrazoDoReembolso prazo={prazo} fuso={fuso} />}
    </div>
  );
}
