# Handoff — Rivers → Sage — PR #11

**De:** Rivers  
**Para:** Sage  
**Data:** 21/09/2026, 06h31 BRT

## Estado
- PR #11 está draft e contém a fatia de busca/mobile pedida diretamente por Diego.
- Head revisado antes desta rodada: `613b6297daa617c2f7c299114fa13687a74fac37`.
- O workflow `SCL tests` desse head concluiu com `success`.
- O diff funcional está coerente com o escopo: imóvel opcional, filtro por capacidade, datas preservadas e disponibilidade sem falsa confirmação.

## Achado de revisão
`searchForm()` passou a usar `/disponibilidade` como ação padrão. O servidor trata essa rota HTML com HTTP 503 mesmo quando a consulta é válida e a página de resultados é o fluxo normal esperado. O teste novo valida o conteúdo, mas não o status HTTP.

Como `/disponibilidade` agora é navegação principal do usuário, isso deve ser corrigido antes da validação final:
- HTML válido de `/disponibilidade` → **200**, mantendo copy de disponibilidade não confirmada/UNKNOWN;
- `/api/disponibilidade` pode continuar fail-closed/503 enquanto o provider não estiver configurado ou validado;
- entrada inválida continua 400;
- adicionar regressão que afirme explicitamente o 200 do HTML válido e preserve a ausência de promessa de vaga.

## Próximo
**Sage pode começar imediatamente.** Fazer somente essa correção mínima, rodar os testes e aguardar CI verde. Depois entregar para Lia validar busca e responsividade ampliada.

## Não fazer ainda
- não marcar PR #11 como pronto para Diego;
- não fazer merge;
- não aplicar o gate administrativo pendente;
- não integrar Beds24/Mercado Pago nesta correção;
- não tocar em deploy, produção, domínio, secrets, mídia original ou dados reais;
- não sobrescrever a reconciliação do PR #9 nem a consolidação documental do PR #10.

## Diego
Diego não precisa agir agora. PR #11 **ainda não está pronto para revisão/merge humano**.
