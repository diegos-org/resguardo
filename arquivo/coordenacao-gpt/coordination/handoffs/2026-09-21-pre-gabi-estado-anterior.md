# Histórico anterior à migração Gabi — 21/09/2026

Snapshot documental do PR #16, commit 55f15086e76c5a4cd3acec79dae978d974e64db8. Não é orientação operacional vigente após o corte para Gabi. Preserva protocolo, painéis e método anteriores integralmente.

---

## Arquivo: 00-PROTOCOLO.md

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


---

## Arquivo: coordination/CURRENT.md

# Estado atual — revisão Rivers após Lia 19h — 21/09/2026

**Rodada Rivers concluída; Sage é o próximo técnico e pode começar imediatamente.** Lia também pode continuar a reconciliação documental independente do #14.

A versão atual está no PR #16, branch `rivers-coordenacao-20260921-1848`, até merge humano. Main ainda contém a coordenação de 07h28; não repetir suas tarefas já superadas.

## Entregas confirmadas
- Sage entregou #11 (head `108a482cc391e31e4ffca98deb71e8d13ef1733e`) e Lia entregou os guias de Mia/handoff 19h no #14 (head `88ef3269b0bf1f816447b264e0a672f51897e77f`). Rivers leu ambos; entrega documental não é validação visual da Lia.
- #11 permanece draft/com conflito e sem check-run no head consultado. #14 permanece draft/com conflito. #15 permanece draft, mergeable, CI success no head `dfecfd0d707b9ab2ffd18481dd1abb4f1b2c7900`.
- #16 já registrava a revisão de Sage. Esta rodada atualiza o mesmo PR com a entrega posterior da Lia, preservando o histórico.

## Próximos responsáveis
1. **Sage agora:** reconciliar #11 com main sem perder alterações/handoffs nem usar force push; não repetir a correção HTTP. Rodar/verificar CI no novo head e entregar SHA à Lia.
2. **Lia agora:** reconciliar #14 preservando a correção Rivers (commit 41d7a005): criação para leitura pode preceder a transferência, mas assumir rotinas exige aceite, acessos conferidos e corte registrado.
3. **Lia após Sage:** validar busca/datas/capacidade, responsividade e pagamento fictício do #11 estabilizado. #15 admite validação independente.
4. **Rivers depois:** revisar head final/evidências antes de recomendar merge de produto. Fórmula marketplace #13 permanece pendente; #5 continua Labs.

## DIEGO REVIEW REQUIRED — somente coordenação #16
Aguardar sinal de CI do novo head na descrição do #16 antes de merge humano. O head anterior passou; esse resultado não é atribuído ao novo commit. Nenhum pedido de merge de #11/#13/#14/#15. Sage/Lia não precisam aguardar merge do #16.
Diego não precisa agir para destravar o próximo turno. Produção, regras administrativas, status checks obrigatórios, integrações, criação/ativação de Mia e automações não foram alterados.

## Histórico
[Handoff desta rodada](handoffs/2026-09-21-1915-rivers-pos-lia.md).
[CURRENT/DIEGO anteriores preservados](handoffs/2026-09-21-1915-rivers-estado-anterior.md).
[Rodada Rivers anterior](handoffs/2026-09-21-1848-rivers-coordenacao.md).

## Método e continuidade
Por orientação direta de Diego, o papel de visão geral de Rivers e o procedimento para um substituto estão registrados em [METODO-RIVERS.md](METODO-RIVERS.md). Inclui corrigir desvios documentais, preservar decisões/histórico e avisar quando uma ação humana realmente bloquear o fluxo.

## Guia transversal — atualização posterior nesta rodada
Cadastro vivo em assistentes/DIEGO-E-SEUS-AGENTES.md; guia SCL e cadastro são as duas cópias humanas sincronizadas com o computador, com procedimento e recuperação horária separados. Versão atual neste PR #16, não em main. IA/API SongKeep continua pendente; nome do produto SongKeep, repo mantido. A prontidão anterior do #16 depende novamente do CI do novo head; sinal final na descrição. Handoff: handoffs/2026-09-21-rivers-guias-sincronizados.md.


---

## Arquivo: coordination/DIEGO.md

# Diego — rodada Rivers concluída; Sage pode começar agora

Conferi as entregas de Sage e Lia no GitHub. Já havia uma rodada Rivers no PR #16; atualizei esse mesmo PR com os guias que Lia entregou depois, sem abrir uma cópia.

## O que mudou
Os guias agora separam preparação de relatórios pela Mia e comunicação/envio pela Lia. Lia continua responsável até a passagem ser aceita e registrada. Corrigi no #14 a diferença de redação na matriz: criar Mia para ler os guias é uma etapa; passar as rotinas é outra. A versão anterior ficou preservada no histórico. Nenhuma agente foi criada ou ativada nesta rodada.

## O que funciona e o que falta
Sage entregou a demonstração fictícia de pagamento, mas o #11 ainda tem conflito com a versão principal e não apresenta teste remoto no head consultado. Ele pode reconciliar isso agora; depois Lia valida busca, celular e pagamento fictício. O #15 tem teste automático aprovado, ainda sem aceite visual atribuído à Lia. Integrações, disponibilidade e pagamentos reais continuam sem ativação.

