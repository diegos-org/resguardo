# Pagamento da reserva direta no site (M8.2)

> Situação: desenho de 8/10/2026 para o M8.2, dividido em quatro partes (M8.2a a M8.2d). Base:
> ROADMAP (M8.0, M8.1, M8.2, M7.4, M4.10, M4.12, M12.2), `RECEBIMENTO-SITE.md`,
> `COTACAO-E-HOLD-SITE.md` e `REPASSES-POR-PERIODICIDADE.md`. API conferida na documentação
> oficial do Mercado Pago em 8/10/2026 (Checkout Transparente pela Orders API); os pontos que a
> documentação deixa em aberto estão em "A conferir no sandbox".

## Por que em quatro partes

O M8.2 tem setenta e poucos requisitos (checkout, aviso assinado, confirmação, liberação,
devolução, alteração de reserva paga, contestação, conciliação). Num PR só, a revisão ficaria
longa demais. As partes:

| Parte | O que entrega | Depende de |
|---|---|---|
| **M8.2a** | Pagamento em sandbox: Pix e cartão no site, aviso assinado, confirmação só com as datas seguradas (inclusive aprovação tardia), taxa real, liberação do dinheiro virando o recebimento do M4.10, conferência periódica, devolução integral do pagamento que ficou sem reserva, painel e trava de produção. | M8.1, credenciais de teste |
| **M8.2b** | Cancelamento de reserva paga pela política (integral até 14 dias antes; nada depois), devolução pendente até o provedor confirmar, lançamentos por componente, taxa que não volta com a SCL, dinheiro retido no cancelamento sem reembolso, desconto no repasse se já repassado. | M8.2a |
| **M8.2c** | Alteração de reserva paga (datas ou valor): novas datas seguradas, cobrança da diferença ou devolução parcial, lançamentos de diferença. | M8.2b |
| **M8.2d** | Contestação (chargeback): registro, reserva em conferência, decisão de quem arca, lançamentos pendentes e definitivos. | M8.2b |

O pagamento **de verdade** (credenciais de produção) só liga com M8.2a a M8.2d e o M7.4 feitos,
e com as decisões pendentes de Diego (taxa do pagamento; arrependimento conferido com o contador).

## Escolhas da parte (a)

### Provedor e API

- **Orders API** do Checkout Transparente (recomendada pelo Mercado Pago para integração nova; a
  Payments API só recebe correções). Cartão pelo **Card Payment Brick** (formulário do Mercado
  Pago, o número do cartão vira um token no navegador); Pix com tela própria (copia e cola, QR e
  prazo).
- A Orders não informa a **taxa**, o **líquido** nem a **data de liberação**. O adaptador lê esses
  três da Payments API, procurando o pagamento pela referência (`external_reference`). Se não achar,
  ficam desconhecidos e o painel avisa; a equipe pode registrar a liberação à mão.
- Tudo atrás de `pagamentos/provedor.ts` (interface), com a versão HTTP (`mercadopago.ts`) e a
  falsa (`falso.ts`). Testes nunca usam rede.

### Variáveis de ambiente e trava de produção

| Variável | Para quê |
|---|---|
| `MERCADOPAGO_PUBLIC_KEY` | chave pública (vai ao navegador para o formulário do cartão) |
| `MERCADOPAGO_ACCESS_TOKEN` | chave privada, só no servidor |
| `MERCADOPAGO_WEBHOOK_SECRET` | assinatura secreta dos avisos (criada ao configurar o webhook) |
| `MERCADOPAGO_AMBIENTE` | `teste` (padrão quando ausente) ou `producao` |

- O prefixo não diz se a credencial é de teste (as duas começam com `APP_USR`): o ambiente vem da
  variável.
- **Trava:** com `MERCADOPAGO_AMBIENTE=producao`, a parte (a) **não cobra**: o site volta ao fluxo
  pela conversa e o painel avisa "produção travada até as páginas legais (M7.4) e as partes b a d".
  Liberar a produção é uma linha de código num item futuro, nunca uma variável só.
- Sem as duas chaves, o site continua como hoje (pedido pela conversa).

### Quando o site oferece o pagamento

