import { Pool as NeonPool } from "@neondatabase/serverless";
import type { EventEmitter } from "node:events";
import { Pool as PgPool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MENSAGEM_DA_QUEDA_NO_MAXIMO, avisarQuedaDeConexao, resumoDaQueda } from "./client";

// Endereços fictícios: os testes só criam o pool, nunca abrem conexão (nada de rede nem da DATABASE_URL real).
const SENHA = "senha-de-teste-123";
const URL_NEON = `postgres://usuario:${SENHA}@ep-teste.exemplo.invalid/banco?sslmode=require`;
const URL_LOCAL = `postgres://usuario:${SENHA}@localhost:5432/banco`;

/** Imita o evento de erro do WebSocket que o Neon repassa ao pool: não é um `Error` e pode vir sem mensagem. */
class ErrorEvent {
  readonly type = "error";
  constructor(
    readonly message = "",
    readonly error?: unknown,
  ) {}
}

/** Imita o erro do Postgres (`DatabaseError` do pg), que tem o `name` genérico "error". */
class DatabaseError extends Error {
  constructor(
    mensagem: string,
    readonly code: string,
  ) {
    super(mensagem);
    this.name = "error";
  }
}

let pools: { end(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(pools.map((p) => p.end()));
  pools = [];
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** `getDb` de um módulo novo (sem a conexão guardada de outro teste) com `DATABASE_URL` fictícia; devolve o pool. */
async function poolDoGetDb(url: string): Promise<EventEmitter & { end(): Promise<void> }> {
  vi.stubEnv("DATABASE_URL", url);
  vi.resetModules();
  const cliente = await import("./client");
  const db = cliente.getDb();
  const pool = (db as unknown as { $client: EventEmitter & { end(): Promise<void> } }).$client;
  pools.push(pool);
  expect(pool.listeners("error")).toContain(cliente.avisarQuedaDeConexao);
  return pool;
}

describe("queda de conexão ociosa no pool", () => {
  it("sem ouvinte, o evento do Neon vira exceção não tratada (o erro visto em produção)", () => {
    const pool = new NeonPool({ connectionString: URL_NEON });
    pools.push(pool);
    expect(() => pool.emit("error", new ErrorEvent())).toThrow(/Unhandled error/);
  });

  it("Neon: getDb registra o ouvinte e a queda vira aviso, sem lançar e sem a connection string", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pool = await poolDoGetDb(URL_NEON);
    expect(pool).toBeInstanceOf(NeonPool);

    expect(() => pool.emit("error", new ErrorEvent())).not.toThrow();

    expect(aviso).toHaveBeenCalledTimes(1);
    const texto = String(aviso.mock.calls[0][0]);
    expect(texto).toBe("[banco] conexão ociosa caiu e foi descartada; a próxima consulta abre outra (ErrorEvent: sem mensagem)");
    expect(texto).not.toContain(SENHA);
    expect(texto).not.toContain("ep-teste");
  });

  it("Postgres local: getDb registra o ouvinte e a queda vira aviso, sem lançar", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pool = await poolDoGetDb(URL_LOCAL);
    expect(pool).toBeInstanceOf(PgPool);

    expect(() => pool.emit("error", new DatabaseError("terminating connection due to administrator command", "57P01"))).not.toThrow();

    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0][0])).toContain("(DatabaseError: terminating connection due to administrator command)");
  });

  it("o pool continua com um ouvinte só, e uma segunda queda também vira aviso", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pool = await poolDoGetDb(URL_NEON);
    expect(pool.listenerCount("error")).toBe(1);
    pool.emit("error", new ErrorEvent());
    pool.emit("error", new Error("read ECONNRESET"));
    expect(aviso).toHaveBeenCalledTimes(2);
  });

  it("nunca lança, nem se o próprio registro do aviso falhar", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("registro indisponível");
    });
    expect(() => avisarQuedaDeConexao(new ErrorEvent())).not.toThrow();
  });
});

describe("resumoDaQueda", () => {
  it("tira a senha e o endereço que vierem na mensagem", () => {
    const resumo = resumoDaQueda(new Error(`falha ao conectar em ${URL_NEON}`));
    expect(resumo).not.toContain(SENHA);
    expect(resumo).toContain("[credenciais]@");
    expect(resumo.startsWith("Error: falha ao conectar em ")).toBe(true);
  });

  it("tira a senha inteira mesmo quando ela tem um caractere que encerra o endereço", () => {
    const resumo = resumoDaQueda(new Error("falha em postgresql://usuario:hunter2)abc@banco.exemplo.com/scl"));
    expect(resumo).not.toContain("hunter2");
    expect(resumo).toBe("Error: falha em postgresql://[credenciais]@banco.exemplo.com/scl");
  });

  it("tira dados pessoais pela mesma limpeza dos avisos", () => {
    const resumo = resumoDaQueda(new Error("falha para fulano@exemplo.com"));
    expect(resumo).toBe("Error: falha para [e-mail]");
  });

  it("corta a mensagem longa", () => {
    const resumo = resumoDaQueda(new Error("a".repeat(500)));
    expect(resumo).toBe(`Error: ${"a".repeat(MENSAGEM_DA_QUEDA_NO_MAXIMO)}…`);
  });

  it("usa o erro de dentro do evento do WebSocket quando o evento vem sem mensagem", () => {
    expect(resumoDaQueda(new ErrorEvent("", new Error("socket hang up")))).toBe("ErrorEvent: socket hang up");
    expect(resumoDaQueda(new ErrorEvent("Connection terminated unexpectedly"))).toBe("ErrorEvent: Connection terminated unexpectedly");
  });

  it("o tipo vem do nome do erro, ou da classe quando o nome é genérico", () => {
    const tipado = new Error("x");
    tipado.name = "TimeoutError";
    expect(resumoDaQueda(tipado)).toBe("TimeoutError: x");
    expect(resumoDaQueda(new DatabaseError("y", "57P01"))).toBe("DatabaseError: y");
    expect(resumoDaQueda({ name: "nome com espaço", message: "z" })).toBe("Erro: z");
  });

  it("não quebra com o que não é objeto", () => {
    expect(resumoDaQueda(undefined)).toBe("erro sem detalhe");
    expect(resumoDaQueda("texto")).toBe("erro sem detalhe");
    expect(resumoDaQueda({})).toBe("Erro: sem mensagem");
  });
});
