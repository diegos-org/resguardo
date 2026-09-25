/**
 * Mensagens programadas ao hóspede (M9.2), por e-mail, com os modelos editáveis do painel:
 * - confirmação: assim que a reserva é confirmada;
 * - check-in: 2 dias antes da entrada, às 10h (o mesmo momento em que o endereço aparece em
 *   "Minha reserva");
 * - check-out: 1 dia antes da saída, às 14h;
 * - agradecimento: 3 dias depois da saída, às 10h.
 * Horários no fuso do imóvel. Cada execução (agendador) calcula o que está no prazo a partir dos
 * dados atuais: cancelou, a mensagem não sai; mudou a data, vale a nova.
 *
 * Regras:
 * - Desligado até Diego ligar em Configurações → Modelos de mensagem. Ligado, vale daquele momento
 *   em diante: nada que estava previsto para antes é mandado atrasado.
 * - Só para as origens escolhidas (Airbnb e Booking têm as mensagens deles).
 * - Faltou um dado usado no modelo (nome, e-mail, endereço…) ou o modelo sumiu: não manda, avisa.
 * - Uma vez por mensagem: o registro é gravado antes de chamar o provedor. Recusa do provedor:
 *   tenta de novo nas próximas execuções (até 3 vezes). Sem resposta do provedor: fica "incerto" e
 *   não é repetida sozinha (melhor conferir do que mandar duas vezes).
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { emailValido } from "@/acesso/codigo-email";
import { gravarConfig, lerConfig } from "@/configuracoes/armazem";
import { lerEmpresa } from "@/configuracoes/empresa";
import { preencherModelo, type Variavel, variaveisDoTexto } from "@/configuracoes/modelos-texto";
import {
  imoveis,
  imoveisDetalhes,
  mensagensHospede,
  modelosMensagem,
  ORIGENS_RESERVA,
  type OrigemReserva,
  reservas,
  TIPOS_MENSAGEM_HOSPEDE,
  type TipoMensagemHospede,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { type Correio, ErroEnvioIncerto } from "@/email/correio";
import { instanteLocal, liberacaoDasInstrucoes } from "@/hospede/portal";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";

export const NOMES_TIPO: Record<TipoMensagemHospede, string> = {
  confirmacao: "Confirmação da reserva",
  checkin: "Instruções de check-in (2 dias antes da entrada, 10h)",
  checkout: "Lembrete de check-out (1 dia antes da saída, 14h)",
  agradecimento: "Agradecimento (3 dias depois da saída, 10h)",
};

/** Recusas seguidas do provedor antes de desistir de uma mensagem. */
export const MAX_TENTATIVAS = 3;
/** Até quando o agradecimento ainda faz sentido, depois do momento previsto. */
const PRAZO_AGRADECIMENTO_MS = 4 * 24 * 3_600_000;
/** Pedido que ficou "enviando" por mais que isso: não se sabe se saiu (o painel mostra como incerto). */
export const ENVIANDO_INCERTO_MS = 15 * 60_000;

export type ConfigMensagensHospede = {
  ativo: boolean;
  /** ISO: quando foi ligado. Só sai o que estava previsto a partir daí. */
  ativoDesde?: string;
  origens: OrigemReserva[];
  /** Modelo de cada mensagem (id), ou null = essa mensagem não é enviada. */
  modelos: Record<TipoMensagemHospede, string | null>;
};

/** Sem configuração: desligado, só site e direta, nenhum modelo escolhido. */
export const ORIGENS_PADRAO: OrigemReserva[] = ["site", "direta"];

export async function lerConfigMensagens(db: Db, organizacaoId: string): Promise<ConfigMensagensHospede & { salva: boolean }> {
  const c = await lerConfig(db, organizacaoId, "mensagens_hospede");
  const modelosBrutos = (c?.modelos ?? {}) as Record<string, unknown>;
  const modelos = Object.fromEntries(TIPOS_MENSAGEM_HOSPEDE.map((t) => [t, typeof modelosBrutos[t] === "string" ? (modelosBrutos[t] as string) : null])) as ConfigMensagensHospede["modelos"];
  const origens = Array.isArray(c?.origens) ? (c.origens as unknown[]).filter((o): o is OrigemReserva => (ORIGENS_RESERVA as readonly unknown[]).includes(o)) : ORIGENS_PADRAO;
  const ativoDesde = typeof c?.ativoDesde === "string" && !Number.isNaN(Date.parse(c.ativoDesde)) ? c.ativoDesde : undefined;
  return { salva: c !== null, ativo: c?.ativo === true && ativoDesde !== undefined, ...(ativoDesde ? { ativoDesde } : {}), origens, modelos };
}

