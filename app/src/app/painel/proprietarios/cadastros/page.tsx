import Link from "next/link";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { AutorizacaoRegistrada } from "@/components/proprietarios/AutorizacaoRegistrada";
import { DecisaoCadastro } from "@/components/proprietarios/DecisaoCadastro";
import { getDb } from "@/db/client";
import { aprovarCadastroAcao, recusarCadastroAcao } from "@/marketplace/acoes";
import { listarCadastros } from "@/marketplace/cadastro";

const data = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

/** Cadastros de proprietários marketplace vindos do site (M12.3): revisar antes de qualquer coisa existir. */
export default async function CadastrosMarketplace() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "proprietario:editar")) {
    return (
      <>
        <h1>Cadastros pelo site</h1>
        <p>Esta área tem dados pessoais e é restrita aos administradores.</p>
      </>
    );
  }
  const { pendentes, decididos } = await listarCadastros(getDb(), sessao.organizacaoId);
  return (
    <>
      <div className={styles.topo}>
        <h1>Cadastros pelo site</h1>
        <Link href="/painel/proprietarios">Voltar para Proprietários</Link>
      </div>
      <p style={{ color: "var(--scl-texto-2)", fontSize: "0.875rem", maxWidth: 820 }}>
        Proprietários que se cadastraram em &ldquo;Anuncie seu imóvel&rdquo; no site. Aprovar cria o proprietário, o imóvel (ainda <strong>não público</strong> —
        publicar é no cadastro do imóvel) e manda o convite do portal para o e-mail confirmado. Depois, complete documento, Pix e contrato na ficha do
        proprietário.
      </p>
      {pendentes.length === 0 ? (
        <p>Nenhum cadastro esperando análise.</p>
      ) : (
        pendentes.map((c) => (
          <section key={c.id} aria-label={`Cadastro de ${c.nome}`} className={styles.form} style={{ maxWidth: 820 }}>
            <h2 style={{ fontSize: "1.125rem", margin: 0 }}>
              {c.imovel.nome} · {c.imovel.bairro}, {c.imovel.cidade}
            </h2>
            <dl style={{ display: "grid", gridTemplateColumns: "minmax(140px, max-content) 1fr", gap: "4px 16px", margin: 0 }}>
              <dt>Proprietário</dt>
              <dd>
                {c.nome} ({c.tipo === "juridica" ? "empresa" : "pessoa física"}) · {c.email} · {c.telefone}
              </dd>
              <dt>Endereço</dt>
              <dd>{c.imovel.endereco}</dd>
              <dt>Imóvel</dt>
              <dd>
                {c.imovel.capacidade} pessoas{c.imovel.quartos !== null ? ` · ${c.imovel.quartos} quarto(s)` : ""}
                {c.imovel.banheiros !== null ? ` · ${c.imovel.banheiros} banheiro(s)` : ""}
              </dd>
              {c.imovel.descricao && (
                <>
                  <dt>Descrição</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{c.imovel.descricao}</dd>
                </>
              )}
              <dt>Anúncio</dt>
              <dd>
                {c.anuncio === "novo"
                  ? "Quer um anúncio novo"
                  : c.links.map((l) => (
                      <span key={l} style={{ display: "block", wordBreak: "break-all" }}>
                        {/* Link digitado pela pessoa: abre fora, sem passar dados do painel. */}
                        <a href={l} target="_blank" rel="noopener noreferrer nofollow">
                          {l}
                        </a>
                      </span>
                    ))}
              </dd>
              <dt>Recebido em</dt>
              <dd>{data(c.criadoEm)}</dd>
              <dt>Autorização</dt>
              <dd>
                <AutorizacaoRegistrada registro={c} />
              </dd>
            </dl>
            <DecisaoCadastro id={c.id} nome={c.nome} aprovar={aprovarCadastroAcao} recusar={recusarCadastroAcao} />
          </section>
        ))
      )}
      {decididos.length > 0 && (
        <div className={styles.rolagem}>
          <table className={styles.tabela}>
            <caption style={{ textAlign: "left", fontWeight: 600 }}>Decididos recentemente</caption>
            <thead>
              <tr>
                <th>Imóvel</th>
                <th>Proprietário</th>
                <th>Decisão</th>
                <th>Quando</th>
                <th>Autorização</th>
              </tr>
            </thead>
            <tbody>
              {decididos.map((c) => (
                <tr key={c.id}>
                  <td>{c.imovelId ? <Link href={`/painel/imoveis/${c.imovelId}`}>{c.imovel.nome}</Link> : c.imovel.nome}</td>
                  <td>{c.proprietarioId ? <Link href={`/painel/proprietarios/${c.proprietarioId}`}>{c.nome}</Link> : c.nome}</td>
                  <td>{c.situacao === "aprovado" ? "Aprovado" : `Recusado: ${c.motivoRecusa}`}</td>
                  <td>{c.decididoEm ? data(c.decididoEm) : "—"}</td>
                  <td>
                    <AutorizacaoRegistrada registro={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
