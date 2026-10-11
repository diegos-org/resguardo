"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import styles from "@/components/formularios.module.css";
import type { EstadoAlteracaoPainel } from "@/pagamentos/acoes-alteracao";
import type { PreviaAlteracaoParaTela } from "@/pagamentos/alteracao-tela";

type Acao = (estado: EstadoAlteracaoPainel, form: FormData) => Promise<EstadoAlteracaoPainel>;
export type OpcaoAlteracao = { valor: string; texto: string };

const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" } as const;
const grupo = { border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 } as const;

/** A mensagem que o servidor devolveu (sucesso ou a recusa do domínio, como veio). */
function Mensagem({ estado }: { estado: EstadoAlteracaoPainel }) {
  if (!estado.mensagem) return null;
  return (
    <p role={estado.ok ? "status" : "alert"} className={estado.ok ? styles.sucesso : styles.alerta} style={{ margin: 0 }}>
      {estado.mensagem}
    </p>
  );
}

function Opcoes({ lista }: { lista: readonly OpcaoAlteracao[] }) {
  return (
    <>
      <option value="" disabled>
        Escolha
      </option>
      {lista.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.texto}
        </option>
      ))}
    </>
  );
}

/** As linhas da prévia (só textos vindos do servidor: a tela nunca calcula). */
export function LinhasDaPrevia({ previa }: { previa: PreviaAlteracaoParaTela }) {
  return (
    <>
      {previa.leitura.map((l) => (
        <p key={l} style={{ margin: 0 }}>
          {l}
        </p>
      ))}
      <p style={{ margin: 0 }}>{previa.hoje}</p>
      <p style={{ margin: 0 }}>{previa.depois}</p>
      <p style={{ margin: 0 }}>
        <strong>{previa.diferenca}</strong>
      </p>
      {previa.politica && <p style={{ margin: 0 }}>{previa.politica}</p>}
      {previa.comoSai.length > 0 && (
        <div>
          Como a devolução sai:
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {previa.comoSai.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.rolagem}>
        <table className={styles.tabela} aria-label="Financeiro antes e depois da alteração">
          <caption style={{ textAlign: "left", fontWeight: 600 }}>Financeiro</caption>
          <thead>
            <tr>
              <th>Mês</th>
              <th>Componente</th>
              <th>Antes</th>
              <th>Depois</th>
              <th>Diferença</th>
            </tr>
          </thead>
          <tbody>
            {[...previa.meses, { mes: "Total", linhas: previa.financeiro }].flatMap((m) =>
              m.linhas.map((l) => (
                <tr key={`${m.mes}-${l.rotulo}`}>
                  <td>{m.mes}</td>
                  <td>{l.rotulo}</td>
                  <td className={styles.numero}>{l.antes}</td>
                  <td className={styles.numero}>{l.depois}</td>
                  <td className={styles.numero}>{l.diferenca}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0 }}>{previa.noitesNovas}</p>
      {previa.avisos.length > 0 && (
        <ul role="note" className={styles.alerta} style={{ margin: 0, paddingLeft: 28 }}>
          {previa.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** "Copiar a proposta para o hóspede" (montada no servidor; leva valores), ou o que falta para ela sair. */
function CopiarProposta({ previa }: { previa: PreviaAlteracaoParaTela }) {
  const p = previa.proposta;
  if (!p) return null;
  if (!p.texto)
    return (
      <p role="note" style={nota}>
        Copiar a proposta: falta {p.falta.map((v) => `{${v}}`).join(", ")} na reserva: complete antes de copiar.{p.falta.includes("link") ? " O endereço do site fica em Configurações → Empresa." : ""}
      </p>
    );
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <BotaoCopiar texto={p.texto} rotulo="Copiar a proposta para o hóspede" className={styles.pequeno} />
      {p.textoBase && <span style={nota}>texto-base — edite em Configurações → Mensagens ao hóspede</span>}
    </span>
  );
}

/**
 * A alteração de reserva paga pelo site na ficha da reserva (M8.2d; desenho §9.2), em dois passos, para quem cuida do
 * financeiro:
 * 1. "Calcular a alteração": as novas datas e pessoas, quem pede (o hóspede, com o momento e por onde chegou; ou a SCL,
 *    com o motivo), de onde vem o valor (a cotação do site, o valor atual mantido ou outro, com o motivo e a nota) e onde
 *    está o pedido. Com "A SCL propõe", o valor começa em "Manter o valor atual" / "A SCL propôs a alteração". O servidor
 *    relê os pagamentos no Mercado Pago e devolve a prévia (só textos: a tela nunca calcula).
 * 2. A prévia, a proposta para copiar e os botões, cada um com a pergunta de confirmação da prévia: no aumento, segurar as
 *    datas e liberar o pagamento da diferença; sem aumento, aplicar (o hóspede já aceitou por escrito) ou só segurar. Mexeu
 *    em qualquer campo, os botões somem até calcular de novo. O servidor confere a assinatura.
 * Na redução que a política não devolve, a tela oferece a exceção (motivo da lista e nota); sem política aceita, devolver
 * ou não, com o motivo. O que oferecer vem sempre do servidor (`escolha`).
 */
export function FormAlteracaoSite({
  reservaId,
  calcular,
  segurar,
  atual,
  capacidade,
  agora,
  canais,
  motivosEmpresa,
  motivosValor,
  motivosExcecao,
}: {
  reservaId: string;
  calcular: Acao;
  segurar: Acao;
  /** A estadia de agora (o valor já em reais). */
  atual: { checkin: string; checkout: string; hospedes: number | null; valor: string };
  /** Até quantas pessoas o apartamento recebe; null = não cadastrada. */
  capacidade: number | null;
  /** Data (AAAA-MM-DD) e hora (HH:MM) de agora em Brasília: o padrão do momento do pedido e o mínimo da nova entrada. */
  agora: { data: string; hora: string };
  canais: readonly OpcaoAlteracao[];
  motivosEmpresa: readonly OpcaoAlteracao[];
  motivosValor: readonly OpcaoAlteracao[];
  motivosExcecao: readonly OpcaoAlteracao[];
}) {
  const [estado, enviar, enviando] = useActionState(async (anterior: EstadoAlteracaoPainel, x: { etapa: "calcular" | "segurar" | "aplicar"; dados: FormData }) => {
    if (x.etapa !== "calcular") x.dados.set("aplicar", x.etapa === "aplicar" ? "sim" : "");
    const r: EstadoAlteracaoPainel = (await (x.etapa === "calcular" ? calcular : segurar)({}, x.dados)) ?? {};
    // O que a equipe pode escolher vem do servidor (da prévia ou da recusa de depois da decisão pela política); numa recusa
    // de antes da decisão, fica a escolha que estava na tela.
    const escolha = r.previa ? r.previa.escolha : r.escolha !== undefined ? r.escolha : anterior.escolha;
    return { ...r, escolha };
  }, {} as EstadoAlteracaoPainel);
  const etapa = useRef<"calcular" | "segurar" | "aplicar">("calcular");
  // A prévia vale enquanto nada mudar no formulário: mexeu, os botões somem até calcular de novo.
  const [alteradoEm, setAlteradoEm] = useState<EstadoAlteracaoPainel | null>(null);
  const [quem, setQuem] = useState("hospede");
  const [origem, setOrigem] = useState("cotacao");
  const [motivoValor, setMotivoValor] = useState("");
  const [excecao, setExcecao] = useState(false);
  const previa = estado.previa && alteradoEm !== estado ? estado.previa : null;
  const doHospede = quem === "hospede";
  const escolheSemPolitica = estado.escolha === "sem_politica" && quem !== "empresa";
  const ofereceExcecao = estado.escolha === "excecao";
  return (
    <form
      aria-label="Alterar a reserva paga pelo site"
      className={styles.form}
      onChange={() => setAlteradoEm(estado)}
      onSubmit={(ev) => {
        ev.preventDefault();
        const dados = new FormData(ev.currentTarget);
        const qual = etapa.current;
        etapa.current = "calcular";
        startTransition(() => enviar({ etapa: qual, dados }));
      }}
    >
      <input type="hidden" name="reservaId" value={reservaId} />
      <strong>Alterar a reserva (antes da entrada)</strong>
      <p style={nota}>
        Hoje: entrada {atual.checkin.split("-").reverse().join("/")}, saída {atual.checkout.split("-").reverse().join("/")}
        {atual.hospedes !== null ? `, ${atual.hospedes} ${atual.hospedes === 1 ? "pessoa" : "pessoas"}` : ""}, {atual.valor}.
      </p>
      <div className={styles.linha}>
        <label style={{ flex: "0 1 180px" }}>
          Nova entrada
          <input type="date" name="checkin" defaultValue={atual.checkin} min={agora.data} required />
        </label>
        <label style={{ flex: "0 1 180px" }}>
          Nova saída
          <input type="date" name="checkout" defaultValue={atual.checkout} min={agora.data} required />
        </label>
        <label style={{ flex: "0 1 120px" }}>
          Pessoas
          <input type="number" name="hospedes" defaultValue={atual.hospedes ?? 1} min={1} max={capacidade ?? undefined} required />
        </label>
      </div>
      {capacidade !== null && <p style={nota}>Este apartamento recebe até {capacidade} pessoas.</p>}
      <fieldset style={grupo}>
        <legend style={{ fontSize: "0.875rem" }}>Quem pede</legend>
        <label className={styles.check}>
          <input
            type="radio"
            name="quemPede"
            value="hospede"
            checked={doHospede}
            onChange={() => {
              setQuem("hospede");
            }}
          />{" "}
          O hóspede pediu
        </label>
        <label className={styles.check}>
          <input
            type="radio"
            name="quemPede"
            value="empresa"
            checked={quem === "empresa"}
            onChange={() => {
              // A SCL propõe: começa sem cobrar mais do hóspede (o valor atual, pela proposta da SCL).
              setQuem("empresa");
              setOrigem("mantido");
              setMotivoValor("alteracao_pela_scl");
            }}
          />{" "}
          A SCL propõe (apartamento sem condições, força maior ou outro)
        </label>
      </fieldset>
      {quem === "empresa" && (
        <label>
          Motivo da SCL
          <select name="motivoEmpresa" required defaultValue="">
            <Opcoes lista={motivosEmpresa} />
          </select>
        </label>
      )}
      <fieldset style={grupo}>
        <legend style={{ fontSize: "0.875rem" }}>Valor</legend>
        <label className={styles.check}>
          <input type="radio" name="origemValor" value="cotacao" checked={origem === "cotacao"} onChange={() => setOrigem("cotacao")} /> Pela cotação do site (preços de hoje)
        </label>
        <label className={styles.check}>
          <input type="radio" name="origemValor" value="mantido" checked={origem === "mantido"} onChange={() => setOrigem("mantido")} /> Manter o valor atual ({atual.valor})
        </label>
        <label className={styles.check}>
          <input type="radio" name="origemValor" value="digitado" checked={origem === "digitado"} onChange={() => setOrigem("digitado")} /> Outro valor
        </label>
        {origem === "digitado" && (
          <label style={{ maxWidth: 220 }}>
            Valor novo da reserva (R$)
            <input name="valor" inputMode="decimal" required placeholder="ex.: 1.900,00" />
          </label>
        )}
        {origem !== "cotacao" && (
          <>
            <label>
              Motivo do valor
              <select name="motivoValor" required value={motivoValor} onChange={(e) => setMotivoValor(e.target.value)}>
                <Opcoes lista={motivosValor} />
              </select>
            </label>
            <label>
              Nota do motivo (obrigatória, sem dados pessoais)
              <input name="motivoValorNota" required maxLength={300} />
            </label>
          </>
        )}
      </fieldset>
      {doHospede && (
        <div className={styles.linha}>
          <label style={{ flex: "0 1 180px" }}>
            Pedido recebido em (data)
            <input type="date" name="recebidoData" defaultValue={agora.data} max={agora.data} required />
          </label>
          <label style={{ flex: "0 1 140px" }}>
            Hora (Brasília)
            <input type="time" name="recebidoHora" defaultValue={agora.hora} required />
          </label>
          <label style={{ flex: "0 1 200px" }}>
            Como chegou
            <select name="canal" defaultValue="" required>
              <Opcoes lista={canais} />
            </select>
          </label>
        </div>
      )}
      <label>
        Onde está o pedido (opcional, sem dados pessoais — ex.: &ldquo;WhatsApp da empresa, 14h10&rdquo;)
        <input name="nota" maxLength={300} />
      </label>
      {escolheSemPolitica && (
        <fieldset style={grupo}>
          <legend style={{ fontSize: "0.875rem" }}>Pagamento sem a política aceita: o sistema não calcula a devolução da diferença. O que fazer?</legend>
          <label className={styles.check}>
            <input type="radio" name="decisao" value="integral" required /> Devolver a diferença
          </label>
          <label className={styles.check}>
            <input type="radio" name="decisao" value="nenhum" required /> Não devolver
          </label>
          <label>
            Motivo (obrigatório, sem dados pessoais)
            <textarea name="motivoDecisao" required maxLength={300} rows={2} />
          </label>
        </fieldset>
      )}
      {ofereceExcecao && (
        <fieldset style={grupo}>
          <label className={styles.check}>
            <input type="checkbox" name="decisao" value="excecao" checked={excecao} onChange={(e) => setExcecao(e.target.checked)} /> Devolver a diferença por exceção (a política não daria devolução)
          </label>
          {excecao && (
            <>
              <label>
                Motivo da exceção
                <select name="motivoExcecao" required defaultValue="">
                  <Opcoes lista={motivosExcecao} />
                </select>
              </label>
              <label>
                Nota (obrigatória, sem dados pessoais)
                <textarea name="motivoDecisao" required maxLength={300} rows={2} />
              </label>
            </>
          )}
        </fieldset>
      )}
      <div className={styles.acoes}>
        <button
          type="submit"
          disabled={enviando}
          onClick={() => {
            etapa.current = "calcular";
          }}
        >
          {enviando ? "Aguarde…" : estado.previa ? "Calcular de novo" : "Calcular a alteração"}
        </button>
      </div>
      <Mensagem estado={estado} />
      {estado.previa && !previa && <p style={nota}>Algo mudou no formulário: calcule de novo antes de seguir.</p>}
      {previa && (
        <section aria-label="Prévia da alteração" style={{ border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", padding: 12, display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem" }}>
          <LinhasDaPrevia previa={previa} />
          <CopiarProposta previa={previa} />
          <input type="hidden" name="assinatura" value={previa.assinatura} />
          <input type="hidden" name="rota" value={previa.rota} />
          <div className={styles.acoes}>
            <BotaoConfirmar
              pergunta={previa.pergunta}
              disabled={enviando}
              onClick={() => {
                etapa.current = previa.rumo === "aumento" ? "segurar" : "aplicar";
              }}
            >
              {enviando ? "Aguarde…" : previa.botao}
            </BotaoConfirmar>
            {previa.perguntaSoSegurar && (
              <BotaoConfirmar
                pergunta={previa.perguntaSoSegurar}
                disabled={enviando}
                className={styles.pequeno}
                onClick={() => {
                  etapa.current = "segurar";
                }}
              >
                Só segurar as datas (o hóspede ainda decide)
              </BotaoConfirmar>
            )}
          </div>
        </section>
      )}
    </form>
  );
}

/**
 * "Aplicar a alteração" de uma alteração segurada (sem aumento), em dois passos: a prévia da aplicação (o retrato gravado e
 * o dinheiro de agora; nunca cota de novo) e o aplicar, com a pergunta e a assinatura dela.
 */
export function FormAplicarAlteracao({ alteracaoId, previaDaAplicacao, aplicar }: { alteracaoId: string; previaDaAplicacao: Acao; aplicar: Acao }) {
  const [estado, enviar, enviando] = useActionState(async (_a: EstadoAlteracaoPainel, x: { etapa: "previa" | "aplicar"; dados: FormData }) => (await (x.etapa === "aplicar" ? aplicar : previaDaAplicacao)({}, x.dados)) ?? {}, {} as EstadoAlteracaoPainel);
  const etapa = useRef<"previa" | "aplicar">("previa");
  const previa = estado.previa;
  return (
    <form
      aria-label="Aplicar a alteração segurada"
      className={styles.form}
      onSubmit={(ev) => {
        ev.preventDefault();
        const dados = new FormData(ev.currentTarget);
        const qual = etapa.current;
        etapa.current = "previa";
        startTransition(() => enviar({ etapa: qual, dados }));
      }}
    >
      <input type="hidden" name="alteracaoId" value={alteracaoId} />
      <div className={styles.acoes}>
        <button
          type="submit"
          disabled={enviando}
          className={styles.pequeno}
          onClick={() => {
            etapa.current = "previa";
          }}
        >
          {enviando ? "Aguarde…" : previa ? "Conferir de novo" : "Conferir para aplicar (o hóspede aceitou)"}
        </button>
      </div>
      <Mensagem estado={estado} />
      {previa && (
        <section aria-label="Prévia da aplicação" style={{ border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", padding: 12, display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem" }}>
          <LinhasDaPrevia previa={previa} />
          <input type="hidden" name="assinatura" value={previa.assinatura} />
          <input type="hidden" name="rota" value={previa.rota} />
          <div className={styles.acoes}>
            <BotaoConfirmar
              pergunta={previa.pergunta}
              disabled={enviando}
              onClick={() => {
                etapa.current = "aplicar";
              }}
            >
              {enviando ? "Aguarde…" : "Aplicar a alteração"}
            </BotaoConfirmar>
          </div>
        </section>
      )}
    </form>
  );
}

/** "Desistir da alteração": o motivo é obrigatório; a pergunta diz o que acontece (e o Pix da diferença cancelado, quando há). */
export function FormDesistirAlteracao({ alteracaoId, acao, pergunta }: { alteracaoId: string; acao: Acao; pergunta: string }) {
  const [estado, enviar, enviando] = useActionState(async (_a: EstadoAlteracaoPainel, f: FormData) => (await acao({}, f)) ?? {}, {} as EstadoAlteracaoPainel);
  return (
    <form
      aria-label="Desistir da alteração"
      className={styles.linha}
      style={{ alignItems: "flex-end", margin: 0 }}
      onSubmit={(ev) => {
        ev.preventDefault();
        const dados = new FormData(ev.currentTarget);
        startTransition(() => enviar(dados));
      }}
    >
      <input type="hidden" name="alteracaoId" value={alteracaoId} />
      <label style={{ flex: "1 1 240px" }}>
        Motivo da desistência (obrigatório, sem dados pessoais)
        <input name="motivo" required maxLength={300} />
      </label>
      <BotaoConfirmar pergunta={pergunta} disabled={enviando} className={styles.pequeno} style={{ color: "var(--scl-erro)" }}>
        {enviando ? "Aguarde…" : "Desistir da alteração"}
      </BotaoConfirmar>
      <div style={{ flexBasis: "100%" }}>
        <Mensagem estado={estado} />
      </div>
    </form>
  );
}
