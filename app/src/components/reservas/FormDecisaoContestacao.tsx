"use client";

import { startTransition, useActionState, useState } from "react";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import type { EstadoContestacaoPainel } from "@/pagamentos/acoes-contestacao";
import type { DecisaoNaTela } from "@/pagamentos/contestacao-tela";
import type { AcaoContestacao } from "./FormAcaoContestacao";

const nota = { margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" } as const;

/**
 * "Registrar quem arca" e "Mudar quem arca" (M8.2e; desenho "Quem arca: a decisão da equipe"), para quem cuida do
 * financeiro. O sistema nunca escolhe: o formulário começa sem nada marcado. Cada causa mostra a frase da regra (editável em
 * Configurações → Pagamento no site) e cada opção de quem arca, os dois débitos e o que cada lado fica da reserva com o
 * resultado perdido e com o ganho (a prévia); os fatos da disputa e da estadia ficam ao lado. No "Mudar", a explicação ao
 * proprietário vem preenchida com a que está em vigor (enviar sem mexer a mantém). A pergunta do BotaoConfirmar vem pronta do servidor para cada causa e opção (`perguntaDaDecisao`: causa, quem arca,
 * os valores, o que fica segurado e, na fraude com o proprietário, a confirmação reforçada). Vão juntos a versão e a
 * assinatura da opção escolhida: se a disputa ou a reserva mudarem entre a tela e o clique, o servidor recusa.
 */
export function FormDecisaoContestacao({ contestacaoId, decisao: d, acao, perdida }: { contestacaoId: string; decisao: DecisaoNaTela; acao: AcaoContestacao; perdida: boolean }) {
  const [estado, enviar, enviando] = useActionState(async (_a: EstadoContestacaoPainel, f: FormData) => (await acao({}, f)) ?? {}, {} as EstadoContestacaoPainel);
  const [causa, setCausa] = useState<string>("");
  const [quemArca, setQuemArca] = useState<string>("");
  const opcao = d.opcoes.find((o) => o.quemArca === quemArca) ?? null;
  const pergunta = opcao && causa ? opcao.perguntas[causa as keyof typeof opcao.perguntas] : "";
  const mudar = d.modo === "mudar";
  return (
    <form
      aria-label={mudar ? "Mudar quem arca" : "Registrar quem arca"}
      className={styles.form}
      onSubmit={(ev) => {
        ev.preventDefault();
        const dados = new FormData(ev.currentTarget);
        startTransition(() => enviar(dados));
      }}
    >
      <input type="hidden" name="contestacaoId" value={contestacaoId} />
      <input type="hidden" name="versao" value={d.versao} />
      <input type="hidden" name="assinatura" value={opcao?.assinatura ?? ""} />
      {perdida && <input type="hidden" name="perdida" value="sim" />}
      <strong>{mudar ? "Mudar quem arca" : "Registrar quem arca"}</strong>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8125rem", color: "var(--scl-texto-2)" }} aria-label="Fatos da disputa">
        {d.fatos.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <legend style={{ fontSize: "0.875rem" }}>Causa</legend>
        {d.causas.map((c) => (
          <label key={c.codigo} className={styles.check}>
            <input type="radio" name="causa" value={c.codigo} checked={causa === c.codigo} onChange={() => setCausa(c.codigo)} /> {c.nome}
            <span style={nota}> — {c.frase}</span>
          </label>
        ))}
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <legend style={{ fontSize: "0.875rem" }}>Quem arca</legend>
        {d.opcoes.map((o) => (
          <label key={o.quemArca} className={styles.check}>
            <input type="radio" name="quemArca" value={o.quemArca} checked={quemArca === o.quemArca} onChange={() => setQuemArca(o.quemArca)} /> {o.nome}
            <span style={nota}>
              {" "}
              — proprietário {o.proprietario}; SCL {o.scl}. Fica da reserva — perdida: proprietário {o.fica.perdida.proprietario}, SCL {o.fica.perdida.scl}
              {o.fica.ganha && (
                <>
                  ; ganha: proprietário {o.fica.ganha.proprietario}, SCL {o.fica.ganha.scl}
                </>
              )}
              .
            </span>
          </label>
        ))}
        {d.semOpcao.map((t) => (
          <p key={t} style={nota}>
            {t}
          </p>
        ))}
      </fieldset>
      <label>
        {mudar ? "Por que mudar (obrigatória, sem dados pessoais; nunca vai ao proprietário)" : "Nota da decisão (obrigatória, sem dados pessoais; nunca vai ao proprietário)"}
        <textarea name="nota" required maxLength={300} rows={2} />
      </label>
      <label>
        Explicação ao proprietário (opcional, sem dados pessoais: aparece no extrato, no PDF e no e-mail, ao lado da causa
        {mudar ? "; vem com a explicação em vigor: apagar o campo apaga a explicação" : ""})
        <textarea name="explicacao" maxLength={300} rows={2} defaultValue={d.explicacao} />
      </label>
      <div className={styles.acoes}>
        <BotaoConfirmar pergunta={pergunta} disabled={enviando || !opcao || !causa}>
          {enviando ? "Aguarde…" : mudar ? "Mudar quem arca" : "Registrar quem arca"}
        </BotaoConfirmar>
      </div>
      {(!opcao || !causa) && <p style={nota}>Escolha a causa e quem arca: o sistema nunca escolhe.</p>}
      {estado.mensagem && (
        <p role={estado.ok ? "status" : "alert"} className={estado.ok ? styles.sucesso : styles.alerta} style={{ margin: 0 }}>
          {estado.mensagem}
        </p>
      )}
    </form>
  );
}
