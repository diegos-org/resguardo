/** Regras da senha e do usuário (M6.8), sem banco nem cripto: valem também no navegador. */
export const SENHA_MINIMA = 8;
export const SENHA_MAXIMA = 128;

/** Senha aceitável: tamanho mínimo e diferente do próprio usuário. Sem regras complicadas (decisão de Diego). */
export function validarSenha(senha: string, login = ""): string | null {
  if (senha.length < SENHA_MINIMA) return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  if (senha.length > SENHA_MAXIMA) return `A senha pode ter no máximo ${SENHA_MAXIMA} caracteres.`;
  if (login && senha.trim().toLowerCase() === login.trim().toLowerCase()) return "A senha não pode ser igual ao usuário.";
  return null;
}

/** Usuário: 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado, começando com letra ou número; sem "@" (aquilo é e-mail). */
const LOGIN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
export const normalizarLogin = (s: string) => s.trim().toLowerCase();
export function validarLogin(login: string): string | null {
  return LOGIN.test(login) ? null : "O usuário precisa ter de 3 a 40 letras sem acento, números, ponto, hífen ou sublinhado (ex.: maria.limpeza).";
}
