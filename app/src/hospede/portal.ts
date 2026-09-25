/**
 * Portal do hóspede (M9.1): o hóspede entra com um código enviado ao e-mail que já está na
 * reserva (o código da reserva não é credencial) e vê só as próprias reservas.
 *
 * - Quem pode receber código: e-mail de alguma reserva confirmada que ainda não terminou há mais
 *   de `DIAS_APOS_SAIDA` dias. A tela responde sempre igual (não revela se há reserva).
 * - A autorização é refeita a cada acesso pelo e-mail: trocar o e-mail da reserva no painel ou
 *   cancelá-la tira o acesso na hora (é a revogação).
 * - Instruções de chegada (endereço completo) só a partir de 2 dias antes da entrada, às 10h no
 *   fuso do imóvel. Estar logado não antecipa a liberação.
 */
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { emitirCodigo, emailValido, type OpcoesCodigo, type ResultadoPedido, verificarCodigo } from "@/acesso/codigo-email";
import { normalizarEmail } from "@/acesso/entrada";
import { lerEmpresa } from "@/configuracoes/empresa";
import { imoveis, imoveisDetalhes, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { hojeISO } from "@/lib/datas";
import { numeroWhatsapp } from "@/site/site";

/** Depois da saída, o hóspede ainda vê a reserva por este tempo. */
export const DIAS_APOS_SAIDA = 30;
/** Liberação das instruções de chegada: 2 dias antes da entrada, às 10h (fuso do imóvel). */
export const INSTRUCOES_DIAS_ANTES = 2;
export const INSTRUCOES_HORA = "10:00";

const somarDias = (dataISO: string, dias: number) => {
  const d = new Date(`${dataISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** Diferença (ms) entre o relógio local do fuso e o UTC naquele instante. */
function deslocamento(instante: number, fuso: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(instante))
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instante;
}

/** O instante em que é `hora` ("HH:MM") do dia `dataISO` no fuso informado. */
export function instanteLocal(dataISO: string, hora: string, fuso: string): Date {
  const [a, m, d] = dataISO.split("-").map(Number);
  const [h, min] = hora.split(":").map(Number);
  const relogio = Date.UTC(a, m - 1, d, h, min);
  const t = relogio - deslocamento(relogio, fuso);
  return new Date(relogio - deslocamento(t, fuso));
}

export const liberacaoDasInstrucoes = (checkin: string, fuso: string) => instanteLocal(somarDias(checkin, -INSTRUCOES_DIAS_ANTES), INSTRUCOES_HORA, fuso);

const doEmail = (email: string) => eq(sql`lower(trim(${reservas.hospedeEmail}))`, email);
const vigentes = (hoje: string) => and(eq(reservas.estado, "confirmada"), gte(reservas.checkout, somarDias(hoje, -DIAS_APOS_SAIDA)));

/** O e-mail tem alguma reserva que dá acesso ao portal agora? */
export async function hospedeTemAcesso(db: Db, email: string, agora: Date): Promise<boolean> {
  const e = normalizarEmail(email);
  if (!emailValido(e)) return false;
  const [r] = await db.select({ id: reservas.id }).from(reservas).where(and(doEmail(e), vigentes(hojeISO(undefined, agora)))).limit(1);
  return Boolean(r);
}

/** Envia o código de acesso ao portal (mesmas regras do login: validade, tentativas e limites). */
export async function pedirCodigoHospede(db: Db, correio: Correio, emailBruto: string, o: Pick<OpcoesCodigo, "segredo" | "agora" | "gerar">): Promise<ResultadoPedido> {
  const email = normalizarEmail(emailBruto);
  if (!emailValido(email)) return "invalido";
  const agora = o.agora ?? new Date();
  return emitirCodigo(db, correio, email, { ...o, agora, escopo: "hospede" }, {
    autorizado: () => hospedeTemAcesso(db, email, agora),
    mensagem: async (codigo) => {
      const [r] = await db.select({ org: reservas.organizacaoId }).from(reservas).where(doEmail(email)).limit(1);
      const empresa = r ? (await lerEmpresa(db, r.org)).nome : "";
      return {
        assunto: `Seu código para ver a reserva: ${codigo}`,
        texto: `Seu código para ver sua reserva${empresa ? ` na ${empresa}` : ""} é ${codigo}.\n\nEle vale por 10 minutos e só pode ser usado uma vez.\nSe você não pediu este código, ignore este e-mail.`,
      };
    },
  });
}

/** Confere o código do portal: só vale o código pedido pelo portal do hóspede, e só se o acesso continua. */
export async function verificarCodigoHospede(db: Db, email: string, codigo: string, o: { segredo: string; agora?: Date }) {
  const agora = o.agora ?? new Date();
  const r = await verificarCodigo(db, email, codigo, { segredo: o.segredo, agora, escopo: "hospede" });
  if (r.ok && !(await hospedeTemAcesso(db, r.email, agora))) return { ok: false as const, motivo: "invalido" as const };
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
};

/** As reservas do hóspede logado, com as instruções de chegada só depois da liberação. */
export async function reservasDoHospede(db: Db, email: string, agora: Date): Promise<ReservaDoHospede[]> {
  const e = normalizarEmail(email);
  if (!emailValido(e)) return [];
  const hoje = hojeISO(undefined, agora);
  const linhas = await db
    .select({
      organizacaoId: reservas.organizacaoId,
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
    .where(and(doEmail(e), vigentes(hoje)))
    .orderBy(asc(reservas.checkin), asc(reservas.codigo));

  const empresas = new Map<string, Awaited<ReturnType<typeof lerEmpresa>>>();
  for (const l of linhas) if (!empresas.has(l.organizacaoId)) empresas.set(l.organizacaoId, await lerEmpresa(db, l.organizacaoId));

  return linhas.map((l) => {
    const liberaEm = liberacaoDasInstrucoes(l.checkin, l.fuso || "America/Sao_Paulo");
    const empresa = empresas.get(l.organizacaoId)!;
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
      saidaAte: l.saidaAte ?? "11:00",
      encerrada: l.checkout < hoje,
      instrucoes:
        agora.getTime() >= liberaEm.getTime() && l.checkout >= hoje
          ? { liberadas: true, endereco: l.endereco, complemento: l.complemento ?? "" }
          : { liberadas: false, liberaEm, dia: somarDias(l.checkin, -INSTRUCOES_DIAS_ANTES) },
      contato: { empresa: empresa.nome, whatsapp: numeroWhatsapp(empresa.telefone), email: empresa.email },
    };
  });
}
