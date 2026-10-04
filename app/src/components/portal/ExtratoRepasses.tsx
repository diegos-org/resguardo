import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { formatBRL } from "@/lib/money";
import { NOMES_SITUACAO_EMAIL } from "@/repasses/email";
import { NOMES_SITUACAO_PARTE, type Parte, resumirPartes } from "@/repasses/extrato";
import { NOMES_PERIODICIDADE, PERIODICIDADES, type PeriodicidadeRepasse, type RegrasRepasses } from "@/repasses/periodicidade";
import type { PeriodicidadeDoDono } from "@/repasses/proprietario";
import { type ItemDoRepasse, nomeMes, type Repasse, descricaoDoItem } from "@/repasses/repasses";

type Props = {
  donos: readonly { id: string; nome: string }[];
  periodicidades: readonly PeriodicidadeDoDono[];
  partes: readonly Parte[];
  repasses: readonly Repasse[];
  /** Reservas que cada repasse cobriu (por id do repasse): o detalhe oficial do que foi pago. */
  itens: Readonly<Record<string, readonly ItemDoRepasse[]>>;
  regras: RegrasRepasses;
  hoje: string;
  empresa: string;
  escolher: (form: FormData) => Promise<void>;
  pedir: (form: FormData) => Promise<void>;
  mensagem?: { tipo: "ok" | "erro"; texto: string } | null;
};

const dataBr = (d: string) => d.split("-").reverse().join("/");
const caixa: React.CSSProperties = { background: "var(--scl-papel)", border: "1px solid var(--scl-borda)", borderRadius: 8, padding: 16 };
const rotulo: React.CSSProperties = { color: "var(--scl-texto-2)", fontSize: "0.875rem" };
const celula: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--scl-areia)", whiteSpace: "nowrap" };
const botao: React.CSSProperties = { font: "inherit", padding: "8px 16px", borderRadius: 6, border: 0, background: "var(--scl-musgo)", color: "var(--scl-branco)", cursor: "pointer" };

export function nomeDoRepasseNoPortal(r: Pick<Repasse, "tipo" | "mes" | "data" | "pedidoEm">): string {
  if (r.tipo === "fechamento") return `Fechamento de ${nomeMes(r.mes.slice(0, 7))}`;
  return `Repasse de ${dataBr(r.data)}${r.pedidoEm ? " (pedido por você)" : ""}`;
}

