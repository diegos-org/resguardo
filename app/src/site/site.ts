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
import { type FotoPublica, fotosParaOSite } from "@/imoveis/fotos";
import { hojeISO } from "@/lib/datas";
import { uuidValido } from "@/lib/ids";
import { enderecoImagemSite, lerImagensSite } from "./imagens-site";
import { MARCA_PADRAO } from "./marca";

export type ImovelPublico = {
  codigo: string;
  /** Fuso do imóvel: as datas da consulta são conferidas nele, como na disponibilidade. */
  fuso: string;
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
  /** Fotos reais (M7.3), na ordem da galeria; a primeira é a capa. Vazio = "foto em breve". */
  fotos: FotoPublica[];
};

export type ConteudoSite = {
  organizacaoId: string;
  nomeEmpresa: string;
  textos: TextosSite;
  /** Número do WhatsApp da empresa (só dígitos, com DDI) ou null se não há telefone no cadastro. */
  whatsapp: string | null;
  email: string;
  /** Endereços das imagens do site (M7.6): foto da capa (null = o fundo verde) e marca (sem a enviada, a do estudo). */
  imagens: { capa: string | null; marca: string };
  /**
   * Identificação da empresa no rodapé (M7.4, Decreto 7.962, art. 2º): os dados atuais de Configurações → Empresa. As
   * páginas legais mostram os dados congelados na versão; o rodapé, sempre os de agora. Opcional só para os testes.
   */
  identidade?: { razaoSocial: string; cnpj: string; endereco: string };
};

/** Marca do estudo, usada enquanto nenhuma outra é enviada (definida em `./marca`, que a moldura de cliente lê sem o banco). */
export { MARCA_PADRAO };

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
  const [textos, empresa, imagens] = await Promise.all([lerTextosSite(db, organizacaoId), lerEmpresa(db, organizacaoId), lerImagensSite(db, organizacaoId)]);
  return {
    organizacaoId,
    nomeEmpresa: empresa.nome,
    textos,
    whatsapp: numeroWhatsapp(empresa.telefone),
    email: empresa.email,
    imagens: { capa: imagens.capa && enderecoImagemSite(imagens.capa), marca: imagens.marca ? enderecoImagemSite(imagens.marca) : MARCA_PADRAO },
    identidade: { razaoSocial: empresa.razaoSocial, cnpj: empresa.cnpj, endereco: empresa.endereco },
  };
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
  // Só para buscar as fotos: o id nunca vai para o objeto público.
  id: imoveis.id,
  codigo: imoveis.codigo,
  fuso: imoveis.fuso,
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

function publico(l: Linha, fotos: FotoPublica[]): ImovelPublico {
  return {
    codigo: l.codigo ?? "",
    fuso: l.fuso ?? "America/Sao_Paulo",
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
    fotos,
  };
}

async function comFotos(db: Db, organizacaoId: string, linhas: Linha[]): Promise<ImovelPublico[]> {
  const fotos = await fotosParaOSite(db, organizacaoId, linhas.map((l) => l.id).filter((id): id is string => !!id));
  return linhas.map((l) => publico(l, (l.id && fotos.get(l.id)) || []));
}

/** Quais imóveis aparecem no site: os públicos e ativos da organização do site (a lista, a página e a conferência leem daqui). */
const noSite = (organizacaoId: string) => and(eq(imoveis.organizacaoId, organizacaoId), eq(imoveis.publico, true), eq(imoveis.ativo, true));

/** Imóveis que aparecem no site: públicos e ativos, pelo código. */
export async function imoveisDoSite(db: Db, organizacaoId: string): Promise<ImovelPublico[]> {
  const linhas = await db.select(colunasPublicas).from(imoveis).leftJoin(imoveisDetalhes, eq(imoveisDetalhes.imovelId, imoveis.id)).where(noSite(organizacaoId)).orderBy(asc(imoveis.codigo));
  return comFotos(db, organizacaoId, linhas);
}

/**
 * Se há alguma casa no site (M7.8), sem montar a lista nem buscar fotos: a página não encontrada só precisa disso para
 * decidir entre "Conhecer as casas" e o aviso do site sem casas (um endereço errado, até de robô, faz uma leitura curta).
 */
