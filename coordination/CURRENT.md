# Estado atual — PR #7 mergeado; gate ainda depende de autorização — 21/09/2026, 00h27 BRT

O PR #7 foi mergeado humanamente na `main` (`0426286b32a93dd7de123917a72fa051b868e807`). O head final passou o workflow `SCL tests` com sucesso.

O merge incorporou somente a documentação/proposta para tornar `SCL Node 22 tests` obrigatório antes de merges na `main`.

**A mudança administrativa ainda NÃO foi aplicada.** O ruleset `main-pr-manual` (ID 23741255) continua ativo, sem bypass e sem `required_status_checks`.

## Decisão pendente
Diego ainda precisa autorizar explicitamente se quer aplicar o gate documentado. O merge do PR #7 não conta como essa autorização.

A proposta aprovada documentalmente permanece estreita:
- exigir `SCL Node 22 tests` emitido por GitHub Actions (`integration_id` 15368);
- manter `strict_required_status_checks_policy: false`;
- preservar todas as demais regras do ruleset.

## Próximo
**Diego é o próximo, mas não precisa agir agora.** Quando quiser, basta decidir se autoriza ou não a aplicação do status check obrigatório.

Se houver autorização explícita, a rodada seguinte deve aplicar somente a regra já documentada, reler o ruleset e verificar o gate em PR. Sem autorização, nenhum agente deve aplicar nada.

Produção, deploy, domínio, integrações, secrets e dados reais continuam intocados. PR #5 segue sendo Labs/Bumble Helper e permanece fora desta faixa operacional.
