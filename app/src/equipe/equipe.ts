/**
 * Equipe de limpeza pelo celular (M6.6). Cada profissional pode ter um acesso próprio (usuário com
 * papel "limpeza", entrando pelo código por e-mail, pelo Google ou, desde o M6.8, com usuário e senha — ver
 * `acesso.ts`) que vê só as limpezas atribuídas a ela e marca como feita. Custo, proprietário e financeiro nunca
 * aparecem aqui.
 *
 * Aviso de limpeza nova: por e-mail enquanto o WhatsApp (M10) não está ligado.
 */
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { lerConfigAgenda } from "@/agenda/agenda";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { imoveis, imoveisDetalhes, limpezas, profissionaisLimpeza, reservas, usuarios } from "@/db/schema";
import type { Db } from "@/db/types";
import { temConvitePendente, travarEmail } from "@/convites/convites";
import type { Correio } from "@/email/correio";
import { uuidValido } from "@/lib/ids";
import { realizarPelaProfissional, type Resultado } from "@/limpezas/limpezas";
import { horaEfetiva, lerHorariosReservas } from "@/reservas/horarios";
import { ACESSO_INCONSISTENTE, contaDaEquipe, usuarioDaEquipe } from "./vinculo";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const diaBr = (d: string) => d.split("-").reverse().slice(0, 2).join("/");

/** Quantos dias para trás e para a frente a tela da profissional mostra. */
export const DIAS_ANTES = 3;
export const DIAS_DEPOIS = 14;

export type LimpezaDaEquipe = {
  id: string;
  data: string;
  estado: "pedida" | "confirmada" | "realizada";
  imovelCodigo: string;
  imovelNome: string;
  endereco: string;
  observacao: string;
  /** Alguém entra no imóvel no mesmo dia (horário-limite para deixar pronto). */
  entraNoDia: boolean;
  /**
   * Horários "HH:MM" da casa, os mesmos da agenda (`horaEfetiva`): o acordo vigente com o hóspede; sem ele, o da ficha do
   * imóvel e, sem ficha, o padrão da agenda. `saidaCombinada`/`entradaCombinada`: vem de um acordo com o hóspede.
   */
  horaSaida: string;
  saidaCombinada: boolean;
  horaEntrada: string;
  entradaCombinada: boolean;
};

/** O texto dos horários no cartão da limpeza: "Saída do hóspede até 11:00. Entra outro hóspede no mesmo dia: …". */
export function textoDosHorarios(l: Pick<LimpezaDaEquipe, "horaSaida" | "saidaCombinada" | "entraNoDia" | "horaEntrada" | "entradaCombinada">): string {
  const combinado = (sim: boolean) => (sim ? " (combinado com o hóspede)" : "");
  const saida = `Saída do hóspede até ${l.horaSaida}${combinado(l.saidaCombinada)}.`;
  return l.entraNoDia ? `${saida} Entra outro hóspede no mesmo dia: deixar pronto até ${l.horaEntrada}${combinado(l.entradaCombinada)}.` : saida;
}

/**
 * Limpezas confirmadas com esta profissional (e as que ela já fez), de alguns dias atrás até as
 * próximas duas semanas. Pedidas (em recombinação) e canceladas não aparecem. Não traz custo nem nada do financeiro.
 */
