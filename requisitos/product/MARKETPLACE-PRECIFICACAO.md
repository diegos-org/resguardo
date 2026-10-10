# Marketplace — precificação (decidido por Diego: modelo B em 4/10/2026; pesos 6/3/3 em 7/10/2026)

**Situação:** proposta do Claude em 24/09/2026; **decisão de Diego em 4/10/2026: modelo B, em
partes iguais** (a margem, taxa do Airbnb menos a taxa do pagamento, dividida igualmente entre
desconto ao hóspede, ganho do proprietário e SCL), com os três pesos e as taxas de referência
editáveis no painel e a tela de simulação (item M12.1 do ROADMAP, **entregue em 4/10/2026** —
ver "Como está implementado", abaixo). **Em 7/10/2026 Diego confirmou os pesos 6/3/3** (da
margem: SCL 6%, hóspede 3%, proprietário 3% — pesos hóspede 1, proprietário 1, SCL 2), que
passam a ser o padrão do sistema no lugar das partes iguais (item M12.5 do ROADMAP). Diego pode
ajustar pesos e taxas a qualquer momento no painel. As fórmulas antigas do Diego não foram encontradas no repositório nem no histórico.

## Como está implementado (M12.1, 4/10/2026)

- **Onde se edita:** Painel → Configurações → **Marketplace e desconto do site** (permissão
  `configuracao:editar`). Taxas de referência em percentual (Airbnb só do anfitrião, Booking só
  para comparação, pagamento no site) e pesos inteiros (hóspede / proprietário / SCL). Gravado
  na configuração da organização (chave `marketplace_precos`), com auditoria. Padrão: 16% /
  15% / 4% e pesos 1/1/2 (hóspede, proprietário, SCL; até o M12.5, 1/1/1).
- **A conta (centavos inteiros, `app/src/marketplace/precos.ts`):** para o valor cheio P
  (diárias + limpeza + hóspede extra):
  margem = P × taxa do Airbnb − P × taxa do pagamento (zero se negativa);
  partes = rateio da margem pelos pesos (sem perder centavo);
  desconto do site = parte do hóspede; hóspede paga = P − desconto;
  taxa do pagamento real = (hóspede paga) × taxa do pagamento;
  SCL = parte da SCL; proprietário recebe = hóspede paga − taxa real − SCL.
  Como a taxa real incide sobre um valor menor que P, a diferença fica com o proprietário
  (ele recebe um pouco mais que a parte dele). Identidade: hóspede paga = taxa + SCL +
  proprietário.
- **Regra única do site:** o desconto vale para qualquer imóvel e qualquer contrato (gestão
  total inclusive). A consulta e a cotação mostram valor cheio, desconto e total; a cotação
  persistida guarda `valor_cheio`, `desconto` e `total` como calculados na hora (mudar a regra
  depois não mexe nela; a revalidação detecta a diferença e pede nova consulta). O pedido de
  "segurar as datas" entra com o total com desconto.
- **Fora do M12.1:** a divisão proprietário/SCL no financeiro do contrato marketplace (M12.2) e
  qualquer escrita em OTA ou provedor de pagamento. A comissão do contrato de gestão total
  continua sendo a do contrato (M4), sobre o que entra.

## Portal do proprietário marketplace (M12.4, 4/10/2026)

Implementado em `app/src/portal/marketplace.ts` (regras e acesso) e
`app/src/components/portal/OperacaoMarketplace.tsx` (tela). Só para imóvel da sessão em contrato
**marketplace** em vigor na data (deny-by-default, no servidor): o proprietário edita preço da
noite, limpeza, hóspede extra, estadia mínima/máxima, antecedência, janela, dias de entrada/saída
e horários — pela mesma `validarDetalhes` do painel, preservando o resto do cadastro — e os
períodos especiais; vê a simulação do modelo B para o preço digitado (`simular`); vê a situação
do envio ao Beds24 (na lista, automático, último envio) em vez de supor que a mudança chegou às
OTAs; com fonte de preços "beds24" (M3.9) o preço da noite é só leitura. Limpezas das saídas dos
imóveis marketplace podem ser marcadas como feitas pelo proprietário (custo 0, sem despesa) e
manutenções feitas por ele são registradas já realizadas, por conta dele. A camada contratual da
promessa de preço (item 2 acima) continua sendo texto de contrato; o portal não a impõe.

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
**Adotada por Diego em 4/10/2026**, com partes iguais; **pesos 6/3/3 confirmados em 7/10/2026**
(padrão do sistema a partir do M12.5).

