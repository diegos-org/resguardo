import Link from "next/link";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import styles from "@/components/formularios.module.css";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";
import { anexarComprovanteAcao, enviarEmailRepasseAcao, estornarRepasseAcao, pagarRepasseAcao } from "@/repasses/acoes";
import { NOMES_SITUACAO_EMAIL } from "@/repasses/email";
import { type itensDoRepasse, nomeMes, type Repasse, descricaoDoItem } from "@/repasses/repasses";

export type ItemDoRepasse = Awaited<ReturnType<typeof itensDoRepasse>>[number];

type Props = {
  r: Repasse;
  nome: string;
  chavePix: string;
  itens: readonly ItemDoRepasse[];
  /** Mês da tela (para voltar ao mesmo lugar). */
  mes: string;
  hoje: string;
  editar: boolean;
};

const dataBr = (d: string) => d.split("-").reverse().join("/");
const quando = (d: Date | null) => (d ? d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "");

export function nomeDoRepasse(r: Pick<Repasse, "tipo" | "mes" | "data">): string {
  return r.tipo === "fechamento" ? `Fechamento de ${nomeMes(r.mes.slice(0, 7))}` : `Repasse antecipado de ${dataBr(r.data)}`;
}

export function situacaoDoRepasse(r: Pick<Repasse, "situacao" | "dataPagamento" | "comprovante" | "comprovanteArquivoId">): string {
  if (r.situacao === "estornado") return "Estornado";
  if (r.situacao === "a_pagar") return "A pagar";
  return `Pago em ${dataBr(r.dataPagamento!)}${r.comprovante || r.comprovanteArquivoId ? "" : " · sem comprovante"}`;
}

