# Diego — Gabi organizada; ativação ainda pendente

A migração documental transforma a construção do SCL em um ciclo de Gabi: primeiro analisa e implementa, depois confere na prática/browser e por fim consolida resultados e próximo passo. Ela mantém o contexto entre as fases e registra quando as evidências discordam. Rivers revisa de fora. Sage, Lia e Rivers continuam documentados na história com a autoria original.

## O que está pronto e o que falta
Protocolo, memória Gabi, supervisão Rivers e [passagem das rotinas](handoffs/2026-09-21-migracao-gabi.md) estão propostos em `docs/gabi-coordination-migration-20260921`. A branch parte da documentação do #16; a versão ainda não está na principal. Nenhuma tarefa Gabi foi criada ou ativada, e nenhuma rotina antiga foi desligada.

Esta rodada confere documentos e o estado dos PRs; não executa teste funcional nem validação de browser do produto. O #11 continua rascunho e sua validação visual permanece pendente. Nenhum parecer de Rivers sobre Gabi foi inventado. O perfil/guia de comunicação do Diego entrou somente em Labs para o futuro.

## O que depende de você
1. Revisar e fazer os merges documentais: #16 primeiro; depois esta migração, após reconciliação com main, revisão do diff e CI do head final. Por enquanto o PR da migração é draft, sem pedido de merge imediato.
2. Definir/autorizar a tarefa Gabi (ambiente e disparo por recorrência ou evento), a supervisão Rivers e o corte, após confirmar acessos e um ensaio sem concorrência.
3. No corte, confirmar que as antigas rotinas de construção Sage/Lia/Rivers pararam antes do primeiro disparo autônomo de Gabi. O atendimento da Lia e a sincronização dos guias precisam continuar preservados.

Você mantém decisões humanas, merges e autorizações de produção/regras administrativas. Este modelo não autoriza deploy, secrets, rulesets ou tornar testes obrigatórios. Histórico anterior: [snapshot](handoffs/2026-09-21-pre-gabi-estado-anterior.md).
