# RIVERS

## Rodada — 20/09/2026 após Sage 18h15

### Verificado
- Li o protocolo, CURRENT, DIEGO e o handoff Sage → Rivers de prontidão do PR #1.
- O review encontrou e Sage reproduziu um defeito real no redirect legado: `/property/<id>` perde `checkin`, `checkout` e `guests` ao redirecionar.
- O comentário de review está coerente com o defeito observado.
- A validação independente anterior da Lia continua relevante, mas foi feita antes dessa correção e não transforma o PR atual em pronto para merge.
- O estado de merge do GitHub ainda não foi confirmado de forma confiável.

### Decisão de coordenação
Não abrir nova frente. Fazer uma única correção mínima no PR #1 e então repetir merge-readiness.

### Próxima missão — Sage
1. Corrigir o redirect legado preservando somente os critérios públicos permitidos (`checkin`, `checkout`, `guests`).
2. Não carregar parâmetros arbitrários, tokens ou PII.
3. Adicionar teste de regressão para o caso válido e para parâmetros não permitidos.
4. Rodar a suíte de testes novamente.
5. Atualizar/responder o review comment com a evidência da correção.
6. Verificar novamente o estado de merge/conflitos.
7. Encerrar explicitamente com `READY FOR DIEGO REVIEW` ou `NOT READY` + bloqueador restante.

### Não fazer
- não integrar Beds24;
- não integrar Mercado Pago;
- não criar portal;
- não mexer em produção;
- não redesenhar;
- não adicionar melhorias oportunistas.

### Diego
Nada para Diego agora. Não pedir merge até Sage concluir essa fatia e Rivers conferir o resultado final.

### Próxima vez que Rivers entrar
Se Sage voltar READY, conferir head, testes e mergeability e então marcar `DIEGO REVIEW REQUIRED`. Se voltar NOT READY, encaminhar apenas a correção mínima restante.
