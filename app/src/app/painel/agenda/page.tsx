import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { enviarAgoraAcao, salvarAgendaAcao } from "@/agenda/acoes";
import { cidadesDosImoveis, DIAS_AGENDA, diaCurto, lerConfigAgenda, previaDaAgenda, textoDoItem } from "@/agenda/agenda";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";

export default async function Agenda({ searchParams }: PageProps<"/painel/agenda">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "limpeza:ler")) redirect("/painel");
  const params = await searchParams;
  const db = getDb();
  const configurar = podeFazer(sessao.papel, "configuracao:editar");
  const [{ agenda, ultima }, config, cidades] = await Promise.all([
    previaDaAgenda(db, sessao.organizacaoId),
    lerConfigAgenda(db, sessao.organizacaoId),
    cidadesDosImoveis(db, sessao.organizacaoId),
  ]);
  const salvo = typeof params.salvo === "string" ? params.salvo : undefined;
  const erro = typeof params.erro === "string" ? params.erro : undefined;
  // Linhas do formulário: os destinatários atuais e duas em branco para acrescentar.
  const linhas = [...config.destinatarios, { email: "", cidades: [] }, { email: "", cidades: [] }];

  return (
    <>
      <h1>Agenda da equipe</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Todo dia às 20h a equipe recebe por e-mail as entradas, saídas e limpezas dos próximos {DIAS_AGENDA} dias, separadas por cidade, e as reservas novas
        desde a última agenda (mesmo fora dessa janela). A agenda só informa: limpeza pedida aparece como “a confirmar”.
      </p>
      {salvo && (
        <p role="status" className={styles.sucesso}>
          {salvo === "1" ? "Salvo." : `Enviada: ${salvo}.`}
        </p>
      )}
      {erro && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}
      {configurar && !config.ativa && (
        <p role="note" className={styles.alerta}>
          O envio das 20h está desligado. Informe quem recebe e ligue abaixo.
        </p>
      )}
      <p className={styles.etiqueta} style={{ alignSelf: "flex-start" }}>
        Última agenda enviada: {ultima ? ultima.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "nenhuma ainda"}
      </p>

      {agenda.secoes.length === 0 && <p>Nenhum imóvel ativo.</p>}
      {agenda.secoes.map((s) => (
        <section key={s.cidade} className={styles.form} aria-label={`Agenda ${s.cidade}`} style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>{s.cidade}</h2>
          {s.dias.map((d) => (
            <div key={d.data}>
              <strong>{diaCurto(d.data)}</strong>
              {d.itens.length === 0 ? (
                <p style={{ margin: "2px 0 0", color: "var(--scl-texto-2)" }}>nada previsto</p>
              ) : (
                <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                  {d.itens.map((i, k) => (
                    <li key={k}>{textoDoItem(i)}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {s.novas.length > 0 && (
            <div>
              <strong>Reservas novas desde a última agenda</strong>
              <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                {s.novas.map((n) => (
                  <li key={n.reserva}>
                    {n.imovel}: entrada {diaCurto(n.checkin)}, saída {diaCurto(n.checkout)} — {n.hospede || "hóspede sem nome"} ({n.reserva})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}

      {configurar && (
        <>
          <h2>Quem recebe</h2>
          <form action={salvarAgendaAcao} className={styles.form}>
            <input type="hidden" name="linhas" value={linhas.length} />
            <label className={styles.check}>
              <input type="checkbox" name="ativa" value="sim" defaultChecked={config.ativa} /> Enviar todo dia às 20h
            </label>
            {linhas.map((d, i) => (
              <div key={i} className={styles.linha} style={{ alignItems: "center" }}>
                <label className={styles.largo}>
                  E-mail
                  <input type="email" name={`email_${i}`} defaultValue={d.email} maxLength={200} placeholder="equipe@example.com" />
                </label>
                <span style={{ display: "flex", gap: "4px 12px", flexWrap: "wrap" }}>
                  {cidades.map((c) => (
                    <label key={c} className={styles.check}>
                      <input type="checkbox" name={`cidade_${i}`} value={c} defaultChecked={d.cidades.includes(c)} /> {c}
                    </label>
                  ))}
                </span>
              </div>
            ))}
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>Sem cidade marcada, a pessoa recebe todas as cidades. Para tirar alguém, apague o e-mail e salve.</p>
            <div className={styles.acoes}>
              <button type="submit">Salvar</button>
            </div>
          </form>
          <form action={enviarAgoraAcao} className={styles.acoes}>
            <BotaoConfirmar pergunta="Enviar a agenda agora para todos os destinatários?">Enviar agora</BotaoConfirmar>
          </form>
        </>
      )}
    </>
  );
}
