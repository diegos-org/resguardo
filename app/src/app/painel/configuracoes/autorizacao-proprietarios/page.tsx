import Link from "next/link";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { FormAutorizacaoProprietario } from "@/components/configuracoes/FormAutorizacaoProprietario";
import styles from "@/components/formularios.module.css";
import { publicarAutorizacaoAcao } from "@/configuracoes/acoes";
import { CAIXAS_AUTORIZACAO, enviosPorVersao, historicoDaAutorizacao, lerVersoesAutorizacao, versaoDaAutorizacaoEmVigor } from "@/configuracoes/autorizacao-proprietarios";
import { lerEmpresa } from "@/configuracoes/empresa";
import { getDb } from "@/db/client";
import { usuarios } from "@/db/schema";
import { dataBr, dataNoFuso } from "@/lib/datas";
import { FORMULARIOS_PROPRIETARIO, montarAutorizacao } from "@/proprietarios/autorizacao";

const dia = (d: Date) => dataNoFuso(d);
const nota = { fontSize: "0.875rem", color: "var(--scl-texto-2)", margin: 0, maxWidth: 820 } as const;

/**
 * Configurações → Autorização dos proprietários (M7.15): o texto da caixa de autorização de cada formulário de "Anuncie
 * seu imóvel" (pedido de contato e cadastro do marketplace), com o que aparece no site agora, o formulário que publica a
 * versão seguinte e o histórico das versões (a 1 é o texto que veio com o sistema), com quantos envios guardaram cada uma.
 * Fica numa aba própria, ao lado de "Página para proprietários": é um texto versionado, publicado como as páginas legais,
 * e não um texto que se salva por cima.
 */
export default async function AutorizacaoProprietarios() {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "configuracao:editar")) redirect("/painel/configuracoes");
  const db = getDb();
  const org = sessao.organizacaoId;
  const [empresa, caixas] = await Promise.all([
    lerEmpresa(db, org).then((e) => e.nome),
    Promise.all(
      FORMULARIOS_PROPRIETARIO.map(async (f) => {
        const [publicadas, envios] = await Promise.all([lerVersoesAutorizacao(db, org, f), enviosPorVersao(db, org, f)]);
        return { f, atual: versaoDaAutorizacaoEmVigor(f, publicadas), historico: historicoDaAutorizacao(f, publicadas), envios };
      }),
    ),
  ]);
  const autorIds = [...new Set(caixas.flatMap((c) => c.historico.map((v) => v.autorId)).filter((x): x is string => Boolean(x)))];
  const autores = autorIds.length
    ? new Map((await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(inArray(usuarios.id, autorIds))).map((u) => [u.id, u.nome]))
    : new Map<string, string>();
  return (
    <>
      <p style={nota}>
        O texto ao lado da caixa de autorização dos dois formulários da página <Link href="/anunciar">Anuncie seu imóvel</Link>. A caixa é obrigatória: é a autorização do uso dos
        dados que a lei de proteção de dados (LGPD) pede, e cada envio guarda o dia e a hora, a versão e o texto exato que a pessoa viu (em Proprietários → Pedidos de contato e
        Cadastros pelo site). Cada publicação com texto diferente vira uma <strong>versão nova, numerada e datada</strong>, que vale dali em diante: os envios já recebidos continuam
        com o texto que guardam, e quem estiver com a página aberta precisa ler e marcar de novo. A versão 1 é o texto que veio com o sistema. Os outros textos da página ficam em{" "}
        <Link href="/painel/configuracoes/pagina-proprietarios">Página para proprietários</Link>.
      </p>
      {caixas.map(({ f, atual, historico, envios }) => {
        const { titulo, onde } = CAIXAS_AUTORIZACAO[f];
        return (
          <section key={f} aria-labelledby={`titulo-${f}`} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 id={`titulo-${f}`} style={{ fontSize: "1.125rem", margin: 0 }}>
              {titulo}
            </h2>
            <p style={nota}>
              Onde aparece: {onde}. No site agora (versão {atual.numero}): &ldquo;{montarAutorizacao(atual.numero, atual.secoes.texto, empresa).texto}&rdquo;
            </p>
            <FormAutorizacaoProprietario formulario={f} titulo={titulo} atual={{ numero: atual.numero, data: atual.data }} valor={atual.secoes.texto} empresa={empresa} salvar={publicarAutorizacaoAcao} />
            <div className={styles.rolagem}>
              <table className={styles.tabela} aria-label={`Versões do texto: ${titulo}`}>
                <thead>
                  <tr>
                    <th>Versão</th>
                    <th>Publicada</th>
                    <th>Por</th>
                    <th>Envios registrados</th>
                    <th>Texto</th>
                  </tr>
                </thead>
                <tbody>
                  {[...historico].reverse().map((v) => {
                    const e = envios.get(v.numero);
                    return (
                      <tr key={v.numero}>
                        <td>
                          {v.numero}
                          {v.numero === atual.numero ? " (em vigor)" : ""}
                        </td>
                        <td>{v.data ? dataBr(v.data) : "veio com o sistema"}</td>
                        <td>{(v.autorId && autores.get(v.autorId)) || "—"}</td>
                        <td>{e ? `${e.envios}${e.primeiro ? ` (o primeiro em ${dia(e.primeiro)})` : ""}` : "nenhum"}</td>
                        <td style={{ whiteSpace: "normal", minWidth: 280 }}>&ldquo;{v.secoes.texto}&rdquo;</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
