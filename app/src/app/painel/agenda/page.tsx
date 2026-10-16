import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { enviarAgoraAcao, salvarAgendaAcao } from "@/agenda/acoes";
import { cidadesDosImoveis, DIAS_AGENDA, DIAS_BUZIOS, diasDaCidade, FORMATOS, FRASE_FINAL, formatoDa, lerConfigAgenda, NOMES_FORMATO, previaDaAgenda, textoDaSecao } from "@/agenda/agenda";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { CampoHora } from "@/components/CampoHora";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { dataHoraNoFuso } from "@/lib/datas";

export default async function Agenda({ searchParams }: PageProps<"/painel/agenda">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "limpeza:ler")) redirect("/painel");
  const params = await searchParams;
  const db = getDb();
  const configurar = podeFazer(sessao.papel, "configuracao:editar");
  const [{ agenda, ultima, talvezJaVeio }, config, ativas] = await Promise.all([
    previaDaAgenda(db, sessao.organizacaoId),
    lerConfigAgenda(db, sessao.organizacaoId),
    cidadesDosImoveis(db, sessao.organizacaoId),
  ]);
  const salvo = typeof params.salvo === "string" ? params.salvo : undefined;
  const erro = typeof params.erro === "string" ? params.erro : undefined;
  // Cidades já escolhidas continuam na tela mesmo sem imóvel ativo (senão salvar viraria "todas").
  // Idem para o formato escolhido de uma cidade que ficou sem imóvel ativo (não volta a "automático" ao salvar).
  const cidades = [...new Set([...ativas, ...config.destinatarios.flatMap((d) => d.cidades), ...Object.keys(config.formatos)])].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  // Linhas do formulário: os destinatários atuais e duas em branco para acrescentar.
  const linhas = [...config.destinatarios, { email: "", cidades: [] }, { email: "", cidades: [] }];

  return (
    <>
      <h1>Agenda da equipe</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        Todo dia às 20:00 a equipe recebe por e-mail os próximos {DIAS_AGENDA} dias no Rio e {DIAS_BUZIOS} dias em Búzios. No Rio, as limpezas de cada
        dia (com horário-limite quando alguém entra no mesmo dia) ficam separadas das entradas e chaves; em Búzios, todas as reservas relevantes, inclusive em andamento. Vão também as reservas novas desde a
        última agenda (mesmo fora dessa janela). A agenda só informa: não confirma limpeza. Abaixo, uma prévia do texto: cada pessoa recebe só as cidades
        dela e só as reservas novas que ainda não recebeu.
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
          O envio das 20:00 está desligado. Informe quem recebe e ligue abaixo.
        </p>
      )}
      <p className={styles.etiqueta} style={{ alignSelf: "flex-start" }}>
        Última agenda enviada: {ultima ? dataHoraNoFuso(ultima) : "nenhuma ainda"}
      </p>

      {agenda.secoes.length === 0 && <p>Nenhum imóvel ativo.</p>}
      {agenda.secoes.map((s) => (
        <section key={s.cidade} className={styles.form} aria-label={`Agenda ${s.cidade}`} style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>{s.cidade}</h2>
          <p className={styles.pequeno} style={{ margin: 0 }}>
            Período: {s.dias.length} dias. Formato: {NOMES_FORMATO[formatoDa(config, s.cidade, s.imoveis)].toLowerCase()}
            {config.formatos[s.cidade] ? "" : " (automático)"}
          </p>
          {/* O mesmo texto que a equipe recebe. */}
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", font: "inherit", lineHeight: 1.5 }}>{textoDaSecao(s, agenda.dias.at(-1)!, { ...config, talvezJaVeio }).join("\n")}</pre>
        </section>
      ))}
      {agenda.secoes.length > 0 && <p style={{ margin: 0, color: "var(--scl-texto-2)" }}>{FRASE_FINAL}</p>}

      {configurar && (
        <>
          <h2>Quem recebe</h2>
          <form action={salvarAgendaAcao} className={styles.form}>
            <input type="hidden" name="linhas" value={linhas.length} />
            <label className={styles.check}>
              <input type="checkbox" name="ativa" value="sim" defaultChecked={config.ativa} /> Enviar todo dia às 20:00
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
                      {!ativas.includes(c) && " (sem imóvel ativo)"}
                    </label>
                  ))}
                </span>
              </div>
            ))}
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>Sem cidade marcada, a pessoa recebe todas as cidades. Para tirar alguém, apague o e-mail e salve.</p>
            <h3 style={{ margin: "8px 0 0" }}>Formato de cada cidade</h3>
            <input type="hidden" name="cidades" value={cidades.length} />
            {cidades.map((c, k) => (
              <label key={c}>
                {c}
                <input type="hidden" name={`formato_cidade_${k}`} value={c} />
                <select name={`formato_${k}`} disabled={diasDaCidade(c) === DIAS_BUZIOS || c.trim().toLowerCase() === "rio de janeiro"} defaultValue={diasDaCidade(c) === DIAS_BUZIOS ? "reservas" : c.trim().toLowerCase() === "rio de janeiro" ? "limpezas" : config.formatos[c] ?? "automatico"}>
                  <option value="automatico">Automático (casa única: por reserva; vários apartamentos: por limpezas)</option>
                  {FORMATOS.map((f) => (
                    <option key={f} value={f}>
                      {NOMES_FORMATO[f]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div className={styles.linha}>
              <label>
                Horário padrão de entrada (quando o imóvel não tem cadastro)
                <CampoHora name="horaEntrada" defaultValue={config.horaEntrada} required />
              </label>
              <label>
                Horário padrão de saída (quando o imóvel não tem cadastro)
                <CampoHora name="horaSaida" defaultValue={config.horaSaida} required />
              </label>
            </div>
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

