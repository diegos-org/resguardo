import { notFound } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { historicoDe, ocultarCampos } from "@/auditoria/auditoria";
import styles from "@/components/formularios.module.css";
import { HistoricoAlteracoes } from "@/components/HistoricoAlteracoes";
import { getDb } from "@/db/client";
import { listarLancamentos } from "@/financeiro/ledger";
import { reservaCalculadaPeloMotor } from "@/financeiro/motor";
import { obterImovel } from "@/imoveis/repositorio";
import { formatBRL } from "@/lib/money";
import { cancelar, confirmar, resolverConferenciaAcao, salvarEmailHospedeAcao } from "@/reservas/acoes";
import { NOMES_ESTADO, NOMES_ORIGEM, NOMES_RECEBIMENTO, noites } from "@/reservas/regras";
import { devolvidaNoProvedorDaReserva, obterReserva } from "@/reservas/repositorio";
import { lerRegrasFinanceiras } from "@/configuracoes/regras-financeiras";
import { lerRecebimento } from "@/imoveis/recebimento";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { AlteracaoSite } from "@/components/reservas/AlteracaoSite";
import { CancelamentoSite } from "@/components/reservas/CancelamentoSite";
import { Horarios } from "@/components/reservas/Horarios";
import { PagamentoNoSite } from "@/components/reservas/PagamentoNoSite";
import { PaginasLegaisAceitas } from "@/components/reservas/PaginasLegaisAceitas";
import { Recebimentos } from "@/components/reservas/Recebimentos";
import { hojeISO } from "@/lib/datas";
import { alteracaoDoPortador, alteracoesDaReserva } from "@/pagamentos/alteracao-painel";
import { textoDoResultadoDaAlteracao } from "@/pagamentos/alteracao-tela";
import { cancelamentoDaReserva, momentosDoCancelamento } from "@/pagamentos/cancelamento-painel";
import { textoDoResultado } from "@/pagamentos/cancelamento-tela";
import { pagamentosDaReserva } from "@/pagamentos/consultas";
import { recebidoPorReserva, recebimentosDaReserva } from "@/repasses/recebimentos";
import { aceitesDaReserva } from "@/site/aceites";
import { acordoVigente, lerHorariosReservas } from "@/reservas/horarios";

// M8.2d: a diferença de uma alteração também é valor (o histórico da reserva nunca leva o valor a quem não lê o financeiro).
const CAMPOS_FINANCEIROS = ["valorBruto", "taxaCanal", "valorLiquido", "moeda", "recebimento", "diferenca"];
const horaSP = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).replace(", ", " às ");
const dataBr = (d: string) => d.split("-").reverse().join("/");
const brl = (c: number | null) => (c === null ? "não informado" : formatBRL(c));

