"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { EstadoFormReserva } from "@/reservas/acoes";
import { NOMES_ORIGEM } from "@/reservas/regras";
import styles from "../formularios.module.css";

type Props = {
  acao: (a: EstadoFormReserva, f: FormData) => Promise<EstadoFormReserva>;
  imoveis: { id: string; codigo: string; nome: string }[];
  /** Mostrar os campos de valores (só para quem edita o financeiro). */
  comValores?: boolean;
};

export function FormReserva({ acao, imoveis, comValores = true }: Props) {
  const [estado, enviar, enviando] = useActionState(acao, {});
  const e = estado.erros ?? {};
  const erro = (c: keyof typeof e) => (e[c] ? <span className={styles.erro}>{e[c]}</span> : null);
  const inv = (c: keyof typeof e) => (e[c] ? { "aria-invalid": true } : {});

  return (
    <form action={enviar} className={styles.form} aria-label="Nova reserva">
      {estado.mensagem && (
        <p role="alert" className={styles.alerta}>
          {estado.mensagem}
        </p>
      )}
      <div className={styles.linha}>
        <label>
          Imóvel
          <select name="imovelId" defaultValue="" required {...inv("imovelId")}>
            <option value="" disabled>
              Escolha…
            </option>
            {imoveis.map((i) => (
              <option key={i.id} value={i.id}>
                {i.codigo} · {i.nome}
              </option>
            ))}
          </select>
          {erro("imovelId")}
        </label>
        <label>
          Origem
          <select name="origem" defaultValue="direta" {...inv("origem")}>
            {Object.entries(NOMES_ORIGEM).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          {erro("origem")}
        </label>
        <label>
          Situação
          <select name="estado" defaultValue="confirmada">
            <option value="confirmada">Confirmada</option>
            <option value="pendente">Pendente</option>
          </select>
        </label>
      </div>
      <div className={styles.linha}>
        <label>
          Entrada
          <input type="date" name="checkin" required {...inv("checkin")} />
          {erro("checkin")}
        </label>
        <label>
          Saída
          <input type="date" name="checkout" required {...inv("checkout")} />
          {erro("checkout")}
        </label>
        <label>
          Hóspedes
          <input name="hospedes" type="number" min={1} max={50} inputMode="numeric" {...inv("hospedes")} />
          {erro("hospedes")}
        </label>
      </div>
      <div className={styles.linha}>
        <label>
          Nome do hóspede
          <input name="hospedeNome" />
        </label>
        <label>
          E-mail
          <input name="hospedeEmail" type="email" />
        </label>
        <label>
          Telefone
          <input name="hospedeTelefone" type="tel" />
        </label>
        <label>
          Cidade/país (informado)
          <input name="hospedeOrigem" />
        </label>
      </div>
      {comValores && (
      <div className={styles.linha}>
          <label>
            Valor bruto (R$)
            <input name="valorBruto" inputMode="decimal" placeholder="1.500,00" {...inv("valorBruto")} />
            {erro("valorBruto")}
          </label>
          <label>
            Taxa do canal (R$)
            <input name="taxaCanal" inputMode="decimal" {...inv("taxaCanal")} />
            {erro("taxaCanal")}
          </label>
          <label>
            Líquido recebido (R$)
            <input name="valorLiquido" inputMode="decimal" placeholder="deixe vazio se não souber" {...inv("valorLiquido")} />
            {erro("valorLiquido")}
          </label>
        </div>
      )}
      <div className={styles.linha}>
        <label>
          Código no canal
          <input name="codigoCanal" placeholder="ex.: HM…" />
        </label>
      </div>
      <label>
        Observações
        <textarea name="observacoes" rows={3} />
      </label>
      <div className={styles.acoes}>
        <button type="submit" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar reserva"}
        </button>
        <Link href="/painel/reservas">Cancelar</Link>
      </div>
    </form>
  );
}
