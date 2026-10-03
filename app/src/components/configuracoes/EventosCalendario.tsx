"use client";

import { useActionState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import type { EstadoEvento } from "@/calendario/acoes";
import { centesimosParaMultiplicador, dataBr, type Evento } from "@/calendario/regras-config";
import styles from "../formularios.module.css";

type Imovel = { id: string; codigo: string };
type Props = { eventos: Evento[]; imoveis: Imovel[]; criar: (a: EstadoEvento, f: FormData) => Promise<EstadoEvento>; remover: (f: FormData) => Promise<void> };
const nota = { fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 };

/** Temporadas e eventos com multiplicador do preço base e mínimo de noites (alta temporada, Réveillon, Carnaval, Rock in Rio). */
export function EventosCalendario({ eventos, imoveis, criar, remover }: Props) {
  const [estado, enviar, enviando] = useActionState(criar, {});
  const v = estado.valores ?? {};
  const texto = (k: string) => String(v[k] ?? "");
  const nomes = (e: Evento) => (e.todosImoveis ? "todos" : e.imoveis.map((id) => imoveis.find((i) => i.id === id)?.codigo ?? "?").join(", ") || "nenhum");
  return <section aria-label="Temporadas e eventos" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 820 }}>
    <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Temporadas e eventos</h2>
    <p style={nota}>Multiplicam o preço base nas noites do evento (vale o maior multiplicador, nunca a soma) e podem exigir mínimo de noites. Preço explícito de um período no cadastro do imóvel substitui o evento. Cadastre as datas de cada ano (alta temporada 15/12 ao fim de fevereiro, Réveillon 25/12 a 1/1, Carnaval, Rock in Rio) depois de confirmá-las.</p>
    {eventos.length > 0 && <div className={styles.rolagem}><table className={styles.tabela}>
      <thead><tr><th>Evento</th><th>Noites</th><th className={styles.numero}>Multiplicador</th><th className={styles.numero}>Mínimo</th><th>Imóveis</th><th /></tr></thead>
      <tbody>{eventos.map((e) => <tr key={e.id}>
        <td>{e.nome}</td><td>{dataBr(e.inicio)} a {dataBr(e.fim)}</td><td className={styles.numero}>{centesimosParaMultiplicador(e.multiplicador)}×</td><td className={styles.numero}>{e.estadiaMinima === null ? "—" : `${e.estadiaMinima} noite(s)`}</td><td>{nomes(e)}</td>
        <td><form action={remover}><input type="hidden" name="id" value={e.id} /><BotaoConfirmar className={styles.pequeno} pergunta={`Excluir o evento "${e.nome}"?`}>Excluir</BotaoConfirmar></form></td>
      </tr>)}</tbody>
    </table></div>}
    <form key={eventos.length} action={enviar} className={styles.form} aria-label="Novo evento">
      <div className={styles.linha}>
        <label className={styles.largo}>Nome<input name="nome" required maxLength={60} placeholder="ex.: Carnaval 2027" defaultValue={texto("nome")} /></label>
        <label>Primeira noite<input name="inicio" type="date" required defaultValue={texto("inicio")} /></label>
        <label>Última noite<input name="fim" type="date" required defaultValue={texto("fim")} /></label>
      </div>
      <div className={styles.linha}>
        <label>Multiplicador do preço base<input name="multiplicador" inputMode="decimal" required placeholder="ex.: 4" defaultValue={texto("multiplicador")} /></label>
        <label>Mínimo de noites<input name="estadiaMinima" type="number" min={1} max={30} placeholder="em branco = o normal" defaultValue={texto("estadiaMinima")} /></label>
      </div>
      <label className={styles.check}><input type="checkbox" name="todosImoveis" defaultChecked={v.todosImoveis === "on"} /> Todos os imóveis</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
        {imoveis.map((i) => <label key={i.id} className={styles.check} style={{ flex: "0 0 auto", minWidth: 0 }}><input type="checkbox" name="imoveis" value={i.id} defaultChecked={((v.imoveis as string[] | undefined) ?? []).includes(i.id)} /> {i.codigo}</label>)}
      </div>
      {estado.erro && <p role="alert" className={styles.alerta}>{estado.erro}</p>}
      {estado.ok && <p role="status" className={styles.sucesso}>Evento adicionado.</p>}
      <div className={styles.acoes}><button type="submit" disabled={enviando}>{enviando ? "Salvando…" : "Adicionar evento"}</button></div>
    </form>
  </section>;
}
