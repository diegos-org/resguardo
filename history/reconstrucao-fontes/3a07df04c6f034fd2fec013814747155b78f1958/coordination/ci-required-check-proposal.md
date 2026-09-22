# Proposta de check obrigatório — NÃO APLICADA
20/09/2026, 23h19 BRT. Preparação por Sage; aprovação de Diego pendente.

## Evidência
GET do ruleset 23741255 (main-pr-manual): active, alvo ~DEFAULT_BRANCH, bypass vazio; regras deletion, non_fast_forward e pull_request. Não há required_status_checks.
GET dos check-runs do head 554c5723c9758278bd97b6e20c8cb1cfa26f6cdf (PR #6): um check, nome exato SCL Node 22 tests, app github-actions, ID 15368, conclusão success. Job: https://github.com/al-life/scl-reconstrucao/actions/runs/35551905139/job/106188075062
Workflow conferido em main: pull_request sem filtros de caminhos/branches, job node-tests com name SCL Node 22 tests. O contexto é o nome do job, não o nome do workflow SCL tests.

## Mudança proposta, somente após aprovação
Adicionar à lista atual de rules do ruleset existente:
```json
{
  "type": "required_status_checks",
  "parameters": {
    "required_status_checks": [
      {"context": "SCL Node 22 tests", "integration_id": 15368}
    ],
    "strict_required_status_checks_policy": false,
    "do_not_enforce_on_create": false
  }
}
```
Preservar nome, enforcement, alvo, bypass e TODAS as regras/parâmetros existentes. Não substituir rules apenas pelo item acima. Reler configuração imediatamente antes da aplicação e interromper se houver alteração concorrente.
strict=false é a opção mínima: exige resultado do check sem acrescentar obrigação de atualizar a branch a cada mudança de main. Uma política strict=true pode ser discutida separadamente.
Fonte oficial do schema: https://docs.github.com/en/rest/repos/rules#update-a-repository-ruleset

## Efeito e limites
Merge para a branch principal passará a depender desse check emitido por GitHub Actions. Se não executar, falhar ou for cancelado, haverá bloqueio; renomear o job exige coordenar a regra. A semântica GitHub também aceita resultados neutral/skipped: não descrever isto como prova absoluta de execução dos testes em qualquer workflow futuro. Hoje não há condição que pule o job.
A associação ao app restringe o emissor; não vincula exclusivamente um arquivo de workflow nem impede alteração de testes. Revisão humana continua necessária.
Não ativar strict update, merge queue, aprovação adicional, bypass, permissão nova, scanner, custo ou deploy junto. Não alegar alteração já aplicada.

## Verificação após eventual aprovação
1. Reler ruleset e check observado; aplicar somente o acréscimo aprovado.
2. Fazer GET e comparar: apenas nova regra, contexto e integration_id esperados; demais campos inalterados.
3. Conferir num PR para main que o check aparece como obrigatório e o estado corresponde à execução. Não fazer merge de teste nem enfraquecer a proteção para contornar falha.
4. Registrar evidência e encerrar. O conector atual expõe leitura de ruleset, não uma ferramenta de escrita específica: aplicação poderá usar a interface autenticada, sem ampliar permissões.
