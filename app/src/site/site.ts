/**
 * Site público (M7.1): o que o visitante vê, lido do banco. Só entram imóveis marcados como
 * públicos e ativos, e só os campos pensados para o público (nunca endereço exato, proprietário,
 * contrato, preço interno ou dados de reserva). Os textos vêm da configuração "textos_site" e o
 * contato, dos dados da empresa — tudo editável no painel.
 *
 * A consulta não grava nada: monta uma mensagem de WhatsApp para o número da empresa. Reserva
 * direta e cotação ficam para o M7.2/M8.
 */
import { and, asc, eq } from "drizzle-orm";
import { lerEmpresa } from "@/configuracoes/empresa";
import { lerTextosSite, type TextosSite } from "@/configuracoes/textos-site";
import { imoveis, imoveisDetalhes, organizacoes } from "@/db/schema";
import type { Db } from "@/db/types";
import { TIPOS_CAMA, type TipoCama } from "@/imoveis/cadastro-opcoes";
import { uuidValido } from "@/lib/ids";

export type ImovelPublico = {
  codigo: string;
  nome: string;
  bairro: string;
  cidade: string;
  capacidade: number | null;
  quartos: number | null;
  banheiros: number | null;
  descricao: string;
  /** Ex.: ["1 cama Queen", "1 Sofá-cama"]. */
  camas: string[];
  comodidades: string[];
  regrasCasa: string;
  aceitaAnimais: boolean;
  permiteFumar: boolean;
  permiteFestas: boolean;
  checkinAPartirDe: string;
  checkoutAte: string;
  estadiaMinima: number | null;
};

export type ConteudoSite = {
  organizacaoId: string;
  nomeEmpresa: string;
  textos: TextosSite;
  /** Número do WhatsApp da empresa (só dígitos, com DDI) ou null se não há telefone no cadastro. */
  whatsapp: string | null;
  email: string;
};

/**
 * De qual organização é o site: a da variável SITE_ORGANIZACAO_ID, se existir; senão, a única
 * organização do banco. Com mais de uma e sem a variável, nenhuma (o site avisa que está em
 * configuração, em vez de escolher uma).
 */
export async function organizacaoDoSite(db: Db, env: string | undefined = process.env.SITE_ORGANIZACAO_ID): Promise<string | null> {
  if (env) {
    if (!uuidValido(env)) return null;
    const [o] = await db.select({ id: organizacoes.id }).from(organizacoes).where(eq(organizacoes.id, env));
    return o?.id ?? null;
  }
  const orgs = await db.select({ id: organizacoes.id }).from(organizacoes).limit(2);
  return orgs.length === 1 ? orgs[0].id : null;
}

/** Telefone do cadastro da empresa → número do WhatsApp (DDI 55 quando vier só com DDD). */
export function numeroWhatsapp(telefone: string): string | null {
  const d = telefone.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return null;
}

export async function conteudoDoSite(db: Db): Promise<ConteudoSite | null> {
  const organizacaoId = await organizacaoDoSite(db);
  if (!organizacaoId) return null;
  const [textos, empresa] = await Promise.all([lerTextosSite(db, organizacaoId), lerEmpresa(db, organizacaoId)]);
  return { organizacaoId, nomeEmpresa: empresa.nome, textos, whatsapp: numeroWhatsapp(empresa.telefone), email: empresa.email };
}

const SEM_PALAVRA_CAMA = new Set(["sofa_cama", "beliche", "colchao"]);
const descreverCamas = (camas: Record<string, number>): string[] =>
  Object.entries(camas)
    .filter(([tipo, n]) => tipo in TIPOS_CAMA && Number.isInteger(n) && n > 0)
    .map(([tipo, n]) => {
      const nome = TIPOS_CAMA[tipo as TipoCama];
      return SEM_PALAVRA_CAMA.has(tipo) ? `${n} ${nome}` : `${n} ${n === 1 ? "cama" : "camas"} ${nome}`;
    });

