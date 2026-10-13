/**
 * E-mail do repasse ao proprietário (M4.10): depois de **pago com comprovante registrado**, sai um
 * e-mail com o valor, a data, o identificador do Pix, a lista das reservas pagas (integral ou
 * parcial) e o arquivo do comprovante anexado; representantes que recebem relatórios vão em cópia.
 * Uma vez por repasse: a tentativa é marcada antes de chamar o provedor (reivindicação atômica: duas
 * chamadas ao mesmo tempo não disparam duas) e a chave de idempotência faz o provedor ignorar uma
 * repetição. A chave do primeiro e-mail é `repasse:<id>:email`; toda tentativa seguinte que não seja a
 * retomada de uma incerta (reenvio pedido por pessoa, nova tentativa depois de uma recusa) ganha chave
 * nova, porque a anterior o provedor já consumiu ou recusou. Sem resposta certa do provedor
 * ("incerto"), a rotina repete o MESMO pedido — chave, destinatários, assunto, texto e anexo guardados
 * na tentativa (`email_pedido`), não as linhas atuais — enquanto a chave vale (23h); depois disso fica
 * "incerto" e só uma pessoa decide reenviar.
 *
 * M8.2e: nas linhas da disputa do pagamento, só o código da reserva (`itensDoRepasse` não traz o nome do hóspede nelas);
 * a parte presa por disputa sai com o motivo "reserva em conferência: disputa do pagamento".
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { type PedidoEmailRepasse, proprietarios, repasses, representantes, type SituacaoEmailRepasse } from "@/db/schema";
import type { Db } from "@/db/types";
import { type Correio, ErroEnvioIncerto } from "@/email/correio";
import { montarEmail } from "@/email/modelo";
import { formatBRL } from "@/lib/money";
import { MOTIVO_FECHAMENTO_DISPUTA, ROTULO_DISPUTA_PROPRIETARIO } from "@/pagamentos/contestacao-regras";
import { arquivoPorId, type ForaDoFechamento, foraPorDisputaDoFechamento, itensDoRepasse, JANELA_TENTATIVA_EMAIL_MS, nomeMes, obterRepasse, type RepasseListado, descricaoDoItem, separarAntecipado } from "./repasses";

export type SituacaoEnvioRepasse = "enviado" | "ja_enviado" | "nao_pago" | "por_fora" | "sem_comprovante" | "sem_email" | "sem_provedor" | "incerto" | "aguardando" | "em_andamento" | "falhou" | "nao_encontrado";

/** Tentativa marcada há menos que isto ainda pode estar em curso (ou vai ser retomada pela rotina); o estorno do repasse espera essa janela. */
const JANELA_TENTATIVA_MS = JANELA_TENTATIVA_EMAIL_MS;

/** A chave de idempotência do provedor vale 24h: dentro de 23h a mesma tentativa pode ser repetida sem duplicar. */
const JANELA_PROVEDOR_MS = 23 * 3_600_000;

const dataBr = (d: string) => d.split("-").reverse().join("/");
const comSinal = (v: number) => (v < 0 ? `− ${formatBRL(-v)}` : formatBRL(v));

export async function destinosDoRepasse(db: Db, organizacaoId: string, proprietarioId: string): Promise<string[]> {
  const [dono] = await db.select({ email: proprietarios.email }).from(proprietarios).where(and(eq(proprietarios.id, proprietarioId), eq(proprietarios.organizacaoId, organizacaoId)));
  const reps = await db.select({ email: representantes.email }).from(representantes).where(and(eq(representantes.proprietarioId, proprietarioId), eq(representantes.recebeRelatorios, true)));
  return [...new Set([(dono?.email ?? "").trim(), ...reps.map((r) => r.email.trim())].filter(Boolean))];
}

type Item = Awaited<ReturnType<typeof itensDoRepasse>>[number];

