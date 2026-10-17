import { diaHoraNoFuso, horaNoFuso } from "@/lib/datas";
import { type MensagemNaTela, MENSAGENS_NA_CONVERSA } from "@/whatsapp/conversas";
import type { Direcao } from "@/whatsapp/regras";
import styles from "./mensagens.module.css";

/** Quem mandou. A enviada pelo painel só existe a partir do M10.2 (resposta pelo painel). */
const QUEM: Record<Direcao, string> = { recebida: "Cliente", enviada_celular: "Enviada pelo celular", enviada_painel: "Enviada pelo painel" };

/**
 * As mensagens da conversa (M10.1a), em ordem de envio: quem mandou, a hora, o conteúdo inteiro (anexos como "ver no
 * celular", pelo `conteudoDaMensagem` de `whatsapp/conversas.ts`), a edição, o apagamento, a reação e "do histórico"
 * quando veio da sincronização. O texto que o sistema põe no lugar do conteúdo ("Mensagem apagada", "Foto — ver no
 * celular"…) sai como marcador, diferente do que o cliente escreveu, e o aviso do WhatsApp (troca de número) sai no meio,
 * sem balão e sem "Cliente": não foi o cliente que mandou. A lista abre rolada na mais recente (`.rolagemConversa`), e a
 * área rolável recebe o foco pelo teclado. Só leitura: sem caixa de resposta. Componente de servidor.
 */
export function Conversa({ mensagens, maisMensagens }: { mensagens: readonly MensagemNaTela[]; maisMensagens: boolean }) {
  if (!mensagens.length) return <p className={styles.nota}>Nenhuma mensagem guardada nesta conversa.</p>;
  return (
    <>
      <div className={styles.rolagemConversa} tabIndex={0} role="region" aria-label="Conversa">
        <ol className={styles.mensagens} aria-label="Mensagens">
          {mensagens.map((m) =>
            m.tipo === "sistema" ? (
              <li key={m.id} className={styles.avisoNaConversa}>{`${m.conteudo} · ${diaHoraNoFuso(m.enviadaEm)}`}</li>
            ) : (
              <li key={m.id} className={`${styles.balao} ${m.direcao === "recebida" ? "" : styles.enviada}`}>
                <span className={styles.quem}>
                  <strong>{QUEM[m.direcao] ?? QUEM.recebida}</strong>
                  <span>{diaHoraNoFuso(m.enviadaEm)}</span>
                  {m.origem === "historico" && <span>do histórico</span>}
                </span>
                <p className={`${styles.conteudo} ${m.apagadaEm || m.tipo !== "texto" ? styles.marcador : ""}`}>{m.conteudo}</p>
                {m.editadaEm && !m.apagadaEm && <p className={styles.detalhe}>{`(editada às ${horaNoFuso(m.editadaEm)})`}</p>}
                {m.reacao && <p className={styles.detalhe}>{`Reação: ${m.reacao}`}</p>}
              </li>
            ),
          )}
        </ol>
      </div>
      {maisMensagens && <p className={styles.nota}>{`Mostrando as ${MENSAGENS_NA_CONVERSA} mensagens mais recentes.`}</p>}
    </>
  );
}
