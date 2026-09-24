import Link from "next/link";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { signOut } from "@/acesso/auth";
import { obterSessao } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { imoveis } from "@/db/schema";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { nomeDoMes, periodoDosFiltros } from "@/lib/filtros";
import { formatBRL } from "@/lib/money";
import { janela, lerPeriodoPortal, nome, situacaoDoPeriodo, vizinhos } from "@/portal/periodo";
import { proprietariosDoUsuario, resumoDoProprietario } from "@/portal/resumo";

const SITUACAO = {
  fechado: null,
  parcial: { titulo: "Parcial", texto: "o período ainda não terminou e os números podem mudar." },
  futuro: { titulo: "Previsto", texto: "só reservas já confirmadas; nada foi recebido ainda." },
} as const;

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
      ? db.select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome }).from(imoveis).where(inArray(imoveis.id, [...sessao.imovelIds]))
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
  const resumo = await resumoDoProprietario(db, sessao.organizacaoId, {
    proprietarioIds: donos.map((d) => d.id),
    imovelIds: escolhidos.map((i) => i.id),
    // Com todos os imóveis dele, entra também o que é dele sem imóvel (ajuste/acerto geral).
    semImovel: escolhidos.length === meus.length,
    periodo: periodoDosFiltros(filtros),
  });
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
          {SITUACAO[situacao] && (
            <p role="note" style={{ margin: 0, padding: "8px 12px", borderRadius: 6, background: "var(--scl-areia)", fontSize: "0.9375rem" }}>
              <strong>{SITUACAO[situacao].titulo}:</strong> {SITUACAO[situacao].texto}
            </p>
          )}

          <section aria-label="Números do período" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <Numero titulo="Reservas" valor={String(resumo.reservas)} detalhe={escolhidos.map((i) => i.codigo).join(", ")} />
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
          {resumo.acertoPendente !== 0 && (
            <p role="note" style={{ margin: 0, padding: "8px 12px", borderRadius: 6, background: "var(--scl-areia)", fontSize: "0.9375rem" }}>
              <strong>Em conferência:</strong> {formatBRL(Math.abs(resumo.acertoPendente))} ({resumo.acertoPendente > 0 ? `a seu favor` : `a favor da ${empresa}`}) ainda
              não estão definidos e ficaram fora do acerto acima. A {empresa} vai esclarecer antes do fechamento do mês.
            </p>
          )}
          <p style={{ ...rotulo, margin: 0 }}>
            Valores pelo mês da estadia (estadas que passam de um mês para o outro são divididas pelas noites). A lista de reservas, o calendário e o
            saldo com o Pix chegam nas próximas etapas.
          </p>
        </>
      )}
    </main>
  );
}
