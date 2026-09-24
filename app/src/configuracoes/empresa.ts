/**
 * Dados da empresa (M1.7). O nome fica em `organizacoes.nome` (onde o resto do sistema já
 * lê); os demais campos, na configuração "empresa".
 */
import { asc, eq, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { organizacoes, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { gravarConfig, lerConfig } from "./armazem";

export type DadosEmpresa = {
  nome: string;
  razaoSocial: string;
  cnpj: string;
  email: string;
  telefone: string;
  endereco: string;
  site: string;
  /** Chave Pix da empresa: aparece no portal para o proprietário que deve à empresa. */
  chavePix: string;
};
export type ErrosEmpresa = Partial<Record<keyof DadosEmpresa, string>>;

const CAMPOS_CONFIG = ["razaoSocial", "cnpj", "email", "telefone", "endereco", "site", "chavePix"] as const;
const LIMITES: Record<keyof DadosEmpresa, number> = { nome: 80, razaoSocial: 120, cnpj: 18, email: 200, telefone: 30, endereco: 200, site: 200, chavePix: 140 };

export function validarEmpresa(bruto: Record<string, unknown>): { ok: true; dados: DadosEmpresa } | { ok: false; erros: ErrosEmpresa } {
  const txt = (k: keyof DadosEmpresa) => (typeof bruto[k] === "string" ? (bruto[k] as string).trim() : "");
  const dados: DadosEmpresa = { nome: txt("nome"), razaoSocial: txt("razaoSocial"), cnpj: txt("cnpj"), email: txt("email").toLowerCase(), telefone: txt("telefone"), endereco: txt("endereco"), site: txt("site"), chavePix: txt("chavePix") };
  const erros: ErrosEmpresa = {};
  for (const k of Object.keys(LIMITES) as (keyof DadosEmpresa)[]) if (dados[k].length > LIMITES[k]) erros[k] = `Máximo de ${LIMITES[k]} caracteres.`;
  if (!dados.nome) erros.nome = "Informe o nome da empresa.";
  if (dados.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) erros.email = "E-mail inválido.";
  if (dados.cnpj && dados.cnpj.replace(/\D/g, "").length !== 14) erros.cnpj = "O CNPJ tem 14 números.";
  if (dados.site && !/^https?:\/\/\S+$/.test(dados.site)) erros.site = "Comece com https://";
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, dados };
}

export async function lerEmpresa(db: Db, organizacaoId: string): Promise<DadosEmpresa> {
  const [org] = await db.select({ nome: organizacoes.nome }).from(organizacoes).where(eq(organizacoes.id, organizacaoId));
  const c = (await lerConfig(db, organizacaoId, "empresa")) ?? {};
  const s = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : "");
  return { nome: org?.nome ?? "", razaoSocial: s("razaoSocial"), cnpj: s("cnpj"), email: s("email"), telefone: s("telefone"), endereco: s("endereco"), site: s("site"), chavePix: s("chavePix") };
}

export async function salvarEmpresa(db: Db, organizacaoId: string, dados: DadosEmpresa, autorId: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const [org] = await tx.select({ nome: organizacoes.nome }).from(organizacoes).where(eq(organizacoes.id, organizacaoId)).for("update");
    if (!org) throw new Error("Organização não encontrada.");
    if (org.nome !== dados.nome) {
      await tx.update(organizacoes).set({ nome: dados.nome }).where(eq(organizacoes.id, organizacaoId));
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "configuracao.empresa", entidade: "configuracao", entidadeId: organizacaoId, mudancas: { nome: [org.nome, dados.nome] } });
    }
    // Histórico sem a chave Pix em claro (como a dos proprietários): registra só que mudou.
    const mudancas = await gravarConfig(tx, organizacaoId, "empresa", Object.fromEntries(CAMPOS_CONFIG.map((k) => [k, dados[k]])), autorId, false);
    if (mudancas.chavePix) mudancas.chavePix = ["(alterado)", "(alterado)"];
    if (Object.keys(mudancas).length) {
      await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "configuracao.empresa", entidade: "configuracao", entidadeId: organizacaoId, mudancas });
    }
  });
}

/** Nome usado quando ainda não há organização (primeiro acesso). */
export const NOME_EMPRESA_INICIAL = "Sua Casa Leblon";

/** Nome da empresa para cabeçalhos e e-mails — o mesmo que se edita em Configurações → Empresa. */
export async function nomeDaEmpresa(db: Db, organizacaoId: string): Promise<string> {
  const [o] = await db.select({ nome: organizacoes.nome }).from(organizacoes).where(eq(organizacoes.id, organizacaoId));
  return o?.nome || NOME_EMPRESA_INICIAL;
}

/**
 * Nome da empresa para um e-mail antes do login (código de acesso): a organização do usuário;
 * sem usuário (primeiro acesso, convite), a organização mais antiga.
 */
export async function nomeDaEmpresaPorEmail(db: Db, email: string): Promise<string> {
  const [u] = await db
    .select({ nome: organizacoes.nome })
    .from(usuarios)
    .innerJoin(organizacoes, eq(organizacoes.id, usuarios.organizacaoId))
    .where(eq(sql`lower(${usuarios.email})`, email.toLowerCase()));
  if (u?.nome) return u.nome;
  const [o] = await db.select({ nome: organizacoes.nome }).from(organizacoes).orderBy(asc(organizacoes.criadoEm), asc(organizacoes.id)).limit(1);
  return o?.nome || NOME_EMPRESA_INICIAL;
}
