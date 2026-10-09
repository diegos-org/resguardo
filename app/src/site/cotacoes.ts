/**
 * Cotação persistida e hold do site (M8.1). A cotação guarda o que o visitante viu (datas, pessoas, valor
 * por partes e situação) com um código público. "Segurar as datas" cria um pedido de reserva (estado
 * `pedido`, origem `site`) que ocupa o calendário do SCL por alguns minutos (configurável em Calendário e
 * preços → Site público), com a trava do imóvel para dois visitantes não segurarem as mesmas noites. O
 * pedido vence sozinho (rotina) e a equipe confirma ou cancela no painel; o pagamento online (M8.2) vai
 * usar este mesmo hold. Nada é escrito no Beds24 aqui (M8.3).
 */
import { randomInt } from "node:crypto";
import { and, count, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import { travaOcupada, violouUnicidade } from "@/db/erros";
import { cotacoes, type EstadoCotacao, imoveis, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { CARENCIA_PAGAMENTO_MINUTOS, CARENCIA_PAGAMENTO_MS, cotacaoEmCarencia, tentativaSeguraAsDatas } from "@/pagamentos/andamento";
import { cancelarReserva, sincronizarReserva } from "@/reservas/repositorio";
import { consultarDisponibilidade, type Disponibilidade } from "./disponibilidade";
import type { PedidoConsulta } from "./site";

export type Cotacao = typeof cotacoes.$inferSelect;
export type Contato = { nome: string; email: string; telefone: string };
export type ErrosContato = Partial<Record<keyof Contato, string>>;

/** Quantos pedidos do site podem estar em andamento ao mesmo tempo num imóvel (freio contra abuso). */
export const MAXIMO_HOLDS_POR_IMOVEL = 5;
/** Quantas cotações abertas (sem pedido) um imóvel aceita em 24 h; acima disso, o site pede para falar com a equipe. */
export const MAXIMO_COTACOES_ABERTAS_POR_IMOVEL = 100;
/** Repetir a mesma consulta (mesmo imóvel, datas, pessoas e valores) dentro deste prazo reaproveita a cotação aberta. */
export const REAPROVEITAR_COTACAO_MS = 24 * 3_600_000;
/** Cotação que nunca virou pedido é apagada depois deste prazo (não há histórico a preservar). */
export const GUARDAR_COTACAO_SEM_PEDIDO_DIAS = 30;
/**
 * Carência do pagamento no site (M8.2a): pedido com Pix em andamento, ou aprovado ainda sem decisão, só vence 15
 * minutos depois do prazo das datas. Nesse tempo as noites continuam ocupadas.
 */
export { CARENCIA_PAGAMENTO_MINUTOS, CARENCIA_PAGAMENTO_MS };

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
/** Código público da cotação, ex.: COT-7K2QXM9A. Não é credencial. */
export function gerarCodigoCotacao(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return `COT-${s}`;
}
export const codigoCotacaoValido = (c: string) => /^COT-[A-HJ-NP-Z2-9]{8}$/.test(c);

const MENSAGEM_ESTADO: Record<EstadoCotacao, string> = {
  aberta: "",
  segurada: "As datas desta cotação já estão seguradas.",
  expirada: "O tempo desta cotação acabou e as datas voltaram à venda. Faça uma nova consulta.",
  convertida: "Esta cotação já virou reserva.",
  desatualizada: "O valor ou a disponibilidade mudaram desde esta cotação. Faça uma nova consulta.",
  cancelada: "Este pedido foi cancelado. Faça uma nova consulta.",
};

/** O site pode oferecer "segurar as datas": estadia possível (disponível ou a confirmar) e valor completo. */
export const podeSegurar = (d: Disponibilidade) => (d.situacao === "disponivel" || d.situacao === "a_confirmar") && !!d.cotacao && d.cotacao.diarias !== null && d.cotacao.total !== null;

/**
 * A cotação ainda descreve o que o site mostraria agora: mesma situação (disponível × a confirmar) e mesmos
 * valores. Leitura do Beds24 que venceu ou sumiu muda a situação e, portanto, a cotação.
 */
export function cotacaoBate(c: Pick<Cotacao, "situacao" | "diarias" | "limpeza" | "hospedeExtra" | "valorCheio" | "desconto" | "total">, d: Disponibilidade): boolean {
  if (d.situacao !== "disponivel" && d.situacao !== "a_confirmar") return false;
  if (d.situacao !== c.situacao) return false;
  const v = d.cotacao;
  return !!v && v.diarias === c.diarias && v.limpeza === c.limpeza && v.hospedeExtra === c.hospedeExtra && v.valorCheio === c.valorCheio && v.desconto === c.desconto && v.total === c.total;
}

/** Em linguagem simples, o que mudou entre a cotação e a disponibilidade de agora (para avisos). */
export function motivoDaMudanca(c: Pick<Cotacao, "situacao" | "valorCheio" | "desconto" | "total">, d: Disponibilidade): string {
  if (d.situacao === "indisponivel") return "Essas datas acabaram de ficar indisponíveis.";
  if (d.situacao === "invalida") return "Esta cotação não vale mais para estes dados. Faça uma nova consulta.";
  if (!d.cotacao || d.cotacao.total === null) return "O valor dessas datas agora precisa ser confirmado pela equipe. Faça uma nova consulta.";
  // Valor cheio ou desconto diferentes também são "o valor mudou", mesmo que o total coincida por acaso.
  if (d.cotacao.total !== c.total || d.cotacao.valorCheio !== c.valorCheio || d.cotacao.desconto !== c.desconto) return "O valor mudou desde esta cotação. Faça uma nova consulta para ver o valor atual.";
  return d.situacao === "a_confirmar"
    ? "A disponibilidade dessas datas agora precisa ser confirmada pela equipe (a agenda mais recente ainda não foi conferida). Faça uma nova consulta."
    : "A disponibilidade dessas datas foi confirmada desde a cotação. Faça uma nova consulta para seguir com a situação atual.";
}

export type ResultadoCotacao = { ok: true; cotacao: Cotacao; disponibilidade: Disponibilidade } | { ok: false; erro: string; disponibilidade: Disponibilidade };

/** Grava a cotação do que o site mostra agora. Só quando a estadia é possível e há valor em todas as partes. */
export async function criarCotacao(db: Db, organizacaoId: string, p: PedidoConsulta, agora = new Date()): Promise<ResultadoCotacao> {
  const d = await consultarDisponibilidade(db, organizacaoId, p, agora);
  if (d.situacao === "indisponivel") return { ok: false, erro: "Essas datas não estão disponíveis.", disponibilidade: d };
  if (d.situacao === "invalida") return { ok: false, erro: "Confira os dados da consulta.", disponibilidade: d };
  if (!d.cotacao || d.cotacao.diarias === null || d.cotacao.valorCheio === null || d.cotacao.total === null) return { ok: false, erro: "O valor dessas datas ainda precisa ser confirmado pela equipe: fale com a gente.", disponibilidade: d };
  const [im] = await db.select({ id: imoveis.id }).from(imoveis).where(and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.codigo, p.imovel)));
  if (!im) return { ok: false, erro: "Escolha um apartamento.", disponibilidade: d };
  const hospedes = Number(p.hospedes);
  // A cotação guarda o valor cheio e o desconto como calculados agora: mudar a regra do desconto depois não
  // mexe no que o visitante viu (e a revalidação detecta a diferença).
  const valores = { diarias: d.cotacao.diarias, limpeza: d.cotacao.limpeza, hospedeExtra: d.cotacao.hospedeExtra, valorCheio: d.cotacao.valorCheio, desconto: d.cotacao.desconto, total: d.cotacao.total };
  return db.transaction(async (tx) => {
    // Reaproveitamento, teto e inserção em série por imóvel: pedidos simultâneos não furam o teto nem duplicam.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cotacao-imovel:${im.id}`}))`);
    // A mesma consulta repetida (mesmo imóvel, datas, pessoas, situação e valores) reaproveita a cotação
    // aberta recente: recarregar ou reenviar a página não cria linhas novas.
    const [igual] = await tx
      .select()
      .from(cotacoes)
      .where(
        and(
          eq(cotacoes.organizacaoId, organizacaoId),
          eq(cotacoes.imovelId, im.id),
          eq(cotacoes.estado, "aberta"),
          eq(cotacoes.checkin, p.entrada),
          eq(cotacoes.checkout, p.saida),
          eq(cotacoes.hospedes, hospedes),
          eq(cotacoes.situacao, d.situacao),
          eq(cotacoes.diarias, valores.diarias),
          eq(cotacoes.limpeza, valores.limpeza),
          eq(cotacoes.hospedeExtra, valores.hospedeExtra),
          eq(cotacoes.valorCheio, valores.valorCheio),
          eq(cotacoes.desconto, valores.desconto),
          eq(cotacoes.total, valores.total),
          gte(cotacoes.criadaEm, new Date(agora.getTime() - REAPROVEITAR_COTACAO_MS)),
        ),
      )
      .orderBy(desc(cotacoes.criadaEm))
      .limit(1);
    if (igual) return { ok: true as const, cotacao: igual, disponibilidade: d };
    // Freio: o site é público, então o número de cotações abertas por imóvel nas últimas 24 h tem teto.
    const [{ abertas }] = await tx
      .select({ abertas: count() })
      .from(cotacoes)
      .where(and(eq(cotacoes.organizacaoId, organizacaoId), eq(cotacoes.imovelId, im.id), eq(cotacoes.estado, "aberta"), gte(cotacoes.criadaEm, new Date(agora.getTime() - 24 * 3_600_000))));
    if (Number(abertas) >= MAXIMO_COTACOES_ABERTAS_POR_IMOVEL) return { ok: false as const, erro: "Há muitas consultas em andamento neste apartamento agora. Tente de novo em alguns minutos ou fale com a equipe.", disponibilidade: d };
    for (let tentativa = 0; ; tentativa++) {
      try {
        // Savepoint: se o código público colidir, só esta tentativa é desfeita.
        const c = await tx.transaction(async (sp) => {
          const [linha] = await sp
            .insert(cotacoes)
            .values({
              organizacaoId,
              imovelId: im.id,
              codigo: gerarCodigoCotacao(),
              estado: "aberta",
              checkin: p.entrada,
              checkout: p.saida,
              hospedes,
              noites: d.noites,
              situacao: d.situacao,
              diarias: valores.diarias,
              limpeza: valores.limpeza,
              hospedeExtra: valores.hospedeExtra,
              valorCheio: valores.valorCheio,
              desconto: valores.desconto,
              total: valores.total,
              leituraEm: d.leituraEm,
              criadaEm: agora,
              atualizadaEm: agora,
            })
            .returning();
          return linha;
        });
        return { ok: true as const, cotacao: c, disponibilidade: d };
      } catch (e) {
        // Colisão do código público: raríssima; tenta de novo.
        if (!violouUnicidade(e, "cotacoes_codigo") || tentativa >= 3) throw e;
      }
    }
  });
}

