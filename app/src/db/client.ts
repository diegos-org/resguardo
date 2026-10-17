import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as PgPool } from "pg";
import { limparTexto } from "../observabilidade/limpeza";
import * as schema from "./schema";
import type { Db } from "./types";

let cached: Db | undefined;

/** Postgres local (desenvolvimento/testes manuais) usa o driver comum; o resto é Neon. */
export function ehBancoLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Até quantas letras da mensagem do erro vão para o aviso de queda de conexão. */
export const MENSAGEM_DA_QUEDA_NO_MAXIMO = 160;
const RE_TIPO = /^[A-Za-z_$][\w$]{0,63}$/;

/**
 * "Tipo: mensagem curta" de um erro do pool, para o aviso de queda de conexão. Serve para um `Error` e para o evento de
 * erro do WebSocket (`ErrorEvent`, que não é um `Error` e às vezes traz o erro de verdade em `.error`). O tipo é o
 * `name` ou, quando ele é o genérico "Error"/"error" (como no erro do Postgres), o nome da classe. A mensagem passa pela
 * limpeza dos avisos (`limparTexto`: credenciais de endereço, e-mail, CPF etc. viram marcador) e é cortada em
 * `MENSAGEM_DA_QUEDA_NO_MAXIMO` letras.
 */
export function resumoDaQueda(erro: unknown): string {
  if (erro === null || typeof erro !== "object") return "erro sem detalhe";
  const { name, message, error: interno } = erro as { name?: unknown; message?: unknown; error?: unknown };
  const classe = erro.constructor?.name;
  const generico = typeof name !== "string" || /^error$/i.test(name);
  const nome = generico && classe && classe !== "Object" ? classe : name;
  const tipo = typeof nome === "string" && RE_TIPO.test(nome) ? nome : "Erro";
  const bruta = typeof message === "string" && message ? message : interno instanceof Error ? interno.message : "";
  const limpa = limparTexto(bruta).replace(/\s+/g, " ").trim();
  const curta = limpa.length > MENSAGEM_DA_QUEDA_NO_MAXIMO ? `${limpa.slice(0, MENSAGEM_DA_QUEDA_NO_MAXIMO)}…` : limpa;
  return `${tipo}: ${curta || "sem mensagem"}`;
}

/**
 * Ouvinte do evento "error" do pool. O pool só emite esse evento quando uma conexão **ociosa** cai (o Neon fecha o
 * WebSocket de uma conexão parada; o Postgres local também pode encerrá-la). Ele já descartou essa conexão e a próxima
 * consulta abre outra, então não é falha de nenhum pedido. Sem ouvinte, o Node transformava o evento em exceção não
 * tratada ("Unhandled error", visto na rotina das cotações desde 27/09/2026).
 *
 * Aqui vira só um aviso no registro do servidor, sem a connection string e sem dados: o tipo e a mensagem curta e limpa
 * do erro (`resumoDaQueda`). Não vai ao Sentry nem por e-mail: a queda ociosa é rotina, e se o banco estiver mesmo fora
 * do ar a consulta seguinte falha e segue o caminho normal dos avisos (M0.9). Nunca lança.
 */
export function avisarQuedaDeConexao(erro: unknown): void {
  try {
    console.warn(`[banco] conexão ociosa caiu e foi descartada; a próxima consulta abre outra (${resumoDaQueda(erro)})`);
  } catch {
    // O aviso é um extra: a queda já foi tratada pelo pool.
  }
}

/**
 * Conexão a partir de `DATABASE_URL` (configurada na Vercel/ambiente).
 * No Neon usa o driver com WebSocket (Pool), que suporta transações — gravar um dado e
 * seu histórico precisa ser tudo-ou-nada. Nos dois casos o pool ouve o evento "error"
 * (`avisarQuedaDeConexao`), para a queda de uma conexão ociosa não derrubar a função.
 */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL não configurada");
  }
  if (ehBancoLocal(url)) {
    const pool = new PgPool({ connectionString: url });
    pool.on("error", avisarQuedaDeConexao);
    cached = drizzlePg(pool, { schema });
  } else {
    const pool = new NeonPool({ connectionString: url });
    pool.on("error", avisarQuedaDeConexao);
    cached = drizzleNeon(pool, { schema });
  }
  return cached;
}
