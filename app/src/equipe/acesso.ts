/**
 * Entrada da equipe sem e-mail (M6.8, decisão de Diego em 7/10). Além do código por e-mail (M6.6) e da conta Google, a
 * profissional pode entrar com usuário e senha: a empresa cria o usuário e uma senha provisória no painel e entrega à
 * pessoa (pelo WhatsApp); a pessoa troca a senha no acesso dela quando quiser. Sem verificação em duas etapas, mas com o
 * acesso contido: cada login vê só a agenda das cidades escolhidas para ela e as limpezas dela.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { cidadesDosImoveis, lerConfigAgenda, montarAgenda, textoDaSecao } from "@/agenda/agenda";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { profissionaisLimpeza, tentativasLogin, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { uuidValido } from "@/lib/ids";
import type { Resultado } from "@/limpezas/limpezas";
import { chaveDoLogin, conferirSenha, gerarSenhaProvisoria, hashSenha, normalizarLogin, travarEntrada, validarLogin, validarSenha } from "@/acesso/senha";

const SEM_PROFISSIONAL = "Profissional não encontrada.";

export type ResultadoSenhaProvisoria = { ok: true; login: string; senha: string } | { ok: false; erro: string };

/**
 * Cria (ou troca) o usuário e a senha provisória de uma profissional. Senha em branco = o sistema gera uma fácil de
 * mandar pelo WhatsApp. A senha volta só nesta resposta, para a tela mostrar uma vez: o banco guarda só o hash.
 * Trocar a senha derruba quem tinha entrado antes com a senha antiga.
 */
export async function definirSenhaPelaEmpresa(
  db: Db,
  organizacaoId: string,
  profissionalId: string,
  e: { login: string; senha?: string },
  autorId: string | null,
  agora: Date = new Date(),
): Promise<ResultadoSenhaProvisoria> {
  if (!uuidValido(profissionalId)) return { ok: false, erro: SEM_PROFISSIONAL };
  const login = normalizarLogin(e.login);
  const erroLogin = validarLogin(login);
  if (erroLogin) return { ok: false, erro: erroLogin };
  const senha = e.senha?.trim() ? e.senha : gerarSenhaProvisoria();
  const erroSenha = validarSenha(senha, login);
  if (erroSenha) return { ok: false, erro: erroSenha };
  const senhaHash = await hashSenha(senha);
  return db.transaction(async (tx) => {
    // Dois pedidos para o mesmo usuário ao mesmo tempo: um depois do outro (o índice único é a última garantia).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`login-usuario:${login}`}))`);
    const [p] = await tx
      .select()
      .from(profissionaisLimpeza)
      .where(and(eq(profissionaisLimpeza.id, profissionalId), eq(profissionaisLimpeza.organizacaoId, organizacaoId)))
      .for("update");
    if (!p) return { ok: false as const, erro: SEM_PROFISSIONAL };
    if (!p.ativo) return { ok: false as const, erro: "Profissional arquivada: reative antes de dar acesso." };
    const [deOutro] = await tx
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(and(eq(usuarios.login, login), p.usuarioId ? ne(usuarios.id, p.usuarioId) : undefined));
    if (deOutro) return { ok: false as const, erro: "Esse usuário já é de outra pessoa: escolha outro (ex.: com o sobrenome)." };
    let usuarioId = p.usuarioId;
    let antes: string | null = null;
    // A senha nova vale na hora: a espera por erros com este usuário (e com o antigo, e com o e-mail) acaba aqui.
    const contas = new Set([chaveDoLogin(login)]);
    if (usuarioId) {
      const [u] = await tx
        .select({ login: usuarios.login, email: usuarios.email, temSenha: sql<boolean>`${usuarios.senhaHash} is not null` })
        .from(usuarios)
        .where(eq(usuarios.id, usuarioId));
      antes = u ? `${u.login ? `usuário ${u.login}` : "sem usuário"}${u.temSenha ? " com senha" : ""}` : null;
      if (u?.login) contas.add(chaveDoLogin(u.login));
      if (u?.email) contas.add(chaveDoLogin(u.email));
    }
    // A mesma trava da entrada com senha, para cada jeito de digitar este acesso: uma entrada com a senha antiga já em
    // andamento termina antes, e o corte é tomado depois dela (a sessão dela cai); as entradas seguintes já conferem a nova.
    for (const chave of [...contas].sort()) await travarEntrada(tx, chave);
    const corte = new Date(Math.max(agora.getTime(), Date.now()));
    if (usuarioId) {
      await tx
        .update(usuarios)
        .set({ login, senhaHash, senhaProvisoria: true, ativo: true, nome: p.nome, sessaoValidaDesde: corte })
        .where(and(eq(usuarios.id, usuarioId), eq(usuarios.organizacaoId, organizacaoId)));
    } else {
      const [u] = await tx
        .insert(usuarios)
        .values({ organizacaoId, email: "", nome: p.nome, papel: "limpeza", login, senhaHash, senhaProvisoria: true })
        .returning({ id: usuarios.id });
      usuarioId = u.id;
      await tx.update(profissionaisLimpeza).set({ usuarioId }).where(eq(profissionaisLimpeza.id, p.id));
    }
    await tx.delete(tentativasLogin).where(inArray(tentativasLogin.chave, [...contas]));
    // A senha nunca vai para o histórico: só que foi definida, por quem e quando.
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "profissional_limpeza.acesso",
      entidade: "profissional_limpeza",
      entidadeId: p.id,
      mudancas: { acesso: [antes, `usuário ${login} com senha provisória definida pela empresa`] },
    });
    return { ok: true as const, login, senha };
  });
}

