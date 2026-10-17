"use client";

import { useActionState, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { type EstadoWhatsapp, salvarQuemVeConversasAcao } from "@/whatsapp/acoes";
import type { QuemVeConversas } from "@/whatsapp/configuracao";

const OPCOES: { valor: QuemVeConversas; rotulo: string }[] = [
  { valor: "so_admin", rotulo: "Só o admin (padrão)" },
  { valor: "admin_e_operacao", rotulo: "Admin e operação" },
];

export const PERGUNTA_LIBERAR_OPERACAO = "A operação vai passar a ver todas as conversas do WhatsApp, inclusive com proprietários e interessados. Confirmar?";

/**
 * Integrações → WhatsApp → "Quem vê as conversas" (M10.1a, decisão de Diego em 17/10: padrão só o admin). Recebe só o
 * valor atual. Todo envio de "Admin e operação" passa pela confirmação, sem exceção (desenho 6.8): a tela não decide
 * pelo valor que recebeu, que pode estar velho (outra aba ou outro admin já voltou para "só o admin"). Voltar para "só o
 * admin" não precisa. Quem decide o acesso em todas as telas é `whatsapp/acesso.ts`, que lê o valor salvo aqui.
 */
export function FormQuemVeConversas({ quemVe }: { quemVe: QuemVeConversas }) {
  const [estado, enviar, enviando] = useActionState<EstadoWhatsapp, FormData>(salvarQuemVeConversasAcao, {});
  // Os rádios são controlados por `escolhido`, que recomeça do valor salvo sempre que ele muda (depois de salvar, ou de
  // outra aba). O ajuste é feito na renderização, sem remontar o componente: a resposta da ação ("Salvo.") fica na tela.
  const [escolhido, escolher] = useState<QuemVeConversas>(quemVe);
  const [salvo, guardarSalvo] = useState<QuemVeConversas>(quemVe);
  if (salvo !== quemVe) {
    guardarSalvo(quemVe);
    escolher(quemVe);
  }
  const liberando = escolhido === "admin_e_operacao";
  const rotulo = enviando ? "Salvando…" : "Salvar";
  return (
    <form action={enviar} className={styles.form} aria-label="Quem vê as conversas">
      <h3 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 500 }}>Quem vê as conversas</h3>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <legend className="scl-so-leitor">Quem vê as conversas</legend>
        {OPCOES.map((o) => (
          <label key={o.valor} className={styles.check}>
            <input type="radio" name="quemVe" value={o.valor} checked={escolhido === o.valor} onChange={() => escolher(o.valor)} />
            {o.rotulo}
          </label>
        ))}
      </fieldset>
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>Proprietários e equipe de limpeza nunca veem as conversas.</p>
      {estado.mensagem && (
        <p role={estado.ok ? "status" : "alert"} className={estado.ok ? styles.sucesso : styles.alerta} style={{ margin: 0 }}>
          {estado.mensagem}
        </p>
      )}
      <div className={styles.acoes}>
        {liberando ? (
          <BotaoConfirmar pergunta={PERGUNTA_LIBERAR_OPERACAO} disabled={enviando}>
            {rotulo}
          </BotaoConfirmar>
        ) : (
          <button type="submit" disabled={enviando}>
            {rotulo}
          </button>
        )}
      </div>
    </form>
  );
}
