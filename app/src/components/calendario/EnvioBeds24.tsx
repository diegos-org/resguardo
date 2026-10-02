"use client";

import Link from "next/link";
import { useActionState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { enviarCalendarioAcao, type EstadoEnvio } from "@/calendario/acoes";
import { nomeSituacaoEnvio } from "@/calendario/envio";
import styles from "../formularios.module.css";

type Props = { imovelId: string; codigo: string; escritaLigada: boolean; envioLigado: boolean; vinculoOk: boolean; horizonteDias: number };
const inicial: EstadoEnvio = {};

function Resultado({ estado }: { estado: EstadoEnvio }) {
  if (estado.erro) return <p role="alert" className={styles.erro}>{estado.erro}</p>;
  const r = estado.resultado;
  if (!r) return null;
  return <div role="status" aria-live="polite">
    <p className={r.ok ? styles.sucesso : styles.alerta}><strong>{nomeSituacaoEnvio(r.situacao)}.</strong> {r.mensagem}</p>
    {r.imoveis.length > 0 && <ul>{r.imoveis.map(i => <li key={i.imovelId}>Imóvel {i.codigo}: {i.resumo.noites} noite(s) no horizonte · {i.resumo.enviar} a enviar · {i.resumo.iguais} já iguais · {i.resumo.ocupadas} ocupada(s){r.situacao !== "simulacao" && ` · ${i.enviadas} enviada(s), ${i.confirmadas} confirmada(s), ${i.divergentes} divergente(s)`}{i.falha && ` · falha: ${i.falha}`}</li>)}</ul>}
    {r.avisos.length > 0 && <details><summary>Avisos ({r.totalAvisos}{r.totalAvisos > r.avisos.length ? `, mostrando ${r.avisos.length}` : ""})</summary><ul>{r.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
  </div>;
}

/** Simular nunca grava; enviar exige BEDS24_ESCRITA, envio ligado por imóvel e confirmação explícita. */
export function EnvioBeds24({ imovelId, codigo, escritaLigada, envioLigado, vinculoOk, horizonteDias }: Props) {
  const [simulacao, simular, simulando] = useActionState(enviarCalendarioAcao, inicial);
  const [envio, enviar, enviando] = useActionState(enviarCalendarioAcao, inicial);
  const pronto = escritaLigada && envioLigado && vinculoOk;
  return <section aria-label="Envio ao Beds24" style={{ display: "grid", gap: 12 }}>
    <h3>Envio ao Beds24 — imóvel {codigo}</h3>
    <ul>
      <li>Sinal de escrita na Vercel (BEDS24_ESCRITA): <strong>{escritaLigada ? "ligado" : "desligado"}</strong>. {!escritaLigada && "Só o Diego liga, depois de conferir a simulação."}</li>
      <li>Envio deste imóvel: <strong>{envioLigado ? "ligado" : "desligado"}</strong> em <Link href="/painel/configuracoes/calendario">Configurações → Calendário e preços</Link>.</li>
      <li>Vínculo Beds24: <strong>{vinculoOk ? "um quarto vinculado" : "ausente ou duplicado"}</strong> (<Link href="/painel/configuracoes/integracoes">Integrações</Link>).</li>
      <li>O envio cobre as próximas {horizonteDias} noites a partir de hoje, não só o intervalo desta tela. Só vão as noites diferentes do que o Beds24 já tem; reservas nunca são criadas ou alteradas.</li>
    </ul>
    <form action={simular} className={styles.form} aria-label="Simular envio">
      <input type="hidden" name="imovelId" value={imovelId} />
      <input type="hidden" name="modo" value="simulacao" />
      <div className={styles.acoes}><button type="submit" disabled={simulando || enviando || !envioLigado || !vinculoOk}>{simulando ? "Simulando…" : "Simular envio (não grava nada)"}</button></div>
      <Resultado estado={simulacao} />
    </form>
    <form action={enviar} className={styles.form} aria-label="Enviar ao Beds24">
      <input type="hidden" name="imovelId" value={imovelId} />
      <input type="hidden" name="modo" value="envio" />
      <label className={styles.check}><input type="checkbox" name="confirmo" required disabled={!pronto} />Conferi a prévia e a simulação e quero enviar as próximas {horizonteDias} noites deste imóvel ao Beds24.</label>
      <div className={styles.acoes}>
        <BotaoConfirmar pergunta={`Enviar calendário e preços do imóvel ${codigo} ao Beds24 agora? O Beds24 repassa às OTAs.`} disabled={enviando || simulando || !pronto}>{enviando ? "Enviando… aguarde" : "Enviar agora ao Beds24"}</BotaoConfirmar>
      </div>
      {!pronto && <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 }}>Enviar fica disponível quando o sinal de escrita, o envio deste imóvel e o vínculo estiverem prontos.</p>}
      <Resultado estado={envio} />
    </form>
  </section>;
}
