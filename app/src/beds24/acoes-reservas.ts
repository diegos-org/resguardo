"use server";

/**
 * Reserva paga do site no Beds24 (M8.3a, M8.3b e M8.3c) — ações do painel. Só o ensaio escreve no Beds24 ("Criar o ensaio" e
 * "Cancelar o ensaio", M8.3c), e só no deploy de produção com a escrita de reservas pronta; a rede, fora dele, só a leitura
 * dos escopos, "Conferir o ensaio" e os botões da ficha que leem ("Conferir agora", "Vincular" e "Passar ao sistema"), e só
 * no deploy de produção. Os botões da ficha nunca escrevem no Beds24: os que reabrem o envio só enfileiram, e a rotina envia.
 * Estas ações (e a rota da rotina) são o único lugar que chama as fábricas do cliente das reservas
 * (`clienteDeReservasDoAmbiente`, `leitorDeReservasDoAmbiente`): o domínio recebe o cliente injetado, e fora da produção a
 * fábrica devolve null.
 *
 * Sempre nesta ordem: sessão (a empresa vem só dela) → permissão (deny-by-default) → validação → domínio, que confere a
 * permissão de novo.
 * - Ficha: "Simular" (`reserva:editar`) grava só uma operação simulada e volta à ficha com a chave do resultado.
 * - Ficha (M8.3b, `reserva:editar`, com `BotaoConfirmar` na tela e auditoria no domínio): "Datas fechadas nas OTAs" (D8,
 *   a marca manual da reserva paga sem criação pelo sistema e da confirmada à mão sem pagamento) e "Datas reabertas nas
 *   OTAs" (a confirmada à mão, marcada e depois cancelada pelo "Cancelar reserva" comum). Recusa volta à ficha com `?erro=`.
 * - Ficha (M8.3c, bloco G; plano 1.15): "Conferir agora", "Tentar de novo", "Deixar à mão" e "Reenviar o que está no SCL"
 *   (`reserva:editar`) e "Não existe, pode criar", "Vincular o id" e "Passar ao sistema" (também `configuracao:editar`:
 *   hoje, só o admin), com o resultado em `?beds24=` e a recusa em `?erro=`.
 * - Integrações (`configuracao:editar`, com `BotaoConfirmar` na tela e auditoria no domínio): pausar e retomar, ligar e
 *   desligar um imóvel (D6; ligar exige um ensaio conferido com a credencial atual), conferir os escopos da credencial (só
 *   leitura no Beds24; a leitura fica guardada) e o ensaio (M8.3c, D7): criar, cancelar e conferir.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AcessoNegado, exigir, podeFazer, type Sessao } from "@/acesso/politica";
import { exigirSessaoPainel } from "@/acesso/sessao-atual";
import { getDb } from "@/db/client";
import { uuidValido } from "@/lib/ids";
import { avisarErroDoServidor } from "@/observabilidade/aviso-do-servidor";
import { clienteDeReservasDoAmbiente, leitorDeReservasDoAmbiente } from "./http";
import {
  conferirAgoraNoBeds24, deixarAMaoNoBeds24, ERRO_BOTAO_INTERROMPIDO, naoExisteNoBeds24, type OpcoesDosBotoesQueLeem, passarAoSistemaBeds24, reenviarAoBeds24, relogioDoBotaoBeds24, type ResultadoDoBotao,
  tentarDeNovoNoBeds24, vincularIdDoBeds24,
} from "./reservas-site-botoes";
import {
  cancelarEnsaioReservasBeds24, conferirEnsaioReservasBeds24, criarEnsaioReservasBeds24, type DesfechoDoEnsaio, ERRO_ENSAIO_INTERROMPIDO, relogioDoEnsaio, type ResultadoDoEnsaio,
} from "./reservas-site-ensaio";
import { conferirEscoposReservasBeds24, type EscoposDaCredencial } from "./reservas-site-painel";
import { desligarImovelReservasBeds24, ligarImovelReservasBeds24, pausarReservasBeds24, type ResultadoConfigReservasBeds24, retomarReservasBeds24 } from "./reservas-site-config";
import { BOTOES_DE_CONFIGURACAO_BEDS24, type BotaoDaFichaBeds24 } from "./reservas-site-regras";
import { chaveDoResultadoDaSimulacao, simularReservaNoBeds24 } from "./reservas-site-simulacao";
import { marcarDatasFechadasNasOtas, marcarDatasReabertasNasOtas, type ResultadoMarcaOta } from "./reservas-site-tarefas";

export type EstadoReservasBeds24 = { ok?: boolean; mensagem?: string };
export type EstadoEscoposReservasBeds24 = { mensagem?: string; resultado?: EscoposDaCredencial };

const texto = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** A ficha, Integrações e o Início (a pausa e o imóvel ligado mudam o "desligada" da ficha). */
function revalidar() {
  revalidatePath("/painel", "layout");
}

