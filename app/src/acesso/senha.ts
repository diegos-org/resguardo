/**
 * Entrar com usuário (ou e-mail) e senha (M6.8, decisão de Diego em 7/10: "e-mail não vai funcionar" para a equipe;
 * vários jeitos de entrar, sem verificação em duas etapas). A senha nunca é guardada: só o hash scrypt, com sal
 * próprio e os parâmetros junto (dá para endurecer depois sem perder as senhas antigas). Depois de muitos erros para o
 * mesmo usuário digitado — exista ele ou não —, é preciso esperar: a resposta é a mesma nos dois casos. Antes de qualquer
 * conferência (o scrypt custa memória e tempo) há dois tetos de tentativas, um por endereço de origem e um geral, e as
 * contas velhas são apagadas: variar o usuário digitado não abre conferências sem fim nem enche a tabela.
 */
import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { tentativasLogin, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { normalizarLogin, SENHA_MAXIMA } from "./senha-regras";

export { normalizarLogin, SENHA_MAXIMA, SENHA_MINIMA, validarLogin, validarSenha } from "./senha-regras";

export const MAX_ERROS = 5;
export const ESPERA_MS = 15 * 60_000;
/** Tetos antes da conferência: por endereço de origem (IP) e no total (a equipe é pequena; sobra muito). */
export const LIMITE_POR_ORIGEM = { tentativas: 20, janelaMs: 15 * 60_000 } as const;
export const LIMITE_GERAL = { tentativas: 60, janelaMs: 60_000 } as const;
/** Conta parada há mais de um dia (e sem espera em curso) é apagada. */
export const GUARDA_CONTAS_MS = 24 * 60 * 60_000;

/** Custo do scrypt (2^15, bloco 8): ~32 MB e uma fração de segundo por conferência. */
const LOG_N = 15;
const R = 8;
const P = 1;
const TAMANHO = 64;

function derivar(senha: string, sal: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((ok, falha) =>
    scrypt(senha.normalize("NFKC"), sal, TAMANHO, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (e, chave) => (e ? falha(e) : ok(chave))),
  );
}

/** Hash para guardar: `scrypt$<log2 N>$<r>$<p>$<sal>$<hash>` (base64). */
export async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const chave = await derivar(senha, sal, LOG_N, R, P);
  return ["scrypt", LOG_N, R, P, sal.toString("base64"), chave.toString("base64")].join("$");
}

/** Confere a senha com o hash guardado, em tempo constante; hash estranho = não confere. */
export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [logN, r, p] = partes.slice(1, 4).map(Number);
  if (![logN, r, p].every(Number.isInteger) || logN < 14 || logN > 20 || r < 1 || r > 32 || p < 1 || p > 4) return false;
  const sal = Buffer.from(partes[4], "base64");
  const esperado = Buffer.from(partes[5], "base64");
  if (!sal.length || esperado.length !== TAMANHO) return false;
  return timingSafeEqual(await derivar(senha, sal, logN, r, p), esperado);
}

const SEM_AMBIGUOS = "abcdefghjkmnpqrstuvwxyz23456789";
/** Senha provisória fácil de ditar ou mandar pelo WhatsApp: três blocos de quatro, sem letras parecidas (l/1, o/0). */
export function gerarSenhaProvisoria(): string {
  const bloco = () => Array.from({ length: 4 }, () => SEM_AMBIGUOS[randomInt(SEM_AMBIGUOS.length)]).join("");
  return `${bloco()}-${bloco()}-${bloco()}`;
}

/** Sal fixo para a conferência de quem não existe: o tempo de resposta é o mesmo de quem existe. */
const SAL_FALSO = Buffer.from("scl-login-inexistente", "utf8");

/** Chave da conta de erros de um usuário (ou e-mail) digitado. Trocar a senha pela empresa zera esta conta. */
export const chaveDoLogin = (digitado: string) => `senha:${normalizarLogin(digitado).slice(0, 200)}`;
const chaveDaOrigem = (ip: string) => `senha-origem:${ip}`;
const CHAVE_GERAL = "senha-geral";

