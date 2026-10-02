/** Prévia de conferência, sem rede ou escrita. Não é disponibilidade para venda. */
import type { EstadoReserva } from "@/db/schema";
import { diaDaSemana, diasEntre, estadiaMinimaNaEntrada, precoDaNoite, somarDias, type Periodo, type RegrasVenda } from "@/imoveis/regras-venda";
import { dataValida, ocupaInventario } from "@/reservas/regras";

export type ObservacaoCalendario = { data: string; preco: number | null; minimoNoites: number | null; livres: number | null; observadoEm: Date };
export type OcupacaoPrevia = { checkin: string; checkout: string; estado: EstadoReserva };
export type BloqueioPrevia = { inicio: string; fim: string };
export type Comparacao = "igual" | "diferente" | "sem_dados";
const comparar = (a: number | null, b: number | null): Comparacao => a === null || b === null ? "sem_dados" : a === b ? "igual" : "diferente";

/** Fim inclusivo na tela. Limite de 92 noites para manter a conferência legível. */
export function validarIntervaloPrevia(inicio: string, fim: string): string | null {
  if (!dataValida(inicio) || !dataValida(fim)) return "Informe datas válidas.";
  if (inicio < "2000-01-01" || fim > "2100-12-31") return "Use datas entre 2000 e 2100.";
  if (inicio > fim) return "A última noite precisa ser igual ou posterior à primeira.";
  if (diasEntre(inicio, fim) >= 92) return "Confira até 92 noites por vez.";
  return null;
}

export function montarPrevia(e: {
  inicio: string; fim: string; hoje: string; regras: RegrasVenda; periodos: readonly Periodo[];
  reservas: readonly OcupacaoPrevia[]; bloqueios: readonly BloqueioPrevia[]; observacoes: readonly ObservacaoCalendario[];
}) {
  const erro = validarIntervaloPrevia(e.inicio, e.fim);
  if (erro) throw new Error(erro);
  const observadas = new Map(e.observacoes.map(o => [o.data, o]));
  return Array.from({ length: diasEntre(e.inicio, e.fim) + 1 }, (_, n) => {
    const data = somarDias(e.inicio, n);
    const preco = precoDaNoite(e.regras, e.periodos, data);
    const minimo = estadiaMinimaNaEntrada(e.regras, e.periodos, data);
    const observacao = observadas.get(data) ?? null;
    const reservas = e.reservas.filter(r => ocupaInventario(r.estado) && r.checkin <= data && data < r.checkout).length;
    const bloqueios = e.bloqueios.filter(b => b.inicio <= data && data < b.fim).length;
    const avisos: string[] = [];
    if (data < e.hoje) avisos.push("Noite passada: o cadastro atual não reconstitui a tarifa histórica.");
    if (preco.valor === null) avisos.push("Preço não cadastrado no SCL.");
    else if (preco.valor <= 0) avisos.push("Preço zero: conferir antes de qualquer venda.");
    if (minimo === null) avisos.push("Estadia mínima não cadastrada no SCL.");
    if (minimo !== null && e.regras.estadiaMaxima !== null && minimo > e.regras.estadiaMaxima) avisos.push("Mínimo do período supera a estadia máxima do cadastro.");
    if (!observacao) avisos.push("Sem leitura do Beds24 para esta noite; disponibilidade desconhecida.");
    else if (observacao.livres === null) avisos.push("Beds24 não informou unidades livres.");
    if (reservas + bloqueios > 0 && observacao?.livres != null && observacao.livres > 0) avisos.push("Beds24 informou unidades livres, mas há reserva ou bloqueio no SCL: conferir.");
    if (reservas > 1) avisos.push("Mais de uma reserva ocupa esta noite.");
    if (reservas > 0 && bloqueios > 0) avisos.push("Reserva e bloqueio se sobrepõem nesta noite.");
    const permiteDia = (dias: readonly number[]) => !dias.length || dias.includes(diaDaSemana(data));
    const antecedencia = diasEntre(e.hoje, data);
    return {
      data, preco, minimo, observacao, reservas, bloqueios, avisos,
      comparacaoPreco: comparar(preco.valor, observacao?.preco ?? null),
      comparacaoMinimo: comparar(minimo, observacao?.minimoNoites ?? null),
      entradaPeloCadastro: antecedencia >= 0 && permiteDia(e.regras.diasChegada)
        && (e.regras.antecedenciaMinima === null || antecedencia >= e.regras.antecedenciaMinima)
        && (e.regras.janelaMaxima === null || antecedencia <= e.regras.janelaMaxima),
      saidaPeloCadastro: permiteDia(e.regras.diasSaida),
    };
  });
}
export type LinhaPrevia = ReturnType<typeof montarPrevia>[number];
