# Sage → Rivers — prontidão PR #1, rodada 18h15 de 20/09/2026

**NOT READY** — correção mínima e estado de merge pendentes. Sem pedido de merge a Diego.

## Evidência

Lidos protocolo, CURRENT, SAGE, DIEGO e handoff Rivers de merge-readiness. Reconhecida validação independente da Lia 18h07 (22/22 testes, fluxos fictícios e 63 combinações sem overflow), sem reapresentá-la como execução de Sage.

PR #1 aberto, sete commits, 19 arquivos, head 34d8ff22e0a14c53f69ac2e602f9eb6e3ff23765. Revisão automática deixou uma conversa não resolvida em server.mjs: redirecionamento legado descarta critérios. Reproduzido na cópia recebida e anteriormente verificada por hashes: GET/HEAD `/property/403?checkin=2026-10-10&checkout=2026-10-12&guests=2` → HTTP 308, `Location: /imoveis/403`, sem critérios. Não é hipótese.

GitHub segue mostrando Checking for the ability to merge automatically após leitura e um reload. Não afirma conflito, mas também não comprova ausência. Conector ainda Unknown tool. Não inferir mergeability pelo botão Merge. Checks0: sem CI, testes são execuções locais documentadas.

## Classificação

Bloqueadores da recomendação de merge no workbench: (1) defeito confirmado do redirect e conversa pendente; (2) estado de conflitos não confirmado. Correção mínima sugerida para próxima fatia Sage: preservar critérios públicos permitidos checkin/checkout/guests no Location, não transportar parâmetros arbitrários/PII; teste de regressão do link e proteção contra parâmetros não permitidos, mantendo validação de valores/duplicatas no fluxo. Atualizar PR, verificar resultado e resolver conversa somente com evidência. Confirmar conflitos quando GitHub concluir a checagem ou por comparação autorizada das árvores.

Bloqueadores de produção, não da existência da base no workbench: disponibilidade/cotação persistida, reservas/pagamentos idempotentes, Beds24/Mercado Pago, auth/portal/e-mail, fronteira HTTPS/abuso/privacidade, mídia final autorizada e validação em dispositivos reais. Não implementar esses itens nesta rodada.

Melhorias futuras: CI automatizado e refinamentos visuais após catálogo de referências de Diego. Mocks e busca translúcida adiados por pedido dele; não redesenhar.

## Mobile complementar efetivamente verificado

Navegador integrado, cópia workbench em loopback4174, sem simular aparelho real. Consulta320×568 com calendário: documento320px; dialog272×464,9 em x36/y91, contido. Paisagem568×320: documento568; dialog340×296 em x170/y12, rolagem interna para conteúdo de463px. Fechar calendário foi acionável e devolveu foco ao botão de entrada.

Em320px, saída anterior à entrada e capacidade excedida renderizam erros sem overflow; pergunta longa preenchida sem envio mantém documento320px, campo220px. Sem erros/warnings capturados no console. Meta viewport permite zoom (sem maximum-scale/user-scalable=no); zoom gestual/ampliação de texto não foram testados. Teclado virtual, Safari iOS, Chrome Android real e Fold não disponíveis nesta checagem. Override de viewport restaurado.

## Resultado e próxima vez

Somente revisão nesta rodada, conforme missão de Rivers: nenhum código modificado, merge, deploy, integração ou reserva. Rivers já pode revisar este parecer e encaminhar a correção mínima a Sage. Diego não precisa agir agora. Não marcar DIEGO REVIEW REQUIRED até superar pendências.
