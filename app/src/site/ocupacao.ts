/**
 * Noites ocupadas para o calendário do site (M7.6). Só o que é certo: reserva ou bloqueio no SCL, ou uma
 * leitura atual do Beds24 com a noite fechada ou sem unidades — o mesmo critério da consulta
 * (`noiteOcupada`). Noite sem leitura ou com leitura velha não é marcada: a consulta decide depois, no
 * servidor. Só datas saem daqui — nada de hóspede, motivo ou origem da ocupação.
 */
import { and, eq } from "drizzle-orm";
import { planejarImovel } from "@/calendario/envio";
import { lerRegrasCalendario } from "@/calendario/regras-config";
import { imoveis } from "@/db/schema";
import type { Db } from "@/db/types";
import { somarDias } from "@/imoveis/regras-venda";
import { hojeISO } from "@/lib/datas";
import { dataISOValida, limiteDoCalendario, MAXIMO_DIAS_OCUPACAO } from "./calendario";
import { limiteDaLeitura, noiteOcupada } from "./disponibilidade";

const CODIGO = /^[\w-]{1,40}$/;

type ImovelCalendario = { id: string; fuso: string };

/** Imóvel do site (público e ativo) desta organização, pelo código; null para qualquer outro caso. */
async function imovelDoCalendario(db: Db, organizacaoId: string, codigo: string): Promise<ImovelCalendario | null> {
  if (!CODIGO.test(codigo)) return null;
  const [i] = await db
    .select({ id: imoveis.id, fuso: imoveis.fuso })
    .from(imoveis)
    .where(and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.codigo, codigo), eq(imoveis.publico, true), eq(imoveis.ativo, true)));
  return i ?? null;
}

async function ocupadasDoImovel(db: Db, organizacaoId: string, imovel: ImovelCalendario, inicio: string, fim: string, agora: Date): Promise<string[]> {
  if (!dataISOValida(inicio) || !dataISOValida(fim) || fim <= inicio) return [];
  const regras = await lerRegrasCalendario(db, organizacaoId);
  // O plano começa em hoje (noite passada não se escolhe) e vai até a véspera de `fim`.
  const plano = await planejarImovel(db, organizacaoId, regras, imovel, agora, { inicio, fim: somarDias(fim, -1) });
  const limite = limiteDaLeitura(regras, agora);
  return plano.linhas.filter((l) => l.data >= inicio && l.data < fim && noiteOcupada(l, limite)).map((l) => l.data);
}

/**
 * Noites certamente ocupadas em [inicio, fim) de um imóvel do site (público e ativo) da organização, em ordem.
 * null quando o imóvel não está no site (inexistente, oculto, inativo ou de outra organização).
 */
export async function noitesOcupadas(db: Db, organizacaoId: string, codigoImovel: string, inicio: string, fim: string, agora = new Date()): Promise<string[] | null> {
  const imovel = await imovelDoCalendario(db, organizacaoId, codigoImovel);
  return imovel ? ocupadasDoImovel(db, organizacaoId, imovel, inicio, fim, agora) : null;
}

export type PedidoOcupacao = { imovel: string; inicio: string; fim: string };

/**
 * Confere o pedido da rota (`?imovel=…&inicio=AAAA-MM-DD&fim=AAAA-MM-DD`), com `hoje` no fuso do imóvel:
 * cada parâmetro uma vez, código no formato dos códigos, datas válidas, fim depois do início, no máximo
 * `MAXIMO_DIAS_OCUPACAO` dias, início a partir de ontem (página aberta desde a véspera) e fim dentro do
 * que o calendário mostra. Outros parâmetros são ignorados.
 */
export function lerPedidoOcupacao(sp: URLSearchParams, hoje: string): { ok: true; pedido: PedidoOcupacao } | { ok: false; erro: string } {
  const chaves = ["imovel", "inicio", "fim"] as const;
  if (chaves.some((k) => sp.getAll(k).length !== 1)) return { ok: false, erro: "Informe uma vez o apartamento, o início e o fim." };
  const [imovel, inicio, fim] = chaves.map((k) => sp.get(k)!);
  if (!CODIGO.test(imovel)) return { ok: false, erro: "Apartamento inválido." };
  if (!dataISOValida(inicio) || !dataISOValida(fim)) return { ok: false, erro: "Informe as datas como AAAA-MM-DD." };
  if (fim <= inicio) return { ok: false, erro: "O fim precisa ser depois do início." };
  if (fim > somarDias(inicio, MAXIMO_DIAS_OCUPACAO)) return { ok: false, erro: `Peça no máximo ${MAXIMO_DIAS_OCUPACAO} dias por vez.` };
  if (inicio < somarDias(hoje, -1)) return { ok: false, erro: "O início não pode ser antes de ontem." };
  if (fim > limiteDoCalendario(hoje)) return { ok: false, erro: "Datas além do que o calendário mostra." };
  return { ok: true, pedido: { imovel, inicio, fim } };
}

/** Uma resposta curta da rota: nada além das datas no sucesso; nos erros, só uma frase. */
export const CACHE_OCUPACAO = "public, max-age=300, s-maxage=300";
const resposta = (status: number, corpo: object, cache: string) =>
  Response.json(corpo, { status, headers: { "Cache-Control": cache, "X-Content-Type-Options": "nosniff" } });

/**
 * Rota pública `GET /api/site/ocupacao`: a organização é a do site (null → 404). Apartamento fora do site e
 * apartamento inexistente recebem a mesma resposta (404), sem dizer qual é o caso.
 */
export async function responderOcupacao(db: Db, organizacaoId: string | null, sp: URLSearchParams, agora = new Date()): Promise<Response> {
  const naoEncontrado = () => resposta(404, { erro: "Não encontrado." }, "no-store");
  if (!organizacaoId) return naoEncontrado();
  const codigo = sp.get("imovel") ?? "";
  if (!CODIGO.test(codigo)) return resposta(400, { erro: "Apartamento inválido." }, "no-store");
  const imovel = await imovelDoCalendario(db, organizacaoId, codigo);
  if (!imovel) return naoEncontrado();
  const r = lerPedidoOcupacao(sp, hojeISO(imovel.fuso, agora));
  if (!r.ok) return resposta(400, { erro: r.erro }, "no-store");
  const ocupadas = await ocupadasDoImovel(db, organizacaoId, imovel, r.pedido.inicio, r.pedido.fim, agora);
  return resposta(200, { ocupadas }, CACHE_OCUPACAO);
}