/** Cidades da agenda que ela vê (as dos imóveis ativos). Nenhuma = a tela dela avisa que falta escolher. */
export async function definirCidades(db: Db, organizacaoId: string, profissionalId: string, cidades: readonly string[], autorId: string | null): Promise<Resultado> {
  if (!uuidValido(profissionalId)) return { ok: false, erro: SEM_PROFISSIONAL };
  const existentes = await cidadesDosImoveis(db, organizacaoId);
  const escolhidas = [...new Set(cidades.map((c) => c.trim()).filter(Boolean))];
  const desconhecida = escolhidas.find((c) => !existentes.includes(c));
  if (desconhecida) return { ok: false, erro: `Cidade sem imóvel ativo: ${desconhecida}.` };
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select({ id: profissionaisLimpeza.id, cidades: profissionaisLimpeza.cidades })
      .from(profissionaisLimpeza)
      .where(and(eq(profissionaisLimpeza.id, profissionalId), eq(profissionaisLimpeza.organizacaoId, organizacaoId)))
      .for("update");
    if (!p) return { ok: false as const, erro: SEM_PROFISSIONAL };
    const ordenadas = existentes.filter((c) => escolhidas.includes(c));
    if (JSON.stringify(ordenadas) === JSON.stringify(p.cidades)) return { ok: true as const };
    await tx.update(profissionaisLimpeza).set({ cidades: ordenadas }).where(eq(profissionaisLimpeza.id, p.id));
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "profissional_limpeza.cidades",
      entidade: "profissional_limpeza",
      entidadeId: p.id,
      mudancas: { cidades: [p.cidades.join(", ") || null, ordenadas.join(", ") || null] },
    });
    return { ok: true as const };
  });
}

/**
 * A própria pessoa cria ou troca a senha (no acesso dela). Quem já tem senha confirma a atual; quem entrou pelo código
 * ou pelo Google e ainda não tem, cria direto. A nova senha deixa de ser provisória.
 */