/** "Simular" (ficha): monta o pedido só com o banco e grava a operação simulada; nunca usa a rede. */
export async function simularReservaBeds24Acao(form: FormData): Promise<void> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return redirect("/painel/reservas");
  const r = await simularReservaNoBeds24(getDb(), sessao, reservaId, process.env, new Date());
  revalidatePath(`/painel/reservas/${reservaId}`);
  return redirect(`/painel/reservas/${reservaId}?beds24=${chaveDoResultadoDaSimulacao(r)}`);
}

/** As duas marcas manuais da ficha: a mesma ordem; sucesso volta com `?beds24=<chave>`, recusa com `?erro=`. */
async function marcarNaFicha(form: FormData, marcar: typeof marcarDatasFechadasNasOtas, chave: string): Promise<void> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return redirect("/painel/reservas");
  const r: ResultadoMarcaOta = await marcar(getDb(), sessao, reservaId, process.env, new Date());
  revalidar();
  return redirect(r.ok ? `/painel/reservas/${reservaId}?beds24=${chave}` : `/painel/reservas/${reservaId}?erro=${encodeURIComponent(r.erro)}`);
}

/** "Datas fechadas nas OTAs" (D8): a equipe fechou à mão, como bloqueio, as datas da reserva; o sistema nunca cria por cima. */
export async function marcarDatasFechadasNasOtasAcao(form: FormData): Promise<void> {
  return marcarNaFicha(form, marcarDatasFechadasNasOtas, "ota_fechada");
}

/** "Datas reabertas nas OTAs" da confirmada à mão cancelada: a equipe mudou o bloqueio para Cancelado no Beds24. */
export async function marcarDatasReabertasNasOtasAcao(form: FormData): Promise<void> {
  return marcarNaFicha(form, marcarDatasReabertasNasOtas, "ota_reaberta");
}

// ---------------------------------------------------------------- os botões da ficha (M8.3c, bloco G; plano 1.15)

/** Os botões da ficha que leem o Beds24 (recebem o leitor das fábricas do ambiente). */
const BOTOES_QUE_LEEM: readonly BotaoDaFichaBeds24[] = ["conferir_agora", "vincular", "passar_ao_sistema"];

/**
 * Um botão da ficha, sempre nesta ordem: a sessão → `reserva:editar` e, nos de configuração, `configuracao:editar`
 * (deny-by-default, antes de ler o formulário: a operação nem chega ao domínio) → o id → o domínio, que confere tudo de novo
 * (a permissão, a credencial da organização e o deploy de produção). Os que leem o Beds24 recebem o leitor das fábricas do
 * ambiente — o cliente das reservas, ou o leitor só de leitura com a chave desligada; null fora do deploy de produção —, com o
 * prazo da operação ligado ao `fetch`. Volta à ficha com `?beds24=<resultado>` ou, na recusa, `?erro=`; a falha inesperada
 * vira o texto fixo e o aviso ao Sentry, sem a mensagem original.
 */
