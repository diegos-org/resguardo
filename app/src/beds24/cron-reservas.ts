/**
 * Reserva paga do site no Beds24 (M8.3c, desenho 9): a rotina de 10 em 10 minutos (`HORARIO_CRON_RESERVAS`, fora dos minutos
 * das outras rotinas), só no deploy de produção. Cada volta, dentro de `registrarExecucao(db, "reservas-beds24", …)`:
 * - fora do deploy de produção, nada: nem leitura, nem trava, nem linha nova (nem o registro da execução; a rota já responde
 *   403);
 * - dentro das janelas da importação e do envio diários (`dentroDeJanela`): nada, registrado como sucesso ("Nada feito:
 *   janela…"), nunca como "não rodou" (o selo de aviso duas vezes por dia);
 * - passo 0, com a escrita de reservas que não está pronta (a chave, o refresh token) ou a pausa: só resolve com leitura as
 *   operações em curso que sobraram (`resolverOperacoesEmCurso`, com o leitor injetado), e sem nada a resolver sai sem trava,
 *   sem leitura e sem linha nova (desenho 2.4);
 * - passo 1: a leitura dos escopos no COMEÇO da volta, antes de qualquer escrita, quando a guardada não é da credencial de
 *   agora ou tem 23 h (sem leitura válida, nada é escrito); a saída das operações em curso; o fim do acompanhamento
 *   (`encerrarTerminadas`);
 * - passos 2 a 4: os cancelamentos, as atualizações e as criações (`enviarReservasDoSite`, com os limites da volta: 10 POSTs,
 *   150 s por operação, as janelas antes de cada uma, a parada no 429, 401, 403 e no crédito baixo);
 * - passo 5: a conferência contínua (`conferirContinuamente`), só leitura;
 * - por fim, depois de todos os commits, o e-mail à equipe (`avisarEquipeDasReservasNoBeds24`).
 * O resumo é só de números e códigos fixos, nunca dado pessoal nem valor. "Não rodou" só para a trava ocupada ou outra escrita
 * no Beds24 em andamento. Uma falha (antes de um POST, na leitura dos escopos ou da conferência, ou a credencial recusada)
 * registra a volta como falha, com o tipo para o aviso ao Sentry. O cliente (lê, confere os escopos e grava), o leitor (só lê,
 * para o passo 0) e o correio chegam injetados e são obrigatórios (podem ser null): só a rota chama as fábricas, e o `env` de
 * um teste pode simular a produção inteira.
 */
import type { Db } from "@/db/types";
import type { Correio } from "@/email/correio";
import { ErroDeRotina, type FalhasDaRotina, somarFalhas, totalDeFalhas, umaFalha } from "@/observabilidade/erro-de-rotina";
import { type NaoRodou, naoRodou, registrarExecucao } from "@/sistema/automacoes";
import { organizacaoBeds24 } from "./configuracao";
import { ambienteDeEscritaDeReservas, escritaReservasBeds24Ligada, escritaReservasBeds24Pronta, impressaoCredencialBeds24 } from "./http";
import { avisarEquipeDasReservasNoBeds24, type ResultadoDosAvisosBeds24 } from "./reservas-site-avisos";
import { lerConfigReservasBeds24 } from "./reservas-site-config";
import { conferirContinuamente, type ResultadoDaConferenciaBeds24 } from "./reservas-site-conferencia";
import {
  type ClienteDasReservasBeds24, encerrarTerminadas, enviarReservasDoSite, haOperacaoEmCursoASair, type MotivoDaParadaBeds24, type OpcoesDoEnvio, paradaPelaRecusa, type RelogioDoEnvio,
  resolverOperacoesEmCurso, type ResultadoDaSaidaBeds24, type ResultadoDoEnvioBeds24,
} from "./reservas-site-envio";
import { dentroDeJanela } from "./reservas-site-regras";
import { gravarEscoposLidos, lerEstadoRotina, precisaLerEscopos, textoDaConfiguracaoDasReservas } from "./reservas-site-rotina";
import { ErroBeds24, type LeitorBeds24, type LeitorCredencialBeds24 } from "./tipos";
import { CAUSA_EM_ANDAMENTO } from "./trava";