export async function temCasaNoSite(db: Db, organizacaoId: string): Promise<boolean> {
  const [l] = await db.select({ id: imoveis.id }).from(imoveis).where(noSite(organizacaoId)).limit(1);
  return !!l;
}

/** Um imóvel do site pelo código (o endereço da página); null se não é público ou não existe. */
export async function imovelDoSite(db: Db, organizacaoId: string, codigo: string): Promise<ImovelPublico | null> {
  if (!/^[\w-]{1,40}$/.test(codigo)) return null;
  const [l] = await db
    .select(colunasPublicas)
    .from(imoveis)
    .leftJoin(imoveisDetalhes, eq(imoveisDetalhes.imovelId, imoveis.id))
    .where(and(noSite(organizacaoId), eq(imoveis.codigo, codigo)));
  return l ? (await comFotos(db, organizacaoId, [l]))[0] : null;
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
export type ResumoCotacao = { situacao: "disponivel" | "indisponivel" | "a_confirmar" | "invalida"; noites: number; total: number | null; /** Desconto do site já aplicado em `total` (M12.1); omitido ou zero = sem desconto. */ desconto?: number };

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
    const desconto = cotacao.desconto && cotacao.desconto > 0 ? ` (já com o desconto do site de ${brl(cotacao.desconto)})` : "";
    linhas.push(`O site mostrou ${brl(cotacao.total)} para ${cotacao.noites} ${cotacao.noites === 1 ? "noite" : "noites"}${desconto}${cotacao.situacao === "a_confirmar" ? " (disponibilidade a confirmar)" : ""}.`);
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
  agora: Date = new Date(),
): { status: 308; destino: string } | { status: 400; erro: string } | { status: 404 } {
  if (!imovel) return { status: 404 };
  // "Hoje" no fuso do imóvel, como a página do imóvel e a consulta: uma entrada válida em fuso mais atrasado não vira erro.
  const hoje = hojeISO(imovel.fuso, agora);
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

/** Primeira mensagem de quem chama pelo site sem uma consulta montada (botão flutuante e aviso do site sem casas). */
export const MENSAGEM_CONTATO_SITE = "Olá! Vim pelo site e gostaria de falar com a equipe.";

export type CanalContato = "whatsapp" | "email" | null;
/**
 * Por onde a conversa com a empresa continua, em todo o site (a consulta, a página do imóvel e o aviso do site sem
 * casas): o WhatsApp do cadastro da empresa, senão o e-mail; sem os dois, nenhum (a página avisa, não inventa um canal).
 */
export const canalDeContato = (c: Pick<ConteudoSite, "whatsapp" | "email">): CanalContato => (c.whatsapp ? "whatsapp" : c.email.trim() ? "email" : null);

/** Aviso de quando não há WhatsApp nem e-mail no cadastro da empresa (o mesmo na consulta e no aviso do site sem casas). */
export const AVISO_SEM_CONTATO = "O contato ainda não foi configurado. Volte em breve.";

/** Botão de contato do site (M7.8), pelo canal de `canalDeContato`; sem canal, nenhum botão (quem mostra avisa). */
export function contatoDoSite(c: Pick<ConteudoSite, "whatsapp" | "email">): { href: string; rotulo: string; externo: boolean } | null {
  const canal = canalDeContato(c);
  if (canal === "whatsapp" && c.whatsapp) return { href: linkWhatsapp(c.whatsapp, MENSAGEM_CONTATO_SITE), rotulo: "Falar pelo WhatsApp", externo: true };
  if (canal === "email") return { href: `mailto:${c.email.trim()}?subject=${encodeURIComponent("Contato pelo site")}`, rotulo: "Enviar um e-mail", externo: false };
  return null;
}

/**
 * Mínimo do campo de data quando o formulário lista vários imóveis: o "hoje" mais cedo entre os fusos.
 * O navegador não pode recusar uma entrada válida para um imóvel em fuso mais atrasado; a conferência
 * por imóvel (no fuso dele) continua decidindo no servidor.
 */
export function hojeMaisCedo(imoveis: { fuso: string }[], agora = new Date()): string {
  return imoveis.map((i) => hojeISO(i.fuso, agora)).reduce((a, b) => (a < b ? a : b), hojeISO("America/Sao_Paulo", agora));
}
