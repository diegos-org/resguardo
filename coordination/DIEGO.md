# Diego — PR #11 revisado por Rivers; Sage faz uma correção pequena antes da Lia

Revisei a fatia mobile/busca que o Sage colocou no PR #11. O CI do head que ele entregou passou e a direção funcional está boa: busca com imóvel opcional, filtro por capacidade, datas preservadas e nenhuma falsa promessa de disponibilidade.

Achei um detalhe técnico que vale corrigir antes da revisão visual final: como a busca principal agora usa `/disponibilidade`, uma consulta válida está recebendo **HTTP 503** mesmo quando a página de resultados é o fluxo normal esperado. A página abre e explica que a disponibilidade ainda não foi confirmada, mas o status técnico deveria ser 200 nesse caso. A API pode continuar fechada/503 enquanto Beds24 não estiver integrado.

**Sage é o próximo e pode começar imediatamente.** A correção é pequena: ajustar somente o status do fluxo HTML válido e adicionar teste de regressão. Depois, Lia valida busca e responsividade ampliada.

**Você não precisa fazer nada agora e o PR #11 ainda não está pronto para revisão/merge humano.** PRs #9 e #10 seguem independentes; produção, deploy, domínio, Beds24, Mercado Pago, secrets e dados reais continuam intocados.

---

# Sage — revisão mobile por pedido direto de Diego — 21/09/2026

Implementados ajustes de busca/copy/alinhamento e resultados por capacidade, com datas preservadas e disponibilidade UNKNOWN explícita. Não há integração Beds24 ou promessa de vagas. 25/25 testes passaram na base compartilhável; home de 390px conferida visualmente. Pilotos locais Rio/Ipanema e seletor 768/900px preparados; Fold real ainda não testado. Requisitos de cadastro editável, rascunho e publicação bloqueada por incompletude documentados em mobile-expansion-2026-09-21.md. Sem merge, deploy, alteração de ruleset ou mídia original enviada.

Próximo: Rivers pode revisar esta fatia solicitada diretamente por Diego; Lia pode validar busca e mobile após revisão. PR permanece draft até conferência responsiva ampliada e CI do head. Gate administrativo continua pendente, separado desta autorização de produto. PR #9 contém reconciliação documental pendente e não foi sobrescrito.

---

# Diego — PR #7 já foi mergeado; não há nada para fazer agora

**DIEGO REVIEW REQUIRED — PR #8 quando o CI do head final estiver verde.** Esse PR contém somente a reconciliação documental pós-merge do #7; não altera aplicação nem ruleset.

O PR #7 foi mergeado com sucesso na `main`. O CI do head final passou.

O que entrou foi **só a documentação da proposta** para tornar `SCL Node 22 tests` obrigatório antes de merges na `main`. Isso não alterou o ruleset e não tocou produção.

## O que continua pendente
Quando você quiser voltar a esse assunto, há uma decisão separada e simples: autorizar ou não que esse teste vire uma trava obrigatória antes de merge.

Se você autorizar explicitamente, a próxima rodada aplica somente essa regra, relê a configuração e verifica num PR se o gate ficou obrigatório. Se não autorizar, nada muda.

**Você não precisa fazer isso agora.** O merge do PR #7 não foi interpretado como autorização administrativa.

Produção, deploy, domínio, Vercel, Beds24, Mercado Pago, secrets e dados reais continuam intocados.
