"use client";

import { useActionState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { novoBloqueioAcao, removerBloqueioAcao, type EstadoBloqueio } from "@/calendario/acoes";
import styles from "../formularios.module.css";

type Imovel = { id: string; codigo: string };
type Bloqueio = { id: string; imovelId: string; inicio: string; fim: string; motivo: string; fonte: string };
const dataBr = (d: string) => d.split("-").reverse().join("/");

/** Bloqueios manuais do período visível. Os importados do Beds24 aparecem, mas mudam na origem. */
export function Bloqueios({ imoveis, bloqueios }: { imoveis: Imovel[]; bloqueios: Bloqueio[] }) {
  const [estado, enviar, enviando] = useActionState(novoBloqueioAcao, {} as EstadoBloqueio);
  const v = estado.valores ?? {};
  return <section aria-label="Bloqueios manuais" style={{ display: "grid", gap: 12, maxWidth: 820 }}>
    <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Bloquear datas</h2>
    <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 }}>
      Uso próprio, manutenção ou qualquer motivo para não vender. O bloqueio vale no SCL na hora e segue ao Beds24 (e às OTAs) no próximo envio de calendário, quando o envio estiver ligado. Remover o bloqueio reabre as datas no próximo envio.
    </p>
    {bloqueios.length > 0 && <div className={styles.rolagem}><table className={styles.tabela}>
      <caption>Bloqueios no mês visível</caption>
      <thead><tr><th>Imóvel</th><th>Primeira noite</th><th>Liberado em</th><th>Motivo</th><th>Origem</th><th /></tr></thead>
      <tbody>{bloqueios.map(b => <tr key={b.id}>
        <td>{imoveis.find(i => i.id === b.imovelId)?.codigo ?? "—"}</td>
        <td>{dataBr(b.inicio)}</td>
        <td>{dataBr(b.fim)}</td>
        <td>{b.motivo || "—"}</td>
        <td>{b.fonte === "beds24" ? "Beds24 (mude lá)" : "SCL"}</td>
        <td>{b.fonte !== "beds24" && <form action={removerBloqueioAcao}><input type="hidden" name="id" value={b.id} /><BotaoConfirmar className={styles.pequeno} pergunta={`Remover o bloqueio de ${dataBr(b.inicio)} a ${dataBr(b.fim)}? As datas voltam a ficar à venda no próximo envio.`}>Remover</BotaoConfirmar></form>}</td>
      </tr>)}</tbody>
    </table></div>}
    <form key={bloqueios.length} action={enviar} className={styles.form} aria-label="Novo bloqueio">
      <div className={styles.linha}>
        <label>Imóvel<select name="imovelId" required defaultValue={v.imovelId ?? ""}><option value="" disabled>Escolha</option>{imoveis.map(i => <option key={i.id} value={i.id}>{i.codigo}</option>)}</select></label>
        <label>Primeira noite bloqueada<input type="date" name="inicio" required defaultValue={v.inicio} /></label>
        <label>Liberado a partir de<input type="date" name="fim" required defaultValue={v.fim} /></label>
        <label className={styles.largo}>Motivo<input name="motivo" maxLength={120} placeholder="ex.: uso do proprietário" defaultValue={v.motivo} /></label>
      </div>
      {estado.erro && <p role="alert" className={styles.alerta}>{estado.erro}</p>}
      {estado.ok && <p role="status" className={styles.sucesso}>Bloqueio salvo.</p>}
      <div className={styles.acoes}><button type="submit" disabled={enviando || !imoveis.length}>{enviando ? "Salvando…" : "Bloquear"}</button></div>
    </form>
  </section>;
}