/**
 * O horário da rotina (`app/vercel.json`): de 10 em 10 minutos, nos minutos 2, 12, 22…, que nenhuma outra rotina usa (as
 * cotações rodam em `*\/10`, a importação às 9:15 UTC e o envio de calendário às 10:00 UTC; desenho 9).
 */
export const HORARIO_CRON_RESERVAS = "2,12,22,32,42,52 * * * *";
/** O limite interno da volta (desenho 9): a função da Vercel tem 300 s, e a fase 3 da última operação precisa caber. */
export const LIMITE_INTERNO_DA_VOLTA_MS = 240_000;

/** O cliente da volta: lê, confere os escopos da credencial e grava reservas (um só por volta, para não renovar o token a cada operação). */
export type ClienteDaRotinaBeds24 = ClienteDasReservasBeds24 & LeitorCredencialBeds24;

export type OpcoesDaRotinaBeds24 = {
  /** `clienteDeReservasDoAmbiente` na rota; null sem a escrita de reservas pronta. */
  cliente: ClienteDaRotinaBeds24 | null;
  /** O leitor do passo 0 (a chave desligada ou a pausa): `leitorDeReservasDoAmbiente` na rota; null sem credencial. */
  leitor: LeitorBeds24 | null;
  /** `correioDoAmbiente` na rota; null = sem e-mail do sistema (o aviso fica no Início). */
  correio: Correio | null;
  /** A leitura dos escopos (GET /authentication/details); por padrão, o próprio cliente. */
  credencial?: LeitorCredencialBeds24;
  relogio?: RelogioDoEnvio;
  /** Liga o prazo de cada operação ao `fetch` do cliente (a opção `prazo` das fábricas). */
  prazoDaOperacao?: OpcoesDoEnvio["prazoDaOperacao"];
};

export const TEXTO_FORA_DA_PRODUCAO = "Fora do deploy de produção: a rotina das reservas do site no Beds24 não roda aqui (nada lido nem escrito).";

/** O motivo da parada da volta em poucas palavras (o resumo em Sistema). */
const TEXTO_DA_PARADA: Record<MotivoDaParadaBeds24, string> = {
  chave: "a escrita de reservas não está pronta neste deploy",
  trava: CAUSA_EM_ANDAMENTO.trava,
  em_andamento: "outra escrita no Beds24 em andamento (calendário ou reserva do site)",
  pausa: "o envio foi pausado em Integrações",
  janela: "começou a janela da importação ou do envio diário",
  tempo: "acabou o tempo da volta (o resto fica para a próxima)",
  limite_da_volta: "10 envios nesta volta (o resto fica para a próxima)",
  limite: "o Beds24 respondeu 429 (limite de uso)",
  sem_permissao: "o Beds24 recusou a credencial (401 ou 403)",
  credito: "o crédito do Beds24 ficou abaixo de 20",
};

const TEXTO_DA_PARADA_DA_CONFERENCIA: Record<NonNullable<ResultadoDaConferenciaBeds24["parada"]>, string> = {
  limite: "o Beds24 respondeu 429",
  sem_permissao: "o Beds24 recusou a credencial",
  falhou: "a leitura falhou",
  trava: "a trava estava ocupada",
  tempo: "sem tempo",
  janela: "a janela da importação ou do envio diário",
};

/** Os números de uma volta, para o resumo (só números e códigos). */
type Volta = {
  saida: ResultadoDaSaidaBeds24 | null;
  encerradas: number;
  envio: ResultadoDoEnvioBeds24 | null;
  conferencia: ResultadoDaConferenciaBeds24 | null;
  avisos: ResultadoDosAvisosBeds24;
  parada: MotivoDaParadaBeds24 | null;
};

/**
 * O resumo da volta em Sistema (até 500 caracteres): primeiro o que foi criado, atualizado, cancelado e conferido e os
 * avisos, o motivo da parada e o que para a escrita; depois os outros números.
 */
