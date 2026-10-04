"use client";

import { useActionState, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import type { EstadoPeriodo } from "@/imoveis/acoes";
import type { FontePrecos } from "@/imoveis/fonte-precos";
import { cotarEstadia, type Periodo, type RegrasVenda, verificarEstadia } from "@/imoveis/regras-venda";
import styles from "../formularios.module.css";

const brl = (c: number | null) => (c === null ? "—" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dataBr = (d: string) => d.split("-").reverse().join("/");

type Props = {
  imovelId: string;
  periodos: (Periodo & { id: string })[];
  criar: (a: EstadoPeriodo, f: FormData) => Promise<EstadoPeriodo>;
  excluir: (f: FormData) => Promise<void>;
  /** Preços definidos no Beds24 (M3.9): o período só leva estadia mínima — o campo de preço nem aparece. */
  semPreco?: boolean;
};

/** Exceções por período: preço da noite e/ou estadia mínima diferentes (Réveillon, Carnaval…). */
export function Periodos({ imovelId, periodos, criar, excluir, semPreco = false }: Props) {
  const [estado, enviar, enviando] = useActionState(criar, {});
  const v = estado.valores ?? {};
  return (
    <section aria-label="Períodos especiais" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: "1.25rem" }}>Períodos especiais</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 }}>
        {semPreco
          ? "Estadia mínima diferente em datas específicas. As datas são das noites (a primeira e a última noite do período). O preço da noite é definido no Beds24, então aqui o período não tem preço."
          : "Preço da noite e/ou estadia mínima diferentes em datas específicas. As datas são das noites (a primeira e a última noite do período). O preço explícito do período é preservado, mesmo fora dos limites gerais do preço base."}
      </p>
      {periodos.length > 0 && (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Período</th>
                <th>Noites</th>
                <th className={styles.numero}>Preço da noite</th>
                <th className={styles.numero}>Estadia mínima</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {periodos.map((p) => (
                <tr key={p.id}>
                  <td>{p.nome}</td>
                  <td>
                    {dataBr(p.inicio)} a {dataBr(p.fim)}
                  </td>
                  <td className={styles.numero}>{p.precoNoite === null ? "preço base" : brl(p.precoNoite)}</td>
                  <td className={styles.numero}>{p.estadiaMinima === null ? "a geral" : `${p.estadiaMinima} noite(s)`}</td>
                  <td>
                    <form action={excluir}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="imovelId" value={imovelId} />
                      <BotaoConfirmar className={styles.pequeno} pergunta={`Excluir o período "${p.nome}"?`}>
                        Excluir
                      </BotaoConfirmar>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form key={periodos.length} action={enviar} className={styles.form} aria-label="Novo período especial">
        <input type="hidden" name="imovelId" value={imovelId} />
        <div className={styles.linha}>
          <label className={styles.largo}>
            Nome
            <input name="nome" required maxLength={60} placeholder="ex.: Réveillon" defaultValue={v.nome} />
          </label>
          <label>
            Primeira noite
            <input name="inicio" type="date" required defaultValue={v.inicio} />
          </label>
          <label>
            Última noite
            <input name="fim" type="date" required defaultValue={v.fim} />
          </label>
        </div>
        <div className={styles.linha}>
          {!semPreco && (
            <label>
              Preço da noite (R$)
              <input name="precoNoite" inputMode="decimal" placeholder="em branco = preço base" defaultValue={v.precoNoite} />
            </label>
          )}
          <label>
            Estadia mínima (noites)
            <input name="estadiaMinima" type="number" min={1} max={365} placeholder={semPreco ? "ex.: 5" : "em branco = a geral"} defaultValue={v.estadiaMinima} required={semPreco} />
          </label>
        </div>
        {estado.erro && (
          <p role="alert" className={styles.alerta}>
            {estado.erro}
          </p>
        )}
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>
            Adicionar período
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Simulador: confere regras e valor de uma estadia com o cadastro salvo (nada é gravado). Segue a fonte
 * de preços do imóvel (M3.9): com preços digitados, sem os limites do preço dinâmico; com preços do
 * Beds24, só as regras de estadia — o valor vem da leitura do Beds24 (prévia de calendário e site).
 */
export function Simulador({ regras, periodos, hoje, fontePrecos = "scl" }: { regras: RegrasVenda; periodos: Periodo[]; hoje: string; fontePrecos?: FontePrecos }) {
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [hospedes, setHospedes] = useState("2");
  const pronto = /^\d{4}-\d{2}-\d{2}$/.test(checkin) && /^\d{4}-\d{2}-\d{2}$/.test(checkout);
  const regrasDaFonte = fontePrecos === "manual" ? { ...regras, precoDinamico: false } : regras;
  const problemas = pronto ? verificarEstadia(regrasDaFonte, periodos, checkin, checkout, hoje) : [];
  const cot = pronto && checkout > checkin && fontePrecos !== "beds24" ? cotarEstadia(regrasDaFonte, periodos, checkin, checkout, Number(hospedes) || 1) : null;
  return (
    <section aria-label="Simular estadia" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: "1.25rem" }}>Simular uma estadia</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 }}>
        Usa o cadastro salvo acima. Não cria reserva.
        {fontePrecos === "manual" ? " Preços digitados: vale o preço base e os períodos como estão, sem eventos, feriadões, última hora nem os limites do preço dinâmico." : ""}
        {fontePrecos === "beds24" ? " Preços definidos no Beds24: aqui só as regras de estadia são conferidas; o valor da noite é o lido do Beds24 e aparece na prévia de calendário e no site." : ""}
        {fontePrecos === "scl" ? " O valor abaixo é o do cadastro (base, períodos e limites); eventos, feriadões e última hora entram na prévia de calendário." : ""}
      </p>
      <div className={styles.form}>
        <div className={styles.linha}>
          <label>
            Entrada
            <input type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)} />
          </label>
          <label>
            Saída
            <input type="date" value={checkout} onChange={(e) => setCheckout(e.target.value)} />
          </label>
          <label>
            Hóspedes
            <input type="number" min={1} max={50} value={hospedes} onChange={(e) => setHospedes(e.target.value)} />
          </label>
        </div>
        {pronto && (
          <div role="status" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {problemas.length ? (
              <div className={styles.alerta}>
                <strong>Não pode ser vendida assim:</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {problemas.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className={styles.sucesso} style={{ margin: 0 }}>
                Dentro das regras de venda.
              </p>
            )}
            {cot && (
              <table className={styles.tabela}>
                <tbody>
                  <tr>
                    <td>
                      Diárias ({cot.noites.length} noite(s)
                      {cot.noites.some((n) => n.fonte === "periodo") ? `, com ${[...new Set(cot.noites.map((n) => n.periodo).filter(Boolean))].join(", ")}` : ""})
                    </td>
                    <td className={styles.numero}>{brl(cot.diarias)}</td>
                  </tr>
                  <tr>
                    <td>Limpeza</td>
                    <td className={styles.numero}>{brl(cot.limpeza)}</td>
                  </tr>
                  <tr>
                    <td>Hóspede extra</td>
                    <td className={styles.numero}>{brl(cot.hospedeExtra)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td className={styles.numero}>
                      <strong>{cot.total === null ? "pendente" : brl(cot.total)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
            {cot?.avisos.map((a) => (
              <p key={a} style={{ fontSize: "0.875rem", color: "var(--scl-aviso-texto)", margin: 0 }}>
                ⚠ {a}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