/** Endereço de origem do pedido (na Vercel, `x-real-ip`/`x-forwarded-for` vêm da própria plataforma). Estranho = nenhum. */
export function origemDoPedido(h: Pick<Headers, "get"> | undefined): string | null {
  const ip = (h?.get("x-real-ip") ?? h?.get("x-forwarded-for")?.split(",")[0] ?? "").trim().toLowerCase();
  return /^[0-9a-f:.]{3,45}$/.test(ip) ? ip : null;
}

type Limite = { tentativas: number; janelaMs: number };

/**
 * Conta mais uma tentativa na janela da chave (a janela começa na primeira tentativa e vale `janelaMs`). Num comando só,
 * fora de transação: não segura ninguém enquanto a senha é conferida. Devolve o total da janela.
 */
async function contarNaJanela(db: Db, chave: string, limite: Limite, agora: Date): Promise<number> {
  const inicio = sql`${new Date(agora.getTime() - limite.janelaMs).toISOString()}::timestamptz`;
  const vencida = sql`${tentativasLogin.atualizadoEm} <= ${inicio}`;
  const [r] = await db
    .insert(tentativasLogin)
    .values({ chave, erros: 1, atualizadoEm: agora })
    .onConflictDoUpdate({
      target: tentativasLogin.chave,
      set: {
        erros: sql`case when ${vencida} then 1 else ${tentativasLogin.erros} + 1 end`,
        atualizadoEm: sql`case when ${vencida} then ${agora.toISOString()}::timestamptz else ${tentativasLogin.atualizadoEm} end`,
      },
    })
    .returning({ total: tentativasLogin.erros });
  return r.total;
}

/** A janela da chave já passou do teto? (só lê; para a tela dizer "espere" sem gastar tentativa). */
const passouDoTeto = (t: { erros: number; atualizadoEm: Date } | undefined, limite: Limite, agora: Date) =>
  Boolean(t && t.erros >= limite.tentativas && t.atualizadoEm.getTime() > agora.getTime() - limite.janelaMs);

/** Apaga as contas paradas há mais de um dia que não estão numa espera (roda no máximo uma vez por janela geral). */
async function apagarContasVelhas(db: Db, agora: Date): Promise<void> {
  const corte = new Date(agora.getTime() - GUARDA_CONTAS_MS);
  await db
    .delete(tentativasLogin)
    .where(and(lt(tentativasLogin.atualizadoEm, corte), or(isNull(tentativasLogin.bloqueadoAte), lt(tentativasLogin.bloqueadoAte, agora))));
}

export type Espera = "espere" | "muitas";

/**
 * Precisa esperar? "espere" = muitos erros para esse usuário digitado; "muitas" = muitas tentativas desta origem ou no
 * total. Só lê: a tela avisa sem gastar tentativa.
 */
export async function esperaDoLogin(db: Db, digitado: string, origem: string | null = null, agora: Date = new Date()): Promise<Espera | null> {
  const chaves = [chaveDoLogin(digitado), CHAVE_GERAL, ...(origem ? [chaveDaOrigem(origem)] : [])];
  const linhas = await db.select().from(tentativasLogin).where(inArray(tentativasLogin.chave, chaves));
  const de = (c: string) => linhas.find((l) => l.chave === c);
  const doLogin = de(chaves[0]);
  if (doLogin?.bloqueadoAte && doLogin.bloqueadoAte > agora) return "espere";
  if (origem && passouDoTeto(de(chaveDaOrigem(origem)), LIMITE_POR_ORIGEM, agora)) return "muitas";
  return passouDoTeto(de(CHAVE_GERAL), LIMITE_GERAL, agora) ? "muitas" : null;
}

/**
 * Trava da conferência de senha de um usuário digitado, até o fim da transação. A entrada (`entrarComSenha`) e a troca da
 * senha pela empresa usam a mesma: uma não corre no meio da outra.
 */
