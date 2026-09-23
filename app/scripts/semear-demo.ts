/**
 * Carga de DADOS FICTÍCIOS para desenvolvimento e homologação (M2.5).
 *
 *   DATABASE_URL=... SCL_DEMO_EMAIL=voce@exemplo.com npx tsx scripts/semear-demo.ts
 *
 * - Só roda em banco local, ou no Neon com SEMEAR_CONFIRMO=homologacao (nunca em produção).
 * - Não roda se a organização já tiver imóveis (não mistura com dados reais).
 * - Nomes, documentos e valores são inventados.
 */
import { eq } from "drizzle-orm";
import { criarContrato } from "../src/contratos/repositorio";
import { ehBancoLocal, getDb } from "../src/db/client";
import type { Db } from "../src/db/types";
import { bloqueios, imoveis, organizacoes, usuarios } from "../src/db/schema";
import { criarImovel } from "../src/imoveis/repositorio";
import { garantirCategoriasIniciais, listarCategorias } from "../src/despesas/categorias";
import { registrarDespesa } from "../src/despesas/despesas";
import { hojeISO } from "../src/lib/datas";
import { criarProprietario, definirImoveis } from "../src/proprietarios/repositorio";
import { sincronizarReserva } from "../src/reservas/repositorio";

const url = process.env.DATABASE_URL ?? "";
if (!url) throw new Error("Defina DATABASE_URL.");
if (!ehBancoLocal(url) && process.env.SEMEAR_CONFIRMO !== "homologacao") {
  throw new Error("Banco remoto: só semeia com SEMEAR_CONFIRMO=homologacao (e nunca no banco de produção).");
}

const somaDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function main() {
  // Tudo numa transação: se algo falhar no meio, nada fica gravado e dá para rodar de novo.
  await getDb().transaction(async (db) => semear(db));
}