const colunasPublicas = {
  codigo: imoveis.codigo,
  nome: imoveis.nome,
  bairro: imoveis.bairro,
  cidade: imoveis.cidade,
  capacidade: imoveis.capacidade,
  quartos: imoveis.quartos,
  banheiros: imoveis.banheiros,
  descricao: imoveis.descricao,
  camas: imoveisDetalhes.camas,
  comodidades: imoveisDetalhes.comodidades,
  regrasCasa: imoveisDetalhes.regrasCasa,
  aceitaAnimais: imoveisDetalhes.aceitaAnimais,
  permiteFumar: imoveisDetalhes.permiteFumar,
  permiteFestas: imoveisDetalhes.permiteFestas,
  checkinAPartirDe: imoveisDetalhes.checkinAPartirDe,
  checkoutAte: imoveisDetalhes.checkoutAte,
  estadiaMinima: imoveisDetalhes.estadiaMinima,
};

type Linha = { [K in keyof typeof colunasPublicas]: (typeof colunasPublicas)[K]["_"]["data"] | null };

function publico(l: Linha): ImovelPublico {
  return {
    codigo: l.codigo ?? "",
    nome: l.nome ?? "",
    bairro: l.bairro ?? "",
    cidade: l.cidade ?? "",
    capacidade: l.capacidade,
    quartos: l.quartos,
    banheiros: l.banheiros,
    descricao: l.descricao ?? "",
    camas: descreverCamas(l.camas ?? {}),
    comodidades: l.comodidades ?? [],
    regrasCasa: l.regrasCasa ?? "",
    aceitaAnimais: l.aceitaAnimais ?? false,
    permiteFumar: l.permiteFumar ?? false,
    permiteFestas: l.permiteFestas ?? false,
    checkinAPartirDe: l.checkinAPartirDe ?? "15:00",
    checkoutAte: l.checkoutAte ?? "11:00",
    estadiaMinima: l.estadiaMinima,
  };
}

/** Imóveis que aparecem no site: públicos e ativos, pelo código. */
export async function imoveisDoSite(db: Db, organizacaoId: string): Promise<ImovelPublico[]> {
  const linhas = await db
    .select(colunasPublicas)
    .from(imoveis)
    .leftJoin(imoveisDetalhes, eq(imoveisDetalhes.imovelId, imoveis.id))
    .where(and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.publico, true), eq(imoveis.ativo, true)))
    .orderBy(asc(imoveis.codigo));
  return linhas.map(publico);
}

/** Um imóvel do site pelo código (o endereço da página); null se não é público ou não existe. */
export async function imovelDoSite(db: Db, organizacaoId: string, codigo: string): Promise<ImovelPublico | null> {
  if (!/^[\w-]{1,40}$/.test(codigo)) return null;
  const [l] = await db
    .select(colunasPublicas)
    .from(imoveis)
    .leftJoin(imoveisDetalhes, eq(imoveisDetalhes.imovelId, imoveis.id))
    .where(and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.codigo, codigo), eq(imoveis.publico, true), eq(imoveis.ativo, true)));
  return l ? publico(l) : null;
}

export type PedidoConsulta = { imovel: string; entrada: string; saida: string; hospedes: string };
/** Nomes aceitos no endereço: os do site e os do contrato de links já divulgado (`property`, `checkin`…). */
const APELIDOS: Record<keyof PedidoConsulta, string[]> = { imovel: ["imovel", "property"], entrada: ["entrada", "checkin"], saida: ["saida", "checkout"], hospedes: ["hospedes", "guests"] };

export function lerPedidoConsulta(sp: Record<string, string | string[] | undefined>): PedidoConsulta {
  const ler = (k: keyof PedidoConsulta) => {
    for (const nome of APELIDOS[k]) {
      const v = sp[nome];
      if (typeof v === "string" && v) return v.slice(0, 40);
    }
    return "";
  };
  return { imovel: ler("imovel"), entrada: ler("entrada"), saida: ler("saida"), hospedes: ler("hospedes") };
}

export type ErrosConsulta = Partial<Record<keyof PedidoConsulta, string>>;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (d: string) => DATA.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const dataBr = (d: string) => d.split("-").reverse().join("/");
const brl = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Confere a consulta do visitante (datas, hóspedes dentro da capacidade) e monta a mensagem de
 * WhatsApp. Nada é gravado nem enviado pelo sistema: o visitante abre a conversa e manda.
 */
export type ResumoCotacao = { situacao: "disponivel" | "indisponivel" | "a_confirmar" | "invalida"; noites: number; total: number | null };

