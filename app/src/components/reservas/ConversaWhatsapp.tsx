import Link from "next/link";
import styles from "@/components/mensagens/mensagens.module.css";
import { dataHoraNoFuso, diaHoraNoFuso } from "@/lib/datas";
import type { ConversaNaFicha } from "@/whatsapp/conversas";

/**
 * Ficha da reserva → "Conversa no WhatsApp" (M10.1a): as conversas confirmadas com a reserva (as 3 últimas mensagens de
 * cada uma, com o link para a conversa) e quantas conversas sem vínculo teriam a reserva como sugestão (confirmar na
 * caixa de entrada; nada se vincula sozinho). `null` = a sessão não vê as conversas (a página nem consulta); sem
 * conversa nem sugestão, o bloco não aparece. Componente de servidor.
 */
export function ConversaWhatsapp({ conversas }: { conversas: { confirmadas: readonly ConversaNaFicha[]; sugeridas: number } | null }) {
  if (!conversas || (!conversas.confirmadas.length && !conversas.sugeridas)) return null;
  return (
    <section aria-label="Conversa no WhatsApp" className={styles.cartao}>
      <h2>Conversa no WhatsApp</h2>
      {conversas.confirmadas.map((c) => (
        <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <p>
            <strong>{c.nome}</strong>
            {c.ultimaMensagemEm ? ` · última mensagem ${dataHoraNoFuso(c.ultimaMensagemEm)}` : ""}
          </p>
          {c.mensagens.length > 0 && (
            <ul className={styles.nota} style={{ margin: 0, paddingLeft: 18 }}>
              {c.mensagens.map((m) => (
                <li key={m.id}>{`${m.direcao === "recebida" ? "Cliente" : "Celular"} · ${diaHoraNoFuso(m.enviadaEm)}: ${m.previa}`}</li>
              ))}
            </ul>
          )}
          <Link href={`/painel/mensagens/${c.id}`} className={styles.link}>
            Abrir a conversa
          </Link>
        </div>
      ))}
      {conversas.sugeridas > 0 && (
        <p>
          {`${conversas.sugeridas} conversa(s) com sugestão de vínculo a esta reserva: `}
          <Link href="/painel/mensagens?filtro=sem_vinculo">confirme na caixa de entrada</Link>.
        </p>
      )}
    </section>
  );
}
