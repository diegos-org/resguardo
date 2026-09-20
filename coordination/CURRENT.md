# CURRENT — SCL 2.0 Workbench

## Estado atual

- Este repositório é o workbench temporário e não canônico do SCL 2.0.
- Produção permanece separada e intocada.
- O protocolo mestre está em `/00-PROTOCOLO.md`.
- Rivers, Lia e Sage devem usar este repositório como memória compartilhada de coordenação.
- O histórico material deve ser preservado em `coordination/handoffs/`.

## Objetivo imediato

Fazer a primeira rodada coordenada com Rivers → Lia → Sage, cada um lendo o protocolo, atualizando seu próprio arquivo e deixando um handoff claro.

## Regras operacionais ativas

- Ler protocolo + CURRENT + arquivo próprio + DIEGO antes de agir.
- Atualizar DIEGO ao final de toda rodada.
- Não tocar produção.
- Não armazenar segredos ou PII desnecessária.
- Mudança relevante de aplicação: preferir branch + PR.
- Coordenação: pode ser atualizada direto para evitar burocracia.

## Pendente administrativo no GitHub

O conector atual permite editar conteúdo, mas não expõe todas as configurações administrativas.
Ainda precisa ser conferido manualmente:
- visibilidade do repo;
- branch protection / regra de merge;
- remoção do repo pessoal de teste, se Diego ainda quiser apagá-lo.

## Próximo agente

Lia, depois que Diego der o start manual no chat dela.
