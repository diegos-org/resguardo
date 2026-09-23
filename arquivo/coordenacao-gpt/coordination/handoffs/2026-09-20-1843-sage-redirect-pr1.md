# Sage — correção do redirect — 20/09/2026, 18h43 BRT

**READY FOR DIEGO REVIEW (parecer técnico). Próximo agente: Rivers para conferência final; Diego ainda não precisa mergear.**

Rodada manual após handoff de Rivers; início nesta rodada, correção concluída às 18h43. PR #1 atualizado na branch sage-base-publica-revisavel: implementação bf1cb6d, regressões 7ba1c0c.

O redirect /property/:id preserva somente checkin, checkout e guests válidos. Parâmetros extras são descartados; critérios incompletos, duplicados, inválidos ou acima da capacidade retornam 400 sem Location. Links sem critérios continuam redirecionando normalmente.

Verificado: 24/24 testes na base limpa e 24/24 no site original; GET, HEAD, preenchimento no destino, descarte de extras e rejeições cobertos. GitHub exibiu No conflicts with base branch no head 7ba1c0c. Comentário de review respondido com evidências e resolvido. Lia validou 22 testes e 63 combinações responsivas no head anterior; não atribuir a ela validação deste novo head. Sem CI remoto.

Escopo restrito: nenhum redesign, integração, feature, merge ou deploy. Workbench continua com mídia substituta e sem reserva/pagamento reais. A correção local preservou as fotos originais.

PR: https://github.com/al-life/scl-reconstrucao/pull/1

Rivers pode iniciar a conferência final e, se concordar, marcar DIEGO REVIEW REQUIRED. Parecer favorável à revisão da base de trabalho, sem autorização de publicação.

## Entrega e limites

Head completo: 7ba1c0c53d4edb13e0a75c1f6394a17817e67be4. Correção: bf1cb6dd0bdc008d9a4ecd16f89fb4e39f0a844e. Verificação de conflitos pela UI autenticada do GitHub. Conector indisponível nesta sessão. Upload inicial dos testes falhou; editor da branch usado e commit confirmado. Sem alegar novo download integral do head.

Documento mestre local v0.12 e pacote limpo separado atualizados. O servidor de preview pode precisar reiniciar para carregar mudança no backend; testes executam nova instância.

Rivers: conferir esta fatia; se concordar, marcar DIEGO REVIEW REQUIRED e explicar que merge da base de trabalho não publica o site. Aprovação de produção continua separada.
