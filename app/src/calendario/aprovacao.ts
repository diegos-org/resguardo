/**
 * Aprovar e desfazer a importação dos preços do Beds24 (M3.11a, requisitos/product/FONTE-UNICA-PRECOS.md 3.5 e 3.6), e o
 * botão "Guardar uma cópia agora" (3.1). Cada um numa transação, na ordem única das travas (M8.3: `beds24:<org>` → imóvel
 * → reserva): espera o envio ao Beds24 (`esperarEnvioBeds24`, como a troca da fonte de preços), trava o imóvel e, com ele
 * travado, relê pela mesma régua da tela (`lerImportacao`). Nada aqui fala com o Beds24: a leitura já está no banco, e o
 * que muda é o cadastro e a camada do preço importado, que o motor lê — nada muda nas OTAs. A permissão é conferida por
 * quem chama (as ações do painel); aqui, a organização: imóvel de outra é "não encontrado".
 */
import { and, asc, count, eq, gte, max, min } from "drizzle-orm";
import { registrarAuditoria } from "@/auditoria/auditoria";
import { esperarEnvioBeds24, tentarTravaBeds24 } from "@/beds24/trava";
import { beds24CalendarioCopias, precosImportados } from "@/db/schema";
import type { Db } from "@/db/types";
import { entradaDeDetalhes, gravarDetalhesNaTransacao, imovelDaOrg, validarDetalhes } from "@/imoveis/detalhes";
import { dataBr, dataHoraNoFuso, hojeISO } from "@/lib/datas";
import { centavosParaCampo } from "@/lib/dinheiro-form";
import { uuidValido } from "@/lib/ids";
import { contarCopias, copiarLeitura, guardarCopia } from "./copias";
import { escolherUsar, lerImportacao, type RevisaoImportacao } from "./importacao";

export type ResultadoImportacao = { ok: true; mensagem: string } | { ok: false; erro: string };
/** O que a revisão mandou aprovar: a assinatura da leitura revisada e as caixas "Usar como…" marcadas na tela. */
export type PedidoAprovacao = { assinatura: string; usar: RevisaoImportacao["usar"] };

export const MENSAGEM_LEITURA_MUDOU = "A leitura mudou desde que você abriu a revisão. Confira de novo.";
export const MENSAGEM_NADA_A_DESFAZER = "Nada importado de hoje em diante.";
const NAO_ENCONTRADO: ResultadoImportacao = { ok: false, erro: "Imóvel não encontrado." };
const SEM_ENVIO_AO_BEDS24 = "Nada foi enviado ao Beds24.";

type Camada = { noites: number; inicio: string; fim: string };
/** A camada importada do imóvel de `desde` em diante, em noites e intervalo (a auditoria guarda isto, nunca as noites). */
async function camadaDesde(tx: Db, org: string, imovelId: string, desde: string): Promise<Camada | null> {
  const p = precosImportados;
  const [r] = await tx.select({ noites: count(), inicio: min(p.data), fim: max(p.data) }).from(p).where(and(eq(p.organizacaoId, org), eq(p.imovelId, imovelId), gte(p.data, desde)));
  return r.noites && r.inicio && r.fim ? { noites: r.noites, inicio: r.inicio, fim: r.fim } : null;
}
/** Datas AAAA-MM-DD: o histórico mostra em dd/mm/aaaa. */
const descrever = (c: Camada | null) => (c ? `${c.noites} noite(s), de ${c.inicio} a ${c.fim}` : null);
const resumo = (c: Camada) => `${c.noites} noite(s), de ${dataBr(c.inicio)} a ${dataBr(c.fim)}`;
const ROTULO_CAMADA = "preços importados do Beds24";

/**
 * Aprova a importação (3.5). Com o imóvel travado: a fonte, o vínculo e a leitura (pelos bloqueios da tela, a mesma regra),
 * a assinatura da leitura revisada, e então, numa transação só, o cadastro (preço base e estadia máxima marcados, pelo
 * caminho e com a validação do cadastro: recusa dele recusa tudo), a cópia da leitura usada (motivo `importacao`), a camada
 * de hoje em diante (as noites de antes ficam: a mudança vale daquela data para frente) e a auditoria. Repetir com a mesma
 * leitura não muda nada: a cópia é a mesma (assinatura igual), e a camada igual não é regravada nem auditada.
 */