Só com tudo isto: Mercado Pago configurado em teste; cotação **segurada** com o prazo valendo;
situação **disponível** (cotação "a confirmar" segue pela conversa, porque não dá para garantir as
noites); imóvel em contrato de **gestão** (marketplace fica pela conversa até o M12.2, porque o
financeiro ainda não lança nada dele); e quem recebe do site no imóvel é a **empresa** (com split ou
"a confirmar" configurado para o site, aviso e conversa). Fora disso, a página mostra o fluxo de hoje.

### Estados e tabelas (migração 0061, colunas em texto como nas tabelas novas)

- **`pagamentos`**: uma linha por tentativa (cada order aceita uma transação só). Cotação, reserva,
  ambiente, forma (`pix`/`cartao`), referência única (`scl-<id>`), chave de idempotência gravada
  **antes** da chamada, id da order, situação normalizada, detalhe, valor, parcelas, taxa, líquido,
  liberação prevista e efetiva, dados do Pix (copia e cola, imagem, prazo) e **desfecho**
  (`reserva`, `devolucao` ou `manual`, com motivo, autor e data). Nada de cartão ou CPF.
- **`devolucoes_pagamento`**: pedido de devolução com motivo, valor, chave de idempotência,
  situação (`pedida`, `confirmada`, `recusada`, `incerta`, `manual`), tentativas e próxima tentativa.
- **`eventos_pagamento`**: registro curto de cada aviso com assinatura válida (tipo, ação, id,
  quando, resultado), sem dados pessoais; apagado depois de 90 dias.
- A reserva continua `pedido` enquanto o hóspede paga. Não há estado novo de reserva.

Situação normalizada do provedor: `pendente`, `aprovado`, `recusado`, `cancelado`, `expirado`,
`devolvido`, `devolvido_parcial`, `contestado` e `desconhecido` (este vira aviso, nunca palpite).

### Pix e o prazo das datas

- O Pix vale no mínimo 30 minutos (regra do Mercado Pago). Ao gerar o Pix com o prazo das datas
  ainda valendo, o prazo do Pix é o maior entre 30 minutos e o que resta das datas, e **as datas
  ficam seguradas até o fim do Pix** (o prazo das datas é estendido até ali). Assim o QR nunca vale
  mais que as datas.
- Até 3 Pix por cotação (cada um estende no máximo até 30 minutos depois de gerado).
- Sem imagem do QR (o sandbox às vezes não manda), a página mostra o copia e cola e o link do
  Mercado Pago.

### Cartão

- Card Payment Brick carregado do script oficial (`sdk.mercadopago.com/js/v2`), sem dependência
  nova no projeto. Máximo de parcelas = configuração "Pagamento no site" (vazio = o máximo que o
  Mercado Pago oferecer); o servidor recusa mais parcelas que isso. Juros do parcelamento ficam com
  o hóspede: a conta do Mercado Pago não pode estar com "parcelas sem acréscimo" ligado; o valor da
  reserva no financeiro é sempre o total da cotação.
- O servidor recebe só o token, a bandeira, o tipo, o emissor, as parcelas, o e-mail e o documento
  do pagador (repassado ao Mercado Pago e não guardado).
- Até 5 tentativas de cartão por cotação e um teto por endereço de internet (contra teste de cartão
  roubado), na mesma conta temporária do login.
- No sandbox, o e-mail do pagador enviado ao Mercado Pago é `test@testuser.com` (exigência do
  ambiente de teste); o e-mail do hóspede continua na reserva.

### Aviso assinado (webhook) e conferência

