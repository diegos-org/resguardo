# Marketplace — precificação (decidido por Diego em 4/10/2026: modelo B, partes iguais)

**Situação:** proposta do Claude em 24/09/2026; **decisão de Diego em 4/10/2026: modelo B, em
partes iguais** (a margem, taxa do Airbnb menos a taxa do pagamento, dividida igualmente entre
desconto ao hóspede, ganho do proprietário e SCL), com os três pesos e as taxas de referência
editáveis no painel e a tela de simulação (item M12.1 do ROADMAP). Diego está testando os
números num simulador e pode ajustar os pesos antes ou depois de implementado. As fórmulas
antigas do Diego não foram encontradas no repositório nem no histórico.

## Objetivo (Diego)

Na reserva direta pelo site da SCL, ao mesmo tempo:
1. o **hóspede paga menos** do que pagaria na OTA;
2. o **proprietário recebe mais** do que receberia na OTA;
3. a **SCL ganha** o suficiente para valer a pena (ela cuida de toda a parte online; o
   proprietário cuida da operação física: limpeza, reposição, chaves).

## De onde sai o dinheiro

A OTA fica com uma fatia grande de cada reserva. Na reserva direta essa fatia some, mas
aparece o custo do pagamento com cartão/Pix. **A sobra entre as duas coisas é o que dá para
dividir** entre hóspede, proprietário e SCL.

Percentuais aproximados, **a conferir** antes de decidir (mudam por país, tipo de conta e
contrato):
- Airbnb, "taxa dividida": o hóspede paga cerca de **14%** a mais e o anfitrião cede cerca
  de **3%**. (Na "taxa só do anfitrião", o anfitrião cede cerca de 15%.)
- Booking: o anfitrião paga cerca de **15%** de comissão; o hóspede não paga taxa extra.
- Pagamento no site (Mercado Pago/Stripe): cerca de **4–5%** do valor pago pelo hóspede.

## Exemplo usado nas contas

3 noites a R$ 500 + limpeza R$ 150 = **R$ 1.650** (preço do proprietário).

| No Airbnb (taxa dividida) | Valor |
|---|---|
| Hóspede paga | R$ 1.881 |
| Proprietário recebe | R$ 1.600 |
| Airbnb fica com | R$ 281 |

## Três modelos

### Modelo A — "Taxa de serviço menor"
O hóspede paga o preço do proprietário **+ 8%** de taxa SCL. O proprietário recebe **100%**
do preço dele. A SCL fica com a taxa, menos o custo do pagamento.

| | Valor | Contra o Airbnb |
|---|---|---|
| Hóspede paga | R$ 1.782 | −R$ 99 (−5%) |
| Proprietário recebe | R$ 1.650 | +R$ 50 (+3%) |
| Pagamento (≈4,5%) | R$ 80 | |
| **SCL fica com** | **R$ 52** (≈3% da reserva) | |

Simples de explicar; margem da SCL apertada.

### Modelo B — "Dividir a economia em três" (sugestão)
Calcula o que a OTA levaria, desconta o custo do pagamento e **divide o que sobra em três
partes iguais**: uma vira desconto para o hóspede, uma vira ganho para o proprietário, uma
fica com a SCL.

| | Valor | Contra o Airbnb |
|---|---|---|
| Hóspede paga | R$ 1.815 | −R$ 66 (−3,5%) |
| Proprietário recebe | R$ 1.667 | +R$ 66 (+4%) |
| Pagamento (≈4,5%) | R$ 82 | |
| **SCL fica com** | **R$ 66** (≈4% da reserva) | |

Justo e fácil de defender ("todo mundo ganha a mesma coisa"). Os três pesos podem ser
ajustados (ex.: 40% hóspede / 30% proprietário / 30% SCL).

### Modelo C — "Mensalidade + preço limpo"
O proprietário paga uma **mensalidade fixa** por imóvel (ex.: R$ 150/mês) pela parte online.
O hóspede paga o preço + só o custo do pagamento; o proprietário recebe 100%.

| | Valor | Contra o Airbnb |
|---|---|---|
| Hóspede paga | R$ 1.728 | −R$ 153 (−8%) |
| Proprietário recebe | R$ 1.650 (menos a mensalidade no mês) | +R$ 50 |
| **SCL fica com** | a mensalidade, com ou sem reservas | |

Melhor preço para o hóspede e receita previsível para a SCL; o proprietário com poucas
reservas pode achar caro.

## Recomendação

Começar pelo **Modelo B**, com os pesos e percentuais **editáveis no painel** (princípio
"tudo editável"), e uma tela de **simulação**: você digita a diária, as noites e a limpeza e
vê lado a lado Airbnb, Booking e SCL. Assim dá para testar com números reais antes de
fechar. Se a margem ficar baixa, dá para combinar B com uma mensalidade pequena (C).
**Adotada por Diego em 4/10/2026**, com partes iguais.

## Conferências que continuam pendentes (não impedem o M12.1, porque tudo fica editável)

- Conferir os percentuais reais das contas (Airbnb, Booking, Mercado Pago/Stripe).
- Conferir nos contratos das OTAs se há regra de **paridade de preço** (preço mais baixo
  no site próprio) que se aplique aos anúncios.
- Decidir se proprietários do marketplace também anunciam nas OTAs pela SCL (Beds24) e se
  a SCL cobra algo sobre essas reservas.
- **Forma de recebimento do marketplace:** decidido por Diego em 4/10/2026, empresa recebe e
  repassa (sem split), como o site, com o extrato e as periodicidades do M4.10.
- Reservas do site em imóveis de **gestão total**: decidido por Diego em 4/10/2026, um modelo
  por contrato, nunca por reserva: a comissão do contrato vale em todos os
  canais, inclusive o site, sobre o valor líquido da taxa do pagamento; o desconto do hóspede
  no site é uma regra única do site, igual para gestão total e marketplace.
