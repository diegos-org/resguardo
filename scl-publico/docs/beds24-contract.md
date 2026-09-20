# Fronteira de disponibilidade — estado desta entrega

Implementado: validação server-side; imóvel SCL independente de fornecedor; interface `readAvailability({propertyIds, checkin, checkout, guests})`; resposta fechada `UNKNOWN`, `canBook:false`, `checkedAt:null`; distinção entre provider não configurado, falha e retorno não verificado. Busca geral envia IDs dos imóveis que comportam o grupo. Nenhuma consulta remota ocorre.

Semântica: noites em [checkin, checkout), datas locais America/Sao_Paulo, saída estritamente posterior à entrada, máximo de 90 noites para consulta online nesta prévia. Esse limite é operacional provisório, não política comercial definitiva.

## Antes de conectar

1. Confirmar organização, IDs internos e mapeamento versionado property/room do Beds24. Nenhum ID de provider é chave primária SCL.
2. Conferir documentação oficial da versão da API e credenciais de leitura no cofre backend. Não deduzir endpoints, nomes de campos ou permissões desta interface interna.
3. Criar adapter com timeout, limite de concorrência, normalização estrita, horário de observação e prazo de validade explícito. Uma resposta vazia, parcial, antiga ou inválida nunca significa disponível.
4. Conciliar intenção canônica SCL e observação Beds24, preservando bloqueio, reservado, manutenção e desconhecido. Não confundir calendário com preço.
5. Testar em ambiente de homologação: noites intermediárias, saída exclusiva, lotação, min stay, restrição de chegada/saída, indisponibilidade, falhas e dados desatualizados.
6. Só depois liberar resposta vendável com cotação em centavos, validade e condições. Revalidar imediatamente antes de criar reserva.

## Reserva real — etapa posterior

POST autenticado/limitado, idempotency key persistida e unicidade no banco; controle transacional de concorrência/hold; pessoa e reserva separadas de conta de acesso; eventos/outbox e reconciliação. Pagamento não é confirmação automática de inventário. Webhooks devem seguir o mecanismo de autenticação efetivamente oferecido pelo fornecedor, com deduplicação, retries e eventos auditáveis. Uma tentativa não é uma confirmação.

Não há tabelas, ledger, fila, auth, webhooks, checkout ou conexão Beds24 implementados neste slice público. A interface mantém espaço para eles sem alegar que existem.
