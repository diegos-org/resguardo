"use client";

import { useActionState, useEffect, useRef } from "react";
import type { EstadoForm } from "@/proprietarios/acoes";
import type { Representante } from "@/proprietarios/repositorio";
import type { DadosRepresentante } from "@/proprietarios/validacao";
import styles from "../formularios.module.css";
import { BotaoConfirmar } from "../BotaoConfirmar";

type Props = {
  proprietarioId: string;
  lista: Representante[];
  adicionar: (a: EstadoForm<DadosRepresentante>, f: FormData) => Promise<EstadoForm<DadosRepresentante>>;
  remover: (f: FormData) => Promise<void>;
};

export function Representantes({ proprietarioId, lista, adicionar, remover }: Props) {
  const [estado, enviar, enviando] = useActionState(adicionar, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok) form.current?.reset();
  }, [estado]);
  const e = estado.erros ?? {};

  return (
    <section aria-label="Representantes" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: "1.25rem" }}>Representantes autorizados</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
        Cônjuge, procurador ou responsável financeiro. Não se tornam coproprietários por estarem aqui.
      </p>
      {lista.length > 0 && (
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {lista.map((r) => (
            <li key={r.id} className={styles.form} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 }}>
              <span>
                <strong>{r.nome}</strong>
                {r.relacao && ` · ${r.relacao}`}
                <br />
                <span style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
                  {[r.email, r.telefone].filter(Boolean).join(" · ") || "sem contato"}
                  {r.recebeRelatorios && " · recebe relatórios"}
                </span>
              </span>
              <form action={remover}>
                <input type="hidden" name="proprietarioId" value={proprietarioId} />
                <input type="hidden" name="representanteId" value={r.id} />
                <BotaoConfirmar
                  pergunta={`Remover o representante ${r.nome}?`}
                  style={{ font: "inherit", fontSize: "0.875rem", background: "none", border: "1px solid #d8d0c0", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
                >
                  Remover
                </BotaoConfirmar>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form ref={form} action={enviar} className={styles.form} aria-label="Novo representante">
        <input type="hidden" name="proprietarioId" value={proprietarioId} />
        {estado.mensagem && (
          <p role="alert" className={styles.alerta}>
            {estado.mensagem}
          </p>
        )}
        <div className={styles.linha}>
          <label>
            Nome
            <input name="nome" required aria-invalid={e.nome ? true : undefined} />
            {e.nome && <span className={styles.erro}>{e.nome}</span>}
          </label>
          <label>
            Relação
            <input name="relacao" placeholder="cônjuge, financeiro…" />
          </label>
        </div>
        <div className={styles.linha}>
          <label>
            E-mail
            <input name="email" type="email" aria-invalid={e.email ? true : undefined} />
            {e.email && <span className={styles.erro}>{e.email}</span>}
          </label>
          <label>
            Telefone
            <input name="telefone" type="tel" aria-invalid={e.telefone ? true : undefined} />
            {e.telefone && <span className={styles.erro}>{e.telefone}</span>}
          </label>
        </div>
        <label className={styles.check}>
          <input type="checkbox" name="recebeRelatorios" />
          Recebe cópia dos relatórios
        </label>
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>
            Adicionar representante
          </button>
        </div>
      </form>
    </section>
  );
}
