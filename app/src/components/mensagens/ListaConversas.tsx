import Link from "next/link";
import { diaHoraNoFuso } from "@/lib/datas";
import type { ResumoConversa } from "@/whatsapp/conversas";
import styles from "./mensagens.module.css";

/**
 * A lista da caixa de entrada (M10.1a): por conversa, o nome (agenda do celular, senão o perfil do WhatsApp), a prévia
 * da última mensagem, a hora e os selos ("Não lida", "Sem resposta", o vínculo ou "Sem vínculo", "Confira o contato").
 * O selo do vínculo vem pronto de `whatsapp/conversas.ts`: quem não lê o alvo vê só o tipo, sem nome. Componente de
 * servidor (nada daqui vai para o navegador como dado); sem o telefone na lista.
 */
export function ListaConversas({ itens, vazio }: { itens: readonly ResumoConversa[]; vazio: string }) {
  if (!itens.length) return <p className={`${styles.lista} ${styles.vazio}`}>{vazio}</p>;
  return (
    <ul className={styles.lista} aria-label="Conversas">
      {itens.map((c) => (
        <li key={c.id} className={styles.item}>
          <Link href={`/painel/mensagens/${c.id}`} className={`${styles.linkConversa} ${c.naoLida ? styles.naoLida : ""}`}>
            <span className={styles.topo}>
              <span className={styles.nome}>{c.nome}</span>
              {c.ultimaMensagemEm && <span className={styles.hora}>{diaHoraNoFuso(c.ultimaMensagemEm)}</span>}
            </span>
            {c.previa && <span className={styles.previa}>{c.previa}</span>}
            <span className={styles.selos}>
              {c.naoLida && <span className={`${styles.selo} ${styles.seloNaoLida}`}>Não lida</span>}
              {c.semResposta && <span className={`${styles.selo} ${styles.seloSemResposta}`}>Sem resposta</span>}
              {c.vinculo ? <span className={styles.selo}>{c.vinculo.selo}</span> : <span className={`${styles.selo} ${styles.seloVazio}`}>Sem vínculo</span>}
              {c.conflitoIdentidade && <span className={`${styles.selo} ${styles.seloConflito}`}>Confira o contato</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