function resumoDaVolta(v: Volta, abertura: string): string {
  const s = v.saida;
  const e = v.envio;
  const c = v.conferencia;
  const conferidas = (s?.conferidas ?? 0) + (e?.conferidas ?? 0) + (c?.voltaram ?? 0);
  const avisos = (s?.avisos ?? 0) + (e?.avisos ?? 0) + (c?.avisos ?? 0);
  let texto = `${abertura}: ${e?.criadas ?? 0} criada(s), ${e?.atualizadas ?? 0} atualizada(s), ${e?.canceladas ?? 0} cancelada(s), ${conferidas} conferida(s), ${avisos} aviso(s).`;
  if (v.parada) texto += ` Parou: ${TEXTO_DA_PARADA[v.parada]}.`;
  if (e?.configuracao) texto += ` Escrita parada: ${textoDaConfiguracaoDasReservas(e.configuracao)}.`;
  const outros = [`${(s?.incertas ?? 0) + (e?.incertas ?? 0)} sem confirmação, ${e?.falhas ?? 0} falha(s) antes do envio, ${s?.resolvidas ?? 0} em curso resolvida(s), ${v.encerradas} encerrada(s)`];
  if (c) outros.push(`conferência contínua: ${c.conferidos} registro(s) conferido(s)${c.semConclusao ? `, ${c.semConclusao} sem conclusão` : ""}${c.parada ? ` (parou: ${TEXTO_DA_PARADA_DA_CONFERENCIA[c.parada]})` : ""}`);
  outros.push(`e-mails à equipe: ${v.avisos.enviados} enviado(s)${v.avisos.falhas ? `, ${v.avisos.falhas} falha(s) (tenta de novo na próxima volta)` : ""}`);
  return `${texto} ${outros.join("; ")}.`;
}

/** A falha que derrubou a volta, para Sistema (a mensagem segura) e o Sentry (só o tipo). */
function erroDaVolta(e: unknown): ErroDeRotina {
  if (e instanceof ErroDeRotina) return e;
  const detalhe = e instanceof ErroBeds24 ? e.message : "A volta das reservas do site no Beds24 parou no meio; roda de novo em 10 minutos.";
  return new ErroDeRotina(detalhe, umaFalha(e instanceof ErroBeds24 ? e.tipo : "rotina_interrompida"), { cause: e });
}

const tipoDaFalha = (e: unknown) => (e instanceof ErroBeds24 ? e.tipo : "erro_inesperado");

/**
 * Uma volta da rotina (desenho 9). Devolve o resumo gravado em Sistema; a falha é registrada lá e repassada (a rota responde
 * 500 e avisa o Sentry).
 */
export async function executarCronReservasBeds24(db: Db, env: NodeJS.ProcessEnv, o: OpcoesDaRotinaBeds24): Promise<string> {
  if (!ambienteDeEscritaDeReservas(env)) return TEXTO_FORA_DA_PRODUCAO;
  const inicio = Date.now();
  const relogio: RelogioDoEnvio = o.relogio ?? { agora: () => new Date(), restanteMs: () => LIMITE_INTERNO_DA_VOLTA_MS - (Date.now() - inicio) };
  return registrarExecucao(db, "reservas-beds24", async () => {
    try {
      const janela = dentroDeJanela(relogio.agora());
      if (janela) return `Nada feito: janela ${janela === "importacao" ? "da importação diária" : "do envio diário"} do Beds24.`;
      const org = await organizacaoBeds24(db, env);
      const opcoes: OpcoesDoEnvio = { env, relogio, prazoDaOperacao: o.prazoDaOperacao };
      // A escrita sai só com a trava de ambiente aberta e o cliente injetado (a fábrica devolve null sem ela).
      const cliente = escritaReservasBeds24Pronta(env) ? o.cliente : null;
      if (!cliente) {
        const motivo = !escritaReservasBeds24Ligada(env) ? "a escrita de reservas está desligada" : !escritaReservasBeds24Pronta(env) ? "falta o refresh token de escrita" : "o cliente de escrita não foi criado";
        return await soLeitura(db, org, o, opcoes, motivo);
      }
      if ((await lerConfigReservasBeds24(db, org)).pausado) return await soLeitura(db, org, o, opcoes, "o envio está pausado em Integrações");
      return await volta(db, org, cliente, o, opcoes);
    } catch (e) {
      throw erroDaVolta(e);
    }
  });
}

/**
 * O passo 0 (desenho 2.4 e 9): a escrita não está pronta ou está pausada. Só resolve com leitura o que está em curso (nunca
 * POST), e sem nada a resolver sai antes de qualquer trava, leitura ou linha nova.
 */
