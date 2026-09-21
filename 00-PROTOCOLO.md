# SCL 2.0 — PROTOCOLO DE COORDENAÇÃO

> **Status:** código em workbench temporário. Diego definiu em21/9 o GitHub como destino canônico das regras e decisões compartilhadas; migração documental gradual, conferida por tema.
> **Não é produção. Não é documentação final da Sua Casa Leblon.**

Este repositório é o canteiro de construção coordenado de **Rivers, Lia e Sage** para o SCL 2.0.
A futura aplicação de produção deverá viver separada. Nada aqui deve ser tratado como produção por acidente.

## 1. Antes de qualquer turno

Todo agente deve, nesta ordem:

1. Ler este arquivo.
2. Ler `coordination/CURRENT.md`.
3. Ler o próprio arquivo:
   - Rivers → `coordination/RIVERS.md`
   - Lia → `coordination/LIA.md`
   - Sage → `coordination/SAGE.md`
4. Ler `coordination/DIEGO.md` para entender decisões humanas e pendências.
5. Ler o handoff mais recente em `coordination/handoffs/` quando houver.

Só depois começa a trabalhar.

## 2. Regra central

Cada turno deve **reduzir incerteza e avançar o produto**. Não criar sistema por prazer de criar sistema.

Prioridades:
1. Produto funcionando.
2. Clareza de estado.
3. Segurança prática sem travar o trabalho.
4. Histórico preservado.
5. Elegância técnica depois.

## 3. Papéis

### Rivers
Coordenação, arquitetura de trabalho, coerência entre rodadas, decisões de estrutura, revisão de handoffs e tradução para Diego.

### Lia
Execução operacional e navegação/browser quando isso for necessário; validação prática de fluxos reais e tarefas que dependam de interface.

### Sage
Análise técnica, implementação/revisão complementar, contraponto crítico e investigação quando houver mais de uma solução plausível.

Os papéis não são jaulas. Um agente pode sugerir trabalho para outro, mas deve registrar o motivo.

## 4. Ao terminar cada turno

O agente deve obrigatoriamente:

1. Atualizar `coordination/CURRENT.md` com o estado atual, sem transformar o arquivo num diário gigante.
2. Atualizar o próprio arquivo com:
   - o que verificou;
   - o que fez;
   - o que recomenda;
   - o que deliberadamente **não** decidiu;
   - o que o próximo agente precisa saber.
3. Atualizar `coordination/DIEGO.md` em linguagem simples.
4. Criar um handoff datado em `coordination/handoffs/` quando houver mudança material.
5. Preservar histórico anterior. Nunca apagar silenciosamente uma decisão antiga só porque mudou de ideia.

## 5. DIEGO.md é obrigatório

`DIEGO.md` é o painel humano.

Escrever para alguém inteligente que quer entender o sistema, mas **não precisa aprender programação**.
Evitar jargão sem tradução.

Sempre responder, em linguagem comum:
- Onde estamos?
- O que mudou?
- O que funciona?
- O que ainda não funciona?
- Há algum risco ou decisão pendente?
- Diego precisa fazer alguma coisa? Se sim, exatamente o quê?

Se Diego não precisa fazer nada, escrever isso explicitamente.

## 6. Handoff

Um handoff útil contém:
- **De:** agente que terminou.
- **Para:** próximo agente.
- **Estado:** o que é verdade agora.
- **Feito:** mudanças realizadas.
- **Verificado:** fatos efetivamente checados.
- **Sugestões:** próximos movimentos.
- **Não fazer ainda:** decisões adiadas ou caminhos rejeitados.
- **Diego:** qualquer assunto que exija decisão humana.

Sugestões podem ser recusadas. Quem recusar registra o motivo.

## 7. Rodadas e antecipação manual

A cadência normal é definida pelas tarefas agendadas de cada agente.

Diego pode antecipar manualmente uma rodada.
Quando isso acontecer:
- executar a rodada antecipada;
- cancelar/ignorar **somente a ocorrência seguinte equivalente**, se ela se tornar redundante;
- manter as demais ocorrências futuras e a cadência geral.

Não reprogramar toda a operação por causa de uma antecipação pontual.

## 8. Produção

É proibido presumir que este repositório seja produção.

Não:
- publicar como aplicação oficial;
- apontar domínio oficial;
- migrar dados reais de clientes;
- conectar credenciais de produção;
- sobrescrever sistemas existentes da Sua Casa Leblon sem decisão explícita de Diego.

## 9. Segurança prática

Nunca armazenar aqui:
- tokens, API keys, senhas ou cookies;
- documentos pessoais;
- dados bancários;
- credenciais;
- PII desnecessária;
- dumps privados de clientes/hóspedes.

Usar placeholders e nomes genéricos quando necessário.
Segurança deve ser sensata, não paralisante.

## 10. Código e merge

Atualização de 20/09/2026 por Sage, após merge humano do PR #1:
- `main` está protegida pelo ruleset ativo `main-pr-manual`, sem bypass;
- toda mudança, inclusive arquivos de coordenação, deve usar branch + PR;
- PR obrigatório, force push/exclusão bloqueados e conversas resolvidas;
- nenhum agente deve fazer merge por conta própria; Diego mantém o merge manual e a decisão de publicação;
- auto-merge permanece desligado; PRs de bots também dependem de merge humano;
- zero aprovações formais exigidas enquanto o fluxo usa a mesma identidade; essa configuração não garante separação técnica humano/agente;
- rotinas devem verificar PRs de coordenação pendentes além de main, evitando duplicar trabalho baseado em CURRENT antigo; indicar branch/handoff ainda não mergeado;
- agrupar atualizações de coordenação por rodada e preservar histórico, sem abrir exceção de push direto.

