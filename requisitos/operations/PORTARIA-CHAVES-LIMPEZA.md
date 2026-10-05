# Portaria, chaves e limpeza — 103 e 399

Decisões diretas de Diego em 1/10/2026. Regras compartilháveis; telefones, endereços privados alternativos e códigos ficam no cadastro operacional restrito, fora deste arquivo.

## Versão e agenda vigente

Complemento de 5/10/2026 (a versão na `main` é a mesclada; cópia candidata deve identificar branch/PR e commit). Para atendimento, janelas da agenda, dados operacionais e horários acordados, começar pelo [Guia Lia consolidado](GUIA-LIA-ATENDIMENTO.md). Rio mantém cinco dias, com limpezas por dia separadas de entradas/chaves; Búzios passa a no máximo cinco próximas reservas dentro de 30 dias, ou menos quando houver menos; substitui o pedido de 2/10 de listar todas. Primeiro nome e quantidade de hóspedes em ambos; telefone operacional quando disponível e autorizado. O [PR81](https://github.com/al-life/scl-reconstrucao/pull/81) (item M6.7 do roadmap) implementa a agenda e o registro manual de pedido/aceite na ficha da reserva; o estado de mesclagem é o do GitHub. Fluxo, prioridade dos horários e limites de telefone/canais estão no guia; nenhum envio ou integração automática é comprovado por isso. As evidências de 1/10 abaixo são preservadas.

## Limpeza antes da entrada
Antes de indicar ou pedir limpeza, conferir a última limpeza efetivamente confirmada e se houve ocupação ou uso posterior. Se já estiver limpo e sem novo uso, indicar somente check-in e logística de chaves. Se faltar confirmação, registrar estado a confirmar e consultar histórico/equipe antes de convocar deslocamento. Checkout, escala e calendário vazio não comprovam limpeza executada.

O checkout dispara a necessidade: saída normal ou late até cerca de 12h–13h permite limpeza no mesmo dia; late no fim do dia fora da jornada desloca para a próxima manhã disponível, desde cedo (cerca de 8h), sem esperar 11h. Confirmar saída e disponibilidade da equipe. Esta decisão de 5/10 é operacional; não comprova alteração do gerador da agenda.

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

## Documentos — esclarecimento de Diego nesta revisão

Até segunda ordem, solicitar e encaminhar documentos somente no 403. O 303 Rita deixa de constar como exigência ou pendência de coleta. Diego relata pouca ou nenhuma cobrança pela portaria do 403; isso não dispensa a regra do 403 nem cria cobranças extras. Preservar o fluxo e os limites de repetição do [Guia Lia](GUIA-LIA-ATENDIMENTO.md#portaria-e-documentos). Este registro não realiza envios.

## Cadastro na nuvem — pendência explícita
Preferência aprovada: cadastro restrito do sistema SCL, com imóvel, função, telefone, expediente, exceções, fonte/data e última conferência. GitHub documenta regra e referência, não armazena os telefones em documentação geral.
Alternativa autorizada por Diego: variáveis internas de ambiente na Vercel, se cadastro ainda não disponível. Não usar prefixos públicos, não enviar valores ao frontend/logs e não confundir variável criada com aplicação lendo-a. Conferir projeto, ambiente e consumo pelo código antes de afirmar integração.
Em 1/10/2026, foram salvas e verificadas na Vercel, projeto `scl-reconstrucao` da equipe AL Apps, as variáveis `SCL_PORTARIA_103_TELEFONE` (Joezio) e `SCL_PORTARIA_399_TELEFONE` (Raimundo). Ambas são do tipo Secret, restritas ao ambiente Production e sem prefixo público. Os valores reais não fazem parte deste repositório. Telefones também permanecem nos modelos privados Airbnb e na cópia local restrita `outputs/privado/contatos-portaria-103-399.md`, protegida pelo `.gitignore` da raiz.

O cadastro das variáveis foi confirmado pela interface; **o consumo pelo código e pelo futuro agente ainda não foi implementado nem validado**. A Vercel exige nova implantação para disponibilizar variáveis novas às funções; não houve redeploy nesta etapa. Ao implementar, ler somente no servidor, liberar o contato apenas para a reserva validada e o imóvel correto e nunca expor em logs, páginas públicas ou respostas genéricas. Não criar endpoint público de consulta dos contatos. Preview e Development devem usar dados fictícios.
