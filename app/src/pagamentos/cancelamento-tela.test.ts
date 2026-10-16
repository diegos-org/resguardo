import { describe, expect, it } from "vitest";
import type { Previa } from "./cancelamento";
import { previaParaTela, RESULTADOS_DO_CANCELAMENTO, resultadoDoCancelamento, textoDoResultado } from "./cancelamento-tela";

const LEITURA = "Leitura do Mercado Pago de 01/10 às 12:06: aprovado.";
const previa = (over: Partial<Previa> = {}): Previa => ({
  decisao: {
    calculado: "integral",
    base: "prazo",
    valorADevolver: 182400,
    integralAte: "2026-10-26",
    arrependimentoAte: "2026-10-08",
    entradaEm: new Date("2026-11-09T18:00:00Z"),
    comecou: false,
  },
  direito: "integral",
  base: "prazo",
  rota: "pedida",
  valorPago: 182400,
  valorADevolver: 182400,
  valorRetido: 0,
  recebidoEm: new Date("2026-10-01T15:30:00Z"),
  canal: "whatsapp",
  politica: { versao: 2, data: "2026-09-20", diasReembolsoIntegral: 14, arrependimentoAteEntrada: true },
  componentes: { comissao: 27090, parteProprietario: 153504, taxa: 1806, jaRepassada: [], perdaDoProprietario: 0, ajustes: [] },
  leitura: { em: new Date("2026-10-01T15:06:00Z"), situacao: "aprovado", devolvidoLido: 0, emAndamento: false },
  descartados: [],
  avisos: ["Este imóvel não tem horário de entrada cadastrado: vale o padrão 15:00.", LEITURA],
  assinatura: "0123456789abcdef",
  pergunta: "Cancelar a reserva SCL-TESTE1 e devolver ao hóspede R$ 1.824,00 (o valor integral pago) pelo Mercado Pago?",
  ...over,
});

