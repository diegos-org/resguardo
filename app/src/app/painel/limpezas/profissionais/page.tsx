import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { BotaoConfirmar } from "@/components/BotaoConfirmar";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { manterFiltros } from "@/lib/filtros";
import { acessosDasProfissionais } from "@/equipe/equipe";
import {
  acessoProfissionalAcao,
  criarProfissionalAcao,
  editarProfissionalAcao,
} from "@/limpezas/acoes";
import { listarProfissionais } from "@/limpezas/limpezas";

/** Profissionais de limpeza: cadastrar, corrigir e arquivar (quem já trabalhou não é apagado). */
export default async function Profissionais({
  searchParams,
}: PageProps<"/painel/limpezas/profissionais">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "limpeza:editar")) redirect("/painel/limpezas");
  const params = await searchParams;
  const [lista, acessos] = await Promise.all([
    listarProfissionais(getDb(), sessao.organizacaoId, {
      incluirArquivados: true,
    }),
    acessosDasProfissionais(getDb(), sessao.organizacaoId),
  ]);
  const q = manterFiltros(params);
  const voltar = q.slice(1);
  const erro = typeof params.erro === "string" ? params.erro : undefined;
  return (
    <>
      <h1>Profissionais de limpeza</h1>
      <p>
        <Link href={`/painel/limpezas${q}`}>← Voltar para limpezas</Link>
      </p>
      {params.salvo === "1" && (
        <p role="status" className={styles.sucesso}>
          Salvo.
        </p>
      )}
      {erro && (
        <p role="alert" className={styles.alerta}>
          {erro}
        </p>
      )}
      <form
        action={criarProfissionalAcao}
        className={styles.form}
        aria-label="Nova profissional"
      >
        <h2 style={{ fontSize: "1.125rem", margin: 0 }}>Nova profissional</h2>
        <input type="hidden" name="voltar" value={voltar} />
        <div className={styles.linha}>
          <label>
            Nome
            <input name="nome" required maxLength={120} />
          </label>
          <label>
            Telefone
            <input name="telefone" maxLength={40} inputMode="tel" />
          </label>
          <label className={styles.largo}>
            Observações
            <input
              name="observacoes"
              maxLength={500}
              placeholder="ex.: substituta aos fins de semana"
            />
          </label>
        </div>
        <div className={styles.acoes}>
          <button type="submit">Cadastrar</button>
        </div>
      </form>
      <p
        style={{
          color: "var(--scl-texto-2)",
          fontSize: "0.875rem",
          margin: 0,
          maxWidth: 820,
        }}
      >
        Acesso pelo celular: a profissional entra com o e-mail dela (código por
        e-mail), vê só as limpezas dela e marca como feita. Não vê custos nem
        nada do financeiro. Quando uma limpeza é confirmada com ela, recebe um
        e-mail.
      </p>
      {lista.map((p) => (
        <div
          key={p.id}
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
        >
          <form
            action={editarProfissionalAcao}
            className={styles.form}
            aria-label={`Editar ${p.nome}`}
          >
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="voltar" value={voltar} />
            <div className={styles.linha}>
              <label>
                Nome
                <input
                  name="nome"
                  required
                  maxLength={120}
                  defaultValue={p.nome}
                />
              </label>
              <label>
                Telefone
                <input
                  name="telefone"
                  maxLength={40}
                  inputMode="tel"
                  defaultValue={p.telefone}
                />
              </label>
              <label className={styles.largo}>
                Observações
                <input
                  name="observacoes"
                  maxLength={500}
                  defaultValue={p.observacoes}
                />
              </label>
              <label
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flex: "0 0 auto",
                }}
              >
                <input type="checkbox" name="ativo" defaultChecked={p.ativo} />{" "}
                Ativa
              </label>
            </div>
            <div className={styles.acoes}>
              <button type="submit">Salvar</button>
              {!p.ativo && (
                <span style={{ color: "var(--scl-texto-2)" }}>
                  Arquivada: não aparece para novas limpezas nem entra pelo
                  celular.
                </span>
              )}
            </div>
          </form>
          {p.ativo && (
            <form
              action={acessoProfissionalAcao}
              className={styles.linha}
              style={{ alignItems: "flex-end" }}
              aria-label={`Acesso de ${p.nome}`}
            >
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="voltar" value={voltar} />
              <label style={{ flex: "1 1 240px" }}>
                Acesso pelo celular (e-mail)
                <input
                  name="email"
                  type="email"
                  maxLength={200}
                  defaultValue={acessos.get(p.id)?.email ?? ""}
                  placeholder="e-mail da profissional"
                />
              </label>
              <div className={styles.acoes}>
                <BotaoConfirmar
                  pergunta={`Liberar o acesso de ${p.nome} pelo celular com este e-mail?`}
                  className={styles.pequeno}
                  name="op"
                  value="dar"
                >
                  {acessos.get(p.id)?.ativo
                    ? "Salvar e-mail"
                    : "Liberar acesso"}
                </BotaoConfirmar>
                {acessos.get(p.id)?.ativo && (
                  <BotaoConfirmar
                    pergunta={`Tirar o acesso de ${p.nome}? Ela deixa de entrar na hora.`}
                    className={styles.pequeno}
                    name="op"
                    value="tirar"
                  >
                    Tirar acesso
                  </BotaoConfirmar>
                )}
                <span
                  style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)" }}
                >
                  {acessos.get(p.id)?.ativo
                    ? "Com acesso"
                    : acessos.get(p.id)
                      ? "Acesso retirado"
                      : "Sem acesso"}
                </span>
              </div>
            </form>
          )}
        </div>
      ))}
    </>
  );
}
