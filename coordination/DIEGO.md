# Sage → Lia / Rivers — retorno à estadia corrigido — 21/09/2026
Início 20h15 BRT, correção e testes concluídos 20h18. Achado recebido no handoff Lia 2026-09-21-2000-lia-validacao-parcial-pr11.md do PR #14.
## Implementado
/demo/pagamento oferece “Voltar à revisão da estadia” com o mesmo imóvel, entrada, saída e hóspedes validados no servidor. Elimina exemplo fixo 102/outubro. Critérios inválidos retornam à revisão sem propagar entrada inválida; parâmetros extras e preços/contatos não são copiados. Cenários fictícios são reavaliados ao voltar; nenhuma disponibilidade real é prometida.
## Verificado
17 arquivos de src/public/test da cópia temporária comparados por hash Git com head 4ce4366 antes da edição. Regressão falhou antes e passou depois; 31/31 testes Node24 passaram com portas localhost autorizadas. Novo teste cobre 403/quatro hóspedes, todos os cinco cenários, descarte de parâmetros extras e entrada inválida. Alterados apenas view e teste, além da coordenação. CI do novo head será conferido e registrado na descrição do PR.
## Limites e próximo
Lia executou nove testes na rodada anterior; 21 cenários HTTP foram bloqueados por listen EPERM e não representam defeitos da aplicação. Não houve validação visual dela. Após CI final, Lia retoma busca/calendário/mobile/pagamento, e Rivers já pode revisar o diff mínimo. PR #11 continua draft, sem recomendação de merge. Todos os merges exclusivamente Diego. #14/#15/#16/#17 permanecem trilhas independentes, sem alteração desta rodada.
Trabalho na cópia temporária /tmp/scl-return-fix-2015; preview original 4173 e documento-mestre local ainda não receberam esta correção por restrição de escrita desta rodada. GitHub é a versão compartilhável atual; não alegar que a tela aberta mudou. Nenhuma produção, cobrança, integração ou dado privado.

---
Histórico da rodada anterior:

# Sage — reconciliação do PR #11 — 21/09/2026, 19h17 BRT
Início 19h17; preparação concluída 19h19. Handoff Rivers 19h15 do PR #16 recebido e lido; Lia publicou guias no #14, sem atribuir validação visual ao trabalho documental.
## Implementado
Incorporada main be0860e46be3c209152a2c5de2f1b042128503ad à branch do #11 por commit com dois pais, sem force push e sem merge de PR em main. Conflitos apenas documentais; implementação, testes, assets e workflow do #11 preservados byte a byte. RIVERS e handoff 07h28 incorporados de main. Estados anteriores CURRENT/SAGE/DIEGO preservados em snapshots; a coordenação posterior de Rivers continua no PR #16 e suas tarefas não foram revertidas.
## Verificação
Os 30 testes locais passaram na entrega anterior; não são uma execução nova desta rodada. Conferir CI e mergeabilidade no head reconciliado: resultados serão registrados na descrição do PR, sem criar commit recursivo apenas para atualizar check. Sem alteração funcional, não repetida correção HTTP já entregue.
## Próximo
Lia: após CI success, validar busca, datas, capacidade, mobile e pagamento fictício neste head final. Rivers pode revisar reconciliação/evidências agora; recomendação de merge do produto aguarda validação de Lia e revisão final. #11 permanece draft; Diego não precisa fazer merge agora. #14 é reconciliação independente da Lia, #15 validação independente. #16 continua coordenação Rivers não mergeada.
## Limites
Sem produção, merge humano, integrações reais, alteração de preços/reservas, regras administrativas ou automações. Workspace original não foi alterado nesta rodada; registro compartilhável no GitHub, atualização do documento-mestre local pendente por permissões de escrita desta execução. Última discussão de armazenamento mantém S3 como recomendação por controles de retenção/recuperação; não é contratação aprovada.

Históricos preservados: [branch](handoffs/2026-09-21-1917-anterior-DIEGO.md), [main](handoffs/2026-09-21-1917-main-DIEGO.md). Coordenação Rivers posterior: PR #16.
