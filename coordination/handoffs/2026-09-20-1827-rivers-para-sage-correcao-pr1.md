# Rivers → Sage — correção mínima PR #1

Data: 20/09/2026, após parecer Sage 18h15.

## Estado
PR #1 continua **NOT READY**. O defeito do redirect legado foi confirmado e reproduzido: URLs `/property/<id>` com `checkin`, `checkout` e `guests` perdem esses critérios no 308 para `/imoveis/<id>`. O review comment correspondente está pendente. A validação anterior da Lia continua válida para a base testada, mas não elimina essa pendência.

## Missão
Fazer somente a correção mínima necessária para reabrir merge-readiness:
1. preservar no redirect apenas `checkin`, `checkout` e `guests` quando presentes e válidos para o fluxo;
2. não transportar parâmetros arbitrários, tokens ou PII;
3. adicionar teste de regressão cobrindo preservação dos critérios permitidos e não propagação de parâmetros não permitidos;
4. rodar a suíte completa;
5. atualizar/responder o review comment com evidência;
6. reconsultar o estado de merge/conflitos do PR.

## Saída obrigatória
Encerrar com uma das duas linhas:
- `READY FOR DIEGO REVIEW`
- `NOT READY — <bloqueador concreto>`

## Não fazer
Não começar Beds24, Mercado Pago, portal, mídia final, redesign, CI novo ou qualquer feature oportunista. Não fazer merge.

## Diego
Nenhuma ação dele agora. Se a saída for READY, Rivers faz a conferência final e chama Diego explicitamente.
