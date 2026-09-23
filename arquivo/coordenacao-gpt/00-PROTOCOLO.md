# SCL — protocolo de trabalho e reconstrução

Estado: candidato revisável de 22/09/2026, sem produção. Instruções atuais de Diego prevalecem; documentos históricos são evidência, não nova autorização.

## Começar
Ler README.md, coordination/CURRENT.md, assistentes/GUIA-DO-DIEGO.md e os requisitos do assunto. Consultar refs/PRs atuais e registrar divergências. Main contém somente o que foi integrado; proposta em branch não pode ser anunciada como implantação.

## Responsabilidade
Lia conduz a reconstrução autorizada por Diego. Rivers e atendimento estão em espera por pedido dele. Não acionar outros agentes nem reconstruir rodízio antigo por aparecer em handoff. Antes de transferir responsabilidade, registrar ID, instrução aplicada, acesso testado, primeira entrega e aceite. Nome de tarefa não prova identidade/capacidade.

## Entrega concreta
Preservar originais e origem de cada trecho. Trabalhar em branch/cópia isolada; reler o head antes de atualizar. Agrupar produto e documentação correspondente em uma entrega coerente. Não abrir PR só para anunciar merge anterior. Conflitos e decisões são explícitos. Uma implementação não certifica a própria revisão independente por usar outro nome.

Testar a mudança final e informar escopo e resultado real. Falha de ambiente é limitação, não teste aprovado. Antes de pedir merge: conferir diff, dependências, requisitos, testes, revisão e reversão. Atualizar estado e guia humano junto da entrega; preservar versões anteriores no histórico.

## Limites
Merge é de Diego, sem auto-merge/force push/exclusão de branches. Produção, deploy, novos acessos, custos e integrações reais dependem de autorização própria. Não inserir segredos, documentos de hóspedes, contatos privados, gravações ou extratos reais no GitHub. Usar dados fictícios nos testes. Não mudar proteções para facilitar integração.

## Fontes
Papéis: assistentes/GUIA-DO-DIEGO.md. Situação humana: assistentes/PROJETO-DIEGO.md. Seleção e origens: coordination/RECONSTRUCAO.md. Requisitos: operations/ e product/. Ideias: labs/ e growth/, consultadas quando pertinentes, sem promover backlog a compromisso.

História anterior preservada em history/reconstrucao-fontes, coordination/history e handoffs; essa história não substitui o estado atual. Nenhuma regra histórica é apagada silenciosamente: divergências se resolvem por decisão datada.