async function botaoDaFicha(form: FormData, b: BotaoDaFichaBeds24, f: (sessao: Sessao, reservaId: string, o: OpcoesDosBotoesQueLeem) => Promise<ResultadoDoBotao>): Promise<void> {
  const sessao = await exigirSessaoPainel();
  exigir(sessao, "reserva:editar", { organizacaoId: sessao.organizacaoId });
  if (BOTOES_DE_CONFIGURACAO_BEDS24.includes(b)) exigir(sessao, "configuracao:editar", { organizacaoId: sessao.organizacaoId });
  const reservaId = texto(form, "reservaId");
  if (!uuidValido(reservaId)) return redirect("/painel/reservas");
  let sinal: AbortSignal | null = null;
  const prazo = { prazo: () => sinal };
  let destino: string;
  try {
    const leitor = BOTOES_QUE_LEEM.includes(b) ? (clienteDeReservasDoAmbiente(process.env, prazo) ?? leitorDeReservasDoAmbiente(process.env, prazo)) : null;
    const r = await f(sessao, reservaId, { leitor, relogio: relogioDoBotaoBeds24(), prazoDaOperacao: (s) => { sinal = s; } });
    destino = r.ok ? `?beds24=${r.resultado}` : `?erro=${encodeURIComponent(r.erro)}`;
  } catch (e) {
    if (e instanceof AcessoNegado) throw e;
    await avisarErroDoServidor(e, "botao-beds24");
    destino = `?erro=${encodeURIComponent(ERRO_BOTAO_INTERROMPIDO)}`;
  }
  revalidar();
  return redirect(`/painel/reservas/${reservaId}${destino}`);
}

/** "Conferir agora" (`reserva:editar`): só lê o Beds24 (a chave desligada também, pelo leitor; só no deploy de produção). */
export async function conferirAgoraBeds24Acao(form: FormData): Promise<void> {
  return botaoDaFicha(form, "conferir_agora", (s, id, o) => conferirAgoraNoBeds24(getDb(), s, id, process.env, o));
}

/** "Tentar de novo" (`reserva:editar`): só enfileira; a rotina envia em até 10 minutos. */
export async function tentarDeNovoBeds24Acao(form: FormData): Promise<void> {
  return botaoDaFicha(form, "tentar_de_novo", (s, id, o) => tentarDeNovoNoBeds24(getDb(), s, id, process.env, { relogio: o.relogio }));
}

/** "Deixar à mão" (`reserva:editar`): o sistema para de escrever esta reserva; as tarefas à mão voltam. */
export async function deixarAMaoBeds24Acao(form: FormData): Promise<void> {
  return botaoDaFicha(form, "deixar_a_mao", (s, id, o) => deixarAMaoNoBeds24(getDb(), s, id, process.env, { relogio: o.relogio }));
}

/** "Reenviar o que está no SCL" (`reserva:editar`): a atualização na fila, com a conferência antes, pela rotina. */
export async function reenviarAoBeds24Acao(form: FormData): Promise<void> {
  return botaoDaFicha(form, "reenviar", (s, id, o) => reenviarAoBeds24(getDb(), s, id, process.env, { relogio: o.relogio }));
}

/** "Não existe, pode criar" (`reserva:editar` + `configuracao:editar`): encerra a incerteza e põe a criação na fila. */
export async function naoExisteNoBeds24Acao(form: FormData): Promise<void> {
  return botaoDaFicha(form, "nao_existe", (s, id, o) => naoExisteNoBeds24(getDb(), s, id, process.env, { relogio: o.relogio }));
}

/** "Já existe, vincular o id" (`reserva:editar` + `configuracao:editar`): o id do formulário, relido no Beds24; "sem a marca" é a segunda confirmação. */
export async function vincularIdDoBeds24Acao(form: FormData): Promise<void> {
  // O id e a confirmação são lidos só depois da permissão (dentro do botão), como o id da reserva.
  return botaoDaFicha(form, "vincular", (s, id, o) => vincularIdDoBeds24(getDb(), s, id, { beds24Id: texto(form, "beds24Id"), semMarca: texto(form, "semMarca") === "sim" }, process.env, o));
}

/** "Passar ao sistema" (`reserva:editar` + `configuracao:editar`): lê as noites no Beds24 e põe a criação na fila. */
export async function passarAoSistemaBeds24Acao(form: FormData): Promise<void> {
  return botaoDaFicha(form, "passar_ao_sistema", (s, id, o) => passarAoSistemaBeds24(getDb(), s, id, process.env, o));
}

const SEM_PERMISSAO: EstadoReservasBeds24 = { ok: false, mensagem: "Somente quem edita as configurações muda o envio das reservas do site ao Beds24." };

/** A sessão de quem edita as configurações; null = sem a permissão (nada muda). */
async function sessaoDaConfiguracao(): Promise<Sessao | null> {
  const sessao = await exigirSessaoPainel();
  return podeFazer(sessao.papel, "configuracao:editar") ? sessao : null;
}