/**
 * Texto e HTML do e-mail (puros, para teste e prévia), no esqueleto da casa (M5.7, `email/modelo.ts`): saudação, o que é,
 * o destaque (valor e data do Pix), o que entrou, onde ver mais. `fora` (M8.2e): o que ficou fora do fechamento dividido
 * pelo motivo (`foraPorDisputaDoFechamento`): a parte de reserva em conferência por disputa do pagamento, com o motivo
 * próprio, e o valor segurado que esperou junto com a parte; sem ele, tudo é "dinheiro ainda não recebido".
 */
export function textoDoEmailDoRepasse(r: RepasseListado, itens: readonly Item[], empresa: string, o: { fora?: ForaDoFechamento } = {}): { assunto: string; texto: string; html: string } {
  const quando = dataBr(r.dataPagamento ?? r.data);
  const assunto = `${r.tipo === "fechamento" ? `Repasse do fechamento de ${nomeMes(r.mes.slice(0, 7))}` : `Repasse de ${dataBr(r.data)}`} — ${empresa}`;
  // A chave Pix é a usada no pagamento (guardada ao marcar pago), nunca a atual do cadastro; sem registro, não se cita.
  const frase = `Fizemos o repasse de ${formatBRL(r.valor)} em ${quando}${r.chavePixPaga ? ` para a chave Pix ${r.chavePixPaga}` : ""}.${r.comprovante ? ` Identificador do Pix: ${r.comprovante}.` : ""}${r.comprovanteArquivoId ? " O comprovante do banco vai em anexo." : ""}`;
  const valores: { rotulo: string; valor: string }[] = [];
  if (r.tipo === "fechamento") {
    valores.push({ rotulo: `Saldo de ${nomeMes(r.mes.slice(0, 7))}`, valor: formatBRL(r.saldo + r.descontado + r.contestado) });
    if (r.descontado) valores.push({ rotulo: "Adiantamentos descontados", valor: `− ${formatBRL(r.descontado)}` });
    if (r.contestado) valores.push({ rotulo: "Contestados (fora deste repasse)", valor: formatBRL(r.contestado) });
    // M8.2e (C2): o que ficou fora, pelo motivo daquele instante (`foraPorDisputaDoFechamento`): a parte presa por disputa
    // do pagamento com o motivo próprio (nunca "dinheiro ainda não recebido"), e o valor segurado que esperou junto com a
    // parte da reserva numa linha própria, com o sinal dele (o total gravado pode ser negativo).
    const f = o.fora ?? { presa: 0, seguradoJunto: 0, outras: r.foraDoFechamento };
    if (f.outras) valores.push({ rotulo: "Para o próximo repasse (dinheiro ainda não recebido pela empresa)", valor: comSinal(f.outras) });
    if (f.presa) valores.push({ rotulo: `Para o próximo repasse (${MOTIVO_FECHAMENTO_DISPUTA})`, valor: comSinal(f.presa) });
    if (f.seguradoJunto) valores.push({ rotulo: "Valor segurado pela disputa do pagamento, fora deste repasse (espera junto com a sua parte da reserva)", valor: comSinal(f.seguradoJunto) });
    // M8.2c: o "antecipado" gravado junta as noites de meses seguintes com o desconto de cancelamento de mês seguinte (a
    // parte já repassada) e o estorno da parte nunca paga (que anula a parte deste saldo): cada um na sua linha, pelos itens.
    const a = separarAntecipado(r.antecipado, itens, r.mes);
    if (a.noites) valores.push({ rotulo: "Noites de meses seguintes já pagas", valor: formatBRL(a.noites) });
    if (a.desconto) valores.push({ rotulo: "Desconto de reserva cancelada com devolução ao hóspede", valor: `− ${formatBRL(-a.desconto)}` });
    if (a.estorno) valores.push({ rotulo: "Estorno de parte de reserva cancelada antes de ser repassada (anula a parte no saldo)", valor: `− ${formatBRL(-a.estorno)}` });
    // M8.2e: as linhas da disputa do pagamento (o valor segurado e a reversão) numa linha própria.
    if (a.disputa) valores.push({ rotulo: ROTULO_DISPUTA_PROPRIETARIO, valor: a.disputa < 0 ? `− ${formatBRL(-a.disputa)}` : formatBRL(a.disputa) });
  }
  const linhaDe = (i: Item) => `${i.codigoImovel} · ${i.hospede || i.codigoReserva} · ${dataBr(i.checkin)} a ${dataBr(i.checkout)} · ${formatBRL(i.valor)} (${descricaoDoItem(i)})`;
  const reservas = itens.map(linhaDe);
  // M8.2e: as linhas da disputa (com a causa e a explicação ao proprietário) nunca ficam no "e mais N": o resto é cortado antes.
  const daDisputa = itens.filter((i) => i.disputa);
  const comuns = itens.filter((i) => !i.disputa);
  const cabem = Math.max(0, 4 - daDisputa.length);
  const restantes = comuns.length - cabem;
  const { texto, html } = montarEmail({
    empresa,
    nome: r.nome,
    frase,
    destaque: { rotulo: r.tipo === "fechamento" ? `Repasse do fechamento de ${nomeMes(r.mes.slice(0, 7))}` : "Repasse", valor: formatBRL(r.valor), nota: `Pix em ${quando}` },
    valores,
    linhas:
      reservas.length <= 5
        ? reservas
        : [...comuns.slice(0, cabem).map(linhaDe), ...daDisputa.map(linhaDe), ...(restantes > 0 ? [`e mais ${restantes} reserva(s) — a lista completa está no portal`] : [])],
    proximoPasso: `${reservas.length ? "Reservas pagas neste repasse acima. " : ""}O extrato completo está no portal do proprietário.`,
  });
  return { assunto, texto, html };
}

