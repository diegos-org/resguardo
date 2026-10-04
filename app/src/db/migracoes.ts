/**
 * Aplicação das migrações no build (M12.4, 20ª rodada do Codex). O migrador do Drizzle aplica só o que tem data
 * (`when` do journal) maior que a da última migração registrada em `drizzle.__drizzle_migrations`. O banco de
 * preview é um só para todos os PRs: dois branches geram migrações em ordem de data cruzada, e a de um branch, já
 * registrada, faz o migrador pular as do outro que vierem com data menor — mesmo que nunca tenham rodado ali. Por
 * isso o build aplica **por hash**: toda migração do journal cujo hash não está registrado roda, na ordem do journal,
 * cada uma na própria transação, e é registrada como o Drizzle registraria (mesmo hash, mesma data). Um banco em dia
 * não muda nada; um banco com histórico fora de ordem fica completo.
 */

/** Executa um comando SQL (cliente do `pg`, do Neon ou do PGlite). */
export type Executor = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

/** O que `readMigrationFiles` do Drizzle devolve por entrada do journal. */
export type Migracao = { hash: string; folderMillis: number; sql: string[] };

const TABELA = '"drizzle"."__drizzle_migrations"';

/** Aplica, na ordem do journal, as migrações cujo hash ainda não está registrado. Devolve quantas aplicou. */
export async function aplicarMigracoesPendentes(executar: Executor, migracoes: readonly Migracao[]): Promise<number> {
  await executar('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await executar(`CREATE TABLE IF NOT EXISTS ${TABELA} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
  const registradas = new Set((await executar(`select hash from ${TABELA}`)).rows.map((r) => (r as { hash: string }).hash));
  let aplicadas = 0;
  for (const m of migracoes) {
    if (registradas.has(m.hash)) continue;
    await executar("begin");
    try {
      for (const stmt of m.sql) if (stmt.trim()) await executar(stmt);
      await executar(`insert into ${TABELA} ("hash", "created_at") values ($1, $2)`, [m.hash, m.folderMillis]);
      await executar("commit");
    } catch (e) {
      await executar("rollback");
      throw e;
    }
    aplicadas++;
  }
  return aplicadas;
}