export async function obterCotacao(db: Db, organizacaoId: string, codigo: string): Promise<(Cotacao & { imovelCodigo: string; imovelNome: string; fuso: string }) | null> {
  if (!codigoCotacaoValido(codigo)) return null;
  const [c] = await db
    .select({ cotacao: cotacoes, imovelCodigo: imoveis.codigo, imovelNome: imoveis.nome, fuso: imoveis.fuso })
    .from(cotacoes)
    .innerJoin(imoveis, eq(imoveis.id, cotacoes.imovelId))
    .where(and(eq(cotacoes.organizacaoId, organizacaoId), eq(cotacoes.codigo, codigo)));
  return c ? { ...c.cotacao, imovelCodigo: c.imovelCodigo, imovelNome: c.imovelNome, fuso: c.fuso } : null;
}

const pedidoDa = (c: Cotacao & { imovelCodigo: string }): PedidoConsulta => ({ imovel: c.imovelCodigo, entrada: c.checkin, saida: c.checkout, hospedes: String(c.hospedes) });

export type CotacaoVista = {
  cotacao: Cotacao & { imovelCodigo: string; imovelNome: string; fuso: string };
  /** Estado efetivo agora: hold vencido conta como expirada antes mesmo da rotina; confirmação/cancelamento da equipe refletem. */
  estado: EstadoCotacao;
  /** Disponibilidade e valor recalculados agora (só para cotação aberta); null nos outros estados. */
  atual: Disponibilidade | null;
  /** Cotação aberta cujo valor ou disponibilidade mudaram desde que foi feita. */
  mudou: boolean;
  reserva: { codigo: string; estado: string } | null;
};

