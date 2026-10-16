"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { CampoHora } from "@/components/CampoHora";
import styles from "@/components/formularios.module.css";
import type { EstadoCancelamentoPainel } from "@/pagamentos/acoes-cancelamento";
import { CAMPO_ROTULO_FORA, CAMPO_VALOR_FORA } from "@/pagamentos/campos-cancelamento";

type Acao = (estado: EstadoCancelamentoPainel, form: FormData) => Promise<EstadoCancelamentoPainel>;
export type OpcaoCancelamento = { valor: string; texto: string };

const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" } as const;

/** A mensagem que o servidor devolveu (sucesso ou a recusa do domínio, como veio). */
function Mensagem({ estado }: { estado: EstadoCancelamentoPainel }) {
  if (!estado.mensagem) return null;
  return (
    <p role={estado.ok ? "status" : "alert"} className={estado.ok ? styles.sucesso : styles.alerta} style={{ margin: 0 }}>
      {estado.mensagem}
    </p>
  );
}

/**
 * Envia pelo `onSubmit` (não pelo `action` do formulário) para o React não limpar os campos: numa recusa, o que foi
 * digitado continua ali para corrigir. O estado anterior nunca volta ao servidor.
 */
function useEnvio(acao: Acao) {
  return useActionState(async (_a: EstadoCancelamentoPainel, f: FormData) => (await acao({}, f)) ?? {}, {} as EstadoCancelamentoPainel);
}

/**
 * O cancelamento pela política na ficha da reserva (M8.2c; desenho §9.2), em dois passos, para quem cuida do financeiro:
 * 1. "Calcular o cancelamento pela política": o momento do pedido (travado no pedido feito pelo hóspede no site;
 *    pré-preenchido no registrado pela equipe, e corrigir pede o motivo), como chegou, quem cancela e onde está o pedido;
 *    o servidor relê o pagamento no Mercado Pago e devolve a prévia (só textos: a tela nunca calcula).
 * 2. "Cancelar a reserva": só com a prévia de agora na tela (mexeu em qualquer campo, calcule de novo) e com a pergunta
 *    de confirmação da prévia (o valor, a base, a rota e a perda do proprietário). O servidor confere a assinatura.
 * Quando a política não dá devolução, a tela oferece a exceção (motivo da lista e nota), também depois de uma recusa sem
 * prévia (saída antecipada; pagamento já devolvido no painel do Mercado Pago); sem política aceita, a equipe escolhe
 * devolver tudo ou não devolver, com o motivo. O que oferecer vem sempre do servidor (`escolha`).
 */
