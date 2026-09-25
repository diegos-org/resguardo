# Recebimento das reservas do site — comparação para Diego decidir (M8.0)

**Situação:** proposta do Claude em 25/09/2026. **Nada disto é decisão ainda.** Taxas tiradas de
fontes públicas em setembro/2026 e **a conferir** na hora de abrir a conta (mudam por plano,
prazo de recebimento e negociação). A parte de impostos **precisa do contador**.

## A pergunta

Quando o hóspede paga uma reserva no site (M8), para onde vai o dinheiro?

1. **Empresa recebe e repassa:** o hóspede paga à SCL; a SCL fica com a comissão e repassa a
   parte do proprietário (como já acontece hoje com Booking e reservas diretas).
2. **Split automático (como no Airbnb):** no momento do pagamento, o próprio meio de
   pagamento divide: a parte do proprietário cai na conta dele e a comissão, na da SCL.
   - 2a. **Mercado Pago "split de pagamentos" (marketplace).**
   - 2b. **Stripe Connect.**

## Exemplo

Reserva de **R$ 1.650** (3 noites a R$ 500 + limpeza R$ 150), comissão SCL de **20%**.

Pela regra que já está no sistema (Diego, 24/09), a comissão é calculada **depois da taxa do
canal** — no site, a taxa do pagamento faz esse papel. Então a taxa sai antes da divisão e
cada um arca com a sua proporção:

| Pagamento | Taxa (aprox.) | Base (R$ 1.650 − taxa) | Comissão SCL (20%) | Proprietário (80%) |
|---|---|---|---|---|
| Cartão, recebendo em 30 dias (3,98%) | R$ 65,67 | R$ 1.584,33 | R$ 316,87 | R$ 1.267,46 |
| Cartão, recebendo na hora (4,98%) | R$ 82,17 | R$ 1.567,83 | R$ 313,57 | R$ 1.254,26 |
| Pix (0,99%) | R$ 16,34 | R$ 1.633,66 | R$ 326,73 | R$ 1.306,93 |

Se Diego preferir outra divisão da taxa (só a SCL, ou só o proprietário), é uma **mudança de
regra** a decidir — a comparação abaixo vale igual.

| | Empresa recebe e repassa (Mercado Pago) | Split Mercado Pago | Split Stripe Connect |
|---|---|---|---|
| Taxa do cartão (aprox.) | 3,98% (recebe em 30 dias) a 4,98% (na hora) ≈ R$ 66–82 | igual ao lado ≈ R$ 66–82 | 3,99% + R$ 0,39 ≈ R$ 66, mais custos do Connect (a conferir) |
| Taxa no Pix (aprox.) | 0,99% ≈ R$ 16 | 0,99% ≈ R$ 16 | 1,19% ≈ R$ 20 — **Pix no Stripe Brasil é só por convite** |
| Quem paga a taxa | Pela regra atual, sai antes da divisão (na proporção, como acima) | A regra atual vale igual; **a conferir** como o MP desconta a taxa no split | O Stripe cobra da SCL (plataforma); a SCL desconta do proprietário na proporção |
| Dinheiro de terceiros passa pela SCL? | **Sim** (tudo entra na conta da SCL) | **Não** (a parte do proprietário vai direto para ele) | Não, mas a SCL é a "vendedora" perante o Stripe |
| O proprietário precisa de… | Nada (só a chave Pix, que já está no cadastro) | **Conta Mercado Pago** ligada ao sistema (autorização renovada a cada 6 meses) | **Conta Stripe** (cadastro com documentos no Stripe) |
| Estorno / cancelamento | SCL devolve ao hóspede e desconta do repasse (o sistema já faz estorno e ajuste) | Precisa definir no split quanto volta de cada parte; **a conferir** o comportamento em estorno parcial | SCL devolve e recupera do proprietário pela transferência reversa |
| Chargeback (contestação no cartão) | Cai na SCL; a SCL cobra do proprietário pelo repasse | **A conferir** como o MP divide; exige regra no contrato | Cai na SCL (ela é a responsável perante o Stripe) |
| Trabalho no sistema | **Parte financeira pronta** (comissão, repasse mensal com Pix para copiar — M4.9, estorno no financeiro e conferência — M4.8). Falta, como em qualquer opção, o pagamento em si (M8.2): checkout, aviso de pagamento, devolução ao hóspede pelo Mercado Pago e conciliação | Tudo do M8.2 **e mais**: ligar a conta de cada proprietário, comissão em cada pagamento, estorno dividido, conciliação por proprietário | Tudo do M8.2 **e mais** a integração Connect; mais cara e menos usada no Brasil |
| Repasse ao proprietário | Mensal, dia 1º (feito à mão, com Pix para copiar) | Automático, a cada pagamento | Automático |

