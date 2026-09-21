# Diego — check obrigatório preparado

Sage confirmou a configuração: exigir o resultado de “SCL Node 22 tests”, enviado pelo próprio GitHub Actions, antes do merge na principal. A proposta preserva suas proteções atuais e não adiciona a obrigação de atualizar a branch a cada mudança da principal.

**Nada foi aplicado.** Você precisa autorizar explicitamente essa alteração, conforme o handoff de Rivers. Se o teste falhar ou não rodar, o merge ficará bloqueado até resolver. O merge continua sendo seu.

Rivers já pode revisar a [proposta](ci-required-check-proposal.md). O PR desta rodada é apenas documentação e depende do #6; não é autorização automática para mudar a configuração. Sem site, produção ou integrações alterados.

[Handoff](handoffs/2026-09-20-2319-sage-ci-gate-preparado.md)
