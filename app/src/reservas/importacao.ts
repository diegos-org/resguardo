/**
 * Importação de reservas por CSV (M3.6): conferir (sem gravar) e importar. A importação usa
 * a mesma `sincronizarReserva` do Beds24 (fonte "csv", id = origem:código do canal), então
 * importar o mesmo arquivo de novo não duplica nada, e reservas alteradas são atualizadas.
 */
import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { calcularMudancas, registrarAuditoria } from "@/auditoria/auditoria";
import { imoveis, reservas } from "@/db/schema";
import type { Db } from "@/db/types";
import { LIMITE_BYTES, LIMITE_LINHAS, lerCabecalho, lerCsv, lerLinha } from "./csv";
import { type DadosReserva } from "./regras";
import { sincronizarReserva } from "./repositorio";

export const FONTE_CSV = "csv";

export type SituacaoLinha = "nova" | "atualiza" | "igual" | "erro";
export type LinhaAnalise = {
  numero: number;
  situacao: SituacaoLinha;
  resumo: string;
  erros: string[];
  avisos: string[];
  /** Presente nas linhas válidas: o que será gravado. */
  dados?: DadosReserva;
  idFonte?: string;
};
export type Analise = { erroGeral?: string; colunasIgnoradas: string[]; linhas: LinhaAnalise[] };

const dataBr = (d: string) => d.split("-").reverse().join("/");

export async function analisarCsv(db: Db, organizacaoId: string, texto: string): Promise<Analise> {
  if (new TextEncoder().encode(texto).length > LIMITE_BYTES) return { erroGeral: "Arquivo acima de 900 KB: divida em partes.", colunasIgnoradas: [], linhas: [] };
  const tabela = lerCsv(texto);
  if (tabela.length < 2) return { erroGeral: "O arquivo precisa ter o cabeçalho e pelo menos uma reserva.", colunasIgnoradas: [], linhas: [] };
  if (tabela.length - 1 > LIMITE_LINHAS) return { erroGeral: `No máximo ${LIMITE_LINHAS} reservas por arquivo.`, colunasIgnoradas: [], linhas: [] };
  const cab = lerCabecalho(tabela[0]);
  if (cab.faltando.length) {
    const nomes: Record<string, string> = { imovel: "imovel", origem: "origem", codigoCanal: "codigo_canal", checkin: "entrada", checkout: "saida" };
    return { erroGeral: `Faltam colunas obrigatórias: ${cab.faltando.map((c) => nomes[c]).join(", ")}. Use o modelo.`, colunasIgnoradas: cab.ignoradas, linhas: [] };
  }

  const lista = await db.select({ id: imoveis.id, codigo: imoveis.codigo }).from(imoveis).where(eq(imoveis.organizacaoId, organizacaoId));
  const porCodigo = new Map(lista.map((i) => [i.codigo.toLowerCase(), i.id]));
  const vistos = new Map<string, number>();
  const linhas: LinhaAnalise[] = [];

  for (let i = 1; i < tabela.length; i++) {
    const l = lerLinha(tabela[i], cab, i + 1);
    if (!l.ok) {
      linhas.push({ numero: l.numero, situacao: "erro", resumo: "", erros: l.erros, avisos: [] });
      continue;
    }
    const resumo = `${l.imovel} · ${l.dados.origem} ${l.dados.codigoCanal} · ${dataBr(l.dados.checkin)} → ${dataBr(l.dados.checkout)}`;
    const imovelId = porCodigo.get(l.imovel);
    const erros: string[] = [];
    if (!imovelId) erros.push(`Imóvel "${l.imovel}" não cadastrado (use o código, ex.: 403).`);
    const repetida = vistos.get(l.idFonte);
    if (repetida) erros.push(`Mesma reserva da linha ${repetida}.`);
    vistos.set(l.idFonte, l.numero);
    if (erros.length) {
      linhas.push({ numero: l.numero, situacao: "erro", resumo, erros, avisos: [] });
      continue;
    }
    linhas.push({ numero: l.numero, situacao: "nova", resumo, erros: [], avisos: [], dados: { ...l.dados, imovelId: imovelId! }, idFonte: l.idFonte });
  }

  // Já importadas antes? (mesma fonte + id) → atualiza ou igual.
  const validas = linhas.filter((l) => l.dados);
  const ids = validas.map((l) => l.idFonte!);
  const existentes = ids.length
    ? await db
        .select()
        .from(reservas)
        .where(and(eq(reservas.organizacaoId, organizacaoId), eq(reservas.fonte, FONTE_CSV), inArray(reservas.idFonte, ids)))
    : [];
  const porIdFonte = new Map(existentes.map((r) => [r.idFonte, r]));
  for (const l of validas) {
    const r = porIdFonte.get(l.idFonte!);
    if (!r) continue;
    const m = calcularMudancas(r, { ...r, ...l.dados });
    l.situacao = Object.keys(m).length ? "atualiza" : "igual";
    if (l.situacao === "atualiza") l.avisos.push(`Muda: ${Object.keys(m).join(", ")}.`);
  }

  // Avisa (não bloqueia) sobreposição com outras reservas do mesmo imóvel. Uma consulta só,
  // para todos os imóveis e o intervalo de datas do arquivo; a comparação é feita em memória.
  const ativas = validas.filter((l) => l.dados!.estado !== "cancelada");
  const doArquivo = ativas.length
    ? await db
        .select({ id: reservas.id, imovelId: reservas.imovelId, codigo: reservas.codigo, checkin: reservas.checkin, checkout: reservas.checkout })
        .from(reservas)
        .where(
          and(
            eq(reservas.organizacaoId, organizacaoId),
            inArray(reservas.imovelId, [...new Set(ativas.map((l) => l.dados!.imovelId))]),
            ne(reservas.estado, "cancelada"),
            lt(reservas.checkin, ativas.reduce((m, l) => (l.dados!.checkout > m ? l.dados!.checkout : m), "")),
            gt(reservas.checkout, ativas.reduce((m, l) => (l.dados!.checkin < m ? l.dados!.checkin : m), "9999-12-31")),
          ),
        )
    : [];
  for (const l of ativas) {
    const d = l.dados!;
    const proprio = porIdFonte.get(l.idFonte!);
    const choque = doArquivo.find((r) => r.imovelId === d.imovelId && r.id !== proprio?.id && r.checkin < d.checkout && r.checkout > d.checkin);
    if (choque) l.avisos.push(`Cruza com a reserva ${choque.codigo} (${dataBr(choque.checkin)} → ${dataBr(choque.checkout)}) no mesmo imóvel.`);
    const outra = ativas.find((o) => o !== l && o.dados!.imovelId === d.imovelId && o.dados!.checkin < d.checkout && o.dados!.checkout > d.checkin);
    if (outra) l.avisos.push(`Cruza com a linha ${outra.numero} deste arquivo.`);
  }
  return { colunasIgnoradas: cab.ignoradas, linhas };
}