export function FormCancelamentoSite({
  reservaId,
  calcular,
  cancelar,
  pedido,
  agora,
  naoComparecimentoApos,
  semPolitica,
  canais,
  motivosEmpresa,
  motivosExcecao,
}: {
  reservaId: string;
  calcular: Acao;
  cancelar: Acao;
  /** O pedido ativo: feito pelo hóspede no site (o momento é travado) ou registrado pela equipe; null sem pedido. */
  pedido: { site: boolean; data: string; hora: string; canal: string | null; descricao: string } | null;
  /** Data (AAAA-MM-DD) e hora (HH:MM) de agora em Brasília: o padrão do momento sem pedido e o máximo da data. */
  agora: { data: string; hora: string };
  /** "dd/mm às HH:MM": antes disso, o não comparecimento é recusado. */
  naoComparecimentoApos: string;
  /** O pagamento foi feito sem a política aceita: a equipe decide (devolver tudo ou não), com o motivo. */
  semPolitica: boolean;
  canais: readonly OpcaoCancelamento[];
  motivosEmpresa: readonly OpcaoCancelamento[];
  motivosExcecao: readonly OpcaoCancelamento[];
}) {
  const [estado, enviar, enviando] = useActionState(async (anterior: EstadoCancelamentoPainel, x: { etapa: "calcular" | "cancelar"; dados: FormData }) => {
    const r: EstadoCancelamentoPainel = (await (x.etapa === "cancelar" ? cancelar : calcular)({}, x.dados)) ?? {};
    // O que a equipe pode escolher vem do servidor: da prévia ou da recusa de depois da decisão pela política (a saída
    // antecipada e o pagamento já devolvido no painel do Mercado Pago chegam como recusa, sem prévia, e a exceção vale).
    // Numa recusa de antes da decisão (nota com dado pessoal, prévia velha...), fica a escolha que estava na tela, com o
    // que foi digitado nela.
    const escolha = r.previa ? r.previa.escolha : r.escolha !== undefined ? r.escolha : anterior.escolha;
    // Sempre um estado novo: a prévia de agora vale de novo mesmo quando a resposta é igual à anterior.
    return { ...r, escolha };
  }, {} as EstadoCancelamentoPainel);
  const etapa = useRef<"calcular" | "cancelar">("calcular");
  // A prévia vale enquanto nada mudar no formulário: mexeu, o botão de cancelar some até calcular de novo.
  const [alteradoEm, setAlteradoEm] = useState<EstadoCancelamentoPainel | null>(null);
  const [quem, setQuem] = useState("hospede");
  const [data, setData] = useState(pedido?.data ?? agora.data);
  const [hora, setHora] = useState(pedido?.hora ?? agora.hora);
  const [excecao, setExcecao] = useState(false);
  const previa = estado.previa && alteradoEm !== estado ? estado.previa : null;
  const doHospede = quem === "hospede";
  const momentoCorrigido = !!pedido && !pedido.site && doHospede && (data !== pedido.data || hora !== pedido.hora);
  // A SCL cancela: sempre integral, com ou sem política aceita (a escolha sem política é só do pedido do hóspede).
  const escolheSemPolitica = quem !== "empresa" && (semPolitica || estado.escolha === "sem_politica");
  const ofereceExcecao = !escolheSemPolitica && estado.escolha === "excecao";
  // M8.2d (D17): o Mercado Pago mostra parte de um pagamento devolvida pelo painel dele sem dizer quanto — a equipe informa
  // o valor visto lá, de cada pagamento (depois de um aumento, a reserva tem mais de um). Pedidos pelo servidor (a recusa
  // traz os pagamentos), os campos ficam na tela enquanto vierem no formulário (com o rótulo de cada um).
  const foraPedidos = [
    ...(estado.foraSemValor ?? []),
    ...Object.entries(estado.valores ?? {})
      .filter(([k]) => k.startsWith(CAMPO_ROTULO_FORA))
      .map(([k, rotulo]) => ({ pagamentoId: k.slice(CAMPO_ROTULO_FORA.length), rotulo })),
  ].filter((f, i, todos) => todos.findIndex((g) => g.pagamentoId === f.pagamentoId) === i);
  return (
    <form
      aria-label="Cancelar a reserva paga pelo site"
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
      <strong>Cancelar a reserva pela política</strong>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <legend style={{ fontSize: "0.875rem" }}>Quem cancela</legend>
        <label className={styles.check}>
          <input type="radio" name="quemCancela" value="hospede" checked={quem === "hospede"} onChange={() => setQuem("hospede")} /> O hóspede pediu
        </label>
        <label className={styles.check}>
          <input type="radio" name="quemCancela" value="empresa" checked={quem === "empresa"} onChange={() => setQuem("empresa")} /> A SCL cancela (apartamento sem condições ou força maior)
        </label>
        <label className={styles.check}>
          <input type="radio" name="quemCancela" value="nao_comparecimento" checked={quem === "nao_comparecimento"} onChange={() => setQuem("nao_comparecimento")} disabled={!!pedido} /> Não
          comparecimento (o hóspede não chegou e não avisou; só depois de {naoComparecimentoApos})
        </label>
        {pedido && <p style={nota}>Há um pedido de cancelamento do hóspede: não é não comparecimento (vale o horário do pedido).</p>}
      </fieldset>
      {quem === "empresa" && (
        <label>
          Motivo da SCL
          <select name="motivoEmpresa" required defaultValue="">
            <option value="" disabled>
              Escolha
            </option>
            {motivosEmpresa.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.texto}
              </option>
            ))}
          </select>
        </label>
      )}
      {doHospede &&
        (pedido?.site ? (
          <p style={{ margin: 0 }}>
            <strong>Pedido recebido em:</strong> {pedido.descricao} — pedido feito pelo hóspede em Minha reserva (o horário é o do sistema e não muda).
          </p>
        ) : (
          <>
            <div className={styles.linha}>
              <label style={{ flex: "0 1 180px" }}>
                Pedido recebido em (data)
                <input type="date" name="recebidoData" value={data} max={agora.data} onChange={(e) => setData(e.target.value)} required />
              </label>
              <label style={{ flex: "0 1 140px" }}>
                Hora (Brasília)
                <CampoHora name="recebidoHora" value={hora} onChange={(e) => setHora(e.target.value)} required />
              </label>
              <label style={{ flex: "0 1 200px" }}>
                Como chegou
                <select name="canal" defaultValue={pedido?.canal ?? ""} required>
                  <option value="" disabled>
                    Escolha
                  </option>
                  {canais.map((c) => (
                    <option key={c.valor} value={c.valor}>
                      {c.texto}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {pedido && <p style={nota}>{pedido.descricao}</p>}
            {momentoCorrigido && (
              <label>
                Por que corrigir o horário (obrigatório, sem dados pessoais)
                <input name="motivoMomento" required maxLength={300} placeholder="ex.: a mensagem do hóspede chegou às 14:10, não às 15:00" />
              </label>
            )}
          </>
        ))}
      <label>
        Onde está o pedido (opcional, sem dados pessoais — ex.: &ldquo;WhatsApp da empresa, 14:10&rdquo;)
        <input name="nota" maxLength={300} />
      </label>
      {foraPedidos.map((f) => (
        <label key={f.pagamentoId} style={{ maxWidth: 440 }}>
          Valor que o painel do Mercado Pago mostra devolvido fora do sistema, {f.rotulo} (R$)
          <input name={`${CAMPO_VALOR_FORA}${f.pagamentoId}`} inputMode="decimal" required defaultValue={estado.valores?.[`${CAMPO_VALOR_FORA}${f.pagamentoId}`] ?? ""} />
          <input type="hidden" name={`${CAMPO_ROTULO_FORA}${f.pagamentoId}`} value={f.rotulo} />
        </label>
      ))}
      {escolheSemPolitica && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend style={{ fontSize: "0.875rem" }}>Pagamento sem a política aceita: o sistema não calcula. O que fazer?</legend>
          <label className={styles.check}>
            <input type="radio" name="decisao" value="integral" required /> Devolver tudo
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
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <label className={styles.check}>
            <input type="checkbox" name="decisao" value="excecao" checked={excecao} onChange={(e) => setExcecao(e.target.checked)} /> Devolver tudo por exceção (a política não daria devolução)
          </label>
          {excecao && (
            <>
              <label>
                Motivo da exceção
                <select name="motivoExcecao" required defaultValue="">
                  <option value="" disabled>
                    Escolha
                  </option>
                  {motivosExcecao.map((m) => (
                    <option key={m.valor} value={m.valor}>
                      {m.texto}
                    </option>
                  ))}
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
          {enviando ? "Aguarde…" : estado.previa ? "Calcular de novo" : "Calcular o cancelamento pela política"}
        </button>
      </div>
      <Mensagem estado={estado} />
      {estado.previa && !previa && <p style={nota}>Algo mudou no formulário: calcule de novo antes de cancelar.</p>}
      {previa && (
        <section aria-label="Prévia do cancelamento" style={{ border: "1px solid var(--scl-borda)", borderRadius: "var(--scl-raio-cartao)", padding: 12, display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem" }}>
          <p style={{ margin: 0 }}>{previa.leitura}</p>
          <p style={{ margin: 0 }}>{previa.momento}</p>
          {previa.politica && <p style={{ margin: 0 }}>{previa.politica}</p>}
          <p style={{ margin: 0 }}>
            <strong>{previa.resultado}</strong>
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {previa.componentes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {previa.comoSai && <p style={{ margin: 0 }}>{previa.comoSai}</p>}
          {previa.avisos.length > 0 && (
            <ul role="note" className={styles.alerta} style={{ margin: 0, paddingLeft: 28 }}>
              {previa.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <input type="hidden" name="assinatura" value={previa.assinatura} />
          <input type="hidden" name="rota" value={previa.rota} />
          <div className={styles.acoes}>
            <BotaoConfirmar
              pergunta={previa.pergunta}
              disabled={enviando}
              onClick={() => {
                etapa.current = "cancelar";
              }}
              style={{ background: "var(--scl-erro)" }}
            >
              {enviando ? "Aguarde…" : "Cancelar a reserva"}
            </BotaoConfirmar>
          </div>
        </section>
      )}
    </form>
  );
}

/** "Registrar pedido de cancelamento" que chegou por outro canal (reserva:editar): a data e a hora em que chegou valem. */
export function FormRegistrarPedido({ reservaId, acao, agora, canais }: { reservaId: string; acao: Acao; agora: { data: string; hora: string }; canais: readonly OpcaoCancelamento[] }) {
  const [estado, enviar, enviando] = useEnvio(acao);
  return (
    <form
      aria-label="Registrar pedido de cancelamento"
      className={styles.form}
      onSubmit={(ev) => {
        ev.preventDefault();
        const dados = new FormData(ev.currentTarget);
        startTransition(() => enviar(dados));
      }}
    >
      <input type="hidden" name="reservaId" value={reservaId} />
      <strong>Registrar pedido de cancelamento</strong>
      <p style={nota}>O hóspede pediu por outro canal: registre quando o pedido chegou. É esse momento que vale pela política.</p>
      <div className={styles.linha}>
        <label style={{ flex: "0 1 180px" }}>
          Data em que chegou
          <input type="date" name="recebidoData" defaultValue={agora.data} max={agora.data} required />
        </label>
        <label style={{ flex: "0 1 140px" }}>
          Hora (Brasília)
          <CampoHora name="recebidoHora" defaultValue={agora.hora} required />
        </label>
        <label style={{ flex: "0 1 200px" }}>
          Como chegou
          <select name="canal" defaultValue="" required>
            <option value="" disabled>
              Escolha
            </option>
            {canais.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.texto}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Onde está o pedido (opcional, sem dados pessoais — ex.: &ldquo;WhatsApp da empresa, 14:10&rdquo;)
        <input name="nota" maxLength={300} />
      </label>
      <div className={styles.acoes}>
        <button type="submit" disabled={enviando}>
          {enviando ? "Aguarde…" : "Registrar pedido"}
        </button>
      </div>
      <Mensagem estado={estado} />
    </form>
  );
}

/**
 * "Descartar pedido": nunca apaga (o pedido fica no histórico da ficha e da prévia). O pedido feito pelo hóspede no site
 * só se descarta como desistência dele, com por onde e quando desistiu (e só quem cuida do financeiro vê este formulário).
 */
export function FormDescartarPedido({
  reservaId,
  acao,
  pergunta,
  site,
  agora,
  canais,
}: {
  reservaId: string;
  acao: Acao;
  pergunta: string;
  site: boolean;
  agora: { data: string; hora: string };
  canais: readonly OpcaoCancelamento[];
}) {
  const [estado, enviar, enviando] = useEnvio(acao);
  return (
    <form
      aria-label="Descartar pedido de cancelamento"
      className={styles.linha}
      style={{ alignItems: "flex-end", margin: 0 }}
      onSubmit={(ev) => {
        ev.preventDefault();
        const dados = new FormData(ev.currentTarget);
        startTransition(() => enviar(dados));
      }}
    >
      <input type="hidden" name="reservaId" value={reservaId} />
      {site && (
        <>
          <label style={{ flex: "0 1 200px" }}>
            Por onde o hóspede desistiu
            <select name="desistenciaCanal" defaultValue="" required>
              <option value="" disabled>
                Escolha
              </option>
              {canais.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.texto}
                </option>
              ))}
            </select>
          </label>
          <label style={{ flex: "0 1 180px" }}>
            Data da desistência
            <input type="date" name="desistenciaData" defaultValue={agora.data} max={agora.data} required />
          </label>
          <label style={{ flex: "0 1 140px" }}>
            Hora (Brasília)
            <CampoHora name="desistenciaHora" defaultValue={agora.hora} required />
          </label>
        </>
      )}
      <label style={{ flex: "1 1 240px" }}>
        {site ? "O que o hóspede disse (obrigatório, sem dados pessoais)" : "Motivo do descarte (obrigatório, sem dados pessoais)"}
        <input name="motivo" required maxLength={300} />
      </label>
      <BotaoConfirmar pergunta={pergunta} disabled={enviando} className={styles.pequeno}>
        {enviando ? "Aguarde…" : site ? "Descartar pedido (o hóspede desistiu)" : "Descartar pedido"}
      </BotaoConfirmar>
      <div style={{ flexBasis: "100%" }}>
        <Mensagem estado={estado} />
      </div>
    </form>
  );
}
