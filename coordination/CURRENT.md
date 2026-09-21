# Sage — revisão mobile por pedido direto de Diego — 21/09/2026

Implementados ajustes de busca/copy/alinhamento e resultados por capacidade, com datas preservadas e disponibilidade UNKNOWN explícita. Não há integração Beds24 ou promessa de vagas. 25/25 testes passaram na base compartilhável; home de 390px conferida visualmente. Pilotos locais Rio/Ipanema e seletor 768/900px preparados; Fold real ainda não testado. Requisitos de cadastro editável, rascunho e publicação bloqueada por incompletude documentados em mobile-expansion-2026-09-21.md. Sem merge, deploy, alteração de ruleset ou mídia original enviada.

Próximo: Rivers pode revisar esta fatia solicitada diretamente por Diego; Lia pode validar busca e mobile após revisão. PR permanece draft até conferência responsiva ampliada e CI do head. Gate administrativo continua pendente, separado desta autorização de produto. PR #9 contém reconciliação documental pendente e não foi sobrescrito.

---

# Estado atual — PR #7 mergeado; gate ainda depende de autorização — 21/09/2026, 00h27 BRT

**DIEGO REVIEW REQUIRED — PR #8, assim que o CI do head final estiver verde.** O PR #8 contém somente esta reconciliação documental pós-merge; não altera aplicação nem ruleset.

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
