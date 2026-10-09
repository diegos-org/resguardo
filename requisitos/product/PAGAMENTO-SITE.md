# Pagamento da reserva direta no site (M8.2)

> Situação: desenho de 8/10/2026 para o M8.2, dividido em cinco partes (M8.2a a M8.2e), revisado
> por quatro leituras adversariais (dinheiro, concorrência, segurança e produto) e pela primeira
> revisão do Codex. Ajustado em 9/10/2026 pela revisão do código do M8.2a (liberação, devolução
> em dobro, travas, freios e taxa perdida). Base: ROADMAP (M8.0, M8.1, M8.2, M7.4, M4.10, M4.12,
> M12.2), `RECEBIMENTO-SITE.md`, `COTACAO-E-HOLD-SITE.md` e `REPASSES-POR-PERIODICIDADE.md`. API conferida
> na documentação oficial do Mercado Pago em 8/10/2026 (Checkout Transparente pela Orders API); o
> que a documentação deixa em aberto está em "A conferir no sandbox".

## As cinco partes

| Parte | O que entrega | Depende de |
|---|---|---|
| **M8.2a** | **Pix em teste e a base de tudo:** adaptador, aviso assinado, conferência, confirmação só com as datas seguradas (inclusive aprovação tardia), taxa real, liberação virando o recebimento do M4.10, devolução do pagamento que ficou sem reserva, o que o hóspede vê em cada situação, painel e as travas. | M8.1 |
| **M8.2b** | **Cartão:** Card Payment Brick, parcelas com juros do hóspede e máximo configurável, freios contra teste de cartão roubado, identificação do aparelho, análise do cartão. | M8.2a |
| **M8.2c** | Cancelamento de reserva paga pela política (integral até 14 dias antes; nada depois), lançamentos por componente, taxa que não volta com a SCL, dinheiro retido no cancelamento sem reembolso. | M8.2a |
| **M8.2d** | Alteração de reserva paga (datas ou valor), com novas datas seguradas, cobrança da diferença ou devolução parcial. | M8.2c |
| **M8.2e** | Contestação (chargeback): registro, conferência, decisão de quem arca, lançamentos. | M8.2b, M8.2c |

O pagamento **de verdade** só liga com as cinco partes e o M7.4 feitos, e com as decisões pendentes
de Diego: taxa do pagamento (hoje sai antes da divisão; se a SCL passar a arcar, o motor precisa de
base por canal, porque a opção atual vale para todos), arrependimento conferido com o contador e
3DS ligado ou não (sem 3DS, contestação por cartão roubado fica com a SCL).

## Perímetro do teste (parte a)

- **O teste roda só nas prévias da Vercel** (e no computador de desenvolvimento), nunca no deploy
  de produção. As prévias usam o banco de prévia; o banco de produção já tem a operação real
  (recebimentos de outubro, chaves Pix, início do sistema) e um pagamento de teste ali criaria
  receita, parte do proprietário e repasse de verdade.
- No deploy de produção (`VERCEL_ENV=production`), com chaves de teste ou não, o site segue pelo
  pedido na conversa e Integrações diz "o teste do pagamento roda nas prévias".
- As chaves de teste vão na Vercel **só no ambiente Preview**.
- Como a Vercel não deixa o Mercado Pago chegar às prévias, no teste a confirmação vem da página do
  hóspede (que consulta o provedor enquanto espera) e do botão **Conferir agora** do painel. O aviso
  assinado (webhook) é testado com o botão "Simular" do Mercado Pago contra o endereço de produção,
  que só confere a assinatura e registra o evento (lá não há pagamento a aplicar).
- A página mostra "Ambiente de teste: nenhuma cobrança real" e o painel marca "pagamento de teste".

## Variáveis e travas

| Variável | Para quê |
|---|---|
| `MERCADOPAGO_PUBLIC_KEY` | chave pública (usada no cartão, parte b) |
| `MERCADOPAGO_ACCESS_TOKEN` | chave privada, só no servidor |
| `MERCADOPAGO_WEBHOOK_SECRET` | assinatura secreta dos avisos |
| `MERCADOPAGO_AMBIENTE` | ausente ou exatamente `teste` = teste; exatamente `producao` = travado; qualquer outro valor = configuração inválida, travado, com aviso |

