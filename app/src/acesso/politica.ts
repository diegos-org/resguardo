import type { Papel } from "@/db/schema";

/**
 * Política de autorização: decisão pura, sem banco e sem HTTP.
 *
 * A `Sessao` deve vir SEMPRE do servidor (sessão autenticada + vínculos lidos do
 * banco), nunca de corpo de requisição, cookie ou URL. Tudo que não está
 * explicitamente permitido é negado.
 */

export const ACOES = [
  "imovel:ler",
  "imovel:editar",
  "proprietario:ler",
  "proprietario:editar",
  "reserva:ler",
  "reserva:editar",
  "calendario:ler",
  "financeiro:ler",
  "financeiro:editar",
  "despesa:editar",
  "limpeza:ler",
  "limpeza:editar",
  /** Profissional de limpeza (M6.6): ver as próprias limpezas e marcar como feita. */
  "limpeza:propria",
  "manutencao:ler",
  "manutencao:editar",
  /** Aprovar orçamento de manutenção e decidir quem paga: só o admin (Diego). */
  "manutencao:aprovar",
  /** Rotinas recorrentes: ver e registrar feita/pulada (criar e editar é configuração). */
  "rotina:ler",
  "rotina:editar",
  "mensagem:ler",
  "mensagem:enviar",
  "usuario:gerenciar",
  "configuracao:editar",
] as const;
export type Acao = (typeof ACOES)[number];

const OPERACAO: readonly Acao[] = [
  "imovel:ler",
  "reserva:ler",
  "reserva:editar",
  "calendario:ler",
  "limpeza:ler",
  "limpeza:editar",
  "manutencao:ler",
  "manutencao:editar",
  "rotina:ler",
  "rotina:editar",
  "mensagem:ler",
  "mensagem:enviar",
];

/** Proprietário só lê, e só o que é dos seus imóveis. */
const PROPRIETARIO: readonly Acao[] = ["imovel:ler", "reserva:ler", "calendario:ler", "financeiro:ler"];

export const PERMISSOES: Readonly<Record<Papel, readonly Acao[]>> = Object.freeze({
  admin: ACOES,
  operacao: OPERACAO,
  proprietario: PROPRIETARIO,
  // Hóspede ganha acesso à própria reserva no M9; até lá, nada.
  hospede: [],
  // Só as limpezas atribuídas a ela (a posse é conferida no servidor, pela profissional da sessão).
  limpeza: ["limpeza:propria"],
});

export type Sessao = {
  usuarioId: string;
  organizacaoId: string;
  papel: Papel;
  /** Para proprietários: imóveis vinculados, resolvidos no servidor. */
  imovelIds: readonly string[];
  /** Para o papel "limpeza": a profissional (ativa) ligada a este usuário, resolvida no servidor. */
  profissionalId?: string | null;
};

export type Recurso = {
  organizacaoId: string;
  /** Imóvel a que o recurso pertence. Obrigatório para acesso de proprietário. */
  imovelId?: string;
};

export type Decisao = { permitido: true } | { permitido: false; motivo: MotivoNegacao };
export type MotivoNegacao = "SESSAO_INVALIDA" | "OUTRA_ORGANIZACAO" | "ACAO_NAO_PERMITIDA" | "IMOVEL_NAO_VINCULADO";

const nega = (motivo: MotivoNegacao): Decisao => ({ permitido: false, motivo });

function textoValido(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

export function autorizar(sessao: Sessao | null | undefined, acao: Acao, recurso: Recurso): Decisao {
  if (!sessao || !textoValido(sessao.usuarioId) || !textoValido(sessao.organizacaoId)) return nega("SESSAO_INVALIDA");
  // Rejeita papéis que não são string exata (evita coerção de arrays/objetos).
  if (typeof sessao.papel !== "string" || !Object.hasOwn(PERMISSOES, sessao.papel)) return nega("SESSAO_INVALIDA");
  if (!textoValido(recurso?.organizacaoId) || recurso.organizacaoId !== sessao.organizacaoId) return nega("OUTRA_ORGANIZACAO");
  if (!PERMISSOES[sessao.papel].includes(acao)) return nega("ACAO_NAO_PERMITIDA");

  if (sessao.papel === "proprietario") {
    // Nunca curinga: exige o imóvel do recurso na lista explícita da sessão.
    if (!textoValido(recurso.imovelId) || !Array.isArray(sessao.imovelIds) || !sessao.imovelIds.includes(recurso.imovelId)) {
      return nega("IMOVEL_NAO_VINCULADO");
    }
  }
  return { permitido: true };
}

export class AcessoNegado extends Error {
  constructor(public readonly motivo: MotivoNegacao) {
    super(`Acesso negado: ${motivo}`);
    this.name = "AcessoNegado";
  }
}

/** Versão que lança erro — para usar no início de ações de servidor. */
export function exigir(sessao: Sessao | null | undefined, acao: Acao, recurso: Recurso): void {
  const d = autorizar(sessao, acao, recurso);
  if (!d.permitido) throw new AcessoNegado(d.motivo);
}

export function podeFazer(papel: Papel, acao: Acao): boolean {
  return PERMISSOES[papel]?.includes(acao) ?? false;
}
