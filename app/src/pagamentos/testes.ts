/**
 * Apoio aos testes do pagamento no site (M8.2a): um cenário fictício completo (empresa, imóvel do site com
 * leitura do Beds24 livre, proprietário, contrato de gestão), relógio fixo controlável e o provedor falso.
 * Só testes importam daqui; nada usa rede nem credenciais.
 */
import { and, eq } from "drizzle-orm";
import { criarContrato } from "@/contratos/repositorio";
import { beds24Calendario, cotacoes, idsExternos, imoveis, imoveisDetalhes, organizacoes, pagamentos, proprietarioImoveis, proprietarios, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { PESOS_PADRAO_ANTIGO, PRECOS_MARKETPLACE_PADRAO } from "@/marketplace/precos";
import { salvarPrecosMarketplace } from "@/marketplace/precos-config";
import { criarCotacao, segurarDatas } from "@/site/cotacoes";
import { esquecerProvedorDoAmbiente } from "./ambiente";
import { ProvedorFalso } from "./falso";
import { type PortaoCobranca, podeCobrar } from "./oferta";
import { gerarPix } from "./pix";

/** 1/10/2026 (quinta), 12:00 em São Paulo. */
export const AGORA = new Date("2026-10-01T15:00:00Z");
export const minutos = (n: number, de: Date = AGORA) => new Date(de.getTime() + n * 60_000);
/** Total da cotação padrão: 3 noites para 4 pessoas no 403 (valor cheio 1.900,00, desconto do site 76,00). */
export const TOTAL = 182400;
export const EMAIL_HOSPEDE = "visitante@example.com";
export const DOCUMENTO_FICTICIO = "12345678909";
/** Variáveis de ambiente de teste (nunca as do processo). */
export const env = (v: Record<string, string> = {}) => v as unknown as NodeJS.ProcessEnv;

const dias = (de: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${de}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

export type Cenario = {
  db: Db;
  org: string;
  imovel: string;
  dono: string;
  relogio: { agora: Date };
  provedor: ProvedorFalso;
  gate: PortaoCobranca;
  /** Cota e segura as datas (entrada 12/10, saída 15/10, 4 pessoas, salvo `over`). */
  segurar: (over?: Partial<{ entrada: string; saida: string; hospedes: string; email: string }>, quando?: Date) => Promise<{ cotacaoId: string; reservaId: string; codigo: string }>;
  /** Gera o Pix e devolve a tentativa (e o id da order no provedor). */
  pix: (cotacaoId: string, quando?: Date) => Promise<{ pagamentoId: string; idProvedor: string }>;
  tentativa: (id: string) => Promise<typeof pagamentos.$inferSelect>;
  reserva: (id: string) => Promise<typeof reservas.$inferSelect>;
  cotacao: (id: string) => Promise<typeof cotacoes.$inferSelect>;
};

export async function montarCenario(db: Db): Promise<Cenario> {
  esquecerProvedorDoAmbiente();
  const [{ id: org }] = await db.insert(organizacoes).values({ nome: "Sua Casa Exemplo" }).returning();
  const [{ id: imovel }] = await db.insert(imoveis).values({ organizacaoId: org, codigo: "403", nome: "Studio Exemplo", publico: true, capacidade: 4 }).returning();
  await db.insert(imoveisDetalhes).values({ imovelId: imovel, organizacaoId: org, precoBase: 45000, taxaLimpeza: 25000, hospedeExtraValor: 5000, hospedeExtraAPartirDe: 3, pisoUltimaHora1: 35000, pisoUltimaHora2: 30000 });
  await db.insert(idsExternos).values({ organizacaoId: org, imovelId: imovel, canal: "beds24", idExterno: "10", detalhe: "20" });
  await salvarPrecosMarketplace(db, org, { ...PRECOS_MARKETPLACE_PADRAO, pesos: { ...PESOS_PADRAO_ANTIGO } }, null);
  await db.insert(beds24Calendario).values(dias("2026-10-01", 61).map((data) => ({ organizacaoId: org, imovelId: imovel, data, roomId: "20", livres: 1, preco: 45000, minimoNoites: 1, maximoNoites: 27, bloqueio: "none", observadoEm: new Date("2026-10-01T09:15:00Z") })));
  const [{ id: dono }] = await db.insert(proprietarios).values({ organizacaoId: org, nome: "Dona Fictícia", email: "dona@example.com", chavePix: "dona@example.com" }).returning();
  await db.insert(proprietarioImoveis).values({ proprietarioId: dono, imovelId: imovel });
  const contrato = await criarContrato(db, org, imovel, { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, null);
  if (!contrato.ok) throw new Error(JSON.stringify(contrato.erros));
  const relogio = { agora: AGORA };
  const provedor = new ProvedorFalso(() => relogio.agora);
  const gate = await podeCobrar(db, org, env(), AGORA, { provedor });
  const c: Cenario = {
    db,
    org,
    imovel,
    dono,
    relogio,
    provedor,
    gate,
    async segurar(over = {}, quando = relogio.agora) {
      const r = await criarCotacao(db, org, { imovel: "403", entrada: over.entrada ?? "2026-10-12", saida: over.saida ?? "2026-10-15", hospedes: over.hospedes ?? "4" }, quando);
      if (!r.ok) throw new Error(r.erro);
      const h = await segurarDatas(db, org, r.cotacao.codigo, { nome: "Visitante Fictício", email: over.email ?? EMAIL_HOSPEDE, telefone: "(21) 99999-0000" }, quando);
      if (!h.ok) throw new Error(h.erro);
      return { cotacaoId: h.cotacao.id, reservaId: h.cotacao.reservaId!, codigo: h.cotacao.codigo };
    },
    async pix(cotacaoId, quando = relogio.agora) {
      const r = await gerarPix(db, org, cotacaoId, quando, provedor);
      if (!r.ok) throw new Error(`${r.codigo}: ${r.erro}`);
      const p = await c.tentativa(r.pagamentoId);
      return { pagamentoId: p.id, idProvedor: p.idProvedor! };
    },
    async tentativa(id) {
      const [p] = await db.select().from(pagamentos).where(and(eq(pagamentos.id, id), eq(pagamentos.organizacaoId, org)));
      return p;
    },
    async reserva(id) {
      const [r] = await db.select().from(reservas).where(eq(reservas.id, id));
      return r;
    },
    async cotacao(id) {
      const [x] = await db.select().from(cotacoes).where(eq(cotacoes.id, id));
      return x;
    },
  };
  return c;
}