## Impostos (para o contador confirmar)

- **O ponto principal:** se o dinheiro todo entra na conta da SCL, a Receita e a prefeitura
  podem entender que a receita da SCL é o valor total, e não só a comissão. Na intermediação
  bem documentada (contrato de administração/intermediação, repasse identificado, nota fiscal
  só da comissão), a empresa costuma tributar **só a comissão**. É isso que o contador precisa
  confirmar para o caso da SCL.
- No **split**, isso fica mais claro por natureza: a parte do proprietário nunca é da SCL.
- **Reforma tributária (IBS/CBS):** as regras para locação por temporada e intermediação
  imobiliária estão mudando a partir de 2026–2027; vale perguntar ao contador como fica cada
  modelo nos próximos anos.

## Recomendação

1. **Começar com "empresa recebe e repassa", pelo Mercado Pago** (Checkout Pro, cartão e
   Pix). Motivos: a parte financeira já existe (é o mesmo caminho do Booking e das diretas:
   comissão, repasse mensal, Pix para copiar, estorno no financeiro e conferência), o
   proprietário não precisa abrir conta em lugar nenhum, e a integração do pagamento (M8.2 —
   checkout, aviso de pagamento, devolução ao hóspede e conciliação, que qualquer opção
   exige) fica menor, então dá para começar a vender pelo site mais cedo.
   Condição: o **contador confirmar** que, com o contrato e as notas certas, a SCL tributa só
   a comissão.
2. **Deixar o split do Mercado Pago para o marketplace (M12)**, quando entrarem proprietários
   que cuidam da própria operação e esperam receber na hora — aí o split compensa o trabalho
   extra de ligar a conta de cada um.
3. **Stripe Connect só se** um dia houver hóspedes/proprietários de fora do Brasil em volume:
   no Brasil ele é mais caro, o Pix é só por convite e a SCL responde pelos chargebacks do mesmo jeito.

O sistema já guarda, por reserva, "quem recebe do canal" (`split` ou `empresa`): as duas
formas cabem no financeiro sem mudança de regra — a escolha define como o M8.2 é construído.

## O que Diego precisa decidir

1. Modelo: **empresa recebe e repassa** (recomendado para começar) × **split Mercado Pago** ×
   **Stripe Connect**.
2. Levar ao contador: "a SCL recebendo o valor total da reserva do site e repassando ao
   proprietário, com contrato de intermediação, tributa só a comissão?".
3. Taxa do cartão/Pix nas reservas do site: manter a regra atual (sai antes da divisão, cada
   um na proporção — como a taxa do Airbnb/Booking) ou mudar (só SCL ou só proprietário).

## Fontes consultadas (setembro/2026)

- Mercado Pago — split de pagamentos (Checkout Pro, Transparente e Bricks; cartão, Pix e
  boleto; comissão em `marketplace_fee`/`application_fee`; vendedor ligado por OAuth,
  renovado a cada 6 meses): blog e documentação para desenvolvedores do Mercado Pago.
- Mercado Pago — taxas 2026 (Pix 0,99%; crédito 3,98% em 30 dias a 4,98% na hora): tabela
  de taxas do Mercado Pago e guias de terceiros.
- Stripe — Pix 1,19% (por convite para empresas no Brasil), cartão nacional 3,99% + R$ 0,39;
  Connect com "destination charges": a plataforma é a vendedora e arca com taxas, reembolsos
  e chargebacks (documentação do Stripe).
- Tributação da temporada e da intermediação (comissão × valor total; reforma tributária):
  matérias e guias de contabilidade de 2026 — **não substituem o contador**.
