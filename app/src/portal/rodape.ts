/**
 * Rodapé do portal (M5.2): saldo do acerto com o proprietário no fim do mês, quem deve a quem e o
 * Pix de quem recebe. Usa a mesma previsão do repasse mensal (`preverRepasses`), com os
 * adiantamentos já descontados — uma regra, um lugar. Credor/devedor e Pix só aparecem com o mês
 * terminado e sem nada em conferência; antes disso o saldo é mostrado como parcial.
 */
import type { Db } from "@/db/types";
import { limitesDoMes, preverRepasses } from "@/repasses/repasses";

export type SituacaoRodape =
  /** Repasse já feito. */
  | "pago"
  /** Mês fechado, repasse a transferir pela empresa. */
  | "fechado"
  /** Mês terminado, sem pendências: a empresa deve (Pix do proprietário). */
  | "empresa_deve"
  /** Mês terminado, sem pendências: o proprietário deve (Pix da empresa). */
  | "proprietario_deve"
  | "zerado"
  /** O mês ainda não terminou: saldo parcial, sem credor/Pix. */
  | "parcial"
  /** Há acerto pendente ou ajuste a esclarecer: sem credor/Pix até resolver. */
  | "em_conferencia";

export type Rodape = {
  proprietarioId: string;
  nome: string;
  situacao: SituacaoRodape;
  /** Saldo do acerto no fim do mês (positivo: a empresa deve), como no repasse. */
  saldo: number;
  /** Adiantamentos da empresa a descontar (ou descontados no repasse). */
  descontado: number;
  /** Valor a transferir (quem deve a quem conforme a situação). */
  valor: number;
  /** A favor de quem está o valor (pelo líquido, já sem os contestados); null = zerado. */
  aFavor: "proprietario" | "empresa" | null;
  /** Chave Pix de quem recebe; vazio = não cadastrada. */
  chavePix: string;
  dataPagamento: string | null;
};

export async function rodapeDoPortal(
  db: Db,
  organizacaoId: string,
  o: { proprietarios: readonly { id: string; nome: string }[]; mes: string; hoje: string; pixEmpresa: string },
): Promise<Rodape[]> {
  const lim = limitesDoMes(o.mes);
  if (!lim || !o.proprietarios.length) return [];
  const previsoes = await preverRepasses(
    db,
    organizacaoId,
    o.mes,
    o.hoje,
    o.proprietarios.map((p) => p.id),
    // Todos, mesmo sem saldo: um ajuste sem valor a esclarecer precisa deixar o mês em conferência.
    true,
  );
  return o.proprietarios.map((dono) => {
    const p = previsoes.find((x) => x.proprietarioId === dono.id);
    const base = { proprietarioId: dono.id, nome: dono.nome, saldo: 0, descontado: 0, valor: 0, aFavor: null, chavePix: "", dataPagamento: null };
    if (!p) return { ...base, situacao: "zerado" };
    const r = p.repasse;
    if (r) {
      return { ...base, saldo: r.saldo, descontado: r.descontado, valor: r.valor, aFavor: "proprietario", chavePix: p.chavePix, situacao: r.situacao === "pago" ? "pago" : "fechado", dataPagamento: r.dataPagamento };
    }
    const aFavor = p.valor > 0 ? ("proprietario" as const) : p.deve > 0 ? ("empresa" as const) : null;
    const comum = { ...base, saldo: p.saldo, descontado: p.aDescontar, aFavor };
    if (o.hoje < lim.fim) return { ...comum, situacao: "parcial", valor: p.valor || p.deve };
    if (p.bloqueios.length) return { ...comum, situacao: "em_conferencia", valor: p.valor || p.deve };
    if (p.valor > 0) return { ...comum, situacao: "empresa_deve", valor: p.valor, chavePix: p.chavePix };
    if (p.deve > 0) return { ...comum, situacao: "proprietario_deve", valor: p.deve, chavePix: o.pixEmpresa };
    return { ...comum, situacao: "zerado" };
  });
}