/**
 * Envia (ou retoma) o e-mail de um repasse. `reenviar`: pedido de uma pessoa para mandar de novo um
 * e-mail já enviado ou incerto, com chave nova.
 */
export async function enviarEmailDoRepasse(db: Db, organizacaoId: string, repasseId: string, correio: Correio | null, agora: Date, o: { reenviar?: boolean; autorId?: string | null } = {}): Promise<SituacaoEnvioRepasse> {
  const r = await obterRepasse(db, organizacaoId, repasseId);
  if (!r || r.estornadoEm) return "nao_encontrado";
  if (r.situacao !== "pago") return "nao_pago";
  // Acerto por fora (M4.11): nada foi pago pelo sistema, então não há e-mail de repasse.
  if (r.tipo === "por_fora") return "por_fora";
  if (!r.comprovante && !r.comprovanteArquivoId) return "sem_comprovante";
  if (r.emailSituacao === "enviado" && !o.reenviar) return "ja_enviado";
  // "Recente" olha a ÚLTIMA tentativa (`emailTentativaEm`), não a primeira: uma retomada que acabou de começar também conta.
  const ultima = r.emailTentativaEm ?? r.emailEm;
  const recente = r.emailSituacao === "incerto" && ultima !== null && agora.getTime() - ultima.getTime() < JANELA_TENTATIVA_MS;
  if (r.emailSituacao === "incerto" && !o.reenviar) {
    // Tentativa anterior sem resposta certa: repete dentro da janela da chave; fora dela, espera uma pessoa.
    if (r.emailEm && agora.getTime() - r.emailEm.getTime() > JANELA_PROVEDOR_MS) return "incerto";
    if (recente) return "aguardando";
  }
  // Reenvio pedido enquanto uma tentativa acabou de começar: não abre outra (seria o segundo e-mail); a rotina retoma a atual.
  if (recente && o.reenviar) return "em_andamento";
  if (!correio) return "sem_provedor";
  const base = `repasse:${r.id}:email`;
  const retomada = r.emailSituacao === "incerto" && !o.reenviar && r.emailEm !== null;
  // A retomada repete a MESMA requisição da tentativa incerta: o pedido inteiro guardado nela (destinatários,
  // assunto, texto e anexo), além da chave. Remontar qualquer parte a partir das linhas atuais (cadastro, nome
  // da empresa, itens, comprovante trocado) mudaria o pedido sob a mesma chave — o provedor poderia descartá-lo
  // como repetido enquanto aqui ficaria "enviado" com um conteúdo que nunca saiu. Só uma tentativa nova remonta.
  let pedido: PedidoEmailRepasse;
  if (retomada) {
    // Retomada só com o pedido guardado. Sem ele (tentativa anterior à coluna `email_pedido`), não há como repetir a
    // mesma requisição sob a mesma chave: fica incerto e espera uma pessoa reenviar, com chave nova.
    if (!r.emailPedido) return "incerto";
    pedido = r.emailPedido;
  } else {
    const destinos = await destinosDoRepasse(db, organizacaoId, r.proprietarioId);
    if (!destinos.length) return "sem_email";
    const [empresa, itens, fora] = await Promise.all([nomeDaEmpresa(db, organizacaoId), itensDoRepasse(db, organizacaoId, r.id), foraPorDisputaDoFechamento(db, organizacaoId, r)]);
    const { assunto, texto, html } = textoDoEmailDoRepasse(r, itens, empresa, { fora });
    pedido = { para: destinos[0], copias: destinos.slice(1), assunto, texto, html, anexoArquivoId: r.comprovanteArquivoId };
  }
  const destinos = [pedido.para, ...pedido.copias];
  // Marca a tentativa antes de chamar o provedor (quem ler vê "incerto" até a confirmação). Uma retomada
  // dentro da janela repete exatamente a chave da tentativa incerta (guardada no repasse: um reenvio
  // incerto é retomado com a chave do reenvio, não com a do primeiro e-mail, que o provedor já consumiu).
  // Qualquer outra tentativa depois da primeira (reenvio pedido por pessoa, nova tentativa depois de uma
  // recusa certa) usa chave nova: a guardada já foi consumida ou recusada pelo provedor, e repeti-la
  // seria "enviado" sem e-mail nenhum. A hora da primeira tentativa fica guardada para a janela.
  const chave = retomada ? r.emailChave || base : o.reenviar || r.emailChave ? `${base}:${agora.getTime()}` : base;
  // Reivindicação atômica: só avança quem encontrar o repasse exatamente como leu (situação do e-mail, chave e
  // carimbo da última tentativa) e ainda pago e não estornado; toda reivindicação muda o carimbo — inclusive a
  // retomada, que repete situação e chave. Assim duas chamadas ao mesmo tempo (dois cliques em "enviar de novo",
  // rotina e botão, retomada e reenvio) disparam um e-mail só, e um estorno no meio não é seguido de e-mail: quem
  // chega depois não encontra mais a linha como leu (o estorno, por sua vez, espera a tentativa em curso).
  const reivindicado = await db
    .update(repasses)
    .set({ emailSituacao: "incerto" as SituacaoEmailRepasse, emailEm: retomada ? r.emailEm : agora, emailTentativaEm: agora, emailPara: destinos.join(", "), emailChave: chave, emailPedido: pedido })
    .where(
      and(
        eq(repasses.id, r.id),
        eq(repasses.situacao, "pago"),
        isNull(repasses.estornadoEm),
        eq(repasses.emailSituacao, r.emailSituacao),
        eq(repasses.emailChave, r.emailChave),
        r.emailTentativaEm ? eq(repasses.emailTentativaEm, r.emailTentativaEm) : isNull(repasses.emailTentativaEm),
      ),
    )
    .returning({ id: repasses.id });
  if (!reivindicado.length) {
    const [agoraNoBanco] = await db.select({ estornadoEm: repasses.estornadoEm }).from(repasses).where(eq(repasses.id, r.id));
    return agoraNoBanco?.estornadoEm ? "nao_encontrado" : "em_andamento";
  }
  // O anexo é o arquivo guardado no pedido (pelo id), mesmo que o comprovante tenha sido trocado depois.
  const arquivo = pedido.anexoArquivoId ? await arquivoPorId(db, organizacaoId, pedido.anexoArquivoId) : null;
  try {
    await correio.enviar({ para: pedido.para, copias: pedido.copias, assunto: pedido.assunto, texto: pedido.texto, html: pedido.html, conteudoRestrito: true, chave, anexos: arquivo ? [{ nome: arquivo.nome, conteudo: new Uint8Array(arquivo.conteudo) }] : undefined });
  } catch (e) {
    if (e instanceof ErroEnvioIncerto) return "incerto";
    // Recusa certa: volta a pendente para a próxima tentativa (que usa chave nova: esta fica guardada), e o motivo fica no histórico.
    await db.update(repasses).set({ emailSituacao: "pendente" as SituacaoEmailRepasse }).where(eq(repasses.id, r.id));
    await registrarAuditoria(db, { organizacaoId, usuarioId: o.autorId ?? null, acao: "repasse.email_falhou", entidade: "repasse", entidadeId: r.id, mudancas: { email: [null, (e instanceof Error ? e.message : String(e)).slice(0, 200)] } });
    return "falhou";
  }
  await db.update(repasses).set({ emailSituacao: "enviado" as SituacaoEmailRepasse, emailEm: agora }).where(eq(repasses.id, r.id));
  await registrarAuditoria(db, { organizacaoId, usuarioId: o.autorId ?? null, acao: "repasse.email", entidade: "repasse", entidadeId: r.id, mudancas: { email: [null, `enviado para ${destinos.length} destino(s)${o.reenviar ? " (reenvio)" : ""}`] } });
  return "enviado";
}