export async function limpezasDaProfissional(db: Db, organizacaoId: string, profissionalId: string, hoje: string): Promise<LimpezaDaEquipe[]> {
  if (!uuidValido(profissionalId)) return [];
  const linhas = await db
    .select({
      id: limpezas.id,
      data: limpezas.data,
      estado: limpezas.estado,
      imovelId: limpezas.imovelId,
      reservaId: limpezas.reservaId,
      imovelCodigo: imoveis.codigo,
      imovelNome: imoveis.nome,
      endereco: imoveis.endereco,
      observacao: limpezas.observacao,
      checkinAPartirDe: imoveisDetalhes.checkinAPartirDe,
      checkoutAte: imoveisDetalhes.checkoutAte,
    })
    .from(limpezas)
    .innerJoin(imoveis, eq(imoveis.id, limpezas.imovelId))
    .leftJoin(imoveisDetalhes, and(eq(imoveisDetalhes.imovelId, limpezas.imovelId), eq(imoveisDetalhes.organizacaoId, organizacaoId)))
    .where(
      and(
        eq(limpezas.organizacaoId, organizacaoId),
        eq(limpezas.profissionalId, profissionalId),
        // Só o que está confirmado com ela (ou já feito): "pedida" está sendo recombinada.
        inArray(limpezas.estado, ["confirmada", "realizada"]),
        gte(limpezas.data, somaDias(hoje, -DIAS_ANTES)),
        lt(limpezas.data, somaDias(hoje, DIAS_DEPOIS + 1)),
      ),
    )
    .orderBy(asc(limpezas.data), asc(imoveis.codigo));
  if (!linhas.length) return [];
  const daReserva = { id: reservas.id, imovelId: reservas.imovelId, checkin: reservas.checkin, checkout: reservas.checkout, estado: reservas.estado };
  const reservaIds = [...new Set(linhas.flatMap((l) => (l.reservaId ? [l.reservaId] : [])))];
  const [config, saidas, entradas] = await Promise.all([
    lerConfigAgenda(db, organizacaoId),
    // A reserva que sai (a que gerou a limpeza), se continua confirmada: o acordo de saída dela vale.
    reservaIds.length
      ? db.select(daReserva).from(reservas).where(and(eq(reservas.organizacaoId, organizacaoId), eq(reservas.estado, "confirmada"), inArray(reservas.id, reservaIds)))
      : Promise.resolve([]),
    // Entrada no mesmo dia e imóvel (reserva confirmada): a limpeza tem horário-limite.
    db
      .select(daReserva)
      .from(reservas)
      .where(
        and(
          eq(reservas.organizacaoId, organizacaoId),
          eq(reservas.estado, "confirmada"),
          inArray(
            reservas.imovelId,
            linhas.map((l) => l.imovelId),
          ),
          inArray(reservas.checkin, [...new Set(linhas.map((l) => l.data))]),
        ),
      )
      .orderBy(asc(reservas.checkin), asc(reservas.id)),
  ]);
  const horarios = await lerHorariosReservas(db, organizacaoId, [...saidas, ...entradas].map((r) => r.id));
  return linhas.map(({ imovelId, reservaId, checkinAPartirDe, checkoutAte, ...l }) => {
    const sai = saidas.find((r) => r.id === reservaId);
    const entra = entradas.find((r) => r.imovelId === imovelId && r.checkin === l.data);
    // Sem ficha, o padrão da agenda, como em `montarAgenda`.
    const saida = horaEfetiva(sai && horarios.get(sai.id), "saida", sai, checkoutAte || config.horaSaida);
    const entrada = horaEfetiva(entra && horarios.get(entra.id), "entrada", entra, checkinAPartirDe || config.horaEntrada);
    return {
      ...l,
      estado: l.estado as LimpezaDaEquipe["estado"],
      entraNoDia: Boolean(entra),
      horaSaida: saida.hora,
      saidaCombinada: saida.combinado,
      horaEntrada: entrada.hora,
      entradaCombinada: entrada.combinado,
    };
  });
}

/**
 * A profissional marca como feita. Só a limpeza confirmada com ela (a posse vem da sessão, no
 * servidor, e é conferida com a limpeza travada), a partir do dia dela. O custo fica como está.
 */
export async function marcarFeitaPelaProfissional(db: Db, organizacaoId: string, profissionalId: string, limpezaId: string, hoje: string, autorId: string): Promise<Resultado> {
  if (!uuidValido(limpezaId) || !uuidValido(profissionalId)) return { ok: false, erro: "Limpeza não encontrada." };
  return realizarPelaProfissional(db, organizacaoId, limpezaId, profissionalId, hoje, autorId);
}

/** `email` vazio = entra só com usuário e senha (M6.8). */
export type SituacaoAcesso = { usuarioId: string; email: string; ativo: boolean; login: string | null; temSenha: boolean; senhaProvisoria: boolean } | null;

