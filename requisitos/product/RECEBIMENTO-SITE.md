# Recebimento das reservas do site — comparação (M8.0; decidido em 4/10/2026, ver "Decisão de Diego")

**Situação:** proposta do Claude em 25/09/2026; **decidido por Diego em 4/10/2026** (ver "Decisão
de Diego"): mantém "empresa recebe e repassa", pelo Mercado Pago com o checkout no próprio site; o
contador confirmou que só a comissão é receita da SCL; o repasse segue a periodicidade escolhida
pelo proprietário (M4.10). Histórico: em 24/09 Diego decidiu que, no site, a empresa recebe e
repassa; depois perguntou se dava para fazer como o Airbnb (split), e este documento comparou as
opções. Taxas tiradas de fontes públicas (setembro e 4/10/2026), **a conferir** na hora de abrir
a conta (mudam por plano, prazo de recebimento e negociação). Continuam pendentes só as perguntas
3, 4 e 5 (taxa do pagamento, contestação perdida, política de cancelamento), antes do pagamento de
verdade.

## A pergunta

Quando o hóspede paga uma reserva no site (M8), para onde vai o dinheiro?

1. **Empresa recebe e repassa:** o hóspede paga à SCL; a SCL fica com a comissão e repassa a
   parte do proprietário (como já acontece hoje com Booking e reservas diretas).
2. **Split automático (como no Airbnb):** no momento do pagamento, o próprio meio de
   pagamento divide: a parte do proprietário cai na conta dele e a comissão, na da SCL.
   - 2a. **Mercado Pago "split de pagamentos" (marketplace).**
   - 2b. **Stripe Connect** ("destination charges"): parecido, mas o pagamento entra primeiro
     na conta da SCL no Stripe e a parte do proprietário é transferida automaticamente em
     seguida — ou seja, o dinheiro passa pela SCL.

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
| Dinheiro de terceiros passa pela SCL? | **Sim** (tudo entra na conta da SCL) | **Não** (a parte do proprietário vai direto para ele) | **Sim**, com "destination charges": a cobrança entra na conta da SCL no Stripe e o Stripe transfere, automaticamente, a parte do proprietário para a conta dele |
| O proprietário precisa de… | Nada (só a chave Pix, que já está no cadastro) | **Conta Mercado Pago** ligada ao sistema (autorização renovada a cada 6 meses) | **Conta Stripe** (cadastro com documentos no Stripe) |
| Estorno / cancelamento | SCL devolve ao hóspede e desconta do repasse. Hoje, cancelar uma reserva já paga só gera aviso para ajuste manual (o sistema não mexe no que já foi realizado); o M8.2 passa a lançar a devolução no financeiro | Precisa definir no split quanto volta de cada parte; **a conferir** o comportamento em estorno parcial | SCL devolve e recupera do proprietário pela transferência reversa |
| Chargeback (contestação no cartão) | O provedor debita da SCL; **se** ela repassa a perda ao proprietário (pelo repasse) é decisão de Diego, a pôr no contrato | **A conferir** como o MP divide; exige regra no contrato | O Stripe debita da SCL (ela é a responsável perante o Stripe); repassar ao proprietário é a mesma decisão |
| Trabalho no sistema | **Parte financeira pronta só para o fechamento mensal** (comissão, repasse mensal com Pix para copiar — M4.9, conferência — M4.8; hoje o cancelamento de reserva já paga vira aviso para ajuste manual); o repasse em periodicidade menor que a mensal, o extrato e o e-mail por repasse são o **M4.10** (decisão de 4/10). Falta, como em qualquer opção, o pagamento em si (M8.2): checkout, aviso de pagamento, devolução ao hóspede pelo Mercado Pago com os lançamentos da devolução no financeiro, cobrança ou devolução da diferença quando uma reserva paga muda de valor, conciliação e o fluxo de contestação (chargeback) no financeiro | Tudo do M8.2 **e mais**: ligar a conta de cada proprietário, comissão em cada pagamento, estorno dividido, conciliação por proprietário | Tudo do M8.2 **e mais** a integração Connect; mais cara e menos usada no Brasil |
| Repasse ao proprietário | Decidido em 4/10: mensal no dia 1º por padrão (intervalo máximo), ou quinzenal, semanal ou assim que disponível, à escolha do proprietário no portal (M4.10); reserva do site disponível só depois do check-in e da liberação pelo provedor | Automático, quando o provedor libera | Automático, quando o provedor libera |
| Quando o dinheiro fica disponível | Pix: no mesmo dia. Cartão: na hora (taxa ~4,98%) ou em 30 dias (~3,98%) | Igual ao lado | Conforme o prazo do Stripe (a conferir) |

## Impostos (pergunta levada ao contador; confirmado por Diego em 4/10/2026)

- **O ponto principal:** se o dinheiro todo entra na conta da SCL, a Receita e a prefeitura
  podem entender que a receita da SCL é o valor total, e não só a comissão. Na intermediação
  bem documentada (contrato de administração/intermediação, repasse identificado, nota fiscal
  só da comissão), a empresa costuma tributar **só a comissão**. Era isso que o contador
  precisava confirmar para o caso da SCL; **confirmado** (Diego, 4/10/2026): só a comissão é
  receita da SCL, o restante é valor de terceiros que passa pela empresa.
- No **split do Mercado Pago**, a parte do proprietário cai direto na conta dele — a
  separação fica mais clara (ainda assim, confirmar com o contador se um dia for adotado).
- No **Stripe Connect com "destination charges"**, a cobrança entra na conta da SCL antes da
  transferência ao proprietário: a dúvida é a mesma do "empresa recebe e repassa" e precisa
  da mesma confirmação do contador.
- **Reforma tributária (IBS/CBS):** as regras para locação por temporada e intermediação
  imobiliária estão mudando a partir de 2026–2027; vale perguntar ao contador como fica cada
  modelo nos próximos anos.

## Recomendação

1. **Começar com "empresa recebe e repassa", pelo Mercado Pago** (Pix e cartão com os
   componentes de checkout no próprio site — Checkout Bricks/Transparente, decisão de 4/10; não
   a página externa do Checkout Pro). Motivos: a parte financeira já existe (é o mesmo caminho do Booking e das diretas:
   comissão, repasse mensal, Pix para copiar e conferência), o
   proprietário não precisa abrir conta em lugar nenhum, e a integração do pagamento (M8.2 —
   checkout, aviso de pagamento, devolução ao hóspede com os lançamentos da devolução e conciliação, que qualquer opção
   exige) fica menor, então dá para começar a vender pelo site mais cedo.
   Condição (cumprida em 4/10/2026): o contador confirmou que, com o contrato e as notas
   certas, a SCL tributa só a comissão.
2. **Marketplace: "empresa recebe e repassa" também, sem split** (decisão de Diego em
   4/10/2026). Histórico: a recomendação de 24/09 era deixar o split do Mercado Pago para o
   marketplace, quando entrassem proprietários que cuidam da própria operação e esperam
   receber na hora; com o extrato e as periodicidades do M4.10 (inclusive "assim que
   disponível"), esse motivo deixou de existir, e o split fica descartado por ora.
3. **Stripe Connect só se** um dia houver hóspedes/proprietários de fora do Brasil em volume:
   no Brasil ele é mais caro, o Pix é só por convite e a SCL responde pelos chargebacks do mesmo jeito.

Qualquer que seja a escolha, **antes de implementar o M8.2** as regras "a conferir" da tabela
(como o provedor desconta a taxa, estorno parcial e contestação — no split, quanto sai de
cada parte) precisam ser confirmadas com o próprio provedor, para o financeiro lançar os
valores certos. Se a escolha for **split** (Mercado Pago ou Stripe), também é preciso confirmar
a **verificação de identidade (KYC)** de cada proprietário no provedor — se aceita pessoa
física e empresa, quais documentos pede, como a conta fica ativa e como se renova a
autorização — de preferência abrindo a conta de um proprietário real antes de programar.

O sistema já guarda, por reserva, "quem recebe do canal" (`split` ou `empresa`): as duas
formas cabem no financeiro sem mudança de regra — a escolha define **com qual provedor** e
**de que jeito** o M8.2 é construído (e de quem são as credenciais de teste que Diego precisa
criar).

## Decisão de Diego (4/10/2026)

- **Modelo:** mantém **"empresa recebe e repassa"**, pelo Mercado Pago, com os componentes de
  checkout no próprio site (Checkout Bricks/Transparente, Pix e cartão — ver "Checkout e
  comparação rápida de provedores"; a página externa do Checkout Pro fica descartada por não
  atender ao pedido de Diego de 4/10). Motivo
  dele: é mais simples; a SCL é só a ponte entre hóspede e proprietário.
- **Contador:** já confirmado por Diego: só a comissão é receita da SCL; o restante é valor de
  terceiros que passa pela empresa e vai ao proprietário.
- **Prazo do repasse (pergunta 6):** o fechamento mensal do dia 1º continua sendo o padrão e
  o intervalo máximo; o proprietário pode escolher no portal receber quinzenalmente,
  semanalmente ou **assim que disponível** (dia seguinte ao check-in, com o dinheiro já
  liberado pelo provedor). Uma reserva do site só conta como **disponível** depois do check-in
  **e** da liberação: antes disso é saldo "a liberar", para não pagar e depois ter de pedir de
  volta num cancelamento. A SCL não adianta e não troca de plano de liberação só por isso. Pix
  é liberado na hora; cartão depende do plano do Mercado Pago (na hora, 14 ou 30 dias, com
  taxas diferentes), a confirmar nos termos vigentes antes do M8.2. O fluxo de hoje (M4.9) só
  faz o fechamento mensal; o extrato, as periodicidades, o e-mail com comprovante por repasse
  e a conciliação com o fechamento (repasse fora do fechamento é adiantamento vinculado às
  reservas; reserva que atravessa o mês é paga no check-in e se acerta no fechamento seguinte)
  são o item **M4.10** do ROADMAP. O M8.2 registra a data de liberação de cada pagamento.
- **Continuam pendentes** (perguntas 3, 4 e 5): taxa do cartão/Pix (vale a regra atual até
  decisão contrária), contestação perdida e política de cancelamento. Nenhuma impede o M8.2 em
  sandbox; todas precisam estar decididas antes de o site receber pagamento de verdade.
- **Pedido novo de Diego:** documento "como funciona" para o proprietário (inclusive quando e
  como recebe) com aceite registrado, e páginas legais do site com aceite no checkout: itens
  M5.6 e M7.4 do ROADMAP.
- **Marketplace (4/10/2026, mesma conversa):** também "empresa recebe e repassa", sem split
  do Mercado Pago, com o extrato e as periodicidades do M4.10. E **um modelo por contrato,
  nunca por reserva**: imóvel de gestão total que vender pelo site continua com a comissão do
  contrato (sobre o valor líquido da taxa do pagamento); o desconto do hóspede é regra única
  do site, igual para gestão total e marketplace.

## Checkout e comparação rápida de provedores (pedido de Diego, 4/10/2026)

**Checkout (M8.2).** Diego pediu que a tela de pagamento do site dê a escolha entre **Pix** e
**cartão de crédito**:

- **Pix:** QR code e código "copia e cola" com botão de copiar, na própria página; a reserva
  confirma sozinha quando o aviso do provedor (webhook) chega. Liberado na hora e com a menor
  taxa — deve ser a opção em destaque.
- **Cartão:** formulário no próprio checkout, com a marca do Mercado Pago visível; os dados do
  cartão nunca passam pelo servidor da SCL (tokenizados pelo componente do provedor — Checkout
  Bricks/Transparente; a página externa do Checkout Pro não dá esse controle de tela).
  **Parcelamento — decidido por Diego em 4/10/2026: sim, com os juros pagos pelo hóspede**
  ("parcelamento com juros"); a SCL não assume o "sem juros", em que o provedor cobra do vendedor
  um acréscimo por parcela, que cresce com o número de parcelas. O número máximo de parcelas fica
  configurável no painel (padrão: o máximo que o Mercado Pago permitir).

**Provedores** (fontes públicas consultadas em 4/10/2026; valores **aproximados e a confirmar**
na abertura da conta — mudam por plano, prazo de recebimento, volume e negociação):

| Provedor | Pix | Cartão de crédito à vista (venda online) | Cartão emitido fora do Brasil | Observações |
|---|---|---|---|---|
| Mercado Pago | 0,99% | 3,98% (30 dias), 4,49% (14 dias), 4,98% (na hora) | a confirmar com o Mercado Pago (bandeiras aceitas e recusa de cartões de fora) | sandbox e componentes de checkout com Pix e cartão prontos; conta de Diego já existe |
| Stripe | 1,19%, **só por convite** para empresas no Brasil | 3,99% + R$ 0,39 | + 2% (e taxa de conversão se cobrar em outra moeda) | o mais forte para cartão de fora; Pix não garantido |
| PagBank (PagSeguro) | 1,89% | 3,19% (30 dias), 3,99% (14 dias), 4,99% (na hora), + R$ 0,40 por venda online | a confirmar | Pix mais caro que os demais |
| Pagar.me (Stone) | 0,99% | ~4,19% de tabela; negociável por volume | a confirmar | voltado a contrato e negociação |
| Asaas | valor fixo por Pix recebido (R$ 1,99 na tabela pública) | 2,99% + R$ 0,49 (prazo de recebimento a confirmar) | a confirmar | plataforma de cobrança (boleto, Pix, link); componente de checkout dentro do site a conferir |

**Leitura.** (1) O que pesa é o **Pix**: ~1% contra ~4% do cartão — numa reserva de R$ 1.000
são ~R$ 30 de diferença, por isso o checkout destaca o Pix. (2) Entre provedores, o cartão à
vista varia cerca de 1 ponto percentual no mesmo prazo (3,2%–4,2% em 30 dias; 4,2%–5% na hora):
~R$ 8–12 por reserva de R$ 1.000 — relevante com volume, não decisivo agora. (3) Cartão de
fora do Brasil: o Stripe é o mais forte, mas custa +2% e não garante Pix; no Mercado Pago a
aceitação precisa ser confirmada. (4) **Decisão de Diego (4/10/2026): Mercado Pago para Pix e cartão no M8.2,
com as taxas padrão** (conta existente, sandbox, componentes com Pix e cartão); propostas de
outros provedores e troca só mais à frente, se compensar — não é obrigação; o provedor fica
atrás de um adaptador para trocar ou somar outro (por exemplo, Stripe só para cartão de fora)
quando houver volume real. Na mistura Pix/cartão, o Mercado Pago empata ou ganha do PagBank
(Pix 0,99% × 1,89%). (5) **Pix direto pelo banco, descartado por ora:** o Itaú cobra do PJ
~1,45% por Pix recebido (chave ou QR, teto R$ 150), mais que o Mercado Pago; o Nubank PJ não
cobra Pix, mas não há API oficial de integração confirmada; chave Pix fixa com botão de copiar
não serve como caminho principal (sem confirmação automática nem casamento com a reserva, o
hold do M8.1 não fecha) — só como plano B manual. QR dinâmico com prazo igual ao do hold é o
caminho, pelo provedor.

## O que Diego precisava decidir (perguntas originais)

1. Modelo: **manter "empresa recebe e repassa"** (decisão de 24/09, recomendado) × mudar para
   **split Mercado Pago** × **Stripe Connect**.
2. Levar ao contador: "a SCL recebendo o valor total da reserva do site e repassando ao
   proprietário, com contrato de intermediação, tributa só a comissão?" — a mesma pergunta
   vale para o Stripe Connect (o dinheiro também passa pela SCL); no split do Mercado Pago,
   pedir que confirme que a parte do proprietário não conta como receita da SCL.
3. Taxa do cartão/Pix nas reservas do site: manter a regra atual (sai antes da divisão, cada
   um na proporção — como a taxa do Airbnb/Booking) ou mudar (só SCL ou só proprietário).
4. Contestação de cartão (chargeback) perdida: quem arca — a SCL, o proprietário ou os dois na
   proporção. O provedor só diz de que conta sai o dinheiro; quem assume a perda é regra de
   negócio (vai no contrato). Até decidir, o sistema só registra e avisa.
5. Política de cancelamento das reservas do site: reembolso total, parcial ou nenhum conforme
   a antecedência, e quem arca com a taxa do pagamento que não volta. Sem ela, o sistema não
   calcula reembolso sozinho.
6. **Respondida em 4/10/2026 (opção (a), ver "Decisão de Diego"; fica só como histórico).**
   Cartão com recebimento em 30 dias: uma reserva paga no fim do mês entraria no repasse do
   dia 1º antes de o Mercado Pago liberar o dinheiro. Opções: (a) repassar só quando o
   dinheiro for liberado (a parte do proprietário vai para o repasse seguinte), (b) a SCL
   adianta, ou (c) usar o recebimento na hora e pagar a taxa maior. Sem decisão, o sistema faz
   (a).

As perguntas 3, 4 e 5 não impedem montar o pagamento em teste (M8.2 em sandbox), mas precisam
estar respondidas antes de o site receber pagamentos de verdade. As perguntas 1, 2 e 6 já foram
respondidas (4/10/2026) e ficam aqui só como histórico.

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

## Fontes consultadas (4/10/2026, comparação rápida de provedores)

- Mercado Pago — "Quanto custa vender online com Mercado Pago" (blog) e "Checkout Pro: como
  configurar parcelamento sem juros" (blog): taxas por prazo de recebimento, Pix 0,99%, custo
  do parcelamento sem juros por conta do vendedor.
- Stripe — "Local payment methods pricing" e "Pricing" (Brasil): cartão 3,99% + R$ 0,39, +2%
  para cartão internacional, Pix 1,19% por convite.
- PagBank — "Taxas, planos e tarifas para seu negócio" e tabela de taxas 2026 em
  calculadoradetaxas.com.br.
- Pagar.me — página de ofertas e comparativo de gateways 2026 (Mind Group).
- Asaas — "Taxas Asaas: pague apenas por cobrança recebida" (blog).
