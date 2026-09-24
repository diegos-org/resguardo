import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { lerRegrasFinanceiras } from "@/configuracoes/regras-financeiras";
import { hojeISO } from "@/lib/datas";
import { NOMES_ORIGEM } from "@/reservas/regras";
import { AUTOMACOES, ultimasExecucoes } from "@/sistema/automacoes";
import { regrasEmVigor } from "@/sistema/regras";
import { type SituacaoServico, situacaoServicos } from "@/sistema/servicos";

const SELO: Record<SituacaoServico, { texto: string; cor: string }> = {
  ok: { texto: "Funcionando (testado agora)", cor: "#e3efe0" },
  configurado: { texto: "Configurado", cor: "#e8eef7" },
  falha: { texto: "Com problema", cor: "#fbeaea" },
  nao_configurado: { texto: "Falta configurar", cor: "#fdf3dc" },
  planejado: { texto: "Ainda não construído", cor: "#eeeeee" },
};
const RECEBE = { split: "canal paga o proprietário", empresa: "empresa recebe e repassa", a_confirmar: "a confirmar" };
const quando = (d: Date | null) => (d ? d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");

export default async function Sistema() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel");
  const db = getDb();
  let bancoOk: boolean | null = null;
  try {
    await db.execute(sql`select 1`);
    bancoOk = true;
  } catch {
    bancoOk = false;
  }
  const [execucoes, regras, financeiras] = await Promise.all([
    ultimasExecucoes(db),
    regrasEmVigor(db, sessao.organizacaoId, hojeISO()),
    lerRegrasFinanceiras(db, sessao.organizacaoId),
  ]);
  const servicos = situacaoServicos(process.env, bancoOk);

  return (
    <>
      <h1>Sistema</h1>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820 }}>
        O que está ligado, o que roda sozinho e as regras que valem agora. Nenhuma chave ou senha aparece aqui. “Configurado” quer dizer
        que a chave existe; o teste de conexão de cada serviço chega junto com a integração dele.
      </p>

      <section aria-label="Serviços" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: "1.25rem" }}>Serviços</h2>
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Serviço</th>
                <th>Para que serve</th>
                <th>Situação</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {servicos.map((s) => (
                <tr key={s.nome}>
                  <td>{s.nome}</td>
                  <td>{s.paraQue}</td>
                  <td>
                    <span className={styles.etiqueta} style={{ background: SELO[s.situacao].cor }}>
                      {SELO[s.situacao].texto}
                    </span>
                  </td>
                  <td>{s.detalhe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Automações" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: "1.25rem" }}>Automações</h2>
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Automação</th>
                <th>Quando roda</th>
                <th>Última vez</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {AUTOMACOES.map((a) => {
                const e = execucoes.get(a.id);
                return (
                  <tr key={a.id} className={a.situacao === "planejada" ? styles.inativo : undefined}>
                    <td>{a.nome}</td>
                    <td>{a.quando}</td>
                    <td>{a.situacao === "planejada" ? `chega no ${a.item}` : quando(e?.iniciadoEm ?? null)}</td>
                    <td>
                      {a.situacao === "planejada" ? (
                        "—"
                      ) : !e ? (
                        "ainda não rodou"
                      ) : e.ok === false ? (
                        <span className={styles.etiqueta} style={{ background: SELO.falha.cor }}>
                          {e.resumo}
                        </span>
                      ) : (
                        e.resumo || (e.ok ? "ok" : "em andamento")
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Regras em vigor" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: "1.25rem" }}>Regras em vigor</h2>
        <ul style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, paddingLeft: 18 }}>
          <li>
            Comissão calculada sobre {financeiras.base === "bruto" ? "o valor bruto pago pelo hóspede" : "o valor que o canal repassa (depois da taxa do canal)"}.{" "}
            <Link href="/painel/configuracoes/regras">Mudar</Link>
          </li>
          <li>Estadia entre meses: valor total (com limpeza) dividido igualmente por noite.</li>
          <li>Repasse e relatório mensal: dia 1º do mês seguinte.</li>
          <li>Mudança de regra vale daquela data para frente; o que já movimentou dinheiro não é recalculado.</li>
        </ul>
        {regras.length === 0 ? (
          <p>Nenhum imóvel ativo.</p>
        ) : (
          <div className={styles.rolagem}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Imóvel</th>
                  <th>Proprietário</th>
                  <th>Contrato hoje</th>
                  <th>Quem recebe, por canal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {regras.map((r) => (
                  <tr key={r.imovelId}>
                    <td>
                      {r.codigo} · {r.nome}
                    </td>
                    <td>{r.proprietario ?? <span style={{ color: "#7a2020" }}>sem proprietário</span>}</td>
                    <td>
                      {r.contrato ?? <span style={{ color: "#7a2020" }}>sem contrato vigente</span>}
                      {r.proximoContrato && <div style={{ fontSize: "0.8125rem", color: "var(--scl-texto-2)" }}>Próximo: {r.proximoContrato}</div>}
                    </td>
                    <td style={{ fontSize: "0.8125rem" }}>
                      {r.recebimento.map((x) => (
                        <div key={x.origem}>
                          {NOMES_ORIGEM[x.origem]}: {RECEBE[x.valor]}
                          {x.fonte === "imovel" && <strong> (do imóvel)</strong>}
                        </div>
                      ))}
                    </td>
                    <td>
                      <Link href={`/painel/imoveis/${r.imovelId}`}>Editar</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