/** Acesso pelo celular de cada profissional (para a tela de profissionais). */
export async function acessosDasProfissionais(db: Db, organizacaoId: string): Promise<Map<string, SituacaoAcesso>> {
  const linhas = await db
    .select({
      profissionalId: profissionaisLimpeza.id,
      usuarioId: usuarios.id,
      email: usuarios.email,
      ativo: usuarios.ativo,
      login: usuarios.login,
      temSenha: sql<boolean>`${usuarios.senhaHash} is not null`,
      senhaProvisoria: usuarios.senhaProvisoria,
    })
    .from(profissionaisLimpeza)
    .innerJoin(usuarios, contaDaEquipe(organizacaoId, profissionaisLimpeza.usuarioId))
    .where(eq(profissionaisLimpeza.organizacaoId, organizacaoId));
  return new Map(linhas.map(({ profissionalId, ...a }) => [profissionalId, a]));
}

/**
 * Dá (ou devolve) o acesso pelo celular: cria o usuário "limpeza" com o e-mail informado, ou
 * reativa o que já é dela. Um e-mail que já é de outra pessoa do sistema é recusado (avisar em vez
 * de supor).
 */
export async function darAcesso(db: Db, organizacaoId: string, profissionalId: string, emailBruto: string, autorId: string | null): Promise<Resultado> {
  const email = emailBruto.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) return { ok: false, erro: "Informe um e-mail válido." };
  if (!uuidValido(profissionalId)) return { ok: false, erro: "Profissional não encontrada." };
  return db.transaction(async (tx) => {
    // Mesma trava do convite de proprietário: os dois não nascem ao mesmo tempo para o mesmo e-mail.
    await travarEmail(tx, email);
    const [p] = await tx
      .select()
      .from(profissionaisLimpeza)
      .where(and(eq(profissionaisLimpeza.id, profissionalId), eq(profissionaisLimpeza.organizacaoId, organizacaoId)))
      .for("update");
    if (!p) return { ok: false as const, erro: "Profissional não encontrada." };
    if (!p.ativo) return { ok: false as const, erro: "Profissional arquivada: reative antes de dar acesso." };
    if (await temConvitePendente(tx, email)) return { ok: false as const, erro: "Este e-mail tem um convite de proprietário pendente. Cancele o convite antes, ou use outro e-mail." };
    const [doEmail] = await tx.select().from(usuarios).where(eq(sql`lower(${usuarios.email})`, email));
    if (doEmail && doEmail.id !== p.usuarioId) return { ok: false as const, erro: "Esse e-mail já é de outra pessoa do sistema." };
    let usuarioId = p.usuarioId;
    if (usuarioId) {
      // Já tinha acesso: reativa e, se mudou, troca o e-mail. E-mail trocado ou acesso devolvido:
      // quem tinha entrado antes (com o e-mail antigo) precisa entrar de novo.
      const u = await usuarioDaEquipe(tx, organizacaoId, usuarioId);
      if (!u) return { ok: false as const, erro: ACESSO_INCONSISTENTE };
      const mudou = !u.ativo || u.email.toLowerCase() !== email;
      const [alterado] = await tx
        .update(usuarios)
        .set({ email, ativo: true, nome: p.nome, ...(mudou ? { sessaoValidaDesde: new Date() } : {}) })
        .where(contaDaEquipe(organizacaoId, usuarioId))
        .returning({ id: usuarios.id });
      if (!alterado) return { ok: false as const, erro: ACESSO_INCONSISTENTE };
    } else {
      const [u] = await tx.insert(usuarios).values({ organizacaoId, email, nome: p.nome, papel: "limpeza" }).returning({ id: usuarios.id });
      usuarioId = u.id;
      await tx.update(profissionaisLimpeza).set({ usuarioId }).where(eq(profissionaisLimpeza.id, p.id));
    }
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "profissional_limpeza.acesso",
      entidade: "profissional_limpeza",
      entidadeId: p.id,
      mudancas: { acesso: [null, `liberado para ${email}`] },
    });
    return { ok: true as const };
  });
}