export default async function DetalheReserva({ params, searchParams }: PageProps<"/painel/reservas/[id]">) {
  const sessao = await exigirSessaoPainel();
  const { id } = await params;
  const { salvo, erro, cancelamento: resultadoCancelamento, alteracao: resultadoAlteracao } = await searchParams;
  const db = getDb();
  const r = await obterReserva(db, sessao.organizacaoId, id);
  if (!r) notFound();
  const horarios = (await lerHorariosReservas(db, sessao.organizacaoId, [r.id])).get(r.id);
  const [imovel, historico] = await Promise.all([obterImovel(db, sessao.organizacaoId, r.imovelId), historicoDe(db, sessao.organizacaoId, "reserva", r.id)]);
  const verValores = podeFazer(sessao.papel, "financeiro:ler");
  const lancs = verValores ? await listarLancamentos(db, sessao.organizacaoId, { reservaId: r.id }) : [];
  // Não calculada pelo motor (a cancelada com valor retido, M8.2c, é calculada), divergente, ou com o pagamento do site
  // devolvido no Mercado Pago fora da política (D21, M8.2c), com lançamento do motor ainda em vigor: já movimentou
  // dinheiro, em conferência (M4.8) — a mesma regra de `lancamentoEmConferencia`. Este quadro é o caminho para dar por resolvida.
  const emVigor = lancs.filter((l) => l.origem === "motor" && !l.estornoDe && !lancs.some((e) => e.estornoDe === l.id));
  const devolvidaNoProvedor = emVigor.length > 0 && !r.conferenciaResolvidaEm && reservaCalculadaPeloMotor(r) && !r.divergenciaEm ? await devolvidaNoProvedorDaReserva(db, sessao.organizacaoId, r.id) : false;
  const emConferencia = (!reservaCalculadaPeloMotor(r) || r.divergenciaEm !== null || devolvidaNoProvedor) && !r.conferenciaResolvidaEm && emVigor.length > 0;

  // Mesma ordem do motor: reserva > configuração do imóvel para o canal > padrão do sistema.
  const doImovel = verValores ? (await lerRecebimento(db, sessao.organizacaoId, r.imovelId))[r.origem] : undefined;
  const efetivo = r.recebimento ?? doImovel ?? (await lerRegrasFinanceiras(db, sessao.organizacaoId, r.checkin)).recebimento[r.origem];
  const fonte = r.recebimento ? "definido nesta reserva" : doImovel ? "configuração do imóvel" : "padrão da empresa vigente na entrada";
  const quemRecebe = `${efetivo === "a_confirmar" ? "A confirmar" : NOMES_RECEBIMENTO[efetivo]} (${fonte})`;
  // M4.10: recebimentos do canal registrados para esta reserva (liberam a parte do proprietário para repasse).
  const [recebimentos, recebidos] = verValores ? await Promise.all([recebimentosDaReserva(db, sessao.organizacaoId, r.id), recebidoPorReserva(db, sessao.organizacaoId, [r.id])]) : [[], new Map()];
  // M8.2a: tentativas de pagamento no site desta reserva (situação para quem lê reservas; valores e ações pelo financeiro).
  const pagamentosSite = podeFazer(sessao.papel, "reserva:ler") ? await pagamentosDaReserva(db, sessao.organizacaoId, r.id) : [];
  // M8.2c: a reserva paga pelo site cancela pela política (o botão de sempre some); o pedido e o cancelamento dela.
  const pagamentoQueConfirmou = pagamentosSite.find((p) => p.desfecho === "reserva") ?? null;
  const editarReserva = podeFazer(sessao.papel, "reserva:editar");
  const editarFinanceiro = podeFazer(sessao.papel, "financeiro:editar");
  const agora = new Date();
  const cancelamentoSite = pagamentoQueConfirmou ? await cancelamentoDaReserva(db, sessao.organizacaoId, r.id, agora) : null;
  const momentos = pagamentoQueConfirmou && editarReserva && editarFinanceiro && r.estado === "confirmada" ? await momentosDoCancelamento(db, sessao.organizacaoId, r.id) : null;
  const capacidade = imovel?.capacidade ?? null;
  const textoCancelamento = textoDoResultado(resultadoCancelamento);
  // M8.2d: as alterações da reserva paga pelo site (a segurada, as aplicadas, o histórico) e, numa reserva-pedido que segura
  // as novas noites de uma alteração, a reserva alterada (a ficha dela não confirma, não cancela nem guarda horários).
  const alteracoes = pagamentoQueConfirmou ? await alteracoesDaReserva(db, sessao.organizacaoId, r.id, agora) : [];
  const portador = await alteracaoDoPortador(db, sessao.organizacaoId, r, agora);
  const ultimaAplicada = alteracoes.find((a) => a.situacao === "aplicada") ?? null;
  const textoAlteracao = textoDoResultadoDaAlteracao(resultadoAlteracao, {
    holdAte: alteracoes.find((a) => a.situacao === "segurada")?.holdAte ?? null,
    valorADevolver: verValores ? (ultimaAplicada?.valorADevolver ?? null) : null,
    previstaEm: ultimaAplicada?.devolucao?.previstaEm ?? null,
  });
  // M7.4: páginas legais que o hóspede aceitou no site (também o aceite gravado sem um Pix que deu certo).
  const aceitesSite = podeFazer(sessao.papel, "reserva:ler") ? await aceitesDaReserva(db, sessao.organizacaoId, r.id) : [];

  const linhas: [string, string][] = [
    ["Imóvel", imovel ? `${imovel.codigo} · ${imovel.nome}` : "—"],
    ["Origem", `${NOMES_ORIGEM[r.origem]}${r.codigoCanal ? ` (${r.codigoCanal})` : ""}`],
    ["Situação", NOMES_ESTADO[r.estado]],
    ["Feita em (data da origem)", r.reservadaEm ? r.reservadaEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Não informada pela origem"],
    ["Cadastrada no SCL em", r.criadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })],
    ["Entrada → saída", `${dataBr(r.checkin)} → ${dataBr(r.checkout)} · ${noites(r.checkin, r.checkout)} noite(s)`],
    ["Hóspedes", r.hospedes === null ? "—" : String(r.hospedes)],
    ["Hóspede", r.hospedeNome || "—"],
    ["Contato", [r.hospedeEmail, r.hospedeTelefone].filter(Boolean).join(" · ") || "—"],
    ["Cidade/país informado", r.hospedeOrigem || "não informado"],
    ...(verValores
      ? ([
          ["Valor bruto", brl(r.valorBruto)],
          ["Taxa do canal", brl(r.taxaCanal)],
          ["Líquido recebido", brl(r.valorLiquido)],
          ["Quem recebe do canal", quemRecebe],
        ] as [string, string][])
      : []),
    ["Observações", r.observacoes || "—"],
  ];

  return (
    <>
      <h1>Reserva {r.codigo}</h1>
      {r.estado === "consulta" && <p role="note">Consulta: não é uma reserva confirmada, não ocupa o calendário e não entra como receita. A situação será atualizada na próxima importação do Beds24.</p>}
      {portador ? (
        <p role="note">
          Datas seguradas para a alteração da reserva <a href={`/painel/reservas/${portador.reservaId}`}>{portador.reservaCodigo}</a>
          {portador.holdAte ? ` até ${horaSP(portador.holdAte)}` : ""}
          {portador.situacao === "segurada" ? "." : ": a alteração não está mais com as datas seguradas (as noites voltaram à venda)."} Elas somem sozinhas quando a alteração é aplicada, desistida
          ou vence; não se confirmam nem se cancelam por aqui.
        </p>
      ) : (
        r.estado === "pedido" && <p role="note">Pedido de reserva: ainda aguarda confirmação na origem e não entra como receita. Confira a situação no canal antes de tratar como reserva confirmada.</p>
      )}
      {typeof erro === "string" && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}
      {salvo && (
        <p role="status" className={styles.sucesso}>
          {salvo === "recebimento" ? "Recebimento registrado." : "Reserva salva."}
        </p>
      )}
      {textoCancelamento && (
        <p role="status" className={styles.sucesso}>
          {textoCancelamento}
        </p>
      )}
      {textoAlteracao && (
        <p role="status" className={styles.sucesso}>
          {textoAlteracao}
        </p>
      )}
      <dl className={styles.form} style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "8px 16px" }}>
        {linhas.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {!portador && r.estado !== "cancelada" && !r.hospedeEmail && (
        <p role="note" className={styles.alerta} style={{ maxWidth: 820 }}>
          Sem e-mail do hóspede: ele não consegue entrar em &ldquo;Minha reserva&rdquo; no site. Cadastre o e-mail abaixo.
        </p>
      )}
      {!portador && podeFazer(sessao.papel, "reserva:editar") && (
        <form action={salvarEmailHospedeAcao} className={styles.form} aria-label="E-mail do hóspede" style={{ maxWidth: 480 }}>
          <input type="hidden" name="id" value={r.id} />
          <label>
            E-mail do hóspede (acesso a &ldquo;Minha reserva&rdquo;)
            <input name="hospedeEmail" type="email" defaultValue={r.hospedeEmail} maxLength={200} />
          </label>
          <button type="submit" className={styles.botao}>
            Salvar e-mail
          </button>
        </form>
      )}
      {!portador && (r.estado === "pendente" || r.estado === "pedido") && podeFazer(sessao.papel, "reserva:editar") && (
        <form action={confirmar}>
          <input type="hidden" name="id" value={r.id} />
          <p style={{ margin: "0 0 8px", color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>
            {r.estado === "pedido"
              ? "Pedido: ocupa as datas mas ainda não entra no financeiro. Pedido do site vence sozinho no prazo indicado nas observações; ao confirmar, vira reserva e os valores entram em todas as telas."
              : "Pendente: ainda não entra no financeiro. Ao confirmar, os valores entram em todas as telas."}
          </p>
          <BotaoConfirmar
            pergunta={`Confirmar a reserva ${r.codigo}? Os valores dela entram no financeiro.`}
            style={{ font: "inherit", padding: "8px 16px", borderRadius: 6, border: "1px solid var(--scl-ok)", color: "var(--scl-ok)", background: "var(--scl-papel)", cursor: "pointer" }}
          >
            Confirmar reserva
          </BotaoConfirmar>
        </form>
      )}
      {!portador && r.estado !== "cancelada" && editarReserva && !pagamentoQueConfirmou && (
        <form action={cancelar}>
          <input type="hidden" name="id" value={r.id} />
          <BotaoConfirmar
            pergunta={`Cancelar a reserva ${r.codigo}? O financeiro dela será estornado.`}
            style={{ font: "inherit", padding: "8px 16px", borderRadius: 6, border: "1px solid var(--scl-erro)", color: "var(--scl-erro)", background: "var(--scl-papel)", cursor: "pointer" }}
          >
            Cancelar reserva
          </BotaoConfirmar>
        </form>
      )}
      <PagamentoNoSite
        pagamentos={pagamentosSite}
        verValores={verValores}
        editar={editarFinanceiro}
        hoje={hojeISO()}
        alteracoes={alteracoes.map((a) => ({ id: a.id, criadaEm: a.criadaEm }))}
        alteracao={
          pagamentoQueConfirmou ? (
            <AlteracaoSite
              reserva={{ id: r.id, codigo: r.codigo, estado: r.estado, checkin: r.checkin, checkout: r.checkout, hospedes: r.hospedes, valorBruto: verValores ? r.valorBruto : null }}
              capacidade={capacidade}
              alteracoes={alteracoes}
              comCancelamento={!!cancelamentoSite}
              entradaEm={momentos?.entradaEm ?? null}
              editarReserva={editarReserva}
              editarFinanceiro={editarFinanceiro}
              verValores={verValores}
              agora={agora}
            />
          ) : null
        }
        cancelamento={
          pagamentoQueConfirmou ? (
            <CancelamentoSite
              reserva={{ id: r.id, codigo: r.codigo, estado: r.estado, checkin: r.checkin }}
              pagamento={pagamentoQueConfirmou}
              cancelamento={cancelamentoSite}
              momentos={momentos}
              editarReserva={editarReserva}
              editarFinanceiro={editarFinanceiro}
              verValores={verValores}
              agora={agora}
            />
          ) : null
        }
      />
      <PaginasLegaisAceitas aceites={aceitesSite} />
      {emConferencia && (
        <section aria-label="Em conferência" className={styles.alerta} style={{ maxWidth: 820 }}>
          <p style={{ margin: 0 }}>
            {devolvidaNoProvedor
              ? "O Mercado Pago mostra o pagamento desta reserva devolvido fora do sistema: a parte do proprietário não é repassada. Cancele pela política (devolução integral) ou registre um ajuste e dê a conferência por resolvida."
              : !reservaCalculadaPeloMotor(r)
                ? "Esta reserva não está confirmada, mas já movimentou dinheiro: os valores continuam no financeiro, em conferência, e o fechamento do mês do proprietário espera. Confirme a reserva de novo ou faça o ajuste manual e depois dê a conferência por resolvida."
                : "Os valores atuais desta reserva não batem com o que já movimentou dinheiro no financeiro: em conferência, e o fechamento do mês do proprietário espera. Faça o ajuste manual e depois dê a conferência por resolvida."}
          </p>
          {podeFazer(sessao.papel, "financeiro:editar") && (
            <form action={resolverConferenciaAcao} style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={r.id} />
              <BotaoConfirmar pergunta="Dar a conferência desta reserva por resolvida? Faça antes o ajuste manual, se precisar: os valores atuais passam a contar como definitivos no fechamento do mês.">
                Dar a conferência por resolvida
              </BotaoConfirmar>
            </form>
          )}
        </section>
      )}
      {verValores && (
        <section aria-label="Lançamentos financeiros" style={{ maxWidth: 820, display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: "1.25rem" }}>Financeiro desta reserva</h2>
          {lancs.length === 0 ? (
            <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>
              Sem lançamentos (valor não informado, reserva cancelada ou imóvel sem contrato).
            </p>
          ) : (
            <div className={styles.rolagem}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Competência</th>
                    <th>Descrição</th>
                    <th>Valor</th>
                    <th>Acerto c/ proprietário</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {lancs.map((l) => (
                    <tr key={l.id} className={l.estornoDe ? styles.inativo : undefined}>
                      <td>{l.competencia.slice(0, 7).split("-").reverse().join("/")}</td>
                      <td>{l.descricao}</td>
                      <td className={styles.numero}>{formatBRL(l.valor)}</td>
                      <td className={styles.numero}>{l.efeitoSaldo === 0 ? "—" : formatBRL(l.efeitoSaldo)}</td>
                      <td>{l.estado}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {verValores && r.estado !== "consulta" && r.estado !== "pedido" && (
        <Recebimentos
          reservaId={r.id}
          recebimentos={recebimentos}
          recebido={recebidos.get(r.id) ?? { recebido: 0, devido: 0 }}
          quemRecebe={efetivo}
          editar={podeFazer(sessao.papel, "financeiro:editar")}
          hoje={hojeISO()}
          cancelada={r.estado === "cancelada"}
        />
      )}
      {!portador && <Horarios id={r.id} horarios={horarios} vigentes={{ entrada: acordoVigente(horarios, "entrada", r), saida: acordoVigente(horarios, "saida", r) }} editar={r.estado === "confirmada" && podeFazer(sessao.papel, "reserva:editar")} />}
      <HistoricoAlteracoes linhas={verValores ? historico : ocultarCampos(historico, CAMPOS_FINANCEIROS)} />
    </>
  );
}
