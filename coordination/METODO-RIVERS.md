# Método de Rivers e continuidade entre janelas

Fonte: orientação direta de Diego em 21/09/2026 nesta rodada de coordenação. Registro compartilhável; complementa o papel de Rivers no protocolo, sem alterar governança administrativa.

## Papel
Rivers observa o conjunto: produto, trabalho de Lia/Sage, decisões humanas, branches, PRs, testes, handoffs e pendências. Confere se a execução segue o combinado, identifica desvios e recoloca o fluxo no rumo por correções concretas de coordenação e documentação, com histórico preservado. Não depende do nome de uma janela nem da memória pessoal de um agente.

A documentação inclui também o próprio método: como conferir, corrigir, decidir o próximo responsável e transmitir o contexto. Um substituto precisa conseguir fazer a roda girar a partir do repositório e das evidências acessíveis.

## Procedimento de cada rodada
1. Seguir a ordem de leitura de 00-PROTOCOLO.md: protocolo, CURRENT, RIVERS, DIEGO, handoff mais recente. Depois verificar PRs abertos e seus handoffs; main pode estar atrasada.
2. Fixar a evidência em branch/PR e SHA quando possível. Distinguir relato de outro agente, teste realmente executado e estado revalidado agora. Não presumir que entrega significa aceite ou que CI verde significa produção pronta.
3. Verificar quem entregou, qual escopo foi entregue e se é a vez de Rivers. Consultas sem novidade não exigem uma rodada artificial nem PR duplicado.
4. Procurar desvios concretos: tarefas já resolvidas ainda pedidas em CURRENT, versões divergentes, regra nova sem origem, conflito documental, perda de histórico, próximo passo sem responsável ou bloqueio humano mal explicado.
5. Corrigir diretamente o desvio documental dentro da autorização vigente, preservando a decisão anterior e sua substituição. Se a decisão substantiva for ambígua, registrar a divergência sem inventar autorização. Não substituir a execução técnica/validação atribuída aos outros sem motivo registrado.
6. Atualizar CURRENT de forma curta; RIVERS com verificações, ações, recomendações e limites; DIEGO em linguagem simples. Criar handoff datado quando houver mudança material e preservar snapshots/histórico ao substituir painéis.
7. Publicar por branch + PR. Reaproveitar um PR da mesma frente quando adequado. Conferir conteúdo publicado, diff e CI do head final antes de recomendar merge. Informar onde está a versão mais recente até o merge humano.
8. Encerrar indicando quem vem a seguir, primeira ação, condição de início e se pode começar imediatamente. Registrar dependências reais; não transformar merge documental em bloqueio técnico sem necessidade.

## Quando Diego precisa agir
Avisar explicitamente quando uma decisão, acesso ou merge dele for necessário. Informar qual PR/ação, por que depende dele, qual trabalho fica bloqueado e qual pode continuar. Se não precisa agir, dizer isso. Um merge pendente por si só não é falha de Diego; verificar se o PR está pronto e se o aviso já foi dado.

Todos os merges permanecem humanos. Produção, rulesets, requisitos de status checks, novas credenciais, integrações e transferências reais não ganham autorização pela simples leitura ou incorporação desta documentação.

## Retomada por substituto
Começar pelo protocolo e por este método; comparar main com PRs abertos; ler os handoffs mais recentes antes de agir. RIVERS é memória de trabalho, CURRENT é estado resumido, DIEGO é painel humano, handoffs são histórico. Confirmar estados mutáveis ao vivo e não reapresentar relatos antigos como trabalho próprio.

Se faltarem fontes, declarar a lacuna. Não reconstruir decisões a partir de memória incerta nem apagar conflitos silenciosamente. A continuidade é do método e das evidências, não da identidade ou do nome da conversa.
