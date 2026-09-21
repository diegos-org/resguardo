# Serviços externos — fila de execução21/9
Pedido direto de Diego: terminar cada etapa com resultado conferido e deixar a próxima aba pronta; evitar pendências sem próximo passo.

| Ordem | Serviço | Entrega antes de avançar | Dependência humana |
|---|---|---|---|
|1|Beds24|Reservas/bloqueios/preços/mínimos reconciliados; divergências resolvidas e prévia de sync|Login/redefinição pelo titular; decisões comerciais reais|
|2|Booking|Conta/anúncios existentes identificados; um imóvelRio preparado sem duplicação; conferir antes da abertura|Login, contrato/verificações se exigidos|
|3|Cloudflare|Inventário domínio/DNS e e-mails, teste de recebimento/envio; decidir caixa postal real se necessária|Login e escolha de serviço/custo se houver|
|4|Mercado Pago|Conta/aplicação conferidas e desenho de teste de pagamento, sem cobrança real|Login/identidade recebedora; credenciais no cofre adequado|
|5|Neon|Modelo e base de homologação com dados fictícios e separação de acessos|Conta/plano/permissões quando exigidos|
|6|Vercel|Homologação usando base/backend, variáveis seguras, testes de integração|Conta/plano/acessos/publicação especificamente autorizados|
|7|Mercado Pago + Beds24 + Cloudflare|Testes fim a fim de webhooks/reserva/pagamento; só depois domínio e lançamento|Revisão concreta final de produção|

A etapaMercadoPago divide preparação de conta e teste integrado: webhook depende de backend disponível. Não inventar endpoint nem criar cobrança só para testar. Cloudflare não deve apontar domínio público antes da homologação. Encaminhamento de e-mail não equivale a caixa postalIMAP; preservar serviço atual até validar substituto. Ordem prática proposta, ajustável a bloqueios de login sem deixar outras preparações paradas.

## Replicar Airbnb no Booking — pesquisa21/9
É semiautomático: Beds24 reaproveita dados e fotos, mas a criação direta exige contaBeds24 verificada e contaBooking de grupo/Legal Entity ID. Pode haver contrato. Se anúncio já existe, mapear em vez de criar outro. Conteúdo precisa passar validações; descrição pode não ser publicada literalmente. Fotos, políticas, comodidades, quartos/camas e preços exigem conferência. Há campos complementados na extranet e erros de contrato/permissão/mapeamento. Criado não significa aberto para reservas.
Recomendação: aproveitar importação já feita; testar um imóvel próprioRio até estado finalconferido, depois repetir nos demais. Não há evidência para prometer clonagem emumclique ou diagnosticar a antiga falha da Hospedo.
Fonte oficial consultada21/9: https://wiki.beds24.com/index.php/Booking.com:_Create_and_update_properties_and_rooms_on_Booking.com
Sequência multicanal: https://wiki.beds24.com/index.php/Using_Airbnb_and_Booking.com

Pesquisa concluída; nenhuma conta/configuração externa alterada por este documento.