export async function aprovarImportacao(db: Db, org: string, imovelId: string, pedido: PedidoAprovacao, autorId: string | null, agora = new Date()): Promise<ResultadoImportacao> {
  if (!uuidValido(imovelId)) return NAO_ENCONTRADO;
  return db.transaction(async (tx): Promise<ResultadoImportacao> => {
    const espera = await esperarEnvioBeds24(tx, org, agora);
    if (espera) return { ok: false, erro: espera };
    if (!(await imovelDaOrg(tx, org, imovelId, true))) return NAO_ENCONTRADO;
    const l = await lerImportacao(tx, org, imovelId, agora);
    if (!l) return NAO_ENCONTRADO;
    if (l.bloqueios.length) return { ok: false, erro: l.bloqueios.map((b) => b.texto).join(" ") };
    const { proposta, hoje } = l;
    if (proposta.assinatura !== pedido.assinatura) return { ok: false, erro: MENSAGEM_LEITURA_MUDOU };
    if (!proposta.importar.length || !l.lidaEm) return { ok: false, erro: "Nenhuma noite com preço no Beds24: nada a importar." };

    // Cadastro primeiro: a recusa da validação volta antes de qualquer gravação.
    const usar = escolherUsar(proposta, l.cadastro, pedido.usar);
    if (usar.precoBase || usar.estadiaMaxima) {
      const r = await gravarDetalhesNaTransacao(tx, org, imovelId, (atual) => {
        const entrada = entradaDeDetalhes(atual);
        if (usar.precoBase) entrada.precoBase = centavosParaCampo(proposta.precoBase);
        if (usar.estadiaMaxima) entrada.estadiaMaxima = String(proposta.estadiaMaxima);
        const v = validarDetalhes(entrada);
        return v.ok ? v.dados : { erro: `O cadastro do imóvel recusou: ${Object.values(v.erros).join(" ")} Confira a ficha do imóvel e volte aqui.`, erros: v.erros };
      }, autorId);
      if (!r.ok) return { ok: false, erro: r.erro };
    }
    const noCadastro = [usar.precoBase && proposta.precoBase !== l.cadastro.precoBase ? "preço base" : null, usar.estadiaMaxima && proposta.estadiaMaxima !== l.cadastro.estadiaMaxima ? "estadia máxima" : null].filter(Boolean);
    const textoCadastro = noCadastro.length ? ` No cadastro: ${noCadastro.join(" e ")}.` : "";

    const copiaId = await guardarCopia(tx, org, imovelId, { roomId: proposta.roomId, noites: proposta.leitura, lidoEm: l.lidaEm }, "importacao", autorId);
    if (!copiaId) throw new Error("A cópia da leitura usada não foi guardada.");
    const p = precosImportados;
    const deHoje = and(eq(p.organizacaoId, org), eq(p.imovelId, imovelId), gte(p.data, hoje));
    const atuais = await tx.select({ data: p.data, preco: p.preco, minimo: p.minimoNoites, copiaId: p.copiaId }).from(p).where(deHoje).orderBy(asc(p.data));
    const igual = atuais.length === proposta.importar.length && atuais.every((a, i) => {
      const n = proposta.importar[i];
      return a.data === n.data && a.preco === n.preco && a.minimo === n.minimo && a.copiaId === copiaId;
    });
    const depois: Camada = { noites: proposta.importar.length, inicio: proposta.importar[0].data, fim: proposta.importar.at(-1)!.data };
    if (igual) return { ok: true, mensagem: textoCadastro ? `Os preços importados já eram estes (${resumo(depois)}).${textoCadastro}` : `Nada mudou: o SCL já tem estes preços importados (${resumo(depois)}).` };

    const antes: Camada | null = atuais.length ? { noites: atuais.length, inicio: atuais[0].data, fim: atuais.at(-1)!.data } : null;
    await tx.delete(p).where(deHoje);
    await tx.insert(p).values(proposta.importar.map((n) => ({ organizacaoId: org, imovelId, data: n.data, preco: n.preco, minimoNoites: n.minimo, copiaId, autorId, criadoEm: agora })));
    await registrarAuditoria(tx, {
      organizacaoId: org, usuarioId: autorId, acao: "imovel.precos.importar", entidade: "imovel", entidadeId: imovelId,
      mudancas: { [ROTULO_CAMADA]: [descrever(antes), descrever(depois)], "cópia da leitura": [null, copiaId] },
    });
    return { ok: true, mensagem: `Preços importados: ${resumo(depois)}.${textoCadastro} ${SEM_ENVIO_AO_BEDS24}` };
  });
}

