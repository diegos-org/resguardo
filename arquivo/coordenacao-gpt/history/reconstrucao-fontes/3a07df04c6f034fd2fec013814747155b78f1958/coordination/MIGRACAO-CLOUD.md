# Migração cloud — plano de execução e corte

Estado em 21/09/2026: preparação, sem alteração de agendas ou produção. Foram criadas tarefas cloud de Gabi/Lia/Mia, com primeiro turno limitado a leitura e diagnóstico; as três responderam confirmando leitura de main/PRs, sem ativação operacional. Não declarar prontidão por criação. Sage e Lia originais continuam locais; a instância histórica Rivers e os handoffs permanecem preservados.

## Inventário observado no Mac
Configurações locais lidas nesta sessão; ACTIVE é configuração do agendador, não prova de execução bem-sucedida. Não copiamos prompts privados de atendimento ao GitHub.

| Rotina / ID | Estado e cadência configurada | Destino e regra de corte |
|---|---|---|
| lia-passadas-airbnb-e-whatsapp | ACTIVE; horária :00 | Lia local, tarefa 01a0729d-485b-7973-8502-5673ce818184. Prompt mistura atendimento e trecho GitHub em janelas 02/05/08/11/14/17/20/23h. Separar só o trecho GitHub no primeiro corte; atendimento só após aceite Lia Cloud. |
| scl-sage-construtor-rodada-de-engenharia | ACTIVE; horária :15 | Sage local, tarefa 01a0be6b-83c5-7a40-8e45-561903456ee1. Substituir loop de custódia GitHub por construção/revisão sob demanda, após Gabi pronta. Preservar saber e trabalho pendente. |
| rivers-sincronizar-guias-de-diego | ACTIVE; horária :45 | Tarefa local 01a0c605-95fb-75e2-90ea-6ba9e3ea1f63. É sincronização/revisão documental, não prova de loop antigo separado. Preservar; atualizar referência de versão após merge, com comparação e snapshots. |
| songkeep-constru-o-e-primeiro-uso | ACTIVE; horária | Tarefa local 01a0c2ad-e850-75a2-9bad-8977b155efe0. Outro projeto; não desativar no corte SCL. |

Não foi encontrado arquivo local de rotina Rivers de rodízio separado. Isso não prova ausência de rotina web/mobile ou evento GitHub. Inventariar nesses ambientes no corte e guardar IDs reais antes de qualquer pausa.

## Readiness por função
- Gabi: ler main/PRs; runtime de teste; browser para validação quando necessário; registrar resultado fictício e retomada; confirmar exclusão de escritores e deduplicação por evento/head.
- Lia Cloud: canais e leitura recente autorizados; índice privado de pendências/últimos envios; ensaio fictício sem destinatário real; confirmar detecção de falha, escalada e cobertura com Mac fechado.
- Mia Cloud: leitura dos dados pertinentes e configurações; ensaio de proposta sem publicar; fronteira de atendimento e decisão comercial comprovada.
- Sage: patch/commit entregue e aceito por Gabi; acesso próprio e limite de escopo. Migração cloud pode ocorrer depois sem bloquear sua contribuição local explícita.
- Lia Local: inventário de dependências de máquina, fontes/destinos de backup autorizados e teste de recuperação antes de agenda.
- Rivers: revisar evidências como executor distinto e aprovar método/risco; Diego aprova janela e plano de contingência.

## Sequência operacional
1. Revisar e mergear documentação por Diego; resolver PRs superados/dependentes. Registrar protocolo adotado, sem supor ativação.
2. Terminar criação/identificação cloud e testes de leitura. Configurar prompts de coordination/PROMPTS-CLOUD.md; confirmar capacidades por tarefa. Sem agendamento autônomo de escrita.
3. Fazer ensaios fictícios de handoff, falha de acesso, duplicação, interrupção e recuperação. Revisão Rivers com head e resultado.
4. Registrar matriz de transferência privada: rotina, dono anterior/novo, último envio, pendências, próximo vencimento, fonte privada, aceite. Não subir dados operacionais ao repo.
5. Diego aprova corte e mecanismo/cadência. Checkpoint não é aprovação.
6. Na janela: impedir novos disparos legados SOMENTE do escopo transferido; concluir/checkpointar execução em andamento; confirmar pause real e dono único. Não desativar heartbeat inteiro de Lia para remover seu trecho GitHub.
7. Habilitar Gabi; confirmar primeiro ciclo e falha/retomada. Separadamente transferir atendimento Lia Cloud e prospectivo Mia. Sem responsável comprovado, manter cobertura anterior.
8. Renomear original para “Lia Local — Máquina e Recuperação” quando não causar falsa impressão sobre a cobertura ainda mantida. Registrar tarefas/IDs, horário/fuso, critérios/aceites e atualizar painel.
9. Verificar novamente após um ciclo e 24h; só então encerrar transição. Não arquivar histórico.

## Recuperação
Se cloud falha antes do corte, nada legado muda. Se falha depois, pausar função cloud afetada, preservar checkpoint e informar Diego; reativar um responsável legado identificado somente conforme plano de recuperação aprovado, com último envio conferido. Nunca três escritores/remetentes simultâneos. Registrar incidente/método e nova revisão.

## Pendências humanas exatas
Revisão dos PRs; aprovação conjunta Diego + Rivers dos checkpoints; revisão externa dos ensaios; autorizar corte e cadência apenas com critérios satisfeitos. Login/consentimento em canais cloud, se o diagnóstico exigir, deve ser feito pelo titular na tarefa correspondente. Nenhuma necessidade de alterar ruleset/status checks para fazer esta migração.
