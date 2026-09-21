# Snapshot anterior à rodada Rivers de 21/09/2026, 18h47 BRT

Fonte: main em `be0860e46be3c209152a2c5de2f1b042128503ad`. Conteúdo abaixo é histórico; não aciona trabalho nem pedido de merge.

## coordination/CURRENT.md — conteúdo integral

# Estado atual — PR #10 mergeado; PR #11 volta para Sage — 21/09/2026, 07h28 BRT

Diego realizou o merge humano do PR #10 na `main` (`b370b5de72836f5cfb73d917aba90b9902cd2653`). O head final do PR #10 (`ec62f87e4474c1482f3dc10bf4c0df498f364e1f`) executou `SCL tests` com conclusão `success`. O merge incorporou somente documentação sanitizada de operação/produto e coordenação; não publicou aplicação, não ativou integrações e não alterou regras administrativas.

## Consolidação agora em main
A `main` passa a conter a consolidação autorizada por Diego: seis imóveis operados, somente cinco do Rio no catálogo público; Búzios separado e inclusão interna ainda indecisa. A migração documental continua parcial e dados sensíveis permanecem fora do GitHub. Beds24, Booking e Mercado Pago continuam como frentes próprias de validação, sem sincronização, cobrança ou publicação autorizada por esse merge.

## PR #11 — próximo passo
O PR #11 continua `draft` e ainda não está pronto para Diego. A revisão anterior de Rivers encontrou um ajuste pequeno: consulta HTML válida em `/disponibilidade` deve responder 200, mantendo disponibilidade UNKNOWN; `/api/disponibilidade` pode permanecer fail-closed/503 enquanto não houver provider validado, e entrada inválida continua 400.

Como a `main` avançou com os merges #9 e #10, a branch do #11 ficou baseada em estado anterior e hoje aparece não mergeável. **Sage é o próximo e pode começar imediatamente:** primeiro reconciliar/rebasear o #11 sobre a `main` atual sem reintroduzir coordenação antiga; depois fazer somente a correção do status HTTP + regressão, rodar CI e entregar para Lia validar busca e responsividade ampliada. O PR permanece draft até essa validação.

## Coordenação desta rodada
PR #12 contém apenas esta reconciliação pós-merge do #10. Foi aberto para revisão humana conforme o protocolo, mas ainda **não deve ser tratado como pronto para merge até o CI do head final concluir com sucesso**. O #12 não bloqueia Sage de começar o #11.

## Decisão administrativa separada
A proposta de exigir `SCL Node 22 tests` como status check obrigatório continua dependendo de autorização explícita de Diego. Nenhum merge documental é autorização para aplicar o gate.

Produção, deploy, domínio, Vercel, Beds24, Mercado Pago, secrets e dados reais permanecem intocados.

## Histórico
- PR #10 incorporou os handoffs `2026-09-21-sage-pr10-pos-pr9.md` e `2026-09-21-lia-relatorios-governanca.md`.
- A revisão Rivers do PR #11 permanece preservada em `coordination/handoffs/2026-09-21-0631-rivers-para-sage-pr11.md` dentro da branch do #11.
- Reconciliação desta rodada: `coordination/handoffs/2026-09-21-0728-rivers-pos-pr10.md`.


## coordination/DIEGO.md — conteúdo integral

# Diego — PR #10 concluído; Sage volta ao PR #11

Seu merge do PR #10 foi confirmado na `main`. A consolidação da Lia agora está incorporada: seis imóveis na operação, cinco do Rio no site; Búzios continua fora do público e a inclusão interna segue a decidir. A migração das regras continua parcial e não leva dados sensíveis ao GitHub.

O CI do head final do #10 passou. Esse merge foi documental: não publicou o site, não ativou Beds24/Booking/Mercado Pago e não alterou regras administrativas.

## Agora
**Você não precisa fazer nada imediatamente.** O PR #11 continua rascunho e ainda não está pronto para sua revisão/merge.

Sage é o próximo e pode começar agora. Como a `main` avançou com #9/#10, ele precisa primeiro reconciliar a branch do #11 com a base atual, sem ressuscitar coordenação antiga. Depois corrige o detalhe já identificado por Rivers: a página HTML válida de `/disponibilidade` deve responder 200, mantendo disponibilidade não confirmada; a API pode continuar 503 enquanto não houver integração real. Em seguida roda CI e passa para Lia validar busca/mobile.

## PR #12
O PR #12 contém somente a reconciliação documental desta rodada pós-#10. Ele **ainda não está marcado como pronto para merge**, porque o CI do head final precisa concluir com sucesso. Isso não bloqueia Sage no #11. Quando o #12 estiver realmente pronto para sua revisão/merge, o aviso será explícito.

## Decisão separada
Tornar `SCL Node 22 tests` uma trava obrigatória ainda depende de sua autorização explícita. Nada nesta rodada aplicou essa mudança.

Produção, deploy, domínio, integrações, credenciais, secrets e dados reais continuam intocados.

A reconciliação desta rodada está no handoff `coordination/handoffs/2026-09-21-0728-rivers-pos-pr10.md`.
