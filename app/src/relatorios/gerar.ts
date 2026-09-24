/**
 * Quem pode gerar qual relatório (M5.3), sempre decidido no servidor:
 * - portal: o proprietário, só dos imóveis dele e dentro da janela do portal, sem anexos;
 * - painel: quem vê proprietários e financeiro (admin), de um proprietário, com foto e extrato
 *   anexados na hora (não ficam guardados). Cada geração no painel fica no histórico do proprietário.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { podeFazer, type Sessao } from "@/acesso/politica";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { hojeISO } from "@/lib/datas";
import { periodoDosFiltros } from "@/lib/filtros";
import { lerPeriodoPortal } from "@/portal/periodo";
import { proprietariosDoUsuario } from "@/portal/resumo";
import { type Anexos, ErroRelatorio, gerarPdfRelatorio } from "./pdf";
import { dadosDoRelatorio, donoDoRelatorio, HISTORICO_TODO, imoveisDoProprietario, textosDoRelatorio } from "./relatorio";

export type Resultado = { ok: true; pdf: Uint8Array; arquivo: string } | { ok: false; status: number; erro: string };

type Params = Record<string, string | string[] | undefined>;

const nomeArquivo = (ano: number, mes: number, imoveis: { codigo: string }[]) =>
  `relatorio-${ano}-${String(mes).padStart(2, "0")}-${imoveis.map((i) => i.codigo.replace(/[^\w-]/g, "")).join("-") || "imoveis"}.pdf`;

/** PDF do mês escolhido no portal, só com o que é do proprietário logado. */
export async function relatorioDoPortal(db: Db, sessao: Sessao | null, params: Params, agora: Date = new Date()): Promise<Resultado> {
  if (!sessao || sessao.papel !== "proprietario") return { ok: false, status: 403, erro: "Acesso negado." };
  if (!sessao.imovelIds.length) return { ok: false, status: 404, erro: "Nenhum imóvel ligado ao seu cadastro." };
  const [meus, donos] = await Promise.all([
    db
      .select({ id: imoveis.id, codigo: imoveis.codigo, nome: imoveis.nome })
      .from(imoveis)
      .where(and(eq(imoveis.organizacaoId, sessao.organizacaoId), inArray(imoveis.id, [...sessao.imovelIds])))
      .orderBy(asc(imoveis.codigo)),
    proprietariosDoUsuario(db, sessao.organizacaoId, sessao.usuarioId),
  ]);
  if (!meus.length || !donos.length) return { ok: false, status: 404, erro: "Nenhum imóvel ligado ao seu cadastro." };
  const { filtros, aviso } = lerPeriodoPortal(params, meus, agora);
  if (aviso) return { ok: false, status: 400, erro: aviso };
  if (filtros.mes === null) return { ok: false, status: 400, erro: "O relatório em PDF é de um mês: escolha o mês." };
  const escolhidos = filtros.imoveis.length ? meus.filter((i) => filtros.imoveis.includes(i.codigo)) : meus;
  const dados = await dadosDoRelatorio(db, sessao.organizacaoId, {
    donos,
    imoveis: escolhidos,
    todosOsImoveis: escolhidos.length === meus.length,
    ano: filtros.ano,
    mes: filtros.mes,
    hoje: hojeISO("America/Sao_Paulo", agora),
  });
  return { ok: true, pdf: await gerarPdfRelatorio(textosDoRelatorio(dados), {}, agora), arquivo: nomeArquivo(filtros.ano, filtros.mes, escolhidos) };
}

export type PedidoPainel = {
  /** "AAAA-MM". */
  mes: string;
  /** Códigos dos imóveis escolhidos; vazio = todos os do proprietário. */
  imoveis: string[];
  anexos: Anexos;
};

/** PDF gerado no painel para um proprietário, com foto e extrato opcionais. */
export async function relatorioDoPainel(db: Db, sessao: Sessao | null, proprietarioId: string, pedido: PedidoPainel, agora: Date = new Date()): Promise<Resultado> {
  if (!sessao || !podeFazer(sessao.papel, "proprietario:ler") || !podeFazer(sessao.papel, "financeiro:ler")) return { ok: false, status: 403, erro: "Acesso negado." };
  const dono = await donoDoRelatorio(db, sessao.organizacaoId, proprietarioId);
  if (!dono) return { ok: false, status: 404, erro: "Proprietário não encontrado." };
  const m = /^(\d{4})-(\d{2})$/.exec(pedido.mes);
  const ano = m ? Number(m[1]) : NaN;
  const mes = m ? Number(m[2]) : NaN;
  if (!m || ano < 2000 || ano > 2100 || mes < 1 || mes > 12) return { ok: false, status: 400, erro: "Escolha o mês do relatório." };
  // Do mês: os ligados hoje e os que têm lançamento dele no mês (imóvel que já passou para outro dono).
  const doMes = await imoveisDoProprietario(db, sessao.organizacaoId, dono.id, periodoDosFiltros({ imoveis: [], ano, mes }));
  if (!doMes.length) return { ok: false, status: 400, erro: "Este proprietário não tem imóvel ligado nem lançamentos neste mês." };
  // A tela lista todos os que já foram dele; o que não é dele em nenhum momento é recusado.
  const historico = pedido.imoveis.length ? await imoveisDoProprietario(db, sessao.organizacaoId, dono.id, HISTORICO_TODO) : doMes;
  const desconhecidos = pedido.imoveis.filter((c) => !historico.some((i) => i.codigo === c));
  if (desconhecidos.length) return { ok: false, status: 400, erro: `Imóvel que não é deste proprietário: ${desconhecidos.join(", ")}.` };
  const escolhidos = pedido.imoveis.length ? doMes.filter((i) => pedido.imoveis.includes(i.codigo)) : doMes;
  if (!escolhidos.length) return { ok: false, status: 400, erro: "Nenhum dos imóveis escolhidos era deste proprietário neste mês." };
  const dados = await dadosDoRelatorio(db, sessao.organizacaoId, {
    donos: [dono],
    imoveis: escolhidos,
    todosOsImoveis: escolhidos.length === doMes.length,
    ano,
    mes,
    hoje: hojeISO("America/Sao_Paulo", agora),
  });
  let pdf: Uint8Array;
  try {
    pdf = await gerarPdfRelatorio(textosDoRelatorio(dados), pedido.anexos, agora);
  } catch (e) {
    if (e instanceof ErroRelatorio) return { ok: false, status: 400, erro: e.message };
    throw e;
  }
  // Histórico: o que foi gerado (mês, imóveis, se levou foto/extrato), nunca o conteúdo.
  await registrarAuditoria(db, {
    organizacaoId: sessao.organizacaoId,
    usuarioId: sessao.usuarioId,
    acao: "relatorio.pdf",
    entidade: "proprietario",
    entidadeId: dono.id,
    mudancas: {
      relatorio: [null, `${pedido.mes} · ${escolhidos.map((i) => i.codigo).join(", ")}`],
      anexos: [null, [pedido.anexos.foto ? "foto" : null, pedido.anexos.extrato ? "extrato" : null].filter(Boolean).join(" e ") || "nenhum"],
    },
  });
  return { ok: true, pdf, arquivo: nomeArquivo(ano, mes, escolhidos) };
}