export function montarConsulta(
  p: PedidoConsulta,
  imovel: ImovelPublico | null,
  hoje: string,
  /** Resultado da disponibilidade (M7.2): entra na mensagem como referência, nunca como preço garantido. */
  cotacao?: ResumoCotacao | null,
): { ok: true; texto: string } | { ok: false; erros: ErrosConsulta } {
  const erros: ErrosConsulta = {};
  if (!imovel) erros.imovel = "Escolha um apartamento.";
  if (!dataValida(p.entrada)) erros.entrada = "Informe a data de entrada.";
  else if (p.entrada < hoje) erros.entrada = "A entrada não pode ser antes de hoje.";
  if (!dataValida(p.saida)) erros.saida = "Informe a data de saída.";
  else if (dataValida(p.entrada) && p.saida <= p.entrada) erros.saida = "A saída precisa ser depois da entrada.";
  // Só dígitos: a mesma regra da disponibilidade (M7.2), para "2e0" não virar "2 pessoas".
  const hospedes = /^\d+$/.test(p.hospedes) ? Number(p.hospedes) : NaN;
  if (!Number.isInteger(hospedes) || hospedes < 1) erros.hospedes = "Informe quantas pessoas.";
  else if (imovel?.capacidade && hospedes > imovel.capacidade) erros.hospedes = `Este apartamento recebe até ${imovel.capacidade} pessoas.`;
  if (Object.keys(erros).length || !imovel) return { ok: false, erros };
  const linhas = [
    `Olá! Gostaria de consultar a disponibilidade do ${imovel.nome} (${imovel.codigo}).`,
    `Entrada: ${dataBr(p.entrada)} · Saída: ${dataBr(p.saida)} · ${hospedes} ${hospedes === 1 ? "pessoa" : "pessoas"}.`,
  ];
  if (cotacao && cotacao.total !== null && (cotacao.situacao === "disponivel" || cotacao.situacao === "a_confirmar")) {
    linhas.push(`O site mostrou ${brl(cotacao.total)} para ${cotacao.noites} ${cotacao.noites === 1 ? "noite" : "noites"}${cotacao.situacao === "a_confirmar" ? " (disponibilidade a confirmar)" : ""}.`);
  }
  return { ok: true, texto: linhas.join("\n") };
}

/** Título da aba/busca: "Página — Nome da empresa" (o nome vem do cadastro da empresa no painel). */
export function tituloDoSite(conteudo: Pick<ConteudoSite, "nomeEmpresa"> | null, pagina?: string): string {
  const nome = conteudo?.nomeEmpresa.trim() ?? "";
  return [pagina, nome].filter(Boolean).join(" — ");
}

/**
 * Links antigos do site (`/property/<código>?checkin=…&checkout=…&guests=…`, do contrato de links
 * já divulgado): levam à página do imóvel com só os critérios de estadia, conferidos. Critério
 * inválido, incompleto ou repetido: avisa (400) em vez de supor; outros parâmetros são descartados.
 */
export function destinoDoLinkAntigo(
  sp: URLSearchParams,
  imovel: ImovelPublico | null,
  hoje: string,
): { status: 308; destino: string } | { status: 400; erro: string } | { status: 404 } {
  if (!imovel) return { status: 404 };
  const base = `/imoveis/${encodeURIComponent(imovel.codigo)}`;
  const chaves = ["checkin", "checkout", "guests"] as const;
  const criterios = new URLSearchParams();
  for (const k of chaves) for (const v of sp.getAll(k)) criterios.append(k, v);
  if (!criterios.size) return { status: 308, destino: base };
  if (chaves.some((k) => criterios.getAll(k).length !== 1)) return { status: 400, erro: "Informe uma vez a entrada, a saída e o número de pessoas." };
  if (!/^\d+$/.test(criterios.get("guests")!)) return { status: 400, erro: "Informe quantas pessoas." };
  const r = montarConsulta({ imovel: imovel.codigo, entrada: criterios.get("checkin")!, saida: criterios.get("checkout")!, hospedes: criterios.get("guests")! }, imovel, hoje);
  if (!r.ok) return { status: 400, erro: Object.values(r.erros).join(" ") };
  return { status: 308, destino: `${base}?${criterios}` };
}

export const linkWhatsapp = (numero: string, texto: string) => `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
