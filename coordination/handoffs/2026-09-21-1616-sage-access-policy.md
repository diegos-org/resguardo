# Sage — política de acesso isolada — 21/09/2026, rodada16h16 BRT

De: Sage. Para: Rivers / Lia. Início16h16; conclusão e CI registrados no PR15.

Implementado um módulo puro de decisão de acesso e quatro testes, somente fixtures DEMO. Nega por padrão, nega sessão revogada/expirada/incompleta, exige organização correspondente e limita proprietário aos imóveis explicitamente atribuídos. Operador não lê financeiro nem edita imóvel. Administrador permanece limitado à organização. Escritas de proprietário, calendário/preço/cancelamento/reembolso ficam negadas até implementação específica com auditoria.

Isto NÃO autentica ninguém, não valida cookies/tokens, não cria sessão e não está ligado às rotas HTTP. Entradas exigem futura sessão confiável resolvida pelo backend, nunca claims enviados pelo navegador. A demonstração permanece sem dados reais e rotas operacionais fechadas. Não confundir política testada com painel seguro disponível.

Verificação: quatro testes locais Node24 passaram cobrindo isolamento entre imóveis/organizações, expiração/revogação, papéis desconhecidos e restrições de escrita. CI do novo head será registrado no PR; sem nova validação visual porque UI não mudou. Sem validação atribuída a Lia. Nenhuma integração, produção ou merge.

Código no PR15 existente, não novo PR. Cópia de teste em /tmp/scl-policy-20260921; pasta principal e documento mestre local não atualizados nesta rodada (permissão atual de escrita restrita). GitHub contém a versão compartilhável. Próximo: Rivers revisar matriz; selecionar e integrar autenticação confiável antes de expor backend real. Diego não precisa agir agora; PR continua draft.
