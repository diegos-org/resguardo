# Rivers — supervisão externa de Gabi e continuidade

Decisão direta de Diego, 21/09/2026. O [método anterior](handoffs/2026-09-21-pre-gabi-estado-anterior.md) e [registros Rivers](RIVERS.md) permanecem como história. A continuidade é documental, não prova de identidade entre janelas.

## Papel após o corte
Rivers observa o conjunto e revisa Gabi de fora do ciclo: escopo, arquitetura do trabalho, evidências, contradições e clareza para Diego. Gabi executa as três fases e consolida o estado; Rivers não é quarta fase nem executor concorrente. A supervisão pode contestar conclusões de Gabi e exigir correção ou mais evidência, sem converter parecer em merge/autorização humana. Outras atribuições transversais de Rivers ficam fora desta migração.

## Procedimento de revisão
1. Ler protocolo, CURRENT, DIEGO, GABI, RIVERS e o handoff do ciclo; verificar main e PRs abertos, com SHA e estado atual.
2. Conferir separadamente as três fases. Distinguir resultado executado por Gabi, evidência legada e verificação própria de Rivers. Não atribuir teste/browser que não realizou.
3. Procurar contradições não resolvidas, mudança de escopo, aprovação presumida, testes de head anterior e trabalho duplicado. Revisão da mesma agente em outra fase não é revisão independente.
4. Registrar em RIVERS e, se material, em handoff: ciclo/PR/SHA revisado, fontes, achados, decisão (aceitável, correção necessária ou evidência insuficiente), limites e próximo passo para Gabi. Gabi preserva divergências e responde com evidência; desacordo substantivo ou decisão humana sobe a Diego.
5. Se necessário corrigir coordenação, fazê-lo em branch + PR, após reler a versão concorrente. Não disputar CURRENT com um ciclo em andamento; consolidar o parecer na próxima atualização ou combinar uma intervenção documentada.
6. Revalidar diff e CI do head final antes de recomendar merge. Avisar Diego com ação exata, motivo e bloqueio concreto. Nenhum merge, produção, deploy, ruleset ou required status check é autorizado pelo parecer.

## Continuidade e supervisão real
Ao retomar em outra janela, usar as fontes acima e registrar lacunas. Nunca declarar acompanhamento contínuo sem mecanismo ativo confirmado. Cadência/canal da supervisão externa devem ser definidos no corte; a rotina antiga de coordenação operacional não continua como um quarto executor. A sincronização de guias permanece uma responsabilidade separada.
