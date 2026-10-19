"use client";

import { useActionState } from "react";
import styles from "@/components/formularios.module.css";
import { type EstadoWhatsapp, salvarIdsWhatsappAcao } from "@/whatsapp/acoes";

/**
 * Integrações → WhatsApp → "Identificação na Meta" (M10.1a): os ids da conta do WhatsApp Business (WABA) e do número,
 * que a rota do aviso usa para achar a empresa e conferir o número. Recebe só os dois ids (nada do ambiente). Sem "Id do
 * app": nada do M10.1a o usa (o M10.1b acrescenta). Campo vazio apaga o id.
 */
export function FormIdsWhatsapp({ wabaId, numeroId }: { wabaId: string | null; numeroId: string | null }) {
  const [estado, enviar, enviando] = useActionState<EstadoWhatsapp, FormData>(salvarIdsWhatsappAcao, {});
  const valor = (k: "wabaId" | "numeroId", atual: string | null) => estado.valores?.[k] ?? atual ?? "";
  return (
    <form key={`${wabaId ?? ""}|${numeroId ?? ""}`} action={enviar} className={styles.form} aria-label="Identificação na Meta">
      <h3 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 500 }}>Identificação na Meta</h3>
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>Números do painel de desenvolvedores da Meta. Não são senhas. Ficam só aqui, no banco do sistema.</p>
      <div className={styles.linha}>
        <label>
          Id da conta do WhatsApp Business (WABA)
          <input name="wabaId" inputMode="numeric" autoComplete="off" maxLength={25} defaultValue={valor("wabaId", wabaId)} aria-invalid={estado.ok === false ? true : undefined} />
        </label>
        <label>
          Id do número (phone number id)
          <input name="numeroId" inputMode="numeric" autoComplete="off" maxLength={25} defaultValue={valor("numeroId", numeroId)} aria-invalid={estado.ok === false ? true : undefined} />
        </label>
      </div>
      {estado.mensagem && (
        <p role={estado.ok ? "status" : "alert"} className={estado.ok ? styles.sucesso : styles.alerta} style={{ margin: 0 }}>
          {estado.mensagem}
        </p>
      )}
      <div className={styles.acoes}>
        <button type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}
