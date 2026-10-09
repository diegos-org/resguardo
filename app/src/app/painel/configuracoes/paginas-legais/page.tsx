import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormPaginaLegal } from "@/components/configuracoes/FormPaginaLegal";
import styles from "@/components/formularios.module.css";
import { publicarPaginaLegalAcao } from "@/configuracoes/acoes";
import { versaoAtual } from "@/configuracoes/documentos-versionados";
import { lerEmpresa } from "@/configuracoes/empresa";
import { camposDesatualizados, lerPaginasLegais } from "@/configuracoes/paginas-legais";
import { RASCUNHO_PAGINAS_LEGAIS } from "@/configuracoes/paginas-legais-rascunho";
import { CAMPOS_LEGAIS, DOCUMENTOS_LEGAIS, type DocumentoLegal, noMeioDaFrase, PAGINAS_LEGAIS, rotuloDoCampo, valoresDisponiveis } from "@/configuracoes/paginas-legais-texto";
import { getDb } from "@/db/client";
import { usuarios } from "@/db/schema";
import { contarAceitesPorVersao } from "@/site/aceites";

const br = (d: string) => d.split("-").reverse().join("/");
const nota = { fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 } as const;
const lista = (itens: string[]) => (itens.length > 1 ? `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}` : (itens[0] ?? ""));

/**
 * Configurações → Páginas legais do site (M7.4): Termos de uso, Política de privacidade e Política de cancelamento.
 * Um documento por vez (`?doc=`), com a situação dos três, os avisos (dados da empresa mudaram depois da versão), o
 * formulário com prévia e o histórico de versões, com quantos aceites cada versão teve no site.
 */
export default async function PaginasLegais({ searchParams }: PageProps<"/painel/configuracoes/paginas-legais">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const { doc: pedido } = await searchParams;
  // Lista fechada: qualquer outro valor abre os Termos de uso.
  const doc: DocumentoLegal = typeof pedido === "string" && (DOCUMENTOS_LEGAIS as readonly string[]).includes(pedido) ? (pedido as DocumentoLegal) : "termos";
  const db = getDb();
  const [todas, empresa, aceites] = await Promise.all([lerPaginasLegais(db, sessao.organizacaoId), lerEmpresa(db, sessao.organizacaoId), contarAceitesPorVersao(db, sessao.organizacaoId)]);
  const versoes = todas[doc];
  const atual = versaoAtual(versoes);
  const autorIds = [...new Set(versoes.map((v) => v.autorId).filter((x): x is string => Boolean(x)))];
  const autores = autorIds.length
    ? new Map((await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, autorIds))).map((u) => [u.id, u.nome]))
    : new Map<string, string>();
  const faltaPublicar = DOCUMENTOS_LEGAIS.filter((d) => !versaoAtual(todas[d])).map((d) => PAGINAS_LEGAIS[d].titulo);
  // Dados da empresa usados na versão em vigor que mudaram depois (o site continua com os da versão até publicar de novo).
  const desatualizados = atual ? camposDesatualizados(atual, valoresDisponiveis(empresa, atual.regras)) : [];
  const empresaAgora = valoresDisponiveis(empresa, null);
  const rascunho = RASCUNHO_PAGINAS_LEGAIS[doc];
  const { rota, titulo } = PAGINAS_LEGAIS[doc];
  return (
    <>
      <p style={nota}>
        As três páginas legais do site: <strong>Termos de uso</strong>, <strong>Política de privacidade</strong> e <strong>Política de cancelamento</strong>, com links no
        rodapé de todas as páginas. Cada publicação vira uma <strong>versão numerada e datada</strong>, e as anteriores continuam no site. O site só oferece pagamento com as
        três publicadas: antes de gerar o Pix, o hóspede lê o resumo da política de cancelamento e marca que aceita; quem já pagou fica com a versão que aceitou. O texto-base
        foi escrito pelo Claude a partir da lei e ainda não foi conferido por um advogado — os pontos a conferir estão no guia.
      </p>
      <nav aria-label="Documentos" style={{ fontSize: "0.875rem" }}>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          {DOCUMENTOS_LEGAIS.map((d) => {
            const v = versaoAtual(todas[d]);
            const situacao = v ? `versão ${v.numero}, de ${br(v.data)}` : "não publicada";
            return (
              <li key={d}>
                {/* <a> e não <Link>: navegação completa, para o aviso de "sair sem publicar" valer também aqui. */}
                <a href={`/painel/configuracoes/paginas-legais?doc=${d}`} aria-current={d === doc ? "page" : undefined} style={d === doc ? { fontWeight: 700 } : undefined}>
                  {PAGINAS_LEGAIS[d].titulo}
                </a>{" "}
                — {situacao}
              </li>
            );
          })}
        </ul>
      </nav>
      {faltaPublicar.length > 0 && (
        <p role="note" className={styles.alerta} style={{ margin: 0 }}>
          O site ainda não oferece pagamento: falta publicar {lista(faltaPublicar)}.
        </p>
      )}
      {atual && desatualizados.length > 0 && (
        <p role="note" className={styles.alerta} style={{ margin: 0 }}>
          Os dados da empresa mudaram depois da versão {atual.numero} ({lista(desatualizados.map((k) => noMeioDaFrase(rotuloDoCampo(k))))}): publique de novo para o site mostrar os
          dados atuais. Até lá, a página continua com os dados da versão {atual.numero}.
        </p>
      )}
      <h2 style={{ fontSize: "1.125rem", margin: 0 }}>{titulo}</h2>
      <FormPaginaLegal
        key={doc}
        documento={doc}
        atual={atual ? { numero: atual.numero, data: atual.data } : null}
        valores={atual?.secoes ?? rascunho.secoes}
        dias={doc === "cancelamento" ? (atual?.regras?.diasReembolsoIntegral ?? rascunho.diasReembolsoIntegral) : null}
        campos={CAMPOS_LEGAIS.filter((c) => !("so" in c)).map((c) => ({ chave: c.chave, rotulo: c.rotulo, valor: empresaAgora[c.chave] ?? "" }))}
        salvar={publicarPaginaLegalAcao}
      />
      <section aria-label="Versões publicadas" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Versões publicadas</h2>
        {versoes.length === 0 ? (
          <p style={nota}>Nenhuma versão publicada ainda: a página {rota} diz que está em preparação.</p>
        ) : (
          <div className={styles.rolagem}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Data</th>
                  <th>Por</th>
                  <th>Aceites</th>
                  <th>No site</th>
                </tr>
              </thead>
              <tbody>
                {[...versoes].reverse().map((v) => (
                  <tr key={v.numero}>
                    <td>
                      {v.numero}
                      {v.numero === atual?.numero ? " (em vigor)" : ""}
                    </td>
                    <td>{br(v.data)}</td>
                    <td>{(v.autorId && autores.get(v.autorId)) || "—"}</td>
                    <td>{aceites[doc].get(v.numero) ?? 0}</td>
                    <td>
                      <a href={`${rota}?versao=${v.numero}`} target="_blank" rel="noopener noreferrer">
                        Ver a versão {v.numero}
                      </a>
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