async function semear(db: Db) {
  let [org] = await db.select().from(organizacoes).limit(1);
  if (!org) [org] = await db.insert(organizacoes).values({ nome: "Sua Casa Leblon" }).returning();
  if ((await db.select({ id: imoveis.id }).from(imoveis).where(eq(imoveis.organizacaoId, org.id))).length > 0) {
    console.log("[semear] a organização já tem imóveis — nada feito.");
    return;
  }
  const email = (process.env.SCL_DEMO_EMAIL ?? "demo@example.com").toLowerCase();
  const [admin] = await db
    .insert(usuarios)
    .values({ organizacaoId: org.id, email, nome: "Admin Demo", papel: "admin" })
    .onConflictDoNothing()
    .returning();
  const autor = admin?.id ?? null;

  const base = {
    publico: true,
    ativo: true,
    cidade: "Rio de Janeiro",
    endereco: "",
    fuso: "America/Sao_Paulo",
    quartos: 1,
    banheiros: 1,
    descricao: "Imóvel fictício para demonstração.",
  };
  const lista = [
    { codigo: "102", nome: "Studio Demo 102", bairro: "Leblon", capacidade: 2 },
    { codigo: "103", nome: "Studio Demo 103", bairro: "Leblon", capacidade: 3 },
    { codigo: "303", nome: "Studio Demo 303", bairro: "Ipanema", capacidade: 2 },
    { codigo: "399", nome: "Studio Demo 399", bairro: "Leblon", capacidade: 4 },
    { codigo: "403", nome: "Studio Demo 403", bairro: "Ipanema", capacidade: 2 },
    { codigo: "buzios", nome: "Casa Demo Búzios", bairro: "Geribá", capacidade: 6, publico: false },
  ];
  const criados = [];
  for (const i of lista) criados.push(await criarImovel(db, org.id, { ...base, ...i }, autor));
  const porCodigo = Object.fromEntries(criados.map((i) => [i.codigo, i.id]));

  const donos = [
    { nome: "Proprietária Fictícia A", imoveis: ["102", "303"] },
    { nome: "Proprietário Fictício B", imoveis: ["103", "399"] },
    { nome: "Proprietária Fictícia C", imoveis: ["403", "buzios"] },
  ];
  for (const d of donos) {
    const p = await criarProprietario(
      db,
      org.id,
      { nome: d.nome, tipo: "fisica", documento: "", email: "", telefone: "", endereco: "", chavePix: "", observacoes: "Cadastro fictício.", ativo: true },
      autor,
    );
    await definirImoveis(db, org.id, p.id, d.imoveis.map((c) => porCodigo[c]), autor);
  }

  for (const c of ["102", "303", "399"]) {
    await criarContrato(db, org.id, porCodigo[c], { tipo: "gestao_completa", comissao: "20", inicio: "2025-01-01", fim: "2026-12-31" }, autor);
    await criarContrato(db, org.id, porCodigo[c], { tipo: "gestao_completa", comissao: "15", inicio: "2027-01-01" }, autor);
  }
  await criarContrato(db, org.id, porCodigo["103"], { tipo: "gestao_completa", comissao: "15", inicio: "2025-01-01" }, autor);
  await criarContrato(db, org.id, porCodigo["403"], { tipo: "gestao_online", comissao: "10", inicio: "2025-01-01" }, autor);

  // Reservas espalhadas pelo mês atual e o próximo.
  const hoje = hojeISO();
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const origens = ["airbnb", "booking", "airbnb", "direta", "airbnb", "site"] as const;
  const nomes = ["Ana", "Bruno", "Carla", "Daniel", "Elisa", "Felipe", "Gabriela", "Hugo", "Isabel", "João"];
  let n = 0;
  for (const i of criados) {
    let dia = somaDias(inicioMes, (n % 4) + 1);
    for (let k = 0; k < 6; k++, n++) {
      const noites = 2 + ((n * 7) % 5);
      const checkout = somaDias(dia, noites);
      const bruto = noites * (35000 + ((n * 1300) % 20000));
      const origem = origens[n % origens.length];
      const taxa = origem === "airbnb" ? Math.round(bruto * 0.15) : origem === "booking" ? Math.round(bruto * 0.17) : 0;
      await sincronizarReserva(db, org.id, "demo", `demo-${n}`, {
        imovelId: i.id,
        origem,
        estado: n % 13 === 5 ? "cancelada" : "confirmada",
        checkin: dia,
        checkout,
        hospedes: 1 + (n % 3),
        hospedeNome: `${nomes[n % nomes.length]} (fictício)`,
        hospedeEmail: "",
        hospedeTelefone: "",
        hospedeOrigem: ["São Paulo, Brasil", "Buenos Aires, Argentina", "", "Lisboa, Portugal"][n % 4],
        moeda: "BRL",
        valorBruto: bruto,
        taxaCanal: taxa,
        valorLiquido: bruto - taxa,
        codigoCanal: origem === "airbnb" ? `HMDEMO${n}` : "",
        // Airbnb: a maioria com split confirmado; algumas "a confirmar" para mostrar o acerto pendente.
        recebimento: origem === "airbnb" && n % 3 !== 0 ? "split" : null,
        observacoes: "Reserva fictícia.",
      });
      dia = somaDias(checkout, n % 3);
    }
  }
  // Um overbooking proposital, para demonstrar o alerta.
  await sincronizarReserva(db, org.id, "demo", "demo-overbooking", {
    imovelId: porCodigo["403"],
    origem: "booking",
    estado: "confirmada",
    checkin: somaDias(inicioMes, 6),
    checkout: somaDias(inicioMes, 9),
    hospedes: 2,
    hospedeNome: "Overbooking (fictício)",
    hospedeEmail: "",
    hospedeTelefone: "",
    hospedeOrigem: "",
    moeda: "BRL",
    valorBruto: 120000,
    taxaCanal: 20400,
    valorLiquido: 99600,
    codigoCanal: "",
    observacoes: "Demonstração de conflito.",
  });
  await db.insert(bloqueios).values({ organizacaoId: org.id, imovelId: porCodigo["102"], inicio: somaDias(inicioMes, 20), fim: somaDias(inicioMes, 23), motivo: "Manutenção (demo)" });
  // Despesas fictícias: da empresa e uma do proprietário paga pela empresa (a cobrar).
  await garantirCategoriasIniciais(db, org.id);
  const cat = Object.fromEntries((await listarCategorias(db, org.id)).map((c) => [c.nome, c.id]));
  const despesaBase = { pagoPor: "empresa" as const, imovelId: null, proprietarioId: null, comprovante: "", paga: true, dataPagamento: somaDias(inicioMes, 3) };
  for (const d of [
    { responsavel: "empresa" as const, categoriaId: cat["Equipe"], descricao: "Diária de apoio (demo)", valor: 45000, fornecedor: "Equipe demo" },
    { responsavel: "empresa" as const, categoriaId: cat["Mercado e consumo"], descricao: "Compras de limpeza em volume (demo)", valor: 32890, fornecedor: "Mercado demo" },
    { responsavel: "empresa" as const, categoriaId: cat["Limpeza e lavanderia"], descricao: "Lavanderia do mês (demo)", valor: 61200, fornecedor: "Lavanderia demo", paga: false, dataPagamento: null },
    { responsavel: "proprietario" as const, categoriaId: cat["Manutenção"], descricao: "Conserto do ar-condicionado (demo)", valor: 80000, fornecedor: "Refrigeração demo", imovelId: porCodigo["303"] },
  ]) {
    const r = await registrarDespesa(db, org.id, { ...despesaBase, data: somaDias(inicioMes, 3), ...d }, null);
    if (!r.ok) throw new Error(`despesa demo: ${JSON.stringify(r.erros)}`);
  }
  console.log(`[semear] pronto: ${criados.length} imóveis, ${donos.length} proprietários, ${n + 1} reservas fictícias. Admin: ${email}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
