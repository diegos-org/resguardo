/**
 * "Como funciona" para o proprietário (M5.6, pedido de Diego em 4/10/2026): documento de consulta no portal, com o
 * texto editável no painel (Configurações → Como funciona), **versão datada** a cada mudança e **aceite registrado**
 * por proprietário — quem, quando e qual versão (`portal/aceites.ts`). Nada é publicado até alguém salvar a primeira
 * versão: o painel oferece um rascunho como ponto de partida, e o portal só pede aceite de versão publicada.
 * O que é dado do proprietário (contrato, comissão, periodicidade escolhida) não fica no texto: o portal lê do
 * cadastro e mostra junto, no quadro "Seus dados" — uma regra, um lugar. No texto, `{empresa}` vira o nome da empresa.
 */
import { registrarAuditoria } from "@/auditoria/auditoria";
import type { Db } from "@/db/types";
import { dataValida } from "@/reservas/regras";
import { gravarConfig, lerConfig, travarConfig } from "./armazem";

export const DOCUMENTO_COMO_FUNCIONA = "como_funciona";

export const SECOES_COMO_FUNCIONA = [
  { chave: "oQueFazemos", titulo: "O que a empresa faz por você", dica: "Gestão total: anúncios, preços, atendimento ao hóspede, limpeza, manutenção, recebimento e repasse.", limite: 3000 },
  { chave: "marketplace", titulo: "Se o seu contrato é marketplace", dica: "O que muda no marketplace: o proprietário cuida do imóvel e dos preços pelo portal; a empresa vende pelo site e repassa.", limite: 3000 },
  { chave: "comissaoETaxas", titulo: "Comissão e taxas", dica: "Como a comissão é calculada e o que sai antes da divisão. O percentual do contrato de cada imóvel aparece junto, automaticamente — não escreva o número aqui.", limite: 3000 },
  { chave: "quandoRecebe", titulo: "Quando e como você recebe", dica: "Quando a parte de uma reserva fica disponível e como o repasse é feito. A periodicidade escolhida pelo proprietário aparece junto, automaticamente.", limite: 3000 },
  { chave: "relatorios", titulo: "Relatórios e extrato", dica: "O que o proprietário recebe por e-mail e vê no portal.", limite: 3000 },
  { chave: "cancelamentos", titulo: "Cancelamentos", dica: "O que acontece com a reserva e com a parte do proprietário quando o hóspede cancela.", limite: 3000 },
  { chave: "contestacoes", titulo: "Contestações de pagamento", dica: "Quem arca com uma contestação de cartão perdida — decisão ainda pendente (seção 7 do guia). Vazio = a seção não aparece no portal.", limite: 3000 },
  { chave: "duvidas", titulo: "Dúvidas", dica: "Como falar com a empresa.", limite: 1000 },
] as const;
export type ChaveSecao = (typeof SECOES_COMO_FUNCIONA)[number]["chave"];
export type SecoesComoFunciona = Record<ChaveSecao, string>;
export type VersaoComoFunciona = { numero: number; data: string; autorId: string | null; secoes: SecoesComoFunciona };

