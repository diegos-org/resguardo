# SCL — marcos, checkpoints e decisões

Data-base 21/09/2026. Datas abaixo são **checkpoints propostos de avaliação**, não promessas de entrega nem datas de corte já aprovadas. Diego + Rivers aprovam o calendário inicial antes de virar compromisso. Horário de revisão: 18h America/Sao_Paulo. Próxima revisão proposta: 23/09/2026.

Indicador: **0/5 marcos com aceite completo comprovado**; M0 preparado em PR, M1–M4 dependem de evidência/decisão. Denominador = cinco gates de migração abaixo, sem pesos. Isso NÃO é 0% do produto SCL: o produto já tem workbench em main; não há base para percentual global. Não contar documentos escritos como agentes operacionais.

| ID / marco | Checkpoint | Responsável | Aceite mensurável | Estado |
|---|---|---|---|---|
| M0 — Verdade convergente | 23/09/2026 | Gabi + Rivers; Diego merge | PRs de arquitetura reconciliados; contratos e painel na main; nenhuma instrução atual contraditória; revisão externa registrada | Preparado em PR; aceite pendente |
| M1 — Cloud comprovada | 24/09/2026 | Gabi, Lia Cloud, Mia Cloud | IDs reais, ambiente, leitura autorizada e teste fictício por tarefa; limitações e dependência do Mac registradas | Três tarefas cloud criadas e leitura GitHub relatada; testes completos pendentes |
| M2 — Corte sem lacunas | 25/09/2026 | Rivers + responsáveis; Diego autoriza | Dono único por rotina; últimos envios/pendências transferidos privadamente; ensaio de falha; legado correto pausado; primeiro ciclo cloud verificado | Bloqueado por M1 e decisão de corte |
| M3 — Convergência repetível | 28/09/2026 | Gabi + Sage | Dois ciclos materiais consecutivos iniciam da main, reconciliam PRs e entregam um lote revisável cada; nenhuma declaração de branch canônica; evidência por head | Não demonstrado |
| M4 — Operação prospectiva útil | 30/09/2026 | Mia + Lia; Diego aceita | Uma revisão de 30 dias de calendário/preços/configurações com fontes, proposta e decisão; handoff sem envio duplicado; atendimento coberto | Não demonstrado |

## Roadmap de produto em paralelo
Prioridade observada: finalizar demo pública/busca/pagamento fictício (#11); reconciliar requisitos financeiros/portais (#13) e demo interna (#15); atendimento/relatórios e divisão Lia/Mia (#14). Integrações seguem operations/SERVICOS-EXTERNOS.md: Beds24, Booking, Cloudflare/e-mail, Mercado Pago, Neon, Vercel e teste integrado. Esses itens não estão entregues só por terem documento ou componente visual.

Checkpoints propostos de produto: 25/09 — relatório dos gates do #11 e requisitos de auth/integrações; 30/09 — decisão de uma fatia homologável com dados fictícios. Resultado esperado nesses dias é revisão mensurável, não lançamento. Sem aceite Diego + Rivers, manter roteiro histórico e estes checkpoints como proposta.

## Regra de progresso
Para cada marco: estado {não iniciado, preparado, em validação, bloqueado, aceito}; dono; checkpoint original; checkpoint atual; critério; fonte/head; data de verificação; dependência; revisor; aceite. Aceito exige evidência do critério inteiro. Reabertura mantém histórico.
Gabi atualiza painel no mesmo PR da entrega e relata X/5 aceitos, próximos dois bloqueios e idade da evidência. Não somar PRs/linhas/documentos como progresso de produto.

## Atraso e mudança de rota
Checkpoint perdido dispara revisão de método/razão no próximo dia útil: esperado versus observado, causa sustentada (ou hipótese), capacidade/acesso/dependência, o que falhou no método, alternativas, custo/impacto e próxima verificação. Não simplesmente empurrar data nem culpar um agente sem evidência.
Mudança de escopo, ordem, critério ou data comprometida exige proposta com rationale, comparação ao baseline e impactos; consulta aos agentes afetados; **aceite explícito de Diego + parecer/aprovação de Rivers**. Autor deste PR não se atribui parecer externo.
Registre: ID, antes/depois, motivo, evidências, consultas, Diego (fonte/data), Rivers (fonte/data), vigência e rollback. Silêncio não aprova. Sem dupla aprovação, versão anterior continua e desvio aparece no painel.
