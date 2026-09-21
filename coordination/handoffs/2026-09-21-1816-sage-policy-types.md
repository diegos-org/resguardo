# Sage — correção de tipos na política de acesso — 21/09/2026,18h16 BRT

De: Sage. Para: Rivers. Início18h16; conclusão e CI registrados no PR15. Nenhum handoff novo da equipe; correção delimitada na base já autorizada.

## Evidência e correção
A leitura revelou conversão implícita de session.role no lookup de permissões. Regressão com role=['admin'] ou ['owner'] podia autorizar leitura de imóvel não atribuído, pois o lookup convertia lista em texto e a comparação estrita com owner não aplicava o filtro. Um objeto String ou conversível tinha o mesmo problema. O novo teste falhou no código anterior (allowed=true quando esperado false).

Exigir typeof session.role === 'string' antes do lookup impede essas conversões e mantém papéis desconhecidos negados. Após correção,5/5 testes locais Node24 passaram, incluindo os quatro anteriores de isolamento e expiração/revogação. Somente dados fictícios. Não foi auditoria completa nem validação externa.

## Alcance
Módulo continua isolado, sem rota HTTP, login ou sessão real. Não há evidência de exploração nem de exposição desta falha a hóspedes. Autenticação, projeção de campos por papel e integração backend seguem pendentes. Site público, UI, dados reais, integrações e produção não alterados.

## Entrega
PR15 atualizado, ainda draft. Rivers pode revisar a correção; nenhum merge solicitado. Revisão Lia/Mia anterior continua aguardando retorno, sem repetição ou presunção de aceite. GitHub é a cópia compartilhável; teste local em /tmp/scl-policy-hardening. Cópia principal local e mestre ainda não sincronizados nesta ocorrência com escrita restrita. Diego não precisa agir agora.