function resposta(r: ResultadoConfigReservasBeds24, ok: string): EstadoReservasBeds24 {
  revalidar();
  return r.ok ? { ok: true, mensagem: ok } : { ok: false, mensagem: r.erro };
}

/** Pausa geral das reservas do site: vale na hora e para todo o envio delas, inclusive o cancelamento (o calendário e os preços não). */
export async function pausarReservasBeds24Acao(_anterior: EstadoReservasBeds24, _form: FormData): Promise<EstadoReservasBeds24> {
  void _anterior;
  void _form;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return SEM_PERMISSAO;
  return resposta(await pausarReservasBeds24(getDb(), sessao, new Date()), "Pausado: nenhuma reserva do site é escrita no Beds24 até você retomar. O calendário e os preços não param com esta pausa.");
}

export async function retomarReservasBeds24Acao(_anterior: EstadoReservasBeds24, _form: FormData): Promise<EstadoReservasBeds24> {
  void _anterior;
  void _form;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return SEM_PERMISSAO;
  return resposta(await retomarReservasBeds24(getDb(), sessao), "Pausa retirada. O envio continua dependendo da chave, da credencial e dos imóveis ligados.");
}

/** Liga um imóvel (D6): o domínio recusa sem um ensaio conferido com a credencial atual. */
export async function ligarImovelReservasBeds24Acao(_anterior: EstadoReservasBeds24, form: FormData): Promise<EstadoReservasBeds24> {
  void _anterior;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return SEM_PERMISSAO;
  const imovelId = texto(form, "imovelId");
  return resposta(await ligarImovelReservasBeds24(getDb(), sessao, imovelId, process.env, new Date()), "Imóvel ligado: as reservas pagas pelo site confirmadas a partir de agora vão ao Beds24.");
}

/** Desliga um imóvel: só a criação para; a atualização e o cancelamento do que o sistema já criou seguem. */
export async function desligarImovelReservasBeds24Acao(_anterior: EstadoReservasBeds24, form: FormData): Promise<EstadoReservasBeds24> {
  void _anterior;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return SEM_PERMISSAO;
  const imovelId = texto(form, "imovelId");
  return resposta(await desligarImovelReservasBeds24(getDb(), sessao, imovelId), "Imóvel desligado: nenhuma reserva nova dele vai ao Beds24; as já criadas continuam sendo atualizadas e canceladas.");
}

/** Prontidão: os escopos da credencial, só leitura no Beds24 e guardados (nas prévias e no computador, a resposta é que não lê). */
export async function conferirEscoposReservasBeds24Acao(_anterior: EstadoEscoposReservasBeds24, _form: FormData): Promise<EstadoEscoposReservasBeds24> {
  void _anterior;
  void _form;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return { mensagem: SEM_PERMISSAO.mensagem };
  const r = await conferirEscoposReservasBeds24(getDb(), sessao.organizacaoId, process.env);
  revalidar();
  return { resultado: r };
}

// ---------------------------------------------------------------- o ensaio (M8.3c, desenho 8 e D7)

/** O que cada botão do ensaio deixou, para a tela (o domínio devolve o código). `ok` = resolveu; senão, pede a ação ao lado. */
const TEXTOS_DO_ENSAIO: Record<DesfechoDoEnsaio, { ok: boolean; texto: string }> = {
  criado: { ok: true, texto: "Ensaio criado no Beds24. Confira no Beds24 e nas OTAs que as datas fecharam (cerca de 1 minuto); depois, Cancelar o ensaio." },
  sem_confirmacao: { ok: false, texto: "O Beds24 não confirmou: a reserva de teste pode estar lá. Espere 5 minutos e use Conferir o ensaio." },
  marca_nao_voltou: { ok: false, texto: "A reserva de teste foi criada, mas não voltou com a marca do ensaio: o ensaio não vale. Use Cancelar o ensaio." },
  cancelado: { ok: true, texto: "Ensaio conferido e cancelado: agora dá para ligar um imóvel. Confira nas OTAs que as datas reabriram." },
  cancelado_sem_conferencia: { ok: true, texto: "Ensaio cancelado no Beds24, mas sem a conferência completa: faça um ensaio novo antes de ligar um imóvel." },
  nada_criado: { ok: true, texto: "Conferido: nada do ensaio ficou no Beds24. Pode fazer um ensaio novo." },
  achado_vivo: { ok: false, texto: "A reserva de teste está no Beds24 e não foi cancelada: use Cancelar o ensaio (ou mude para Cancelado no Beds24, sem apagar, e confira de novo)." },
  encerrado_sem_envio: { ok: true, texto: "O ensaio tinha parado antes do envio: nada foi enviado ao Beds24, e ele foi encerrado." },
};

