/**
 * E-mail do repasse ao proprietário (M4.10): depois de **pago com comprovante registrado**, sai um
 * e-mail com o valor, a data, o identificador do Pix, a lista das reservas pagas (integral ou
 * parcial) e o arquivo do comprovante anexado; representantes que recebem relatórios vão em cópia.
 * Uma vez por repasse: a tentativa é marcada antes de chamar o provedor (reivindicação atômica: duas
 * chamadas ao mesmo tempo não disparam duas) e a chave de idempotência faz o provedor ignorar uma
 * repetição. A chave do primeiro e-mail é `repasse:<id>:email`; toda tentativa seguinte que não seja a
 * retomada de uma incerta (reenvio pedido por pessoa, nova tentativa depois de uma recusa) ganha chave
 * nova, porque a anterior o provedor já consumiu ou recusou. Sem resposta certa do provedor
 * ("incerto"), a rotina repete o mesmo pedido, com a mesma chave, enquanto ela vale (23h); depois
 * disso fica "incerto" e só uma pessoa decide reenviar.
 */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { nomeDaEmpresa } from "@/configuracoes/empresa";
import { proprietarios, repasses, representantes, type SituacaoEmailRepasse } from "@/db/schema";
import type { Db } from "@/db/types";
import { type Correio, ErroEnvioIncerto } from "@/email/correio";
import { formatBRL } from "@/lib/money";
import { arquivoDoComprovante, itensDoRepasse, nomeMes, obterRepasse, type RepasseListado } from "./repasses";

export type SituacaoEnvioRepasse = "enviado" | "ja_enviado" | "nao_pago" | "sem_comprovante" | "sem_email" | "sem_provedor" | "incerto" | "aguardando" | "em_andamento" | "falhou" | "nao_encontrado";

/** Tentativa marcada há menos que isto ainda pode estar em curso (ou vai ser retomada pela rotina). */
const JANELA_TENTATIVA_MS = 15 * 60_000;

/** A chave de idempotência do provedor vale 24h: dentro de 23h a mesma tentativa pode ser repetida sem duplicar. */
const JANELA_PROVEDOR_MS = 23 * 3_600_000;

const dataBr = (d: string) => d.split("-").reverse().join("/");

export async function destinosDoRepasse(db: Db, organizacaoId: string, proprietarioId: string): Promise<string[]> {
  const [dono] = await db.select({ email: proprietarios.email }).from(proprietarios).where(and(eq(proprietarios.id, proprietarioId), eq(proprietarios.organizacaoId, organizacaoId)));
  const reps = await db.select({ email: representantes.email }).from(representantes).where(and(eq(representantes.proprietarioId, proprietarioId), eq(representantes.recebeRelatorios, true)));
  return [...new Set([(dono?.email ?? "").trim(), ...reps.map((r) => r.email.trim())].filter(Boolean))];
}

type Item = Awaited<ReturnType<typeof itensDoRepasse>>[number];

/** Texto do e-mail (puro, para teste e prévia). */
export function textoDoEmailDoRepasse(r: RepasseListado, itens: readonly Item[], empresa: string): { assunto: string; texto: string } {
  const quando = dataBr(r.dataPagamento ?? r.data);
  const assunto = `${r.tipo === "fechamento" ? `Repasse do fechamento de ${nomeMes(r.mes.slice(0, 7))}` : `Repasse de ${dataBr(r.data)}`} — ${empresa}`;
  // A chave Pix é a usada no pagamento (guardada ao marcar pago), nunca a atual do cadastro; sem registro, não se cita.
  const linhas = [`Olá, ${r.nome}.`, "", `Fizemos o repasse de ${formatBRL(r.valor)} em ${quando}${r.chavePixPaga ? ` para a chave Pix ${r.chavePixPaga}` : ""}.${r.comprovante ? ` Identificador do Pix: ${r.comprovante}.` : ""}${r.comprovanteArquivoId ? " O comprovante do banco vai em anexo." : ""}`];
  if (r.tipo === "fechamento") {
    linhas.push("", `Fechamento de ${nomeMes(r.mes.slice(0, 7))}: saldo do mês ${formatBRL(r.saldo + r.descontado + r.contestado)}${r.descontado ? `, adiantamentos descontados ${formatBRL(r.descontado)}` : ""}${r.contestado ? `, contestados fora ${formatBRL(r.contestado)}` : ""}${r.foraDoFechamento ? `, ${formatBRL(r.foraDoFechamento)} ficaram para o próximo repasse (dinheiro ainda não recebido pela empresa)` : ""}${r.antecipado ? `, ${formatBRL(r.antecipado)} de noites de meses seguintes já pagos` : ""}.`);
  }
  if (itens.length) {
    linhas.push("", "Reservas pagas neste repasse:");
    for (const i of itens) linhas.push(`- ${i.codigoImovel} · ${i.hospede || i.codigoReserva} · ${dataBr(i.checkin)} a ${dataBr(i.checkout)} · ${formatBRL(i.valor)} (${i.parcial ? `parte de ${nomeMes(i.competencia.slice(0, 7))}; o restante vem em outro repasse` : "integral"})`);
  }
  linhas.push("", "O extrato completo está no portal do proprietário. Qualquer dúvida, é só responder este e-mail.");
  return { assunto, texto: linhas.join("\n") };
}