/** Ponto de partida oferecido no painel enquanto não há versão publicada. Diego revisa e salva: só então vale. */
export const RASCUNHO_COMO_FUNCIONA: SecoesComoFunciona = {
  oQueFazemos:
    "A {empresa} cuida do seu imóvel para aluguel por temporada: anuncia nos canais (Airbnb, Booking e o site próprio), define os preços e as regras de venda, atende o hóspede antes, durante e depois da estadia, organiza a limpeza e a manutenção, recebe o dinheiro das reservas quando o canal paga a empresa e repassa a sua parte.\n\nVocê acompanha tudo pelo portal: reservas, calendário, números do mês, extrato e repasses. Também pode bloquear datas para uso próprio pelo portal, dentro do que o seu contrato permite.",
  marketplace:
    "No contrato marketplace você continua no comando do imóvel: define os preços e as regras de venda pelo portal, cuida da limpeza e da manutenção (e registra isso no portal) e mantém os seus próprios anúncios nas plataformas. A {empresa} vende o seu imóvel pelo site dela, com um desconto único para o hóspede, recebe o pagamento e repassa a sua parte pela regra do marketplace. Sobre as reservas que você mesmo vende nas plataformas, a {empresa} não cobra nada.",
  comissaoETaxas:
    "A comissão da {empresa} é um percentual fixado no seu contrato (ele aparece no quadro \"Seus dados\", abaixo). Ela é calculada sobre o valor líquido da reserva: o que o hóspede pagou menos a taxa do canal (Airbnb, Booking) ou a taxa do meio de pagamento (no site). Essa taxa sai antes da divisão, então cada um arca com ela na sua proporção.\n\nEm estadias que atravessam dois meses, o valor da reserva (com a limpeza) é dividido igualmente por noite, e cada mês fica com as suas noites.",
  quandoRecebe:
    "A sua parte em cada reserva fica disponível para repasse depois do check-in e quando o dinheiro já está com a {empresa}. No Airbnb, o canal paga a sua parte direto a você: ela não passa pela {empresa} e não entra em repasse. No Booking e nas reservas diretas, a {empresa} recebe e repassa. Nas reservas do site, o dinheiro fica disponível quando o provedor de pagamento o libera.\n\nO repasse é feito por Pix para a chave do seu cadastro, na periodicidade que você escolher no portal: mensal, quinzenal, semanal ou assim que disponível (a sua escolha atual aparece no quadro \"Seus dados\"). Despesas que a {empresa} pagou por você e adiantamentos combinados são descontados no repasse, sempre com o detalhe no extrato. Cada repasse pago gera um e-mail com o comprovante.",
  relatorios:
    "Todo mês você recebe por e-mail o relatório do mês anterior, com as reservas, os números, a sua parte e o acerto, e pode baixar o PDF no portal a qualquer momento. O extrato do portal mostra a sua parte em cada reserva (a liberar, disponível ou já repassada), os repasses feitos e o que ainda está em conferência.",
  cancelamentos:
    "Quando o hóspede cancela, vale a política do canal em que a reserva foi feita (Airbnb, Booking ou o site). Se o canal pagar alguma coisa pela reserva cancelada, esse valor entra na divisão como uma reserva normal; se não pagar nada, não há nada a dividir. O calendário é liberado para novas reservas na hora.",
  contestacoes: "",
  duvidas: "Qualquer dúvida sobre uma reserva, um valor ou um repasse: fale com a {empresa} pelo WhatsApp ou pelo e-mail de sempre. Se algo no extrato não bater, avise — o item fica em conferência até a resposta.",
};

const texto = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");

/** Seções a partir de um valor qualquer (JSON gravado): o que faltar vira vazio. */
export function normalizarSecoes(v: unknown): SecoesComoFunciona {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return Object.fromEntries(SECOES_COMO_FUNCIONA.map((s) => [s.chave, texto(o[s.chave]).slice(0, s.limite)])) as SecoesComoFunciona;
}

/** Versões gravadas, da mais antiga para a mais nova; entradas inválidas são ignoradas. */
export function versoesComoFuncionaDe(v: Record<string, unknown> | null): VersaoComoFunciona[] {
  const lista = Array.isArray(v?.versoes) ? (v!.versoes as unknown[]) : [];
  return lista
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((x) => ({
      numero: typeof x.numero === "number" && Number.isInteger(x.numero) && x.numero > 0 ? x.numero : 0,
      data: typeof x.data === "string" && dataValida(x.data) ? x.data : "",
      autorId: typeof x.autorId === "string" ? x.autorId : null,
      secoes: normalizarSecoes(x.secoes),
    }))
    .filter((x) => x.numero > 0 && x.data)
    .sort((a, b) => a.numero - b.numero);
}

export const versaoAtual = (versoes: readonly VersaoComoFunciona[]): VersaoComoFunciona | null => versoes.at(-1) ?? null;

export const secoesIguais = (a: SecoesComoFunciona, b: SecoesComoFunciona): boolean => SECOES_COMO_FUNCIONA.every((s) => a[s.chave] === b[s.chave]);