async function soLeitura(db: Db, org: string, o: OpcoesDaRotinaBeds24, opcoes: OpcoesDoEnvio, motivo: string): Promise<string> {
  if (!(await haOperacaoEmCursoASair(db, org))) return `Nada feito: ${motivo}, e não há envio em curso a conferir.`;
  const leitor = o.leitor ?? o.cliente;
  if (!leitor) return `Nada feito: ${motivo}; há envio em curso a conferir, mas sem credencial para ler o Beds24.`;
  const saida = await resolverOperacoesEmCurso(db, org, leitor, opcoes);
  const avisos = await avisarEquipeDasReservasNoBeds24(db, org, o.correio, opcoes.relogio.agora());
  return resumoDaVolta({ saida, encerradas: 0, envio: null, conferencia: null, avisos, parada: saida.parada }, `Só leitura (${motivo})`);
}

/** A volta com a escrita pronta: os passos 1 a 5 e o e-mail à equipe. */
async function volta(db: Db, org: string, cliente: ClienteDaRotinaBeds24, o: OpcoesDaRotinaBeds24, opcoes: OpcoesDoEnvio): Promise<string | NaoRodou> {
  const { relogio } = opcoes;
  const falhas: FalhasDaRotina = {};
  const v: Volta = { saida: null, encerradas: 0, envio: null, conferencia: null, avisos: { enviados: 0, semEnvio: 0, falhas: 0 }, parada: null };

  // Passo 1a: os escopos, antes de qualquer escrita (desenho 2.4 e 7). A recusa (429, 401, 403) para a volta inteira; a
  // falha da leitura deixa a volta só com leitura (nada é escrito: não se sabe se há escopo a mais).
  let leituraDosEscoposFalhou = false;
  const credencial = impressaoCredencialBeds24(opcoes.env);
  if (precisaLerEscopos(await lerEstadoRotina(db, org), credencial, relogio.agora())) {
    let lida: Awaited<ReturnType<LeitorCredencialBeds24["credencial"]>> | null = null;
    try {
      lida = await (o.credencial ?? cliente).credencial();
    } catch (e) {
      leituraDosEscoposFalhou = true;
      // A recusa conta uma vez, no fim (o 401 e o 403); a falha sem recusa, pelo tipo.
      v.parada = paradaPelaRecusa(e instanceof ErroBeds24 ? e.status : undefined) ?? null;
      if (!v.parada) somarFalhas(falhas, umaFalha(tipoDaFalha(e)));
    }
    if (lida) await gravarEscoposLidos(db, org, credencial, lida, relogio.agora());
  }

  // Passo 1b: a saída do que está em curso (só leitura) e o fim do acompanhamento.
  if (!v.parada) {
    v.saida = await resolverOperacoesEmCurso(db, org, cliente, opcoes);
    v.parada = v.saida.parada;
  }
  if (!v.parada) {
    if (dentroDeJanela(relogio.agora())) v.parada = "janela";
    else v.encerradas = await encerrarTerminadas(db, org, relogio.agora());
  }

  // Passos 2 a 4: cancelar, atualizar e criar.
  if (!v.parada) {
    v.envio = await enviarReservasDoSite(db, org, cliente, { ...opcoes, leituraDosEscoposFalhou });
    v.parada = v.envio.parada;
    if (v.envio.falhas) somarFalhas(falhas, { envio_incompleto: v.envio.falhas });
  }

  // Passo 5: a conferência contínua, só leitura (depois dos 10 envios também, se ainda houver tempo).
  if (!v.parada || v.parada === "limite_da_volta") {
    v.conferencia = await conferirContinuamente(db, org, cliente, opcoes);
    if (v.conferencia.parada === "limite" || v.conferencia.parada === "sem_permissao") v.parada = v.conferencia.parada;
    if (v.conferencia.falha) somarFalhas(falhas, umaFalha(v.conferencia.falha));
  }
  if (v.parada === "sem_permissao") somarFalhas(falhas, umaFalha("http"));

  // Depois de todos os commits: o e-mail à equipe das transições desta volta (e o que falhou na anterior).
  v.avisos = await avisarEquipeDasReservasNoBeds24(db, org, o.correio, relogio.agora());

  const resumo = resumoDaVolta(v, "Reservas do site no Beds24");
  if (totalDeFalhas(falhas)) throw new ErroDeRotina(resumo, falhas);
  if (v.parada === "trava" || v.parada === "em_andamento") return naoRodou(`${TEXTO_DA_PARADA[v.parada]}. ${resumo}`);
  return resumo;
}
