"use client";

import { useActionState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import type { EstadoDecisao } from "@/marketplace/acoes";
import styles from "../formularios.module.css";

type Acao = (a: EstadoDecisao, f: FormData) => Promise<EstadoDecisao>;

/** Aprovar (com o código do imóvel) ou recusar (com motivo) um cadastro marketplace (M12.3). */
export function DecisaoCadastro({ id, nome, aprovar, recusar }: { id: string; nome: string; aprovar: Acao; recusar: Acao }) {
  const [ea, fa, aprovando] = useActionState(aprovar, {});
  const [er, fr, recusando] = useActionState(recusar, {});
  const feito = ea.ok ?? er.ok;
  if (feito)
    return (
      <div role="status" className={styles.sucesso} style={{ display: "grid", gap: 6 }}>
        <span>{feito}</span>
        {ea.link && (
          <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ wordBreak: "break-all" }}>{ea.link}</code>
            <BotaoCopiar texto={ea.link} rotulo="Copiar link" />
          </span>
        )}
      </div>
    );
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <form action={fa} className={styles.linha} aria-label={`Aprovar cadastro de ${nome}`}>
        <input type="hidden" name="id" value={id} />
        <label>
          Código do imóvel no sistema
          <input name="codigo" required maxLength={20} placeholder="ex.: ipa-100" />
        </label>
        <BotaoConfirmar
          disabled={aprovando}
          pergunta={`Aprovar o cadastro de ${nome}? Isso cria o proprietário, o imóvel (ainda não público) e manda o convite do portal.`}
        >
          Aprovar
        </BotaoConfirmar>
      </form>
      {ea.erro && <p className={styles.alerta}>{ea.erro}</p>}
      <form action={fr} className={styles.linha} aria-label={`Recusar cadastro de ${nome}`}>
        <input type="hidden" name="id" value={id} />
        <label className={styles.largo}>
          Motivo da recusa (fica registrado)
          <input name="motivo" required maxLength={500} />
        </label>
        <BotaoConfirmar disabled={recusando} className={styles.pequeno} style={{ background: "var(--scl-papel)", color: "var(--scl-erro-texto)" }} pergunta={`Recusar o cadastro de ${nome}?`}>
          Recusar
        </BotaoConfirmar>
      </form>
      {er.erro && <p className={styles.alerta}>{er.erro}</p>}
    </div>
  );
}
