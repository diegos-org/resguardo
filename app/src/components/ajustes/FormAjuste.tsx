"use client";

import { useActionState } from "react";
import type { EstadoAjuste } from "@/ajustes/acoes";
import styles from "../formularios.module.css";

type Props = {
  salvar: (a: EstadoAjuste, f: FormData) => Promise<EstadoAjuste>;
  imoveis: { id: string; codigo: string; nome: string }[];
  origens: Record<string, string>;
  direcoes: Record<string, string>;
  inicial: Record<string, string>;
};

export function FormAjuste({ salvar, imoveis, origens, direcoes, inicial }: Props) {
  const [estado, enviar, enviando] = useActionState(salvar, {});
  const v = (k: string) => estado.valores?.[k] ?? inicial[k] ?? "";
  const erro = (k: string) => {
    const m = estado.erros?.[k as keyof typeof estado.erros];
    return m ? <span className={styles.erro}>{m}</span> : null;
  };
  return (
    <form action={enviar} className={styles.form} aria-label="Ajuste">
      {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      <div className={styles.linha}>
        <label>
          Data
          <input type="date" name="data" defaultValue={v("data")} required />
          {erro("data")}
        </label>
        <label>
          Reserva (código, opcional)
          <input name="codigoReserva" defaultValue={v("codigoReserva")} placeholder="SCL-AB12" />
          {erro("reservaId")}
        </label>
        <label>
          Imóvel (se não houver reserva)
          <select name="imovelId" defaultValue={v("imovelId")}>
            <option value="">—</option>
            {imoveis.map((i) => (
              <option key={i.id} value={i.id}>
                {i.codigo} · {i.nome}
              </option>
            ))}
          </select>
          {erro("imovelId")}
        </label>
      </div>
      <label>
        Efeito
        <select name="direcao" defaultValue={v("direcao") || "empresa_saida"}>
          {Object.entries(direcoes).map(([k, t]) => (
            <option key={k} value={k}>
              {t}
            </option>
          ))}
        </select>
        {erro("direcao")}
        {erro("proprietarioId")}
      </label>
      <div className={styles.linha}>
        <label>
          Valor (R$)
          <input name="valor" inputMode="decimal" defaultValue={v("valor")} placeholder="em branco = ainda não se sabe" />
          {erro("valor")}
        </label>
        <label>
          Origem
          <select name="origem" defaultValue={v("origem") || "desconhecida"}>
            {Object.entries(origens).map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
          {erro("origem")}
        </label>
        <label className={styles.check} style={{ alignSelf: "flex-end" }}>
          <input
            type="checkbox"
            name="origemComprovada"
            // Desmarcado não vai no formulário: depois de um erro, ausência = desmarcado (sem voltar ao inicial).
            defaultChecked={estado.valores ? estado.valores.origemComprovada === "on" : inicial.origemComprovada === "on"}
          />{" "}
          Origem comprovada
        </label>
      </div>
      {erro("origemComprovada")}
      <label>
        Motivo (em branco = motivo não identificado)
        <input name="motivo" maxLength={500} defaultValue={v("motivo")} />
        {erro("motivo")}
      </label>
      <label>
        O que foi consultado (obrigatório)
        <textarea name="evidencia" rows={3} maxLength={2000} defaultValue={v("evidencia")} placeholder="ex.: extrato do Airbnb de outubro, painel da reserva, conversa com o hóspede" />
        {erro("evidencia")}
      </label>
      <label>
        Comprovante (link ou referência, opcional)
        <input name="comprovante" maxLength={500} defaultValue={v("comprovante")} />
        {erro("comprovante")}
      </label>
      <div className={styles.acoes}>
        <button type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}