/** Tira o acesso (a pessoa deixa de entrar na hora); o histórico fica. */
export async function tirarAcesso(db: Db, organizacaoId: string, profissionalId: string, autorId: string | null): Promise<Resultado> {
  if (!uuidValido(profissionalId)) return { ok: false, erro: "Profissional não encontrada." };
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(profissionaisLimpeza)
      .where(and(eq(profissionaisLimpeza.id, profissionalId), eq(profissionaisLimpeza.organizacaoId, organizacaoId)))
      .for("update");
    if (!p?.usuarioId) return { ok: false as const, erro: "Essa profissional não tem acesso." };
    const [alterado] = await tx.update(usuarios).set({ ativo: false }).where(contaDaEquipe(organizacaoId, p.usuarioId)).returning({ id: usuarios.id });
    if (!alterado) return { ok: false as const, erro: ACESSO_INCONSISTENTE };
    await registrarAuditoria(tx, {
      organizacaoId,
      usuarioId: autorId,
      acao: "profissional_limpeza.acesso",
      entidade: "profissional_limpeza",
      entidadeId: p.id,
      mudancas: { acesso: ["liberado", "retirado"] },
    });
    return { ok: true as const };
  });
}

/**
 * Aviso de limpeza atribuída (e-mail enquanto não há WhatsApp). Só para quem tem acesso ativo.
 * A chave de idempotência é da confirmação e do destinatário: repetir o mesmo aviso não manda duas
 * vezes; uma nova confirmação ou um e-mail corrigido é outro aviso. Falha no envio não desfaz a atribuição: vira aviso na tela.
 */
export async function avisarAtribuicao(
  db: Db,
  organizacaoId: string,
  limpezaId: string,
  correio: Correio | null,
  link: string,
): Promise<{ enviado: boolean; aviso: string | null }> {
  if (!uuidValido(limpezaId)) return { enviado: false, aviso: null };
  const [l] = await db
    .select({
      data: limpezas.data,
      estado: limpezas.estado,
      profissionalId: limpezas.profissionalId,
      confirmadaEm: limpezas.confirmadaEm,
      imovelCodigo: imoveis.codigo,
      imovelNome: imoveis.nome,
      email: usuarios.email,
      ativo: usuarios.ativo,
      nome: profissionaisLimpeza.nome,
    })
    .from(limpezas)
    .innerJoin(imoveis, eq(imoveis.id, limpezas.imovelId))
    .innerJoin(profissionaisLimpeza, eq(profissionaisLimpeza.id, limpezas.profissionalId))
    .innerJoin(usuarios, contaDaEquipe(organizacaoId, profissionaisLimpeza.usuarioId))
    .where(and(eq(limpezas.id, limpezaId), eq(limpezas.organizacaoId, organizacaoId), eq(profissionaisLimpeza.organizacaoId, organizacaoId), eq(profissionaisLimpeza.ativo, true)));
  // Sem acesso pelo celular, ou acesso só com usuário e senha (sem e-mail, M6.8): nada a avisar por e-mail (a equipe
  // vê na tela dela e o aviso vai pelo WhatsApp quando ele ligar).
  if (!l || !l.ativo || l.estado !== "confirmada" || !l.email) return { enviado: false, aviso: null };
  if (!correio) return { enviado: false, aviso: "Sem provedor de e-mail: a profissional não foi avisada por e-mail." };
  try {
    await correio.enviar({
      para: l.email,
      assunto: `Limpeza ${diaBr(l.data)} — ${l.imovelCodigo}`,
      texto: `Olá, ${l.nome.split(" ")[0]}.\n\nVocê tem uma limpeza no ${l.imovelCodigo} (${l.imovelNome}) no dia ${diaBr(l.data)}.\n\nVeja as suas limpezas e marque como feita em: ${link}\n`,
      // Uma chave por confirmação e destinatário: confirmada de novo (mudou imóvel ou data, A→B→A) ou
      // e-mail de acesso corrigido é outro aviso; repetir o mesmo aviso não manda duas vezes.
      chave: `limpeza-aviso:${limpezaId}:${l.profissionalId}:${l.confirmadaEm?.getTime() ?? 0}:${l.email.toLowerCase()}`,
    });
    return { enviado: true, aviso: null };
  } catch (e) {
    return { enviado: false, aviso: `A limpeza foi confirmada, mas o e-mail para a profissional falhou (${e instanceof Error ? e.message : String(e)}).` };
  }
}