/** Lê o formulário do painel: cada seção dentro do limite e pelo menos uma escrita. */
export function validarSecoes(bruto: Record<string, unknown>): { ok: true; secoes: SecoesComoFunciona } | { ok: false; erros: Partial<Record<ChaveSecao, string>>; mensagem: string } {
  const secoes = {} as SecoesComoFunciona;
  const erros: Partial<Record<ChaveSecao, string>> = {};
  for (const s of SECOES_COMO_FUNCIONA) {
    const v = texto(bruto[s.chave]);
    if (v.length > s.limite) erros[s.chave] = `Máximo de ${s.limite} caracteres.`;
    secoes[s.chave] = v;
  }
  if (Object.keys(erros).length) return { ok: false, erros, mensagem: "Confira os campos destacados." };
  if (!SECOES_COMO_FUNCIONA.some((s) => secoes[s.chave])) return { ok: false, erros, mensagem: "Escreva pelo menos uma seção antes de publicar." };
  return { ok: true, secoes };
}

export async function lerComoFunciona(db: Db, organizacaoId: string): Promise<VersaoComoFunciona[]> {
  return versoesComoFuncionaDe(await lerConfig(db, organizacaoId, "como_funciona"));
}

export type ResultadoPublicacao = { ok: true; mudou: boolean; versao: VersaoComoFunciona } | { ok: false; erro: string; atual: VersaoComoFunciona | null };

/**
 * Publica uma versão nova (número seguinte, datada de hoje) quando algum texto mudou; texto igual não cria versão.
 * Cada versão nova pede aceite novo de todos os proprietários (o portal compara o número aceito com o atual).
 * `versaoBase`: a versão que o formulário mostrava (0 = nenhuma); se outra pessoa publicou no meio, a publicação é
 * recusada em vez de passar por cima do texto dela (quem edita recarrega, confere e publica de novo).
 */
export async function publicarComoFunciona(db: Db, organizacaoId: string, secoes: SecoesComoFunciona, autorId: string | null, hoje: string, versaoBase?: number): Promise<ResultadoPublicacao> {
  if (!dataValida(hoje)) throw new Error("Data inválida.");
  return db.transaction(async (tx) => {
    await travarConfig(tx, organizacaoId, "como_funciona");
    const versoes = await lerComoFunciona(tx, organizacaoId);
    const atual = versaoAtual(versoes);
    if (versaoBase !== undefined && (atual?.numero ?? 0) !== versaoBase) {
      return { ok: false as const, erro: `Enquanto você editava, a versão ${atual?.numero ?? 0} foi publicada por outra pessoa${atual ? ` em ${atual.data.split("-").reverse().join("/")}` : ""}. Recarregue a página, confira o texto atual e publique de novo.`, atual };
    }
    if (atual && secoesIguais(atual.secoes, secoes)) return { ok: true as const, mudou: false, versao: atual };
    const nova: VersaoComoFunciona = { numero: (atual?.numero ?? 0) + 1, data: hoje, autorId, secoes: { ...secoes } };
    await gravarConfig(tx, organizacaoId, "como_funciona", { versoes: [...versoes, nova] }, autorId, false);
    const mudancas: Record<string, [unknown, unknown]> = { versao: [atual?.numero ?? null, nova.numero] };
    for (const s of SECOES_COMO_FUNCIONA) if ((atual?.secoes[s.chave] ?? "") !== secoes[s.chave]) mudancas[`secao.${s.chave}`] = [atual?.secoes[s.chave] ?? null, secoes[s.chave]];
    await registrarAuditoria(tx, { organizacaoId, usuarioId: autorId, acao: "configuracao.como_funciona", entidade: "configuracao", entidadeId: organizacaoId, mudancas });
    return { ok: true as const, mudou: true, versao: nova };
  });
}

/** `{empresa}` no texto vira o nome da empresa. */
export const preencherEmpresa = (texto: string, empresa: string): string => texto.replaceAll("{empresa}", empresa.trim() || "empresa");

/** Parágrafos de uma seção: blocos separados por linha em branco. */
export const paragrafos = (texto: string): string[] =>
  texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/** Seções com texto, na ordem oficial, já com o nome da empresa. */
export function secoesParaMostrar(v: VersaoComoFunciona, empresa: string): { chave: ChaveSecao; titulo: string; paragrafos: string[] }[] {
  return SECOES_COMO_FUNCIONA.filter((s) => v.secoes[s.chave]).map((s) => ({ chave: s.chave, titulo: s.titulo, paragrafos: paragrafos(preencherEmpresa(v.secoes[s.chave], empresa)) }));
}
