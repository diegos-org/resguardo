import Link from "next/link";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { signOut } from "@/acesso/auth";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { imoveis } from "@/db/schema";
import type { ItemCalendario } from "@/calendario/grade";
import { BotaoCopiar } from "@/components/BotaoCopiar";
import { BloqueiosProprietario } from "@/components/portal/BloqueiosProprietario";
import { CalendarioPortal } from "@/components/portal/CalendarioPortal";
import { lerEmpresa, nomeDaEmpresa } from "@/configuracoes/empresa";
import { hojeISO } from "@/lib/datas";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { nomeDoMes, periodoDosFiltros } from "@/lib/filtros";
import { formatBRL } from "@/lib/money";
import { bloquearDatasAcao, liberarDatasAcao } from "@/portal/acoes";
import { bloqueiosDoProprietario, permissoesDeBloqueio } from "@/portal/bloqueios";
import { janela, lerPeriodoPortal, nome, situacaoDoPeriodo, vizinhos } from "@/portal/periodo";
import { bloqueiosDoPortal, reservasDoPortal, type SituacaoReserva } from "@/portal/reservas";
import { hojeMaisCedo } from "@/site/site";
import { proprietariosDoUsuario, resumoDoProprietario } from "@/portal/resumo";
import { type Rodape, rodapeDoPortal } from "@/portal/rodape";
import { donosDosEscolhidos } from "@/relatorios/gerar";
import { nomeMes } from "@/repasses/repasses";
import { NOMES_ORIGEM } from "@/reservas/regras";

const SITUACAO = {
  fechado: null,
  parcial: { titulo: "Parcial", texto: "o período ainda não terminou e os números podem mudar." },
  futuro: { titulo: "Previsto", texto: "só reservas já confirmadas; nada foi recebido ainda." },
} as const;

const SITUACAO_RESERVA: Record<SituacaoReserva, string> = { definido: "Definido", em_conferencia: "Em conferência", sem_calculo: "Sem cálculo ainda" };
const br = (d: string) => d.split("-").reverse().join("/");

/** Rodapé de um proprietário: saldo, quem deve a quem e o Pix de quem recebe (só depois do fechamento). */
/** O que mudou depois do fechamento (vai para o próximo repasse) e o que está em conferência. */
function DepoisDoFechamento({ r, empresa }: { r: Rodape; empresa: string }) {
  if (!r.diferenca && !r.emConferencia) return null;
  return (
    <p style={{ margin: 0, fontSize: "0.9375rem" }}>
      {r.diferenca !== 0 && (
        <>
          Depois do fechamento, o acerto deste mês mudou {formatBRL(Math.abs(r.diferenca))} ({r.diferenca > 0 ? "a seu favor" : `a favor da ${empresa}`}): isso entra no
          próximo repasse.{" "}
        </>
      )}
      {r.emConferencia && <>Há itens deste mês em conferência, lançados depois do fechamento.</>}
    </p>
  );
}

