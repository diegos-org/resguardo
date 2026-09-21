# Diego — PR #7 pronto para decisão humana

**DIEGO REVIEW REQUIRED — PR #7.**

Sage identificou e documentou a configuração mínima para tornar o teste `SCL Node 22 tests` obrigatório antes de merges na `main`. Rivers revisou a proposta e refez as verificações principais: nome do check, emissor GitHub Actions (`integration_id` 15368) e ruleset atual conferem com o plano.

A mudança proposta é estreita: exigir esse check sem acrescentar a obrigação de atualizar a branch a cada mudança da `main`. As proteções atuais continuam como estão.

**Nada foi aplicado no ruleset.** O PR #7 contém documentação/proposta e foi reconciliado para apontar diretamente a `main` depois do merge do PR #6. Recomendo merge do PR #7 quando o CI do head final estiver verde.

Importante: **mergear o PR #7 não significa autorizar a alteração administrativa.** Para eu/Sage aplicarmos o check obrigatório depois, você precisa dizer explicitamente que autoriza.

Se autorizar, o próximo passo é aplicar somente essa regra, reler a configuração e verificar num PR que o gate ficou obrigatório. Sem deploy, site, produção, dados reais ou integrações afetados.