/** Grava a configuração da tela. Ligar agora = vale de agora em diante (religar também recomeça daqui). */
export async function salvarConfigMensagens(
  db: Db,
  organizacaoId: string,
  c: { ativo: boolean; origens: string[]; modelos: Partial<Record<string, string>> },
  autorId: string | null,
  agora: Date = new Date(),
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const origens = [...new Set(c.origens)].filter((o): o is OrigemReserva => (ORIGENS_RESERVA as readonly string[]).includes(o));
  if (c.ativo && !origens.length) return { ok: false, erro: "Escolha ao menos uma origem de reserva." };
  const ids = TIPOS_MENSAGEM_HOSPEDE.map((t) => c.modelos[t] || null).filter((x): x is string => !!x);
  const validos = ids.filter((i) => uuidValido(i));
  const encontrados = validos.length ? await db.select().from(modelosMensagem).where(and(eq(modelosMensagem.organizacaoId, organizacaoId), inArray(modelosMensagem.id, validos))) : [];
  const porId = new Map(encontrados.map((m) => [m.id, m]));
  const modelos = {} as ConfigMensagensHospede["modelos"];
  for (const t of TIPOS_MENSAGEM_HOSPEDE) {
    const id = c.modelos[t] || null;
    if (id && !porId.get(id)?.ativo) return { ok: false, erro: `Modelo escolhido para "${NOMES_TIPO[t]}" não existe ou está arquivado.` };
    // O endereço só é liberado 2 dias antes da entrada: a confirmação sai antes disso.
    if (id && t === "confirmacao" && variaveisDoTexto(porId.get(id)!.texto).includes("endereco"))
      return { ok: false, erro: "A confirmação não pode usar {endereco}: o endereço só é enviado 2 dias antes da entrada (use no modelo de check-in)." };
    modelos[t] = id;
  }
  if (c.ativo && !Object.values(modelos).some(Boolean)) return { ok: false, erro: "Escolha o modelo de ao menos uma mensagem para ligar o envio." };
  const anterior = await lerConfigMensagens(db, organizacaoId);
  const ativoDesde = c.ativo ? (anterior.ativo && anterior.ativoDesde ? anterior.ativoDesde : agora.toISOString()) : undefined;
  await db.transaction((tx) => gravarConfig(tx, organizacaoId, "mensagens_hospede", { ativo: c.ativo, ...(ativoDesde ? { ativoDesde } : {}), origens, modelos }, autorId));
  return { ok: true };
}

