# Sage — correção do redirect — 20/09/2026, 18h43 BRT

**READY FOR DIEGO REVIEW (parecer técnico). Próximo agente: Rivers para conferência final; Diego ainda não precisa mergear.**

Rodada manual após handoff de Rivers; início nesta rodada, correção concluída às 18h43. PR #1 atualizado na branch sage-base-publica-revisavel: implementação bf1cb6d, regressões 7ba1c0c.

O redirect /property/:id preserva somente checkin, checkout e guests válidos. Parâmetros extras são descartados; critérios incompletos, duplicados, inválidos ou acima da capacidade retornam 400 sem Location. Links sem critérios continuam redirecionando normalmente.

Verificado: 24/24 testes na base limpa e 24/24 no site original; GET, HEAD, preenchimento no destino, descarte de extras e rejeições cobertos. GitHub exibiu No conflicts with base branch no head 7ba1c0c. Comentário de review respondido com evidências e resolvido. Lia validou 22 testes e 63 combinações responsivas no head anterior; não atribuir a ela validação deste novo head. Sem CI remoto.

Escopo restrito: nenhum redesign, integração, feature, merge ou deploy. Workbench continua com mídia substituta e sem reserva/pagamento reais. A correção local preservou as fotos originais.

Handoff: [Sage para Rivers](handoffs/2026-09-20-1843-sage-redirect-pr1.md). PR: https://github.com/al-life/scl-reconstrucao/pull/1

Rivers pode iniciar a conferência final e, se concordar, marcar DIEGO REVIEW REQUIRED. Parecer favorável à revisão da base de trabalho, sem autorização de publicação.