/**
 * Cotação para mostrar ao visitante, revalidada: aberta → recalcula disponibilidade e valor e diz se mudou;
 * segurada → reflete o vencimento do hold e o que a equipe fez com o pedido (confirmou, cancelou).
 */
export async function verCotacao(db: Db, organizacaoId: string, codigo: string, agora = new Date()): Promise<CotacaoVista | null> {
  const c = await obterCotacao(db, organizacaoId, codigo);
  if (!c) return null;
  const [reserva] = c.reservaId ? await db.select({ codigo: reservas.codigo, estado: reservas.estado }).from(reservas).where(eq(reservas.id, c.reservaId)) : [];
  let estado: EstadoCotacao = c.estado as EstadoCotacao;
  if (estado === "segurada") {
    if (reserva?.estado === "confirmada" || reserva?.estado === "pendente") estado = "convertida";
    else if (reserva?.estado === "cancelada") estado = c.holdAte && c.holdAte.getTime() <= agora.getTime() ? "expirada" : "cancelada";
    else if (c.holdAte && c.holdAte.getTime() <= agora.getTime()) estado = "expirada";
  }
  const atual = estado === "aberta" ? await consultarDisponibilidade(db, organizacaoId, pedidoDa(c), agora) : null;
  return { cotacao: c, estado, atual, mudou: atual ? !cotacaoBate(c, atual) : false, reserva: reserva ?? null };
}

