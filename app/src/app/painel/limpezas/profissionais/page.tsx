import Link from "next/link";
import { redirect } from "next/navigation";
import { podeFazer } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import styles from "@/components/formularios.module.css";
import { getDb } from "@/db/client";
import { manterFiltros } from "@/lib/filtros";
import { criarProfissionalAcao, editarProfissionalAcao } from "@/limpezas/acoes";
import { listarProfissionais } from "@/limpezas/limpezas";

/** Profissionais de limpeza: cadastrar, corrigir e arquivar (quem já trabalhou não é apagado). */
export default async function Profissionais({ searchParams }: PageProps<"/painel/limpezas/profissionais">) {
  const sessao = await exigirSessaoPainel();
  if (!podeFazer(sessao.papel, "limpeza:editar")) redirect("/painel/limpezas");
  const params = await searchParams;
  const lista = await listarProfissionais(getDb(), sessao.organizacaoId, { incluirArquivados: true });
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
      <form action={criarProfissionalAcao} className={styles.form} aria-label="Nova profissional">
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
            <input name="observacoes" maxLength={500} placeholder="ex.: substituta aos fins de semana" />
          </label>
        </div>
        <div className={styles.acoes}>
          <button type="submit">Cadastrar</button>
        </div>
      </form>
      {lista.map((p) => (
        <form key={p.id} action={editarProfissionalAcao} className={styles.form} aria-label={`Editar ${p.nome}`}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="voltar" value={voltar} />
          <div className={styles.linha}>
            <label>
              Nome
              <input name="nome" required maxLength={120} defaultValue={p.nome} />
            </label>
            <label>
              Telefone
              <input name="telefone" maxLength={40} inputMode="tel" defaultValue={p.telefone} />
            </label>
            <label className={styles.largo}>
              Observações
              <input name="observacoes" maxLength={500} defaultValue={p.observacoes} />
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", flex: "0 0 auto" }}>
              <input type="checkbox" name="ativo" defaultChecked={p.ativo} /> Ativa
            </label>
          </div>
          <div className={styles.acoes}>
            <button type="submit">Salvar</button>
            {!p.ativo && <span style={{ color: "var(--scl-texto-2)" }}>Arquivada: não aparece para novas limpezas.</span>}
          </div>
        </form>
      ))}
    </>
  );
}
