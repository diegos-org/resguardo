import Link from "next/link";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormComoFunciona } from "@/components/configuracoes/FormComoFunciona";
import styles from "@/components/formularios.module.css";
import { publicarComoFuncionaAcao } from "@/configuracoes/acoes";
import { lerComoFunciona, RASCUNHO_COMO_FUNCIONA, versaoAtual } from "@/configuracoes/como-funciona";
import { getDb } from "@/db/client";
import { usuarios } from "@/db/schema";
import { dataBr, dataHoraNoFuso } from "@/lib/datas";
import { situacaoDosProprietarios } from "@/portal/aceites";

const quando = (d: Date) => dataHoraNoFuso(d);

/** Configurações → Como funciona (proprietário), M5.6: texto por seção, versões e quem aceitou. */
export default async function ComoFunciona() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const db = getDb();
  const versoes = await lerComoFunciona(db, sessao.organizacaoId);
  const atual = versaoAtual(versoes);
  const autorIds = [...new Set(versoes.map((v) => v.autorId).filter((x): x is string => Boolean(x)))];
  const [situacao, autores] = await Promise.all([
    situacaoDosProprietarios(db, sessao.organizacaoId, atual),
    autorIds.length ? db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, autorIds)).then((l) => new Map(l.map((u) => [u.id, u.nome]))) : Promise.resolve(new Map<string, string>()),
  ]);
  const ativos = situacao.filter((s) => s.ativo);
  const autor = (id: string | null) => (id && autores.get(id) ? ` por ${autores.get(id)}` : "");
  return (
    <>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 }}>
        O documento &ldquo;Como funciona&rdquo; que o proprietário lê no portal e aceita ao entrar pelo convite (ou depois, no próprio portal): o que a empresa faz, comissão e taxas,
        quando e como ele recebe, relatórios, cancelamentos. Cada publicação com texto diferente vira uma <strong>versão nova, datada</strong>, e todos os proprietários precisam
        aceitar de novo; o sistema guarda quem aceitou qual versão e quando. O que é dado do cadastro (tipo e comissão do contrato de cada imóvel, periodicidade escolhida) o portal mostra
        sozinho, no quadro &ldquo;Seus dados&rdquo; — não escreva no texto.
      </p>
      <p style={{ fontSize: "0.875rem", margin: 0 }}>
        {atual ? (
          <>
            <strong>Versão atual: {atual.numero}</strong>, publicada em {dataBr(atual.data)}
            {autor(atual.autorId)}. {ativos.filter((s) => s.aceitouAtual).length} de {ativos.length} proprietário(s) ativo(s) já aceitou(aram).
          </>
        ) : (
          <strong>Nenhuma versão publicada: o portal ainda não mostra o documento.</strong>
        )}
      </p>
      <FormComoFunciona atual={atual ? { numero: atual.numero, data: atual.data } : null} valores={atual?.secoes ?? RASCUNHO_COMO_FUNCIONA} salvar={publicarComoFuncionaAcao} />
      {atual && (
        <section aria-label="Quem já aceitou" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Quem já aceitou</h2>
          {ativos.length === 0 ? (
            <p style={{ margin: 0, fontSize: "0.875rem" }}>Nenhum proprietário ativo.</p>
          ) : (
            <div className={styles.rolagem}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Proprietário</th>
                    <th>Acesso ao portal</th>
                    <th>Aceite</th>
                  </tr>
                </thead>
                <tbody>
                  {ativos.map((s) => (
                    <tr key={s.proprietarioId}>
                      <td>
                        <Link href={`/painel/proprietarios/${s.proprietarioId}`}>{s.nome}</Link>
                      </td>
                      <td>{s.temAcesso ? "Sim" : "Sem acesso (convide na página dele)"}</td>
                      <td style={{ whiteSpace: "normal" }}>
                        {s.aceite
                          ? `Versão ${s.aceite.versao} em ${quando(s.aceite.aceitoEm)} (${s.aceite.email})${s.aceitouAtual ? "" : ` — falta aceitar a versão ${atual.numero}`}`
                          : "Ainda não aceitou"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {versoes.length > 1 && (
        <details style={{ fontSize: "0.875rem" }}>
          <summary style={{ cursor: "pointer" }}>Versões anteriores ({versoes.length - 1})</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {[...versoes]
              .reverse()
              .slice(1)
              .map((v) => (
                <li key={v.numero}>
                  Versão {v.numero} — {dataBr(v.data)}
                  {autor(v.autorId)}
                </li>
              ))}
          </ul>
        </details>
      )}
    </>
  );
}