/**
 * `semRecalculo`: linhas cuja reserva foi atualizada, mas o financeiro não, porque já tinha
 * dinheiro movimentado (precisa de ajuste manual).
 */
export type ResultadoImportacao = { erroGeral?: string; criadas: number; atualizadas: number; iguais: number; comErro: number; semRecalculo: number[] };

/** Importa as linhas válidas (as com erro ficam de fora e são contadas). */
export async function importarCsv(db: Db, organizacaoId: string, texto: string, autorId: string | null): Promise<ResultadoImportacao> {
  const a = await analisarCsv(db, organizacaoId, texto);
  const r: ResultadoImportacao = { erroGeral: a.erroGeral, criadas: 0, atualizadas: 0, iguais: 0, comErro: 0, semRecalculo: [] };
  if (a.erroGeral) return r;
  for (const l of a.linhas) {
    if (!l.dados) {
      r.comErro++;
      continue;
    }
    // Igual ao que já está gravado: nada a fazer (e o arquivo grande não demora à toa).
    if (l.situacao === "igual") {
      r.iguais++;
      continue;
    }
    const s = await sincronizarReserva(db, organizacaoId, FONTE_CSV, l.idFonte!, l.dados, autorId);
    if (!s.ok) r.comErro++;
    else {
      if (s.criada) r.criadas++;
      else r.atualizadas++;
      if (s.financeiroNaoAtualizado) r.semRecalculo.push(l.numero);
    }
  }
  await registrarAuditoria(db, {
    organizacaoId,
    usuarioId: autorId,
    acao: "reservas.importar_csv",
    entidade: "importacao",
    entidadeId: organizacaoId,
    mudancas: { resultado: [null, `${r.criadas} nova(s), ${r.atualizadas} atualizada(s), ${r.iguais} igual(is), ${r.comErro} com erro`] },
  });
  return r;
}
