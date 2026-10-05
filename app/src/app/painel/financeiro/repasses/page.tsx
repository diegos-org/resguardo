import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { AcertoPorFora } from "@/components/repasses/AcertoPorFora";
import { ExtratosCanal } from "@/components/repasses/ExtratosCanal";
import { CartaoRepasse } from "@/components/repasses/CartaoRepasse";
import { type DonoAntecipavel, RepassesAntecipados } from "@/components/repasses/RepassesAntecipados";
import { getDb } from "@/db/client";
import { imoveis, proprietarios } from "@/db/schema";
import { hojeISO } from "@/lib/datas";
import { formatBRL } from "@/lib/money";
import { enviarFechamentoAcao, salvarFechamentoEmailAcao } from "@/fechamento/acoes";
import { listarExtratos } from "@/relatorios/extratos";
import { lerConfigFechamentoEmail, situacaoDosFechamentos } from "@/fechamento/email";
import { fecharMesAcao } from "@/repasses/acoes";
import { partesDoProprietario, resumirPartes } from "@/repasses/extrato";
import { situacaoAntesDoInicio } from "@/repasses/por-fora";
import { diaDoFechamentoAtual, ehDiaDeFechamento } from "@/repasses/periodicidade";
import { periodicidadeDoProprietario } from "@/repasses/proprietario";
import { lerInicioDoSistema, lerRegrasRepasses } from "@/repasses/regras-config";
import { itensDoRepasse, limitesDoMes, listarRepassesDaOrganizacao, meioDiaDe, mesAFechar, nomeMes, type PrevisaoRepasse, somarMes } from "@/repasses/repasses";

const dataBr = (d: string) => d.split("-").reverse().join("/");
const SUCESSO: Record<string, string> = {
  fechado: "Mês fechado: repasse gerado.",
  pago: "Repasse marcado como pago.",
  estornado: "Repasse estornado.",
  antecipado: "Repasse antecipado gerado: a pagar.",
  comprovante: "Comprovante registrado.",
};