function TextoRodape({ r, empresa }: { r: Rodape; empresa: string }) {
  const valor = <strong>{formatBRL(r.valor)}</strong>;
  const descontos = r.descontado > 0 ? ` (já descontados ${formatBRL(r.descontado)} de despesas que a ${empresa} pagou por você)` : "";
  switch (r.situacao) {
    case "pago":
      return (
        <>
          <p style={{ margin: 0 }}>
            Repasse de {valor} pago em {br(r.dataPagamento!)}.
          </p>
          <DepoisDoFechamento r={r} empresa={empresa} />
        </>
      );
    case "no_repasse_posterior":
      return (
        <>
          <p style={{ margin: 0 }}>O saldo deste mês já entrou no repasse de {nomeMes(r.repassePosterior!)}: veja aquele mês.</p>
          <DepoisDoFechamento r={r} empresa={empresa} />
        </>
      );
    case "fechado":
      return (
        <>
        <p style={{ margin: 0 }}>
          Mês fechado: a {empresa} vai lhe transferir {valor}
          {descontos}
          {r.chavePix ? (
            <>
              {" "}
              para a sua chave Pix <code>{r.chavePix}</code>.
            </>
          ) : (
            <>. Sua chave Pix não está cadastrada: fale com a {empresa}.</>
          )}
        </p>
        <DepoisDoFechamento r={r} empresa={empresa} />
        </>
      );
    case "empresa_deve":
      return (
        <p style={{ margin: 0 }}>
          <strong>Credor: você.</strong> A {empresa} vai lhe transferir {valor}
          {descontos}
          {r.chavePix ? (
            <>
              {" "}
              para a sua chave Pix <code>{r.chavePix}</code>.
            </>
          ) : (
            <>. Sua chave Pix não está cadastrada: fale com a {empresa}.</>
          )}
        </p>
      );
    case "proprietario_deve":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0 }}>
            <strong>Credor: {empresa}.</strong> Você deve {valor} à {empresa}.
          </p>
          {r.chavePix ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span>
                Pix da {empresa}: <code>{r.chavePix}</code>
              </span>
              <BotaoCopiar texto={r.chavePix} rotulo="Copiar Pix" />
              <BotaoCopiar texto={centavosParaCampo(r.valor)} rotulo="Copiar valor" />
            </div>
          ) : (
            <p style={{ margin: 0 }}>Fale com a {empresa} para combinar o pagamento.</p>
          )}
        </div>
      );
    case "parcial":
      return (
        <p style={{ margin: 0 }}>
          Saldo parcial até o fim do período: {valor}
          {r.aFavor === "proprietario" ? " a seu favor" : r.aFavor === "empresa" ? ` a favor da ${empresa}` : ""}. O valor final, quem paga e o Pix saem no fechamento, no dia 1º do mês
          seguinte.
        </p>
      );
    case "em_conferencia":
      return <p style={{ margin: 0 }}>Há itens em conferência: o valor final e o Pix aparecem aqui depois que a {empresa} resolver.</p>;
    default:
      return <p style={{ margin: 0 }}>Nada a pagar ou receber neste mês.</p>;
  }
}

const curto = (p: { ano: number; mes: number | null }) => (p.mes === null ? String(p.ano) : `${nomeDoMes(p.mes).slice(0, 3)}/${p.ano}`);

const caixa: React.CSSProperties = { background: "#fff", border: "1px solid var(--scl-areia)", borderRadius: 8, padding: 16 };
const rotulo: React.CSSProperties = { color: "var(--scl-texto-2)", fontSize: "0.875rem" };