export function validarContato(e: Record<string, unknown>): { ok: true; dados: Contato } | { ok: false; erros: ErrosContato } {
  const txt = (k: string) => (typeof e[k] === "string" ? (e[k] as string).trim().slice(0, 120) : "");
  const nome = txt("nome");
  const email = txt("email").toLowerCase();
  const telefone = txt("telefone");
  const erros: ErrosContato = {};
  if (nome.length < 2) erros.nome = "Informe seu nome.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erros.email = "Informe um e-mail válido.";
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length < 8 || digitos.length > 15) erros.telefone = "Informe um telefone com DDD.";
  if (Object.keys(erros).length) return { ok: false, erros };
  return { ok: true, dados: { nome, email, telefone } };
}

export type ResultadoHold =
  | { ok: true; cotacao: Cotacao; reservaCodigo: string; holdAte: Date }
  | { ok: false; erro: string; erros?: ErrosContato; motivos?: string[]; estado?: EstadoCotacao };

const dataBr = (d: string) => d.split("-").reverse().join("/");
const brl = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const horaBr = (d: Date, fuso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

/**
 * Segura as datas de uma cotação aberta: numa só transação, trava o imóvel, vence os holds atrasados dele,
 * reconfere disponibilidade e valor (se mudaram, a cotação fica desatualizada e nada é gravado) e cria o
 * pedido de reserva com o contato do visitante. Dois visitantes nas mesmas noites: o segundo vê "acabaram
 * de ficar indisponíveis".
 */
export async function segurarDatas(db: Db, organizacaoId: string, codigo: string, contato: Record<string, unknown>, agora = new Date()): Promise<ResultadoHold> {
  const v = validarContato(contato);
  if (!v.ok) return { ok: false, erro: "Confira seus dados.", erros: v.erros };
  if (!codigoCotacaoValido(codigo)) return { ok: false, erro: "Cotação não encontrada." };
  return db.transaction(async (tx) => {
    const [antes] = await tx.select({ id: cotacoes.id, imovelId: cotacoes.imovelId }).from(cotacoes).where(and(eq(cotacoes.organizacaoId, organizacaoId), eq(cotacoes.codigo, codigo)));
    if (!antes) return { ok: false as const, erro: "Cotação não encontrada." };
    // Ordem única das travas (M8.2a): imóvel → reserva → cotação → pagamentos. A trava do imóvel (a mesma dos
    // bloqueios) também impede dois visitantes de segurarem as mesmas noites ao mesmo tempo.
    const [im] = await tx.select({ id: imoveis.id, codigo: imoveis.codigo, fuso: imoveis.fuso }).from(imoveis).where(and(eq(imoveis.id, antes.imovelId), eq(imoveis.organizacaoId, organizacaoId))).for("update");
    if (!im) return { ok: false as const, erro: "Imóvel não encontrado." };
    const [c] = await tx.select().from(cotacoes).where(eq(cotacoes.id, antes.id)).for("update");
    if (!c) return { ok: false as const, erro: "Cotação não encontrada." };
    // Só cotação aberta segue: decidido antes de vencer holds, para esta transação nunca segurar uma cotação
    // já segurada e depois pedir a reserva dela.
    if (c.estado !== "aberta") {
      const efetivo: EstadoCotacao = c.estado === "segurada" && c.holdAte && c.holdAte.getTime() <= agora.getTime() ? "expirada" : (c.estado as EstadoCotacao);
      return { ok: false as const, erro: MENSAGEM_ESTADO[efetivo], estado: efetivo };
    }
    // Holds vencidos deste imóvel liberam as noites antes da conferência.
    await expirarHoldsVencidos(tx, organizacaoId, agora, im.id);
    const d = await consultarDisponibilidade(tx, organizacaoId, { imovel: im.codigo, entrada: c.checkin, saida: c.checkout, hospedes: String(c.hospedes) }, agora);
    if (!cotacaoBate(c, d)) {
      await tx.update(cotacoes).set({ estado: "desatualizada", atualizadaEm: agora }).where(eq(cotacoes.id, c.id));
      return { ok: false as const, erro: motivoDaMudanca(c, d), motivos: d.motivos, estado: "desatualizada" };
    }
    // Freios contra abuso: poucos pedidos em andamento por imóvel e um por e-mail. A trava do imóvel não
    // serializa o mesmo e-mail em imóveis diferentes, então o e-mail ganha a própria trava (na transação,
    // sempre depois da do imóvel, para não haver espera cruzada).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cotacao-email:${organizacaoId}:${v.dados.email}`}))`);
    const ativos = await tx
      .select({ imovelId: cotacoes.imovelId, email: reservas.hospedeEmail, holdAte: cotacoes.holdAte })
      .from(cotacoes)
      .innerJoin(reservas, eq(reservas.id, cotacoes.reservaId))
      .where(and(eq(cotacoes.organizacaoId, organizacaoId), eq(cotacoes.estado, "segurada"), eq(reservas.estado, "pedido")));
    if (ativos.some((a) => a.email === v.dados.email && a.holdAte && a.holdAte.getTime() > agora.getTime())) return { ok: false as const, erro: "Já existe uma reserva em andamento com este e-mail. Conclua aquela ou aguarde o prazo dela acabar." };
    // Pagamento do site em andamento, ou aprovado e ainda sem desfecho, com este e-mail (M8.2a): mesmo com o prazo
    // daquelas datas vencido, não segura outras — senão o mesmo hóspede pagaria duas vezes.
    const [pagando] = await tx
      .select({ id: pagamentos.id })
      .from(pagamentos)
      .innerJoin(reservas, eq(reservas.id, pagamentos.reservaId))
      .where(and(eq(pagamentos.organizacaoId, organizacaoId), eq(reservas.hospedeEmail, v.dados.email), or(tentativaSeguraAsDatas(), and(eq(pagamentos.situacao, "aprovado"), isNull(pagamentos.desfecho)))))
      .limit(1);
    if (pagando) return { ok: false as const, erro: "Você tem um pagamento em andamento com este e-mail. Aguarde a confirmação dele ou fale com a equipe." };
    // Os holds deste imóvel que sobraram depois do vencimento acima ainda valem (ou estão na carência de um pagamento).
    if (ativos.filter((a) => a.imovelId === im.id).length >= MAXIMO_HOLDS_POR_IMOVEL) return { ok: false as const, erro: "Há muitas reservas em andamento neste apartamento agora. Tente de novo em alguns minutos ou fale com a equipe." };
    const regras = await lerRegrasCalendario(tx, organizacaoId);
    const holdAte = new Date(agora.getTime() + regras.site.minutosHold * 60_000);
    const r = await sincronizarReserva(
      tx,
      organizacaoId,
      "site",
      c.id,
      {
        imovelId: im.id,
        origem: "site",
        estado: "pedido",
        reservadaEm: agora,
        checkin: c.checkin,
        checkout: c.checkout,
        hospedes: c.hospedes,
        hospedeNome: v.dados.nome,
        hospedeEmail: v.dados.email,
        hospedeTelefone: v.dados.telefone,
        hospedeOrigem: "",
        moeda: "BRL",
        valorBruto: c.total,
        taxaCanal: null,
        valorLiquido: null,
        codigoCanal: c.codigo,
        observacoes: `Pedido pelo site — cotação ${c.codigo}${c.desconto > 0 ? ` (valor cheio ${brl(c.valorCheio)}, desconto do site ${brl(c.desconto)})` : ""}. Datas seguradas até ${horaBr(holdAte, im.fuso)}; depois disso o pedido vence sozinho se não for confirmado.`,
      },
      null,
    );
    if (!r.ok) return { ok: false as const, erro: Object.values(r.erros)[0] ?? "Não foi possível segurar as datas." };
    const [atual] = await tx.update(cotacoes).set({ estado: "segurada", reservaId: r.reserva.id, holdAte, atualizadaEm: agora }).where(eq(cotacoes.id, c.id)).returning();
    await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "cotacao.segurar", entidade: "reserva", entidadeId: r.reserva.id, mudancas: { cotacao: [null, `${c.codigo} até ${holdAte.toISOString()}`] } });
    return { ok: true as const, cotacao: atual, reservaCodigo: r.reserva.codigo, holdAte };
  });
}

