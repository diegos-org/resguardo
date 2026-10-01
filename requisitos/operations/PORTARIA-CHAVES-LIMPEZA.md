# Portaria, chaves e limpeza — 103 e 399

Decisões diretas de Diego em 1/10/2026. Regras compartilháveis; telefones, endereços privados alternativos e códigos ficam no cadastro operacional restrito, fora deste arquivo.

## Limpeza antes da entrada
Antes de indicar ou pedir limpeza, conferir a última limpeza efetivamente confirmada e se houve ocupação ou uso posterior. Se já estiver limpo e sem novo uso, indicar somente check-in e logística de chaves. Se faltar confirmação, registrar estado a confirmar e consultar histórico/equipe antes de convocar deslocamento. Checkout, escala e calendário vazio não comprovam limpeza executada.

## Porteiros
- 103/Boutique: Joezio. Expediente informado pela equipe em 23/9: segunda a sábado 9h–19h; almoço 12h–14h; domingo folga; feriados precisam confirmação.
- 399/Orgânico: Raimundo. Segunda/quarta/sexta 7h–17h; terça/quinta 7h–19h; sábado 7h–14h; almoço 12h–13h30; domingos e feriados folga.
- Diego confirmou diretamente os dois telefones em 1/10. Não usar o número antigo do contato “Raimundo Porteiro Barto” nem associar outros Raimundos pelo nome.
- Horários de outro negócio exibidos no perfil WhatsApp não são horários da portaria.
- Presença de porteiro não autoriza early check-in nem garante guarda de malas.

## Retirada de chaves
Priorizar retirada combinada na própria portaria durante o expediente. Fora do expediente/almoço/folga, combinar previamente alternativa com a equipe.
Diego confirmou a portaria 24h da Aristides Espínola como alternativa tanto para103 quanto399. Endereço completo no cadastro restrito/instrução privada. Só direcionar após confirmar que as chaves estarão naquele local; respeitar horário do check-in ou exceção expressa. Conferir chaveiro e imóvel, especialmente porque o Orgânico399 tem unidade303 e não é o Quadra Praia303.
A alternativa já combinada numa reserva prevalece; não reenviar instruções contraditórias só porque o modelo geral mudou.

## Mensagens automáticas e estado verificado
Em1/10 foram salvos e reabertos no Airbnb:
- “02 B - Checkin 103 - Porteiro e retirada de chaves”: telefone confirmado, expediente e alternativa condicionada à combinação.
- “02 F - Checkin 399 - Studio Orgânico Leblon”: telefone confirmado, expediente e alternativa Aristides Espínola.
Mantidos campos dinâmicos e programação de dois dias antes do check-in às10h. A revisão não prova disparo futuro, não reenvia mensagens antigas e não cria automação paralela Beds24.
No103, o texto antigo afirmava ausência de porteiro para toda chegada; no399, não explicitava expediente. Corrigidos. Pedido de previsão de chegada passou a tratar organização da chegada, sem presumir faxina necessária.

## Cadastro na nuvem — pendência explícita
Preferência aprovada: cadastro restrito do sistema SCL, com imóvel, função, telefone, expediente, exceções, fonte/data e última conferência. GitHub documenta regra e referência, não armazena os telefones em documentação geral.
Alternativa autorizada por Diego: variáveis internas de ambiente na Vercel, se cadastro ainda não disponível. Não usar prefixos públicos, não enviar valores ao frontend/logs e não confundir variável criada com aplicação lendo-a. Conferir projeto, ambiente e consumo pelo código antes de afirmar integração.
Ainda não foi gravado cadastro remoto nem variávelVercel nesta etapa. Telefones já estão nos modelos privadosAirbnb e na cópia local restrita `outputs/privado/contatos-portaria-103-399.md`. A cópia local não satisfaz sozinha o cadastro do futuro agente na nuvem.
