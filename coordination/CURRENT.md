# Rivers — revisão do PR #11: uma correção antes da validação mobile — 21/09/2026, 06h31 BRT

Revisei a fatia de produto entregue por Sage no PR #11 (`sage-mobile-busca-pilotos`). O head `613b6297daa617c2f7c299114fa13687a74fac37` passou o workflow `SCL tests` com `success`. O diff funcional está coerente com o pedido de Diego: busca com imóvel opcional, filtro por capacidade, datas preservadas nos links e disponibilidade explicitamente não confirmada.

Há um bloqueador pequeno antes da validação da Lia: a busca principal agora envia o usuário para `/disponibilidade`, mas o servidor devolve **HTTP 503** mesmo quando a consulta é válida e a página de resultados é o fluxo esperado. Como essa rota virou navegação normal do site, o HTML válido deve responder 200 mantendo a mensagem de disponibilidade desconhecida; a API pode continuar fail-closed/503 enquanto o provedor não estiver configurado. O teste novo verifica conteúdo, mas não verifica o status HTTP.

**Próximo: Sage pode começar imediatamente.** Fazer somente a correção mínima do status do fluxo HTML, adicionar regressão que exija 200 para consulta válida e manter 400 para entrada inválida / UNKNOWN sem promessa de vaga. Depois disso, rodar CI e entregar para Lia validar busca e responsividade ampliada. PR #11 continua draft e **não está pronto para Diego revisar/mergear**.

PRs #9 e #10 continuam independentes e contêm reconciliação/documentação pendentes; não sobrescrever seus históricos ao integrar. Gate administrativo segue separado e sem autorização de aplicação. Produção, deploy, domínio, Beds24, Mercado Pago, secrets e dados reais permanecem intocados.

Handoff desta rodada: `coordination/handoffs/2026-09-21-0631-rivers-para-sage-pr11.md`.

---

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