A antiga permissão de atualizar coordenação diretamente foi substituída por esta regra. Histórico preservado no Git e no handoff de governança.


## 11. Fonte de verdade

Para o estado operacional deste workbench:
- protocolo → `00-PROTOCOLO.md`
- estado atual → `coordination/CURRENT.md`
- visão humana → `coordination/DIEGO.md`
- memória por agente → arquivos individuais
- histórico → `coordination/handoffs/`

Quando houver conflito, registrar o conflito; não escolher silenciosamente uma versão.

## 12. Regra de saída

Quando SCL 2.0 estiver pronto para virar produto real:
1. revisar o que é canônico;
2. separar documentação final de material de coordenação;
3. criar/migrar para o repositório de produção;
4. arquivar este workbench com o histórico intacto.


## 13. Checagem horária de vez

A cadência antiga de uma rodada completa a cada três horas passa a ser apenas fallback histórico.

Novo padrão operacional:
- cada agente deve verificar **a cada 1 hora** se existe handoff novo tornando sua vez acionável;
- checagem horária **não obriga executar** trabalho se ainda não for sua vez;
- se não houver handoff/escopo novo, não fazer nada e não gerar ruído;
- se for sua vez, executar a rodada normalmente;
- Diego continua podendo antecipar manualmente qualquer agente.

Objetivo: evitar tempo ocioso entre handoffs sem criar três agentes trabalhando simultaneamente no mesmo problema.

## 14. PR pronto para Diego

Quando um PR estiver realmente pronto para revisão humana/merge:
1. marcar claramente em `coordination/CURRENT.md`: **DIEGO REVIEW REQUIRED**;
2. atualizar `coordination/DIEGO.md` explicando em linguagem comum:
   - o que muda;
   - o que foi testado;
   - riscos/limites;
   - se recomendamos merge ou apenas revisão;
3. avisar Diego no canal disponível do agente;
4. se Lia tiver contato operacional via WhatsApp, pode reforçar o aviso por lá, sem colocar segredo ou dado sensível;
5. não pedir merge se o PR estiver com conflito, incompleto, não testado ou ainda marcado como experimento.

Merge continua decisão humana de Diego, salvo regra futura explícita.


## 15. Higiene de backlog / Labs

Documentar tudo não significa ler tudo todo dia nem transformar toda ideia em compromisso.

Regras:
- arquivos de `labs/`, `growth/` e notas futuras **não são leitura obrigatória em toda rodada**; consultar apenas quando o trabalho tocar naquele tema;
- toda ideia futura relevante deve ter um estado simples quando amadurecer: `LAB`, `CANDIDATA`, `PRÓXIMA`, `EM EXECUÇÃO`, `ADIADA` ou `ARQUIVADA`;
- ideia sem próximo passo concreto continua em LAB e não disputa atenção com a execução atual;
- quando algo virar `PRÓXIMA`, registrar: responsável, gatilho/condição de início e primeira ação concreta;
- revisões periódicas podem promover, adiar ou arquivar ideias;
- arquivar não apaga histórico nem motivo da decisão;
- evitar repetir a mesma ideia em vários arquivos: usar links/referências para uma fonte principal.

Objetivo: preservar memória sem transformar documentação em ruído.

## 16. Consolidação autorizada em21/9
Consultar [operação e integrações](operations/CONSOLIDACAO-2026-09-21.md). Seis imóveis operados, cinco do Rio no catálogo público; Búzios excluído das partes públicas/resultados e inclusão interna ainda pendente. Esta atualização substitui a classificação anterior de toda documentação como não canônica; não promove código a produção nem declara migração completa.

## 17. Atualização canônica e exceções locais — decisão direta de Diego,21/9
Ao terminar cada trabalho, atualizar e verificar no GitHub os documentos compartilháveis alterados. Cópias locais são permitidas, mas não devem permanecer como única versão mais recente sem pendência explícita. Respeitar branch + PR e merge exclusivamente humano; enquanto main aguarda merge, informar qual PR/branch contém a versão atual. Não dizer que main está atualizada antes da confirmação.

Extratos, PDFs financeiros reais, documentos de hóspedes, contatos privados, segredos e materiais de risco permanecem locais/restritos. O GitHub recebe regras e modelos sanitizados, sem esses dados. Entregas privadas de relatórios seguem autorização e validação do destinatário; não autorizam subir arquivos ao repo. Não apagar originais nem imprimir segredos automaticamente.

A migração histórica ainda é parcial. Consolidar por tema, verificar equivalência e registrar lacunas. Falha de publicação exige preservar o registro local e declarar sincronização pendente. Arquivos grandes podem ganhar volumes com referências nos dois sentidos e índice; preservar histórico. Isso não resolve bloqueio de permissão de escrita.

## Guias humanos e atualização transversal — decisão direta de Diego, 21/09/2026
Todo agente atual/futuro deve consultar e atualizar [Diego e seus agentes](assistentes/DIEGO-E-SEUS-AGENTES.md) ao iniciar/concluir trabalho, mudar escopo, ferramentas/acessos ou responsável. Essa regra inclui o procedimento de sucessão, não apenas tarefas. O guia geral e [o guia SCL](assistentes/GUIA-DO-DIEGO.md) têm cópias locais vivas por exceção explícita; seguir [sincronização](assistentes/SINCRONIZACAO-GUIAS.md). Atualizar/verificar ambos os lados ou registrar pendência, preservando histórico, PRs e merge humano. Não estender a exceção a dados privados nem outros arquivos.