export async function travarEntrada(tx: Db, chave: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`login-senha:${chave}`}))`);
}

/** `conferidaEm`: a hora em que a senha foi conferida, já com a trava; vira a hora da sessão (corte de senha trocada). */
export type ResultadoSenha = { ok: true; usuarioId: string; conferidaEm: number } | { ok: false; motivo: "senha" | "bloqueado" | "muitas" };

/**
 * Confere usuário (ou e-mail) e senha. Só entra quem está ativo e tem senha. Antes de conferir, os tetos: mais de 20
 * tentativas da mesma origem em 15 minutos, ou mais de 60 no total em um minuto, e a resposta é "muitas" sem conferir
 * nada. Erro conta para o que foi digitado; no quinto seguido, espera 15 minutos (e o próximo erro, depois da espera,
 * recomeça a conta). Acerto zera a conta.
 */
export async function entrarComSenha(db: Db, digitado: string, senha: string, agora: Date = new Date(), origem: string | null = null): Promise<ResultadoSenha> {
  const identificador = normalizarLogin(digitado);
  if (!identificador || !senha || senha.length > SENHA_MAXIMA || identificador.length > 200) return { ok: false, motivo: "senha" };
  // A origem que passou do teto não gasta a conta geral: uma origem só não tira a vez de todo mundo.
  if (origem && (await contarNaJanela(db, chaveDaOrigem(origem), LIMITE_POR_ORIGEM, agora)) > LIMITE_POR_ORIGEM.tentativas) return { ok: false, motivo: "muitas" };
  const geral = await contarNaJanela(db, CHAVE_GERAL, LIMITE_GERAL, agora);
  if (geral === 1) await apagarContasVelhas(db, agora);
  if (geral > LIMITE_GERAL.tentativas) return { ok: false, motivo: "muitas" };
  const chave = chaveDoLogin(identificador);
  return db.transaction(async (tx) => {
    // Uma conferência por vez para o mesmo usuário digitado: tentativas em paralelo não escapam da conta, e uma troca
    // de senha pela empresa espera esta conferência acabar (ou esta espera a troca).
    await travarEntrada(tx, chave);
    const conferidaEm = Math.max(agora.getTime(), Date.now());
    const [t] = await tx.select().from(tentativasLogin).where(eq(tentativasLogin.chave, chave));
    if (t?.bloqueadoAte && t.bloqueadoAte > agora) return { ok: false as const, motivo: "bloqueado" as const };
    const porEmail = identificador.includes("@");
    const [u] = await tx
      .select({ id: usuarios.id, senhaHash: usuarios.senhaHash })
      .from(usuarios)
      .where(and(porEmail ? eq(sql`lower(${usuarios.email})`, identificador) : eq(usuarios.login, identificador), eq(usuarios.ativo, true), isNotNull(usuarios.senhaHash)));
    const confere = u?.senhaHash ? await conferirSenha(senha, u.senhaHash) : (await derivar(senha, SAL_FALSO, LOG_N, R, P), false);
    if (confere && u) {
      if (t) await tx.delete(tentativasLogin).where(eq(tentativasLogin.chave, chave));
      return { ok: true as const, usuarioId: u.id, conferidaEm };
    }
    // Espera vencida: a conta recomeça.
    const erros = (t && !t.bloqueadoAte ? t.erros : 0) + 1;
    const bloqueadoAte = erros >= MAX_ERROS ? new Date(agora.getTime() + ESPERA_MS) : null;
    await tx
      .insert(tentativasLogin)
      .values({ chave, erros: bloqueadoAte ? 0 : erros, bloqueadoAte, atualizadoEm: agora })
      .onConflictDoUpdate({ target: tentativasLogin.chave, set: { erros: bloqueadoAte ? 0 : erros, bloqueadoAte, atualizadoEm: agora } });
    return { ok: false as const, motivo: bloqueadoAte ? ("bloqueado" as const) : ("senha" as const) };
  });
}