function respostaDoEnsaio(r: ResultadoDoEnsaio): EstadoReservasBeds24 {
  revalidar();
  if (!r.ok) return { ok: false, mensagem: r.erro };
  const t = TEXTOS_DO_ENSAIO[r.desfecho];
  return { ok: t.ok, mensagem: t.texto };
}

/**
 * Um botão do ensaio com o cliente do ambiente (null fora do deploy de produção com a escrita pronta: o domínio recusa sem
 * rede), com o prazo da fase 2 ligado ao `fetch`. A falha inesperada no meio vira o texto fixo (o ensaio aparece em
 * Integrações, e "Conferir o ensaio" resolve) e o aviso ao Sentry, sem a mensagem original.
 */
async function noEnsaio(f: (o: { relogio: ReturnType<typeof relogioDoEnsaio>; prazo: { prazo: () => AbortSignal | null }; prazoDaOperacao: (s: AbortSignal | null) => void }) => Promise<ResultadoDoEnsaio>): Promise<EstadoReservasBeds24> {
  let sinal: AbortSignal | null = null;
  try {
    return respostaDoEnsaio(await f({ relogio: relogioDoEnsaio(), prazo: { prazo: () => sinal }, prazoDaOperacao: (s) => { sinal = s; } }));
  } catch (e) {
    await avisarErroDoServidor(e, "ensaio-beds24");
    revalidar();
    return { ok: false, mensagem: ERRO_ENSAIO_INTERROMPIDO };
  }
}

/** "Criar o ensaio": o imóvel e as datas do formulário (a empresa vem só da sessão); o domínio confere tudo de novo. */
export async function criarEnsaioReservasBeds24Acao(_anterior: EstadoReservasBeds24, form: FormData): Promise<EstadoReservasBeds24> {
  void _anterior;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return SEM_PERMISSAO;
  const entrada = { imovelId: texto(form, "imovelId"), chegada: texto(form, "chegada"), saida: texto(form, "saida") };
  return noEnsaio((o) => criarEnsaioReservasBeds24(getDb(), sessao, entrada, process.env, { cliente: clienteDeReservasDoAmbiente(process.env, o.prazo), relogio: o.relogio, prazoDaOperacao: o.prazoDaOperacao }));
}

/** "Cancelar o ensaio": muda a reserva de teste para Cancelado no Beds24 (nunca apaga) e relê. */
export async function cancelarEnsaioReservasBeds24Acao(_anterior: EstadoReservasBeds24, form: FormData): Promise<EstadoReservasBeds24> {
  void _anterior;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return SEM_PERMISSAO;
  const operacaoId = texto(form, "operacaoId");
  return noEnsaio((o) => cancelarEnsaioReservasBeds24(getDb(), sessao, operacaoId, process.env, { cliente: clienteDeReservasDoAmbiente(process.env, o.prazo), relogio: o.relogio, prazoDaOperacao: o.prazoDaOperacao }));
}

/** "Conferir o ensaio": só lê (com a chave desligada, pelo leitor de reservas), e só no deploy de produção. */
export async function conferirEnsaioReservasBeds24Acao(_anterior: EstadoReservasBeds24, form: FormData): Promise<EstadoReservasBeds24> {
  void _anterior;
  const sessao = await sessaoDaConfiguracao();
  if (!sessao) return SEM_PERMISSAO;
  const operacaoId = texto(form, "operacaoId");
  return noEnsaio((o) =>
    conferirEnsaioReservasBeds24(getDb(), sessao, operacaoId, process.env, { leitor: clienteDeReservasDoAmbiente(process.env, o.prazo) ?? leitorDeReservasDoAmbiente(process.env, o.prazo), relogio: o.relogio, prazoDaOperacao: o.prazoDaOperacao }),
  );
}