export function situacaoNoPortal(r: Pick<Repasse, "situacao" | "dataPagamento" | "estornadoEm">): string {
  // Estornado fica no histórico: as reservas dele voltam ao extrato (disponível ou a liberar) e entram no próximo repasse.
  if (r.situacao === "estornado") return `Estornado pela empresa${r.estornadoEm ? ` em ${r.estornadoEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}: as reservas voltaram ao extrato`;
  return r.situacao === "pago" ? `Pago em ${dataBr(r.dataPagamento!)}` : "A pagar pela empresa";
}

/** Uma linha por reserva coberta pelo repasse (integral ou a parte de um mês). */
export function textoDoItemNoPortal(i: ItemDoRepasse): string {
  return `${i.codigoImovel} · ${i.hospede || i.codigoReserva} · ${dataBr(i.checkin)} → ${dataBr(i.checkout)} · ${formatBRL(i.valor)} (${descricaoDoItem(i)})`;
}

/** Seção "Extrato e repasses" do portal (M4.10): como quer receber, a parte de cada reserva e os repasses. */
export function ExtratoRepasses({ donos, periodicidades, partes, repasses, itens, regras, hoje, empresa, escolher, pedir, mensagem }: Props) {
  const resumo = resumirPartes(partes);
  const diaPrimeiro = hoje.endsWith("-01");
  // Disponível por proprietário: o botão de pedir só aparece para quem tem valor a repassar.
  const disponivelPorDono = new Map<string, number>();
  for (const p of partes) if (p.situacao === "disponivel") disponivelPorDono.set(p.proprietarioId, (disponivelPorDono.get(p.proprietarioId) ?? 0) + p.valor);
  const comDisponivel = donos.filter((d) => (disponivelPorDono.get(d.id) ?? 0) > 0);
  return (
    <section id="repasses" aria-label="Extrato e repasses" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Extrato e repasses</h2>
      {mensagem && (
        <p role={mensagem.tipo === "erro" ? "alert" : "status"} style={{ margin: 0, padding: 12, borderRadius: 6, background: mensagem.tipo === "erro" ? "var(--scl-erro-fundo)" : "var(--scl-ok-fundo)", color: mensagem.tipo === "erro" ? "var(--scl-erro-texto)" : "var(--scl-ok)" }}>
          {mensagem.texto}
        </p>
      )}

      <div style={{ ...caixa, display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ fontSize: "1rem", margin: 0 }}>Como você quer receber</h3>
        <p style={{ ...rotulo, margin: 0 }}>
          Sua parte de cada reserva fica <strong>disponível</strong> no dia seguinte ao check-in, assim que o dinheiro do canal estiver com a {empresa}. O repasse reúne tudo o que está disponível na data dele. O mensal (dia 1º) é o padrão e o intervalo máximo; o fechamento do dia 1º
          acerta também despesas e adiantamentos. A escolha vale a partir do próximo repasse.
        </p>
        {donos.map((d) => {
          const p = periodicidades.find((x) => x.proprietarioId === d.id);
          if (!p) return null;
          return (
            <form key={d.id} action={escolher} style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }} aria-label={`Periodicidade de ${d.nome}`}>
              <input type="hidden" name="proprietarioId" value={d.id} />
              <label style={{ display: "flex", flexDirection: "column", gap: 4, ...rotulo }}>
                {donos.length > 1 ? `${d.nome}: periodicidade` : "Periodicidade"}
                <select name="periodicidade" defaultValue={p.escolha ?? ""} style={{ font: "inherit", padding: 6 }}>
                  <option value="">Padrão do contrato ({NOMES_PERIODICIDADE[p.efetiva]})</option>
                  {PERIODICIDADES.map((x: PeriodicidadeRepasse) => (
                    <option key={x} value={x}>
                      {NOMES_PERIODICIDADE[x]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" style={botao}>
                Salvar
              </button>
              <span style={{ ...rotulo, flexBasis: "100%" }}>
                Hoje: {p.descricao}. Próximo repasse previsto: <strong>{dataBr(p.proximaData)}</strong>.
                {p.efetiva === "semanal" ? ` (${regras.diaSemanal === 1 ? "segundas" : "dia configurado pela empresa"})` : ""}
              </span>
            </form>
          );
        })}
      </div>

      <section aria-label="Resumo do extrato" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        {[
          ["Disponível para o próximo repasse", resumo.disponivel],
          ["A liberar", resumo.aLiberar],
          ["Em repasse a pagar", resumo.repassadoAPagar],
          ["Já repassado (pago)", resumo.repassadoPago],
          ...(resumo.ajusteNoFechamento !== 0 ? [["Diferença de recálculo (acertada pelo fechamento mensal)", resumo.ajusteNoFechamento] as const] : []),
        ].map(([t, v]) => (
          <div key={t} style={caixa}>
            <div style={rotulo}>{t}</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>{formatBRL(Number(v))}</div>
          </div>
        ))}
      </section>

      {comDisponivel.length > 0 && diaPrimeiro && <p style={{ ...rotulo, margin: 0 }}>Hoje é dia 1º: o fechamento do mês é o repasse do dia e inclui o que está disponível.</p>}
      {comDisponivel.length > 0 && !diaPrimeiro && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {comDisponivel.map((d) => {
            const dele = disponivelPorDono.get(d.id) ?? 0;
            return (
              <form key={d.id} action={pedir}>
                <input type="hidden" name="proprietarioId" value={d.id} />
                <BotaoConfirmar pergunta={`Pedir agora o repasse de ${formatBRL(dele)}${donos.length > 1 ? ` para ${d.nome}` : ""} (o que está disponível até ontem)? A ${empresa} faz o Pix e você recebe o comprovante por e-mail.`} style={botao}>
                  Pedir repasse agora ({formatBRL(dele)}{donos.length > 1 ? ` · ${d.nome}` : ""})
                </BotaoConfirmar>
              </form>
            );
          })}
        </div>
      )}

      <div style={{ overflowX: "auto", ...caixa, padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }} aria-label="Sua parte em cada reserva">
          <thead>
            <tr style={{ textAlign: "left", color: "var(--scl-texto-2)" }}>
              {["Imóvel", "Reserva", "Estadia", "Mês", "Sua parte", "Situação", "Detalhe"].map((c) => (
                <th key={c} scope="col" style={celula}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {partes.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...celula, whiteSpace: "normal" }}>
                  Nenhuma parte de reserva neste período.
                </td>
              </tr>
            )}
            {partes.map((p) => (
              <tr key={p.lancamentoId}>
                <td style={celula}>{p.codigoImovel}</td>
                <td style={celula}>{p.hospede || p.codigoReserva}</td>
                <td style={celula}>
                  {dataBr(p.checkin)} → {dataBr(p.checkout)}
                </td>
                <td style={celula}>{nomeMes(p.competencia.slice(0, 7))}</td>
                <td style={{ ...celula, fontVariantNumeric: "tabular-nums" }}>{formatBRL(p.valor)}</td>
                <td style={celula}>
                  <strong>{NOMES_SITUACAO_PARTE[p.situacao]}</strong>
                </td>
                <td style={{ ...celula, whiteSpace: "normal", minWidth: 220 }}>{p.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ overflowX: "auto", ...caixa, padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }} aria-label="Repasses">
          <thead>
            <tr style={{ textAlign: "left", color: "var(--scl-texto-2)" }}>
              {["Repasse", "Valor", "Reservas", "Situação", "Comprovante", "E-mail"].map((c) => (
                <th key={c} scope="col" style={celula}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {repasses.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...celula, whiteSpace: "normal" }}>
                  Nenhum repasse neste período.
                </td>
              </tr>
            )}
            {repasses.map((r) => {
              const dele = itens[r.id] ?? [];
              return (
                <tr key={r.id}>
                  <td style={celula}>{nomeDoRepasseNoPortal(r)}</td>
                  <td style={{ ...celula, fontVariantNumeric: "tabular-nums" }}>{formatBRL(r.valor)}</td>
                  <td style={{ ...celula, whiteSpace: "normal", minWidth: 220 }}>
                    {dele.length === 0 ? (
                      r.tipo === "fechamento" ? "sem detalhe por reserva (fechamento antigo)" : "—"
                    ) : (
                      <details>
                        <summary style={{ cursor: "pointer" }}>{dele.length === 1 ? "1 reserva" : `${dele.length} reservas`}</summary>
                        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                          {dele.map((i) => (
                            <li key={i.id}>{textoDoItemNoPortal(i)}</li>
                          ))}
                        </ul>
                        {r.tipo === "fechamento" && <p style={{ ...rotulo, margin: "6px 0 0" }}>O fechamento também acerta despesas e adiantamentos do mês, por isso o valor pode diferir da soma das reservas.</p>}
                      </details>
                    )}
                  </td>
                  <td style={{ ...celula, whiteSpace: "normal" }}>{situacaoNoPortal(r)}</td>
                  <td style={{ ...celula, whiteSpace: "normal" }}>
                    {r.situacao !== "pago" ? "—" : r.comprovante || r.comprovanteArquivoId ? (
                      <>
                        {r.comprovante && <code>{r.comprovante}</code>}
                        {r.comprovante && r.comprovanteArquivoId && " · "}
                        {r.comprovanteArquivoId && <a href={`/portal/repasses/${r.id}/comprovante`}>abrir comprovante</a>}
                      </>
                    ) : (
                      "ainda não registrado pela empresa"
                    )}
                  </td>
                  <td style={{ ...celula, whiteSpace: "normal" }}>{r.situacao === "pago" ? NOMES_SITUACAO_EMAIL[r.emailSituacao] : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ ...rotulo, margin: 0 }}>
        &ldquo;Paga pelo canal&rdquo; é a reserva em que o canal transfere sua parte direto a você (ex.: Airbnb): aparece só como informação. &ldquo;A liberar&rdquo; traz o motivo. O fechamento do dia 1º continua acertando despesas e adiantamentos do mês.
      </p>
    </section>
  );
}
