"use client";

import { useActionState, useEffect, useRef } from "react";
import type { EstadoIdExterno } from "@/canais/acoes";
import { type IdExterno, NOMES_CANAL } from "@/canais/ids-externos";
import styles from "../formularios.module.css";
import { BotaoConfirmar } from "../BotaoConfirmar";

type Props = {
  imovelId: string;
  lista: IdExterno[];
  adicionar: (a: EstadoIdExterno, f: FormData) => Promise<EstadoIdExterno>;
  remover: (a: EstadoIdExterno, f: FormData) => Promise<EstadoIdExterno>;
};

export function IdsExternos({ imovelId, lista, adicionar, remover }: Props) {
  const [estado, enviar, enviando] = useActionState(adicionar, {});
  const [remocao, removerRegistro] = useActionState(remover, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok) form.current?.reset();
  }, [estado]);

  return (
    <section aria-label="Canais e IDs externos" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: "1.25rem" }}>Canais e IDs externos</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
        Números deste imóvel no Beds24, Airbnb e Booking. É assim que a sincronização sabe a qual imóvel cada reserva pertence.
      </p>
      {remocao.erro && (
        <p role="alert" className={styles.alerta}>
          {remocao.erro}
        </p>
      )}
      {lista.length === 0 ? (
        <p>Nenhum canal ligado ainda.</p>
      ) : (
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {lista.map((r) => (
            <li key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span>
                <strong>{NOMES_CANAL[r.canal]}</strong> · {r.idExterno}
                {r.detalhe && ` / ${r.detalhe}`}
              </span>
              <form action={removerRegistro}>
                <input type="hidden" name="imovelId" value={imovelId} />
                <input type="hidden" name="registroId" value={r.id} />
                <BotaoConfirmar
                  pergunta={`Remover a ligação ${NOMES_CANAL[r.canal]} ${r.idExterno}? As reservas desse canal deixam de ser ligadas a este imóvel.`}
                  style={{ font: "inherit", fontSize: "0.875rem", background: "none", border: "1px solid var(--scl-borda)", borderRadius: 6, padding: "2px 10px", cursor: "pointer" }}
                >
                  Remover
                </BotaoConfirmar>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form ref={form} action={enviar} className={styles.form} aria-label="Ligar canal">
        <input type="hidden" name="imovelId" value={imovelId} />
        {estado.erro && (
          <p role="alert" className={styles.alerta}>
            {estado.erro}
          </p>
        )}
        <div className={styles.linha}>
          <label>
            Canal
            <select name="canal" defaultValue="beds24">
              {Object.entries(NOMES_CANAL).map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            ID no canal
            <input name="idExterno" required maxLength={64} placeholder="ex.: 123456" />
          </label>
          <label>
            Detalhe (opcional)
            <input name="detalhe" maxLength={64} placeholder="ex.: roomId do Beds24" />
          </label>
        </div>
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>
            Ligar canal
          </button>
        </div>
      </form>
    </section>
  );
}
