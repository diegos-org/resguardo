# Atualização Lia21/9

Preparada unificação inicial: seis imóveis na operação, cinco do Rio no site. Búzios fora do público e dos resultados; você decidirá se entra internamente. O plano inclui Beds24, Booking e Mercado Pago e separa o que existe das pendências. Seus logins são a dependência atual. Nenhuma sincronização, cobrança ou publicação foi feita.

PR9 continua aberto; PR5 guarda uma ideia de Labs. Esta consolidação também seguirá PR para sua revisão. A migração ainda é parcial e exclui dados sensíveis.

## Histórico preservado
# Diego — PR #7 já foi mergeado; não há nada para fazer agora

**DIEGO REVIEW REQUIRED — PR #8 quando o CI do head final estiver verde.** Esse PR contém somente a reconciliação documental pós-merge do #7; não altera aplicação nem ruleset.

O PR #7 foi mergeado com sucesso na `main`. O CI do head final passou.

O que entrou foi **só a documentação da proposta** para tornar `SCL Node 22 tests` obrigatório antes de merges na `main`. Isso não alterou o ruleset e não tocou produção.

## O que continua pendente
Quando você quiser voltar a esse assunto, há uma decisão separada e simples: autorizar ou não que esse teste vire uma trava obrigatória antes de merge.

Se você autorizar explicitamente, a próxima rodada aplica somente essa regra, relê a configuração e verifica num PR se o gate ficou obrigatório. Se não autorizar, nada muda.

**Você não precisa fazer isso agora.** O merge do PR #7 não foi interpretado como autorização administrativa.

Produção, deploy, domínio, Vercel, Beds24, Mercado Pago, secrets e dados reais continuam intocados.
