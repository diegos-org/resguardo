import { notFound } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { historicoDe, ocultarCampos } from "@/auditoria/auditoria";
import styles from "@/components/formularios.module.css";
import { HistoricoAlteracoes } from "@/components/HistoricoAlteracoes";
import { getDb } from "@/db/client";
import { listarLancamentos } from "@/financeiro/ledger";
import { obterImovel } from "@/imoveis/repositorio";
import { formatBRL } from "@/lib/money";
import { cancelar, confirmar, resolverConferenciaAcao, salvarEmailHospedeAcao } from "@/reservas/acoes";
import { NOMES_ESTADO, NOMES_ORIGEM, NOMES_RECEBIMENTO, noites } from "@/reservas/regras";
import { obterReserva } from "@/reservas/repositorio";
import { lerRegrasFinanceiras } from "@/configuracoes/regras-financeiras";
import { lerRecebimento } from "@/imoveis/recebimento";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import { Horarios } from "@/components/reservas/Horarios";
import { acordoVigente, lerHorariosReservas } from "@/reservas/horarios";

const CAMPOS_FINANCEIROS = ["valorBruto", "taxaCanal", "valorLiquido", "moeda", "recebimento"];
const dataBr = (d: string) => d.split("-").reverse().join("/");
const brl = (c: number | null) => (c === null ? "não informado" : formatBRL(c));

export default async function DetalheReserva({ params, searchParams }: PageProps<"/painel/reservas/[id]">) {
  const sessao = await exigirSessaoPainel();
  const { id } = await params;
  const { salvo, erro } = await searchParams;
  const db = getDb();
  const r = await obterReserva(db, sessao.organizacaoId, id);
  if (!r) notFound();
  const horarios = (await lerHorariosReservas(db, sessao.organizacaoId, [r.id])).get(r.id);
  const [imovel, historico] = await Promise.all([obterImovel(db, sessao.organizacaoId, r.imovelId), historicoDe(db, sessao.organizacaoId, "reserva", r.id)]);
  const verValores = podeFazer(sessao.papel, "financeiro:ler");
  const lancs = verValores ? await listarLancamentos(db, sessao.organizacaoId, { reservaId: r.id }) : [];
  // Não confirmada com lançamento do motor ainda em vigor: já movimentou dinheiro, em conferência (M4.8).
  const emVigor = lancs.filter((l) => l.origem === "motor" && !l.estornoDe && !lancs.some((e) => e.estornoDe === l.id));
  const emConferencia = (r.estado !== "confirmada" || r.divergenciaEm !== null) && !r.conferenciaResolvidaEm && emVigor.length > 0;

  // Mesma ordem do motor: reserva > configuração do imóvel para o canal > padrão do sistema.
  const doImovel = verValores ? (await lerRecebimento(db, sessao.organizacaoId, r.imovelId))[r.origem] : undefined;
  const efetivo = r.recebimento ?? doImovel ?? (await lerRegrasFinanceiras(db, sessao.organizacaoId, r.checkin)).recebimento[r.origem];
  const fonte = r.recebimento ? "definido nesta reserva" : doImovel ? "configuração do imóvel" : "padrão da empresa vigente na entrada";
  const quemRecebe = `${efetivo === "a_confirmar" ? "A confirmar" : NOMES_RECEBIMENTO[efetivo]} (${fonte})`;

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
      {r.estado === "pedido" && <p role="note">Pedido de reserva: ainda aguarda confirmação na origem e não entra como receita. Confira a situação no canal antes de tratar como reserva confirmada.</p>}
      {typeof erro === "string" && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}
      {salvo && (
        <p role="status" className={styles.sucesso}>
          Reserva salva.
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
      {r.estado !== "cancelada" && !r.hospedeEmail && (
        <p role="note" className={styles.alerta} style={{ maxWidth: 820 }}>
          Sem e-mail do hóspede: ele não consegue entrar em &ldquo;Minha reserva&rdquo; no site. Cadastre o e-mail abaixo.
        </p>
      )}
      {podeFazer(sessao.papel, "reserva:editar") && (
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
      {(r.estado === "pendente" || r.estado === "pedido") && podeFazer(sessao.papel, "reserva:editar") && (
        <form action={confirmar}>
          <input type="hidden" name="id" value={r.id} />
          <p style={{ margin: "0 0 8px", color: "var(--scl-texto-2)", fontSize: "0.875rem" }}>
            {r.estado === "pedido"
              ? "Pedido: ocupa as datas mas ainda não entra no financeiro. Pedido do site vence sozinho no prazo indicado nas observações; ao confirmar, vira reserva e os valores entram em todas as telas."
              : "Pendente: ainda não entra no financeiro. Ao confirmar, os valores entram em todas as telas."}
          </p>
          <BotaoConfirmar
            pergunta={`Confirmar a reserva ${r.codigo}? Os valores dela entram no financeiro.`}
            style={{ font: "inherit", padding: "8px 16px", borderRadius: 6, border: "1px solid var(--scl-verde, #2e6b4f)", color: "var(--scl-verde, #2e6b4f)", background: "#fff", cursor: "pointer" }}
          >
            Confirmar reserva
          </BotaoConfirmar>
        </form>
      )}
      {r.estado !== "cancelada" && podeFazer(sessao.papel, "reserva:editar") && (
        <form action={cancelar}>
          <input type="hidden" name="id" value={r.id} />
          <BotaoConfirmar
            pergunta={`Cancelar a reserva ${r.codigo}? O financeiro dela será estornado.`}
            style={{ font: "inherit", padding: "8px 16px", borderRadius: 6, border: "1px solid #b3261e", color: "#b3261e", background: "#fff", cursor: "pointer" }}
          >
            Cancelar reserva
          </BotaoConfirmar>
        </form>
      )}
      {emConferencia && (
        <section aria-label="Em conferência" className={styles.alerta} style={{ maxWidth: 820 }}>
          <p style={{ margin: 0 }}>
            {r.estado !== "confirmada"
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
      <Horarios id={r.id} horarios={horarios} vigentes={{ entrada: acordoVigente(horarios, "entrada", r), saida: acordoVigente(horarios, "saida", r) }} editar={r.estado === "confirmada" && podeFazer(sessao.papel, "reserva:editar")} />
      <HistoricoAlteracoes linhas={verValores ? historico : ocultarCampos(historico, CAMPOS_FINANCEIROS)} />
    </>
  );
}