describe("a prévia do cancelamento na tela (M8.2c)", () => {
  it("integral pela política: o momento e o canal, a política com os prazos, o resultado, os componentes, como sai e a leitura separada dos avisos", () => {
    const t = previaParaTela(previa());
    expect(t).toMatchObject({ assinatura: "0123456789abcdef", rota: "pedida", direito: "integral", calculado: "integral", escolha: null, leitura: LEITURA });
    expect(t.pergunta).toContain("R$ 1.824,00");
    expect(t.momento).toBe("Pedido recebido em 01/10 às 12:30 (WhatsApp).");
    expect(t.politica).toBe("Política aceita: versão 2 de 20/09 — reembolso integral para pedidos até 26/10 (23:59); arrependimento até 08/10, ou até a entrada.");
    expect(t.resultado).toBe("Pela política: devolução integral de R$ 1.824,00 — pedido dentro do prazo de reembolso integral.");
    expect(t.componentes).toEqual(["Parte do proprietário: R$ 1.535,04 (sai do financeiro).", "Comissão da SCL: R$ 270,90 (sai do financeiro).", "Taxa do Mercado Pago: R$ 18,06."]);
    expect(t.comoSai).toBe("Como a devolução sai: pelo Mercado Pago agora.");
    expect(t.avisos).toEqual(["Este imóvel não tem horário de entrada cadastrado: vale o padrão 15:00."]);
  });

  it("sem devolução: a parte fica (dividida como uma reserva normal), o valor retido, nenhuma rota; taxa ainda não informada", () => {
    const t = previaParaTela(
      previa({
        decisao: { ...previa().decisao, calculado: "nenhum", base: "fora_do_prazo", valorADevolver: 0 },
        direito: "nenhum",
        base: "fora_do_prazo",
        rota: "nenhuma",
        valorADevolver: 0,
        valorRetido: 182400,
        componentes: { ...previa().componentes, taxa: null },
      }),
    );
    expect(t.calculado).toBe("nenhum");
    // A tela oferece a exceção (a mesma regra das recusas do domínio).
    expect(t.escolha).toBe("excecao");
    expect(t.resultado).toBe("Pela política: sem devolução — pedido depois do prazo de reembolso integral.");
    expect(t.componentes).toContain("Parte do proprietário: R$ 1.535,04 (fica, dividida como uma reserva normal).");
    expect(t.componentes).toContain("Taxa do Mercado Pago: ainda não informada.");
    expect(t.componentes).toContain("Valor retido: R$ 1.824,00 (o que o hóspede pagou).");
    expect(t.comoSai).toBeNull();
  });

  it("exceção: o que a política daria e a exceção; a perda do proprietário, a parte já repassada, os ajustes e a rota de mais de 78 dias", () => {
    const t = previaParaTela(
      previa({
        decisao: { ...previa().decisao, calculado: "nenhum", base: "fora_do_prazo", valorADevolver: 0 },
        base: "excecao",
        rota: "fora_do_prazo",
        componentes: {
          ...previa().componentes,
          perdaDoProprietario: 153504,
          jaRepassada: [{ lancamentoId: "l1", valor: 50000, repasseId: "r1", repasse: "2026-10-05", pagoEm: "2026-10-05" }],
          ajustes: [{ id: "a1", descricao: "Ajuste de limpeza", valor: -5000 }],
        },
      }),
    );
    expect(t.resultado).toBe("Pela política: sem devolução — pedido depois do prazo de reembolso integral. Por exceção: devolução integral de R$ 1.824,00.");
    expect(t.componentes).toContain("Já repassado ao proprietário: R$ 500,00 (desconto lançado agora, sai do próximo repasse).");
    expect(t.componentes).toContain("O proprietário deixa de receber: R$ 1.535,04.");
    expect(t.componentes).toContain("Ajustes desta reserva (não mexidos): Ajuste de limpeza (-R$ 50,00).");
    expect(t.comoSai).toBe("Como a devolução sai: pelo painel do Mercado Pago ou por fora (mais de 78 dias).");
  });

  it("sem política aceita: o sistema não calcula e a decisão é da equipe; a SCL cancela e o não comparecimento contam 'agora'", () => {
    const sem = previaParaTela(previa({ decisao: { ...previa().decisao, calculado: "sem_politica", base: "sem_politica", integralAte: null, arrependimentoAte: null }, base: "sem_politica", politica: null }));
    expect(sem.calculado).toBe("sem_politica");
    expect(sem.escolha).toBe("sem_politica");
    expect(sem.politica).toBeNull();
    expect(sem.resultado).toBe("Sem política aceita: o sistema não calcula. Decisão da equipe: devolução integral de R$ 1.824,00.");
    expect(previaParaTela(previa({ base: "empresa", canal: null })).momento).toBe("A SCL cancela agora (01/10 às 12:30).");
    expect(previaParaTela(previa({ base: "nao_comparecimento", direito: "nenhum", rota: "nenhuma", canal: null })).momento).toBe("Não comparecimento registrado agora (01/10 às 12:30).");
    expect(previaParaTela(previa({ rota: "ja_devolvida" })).comoSai).toBe("Como a devolução sai: já devolvida no Mercado Pago.");
  });

  it("o resultado depois de cancelar: retida, confirmada (também a já devolvida e a por fora), recusada pelo prazo ou pelo Mercado Pago, e pedida", () => {
    expect(resultadoDoCancelamento({ direito: "nenhum", devolucao: null }, "nenhuma")).toBe("retida");
    expect(resultadoDoCancelamento({ direito: "integral", devolucao: "confirmada" }, "ja_devolvida")).toBe("confirmada");
    expect(resultadoDoCancelamento({ direito: "integral", devolucao: "por_fora" }, "pedida")).toBe("confirmada");
    expect(resultadoDoCancelamento({ direito: "integral", devolucao: "recusada" }, "fora_do_prazo")).toBe("fora_do_prazo");
    expect(resultadoDoCancelamento({ direito: "integral", devolucao: "recusada" }, "pedida")).toBe("recusada");
    expect(resultadoDoCancelamento({ direito: "integral", devolucao: "pedida" }, "pedida")).toBe("pedida");
    expect(resultadoDoCancelamento({ direito: "integral", devolucao: "incerta" as never }, "")).toBe("pedida");
  });

  it("o texto do resultado vem só de chaves conhecidas (o endereço nunca escreve na tela)", () => {
    expect(textoDoResultado("pedida")).toBe(RESULTADOS_DO_CANCELAMENTO.pedida);
    expect(textoDoResultado("retida")).toBe("Reserva cancelada sem devolução: o valor fica retido e dividido como uma reserva normal.");
    expect(textoDoResultado("<script>")).toBeNull();
    expect(textoDoResultado("toString")).toBeNull();
    expect(textoDoResultado(["pedida"])).toBeNull();
    expect(textoDoResultado(undefined)).toBeNull();
  });
});
