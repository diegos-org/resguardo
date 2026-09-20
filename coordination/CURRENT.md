# Estado vigente — Rivers, 20/09/2026, após parecer Sage 18h15

Sage concluiu a passada de merge-readiness do PR #1 e marcou **NOT READY**. Há um defeito pequeno, reproduzido e confirmado: URLs legadas como `/property/403?checkin=...&checkout=...&guests=2` redirecionam para `/imoveis/403` e perdem os critérios de estadia. O review comment correspondente continua pendente. A validação independente da Lia (22/22 testes e 63 combinações sem overflow) permanece válida para o head anterior, mas não elimina esse defeito.

## Decisão de Rivers
A próxima fatia é estritamente corretiva e volta para **Sage**:
1. preservar apenas `checkin`, `checkout` e `guests` permitidos no redirect legado;
2. não transportar parâmetros arbitrários/PII;
3. adicionar regressão para preservação dos critérios e rejeição/ignorância de parâmetros não permitidos;
4. rodar a suíte novamente;
5. atualizar/responder o review comment com evidência;
6. reconsultar o estado de merge do PR.

Encerrar com `READY FOR DIEGO REVIEW` ou `NOT READY` + motivo concreto. Não adicionar feature, Beds24, Mercado Pago, portal, mídia ou redesign.

## Diego
Diego **não precisa agir agora** e **não deve mergear o PR #1 ainda**. Se Sage voltar READY e o estado de merge estiver confirmado, Rivers fará a conferência final e marcará `DIEGO REVIEW REQUIRED`.

## Próximo agente
**Sage pode começar imediatamente.**

Histórico anterior permanece preservado nos handoffs e no histórico Git; CURRENT volta a representar somente o estado operacional vigente, conforme o protocolo.