- Rota pública `POST /api/pagamentos/mercadopago`. Confere `x-signature` (HMAC-SHA256 do manifesto
  `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, comparação em tempo constante; aceita o id como
  veio ou em minúsculas, porque a documentação e o SDK divergem). Assinatura inválida: 401 e nada é
  gravado. Válida: registra o evento, responde 200 e processa depois da resposta.
- O aviso é só gatilho: a situação vem sempre de uma consulta ao provedor (`GET /v1/orders/{id}`).
- **Rotina** a cada 10 minutos (só produção, `CRON_SECRET`): reconsulta pagamentos pendentes, os
  aprovados sem taxa ou sem liberação e as devoluções pedidas; apaga eventos velhos. Entra no
  catálogo de automações da área Sistema.
- Processar o mesmo aviso duas vezes, ou fora de ordem, não muda nada: cada efeito tem chave única,
  e uma situação final não volta para trás.

### Confirmação (sempre numa transação, travando reserva e depois cotação)

1. **Aprovado com as datas seguradas:** a reserva vira `confirmada` (com `confirmadaEm`, quem
   recebe = empresa e a taxa real, quando já conhecida), a cotação vira `convertida`, o motor roda.
   Desfecho `reserva`.
2. **Aprovado depois do prazo, datas livres:** trava o imóvel, vence os holds atrasados e confere
   as noites (no SCL e na última leitura do Beds24). Livres: confirma como no item 1, pelo valor
   pago (o hóspede pagou o que a cotação mostrou).
3. **Aprovado sem conseguir as datas** (ocupadas, ou leitura do Beds24 vencida, sem como
   conferir): não cria reserva. O pagamento fica "aprovado sem reserva", com aviso no Início e na
   ficha da reserva; a equipe escolhe **Devolver ao hóspede** (integral) ou **Registrar resolução
   manual** (com motivo). Nenhuma aprovação fica sem desfecho: o aviso só some com um dos dois.
4. **Valor aprovado diferente do total da cotação:** não confirma; mesmo tratamento do item 3.
5. **Segundo pagamento aprovado** para a mesma cotação: não confirma de novo; mesmo tratamento do
   item 3.
6. Recusado, cancelado ou expirado: nada muda na reserva; o hóspede pode tentar de novo enquanto
   as datas estiverem seguradas.

O retorno do navegador nunca confirma nada.

### Taxa, liberação e recebimento (M4.10 e M4.12)

- A **taxa real** (valor − líquido, lida do provedor) vai para `reservas.taxaCanal`. A taxa de
  referência de 4% do M12.1 continua só para calcular o desconto do site.
- Enquanto o dinheiro não é liberado, a parte do proprietário fica "a liberar" (regra do M4.10, sem
  regra nova); o extrato diz "o Mercado Pago libera em dd/mm" quando a data prevista é conhecida.
- Na **liberação**, o sistema lança o `recebimento` da reserva: montante = líquido, data de caixa =
  data da liberação (fuso de São Paulo), estado `conciliado` (confirmado pelo provedor), origem
  `sincronizacao`, chave `mercadopago:<pagamento>:recebimento`. Essa data vira a data do pagamento
  do M4.12. Sem data informada pelo provedor, a equipe registra a liberação à mão (mesma chave, então
  nunca conta duas vezes).
- O "Registrar recebimento" manual fica recusado em reserva paga pelo site (aponta para o
  pagamento).

### Devolução na parte (a)

Só a integral do pagamento sem reserva (itens 3 a 5 da confirmação), pedida pela equipe com
confirmação. Fica `pedida` até o provedor confirmar; recusa ou falta de resposta: nova tentativa
com a mesma chave pela rotina; depois de 3 falhas, aviso e resolução manual. A taxa que o Mercado
Pago não devolver é custo da SCL (decisão de 7/10), lançada como despesa da empresa com chave
própria. Cancelar uma reserva **paga** fica recusado na parte (a) ("o cancelamento com devolução
chega no M8.2b").

### Painel

- **Configurações → Pagamento no site** (aba nova): situação do Mercado Pago (chaves presentes,
  ambiente, assinatura do webhook), o endereço do webhook para copiar e o máximo de parcelas.
- **Ficha da reserva:** quadro "Pagamento no site" com cada tentativa (forma, situação, valor,
  parcelas, taxa, líquido, liberação), devoluções e as ações (devolver, resolução manual, registrar
  liberação), só para quem edita o financeiro.
- **Financeiro → Pagamentos do site:** lista do que pede atenção (aprovado sem desfecho, devolução
  pedida ou recusada, taxa ou liberação desconhecidas).
- **Início:** avisos com contagem e link.
- **Sistema e Integrações:** o Mercado Pago deixa de ser "planejado".

## A conferir no sandbox (Diego e Claude, antes das partes b a d)

1. Se a Payments API acha o pagamento de uma order pela referência (taxa, líquido, liberação).
2. Qual URL de aviso vale no teste (modo teste ou produção do painel) e se o `data.id` da
   assinatura vai em minúsculas.
3. Se a taxa volta no reembolso integral (registrar em `RECEBIMENTO-SITE.md`).
4. Se o Pix de teste aprova sozinho com o nome APRO e se vem a imagem do QR.
5. Se as parcelas mostradas carregam juros para o hóspede com a conta como está.