export type ResumoExpiracao = { expiradas: number; convertidas: number; canceladas: number; removidas: number };

/**
 * Fecha o ciclo de um hold, já com as travas imóvel → reserva → cotação tomadas por quem chama. Pedido vencido é
 * cancelado (as noites voltam à venda) e a cotação fica expirada — salvo na carência de um pagamento (M8.2a);
 * pedido que a equipe já confirmou vira cotação convertida; pedido que a equipe cancelou, cancelada.
 */
async function fecharHold(tx: Db, c: { id: string; organizacaoId: string; reservaId: string }, agora: Date, resumo: ResumoExpiracao): Promise<void> {
  const [r] = await tx.select({ estado: reservas.estado }).from(reservas).where(eq(reservas.id, c.reservaId)).for("update");
  const [cot] = await tx.select({ estado: cotacoes.estado, holdAte: cotacoes.holdAte }).from(cotacoes).where(eq(cotacoes.id, c.id)).for("update");
  // Relê depois das travas: outra transação pode ter fechado esta cotação no meio.
  if (!r || !cot || cot.estado !== "segurada") return;
  let estado: EstadoCotacao;
  if (r.estado === "pedido") {
    if (!cot.holdAte || cot.holdAte.getTime() > agora.getTime()) return;
    // Pix pago no último minuto: o aviso ainda pode estar a caminho. O pedido segue ocupando as noites.
    if (await cotacaoEmCarencia(tx, c.id, cot.holdAte, agora)) return;
    await cancelarReserva(tx, c.organizacaoId, c.reservaId, null, { vencimento: true, agora });
    estado = "expirada";
    resumo.expiradas++;
  } else if (r.estado === "cancelada") {
    estado = "cancelada";
    resumo.canceladas++;
  } else {
    estado = "convertida";
    resumo.convertidas++;
  }
  await tx.update(cotacoes).set({ estado, atualizadaEm: agora }).where(eq(cotacoes.id, c.id));
}