const somarDias = (dataISO: string, dias: number) => {
  const d = new Date(`${dataISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

export type DadosPrazo = { checkin: string; checkout: string; confirmadaEm: Date | null; fuso: string; entradaAPartirDe: string; saidaAte: string };

/**
 * Quando cada mensagem pode sair: do momento previsto até o fim do prazo (reserva feita em cima
 * da hora recebe a de check-in logo, mas não depois da entrada). `referencia`: as datas a que a
 * mensagem se refere (outra data = outra mensagem).
 */
export function prazoDaMensagem(tipo: TipoMensagemHospede, r: DadosPrazo): { inicio: Date; fim: Date; referencia: string } | null {
  const entrada = instanteLocal(r.checkin, r.entradaAPartirDe, r.fuso);
  const saida = instanteLocal(r.checkout, r.saidaAte, r.fuso);
  switch (tipo) {
    case "confirmacao":
      return r.confirmadaEm ? { inicio: r.confirmadaEm, fim: entrada, referencia: `${r.checkin}/${r.checkout}` } : null;
    case "checkin":
      return { inicio: liberacaoDasInstrucoes(r.checkin, r.fuso), fim: entrada, referencia: r.checkin };
    case "checkout":
      return { inicio: instanteLocal(somarDias(r.checkout, -1), "14:00", r.fuso), fim: saida, referencia: r.checkout };
    case "agradecimento": {
      const inicio = instanteLocal(somarDias(r.checkout, 3), "10:00", r.fuso);
      return { inicio, fim: new Date(inicio.getTime() + PRAZO_AGRADECIMENTO_MS), referencia: r.checkout };
    }
  }
}

const dataBr = (d: string) => d.split("-").reverse().join("/");

export type ResultadoMensagens = {
  enviadas: number;
  falhas: number;
  incertas: number;
  /** Mensagens no prazo que não saíram por falta de dado (e o motivo, sem dado pessoal). */
  avisos: string[];
  semProvedor: boolean;
  desligado: boolean;
};

const vazio = (): ResultadoMensagens => ({ enviadas: 0, falhas: 0, incertas: 0, avisos: [], semProvedor: false, desligado: false });

/** Envia as mensagens que estão no prazo (uma organização). */
export async function enviarMensagensHospede(db: Db, organizacaoId: string, correio: Correio | null, agora: Date): Promise<ResultadoMensagens> {
  const res = vazio();
  const cfg = await lerConfigMensagens(db, organizacaoId);
  if (!cfg.ativo || !cfg.ativoDesde) return { ...res, desligado: true };
  const ativoDesde = new Date(cfg.ativoDesde);
  const tipos = TIPOS_MENSAGEM_HOSPEDE.filter((t) => cfg.modelos[t]);
  if (!tipos.length || !cfg.origens.length) return res;
  if (!correio) return { ...res, semProvedor: true };

  const idsModelos = tipos.map((t) => cfg.modelos[t]!).filter((i) => uuidValido(i));
  const modelos = new Map(
    (idsModelos.length ? await db.select().from(modelosMensagem).where(and(eq(modelosMensagem.organizacaoId, organizacaoId), inArray(modelosMensagem.id, idsModelos))) : []).map((m) => [m.id, m]),
  );
  const hoje = hojeISO(undefined, agora);
  // Candidatas: confirmadas, das origens escolhidas, com alguma mensagem possivelmente no prazo.
  const linhas = await db
    .select({
      id: reservas.id,
      codigo: reservas.codigo,
      checkin: reservas.checkin,
      checkout: reservas.checkout,
      confirmadaEm: reservas.confirmadaEm,
      nome: reservas.hospedeNome,
      email: reservas.hospedeEmail,
      imovel: imoveis.nome,
      fuso: imoveis.fuso,
      endereco: imoveis.endereco,
      complemento: imoveisDetalhes.complemento,
      entradaAPartirDe: imoveisDetalhes.checkinAPartirDe,
      saidaAte: imoveisDetalhes.checkoutAte,
    })
    .from(reservas)
    .innerJoin(imoveis, and(eq(imoveis.id, reservas.imovelId), eq(imoveis.organizacaoId, reservas.organizacaoId)))
    .leftJoin(imoveisDetalhes, eq(imoveisDetalhes.imovelId, imoveis.id))
    .where(
      and(
        eq(reservas.organizacaoId, organizacaoId),
        eq(reservas.estado, "confirmada"),
        inArray(reservas.origem, cfg.origens),
        gte(reservas.checkout, somarDias(hoje, -10)),
        or(lte(reservas.checkin, somarDias(hoje, 3)), and(isNotNull(reservas.confirmadaEm), gte(reservas.confirmadaEm, ativoDesde))),
      ),
    );
  if (!linhas.length) return res;
  const empresa = await lerEmpresa(db, organizacaoId);

  for (const l of linhas) {
    const fuso = l.fuso || "America/Sao_Paulo";
    const prazoDados: DadosPrazo = { checkin: l.checkin, checkout: l.checkout, confirmadaEm: l.confirmadaEm, fuso, entradaAPartirDe: l.entradaAPartirDe ?? "15:00", saidaAte: l.saidaAte ?? "11:00" };
    for (const tipo of tipos) {
      const prazo = prazoDaMensagem(tipo, prazoDados);
      // Vale de quando foi ligado em diante; fora do prazo, não manda.
      if (!prazo || prazo.inicio < ativoDesde || agora < prazo.inicio || agora >= prazo.fim) continue;
      const [ja] = await db
        .select({ estado: mensagensHospede.estado, tentativas: mensagensHospede.tentativas })
        .from(mensagensHospede)
        .where(and(eq(mensagensHospede.reservaId, l.id), eq(mensagensHospede.tipo, tipo), eq(mensagensHospede.referencia, prazo.referencia)));
      if (ja && !(ja.estado === "falhou" && ja.tentativas < MAX_TENTATIVAS)) continue;

      const aviso = (motivo: string) => res.avisos.push(`${l.codigo} (${NOMES_TIPO[tipo].split(" (")[0].toLowerCase()}): ${motivo}`);
      const modelo = modelos.get(cfg.modelos[tipo]!);
      if (!modelo?.ativo) {
        aviso("o modelo escolhido não existe mais ou está arquivado");
        continue;
      }
      const para = l.email.trim().toLowerCase();
      if (!emailValido(para)) {
        aviso("reserva sem e-mail do hóspede");
        continue;
      }
      const usadas = variaveisDoTexto(modelo.texto) as Variavel[];
      const liberado = agora >= liberacaoDasInstrucoes(l.checkin, fuso);
      if (usadas.includes("endereco") && !liberado) {
        aviso("o modelo usa {endereco}, que só é enviado 2 dias antes da entrada");
        continue;
      }
      const endereco = [l.endereco.trim(), (l.complemento ?? "").trim()].filter(Boolean).join(" — ");
      const noites = Math.round((Date.parse(l.checkout) - Date.parse(l.checkin)) / 86_400_000);
      const valores: Record<Variavel, string> = {
        hospede: l.nome.trim(),
        imovel: l.imovel.trim(),
        endereco,
        checkin: dataBr(l.checkin),
        checkout: dataBr(l.checkout),
        noites: String(noites),
        codigo: l.codigo,
        empresa: empresa.nome.trim(),
      };
      const faltando = usadas.filter((v) => !valores[v]);
      if (faltando.length) {
        aviso(`falta ${faltando.map((v) => `{${v}}`).join(", ")} no cadastro`);
        continue;
      }
      const texto = preencherModelo(modelo.texto, valores);
      const assunto = `${modelo.nome} — reserva ${l.codigo}`;

      // Marca antes de chamar o provedor: outra execução ao mesmo tempo não manda de novo.
      const [marca] = await db
        .insert(mensagensHospede)
        .values({ organizacaoId, reservaId: l.id, tipo, referencia: prazo.referencia, estado: "enviando", para, modeloNome: modelo.nome, criadoEm: agora, atualizadoEm: agora })
        .onConflictDoUpdate({
          target: [mensagensHospede.reservaId, mensagensHospede.tipo, mensagensHospede.referencia],
          set: { estado: "enviando", tentativas: sql`${mensagensHospede.tentativas} + 1`, para, modeloNome: modelo.nome, erro: "", atualizadoEm: agora },
          setWhere: and(eq(mensagensHospede.estado, "falhou"), sql`${mensagensHospede.tentativas} < ${MAX_TENTATIVAS}`),
        })
        .returning({ id: mensagensHospede.id, tentativas: mensagensHospede.tentativas });
      if (!marca) continue;
      try {
        await correio.enviar({ para, assunto, texto, chave: `mensagem-hospede:${marca.id}:${marca.tentativas}` });
        await db.update(mensagensHospede).set({ estado: "enviado", enviadoEm: new Date(), atualizadoEm: new Date() }).where(eq(mensagensHospede.id, marca.id));
        res.enviadas++;
      } catch (e) {
        const incerto = e instanceof ErroEnvioIncerto;
        const erro = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        await db.update(mensagensHospede).set({ estado: incerto ? "incerto" : "falhou", erro, atualizadoEm: new Date() }).where(eq(mensagensHospede.id, marca.id));
        if (incerto) res.incertas++;
        else res.falhas++;
      }
    }
  }
  return res;
}

export function resumoMensagens(r: ResultadoMensagens): string {
  if (r.desligado) return "desligado";
  if (r.semProvedor) return "sem provedor de e-mail configurado";
  const partes = [`${r.enviadas} enviada(s)`];
  if (r.falhas) partes.push(`${r.falhas} recusada(s) pelo provedor`);
  if (r.incertas) partes.push(`${r.incertas} sem confirmação do provedor`);
  if (r.avisos.length) partes.push(`${r.avisos.length} não enviada(s): ${r.avisos.slice(0, 5).join("; ")}${r.avisos.length > 5 ? "…" : ""}`);
  return partes.join(", ");
}

export type EnvioListado = {
  id: string;
  codigo: string;
  reservaId: string;
  tipo: TipoMensagemHospede;
  estado: "enviado" | "falhou" | "incerto" | "enviando";
  tentativas: number;
  modeloNome: string;
  erro: string;
  quando: Date;
};

/** Últimos envios para a tela (o "enviando" antigo aparece como incerto). */
export async function ultimosEnvios(db: Db, organizacaoId: string, agora: Date, limite = 30): Promise<EnvioListado[]> {
  const linhas = await db
    .select({
      id: mensagensHospede.id,
      codigo: reservas.codigo,
      reservaId: mensagensHospede.reservaId,
      tipo: mensagensHospede.tipo,
      estado: mensagensHospede.estado,
      tentativas: mensagensHospede.tentativas,
      modeloNome: mensagensHospede.modeloNome,
      erro: mensagensHospede.erro,
      quando: mensagensHospede.atualizadoEm,
    })
    .from(mensagensHospede)
    .innerJoin(reservas, eq(reservas.id, mensagensHospede.reservaId))
    .where(eq(mensagensHospede.organizacaoId, organizacaoId))
    .orderBy(desc(mensagensHospede.atualizadoEm))
    .limit(limite);
  return linhas.map((l) => ({ ...l, estado: l.estado === "enviando" && agora.getTime() - l.quando.getTime() > ENVIANDO_INCERTO_MS ? "incerto" : l.estado }));
}
