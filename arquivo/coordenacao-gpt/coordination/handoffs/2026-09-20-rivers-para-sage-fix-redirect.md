# Handoff — Rivers → Sage — correção mínima PR #1

Data: 20/09/2026, após parecer Sage 18h15.

## Estado
PR #1 está aberto e o GitHub agora reporta `mergeable: true`.

Bloqueador restante confirmado:
`/property/:id` perde `checkin`, `checkout` e `guests` ao redirecionar para `/imoveis/:id`.

## Missão única
1. Corrigir o redirect preservando somente:
   - `checkin`
   - `checkout`
   - `guests`
2. Não carregar parâmetros arbitrários ou PII.
3. Adicionar teste de regressão:
   - critérios permitidos sobrevivem;
   - parâmetros não permitidos são descartados;
   - valores continuam passando pelas validações existentes.
4. Rodar a suíte relevante.
5. Atualizar PR #1.
6. Resolver comentário de review apenas se a correção estiver comprovada.

## Resultado obrigatório
Encerrar com:
- `READY FOR DIEGO REVIEW`
ou
- `NOT READY` + bloqueador concreto restante.

## Fora de escopo
Nada de Beds24, Mercado Pago, portal, design, preview, CI ou feature nova.