export async function trocarMinhaSenha(db: Db, usuarioId: string, e: { atual?: string; nova: string; repetir: string }): Promise<Resultado> {
  if (!uuidValido(usuarioId)) return { ok: false, erro: "Usuário não encontrado." };
  if (e.nova !== e.repetir) return { ok: false, erro: "As duas senhas novas não são iguais." };
  const colunas = { id: usuarios.id, ativo: usuarios.ativo, login: usuarios.login, email: usuarios.email, senhaHash: usuarios.senhaHash, organizacaoId: usuarios.organizacaoId };
  const [antes] = await db.select(colunas).from(usuarios).where(eq(usuarios.id, usuarioId));
  if (!antes || !antes.ativo) return { ok: false, erro: "Usuário não encontrado." };
  const erro = validarSenha(e.nova, antes.login ?? "");
  if (erro) return { ok: false, erro };
  const senhaHash = await hashSenha(e.nova);
  const contas = [...new Set([antes.login, antes.email].filter((x): x is string => !!x).map(chaveDoLogin))].sort();
  if (!contas.length) return { ok: false, erro: "Usuário não encontrado." };
  return db.transaction(async (tx) => {
    // A mesma trava da entrada com senha e da troca pela empresa: a senha atual é conferida com o que está gravado agora,
    // então uma troca feita pela empresa no meio do caminho não é desfeita por quem tinha a senha antiga.
    for (const chave of contas) await travarEntrada(tx, chave);
    const [u] = await tx.select(colunas).from(usuarios).where(eq(usuarios.id, usuarioId));
    if (!u || !u.ativo) return { ok: false as const, erro: "Usuário não encontrado." };
    if (u.login !== antes.login || u.email !== antes.email) return { ok: false as const, erro: "Seu acesso acabou de mudar: entre de novo e tente outra vez." };
    if (u.senhaHash && !(await conferirSenha(e.atual ?? "", u.senhaHash))) return { ok: false as const, erro: "A senha atual não confere." };
    await tx.update(usuarios).set({ senhaHash, senhaProvisoria: false }).where(eq(usuarios.id, u.id));
    await registrarAuditoria(tx, { organizacaoId: u.organizacaoId, usuarioId: u.id, acao: "usuario.senha", entidade: "usuario", entidadeId: u.id, mudancas: { senha: [u.senhaHash ? "tinha senha" : null, "trocada pela própria pessoa"] } });
    return { ok: true as const };
  });
}

export type AgendaDaProfissional = { cidades: string[]; secoes: { cidade: string; linhas: string[] }[] };

/**
 * A agenda das cidades dela (a mesma do M6.7: Búzios com as reservas de 30 dias, Rio com as limpezas por dia e as
 * entradas e saídas à parte), nunca a das outras. Sem cidade escolhida, nenhuma.
 */
export async function agendaDaProfissional(db: Db, organizacaoId: string, profissionalId: string, hoje: string): Promise<AgendaDaProfissional> {
  if (!uuidValido(profissionalId)) return { cidades: [], secoes: [] };
  const [p] = await db
    .select({ cidades: profissionaisLimpeza.cidades })
    .from(profissionaisLimpeza)
    .where(and(eq(profissionaisLimpeza.id, profissionalId), eq(profissionaisLimpeza.organizacaoId, organizacaoId), eq(profissionaisLimpeza.ativo, true)));
  const cidades = p?.cidades ?? [];
  if (!cidades.length) return { cidades: [], secoes: [] };
  const [agenda, config] = await Promise.all([montarAgenda(db, organizacaoId, hoje, null), lerConfigAgenda(db, organizacaoId)]);
  const fim = agenda.dias.at(-1) ?? hoje;
  return {
    cidades,
    secoes: agenda.secoes.filter((s) => cidades.includes(s.cidade)).map((s) => ({ cidade: s.cidade, linhas: textoDaSecao(s, fim, config) })),
  };
}

/** Se a pessoa já tem senha (e se é a provisória da empresa), para a tela dela. */
export async function situacaoDaSenha(db: Db, usuarioId: string): Promise<{ temSenha: boolean; provisoria: boolean }> {
  if (!uuidValido(usuarioId)) return { temSenha: false, provisoria: false };
  const [u] = await db.select({ temSenha: sql<boolean>`${usuarios.senhaHash} is not null`, provisoria: usuarios.senhaProvisoria }).from(usuarios).where(eq(usuarios.id, usuarioId));
  return { temSenha: Boolean(u?.temSenha), provisoria: Boolean(u?.temSenha && u.provisoria) };
}