## Você precisa fazer algo?
**Não precisa fazer nada para Sage e Lia continuarem.** O PR #16 é somente coordenação: você pode revisá-lo e fazer o merge quando a descrição confirmar que os testes da versão final passaram. **DIEGO REVIEW REQUIRED — somente #16, condicionado ao CI final.** Os PRs de produto e o #14 continuam rascunhos, sem recomendação de merge.

A versão atual está na branch do #16; a principal ainda não foi atualizada. Produção, automações e regras de segurança/status checks não foram alteradas. Tornar um teste obrigatório continua exigindo sua aprovação explícita separada.

[Handoff e evidências](handoffs/2026-09-21-1915-rivers-pos-lia.md).
[Painel anterior preservado](handoffs/2026-09-21-1915-rivers-estado-anterior.md).

## Continuidade
Registrei [o método do Rivers](METODO-RIVERS.md): visão do conjunto, conferência de evidências, correção de desvios, preservação de histórico e instruções de retomada por substituto. Se faltar uma decisão ou merge seu, o aviso deve identificar exatamente o que precisa fazer e o que está bloqueado.

## Seus dois guias sempre à mão
[Diego e seus agentes](../assistentes/DIEGO-E-SEUS-AGENTES.md) reúne a equipe por projeto, trabalho e acessos confirmados; [guia SCL](../assistentes/GUIA-DO-DIEGO.md) mantém a divisão Lia/Mia. Cópias atuais ficam na pasta Diego da entrega local. Atualização ao fim de cada mudança e conferência horária; versão e pendências no registro local. Não exige ação sua para leitura. #16 continua sendo o PR documental, sujeito ao CI atualizado antes de merge humano.


---

## Arquivo: coordination/METODO-RIVERS.md

# Método de Rivers e continuidade entre janelas

Fonte: orientação direta de Diego em 21/09/2026 nesta rodada de coordenação. Registro compartilhável; complementa o papel de Rivers no protocolo, sem alterar governança administrativa.

## Papel
Rivers observa o conjunto: produto, trabalho de Lia/Sage, decisões humanas, branches, PRs, testes, handoffs e pendências. Confere se a execução segue o combinado, identifica desvios e recoloca o fluxo no rumo por correções concretas de coordenação e documentação, com histórico preservado. Não depende do nome de uma janela nem da memória pessoal de um agente.

A documentação inclui também o próprio método: como conferir, corrigir, decidir o próximo responsável e transmitir o contexto. Um substituto precisa conseguir fazer a roda girar a partir do repositório e das evidências acessíveis.

## Procedimento de cada rodada
1. Seguir a ordem de leitura de 00-PROTOCOLO.md: protocolo, CURRENT, RIVERS, DIEGO, handoff mais recente. Depois verificar PRs abertos e seus handoffs; main pode estar atrasada.
2. Fixar a evidência em branch/PR e SHA quando possível. Distinguir relato de outro agente, teste realmente executado e estado revalidado agora. Não presumir que entrega significa aceite ou que CI verde significa produção pronta.
3. Verificar quem entregou, qual escopo foi entregue e se é a vez de Rivers. Consultas sem novidade não exigem uma rodada artificial nem PR duplicado.
4. Procurar desvios concretos: tarefas já resolvidas ainda pedidas em CURRENT, versões divergentes, regra nova sem origem, conflito documental, perda de histórico, próximo passo sem responsável ou bloqueio humano mal explicado.
5. Corrigir diretamente o desvio documental dentro da autorização vigente, preservando a decisão anterior e sua substituição. Se a decisão substantiva for ambígua, registrar a divergência sem inventar autorização. Não substituir a execução técnica/validação atribuída aos outros sem motivo registrado.
6. Atualizar CURRENT de forma curta; RIVERS com verificações, ações, recomendações e limites; DIEGO em linguagem simples. Criar handoff datado quando houver mudança material e preservar snapshots/histórico ao substituir painéis.
7. Publicar por branch + PR. Reaproveitar um PR da mesma frente quando adequado. Conferir conteúdo publicado, diff e CI do head final antes de recomendar merge. Informar onde está a versão mais recente até o merge humano.
8. Encerrar indicando quem vem a seguir, primeira ação, condição de início e se pode começar imediatamente. Registrar dependências reais; não transformar merge documental em bloqueio técnico sem necessidade.

## Quando Diego precisa agir
Avisar explicitamente quando uma decisão, acesso ou merge dele for necessário. Informar qual PR/ação, por que depende dele, qual trabalho fica bloqueado e qual pode continuar. Se não precisa agir, dizer isso. Um merge pendente por si só não é falha de Diego; verificar se o PR está pronto e se o aviso já foi dado.

Todos os merges permanecem humanos. Produção, rulesets, requisitos de status checks, novas credenciais, integrações e transferências reais não ganham autorização pela simples leitura ou incorporação desta documentação.

## Retomada por substituto
Começar pelo protocolo e por este método; comparar main com PRs abertos; ler os handoffs mais recentes antes de agir. RIVERS é memória de trabalho, CURRENT é estado resumido, DIEGO é painel humano, handoffs são histórico. Confirmar estados mutáveis ao vivo e não reapresentar relatos antigos como trabalho próprio.

Se faltarem fontes, declarar a lacuna. Não reconstruir decisões a partir de memória incerta nem apagar conflitos silenciosamente. A continuidade é do método e das evidências, não da identidade ou do nome da conversa.
