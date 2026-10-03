import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";
import type { Db } from "./types";

const pastaApp = fileURLToPath(new URL("../..", import.meta.url));
const migrationsFolder = join(pastaApp, "drizzle");
/** Dentro de node_modules: nunca entra no Git e `npm ci` zera (no CI o banco é gerado uma vez por rodada). */
const pastaCache = join(pastaApp, "node_modules", ".cache", "scl-banco-de-teste");

/**
 * Banco Postgres em memória (PGlite) com todas as migrações aplicadas.
 * Uso exclusivo em testes: sem rede e sem credenciais.
 *
 * As migrações rodam **uma vez** (M0.8): o resultado fica guardado como um retrato do banco em
 * `node_modules/.cache`, e cada teste abre um PGlite novo a partir desse retrato. Cada banco
 * continua isolado dos demais (é uma instância nova por chamada); só o tempo de migrar some.
 * O nome do retrato carrega o hash das migrações e a versão do PGlite: mudou qualquer um, outro
 * retrato é gerado e o antigo é descartado.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite({ loadDataDir: await retratoMigrado() });
  const db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}

/** Gera o retrato se ainda não existir (chamado pelo `globalSetup` do Vitest antes dos testes). */
export async function prepararBancoDeTeste(): Promise<string> {
  const arquivo = caminhoDoRetrato();
  if (!existsSync(arquivo)) await gerarRetrato(arquivo);
  return arquivo;
}

let retratoEmMemoria: Blob | undefined;
async function retratoMigrado(): Promise<Blob> {
  if (!retratoEmMemoria) {
    const arquivo = await prepararBancoDeTeste();
    retratoEmMemoria = new Blob([readFileSync(arquivo)], { type: "application/x-tar" });
  }
  return retratoEmMemoria;
}

function caminhoDoRetrato(): string {
  return join(pastaCache, `migrado-${assinatura()}.tar`);
}

/** Hash do conteúdo de todas as migrações (SQL e diário) e da versão do PGlite. */
function assinatura(): string {
  const h = createHash("sha256");
  const arquivos = readdirSync(migrationsFolder)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => join(migrationsFolder, n));
  arquivos.push(join(migrationsFolder, "meta", "_journal.json"));
  for (const a of arquivos) {
    h.update(a.slice(migrationsFolder.length));
    h.update("\0");
    h.update(readFileSync(a));
    h.update("\0");
  }
  h.update(`pglite:${versaoDoPglite()}`);
  return h.digest("hex").slice(0, 16);
}

function versaoDoPglite(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(pastaApp, "node_modules", "@electric-sql", "pglite", "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "desconhecida";
  } catch {
    return "desconhecida";
  }
}

async function gerarRetrato(arquivo: string): Promise<void> {
  const client = new PGlite();
  try {
    await migrate(drizzle(client, { schema }), { migrationsFolder });
    // Sem compressão: carregar o tar puro é ~30% mais rápido que descomprimir (medido), e o arquivo
    // (~40 MB) fica fora do Git.
    const dump = await client.dumpDataDir("none");
    mkdirSync(pastaCache, { recursive: true });
    // Retratos de migrações antigas não servem mais.
    for (const antigo of readdirSync(pastaCache)) {
      if (antigo.startsWith("migrado-") && antigo.endsWith(".tar")) rmSync(join(pastaCache, antigo), { force: true });
    }
    // Escrita atômica: outro processo que chegue junto vê o arquivo inteiro ou não vê nada.
    const temporario = `${arquivo}.${process.pid}.${Date.now()}.parcial`;
    writeFileSync(temporario, Buffer.from(await dump.arrayBuffer()));
    renameSync(temporario, arquivo);
  } finally {
    await client.close();
  }
}