/**
 * Desfaz a importação (3.6): apaga a camada do imóvel de hoje em diante (as noites de antes ficam), mantém as cópias e
 * audita. O imóvel volta ao preço base e às regras. Mesmas travas da aprovação.
 */
export async function desfazerImportacao(db: Db, org: string, imovelId: string, autorId: string | null, agora = new Date()): Promise<ResultadoImportacao> {
  if (!uuidValido(imovelId)) return NAO_ENCONTRADO;
  return db.transaction(async (tx): Promise<ResultadoImportacao> => {
    const espera = await esperarEnvioBeds24(tx, org, agora);
    if (espera) return { ok: false, erro: espera };
    const imovel = await imovelDaOrg(tx, org, imovelId, true);
    if (!imovel) return NAO_ENCONTRADO;
    const hoje = hojeISO(imovel.fuso, agora);
    const antes = await camadaDesde(tx, org, imovelId, hoje);
    if (!antes) return { ok: false, erro: MENSAGEM_NADA_A_DESFAZER };
    const p = precosImportados;
    await tx.delete(p).where(and(eq(p.organizacaoId, org), eq(p.imovelId, imovelId), gte(p.data, hoje)));
    await registrarAuditoria(tx, { organizacaoId: org, usuarioId: autorId, acao: "imovel.precos.desfazer_importacao", entidade: "imovel", entidadeId: imovelId, mudancas: { [ROTULO_CAMADA]: [descrever(antes), null] } });
    return { ok: true, mensagem: `Importação desfeita: ${resumo(antes)} voltam ao preço base e às regras. ${SEM_ENVIO_AO_BEDS24}` };
  });
}

/**
 * "Guardar uma cópia agora" (3.1): copia a leitura atual do imóvel (motivo `manual`). Pega a trava da importação do
 * Beds24 sem esperar, como ela (`tentarTravaBeds24`): a cópia nunca se mistura com uma importação trocando a leitura.
 * Leitura igual à última cópia: nada novo, e a mensagem diz a data dela.
 */
export async function guardarCopiaAgora(db: Db, org: string, imovelId: string, autorId: string | null): Promise<ResultadoImportacao> {
  if (!uuidValido(imovelId)) return NAO_ENCONTRADO;
  return db.transaction(async (tx): Promise<ResultadoImportacao> => {
    if (!(await tentarTravaBeds24(tx, org))) return { ok: false, erro: "Há uma importação ou um envio do Beds24 em andamento. Aguarde e tente de novo." };
    const imovel = await imovelDaOrg(tx, org, imovelId);
    if (!imovel) return NAO_ENCONTRADO;
    const antes = await contarCopias(tx, org, imovelId);
    const id = await copiarLeitura(tx, org, imovelId, "manual", { autorId });
    if (!id) return { ok: false, erro: "Não há leitura do Beds24 deste imóvel para copiar." };
    if ((await contarCopias(tx, org, imovelId)) > antes) return { ok: true, mensagem: "Cópia guardada." };
    const [ultima] = await tx.select({ criadoEm: beds24CalendarioCopias.criadoEm }).from(beds24CalendarioCopias).where(eq(beds24CalendarioCopias.id, id));
    return { ok: true, mensagem: `Nada mudou desde a última cópia, de ${dataHoraNoFuso(ultima.criadoEm, imovel.fuso)}: nenhuma cópia nova.` };
  });
}
