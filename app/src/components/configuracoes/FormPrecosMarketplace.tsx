"use client";

import { useActionState, useState } from "react";
import { reaisParaCentavos } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";
import { bpParaTexto } from "@/lib/percentual";
import type { EstadoPrecos } from "@/marketplace/acoes-precos";
import { descontoBp, type PrecosMarketplace, simular, validarFormPrecos } from "@/marketplace/precos";
import styles from "../formularios.module.css";

type Props = { precos: PrecosMarketplace; salvar: (a: EstadoPrecos, f: FormData) => Promise<EstadoPrecos> };

const grupo = { border: "1px solid var(--scl-areia)", borderRadius: 8, padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 12, margin: 0 };
const legenda = { fontWeight: 500, padding: "0 6px" };
const nota = { fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0 };

/** 1600 → "16"; 398 → "3,98" (texto do campo de percentual). */
const bpParaCampo = (bp: number) => (bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const camposDe = (p: PrecosMarketplace): Record<string, string> => ({
  taxaOta: bpParaCampo(p.taxaOtaBp),
  taxaBooking: bpParaCampo(p.taxaBookingBp),
  taxaPagamento: bpParaCampo(p.taxaPagamentoBp),
  pesoHospede: String(p.pesos.hospede),
  pesoProprietario: String(p.pesos.proprietario),
  pesoScl: String(p.pesos.scl),
});
const SIMULACAO_PADRAO = { diaria: "500", noites: "3", limpeza: "150" };

/**
 * Taxas de referência e pesos do modelo B, com a simulação ao vivo (Airbnb × Booking × site). A simulação
 * usa os valores digitados antes de salvar: dá para testar uma divisão e só então gravar. Nada aqui
 * escreve em OTA ou no pagamento: são parâmetros do desconto do site e da futura divisão (M12.2).
 */
export function FormPrecosMarketplace({ precos, salvar }: Props) {
  const [resposta, enviar, enviando] = useActionState(salvar, {});
  const [campos, setCampos] = useState<Record<string, string>>(() => ({ ...camposDe(precos), ...(resposta.valores ?? {}) }));
  // Valores gravados mudaram (ex.: "Usar o padrão novo"): os campos recomeçam deles. Erros de uma gravação recusada
  // falam de campos que já não estão na tela e somem; o "Salvo" de uma gravação aceita fica.
  const gravados = JSON.stringify(precos);
  const [ultimosGravados, setUltimosGravados] = useState(gravados);
  const [respostaVencida, setRespostaVencida] = useState<EstadoPrecos | null>(null);
  if (ultimosGravados !== gravados) {
    setUltimosGravados(gravados);
    setCampos(camposDe(precos));
    if (!resposta.ok) setRespostaVencida(resposta);
  }
  const estado: EstadoPrecos = resposta === respostaVencida ? {} : resposta;
  const [sim, setSim] = useState(SIMULACAO_PADRAO);
  const erro = (k: string) => (estado.erros?.[k] ? <span className={styles.erro}>{estado.erros[k]}</span> : null);
  const invalido = (k: string) => (estado.erros?.[k] ? { "aria-invalid": true as const } : {});
  const campo = (k: string, rotulo: string, extra: Record<string, unknown> = {}) => (
    <label>
      {rotulo}
      <input name={k} inputMode="decimal" value={campos[k] ?? ""} onChange={(e) => setCampos({ ...campos, [k]: e.target.value })} {...extra} {...invalido(k)} />
      {erro(k)}
    </label>
  );
  const validos = validarFormPrecos(campos);
  const diaria = reaisParaCentavos(sim.diaria);
  const limpeza = reaisParaCentavos(sim.limpeza);
  const noites = /^\d{1,3}$/.test(sim.noites.trim()) ? Number(sim.noites) : null;
  const soma = typeof diaria === "number" && noites !== null && noites > 0 && limpeza !== undefined ? diaria * noites + (limpeza ?? 0) : null;
  const precoCheio = soma !== null && Number.isSafeInteger(soma) ? soma : null;
  const s = validos.ok && precoCheio !== null ? simular(precoCheio, validos.precos) : null;
  return (
    <>
      <form key={JSON.stringify(precos)} action={enviar} className={styles.form} aria-label="Marketplace e desconto do site">
        {estado.mensagem && <p role="alert" className={styles.alerta}>{estado.mensagem}</p>}
        <fieldset style={grupo}>
          <legend style={legenda}>Taxas de referência</legend>
          <p style={nota}>Percentuais usados na conta da margem: o que a OTA cobraria do anfitrião e o que o pagamento no site custa. Confira de tempos em tempos nas tabelas das plataformas — o sistema não as adivinha. A do Booking só entra na coluna de comparação.</p>
          <div className={styles.linha}>
            {campo("taxaOta", "Taxa do Airbnb (%, só do anfitrião)")}
            {campo("taxaBooking", "Comissão do Booking (%, comparação)")}
            {campo("taxaPagamento", "Taxa do pagamento no site (%)")}
          </div>
        </fieldset>
        <fieldset style={grupo}>
          <legend style={legenda}>Divisão da margem (pesos)</legend>
          <p style={nota}>A margem (taxa do Airbnb − taxa do pagamento, sobre o valor cheio) é dividida pelos pesos: a parte do hóspede vira o desconto do site, a da SCL é a receita da SCL e a do proprietário é o que ele recebe a mais que na OTA. O padrão (decisão de 7/10) é hóspede 1, proprietário 1 e SCL 2: numa margem de 12 pontos, 3% de desconto, 3% a mais para o proprietário e 6% para a SCL. 1/1/1 = partes iguais.</p>
          <div className={styles.linha}>
            {campo("pesoHospede", "Hóspede", { inputMode: "numeric" })}
            {campo("pesoProprietario", "Proprietário", { inputMode: "numeric" })}
            {campo("pesoScl", "SCL", { inputMode: "numeric" })}
          </div>
          <p style={nota}>
            {validos.ok ? <>Com esses valores, o desconto do site é de aproximadamente <strong>{bpParaTexto(descontoBp(validos.precos))}</strong> sobre o valor cheio, para qualquer imóvel e qualquer contrato.</> : "Corrija os campos para ver o desconto resultante."}
          </p>
        </fieldset>
        {estado.ok && <p role="status" className={styles.sucesso}>{estado.aviso ?? "Salvo."}</p>}
        <div className={styles.acoes}>
          <button type="submit" disabled={enviando}>{enviando ? "Salvando…" : "Salvar"}</button>
        </div>
      </form>
      <section aria-label="Simulação" style={{ ...grupo, marginTop: 16 }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 500 }}>Simulação</h3>
        <p style={nota}>Mostra, para uma estadia de exemplo, o que o hóspede paga e o que cada um recebe em cada canal, com os valores digitados acima (salvos ou não).</p>
        <div className={styles.linha}>
          <label>Diária (R$)<input inputMode="decimal" value={sim.diaria} onChange={(e) => setSim({ ...sim, diaria: e.target.value })} /></label>
          <label>Noites<input inputMode="numeric" value={sim.noites} onChange={(e) => setSim({ ...sim, noites: e.target.value })} /></label>
          <label>Limpeza (R$)<input inputMode="decimal" value={sim.limpeza} onChange={(e) => setSim({ ...sim, limpeza: e.target.value })} /></label>
        </div>
        {s ? (
          <>
            <div className={styles.rolagem}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Valor cheio: {formatBRL(s.precoCheio)}</th>
                    <th className={styles.numero}>Airbnb</th>
                    <th className={styles.numero}>Booking</th>
                    <th className={styles.numero}>Site SCL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Hóspede paga</td>
                    <td className={styles.numero}>{formatBRL(s.airbnb.hospedePaga)}</td>
                    <td className={styles.numero}>{formatBRL(s.booking.hospedePaga)}</td>
                    <td className={styles.numero}><strong>{formatBRL(s.site.hospedePaga)}</strong></td>
                  </tr>
                  <tr>
                    <td>Desconto do site</td>
                    <td className={styles.numero}>—</td>
                    <td className={styles.numero}>—</td>
                    <td className={styles.numero}>{formatBRL(s.site.desconto)}</td>
                  </tr>
                  <tr>
                    <td>Taxa (OTA ou pagamento)</td>
                    <td className={styles.numero}>{formatBRL(s.airbnb.taxa)}</td>
                    <td className={styles.numero}>{formatBRL(s.booking.taxa)}</td>
                    <td className={styles.numero}>{formatBRL(s.site.taxa)}</td>
                  </tr>
                  <tr>
                    <td>SCL recebe</td>
                    <td className={styles.numero}>—</td>
                    <td className={styles.numero}>—</td>
                    <td className={styles.numero}>{formatBRL(s.site.scl)}</td>
                  </tr>
                  <tr>
                    <td>Proprietário recebe</td>
                    <td className={styles.numero}>{formatBRL(s.airbnb.proprietarioRecebe)}</td>
                    <td className={styles.numero}>{formatBRL(s.booking.proprietarioRecebe)}</td>
                    <td className={styles.numero}><strong>{formatBRL(s.site.proprietarioRecebe)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={nota}>
              Margem de referência: {formatBRL(s.margemReferencia)} (hóspede {formatBRL(s.partes.hospede)} · proprietário {formatBRL(s.partes.proprietario)} · SCL {formatBRL(s.partes.scl)}). No site, o hóspede economiza {formatBRL(s.comparacao.hospedeEconomiza)} e o proprietário recebe {formatBRL(s.comparacao.proprietarioGanhaMais)} a mais que no Airbnb — a taxa do pagamento incide só sobre o que o hóspede paga, e essa sobra fica com ele.
            </p>
            {s.avisos.map((a) => <p key={a} role="note" className={styles.alerta}>{a}</p>)}
          </>
        ) : (
          <p style={nota}>{validos.ok ? "Informe diária, noites e limpeza válidas para ver a simulação." : "Corrija os campos acima para ver a simulação."}</p>
        )}
      </section>
    </>
  );
}