/** Ações comuns a qualquer repasse (fechamento ou antecipado): itens, pagar com comprovante, anexar comprovante, e-mail, estornar. */
export function CartaoRepasse({ r, nome, chavePix, itens, mes, hoje, editar }: Props) {
  const comComprovante = Boolean(r.comprovante || r.comprovanteArquivoId);
  const campoComprovante = (
    <>
      <label style={{ flex: "1 1 220px" }}>
        Identificador do Pix (opcional)
        <input name="comprovante" maxLength={200} placeholder="ex.: E12345678202610111234" />
      </label>
      <label style={{ flex: "1 1 220px" }}>
        Arquivo do comprovante (PDF, PNG ou JPG, até 5 MB)
        <input type="file" name="arquivo" accept="application/pdf,image/png,image/jpeg" />
      </label>
    </>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {itens.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>
            {itens.length} parte(s) de reserva neste repasse{r.tipo === "fechamento" ? " (disponíveis da competência e antecipadas)" : ""}
          </summary>
          <div className={styles.rolagem}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Imóvel</th>
                  <th>Reserva</th>
                  <th>Estadia</th>
                  <th>Mês</th>
                  <th>Valor</th>
                  <th>Parte</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.id}>
                    <td>{i.codigoImovel}</td>
                    <td>
                      <Link href={`/painel/reservas/${i.reservaId}`}>{i.codigoReserva}</Link> · {i.hospede || "—"}
                    </td>
                    <td>
                      {dataBr(i.checkin)} → {dataBr(i.checkout)}
                    </td>
                    <td>{nomeMes(i.competencia.slice(0, 7))}</td>
                    <td className={styles.numero}>{formatBRL(i.valor)}</td>
                    <td>{descricaoDoItem(i)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {r.situacao === "pago" && (
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
          Comprovante:{" "}
          {comComprovante ? (
            <>
              {r.comprovante && <code>{r.comprovante}</code>}
              {r.comprovante && r.comprovanteArquivoId && " · "}
              {r.comprovanteArquivoId && <a href={`/painel/financeiro/repasses/${r.id}/comprovante`}>abrir arquivo</a>}
            </>
          ) : (
            <strong>não registrado — o e-mail ao proprietário espera o comprovante</strong>
          )}
          {" · "}
          {NOMES_SITUACAO_EMAIL[r.emailSituacao]}
          {r.emailSituacao !== "pendente" && r.emailEm ? ` em ${quando(r.emailEm)}${r.emailPara ? ` para ${r.emailPara}` : ""}` : ""}
        </p>
      )}

      {editar && r.situacao === "a_pagar" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span>
              Chave Pix: <code>{chavePix || "não cadastrada"}</code>
            </span>
            {chavePix && <BotaoCopiar texto={chavePix} rotulo="Copiar Pix" className={styles.pequeno} />}
            <BotaoCopiar texto={centavosParaCampo(r.valor)} rotulo="Copiar valor" className={styles.pequeno} />
          </div>
          <form action={pagarRepasseAcao} className={styles.linha} style={{ alignItems: "flex-end" }} aria-label={`Marcar pago: ${nomeDoRepasse(r)} de ${nome}`}>
            <input type="hidden" name="mes" value={mes} />
            <input type="hidden" name="id" value={r.id} />
            {/* A chave mostrada (e copiada) é a que fica gravada como usada, mesmo que o cadastro mude antes de enviar. */}
            <input type="hidden" name="chavePix" value={chavePix} />
            <label style={{ flex: "0 1 200px" }}>
              Data do Pix
              <input type="date" name="data" defaultValue={hoje} min={r.data} max={hoje} required />
            </label>
            {campoComprovante}
            <div className={styles.acoes}>
              <button type="submit">Marcar como pago</button>
            </div>
          </form>
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>
            Com o comprovante, o e-mail ao proprietário (valor, reservas e anexo) sai na hora. Sem ele, o repasse fica &ldquo;pago sem comprovante&rdquo; e o e-mail espera você anexar.
          </p>
        </>
      )}

      {editar && r.situacao === "pago" && !comComprovante && (
        <form action={anexarComprovanteAcao} className={styles.linha} style={{ alignItems: "flex-end" }} aria-label={`Anexar comprovante: ${nomeDoRepasse(r)} de ${nome}`}>
          <input type="hidden" name="mes" value={mes} />
          <input type="hidden" name="id" value={r.id} />
          {campoComprovante}
          <div className={styles.acoes}>
            <button type="submit">Anexar comprovante e enviar e-mail</button>
          </div>
        </form>
      )}

      {editar && r.situacao === "pago" && comComprovante && (
        <form action={enviarEmailRepasseAcao} className={styles.acoes}>
          <input type="hidden" name="mes" value={mes} />
          <input type="hidden" name="id" value={r.id} />
          {r.emailSituacao !== "pendente" && <input type="hidden" name="reenviar" value="sim" />}
          <BotaoConfirmar pergunta={`${r.emailSituacao === "pendente" ? "Enviar" : "Enviar de novo"} o e-mail do ${nomeDoRepasse(r).toLowerCase()} para ${nome}?`} className={styles.pequeno}>
            {r.emailSituacao === "pendente" ? "Enviar e-mail do repasse" : "Enviar e-mail de novo"}
          </BotaoConfirmar>
        </form>
      )}

      {editar && r.situacao !== "estornado" && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>Estornar este repasse</summary>
          <form action={estornarRepasseAcao} className={styles.linha} style={{ alignItems: "flex-end", marginTop: 8 }}>
            <input type="hidden" name="mes" value={mes} />
            <input type="hidden" name="id" value={r.id} />
            <label>
              Motivo
              <input name="motivo" required maxLength={300} placeholder="ex.: valor errado, refazer o fechamento" />
            </label>
            <div className={styles.acoes}>
              <BotaoConfirmar
                pergunta={`Estornar o ${nomeDoRepasse(r).toLowerCase()} de ${nome}? Os lançamentos são estornados${r.tipo === "fechamento" ? ", os adiantamentos descontados voltam a ficar em aberto" : ""} e as partes de reserva voltam a ficar disponíveis.${r.situacao === "pago" ? " O Pix já feito precisa ser devolvido ou acertado à parte." : ""}`}
                style={{ background: "var(--scl-erro)" }}
              >
                Estornar
              </BotaoConfirmar>
            </div>
          </form>
        </details>
      )}
    </div>
  );
}