export type ResultadoEmailsRepasses = { enviados: number; semComprovante: number; semEmail: number; incertos: number; falhas: number; semProvedor: boolean };

/** Todos os repasses pagos com comprovante e sem e-mail enviado (a rotina diária e o botão do painel). */
export async function enviarEmailsDeRepasses(db: Db, organizacaoId: string, correio: Correio | null, agora: Date): Promise<ResultadoEmailsRepasses> {
  const r: ResultadoEmailsRepasses = { enviados: 0, semComprovante: 0, semEmail: 0, incertos: 0, falhas: 0, semProvedor: false };
  const pendentes = await db
    .select({ id: repasses.id, comprovante: repasses.comprovante, arquivo: repasses.comprovanteArquivoId })
    .from(repasses)
    .where(and(eq(repasses.organizacaoId, organizacaoId), eq(repasses.situacao, "pago"), ne(repasses.tipo, "por_fora"), isNull(repasses.estornadoEm), ne(repasses.emailSituacao, "enviado")))
    .orderBy(repasses.dataPagamento);
  for (const p of pendentes) {
    if (!p.comprovante && !p.arquivo) {
      r.semComprovante++;
      continue;
    }
    const s = await enviarEmailDoRepasse(db, organizacaoId, p.id, correio, agora);
    if (s === "enviado") r.enviados++;
    else if (s === "sem_email") r.semEmail++;
    else if (s === "incerto" || s === "aguardando" || s === "em_andamento") r.incertos++;
    else if (s === "falhou") r.falhas++;
    else if (s === "sem_provedor") r.semProvedor = true;
  }
  return r;
}

export const NOMES_SITUACAO_EMAIL: Record<SituacaoEmailRepasse, string> = { pendente: "E-mail ainda não enviado", enviado: "E-mail enviado", incerto: "E-mail sem confirmação do provedor" };

/** Repasses pagos sem comprovante (aviso no painel): o e-mail espera. */
export async function repassesSemComprovante(db: Db, organizacaoId: string): Promise<number> {
  const [l] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(repasses)
    .where(and(eq(repasses.organizacaoId, organizacaoId), eq(repasses.situacao, "pago"), isNull(repasses.estornadoEm), eq(repasses.comprovante, ""), isNull(repasses.comprovanteArquivoId)));
  return l?.n ?? 0;
}

export const temComprovanteRegistrado = (r: { comprovante: string; comprovanteArquivoId: string | null }) => Boolean(r.comprovante || r.comprovanteArquivoId);
