# SCL 2.0 — PROTOCOLO DE COORDENAÇÃO

> **Status:** código em workbench temporário. Diego definiu em21/9 o GitHub como destino canônico das regras e decisões compartilhadas; migração documental gradual, conferida por tema.
> **Não é produção. Não é documentação final da Sua Casa Leblon.**

Este repositório é o canteiro de construção do SCL 2.0. O modelo aprovado por Diego em 21/09/2026 é **Gabi como agente operacional única**, com Rivers como supervisor externo e Diego como autoridade humana.

**Migração documental; ativação pendente.** O modelo entra em operação somente após o corte registrado no [handoff de migração](coordination/handoffs/2026-09-21-migracao-gabi.md). Este PR não cria tarefa nem desliga agendas. A arquitetura Sage/Lia/Rivers permanece no [snapshot histórico](coordination/handoffs/2026-09-21-pre-gabi-estado-anterior.md) e nos arquivos individuais.
A futura aplicação de produção deverá viver separada. Nada aqui deve ser tratado como produção por acidente.

## 1. Antes de qualquer ciclo

1. Ler este protocolo, `coordination/CURRENT.md` e `coordination/DIEGO.md`.
2. Gabi lê `coordination/GABI.md`; Rivers lê `coordination/RIVERS.md` e `coordination/METODO-RIVERS.md` ao supervisionar.
3. Ler o handoff do último ciclo e suas referências de evidência. Verificar main e PRs abertos: uma proposta não mergeada não é estado incorporado.
4. Confirmar tarefa, escopo autorizado, branch/SHA de partida, trabalho pendente e se já existe execução/PR equivalente. Na transição, consultar Sage/Lia/Rivers e handoffs legados relevantes; não reler todo o acervo a cada ciclo.
5. Só iniciar após confirmar responsabilidade e exclusividade do ciclo. Falta de acesso ou evidência vira bloqueio explícito, nunca validação presumida.

## 2. Regra central

Cada turno deve **reduzir incerteza e avançar o produto**. Não criar sistema por prazer de criar sistema.

Prioridades:
1. Produto funcionando.
2. Clareza de estado.
3. Segurança prática sem travar o trabalho.
4. Histórico preservado.
5. Elegância técnica depois.

## 3. Papéis e três fases de Gabi

### Gabi — uma agente, um ciclo contínuo
Gabi herda as responsabilidades de construção do SCL em três fases explícitas, com o contexto completo entre elas. Não interpreta Sage, Lia ou Rivers, não troca de personalidade e não atribui a si validação independente de três agentes.

1. **Engenharia / análise técnica e implementação:** investigar alternativas, definir aceite, implementar a fatia autorizada em branch, revisar código e executar testes pertinentes. Registrar hipótese, decisão, riscos, resultados e SHA.
2. **Validação prática / browser / operação:** confrontar a implementação com os fluxos reais no ambiente de teste autorizado, usando dados fictícios; conferir interface, responsividade e estados de erro pertinentes. Registrar ambiente, cenários, evidência e limitações. Sem browser/acesso, marcar BLOQUEADO ou NÃO VERIFICADO; nunca aprovar por inferência do CI. Para mudança apenas documental, justificar NÃO APLICÁVEL.
3. **Coordenação / consolidação / estado compartilhado:** reconciliar resultados e contradições, atualizar GABI/CURRENT/DIEGO e guias afetados, preparar PR e handoff do ciclo inteiro para a próxima execução. Distinguir proposta, commit testado, merge confirmado e decisão humana pendente.

Cada fase registra conclusão e questões abertas. Falha prática pode devolver o trabalho à engenharia dentro do mesmo ciclo; preservar a evidência anterior e revalidar o novo SHA. Contradições não são apagadas nem convertidas em consenso artificial. Bloqueio não impede consolidar o que foi e não foi verificado. A memória operacional única é o GitHub canônico, `GABI.md` e o histórico de ciclos, não lembrança espontânea da conversa.

### Rivers — supervisão e revisão externas
Rivers acompanha os outputs de Gabi de fora: revisa escopo, evidências, contradições, handoffs e decisões; identifica deriva e pede correções verificáveis. Registra seu parecer separado em RIVERS/handoff, com SHA e fontes, conforme [método](coordination/METODO-RIVERS.md). Não é quarta fase, executor paralelo ou aprovação humana. Supervisão documentada não significa monitor automático já ativo.

### Diego — autoridade humana
Diego mantém decisões humanas, prioridades, merges manuais, produção/publicação e autorizações administrativas (incluindo rulesets e required status checks). Nem Gabi nem Rivers concedem essas autorizações por conta própria. Aprovar este modelo ou mergear documentação não autoriza ativar integração, deploy ou tarefa recorrente.

