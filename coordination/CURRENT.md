# Estado atual — migração documental para Gabi — 21/09/2026

**Modelo aprovado; Gabi EM PREPARAÇÃO, sem tarefa ou agenda ativada.** Uma única agente executará engenharia, validação prática/browser e coordenação no mesmo ciclo. Rivers será revisor externo; Diego mantém decisões humanas e todos os merges.

## Versão e dependências
Versão proposta na branch `docs/gabi-coordination-migration-20260921`, em PR próprio sobre `rivers-coordenacao-20260921-1848` (#16, base `55f15086e76c5a4cd3acec79dae978d974e64db8`). Não está em main. PR empilhado: após merge humano do #16, reconciliar/retarget para main e conferir diff/CI novamente antes do merge humano desta migração. Não mergear automaticamente na branch do #16.

O #17 altera apenas a ficha do Constructor no cadastro transversal; preservar essa atualização ao reconciliar, sem regressão para a ficha antiga. O #14 contém outra linha dos guias Lia/Mia e deve receber reconciliação explícita, sem reintroduzir o rodízio SCL após o corte.

## Estado de produto observado, não executado nesta migração
O #11 segue draft no head `50ec318e07e078f56ac180a11aff7827df415567`. Seu handoff de Sage já registra a correção do retorno à estadia; a descrição relata CI success e validação visual pendente. Não repetir a reconciliação/correção a partir do painel antigo. Conferir estado e evidências ao vivo antes de retomar. #13, #14 e #15 seguem frentes abertas independentes; #5 continua Labs.

## Próximo e decisão humana
Revisar esta migração e preparar a tarefa conforme [handoff de corte](handoffs/2026-09-21-migracao-gabi.md). Nenhum ciclo Gabi nem mudança de agenda foi executado. Diego precisa decidir o ambiente, mecanismo/cadência e corte antes de ativar; merges documentais permanecem humanos após revisão/CI. Este PR fica draft enquanto depender da reconciliação da base; sem recomendação de merge agora.

Até o corte, os responsáveis legados mantêm suas frentes autorizadas, sem Gabi concorrente. Depois do corte, Gabi é a responsável operacional única; os handoffs legados são entradas de contexto, não turnos a disparar. Rotinas de atendimento e sincronização de guias ficam separadas.

## Limites e história
Nenhuma mudança em produção, deploy, secrets, integrações, rulesets ou required status checks. [Painéis/protocolo anteriores](handoffs/2026-09-21-pre-gabi-estado-anterior.md) preservados. [GABI](GABI.md) define memória e contrato por fase; [Rivers](METODO-RIVERS.md) define supervisão externa.
