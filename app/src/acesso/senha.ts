/**
 * Entrar com usuário (ou e-mail) e senha (M6.8, decisão de Diego em 7/10: "e-mail não vai funcionar" para a equipe;
 * vários jeitos de entrar, sem verificação em duas etapas). A senha nunca é guardada: só o hash scrypt, com sal
 * próprio e os parâmetros junto (dá para endurecer depois sem perder as senhas antigas). Depois de muitos erros para o
 * mesmo usuário digitado — exista ele ou não —, é preciso esperar: a resposta é a mesma nos dois casos.
 */
import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { tentativasLogin, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { normalizarLogin, SENHA_MAXIMA } from "./senha-regras";

export { normalizarLogin, SENHA_MAXIMA, SENHA_MINIMA, validarLogin, validarSenha } from "./senha-regras";

export const MAX_ERROS = 5;
export const ESPERA_MS = 15 * 60_000;

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

const chaveDe = (digitado: string) => `senha:${normalizarLogin(digitado).slice(0, 200)}`;

/** Está esperando depois de muitos erros? (para a tela dizer "espere", sem gastar tentativa). */
export async function loginBloqueado(db: Db, digitado: string, agora: Date = new Date()): Promise<Date | null> {
  const [t] = await db.select({ ate: tentativasLogin.bloqueadoAte }).from(tentativasLogin).where(eq(tentativasLogin.chave, chaveDe(digitado)));
  return t?.ate && t.ate > agora ? t.ate : null;
}

export type ResultadoSenha = { ok: true; usuarioId: string } | { ok: false; motivo: "senha" | "bloqueado" };

/**
 * Confere usuário (ou e-mail) e senha. Só entra quem está ativo e tem senha. Erro conta para o que foi digitado; no
 * quinto seguido, espera 15 minutos (e o próximo erro, depois da espera, recomeça a conta). Acerto zera a conta.
 */
export async function entrarComSenha(db: Db, digitado: string, senha: string, agora: Date = new Date()): Promise<ResultadoSenha> {
  const identificador = normalizarLogin(digitado);
  if (!identificador || !senha || senha.length > SENHA_MAXIMA || identificador.length > 200) return { ok: false, motivo: "senha" };
  const chave = chaveDe(identificador);
  return db.transaction(async (tx) => {
    // Uma conferência por vez para o mesmo usuário digitado: tentativas em paralelo não escapam da conta.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`login-senha:${chave}`}))`);
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
      return { ok: true as const, usuarioId: u.id };
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