### Arquitetura histórica e escopo
Sage era responsável técnico; Lia validava operação/browser; Rivers coordenava as rodadas. Seus documentos e handoffs continuam preservados com autoria e evidências originais. Após o corte, não há rodízio nem espera por esses papéis dentro do ciclo Gabi. Atendimento da Lia, transferência Lia/Mia, SongKeep e outras frentes não são absorvidos automaticamente.

## 4. Ao terminar cada ciclo

Gabi deve atualizar, agrupado em branch + PR:
1. `coordination/GABI.md`: referência do ciclo, escopo, resultados por fase, contradições, bloqueios e decisões não tomadas.
2. `coordination/CURRENT.md`: estado curto, PR/branch vigente, próximo passo e responsável.
3. `coordination/DIEGO.md`: resultado, limites e ação humana concreta, quando necessária.
4. Handoff datado do ciclo completo em `coordination/handoffs/` quando houver mudança material; seguir o modelo em GABI.
5. Guias afetados e pendências de sincronização. Preservar decisões e autoria anteriores; não reescrever Sage/Lia/Rivers como se fossem Gabi.

Rivers registra parecer externo separadamente. Corrige coordenação por PR quando necessário, revalidando a versão concorrente; a próxima execução de Gabi incorpora ou contesta o parecer com motivo explícito.

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

## 6. Handoff entre ciclos

O handoff principal passa de **Gabi / ciclo identificado → Gabi / próxima execução**, com Rivers como revisor externo e Diego como decisor quando necessário. Não são três chamadas separadas.

Registrar: gatilho/data/fuso; escopo; base e head SHA; PR; feito/verificado por fase; evidências e sua autoria; contradições abertas ou resolvidas com motivo; testes não executados/bloqueados; parecer externo recebido ou pendente; decisões adiadas; próximo passo/condição; ação exata de Diego. Usar o modelo em [GABI.md](coordination/GABI.md). Sugestões podem ser recusadas, com motivo.

## 7. Disparos e antecipação manual

Uma única tarefa Gabi poderá executar ciclos por recorrência ou evento, com mecanismo oficial e cadência a aprovar por Diego. Não há agenda criada por este documento. Eventos e antecipações manuais passam pela mesma deduplicação e exclusão de execuções concorrentes; repetição do mesmo gatilho não abre outro ciclo/PR.

Uma antecipação só torna redundante a ocorrência equivalente já atendida, sem cancelar trabalho novo nem reprogramar toda a operação. Sem mudança acionável, permanecer em silêncio. Ao concluir trabalho material, falhar ou precisar de ação humana, registrar e avisar pelo canal autorizado.

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
- memória operacional de Gabi → `coordination/GABI.md`
- revisão externa → `coordination/RIVERS.md` e `coordination/METODO-RIVERS.md`
- arquitetura anterior → arquivos Sage/Lia/Rivers e snapshots históricos
- histórico → `coordination/handoffs/`

Quando houver conflito, registrar o conflito; não escolher silenciosamente uma versão.

## 12. Regra de saída

Quando SCL 2.0 estiver pronto para virar produto real:
1. revisar o que é canônico;
2. separar documentação final de material de coordenação;
3. criar/migrar para o repositório de produção;
4. arquivar este workbench com o histórico intacto.


## 13. Corte das rotinas legadas

Checagens horárias de vez e antigas rodadas a cada três horas são a arquitetura histórica substituída após o corte. Não instalar essas três agendas como fallback automático de Gabi.

Seguir o [handoff de migração](coordination/handoffs/2026-09-21-migracao-gabi.md): preparar/testar Gabi sem concorrência, obter decisão humana, pausar os gatilhos legados de construção e confirmar ausência de execução em andamento antes do primeiro disparo autônomo. Registrar IDs reais, horários e resultados; não presumir que editar o protocolo desliga tarefas. Manter atendimento da Lia e sincronização de guias separados.

## 14. PR pronto para Diego

Quando um PR estiver realmente pronto para revisão humana/merge:
1. marcar claramente em `coordination/CURRENT.md`: **DIEGO REVIEW REQUIRED**;
2. atualizar `coordination/DIEGO.md` explicando em linguagem comum:
   - o que muda;
   - o que foi testado;
   - riscos/limites;
   - se recomendamos merge ou apenas revisão;
3. avisar Diego no canal disponível do agente;
4. qualquer mensagem externa adicional exige canal e autorização próprios; a migração não concede acesso ao WhatsApp da Lia;
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
