## Complemento — orientação direta de Diego nesta rodada
Registrado [método de Rivers e continuidade](https://github.com/al-life/scl-reconstrucao/blob/rivers-coordenacao-20260921-1848/coordination/METODO-RIVERS.md). Diego pediu visão do conjunto, correção de desvios, documentação do próprio método, histórico preservado e aviso claro de dependências humanas. Corrigida a matriz Lia/Mia no PR #14 (41d7a005), mantendo a branch alheia e sua história, sem force push ou merge.

# Rivers → Sage / Lia — revisão após entrega documental da Lia

Data: 21/09/2026, 19h15 BRT. Rodada manual não produtiva solicitada por Diego.

## De / Para
De: Rivers. Para: Sage (reconciliação técnica #11), Lia (reconciliação documental #14 e validações), Diego (revisão humana do #16 após CI).

## Estado e verificado
Protocolo main, CURRENT/RIVERS/DIEGO, handoffs Sage 18h38, Rivers 18h48 e Lia 19h foram lidos. Main permanece em be0860e46be3c209152a2c5de2f1b042128503ad.
Sage concluiu a entrega #11 no head 108a482cc391e31e4ffca98deb71e8d13ef1733e. Lia publicou sua entrega documental #14, conferida no head 88ef3269b0bf1f816447b264e0a672f51897e77f. Isso confirma escopo de revisão para Rivers; não confirma conclusão de todas as pendências nem validação visual do produto pela Lia.
O #16 já continha uma rodada Rivers concluída. Esta rodada complementa o mesmo PR com a mudança material posterior da Lia, sem duplicar PR nem repetir o trabalho de Sage.
Consulta atual: #11 draft/com conflito e nenhum check-run no head; #14 draft/com conflito; #15 draft/mergeable e SCL Node 22 tests success no head dfecfd0d707b9ab2ffd18481dd1abb4f1b2c7900. #16 mergeable, com CI success no head anterior cd9a62c1ba2ff3bd4dd67a56a19520e9f4f209cf; esta atualização exige novo CI.

## Feito — revisão delimitada
Conferidos no SHA da Lia o handoff 19h, COMO-COMECAR-COM-MIA, GUIA-DO-DIEGO e TRANSICAO-LIA-MIA. Os guias distinguem criação para leitura/preparação de transferência operacional: Mia prepara, Lia comunica/envia, e Lia mantém cobertura até aceite e corte registrados. O exercício inicial usa dados fictícios e não envia mensagens externas.
A ambiguidade editorial da matriz foi corrigida por Rivers no PR #14, commit 41d7a005f85e9fd8d5fd02f5e4a8b3f8bdbad255, após pedido direto de Diego: abertura/checklist agora distinguem criação inicial para leitura e prontidão para assumir rotinas. Histórico preservado; não ativa Mia nem conclui a reconciliação do #14.
Atualizados CURRENT, RIVERS e DIEGO; estado anterior preservado integralmente em snapshot e histórico Git. Nenhuma alegação de teste local ou visual novo nesta rodada.

## Próximos passos
1. Sage pode começar imediatamente a reconciliar #11 com main, preservando implementação e handoffs, sem force push; não refazer a correção HTTP já entregue. Confirmar CI do novo head e entregar SHA à Lia.
2. Lia pode imediatamente reconciliar #14 preservando a correção documental de Rivers. Validação visual do #11 só após base estabilizada/CI. #15 pode receber validação independente.
3. Rivers revisa as evidências e o head final antes de recomendar merge de produto. Fórmula marketplace #13 permanece pendente, não inventada.
4. Diego pode revisar/mergear somente o #16 depois do sinal de CI final na descrição do PR; não é requisito para Sage/Lia iniciarem as ações acima.

## Não fazer ainda / Diego
Nenhum merge por agente, produção, deploy, integração, alteração de ruleset/status-check, automação, criação de Mia, acesso ou transferência real. Requisitos administrativos dependem de aprovação explícita de Diego. Não inferir aprovação a partir de merge documental.
Versão atual desta coordenação na branch rivers-coordenacao-20260921-1848/#16 até merge humano. CI final e recomendação registrados na descrição do PR, sem novo commit recursivo só para registrar resultado.

---

## DIEGO REVIEW REQUIRED — somente PR #16 de coordenação

Os cinco arquivos publicados foram relidos integralmente e comparados com o conteúdo preparado; diff limitado a coordenação. O CI do primeiro head `f1fb559a3a1b604dc947c311d210240c844472dc` passou. Esta atualização registra a prontidão documental; o CI do head final ainda deve passar antes de marcar o PR como pronto na interface e recomendar merge. O sinal final fica na descrição do #16 e no aviso a Diego, para não gerar novo commit a cada verificação.

Após esse sinal, Diego pode revisar e, se concordar, fazer merge **somente do #16**. Isso não aprova os PRs de produto, rulesets, produção, Mia ou integrações. Sage/Lia podem ler este handoff antes do merge; não precisam aguardar Diego para as ações já autorizadas.

## Rodada Rivers — 21/09/2026, 18h47 BRT

## Evidências da consulta em 21/09/2026, 18h44–18h47 BRT
- Main: `be0860e46be3c209152a2c5de2f1b042128503ad`; PR #12 fechado e mergeado. O CURRENT de 07h28 é histórico, não a lista de tarefas atual.
- #11: `108a482cc391e31e4ffca98deb71e8d13ef1733e`, draft, mergeable=false/dirty. Check-runs, statuses e workflow runs consultados para esse SHA: nenhum resultado concluído; não há CI verde comprovado para esse head.
- #15: `dfecfd0d707b9ab2ffd18481dd1abb4f1b2c7900`, draft, mergeable=true/clean. [SCL Node 22 tests concluído com success](https://github.com/al-life/scl-reconstrucao/actions/runs/35656407037/job/106521058050).
- #13 e #14: draft e mergeable=false/dirty na consulta; permanecem trilhas documentais separadas. #5 permanece Labs, sem promoção.
- Turno Rivers confirmado pelos handoffs de Sage [18h16](https://github.com/al-life/scl-reconstrucao/blob/dfecfd0d707b9ab2ffd18481dd1abb4f1b2c7900/coordination/handoffs/2026-09-21-1816-sage-policy-types.md) e [18h38](https://github.com/al-life/scl-reconstrucao/blob/108a482cc391e31e4ffca98deb71e8d13ef1733e/coordination/handoffs/2026-09-21-1838-sage-payment-demo.md).

## Revisão delimitada de Rivers
Leitura do protocolo de main e do complemento ainda pendente no #15; CURRENT/RIVERS/DIEGO e handoffs, PRs abertos e código/testes selecionados. Não é revisão integral dos PRs nem nova validação visual.

No #11, a correção HTML 200 já está no servidor e na regressão; API permanece 503/UNKNOWN. Não repetir a implementação solicitada pelo CURRENT antigo. A máquina de estados de pagamento inspecionada mantém canPay=false, ignora retorno do navegador como confirmação, exige conferência em divergências e aprovação tardia. Duplicação é tratada apenas em memória; isso não é integração, webhook confiável ou idempotência persistente. Os 30 testes locais são relato de Sage, não execução desta rodada.

No #15, a guarda typeof session.role === 'string' ocorre antes do lookup e da restrição de owner; o teste inclui arrays, objeto String e objeto conversível. A correção é coerente com o defeito descrito. A função ainda exige sessão confiável do backend, e não autentica nem protege sozinha um painel real. O CI verde não equivale a validação da Lia ou aprovação de produção.

A proposta Neon/S3 do #11 permanece proposta de Sage, sem provisionamento ou escolha aprovada por Rivers; regiões, custos e acessos não foram revalidados nesta rodada.

## Próximos responsáveis e condições
1. **Sage — próximo passo técnico acionável:** reconciliar o #11 com a main atual preservando todas as mudanças e handoffs; incorporar a coordenação desta rodada sem ressuscitar estados antigos. Não refazer a correção HTTP. Rodar/verificar CI no novo head e entregar referência exata para Lia. Preservar o histórico, sem force push nesta orientação.
2. **Lia — validação de UX:** após a base do #11 estabilizar e CI passar, validar busca/capacidade/datas, responsividade e demonstração de pagamento. O #15 pode receber validação independente de UX quando disponível; não atribuímos aceite a Lia.
3. **Lia — #14:** tratar o parecer de Sage de 17h16 (entradas Lia/Mia, preparação versus envio, registro próprio), reconciliar sua branch e registrar evidências. Não ativar Mia antes das portas e decisão humana já documentadas.
4. **Rivers — retorno:** revisar o head reconciliado e as evidências da Lia antes de recomendar merge de produto. A recuperação da fórmula de marketplace solicitada no #13 permanece pendente em rodada própria; não foi inventada nem resolvida aqui.

A autonomia delimitada de Sage está documentada na seção 18 da branch do #15, ainda não incorporada à main; esta rodada não muda esse protocolo nem altera agendas. Não há suspensão global de trabalhos independentes.

## Limites e Diego
Nenhum merge, deploy, ruleset, produção, credencial, integração real, ativação de agente ou dado privado foi alterado. Gate SCL Node 22 tests obrigatório continua dependendo de autorização explícita de Diego. Merge documental não é essa autorização.

Diego não precisa agir agora. PRs #11/#13/#14/#15 continuam rascunhos e não recebem pedido de merge nesta rodada. Este PR de coordenação nasce draft; conferir seu próprio CI e revisão antes de sinalizar prontidão. Sua publicação não significa que main já contém esta reconciliação.

Handoff: [2026-09-21-1848-rivers-coordenacao.md](handoffs/2026-09-21-1848-rivers-coordenacao.md).

---

## Rodada — reconciliação pós-merge do PR #10 — 21/09/2026, 07h28 BRT

### Verificado
- Li `00-PROTOCOLO.md`, `coordination/CURRENT.md`, `coordination/RIVERS.md`, `coordination/DIEGO.md` e os handoffs mais recentes relevantes, especialmente `2026-09-21-sage-pr10-pos-pr9.md` e `2026-09-21-lia-relatorios-governanca.md`.
- PR #10 está `closed/merged=true`; merge humano na `main` em `b370b5de72836f5cfb73d917aba90b9902cd2653`.
- O head final do PR #10 é `ec62f87e4474c1482f3dc10bf4c0df498f364e1f`; o workflow `SCL tests` concluiu com `success`.
- Os arquivos alterados pelo #10 são documentação/coordenação sanitizada; nenhuma aplicação ou workflow foi alterado por esse PR.
- PR #11 segue aberto em `draft`, com head `5f40c0cd3e9ae53d882f033cd7d28a26b5853324`, baseado em estado anterior da `main`, e o GitHub hoje o reporta como não mergeável após o avanço da base.
- A revisão Rivers já registrada no #11 continua válida: HTML válido de `/disponibilidade` deve responder 200 mantendo UNKNOWN; a API pode continuar fail-closed/503 sem provider; entrada inválida continua 400; falta regressão explícita do 200.

### Decisão
Reconciliar o merge do PR #10 e devolver o fluxo ao construtor responsável pelo #11. **Sage é o próximo e pode começar imediatamente.** Antes da correção funcional, ele deve reconciliar/rebasear a branch do #11 sobre a `main` atual para não reintroduzir CURRENT/DIEGO/RIVERS antigos. Depois faz somente a correção mínima do status HTML, adiciona regressão, roda CI e entrega para Lia validar busca e responsividade ampliada.

O PR #11 permanece draft e não deve ser marcado como pronto para Diego antes da validação da Lia e da revisão final do head reconciliado.

### Deliberadamente não decidido
- não apliquei `required_status_checks` nem qualquer outra mudança administrativa;
- não corrigi diretamente o código do #11, para preservar o responsável e o handoff existente;
- não fiz merge, deploy, publicação ou alteração de domínio;
- não conectei Beds24, Booking, Mercado Pago, Vercel ou qualquer credencial;
- não movi dados reais, documentos pessoais, dados bancários ou PII para o repositório.

### Próximo
**Sage pode começar imediatamente no PR #11.** Diego não precisa agir agora. Esta reconciliação documental segue em branch/PR próprio; quando o CI desse PR de coordenação estiver verde, ele poderá ser revisado/mergeado por Diego sem bloquear Sage.

Handoff: `coordination/handoffs/2026-09-21-0728-rivers-pos-pr10.md`.

---

## Rodada — reconciliação pós-merge do PR #8 — 21/09/2026, 01h30 BRT

### Verificado
- Li protocolo, CURRENT, RIVERS, DIEGO e o handoff mais recente `2026-09-21-0027-rivers-pos-pr7.md`.
- PR #8 está `closed/merged=true`; merge humano às 00h34 BRT em `153675277fbe41ba172e6bc614aeb47a81ba4fc5`.
- O head final `7f7dc3fd3ce629b4810293211afdddffa806e4f9` executou `SCL tests` com conclusão `success`.
- Reli o ruleset 23741255: `main-pr-manual` segue ativo, sem bypass e ainda sem `required_status_checks`.
- PR #8 continha somente coordenação/histórico; nenhuma mudança de aplicação ou administrativa foi incorporada.

### Decisão
Reconciliar o merge do PR #8 sem reabrir a decisão já delegada a Diego. O gate documentado continua dependendo de autorização humana explícita; merge documental não é autorização administrativa.

A única mudança material desta rodada é atualizar o estado canônico para registrar que o PR #8 já foi mergeado e manter a decisão do gate separada.

### Deliberadamente não decidido
- não apliquei `required_status_checks`;
- não mudei strictness, bypass, aprovações, merge queue ou qualquer outra proteção;
- não toquei em deploy, produção, Vercel, domínio, Beds24, Mercado Pago, secrets ou dados reais;
- não promovi o PR #5/Labs para execução.

### Próximo
Abrir PR apenas documental desta reconciliação. **Diego revisa/mergeia quando o CI do head final estiver verde.** Depois disso, Diego continua sendo o próximo somente para decidir, quando quiser, se autoriza a aplicação do gate. Sem autorização explícita, nenhum agente aplica nada.

Handoff: `coordination/handoffs/2026-09-21-0130-rivers-pos-pr8.md`.

---

## Rodada — reconciliação pós-merge do PR #7 — 21/09/2026, 00h27 BRT

### Verificado
- Li protocolo, CURRENT, RIVERS, DIEGO e o handoff mais recente `2026-09-20-2328-rivers-pr7-decisao-diego.md`.
- PR #7 está `closed/merged=true`; merge humano em `0426286b32a93dd7de123917a72fa051b868e807`.
- O head final `cfc7c21f9d4f089663261501a7ef8b8a0d11c077` executou o workflow `SCL tests` com conclusão `success`.
- Reli o ruleset 23741255 após o merge: `main-pr-manual` segue ativo, sem bypass e ainda sem `required_status_checks`.
- Portanto, o merge do PR #7 incorporou apenas a documentação/proposta; a mudança administrativa não foi aplicada.

### Decisão
Não inferir autorização administrativa a partir do merge. A aplicação de `SCL Node 22 tests` como gate continua condicionada a uma autorização explícita de Diego.

Não abrir outra frente técnica só para preencher tempo enquanto essa decisão humana está pendente. O workbench pode permanecer estável sem ruído.

### Deliberadamente não decidido
- não apliquei `required_status_checks`;
- não mudei strictness, bypass, aprovações, merge queue ou qualquer outra proteção;
- não toquei em deploy, produção, Vercel, domínio, Beds24, Mercado Pago, secrets ou dados reais;
- não promovi o PR #5/Labs para execução.

### Próximo
**Diego é o próximo, mas não precisa agir agora.** Quando quiser retomar o assunto, basta decidir se autoriza ou não a aplicação do gate documentado. Se autorizar explicitamente, a rodada seguinte aplica somente essa regra e verifica o resultado. Sem autorização, nada deve ser aplicado.

Handoff: `coordination/handoffs/2026-09-21-0027-rivers-pos-pr7.md`.

---

## Rodada — revisão do gate preparado por Sage — 20/09/2026, 23h28 BRT

### Verificado
- Li protocolo, CURRENT, RIVERS, DIEGO e o handoff `2026-09-20-2319-sage-ci-gate-preparado.md`.
- PR #6 está mergeado (`01d8c5567bba08fe3483dafdf3bfd363d6bb62e1`).
- Retargetei o PR #7 de `rivers-pos-pr4-reconcile` para `main`, eliminando a dependência documental já incorporada.
- Reli o ruleset 23741255: `main-pr-manual` segue ativo, sem bypass e sem `required_status_checks`.
- Reli o check-run do head final do PR #6: nome exato `SCL Node 22 tests`, emissor GitHub Actions, `integration_id` 15368, conclusão `success`.
- O CI do head inicial do PR #7 havia concluído com sucesso antes desta atualização documental.
- A proposta de Sage limita a mudança a um único `required_status_checks`, com `strict_required_status_checks_policy: false`, e manda preservar todas as regras/parâmetros existentes.

### Decisão
A proposta está tecnicamente coerente e suficientemente estreita para decisão humana. **DIEGO REVIEW REQUIRED — PR #7.**

Recomendo merge humano do PR #7 quando o CI do head final desta rodada estiver verde. Esse merge incorpora apenas a documentação/proposta e **não** autoriza nem aplica a alteração do ruleset.

A aplicação do status check obrigatório continua condicionada a autorização explícita de Diego.

### Deliberadamente não decidido
- não apliquei `required_status_checks`;
- não ativei `strict=true`;
- não mudei bypass, aprovações, merge queue ou outras regras;
- não toquei em deploy, produção, Vercel, domínio, Beds24, Mercado Pago, secrets ou dados reais;
- não promovi o PR #5/Labs para execução.

### Próximo
**Diego é o próximo.** Pode revisar/mergear o PR #7 assim que o CI do head final estiver verde e decidir, separadamente, se autoriza a aplicação administrativa do gate.

Handoff: `coordination/handoffs/2026-09-20-2328-rivers-pr7-decisao-diego.md`.

---

## Rodada — pós-merge do PR #4 — 20/09/2026, 22h30 BRT

### Verificado
- Li protocolo, CURRENT, RIVERS, DIEGO e o handoff mais recente da linha principal.
- PR #4 foi mergeado humanamente às 21h58 BRT (`4f656c8e5ca8aed9a0b8ec286f4ef50330761c6e`).
- `.github/workflows/scl-tests.yml` agora está em `main` e dispara em `pull_request`.
- O head final do PR #4 havia passado `SCL tests` com 24/24 testes Node 22.
- O ruleset `main-pr-manual` continua ativo, sem bypass, exigindo PR e resolução de conversas e bloqueando exclusão/force push.
- O ruleset ainda não possui `required_status_checks`; o CI existe, mas ainda não é gate obrigatório.
- O único PR aberto fora desta rodada é o #5, uma nota de Labs sobre Bumble Helper; ele não pertence à faixa operacional atual e não bloqueia este fluxo.

### Decisão
Fechar o ciclo do CI antes de voltar a produto: **Sage verifica o contexto exato do check `SCL Node 22 tests` e prepara a menor configuração segura para torná-lo obrigatório em PRs para `main`.** A aplicação no ruleset depende de aprovação explícita de Diego.

Se houver ambiguidade de contexto, integração ou efeito colateral de governança, Sage deve parar e devolver evidência em vez de improvisar.

### Deliberadamente não decidido
- scanners pagos;
- mudanças adicionais de governança além do status check;
- deploy/publicação;
- Vercel/domínio;
- Beds24/Mercado Pago;
- próxima feature de produto.

### Próximo
**Sage pode começar imediatamente na investigação/preparação. Não deve aplicar a mudança de ruleset sem aprovação explícita de Diego.** Produção permanece intocada.

Handoff: `coordination/handoffs/2026-09-20-2230-rivers-pos-pr4.md`.

---

## Rodada — PR #4 pronto para Diego — 20/09/2026, 21h29 BRT

### Verificado
- Li protocolo, CURRENT, RIVERS, DIEGO e o handoff mais recente disponível, além do estado pendente do PR #4.
- PR #4 aponta para `main`, estava `mergeable: true` e não tinha comentários/reviews pendentes antes desta atualização documental.
- Head reconciliado `3d7f09f62030cd7a8d8fce4d749634ca0bade5be` executou `SCL tests` com sucesso.
- Job `SCL Node 22 tests`: 24 testes, 24 pass, 0 fail, 0 cancelled, 0 skipped.
- Logs confirmam `contents: read`, `metadata: read` e `persist-credentials: false` no checkout.
- O diff funcional adiciona somente `.github/workflows/scl-tests.yml`; mudanças restantes são coordenação/histórico. Aplicação inalterada.

### Decisão
**DIEGO REVIEW REQUIRED.** Recomendo merge humano do PR #4.

Não transformar o check em obrigatório no ruleset nesta rodada. Primeiro incorporar o workflow em `main`; depois reconciliar o estado e decidir a próxima fatia.

### Deliberadamente não decidido
- check obrigatório no ruleset;
- scanner pago;
- deploy/publicação;
- Vercel/domínio;
- Beds24/Mercado Pago;
- qualquer mudança de produto além do CI.

### Próximo
**Diego é o próximo e pode revisar/mergear imediatamente.** Após a decisão humana, Rivers reconcilia o resultado.

Handoff: `coordination/handoffs/2026-09-20-2129-rivers-pr4-ready.md`.

---

## Rodada — reconciliação do PR #4 após merge do #3 — 20/09/2026

### Verificado
- Diego confirmou merge humano do PR #3.
- PR #4 estava draft e ainda baseado na branch do #3.
- Retarget para `main` mostrou branch divergente: 5 commits à frente e 5 atrás.
- Head anterior do PR #4 teve workflow `SCL tests` concluído com sucesso, 24/24 testes.

### Ação
Reconstruí a branch do PR #4 sobre a `main` mergeada, preservando apenas o workflow de CI e a coordenação material do Sage/Rivers. Nenhum arquivo da aplicação foi alterado.

### Gate
Aguardar/conferir nova execução do workflow no novo head e então revisar o diff final. Não recomendar merge antes disso.

### Limites
Sem deploy, produção, secrets, integrações reais ou compras.

---

## Rodada — pós-PR #2 / próxima fatia — 20/09/2026

### Verificado
- Li protocolo, CURRENT, RIVERS, DIEGO e o handoff Sage de governança.
- PR #2 está `closed/merged=true`, merge `b53e25e9ce4a34bfee4f0fcb8cb78e14f0046993`.
- A documentação de governança chegou à `main`; não há mais gate pendente do PR #2.
- Produção continua intocada.

### Decisão
A próxima fatia deve ser pequena e operacional: **Sage implementa CI mínimo para executar a suíte Node já existente em PR**, com Node 22 e Actions oficiais pinadas por SHA completo.

Não transformar o check em requisito do ruleset antes de ele passar de verdade em um PR. Não adicionar scanner pago, deploy, secrets ou integrações externas nesta rodada. Secret Protection/Code Security pagos permanecem em avaliação futura, sem compra agora.

Motivo: depois de proteger a `main` e tornar PR obrigatório, falta uma verificação automática básica para evitar regressão trivial. É higiene diretamente útil ao ritmo de construção, sem abrir arquitetura paralela.

### Deliberadamente não decidido
- status check obrigatório no ruleset;
- scanner pago de código/segredos;
- separação técnica de identidades humano/agente;
- publicação/deploy;
- Beds24/Mercado Pago;
- próxima feature de produto após o CI.

### Próximo
**Sage pode começar imediatamente** usando o handoff desta rodada. Diego só precisa fazer o merge manual do PR documental desta rodada quando estiver satisfeito; isso não bloqueia Sage de ler a branch/handoff para iniciar o CI.

Handoff: `coordination/handoffs/2026-09-20-rivers-pos-pr2-ci.md`.

---

## Atualização por Sage — governança pós-merge — 20/09/2026

PR #1 confirmado mergeado (`1d9c1a43eda3fd55a01f220963c109cb34094901`). Regras administrativas aplicadas e verificadas: main exige PR, bloqueia force push/exclusão, exige conversas resolvidas e não tem bypass. Auto-merge desligado. Actions com SHA obrigatório; token read-only e aprovação por Actions já desabilitados. Dependency graph/alertas/correções de segurança Dependabot ativados.

Recursos pagos de code/secret scanning aguardam avaliação de benefício/custo; Diego autoriza considerar contratação útil. Nada comprado. Inventário de secrets apenas por configuração, sem valores. Sem produção.

Próximo: Rivers confere o PR documental da branch `sage-governanca-pos-pr1`, depois Diego faz merge manual. Coordenação também passa por PR; nenhuma automação reprogramada. Consultar PRs de coordenação abertos antes de executar sobre um CURRENT antigo. Não atribuir esta revisão a Rivers antes de ele fazê-la.

[Handoff completo](handoffs/2026-09-20-2006-sage-governanca-pos-pr1.md). Históricos abaixo preservados.

---

# RIVERS

## Rodada — conferência final do PR #1 — 20/09/2026, 19h28 BRT

### Verificado
- Li o handoff Sage 18h43 e o estado atual do workbench.
- PR #1 está aberto, não é draft, head `7ba1c0c53d4edb13e0a75c1f6394a17817e67be4` e GitHub reporta `mergeable: true`.
- Inspecionei a implementação do redirect legado no diff.
- Inspecionei os testes de regressão adicionados para preservação de critérios, descarte de extras, GET/HEAD e rejeição de critérios inválidos/incompletos/duplicados/acima da capacidade.
- Sage registrou 24/24 testes na base limpa e 24/24 no site original no head atual. Não há CI remoto.
- A validação responsiva da Lia pertence ao head anterior e não foi reatribuída ao novo head.

### Decisão
**DIEGO REVIEW REQUIRED.** A base está pronta para revisão humana e merge no workbench.

Recomendo merge do PR #1 se Diego estiver satisfeito com a revisão. Esse merge não equivale a deploy nem aprovação de produção.

### Deliberadamente não decidido
- publicação;
- domínio;
- Beds24/Mercado Pago;
- reserva/cobrança real;
- auth/portal/e-mail;
- mídia final;
- próxima feature pós-merge.

### Próximo
Diego faz a revisão humana do PR #1. Nenhum agente deve iniciar nova fatia de aplicação antes dessa decisão. Após merge ou comentários de Diego, Rivers reconcilia o estado e define o próximo passo.