## Conferências que continuam pendentes (não impedem o M12.1, porque tudo fica editável)

- Conferir os percentuais reais das contas (Airbnb, Booking, Mercado Pago/Stripe).
- Conferir nos contratos das OTAs se há regra de **paridade de preço** (preço mais baixo
  no site próprio) que se aplique aos anúncios.
- **Reservas das OTAs do próprio proprietário — decidido por Diego em 4/10/2026:** a SCL **não
  cobra nada** sobre as reservas que o proprietário do marketplace vende nas OTAs dele (anunciadas
  por ele ou pela SCL via Beds24); o modelo B vale só para o que o site vende. Motivo: quem vende
  1 pelo SCL e 15 pelo Airbnb sairia no mês seguinte se fosse cobrado pelas 15. O M12.2 calcula só
  as reservas do site; as das OTAs ficam no calendário e no extrato sem comissão — se o dinheiro
  delas passar pela empresa (quem recebe = empresa, M2.7), o valor é repassado integral pelo
  M4.10; se o canal pagar o proprietário direto, é só informação. Ideia de
  Diego para estudo (não é compromisso): **assinatura modular** — uma base e serviços opcionais
  que o proprietário escolhe e paga à parte (ex.: motor de preços da SCL, M3.9) — registrada em
  `requisitos/growth/ROADMAP.md`.
- **Forma de recebimento do marketplace:** decidido por Diego em 4/10/2026, empresa recebe e
  repassa (sem split), como o site, com o extrato e as periodicidades do M4.10.
- Reservas do site em imóveis de **gestão total**: decidido por Diego em 4/10/2026, um modelo
  por contrato, nunca por reserva: a comissão do contrato de gestão total vale em todos os
  canais, inclusive o site, sobre o valor líquido da taxa do pagamento (no marketplace, o modelo
  B vale só para o que o site vende — item acima); o desconto do hóspede
  no site é uma regra única do site, igual para gestão total e marketplace.

## Promessa de preço abaixo das plataformas — decisões de Diego em 4/10/2026

- **Comunicação genérica:** "pague menos que no Airbnb" (o Booking nem precisa ser citado), sem
  garantia absoluta de "melhor preço". Exceção rara e não consistente é aceitável; se virar
  algo sério, a regra é repensada.
- **Três camadas de garantia** para o marketplace que define preço no Beds24 (M3.9):
  1. automática: o desconto do site é aplicado sobre o preço lido do Beds24, que é o preço que
     o Beds24 manda às OTAs; o proprietário não tem como desligar o desconto;
  2. contratual (entra no M12.3/M12.4): os preços das OTAs vêm do Beds24 ou do motor do SCL;
     preço inteligente do Airbnb desligado; nenhuma promoção dentro das OTAs que deixe a OTA
     mais barata que o preço do Beds24; mesma limpeza e mesmo hóspede extra em todos os canais;
  3. operacional: conferência periódica, com a coluna "Site (≈)" da prévia de calendário, contra
     o que o hóspede vê no Airbnb e no Booking (promoções dentro das OTAs não são legíveis por
     API). Divergência vira pendência no cadastro, nunca palpite.
- **Última hora e desconto do site acumulam** de propósito (ver o requisito operacional).
- **Pesos 6/3/3 — confirmados por Diego em 7/10/2026:** SCL 6%, hóspede 3% e proprietário 3% da
  margem (pesos hóspede 1, proprietário 1, SCL 2), no lugar das partes iguais; avaliação do
  Claude: justo e defensável (hóspede 3% abaixo do Airbnb, proprietário cerca de 3,7% acima, SCL
  6%). **Padrão do sistema desde o M12.5 (7/10/2026).** Quem nunca salvou a configuração já usa
  1/1/2; quem salvou continua com o que salvou (vale daquela data para frente, as cotações já
  feitas guardam o que mostraram). Se o que está salvo é o 1/1/1 antigo, a aba mostra o aviso e o
  botão "Usar o padrão novo", que troca só os pesos (as taxas ficam); nada muda sozinho.

