# Jornada de reserva, e-mail, Lia e portal — direção de 20/09/2026

Estado: especificação para a próxima entrega. Não há envio de e-mail, reserva persistida, checkout ativo, autenticação ou portal nesta versão. Mercado Pago foi escolhido por Diego; o fornecedor de e-mail e o domínio de envio ainda dependem de configuração.

## Fluxo desejado

1. Lia entende a demanda e envia link público do imóvel com `property`, `checkin`, `checkout` e `guests`. Os formulários atuais já aceitam esses critérios. Exemplo local: `/consulta?property=399&checkin=2026-10-10&checkout=2026-10-13&guests=2`. A URL de produção depende de confirmar destino. Nenhum nome, e-mail, telefone, preço confiável ou segredo na URL.
2. Site revalida imóvel, lotação, datas e disponibilidade; backend calcula cotação canônica com validade, moeda, diárias, limpeza, demais taxas e políticas. Preço no link nunca tem autoridade. Uma oferta personalizada futura usa referência opaca a uma cotação armazenada, não valores arbitrários no navegador.
3. Checkout coleta os dados mínimos necessários: nome, e-mail e telefone; não exigir criar conta antes da compra. Validar/verificar contato. Endereço/documentos só quando necessários e em fluxo autorizado. Identificar pessoa, usuário e organização separadamente.
4. Reserva e tentativa de pagamento têm IDs próprios e estados explícitos. Controle de concorrência protege inventário; pedido e webhook são idempotentes. Retorno do navegador não prova pagamento. Confirmar apenas após eventos verificados de pagamento e inventário segundo a política aprovada. Resolver expiração, cobrança sem inventário e reembolso de maneira auditável.
5. Evento canônico de reserva confirmada grava uma outbox na mesma transação. Worker envia e-mail de confirmação. Falha de e-mail não desfaz nem duplica reserva. Registrar queued, attempted, accepted, delivered, bounced, failed; entregue não prova leitura. Webhooks assinados, deduplicação, retries limitados e alerta de falha.
6. E-mail inclui código SCL, imóvel, datas, hóspedes, valores/políticas reais e botão para acompanhar a estadia. Visual da mesma família do site: símbolo azul, musgo/areia, leitura simples, HTML acessível com versão texto e layout de uma coluna. Não incluir segredo de porta antes da janela de liberação.
7. Portal e Lia usam a mesma política backend de autorização. Código de reserva mais e-mail digitado serve para localizar e iniciar verificação, nunca para autenticar. Enviar OTP ou link curto de uso único ao contato cadastrado, ou usar sessão OAuth ligada de forma segura à pessoa/reserva. Respostas genéricas, limite de tentativas, expiração, revogação e trilha de auditoria. Nunca enviar verificação para um contato novo informado pelo solicitante sem fluxo seguro de alteração.
8. Portal mostra reserva própria, pendências e countdown até `accessReleaseAt`. Hora do servidor e política por reserva governam liberação. Alterar relógio do aparelho não libera dados; segredo não fica oculto no HTML/JS antes da hora. Reserva cancelada ou outra condição impeditiva revoga acesso. Lia também consulta essa política antes de responder.
9. Job de liberação pode enviar instruções por e-mail e atualizar portal; ambos derivados do mesmo estado. Hora exata da janela ainda precisa de aprovação de Diego. Countdown é apresentação, não mecanismo de autorização.

## Identidade e código de reserva

Direção proposta de formato, ainda sujeita à aprovação: `SCL-XXXX-XXXX-XXXX`, caracteres aleatórios sem ambiguidades, gerados com fonte criptográfica. Não codificar nome, datas, imóvel ou sequência de vendas. Índice único no banco e retry de colisão. O código público não substitui UUID interno, ID de hóspede ou IDs dos canais e não é segredo suficiente para obter dados privados. Não há código real emitido neste preview.

IDs de pessoa, usuário, proprietário, imóvel, reserva, organização e actor permanecem distintos. Diego pode acumular papéis sem duplicar identidade. Conectar OAuth a uma reserva exige vínculo verificado; não confiar só em endereço de e-mail alegado pelo cliente.

## Infraestrutura de e-mail pendente

Confirmar domínio, remetente, caixa monitorada de Reply-To e fornecedor; não presumir contratação de Resend pela presença de uma skill. Configurar SPF/DKIM/DMARC com registros exatos do fornecedor, validar DNS, proteger credencial no servidor. Outbox persistente, chave idempotente baseada no evento/versão/destinatário e registro durável para evitar duplicatas mesmo após expirar a janela do fornecedor. Processar falhas de entrega e supressões; alertar operação quando a confirmação não chega. Não registrar OTP, tokens, conteúdo sensível ou e-mail completo em logs públicos. Sem envio nesta entrega.

## Indicação e posicionamento

Programa de indicação com eventual 20% na próxima estadia é proposta de Diego, não benefício ativo. Antes de lançar: definir quem ganha, quando nasce o benefício, base do desconto, teto, validade, datas excluídas, não acumulação, cancelamentos, autoindicação e fraude. Desconto pertence à cotação canônica, com evidência e vínculo do referral; não ao cliente. Não publicar cupom que não possa ser honrado.

Manter “casas”. Não introduzir “sempre mais barato que Airbnb” sem política comparável de datas, hóspedes, condições e preço final. Direção editorial sugerida: vantagens da reserva direta, sem promessa absoluta. Não adicionar marketing ao e-mail transacional nem presumir consentimento promocional por ter uma reserva.

## Aceitação da próxima etapa

- Webhook repetido não duplica reserva/e-mail; timeout não vira sucesso.
- Pagamento pendente, expirado ou recusado não recebe confirmação de reserva paga.
- Código + e-mail correto sem prova de posse não revela sequer endereço privado/instruções.
- Link de acesso expirado/reutilizado/revogado não autentica.
- Hóspede A não acessa reserva B; Lia obedece à mesma restrição.
- Antes da janela, API e HTML não retornam segredos; depois, só para identidade e reserva autorizadas.
- Dados do link são validados e preço recalculado no servidor.
- E-mail aceito, entregue e falho têm evidências diferentes.


## Atualização v0.6

Consulta já pode ser recebida e persistida localmente com protocolo SCL-Q e estado RECEIVED_LOCAL. Após envio, um segundo consentimento registra interesse no futuro portal. Isso não implementa reserva, conta, e-mail ou notificação à Lia. Esse store privado local é substituível pelo núcleo canônico, não uma segunda fonte operacional definitiva.
