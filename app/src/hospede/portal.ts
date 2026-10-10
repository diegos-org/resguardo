/**
 * Portal do hóspede (M9.1): o hóspede entra com um código enviado ao e-mail que já está na
 * reserva (o código da reserva não é credencial) e vê só as próprias reservas.
 *
 * - Quem pode receber código: e-mail de alguma reserva confirmada que ainda não terminou há mais
 *   de `DIAS_APOS_SAIDA` dias. A tela responde sempre igual (não revela se há reserva).
 * - A autorização é refeita a cada acesso pelo e-mail: trocar o e-mail da reserva no painel ou
 *   cancelá-la tira o acesso na hora (é a revogação).
 * - Instruções de chegada (endereço completo) só a partir de 2 dias antes da entrada, às 10h no
 *   fuso do imóvel, até o horário de saída. Estar logado não antecipa a liberação.
 * - Tudo restrito à organização do site: reserva de outra empresa no mesmo banco não conta.
 * - Alteração da reserva paga pelo site (M8.2d): enquanto uma alteração está com as novas datas seguradas (pela situação
 *   que vale agora, com a carência de um pagamento da diferença em andamento), a reserva ganha uma linha com o que ela
 *   espera (o pagamento da diferença ou a confirmação) e o link da página da reserva no site, onde está o resto. Sem
 *   valores (a regra do M9.1).
 */
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { emitirCodigo, emailValido, type OpcoesCodigo, type ResultadoPedido, verificarCodigo } from "@/acesso/codigo-email";
import { normalizarEmail } from "@/acesso/entrada";
import { lerEmpresa } from "@/configuracoes/empresa";
import { alteracoesReserva, cotacoes, imoveis, imoveisDetalhes, pagamentos, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { hojeISO, instanteLocal, somarDias } from "@/lib/datas";
import { situacaoEfetiva } from "@/pagamentos/alteracao-regras";
import { carenciaNoTravado } from "@/pagamentos/travas";
import { numeroWhatsapp } from "@/site/site";

// Moram em lib/datas (o cancelamento do M8.2c usa as mesmas); continuam saindo daqui para quem já importava.
export { instanteLocal, somarDias };

/** Depois da saída, o hóspede ainda vê a reserva por este tempo. */
export const DIAS_APOS_SAIDA = 30;
/** Liberação das instruções de chegada: 2 dias antes da entrada, às 10h (fuso do imóvel). */
export const INSTRUCOES_DIAS_ANTES = 2;
export const INSTRUCOES_HORA = "10:00";

export const liberacaoDasInstrucoes = (checkin: string, fuso: string) => instanteLocal(somarDias(checkin, -INSTRUCOES_DIAS_ANTES), INSTRUCOES_HORA, fuso);

/** Reservas daquele e-mail, só da organização do site (nunca de outra empresa no mesmo banco). O pedido de cancelamento (M8.2c) usa o mesmo filtro. */
export const doEmail = (organizacaoId: string, email: string) => and(eq(reservas.organizacaoId, organizacaoId), eq(sql`lower(trim(${reservas.hospedeEmail}))`, email));
export const vigentes = (hoje: string) => and(eq(reservas.estado, "confirmada"), gte(reservas.checkout, somarDias(hoje, -DIAS_APOS_SAIDA)));

/** O e-mail tem alguma reserva que dá acesso ao portal agora? */
export async function hospedeTemAcesso(db: Db, organizacaoId: string, email: string, agora: Date): Promise<boolean> {
  const e = normalizarEmail(email);
  if (!emailValido(e)) return false;
  const [r] = await db.select({ id: reservas.id }).from(reservas).where(and(doEmail(organizacaoId, e), vigentes(hojeISO(undefined, agora)))).limit(1);
  return Boolean(r);
}

/** Envia o código de acesso ao portal (mesmas regras do login: validade, tentativas e limites). */
export async function pedirCodigoHospede(
  db: Db,
  correio: Correio,
  organizacaoId: string,
  emailBruto: string,
  o: Pick<OpcoesCodigo, "segredo" | "agora" | "gerar">,
): Promise<ResultadoPedido> {
  const email = normalizarEmail(emailBruto);
  if (!emailValido(email)) return "invalido";
  const agora = o.agora ?? new Date();
  return emitirCodigo(db, correio, email, { ...o, agora, escopo: "hospede" }, {
    autorizado: () => hospedeTemAcesso(db, organizacaoId, email, agora),
    mensagem: async (codigo) => {
      const empresa = (await lerEmpresa(db, organizacaoId)).nome;
      return {
        assunto: `Seu código para ver a reserva: ${codigo}`,
        texto: `Seu código para ver sua reserva${empresa ? ` na ${empresa}` : ""} é ${codigo}.\n\nEle vale por 10 minutos e só pode ser usado uma vez.\nSe você não pediu este código, ignore este e-mail.`,
      };
    },
  });
}

/** Confere o código do portal: só vale o código pedido pelo portal do hóspede, e só se o acesso continua. */
export async function verificarCodigoHospede(db: Db, organizacaoId: string, email: string, codigo: string, o: { segredo: string; agora?: Date }) {
  const agora = o.agora ?? new Date();
  const r = await verificarCodigo(db, email, codigo, { segredo: o.segredo, agora, escopo: "hospede" });
  if (r.ok && !(await hospedeTemAcesso(db, organizacaoId, r.email, agora))) return { ok: false as const, motivo: "invalido" as const };
  return r;
}

export type Instrucoes = { liberadas: true; endereco: string; complemento: string } | { liberadas: false; liberaEm: Date; /** Dia da liberação ("AAAA-MM-DD"), às INSTRUCOES_HORA no fuso do imóvel. */ dia: string };

export type ReservaDoHospede = {
  codigo: string;
  imovel: string;
  bairro: string;
  cidade: string;
  checkin: string;
  checkout: string;
  noites: number;
  hospedes: number | null;
  nomeHospede: string;
  entradaAPartirDe: string;
  saidaAte: string;
  /** Já saiu (a reserva ainda aparece por alguns dias). */
  encerrada: boolean;
  instrucoes: Instrucoes;
  contato: { empresa: string; whatsapp: string | null; email: string };
  /** M8.2d: a alteração com as novas datas seguradas, quando há (sem valores). */
  alteracao?: AlteracaoNoPortal | null;
};

/**
 * A alteração esperando o hóspede: o pagamento da diferença (aumento) ou a confirmação dele, até quando, e onde ver.
 * `pagamentoEmAndamento`: o prazo das novas datas acabou, mas um pagamento da diferença em andamento ainda as segura (a
 * carência).
 */
export type AlteracaoNoPortal = { espera: "pagamento" | "confirmacao"; ate: Date; pagamentoEmAndamento: boolean; link: string };

/**
 * As alterações com as novas datas seguradas, por reserva (desta organização), pela situação que vale agora
 * (`situacaoEfetiva`, a mesma do painel e da página da reserva): no prazo, ou na carência de um pagamento da diferença em
 * andamento. Vencida a alteração, a linha some (a página da reserva no site mostra o resto).
 */
async function alteracoesSeguradas(db: Db, organizacaoId: string, reservaIds: string[], agora: Date): Promise<Map<string, AlteracaoNoPortal>> {
  if (!reservaIds.length) return new Map();
  const linhas = await db
    .select({ id: alteracoesReserva.id, situacao: alteracoesReserva.situacao, reservaId: alteracoesReserva.reservaId, diferenca: alteracoesReserva.diferenca, holdAte: alteracoesReserva.holdAte, codigo: cotacoes.codigo })
    .from(alteracoesReserva)
    .innerJoin(cotacoes, and(eq(cotacoes.id, alteracoesReserva.cotacaoId), eq(cotacoes.organizacaoId, organizacaoId)))
    .where(and(eq(alteracoesReserva.organizacaoId, organizacaoId), inArray(alteracoesReserva.reservaId, reservaIds), eq(alteracoesReserva.situacao, "segurada")));
  // As tentativas da diferença das que já passaram do prazo (só elas podem estar na carência).
  const vencidas = linhas.filter((l) => !l.holdAte || l.holdAte.getTime() <= agora.getTime()).map((l) => l.id);
  const tentativas = vencidas.length ? await db.select().from(pagamentos).where(and(eq(pagamentos.organizacaoId, organizacaoId), inArray(pagamentos.alteracaoId, vencidas))) : [];
  const carencia = carenciaNoTravado({ tentativas }, agora);
  const r = new Map<string, AlteracaoNoPortal>();
  for (const l of linhas) {
    if (!l.holdAte || situacaoEfetiva(l, agora, carencia(l)) !== "segurada") continue;
    r.set(l.reservaId, { espera: l.diferenca > 0 ? "pagamento" : "confirmacao", ate: l.holdAte, pagamentoEmAndamento: l.holdAte.getTime() <= agora.getTime(), link: `/reservar/${encodeURIComponent(l.codigo)}` });
  }
  return r;
}

/** As reservas do hóspede logado, com as instruções de chegada só depois da liberação. */
export async function reservasDoHospede(db: Db, organizacaoId: string, email: string, agora: Date): Promise<ReservaDoHospede[]> {
  const e = normalizarEmail(email);
  if (!emailValido(e)) return [];
  const hoje = hojeISO(undefined, agora);
  const linhas = await db
    .select({
      id: reservas.id,
      codigo: reservas.codigo,
      checkin: reservas.checkin,
      checkout: reservas.checkout,
      hospedes: reservas.hospedes,
      nomeHospede: reservas.hospedeNome,
      imovel: imoveis.nome,
      bairro: imoveis.bairro,
      cidade: imoveis.cidade,
      fuso: imoveis.fuso,
      endereco: imoveis.endereco,
      complemento: imoveisDetalhes.complemento,
      entradaAPartirDe: imoveisDetalhes.checkinAPartirDe,
      saidaAte: imoveisDetalhes.checkoutAte,
    })
    .from(reservas)
    .innerJoin(imoveis, and(eq(imoveis.id, reservas.imovelId), eq(imoveis.organizacaoId, reservas.organizacaoId)))
    .leftJoin(imoveisDetalhes, eq(imoveisDetalhes.imovelId, imoveis.id))
    .where(and(doEmail(organizacaoId, e), vigentes(hoje)))
    .orderBy(asc(reservas.checkin), asc(reservas.codigo));

  const empresa = linhas.length ? await lerEmpresa(db, organizacaoId) : null;
  const alteracoes = await alteracoesSeguradas(db, organizacaoId, linhas.map((l) => l.id), agora);

  return linhas.map((l) => {
    const fuso = l.fuso || "America/Sao_Paulo";
    const liberaEm = liberacaoDasInstrucoes(l.checkin, fuso);
    const saidaAte = l.saidaAte ?? "11:00";
    // A estadia acaba no horário de saída do imóvel (não à meia-noite): daí em diante, sem endereço.
    const encerrada = agora.getTime() >= instanteLocal(l.checkout, saidaAte, fuso).getTime();
    return {
      codigo: l.codigo,
      imovel: l.imovel,
      bairro: l.bairro,
      cidade: l.cidade,
      checkin: l.checkin,
      checkout: l.checkout,
      noites: Math.round((Date.parse(l.checkout) - Date.parse(l.checkin)) / 86_400_000),
      hospedes: l.hospedes,
      nomeHospede: l.nomeHospede,
      entradaAPartirDe: l.entradaAPartirDe ?? "15:00",
      saidaAte,
      encerrada,
      instrucoes:
        agora.getTime() >= liberaEm.getTime() && !encerrada
          ? { liberadas: true, endereco: l.endereco, complemento: l.complemento ?? "" }
          : { liberadas: false, liberaEm, dia: somarDias(l.checkin, -INSTRUCOES_DIAS_ANTES) },
      contato: { empresa: empresa!.nome, whatsapp: numeroWhatsapp(empresa!.telefone), email: empresa!.email },
      alteracao: alteracoes.get(l.id) ?? null,
    };
  });
}