/**
 * Envia (ou retoma) o e-mail de um repasse. `reenviar`: pedido de uma pessoa para mandar de novo um
 * e-mail já enviado ou incerto, com chave nova.
 */
export async function enviarEmailDoRepasse(db: Db, organizacaoId: string, repasseId: string, correio: Correio | null, agora: Date, o: { reenviar?: boolean; autorId?: string | null } = {}): Promise<SituacaoEnvioRepasse> {
  const r = await obterRepasse(db, organizacaoId, repasseId);
  if (!r || r.estornadoEm) return "nao_encontrado";
  if (r.situacao !== "pago") return "nao_pago";
  if (!r.comprovante && !r.comprovanteArquivoId) return "sem_comprovante";
  if (r.emailSituacao === "enviado" && !o.reenviar) return "ja_enviado";
  const recente = r.emailSituacao === "incerto" && r.emailEm !== null && agora.getTime() - r.emailEm.getTime() < JANELA_TENTATIVA_MS;
  if (r.emailSituacao === "incerto" && !o.reenviar) {
    // Tentativa anterior sem resposta certa: repete dentro da janela da chave; fora dela, espera uma pessoa.
    if (r.emailEm && agora.getTime() - r.emailEm.getTime() > JANELA_PROVEDOR_MS) return "incerto";
    if (recente) return "aguardando";
  }
  // Reenvio pedido enquanto uma tentativa acabou de começar: não abre outra (seria o segundo e-mail); a rotina retoma a atual.
  if (recente && o.reenviar) return "em_andamento";
  if (!correio) return "sem_provedor";
  const destinos = await destinosDoRepasse(db, organizacaoId, r.proprietarioId);
  if (!destinos.length) return "sem_email";
  // Marca a tentativa antes de chamar o provedor (quem ler vê "incerto" até a confirmação). Uma retomada
  // dentro da janela repete exatamente a chave da tentativa incerta (guardada no repasse: um reenvio
  // incerto é retomado com a chave do reenvio, não com a do primeiro e-mail, que o provedor já consumiu).
  // Qualquer outra tentativa depois da primeira (reenvio pedido por pessoa, nova tentativa depois de uma
  // recusa certa) usa chave nova: a guardada já foi consumida ou recusada pelo provedor, e repeti-la
  // seria "enviado" sem e-mail nenhum. A hora da primeira tentativa fica guardada para a janela.
  const base = `repasse:${r.id}:email`;
  const retomada = r.emailSituacao === "incerto" && !o.reenviar && r.emailEm !== null;
  const chave = retomada ? r.emailChave || base : o.reenviar || r.emailChave ? `${base}:${agora.getTime()}` : base;
  // Reivindicação atômica: só avança quem encontrar o repasse exatamente como leu (situação e chave). Duas
  // chamadas ao mesmo tempo (dois cliques em "enviar de novo", rotina e botão) disparam um e-mail só; a
  // retomada de uma tentativa incerta repete a mesma chave, então duas retomadas juntas também não duplicam.
  const reivindicado = await db
    .update(repasses)
    .set({ emailSituacao: "incerto" as SituacaoEmailRepasse, emailEm: retomada ? r.emailEm : agora, emailPara: destinos.join(", "), emailChave: chave })
    .where(and(eq(repasses.id, r.id), eq(repasses.emailSituacao, r.emailSituacao), eq(repasses.emailChave, r.emailChave)))
    .returning({ id: repasses.id });
  if (!reivindicado.length) return "em_andamento";
  const [empresa, itens, arquivo] = await Promise.all([nomeDaEmpresa(db, organizacaoId), itensDoRepasse(db, organizacaoId, r.id), r.comprovanteArquivoId ? arquivoDoComprovante(db, organizacaoId, r.id) : Promise.resolve(null)]);
  const { assunto, texto } = textoDoEmailDoRepasse(r, itens, empresa);
  try {
    await correio.enviar({ para: destinos[0], copias: destinos.slice(1), assunto, texto, conteudoRestrito: true, chave, anexos: arquivo ? [{ nome: arquivo.nome, conteudo: new Uint8Array(arquivo.conteudo) }] : undefined });
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
    .where(and(eq(repasses.organizacaoId, organizacaoId), eq(repasses.situacao, "pago"), isNull(repasses.estornadoEm), ne(repasses.emailSituacao, "enviado")))
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