Cobrança só acontece com tudo isto (uma função só decide, para criar, cancelar e devolver):
1. fora do deploy de produção: só nas prévias da Vercel (`VERCEL_ENV=preview`), no `vercel dev` e no
   computador de desenvolvimento (sem `VERCEL_ENV` e com `NODE_ENV` diferente de `production`); um
   servidor ou script fora da Vercel com `NODE_ENV=production`, ou um `VERCEL_ENV` inesperado, conta
   como produção;
2. ambiente `teste`;
3. as duas chaves presentes;
4. **conta conferida como de teste no Mercado Pago** (`GET /users/me`; critério positivo, ex.:
   marca `test_user`, a conferir no sandbox; resposta estranha ou falha = não é teste; resultado
   guardado alguns minutos, inclusive a falha);
5. a chave "Oferecer pagamento no site" ligada no painel (começa **desligada**: o Diego liga na aba).

Aviso com `live_mode=true` (não é assinado; serve de alarme) vira aviso no painel. Nas tentativas
gravadas fica o ambiente e o `live_mode` lido do provedor. **Desvio registrado (9/10):** uma order
lida com `live_mode=true` no teste nunca confirma reserva (vira "aprovado sem reserva", motivo
`ao_vivo`), e um Pix recém-criado assim é cancelado na hora: "Gerar Pix" responde falha (nunca "deu
certo" com um Pix já cancelado) e o prazo provisório das datas volta ao que era.

## Quando o site oferece o Pix

Além das travas: cotação **segurada** com o pedido ainda em `pedido`; situação **disponível**
(cotação "a confirmar" segue pela conversa); e o **mesmo cálculo do motor**, em seco, na data de
entrada, dá receita e parte do proprietário sem pendência (contrato de gestão vigente na entrada,
um proprietário, quem recebe do site = empresa). Marketplace segue pela conversa até o M12.2. Fora
disso, a página mostra o fluxo de hoje, e a aba de pagamento lista cada imóvel com o motivo.

## Tabelas (migração 0061, colunas em texto como nas tabelas novas)

- **`pagamentos`**: uma linha por tentativa (cada order aceita uma transação). Cotação, reserva,
  imóvel, ambiente, forma, referência única (`scl-<id>`), chave de idempotência da criação,
  situação local (abaixo), id da order, `live_mode`, **valor** (o que enviamos: igual a
  `cotacoes.total`), valor pago pelo hóspede (só para mostrar), taxa, líquido, liberação prevista,
  liberação confirmada, copia e cola e imagem do Pix (apagados quando o Pix vence ou é pago), prazo
  do Pix, `consultadoEm`, desfecho (`reserva`, `devolucao`, `por_fora`) com motivo, autor e data,
  motivo de "sem reserva". Índice único parcial: um desfecho `reserva` por reserva. Nada de CPF,
  e-mail ou nome do pagador; nada de resposta crua do provedor.
- **`devolucoes_pagamento`**: uma por pagamento; motivo, valor, situação (`pedida`, `confirmada`,
  `recusada`, `por_fora`), tentativas, chave da tentativa atual (`devolucao:<id>:<n>`), próxima
  tentativa, id da devolução no provedor.
- **`eventos_pagamento`**: avisos com assinatura válida (tipo, ação, id, request-id, ts, quando,
  resultado), índice único por (request-id, ts, id) para não processar repetição; apagados depois de
  90 dias. Assinaturas inválidas só contam num número agregado do dia ("assinaturas recusadas") e
  no "último aviso válido em".

**Situação local** de uma tentativa: `criando` (gravada antes da chamada), `incerta` (a chamada
caiu e não se sabe se a order existe), `pendente`, `aprovado`, `recusado`, `cancelado`, `expirado`,
`devolvido`, `devolvido_parcial`, `contestado`. Transições (só por leitura do provedor, nunca pelo
relógio; sob a trava da tentativa): `criando`/`incerta` → qualquer; `pendente` → qualquer outra;
`recusado`, `cancelado`, `expirado` → só `aprovado` ou depois (dinheiro vence ausência de
dinheiro); `aprovado` → `devolvido_parcial`, `devolvido`, `contestado`; `devolvido_parcial` →
`devolvido`, `contestado`. Desconhecido nunca sobrescreve uma situação conhecida (vira aviso).
Tentativa com desfecho `reserva` que vira devolvida ou contestada por fora gera aviso, sem mexer na
reserva (partes c e e).

A reserva continua `pedido` enquanto o hóspede paga. Não há estado novo de reserva.

## Ordem das travas (uma só, em todos os caminhos)

imóvel (`FOR NO KEY UPDATE`) → reserva → cotação → tentativas da cotação (por id) → devolução. Motor
e livro travam depois, como já fazem. O imóvel é travado com `NO KEY UPDATE`, não `FOR UPDATE`:
serializa pagamento e hold entre si e com os bloqueios e contratos, mas não bloqueia a conferência
das chaves estrangeiras de quem grava lançamentos, limpezas ou pagamentos daquele imóvel (com
`FOR UPDATE`, a confirmação à mão e o Pix entravam em impasse). Trava não obtida (tempo-limite ou impasse
desfeito pelo Postgres) = "ocupado": nada fica pela metade e o hóspede tenta de novo; na rotina, o
hold que falhou é contado e os seguintes continuam. As chamadas ao Mercado Pago **nunca** acontecem
com trava aberta: três fases, como no envio ao Beds24 (gravar a intenção; chamar fora de transação;
reler e aplicar). A rotina de vencimento de holds passa a vencer cada hold numa transação curta,
travando o imóvel primeiro; e o pagamento nunca vence holds de outras cotações (a conferência das
noites só ignora pedidos já vencidos).

## Pix

- **Um Pix por vez.** Pix válido existente é mostrado de novo (mesmo QR, mesmo prazo). Pix novo só
  depois de cancelar o anterior no provedor (cancelado, já cancelado ou vencido). Até 3 Pix por
  cotação (constante, freio como os do M8.1), conferido **antes** de cancelar o anterior (o terceiro,
  ainda pagável, não é cancelado à toa).
- **Prazo:** o Pix vale no mínimo 30 minutos (regra do Mercado Pago). Na fase 1 o prazo das datas é
  estendido provisoriamente para agora + validade + 2 minutos; na fase 3, para o `date_of_expiration`
  devolvido + 2 minutos (só se o pedido ainda for `pedido` e a cotação `segurada`; senão o Pix é
  cancelado). Assim o QR nunca vale mais que as datas. Se o pedido nem chegou ao provedor (tentativa
  apagada), a extensão provisória é desfeita. A extensão aparece na tela do prazo das datas do painel
  ("com o pagamento ligado, cada Pix segura as datas por pelo menos 30 minutos"). Uma leitura sem o
  prazo (ou sem a imagem, ou o link) não apaga o que já se sabia do mesmo Pix; Pix pendente sem prazo
  nenhum vira aviso.
- **Carência:** a rotina e o `segurarDatas` não vencem um pedido com tentativa `criando`,
  `incerta`, `pendente` ou aprovada sem desfecho até 15 minutos depois do prazo; nesse tempo, as
  datas continuam ocupadas.
- **O mesmo e-mail:** segurar outras datas fica recusado enquanto o mesmo e-mail tem um Pix em
  andamento **na carência daquela cotação** (prazo + 15 minutos) ou um pagamento aprovado sem desfecho
  (este, sem limite de tempo). Uma tentativa que nunca se resolve não prende o e-mail depois da
  carência (e aparece no Início). A resposta é a mesma de "reserva em andamento": nada revela que
  aquela pessoa está pagando.
- Sem imagem do QR (o sandbox às vezes não manda), a página mostra o copia e cola e o link do
  Mercado Pago. No celular, o copia e cola vem primeiro.
- O e-mail do pagador enviado ao Mercado Pago sai do servidor: no teste, `test@testuser.com`
  (exigência do sandbox). A página nunca recebe nome, e-mail ou telefone da reserva.

## Quem pode pagar

O código da cotação circula no WhatsApp e não é credencial. Ao segurar as datas, o navegador recebe
um cookie assinado (finalidade própria, só para `/reservar`, validade até o fim do pedido). Gerar o
Pix e ver o QR exigem o cookie. Noutro aparelho, "Continuar o pagamento" pede o e-mail usado ao
segurar (conferido no servidor, com limite de tentativas) e emite o cookie de novo. Sem cookie, a
página mostra só a situação. Freios por endereço de internet e geral por organização para gerar Pix,
para "Continuar o pagamento", para a consulta da página e também para segurar as datas: a origem é
conferida **primeiro** e só o pedido que ainda cabe no teto dela conta no geral (uma origem só não
tira a vez de todo mundo, como na entrada com senha); IPv6 conta pela rede /64; origem desconhecida
conta numa chave compartilhada com teto baixo.

## Aviso assinado (webhook)

- Rota pública `POST /api/pagamentos/mercadopago`. Sem `x-signature` ou sem segredo configurado:
  401 sem ler o corpo nem tocar no banco. Corpo até 64 KB.
- Assinatura: HMAC-SHA256 de `id:<data.id da URL>;request-id:<x-request-id>;ts:<ts>;`, comparação em
  tempo constante; aceita o id como veio ou em minúsculas (documentação e SDK divergem). Só o
  `data.id` da URL vale (é o assinado); nada é decidido pelo corpo ou pelo `type`.
- `data.id` precisa ter o formato de order (`ORD…`); id numérico (contestação, pagamento, alerta
  de fraude) é registrado como ignorado, com 200. Order que este banco não conhece: 200, sem aviso.
- Válido: grava o evento (repetição = nada), responde 200 e processa depois da resposta, com tempo
  limite em cada chamada. O resultado fica no evento para a rotina saber o que falhou.
- Na parte (a), marcar no Mercado Pago só o evento "Order (Mercado Pago)".

## Conferência (uma função, vários gatilhos)

`conferirPagamento(tentativa)`: lê a order (pelo id, ou pela referência quando a tentativa está
`criando`/`incerta`), lê taxa/líquido/liberação na Payments API só quando faltam (no máximo a cada
alguns minutos), e aplica numa transação curta. Gatilhos: aviso, página do hóspede (no máximo uma
leitura a cada 15 s por tentativa, só enquanto pendente; a leitura é **reservada num comando só**
antes de chamar o provedor, então pedidos simultâneos leem uma vez; leitura que falha não conta;
freio por endereço de internet), rotina (a de holds, que primeiro confere os pagamentos e só depois
vence holds) e **Conferir agora** no painel (sem o intervalo). A rotina relê uma vez por dia, por 180
dias, os pagamentos com desfecho (`reserva`, `devolucao`, `por_fora`) e os aprovados sem reserva à
espera da devolução: devolução ou contestação feita por fora, ou devolução em dobro, vira aviso, nunca
estorno automático.

**Onde a rotina roda:** o cron da Vercel só roda no deploy de produção, onde o pagamento fica
desligado. No teste (prévias), nada confere sozinho: a página do hóspede confere o próprio Pix e o
**Conferir agora** do painel faz o papel da rotina (os avisos dizem isso). A limpeza dos avisos com
mais de 90 dias roda na rotina do site em qualquer ambiente (o webhook grava no deploy de produção),
nunca no "Conferir agora" de uma empresa.

## Confirmação (na transação, com as travas na ordem acima)

"Datas seguradas" = reserva ainda `pedido` e cotação ainda `segurada`, conferidas sob trava (as
noites nunca foram liberadas), seja qual for o relógio.

1. **Aprovado com as datas seguradas e sem conflito** (nenhuma outra reserva ou bloqueio nas mesmas
   noites, a própria reserva excluída da conta): a reserva vira `confirmada` (com `confirmadaEm`,
   quem recebe = empresa), a cotação `convertida`, o motor roda. Desfecho `reserva`. As outras
   tentativas pendentes da cotação são canceladas no provedor.
2. **Aprovado depois que o pedido venceu** (cotação `expirada`, vencida pela rotina ou pelo painel):
   confere as noites (livres no SCL e na leitura atual do Beds24, sem regras de venda nem preço).
   Livres: a mesma reserva volta a `confirmada` pelo valor pago, com auditoria "confirmação tardia".
3. **Qualquer outro caso** vira **aprovado sem reserva**, com o motivo gravado na mesma transação
   (depois disso só a equipe muda): noites ocupadas ou sem leitura atual para conferir; pedido
   cancelado pela equipe (cotação `cancelada`, ou reserva cancelada com a cotação ainda segurada:
   nunca é revivido); valor aprovado diferente do total da cotação (`total_amount`, o valor da
   transação — que precisa vir na order — e o total pago, quando vier; no cartão, o pago pode passar
   pelos juros do hóspede); outra tentativa da mesma cotação já com desfecho `reserva`; reserva
   confirmada à mão e com recebimento manual; dinheiro que chega **já devolvido em parte ou
   contestado**, sem uma leitura "aprovado" antes (motivo "situação inesperada", com aviso: nunca
   confirma sozinho; o resto se resolve pelo Mercado Pago até o M8.2c).
4. **Reserva confirmada à mão pela equipe** (sem recebimento manual e sem outra tentativa com
   desfecho `reserva`): o pagamento vira o desfecho `reserva` dela.
5. Recusado, cancelado ou expirado: nada muda; o hóspede pode tentar de novo enquanto as datas
   estiverem seguradas.

Confirmar à mão um pedido que tem pagamento aprovado sem reserva (a devolver) fica recusado, com a
mensagem apontando o quadro do pagamento: o pagamento não se liga à reserva depois.

O retorno do navegador nunca confirma nada. O M8.2a não manda e-mail novo ao hóspede; a confirmação
do M9.2 passa a valer para reservas pagas quando Diego ligar as mensagens.

## Taxa, liberação e recebimento (M4.10 e M4.12)

- **Valor** = o que enviamos (`total_amount`), igual ao total da cotação. **Líquido** = o que o
  provedor informa. **Taxa** = valor − líquido, em centavos inteiros a partir dos textos decimais,
  numa leitura só (nunca soma de itens). Taxa negativa ou líquido maior que o valor viram aviso. Se
  o provedor informar outro líquido **antes** de qualquer recebimento lançado, a taxa é atualizada
  (reserva e motor) antes de lançar; com recebimento já lançado, outro líquido vira aviso, sem mexer.
- Gravar a taxa: `reservas.taxaCanal` (e `valorLiquido`), aplicar o motor, nessa ordem, numa
  transação. A taxa de referência de 4% do M12.1 continua só para o desconto do site.
- A data de liberação informada é a **prevista**: aparece no painel e no extrato ("o Mercado Pago
  libera em dd/mm"), não libera nada.
- Só o pagamento com desfecho `reserva`, com a reserva confirmada e a situação ainda `aprovado`,
  lança o `recebimento`, e só quando o provedor disser **explicitamente** que liberou (campo e valor
  exatos a conferir no sandbox; data passada sozinha nunca basta; liberação em parcelas não lança
  sozinha). Recebimento: montante = o líquido **informado pelo provedor nessa leitura** (nunca o
  guardado antes), data de caixa = data da liberação no fuso de São Paulo, `conciliado`, origem
  `sincronizacao`, chave `mercadopago:<tentativa>:recebimento`. Liberado sem o líquido: aviso, nada
  lançado.
- Sem o sinal, a equipe registra a liberação à mão (com confirmação): informa a data (entre a
  aprovação e hoje) e o líquido; o sistema deriva a taxa, grava `taxaCanal` e lança o recebimento
  `realizado` com a mesma chave. Se o provedor confirmar depois com o mesmo líquido e a mesma data,
  passa a `conciliado`; diferentes, aviso, sem mexer (o aviso não é apagado pela mesma leitura que o
  ligou). No estorno da manual, a taxa e o líquido voltam ao que o provedor tinha informado antes (ou
  a desconhecidos), a reserva recebe essa taxa com o motor e a próxima conferência relê a Payments
  API: o sinal seguinte lança o líquido certo.
- O recebimento do pagamento não aparece como estornável na lista genérica; estorno (só do manual)
  pelo quadro do pagamento, e o registro seguinte usa chave versionada (`#N`), como o motor.
- "Registrar recebimento" manual fica recusado em reserva com tentativa pendente ou aprovada (aponta
  para o pagamento). Textos do fechamento e do extrato dizem "o Mercado Pago libera em dd/mm" para
  essas reservas.
- Reserva paga que um recálculo deixe sem lançamento do motor (contrato encerrado, troca para
  marketplace): aviso "dinheiro recebido sem cálculo".

## Devolução na parte (a): só do pagamento sem reserva

- A equipe escolhe (com confirmação), na ficha: **Devolver pelo Mercado Pago** (integral) ou
  **Registrar devolução feita por fora** (data, valor, nota). Exigem desfecho vazio e nenhuma
  devolução pedida, sob a trava da tentativa.
- Devolução pelo provedor: `pedida` até confirmar. Cada tentativa nova usa chave nova, gravada antes;
  antes de tentar de novo, relê a order (já devolvida = confirmada; devolução em andamento lá = não
  pede de novo). `order_refund_already_in_process` = continua pedida; `already_refunded` =
  confirmada. Resposta **incerta** (tempo esgotado, 5xx) não é falha: o pedido pode ter saído, então
  continua pedida e a próxima volta relê a order. Só recusa explícita conta; na terceira, a order é
  relida antes e, sem nenhum sinal de devolução, a devolução fica recusada, com aviso. Sob a trava, a
  vez e o número de tentativas são conferidos de novo (painel e rotina juntos não pedem duas vezes).
- **Registrar devolução feita por fora** relê antes a order no Mercado Pago (fora da transação):
  devolvida (no todo ou em parte), com devolução em andamento ou contestada = recusa; sem conseguir
  ler (ou sem o provedor, como no deploy de produção) = recusa também. Nesta parte, só o valor
  integral (devolução de parte do valor é o M8.2c). Se o Mercado Pago mostrar depois o pagamento
  devolvido com o desfecho "por fora", aviso de **devolução em dobro** (a releitura diária inclui
  esses pagamentos). Os textos do painel nunca afirmam que o Mercado Pago "não fez": mandam conferir
  lá antes de registrar por fora.
- A taxa que não voltar vira despesa da empresa só depois da confirmação, **com o valor informado pela
  equipe** ("Registrar taxa que não voltou", no quadro do pagamento, com confirmação; zero se voltou
  toda; uma vez por devolução, chave `mercadopago:<tentativa>:taxa_perdida`): o Mercado Pago só
  informa a tarifa da aprovação, não o que voltou na devolução (item 7 de "A conferir no sandbox").
  Até a equipe informar, aviso, nunca palpite. Categoria escolhida na aba de pagamento (criada no
  primeiro uso, editável). Regra derivada (a decisão de 7/10 fala do reembolso integral da política;
  aqui a falha é do sistema): está no GUIA para Diego confirmar.
- Cancelar uma reserva com tentativa pendente ou aprovada fica recusado na parte (a), com mensagem
  ("o cancelamento com devolução chega no M8.2c"). Confirmar à mão um pedido com Pix pendente também
  fica recusado ("há um Pix em andamento até HH:MM").

## O que o hóspede vê (`/reservar/<código>`)

A vista da cotação lê também a tentativa mais recente. Um pagamento aprovado ou pendente sempre vence
"expirada" e "cancelada" na tela; enquanto houver dinheiro sem desfecho, nunca aparece "faça uma nova
consulta".

| Situação | Na tela |
|---|---|
| Datas seguradas, Pix oferecido | Pix em destaque, prazo das datas; WhatsApp como opção |
| Pix aguardando | copia e cola com botão de copiar, QR, prazo; "pode fechar e voltar por este link" |
| Pagamento recebido, confirmando | "Pagamento recebido, confirmando sua reserva" |
| Confirmada | "Pagamento aprovado: reserva SCL-… confirmada", link para Minha reserva, "guarde este link" |
| Aprovado sem as datas | "Recebemos seu pagamento, mas não conseguimos garantir as datas. A equipe vai falar com você e devolver o valor integral", com WhatsApp |
| Devolução pedida / feita | o que foi pedido e quando |
| Pix vencido sem pagar, datas ainda seguradas | gerar outro (até 3) |

Os textos principais (convite para pagar, Pix aguardando, aprovado sem as datas) são editáveis em
Textos do site, com texto-base. Os "nenhum pagamento é feito no site" passam a depender de o Pix
estar oferecido para aquele imóvel. A página proíbe ser enquadrada por outro site.

## Painel

- **Integrações** (e Sistema, pela mesma função): situação do Mercado Pago, conta de teste
  conferida ou não, ambiente, segredo do webhook, último aviso válido, assinaturas recusadas no dia,
  endereço fixo do webhook para copiar (`https://scl-reconstrucao.vercel.app/api/pagamentos/mercadopago`).
- **Configurações → Pagamento no site** (regras de venda): oferecer pagamento no site (liga e
  desliga), nome na fatura (para o cartão; padrão o nome da empresa), categoria da taxa perdida e a
  lista de imóveis com ✓ ou o motivo de não oferecer. Tudo auditado, valendo para as tentativas novas.
- **Ficha da reserva:** quadro "Pagamento no site". Situação, forma e datas para quem lê reservas;
  valores para quem lê o financeiro; ações (devolver, devolução por fora, registrar liberação,
  conferir agora) para quem edita o financeiro, com confirmação.
- **Financeiro → Pagamentos do site:** lista por período com filtro "pede atenção".
- **Início** (para a empresa toda, sem depender do filtro de imóveis): aprovado sem desfecho,
  devolução pedida ou recusada, liberação prevista vencida sem sinal, criação do Pix sem resposta do
  Mercado Pago há mais que a carência, conta das chaves que não é de teste, configuração inválida,
  aviso com `live_mode`, dinheiro sem cálculo, e o informativo "N reserva(s) do site paga(s): feche as
  datas nas OTAs enquanto o envio ao Beds24 estiver desligado".
- Até o M8.3, a equipe fecha as datas no Beds24 como **bloqueio**, nunca como reserva (a importação
  criaria uma segunda reserva).

## Dados pessoais

O adaptador lê por lista branca (ids, situação, código de detalhe de lista fechada, valores em
centavos, datas) e nunca devolve nem grava a resposta crua. Erros com tipo e código fechados; o
registro do servidor só leva códigos. Nada de dado do pagador em tentativas, eventos, auditoria ou
estado das ações. Teste: depois de um fluxo completo com o provedor falso, nenhum e-mail ou documento
do pagador aparece nessas tabelas.

## A conferir no sandbox (Diego e Claude)

1. Qual campo de `GET /users/me` marca a conta de teste.
2. Se a Payments API acha o pagamento de uma order pela referência (taxa, líquido, liberação) e qual
   campo diz "liberado" de forma explícita.
3. O endereço e a janela da busca de orders pela referência.
4. O que uma repetição com a mesma chave depois de um tempo esgotado devolve.
5. Se o `data.id` da assinatura vai em minúsculas e se o reenvio traz `ts` novo.
6. Se o Pix de teste aprova sozinho com o nome APRO e se vem a imagem do QR.
7. Se a taxa volta na devolução integral (registrar em `RECEBIMENTO-SITE.md`). Até lá, a equipe
   informa a taxa que não voltou.
8. O valor de `live_mode` nas orders do usuário de teste (se vier `true`, todo Pix do teste é
   cancelado na hora: ver o desvio em "Variáveis e travas").
