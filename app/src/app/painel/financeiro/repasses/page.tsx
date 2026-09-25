import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { hojeISO } from "@/lib/datas";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { formatBRL } from "@/lib/money";
import { enviarFechamentoAcao, salvarFechamentoEmailAcao } from "@/fechamento/acoes";
import { lerConfigFechamentoEmail, situacaoDosFechamentos } from "@/fechamento/email";
import { estornarRepasseAcao, fecharMesAcao, pagarRepasseAcao } from "@/repasses/acoes";
import { limitesDoMes, mesAFechar, nomeMes, type PrevisaoRepasse, somarMes } from "@/repasses/repasses";

const dataBr = (d: string) => d.split("-").reverse().join("/");
const SUCESSO: Record<string, string> = { fechado: "Mês fechado: repasse gerado.", pago: "Repasse marcado como pago.", estornado: "Repasse estornado." };

function Numeros({ p }: { p: PrevisaoRepasse }) {
  // Os adiantamentos já estão no saldo do acerto: "a receber" os soma de volta para mostrar a conta.
  const [saldo, descontado, contestado] = p.repasse ? [p.repasse.saldo, p.repasse.descontado, p.repasse.contestado] : [p.saldo, p.aDescontar, p.contestado];
  const itens: [string, string][] = [
    ["Crédito do proprietário até o fim do mês (antes dos descontos)", formatBRL(saldo + descontado + contestado)],
    ["− Adiantamentos descontados", formatBRL(descontado)],
    ["Contestados (não descontados)", formatBRL(contestado)],
  ];
  return (
    <dl style={{ display: "flex", gap: "8px 24px", flexWrap: "wrap", margin: 0 }}>
      {itens.map(([k, v]) => (
        <div key={k}>
          <dt style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>{k}</dt>
          <dd style={{ margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function Repasses({ searchParams }: PageProps<"/painel/financeiro/repasses">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "financeiro:ler") || sessao.papel === "proprietario") redirect("/painel");
  const params = await searchParams;
  const hoje = hojeISO();
  const pedido = typeof params.mes === "string" ? params.mes : "";
  const mes = limitesDoMes(pedido) ? pedido : mesAFechar(hoje);
  const editar = podeFazer(sessao.papel, "financeiro:editar");
  const [lista, configEmail] = await Promise.all([situacaoDosFechamentos(getDb(), sessao.organizacaoId, mes, hoje), lerConfigFechamentoEmail(getDb(), sessao.organizacaoId)]);
  const salvo = typeof params.salvo === "string" ? SUCESSO[params.salvo] : typeof params.info === "string" ? params.info : undefined;
  const prontos = lista.filter((p) => p.situacao === "pronto").length;
  const erro = typeof params.erro === "string" ? params.erro : undefined;
  const aPagar = lista.reduce((s, p) => s + (p.repasse ? (p.repasse.situacao === "a_pagar" ? p.repasse.valor : 0) : p.valor), 0);

  return (
    <>
      <h1>Repasses aos proprietários</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        No dia 1º, feche o mês anterior de cada proprietário. O valor é o saldo do acerto no fim do mês, já com os adiantamentos descontados. Os
        contestados ficam de fora até você resolver. Depois de fazer o Pix, marque como pago. Errou? Estorne o repasse: tudo volta como estava.
      </p>
      <nav aria-label="Mês" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <Link href={`/painel/financeiro/repasses?mes=${somarMes(mes, -1)}`}>← {nomeMes(somarMes(mes, -1))}</Link>
        <strong style={{ fontSize: "1.125rem" }}>{nomeMes(mes)}</strong>
        <Link href={`/painel/financeiro/repasses?mes=${somarMes(mes, 1)}`}>{nomeMes(somarMes(mes, 1))} →</Link>
      </nav>
      {salvo && (
        <p role="status" className={styles.sucesso}>
          {salvo}
        </p>
      )}
      {erro && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}
      <p className={styles.etiqueta} style={{ alignSelf: "flex-start" }}>
        {lista.length} proprietário(s) com acerto · a transferir: {formatBRL(aPagar)}
      </p>

      <details className={styles.form} aria-label="E-mail do fechamento">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          E-mail do fechamento aos proprietários · {configEmail.ativo ? "ligado (todo dia às 9h, a partir do dia 1º)" : "desligado"}
        </summary>
        <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", margin: 0 }}>
          Cada proprietário recebe o relatório do mês em PDF, uma vez, depois de o mês dele ser fechado (repasse gerado, ou nada a repassar e sem
          pendências). Quem ainda tem pendência ou está sem e-mail fica de fora e aparece aqui. Use {"{nome}"} e {"{mes}"} no texto.
        </p>
        {editar ? (
          <form action={salvarFechamentoEmailAcao} className={styles.form} style={{ padding: 0, border: 0 }}>
            <input type="hidden" name="mes" value={mes} />
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="ativo" value="sim" defaultChecked={configEmail.ativo} /> Enviar automaticamente
            </label>
            <label>
              Assunto
              <input name="assunto" defaultValue={configEmail.assunto} maxLength={200} required />
            </label>
            <label>
              Texto
              <textarea name="texto" defaultValue={configEmail.texto} rows={6} maxLength={4000} required />
            </label>
            <div className={styles.acoes}>
              <button type="submit">Salvar</button>
            </div>
          </form>
        ) : (
          <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{`${configEmail.assunto}\n\n${configEmail.texto}`}</pre>
        )}
        {editar && prontos > 0 && (
          <form action={enviarFechamentoAcao} className={styles.acoes}>
            <input type="hidden" name="mes" value={mes} />
            <BotaoConfirmar pergunta={`Enviar agora o fechamento de ${nomeMes(mes)} por e-mail a ${prontos} proprietário(s) pronto(s)?`}>
              Enviar agora para os prontos ({prontos})
            </BotaoConfirmar>
          </form>
        )}
      </details>

      {lista.length === 0 && <p>Nenhum proprietário com acerto até o fim deste mês.</p>}
      {lista.map((p) => {
        const r = p.repasse;
        return (
          <section key={p.proprietarioId} className={styles.form} aria-label={`Repasse de ${p.nome}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
              <h2 style={{ fontSize: "1.125rem", margin: 0 }}>
                <Link href={`/painel/proprietarios/${p.proprietarioId}`}>{p.nome}</Link>
                {p.imoveis.length > 0 && <span style={{ color: "var(--scl-texto-2)", fontWeight: 400 }}> · {p.imoveis.join(", ")}</span>}
              </h2>
              <span className={styles.etiqueta}>
                {r ? (r.situacao === "pago" ? `Pago em ${dataBr(r.dataPagamento!)}` : "Fechado · a pagar") : p.valor > 0 ? "A fechar" : p.deve > 0 ? "Proprietário deve" : "Nada a repassar"}
              </span>
            </div>
            <Numeros p={p} />
            <p style={{ margin: 0, fontSize: "1.25rem" }}>
              {r || p.valor > 0 ? (
                <>
                  A transferir: <strong>{formatBRL(r ? r.valor : p.valor)}</strong>
                </>
              ) : p.deve > 0 ? (
                <>
                  O proprietário deve <strong>{formatBRL(p.deve)}</strong>: registre o reembolso em{" "}
                  <Link href="/painel/despesas/adiantamentos">Adiantamentos</Link> ou fica para o próximo repasse.
                </>
              ) : (
                "Nada a transferir."
              )}
            </p>
            {[...p.bloqueios.filter(() => !r), ...p.avisos].map((t) => (
              <p key={t} role="note" className={styles.alerta} style={{ margin: 0 }}>
                {t}
              </p>
            ))}

            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
              E-mail do fechamento:{" "}
              {p.situacao === "enviado"
                ? `enviado${p.enviadoEm ? ` em ${new Date(p.enviadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}` : ""} para ${p.destinos.join(", ") || "—"}`
                : p.situacao === "pronto"
                  ? `pronto para enviar a ${p.destinos.join(", ")}`
                  : p.situacao === "sem_email"
                    ? "sem e-mail cadastrado — cadastre no proprietário"
                    : "espera o mês ser fechado"}
            </p>
            {editar && (p.situacao === "pronto" || (p.situacao === "enviado" && p.destinos.length > 0)) && (
              <form action={enviarFechamentoAcao} className={styles.acoes}>
                <input type="hidden" name="mes" value={mes} />
                <input type="hidden" name="proprietarioId" value={p.proprietarioId} />
                {p.situacao === "enviado" && <input type="hidden" name="reenviar" value="sim" />}
                <BotaoConfirmar
                  pergunta={`${p.situacao === "enviado" ? "Enviar de novo" : "Enviar"} o fechamento de ${nomeMes(mes)} para ${p.nome} (${p.destinos.join(", ")})?`}
                  className={styles.pequeno}
                >
                  {p.situacao === "enviado" ? "Enviar e-mail de novo" : "Enviar e-mail do fechamento"}
                </BotaoConfirmar>
              </form>
            )}

            {editar && !r && p.valor > 0 && p.bloqueios.length === 0 && (
              <form action={fecharMesAcao} className={styles.acoes}>
                <input type="hidden" name="mes" value={mes} />
                <input type="hidden" name="proprietarioId" value={p.proprietarioId} />
                <BotaoConfirmar pergunta={`Fechar ${nomeMes(mes)} de ${p.nome}? Gera o repasse de ${formatBRL(p.valor)} e desconta ${formatBRL(p.aDescontar)} de adiantamentos.`}>
                  Fechar mês e gerar repasse
                </BotaoConfirmar>
              </form>
            )}

            {editar && r?.situacao === "a_pagar" && (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span>
                    Chave Pix: <code>{p.chavePix || "não cadastrada"}</code>
                  </span>
                  {p.chavePix && <BotaoCopiar texto={p.chavePix} rotulo="Copiar Pix" className={styles.pequeno} />}
                  <BotaoCopiar texto={centavosParaCampo(r.valor)} rotulo="Copiar valor" className={styles.pequeno} />
                </div>
                <form action={pagarRepasseAcao} className={styles.linha} style={{ alignItems: "flex-end" }}>
                  <input type="hidden" name="mes" value={mes} />
                  <input type="hidden" name="id" value={r.id} />
                  <label style={{ flex: "0 1 220px" }}>
                    Data do Pix
                    <input type="date" name="data" defaultValue={hoje} min={limitesDoMes(mes)!.fim} max={hoje} required />
                  </label>
                  <div className={styles.acoes}>
                    <button type="submit">Marcar como pago</button>
                  </div>
                </form>
              </>
            )}

            {editar && r && (
              <details>
                <summary style={{ cursor: "pointer", fontSize: "0.875rem" }}>Estornar este repasse</summary>
                <form action={estornarRepasseAcao} className={styles.linha} style={{ alignItems: "flex-end", marginTop: 8 }}>
                  <input type="hidden" name="mes" value={mes} />
                  <input type="hidden" name="id" value={r.id} />
                  <label>
                    Motivo
                    <input name="motivo" required maxLength={300} placeholder="ex.: valor errado, refazer o fechamento" />
                  </label>
                  <div className={styles.acoes}>
                    <BotaoConfirmar
                      pergunta={`Estornar o repasse de ${nomeMes(mes)} de ${p.nome}? Os lançamentos são estornados e os adiantamentos descontados voltam a ficar em aberto.${r.situacao === "pago" ? " O Pix já feito precisa ser devolvido ou acertado à parte." : ""}`}
                      style={{ background: "#b3261e" }}
                    >
                      Estornar
                    </BotaoConfirmar>
                  </div>
                </form>
              </details>
            )}
          </section>
        );
      })}
    </>
  );
}