function Numero({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
  return (
    <div style={caixa}>
      <div style={rotulo}>{titulo}</div>
      <div style={{ fontSize: "1.375rem", fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{valor}</div>
      {detalhe && <div style={{ ...rotulo, marginTop: 2 }}>{detalhe}</div>}
    </div>
  );
}

/** Portal do proprietário (M5.1): filtro de imóveis e período, com os números dele. */
export default async function Portal({ searchParams }: PageProps<"/portal">) {
  const sessao = await obterSessao();
  if (!sessao) redirect("/entrar");
  if (sessao.papel !== "proprietario") redirect("/painel");
  const db = getDb();
  const [meus, donos, empresa] = await Promise.all([
    sessao.imovelIds.length
      ? db.select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome, fuso: imoveis.fuso }).from(imoveis).where(inArray(imoveis.id, [...sessao.imovelIds]))
      : Promise.resolve([]),
    proprietariosDoUsuario(db, sessao.organizacaoId, sessao.usuarioId),
    nomeDaEmpresa(db, sessao.organizacaoId),
  ]);
  meus.sort((x, y) => x.codigo.localeCompare(y.codigo));
  const opcoes = meus.map((i) => ({ codigo: i.codigo, nome: i.nome }));
  const params = await searchParams;
  const { filtros, aviso } = lerPeriodoPortal(params, opcoes);
  // Só os imóveis dele: "todos" é a lista dele, nunca a organização.
  const escolhidos = filtros.imoveis.length ? meus.filter((i) => filtros.imoveis.includes(i.codigo)) : meus;
  const periodo = periodoDosFiltros(filtros);
  const hoje = hojeISO();
  // Uso próprio (M5.5): imóveis com algum contrato (em vigor ou futuro) que permita bloquear, e os bloqueios
  // atuais/futuros dos imóveis dele. "Hoje" é o mais cedo entre os fusos dos imóveis dele (o servidor confere
  // cada pedido no fuso do imóvel escolhido).
  const hojeUsoProprio = hojeMaisCedo(meus);
  const [permissoes, meusBloqueios] = await Promise.all([permissoesDeBloqueio(db, sessao.organizacaoId, sessao.imovelIds, hojeUsoProprio), bloqueiosDoProprietario(db, sessao)]);
  // Mesma regra do PDF: só os donos dos imóveis escolhidos (no período) e só os imóveis que eram
  // deles no período; os lançamentos sem imóvel entram quando todos os imóveis desses donos estão escolhidos.
  const selecao = await donosDosEscolhidos(db, donos, escolhidos, periodo);
  const escolhidosIds = selecao.imoveis.map((i) => i.id);
  const donosIds = selecao.donos.map((d) => d.id);
  const resumo = await resumoDoProprietario(db, sessao.organizacaoId, {
    proprietarioIds: donosIds,
    imovelIds: escolhidosIds,
    // Com todos os imóveis dele, entra também o que é dele sem imóvel (ajuste/acerto geral).
    semImovel: selecao.todosOsImoveis,
    periodo,
  });
  const lista = await reservasDoPortal(db, sessao.organizacaoId, { proprietarioIds: donosIds, imovelIds: escolhidosIds, periodo });
  // Calendário só no mês (no ano inteiro, a tabela basta).
  // Bloqueios só do tempo em que o imóvel é dele (os do dono anterior não aparecem).
  const bloqueios = filtros.mes !== null && escolhidosIds.length ? await bloqueiosDoPortal(db, sessao.organizacaoId, { proprietarioIds: donosIds, imovelIds: escolhidosIds, periodo }) : [];
  const itens: ItemCalendario[] = [
    ...lista.map((r) => ({
      id: r.id,
      imovelId: r.imovelId,
      inicio: r.checkin,
      fim: r.checkout,
      tipo: "reserva" as const,
      rotulo: `${r.hospede.split(" ")[0] || r.codigo} · ${NOMES_ORIGEM[r.canal]}`,
      href: `#reserva-${r.id}`,
      categoria: r.canal,
    })),
    ...bloqueios.map((b) => ({ id: b.id, imovelId: b.imovelId, inicio: b.inicio, fim: b.fim, tipo: "bloqueio" as const, rotulo: b.fonte === "proprietario" ? "Uso próprio" : "Bloqueado", categoria: "bloqueio" })),
  ];
  // Saldo do acerto: o do repasse do mês (no ano inteiro, o de dezembro), com todos os imóveis dele.
  const mesSaldo = `${filtros.ano}-${String(filtros.mes ?? 12).padStart(2, "0")}`;
  const rodape = await rodapeDoPortal(db, sessao.organizacaoId, { proprietarios: selecao.donos, mes: mesSaldo, hoje, pixEmpresa: (await lerEmpresa(db, sessao.organizacaoId)).chavePix });
  const situacao = situacaoDoPeriodo(filtros);
  const { anterior, seguinte } = vizinhos(filtros);
  const j = janela();
  const anos = Array.from({ length: j.ate.ano - j.de.ano + 1 }, (_, k) => j.de.ano + k);
  const link = (p: { ano: number; mes: number | null }) => {
    const q = new URLSearchParams();
    for (const c of filtros.imoveis) q.append("imovel", c);
    q.set("ano", String(p.ano));
    q.set("mes", p.mes === null ? "todos" : String(p.mes));
    return `/portal?${q}`;
  };
  const extenso = filtros.mes === null ? `ano de ${filtros.ano}` : nome({ ano: filtros.ano, mes: filtros.mes });
  const titulo = extenso[0].toUpperCase() + extenso.slice(1);

  async function sair() {
    "use server";
    await signOut({ redirectTo: "/entrar" });
  }

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "32px 16px 64px", display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", margin: 0 }}>Portal do proprietário</h1>
          {donos.length > 0 && <p style={{ ...rotulo, margin: 0 }}>{donos.map((d) => d.nome).join(", ")}</p>}
        </div>
        <form action={sair}>
          <button type="submit" style={{ font: "inherit", padding: "6px 14px", borderRadius: 6, border: "1px solid #d8d0c0", background: "#fff", cursor: "pointer" }}>
            Sair
          </button>
        </form>
      </header>

      {meus.length === 0 ? (
        <p>Nenhum imóvel ligado ao seu cadastro ainda. Fale com a {empresa}.</p>
      ) : (
        <>
          <form method="get" action="/portal" aria-label="Filtro" style={{ ...caixa, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
            {meus.length > 1 && (
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: "4px 16px", flexWrap: "wrap" }}>
                <legend style={rotulo}>Imóveis</legend>
                {meus.map((i) => (
                  <label key={i.codigo} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" name="imovel" value={i.codigo} defaultChecked={filtros.imoveis.length === 0 || filtros.imoveis.includes(i.codigo)} />
                    {i.codigo} · {i.nome}
                  </label>
                ))}
              </fieldset>
            )}
            <label style={{ display: "flex", flexDirection: "column", gap: 4, ...rotulo }}>
              Mês
              <select name="mes" defaultValue={filtros.mes === null ? "todos" : String(filtros.mes)} style={{ font: "inherit", padding: 6 }}>
                <option value="todos">Ano inteiro</option>
                {Array.from({ length: 12 }, (_, k) => (
                  <option key={k + 1} value={k + 1}>
                    {nomeDoMes(k + 1)}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, ...rotulo }}>
              Ano
              <select name="ano" defaultValue={String(filtros.ano)} style={{ font: "inherit", padding: 6 }}>
                {anos.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" style={{ font: "inherit", padding: "8px 16px", borderRadius: 6, border: 0, background: "var(--scl-salvia)", color: "#fff", cursor: "pointer" }}>
              Ver
            </button>
          </form>

          {aviso && (
            <p role="alert" style={{ margin: 0, padding: 12, borderRadius: 6, background: "#fbeaea", color: "#8a1c14" }}>
              {aviso}
            </p>
          )}

          <nav aria-label="Período" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
            {anterior ? (
              <Link href={link(anterior)} aria-label={`Anterior: ${anterior.mes === null ? anterior.ano : nome(anterior)}`}>
                ← {curto(anterior)}
              </Link>
            ) : (
              <span />
            )}
            <strong style={{ fontSize: "1.25rem", textAlign: "center" }}>{titulo}</strong>
            {seguinte ? (
              <Link href={link(seguinte)} aria-label={`Seguinte: ${seguinte.mes === null ? seguinte.ano : nome(seguinte)}`} style={{ justifySelf: "end" }}>
                {curto(seguinte)} →
              </Link>
            ) : (
              <span />
            )}
          </nav>
          {filtros.mes !== null && selecao.imoveis.length > 0 && (
            <p style={{ margin: 0, textAlign: "center" }}>
              <a href={link({ ano: filtros.ano, mes: filtros.mes }).replace("/portal?", "/portal/relatorio?")} download>
                Baixar o relatório deste mês em PDF
              </a>
            </p>
          )}
          {SITUACAO[situacao] && (
            <p role="note" style={{ margin: 0, padding: "8px 12px", borderRadius: 6, background: "var(--scl-areia)", fontSize: "0.9375rem" }}>
              <strong>{SITUACAO[situacao].titulo}:</strong> {SITUACAO[situacao].texto}
            </p>
          )}

          <section aria-label="Números do período" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <Numero titulo="Reservas" valor={String(resumo.reservas)} detalhe={selecao.imoveis.map((i) => i.codigo).join(", ")} />
            <Numero titulo="Valor bruto das reservas" valor={formatBRL(resumo.receitaBruta)} detalhe={`Taxas dos canais: ${formatBRL(resumo.taxasCanais)}`} />
            <Numero titulo={`Comissão da ${empresa}`} valor={formatBRL(resumo.comissao)} />
            <Numero titulo="Sua parte das reservas" valor={formatBRL(resumo.suaParte)} />
            <Numero titulo="Despesas atribuídas a você" valor={formatBRL(resumo.despesas)} />
            <Numero
              titulo="Acerto do período"
              valor={formatBRL(Math.abs(resumo.acerto))}
              detalhe={resumo.acerto > 0 ? `a ${empresa} passou a lhe dever` : resumo.acerto < 0 ? `você passou a dever à ${empresa}` : "zerado no período (já conta os repasses)"}
            />
          </section>
          {resumo.emConferencia && (
            <p role="note" style={{ margin: 0, padding: "8px 12px", borderRadius: 6, background: "var(--scl-areia)", fontSize: "0.9375rem" }}>
              <strong>Em conferência:</strong> há itens deste período ainda não definidos
              {resumo.acertoPendente !== 0 ? ` (${formatBRL(Math.abs(resumo.acertoPendente))} ${resumo.acertoPendente > 0 ? "a seu favor" : `a favor da ${empresa}`})` : ""}. Eles
              ficaram fora do acerto acima, que ainda não é definitivo. A {empresa} vai esclarecer antes do fechamento do mês.
            </p>
          )}

          {filtros.mes !== null && (
            <section aria-label="Calendário" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Calendário</h2>
              <p style={{ ...rotulo, margin: 0 }}>Toque numa reserva para ver os valores dela na tabela.</p>
              <CalendarioPortal periodo={periodo} imoveis={selecao.imoveis} itens={itens} hoje={hoje} />
            </section>
          )}

          <BloqueiosProprietario
            imoveis={meus.map((i) => ({ id: i.id, codigo: i.codigo, nome: i.nome, permissao: permissoes.get(i.id) ?? null }))}
            bloqueios={meusBloqueios}
            empresa={empresa}
            hoje={hojeUsoProprio}
            bloquear={bloquearDatasAcao}
            liberar={liberarDatasAcao}
          />

          <section aria-label="Reservas" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Reservas</h2>
            {lista.length === 0 ? (
              <p style={{ margin: 0 }}>Nenhuma reserva confirmada neste período.</p>
            ) : (
              <div style={{ overflowX: "auto", ...caixa, padding: 0 }}>
                <style>{`tr:target td { background: #f6efe0; }`}</style>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--scl-texto-2)" }}>
                      {["Imóvel", "Entrada", "Saída", "Hóspede", "Valor bruto*", "Sua parte*", "Situação", "Canal", "Origem"].map((c) => (
                        <th key={c} scope="col" style={{ padding: "8px 10px", borderBottom: "1px solid var(--scl-areia)", whiteSpace: "nowrap" }}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((r) => (
                      <tr key={r.id} id={`reserva-${r.id}`}>
                        {[
                          r.imovelCodigo,
                          br(r.checkin),
                          br(r.checkout),
                          r.hospede || "não informado",
                          formatBRL(r.bruto),
                          formatBRL(r.suaParte),
                          SITUACAO_RESERVA[r.situacao],
                          NOMES_ORIGEM[r.canal],
                          r.origemHospede || "não informada",
                        ].map((v, k) => (
                          <td key={k} style={{ padding: "8px 10px", borderBottom: "1px solid var(--scl-areia)", whiteSpace: "nowrap", fontVariantNumeric: k === 4 || k === 5 ? "tabular-nums" : undefined }}>
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ ...rotulo, margin: 0 }}>
              * Valores deste período pelo mês da estadia (estadas que passam de um mês para o outro são divididas pelas noites). Origem só quando o
              hóspede informou.
            </p>
          </section>

          <section aria-label="Saldo e Pix" style={{ ...caixa, display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Saldo com a {empresa}</h2>
            <div style={{ display: "flex", gap: "8px 24px", flexWrap: "wrap" }}>
              <span>
                Receitas (sua parte): <strong>{formatBRL(resumo.suaParte)}</strong>
              </span>
              <span>
                Despesas atribuídas a você: <strong>{formatBRL(resumo.despesas)}</strong>
              </span>
            </div>
            {rodape.map((r) => (
              <div key={r.proprietarioId} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {rodape.length > 1 && <strong>{r.nome}</strong>}
                <TextoRodape r={r} empresa={empresa} />
              </div>
            ))}
            <p style={{ ...rotulo, margin: 0 }}>
              O saldo considera todos os seus imóveis até o fim de {filtros.mes === null ? `dezembro de ${filtros.ano}` : nome({ ano: filtros.ano, mes: filtros.mes })},
              já com os repasses feitos.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