/**
 * Fecha o ciclo dos holds (ver `fecharHold`). Sem `imovelId` (rotina), cada hold vence numa transação curta
 * própria, travando o imóvel primeiro (a ordem única: imóvel → reserva → cotação → pagamentos), e a rotina
 * também apaga cotações que nunca viraram pedido depois de 30 dias. Com `imovelId` (antes de segurar), roda na
 * transação de quem chama, que já travou o imóvel. `organizacaoId` null = todas as empresas (rotina).
 */
export async function expirarHoldsVencidos(db: Db, organizacaoId: string | null, agora = new Date(), imovelId?: string): Promise<ResumoExpiracao> {
  const resumo: ResumoExpiracao = { expiradas: 0, convertidas: 0, canceladas: 0, removidas: 0 };
  const candidatas = (q: Db) =>
    q
      .select({ id: cotacoes.id, organizacaoId: cotacoes.organizacaoId, imovelId: cotacoes.imovelId, reservaId: reservas.id })
      .from(cotacoes)
      .innerJoin(reservas, eq(reservas.id, cotacoes.reservaId))
      .where(
        and(
          eq(cotacoes.estado, "segurada"),
          organizacaoId ? eq(cotacoes.organizacaoId, organizacaoId) : undefined,
          imovelId ? eq(cotacoes.imovelId, imovelId) : undefined,
          or(lte(cotacoes.holdAte, agora), ne(reservas.estado, "pedido")),
        ),
      )
      .orderBy(cotacoes.id);
  if (imovelId) {
    return db.transaction(async (tx) => {
      for (const c of await candidatas(tx)) await fecharHold(tx, c, agora, resumo);
      return resumo;
    });
  }
  for (const c of await candidatas(db)) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '15s'`);
        await tx.select({ id: imoveis.id }).from(imoveis).where(eq(imoveis.id, c.imovelId)).for("update");
        await fecharHold(tx, c, agora, resumo);
      });
    } catch (e) {
      // Imóvel ocupado por outra transação além do tempo-limite: este hold fica para a próxima volta da rotina.
      if (!travaOcupada(e)) throw e;
    }
  }
  const antigas = await db
    .delete(cotacoes)
    .where(
      and(
        organizacaoId ? eq(cotacoes.organizacaoId, organizacaoId) : undefined,
        inArray(cotacoes.estado, ["aberta", "desatualizada"]),
        isNull(cotacoes.reservaId),
        lt(cotacoes.criadaEm, new Date(agora.getTime() - GUARDAR_COTACAO_SEM_PEDIDO_DIAS * 86_400_000)),
      ),
    )
    .returning({ id: cotacoes.id });
  resumo.removidas = antigas.length;
  return resumo;
}

/**
 * Estende o prazo das datas de uma cotação segurada (M8.2a: cada Pix segura as datas por pelo menos o tempo dele
 * e mais uma folga). Só estende, nunca encurta; quem chama já tem as travas. Auditoria sem dados pessoais.
 */
export async function estenderHold(tx: Db, organizacaoId: string, cotacaoId: string, ate: Date, agora: Date, pagamentoId: string | null): Promise<boolean> {
  const [c] = await tx
    .select({ estado: cotacoes.estado, holdAte: cotacoes.holdAte, reservaId: cotacoes.reservaId, fuso: imoveis.fuso })
    .from(cotacoes)
    .innerJoin(imoveis, eq(imoveis.id, cotacoes.imovelId))
    .where(and(eq(cotacoes.id, cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)));
  if (!c || c.estado !== "segurada" || !c.holdAte || c.holdAte.getTime() >= ate.getTime()) return false;
  await tx.update(cotacoes).set({ holdAte: ate, atualizadaEm: agora }).where(eq(cotacoes.id, cotacaoId));
  // A observação do pedido diz até quando as datas estão seguradas: acompanha a extensão (campo fora do financeiro).
  if (c.reservaId) {
    const [r] = await tx.select({ observacoes: reservas.observacoes }).from(reservas).where(eq(reservas.id, c.reservaId));
    const nova = r?.observacoes.replace(/Datas seguradas até [^;.]+(?: \(estendido pelo Pix\))?;/, `Datas seguradas até ${horaBr(ate, c.fuso)} (estendido pelo Pix);`);
    if (r && nova !== r.observacoes) await tx.update(reservas).set({ observacoes: nova }).where(eq(reservas.id, c.reservaId));
  }
  await registrarAuditoria(tx, { organizacaoId, usuarioId: null, acao: "cotacao.estender", entidade: "cotacao", entidadeId: cotacaoId, mudancas: { holdAte: [c.holdAte.toISOString(), ate.toISOString()], ...(pagamentoId ? { pagamento: [null, pagamentoId] } : {}) } });
  return true;
}

/** Mensagem que o visitante manda à equipe com a cotação (e o prazo do hold, quando segurada). */
export function textoDaCotacao(v: CotacaoVista): string {
  const c = v.cotacao;
  const linhas = [
    `Olá! Fiz a cotação ${c.codigo} no site para o ${c.imovelNome} (${c.imovelCodigo}).`,
    `Entrada: ${dataBr(c.checkin)} · Saída: ${dataBr(c.checkout)} · ${c.hospedes} ${c.hospedes === 1 ? "pessoa" : "pessoas"} · ${brl(c.total)} por ${c.noites} ${c.noites === 1 ? "noite" : "noites"}${c.desconto > 0 ? ` (valor cheio ${brl(c.valorCheio)}, já com o desconto do site de ${brl(c.desconto)})` : ""}.`,
  ];
  if (v.estado === "segurada" && c.holdAte) linhas.push(`As datas estão seguradas para mim até ${horaBr(c.holdAte, c.fuso)}. Quero confirmar a reserva.`);
  else if (v.estado === "convertida" && v.reserva) linhas.push(`Minha reserva é a ${v.reserva.codigo}.`);
  else linhas.push("Gostaria de confirmar a reserva.");
  return linhas.join("\n");
}
