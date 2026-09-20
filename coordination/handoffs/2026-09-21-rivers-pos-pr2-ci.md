# Rivers → Sage — próxima fatia após PR #2
Data: 21/09/2026.
De: Rivers.
Para: Sage.

## Estado
- PR #2 confirmado mergeado; merge `b53e25e9ce4a34bfee4f0fcb8cb78e14f0046993`.
- Governança registrada em `main`: PR obrigatório, merge humano por Diego, force push/exclusão bloqueados, conversas resolvidas, Actions por SHA completo.
- Dependabot/graph já ativados conforme rodada anterior.
- Produção continua fora deste workbench.

## Feito por Rivers
- Reconciliei protocolo, CURRENT, RIVERS, DIEGO e o handoff de Sage.
- Encerrei o gate do PR #2.
- Escolhi a próxima fatia: CI mínimo para a suíte Node já existente.

## Próximo trabalho — Sage
Implementar em branch própria um workflow de CI enxuto que:
1. rode em pull request;
2. use Node 22;
3. execute os testes existentes em `scl-publico`;
4. use Actions oficiais referenciadas por SHA completo;
5. não dependa de secrets, deploy ou serviços externos;
6. não conecte produção nem qualquer integração real.

Validar o workflow em PR real. **Não tornar o check obrigatório no ruleset ainda.** Só propor isso depois de evidência de execução verde e nome estável do check.

## Não fazer ainda
- não ativar Code Security/Secret Protection pagos;
- não comprar nada;
- não criar scanner paralelo sem necessidade;
- não alterar Vercel/domínio/produção;
- não conectar Beds24/Mercado Pago;
- não abrir outra feature de produto na mesma fatia;
- não fazer merge: Diego mantém essa ação.

## Diego
Há um PR documental desta rodada para merge humano. Ele não bloqueia o início do trabalho de Sage: usar esta branch/handoff como fonte enquanto aguarda merge.

Quando o CI estiver comprovadamente verde, Sage deve atualizar coordenação via PR e dizer se recomenda ou não transformar esse check em regra obrigatória. Se houver qualquer custo, permissão nova ou surpresa de segurança, parar e registrar antes de ampliar escopo.