function Numeros({ p }: { p: PrevisaoRepasse }) {
  // Os adiantamentos já estão no saldo do acerto: "a receber" os soma de volta para mostrar a conta.
  const [saldo, descontado, contestado, fora, antecipado] = p.repasse ? [p.repasse.saldo, p.repasse.descontado, p.repasse.contestado, p.repasse.foraDoFechamento, p.repasse.antecipado] : [p.saldo, p.aDescontar, p.contestado, p.fora, p.antecipado];
  const itens: [string, string][] = [
    ["Crédito do proprietário até o fim do mês (antes dos descontos)", formatBRL(saldo + descontado + contestado)],
    ["− Adiantamentos descontados", formatBRL(descontado)],
    ["Contestados (não descontados)", formatBRL(contestado)],
    ...(fora ? ([["− Fora do fechamento (dinheiro ainda não com a empresa)", formatBRL(fora)]] as [string, string][]) : []),
    ...(antecipado ? ([["+ Noites de meses seguintes já disponíveis (adiantamento)", formatBRL(antecipado)]] as [string, string][]) : []),
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
  const db = getDb();
  const lim = limitesDoMes(mes)!;
  const agora = meioDiaDe(hoje);
  const [lista, configEmail, regrasRepasses, antecipadosLista] = await Promise.all([
    situacaoDosFechamentos(db, sessao.organizacaoId, mes, hoje),
    lerConfigFechamentoEmail(db, sessao.organizacaoId),
    lerRegrasRepasses(db, sessao.organizacaoId),
    listarRepassesDaOrganizacao(db, sessao.organizacaoId, { tipo: "antecipado", de: lim.inicio, ate: lim.fim }),
  ]);
  // M4.10: partes disponíveis agora (para o antecipado avulso) e periodicidade de cada proprietário. Todos os
  // proprietários ativos, não só os do mês a fechar: quem entrou neste mês e já tem parte disponível também aparece.
  const ativos = await db
    .select({ id: proprietarios.id, nome: proprietarios.nome })
    .from(proprietarios)
    .where(and(eq(proprietarios.organizacaoId, sessao.organizacaoId), eq(proprietarios.ativo, true)))
    .orderBy(asc(proprietarios.nome));
  const candidatos = [...new Map([...ativos.map((p) => [p.id, p.nome] as const), ...lista.map((p) => [p.proprietarioId, p.nome] as const)])];
  const donosAntecipaveis: DonoAntecipavel[] = await Promise.all(
    candidatos.map(async ([proprietarioId, nome]) => {
      const [partes, periodicidade] = await Promise.all([partesDoProprietario(db, sessao.organizacaoId, proprietarioId, agora), periodicidadeDoProprietario(db, sessao.organizacaoId, proprietarioId, hoje, regrasRepasses)]);
      const r = resumirPartes(partes);
      return { proprietarioId, nome, disponivel: r.disponivel, aLiberar: r.aLiberar, periodicidade };
    }),
  );
  const antecipados = await Promise.all(antecipadosLista.map(async (r) => ({ ...r, itens: await itensDoRepasse(db, sessao.organizacaoId, r.id) })));
  // M4.11: o que é de antes do início do sistema (acertado por fora) e os repasses "por fora" já feitos.
  const inicio = await lerInicioDoSistema(db, sessao.organizacaoId);
  const antesDoInicio = inicio ? await situacaoAntesDoInicio(db, sessao.organizacaoId, inicio, agora) : [];
  const porFora = await Promise.all((await listarRepassesDaOrganizacao(db, sessao.organizacaoId, { tipo: "por_fora" })).map(async (r) => ({ ...r, itens: await itensDoRepasse(db, sessao.organizacaoId, r.id) })));
  // M5.7: extratos oficiais dos canais guardados para o mês (vão no fim do relatório do e-mail) e os imóveis para o upload.
  const [extratos, todosImoveis] = await Promise.all([
    listarExtratos(db, sessao.organizacaoId, mes),
    db.select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome }).from(imoveis).where(eq(imoveis.organizacaoId, sessao.organizacaoId)).orderBy(asc(imoveis.codigo)),
  ]);
  const itensFechamento = new Map(await Promise.all(lista.filter((p) => p.repasse).map(async (p) => [p.repasse!.id, await itensDoRepasse(db, sessao.organizacaoId, p.repasse!.id)] as const)));
  const salvo = typeof params.salvo === "string" ? SUCESSO[params.salvo] : typeof params.info === "string" ? params.info : undefined;
  const prontos = lista.filter((p) => p.situacao === "pronto").length;
  const erro = typeof params.erro === "string" ? params.erro : undefined;
  const aPagar = lista.reduce((s, p) => s + (p.repasse ? (p.repasse.situacao === "a_pagar" ? p.repasse.valor : 0) : p.valor), 0);

  return (
    <>
      <h1>Repasses aos proprietários</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820, margin: 0 }}>
        No dia do fechamento (dia {diaDoFechamentoAtual(regrasRepasses)} do mês seguinte; muda em Configurações → Repasses), feche o mês anterior de cada proprietário — antes disso também dá, à mão. O valor é o saldo do acerto no fim do mês, já com os adiantamentos descontados; só entra o que
        já está <strong>disponível</strong> (check-in passado e dinheiro recebido pela empresa — registre o recebimento na página da reserva); o resto fica para o
        repasse seguinte, e noites de meses seguintes já disponíveis entram como adiantamento. Os contestados ficam de fora até você resolver. Depois de fazer o
        Pix, marque como pago com o comprovante: o e-mail ao proprietário sai com ele. Errou? Estorne o repasse: tudo volta como estava.
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

      <RepassesAntecipados repasses={antecipados} donos={donosAntecipaveis} mes={mes} hoje={hoje} diaDeFechamento={ehDiaDeFechamento(hoje, regrasRepasses)} editar={editar} />

      <AcertoPorFora inicio={inicio} situacao={antesDoInicio} repasses={porFora} mes={mes} hoje={hoje} editar={editar} />

      <details className={styles.form} aria-label="E-mail do fechamento">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          E-mail do fechamento aos proprietários · {configEmail.ativo ? `ligado (todo dia às 9h, a partir do dia ${diaDoFechamentoAtual(regrasRepasses)})` : "desligado"}
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

      <ExtratosCanal mes={mes} extratos={extratos} imoveis={todosImoveis} proprietarios={candidatos.map(([id, nome]) => ({ id, nome }))} editar={editar} />

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
                ? `enviado${p.enviadoEm ? ` em ${new Date(p.enviadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}` : ""} para ${p.enviadoPara.join(", ") || "—"}`
                : p.situacao === "aguardando"
                  ? `tentativa sem confirmação do provedor para ${p.destinos.join(", ")}: o mesmo e-mail é repetido depois de 15 minutos`
                  : p.situacao === "incerto"
                  ? `sem confirmação do provedor há mais de um dia${p.destinosTentados.length ? ` (tentativa para ${p.destinosTentados.join(", ")})` : ""}: pode ter chegado. Confira com o proprietário; se não chegou, use "Enviar e-mail de novo"`
                  : p.situacao === "pronto"
                  ? `pronto para enviar a ${p.destinos.join(", ")}`
                  : p.situacao === "sem_relatorio"
                    ? "sem imóvel ligado nem lançamento neste mês: não há relatório para enviar"
                  : p.situacao === "sem_email"
                    ? "sem e-mail cadastrado — cadastre no proprietário"
                    : p.enviadoEm
                      ? "mês reaberto: espera ser fechado de novo (depois, use \"Enviar e-mail de novo\")"
                      : "espera o mês ser fechado"}
            </p>
            {/* M5.7: o relatório do e-mail leva os extratos oficiais guardados em "Extratos dos canais"; sem nenhum, sai sem anexos — avisa, não supõe. */}
            {p.situacao === "enviado" && p.anexosEnviados !== null && (
              <p role="note" className={p.anexosEnviados.length ? undefined : styles.alerta} style={{ margin: 0, fontSize: "0.875rem", color: p.anexosEnviados.length ? "var(--scl-texto-2)" : undefined }}>
                {p.anexosEnviados.length ? `Relatório de ${nomeMes(mes)} enviado com o extrato oficial no fim: ${p.anexosEnviados.join(", ")}.` : `Relatório de ${nomeMes(mes)} enviado sem extrato de canal (nenhum estava guardado): o rodapé diz que os extratos ficam com a equipe.`}
              </p>
            )}
            {p.situacao !== "enviado" && p.situacao !== "sem_relatorio" && (
              <p role="note" className={p.extratosGuardados.length ? undefined : styles.alerta} style={{ margin: 0, fontSize: "0.875rem", color: p.extratosGuardados.length ? "var(--scl-texto-2)" : undefined }}>
                {p.extratosGuardados.length ? `Extratos guardados para o relatório: ${p.extratosGuardados.join(", ")}.` : `Sem extrato de canal guardado para ${nomeMes(mes)}: o relatório do e-mail sai sem anexos. Guarde em "Extratos dos canais", acima.`}
              </p>
            )}
            {p.reenvioPendente && (
              <p role="note" className={styles.alerta} style={{ margin: 0 }}>
                {p.reenvioPendente.estado === "incerto"
                  ? `O último "enviar de novo"${p.reenvioPendente.destinos.length ? ` (para ${p.reenvioPendente.destinos.join(", ")})` : ""} ficou sem confirmação do provedor: pode ter chegado. Confira com o proprietário antes de enviar outra vez.`
                  : `Há um "enviar de novo" ainda sem confirmação do provedor${p.reenvioPendente.destinos.length ? ` (para ${p.reenvioPendente.destinos.join(", ")})` : ""}: o sistema tenta o mesmo e-mail de novo depois de 15 minutos (clique em enviar de novo).`}
              </p>
            )}
            {editar && (p.situacao === "pronto" || p.situacao === "aguardando" || ((p.situacao === "enviado" || p.situacao === "incerto") && p.destinos.length > 0)) && (
              <form action={enviarFechamentoAcao} className={styles.acoes}>
                <input type="hidden" name="mes" value={mes} />
                <input type="hidden" name="proprietarioId" value={p.proprietarioId} />
                {(p.situacao === "enviado" || p.situacao === "incerto") && <input type="hidden" name="reenviar" value="sim" />}
                <BotaoConfirmar
                  pergunta={`${p.situacao === "pronto" ? "Enviar" : p.situacao === "aguardando" ? "Tentar de novo (o mesmo e-mail)" : "Enviar de novo"} o fechamento de ${nomeMes(mes)} para ${p.nome} (${p.destinos.join(", ")})?`}
                  className={styles.pequeno}
                >
                  {p.situacao === "pronto" ? "Enviar e-mail do fechamento" : p.situacao === "aguardando" ? "Tentar de novo agora" : "Enviar e-mail de novo"}
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

            {r && <CartaoRepasse r={r} nome={p.nome} chavePix={p.chavePix} itens={itensFechamento.get(r.id) ?? []} mes={mes} hoje={hoje} editar={editar} />}
            {!r && p.itens.length > 0 && (
              <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
                {p.itens.length} parte(s) de reserva entram neste fechamento{p.foraDoFechamento.length ? `; ${p.foraDoFechamento.length} ficam fora (dinheiro ainda não registrado: registre o recebimento na página da reserva)` : ""}.
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}
